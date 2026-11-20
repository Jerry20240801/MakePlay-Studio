# 修复基准结果（2026-11-15，自动生成）

命令：`node tools/bench-repair.mjs`；原始数据见 `results.json`，真实模型运行的事件流复制在 `runs/`。

| 夹具 | 方式 | 模型 | 成功/次数 | 平均模型请求 | 平均 tokens | 平均修复轮次 | 含反馈修正 | 平均用时 s |
|---|---|---|---|---|---|---|---|---|
| 01-key-behind-door | algorithm | — | 3/3 | 0 | 0 | — | 0 | 0.2 |
| 02-door-item-missing | algorithm | — | 3/3 | 0 | 0 | — | 0 | 0.3 |
| 03-gate-no-switch | algorithm | — | 0/3 | 0 | 0 | — | 0 | 0.1 |
| 04-exit-sealed | algorithm | — | 0/3 | 0 | 0 | — | 0 | 0.1 |
| 05-compound | algorithm | — | 0/3 | 0 | 0 | — | 0 | 0.5 |

说明：成功 = 修复后的版本（AI 臂为候选版本）由后端验证判定 `passed`；“含反馈修正”= 运行内出现“检查失败 → 修改 → 同一检查通过”的次数（`feedbackFixes`）。
