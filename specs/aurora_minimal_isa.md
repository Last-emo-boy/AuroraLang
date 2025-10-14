# Aurora Minimal Instruction Set (Stage 0 Draft)

> Status: Draft (2025-10-13) — establishes the smallest executable subset
> required to translate controlled natural-language programs into `.aurs`
> manifests that run on the handcrafted interpreter.

## 1. Design Goals
- Provide a stable target for the Stage 0 interpreter and early compiler
  prototypes.
- Keep the opcode surface compact while covering arithmetic, control flow,
  memory access, and syscall shims needed for bootstrap demos.
- Map cleanly onto `.aurs` directives so that manifests remain human-auditable
  and tool-friendly.
- Align terminology with the upcoming Aurora Virtual Machine (Stage 1) to
  simplify later migration.

## 2. Execution Model
- **Word Size**: 64 bits little-endian.
- **Registers**: Eight general-purpose (`r0`–`r7`) plus `pc` (program counter)
  and `sp` (stack pointer). Interpreter maintains them in the directive queue.
- **Memory**: Flat 64 KiB arena shared with existing interpreter buffers.
- **Calling Convention**: `call` pushes return address to stack; callee restores
  prior frame and returns via `ret`.
- **Syscall Bridge**: `svc imm8` proxies to interpreter helpers for Stage 0
  (numeric literal selects syscall shim).

## 3. Instruction Catalog

| Opcode | Mnemonic | Operands | Effect | `.aurs` Mapping |
|--------|----------|----------|--------|-----------------|
| `0x00` | `nop`    | —        | No-op (keeps alignment) | `directive_emit` with opcode `header` payload 0 |
| `0x01` | `mov`    | `dst, src` | Copy register or load immediate | `bytes` directive encoding register ids + literal |
| `0x02` | `ld`     | `dst, [addr]` | Load 64-bit value from memory | `bytes` + relocation via `parser_queue_ref` |
| `0x03` | `st`     | `[addr], src` | Store 64-bit value to memory | `bytes` directive + relocation |
| `0x04` | `add`    | `dst, lhs, rhs` | `dst = lhs + rhs` | Numeric helper emission |
| `0x05` | `sub`    | `dst, lhs, rhs` | `dst = lhs - rhs` | Numeric helper emission |
| `0x06` | `cmp`    | `lhs, rhs` | Set condition flags | Encoded branch metadata (`directive_emit` arg) |
| `0x07` | `jmp`    | `target` | Unconditional branch | `parse_ref_impl` + relocation |
| `0x08` | `cjmp`   | `cond, target` | Branch if flag matches `cond` | Directive with predicate bitfield |
| `0x09` | `call`   | `target` | Push return address; jump | Label reference + relocation entry |
| `0x0A` | `ret`    | — | Pop return address; jump | Emits opcode with no operands |
| `0x0B` | `svc`    | `imm8` | Invoke interpreter syscall shim | Numeric literal + runtime dispatch |
| `0x0C` | `halt`   | — | Terminate program | Maps to interpreter `error_exit` success path |
| `0x0D` | `mul`    | `dst, lhs, rhs` | `dst = lhs * rhs` | Numeric helper emission |
| `0x0E` | `div`    | `dst, lhs, rhs` | `dst = lhs / rhs` (truncated) | Numeric helper emission |
| `0x0F` | `rem`    | `dst, lhs, rhs` | `dst = lhs % rhs` | Numeric helper emission |

*Encoding*:
- All instructions occupy 16 bytes in the directive queue for alignment. The
  first byte stores opcode; subsequent bytes store operands as register ids,
  immediates, or relative targets. Existing helpers (`parse_numeric_impl`,
  `parse_ref_impl`) already populate these slots.

### 3.1 Encoding Layout (8-byte Slot)

Stage 0 emits compact 64-bit instruction records. Each `bytes` directive stores a
single big-endian word with the following layout:

| Byte Index | Purpose | Notes |
|------------|---------|-------|
| `[0]` | Opcode | Matches table above. |
| `[1]` | Operand 0 | Typically destination register or condition code. |
| `[2]` | Operand 1 | Primary source register, or sentinel `0xFF` for immediate, `0xFE` for label relocation. |
| `[3]` | Operand 2 | Secondary source register, sentinel `0xFF` for immediate payload. |
| `[4:7]` | Immediate / Displacement | 32-bit payload encoded in two's complement when used. Zero when unused. |

Sentinel values:
- `0xFF` — immediate operand; interpreter reads literal from `[4:7]`.
- `0xFE` — label reference; relocation resolver patches displacement/addresses later.
- `0x00` — unused slot.

## 4. Directive Emission Pattern
1. Parser identifies mnemonic tokens and resolves operands (register, literal,
   label).
2. `directive_emit` receives opcode + operand descriptors conforming to the
   table above.
3. Labels use `parser_record_label` / `parser_queue_ref` to populate relocation
   entries. The interpreter materializes the 16-byte instruction block during
   output generation.

## 5. Worked Examples

### 5.1 Hello World (Service Calls)
```
# CNL: "define function main begin print "OK" ; request service exit end"
header minimal_isa
org 0x0000
label main
bytes 0x0101FE0000000000  ; mov r1, #addr(ok_text)
bytes 0x0B01010000000000  ; svc 0x01 (write)
bytes 0x0B02000000000000  ; svc 0x02 (exit)
halt
label ok_text
ascii "OK\n"
pad 0x0010
```
- `mov` places the string address in `r1`; interpreter later resolves the relocation for `ok_text` into bytes `[5:12]`.
- `svc 0x01` prints using Stage 0 shim, reading pointer from `r1`.
- `svc 0x02` exits with status from `r0` (defaults to 0).

### 5.2 Arithmetic and Branch
```
label main
bytes 0x0101FF0000000000  ; mov r1, #0             ; accumulator
bytes 0x0102FF0000000004  ; mov r2, #4             ; loop count
label loop
bytes 0x0401010200000000  ; add r1, r1, r2         ; r1 += r2
bytes 0x050202FF00000001  ; sub r2, r2, #1         ; r2-- (immediate encoded in low word)
bytes 0x0602FF0000000000  ; cmp r2, #0             ; sets zero flag
bytes 0x0801FE0000000000  ; cjmp eq, exit          ; branch when zero
bytes 0x07FE000000000000  ; jmp loop               ; relative offset patched at emit
label exit
bytes 0x0100010000000000  ; mov r0, r1             ; move result to return register
bytes 0x0B02000000000000  ; svc 0x02               ; exit with r0
halt

- `sub` uses immediate `1` encoded into the low 32 bits with operand sentinel `0xFF`.
- `cjmp` predicate `eq` stored in operand slot `[1]`; relocation resolves the branch target.
- `jmp` encodes a label sentinel in operand slot `[1]`; relocation fills the displacement.

## 6. Implementation Roadmap

### Phase A — Specification Solidification
- ✅ Draft instruction list and operand formats (this document).
- ✅ Finalize encoding layout diagrams and include in
  `seed/interpreter/aurseed_linux.asmplan`.
- ✅ Update `specs/stage0_plan.md` deliverables to reference this document.

### Phase B — Interpreter Alignment
- ☐ Extend manifest helpers to emit 16-byte instruction records using directive
  metadata (minimal adjustments needed post helper implementation).
- ☐ Add interpreter execution loop capable of reading the new instruction
  blocks and dispatching to helper routines (currently prototypes exist for
  directive queue execution).

### Phase C — Toolchain Integration
- ☐ Teach the AST-to-`.aurs` lowering phase to target these opcodes for simple
  expressions (literals, function calls, returns).
- ☐ Define natural language templates mapping directly to ISA mnemonics for
  rapid bootstrapping (e.g., "跳转 到 标签" → `cjmp`).
- ☐ Create regression cases that start from CNL snippets and end in executable
  manifests verifying each opcode.

## 7. Validation Strategy
- **Unit Tests**: For each opcode, craft a standalone manifest snippet executed
  by the interpreter harness, verifying register and memory effects.
- **Integration Tests**: Build smoke programs (print, arithmetic, branch) from
  CNL → `.aur` → `.aurs` → binary, confirming end-to-end fidelity.
- **Golden Artifacts**: Record known-good manifest + binary pairs in
  `verification/minimal_isa/` for regression.

## 8. Open Questions
- Should immediates remain 64-bit, or can Stage 0 economize using encoded
  literal pools to save space?
- Do we need a dedicated stack-frame management instruction (`enter`/`leave`),
  or can bootstrap demos rely on manual `add/sub sp` sequences using existing
  opcodes?
- How soon should floating-point support join the minimal ISA versus deferring
  to Stage 1 expansion?

---

*Maintainers*: Stage 0 compiler team — coordinate changes with interpreter
owners before altering opcode semantics.
