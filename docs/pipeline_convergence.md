# Aurora Pipeline Convergence

我们正在将 AuroraLang 的工具链从分阶段（Stage 0 / N1 等）演进为一条统一的正式流水线。本文档记录现状、目标以及短期行动，帮助团队在过渡期保持一致。

## 现状回顾
- **Legacy 区域**：`src/aurc_native/` 的 C 实现与 `tools/aurc_mvp.py`（Python）承担了 Stage 0 / MVP 时期的解析、指令编码和 manifest 输出。这些模块会继续保留，以便兼容已有示例，但不再新增功能。
- **目标区域**：新的流水线将集中在 `pipeline/` 目录内，由 Aurora 自身或极少量辅助脚本完成 `.aur` → `.aurs`（以及未来的更高层格式）转换。
- **文档状态**：`docs/manual_compilation_walkthrough.md` 等文章仍描述 legacy 流程，但已标明“legacy”并指向本计划；今后所有官方文档将统一到新流水线。

## 统一流水线目标
1. **Aurora 驱动的编译流程**：实现完全由 Aurora 或轻量脚本驱动的解析/IR/编码逻辑，无需依赖 C 或 Python。
2. **统一的目录与命名**：使用 `pipeline/` 表示目标流水线，`legacy/`（或明确标记的目录）表示旧实现，避免 Stage N 的编号困扰。
3. **完善的示例和验证**：所有示例都在 `pipeline/examples/` 下维护，并提供脚本验证与 legacy 输出一致。
4. **渐进式迁移**：迁移过程中保持 legacy 可用，直到新的流水线完全成熟；届时考虑归档或移除旧实现。

## 近期行动计划
1. **文档同步**
   - 更新 README、指南和教程，全部指向 `pipeline/`。 legacy 文档加注释说明仅供参考。
   - 为统一流水线撰写新的开发者指南与使用说明（将放在 `pipeline/docs/`）。
2. **仓库结构整理**
   - 规划将 `src/aurc_native` 挪入 `legacy/` 命名空间，避免与新实现并列。
   - 在 `pipeline/` 下初始化必要的子目录（source、examples、tests 等）。
3. **实现 Aurora → Manifest**
   - 设计并实现新的 IR/编码器接口，替换 C/Python 指令打包逻辑。
   - 提供 CLI/脚本（可由 Aurora 或宿主脚本编写），实现 `.aur` → `.aurs`。
4. **示例迁移与验证**
   - 以 `hello_world`、`loop_sum` 为起点，迁移示例并输出 manifest。
   - 写入自动化验证（diff 或 tests），确保新流水线与 legacy 产物一致。
5. **Legacy 收尾**
   - 清理 `aurc-native` 的功能范围（例如移除 `--emit-exe` 默认路径）。
   - 根据需要在 README/CHANGELOG 中记录迁移时间线。

## 建议的迭代方式
- 每完成结构或工具链上的迁移，立即更新文档和脚本，避免“部分迁移”导致困惑。
- 若需要临时依赖 legacy 逻辑，明确标记 TODO 并在 issue/PR 中跟踪。
- 迁移告一段落后，考虑将 legacy 模块压缩为独立的 `legacy/` 目录或单独仓库，以保持主线整洁。

本文件将持续更新，直至统一流水线完全替换 legacy。若有新的决策或阻塞，请追加到此处。