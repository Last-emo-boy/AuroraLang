# Aurora Seed Interpreter Verification Plan

> Ensures the handcrafted interpreter faithfully materializes Stage 0 binaries and adheres to zero-dependency guarantees.

## Goals
1. Confirm the interpreter parses `.aurs` manifests (`linux_stage0.aurs`, `windows_stage0.aurs`, `aurseed_linux.aurs`) without error.
2. Validate generated binaries byte-for-byte against documented layouts.
3. Ensure verification steps avoid external assemblers/compilers; only the interpreter and basic OS tools may be used for inspection.

## Test Matrix
| Test ID | Manifest | Output | Checks |
|---------|----------|--------|--------|
| V-001 | `seed/scripts/linux_stage0.aurs` | `seed/linux/aurora_seed_ok.bin` | Hash match, `OK` output, exit code 0 |
| V-002 | `seed/scripts/windows_stage0.aurs` | `seed/windows/aurora_seed_ok.exe` | Hash match, `OK\r\n` output (Windows), exit code 0 |
| V-003 | `seed/interpreter/manifests/aurseed_linux.aurs` | `out/aurseed_linux.bin` | ELF header inspection, smoke test on manifests |

## Procedure
1. **Preparation**
   - Build interpreter binary via hand-authored hex once ready.
   - Establish `out/` directory for artifacts.
2. **Execution**
   - Run `aurseed` with `--trace` against each manifest to capture directive log.
   - Re-run without trace to generate final binary.
3. **Validation**
   - Compare binary hashes to expected values in `seed/SHA256SUMS.txt` (to be populated).
   - Use OS-provided viewers (`readelf`, `dumpbin`) for informational checks only; record outputs in verification logs.
   - Execute Stage 0 binaries and record stdout + exit code.
   - For interpreter binary, run self-host test: `./aurseed out/aurseed_linux.aurs out/rebuild.bin` and diff with original.
4. **Logging**
   - Maintain log files under `verification/logs/` with timestamped run records.
   - Record CLI invocations, interpreter trace excerpts, hash results, and runtime observations.

## Success Criteria
- All tests V-001 through V-003 pass.
- No discrepancies in header fields vs documentation.
- Logs show no invocation of prohibited tools.

## Future Enhancements
- Automate verification harness inside future CI once tooling is self-hosted.
- Expand matrix with stress manifests (large pads, many labels) to validate table limits.
- Add Windows-native verification script mirroring Linux plan.
