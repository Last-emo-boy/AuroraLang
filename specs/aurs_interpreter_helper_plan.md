# Aurora Seed Interpreter Helper Implementation Plan

> Iteration 11 (2025-10-10) — translating parser/emitter stubs into concrete machine code.

## Objectives
- Replace the twelve helper stubs currently encoded as `xor eax, eax; ret` in `aurseed_linux.aurs` with real implementations aligned with the data-structure spec.
- Preserve existing call offsets where possible; when code growth requires relocation, document the new offsets in `specs/aurseed_offset_worklog.md` and regenerate analyzer reports.
- Keep helper logic side-effect free beyond documented arenas to avoid corrupting the handcrafted memory layout.

## Helper Responsibilities
| Helper Label | Inputs (Registers) | Outputs | Description |
|--------------|--------------------|---------|-------------|
| `match_directive` | `rsi` → token record pointer, `rdi` → keyword table, `rcx` → keyword count | `al` = opcode (1–11), `cf` set on failure | Performs linear scan over keyword table, comparing token text to directive keywords; returns opcode index or sets carry for syntax error. |
| `directive_emit` | `al` → opcode, `cl` → arg count, `rdx`/`r8`/`r9` → operand descriptors, `r14` → directive tail pointer, `r15` → output buffer base | none | Stores directive metadata into the queue, zero-fills unused operands, advances the tail pointer, and signals overflow via CF. |
| `parser_expect_identifier` | `r13` → token stream cursor, `r12` → token storage base | `rax` → token index, `al` non-zero on success | Validates that the current token type is identifier, advances cursor, returns index for downstream consumers. |
| `parser_expect_numeric` | token cursor registers as above | `rax` → parsed 64-bit value | Converts hex literal (with optional `0x`) into 64-bit integer, sets error flags on overflow/non-hex digit. |
| `parser_expect_bytes` | token cursor, buffer pointers | `rax` → pointer to byte data, `rcx` → length | Validates even-length hex literal and prepares for `bytes` emission. |
| `parser_expect_string` | token cursor | `rax`/`rsi` → storage pointer, `rcx` → length | Returns pointer/length for ASCII literal including escaped sequences. |
| `parser_apply_org` | `rbx` → requested absolute offset, `r15` → output buffer base (for `cursor_block` derivation) | none | Validates forward-only cursor updates for `org`, updates `cursor_block` low/high water marks, restores prior cursor on failure. |
| `parser_emit_bytes` | `r15` → output buffer base, `rcx` → length, `rsi` → source pointer | none | Copies literal byte sequences into output buffer, updating cursor and high-water mark. |
| `parser_record_label` | `rcx` → token record pointer, globals `r12/r15` for arena bases, `rbx` → current offset | none | Hashes identifier (FNV-1a), inserts into symbol table with duplicate/overflow detection, marks entry as defined. |
| `parser_queue_ref` | `rcx` → identifier token record, `r12` → token storage base, `r15` → output buffer base | none | Hashes identifier, scans relocation table for an open slot, records current cursor offset/width, and signals overflow via CF. |
| `parser_emit_pad` | `rcx` → target absolute offset, `rbx` → current cursor, `r15` → output buffer base | none | Fills zero bytes until desired absolute offset reached, updates cursor/high-water, and sets CF on backward/overflow conditions. |
| `parser_emit_ascii` | `rax`/`rsi` → token storage pointer, `rcx` → raw token length, `rbx` → cursor, `r15` → output buffer | none | Decodes supported escapes (`\n`, `\t`, `\r`, `\0`, `\"`, `\\`), emits bytes into output arena, and updates cursor/high-water while signalling errors via CF.

## Calling Convention Matrix
The register map below consolidates assumptions from architecture notes so helper authors can reason locally. Callee-save obligations follow System V unless explicitly overridden.

| Register | Global Role | Helper Usage | Mutability |
|----------|-------------|--------------|------------|
| `r12` | Token storage base (`token_storage`) | Added to token offsets when returning identifier/string pointers. | Read-only |
| `r13` | Token record array base (`token_records`) | Combined with token cursor (`rbx`) to locate current token record (`r13 + rbx*8`). | Read-only |
| `r14` | Directive record tail pointer | Advanced by 16 bytes whenever `directive_emit` enqueues a new directive. | Mutated by `directive_emit` only |
| `r15` | Output buffer base (`output_buffer`) | Source for `parser_emit_*` when writing to the staging arena. | Read-only |
| `rbx` | Token cursor (record index) | Incremented by each successful `parser_expect_*`; failure paths leave it untouched. | Mutated by `parser_expect_*` helpers |
| `rbp` | Scratch for helpers needing locals | Optional spill slot for numeric parsing; helpers must restore before return. | Helper-specific |
| `rax` | Primary return register | Carries helper-specific return values (record pointer, numeric literal, etc.). | Mutated |
| `rcx` | Scratch / length register | Stores token length or copy counts for emit routines. | Mutated |
| `rdx` | Secondary scratch | Used as numeric accumulator or destination offset. | Mutated |
| `r8/r9/r10` | Auxiliary scratch registers | Borrowed for keyword comparisons, symbol hashes, relocation bookkeeping. | Mutated per helper |

Invariant: helpers that succeed clear CF (`clc`) before returning; failure paths set CF (`stc`) and leave observable state (e.g., `rbx`) unchanged so the parser can branch to error handlers without secondary effects.

## Implementation Strategy
1. **Finalize Calling Conventions**
   - Confirm register usage from `aurseed_linux.asmplan` and annotate helper comment blocks with explicit expectations.
   - Extend `aurseed_offset_worklog.md` with a quick reference table mapping helpers to registers and data structures.
2. **Author Assembly Sketches**
   - For each helper, write NASM-style pseudo-assembly plus byte-by-byte encoding (where known) in `aurseed_linux.asmplan`.
   - Include branch annotations and loop bounds to aid hand-encoding.
3. **Update Manifests**
   - Incrementally replace stub `bytes` entries in `aurseed_linux.aurs` with encoded sequences.
   - After each helper replacement, rerun `tools/manifest_analyzer.py` to capture new offsets and validate call deltas.
4. **Diagnostics & Error Paths**
   - Ensure helpers set `al=0` and jump to `error_syntax`/`error_semantic` as appropriate when validation fails.
   - Record error-handling strategy per helper in `specs/aurs_interpreter_verification.md` for future test coverage.

## Implementation Progress
- **2025-10-10** — `parser_expect_identifier` encoded (22 bytes) in `seed/interpreter/manifests/aurseed_linux.aurs`; parser call sites now reference updated offsets. Success path advances `rbx` and returns the token record pointer in `rax`, while failure preserves cursor state and sets CF.
- **2025-10-10** — `parser_expect_numeric` encoded (64 bytes). The helper validates type `0x02`, handles optional `0x` prefixes via token flags, clamps literals to ≤16 hex digits, converts digits inline with range checks, and returns the 64-bit value in `rax` while advancing `rbx` only on success.
- **2025-10-10** — `parser_expect_bytes` encoded (75 bytes). Validates hex literal tokens for the `bytes` directive, strips optional `0x`, enforces even digit count, returns the adjusted storage pointer in `rax` along with byte count in `rcx`, and advances `rbx` on success while zeroing outputs on failure.
- **2025-10-10** — `parser_emit_bytes` encoded (54 bytes). Performs capacity checks against the 64 KiB buffer, copies literal data via `rep movsb` from `rsi`, updates the cursor and high-water mark stored in `cursor_block`, and signals overflow by setting CF without mutating `rbx`.
- **2025-10-10** — `parser_emit_pad` encoded (70 bytes). Validates forward-only movement, enforces the 64 KiB arena limit, zero-fills spans with `rep stosb`, and updates `cursor_block` while preserving state on failure.
- **2025-10-10** — `parser_apply_org` encoded (53 bytes). Shares cursor bookkeeping with pad helper, enforces forward-only `org` targets within the 64 KiB arena, updates the high-water mark lazily, and restores prior cursor on semantic/overflow failures while signalling via CF.
- **2025-10-10** — `parser_expect_string` encoded (38 bytes). Validates token type `0x03`, returns the literal pointer in both `rax` and `rsi`, surfaces the raw byte length in `rcx`, advances the cursor on success, and zeros all outputs when signalling failure via CF.
- **2025-10-10** — `parser_emit_ascii` encoded (179 bytes). Decodes escape sequences while rewriting the literal in place, reuses the bytes-emitter overflow checks to update the cursor/high-water pair, and reports malformed escapes or buffer overflow via CF.
- **2025-10-10** — `parser_record_label` encoded (124 bytes). Computes FNV-1a hashes from token records, performs linear-probing insert into the symbol table, flags duplicates via CF, and records offset/metadata for defined labels.
- **2025-10-10** — `parser_queue_ref` encoded (116 bytes). Reuses the FNV hashing loop to tag referenced symbols, walks the relocation table for the first empty slot, stores the current cursor offset/size metadata, and reports overflow via CF without mutating the token cursor.
- **2025-10-10** — `directive_emit` encoded (69 bytes). Guards the 512-entry directive queue, zeroes each record, conditionally writes up to three operand descriptors, advances `r14` by 16 bytes, and surfaces overflow via CF for semantic error handling.
- **2025-10-12** — `match_directive` encoded (76 bytes). Walks the keyword pointer table with `repe cmpsb`, verifies token text matches a null-terminated directive keyword, increments the opcode accumulator per miss, and signals syntax failure via CF when no keyword matches.
- **2025-10-13** — Implemented directive `_impl` helpers (`parse_header_impl` … `parse_ascii_impl`) and converted the original directive stubs into call+jmp trampolines. Helpers now orchestrate operand parsing, queue emission via `directive_emit`, cursor updates, and error routing for every Stage-0 directive.

## Success Criteria
- Directive matching, identifier/numeric expectation, and emission helpers behave per `specs/aurs_interpreter_spec.md` semantics.
- Analyzer reports remain free of unresolved relocations; helper byte lengths documented.
- Iteration log entry captures helper implementation progress and residual TODOs for subsequent iterations.

## Open Questions
- Should directive lookup remain linear or upgrade to hashed dispatch leveraging FNV-1a values already computed for labels?
- How to structure trace flag output without bloating helper code? (Consider centralized tracing routine.)
- What is the maximum manifest length the Stage 0 interpreter must support before requiring streaming tokenization?
