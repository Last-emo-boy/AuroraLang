# Aurora Seed DSL Interpreter Specification

> Drafted 2025-10-09 to define the initial requirements for the hand-authored `.aurs` manifest interpreter.

## Scope
- Execute on Linux x86-64 as the first implementation target; Windows port follows once Stage 1 assembler exists.
- Input: UTF-8 text file using Aurora Seed DSL v0 directives (`header`, `org`, `u8/u16/u32/u64`, `bytes`, `label`, `ref`, `pad`, `ascii`).
- Output: Binary file materializing directives in order, guaranteed to match layout documentation.
- No dynamic memory allocation beyond a fixed-size arena reserved at program start.
- Implementation language: handcrafted x86-64 machine code assembled via repository-owned tooling (hex authoring until assembler stage arrives).

## Functional Requirements
1. **Lexer**
   - Tokenize ASCII directives, identifiers, hexadecimal literals, and string literals.
   - Support comments beginning with `#` extending to end of line.
   - Ignore blank lines and whitespace (space, tab, carriage return, newline).

2. **Parser**
   - Enforce directive grammar:
     - `header <ident>`
     - `org <hex>`
     - `u8/u16/u32/u64 <hex>`
     - `bytes <hex-seq>` (even-length, no separators)
     - `label <ident>`
     - `ref <ident>`
     - `pad <hex>`
     - `ascii "..."`
   - Hex literals accept optional `0x` prefix.
   - Identifiers: `[A-Za-z_][A-Za-z0-9_]*`.

3. **Symbol Table**
   - Maintain mapping from label names to absolute offsets.
   - Allow forward references when used with `ref`; store relocation entries to patch after second pass.

4. **Emitter**
   - Track current offset pointer within output buffer.
   - `org` moves the write cursor; if the cursor jumps forward, fill gap with zeroes; jumping backward triggers error.
   - Numeric directives emit little-endian encoding sizes 1/2/4/8 as requested.
   - `bytes` copies literal byte sequence; `ascii` writes raw characters and null terminator if escaped `\0` encountered.
   - `pad` writes zero bytes until cursor hits target absolute offset.

5. **Error Handling**
   - Provide descriptive exit codes and error messages printed to stderr.
   - Detect overflow (writes beyond buffer limit), duplicate labels, undefined references, invalid hex, misaligned `u16/u32/u64` when alignment policy defined.

6. **I/O Contracts**
   - Read manifest via `open` + `read` syscalls into memory buffer (max size 64 KiB for Stage 0).
   - Write output binary using `open` (create/truncate) + `write` + `close`.
   - Accept CLI arguments: `aurseed <input.aurs> <output.bin>`.

7. **Verification Hooks**
   - Optional `--dry-run` flag to only validate input without writing output.
   - Optional `--trace` flag to print directive execution for debugging.
   - Flags parsed manually; absence defaults to materialization mode.

## Non-Goals (v0)
- No expression evaluation aside from literals and label references.
- No macro system or includes.
- No floating-point directives.
- No incremental builds; each run starts from zeroed buffer.

## Memory Layout
- 0x0000–0x00FF: static data section (strings, usage text).
- 0x0100–0x04FF: lexer/parser workspace (token buffers, symbol table entries).
- 0x0500–0xFFFF: output staging buffer (up to 64 KiB target binary).
- Stack used for call frames and temporary storage.

## Exit Codes
- `0`: success.
- `1`: CLI error / usage.
- `2`: I/O failure.
- `3`: Syntax error.
- `4`: Semantic error (label/relocation issues).
- `5`: Buffer overflow / capacity exceeded.

## Future Extensions
- Directive for checksum or hash insertion.
- Windows port using native syscalls once PE toolchain matures.
- Auto-generation of hash manifest as part of interpreter run.
