# AIHOT 合并交接 · 2026-11-19

## 一分钟结论

本次是状态与交接 PR。产品收束、工作台和审稿 UX 已由 #28 合入主线；旧七文件补丁已经被吸收。下一项工程工作是协调 #27 与当前主线的四个重叠文件，再完成部署与真实稿件验收。

接手顺序：[AGENTS](../../AGENTS.md) → [README 的运营动作与工程依赖](../../README.md) → [LIVE 当前状态](../LIVE.md)。日常状态继续维护在 LIVE，本文件保留此次合并评审的固定快照。

## 1. 存档点与证据

| 对象 | 本次核验结果 | 接续用途 |
|---|---|---|
| `main` | `e21fa4b05ccb96b8e008ced32acd7f82ae9f3a08` | 新工作从此提交或其后继开始 |
| [#25](https://github.com/liujing2025sem/AIHOT/pull/25) / [#26](https://github.com/liujing2025sem/AIHOT/pull/26) | 已合；工作台恢复、旧页来源误报修复 | 保留既有行为与用户决定 |
| [#28](https://github.com/liujing2025sem/AIHOT/pull/28) | 已合；head `fc43a034b644226bbd72c185a991a2af7cb811db` | 工作台、核对动作、采编依赖的现行实现 |
| [#28 Check #53](https://github.com/liujing2025sem/AIHOT/actions/runs/44229876237) | `check`、`docker` 均 success | `PIPELINE_PASS`，绑定上述 head |
| [#27](https://github.com/liujing2025sem/AIHOT/pull/27) | Open / Draft；head `ac85342003616ecadd76b1eef7b37ce81d3cb768`；`mergeable=false / dirty` | 独立选材检查，等待协调 |
| [#27 Check #50](https://github.com/liujing2025sem/AIHOT/actions/runs/43380792654) | 旧 head 的流水线成功 | 整合后重新验证 |

### 旧 UX 候选的处理

11 月 17 日候选基于 `e8358fe`。本次将其七个文件逐项对照 `e21fa4b`：

- `navigation.ts`、`workflow.tsx`、`layout.tsx`、`studio-pitch.tsx`：与旧候选逐字一致。
- `workbench.tsx`、`studio.tsx`、`studio-draft.tsx`：#28 已继续演进，包含恢复选题、等待中任务、审稿动作拆分、编辑导航保护与旧页对照。

采用当前主线实现，旧补丁只用于历史追溯。此次不重复提交前端代码，也不回退 #28 的后续行为。

## 2. #27 的协调范围

| 重叠文件 | 合并时保留的行为 |
|---|---|
| `apps/web/app/routes/admin/studio.tsx` | #28 的主入口和恢复路径；#27 的独立事件检查与选材阶段操作 |
| `apps/web/tests/studio-planning.test.ts` | 当前导航断言，加上选材检查回归 |
| `apps/web/tests/studio-shell.test.ts` | 当前工作台壳层及阶段操作边界 |
| `packages/backend/src/studio/studio-brief.ts` | #28 的 contracts/backend 依赖分层；#27 的 `assessBriefMaterials` 与服务端复核 |

按功能协调这四个文件，保留两侧有效行为。完整冲突清单以整合时 Git 结果为准。#28 已将生产依赖移出 `scripts/editorial-pilot-lib.ts`，继续使用正式 contracts/backend 导出。

本阶段保持：5–12 条材料、至少 5 个独立有效事件；14/30 天规则；选材检查只读；短讯归现有 Industry News，沿用 LIVE D-10。私稿保存、人工核对、批准、AI 修订与交付各保留原职责。

## 3. 分工与验收顺序

| 工作 | 负责人 | 完成证据 |
|---|---|---|
| 审阅本次范围、裁决 #27 取舍 | Opus 5.5 | 简短审查结论及给 Astra 的执行范围 |
| 处理 #27 冲突、实现与测试 | GPT 6.2 Astra | 最新 head、变更清单、完整 CI 链接与必要样例 |
| 规则包和目标环境配置 | 获授权的部署执行者 | 运行 commit、规则包版本/有效路径、登录与持久化回读 |
| 6098、MiP 和短讯业务确认 | 运营负责人 | 当前英文与来源核对、实际操作记录、交付结果 |

本次状态 PR 送审后，按两条可并行的工作线接续：

- 短讯线：#27 对齐最新主线 → 整合 head 检查 → 按 D-08 裁决合并 → 短讯业务验收。
- 已合主线：在获准环境部署 #28 所在主线 → 规则包回读 → 6098、MiP 验收。此线可以独立推进，#27 合并不作为前置条件。

原始受限部署动作保持暂停，等待对应授权；本交接不扩展发布或模型调用权限。

整合 head 的执行检查沿用 AGENTS：类型检查、隔离数据库后端测试、Web 构建与浏览器测试、构建后 smoke。桌面和手机覆盖默认/非默认设置；验收“恢复工作 → 选材 → 审稿 → 交付”的已有路径。检查完成后停止静态扩展，转入部署、观察和真实样稿证明。

## 4. 三项待确认

1. **#27 的整合结果。** 当前冲突已确认，四文件的语义合并与新 head 的 CI 待执行。旧 head 的绿色检查只用于定位历史基线。
2. **实际运行版本与私有 writing rules。** [写作规则文档](../writing-rules.md)描述公共提示词、文件派单和仓库技能的接入。原实例私有规则的有效路径与版本仍待运行环境回读；最近记录为 LIVE 的 11 月 17 日状态。
3. **真实业务验收。** 6098 v2 / MiP v3 已有隔离回放记录；目标环境的新版本登录、实际运营耗时、五个独立 LED 事件的一期短讯待完成。未知付费回执 16/17 继续保留，不自动重试。

本轮只更新文档、回读仓库证据与归档交接；生产配置、业务库、WordPress 和付费模型均保持原状。
