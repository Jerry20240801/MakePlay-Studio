# 009 · 2026-11-13 · P13 创作工作台与故障闭环

## 这轮做了什么

按《造玩工坊_V2_创作工作台与故障闭环方案.md》把主流程从“类编辑器 + 聊天框”改成“创作工作台”：

- **首页重做**：一句话输入 + “开始创作” + 类型选择；5 个可玩模板卡；我的作品；单一 AI 状态入口。首屏不再出现 CDP / Recipe / ContractSet / buildId。
- **工作台三栏**：左任务线（ThreadSidebar）、中央游戏预览与对话（data-testid `game-preview` / `conversation` / `conversation-input`）、右证据抽屉（改动/验证/底线/版本/素材，默认折叠）。1280×800 下游戏与对话输入同屏；≤1100px 左右抽屉。
- **任务编译器**：`apps/server/src/task-brief.ts` 纯函数，生成 TaskBrief（kind/goal/pack/baseVersionId/protectedContracts/allowedOps/evidenceRefs/userConstraints/acceptance）。服务端重新计算可信字段，只接受用户改 goal/constraints/targetRefs；`task-brief.json` 落盘。
- **首次生成**：`POST /api/projects` 有 idea 且模型已配置时自动启动 `initial_generation`；未配置时返回 `MODEL_NOT_CONFIGURED`，工作台显示“尚未生成”三个出口。`prepare_review` 增加门槛：必须有候选、候选 hash 与 base 不同、buildId 匹配、验证 passed、浏览器 playtest ok。
- **新 PatchOp**：`set_player_spawn`、`add_enemy`/`update_enemy`/`update_run`、`add_dialogue_node`/`add_dialogue_choice`/`add_dialogue_ending`/`set_start_node`。仍无 replace_recipe / eval / 任意 JS。
- **Issue 闭环**：`apps/server/src/issues.ts` + `/issues` API；验证失败自动 upsert（同 version+build+check 不重复）；问题条支持让 AI 修复 / 查看为什么 / 回退；修复终态由 `evaluateIssueAfterRun` 判定：同一批 check 全 passed 且候选 report passed 才 resolved，用户口述问题只能 awaiting_review。
- **线程与恢复**：RunRecord 增加 kind/threadId/parentRunId/issueId/brief；`run.json`/`task-brief.json` 落盘；`RunManager.hydrate()` 启动时恢复摘要，未终态标记 cancelled/interrupted，不自动重放工具。
- **最近操作**：runtime 的 TestBridge 增加 `getRecentActions`，内存保留最近 50 条，不写导出包；工作台报告问题时附上。

## 验证（2026-11-13 17:22）

`node scripts/verify.mjs`（Playwright 自行启动本机 Edge，无需 ZAOWAN_CDP_URL）：

    typecheck     79 files passed
    lint          92 files passed
    unit          73 passed
    integration   25 passed
    security      5 passed
    build         web / player / server
    e2e           14 passed（既有 9 + P13 5）
    验证结果：通过

P13 新增测试：task-brief 10、agent-ops 7、issues 7、threads 3、e2e 5、真实模型 2。
证据：`docs/competition/evidence/creation-flow-2026-11-13/`（home、workbench-1280、issue-fix、initial-generation[**demo**]）。

## 真实模型证据（2026-11-13 17:53–17:57）

- 模型：`Qwen/Qwen3.8-Flash-Next`（OpenAI 兼容端点）。
- 首次生成：7 次请求 / 4554 tokens，候选 v2，4 项检查 passed，浏览器 `won`，`ready_for_review`。
- Issue 修复：6 次请求 / 4446 tokens，候选 v3，同一批 8 项检查全 passed，两个问题单 `resolved`，浏览器 `won`。
- 证据：`docs/competition/evidence/p13-real-model-2026-11-13/`；测试：`tests/model-run/p13-real-model.test.ts`。
- 调试共 30 次模型请求（含一次失败的首次生成）；失败暴露了 `add_entity` 字段靠猜的问题，随后补了 `inspect_project.entityTemplates` 与字段级校验错误，第二次 7 次请求收敛。

## 仍未完成

1. 1024 宽仅有手动实测，未加自动化断言。
2. 3 分钟演示与新手可用性测试未执行。
3. 历史 `real-model-2026-11-13/` 目录缺本轮格式的 run.json 摘要。

## 排障备注

- 卡牌 e2e 曾在共享 CDP 浏览器下长时间等待点击；已给卡牌点击加 3s 超时与 90s 循环上限，并用 Playwright 自启动浏览器复跑 14/14。
- `scripts/verify.mjs` 不再强制要求 ZAOWAN_CDP_URL；设置该变量仍可复用外部浏览器。
- 真实模型第一次生成卡在 `add_entity` 的字段猜测上；`inspect_project` 现在返回完整实体模板，`add_entity` 用 `GridEntityZ` 做字段级校验并给出可读错误。
- 修复回归会同时处理同一候选覆盖的多个问题单（不只关联的那一个），避免 UI 残留“已复现”的旧问题。
