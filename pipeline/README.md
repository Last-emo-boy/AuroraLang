# Aurora Pipeline

Aurora 的长期目标是提供一条统一的、无需关心阶段命名的编译流水线：从 `.aur` 源文件到可执行形式（manifest 或更高层目标）。本目录将汇集未来的官方实现与示例。

## 目录规划
- `src/`：Aurora 实现的编译器、IR 处理和目标格式输出代码。必要时可使用最少量的宿主语言 glue。
- `examples/`：可直接通过本流水线生成 `.aurs`（或未来其他格式）的示例程序。
- `docs/`：与统一流水线相关的设计、规范与迁移说明。

目录结构会随着实现逐步充实，当前文件仅为入口。

## 当前重点
1. **统一工具链愿景**：逐步弃用 Stage 0/Stage N1 等命名，采用“legacy vs pipeline”区分现状与目标。
2. **最小化 Legacy 依赖**：Stage 0 的 C/Python 工具链保留为 legacy 备份，官方推荐的日常流程将迁移到此目录。
3. **落实 Aurora → Manifest**：在 Aurora 或轻量脚本中实现从源文件到 `minimal_isa` 指令序列的生成，验证并替换旧实现。相关设计草稿见 `src/manifest_emitter.guidelines.md`。
4. **示例与测试迁移**：把 `hello_world`、`loop_sum` 等示例搬迁到新的目录并提供一键生成脚本，同时保持与 legacy 结果的一致性对比。`examples/` 目录已包含迁移的示例与预期 manifest。

最新的使用说明草稿见 `docs/usage.md`（目前 CLI 原型位于 `src/pipeline_driver.js`，仅支持字符串打印示例）。

更多背景与行动计划详见 [`docs/pipeline_convergence.md`](../docs/pipeline_convergence.md)。
