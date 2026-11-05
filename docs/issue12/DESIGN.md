# Issue #12 双用途信源最小兼容方案与迁移验收

核验日期：2026-11-04（America/Los_Angeles）。基线 main：`12e3d92e18553dd7660c89a07860e950953057d8`。

## 决策与交付状态

采用一个来源身份、一份素材版本、两套用途配置及两份用途判断。旧采集入口、素材修订、Studio 任务、审核、模型回执与发布权限全部保留。

本候选包含字段合同、34 个来源的停用映射、独立纯函数及 22 项行为回放。它没有接入 worker、API、数据库或后台页面。可以进入方案评审；生产接入与启用 HOLD。不要关闭 Issue #12，也不要把回放通过解释为双用途已经部署。

`site/source-purpose-policy.ts` 是可执行的策略原型；`industry/source-purposes.json` 目前没有任何生产消费者，不能只合并该文件就宣布功能生效。实际接入前须完成下文数据库、并发、审核与 UI 门禁。

## 1. 当前 main 的真实边界

| 证据位置 | 已核对事实 | 对方案的影响 |
|---|---|---|
| `industry/sources.json` | 34 个来源：18 个框架示范源、16 个 LED 候选；16 个明确停用，18 个省略 enabled；23 个缺 owner_entity_id | 文件不是运行库清单。不能声称 34 个已入库或全部停用 |
| `scripts/seed.ts` | enabled 缺省为 true；已有 source_id 不覆盖 | 本次不能运行 seed。迁移须以部署库的只读快照为准 |
| `site/editorial-sources.ts` | 16 个选题源、其中 4 个版本源 | 列表只能给迁移提示，不能自动审批用途 |
| `sources/types.ts`、`admin/sources.ts` | tier、participation_mode、enabled、interval_minutes 为来源级字段；修改部分字段会影响公开投影 | 不复用这些字段承载两种用途的排序和批准 |
| `sources/collect.ts` | listingEntries 在详情读取前去重；enqueueDueSources 按 source 调度；adaptIntervals 按产出自动改频率 | 新用途需要汇总为同一采集需求；自动改频不得覆盖用途周期 |
| `content/materials.ts` | identity_key 唯一；article_revisions 保存修订；相同内容 hash 不再修订；保留 article_discoveries | 继续引用 article_id + revision，不能复制原文或重编号 |
| `sources/filters.ts` | publishedAfter 会拒绝未知日期及更早资料；URL、分类和噪声过滤在采集前生效 | 用途过滤无法找回已被全局丢弃的旧资料，必须显式核查采集范围 |
| `admin/studio-recommendations.ts` | A/E/B/C/D 已实现；首次版本导入有保护；E 在无问题匹配时 action 可落到 new_brief；有 unknown-date 版本触发 | E 应进入资料/教程复核；不能自动获得 D 新闻资格 |
| `admin/studio.ts` | 任务绑定原文版本与内容校验；更新旧页需绑定旧页正文；实机证据有要求 | 原审核前置条件原样复用，双用途配置批准不能替代成稿批准 |
| PR #8、PR #10 | PR #8 已合并；main 包含 PR #10 的证据卡片和容量改动 | 不重复新增来源，不覆盖原问题地图与选题容量 |

这些都是仓库事实；运行开关、生产源数量、实际采集成功及部署版本本次未读取，状态 UNKNOWN。

## 2. 旧字段到新合同的映射

| 现有字段/记录 | 全局继续共享 | 用途独立字段或处理 | 迁移 UNKNOWN 规则 |
|---|---|---|---|
| sources.id | 不变，来源端点身份 | source_id 外键 | 不能由厂商名或 URL 重新生成；重复 ID 阻断 |
| owner_entity_id、name | 厂商归属与展示名 | 业务登记关系独立审核 | 23 个缺实体字段保留 UNKNOWN；不能凭域名认定采购关系 |
| kind、config URL/选择器/时区 | 同一采集适配器 | scope 仅决定消费哪些资料 | 不把网页标题当型号或版本 |
| tier、first_party | 保留来源等级及现有语义 | priority + priority_reason 分开保存 | T1 不等于优先级高，也不等于批准供应商 |
| participation_mode | 保留 editorial/hot_signal/isolated 原意 | purpose=supply_chain/news | editorial 不迁为已批准 news；isolated 不被用途自动升级 |
| enabled | 保留来源采集总开关；COLLECT_ENABLED 仍为总阀 | 各用途 enabled 默认 false | 文件缺省 enabled 不推断为运行开启或关闭 |
| interval_minutes | 保留旧调度含义 | 每用途 interval_minutes 独立 | 不复制成已批准用途周期；未定为 null + UNKNOWN |
| config.publishedAfter、initialBackfillLimit | 保留现有范围和首轮限制 | 每用途 backfill_policy、范围与预算清单 | 不能默默删除全局时间界限来回补 |
| allowUrlPrefixes、分类/噪声规则 | 保留允许访问的范围 | scope.document_kinds/entity_ids | 范围未确认不能启用；两用途共同需要的技术资料不被新闻噪声规则删除 |
| cursor、health、last_fetch_at、last_ok_at、last_error | 共用采集运行与回执 | 各用途 last_evaluated_at/last_success_at/last_error | 不从全局成功时间回填用途成功；没有执行即 null |
| site_fulltext、syndicate_fulltext | 全局许可保持原值 | 不允许用途扩张许可 | UNKNOWN 不视为允许全文或再分发 |
| tags、editorialSourceIds、editorialVersionSourceIds | 原值与原消费者保持 | 仅提供候选分类提示 | 34×2 全部 UNKNOWN_DISABLED；不自动视为兼用 |
| articles、article_revisions、article_discoveries | 原 ID、修订、来源归属和 hash 不变 | 两用途引用同一 article_id/revision | 版本号、原日期、有效日期、适用条件缺失时显式未知 |
| studio_tasks/drafts、recommendations、audit_log、receipts | 全部保留 | 新用途判断关联现有任务或形成待审候选 | 既有人工批准只对原记录和原版本有效，不复制到新用途 |

完整逐来源清单见 `migration-inventory.json`。清单中的 hint 只是迁移提示，不是人工审核结果。

## 3. 最小字段合同

### 3.1 用途配置

一条 `SourcePurposeBinding` 绑定一个既有 source_id，含 supply_chain 和 news 两份配置。配置 JSON 的可执行定义见 `site/source-purpose-policy.ts`。

| 字段 | 值/默认 | 约束 |
|---|---|---|
| source_id / config_revision | 原 ID / 1 | 禁止重命名 ID；乐观并发比较 revision |
| purpose | supply_chain / news | 每来源每用途唯一 |
| enabled | false | 独立开关，不能打开来源开关、模型或发布阀 |
| priority | null | 同用途内小值优先；不跨用途比较；非负整数 |
| priority_reason | UNKNOWN 原因 | 必填；挂客户问题/证据缺口，不合成可靠性总分 |
| interval_minutes | null | 用途复核周期，正整数；可大于现有来源表 1440 分钟上限 |
| scope.document_kinds / entity_ids | [] / [] | 文档类型启用时必填；实体空数组表示显式不过滤实体，不表示实体已核实 |
| backfill_policy | UNKNOWN | supply_chain 可 baseline_only 或 none；news 仅 none |
| review_status / review_ref | UNKNOWN / null | UNKNOWN、PENDING、APPROVED、REJECTED；审批必须有审计引用 |
| destinations | [] | 资料：evidence_review/version_review/page_update_review；时讯：news_review |

配置修改时当前用途停用并回到 PENDING，另一用途原样保留。旧批准追加留在 audit_log，不删除。批准必须由已有管理员身份执行；后端从认证会话取得 actor，不能接受客户端自报审批人。启用与批准应分别审计。

持久化接入建议：一个附属 `source_purposes` 配置表，主键 `(source_id,purpose)`，source_id 引用 sources 且删除 RESTRICT。配置、config_revision、独立成功时间和失败原因在该表；review_ref 指向现有审计记录。保留旧 SourceRow 与老 API 返回，新增用途 API 使用独立校验。不能把新字段塞进采集 config 绕过 config-keys 校验。

本轮不提供或执行生产 SQL。后续按仓库迁移约定新编号、每个文件一条在线语句；回填作为单独可恢复任务。编号需届时重新检查，不能占用已存在的 0104/0105。

### 3.2 共享证据与用途判断

共享证据使用既有 `article_id + revision`、identity_key、原 URL、content_hash、原文定位、实体/型号/软件版本、条件、摘要与引用。不能把软件版本字符串当成素材修订号。

时间保持四种事实：原发布时间 publication_at、原更新时间 source_updated_at、生效时间 effective_at、采集时间 collected_at。每一项保存原值、解析值、精度、时区和定位；未知为 null 并注明原因。文档页脚版本日期可单存 document_revision_date，不能直接认定为发布时间。新闻事件时间 event_at 另附证据；严禁以 collected_at 补发布日期。现有字段缺的时间/条件先放受控证据元数据，保留原 raw，不回写猜测值。

每用途判断至少含 purpose、article_id、revision、config_revision、status、reason、assessed_at、reviewer/audit_ref、destinations、task_id。使用附属 `material_purpose_reviews`，唯一键 `(article_id,revision,purpose)`，与原修订建立外键；决策历史追加到已有 audit_log。同一原件的两个用途各有判断记录，原文仍只有一份。两份判断不等于两份材料统计。

待核状态与拒绝状态都保存理由。参数冲突保存两侧引用、各自条件与版本；不同测试条件先标“不可直接比较”，不能拼接为更优规格。齐普产品承诺必须另有齐普证据。

`source_id` 标识采集来源端点，`owner_entity_id` 标识主体。同一家厂商现有新闻源、软件源保持不同 source_id，通过 entity 关联。不能为了“一厂商一个 ID”合并来源或改写历史素材 source_id。重定向、URL 参数与片段沿用现有 identityKeyForUrl 规则，禁止自行删掉可能区分版本的参数；无法核定别名时 HOLD。

## 4. 单次采集与两路消费

1. 用途周期各自算 due。一个 source_id 只提交一个现有采集任务，任务携带 due 用途集合。新用途停用不影响 legacy 路径；明确切换到双用途管理后，旧新闻路径须受新用途批准约束，禁止两套调度同时持有同一来源。
2. 新策略启用的来源停止由 adaptIntervals 写用途周期。最早到期用途决定是否需要一次远端检查；较慢用途可继续按其周期消费缓存。变更回执可立即唤醒已启用用途的影响复核，周期配置与例外事件分别记账。
3. 沿用 listingEntries → upsertMaterial → article_revisions。一个 URL/原文版本只保留一份素材。用条件请求或来源版本标志做重新检查；“同版本不重复抓取”指不因双用途再抓正文/下载/分析，不能禁止为发现新版进行必要的条件检查。
4. 并发 worker 必须依赖现有持久队列和事务内唯一约束保证单次收存；跨 source 的同 URL 必须在详情读取前共享 in-flight/已有素材判定，单靠事后 DB 去重只能保证一份入库，不能证明只发生一次 HTTP。此项需要集成测试，当前纯函数不提供跨进程保证。
5. 公共抽取结果在两用途间复用。模型回执按原有 provider/model/prompt/input_revision 维度去重，不能因为 purpose 不同重复执行同一公共抽取。确有不同判断任务时分别记回执、仍走预算和人工边界；本次路由完全不调用模型。
6. 资料侧根据条件、型号和版本差异生成待核基线/版本记录/受影响旧页候选。时讯侧另查事件时间、实质变化和客户价值；来源可靠性只影响证据强度和措辞。
7. A/E 复用问题地图并关联旧页；A/E 无旧页时可形成待补教程候选，不能自动转成 D。B/C 继续原逻辑。D 仅由 news 独立判断提供候选。拒绝时讯不会删除资料基线。
8. 下游入 `studio_recommendations` 前做适配，复用既有任务。若 A/E 两路指向相同旧页和同一变化，采用同一个动作键 `(article_id,revision,action,target_url)` 并合并用途引用，避免两个写作任务。不同用途判断的批准仍各自保留。人工采纳后才创建任务；自动路由不调用 createStudioTask。

现有 `collect.ts` 在 upsert 后会调用 queueProcessing；因此生产接入必须在新管理来源的处理入口加用途准入，供应链独用材料不能沿 legacy editorial 路径自动分析为新闻。这是接入门禁，不在本轮原型里假装已解决。

## 5. 回补与版本变化

### 历史回补

先记录基线批次、对象列表/URL 清单、范围与数量上限、resume cursor、证据日期及操作者，再读原有素材；只有缺失对象才通过原适配器或已批准导入入口补齐。来源 cursor 不回拨。供应链用途将其登记为 baseline；news 显式 SKIP。

同一 URL 后续真实新版本不能永远继承“历史”拒绝：素材原 backfill_reason 留存，用途判断以这次修订/新版本事件与前版引用决定。新版本发布日期未知时，允许形成资料更新候选，新闻 HOLD。重新解析或补正文造成的新 revision 先判断实质变化，不把排版/标题清理当发布。

`publishedAfter`、allowUrlPrefixes 等导致资料被排除时，输出“范围冲突”。管理员可以批准具体回补清单，但程序不能自动放宽全局采集授权。复用原适配器的受控回补模式，不能另建采集器。

### 新版本关系

新版可能换 URL，因此不能只比较同一 article 的 previous_revision。需以已核实体+产品/软件+版本建立 previous_ref；引用另一 article 的某个 revision 也可以。语义版本号、地区、beta/stable、硬件适用范围分别核对；不得靠标题中任意数字大小自动认定新版本。历史上已经见过相同 hash 的回滚/循环页面不重复产出；原厂主动撤回/回退属于独立事件，人工核定后单独建事件记录。

## 6. 两组真实公开来源回放

| 组 | 本次核实的公开事实 | 回放输入与预期 | 限制 |
|---|---|---|---|
| 明纬 LRS-350 规格书 | 官方 PDF，页脚标注 2025-09-12；规格页附输入/负载/环境条件 | 首次导入旧资料 → evidence_review PENDING；news SKIP；保存条件和页码 | 日期属文档版本日期。生产采集入口未核；现有明纬新闻源不能冒充规格书源 |
| Colorlight LEDSETTING | 官方下载页同时列 2.2.6 和 2.6；2.6有固件管理及设备支持变化 | 假设已有已登记2.2.6基线，再观察2.6 → 资料、版本及匹配旧页复核；news HOLD，待时间与价值审查 | 不是本次监测到当天发布。没有确认发布日期，没有真实已登记教程；旧页URL为 example.invalid 回放占位 |

来源：

- https://www.meanwell.com/Upload/PDF/LRS-350/LRS-350-SPEC.PDF
- https://en.colorlightinside.com/service/download/?cat=242
- https://en.colorlightinside.com/product/download/381

规格书回放使用 `TEST_ONLY_manual_spec_source`，不加入 34 来源映射，不写库。实际导入先确认已有 external 来源或人工来源绑定；不能复用明纬新闻 ID 伪造发现链。现有 ingest 自动建 external 源时 enabled=true，且不直接接收完整正文，因此此次不调用它；生产接入须先完成来源身份与证据正文检查。

软件样例复用真实 `web-colorlight-software` 配置身份。官方安装链接指向 ZIP，本轮只核对网页说明，不下载、不执行软件。回放 hash 是测试元数据 hash，不是 PDF 或 ZIP 原件 SHA-256。原件字节校验、生产正文抽取及真实旧页比对仍缺证据。

## 7. 迁移与回滚步骤

### M0 只读盘点

记录部署 commit、迁移版本、sources 全量导出与校验值、每个开关/周期/许可/范围，articles/revisions/tasks/reviews/audit/receipts 数量与关键引用校验。文件清单不足以替代 DB 清单。源数量不一致、悬空引用、重复 ID、未知现有权限均 HOLD。

### M1 附加结构与停用配置

先部署可忽略新表的兼容读者，再创建附属结构。按 DB 中全部来源生成两个停用 UNKNOWN 用途。批次有 migration_id、baseline_commit、输入 hash、操作者、开始/完成时间及每行结果。INSERT ON CONFLICT DO NOTHING，恢复任务不能覆盖人工修改、已有审批或 runtime 状态。重复执行行数与内容不变；已有 source_id、material revision、task/review/receipt 不写。

### M2 离线与影子回放

从脱敏本地副本回放，两用途输出仅写隔离验证表/文件。比对旧系统前后行为；legacy 来源未切换时队列、公开输出、统计、许可与开关逐项不变。影子结果不计生产成功。配置与用途审批分开检查，UNKNOWN 清单交原运营/工程角色处理。

### M3 小范围人工接入

先完成真实资料旧文和软件版本两例的 DB/HTTP 回放，再由管理员批准用途、周期、范围和去向。有既有来源总开关关闭时依然不采集。启用后先只生成待审引用；审核工作继续走现有 Studio。发布权限不变。用户本次未授权生产迁移和启用，因此 M1–M3 在本交付中均未执行。

### 回滚

1. 停止新用途调度与路由，等待在途任务结束/明确取消，记录最后运行标识。不要删除原采集队列中的无关任务。
2. 对已经切换管理的来源恢复迁移前配置快照，以 revision/updated_at 作比较保护。发现迁移后合法人工修改时逐项合并，禁止整表覆盖。
3. 回退代码，旧 SourceRow、ID 和原表仍可读取。新的用途表只读保留，新增判断/审计/人工任务不删除；未采纳的新候选标记 inactive。已采纳任务继续可回查，不撤销已完成批准。
4. 验证来源主键与原引用 hash、原开关/许可、旧任务/审核/回执总数及映射、公开输出不变。失败时继续 HOLD，不重新 seed。
5. 本次候选自身回滚只需撤销新增文件；它未接入运行入口，无数据库恢复动作。生产“有数据回滚”必须另在临时测试库演练，不能用本地文件撤销代替。

## 8. 定向行为测试与证据级别

运行：`node --test tests/source-purpose-policy.standalone.test.ts`。

本轮 Node 24.22.1 回放 22/22 通过，结果见 `verification.json`。覆盖：34 ID/68停用用途、确定性迁移、重复ID阻断、UNKNOWN关闭、优先级/频率隔离、单来源双用途合并计划、不同周期、总开关、失败时间、旧规格书、软件变化、首轮导入、时讯独立判断、只建待审、低价值消息、冲突、前版缺失、重复引用、新修订、日期、无实质变化、范围绑定、停用回滚。

这些结果验证纯策略；它们没有证明真实 HTTP 只发生一次、模型零重复收费、数据库事务幂等或 Studio 后台可用。软件样例只有公开事实真实，先前入库和旧页登记是明确合成前置条件。

必须补跑的集成验收：

| 测试 | 操作 | 验收 |
|---|---|---|
| 单版本多路引用 | 本地 HTTP fixture 计数；同时两个 worker 消费同 URL | 正文请求1次、素材版本1份、用途引用2份、公共抽取回执1份 |
| 跨来源重复URL | 两个现有 source 发现同一原件 | 不新增重复原件；发现关系都保留；详情请求不重复 |
| 崩溃恢复 | 抓完后/收存后/写引用后分别终止并重试 | 素材、引用、动作任务都无重复；失败不更新成功时间 |
| 新URL新版本 | 两个版本不同URL，同一软件谱系 | previous_ref正确，资料更新1次；新闻独立判定 |
| 兼容回归 | 未迁移源与停用用途前后对比 | 原开关、调度、任务、审核、发布及费用行为不变 |
| 全局过滤冲突 | 旧PDF早于publishedAfter或不匹配prefix | 明确HOLD范围；不能放宽全局规则 |
| 数据回滚 | 临时库填入旧任务、人工审批及迁移后人工编辑 | 回滚不删记录，不覆盖新人工修改，无悬空外键 |
| 审核并发 | 两管理员编辑同一用途/分别编辑不同用途 | 同用途revision冲突；不同用途不互相覆盖 |
| 权限 | 普通访客/未认证调用批准与启用API | 拒绝；批准新用途不会批准稿件 |
| 旧页证据缺失 | 仅有URL，无旧页正文/实机素材 | 任务保持HOLD，不声称已更新 |
| UI真实截图 | 既有后台新增供应链/时讯/兼用/待确认筛选，桌面与手机 | 各自优先级、理由、开关、最后成功、失败原因可见；配置/运行/发布分开 |

整仓 typecheck、PostgreSQL 套件、Web build、UI 截图与 smoke 本次未执行：只通过 GitHub 插件读取了固定基线的相关文件，当前工作区没有完整依赖/数据库/运行站点。没有安装网络依赖，也没有伪造这些检查通过。后续工程应执行仓库 AGENTS.md 要求的完整检查，并记录原有失败与本次回归。

## 9. GO / HOLD 门禁

| 门禁 | 当前 | 放行依据 / 待补 |
|---|---|---|
| G0 设计评审 | GO | 字段边界、UNKNOWN、样例、迁移、回滚及人工边界已明确 |
| G1 独立策略候选评审 | GO | 22项离线策略回放通过；所有新用途停用；不修改原文件 |
| G2 合并为已完成功能 | HOLD | 未接入worker/API/DB/Studio；未完成整仓检查与真实UI截图 |
| G3 测试环境迁移 | HOLD | 缺完整DB快照、迁移实现、并发与有数据回滚验证 |
| G4 生产迁移/采集启用 | HOLD | 本次范围禁止；需另行授权及逐用途人工批准 |
| G5 自动发布 | HOLD | 不在本Issue交付范围；原审核及人工批准仍必需 |

建议下一步只做临时测试库中的附属配置读写和引用幂等适配，完成 G2/G3 后再讨论启用。不会因这份方案或测试数量自动调整新闻价值阈值。

## 10. Agent 接续约定

读取顺序：DESIGN.md → migration-inventory.json → public-replays.json → source-purpose-policy.ts → 测试与 verification.json。

持久上下文：用户要最小兼容方案；新用途默认停用；保留 source_id、素材版本、任务、审核和人工批准；不新建采集器、不改生产数据库/发布流程。处理者不得把本轮公开样例变成已登记供应商、已部署配置或生产结果。先重新核对 main 与候选差异；若相关文件变化，重做差异评审，不重做无关采集。人工决策仍由原运营/工程角色承担，本轮没有另派后台Agent或修改既有负责人。
