---
name: en-b2b-readability-gate
description: 英文 B2B（LED 显示屏/工业品）SEO 稿的可读性三层门检查。用于用户说「这句看不懂」「读者会卡在哪」「为什么这句读不通」时定位缺陷，或在英文稿交付前做系统性自查。句子级覆盖抽象名词起句、隐喻动词、行业黑话、省略式收尾、序数回指、形近术语并列、计量词描述可见现象、内容名词当物理施动者、伪区分、加法框架、部分否定对举、抽象并列主语、抽象比较句、无施动者的变化事件、未展开的复合术语、未点名施动者的被动义务句、实测行话黑名单、名词链/同位语堆叠、悬空指代、定义式起句、否定式模糊条件、模糊空间词当条件共 22 族判据，另加结构级的列表门与表格门（列表意图是否明确、条目结构是否对齐、条目回答者是否同一、表格列内是否同质、格内能否横向扫）与段落级的前提门（结论所依赖的前提是否已给出），附可复跑扫描脚本。
agent_created: true
---

# 英文 B2B 稿可读性三层门

## 何时用

- 用户（中文母语）指出英文稿某句「看不懂」「这句话又是什么」「为什么要说这个」
- 英文稿交付用户前自查（Chipshow 主站 / 美站 / 欧站，Unishine 英文稿同样适用）
- 用户连续多轮质疑可读性时——**这时不要逐句打补丁，直接上三层门**

## 三层门（顺序不可颠倒）

### 第一层：中文逻辑链（落笔前，人对人）

任何段落级改写，**先写 3–5 句中文逻辑链给用户确认，再落英文**。

这是唯一一次一轮通过修正的原因：C11-02 花了约十轮才改好，唯一一次一轮过的就是用户要求「先说明这一段的逻辑表述应该是什么样的」之后。

中文逻辑链要检查：
- 段落目的句是哪一句？（读者读完必须记住的那一句）
- 推进方向是**单向**（依据 → 结论）还是**锯齿形**（结论 → 依据 → 结论 → 依据）？锯齿形必改。
- 同一个论断在段内出现几次？**只允许一次。**
- 定义是否排在结论之前？
- 每段能否写出「读者读完会多做/少做哪一件事」？写不出 → 删段。

### 第二层：扫描门（脚本）

```
python <skill>/scripts/readability_gate.py <article.md>
```

只报候选，**必须逐条人工判真伪**（正常搭配会被误报）。脚本共 **21 族**句子级判据：下表列 A–N3；
O／P／Q 三条（行话黑名单、名词链堆叠、悬空指代）见文末「句式层与词层补判据」；
R1 为 2026-09-22 新增，L2／L3 为 2026-09-23 新增。

**脚本必须先修两处才能用（2026-09-22 已修，历史结论已全量复跑）**：

- **折行漏检**：原实现把每个物理行当段落。手工折行的稿子会被切成半句，句首判据（^ 锚定的 A／Q／R1）整片漏检——真句被换行劈开后，前半行不以该模式结尾、后半行首字母不在行首。实测同一段文本：折行版报 18 句／候选 0，单行版报 11 句／候选 1，而那一处正是真缺陷。现改为**连续正文行先合并成段再拆句**。
- **报数口径**：句数受折行方式影响（同文本 18 句 vs 11 句），**引门检数字必须同时说明输入文件的形状**，否则跨轮不可比；候选数与词数不受影响。

| 族 | 判据 | 示例 → 改法 |
|---|---|---|
| A | 抽象名词起句（名词化压缩） | `The effect is easy to miss` → `Washout is easy to miss` |
| B | 隐喻动词 | `tracks` / `follows the image` / `sits inside` / `carries ... through` / `comes down to` / `removes from` / `turns on` / `rests on` / `puts weight on` / `returns the target shape` → `vary with` / `depends on` / `is` / `gives` |
| C | 行业黑话未铺白话 | `raise the blacks` / `dark level` / `headroom` / `drive level` → 换成读者能看见的结果描述 |
| D | 省略式收尾（肯定否定都算） | `The amount of daylight reaching its surface has.` → `More sunlight is reaching the face.` |
| E | 序数 / 位次回指 | `the first unit / the second` / `the former` → 直述对象名 |
| F | 形近术语并列 | `luminance ... illuminance` 同句成对定义 → 术语归到它真正被使用的章节，铺垫段用白话 |
| G | 计量词描述可见现象 | `the same amount` / `amount of light` → 写「光从各处返回来」这类可见事实 |
| H | 内容名词当物理施动/受力者 | `light comes back from every part of the picture` → `Daylight reflects off the whole display face, including the areas that show dark content.` |
| I | 伪区分（A 与 B 都…） | `whether or not the pixels are lit` → 整体陈述 `the whole display face`。**注意与「包含关系」区分**：`including the areas that show dark content`（全体含某部分）可保留 |
| J | 加法 / 求和框架 | `adds to the image` / `sum of the two` → 走完物理链条：光从屏面反射 → 与屏幕发出的光一起到达观看位置 |
| L | **部分否定对举**（读者要自己在脑内反推另一半） | `returns the target shape at particular grid counts and not others` / `only at certain counts` → 拆成两句直述：`Some numbers of rows and columns give 16:9; most do not.` 或 `Some arrangements give 16:9. Most give a different shape.` |
| L2 | **否定式模糊条件**（用否定短语代替正面条件） | `where the surface is seen from a distance and nothing comes close to it` → 「谁靠近」「以什么为界」都没写，读者要自己反推「那近了会怎样」。改法：**该条件只写在真正需要它的那一条上，且正面写**（`can be reached` / `is within arm's reach`）；不需要就删，不必在另一条反向补一遍。**判据：句中出现 `nothing / no one / nobody + 动词` 且该句在界定适用条件 → 必查。** |
| L3 | **模糊空间／程度词当条件**（多远算远没写，读者判不了） | `where the display is read from across the room` → 「另一头」是多远、以什么为界都没写；原文本来给具体距离，改成这个反而是倒退。改法二选一：**写成读者能自己判的条件**（`visible at close range` / `is within arm's reach` / `the gaps disappear as the viewer moves back`），**或删掉这个从句**。**判据：`from across the room / from a distance / at a distance / well back / far enough` 出现在界定适用条件的从句里 → 必查；另外凡把原文具体数字改成模糊说法，一律回退。** |
| M1 | **抽象并列主语 + 产出动词**（谁对结果负责不清楚） | `the cabinet proportion and the opening do not produce a 16:9 screen` → 把两个抽象概念还原成两个**具体要求**，并点明它们由同一个变量承担：`The new screen has to keep a 16:9 image and fit the opening at the same time, and one grid count has to satisfy both.` |
| M2 | **抽象比较句**（比较维度与后果都没点明） | `That is easier to work with on a wall that has space around the screen than on one where the opening is tight.` → 直述两种现场分别怎么做：`An opening with space around it can be adjusted; a screen set into a finished surface has to match the dimensions already there.` |
| N1 | **变化事件无施动者**（`a change in X` 自己发生，读者不知谁改、为何改） | `A cabinet is built to a fixed size, so a change in the grid count changes both the proportions and the overall dimensions of the screen.` → 把**变化写成选择**，施动者即回来：`A cabinet is a standard part and its size is fixed, so fitting the opening means choosing how many cabinets go across and how many go down. Those two numbers set the shape of the image and the overall dimensions of the screen at the same time.`。**同时检查 `so` 是否悬空**——若结论推不出，中间缺的那一环要补上（此处缺的是「箱体不能裁切，所以只能改块数」） |
| N2 | **未展开的复合术语**（自造拼接词当已知词用） | `grid count` / `pitch count` / `cabinet proportion` 首次出现即当已知词 → 首处给白话释义或直接改用白话：`the number of cabinets across and down, the columns and the rows`。**判据：这个词是不是我们自己把两个普通词粘起来的？粘起来的就必须先解释。** 见下方「术语层」 |
| N3 | **被动义务句未点名施动者**（读者不知"这是谁做／谁答"） | `Seven questions have to be answered before the comparison can be made:` → 条目点名对方是谁，或按对象分组：`Seven items belong in the comparison, five from the suppliers and two from the site and the project file.`。**判据：句中出现 `has to be / must be + 过去分词` 而"谁"没出现 → 必查。** 若同一清单的条目分属不同对象，按对象分组（见 K4） |
| R1 | **定义式起句**（给读者已知的事物下定义，不推进行文） | `An LCD wall is built from panels, and the seam between two panels crosses any picture that spans them.` → 起句只是在定义「墙由面板拼成」，读者拿不到任何看得见的后果；改为**从现场可见现象起句**：`A wall built from panels shows a line wherever two panels meet.`。**判据：`An/The X is built from / made of Y` 作句首，且 X 是读者已知的物 → 必查该句推进了什么；答不出即改。** |

- **R1 的边界情形**（2026-09-23 立）：`An/The X is built from …` 起句**不必然**算缺陷——判据问的是「该句推进了什么」，
  若**同一句的后半段**就承担了推进，属模式命中的边界，不必改。作例（EU LCD 稿 S2 两处，复核后**保留原文**）：
  `An LCD video wall is built from panels arranged in a grid, and the grid sets the shape of the image on the wall.`
  （后半句 `the grid sets the shape` 即推进）；
  `An LED screen is assembled from cabinets, and a cabinet does not have to be 16:9 itself, so the cabinet proportion matters as well.`
  （后半句即推进）。
  **报告口径：判为边界而保留时必须写明「为什么这句不算」，不能只写「不算」**——否则下一轮复盘会被当漏改重新翻出来，
  或反过来被拿去改掉已定稿的段落结构。机器命中 ≠ 缺陷，这一族尤其要人工判。

### 段落级前提门（第三层之前，人工执行）

M1/M2 只是**句子级信号**。真正致命的一类缺陷脚本抓不到：**段落给出了结论或建议，但它依赖的那条关系从未写出来**。

判据（逐段执行）：把段里的结论句／建议句单独拿出来读，问一句 **「它凭什么成立？」**——

- 答案在段内、或紧邻上文出现过 → 合格
- 答案要读者自己补 → **缺前提**，必须补一句，而不是改措辞

2026-09-18 EU LCD 实例：原段直接跳到 `Sometimes the cabinet proportion and the opening do not produce a 16:9 screen`，
但它依赖的前提——**箱体尺寸固定，所以同一个网格数同时决定画面比例和整体尺寸，这两个要求可能无法同时满足**——
全段没有。读者不是看不懂词，是缺了那一步推理。补上前提后，后面「向供应商要排布图」这个动作才有了理由。

2026-09-23 EU LCD 实例（**属性直接跳用途，中间后果未写**）：COB 段原文
`Chip-on-Board encapsulation seals the LED chips under an epoxy layer, producing a hardened surface with a matte finish. Boardrooms, broadcast studios, and premium retail where viewers stand within 2 metres.` ——
从「表面硬化＋哑光」直接跳到场所清单，中间那一步（**这对使用者意味着什么**）没有句子承担：
硬化 → 偶发触碰不会伤到它；哑光 → 少反射室内灯光（演播室灯、会议室顶灯、零售照明）。
读者要自己从材质推出用途。补后：`That finish stands up to occasional contact and reflects less of the room lighting.`
**判据：段内前半是材质／工艺，后半直接列适用场所 → 问一句「所以呢？」；答不出即缺中间后果。**

2026-09-23 EU LCD 实例（**并置两段推理链不同深**）：同节的 COB 段是「构造 → 后果 → 后果的意义 → 场景」，
SMD 段却只有「构造 ＋ 场所清单」——两段回答同一问题，读者对深的那段满意，对浅的那段会问「所以呢」。
**判据：凡有两段／两节并置回答同一问题（A 型 vs B 型、两种做法、两条路线），逐段数推理链的环数；
环数不等即为缺环，按深的那段补齐中间那句。**

**K 组是结构级的，不走句子正则**（脚本末尾单独一块输出）：扫描每个 bullet 列表，报出「是否有引导句」和「每条条目多少词」。

| 族 | 判据 | 判断标准 |
|---|---|---|
| K1 | **列表意图不明** | 标题只给出话题（`Logos and Fine Detail`），读者读完前两条仍判断不出这一列是「要避免的 / 要做的 / 要检查的」→ 必须加引导句。**标题本身完成引导的可不加**：`What Changes the Reflected Component`、`What the Site Determines`、`Two Ways to Control Night Output` 属此类——标题即问题或分类框架，bullet 就是答案。 |
| K2 | **条目结构不齐** | 同一列表里有的条目带原因、有的不带（原来 Logos 节第一条带 `which need...` 从句、第三条只有一个名词短语，直接裸奔）→ 统一成「**条目名.** 原因」或统一成纯条目，不能混。 |
| K3 | **列表内序数回指** | `addresses the first` / `the second also depends on...` → 直说对象名（`addresses the luminance limit` / `the illuminance limit also depends on...`），不要让读者回翻数位次。 |
| K4 | **条目回答者不同一**（同一列表里条目分属不同对象，无分组） | `Seven questions have to be answered:` 下面混着「问供应商的」（价格、备件、功耗）与「自己现场查或查项目文件的」（开孔是否要改、招标要哪些声明）→ 按对象分组，组头点明对方：`**From the suppliers**` / `**From the site and the project file**`。**判据：逐条问一句「这条谁来答？」——出现两个以上答案且未分组即不合格。** 分组后引导句可带数量（`five from the suppliers and two from the site`），读者一眼知道要跑几处 |

**已确认的误报（人工判真伪时的快速排除表）**：

| 族 | 误报形态 | 实例 | 为什么不是缺陷 |
|---|---|---|---|
| D | 句末是**完整关系从句**而非省略 | `…changes the margin the site actually has.` | 关系代词后的 `has` 是谓语，不是被省略的助动词 |
| D | 句末是**间接疑问句** | `Ask the supplier what the lowest usable output level is.` | `what … is` 是完整从句结构 |
| B | 常规搭配的 `follow` | `follows from` / `follows a time profile` / `follows the light measured at the face` | 有标准搭配含义（见分界判据） |
| B | 物理动作的 `fall` / `land` / `move` | `light falls on a surface` / `low sun lands on the face` / `shade moves with the season` | 实义动词 |
| B | 排版术语 | `Uppercase text carries more visual weight` | 行业内标准用法 |
| A | 紧邻上一句的短回指 | `The number` 紧接 `a published contrast ratio` | 回指距离 1 句内可接受；**仍建议改成对象名**（`A ratio measured under the same conditions`） |
| K1 | 标题即引导的列表 | `What Changes the Reflected Component` / `What the Site Determines` / `Two Ways to Control Night Output` | 标题本身就是问题或分类框架，bullet 就是答案。判据是「读者读完前两条能否判断这一列是什么」，能则不加。 |

**判真伪的分界判据**：这个动词/名词**在此处有没有常规搭配含义**？有 → 保留；没有（`follow the image`、`comes back from the picture`）→ 病句。

### 第三层：读者门

对每一段写出一句话：**读者读完会多做 / 少做哪一件事？**

- 写不出来 → 整段删（通常是「为了严谨」的教科书层）
- 只能写出一件事 → 只留这一件，其余是框架

C11-02 实例：`cd/m² vs lux` 那段（79 词，B 层标准光度学定义）唯一存活载荷是「规格表的数字不能回答场地的问题」，其余全是框架，砍到 61 词。

## 改完必做

1. **改一句要回读前一后两段**——回指链会随前句措辞一起失效（`that addition`、`that reflected light`、`the two figures` 都必须同步重写）。
2. **同一表述框架全文搜索分布**（正文 + FAQ + TL;DR + Conclusion），并同步 `schema.json` 与 `cms-fields.json`。
3. **跑三件套一致性校验**（FAQ 与 Schema 逐字一致、H1=headline、字数同步）。C11-02 曾因 FAQ 漏改被校验抓出。

## 硬纪律

- **不许说「读不懂是正常的」「读者理解成本高」「这是文体特征」**——出现「读者须回翻上文才能确定主语/宾语」即为写作缺陷。先认错直接改。
- **不留「可保留」中间态**：语法可补全 ≠ 读者不用补。
- **用户说看不懂时，先判断卡点在哪一层**——四层，别混：
  1. **词层**：某个词不常见 → 换词即可
  2. **句式层**（名词化主语 / 判断前置 / 从句堆叠 / 部分否定对举）→ 必须成批重写
  3. **前提层**：段落缺了一句推理，结论悬空 → **改措辞无解，必须补前提**。
     判据：用户说「没看懂」但你复读每句话都通顺 → 九成是这一层。
     2026-09-18 EU LCD 段连续两次被指「没看懂」都属此层，前一次（`Sometimes the cabinet proportion…`）
     甚至被扫描门判为 0 候选
  4. **术语层**：把两个普通词粘成复合术语（`grid count`），首次出现即当已知词用。
     **这不是措辞问题**——再换多少动词都救不了，必须就地给白话释义，或干脆全程用白话。
     同类信号：该术语要靠「前面某段说过」才能懂，而前面那段并没有说 → 一律按未定义处理。
     2026-09-18 EU LCD 第三次「没看懂」（`a change in the grid count`）即术语层 + 无施动者叠加
- **脚本能力边界**：`readability_gate.py` 只覆盖词层、句式层与术语层的**信号**（A–N 各族）。
  **前提层缺陷它抓不到**——脚本 0 候选不等于段落可读。交付前必须人工过一遍「段落级前提门」。
- **别逐句打补丁**：逐句改只会修 A 造出 B，且用户每问一句改一句，改到第 N 句用户就失去耐心。**成批处理，一次交一节清单供圈定。**
- **动笔前先写读者模型一句话**（读者是谁 + 手上拿着什么 + 要做什么决定）。用提高语域冒充信息密度是通病。

## 句式层与词层补判据（实测卡壳清单）

> 来源：2026-09-08 用户点名「现在就改，作为硬检查项」+ 2026-09-21 精简用户级记忆时归位。
> 这四条原先只写在记忆文件里，技能缺位——用户圈出来的句子会再次躲过扫描。

### 1. 同位语 / 名词链超一层必须拆句

- 禁止 `, the class of…`（逗号后同位语再套一层 of 短语）、`X, which makes Y, and it argues Z`（一句套两层从句）。
- 检查到即拆成独立短句。**判据：一个句子里读者要同时持有两个以上未闭合的名词短语，就是超一层。**
- 血泪教训：MAIN-011 三处此类句式接连被用户点名「看不懂」。

### 2. 悬空指代必须写实

- `the question` / `the issue` / `it` / `any` 等指代，必须能在**前一句**找到具体名词；找不到就写实。
- 反例：`The question is whether…` 而前句从未提出任何问题 → 改成把那个问题直接写出来。

### 3. 成本机制段落先给公式句

- 先讲「钱怎么算」，再讲什么变量动它。例：`人工费 = 人数 × 天数 × 日薪`，然后才说哪个变量被场景改变。
- **抽象名词接力是第一杀手**：`the mechanism runs in a chain` / `converts into X` 这类写法，读者拿不到可算的东西。

### 4. 行话黑名单（用户实际卡壳过的词，不得直用）

| 禁用词 | 替换 |
|---|---|
| `driver` | 成本语境有司机歧义 → 指明具体项（如 `labour cost`） |
| `swap slot` | 到现场换的那块屏 → `spare panel` / 说明动作 |
| `headline set` | 主屏那一组 → 直接说屏的尺寸或数量 |
| `standby hours` | 待机时长 → `hours in standby` 或写明计量口径 |
| `playbook` | 做法/清单 → `procedure` / `checklist` |
| `critical path` | 卡住工期的那一步 → 直接写是哪一步 |
| `recoverable failure space` | 需白话展开 → 写明「坏了能多快换回来」 |

- 通用替代表达：`recurring costs`、`cost items` 等直白词。
- 交稿前机械扫描一次：禁用词（not / no / without / never / every / 绝对化词）+ 上述结构模式 + 本表行话词。第二人称按下方「内容层判据」第 1 条人工检查，不因出现 you / your 本身判错。

### 5. 同物换名与「否定对比」的对象必须同段给出

同一段里指同一个东西必须用同一个词。**换了名就等于换了对象**，读者会以为在讲两件事。

- 例（2026-09-22 EU LCD 第二部分段 2）：前句说 `the seam between two panels`，次句改成 `The grid`，
  中间缺的那一环（**拼缝落在画面上就是一条线**）没写 → 读者不知道 grid 从哪来。
- **否定式对比句，被否定的那个对象必须在同段出现**：`does not change with use or with calibration`
  要对比的是「亮度会漂移」，而亮度在**下一段**才出现 → 前提缺席，读者只能猜。
  判据：句中带 `not / does not / never` 时，问「它否的是什么」——答案不在同段即缺前提。

## 内容层判据（2026-09-23 由项目记忆归位；写作时逐条过）

> 这一组与「句子读不读得懂」无关，管的是**断言是否有来源、结构是否自洽、谁有权定**。
> 脚本不覆盖、读者门也覆盖不了，但违反后的代价和可读性缺陷同级（用户能核对数字，核不了机制）。
> 原先只写在项目记忆里，记忆文件超限后归位到本技能。

**词与断言**

1. 允许自然的第二人称，但不借第二人称预设需求、混淆责任或作无依据承诺。禁具体地名、无来源数字（直接删）、自造复合术语；H2 简短；末尾 Conclusion + CTA
2. **论证起点＝既有装置／现场的可测属性**，不从自家产品规格起手；示例数值须能自证必要性（优先比例/公式）
3. 把某比例／标准当「目标」写进正文，须交代它从哪来（内容标准／现场测量），不能只写「规格如此」——
   否则读者会以为那是厂商的选择
4. 「多数／经常／通常」落成适用条件（可判定门槛，如 `where a standard surface is enough`）；
   `most／usually／typically` 不进正文
5. **同族＝「方向断言」**：价格／优劣的**高低方向**无来源也删，不只删频率词。作例：
   `The purchase price … is usually higher than …` → `The two purchase prices differ.` ＋ 条件句
6. 适用条件不用模糊空间词／否定短语（`across the room`／`from a distance`／`nothing comes close to it`），
   须让读者能自判（看得见/够得到）；**改法＝换成写实位置并分性质**；原文用具体距离时不得改得更模糊
7. **施工参数**（锚栓间距／开孔尺寸／安装总深）不是产品规格，由墙体材料与结构计算决定 → 指向来源
   （所选框体安装图 ＋ 与实测结构核对），不给死值
8. **软件兼容性声明**与刷新率／噪音同族，禁（CMS 免改、播放器视作单显示器、4K 充分利用原生分辨率）；
   可写的只有**信号链位置**（源 → 视频处理器 → 像素画布，映射在调试时设定）
9. 对第三方技术的负面断言与自家声明**同一标准**：查不到来源就删，或改写为产品类别固有属性
   （面板拼缝、面板为最小可更换单元）＋ 现场可测条件（亮度与环境光的关系）
10. **自报的数值约束须实算后再写**（「均 ≤155 字符」「共 N 条」「占比 X%」）；
    **引用他人（含自己上轮）文本一律回源核**——凭笔记转抄会错介词、错词
11. **TD 层不得把正文已删的错误写回来**：数字、认证定语、术语不得在 Title/Meta 复原；定稿 TD 只写正文已兑现内容

**推理与结构**

12. **原文没有因果句处不得补因果**——要补先问「这个缺口是不是我自己造的」，若是则撤议题而非换措辞；
    核查推翻某前提时，**承载该前提的总起句／主题句也要删**（否则段落形式上还在讲那件事，实质已空）
13. 删掉某段全部论据后，回头问「这段还成立吗」
14. **对照段不必对称**：比较轴由引导句定、两段合起来才成立；相对选择（A 多给了什么）要写理由，
    **基线项不需自证**——硬补只能编出议题
15. **不得把「这段不够差异化」当缺陷**：区域信号由少数载体承担，非每段必达；拿它量薄节是用错标尺
16. **章节组织轴须与 H2 承诺一致**；H2 分两类——承载内容信息的（泛论设问／空泛描述 → 改写成段落真实
    可测内容）与只标示章节功能的（`Frequently Asked Questions`／`Conclusion` → **一律保留**）。
    判别式＝「是否承载内容信息」，不是「是否与其他站相同」——同构只是发现问题的入口
17. **标题的地域承诺须由本节正文兑现**：先看节内有无兑现物，再定标题写不写地域，不是先占标题
18. 属性／材质句须说清「这对使用者意味着什么」才能跳场所清单；中间那步不得省略
19. 表格／清单：每格短、同类型、可横扫；**一列混两类即该列不成立**（换表头无解，须重构）；
    条目分属不同回答者须**按对象分组并点名**；被动义务句须点名施动者
20. **FAQ 与正文分工**：FAQ 只给判据口径，展开留在正文节（门检不抓跨节重复，只能自己比）
21. **同一数字／断言跨节重复**：前面的节处理过 ≠ 后面的节已清 → 删一个表述后须全文检索其他出现处
22. **删掉支撑答案的数据后，回看问法本身是否还成立**（判别式＝问法承诺了什么）；属**内容决策** → 给候选不代定

**来源·授权·流程**

23. 区域差异在**「项目条件层」，不在「应用行业层」**（可用：审批程序／既有建筑本体约束／本地交付与核算方式）；
    拿行业（银行/零售/交通）当区域信号是假的；「翻新驱动」型宏观统计桥搭不出来就不写
24. **「对象错配」型统计**：先问统计单位（谁的产品／哪个市场），再问结论要的施动者是否同一个；不同即推断
25. **内容决策权归用户**（表结构／年限口径／H2 措辞／章节取舍／承诺强弱）→ 未授权不得代定、不得写成既成事实；
    「我问了但用户没答」**不构成授权** → 停住问实物对比。技术性执行（算数／来源核查／可读性改写）可自主
26. 交付前必跑门检脚本；**报句数必须连输入形状一起报**（同文本折行 18 句 vs 单行 11 句）
27. **列表块与 H2 互斥（脚本 K 组）**：脚本判 `bare = lead.startswith("#")`，bullet 块上一行若是标题即报
    `lead_in MISSING`。过检只有两条路：① **不做 H2**，用非 `#` 的独立标记行起头（如 `**TL;DR**`，实测判 ok）；
    ② 做 H2，但标题与 bullet 之间必须补一句引导句。
28. TL;DR 独立摘要模块：H1 下方、正文 Introduction 之前，50-100 words 核心结论，独立小模块，
    不是正文第一段的一部分。结构：H1 → TL;DR → Introduction → 正文。
29. **导语首句不得是否定式命题**：`X is replaced on A, not on B.` 这类只否定一项、不说「那看什么」的开篇，
    读者读完手上没有落点（2026-09-23 EU LCD 导语首版即因此整段作废）。开篇要么给依据、要么给范围承诺。
    修法：把「看什么」写实（`decided by measurements taken on site`），必要时补一句本文覆盖什么。

## 脚本不覆盖的（必须人工比，别当成「门检过了就没事」）

- **跨节逐字 / 近似重复**：脚本只看单份输入，不做节与节、站与站的比对。**复述型段落最容易踩**
  （2026-09-23 EU LCD 结论段 B090 初稿 `Request the EU Declaration of Conformity for the display
  and the EMC test report before the order.` 与第五部分 B031 的索取句逐字近似，脚本候选 0）。
  做法：改「结论 / 摘要 / FAQ 答」这类复述段落前，把被复述的那几节定稿文本摆在一起比一次。
- **与已定稿节的口径冲突**：脚本判不了对错，只判读不懂。作例：结论段写「4:3 箱体比例直接映射
  16:9」，而 S2 定式是 `screen proportion = cabinet proportion × (columns ÷ rows)`——两者矛盾，
  脚本无感。
- **无来源数字与断言**：脚本不查来源（`bezel fatigue`、`between years three and five`、
  `near-zero`、最高级 `the most durable…` 全都要人工判）。
- **跨节重复的删除决策**：同一数字在原文出现两次，前一节已删、后一节仍留（2026-09-23 第五部分
  `75 to 90 mm`：S1 阶段已判删，步骤节漏了）。脚本无感，靠通读比对。
- **TD 层（Title / Meta）的长度上限**：脚本不核算字符数。Meta 建议 ≤155 字符、Title 常见显示
  宽度约 60 字符，**只有实际数一遍才知道超没超**。特别注意：在候选表里自报「均 ≤N 字符」是
  高风险动作——2026-09-23 EU LCD 稿写「Meta 均 ≤155 字符」，实测乙 159、丙 161（两条均超），
  用户恰好选中超限那条。做法：候选一生成就跑一次 `len()`，把实测数字写进候选表，别凭感觉写。

## 脚本位置

`scripts/readability_gate.py`（复制自 C11-02 十轮修正中积累的判据；输出候选句 + 行号 + 字数，末尾附 K 列表门报告）

## 已验证案例

- **C11-02 `SPOKE-USA-C11-02`（2026-09-16）**：十一轮用户质疑，逐条沉淀出 A–K 全部判据。收尾状态：句子级候选 1 处（D 组误报），裸列表 3 处（均为 K1 误报）。**「某词到底是什么」的连续质疑（viewer → amount → light from the dark areas → picture → the problem / the same face）全部属 H 族**：抽象名词被放进物理过程句当施动者。
- **EU `/blogs-news/lcd-to-led-video-wall-retrofit/`（2026-09-18）**：用户连续两轮质疑英文句意。被判缺陷：`one check rather than confirmation of fit`（抽象对举，且与前段"比例在四项之后"逻辑位置矛盾）→ 拆成「确认了什么／没有确认什么」两句；`turns on two variables`（B 组）→ `Two things decide…`；`returns the target shape at particular grid counts and not others`（B+L 组）→ `Some numbers of rows and columns give 16:9; most do not.`。**教训：逐句打补丁会漏同类句**——同一节的 `returns 16:9 at some grid counts and not at others` 是同一个毛病，却因只改被圈那句而漏掉，直到跑扫描脚本才抓出。本题新增 L 族与 B 组新词即由此而来。
- **EU 同上（2026-09-18 第二轮，前提层首次立案）**：用户指出 `Sometimes the cabinet proportion and the opening do not produce a 16:9 screen… That is easier to work with on a wall that has space around the screen than on one where the opening is tight.` 整段看不懂。**扫描门当时报 0 候选**——判据缺 M 族。人工拆解得到两层缺陷：
  ① **句子级**：两个抽象概念并列作主语共同"产出"结果（谁负责不清楚）＋ 抽象比较句（比什么、后果是什么都没说）；
  ② **段落级（主因）**：整段缺了一句前提——「箱体尺寸固定，同一个网格数同时决定画面比例和整体尺寸，这两个要求可能无法同时满足」，
     导致后面「向供应商索取排布图」这个动作没有理由。
  **本次新增 M1／M2 两条正则 + 段落级前提门；验证：新版脚本在旧稿精准命中这两句（2/2），在重写稿 0 命中。**
  教训升级：用户说「没看懂」而已方复读每句都觉得通顺时，**先查前提，不要改词**。
- **EU 同上（2026-09-18 第三轮，术语层首次立案）**：用户指出 `A cabinet is built to a fixed size, so a change in the grid count changes both the proportions and the overall dimensions of the screen.` 句首读不懂——「先说了 cabinet，然后又说 a change in the grid 是啥」。**扫描门当时同样报 0 候选**（判据缺 N 族）。拆解得到三个叠加缺陷：
  ① **术语层**：`grid count` 是自造拼接词，全篇未用白话解释过，第 3 段起即当已知词用（共出现 5 次）；
  ② **无施动者**：`a change in the grid count` 里没人做这件事，读者答不出「谁改、为什么改」；
  ③ **`so` 悬空**：箱体尺寸固定推不出"改块数会改变比例和尺寸"，中间缺的那一环（箱体不能裁切 → 只能改块数）没写。
  改法：**变化 → 选择**（`fitting the opening means choosing how many cabinets go across and how many go down`），施动者回来、`so` 的中间环补上、`change … changes` 的重复自然消失。
  **本次新增 N1／N2 两条正则**；验证：新版脚本在旧稿命中 6 处（N1×1 恰为用户圈的那句、N2×5 即全部 `grid count`），在重写稿 0 命中。
  教训：**自造复合术语必须首处释义，或全程用白话**——它比生僻词更难发现，因为它读起来像专业术语。
- **EU `/blogs-news/lcd-to-led-video-wall-retrofit/` TCO 章（2026-09-22，表格门首次立案）**：用户连续三轮判定表格无效——「就是把文字放在表格里而已」→「`What it is measured over` 是啥意思」→「这里用 unit 也很奇怪」。**三轮都不是句子问题，是表格设计问题**，句子级扫描门全程 0 候选。两个独立缺陷：
  ① **格内不回填**：每格一整句，横向扫不动 → 表格退化成换行的段落。判据：同一列的格应能用同一句法/同一长度级横着比。
  ② **列内不同质（主因）**：一列里混了三类东西——计量单位（`kWh per year`、`Hours per intervention`）、取值条件（`the same building conditions for both offers`）、交付物数量（`Documents required by the file or tender`）→ **任何单列表头都概括不了这件事，换列名无解**（`What it is measured over` → `Unit` 两次改名都没救）。改列名是徒劳的，必须改列的结构。
  改法：取消该列，计量方式降级为费用项一格的后缀（`Initial installation, per project`），只留两个同质列（`Cost item` ｜ `Where the figure comes from`）；「取值条件」移回表前正文句，不在格内重复。
  **新增判据（表格门）**：一列里的每格必须是同一类东西，且能被同一个表头概括；做不到就拆列或降级为后缀，**不要给这列起更抽象的名字**。
  教训：**用户说"读不懂"时，先确认缺的是句子还是结构**——表格/列表被判定无效时，改字毫无用处。
- **EU 同上 第二部分段 2（2026-09-22，R1 族与折行漏检同时立案）**：用户指
  `An LCD wall is built from panels, and the seam between two panels crosses any picture that spans them. The grid is part of every image and does not change with use or with calibration.`
  「这句话我就没看懂」。四层缺陷叠加：① **定义式起句**（`An LCD wall is built from panels` 不推进任何事）；
  ② **`them` 指代不清**；③ **同物换名**（seam → `The grid`，中间缺「拼缝落在画面上就是一条线」）；
  ④ **否定对比的对象在下一段**（`does not change with use or with calibration` 要对比亮度漂移，而亮度在后面才出现）。
  改法：从墙上**可见的线**起句 → 说明为何（面板是各自独立、自带边缘）→ 结果（覆盖到该处的画面里线都在原处）→ 性质（构造使然，设置去不掉）。
  **本次新增 R1 正则 + 补判据 5；并查出扫描脚本的折行漏检（见第二层）。**
  验证：修好的脚本**在旧稿命中 R1×1 + A×1**（A 那一处同段 `That figure sets the level…` 也是真缺陷，已一并改掉），**在新稿 2 处全清**，其余 10 份历史输入零误报。
  **附带教训：报告门检结果时，句数与输入文件的折行方式绑定（同文本折行 18 句 vs 单行 11 句），跨轮比较会像"口径不一致"，必须连输入形状一起说明。**
