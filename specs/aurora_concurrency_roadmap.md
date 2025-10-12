# Aurora Concurrency & Multithreading Roadmap

> Drafted 2025-10-12 — Outlines the path toward Aurora's optimized multithreaded runtime and language features.

## 1. Vision
- Deliver first-class language support for structured concurrency, parallel algorithms, and lock-free data structures.
- Maintain deterministic semantics where possible (structured join patterns) while exposing low-level primitives for high-performance workloads.
- Integrate compiler analyses (escape analysis, ownership-based thread safety) to enable zero-cost abstractions over OS threads and fibers.
- Coordinate with compiler MVP scope (`specs/aurora_compiler_mvp_plan.md`) so early releases emit concurrency metadata even before runtime activation.

## 2. Milestone Ladder

| Milestone | Target Date | Focus | Key Deliverables |
|-----------|-------------|-------|-------------------|
| M0 — Stage 0 Prep | 2025-11 | Ensure bootstrap toolchain tracks thread-safe metadata even before concurrency code executes. | Ownership qualifiers, borrow rules baseline, docs aligning Stage 0 with future concurrency expectations. |
| M1 — Structured Concurrency MVP | 2026-Q1 | Introduce `spawn`, `join`, scoped tasks using interpreter-backed manifests. | Spec updates for `spawn/join`, interpreter helpers for task queue emulation, smoke tests. |
| M2 — Scheduler & Runtime | 2026-Q2 | Implement work-stealing scheduler, cooperative multitasking hooks. | Runtime crate, scheduler profiling harness, instrumentation pipeline. |
| M3 — Data Parallelism | 2026-Q3 | Add parallel iterators, reduction constructs, memory layout optimizations. | Compiler lowering passes, vectorization hooks, benchmark suite. |
| M4 — Lock-Free Primitives | 2026-Q4 | Provide atomic types, wait-free queues, hazard pointer APIs. | Memory model documentation, verification harnesses, interoperability tests. |
| M5 — Adaptive Optimization | 2027 | Profile-guided tuning, auto-fusing tasks, hybrid CPU/GPU scheduling research. | Optimizer prototypes, cost model docs, cross-device interface specification. |

## 3. Stage 0 Requirements
- Define ownership and mutability annotations to detect safe sharing (`Send`/`Share` analog placeholders).
- Encode metadata in `.aurs` manifests to simulate concurrency semantics (even if single-threaded interpreter executes them sequentially).
- Lay groundwork for future `spawn` directive encoding within minimal ISA extension proposals.

## 4. Language Surface Outline
- **Keywords**: `spawn`, `join`, `scope`, `channel`, `select`, `async`, `await` (staged rollout).
- **Structured Concurrency**: tasks must join or cancel before scope exit to prevent leaks.
- **Channels**: typed bounded/unbounded channels with back-pressure semantics.
- **Cancellation**: cooperative cancellation tokens propagated through task hierarchies.
- **Task-local Storage**: explicit APIs; no implicit TLS.

## 5. Runtime & Scheduler Concepts
- Multi-core aware work-stealing queues to balance tasks.
- Optional cooperative scheduling via `yield`, with fallback to OS threads for blocking operations.
- Instrumentation hooks for profiling (timeline events, contention metrics).
- Deterministic testing mode with virtual scheduler for reproducible unit tests.

## 6. Compiler Support
- Escape analysis determines when values can move across threads.
- Borrow checker extensions ensure shared references require synchronization traits.
- Optimization passes detect parallelizable loops and insert runtime calls.
- Interaction with minimal ISA: plan `spawn`, `join`, `yield`, `atomic` opcodes (tracked in ISA extension list).

## 7. Verification Strategy
- Model concurrency semantics using litmus tests (store-load reordering, happens-before).
- Fuzz harness for scheduler to uncover race conditions.
- Formalize memory model referencing C++20/LLVM-like semantics while preserving simplicity for language users.

## 8. Dependencies & Open Questions
- Decide on default scheduler strategy (cooperative vs preemptive) for early releases.
- Determine minimum viable memory model documentation required before exposing atomics.
- Align with translation pipeline to ensure CNL and `.aur` syntax represent concurrency constructs.
- Research cost of embedding GPU task scheduling into same abstraction.
