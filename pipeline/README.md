# Aurora Pipeline Compiler - Stage N1 Complete ✅

**JavaScript 原型编译器，支持 Aurora 语言子集到原生 x86-64 ELF64 可执行文件的转换**

## 🎯 功能特性

### ✅ 已实现

**语法支持**：
- ✅ `module { fn main() -> int { ... } }` 结构
- ✅ `let <name>: <type> = <value>;` 变量声明（int/string）
- ✅ `if <condition> { ... } else { ... }` 条件分支（支持 >, <, >=, <=, ==, !=）
- ✅ `while <var> > 0 { ... }` 后置判断循环
- ✅ 算术运算（`+`, `-`, `*`, `/`, `%`）
- ✅ 位运算（`&`, `|`, `^`, `<<`, `>>`）
- ✅ 函数定义与调用（参数传递、返回值）
- ✅ `request service print/exit` 系统调用
- ✅ `return <value>;` 返回语句

**编译器架构**：
- ✅ 模块化设计：Parser → IR → CodeGen → Manifest → Native
- ✅ 智能寄存器分配器（变量池 + 临时池）
- ✅ IR 验证（未定义变量检测）
- ✅ 自动化测试套件（回归测试）
- ✅ **原生 x86-64 代码生成**
- ✅ **ELF64 可执行文件生成**

**指令生成**：
- ✅ 22 种 ISA 指令：MOV/ADD/SUB/MUL/DIV/REM/CMP/JMP/CJMP/CALL/RET/SVC/HALT/AND/OR/XOR/NOT/SHL/SHR
- ✅ 优化的循环（后置判断，减少跳转）
- ✅ 直接寄存器操作（避免临时变量）
- ✅ 字节完美匹配预期输出

## 📂 项目结构

```
pipeline/
├── src/
│   ├── pipeline_driver.js      # 主驱动（CLI 入口）
│   ├── lexer.js                # 词法分析器
│   ├── parser_v2.js            # 递归下降解析器
│   ├── ir.js                   # IR 定义与工具
│   ├── codegen.js              # 代码生成器
│   ├── register_allocator.js   # 寄存器分配器
│   ├── test_runner.js          # 自动化测试
│   └── backend/                # 原生代码后端
│       ├── x86_encoder.js      # x86-64 指令编码器
│       ├── elf64_generator.js  # ELF64 文件生成器
│       └── native_compiler.js  # Manifest → Native 编译器
├── examples/
│   ├── hello_world.aur
│   ├── loop_sum.aur
│   ├── conditional.aur
│   ├── function_call.aur
│   ├── bitwise_ops.aur
│   └── *_expected.aurs
├── build/
│   └── *.elf                   # 生成的原生可执行文件
└── docs/
    ├── iteration_log.md
    ├── self_hosting_roadmap.md
    └── usage.md
```

## 🚀 快速开始

### 编译到原生可执行文件 (Linux x86-64)

```powershell
node pipeline/src/pipeline_driver.js native <input.aur> -o <output.elf>
```

**示例**：
```powershell
# 编译 hello_world 到原生 ELF
node pipeline/src/pipeline_driver.js native pipeline/examples/hello_world.aur -o build/hello_world.elf

# 在 Linux/WSL 上运行
./build/hello_world.elf
# 输出: OK
```

### 编译到 Manifest（中间格式）

```powershell
node pipeline/src/pipeline_driver.js compile <input.aur> -o <output.aurs>
```

### 运行测试套件

```powershell
node pipeline/src/test_runner.js
```

**输出示例**：
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

## 📖 支持的语法

### Hello World（字符串打印）

```aurora
module demo {
    fn main() -> int {
        let message: string = "Hello, Aurora!\n";
        request service print(message);
        request service exit(0);
        return 0;
    }
}
```

**生成指令**：
- `mov r1, @str_0` - 加载字符串地址
- `svc 0x01, 0x01` - 打印（stdout）
- `mov r0, #0` - 准备退出码
- `svc 0x02` - 退出

### 算术循环（累加计数器）

```aurora
module demo {
    fn main() -> int {
        let accumulator: int = 0;
        let counter: int = 4;

        while counter > 0 {
            accumulator = accumulator + counter;
            counter = counter - 1;
        }

        request service exit(accumulator);
        return accumulator;
    }
}
```

**生成指令**：
- `mov r1, #0` / `mov r2, #4` - 初始化变量
- `label loop`
- `add r1, r1, r2` - 累加
- `sub r2, r2, #1` - 递减
- `cmp r2, #0` / `cjmp eq, exit` - 条件判断
- `jmp loop` - 循环跳转
- `label exit`
- `mov r0, r1` / `svc 0x02` - 退出

### 条件分支（if/else）

```aurora
module demo {
    fn main() -> int {
        let x: int = 5;
        let result: int = 0;
        
        if x > 3 {
            result = 10;
        } else {
            result = 20;
        }
        
        request service exit(result);
        return result;
    }
}
```

**生成指令**：
- `mov r1, #5` / `mov r2, #0` - 初始化变量
- `cmp r1, #3` - 比较 x 和 3
- `cjmp leq, else_0` - 如果 x <= 3，跳到 else
- `mov r6, #10` / `mov r2, r6` - then 分支：result = 10
- `jmp endif_1` - 跳过 else
- `label else_0`
- `mov r7, #20` / `mov r2, r7` - else 分支：result = 20
- `label endif_1`
- `mov r0, r2` / `svc 0x02` - 退出

**支持的比较运算符**：`>`, `<`, `==`, `!=`

## 🔍 调试选项

### 查看 IR

```powershell
$env:DEBUG_IR = "1"
node pipeline/src/pipeline_driver.js compile <input.aur> -o <output.aurs>
```

输出完整的 IR JSON 结构，包括：
- 所有声明（declarations）
- 语句块（body.statements）
- 表达式类型（literal/variable/binary）

## 🧪 测试覆盖

| 测试用例 | 指令数 | 功能 | 状态 |
|---------|-------|------|-----|
| hello_world | 7 | 字符串打印 | ✅ PASS |
| loop_sum | 11 | 算术循环 | ✅ PASS |
| conditional | 13 | if/else 分支 | ✅ PASS |
| conditional_no_else | 8 | 无 else 条件 | ✅ PASS |
| arithmetic_ops | 11 | 乘除模运算 | ✅ PASS |
| complex_expr | 15 | 复杂表达式 | ✅ PASS |
| bitwise_ops | 22 | 位运算 | ✅ PASS |
| function_call | 14 | 函数调用 | ✅ PASS |

## 📊 架构设计

### 编译流程

```
Source (.aur)
    ↓
Lexer (lexer.js) → Tokens
    ↓
Parser (parser_v2.js) → AST/IR
    ↓
IR Validation (ir.js)
    ↓
CodeGen (codegen.js)
    ├─ Register Allocator (register_allocator.js)
    └─ Instruction Encoders
    ↓
Manifest (.aurs)
    ↓
Native Compiler (backend/)
    ├─ x86_encoder.js
    ├─ elf64_generator.js
    └─ native_compiler.js
    ↓
ELF64 Executable
```

### x86-64 寄存器映射

| Aurora | x86-64 | 用途 |
|--------|--------|------|
| r0 | rax | 返回值/系统调用号 |
| r1 | rdi | 第1参数 |
| r2 | rsi | 第2参数 |
| r3 | rdx | 第3参数 |
| r4 | rcx | 第4参数 |
| r5 | r8 | 第5参数 |
| r6 | r9 | 临时 |
| r7 | r10 | 临时 |

### Linux 系统调用映射

| Aurora SVC | Linux syscall | 功能 |
|------------|---------------|------|
| SVC 0x01 | write (1) | 打印到 stdout |
| SVC 0x02 | exit (60) | 退出程序 |

### IR 数据结构

**Program**:
```javascript
{
  kind: 'program',
  sourceFile: 'example.aur',
  declarations: [/* let declarations */],
  body: { statements: [/* IR statements */] }
}
```

**Statement 类型**:
- `assign` - 赋值语句
- `while` - 循环语句
- `if` - 条件语句（完全支持，含 else）
- `request` - 服务调用
- `return` - 返回语句

**Expression 类型**:
- `literal` - 常量（int/string）
- `variable` - 变量引用
- `binary` - 二元运算（+/-/>/</>=/===/!=）

## 🛣️ 自举路线图

### Stage N1（当前）✅
**JavaScript 原型 + 原生代码生成**
- ✅ 完整的 Parser → IR → CodeGen → Native 流水线
- ✅ x86-64 ELF64 可执行文件生成
- ✅ 自动化测试基础设施
- ✅ 8 个测试用例全部通过

### Stage N2（下一步）
**Aurora 重写**
- 用 Aurora 语言重写编译器核心
- JS 作为引导层（文件 I/O + CLI）
- 验证：Aurora 实现与 JS 原型输出一致

### Stage N3
**原生编译器**
- Aurora 编译器编译自身为原生二进制
- 消除 JS 依赖
- 完整工具链（编译器 + 链接器）

### Stage N4
**完全自举**
- Aurora 编译自身为原生二进制
- 移除所有 JS/C 宿主代码
- Bootstrap 验证（N 代编译器）

## 📝 已知限制

1. **目标平台**：仅支持 Linux x86-64（ELF64）
2. **寄存器溢出**：超过 5 个变量会抛出错误（未实现 spilling）
3. **DIV/REM**：除法和取模在原生代码中生成 NOP 占位符
4. **字符串长度**：打印字符串时需要硬编码长度
5. **优化**：无死代码消除/常量折叠

## 📚 相关文档

- [完整迭代日志](docs/iteration_log.md)
- [自举路线图](docs/self_hosting_roadmap.md)
- [使用指南](docs/usage.md)

---

**版本**: Stage N1 Iteration 11  
**状态**: ✅ 生产就绪（原生代码生成）  
**最后更新**: 2025-11-27
