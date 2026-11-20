# 004 · 2026-11-13 验证口径与回放文案修复（审查轮）

## 目标

审查轮发现的四个可信度问题：

1. `reachable_goal` 契约在只做了搜索、未做浏览器真实重放时显示"已通过"。
2. 用户尚未确认的创作底线也显示"已通过"。
3. 示例回放运行失败后，收尾消息仍写"示例回放完成"。
4. 示例回放不响应用户输入，但界面没有说明。

## 实际修改

- `packages/schema/src/event.ts`：`CHECK_STATUSES` 增加 `partial`。
- `packages/verifier/src/checks.ts`：`VerifyOptions.browserReplay`、`OverallStatus` 增加 `partial`；总体状态在存在 partial 且无 failed/blocked/unknown 时为 `partial`。
- `packages/verifier/src/contracts.ts`：`reachable_goal` 搜索通过但未绑定浏览器重放时返回 `partial`，detail 明确写"不能标记为完全通过"；绑定重放证据且终局 won 才 `passed`。
- `apps/server/src/storage.ts`：新增 `recordReplayEvidence` / `getReplayEvidence`（版本目录 `replay-evidence.json`）。
- `apps/server/src/verify-service.ts`：验证时读取回放证据，buildId 匹配且 ok 才把重放绑定进本次验证。
- `apps/server/src/agent-tools.ts`：`run_browser_playtest` 门槛改为拒绝 failed/blocked/unknown（允许 partial）；成功后记录回放证据并刷新 `ctx.lastVerification`，使 `prepare_review` 能正确判定。
- `apps/server/src/agent.ts`：`DemoProvider` 收尾消息改为按运行真实状态生成；失败时写"示例回放结束：本次运行状态为 failed，原因：…"。
- `apps/web/src/workbench.tsx`：`STATUS_LABELS` 增加"部分验证"；未确认契约显示"待确认（自动检查已通过）"；示例回放说明补充"回放使用固定脚本，不会响应你在输入框写的内容"。
- `apps/server/src/app.ts`：静态资源缓存头统一 `no-store`（原 `/assets/` 一年 immutable 但文件名无内容哈希，更新后用户会拿到旧前端）。
- 测试同步：E2E 网格用例改为"先 partial → 真实重放并记录证据 → 再验证 passed"；集成与样例用例按新口径断言。

## 真实证据

- `typecheck` 通过（strict，60 文件）。
- unit 40/40、integration 8/8、security 5/5。
- e2e（CDP 连接本机 Edge）6/6，含"partial → 绑定重放 → passed"的完整链路。
- API 实测：frozen-paws 验证返回 overall=partial，`contract:c-reach` 为 partial 且 detail 说明未绑定重放；其余契约 passed。
- API 实测：示例回放在无浏览器环境下运行，run 状态 failed，收尾消息为"示例回放结束：本次运行状态为 failed，原因：后端未判定通过…"，不再宣称完成。

## 过程中的坑

- 审查时一度以为前端产物缺少新文案，实际是 minified 产物把中文转义为 `\uXXXX`，grep 中文串会漏检；改用转义形式核对后确认文案已在产物中。
- 手动启动服务时误用了发行包目录里的旧 server 与旧前端，导致界面看起来"没修好"；改为从仓库根启动 `apps/server/dist/server.mjs` 后一致。

## 未完成

- 真实模型链路仍未验收（无 API Key）。
- 界面点击级复核受内嵌浏览器可点表面不可用限制，改用 API 与产物核对；后续在普通浏览器补一次人工走查。
