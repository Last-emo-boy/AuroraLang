# Aurora Seed Interpreter Architecture

> Explains the internal structure of the handcrafted `.aurs` interpreter for Stage 0 generation.

## High-Level Flow
1. **Bootstrap**
   - Parse command-line arguments, optionally enabling trace/dry-run flags.
   - Map two memory regions: manifest buffer (64 KiB) and output buffer (64 KiB).
2. **Pass 0 – Input Load**
   - Open manifest (syscall `open`/`read`).
   - Normalize line endings (map `\r\n` to `\n` in-place).
3. **Pass 1 – Tokenization & Directive Dispatch**
   - Iterate through characters, splitting tokens while tracking current column/line for error reporting.
   - Build directive records appended to a directive queue (fixed array of structs) containing opcode and raw operand indices.
   - Populate symbol table upon encountering `label` directives; unresolved references recorded in relocation list referencing directive queue indices.
4. **Pass 2 – Materialization**
   - Execute directive queue sequentially, updating output cursor and writing bytes.
   - Patch `ref` entries after all labels known; unresolved label triggers error.
5. **Finalize Output**
   - If not dry-run, create destination file, write output buffer up to highest cursor value, close file.
   - On trace flag, emit directive-by-directive summary to stdout.

## Data Structures (Stack / Static)
- **CLI State Block (64 bytes)**: flags, manifest pointer/length, output filename pointer.
- **Token Buffer Pool (4 KiB)**: ring buffer storing tokens as null-terminated strings.
- **Directive Table (max 512 entries)**: each entry (16 bytes) storing opcode, operand pointer/length, numeric literal.
- **Symbol Table (max 256 labels)**: entries containing hash, name pointer, resolved offset.
- **Relocation Table (max 256 refs)**: pointer to directive index + target label hash.
- **Output Cursor State (16 bytes)**: current offset, high-water mark, base pointer.

## Module Breakdown
- `main`: argument parsing, environment setup.
- `io_load`: open/read file, normalize newlines.
- `lexer_next`: returns next token (identifier, number, string, directive keyword).
- `parser_dispatch`: verifies directive grammar and populates directive table.
- `sym_lookup/sym_insert`: hash-based label management (FNV-1a over identifier bytes).
- `emit_*` routines: encode numeric directives, handle `pad`, manage `org` transitions.
- `reloc_apply`: iterate relocation table to patch references.
- `error_*`: print message using `write(2, ...)` and exit with code.

## Control Flow (Pseudo-Assembly)
```
main:
    parse_args
    open_input
    read_input
    normalize_lines
    init_tables
    pass1_tokenize
    pass2_emit
    if !dry_run:
        write_output
    exit(0)
```

## Assembly Implementation Notes
- Use callee-save registers (`rbx`, `rbp`, `r12`–`r15`) to hold pointers to major buffers and counts.
- Implement simple allocator by advancing offsets within preallocated arenas (no free).
- All loops use forward-only jumps to simplify manual encoding.
- Error routines accept code in `edi`, message pointer in `rsi`, length in `edx`.

## Windows Port Considerations
- Replace Linux syscalls with `WriteFile`, `CreateFile`, `ReadFile`, `CloseHandle`.
- Leverage shared parsing/emission logic with guarded syscall wrappers.

This architecture underpins the forthcoming assembly skeleton where each routine will be expressed as explicit machine code sequences.
