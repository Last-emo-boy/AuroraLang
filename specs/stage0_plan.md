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
