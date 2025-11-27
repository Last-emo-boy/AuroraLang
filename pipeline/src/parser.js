/**
 * Aurora Parser - Converts source code to IR
 * 
 * This parser is intentionally simple for Stage N1:
 * - Regex-based pattern matching
 * - No full lexer/tokenizer yet
 * - Focused on validating current test programs
 * 
 * Future iterations will replace this with a proper recursive descent parser.
 */

const IR = require('./ir');

// =============================================================================
// Parser Entry Point
// =============================================================================

function parseSource(sourceCode, sourceFile) {
  const trimmed = sourceCode.trim();
  
  // Check if wrapped in module/fn syntax
  if (trimmed.startsWith('module')) {
    return parseModuleProgram(trimmed, sourceFile);
  }
  
  // Detect program shape for legacy flat syntax
  if (trimmed.includes('let') && trimmed.includes(': string =')) {
    return parseStringProgram(trimmed, sourceFile);
  } else if (trimmed.includes('let') && trimmed.includes(': int =')) {
    return parseLoopProgram(trimmed, sourceFile);
  } else {
    throw new Error('Unknown program shape - must contain let bindings with type annotations or module declaration');
  }
}

// =============================================================================
// Module Program Parser (module { fn main() {} } style)
// =============================================================================

function parseModuleProgram(src, sourceFile) {
  const program = IR.createProgram(sourceFile);
  
  // Parse: module <name> { <content> }
  const moduleMatch = src.match(/module\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*)\}/);
  if (!moduleMatch) {
    throw new Error('Invalid module syntax - expected: module <name> { ... }');
  }
  
  const moduleContent = moduleMatch[2];
  
  // Parse: fn main() -> <type> { <body> }
  const fnMatch = moduleContent.match(/fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*)\}/);
  if (!fnMatch) {
    throw new Error('Invalid function syntax - expected: fn main() -> int { ... }');
  }
  
  const fnName = fnMatch[1];
  const fnReturnType = fnMatch[2];
  const fnBody = fnMatch[3];
  
  // Parse function body statements
  parseFunctionBody(fnBody, program);
  
  return program;
}

function parseFunctionBody(bodyStr, program) {
  const body = bodyStr.trim();
  
  // Parse let declarations
  const letRegex = /let\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_<>]*)\s*=\s*([^;]+)\s*;/g;
  let match;
  
  while ((match = letRegex.exec(body)) !== null) {
    const name = match[1];
    const type = match[2];
    const valueStr = match[3].trim();
    
    let value;
    if (type === 'string') {
      const strMatch = valueStr.match(/^"([\\s\\S]*)"$/);
      if (strMatch) {
        value = IR.createLiteralExpr('string', strMatch[1]);
      } else {
        throw new Error(`Invalid string literal: ${valueStr}`);
      }
    } else if (type === 'int') {
      // Check for unary negation
      if (valueStr.startsWith('-')) {
        const numPart = valueStr.substring(1).trim();
        const intValue = Number.parseInt(numPart, 10);
        if (isNaN(intValue)) {
          // Try parsing as expression
          value = parseExpression(valueStr, program);
        } else {
          value = IR.createLiteralExpr('int', -intValue);
        }
      } else {
        const intValue = Number.parseInt(valueStr, 10);
        if (isNaN(intValue)) {
          // Try parsing as expression (e.g., function call or variable)
          value = parseExpression(valueStr, program);
        } else {
          value = IR.createLiteralExpr('int', intValue);
        }
      }
    } else if (type === 'bool') {
      if (valueStr === 'true') {
        value = IR.createLiteralExpr('bool', true);
      } else if (valueStr === 'false') {
        value = IR.createLiteralExpr('bool', false);
      } else {
        value = parseExpression(valueStr, program);
      }
    } else if (type.startsWith('array<')) {
      // Parse array literal: [1, 2, 3]
      value = parseArrayLiteral(valueStr, type);
    } else {
      throw new Error(`Unsupported type: ${type}`);
    }
    
    program.declarations.push(IR.createLetDecl(name, value));
  }
  
  // Parse for loops: for i in 0..10 { }
  parseForLoops(body, program);
  
  // Parse while loops
  const whileRegex = /while\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*>\\s*0\\s*\\{([^}]*)\\}/g;
  while ((match = whileRegex.exec(body)) !== null) {
    const counterName = match[1];
    const loopBody = match[2];
    
    const whileStmt = parseWhileStatement(counterName, loopBody, program);
    program.body.statements.push(whileStmt);
  }
  
  // Parse if/else statements using smart brace matching
  parseIfStatements(body, program);
  
  // Parse request service calls
  const requestRegex = /request\\s+service\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*\\(([^)]*)\\)\\s*;/g;
  while ((match = requestRegex.exec(body)) !== null) {
    const serviceName = match[1];
    const argStr = match[2].trim();
    
    let arg;
    if (/^\\d+$/.test(argStr)) {
      arg = IR.createLiteralExpr('int', Number.parseInt(argStr, 10));
    } else {
      // Assume it's a variable name
      const varDecl = program.declarations.find(d => d.name === argStr);
      const varType = varDecl ? varDecl.value.type : 'int';
      arg = IR.createVariableExpr(argStr, varType);
    }
    
    program.body.statements.push(IR.createRequestStmt(serviceName, [arg]));
  }
  
  // Parse return statement
  const returnMatch = body.match(/return\\s+([^;]+)\\s*;/);
  if (returnMatch) {
    const returnStr = returnMatch[1].trim();
    let returnValue;
    
    if (/^\\d+$/.test(returnStr)) {
      returnValue = IR.createLiteralExpr('int', Number.parseInt(returnStr, 10));
    } else if (/^-\\d+$/.test(returnStr)) {
      returnValue = IR.createLiteralExpr('int', Number.parseInt(returnStr, 10));
    } else {
      const varDecl = program.declarations.find(d => d.name === returnStr);
      const varType = varDecl ? varDecl.value.type : 'int';
      returnValue = IR.createVariableExpr(returnStr, varType);
    }
    
    program.body.statements.push(IR.createReturnStmt(returnValue));
  }
}

function parseWhileStatement(counterName, loopBodyStr, program) {
  const whileStmt = IR.createWhileStmt(
    IR.createBinaryExpr(
      '>',
      IR.createVariableExpr(counterName, 'int'),
      IR.createLiteralExpr('int', 0),
      'bool'
    ),
    IR.createBlock()
  );
  
  // Parse loop body assignments
  const assignRegex = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*([+\-])\s*([A-Za-z0-9_]+)\s*;/g;
  let match;
  
  while ((match = assignRegex.exec(loopBodyStr)) !== null) {
    const target = match[1];
    const left = match[2];
    const operator = match[3];
    const right = match[4];
    
    let rightExpr;
    if (/^\d+$/.test(right)) {
      rightExpr = IR.createLiteralExpr('int', Number.parseInt(right, 10));
    } else {
      rightExpr = IR.createVariableExpr(right, 'int');
    }
    
    const binaryExpr = IR.createBinaryExpr(
      operator,
      IR.createVariableExpr(left, 'int'),
      rightExpr,
      'int'
    );
    
    whileStmt.body.statements.push(IR.createAssignStmt(target, binaryExpr));
  }
  
  return whileStmt;
}

// =============================================================================
// For Loop Parser
// =============================================================================

/**
 * Parse for loops: for i in 0..10 { } or for i in 0..10 step 2 { }
 */
function parseForLoops(body, program) {
  // Match: for <var> in <start>..<end> { ... } or for <var> in <start>..<end> step <step> { ... }
  const forPattern = /for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(-?\d+)\.\.(-?\d+)(?:\s+step\s+(-?\d+))?\s*\{/g;
  let match;
  
  while ((match = forPattern.exec(body)) !== null) {
    const varName = match[1];
    const startVal = Number.parseInt(match[2], 10);
    const endVal = Number.parseInt(match[3], 10);
    const stepVal = match[4] ? Number.parseInt(match[4], 10) : (startVal <= endVal ? 1 : -1);
    
    const braceStart = match.index + match[0].length - 1;
    const braceEnd = findMatchingBrace(body, braceStart);
    
    if (braceEnd === -1) {
      throw new Error('Unmatched opening brace in for loop');
    }
    
    const loopBodyContent = body.slice(braceStart + 1, braceEnd).trim();
    
    // Allocate loop variable
    program.declarations.push(
      IR.createLetDecl(varName, IR.createLiteralExpr('int', startVal))
    );
    
    // Build for statement
    const forStmt = IR.createForStmt(
      varName,
      IR.createLiteralExpr('int', startVal),
      IR.createLiteralExpr('int', endVal),
      IR.createLiteralExpr('int', stepVal),
      IR.createBlock()
    );
    
    // Parse loop body
    parseForLoopBody(loopBodyContent, forStmt.body, program);
    
    program.body.statements.push(forStmt);
  }
}

/**
 * Parse for loop body, handling break/continue
 */
function parseForLoopBody(content, block, program) {
  // Check for break statement
  if (/\bbreak\s*;/.test(content)) {
    block.statements.push(IR.createBreakStmt());
    // Remove break from content to avoid re-parsing
    content = content.replace(/\bbreak\s*;/g, '');
  }
  
  // Check for continue statement
  if (/\bcontinue\s*;/.test(content)) {
    block.statements.push(IR.createContinueStmt());
    content = content.replace(/\bcontinue\s*;/g, '');
  }
  
  // Parse remaining assignments and expressions
  parseBlockBody(content, block, program);
}

// =============================================================================
// Expression Parser
// =============================================================================

/**
 * Parse an expression string into IR
 */
function parseExpression(exprStr, program) {
  exprStr = exprStr.trim();
  
  // Check for function call: funcName(args)
  const callMatch = exprStr.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)$/);
  if (callMatch) {
    const funcName = callMatch[1];
    const argsStr = callMatch[2].trim();
    const args = [];
    
    if (argsStr.length > 0) {
      const argParts = argsStr.split(',');
      for (const argPart of argParts) {
        args.push(parseExpression(argPart.trim(), program));
      }
    }
    
    return IR.createCallExpr(funcName, args, 'int');
  }
  
  // Check for array access: arr[index]
  const arrayAccessMatch = exprStr.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\[([^\]]+)\]$/);
  if (arrayAccessMatch) {
    const arrayName = arrayAccessMatch[1];
    const indexStr = arrayAccessMatch[2].trim();
    const indexExpr = parseExpression(indexStr, program);
    return IR.createArrayAccessExpr(
      IR.createVariableExpr(arrayName, 'array'),
      indexExpr,
      'int'
    );
  }
  
  // Check for unary operators: -x, !x, ~x
  if (exprStr.startsWith('-') && !exprStr.match(/^-\d/)) {
    const operand = parseExpression(exprStr.substring(1).trim(), program);
    return IR.createUnaryExpr('-', operand, operand.type);
  }
  if (exprStr.startsWith('!')) {
    const operand = parseExpression(exprStr.substring(1).trim(), program);
    return IR.createUnaryExpr('!', operand, 'bool');
  }
  if (exprStr.startsWith('~')) {
    const operand = parseExpression(exprStr.substring(1).trim(), program);
    return IR.createUnaryExpr('~', operand, 'int');
  }
  
  // Check for binary operators (in order of precedence, lowest first)
  // Logical OR
  const orParts = splitByOperator(exprStr, '||');
  if (orParts) {
    return IR.createBinaryExpr(
      '||',
      parseExpression(orParts[0], program),
      parseExpression(orParts[1], program),
      'bool'
    );
  }
  
  // Logical AND
  const andParts = splitByOperator(exprStr, '&&');
  if (andParts) {
    return IR.createBinaryExpr(
      '&&',
      parseExpression(andParts[0], program),
      parseExpression(andParts[1], program),
      'bool'
    );
  }
  
  // Comparison operators
  for (const op of ['==', '!=', '>=', '<=', '>', '<']) {
    const cmpParts = splitByOperator(exprStr, op);
    if (cmpParts) {
      return IR.createBinaryExpr(
        op,
        parseExpression(cmpParts[0], program),
        parseExpression(cmpParts[1], program),
        'bool'
      );
    }
  }
  
  // Arithmetic operators
  for (const op of ['+', '-']) {
    const arithParts = splitByOperatorRight(exprStr, op);
    if (arithParts) {
      return IR.createBinaryExpr(
        op,
        parseExpression(arithParts[0], program),
        parseExpression(arithParts[1], program),
        'int'
      );
    }
  }
  
  for (const op of ['*', '/', '%']) {
    const arithParts = splitByOperator(exprStr, op);
    if (arithParts) {
      return IR.createBinaryExpr(
        op,
        parseExpression(arithParts[0], program),
        parseExpression(arithParts[1], program),
        'int'
      );
    }
  }
  
  // Bitwise operators
  for (const op of ['&', '|', '^', '<<', '>>']) {
    const bitParts = splitByOperator(exprStr, op);
    if (bitParts) {
      return IR.createBinaryExpr(
        op,
        parseExpression(bitParts[0], program),
        parseExpression(bitParts[1], program),
        'int'
      );
    }
  }
  
  // Integer literal
  if (/^-?\d+$/.test(exprStr)) {
    return IR.createLiteralExpr('int', Number.parseInt(exprStr, 10));
  }
  
  // Boolean literal
  if (exprStr === 'true') {
    return IR.createLiteralExpr('bool', true);
  }
  if (exprStr === 'false') {
    return IR.createLiteralExpr('bool', false);
  }
  
  // Variable reference
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(exprStr)) {
    const varDecl = program.declarations.find(d => d.name === exprStr);
    const varType = varDecl ? varDecl.value.type : 'int';
    return IR.createVariableExpr(exprStr, varType);
  }
  
  throw new Error(`Cannot parse expression: ${exprStr}`);
}

/**
 * Split expression by operator, respecting parentheses
 */
function splitByOperator(str, op) {
  let depth = 0;
  for (let i = 0; i <= str.length - op.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')') depth--;
    else if (depth === 0 && str.substring(i, i + op.length) === op) {
      // Avoid splitting on operators that are part of longer operators
      if (op === '>' && (str[i+1] === '=' || str[i+1] === '>')) continue;
      if (op === '<' && (str[i+1] === '=' || str[i+1] === '<')) continue;
      if (op === '=' && str[i+1] === '=') continue;
      if (op === '!' && str[i+1] === '=') continue;
      if (op === '&' && str[i+1] === '&') continue;
      if (op === '|' && str[i+1] === '|') continue;
      
      return [str.substring(0, i).trim(), str.substring(i + op.length).trim()];
    }
  }
  return null;
}

/**
 * Split expression by operator from right side (for left-associative ops like + and -)
 */
function splitByOperatorRight(str, op) {
  let depth = 0;
  for (let i = str.length - 1; i >= 0; i--) {
    if (str[i] === ')') depth++;
    else if (str[i] === '(') depth--;
    else if (depth === 0 && str.substring(i, i + op.length) === op) {
      // Check it's not a unary minus at the start
      if (op === '-' && i === 0) continue;
      // Check it's not after another operator
      if (op === '-' && i > 0 && '+-*/%<>=!&|^'.includes(str[i-1])) continue;
      
      return [str.substring(0, i).trim(), str.substring(i + op.length).trim()];
    }
  }
  return null;
}

/**
 * Parse array literal: [1, 2, 3]
 */
function parseArrayLiteral(valueStr, type) {
  const match = valueStr.match(/^\[([^\]]*)\]$/);
  if (!match) {
    throw new Error(`Invalid array literal: ${valueStr}`);
  }
  
  const elementsStr = match[1].trim();
  const elements = [];
  
  if (elementsStr.length > 0) {
    const parts = elementsStr.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (/^-?\d+$/.test(trimmed)) {
        elements.push(IR.createLiteralExpr('int', Number.parseInt(trimmed, 10)));
      } else {
        throw new Error(`Unsupported array element: ${trimmed}`);
      }
    }
  }
  
  // Extract element type from array<int>
  const elemTypeMatch = type.match(/^array<(\w+)>$/);
  const elemType = elemTypeMatch ? elemTypeMatch[1] : 'int';
  
  return IR.createArrayLiteralExpr(elements, elemType);
}

// =============================================================================
// If Statement Parser with Smart Brace Matching
// =============================================================================

/**
 * Find the matching closing brace for an opening brace
 * @param {string} str - The string to search in
 * @param {number} startIndex - Index of the opening brace
 * @returns {number} Index of the matching closing brace, or -1 if not found
 */
function findMatchingBrace(str, startIndex) {
  let depth = 1;
  for (let i = startIndex + 1; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Parse if/else statements from function body using smart brace matching
 * @param {string} body - The function body string
 * @param {Object} program - The IR program to add statements to
 */
function parseIfStatements(body, program) {
  // Find all 'if' keywords and parse them
  const ifPattern = /if\s+([A-Za-z_][A-Za-z0-9_]*)\s*([><=!]+)\s*(\d+)\s*\{/g;
  let match;
  
  while ((match = ifPattern.exec(body)) !== null) {
    const varName = match[1];
    const operator = match[2];
    const compareValue = Number.parseInt(match[3], 10);
    const thenBraceStart = match.index + match[0].length - 1;
    
    // Find matching closing brace for then block
    const thenBraceEnd = findMatchingBrace(body, thenBraceStart);
    if (thenBraceEnd === -1) {
      throw new Error('Unmatched opening brace in if statement');
    }
    
    // Extract then block content
    const thenContent = body.slice(thenBraceStart + 1, thenBraceEnd).trim();
    
    // Check for else block
    const afterThen = body.slice(thenBraceEnd + 1).trimStart();
    let elseContent = null;
    
    if (afterThen.startsWith('else')) {
      const elseMatch = afterThen.match(/^else\s*\{/);
      if (elseMatch) {
        const elseStartInAfterThen = elseMatch[0].length - 1;
        const elseBraceEnd = findMatchingBrace(afterThen, elseStartInAfterThen);
        if (elseBraceEnd === -1) {
          throw new Error('Unmatched opening brace in else block');
        }
        elseContent = afterThen.slice(elseStartInAfterThen + 1, elseBraceEnd).trim();
      }
    }
    
    // Build condition expression
    const condition = IR.createBinaryExpr(
      operator,
      IR.createVariableExpr(varName, 'int'),
      IR.createLiteralExpr('int', compareValue),
      'bool'
    );
    
    // Build then branch
    const thenBranch = IR.createBlock();
    parseBlockBody(thenContent, thenBranch, program);
    
    // Build else branch (if present)
    let elseBranch = null;
    if (elseContent !== null) {
      elseBranch = IR.createBlock();
      parseBlockBody(elseContent, elseBranch, program);
    }
    
    // Create if statement and add to program
    const ifStmt = IR.createIfStmt(condition, thenBranch, elseBranch);
    program.body.statements.push(ifStmt);
  }
}

/**
 * Parse statements inside a block (then/else branch)
 * @param {string} content - The block content
 * @param {Object} block - The IR block to add statements to
 * @param {Object} program - The parent program (for variable lookup)
 */
function parseBlockBody(content, block, program) {
  // First try to parse arithmetic assignments: var = var op value;
  // These are more specific and should be matched first
  const arithAssignRegex = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*([+\-*\/])\s*(\d+|[A-Za-z_][A-Za-z0-9_]*)\s*;/g;
  let match;
  const processedMatches = new Set();
  
  while ((match = arithAssignRegex.exec(content)) !== null) {
    const fullMatch = match[0];
    const target = match[1];
    const left = match[2];
    const operator = match[3];
    const right = match[4];
    
    // Record this match to avoid re-processing as simple assignment
    processedMatches.add(match.index);
    
    let rightExpr;
    if (/^\d+$/.test(right)) {
      rightExpr = IR.createLiteralExpr('int', Number.parseInt(right, 10));
    } else {
      rightExpr = IR.createVariableExpr(right, 'int');
    }
    
    const binaryExpr = IR.createBinaryExpr(
      operator,
      IR.createVariableExpr(left, 'int'),
      rightExpr,
      'int'
    );
    
    block.statements.push(IR.createAssignStmt(target, binaryExpr));
  }
  
  // Then parse simple assignments: var = literal;
  // But only if they weren't already matched as arithmetic assignments
  const simpleAssignRegex = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\d+)\s*;/g;
  
  while ((match = simpleAssignRegex.exec(content)) !== null) {
    // Skip if this was already processed as arithmetic assignment
    // Check by looking at the match index
    let wasProcessed = false;
    for (const idx of processedMatches) {
      // If the simple match starts within an arithmetic match, skip it
      if (Math.abs(match.index - idx) < 5) {
        wasProcessed = true;
        break;
      }
    }
    if (wasProcessed) continue;
    
    const target = match[1];
    const value = Number.parseInt(match[2], 10);
    
    block.statements.push(
      IR.createAssignStmt(target, IR.createLiteralExpr('int', value))
    );
  }
}

// =============================================================================
// String Program Parser (hello_world style) - Legacy flat syntax
// =============================================================================

function parseStringProgram(src, sourceFile) {
  const program = IR.createProgram(sourceFile);
  
  // Parse: let <name>: string = "<literal>";
  const bindingMatch = src.match(/let\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*string\s*=\s*"([^"]+)"\s*;/);
  
  // Parse: request service print(<name>);
  const printMatch = src.match(/request\s+service\s+print\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*;/);
  
  // Parse: request service exit(<code>);
  const exitMatch = src.match(/request\s+service\s+exit\s*\(\s*(\d+)\s*\)\s*;/);
  
  // Parse: return <code>;
  const returnMatch = src.match(/return\s+(\d+)\s*;/);
  
  if (!bindingMatch || !printMatch || !exitMatch || !returnMatch) {
    throw new Error('String program must have: let binding, print request, exit request, return statement');
  }
  
  const bindingName = bindingMatch[1];
  const literal = bindingMatch[2];
  const printTarget = printMatch[1];
  const exitCode = Number.parseInt(exitMatch[1], 10);
  const returnCode = Number.parseInt(returnMatch[1], 10);
  
  // Validate
  if (printTarget !== bindingName) {
    throw new Error(`print() argument must reference declared variable '${bindingName}'`);
  }
  if (exitCode !== returnCode) {
    throw new Error('exit code must match return value');
  }
  
  // Build IR
  program.declarations.push(
    IR.createLetDecl(bindingName, IR.createLiteralExpr('string', literal))
  );
  
  program.body.statements.push(
    IR.createRequestStmt('print', [IR.createVariableExpr(bindingName, 'string')])
  );
  
  program.body.statements.push(
    IR.createRequestStmt('exit', [IR.createLiteralExpr('int', exitCode)])
  );
  
  program.body.statements.push(
    IR.createReturnStmt(IR.createLiteralExpr('int', returnCode))
  );
  
  return program;
}

// =============================================================================
// Loop Program Parser (loop_sum style)
// =============================================================================

function parseLoopProgram(src, sourceFile) {
  const program = IR.createProgram(sourceFile);
  
  // Parse: let <name>: int = <value>;
  const intBindingRe = /let\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*int\s*=\s*(-?\d+)\s*;/g;
  let match;
  const intBindings = [];
  
  while ((match = intBindingRe.exec(src)) !== null) {
    const name = match[1];
    const value = Number.parseInt(match[2], 10);
    intBindings.push({ name, value });
    
    program.declarations.push(
      IR.createLetDecl(name, IR.createLiteralExpr('int', value))
    );
  }
  
  // Parse: while <counter> > 0 { <body> }
  const whileMatch = src.match(/while\s+([A-Za-z_][A-Za-z0-9_]*)\s*>\s*0\s*\{([\s\S]*?)\}/);
  if (!whileMatch) {
    throw new Error('Loop program must contain: while <counter> > 0 { ... }');
  }
  
  const counterName = whileMatch[1];
  const loopBody = whileMatch[2];
  
  // Parse loop body: <acc> = <acc> + <counter>;
  const addMatch = loopBody.match(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*\+\s*([A-Za-z_][A-Za-z0-9_]*)\s*;/);
  
  // Parse loop body: <counter> = <counter> - 1;
  const subMatch = loopBody.match(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*-\s*1\s*;/);
  
  if (!addMatch || !subMatch) {
    throw new Error('Loop body must contain: accumulator += counter; counter -= 1;');
  }
  
  const accName = addMatch[1];
  const addLhs = addMatch[2];
  const addRhs = addMatch[3];
  
  if (accName !== addLhs) {
    throw new Error('Addition must be self-assignment');
  }
  if (addRhs !== counterName) {
    throw new Error('Must add counter to accumulator');
  }
  
  const subTarget = subMatch[1];
  const subLhs = subMatch[2];
  
  if (subTarget !== counterName || subLhs !== counterName) {
    throw new Error('Counter decrement must be self-assignment');
  }
  
  // Build while statement IR
  const whileStmt = IR.createWhileStmt(
    IR.createBinaryExpr(
      '>',
      IR.createVariableExpr(counterName, 'int'),
      IR.createLiteralExpr('int', 0),
      'bool'
    ),
    IR.createBlock()
  );
  
  whileStmt.body.statements.push(
    IR.createAssignStmt(
      accName,
      IR.createBinaryExpr(
        '+',
        IR.createVariableExpr(accName, 'int'),
        IR.createVariableExpr(counterName, 'int'),
        'int'
      )
    )
  );
  
  whileStmt.body.statements.push(
    IR.createAssignStmt(
      counterName,
      IR.createBinaryExpr(
        '-',
        IR.createVariableExpr(counterName, 'int'),
        IR.createLiteralExpr('int', 1),
        'int'
      )
    )
  );
  
  program.body.statements.push(whileStmt);
  
  // Parse: request service exit(<var>);
  const exitMatch = src.match(/request\s+service\s+exit\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*;/);
  
  // Parse: return <var>;
  const returnMatch = src.match(/return\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/);
  
  if (!exitMatch || !returnMatch) {
    throw new Error('Must have: exit(<var>); and return <var>;');
  }
  
  const exitVar = exitMatch[1];
  const returnVar = returnMatch[1];
  
  if (exitVar !== accName || returnVar !== accName) {
    throw new Error('exit/return must reference accumulator variable');
  }
  
  program.body.statements.push(
    IR.createRequestStmt('exit', [IR.createVariableExpr(accName, 'int')])
  );
  
  program.body.statements.push(
    IR.createReturnStmt(IR.createVariableExpr(accName, 'int'))
  );
  
  return program;
}

module.exports = {
  parseSource,
  parseStringProgram,
  parseLoopProgram,
};
