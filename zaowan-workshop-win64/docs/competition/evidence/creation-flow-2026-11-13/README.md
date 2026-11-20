# P13/P14/P15 创作主流程与界面证据（2026-11-13）

本目录截图由 `tests/e2e/browser.test.ts` 的真实浏览器测试生成（Playwright + 本机 Edge 无头，未设置 `ZAOWAN_CDP_URL`），不是手工摆拍或设计稿。

| 文件 | 对应断言 | 说明 |
|---|---|---|
| `home.png` | “opens a template within two clicks and keeps the game playable” | 新首页：左侧工程栏 + 一句话输入 + 开始创作 + 5 个可玩模板 + 单一 AI 状态入口，不出现 CDP / Recipe / ContractSet / buildId |
| `projects-sidebar.png` | “shows the project sidebar on home and creates a new game from it” | P14 工程左栏：工程列表 + “新建游戏”；点击后进入新的“未命名游戏”工作台 |
| `workbench-1280.png` | “keeps the game preview and the conversation on screen at 1280x800” | 1280×800 下 `game-preview` 与 `conversation` / `conversation-input` 同屏且无横向滚动；左栏为工程 + 会话与“新建会话” |
| `home-light.png` | “toggles the light theme on home and persists it across reloads” | 浅色主题首页（默认）；切到深色后刷新仍保持 |
| `home-light.png` | 同上 | 浅色主题首页；html[data-theme=light]，刷新后保持 |
| `workbench-dark.png` | “keeps both themes scroll-free and persists a dragged game/conversation split” | 深色工作台，工程/会话左栏、游戏与对话 |
| `workbench-light.png` | 同上 | 浅色工作台；游戏画面保持固定深色 |
| `workbench-resized.png` | 同上 | 向上拖动 `split-game` 后对话变大、输入框仍可见；尺寸写入 localStorage |
| `issue-fix.png` | “shows an issue banner, previews the repair brief and rolls back without deleting evidence” | 回归夹具验证失败 → 问题条（让 AI 修复 / 回退）→ 修复任务编译卡（含失败检查）→ 回退到 v1 且证据保留 |
| `initial-generation.png` | “captures a demo initial generation run on the workbench” | **demo 示例回放**：`POST /api/projects { idea, autoGenerate: 'demo' }`；不是 `mode:'model'`，真实首次生成见 `../p13-real-model-2026-11-13/` |

## 真实模型边界

- 本目录的 `initial-generation.png` 是 **demo 工作台截图**，只证明界面能显示任务卡与运行，不证明真实模型能力。
- P13 真实模型首次生成与 Issue 修复证据已补齐：[p13-real-model-2026-11-13](../p13-real-model-2026-11-13/README.md)（首次生成 7 请求 / 4554 tokens；Issue 修复 6 请求 / 4446 tokens，同一批 8 项检查回归通过）。
- 既有 P6/P11 真实模型证据在 `docs/competition/evidence/real-model-2026-11-13/` 与 `ai-presence-2026-11-13/guidance-run/`，不能替代 P13 证据。

## 对应测试结果

`node scripts/test.mjs e2e`：22 passed / 0 failed（含 P13/P14/P15 与 P16 体检、toast、缩放、三档审查；P16 截图在 ../experience-polish-2026-11-14/）。

截图可重复生成：运行上述命令后会自动覆盖本目录十个文件（含 `home-dark/light.png`、`workbench-dark/light/resized.png` 与 `projects-sidebar.png`）。
