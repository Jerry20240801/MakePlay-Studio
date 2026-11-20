# V2 创作工作台与故障闭环：实施契约（P13）

> 本文件是 P13 的工程契约，供实现者与评审共用。它只规定**接口、字段、文件归属与验收**，不替代《造玩工坊_V2_创作工作台与故障闭环方案.md》。
> 所有实现必须保持既有零重型依赖、TS strict、本地优先、证据落盘原则。

## 1. 文件归属（写入范围，避免并发冲突）

| 角色 | 只允许修改 |
|---|---|
| web-ui | `apps/web/**`、`packages/runtime/**` |
| server-core | `apps/server/src/agent.ts`、`agent-tools.ts`、`storage.ts`、`task-brief.ts`、`threads.ts` |
| server-routes | `apps/server/src/app.ts`、`issues.ts` |
| qa-docs | `tests/**`、`docs/**`、`README.md`（不要改本文件） |
| Lead | 集成修复、`docs/v2-implementation-contract.md`、最终证据 |

共享契约：`apps/server/src/task-brief.ts` 由 server-core 实现，server-routes 只能 import 使用；`apps/server/src/issues.ts` 由 server-routes 实现，server-core 只能 import 使用。

## 2. 类型契约

```ts
// apps/server/src/task-brief.ts
export type TaskKind = 'initial_generation' | 'modify' | 'repair' | 'explain';
export interface EvidenceRefs {
  verificationId?: string;
  failedCheckIds?: string[];
  playtestPath?: string;
  consoleErrors?: string[];
  recentActions?: unknown[];
  screenshotPath?: string;
}
export interface TaskBrief {
  compilerVersion: 1;
  id: string;
  kind: TaskKind;
  rawText: string;
  goal: string;
  packId: 'puzzle' | 'stealth' | 'quiz' | 'card' | 'dialogue';
  baseVersionId: string;
  threadId: string | null;
  parentRunId: string | null;
  issueId: string | null;
  targetRefs: string[];
  protectedContracts: { id: string; description: string }[];
  allowedOps: string[];
  evidenceRefs: EvidenceRefs;
  userConstraints: string[];
  acceptance: string[];
  support: 'supported' | 'partially_supported';
  supportNote?: string;
}
```

`compileTaskBrief` 是**纯函数、不调用模型、确定性**。输入：

```ts
export interface CompileInput {
  rawText: string;
  kind: TaskKind;
  packId: TaskBrief['packId'];
  baseVersionId: string;
  issue?: GameIssue | null;
  lastVerification?: { verificationId?: string; checks: { id: string; status: string; detail?: string }[] } | null;
  contracts: { entries: { id: string; description: string; verificationMode: string }[] };
  threadId?: string | null;
  parentRunId?: string | null;
  goal?: string;                 // 用户可编辑覆盖
  userConstraints?: string[];    // 用户可编辑覆盖
  targetRefs?: string[];
}
export function compileTaskBrief(input: CompileInput): TaskBrief;
export function renderBriefPrompt(brief: TaskBrief): string; // 供 agent 组装 user message
export function allowedOpsFor(packId: TaskBrief['packId'], kind: TaskKind): string[];
```

规则：
- `kind` 由调用入口决定，**不靠关键词猜**。
- `goal` 默认取 rawText 清理后文本：去首尾空白、压缩连续空白、去掉开头的“帮我/请/我想/麻烦”等，最多 160 字；显式传入的 `goal` 优先。
- `userConstraints`：显式传入 + 从 rawText 中按句提取含“不要/不许/别动/保持/不能改/必须保留”的短句，去重，最多 8 条。
- `protectedContracts`：取已确认契约 entries 的前 6 条（未确认也列出，但 description 前加“（待确认）”）。
- `evidenceRefs`：issue 有 reproduction 时填入 verificationId/failedCheckIds/consoleErrors/recentActions；lastVerification 的 failed checks 填入 failedCheckIds。
- `acceptance` 按 kind 固定生成（见 §5），不调模型。
- `allowedOps` 见 §4。
- `support` 恒为 supported；若 issue 的 checkIds 含未知检查前缀，则 partially_supported 并给 supportNote。

## 3. HTTP API（server-routes）

所有错误沿用 `{ ok:false, error:{ code, message } }` 与现有 statusFor。

### 3.1 TaskBrief 预览
`POST /api/projects/:id/task-briefs/preview`
body：`{ instruction: string, kind?: TaskKind, issueId?: string, baseVersionId?: string, goal?: string, userConstraints?: string[], targetRefs?: string[] }`
- 服务端校验项目、issue、baseVersionId；**重新计算** packId/baseVersionId/contracts/allowedOps/evidenceRefs/acceptance。
- 只接受用户可编辑字段：goal/userConstraints/targetRefs。
- 返回 `{ ok:true, brief }`。

### 3.2 Run 创建（扩展，向后兼容）
`POST /api/projects/:id/runs`
body：`{ instruction, mode: 'demo'|'model', kind?, issueId?, threadId?, parentRunId?, goal?, userConstraints?, targetRefs? }`
- 旧 body 仍可用；kind 缺省时：有 issueId → repair；否则 modify。
- 服务端编译 brief，忽略客户端传来的任何“可信字段”。
- `runs.start(projectId, instruction, mode, options)`，options 类型：
```ts
interface StartRunOptions {
  brief?: TaskBrief;         // 仅服务端内部传入；若缺省由 RunManager 调 compileTaskBrief
  kind?: TaskKind;
  issueId?: string | null;
  threadId?: string | null;
  parentRunId?: string | null;
}
```
- 有 issueId 时把 issue 状态设为 `fixing` 并 push linkedRunIds。
- 返回 `{ ok:true, run }`，run 增加 §3.5 字段。

### 3.3 Issue
- `GET /api/projects/:id/issues` → `{ ok:true, issues: GameIssue[], latestPlayableVersionId: string }`
- `POST /api/projects/:id/issues` body `{ title, description?, versionId?, userSteps?, recentActions?, consoleErrors?, checkIds? }` → 创建 source='user' 的 issue。
  - checkIds 非空 → status='reproduced'
  - 否则 userSteps/recentActions 非空 → status='open'（待复现，不得自动 resolved）
  - 都没有 → status='cannot_reproduce'，message 提示补充步骤。
- `POST /api/projects/:id/issues/:issueId/dismiss` → status='dismissed'
- `POST /api/projects/:id/issues/:issueId/confirm` body `{ resolved: boolean, note?: string }` → awaiting_review 的人工确认；resolved=true → resolved，false → open。
- 验证失败后服务端自动 upsert issue：同一 `versionId + buildId + checkId` 不重复；source='verification'；status='reproduced'；title 用人话（检查 title 或“规则检查未通过”）；reproduction.verificationId/actions 落盘。
- Run 终态且 issueId 非空时调用 `evaluateIssueAfterRun(storage, issueId, run)`（issues.ts 导出，server-core 在 agent.ts 调用）：
  - 有 checkIds 且候选 report.status==='passed' 且所有 checkIds 均 passed → resolved，requiresUserReview=false。
  - 用户口述 issue（无 checkIds）→ awaiting_review，requiresUserReview=true。
  - 其余 → 回 open，不谎称修好。

### 3.4 线程
- `GET /api/projects/:id/threads` → `{ ok:true, threads: ThreadSummary[] }`
```ts
interface ThreadSummary {
  id: string; title: string; latestRunId: string; latestStatus: string;
  latestAt: string; runIds: string[]; issueId: string | null;
  candidateVersionId: string | null; demo: boolean;
}
```
- 由 runs 派生，按最近活动倒序；title 取 thread 首个 run 的 instruction 前 40 字。
- `GET /api/projects/:id` 的 runs 字段改为返回**最近 20 个 run 摘要**（含 threadId/kind/issueId），不再只 5 个。events 仍只在 `GET /api/runs/:id` 返回。

### 3.5 Run 字段扩展
`PublicRun` 与 `RunRecord` 增加：
```ts
threadId: string;
parentRunId: string | null;
kind: TaskKind;
issueId: string | null;
brief: TaskBrief;          // RunRecord 保存完整 brief；PublicRun 可返回完整对象
```
持久化：`runs/<runId>/run.json` 必须含 id/projectId/instruction/mode/status/kind/threadId/parentRunId/issueId/baseVersionId/candidateVersionId/createdAt/updatedAt/error/concerns/guidanceCount/demo/interrupted；事件仍写 events.jsonl。另写 `task-brief.json`（brief + compilerVersion）。

### 3.6 重启恢复
`RunManager` 提供 `async hydrate(): Promise<void>`：
- 扫描 storage 所有项目的 runs/*/run.json，重建内存摘要（不需要 events）。
- 未终态（pending statuses）标 `cancelled` + `interrupted:true` + error='服务重启，未继续执行'，**不得自动重放工具**。
- `createServer` 启动时 await hydrate()。
- `listRuns` 返回内存摘要（含已恢复的），不读 events。

### 3.7 首次生成自动启动
`POST /api/projects` 保持兼容，响应增加 `generation`：
```ts
generation?: {
  requested: boolean;         // body.idea 非空
  started: boolean;
  runId?: string;
  mode: 'model';
  reason?: 'MODEL_NOT_CONFIGURED' | 'MODEL_START_FAILED';
  message?: string;
}
```
- `body.idea` 非空且模型已配置：创建项目后立即 `runs.start(..., 'model', { kind:'initial_generation', threadId:'thread-<8位>' })`，返回 runId。
- 模型未配置：不启动，reason=MODEL_NOT_CONFIGURED，绝不把骨架说成已生成。
- 模板/示例创建不自动生成。
- 集成测试可用 `body.autoGenerate === 'demo'` 触发 demo 首次生成（仅测试/演示用途，健康响应与 UI 不暴露）。

## 4. 新增 PatchOp（server-core，agent-tools.ts）

`PatchOpSchema` 增加，applyPatch 实现，全部走 parseRecipe+validateRecipe+契约检查：

- 网格：`set_player_spawn { spawn: {x,y} }`
- 卡牌：`add_enemy { enemy }`、`update_enemy { enemyId, changes }`、`update_run { changes }`
- 对话：`add_dialogue_node { node }`、`add_dialogue_choice { nodeId, choice }`、`add_dialogue_ending { ending }`、`set_start_node { nodeId }`

要求：新增/更新后 parseRecipe 必须通过；对话 choice 必须挂到存在的 node 且 choice.id 唯一；set_start_node 必须指向存在的 node；禁止 replace_recipe/eval/任意 JS。
`TOOL_DEFINITIONS` 的 apply_recipe_patch description 同步列出新 op。

`allowedOpsFor`：
- puzzle/stealth：set_tile/move_entity/add_entity/update_entity/remove_entity/add_rule/update_rule/remove_rule/update_goal/update_presentation/set_player_spawn/update_meta
- quiz：add_quiz_question/update_quiz_question/update_quiz_answer/update_meta
- card：add_card/update_card/set_deck/add_enemy/update_enemy/update_run/update_meta
- dialogue：add_dialogue_node/add_dialogue_choice/add_dialogue_ending/set_start_node/update_dialogue_node/update_dialogue_choice/update_dialogue_ending/update_meta

## 5. 首次生成门槛与验收字段

- `prepare_review`：若 `kind==='initial_generation'` 或 `kind==='modify'`，必须满足：
  - `ctx.candidateVersionId !== null`
  - 候选 recipeHash !== 基础版本 recipeHash（非空 diff）
  - lastVerification buildId === 候选 meta.buildId 且 status==='passed'（或时人工项时 partial 不算通过）
  - lastPlaytest.ok === true
  否则返回 PLAYTEST_FAILED，data 里逐项说明（no_candidate/no_diff/build_mismatch/verification/playtest）。
- 首次生成完成后 UI 显示“AI 候选”，不得自动覆盖当前版本。

`acceptance` 固定文案：
- initial_generation：['生成一个可试玩的第一版（必须有非空配方改动）','结构检查与已确认创作底线通过','能力不足的部分在总结里明确说明，不得省略']
- modify：['本次修改形成非空配方 diff','已确认创作底线保持不变','机器检查结果与 AI 自述分开呈现']
- repair：['同一失败检查由失败变为通过','修复候选绑定真实浏览器回放证据','未删除失败证据与历史版本']
- explain：['只读取状态，不修改配方']

## 6. UI 契约（web-ui）

### 6.1 首页
- 首屏：一个 h1 + 一句话输入 + 主按钮“开始创作” + 模式选择（解谜/潜行/知识/卡牌/对话，默认解谜）；一个 AI 状态入口（已连接/未连接 + 设置），不出现 CDP/Recipe/ContractSet/buildId。
- 第二区：5 个可玩模板卡（名称/一句话玩法/操作/“使用模板”），两次点击内可进入且游戏可玩。
- 我的作品：项目名、类型、最近状态、继续创作。
- 文案必须诚实：未连接模型时想法入口明说“不会生成，只能先建骨架或手动编辑”。

### 6.2 工作台
- 固定三列 grid：左线程 240-280px；中间 minmax(0,1fr)；右 300-340px。各列独立滚动。1280×800 下游戏预览与对话输入同屏；<=1100px 左/右变抽屉。
- 中央上方：游戏预览（占主要高度，最小 360px 高）+ 版本切换（当前/AI 候选）；问题条紧贴游戏上方。
- 中央下方：对话线程（消息 + RunTimeline 步骤卡）+ 持续输入框。任务终态时按钮为“继续这个话题”，走新 run 继承 threadId。
- 左栏：任务/对话线程列表（用户第一句话、状态、时间、问题标记），点击切换；不是 run-xxxx 原始列表。
- 右栏：默认折叠；tab=改动/验证/底线/版本/素材；问题或 concern 时自动打开对应项。
- 模板创建后：无自动 run，直接可玩，中央给三个动作（试玩一下 / 让 AI 改一个地方 / 导出游戏）。
- 想法创建后：模型已连接 → 自动 run，显示任务卡（brief：理解为/目标/基于/不会修改/完成标准）与步骤；未连接 → 显示“尚未生成”，给“去连接 AI / 先手动编辑 / 改用可玩模板”三个出口。
- 问题条：只显示最严重一条；文案人话；按钮 [让 AI 修复] [查看为什么] [回到最近可玩版本]；点修复 → 预览 repair brief → 启动 run；查看为什么展开人话原因+技术细节；回退调 rollback，证据保留。
- 错误动作映射：BROWSER_UNAVAILABLE / MODEL_AUTH_FAILED / MODEL_PROTOCOL_UNSUPPORTED / CONTRACT_VIOLATION / BUDGET_EXCEEDED / partial / failed / cannot_reproduce，各有主按钮与次按钮，raw error 折叠。
- 保留 data-testid：run-timeline、guidance-box、ai-banner（可移动到新位置）。新增 data-testid：issue-banner、task-brief-card、thread-sidebar、conversation-input、game-preview、workbench-grid。

### 6.3 最近操作记录
- packages/runtime 的 TestBridge 增加可选 `getRecentActions?: () => unknown[]`，use-game 维护最近 50 个 {action, at, version, status}，不上传、不写导出包。
- 工作台“报告问题”读取 `window.__ZAOWAN_TEST__?.getRecentActions?.()` 附进 issue；没有记录时允许手填步骤。

## 7. 验收与测试

必须新增/更新：
- `tests/unit/task-brief.test.ts`：kind/pack/allowedOps/protectedContracts/evidence/userConstraints/acceptance 确定性与边界。
- `tests/unit/agent-ops.test.ts`：4 类新 op 正常应用 + 非法输入抛错。
- `tests/integration/issues.test.ts`：验证失败自动生成 issue、dismiss、从 issue 启动 repair、同一检查通过后 resolved、用户 issue 只能 awaiting_review。
- `tests/integration/threads.test.ts`：run 持久化、threadId/parentRunId、hydrate 恢复、重启未完成标 interrupted。
- `tests/integration/api.test.ts` 既有断言保持通过（允许同步更新选择器/字段）。
- `tests/e2e/browser.test.ts`：模板两次点击可玩；1280×800 游戏与对话同屏；无模型想法页诚实降级；验证失败 issue 条 → demo 修复 → 同一检查通过 + 回退保留证据；既有 e2e 不删除。

必跑：`pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm test:integration`、`pnpm test:security`、`pnpm build`。E2E 由 Lead 在可用浏览器下跑。

## 8. 诚实边界（不得写进 UI 或文档为已完成）

- world 包未实现；不新增。
- 真实模型证据只认 `mode:'model'`、真实请求、非 demo；本轮若无法配置模型，必须如实写“未重新跑真实模型”。
- 素材图片渲染、工程包导入仍未实现。
- 用户口述 bug 未复现时只能 cannot_reproduce / awaiting_review，不得自动 resolved。
