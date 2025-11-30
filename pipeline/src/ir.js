/**
 * Aurora IR (Intermediate Representation)
 * 
 * This module defines the abstract IR structures that decouple parsing from code generation.
 * The IR is designed to be:
 * 1. Independent of source syntax (same IR can come from different frontends)
 * 2. Easy to transform (optimization passes can operate on IR)
 * 3. Target-agnostic (can emit to manifest, machine code, or VM bytecode)
 */

/**
 * IRProgram: Top-level compilation unit
 * @typedef {Object} IRProgram
 * @property {string} sourceFile - Original .aur file path
 * @property {IRDeclaration[]} declarations - Top-level declarations (let/fn)
 * @property {IRBlock} body - Main execution block
 */

/**
 * IRDeclaration: Variable or function declaration
 * @typedef {Object} IRDeclaration
 * @property {'let'|'fn'} kind
 * @property {string} name
 * @property {IRExpression|IRFunction} value
 */

/**
 * IRFunction: Function definition
 * @typedef {Object} IRFunction
 * @property {string[]} params
 * @property {IRBlock} body
 * @property {IRExpression} returnValue
 */

/**
 * IRBlock: Sequence of statements
 * @typedef {Object} IRBlock
 * @property {IRStatement[]} statements
 */

/**
 * IRStatement: Single executable statement
 * @typedef {Object} IRStatement
 * @property {'assign'|'call'|'request'|'while'|'if'|'return'} kind
 * @property {Object} data - Statement-specific data
 */

/**
 * IRExpression: Value-producing expression
 * @typedef {Object} IRExpression
 * @property {'literal'|'variable'|'binary'|'unary'|'call'} kind
 * @property {string|number} type - 'int'|'string'|'bool'
 * @property {Object} data - Expression-specific data
 */

// =============================================================================
// IR Constructors
// =============================================================================

function createProgram(sourceFile) {
  return {
    kind: 'program',
    sourceFile,
    declarations: [],
    body: createBlock(),
  };
}

function createBlock() {
  return {
    kind: 'block',
    statements: [],
  };
}

function createLetDecl(name, value, type = null) {
  return {
    kind: 'let',
    name,
    type: type || (value && value.type) || 'int',  // Infer from value if not provided
    value,
  };
}

function createLiteralExpr(type, value) {
  return {
    kind: 'literal',
    type,
    value,
  };
}

function createVariableExpr(name, type) {
  return {
    kind: 'variable',
    type,
    name,
  };
}

function createBinaryExpr(operator, left, right, type) {
  return {
    kind: 'binary',
    type,
    operator, // '+', '-', '*', '/', '%', '>', '<', '==', '!='
    left,
    right,
  };
}

function createAssignStmt(target, value) {
  return {
    kind: 'assign',
    target,
    value,
  };
}

function createWhileStmt(condition, body) {
  return {
    kind: 'while',
    condition,
    body,
  };
}

function createIfStmt(condition, thenBranch, elseBranch = null) {
  return {
    kind: 'if',
    condition,
    thenBranch,
    elseBranch,
  };
}

function createRequestStmt(service, args) {
  return {
    kind: 'request',
    service, // 'print', 'exit'
    args,
  };
}

function createReturnStmt(value) {
  return {
    kind: 'return',
    value,
  };
}

function createForStmt(varName, start, end, step, body) {
  return {
    kind: 'for',
    varName,
    start,    // IRExpression for start value
    end,      // IRExpression for end value (exclusive)
    step,     // IRExpression for step (usually 1 or -1)
    body,     // IRBlock
  };
}

function createBreakStmt() {
  return {
    kind: 'break',
  };
}

function createContinueStmt() {
  return {
    kind: 'continue',
  };
}

function createSpawnExpr(funcName) {
  return {
    kind: 'spawn',
    type: 'thread',
    funcName,
  };
}

function createJoinStmt(handleName) {
  return {
    kind: 'join',
    handleName,
  };
}

function createSharedDecl(name, type, initialValue) {
  return {
    kind: 'shared',
    name,
    type,
    value: initialValue,
  };
}

function createAtomicAddStmt(sharedVar, value) {
  return {
    kind: 'atomic_add',
    sharedVar,
    value,  // IRExpression
  };
}

function createAtomicLoadExpr(sharedVar, type) {
  return {
    kind: 'atomic_load',
    type,
    sharedVar,
  };
}

// Input expression: input() -> int
function createInputExpr(type) {
  return {
    kind: 'input',
    type,
  };
}

// Math function call: sqrt(x), pow(x, n) -> float
function createMathCall(func, args) {
  return {
    kind: 'math_call',
    func,  // 'sqrt', 'pow', etc.
    args,
    type: 'float',
  };
}

// General atomic expression/statement
// op: 'add', 'fadd', 'sub', 'load', 'store', 'cas'
function createAtomicExpr(op, target, value, expected, newValue) {
  return {
    kind: 'atomic_op',
    operation: op,
    target,      // variable name
    value,       // for add, sub, store
    expected,    // for cas
    newValue,    // for cas
  };
}

function createUnaryExpr(operator, operand, type) {
  return {
    kind: 'unary',
    type,
    operator, // '-', '!', '~'
    operand,
  };
}

function createArrayLiteralExpr(elements, elementType) {
  return {
    kind: 'array_literal',
    type: `array<${elementType}>`,
    elementType,
    elements, // Array of IRExpression
  };
}

function createArrayAccessExpr(array, index, elementType) {
  return {
    kind: 'array_access',
    type: elementType,
    array,    // IRExpression (variable or array literal)
    index,    // IRExpression (int)
  };
}

function createArrayAssignStmt(arrayName, index, value) {
  return {
    kind: 'array_assign',
    arrayName,   // string - name of the array variable
    index,       // IRExpression - index expression
    value,       // IRExpression - value to assign
  };
}

function createCallExpr(functionName, args, returnType = 'int') {
  return {
    kind: 'call',
    type: returnType,
    functionName,
    args,
  };
}

// Call statement (function call without using return value)
function createCallStmt(functionName, args) {
  return {
    kind: 'call_stmt',
    functionName,
    args,
  };
}

function createFunctionDecl(name, params, returnType, body, localDecls = []) {
  return {
    kind: 'fn',
    name,
    params,      // Array of { name, type }
    returnType,
    body,        // IRBlock
    localDecls,  // Local variable declarations within the function
  };
}

function createCastExpr(targetType, sourceExpr) {
  return {
    kind: 'cast',
    type: targetType,  // Target type after conversion
    targetType,        // e.g., 'int', 'float'
    sourceExpr,        // The expression to convert
  };
}

// =============================================================================
// IR Utilities
// =============================================================================

function walkProgram(program, visitor) {
  if (visitor.visitProgram) visitor.visitProgram(program);
  
  for (const decl of program.declarations) {
    if (visitor.visitDeclaration) visitor.visitDeclaration(decl);
  }
  
  walkBlock(program.body, visitor);
}

function walkBlock(block, visitor) {
  if (visitor.visitBlock) visitor.visitBlock(block);
  
  for (const stmt of block.statements) {
    walkStatement(stmt, visitor);
  }
}

function walkStatement(stmt, visitor) {
  if (visitor.visitStatement) visitor.visitStatement(stmt);
  
  switch (stmt.kind) {
    case 'while':
      walkExpression(stmt.condition, visitor);
      walkBlock(stmt.body, visitor);
      break;
    case 'for':
      walkExpression(stmt.start, visitor);
      walkExpression(stmt.end, visitor);
      if (stmt.step) walkExpression(stmt.step, visitor);
      walkBlock(stmt.body, visitor);
      break;
    case 'if':
      walkExpression(stmt.condition, visitor);
      walkBlock(stmt.thenBranch, visitor);
      if (stmt.elseBranch) walkBlock(stmt.elseBranch, visitor);
      break;
    case 'assign':
      walkExpression(stmt.value, visitor);
      break;
    case 'request':
      stmt.args.forEach(arg => walkExpression(arg, visitor));
      break;
    case 'return':
      if (stmt.value) walkExpression(stmt.value, visitor);
      break;
    case 'break':
    case 'continue':
      // No children to walk
      break;
  }
}

function walkExpression(expr, visitor) {
  if (visitor.visitExpression) visitor.visitExpression(expr);
  
  switch (expr.kind) {
    case 'binary':
      walkExpression(expr.left, visitor);
      walkExpression(expr.right, visitor);
      break;
    case 'unary':
      walkExpression(expr.operand, visitor);
      break;
    case 'array_literal':
      expr.elements.forEach(elem => walkExpression(elem, visitor));
      break;
    case 'array_access':
      walkExpression(expr.array, visitor);
      walkExpression(expr.index, visitor);
      break;
    case 'call':
      expr.args.forEach(arg => walkExpression(arg, visitor));
      break;
  }
}

// =============================================================================
// IR Validation
// =============================================================================

function validateProgram(program) {
  const errors = [];
  const declaredVars = new Set();
  
  // Check declarations
  for (const decl of program.declarations) {
    if (declaredVars.has(decl.name)) {
      errors.push(`Duplicate declaration: ${decl.name}`);
    }
    declaredVars.add(decl.name);
  }
  
  // Check variable references
  walkProgram(program, {
    visitExpression(expr) {
      if (expr.kind === 'variable' && !declaredVars.has(expr.name)) {
        errors.push(`Undefined variable: ${expr.name}`);
      }
    }
  });
  
  return errors;
}

module.exports = {
  // Constructors
  createProgram,
  createBlock,
  createLetDecl,
  createLiteralExpr,
  createVariableExpr,
  createBinaryExpr,
  createUnaryExpr,
  createAssignStmt,
  createWhileStmt,
  createForStmt,
  createIfStmt,
  createRequestStmt,
  createReturnStmt,
  createBreakStmt,
  createContinueStmt,
  createSpawnExpr,
  createJoinStmt,
  createSharedDecl,
  createAtomicAddStmt,
  createAtomicLoadExpr,
  createInputExpr,
  createMathCall,
  createAtomicExpr,
  createCallExpr,
  createCallStmt,
  createFunctionDecl,
  createArrayLiteralExpr,
  createArrayAccessExpr,
  createArrayAssignStmt,
  createCastExpr,
  
  // Utilities
  walkProgram,
  walkBlock,
  walkStatement,
  walkExpression,
  validateProgram,
};
