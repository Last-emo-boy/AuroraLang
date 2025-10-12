# Stage 0 Plan — Hex Seed Bootstrapping

> Prepared 2025-10-09 to guide Stage 0 execution with multi-platform coverage and zero-dependency guarantees.

## Objectives
- Produce self-authored binaries for Linux (ELF64) and Windows (PE/COFF) that print `OK` and exit with status 0.
- Demonstrate byte-level control of instruction streams without calling external assemblers or compilers.
- Seed Stage 1 tooling with authoritative reference binaries and documentation.

## Target Platforms
1. **Linux x86-64 (ELF64, SysV ABI)** — baseline per master specification.
2. **Windows x86-64 (PE/COFF, MS x64 ABI)** — parity target ensuring early multi-OS awareness.

## Deliverables
- `seed/linux/aurora_seed_ok.bin`: raw ELF64 binary emitted from handcrafted byte array.
- `seed/windows/aurora_seed_ok.exe`: raw PE/COFF binary emitted from handcrafted byte array.
- `seed/docs/stage0_layout.md`: byte-by-byte commentary of headers, program segments, and relocation math.
- `specs/stage0_asm_notes.md`: canonical instruction byte sequences for both platforms.
- `seed/scripts/verify_stage0.py`: verification harness enforcing output, exit codes, and hash integrity.
- `specs/tooling_constraints.md`: policy reference assuring no borrowed tooling touches the build.
- `specs/aurora_minimal_isa.md`: authoritative definition of the Stage 0 minimal instruction set and its mapping to `.aurs` directives.
- `specs/aurora_translation_pipeline.md`: updated with accelerated milestones for natural-language-to-ISA compilation.
- `specs/aurora_concurrency_roadmap.md`: trajectory for multithreading features influencing metadata captured during Stage 0.
- `specs/aurora_compiler_mvp_plan.md`: defines the MVP compiler deliverables that rely on Stage 0 infrastructure.
- `docs/manual_compilation_walkthrough.md`: hand-authored reference for `.aur` → `.aurs` lowering prior to automated tooling.
- `specs/aurc_native_rewrite_plan.md`: outlines the transition from Python tooling to a native, standalone compiler.

## Work Breakdown

### 1. Header Specification & Layout
- [ ] Define ELF64 headers, program headers, and sectionless text layout with explicit offsets.
- [ ] Define PE/COFF DOS stub, NT headers, optional header, and minimal `.text`/`.rdata` sections.
- [ ] Compute entry point addresses and stack alignment expectations manually.

### 2. Instruction Stream Authoring
- [ ] Use `specs/stage0_asm_notes.md` as the source of truth for byte sequences.
- [ ] Encode Linux syscall path for `write` + `exit` with absolute immediates patched by custom script.
- [ ] Encode Windows console output and termination path using manually resolved imports or syscalls.
- [ ] Annotate each byte run inside `seed/docs/stage0_layout.md` to allow independent verification.

### 3. Generator Scripts
- [ ] Write minimal Python (or equivalent) scripts that emit binaries by concatenating hex-defined arrays.
- [ ] Embed assertions in scripts to validate offsets before writing files.
- [ ] Provide CLI entry points via `Makefile`: `stage0-linux`, `stage0-windows`, and `stage0-verify`.

### 3b. Minimal ISA Definition & Integration
- [ ] Finalize the Stage 0 minimal instruction set (`specs/aurora_minimal_isa.md`) with opcode semantics, operand formats, and `.aurs` directive coverage.
- [ ] Produce worked examples that translate simple Aurora snippets into minimal ISA sequences using existing interpreter helpers.
- [ ] Update `aurseed_linux.aurs` planning notes to reference instruction definitions where manifests rely on equivalent behavior.
- [ ] Derive verification vectors that ensure the interpreter faithfully executes the minimal ISA (unit tests plus end-to-end manifest traces).

### 4. Verification & Hashing
- [ ] Implement `seed/scripts/verify_stage0.py` to:
  - [ ] Run binaries on their native hosts (Linux, Windows/Wine) capturing stdout.
  - [ ] Validate exit codes.
  - [ ] Compute SHA-256 hashes recorded in `seed/SHA256SUMS.txt`.
- [ ] Document execution environment expectations (native, WSL, Wine) and mark them as non-authoritative helpers.

### 5. Policy Compliance
- [ ] Reference `specs/tooling_constraints.md` in every Stage 0 script header.
- [ ] Add automated checks ensuring no external assembler/compiler executable names appear in logs.
- [ ] Maintain provenance records for generated binaries.

### 6. Exit Criteria
- [ ] Both binaries duplicate the reference output (`OK` on Linux, `OK` or `OK\r\n` on Windows) and return code 0.
- [ ] Verification harness passes on targeted hosts.
- [ ] Documentation reviewed and linked from iteration log.
- [ ] Hash manifest generated and signed (once signing infrastructure exists).
- [ ] Minimal ISA spec ratified and referenced by interpreter/compiler deliverables.
- [ ] Natural-language pipeline milestones (CNL subset + `.aur` lowering) aligned with ISA coverage.

## Current Status (2025-10-12)
- Parser/interpreter helpers implemented; directive queue now records real operand metadata (see `specs/aurseed_offset_worklog.md`).
- Minimal ISA draft published with encoding guidance embedded in `seed/interpreter/aurseed_linux.asmplan`.
- Natural-language translation pipeline now anchored by `specs/aurora_cnl_to_aur_plan.md`, detailing lexer/parser/SIG milestones for the CNL compiler front-end.

## Next Actions
1. Execute `specs/aurora_cnl_to_aur_plan.md` Milestone M0 by refining the lexer design and seeding test fixtures, building on the published vocabulary catalog.
2. Promote the new minimal ISA worked examples (`specs/aurora_minimal_isa.md` §5) into regression fixtures by translating them into real manifests.
3. Schedule validation tasks: manifest-driven smoke tests per instruction, plus small CNL-to-manifest conversions exercising the new ISA subset.
4. Annotate interpreter helpers with placeholders for concurrency metadata (e.g., thread-safe flags) per the roadmap.
5. Sync Stage 0 documentation with `specs/aurora_compiler_mvp_plan.md` timelines to keep bootstrap artifacts aligned.
6. Prepare the Stage N1 native compiler scaffold per `specs/aurc_native_rewrite_plan.md` to begin phasing out the Python prototype.
