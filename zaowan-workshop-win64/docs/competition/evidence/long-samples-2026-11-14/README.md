# 加长样例：一次「验证反馈 → 修改」的记录（2026-11-14）

目标：新增三个更长的可玩样例，并且必须由现有 verifier 判定通过，不允许“看着能玩”。

## 第一次运行（生产 verifier 的真实反馈）

```json
{
  "deep-vault": { "status": "passed" },
  "long-night": { "status": "failed", "checks": ["structure=passed", "dialogue_endings=FAILED", "dialogue_nodes=passed", "dialogue_dead_branch=passed", "dialogue_text=passed", "dialogue_replay=passed"] },
  "arena-run": { "code": "RECIPE_INVALID", "message": "sample recipe invalid" }
}
```

两条失败都指向具体机制，而不是“感觉不对”：

1. `dialogue_endings=failed`：内核取**第一个**满足 `require` 的结局（`packages/kernel-dialogue/src/index.ts:77`）。我把兜底结局 `require: []` 排在最前，导致另外三个结局永远不可达；另外“热可可”结局要求 `coin && patient`，而这两条路线在开局选择处互斥，根本不可能同时为真。
2. `RECIPE_INVALID`：卡牌 `run.battles` 的 schema 上限是 5（`packages/schema/src/recipe.ts:640`），我写了 6 场；同时 `enemies.length` 必须**恰好等于** battles。

## 修改后（同一 verifier 复跑）

- 结局顺序改为“具体条件在前、`require: []` 兜底在后”，`一杯热可可` 的条件改为 `patient`。
- 战斗数改 5、敌人删到 5 个、起始生命 50，描述与 note 同步。

```json
{
  "deep-vault": { "status": "passed", "checks": ["reachable_goal=passed", "contract:c-door-1=passed", "contract:c-door-2=passed", "contract:c-goal=passed"] },
  "long-night": { "status": "passed", "checks": ["dialogue_endings=passed", "dialogue_dead_branch=passed", "dialogue_replay=passed"] },
  "arena-run": { "status": "passed", "checks": ["card_determinism=passed", "card_invariants=passed", "card_rng_evidence=passed"] }
}
```

## 产出

- `examples/deep-vault`：19×9 三段库房、2 把钥匙、2 道钥匙门、开关+机关门（钥匙与出口是 10×10、1 钥匙 1 门）。
- `examples/long-night`：16 节点 / 4 标记 / 4 个可达结局（末班车 8 节点 / 2 结局）。
- `examples/arena-run`：5 场连续战斗、12 种卡牌、10 张起始牌组（熔炉决斗 3 场 / 5 种卡牌）。
- `examples/word-quest`：30 → 33 题，新增 3 道配对题。
- 生成器 `tools/make-long-samples.mjs`：网格用自带 BFS 先证明可通关，对话用图遍历证明无死路，然后才写盘；生产 verifier 再复验一次。
- 首页模板新增 06/07/08 三个“加长”入口。

## 边界

这里的“通过”只覆盖机制层（可通关、结局可达、确定性、契约未被改动），不含手感、剧本质量或卡牌平衡判断。
