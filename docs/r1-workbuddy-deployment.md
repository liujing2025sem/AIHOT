# R1：WorkBuddy 部署与真实出文接续

本轮任务：加载已合并的 main，跑通一篇真实英文稿的卡片、任务、成稿、审核、导出。WorkBuddy 已完成迁移与启动；Codex 已保存10件/180天、导入36题并完成U1七个入口的手动采集，新增47条。当前自动卡题文不符且MiP未出卡，首篇路径待用户决定；真实出文尚未完成。操作实录见 [运营手册](operator-guide.md)，PR 描述是回执。

## 已完成与当前授权

用户已转交 Claude 对 `d465271` 的通过结论，并明确批准以下合并、U1 手动采集、36题导入、目标机开启 Studio 成稿调用及真实 OpenCode Flash 调用。无需重复询问这些已批准事项。WordPress 发布仍由用户决定。

| PR | 合并提交 |
|---|---|
| #8 | `30416cbb4202f561705a4c2382c688bc07ab6547` |
| #9 | `a1fc9cdd9ac6e6e285d971802bb04a6cfd26b0fc` |
| #10 | `12e3d92e18553dd7660c89a07860e950953057d8` |

部署基准是上述 #10 合并提交。其源码树与 Claude 复验的 `d465271` 相同。Codex 已向 `K:/codex/AIHOT-wbtest/source` 同步38个新增或更新文件，并在目标目录成功构建 Web；目标目录不是 Git 工作区，不要直接在其中执行 `git pull`。后续异机安装需使用目标机实际安装目录。

- 同步前逐项比较了目标文件与上一轮 `8824853`，未发现需要保留的目标端独有修改；没有覆盖私有 `.env`、凭据和数据库。
- 启动前的只读状态检查曾显示数据库/API/Web未运行。WorkBuddy 随后已通过持有任务 `2tqBYQ` 加载服务，真实应用0096–0105共10个迁移；Codex复查API和登录页均可达。旧 `processes.json` 的 PID 不代表该持有器的新进程。
- `build-info/SOURCE_REVISION.json` 记录磁盘源码与构建状态，**不能证明应用已加载**；`build-info/RELEASE.json` 是旧安装包的历史记录。
- 构建原文：`evidence/r1/main-build.log`；迁移原文：`evidence/r1/migration-start.log`；WorkBuddy回执：`evidence/r1/R1-1-回执-迁移与冒烟.md`，含4张真实页面截图。真实出文回执尚未产生。
- Codex 的跨聊天连接检查返回 `DESKTOP_PIPE_UNAVAILABLE`，直连没有发送成功；用户随后确认已手动向 WorkBuddy 转交部署指令。目标端是否已读和执行，仍以 WorkBuddy 的实际回执、日志和运行状态为准。

## R1-1：迁移与加载，由 WorkBuddy 执行

在安装根目录执行，使用随包 Node。以下以本机 `K:/codex/AIHOT-wbtest` 为例；异机改成实际目录，保留原配置与业务库。

```powershell
Set-Location -LiteralPath K:/codex/AIHOT-wbtest
& .\runtime\node\node.exe .\tools\local-runtime.mjs status
```

本机源码和构建已经同步。不要重复安装、运行全量 seed 或用空库替换业务库。若后续有新提交，先核实运行版本和本地修改再更新。

通过目标端现有启动方式加载服务。标准 `start-studio.cmd` 已按“数据库 → 迁移 → API/Web”执行。WorkBuddy 命令会话可能回收子进程，因此在其支持的后台持有任务中运行现有 `_wbtest-run.mjs`，保留真实任务句柄；它同样先迁移，失败不会启动应用。不得新建计划任务或开启定时 worker，本轮不包含 R3。

```powershell
& .\runtime\node\node.exe .\tools\_wbtest-run.mjs 2>&1 |
  Tee-Object -FilePath .\evidence\r1\migration-start.log
```

此命令持续持有服务，需交给 WorkBuddy 的后台执行能力；不要等待它自然结束，也不要在确认结果前结束持有任务。若目标机采用手动双击标准启动器，则从该次启动记录保留迁移输出。`ALREADY_RUNNING` 只代表已有应用运行，不能证明刚复制的代码已经加载。

回传完整 `applied ...` 和汇总输出，至少核对到 `0105_studio_import_fingerprint_unique.sql`。若显示 `database is up to date`，同时回传数据库实际已应用文件名，不能只凭健康检查推断。现有 `_wbtest-migrate.mjs` 只打印末尾2000字符，不用它作为完整迁移证据。

可在安装根目录用现有连接工具只读列出相关迁移，不输出数据库密码：

```powershell
@'
import { connection, pgRun } from './tools/studio-common.mjs';
const { args, env } = connection();
console.log(pgRun('psql', [...args, '-At', '-c',
  "SELECT name FROM schema_migrations WHERE name >= '0096' ORDER BY name"], { env }));
'@ | & .\runtime\node\node.exe --input-type=module
```

本机预期入口是 `http://127.0.0.1:53181/admin/login`，API 健康为 `http://127.0.0.1:4312/api/health`；以实际安装设置为准。密码仅从目标本机原凭据读取，不贴入回执或截图。

冒烟需覆盖：问题地图、画像导入与撤回、整理建议、卡片采纳、社媒派生。画像导入冒烟使用明确标识的合成数据，验证后撤回；不能让它产生的需求计数进入真实选题和成稿。社媒派生缺实际 Blog URL 时保留待执行，不编造已发布地址。

## R1-2：真实素材与问题地图

1. 在后台手动采集一次 U1 已批准信源：MEAN WELL、Colorlight 新闻与软件、OAAA、LEDinside、NovaStar 新闻、HDPlayer。复用已有信源；缺少时只补对应已核配置，不运行包含 AI 示例源的全量 seed。登记每个源的发现数、新增数、原发布日期范围和失败原因。预览失败需要换入口时按 v3 第4.2节交用户决定。
2. 导入用户本轮已确认的 `industry/question-map.example.json` 36题。保留原文中的来源 ID 和需求证据性质；“运营确认选题”不能变成“已证实客户询盘”。已知页面 URL 使用真实地址，未知留空。
3. 用户已明确确认首轮**待处理名额10件、回看180天**。目标实例迁移完成后，在“今日值得处理 → 设置”保存这两项；已有值相同时不重复改写。接口字段为 `weekly_limit: 10`、`lookback_days: 180`。新闻短讯的7天新鲜度规则不变，回看180天不把旧材料变成近期新闻。回传实际保存结果。
4. 首篇优先 MiP 解释文，使用现有 Kinglight、Nationstar 的真实素材，补齐完整原文和原日期，绑定对应版本。旧技术资料可以用作解释文证据，不能改日期冒充新闻。

## R1-3：一张真实卡到批准导出

从“今日值得处理”整理建议后选卡，首选“MiP 灯珠的封装尺寸和屏体性能指标怎么区分？”。若没有对应卡，按 v3 由运营从真实卡片选择其他解释文，并记下理由。**不能插入虚假询盘、搜索数据、新日期或手造推荐记录来凑首篇卡。**

在 API 渠道页启用本轮已获授权的 Studio 人工成稿开关，使用现有 OpenCode 渠道和 `deepseek-v4.1-flash`，不改用 Pro、不修8080/DSH失效渠道、不隐式切换供应商。页面查看和整理建议不调用模型；真实成稿仍通过现有任务、回执、预算和服务端审核规则。

执行：采纳 → 绑定完整原文 → 一键评估成稿 → 中文内部审稿与英文稿核对 → 修复 BLOCK → 逐项处理 WARN → 提交审稿 → 批准 → 导出 MD/HTML/JSON。逐项确认必须有实际核验依据，不能为了过关批量勾选。内容重点核对“灯珠封装尺寸/参数”与“整屏性能”是否分清，数字归属、测试条件和来源日期是否保留。

记录任务、稿件、回执 ID，实际请求与返回模型、调用耗时、输入/输出 token、费用及其口径。没有费用数据时填“未知”，不把套餐调用或空字段记成0元。人工操作分钟未知也保留未知。WordPress 尚未获发布批准；导出即可作为本轮发布前成果，不能声称已发布或已回读。社媒派生分别审核；需要实际公开链接的环节等发布决定。

## R1-4：回传真实运行结果，Codex 写手册

在现有 `evidence/r1/` 保留迁移原文、各信源采集结果、卡片/任务/审稿/导出真实截图（1440宽）、脱敏回执摘要和最终导出文件。不要放密钥、登录密码、客户联系方式或完整私有配置。文件名应说明具体步骤。

WorkBuddy 回复时写明：安装目录、加载的 commit、迁移结果、后台持有任务句柄、信源结果、使用的名额/回看设置、卡片/任务/稿件/回执 ID、导出路径、未完成项。实际仍未通过的步骤明确写出原因，不代签。

Codex 根据这次真实操作编写 `docs/operator-guide.md`，将可公开截图放入 `docs/assets/operator-guide/`，完成同一个 R1 PR。此前测试 fixture 的卡片截图不能用作真实出文截图。R1 最后还需要用户确认能照手册独立重复一次。

本轮保持 R1 范围；不提前开展旧页回读、实机教程入口、自动采集、无人值守或四周效果评估。
