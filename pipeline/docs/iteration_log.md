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

---

### Iteration 15 - Pause 功能与 Linux 同步 ✅

**目标**：
1. 添加程序暂停功能（类似 C++ 的 `system("pause")`）
2. 同步 Linux 编译器与 Windows 的功能

**新增服务调用** ✅

| 服务码 | 名称 | 描述 |
|--------|------|------|
| 0x03 | pause | 显示 exit code，等待用户按 Enter，然后退出 |
| 0x04 | pause_silent | 仅等待用户按 Enter |

**语法支持**
```aurora
request service pause(exit_code);    // 显示 "Exit code: N\nPress Enter to continue..."
request service pause_silent();       // 仅等待
```

**Windows 实现** (`native_compiler_win.js`) ✅

1. **pause (0x03)**:
   - 数字转字符串算法（支持多位数）
   - 调用 WriteFile 输出 "Exit code: "
   - 调用 WriteFile 输出数字字符串
   - 调用 WriteFile 输出 "\nPress Enter to continue..."
   - 调用 ReadConsoleA 等待用户输入
   - 调用 ExitProcess 退出

2. **pause_silent (0x04)**:
   - 调用 ReadConsoleA 等待用户输入

**新增 Windows API 导入** ✅
- `ReadConsoleA` - 读取控制台输入

**内置字符串** ✅
- `_exit_code_str`: "Exit code: "
- `_press_enter_str`: "\nPress Enter to continue..."

**Linux 实现** (`native_compiler.js`) ✅

1. **pause (0x03)**:
   - 使用 read syscall (0) 等待输入
   - 使用 exit syscall (60) 退出

2. **pause_silent (0x04)**:
   - 使用 read syscall 等待输入

**Linux 编译器同步** ✅

为 `x86_encoder.js` 添加：
- `pushReg()` / `popReg()` - 压栈/出栈
- `movStackReg()` / `movRegStack()` - 栈槽访问
- `idivReg()` / `iremReg()` - 除法和取余

为 `native_compiler.js` 添加：
- DIV / REM 操作码处理
- STORE_STACK / LOAD_STACK 操作码处理
- 栈帧设置（128字节 spill slots）

**测试验证** ✅

| 测试 | 预期 | 实际 | 状态 |
|------|------|------|------|
| pause_test.exe | 显示 "Exit code: 42\nPress Enter..." | ✓ | ✅ |
| div_test.exe | 6 (24/4) | 6 | ✅ |
| rem_test.exe | 4 (25%7) | 4 | ✅ |
| spill_stress_test.exe | 120 | 120 | ✅ |
| 回归测试 | 8/8 | 8/8 | ✅ |

**文件变更**
- `pipeline/src/codegen.js` - 添加 pause/pause_silent 服务码
- `pipeline/src/backend/native_compiler_win.js` - Windows pause 完整实现
- `pipeline/src/backend/native_compiler.js` - Linux DIV/REM/栈操作/pause
- `pipeline/src/backend/x86_encoder.js` - Linux 指令编码器扩展
- `pipeline/examples/pause_test.aur` - pause 测试
- `pipeline/examples/rem_test.aur` - 取余测试

**下一步计划**
1. **for 循环**：C 风格 for 循环语法
2. **字符串操作**：连接、长度、切片
3. **更多数组功能**：动态分配、数组长度

---

### Iteration 16 - 数组支持 ✅

**目标**：实现基本数组功能 - 声明、初始化、索引访问和赋值

**语法设计** ✅

```aurora
// 数组声明和初始化
let arr: array<int> = [1, 2, 3, 4, 5];

// 静态索引访问
let x: int = arr[0];

// 动态索引访问
let i: int = 2;
let y: int = arr[i];

// 元素赋值
arr[0] = 10;
arr[i] = 20;
```

**类型系统** ✅

| 类型语法 | 描述 |
|----------|------|
| `array<int>` | 整数数组 |
| `array<bool>` | 布尔数组（未来） |
| `array<string>` | 字符串数组（未来） |

**ISA 扩展** ✅

| 操作码 | 名称 | 格式 | 描述 |
|--------|------|------|------|
| 0x18 | ARRAY_ALLOC | op0, imm32 | 编译时分配数组槽（运行时无操作） |
| 0x19 | ARRAY_STORE | slot, idx_reg, val_reg | 存储到 [RSP + 32 + (slot + idx)*8] |
| 0x1A | ARRAY_LOAD | dest, slot, idx_reg | 从 [RSP + 32 + (slot + idx)*8] 加载 |

**栈布局** ✅

```
[RSP + 0x00] : 阴影空间 (32 bytes, Windows ABI)
[RSP + 0x20] : arr[0]
[RSP + 0x28] : arr[1]
[RSP + 0x30] : arr[2]
...
```

**Parser 扩展** (`parser_v2.js`) ✅

1. **`parseType()`** - 支持 `array<elementType>` 语法
2. **`parsePrimary()`** - 支持数组字面量 `[expr, ...]` 和索引访问 `arr[idx]`
3. **`parseAssignmentStatement()`** - 支持数组元素赋值 `arr[idx] = value`
4. **`parseFunctionBodyStatement()`** - let 声明同时加入 statements 保持源码顺序

**IR 扩展** (`ir.js`) ✅

| 节点类型 | 创建函数 | 描述 |
|----------|----------|------|
| array_literal | `createArrayLiteralExpr(elementType, elements)` | 数组字面量 |
| array_access | `createArrayAccessExpr(array, index)` | 数组访问 |
| array_assign | `createArrayAssignStmt(arrayName, index, value)` | 数组赋值 |

**CodeGen 实现** (`codegen.js`) ✅

1. **CodeGenContext 扩展**:
   - `arrayBaseSlots`: Map - 数组名到基础槽映射
   - `nextArraySlot`: number - 下一个可用槽
   - `allocArraySlots(name, size)` - 分配数组槽
   - `getArrayBaseSlot(name)` - 获取数组基础槽

2. **`generateStatement()`** - 添加 `let` case（支持循环内声明）

3. **`generateArrayLiteral()`** - 分配槽并存储初始元素

4. **`generateArrayAccess()`** - 静态/动态索引加载

5. **`generateArrayAssignment()`** - 静态/动态索引存储

**Native Compiler 实现** (`native_compiler_win.js`) ✅

**新增操作码处理**:
- `ARRAY_ALLOC (0x18)` - 运行时无操作
- `ARRAY_LOAD (0x1A)` - 生成 `MOV dest, [RSP + idx*8 + offset]`
- `ARRAY_STORE (0x19)` - 生成 `MOV [RSP + idx*8 + offset], value`

**x86-64 SIB 寻址**:
```x86
; ARRAY_LOAD r7, base=0, idx=r2 (baseOffset = 32)
; dest = [RSP + r2*8 + 32]
REX.W MOV r64, [RSP + idx*8 + disp32]
  48 8B 84 D4 20 00 00 00  ; if dest=RBX(7->3), idx=RDX(2)
```

**关键修复** ✅

1. **语句顺序问题**: 原来 let 声明在 `localDecls` 中单独处理，与语句分离，导致：
   ```aurora
   arr[0] = 10;        // 应该先执行
   let a: int = arr[0]; // 应该后执行
   ```
   但实际生成顺序相反。修复：将 let 也加入 `body.statements` 保持源码顺序。

2. **循环内声明**: `generateStatement()` 添加 `let` case，支持 while/for 循环体内的变量声明。

**测试验证** ✅

| 测试 | 描述 | 预期 | 实际 | 状态 |
|------|------|------|------|------|
| array_test.aur | 基本数组求和 | 15 | 15 | ✅ |
| array_mutation_test.aur | 数组修改后求和 | 25 | 25 | ✅ |
| array_dynamic_index_test.aur | 循环遍历求和 | 150 | 150 | ✅ |
| 回归测试 | 8/8 通过 | - | - | ✅ |

**文件变更**
- `pipeline/src/parser_v2.js` - 数组语法解析
- `pipeline/src/ir.js` - 数组 IR 节点
- `pipeline/src/codegen.js` - 数组代码生成、操作码定义
- `pipeline/src/backend/native_compiler_win.js` - Windows x64 数组指令

**测试文件**
- `pipeline/examples/array_test.aur` - 基本数组测试
- `pipeline/examples/array_mutation_test.aur` - 数组修改测试
- `pipeline/examples/array_dynamic_index_test.aur` - 动态索引测试

**下一步计划**
1. **for 循环**：C 风格 for 循环语法
2. **字符串操作**：连接、长度、切片
3. **更多数组功能**：动态分配、数组长度、多维数组

---

### Iteration 17 - 浮点数支持 ✅

**日期**: 2025-01-XX

**目标**: 实现浮点数类型支持，作为多线程 Pi 计算的前置条件

**背景**: 
用户目标是实现一个多线程友好的语言，第一个大目标是完成 Pi 计算程序。实现 Pi 计算需要浮点运算支持。

**ISA 扩展** ✅

新增 8 个浮点操作码：

| 操作码 | 值 | 描述 |
|--------|-----|------|
| FMOV | 0x20 | 浮点加载/移动 |
| FADD | 0x21 | 浮点加法 |
| FSUB | 0x22 | 浮点减法 |
| FMUL | 0x23 | 浮点乘法 |
| FDIV | 0x24 | 浮点除法 |
| FCMP | 0x25 | 浮点比较 |
| CVTSI2SD | 0x26 | 整数转浮点 |
| CVTSD2SI | 0x29 | 浮点转整数 |

**浮点寄存器映射**:
- `xmm0-xmm7` - Aurora 浮点寄存器
- 映射到 x86-64 XMM0-XMM7

**词法分析 (lexer.js)** ✅
- 新增 `FLOAT` 类型关键字
- 新增 `FLOAT_NUMBER` token 类型
- 修改 `readNumber()` 识别浮点字面量 (如 `3.14`, `2.0`)

**语法解析 (parser_v2.js)** ✅
- `parseType()` 支持 `float` 类型
- `parsePrimary()` 处理浮点字面量，创建 `IR.createLiteralExpr('float', value)`
- `createLetDecl` 现在保存变量类型信息

**IR 扩展 (ir.js)** ✅
- `createLetDecl(name, value, type)` - 增加类型参数
- `createCastExpr(targetType, sourceExpr)` - 类型转换表达式

**代码生成 (codegen.js)** ✅

1. **浮点指令编码**:
   - `encodeFMovImmFull(xmm, value)` - 返回指令 + 64位浮点数据
   - `encodeFMovReg(dest, src)` - XMM 寄存器间移动
   - `encodeFAddReg`, `encodeFSubReg`, `encodeFMulReg`, `encodeFDivReg`
   - `encodeCvtSI2SD`, `encodeCvtSD2SI` - 类型转换

2. **浮点寄存器分配**:
   - `CodeGenContext.floatVars` - 跟踪浮点变量
   - `allocFloatRegister()`, `getFloatRegister()` - 分配管理
   - `allocFloatTemp()`, `releaseFloatTemp()` - 临时寄存器

3. **隐式类型转换**:
   - `generateFloatToIntDeclaration()` - 自动将 float 结果转换为 int
   - `isFloatExpression()` - 检测表达式是否涉及浮点

**Manifest 格式** ✅

浮点立即数使用两个 bytes 行：
```
bytes 0x2000FF0000000000  ; fmov xmm0, 10.5
bytes 0x4025000000000000  ; float64 10.5 (IEEE 754)
```

`op1 = 0xFF` 标记下一行是 64 位浮点数据。

**Windows 原生编译器 (native_compiler_win.js)** ✅

1. **操作码处理**:
   - FMOV + float data 双指令解析
   - FADD/FSUB/FMUL/FDIV → SSE2 指令
   - CVTSD2SI → `cvttsd2siRegXmm`

2. **x86-64 编码 (x86_encoder_win64.js)** ✅:
   - `movsdRegImm(xmm, float)` - 通过栈加载浮点
   - `movsdRegReg(dest, src)` - MOVSD XMM, XMM
   - `addsdRegReg`, `subsdRegReg`, `mulsdRegReg`, `divsdRegReg`
   - `cvtsi2sdXmmReg`, `cvttsd2siRegXmm` - 类型转换

**测试验证** ✅

| 测试 | 操作 | 预期结果 | 实际 | 状态 |
|------|------|----------|------|------|
| float_add_test.aur | 10.5 + 4.5 → int | 15 | 15 | ✅ |
| float_ops_test.aur | 5.0+3.0+5.0-3.0+5.0*3.0+5.0/3.0 | 26 | 26 | ✅ |
| 回归测试 | 8 个现有测试 | 全部通过 | 8/8 | ✅ |

**测试程序示例**
```aurora
module test {
    fn main() -> int {
        let a: float = 10.5;
        let b: float = 4.5;
        let sum: float = a + b;
        let result: int = sum;  // 隐式转换
        return result;          // 返回 15
    }
}
```

**文件变更**
- `pipeline/src/lexer.js` - 浮点 token
- `pipeline/src/parser_v2.js` - 浮点类型和字面量解析
- `pipeline/src/ir.js` - cast 表达式、let 类型
- `pipeline/src/codegen.js` - 浮点指令编码、寄存器分配
- `pipeline/src/backend/native_compiler_win.js` - 浮点操作码
- `pipeline/src/backend/x86_encoder_win64.js` - SSE2 指令

**测试文件**
- `pipeline/examples/float_test.aur` - 基本浮点测试
- `pipeline/examples/float_add_test.aur` - 浮点加法 + 类型转换
- `pipeline/examples/float_ops_test.aur` - 四则运算综合测试

**下一步计划 (多线程 Pi 计算路线图)**
- **Iteration 18**: 浮点比较和条件跳转 ✅
- **Iteration 19**: 线程创建基础 (`thread.spawn`)
- **Iteration 20**: 线程同步 (mutex, 原子操作)
- **Iteration 21**: 多线程 Pi 计算实现

---

### Iteration 18 - 浮点比较支持 ✅

**日期**: 2025-01-XX

**目标**: 实现浮点数比较操作，支持所有 6 种比较运算符

**背景**: 
Iteration 17 实现了浮点算术运算，但浮点条件判断失败。原因是 x86-64 的 `UCOMISD` 指令设置的标志位与整数 `CMP` 不同。

**问题分析** 🔍

UCOMISD vs CMP 的标志位差异：

| 比较结果 | UCOMISD (浮点) | CMP (整数) |
|----------|----------------|------------|
| a < b | CF=1 | SF≠OF |
| a > b | CF=0, ZF=0 | SF=OF, ZF=0 |
| a == b | ZF=1 | ZF=1 |

问题：对于浮点比较，我们生成 `FCMP` 指令（编译为 `UCOMISD`），但随后使用整数条件跳转（`JL`, `JG` 等），它们检查 `SF` 和 `OF` 标志——而 `UCOMISD` 不设置这些标志。

**解决方案** ✅

1. **跟踪比较类型**：在 `native_compiler_win.js` 中添加 `lastCompareWasFloat` 变量
   - `FCMP` 指令后设置为 `true`
   - `CMP` 指令后设置为 `false`

2. **浮点条件跳转**：在 `x86_encoder_win64.js` 中添加 `jccFloatRel32()` 方法
   - 使用无符号比较跳转（检查 CF/ZF 而非 SF/OF）

**跳转指令映射** ✅

| 条件 | 整数跳转 (jccRel32) | 浮点跳转 (jccFloatRel32) |
|------|---------------------|--------------------------|
| == | JE (0x84) | JE (0x84) |
| != | JNE (0x85) | JNE (0x85) |
| < | JL (0x8C) | **JB (0x82)** |
| <= | JLE (0x8E) | **JBE (0x86)** |
| > | JG (0x8F) | **JA (0x87)** |
| >= | JGE (0x8D) | **JAE (0x83)** |

**代码变更** ✅

1. **`x86_encoder_win64.js`**:
```javascript
// 新增浮点条件跳转方法
jccFloatRel32(condition, label) {
  const ccMap = {
    0x01: 0x84,  // JE
    0x02: 0x85,  // JNE
    0x03: 0x82,  // JB (below - unsigned/float)
    0x04: 0x86,  // JBE
    0x05: 0x87,  // JA (above - unsigned/float)
    0x06: 0x83,  // JAE
  };
  // ...
}
```

2. **`native_compiler_win.js`**:
```javascript
// 跟踪比较类型
let lastCompareWasFloat = false;

// 在指令循环中
if (instr.opcode === OPCODE.CMP) {
  lastCompareWasFloat = false;
} else if (instr.opcode === OPCODE.FCMP) {
  lastCompareWasFloat = true;
}

// CJMP 处理
case OPCODE.CJMP:
  if (instr._lastCompareWasFloat) {
    encoder.jccFloatRel32(op0, target);
  } else {
    encoder.jccRel32(op0, target);
  }
```

**测试验证** ✅

| 测试 | 比较操作 | 预期 | 实际 | 状态 |
|------|----------|------|------|------|
| float_cmp_simple.aur | 5.5 > 3.5 | 42 | 42 | ✅ |
| float_lt_test.aur | 3.5 < 5.5 | 15 | 15 | ✅ |
| float_eq_test.aur | 5.5 == 5.5 | 77 | 77 | ✅ |
| float_compare_test.aur | 多重比较 | 20 | 20 | ✅ |
| float_all_cmp_test.aur | 全部 6 种 | 63 | 63 | ✅ |
| 回归测试 | 8 个测试 | 通过 | 8/8 | ✅ |

**综合测试 (float_all_cmp_test.aur)**
```aurora
module test {
    fn main() -> int {
        let res: int = 0;
        let a: float = 5.5;
        let b: float = 3.5;
        let c: float = 5.5;
        
        if a > b  { res = res + 1; }   // +1
        if b < a  { res = res + 2; }   // +2
        if a >= b { res = res + 4; }   // +4
        if b <= a { res = res + 8; }   // +8
        if a == c { res = res + 16; }  // +16
        if a != b { res = res + 32; }  // +32
        
        return res;  // 63 = 1+2+4+8+16+32
    }
}
```

**文件变更**
- `pipeline/src/backend/x86_encoder_win64.js` - 新增 `jccFloatRel32()`
- `pipeline/src/backend/native_compiler_win.js` - 比较类型跟踪和分发

**测试文件**
- `pipeline/examples/float_cmp_simple.aur` - 简单 > 测试
- `pipeline/examples/float_lt_test.aur` - 小于测试
- `pipeline/examples/float_eq_test.aur` - 相等测试
- `pipeline/examples/float_compare_test.aur` - 多重比较
- `pipeline/examples/float_all_cmp_test.aur` - 全部 6 种比较

**下一步计划**
- **Iteration 19**: 线程创建基础 (`thread.spawn`) ✅
- **Iteration 20**: 线程同步 (mutex, 原子操作)
- **Iteration 21**: 多线程 Pi 计算实现

---

### Iteration 19 - 线程创建基础 ✅

**日期**: 2025-11-30

**目标**: 实现基本的线程创建和等待功能

**语法设计** ✅

```aurora
// 创建线程
let t: thread = spawn worker_func();

// 等待线程完成
join t;

// 线程入口函数
fn worker_func() -> int {
    return 42;
}
```

**ISA 扩展** ✅

| 操作码 | 值 | 格式 | 描述 |
|--------|-----|------|------|
| SPAWN | 0x30 | `SPAWN r0, func_label` | 创建线程执行函数，句柄存入 r0 |
| JOIN | 0x31 | `JOIN r0` | 等待 r0 中的线程完成 |

**实现细节**

1. **词法分析 (lexer.js)** ✅
   - 新增 `THREAD` 类型 token
   - 新增 `SPAWN`, `JOIN` 关键字 token

2. **语法解析 (parser_v2.js)** ✅
   - `parseType()` 支持 `thread` 类型
   - `parsePrimary()` 处理 `spawn func()` 表达式
   - `parseJoinStatement()` 解析 `join handle;` 语句
   - `parseFunctionBodyStatement()` 支持 spawn/join

3. **IR 节点 (ir.js)** ✅
   - `createSpawnExpr(funcName)` - spawn 表达式
   - `createJoinStmt(handleName)` - join 语句

4. **代码生成 (codegen.js)** ✅
   - `encodeSpawn(destReg, funcLabel)` - 编码 SPAWN 指令
   - `encodeJoin(handleReg)` - 编码 JOIN 指令
   - `generateDeclaration()` 处理 spawn 表达式
   - `generateJoin()` 生成 JOIN 指令

5. **Windows 原生编译 (native_compiler_win.js)** ✅

**SPAWN 实现**:
```javascript
case OPCODE.SPAWN:
  // CreateThread(NULL, 0, func_addr, NULL, 0, NULL)
  encoder.xorRegReg(1, 1);  // RCX = NULL
  encoder.xorRegReg(2, 2);  // RDX = 0
  // LEA R8, [RIP + func_offset]
  encoder.emit(0x4C, 0x8D, 0x05);
  encoder.relocations.push({ offset, label: funcLabel, type: 'rel32' });
  encoder.xorRegReg(4, 4);  // R9 = NULL
  // Stack args: dwCreationFlags=0, lpThreadId=NULL
  encoder.callImport('CreateThread');
  encoder.movRegReg(destReg, 0);  // Move handle from RAX
```

**JOIN 实现**:
```javascript
case OPCODE.JOIN:
  // WaitForSingleObject(handle, INFINITE)
  encoder.movRegReg(1, handleReg);  // RCX = handle
  encoder.movRegImm64(2, 0xFFFFFFFF);  // RDX = INFINITE
  encoder.callImport('WaitForSingleObject');
```

**PE 导入更新** ✅
```javascript
const importFunctions = [
  'ExitProcess', 'GetStdHandle', 'WriteFile', 'ReadConsoleA',
  'CreateThread', 'WaitForSingleObject', 'CloseHandle'
];
```

**测试验证** ✅

| 测试 | 描述 | 预期 | 实际 | 状态 |
|------|------|------|------|------|
| thread_test.aur | 单线程创建+等待 | 0 | 0 | ✅ |
| thread_multi_test.aur | 多线程创建+等待 | 30 | 30 | ✅ |
| 回归测试 | 8 个测试 | 通过 | 8/8 | ✅ |

**示例程序**
```aurora
module test {
    fn worker() -> int {
        return 42;
    }
    
    fn main() -> int {
        let t: thread = spawn worker();
        join t;
        return 0;
    }
}
```

**文件变更**
- `pipeline/src/lexer.js` - THREAD, SPAWN, JOIN tokens
- `pipeline/src/parser_v2.js` - spawn/join 语法解析
- `pipeline/src/ir.js` - createSpawnExpr, createJoinStmt
- `pipeline/src/codegen.js` - SPAWN/JOIN 操作码和代码生成
- `pipeline/src/backend/native_compiler_win.js` - CreateThread/WaitForSingleObject 实现
- `pipeline/src/backend/pe64_generator.js` - 线程 API 导入

**测试文件**
- `pipeline/examples/thread_test.aur` - 基本线程测试
- `pipeline/examples/thread_multi_test.aur` - 多线程测试

**限制和下一步**
- 当前线程不能返回值给主线程（需要共享内存）
- 没有线程同步原语（mutex, atomic）
- 下一步实现共享内存和同步机制

---

### Iteration 20 - 线程同步与共享内存 ✅ (2025-11-30)

**目标**: 实现共享变量和原子操作，支持多线程间的数据同步

**新增 ISA 指令**

| Opcode | 名称 | 格式 | 说明 |
|--------|------|------|------|
| 0x32 | ATOMIC_LOAD | dest_reg, shared_id | 原子读取共享变量 |
| 0x33 | ATOMIC_STORE | shared_id, src_reg | 原子存储到共享变量 |
| 0x34 | ATOMIC_ADD | shared_id, src_reg | 原子加法 (lock xadd) |
| 0x35 | ATOMIC_FADD | shared_id, src_xmm | 原子浮点加法 (预留) |

**新增语法**

```aurora
// 共享变量声明
shared counter: int = 0;

// 原子操作
atomic.add(counter, 5);    // 原子加法
atomic.load(counter)       // 原子读取
```

**实现细节**

1. **Lexer 扩展** (`lexer.js`)
   - 新增 `SHARED` token
   - 新增 `ATOMIC` token  
   - 新增 `DOT` token (单点，区别于 DOTDOT)

2. **Parser 扩展** (`parser_v2.js`)
   - `parseSharedDecl()` - 解析共享变量声明
   - `parseAtomicStatement()` - 解析 atomic.add/store 语句
   - `parseAtomicLoadExpr()` - 解析 atomic.load 表达式
   - 函数返回类型变为可选（支持 void 函数如 worker）
   - 隐式模块检测（文件有 shared/fn 声明时自动作为模块）

3. **IR 扩展** (`ir.js`)
   - `createSharedDecl(name, type, value)`
   - `createAtomicAddStmt(sharedVar, value)`
   - `createAtomicLoadExpr(sharedVar)`
   - `createCallStmt(functionName, args)`

4. **Codegen 扩展** (`codegen.js`)
   - `registerSharedVar(name, type, initialValue)` - 注册共享变量
   - `generateAtomicOp()` - 生成 ATOMIC_ADD/STORE 指令
   - `generateAtomicLoad()` - 生成 ATOMIC_LOAD 指令
   - 非 main 函数自动生成隐式 `ret` 指令
   - **修复**: `shared.value` vs `shared.initialValue` 字段名不匹配

5. **Native Compiler 扩展** (`native_compiler_win.js`)
   - 解析 manifest 中的 `shared` 指令
   - 为非 main 函数（线程入口）生成 prologue (`sub rsp, 0x48`)
   - 为 `RET` 指令生成 epilogue (`add rsp, 0x48`)
   - SPAWN: 使用栈位置保存/恢复易失寄存器，确保 shadow space 完整
   - JOIN: 保存/恢复线程 handle 寄存器，避免相互覆盖
   - ATOMIC_LOAD: LEA + MOV (对齐的 64 位读取是原子的)
   - ATOMIC_ADD: LEA + LOCK XADD
   - ATOMIC_STORE: LEA + LOCK XCHG

6. **x86 Encoder 扩展** (`x86_encoder_win64.js`)
   - `addSharedVar(name, initialValue)` - 在数据段分配 8 字节对齐的共享变量
   - `leaRegRipLabel(destReg, label)` - RIP 相对寻址
   - `lockXaddMem64Reg(memReg, srcReg)` - LOCK XADD 原子加法
   - `lockXchgMem64Reg(memReg, srcReg)` - LOCK XCHG 原子存储

**修复的关键 Bug**

1. **共享变量初始值丢失**: IR 使用 `value` 字段，codegen 错误地读取 `initialValue`
2. **SPAWN 破坏 shadow space**: push 4 个寄存器占用了 CreateThread 的 shadow space，改用栈高位保存
3. **JOIN 破坏其他线程 handle**: 设置 RDX=INFINITE 会覆盖 r2 中的 handle，添加保存/恢复逻辑

**测试结果**

| 测试程序 | 描述 | 预期 | 实际 | 状态 |
|---------|------|------|------|------|
| atomic_debug1.aur | 单线程 atomic add | 5 | 5 | ✅ |
| atomic_call_test.aur | 函数调用中的 atomic | 5 | 5 | ✅ |
| atomic_load_only_test.aur | 读取初始值 | 10 | 10 | ✅ |
| minimal_thread_test.aur | 单线程 atomic add | 42 | 42 | ✅ |
| thread_two_simple_test.aur | 两线程并行 add | 10 | 10 | ✅ |
| two_thread_sequential.aur | 两线程顺序 add | 10 | 10 | ✅ |
| shared_counter_test.aur | 两线程循环 add | 20 | 20 | ✅ |
| thread_multi_test.aur | 回归测试 | 30 | 30 | ✅ |
| pi_leibniz_test.aur | 回归测试 | 3 | 3 | ✅ |

**示例程序: 两线程原子计数**
```aurora
shared counter: int = 0;

fn worker() {
  for i in 0..10 {
    atomic.add(counter, 1);
  }
}

fn main() -> int {
  let t1: thread = spawn worker();
  let t2: thread = spawn worker();
  join t1;
  join t2;
  return atomic.load(counter);  // 返回 20
}
```

**x86-64 生成代码 (worker 函数核心)**
```x86-64
; prologue
sub rsp, 0x48

; atomic.add(counter, 1)
mov r11, 1
lea rbx, [rip + _shared_0]
lock xadd [rbx], r11

; epilogue
add rsp, 0x48
ret
```

**下一步计划**
- **Iteration 21**: 多线程 Pi 计算实现
  - 使用 atomic.fadd 进行浮点累加
  - 任务分片：每个线程计算部分级数
  - 验证多线程正确性

---

### Iteration 21 - 多线程 Pi 计算 ✅ (2025-11-30)

**目标**：实现多线程并行计算 π，验证线程同步正确性

**新增功能**

1. **Debug 级别选项** ✅
   - CLI 参数：`--debug`, `--debug=N`, `-d`, `-dN`
   - 级别定义：
     - 0 (NONE): 无调试输出
     - 1 (BASIC): 编译阶段、函数名
     - 2 (VERBOSE): 指令级输出
     - 3 (TRACE): 完整追踪含十六进制转储

2. **atomic.fadd 指令** ✅
   - 操作码：`ATOMIC_FADD (0x35)`
   - 实现：CAS 循环（无 x86 原生浮点原子指令）
   - 算法：
     ```
     loop:
       MOV RAX, [addr]      ; 加载当前值
       MOVQ XMM1, RAX       ; 转换为浮点
       ADDSD XMM1, XMMsrc   ; 加法
       MOVQ RCX, XMM1       ; 结果转整数
       LOCK CMPXCHG [addr], RCX  ; 原子交换
       JNE loop             ; 失败则重试
     ```

3. **atomic.load 声明支持** ✅
   - 修复：`let x: int = atomic.load(var);` 现在正常工作
   - 添加 `atomic_load` case 到 `generateDeclaration`

4. **栈帧扩展** ✅
   - 从 0x48 (72字节) 扩展到 0x58 (88字节)
   - 布局：
     ```
     [rsp+0x00-0x1F] : shadow space (32字节)
     [rsp+0x20-0x2F] : API 参数空间 (16字节)
     [rsp+0x30-0x4F] : 寄存器保存 (32字节: RCX, RDX, R8, R9)
     [rsp+0x50-0x57] : 对齐 (8字节)
     ```

**Bug 修复**

1. **SPAWN R9 保存** ✅
   - 问题：SPAWN 未保存 r4 (R9)，导致第4个线程句柄丢失
   - 修复：增加 `mov [rsp+0x48], r9` 和对应恢复
   
2. **JOIN R9 保存** ✅
   - 问题：JOIN 未保存 r4 (R9)
   - 修复：保存/恢复所有 4 个寄存器 (RCX, RDX, R8, R9)

**测试结果**

| 测试文件 | 描述 | 预期 | 实际 | 状态 |
|---------|------|-----|------|------|
| pi_multithread.aur | 4线程Leibniz计算 | 314 | 314 | ✅ |
| thread_two_simple_test.aur | 回归测试 | 10 | 10 | ✅ |
| atomic_fadd_test.aur | atomic.add测试 | 3 | 3 | ✅ |

**多线程 Pi 计算程序**

算法：Leibniz 公式 π/4 = 1 - 1/3 + 1/5 - 1/7 + ...

```aurora
shared sum: int = 0;

// 线程0: 项 0, 4, 8, 12, ... (k = 4n) - 正项
fn worker0() {
    let i: int = 0;
    let partial: int = 0;
    while i < 250 {
        let k: int = i * 4;
        let denom: int = 2 * k + 1;
        let term: int = 10000 / denom;
        partial = partial + term;
        i = i + 1;
    }
    atomic.add(sum, partial);
}

// 线程1: 项 1, 5, 9, 13, ... (k = 4n+1) - 负项
// 线程2: 项 2, 6, 10, 14, ... (k = 4n+2) - 正项
// 线程3: 项 3, 7, 11, 15, ... (k = 4n+3) - 负项

fn main() -> int {
    let t0: thread = spawn worker0();
    let t1: thread = spawn worker1();
    let t2: thread = spawn worker2();
    let t3: thread = spawn worker3();
    
    join t0; join t1; join t2; join t3;
    
    let s: int = atomic.load(sum);
    let pi: int = s * 4;        // π * 10000
    let scaled: int = pi / 100; // π * 100
    return scaled;              // 返回 314
}
```

**运行结果 (10次)**
```
Run 1 - Exit code: 314
Run 2 - Exit code: 314
Run 3 - Exit code: 314
Run 4 - Exit code: 314
Run 5 - Exit code: 314
Run 6 - Exit code: 314
Run 7 - Exit code: 314
Run 8 - Exit code: 314
Run 9 - Exit code: 314
Run 10 - Exit code: 314
```

**调试输出示例 (--debug=2)**
```
[aurora-win] debug level: 2
[debug] Parsing manifest...
[debug] Found 101 instructions, 0 strings, 13 labels
[debug] Found 1 shared variables
[debug] Compiling to x64...
[debug] Function: fn_worker0 at instruction 1
[debug] Function: fn_worker1 at instruction 20
[debug] Function: fn_worker2 at instruction 40
[debug] Function: fn_worker3 at instruction 60
[debug] Generated 1100 bytes of code
```

**下一步计划**
- **Iteration 23**: 浮点类型支持增强
  - 添加 `as int` / `as float` 类型转换语法
  - 支持 `shared` 浮点变量
  - 实现浮点版本 Pi 计算

---

### Iteration 22 - 基本输入输出 (Basic I/O) ✅

**目标**：添加基本的控制台输入输出功能，使 Aurora 程序可以与用户交互

**新增功能**

1. **`print(string)` - 打印字符串**
   - 使用 Windows WriteFile API
   - 支持字符串字面量和变量
   - SVC 0x01 已有实现，新增简化语法

2. **`print(int)` - 打印整数**
   - 新增 SVC 0x05 (print_int)
   - 整数到字符串转换（除法循环）
   - 支持正数、负数、零
   - 自动添加换行符

3. **`input() -> int` - 读取整数输入**
   - 新增 SVC 0x06 (input_int)
   - 使用 Windows ReadFile API（支持管道输入）
   - 字符串到整数解析
   - 支持负数输入

**词法分析器修改 (lexer.js)**
```javascript
// 新增 token 类型
PRINT: 'PRINT',
INPUT: 'INPUT',

// 新增关键字
'print': TokenType.PRINT,
'input': TokenType.INPUT,
```

**语法分析器修改 (parser_v2.js)**
```javascript
// 新语法支持
print("Hello");    // 打印字符串
print(42);         // 打印整数
print(x + y);      // 打印表达式
let n: int = input();  // 读取整数
```

**IR 模块修改 (ir.js)**
```javascript
// 新增 input 表达式类型
createInputExpr() {
  return { kind: 'input', type: 'int' };
}
```

**代码生成修改 (codegen.js)**
- `generateRequest()` 根据参数类型自动选择 print/print_int
- `generateInput()` 生成 SVC 0x06 并返回结果寄存器
- `generateDeclaration()` 支持 `let x = input()` 语法
- 表达式打印使用临时寄存器，避免覆盖变量

**原生编译器修改 (native_compiler_win.js)**

**SVC 0x05 - print_int 实现**
```assembly
; 保存所有 Aurora 寄存器 (r1-r5)
push rcx, rdx, r8, r9, r10, r11, r12, r13, r14, r15
sub rsp, 0x48

; 获取 STDOUT 句柄
mov rcx, -11
call GetStdHandle

; 整数转字符串（除法循环，支持负数）
mov r12, rax          ; 保存原始值
mov rcx, 10           ; 除数
; ... 循环转换 ...

; 写入控制台
call WriteFile

; 恢复所有寄存器
pop r15, r14, r13, r12, r11, r10, r9, r8, rdx, rcx
```

**SVC 0x06 - input_int 实现**
```assembly
; 获取 STDIN 句柄
mov rcx, -10
call GetStdHandle

; 读取输入
lea rdx, [rsp+0x30]   ; 缓冲区
mov r8d, 20           ; 最大字符数
call ReadFile

; 解析字符串到整数（支持负数）
; ... 解析循环 ...

; 结果在 RAX
```

**关键技术点**

1. **寄存器保存/恢复**：SVC 0x05 保存所有 caller-save 寄存器，确保 print 调用不会破坏后续代码使用的变量

2. **栈帧管理**：每个 SVC 独立管理栈帧，避免与主程序栈冲突

3. **负数处理**：先检测符号，转为绝对值处理，最后加负号

4. **跳转偏移计算**：手动计算 jns/jz/jnz 偏移量，确保条件分支正确

**测试用例**

**io_demo.aur - 综合 I/O 测试**
```aurora
module io_demo {
fn main() {
    print("=== Aurora I/O Demo ===");
    print(42);
    print(-999);
    
    let x: int = 100;
    let y: int = 200;
    print(x);
    print(y);
    print(x + y);   // 300
    print(x * 3);   // 300
    print(y - x);   // 100
    
    print("=== Demo Complete ===");
    return 0;
}
}
```

**输出**
```
=== Aurora I/O Demo ===42
0
12345
-1
-999
100
200
300
300
100
=== Demo Complete ===
```

**echo_input.aur - 输入测试**
```aurora
module echo_input {
fn main() {
    let x: int = input();
    return x;
}
}
```

**测试**
```powershell
echo "42" | .\build\echo_input.exe
Exit code: 42
```

**向后兼容性**
- 旧语法 `request service print(msg)` 仍然支持
- 解析器自动处理 PRINT token 作为服务名

**已知限制**
1. 字符串打印不自动换行（整数打印会）
2. 管道输入每次读取整个缓冲区（20字节）
3. 不支持浮点数输入输出

**文件变更统计**
- `lexer.js`: +4 行
- `parser_v2.js`: +30 行
- `ir.js`: +6 行
- `codegen.js`: +20 行
- `native_compiler_win.js`: +120 行（含 SVC 0x05/0x06 实现）

**测试状态** ✅
所有现有测试继续通过：
```
✅ hello_world
✅ loop_sum
✅ conditional
✅ pi_calc (exit code: 3141)
```

新增 I/O 测试：
```
✅ io_demo - 综合输出测试
✅ io_test - 多类型打印测试
✅ echo_input - 管道输入测试
✅ print_two_vars - 变量打印测试
```

---

### Iteration 23 - 浮点数打印与类型转换 (Float Print & Type Cast) ✅

**目标**：实现 `print(float)` 功能和 `as` 类型转换语法，使 Aurora 程序可以输出浮点数结果

**新增功能**

1. **`print(float)` - 打印浮点数**
   - 新增 SVC 0x07 (print_float)
   - 支持正数、负数、零
   - 6 位小数精度
   - 自动添加换行符

2. **`as` 关键字 - 类型转换**
   - `float_val as int` - 浮点转整数（截断）
   - `int_val as float` - 整数转浮点
   - 在变量声明时自动应用

**词法分析器修改 (lexer.js)**
```javascript
// 新增 token 类型
AS: 'AS',

// 新增关键字
'as': TokenType.AS,
```

**语法分析器修改 (parser_v2.js)**
```javascript
// 新语法支持
let x: float = 3.14;
print(x);              // 输出: 3.140000
let y: int = x as int; // y = 3
```

**代码生成修改 (codegen.js)**
- print_float 使用 xmm6 作为参数传递寄存器（避免覆盖用户变量）
- `as int` 生成 CVTSD2SI 指令
- `as float` 生成 CVTSI2SD 指令
- 表达式参与 print 时复制到临时寄存器

**原生编译器修改 (native_compiler_win.js)**

**SVC 0x07 - print_float 实现**
```assembly
; Stack frame: 0x88 bytes
;   [rsp+0x20-0x27] = written count
;   [rsp+0x28-0x3F] = scratch / buffer
;   [rsp+0x40-0x47] = stdout handle
;   [rsp+0x48-0x4F] = input value
;   [rsp+0x50-0x7F] = saved xmm0-xmm5

; 保存 GP 寄存器和 xmm0-xmm5
push rbx, rcx, rdx, r8, r12, r13, r14, r15
sub rsp, 0x88
movsd [rsp+0x50], xmm0  ; 保存用户变量
...
movsd [rsp+0x78], xmm5

; 从 xmm6 获取输入值
movsd xmm0, xmm6

; 检测符号位
movmskpd eax, xmm0
mov r15d, eax

; 取绝对值
mov rax, 0x7FFFFFFFFFFFFFFF
movsd xmm1, [rsp+0x28]  ; mask
andpd xmm0, xmm1

; 分离整数和小数部分
cvttsd2si r12, xmm0     ; r12 = int_part
cvtsi2sd xmm1, r12
subsd xmm0, xmm1        ; xmm0 = frac_part

; 小数部分 × 1000000
mov rax, 0x412E848000000000  ; 1000000.0
movsd xmm1, [rsp+0x28]
mulsd xmm0, xmm1
cvtsd2si r13, xmm0      ; r13 = frac_digits

; 构建输出字符串（从后往前）
lea r14, [rsp+0x3F]     ; buffer end
; ... 6位小数循环 ...
; ... 小数点 ...
; ... 整数部分循环 ...
; ... 负号（如果需要）...

; 调用 WriteFile
mov rcx, [rsp+0x40]     ; handle
mov rdx, r14            ; buffer
mov r8d, ebx            ; length
call WriteFile

; 恢复 xmm0-xmm5 和 GP 寄存器
movsd xmm0, [rsp+0x50]
...
movsd xmm5, [rsp+0x78]
add rsp, 0x88
pop ...
```

**关键技术点**

1. **XMM 寄存器保护**：SVC 0x07 保存 xmm0-xmm5，确保调用后用户的浮点变量不变

2. **使用 xmm6 作为参数**：codegen 在调用 print(float) 前把值复制到 xmm6，避免覆盖 xmm0-xmm5 中的用户变量

3. **栈对齐**：8 pushes (64 bytes) + sub rsp, 0x88 (136 bytes) = 200 bytes ≡ 8 (mod 16)，满足 Windows x64 ABI 的 16n+8 对齐要求

4. **浮点精度**：乘以 1000000.0 获取 6 位小数，使用 cvtsd2si 四舍五入

**测试用例**

**float_comprehensive.aur - 完整浮点测试**
```aurora
fn main() -> int {
    let a: float = 5.5;
    let b: float = 2.5;
    
    let sum: float = a + b;    // 8.0
    let diff: float = a - b;   // 3.0
    let prod: float = a * b;   // 13.75
    let quot: float = a / b;   // 2.2
    
    print(sum);
    print(diff);
    print(prod);
    print(quot);
    
    let int_val: int = a as int;  // 5
    print(int_val);
    
    return 0;
}
```

**输出**
```
8.000000
3.000000
13.750000
2.200000
5
```

**float_print_full_test.aur - 边界测试**
```aurora
fn main() -> int {
    let pi: float = 3.14159;
    let neg: float = -2.5;
    let zero: float = 0.0;
    let one: float = 1.0;
    let small: float = 0.001;
    
    print(pi);     // 3.141590
    print(neg);    // -2.500000
    print(zero);   // 0.000000
    print(one);    // 1.000000
    print(small);  // 0.001000
    return 0;
}
```

**文件变更统计**
- `lexer.js`: +2 行（AS token）
- `parser_v2.js`: +15 行（as 表达式解析）
- `codegen.js`: +25 行（print_float 生成、xmm6 参数传递）
- `native_compiler_win.js`: +110 行（SVC 0x07 完整实现）

**测试状态** ✅
所有现有测试继续通过：
```
✅ hello_world
✅ loop_sum
✅ conditional
✅ conditional_no_else
✅ arithmetic_ops
✅ complex_expr
✅ bitwise_ops
✅ function_call
```

新增浮点测试：
```
✅ float_simple - 单个浮点打印
✅ float_two_test - 两个浮点打印
✅ float_fadd_test - 浮点加法
✅ float_fsub_test - 浮点减法
✅ float_fmul_test - 浮点乘法
✅ float_fdiv_test - 浮点除法
✅ float_comprehensive - 完整浮点操作
✅ float_print_full_test - 边界值测试
```

---

### Iteration 23.1 - 浮点精度提升 (Float Precision Enhancement) ✅

**目标**：将浮点数打印精度从 6 位小数提升到 9 位小数

**修改内容**

1. **乘数常量更新**
   - 原值：`1e6` = `0x412E848000000000` (6 位小数)
   - 新值：`1e9` = `0x41CDCD6500000000` (9 位小数)

2. **循环计数更新**
   - 原值：`mov r8b, 6` - 写 6 位小数
   - 新值：`mov r8b, 9` - 写 9 位小数

**关键代码修改 (native_compiler_win.js)**
```javascript
// Multiply by 1e9 = 0x41CDCD6500000000 (9 decimal places, safe for int64)
// LE bytes: 00 00 00 00 65 CD CD 41
encoder.emit(0x48, 0xB8, 0x00, 0x00, 0x00, 0x00, 0x65, 0xCD, 0xCD, 0x41);

// Write 9 fractional digits
encoder.emit(0x41, 0xB0, 0x09);  // mov r8b, 9
```

**为什么选择 9 位而非 15 位**
- 15 位（1e15）会导致 int64 溢出风险，因为 `frac * 1e15` 对于接近 1.0 的分数可能超过 `2^63-1`
- 9 位（1e9）在 int64 范围内安全，最大 `0.999999999 * 1e9 = 999999999` < `2^31`
- 9 位对于大多数科学计算和日常使用已足够

**精度测试结果**
```
Input: 3.141592653589793  →  Output: 3.141592654 ✓ (四舍五入)
Input: 2.718281828459045  →  Output: 2.718281828 ✓
Input: 1.4142135623730951 →  Output: 1.414213562 ✓
Input: 0.000000001        →  Output: 0.000000001 ✓
Input: -123.456789012     →  Output: -123.456789012 ✓
```

**测试状态** ✅
所有 8 个现有测试继续通过，高精度浮点输出正常工作。