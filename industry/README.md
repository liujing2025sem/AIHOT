# 行业包

这个行业的知识都在这里：分类、主题、信源、精选标准和门槛。换一个行业，主要就是改这个文件夹和 [`site/`](../site/)（站名、文案、品牌和页面），步骤见 [把它改成你的行业](../docs/customize.md)。

| 文件 | 内容 |
|---|---|
| `taxonomy.ts` | 分类、标签、公司与机构、防止模型写错公司的词表，这个行业最受关注的那类发布（`RELEASE`） |
| `topics.json` | 主题目录（`/topics`），站点启动时读取 |
| `sources.json` | 新装种子里的 LED 信源 |
| `prompts/` | 每一步的提示词：预筛、评分、写作、结构化、归组、事件综述、周报月报、翻译 |
| `selection.ts` | 入选门槛 |
| `gold.example.jsonl` | 精选评测样本的格式示例 |
| `relation-gold.example.jsonl` | 事件关系评测样本的格式示例 |
| `story-digest-eval.example.jsonl` | 事件综述评测案例的格式示例 |

## LED 信源种子（v2 S0-5）

开关适用于通用种子导入（scripts/seed.ts），该脚本不覆盖已存在的信源。专用安装脚本 scripts/seed-led.ts 仍只配置三个停用源。本次未运行任何导入，也未修改运行状态。公开出口只用摘要和原文链接。

| 本机列表核验 | 种子决定 |
|---|---|
| Kinglight 10/10、Nationstar 20/20、MEAN WELL 1/1、Colorlight 12/12、Huidu 8/8、LEDinside 18/18 条有可解析日期 | 启用 6 个。Kinglight 历史样本缺 2 条日期，本机这次读到的 10 条都有日期。 |
| Macroblock、OAAA、Chipone、CZCL、G-energy、NovaStar 列表可读，本机列表读取未解析到原文日期 | 保持停用。仍待详情日期核验。 |
| Huidu HDPlayer、Colorlight 控制软件、LEDVISION、Colorlight 固件均可列出条目，无新闻日期 | 启用4个，只记录首次导入基线；随后新版本按既有版本卡逻辑处理。无日期不冒充发布日期。 |
| [历史预检](../docs/crawl-quality/2026-11-06-preflight.md) 18 个未映射候选 | 未加入种子。Signs of the Times、Daktronics、rAVe 及 EIA 无密钥 JSON 保留历史 403；ISA 保留 DNS 失败，Sixteen:Nine 保留重定向待核。 |
| Google News 8 个查询：器件与 IC、MicroLED 工艺、控制软件、整屏项目、虚拟制作、DOOH、消费 Mini LED、近眼显示 | 首次直连超时；随后使用本机已配置HTTP代理逐源核验，8个均HTTP 200/XML，共184条列表记录，184条含pubDate，启用8个。代理是网络接入，未绕过任何403/429。 |

另试 GDELT 搜索 RSS，连接超时；Bing 搜索 RSS 返回 HTTP 200 / XML，但响应注明仅供个人非商业使用。两者均未加入种子。上表是列表读取结果，原文日期、正文质量与目标机采集留待实际批次确认。

复核日期：2026-11-08。24个种子中18个启用（6新闻+4版本+8搜索）、6个待详情日期修复停用。搜索结果是发现线索，列表日期与原始发布者仍需详情核对；数量未经跨查询去重，不是新增素材数。8个搜索源同时加入Studio的显式选题来源范围。仅改源码配置，不改目标机现有开关。
