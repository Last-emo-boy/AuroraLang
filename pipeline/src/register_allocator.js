/**
 * Register Allocator for Aurora Pipeline
 * 
 * Manages register allocation with:
 * - Reserved registers (r0 for return/services)
 * - Variable lifetime tracking
 * - Temporary register pool
 * - Spilling strategy (when we run out of registers)
 */

const NUM_REGISTERS = 8; // r0-r7
const RESERVED_REGISTERS = new Set([0]); // r0 reserved for return value/service args

class RegisterAllocator {
  constructor() {
    this.varToReg = new Map(); // variable name -> register number
    this.regToVar = new Map(); // register number -> variable name
    this.tempRegs = new Set(); // available temporary registers
    this.nextVarReg = 1; // next register to allocate for variables (starts at r1)
    
    // Initialize temporary register pool (r6, r7 available for temps)
    for (let i = 6; i < NUM_REGISTERS; i++) {
      if (!RESERVED_REGISTERS.has(i)) {
        this.tempRegs.add(i);
      }
    }
  }
  
  /**
   * Allocate a register for a variable
   * @param {string} varName - Variable name
   * @returns {number} - Register number (0-7)
   */
  allocateVariable(varName) {
    if (this.varToReg.has(varName)) {
      return this.varToReg.get(varName);
    }
    
    // Find next available register for variables (r1-r5)
    while (this.nextVarReg < 6) {
      const reg = this.nextVarReg;
      this.nextVarReg++;
      
      if (!RESERVED_REGISTERS.has(reg) && !this.regToVar.has(reg)) {
        this.varToReg.set(varName, reg);
        this.regToVar.set(reg, varName);
        return reg;
      }
    }
    
    // If we've exhausted r1-r5, we need to spill
    throw new Error(`Register spilling not yet implemented. Cannot allocate register for ${varName}`);
  }
  
  /**
   * Get the register allocated to a variable
   * @param {string} varName - Variable name
   * @returns {number} - Register number
   */
  getVariable(varName) {
    if (!this.varToReg.has(varName)) {
      throw new Error(`Variable '${varName}' not allocated to register`);
    }
    return this.varToReg.get(varName);
  }
  
  /**
   * Allocate a temporary register
   * @returns {number} - Register number
   */
  allocateTemp() {
    if (this.tempRegs.size === 0) {
      throw new Error('No temporary registers available');
    }
    
    const reg = this.tempRegs.values().next().value;
    this.tempRegs.delete(reg);
    return reg;
  }
  
  /**
   * Release a temporary register back to the pool
   * @param {number} reg - Register number
   */
  releaseTemp(reg) {
    if (reg >= 6 && reg < NUM_REGISTERS && !RESERVED_REGISTERS.has(reg)) {
      this.tempRegs.add(reg);
    }
  }
  
  /**
   * Check if a variable has a register allocated
   * @param {string} varName - Variable name
   * @returns {boolean}
   */
  hasVariable(varName) {
    return this.varToReg.has(varName);
  }
  
  /**
   * Get all allocated variables
   * @returns {Map<string, number>}
   */
  getAllocations() {
    return new Map(this.varToReg);
  }
  
  /**
   * Reset allocator state (for new compilation)
   */
  reset() {
    this.varToReg.clear();
    this.regToVar.clear();
    this.nextVarReg = 1;
    this.tempRegs.clear();
    
    for (let i = 6; i < NUM_REGISTERS; i++) {
      if (!RESERVED_REGISTERS.has(i)) {
        this.tempRegs.add(i);
      }
    }
  }
}

module.exports = { RegisterAllocator, NUM_REGISTERS, RESERVED_REGISTERS };
