# Aurora Seed Interpreter Data Structures

> Defines the fixed layouts used by the hand-authored interpreter to manage parsing and emission state.

## Constants
- `MAX_TOKENS = 2048`
- `MAX_DIRECTIVES = 512`
- `MAX_LABELS = 256`
- `MAX_RELOCS = 256`
- `TOKEN_STORAGE = 4096` bytes

## Token Record (8 bytes)
| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0      | 1    | `type` | Token type enum (`0` EOF, `1` identifier, `2` hex literal, `3` string) |
| 1      | 1    | `flags` | Bit 0: is keyword; Bit 1: has prefix `0x`; others reserved |
| 2      | 2    | `length` | Token length in bytes |
| 4      | 4    | `offset` | Offset into token storage arena |

## Directive Record (16 bytes)
| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0      | 1    | `opcode` | Encoded directive enum |
| 1      | 1    | `padding` | Reserved (set 0) |
| 2      | 2    | `arg_count` | Number of operands |
| 4      | 4    | `arg0` | Operand descriptor (token index or immediate) |
| 8      | 4    | `arg1` | Secondary operand descriptor |
| 12     | 4    | `arg2` | Tertiary operand descriptor |

### Directive Queue Operations
- **Enqueue (`directive_emit`)**
	- Inputs: `al` = opcode, `cl` = operand count (0–3), `rdx`/`r8`/`r9` = operand descriptors, `r14` = tail pointer, `r15` = output buffer base.
	- Algorithm: verifies `r14` has not reached the queue limit (`directive_records + MAX_DIRECTIVES * 16`, computed via `r15 - 0xF400`). On success, zeroes the 16-byte record, writes the opcode/argument count, stores up to three operand descriptors based on `arg_count`, and advances `r14` by 16 bytes.
	- Error Cases: tail pointer at/after queue limit → semantic overflow (CF set, record untouched).
	- Notes: operands beyond `arg_count` remain zero so later passes can iterate deterministically.

## Symbol Table Entry (24 bytes)
| Offset | Size | Field |
|--------|------|-------|
| 0      | 8    | `hash` (FNV-1a 64-bit) |
| 8      | 4    | `name_offset` (into token storage) |
| 12     | 2   | `name_length` |
| 14     | 2   | `flags` (bit 0: defined, bit 1: referenced) |
| 16     | 8    | `value` (absolute offset) |

Symbols use linear probing within fixed table (`MAX_LABELS` entries). Empty slots marked by `hash = 0`.

## Relocation Entry (16 bytes)
| Offset | Size | Field |
|--------|------|-------|
| 0      | 8    | `symbol_hash`
| 8      | 4    | `output_offset` (where 64-bit value will be patched)
| 12     | 2    | `size` (1, 2, 4, 8)
| 14     | 2    | `flags` (bit 0: little-endian, bit 1: relative)

### Symbol Table Operations
	- Inputs: `rcx` = pointer to identifier token record, globals `r12` (token storage base) and `r15` (output buffer base) derive arena pointers, `rbx` supplies the label value (current cursor).
	- Algorithm: computes a 64-bit FNV-1a hash from the token text, then performs linear probing across `MAX_LABELS` entries (entry size 24 bytes) using the hash as primary key. Empty slots have `hash == 0`. Matching hashes trigger duplicate detection (CF set).
	- Stored Fields:
		- `hash` ← computed FNV-1a value
		- `name_offset` ← token storage offset (from token record)
		- `name_length` ← token length (word)
		- `flags` bit0 set to mark as defined
		- `value` ← `rbx` (absolute offset)
	- Error Cases:
		- Zero-length identifier (should not occur) → failure with CF set.
		- Table full after probing `MAX_LABELS` slots → overflow (CF set, no mutation).
		- Duplicate label (same hash encountered) → semantic error (CF set, entry unchanged).

## Output Cursor State (16 bytes)
| Offset | Size | Field |
|--------|------|-------|
| 0      | 8    | `current_offset`
| 8      | 8    | `high_water_mark`

## Arena Layout
```
0x0000–0x0FFF : Token storage (4 KiB)
0x1000–0x1FFF : Token records (MAX_TOKENS * 8 = 16 KiB)
0x2000–0x2FFF : Directive records (MAX_DIRECTIVES * 16 = 8 KiB)
0x3000–0x37FF : Symbol table (MAX_LABELS * 24 = 6 KiB)
0x3800–0x3FFF : Relocation table (MAX_RELOCS * 16 = 4 KiB)
0x4000–0x5FFF : Output cursor/state + padding
0x6000–0xFFFF : Output buffer (64 KiB)
```

## OpCode Mapping
- `0x01` = `header`
- `0x02` = `org`
- `0x03` = `u8`
- `0x04` = `u16`
- `0x05` = `u32`
- `0x06` = `u64`
- `0x07` = `bytes`
- `0x08` = `label`
- `0x09` = `ref`
- `0x0A` = `pad`
- `0x0B` = `ascii`

## Numeric Encoding Rules
- `u16/u32/u64` enforce little-endian placement via `emit_value` routine reading `size` field.
- `ref` directives record relocation entries with `size = 8` (future shrink support via flag).
- `org` updates output cursor; if target < current, raise error 4.

## Error Codes (recap)
- `0`: success
- `1`: CLI usage
- `2`: I/O error
- `3`: syntax error
- `4`: semantic error (label, relocation)
- `5`: overflow/out-of-bounds

This layout feeds directly into the hex authoring plan for the interpreter binary.
