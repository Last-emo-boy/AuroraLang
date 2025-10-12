# Stage 0 Assembly Byte Plans

> Purpose: outline exact instruction sequences for the Stage 0 hex-seeded binaries without relying on external assemblers, templates, or borrowed language constructs.

## Linux x86-64 (ELF64) Instruction Plan

1. **Write `OK\n` to stdout**
   - Syscall number: `1` (`sys_write`).
   - Registers and values:
     - `RAX = 0x01` (syscall id)
     - `RDI = 0x01` (stdout fd)
     - `RSI = <address of message>`
     - `RDX = 0x03` (length)
   - Instruction bytes:
     - `mov rax, 0x1` → `48 B8 01 00 00 00 00 00 00 00`
     - `mov rdi, 0x1` → `48 BF 01 00 00 00 00 00 00 00`
     - `mov rsi, <msg_addr>` → placeholder for relocation patched manually.
     - `mov rdx, 0x3` → `48 BA 03 00 00 00 00 00 00 00`
     - `syscall` → `0F 05`

2. **Exit with status 0**
   - Syscall number: `60` (`sys_exit`).
   - Registers:
     - `RAX = 0x3C`
     - `RDI = 0x00`
   - Bytes:
     - `mov rax, 0x3C` → `48 B8 3C 00 00 00 00 00 00 00`
     - `xor edi, edi` → `31 FF`
     - `syscall` → `0F 05`

3. **Data Section**
   - Message bytes: `4F 4B 0A` (`"OK\n"`).
   - Align text/data as required by manual layout.

> Address placeholders (e.g., `<msg_addr>`) will be resolved by computing absolute addresses relative to the binary layout since no assembler is used. The byte stream will be documented in `seed/docs/stage0_layout.md` with explicit offsets.

## Windows x86-64 (PE/COFF) Instruction Plan

Constraints: avoid import tables by using direct system calls where feasible. Windows 10+ syscall numbers change, so we'll encode a minimal user-mode call using the `syscall` instruction through `ntdll` conventions. For stability, Stage 0 will:

1. **Write `OK\r\n` to stdout handle**
   - Acquire handle via `GetStdHandle(-11)` equivalent but without imports. Instead, Stage 0 will fall back to writing via `WriteFile` after grabbing the handle from the PEB.
   - Registers / stack setup:
     - Move PEB pointer from `GS:[0x60]` to reach process parameters and console handle.
     - Byte sequence (preliminary):
       - `mov rax, qword ptr [gs:0x60]` → `65 48 8B 04 25 60 00 00 00`
       - `mov rax, qword ptr [rax+0x20]` (ProcessParameters) → `48 8B 40 20`
       - `mov rbx, qword ptr [rax+0x20]` (StdOut handle) → `48 8B 58 20`
   - Prepare stack for `WriteFile` syscall via `syscall` using service number from `ntdll`. Because syscall ids vary, Stage 0 will encode a static stub that jumps into `ntdll!ZwWriteFile` using a small import table to `ntdll.dll`. This keeps compliance while retaining low-level control.
   - Stub sequence for calling imported function:
     - Push handle, buffer pointer, length onto stack.
     - Align stack to 16 bytes before `call`.
     - After call, check return value and fall through.

2. **Exit with status 0**
   - Call `ntdll!ZwTerminateProcess` or `kernel32!ExitProcess`. We'll prefer `ExitProcess` via import for stability.

3. **String literals**
   - Message: `"OK\r\n"` (`4F 4B 0D 0A`).

> Detailed byte layout with correct offsets, relocation entries, and import descriptors will be enumerated in the forthcoming Stage 0 layout documentation. This document serves as the instruction contract to ensure we stay at raw-machine level without third-party assemblers.

## Next Steps
- Compute exact immediate and displacement values for all instructions and encode them into the hex seed files.
- Verify stack alignment and calling convention requirements (SysV vs MS x64) manually.
- Update Stage 0 plan and iteration log to reference these sequences and constraints.
