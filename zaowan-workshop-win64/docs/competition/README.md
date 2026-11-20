# 参赛材料导航

本目录存放可核对的证据与比赛材料。文字说明以 [../competition.md](../competition.md) 为主，状态以 [../implementation-status.md](../implementation-status.md) 为准。

## 证据目录

| 目录 | 内容 | 性质 |
|---|---|---|
| [real-model-2026-11-13](evidence/real-model-2026-11-13/) | 真实模型修复：6 次响应、3262 tokens、8 项检查 passed、浏览器真实键盘 14 步通关 | `mode:'model'`，非 demo；历史目录缺 `run.json` 与 README |
| [ai-presence-2026-11-13](evidence/ai-presence-2026-11-13/) | AI 在场感：时间线、concern 截图、真实模型插话（7 次请求、3812 tokens） | `mode:'model'`，非 demo |
| [mode-packs-2026-11-13](evidence/mode-packs-2026-11-13/) | 对话叙事包真实键盘通关截图 | 浏览器 E2E 证据 |
| [creation-flow-2026-11-13](evidence/creation-flow-2026-11-13/) | P13/P14/P15：首页+工程左栏、1280×800 同屏、Issue 修复卡+回退、深浅主题、拖拽分栏 | 真实浏览器 e2e；首次生成为 demo，非 model |
| [p13-real-model-2026-11-13](evidence/p13-real-model-2026-11-13/) | P13 真实模型首次生成 + Issue 修复回归 | `mode:'model'`，非 demo；7 请求 / 4554 tokens 与 6 请求 / 4446 tokens |
| [blind-repair-2026-11-13](evidence/blind-repair-2026-11-13/) | 真实模型盲修：任务拆解、执行反馈修复、浏览器通关 | `mode:'model'`；8 请求 / 5730 tokens |
| [algorithm-fix-2026-11-13](evidence/algorithm-fix-2026-11-13/) | 29 条本地规则、6 条一键修复；同一关卡 0 次模型调用 | 本地算法，非模型 |
| [experience-polish-2026-11-14](evidence/experience-polish-2026-11-14/) | 三档审查、toast、画面缩放、素材背景、对话表现层截图 | e2e 真实浏览器；其中云端审查为替身模型（真实审查见 cloud-review-2026-11-15） |
| [ablation-2026-11-15](evidence/ablation-2026-11-15/) | 单夹具消融：算法优先 ×3 = 0 次调用；纯 AI ×1 = 8 次请求、ready_for_review | results.json 为真实 API 输出；AI 臂用时作废（轮询上限），见 README 勘误 |
| [cloud-review-2026-11-15](evidence/cloud-review-2026-11-15/) | 真实云端审查成功：1 次请求 / 2522 tokens，结论正确且不含补丁 | review.json + model-usage（真实模型，非替身） |
| [demo-video-2026-11-15](evidence/demo-video-2026-11-15/) | 3 分钟演示录屏 demo-3min.webm（真实 UI 录制） | 片内 AI 段=示例回放标注 |
| [long-samples-2026-11-14](evidence/long-samples-2026-11-14/) | 加长样例的“verifier 反馈→修改”记录、导出包真实运行截图 | 三个新样例 verifier passed；导出包用包内 server.mjs 实跑，素材 200、无控制台错误 |
| bench-<日期>（运行 `pnpm bench` 生成） | 5 个缺陷夹具 × 算法 / 算法优先+AI / 纯 AI × 重复，成功率、请求数、tokens、修复轮次 | 算法臂可离线复现；AI 臂需真实模型，未提供 Key 时只记 skipped |

以上目录中，标“真实模型”的均为 `Qwen/Qwen3.8-Flash-Next` 单模型小样本，不代表成功率。`creation-flow-2026-11-13/initial-generation.png` 是 demo 工作台截图，真实首次生成证据看 `p13-real-model-2026-11-13/`；3 分钟录屏中的 AI 段为示例回放并在片内标注。

## 与 DSH / Godot 类工具的差异（方案 §7）

统一回答，不逐条自夸，也不提多 Agent 分工：

> DSH 一类产品是在通用游戏引擎里提供 AI 助手；造玩工坊把小型游戏限制在可验证的玩法配方上，让 AI 的每次修改都能变成结构化 diff，受用户确认的创作底线约束，再由规则内核和真实浏览器给出证据。出现问题时，同一个失败检查和操作序列会成为修复任务的输入与回归门槛，而不是让 AI 再猜一次。

界面上必须能看到的四个证据：

1. **发送前**：任务编译卡说明 AI 将基于哪个版本、哪些证据、不能碰什么。
2. **修改中**：每个工具步骤对应真实配方 diff，不是泛化聊天。
3. **修改后**：机器通过与 AI 自述分栏，冲突会标 concern。
4. **出问题时**：同一 Issue 串起复现、修复运行、候选版本与回归证据。

> 如果这四条没进入主路径，即使后端再强，评委也只会看到一个普通编辑器。

说明：以上是差异化表述，不是功能完成声明。P13 主流程进度见 [../implementation-status.md](../implementation-status.md)；我们不宣称多 Agent 协作、通用引擎或任意代码生成能力。

## 不能宣称的内容

- 不宣称“一句话生成任意游戏”。
- 不宣称题目事实正确、卡牌平衡或游戏好玩已被自动验证。
- 不宣称五个模式包共用同一套玩法内核。
- 不宣称在干净机、他人机器或断网环境下完成浏览器与真实模型验证。
- 不把 P13 的 demo 回放或旧轮证据当作 P13 真实模型验收。
