# Stage 0 Layout Reference

> Drafted 2025-10-09. This document enumerates the byte-level construction of the Stage 0 handcrafted binaries. No external assemblers, linkers, or script languages are used; all offsets are intended for manual authoring.

## Linux ELF64 (`seed/linux/aurora_seed_ok.bin`)

| Offset (hex) | Size | Description |
|--------------|------|-------------|
| `0x0000`     | 4    | ELF magic `7F 45 4C 46` |
| `0x0004`     | 1    | Class `02` (64-bit) |
| `0x0005`     | 1    | Data `01` (little-endian) |
| `0x0006`     | 1    | Version `01` |
| `0x0007`     | 1    | OS ABI `00` (System V) |
| `0x0008`     | 8    | ABI Version + padding (all `00`) |
| `0x0010`     | 2    | Type `0002` (ET_EXEC) |
| `0x0012`     | 2    | Machine `003E` (x86-64) |
| `0x0014`     | 4    | Version `00000001` |
| `0x0018`     | 8    | Entry point `0x400080` |
| `0x0020`     | 8    | Program header table offset `0x40` |
| `0x0028`     | 8    | Section header offset `0` (none) |
| `0x0030`     | 4    | Flags `0` |
| `0x0034`     | 2    | ELF header size `0x40` |
| `0x0036`     | 2    | Program header entry size `0x38` |
| `0x0038`     | 2    | Program header count `0x01` |
| `0x003A`     | 2    | Section header entry size `0` |
| `0x003C`     | 2    | Section header count `0` |
| `0x003E`     | 2    | Section header string index `0` |

### Program Header (offset `0x0040`)

| Offset | Size | Description |
|--------|------|-------------|
| `0x0040` | 4 | Type `00000001` (PT_LOAD) |
| `0x0044` | 4 | Flags `00000007` (R/W/X) |
| `0x0048` | 8 | Offset `0x0000000000000000` |
| `0x0050` | 8 | Virtual address `0x0000000000400000` |
| `0x0058` | 8 | Physical address (same as virtual) |
| `0x0060` | 8 | File size `0x0000000000000100` |
| `0x0068` | 8 | Mem size `0x0000000000000100` |
| `0x0070` | 8 | Alignment `0x0000000000002000` |

### Text & Data (offset `0x0080`)

```
0x0080: 48 B8 01 00 00 00 00 00 00 00    mov rax, 0x1
0x008A: 48 BF 01 00 00 00 00 00 00 00    mov rdi, 0x1
0x0094: 48 BE 90 00 40 00 00 00 00 00    mov rsi, 0x400090 ; message address
0x009E: 48 BA 03 00 00 00 00 00 00 00    mov rdx, 0x3
0x00A8: 0F 05                               syscall
0x00AA: 48 B8 3C 00 00 00 00 00 00 00    mov rax, 0x3C
0x00B4: 31 FF                               xor edi, edi
0x00B6: 0F 05                               syscall
0x00B8: 4F 4B 0A 00                         "OK\n\0"
```

- Entry at `0x400080` equals file offset `0x80` + load base `0x400000`.
- Message virtual address `0x400090` corresponds to file offset `0x90`.
- File size chosen as `0x100` to simplify alignment; trailing zero padding fills `0xB C0` range.

## Windows PE/COFF (`seed/windows/aurora_seed_ok.exe`)

| Offset (hex) | Size | Description |
|--------------|------|-------------|
| `0x0000`     | 2    | DOS magic `4D 5A` |
| `0x0002`     | 58   | DOS stub (placeholder; message `This program cannot be run...` is not required, zero-filled) |
| `0x003C`     | 4    | PE header pointer `0x80` |
| `0x0080`     | 4    | Signature `50 45 00 00` |
| `0x0084`     | 2    | Machine `0x8664` (AMD64) |
| `0x0086`     | 2    | Number of sections `0x0002` (`.text`, `.rdata`) |
| `0x0088`     | 4    | TimeDateStamp (manual value) |
| `0x008C`     | 4    | Pointer to symbol table `0` |
| `0x0090`     | 4    | Number of symbols `0` |
| `0x0094`     | 2    | Size of optional header `0x00F0` |
| `0x0096`     | 2    | Characteristics `0x2022` (EXECUTABLE | 64-BIT | RELOCS_STRIPPED) |

### Optional Header (offset `0x0098`)

- Magic `0x020B` (PE32+)
- Entry point RVA `0x1000`
- Base of code `0x1000`
- Image base `0x0000000140000000`
- Section alignment `0x1000`, file alignment `0x200`
- Size of image `0x3000`
- Size of headers `0x200`
- Subsystem `0x0003` (Console)
- DLL characteristics `0x8160`
- SizeOfStackReserve `0x0000000000100000`
- SizeOfStackCommit `0x1000`
- SizeOfHeapReserve `0x00100000`
- SizeOfHeapCommit `0x2000`
- Data directories:
  - Import table RVA `0x2000`, size `0x40`
  - IAT RVA `0x2010`, size `0x10`
  - Others zeroed

### Section Table (offset `0x0188`)

1. `.text`
   - VirtualSize `0x200`
   - VirtualAddress `0x1000`
   - SizeOfRawData `0x200`
   - PointerToRawData `0x200`
   - Characteristics `0x60000020` (CODE | EXECUTE | READ)

2. `.rdata`
   - VirtualSize `0x200`
   - VirtualAddress `0x2000`
   - SizeOfRawData `0x200`
   - PointerToRawData `0x400`
   - Characteristics `0x40000040` (INITIALIZED_DATA | READ)

### `.text` Contents (file offset `0x0200`)

```
0x0200: 65 48 8B 04 25 60 00 00 00    mov rax, [gs:0x60] ; PEB
0x0209: 48 8B 50 18                   mov rdx, [rax+0x18] ; ProcessParameters
0x020D: 48 8B 5A 20                   mov rbx, [rdx+0x20] ; StdOutputHandle
0x0211: 48 8D 0D EF 0F 00 00          lea rcx, [rip+0x0FEF] ; message RVA 0x2000
0x0218: 48 8D 15 F1 0F 00 00          lea rdx, [rip+0x0FF1] ; bytes written out param
0x021F: 41 B8 04 00 00 00             mov r8d, 0x4 ; length
0x0225: 33 C0                         xor eax, eax
0x0227: FF 15 C3 0D 00 00             call [rip+0x0DC3] ; import table: WriteFile
0x022D: 33 C9                         xor ecx, ecx
0x022F: FF 15 BB 0D 00 00             call [rip+0x0DBB] ; ExitProcess
0x0235: CC                            int3 (padding; never executed)
```

- RIP-relative displacements calculated against `0x0218 + 7 = 0x021F` etc. Values to be confirmed when bytes are finalized.
- Message and bookkeeping data stored in `.rdata` at RVA `0x2000` (file offset `0x0400`).

### `.rdata` Contents (file offset `0x0400`)

```
0x0400: 4F 4B 0D 0A 00                "OK\r\n\0"
0x0405: 00 00 00 00                   bytes-written placeholder (DWORD)
0x0409: ...                           import descriptors & thunk tables
```

- Import descriptor table includes `kernel32.dll` with functions `WriteFile` and `ExitProcess`.
- IAT located at RVA `0x2010`, filled with two 8-byte entries resolved at load time.

## Manual Generation Strategy

1. Populate the above headers and sections as hex arrays inside repository-controlled source files.
2. Validate computed RVA/offset relationships:
   - `entry = image_base + 0x1000`
   - Each section raw size padded to `0x200` boundary.
3. Ensure all unused bytes are zeroed to keep reproducibility consistent.
4. Update `specs/stage0_asm_notes.md` whenever instruction sequences change; this document mirrors the structural layout.

## Verification Checklist

- Confirm file sizes: ELF `0x100` bytes, PE `0x600` bytes (including headers and padding).
- Run `readelf -h` / `dumpbin /headers` **only for inspection**, not generation; note results in verification logs.
- Execute binaries to observe `OK` output and exit code `0` on their respective platforms.
- Record SHA-256 hashes with reproducible script once custom tooling exists.
