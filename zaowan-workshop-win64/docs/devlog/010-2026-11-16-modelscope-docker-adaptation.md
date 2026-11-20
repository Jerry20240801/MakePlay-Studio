# 010 · 2026-11-16 · 魔搭 Docker 创空间适配与 submission 目录

## 背景

上交平台只支持 Gradio / Streamlit / Static / Docker 四种部署。本产品是 Node/Fastify + React 自托管架构，选择 Docker 创空间路线。按官方文档逐条适配，并生成 submission/docker（可直接推给创空间 git 仓库的完整目录）。

## 平台硬性约定 → 代码改动

| 平台要求 | 改动 |
|---|---|
| 服务必须监听 0.0.0.0:7860，端口不可改 | 已有 ZAOWAN_HOST/ZAOWAN_PORT；Dockerfile 固定注入 |
| 8080 被平台自带进程占用 | 未使用 8080 |
| **Authorization / X-modelscope-* / X-studio-* 为平台保留头，后端不得使用** | 会话认证新增自定义头 X-Zaowan-Session（前端全部请求同时携带；服务端接受两者之一。本地发行版行为不变） |
| 平台以自有域名反代到容器 | Host 回环检查与 Origin 白名单在 external 模式放宽：任意 Host 放行、Origin 仅要求与 Host 同主机名（防跨站仍有效） |
| 预览是 iframe 嵌入 | CSP frame-ancestors 由 'none' 改为 external 模式仅放行 https://modelscope.cn / https://*.modelscope.cn |
| 容器磁盘重启即丢，持久化只能 /mnt/workspace | Dockerfile ENV ZAOWAN_DATA_DIR=/mnt/workspace/zaowan-data（不可写时按既有回退链降级） |
| 实名认证后才可用 Docker 创空间 | 属账号操作，代码无关 |

## 公共实例的凭据安全（关键决策）

创空间是**所有访客共用一个容器**：任何人填的模型 Key 都会变成公共财产。因此镜像内 ZAOWAN_DISABLE_MODEL_CONFIG=1：

- PUT/DELETE/测试连接返回 403 MODEL_CONFIG_DISABLED；真实模型任务拒绝（403）；
- 设置页显示醒目横幅说明原因；示例回放不受影响且继续带"固定脚本，不计入成功率"标注；
- 评分要求的"真实模型基于执行反馈的修改"以 evidence 目录留档为准（本地发行包不受限，可自行复现）。

health 响应新增 model.disabled 字段。

## submission/docker 内容

Dockerfile（node:24-bookworm-slim + npm 运行时安装 + COPY . . + ENTRYPOINT node server.mjs）、
最小 package.json（fastify/zod/sharp/@playwright/test，server.mjs 外部依赖只有这些）、
apps/{server,web,player}/dist 构建产物、examples、README（平台约定对照表）。
运行证据复制进 apps/web/dist/evidence/，线上直接访问 /evidence/index.html 查看盲修/插话/试玩留档。
由 node scripts/build-docker.mjs 一条命令重建。

## 验证（本机无 Docker，未构建镜像；用等价的目录布局+依赖清单做真实启动冒烟）

- pnpm 按镜像同款 package.json 安装后，以镜像同款环境变量（0.0.0.0:17860、DISABLE=1、独立数据目录）启动；
- 原始 http 请求伪造平台 Host/Origin 实测 9 项全符合预期：health 200(model.disabled=true)、页面 200 且 frame-ancestors 放行 modelscope、/evidence/ 200、仅带 X-Zaowan-Session 创建项目 200、验证 200(partial=既有诚实口径)、PUT Key 403、模型任务 403、evil Origin 403、匿名 401；
- 全量回归：unit 129 / integration 41 / security 8 / e2e（见 verify 日志）全部通过；发行包重建。

## 未验证（如实）

- 镜像在 Linux 下的真实构建（npm 拉 @img/sharp-linux-x64 等）与魔搭构建器行为：本机没有 Docker，未安装、未实测。Dockerfile 全部是标准指令 + 官方 node 镜像；若平台构建失败，第一嫌疑是基础镜像拉取（换成平台文档给的 modelscope-registry 镜像源即可）与 npm registry 可达性（已默认 npmmirror）。
- 容器内无浏览器：Agent 任务的浏览器试玩步骤会如实报"受阻：浏览器不可用"，其余环节不受影响（README 已写明；镜像加 chromium 的方案写在注释里）。

## 追加：云端白屏的定性与两处返工（同日）

用户反馈云端"页面压根看不到"；另一 AI 判断为"没绑 0.0.0.0"。**该判断不成立**：

- 运行日志里 `已启动：http://127.0.0.1:7860/` 是代码打印的固定文案（url 变量写死回环，展示用），不代表实际监听；同一日志里 `数据目录：/mnt/workspace/zaowan-data` 证明 Dockerfile 的 ENV 已生效，而 ZAOWAN_HOST=0.0.0.0 与之同批注入；
- 反证：若真绑回环，FC 网关会连接失败并报错，而日志是成对的 `FC Invoke Start/End`（请求已到达应用）。

真正原因（都已修复并验证）：

1. 前端资源用绝对路径 `/styles.css`、`/assets/app.js`——应用被挂到子路径（如 `/proxy/7860/`）时，浏览器向站点根要文件，拿到平台页面 → 脚本 MIME 错误 → 白屏。已改为相对引用；api 请求全部改为相对路径；服务端外部模式在 HTTP 层（serverFactory）剥子路径前缀，静态解析逐段剥前缀，无结尾斜杠时引导脚本自动补 `/` 重载。
2. CSP `frame-ancestors 'none'` 拒绝平台预览 iframe；Origin 校验要求与 Host 同主机名，而平台会把 Host 重写成容器内网地址。外部模式已放行 modelscope 域并放宽 Host。
3. 外部模式加逐请求日志（`REQ GET /api/... -> 200 host=... origin=...`），以后云端出问题时，运行日志直接能定位。

必须如实记录的两处我方失误：

- **文件截断事故**：修改 app.ts 时用"整读整写"，整读被输出上限截断（1459 行只读回 1156 行），写回后文件尾部约 300 行丢失、构建产物缺路由导致云端服务起不来。已从上一版发行包内的完整编译产物逐段还原源码并补齐类型，typecheck/全量测试确认恢复。教训：改大文件只做定点编辑，禁止全量读改写。
- **注入脚本转义 bug**：尾部斜杠引导脚本里 `"\/"` 经字符串转义层变成 `//` 注释，整块内联脚本（含会话令牌注入）语法错误 → 所有 UI 测试 26/28 红。已改用无转义依赖的写法（String.fromCharCode 判断斜杠），并经 HTTP 抓取页面 + new Function 语法校验。

最终验证：typecheck 107 文件；unit 129 / integration 41 / security 8 / e2e 28 全绿；
studio 冒烟 7/7（根路径、子路径、Host 重写、evil origin 403、模型 Key 403）；
发行包重建 sha256=d42c071a…；submission/docker 与 zip 同步更新。

## 追加 2：白屏真凶落地——平台域是 ms.show，不是 modelscope.cn

运行日志证据：GET /assets/app.js host=*.fcapp.run origin=*.ms.show → 403。
外部模式 Origin 白名单只写了 modelscope.cn，且把 Host 相同当作兜底——而网关重写了 Host，
module script 又必带 Origin，于是入口 JS 被自己的防线拦截；CSP frame-ancestors 同样没放行 ms.show 内嵌。

修复：ms.show/fcapp.run 域族放行；陌生 Origin 从"拒绝"降级为"记录"（SOFT-ORIGIN）；
frame-ancestors 增加 ms.show 与 fcapp.run。防 CSRF 依靠的仍是随机令牌 + 严格 CSP。
本地发行版行为不变（严格）。复演真实域组合冒烟：页面/JS/API/无令牌 401/模型 Key 403/health 全对。

## 追加 3：公共实例改为"可填 Key + 显著警告"；回收站 403 修复（用户实测反馈）

- 云端实测：回收站删除报 403——本地同接口正常，判定为平台网关拦 DELETE 方法（FC/CDN 常见策略）。修复：三条删除路由（项目入回收站 / 回收站永久删除 / 会话删除）与模型配置清除同时注册 POST /xxx/delete 或 /clear 别名，共用同一处理函数、确认要求不变；前端统一改走 POST，本地版 DELETE 原方法保留（集成测试 41 条不变全过）。
- 模型凭据策略回退：应用户要求，公共实例不再硬禁（ZAOWAN_DISABLE_MODEL_CONFIG 机制删除）。设置页在 shared 模式下显示醒目警告（Key 只存容器内存、重启即失，但重启前所有访客共用），真实模型任务恢复可用；容器内仍无浏览器，试玩环节依旧如实报"受阻"。
- 冒烟（真实容器等价环境 + 平台域组合）：PUT Key 200、health model.shared=true、POST clear 200、POST project/delete 200 入回收站、POST trash 永久删除 200、legacy DELETE 200。

## 追加 4：公共实例 Key 持久化 + 镜像内置 Chromium（实例所有者决定：不设填写限制）

- ModelConfigStore 支持 attach 数据卷文件（model-config.json）：仅外部模式启用；set 落盘、clear 删文件、启动时加载。API 仍只回显 configured/baseUrl/model/hasApiKey，绝不回显 Key。本地发行版行为不变（只存内存），docs/security-and-privacy.md 已改为双轨口径。
- Dockerfile 追加 PLAYWRIGHT_DOWNLOAD_HOST(npmmirror) 与 npx playwright install --with-deps chromium：云端具备真实浏览器试玩（构建约 +170MB、+2~5 分钟）。
- 版本戳 0.1.2-studio。重启冒烟：PUT 200 → 重启进程 → configured=true/hasApiKey=true/响应不含 Key 明文 → clear 200 → 落盘文件已删除。
- 全量回归通过；zip 与 submission/docker 重建。
