# aurc_native — Stage N1 Compiler Skeleton

This directory houses the native Aurora compiler rewrite (Stage N1) as described in `specs/aurc_native_rewrite_plan.md`.

## Layout
- `include/` — shared headers.
- `src/` — implementation files (lexer, parser, emitter). Currently contains a minimal translator for the hello-world subset (`let` string, `request service print/exit`, `return`).
- `tests/` — manifest parity tests shared with the Python MVP (to be populated).

## Usage
### Using CMake (Windows-friendly)
```powershell
cd src/aurc_native
cmake -S . -B build -G "Ninja"   # or "Visual Studio 17 2022" if preferred
cmake --build build
# Optional: produce binaries directly alongside manifests
.uild\Release\aurc-native.exe compile ..\..\examples\hello_world.aur -o build\hello_world.aurs --emit-bin build\hello_world.bin
```
The resulting executable lives at `build/aurc-native.exe` when using the Ninja generator. Replace the generator with any CMake-supported one that matches your toolchain.

### Using make (POSIX toolchains)
```bash
cd src/aurc_native
make             # builds aurc-native
make run         # compiles examples/hello_world.aur and diffs manifest against fixture
# Manually produce a binary via the assembler hook
./aurc-native compile ../../examples/hello_world.aur -o build/hello_world.aurs --emit-bin build/hello_world.bin
```

## Next Steps
1. Replace ad-hoc parsing with the full lexer/parser from the MVP plan.
2. Expand lowering to cover arithmetic, branching, and multiple string bindings.
3. Add automated parity tests under `tests/` for additional fixtures.
4. Integrate interpreter invocation (`--emit-bin`) once Stage 0 exposes the CLI hook.
