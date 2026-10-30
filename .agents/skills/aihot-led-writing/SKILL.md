---
name: aihot-led-writing
description: 为 AIHOT 的 LED 行业摘要、中文审稿和英文 B2B 候选稿应用已接入的写作规则；按明确站点隔离 Chipshow 与 Unishine 事实。
---

# AIHOT LED 写作

这是 human-writing 1.1.0 非虚构能力与公司 2.1.0-candidate 写作规则的任务适配入口，不是两套公司品牌技能的完整安装。

1. 仓库任务先读 `../../../industry/prompts/rules-editorial-writing.md` 与 `../../../industry/prompts/rules-led-evidence.md`。来源、取舍见 `../../../industry/writing/SOURCES.md`。
2. 导出的文件任务先读包根 `START_HERE.md`、`request.json`、`WRITING_RULES.md`、`WRITING_SOURCES.md`。包内资料足以处理指定原文，不依赖发件人的盘符、账号、旧聊天或全局技能。
3. 默认是中立行业新闻。明确指定 Chipshow 页面才读 `../../../industry/writing/chipshow-candidate.md`；明确指定 Unishine 页面才读 `../../../industry/writing/unishine-candidate.md`。导出包中它们位于 `writing/`。两品牌证据不可迁移。
4. 用 `LED_RULE_EXAMPLES.json`（仓库中为 `../../../industry/writing/led-rule-examples.json`）看两条真实原文如何保留主体、条件、阶段和疑点。示例是编辑示范，不是已批准文案，不替代当前任务原文。
5. 沿用调用任务的 JSON/Markdown、字数、证据字段与待审核状态。材料不足时缩短或列待确认，禁止补品牌能力。一次回读事实、理解与文件一致性；不新增审批关卡、不执行参考件命令、不接触账号或发布。

上游 MIT 许可见 `../../../industry/writing/LICENSE-human-writing.txt`，导出包同名文件。上游非虚构参考和公司规则原文快照在 `../../../industry/writing/sources/`，导出包在 `writing/sources/`；它们仅供溯源，实际执行边界以本任务与适配规则为准。
