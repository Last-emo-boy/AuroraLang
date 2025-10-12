# Manifest Emission Guidelines (Draft)

统一流水线要在 Aurora 中实现 minimal ISA manifest 的生成，这里先写下目标和约束，为后续编码做准备。

## 1. 指令打包格式
- 采用 8 字节指令字布局：`[opcode|op0|op1|op2|imm32]`。
- opcode、op0、op1、op2 均为单字节，无符号；`imm32` 为小端 32 位有符号整数。
- 需要保留 `ISA_OPERAND_LABEL = 0xFE`、`ISA_OPERAND_IMMEDIATE = 0xFF` 作为特殊值。

## 2. 支持的指令集合
- `mov`（reg←imm / reg←label / reg←reg）
- `add`、`sub`（reg/reg/imm）
- `cmp`（reg vs imm）
- `cjmp`（条件：eq/ne/lt/le/gt/ge）
- `jmp`（无条件跳转到 label）
- `svc`、`halt`（仍可复用现有 runtime stub）
- 新增指令时需同步更新文档与 encoder。

## 3. 标签与重定位
- Manifest 中仍然使用 `label foo` + `bytes ...` 形式。
- 统一流水线负责在输出时记录 relocation 信息，以便 interpreter/assembler 后续处理。
- 初期可保持与 legacy 相同的语法，后续如需新的语法再另行评估。

## 4. 数据排布
- 字符串等数据段继续使用 `label` + `ascii`/`pad`。
- runtime stub（例如 `__aur_runtime_print_and_exit`）仍然追加在末尾，待未来 runtime 设计完成后再重构。

## 5. 实现建议
- 尽量将指令编码封装成独立的函数/模块，避免分散在各个 lowering 中。
- 输出层面可先对接现有的 `.aurs` 文本格式，暂不引入二进制容器。
- 考虑在 Aurora 侧定义数据结构（记录 opcode、操作数、 immediates、注释），最后统一序列化为 manifest。

该指南会在实现过程中持续更新。
