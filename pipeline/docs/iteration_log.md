# Pipeline Iteration Log (Stage N1 and Beyond)

## 2025-11-27

### Iteration 11 - x86-64 原生代码生成 ✅

**目标**：将 Aurora 代码编译为可在 Linux 上运行的原生 x86-64 ELF64 可执行文件

**架构设计** ✅

```
Source (.aur) → Parser → IR → CodeGen → Manifest (.aurs)
                                             ↓
                                      Native Compiler
                                             ↓
                              x86-64 Encoder → ELF64 Generator
                                             ↓
                                    Executable (.elf)
```

**新增组件**

1. **`x86_encoder.js`** - x86-64 指令编码器 (380+ 行)
   - 寄存器映射：Aurora r0-r7 → x86-64 rax, rdi, rsi, rdx, rcx, r8, r9, r10
   - 支持的指令：
     - `movRegImm64` - 64位立即数加载
     - `movRegReg` - 寄存器间传送
     - `addRegReg/Imm32` - 加法
     - `subRegReg/Imm32` - 减法
     - `imulRegReg/Imm32` - 乘法
     - `cmpRegReg/Imm32` - 比较
     - `jmpRel32` - 无条件跳转
     - `jccRel32` - 条件跳转 (eq/ne/lt/le/gt/ge)
     - `callRel32` - 函数调用
     - `ret` - 函数返回
     - `syscall` - 系统调用
     - `andRegReg/Imm32`, `orRegReg/Imm32`, `xorRegReg/Imm32` - 位运算
     - `shlRegImm8`, `shrRegImm8` - 移位
   - 标签和重定位管理
   - 数据段字符串存储

2. **`elf64_generator.js`** - ELF64 可执行文件生成器
   - 内存布局：
     - 0x400000 - ELF 头基地址
     - 0x401000 - .text 段（代码）
     - 0x402000 - .data 段（数据）
   - 生成标准 ELF64 头
   - 生成程序头（PT_LOAD）
   - 设置正确的入口点和权限

3. **`native_compiler.js`** - Manifest 到原生编译器
   - 解析 .aurs manifest 文件
   - 从注释提取跳转目标标签
   - 从注释提取字符串标签引用
   - 将 Aurora ISA 指令映射到 x86-64
   - Linux 系统调用映射：
     - SVC 0x01 (print) → write(1, buf, len) [syscall 1]
     - SVC 0x02 (exit) → exit(code) [syscall 60]

**Pipeline Driver 扩展** ✅
新增 `native` 命令：
```bash
node pipeline_driver.js native <input.aur> -o <output.elf>
```
- 一键编译：Source → Manifest → ELF64
- 自动设置可执行权限

**Manifest 格式增强** ✅
在指令后添加注释，包含跳转目标和标签引用信息：
```
bytes 0x07FE000000000000  ; jmp fn_main ; entry point
bytes 0x0101FE0000000000  ; mov r1, @str_0 ; message
bytes 0x0804FE0000000000  ; cjmp (negated >), else_0
```

**编译结果** ✅
成功编译所有 11 个测试程序到原生 ELF64：

| 程序 | 大小 |
|-----|------|
| minimal_exit.elf | 8,192 bytes |
| hello_world.elf | 8,196 bytes |
| loop_sum.elf | 8,192 bytes |
| conditional.elf | 8,192 bytes |
| conditional_no_else.elf | 8,192 bytes |
| arithmetic_ops.elf | 8,192 bytes |
| complex_expr.elf | 8,192 bytes |
| bitwise_ops.elf | 8,192 bytes |
| function_call.elf | 8,192 bytes |
| nested_control.elf | 8,192 bytes |
| recursive_function.elf | 8,192 bytes |

**生成的机器码示例**
minimal_exit.aur (exit with code 42):
```x86-64
mov rdi, 42        ; 48 BF 2A 00 00 00 00 00 00 00
mov rax, rdi       ; 48 89 F8
mov rdi, rax       ; 48 89 C7
mov eax, 60        ; 48 C7 C0 3C 00 00 00
syscall            ; 0F 05
```

**ELF 头验证** ✅
```
7F 45 4C 46 02 01 01 00  ; ELF magic, 64-bit, little endian
02 00                     ; ET_EXEC (executable)
3E 00                     ; EM_X86_64
00 10 40 00               ; Entry point: 0x401000
```

**测试状态** ✅
所有现有测试继续通过（8/8）：
```
✅ hello_world (7 instructions)
✅ loop_sum (11 instructions)
✅ conditional (13 instructions)
✅ conditional_no_else (8 instructions)
✅ arithmetic_ops (11 instructions)
✅ complex_expr (15 instructions)
✅ bitwise_ops (22 instructions)
✅ function_call (14 instructions)
```

**文件清单**
- `pipeline/src/backend/x86_encoder.js` - x86-64 指令编码器 🆕
- `pipeline/src/backend/elf64_generator.js` - ELF64 生成器 🆕
- `pipeline/src/backend/native_compiler.js` - Manifest 到原生编译器 🆕
- `pipeline/src/pipeline_driver.js` - 添加 `native` 命令
- `pipeline/src/codegen.js` - Manifest 输出带注释
- `pipeline/examples/minimal_exit.aur` - 最小退出测试 🆕
- `pipeline/build/*.elf` - 生成的 ELF64 可执行文件

**运行说明**
生成的 ELF64 文件可以在 Linux 或 WSL 上运行：
```bash
# 在 Linux/WSL 上
./build/minimal_exit.elf
echo $?  # 输出: 42

./build/hello_world.elf
# 输出: OK
```

**已知限制**
1. 仅支持 Linux x86-64 目标
2. 字符串打印需要 print syscall (SVC 0x01)
3. DIV/REM 指令生成 NOP 占位符（x86-64 除法复杂）
4. 最多支持 8 个虚拟寄存器

**下一步计划**
1. **实现 DIV/REM**：使用 x86-64 的 IDIV 指令
2. **Windows PE 格式**：支持 Windows 可执行文件
3. **调试信息**：生成 DWARF 调试符号
4. **优化**：寄存器分配优化、常量折叠
5. **Stage N2**：用 Aurora 重写编译器前端

---

### Iteration 10 - 函数定义与调用 ✅

**目标**：实现函数定义、参数传递、函数调用和返回值处理

**ISA 指令** ✅
已有 CALL/RET 指令支持：
- `CALL (0x09)` - 函数调用，跳转到函数标签
- `RET (0x0A)` - 函数返回，跳回调用点

**IR 扩展** ✅
- `createFunctionDecl(name, params, returnType, body, localDecls)` - 函数声明节点
- `createCallExpr(functionName, args, returnType)` - 函数调用表达式

**Parser 支持** ✅
- 解析 `fn name(params) -> type { body }` 语法
- 参数列表：`param_name: type, ...`
- 函数内局部变量收集到 `localDecls`
- 函数调用表达式 `func(args...)` 在 `parseFactor` 中解析

**CodeGen 实现** ✅
1. **`generateModuleProgram`** - 模块程序生成
   - 注册所有函数标签
   - 生成 `JMP fn_main` 入口跳转
   - 依次生成所有函数代码

2. **`generateFunction`** - 函数代码生成
   - 发射函数标签
   - 分配参数寄存器（r1-r5 调用约定）
   - 分配局部变量寄存器
   - 生成局部变量初始化
   - 生成函数体语句

3. **`generateDeclaration`** 扩展
   - 支持 `literal` 类型初始化
   - 支持 `binary` 表达式初始化（如 `let result = a + b`）
   - 支持 `call` 表达式初始化（如 `let sum = add(x, y)`）
   - 支持 `variable` 引用初始化

4. **`generateCallExpr`** - 函数调用生成
   - 将参数移动到 r1-r5
   - 发射 CALL 指令
   - 返回值在 r0

5. **`generateReturn`** - 返回语句
   - 将返回值移动到 r0
   - 非 main 函数发射 RET 指令

**调用约定** ✅
- 参数：r1, r2, r3, r4, r5（最多 5 个参数）
- 返回值：r0
- 调用者保存寄存器（简化版）

**测试用例** ✅
创建 `function_call.aur` (14 instructions)：
```aurora
module math {
    fn add(a: int, b: int) -> int {
        let result: int = a + b;
        return result;
    }
    
    fn main() -> int {
        let x: int = 3;
        let y: int = 5;
        let sum: int = add(x, y);
        request service print(sum);
        request service exit(0);
        return 0;
    }
}
```

**测试结果** ✅
```
🧪 Aurora Pipeline Test Suite

▶ Running test: hello_world        ✅ PASS (7 instructions)
▶ Running test: loop_sum           ✅ PASS (11 instructions)
▶ Running test: conditional        ✅ PASS (13 instructions)
▶ Running test: conditional_no_else ✅ PASS (8 instructions)
▶ Running test: arithmetic_ops     ✅ PASS (11 instructions)
▶ Running test: complex_expr       ✅ PASS (15 instructions)
▶ Running test: bitwise_ops        ✅ PASS (22 instructions)
▶ Running test: function_call      ✅ PASS (14 instructions)

📊 Total: 8 | Passed: 8 ✅ | Failed: 0 ❌
🎉 All tests passed!
```

**文件变更**
- `pipeline/src/ir.js` - 添加 createFunctionDecl
- `pipeline/src/parser_v2.js` - 函数解析和调用表达式
- `pipeline/src/codegen.js` - CALL/RET 编码和函数代码生成
- `pipeline/src/test_runner.js` - 添加 function_call 测试
- `pipeline/examples/function_call.aur` - 函数调用测试
- `pipeline/examples/function_call_expected.aurs` - 预期输出
- `pipeline/examples/*_expected.aurs` - 更新所有 expected 文件以匹配新格式

**下一步计划**
1. **递归函数测试**：验证递归调用是否正常工作
2. **寄存器溢出策略**：实现 spilling（当前限制 5 个变量）
3. **数组支持**：基础数组操作
4. **Stage N2 准备**：Aurora 自举

---

## 2025-11-26

### Iteration 9 - 位运算支持 ✅

**目标**：实现完整的位运算支持（AND/OR/XOR/SHL/SHR）

**ISA 扩展** ✅
新增位运算指令（从 0x10 开始）：
- `AND (0x10)` - 按位与
- `OR (0x11)` - 按位或
- `XOR (0x12)` - 按位异或
- `NOT (0x13)` - 按位取反（保留，未实现）
- `SHL (0x14)` - 左移
- `SHR (0x15)` - 右移

**Lexer 扩展** ✅
新增 token 类型：
- `AMPERSAND` - `&` 按位与
- `PIPE` - `|` 按位或
- `CARET` - `^` 按位异或
- `TILDE` - `~` 按位取反
- `SHL` - `<<` 左移
- `SHR` - `>>` 右移

**Parser 扩展** ✅
更新表达式优先级（从低到高）：
1. `comparison` - 比较运算符
2. `bitwise_or` - `|` 按位或
3. `bitwise_xor` - `^` 按位异或
4. `bitwise_and` - `&` 按位与
5. `shift` - `<<` `>>` 移位
6. `additive` - `+` `-` 加减
7. `term` - `*` `/` `%` 乘除模
8. `factor` - 字面量、变量、函数调用

**CodeGen 扩展** ✅
新增编码函数：
- `encodeAndRegReg` / `encodeAndRegImm`
- `encodeOrRegReg` / `encodeOrRegImm`
- `encodeXorRegReg` / `encodeXorRegImm`
- `encodeShlRegReg` / `encodeShlRegImm`
- `encodeShrRegReg` / `encodeShrRegImm`
- `encodeNotReg`

更新 `generateBinaryInto` 和 `generateBinary` 支持所有位运算符。

**测试用例** ✅
创建 `bitwise_ops.aur` (22 instructions)：
```aurora
let a: int = 12;       // 0b1100
let b: int = 10;       // 0b1010
let result: int = 0;

// AND: 12 & 10 = 8 (0b1000)
result = a & b;

// OR: 12 | 10 = 14 (0b1110)
result = a | b;

// XOR: 12 ^ 10 = 6 (0b0110)
result = a ^ b;

// Left shift: 3 << 2 = 12
result = 3 << 2;

// Right shift: 16 >> 2 = 4
result = 16 >> 2;
```

**测试结果** ✅
```
🧪 Aurora Pipeline Test Suite

▶ Running test: hello_world        ✅ PASS (4 instructions)
▶ Running test: loop_sum           ✅ PASS (9 instructions)
▶ Running test: conditional        ✅ PASS (11 instructions)
▶ Running test: conditional_no_else ✅ PASS (6 instructions)
▶ Running test: arithmetic_ops     ✅ PASS (9 instructions)
▶ Running test: complex_expr       ✅ PASS (13 instructions)
▶ Running test: bitwise_ops        ✅ PASS (22 instructions)

📊 Total: 7 | Passed: 7 ✅ | Failed: 0 ❌
🎉 All tests passed!
```

**支持的运算符更新**

| 类别 | 运算符 | 模式 | 状态 |
|-----|-------|-----|-----|
| 算术 | `+` `-` `*` `/` `%` | reg-reg, reg-imm | ✅ |
| 比较 | `>` `<` `>=` `<=` `==` `!=` | reg-reg, reg-imm | ✅ |
| 位运算 | `&` | reg-reg, reg-imm | ✅ |
| 位运算 | `\|` | reg-reg, reg-imm | ✅ |
| 位运算 | `^` | reg-reg, reg-imm | ✅ |
| 位运算 | `<<` | reg-reg, reg-imm | ✅ |
| 位运算 | `>>` | reg-reg, reg-imm | ✅ |
| 位运算 | `~` (NOT) | reg | 保留 |

**文件变更**
- `pipeline/src/codegen.js` - 添加位运算指令编码
- `pipeline/src/lexer.js` - 添加位运算 token 类型
- `pipeline/src/parser_v2.js` - 添加位运算表达式优先级
- `pipeline/src/test_runner.js` - 添加 bitwise_ops 测试
- `pipeline/examples/bitwise_ops.aur` - 位运算测试用例
- `pipeline/examples/bitwise_ops_expected.aurs` - 预期输出

**下一步计划**
1. **函数定义与调用**：实现 CALL/RET 指令
2. **寄存器溢出策略**：实现 spilling（当前限制 5 个变量）
3. **一元运算符**：实现 NOT (~)、负号 (-)
4. **Stage N2 准备**：Aurora 自举

---

### Iteration 8 - 扩展运算符支持 ✅

**目标**：添加完整的算术运算符支持（乘法、除法、取模）和所有比较运算符

**新增指令编码** ✅
根据 ISA 规范添加以下指令：
- `MUL (0x0D)` - 乘法运算
- `DIV (0x0E)` - 除法运算（截断）
- `REM (0x0F)` - 取模运算

**新增编码函数**：
- `encodeMulRegReg` / `encodeMulRegImm` - 乘法（寄存器/立即数）
- `encodeDivRegReg` / `encodeDivRegImm` - 除法（寄存器/立即数）
- `encodeRemRegReg` / `encodeRemRegImm` - 取模（寄存器/立即数）
- `encodeSubRegReg` - 减法寄存器-寄存器
- `encodeAddRegImm` - 加法立即数

**代码生成器扩展** ✅
1. **`generateBinaryInto`** 重构：
   - 支持 `+`, `-`, `*`, `/`, `%` 所有算术运算符
   - 支持左操作数为字面量（自动分配临时寄存器）
   - 正确处理寄存器-寄存器和寄存器-立即数两种模式

2. **`generateBinary`** 重构：
   - 统一处理算术和比较运算符
   - 支持 `>`, `<`, `>=`, `<=`, `==`, `!=` 所有比较运算符
   - 正确管理临时寄存器生命周期

3. **`generateIf`** 扩展：
   - 新增 `>=` 和 `<=` 比较运算符支持
   - 正确生成取反的条件跳转指令

**新增测试用例** ✅
1. **`arithmetic_ops.aur`** (9 instructions)
   - 测试乘法、除法、取模运算
   - 测试加法立即数
   - 验证：6 * 4 / 4 % 4 + 8 = 10

2. **`complex_expr.aur`** (13 instructions)
   - 测试减法寄存器-寄存器
   - 测试乘法立即数
   - 测试 `>=` 和 `<=` 比较运算符
   - 验证：((10 - 3) * 2) + 1 - 1 = 14

**测试结果** ✅
```
🧪 Aurora Pipeline Test Suite

▶ Running test: hello_world        ✅ PASS (4 instructions)
▶ Running test: loop_sum           ✅ PASS (9 instructions)
▶ Running test: conditional        ✅ PASS (11 instructions)
▶ Running test: conditional_no_else ✅ PASS (6 instructions)
▶ Running test: arithmetic_ops     ✅ PASS (9 instructions)
▶ Running test: complex_expr       ✅ PASS (13 instructions)

📊 Total: 6 | Passed: 6 ✅ | Failed: 0 ❌
🎉 All tests passed!
```

**支持的运算符总结**

| 类别 | 运算符 | 模式 | 状态 |
|-----|-------|-----|-----|
| 算术 | `+` | reg-reg, reg-imm | ✅ |
| 算术 | `-` | reg-reg, reg-imm | ✅ |
| 算术 | `*` | reg-reg, reg-imm | ✅ |
| 算术 | `/` | reg-reg, reg-imm | ✅ |
| 算术 | `%` | reg-reg, reg-imm | ✅ |
| 比较 | `>` | reg-reg, reg-imm | ✅ |
| 比较 | `<` | reg-reg, reg-imm | ✅ |
| 比较 | `>=` | reg-reg, reg-imm | ✅ |
| 比较 | `<=` | reg-reg, reg-imm | ✅ |
| 比较 | `==` | reg-reg, reg-imm | ✅ |
| 比较 | `!=` | reg-reg, reg-imm | ✅ |

**文件变更**
- `pipeline/src/codegen.js` - 添加 MUL/DIV/REM 指令编码和生成逻辑
- `pipeline/src/test_runner.js` - 添加新测试用例
- `pipeline/examples/arithmetic_ops.aur` - 算术运算测试
- `pipeline/examples/arithmetic_ops_expected.aurs` - 预期输出
- `pipeline/examples/complex_expr.aur` - 复杂表达式测试
- `pipeline/examples/complex_expr_expected.aurs` - 预期输出

**下一步计划**
1. **函数定义与调用**：实现 CALL/RET 指令
2. **寄存器溢出策略**：实现 spilling（当前限制 5 个变量）
3. **位运算支持**：AND/OR/XOR/NOT/SHL/SHR
4. **Stage N2 准备**：Aurora 自举

---

### Iteration 7 - 递归下降 Parser 重构 ✅

**背景**：Iteration 6 中发现正则表达式解析器无法处理嵌套结构，if/else 解析遗留bug导致函数调用实现被暂停。

**修复的紧急问题** ✅
1. **`parseIfStatements` 未定义错误**：
   - 问题：parser.js 调用了 `parseIfStatements` 函数但未实现
   - 解决方案：实现完整的 if/else 解析，使用智能大括号匹配替代 `[^}]*` 正则
   - 新增 `findMatchingBrace()` 函数处理嵌套大括号
   - 验证：所有 4 个测试用例通过 ✅

2. **if block 内算术赋值解析错误**：
   - 问题：`conditional_no_else` 测试中 `counter = counter - 2;` 未被正确解析
   - 原因：简单赋值正则和算术赋值正则冲突
   - 解决方案：重构 `parseBlockBody()` 优先处理算术赋值，避免重复匹配
   - 验证：6 条指令生成正确 ✅

**Parser 重构** ✅
创建全新的递归下降 Parser 架构：

1. **`lexer.js`** - 词法分析器 (新建)
   - 完整的 token 类型定义（关键字、运算符、分隔符）
   - 支持单行/块注释跳过
   - 字符串字面量转义处理 (`\n`, `\t`, `\\`, `\"`)
   - 多字符运算符识别 (`->`, `==`, `!=`, `<=`, `>=`)
   - 位置追踪（行号、列号）用于错误报告

2. **`parser_v2.js`** - 递归下降解析器 (新建)
   - 完整的语法规则实现：
     - `program` → `module_decl` | `flat_program`
     - `fn_decl` → `'fn' IDENTIFIER '(' params? ')' '->' type '{' stmt* '}'`
     - `stmt` → `let_stmt` | `assign_stmt` | `if_stmt` | `while_stmt` | `request_stmt` | `return_stmt`
     - `expr` → 优先级正确的表达式解析（comparison > additive > term > factor）
   - 支持嵌套控制流（while 内 if，if 内 while）
   - 函数参数解析（为函数调用做准备）
   - 函数调用表达式解析 (`IDENTIFIER '(' args? ')'`)

3. **`ir.js`** - IR 扩展
   - 新增 `createCallExpr(functionName, args, returnType)` 函数调用表达式

4. **`pipeline_driver.js`** - 自动切换
   - 优先使用 parser_v2，fallback 到 legacy parser

**测试结果** ✅
```
🧪 Aurora Pipeline Test Suite

▶ Running test: hello_world    ✅ PASS (4 instructions)
▶ Running test: loop_sum       ✅ PASS (9 instructions)
▶ Running test: conditional    ✅ PASS (11 instructions)
▶ Running test: conditional_no_else ✅ PASS (6 instructions)

📊 Total: 4 | Passed: 4 ✅ | Failed: 0 ❌
🎉 All tests passed!
```

**嵌套结构验证** ✅
创建 `nested_control.aur` 测试用例：
```aurora
module demo {
    fn main() -> int {
        let i: int = 3;
        let sum: int = 0;
        
        while i > 0 {
            if i > 1 {
                sum = sum + i;  // 仅当 i > 1 时累加
            }
            i = i - 1;
        }
        
        request service exit(sum);  // 预期 sum = 3 + 2 = 5
        return sum;
    }
}
```

IR 正确解析了嵌套的 while + if 结构：
- while 的 body 包含 if 语句
- if 的 thenBranch 包含赋值语句
- 生成 11 条指令

**架构优势**
- ✅ 正确处理任意深度的嵌套结构
- ✅ 清晰的语法错误报告（行号:列号）
- ✅ 可扩展的表达式优先级系统
- ✅ 为函数定义与调用做好准备
- ✅ 向后兼容（所有现有测试通过）

**文件清单**
- `pipeline/src/lexer.js` (260行) - 词法分析器 🆕
- `pipeline/src/parser_v2.js` (340行) - 递归下降解析器 🆕
- `pipeline/src/parser.js` (更新) - 修复 if/else 解析 bug
- `pipeline/src/ir.js` (更新) - 添加 createCallExpr
- `pipeline/src/pipeline_driver.js` (更新) - 自动选择 parser
- `pipeline/examples/nested_control.aur` (新) - 嵌套结构测试

**下一步计划**
1. **函数定义与调用**：在新 parser 基础上实现 CALL/RET 指令
2. **添加更多测试用例**：函数调用、递归、多函数模块
3. **寄存器溢出策略**：实现 spilling（栈保存/恢复）
4. **Stage N2 准备**：设计 Aurora 语言编译器核心 API

---

## 2025-10-15 (续)

### Iteration 6 - 函数定义与调用（暂停） ⏸️

**目标**：添加完整的条件分支语法和代码生成

**Parser 扩展** ✅
- 新增 `parseIfStatement` 解析 `if <var> <op> <value> { ... } else { ... }` 结构
- 支持的比较运算符：`>`, `<`, `==`, `!=`
- 新增 `parseBlockBody` 通用代码块解析器，处理简单赋值和算术赋值
- 正则表达式匹配 if/else 语法模式（含可选的 else 分支）

**IR 结构** ✅
- 已存在的 `createIfStmt(condition, thenBranch, elseBranch)` 被启用
- condition 为 binary 表达式（支持 >, <, ==, != 运算符）
- thenBranch 和 elseBranch 均为 block 节点

**CodeGen 实现** ✅
- 重写 `generateIf` 函数：
  1. 生成条件比较指令（CMP reg, imm 或 CMP reg, reg）
  2. 根据比较运算符选择**取反**的跳转条件：
     - `x > 3` → 如果 `x <= 3`（leq）则跳转
     - `x < 5` → 如果 `x >= 5`（geq）则跳转
     - `x == 0` → 如果 `x != 0`（neq）则跳转
     - `x != 0` → 如果 `x == 0`（eq）则跳转
  3. 生成 then 分支代码
  4. 插入 JMP 跳过 else 分支
  5. 生成 else 分支代码（如果存在）
  6. 生成 endif 标签
- 新增条件跳转编码函数：
  - `encodeCjmpEq`, `encodeCjmpNeq`, `encodeCjmpLt`, `encodeCjmpLeq`, `encodeCjmpGt`, `encodeCjmpGeq`
  - CJMP 指令格式：`opcode=0x08, condition_code, label, unused`
- 新增 `encodeCmpRegReg` 支持寄存器间比较

**寄存器管理优化** ✅
- 修复临时寄存器泄漏：在 `generateIf` 中正确调用 `releaseTemp()`
- 避免不必要的 `generateExpression` 调用，直接使用变量寄存器
- 条件比较后立即释放临时寄存器

**测试用例** ✅
1. **conditional.aur** - 完整 if/else 分支：
   ```aurora
   let x: int = 5;
   let result: int = 0;
   if x > 3 {
       result = 10;
   } else {
       result = 20;
   }
   ```
   - 生成 11 条指令
   - 预期行为：x=5 > 3 为真，执行 then 分支，result=10
   - 验证：✅ PASS（exact match）

2. **conditional_no_else.aur** - 无 else 的条件：
   ```aurora
   let counter: int = 7;
   if counter > 5 {
       counter = counter - 2;
   }
   ```
   - 生成 6 条指令
   - 预期行为：counter=7 > 5 为真，执行 counter-=2，result=5
   - 验证：✅ PASS（exact match）

**指令分析示例** ✅

conditional.aur 生成的指令：
```
01 01 FF 00 00000005  // mov r1, #5        ; x = 5
01 02 FF 00 00000000  // mov r2, #0        ; result = 0
06 01 FF 00 00000003  // cmp r1, #3        ; x > 3 ?
08 04 FE 00 00000000  // cjmp leq, else_0  ; if x <= 3, jump to else
01 06 FF 00 0000000A  // mov r6, #10       ; temp = 10
01 02 06 00 00000000  // mov r2, r6        ; result = 10
07 FE 00 00 00000000  // jmp endif_1       ; skip else
01 07 FF 00 00000014  // mov r7, #20       ; temp = 20 (label else_0)
01 02 07 00 00000000  // mov r2, r7        ; result = 20
01 00 02 00 00000000  // mov r0, r2        ; prepare exit (label endif_1)
0B 02 00 00 00000000  // svc 0x02          ; exit(result)
```

**测试结果** ✅
```
🧪 Aurora Pipeline Test Suite

▶ Running test: hello_world
  ✅ PASS (4 instructions)

▶ Running test: loop_sum
  ✅ PASS (9 instructions)

▶ Running test: conditional
  ✅ PASS (11 instructions)

▶ Running test: conditional_no_else
  ✅ PASS (6 instructions)

📊 Test Summary:
   Total:  4
   Passed: 4 ✅
   Failed: 0 ❌

🎉 All tests passed!
```

**文档更新** ✅
- 更新 README.md 添加条件分支语法示例和指令说明
- 更新测试覆盖表（4 个测试用例）
- 更新已知限制（移除 "无 if/else" 限制）
- 更新开发路线图（标记条件分支为已完成）

**成果总结** ✅
- ✅ 完整的 if/else 语法支持
- ✅ 4 种比较运算符（>, <, ==, !=）
- ✅ 可选 else 分支
- ✅ 正确的跳转逻辑（条件取反）
- ✅ 临时寄存器管理优化
- ✅ 100% 测试通过率（4/4）
- ✅ 字节完美匹配 expected 输出

**下一步优先级**
1. **函数定义与调用**：支持 `fn name(params)` + CALL/RET 指令（**进行中**）
2. **修复 if/else 解析bug**：当前正则无法处理多行代码块
3. **嵌套条件/循环**：支持 if 内嵌套 while，while 内嵌套 if
4. **数组支持**：基础数组操作（声明、索引、赋值）
5. **寄存器溢出策略**：实现 spilling（栈保存/恢复）
6. **Stage N2 准备**：Aurora 语言自举路线图设计

---

## 2025-10-15 (续)

### Iteration 6 - 函数定义与调用（暂停） ⏸️

**目标**：实现函数定义、参数传递、函数调用和返回值处理

**当前状态**：暂停 - 发现前置问题需要修复

**已完成的工作** ✅
1. **IR 扩展**：
   - 添加 `createFunctionDecl(name, params, returnType, body)` - 函数声明
   - 添加 `createCallExpr(functionName, args, returnType)` - 函数调用表达式
   - 更新 module exports 导出新构造函数

2. **测试用例创建**：
   - `function_call.aur` - 简单函数调用（add 函数）
   - `recursive_function.aur` - 递归函数（factorial）

**发现的问题** ⚠️
1. **Parser 复杂度**：
   - 需要重写 `parseModuleProgram` 以支持多函数定义
   - 需要区分程序级变量和函数局部变量
   - 函数调用可以出现在多个上下文（let 初始化、赋值右侧）
   
2. **向后兼容性**：
   - 修改 parser 签名破坏了现有的 conditional 测试
   - git checkout 恢复后条件测试仍然失败
   
3. **已知 Bug**：
   - **if/else 解析问题**：当前正则表达式 `/if...{([^}]*)\}/` 使用 `[^}]*` 匹配代码块
   - 该模式无法处理包含多行语句的代码块
   - 导致 conditional 测试用例的 if 语句被完全跳过
   - IR 中缺少 if 节点，只生成了变量声明和 exit 调用

**需要的前置修复** 🔧
1. **修复 if/else 正则表达式**：
   - 当前：`/if\s+([A-Za-z_][A-Za-z0-9_]*)\s*([><=!]+)\s*(\d+)\s*\{([^}]*)\}(?:\s*else\s*\{([^}]*)\})?/g`
   - 问题：`[^}]*` 在遇到换行时停止匹配
   - 解决方案：需要更智能的大括号匹配或使用递归下降解析器

2. **Parser 架构重构**：
   - 当前的正则表达式方法已经达到极限
   - 考虑实现简单的递归下降 parser
   - 需要 tokenizer 来正确处理嵌套结构


**决策**：
- ❌ 不继续实现函数调用（会进一步复杂化 parser）
- ✅ 先修复 if/else 解析bug，恢复测试通过
- ✅ 然后考虑 parser 重构为递归下降
- ✅ 函数调用推迟到 parser 重构后

**教训**：
1. 正则表达式不适合解析嵌套结构
2. 需要在破坏性改动前创建完整的测试覆盖
3. 增量式开发 - 先让简单情况工作，再扩展复杂情况

**下一步行动**：
- **优先级 1**：修复 if/else 解析 bug（使用更好的大括号匹配）
- **优先级 2**：恢复所有测试通过（4/4）
- **优先级 3**：设计递归下降 parser 架构
- **优先级 4**：实现新 parser 并迁移现有语法
- **优先级 5**：在新 parser 基础上实现函数调用

---

## 2025-01-XX

### Iteration 13 - 新语法功能扩展 ✅

**目标**：扩展 Aurora 语言语法，增加控制流和运算符支持

**新增语法功能** ✅

#### 1. For 循环语法
```aurora
// 基本范围循环
for i in 0..5 {
    sum = sum + i;
}

// 带 step 的循环
for i in 0..10 step 2 {
    // 每次递增 2
}
```

#### 2. Break 和 Continue 语句
```aurora
for i in 0..10 {
    if i == 5 {
        break;      // 跳出循环
    }
    if i == 3 {
        continue;   // 跳到下一次迭代
    }
}
```

#### 3. 逻辑运算符
- `&&` - 逻辑与（支持短路求值）
- `||` - 逻辑或（支持短路求值）
- `!` - 逻辑非

#### 4. 一元运算符
- `-` - 取负（例如：`-x`）
- `~` - 按位取反

#### 5. 布尔字面量
- `true` - 真值（编译为 1）
- `false` - 假值（编译为 0）

**Lexer 更新** ✅
- 新增 Token 类型：
  - `FOR`, `IN`, `BREAK`, `CONTINUE`, `STEP` - 控制流关键字
  - `TRUE`, `FALSE` - 布尔字面量
  - `AND` (`&&`), `OR` (`||`), `NOT` (`!`) - 逻辑运算符
  - `DOTDOT` (`..`) - 范围运算符

**Parser_v2 更新** ✅
- 新增解析函数：
  - `parseForStatementInFunction()` - for 循环解析
  - `parseBreakStatement()`, `parseContinueStatement()` - 控制流语句
  - `parseLogicalOr()`, `parseLogicalAnd()` - 逻辑表达式解析
  - `parseUnary()` - 一元运算符解析
  - `parsePrimary()` - 基础表达式（含 true/false）
- 表达式优先级调整：
  ```
  ||（最低）→ && → 比较 → 位运算 → 算术 → 一元（最高）
  ```

**CodeGen 更新** ✅
- 新增代码生成函数：
  - `generateFor()` - for 循环控制流
  - `generateBreak()`, `generateContinue()` - 跳转生成
  - `generateUnary()` - 一元运算符处理
- 循环上下文管理：
  - `loopStack` 用于追踪嵌套循环
  - `pushLoop()`, `popLoop()`, `currentLoop()` 管理 break/continue 目标
- 逻辑运算符短路求值：
  - `&&` - 左侧为假时跳过右侧
  - `||` - 左侧为真时跳过右侧

**Bug 修复** ✅
- **HALT 指令退出码**：修复 HALT 始终使用 0 作为退出码的问题
  - 现在正确使用 r0 寄存器的值作为进程退出码
- **main 函数返回**：在 main 函数的 return 语句后自动生成 HALT

**测试验证** ✅

| 测试文件 | 预期结果 | 实际结果 | 状态 |
|---------|----------|----------|------|
| for_loop.aur | 10 (0+1+2+3+4) | 10 | ✅ |
| for_step.aur | 6 (0+2+4) | 6 | ✅ |
| for_break.aur | 3 (0+1+2) | 3 | ✅ |
| for_continue.aur | 4 (1+3) | 4 | ✅ |
| logical_ops.aur | 15 | 15 | ✅ |
| unary_test.aur | 2 (5 + (-3)) | 2 | ✅ |
| hello_world.aur | "Hello, World!" | ✓ | ✅ |
| loop_sum.aur | 10 | 10 | ✅ |
| conditional.aur | 10 | 10 | ✅ |

**文件变更**
- `pipeline/src/lexer.js` - 新增 token 类型和关键字
- `pipeline/src/parser_v2.js` - 新增解析器功能
- `pipeline/src/ir.js` - 新增 IR 节点类型（ForStmt, BreakStmt, ContinueStmt, UnaryExpr）
- `pipeline/src/codegen.js` - 新增代码生成逻辑
- `pipeline/src/backend/native_compiler_win.js` - 修复 HALT 退出码

**已知限制**
1. 寄存器数量有限（r0-r7），复杂表达式可能触发 "Register spilling not yet implemented" 错误
2. for 循环的 step 只支持整数字面量
3. 逻辑运算符暂时不支持作为 if 条件（需要手动使用嵌套 if）

**下一步计划**
1. **寄存器溢出（Spilling）**：当寄存器不足时自动保存到栈 ✅ 已完成
2. **数组支持**：声明、索引访问、赋值
3. **函数参数**：支持带参数的函数调用
4. **字符串操作**：连接、长度、切片

---

### Iteration 14 - 寄存器溢出 (Register Spilling) ✅

**目标**：实现寄存器溢出机制，支持任意数量的变量

**背景问题**
- Aurora 使用 8 个虚拟寄存器 (r0-r7)
- r0 保留用于返回值，r6-r7 用于临时计算
- 只有 r1-r5 (5个) 可用于变量
- 当变量超过 5 个时，之前会抛出错误

**解决方案**

#### 1. ISA 扩展
新增两个栈操作指令：

| 操作码 | 名称 | 格式 | 描述 |
|--------|------|------|------|
| 0x16 | STORE_STACK | `store rX -> [RSP+offset]` | 将寄存器值保存到栈槽 |
| 0x17 | LOAD_STACK | `load rX <- [RSP+offset]` | 从栈槽恢复寄存器值 |

#### 2. 栈帧布局 (Win64)
```
RSP+0x00 ~ +0x1F : Shadow space (32 bytes, Win64 ABI)
RSP+0x20 ~ +0x27 : Spill slot 0
RSP+0x28 ~ +0x2F : Spill slot 1
RSP+0x30 ~ +0x37 : Spill slot 2
...
```

#### 3. 寄存器分配器重写 (`register_allocator.js`)

**核心数据结构**：
- `regToVar[]` - 寄存器到变量的映射
- `varToReg{}` - 变量到寄存器的映射
- `varsOnStack{}` - 已溢出变量的栈槽映射
- `varToStackSlot{}` - 变量到栈槽的持久映射
- `initializedVars` - 已初始化变量集合（只溢出有值的变量）
- `lruOrder[]` - LRU 队列，记录寄存器使用顺序

**关键算法**：
```javascript
allocateVariable(varName):
  1. 如果变量已在寄存器中，返回该寄存器
  2. 如果有空闲寄存器，分配它
  3. 否则，找到 LRU 的已初始化变量，将其溢出到栈
  4. 分配被释放的寄存器

getVariable(varName):
  1. 如果变量在寄存器中，返回它
  2. 如果变量在栈上，从栈重新加载到新寄存器
  3. 否则抛出错误

markInitialized(varName):
  记录变量已被赋值（只有已初始化的变量需要溢出）
```

#### 4. 代码生成改进 (`codegen.js`)

**表达式生成优化**：
- `generateBinaryInto(expr, destReg)` - 递归处理嵌套二元表达式
- 直接将结果写入目标寄存器，减少临时寄存器使用
- 左操作数链式优化，最小化寄存器压力

**声明语句修复**：
```javascript
generateDeclaration():
  1. 先计算表达式值到临时寄存器
  2. 再分配目标变量的寄存器
  3. 最后移动值到目标
  // 避免在计算过程中目标变量被驱逐
```

#### 5. x64 编码器更新 (`x86_encoder_win64.js`)

**新增方法**：
- `movStackReg(offset, srcAurora)` - MOV [RSP+offset], reg
- `movRegStack(destAurora, offset)` - MOV reg, [RSP+offset]

使用 SIB 字节编码 RSP 基址寻址：
```x86
; MOV [RSP+0x20], R11
4C 89 5C 24 20  ; REX.WR, 89 (MOV r/m64,r64), ModRM(01,011,100), SIB(00,100,100), disp8
```

#### 6. 除法/取余指令修复

**问题**：`DIV` 和 `REM` 操作之前未在 `native_compiler_win.js` 中实现

**解决**：
- 添加 `idivReg()` 和 `iremReg()` 方法
- 正确处理 RDX:RAX 被除数扩展 (CQO 指令)
- 避免临时寄存器与目标/除数冲突

**测试验证** ✅

| 测试文件 | 变量数 | 预期 | 实际 | 状态 |
|---------|--------|------|------|------|
| spill_test.aur | 8 | 36 | 36 | ✅ |
| spill_stress_test.aur | 15 | 120 | 120 | ✅ |
| div_test.aur | - | 6 | 6 | ✅ |
| arithmetic_ops.aur | - | 10 | 10 | ✅ |

**测试套件** ✅
```
🧪 Aurora Pipeline Test Suite

▶ Running test: hello_world       ✅ PASS (9 instructions)
▶ Running test: loop_sum          ✅ PASS (13 instructions)
▶ Running test: conditional       ✅ PASS (15 instructions)
▶ Running test: conditional_no_else ✅ PASS (10 instructions)
▶ Running test: arithmetic_ops    ✅ PASS (14 instructions)
▶ Running test: complex_expr      ✅ PASS (18 instructions)
▶ Running test: bitwise_ops       ✅ PASS (25 instructions)
▶ Running test: function_call     ✅ PASS (18 instructions)

📊 Test Summary: 8/8 Passed
```

**文件变更**
- `pipeline/src/codegen.js` - 新增 STORE_STACK/LOAD_STACK 编码，优化表达式生成
- `pipeline/src/register_allocator.js` - 完全重写，支持 LRU 溢出
- `pipeline/src/backend/x86_encoder_win64.js` - 新增栈寻址和除法指令
- `pipeline/src/backend/native_compiler_win.js` - 新增 DIV/REM/STORE_STACK/LOAD_STACK case

**下一步计划**
1. **数组支持**：声明、索引访问、赋值
2. **函数参数**：支持带参数的函数调用
3. **字符串操作**：连接、长度、切片
4. **Linux 原生支持**：为 x86_encoder.js (Linux) 添加溢出支持

```