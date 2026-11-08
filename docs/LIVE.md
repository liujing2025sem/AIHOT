# AIHOT LIVE：现在有效的决定、底线和状态

> 先读本文件，再读 `docs/aihot-pitch-prd-v2-20261108.md`（当前 Goal）和 `docs/aihot-exec-plan-20261108-v2.md`。其他旧规划只作参考；用户当前明确指令优先。
>
> 维护规则：Codex 每次合并后更新“状态”和“下一步”，每节不超过 5 行。改“决定”要有用户的原话；加“底线”要附一个真实发生的失败例子，并且不超过推进工作的 1/5。
>
> Drive 副本：<https://drive.google.com/drive/folders/1-QTuSmTrznxcG5RKqEwEl1_9TTtQ_VVS>

## 决定（2026-11-08，v2）

| # | 决定 |
|---|---|
| D-01 | AIHOT 只推 WordPress 草稿（REST 加应用密码），由用户点发布 |
| D-02 | AIHOT 只做英文页面。翻译由 CSM 负责（用户在 CSM 项目里提 issue），短讯、短文章、长文都会进 CSM；AIHOT 不做翻译开发，文字不放进图片和 CSS |
| D-03 | 短讯和短文章：流量优先；标题冲击力优先，每个钩子都要有事实锚点 |
| D-04 | 长文：质量优先；一篇解决一个真实问题；长期维护；给销售的定制版放到第 3 周以后 |
| D-05 | 泛流量全要，包括消费级显示（可以写成短文章）；消费级内容单独一个分节，加 WP 标签 `consumer-display` |
| D-06 | 原创素材：询盘问题、工程师确认、项目案例和现场照片 |
| D-07 | 短讯攒够 5 条可用素材出一期，不设日历、跳刊和补刊规则 |
| D-08 | 2026-11-08 用户要求执行《命题采编 PRD v2》第 3 节并合并本节决定：CI 通过，并有本项真实样例即可合并；若样例只差人工审批或外部凭据，且相关安全阀默认关闭，CI 通过即可合并。补齐样例后记入状态。 |
| D-09 | 风险清单 v2：同行负面、自家负面、贬损齐普的内容一律不写 |
| D-10 | 2026-11-08 用户覆写计划：“不新建LED Display Brief，短讯/短文章直接用现有Industry News。” 短内容进 News 下的 Industry News（`industry-news`，ID 72）；长文和升级页进 Choose Guides（`choose-guides`，ID 29）。不新建或改动分类。 |
| D-11 | 工程师把关：每篇长文最多 3 道中文单选题（1 分钟确认卡）；署名 Reviewed by Chipshow Engineering Team；没勾完只卡这一篇 |
| D-12 | 误报的 BLOCK 可以放行，但必须选出处主体，或标为“不是数字声明”；放行记日志，误报词每周修进词典。黑名单和风险清单的命中不能放行 |
| D-13 | 先升级现有第一流量页（尺寸指南），再做 MiP；短讯负责给常青页导流 |
| D-14 | 新增防御的上限：每阶段不超过推进工作的 1/5，必须附一个真实失败例子 |
| D-15 | 命题采编：先脱敏、备料、选证据/大纲/标题，再成稿。无工程回复可选保守写法，不冒用工程团队署名；已验证外部参考数字不等同于公司承诺。 |
| D-16 | 命题成稿按片段生成，由代码拼装；升级稿保留段逐字不变。依据同上用户执行指令。 |
| D-17 | 证据按买家子问题组织；代码能算的数字由代码计算；常青题目配“参考资料”信源。依据同上用户执行指令。 |

## 底线

- **G1 公开的就是批准的。** WP 草稿内容就是批准的英文版本；改过就要重新批准。
- **G2 数字有出处，公司事实有许可。** 外部数字带来源，厂商说法标为厂商说法。私有黑名单（≤30 条，放在目标机，不进仓库）：禁止项直接 BLOCK，不能放行；待确认项走工程师确认卡。
- **G3 新鲜度双窗口。** 展会、项目和市场新闻：14 天内。上游新品、规格和版本更新：30 天内，且首次发现、从未发过。没有原文日期的进资料池（基线之后新出现的版本号除外）。同一事件只出一条。
- **G4 风险清单 v2。** 写“老屏换新”这类故事时，不点名原来的屏厂。
- **G5 不越界。** 不绕过 403、429、验证码和登录；不提交密钥和私有数据；AIHOT 不对公网开放；WP 只建草稿。

## 状态（2026-11-08，Codex目标机核验）

- PR #17 已按 D-08 的人工审批例外合并，main 为 `3cfe992`；对应 CI [42469856336](https://github.com/liujing2025sem/AIHOT/actions/runs/42469856336) 通过，真实文章推送仍待本人批准。
- PR #18 `c250231` 保持草稿并改以 main 为基线；新工作在 PR #19 `codex/pitch-fragments-v2-20261108`。真实完整升级稿未交出，不能用代码测试代替实测合并条件。
- 目标机 `K:/codex/AIHOT-wbtest`、53181 已加载片段采编；无需聊天 Agent 代写。86 个旧页块在本地拼装验证中逐字节保留；数字/单片段超时/界面经合成测试。
- 本轮真实回执14：微测试43输入/30输出token、3.465秒；15：拆题6题，2617/2069token、24.741秒；16：编辑计划等45秒后unknown，未重试。整轮备料69.921秒但没有完整结果，不能算速度达标。
- 原回执12仍unknown；MiP v3仍待审、未代批。6098没有新升级稿；本轮尚未调用片段成稿，没有推送或公开发布。实际费用未知。

## 下一步

1. 当前调用16结果未知：不得重试、不得以改版本/输入绕成第二次收费；先交调用表和CI，由用户决定模型安排。本轮还没有获得可用编辑计划。
2. 工程代码可继续免费验证/重放已有回答。未来独立任务的第二段会用90秒总预算的剩余时间，而不是固定45秒；此修正未对回执16重新调用。
3. 未知结果不证明唯一根因：微测试只证明当时可用；历史另一次整页回执13为37711输入/18379输出token、226秒，属于不同任务，不能拿来验收6098。

## 参考资料（D-17，12入口覆盖10类常青问题）

清单机器版为 `industry/reference-pages.json`，信源 `studio-reference-pages`（参考资料），复用正文抽取，不按新闻新鲜度淘汰。2026-11-08 实测10个有可读正文，两个403原样保留为未接入；未绕过限制。参考事实必须保留其领域、地区和适用边界。

| 主题 | 官方/机构入口 | 抽取结果 |
|---|---|---|
| 广告牌尺寸 | [OAAA Media Formats](https://oaaa.org/resources/media-formats/) | 可读 |
| 英尺与米换算 | [NIST U.S. Survey Foot](https://www.nist.gov/pml/us-surveyfoot) | 可读 |
| 像素计算输入 | [NIST Conversion Factors](https://www.nist.gov/pml/us-surveyfoot/revised-unit-conversion-factors) | 可读；像素由代码计算 |
| 面积与单位 | [NIST SI Appendix B9](https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b9) | 可读 |
| 亮度与照度 | [NIST Candela](https://www.nist.gov/si-redefinition/candela) | 可读 |
| 功率与电量 | [Virginia Tech Energy Use](https://www.pubs.ext.vt.edu/2901/2901-9014/2901-9014.html) | 可读，不能套用家电功率 |
| 器件与整机效率 | [US DOE LED Basics](https://www.energy.gov/cmei/ssl/led-basics) | 可读，照明资料不是直显屏实测 |
| 户外电气安装 | [OSHA 1910.303](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.303) | 403，未接入 |
| 招牌许可 | [OAAA Laws](https://oaaa.org/policy-advocacy/general-information/laws-regulations/) | 可读，仅美国概览 |
| 白点与色温 | [CIE CCT](https://www.cie.co.at/eilvterm/17-23-068) | 可读 |
| 广告牌尺寸补充 | [OAAA Cause Related Formats](https://oaaa.org/become-an-oaaa-cause-related-campaign-partner/) | 可读，区分画面像素与物理尺寸 |
| 亮度单位补充 | [IES Luminance](https://www.ies.org/definitions/si-unit-of-luminance/) | 403，未接入 |
