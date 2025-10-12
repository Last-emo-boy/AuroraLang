# CI Guardrails for Zero-Dependency Assurance

> Drafted 2025-10-09 to enforce the tooling constraints defined in `specs/tooling_constraints.md`.

## Objectives
- Detect any attempt to invoke non-Aurora toolchains (assemblers, compilers, linkers) during automated checks.
- Guarantee that Stage 0 manifests and future build steps only rely on repository-authored executables.

## Guardrail Layers

### 1. Command Allow-List
- Maintain `ci/allowed_commands.txt` enumerating permitted system utilities (e.g., `sh`, `cat`, `printf`, `echo` for POSIX; `cmd`, `copy` for Windows).
- CI job wraps shell execution with a monitor script that aborts on disallowed command detection.

### 2. Process Audit Hook
- Collect process trees during CI runs via platform APIs (e.g., `procfs` on Linux, `GetProcessInformation` on Windows) to ensure no external tool (e.g., `nasm`, `gas`, `cl`, `link`) appears.
- Emit JSON logs archived as build artifacts for manual review.

### 3. Manifest Verification
- For each `.aurs` file, run a syntax checker (to be implemented in Aurora tooling) that ensures only approved directives exist.
- Reject manifests containing `include` or external reference directives.

### 4. Hash Provenance
- After Stage 0 binary generation, compute SHA-256 hashes and compare against expected values stored in `seed/SHA256SUMS.txt`.
- CI publishes the hash file plus the raw manifest used to generate binaries for reproducibility.

### 5. Log Scanning
- Implement regex-based scanners over CI logs to flag suspicious keywords (`nasm`, `gcc`, `clang`, `python`, `perl`, `powershell` beyond bootstrap wrapper, etc.).
- Provide suppression list maintained via code review only.

### 6. Policy Enforcement Summary
- CI job fails unless:
  - No disallowed commands executed.
  - Process audit clean.
  - Manifest verification passes.
  - Hash provenance matches.
  - Log scan yields zero violations.

## Implementation Roadmap
- [ ] Author monitor stub (in Aurora or minimal C replacement permitted under policy) for command tracking.
- [ ] Define initial allowed command sets for Linux and Windows workers.
- [ ] Draft schema for auditing logs (`ci/log_schema.json`).
- [ ] Integrate guardrail checks into future `ci/pipeline.yml` once CI infrastructure is scaffolding.
