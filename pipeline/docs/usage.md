# Pipeline Usage (Draft)

统一流水线的 CLI 原型已经可以输出 Stage 0 字符串示例（如 `hello_world`）。后续迭代会逐步扩展语法覆盖面。

```bash
# 构建 manifest（需 Node.js 环境）
node pipeline/src/pipeline_driver.js compile pipeline/examples/hello_world.aur -o build/hello_world.aurs

# 对照 legacy 产物（开发期验证用）
diff build/hello_world.aurs pipeline/examples/hello_world_expected.aurs
```

目前实现仅覆盖字符串打印示例；`pipeline/examples/*_expected.aurs` 仍可用于核对 legacy 输出。
