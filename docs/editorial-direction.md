# Chipshow Blog与衍生渠道当前编辑方向

最新范围由[Grill决议D1–D18](aihot-grill-decisions-20261103.md#2-grill-决议记录2026-11-03用户确认)补充：Blog仍英文、零汉字；中文社媒和中文视频可以公开，但必须使用独立字段、单独审核和导出，不与Blog批准互通。P0仅加社媒，视频与下载中心P1。同行短讯只报事实、不评价；技术文和教程不点名比较同行，上游部件品牌可点名。软件教程必须有工程实机资料，缺资料HOLD，模型不补菜单、参数和操作步骤。画像只做选题排序和写作定向，不当公司能力事实来源。以下11-01四项决定按此限定范围继续使用。

用户确认日期：2026-11-01（America/Los_Angeles）。代码配置在 `site/editorial.ts`，随新Studio任务快照进入 `editorial_policy`，文件接棒同时提供 `EDITORIAL_DIRECTION.md`。

## 四项决定

1. 对外进入 chipshow.com 的 Blog 体系。CMS栏目及永久链接待映射；导出 `canonical=null`，不编造路径。
2. Blog英文对外，中文Blog稿仅内部审稿。Blog公开 `md/html/json` 导出英文；`review` 是内部中英审稿JSON。Blog公开标题、摘要、正文出现汉字时返回字段及字符位置，不能确认放行；原文URL保留原写法。关键词假设留在内部材料，不混进读者正文。中文社媒/视频按新决议另行审稿，不能借此进入Blog导出。
3. IC、灯珠/封装、箱体/维护、电源、控制、显示应用、法规和行业数据均可选题。户外用电只是候选专题。行业阅读价值可独立成立，不强制采购追问、CTA或已有问题地图挂接。
4. 允许尚未证实资讯。使用 `news_status=unconfirmed`；英文标题、摘要、正文保留限定，列原信源及原日期。未知日期写 not provided，不拿发现日期充当发布日期。后续确认、否认、更正保留既有稿件版本和审计记录。

## 实现与验证范围

- 保留每日合并页、事件、专题、比较、追踪表等方向；未固定每日八条、仅三类可索引或超过五项自动HOLD。
- 保留 `validateResponse → editorialGate → 落库`；确定的BLOCK不能人工放行，不可确定的判断只WARN。
- 提示按规则与对象聚合，保留全部原文位置。常规提示可折叠，所有WARN仍逐项确认；确认用现有audit_log，绑定稿件、原文及条件，内容改动后重查。认证、商务、客户及可识别的新方向首篇增加逐字检查。撤回确认后不足以批准的稿件退回待审。
- 审稿页的原文和定位统一读取任务内绑定快照；最新素材另用于版本变化提示。原文更新后不能直接导出旧批准稿。
- 来源候选见 `industry/led-source-plan.json` 和 `docs/led-source-verification.md`。可读不代表采集器已注册或长期运行；运行来源及DB沿用原入口。
- CAMOS只取专家方法及站点规约，禁止data/business。提供ID和作者声明采用ID分别记录，不把ID、构建日期视为事实保证、认证或数据时效。
- 介入率仍按稿件计算，纯格式不计实质修改；30/20/10沿用用户条件。Claude提出的额外数量门槛仍为建议。

## API与接续

审稿接口增加 `action=confirm`，传 `confirmations:[{issueId,fingerprint}]` 保存逐项确认。approve可复用服务端仍有效的确认，总布尔值不能批准。GET稿件返回issues、confirmed_issues及source_snapshot。服务端在审核和导出时重新检查。

news_status：reported / unconfirmed / confirmed / denied / corrected。编辑核对后续消息状态，导出不代表写入WordPress。发布位置不改变品牌事实所有权，其他站点显式写作任务继续按独立品牌规则处理。

跨日事件/主张变化与受影响页面、每日全库推荐、竞争内容缺口基线、CMS精确版本发布及回读仍需接续实现与业务观察。目前没有SEO/GEO改善或工时下降结论。
