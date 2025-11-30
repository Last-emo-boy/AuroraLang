/**
 * Aurora Code Generator - Converts IR to manifest
 * 
 * This module performs the final lowering from high-level IR to ISA instructions.
 * It handles:
 * - Register allocation
 * - Label generation
 * - Instruction encoding
 * - Manifest emission
 */

const IR = require('./ir');
const { RegisterAllocator } = require('./register_allocator');

const ISA = {
  OPCODE: {
    NOP: 0x00,
    MOV: 0x01,
    PUSH: 0x02,   // Push register to stack
    POP: 0x03,    // Pop from stack to register
    ADD: 0x04,
    SUB: 0x05,
    CMP: 0x06,
    JMP: 0x07,
    CJMP: 0x08,
    CALL: 0x09,
    RET: 0x0a,
    SVC: 0x0b,
    HALT: 0x0c,
    MUL: 0x0d,
    DIV: 0x0e,
    REM: 0x0f,
    // Bitwise operations
    AND: 0x10,
    OR: 0x11,
    XOR: 0x12,
    NOT: 0x13,
    SHL: 0x14,
    SHR: 0x15,
    // Stack frame operations
    STORE_STACK: 0x16,  // Store reg to [RSP+offset]
    LOAD_STACK: 0x17,   // Load reg from [RSP+offset]
    // Array operations
    ARRAY_ALLOC: 0x18,  // Allocate array on stack: dest_reg, size
    ARRAY_STORE: 0x19,  // Store to array: array_base_slot, index_reg, value_reg
    ARRAY_LOAD: 0x1a,   // Load from array: dest_reg, array_base_slot, index_reg
    // Floating point operations (use XMM registers)
    FMOV: 0x20,   // Move float: dest_xmm, src_xmm/imm64
    FADD: 0x21,   // Float add: dest_xmm, src1_xmm, src2_xmm
    FSUB: 0x22,   // Float sub: dest_xmm, src1_xmm, src2_xmm
    FMUL: 0x23,   // Float mul: dest_xmm, src1_xmm, src2_xmm
    FDIV: 0x24,   // Float div: dest_xmm, src1_xmm, src2_xmm
    FCMP: 0x25,   // Float compare: xmm1, xmm2
    FLOAD: 0x26,  // Load float from stack: dest_xmm, [RSP+offset]
    FSTORE: 0x27, // Store float to stack: [RSP+offset], src_xmm
    CVTSI2SD: 0x28, // Convert int to float: dest_xmm, src_reg
    CVTSD2SI: 0x29, // Convert float to int: dest_reg, src_xmm
    FSQRT: 0x2A,    // Float square root: dest_xmm, src_xmm
    FABS: 0x2B,     // Float absolute value: dest_xmm, src_xmm
    FNEG: 0x2C,     // Float negate: dest_xmm, src_xmm
    FFLOOR: 0x2D,   // Float floor (round toward -inf): dest_xmm, src_xmm
    FCEIL: 0x2E,    // Float ceil (round toward +inf): dest_xmm, src_xmm
    // Thread operations
    SPAWN: 0x30,  // Spawn thread: dest_reg (handle), func_label
    JOIN: 0x31,   // Join thread: handle_reg
    // Atomic/shared memory operations
    ATOMIC_LOAD: 0x32,   // Atomic load: dest_reg, shared_var_id
    ATOMIC_STORE: 0x33,  // Atomic store: shared_var_id, src_reg
    ATOMIC_ADD: 0x34,    // Atomic add: shared_var_id, src_reg (adds src to shared)
    ATOMIC_FADD: 0x35,   // Atomic float add: shared_var_id, src_xmm
  },
  OPERAND: {
    UNUSED: 0x00,
    LABEL: 0xfe,
    IMMEDIATE: 0xff,
  },
  REGISTER: {
    r0: 0,
    r1: 1,
    r2: 2,
    r3: 3,
    r4: 4,
    r5: 5,
    r6: 6,
    r7: 7,
  },
};

// =============================================================================
// Instruction Encoding
// =============================================================================

function packInstruction(opcode, op0, op1, op2, imm32) {
  const u32 = toUint32(imm32);
  let word = (BigInt(opcode & 0xff) << 56n)
    | (BigInt(op0 & 0xff) << 48n)
    | (BigInt(op1 & 0xff) << 40n)
    | (BigInt(op2 & 0xff) << 32n)
    | BigInt(u32);
  return `0x${word.toString(16).padStart(16, '0').toUpperCase()}`;
}

function toUint32(value) {
  if (!Number.isInteger(value)) {
    throw new Error(`Immediate must be integer, received ${value}`);
  }
  if (value < -0x80000000 || value > 0x7fffffff) {
    throw new Error(`Immediate ${value} exceeds signed 32-bit range`);
  }
  return value >>> 0;
}

function encodeMovLabel(destReg) {
  return packInstruction(ISA.OPCODE.MOV, destReg, ISA.OPERAND.LABEL, ISA.OPERAND.UNUSED, 0);
}

function encodeMovImmediate(destReg, value) {
  return packInstruction(ISA.OPCODE.MOV, destReg, ISA.OPERAND.IMMEDIATE, ISA.OPERAND.UNUSED, value);
}

function encodeMovRegister(destReg, srcReg) {
  return packInstruction(ISA.OPCODE.MOV, destReg, srcReg, ISA.OPERAND.UNUSED, 0);
}

// Stack operations for register spilling
function encodePush(reg) {
  return packInstruction(ISA.OPCODE.PUSH, reg, ISA.OPERAND.UNUSED, ISA.OPERAND.UNUSED, 0);
}

function encodePop(reg) {
  return packInstruction(ISA.OPCODE.POP, reg, ISA.OPERAND.UNUSED, ISA.OPERAND.UNUSED, 0);
}

// Stack frame operations for variable spilling
function encodeStoreStack(srcReg, stackOffset) {
  // Store srcReg to [RSP+stackOffset]
  return packInstruction(ISA.OPCODE.STORE_STACK, srcReg, ISA.OPERAND.IMMEDIATE, ISA.OPERAND.UNUSED, stackOffset);
}

function encodeLoadStack(destReg, stackOffset) {
  // Load destReg from [RSP+stackOffset]
  return packInstruction(ISA.OPCODE.LOAD_STACK, destReg, ISA.OPERAND.IMMEDIATE, ISA.OPERAND.UNUSED, stackOffset);
}

function encodeAddRegReg(destReg, lhsReg, rhsReg) {
  return packInstruction(ISA.OPCODE.ADD, destReg, lhsReg, rhsReg, 0);
}

function encodeSubRegImm(destReg, lhsReg, imm) {
  return packInstruction(ISA.OPCODE.SUB, destReg, lhsReg, ISA.OPERAND.IMMEDIATE, imm);
}

function encodeCmpRegImm(lhsReg, imm) {
  return packInstruction(ISA.OPCODE.CMP, lhsReg, ISA.OPERAND.IMMEDIATE, ISA.OPERAND.UNUSED, imm);
}

function encodeCmpRegReg(lhsReg, rhsReg) {
  return packInstruction(ISA.OPCODE.CMP, lhsReg, rhsReg, ISA.OPERAND.UNUSED, 0);
}

function encodeCjmpEq(labelName) {
  return packInstruction(ISA.OPCODE.CJMP, 0x01, ISA.OPERAND.LABEL, ISA.OPERAND.UNUSED, 0);
}

function encodeCjmpNeq(labelName) {
  return packInstruction(ISA.OPCODE.CJMP, 0x02, ISA.OPERAND.LABEL, ISA.OPERAND.UNUSED, 0);
}

function encodeCjmpLt(labelName) {
  return packInstruction(ISA.OPCODE.CJMP, 0x03, ISA.OPERAND.LABEL, ISA.OPERAND.UNUSED, 0);
}

function encodeCjmpLeq(labelName) {
  return packInstruction(ISA.OPCODE.CJMP, 0x04, ISA.OPERAND.LABEL, ISA.OPERAND.UNUSED, 0);
}

function encodeCjmpGt(labelName) {
  return packInstruction(ISA.OPCODE.CJMP, 0x05, ISA.OPERAND.LABEL, ISA.OPERAND.UNUSED, 0);
}

function encodeCjmpGeq(labelName) {
  return packInstruction(ISA.OPCODE.CJMP, 0x06, ISA.OPERAND.LABEL, ISA.OPERAND.UNUSED, 0);
}

function encodeJmp(labelName) {
  return packInstruction(ISA.OPCODE.JMP, ISA.OPERAND.LABEL, ISA.OPERAND.UNUSED, ISA.OPERAND.UNUSED, 0);
}

function encodeSvc(serviceCode, op1 = ISA.OPERAND.UNUSED) {
  return packInstruction(ISA.OPCODE.SVC, serviceCode, op1, ISA.OPERAND.UNUSED, 0);
}

function encodeHalt() {
  return packInstruction(ISA.OPCODE.HALT, ISA.OPERAND.UNUSED, ISA.OPERAND.UNUSED, ISA.OPERAND.UNUSED, 0);
}

// MUL/DIV/REM instructions
function encodeMulRegReg(destReg, lhsReg, rhsReg) {
  return packInstruction(ISA.OPCODE.MUL, destReg, lhsReg, rhsReg, 0);
}

function encodeMulRegImm(destReg, lhsReg, imm) {
  return packInstruction(ISA.OPCODE.MUL, destReg, lhsReg, ISA.OPERAND.IMMEDIATE, imm);
}

function encodeDivRegReg(destReg, lhsReg, rhsReg) {
  return packInstruction(ISA.OPCODE.DIV, destReg, lhsReg, rhsReg, 0);
}

function encodeDivRegImm(destReg, lhsReg, imm) {
  return packInstruction(ISA.OPCODE.DIV, destReg, lhsReg, ISA.OPERAND.IMMEDIATE, imm);
}

function encodeRemRegReg(destReg, lhsReg, rhsReg) {
  return packInstruction(ISA.OPCODE.REM, destReg, lhsReg, rhsReg, 0);
}

function encodeRemRegImm(destReg, lhsReg, imm) {
  return packInstruction(ISA.OPCODE.REM, destReg, lhsReg, ISA.OPERAND.IMMEDIATE, imm);
}

function encodeSubRegReg(destReg, lhsReg, rhsReg) {
  return packInstruction(ISA.OPCODE.SUB, destReg, lhsReg, rhsReg, 0);
}

function encodeAddRegImm(destReg, lhsReg, imm) {
  return packInstruction(ISA.OPCODE.ADD, destReg, lhsReg, ISA.OPERAND.IMMEDIATE, imm);
}

// Bitwise operations
function encodeAndRegReg(destReg, lhsReg, rhsReg) {
  return packInstruction(ISA.OPCODE.AND, destReg, lhsReg, rhsReg, 0);
}

function encodeAndRegImm(destReg, lhsReg, imm) {
  return packInstruction(ISA.OPCODE.AND, destReg, lhsReg, ISA.OPERAND.IMMEDIATE, imm);
}

function encodeOrRegReg(destReg, lhsReg, rhsReg) {
  return packInstruction(ISA.OPCODE.OR, destReg, lhsReg, rhsReg, 0);
}

function encodeOrRegImm(destReg, lhsReg, imm) {
  return packInstruction(ISA.OPCODE.OR, destReg, lhsReg, ISA.OPERAND.IMMEDIATE, imm);
}

function encodeXorRegReg(destReg, lhsReg, rhsReg) {
  return packInstruction(ISA.OPCODE.XOR, destReg, lhsReg, rhsReg, 0);
}

function encodeXorRegImm(destReg, lhsReg, imm) {
  return packInstruction(ISA.OPCODE.XOR, destReg, lhsReg, ISA.OPERAND.IMMEDIATE, imm);
}

function encodeNotReg(destReg, srcReg) {
  return packInstruction(ISA.OPCODE.NOT, destReg, srcReg, ISA.OPERAND.UNUSED, 0);
}

function encodeShlRegReg(destReg, lhsReg, rhsReg) {
  return packInstruction(ISA.OPCODE.SHL, destReg, lhsReg, rhsReg, 0);
}

function encodeShlRegImm(destReg, lhsReg, imm) {
  return packInstruction(ISA.OPCODE.SHL, destReg, lhsReg, ISA.OPERAND.IMMEDIATE, imm);
}

function encodeShrRegReg(destReg, lhsReg, rhsReg) {
  return packInstruction(ISA.OPCODE.SHR, destReg, lhsReg, rhsReg, 0);
}

function encodeShrRegImm(destReg, lhsReg, imm) {
  return packInstruction(ISA.OPCODE.SHR, destReg, lhsReg, ISA.OPERAND.IMMEDIATE, imm);
}

// Function call/return instructions
function encodeCall(labelName) {
  // CALL instruction: jump to function label, return address is pushed by interpreter
  return packInstruction(ISA.OPCODE.CALL, ISA.OPERAND.LABEL, ISA.OPERAND.UNUSED, ISA.OPERAND.UNUSED, 0);
}

function encodeRet() {
  // RET instruction: pop return address and jump back
  return packInstruction(ISA.OPCODE.RET, ISA.OPERAND.UNUSED, ISA.OPERAND.UNUSED, ISA.OPERAND.UNUSED, 0);
}

// =============================================================================
// Floating Point Instruction Encoding
// =============================================================================

// Pack float64 into two 32-bit values for instruction encoding
function packFloat64(value) {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, true);  // little-endian
  return {
    lo: view.getUint32(0, true),
    hi: view.getUint32(4, true)
  };
}

// FMOV with immediate: load float constant to XMM register
// Uses two instructions: first loads low 32 bits, second loads high 32 bits
function encodeFMovImm(destXmm, floatValue) {
  const { lo, hi } = packFloat64(floatValue);
  // Pack: opcode=FMOV, op0=destXmm, op1=IMMEDIATE, op2=hi (8bits), imm32=lo
  return packInstruction(ISA.OPCODE.FMOV, destXmm, ISA.OPERAND.IMMEDIATE, hi & 0xFF, lo);
}

// Extended FMOV encoding that includes full 64-bit float
// Returns an array with instruction and float data word
function encodeFMovImmFull(destXmm, floatValue) {
  // Encode the instruction with a marker (operand = 0xFF means load from next word)
  const instruction = packInstruction(ISA.OPCODE.FMOV, destXmm, 0xFF, ISA.OPERAND.UNUSED, 0);
  
  // Encode the float value as a 64-bit hex string
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, floatValue, true);  // little-endian
  
  // Build the hex string for the 64-bit float
  let floatHex = '0x';
  for (let i = 7; i >= 0; i--) {
    floatHex += view.getUint8(i).toString(16).padStart(2, '0').toUpperCase();
  }
  
  return { instruction, floatData: floatHex };
}

function encodeFMovReg(destXmm, srcXmm) {
  return packInstruction(ISA.OPCODE.FMOV, destXmm, srcXmm, ISA.OPERAND.UNUSED, 0);
}

function encodeFAddReg(destXmm, src1Xmm, src2Xmm) {
  return packInstruction(ISA.OPCODE.FADD, destXmm, src1Xmm, src2Xmm, 0);
}

function encodeFSubReg(destXmm, src1Xmm, src2Xmm) {
  return packInstruction(ISA.OPCODE.FSUB, destXmm, src1Xmm, src2Xmm, 0);
}

function encodeFMulReg(destXmm, src1Xmm, src2Xmm) {
  return packInstruction(ISA.OPCODE.FMUL, destXmm, src1Xmm, src2Xmm, 0);
}

function encodeFDivReg(destXmm, src1Xmm, src2Xmm) {
  return packInstruction(ISA.OPCODE.FDIV, destXmm, src1Xmm, src2Xmm, 0);
}

function encodeFCmp(xmm1, xmm2) {
  return packInstruction(ISA.OPCODE.FCMP, xmm1, xmm2, ISA.OPERAND.UNUSED, 0);
}

function encodeFLoad(destXmm, stackOffset) {
  return packInstruction(ISA.OPCODE.FLOAD, destXmm, ISA.OPERAND.UNUSED, ISA.OPERAND.UNUSED, stackOffset);
}

function encodeFStore(stackOffset, srcXmm) {
  return packInstruction(ISA.OPCODE.FSTORE, srcXmm, ISA.OPERAND.UNUSED, ISA.OPERAND.UNUSED, stackOffset);
}

function encodeCvtSI2SD(destXmm, srcReg) {
  return packInstruction(ISA.OPCODE.CVTSI2SD, destXmm, srcReg, ISA.OPERAND.UNUSED, 0);
}

function encodeCvtSD2SI(destReg, srcXmm) {
  return packInstruction(ISA.OPCODE.CVTSD2SI, destReg, srcXmm, ISA.OPERAND.UNUSED, 0);
}

function encodeFSqrt(destXmm, srcXmm) {
  return packInstruction(ISA.OPCODE.FSQRT, destXmm, srcXmm, ISA.OPERAND.UNUSED, 0);
}

function encodeFAbs(destXmm, srcXmm) {
  return packInstruction(ISA.OPCODE.FABS, destXmm, srcXmm, ISA.OPERAND.UNUSED, 0);
}

function encodeFNeg(destXmm, srcXmm) {
  return packInstruction(ISA.OPCODE.FNEG, destXmm, srcXmm, ISA.OPERAND.UNUSED, 0);
}

function encodeFFloor(destXmm, srcXmm) {
  return packInstruction(ISA.OPCODE.FFLOOR, destXmm, srcXmm, ISA.OPERAND.UNUSED, 0);
}

function encodeFCeil(destXmm, srcXmm) {
  return packInstruction(ISA.OPCODE.FCEIL, destXmm, srcXmm, ISA.OPERAND.UNUSED, 0);
}

// Thread operations
function encodeSpawn(destReg, funcLabel) {
  // SPAWN dest_reg, label (label is encoded separately in comment)
  return packInstruction(ISA.OPCODE.SPAWN, destReg, ISA.OPERAND.LABEL, ISA.OPERAND.UNUSED, 0);
}

function encodeJoin(handleReg) {
  // JOIN handle_reg
  return packInstruction(ISA.OPCODE.JOIN, handleReg, ISA.OPERAND.UNUSED, ISA.OPERAND.UNUSED, 0);
}

// =============================================================================
// Code Generation Context
// =============================================================================

class CodeGenContext {
  constructor() {
    this.instructions = [];
    this.labels = [];
    this.strings = [];
    this.nextLabelId = 0;
    this.registerAlloc = new RegisterAllocator();
    this.functions = new Map();  // Map function name to label
    this.currentFunction = null; // Track which function we're generating
    this.loopStack = [];         // Stack of loop contexts for break/continue
    this.stackFrameSize = 0;     // Size of stack frame for spilled variables
    
    // Array support
    this.arrayBaseSlots = new Map(); // Map array name to base slot number
    this.nextArraySlot = 0;          // Next available slot for array allocation
    this.nextArrayId = 0;            // For generating anonymous array names
    this.currentArrayName = null;    // Name of array being initialized
    
    // Float support - XMM register allocation with spilling
    this.floatVars = new Map();          // Map float var name to XMM reg (if in register)
    this.floatVarsOnStack = new Map();   // Map float var name to stack offset (if spilled)
    this.floatStackValid = new Set();    // Float vars with valid stack copy (no need to re-spill)
    this.floatRegToVar = new Map();      // Map XMM register to var name
    this.floatAccessOrder = [];          // LRU tracking (oldest first)
    this.floatInitialized = new Set();   // Float vars that have been assigned
    this.nextFloatStackOffset = 0;       // Next stack offset for float spill (after int spills)
    this.floatTemps = [false, false, false, false, false, false, false, false, false, false]; // xmm6-xmm15 for temp use
    this.floatConstants = new Map();     // Map float value to data label
    this.nextFloatConstId = 0;           // For naming float constants
    
    // XMM register pool: xmm0-xmm5 for variables, xmm6-xmm15 for temps
    this.FLOAT_VAR_REGS = [0, 1, 2, 3, 4, 5];  // 6 registers for float variables
    this.FLOAT_TEMP_REGS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15];  // 10 temp registers
    
    // Shared variable support
    this.sharedVars = new Map();     // Map shared var name to { id, type, initialValue }
    this.nextSharedId = 0;           // Next available shared var ID
    
    // Pending float spill instructions
    this.pendingFloatSpills = [];
  }
  
  // Register a shared variable
  registerSharedVar(name, type, initialValue) {
    if (this.sharedVars.has(name)) {
      throw new Error(`Shared variable already declared: ${name}`);
    }
    const id = this.nextSharedId++;
    this.sharedVars.set(name, { id, type, initialValue });
    return id;
  }
  
  getSharedVarId(name) {
    if (!this.sharedVars.has(name)) {
      throw new Error(`Unknown shared variable: ${name}`);
    }
    return this.sharedVars.get(name).id;
  }
  
  getSharedVarInfo(name) {
    return this.sharedVars.get(name);
  }
  
  isSharedVar(name) {
    return this.sharedVars.has(name);
  }
  
  // Allocate XMM register for float variable (with spilling support)
  allocFloatRegister(varName) {
    // If already in a register, return it
    if (this.floatVars.has(varName)) {
      this._updateFloatAccessOrder(varName);
      return this.floatVars.get(varName);
    }
    
    // If on stack, get a register (for re-assignment)
    if (this.floatVarsOnStack.has(varName)) {
      return this._getFloatRegForAssignment(varName);
    }
    
    // New variable - try to find a free register
    for (const xmm of this.FLOAT_VAR_REGS) {
      if (!this.floatRegToVar.has(xmm)) {
        this._assignFloatVarToReg(varName, xmm);
        return xmm;
      }
    }
    
    // No free registers - need to evict (spill) something
    return this._evictAndAllocateFloat(varName);
  }
  
  // Get XMM register for reading a float variable
  getFloatRegister(varName) {
    // If in register, return it
    if (this.floatVars.has(varName)) {
      this._updateFloatAccessOrder(varName);
      return this.floatVars.get(varName);
    }
    
    // If on stack, reload it
    if (this.floatVarsOnStack.has(varName)) {
      return this._reloadFloatVariable(varName);
    }
    
    throw new Error(`Float variable not allocated: ${varName}`);
  }
  
  // Mark float variable as initialized (and invalidate any stack copy)
  markFloatInitialized(varName) {
    this.floatInitialized.add(varName);
    // Invalidate stack copy - the value in register is now the authoritative one
    this.floatStackValid.delete(varName);
  }
  
  // Get a register for assigning to a float variable (doesn't reload)
  _getFloatRegForAssignment(varName) {
    for (const xmm of this.FLOAT_VAR_REGS) {
      if (!this.floatRegToVar.has(xmm)) {
        this.floatVarsOnStack.delete(varName);
        this.floatStackValid.delete(varName);  // No longer on stack
        this._assignFloatVarToReg(varName, xmm);
        return xmm;
      }
    }
    return this._evictAndAllocateFloat(varName);
  }
  
  // Evict LRU float variable and allocate to new variable
  _evictAndAllocateFloat(varName) {
    // Find LRU initialized variable to spill (prefer ones already with valid stack copy)
    let victimVar = null;
    let victimXmm = null;
    
    // First: try to find a variable that's already safely on stack
    for (const v of this.floatAccessOrder) {
      if (this.floatVars.has(v) && this.floatStackValid.has(v)) {
        victimVar = v;
        victimXmm = this.floatVars.get(v);
        break;
      }
    }
    
    // Second: find LRU initialized variable that needs to be spilled
    if (!victimVar) {
      for (const v of this.floatAccessOrder) {
        if (this.floatVars.has(v) && this.floatInitialized.has(v)) {
          victimVar = v;
          victimXmm = this.floatVars.get(v);
          break;
        }
      }
    }
    
    // Third: try any variable
    if (!victimVar) {
      for (const v of this.floatAccessOrder) {
        if (this.floatVars.has(v)) {
          victimVar = v;
          victimXmm = this.floatVars.get(v);
          break;
        }
      }
    }
    
    if (!victimVar) {
      throw new Error(`Cannot allocate XMM for '${varName}': no evictable variables`);
    }
    
    // Spill victim if initialized AND not already valid on stack
    if (this.floatInitialized.has(victimVar) && !this.floatStackValid.has(victimVar)) {
      if (!this.floatVarsOnStack.has(victimVar)) {
        // Assign new stack slot (after int vars, starting at offset 200)
        const stackOffset = 200 + this.nextFloatStackOffset * 8;
        this.floatVarsOnStack.set(victimVar, stackOffset);
        this.nextFloatStackOffset++;
      }
      const stackOffset = this.floatVarsOnStack.get(victimVar);
      
      // Emit FSTORE instruction
      this.emitInstruction(
        encodeFStore(stackOffset, victimXmm),
        `fstore [RSP+${stackOffset}], xmm${victimXmm} ; spill ${victimVar}`
      );
      
      // Mark stack copy as valid
      this.floatStackValid.add(victimVar);
    }
    
    // Remove victim from register
    this.floatVars.delete(victimVar);
    this.floatRegToVar.delete(victimXmm);
    
    // Assign to new variable
    this._assignFloatVarToReg(varName, victimXmm);
    this.floatVarsOnStack.delete(varName);
    this.floatStackValid.delete(varName);  // New var is not on stack
    
    return victimXmm;
  }
  
  // Reload float variable from stack
  _reloadFloatVariable(varName) {
    // Find a free register
    let targetXmm = null;
    for (const xmm of this.FLOAT_VAR_REGS) {
      if (!this.floatRegToVar.has(xmm)) {
        targetXmm = xmm;
        break;
      }
    }
    
    // If no free register, evict something
    if (targetXmm === null) {
      let victimVar = null;
      
      // First: prefer variables already with valid stack copy
      for (const v of this.floatAccessOrder) {
        if (this.floatVars.has(v) && this.floatStackValid.has(v) && v !== varName) {
          victimVar = v;
          break;
        }
      }
      
      // Second: prefer uninitialized
      if (!victimVar) {
        for (const v of this.floatAccessOrder) {
          if (this.floatVars.has(v) && !this.floatInitialized.has(v)) {
            victimVar = v;
            break;
          }
        }
      }
      
      // Third: LRU initialized (not the one we're reloading)
      if (!victimVar) {
        for (const v of this.floatAccessOrder) {
          if (this.floatVars.has(v) && v !== varName) {
            victimVar = v;
            break;
          }
        }
      }
      
      if (!victimVar) {
        throw new Error(`Cannot reload float '${varName}': no evictable variables`);
      }
      
      targetXmm = this.floatVars.get(victimVar);
      
      // Spill victim if initialized AND not already valid on stack
      if (this.floatInitialized.has(victimVar) && !this.floatStackValid.has(victimVar)) {
        if (!this.floatVarsOnStack.has(victimVar)) {
          const stackOffset = 200 + this.nextFloatStackOffset * 8;
          this.floatVarsOnStack.set(victimVar, stackOffset);
          this.nextFloatStackOffset++;
        }
        const stackOffset = this.floatVarsOnStack.get(victimVar);
        
        this.emitInstruction(
          encodeFStore(stackOffset, targetXmm),
          `fstore [RSP+${stackOffset}], xmm${targetXmm} ; spill ${victimVar}`
        );
        
        // Mark stack copy as valid
        this.floatStackValid.add(victimVar);
      }
      
      this.floatVars.delete(victimVar);
      this.floatRegToVar.delete(targetXmm);
    }
    
    // Reload from stack
    const stackOffset = this.floatVarsOnStack.get(varName);
    this.emitInstruction(
      encodeFLoad(targetXmm, stackOffset),
      `fload xmm${targetXmm}, [RSP+${stackOffset}] ; reload ${varName}`
    );
    
    // Update tracking - variable is now in register
    // Keep stack slot but note it's still valid (for future reloads if needed)
    this._assignFloatVarToReg(varName, targetXmm);
    // Note: floatStackValid stays true - the value on stack is still valid until variable is modified
    
    return targetXmm;
  }
  
  // Pre-spill all initialized float variables to stack
  // Called before entering loops to avoid spill instructions in loop body
  spillAllFloatVars() {
    for (const [varName, xmm] of this.floatVars.entries()) {
      // Only spill if initialized and not already valid on stack
      if (this.floatInitialized.has(varName) && !this.floatStackValid.has(varName)) {
        // Allocate stack slot if needed
        if (!this.floatVarsOnStack.has(varName)) {
          const stackOffset = 200 + this.nextFloatStackOffset * 8;
          this.floatVarsOnStack.set(varName, stackOffset);
          this.nextFloatStackOffset++;
        }
        const stackOffset = this.floatVarsOnStack.get(varName);
        
        // Emit spill instruction
        this.emitInstruction(
          encodeFStore(stackOffset, xmm),
          `fstore [RSP+${stackOffset}], xmm${xmm} ; pre-spill ${varName} before loop`
        );
        
        // Mark as valid on stack
        this.floatStackValid.add(varName);
      }
    }
  }
  
  // Helper: assign float var to XMM register
  _assignFloatVarToReg(varName, xmm) {
    this.floatVars.set(varName, xmm);
    this.floatRegToVar.set(xmm, varName);
    this._updateFloatAccessOrder(varName);
  }
  
  // Helper: update LRU order
  _updateFloatAccessOrder(varName) {
    const idx = this.floatAccessOrder.indexOf(varName);
    if (idx !== -1) {
      this.floatAccessOrder.splice(idx, 1);
    }
    this.floatAccessOrder.push(varName);
  }
  
  // Check if variable is a float (in register or on stack)
  hasFloatVar(varName) {
    return this.floatVars.has(varName) || this.floatVarsOnStack.has(varName);
  }
  
  allocFloatTemp() {
    // Try xmm6-xmm15 for temporary use
    for (let i = 0; i < this.floatTemps.length; i++) {
      if (!this.floatTemps[i]) {
        this.floatTemps[i] = true;
        return 6 + i;  // xmm6, xmm7, xmm8, ... xmm15
      }
    }
    throw new Error('Out of float temp registers');
  }
  
  releaseFloatTemp(xmm) {
    if (xmm >= 6 && xmm <= 15) {
      this.floatTemps[xmm - 6] = false;
    }
  }
  
  // Get or create a float constant in data section
  getFloatConstant(value) {
    if (this.floatConstants.has(value)) {
      return this.floatConstants.get(value);
    }
    const label = `fconst_${this.nextFloatConstId++}`;
    this.floatConstants.set(value, label);
    return label;
  }
  
  allocRegister(varName) {
    const reg = this.registerAlloc.allocateVariable(varName);
    this._emitSpillInstructions();
    return reg;
  }
  
  getRegister(varName) {
    const reg = this.registerAlloc.getVariable(varName);
    this._emitSpillInstructions();
    return reg;
  }
  
  // Emit any pending spill/reload instructions using stack frame offsets
  _emitSpillInstructions() {
    const spillOps = this.registerAlloc.getAndClearSpillInstructions();
    for (const op of spillOps) {
      // Calculate stack offset: shadow space (32 bytes) + slot * 8
      const stackOffset = 32 + op.stackSlot * 8;
      
      if (op.type === 'spill') {
        // Store register to stack slot [RSP + offset]
        this.emitInstruction(
          encodeStoreStack(op.reg, stackOffset),
          `store r${op.reg} -> [RSP+${stackOffset}] ; spill ${op.varName}`
        );
      } else if (op.type === 'reload') {
        // Load register from stack slot [RSP + offset]
        this.emitInstruction(
          encodeLoadStack(op.reg, stackOffset),
          `load r${op.reg} <- [RSP+${stackOffset}] ; reload ${op.varName}`
        );
      }
    }
  }
  
  // Get required stack frame size for function
  getStackFrameSize() {
    // Shadow space (32 bytes) + spill slots (8 bytes each) + array slots (8 bytes each)
    // Plus float spill area starting at offset 200
    const spillSlots = this.registerAlloc.getStackSize();
    const intSlotsSize = spillSlots + this.nextArraySlot;
    
    // Float spill starts at 200, so we need at least 200 bytes + float slots
    const floatSpillSize = this.nextFloatStackOffset > 0 
      ? 200 + this.nextFloatStackOffset * 8  
      : 0;
    
    // Take the max of int spill area, float spill area, and minimum 88 bytes
    // 88 bytes (0x58) is required for syscalls (32 shadow + 56 locals)
    const minSize = 88;
    const size = Math.max(minSize, 32 + intSlotsSize * 8, floatSpillSize);
    
    // Win64 ABI: Stack must be 16-byte aligned BEFORE a CALL instruction
    // After CALL, RSP = 16n+8 (return address pushed)
    // So we need (RSP - stackSize) to be 16-aligned
    // This means stackSize should be 16n+8
    // Round up to next 16n+8: ((size + 7) & ~15) + 8
    // Or equivalently: round up to 16, then add 8 if even multiple
    const aligned = (size + 15) & ~15;
    // If aligned is 16n (even multiple of 16), we need 16n+8
    // If aligned is 16n+8, we're good but should use 16(n+1)+8 = aligned + 8
    // Actually, let's just ensure it's 8 mod 16:
    // (aligned | 8) gives us the nearest 16n+8 >= aligned
    return aligned % 16 === 0 ? aligned + 8 : aligned;
  }
  
  allocTemp() {
    return this.registerAlloc.allocateTemp();
  }
  
  releaseTemp(reg) {
    this.registerAlloc.releaseTemp(reg);
  }
  
  // Array slot management
  allocArraySlots(arrayName, count) {
    const baseSlot = this.nextArraySlot;
    this.nextArraySlot += count;
    this.arrayBaseSlots.set(arrayName, baseSlot);
    return baseSlot;
  }
  
  getArrayBaseSlot(arrayName) {
    return this.arrayBaseSlots.get(arrayName);
  }
  
  emitInstruction(bytes, comment = '') {
    this.instructions.push({ bytes, comment });
  }
  
  // Emit a float immediate load instruction (requires special handling for 64-bit data)
  emitFloatLoadImm(destXmm, floatValue, varName = '') {
    const { instruction, floatData } = encodeFMovImmFull(destXmm, floatValue);
    // Emit the instruction
    this.instructions.push({ bytes: instruction, comment: `fmov xmm${destXmm}, ${floatValue} ; ${varName}` });
    // Emit the float data word immediately after
    this.instructions.push({ bytes: floatData, comment: `  ; float64 ${floatValue}` });
  }
  
  emitLabel(name) {
    this.labels.push({ name, offset: this.instructions.length });
  }
  
  addString(literal) {
    const existing = this.strings.find(s => s.value === literal);
    if (existing) return existing.label;
    
    const label = `str_${this.strings.length}`;
    this.strings.push({ label, value: literal });
    return label;
  }
  
  generateLabel(prefix = 'L') {
    return `${prefix}_${this.nextLabelId++}`;
  }
  
  registerFunction(name) {
    const label = `fn_${name}`;
    this.functions.set(name, label);
    return label;
  }
  
  getFunctionLabel(name) {
    return this.functions.get(name);
  }
  
  // Loop context management for break/continue
  pushLoop(exitLabel, continueLabel) {
    this.loopStack.push({ exitLabel, continueLabel });
  }
  
  popLoop() {
    return this.loopStack.pop();
  }
  
  currentLoop() {
    if (this.loopStack.length === 0) return null;
    return this.loopStack[this.loopStack.length - 1];
  }
  
  // Reset register allocator for a new function scope
  resetForFunction() {
    this.registerAlloc = new RegisterAllocator();
    this.loopStack = [];
    this.arrayBaseSlots = new Map();
    this.nextArraySlot = 0;
    // Reset float registers
    this.floatVars = new Map();
    this.floatRegToVar = new Map();
    this.floatAccessOrder = [];
    this.floatVarsOnStack = new Map();
    this.floatStackValid = new Set();  // Reset stack validity tracking
    this.floatInitialized = new Set();
    this.nextFloatStackOffset = 0;
    this.nextFloatReg = 0;
    // 10 temp registers: xmm6-xmm15
    this.floatTemps = [false, false, false, false, false, false, false, false, false, false];
  }
}

// =============================================================================
// IR to Instructions
// =============================================================================

function generateProgram(program) {
  const ctx = new CodeGenContext();
  
  // Check if this is a module with functions
  const hasFunctions = program.declarations.some(d => d.kind === 'fn');
  
  if (hasFunctions) {
    return generateModuleProgram(program, ctx);
  } else {
    return generateFlatProgram(program, ctx);
  }
}

function generateFlatProgram(program, ctx) {
  // Original flat program handling (no functions)
  
  // Allocate registers for all declarations
  for (const decl of program.declarations) {
    if (decl.kind === 'let') {
      ctx.allocRegister(decl.name);
    }
  }
  
  // Generate initialization code
  for (const decl of program.declarations) {
    if (decl.kind === 'let') {
      generateDeclaration(decl, ctx);
    }
  }
  
  // Generate main body
  for (const stmt of program.body.statements) {
    generateStatement(stmt, ctx);
  }
  
  return ctx;
}

function generateModuleProgram(program, ctx) {
  // First pass: register all functions
  for (const decl of program.declarations) {
    if (decl.kind === 'fn') {
      ctx.registerFunction(decl.name);
    }
  }
  
  // Register shared variables (from program.sharedVars)
  if (program.sharedVars) {
    for (const shared of program.sharedVars) {
      ctx.registerSharedVar(shared.name, shared.type, shared.value);
    }
  }
  
  // Find main function
  const mainFn = program.declarations.find(d => d.kind === 'fn' && d.name === 'main');
  if (!mainFn) {
    throw new Error('No main function found in module');
  }
  
  // Generate jump to main
  ctx.emitInstruction(
    encodeJmp('fn_main'),
    'jmp fn_main ; entry point'
  );
  
  // Generate all functions
  for (const decl of program.declarations) {
    if (decl.kind === 'fn') {
      generateFunction(decl, ctx);
    }
  }
  
  return ctx;
}

function generateFunction(fnDecl, ctx) {
  const fnLabel = ctx.getFunctionLabel(fnDecl.name);
  ctx.emitLabel(fnLabel);
  ctx.currentFunction = fnDecl.name;
  
  // Reset register allocator for this function's scope
  ctx.resetForFunction();
  
  // Allocate registers for parameters (convention: first params in r1, r2, ...)
  // Note: Arguments are passed in registers r1-r6 by caller
  // Parameters are already initialized (have values from caller)
  for (let i = 0; i < fnDecl.params.length && i < 6; i++) {
    const param = fnDecl.params[i];
    ctx.allocRegister(param.name);
    ctx.registerAlloc.markInitialized(param.name);  // Parameters have values
  }
  
  // DON'T pre-allocate local variables - let them be allocated on-demand
  // during initialization. This allows proper spilling of initialized vars.
  
  // Generate function body in source order (statements include let declarations)
  // This preserves the execution order: arr[0]=10 before let a=arr[0]
  for (const stmt of fnDecl.body.statements) {
    generateStatement(stmt, ctx);
  }
  
  // For main function, add implicit HALT at end (for process exit)
  // This ensures the program exits cleanly even without explicit return
  if (fnDecl.name === 'main') {
    ctx.emitInstruction(
      encodeHalt(),
      'halt ; implicit exit'
    );
  } else {
    // For non-main functions, add implicit RET if function is void
    // or if the last statement wasn't a return
    const lastStmt = fnDecl.body.statements[fnDecl.body.statements.length - 1];
    if (!lastStmt || lastStmt.kind !== 'return') {
      ctx.emitInstruction(
        encodeRet(),
        'ret ; implicit return'
      );
    }
  }
  
  ctx.currentFunction = null;
}

function generateDeclaration(decl, ctx) {
  // For complex expressions, we need to evaluate first, then assign to variable
  // This avoids issues where evaluating the expression evicts the target variable
  
  // Check for type conversion: target type is int but expression is float
  const exprIsFloat = isFloatExpression(decl.value, ctx);
  const needsFloatToInt = decl.type === 'int' && exprIsFloat;
  
  if (needsFloatToInt) {
    // Handle implicit float-to-int conversion
    generateFloatToIntDeclaration(decl, ctx);
    return;
  }
  
  if (decl.value.kind === 'cast') {
    // Handle explicit type conversion expression
    generateCastDeclaration(decl, ctx);
    return;
  }
  
  if (decl.value.kind === 'literal') {
    // Simple case: allocate register and assign directly
    if (decl.value.type === 'float') {
      // Float literal - use XMM registers
      const xmm = ctx.allocFloatRegister(decl.name);
      ctx.emitFloatLoadImm(xmm, decl.value.value, decl.name);
      ctx.markFloatInitialized(decl.name);
    } else {
      // Integer or other type
      const reg = ctx.allocRegister(decl.name);
      if (decl.value.type === 'string') {
        const label = ctx.addString(decl.value.value);
        ctx.emitInstruction(
          encodeMovLabel(reg),
          `mov r${reg}, @${label} ; ${decl.name}`
        );
      } else if (decl.value.type === 'int') {
        ctx.emitInstruction(
          encodeMovImmediate(reg, decl.value.value),
          `mov r${reg}, #${decl.value.value} ; ${decl.name}`
        );
      }
      ctx.registerAlloc.markInitialized(decl.name);
    }
  } else if (decl.value.kind === 'array_literal') {
    // Array literal: store elements to stack slots
    ctx.currentArrayName = decl.name;
    generateArrayLiteral(decl.value, ctx);
    ctx.currentArrayName = null;
    // Array variable itself doesn't need a register - it's addressed by base slot
  } else if (decl.value.kind === 'binary') {
    // Check if this is a float expression
    const isFloat = isFloatExpression(decl.value, ctx);
    
    if (isFloat) {
      // Use generateFloatExpr for all float expressions including math_call
      const tempXmm = generateFloatExpr(decl.value, ctx);
      const xmm = ctx.allocFloatRegister(decl.name);
      if (xmm !== tempXmm) {
        ctx.emitInstruction(
          encodeFMovReg(xmm, tempXmm),
          `fmov xmm${xmm}, xmm${tempXmm} ; ${decl.name}`
        );
      }
      if (tempXmm >= 6) ctx.releaseFloatTemp(tempXmm);
      ctx.markFloatInitialized(decl.name);
    } else {
      // Integer binary expression
      const tempReg = ctx.allocTemp();
      generateBinaryInto(decl.value, tempReg, ctx);
      
      // Now allocate the actual variable register
      const reg = ctx.allocRegister(decl.name);
      if (reg !== tempReg) {
        ctx.emitInstruction(
          encodeMovRegister(reg, tempReg),
          `mov r${reg}, r${tempReg} ; ${decl.name}`
        );
      }
      ctx.releaseTemp(tempReg);
      ctx.registerAlloc.markInitialized(decl.name);
    }
  } else if (decl.value.kind === 'call') {
    // Handle function call (e.g., let sum: int = add(x, y))
    const resultReg = generateCallExpr(decl.value, ctx);
    const reg = ctx.allocRegister(decl.name);
    if (resultReg !== reg) {
      ctx.emitInstruction(
        encodeMovRegister(reg, resultReg),
        `mov r${reg}, r${resultReg} ; ${decl.name} = ${decl.value.functionName}(...)`
      );
    }
    ctx.registerAlloc.markInitialized(decl.name);
  } else if (decl.value.kind === 'variable') {
    // Handle variable reference (e.g., let copy: int = original)
    // Check if source is float (in register OR on stack)
    if (ctx.hasFloatVar(decl.value.name)) {
      const srcXmm = ctx.getFloatRegister(decl.value.name);
      const xmm = ctx.allocFloatRegister(decl.name);
      if (srcXmm !== xmm) {
        ctx.emitInstruction(
          encodeFMovReg(xmm, srcXmm),
          `fmov xmm${xmm}, xmm${srcXmm} ; ${decl.name} = ${decl.value.name}`
        );
      }
      ctx.markFloatInitialized(decl.name);
    } else {
      const srcReg = ctx.getRegister(decl.value.name);
      const reg = ctx.allocRegister(decl.name);
      if (srcReg !== reg) {
        ctx.emitInstruction(
          encodeMovRegister(reg, srcReg),
          `mov r${reg}, r${srcReg} ; ${decl.name} = ${decl.value.name}`
        );
      }
      ctx.registerAlloc.markInitialized(decl.name);
    }
  } else if (decl.value.kind === 'array_access') {
    // Handle array element access (e.g., let x: int = arr[0])
    const resultReg = generateArrayAccess(decl.value, ctx);
    const reg = ctx.allocRegister(decl.name);
    if (resultReg !== reg) {
      ctx.emitInstruction(
        encodeMovRegister(reg, resultReg),
        `mov r${reg}, r${resultReg} ; ${decl.name} = ${decl.value.array.name}[...]`
      );
    }
    ctx.releaseTemp(resultReg);
    ctx.registerAlloc.markInitialized(decl.name);
  } else if (decl.value.kind === 'math_call') {
    // Handle math function call (e.g., let result: float = sqrt(x))
    const resultXmm = generateMathCall(decl.value, ctx);
    const xmm = ctx.allocFloatRegister(decl.name);
    if (xmm !== resultXmm) {
      ctx.emitInstruction(
        encodeFMovReg(xmm, resultXmm),
        `fmov xmm${xmm}, xmm${resultXmm} ; ${decl.name} = ${decl.value.func}(...)`
      );
    }
    if (resultXmm >= 6) ctx.releaseFloatTemp(resultXmm);
    ctx.markFloatInitialized(decl.name);
  } else if (decl.value.kind === 'spawn') {
    // Handle spawn expression (e.g., let t: thread = spawn worker())
    const funcName = decl.value.funcName;
    const reg = ctx.allocRegister(decl.name);
    const funcLabel = `fn_${funcName}`;
    
    // Generate SPAWN instruction: handle goes into reg
    // The jumpTarget is used by native compiler to resolve function address
    const bytes = encodeSpawn(reg, funcLabel);
    ctx.instructions.push({
      bytes: bytes,
      comment: `spawn r${reg}, ${funcName} ; ${decl.name} = spawn ${funcName}()`,
      jumpTarget: funcLabel,
    });
    ctx.registerAlloc.markInitialized(decl.name);
  } else if (decl.value.kind === 'atomic_load') {
    // Handle atomic load expression (e.g., let val: int = atomic.load(counter))
    const resultReg = generateAtomicLoad(decl.value, ctx);
    const reg = ctx.allocRegister(decl.name);
    if (resultReg !== reg) {
      ctx.emitInstruction(
        encodeMovRegister(reg, resultReg),
        `mov r${reg}, r${resultReg} ; ${decl.name} = atomic.load(${decl.value.sharedVar})`
      );
    }
    ctx.releaseTemp(resultReg);
    ctx.registerAlloc.markInitialized(decl.name);
  } else if (decl.value.kind === 'input') {
    // Handle input expression (e.g., let x: int = input())
    const resultReg = generateInput(decl.value, ctx);
    const reg = ctx.allocRegister(decl.name);
    if (resultReg !== reg) {
      ctx.emitInstruction(
        encodeMovRegister(reg, resultReg),
        `mov r${reg}, r${resultReg} ; ${decl.name} = input()`
      );
    }
    ctx.releaseTemp(resultReg);
    ctx.registerAlloc.markInitialized(decl.name);
  }
}

// Helper to check if an expression involves floats
function isFloatExpression(expr, ctx) {
  if (expr.kind === 'literal') {
    return expr.type === 'float';
  }
  if (expr.kind === 'variable') {
    // Check if in register OR on stack
    return ctx.hasFloatVar(expr.name);
  }
  if (expr.kind === 'binary') {
    return isFloatExpression(expr.left, ctx) || isFloatExpression(expr.right, ctx);
  }
  if (expr.kind === 'cast') {
    return expr.targetType === 'float';
  }
  if (expr.kind === 'math_call') {
    return true;  // Math functions always return float
  }
  return false;
}

// Generate float-to-int conversion for a declaration
// When we have: let result: int = floatExpr
function generateFloatToIntDeclaration(decl, ctx) {
  // First evaluate the float expression
  let srcXmm;
  if (decl.value.kind === 'variable') {
    srcXmm = ctx.getFloatRegister(decl.value.name);
  } else if (decl.value.kind === 'binary') {
    srcXmm = ctx.allocFloatTemp();
    generateFloatBinaryInto(decl.value, srcXmm, ctx);
  } else if (decl.value.kind === 'literal' && decl.value.type === 'float') {
    srcXmm = ctx.allocFloatTemp();
    ctx.emitFloatLoadImm(srcXmm, decl.value.value, '');
  }
  
  // Convert float to int
  const reg = ctx.allocRegister(decl.name);
  ctx.emitInstruction(
    encodeCvtSD2SI(reg, srcXmm),
    `cvtsd2si r${reg}, xmm${srcXmm} ; ${decl.name} = (int)float`
  );
  ctx.registerAlloc.markInitialized(decl.name);
  
  // Release temp if needed
  if (decl.value.kind !== 'variable') {
    ctx.releaseFloatTemp(srcXmm);
  }
}

// Generate cast expression declaration
function generateCastDeclaration(decl, ctx) {
  const cast = decl.value;
  
  if (cast.targetType === 'int' && isFloatExpression(cast.sourceExpr, ctx)) {
    // float -> int conversion
    let srcXmm;
    if (cast.sourceExpr.kind === 'variable') {
      srcXmm = ctx.getFloatRegister(cast.sourceExpr.name);
    } else if (cast.sourceExpr.kind === 'binary') {
      srcXmm = ctx.allocFloatTemp();
      generateFloatBinaryInto(cast.sourceExpr, srcXmm, ctx);
    } else if (cast.sourceExpr.kind === 'literal') {
      srcXmm = ctx.allocFloatTemp();
      ctx.emitFloatLoadImm(srcXmm, cast.sourceExpr.value, '');
    }
    
    const reg = ctx.allocRegister(decl.name);
    ctx.emitInstruction(
      encodeCvtSD2SI(reg, srcXmm),
      `cvtsd2si r${reg}, xmm${srcXmm} ; ${decl.name} = (int)${cast.sourceExpr.name || 'expr'}`
    );
    ctx.registerAlloc.markInitialized(decl.name);
    
    if (cast.sourceExpr.kind !== 'variable') {
      ctx.releaseFloatTemp(srcXmm);
    }
  } else if (cast.targetType === 'float' && !isFloatExpression(cast.sourceExpr, ctx)) {
    // int -> float conversion
    let srcReg;
    if (cast.sourceExpr.kind === 'variable') {
      srcReg = ctx.getRegister(cast.sourceExpr.name);
    } else if (cast.sourceExpr.kind === 'literal') {
      srcReg = ctx.allocTemp();
      ctx.emitInstruction(
        encodeMovImmediate(srcReg, cast.sourceExpr.value),
        `mov r${srcReg}, #${cast.sourceExpr.value}`
      );
    }
    
    const xmm = ctx.allocFloatRegister(decl.name);
    ctx.emitInstruction(
      encodeCvtSI2SD(xmm, srcReg),
      `cvtsi2sd xmm${xmm}, r${srcReg} ; ${decl.name} = (float)${cast.sourceExpr.name || 'expr'}`
    );
    ctx.markFloatInitialized(decl.name);
    
    if (cast.sourceExpr.kind === 'literal') {
      ctx.releaseTemp(srcReg);
    }
  }
}

// Generate float binary expression into XMM register
// Optimized to minimize temp register usage by computing complex operands first
function generateFloatBinaryInto(expr, destXmm, ctx) {
  // Determine which operand is more complex (needs more temps)
  const leftComplexity = getExprComplexity(expr.left);
  const rightComplexity = getExprComplexity(expr.right);
  
  let leftXmm, rightXmm;
  
  if (rightComplexity > leftComplexity) {
    // Compute right operand first (more complex), into destXmm to avoid extra temp
    if (expr.right.kind === 'binary') {
      generateFloatBinaryInto(expr.right, destXmm, ctx);
      rightXmm = destXmm;
    } else {
      rightXmm = generateFloatExpr(expr.right, ctx);
    }
    // Then compute left operand
    leftXmm = generateFloatExpr(expr.left, ctx);
  } else {
    // Compute left operand first
    leftXmm = generateFloatExpr(expr.left, ctx);
    // Then compute right operand
    rightXmm = generateFloatExpr(expr.right, ctx);
  }
  
  // Emit the operation
  switch (expr.operator) {
    case '+':
      ctx.emitInstruction(
        encodeFAddReg(destXmm, leftXmm, rightXmm),
        `fadd xmm${destXmm}, xmm${leftXmm}, xmm${rightXmm}`
      );
      break;
    case '-':
      ctx.emitInstruction(
        encodeFSubReg(destXmm, leftXmm, rightXmm),
        `fsub xmm${destXmm}, xmm${leftXmm}, xmm${rightXmm}`
      );
      break;
    case '*':
      ctx.emitInstruction(
        encodeFMulReg(destXmm, leftXmm, rightXmm),
        `fmul xmm${destXmm}, xmm${leftXmm}, xmm${rightXmm}`
      );
      break;
    case '/':
      ctx.emitInstruction(
        encodeFDivReg(destXmm, leftXmm, rightXmm),
        `fdiv xmm${destXmm}, xmm${leftXmm}, xmm${rightXmm}`
      );
      break;
    default:
      throw new Error(`Unsupported float operator: ${expr.operator}`);
  }
  
  // Release temps if they were allocated (and different from destXmm)
  if (leftXmm >= 6 && leftXmm !== destXmm) ctx.releaseFloatTemp(leftXmm);
  if (rightXmm >= 6 && rightXmm !== destXmm) ctx.releaseFloatTemp(rightXmm);
}

// Helper to estimate expression complexity (for register allocation optimization)
function getExprComplexity(expr) {
  if (!expr) return 0;
  if (expr.kind === 'literal' || expr.kind === 'variable') return 1;
  if (expr.kind === 'binary') {
    return 1 + Math.max(getExprComplexity(expr.left), getExprComplexity(expr.right));
  }
  if (expr.kind === 'math_call') return 2;
  return 1;
}

// Generate math function call (sqrt, pow, abs, floor, ceil, etc.)
function generateMathCall(expr, ctx) {
  const resultXmm = ctx.allocFloatTemp();
  
  switch (expr.func) {
    case 'sqrt': {
      // sqrt(x) - single argument, use hardware SQRTSD
      const argXmm = generateFloatExpr(expr.args[0], ctx);
      ctx.emitInstruction(
        encodeFSqrt(resultXmm, argXmm),
        `fsqrt xmm${resultXmm}, xmm${argXmm}`
      );
      if (argXmm >= 6) ctx.releaseFloatTemp(argXmm);
      break;
    }
    
    case 'abs': {
      // abs(x) - clear sign bit using ANDPD with mask
      const argXmm = generateFloatExpr(expr.args[0], ctx);
      ctx.emitInstruction(
        encodeFAbs(resultXmm, argXmm),
        `fabs xmm${resultXmm}, xmm${argXmm}`
      );
      if (argXmm >= 6) ctx.releaseFloatTemp(argXmm);
      break;
    }
    
    case 'floor': {
      // floor(x) - round toward negative infinity
      const argXmm = generateFloatExpr(expr.args[0], ctx);
      ctx.emitInstruction(
        encodeFFloor(resultXmm, argXmm),
        `ffloor xmm${resultXmm}, xmm${argXmm}`
      );
      if (argXmm >= 6) ctx.releaseFloatTemp(argXmm);
      break;
    }
    
    case 'ceil': {
      // ceil(x) - round toward positive infinity
      const argXmm = generateFloatExpr(expr.args[0], ctx);
      ctx.emitInstruction(
        encodeFCeil(resultXmm, argXmm),
        `fceil xmm${resultXmm}, xmm${argXmm}`
      );
      if (argXmm >= 6) ctx.releaseFloatTemp(argXmm);
      break;
    }
    
    case 'sin':
    case 'cos':
    case 'tan':
    case 'atan':
    case 'log':
    case 'exp': {
      // These require software implementation or C library
      // For now, emit a runtime call placeholder
      throw new Error(`${expr.func}() is not yet implemented in hardware. Use Taylor series in Aurora code.`);
    }
    
    case 'factorial': {
      // factorial(n) - compute n! as float
      // Generate a loop: result = 1.0; for i = 2 to n: result *= i
      const argExpr = expr.args[0];
      
      if (argExpr.kind === 'literal' && argExpr.type === 'int' && argExpr.value >= 0 && argExpr.value <= 20) {
        // Small literal - compute at compile time
        let result = 1.0;
        for (let i = 2; i <= argExpr.value; i++) {
          result *= i;
        }
        ctx.emitFloatLoadImm(resultXmm, result, ` ; factorial(${argExpr.value}) = ${result}`);
      } else {
        // Runtime factorial - generate loop
        // This is complex, for now throw
        throw new Error('factorial() currently only supports small literal arguments (0-20)');
      }
      break;
    }
    
    case 'pow': {
      // pow(base, exp) - for integer exponent, use repeated multiplication
      const baseXmm = generateFloatExpr(expr.args[0], ctx);
      const expArg = expr.args[1];
      
      if (expArg.kind === 'literal' && expArg.type === 'int' && expArg.value >= 0 && expArg.value <= 10) {
        // Small positive integer exponent - unroll as multiplications
        const n = expArg.value;
        if (n === 0) {
          // x^0 = 1.0
          ctx.emitFloatLoadImm(resultXmm, 1.0, ' ; pow result = 1.0');
        } else if (n === 1) {
          // x^1 = x
          ctx.emitInstruction(
            encodeFMovReg(resultXmm, baseXmm),
            `fmov xmm${resultXmm}, xmm${baseXmm} ; pow(x, 1) = x`
          );
        } else {
          // x^n = x * x * ... (n times)
          ctx.emitInstruction(
            encodeFMovReg(resultXmm, baseXmm),
            `fmov xmm${resultXmm}, xmm${baseXmm} ; pow init`
          );
          for (let i = 1; i < n; i++) {
            ctx.emitInstruction(
              encodeFMulReg(resultXmm, resultXmm, baseXmm),
              `fmul xmm${resultXmm}, xmm${resultXmm}, xmm${baseXmm} ; pow step ${i+1}`
            );
          }
        }
      } else {
        // General case - use loop for integer exponent
        // For now, support only literal integer exponents
        throw new Error('pow() currently only supports small literal integer exponents (0-10)');
      }
      if (baseXmm >= 6) ctx.releaseFloatTemp(baseXmm);
      break;
    }
    
    default:
      throw new Error(`Unknown math function: ${expr.func}`);
  }
  
  return resultXmm;
}

// Generate float expression and return XMM register containing result
function generateFloatExpr(expr, ctx) {
  if (expr.kind === 'literal') {
    if (expr.type === 'float') {
      const xmm = ctx.allocFloatTemp();
      ctx.emitFloatLoadImm(xmm, expr.value, '');
      return xmm;
    } else if (expr.type === 'int') {
      // Convert int to float
      const tempReg = ctx.allocTemp();
      ctx.emitInstruction(
        encodeMovImmediate(tempReg, expr.value),
        `mov r${tempReg}, #${expr.value}`
      );
      const xmm = ctx.allocFloatTemp();
      ctx.emitInstruction(
        encodeCvtSI2SD(xmm, tempReg),
        `cvtsi2sd xmm${xmm}, r${tempReg}`
      );
      ctx.releaseTemp(tempReg);
      return xmm;
    }
  }
  if (expr.kind === 'variable') {
    // Check if it's a float variable (in register OR on stack)
    if (ctx.hasFloatVar(expr.name)) {
      return ctx.getFloatRegister(expr.name);
    } else {
      // Integer variable - convert to float
      const intReg = ctx.getRegister(expr.name);
      const xmm = ctx.allocFloatTemp();
      ctx.emitInstruction(
        encodeCvtSI2SD(xmm, intReg),
        `cvtsi2sd xmm${xmm}, r${intReg} ; convert ${expr.name} to float`
      );
      return xmm;
    }
  }
  if (expr.kind === 'binary') {
    const xmm = ctx.allocFloatTemp();
    generateFloatBinaryInto(expr, xmm, ctx);
    return xmm;
  }
  if (expr.kind === 'math_call') {
    return generateMathCall(expr, ctx);
  }
  throw new Error(`Unsupported float expression kind: ${expr.kind}`);
}

function generateStatement(stmt, ctx) {
  switch (stmt.kind) {
    case 'let':
      generateDeclaration(stmt, ctx);
      break;
    case 'assign':
      generateAssignment(stmt, ctx);
      break;
    case 'array_assign':
      generateArrayAssignment(stmt, ctx);
      break;
    case 'while':
      generateWhile(stmt, ctx);
      break;
    case 'for':
      generateFor(stmt, ctx);
      break;
    case 'if':
      generateIf(stmt, ctx);
      break;
    case 'request':
      generateRequest(stmt, ctx);
      break;
    case 'return':
      generateReturn(stmt, ctx);
      break;
    case 'break':
      generateBreak(stmt, ctx);
      break;
    case 'continue':
      generateContinue(stmt, ctx);
      break;
    case 'join':
      generateJoin(stmt, ctx);
      break;
    case 'atomic_op':
      generateAtomicOp(stmt, ctx);
      break;
    case 'call_stmt':
      generateCallStmt(stmt, ctx);
      break;
    default:
      throw new Error(`Unsupported statement kind: ${stmt.kind}`);
  }
}

function generateAssignment(stmt, ctx) {
  // Check if target is a float variable (in register OR on stack)
  if (ctx.hasFloatVar(stmt.target)) {
    // Float assignment
    generateFloatAssignment(stmt, ctx);
    return;
  }
  
  const targetReg = ctx.getRegister(stmt.target);
  
  // Handle different value expressions
  if (stmt.value.kind === 'binary') {
    // Generate binary operation directly into target register
    generateBinaryInto(stmt.value, targetReg, ctx);
  } else {
    const valueReg = generateExpression(stmt.value, ctx);
    if (valueReg !== targetReg) {
      ctx.emitInstruction(
        encodeMovRegister(targetReg, valueReg),
        `mov r${targetReg}, r${valueReg} ; ${stmt.target} = ...`
      );
    }
  }
}

function generateFloatAssignment(stmt, ctx) {
  const targetXmm = ctx.getFloatRegister(stmt.target);
  
  if (stmt.value.kind === 'literal' && stmt.value.type === 'float') {
    // Float literal assignment
    ctx.emitFloatLoadImm(targetXmm, stmt.value.value, stmt.target);
  } else if (stmt.value.kind === 'variable') {
    // Variable assignment
    if (ctx.hasFloatVar(stmt.value.name)) {
      const srcXmm = ctx.getFloatRegister(stmt.value.name);
      if (srcXmm !== targetXmm) {
        ctx.emitInstruction(
          encodeFMovReg(targetXmm, srcXmm),
          `fmov xmm${targetXmm}, xmm${srcXmm} ; ${stmt.target} = ${stmt.value.name}`
        );
      }
    }
  } else if (stmt.value.kind === 'binary' && isFloatExpression(stmt.value, ctx)) {
    // Float binary expression
    const tempXmm = ctx.allocFloatTemp();
    generateFloatBinaryInto(stmt.value, tempXmm, ctx);
    if (tempXmm !== targetXmm) {
      ctx.emitInstruction(
        encodeFMovReg(targetXmm, tempXmm),
        `fmov xmm${targetXmm}, xmm${tempXmm} ; ${stmt.target}`
      );
    }
    ctx.releaseFloatTemp(tempXmm);
  }
  
  // Mark variable as modified (invalidates stack copy)
  ctx.markFloatInitialized(stmt.target);
}

function generateWhile(stmt, ctx) {
  const condLabel = ctx.generateLabel('while_cond');
  const bodyLabel = ctx.generateLabel('while_body');
  const exitLabel = ctx.generateLabel('while_exit');
  
  // Pre-spill all initialized float variables before entering loop
  // This ensures spill instructions are NOT in the loop body
  ctx.spillAllFloatVars();
  
  // Push loop context for break/continue
  ctx.pushLoop(exitLabel, condLabel);
  
  // Jump to condition check first (proper while semantics)
  ctx.emitInstruction(
    encodeJmp(condLabel),
    `jmp ${condLabel} ; check condition first`
  );
  
  // Body label
  ctx.emitLabel(bodyLabel);
  
  // Generate loop body
  for (const bodyStmt of stmt.body.statements) {
    generateStatement(bodyStmt, ctx);
  }
  
  // Condition check
  ctx.emitLabel(condLabel);
  
  // Generate condition check
  if (stmt.condition.kind === 'binary') {
    // Check if this is a float comparison
    const isFloatComparison = isFloatExpression(stmt.condition.left, ctx) || 
                               isFloatExpression(stmt.condition.right, ctx);
    
    if (isFloatComparison) {
      // Float comparison
      generateWhileFloatCondition(stmt.condition, ctx, bodyLabel, exitLabel);
    } else {
      // Integer comparison
      generateWhileIntCondition(stmt.condition, ctx, bodyLabel, exitLabel);
    }
  } else {
    throw new Error('While condition must be a binary comparison');
  }
  
  ctx.emitLabel(exitLabel);
  
  // Pop loop context
  ctx.popLoop();
}

// Generate float comparison condition for while loop
function generateWhileFloatCondition(condition, ctx, bodyLabel, exitLabel) {
  // Get left operand XMM register
  let leftXmm;
  let leftIsTemp = false;
  if (condition.left.kind === 'variable' && ctx.hasFloatVar(condition.left.name)) {
    leftXmm = ctx.getFloatRegister(condition.left.name);
  } else if (condition.left.kind === 'literal' && (condition.left.type === 'float' || typeof condition.left.value === 'number')) {
    leftXmm = ctx.allocFloatTemp();
    leftIsTemp = true;
    ctx.emitFloatLoadImm(leftXmm, condition.left.value, '');
  } else {
    leftXmm = generateFloatExpr(condition.left, ctx);
    leftIsTemp = true;
  }
  
  // Get right operand XMM register
  let rightXmm;
  let rightIsTemp = false;
  if (condition.right.kind === 'variable' && ctx.hasFloatVar(condition.right.name)) {
    rightXmm = ctx.getFloatRegister(condition.right.name);
  } else if (condition.right.kind === 'literal' && (condition.right.type === 'float' || typeof condition.right.value === 'number')) {
    rightXmm = ctx.allocFloatTemp();
    rightIsTemp = true;
    ctx.emitFloatLoadImm(rightXmm, condition.right.value, '');
  } else {
    rightXmm = generateFloatExpr(condition.right, ctx);
    rightIsTemp = true;
  }
  
  // Emit FCMP instruction
  ctx.emitInstruction(
    encodeFCmp(leftXmm, rightXmm),
    `fcmp xmm${leftXmm}, xmm${rightXmm}`
  );
  
  // Release temps if needed
  if (leftIsTemp) ctx.releaseFloatTemp(leftXmm);
  if (rightIsTemp) ctx.releaseFloatTemp(rightXmm);
  
  // Jump to body if condition is TRUE (opposite of if-statement logic)
  let jumpInstr;
  switch (condition.operator) {
    case '<':
      jumpInstr = encodeCjmpLt(bodyLabel);
      break;
    case '>':
      jumpInstr = encodeCjmpGt(bodyLabel);
      break;
    case '<=':
      jumpInstr = encodeCjmpLeq(bodyLabel);
      break;
    case '>=':
      jumpInstr = encodeCjmpGeq(bodyLabel);
      break;
    case '==':
      jumpInstr = encodeCjmpEq(bodyLabel);
      break;
    case '!=':
      jumpInstr = encodeCjmpNeq(bodyLabel);
      break;
    default:
      throw new Error(`Unsupported comparison operator: ${condition.operator}`);
  }
  
  ctx.emitInstruction(
    jumpInstr,
    `cjmp ${condition.operator}, ${bodyLabel} ; continue loop if true`
  );
  // Fall through to exit if condition is false
}

// Generate integer comparison condition for while loop
function generateWhileIntCondition(condition, ctx, bodyLabel, exitLabel) {
  // Get left operand
  let leftReg;
  if (condition.left.kind === 'variable') {
    leftReg = ctx.getRegister(condition.left.name);
  } else if (condition.left.kind === 'literal') {
    leftReg = ctx.allocTemp();
    ctx.emitInstruction(
      encodeMovImmediate(leftReg, condition.left.value),
      `mov r${leftReg}, #${condition.left.value}`
    );
  } else {
    leftReg = generateIntExpr(condition.left, ctx);
  }
  
  // Compare with right operand
  if (condition.right.kind === 'literal') {
    ctx.emitInstruction(
      encodeCmpRegImm(leftReg, condition.right.value),
      `cmp r${leftReg}, #${condition.right.value}`
    );
  } else if (condition.right.kind === 'variable') {
    const rightReg = ctx.getRegister(condition.right.name);
    ctx.emitInstruction(
      encodeCmpRegReg(leftReg, rightReg),
      `cmp r${leftReg}, r${rightReg}`
    );
  }
  
  // Jump to body if condition is TRUE
  let jumpInstr;
  switch (condition.operator) {
    case '<':
      jumpInstr = encodeCjmpLt(bodyLabel);
      break;
    case '>':
      jumpInstr = encodeCjmpGt(bodyLabel);
      break;
    case '<=':
      jumpInstr = encodeCjmpLeq(bodyLabel);
      break;
    case '>=':
      jumpInstr = encodeCjmpGeq(bodyLabel);
      break;
    case '==':
      jumpInstr = encodeCjmpEq(bodyLabel);
      break;
    case '!=':
      jumpInstr = encodeCjmpNeq(bodyLabel);
      break;
    default:
      throw new Error(`Unsupported comparison operator: ${condition.operator}`);
  }
  
  ctx.emitInstruction(
    jumpInstr,
    `cjmp ${condition.operator}, ${bodyLabel} ; continue loop if true`
  );
  // Fall through to exit if condition is false
}

function generateFor(stmt, ctx) {
  // For loop: for i in start..end { body }
  // Translates to:
  //   i = start
  //   loop:
  //     if i >= end then goto exit (for positive step)
  //     body
  //     i = i + step
  //     goto loop
  //   exit:
  
  const loopLabel = ctx.generateLabel('for_loop');
  const exitLabel = ctx.generateLabel('for_exit');
  const continueLabel = ctx.generateLabel('for_continue');
  
  // Push loop context for break/continue
  ctx.pushLoop(exitLabel, continueLabel);
  
  // Allocate register for loop variable (should already be allocated from declaration)
  const varReg = ctx.getRegister(stmt.varName);
  
  // Initialize: i = start
  if (stmt.start.kind === 'literal') {
    ctx.emitInstruction(
      encodeMovImmediate(varReg, stmt.start.value),
      `mov r${varReg}, #${stmt.start.value} ; ${stmt.varName} = start`
    );
  }
  
  // Loop start
  ctx.emitLabel(loopLabel);
  
  // Condition check: compare i with end
  const endValue = stmt.end.value;
  const stepValue = stmt.step.value;
  
  ctx.emitInstruction(
    encodeCmpRegImm(varReg, endValue),
    `cmp r${varReg}, #${endValue} ; compare with end`
  );
  
  // Jump to exit based on step direction
  if (stepValue > 0) {
    // For positive step, exit when i >= end
    ctx.emitInstruction(
      encodeCjmpGeq(exitLabel),
      `cjmp geq, ${exitLabel} ; exit if i >= end`
    );
  } else {
    // For negative step, exit when i <= end
    ctx.emitInstruction(
      encodeCjmpLeq(exitLabel),
      `cjmp leq, ${exitLabel} ; exit if i <= end`
    );
  }
  
  // Generate loop body
  for (const bodyStmt of stmt.body.statements) {
    generateStatement(bodyStmt, ctx);
  }
  
  // Continue label (for continue statements)
  ctx.emitLabel(continueLabel);
  
  // Increment: i = i + step
  if (stepValue >= 0) {
    ctx.emitInstruction(
      encodeAddRegImm(varReg, varReg, stepValue),
      `add r${varReg}, r${varReg}, #${stepValue} ; i += step`
    );
  } else {
    ctx.emitInstruction(
      encodeSubRegImm(varReg, varReg, -stepValue),
      `sub r${varReg}, r${varReg}, #${-stepValue} ; i -= |step|`
    );
  }
  
  // Jump back to loop start
  ctx.emitInstruction(
    encodeJmp(loopLabel),
    `jmp ${loopLabel}`
  );
  
  // Exit label
  ctx.emitLabel(exitLabel);
  
  // Pop loop context
  ctx.popLoop();
}

function generateBreak(stmt, ctx) {
  const loopCtx = ctx.currentLoop();
  if (!loopCtx) {
    throw new Error('break statement outside of loop');
  }
  
  ctx.emitInstruction(
    encodeJmp(loopCtx.exitLabel),
    `jmp ${loopCtx.exitLabel} ; break`
  );
}

function generateContinue(stmt, ctx) {
  const loopCtx = ctx.currentLoop();
  if (!loopCtx) {
    throw new Error('continue statement outside of loop');
  }
  
  ctx.emitInstruction(
    encodeJmp(loopCtx.continueLabel),
    `jmp ${loopCtx.continueLabel} ; continue`
  );
}

function generateJoin(stmt, ctx) {
  // Get the thread handle register
  const handleReg = ctx.getRegister(stmt.handleName);
  
  // Generate JOIN instruction
  ctx.emitInstruction(
    encodeJoin(handleReg),
    `join r${handleReg} ; join ${stmt.handleName}`
  );
}

function generateAtomicOp(stmt, ctx) {
  const sharedId = ctx.getSharedVarId(stmt.target);
  
  switch (stmt.operation) {
    case 'add': {
      // atomic.add(target, value)
      const valueReg = generateExpression(stmt.value, ctx);
      ctx.emitInstruction(
        encodeAtomicOp(ISA.OPCODE.ATOMIC_ADD, sharedId, valueReg),
        `atomic_add shared[${sharedId}], r${valueReg} ; ${stmt.target} += ...`
      );
      break;
    }
    case 'fadd': {
      // atomic.fadd(target, value) - atomic float add
      // Value should be a float expression
      const srcXmm = generateFloatExpr(stmt.value, ctx);
      ctx.emitInstruction(
        encodeAtomicOp(ISA.OPCODE.ATOMIC_FADD, sharedId, srcXmm),
        `atomic_fadd shared[${sharedId}], xmm${srcXmm} ; ${stmt.target} += (float) ...`
      );
      break;
    }
    case 'sub': {
      // atomic.sub(target, value) - negate and add
      const valueReg = generateExpression(stmt.value, ctx);
      // Negate the value first
      const tempReg = ctx.allocTemp();
      ctx.emitInstruction(
        encodeMovImmediate(tempReg, 0),
        `mov r${tempReg}, 0 ; temp for negation`
      );
      ctx.emitInstruction(
        encodeSub(tempReg, valueReg),
        `sub r${tempReg}, r${valueReg} ; negate`
      );
      ctx.emitInstruction(
        encodeAtomicOp(ISA.OPCODE.ATOMIC_ADD, sharedId, tempReg),
        `atomic_add shared[${sharedId}], r${tempReg} ; ${stmt.target} -= ...`
      );
      ctx.releaseTemp(tempReg);
      break;
    }
    case 'store': {
      // atomic.store(target, value)
      const valueReg = generateExpression(stmt.value, ctx);
      ctx.emitInstruction(
        encodeAtomicOp(ISA.OPCODE.ATOMIC_STORE, sharedId, valueReg),
        `atomic_store shared[${sharedId}], r${valueReg} ; ${stmt.target} = ...`
      );
      break;
    }
    case 'load': {
      // atomic.load(target) - loads into a temp register
      // This should be used in expressions, not as a statement
      throw new Error('atomic.load should be used as an expression, not a statement');
    }
    case 'cas': {
      // atomic.cas(target, expected, new_value)
      // For CAS, we need expected in one register and new value in another
      // Result goes into a status register
      throw new Error('atomic.cas not yet implemented');
    }
    default:
      throw new Error(`Unknown atomic operation: ${stmt.operation}`);
  }
}

// Encode atomic operation instruction
function encodeAtomicOp(opcode, sharedId, srcReg) {
  // Format: opcode, shared_id, src_reg, 0, 0 (using packInstruction format)
  return packInstruction(opcode, sharedId, srcReg, ISA.OPERAND.UNUSED, 0);
}

// Generate call statement (call without using return value)
function generateCallStmt(stmt, ctx) {
  // Check if this is a builtin function that should be a request/SVC
  const builtinServices = ['print', 'print_int', 'print_float', 'exit', 'pause', 'pause_silent', 'input_int'];
  if (builtinServices.includes(stmt.functionName)) {
    // Convert to request statement format and delegate
    const requestStmt = {
      kind: 'request',
      service: stmt.functionName,
      args: stmt.args,
    };
    generateRequest(requestStmt, ctx);
    return;
  }
  
  const fnLabel = ctx.getFunctionLabel(stmt.functionName);
  
  // Generate arguments into registers r1-r6
  for (let i = 0; i < stmt.args.length && i < 6; i++) {
    const argReg = i + 1;  // r1, r2, r3, ...
    const arg = stmt.args[i];
    const valueReg = generateExpression(arg, ctx);
    if (valueReg !== argReg) {
      ctx.emitInstruction(
        encodeMovRegister(argReg, valueReg),
        `mov r${argReg}, r${valueReg} ; arg ${i + 1}`
      );
    }
  }
  
  // Generate call instruction
  ctx.emitInstruction(
    encodeCall(fnLabel),
    `call ${fnLabel} ; ${stmt.functionName}()`
  );
  
  // Return value (if any) is in r0, but we discard it
}

// Generate atomic load expression
function generateAtomicLoad(expr, ctx) {
  const sharedId = ctx.getSharedVarId(expr.sharedVar);
  const destReg = ctx.allocTemp();
  
  // ATOMIC_LOAD format: dest_reg, shared_id (different from other atomic ops)
  ctx.emitInstruction(
    packInstruction(ISA.OPCODE.ATOMIC_LOAD, destReg, sharedId, ISA.OPERAND.UNUSED, 0),
    `atomic_load r${destReg}, shared[${sharedId}] ; ${expr.sharedVar}`
  );
  
  return destReg;
}

// Generate input() expression - reads integer from stdin
function generateInput(expr, ctx) {
  // Emit SVC 0x06 (input_int) - result goes to r0
  ctx.emitInstruction(
    encodeSvc(0x06, ISA.OPERAND.UNUSED),
    `svc 0x06 ; input_int -> r0`
  );
  
  // Result is in r0, but we may need to move it to a temp register
  // if the caller expects a different register
  const destReg = ctx.allocTemp();
  if (destReg !== ISA.REGISTER.r0) {
    ctx.emitInstruction(
      encodeMovRegister(destReg, ISA.REGISTER.r0),
      `mov r${destReg}, r0 ; copy input result`
    );
  }
  
  return destReg;
}

function generateIf(stmt, ctx) {
  const elseLabel = ctx.generateLabel('else');
  const endLabel = ctx.generateLabel('endif');
  
  // Evaluate condition and generate comparison
  if (stmt.condition.kind === 'binary') {
    // Check if this is a float comparison
    const isFloatCmp = isFloatExpression(stmt.condition.left, ctx) || 
                       isFloatExpression(stmt.condition.right, ctx);
    
    if (isFloatCmp) {
      // Float comparison
      generateFloatComparison(stmt, ctx, elseLabel, endLabel);
    } else {
      // Integer comparison
      generateIntegerComparison(stmt, ctx, elseLabel, endLabel);
    }
  } else {
    throw new Error('If condition must be a comparison expression');
  }
  
  // Generate then branch
  for (const thenStmt of stmt.thenBranch.statements) {
    generateStatement(thenStmt, ctx);
  }
  
  if (stmt.elseBranch) {
    ctx.emitInstruction(
      encodeJmp(endLabel),
      `jmp ${endLabel} ; skip else`
    );
    
    ctx.emitLabel(elseLabel);
    
    for (const elseStmt of stmt.elseBranch.statements) {
      generateStatement(elseStmt, ctx);
    }
  }
  
  ctx.emitLabel(endLabel);
}

function generateIntegerComparison(stmt, ctx, elseLabel, endLabel) {
  // Get left operand register (variable or temp)
  let leftReg;
  if (stmt.condition.left.kind === 'variable') {
    leftReg = ctx.getRegister(stmt.condition.left.name);
  } else {
    leftReg = generateExpression(stmt.condition.left, ctx);
  }
  
  // Emit comparison instruction
  if (stmt.condition.right.kind === 'literal') {
    ctx.emitInstruction(
      encodeCmpRegImm(leftReg, stmt.condition.right.value),
      `cmp r${leftReg}, #${stmt.condition.right.value}`
    );
  } else if (stmt.condition.right.kind === 'variable') {
    const rightReg = ctx.getRegister(stmt.condition.right.name);
    ctx.emitInstruction(
      encodeCmpRegReg(leftReg, rightReg),
      `cmp r${leftReg}, r${rightReg}`
    );
  } else {
    const rightReg = generateExpression(stmt.condition.right, ctx);
    ctx.emitInstruction(
      encodeCmpRegReg(leftReg, rightReg),
      `cmp r${leftReg}, r${rightReg}`
    );
    ctx.releaseTemp(rightReg);
  }
  
  // Release left temp if allocated
  if (stmt.condition.left.kind !== 'variable') {
    ctx.releaseTemp(leftReg);
  }
  
  // Determine jump condition based on operator
  // For 'x > 3', if condition is FALSE (x <= 3), jump to else/end
  // CMP sets flags, we need to jump on the NEGATION of the condition
  let jumpInstr;
  switch (stmt.condition.operator) {
    case '>':
      // If NOT greater (less or equal), jump to else/end
      jumpInstr = encodeCjmpLeq(stmt.elseBranch ? elseLabel : endLabel);
      break;
    case '<':
      // If NOT less (greater or equal), jump to else/end
      jumpInstr = encodeCjmpGeq(stmt.elseBranch ? elseLabel : endLabel);
      break;
    case '>=':
      // If NOT greater-or-equal (less), jump to else/end
      jumpInstr = encodeCjmpLt(stmt.elseBranch ? elseLabel : endLabel);
      break;
    case '<=':
      // If NOT less-or-equal (greater), jump to else/end
      jumpInstr = encodeCjmpGt(stmt.elseBranch ? elseLabel : endLabel);
      break;
    case '==':
      // If NOT equal, jump to else/end
      jumpInstr = encodeCjmpNeq(stmt.elseBranch ? elseLabel : endLabel);
      break;
    case '!=':
      // If equal, jump to else/end
      jumpInstr = encodeCjmpEq(stmt.elseBranch ? elseLabel : endLabel);
      break;
    default:
      throw new Error(`Unsupported comparison operator: ${stmt.condition.operator}`);
  }
  
  ctx.emitInstruction(
    jumpInstr,
    `cjmp (negated ${stmt.condition.operator}), ${stmt.elseBranch ? elseLabel : endLabel}`
  );
}

function generateFloatComparison(stmt, ctx, elseLabel, endLabel) {
  // Get left operand XMM register
  let leftXmm;
  if (stmt.condition.left.kind === 'variable' && ctx.hasFloatVar(stmt.condition.left.name)) {
    leftXmm = ctx.getFloatRegister(stmt.condition.left.name);
  } else if (stmt.condition.left.kind === 'literal' && stmt.condition.left.type === 'float') {
    leftXmm = ctx.allocFloatTemp();
    ctx.emitFloatLoadImm(leftXmm, stmt.condition.left.value, '');
  } else {
    leftXmm = generateFloatExpr(stmt.condition.left, ctx);
  }
  
  // Get right operand XMM register
  let rightXmm;
  if (stmt.condition.right.kind === 'variable' && ctx.hasFloatVar(stmt.condition.right.name)) {
    rightXmm = ctx.getFloatRegister(stmt.condition.right.name);
  } else if (stmt.condition.right.kind === 'literal' && stmt.condition.right.type === 'float') {
    rightXmm = ctx.allocFloatTemp();
    ctx.emitFloatLoadImm(rightXmm, stmt.condition.right.value, '');
  } else {
    rightXmm = generateFloatExpr(stmt.condition.right, ctx);
  }
  
  // Emit FCMP instruction
  ctx.emitInstruction(
    encodeFCmp(leftXmm, rightXmm),
    `fcmp xmm${leftXmm}, xmm${rightXmm}`
  );
  
  // Release temps if needed
  if (stmt.condition.left.kind === 'literal' || 
      (stmt.condition.left.kind === 'variable' && !ctx.hasFloatVar(stmt.condition.left.name))) {
    ctx.releaseFloatTemp(leftXmm);
  }
  if (stmt.condition.right.kind === 'literal' ||
      (stmt.condition.right.kind === 'variable' && !ctx.hasFloatVar(stmt.condition.right.name))) {
    ctx.releaseFloatTemp(rightXmm);
  }
  
  // Determine jump condition based on operator
  // Same logic as integer comparison
  let jumpInstr;
  switch (stmt.condition.operator) {
    case '>':
      jumpInstr = encodeCjmpLeq(stmt.elseBranch ? elseLabel : endLabel);
      break;
    case '<':
      jumpInstr = encodeCjmpGeq(stmt.elseBranch ? elseLabel : endLabel);
      break;
    case '>=':
      jumpInstr = encodeCjmpLt(stmt.elseBranch ? elseLabel : endLabel);
      break;
    case '<=':
      jumpInstr = encodeCjmpGt(stmt.elseBranch ? elseLabel : endLabel);
      break;
    case '==':
      jumpInstr = encodeCjmpNeq(stmt.elseBranch ? elseLabel : endLabel);
      break;
    case '!=':
      jumpInstr = encodeCjmpEq(stmt.elseBranch ? elseLabel : endLabel);
      break;
    default:
      throw new Error(`Unsupported comparison operator: ${stmt.condition.operator}`);
  }
  
  ctx.emitInstruction(
    jumpInstr,
    `cjmp (negated ${stmt.condition.operator}), ${stmt.elseBranch ? elseLabel : endLabel}`
  );
}

function generateRequest(stmt, ctx) {
  const serviceMap = {
    print: 0x01,          // print string (legacy)
    exit: 0x02,
    pause: 0x03,          // Wait for key press, show exit code
    pause_silent: 0x04,   // Wait for key press without message
    print_int: 0x05,      // print integer
    input_int: 0x06,      // read integer
    print_float: 0x07,    // print float
  };
  
  // Determine actual service based on argument type
  let actualService = stmt.service;
  
  if (stmt.service === 'print' && stmt.args.length > 0) {
    const arg = stmt.args[0];
    // Detect argument type for print
    if (arg.kind === 'literal' && arg.type === 'string') {
      actualService = 'print';  // string print
    } else if (arg.kind === 'literal' && arg.type === 'int') {
      actualService = 'print_int';
    } else if (arg.kind === 'literal' && arg.type === 'float') {
      actualService = 'print_float';
    } else if (arg.kind === 'variable') {
      // Check variable type
      if (arg.type === 'string') {
        actualService = 'print';
      } else if (ctx.hasFloatVar(arg.name)) {
        actualService = 'print_float';
      } else {
        actualService = 'print_int';
      }
    } else if (isFloatExpression(arg, ctx)) {
      // Float expression
      actualService = 'print_float';
    } else {
      // Expression result - assume int
      actualService = 'print_int';
    }
  }
  
  const serviceCode = serviceMap[actualService];
  if (serviceCode === undefined) {
    throw new Error(`Unknown service: ${actualService}`);
  }
  
  // Track string label for print service
  let stringLabel = null;
  
  // Move argument to r0/r1/xmm6 (service convention)
  // Use xmm6 for float to avoid clobbering user variables in xmm0-xmm5
  if (stmt.args.length > 0) {
    const arg = stmt.args[0];
    
    if (actualService === 'print_float') {
      // Float argument - put in xmm6 (temp register, won't clobber user vars)
      if (arg.kind === 'literal' && arg.type === 'float') {
        ctx.emitFloatLoadImm(6, arg.value, `; load ${arg.value} to xmm6 for print`);
      } else if (arg.kind === 'variable' && ctx.hasFloatVar(arg.name)) {
        const srcXmm = ctx.getFloatRegister(arg.name);
        ctx.emitInstruction(
          encodeFMovReg(6, srcXmm),
          `fmov xmm6, xmm${srcXmm} ; copy for print`
        );
      } else if (arg.kind === 'binary' && isFloatExpression(arg, ctx)) {
        generateFloatBinaryInto(arg, 6, ctx);
      } else if (arg.kind === 'math_call') {
        // Math function call result - generate and put in xmm6
        const resultXmm = generateMathCall(arg, ctx);
        ctx.emitInstruction(
          encodeFMovReg(6, resultXmm),
          `fmov xmm6, xmm${resultXmm} ; ${arg.func} result for print`
        );
        if (resultXmm >= 6) ctx.releaseFloatTemp(resultXmm);
      } else {
        throw new Error(`Cannot print non-float as float: ${arg.kind}`);
      }
    } else if (arg.kind === 'literal' && arg.type === 'string') {
      // String literal - load address into r1 for print service
      stringLabel = ctx.addString(arg.value);
      ctx.emitInstruction(
        encodeMovLabel(ISA.REGISTER.r1),
        `mov r1, @${stringLabel}`
      );
    } else if (arg.kind === 'literal' && arg.type === 'int') {
      // Direct immediate to r0
      ctx.emitInstruction(
        encodeMovImmediate(ISA.REGISTER.r0, arg.value),
        `mov r0, #${arg.value}`
      );
    } else if (arg.kind === 'variable') {
      // Check if this is a float variable first
      if (ctx.hasFloatVar(arg.name)) {
        // Float variable - this should have been handled by print_float path
        // If we get here with a float var and non-float service, error
        if (actualService !== 'print_float') {
          throw new Error(`Float variable ${arg.name} requires print_float service`);
        }
        // Already handled in print_float section above, shouldn't reach here
      } else {
        const argReg = ctx.getRegister(arg.name);
        
        // Special handling for print service - string should stay in r1
        if (actualService === 'print' && arg.type === 'string') {
          // String address should already be in the variable's register
          // Move to r1 if not already there
          if (argReg !== ISA.REGISTER.r1) {
            ctx.emitInstruction(
              encodeMovRegister(ISA.REGISTER.r1, argReg),
              `mov r1, r${argReg}`
            );
          }
        } else if (argReg !== ISA.REGISTER.r0) {
          ctx.emitInstruction(
            encodeMovRegister(ISA.REGISTER.r0, argReg),
            `mov r0, r${argReg}`
          );
        }
      }
    } else {
      // Expression - evaluate to temp register (don't modify original variable registers)
      const tempReg = ctx.allocTemp();
      if (arg.kind === 'binary') {
        generateBinaryInto(arg, tempReg, ctx);
      } else {
        const argReg = generateExpression(arg, ctx);
        if (argReg !== tempReg) {
          ctx.emitInstruction(
            encodeMovRegister(tempReg, argReg),
            `mov r${tempReg}, r${argReg}`
          );
        }
      }
      if (tempReg !== ISA.REGISTER.r0) {
        ctx.emitInstruction(
          encodeMovRegister(ISA.REGISTER.r0, tempReg),
          `mov r0, r${tempReg}`
        );
      }
      ctx.releaseTemp(tempReg);
    }
  }
  
  // Emit SVC instruction
  // For write service, op1=0x01 (stdout)
  const op1 = (actualService === 'print') ? 0x01 : ISA.OPERAND.UNUSED;
  
  const svcInstr = {
    bytes: encodeSvc(serviceCode, op1),
    comment: `svc 0x${serviceCode.toString(16).padStart(2, '0')}`
  };
  
  // Attach string label metadata for native compiler
  if (stringLabel) {
    svcInstr._lastStringInR1 = stringLabel;
  }
  
  ctx.instructions.push(svcInstr);
}

function generateReturn(stmt, ctx) {
  // Generate return value into r0 (return value convention)
  if (stmt.value) {
    const valueReg = generateExpression(stmt.value, ctx);
    if (valueReg !== ISA.REGISTER.r0) {
      ctx.emitInstruction(
        encodeMovRegister(ISA.REGISTER.r0, valueReg),
        `mov r0, r${valueReg} ; return value`
      );
    }
    // Release temp if allocated
    if (stmt.value.kind !== 'variable') {
      ctx.releaseTemp(valueReg);
    }
  }
  
  // If we're in main function, emit HALT (process exit with return value as exit code)
  if (ctx.currentFunction === 'main') {
    ctx.emitInstruction(
      encodeHalt(),
      'halt ; exit with return value'
    );
  } else if (ctx.currentFunction) {
    // For other functions, emit RET instruction
    ctx.emitInstruction(
      encodeRet(),
      'ret ; return from function'
    );
  }
}

function generateExpression(expr, ctx) {
  switch (expr.kind) {
    case 'literal':
      // For immediate values, allocate a temporary register
      if (expr.type === 'int') {
        const tempReg = ctx.allocTemp();
        ctx.emitInstruction(
          encodeMovImmediate(tempReg, expr.value),
          `mov r${tempReg}, #${expr.value}`
        );
        return tempReg;
      }
      break;
      
    case 'variable':
      return ctx.getRegister(expr.name);
      
    case 'binary':
      return generateBinary(expr, ctx);
      
    case 'unary':
      return generateUnary(expr, ctx);
      
    case 'call':
      return generateCallExpr(expr, ctx);
      
    case 'array_literal':
      return generateArrayLiteral(expr, ctx);
      
    case 'array_access':
      return generateArrayAccess(expr, ctx);
      
    case 'atomic_load':
      return generateAtomicLoad(expr, ctx);
      
    case 'input':
      return generateInput(expr, ctx);
      
    default:
      throw new Error(`Unsupported expression kind: ${expr.kind}`);
  }
}

function generateCallExpr(expr, ctx) {
  // Calling convention:
  // - Arguments are passed in r1, r2, r3, r4, r5 (up to 5 args)
  // - Return value is in r0
  // - Caller saves r1-r5 if needed (we'll implement simple version first)
  
  // Move arguments into argument registers
  for (let i = 0; i < expr.args.length && i < 5; i++) {
    const arg = expr.args[i];
    const argReg = i + 1;  // r1, r2, r3, r4, r5
    
    if (arg.kind === 'literal' && arg.type === 'int') {
      ctx.emitInstruction(
        encodeMovImmediate(argReg, arg.value),
        `mov r${argReg}, #${arg.value} ; arg${i}`
      );
    } else if (arg.kind === 'variable') {
      const srcReg = ctx.getRegister(arg.name);
      if (srcReg !== argReg) {
        ctx.emitInstruction(
          encodeMovRegister(argReg, srcReg),
          `mov r${argReg}, r${srcReg} ; arg${i}`
        );
      }
    } else {
      const srcReg = generateExpression(arg, ctx);
      if (srcReg !== argReg) {
        ctx.emitInstruction(
          encodeMovRegister(argReg, srcReg),
          `mov r${argReg}, r${srcReg} ; arg${i}`
        );
      }
      ctx.releaseTemp(srcReg);
    }
  }
  
  // Emit CALL instruction
  const fnLabel = ctx.getFunctionLabel(expr.functionName);
  if (!fnLabel) {
    throw new Error(`Unknown function: ${expr.functionName}`);
  }
  
  ctx.emitInstruction(
    encodeCall(fnLabel),
    `call ${fnLabel}`
  );
  
  // Return value is in r0
  // For now, we'll return r0 directly - caller needs to save it if needed
  return ISA.REGISTER.r0;
}

function generateUnary(expr, ctx) {
  // Generate unary operation
  const operandReg = generateExpression(expr.operand, ctx);
  const resultReg = ctx.allocTemp();
  
  switch (expr.operator) {
    case '-':
      // Negate: result = 0 - operand
      ctx.emitInstruction(
        encodeMovImmediate(resultReg, 0),
        `mov r${resultReg}, #0`
      );
      ctx.emitInstruction(
        encodeSubRegReg(resultReg, resultReg, operandReg),
        `sub r${resultReg}, r${resultReg}, r${operandReg} ; negate`
      );
      break;
      
    case '!':
      // Logical NOT: result = (operand == 0) ? 1 : 0
      // We use XOR with 1 for boolean not (assuming 0/1 values)
      ctx.emitInstruction(
        encodeXorRegImm(resultReg, operandReg, 1),
        `xor r${resultReg}, r${operandReg}, #1 ; logical not`
      );
      break;
      
    case '~':
      // Bitwise NOT
      ctx.emitInstruction(
        encodeNotReg(resultReg, operandReg),
        `not r${resultReg}, r${operandReg} ; bitwise not`
      );
      break;
      
    default:
      throw new Error(`Unsupported unary operator: ${expr.operator}`);
  }
  
  // Release operand temp if it was allocated
  if (expr.operand.kind !== 'variable') {
    ctx.releaseTemp(operandReg);
  }
  
  return resultReg;
}

function generateUnaryInto(expr, destReg, ctx) {
  // Generate unary operation directly into destination register
  let operandReg;
  
  if (expr.operand.kind === 'variable') {
    operandReg = ctx.getRegister(expr.operand.name);
  } else if (expr.operand.kind === 'literal') {
    operandReg = ctx.allocTemp();
    ctx.emitInstruction(
      encodeMovImmediate(operandReg, expr.operand.value),
      `mov r${operandReg}, #${expr.operand.value}`
    );
  } else if (expr.operand.kind === 'binary') {
    operandReg = ctx.allocTemp();
    generateBinaryInto(expr.operand, operandReg, ctx);
  } else if (expr.operand.kind === 'unary') {
    operandReg = ctx.allocTemp();
    generateUnaryInto(expr.operand, operandReg, ctx);
  }
  
  switch (expr.operator) {
    case '-':
      ctx.emitInstruction(
        encodeMovImmediate(destReg, 0),
        `mov r${destReg}, #0`
      );
      ctx.emitInstruction(
        encodeSubRegReg(destReg, destReg, operandReg),
        `sub r${destReg}, r${destReg}, r${operandReg} ; negate`
      );
      break;
      
    case '!':
      ctx.emitInstruction(
        encodeXorRegImm(destReg, operandReg, 1),
        `xor r${destReg}, r${operandReg}, #1 ; logical not`
      );
      break;
      
    case '~':
      ctx.emitInstruction(
        encodeNotReg(destReg, operandReg),
        `not r${destReg}, r${operandReg} ; bitwise not`
      );
      break;
      
    default:
      throw new Error(`Unsupported unary operator: ${expr.operator}`);
  }
  
  // Release operand temp if it was allocated
  if (expr.operand.kind !== 'variable') {
    ctx.releaseTemp(operandReg);
  }
}

function generateBinaryInto(expr, destReg, ctx) {
  // Generate binary operation directly into destination register
  // Strategy: evaluate left into destReg first, then evaluate right into temp,
  // then combine. This minimizes register pressure for left-associative chains.
  
  // Step 1: Evaluate left operand into destReg
  if (expr.left.kind === 'variable') {
    const leftReg = ctx.getRegister(expr.left.name);
    if (leftReg !== destReg) {
      ctx.emitInstruction(
        encodeMovRegister(destReg, leftReg),
        `mov r${destReg}, r${leftReg}`
      );
    }
  } else if (expr.left.kind === 'literal') {
    ctx.emitInstruction(
      encodeMovImmediate(destReg, expr.left.value),
      `mov r${destReg}, #${expr.left.value}`
    );
  } else if (expr.left.kind === 'binary') {
    generateBinaryInto(expr.left, destReg, ctx);
  } else if (expr.left.kind === 'unary') {
    generateUnaryInto(expr.left, destReg, ctx);
  } else if (expr.left.kind === 'call') {
    const resultReg = generateCallExpr(expr.left, ctx);
    if (resultReg !== destReg) {
      ctx.emitInstruction(
        encodeMovRegister(destReg, resultReg),
        `mov r${destReg}, r${resultReg}`
      );
    }
  }
  
  // Step 2: Handle right operand
  let rightReg = null;
  let rightImm = null;
  let needReleaseRight = false;
  
  if (expr.right.kind === 'variable') {
    rightReg = ctx.getRegister(expr.right.name);
  } else if (expr.right.kind === 'literal' && typeof expr.right.value === 'number') {
    rightImm = expr.right.value;
  } else if (expr.right.kind === 'binary') {
    rightReg = ctx.allocTemp();
    needReleaseRight = true;
    generateBinaryInto(expr.right, rightReg, ctx);
  } else if (expr.right.kind === 'unary') {
    rightReg = ctx.allocTemp();
    needReleaseRight = true;
    generateUnaryInto(expr.right, rightReg, ctx);
  } else if (expr.right.kind === 'call') {
    rightReg = generateCallExpr(expr.right, ctx);
    needReleaseRight = true;
  }
  
  // Step 3: Generate the operation (result goes into destReg)
  switch (expr.operator) {
    case '+':
      if (rightReg !== null) {
        ctx.emitInstruction(
          encodeAddRegReg(destReg, destReg, rightReg),
          `add r${destReg}, r${destReg}, r${rightReg}`
        );
      } else {
        ctx.emitInstruction(
          encodeAddRegImm(destReg, destReg, rightImm),
          `add r${destReg}, r${destReg}, #${rightImm}`
        );
      }
      break;
      
    case '-':
      if (rightReg !== null) {
        ctx.emitInstruction(
          encodeSubRegReg(destReg, destReg, rightReg),
          `sub r${destReg}, r${destReg}, r${rightReg}`
        );
      } else {
        ctx.emitInstruction(
          encodeSubRegImm(destReg, destReg, rightImm),
          `sub r${destReg}, r${destReg}, #${rightImm}`
        );
      }
      break;
    
    case '*':
      if (rightReg !== null) {
        ctx.emitInstruction(
          encodeMulRegReg(destReg, destReg, rightReg),
          `mul r${destReg}, r${destReg}, r${rightReg}`
        );
      } else {
        ctx.emitInstruction(
          encodeMulRegImm(destReg, destReg, rightImm),
          `mul r${destReg}, r${destReg}, #${rightImm}`
        );
      }
      break;
    
    case '/':
      if (rightReg !== null) {
        ctx.emitInstruction(
          encodeDivRegReg(destReg, destReg, rightReg),
          `div r${destReg}, r${destReg}, r${rightReg}`
        );
      } else {
        ctx.emitInstruction(
          encodeDivRegImm(destReg, destReg, rightImm),
          `div r${destReg}, r${destReg}, #${rightImm}`
        );
      }
      break;
    
    case '%':
      if (rightReg !== null) {
        ctx.emitInstruction(
          encodeRemRegReg(destReg, destReg, rightReg),
          `rem r${destReg}, r${destReg}, r${rightReg}`
        );
      } else {
        ctx.emitInstruction(
          encodeRemRegImm(destReg, destReg, rightImm),
          `rem r${destReg}, r${destReg}, #${rightImm}`
        );
      }
      break;
    
    // Bitwise operations
    case '&':
      if (rightReg !== null) {
        ctx.emitInstruction(
          encodeAndRegReg(destReg, destReg, rightReg),
          `and r${destReg}, r${destReg}, r${rightReg}`
        );
      } else {
        ctx.emitInstruction(
          encodeAndRegImm(destReg, destReg, rightImm),
          `and r${destReg}, r${destReg}, #${rightImm}`
        );
      }
      break;
    
    case '|':
      if (rightReg !== null) {
        ctx.emitInstruction(
          encodeOrRegReg(destReg, destReg, rightReg),
          `or r${destReg}, r${destReg}, r${rightReg}`
        );
      } else {
        ctx.emitInstruction(
          encodeOrRegImm(destReg, destReg, rightImm),
          `or r${destReg}, r${destReg}, #${rightImm}`
        );
      }
      break;
    
    case '^':
      if (rightReg !== null) {
        ctx.emitInstruction(
          encodeXorRegReg(destReg, destReg, rightReg),
          `xor r${destReg}, r${destReg}, r${rightReg}`
        );
      } else {
        ctx.emitInstruction(
          encodeXorRegImm(destReg, destReg, rightImm),
          `xor r${destReg}, r${destReg}, #${rightImm}`
        );
      }
      break;
    
    case '<<':
      if (rightReg !== null) {
        ctx.emitInstruction(
          encodeShlRegReg(destReg, destReg, rightReg),
          `shl r${destReg}, r${destReg}, r${rightReg}`
        );
      } else {
        ctx.emitInstruction(
          encodeShlRegImm(destReg, destReg, rightImm),
          `shl r${destReg}, r${destReg}, #${rightImm}`
        );
      }
      break;
    
    case '>>':
      if (rightReg !== null) {
        ctx.emitInstruction(
          encodeShrRegReg(destReg, destReg, rightReg),
          `shr r${destReg}, r${destReg}, r${rightReg}`
        );
      } else {
        ctx.emitInstruction(
          encodeShrRegImm(destReg, destReg, rightImm),
          `shr r${destReg}, r${destReg}, #${rightImm}`
        );
      }
      break;
      
    default:
      throw new Error(`Unsupported binary operator in generateBinaryInto: ${expr.operator}`);
  }
  
  // Release right temp register if we allocated one
  if (needReleaseRight && rightReg !== null) {
    ctx.releaseTemp(rightReg);
  }
}

function generateBinary(expr, ctx) {
  const leftReg = generateExpression(expr.left, ctx);
  const resultReg = leftReg; // Reuse left register
  
  // For comparisons and arithmetic, handle right operand
  let rightReg = null;
  const rightIsLiteral = expr.right.kind === 'literal';
  const rightIsVariable = expr.right.kind === 'variable';
  
  if (!rightIsLiteral) {
    rightReg = generateExpression(expr.right, ctx);
  }
  
  switch (expr.operator) {
    case '+':
      if (rightIsLiteral) {
        ctx.emitInstruction(
          encodeAddRegImm(resultReg, leftReg, expr.right.value),
          `add r${resultReg}, r${leftReg}, #${expr.right.value}`
        );
      } else {
        ctx.emitInstruction(
          encodeAddRegReg(resultReg, leftReg, rightReg),
          `add r${resultReg}, r${leftReg}, r${rightReg}`
        );
      }
      break;
      
    case '-':
      if (rightIsLiteral) {
        ctx.emitInstruction(
          encodeSubRegImm(resultReg, leftReg, expr.right.value),
          `sub r${resultReg}, r${leftReg}, #${expr.right.value}`
        );
      } else {
        ctx.emitInstruction(
          encodeSubRegReg(resultReg, leftReg, rightReg),
          `sub r${resultReg}, r${leftReg}, r${rightReg}`
        );
      }
      break;
      
    case '*':
      if (rightIsLiteral) {
        ctx.emitInstruction(
          encodeMulRegImm(resultReg, leftReg, expr.right.value),
          `mul r${resultReg}, r${leftReg}, #${expr.right.value}`
        );
      } else {
        ctx.emitInstruction(
          encodeMulRegReg(resultReg, leftReg, rightReg),
          `mul r${resultReg}, r${leftReg}, r${rightReg}`
        );
      }
      break;
      
    case '/':
      if (rightIsLiteral) {
        ctx.emitInstruction(
          encodeDivRegImm(resultReg, leftReg, expr.right.value),
          `div r${resultReg}, r${leftReg}, #${expr.right.value}`
        );
      } else {
        ctx.emitInstruction(
          encodeDivRegReg(resultReg, leftReg, rightReg),
          `div r${resultReg}, r${leftReg}, r${rightReg}`
        );
      }
      break;
      
    case '%':
      if (rightIsLiteral) {
        ctx.emitInstruction(
          encodeRemRegImm(resultReg, leftReg, expr.right.value),
          `rem r${resultReg}, r${leftReg}, #${expr.right.value}`
        );
      } else {
        ctx.emitInstruction(
          encodeRemRegReg(resultReg, leftReg, rightReg),
          `rem r${resultReg}, r${leftReg}, r${rightReg}`
        );
      }
      break;
    
    // Bitwise operations
    case '&':
      if (rightIsLiteral) {
        ctx.emitInstruction(
          encodeAndRegImm(resultReg, leftReg, expr.right.value),
          `and r${resultReg}, r${leftReg}, #${expr.right.value}`
        );
      } else {
        ctx.emitInstruction(
          encodeAndRegReg(resultReg, leftReg, rightReg),
          `and r${resultReg}, r${leftReg}, r${rightReg}`
        );
      }
      break;
      
    case '|':
      if (rightIsLiteral) {
        ctx.emitInstruction(
          encodeOrRegImm(resultReg, leftReg, expr.right.value),
          `or r${resultReg}, r${leftReg}, #${expr.right.value}`
        );
      } else {
        ctx.emitInstruction(
          encodeOrRegReg(resultReg, leftReg, rightReg),
          `or r${resultReg}, r${leftReg}, r${rightReg}`
        );
      }
      break;
      
    case '^':
      if (rightIsLiteral) {
        ctx.emitInstruction(
          encodeXorRegImm(resultReg, leftReg, expr.right.value),
          `xor r${resultReg}, r${leftReg}, #${expr.right.value}`
        );
      } else {
        ctx.emitInstruction(
          encodeXorRegReg(resultReg, leftReg, rightReg),
          `xor r${resultReg}, r${leftReg}, r${rightReg}`
        );
      }
      break;
      
    case '<<':
      if (rightIsLiteral) {
        ctx.emitInstruction(
          encodeShlRegImm(resultReg, leftReg, expr.right.value),
          `shl r${resultReg}, r${leftReg}, #${expr.right.value}`
        );
      } else {
        ctx.emitInstruction(
          encodeShlRegReg(resultReg, leftReg, rightReg),
          `shl r${resultReg}, r${leftReg}, r${rightReg}`
        );
      }
      break;
      
    case '>>':
      if (rightIsLiteral) {
        ctx.emitInstruction(
          encodeShrRegImm(resultReg, leftReg, expr.right.value),
          `shr r${resultReg}, r${leftReg}, #${expr.right.value}`
        );
      } else {
        ctx.emitInstruction(
          encodeShrRegReg(resultReg, leftReg, rightReg),
          `shr r${resultReg}, r${leftReg}, r${rightReg}`
        );
      }
      break;
      
    case '>':
    case '<':
    case '>=':
    case '<=':
    case '==':
    case '!=':
      // CMP sets flags, we return the left register
      if (rightIsLiteral) {
        ctx.emitInstruction(
          encodeCmpRegImm(leftReg, expr.right.value),
          `cmp r${leftReg}, #${expr.right.value}`
        );
      } else {
        ctx.emitInstruction(
          encodeCmpRegReg(leftReg, rightReg),
          `cmp r${leftReg}, r${rightReg}`
        );
      }
      break;
      
    // Logical operators with short-circuit evaluation
    case '&&':
      // Short-circuit AND: if left is false (0), skip right evaluation
      // Result is 1 if both are non-zero, else 0
      {
        const endLabel = ctx.nextLabel('and_end');
        const falseLabel = ctx.nextLabel('and_false');
        
        // Check if left is zero (false)
        ctx.emitInstruction(encodeCmpRegImm(leftReg, 0), `cmp r${leftReg}, #0`);
        ctx.emitInstruction(encodeJumpEqual(falseLabel), `je ${falseLabel} ; short-circuit AND`);
        
        // Evaluate right side (already done above since rightReg is computed)
        // Check if right is zero
        if (rightIsLiteral) {
          const tempRight = ctx.allocTemp();
          ctx.emitInstruction(encodeMovImmediate(tempRight, expr.right.value), `mov r${tempRight}, #${expr.right.value}`);
          ctx.emitInstruction(encodeCmpRegImm(tempRight, 0), `cmp r${tempRight}, #0`);
          ctx.releaseTemp(tempRight);
        } else {
          ctx.emitInstruction(encodeCmpRegImm(rightReg, 0), `cmp r${rightReg}, #0`);
        }
        ctx.emitInstruction(encodeJumpEqual(falseLabel), `je ${falseLabel}`);
        
        // Both true: result = 1
        ctx.emitInstruction(encodeMovImmediate(resultReg, 1), `mov r${resultReg}, #1`);
        ctx.emitInstruction(encodeJump(endLabel), `jmp ${endLabel}`);
        
        // False case: result = 0
        ctx.emitLabel(falseLabel);
        ctx.emitInstruction(encodeMovImmediate(resultReg, 0), `mov r${resultReg}, #0`);
        
        ctx.emitLabel(endLabel);
      }
      break;
      
    case '||':
      // Short-circuit OR: if left is true (non-zero), skip right evaluation
      // Result is 1 if either is non-zero, else 0
      {
        const endLabel = ctx.nextLabel('or_end');
        const trueLabel = ctx.nextLabel('or_true');
        
        // Check if left is non-zero (true)
        ctx.emitInstruction(encodeCmpRegImm(leftReg, 0), `cmp r${leftReg}, #0`);
        ctx.emitInstruction(encodeJumpNotEqual(trueLabel), `jne ${trueLabel} ; short-circuit OR`);
        
        // Evaluate right side
        if (rightIsLiteral) {
          const tempRight = ctx.allocTemp();
          ctx.emitInstruction(encodeMovImmediate(tempRight, expr.right.value), `mov r${tempRight}, #${expr.right.value}`);
          ctx.emitInstruction(encodeCmpRegImm(tempRight, 0), `cmp r${tempRight}, #0`);
          ctx.releaseTemp(tempRight);
        } else {
          ctx.emitInstruction(encodeCmpRegImm(rightReg, 0), `cmp r${rightReg}, #0`);
        }
        ctx.emitInstruction(encodeJumpNotEqual(trueLabel), `jne ${trueLabel}`);
        
        // Both false: result = 0
        ctx.emitInstruction(encodeMovImmediate(resultReg, 0), `mov r${resultReg}, #0`);
        ctx.emitInstruction(encodeJump(endLabel), `jmp ${endLabel}`);
        
        // True case: result = 1
        ctx.emitLabel(trueLabel);
        ctx.emitInstruction(encodeMovImmediate(resultReg, 1), `mov r${resultReg}, #1`);
        
        ctx.emitLabel(endLabel);
      }
      break;
      
    default:
      throw new Error(`Unsupported operator: ${expr.operator}`);
  }
  
  // Release right temp if it was allocated
  if (rightReg !== null && !rightIsVariable) {
    ctx.releaseTemp(rightReg);
  }
  
  return resultReg;
}

// =============================================================================
// Array Operations
// =============================================================================

/**
 * Generate code for array literal initialization
 * Array elements are stored sequentially in stack slots
 */
function generateArrayLiteral(expr, ctx) {
  // For array literal, we allocate contiguous stack slots and store elements
  const arrayName = ctx.currentArrayName || `_arr_${ctx.nextArrayId++}`;
  const baseSlot = ctx.allocArraySlots(arrayName, expr.elements.length);
  
  // Store each element to its slot
  for (let i = 0; i < expr.elements.length; i++) {
    const elemExpr = expr.elements[i];
    let valueReg;
    
    if (elemExpr.kind === 'literal') {
      valueReg = ctx.allocTemp();
      ctx.emitInstruction(
        encodeMovImmediate(valueReg, elemExpr.value),
        `mov r${valueReg}, #${elemExpr.value} ; arr[${i}]`
      );
    } else if (elemExpr.kind === 'variable') {
      valueReg = ctx.getRegister(elemExpr.name);
    } else {
      valueReg = generateExpression(elemExpr, ctx);
    }
    
    // Store to stack slot: [RSP + shadow_space + (baseSlot + i) * 8]
    // Shadow space is 32 bytes for Win64
    const slotIndex = baseSlot + i;
    const stackOffset = 32 + slotIndex * 8;  // Convert slot to byte offset
    ctx.emitInstruction(
      encodeStoreStack(valueReg, stackOffset),
      `store [RSP+${stackOffset}], r${valueReg} ; arr[${i}] = ${elemExpr.kind === 'literal' ? elemExpr.value : '...'}`
    );
    
    if (elemExpr.kind === 'literal') {
      ctx.releaseTemp(valueReg);
    }
  }
  
  // For array variables, we don't need a result register - just track the base slot
  return null;
}

/**
 * Generate code for array element access: arr[index]
 */
function generateArrayAccess(expr, ctx) {
  // Get array base slot from context
  const arrayName = expr.array.name;
  const baseSlot = ctx.getArrayBaseSlot(arrayName);
  
  if (baseSlot === undefined) {
    throw new Error(`Unknown array: ${arrayName}`);
  }
  
  // Evaluate index expression
  let indexReg;
  let needReleaseIndex = false;
  
  if (expr.index.kind === 'literal') {
    // Static index - we can calculate the stack offset directly
    const staticIndex = expr.index.value;
    const slotIndex = baseSlot + staticIndex;
    const stackOffset = 32 + slotIndex * 8;  // Shadow space + slot * 8
    const resultReg = ctx.allocTemp();
    
    ctx.emitInstruction(
      encodeLoadStack(resultReg, stackOffset),
      `load r${resultReg}, [RSP+${stackOffset}] ; ${arrayName}[${staticIndex}]`
    );
    
    return resultReg;
  } else {
    // Dynamic index - need to compute slot at runtime
    indexReg = generateExpression(expr.index, ctx);
    needReleaseIndex = true;
  }
  
  // For dynamic indexing, we need:
  // 1. Add baseSlot to index to get actual slot
  // 2. Use ARRAY_LOAD instruction
  const resultReg = ctx.allocTemp();
  
  ctx.emitInstruction(
    encodeArrayLoad(resultReg, baseSlot, indexReg),
    `array_load r${resultReg}, [base ${baseSlot} + r${indexReg}] ; ${arrayName}[...]`
  );
  
  if (needReleaseIndex) {
    ctx.releaseTemp(indexReg);
  }
  
  return resultReg;
}

/**
 * Generate code for array element assignment: arr[index] = value
 */
function generateArrayAssignment(stmt, ctx) {
  const arrayName = stmt.arrayName;
  const baseSlot = ctx.getArrayBaseSlot(arrayName);
  
  if (baseSlot === undefined) {
    throw new Error(`Unknown array: ${arrayName}`);
  }
  
  // Evaluate value expression first
  let valueReg;
  if (stmt.value.kind === 'literal') {
    valueReg = ctx.allocTemp();
    ctx.emitInstruction(
      encodeMovImmediate(valueReg, stmt.value.value),
      `mov r${valueReg}, #${stmt.value.value}`
    );
  } else if (stmt.value.kind === 'variable') {
    valueReg = ctx.getRegister(stmt.value.name);
  } else {
    valueReg = generateExpression(stmt.value, ctx);
  }
  
  // Handle index
  if (stmt.index.kind === 'literal') {
    // Static index
    const staticIndex = stmt.index.value;
    const slotIndex = baseSlot + staticIndex;
    const stackOffset = 32 + slotIndex * 8;  // Shadow space + slot * 8
    
    ctx.emitInstruction(
      encodeStoreStack(valueReg, stackOffset),
      `store [RSP+${stackOffset}], r${valueReg} ; ${arrayName}[${staticIndex}] = ...`
    );
  } else {
    // Dynamic index
    const indexReg = generateExpression(stmt.index, ctx);
    
    ctx.emitInstruction(
      encodeArrayStore(baseSlot, indexReg, valueReg),
      `array_store [base ${baseSlot} + r${indexReg}], r${valueReg} ; ${arrayName}[...] = ...`
    );
    
    ctx.releaseTemp(indexReg);
  }
  
  if (stmt.value.kind === 'literal') {
    ctx.releaseTemp(valueReg);
  }
}

// Encoding helpers for array operations
function encodeArrayLoad(destReg, baseSlot, indexReg) {
  // ARRAY_LOAD: opcode dest, base_slot, index_reg
  return packInstruction(ISA.OPCODE.ARRAY_LOAD, destReg, baseSlot, indexReg, 0);
}

function encodeArrayStore(baseSlot, indexReg, valueReg) {
  // ARRAY_STORE: opcode base_slot, index_reg, value_reg
  return packInstruction(ISA.OPCODE.ARRAY_STORE, baseSlot, indexReg, valueReg, 0);
}

// =============================================================================
// Manifest Emission
// =============================================================================

function emitManifest(ctx, sourceFile) {
  const lines = [];
  
  lines.push('# Aurora minimal ISA manifest (Stage N1 pipeline output)');
  lines.push(`# Generated from: ${sourceFile}`);
  lines.push('');
  
  // Emit stack frame size directive
  const stackFrameSize = ctx.getStackFrameSize();
  if (stackFrameSize > 0) {
    lines.push(`# Stack frame size: ${stackFrameSize} bytes`);
    lines.push(`stack_size ${stackFrameSize}`);
    lines.push('');
  }
  
  // Emit shared variable declarations
  if (ctx.sharedVars && ctx.sharedVars.size > 0) {
    lines.push('# Shared variables');
    for (const [name, info] of ctx.sharedVars) {
      let initVal = info.initialValue && info.initialValue.value !== undefined 
        ? info.initialValue.value 
        : 0;
      
      // For float types, convert to IEEE 754 bit representation
      if (info.type === 'float' || info.type === 'f64') {
        const floatBuf = Buffer.alloc(8);
        floatBuf.writeDoubleLE(initVal);
        initVal = floatBuf.readBigUInt64LE();
      }
      
      lines.push(`shared ${info.id} ${name} ${initVal}`);
    }
    lines.push('');
  }
  
  // Emit instructions with comments
  for (const instr of ctx.instructions) {
    if (instr.comment) {
      lines.push(`bytes ${instr.bytes}  ; ${instr.comment}`);
    } else {
      lines.push(`bytes ${instr.bytes}`);
    }
  }
  
  // Emit labels
  if (ctx.labels.length > 0) {
    lines.push('');
    for (const label of ctx.labels) {
      lines.push(`label ${label.name} ${label.offset}`);
    }
  }
  
  // Emit strings
  if (ctx.strings.length > 0) {
    lines.push('');
    for (const str of ctx.strings) {
      lines.push(`label ${str.label} ${ctx.instructions.length}`);
      lines.push(`string "${str.value}"`);
    }
  }
  
  return lines.join('\n') + '\n';
}

module.exports = {
  generateProgram,
  emitManifest,
  ISA,
};
