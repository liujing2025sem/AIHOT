# AIHOT 云端接续入口 · 2026-11-04

**2026-11-05设计分工更新：** 用户要求Claude主导产品设计、方案取舍与验收，Codex负责工程实现；同一Studio支持WorkBuddy辅助部署和独立运行。先读[Claude设计任务书](docs/claude-design-brief-20261105.md)或[分栏阅读版](docs/claude-design-brief-20261105.html)。这是设计委托，未实施别名/日期修复，也未启动PR-1至PR-6；下列运行证据仍为11月4日记录。

**用户已决定：从本机/WorkBuddy转为云端Codex继续开发与对接。目标对话是 `01a15213-930a-75f7-9a11-1ab19667a09e`。不要再要求用户转述整个项目，也不要重复采集、导入或调用首篇模型。**

仓库 `liujing2025sem/AIHOT`；工作分支 `codex/aihot-r1-first-article-20261103`；持续回执 [PR #11](https://github.com/liujing2025sem/AIHOT/pull/11)。先检出该分支最新提交，不能只检出main；主动选题代码为619789d，部署后的文档更新为9ff0a1a。本入口后续提交只补云端接续、恢复工具和真实运行证据。

## 1. 现在接哪一步

继续R1第一篇MiP解释文。人工卡、证据绑定、任务创建及一次真实Flash调用已经完成；**模型返回一篇候选，但D1阻断，新增正式稿件为0，尚未批准、导出或发布。** 原始结果完整存于任务响应，不要再点“评估并成稿”。

| 对象 | 记录 |
|---|---|
| 问题 | MiP 灯珠的封装尺寸和屏体性能指标怎么区分？ |
| 人工卡 | recommendation-8440c0f284915a422da4fb1654a9a2bb |
| 任务 | studio-df63ba68-a986-48e9-bd02-47c099323b1d |
| 原文 | yhg8yuicohwljhq052r5d46qn，Kinglight，revision1，7617字符 |
| 原始日期 | published_at=2026-10-22T16:00:00Z；原文日历日期publication_time=2026-10-23 |
| 模型/供应渠道 | deepseek-v4.1-flash / OpenCode Go |
| 回执 | 7，received，attempts=1 |
| 请求到收到结果 | 2026-11-04T07:58:58.480738Z → 07:59:47.938207Z，约49.46秒 |
| 用量 | input30510 / output6907（含reasoning3965）/ total37417 |
| 费用 | receipts.cost/currency/cost_basis均为空，实际费用未知。供应商usage里cost=0、list_cost=0.0174414、allowance=0.01046484、billing_source=go，不将它们擅自解释为已结算美元费用 |
| 审核结果 | 45处命中，其中16处BLOCK，均为中文review_zh的D1；其余29处WARN |

目标部署原由WorkBuddy完成，后台句柄Xk4oPo。其本机启动记录为`database is up to date → migrations-ready → API/Web`；0096–0105此前已真实应用。**云端尚未部署，不把本机部署当云端验收。**

## 2. 私有数据：一个文件

[AIHOT_云端运行数据_20261104.json](https://drive.google.com/file/d/1eUQj-v5aMj3TbuHuwWRllKDO2mg-1gff/view?usp=drivesdk)，3,439,741字节，快照时间2026-11-04T08:19:00.276Z。Drive元数据已核实shared=false，仅owner权限；这是私有数据，**不要提交到公开GitHub**。

用已连接Google Drive下载原始文件；工具不可用时请用户把同一个文件附到云端对话，不改成重建空库。不要向用户索要本机登录密码或把密钥写进仓库。

文件包含：

- PostgreSQL16自定义格式数据库快照：217素材、36题、10任务、7历史稿、3卡；原文版本、模型原始结果、审核状态、回执、设置、来源配置都保留。
- `current_work`：当前任务的原始request/response及回执摘要；无需先恢复数据库就能读原稿与全部命中位置。
- CAMOS方法数据和所需代码133个文件，仅`data/expert_knowledge`，不包含`data/business`。
- 排除登录会话、pgboss队列、API密钥、密码、Windows便携执行程序。

本机已在独立空库做过真实恢复，读回：217/36/10/7/3，admin_sessions=0，当前任务blocked，回执7 received，末次迁移0105。本次没有停止来源业务库。Linux实际启动仍由本云端回合验证。

## 3. 云端恢复

使用Node >=24.22.1、PostgreSQL16；依赖和启动参数先读`docs/deploy.md`、`.env.example`。私有文件放`.data/`（已被Git忽略）。

```bash
node scripts/unpack-cloud-transfer.mjs .data/AIHOT_云端运行数据_20261104.json .data/cloud-restored
```

输出`database.dump`、`current-work.json`、`camos/`。脚本只落文件，不联网、不建库、不调用模型；目录已存在时复用已有结果，不反复创建副本。

使用云环境已配置的PGHOST/PGPORT/PGUSER连接信息，只恢复到新库：

```bash
AIHOT_RESTORE_DB=aihot_cloud_r1
createdb --template=template0 --encoding=UTF8 "$AIHOT_RESTORE_DB"
pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname="$AIHOT_RESTORE_DB" .data/cloud-restored/database.dump
```

新库创建失败时先核对已有库，不使用`--clean`覆盖。将DATABASE_URL指向该新库，生成新的云端管理员密码/会话密钥，再跑`npm run db:migrate`，之后构建并启动API/Web。管理员凭据使用云环境私密配置；不要抄本机地址或密码。定时worker、推送、WordPress发布保持关闭。

渠道元数据保留为OpenCode Flash，但密钥没有迁移。**处理现有候选稿无需再次调用模型**。以后需要新成稿时，再使用云环境中的OpenCode密钥；不改用DeepSeek Pro、不修8080或过期DSH密钥。

### 已知Linux差异

`packages/backend/src/admin/camos-methods.ts`当前把Python入口固定为`runtime/python/python.exe`，在Linux创建新任务前须改为可配置Python3或按平台选入口，并验证真实CLI检索。数据和Python源码已带上，便携Windows Python未带上；不得创建“python.exe”壳文件伪装兼容。现有MiP任务已绑定connected方法和6个rule ID，审稿修正优先复用该快照。

## 4. 第一件业务工作：修现有候选，别重买一次

1. 读`current-work.json`里的task.response、task.request和receipt7。保存原始Flash响应，随后修订作为独立采编结果留痕。
2. 核查16处D1：中文用了“晶台”，信源名是Kinglight News，可能涉及名称/上下文识别问题；不能把每个命中直接签为事实错误。先核原文，再按准确归属补写或修规则；不删除D1、不批量确认BLOCK。
3. 原文的0.65×0.65mm是MC0606封装尺寸；2,000nits/100,000:1等是原厂对“使用该产品的显示屏”提出的性能说法。候选英文已作区分，继续保留，不能改成封装实测。
4. 修正候选中“published October22”的日期表达：原文只给日期October23，UTC存储时间不能直接截断当原文日期。删除或缩减与本题无关的市场规模和路线比较，避免为解释封装/整屏区别添加无用负担。
5. 使用既有`receiveStudioTask`/任务“导入结果”提交修订。输入须符合responseSchema；从存储响应取出时移除派生字段editorial_gate。保留原task_id及source binding。记录实际修订者与依据，不能声称修订部分仍是Flash原样产物。blocked任务允许修正后重新接收，无需新建卡/任务。
6. 通过服务端规则后，真实审稿、逐项确认、批准及MD/HTML/JSON导出；不得伪造用户已逐字确认。人工耗时未知保留未知，Agent修订不计成用户手工分钟。WordPress是否发布由用户决定。
7. 补`docs/operator-guide.md`的真实成稿/审稿/导出截图，更新同一个PR #11，交Claude验收；不自行合并。

## 5. 沿用的决定与实测限制

- 英文对外进入Chipshow Blog，中文只用于内部审稿；范围含IC、灯珠、箱体、电源、控制等，不缩成电费专题。
- 用户已批准首批U1信源与人工点击成稿；10件/180天、36题已保存。47条新增采集已完成，不重复跑。真实询盘/搜索记录当前为0，不能造需求。
- 自动建议曾把ViewSonic获奖新闻误配成海运验货，已否决。人工入口不修复此误配，不计入自动建议采纳率，不能据此声称优于定时检索。
- 代码验证：后端1155项中1142通过/0失败/13项Windows跳过；类型检查和构建通过；本次卡片浏览器3/3。完整Web66/67，未改路径的WebKit文章目录End键断言失败，尚未单独在main验证，不宣称全绿。
- 目标回合仍是R1。后续v3计划见`docs/aihot-production-plan-20261104.md`，决策口径见v2.1和D1–D18；本次用户转云指令覆盖“由本机WorkBuddy执行后再接续”的旧部署分工。
- GitHub普通Git传输在本机反复TLS重置；已连接GitHub工具可以写入。不要让用户继续重试本机推送。无需ZIP、重复Drive目录或多轮回读。

## 6. 收件状态

目标对话已确定，但本机桥接读取返回`DESKTOP_PIPE_UNAVAILABLE / dispatchState:not_sent`。**GitHub提交与Drive上传不等于云端对话已读。** 云端第一次接续时在PR描述简短记录实际检出的提交、是否读到私有快照、是否恢复成功及当前任务状态，即可继续，不另建任务台账。
