# LED 原厂与P0信源候选

## G1 条件源官方JSON补核：2026-11-02

用户已批准EIA与Eurostat官方JSON入口核验。本轮新增运行配置**0个**，既有13个新增停用源保持原样；原10项失败记录和其他来源不变。[补核证据与数值口径](led-source-verification.md#g1-condition-json-20261103)及同一[source-previews.json](K:/codex/AIHOT/evidence/grill-20261103/source-previews.json)的conditionJsonFollowup记录实际结果。

- **EIA：** 现有previewSource无key请求官方retail-sales JSON返回HTTP403，未取得条目计数。官方文档要求API key，按授权边界保留UNKNOWN。目标是美国分州商业用户的月度平均电价，表5.6.A单位为cents/kWh；原HTML表的统计期不能冒充JSON返回期。
- **Eurostat：** 官方nrg_pc_205免key JSON已读到德国与EU27的两期价格。口径为非家庭用户IB档（年用电20–499MWh）、EUR/kWh、排除VAT及其他可退税费；统计期为2025-S2与2026-S1。德国2026-S1为0.2366（p暂定），EU27为0.2165，均不是新闻发布日期。
- **未算通过：** 价格标量映射preview仅返回1条并丢失另一统计期；统计期索引映射报no items mapped。现有json_list无法无损组合分离的价格、地区、统计期及状态，未写新采集器，也未把诊断配置写进sources.json。数据集updated、统计期和抓取时间分别记录。

下方为上一轮G1记录；其中“两项电价来源待选择官方入口”的授权缺口已由本轮批准解除，但凭据/映射限制尚未解决。


## G1 当前可用部分：2026-11-02核验（任务 grill-20261103）

**本轮在原3个停用LED配置后追加13个实际preview通过的停用候选；另有10个入口保留UNKNOWN。** 全部新增项为 enabled:false、site_fulltext:false、syndicate_fulltext:false。只改本地配置、候选地图、核验说明和相关测试；未seed、未改业务库、未启动采集/模型，也未部署。F04两文件改动保留。

权威需求是 [Grill决议](aihot-grill-decisions-20261103.md) 第2节D1–D18及G1，本轮不修订用户决定。[本轮核验与完整缺口](led-source-verification.md#g1-preview-20261103) 和 [source-previews.json](K:/codex/AIHOT/evidence/grill-20261103/source-previews.json) 区分真实preview、人工抽样、未知日期和失败原入口。

### 接续顺序与用途

1. **版本先行：** 卡莱特LEDSETTING、LEDVISION旧版本、控制器固件，灰度HDPlayer，四个目录已通过列表预览。只核版本/型号名称和官方链接，发布日期未知；没有下载软件、固件或完成跨日变化检测。实机资料仍是教程正文依据。
2. **条件源待选择：** EIA表5.6.A与Eurostat nrg_pc_205未通过当前rss/web_list预览，均未写配置。EIA表本身可读不等于文章列表采集通过；不把数据期填成发稿日。
3. **发现源补齐：** 原3家Macroblock/Nationstar/Kinglight保留并实际复核；新增9家见下表。它们补行业消息，不代替版本源、客户需求源或批准过的公司事实。
4. **缺口独立保留：** ISA、rAVe、Sixteen:Nine；灵星雨新闻/软件/固件；诺瓦软件固件总页；灰度固件总页；两项电价来源，共10个入口。原入口和实际错误留在核验报告，不改选入口、不以成功子集覆盖失败项。

### 新增的停用运行候选

下表条数是本次preview结果，不是入库数量或持续运行验收。原框架18个示范源与既有3家配置均未改动。

| source ID | 用途 | 复用类型 | preview条数 | 当前边界 |
|---|---|---|---:|---|
| web-meanwell-new-products | 发现 | web_list | 1 | 仅选标题明确含LED Display/LED display的电源新品，其他电源可能漏收；不推定整屏节能。 |
| web-colorlight-news | 发现 | web_list | 12 | 新闻卡片URL去重，排除标题算力/ computing；LED与会议系统仍须编辑判断。 |
| web-oaaa-news | 发现 | web_list | 14 | 14条只补前2条详情日期；其余12条未知。协会说法需回原始证据。 |
| web-chipone-news | 发现 | web_list | 3 | 仅首页3条；列表DD/MM/YYYY未按月/日猜测，日期为null；混合LCD/OLED/车载业务须人工判断相关性。 |
| web-czcl-news | 发现 | web_list | 8 | 详情仅抽取前2条的显式日期，其余为null；公司新闻混有研学等非产品内容。 |
| web-g-energy-news | 发现 | web_list | 2 | 当前相关2条为历史案例，页面日期人工可见为2019年；解析发布日期未知，不当新鲜消息。 |
| web-huidu-news | 发现 | web_list | 8 | 首条日期为2025-12-22，不等于当天新闻；列表包含LCD与LED业务。 |
| web-huidu-hdplayer | 版本 | web_list | 4 | 仅核列表版本名及官方链接，日期全部null；未打开下载门页、下载软件或验证正文，不能冒充已实现跨日版本对比。 |
| web-colorlight-software | 版本 | web_list | 4 | 仅核列表版本名及官方链接，日期全部null；未打开下载门页、下载软件或验证正文，不能冒充已实现跨日版本对比。 |
| web-novastar-news | 发现 | web_list | 3 | 只核3条列表标题/链接，日期未知，详情正文未验。 |
| rss-ledinside-news | 发现 | rss | 10 | 仅摘要加原文；RSS含汽车、照明、半导体等非显示新闻，须选题筛选，媒体不能代替原厂事实。 |
| web-colorlight-ledvision | 版本 | web_list | 11 | 官方导航标为Discontinued；版本号不是发布日期。仅列表元数据，下载入口未打开，二进制未下载。 |
| web-colorlight-firmware | 版本 | web_list | 3 | 标题为设备型号，版本仅出现在原始官方链接文件名，不从文件名造发布日期；未下载固件。 |

### 后续怎么接

沿用 [先预览再创建](sources.md#先预览再创建)，每个来源独立核对标题、链接、日期和范围，再按实际部署安排创建/启用。此交付没有执行这些动作。已验证的列表仍可能有旧闻、业务噪声或缺日期；缺日期不作新鲜消息。软件目录的二进制链接不等于现有网页正文管道已能处理软件包，后续只按版本线索使用，不当可成稿正文。

[led-source-plan.json](../industry/led-source-plan.json)继续使用原schema，只更新已有候选和添加同结构候选、方向引用，不新增第二套事实库。用途分类放在本文；不把版本/条件/需求/发现等规划字段塞入collector config。新候选 claude_batch:null 表示本轮由Codex补充，并非Claude已有核验批次。

Sources standalone测试结果：**19/19通过，0失败**。新增测试仅约束13个新LED候选停用和两个全文出口关闭。其余生产、日期补齐完整性、跨日比较、模型、审核和发布均未因此验收。

## 以下为2026-11-01及更早历史接续记录

以下保留原记录，描述当时状态，不作为本轮配置和网络验证结果。

**2026-11-01 更新（America/Los_Angeles）**：Claude 首批 12 组候选已完成一次有边界的官方入口核验，另补 ROE Visual 箱体产品资料与艾比森维护手册。逐项证据、日期、访问阻断、许可和维护成本见 [核验报告](led-source-verification.md)，机器可读覆盖地图见 [led-source-plan.json](../industry/led-source-plan.json)。报告区分列表可读、仅部分入口和 UNKNOWN，未声称新增采集器已接通。

当前业务方向：**对外英文、内部中文，对外进入 chipshow Blog；日报保留，无固定 8 条；未挂客户问题不自动淘汰。** IC、灯珠/封装、箱体/维护、电源/散热、控制/校正、屏体方案与应用渠道均有覆盖位置，户外用电是其中一个专题。plan 只管理来源候选和覆盖，不是运行 DB、事实库或自动任务配置。

给主 Agent 的接入顺序为明纬新品、卡莱特新闻、ISA、OAAA；Daktronics 是第五个条件候选，本机普通 HTTP 403 待解决。**本轮未修改 `industry/sources.json`、后台记录、数据库或服务。** 如需追加来源，先按核验报告的停用配置提案在现有预览核对；不要把 plan 直接交给 seed，也不要将来源层级、用途等候选元数据塞入 collector 的 config。

箱体方向的短原文测试材料已另存于 `K:/codex/AIHOT/evidence/claude-direction-20261101/cabinet-source.json`，仅用于主 Agent 三方向采编回放；原发布日期未知，`published_at=null`。它不是完整正文或发布许可，详见报告。

## 以下为既有三家配置与 2026-10-27 历史解析记录

本次为 `industry/sources.json` 准备了三个官方新闻列表配置，复用现有 `web_list`、详情补齐、信源预览和健康记录。配置全部 `enabled: false`，网页与 RSS 全文再分发均关闭。

**当前交付是停用的候选配置与离线解析验证。尚未执行 seed、注册生产信源、启动定时采集或生成公开稿件。**

## 已核验的入口

2026-10-27 对三个公开列表和各一篇详情进行了只读获取。下表计数是该次 HTML 快照的解析结果，不能当成已入库条数或持续采集能力。

| 官方入口 | 适合关注什么 | 快照解析结果 | 日期处理 |
|---|---|---|---|
| [Macroblock News](https://www.mblock.com.tw/en/news) | 驱动 IC、显示检测、工程研讨与产品变化 | 列表 170 条，导航未纳入 | 列表只有月日，不猜年份；详情 `datePublished` 才作为完整日期 |
| [Kinglight News](https://en.kinglight.com/category/blog/news) | LED 封装、MiP、户外器件与技术活动 | 当前页 10 条，10 条有日期 | 保留列表日精度；正文事件日单独核对 |
| [Nationstar Product News](https://www.nationstar.com/nationstar/channel/product_news) | 显示器件、封装与产品变化 | 当前页 20 条，20 条有日期 | 读 Published 字段；产品页面并不等于当天新闻 |

实际详情快照通过本地回放得到的发布日期：

- [Macroblock 驱动与检测技术介绍](https://www.mblock.com.tw/en/news/detail/LED_Display_Symposium_LED_Driver_IC)：2026-09-21。
- [Kinglight MiP 研讨会](https://en.kinglight.com/blog/kinglight-mip-technology-led-seminar.html)：2026-10-23；正文所述活动发生在 10 月 21 日，两个日期用途不同。
- [Nationstar 2727 器件介绍](https://www.nationstar.com/nationstar/content/2082377123784130562)：2026-05-15。

测试中只保留这些网页的必要结构，标题与路径改用合成内容，没有提交厂商全文或图片。原始页面会变化，启用时应重新预览。

## 运营怎样启用

1. 先完成 LED 行业筛选与写作规则。当前框架默认行业是 AI，单独加入 LED 源不能证明筛选和成稿正确。
2. 按 [现有信源流程](sources.md#先预览再创建) 把单个 `config` 对象填入后台预览。核对标题、原文链接和日期，检查导航、推荐内容是否混入。预览有外部请求，但不入文章库；本配置无需付费渲染服务。
3. 先确认一篇列表、详情、正文和审核稿相互一致，再在既有后台创建并按实际部署安排启用。宏观列表预览不会补齐详情日期，Macroblock 预览里的未知日期是预期结果。
4. 保持摘要加原文链接的发布方式。官方来源能证明“厂商发布过这句话”，仍需核对型号、适用条件和供货阶段；不会因此变成本站的产品承诺。
5. 通过已有信源健康记录查看失败原因、详情待补数与最近条目。标题或日期选择器失效时暂停该源，修正后再次核验；不把获取成功的 HTTP 响应当作内容合格。

## 初始导入与历史内容

- 当前文件中三个配置的初始回填预算为每源 8 条，回溯范围使用现有框架的 6 × 30 天窗口；详情补齐每轮最多 8 次。这些是已存在的采集技术预算，**不是日报、推荐卡或选题固定 8 条的业务规则**；本轮未调整这些数值。正文、日期校验和后续采集仍走现有管道。
- Macroblock 返回完整历史列表。本次快照的列表顺序为新到旧，首轮沿官网顺序取前 8 条，再补详情日期。详情证明超出窗口的条目，会被现有 `admission` 规则剔除并记录在 `detailDatedOut`。
- 后续轮次按信源初始化时间及框架既有旧闻窗口筛选新身份，已存在记录继续接受来源修正。该行为来自 `packages/backend/src/sources/collect.ts`，本改动没有另造回填状态。
- 缺日期的记录可能暂存待补，不能当作本期新增消息；发布日期、事件日期、页面更新时间、采集时间应在审稿时分清。首次导入的历史资料沿用框架 `first-import` 路径，不把导入日作为发生日。
- 此配置不自动翻页。Kinglight 与 Nationstar 的验证仅覆盖当前列表页。若更新频率超过一页容量，需在真实运行记录证明缺口后再扩展分页。

## 已部署环境的边界

`scripts/seed.ts` 仅插入未出现的 ID，使用 `ON CONFLICT DO NOTHING`，保留管理员修改。替换本文件不会删除或停用数据库里已有的 AI 示例源，也不会覆盖已有同 ID 配置。已有站点需在原后台逐项核对保留、暂停和配置差异，不执行整表覆盖。

新闻范围也需人工校准：Nationstar 同一产品栏含车载、照明等内容，只有与显示、工艺或供应变化相关的新增信息才进入 LED 资讯。研讨会计划、样品预期、认证范围、器件最高参数应保留原文限定。

## 后续拓宽方向（已补入口核验，尚未接入运行）

诺瓦文档与固件、明纬电源规格书适合做“文档版本变化”任务：记录型号、版本、生效日期和变化依据，核验后再决定是否有新闻价值。明纬新品列表与详情现已核到可读入口；诺瓦详情正文仍不完整，两者都没有因此自动加入运行。箱体与维护方向已补 ROE 产品资料、艾比森具体型号手册；单产品页、PDF 和 EIA 统计表先采用人工材料输入，不冒充新闻列表已采集。法规是否适用直显招牌仍 UNKNOWN。完整现状见 [核验报告](led-source-verification.md)，原 [后续 Issue 草案](led-editorial-issues.md)仅作历史工作建议，不覆盖本轮多方向决定。

## 已做与未做的验证

- 已核对公开 HTML 的重复条目结构、详情链接与日期来源。
- 已使用现有解析器回放三组真实列表和三篇详情快照；没有把快照写入业务数据库。
- `tests/sources.standalone.test.ts` 新增候选停用/全文关闭、导航排除/去重/缺日期、详情出版日期与更新日期区分的回归案例；测试只使用合成内容和本地假服务。
- 未验证数据库集成、真实后台创建、长期调度、模型筛选与成稿、人工版本批准和 WordPress 交付。本包不代表这些环节已完成。
