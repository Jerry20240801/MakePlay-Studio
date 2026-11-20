# 开发手记 001 · 2026-11-12

## 目标

从零实现《造玩工坊》首版：可信内核、真实运行界面、验证与证据、Agent 工具链、五套样例与导出包。

## 环境实测

- 工作目录：C:\Users\czj\Desktop\参赛2，Git Bash（MSYS），无全局 Node。
- 找到随应用的 Node 24.21.0 与 pnpm 11.28.5（C:\Users\czj\.dsh\...\dsh-primary-runtime）。
- 网络：curl 因 schannel 凭据失败，Node fetch 正常；pnpm 通过 registry.npmmirror.com 安装成功。
- 关键限制：Node 的 child_process.spawn 一律 EPERM；Chrome/Edge 启动后因命名管道被拒绝退出。

## 第一次尝试与失败

1. pnpm 默认隔离布局下 vitest 无法解析 @vitest/utils。改为 hoisted 布局，且在 pnpm 11 中配置必须写在 pnpm-workspace.yaml（.npmrc 与 package.json 的 pnpm 字段都不生效）。这个坑花了 4 次重装才发现。
2. Vitest/Vite 依赖 esbuild 子进程，启动即 EPERM。决定改用 Rollup（纯 JS）+ TypeScript 编译器进程内调用，并自研最小测试框架，保持 describe/it/expect 语义。
3. 样例地图最初用字母标记实体，被语义校验拒绝（只允许 . 与 #）。修复生成器：字母只作设计标记，写入前统一替换为地板。
4. 测试夹具 helper 把 rows 直接展开到配方顶层，产生 "Unrecognized key: rows"；改为解构后再组装 board。
5. 知识内核连击加成从第 1 题就生效，金标期望 10 分却得到 15 分。判断是语义问题而非测试问题：把加成改为基于「答对前的连击数」。
6. 素材上传的文件名清洗只替换非法字符，仍保留 .. 路径片段。安全测试抓到后改为 basename + 去掉前导点。

## 采用的取舍

- 不做「四个包同时开工」：先把网格内核与验证打通，再做知识、卡牌。
- 契约保护放在补丁应用后的全量契约检查里：受保护契约失败即拒绝补丁；可达性不阻塞中间编辑。
- 浏览器证据代码按文档实现（真实按键、只读桥、截图、控制台），但本机无法执行，状态标记受阻，不伪造通过。
- 示例回放醒目标记「未调用真实模型」，不计入成功率。

## 实际结果

- 单元 40、集成 8、安全 5 全部通过；typecheck 与 lint 通过；三份构建产物生成。
- package:win 生成完整包并记录 sha256；test:dist 结构检查通过。
- 浏览器 E2E、真实模型、干净机、新手测试：未完成，原因见 implementation-status.md。

## 下一步

在普通 Windows 上复测浏览器 E2E；配置真实模型端点完成一次真实修复；补工程导入与素材渲染。

## 快照

本次所有产物均在 C:\Users\czj\Desktop\参赛2，未提交远程仓库；构建身份由每次验证的 buildId 记录。
