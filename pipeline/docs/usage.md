# Pipeline Usage

统一流水线的 CLI 原型已经可以输出 Stage 0 字符串示例和算术循环程序。

## 当前支持的程序类型

### 1. 字符串打印程序 (`hello_world`)
```bash
node pipeline/src/pipeline_driver.js compile pipeline/examples/hello_world.aur -o build/hello_world.aurs
```

### 2. 算术循环程序 (`loop_sum`)
```bash
node pipeline/src/pipeline_driver.js compile pipeline/examples/loop_sum.aur -o build/loop_sum.aurs
```

## 验证生成结果
```bash
# 对照 legacy 产物（开发期验证用）
fc.exe "build/hello_world_generated.aurs" "pipeline/examples/hello_world_expected.aurs"
fc.exe "build/loop_sum_generated.aurs" "pipeline/examples/loop_sum_expected.aurs"

# 或使用 PowerShell 对比指令字节
Select-String -Path "build/loop_sum_generated.aurs" -Pattern "^bytes"
```

## 支持的语法
- `let <name>: string = "...";` - 字符串字面量
- `let <name>: int = <value>;` - 整型变量
- `while <counter> > 0 { ... }` - 固定条件循环
- `<var> = <var> + <var>;` - 算术加法赋值
- `<var> = <var> - 1;` - 计数器递减
- `request service print(<var>);` - 输出服务
- `request service exit(<value>);` - 退出服务
- `return <value>;` - 函数返回

## 当前限制
- 循环条件固定为 `> 0`
- 仅支持单个累加器和单个计数器
- 变量作用域和类型检查尚未实现
- 不支持嵌套控制流或函数定义

后续迭代会逐步扩展语法覆盖面。
