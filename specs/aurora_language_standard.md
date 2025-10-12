# Aurora Language Standard — Draft Outline

> Status: Draft (2025-10-10) — establishes the structure for the authoritative Aurora language specification prior to full elaboration.

## 1. Scope & Goals
- Define the canonical syntax, semantics, and runtime contracts of Aurora v1.
- Provide translation hooks from human-readable ("natural language") authoring conventions into canonical Aurora source files (`.aur`).
- Anchor the downstream compilation targets, including the Aurora Seed DSL manifests and eventual machine code emission.

## 2. Notation & Conventions
- **Grammar Notation**: EBNF extended with annotations for precedence levels and associativity.
- **Lexical Grammar**: Character sets, Unicode policy (restrict to ASCII for Stage 0), comment forms, whitespace handling.
- **Semantic Keywords**: Reserved words list; rationale for each reserved token.
- **Numeric Bases**: Decimal default, prefixes for binary (`0b`), hexadecimal (`0x`), base-n constructs (future work).

## 3. Module System
- Module declaration syntax (`module name { ... }`).
- Visibility rules (`pub`/`internal` markers TBD).
- Import system semantics, including namespacing and aliasing.

## 4. Types
- Primitive scalar types (`int`, `float`, `bool`, `string`, `byte`?).
- Composite types: tuples, records, arrays/slices (deferred), algebraic data types.
- Generic type parameters with variance markers and trait bounds (placeholder).
- Ownership qualifiers (`move`, `&share`, `&mut borrow`).

### 4.1 Type Grammar (Stage 0 subset)
```
Type        ::= PrimitiveType
			  | TupleType
			  | Identifier TypeArguments?

PrimitiveType ::= "int" | "bool" | "float" | "string" | "byte"

TupleType   ::= "(" Type ("," Type)+ ")"

TypeArguments ::= "<" Type ("," Type)* ">"    # placeholder for future generics
```

> Stage 0 Scope — Defer generics and advanced composites; the parser may accept syntax for forward compatibility, but lowering enforces the minimal subset.

### 4.2 Typing Rules (Stage 0 Overview)
- **Integers**: default to 64-bit signed (`int`); suffix-based width selection is future work.
- **Floats**: single 64-bit IEEE754 variant (`float`).
- **Booleans**: logical operators operate on `bool`; no implicit conversions from integers.
- **Strings**: UTF-8 sequences; concatenation via function calls rather than operators in Stage 0.
- **Ownership**: `mut` parameters allow reassignment within scope; non-`mut` bindings are immutable.
- **Implicit Conversions**: none; explicit casts will arrive later.

## 5. Declarations
- Function definitions: signature syntax, implicit vs explicit return types, effect annotations (future).
- Type declarations: structural vs nominal, pattern-matching support.
- Constant and static definitions: compile-time evaluation semantics.

### 5.1 Function Declaration Grammar
```
FunctionDecl ::= "fn" Identifier ParameterList ReturnClause? Block

ParameterList ::= "(" Parameter ("," Parameter)* ")"
Parameter     ::= Mutability? Identifier ":" Type
Mutability    ::= "mut"

ReturnClause  ::= "->" Type

Block         ::= "{" Statement* "}"
```

> Stage 0 Scope — All function signatures must state an explicit return type; implicit `-> unit` semantics land in later revisions.

## 6. Expressions
- Precedence table from highest to lowest: postfix, multiplicative, additive, comparison, logical.
- Function calls, method dispatch (if applicable), closures (deferred).
- Control expressions: `if`, `match`, `while`, `for`, `scope`.
- Pattern matching semantics and exhaustiveness rules.

> Stage 0 Scope — Expressions cover literals, identifiers, binary arithmetic (`+`, `-`, `*`, `/`), comparisons, boolean connectives, and call syntax; pattern matching and closures are deferred.

### 6.1 Operator Precedence (Stage 0)

| Level | Operators | Associativity | Notes |
|-------|-----------|---------------|-------|
| 1 | `call`, indexing (future) | left | `f(x)` style invocations. |
| 2 | `*`, `/` | left | Multiplicative. |
| 3 | `+`, `-` | left | Additive. |
| 4 | `<`, `<=`, `>`, `>=`, `==`, `!=` | left | Comparison; results are `bool`. |
| 5 | `&&` | left | Logical and (short-circuit). |
| 6 | `||` | left | Logical or (short-circuit). |

> Stage 0 Scope — No unary prefix operators beyond literal signs; future revisions may introduce `!`, `-` unary, and assignment expressions.

### 6.2 Expression Semantics (Stage 0 Overview)
- Arithmetic on `int` uses two's complement overflow semantics matching target ISA (wraparound); saturation is library-provided.
- Division by zero triggers a runtime trap (`panic` pending Stage 0 implementation details).
- Comparisons return `bool`; `==`/`!=` operate on primitives only.
- Logical operators short-circuit evaluation left-to-right.
- Function calls evaluate arguments left-to-right and respect ownership qualifiers (passing a `mut` binding by value moves it unless the parameter type is a borrow placeholder for future stages).

## 7. Statements
- Variable bindings (`let`/`let mut`), assignment semantics (move vs copy).
- Looping constructs and break/continue semantics.
- Error handling primitives (`panic`, `ensure`, placeholder for result-based flow).

### 7.1 Statement Grammar (Stage 0 subset)
```
Statement ::= LetStmt
			| AssignStmt
			| IfStmt
			| WhileStmt
			| ReturnStmt
			| ExpressionStmt

LetStmt   ::= "let" Mutability? Identifier ":" Type "=" Expression ";"

AssignStmt ::= Identifier "=" Expression ";"

IfStmt    ::= "if" Expression Block ("else" Block)?

WhileStmt ::= "while" Expression Block

ReturnStmt ::= "return" Expression? ";"

ExpressionStmt ::= Expression ";"
```

> Stage 0 Scope — Focus on deterministic imperative constructs; `for`, `match`, and advanced control flow remain future work.

### 7.2 Statement Semantics (Stage 0 Overview)
- `let` bindings evaluate the initializer before binding; `mut` permits reassignment, while plain bindings are single-assignment.
- Assignments require the left-hand identifier to be mutable or to own move semantics; copying primitives is allowed.
- `if` expressions require boolean conditions; both branches must coerce to compatible types when used as expressions (Stage 0 treats `if` primarily as a statement).
- `while` loops evaluate the condition before each iteration; `break` exits the nearest loop, `continue` restarts evaluation (future addition).
- `return` with no expression defaults to returning `()` once the type system supports unit; Stage 0 enforces explicit expressions matching the function return type.

## 8. Concurrency & Async Primitives
- Structured concurrency keywords: `spawn`, `join`, `scope`.
- Channel APIs and `select` block semantics.
- Cancellation model (propagation protocol, default behavior).
- Deterministic testing hooks (virtual clock, scheduler handles).
- Roadmap reference: see `specs/aurora_concurrency_roadmap.md` for staged feature rollout and runtime requirements.

## 9. Memory & Ownership Model
- Lifetime rules and borrow checker phases.
- Move semantics vs copy semantics; trait requirements for copying.
- Thread-safety markers (`Send`, `Share` analogs) and enforcement points.

## 10. Standard Library Surface (Stage 0/1 subset)
- Core modules (`core`, `mem`, `sync`, `time`, `io` placeholder).
- Formatting/logging strategy for minimal runtime.
- Error and option types for base language interop.

## 11. Natural Language Authoring Bridge
- Lexical mapping: Stage 0 limits the CNL surface to English lexemes (see `specs/aurora_cnl_vocabulary.md`); bilingual extensions are tracked as future work.
- Controlled natural language grammar enabling deterministic translation to Aurora source constructs.
- Example mapping table: "define function F with parameters (x: int) returns int" → `fn F(x: int) -> int { ... }` (to be formalized).
- Validation process: pipeline for converting structured natural language spec into `.aur` plus tests.

## 12. Compilation Pipeline Contracts
- Source → AST invariants required by the Stage 3 compiler.
- AST → IR translation expectations (node coverage, error propagation).
- IR → Machine code handshake (calling convention, layout assumptions).

## 13. Aurora Seed DSL Interoperability
- Relationship between high-level language constructs and `.aurs` directives.
- Mapping of data sections (strings, symbol tables) produced from Aurora source.
- Requirements for the Aurora interpreter/compiler to maintain manifest compatibility.
- Minimal instruction set alignment (`specs/aurora_minimal_isa.md`) so that Stage 0
	programs share a canonical opcode surface.

## 14. Diagnostics & Tooling
- Error message standards (structure, localization pipeline placeholder).
- Linting guidelines and code formatting rules.
- Versioning and feature flags (experimental language features gating).

## 15. Future Extensions (Non-Normative)
- Foreign function interface concepts (Linux syscalls, future Windows support).
- Macro system and compile-time evaluation.
- Gradual typing or capability-based security layers.

---

### Immediate Next Actions
1. Flesh out Sections 4–7 with concrete grammar productions and typing rules, integrating existing parser design work.
2. Specify the controlled natural language grammar and build examples for automated translation tests.
3. Align the standard with bootstrapping milestones to ensure each stage has verifiable language coverage and references the minimal ISA where execution semantics surface.
