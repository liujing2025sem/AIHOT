# L0 首轮采集范围与历史质量基线

日期：2026-11-06。状态：预检完成，目标机采集未运行。本文不代表新采集、入库或补抓验收。

已将 34 个运行配置中的 16 个 LED 配置与 31 个候选按完全一致的入口 URL 核对。13 个候选已有映射，34 个独立 LED 入口均列在下表；另有 18 个 AI 示例源排除在本轮清单外，未删除、未改开关。

## 原样本基线

| 范围 | 条数 | 有日期字段 | 缺日期 | 日期字段非空率 |
| --- | ---: | ---: | ---: | ---: |
| 混合样本 | 133 | 71 | 62 | 53.38% |
| 新闻列表 | 111 | 71 | 40 | 63.96% |
| 软件与固件基线 | 22 | 0 | 22 | 0% |

旧核验表的 preview 总条数合计 283；最多 20 条/源返回的样本合计 133。两者都不代表入库数。样本日期为 2026-11-03T05:37:12.901Z。非空率不证明日期正确；样本不含正文，正文抽取率、字数及补抓后覆盖率均未知。目录分类来自既有用途，版本号不作新闻日期。新采集批次与这份固定样本分别统计。

## 逐入口结论

| 运行 ID 或候选 ID | 类型 | 历史样本条数 | 缺日期 | 预检结论 | 原因 |
| --- | --- | ---: | ---: | --- | --- |
| web-macroblock-news | news_discovery | 20 | 12 | 修复 | 列表缺日期；需要真实详情补抓对比，暂不能归咎解析器 |
| web-kinglight-news | news_discovery | 10 | 2 | 修复 | 列表缺日期；需要真实详情补抓对比，暂不能归咎解析器 |
| web-nationstar-product-news | news_discovery | 20 | 0 | 保留 | 保留已核列表入口，等待正文与30天范围验证 |
| web-meanwell-new-products | news_discovery | 1 | 0 | 保留 | 保留已核列表入口，等待正文与30天范围验证 |
| web-colorlight-news | news_discovery | 12 | 0 | 保留 | 保留已核列表入口，等待正文与30天范围验证 |
| web-oaaa-news | news_discovery | 14 | 12 | 修复 | 列表缺日期；需要真实详情补抓对比，暂不能归咎解析器 |
| web-chipone-news | news_discovery | 3 | 3 | 修复 | 列表缺日期；需要真实详情补抓对比，暂不能归咎解析器 |
| web-czcl-news | news_discovery | 8 | 6 | 修复 | 列表缺日期；需要真实详情补抓对比，暂不能归咎解析器 |
| web-g-energy-news | news_discovery | 2 | 2 | 修复 | 列表缺日期；需要真实详情补抓对比，暂不能归咎解析器 |
| web-huidu-news | news_discovery | 8 | 0 | 保留 | 保留已核列表入口，等待正文与30天范围验证 |
| web-huidu-hdplayer | version_baseline | 4 | 4 | 保留 | 只建版本基线，日期未知不冒充新闻日期 |
| web-colorlight-software | version_baseline | 4 | 4 | 保留 | 只建版本基线，日期未知不冒充新闻日期 |
| web-novastar-news | news_discovery | 3 | 3 | 修复 | 列表缺日期；需要真实详情补抓对比，暂不能归咎解析器 |
| rss-ledinside-news | news_discovery | 10 | 0 | 保留 | 保留已核列表入口，等待正文与30天范围验证 |
| web-colorlight-ledvision | version_baseline | 11 | 11 | 保留 | 只建版本基线，日期未知不冒充新闻日期 |
| web-colorlight-firmware | version_baseline | 3 | 3 | 保留 | 只建版本基线，日期未知不冒充新闻日期 |
| led-isa-news | news_discovery | 未知 | 未知 | 待定 | 候选尚无运行映射；先核原入口和现有解析能力 |
| led-signs-of-the-times | news_discovery | 未知 | 未知 | 停用 | 保留既有拒绝，不重试该入口 |
| led-energy-star-displays | reference_baseline | 未知 | 未知 | 待定 | 候选尚无运行映射；先核原入口和现有解析能力 |
| led-eu-display-ecodesign | reference_baseline | 未知 | 未知 | 待定 | 候选尚无运行映射；先核原入口和现有解析能力 |
| led-macroblock-monthly-revenue | reference_baseline | 未知 | 未知 | 待定 | 候选尚无运行映射；先核原入口和现有解析能力 |
| led-cninfo-investor-records | reference_baseline | 未知 | 未知 | 待定 | 候选尚无运行映射；先核原入口和现有解析能力 |
| led-daktronics-investor-news | news_discovery | 未知 | 未知 | 停用 | 保留既有拒绝，不重试该入口 |
| led-eia-electricity | reference_baseline | 未知 | 未知 | 待定 | 候选尚无运行映射；先核原入口和现有解析能力 |
| led-roe-carbon-markii | reference_baseline | 未知 | 未知 | 待定 | 候选尚无运行映射；先核原入口和现有解析能力 |
| led-absen-kv3-manual | reference_baseline | 未知 | 未知 | 待定 | 候选尚无运行映射；先核原入口和现有解析能力 |
| led-huidu-firmware | reference_baseline | 未知 | 未知 | 待定 | 候选尚无运行映射；先核原入口和现有解析能力 |
| led-linsn-news | news_discovery | 未知 | 未知 | 待定 | 候选尚无运行映射；先核原入口和现有解析能力 |
| led-linsn-software | reference_baseline | 未知 | 未知 | 待定 | 候选尚无运行映射；先核原入口和现有解析能力 |
| led-novastar-software | reference_baseline | 未知 | 未知 | 待定 | 候选尚无运行映射；先核原入口和现有解析能力 |
| led-sixteen-nine-news | news_discovery | 未知 | 未知 | 待定 | 候选尚无运行映射；先核原入口和现有解析能力 |
| led-eurostat-nrg-pc-205 | reference_baseline | 未知 | 未知 | 待定 | 候选尚无运行映射；先核原入口和现有解析能力 |
| led-linsn-firmware | reference_baseline | 未知 | 未知 | 待定 | 候选尚无运行映射；先核原入口和现有解析能力 |
| led-rave-news | news_discovery | 未知 | 未知 | 停用 | 保留既有拒绝，不重试该入口 |

每行的入口 URL、候选映射、停止 URL、历史错误原话和三条可复算样本见同名 JSON。新批次所有指标保持 null，未采不填 0。正文前 80 字仅进入目标机或私有结果包。

## WorkBuddy 下一步

1. 返回目标实例别名、运行 SHA、16 个 source ID 的数据库启停状态、本批尚未执行证明，以及采集/模型/外发开关的非秘密布尔状态。不要提供密码或 webhook。
2. 复用现有 collectSource、Studio 素材补抓和 fetch_runs。不要运行通用 seed：它会把未显式 enabled 的 AI 示例默认启用。缺失的 LED 记录仅按明确 ID 补入，继续默认停用。
3. 按同名 JSON 的 34 行闭合覆盖。18 个尚无映射的候选先做原入口及现有解析器核验；遇已有拒绝的 URL 保留停止。文档、版本与数据表只做基线，不能强塞新闻解析器。
4. 在目标机执行一次授权批次，临时采集、模型和外发关闭。新闻以批次开始时间回看 30 天，日期未知的条目单列。记录分页与链接边界、限额及详情 pending；一次 collect 返回 ok 不代表完整补抓。不得清空已有 cursor 或覆盖历史数据来凑完整。
5. 详情每次限额为 2 或 8 等配置值，首导条数也有上限。逐条记录成功、无日期、拒绝、错误及待补；不循环重试 403、429、验证码。正文补抓完成后再计算正文抽取率。
6. 结束后恢复并回读采集开关；返回元数据报告与私有正文包位置。未经过这一步，本报告一直保持预检。

说明：当前执行环境没有可用的 WorkBuddy 派发入口和目标数据库。本次只完成读取、对照与离线复算。未发送任务，目标端接收状态 UNKNOWN。
