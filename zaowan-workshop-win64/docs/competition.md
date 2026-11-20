# 参赛材料与证据索引

> 状态：P13–P15 已完成；P16 自动体检、一键修复、三档审查、toast、回收站与 P17 素材背景/音乐、对话表现层、画面自动/手动缩放、空白新建、可选 Node 导出、卡牌 HTML 卡面均已实现并通过测试（unit 91 / integration 39 / security 6 / e2e 22）。真实云端 AI 审查本次认证失败，仍待补；真实首次生成 / Issue 修复 / 盲修证据见 competition/evidence。进度与未验证项以 [implementation-status.md](implementation-status.md) 为准。

## 评分对应

| 评分项 | 我们的证据 | 状态 |
|---|---|---|
| 实用价值（30） | 五个模式包、八套样例（含 3 套加长）、手动编辑、积木式拼接、真实试玩界面、导出；新手流程已跑通（开发者本人） | 新手用户测试未执行 |
| AI/Agent（25） | 单任务状态机、受限工具、类型化补丁、契约保护、预算、取消、SSE；真实模型闭环（6 次响应修复，证据在 docs/competition/evidence/real-model-2026-11-13/）；盲修（blind-repair）与运行中插话两条真实运行另见 evidence 对应目录 | 已验收；指令给出了修复位置，不声称自主定位 |
| 工程完成度（25） | 严格 TS、单元/集成/安全/浏览器 E2E 测试、构建、便携包生成、导出 ZIP、错误区分 | 干净机与启动器双击未验证 |
| 开源与复用（10） | MIT、架构/配方/验证/安全/扩展文档、八套样例与样例生成器、依赖锁文件 | 导入接口未实现 |
| 创作手记（10） | docs/devlog 按真实过程记录，含失败与取舍 | 内容为本次开发真实记录 |

## 演示脚本（5 分钟，建议）

1. 0:00-0:30 痛点与定位：小白的想法难以变成可玩规则，生成代码难以持续修改。
2. 0:30-1:10 首页选潜行样例，展示玩法卡、创作底线、真实游戏界面。
3. 1:10-2:10 运行验证：结构、契约、BFS 找到路线；说明这是离散模型内的结论。
4. 2:10-3:10 用回归夹具「门后钥匙」演示失败 → 修复补丁 → 新 buildId 复测；强调门未被删除、契约未变。
5. 3:10-4:00 手动改守卫频率（每 2 步改每 1 步），保存新版本、重新验证、对比版本。
6. 4:00-4:35 导出 ZIP，在仓库外目录解压启动游戏。
7. 4:35-5:00 开源复用、真实结果、已知限制（浏览器与真实模型仅本机结果；干净机、断网与新手测试未验证）。

浏览器验证默认由 Playwright 自行启动本机 Chrome/Edge：直接运行 node scripts/test.mjs e2e。若现场需要复用已开浏览器，也可以用 CDP：以 --remote-debugging-port 启动 Edge/Chrome，再设置 ZAOWAN_CDP_URL。若两种方式都无法启动浏览器，明确说明「浏览器验证受阻」，不要用回放冒充现场真实调用。

## 评测方法

固定任务集与指标见方案 16 节。本次只完成开发自测，没有伪造用户访谈或成功率。建议后续补充：

- 12 类任务 × 固定变体，记录首次合法配方率、需求满足率、端到端完成率、契约破坏次数。
- 消融：同一模型同一任务，关闭/开启执行反馈修复。
- 至少 3 位真实新手完成创建、修改、看懂失败、导出四件事。

## 不能宣称的内容

- 不宣称「一句话生成任意游戏」。
- 不宣称题目事实正确、卡牌平衡或游戏好玩已被自动验证。
- 不宣称五个模式包共用同一套玩法内核。
- 不宣称在干净机、他人机器或断网环境下完成浏览器与真实模型验证；本机已有结果见上文证据，但不等同于通用环境复现。

## AI 在场感证据（2026-11-13）

- 设计：叙述协议（每步先说明意图）+ 步骤卡时间线（AI 说 / 机器核 / 证据）+ 5 条可判定 concern + 运行中插话/暂停继续 + 示例回放 synthetic 角标。
- 量化：plan-summary.json 的 explanationCoverage 与 concerns 计数；页脚实时展示 tokens/耗时/覆盖率/可疑步数。
- 测试：tests/unit/concerns.test.ts（5 条探针）、tests/integration/presence.test.ts（脱敏配置、demo/终态插话拒绝、指标落盘）、tests/integration/guidance.test.ts（StubProvider 注入与暂停恢复）、e2e 时间线与设置页。
- 证据：docs/competition/evidence/ai-presence-2026-11-13/timeline.png。
- 真实模型插话验收：7 次请求、3812 tokens；插话 appliedAtStep=2，key-1 最终 (1,2)（原指令 (2,1)），door-1 未动；证据 docs/competition/evidence/ai-presence-2026-11-13/guidance-run/。
- 诚实边界：concern 不是幻觉检测；插话只验证了“模型读到并改变了补丁目标”，不证明它能理解任意插话。

## 模式包（2026-11-13）

- 正式支持 5 个：puzzle、stealth、quiz、card、dialogue。
- dialogue 已有完整链路（内核、验证画像、契约、运行时、编辑器、样例、浏览器键盘通关）。
- world 未实现（按裁剪顺序），不在产品文案中声明。
- P13 主流程代码、自动化验证与真实模型证据均已完成：首次生成候选 v2（4 项检查 passed、浏览器 won），Issue 修复候选 v3（同一批 8 项检查全 passed、两个问题单 resolved）。证据在 `docs/competition/evidence/p13-real-model-2026-11-13/`；不得用 demo 回放或旧轮证据代替。

## 与 DSH / Godot 的差异化

完整表述与四条可见证据见 [competition/README.md](competition/README.md)。一句话：不靠“界面不同”或“多 Agent 分工”，而靠结构化 diff、用户确认的创作底线、规则内核与真实浏览器证据，以及同一 Issue 的回归门槛。

P13 主流程进度见 [implementation-status.md](implementation-status.md)。

## 比赛硬要求对照：拆解任务 + 调用工具 + 基于执行反馈的修改

| 要求 | 产品里在哪看 | 机器证据 |
|---|---|---|
| 拆解任务 | 工作台对话区时间线顶部“AI 的任务拆解”卡；绑定检查的子任务由后端按检查结果打勾，不靠 AI 自报 | `runs/<id>/plan.json`，事件 `plan` / `plan_progress` |
| 调用工具 | 时间线步骤卡“它做了”（工具名、补丁前后 diff、检查结果） | `events.jsonl` 的 `tool_call` / `tool_result` |
| 基于执行反馈的修改 | 绿色“基于执行反馈的修改”卡：执行反馈（失败检查）→ AI 修改 → 复测通过 | 事件 `feedback_fix`，`run.feedbackFixes`，前后 recipe |

实现要点：Agent 先跑 `run_rule_checks` 诊断当前版本，再 `submit_plan`，然后补丁 → 复测 → 浏览器回放；复测或试玩失败必须依据失败详情再改。后端自动识别“失败 → 补丁 → 同一检查通过”，生成 `feedback_fix`。`prepare_review` 会拒绝计划里仍未通过的子任务。

当前证据状态：
- 示例回放（固定脚本，不计入真实成功率）：e2e 断言闭环中出现 `plan` 与 1 次 `feedback_fix`。
- 边界（如实）：评分表述中的“读取素材”指 inspect_assets 工具与素材元信息链路，已实现并有自动化测试，但未安排一次真实模型调用该工具的运行留档；“读取工程、拆解任务（submit_plan）、调用工具、运行校验、基于执行反馈的修正”均有真实模型运行证据（evidence 目录）。
- 真实模型“盲修”：**已运行通过（2026-11-13，Qwen/Qwen3.8-Flash-Next，8 次请求 / 5730 tokens）**。指令只有“这关通关不了，帮我修好。门和胜利条件不要改。”。过程：读工程 → 基线检查失败（`reachable_goal`、`contract:c-reach`）→ 提交 5 步计划 → 一次补丁 → 复测通过 → 浏览器 18 步通关 → 待审核；`feedback_fix` 1 次，计划中绑定检查的 3 个子任务均由后端判定通过，4 条契约不变。注意：模型除了把钥匙 (4,4)→(6,6)，还把出口 (8,8)→(5,3)；指令未禁止，但超出最小修改，审核时需人工确认。证据：`docs/competition/evidence/blind-repair-2026-11-13/`。复跑命令：

      ZAOWAN_MODEL_BASE_URL=... ZAOWAN_MODEL_ID=... ZAOWAN_MODEL_KEY=... node scripts/test.mjs model-run blind
