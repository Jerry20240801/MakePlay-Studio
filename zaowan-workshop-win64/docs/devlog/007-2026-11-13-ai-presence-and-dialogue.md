# 007 · 2026-11-13 · AI 在场感（P11）与对话叙事包（P12a）

## 做了什么

### P11 后端

- SYSTEM_PROMPT 增加叙述硬约束：动手前说明“做什么+为什么”，结果后说明含义，补丁前列实体 ID，结束给三段总结，partial 必须照实说。
- RunRecord 增加 narratedSteps / silentSteps / concerns / guidance / pauseRequested / resumeRequested / startedAt；PublicRun 暴露解释覆盖率、耗时、concerns、guidance。
- 事件类型新增 concern 与 guidance；model 事件带 phase（before_tools / after_result / final）与 synthetic 标记。
- 5 条 concern 探针：silent_step、scope_drift、contract_guarded、claim_gap、loop_spin；导出纯函数便于单测（tests/unit/concerns.test.ts）。
- 运行中插话：POST /api/runs/:id/guidance、POST /api/runs/:id/resume；demo 返回 409 DEMO_NOT_INTERACTIVE，终态返回 409 RUN_NOT_RUNNING；pauseBeforeNextTool 会把状态置为 awaiting_confirmation，并在下一次 provider.chat 前注入用户消息。
- GET /api/model/session-config 脱敏返回 configured/baseUrl/model/timeoutMs/maxRequests/hasApiKey，永不返回 key。
- patch 事件增加 diffSummary（changed / untouched / boardChanged / goalChanged），供前端展开“改了什么”。
- plan-summary.json 写入 narratedSteps、silentSteps、explanationCoverage、concerns、guidanceCount、durationMs。

### P11 前端

- 新增 #/settings 页面：Base URL、模型、write-only Key、超时与响应上限、测试连接（连通/工具调用分行）、清除配置、隐私边界说明。
- 首页增加 AI 引擎状态横幅与“AI 设置”入口；未连接时工作台“真实模型”按钮直接提示先去设置。
- 运行时改成步骤卡时间线（run-timeline.tsx）：每步展示 AI 说 / 它做了 / 证据，patch 展开实体 ID 前后值，concern 黄色/红色描边，并提供“照这个说法插话”。
- 运行中常驻插话框（Ctrl+Enter）、三个模板按钮、暂停后“继续执行”；页脚显示响应/工具/修复轮/tokens/耗时/覆盖率/可疑步数。
- 所有新增自定义背景按钮都显式给了前景色（沿用 006 的教训）。

### P12a 对话叙事包（dialogue）

- schema：DialogueRecipe、节点/选择/结局/标记、zod 校验与语义校验（死链、未声明标记、重复 ID）。
- kernel-dialogue：纯函数 init/step/key、advance/choose/restart、require 表达式、maxSteps、结局解析；无随机。
- verifier：状态空间 BFS，检查全部结局可达、节点可达性、死分支、占位符、可重放动作序列；四个契约 ending_locked / choice_effect_locked / dialogue_text_reviewed / no_dead_branch。
- 运行时 dialogue-game.tsx：Enter 推进、数字键选择、testid dlg-panel/dlg-line/dlg-choice-*/dlg-advance/dlg-end-*；HUD 显示步数与标记。
- 服务端：starter、playtest 真实键盘分支、Agent 补丁 op（update_dialogue_node / update_dialogue_choice / update_dialogue_ending）、app packId 枚举。
- 样例 examples/last-train：8 节点、3 处选择、2 结局、4 条契约。
- 编辑器：对话节点台词/说话人/审核标记可编辑，去向与结局结构化展示。

## 验证（本机）

- typecheck 通过；unit 56 / integration 14 / security 5；e2e 8（新增对话真实键盘通关、AI 时间线与 demo 插话拒绝、设置页）。
- 新增证据：docs/competition/evidence/ai-presence-2026-11-13/timeline.png；docs/competition/evidence/mode-packs-2026-11-13/dialogue-final.png。
- 插话注入机制用 StubProvider 做了集成测试（无 API 费用）：断言用户消息进入 provider.chat、guidance.jsonl 落盘、pause→awaiting_confirmation→resume 生效。

## 未做与诚实边界

- P12b 轻开放世界包（world）未实现：按增强方案 §5 的裁剪顺序，先砍 world。首页、README 与本文都不写“六种模式包随便做”；当前正式支持 5 个包（解谜/潜行/知识/卡牌/对话）。
- “真实模型插话后 door-1 未被移动”这条 model-run 断言未执行：需要真实 API 调用；本轮为避免额外计费没有跑。插话注入本身已用 stub 验证，真实模型是否遵守插话仍是未验证项。
- 时间线聚合是前端纯展示；旧运行没有 diffSummary 时按普通事件卡展示，不报错。
- concern 是可判定的怀疑标记，不是幻觉检测器；不命中不代表 AI 说对了。
