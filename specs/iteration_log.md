# AuroraLang Iteration Log

## 2025-10-09 — Kickoff
- Reviewed foundational specification covering mission, constraints, roadmap, and acceptance criteria.
- Captured stage-by-stage TODO list in `specs/TODO.md`.
- Identified cross-cutting deliverables and unresolved questions:
  - Original syntax evolution guardrails.
  - Detailed bootstrap artifact hashing/signing pipeline.
  - Deterministic scheduler design alignment between VM and runtime.
- Next iteration goals:
  1. Elaborate Stage 0 execution plan with byte layout diagrams.
  2. Prototype byte-level ELF generator scaffolding (no assembler/linker yet).
  3. Draft verification checklist for Stage 0 acceptance script.

## 2025-10-09 — Iteration 1: Cross-Platform Scope
- Analyzed implications of adding Windows x86-64 support alongside Linux baseline.
- Updated `specs/TODO.md` with cross-platform checkpoints per stage and new open questions.
- Authored `specs/stage0_plan.md` outlining deliverables, work breakdown, and exit criteria for Stage 0 across Linux and Windows.
- Captured need for platform matrix tracking and verification automation in cross-cutting backlog.
- Next steps:
  1. Flesh out ELF and PE layout documentation (`seed/docs/stage0_layout.md`).
  2. Investigate syscall/export options for Windows Stage 0 stub.
  3. Evaluate CI strategy for validating binaries on both OS targets (native vs emulation).

## 2025-10-09 — Iteration 2: Zero-Dependency Assembly Grounding
- Produced `specs/stage0_asm_notes.md` detailing raw x86-64 instruction bytes for Linux and Windows Stage 0 binaries without invoking third-party assemblers.
- Codified zero-dependency policy in `specs/tooling_constraints.md`, covering toolchain provenance and forbidden external utilities.
- Rebuilt `specs/stage0_plan.md` to point at assembly notes, policy enforcement tasks, and handcrafted generation scripts.
- Expanded `specs/TODO.md` with tasks for instruction byte finalization and tooling provenance checks.
- Next steps:
  1. Draft `seed/docs/stage0_layout.md` with per-byte diagrams for ELF and PE headers.
  2. Prototype Stage 0 generator script skeletons that embed the documented byte runs.
  3. Define CI guardrails to detect accidental use of host assemblers.

## 2025-10-09 — Iteration 3: Layouts & Seed DSL
- Authored `seed/docs/stage0_layout.md` capturing byte-accurate structure for ELF64 and PE Stage 0 binaries.
- Introduced Aurora Seed DSL scaffolding in `seed/scripts/README.md` with manifests `linux_stage0.aurs` and `windows_stage0.aurs`, avoiding foreign scripting languages.
- Documented CI guardrails in `specs/ci_guardrails.md` to enforce the zero-dependency policy.
- TODO backlog now includes provenance manifest tasks and DSL interpreter implementation milestones.
- Next steps:
  1. Implement Aurora-native interpreter for `.aurs` manifests.
  2. Populate `seed/SHA256SUMS.txt` once binaries are generated via the new interpreter.
  3. Wire guardrail plan into forthcoming CI configuration (`ci/pipeline.yml`).

## 2025-10-09 — Iteration 4: Interpreter Foundations
- Captured interpreter functional requirements in `specs/aurs_interpreter_spec.md` and architecture blueprint in `specs/aurs_interpreter_arch.md`.
- Authored assembly skeleton plan `seed/interpreter/aurseed_linux.asmplan`, mapping registers, buffers, and syscall routines for the handcrafted executable.
- Maintained zero-dependency approach by outlining manual tokenization, directive queue execution, and relocation patching purely in machine-level terms.
- Next steps:
  1. Convert skeleton blocks into concrete hex sequences for Stage 0 binary.
  2. Define data structure layouts (symbol/relocation tables) in a companion `.aurs` manifest.
  3. Extend design to Windows syscall surface once Linux prototype passes initial verification.

## 2025-10-09 — Iteration 5: Interpreter Data & Hex Planning
- Finalized interpreter data structure layouts in `specs/aurs_interpreter_datastructures.md`, covering token, directive, symbol, and relocation tables.
- Expanded `seed/interpreter/aurseed_linux.asmplan` with concrete hex snippets for argument parsing, syscall stubs, memory zeroing, lexer emissions, and relocation loops.
- Prepared for literal byte authoring by anchoring opcodes, register usage, and buffer addresses to the shared arena layout.
- Next steps:
  1. Produce `.aurs` manifest describing interpreter binary sections using the new data layout constants.
  2. Begin hand-translating key routines into finalized hex for Stage 0 interpreter prototype.
  3. Derive verification plan ensuring interpreter reproduces existing Stage 0 seed outputs before expanding functionality.

## 2025-10-09 — Iteration 6: Interpreter Manifest & Verification Plan
- Authored `seed/interpreter/manifests/aurseed_linux.aurs`, capturing ELF headers, section layout, and stitched hex for interpreter routines.
- Populated manifest with concrete byte sequences for prologue, syscall stubs, zeroing loop, lexer logic, and relocation application.
- Documented verification strategy in `specs/aurs_interpreter_verification.md`, covering test matrix and hash-based validation paths.
- Next steps:
  1. Finish emitting remaining routines (parser, emitter, error paths) and integrate them into the manifest.
  2. Hand-assemble the manifest into a runnable binary and compare against layout spec.
  3. Execute verification plan once binary is available, capturing logs under `verification/logs/`.

## 2025-10-09 — Iteration 7: Parser Integration & Data Tables
- Extended `seed/interpreter/manifests/aurseed_linux.aurs` with parser loop branches, directive handler stubs, and error exit trampolines.
- Authored companion data manifest `seed/interpreter/manifests/aurseed_linux_data.aurs` containing keyword and error string tables aligned with arena layout.
- Updated `seed/interpreter/aurseed_linux.asmplan` with finalized hex sequences for parser dispatch and emission routines, ensuring consistency between plan and manifest.
- Next steps:
  1. Populate remaining routines (lexer token storage, relocation patch loops) with exact call offsets and add them to manifest.
  2. Begin manual assembly pass turning `.aurs` manifests into binary via interpreter prototype scaffolding.
  3. Prepare verification harness inputs (hash expectations, trace logs) ahead of first interpreter execution.

## 2025-10-09 — Iteration 8: Data Alignment & Offset Planning
- Expanded `seed/interpreter/manifests/aurseed_linux_data.aurs` with keyword pointer table, sentinel terminator, and CLI flag strings to match arena layout.
- Documented manifest usage and composition order in `seed/interpreter/manifests/README.md` to guide future assembly passes.
- Authored `specs/aurs_interpreter_offset_checklist.md` to formalize call/jump offset reconciliation before final hex emission.
- Next steps:
  1. Apply checklist to compute concrete relative offsets and replace placeholders in `aurseed_linux.aurs`.
  2. Generate preliminary binary artifacts from manifests and compare against layout specs.
  3. Extend data manifests with relocation metadata once offset computation stabilizes.

## 2025-10-09 — Iteration 9: Offset Analyzer & Call Audit
- Introduced `tools/manifest_analyzer.py` to materialize label tables and highlight pending `call`/`jmp` displacements directly from `.aurs` manifests.
- Recomputed interpreter offsets via analyzer output, updating `specs/aurseed_offset_worklog.md` with accurate label addresses (code + arena) and documenting unresolved call targets.
- Annotated `aurseed_linux.aurs` with comments for every outstanding helper call, clarifying future implementation tasks (directive matcher, operand parsers, `error_exit`).
- Next steps:
  1. Implement dispatcher helpers (`match_directive`, literal handlers, `error_exit`) so pending call offsets can be backfilled.
  2. Expand analyzer to emit binary snapshots for disassembly/regression diffing once helpers land.
  3. Continue resolving remaining placeholders before kicking off the first binary emission pass.

## 2025-10-10 — Iteration 10: Helper Stubs & Error Exit Wiring
- Implemented concrete `error_exit` trampoline in `aurseed_linux.aurs` and replaced all error handler call displacements accordingly.
- Added stub helper labels (`match_directive`, `parser_expect_*`, `directive_emit`, etc.) so every parser call now resolves with a defined delta; updated worklog with computed offsets and deltas.
- Leveraged `tools/manifest_analyzer.py` to verify there are no remaining pending call placeholders; checklist items for call/jump reconciliation now marked complete.
- Next steps:
  1. Replace stub helpers with real implementations matching the parser/Emitter spec (updates may shift offsets; rerun analyzer).
  2. Sync helper byte sequences back into `aurseed_linux.asmplan` for documentation parity.
  3. Proceed toward first binary emission once helper logic is in place.

## 2025-10-10 — Iteration 11: Helper Implementation Blueprint
- Authored `specs/aurs_interpreter_helper_plan.md` detailing responsibilities, inputs/outputs, and success criteria for all twelve parser/emitter helpers slated to replace the stubbed routines.
- Expanded `seed/interpreter/aurseed_linux.asmplan` with per-helper assembly sketches, including control-flow notes and encoding guidance for `match_directive`, numeric parsing, emission loops, and symbol/relocation handling.
- Annotated helper stubs inside `seed/interpreter/manifests/aurseed_linux.aurs` with iteration-scoped TODO markers that point back to the new plan, ensuring future hex replacements stay traceable.
- Updated `specs/aurseed_offset_worklog.md` next-actions to incorporate offset recalculations post-helper implementation.
- Next steps:
  1. Encode `match_directive` and `parser_expect_identifier/numeric` helpers into concrete byte sequences, replacing the current stubs.
  2. Re-run `tools/manifest_analyzer.py` to capture new offsets and document helper byte lengths for regression tracking.
  3. Extend emission helpers (`parser_emit_bytes/pad/ascii`) using the assembly sketches, then validate with dry-run trace scenarios.

## 2025-10-10 — Iteration 12: Helper Calling Conventions & Identifier Plan
- Extended `specs/aurs_interpreter_helper_plan.md` with a consolidated calling-convention matrix covering global register ownership, mutation rules, and CF semantics for all parser/emitter helpers.
- Refined the `parser_expect_identifier` section in `seed/interpreter/aurseed_linux.asmplan`, breaking the helper into explicit steps (record address computation, type validation, cursor advancement) and enumerating the intended machine encodings.
- Captured the invariant that successful helpers advance `rbx` while failure paths preserve parser state—groundwork for upcoming byte-level implementations.
- Next steps:
  1. Translate the refined `parser_expect_identifier` sequence into concrete bytes within `aurseed_linux.aurs`, adjusting call displacements as required.
  2. Repeat the step-by-step breakdown for `parser_expect_numeric`, including hex digit lookup strategy and overflow signaling.
  3. Draft micro-tests or trace scenarios to validate helper behavior once encoded.

## 2025-10-10 — Iteration 13: Identifier Helper Encoding
- Replaced the `parser_expect_identifier` stub in `seed/interpreter/manifests/aurseed_linux.aurs` with a 22-byte implementation that validates token type, advances the cursor, and returns the token record pointer while setting CF on failure.
- Updated parser call sites (`parse_header`, `parse_org`, `parse_numeric`, `parse_bytes`, `parse_label`, `parse_ref`, `parse_pad`, `parse_ascii`) with new call displacements reflecting the shifted helper addresses; verified via `tools/manifest_analyzer.py`.
- Synced `seed/interpreter/aurseed_linux.asmplan` to document the final instruction encodings and adjusted expectations, and extended `specs/aurs_interpreter_helper_plan.md` plus `specs/aurseed_offset_worklog.md` with helper progress/length tracking.
- Next steps:
  1. Implement `parser_expect_numeric`, reusing the identifier helper and emitting hex-to-integer conversion code.
  2. Encode supporting emission helpers (`parser_emit_bytes`, `parser_emit_pad`, `parser_emit_ascii`) to unblock manifest materialization.
  3. Begin drafting trace scenarios to exercise the helper suite once additional implementations land.

## 2025-10-10 — Iteration 14: Language Standard & Translation Pipeline
- Authored `specs/aurora_language_standard.md`, outlining the canonical Aurora syntax, semantics, concurrency model, and a bridge for controlled natural-language authoring.
- Documented the end-to-end translation flow in `specs/aurora_translation_pipeline.md`, linking CNL inputs to `.aur` source, Aurora IR, Seed DSL manifests, and final machine binaries with responsible components per stage.
- Identified immediate follow-up tasks: elaborating grammar/typing sections, prototyping the CNL parser, and aligning AST-to-`.aurs` lowering with interpreter progress.
- Next steps:
  1. Flesh out Sections 4–7 in the language standard with concrete productions and typing rules.
  2. Design the minimal CNL grammar and start a parser prototype for function/type declarations.
  3. Define acceptance tests that round-trip CNL ⇄ `.aur` ⇄ `.aurs` for early-stage programs.

## 2025-10-10 — Iteration 15: Numeric Helper Encoding & Offset Sweep
- Replaced the `parser_expect_numeric` stub in `seed/interpreter/manifests/aurseed_linux.aurs` with a 64-byte implementation that validates hex literals, strips optional `0x` prefixes flagged in token metadata, clamps input to 16 digits, and accumulates the value into `rax` while only advancing `rbx` on success.
- Updated `seed/interpreter/aurseed_linux.asmplan` to capture the inlined range-check strategy and recorded the exact opcodes for traceability; extended `specs/aurs_interpreter_helper_plan.md` with progress notes on the numeric helper.
- Refreshed `specs/aurseed_offset_worklog.md` with new helper offsets (now starting at `0x027D`) and documented the 64-byte length; reran `tools/manifest_analyzer.py` to regenerate the label table and binary artifact for regression tracking.
- Next steps:
  1. Implement `parser_expect_bytes`, reusing numeric helper patterns to validate even-length hex spans and return pointer/length pairs.
  2. Follow up with `parser_emit_bytes`/`parser_emit_pad` to unlock directive execution beyond numeric literals.
  3. Begin drafting trace scenarios that exercise identifier + numeric helpers to validate carry flag semantics before expanding to emitters.

## 2025-10-10 — Iteration 16: Bytes Helper Integration
- Implemented `parser_expect_bytes` in `seed/interpreter/manifests/aurseed_linux.aurs` (75 bytes) to validate hex literals for the `bytes` directive, strip optional `0x` prefixes, enforce even digit counts, and return the adjusted storage pointer in `rax` together with the computed byte length in `rcx` while advancing `rbx` on success.
- Updated `seed/interpreter/aurseed_linux.asmplan` with the helper’s control flow and final opcode sequence, extended `specs/aurs_interpreter_helper_plan.md` with progress notes, and refreshed `specs/aurseed_offset_worklog.md` to capture the new offsets and length entry.
- Regenerated analyzer output and `build/aurseed_linux.bin` via `tools/manifest_analyzer.py`, confirming helper labels now extend through `0x0362` and preserving directive call displacements.
- Next steps:
  1. Encode `parser_emit_bytes` to consume the pointer/byte count pair and materialize raw data, leveraging the new helper outputs.
  2. Draft `parser_expect_string` logic with escape handling before wiring `parser_emit_ascii`.
  3. Assemble targeted trace cases covering bytes/numeric directives to observe CF semantics and buffer updates.

## 2025-10-10 — Iteration 17: Emit Bytes Helper & Cursor Updates
- Replaced the `parser_emit_bytes` stub with a 54-byte implementation that bounds checks against the 64 KiB output arena, copies spans via `rep movsb`, and records cursor/high-water state within `cursor_block` while leaving `rbx` untouched on overflow.
- Synced `seed/interpreter/aurseed_linux.asmplan` (adjusted register contracts to use `rsi` for source pointers), expanded `specs/aurs_interpreter_helper_plan.md` for the new helper, and updated `specs/aurseed_offset_worklog.md` with revised helper offsets plus the 54-byte length entry.
- Reran `tools/manifest_analyzer.py` to regenerate the label table and binary artifact, noting downstream helper offsets now start at `0x038C` and confirming existing directive call displacements remain stable.
- Next steps:
  1. Implement `parser_emit_pad` and `parser_apply_org` to manage absolute positioning and zero-fill semantics.
  2. Begin `parser_expect_string` along with `parser_emit_ascii`, incorporating escape decoding and length checks.
  3. Design quick trace vectors to exercise identifier, numeric, bytes, and pad flows for carry-flag and overflow validation.

## 2025-10-10 — Iteration 18: Pad Emission & Forward-Only Guardrails
- Encoded `parser_emit_pad` (70 bytes) in `seed/interpreter/manifests/aurseed_linux.aurs`, enforcing forward-only cursor movement, honoring the 64 KiB arena cap, zero-filling via `rep stosb`, and updating `cursor_block` while signalling errors through CF without mutating offsets.
- Updated `seed/interpreter/aurseed_linux.asmplan` with the helper’s control flow and byte sequence, refined the helper plan to clarify input registers, and extended `specs/aurseed_offset_worklog.md` with the new length entry plus refreshed helper offsets (helpers beyond pad now begin at `0x0395`).
- Analyzer rerun (`tools/manifest_analyzer.py`) produced an updated label table/binary confirming pad helper placement and steady directive call displacements.
- Next steps:
  1. Implement `parser_apply_org` to validate absolute positioning and share cursor update logic with the new pad helper.
  2. Tackle `parser_expect_string` + `parser_emit_ascii`, including escape decoding and leveraging `parser_emit_bytes`.
  3. Start drafting trace harness cases covering `org`/`pad` and mixed literal directives to validate overflow/backward protections.

## 2025-10-10 — Iteration 19: Org Application Helper
- Replaced the `parser_apply_org` stub with a 53-byte implementation that enforces forward-only `org` targets, clamps within the 64 KiB arena, and reuses `cursor_block` bookkeeping alongside the pad helper while restoring the previous cursor on failure.
- Synchronized `seed/interpreter/aurseed_linux.asmplan`, `specs/aurs_interpreter_helper_plan.md`, and `specs/aurseed_offset_worklog.md` to capture the helper’s instruction sequence, updated register contract, refreshed offsets (`parser_emit_bytes` now at `0x0388`), and recorded the new 53-byte length entry.
- Reran `tools/manifest_analyzer.py` to regenerate the label table/binary snapshot, confirming directive call displacements remain stable after the helper insertion.
- Next steps:
  1. Implement `parser_expect_string` to unlock ASCII literal handling ahead of the `ascii` directive pathway.
  2. Encode `parser_emit_ascii`, leveraging the bytes and string helpers for emission while enforcing escape semantics.
  3. Begin sketching `parser_record_label`/`parser_queue_ref` logic to progress toward full directive coverage.

## 2025-10-10 — Iteration 20: String Expectation Helper
- Implemented `parser_expect_string` (38 bytes) to validate string literal tokens, surface their raw storage pointer (mirrored into both `rax` and `rsi`), and expose the byte length in `rcx` while advancing the token cursor only on success.
- Updated `seed/interpreter/manifests/aurseed_linux.aurs` with the new helper bytes and retuned downstream call displacements to account for the increased size, ensuring `parser_apply_org`, `parser_emit_bytes`, and friends retain correct targets.
- Synced documentation across `seed/interpreter/aurseed_linux.asmplan`, `specs/aurs_interpreter_helper_plan.md`, and `specs/aurseed_offset_worklog.md`, capturing the helper contract, new offsets (`parser_emit_ascii` now at `0x042D`), and recorded the 38-byte length for regression tracking.
- Regenerated analyzer output and rebuilt `build/aurseed_linux.bin`, confirming label layout stability after the helper insertion.
- Next steps:
  1. Design and implement `parser_emit_ascii` to decode escape sequences and dispatch through `parser_emit_bytes`.
  2. Flesh out symbol/relocation helpers (`parser_record_label`, `parser_queue_ref`) to progress toward full directive coverage.
  3. Extend verification artifacts with trace cases covering ASCII literals (escaped and raw) once emission path lands.

## 2025-10-10 — Iteration 21: ASCII Emission Helper
- Implemented `parser_emit_ascii` (179 bytes) to decode supported escape sequences in place, emit the resulting bytes into the output arena with the same overflow protections as `parser_emit_bytes`, and surface syntax failures for malformed escapes.
- Updated `seed/interpreter/manifests/aurseed_linux.aurs` with the helper encoding, expanded `seed/interpreter/aurseed_linux.asmplan` to capture the control flow/encoding, and refreshed the helper plan plus offset worklog to note the revised register contract and length.
- Analyzer rerun confirmed new offsets (`parser_emit_ascii` now anchored at `0x042D` pre-update) and regenerated `build/aurseed_linux.bin` for regression tracking.
- Next steps:
  1. Bring `parser_record_label` online to populate the symbol table with duplicate detection.
  2. Implement `parser_queue_ref` to append relocation entries for unresolved label references.
  3. Draft trace scenarios exercising ASCII escapes alongside numeric/bytes directives for future verification harnesses.

## 2025-10-10 — Iteration 22: Label Recording Helper
- Implemented `parser_record_label` (124 bytes) to compute FNV-1a hashes directly from identifier token records, insert labels into the fixed-size symbol table via linear probing, and flag duplicates or table overflow through CF.
- Updated `seed/interpreter/manifests/aurseed_linux.aurs`, `seed/interpreter/aurseed_linux.asmplan`, `specs/aurs_interpreter_helper_plan.md`, and `specs/aurseed_offset_worklog.md` to capture the helper’s byte sequence, register contracts, new call displacement (`parse_label` → `parser_record_label`), and recorded helper length.
- Extended `specs/aurs_interpreter_datastructures.md` with symbol table operation notes, clarifying how offsets/lengths/flags are populated for defined labels.
- Next steps:
  1. Implement `parser_queue_ref` to enqueue relocation records for forward references.
  2. Flesh out `directive_emit`, wiring parsed operands into the directive queue.
  3. Assemble trace coverage for duplicate and overflow scenarios within the symbol table to validate helper behavior.

## 2025-10-10 — Iteration 23: Relocation Queue Helper
- Implemented `parser_queue_ref` (116 bytes) to reuse the FNV-1a loop for identifier hashing, scan the relocation table for the first open slot, and snapshot the current cursor offset/width while signalling overflow via CF.
- Updated `seed/interpreter/manifests/aurseed_linux.aurs`, `seed/interpreter/aurseed_linux.asmplan`, `specs/aurs_interpreter_helper_plan.md`, `specs/aurs_interpreter_datastructures.md`, and `specs/aurseed_offset_worklog.md` so the helper contract, byte sequence, relocation table ops, and refreshed offsets/lengths stay in sync.
- Reran `tools/manifest_analyzer.py` to regenerate `build/aurseed_linux.bin`, confirming the helper now resides at `0x045A` and bumping downstream labels (`parser_emit_pad` → `0x04CE`, `parser_emit_ascii` → `0x0514`).
- Next steps:
  1. Tackle `directive_emit` to materialize parsed directives into the queue and keep cursor/relocation metadata coherent.
  2. Mark symbol-table entries as “referenced” during relocation queuing so resolution code can detect dangling labels early.
  3. Expand verification scenarios to cover relocation-table overflow and repeated references sharing a symbol hash.

## 2025-10-10 — Iteration 24: Directive Emission Helper
- Implemented `directive_emit` (69 bytes) to guard the 512-entry directive queue, zero-populate each 16-byte record, conditionally emit up to three operand descriptors based on `cl`, and advance `r14` while signalling overflow via CF.
- Synced `seed/interpreter/manifests/aurseed_linux.aurs`, `seed/interpreter/aurseed_linux.asmplan`, `specs/aurs_interpreter_helper_plan.md`, and `specs/aurs_interpreter_datastructures.md` so the helper contract, pseudo-assembly, and queue operations describe the new behavior.
- Prepared to refresh `specs/aurseed_offset_worklog.md` and rerun the manifest analyzer to capture the shifted offsets (`directive_emit` now larger than stub) and updated binary snapshot.
- Next steps:
  1. Flesh out `match_directive` so opcode dispatch feeds real helper inputs.
  2. Wire parser handlers to seed operand descriptors (`rdx`/`r8`/`r9`) ahead of directive emission.
  3. Add trace coverage for directive queue overflow and operand-count mismatches.

## 2025-10-12 — Iteration 25: Directive Matching Helper
- Encoded `match_directive` (76 bytes) to walk the keyword pointer table with `repe cmpsb`, compare identifier text out of `token_storage`, return the matching opcode via `al`, and signal syntax failure through CF when no keyword matches.
- Updated `seed/interpreter/manifests/aurseed_linux.aurs`, `seed/interpreter/aurseed_linux.asmplan`, `specs/aurs_interpreter_helper_plan.md`, and `specs/aurseed_offset_worklog.md` to document the new helper logic, offsets, and length table entries.
- Reran `tools/manifest_analyzer.py` to confirm the new offsets (`directive_emit` now @ `0x02AA`, parser helpers shifted accordingly) and keep the analyzer report in sync for downstream verification.
- Next steps:
  1. Thread the parser so `match_directive` receives the keyword pointer table and operand registers populated at dispatch time.
  2. Expand verification notes with directive matching edge cases (prefix/suffix mismatches, zero-length tokens).
  3. Begin sketching `parser_loop` error branches that leverage the helper CF contract for syntax diagnostics.

## 2025-10-12 — Iteration 26: Parser Dispatch Loop
- Replaced the `parser_loop` stub with a 149-byte dispatcher that validates identifier tokens, loads the keyword pointer table from `r12 + 0x0F00`, calls `match_directive`, and dispatches to directive-specific parse helpers while looping until EOF.
- Updated `seed/interpreter/manifests/aurseed_linux.aurs`, `seed/interpreter/aurseed_linux.asmplan`, and `specs/aurseed_offset_worklog.md` to capture the new byte sequence, pseudo-assembly, refreshed offsets/lengths, and revised call delta table.
- Reran `tools/manifest_analyzer.py` to verify branch/call displacements (`parser_loop` → `match_directive` now `E8 44 01 00 00`, per-case `jmp` back-edges settled at `E9 A0 FF FF FF` / `E9 76 FF FF FF`).
- Next steps:
  1. Teach each parse helper to populate opcode/operand registers (`al`/`cl`/`rdx`/`r8`/`r9`) before calling `directive_emit` so the directive queue records real metadata.
  2. Document parser error paths and add verification coverage for unmatched keywords and EOF termination.
  3. Begin wiring pass-two materialization (relocation + output emission) once directive queue entries are fully populated.

## 2025-10-13 — Iteration 27: Directive Helper Implementations
- Converted all eight `parse_*` stubs in `seed/interpreter/manifests/aurseed_linux.aurs` into 5-byte call trampolines (plus NOP padding) that tail-call dedicated `_impl` helpers and branch directly back to `parser_loop` once processing completes.
- Authored the `_impl` helper bodies (`parse_header_impl` … `parse_ascii_impl`) to perform operand parsing, directive queue emission, cursor management, and error-path routing, matching the contracts from `specs/aurs_interpreter_helper_plan.md`.
- Regenerated analyzer output to confirm new offsets (`parse_header_impl` at `0x0255` through `parse_ascii_impl` at `0x04ED`) and captured the helper lengths/deltas in `specs/aurseed_offset_worklog.md` for regression tracking.
- Next steps:
  1. Sync the helper encodings and tail-call structure back into `seed/interpreter/aurseed_linux.asmplan` and update the helper plan notes.
  2. Prepare targeted verification traces exercising each directive flow now that real queue entries are emitted.
  3. Evaluate relocation/application stages to ensure downstream passes can consume the populated directive queue without further stubbed logic.

## 2025-10-13 — Iteration 28: Minimal ISA Roadmap & CNL Acceleration
- Published `specs/aurora_minimal_isa.md`, defining the Stage 0 opcode surface, encoding strategy, and interpreter alignment for forthcoming compiler prototypes.
- Updated `specs/stage0_plan.md` deliverables/work breakdown to include minimal ISA integration, documentation milestones, and validation hooks.
- Extended `specs/aurora_translation_pipeline.md`, `specs/aurora_parser_design.md`, and `specs/aurora_language_standard.md` with links to the minimal ISA and a compressed Q4 acceleration schedule for CNL-to-`.aurs` compilation.
- Next steps:
  1. Flesh out encoding diagrams and helper references within `aurseed_linux.asmplan` to reflect the minimal ISA blocks.
  2. Prototype the S0/S1 translators (CNL → SIG → `.aur`) using the narrowed grammar and tie them to the new ISA opcodes.
  3. Stand up regression cases (manifest + binary) that exercise each minimal ISA instruction via the interpreter harness.
