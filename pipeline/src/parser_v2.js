/**
 * Aurora Recursive Descent Parser
 * 
 * A proper parser that handles nested structures correctly.
 * Converts token stream to IR.
 * 
 * Grammar (simplified):
 *   program      → module_decl | flat_program
 *   module_decl  → 'module' IDENTIFIER '{' fn_decl* '}'
 *   fn_decl      → 'fn' IDENTIFIER '(' params? ')' '->' type '{' stmt* '}'
 *   params       → param (',' param)*
 *   param        → IDENTIFIER ':' type
 *   type         → 'int' | 'string' | 'bool'
 *   stmt         → let_stmt | assign_stmt | if_stmt | while_stmt | request_stmt | return_stmt
 *   let_stmt     → 'let' IDENTIFIER ':' type '=' expr ';'
 *   assign_stmt  → IDENTIFIER '=' expr ';'
 *   if_stmt      → 'if' expr '{' stmt* '}' ('else' '{' stmt* '}')?
 *   while_stmt   → 'while' expr '{' stmt* '}'
 *   request_stmt → 'request' 'service' IDENTIFIER '(' args? ')' ';'
 *   return_stmt  → 'return' expr ';'
 *   expr         → comparison
 *   comparison   → bitwise_or (('>' | '<' | '==' | '!=' | '>=' | '<=') bitwise_or)?
 *   bitwise_or   → bitwise_xor ('|' bitwise_xor)*
 *   bitwise_xor  → bitwise_and ('^' bitwise_and)*
 *   bitwise_and  → shift ('&' shift)*
 *   shift        → additive (('<<' | '>>') additive)*
 *   additive     → term (('+' | '-') term)*
 *   term         → factor (('*' | '/' | '%') factor)*
 *   factor       → NUMBER | STRING | IDENTIFIER | '(' expr ')' | call_expr
 *   call_expr    → IDENTIFIER '(' args? ')'
 *   args         → expr (',' expr)*
 */

const { TokenType, tokenize } = require('./lexer');
const IR = require('./ir');

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }
  
  // ==========================================================================
  // Token navigation
  // ==========================================================================
  
  current() {
    return this.tokens[this.pos];
  }
  
  peek(offset = 0) {
    const idx = this.pos + offset;
    return idx < this.tokens.length ? this.tokens[idx] : null;
  }
  
  advance() {
    const token = this.current();
    this.pos++;
    return token;
  }
  
  check(type) {
    return this.current().type === type;
  }
  
  match(...types) {
    for (const type of types) {
      if (this.check(type)) {
        return this.advance();
      }
    }
    return null;
  }
  
  expect(type, message) {
    if (this.check(type)) {
      return this.advance();
    }
    const token = this.current();
    throw new Error(`${message} at ${token.line}:${token.column}, got ${token.type}`);
  }
  
  // ==========================================================================
  // Program parsing
  // ==========================================================================
  
  parseProgram(sourceFile) {
    const program = IR.createProgram(sourceFile);
    
    if (this.check(TokenType.MODULE)) {
      this.parseModuleProgram(program);
    } else {
      this.parseFlatProgram(program);
    }
    
    return program;
  }
  
  parseModuleProgram(program) {
    this.expect(TokenType.MODULE, 'Expected "module"');
    const moduleName = this.expect(TokenType.IDENTIFIER, 'Expected module name');
    program.moduleName = moduleName.value;
    this.expect(TokenType.LBRACE, 'Expected "{"');
    
    // Parse function declarations
    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      if (this.check(TokenType.FN)) {
        const fnDecl = this.parseFunctionDecl(program);
        program.declarations.push(fnDecl);
      } else {
        throw new Error(`Unexpected token in module: ${this.current().type}`);
      }
    }
    
    this.expect(TokenType.RBRACE, 'Expected "}"');
  }
  
  parseFunctionDecl(program) {
    this.expect(TokenType.FN, 'Expected "fn"');
    const fnName = this.expect(TokenType.IDENTIFIER, 'Expected function name');
    this.expect(TokenType.LPAREN, 'Expected "("');
    
    // Parse parameters (if any)
    const params = [];
    if (!this.check(TokenType.RPAREN)) {
      do {
        const paramName = this.expect(TokenType.IDENTIFIER, 'Expected parameter name');
        this.expect(TokenType.COLON, 'Expected ":"');
        const paramType = this.parseType();
        params.push({ name: paramName.value, type: paramType });
      } while (this.match(TokenType.COMMA));
    }
    
    this.expect(TokenType.RPAREN, 'Expected ")"');
    this.expect(TokenType.ARROW, 'Expected "->"');
    const returnType = this.parseType();
    this.expect(TokenType.LBRACE, 'Expected "{"');
    
    // Create function body block and local declarations array
    const body = IR.createBlock();
    const localDecls = [];
    
    // Create a context for parsing function body
    const fnContext = {
      declarations: localDecls,  // Local declarations go here
      body: body,
      parentDeclarations: program.declarations,  // Access to global/other functions
    };
    
    // Parse function body statements
    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      this.parseFunctionBodyStatement(fnContext, body);
    }
    
    this.expect(TokenType.RBRACE, 'Expected "}"');
    
    return IR.createFunctionDecl(fnName.value, params, returnType, body, localDecls);
  }
  
  parseFunctionBodyStatement(fnContext, block) {
    if (this.check(TokenType.LET)) {
      // Local variable declaration
      this.expect(TokenType.LET, 'Expected "let"');
      const name = this.expect(TokenType.IDENTIFIER, 'Expected variable name');
      this.expect(TokenType.COLON, 'Expected ":"');
      const type = this.parseType();
      this.expect(TokenType.ASSIGN, 'Expected "="');
      const value = this.parseExpression(fnContext);
      this.expect(TokenType.SEMICOLON, 'Expected ";"');
      
      fnContext.declarations.push(IR.createLetDecl(name.value, value));
    } else if (this.check(TokenType.IF)) {
      const stmt = this.parseIfStatementInFunction(fnContext);
      block.statements.push(stmt);
    } else if (this.check(TokenType.WHILE)) {
      const stmt = this.parseWhileStatementInFunction(fnContext);
      block.statements.push(stmt);
    } else if (this.check(TokenType.FOR)) {
      const stmt = this.parseForStatementInFunction(fnContext);
      block.statements.push(stmt);
    } else if (this.check(TokenType.BREAK)) {
      const stmt = this.parseBreakStatement();
      block.statements.push(stmt);
    } else if (this.check(TokenType.CONTINUE)) {
      const stmt = this.parseContinueStatement();
      block.statements.push(stmt);
    } else if (this.check(TokenType.REQUEST)) {
      const stmt = this.parseRequestStatement(fnContext);
      block.statements.push(stmt);
    } else if (this.check(TokenType.RETURN)) {
      const stmt = this.parseReturnStatement(fnContext);
      block.statements.push(stmt);
    } else if (this.check(TokenType.IDENTIFIER)) {
      const stmt = this.parseAssignmentStatement(fnContext);
      block.statements.push(stmt);
    } else {
      throw new Error(`Unexpected token in function body: ${this.current().type}`);
    }
  }
  
  parseForStatementInFunction(fnContext) {
    this.expect(TokenType.FOR, 'Expected "for"');
    const iterator = this.expect(TokenType.IDENTIFIER, 'Expected iterator variable');
    this.expect(TokenType.IN, 'Expected "in"');
    
    // Parse range: start..end [step value]
    const startExpr = this.parsePrimary(fnContext);
    this.expect(TokenType.DOTDOT, 'Expected ".."');
    const endExpr = this.parsePrimary(fnContext);
    
    let stepExpr;
    if (this.match(TokenType.STEP)) {
      stepExpr = this.parsePrimary(fnContext);
    } else {
      // Default step: 1 if start <= end, -1 otherwise
      stepExpr = IR.createLiteralExpr('int', 1);
    }
    
    this.expect(TokenType.LBRACE, 'Expected "{"');
    
    // Add iterator to declarations
    fnContext.declarations.push(IR.createLetDecl(iterator.value, startExpr));
    
    const body = IR.createBlock();
    
    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      this.parseFunctionBodyStatement(fnContext, body);
    }
    
    this.expect(TokenType.RBRACE, 'Expected "}"');
    
    return IR.createForStmt(iterator.value, startExpr, endExpr, stepExpr, body);
  }
  
  parseBreakStatement() {
    this.expect(TokenType.BREAK, 'Expected "break"');
    this.expect(TokenType.SEMICOLON, 'Expected ";"');
    return IR.createBreakStmt();
  }
  
  parseContinueStatement() {
    this.expect(TokenType.CONTINUE, 'Expected "continue"');
    this.expect(TokenType.SEMICOLON, 'Expected ";"');
    return IR.createContinueStmt();
  }
  
  parseIfStatementInFunction(fnContext) {
    this.expect(TokenType.IF, 'Expected "if"');
    const condition = this.parseExpression(fnContext);
    this.expect(TokenType.LBRACE, 'Expected "{"');
    
    const thenBranch = IR.createBlock();
    
    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      this.parseFunctionBodyStatement(fnContext, thenBranch);
    }
    
    this.expect(TokenType.RBRACE, 'Expected "}"');
    
    let elseBranch = null;
    if (this.match(TokenType.ELSE)) {
      this.expect(TokenType.LBRACE, 'Expected "{"');
      elseBranch = IR.createBlock();
      
      while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
        this.parseFunctionBodyStatement(fnContext, elseBranch);
      }
      
      this.expect(TokenType.RBRACE, 'Expected "}"');
    }
    
    return IR.createIfStmt(condition, thenBranch, elseBranch);
  }
  
  parseWhileStatementInFunction(fnContext) {
    this.expect(TokenType.WHILE, 'Expected "while"');
    const condition = this.parseExpression(fnContext);
    this.expect(TokenType.LBRACE, 'Expected "{"');
    
    const body = IR.createBlock();
    
    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      this.parseFunctionBodyStatement(fnContext, body);
    }
    
    this.expect(TokenType.RBRACE, 'Expected "}"');
    
    return IR.createWhileStmt(condition, body);
  }
  
  parseFlatProgram(program) {
    // Parse statements directly
    this.parseStatementList(program);
  }
  
  parseStatementList(program) {
    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      this.parseStatement(program);
    }
  }
  
  // ==========================================================================
  // Statement parsing
  // ==========================================================================
  
  parseStatement(program) {
    if (this.check(TokenType.LET)) {
      this.parseLetStatement(program);
    } else if (this.check(TokenType.IF)) {
      const stmt = this.parseIfStatement(program);
      program.body.statements.push(stmt);
    } else if (this.check(TokenType.WHILE)) {
      const stmt = this.parseWhileStatement(program);
      program.body.statements.push(stmt);
    } else if (this.check(TokenType.REQUEST)) {
      const stmt = this.parseRequestStatement(program);
      program.body.statements.push(stmt);
    } else if (this.check(TokenType.RETURN)) {
      const stmt = this.parseReturnStatement(program);
      program.body.statements.push(stmt);
    } else if (this.check(TokenType.IDENTIFIER)) {
      // Assignment statement
      const stmt = this.parseAssignmentStatement(program);
      program.body.statements.push(stmt);
    } else {
      throw new Error(`Unexpected token: ${this.current().type} at ${this.current().line}:${this.current().column}`);
    }
  }
  
  parseLetStatement(program) {
    this.expect(TokenType.LET, 'Expected "let"');
    const name = this.expect(TokenType.IDENTIFIER, 'Expected variable name');
    this.expect(TokenType.COLON, 'Expected ":"');
    const type = this.parseType();
    this.expect(TokenType.ASSIGN, 'Expected "="');
    const value = this.parseExpression(program);
    this.expect(TokenType.SEMICOLON, 'Expected ";"');
    
    program.declarations.push(IR.createLetDecl(name.value, value));
  }
  
  parseAssignmentStatement(program) {
    const name = this.expect(TokenType.IDENTIFIER, 'Expected variable name');
    this.expect(TokenType.ASSIGN, 'Expected "="');
    const value = this.parseExpression(program);
    this.expect(TokenType.SEMICOLON, 'Expected ";"');
    
    return IR.createAssignStmt(name.value, value);
  }
  
  parseIfStatement(program) {
    this.expect(TokenType.IF, 'Expected "if"');
    const condition = this.parseExpression(program);
    this.expect(TokenType.LBRACE, 'Expected "{"');
    
    const thenBranch = IR.createBlock();
    const thenProgram = { declarations: program.declarations, body: thenBranch };
    
    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      this.parseStatementIntoBlock(thenProgram, thenBranch);
    }
    
    this.expect(TokenType.RBRACE, 'Expected "}"');
    
    let elseBranch = null;
    if (this.match(TokenType.ELSE)) {
      this.expect(TokenType.LBRACE, 'Expected "{"');
      elseBranch = IR.createBlock();
      const elseProgram = { declarations: program.declarations, body: elseBranch };
      
      while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
        this.parseStatementIntoBlock(elseProgram, elseBranch);
      }
      
      this.expect(TokenType.RBRACE, 'Expected "}"');
    }
    
    return IR.createIfStmt(condition, thenBranch, elseBranch);
  }
  
  parseStatementIntoBlock(program, block) {
    if (this.check(TokenType.LET)) {
      // Let statements in blocks are special - they should go to declarations
      this.parseLetStatement(program);
    } else if (this.check(TokenType.IF)) {
      const stmt = this.parseIfStatement(program);
      block.statements.push(stmt);
    } else if (this.check(TokenType.WHILE)) {
      const stmt = this.parseWhileStatement(program);
      block.statements.push(stmt);
    } else if (this.check(TokenType.REQUEST)) {
      const stmt = this.parseRequestStatement(program);
      block.statements.push(stmt);
    } else if (this.check(TokenType.RETURN)) {
      const stmt = this.parseReturnStatement(program);
      block.statements.push(stmt);
    } else if (this.check(TokenType.IDENTIFIER)) {
      const stmt = this.parseAssignmentStatement(program);
      block.statements.push(stmt);
    } else {
      throw new Error(`Unexpected token in block: ${this.current().type}`);
    }
  }
  
  parseWhileStatement(program) {
    this.expect(TokenType.WHILE, 'Expected "while"');
    const condition = this.parseExpression(program);
    this.expect(TokenType.LBRACE, 'Expected "{"');
    
    const body = IR.createBlock();
    const bodyProgram = { declarations: program.declarations, body: body };
    
    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      this.parseStatementIntoBlock(bodyProgram, body);
    }
    
    this.expect(TokenType.RBRACE, 'Expected "}"');
    
    return IR.createWhileStmt(condition, body);
  }
  
  parseRequestStatement(program) {
    this.expect(TokenType.REQUEST, 'Expected "request"');
    this.expect(TokenType.SERVICE, 'Expected "service"');
    const service = this.expect(TokenType.IDENTIFIER, 'Expected service name');
    this.expect(TokenType.LPAREN, 'Expected "("');
    
    const args = [];
    if (!this.check(TokenType.RPAREN)) {
      do {
        args.push(this.parseExpression(program));
      } while (this.match(TokenType.COMMA));
    }
    
    this.expect(TokenType.RPAREN, 'Expected ")"');
    this.expect(TokenType.SEMICOLON, 'Expected ";"');
    
    return IR.createRequestStmt(service.value, args);
  }
  
  parseReturnStatement(program) {
    this.expect(TokenType.RETURN, 'Expected "return"');
    const value = this.parseExpression(program);
    this.expect(TokenType.SEMICOLON, 'Expected ";"');
    
    return IR.createReturnStmt(value);
  }
  
  // ==========================================================================
  // Expression parsing (precedence climbing)
  // ==========================================================================

  parseExpression(program) {
    return this.parseLogicalOr(program);
  }
  
  parseLogicalOr(program) {
    let left = this.parseLogicalAnd(program);
    
    while (this.check(TokenType.OR)) {
      const op = this.advance();
      const right = this.parseLogicalAnd(program);
      left = IR.createBinaryExpr(op.value, left, right, 'bool');
    }
    
    return left;
  }
  
  parseLogicalAnd(program) {
    let left = this.parseComparison(program);
    
    while (this.check(TokenType.AND)) {
      const op = this.advance();
      const right = this.parseComparison(program);
      left = IR.createBinaryExpr(op.value, left, right, 'bool');
    }
    
    return left;
  }
  
  parseComparison(program) {
    let left = this.parseBitwiseOr(program);
    
    if (this.check(TokenType.GT) || this.check(TokenType.LT) || 
        this.check(TokenType.EQ) || this.check(TokenType.NEQ) ||
        this.check(TokenType.GEQ) || this.check(TokenType.LEQ)) {
      const op = this.advance();
      const right = this.parseBitwiseOr(program);
      left = IR.createBinaryExpr(op.value, left, right, 'bool');
    }
    
    return left;
  }
  
  parseBitwiseOr(program) {
    let left = this.parseBitwiseXor(program);
    
    while (this.check(TokenType.PIPE)) {
      const op = this.advance();
      const right = this.parseBitwiseXor(program);
      left = IR.createBinaryExpr(op.value, left, right, 'int');
    }
    
    return left;
  }
  
  parseBitwiseXor(program) {
    let left = this.parseBitwiseAnd(program);
    
    while (this.check(TokenType.CARET)) {
      const op = this.advance();
      const right = this.parseBitwiseAnd(program);
      left = IR.createBinaryExpr(op.value, left, right, 'int');
    }
    
    return left;
  }
  
  parseBitwiseAnd(program) {
    let left = this.parseShift(program);
    
    while (this.check(TokenType.AMPERSAND)) {
      const op = this.advance();
      const right = this.parseShift(program);
      left = IR.createBinaryExpr(op.value, left, right, 'int');
    }
    
    return left;
  }
  
  parseShift(program) {
    let left = this.parseAdditive(program);
    
    while (this.check(TokenType.SHL) || this.check(TokenType.SHR)) {
      const op = this.advance();
      const right = this.parseAdditive(program);
      left = IR.createBinaryExpr(op.value, left, right, 'int');
    }
    
    return left;
  }
  
  parseAdditive(program) {
    let left = this.parseTerm(program);
    
    while (this.check(TokenType.PLUS) || this.check(TokenType.MINUS)) {
      const op = this.advance();
      const right = this.parseTerm(program);
      left = IR.createBinaryExpr(op.value, left, right, 'int');
    }
    
    return left;
  }
  
  parseTerm(program) {
    let left = this.parseUnary(program);
    
    while (this.check(TokenType.STAR) || this.check(TokenType.SLASH) || this.check(TokenType.PERCENT)) {
      const op = this.advance();
      const right = this.parseUnary(program);
      left = IR.createBinaryExpr(op.value, left, right, 'int');
    }
    
    return left;
  }
  
  parseUnary(program) {
    // Unary NOT: !expr
    if (this.check(TokenType.NOT)) {
      const op = this.advance();
      const operand = this.parseUnary(program);
      return IR.createUnaryExpr('!', operand, 'bool');
    }
    
    // Unary MINUS: -expr
    if (this.check(TokenType.MINUS)) {
      const op = this.advance();
      const operand = this.parseUnary(program);
      return IR.createUnaryExpr('-', operand, 'int');
    }
    
    // Bitwise NOT: ~expr
    if (this.check(TokenType.TILDE)) {
      const op = this.advance();
      const operand = this.parseUnary(program);
      return IR.createUnaryExpr('~', operand, 'int');
    }
    
    return this.parsePrimary(program);
  }
  
  parsePrimary(program) {
    // Number literal
    if (this.check(TokenType.NUMBER)) {
      const token = this.advance();
      return IR.createLiteralExpr('int', token.value);
    }
    
    // Boolean literal true
    if (this.check(TokenType.TRUE)) {
      this.advance();
      return IR.createLiteralExpr('bool', 1);  // true = 1
    }
    
    // Boolean literal false
    if (this.check(TokenType.FALSE)) {
      this.advance();
      return IR.createLiteralExpr('bool', 0);  // false = 0
    }
    
    // String literal
    if (this.check(TokenType.STRING_LITERAL)) {
      const token = this.advance();
      return IR.createLiteralExpr('string', token.value);
    }
    
    // Identifier (variable reference or function call)
    if (this.check(TokenType.IDENTIFIER)) {
      const name = this.advance();
      
      // Check for function call
      if (this.check(TokenType.LPAREN)) {
        return this.parseCallExpr(name.value, program);
      }
      
      // Variable reference - determine type from declarations
      const decl = program.declarations.find(d => d.name === name.value);
      const type = decl ? decl.value.type : 'int';
      return IR.createVariableExpr(name.value, type);
    }
    
    // Parenthesized expression
    if (this.match(TokenType.LPAREN)) {
      const expr = this.parseExpression(program);
      this.expect(TokenType.RPAREN, 'Expected ")"');
      return expr;
    }
    
    throw new Error(`Unexpected token in expression: ${this.current().type} at ${this.current().line}:${this.current().column}`);
  }
  
  // Legacy method for backward compatibility
  parseFactor(program) {
    return this.parsePrimary(program);
  }
  
  parseCallExpr(functionName, program) {
    this.expect(TokenType.LPAREN, 'Expected "("');
    
    const args = [];
    if (!this.check(TokenType.RPAREN)) {
      do {
        args.push(this.parseExpression(program));
      } while (this.match(TokenType.COMMA));
    }
    
    this.expect(TokenType.RPAREN, 'Expected ")"');
    
    // Try to look up function return type from declarations
    let returnType = 'int';
    const parentDecls = program.parentDeclarations || program.declarations;
    const fnDecl = parentDecls.find(d => d.kind === 'fn' && d.name === functionName);
    if (fnDecl) {
      returnType = fnDecl.returnType;
    }
    
    return IR.createCallExpr(functionName, args, returnType);
  }
  
  // ==========================================================================
  // Type parsing
  // ==========================================================================
  
  parseType() {
    if (this.match(TokenType.INT)) return 'int';
    if (this.match(TokenType.STRING)) return 'string';
    if (this.match(TokenType.BOOL)) return 'bool';
    throw new Error(`Expected type at ${this.current().line}:${this.current().column}`);
  }
}

/**
 * Parse source code to IR
 * @param {string} source - Aurora source code
 * @param {string} sourceFile - Source file path
 * @returns {Object} IR program
 */
function parseSource(source, sourceFile) {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  return parser.parseProgram(sourceFile);
}

module.exports = {
  Parser,
  parseSource,
};
