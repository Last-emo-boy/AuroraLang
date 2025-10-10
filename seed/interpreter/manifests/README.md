# Aurora Seed Interpreter Manifests

These manifests describe the handcrafted binary for the Aurora Seed interpreter. They are consumed by the interpreter itself once bootstrapped, and serve as the authoritative blueprint while the binary is authored manually.

## Files
- `aurseed_linux.aurs` — Code and layout manifest defining ELF headers, code sections, and arena placement for buffers and routines.
- `aurseed_linux_data.aurs` — Supplementary data manifest providing keyword tables, error strings, and CLI flag literals referenced by the code manifest.

## Composition Workflow
1. Load `aurseed_linux.aurs` to emit the executable skeleton (headers + code stubs).
2. Overlay `aurseed_linux_data.aurs` to populate static data regions at fixed offsets (0x2F00–0x34FF).
3. During manual assembly passes, verify that references (`ref`) resolve to the intended labels across both manifests.
4. Use `tools/manifest_analyzer.py` during authoring to list label offsets and locate outstanding call/jump placeholders before committing byte-level updates.

## Alignment & Offsets
- Keyword pointer table begins at `0x2F00` and contains 12 entries corresponding to directive keywords plus sentinel.
- Keyword strings occupy `0x3000`–`0x31FF` with null-terminated ASCII tokens.
- Error messages live at `0x3200`, ensuring error routines can reference them with absolute offsets.
- CLI flag strings (`--trace`, `--dry-run`) begin at `0x3400`.

## Future Extensions
- Add manifests for Windows interpreter variant once syscall surface is specified.
- Introduce checksum directives to validate manifest integrity pre-generation.
- Generate automated diff reports comparing emitted binaries to manifests for regression detection.
- Replace interim helper stubs (`match_directive`, `parser_expect_*`, etc.) with full logic as the interpreter matures; update call offsets if helper byte size changes.
