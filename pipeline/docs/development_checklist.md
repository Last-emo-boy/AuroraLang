# Pipeline Development Checklist

## 启动阶段
- [ ] 定义统一流水线的目标与范围（参见 `docs/pipeline_convergence.md`）。
- [ ] 确认 legacy 依赖（`src/aurc_native`、`tools/aurc_mvp.py`）的保留策略。

## 编译器实现
- [ ] 设计 Aurora 侧的数据结构表示指令（opcode、操作数、注释）。
- [ ] 实现 manifest emitter（参考 `pipeline/src/manifest_emitter.guidelines.md`）。
- [ ] 实现 `.aur` → IR 的解析与 lowering。
- [ ] 提供 CLI/脚本，支持 `aurora-pipeline compile <input> -o <output>`。（原型：`pipeline/src/pipeline_driver.js`，目前仅覆盖字符串示例）

## 示例与测试
- [x] 迁移 `hello_world` 示例至 `pipeline/examples/`，并准备 legacy 对照 manifest。
- [x] 迁移 `loop_sum` 示例并准备对照 manifest。
- [ ] 编写自动化比对脚本，验证输出与 legacy manifest 一致。
- [ ] 补充更多测试用例（字符串、算术、条件跳转等）。

## 文档与迁移
- [ ] 在 README 与文档中更新指向统一流水线的信息。
- [ ] 编写新流水线的使用说明 (`pipeline/docs/usage.md`)。
- [ ] 记录迁移进度与决策 (`docs/pipeline_convergence.md` 持续更新)。
- [ ] 规划 legacy 目录的最终存档或移除步骤。

## 收尾
- [ ] 达成与 legacy 完全一致的示例输出。
- [ ] 决定是否将 `aurc-native` 压缩到单独目录（如 `legacy/aurc_native`）。
- [ ] 更新版本说明或发布公告，正式宣布统一流水线可用。
