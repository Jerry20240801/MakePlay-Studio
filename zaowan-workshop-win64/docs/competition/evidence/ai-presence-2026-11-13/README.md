# AI 在场感证据（2026-11-13）

- timeline.png：工作台运行中截图，含“AI 说 / 机器核 / 示例脚本”徽标与步骤卡。
- concern.png：scope_drift 触发的 concern 卡片（指令只提到 door-1，示例补丁却移动了 key-1），用于证明“可判定的怀疑”真的会出现在界面上。
- guidance-run/：真实模型插话验收证据（Qwen/Qwen3.8-Flash-Next，7 次请求、3812 tokens）：
  - 用户中途插话“改为把 key-1 移到 (1,2)，并且不要移动 door-1”在 appliedAtStep=2 生效；
  - 最终 key-1 从 (4,4) 移到 (1,2)（不是原指令的 (2,1)），door-1 保持 (4,5) 未动；
  - run/ 内含 events.jsonl、guidance.jsonl、model-usage.json、plan-summary.json、report.json、playtest.json、screenshots/grid-final.png；
  - recipe-before.json / recipe-after.json 可直接比对前后配方。
- 对应自动化用例：
  - e2e："shows the AI timeline, badges and rejects demo guidance in the UI"、"shows a concern card for scope drift and captures it as evidence"、"plays the dialogue sample with real keyboard choices"；
  - integration：tests/integration/guidance.test.ts（StubProvider 注入、pause/resume、暂停超时转 blocked）、tests/integration/presence.test.ts（脱敏配置、demo/终态拒绝、指标落盘）；
  - 真实模型：tests/model-guidance/guidance.test.ts（需要 key 与浏览器；本轮已实际运行）。
- 边界：concern 是可疑标记，不是幻觉检测器；示例回放不计入成功率。
