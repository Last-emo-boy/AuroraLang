/**
 * Register Allocator for Aurora Pipeline
 * 
 * Manages register allocation with:
 * - Reserved registers (r0 for return/services)
 * - Variable lifetime tracking
 * - Temporary register pool
 * - Stack spilling when registers exhausted
 * 
 * Register layout:
 *   r0 - reserved for return value / service calls
 *   r1-r5 - general purpose for variables
 *   r6-r7 - temporary registers for expression evaluation
 * 
 * Spilling strategy:
 *   When all r1-r5 are used and we need more variables,
 *   we spill the least recently used initialized variable to stack.
 *   Variables are spilled to [RSP+offset] where offset = 32 + slot*8
 *   (32 bytes = shadow space for Win64 ABI)
 * 
 * Key insight: Only spill variables that have been initialized (have valid values).
 * Uninitialized variables can simply be "forgotten" from registers since they have no value.
 */

const NUM_REGISTERS = 8; // r0-r7
const RESERVED_REGISTERS = new Set([0]); // r0 reserved for return value/service args
const VAR_REGISTERS = [1, 2, 3, 4, 5]; // r1-r5 for variables
const TEMP_REGISTERS = [6, 7]; // r6-r7 for temporaries

class RegisterAllocator {
  constructor() {
    this.varToReg = new Map();       // variable name -> register number (if in register)
    this.regToVar = new Map();       // register number -> variable name
    this.tempRegs = new Set(TEMP_REGISTERS);
    this.varToStackSlot = new Map(); // variable name -> stack slot (for spilled vars)
    this.nextStackSlot = 0;
    this.varAccessOrder = [];        // LRU tracking (oldest first)
    this.spillInstructions = [];
    
    // Track variable states
    this.initializedVars = new Set(); // Variables that have been assigned a value
    this.varsOnStack = new Set();     // Variables currently stored on stack (not in reg)
    this.allVars = new Set();         // All declared variables
  }
  
  /**
   * Declare a variable (just register its existence, don't allocate)
   */
  declareVariable(varName) {
    this.allVars.add(varName);
  }
  
  /**
   * Allocate a register for a variable that's about to be assigned.
   * This is the main allocation entry point.
   * @param {string} varName - Variable name
   * @returns {number} - Register number
   */
  allocateVariable(varName) {
    this.allVars.add(varName);
    
    // If already in a register, just return it
    if (this.varToReg.has(varName)) {
      this._updateAccessOrder(varName);
      return this.varToReg.get(varName);
    }
    
    // If on stack, we'll need to get a register for assignment
    // (variable is being re-assigned, not just read)
    if (this.varsOnStack.has(varName)) {
      // Get a register without reloading (we're assigning new value)
      return this._getRegisterForAssignment(varName);
    }
    
    // New variable - find a free register
    for (const reg of VAR_REGISTERS) {
      if (!this.regToVar.has(reg)) {
        this._assignVarToReg(varName, reg);
        return reg;
      }
    }
    
    // No free registers - need to evict something
    return this._evictAndAllocate(varName);
  }
  
  /**
   * Get a register for assigning to a variable (doesn't reload old value)
   */
  _getRegisterForAssignment(varName) {
    // Try to find a free register first
    for (const reg of VAR_REGISTERS) {
      if (!this.regToVar.has(reg)) {
        // Remove from stack tracking (we're overwriting with new value)
        this.varsOnStack.delete(varName);
        this._assignVarToReg(varName, reg);
        return reg;
      }
    }
    
    // Need to evict something
    return this._evictAndAllocate(varName);
  }
  
  /**
   * Get the register for a variable (for reading its value).
   * Reloads from stack if necessary.
   * @param {string} varName - Variable name
   * @returns {number} - Register number
   */
  getVariable(varName) {
    // If in register, return it
    if (this.varToReg.has(varName)) {
      this._updateAccessOrder(varName);
      return this.varToReg.get(varName);
    }
    
    // If on stack, reload it
    if (this.varsOnStack.has(varName)) {
      return this._reloadVariable(varName);
    }
    
    // Variable was declared but not yet initialized or was evicted while uninitialized
    throw new Error(`Variable '${varName}' not available (not initialized or lost)`);
  }
  
  /**
   * Mark a variable as initialized (has a valid value)
   */
  markInitialized(varName) {
    this.initializedVars.add(varName);
  }
  
  /**
   * Evict the least recently used initialized variable and allocate to new variable
   */
  _evictAndAllocate(varName) {
    // Find LRU initialized variable to spill
    let victimVar = null;
    let victimReg = null;
    
    for (const v of this.varAccessOrder) {
      if (this.varToReg.has(v) && this.initializedVars.has(v)) {
        victimVar = v;
        victimReg = this.varToReg.get(v);
        break;
      }
    }
    
    // If no initialized variable found, find any variable (uninitialized can be dropped)
    if (!victimVar) {
      for (const v of this.varAccessOrder) {
        if (this.varToReg.has(v)) {
          victimVar = v;
          victimReg = this.varToReg.get(v);
          break;
        }
      }
    }
    
    if (!victimVar) {
      throw new Error(`Cannot allocate register for '${varName}': no evictable variables`);
    }
    
    // Only emit spill instruction if victim was initialized
    if (this.initializedVars.has(victimVar)) {
      if (!this.varToStackSlot.has(victimVar)) {
        this.varToStackSlot.set(victimVar, this.nextStackSlot++);
      }
      const stackSlot = this.varToStackSlot.get(victimVar);
      
      this.spillInstructions.push({
        type: 'spill',
        varName: victimVar,
        reg: victimReg,
        stackSlot: stackSlot,
      });
      
      this.varsOnStack.add(victimVar);
    }
    // If not initialized, just forget about it (no spill needed)
    
    // Remove victim from register
    this.varToReg.delete(victimVar);
    this.regToVar.delete(victimReg);
    
    // Assign register to new variable
    this._assignVarToReg(varName, victimReg);
    
    // If new variable was on stack, it's no longer there
    this.varsOnStack.delete(varName);
    
    return victimReg;
  }
  
  /**
   * Reload a variable from stack into a register
   */
  _reloadVariable(varName) {
    // Try to find a free register
    let targetReg = null;
    for (const reg of VAR_REGISTERS) {
      if (!this.regToVar.has(reg)) {
        targetReg = reg;
        break;
      }
    }
    
    // If no free register, evict something
    if (targetReg === null) {
      // Find victim (prefer uninitialized, then LRU initialized)
      let victimVar = null;
      
      // First try to find uninitialized variable
      for (const v of this.varAccessOrder) {
        if (this.varToReg.has(v) && !this.initializedVars.has(v)) {
          victimVar = v;
          break;
        }
      }
      
      // If not found, use LRU initialized (but not the one we're reloading)
      if (!victimVar) {
        for (const v of this.varAccessOrder) {
          if (this.varToReg.has(v) && v !== varName) {
            victimVar = v;
            break;
          }
        }
      }
      
      if (!victimVar) {
        throw new Error(`Cannot reload '${varName}': no evictable variables`);
      }
      
      targetReg = this.varToReg.get(victimVar);
      
      // Spill victim if initialized
      if (this.initializedVars.has(victimVar)) {
        if (!this.varToStackSlot.has(victimVar)) {
          this.varToStackSlot.set(victimVar, this.nextStackSlot++);
        }
        const stackSlot = this.varToStackSlot.get(victimVar);
        
        this.spillInstructions.push({
          type: 'spill',
          varName: victimVar,
          reg: targetReg,
          stackSlot: stackSlot,
        });
        
        this.varsOnStack.add(victimVar);
      }
      
      this.varToReg.delete(victimVar);
      this.regToVar.delete(targetReg);
    }
    
    // Emit reload instruction
    const stackSlot = this.varToStackSlot.get(varName);
    this.spillInstructions.push({
      type: 'reload',
      varName: varName,
      reg: targetReg,
      stackSlot: stackSlot,
    });
    
    // Update tracking
    this.varsOnStack.delete(varName);
    this._assignVarToReg(varName, targetReg);
    
    return targetReg;
  }
  
  /**
   * Helper to assign a variable to a register
   */
  _assignVarToReg(varName, reg) {
    this.varToReg.set(varName, reg);
    this.regToVar.set(reg, varName);
    this._updateAccessOrder(varName);
  }
  
  /**
   * Update access order for LRU tracking
   */
  _updateAccessOrder(varName) {
    const idx = this.varAccessOrder.indexOf(varName);
    if (idx !== -1) {
      this.varAccessOrder.splice(idx, 1);
    }
    this.varAccessOrder.push(varName); // Most recently used at end
  }
  
  /**
   * Allocate a temporary register
   */
  allocateTemp() {
    if (this.tempRegs.size > 0) {
      const reg = this.tempRegs.values().next().value;
      this.tempRegs.delete(reg);
      return reg;
    }
    
    // Fallback: try to find unused variable register
    for (const reg of VAR_REGISTERS) {
      if (!this.regToVar.has(reg)) {
        return reg;
      }
    }
    
    throw new Error('No temporary registers available');
  }
  
  /**
   * Release a temporary register
   */
  releaseTemp(reg) {
    if (TEMP_REGISTERS.includes(reg)) {
      this.tempRegs.add(reg);
    }
  }
  
  /**
   * Check if a variable is available (in register or on stack)
   */
  hasVariable(varName) {
    return this.varToReg.has(varName) || this.varsOnStack.has(varName);
  }
  
  /**
   * Get pending spill/reload instructions and clear
   */
  getAndClearSpillInstructions() {
    const instructions = this.spillInstructions;
    this.spillInstructions = [];
    return instructions;
  }
  
  /**
   * Get number of stack slots used
   */
  getStackSize() {
    return this.nextStackSlot;
  }
  
  /**
   * Reset for new function scope
   */
  reset() {
    this.varToReg.clear();
    this.regToVar.clear();
    this.tempRegs = new Set(TEMP_REGISTERS);
    this.varToStackSlot.clear();
    this.nextStackSlot = 0;
    this.varAccessOrder = [];
    this.spillInstructions = [];
    this.initializedVars.clear();
    this.varsOnStack.clear();
    this.allVars.clear();
  }
}

module.exports = { RegisterAllocator, NUM_REGISTERS, RESERVED_REGISTERS, VAR_REGISTERS, TEMP_REGISTERS };
