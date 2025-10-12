# AuroraLang Bootstrap TODO

> Derived from `specificatio.md` on 2025-10-09.

## Immediate Focus
- [ ] Stage 0: Produce hex-seeded ELF64 executable printing `OK` (Linux baseline).
  - [ ] Document ELF header layout and offsets.
  - [ ] Provide build script (`make run`) and verification steps.
  - [ ] Capture deltas required for Windows PE/COFF minimal stub and define parity acceptance.
  - [ ] Finalize raw instruction byte tables per `specs/stage0_asm_notes.md`.
  - [ ] Enforce zero-dependency policy per `specs/tooling_constraints.md` in Stage 0 scripts.
- [ ] Stage 1: Implement minimal assembler `aurasm0` and linker `aurld0`.
  - [ ] Instruction encoding tables for required mnemonics.
  - [ ] Relocation support for `R_X86_64_PC32` and `R_X86_64_32`.
  - [ ] End-to-end "Hello, world" demo.
  - [ ] Spike Windows PE relocation/section handling strategy for parity with ELF.
- [ ] Stage 2: Design Aurora IR and build bytecode VM `aurvm`.
  - [ ] Define IR node set including concurrency primitives.
  - [ ] Implement interpreter, REPL, and scheduling simulation.
  - [ ] Validate acceptance programs on VM.
  - [ ] Ensure IR abstracts OS-specific syscalls behind portable runtime surface.
- [ ] Stage 3: Deliver native compiler `aurc`.
  - [ ] Hand-rolled lexer and parser.
  - [ ] AST → IR lowering with basic optimizations (const-fold, DCE, inline, escape).
  - [ ] Instruction selection + linear-scan register allocation + ELF64 emission.
  - [ ] Plan codegen backends: Linux ELF64 first, Windows PE/COFF second (shared mid-end and register allocator).
- [ ] Stage 4: Type system and borrow checker.
  - [ ] Static type checker with generics and ADTs.
  - [ ] Exhaustiveness checking for pattern matching.
  - [ ] Ownership model (`move`, `&`, `&mut`, `Share`, `Send`).
  - [ ] Validate FFI surface abstraction for per-OS bindings.
- [ ] Stage 5: Runtime, scheduler, and standard library foundation.
  - [ ] M:N scheduler with structured concurrency APIs.
  - [ ] Channels, select, cancellation, timeout.
  - [ ] Sync primitives, deterministic testing hooks, basic std modules.
  - [ ] Define OS-adaptive runtime shims (Linux epoll, Windows IOCP, fallback portable layer).

## Cross-Cutting Deliverables
- [ ] Design documentation for each stage (README/SPEC updates).
- [ ] Automated acceptance scripts and reproducible build hashes.
- [ ] Why-not decisions, ABI/relocation checklists, performance metrics.
- [ ] Platform matrix tracking (Linux x86-64, Windows x86-64, future targets) with CI hooks and parity gates.
- [ ] Tooling provenance manifest verifying absence of external assemblers/compilers.

## Open Questions
- [ ] Define originality guardrails for syntax keywords and grammar evolution.
- [ ] Detail bootstrap chain artifacts and signing workflow.
- [ ] Choose deterministic scheduler algorithm for VM vs runtime convergence.
- [ ] Determine Windows bootstrap path (PE hex seed, loader assumptions, syscall surface).
- [ ] Evaluate cross-platform abstraction boundary for system calls and threading primitives.
- [ ] Specify automated enforcement of zero-dependency policy (log scans, CI hooks).
