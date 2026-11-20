# P13 真实模型证据（2026-11-13）

本目录由真实模型请求生成，不是 demo / 回放 / 手工摆拍。测试入口：

```bash
# 模型只在本机环境变量里，未写入仓库或日志
set ZAOWAN_MODEL_BASE_URL=https://api-inference.modelscope.cn/v1
set ZAOWAN_MODEL_ID=Qwen/Qwen3.8-Flash-Next
set ZAOWAN_MODEL_KEY=<仅本机会话>
set ZAOWAN_P13_ONLY=generation   # 或 repair
node scripts/test.mjs model-run
```

- 模型：`Qwen/Qwen3.8-Flash-Next`（OpenAI 兼容端点）
- 运行时间：2026-11-13 17:53–17:57（Asia/Shanghai）
- 两条用例均来自新增的 `tests/model-run/p13-real-model.test.ts`，断言真实通过后才保留证据。
- API Key 只存在于运行进程的环境变量，未写入本目录、工程数据、导出包或文档。

## 1. 从一句想法首次生成（`generation/`）

任务卡：`kind=initial_generation`，目标“做一个钥匙门解谜小游戏：玩家从左上角出发，找到钥匙打开门，走到出口；不要做第二关。”

| 项 | 值 |
|---|---|
| run | `run-8033d7e6` |
| 最终状态 | `ready_for_review` |
| 候选版本 | `v2`（`generation/recipe-after.json`） |
| 模型请求 / tokens | 7 次 / 4554 |
| 工具调用 | 7 次：inspect_project → apply_recipe_patch（1 次 schema 报错后自纠）→ apply_recipe_patch → validate_recipe → run_rule_checks → run_browser_playtest → prepare_review |
| 机器检查 | structure / determinism / initial_state / reachable_goal 全部 passed |
| 浏览器试玩 | `ok: true`，`finalStatus: won`，真实键盘输入（Playwright launch） |

配方变化（`recipe-before.json` → `recipe-after.json`）：在只有出口 `exit-1` 的骨架上新增了
`item:key-1` 与 `door:door-1`，形成钥匙—门—出口的可玩闭环；不是只改名称或只做检查。

证据文件：

- `generation/task-brief.json`（在 `generation/run/`）与 `run.json`：编译器版本、kind、基础版本、允许操作、完成标准。
- `generation/run/events.jsonl`：模型叙述、真实 tool_call / tool_result。
- `generation/run/checks.json` / `report.json`：规则检查。
- `generation/run/playtest.json` / `inputs.jsonl` / `screenshots/grid-final.png`：真实浏览器通关证据。
- `generation/recipe-before.json` / `recipe-after.json`：非空配方 diff。

## 2. 从 Issue 修复并同一检查回归（`repair/`）

验证失败自动生成两个问题单（`reachable_goal`、`contract:c-reach`），再用 `issueId` 发起修复任务。

| 项 | 值 |
|---|---|
| run | `run-e4e4a9bc` |
| 关联 Issue | `issue-6adc53e1`（`reachable_goal`） |
| 最终状态 | `ready_for_review` |
| 候选版本 | `v3`（`repair/recipe-after.json`） |
| 模型请求 / tokens | 6 次 / 4446 |
| 工具调用 | 6 次：inspect_project → apply_recipe_patch → validate_recipe → run_rule_checks → run_browser_playtest → prepare_review |
| 回归检查 | 8 项全部 passed，包括原先失败的 `reachable_goal` 与 `contract:c-reach` |
| 浏览器试玩 | `ok: true`，`finalStatus: won` |
| Issue 结果 | 两个问题单都变为 `resolved`，`requiresUserReview: false`，且 `resolution.candidateVersionId=v3` |

这证明的是“同一失败检查由失败变通过 + 候选绑定真实 buildId + 浏览器回放”，不是让模型口头说“修好了”。

## 3. 调用成本记录（透明）

本轮调试共使用 **30 次**模型请求：

| 用途 | 请求数 | tokens |
|---|---|---|
| 工具调用探针 | 1 | 411 |
| 首次生成（第一次，失败于 schema 猜测） | 10 | 5281 |
| 首次生成（第二次，成功） | 7 | 4554 |
| Issue 修复（第一次，问题单只解决一个） | 6 | 3934 |
| Issue 修复（第二次，修复多问题单回归后） | 6 | 4446 |

第一次生成失败暴露了真实可用性问题：模型不知道 `add_entity` 的实体字段，连续猜 `kind:key/pickup/item/door`。随后补了
`inspect_project.entityTemplates` 与 `add_entity` 的字段级校验错误，第二次 7 次请求收敛。该失败运行没有放进证据目录。

## 4. 边界

- 这是一次真实模型、单任务、单模型的证据，不证明通用生成成功率，也不代表其他模型。
- 用户口述且无法复现的问题仍然只能 `awaiting_review`；本目录的两条问题都是机器可判定检查。
- 1024 宽 e2e、3 分钟演示与新手可用性测试仍未完成，见 [实施状态](../../../implementation-status.md)。
