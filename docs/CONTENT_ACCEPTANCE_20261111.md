# AIHOT 内容规则与产出验收记录

日期：2026-11-11。核验对象：原工程，基于 `8c0e72cc330b87b3fa7bee6f4f37f62531fe70a3` 的本轮工作树。

**当前结论：已验证原内容链路的规则、隔离测试与真实私有写作包可加载；尚未验收本轮真实文章产出。规则校验通过不等于真实文章验收。**

本记录没有调用真实模型、抓取新材料或访问 WordPress；没有读取或修改生产数据库。6098 和回执 16、17 的状态沿用用户交接边界，本轮没有将历史状态重新标为现场观察。

## 1. 本轮沿用的要求

当前用户要求原 AIHOT 继续使用，保留原能力，改进操作和视觉；网站采用运营手工上传，原自动上传模块保留。原工程承载的材料、选题、事实、范围与标题选择、片段成稿、中文审稿、英文交付、图片、社媒衍生、记录与运营设置须继续可达。以最新用户要求和 [LIVE.md](LIVE.md) 为准。

| 要求 | 本轮判定口径 |
| --- | --- |
| 目标 | 在不伤害商誉的前提下扩大流量与合格询盘；没有真实流量和询盘数据时不宣称效果提升。 |
| 内容语言 | 对外英文，中文用于内部审稿；英文变更后，旧中文明确保留为旧稿，不能冒充同步译文。 |
| 标题和开头 | 标题承诺有本事件的来源支持，前两句兑现主体、动作和数字；引用存在与语义支持分开检查。 |
| 选择生效 | 已选标题、小节、事实来源和范围进入实际请求；未选片段不调用；个人补充不自动成为已核对事实。 |
| 旧文升级 | `keep` 原文逐字保留，改动限于已确认片段；旧页目标、来源、基线和正文指纹保持绑定。 |
| 品牌规则 | 目标站点显式选择规则，Chipshow 与 Unishine 分开；规则包里的历史案例和运营指标不能充当本次事实。 |
| 简报 | 5–12 个独立事件形成一期待审稿；同事件多来源不凑数；逐事件证据和三条速览各自绑定事件。 |
| 时效及栏目 | G3 的 14 / 30 天窗口；短内容用现有 Industry News，长文或升级用 Choose Guides，不新建 LED Display Brief 栏目。 |
| 保存与批准 | 含 BLOCK 的私人稿仍能保存；批准、导出或交付依据当前英文、当前来源和准确版本。 |
| 付费未知 | 未取得可核对结果的 Studio 请求保持待核对，不自动再付费或隐式换模型。 |

详细格式应按任务种类使用：短讯、完整长文、单段替换各有范围。私有运行投影明确要求不要把完整长文模板套到短讯或单段片段。文章长度、摘要长度和信息增益仍需在实际任务的约定格式下核验，不能仅据规则加载就认定达标。

## 2. 找到的样本及真实性

| 样本或记录 | 能证明什么 | 不能证明什么 |
| --- | --- | --- |
| `tests/fixtures/editorial-preview-20261103.json` | 文件声明为实际公开来源的只读标题、URL 和原日期快照，共 16 组 preview。 | 不含完整采集或完整生成文章，不能用作本轮内容成品。 |
| `industry/writing/led-rule-examples.json` | 两条已有 Kinglight、Macroblock / Juxin 原文快照，含绑定版本、哈希、短引文、条件和归属疑问。 | 标识为 `ILLUSTRATIVE_EXCERPT_NOT_APPROVED_ARTICLE`；短示范不是完整实验稿，也不是本轮重新抓取或模型产出。 |
| `tests/studio-brief*.test.ts`、`studio-planning*.test.ts` | 合成材料与本地假服务可以验证请求字段、去重、保存、回放和失败行为。 | 这些响应明确为 synthetic，不能算真实出刊、真实模型效果或现有 6098 回放。 |
| `tests/studio-writing-policy.standalone.test.ts`、`tests/writing-policy-fixture.ts` | 人工构造规则包验证加载器、品牌隔离、完整性和缺包行为。 | 测试包不能证明真实品牌规则已经安装；该依赖另由下节实际加载检查。 |
| `docs/editorial-pilot.md` 与历史 handoff | 描述历史文件接棒、历史接口试验和接续边界。 | 历史文字不能替代本轮原响应、回执、数据库或部署观察。 |

在本轮定向检查的 `docs`、`tests/fixtures` 与 `industry/writing` 中，没有找到可作为本轮完整真实成稿验收的模型原始响应和对应可审文章。没有据此制造新的“实测文章”。

## 3. 本轮实际验证

### 3.1 内容规则测试

使用 Node `v24.22.1` 执行以下现有测试，均为当前工作树本轮结果：

```sh
node --import ./tests/standalone.ts --test --test-concurrency=4 --test-timeout=120000 tests/studio-planning.standalone.test.ts tests/studio-brief.standalone.test.ts tests/studio-writing-policy.standalone.test.ts tests/studio-review-language.standalone.test.ts tests/editorial-pilot.standalone.test.ts
node --import ./tests/standalone.ts --test --test-concurrency=2 --test-timeout=120000 tests/editorial-issues.standalone.test.ts tests/editorial-gate.standalone.test.ts
```

结果分别为 **63 / 63**、**55 / 55**，合计 **118 / 118**，无跳过。

这些测试覆盖：原文版本绑定、引用存在、无正文材料拒绝成稿、未选改动排除、人工事实与来源事实区分、简报独立事件与来源定位、14 / 30 天资格、原始日期精度、来源与数值条件、中英文数字检查、未处理问题完整保留、旧中文标旧、被保留段落与 HTML 边界保留、精确替换和并发修改保护。测试环境将数据库指向不可用本地地址，外部调用使用本地假服务或注入函数。

`tests/studio-planning.test.ts` 中的“chosen title, section and additions enter the actual fragment request; omitted sections never run”数据库回归在本轮完整测试中实际通过。它直接拦截传给生成函数的请求，检查所选标题、小节、补充要求和事实，调用注入函数并主动抛出 `Synthetic capture: no model called.`。此结果证明请求传递，不证明真实模型成稿质量。

### 3.2 真实私有包可达性

从用户原项目 Drive 文件 `1_1brbSCsY1AcMHOZpIk7tNaER8VLB8wC` 取回的 `chipshow-writing-rules-v2.1-candidate` 包，在本地通过实际 `writingPolicyBundle()` 调用验证。未将私有正文写入公共仓库或测试 fixture。

| 项目 | 本轮观察 |
| --- | --- |
| 版本 | `2.1.0-candidate` |
| 站点与阶段 | 4 个允许站点 × `draft` / `brief` / `fragment` / `revision`，16 次全部 `loaded`。 |
| 完整性 | 所选品牌 `SKILL.md`、`references/rules.md`、`references/path-map.md` 的字节数和 SHA256 与包清单相符。 |
| 品牌隔离 | Chipshow 三站使用 `chipshow-three-site-writing`；Unishine 使用 `unishine-independent-writing`；未加载另一品牌的私有正文。 |
| 提示投影 | Chipshow 合计 4907 bytes；Unishine 合计 4935 bytes，均低于既有 10000 bytes 限额。 |
| Chipshow 主站 bundle digest | `0a8c271889b43ae4f7d3acd8c03ded122ae6debef8a8928346d121605d8d9a51` |
| Unishine bundle digest | `c45afb6930c309096f02b592c22ee80e88f3e8ce9a3b030621dc445b2bca20ac` |

定向阅读运行投影后，确认包含：品牌事实须来自当前任务、主体和型号/数字/单位/条件一起保留、不得编造公司承诺或工程署名、旧页保留段逐字保留、事实变化须检查标题/摘要/FAQ/metadata、短讯与片段保持各自范围、事实/可读性/交付一致性分别审核。

加载器明确记录 `full_sources_in_model_prompt: false` 与 `readability_scan_executed: false`。实际模型得到的是审核过的运行摘录；完整选定规则供授权交接阅读。本轮包加载通过，尚未证明真实模型遵守规则、原实例已配置该路径，或独立可读性扫描已经执行。

### 3.3 本轮隔离数据库验证

原嵌入式测试数据库缺少 LZ4 支持，原迁移 `0034_lz4_toast.sql` 如实失败。随后在临时用户目录使用官方 PostgreSQL 18.6 发布包（SHA256 校验通过）、官方 LZ4、M4、Bison 和 Flex 源码完成编译，启用 `--with-lz4`，安装原迁移需要的 `pg_trgm`。没有修改或跳过项目迁移，没有系统提权。数据库与测试在同一启动脚本的子进程运行，数据库每轮新建并在结束后清理。

五个定向测试文件实际运行 78 项，77 通过、1 失败；完整 `npm test` 实际运行 **1278 项，1269 通过、9 失败、0 跳过**。此轮完整结果尚未达到全绿：

- 三项架构检查分别定位到交付开关缺少环境模板说明、工作台 CSS 使用字面圆角、页面直接读取减少动画偏好。三处已修复，修改后在隔离 PostgreSQL 中重跑架构检查，13 / 13 通过。
- 五项配图测试缺少 Playwright 要求的 Chromium headless shell；原发布大用例因此取得 `featured_media=0` 并提前失败。负责人保留原断言排查运行环境。该大用例在失败位置之后的手工模式和残留队列断言没有执行，不能据此宣称通过。
- 已实际通过的相关路径包括：管理员账户与 11 字符虚构密码、会话撤销和 CSRF；Studio 未知回执不自动放行；实际成稿请求中的标题与小节选择；简报的数据库流程；独立 WordPress 手工模式和只读恢复回归。

随后将残留发布队列的手工模式行为放入独立数据库用例，实际 1 / 1 通过：旧待发布项标为 `manual_delivery`，外部 fetch 为 0，未新增模型任务、草稿或供应商回执。此结果独立于需要 Chromium 的原大用例。全工作区类型检查和最终 Web 生产构建通过。

完整浏览器、后端、站点启动和容器结果由 [PR #25](https://github.com/liujing2025sem/AIHOT/pull/25) 对应提交的 Check 记录提供，最终交付记录应同时列出准确提交与运行链接。浏览器截图使用明确标识的隔离 HTTP 样本；有效 PNG 经过完整解码，截图前另检查浏览器图片已解码。这些截图只能证明原页面的隔离操作与呈现。

这些结果来自全新测试库与本地假服务，不是生产部署，也没有读取真实 6098、回执 16 / 17 或购买新模型结果。完整失败明细保存在本轮过程日志 `backend-full.log`，最终重跑结果应另行更新本节。

## 4. 代码核对与发现

- `studio-pitch-v2.ts` 的成稿请求包含 `selected_title`、`heading`、选定事实、工程答复、排除数字、编辑选择及批准范围；按执行计划仅生成非 `keep` 操作。`confirmedFragmentPlan()` 将未选 revise 转为 keep，未选 insert 不进入请求。
- `studio-pitch-fragments.ts` 从解析器位置截取原始 HTML，`assembleFragments()` 保留原 HTML，未完成改写沿用原段。已有测试验证保留段、包裹元素和边界空白；没有通过重排 DOM 序列化替换全文。
- 短讯的引文存在性和事件对应可由代码验证；“引文真正支持整个标题”“开头是否准确兑现标题”“解释是否帮助买家决策”仍是语义审稿，不能从正则或通过计数推导。
- 初查发现 `operations/recover.ts:autoReleaseUnknownReceipts()` 只排除 3 个 Studio purpose。普通稿与短讯共用 `studio_editorial`，修订使用 `studio_revision`，旧备料还有 `studio_prep_keywords` / `studio_prep_outline`，这些既有 purpose 可在 30 分钟后由 unknown 自动放行为 failed。本轮后端已改为排除所有 `studio_` 前缀，错误提示同步要求人工恢复；独立差异核对确认覆盖新旧 Studio 路径，保留其他既有请求的恢复规则。原 `tests/receipts.test.ts` 新增八类 purpose 的 31 分钟边界、`unknown` / `attempts=1`、再次访问不增加请求和无自动放行审计回归，已在本轮定向与完整数据库测试中实际通过。没有据此声称生产回执已被重试或核销。
- 对本轮手工交付变更初查：限制覆盖 WP 客户端写入边界、直接推稿、发布设置和保留队列；只读恢复继续存在。完整判断以负责人新增回归和最终差异核对为准。

## 5. 真实产出最低验收包

下次实际内容验收需要一份可追溯的完整任务，优先复用已保存且获准检查的真实响应，不重新购买未知请求。

1. 原始材料、来源 URL / 日期 / 版本 / 内容哈希，以及买家问题、品牌站点和本任务范围。
2. 备选标题与来源锚点，最终选定标题、小节、事实和范围的请求快照。未知项明确保留。
3. 真实供应商回执与完整原响应，或有原始证据的真实响应回放。注明新调用或回放，注明模型、结果和费用的可得范围。
4. 一篇完整英文成品与中文审稿。逐条核对标题、前两句、事实、数字条件、出处、公司承诺、品牌隔离、信息增益、可读性和相关内链；原页升级还需原段差异检查。
5. 保存、刷新、修订、批准及导出对应同一准确版本。手工下载不记为已发布，实际发布状态需后续运营记录。
6. 简报另需 5–12 个真实独立事件的去重说明、逐事件证据、时效资格与三条速览；模板示例不能补数量。

在取得上述真实输入和输出前，本轮成熟度为内容链规则已核验，真实文章待验收。界面可用、规则加载、代码测试、真实文章质量和流量效果分别记录。

## 6. 继续保持的边界

6098 现有版本 2 保留待用户审稿，本轮不重新生成、不代批、不推独立影子稿、不改公开原页。回执 16、17 未核对，不重试、不把未知费用记为 0。短讯的真实后续验收依用户已有接续顺序推进。模型、采集和 WordPress 开关及原实例凭据由实际部署与授权范围决定，本记录没有开启这些能力。
