# LED 写作规则实际接入

AIHOT 的站内文字生成与文件派单现在共用 `industry/prompts/rules-editorial-writing.md`。原厂主体、品牌隔离、数字条件、中文自然表达与英文 B2B 阅读要求都在这份正文里；来源和取舍见 `industry/writing/SOURCES.md`。公司规则仍为 `2.1.0-candidate`，human-writing 精确版本为 `4fda173f3fef7fb808f3eba991eeb2528ea4b189`（1.1.0、MIT）。

## 实际使用路径

- 站内：`rules-domain → rules-led-evidence → rules-editorial-writing`，已有摘要、understand、短帖/全文翻译的 includes 会展开这份规则；`story-digest` 直接沿已有 evidence include 展开；`report-period` 新增 evidence include。原 promptVersion 机制会把被 include 文件计入版本，无需另建注册表或门禁。
- 文件接棒：仍用 `editorial-pilot.ts export <dir> <task-id>`。除了原 request/START_HERE/RESPONSE_FORMAT，还导出 `WRITING_START_HERE.md`、`WRITING_RULES.md`、`WRITING_SOURCES.md`、`LED_RULE_EXAMPLES.json`、MIT 许可、两份独立品牌适配参考与八份所选原文快照。新 Agent 从 `WRITING_START_HERE.md` 开始即可，不需原机器、其他账号或历史聊天。收回结果继续用原 receive、HTML 审稿和中英 Markdown 输出。
- 仓库 Agent：入口 `.agents/skills/aihot-led-writing/SKILL.md`。这是实际写入的本地技能；是否被某个新聊天的宿主自动发现，仍需该宿主核验。本次提示词和文件交接接入不依赖自动发现。

旧 request 无 `writing` 仍是中立原厂新闻。只有明确公司页面任务才加以下可选字段，不能从工作目录或新闻来源猜品牌：

```json
{"writing":{"site":"unishineled.com","target_url":"https://www.unishineled.com/assigned-page/","page_type":"guide","reader_task":"说明当前证据能支持的选型判断"}}
```

站点只接受 chipshow.com、chipshowledusa.com、chipshow.eu、unishineled.com，目标 URL 主机须一致；品牌产品事实仍需该品牌当前证据。示例 URL 是任务格式示意，不表示该页面存在或获准创建。当前 DB export 仍导出两条原厂新闻，不自动指定品牌页；品牌上下文供已有文件派单使用。

重复 export 复用相同 request，补充写作资料，不覆盖旧 START_HERE 或同事稿件。若已有写作资料与本次版本不同，沿已有 writeOnce 行为要求新目录，避免混用；不改变旧任务的审批状态。旧包的 receive 继续有效，不新增规则读取证明或质量分数门槛。

## AI 常犯、人常改的错误及这次修法

| 常见返工 | 包内证据 | 成稿要求 |
| --- | --- | --- |
| 标题/主体变了，正文证据没变 | Chipshow T1-03/T5-02；human-writing reality | 先写读者要理解什么，标题只承诺原文能证明的变化 |
| 原厂参数变成自家能力，两品牌混用 | Chipshow T13-01、T5；Unishine B0/B2 | 原厂事实留给原厂，Chipshow 与 Unishine 的声明逐项隔离 |
| 数字丢单位、型号、条件或阶段 | Chipshow T5/T6；Unishine W5/W6 | 值与条件同写，预计送样不写成现货，部件不写成整屏实测 |
| 中文通顺但空，反复翻案、黑话和升华 | human-writing SKILL/reality/revision | 人与动作先出现，每段增加事实或解释，无材料就缩短 |
| 英文名词链、悬空 it、术语没有前提 | Chipshow T4；RBG 前提层、N/P/Q | 先理清中文逻辑，再写具体主体与动词；补有来源前提，拆句不补事实 |
| 清单/表格看起来完整，读者仍不懂 | Chipshow T2/T3/T7；RBG K 与表格门 | 按读者问题安排内容，同类放同列，不强塞采购动作 |
| Meta、摘要或 FAQ 又写回已删的结论 | Chipshow T10-05/T12-07；Unishine B10 | 核心前提变化后同步回读现有输出字段，扫描无命中不等于通过 |

## 两条真实原文与验证边界

`industry/writing/led-rule-examples.json` 从既有 `editorial-coldstart-20261029/request.json` 取两条完整绑定原文并附短示范、逐字证据和待确认问题，能独立阅读。没有重新抓取或调用模型，示例不是 180–300 词完整实验稿。

Kinglight 2391/2297：免螺丝须保留实际环境/运行条件下的稳定性评估，4000–5000 nits 归于厂商描述，不构成任意整屏的实测保证。Macroblock/Juxin：MBS7764 的 15,360Hz 绑定 full 64-scan，Q4 是预计送样；MBI5292 在原文前后归属不一致，明确留下问题而不裁定。

相关验证命令（从源码根执行，Node 路径由当前环境指定，不写入产品配置）：

```text
node --import ./tests/standalone.ts --test tests/editorial-pilot.standalone.test.ts
```

测试检查生产 prompt renderer 的实际展开、两条真实快照/引文、独立文件包读取、站点匹配，以及原有 receive 的版本绑定/重放/同事编辑保护。测试使用本项目 `industry/writing/` 下临时目录并结束删除。测试不启动真实采集、模型、CMS 或发布；不声称两个上游扫描器已运行，也不把新进程读文件等同于新 Agent 成稿验收。完整数据库测试、Web build/smoke 与迁移后的持续运行由主 Agent 的运行环境任务负责，不能用本模块测试代替。
