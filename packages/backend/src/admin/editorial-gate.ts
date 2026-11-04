import type { Packet, Response } from '../../../../scripts/editorial-pilot-lib.ts';
import { ENTITIES } from '@aihot/industry/taxonomy';
import sourceConfig from '../../../../industry/sources.json' with { type: 'json' };

export type Finding = {
  ruleId: string; severity: 'BLOCK' | 'WARN'; field: string;
  start: number; end: number; quote: string; reason: string;
};
export type GateReport = { version: string; blocked: boolean; findings: Finding[]; mandatoryReview: string[] };
/** Caller-owned records only: never populate these from response.evidence or generated text.
 * A reference identifies the external record; it does not make a model assertion verified.
 */
export type GateContext = {
  newTopic?: boolean;
  publishedTexts?: string[];
  knownAliases?: Record<string, string | string[]>;
  verifiedEvidence?: {
    articleId: string; kind: 'customer' | 'image' | 'certification' | 'commercial';
    value: string; status: 'verified' | 'denied'; reference: string;
  }[];
};

type Draft = Response['drafts'][number];
type Span = { text: string; start: number; end: number };
const VERSION = 'editorial-gate/1';
const contentFields = ['title_zh', 'review_zh', 'title_en', 'body_en', 'meta_description_en'] as const;
const techNumber = /(?<![a-zA-Z0-9])\d[\d,.]*(?:\s*[–—~-]\s*\d[\d,.]*)?\s*(?:nits?\b|cd\s*\/\s*m[²2]|mm\b|cm\b|μm\b|µm\b|nm\b|[kM]?Hz\b|[kM]?W\b|mA\b|V\b|ms\b|°\s*C\b|℃|%|:\s*1\b|[亿万]色)/giu;
const ranking = /最好|最强|领先|首选|全面优于|碾压|完胜|第一(?![章节步条次天])|\b(?:best|strongest|leading|first choice|outperforms?|number one)\b/gi;
const freshness = /最新|首发|独家|刚刚|今日|\b(?:latest|just released|world premiere|exclusive|today)\b/gi;
const certificates = /\b(?:CE|EN\s*12966|AEC[-‐‑–]?Q102|RoHS|IP[0-6X][0-9X]?)\b/gi;
const negative = /不如|落后于|已被淘汰|\b(?:inferior to|lags? behind|obsolete|outdated)\b/gi;
const commercial = /价格|报价|交期|质保|供货保证|\b(?:price|quote|quotation|delivery|lead time|warranty|guaranteed supply)\b/gi;
const customer = /客户|项目|案例|\b(?:customer|client|project|case study)\b/gi;
// A generic project is not a customer disclosure. Keep identifiable delivery/context cues
// reviewable; this lexical check cannot discover every undisclosed customer identity.
const projectDisclosure = /项目(?:名称|名为|位于|地址|业主|客户|案例|授权)|(?:承接|承建|交付|中标|签约|落地|竣工|完成|安装)[^。！？\n,，;；]{0,40}项目|(?:机场|体育场|体育馆|地铁|车站|商场|会展中心)项目|\bproject\s+(?:named|called|for|at|in)\b|\b(?:delivered|installed|deployed|completed|commissioned|awarded)\b[^.!?\n]{0,60}\bproject\b/i;
const market = /市场规模|市场份额|出货量|年复合增长率|\b(?:market size|market share|shipments?|CAGR)\b/i;
const marketNumber = /\d[\d,.]*\s*(?:%|亿|万|billion\b|million\b|units\b|美元|亿元)/gi;
const condition = /条件|环境|温度|电流|扫描|测试|测量|上限|最高可达|\b(?:under|at\s+\d|scan|temperature|current|measured|test conditions|up to|maximum)\b/i;
const thirdParty = /原厂称|厂商称|原文称|我们(?:报道|转述|引用)|据[^。\n]{1,60}(?:表示|称|报道|数据)|(?:厂商|原厂|厂家|制造商|公司).{0,12}(?:表示|称|介绍|宣布)|\b(?:according to|we (?:report|quote)|manufacturer(?:'s)? (?:claims?|statements?|specifications?)|(?:manufacturer|vendor|company) (?:says|said|claims?|reports?|states?|announces?))\b/i;
const locator = /https?:\/\/[^\s<>]+|\[[\d]+\]|来源[：:]|出处[：:]/i;

const matches = (text: string, re: RegExp) => [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))];
const spans = (text: string, re: RegExp): Span[] => matches(text, re).map(m => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));
const paragraphs = (text: string) => spans(text, /[^\r\n]+(?:\r?\n(?!\s*\r?\n)[^\r\n]+)*/g);
// A dot only ends a sentence before whitespace/end, preserving decimals and URL/model interiors.
function sentences(text: string): Span[] {
  const result: Span[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (/[。！？\n]/.test(text[i]) || (/[.!?]/.test(text[i]) && (i + 1 === text.length || /\s/.test(text[i + 1])))) {
      result.push({ text: text.slice(start, i + 1), start, end: i + 1 });
      start = i + 1;
    }
  }
  if (start < text.length) result.push({ text: text.slice(start), start, end: text.length });
  return result;
}
const negated = (text: string, index: number) => {
  const before = text.slice(0, index).split(/[，,；;。！？!?]/).at(-1) ?? '';
  return /(?:并非|不是|不应|不能|不可|避免|勿|不要|禁止|未能证明|未证实|未做|不写成|不建议|不作|不做|并不|不代表|不意味着|不得)[^，,；;。]{0,24}$|\b(?:not|never|avoid|cannot|can't|mustn't|don't|doesn't|do not|no evidence of|should not)\b[^,;.!?]{0,45}$/i.test(before)
    || /(?:等|这些|此类)?(?:用语|词语|表述|措辞|断言).{0,8}(?:应避免|不可使用|不应使用|需核实)|^.{0,24}(?:广告语|广告用语)|^.{0,35}\b(?:should|must) (?:be avoided|not be used)\b/i.test(text.slice(index));
};
const historical = (text: string) => /(?:回顾|当时|彼时|历史报道|曾于)|\b(?:at the time|back then|historically|in (?:19|20)\d{2}[^.!?]{0,35}(?:said|reported|announced))\b/i.test(text);
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const named = (text: string, name: string) => matches(text, new RegExp(`(?<![\\p{L}\\p{N}_])${escaped(name)}(?![a-zA-Z0-9_])`, 'giu'));
function sourceNames(sourceId: string, sourceName: string): string[] {
  const configured = sourceConfig.sources.find(s => s.id === sourceId);
  const owner = configured?.owner_entity_id ?? sourceId;
  const entities = ENTITIES[owner] ? [ENTITIES[owner]] : Object.values(ENTITIES).filter(e =>
    [...e.aliases, ...(e.orgNames ?? []), ...(e.otherNames ?? [])].some(n => named(sourceName, n).length > 0));
  // An ambiguous display name cannot select multiple manufacturers. Never scan draft text for owners.
  if (entities.length === 1) {
    const e = entities[0];
    return [...new Set([e.name, ...e.aliases, ...(e.orgNames ?? []), ...(e.otherNames ?? [])])];
  }
  const name = sourceName.trim().replace(/\s+(?:Product\s+)?News$/i, '');
  return name ? [name] : [];
}
function attributed(text: string, names: readonly string[]) {
  if (thirdParty.test(text)) return true;
  if (/原文[^。\n]{0,14}(?:给出|表述|说明|描述|强调|说|称)|厂商的?(?:解法|比较|表述)|(?:reported|stated|claimed|specified) (?:by|in) (?:the )?(?:manufacturer|source|company)/i.test(text)) return true;
  return names.some(name => named(text, name).some(m =>
    /^\s*(?:[,，:：]\s*)?(?:(?:has|have|had)\s+)?(?:(?:says|said|claims?|claimed|reports?|reported|states?|stated|announces?|announced|specifies|specified|describes|described)\b|称|表示|介绍|宣布|披露)/i.test(text.slice(m.index! + m[0].length))));
}
// Require an explicit date, and never consult wall-clock time. Unzoned timestamps are unknown.
function dateMs(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:$|T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$)/.test(value)) return null;
  const ms = Date.parse(value);
  const day = Date.parse(value.slice(0, 10));
  return Number.isFinite(ms) && Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === value.slice(0, 10) ? ms : null;
}
function report(findings: Finding[]): GateReport {
  return { version: VERSION, blocked: findings.some(f => f.severity === 'BLOCK'), findings,
    mandatoryReview: [...new Set(findings.filter(f => f.severity === 'WARN').map(f => f.ruleId))] };
}

/** UTF-16 [start,end) offsets address the untouched named draft field (source.body_text for source).
 * This is a lexical review aid, not semantic completeness, certification validation or legal advice.
 */
export function evaluateDraft(packet: Packet, draft: Draft, context: GateContext = {}): GateReport {
  const findings: Finding[] = [];
  const article = packet.articles.find(a => a.binding.article_id === draft.source.article_id);
  const source = article?.body_text ?? '';
  const sourceName = article?.source_name ?? '';
  const attributionNames = sourceNames(article?.source_id ?? '', sourceName);
  const screenMetrics = sentences(source).filter(s => matches(s.text, techNumber).some(n => !/\b(?:mm|cm|nm)\b|μm|µm/i.test(n[0]))
    && /显示屏|屏体|\b(?:displays?|screens?|using these LEDs)\b/i.test(s.text));
  const sourceTime = dateMs(article?.binding.published_at);
  const taskTime = dateMs(packet.created_at);
  const ageDays = sourceTime === null || taskTime === null ? null : (taskTime - sourceTime) / 86_400_000;
  const add = (ruleId: string, severity: Finding['severity'], field: string, text: string, start: number, end: number, reason: string) => {
    const quote = text.slice(start, end);
    if (!quote || findings.some(f => f.ruleId === ruleId && f.field === field && f.start === start && f.end === end && f.severity === severity)) return;
    findings.push({ ruleId, severity, field, start, end, quote, reason });
  };
  const anchor = (rule: string, reason: string) => add(rule, 'WARN', 'body_en', draft.body_en, 0, draft.body_en.length, reason);
  const evidence = (kind: NonNullable<GateContext['verifiedEvidence']>[number]['kind'], value: string) => {
    // Exact resource/standard identity, explicitly scoped to this source. Generated evidence is ignored.
    const records = context.verifiedEvidence?.filter(e => e.articleId === draft.source.article_id && e.kind === kind && e.value === value && e.reference.trim());
    return records?.some(e => e.status === 'denied') ? 'denied' : records?.some(e => e.status === 'verified') ? 'verified' : 'unknown';
  };
  const aliases = Object.values(context.knownAliases ?? {}).flatMap(v => typeof v === 'string' ? [v] : v);
  const names = [sourceName, ...Object.keys(context.knownAliases ?? {}), ...aliases].filter(Boolean);

  for (const field of contentFields) {
    const text = draft[field];
    const paras = paragraphs(text);
    // Explicit opening attribution can govern later parameter paragraphs. A bare brand name cannot.
    const opening = paras.slice(0,3).map(p=>p.text).join('\n');
    const explicitScope = /下文所有性能表述均来自|(?:figures|specifications|mechanisms|parameters|numbers|product boundaries)[^.\n]{0,100}(?:reported|stated|claimed|specified) (?:by|in) (?:the )?(?:manufacturer|source)|as stated by the manufacturer/i.test(text);
    const manufacturerFrame = (attributed(opening, attributionNames)||explicitScope) && !/\b(?:we|our)\b|本公司|本站|我们/i.test(text);
    // A local paragraph may inherit attribution from elsewhere. That is ambiguous,
    // not proof of absent attribution: require human review instead of blocking it.
    const attributionElsewhere = attributed(text,attributionNames) && !/\b(?:we|our)\b|本公司|本站|我们/i.test(text);
    for (const p of paras) {
      const nums = matches(p.text, techNumber);
      const hasAttribution = attributed(p.text, attributionNames) || manufacturerFrame;
      for (const n of nums) {
        // A year alone or a numbered heading has no technical unit and cannot match.
        const sentence = sentences(p.text).find(s => n.index! >= s.start && n.index! < s.end)!;
        if (n[0].includes('%') && market.test(sentence.text)) continue;
        const unclearPercent = n[0].includes('%') && !/亮度|效率|功耗|节能|能耗|透光|对比|\b(?:brightness|efficiency|power|energy|transmission|contrast)\b/i.test(sentence.text);
        if (!hasAttribution) add('D1', attributionElsewhere || unclearPercent || negated(sentence.text, n.index! - sentence.start) ? 'WARN' : 'BLOCK', field, text, p.start + n.index!, p.start + n.index! + n[0].length,
          unclearPercent ? '百分比未识别到明确技术指标，需核实数值含义与归属。' : '技术数值缺少可识别的厂商或原文归属；需保留其声明主体。');
        if (!/\b(?:mm|cm|nm)\b|μm|µm/i.test(n[0]) && !condition.test(p.text)) add('W4', 'WARN', field, text, p.start + n.index!, p.start + n.index! + n[0].length, '性能数值未识别到测试条件/适用范围，需按具体指标确认。');
      }
    }
    // Only flag an explicit package-level label against explicit source screen metrics.
    // Object equivalence and mixed metrics remain an editor decision, never an automatic block.
    if (screenMetrics.length > 0) {
      for (const m of matches(text, /\bpackage[- ]level\s+specifications\b/gi)) {
        const sentence = sentences(text).find(s => m.index! >= s.start && m.index! < s.end)!;
        if (!negated(sentence.text, m.index! - sentence.start)) add('W4', 'WARN', field, text, m.index!, m.index! + m[0].length,
          `原文含明确屏体/使用这些LED的指标：“${screenMetrics[0].text.trim()}”；此处概括为封装级规格，需人工核对指标对象，不能据此认定封装本体性能。`);
      }
    }
    for (const s of sentences(text)) {
      const attr = attributed(s.text, attributionNames) || manufacturerFrame;
      const own = /\b(?:we|our|us)\b|我们|本公司|本站|我司/i.test(s.text);
      const cited = attr && (locator.test(s.text) || locator.test(text));
      const hit = (rule: string, severity: Finding['severity'], m: RegExpMatchArray, reason: string) => add(rule, severity, field, text, s.start + m.index!, s.start + m.index! + m[0].length, reason);
      for (const m of matches(s.text, ranking)) {
        if (negated(s.text, m.index!)) continue;
        const quoted = matches(s.text, /[“「"'][^”」"'\n]+[”」"']/g).some(q => m.index! >= q.index! && m.index! < q.index! + q[0].length);
        if (cited || (quoted && locator.test(text))) hit('D2', 'WARN', m, '排序表述已带引用与出处；程序不能核实该出处是否为独立第三方评测，须人工核对。');
        else hit('D2', attr ? 'WARN' : 'BLOCK', m, attr ? '排序主张有归属，但未识别可定位评测出处。' : '未带可定位第三方评测出处的直接排序断言。');
      }
      for (const m of matches(s.text, freshness)) {
        if (negated(s.text, m.index!) || historical(s.text)) continue;
        if (ageDays === null || ageDays < 0) hit('D3', 'WARN', m, '原文日期或任务日期未知/矛盾，无法确定时效断言。');
        else if (ageDays > 7) hit('D3', 'BLOCK', m, `以任务 created_at 为基准，原文已超过7天（${Math.floor(ageDays)}天），仍出现当前时效断言。`);
      }
      for (const m of matches(s.text, certificates)) {
        if (negated(s.text, m.index!)) continue;
        const state = evidence('certification', m[0]);
        if (state === 'verified') continue;
        const selfClaim = /(?:我们|本公司|本站|我司)(?:的[^，。]{0,12})?[^，。]{0,12}(?:通过|获得|持有|符合).{0,20}(?:认证|标准|CE|RoHS|AEC)|\b(?:we (?:are|have been)|our (?:company|products?|displays?|screens?|components?) (?:is|are))\s+(?:(?:fully|now|also|officially)\s+)*(?:[\w‐‑–-]+[-\s]+)?(?:certified|compliant|approved)\b|\bwe (?:hold|have obtained)\s+(?:a\s+)?[\w‐‑–-]+\s+(?:certificate|certification)\b/i.test(s.text);
        const certificateLocator = /证书(?:号|编号)|签发机构|\b(?:certificate (?:no\.?|number|#)|issued by|certified by)\b/i.test(s.text);
        hit('D5', state === 'denied' || (selfClaim && !certificateLocator && !attr) ? 'BLOCK' : 'WARN', m,
          state === 'denied' ? '可信核验记录明确否定该认证声明。' : selfClaim ? '本方认证声明缺少可信核验；证书号或签发机构文字本身也不等于核验通过。' : '出现认证/防护等级；第三方报道或标准名称不能证明本站持有，须核实对象与证据。');
      }
      for (const m of matches(s.text, commercial)) {
        if (negated(s.text, m.index!)) continue;
        const promise = own && /(?:我们|本公司|本站|我司).{0,12}(?:保证|承诺|提供|报价|质保)|\bwe (?:guarantee|promise|offer|provide|deliver|ship|warrant)\b|\bour (?:price|quote|warranty|lead time|delivery time) (?:is|will be)\b/i.test(s.text)
          && /\d|保证|承诺|guarantee|promise/i.test(s.text);
        const state = evidence('commercial', s.text.trim());
        if (state === 'verified') continue;
        hit('D6', state === 'denied' || (promise && !attr && !historical(s.text)) ? 'BLOCK' : 'WARN', m,
          promise && !attr && !historical(s.text) ? '识别到本方具体价格、交付或质保承诺，缺少可信商务记录。' : '商务信息需核对象与日期；第三方报价、历史报道或询价邀请不等于本站承诺。');
      }
      for (const m of matches(s.text, negative)) {
        if (negated(s.text, m.index!)) continue;
        const named = names.some(n => s.text.includes(n)) || /\b(?:COB|SMD|MiP|DIP|LCD|OLED|LED)\b/.test(s.text);
        hit('D7', named && !attr && !historical(s.text) ? 'BLOCK' : 'WARN', m, named ? '具体品牌或技术路线的负面结论；转述及历史范围须人工核实。' : '负面比较的对象无法可靠识别，转人工核实。');
      }
      for (const m of matches(s.text, customer)) {
        if (negated(s.text, m.index!)) continue;
        // Detect mentions, not identities: unknown names and authorization cannot be inferred by regex.
        const state = evidence('customer', s.text.trim());
        if (state === 'verified') continue;
        if (state !== 'denied' && /^(?:项目|project)$/i.test(m[0]) && !projectDisclosure.test(s.text)) continue;
        hit('D8', state === 'denied' ? 'BLOCK' : 'WARN', m, state === 'denied' ? '可信记录明确禁止披露该客户/项目内容。' : '客户/项目/案例候选，尚无可识别的可信授权记录；文稿自称已授权不生效。');
      }
      if (market.test(s.text)) for (const m of matches(s.text, marketNumber)) {
        if (negated(s.text, m.index!)) continue;
        const missing = [!cited && '来源', !/(?:19|20)\d{2}|季度|年度|\b(?:Q[1-4]|FY\d{2,4})\b/i.test(s.text) && '数据期间',
          !/口径|定义|样本|地区|全球|中国|\b(?:defined|sample|global|worldwide|China|US|Europe|units|revenue|by value|by volume)\b/i.test(s.text) && '定义/范围'].filter(Boolean);
        if (missing.length) hit('D9', missing.length === 3 && !attr ? 'BLOCK' : 'WARN', m, `市场数字未识别到：${missing.join('、')}。词面线索不能证明口径可比，部分信息存在时转人工核实。`);
      }
    }

    if (field === 'title_zh' || field === 'review_zh') {
      const aliasMasked = aliases.filter(Boolean).reduce((t, alias) => t.split(alias).join(' '.repeat(alias.length)), text);
      for (const m of matches(aliasMasked, /[\u3400-\u9fff]{2,14}(?:公司|集团|大学|研究院|实验室|协会)|[\u3400-\u9fff]{1,8}[·・][\u3400-\u9fff]{1,12}/g)) {
        if (!source.includes(m[0])) add('D4', 'WARN', field, text, m.index!, m.index! + m[0].length, '中文专名候选未在原文或调用方权威别名字典中找到；无法可靠自动识别人名/机构名，不作阻断。');
      }
    }
    for (const m of matches(text, /!\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)|<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi)) {
      const value = m[1] ?? m[2] ?? m[3] ?? m[4];
      const state = evidence('image', value);
      if (state !== 'verified') add('D10', state === 'denied' ? 'BLOCK' : 'WARN', field, text, m.index!, m.index! + m[0].length,
        state === 'denied' ? '可信记录明确否定该图片使用授权。' : '图片引用没有匹配的可信授权记录；原文链接、图片署名或模型自称自有不能作为授权。');
    }
    for (const term of ['MiP', 'COB', 'AEC-Q102']) {
      const m = matches(text, new RegExp(`\\b${term}\\b`, 'g'))[0];
      if (!m) continue;
      const near = text.slice(Math.max(0, m.index! - 70), m.index! + term.length + 90);
      if (!/[（(][^）)]+[）)]|封装|芯片|车规|可靠性|chip.on.board|micro.{0,15}package|automotive|qualification/i.test(near)) add('W6', 'WARN', field, text, m.index!, m.index! + term.length, '首次出现专业缩写，附近未识别到解释；术语表仅覆盖MiP、COB、AEC-Q102。');
    }
  }

  if (ageDays === null || ageDays < 0) anchor('W1', '原文日期或任务日期未知/矛盾，无法判断材料年龄。');
  else if (ageDays > 30) anchor('W1', `原文距任务日期${Math.floor(ageDays)}天；确认应作技术解释还是新闻。`);
  // Count distinct URLs actually present in this draft, including its bound source, not packet size.
  const citations = new Set([draft.source.url.replace(/\/$/, '')]);
  for (const field of contentFields) {
    const prose = draft[field].replace(/!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>/gi, '');
    for (const m of matches(prose, /https?:\/\/[^\s<>"')\]]+/g)) citations.add(m[0].replace(/[.,;，。；]+$/, '').replace(/\/$/, ''));
  }
  if (citations.size === 1) anchor('W2', '本稿仅识别到1个不同来源URL（含绑定原文）；URL数量不等于独立证据数量。');
  for (const m of matches(source, /转引|援引|\b(?:citing|cites|quoted from|Research and Markets|TrendForce)\b/gi)) add('W3', 'WARN', 'source.body_text', source, m.index!, m.index! + m[0].length, '原文含二次转述线索；同一研究的传播不算独立互证，需追溯一手。');
  const subject = `${article?.title ?? ''}\n${source}`;
  if (!/显示|商显|户外|固装|租赁|交通|直显|灯珠|封装|箱体|驱动|电源|控制系统|\b(?:display|signage|outdoor|fixed installation|rental|traffic|direct.view|driver IC|LED packag|cabinet|power suppl|control system)\b/i.test(subject)) anchor('W5', '未识别LED商显、IC、灯珠、箱体、电源或控制系统主题线索；仅为词面提示，未挂既有采购问题不等于无阅读价值。');
  if (context.newTopic) anchor('W5', '本库同方向尚无已通过稿件：按新领域首篇逐字人工确认。方向由当前已审稿的可识别主题比对，不表示行业首次。');

  const zh = `${draft.title_zh}\n${draft.review_zh}`;
  const en = `${draft.title_en}\n${draft.body_en}`;
  const unconfirmedZh = /据传|尚未证实|未经证实|传闻/.test(zh);
  const unconfirmedEn = /\bunconfirmed\b|\breportedly\b|\brumou?red\b/i.test(en);
  if (unconfirmedZh !== unconfirmedEn) anchor('W7', '中英消息状态限定不一致；尚未证实的资讯须在英文标题、摘要、正文保留限定和信源日期。');
  if (draft.news_status === 'unconfirmed') {
    for (const field of ['title_en','meta_description_en','body_en'] as const) {
      if (!/\bunconfirmed\b|\breportedly\b|\brumou?red\b/i.test(draft[field])) add('W7', 'WARN', field, draft[field], 0, draft[field].length, '稿件标记为尚未证实，该英文出口未识别消息限定。公开导出会附状态、原日期和信源；请同时核对原句语气。');
    }
  }
  // Compare only technical number+unit tokens, not titles' list numbers, dates or evidence arrays.
  const normalizedNumbers = (t: string) => new Set(matches(t, techNumber).map(m => m[0].toLowerCase().replace(/[\s,]/g, '').replace(/nits?$/, 'nit').replace(/[–—~]/g, '-')));
  const z = normalizedNumbers(zh), e = normalizedNumbers(en);
  if (z.size !== e.size || [...z].some(n => !e.has(n))) anchor('W7', '中英标题+正文的技术数字/单位集合不一致；程序不推断单位换算与事实等价，须逐点核实。');
  else if (attributed(zh, attributionNames) !== attributed(en, attributionNames)) anchor('W7', '中英文可识别的来源归属线索不一致；须逐点核实事实与归属。');

  if (context.publishedTexts === undefined) anchor('W8', '未提供已发布文字历史，本次无法判断历史重复度。');
  else if (context.publishedTexts.length > 0) {
    // Each language body is compared separately with each historical text. Unicode code-point
    // 5-grams, lowercase, letters/digits only; unique-set containment (intersection/draft grams).
    // Never join history records or languages: no artificial cross-document n-grams.
    const grams = (t: string) => {
      const chars = [...t.toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^\p{L}\p{N}]/gu, '')];
      return new Set(Array.from({ length: Math.max(0, chars.length - 4) }, (_, i) => chars.slice(i, i + 5).join('')));
    };
    const histories = context.publishedTexts.map(grams);
    for (const field of ['review_zh', 'body_en'] as const) {
      const draftGrams = grams(draft[field]);
      if (draftGrams.size < 20) {
        add('W8', 'WARN', field, draft[field], 0, draft[field].length, '正文不足20个不同5-gram，重复度样本太短，转人工判断。');
        continue;
      }
      histories.forEach((h, i) => {
        const overlap = [...draftGrams].filter(g => h.has(g)).length;
        if (overlap / draftGrams.size > 0.6) add('W8', 'WARN', field, draft[field], 0, draft[field].length, `与publishedTexts[${i}]重合${overlap}/${draftGrams.size}个不同字符5-gram（${(overlap / draftGrams.size * 100).toFixed(2)}%），超过60%；分母为当前单语正文，非语义抄袭判断。`);
      });
    }
  }
  return report(findings);
}

/** Aggregate fields use drafts[i].field; source findings retain source.body_text as contracted. */
export function editorialGate(packet: Packet, response: Response, context?: GateContext): GateReport {
  return report(response.drafts.flatMap((draft, i) => evaluateDraft(packet, draft, context).findings.map(f => ({
    ...f, field: f.field === 'source.body_text' ? f.field : `drafts[${i}].${f.field}`,
  }))));
}
