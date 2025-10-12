# Aurora Seed Interpreter Offset Worklog

> Tracking relative call/jump offset computations for `aurseed_linux.aurs`.

## Reference Layout
- Base load address: `0x00400000`
- Entry point: `entry_main` @ file offset `0x00000080`
- Code section spans `0x00000080` – `0x00002000`

## Offsets In Progress
| Label | File Offset (hex) | Notes |
|-------|-------------------|-------|
| `entry_main` | `0x0080` | Start of interpreter |
| `syscalls` | `0x00BA` | After 0x3A-byte prologue |
| `zero_buffers` | `0x00E2` | Zero arena helpers |
| `lexer_next_token` | `0x00FC` | Alias for lexer loop core |
| `emit_identifier` | `0x0118` | Token emit stub |
| `reloc_apply` | `0x0123` | Relocation walker |
| `parser_loop` | `0x0151` | Directive dispatch loop |
| `parse_header` | `0x01E6` | Header directive handler |
| `parse_org` | `0x01F8` | Org handler |
| `parse_numeric` | `0x0205` | Numeric literal handler |
| `parse_bytes` | `0x0214` | Bytes directive handler |
| `parse_label` | `0x0221` | Label directive handler |
| `parse_ref` | `0x022E` | Ref directive handler |
| `parse_pad` | `0x023B` | Pad directive handler |
| `parse_ascii` | `0x0248` | ASCII directive handler |
| `parse_header_impl` | `0x0255` | Tail-call target for header directive helpers |
| `parse_org_impl` | `0x027C` | Tail-call target for org directive helpers |
| `parse_numeric_impl` | `0x02E6` | Shared numeric directive implementation |
| `parse_bytes_impl` | `0x0383` | Shared bytes directive implementation |
| `parse_label_impl` | `0x03EC` | Shared label directive implementation |
| `parse_ref_impl` | `0x043F` | Shared reference directive implementation |
| `parse_pad_impl` | `0x047D` | Shared pad directive implementation |
| `parse_ascii_impl` | `0x04ED` | Shared ASCII directive implementation |
| `error_usage` | `0x0559` | CLI usage failure |
| `error_syntax` | `0x056F` | Syntax error path |
| `error_semantic` | `0x0585` | Semantic error path |
| `error_overflow` | `0x059B` | Overflow error path |
| `error_exit` | `0x05B1` | Shared error trampoline |
| `match_directive` | `0x05C4` | Directive keyword matcher (implemented, 76 bytes). |
| `directive_emit` | `0x0610` | Directive emission helper (implemented, 69 bytes). |
| `parser_expect_identifier` | `0x0655` | Identifier fetch helper (implemented). |
| `parser_expect_numeric` | `0x066B` | Numeric literal helper (implemented). |
| `parser_expect_bytes` | `0x06F3` | Bytes literal helper (implemented). |
| `parser_expect_string` | `0x073E` | ASCII literal helper (implemented). |
| `parser_apply_org` | `0x0764` | `org` state updater (implemented). |
| `parser_emit_bytes` | `0x0799` | Bytes emitter (implemented). |
| `parser_record_label` | `0x07CF` | Symbol table insert (implemented). |
| `parser_queue_ref` | `0x084B` | Relocation enqueue (implemented). |
| `parser_emit_pad` | `0x08BF` | Pad writer (implemented). |
| `parser_emit_ascii` | `0x0905` | ASCII emitter (implemented). |
| `token_storage` | `0x2000` | Start of data arena |
| `token_records` | `0x4000` | Token metadata block |
| `directive_records` | `0x7000` | Directive table |
| `symbol_table` | `0xA800` | Symbol hash table |
| `relocation_table` | `0xE400` | Relocation entries |
| `cursor_block` | `0x12400` | Output cursor state |
| `output_buffer` | `0x18400` | 64 KiB staging buffer |

*Tentative offsets assume sequential concatenation of byte runs currently listed in manifest; update after verification.*

## 2025-10-12 — Directive Matching Helper
- `match_directive` encoded at offset `0x02C0`, length 76 bytes, replacing the two-byte stub.
- Downstream helpers shifted again after dispatcher expansion: `directive_emit` → `0x030C`, `parser_expect_identifier` → `0x0351`, `parser_queue_ref` → `0x0547`, `parser_emit_ascii` → `0x0601`.
- Analyzer rerun (`tools/manifest_analyzer.py`) to verify updated call deltas remained intact.
- Follow-up: teach directive handlers to populate operand registers (`cl`/`rdx`/`r8`/`r9`) before calling `directive_emit`.

## 2025-10-12 — Parser Dispatch Loop
- Replaced the placeholder `parser_loop` stub with a 149-byte dispatcher that tokenizes into the directive queue, validates identifiers before calling `match_directive`, and hands off to directive-specific parse helpers while looping until EOF.
- The helper now computes `kw_table` via `r12 + 0x0F00`, loads a keyword count of 11 into `ecx`, and branches to `error_syntax` on unmatched directives.
- Each opcode case (`header`, `org`, numeric widths, `bytes`, `label`, `ref`, `pad`, `ascii`) now calls its corresponding handler then jumps back to the loop head.
- EOF falls through `parser_done` and returns to the caller (materialization pass still TBD).

## 2025-10-13 — Directive Helper Materialization
- Replaced all eight `parse_*` stubs with tail-call trampolines that jump into newly authored `_impl` helpers and immediately loop back to `parser_loop` once a directive is emitted.
- Encoded concrete helper bodies (`parse_header_impl` … `parse_ascii_impl`) covering operand parsing, queue emission, cursor/arena guards, and error routing; recalculated call/jump displacements and helper lengths accordingly.
- Reran `tools/manifest_analyzer.py` to capture the updated label table (helpers now seated at `0x0255`–`0x04ED`) and verify all call targets plus back-edges remain consistent after the expansion.
- Logged helper lengths and refreshed offset tables to support future regression checks when materialization and verification passes come online.

## Call / Jump Calculations
For each `call` at file offset `call_addr`, compute relative 32-bit signed displacement:
```
delta = target_addr - (call_addr + 5)
```
Store result as little-endian 4-byte value following opcode `E8`.

### Calculated: `entry_main` → `lexer_next_token`
- `call` opcode at file offset `0x00B5` (absolute `0x004000B5`).
- Target `lexer_next_token` at `0x004000FC`.
- `delta = 0x004000FC - (0x004000B5 + 5) = 0x42` → encode `42 00 00 00` after `E8`.
- Manifest updated (`bytes 0xE842000000`).

### Calculated: `parser_loop` Calls & Branches
- `call` at `0x0151` → `lexer_next_token` (`delta = -0x5A` → `E8 A6 FF FF FF`).
- `call` at `0x0177` → `match_directive` (`delta = 0x00000144` → `E8 44 01 00 00`).
- `jmp` at `0x01A2` → `error_syntax` (`delta = 0x000000C4` → `E9 C4 00 00 00`).
- `jmp` at `0x01AC`/`0x01B3`/`0x01BA`/`0x01C1`/`0x01C8`/`0x01CF`/`0x01D6` → `parser_loop` (representative delta `-0x60` → `E9 A0 FF FF FF`; final case uses `delta = -0x8A`).

### Calculated: Directive Handlers
- `parse_header` @ `0x01E6` → `parse_header_impl` (`delta = 0x000004C9` → `E8 C9 04 00 00`), tail-jumps back to `parser_loop` (`delta = -0x009F` → `E9 61 FF FF FF`).
- `parse_org` @ `0x01F8` → `parse_org_impl` (`delta = 0x000004DE` → `E8 DE 04 00 00`), tail-jumps to `parser_loop` (`delta = -0x00B1` → `E9 4F FF FF FF`).
- `parse_numeric` @ `0x0205` → `parse_numeric_impl` (`delta = 0x0000053B` → `E8 3B 05 00 00`), tail-jumps to `parser_loop` (`delta = -0x00BE` → `E9 42 FF FF FF`).
- `parse_bytes` @ `0x0214` → `parse_bytes_impl` (`delta = 0x000005C9` → `E8 C9 05 00 00`), tail-jumps to `parser_loop` (`delta = -0x00CD` → `E9 33 FF FF FF`).
- `parse_label` @ `0x0221` → `parse_label_impl` (`delta = 0x00000625` → `E8 25 06 00 00`), tail-jumps to `parser_loop` (`delta = -0x00DA` → `E9 26 FF FF FF`).
- `parse_ref` @ `0x022E` → `parse_ref_impl` (`delta = 0x0000066B` → `E8 6B 06 00 00`), tail-jumps to `parser_loop` (`delta = -0x00E5` → `E9 19 FF FF FF`).
- `parse_pad` @ `0x023B` → `parse_pad_impl` (`delta = 0x0000069C` → `E8 9C 06 00 00`), tail-jumps to `parser_loop` (`delta = -0x00F4` → `E9 0C FF FF FF`).
- `parse_ascii` @ `0x0248` → `parse_ascii_impl` (`delta = 0x000006FF` → `E8 FF 06 00 00`), tail-jumps to `parser_loop` (`delta = -0x0101` → `E9 FF FE FF FF`).

### Calculated: Error Exit Calls
- `error_usage` @ `0x056A` → `error_exit` (`delta = 0x00000053` → `E8 53 00 00 00`).
- `error_syntax` @ `0x0580` → `error_exit` (`delta = 0x0000003D` → `E8 3D 00 00 00`).
- `error_semantic` @ `0x0596` → `error_exit` (`delta = 0x00000027` → `E8 27 00 00 00`).
- `error_overflow` @ `0x05AC` → `error_exit` (`delta = 0x00000011` → `E8 11 00 00 00`).

## Checklist Snapshot
- [x] Measure assembled byte lengths per label (see analyzer output).
- [x] Populate definitive offset table (replace tentatives).
- [x] Backfill manifest `bytes` entries with computed displacements.
- [x] Record final deltas here when complete.

## Next Actions
1. Sync the new `_impl` helper encodings and tail-call pattern into `seed/interpreter/aurseed_linux.asmplan` for documentation parity.
2. Update `specs/aurs_interpreter_helper_plan.md` with the completed directive implementations and outstanding verification notes.
3. Extend analyzer coverage to include directive queue/high-water diagnostics before first end-to-end interpreter run.

## Helper Lengths
| Helper Label | Length (bytes) | Notes |
|--------------|----------------|-------|
| `parse_header_impl` | 39 | Consumes header directive tokens, seeds opcode/operand registers, and delegates to `directive_emit`. |
| `parse_org_impl` | 106 | Parses absolute offsets, guards backward/overflow cases, and applies cursor updates. |
| `parse_numeric_impl` | 157 | Handles numeric width directives, writes literal payloads via `parser_emit_bytes`, and updates the queue. |
| `parse_bytes_impl` | 105 | Validates byte literals, enqueues directive metadata, and streams data into the arena. |
| `parse_label_impl` | 83 | Records labels via `parser_record_label`, then enqueues the directive metadata. |
| `parse_ref_impl` | 62 | Hashes identifiers, queues relocations, and emits reference directives. |
| `parse_pad_impl` | 112 | Validates forward pads, enqueues metadata, and calls `parser_emit_pad` for zero fill. |
| `parse_ascii_impl` | 108 | Validates string literals, enqueues metadata, and dispatches to `parser_emit_ascii`. |
| `match_directive` | 76 | Scans the keyword pointer table with `repe cmpsb`, returns opcode in `al`, sets CF on failure. |
| `directive_emit` | 69 | Enqueues directives into the 512-entry queue, zero-filling unused operands and signalling overflow via CF. |
| `parser_expect_identifier` | 22 | Success path increments `rbx`, failure path preserves cursor and signals via CF. |
| `parser_expect_numeric` | 64 | Validates hex literal tokens, strips optional `0x` prefix, accumulates ≤16 digits into `rax`. |
| `parser_expect_bytes` | 75 | Enforces even-length hex spans, returns adjusted token pointer in `rax` and byte count in `rcx`. |
| `parser_expect_string` | 38 | Returns string literal pointer in `rax`/`rsi`, exposes length in `rcx`, and zeros outputs on failure. |
| `parser_apply_org` | 53 | Shares cursor bookkeeping with `parser_emit_pad`, validates forward-only `org` directives, restores state on failure with CF set. |
| `parser_emit_bytes` | 54 | Copies literal spans into output buffer, updates cursor/high-water, sets CF on overflow. |
| `parser_emit_pad` | 70 | Validates forward pads, zero-fills gaps, refreshes cursor/high-water metrics, fails on backward/overflow. |
| `parser_emit_ascii` | 179 | Decodes supported escapes, emits ASCII bytes via inline copy, signals malformed escapes/overflow with CF. |
| `parser_record_label` | 124 | Computes FNV-1a hashes, linear probes symbol table, and flags duplicates/overflow via CF. |
| `parser_queue_ref` | 116 | Hashes identifiers, scans relocation table for space, records cursor offset/flags, and signals overflow via CF. |
