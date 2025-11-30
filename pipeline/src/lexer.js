/**
 * Aurora Lexer - Tokenizes source code
 * 
 * A simple but complete lexer for Aurora language.
 * Converts source text into a stream of tokens.
 */

const TokenType = {
  // Keywords
  MODULE: 'MODULE',
  FN: 'FN',
  LET: 'LET',
  IF: 'IF',
  ELSE: 'ELSE',
  WHILE: 'WHILE',
  FOR: 'FOR',
  IN: 'IN',
  BREAK: 'BREAK',
  CONTINUE: 'CONTINUE',
  STEP: 'STEP',
  RETURN: 'RETURN',
  REQUEST: 'REQUEST',
  SERVICE: 'SERVICE',
  TRUE: 'TRUE',
  FALSE: 'FALSE',
  SHARED: 'SHARED',       // shared variable declaration
  ATOMIC: 'ATOMIC',       // atomic operation prefix
  
  // Types
  INT: 'INT',
  FLOAT: 'FLOAT',
  STRING: 'STRING',
  BOOL: 'BOOL',
  THREAD: 'THREAD',       // thread type for handles
  
  // Thread keywords
  SPAWN: 'SPAWN',         // spawn
  JOIN: 'JOIN',           // join
  
  // I/O keywords
  PRINT: 'PRINT',         // print builtin
  INPUT: 'INPUT',         // input builtin
  
  // Type conversion
  AS: 'AS',               // as (type cast)
  
  // Math functions
  SQRT: 'SQRT',           // sqrt(float)
  POW: 'POW',             // pow(float, float)
  
  // Literals
  NUMBER: 'NUMBER',
  FLOAT_NUMBER: 'FLOAT_NUMBER',
  STRING_LITERAL: 'STRING_LITERAL',
  
  // Identifiers
  IDENTIFIER: 'IDENTIFIER',
  
  // Operators
  PLUS: 'PLUS',           // +
  MINUS: 'MINUS',         // -
  STAR: 'STAR',           // *
  SLASH: 'SLASH',         // /
  PERCENT: 'PERCENT',     // %
  ASSIGN: 'ASSIGN',       // =
  EQ: 'EQ',               // ==
  NEQ: 'NEQ',             // !=
  LT: 'LT',               // <
  GT: 'GT',               // >
  LEQ: 'LEQ',             // <=
  GEQ: 'GEQ',             // >=
  
  // Logical operators
  AND: 'AND',             // &&
  OR: 'OR',               // ||
  NOT: 'NOT',             // !
  
  // Bitwise operators
  AMPERSAND: 'AMPERSAND', // &
  PIPE: 'PIPE',           // |
  CARET: 'CARET',         // ^
  TILDE: 'TILDE',         // ~
  SHL: 'SHL',             // <<
  SHR: 'SHR',             // >>
  
  // Delimiters
  LPAREN: 'LPAREN',       // (
  RPAREN: 'RPAREN',       // )
  LBRACE: 'LBRACE',       // {
  RBRACE: 'RBRACE',       // }
  LBRACKET: 'LBRACKET',   // [
  RBRACKET: 'RBRACKET',   // ]
  COMMA: 'COMMA',         // ,
  COLON: 'COLON',         // :
  SEMICOLON: 'SEMICOLON', // ;
  ARROW: 'ARROW',         // ->
  DOTDOT: 'DOTDOT',       // .. (range)
  DOT: 'DOT',             // . (member access)
  
  // Special
  EOF: 'EOF',
};

const KEYWORDS = {
  'module': TokenType.MODULE,
  'fn': TokenType.FN,
  'let': TokenType.LET,
  'if': TokenType.IF,
  'else': TokenType.ELSE,
  'while': TokenType.WHILE,
  'for': TokenType.FOR,
  'in': TokenType.IN,
  'break': TokenType.BREAK,
  'continue': TokenType.CONTINUE,
  'step': TokenType.STEP,
  'return': TokenType.RETURN,
  'request': TokenType.REQUEST,
  'service': TokenType.SERVICE,
  'int': TokenType.INT,
  'float': TokenType.FLOAT,
  'string': TokenType.STRING,
  'bool': TokenType.BOOL,
  'thread': TokenType.THREAD,
  'spawn': TokenType.SPAWN,
  'join': TokenType.JOIN,
  'print': TokenType.PRINT,
  'input': TokenType.INPUT,
  'as': TokenType.AS,
  'sqrt': TokenType.SQRT,
  'pow': TokenType.POW,
  'shared': TokenType.SHARED,
  'atomic': TokenType.ATOMIC,
  'true': TokenType.TRUE,
  'false': TokenType.FALSE,
};

class Token {
  constructor(type, value, line, column) {
    this.type = type;
    this.value = value;
    this.line = line;
    this.column = column;
  }
  
  toString() {
    return `Token(${this.type}, ${JSON.stringify(this.value)}, ${this.line}:${this.column})`;
  }
}

class Lexer {
  constructor(source) {
    this.source = source;
    this.pos = 0;
    this.line = 1;
    this.column = 1;
    this.tokens = [];
  }
  
  tokenize() {
    while (this.pos < this.source.length) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.source.length) break;
      
      const token = this.nextToken();
      if (token) {
        this.tokens.push(token);
      }
    }
    
    this.tokens.push(new Token(TokenType.EOF, null, this.line, this.column));
    return this.tokens;
  }
  
  skipWhitespaceAndComments() {
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        this.advance();
      } else if (ch === '\n') {
        this.advance();
        this.line++;
        this.column = 1;
      } else if (ch === '/' && this.peek(1) === '/') {
        // Line comment
        while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
          this.advance();
        }
      } else if (ch === '/' && this.peek(1) === '*') {
        // Block comment
        this.advance(); // skip /
        this.advance(); // skip *
        while (this.pos < this.source.length) {
          if (this.source[this.pos] === '*' && this.peek(1) === '/') {
            this.advance(); // skip *
            this.advance(); // skip /
            break;
          }
          if (this.source[this.pos] === '\n') {
            this.line++;
            this.column = 1;
          }
          this.advance();
        }
      } else {
        break;
      }
    }
  }
  
  advance() {
    this.pos++;
    this.column++;
  }
  
  peek(offset = 0) {
    const idx = this.pos + offset;
    return idx < this.source.length ? this.source[idx] : null;
  }
  
  current() {
    return this.source[this.pos];
  }
  
  nextToken() {
    const startLine = this.line;
    const startColumn = this.column;
    const ch = this.current();
    
    // String literal
    if (ch === '"') {
      return this.readString(startLine, startColumn);
    }
    
    // Number literal
    if (this.isDigit(ch) || (ch === '-' && this.isDigit(this.peek(1)))) {
      return this.readNumber(startLine, startColumn);
    }
    
    // Identifier or keyword
    if (this.isAlpha(ch) || ch === '_') {
      return this.readIdentifier(startLine, startColumn);
    }
    
    // Multi-character operators
    if (ch === '-' && this.peek(1) === '>') {
      this.advance();
      this.advance();
      return new Token(TokenType.ARROW, '->', startLine, startColumn);
    }
    if (ch === '.') {
      if (this.peek(1) === '.') {
        this.advance();
        this.advance();
        return new Token(TokenType.DOTDOT, '..', startLine, startColumn);
      } else {
        this.advance();
        return new Token(TokenType.DOT, '.', startLine, startColumn);
      }
    }
    if (ch === '&' && this.peek(1) === '&') {
      this.advance();
      this.advance();
      return new Token(TokenType.AND, '&&', startLine, startColumn);
    }
    if (ch === '|' && this.peek(1) === '|') {
      this.advance();
      this.advance();
      return new Token(TokenType.OR, '||', startLine, startColumn);
    }
    if (ch === '=' && this.peek(1) === '=') {
      this.advance();
      this.advance();
      return new Token(TokenType.EQ, '==', startLine, startColumn);
    }
    if (ch === '!' && this.peek(1) === '=') {
      this.advance();
      this.advance();
      return new Token(TokenType.NEQ, '!=', startLine, startColumn);
    }
    // Single '!' is logical NOT
    if (ch === '!') {
      this.advance();
      return new Token(TokenType.NOT, '!', startLine, startColumn);
    }
    if (ch === '<' && this.peek(1) === '=') {
      this.advance();
      this.advance();
      return new Token(TokenType.LEQ, '<=', startLine, startColumn);
    }
    if (ch === '>' && this.peek(1) === '=') {
      this.advance();
      this.advance();
      return new Token(TokenType.GEQ, '>=', startLine, startColumn);
    }
    // Shift operators (must be before single-char < and >)
    if (ch === '<' && this.peek(1) === '<') {
      this.advance();
      this.advance();
      return new Token(TokenType.SHL, '<<', startLine, startColumn);
    }
    if (ch === '>' && this.peek(1) === '>') {
      this.advance();
      this.advance();
      return new Token(TokenType.SHR, '>>', startLine, startColumn);
    }
    
    // Single-character tokens
    const singleCharTokens = {
      '+': TokenType.PLUS,
      '-': TokenType.MINUS,
      '*': TokenType.STAR,
      '/': TokenType.SLASH,
      '%': TokenType.PERCENT,
      '=': TokenType.ASSIGN,
      '<': TokenType.LT,
      '>': TokenType.GT,
      '&': TokenType.AMPERSAND,
      '|': TokenType.PIPE,
      '^': TokenType.CARET,
      '~': TokenType.TILDE,
      '(': TokenType.LPAREN,
      ')': TokenType.RPAREN,
      '{': TokenType.LBRACE,
      '}': TokenType.RBRACE,
      '[': TokenType.LBRACKET,
      ']': TokenType.RBRACKET,
      ',': TokenType.COMMA,
      ':': TokenType.COLON,
      ';': TokenType.SEMICOLON,
    };
    
    if (singleCharTokens[ch]) {
      this.advance();
      return new Token(singleCharTokens[ch], ch, startLine, startColumn);
    }
    
    throw new Error(`Unexpected character '${ch}' at ${startLine}:${startColumn}`);
  }
  
  readString(startLine, startColumn) {
    this.advance(); // skip opening quote
    let value = '';
    
    while (this.pos < this.source.length && this.current() !== '"') {
      if (this.current() === '\\') {
        this.advance();
        const escaped = this.current();
        switch (escaped) {
          case 'n': value += '\n'; break;
          case 't': value += '\t'; break;
          case 'r': value += '\r'; break;
          case '\\': value += '\\'; break;
          case '"': value += '"'; break;
          default: value += escaped;
        }
      } else {
        value += this.current();
      }
      this.advance();
    }
    
    if (this.current() !== '"') {
      throw new Error(`Unterminated string at ${startLine}:${startColumn}`);
    }
    this.advance(); // skip closing quote
    
    return new Token(TokenType.STRING_LITERAL, value, startLine, startColumn);
  }
  
  readNumber(startLine, startColumn) {
    let value = '';
    let isFloat = false;
    
    if (this.current() === '-') {
      value += '-';
      this.advance();
    }
    
    while (this.pos < this.source.length && this.isDigit(this.current())) {
      value += this.current();
      this.advance();
    }
    
    // Check for decimal point
    if (this.current() === '.' && this.isDigit(this.peek(1))) {
      isFloat = true;
      value += '.';
      this.advance();
      
      while (this.pos < this.source.length && this.isDigit(this.current())) {
        value += this.current();
        this.advance();
      }
    }
    
    // Check for exponent
    if (this.current() === 'e' || this.current() === 'E') {
      isFloat = true;
      value += this.current();
      this.advance();
      
      if (this.current() === '+' || this.current() === '-') {
        value += this.current();
        this.advance();
      }
      
      while (this.pos < this.source.length && this.isDigit(this.current())) {
        value += this.current();
        this.advance();
      }
    }
    
    if (isFloat) {
      return new Token(TokenType.FLOAT_NUMBER, Number.parseFloat(value), startLine, startColumn);
    }
    return new Token(TokenType.NUMBER, Number.parseInt(value, 10), startLine, startColumn);
  }
  
  readIdentifier(startLine, startColumn) {
    let value = '';
    
    while (this.pos < this.source.length && (this.isAlphaNumeric(this.current()) || this.current() === '_')) {
      value += this.current();
      this.advance();
    }
    
    const type = KEYWORDS[value] || TokenType.IDENTIFIER;
    return new Token(type, value, startLine, startColumn);
  }
  
  isDigit(ch) {
    return ch >= '0' && ch <= '9';
  }
  
  isAlpha(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
  }
  
  isAlphaNumeric(ch) {
    return this.isAlpha(ch) || this.isDigit(ch);
  }
}

function tokenize(source) {
  const lexer = new Lexer(source);
  return lexer.tokenize();
}

module.exports = {
  TokenType,
  Token,
  Lexer,
  tokenize,
};
