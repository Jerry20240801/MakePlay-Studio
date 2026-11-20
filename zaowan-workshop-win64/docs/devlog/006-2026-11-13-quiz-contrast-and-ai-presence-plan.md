# 006 · 2026-11-13：知识包选项不可读 + AI 在场感增强方案

## 修了什么

用户走查发现：单词远征的选项文字和背景同色，根本看不出选项内容。

根因不在知识包组件里，而在样式层叠：`apps/web/src/styles.css:24` 给所有 `button` 设了
`background: var(--zaowan-accent); color: #fff;`，而 `packages/runtime/src/quiz-game.tsx` 的选项按钮
用内联样式只覆盖了 `background`（白底），前景色仍然继承全局的白字 → 白底白字。
卡牌与网格界面的按钮都显式给了 `color`，所以只有知识包中招。

两处改动：

1. `packages/runtime/src/quiz-game.tsx` 选项内联样式补前景色（选中 `#1d4ed8`，未选 `#0f172a`），并留一行注释说明为什么必须显式给前景色。
2. `apps/server/src/playtest.ts` 知识包试玩分支：每道题作答前用 `getComputedStyle` 比对前景色与背景色，
   相同（或白字配白底/透明底）即 `ok=false`，把命中的 testid 与颜色写进 `playtest.json` 的 `trace` 和 `message`。
   这样同类问题以后会在真实浏览器试玩里直接失败，而不是等人眼发现。

## 验证

- `node scripts/typecheck.mjs`：通过（61 文件）。
- `node scripts/build.mjs`：web / player / server 构建成功。
- `ZAOWAN_CDP_URL=http://127.0.0.1:9222 node scripts/test.mjs e2e`：6 passed / 0 failed（含知识包真实点击通关，说明新加的配色守卫已实际执行且未误报）。

## 真实模型链路复核（P6 门槛）

复核 `docs/competition/evidence/real-model-2026-11-13/`，确认可信而非自称完成：

- `recipe-before.json` 钥匙 `key-1` 在 (4,4)、`recipe-after.json` 在 (2,1)，`door-1`/`exit-1` 未动。
- `run/playtest.json`：`ok=true`、`finalStatus="won"`、CDP 模式、14 步键盘轨迹。
- `run/model-usage.json`：6 次请求、3262 tokens；`run/plan-summary.json`：`ready_for_review`、`demo:false`。

## 顺带查出来的产品问题

那份真实运行的 `events.jsonl` 事件类型统计是 `run_status×7, tool_call×6, tool_result×6, patch×1, validation×1, evidence×1`
—— **一条 `model` 叙述事件都没有**。代码在 `apps/server/src/agent.ts:429-431` 只在 `response.content` 非空时发叙述，
而 `SYSTEM_PROMPT`（`agent.ts:82`）从未要求模型解释意图。这是"AI 参与感像预制菜"的第一条根因，
其余三条（事件流是给工程师看的技术串、运行中只有 cancel 没有插话、可信度没有任何标记）与对应设计一并写进
《造玩工坊_增强方案_AI在场感与新模式包.md》。

## 踩过的坑

- 全局 `button { color: #fff }` + 组件内联只改背景，是这一类"看不见文字"缺陷的通用成因；
  新 UI 样式若自定义背景，必须同时给前景色（已在 §3.G/§6 写进增强方案的注意事项）。
- 判定这类缺陷不能靠肉眼看截图：把可读性做成试玩断言（前景/背景计算样式比对）才能防复发。
