# Aurora Language Parser Design (Draft)

> Bridges Aurora source files (`.aur`) to the Aurora Seed DSL manifests (`.aurs`) used by the handcrafted interpreter.

## Goals
- Accept the Stage 3+ AuroraLang syntax defined in `specs/specification.md` (BNF subset) and produce a verified abstract syntax tree (AST).
- Maintain a zero-dependency implementation path consistent with Stage 0/Stage 1 tooling—no parser generators.
- Preserve enough semantic information to drive both bytecode emission (future VM) and `.aurs` manifest generation for Stage 0 bootstrap scenarios.

## Scope (Iteration 10)
- Tokenizer design covering keywords, identifiers, literals, delimiters, and comments.
- Recursive-descent parser layout aligned with the published grammar.
- AST data model capturing modules, declarations, statements, expressions, and patterns.
- Error handling strategy suitable for early tooling (panic-on-error with context, deferrable diagnostics roadmap).
- Interfaces for downstream translation stages (AST → directive plan → `.aurs`).

Two complementary documents will follow:
1. **Bytecode/Directive Mapping** (`aurora_to_aurs_pipeline.md`): Specifies how AST nodes become `.aurs` directives.
2. **Conversion Tool Plan**: Implementation playbook for the first script-to-manifest translator.

## Tokenizer

### Character Classes
- **Whitespace**: `\u0020`, `\t`, `\r`, `\n` (line tracking needed for diagnostics).
- **Digits**: `0-9`.
- **Letters**: `A-Z`, `a-z`, `_` (underscore).
- **Punctuation**: `(){}[];,`.<`>` `+-*/%=&|!~:^"'` etc.

### Token Types
- Keywords: `module`, `fn`, `type`, `import`, `let`, `mut`, `if`, `else`, `while`, `for`, `return`, `match`, `spawn`, `await`, `channel`, `select`, `true`, `false` (extendable).
- Identifiers: `[A-Za-z_][A-Za-z0-9_]*`.
- Literals:
  - Integer: decimal and hexadecimal (`0x` prefix), stored as 128-bit signed to future-proof.
  - Float: decimal with optional exponent.
  - String: double-quoted with escapes (`\n`, `\t`, `\"`, `\\`).
  - Boolean: `true`/`false` already covered as keywords.
- Operators: multi-char sequences prioritized (`==`, `!=`, `<=`, `>=`, `&&`, `||`, `->`), then single char (`+ - * / % < > = ! & | ^`).
- Delimiters: `(` `)` `{` `}` `[` `]` `,` `;` `:`.
- Comments: `//` to end of line (ignored tokens, but tracked for future doc generation).

### Token Struct
```
struct Token {
    kind: TokenKind,
    lexeme_offset: u32,   // byte offset in source
    length: u16,
    line: u32,
    column: u16,
}
```

Tokenizer emits `EOF` sentinel for parser loop.

## Parser Architecture
- **Strategy**: Hand-written recursive descent with Pratt-style expression parsing (precedence table for binary operators).
- **Modules**: `parse_program` orchestrates module/import/type/fn declarations.
- **Error Recovery**: Initial iteration stops at first error; later iterations can add panic-mode via synchronizing tokens (`;`, `}`).

### Precedence Table (high → low)
1. Unary: `!`, `-`.
2. Multiplicative: `*`, `/`, `%`.
3. Additive: `+`, `-`.
4. Relational: `<`, `>`, `<=`, `>=`.
5. Equality: `==`, `!=`.
6. Logical AND: `&&`.
7. Logical OR: `||`.

### Core Functions
- `parse_module() -> Module`
- `parse_declaration() -> Decl`
- `parse_fn_decl() -> FnDecl`
- `parse_type_decl() -> TypeDecl`
- `parse_statement() -> Stmt`
- `parse_expression(precedence) -> Expr`
- `parse_pattern() -> Pattern`

Each function expects specific token sequences, raising descriptive errors on mismatch.

## AST Data Model (Initial)
```
Program {
    modules: Vec<Module>,
    declarations: Vec<Decl>,
}

Module {
    name: Ident,
    declarations: Vec<Decl>,
}

Decl = Fn(FnDecl) | Type(TypeDecl) | Import(ImportDecl)

FnDecl {
    name: Ident,
    params: Vec<Param>,
    return_type: Option<TypeExpr>,
    body: Block,
}

Param { name: Ident, ty: TypeExpr, mutable: bool }
Block { statements: Vec<Stmt> }

Stmt = Let(LetStmt) | Expr(Expr) | If(IfStmt) | While(WhileStmt)
     | For(ForStmt) | Return(ReturnStmt) | Block(Block)

Expr = Literal(Lit) | Ident(Ident) | Call(CallExpr)
     | Binary { left, op, right } | Unary { op, operand }
     | IfExpr(IfExpr) | Match(MatchExpr) | Group(Box<Expr>)

Pattern = Ident | Literal(Lit) | Constructor { name, fields }
```

Type expressions and generics are maintained in canonical forms for the later type checker.

## Diagnostics & Metadata
- Track symbol table scaffolding during parsing (module scope, function params, local `let` bindings) to aid future semantic passes.
- Gather doc comments once the parser supports them (prefix `///`).
- Provide hooks for instrumentation (AST logging, parse tracing) controlled via CLI flags (e.g., `--trace-parser`).

## Integration with `.aurs` Generation
1. **AST Walk**: Convert top-level declarations to directive plans (function tables, string pools, static data).
2. **Directive Plan**: Structured list describing what `.aurs` blocks to emit (`header`, `org`, `label`, etc.).
3. **Emitter**: Serialize plan to textual `.aurs`, reusing existing manifest conventions.

Initial focus: compile a restricted Aurora subset (module-less script with a single `fn main()`) into a `.aurs` manifest that the handcrafted interpreter can turn into a stub ELF printing constants (smoke test).

## Milestones
1. **Tokenizer Prototype**: Validate against sample Aurora snippets, confirm token stream.
2. **Parser MVP**: Support functions, statements, expressions without pattern matching.
3. **AST-to-Directive Mapping Sketch**: Outline for constant data and simple function body translation (no control flow yet).
4. **End-to-End Demo**: Source file → AST → `.aurs` manifest that emits a static string via interpreter.

Future phases refine semantic analysis, borrowing rules, concurrency primitives, and binary emission.
