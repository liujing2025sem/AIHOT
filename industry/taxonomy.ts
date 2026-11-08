// 这个行业的分类体系：类别、标签词表、公司（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉结构抽取模型这一类收什么、
 * 和相邻类别的边界在哪（总的归类原则写在 prompts/structure.md 里）。
 * commentary 标出评论类（教程、观点）：日报写过的事又有评论类的后续报道，只占一行快讯（报道它的信源够多时除外）。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 * tagColor 是飞书推送卡片里跟在标题后面的这一类小标签的颜色（飞书 text_tag 的颜色名）。
 * feedLabel 是分类 RSS 标题里的名字（不写就用 label）。公开接口、RSS 和 MCP 里要把一类并进另一类发布，写在站点设置里（site/site.ts 的 PUBLIC_CATEGORIES）。
 */
export const CATEGORIES = [
  { key: "components-ics", tagColor: "indigo", label: "Components & ICs", section: "Components & ICs", guide: "以 LED 芯片、封装（SMD、COB、MiP 等）、驱动 IC、电源、材料、制造工艺与器件可靠性为主。整屏采用某器件但重点在整屏或部署时，归 Displays & Projects。" },
  { key: "control-software", tagColor: "turquoise", label: "Control & Software", section: "Control & Software", guide: "以发送和接收卡、视频处理器、显示控制系统、校准软件、固件和互操作为主。若重点是具体场地部署或整屏应用，归 Displays & Projects。" },
  { key: "displays-projects", tagColor: "violet", label: "Displays & Projects", section: "Displays & Projects", guide: "专业整屏、箱体、商显、体育场馆、虚拟制作或交通等项目，以及安装和交付。某块广告屏的实际安装归本节；广告网络经营、投放规则和市场规模归 Market & DOOH。" },
  { key: "industry", tagColor: "orange", label: "Market & DOOH", section: "Market & DOOH", guide: "行业经营、财报、并购、供需、政策、展会与数字户外广告（DOOH）媒体运营、交易和测量。展会上有明确新品或项目时，按本条报道的实际对象归类。" },
  { key: "consumer-near-eye", tagColor: "green", label: "Consumer & Near-eye", section: "Consumer & Near-eye", guide: "以电视、显示器、笔记本、穿戴设备等消费级显示，以及 AR/VR、近眼显示和相关实测为主。仅介绍可用于消费显示的上游器件或工艺，且未以消费设备或近眼应用为重点时，归 Components & ICs。" },
] as const satisfies ReadonlyArray<{ key: string; tagColor: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

/**
 * 这个行业最受关注的一类发布（AI 行业是新模型）：日报报头的“N 个新模型”、改分类后修订已出的报告都按它数。
 * category 是类别，tag 是标签，两者都对上才算；unit 接在数字后面。
 * 没有这样一类的行业设成 null，报头就不显示这个数。
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = null;

/** 周报月报的总述可以直接写、不必在报道里找到出处的行业通用词（小写）。站名会自动算进去。 */
export const PLAIN_TERMS: readonly string[] = ["led", "ic", "smd", "dip", "cob", "mip", "pwm", "hdr", "vms", "dooh", "ar", "vr", "api", "ceo", "ipo"];

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 */
export const ITEM_TYPES = ["model_release", "product_launch", "tool_or_prompt", "research_paper", "industry_event", "opinion_analysis", "tutorial_explainer"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "产品更新", "模型发布", "论文/研究", "开源/仓库", "教程/实践", "现象/趋势", "大佬观点", "评测/基准", "安全/对齐", "行业动态", "政策/监管",
  "非AI/通用工具", "其他",
] as const;

/** 可选的主题标签。 */
export const TOPIC_TAGS = [
  "LED控制系统", "LED封装", "LED驱动IC", "LED电源", "户外LED显示", "LED采购选型", "LED项目案例", "LED安装维护", "DOOH", "consumer-display", "近眼显示",
  "Agent", "编码", "推理", "多模态", "语音", "视频", "图像生成", "RAG", "端侧", "数据/训练", "搜索", "部署/工程", "开源生态", "具身智能", "MCP/工具调用",
] as const;

/** 可选的实体标签（公司、机构、平台）。 */
export const ENTITY_TAGS = ["OpenAI", "Anthropic", "DeepSeek", "DeepMind", "Google", "Meta", "Microsoft", "xAI", "Hugging Face", "GitHub", "arXiv"] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  "教程/玩法": "教程/实践", "技巧/最佳实践": "教程/实践", "合作/生态": "行业动态", "融资/收购": "行业动态", "公司动态": "行业动态",
  合作: "行业动态", 生态: "行业动态", 融资: "行业动态", 收购: "行业动态", 投资: "行业动态", 并购: "行业动态",
  政策: "政策/监管", 监管: "政策/监管", 法规: "政策/监管", 安全: "安全/对齐", 对齐: "安全/对齐",
  论文: "论文/研究", 研究: "论文/研究", paper: "论文/研究", papers: "论文/研究",
  "open-source": "开源/仓库", 开源: "开源/仓库", 仓库: "开源/仓库", repo: "开源/仓库",
  教程: "教程/实践", 玩法: "教程/实践", 指南: "教程/实践", 技巧: "教程/实践", 最佳实践: "教程/实践", 实践: "教程/实践",
  产品: "产品更新", 更新: "产品更新", 发布: "模型发布", 模型: "模型发布", 趋势: "现象/趋势", 现象: "现象/趋势", 观点: "大佬观点",
  视频生成: "视频", 非ai: "非AI/通用工具", "non-ai": "非AI/通用工具", 通用工具: "非AI/通用工具", 工程工具: "非AI/通用工具",
  安全扫描: "非AI/通用工具", devops: "非AI/通用工具", 行业: "行业动态", 动态: "行业动态",
};

// ── 公司与主体 ──────────────────────────────────────────────────────────────────────────

/**
 * 主体主题（公司、机构、媒体）：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。
 * aliases 给结构抽取模型看；orgNames 是这家公司发消息时开头用的组织名（公司、实验室、团队），
 * 在它自己的主题页上读者知道说的是谁，可以省去；otherNames 是公司的其他称呼（官方账号名、子品牌）。
 * 所有这些名字都用来认出说的是哪家公司，比如把事实的主体对到发布方。
 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; orgNames?: string[]; otherNames?: string[] }> = {
  chipshow: { name: "Chipshow / 齐普", displayTag: null, aliases: ["Chipshow", "齐普光电", "齐普"], orgNames: ["Chipshow", "齐普光电", "齐普"] },
  novastar: { name: "NovaStar / 诺瓦星云", displayTag: null, aliases: ["NovaStar", "诺瓦星云", "诺瓦"], orgNames: ["NovaStar", "诺瓦星云", "诺瓦"] },
  nationstar: { name: "Nationstar / 国星光电", displayTag: null, aliases: ["Nationstar", "国星光电", "国星"], orgNames: ["Nationstar", "国星光电", "国星"] },
  kinglight: { name: "Kinglight / 晶台光电", displayTag: null, aliases: ["Kinglight", "晶台光电", "晶台"], orgNames: ["Kinglight", "晶台光电", "晶台"] },
  macroblock: { name: "Macroblock / 聚积科技", displayTag: null, aliases: ["Macroblock", "聚积科技", "聚積科技"], orgNames: ["Macroblock", "聚积科技", "聚積科技"] },
  meanwell: { name: "MEAN WELL / 明纬", displayTag: null, aliases: ["MEAN WELL", "MEANWELL", "明纬", "明緯"], orgNames: ["MEAN WELL", "明纬", "明緯"] },
  colorlight: { name: "Colorlight / 卡莱特", displayTag: null, aliases: ["Colorlight", "卡莱特"], orgNames: ["Colorlight", "卡莱特"] },
  chipone: { name: "Chipone / 集创北方", displayTag: null, aliases: ["Chipone", "集创北方"], orgNames: ["Chipone", "集创北方"] },
  czcl: { name: "CZCL / 创联", displayTag: null, aliases: ["CZCL", "创联"], orgNames: ["CZCL", "创联"] },
  "g-energy": { name: "G-energy / 巨能伟业", displayTag: null, aliases: ["G-energy", "巨能伟业"], orgNames: ["G-energy", "巨能伟业"] },
  huidu: { name: "Huidu / 灰度科技", displayTag: null, aliases: ["Huidu", "灰度科技"], orgNames: ["Huidu", "灰度科技"] },
  oaaa: { name: "OAAA / 户外广告协会", displayTag: null, aliases: ["OAAA"], orgNames: ["OAAA"] },
  ledinside: { name: "LEDinside / 行业媒体", displayTag: null, aliases: ["LEDinside"], orgNames: ["LEDinside"] },
  daktronics: { name: "Daktronics / 达科", displayTag: null, aliases: ["Daktronics", "达科电子"], orgNames: ["Daktronics", "达科电子"] },
  "world-labs": { name: "World Labs", displayTag: null, aliases: ["World Labs"] },
  "thinking-machines": { name: "Thinking Machines Lab", displayTag: null, aliases: ["Thinking Machines"] },
  amd: { name: "AMD", displayTag: null, aliases: ["AMD", "Advanced Micro Devices"] },
  openai: { name: "OpenAI", displayTag: "OpenAI", aliases: ["OpenAI", "ChatGPT", "Sora", "Codex", "GPT"], orgNames: ["OpenAI"], otherNames: ["OpenAI Developers"] },
  anthropic: { name: "Anthropic", displayTag: "Anthropic", aliases: ["Anthropic", "Claude"], orgNames: ["Anthropic"], otherNames: ["Claude Code"] },
  google: { name: "Google", displayTag: "Google", aliases: ["Google", "DeepMind", "Gemini", "谷歌"], orgNames: ["Google DeepMind", "Google Research", "Google", "DeepMind", "谷歌"], otherNames: ["Google AI", "Google Labs", "Google Cloud"] },
  deepseek: { name: "DeepSeek", displayTag: "DeepSeek", aliases: ["DeepSeek", "深度求索"], orgNames: ["DeepSeek", "深度求索"] },
  qwen: { name: "千问 Qwen", displayTag: null, aliases: ["Qwen", "通义", "阿里"], orgNames: ["通义千问", "通义实验室", "阿里巴巴", "阿里云", "阿里", "Qwen Team", "Qwen", "Alibaba"], otherNames: ["千问", "千问APP", "Alibaba Cloud"] },
  kimi: { name: "Kimi / 月之暗面", displayTag: null, aliases: ["Kimi", "月之暗面", "Moonshot"], orgNames: ["Moonshot AI", "月之暗面", "Kimi"] },
  minimax: { name: "MiniMax", displayTag: null, aliases: ["MiniMax", "海螺"], orgNames: ["MiniMax", "稀宇科技"] },
  zhipu: { name: "智谱 GLM", displayTag: null, aliases: ["智谱", "GLM", "Z.ai"], orgNames: ["智谱AI", "智谱", "Zhipu AI", "Z.ai"], otherNames: ["Zhipu"] },
  xai: { name: "xAI", displayTag: "xAI", aliases: ["xAI", "Grok"], orgNames: ["SpaceX Super Intelligence", "SpaceXAI", "SpaceXSI", "xAI"], otherNames: ["Grok Bot"] },
  meta: { name: "Meta", displayTag: "Meta", aliases: ["Meta", "Llama"], orgNames: ["Meta Superintelligence Labs", "Meta AI", "Meta"], otherNames: ["AI at Meta", "Muse"] },
  microsoft: { name: "Microsoft", displayTag: "Microsoft", aliases: ["Microsoft", "微软", "Copilot"], orgNames: ["Microsoft Research", "Microsoft AI", "Microsoft", "微软"] },
  nvidia: { name: "NVIDIA", displayTag: null, aliases: ["NVIDIA", "英伟达"], orgNames: ["NVIDIA", "英伟达"] },
  "hugging-face": { name: "Hugging Face", displayTag: "Hugging Face", aliases: ["Hugging Face"], orgNames: ["Hugging Face", "HuggingFace"] },
  cursor: { name: "Cursor", displayTag: null, aliases: ["Cursor", "Anysphere"], orgNames: ["Cursor"] },
  openrouter: { name: "OpenRouter", displayTag: null, aliases: ["OpenRouter"], orgNames: ["OpenRouter"] },
};

/**
 * 身份词典：摘要和标题里出现的公司，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 * 行业没有这个问题时可以留空数组。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "chipshow", name: "Chipshow / 齐普", patterns: [/\bchipshow\b/i, /齐普光电|齐普/u] },
  { id: "novastar", name: "NovaStar / 诺瓦星云", patterns: [/\bnovastar\b/i, /(?<!卡萨)诺瓦(?!克)(?:星云)?/u] },
  { id: "nationstar", name: "Nationstar / 国星光电", patterns: [/\bnationstar\b/i, /(?<!中)国星(?:光电)?/u] },
  { id: "kinglight", name: "Kinglight / 晶台光电", patterns: [/\bkinglight\b/i, /晶台(?:光电)?/u] },
  { id: "macroblock", name: "Macroblock / 聚积科技", patterns: [/\bmacroblock\b/i, /聚[积積]科技/u] },
  { id: "meanwell", name: "MEAN WELL / 明纬", patterns: [/\bmeanwell\b/i, /\bMEAN\s+WELL\b/, /\bMean\s+Well\b/, /明[纬緯]/u] },
  { id: "colorlight", name: "Colorlight / 卡莱特", patterns: [/\bcolorlight\b/i, /卡莱特/u] },
  { id: "chipone", name: "Chipone / 集创北方", patterns: [/\bchipone\b/i, /集创北方/u] },
  { id: "czcl", name: "CZCL / 创联", patterns: [/\bczcl\b/i, /创联(?!合|名|盟)/u] },
  { id: "g-energy", name: "G-energy / 巨能伟业", patterns: [/\bg-energy\b/i, /巨能伟业/u] },
  { id: "huidu", name: "Huidu / 灰度科技", patterns: [/\bhuidu\b/i, /灰度科技/u] },
  { id: "oaaa", name: "OAAA / 户外广告协会", patterns: [/\boaaa\b/i] },
  { id: "ledinside", name: "LEDinside / 行业媒体", patterns: [/\bledinside\b/i] },
  { id: "daktronics", name: "Daktronics / 达科", patterns: [/\bdaktronics\b/i, /达科电子/u] },
  { id: "openai", name: "OpenAI", patterns: [/openai|chatgpt|\bgpt-?[o\d]|\bsora\b|\bcodex\b/i] },
  { id: "anthropic", name: "Anthropic", patterns: [/anthropic|\bclaude\b/i, /\b(?:opus|sonnet|haiku)\s*\d+(?:[.\-]\d+)*\b/i, /\bfable\s*\d+(?:[.\-]\d+)*\b|\bmythos\b/i] },
  { id: "google", name: "Google / Gemini", patterns: [/google|deepmind|\bgemini\b|notebooklm|\bveo\s?\d|\bAlphaFold\b|\bAMIE\b/i] },
  { id: "deepseek", name: "DeepSeek", patterns: [/deepseek|深度求索/i] },
  { id: "xai", name: "xAI / Grok", patterns: [/\bxai\b|\bgrok\b/i] },
  { id: "meta", name: "Meta / Llama", patterns: [/\bMeta\b/, /\bmeta\s?ai\b|\bllama\b/i] },
  { id: "microsoft", name: "Microsoft / Copilot", patterns: [/microsoft|copilot|微软/i] },
  { id: "nvidia", name: "NVIDIA", patterns: [/nvidia|英伟达|\bnemotron\b|\bnemo\b|\bblackwell\b|\brubin(?:\s+ultra)?\b|\bcuda\b/i] },
  { id: "qwen", name: "千问 Qwen", patterns: [/\bqwen|通义|千问/i] },
  { id: "hugging-face", name: "Hugging Face", patterns: [/hugging\s?face/i] },
  { id: "cursor", name: "Cursor", patterns: [/\bCursor\b/] },
  { id: "kimi", name: "Kimi / 月之暗面", patterns: [/\bkimi\b|月之暗面|\bmoonshot\s?ai\b/i] },
  { id: "openrouter", name: "OpenRouter", patterns: [/openrouter/i] },
  { id: "minimax", name: "MiniMax", patterns: [/minimax/i] },
  { id: "zhipu", name: "智谱 GLM", patterns: [/智谱|\bglm-?[4-9]/i] },
  { id: "hunyuan", name: "腾讯混元", patterns: [/混元|hunyuan/i] },
  { id: "doubao", name: "字节豆包", patterns: [/豆包|doubao|字节跳动|bytedance/i] },
  { id: "mistral", name: "Mistral", patterns: [/mistral/i] },
  { id: "perplexity", name: "Perplexity", patterns: [/\bPerplexity\b/] },
  { id: "runway", name: "Runway", patterns: [/\brunway\b/i] },
  { id: "suno", name: "Suno", patterns: [/\bsuno\b/i] },
  { id: "midjourney", name: "Midjourney", patterns: [/midjourney/i] },
  { id: "stability-ai", name: "Stability AI", patterns: [/stability\s?ai/i] },
  { id: "elevenlabs", name: "ElevenLabs", patterns: [/eleven\s?labs/i] },
  { id: "vllm", name: "vLLM", patterns: [/\bvllm\b/i] },
  { id: "ollama", name: "Ollama", patterns: [/\bollama\b/i] },
  { id: "windsurf", name: "Windsurf", patterns: [/windsurf/i] },
  { id: "devin", name: "Devin", patterns: [/\bdevin\b/i] },
  { id: "manus", name: "Manus", patterns: [/\bmanus\b/i] },
  { id: "apple", name: "Apple AI", patterns: [/\bapple\s?(intelligence|silicon|ai)\b|苹果(智能|\s?AI)/i] },
  { id: "amazon", name: "Amazon / AWS", patterns: [/amazon|\baws\b|亚马逊/i] },
  { id: "baidu", name: "百度文心", patterns: [/百度|baidu|文心|\bernie\s?bot\b/i] },
];

/** 这些域名上的文章，发布方就是对应的公司（托管平台如 GitHub、arXiv 不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "novastar", domains: ["novastar.tech"] },
  { entityId: "nationstar", domains: ["nationstar.com"] },
  { entityId: "kinglight", domains: ["kinglight.com"] },
  { entityId: "macroblock", domains: ["mblock.com.tw"] },
  { entityId: "meanwell", domains: ["meanwell.com"] },
  { entityId: "daktronics", domains: ["daktronics.com"] },
  { entityId: "openai", domains: ["openai.com"] },
  { entityId: "anthropic", domains: ["anthropic.com", "claude.com"] },
  { entityId: "google", domains: ["deepmind.google", "ai.google", "blog.google"] },
  { entityId: "deepseek", domains: ["deepseek.com"] },
  { entityId: "xai", domains: ["x.ai"] },
  { entityId: "meta", domains: ["ai.meta.com"] },
  { entityId: "microsoft", domains: ["microsoft.com"] },
  { entityId: "nvidia", domains: ["nvidia.com"] },
  { entityId: "qwen", domains: ["qwen.ai"] },
  { entityId: "cursor", domains: ["cursor.com"] },
  { entityId: "openrouter", domains: ["openrouter.ai"] },
];

/** 原文里的这些写法也算提到了对应公司。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [
  { entityId: "meta", pattern: /@AIatMeta\b/i },
  { entityId: "zhipu", pattern: /\bZhipu(?:\s+AI\b|['’]s\b)/i },
];

