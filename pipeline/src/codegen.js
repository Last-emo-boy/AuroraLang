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
    // Shadow space (32 bytes) + spill slots (8 bytes each)
    const spillSlots = this.registerAlloc.getStackSize();
    // Round up to 16-byte alignment
    const size = 32 + spillSlots * 8;
    return (size + 15) & ~15;
  }
  
  allocTemp() {
    return this.registerAlloc.allocateTemp();
  }
  
  releaseTemp(reg) {
    this.registerAlloc.releaseTemp(reg);
  }
  
  emitInstruction(bytes, comment = '') {
    this.instructions.push({ bytes, comment });
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
  
  // Generate local variable initialization (allocation happens here)
  for (const decl of fnDecl.localDecls) {
    if (decl.kind === 'let') {
      generateDeclaration(decl, ctx);
    }
  }
  
  // Generate function body
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
  }
  
  // Emit implicit return if no explicit return at end
  // (return instruction will be generated by return statement)
  ctx.currentFunction = null;
}

function generateDeclaration(decl, ctx) {
  // For complex expressions, we need to evaluate first, then assign to variable
  // This avoids issues where evaluating the expression evicts the target variable
  
  if (decl.value.kind === 'literal') {
    // Simple case: allocate register and assign directly
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
  } else if (decl.value.kind === 'binary') {
    // Complex case: evaluate expression into temp first, then assign to variable
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
}

function generateStatement(stmt, ctx) {
  switch (stmt.kind) {
    case 'assign':
      generateAssignment(stmt, ctx);
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
    default:
      throw new Error(`Unsupported statement kind: ${stmt.kind}`);
  }
}

function generateAssignment(stmt, ctx) {
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

function generateWhile(stmt, ctx) {
  const loopLabel = ctx.generateLabel('loop');
  const exitLabel = ctx.generateLabel('exit');
  
  // Emit loop label
  ctx.emitLabel(loopLabel);
  
  // Generate loop body first
  for (const bodyStmt of stmt.body.statements) {
    generateStatement(bodyStmt, ctx);
  }
  
  // Generate condition check at end of loop (post-test optimization)
  // For binary comparison expressions, we need to emit CMP instruction
  if (stmt.condition.kind === 'binary') {
    const leftReg = ctx.getRegister(stmt.condition.left.name);
    const rightValue = stmt.condition.right.value;
    
    ctx.emitInstruction(
      encodeCmpRegImm(leftReg, rightValue),
      `cmp r${leftReg}, #${rightValue}`
    );
    
    // Jump to exit if condition is false (counter == 0 for > 0 check)
    ctx.emitInstruction(
      encodeCjmpEq(exitLabel),
      `cjmp eq, ${exitLabel}`
    );
  }
  
  // Jump back to loop start
  ctx.emitInstruction(
    encodeJmp(loopLabel),
    `jmp ${loopLabel}`
  );
  
  ctx.emitLabel(exitLabel);
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

function generateIf(stmt, ctx) {
  const elseLabel = ctx.generateLabel('else');
  const endLabel = ctx.generateLabel('endif');
  
  // Evaluate condition and generate comparison
  if (stmt.condition.kind === 'binary') {
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

function generateRequest(stmt, ctx) {
  const serviceMap = {
    print: 0x01,
    exit: 0x02,
    pause: 0x03,           // Wait for key press, show exit code
    pause_silent: 0x04,    // Wait for key press without message
  };
  
  const serviceCode = serviceMap[stmt.service];
  if (serviceCode === undefined) {
    throw new Error(`Unknown service: ${stmt.service}`);
  }
  
  // Move argument to r0 (service convention)
  if (stmt.args.length > 0) {
    const arg = stmt.args[0];
    
    if (arg.kind === 'literal' && arg.type === 'int') {
      // Direct immediate to r0
      ctx.emitInstruction(
        encodeMovImmediate(ISA.REGISTER.r0, arg.value),
        `mov r0, #${arg.value}`
      );
    } else if (arg.kind === 'variable') {
      const argReg = ctx.getRegister(arg.name);
      
      // Special handling for print service - string should stay in r1
      if (stmt.service === 'print' && arg.type === 'string') {
        // String address should already be in the variable's register
        // Don't move to r0, print service expects string address in r1
        // (based on legacy output analysis)
      } else if (argReg !== ISA.REGISTER.r0) {
        ctx.emitInstruction(
          encodeMovRegister(ISA.REGISTER.r0, argReg),
          `mov r0, r${argReg}`
        );
      }
    } else {
      const argReg = generateExpression(arg, ctx);
      if (argReg !== ISA.REGISTER.r0) {
        ctx.emitInstruction(
          encodeMovRegister(ISA.REGISTER.r0, argReg),
          `mov r0, r${argReg}`
        );
      }
    }
  }
  
  // Emit SVC instruction
  // For write service, op1=0x01 (stdout)
  const op1 = (stmt.service === 'print') ? 0x01 : ISA.OPERAND.UNUSED;
  
  ctx.emitInstruction(
    encodeSvc(serviceCode, op1),
    `svc 0x${serviceCode.toString(16).padStart(2, '0')}`
  );
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
// Manifest Emission
// =============================================================================

function emitManifest(ctx, sourceFile) {
  const lines = [];
  
  lines.push('# Aurora minimal ISA manifest (Stage N1 pipeline output)');
  lines.push(`# Generated from: ${sourceFile}`);
  lines.push('');
  
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
