# 验证语义与证据

## 三层验证

1. 工程与结构：Schema、ID 唯一性、引用完整性、地图/巡逻路径/资源上限、构建与加载错误。
2. 规则与契约：纯内核金标、库存/门锁/守卫/胜负/机关语义、用户确认契约、路径搜索与反例。
3. 实际浏览器试玩：干净 context、真实键盘/点击、只读轨迹与可见终局 UI。

第二层不能替代第三层。实现位于 packages/verifier 与 apps/server/src/playtest.ts。

## 自动体检与三档审查（2026-11-14）

### 本地体检（0 次模型调用）

- 规则：29 条，位于 packages/verifier/src/lint.ts；覆盖网格 12、知识 6、卡牌 5、对话 5、素材 1。
- 触发：打开/切换版本、保存新版本后自动运行；也可点“运行验证”或“只重新审查”。
- 能查：钥匙在门后、门缺道具、实体在墙里/重叠、规则引用不存在对象、机关门永远打不开、答案不在选项、单选多答案、卡牌费用超能量、牌组悬空引用、对话死链等。
- 一键修复：6 条规则带算法修复；复用类型化补丁与已确认底线检查，生成新草稿并自动重新验证；版本来源记为 algorithm，modelCalls=0。

### 三档审查

| 方式 | 模型调用 | 结论来源 | 适用 |
|---|---|---|---|
| local | 0 | 29 条本地规则 | 默认；快速、免费、可复现 |
| ai | 最多 1 | 云端模型建议 | 需要模型；审查规则覆盖不到的配方逻辑 |
| both | 最多 1 | 本地 + 云端，分开标注 | 机器结论 + 模型补充 |

- 云端审查只发送当前配方（最多约 12k 字符）、本地体检结论与已确认底线；不发送 Key、路径或无关文件。
- 模型输出只接受 summary/findings；quickFix、ops、patch 等字段一律丢弃，不能直接改配方。
- 云端失败/跳过：如实记录 failed/skipped；本地结论仍显示，不把失败当通过。
- 证据：runs/review-*/review.json 与 model-usage.json，记录 mode、模型、请求数、token、prompt 长度与 findings；不含 Key。

### 当前执行结果（2026-11-14）

- typecheck 95 文件；lint 109 文件；unit 91；integration 39；security 6；e2e 22；build 通过；全量 verify 通过。
- 云端审查链路由 e2e 的本地替身模型覆盖（1 次桩调用），验证三档 UI、证据落盘与密钥不外泄。
- 真实云端审查尝试：ModelScope 端点返回 **MODEL_AUTH_FAILED**（1 次请求、无 findings），因此真实模型审查能力仍待补；未用替身冒充。

## 各模式包剖面

| 模式包 | 主要验证 | 搜索 |
|---|---|---|
| 解谜/潜行 | BFS 找通关路线 + 反例 + 真实按键重放 | 适用（状态 ≤50000、步数 ≤600、5 秒） |
| 卡牌 | 固定种子脚本场景 + 属性断言 + 回归种子 + 真实点击 | 不做全状态搜索 |
| 知识 | 题库结构与覆盖 + 满分/失败作答序列 + 真实点击 | 不适用 |

搜索结论：found / exhausted / budget_exceeded / invalid / rule_error。预算耗尽只能报「未知」，不能断言无解；搜索中发现的运行规则错误必须记录并使候选失败。

## 检查状态

已通过 / 失败 / 受阻 / 未验证 / 未知 / 已取消。缺项、跳过、未知、受阻都不折算成通过；人工项单独列出等待用户确认。

## 构建身份

- recipeHash：规范化配方 SHA-256
- contractHash：契约快照
- assetManifestHash：素材字节哈希清单
- buildId：以上内容 + Schema 版本 + 引擎版本
- verificationId：buildId + contractHash + 测试版本 + 运行 ID

修复前后是不同 buildId。「同版本验证」指验证读取的配方、浏览器加载的构建与报告声明的构建一致，不是让修改前后拥有相同哈希。

## 证据目录

    runs/<run-id>/
      manifest.json       构建身份、种子、引擎/测试版本、时间、模式
      events.jsonl        任务事件
      checks.json         检查清单
      report.json         完整报告
      model-usage.json    模型调用与计量（未知就记 unknown）
      plan-summary.json   Agent 任务计划摘要
      inputs.jsonl        真实输入轨迹（浏览器）
      runtime-trace.jsonl 只读状态轨迹
      console.jsonl       控制台错误
      screenshots/        失败、修复后成功、比赛样例
      playtest.json       浏览器试玩结果

没有录制成功就不生成视频。截图与证据是实际产物；日志不能改写已发生事件。

## 实际执行结果（2026-11-12，本机）

- 单元测试：40 项通过（网格 16、知识 7、卡牌 11、样例 6）。
- 集成测试：15 项通过（含 AI 在场感指标、插话注入、暂停超时与恢复）。
- 安全测试：5 项通过。
- 类型检查与静态约束：通过。
- 构建：web / player / server 三份产物生成。
- 浏览器 E2E：**9 项通过**（CDP 连接外部 Edge，真实键盘与鼠标输入；含对话包键盘通关、AI 时间线与 concern 截图、设置页，截图与轨迹写入运行目录）。
- 真实模型链路：**已验收**（Qwen/Qwen3.8-Flash-Next，6 次响应完成修复，8 项检查 passed，浏览器真实按键通关）；证据：docs/competition/evidence/real-model-2026-11-13/。
- 干净机器、启动器双击、断网与只读目录：**未验证**。

浏览器证据示例：runs/<run-id>/playtest.json、inputs.jsonl、runtime-trace.jsonl、console.jsonl、screenshots/grid-final.png。

## 局限

自动检查不能证明：关卡对所有玩家都可通关、没有死锁、题目事实正确、卡牌平衡、游戏好玩。这些需要人类试玩与内容审核。

## 对话叙事包验证画像

- 状态空间 BFS（节点 × 已置标记，步数受 maxSteps 限制）：检查每个结局至少一条可达路径、节点可达性、死分支、占位符（TODO/XXX/{todo}）。
- 结局不可达 → failed；节点不可达或占位文案 → partial/unverified；状态预算耗尽 → unknown，不能断言无解。
- 契约：ending_locked、choice_effect_locked、dialogue_text_reviewed、no_dead_branch；前两者与确认时基线比较。
- 输出 replay（advance/choose 序列），服务端 playtest 用 Enter 与数字键真实重放，断言 dlg-end-<id> 出现。

## AI 在场感指标与边界

- plan-summary.json 记录 narratedSteps、silentSteps、explanationCoverage（narrated/(narrated+silent)）、concerns 计数、guidanceCount、durationMs。
- 5 条 concern：silent_step、scope_drift、contract_guarded、claim_gap、loop_spin，全部由已有数据判定，不额外调用模型。
- concern 只是“可判定的怀疑标记”，不是幻觉检测器；不命中不代表 AI 说对了。
- claim_gap 只对最终叙述判定，并排除“未完成/没完成/尚未/还没/不能算/未通过/未验证”等否定表达，避免把诚实说明标红。
- 运行中请求暂停后最多等待 10 分钟；超时转 blocked（GUIDANCE_TIMEOUT），不会永久挂起。服务重启时把非终态运行标记为 cancelled + interrupted，不自动重发模型请求。
- 示例回放的 model 事件一律带 synthetic:true，前端显示“示例脚本”角标，不计入真实成功率。
- 真实模型默认任务不保证叙述覆盖率；低于 80% 时 UI 显示黄条提示，属于弱叙述模型提示而非通过/失败判定。
