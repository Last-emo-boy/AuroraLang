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
    ADD: 0x04,
    SUB: 0x05,
    CMP: 0x06,
    JMP: 0x07,
    CJMP: 0x08,
    CALL: 0x09,
    RET: 0x0a,
    SVC: 0x0b,
    HALT: 0x0c,
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
  }
  
  allocRegister(varName) {
    return this.registerAlloc.allocateVariable(varName);
  }
  
  getRegister(varName) {
    return this.registerAlloc.getVariable(varName);
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
}

// =============================================================================
// IR to Instructions
// =============================================================================

function generateProgram(program) {
  const ctx = new CodeGenContext();
  
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

function generateDeclaration(decl, ctx) {
  const reg = ctx.getRegister(decl.name);
  
  if (decl.value.kind === 'literal') {
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
    case 'if':
      generateIf(stmt, ctx);
      break;
    case 'request':
      generateRequest(stmt, ctx);
      break;
    case 'return':
      generateReturn(stmt, ctx);
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
  // In current programs, return is a no-op because exit service handles the return value
  // If we ever have functions, this would need to generate actual return instructions
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
      
    default:
      throw new Error(`Unsupported expression kind: ${expr.kind}`);
  }
}

function generateBinaryInto(expr, destReg, ctx) {
  // Generate binary operation directly into destination register
  const leftReg = ctx.getRegister(expr.left.name);
  
  switch (expr.operator) {
    case '+':
      const rightReg = ctx.getRegister(expr.right.name);
      ctx.emitInstruction(
        encodeAddRegReg(destReg, leftReg, rightReg),
        `add r${destReg}, r${leftReg}, r${rightReg}`
      );
      break;
      
    case '-':
      if (expr.right.kind === 'literal') {
        ctx.emitInstruction(
          encodeSubRegImm(destReg, leftReg, expr.right.value),
          `sub r${destReg}, r${leftReg}, #${expr.right.value}`
        );
      } else {
        const rightReg = ctx.getRegister(expr.right.name);
        throw new Error('SUB reg,reg not yet implemented');
      }
      break;
      
    default:
      throw new Error(`Unsupported operator in assignment: ${expr.operator}`);
  }
}

function generateBinary(expr, ctx) {
  const leftReg = generateExpression(expr.left, ctx);
  const rightReg = generateExpression(expr.right, ctx);
  const resultReg = leftReg; // Reuse left register
  
  switch (expr.operator) {
    case '+':
      ctx.emitInstruction(
        encodeAddRegReg(resultReg, leftReg, rightReg),
        `add r${resultReg}, r${leftReg}, r${rightReg}`
      );
      break;
      
    case '-':
      if (expr.right.kind === 'literal') {
        ctx.emitInstruction(
          encodeSubRegImm(resultReg, leftReg, expr.right.value),
          `sub r${resultReg}, r${leftReg}, #${expr.right.value}`
        );
      } else {
        throw new Error('SUB reg,reg not yet implemented');
      }
      break;
      
    case '>':
      // CMP sets flags, we return the left register
      if (expr.right.kind === 'literal') {
        ctx.emitInstruction(
          encodeCmpRegImm(leftReg, expr.right.value),
          `cmp r${leftReg}, #${expr.right.value}`
        );
      } else {
        throw new Error('CMP reg,reg not yet implemented');
      }
      break;
      
    default:
      throw new Error(`Unsupported operator: ${expr.operator}`);
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
  
  // Emit instructions
  for (const instr of ctx.instructions) {
    lines.push(`bytes ${instr.bytes}`);
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
