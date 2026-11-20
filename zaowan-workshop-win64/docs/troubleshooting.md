# 常见问题

## 启动

- 双击启动器提示 Cannot find module 'semver/functions/coerce' 等：完整包缺少嵌套依赖（旧版打包脚本会跳过 node_modules）。请使用本轮重新生成的包（zip 约 53.7 MiB，内含 node_modules 与 @img 原生文件）；旧包不可用。
- 提示 EPERM: mkdir ...ZaowanWorkshop：用户数据目录不可写。程序会依次尝试 %LOCALAPPDATA%、%APPDATA%、用户目录、临时目录与当前目录；也可设置 ZAOWAN_DATA_DIR 指定可写目录。
- 「尚未构建」：先运行 node scripts/build.mjs（或 npm run build）。
- 端口被占用：服务默认自动选择空闲端口；也可设置 ZAOWAN_PORT。
- 中文或空格路径：启动器与静态服务均使用绝对路径拼接，已按 Windows 路径处理；本机包未在干净机器验证。
- 数据写入失败：默认写入 %LOCALAPPDATA%/ZaowanWorkshop，可用 ZAOWAN_DATA_DIR 指定其它可写目录。

## 模型

- 401/403：Key 或端点错误，前端只显示摘要，不显示 Key。
- 429：限流，任务按预算停止，不自动无限重试。
- 「不支持工具调用」：需要兼容 Chat Completions 工具调用协议的服务，不能靠从任意文本里正则提取 JSON。
- 远程 Base URL 报错：必须 HTTPS；本地模型才允许 http://127.0.0.1。

## 浏览器验证

- 「浏览器不可用」：安装 Chrome/Edge；若 Node 无法创建子进程，请手动启动浏览器并开启远程调试（msedge.exe --headless=new --remote-debugging-port=9222 --user-data-dir=.build/edge-profile），再设置 ZAOWAN_CDP_URL=http://127.0.0.1:9222 后运行浏览器测试。
- E2E 未配置 CDP 时会明确失败，而不是静默跳过。

## 游戏

- 按键不生效：确认焦点在游戏画布，而不是聊天输入框；聊天框聚焦时不会驱动游戏。
- 门打不开：需要正面（面向门）按 E，且背包数量足够。
- 题库导出被拒绝：还有未审核题目，确认后可在导出请求中带 confirmUnreviewed。

## 导出

- 导出包无法启动：确认 runtime/node.exe 存在，或本机已安装 Node 20+。
- 源码重建失败：源码重建需要联网安装依赖；离线可运行不等于离线可重建。

## P13 工作台：报错与下一步

> 以下是 P13 工作台的报错动作映射（代码与自动化验证已完成）；如果某个入口在你的版本里还没出现，先用右栏“验证/版本”完成同样的事。

| 你看到 | 含义 | 主按钮 | 次按钮 |
|---|---|---|---|
| 验证 `failed` | 发现可复现的问题 | 让 AI 修复 | 手动定位 / 回退 |
| `partial` | 规则已通过，还没有真实浏览器通关证据 | 运行真实试玩 | 查看缺什么证据 |
| `BROWSER_UNAVAILABLE` | 现在不能自动试玩 | 查看浏览器设置并重试 | 只看规则检查 |
| `MODEL_AUTH_FAILED` | AI 连接或密钥有问题 | 打开 AI 设置 | 使用手动编辑 |
| `MODEL_PROTOCOL_UNSUPPORTED` | 这个端点不支持 Agent 工具调用 | 查看模型要求 | 更换模型 |
| `CONTRACT_VIOLATION` | AI 的改法碰到你确认的底线，已拦截 | 查看冲突 | 修改要求 |
| `BUDGET_EXCEEDED` | 这次任务没有收敛，未视为完成 | 拆成小任务继续 | 保留候选并检查 |
| 用户口述 bug 无法复现 | 还不能确认问题，不能说已修好 | 补充操作步骤 | 提供最近操作记录 |
| 任务终态后继续输入提示 409 | 该次运行已结束 | 继续这个话题（新建同线程 run） | 新建任务 |
| 重启后旧任务显示“服务重启，未继续执行” | 未完成任务被标为中断，不会自动重放 | 基于当前版本重新发起 | 查看历史证据 |

原始错误仍可在“查看为什么/技术细节”展开，但不应是唯一提示。
