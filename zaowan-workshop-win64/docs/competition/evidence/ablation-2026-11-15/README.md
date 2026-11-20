# 消融实验：纯 AI 修复 vs 算法优先（2026-11-15）

问题：修同一个坏配方，AI 要烧多少次调用？算法优先是不是真能免掉模型调用？

## 设计

- 夹具：`tests/fixtures/key-behind-door.json`（钥匙被门关在可达区外，`reachable_goal` 必 failed，本地 lint `grid/key-behind-door` 带算法 quickFix）。
- 臂 A「算法优先」：GET /lint → POST /quick-fix（算法补丁）→ adopt → POST /verify。模型调用次数**设计上为 0**。
- 臂 B「纯 AI」：同一夹具直接起 `mode:'model'` 修复运行，统计 run.usage.requests。
- 命令：`node tools/ablation-experiment.mjs`（可用 ABLATION_REPEATS 覆盖算法臂重复次数；AI 臂只跑 1 次）。

## 结果（见 results.json）

| 臂 | 调用次数 | 运行终态 | 用时 |
|---|---|---|---|
| 算法优先 ×3 | **0** | 3/3 verify `passed` | 92–104 ms |
| 纯 AI ×1（`Qwen/Qwen3.8-Flash-Next`，`run-8e6a72eb`） | **8 次** | `ready_for_review` | 未可靠记录（见下） |

## 勘误（2026-11-15 复核脚本后补记）

这一轮脚本有两个缺陷，现已在 `tools/ablation-experiment.mjs` 修正：

1. **用时不可信**：轮询只在 `completed / failed / cancelled` 时退出，而 Agent 运行的成功终态是 `ready_for_review`，所以脚本一直等到 240 × 0.5 s 的轮询上限。results.json 里的 `wallMs: 122786` 基本就是这个上限，**不是 AI 的真实耗时**。
2. **验证对象错误**：AI 臂结束后验证的是工程当前版本，而 AI 候选版本尚未采纳，所以那条 `verifyStatus` 不能说明 AI 候选通过了。`ready_for_review` 本身由后端判定（候选的检查与浏览器试玩都通过才会进入），这一点仍成立。

修正后：终态包含 `ready_for_review / blocked`，并显式验证 `candidateVersionId`。

## 可以下的结论 / 不能下的结论

- 能：对这类结构可判定的问题，本地 lint + quickFix 以 0 次模型调用完成修复并通过同一检查回归；同一问题纯 AI 用了 8 次模型请求。
- 不能：单次 AI 运行不足以给出成功率或耗时；多夹具、多次重复的对比改用 `pnpm bench`（`tools/bench-repair.mjs`），结果目录 `docs/competition/evidence/bench-<日期>/`。
