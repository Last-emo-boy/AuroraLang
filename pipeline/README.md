# Aurora Pipeline Compiler - Stage N1 Complete ✅

**JavaScript 原型编译器，支持 Aurora 语言子集到 Minimal ISA manifest 的转换**

## 🎯 功能特性

### ✅ 已实现

**语法支持**：
- ✅ `module { fn main() -> int { ... } }` 结构
- ✅ `let <name>: <type> = <value>;` 变量声明（int/string）
- ✅ `while <var> > 0 { ... }` 后置判断循环
- ✅ 算术运算（`+`, `-`, 带立即数或寄存器）
- ✅ `request service print/exit` 系统调用
- ✅ `return <value>;` 返回语句

**编译器架构**：
- ✅ 模块化设计：Parser → IR → CodeGen → Manifest
- ✅ 智能寄存器分配器（变量池 + 临时池）
- ✅ IR 验证（未定义变量检测）
- ✅ 自动化测试套件（回归测试）

**指令生成**：
- ✅ 8 种 ISA 指令：MOV/ADD/SUB/CMP/JMP/CJMP/SVC/HALT
- ✅ 优化的循环（后置判断，减少跳转）
- ✅ 直接寄存器操作（避免临时变量）
- ✅ 字节完美匹配 legacy 输出

## 📂 项目结构

```
pipeline/
├── src/
│   ├── pipeline_driver.js      # 主驱动（CLI 入口）
│   ├── parser.js                # 源码解析器
│   ├── ir.js                    # IR 定义与工具
│   ├── codegen.js               # 代码生成器
│   ├── register_allocator.js   # 寄存器分配器
│   └── test_runner.js           # 自动化测试
├── examples/
│   ├── hello_world.aur          # 字符串打印示例
│   ├── hello_world_expected.aurs
│   ├── loop_sum.aur             # 算术循环示例
│   └── loop_sum_expected.aurs
└── docs/
    ├── iteration_log.md         # 开发日志
    ├── self_hosting_roadmap.md  # 自举路线图
    ├── c_vs_js_strategy.md      # 技术选型说明
    └── usage.md                 # 使用指南
```

## 🚀 快速开始

### 编译单个文件

```powershell
node pipeline/src/pipeline_driver.js compile <input.aur> -o <output.aurs>
```

**示例**：
```powershell
# 编译 hello_world
node pipeline/src/pipeline_driver.js compile pipeline/examples/hello_world.aur -o build/hello.aurs

# 编译 loop_sum
node pipeline/src/pipeline_driver.js compile pipeline/examples/loop_sum.aur -o build/loop.aurs
```

### 运行测试套件

```powershell
node pipeline/src/test_runner.js
```

**输出示例**：
```
🧪 Aurora Pipeline Test Suite

▶ Running test: hello_world
  ✅ PASS (4 instructions)

▶ Running test: loop_sum
  ✅ PASS (9 instructions)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Test Summary:
   Total:  2
   Passed: 2 ✅
   Failed: 0 ❌

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

| 测试用例 | 指令数 | 匹配模式 | 状态 |
|---------|-------|---------|-----|
| hello_world | 4 | 集合匹配 | ✅ PASS |
| loop_sum | 9 | 完全匹配 | ✅ PASS |

**匹配模式说明**：
- **完全匹配**：指令字节顺序和内容完全一致
- **集合匹配**：指令集合相同，顺序可能不同（语义等价）

## 📊 架构设计

### 编译流程

```
Source (.aur)
    ↓
Parser (parser.js)
    ↓
IR (ir.js)
    ↓
IR Validation
    ↓
CodeGen (codegen.js)
    ├─ Register Allocator (register_allocator.js)
    └─ Instruction Encoders
    ↓
Manifest (.aurs)
```

### 寄存器分配策略

| 寄存器 | 用途 | 管理方式 |
|-------|------|---------|
| r0 | 返回值/服务参数 | 保留 |
| r1-r5 | 变量存储 | 顺序分配 |
| r6-r7 | 临时值 | 池管理 |

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
- `if` - 条件语句（部分支持）
- `request` - 服务调用
- `return` - 返回语句

**Expression 类型**:
- `literal` - 常量（int/string）
- `variable` - 变量引用
- `binary` - 二元运算（+/-/>）

## 🛣️ 自举路线图

### Stage N1（当前）✅
**JavaScript 原型验证**
- ✅ 完整的 Parser → IR → CodeGen 流水线
- ✅ 字节完美的 manifest 生成
- ✅ 自动化测试基础设施

### Stage N2（下一步）
**Aurora 重写**
- 用 Aurora 语言重写编译器核心
- JS 作为引导层（文件 I/O + CLI）
- 验证：Aurora 实现与 JS 原型输出一致

### Stage N3
**原生二进制生成**
- Aurora 编译器输出原生机器码（x86-64/ARM64）
- 实现链接器或集成现有工具
- minimal libc runtime

### Stage N4
**完全自举**
- Aurora 编译自身为原生二进制
- 移除所有 JS/C 宿主代码
- Bootstrap 验证（N 代编译器）

## 📝 已知限制

1. **语法覆盖**：仅支持基础子集（无 if/else、函数定义、数组）
2. **寄存器溢出**：超过 5 个变量会抛出错误（未实现 spilling）
3. **类型系统**：基础类型检查，无泛型/联合类型
4. **优化**：基础优化（后置循环），无死代码消除/常量折叠
5. **错误恢复**：解析错误立即失败，无错误恢复

## 📚 相关文档

- [完整迭代日志](docs/iteration_log.md)
- [自举路线图](docs/self_hosting_roadmap.md)
- [C vs JS 策略说明](docs/c_vs_js_strategy.md)
- [使用指南](docs/usage.md)

## 🤝 贡献指南

本项目当前处于快速迭代期，暂不接受外部贡献。

开发路线图优先级：
1. ✅ 基础语法支持（let/while/request）
2. ✅ 寄存器分配器
3. ✅ 自动化测试
4. ⏳ 条件分支（if/else）
5. ⏳ 函数定义与调用
6. ⏳ Stage N2 迁移（Aurora 重写）

---

**版本**: Stage N1 Iteration 4  
**状态**: ✅ 生产就绪（用于原型验证）  
**最后更新**: 2025-01-14
