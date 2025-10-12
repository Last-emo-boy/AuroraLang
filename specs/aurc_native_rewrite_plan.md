# Aurora Compiler Native Rewrite Plan

> Drafted 2025-10-12 — roadmap for eliminating the Python prototype (`tools/aurc_mvp.py`) and delivering an autonomous, binary Aurora compiler.

## 1. Motivation
- Remove Python as a runtime dependency so Aurora compilation relies only on self-hosted or low-level tooling.
- Produce a static binary (`aurc`) capable of running on bootstrap platforms (Linux x86-64, Windows x86-64) with no interpreter assistance.
- Establish a clear path to self-hosting: rewrite first in a systems language (C or Zig) and later migrate to Aurora itself.

## 2. Target Architecture
1. **Stage N0 (Current)** — Python MVP translating a limited subset to `.aurs` manifests.
2. **Stage N1 (Systems Implementation)** — Reimplement MVP features in a low-level language (recommendation: C for portability, or Zig for clarity) producing a native executable.
3. **Stage N2 (ISA Expansion)** — Extend native compiler to cover full minimal ISA lowering, including arithmetic, branching, and function calls.
4. **Stage N3 (Self-Hosting Prep)** — Add module system, basic type checker, and IR for eventual rewrite in Aurora.
5. **Stage N4 (Aurora Self-Host)** — Rewrite compiler core in Aurora, using Stage N1 binary to compile it.

- **MVP parity**: `aurc-native` reproduces the hello-world manifest and passes diff checks (baseline achieved).
- **Lexer/Parser**: Replace ad-hoc parsing with proper tokenization and recursive descent matching Stage 0 grammar.
- **Emitter**: Extend manifest emitter to support arithmetic, branching, multiple string bindings, and service calls.
- **Testing**: Build fixtures for each new feature and wire them into CI-friendly test harnesses.
- **Build tooling**: Maintain cross-platform scripts (Makefile/PowerShell) keeping alignment with `specs/tooling_constraints.md`.

## 4. Binary Generation Path
- Integrate with `aurseed` interpreter to emit ELF/PE binaries directly from `.aurs`.
- Provide optional `--emit-bin` flag producing raw executable via interpreter helpers (once interpreter exposes CLI entrypoint).
- Document pipeline in `docs/manual_compilation_walkthrough.md` once binary emission is automated.

## 5. Work Breakdown
1. **Bootstrap Library**: Implement minimal standard library wrappers (file IO, CLI parsing) in chosen systems language.
2. **Lexer Port**: Translate vocabulary definitions from `specs/aurora_cnl_vocabulary.md` into code; ensure UTF-8 support.
3. **Parser Port**: Reuse Pratt expression design from `specs/aurora_parser_design.md` with Stage 0 grammar.
4. **IR & Lowering**: Mirror Python lowering logic, maintaining relocation placeholders for string literals.
5. **Testing Harness**: Compare outputs against golden manifests; run in CI on Linux/Windows.
6. **Packaging**: Produce static binaries or reproducible build instructions aligning with `specs/tooling_constraints.md`.

## 6. Timeline (Proposed)
- **2025-10-20**: Finalize lexer design, implement tokenization, and scaffold parser states.
- **2025-11-05**: Complete parser + AST covering expressions/bindings/branches.
- **2025-11-15**: Expand emitter to arithmetic/branching; pass parity tests for new fixtures.
- **2025-11-25**: Integrate interpreter invocation (`--emit-bin`) and ensure generated binaries pass smoke tests.
- **2025-12-10**: Harden CLI, diagnostics, cross-platform builds, and regression harness.

## 7. Risks & Mitigations
- **Language Choice**: C offers universal availability but higher maintenance; Zig/Rust provide safety. Mitigation: prototype in C for minimal dependencies, plan for later migration.
- **Bootstrap Constraints**: Ensure build uses only allowed toolchains per `specs/tooling_constraints.md`.
- **Feature Divergence**: Keep Python MVP and native compiler in lockstep via shared manifest fixtures.

## 8. Next Actions
- Implement C lexer to normalize Stage 0 tokens (keywords, identifiers, string literals).
- Introduce parser modules (expressions/statements) mirroring `specs/aurora_parser_design.md`.
- Extend manifest emitter with arithmetic/branch logic and relocations.
- Add regression fixtures (arithmetic loop, service combos) and integrate into `make test`.
- Coordinate with interpreter team for `--emit-bin` integration once CLI is available.
