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
  const letRegex = /let\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+)\s*;/g;
  let match;
  
  while ((match = letRegex.exec(body)) !== null) {
    const name = match[1];
    const type = match[2];
    const valueStr = match[3].trim();
    
    let value;
    if (type === 'string') {
      const strMatch = valueStr.match(/^"([\s\S]*)"$/);
      if (strMatch) {
        value = IR.createLiteralExpr('string', strMatch[1]);
      } else {
        throw new Error(`Invalid string literal: ${valueStr}`);
      }
    } else if (type === 'int') {
      const intValue = Number.parseInt(valueStr, 10);
      if (isNaN(intValue)) {
        throw new Error(`Invalid int literal: ${valueStr}`);
      }
      value = IR.createLiteralExpr('int', intValue);
    } else {
      throw new Error(`Unsupported type: ${type}`);
    }
    
    program.declarations.push(IR.createLetDecl(name, value));
  }
  
  // Parse while loops
  const whileRegex = /while\s+([A-Za-z_][A-Za-z0-9_]*)\s*>\s*0\s*\{([^}]*)\}/g;
  while ((match = whileRegex.exec(body)) !== null) {
    const counterName = match[1];
    const loopBody = match[2];
    
    const whileStmt = parseWhileStatement(counterName, loopBody, program);
    program.body.statements.push(whileStmt);
  }
  
  // Parse request service calls
  const requestRegex = /request\s+service\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*;/g;
  while ((match = requestRegex.exec(body)) !== null) {
    const serviceName = match[1];
    const argStr = match[2].trim();
    
    let arg;
    if (/^\d+$/.test(argStr)) {
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
  const returnMatch = body.match(/return\s+([^;]+)\s*;/);
  if (returnMatch) {
    const returnStr = returnMatch[1].trim();
    let returnValue;
    
    if (/^\d+$/.test(returnStr)) {
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
