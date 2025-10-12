# Aurora Seed Interpreter Offset Reconciliation Checklist

> Use this checklist before finalizing hex bytes for the interpreter binary.

## 1. Section & Arena Anchors
- [ ] Confirm `entry_main` offset matches ELF entry (`0x400080`).
- [ ] Verify arena base addresses: keyword index at `0x002F00`, token storage at `0x00403000`, etc., according to manifest comments.
- [ ] Ensure data manifest offsets do not overlap with code bytes reserved in `aurseed_linux.aurs`.

## 2. Call / Jump Targets
- [x] For each `call` placeholder (`E8 ?? ?? ?? ??`), compute relative offset: `target - (call_site + 5)`.
- [x] Update manifest bytes with little-endian 32-bit signed offsets.
- [x] Validate loop back jumps (e.g., `parse_loop`) using same relative calculation.

## 3. Reference Directives
- [ ] Check every `ref <label>` resolves to defined label (keywords, messages, arena blocks).
- [ ] Record expected address table in spreadsheet/log for quick regression checks.

## 4. Syscall Numbers & Stubs
- [ ] Confirm syscall stubs use correct numbers (open=2, read=0, write=1, close=3, exit=60).
- [ ] Ensure stub `ret` instructions align with call sites (stack balanced).

## 5. Buffer Bounds
- [ ] Validate `emit_bytes` loops guard against overflow by comparing planned maximum lengths with allocated buffer size.
- [ ] Update relocation table slots to ensure `output_offset + size` stays within `0x10000` output buffer.

## 6. CLI Argument Access
- [ ] Cross-check pointer arithmetic retrieving `argv` entries: confirm offsets `+0x8`, `+0x10`, etc., match SysV ABI calling convention.
- [ ] Ensure flag string comparisons point to `str_trace`, `str_dryrun` addresses in data manifest.

## 7. Error Paths
- [ ] Verify `error_*` trampolines load message addresses and exit codes matching specification.
- [ ] Confirm `write` length matches actual message string length (update `mov edx` values accordingly).

## 8. Documentation Sync
- [ ] Reflect finalized offsets in `aurseed_linux.asmplan` comments.
- [x] Update `aurseed_linux.aurs` with final byte sequences and remove placeholder `E8 00 00 00 00` entries.
- [x] Record results in iteration log entry upon completion.
- [x] Capture analyzer output snapshots (`tools/manifest_analyzer.py`) alongside worklog updates for traceability.
