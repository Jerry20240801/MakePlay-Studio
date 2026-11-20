# 实施状态（2026-11-14 17:50，P13–P20 完成；真实云端 AI 审查待补）

> 本文件只记录有文件或命令输出支撑的状态。P13–P15 已完成；P16 自动体检/修复/三档审查、P17 素材渲染/对话表现/缩放/空白新建/可选 Node 导出已通过；P18 补了导出素材、节点级对话素材、单词配对、组件积木、自定义类型映射、横板舞台与外观编辑器。
> 核对时间：2026-11-14 10:30（Asia/Shanghai）。命令用环境自带 Node 直接执行 `scripts/*.mjs`（本机 shell 无全局 pnpm；与 package.json 脚本等价）。

## 1. 结论

- **P0–P12 底座**：已实现，有测试与真实运行证据（§2）。
- **P13 创作工作台与故障闭环**：**完成**。新首页、三栏工作台、任务编译器、首次生成、Issue 闭环、线程/重启恢复、8 个新 PatchOp、P13 测试与 5 条 e2e 主流程断言均已落地并通过。
- **P13 真实模型证据：已完成**。模型 `Qwen/Qwen3.8-Flash-Next`；首次生成 7 次请求 / 4554 tokens，候选 v2，机器检查 4 项 passed、浏览器 `won`；Issue 修复 6 次请求 / 4446 tokens，候选 v3，同一批 8 项检查全 passed，两个关联问题单均 `resolved`。证据：[p13-real-model-2026-11-13](competition/evidence/p13-real-model-2026-11-13/README.md)。
- **P14 深色 studio + 工程/会话左栏：完成**。首页与工作台共用工程侧栏；首页“新建游戏”、项目页“新建会话”、1280×800 无横向滚动与游戏/输入同屏均有 e2e 断言；首页、工作台与工程侧栏截图已更新。
- **P15 深浅双主题 + 可拖拽分栏：完成**。主题切换写入 localStorage、刷新保持；1280×800 两主题无横向滚动；`split-game` 拖动后对话变大、输入框仍可见、刷新保持、双击复位，均有 e2e 断言；深/浅/拖拽截图已更新。
- **P16 自动体检 + 一键修复 + 三档审查：完成（真实云端调用待补）**。29 条本地规则、6 条算法修复、0 次模型调用；验证页签可选 local / ai / both，云端每次最多 1 次调用且结论只能作为建议；云端失败时回退显示本地结论。证据：[algorithm-fix](competition/evidence/algorithm-fix-2026-11-13/)、[experience-polish](competition/evidence/experience-polish-2026-11-14/)。
- **P16 体验项**：验证结果 toast、游戏画面等比缩放、工程删除/回收站、任务拆解与执行反馈、真实试玩按钮、版本号 bump 均已实现并有测试。
- **P17 素材与表现：完成（导出内嵌素材/按节点音频待补）**。工作台可上传图片/音频并设为背景/音乐，卡面可显示插画；对话改为左下逐字、点击补全、居中选项、系统 TTS；游戏画面可自动/手动缩放；新工程为空白骨架；导出可选含 Node 并自动下载。
- **仍未完成**：真实云端 AI 审查（本次 ModelScope 调用返回 MODEL_AUTH_FAILED，1 次请求，未重试）、软锁死检测、“纯 AI vs 算法优先”消融实验、真正空白新建/版本来源展示、1024 宽自动化 e2e、3 分钟演示、新手测试、干净机验证。

## 2. 本轮实际验证结果（2026-11-14）

| 命令 | 结果 |
|---|---|
| `node scripts/typecheck.mjs` | **通过**（95 个文件，TS strict） |
| `node scripts/lint.mjs` | **通过**（109 个文件静态约束） |
| `node scripts/test.mjs unit` | **91 passed** / 0 failed |
| `node scripts/test.mjs integration` | **39 passed** / 0 failed |
| `node scripts/test.mjs security` | **6 passed** / 0 failed |
| `node scripts/test.mjs e2e` | **22 passed** / 0 failed（含 P16 体检、toast、等比缩放、三档审查；本机 Edge 无头） |
| `node scripts/build.mjs` | **通过**（web / player / server 三份产物，19.4s） |
| `node scripts/verify.mjs` | **通过**（P18 全量：e2e 22/22，约 10min） |
| `node scripts/test.mjs model-run` | **2 passed** / 0 failed（真实模型；首次生成 7 请求、Issue 修复 6 请求） |
| `node tools/distribution/package-win.mjs` | **通过**（文件数、zip 大小与 sha256 见包内 `BUILD.txt`） |
| `node scripts/test-dist.mjs` | **通过**（18 项结构检查、依赖加载、sharp 编码、zip 校验和） |

真实模型测试文件也计入 typecheck / lint；未配置模型时 `model-run` 会 skip，不影响 `verify`。真实调试共使用 30 次模型请求（含一次失败的首次生成），明细见证据 README。

### 2.1 交付包（2026-11-14）

- 产物：`dist/zaowan-workshop-win64.zip` 与 `.sha256`（精确大小/校验和见包内 `BUILD.txt`）；解压后双击 `Start-Workshop.cmd`。
- `test-dist.mjs`：18 项结构检查全通过；zip 内无 `.env`、无 API Key、校验和匹配。
- 真实启动 smoke：从包目录运行 `runtime/node.exe apps/server/dist/server.mjs`，首页可打开、`/api/health` ok、可创建 `key-escape` 样例并跑验证（`partial`，与无浏览器回放时一致）。
- 未验证：干净 Windows 机器、启动器双击、中文/空格路径、断网、只读安装目录。

E2E 复跑记录：卡牌用例曾在共享 CDP 浏览器下长时间等待点击；已给点击加 3s 超时与 90s 循环上限，`scripts/verify.mjs` 改为由 Playwright 自行启动浏览器（不再强制 `ZAOWAN_CDP_URL`），最终 P16 全量 e2e 22/22。

P13 新增用例：

- `tests/unit/task-brief.test.ts`：10 条（确定性、kind/pack/allowedOps、contracts、evidence、goal 清理、userConstraints、targetRefs、render）。
- `tests/unit/agent-ops.test.ts`：7 条（8 个新 PatchOp 正常应用、契约/合法性拒绝、非法输入报错、不可变）。
- `tests/integration/issues.test.ts`：7 条（验证失败自动 issue、同 buildId+checkId 不重复、dismiss、从 issue 启动 demo repair、resolved/open/awaiting_review、HTTP 用户 issue 状态）。
- `tests/integration/threads.test.ts`：3 条（threadId/parentRunId 落盘、run.json/task-brief.json、hydrate、未终态 interrupted、HTTP threads 分组）。
- `tests/e2e/browser.test.ts`：新增 5 条（模板两次点击可玩、1280×800 同屏 boundingBox、无模型诚实降级、issue 条→repair brief→回退、demo 首次生成截图）。

## 3. P13 状态（以本轮实际代码与测试为准）

| 子阶段 | 契约要求 | 结果 | 状态 |
|---|---|---|---|
| P13a | 首页双入口、一句话输入、单一 AI 状态入口 | `apps/web/src/app.tsx` 已重写；e2e 首页截图与模板入口通过 | 已实现并验证 |
| P13a | 固定三栏工作台与 `data-testid` | `workbench-grid`、`thread-sidebar`、`game-preview`、`conversation`、`conversation-input`、`issue-banner`、`task-brief-card` 均存在；e2e 1280×800 同屏断言通过 | 已实现并验证 |
| P13a | 线程列表、继续话题、run 摘要、重启 `hydrate` | `/threads`、`hydrate`、`parentRunId` 已实现；`threads.test.ts` 覆盖 run.json（含 `guidanceCount`）/task-brief.json 落盘与恢复 | 已实现并验证 |
| P13b | `task-brief.ts` 纯函数 | 确定性、kind/pack/allowedOps、contracts、evidence、goal、constraints、acceptance 均有单测 | 已实现并验证 |
| P13b | TaskBrief preview API | `POST /task-briefs/preview` 已接线；e2e 修复任务卡通过 | 已实现并验证 |
| P13b | run 集成 `kind/threadId/parentRunId/issueId/brief` | `app.ts` 传入、`agent.ts` 四参 `start`；`threads/issues` 测试覆盖 | 已实现并验证 |
| P13b | 首次生成自动启动 | `app.ts` 按模型状态启动 `initial_generation`；e2e demo 通过；真实模型生成候选 v2 并 `ready_for_review` | 已实现并验证（真实模型） |
| P13b | 8 个新 PatchOp | `agent-tools.ts` schema/applyPatch/文案；`agent-ops.test.ts` 覆盖 | 已实现并验证 |
| P13c | `issues.ts` 生命周期 | 自动 upsert、dismiss、confirm、evaluate 三分支均有集成测试 | 已实现并验证 |
| P13c | Issue HTTP API + 问题条 + 最近 50 步 | e2e 问题条/repair brief/回退通过；`getRecentActions` 已接入 | 已实现并验证 |
| P13c | 真实 Issue 修复与同一检查回归 | 真实模型候选 v3；`reachable_goal` 与 `contract:c-reach` 由 failed 变 passed，两个问题单 `resolved`，浏览器 `won` | 已实现并验证（真实模型） |
| P13d | README、quickstart、实施状态、参赛差异化、排错表 | 已完成（见 §7） | 文档已完成 |
| P13d | 核心证据截图 | `creation-flow-2026-11-13/` 四个 PNG + README；真实模型 run 证据在 `p13-real-model-2026-11-13/` | 已完成（工作台截图为 demo，真实证据另附） |
| P13d | e2e 新主流程断言 | 5 条新增，全部通过 | 已完成 |
| P13d | 3 分钟演示与新手测试 | 未执行 | 未完成 |

### 3.1 P14 UI 验收（2026-11-13）

| 项 | 结果 | 证据 |
|---|---|---|
| 首页与工作台共用工程/会话左栏 | `ProjectSidebar` 共用；`thread-sidebar`、`project-list`、`session-list`、`new-context-button` 均存在 | e2e “shows the project sidebar on home and creates a new game from it” |
| 首页“新建游戏” | 创建 `未命名游戏` 空白工程并进入工作台；工程列表包含新工程 | 同上；URL 项目 id 与 seed 工程不同 |
| 工作台“新建会话” | 当前会话视图清空、输入框聚焦；发送示例回放后会话从 1 变 2，旧会话保留 | e2e “clears the current session from the workbench sidebar and keeps the composer usable” |
| 1280×800 无横向滚动 | 首页与工作台 `scrollWidth <= clientWidth + 1`；游戏与输入框同屏 | e2e 两条 1280 断言（P13 同屏 + P14 横向滚动） |
| 新 UI 截图 | `home.png`、`workbench-1280.png`、`projects-sidebar.png` 由 e2e 重新生成 | `docs/competition/evidence/creation-flow-2026-11-13/` |
| 文档界面描述 | README/quickstart 改为“左栏工程、顶部新建游戏/新建会话”；明示布局不是唯一差异化 | 见 §7 |

### 3.2 P15 深浅主题与可拖拽分栏（2026-11-13）

| 项 | 结果 | 证据 |
|---|---|---|
| 主题切换与刷新持久化 | 首页 `theme-toggle` 切 light：`html[data-theme=light]`，html 背景为浅色（RGB 三通道均 > 200，不锁死具体色值，主题配色可继续调整）；`localStorage.zaowan-theme=light`；刷新仍 light；再切回 dark | e2e “toggles the light theme on home and persists it across reloads” |
| 1280×800 两主题无横向滚动 | 首页与工作台均 `scrollWidth <= clientWidth + 1`；游戏与输入框同屏 | 同上 + “keeps both themes scroll-free…” |
| 拖动 `split-game` | 向上拖 90px 后 conversation 增高 >20px、input bottom ≤801；`zaowan:pane:game` 写入；刷新高度差 ≤12px；双击复位到默认 0.6 | e2e “keeps both themes scroll-free and persists a dragged game/conversation split” |
| 主题/分栏截图 | `home-dark.png`、`home-light.png`、`workbench-dark.png`、`workbench-light.png`、`workbench-resized.png` | `docs/competition/evidence/creation-flow-2026-11-13/` |
| 文档界面描述 | README/quickstart/status 增加双主题、拖拽分栏、尺寸持久化；明示这些只是体验优化，不是差异化 | 见 §7 |

可选分栏 `split-sidebar` / `split-inspector` 未纳入本轮自动断言（web-ui 已手工实测拖拽与 clamp）；本轮 e2e 只自动覆盖 `split-game`。

### 3.3 P16 自动体检、一键修复与三档审查（2026-11-14）

| 项 | 结果 | 证据 |
|---|---|---|
| 29 条本地规则 | 网格 12 / 知识 6 / 卡牌 5 / 对话 5 / 素材 1；打开版本或保存后自动跑，0 次模型调用 | tests/unit/lint.test.ts、tests/integration/lint.test.ts |
| 6 条算法一键修复 | 复用类型化补丁与底线检查；版本来源 algorithm；modelCalls=0；修复后自动验证并结算同版本问题单 | e2e “finds the unreachable key with local lint and fixes it in one click without AI”；algorithm-fix 截图 |
| 三档审查 UI/API | local / ai / both；运行验证按当前方式执行；可单独“只重新审查”；状态显示模型、调用次数、token | tests/integration/review.test.ts、tests/unit/ai-review.test.ts、e2e “runs the three review modes…” |
| 云端结论边界 | 只接受 summary/findings；quickFix/ops/patch 丢弃；不自动改配方；云端失败/跳过回退显示本地结论 | 同上；security 测试确认 Key 不在请求/响应/证据 |
| 右侧证据面板空白 | split-inspector 选择器写错导致拖拽条占满面板；修复后 1280×800 页签与结果在可视区上部 | e2e 验证列表/页签可见 |
| P16 体验项 | 验证结果 toast、游戏画面等比缩放、工程删除/回收站与撤销、任务拆解/执行反馈、真实试玩按钮、版本号 bump | e2e toast/stage、tests/integration/trash.test.ts、blind-repair 证据 |

云端审查的自动化测试使用本地替身模型，证明链路与密钥边界，不证明真实模型能力。2026-11-14 用 ModelScope 端点跑真实云端审查，返回 MODEL_AUTH_FAILED（1 次请求、无 findings），未重试；该项在 §4.1 保留为待补。

### 3.4 P17 素材、对话表现与画面控制（2026-11-14）

| 项 | 结果 | 证据 |
|---|---|---|
| 素材渲染 | 工作台上传图片/音频；素材页签“设为背景/设为音乐”写入 presentation.assets；工作台带 token 拉取素材并渲染舞台背景、BGM、卡面插画；音频仅接受 MP3/OGG/WAV（12 MiB），图片仍走 sharp 重编码 | asset-background.png、GET /assets/:assetId、e2e 通过 |
| 对话表现层 | 旁白在左下角，24ms 逐字；点击补全整句，再点推进；选项在正中半透明遮罩；Enter/数字键保持确定性；背景/BGM 走对话槽位；朗读用系统 TTS 可开关 | dialogue-presentation.png、e2e 对话键盘通关 |
| 画面控制 | 默认自动等比缩放；工具栏可关自动、−/＋/1:1，缩放 50%-200% 存 localStorage；1280/1024 不裁切 | stage-controls.png、stage-fit e2e |
| 新建/删除/提示 | 新工程骨架去掉样例剧情/示例题；工程/会话删除键 28px 无框；toast 深色底、3 秒、×；AI 设置两等分；版本显示“第 N 版·来源·来自” | 代码与手测 |
| 导出 | 小对话框选择网页版（无 Node）/便携版（含 Node，约 +80MB）；导出后自动触发浏览器下载；便携包内含 runtime/node.exe | 导出 API 实测 1.5MB vs 37.5MB zip |
| 卡牌基础 | HTML 卡面（费用/插画/名称/描述）、扇形与桌面平铺切换并持久化、对手意图卡、行动日志 | e2e 卡牌点击通过 |

未完成：导出包内嵌素材、对话按节点设置背景/音乐/语音、单词配对、编程积木、自定义游戏类型、样例加长、全量外观编辑器。

### 3.5 P18 导出素材、配对、积木与横板舞台（2026-11-14）

| 项 | 结果 | 证据 |
|---|---|---|
| 导出素材 | 导出 ZIP 写入 game/assets/<assetId>.<ext> 与 game/assets.json；播放器启动时读取并传给 GamePlayer；导出服务器补了 MP3/OGG/WAV MIME | 导出包实测含 assets.json 与 png；player 代码读取 |
| 节点级对话表现 | DialogueNode 增加 backgroundAssetId/musicAssetId/voiceAssetId；编辑器逐节点下拉选择；运行时优先节点背景/音乐/语音，语音文件缺失时回退系统 TTS | schema/editor/runtime 类型检查 |
| 单词配对 | QuizQuestion 新增 matching（pairs）；内核 select.pairs 判定、verifier 满分/失败序列、lint 一对一校验、playtest 点击、运行时两栏配对 UI、编辑器添加配对题；word-quest 33 题含 3 道配对 | 单元/集成/e2e 通过（待最终 verify 确认） |
| 组件积木 | 编辑器顶部“组件积木”：网格钥匙/门/守卫、题目单选/配对、卡牌攻击牌/敌人、对话旁白节点/结局；点击拼接后填参数；卡牌布局在“外观与声音”二级设置 | 手测 block-chip |
| 自定义类型 | 首页类型选择“我自己定义”；按描述映射到最接近的支持模式包，并在提示中说明边界 | 手测 option=custom |
| 外观/音频编辑器 | PresentationEditor 可改背景/地板/墙/强调/文字色、格子大小、声音、背景图、BGM、卡牌扇形/平铺；卡牌可改描述与插画素材 | 编辑器代码 |
| 横板舞台 | 游戏统一 16:9；工作台 622×350（1280），自动缩放留安全边；对话不再竖版；导出播放页同样横板 | 手测比例 1.78/1.92 |
| 提示样式 | 撤回 P17 的 toast 重设计；恢复原边框/阴影/关闭按钮，只把原底纹按主题加深 | CSS 原规则仅改 background |
| 卡牌表现 | HTML 卡面、插画、扇形/平铺、对手意图卡、最近行动；完整逐帧演出仍是后续 | e2e 卡牌通过 |

仍未做/未充分：积木是点击追加而非拖拽吸附；自定义类型不是任意新内核，只映射到 5 个受支持模式；卡牌没有完整逐帧敌方演出；导出包内嵌素材已做但未在导出游戏里逐项截图；真实云端审查仍缺。


### 3.6 P19 规则积木、加长样例与卡牌演出（2026-11-14）

| 项 | 结果 | 证据 |
|---|---|---|
| 规则积木 | 解谜/潜行编辑器把 GridRule 做成“当（事件）· 如果（条件）· 那么（效果）”三段积木，可增删改；事件限 item_collected / switch_activated / player_entered_zone / action_resolved，条件限 inventory_at_least / collected_at_least / flag_is（all/any/not/player_in_zone 仍在结构化数据里编辑） | editor.tsx rule-blocks + typecheck |
| 组件积木 | 按模式包的点击拼接：道具/门/守卫、单选题/配对题、攻击牌/敌人、旁白节点/结局 | editor.tsx block-palette |
| 加长样例 | 新增 deep-vault（19×9、2 钥匙、2 门、开关+机关门）、long-night（16 节点/4 标记/4 个可达结局）、arena-run（5 场战斗、12 种卡）；word-quest 30→33 题含 3 道配对；首页模板加到 8 个 | 三个新样例 verifier 全部 passed；long-samples 证据 |
| 反馈式修改 | 第一轮 verifier 报 dialogue_endings=failed（兜底结局排在最前 + 热可可条件互斥）与 arena RECIPE_INVALID（battles 上限 5、enemies 必须等于 battles）；按机制改完后同一 verifier passed | long-samples-2026-11-14/README.md |
| 卡牌演出 | 出牌/受击伤害红飘字、格挡蓝飘字、受击抖动；对手“最近行动”卡片化 | card-game.tsx + CSS |
| 导出包可双击运行 | 检查导出包结构时发现 recipe/manifest/assets 只在 ZIP 根目录，而 `server.mjs` 只服务 `game/`，播放器相对自身取 `./recipe.json` 会落空；改为 game/ 内也写一份，并给包内服务器补音频 MIME。真实跑包内 server.mjs：页面加载、素材 200、无控制台错误（此前 e2e 靠手工复制文件掩盖了这个缺陷） | exported-game.md、exported-game.png |
| 生成器 | tools/make-long-samples.mjs：网格 BFS 先证明可通关、对话图遍历证明无死路，再写盘，最后交生产 verifier | 运行输出“自检通过” |

边界：积木不是拖拽吸附；自定义类型只映射 5 个模式；卡牌演出不是逐帧动画；导出包内音视频播放尚未逐项自动化。


### 3.7 验证状态（2026-11-14 17:46，P20 后全量复跑）

- **全量 `node scripts/verify.mjs` 通过**：typecheck 95 文件、lint 110 文件、unit **94/94**、integration **39/39**、security **6/6**、e2e **23/23**、build（web/player/server）。
- unit 里有两条期望是本轮改的：原先写死“6 个样例 / 网格样例必为 partial”，因新增 3 个样例改为 9 个，并把 deep-vault 记为 passed（它的状态空间搜索可完整判定，没有留下 partial 项）。
- 三个新样例（deep-vault / long-night / arena-run）由生产 verifier 判定 **passed**，逐项 checks 见 long-samples 证据。
- 导出包真实运行：解压后用包内 `server.mjs` 启动，页面加载 canvas、背景素材请求 200、无控制台错误（见 exported-game.md / exported-game.png）。这一步同时修掉了“双击 Start-Game.cmd 会缺少 recipe.json”的真实缺陷。
- 13:25 曾出现一批 `listen EACCES: permission denied 127.0.0.1`（当时本机拒绝回环绑定：全局 TCP 仅 168 条连接、动态端口段 49152+16384 正常），17:00 后自行恢复，与代码无关；恢复后的复跑即上表结果。
- **仍未验证**：真实云端 AI 审查只有替身链路证据（ModelScope Key 返回 `MODEL_AUTH_FAILED`）；导出包内的 BGM/语音自动播放受浏览器手势限制，只验证了资源可取回与引用正确。

### 3.8 P20 入口可见性、回收站与默认浅色（2026-11-14）

- （P22 见 §3.10）
- **默认主题改为浅色**：`resolveTheme()` 由 `?? 'dark'` 改为 `?? 'light'`；`index.html` 直接带 `data-theme="light"` 与浅色 `theme-color`，首屏不会先闪深色；用户切换后仍按 `zaowan-theme` 持久化。e2e 主题用例改成“默认浅色 → 切深色 → 刷新保持 → 切回浅色”。

| 项 | 结果 | 证据 |
|---|---|---|
| 背景/音乐入口 | 工具栏新增“外观素材”，游戏画面左上角新增“＋ 插入背景 / 音乐”；素材页签顶部显示“当前背景 / 当前音乐”并可取消；上传区改为明确的虚线投放框（点选或拖拽），并写清尺寸/格式限制与三步用法 | e2e“finds the background upload…”；asset-insert.png |
| 积木入口 | 工具栏“编辑”改名为“积木搭建”，画面左上角“拼积木改规则”直达；编辑器里组件积木与规则积木同屏，组件积木标题写清“点击一块就加进配方” | e2e；blocks-entry.png |
| 回收站 UI | 回收站从裸 `ul/li` 改为卡片：类型图标、名称+类型徽章、版本数/体积/删除时间、还原与永久删除；永久删除改为二次确认（取消可退）；补上此前完全缺失的 CSS | e2e（含二次确认断言）；trash-ui.png |
| 文案同步 | 首页标题由“五个可以直接玩的模板”改为“八个”，页脚标注 8 个模板 | e2e 断言模板数 = 8 |

说明：这一步没有新增玩法机制，只把已经实现的素材/积木/回收站做成可发现的入口，并给入口补了自动化回归（e2e 22 → 23）。


### 3.9 P21 用户复查修正（2026-11-15）

| 项 | 问题 | 修正 | 证据 |
|---|---|---|---|
| 未保存但没有保存按钮 | 设背景/音乐会标记“有未保存修改”，但“保存为新版本”只在积木搭建模式出现 | 有未保存修改时任何模式都显示主色“保存为新版本”；标题栏改为黄色“有未保存修改”徽章 | e2e “restarts play from the editor…” |
| 重新试玩没反应 | 在积木搭建模式点它只重置了不可见的游戏；按钮保留焦点，Space/Enter 会再次触发它 | 点击后切回试玩、重建游戏、移走焦点，并用 toast 说明；有未保存修改时提示“修改要先保存” | 同上（断言画布出现、焦点不在按钮、toast 文案） |
| 新建游戏总是解谜逃脱 | 首页“新建游戏”写死 packId=puzzle | 弹出“新建空白游戏”对话框：填名字 + 选 5 种玩法之一，生成该玩法的最小空白骨架（无样例） | e2e “shows the project sidebar…”（选对话叙事 → packId=dialogue、sample=null） |
| 缩放控件位置 | 在画面上方工具行，带按钮底纹 | 浮在游戏窗口右上角，无底纹、白色线条图标（自动适应 / − / 百分比 / ＋ / 1:1），阴影保证亮背景可读 | e2e 断言位置、color=白、背景透明、无边框；stage-corner-controls.png |
| 模板操作条压住关卡 | “试玩一下 / 让 AI 改一个地方 / 导出”绝对定位在画面底部，盖住玩家与出口 | 改为画面下方正常流，StageFit 自动让出空间 | stage-corner-controls.png |
| 删除工程触发 EPERM | Windows 上刚结束的任务还持有文件句柄时 rename 失败 | 回收站移动/还原遇 EPERM/EBUSY/EACCES 最多重试 4 次 | tests/integration/trash.test.ts |

本轮验证：typecheck 96 文件、lint 111 文件、unit 91/91、integration 39/39、security 6/6、e2e 24/24、build 通过。

### 3.10 P22 拖拽吸附积木、软锁死检测与云端实测（2026-11-15）

| 项 | 结果 | 证据 |
|---|---|---|
| 积木拖拽吸附 | 交接项 #2 完成。原生 HTML5 DnD（draggable + dataTransfer，零第三方库）：组件积木拖到地图格子落位（墙/占用格拒绝），对象可拖到新格移动；规则积木 = 工具箱（帽子/条件/动作三类色块）+ 当/如果/那么三个吸附区，拖入吸附、拖回拆下、错区红字拒绝、堆内拖动重排，“放入配方”提交为类型化 GridRule。点击/键盘路径保留 | e2e“snaps draggable blocks…”（真实鼠标拖拽+重试）、block-snap.png |
| 软锁死检测 | 交接项 #3 完成。findSoftlocks 枚举可达状态、反向求“还能赢”吸引子、报告临界死局（lost 属硬失败不计）；grid_softlock_free 并入网格验证画像 | unit 6 条：竖井陷阱 found、四样例 clean |
| 消融实验 | 交接项 #4 部分完成：算法优先臂 3/3（lint 1 条 → quickFix 1 → verify passed，模型调用 0，~130ms）；纯 AI 臂如实 blocked（无有效推理 Key） | ablation-2026-11-15/ |
| 真实云端审查 | 交接项 #1 未成功但结论更准：Key 对 GET /v1/models 200、chat 端点“模型认证失败”（生产链路真实 1 请求，非替身）；review.json 存 ai.status=failed + 本地回退 | cloud-review-2026-11-15/ |
| 1024 自动化断言 | 交接项 #5 完成：无横向溢出、抽屉开合、输入框滚动可见 | e2e 新增用例 |
| 演示录屏 | 成品 `demo-video-2026-11-15/demo-3min.webm`（1280×720，约 3–4 分钟，真实 Edge 驱动真实 UI；AI 段=示例回放标注，不冒充模型） | webm + README |
| 新手测试 | 协议+模板就绪（usability-test-kit.md、observation-template.csv），未执行、无结果 | docs/competition/ |

边界：原生 DnD 无吸附动画/音效；规则积木不支持 all/any/not 嵌套；超大状态空间软锁死按预算返回 unknown；纯 AI 臂、成功云端审查、新手实测仍是缺口。

### 3.11 P23 真实云端审查成功、消融补全与字段暴露修正（2026-11-15）

| 项 | 结果 | 证据 |
|---|---|---|
| 真实云端 AI 审查 | **交接项 #1 闭环**。有效 Key（ModelScope `Qwen/Qwen3.8-Flash-Next`）走生产链路：连接测试 ok（含 toolCalling）；both 档真实审查 33.6s、**1 次调用**（prompt 671 / completion 1851 tokens）；AI 结论正确且比本地更细（指出 collected_at_least 与 at_exit 双双不可满足），只有 suggestedGuidance、无 quickFix/ops，UI 上 AI 条目不给一键修复按钮。上一把 Key 的失败样本保留未删 | cloud-review-2026-11-15/（review.json、model-usage、review-ui.png、README） |
| 消融实验补全 | **交接项 #4 闭环**。同一夹具：算法优先 ×3 = **0 次调用 / 92–104ms**、verify passed；纯 AI ×1 = **8 次调用**、运行终态 ready_for_review（runId 可回放核对；122.8s 是脚本轮询上限，不是真实耗时，见 ablation README 勘误）。命令与自动配置（MS_KEY 环境变量）已写进工具 | ablation-2026-11-15/results.json + README |
| 卡牌布局字段 | 修掉模式串味：**“卡牌布局”只在卡牌工程出现**，“格子大小”只在解谜/潜行出现（此前全类型显示）。主题色五件套是 Presentation 共享字段，保留全类型 | editor.tsx；typecheck 通过 |
| 演示录屏（真实模型版） | record-demo.mjs 支持双模式（有 MS_KEY=真实运行，无=示例回放标注），正在以真实模型重录干净版 | demo-video-2026-11-15/（执行结果见本节末与 README 更新） |

边界：真实模型修复臂单次样本（n=1），不做统计学显著性宣称；录屏为一次性脚本录制，未剪辑。

## 4. 未实现 / 未验证（不得写成已完成）

### 4.0 交接给后续 AI 的剩余项（按建议顺序）

1. 真实云端 AI 审查：**已完成（2026-11-15 有效 Key）**。both 档真实审查 1 次调用、findings 正确、契约行为符合（无 quickFix/ops、失败回退有历史样本）。见 cloud-review-2026-11-15/。
2. 积木拖拽吸附：**已完成（P22）**。原生 HTML5 DnD：组件积木拖到地图格子落位、实体拖格移动；规则积木工具箱 + 当/如果/那么三段吸附区，拖回拆下、错区拒绝；点击/键盘路径保留。e2e“snaps draggable blocks…”覆盖。
3. 软锁死检测：**已完成（P22）**。findSoftlocks 反向吸引子算法 + grid_softlock_free 检查；竖井陷阱 fixture 报 found，四个样例网格全 clean。
4. 消融实验：**已完成**。算法优先 ×3：0 次调用、92–104ms、verify passed；纯 AI ×1：8 次调用、ready_for_review（用时数据作废，见勘误）。多夹具对比改用 `pnpm bench`。复跑：设 MS_KEY 后 `node tools/ablation-experiment.mjs`。
5. 1024 抽屉自动化断言：**已完成（P22）**：溢出/抽屉开合/输入框可见。
6. 演示录屏：**已录成** `demo-video-2026-11-15/demo-3min.webm`（真实 UI；AI 段=示例回放标注，不冒充模型；拿到有效 Key 后应重录真实模型段）。新手可用性测试：**未执行**（协议 usability-test-kit.md + observation-template.csv 已备好，禁止伪造结果）。干净机/断网/只读目录：**未执行**（docs/clean-machine-checklist.md）。
7. 自定义类型仍只映射到 5 个模式包，不生成新内核；文案保持“映射到最接近的支持模式包”，不得写“任意类型”。

### 4.1 P13 证据缺口

1. **真实模型证据已完成**：`p13-real-model-2026-11-13/` 含 `mode:'model'` 的 task-brief、events、前后 recipe、checks/report、playtest 截图；没有用 demo 冒充。
2. **`initial-generation.png` 仍是 demo 工作台截图**：它只证明 UI 显示与接线；真实生成证据看 `p13-real-model-2026-11-13/generation/`。
3. **1024 宽自动化断言未加**：web-ui 已手动实测 1024 抽屉（左 280/右 340、输入 bottom=705<768），但本轮 e2e 只自动断言 1280×800。
4. **3 分钟演示与新手可用性测试**：演示 Runbook 已写（[demo-3min.md](demo-3min.md)），但录屏与新手测试未执行；不伪造参与者、成功率或耗时。
5. **历史证据目录不完整**：`real-model-2026-11-13/`（P6）缺 `run.json` 摘要与 README；其 `events.jsonl`、`model-usage.json`、`checks.json` 与 `playtest.json` 可核对。

#### 4.1.1 P16 未完成 / 未验证

1. **真实云端 AI 审查**：ModelScope 调用返回 MODEL_AUTH_FAILED（1 次请求），没有真实 findings；e2e 用替身模型覆盖链路。换有效模型后需重跑一次三档中的 ai/both，并把 review.json 与 model-usage.json 存档。
2. **软锁死检测**：玩到某一步后再也赢不了，需要状态搜索，未实现。
3. **“纯 AI 修” vs “算法优先 + AI 兜底”消融实验**：需要真实模型多次运行，未做。
4. **真正空白新建 / 版本列表来源展示**：本轮未复核完成度；如果 UI 未显示来源，不得写成已完成。
5. **1024 宽自动化 e2e**：仅有手动实测；自动断言仍只覆盖 1280。
6. **3 分钟演示、新手可用性测试、干净机/断网/只读目录**：未执行。

### 4.1.2 P17 未完成 / 未验证

1. **导出包素材**：工作台内背景/音乐/卡面已渲染，但导出 ZIP 尚未内嵌素材；导出后的游戏会退回主题色。
2. **按节点表现**：对话目前用项目级 background/music + 系统 TTS；每个节点单独背景/音乐/语音尚未做。
3. **单词配对、编程积木、自定义游戏类型、样例加长**：未实现，避免半成品。
4. **卡牌表现层**：HTML 卡面/布局/对手意图已基础完成，插画素材可显示；动画、完整敌方出牌演出、卡面自定义仍待做。
5. **真实云端审查**：仍因本次 MODEL_AUTH_FAILED 未取得证据。

### 4.1.3 P18 边界

1. **积木**：当前是可点击的组件块，不是编程猫式拖拽/吸附/嵌套；生成的是受 schema 约束的配方组件。
2. **自定义类型**：按关键词映射到 puzzle/stealth/quiz/card/dialogue，不能凭空生成新内核；提示中已说明。
3. **卡牌演出**：意图卡、最近行动、卡面/布局已完成；逐帧攻击/受击动画、完整敌方出牌序列未做。
4. **导出素材**：已复制并加载；音视频在导出包中的实际播放尚未逐项自动化。
5. **真实云端审查**：仍因 MODEL_AUTH_FAILED 未验证。

## 4.2 长期边界（与 P13 无关）

1. **world 包未实现**：按裁剪顺序先砍；首页、README 与产品文案只声明 5 个模式包。
2. **干净 Windows 机器 / 启动器双击 / 中文与空格路径 / 断网 / 只读安装目录**：未验证；本机已完成包内 server 启动 smoke（§2.1），不等于干净机验收。
3. **新手可用性测试**：未执行。
4. **工程包导入接口**：未实现。
5. **素材图片渲染**：上传与清单可用，运行时尚未按素材 key 绘制图片。
6. **视频证据**：未录制；证据目录只保留截图与输入轨迹。

## 5. 复核命令

```bash
node scripts/typecheck.mjs
node scripts/lint.mjs
node scripts/test.mjs unit
node scripts/test.mjs integration
node scripts/test.mjs security
node scripts/test.mjs e2e   # 本机 Edge/Chrome；也可先设 ZAOWAN_CDP_URL
node scripts/build.mjs
node scripts/verify.mjs     # 串行执行以上必需项（含 e2e）
```

正常开发机可直接用等价脚本：`pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm test:integration`、`pnpm test:security`、`pnpm test:e2e`、`pnpm build`。失败就保留失败，不要写成通过。

## 6. 下一步

1. 配好有效模型后跑一次真实云端 AI 审查（ai 或 both），保存 review.json / model-usage.json；验证 ai 失败时的本地回退与提示。
2. 1024 宽自动化断言；3 分钟演示与新手可用性测试。
3. 软锁死检测（状态搜索）与“纯 AI vs 算法优先”调用次数消融实验。
4. 干净机、断网、只读目录与启动器双击按 docs/clean-machine-checklist.md 人工验证。

## 7. 本轮改动（2026-11-13 / 2026-11-14）

| 文件 | 改动 |
|---|---|
| `README.md` | 按 P13 主流程重写，并补充 P14 工程/会话左栏、P15 双主题与拖拽分栏，以及“布局/主题不是唯一差异化” |
| `docs/quickstart.md` | 5 分钟路径 + 左栏说明 + 双主题/拖拽分栏/刷新保持/双击复位 |
| `docs/implementation-status.md` | 本文件；实际测试数字、P13/P14 状态与未验证项 |
| `docs/competition/README.md` | 参赛导航与“与 DSH/Godot 的差异（方案 §7）” |
| `docs/competition.md` | P13 状态提示、过期表述修正、差异化段落指引 |
| `docs/troubleshooting.md` | P13 报错到动作的映射表 |
| `tests/unit/task-brief.test.ts` | 任务编译器 10 条单测 |
| `tests/unit/agent-ops.test.ts` | 8 个新 PatchOp 与非法输入 7 条单测 |
| `tests/integration/issues.test.ts` | Issue 自动生成/去重/dismiss/repair 启动/回归 7 条 |
| `tests/integration/threads.test.ts` | 线程落盘、hydrate、interrupted 3 条 |
| `tests/e2e/browser.test.ts` | 5 条 P13 + 2 条 P14 + 2 条 P15 e2e；共 18 条 |
| `docs/competition/evidence/creation-flow-2026-11-13/` | 新增 home-dark/light.png、workbench-dark/light/resized.png（保留 home.png、workbench-1280.png、projects-sidebar.png、issue-fix.png、initial-generation.png）与 README |
| `apps/server/src/ai-review.ts` | 三档审查：本地/云端/两者；只接受 summary/findings，丢弃 quickFix/ops；失败/跳过可回退本地结论 |
| `apps/server/src/app.ts` | `/lint`、`/quick-fix`、`/review`、`/review-mode`、回收站/工程删除、真实试玩等路由 |
| `packages/verifier/src/lint.ts` | 29 条本地规则；6 条带算法 quickFix |
| `apps/web/src/inspector-panel.tsx` | 审查方式选择、AI 审查状态、体检列表、一键修复/让 AI 修；右侧面板 CSS 修复 |
| `apps/web/src/workbench.tsx` | 审查模式持久化、运行验证按模式审查、云端失败回退本地、体检随版本自动刷新 |
| `apps/web/src/toast.tsx`、`stage-fit.tsx`、`project-actions.ts` | 右上角 toast、游戏画面等比缩放、工程删除/回收站撤销 |
| `tests/unit/ai-review.test.ts`、`tests/unit/lint.test.ts`、`tests/unit/plan-version.test.ts` | 云端审查解析、29 条规则、计划/版本号 |
| `tests/integration/review.test.ts`、`tests/integration/lint.test.ts`、`tests/integration/trash.test.ts` | 三档 API、体检/一键修复、回收站与会话删除 |
| `tests/e2e/browser.test.ts` | 22 条（P16 新增体检/一键修复、toast、等比缩放、三档审查） |
| `docs/competition/evidence/algorithm-fix-2026-11-13/`、`experience-polish-2026-11-14/` | 体检/修复截图、三档审查/toast/缩放截图与 README |

## P16 历史走查（2026-11-13，仅作背景）

> 以下为 2026-11-13 的旧走查记录；其中多项已在 2026-11-14 完成，当前状态以 §3.3 为准。

以《造玩工坊_P16_体验打磨与算法优先方案.md》为准。当时核实的问题：

1. **比赛硬要求不达标**：Agent 没有任务拆解步骤；`apps/server/src/agent.ts:143` 写死“每步只做一次”的单程流程；现有三次真实修复运行的工具结果均一次通过，修复类指令直接给出坐标，不能作为“基于执行反馈的修改”的证据。
2. **验证面板“运行真实试玩”按钮只重跑规则验证**（`apps/web/src/inspector-panel.tsx:166` 绑定 `onVerify`），部分验证永远无法推进为通过。
3. （已修 2026-11-14）网格画布不随窗口等比缩放，1077 宽实测被裁切；现由 stage-fit 等比缩放并有 e2e。
4. 导出包的 README 与启动脚本引用 `runtime/node.exe`，但导出包中并不包含该文件。
5. 对话包“空白骨架”带着样例剧情。
6. （部分已修 2026-11-14）项目与会话已可删除/回收站，验证结果已改 toast；对话包背景/音乐/语音与卡牌/对话表现层仍需重做。

## P16 进度（2026-11-13 旧快照；2026-11-14 状态以 §3.3 为准）

- **任务拆解与执行反馈闭环：已实现**。`submit_plan` 工具、诊断优先工作流（删除“每步只做一次”）、后端按检查结果判定子任务、`feedback_fix` 自动识别、时间线“任务拆解 / 基于执行反馈的修改”两张卡、`prepare_review` 计划门槛。demo e2e 断言 `plan` + 1 次 `feedback_fix` + `plan.json` 含 passed。
- **真实模型盲修：已通过**（8 次请求 / 5730 tokens；基线失败 → 5 步计划 → 补丁 → 复测通过 → 浏览器通关；`feedback_fix` 1 次）。证据 `docs/competition/evidence/blind-repair-2026-11-13/`。模型顺带移动了出口，属指令未禁止的额外修改。
- **“运行真实试玩”按钮：已修**。新增 `POST /api/projects/:id/playtest`（不调用 AI），复用 `run_browser_playtest` 工具，记录回放证据并复验。
- **版本号：已实现**。采纳时选小修改 +0.1 / 大修改 +1；内部 ID 不变。
- **示例图**：`apps/web/public/examples/` 两张 PNG（用户提供）+ 四个 HTML 绘制示例；构建时复制到 `apps/web/dist/`。
- 旧快照测试数字（已过时，以 §2 为准）：typecheck 85；unit 76；integration 25；e2e 18。
- **算法体检与一键修复：已实现**。`packages/verifier/src/lint.ts` 共 29 条本地规则（网格 12、知识 6、卡牌 5、对话 5、素材 1），其中 6 条带算法一键修复（钥匙在门后、实体在墙里、实体重叠、门缺道具、卡牌费用超能量、牌组悬空引用）。`GET /api/projects/:id/lint`、`POST /api/projects/:id/quick-fix`（复用补丁通道与契约检查，版本来源记为 `algorithm`，`modelCalls: 0`，并自动结案同一版本的问题单）。验证页签显示“自动体检”列表，每条有“一键修复”和“让 AI 修”。体检结果自动附进 Agent 首条消息，模型不必再花调用做诊断。证据：`docs/competition/evidence/algorithm-fix-2026-11-13/lint-before.png`、`lint-after.png`。
- **右侧证据面板被挤出可视区（B5）：已修**。原因是 `.split-inspector` 样式选择器从未命中（该名字只是测试 id），拖拽条成了满高的弹性子元素，把标题、页签和内容压到面板底部；e2e 现断言 1280×800 下页签位于可视区上部。
- 尚未做：软锁死检测（需状态搜索）、“纯 AI vs 算法优先”调用次数消融实验。
- 旧快照测试数字（已过时，以 §2 为准）：unit 84；integration 26；security 5；e2e 19。
- 已补做（2026-11-14）：游戏画面等比缩放、工程删除/回收站与撤销、右上角 toast、三档审查（本地/云端/两者）、右侧证据面板 CSS 修复。
- 仍未做：软锁死检测、纯 AI vs 算法优先消融、真正空白新建、版本来源展示、导出网页版/便携版、外观与声音、对话表现层、卡牌重做、配对题、样例加长、图层面板。


## 8. 2026-11-16 · 对话续写去向与结局末句修复

- 用户反馈「长夜渡轮自己写的下一句没地方设去向」。原因一：发行包内是旧前端，积木编辑器的去向操作（在后面接一句 / 接下来：接到某一句 / 让玩家选择 / 这里结束 / 分支选项 / 结局与标记编辑）已在源码但没进包；已重建包并核对 src 与包内 app.js 哈希一致（zip sha256 78ef4212…）。
- 原因二是真实缺陷：对话在终点节点进入瞬间即判定结局，结局面板只显示结局文本，**作者写在最后节点的那句玩家永远看不到**。已修：结局面板在结局标题前渲染最后节点文本（testid dlg-final-line），与结局正文相同则不重复。
- 新增测试：tests/unit/dialogue-edit.test.ts（13 条去向操作纯函数测试）、tests/e2e/dialogue-editor.test.ts（真实浏览器：在后面接一句→写台词→去向选择器校验→保存新版本→试玩到结局页看到新句子→后端复跑验证 passed）。
- 当前全量：unit 129 / integration 41 / security 8 / e2e 28 全通过（scripts/verify.mjs 整体 exit 0）。证据截图：docs/competition/evidence/mode-packs-2026-11-13/dialogue-editor-blocks.png、dialogue-new-line-played.png。

## 9a. 2026-11-16 · 知识闯关白块与居中（用户实测）

- quiz 组件此前硬编码浅色（唯一未接入 --game-* 固定深色主题的运行时组件），深色画面中呈纯白卡片；配对题按钮无样式。已全量改用 var(--game-*, 深色回退)，补配对按钮视觉态，根层 flex 居中。浏览器渲染断言 + 前后截图：docs/competition/evidence/quiz-theme-fix-2026-11-16/。详见 docs/devlog/011。

## 9. 2026-11-16 · 魔搭 Docker 创空间部署（submission/docker）

- 平台仅支持 Gradio/Streamlit/Static/Docker；选 Docker 路线，submission/docker 为可直接推送创空间仓库的完整目录（Dockerfile 在根、node:24-bookworm-slim、监听 0.0.0.0:7860、持久化 /mnt/workspace、无镜像内构建步骤）。
- 为平台适配的代码改动：API 会话认证新增自定义头 X-Zaowan-Session（Authorization 为平台保留头；本地兼容保留）；外部模式 Host/Origin 策略与 CSP frame-ancestors 按平台实际域（创空间页面 *.ms.show、网关重写 Host 为 *.fcapp.run、iframe 预览）调整——首轮白屏根因是 Origin 白名单只写了 modelscope.cn 且把"Host 同机"当兜底，module script 必带 Origin 导致入口 JS 被自己 403；现对平台域族放行、陌生 Origin 记录不拦（防 CSRF 依赖随机会话令牌 + 严格 CSP + 本地模式硬拒绝不变）。
- 公共实例凭据：允许填写模型 Key 并持久化到空间数据卷（重启不丢、页面不回显 Key、警告常驻说明访客共用）；本地版维持只存内存。删除类路由提供 POST 别名绕开平台网关对 DELETE 的拦截（实测 403）。镜像内置 Chromium，云端可真实试玩。
- 外部模式带逐请求日志（REQ method url -> status host origin）与 SOFT-ORIGIN 记录，云端排障只看运行日志即可定位。
- 事故如实记录（docs/devlog/010 追加）：一次"整读整写"把 app.ts 尾部约 300 行截断（已从上一版完整编译产物逐段还原并 typecheck/全量回归确认）；一次注入脚本反斜杠转义把内联引导脚本变成注释导致 26/28 e2e 红（已改为无转义依赖写法 + HTTP 抓页 new Function 语法校验）。
- 真实域组合冒烟 7/7；scripts/verify.mjs 全绿（typecheck/lint/unit 129/integration 41/security 8/e2e 28）；发行包与 submission/docker 同步重建。
- 未验证（如实）：镜像在 Linux 平台的真实构建（本机无 Docker、未安装）；容器内无浏览器时 Agent 的浏览器试玩步骤如实报"受阻"。构建报错排查入口见 submission/docker/README.md。
