# Tooling Constraints and Zero-Dependency Policy

> Drafted 2025-10-09 to codify the prohibition of external assemblers, compilers, or borrowed language runtimes.

## Core Principles
1. **Self-Sufficient Toolchain**
   - Every executable, library, or script used in the bootstrap path must originate within this repository.
   - Third-party binaries are disallowed, including assemblers, linkers, compilers, interpreters, and runtime libraries.

2. **No Language Borrowing**
   - Syntax, semantics, and tooling must be novel. We may study prior art conceptually, but we must not adopt reserved words, grammar fragments, or runtime semantics wholesale from existing languages.
   - All parsers, lexers, IRs, and code generators shall be authored from blank source files using only primitives we design.

3. **Byte-Level Authority**
   - Early-stage artifacts (Stage 0 hex seed, Stage 1 assembler/linker) will be expressed as manually curated byte sequences or custom-built encoders.
   - We may not rely on inline assembly features of host languages (C, Rust, etc.) nor the assemblers that ship with them.

4. **Transparent Build Path**
   - Each stage must expose deterministic scripts (Makefiles, Python scripts, etc.) that can be audited to confirm no external tool invocation occurs.
   - Scripts must emit reproducible hashes and include verification steps to demonstrate independence from operating system toolchains.

5. **External Interface Boundary**
   - Acceptable interactions with the host OS are limited to system loaders, raw system calls, file I/O, and process management for verification.
   - Use of OS-provided utilities (e.g., `objdump`, `link.exe`, `ld`) is prohibited for generating deliverables; they may only appear in optional diagnostics clearly marked as non-authoritative.

## Enforcement Checklist
- [ ] Audit build scripts to ensure only repository-local binaries are invoked.
- [ ] Maintain a manifest of approved host system interactions.
- [ ] Include policy references in stage-specific documentation.
- [ ] Establish CI guardrails that fail builds if forbidden tools are detected in logs.

## Future Enhancements
- Define a signing process for repository-produced binaries to certify provenance.
- Automate policy validation via log scanning and dependency tracking.
