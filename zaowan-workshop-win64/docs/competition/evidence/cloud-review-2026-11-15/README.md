# 真实云端 AI 审查实测（2026-11-15，已成功）

用真实 Key 走生产链路：`PUT /api/model/session-config` → `POST /api/model/test` → `POST /review`（mode=both）。模型：`Qwen/Qwen3.8-Flash-Next`（ModelScope OpenAI 兼容端点）。

## 结果（全部真实落盘，见 review.json / model-usage-*.json / review-ui.png）

- 连接测试：`{ok:true, toolCalling:true}`（认证、文本、工具调用均正常）。
- 一次真实审查耗时 33.6s：**1 次模型调用**，promptTokens 671 / completionTokens 1851 / totalTokens 2522。
- 云端结论（原文摘录）："key-1 位于 door-1 后方的封闭区域内，而 door-1 又要求用 key-1 打开，玩家无法获得钥匙，导致 goal 中的 collected_at_least 与 at_exit 均无法完成。"——判断正确，且比本地规则多指出“两个 goal 分量都失效”。
- 契约行为验证：AI finding 只有 `origin:'ai'` 的结论与 suggestedGuidance，**没有** quickFix/ops；UI 上 AI 条目只有“让 AI 修”（要走任务卡确认），本地条目才有“一键修复”。体检列表显示“本地规则 1 条 · 云端 AI 1 条”。
- 界面状态栏原文：“云端 AI 审查：完成，1 条提示（1 次模型调用）· 模型：Qwen/Qwen3.8-Flash-Next · 云端结论只是建议……”。

## 历史（保留，不掩盖）

上一把 Key（2026-11-13/14）对同一端点的 chat 调用返回“模型认证失败”，当时留存了失败样本：`ai.status='failed'` + 本地回退（见本目录 git 历史与 §3.7）。本轮换新 Key 后成功，失败→验证→成功的完整链路都有证据。

## 成本口径

审查每版本 1 次请求（~2.5K tokens）。消融实验的修复臂多轮工具调用另计，见 ablation-2026-11-15/。
