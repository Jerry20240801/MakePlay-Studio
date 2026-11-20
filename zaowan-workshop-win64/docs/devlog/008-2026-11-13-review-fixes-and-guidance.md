# 008 · 2026-11-13 · 审查轮修复与真实模型插话验收

## 审查提出的问题与修复

1. **暂停没有超时**：waitForResume 原来无限等待。现在默认 10 分钟超时（可注入更短值用于测试），超时后任务转 blocked，错误码 GUIDANCE_TIMEOUT，提示“可以基于当前版本重新发起任务”。
2. **暂停粒度**：原来只在循环顶部检查。现在每批 toolCalls 的每个调用之间也调用 handlePause，UI“下一步前暂停”与实际行为一致。
3. **claim_gap 误报**：只对 phase=final 的叙述判定，并加入否定前缀表（未完成/没完成/尚未/还没/不能算/没有完成/未通过/未验证）。诚实说“还没完成”不会再被标红。
4. **scope_drift 覆盖面**：候选集合改为按包取 ID（网格实体、知识题目、卡牌、对话节点/选择/结局），并把 guidance 文本并入“用户提到过”的允许集合。
5. **重启残留**：persist 现在写 run.json；服务启动时 storage.markInterruptedRuns() 把非终态运行（含 awaiting_confirmation）标记为 cancelled + interrupted，不自动重发模型请求。
6. **证据补全**：新增 concern 触发截图与真实模型插话运行目录。

## 真实模型插话验收（本轮实际执行）

- 模型：Qwen/Qwen3.8-Flash-Next（端点 api-inference.modelscope.cn/v1）。
- 初始指令：把 key-1 移到 (2,1)，不移动 door-1，不改胜利条件。
- 第一次 tool_call 后插话：改为把 key-1 移到 (1,2)，并且不要移动 door-1。
- 结果：ready_for_review；guidance appliedAtStep=2；key-1 最终 (1,2)（不是原指令的 (2,1)）；door-1 保持 (4,5)；契约 4 条不变。
- 用量：7 次模型响应、3812 tokens、解释覆盖率 1.0、无 silent step、无 concern。
- 证据：docs/competition/evidence/ai-presence-2026-11-13/guidance-run/（含 events.jsonl、guidance.jsonl、model-usage.json、plan-summary.json、report.json、playtest.json、截图与前后配方）。

## 验证结果

    typecheck 67 文件 / lint 通过
    unit 56 / integration 15 / security 5 / e2e 9 全部通过
    verify 结果：通过

## 仍未完成

- 干净 Windows 机器、双击启动器、中文与空格路径、断网、只读安装目录：未验证。
- 新手可用性测试：未执行。
- world 包按裁剪顺序未实现，方案 §2.1 与 P12 段已同步标注。
