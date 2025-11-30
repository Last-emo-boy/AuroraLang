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
    } else if (this.check(TokenType.FN) || this.check(TokenType.SHARED)) {
      // Implicit module (bare functions and shared variables)
      this.parseImplicitModuleProgram(program);
    } else {
      this.parseFlatProgram(program);
    }
    
    return program;
  }
  
  // Parse an implicit module (file with functions but no module {} wrapper)
  parseImplicitModuleProgram(program) {
    program.moduleName = 'main';
    program.sharedVars = [];
    
    // Parse function declarations and shared variables until EOF
    while (!this.check(TokenType.EOF)) {
      if (this.check(TokenType.FN)) {
        const fnDecl = this.parseFunctionDecl(program);
        program.declarations.push(fnDecl);
      } else if (this.check(TokenType.SHARED)) {
        const sharedDecl = this.parseSharedDecl(program);
        program.sharedVars.push(sharedDecl);
      } else {
        throw new Error(`Unexpected token at module level: ${this.current().type}`);
      }
    }
  }
  
  parseModuleProgram(program) {
    this.expect(TokenType.MODULE, 'Expected "module"');
    const moduleName = this.expect(TokenType.IDENTIFIER, 'Expected module name');
    program.moduleName = moduleName.value;
    program.sharedVars = [];  // Track shared variables
    this.expect(TokenType.LBRACE, 'Expected "{"');
    
    // Parse function declarations and shared variables
    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      if (this.check(TokenType.FN)) {
        const fnDecl = this.parseFunctionDecl(program);
        program.declarations.push(fnDecl);
      } else if (this.check(TokenType.SHARED)) {
        const sharedDecl = this.parseSharedDecl(program);
        program.sharedVars.push(sharedDecl);
      } else {
        throw new Error(`Unexpected token in module: ${this.current().type}`);
      }
    }
    
    this.expect(TokenType.RBRACE, 'Expected "}"');
  }
  
  // Parse shared variable declaration: shared counter: int = 0;
  parseSharedDecl(program) {
    this.expect(TokenType.SHARED, 'Expected "shared"');
    const name = this.expect(TokenType.IDENTIFIER, 'Expected variable name');
    this.expect(TokenType.COLON, 'Expected ":"');
    const type = this.parseType();
    this.expect(TokenType.ASSIGN, 'Expected "="');
    const value = this.parseExpression(program);
    this.expect(TokenType.SEMICOLON, 'Expected ";"');
    
    return IR.createSharedDecl(name.value, type, value);
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
    
    // Return type is optional (defaults to 'void')
    let returnType = 'void';
    if (this.match(TokenType.ARROW)) {
      returnType = this.parseType();
    }
    
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
      
      let value;
      // Check for spawn expression
      if (this.check(TokenType.SPAWN)) {
        value = this.parseSpawnExpression(fnContext);
      } else {
        value = this.parseExpression(fnContext);
      }
      this.expect(TokenType.SEMICOLON, 'Expected ";"');
      
      // Store the variable type in the context for later reference
      fnContext.varTypes = fnContext.varTypes || new Map();
      fnContext.varTypes.set(name.value, type);
      
      const letDecl = IR.createLetDecl(name.value, value, type);
      fnContext.declarations.push(letDecl);
      // Also push to statements to preserve source order
      block.statements.push(letDecl);
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
    } else if (this.check(TokenType.PRINT)) {
      const stmt = this.parsePrintStatement(fnContext);
      block.statements.push(stmt);
    } else if (this.check(TokenType.RETURN)) {
      const stmt = this.parseReturnStatement(fnContext);
      block.statements.push(stmt);
    } else if (this.check(TokenType.JOIN)) {
      const stmt = this.parseJoinStatement(fnContext);
      block.statements.push(stmt);
    } else if (this.check(TokenType.ATOMIC)) {
      const stmt = this.parseAtomicStatement(fnContext);
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
    } else if (this.check(TokenType.PRINT)) {
      const stmt = this.parsePrintStatement(program);
      program.body.statements.push(stmt);
    } else if (this.check(TokenType.RETURN)) {
      const stmt = this.parseReturnStatement(program);
      program.body.statements.push(stmt);
    } else if (this.check(TokenType.JOIN)) {
      const stmt = this.parseJoinStatement(program);
      program.body.statements.push(stmt);
    } else if (this.check(TokenType.IDENTIFIER)) {
      // Assignment statement
      const stmt = this.parseAssignmentStatement(program);
      program.body.statements.push(stmt);
    } else {
      throw new Error(`Unexpected token: ${this.current().type} at ${this.current().line}:${this.current().column}`);
    }
  }
  
  // Parse print statement: print(arg);
  // Supports both string literals and integer expressions
  parsePrintStatement(program) {
    this.expect(TokenType.PRINT, 'Expected "print"');
    this.expect(TokenType.LPAREN, 'Expected "("');
    
    const args = [];
    if (!this.check(TokenType.RPAREN)) {
      do {
        args.push(this.parseExpression(program));
      } while (this.match(TokenType.COMMA));
    }
    
    this.expect(TokenType.RPAREN, 'Expected ")"');
    this.expect(TokenType.SEMICOLON, 'Expected ";"');
    
    // Reuse request statement with 'print' service
    return IR.createRequestStmt('print', args);
  }
  
  parseJoinStatement(program) {
    this.expect(TokenType.JOIN, 'Expected "join"');
    const handleName = this.expect(TokenType.IDENTIFIER, 'Expected thread handle variable');
    this.expect(TokenType.SEMICOLON, 'Expected ";"');
    
    return IR.createJoinStmt(handleName.value);
  }
  
  // Parse atomic statement: atomic.add(target, value);
  parseAtomicStatement(fnContext) {
    this.expect(TokenType.ATOMIC, 'Expected "atomic"');
    this.expect(TokenType.DOT, 'Expected "."');
    
    const operation = this.expect(TokenType.IDENTIFIER, 'Expected atomic operation (add, fadd, sub, load, store, cas)');
    this.expect(TokenType.LPAREN, 'Expected "("');
    
    const target = this.expect(TokenType.IDENTIFIER, 'Expected target variable');
    
    let value = null;
    let expected = null;
    let newValue = null;
    
    const op = operation.value.toLowerCase();
    
    if (op === 'load') {
      // atomic.load(target) - no additional args
    } else if (op === 'store' || op === 'add' || op === 'sub' || op === 'fadd') {
      // atomic.store(target, value), atomic.add(target, value), atomic.sub(target, value), atomic.fadd(target, value)
      this.expect(TokenType.COMMA, 'Expected ","');
      value = this.parseExpression(fnContext);
    } else if (op === 'cas') {
      // atomic.cas(target, expected, new_value)
      this.expect(TokenType.COMMA, 'Expected ","');
      expected = this.parseExpression(fnContext);
      this.expect(TokenType.COMMA, 'Expected ","');
      newValue = this.parseExpression(fnContext);
    } else {
      throw new Error(`Unknown atomic operation: ${op}. Expected add, fadd, sub, load, store, or cas`);
    }
    
    this.expect(TokenType.RPAREN, 'Expected ")"');
    this.expect(TokenType.SEMICOLON, 'Expected ";"');
    
    return IR.createAtomicExpr(op, target.value, value, expected, newValue);
  }
  
  // Parse shared variable declaration: shared counter: int = 0;
  parseSharedDecl(program) {
    this.expect(TokenType.SHARED, 'Expected "shared"');
    const name = this.expect(TokenType.IDENTIFIER, 'Expected variable name');
    this.expect(TokenType.COLON, 'Expected ":"');
    const type = this.parseType();
    this.expect(TokenType.ASSIGN, 'Expected "="');
    const initialValue = this.parsePrimary(program);
    this.expect(TokenType.SEMICOLON, 'Expected ";"');
    
    return IR.createSharedDecl(name.value, type, initialValue);
  }
  
  parseLetStatement(program) {
    this.expect(TokenType.LET, 'Expected "let"');
    const name = this.expect(TokenType.IDENTIFIER, 'Expected variable name');
    this.expect(TokenType.COLON, 'Expected ":"');
    const type = this.parseType();
    this.expect(TokenType.ASSIGN, 'Expected "="');
    
    let value;
    // Check for spawn expression: let t: thread = spawn func();
    if (this.check(TokenType.SPAWN)) {
      value = this.parseSpawnExpression(program);
    } else {
      value = this.parseExpression(program);
    }
    this.expect(TokenType.SEMICOLON, 'Expected ";"');
    
    program.declarations.push(IR.createLetDecl(name.value, value, type));
  }
  
  parseSpawnExpression(program) {
    this.expect(TokenType.SPAWN, 'Expected "spawn"');
    const funcName = this.expect(TokenType.IDENTIFIER, 'Expected function name');
    this.expect(TokenType.LPAREN, 'Expected "("');
    this.expect(TokenType.RPAREN, 'Expected ")"');
    
    return IR.createSpawnExpr(funcName.value);
  }
  
  parseAssignmentStatement(program) {
    const name = this.expect(TokenType.IDENTIFIER, 'Expected variable name');
    
    // Check for function call statement: func();
    if (this.check(TokenType.LPAREN)) {
      this.advance();  // consume '('
      const args = [];
      if (!this.check(TokenType.RPAREN)) {
        do {
          args.push(this.parseExpression(program));
        } while (this.match(TokenType.COMMA));
      }
      this.expect(TokenType.RPAREN, 'Expected ")"');
      this.expect(TokenType.SEMICOLON, 'Expected ";"');
      
      // Create a call expression as a statement (discarding return value)
      return IR.createCallStmt(name.value, args);
    }
    
    // Check for array element assignment: arr[index] = value
    if (this.check(TokenType.LBRACKET)) {
      this.advance();  // consume '['
      const indexExpr = this.parseExpression(program);
      this.expect(TokenType.RBRACKET, 'Expected "]"');
      this.expect(TokenType.ASSIGN, 'Expected "="');
      const value = this.parseExpression(program);
      this.expect(TokenType.SEMICOLON, 'Expected ";"');
      
      return IR.createArrayAssignStmt(name.value, indexExpr, value);
    }
    
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
    
    // Service name can be IDENTIFIER or PRINT (since print is now a keyword)
    let service;
    if (this.check(TokenType.PRINT)) {
      service = this.advance();
      service.value = 'print';  // Normalize token value
    } else {
      service = this.expect(TokenType.IDENTIFIER, 'Expected service name');
    }
    
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
    
    return this.parsePostfix(program);
  }
  
  // Parse postfix expressions including type cast (as)
  parsePostfix(program) {
    let expr = this.parsePrimary(program);
    
    // Handle 'as' type cast: expr as int, expr as float
    while (this.check(TokenType.AS)) {
      this.advance(); // consume 'as'
      
      // Parse target type
      let targetType;
      if (this.check(TokenType.INT)) {
        this.advance();
        targetType = 'int';
      } else if (this.check(TokenType.FLOAT)) {
        this.advance();
        targetType = 'float';
      } else {
        throw new Error(`Expected type after 'as' at ${this.current().line}:${this.current().column}`);
      }
      
      expr = IR.createCastExpr(targetType, expr);
    }
    
    return expr;
  }
  
  parsePrimary(program) {
    // Integer literal
    if (this.check(TokenType.NUMBER)) {
      const token = this.advance();
      return IR.createLiteralExpr('int', token.value);
    }
    
    // Float literal
    if (this.check(TokenType.FLOAT_NUMBER)) {
      const token = this.advance();
      return IR.createLiteralExpr('float', token.value);
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
    
    // Input expression: input()
    if (this.check(TokenType.INPUT)) {
      this.advance();  // consume 'input'
      this.expect(TokenType.LPAREN, 'Expected "(" after input');
      this.expect(TokenType.RPAREN, 'Expected ")"');
      return IR.createInputExpr('int');  // Returns int
    }
    
    // Math functions: sqrt(x), pow(x, n)
    if (this.check(TokenType.SQRT)) {
      this.advance();  // consume 'sqrt'
      this.expect(TokenType.LPAREN, 'Expected "("');
      const arg = this.parseExpression(program);
      this.expect(TokenType.RPAREN, 'Expected ")"');
      return IR.createMathCall('sqrt', [arg]);
    }
    
    if (this.check(TokenType.POW)) {
      this.advance();  // consume 'pow'
      this.expect(TokenType.LPAREN, 'Expected "("');
      const base = this.parseExpression(program);
      this.expect(TokenType.COMMA, 'Expected ","');
      const exp = this.parseExpression(program);
      this.expect(TokenType.RPAREN, 'Expected ")"');
      return IR.createMathCall('pow', [base, exp]);
    }
    
    // Spawn expression: spawn func()
    if (this.check(TokenType.SPAWN)) {
      return this.parseSpawnExpression(program);
    }
    
    // Atomic load expression: atomic.load(varname)
    if (this.check(TokenType.ATOMIC)) {
      this.advance();  // consume 'atomic'
      this.expect(TokenType.DOT, 'Expected "."');
      const op = this.expect(TokenType.IDENTIFIER, 'Expected atomic operation');
      if (op.value !== 'load') {
        throw new Error(`atomic.${op.value} cannot be used as an expression. Only atomic.load is allowed.`);
      }
      this.expect(TokenType.LPAREN, 'Expected "("');
      const varName = this.expect(TokenType.IDENTIFIER, 'Expected variable name');
      this.expect(TokenType.RPAREN, 'Expected ")"');
      return IR.createAtomicLoadExpr(varName.value, 'int');
    }
    
    // Array literal: [1, 2, 3]
    if (this.check(TokenType.LBRACKET)) {
      return this.parseArrayLiteral(program);
    }
    
    // Identifier (variable reference, function call, or array access)
    if (this.check(TokenType.IDENTIFIER)) {
      const name = this.advance();
      
      // Check for function call
      if (this.check(TokenType.LPAREN)) {
        return this.parseCallExpr(name.value, program);
      }
      
      // Check for array access: arr[index]
      if (this.check(TokenType.LBRACKET)) {
        this.advance();  // consume '['
        const indexExpr = this.parseExpression(program);
        this.expect(TokenType.RBRACKET, 'Expected "]"');
        
        // Determine element type from declaration
        const decl = program.declarations.find(d => d.name === name.value);
        let elementType = 'int';
        if (decl && decl.value.type.startsWith('array<')) {
          const match = decl.value.type.match(/array<(.+)>/);
          if (match) elementType = match[1];
        }
        
        const arrayExpr = IR.createVariableExpr(name.value, decl ? decl.value.type : 'array<int>');
        return IR.createArrayAccessExpr(arrayExpr, indexExpr, elementType);
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
  
  // Parse array literal: [expr, expr, ...]
  parseArrayLiteral(program) {
    this.expect(TokenType.LBRACKET, 'Expected "["');
    
    const elements = [];
    let elementType = 'int';  // Default type
    
    if (!this.check(TokenType.RBRACKET)) {
      do {
        const elem = this.parseExpression(program);
        elements.push(elem);
        if (elements.length === 1 && elem.type) {
          elementType = elem.type;
        }
      } while (this.match(TokenType.COMMA));
    }
    
    this.expect(TokenType.RBRACKET, 'Expected "]"');
    
    return IR.createArrayLiteralExpr(elements, elementType);
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
    if (this.match(TokenType.FLOAT)) return 'float';
    if (this.match(TokenType.STRING)) return 'string';
    if (this.match(TokenType.BOOL)) return 'bool';
    if (this.match(TokenType.THREAD)) return 'thread';
    
    // Array type: array<elementType>
    if (this.check(TokenType.IDENTIFIER) && this.current().value === 'array') {
      this.advance();  // consume 'array'
      this.expect(TokenType.LT, 'Expected "<" after array');
      const elementType = this.parseType();
      this.expect(TokenType.GT, 'Expected ">" after element type');
      return `array<${elementType}>`;
    }
    
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
