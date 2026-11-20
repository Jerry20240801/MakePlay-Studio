# 开发手记 003 · 2026-11-12 · 完整包启动失败与修复

## 现象

用户双击 dist/zaowan-workshop-win64/Start-Workshop.cmd 后立即失败：

    Error: Cannot find module 'semver/functions/coerce'
    Require stack:
    - ...\node_modules\sharp\lib\libvips.js

## 排查

1. 工作区里 node -e require('sharp') 正常，编码 PNG 也正常；打包目录里同样的 sharp 却失败。
2. 工作区根 node_modules/semver 是 6.3.2（其他依赖提升到根），sharp 需要 7.x；pnpm 把 7.8.6 放在 node_modules/sharp/node_modules/semver。
3. 打包脚本的 collect() 无条件跳过所有名为 node_modules 的目录，于是 sharp 的嵌套依赖没有复制。
4. 更严重的是：生成 zip 时同样跳过了包根的 node_modules，压缩包里 3303 个文件实际只有 33 个，依赖全部缺失。
5. test-dist 只检查目录存在（node_modules/sharp 目录在），没有真正加载模块，所以没抓到。

## 修复

- collect() 不再跳过 node_modules，同时保留嵌套依赖（sharp/node_modules/semver 等）。
- 打包后增加依赖预检：用 createRequire 从包目录加载 fastify / sharp / @playwright/test / zod，并实际用 sharp 编码一张 4x4 PNG；任一失败直接终止打包。
- zip 现在包含完整 node_modules（3270 条目，含 @img/sharp-win32-x64 的原生 DLL 与 sharp 自带 semver 7）。
- test-dist 增加同样的加载与编码检查、zip 校验。
- 数据目录增加可写性探测与回退：ZAOWAN_DATA_DIR → %LOCALAPPDATA% → %APPDATA% → 用户目录 → 临时目录 → 当前目录；都不可写时给出明确错误。本轮沙箱里 %LOCALAPPDATA% 不可写，回退到临时目录后正常启动。

## 验证

- 打包输出：3303 文件，zip 53.7 MiB，依赖预检通过。
- 直接运行包内 node：health 200、创建项目 200、验证 passed、素材上传 200（sharp 真实编码）。
- 直接运行 Start-Workshop.cmd：health 200。
- zip 内容抽查：node_modules 3270 个条目；sharp/node_modules/semver/functions/coerce.js 存在；@img/sharp-win32-x64 原生文件存在。

## 教训

「目录里看起来有依赖」不等于「能加载依赖」；嵌套 node_modules、zip 打包排除规则和缺少模块加载预检，三者叠加才导致用户侧启动失败。打包脚本必须在最终产物上做一次真实 require，而不是只检查文件存在。
