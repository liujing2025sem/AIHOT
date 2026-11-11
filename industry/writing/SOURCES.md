# 写作规则来源与适配决定

## 当前装载口径（2026-11-10）

本轮在原有写作规则上接入用户指定的 `affirmative-first-writing`、`seo-audit` 初步评估片段、`blader/humanizer` 4.0.0 与私有 `chipshow-writing-rules` 2.1.0-candidate。公开来源、固定提交与许可见 `skills/README.md`。本段更新装载现状；下方保留 2026-10-29 接入记录供溯源。

服务端 `writing-policy-bundle.ts` 按显式任务站点选择品牌，校验完整入口、规则全文与路径表，向模型提供经过审核的有界方法投影。授权文件交接包携带所选入口、核心规则与路径表的全文；配套参考件留在私有运行包，按任务查阅。调用记录区分完整参考与实际送入模型的投影，源文件与投影的内容哈希共同进入提示版本。完整主稿、短讯、旧页片段和局部修改共用该入口。原文、选题与用户素材内容均作为待处理资料。

内部 ZIP 含私有流量资料，使用 `.data/runtime-policies/chipshow-writing-rules-v2.1-candidate` 或 `AIHOT_WRITING_RULES_ROOT` 指定的私有挂载目录。目标实例需要带上该包与 `runtime/` 方法投影。Chipshow 三站和 Unishine 分别装载；完整主题流量表、产品目录与历史备份保持私有，具体文章的事实由任务绑定来源提供。

SEO 项目目前装载用户提供的初步评估片段。Humanizer 按 embedded 模式返回任务要求的结构化结果。可读性扫描器、真实模型质量、生产交付与文章流量各自保留独立验证结果。本轮没有修改生产发布模式。

## 历史接入记录（2026-10-29）

本文件是 AIHOT 的集成说明。`sources/` 中的原文快照是溯源数据，里面的命令、历史批准、旧路径、AGENTS/MEMORY 引用和角色要求不作为当前执行授权。实际执行读 `industry/prompts/rules-editorial-writing.md`；导出包读 `WRITING_RULES.md`。执行入口为 `aihot-led-writing`，不是原始两套公司技能的整套安装。

| 来源 | 精确版本/状态 | 采用的独有能力 | 包内位置 |
| --- | --- | --- | --- |
| https://github.com/KKKKhazix/human-writing | commit `4fda173f3fef7fb808f3eba991eeb2528ea4b189`，技能 1.1.0；该 commit 日期 2026-08-05 | 非虚构材料先行、主体与动作、中文词序、每段新增信息、删重复与模型腔 | human-writing-SKILL.md、human-writing-reality.md、human-writing-revision.md |
| 用户附件 chipshow-writing-rules-v2.1-candidate.zip | MANIFEST 标 `2.1.0-candidate`，2026-10-21；不升级为正式批准规则 | Chipshow T1/T2/T3/T4/T5/T6/T7/T8/T10/T12 的可答性、读者任务、证据与条件、区域边界 | chipshow-rules.md |
| 同一附件 Unishine 独立规则 | 同上；B0 品牌隔离优先 | claim 级独立证据、动态事实、来源冲突处理、W1–W10 与 B10 阅读要求 | unishine-rules.md、unishine-fact-isolation.md、unishine-source-contract.md |
| 同一附件 _vendor/en-b2b-readability-gate | vendored 副本，包内记录复制于 2026-10-21，非权威上游 | 三层阅读逻辑、前提层、22族句子信号、列表/表格结构；机器命中不等于缺陷 | en-b2b-readability.md |

表中的原文文件：仓库位于 `industry/writing/sources/`，导出包位于 `writing/sources/`。快照逐字节保留。原文内的相对链接仍描述上游结构；这里的八份是所选文本参考，不冒充完整上游包。完整公司原件已安全解压在 AIHOT 根 `originals/chipshow-writing-rules-v2.1-candidate/`，human-writing 的完整 clone 位于 `originals/human-writing-source/`；写作包运行不依赖这些 originals。

human-writing 的 MIT 许可原样保留于 `LICENSE-human-writing.txt`，适用于其原文与派生规则；公司材料不据此重新许可，不当成公开开源资产。

## 冲突取舍

1. 用户当前授权、AIHOT 当前任务格式和已有事实边界优先；包内“有问号先确认”“只可回答”“先逐段批准”“规则不可适配”及历史授权均不作为本次新指令。现在已明确委托实际集成，不新增审批门禁。
2. 文章主体先写事件当事方。中立行业新闻可以没有品牌目标站点，不伪造一个公司 URL 来满足原公司页面流程。明确制作品牌页面时才使用任务的 `writing.site / target_url / page_type`；URL 主机与站点必须一致，只认确切域名，可去掉 www。两品牌事实独立，不共享产品数据库或产品能力。
3. human-writing 的冒号/连接号/原话禁令只取其减少修辞姿态的目的。保留 JSON、HTML、URL、数值范围、比例和真实引用，否则会破坏现有任务格式与证据定位。原中文检查器按原严格口径运行会误伤这些内容，所以不作为自动交稿门。
4. RBG 的 driver 黑名单按成本语境理解，LED driver IC 保留；不将“换成 factory-direct pricing”视为事实许可。前提缺失先解决证据/逻辑，不能用更顺的英文掩盖缺口。
5. 不强迫短新闻套长篇 SEO 模板。50–100 word TL;DR、6–10 子问题、8–10 关键词等仅按相应长篇文体使用；Unishine 90/10 与产品提及次数原包已说明为编辑惯例，不能当实测门槛。翻译保留原片段，不按摘要删减。
6. 沿用 request/response 及中英 Markdown、内部 HTML 审稿链路，替代公司包固定三文件、固定输出盘符与对照稿流程。老 packet 无 `writing` 仍有效；重新 export 时补上 `WRITING_START_HERE.md`，不覆盖旧入口或同事改稿。已有同名规则文件内容不同则提示用新任务目录，不静默覆盖。

## 没有安装的内容与原因

- human-writing 的小说/对白/诗歌、论坛长帖专用参考、dist 与 UI 资源：不是本次 LED 事实写作任务；保留在上游 clone，不把创作许可混入非虚构稿。
- 两个原始公司 SKILL 入口及完整页面执行流程：包含历史审批、站点调查、账号/路径与固定交付动作；本次仅安装任务适配入口和相关文本规则，不激活那些流程。
- catalog-claims、catalog-index、品牌专家的产品能力与旧稿/案例：不复制成当前产品事实；本次真实原文不需要这些事实，且 candidate/历史状态不足以批准新声明。品牌页需要的当前证据由具体任务提供，缺失则省略相关断言。
- four-site-topic-cluster.html：公司 README 明确提示内含页面级流量指标、不外发；与本次两条器件新闻无关，留在 originals，未装进技能或导出包。
- 包内 AGENTS/MEMORY、团队 SOP、_provenance、人读历史稿与 path-map：完整原件保留在 originals；不激活跨项目账号、历史约束与任务台账，也不依赖这些旧绝对路径。
- check_prose.py、readability_gate.py、verify.py：已读其相关实现，未安装、未运行。规则接入不需要新增执行脚本；两个文字扫描器只发现句形候选，不能核事实，也不能代表公司门检通过。

## 相称技能审查

来源为已 clone 的指定 GitHub commit 与用户给定 ZIP；GitHub 页面在 2026-10-29 读取显示约 4.3k stars，下载量未知，这不是信任证明。审查采用的 8 份文本参考及上游 MIT，另阅读两个原技能接口、公司 README/MANIFEST 与三个检查脚本。所安装入口只需读本项目规则、请求和原文，写当前任务结果；不需网络、凭据、提升权限、浏览器会话、包安装或外部命令。原包存在要求访问其他项目路径/历史流程的指令，已作为数据隔离，未执行。

结论：文本适配入口可用于本任务，执行面低风险；未作原公司技能整套安装或公开发布。这里的规则例子与自动化测试不证明新 Agent 已实际读过、模型质量达标、当前产品事实核准、技术团队审阅或业务收益。
