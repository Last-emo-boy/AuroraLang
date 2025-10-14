# DEPRECATED: C Native Implementation

## Status: ⚠️ Development Suspended

This C implementation has been **temporarily suspended** in favor of the JavaScript prototype in `pipeline/src/`.

## Why Suspended?

### Issue 1: Premature Optimization
We were building a native compiler before the language design was stable. This led to:
- Constantly rewriting parsers for syntax changes
- Complex memory management for evolving IR structures
- Slow iteration cycles (edit → compile → link → test)

### Issue 2: Wrong Tool for Prototyping
C is excellent for production compilers, but terrible for design-phase prototyping:
- String processing requires manual buffer management
- No built-in regex or easy parsing libraries
- Cross-platform build complexity (CMake/Makefile/MSVC)

### Issue 3: Duplicated Effort
Maintaining both C implementation and design specs was causing:
- Specifications drifting from implementation
- Bugs in memory management hiding logic errors
- Developer time spent on segfaults instead of language design

## What Replaced It?

**JavaScript prototype** at `pipeline/src/pipeline_driver.js`:
- Same ISA and manifest format
- 10x faster development speed
- Produces byte-identical output
- Serves as executable specification

## Will C Be Used Again?

**Yes, but differently:**

### Stage N3: Minimal Runtime
C will be used for:
- System call wrappers (write/exit/mmap)
- Heap allocator (if not implemented in Aurora)
- Platform-specific bootstrapping

### NOT for:
- ❌ Compiler logic (will be in Aurora itself)
- ❌ Parser/IR/code generation (will be in Aurora)
- ❌ Build scripts (will use Aurora tooling)

## Historical Artifacts

This directory contains:
- Early lexer/parser experiments
- Instruction encoding prototypes
- Manifest emitter that worked for hello_world

These are kept for reference but **should not be developed further** until:
1. JS prototype is feature-complete
2. Aurora language syntax is stable
3. Self-hosting compiler (written in Aurora) needs a bootstrap runtime

## Migration Path

```
Old Plan:  C compiler → Aurora programs → machine code
New Plan:  JS prototype → Aurora compiler (in Aurora) → native binary
```

C will reenter the picture as a **thin runtime layer**, not the compiler itself.

## See Also
- `pipeline/docs/c_vs_js_strategy.md` — Detailed comparison
- `pipeline/docs/self_hosting_roadmap.md` — Long-term evolution plan
- `pipeline/README.md` — Current active development location

---
*Archived: October 2025*  
*Reason: Design phase requires rapid iteration, not production performance*
