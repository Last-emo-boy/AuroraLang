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
| S0 | CNL document (`.aurora.txt`) | Structured intermediate graph (SIG) | `aurora-cnl-parser` (planned, see `specs/aurora_cnl_to_aur_plan.md` & `specs/aurora_cnl_vocabulary.md`) | In ramp-up |
| S1 | SIG | Canonical `.aur` source | `aurora-cnl-lower` (planned, see `specs/aurora_cnl_to_aur_plan.md`) | In ramp-up |
| S2 | `.aur` | AST + semantic graph | `aurc` front-end / Stage 3 parser | In design (`specs/aurora_parser_design.md`) |
| S3 | AST | Aurora IR (`.air`) | `aurc` middle-end | Planned |
| S4a | AST / IR-lite | Aurora Seed DSL manifests (`.aurs`) | `air-to-aurs` lowering tool (bridge for Stage 0 interpreter) | Accelerated (ISA draft ready) |
| S4b | IR | Native machine code (ELF) | `aurc` backend | Planned |
| S5 | `.aurs` | Executable binary | `aurseed` interpreter | In progress (helpers being implemented) |

## 3. Controlled Natural Language Layer
- **Vocabulary**: Stage 0 adopts an English-only lexicon mapped to Aurora constructs (see `specs/aurora_cnl_vocabulary.md`).
- **Grammar**: simple subject-verb-object templates (e.g., `define function <Name> with parameters <Params> returns <Type>`).
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
- **Ownership Hints**: annotate with borrow qualifiers inferred from CNL directives (`mutable`, `shared`).

## 6. Compiler Front-End Integration
- Reuse existing parser design (tokenizer, recursive-descent, Pratt precedence) to consume `.aur`.
- Semantic analysis feeds both IR generation and Seed DSL lowering.
- Diagnostics reference both `.aur` and CNL anchors for English messaging; localization is future work.
- Concurrency-aware metadata (ownership, `spawn` eligibility) flows from the AST to IR per `specs/aurora_concurrency_roadmap.md` milestones.

## 7. Manifests & Machine Code
- **Seed DSL Path**: AST → directive queue → `.aurs` manifests consumed by handcrafted interpreter.
- **Native Path**: AST → IR → instruction selection → ELF64 binary.
- **Equivalence Checks**: ensure interpreter output matches native backend for Stage 0 programs.
- **Concurrency Readiness**: track future manifest extensions (task descriptors, synchronization opcodes) alongside the roadmap.

## 8. Tooling Matrix
- `aurora-cnl-parser`: converts CNL text to SIG.
- `aurora-cnl-lower`: emits canonical `.aur` files.
- `aurseed`: interprets `.aurs` manifests (Stage 0/1 bootstrap).
- `aurvm`: executes bytecode for semantic validation before native backend matures.
- `aurc`: full compiler pipeline.
- `tools/aurc_mvp.py`: prototype CLI translating the hello world subset to `.aurs` for early testing.
- `aurc-native` (Stage N1): native compiler skeleton matching the hello-world subset; roadmap in `specs/aurc_native_rewrite_plan.md`.

## 9. Verification Strategy
- Round-trip tests: CNL → `.aur` → AST → `.aur` (pretty print) → diff for idempotence.
- Seed DSL parity: generated `.aurs` manifests compared against hand-authored references for critical routines.
- Binary diffing: compare interpreter-produced binary to backend-compiled binary for small acceptance programs.

## 10. Roadmap Alignment
1. Finalize language standard sections to lock syntax/semantics.
2. Execute milestones in `specs/aurora_cnl_to_aur_plan.md` to deliver the CNL
	translator (lexer, parser, SIG builder, `.aur` writer).
3. Implement AST-to-`.aurs` lowering for interpreter bootstrapping using the
	minimal ISA (`specs/aurora_minimal_isa.md`).
4. Exercise end-to-end flow (CNL → `.aurs`) with arithmetic/IO smoke tests,
	then iterate toward full compiler once interpreter helpers are complete.
5. Track compiler MVP milestones (`specs/aurora_compiler_mvp_plan.md`) to ensure translation pipeline deliverables feed directly into product timelines.
6. Use manual references (`docs/manual_compilation_walkthrough.md`) as golden outputs while tooling matures.
7. Plan native compiler rewrite (`specs/aurc_native_rewrite_plan.md`) so future builds emit binaries without relying on Python.

## 11. Acceleration Plan (Q4 2025)
- **Week 1**: Lock the minimal ISA spec and expose helper APIs to the lowering
	tool; publish worked examples.
- **Week 2**: Deliver the first CNL-to-`.aur` prototype supporting function
	declarations, literals, and `svc` usage; add regression harness invoking the
	interpreter.
- **Week 3**: Expand lowering to handle conditional control flow (`if`,
	`cjmp`); integrate stack frame conventions and basic arithmetic with
	verification cases.
- **Week 4**: Stabilize diagnostics and traceability so CNL authors can review
	compiler feedback mapped back to the originating text; evaluate localization
	hooks for future bilingual expansion.

---

### Open Questions
- How expressive should the CNL be in Stage 0 (focus on imperative constructs first?).
- What annotation system bridges concurrency semantics from CNL to ownership qualifiers?
- When to phase out the CNL layer in favor of direct `.aur` authoring?
