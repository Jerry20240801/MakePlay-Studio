# 架构

## 分层

    apps/web  ─┐
    apps/player├─> packages/runtime ─> packages/kernel-* ─> packages/schema
    apps/server┘        │                    │
                        └── packages/verifier ┘
                             packages/generator
                             packages/model-provider

- packages/schema：所有外部边界的 Zod 校验、类型、模式包注册表与 GameKernel 接口。
- 三个内核是纯函数：不访问时间、网络、DOM、文件系统；相同输入产生相同输出。
- 网格与知识包不消费随机数；卡牌包只用包内固定版本 PRNG，并在状态键与证据中记录种子与 RNG 计数。
- Phaser 只做渲染与输入适配，不维护第二套玩法规则；知识/卡牌使用 React/CSS 界面。
- 验证器共用内核，因此另有独立的人工金标、轨迹断言与可见 UI 一致性检查，避免「两个模块说通过」。
- packages/verifier/src/lint.ts：29 条不调用模型的本地体检规则；其中 6 条带类型化 quickFix。
- apps/server/src/ai-review.ts：一次性的云端配方审查；只接受 summary/findings，输出中的 quickFix/ops/patch 被丢弃，不能直接改配方。

## 三档审查

- local：只跑本地体检，0 次模型调用。
- ai：本地体检作上下文，云端模型最多 1 次调用，结论 origin=ai，仅作建议。
- both：本地 + 云端，两类结论分开标注；云端失败/跳过时回退展示本地结论，不把失败当通过。
- 审查证据：runs/review-*/review.json 与 model-usage.json；不含 API Key。

## 数据流

1. 用户在工作台编辑或 Agent 生成候选版本。
2. 后端在候选版本上运行 verifyRecipe：结构 → 契约 → 搜索/种子重放 → 专项检查。
3. 结果写入 runs/<run-id>/：manifest.json、checks.json、report.json、events.jsonl；浏览器试玩另有 inputs.jsonl、runtime-trace.jsonl、console.jsonl、screenshots/。
4. 只有同 buildId、同 contractHash 的检查全部通过，才允许进入 ready_for_review；模型不能自行授予通过。

## 存储

    projects/<project-id>/
      project.json
      versions/<version-id>/recipe.json, meta.json
      assets/<content-hash>.png, manifest.json
      runs/<run-id>/*
      reports/<verification-id>.json
      exports/<export-id>.zip

写入使用临时文件 + rename；不支持多文件事务时用提交清单与可恢复状态机，不宣称天然原子。

## 权限边界

- 模型只能选择后端注册的工具与 Schema 允许的参数。
- 契约、测试解释器、验证器、导出与采纳接口不属于模型工具。
- 服务只监听 127.0.0.1，校验 Host 与 Origin，会话令牌只在内存中。
- 不执行模型提供的 shell、浏览器脚本或任意网络地址。

## 单任务状态机

created → inspecting → planning → editing → validating → repairing → validating → ready_for_review → completed
任一可执行阶段可进入 blocked / failed / cancelled。

预算：每任务最多 12 次模型响应、30 次工具调用、3 轮修复；同一失败重复两次应停止并报告受阻。
