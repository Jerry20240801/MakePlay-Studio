# 新增模式包证据（2026-11-13）

- dialogue-final.png：对话叙事样例「末班车」在真实 Edge 中通过键盘选择到达结局的截图。
- 对应自动化用例：tests/e2e/browser.test.ts 中 "plays the dialogue sample with real keyboard choices"。
- 验证画像：状态空间 BFS + 结局可达 + 死分支 + 占位符 + 重放动作；样例 8 节点、2 结局、4 条契约。
- world 包未实现（按增强方案裁剪顺序），本目录不包含其证据。
