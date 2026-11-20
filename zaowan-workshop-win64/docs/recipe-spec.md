# 玩法配方规范（schemaVersion 1）

配方是游戏定义，不是存档，也不含密钥、测试结果或权限。

## 顶层

| 字段 | 说明 |
|---|---|
| schemaVersion | 固定 1；未知版本拒绝 |
| pack | { id: puzzle/stealth/quiz/card, version: 1 }；不属于当前包的字段被拒绝 |
| meta | 名称（≤60）、说明（≤800）、操作说明 |
| presentation | 主题色、格子尺寸 16～96、音效开关、素材引用 |
| generation | handwritten/model；可记录地图种子，但不宣称模型结果可完全复现 |

## 网格包（puzzle / stealth）

- board：宽高各 5～20，rows 只含 . 与 #，必须封闭边界。
- player：恰好 1 个出生点、初始朝向。
- entities（≤64）：
  - item：道具类型、数量 1～99，拾取后消失。
  - door：requires { itemType, count 1～3 }，只在正面交互时打开并消耗。
  - gate：openWhen 为标记表达式，不消耗钥匙。
  - switch：set/toggle 一个已声明标记。
  - guard：显式巡逻点 2～16 个，连续点与首尾必须四邻接；clock 基准 successful_move/action，频率 1～3。
  - exit：恰好 1 个。
  - zone：格集合，用于区域事件。
- flags：≤16 个，必须声明初始值。
- rules（≤32）：事件 item_collected / switch_activated / player_entered_zone / action_resolved；条件见下；效果 set_flag / add_score / show_message，每条 ≤4 项。
- goal：at_exit、flag_is、collected_at_least、score_at_least、all、any；最终胜利必须必然包含 at_exit。

条件：flag_is、inventory_at_least、collected_at_least、player_in_zone、all/any/not；布尔深度 ≤3，节点 ≤16。

add_score 只能绑定 item_collected，按每个道具最多收集一次计算保守上限，总分 ≤9999。

## 知识包（quiz）

- questions 1～200：single_choice / multi_choice（2～6 选项）、true_false、short_text（答案 ≤60 字，别名 ≤8）。
- 每题必须有 source 或 reviewed: true；模型生成题一律 reviewed: false，导出前需用户确认。
- lives 1～9，pointsPerCorrect 1～100，comboBonus 0～100，最大可达总分 ≤9999。
- 判分：单选恰好一个、多选集合完全相等、判断布尔一致、填空先做全角半角/空白/大小写归一化再与答案键或显式别名精确比较；不做模糊匹配。

## 卡牌包（card）

- cards 5～40：费用 0～5，效果 ≤4 项，且只能来自冻结关键词：damage、block、apply_vulnerable、apply_weak、gain_strength、draw、gain_energy、exhaust、retain。
- deck 5～20，同名 ≤3，牌库总量 ≤40。
- enemies 数量必须等于 run.battles（1～5），每个敌人 1～999 生命与确定性意图脚本。
- run：startingHp 1～999、energyPerTurn 1～5、固定 seed、rewardChoices=3。
- 公式：攻击伤害 = 基础值 + 力量；目标易伤则 floor(×1.5)；先扣格挡再扣生命；敌人虚弱让其攻击 floor(×0.75)。

## 状态键与确定性

- 影响后续状态的字段必须进入状态键：玩家/守卫位置与朝向、巡逻索引、库存、累计收集、已拾取、门/机关状态、pending、标记、分数、守卫时钟余数；卡牌另含牌堆顺序、弃牌堆、消耗堆、手牌、能量、格挡、力量、状态层数与 RNG 计数。
- actionIndex 等无界计数不进入状态键，只保留影响时序的余数。
- 网格与知识包 gameplay 不消费随机数；卡牌包只在洗牌时消费，并记录 rngCount。

## 对话叙事包（dialogue）

- 顶层：schemaVersion、pack（id=dialogue, version=1）、meta、presentation、generation。
- dialogue.startNodeId 必须存在；maxSteps 10～200，防止无限循环。
- flags ≤16，必须声明初始值；节点/选择/结局引用未声明标记会被拒绝。
- nodes 1～80：id、speaker（≤40）、text（1～600）、choices（≤4）或 goto、set、reviewed。
- choices：id、text、require（标记表达式数组，AND）、set、goto；同一节点 choice ID 唯一，goto 必须存在（死链检测）。
- endings 1～8：id、title、require、text。终局节点（无 choices、无 goto）按 endings 顺序取第一条满足条件的结局；一条都不满足则记为 lost。
- 审核：AI 生成或修改的台词必须显式写 reviewed（true/false）；dialogue_text_reviewed 契约会检查该标记是否存在。
- 运行动作只有 advance / choose / restart；没有实时模型生成，运行时是配方驱动的确定性状态机。
