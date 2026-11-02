# LED 多方向信源核验与接续

核验日期：**2026-11-01，America/Los_Angeles**。本次在线读取发生于当地当日；UTC 已为 2026-11-02。证据来自官方页面的实际浏览访问；明纬、卡莱特另做了本机普通 HTTP 读取。搜索索引仅帮助定位，不能代替原页读取。

先接明纬、卡莱特，再预览 ISA 与 OAAA；Daktronics 保留为有条件的第五项。它们分别补电源、控制、渠道和屏体企业披露。这里的“先接”是给主 Agent 的实现顺序：**本轮没有注册、启用或测试生产采集器**。箱体结构已有两个可读官方材料；法规和月营收没有被硬凑成每日新闻。

## 本轮采用的业务决定

- 对外英文，内部中文；对外内容进入 **chipshow Blog**，这不是本轮自动发布授权。
- IC、灯珠/封装、箱体与维护结构、电源/散热、控制/校正、屏体方案、应用渠道、市场披露、能效范围同时覆盖。户外用电只是其中一个专题。
- **日报保留；不设固定 8 条；未挂客户问题不自动淘汰。** 客户问题用于解释价值，来源覆盖与新信息本身也可形成候选。
- 中文材料保留原文来源和日期，在既有写作流程生成英文衍生稿。公开默认原创摘要加原文，不复制全文、图片、整表；厂商宣称保留归属和型号条件。
- 本文与 [候选地图](../industry/led-source-plan.json) 只管理来源候选、覆盖和接入建议，不记录营收、产品性能等随时间变化的事实，不另建数据库或 Claim 台账。

## 给主 Agent 的首选顺序

| 顺序 | 候选 ID | 推荐原因与下一步 | 限制 |
|---|---|---|---|
| 1 | `led-meanwell-new-products` | 新品列表和详情可读，本机 HTTP 成功。先预览单个 `web_list`，补显示电源方向。 | 列表含照明、传感器等；必须按显示电源相关性筛选。未核准完整标题选择器。 |
| 2 | `led-colorlight-news` | 列表和详情有日期，本机 HTTP 成功。预览控制、播放和校正新闻。 | 轮播和主列表重复；混有 AI 算力业务。不能只抓轮播，也不能整站全收。 |
| 3 | `led-isa-news` | 公开列表有日期、详情链接和分页，补标识商与工程采购视角。 | 原始 HTML 选择器、本机请求和详情日期仍需预览；不登录会员区。 |
| 4 | `led-oaaa-news` | 公开新闻与详情发布日期可读，补应用和户外媒体视角。 | 总页混合活动；OOH 不全是数字广告，协会也不是独立实验室或监管机构。 |
| 5，条件候选 | `led-daktronics-investor-news` | 浏览工具读到列表、详情和日期，可补屏体同行披露。 | 本机普通 HTTP **403**，当前不能推荐直接启采；先正常预览成功，或人工输入原文链接。 |

若主 Agent 决定修改 `industry/sources.json`，建议仅追加前四项的**停用** `web_list` 配置，保留既有三家 ID，`site_fulltext=false`、`syndicate_fulltext=false`；每项先在既有预览中核对标题、详情链接、日期和去重。具体新运行 ID 可采用 `web-meanwell-new-products`、`web-colorlight-news`、`web-isa-news`、`web-oaaa-news`，这些只是提案，当前未创建。Daktronics 的 403 未解决前不加入可启用组。**本子任务未写运行配置；主 Agent 决定是否实施。**

## 首批 12 项的逐项证据

Claude 的“ISA / Signs of the Times”拆为两条记录，共 13 个候选；再加两项箱体资料，共 15 个新候选。`UNKNOWN` 表示本轮未核实，不能理解为“不存在”。维护成本为当前结构与访问条件下的相对估计，不是长期运行工时。

### 1. 明纬 MEAN WELL：列表与详情可读，成本低

- 官方入口：[New Products](https://www.meanwell.com/news.aspx?c=1)。普通 HTTP 返回可读 HTML；`.list-item` 包含文章链接与 `.col.time`。页面有分页。原始无分类 `/news.aspx` 内容不同，接入应保留 `c=1`。
- 原日期：样本[UDP 显示电源新品](https://www.meanwell.com/newsInfo.aspx?c=1&i=1554)的列表与详情均为 **2026-09-29**。日精度，不补具体时间，不把采集日作发稿日。
- RSS / API：本次 HTML 未见 RSS/Atom `link`，RSS 与 API 都是 **UNKNOWN**，没有猜测 feed 地址。
- 建议：复用 `web_list`，`itemSelector=.list-item`、`linkSelector=a[href*='newsInfo.aspx']`、`publishedAtSelector=.col.time`；标题选择器及详情规则待既有预览核准，不能称为已测配置。
- 用途：电源型号、规格及变更线索。厂商效率和厚度等参数只限其电源及原文条件，不等于整屏节能或齐普已采用。页脚保留权利；未取得全文转载许可，**摘要加原文**。

### 2. 诺瓦星云：部分入口可读，成本高

- [官网首页](https://www.novastar.tech/)可读，有近期文章与日期线索。实际 NEWS 指向[列表入口](https://www.novastar.tech/content/content.html?catid=19)。猜测的 [`/news/`](https://www.novastar.tech/news/)返回 **404**。
- 日期：首页一条线索显示 **24/03/2026**，但不能据此认定每篇详情日期已核。[近期详情样本](https://www.novastar.tech/content/detail.html?catit=19&id=105)只返回导航与空标题，正文和日期 **UNKNOWN**。
- RSS / 列表 / API：Recent Posts 链接存在；完整列表、公开数据接口和 RSS 未核实。没有调用模型/API 或付费渲染。
- 建议：先人工核具体控制器、固件和下载文档的版本；普通 HTML/公开端点证据齐备后再选 `web_list` 或 `json_list`。官网可打开不等于采集可运行。许可 UNKNOWN，摘要加原文。

### 3. 卡莱特：列表与详情可读，成本中

- [英文新闻列表](https://en.colorlightinside.com/news/all/)可读且本机 HTTP 成功。轮播 `.News_swiper .swiper-slide` 中有 `a`、`h5`、`.data`，页面还包含主列表，同链接多次出现。
- 日期：[兼容性消息详情](https://en.colorlightinside.com/news/Exhibition/15564.html)为 **2026-10-21**，与列表一致。
- RSS / API：获取的 HTML 未见 RSS/Atom `link`；接口与 feed 为 UNKNOWN。
- 建议：`web_list`，以完整新闻卡片为单位取标题、链接与日期；现有 URL 去重可复用，原始响应编码须核对，不能只抓轮播。排除无关算力宣传，但保留控制、校正、播放和显示兼容信息。厂商说法不等于独立测试。许可 UNKNOWN，摘要加原文。

### 4. 集创北方：原页读取超时，成本未知

- 官方定位为 [chiponeic.com](https://www.chiponeic.com/)。官方搜索索引有带日期的近期新闻；实际打开原页 **Timeout fetching**，未取得可读列表或详情。早先尝试的 `icn.com.cn` 无可用页面，不作为官方确认入口。
- 原日期、RSS、当前列表结构、API：全部 **UNKNOWN**；索引日期只作定位线索，不作已核原发布日期。
- 建议：人工候选，正常访问恢复后再核 LED 显示驱动 IC 列表；不把汽车/LCD/OLED业务新闻全部当 LED 商显新闻。本轮未无休止重试。许可 UNKNOWN，摘要加原文。

### 5a. ISA：公开列表可读，成本中

- 官方为 [International Sign Association News](https://signs.org/news/)，不是 `isa.org` 自动化协会。早先 `/newsroom/` 不可读，实际官网新闻入口是 `/news/`。
- 原日期：列表样本为 **2026-10-07**；有每篇标题、日期、Read More及分页。详情原日期未逐篇抽样。
- 列表证据成立；RSS / API UNKNOWN。建议 `web_list` 公开新闻卡片，排除 Share 推荐和导航，先核 HTML 与本机预览；会员内容不读、不登录。
- 协会观点用于应用、渠道、许可问题线索；涉及法规时回当地主管机关，不能引用协会概述作法律结论。全文许可 UNKNOWN，摘要加原文。

### 5b. Signs of the Times：403，成本未知

- 官方站 [Signs of the Times](https://signsofthetimes.com/)实际打开返回 **403 Forbidden**，没有读到正文。
- 原日期、RSS、列表、API、全文许可：**UNKNOWN**。不可与 ISA 合算成两份已读独立证据。
- 建议：暂保留人工公开链接候选；不绕过 403 或订阅墙，不自动启采。媒体文章也需区分编辑、广告和厂商供稿；只摘要加原文。

### 6. OAAA：公开新闻与详情可读，成本中

- [`/news/`](https://oaaa.org/news/)重定向到[News & Events](https://oaaa.org/news-and-events/)。日期、新闻分类、详情链接可读；总页也含活动。
- 原日期：[详情样本](https://oaaa.org/news/oaaa-announces-winners-of-the-84th-annual-obie-awards/)末尾明确标明 **Published: October 16, 2026**。未来会议举办日不能替代发稿日。
- 列表成立；RSS / API UNKNOWN。建议 `web_list` 限公开新闻分类，详情补 Published；不自动获取会员报告、整表与研究附件。
- 用途为应用和市场线索；协会代表行业利益，不算监管或整屏性能证实。页脚保留权利，全文许可 UNKNOWN，摘要加原文。

### 7. ENERGY STAR：官方版本页可读，成本中，适用范围未知

- 原预设 `/products/displays/specification` 不可读；使用[当前合作方规格入口](https://www.energystar.gov/products/monitors/partners)及[版本过程页](https://www.energystar.gov/products/spec/displays_specification_version_8_0_pd)。页面当前指向 Version 8.0 修订文件。
- 日期：**2019-05-02**定稿、**2020-01-28**生效、**2021-11-24**修订。这些是规格过程日期，不是今天的新新闻，也不是总页发布日期。
- 证据是带版本 PDF 链接的文档目录；RSS / API UNKNOWN。建议按月或版本变更人工复核，不把文档目录当每日 RSS。
- **是否适用于目标直显 LED 招牌：UNKNOWN。** 尚未完成目标产品定义、排除项、测试配置与认证型号核验；不出法律或合规结论。全文再分发许可未核，保留摘要和官方链接。

### 8. 欧盟电子显示器生态设计：概述可读，正文验证受阻，成本高

- [欧委会官方总览](https://energy-efficient-products.ec.europa.eu/product-list/electronic-displays_en)列出 2019/2021 生态设计、2019/2013 能效标签及范围概述；另有 **2025-06-17** FAQ 文件日期。
- 原日期：总览可见 2019/2021 的法规日期 **2019-10-01**，不能当总览发稿日。点击 [EUR-Lex 正文](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex:32019R2021)遇 JavaScript 机器人验证，条文与修订排除项未完成读取。
- 接口证据只有官方文件链接；RSS / API UNKNOWN。建议低频版本核对，保留原条款定位和适用范围待核项，不绕机器人验证。
- **模块化直显 LED 招牌是否适用：UNKNOWN。** 不能从概述的 digital signage 文字直接推定；没有法律结论。全文重用条款未核，只做摘要加官方链接。

### 9. 台湾月营收：聚积入口存在，月表数据未知，成本高

- [官网投资者入口](https://www.mblock.com.tw/en/investor)链接[Monthly Revenue](https://www.mblock.com.tw/en/investordetail/1/2)与 [MOPS](https://emops.twse.com.tw/server-java/t58query)。月营收页只读到导航，未见月表数据；MOPS能读到公司查询和财务栏目。补查[柜买中心 OpenAPI](https://www.tpex.org.tw/openapi/)返回 **403**。
- 原发布日期、具体营收月份/数值、可用月表列表与专属 API、RSS：**UNKNOWN**。没有用第三方金融站填补核验缺口。
- 建议：先从官方确认公司代码和申报市场，再读单公司月表；不能假设“上市公司”汇总接口覆盖目标公司。只在公开 JSON/CSV 地址和结构实际读到后考虑 `json_list`；本次没有可运行 API 提案。
- 发布日、数据所属月分开；公司营收不能推成显示驱动 IC 出货或整个 LED 市场变化。与既有 `web-macroblock-news` 同属一个发行人，不算独立交叉证实。全文许可 UNKNOWN，摘要加原文。

### 10. 巨潮投资者关系记录：动态列表未读实，成本高

- [巨潮官方调研入口](https://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice)只读到标题/时间模板变量，没有实值记录列表。[官网](https://www.cninfo.com.cn/new/index)有数据服务链接，但没有证明某个无需登录的查询 API 可用。
- [诺瓦 2026 半年报官方 PDF](https://static.cninfo.com.cn/finalpage/2026-08-22/1225490168.PDF)实际可读，证明官方 PDF 可作为来源；它**不是**本次目标投资者活动记录原件。目标记录的披露日和活动日仍 UNKNOWN。
- RSS、API端点与响应结构 UNKNOWN；没有猜测 POST 接口或登录。建议先人工取得官方活动记录 PDF，核公司、标题、披露日、活动日，再决定是否复用 `json_list`。PDF抽取不等于现有网页正文管道已经支持。
- 平台官方不代表公司回答独立客观；投资者记录、财务报表及前瞻性话语应分别使用。“一个解析器覆盖多公司”尚未验证。全文许可 UNKNOWN，摘要加原文。

### 11. Daktronics：浏览可读，本机普通 HTTP 403，成本高

- [投资者新闻列表](https://investor.daktronics.com/news-events/press-releases)为旧 `/news-releases` 的重定向目标，浏览工具显示原日期、标题、分页和 499 条总量；这个数量仅为当次页面展示，不是本地入库条数。
- [详情样本](https://investor.daktronics.com/news-releases/news-release-details/daktronics-announces-implementation-actions-strategic-structural)原日期为 **2026-10-14**，有 PDF Version 链接。财年、未来目标时间与发稿日期分开。
- 列表和详情在浏览中成立，但本机 `urllib` 普通 HTTP 为 **403**。RSS / API UNKNOWN。只有正常 HTTP 预览成功后才考虑 `web_list`；当前可人工选文输入，不通过换身份、登录或反爬绕过。
- 投资者新闻是发行人声明，不等于 SEC 文件，也不等于全部经审计。页脚版权链接存在，全文许可未核，摘要加原文。

### 12. EIA 电价：官方统计表可读，成本中

- [Electric Power Monthly Table 5.6.A](https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_6_a)实际读到州、终端部门、月份和美分/kWh列。
- 日期清楚区分：数据月 **2026-08**，发布日期 **2026-10-23**，页面列下次发布 **2026-11-24**；下次计划不是已发生发布。
- 已核 HTML 统计表；RSS、API及其权限 UNKNOWN，未申请 key、未调用接口。建议月度人工数据引用。`web_list` 是新闻条目入口，不能直接把此表单元格当新闻入库；本轮不新增统计数据库或适配器。
- 电价属统计原源，但州商业均价不是具体客户合同电价、需量费或整屏功耗测量。复用许可未单独核，只留所需摘要/数据说明和官方链接，不复制整表。

## 箱体、结构与维护：补充两项官方材料

### 13. ROE Visual Carbon MarkII：产品页可读，成本中

- [官方具体型号页](https://www.roevisual.com/us-en/products/carbon-markii)实际读到结构/规格/下载/附件入口，适合箱体结构、巡演与维护选题。
- **页面原发布日期 UNKNOWN**；不把搜索显示的发布时间当原页日期。后续两次读取同页出现超时，已停止进一步读取，不能声称正文完整可持续获取。
- 仅核到单产品资料入口，不是已核新闻列表；RSS / API UNKNOWN。建议人工型号资料输入、低频复查下载版本；附件日期和版本另核。
- 同行原厂资料不是独立结构测试，巡演用途不能移用成固定招牌规范或齐普参数。全文许可 UNKNOWN，摘要加原文，不转载图片或整份附件。

### 14. 艾比森 K V3：官方维护手册可读，成本中

- [官方手册 PDF](https://www.absen.com/wp-content/uploads/2025/06/K-V3-Series-User-Manual-V202407-K-V3-Series-User-Manual-V202407.pdf)实际读到 42 页文本；包含箱体组成、安装、接线、前后维护与故障排查。**手册应用范围是室内型号**。
- 原发布日期 **UNKNOWN**。文件名含版本年月，上传路径含年月，均不能用作已核发稿日。
- 这是单个 PDF，不是 RSS、JSON API 或新闻列表；相关接口 UNKNOWN。建议人工工程背景输入，保留型号、页码和版本。现有 HTML 正文提取能力不等于已接通 PDF 抽取。
- 官方型号手册能证实该型号文档写了什么；不代表所有屏体、户外环境、齐普结构或通用安全法规。许可 UNKNOWN，仅摘要加原文。

### 给三方向真实回放的箱体样本

主 Agent 新授权的测试文件：`K:/codex/AIHOT/evidence/claude-direction-20261101/cabinet-source.json`。它是来源测试夹具，不是文章、运行源或公开稿；包含 `url/title/body_text/published_at/retrieved_at`。标题直接取官方 PDF 封面；正文为两个英文短摘录，分别来自结构/安装说明。出于原文版权边界，**没有保存完整正文或完整长段落**；省略号标明节选，不将其解释为原文完整段落。可以用于箱体主题、标题、来源和未知发布日期输出回放，**不足以验收完整正文抽取或长篇成稿质量**。

来源定位：手册印刷页 6（PDF 第 7 页）结构说明。可核发布日期缺失，因此 `published_at=null`；`retrieved_at` 是 UTC 时间，对应本地核验日期 2026-11-01，不能回填为发布日期。文件不包含全文发布许可。

## 覆盖分层与现有三家

<a id="existing-sources"></a>

运行种子仍以 `industry/sources.json` 为准。当前读取的文件含以下三个停用的 LED 配置；**数据库实际启停状态未查询**。本轮重新浏览三个列表成功，但没有重跑原解析器或本期详情日期测试。

| 既有 source ID | 本轮入口证据 | 覆盖与保留限制 |
|---|---|---|
| `web-macroblock-news` | [官方新闻](https://www.mblock.com.tw/en/news) | 驱动 IC。列表条目仅月日，不能从年份筛选控件猜每项年份；沿用详情原日期规则。 |
| `web-kinglight-news` | [官方新闻](https://en.kinglight.com/category/blog/news) | 灯珠/封装。列表有日期，但置顶日期未必是详情发布日期；保留已有详情优先规则。 |
| `web-nationstar-product-news` | [官方产品新闻](https://www.nationstar.com/nationstar/channel/product_news) | 封装/器件。混有照明、汽车、背光等；按是否提供 LED 商显可用变化判断，不机械关键词全收。 |

| 层 | 已有与本轮补充 | 缺口/用途 |
|---|---|---|
| A 组成端原厂 | 既有三家；明纬、卡莱特；诺瓦/集创待解决读取 | IC、灯珠、电源、控制可分别追踪；厂商稿是发现与原参数，不自动成为独立证实。 |
| B 屏体与工程 | ROE产品页、艾比森手册、Daktronics披露 | 结构、维护、屏体方案；型号与环境限定必须保留。独立可靠性实验室资料未核。 |
| C 应用与渠道 | ISA、OAAA；Signs of the Times受阻 | 应用与渠道语境；不将协会稿当法规或采购需求量。 |
| D 法规与标准 | ENERGY STAR版本页、欧委会总览 | 仅作适用范围研究，目标直显招牌范围 UNKNOWN。 |
| E 数据与披露 | EIA表、Daktronics；聚积/巨潮部分入口 | EIA可人工引用；其他来源不能从入口存在推成数据接口已接通。 |
| F 会议展会 | 原厂稿可提供会议线索 | 本轮未独立核展会 feed；未声称七层全运行。 |
| G 内部一手 | 沿用现有项目工程/销售资料入口 | 不自动公开，不新建事实库，也不要求新增销售必填字段。 |

## 与现有 schema / collector 的接法

已读 `packages/backend/src/sources/types.ts`、`config-keys.ts`、`web-list.ts`、`json-list.ts`、`collect.ts`、`packages/backend/src/admin/sources.ts` 及 `docs/sources.md`。

- `SourceRow` 的现有运行类型已有 `rss/web_list/json_list/external` 等；`config-keys.ts::assertSupportedConfig` 拒绝不认识的采集字段。覆盖层、独立性和候选维护估计留在 plan，**不能把整个 plan 填到 config 或当 seed 输入**。
- HTML 列表复用 `web_list`。JSON 只有实际读到公开端点与字段后才配置 `json_list`。单 PDF、单产品页、统计表先沿用人工材料输入，不为它们另造采集数据库。
- `collect.ts` 既有初始回填及详情预算继续有效；三家当前 `_aihot.initialBackfillLimit=8`、`detail.maxFetches=8` 是每源技术预算，**不是日报数量、推荐卡数量或选题上限**。本次未改数值，也不把 8 固化成业务规则。
- 公共摘要、公开长文权限与内部阅读是不同边界。只有明确来源授权后才考虑全文；本轮全部保持 UNKNOWN/摘要加链接。
- 原日期缺失留未知，原日精度保留日精度；发布日、事件日、修订日、数据期、获取时间分别表达。数据库和公开出口仍走原项目路径。

## 实际完成、未完成与接续状态

完成：官方网页只读核验、候选覆盖配置、现有 source ID 引用、推荐接入顺序及箱体回放短样本。没有创建业务数据库、运行后台预览、seed、登录、模型推理、付费渲染、自动启采、重启服务或发布 Blog。长期稳定性及采编收益未验证。

三端送达按 [cross-agent-delivery](D:/CodexData/codex-home/skills/cross-agent-delivery/SKILL.md) 核对。固定 `requestId=AIHOT-LED-SOURCE-VERIFICATION-20261101-R1`；本机桌面探针返回 `DESKTOP_PIPE_UNAVAILABLE`，目标 preflight 返回 `CDP_UNAVAILABLE`、`dispatchState=not_sent`。旧登记 Dot UUID 仅用于只读预检，当前身份/调度未获确认，**没有调用发送入口发送消息**，没有重启或换通道。请求与检查回执由桥接保存，NOT_SENT 可在当前连接明确恢复后续办，不能称为对方已读。

按精确项目历史 UUID 查询已连接 Drive，并读取 [2026-10-28 AIHOT接续正文](https://drive.google.com/file/d/10-RAVarYVcQ4DOUbmaTr02Ud8pqA5fQo/view)，其 metadata 修改时间为 2026-10-29；范围仅历史交接，不是当前对话或最新调度。标记 **ARCHIVE_READ / LIVE_NOT_READ**。当前工作以本轮用户指令及 K 盘本地规则为准，不采用归档内已过时 D 盘运行路径。

本子任务按用户范围不做封包或云上传；Drive上传 **NOT_PERFORMED**，运输受理 **NOT_SENT**，WorkBuddy读取 **UNKNOWN**，文件核验见下，主 Agent验收 **PENDING**。主 Agent可直接读取这三个文件及额外授权的箱体样本，整合到既有 WorkBuddy 接续材料；文件存在不代表 WorkBuddy已经消费。

文件检查：JSON可解析、候选ID唯一、覆盖引用可解析、既有三家source ID可在当前种子配置中找到；运行配置未由本子任务修改。未触发全套测试或云端交付流程。
