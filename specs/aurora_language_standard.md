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

## 5. Declarations
- Function definitions: signature syntax, implicit vs explicit return types, effect annotations (future).
- Type declarations: structural vs nominal, pattern-matching support.
- Constant and static definitions: compile-time evaluation semantics.

## 6. Expressions
- Precedence table from highest to lowest: postfix, multiplicative, additive, comparison, logical.
- Function calls, method dispatch (if applicable), closures (deferred).
- Control expressions: `if`, `match`, `while`, `for`, `scope`.
- Pattern matching semantics and exhaustiveness rules.

## 7. Statements
- Variable bindings (`let`/`let mut`), assignment semantics (move vs copy).
- Looping constructs and break/continue semantics.
- Error handling primitives (`panic`, `ensure`, placeholder for result-based flow).

## 8. Concurrency & Async Primitives
- Structured concurrency keywords: `spawn`, `join`, `scope`.
- Channel APIs and `select` block semantics.
- Cancellation model (propagation protocol, default behavior).
- Deterministic testing hooks (virtual clock, scheduler handles).

## 9. Memory & Ownership Model
- Lifetime rules and borrow checker phases.
- Move semantics vs copy semantics; trait requirements for copying.
- Thread-safety markers (`Send`, `Share` analogs) and enforcement points.

## 10. Standard Library Surface (Stage 0/1 subset)
- Core modules (`core`, `mem`, `sync`, `time`, `io` placeholder).
- Formatting/logging strategy for minimal runtime.
- Error and option types for base language interop.

## 11. Natural Language Authoring Bridge
- Lexical mapping: how English/Chinese design documents map to canonical tokens (e.g., directive templates).
- Controlled natural language grammar enabling deterministic translation to Aurora source constructs.
- Example mapping table: "声明函数 X 接受参数 Y 并返回 Z" → `fn X(Y: T) -> Z { ... }` (to be formalized).
- Validation process: pipeline for converting structured natural language spec into `.aur` plus tests.

## 12. Compilation Pipeline Contracts
- Source → AST invariants required by the Stage 3 compiler.
- AST → IR translation expectations (node coverage, error propagation).
- IR → Machine code handshake (calling convention, layout assumptions).

## 13. Aurora Seed DSL Interoperability
- Relationship between high-level language constructs and `.aurs` directives.
- Mapping of data sections (strings, symbol tables) produced from Aurora source.
- Requirements for the Aurora interpreter/compiler to maintain manifest compatibility.

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
3. Align the standard with bootstrapping milestones to ensure each stage has verifiable language coverage.
