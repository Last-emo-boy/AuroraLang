# Manual Compilation Walkthrough (Aurora Stage 0 / Legacy)

> ⚠️ 本文档描述的是 Stage 0 手工/legacy 管线，仅供历史参考。统一流水线的最新规划见 [`docs/pipeline_convergence.md`](pipeline_convergence.md)，实现位于 `pipeline/` 目录。

> Purpose: demonstrate the hand-authored pipeline from Aurora source (`.aur`) to minimal ISA manifest (`.aurs`) before the MVP compiler is complete.

## 1. Source Program (`examples/hello_world.aur`)
```aurora
module demo {
    fn main() -> int {
        let message: string = "OK\n";
        request service print(message);
        request service exit(0);
        return 0;
    }
}
```
- Uses Stage 0 grammar (`fn`, `let`, `request service`, `return`).
- Calls two interpreter services: `print` and `exit`.

## 2. Lowering Decisions
1. **String Literal** → allocate label `message` containing ASCII bytes.
2. **Service Calls** → translate to `svc` opcodes with immediates `0x01` (write) and `0x02` (exit).
3. **Return Value** → move `0` into `r0` before `svc 0x02` to signal success.
4. **Register Usage** → `r1` carries pointer to string for the write syscall.

## 3. Manifest (`examples/hello_world.aurs`)
```aurs
header minimal_isa
org 0x0000
label main
bytes 0x0101FE0000000000  ; mov r1, #addr(message)
bytes 0x0100FF0000000000  ; mov r0, #0
label message
ascii "OK\n"
pad 0x0010

label __aur_runtime_print_and_exit
bytes 0x0B01010000000000  ; svc 0x01 write(stdout)
bytes 0x0B02000000000000  ; svc 0x02 exit(r0)
halt
```
- Each `bytes` directive encodes a 16-byte instruction slot (see `specs/aurora_minimal_isa.md`).
- The relocation for `message` is resolved by the interpreter when emitting the final binary.

## 4. Execution (once interpreter is wired)
1. Feed manifest to interpreter: `aurseed run examples/hello_world.aurs`.
2. Expected stdout: `OK` followed by newline; exit code `0`.
3. Future enhancement: `aurc-native --emit-bin` will call the interpreter in batch mode to produce a self-contained ELF/PE binary (see `specs/aurc_native_rewrite_plan.md`).

## 6. Additional Fixture: Arithmetic Loop
- Source: `examples/loop_sum.aur` — increments an accumulator while decrementing a counter until zero, then exits with the sum.
- Manifest: `examples/loop_sum.aurs` — uses `add`, `sub`, `cmp`, `cjmp`, and `jmp` opcodes from the minimal ISA example (§5.2).
- Purpose: regression target for extending the compiler to arithmetic and control flow; currently hand-authored awaiting automated lowering.

## 5. Next Steps Toward Automation
- Implement lexer/parser per `specs/aurora_compiler_mvp_plan.md` to generate AST for the `.aur` program.
- Reproduce the manifest programmatically by emitting the same instruction slots.
- Extend regression suite to compare generated manifests against this manual reference.
- Runtime stubs are appended after the program data section (`__aur_runtime_print_and_exit`, `__aur_runtime_exit_with_r0`) so programs can fall through into shared helpers without repeating service boilerplate.
- Prototype compiler driver `tools/aurc_mvp.py` now automates this example; future work expands its parser to cover broader syntax.
