# AIHOT GEO 资产计划（R1.5 与 G 系列）

AIHOT 先让人能走完第一篇，再从「写文章」转向「维护会被引用的资产」：版本追踪页、声明库和活参考表、AI 答案差距雷达。
服务对象是 Chipshow 运营和网站读者，以及引用网站内容的搜索引擎与 AI 答案。
贯穿始终的规则是：每个对外数字都能回到原文、版本和日期；BLOCK 永远不能放行；模型只在任务里调用。
PR 顺序为 PR-1、PR-2、PR-3、PR-4、PR-5、PR-6。Claude 负责策划与验收，GPT 负责实现，WorkBuddy 负责目标机，用户决定合并与对外发布。

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

一个方框是一件事，方框里写明用什么证据来勾选。只有证据存在时才能勾选。正文是操作步骤，附录是解释和记录。

The program runs `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`. GPT builds and verifies each PR and stops at merge-ready. The operator (the user) merges every PR. PR-2, PR-3, PR-4, PR-5 and PR-6 change what the operator sees and wait for the operator's review.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

本计划服从 `docs/aihot-grill-decisions-20261103.md` 的 D1 至 D18、`docs/aihot-production-plan-20261104.md` 的停止条件，以及 `docs/aihot-readability-review-20261105.md` 的问题清单。

## Program checklist

### Arm the program 启动

- [ ] 向用户复述本计划和执行方式，然后停下。只有用户明确说开始，才开始执行。
- [ ] 程序开始时从主干读取以下文件，每次巡检时重新读取。
  - [ ] `git show origin/main:docs/aihot-geo-program-plan-20261105.md`
  - [ ] `git show origin/main:docs/aihot-readability-review-20261105.md`
  - [ ] `git show origin/main:docs/aihot-production-plan-20261104.md`
  - [ ] `git show origin/main:docs/aihot-grill-decisions-20261103.md`
  - [ ] `git show origin/main:AGENTS.md`
- [ ] 按用户决定，在 Codex 中安装 pstack 技能（`npx skills add backnotprop/pstack`），并阅读 `pstack/skills/poteto-mode/playbooks/autopilot-stack.md` 和 `pstack/skills/poteto-mode/playbooks/opening-a-pr.md`。未安装时以本计划为准。
- [ ] 宿主支持定时巡检时，用 `/loop 1h` 和下面的巡检提示开启巡检；不支持时，每完成一个 PR 执行一次同样的巡检。
- [ ] 巡检提示原文如下。「从主干重新读取本计划，按计划核对进展并在本次巡检中纠正偏差。只根据实际产出判断进展。只有出现上次 status message 没有报告过的变化时，才给用户发一条简短的 status message，例如 PR 已开、到达 merge-ready、Claude 给出结论、用户合并、卡住。」
- [ ] 用户说暂停时，立即停止所有写入。

### Spawn owners 分派

- [ ] 每个 PR 由 GPT 作为唯一负责人，完整走完实现、自测、回执、等待验收。
- [ ] 依赖关系如下，被依赖的 PR 合并后才开始下一个。
  - [ ] PR-1 从 `main` 开始。
  - [ ] PR-2 在 PR-1 之后，PR-3 在 PR-2 之后。
  - [ ] PR-4 和 PR-5 在 PR-3 之后，二者互不依赖。
  - [ ] PR-6 在 PR-5 之后。
- [ ] 守住文件边界。PR-1 只改 `industry/` 和编辑门测试；PR-4 不改编辑门；PR-6 不改采集器。
- [ ] 守住审阅门。PR-2 至 PR-6 改变运营看到的界面，合并前要用户看截图和视频。

### PR mechanics 每个 PR 的做法

- [ ] 用 `gh` 或宿主自带的 PR 工具。PR 开成 ready，标题用 conventional commits 格式；描述开头三行写给用户：做了什么、你现在能做什么、需要你决定什么。
- [ ] 推送前跑一次 `npm run typecheck`，在 Node 24 上跑完整 `npm test`，再跑 `npm run build -w @aihot/web`。
- [ ] 每个提交只做一件事，提交信息写明满足哪一个方框。
- [ ] 准备交 Claude 验收前，先 rebase 到当前 main。

### Verdict and merge 验收与合并

- [ ] Claude 在 code-ready 的 head SHA 检出、跑测试、读核心改动，按本计划逐个方框给出通过或退回。退回时 GPT 只改退回的部分，Claude 只复验增量。
- [ ] 主干已有的失败不阻塞 PR，但要在回执中写明。
- [ ] 用户合并。合并后由 WorkBuddy 在目标机执行迁移并贴出迁移输出。

### Boot recipe 每条线上检查的环境

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`。
- [ ] 新建 `_test` 结尾的数据库，执行 `node scripts/migrate.ts`，导入 `tests/fixtures/editorial-preview-20261103.json` 与本计划需要的合成数据；构建 Web，启动 API 和 Web，等待健康检查通过。
- [ ] 只用 Playwright 操作页面（1440 和 390 两个宽度），只读诊断用 API 的 GET。
- [ ] 截图保存到 `/tmp/aihot-<pr-id>/lane-<n>/<slug>.png`，在回执中列出路径。涉及目标机的一条线，由 WorkBuddy 在目标机执行并截图。

## 修掉主体识别造成的误拦（PR-1）

**Depends on.** None，从 `main` 开始。

**Files.**

- [ ] Edit `industry/taxonomy.ts`，补 ENTITIES 和 IDENTITY_LEXICON。
- [ ] Edit `industry/sources.json`，给 16 个 LED 信源填 owner_entity_id。
- [ ] Edit `tests/editorial-gate.standalone.test.ts`。

**Build.**

- [ ] 列出候选主体和常用简称（晶台、国星、聚积、诺瓦、卡莱特、集创北方、创联、巨能、灰度、OAAA、LEDinside），先交用户确认再写入。
- [ ] 16 个 LED 信源都有 owner_entity_id；行业媒体和协会登记为可归属的来源主体，不登记为厂商。
- [ ] 用新词典对 R1 已保存的 MiP 回复重跑编辑门，不调用模型，列出剩余的 BLOCK 和 WARN。

**You see.**

- [ ] 「晶台称其 MiP 封装尺寸为 0.65 mm」和「卡莱特称 Z6 刷新率为 3840Hz」不再触发 D1 BLOCK，没有归属的数值仍然 BLOCK。
- [ ] MiP 回复剩余的每一条 BLOCK 都附原句和处理建议。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] 在 `tests/editorial-gate.standalone.test.ts` 增加简称归属、无主体信源、无归属数值三组用例。Run `node --import ./tests/standalone.ts --test tests/editorial-gate.standalone.test.ts`.
- [ ] Run `npm run typecheck` and `npm test` on Node 24.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `Playwright Chromium 1440 and 390` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. 在 trunk 和 head 对同一份 MiP 回复重跑编辑门并打开任务页。Save `pr1-mip-gate.png`. Pass when head 的 BLOCK 少于 trunk，且每条剩余 BLOCK 能指出原句。
- [ ] Lane 2. 导入一份合成回复，中文写「晶台称…」。Save `pr1-kinglight.png`. Pass when 任务页没有 D1 BLOCK。
- [ ] Lane 3. 导入一份合成回复，中文写「卡莱特称…」。Save `pr1-colorlight.png`. Pass when 任务页没有 D1 BLOCK。
- [ ] Lane 4. 导入一份合成回复，中文写「集创北方称…」。Save `pr1-chipone.png`. Pass when 任务页没有 D1 BLOCK。
- [ ] Lane 5. 导入一份合成回复，中文写「创联称…」。Save `pr1-czcl.png`. Pass when 任务页没有 D1 BLOCK。
- [ ] Lane 6. 导入一份合成回复，中文写「巨能称…」。Save `pr1-genergy.png`. Pass when 任务页没有 D1 BLOCK。
- [ ] Lane 7. 导入一份合成回复，中文写「灰度称…」。Save `pr1-huidu.png`. Pass when 任务页没有 D1 BLOCK。
- [ ] Lane 8. 导入一份合成回复，引用 OAAA 的统计数字。Save `pr1-oaaa.png`. Pass when 归属写明 OAAA 时没有 D1 BLOCK。
- [ ] Lane 9. 导入一份合成回复，写一个没有任何归属的数值。Save `pr1-unattributed.png`. Pass when 仍然出现 D1 BLOCK。
- [ ] Lane 10. 导入一份合成回复，英文写 According to Colorlight。Save `pr1-english.png`. Pass when 英文正文没有 D1 BLOCK。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 对 MiP 回复运行一次编辑门的耗时。
- [ ] Probe. 在 trunk 和 head 交替各运行 50 次 `evaluateDraft`。
- [ ] Baseline. 先记录 trunk 的中位数。
- [ ] Rule. head 中位数超过 trunk 的 1.5 倍即失败。

**Review gate.** None. 本 PR 不改界面；主体名单由用户在 Build 阶段确认。

**Merge.**

- [ ] Claude 在 head SHA 给出通过。
- [ ] 用户确认过主体和简称名单。
- [ ] 用户合并。

## 让被拦的候选稿可以在页面上修改，并按原文日期显示（PR-2）

**Depends on.** PR-1。

**Files.**

- [ ] Edit `packages/backend/src/admin/studio.ts` 和 `packages/backend/src/admin/studio-review.ts`。
- [ ] Edit `apps/web/app/routes/admin/studio.tsx`、`apps/web/app/routes/admin/studio-draft.tsx`、`apps/web/app/routes/admin/studio-planning.tsx`。
- [ ] Edit 现有的 Studio 后端测试和 `apps/web/tests/studio-planning.test.ts`。

**Build.**

- [ ] 成稿被拦时，把候选保存为「待修稿」，用现有稿件编辑页打开；可以编辑，保存后重新检查；BLOCK 仍然不能勾选放行；不重新调用模型。
- [ ] 卡片、任务、稿件和写作输入都显示原文日历日期和精度，按信源时区换算（默认北京时间），复用 `packages/contracts` 里已有的时间换算。

**You see.**

- [ ] 被拦的任务行出现「打开待修稿」，打开后每条必须修改的项都显示所在句子和定位按钮。
- [ ] MiP 稿的原文日期显示为 2026-10-23（北京时间），写作输入里带有这个本地日期。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] 测试覆盖：被拦候选转为待修稿；BLOCK 不能被确认；修改后重新检查；2026-10-22T16:00Z 显示为 2026-10-23。Run `npm test` on Node 24.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `Playwright Chromium 1440 and 390` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. 在 trunk 和 head 打开同一个被拦任务。Save `pr2-blocked.png`. Pass when 只有 head 出现「打开待修稿」。
- [ ] Lane 2. 打开待修稿，修改一处必须修改的句子并保存。Save `pr2-edit.png`. Pass when 重新检查后这一项消失。
- [ ] Lane 3. 尝试勾选一条 BLOCK。Save `pr2-block-locked.png`. Pass when 无法勾选，并提示必须修改。
- [ ] Lane 4. 把所有 BLOCK 改完。Save `pr2-clean.png`. Pass when 稿件进入正常审稿，状态为待审。
- [ ] Lane 5. 改完后刷新页面。Save `pr2-reload.png`. Pass when 修改仍在，版本号增加。
- [ ] Lane 6. 整个过程中查看回执数量。Save `pr2-no-model.png`. Pass when 回执数量没有增加。
- [ ] Lane 7. 查看 MiP 卡片的原文日期。Save `pr2-card-date.png`. Pass when 显示 2026-10-23（北京时间）。
- [ ] Lane 8. 查看任务页和稿件页的原文日期。Save `pr2-draft-date.png`. Pass when 与卡片一致。
- [ ] Lane 9. 在 390 宽度完成一次修改。Save `pr2-mobile.png`. Pass when 没有横向溢出，按钮可点。
- [ ] Lane 10. WorkBuddy 在目标机打开真实 MiP 任务。Save `pr2-target.png`. Pass when 能打开待修稿并看到剩余项。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 稿件编辑页从打开到可编辑的时间。
- [ ] Probe. 在 trunk 的普通稿件和 head 的待修稿上交替各测 20 次。
- [ ] Baseline. 先记录 trunk 普通稿件的中位数。
- [ ] Rule. head 待修稿的中位数超过 trunk 的 1.5 倍即失败。

**Review gate.** The operator reviews before merge.

- [ ] 把第 1、2、4、7 条线的 screenshot 复制到 `docs/assets/review/pr2-*.png`。
- [ ] 录一段 30 到 60 秒的 video，演示从被拦到修完进入审稿。
- [ ] 把 screenshot 和 video 发给 operator，停在 merge-ready，等用户合并。

**Merge.**

- [ ] Claude 在 head SHA 给出通过。
- [ ] 用户看过截图和视频。
- [ ] 用户合并，WorkBuddy 在目标机部署。

## 用人话展示工作流，并重写运营手册（PR-3）

**Depends on.** PR-2。

**Files.**

- [ ] Edit `apps/web/app/routes/admin/studio.tsx`、`apps/web/app/routes/admin/studio-planning.tsx`、`apps/web/app/routes/admin/studio-draft.tsx`。
- [ ] Edit `packages/backend/src/admin/studio-recommendations.ts`（命中词与低置信度）。
- [ ] Edit `docs/operator-guide.md`，Create `docs/r1-run-log.md` 和 `docs/glossary.md`，Edit `docs/studio-planning.md`。
- [ ] Create `scripts/check-operator-copy.ts`。

**Build.**

- [ ] 界面用语改成中文名称：卡片类型、必须修改与需要确认、写与暂缓与不写；规则编号放进悬停提示；字段路径和字符位置改成所在句子。
- [ ] 卡片显示命中词；只命中一个通用词时标为低置信度，不进入待处理名额。
- [ ] 去掉界面里的项目状态说明；任务标题用问题或素材标题，编号收进「复制编号」，Agent 接棒收进「高级」。
- [ ] 侧栏信源页在 worker 关闭时说明到采编工作台采集。
- [ ] 运营手册按任务写，从登录到社媒，附「被拦了怎么办」和术语表；R1 记录移到 `docs/r1-run-log.md`。
- [ ] `scripts/check-operator-copy.ts` 扫描运营页面的渲染结果，发现 drafts[0]、UTC ISO 时间、单独的触发字母等就失败。

**You see.**

- [ ] 运营页面上看不到 drafts[0]、UTC ISO 时间和单独的触发字母。
- [ ] ViewSonic 获奖新闻不再生成「海运验货」卡。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] 用 ViewSonic 那条真实素材加低置信度回归用例。Run `npm test` on Node 24.
- [ ] Run `node scripts/check-operator-copy.ts` against the built Web.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `Playwright Chromium 1440 and 390` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. 在 trunk 和 head 打开「今日值得处理」。Save `pr3-planning.png`. Pass when head 没有触发字母，卡片显示命中词。
- [ ] Lane 2. 打开一张低置信度卡。Save `pr3-low-confidence.png`. Pass when 标为低置信度且不占名额。
- [ ] Lane 3. 打开任务列表。Save `pr3-tasks.png`. Pass when 每个任务有可读标题，编号收起。
- [ ] Lane 4. 打开稿件审稿页。Save `pr3-review.png`. Pass when 显示必须修改和需要确认，而不是 BLOCK 和 WARN。
- [ ] Lane 5. 悬停一条规则。Save `pr3-tooltip.png`. Pass when 悬停提示里能看到规则编号。
- [ ] Lane 6. 打开采编工作台首页。Save `pr3-home.png`. Pass when 没有项目状态说明。
- [ ] Lane 7. 在 worker 关闭时打开侧栏信源页。Save `pr3-sources.png`. Pass when 页面说明到采编工作台采集。
- [ ] Lane 8. 在 390 宽度打开以上页面。Save `pr3-mobile.png`. Pass when 没有横向溢出。
- [ ] Lane 9. 运行 `scripts/check-operator-copy.ts`。Save `pr3-copy-check.png`. Pass when 输出 0 个问题。
- [ ] Lane 10. 用户照新手册，把一张卡从采纳走到导出。Save `pr3-cold-start.png`. Pass when 用户不需要问人就能完成，卡住的地方都已经修好。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 「今日值得处理」页从打开到看到第一张卡的时间。
- [ ] Probe. 在 trunk 和 head 交替各测 20 次，用同一批合成卡片。
- [ ] Baseline. 先记录 trunk 的中位数。
- [ ] Rule. head 中位数超过 trunk 的 1.2 倍即失败。

**Review gate.** The operator reviews before merge.

- [ ] 把第 1、3、4、10 条线的 screenshot 复制到 `docs/assets/review/pr3-*.png`。
- [ ] 录一段 30 到 60 秒的 video，演示新手按手册走完一张卡。
- [ ] 把 screenshot 和 video 发给 operator，停在 merge-ready，等用户合并。

**Merge.**

- [ ] Claude 在 head SHA 给出通过。
- [ ] 第 10 条线的冷启动验收由用户完成。
- [ ] 用户合并，R1 到此完成。

## 做控制软件版本追踪页（PR-4）

**Depends on.** PR-3。

**Files.**

- [ ] Create `packages/backend/src/admin/studio-version-tracker.ts` 及其测试。
- [ ] Create `apps/web/app/routes/admin/studio-versions.tsx`，Edit `apps/web/app/routes.ts`。
- [ ] Edit `docs/operator-guide.md`，增加版本追踪一节。

**Build.**

- [ ] 从版本源的素材生成追踪表：软件、最新版本、原日期或「原日期未知，发现于某日」、官方下载链接、对应教程页（问题地图里有 URL 时）。
- [ ] 首次导入的历史版本放在「历史」里，新出现的版本在表上标为新版本，并与 E 卡关联。
- [ ] 运营批准后导出英文 HTML 表格和 JSON，供人工贴到 WordPress；导出零汉字；不调用模型。

**You see.**

- [ ] 追踪页列出 LEDVISION、HDPlayer、Colorlight 固件和 LEDSETTING 的最新版本，日期写法真实。
- [ ] 导出的 HTML 只链接官方地址，没有托管任何文件。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] 用 fixture 里 22 条版本条目测试：首次导入全部进历史；新增无日期的 V9.8 进入最新；导出零汉字。Run `npm test` on Node 24.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `Playwright Chromium 1440 and 390` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. trunk 上没有追踪页，记录这一点；在 head 打开追踪页。Save `pr4-tracker.png`. Pass when 显示 4 个软件的行。
- [ ] Lane 2. 只导入历史版本。Save `pr4-history.png`. Pass when 所有行都在历史里，没有新版本标记。
- [ ] Lane 3. 新增无日期的 LEDVISION V9.8。Save `pr4-new-version.png`. Pass when 该行标为新版本，写「原日期未知」。
- [ ] Lane 4. 点开新版本行关联的卡片。Save `pr4-ecard.png`. Pass when 打开的是对应的版本卡。
- [ ] Lane 5. 未批准时尝试导出。Save `pr4-export-locked.png`. Pass when 导出不可用。
- [ ] Lane 6. 批准后导出 HTML。Save `pr4-export.png`. Pass when 文件里没有汉字，链接都是官方地址。
- [ ] Lane 7. 导出 JSON。Save `pr4-json.png`. Pass when 每行都有日期精度字段。
- [ ] Lane 8. 问题地图里给 LEDVISION 教程填了 URL。Save `pr4-tutorial-link.png`. Pass when 追踪表显示教程链接。
- [ ] Lane 9. 在 390 宽度打开追踪页。Save `pr4-mobile.png`. Pass when 表格可横向滚动，页面不溢出。
- [ ] Lane 10. WorkBuddy 在目标机打开追踪页。Save `pr4-target.png`. Pass when 显示目标机真实的版本素材。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 生成追踪表的耗时。trunk 没有这个功能，用绝对预算。
- [ ] Probe. 用 1000 条合成版本素材运行 20 次。
- [ ] Baseline. 记录 head 的中位数和 22 条 fixture 的中位数。
- [ ] Rule. 1000 条超过 500 ms 即失败。

**Review gate.** The operator reviews before merge.

- [ ] 把第 1、3、6 条线的 screenshot 复制到 `docs/assets/review/pr4-*.png`。
- [ ] 录一段 30 到 60 秒的 video，演示新版本出现到导出。
- [ ] 把 screenshot 和 video 发给 operator，停在 merge-ready，等用户合并。

**Merge.**

- [ ] Claude 在 head SHA 给出通过。
- [ ] 用户看过截图和视频，并决定是否发布到网站。
- [ ] 用户合并。

## 建声明库和第一张活参考表（PR-5）

**Depends on.** PR-3。

**Files.**

- [ ] Create `database/migrations/0106_studio_claims.sql`，每个文件一条语句；需要索引时另建文件，用 `CREATE INDEX CONCURRENTLY IF NOT EXISTS`。
- [ ] Create `packages/backend/src/admin/studio-claims.ts` 及其测试。
- [ ] Create `apps/web/app/routes/admin/studio-claims.tsx`，Edit `apps/web/app/routes.ts`。

**Build.**

- [ ] 稿件批准时，把它的 evidence（claim 和原文 quote）登记为声明，带主体、原文 URL、原文版本、原文日期、批准时间、使用它的稿件和页面。不调用模型。
- [ ] 运营可以把声明整理进表格行（主体、型号、参数、数值、单位、条件），第一张表为「上游新品参数登记表」。
- [ ] 原文出现新版本时，用到它的声明标为「待复核」，并给使用它的页面生成更新卡。
- [ ] 表格批准后导出英文 HTML 和 CSV，每行带来源和核实日期。

**You see.**

- [ ] 批准 MiP 稿后，声明库里出现它的 3 到 5 条声明，每条能打开原文定位。
- [ ] 改动原文版本后，相关声明变为待复核，并出现一张更新卡。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] 测试覆盖：批准时登记声明；重复批准不重复登记；原文改版时标为待复核；导出零汉字。Run `npm test` on Node 24.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `Playwright Chromium 1440 and 390` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. trunk 上没有声明库，记录这一点；在 head 批准一篇合成稿。Save `pr5-claims.png`. Pass when 声明库出现这篇稿的全部 evidence。
- [ ] Lane 2. 打开一条声明的原文定位。Save `pr5-locate.png`. Pass when 跳到原文对应句子。
- [ ] Lane 3. 把一条声明整理为表格行。Save `pr5-row.png`. Pass when 行内有主体、型号、参数、数值、单位、条件。
- [ ] Lane 4. 不填条件就保存表格行。Save `pr5-row-invalid.png`. Pass when 保存被拒并提示缺条件。
- [ ] Lane 5. 让原文出现新版本。Save `pr5-stale.png`. Pass when 声明变为待复核，出现一张更新卡。
- [ ] Lane 6. 未批准时尝试导出表格。Save `pr5-export-locked.png`. Pass when 导出不可用。
- [ ] Lane 7. 批准后导出 HTML 和 CSV。Save `pr5-export.png`. Pass when 没有汉字，每行有来源和核实日期。
- [ ] Lane 8. 同一篇稿批准两次。Save `pr5-idempotent.png`. Pass when 声明没有重复。
- [ ] Lane 9. 在 390 宽度打开声明库。Save `pr5-mobile.png`. Pass when 不溢出。
- [ ] Lane 10. WorkBuddy 在目标机批准 MiP 稿后打开声明库。Save `pr5-target.png`. Pass when 出现 MiP 稿的真实声明。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 声明库列表页的查询耗时。trunk 没有这个功能，用绝对预算。
- [ ] Probe. 用 1 万条合成声明查询 20 次。
- [ ] Baseline. 记录 head 在 100 条和 1 万条时的中位数。
- [ ] Rule. 1 万条超过 300 ms 即失败。

**Review gate.** The operator reviews before merge.

- [ ] 把第 1、3、5、7 条线的 screenshot 复制到 `docs/assets/review/pr5-*.png`。
- [ ] 录一段 30 到 60 秒的 video，演示批准、整理成表、原文改版、导出。
- [ ] 把 screenshot 和 video 发给 operator，停在 merge-ready，等用户合并。

**Merge.**

- [ ] Claude 在 head SHA 给出通过。
- [ ] 用户看过截图和视频。
- [ ] 用户合并，WorkBuddy 执行 0106 起的迁移并贴出输出。

## 做 AI 答案差距雷达（PR-6）

**Depends on.** PR-5。

**Files.**

- [ ] Create `packages/backend/src/admin/studio-ai-answers.ts` 及其测试。
- [ ] 需要新表时，在 `database/migrations/` 用新的文件名，每个文件一条语句。
- [ ] Edit `apps/web/app/routes/admin/studio-planning.tsx`，增加「AI 答案」页签。

**Build.**

- [ ] 运营每月上传固定问题集的 AI 回答（CSV，字段为平台、地区、语言、日期、问题、回答原文、引用链接），来源是 Semrush 导出或人工存档；不自动抓取任何 AI 平台。
- [ ] 程序提取引用链接，用 `site/editorial-ownership.ts` 判断是不是自有页面；用身份词典识别提到的品牌；不调用模型。
- [ ] 竞品被引用而我们没被引用时，生成「AI 引用缺口」卡；我们被引用时，记到对应页面；回答里同一型号的数值与已批准声明不一致时，生成「AI 说法不一致」卡。

**You see.**

- [ ] 一份合成的 10 题回答导入后，出现缺口卡、被引用记录和不一致卡，每张卡都能看到回答原文。
- [ ] 导入文件里有联系方式时整批被拒。

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] 测试覆盖：自有和竞品链接的判断；品牌识别；型号数值不一致；重复导入被拒；含联系方式被拒。Run `npm test` on Node 24.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `Playwright Chromium 1440 and 390` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. trunk 上没有这个页签，记录这一点；在 head 导入 10 题合成回答。Save `pr6-import.png`. Pass when 显示 10 条回答。
- [ ] Lane 2. 查看一条只引用竞品的回答。Save `pr6-gap.png`. Pass when 出现 AI 引用缺口卡。
- [ ] Lane 3. 查看一条引用尺寸指南的回答。Save `pr6-cited.png`. Pass when 尺寸指南页记有一次被引用。
- [ ] Lane 4. 查看一条型号数值与声明不一致的回答。Save `pr6-mismatch.png`. Pass when 出现 AI 说法不一致卡，并列出两边的数值和来源。
- [ ] Lane 5. 再次导入同一份文件。Save `pr6-duplicate.png`. Pass when 整批被拒。
- [ ] Lane 6. 导入含邮箱的文件。Save `pr6-pii.png`. Pass when 整批被拒并报告行号。
- [ ] Lane 7. 采纳一张缺口卡。Save `pr6-adopt.png`. Pass when 进入原有的采编任务。
- [ ] Lane 8. 查看名额。Save `pr6-capacity.png`. Pass when 新卡按优先级占用待处理名额，超出的可见。
- [ ] Lane 9. 在 390 宽度打开页签。Save `pr6-mobile.png`. Pass when 不溢出。
- [ ] Lane 10. 用户用一份真实的月度存档导入。Save `pr6-real.png`. Pass when 用户确认卡片内容与回答原文一致。

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. 导入并生成卡片的耗时。trunk 没有这个功能，用绝对预算。
- [ ] Probe. 用 1000 条合成回答导入 10 次。
- [ ] Baseline. 记录 head 在 10 条和 1000 条时的中位数。
- [ ] Rule. 1000 条超过 2 秒即失败。

**Review gate.** The operator reviews before merge.

- [ ] 把第 2、3、4、10 条线的 screenshot 复制到 `docs/assets/review/pr6-*.png`。
- [ ] 录一段 30 到 60 秒的 video，演示导入、查看三类卡、采纳一张。
- [ ] 把 screenshot 和 video 发给 operator，停在 merge-ready，等用户合并。

**Merge.**

- [ ] Claude 在 head SHA 给出通过。
- [ ] 用户看过截图和视频，并确认月度存档的来源和条款。
- [ ] 用户合并。

## Close the program

- [ ] 上面每个方框都已勾选，并有证据。
- [ ] 按 autopilot-stack 的格式给用户回执：每个 PR 的状态、用户可以做的事、未完成项和不能代签的事项（模型质量、SEO 与 GEO 效果）。

## Appendix A. Prototype evidence

以下证据由 Claude 在本会话实际运行得到，不是推测。

- 编辑门复现（main `12e3d92`）。「晶台称其 MiP 封装尺寸为 0.65 mm」触发 D1 BLOCK；「晶台光电称…」和「Kinglight 称…」不触发。Colorlight 信源下，英文 According to Colorlight 不触发，中文「卡莱特称…」触发。16 个 LED 信源中有 11 个没有 owner_entity_id。
- 版本卡复现（PR #10 `d465271`）。22 条真实版本条目首次导入生成 0 张 E 卡，之后新增无日期的 V9.8 生成 1 张。
- 问题地图（PR #8）。109 个关键词中只有 16 个英文；PR #10 改成双语后，133 条真实标题的命中从 33 条增至 56 条。
- Semrush 美国库（2026-10-17 快照）。齐普 AI 概览估算流量 68 中有 65 来自广告牌尺寸指南；租赁价格指南被 7 条 AI 问法引用，搜索流量只有 2；Linsn 的图片包占其估算流量 959。
- R1 实操（PR #11）。真实 Flash 调用一次，用时约 49 秒，37,417 个 token；返回 1 篇候选，被 16 处 D1 BLOCK 拦下；ViewSonic 获奖新闻因单词 damage 被挂到海运验货问题。
- 尚未证明。版本追踪页、活参考表和 AI 答案雷达能否带来流量或引用，要靠 R4 试产和 B4 守护页监测来回答。

## Appendix B. Alternatives rejected

- 每天写更多文章。审核产能每周 5 到 15 件，第一篇就被误拦；多写只会堆积待审稿。
- 堆 FAQ、H2 或结构化数据。Google 的说明与 PRD 都不把它们当作 AI 引用的条件。
- 按 Issue #12 全量实施双用途信源配置。目前没有规格书和 PCN 的采集入口，配置没有对象。PR-5 的声明库用更小的面积解决其中「供应链证据」的核心需求；Issue #12 建议收窄为每个信源一个用途字段，等资料来源真实运行后再做。
- 自动抓取 AI 平台的回答。违反平台条款，结果也不稳定；PR-6 只接受 Semrush 导出或人工存档。
- 先做下载中心并托管原厂文件。授权和篡改风险最高；PR-4 只链接官方地址，同样能抢占「最新版本」类搜索。
- 建通用知识图谱。与 AGENTS.md「只定义正在使用的抽象」相冲突；声明库只登记已批准稿件里的 evidence。

## Appendix C. Risks

- PR-1 简称名单写错会造成错误归属。名单必须由用户确认，并有无归属数值仍然 BLOCK 的测试。
- PR-2 可能被误用来绕过 BLOCK。BLOCK 只能修改，不能勾选，第 3 条线专门检查。
- PR-4 版本日期可能被误读为发布日期。原日期未知时必须写明，导出包含日期精度字段。
- PR-5 声明可能过时。原文改版时标为待复核，并给使用它的页面出卡。
- PR-6 存档来源可能有条款限制。由用户确认来源，不自动抓取。
- 范围膨胀。任何不在本计划方框里的功能，先写进回执的「建议」，由用户决定。

## Appendix D. Links and reading list

- `docs/aihot-readability-review-20261105.md`，问题 R1 至 R13 的证据。
- `docs/aihot-production-plan-20261104.md`，五个回合与停止条件。
- `docs/aihot-long-range-plan-20261103.md`，阶段 A 至 E 与门槛。
- `docs/aihot-grill-decisions-20261103.md`，D1 至 D18。
- pstack 镜像 https://github.com/backnotprop/pstack ，本计划采用其 multi-phase-plan 骨架与 autopilot-stack 执行方式。

## Appendix E. 发散清单与收敛理由

下表是 Claude 列出的全部方向，按 GEO 价值、已有证据、实现量和风险收敛。前三项进入本计划（PR-4、PR-5、PR-6），其余留待试产数据。

| 方向 | 为什么可能有用 | 证据 | 实现量 | 处理 |
|---|---|---|---|---|
| 控制软件版本追踪页 | 正面竞争控制软件；「最新版本」类问题需要持续更新的页面 | 版本源已接入，E 卡可用 | 小 | PR-4 |
| 声明库与活参考表 | AI 引用的是带条件的数字；同一数字全站一致，改版时一起更新 | 齐普被引用的都是参考页；稿件已有 evidence | 中 | PR-5 |
| AI 答案差距雷达 | 把 GEO 观察变成具体的内容动作 | 固定问题集已在计划中 | 中 | PR-6 |
| 每个问题一段标准答案 | 40 到 60 字的直接回答便于引用，全站口径一致 | 依赖声明库 | 小 | PR-5 之后 |
| 由参考表生成图解 | Linsn 三成估算流量来自图片包 | 程序可直接从表格画 SVG | 中 | 试产后 |
| 全站数字一致性检查 | 自有页面互相矛盾会削弱可信度 | 依赖 B1 页面登记 | 中 | R2 |
| 内部链接建议 | 新文批准时推荐与已有页面互链 | 依赖 B1 | 小 | R2 |
| 销售回复卡 | 询盘主要来自 Facebook 和 WhatsApp，同一答案可给销售复用 | 社媒派生已有同样的机制 | 小 | 试产后 |
| 西语、法语参考表 | 询盘大头在中非拉美和欧洲 | 用户尚未决定 | 小 | 用户决定 |
| 主体与技术汇总页 | 让「齐普讲解 MiP」这类关联更清楚 | 依赖声明库 | 中 | 试产后 |
