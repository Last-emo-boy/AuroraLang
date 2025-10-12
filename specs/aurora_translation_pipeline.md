# Aurora Source Translation Pipeline

> Drafted 2025-10-10 — Describes the end-to-end flow from structured natural-language authoring to executable machine code.

## 1. Overview
The pipeline bridges three representations:
1. **Natural Authoring Layer** — controlled natural language (CNL) statements for human-friendly specification.
2. **Aurora Source Layer (`.aur`)** — canonical language form consumed by Aurora compilers.
3. **Executable Artifacts** — `.aurs` manifests, bytecode IR, and final machine binaries.

A deterministic translator ensures information losslessness between layers, enabling automated verification and reproducibility across the bootstrap chain.

## 2. Pipeline Stages

| Stage | Input | Output | Responsible Component | Status |
|-------|-------|--------|-----------------------|--------|
| S0 | CNL document (`.aurora.txt`) | Structured intermediate graph (SIG) | `aurora-cnl-parser` (planned) | Pending |
| S1 | SIG | Canonical `.aur` source | `aurora-cnl-lower` (planned) | Pending |
| S2 | `.aur` | AST + semantic graph | `aurc` front-end / Stage 3 parser | In design (`specs/aurora_parser_design.md`) |
| S3 | AST | Aurora IR (`.air`) | `aurc` middle-end | Planned |
| S4a | IR | Aurora Seed DSL manifests (`.aurs`) | `air-to-aurs` lowering tool (bridge for Stage 0 interpreter) | Planned |
| S4b | IR | Native machine code (ELF) | `aurc` backend | Planned |
| S5 | `.aurs` | Executable binary | `aurseed` interpreter | In progress (helpers being implemented) |

## 3. Controlled Natural Language Layer
- **Vocabulary**: curated bilingual lexicon (English/Chinese) mapped to Aurora constructs.
- **Grammar**: simple subject-verb-object templates (e.g., `定义 函数 <Name> 接受 <Params> 返回 <Type>`).
- **Validation**: deterministic parser ensures every clause yields a typed AST fragment.
- **Traceability**: embed GUID anchors so downstream tooling can cross-reference original statements for diagnostics.

## 4. Intermediate Graph (SIG)
- **Nodes**: declarations, types, expressions, patterns.
- **Edges**: scope nesting, dependency links, trait constraints.
- **Metadata**: original CNL text, source positions, translation confidence.
- **Serialization**: JSON5 or custom compact binary for offline review.

## 5. Lowering to Aurora Source (`.aur`)
- **Pretty Printer**: deterministic formatting honoring language standard rules.
- **Name Resolution**: ensure generated identifiers follow casing and module conventions.
- **Ownership Hints**: annotate with borrow qualifiers inferred from CNL directives (`可变`, `共享`).

## 6. Compiler Front-End Integration
- Reuse existing parser design (tokenizer, recursive-descent, Pratt precedence) to consume `.aur`.
- Semantic analysis feeds both IR generation and Seed DSL lowering.
- Diagnostics reference both `.aur` and CNL anchors for dual-language feedback.

## 7. Manifests & Machine Code
- **Seed DSL Path**: AST → directive queue → `.aurs` manifests consumed by handcrafted interpreter.
- **Native Path**: AST → IR → instruction selection → ELF64 binary.
- **Equivalence Checks**: ensure interpreter output matches native backend for Stage 0 programs.

## 8. Tooling Matrix
- `aurora-cnl-parser`: converts CNL text to SIG.
- `aurora-cnl-lower`: emits canonical `.aur` files.
- `aurseed`: interprets `.aurs` manifests (Stage 0/1 bootstrap).
- `aurvm`: executes bytecode for semantic validation before native backend matures.
- `aurc`: full compiler pipeline.

## 9. Verification Strategy
- Round-trip tests: CNL → `.aur` → AST → `.aur` (pretty print) → diff for idempotence.
- Seed DSL parity: generated `.aurs` manifests compared against hand-authored references for critical routines.
- Binary diffing: compare interpreter-produced binary to backend-compiled binary for small acceptance programs.

## 10. Roadmap Alignment
1. Finalize language standard sections to lock syntax/semantics.
2. Prototype CNL parser with limited grammar (function declarations, type defs).
3. Implement AST-to-`.aurs` lowering for interpreter bootstrapping.
4. Iterate toward full compiler once interpreter helpers are complete.

---

### Open Questions
- How expressive should the CNL be in Stage 0 (focus on imperative constructs first?).
- What annotation system bridges concurrency semantics from CNL to ownership qualifiers?
- When to phase out the CNL layer in favor of direct `.aur` authoring?
