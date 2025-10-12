# Aurora Compiler MVP Plan

> Drafted 2025-10-12 — Defines the deliverables required to produce the first executable Aurora compiler capable of translating a restricted `.aur` program into a runnable artifact via the Stage 0 toolchain.

## 1. MVP Definition
- Accept a single-module Aurora source file containing:
  - `fn main() -> int` with `let` bindings, arithmetic expressions, conditional branches, and calls to interpreter-provided services (`print`, `request service`).
- Emit a `.aurs` manifest using the minimal ISA that the existing interpreter executes to produce observable output (`OK`, arithmetic results).
- Provide basic diagnostics (lexical/parse errors with line/column) and exit codes suitable for CI automation.

## 2. Scope Boundaries
- Out of scope: pattern matching, loops other than `while`, user-defined types beyond primitives, concurrency keywords, native binary backend.
- Memory management limited to stack locals; no heap allocation yet.
- No optimization passes beyond minimal constant folding needed for manifest lowering.

## 3. Workstreams & Milestones

| Milestone | Target | Deliverables | Dependencies |
|-----------|--------|--------------|--------------|
| M0 — Lexer & Vocabulary Lock | 2025-10-20 | Finalized token definitions, unit tests for keyword/identifier lexing. | `specs/aurora_cnl_vocabulary.md`, language standard sections 4–7. |
| M1 — Parser Skeleton | 2025-10-27 | Function, statement, and expression parsing with AST emission; error reporting. | M0; `specs/aurora_parser_design.md`. |
| M2 — Semantic Checks | 2025-11-05 | Type checker for primitives, mutability enforcement, main-function validation. | M1; language standard typing rules. |
| M3 — IR & Lowering | 2025-11-15 | Minimal IR (control-flow graph or linear form) and lowering to `.aurs` directives aligned with minimal ISA. | M2; `specs/aurora_minimal_isa.md`. |
| M4 — Interpreter Integration | 2025-11-22 | CLI driver that writes manifests, executes Stage 0 interpreter, and verifies output; regression harness. | M3; interpreter helpers. |
| M5 — Tooling Package | 2025-11-29 | Documentation, CLI packaging, CI scripts, sample programs. | M4; translation pipeline. |
| M6 — Native Rewrite Kickoff | 2025-12-10 | Establish systems-language compiler skeleton, manifest parity tests, build scripts. | `specs/aurc_native_rewrite_plan.md`. |

> Native Rewrite Transition — See `specs/aurc_native_rewrite_plan.md` for the Stage N1 roadmap that replaces the Python prototype with a standalone binary compiler.

## 4. Component Breakdown
- **Lexer**: deterministic finite automaton with Unicode normalization per vocabulary spec; produces token stream with diagnostics context.
- **Parser**: recursive-descent + Pratt expression handler per Stage 0 grammar; attach source spans to AST nodes.
- **Semantic Analyzer**: verifies identifiers, ensures `main` signature correctness, enforces mutability rules, resolves service call identifiers.
- **IR Builder**: constructs basic blocks with instructions for arithmetic, branching, service calls; includes immediate constants and registers mapping.
- **Lowerer**: translates IR to minimal ISA directive slots (16-byte layout) leveraging helper functions already present in interpreter documentation.
- **Emitter CLI**: command `aurc-mvp build input.aur` producing `output.aurs` and invoking interpreter when `--run` flag is passed.
  - Current prototype: `tools/aurc_mvp.py` (`compile` subcommand) handles the hello world subset.

## 5. Testing Strategy
- Unit tests for lexer/token classification.
- Parser golden tests comparing AST dumps against fixtures.
- Semantic tests ensuring invalid programs produce descriptive errors.
- Lowering tests comparing generated `.aurs` to hand-authored references for simple programs (hello world, arithmetic, conditional).
- End-to-end smoke tests invoking interpreter and verifying stdout/exit code via automation script.

## 6. Tooling & Automation
- `scripts/mvp_test.ps1` (and shell equivalent) running the full suite.
- GitHub Actions/CI workflow targeting Windows + Linux for lexing/parsing (no interpreter execution on CI if tooling constraints prohibit it).
- Logging/tracing flags for debugging (`--trace-lexer`, `--trace-ir`).

## 7. Risks & Mitigations
- **Minimal ISA gaps**: ensure spec covers all required ops; add worked examples early (Stage 0 Plan Next Action #2).
- **Interpreter integration friction**: stub manifest emitter with test double before full interpreter invocation.
- **Schedule compression**: lock grammar and ISA ASAP to minimize rework.
- **Future concurrency integration**: annotate IR with concurrency placeholders to avoid redesign (see `specs/aurora_concurrency_roadmap.md`).

## 8. Immediate Next Steps
1. Complete lexicon validation and produce token fixtures (align with `specs/aurora_cnl_vocabulary.md`).
2. Flesh out AST structure schema in `specs/aurora_parser_design.md` with Stage 0 node variants.
3. Draft `.aur` → `.aurs` lowering examples documenting register allocation for arithmetic and branching cases (seeded by `docs/manual_compilation_walkthrough.md`).
