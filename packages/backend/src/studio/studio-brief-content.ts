// A brief is one reviewable document. Its evidence remains scoped to each independent event.
import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { z } from 'zod';
import { CATEGORIES } from '@aihot/industry/taxonomy';
import { figureSpecSchema } from '../../../../scripts/editorial-pitch-lib.ts';
import type { Packet, Response } from '../../../../scripts/editorial-pilot-lib.ts';
import type { Finding, GateContext, GateReport } from './editorial-gate.ts';

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/);
const sourceBinding = z.object({ article_id: id, revision: z.number().int().positive(), content_sha256: z.string().regex(/^[a-f0-9]{64}$/), url: z.url(), published_at: z.string().nullable() }).strict();
const section = z.enum(CATEGORIES.map(c => c.key));
const evidence = z.object({ article_id: id, claim: z.string().min(1).max(1500), quote: z.string().min(1).max(350) }).strict();
export const briefSelectionSchema = z.object({
  schema: z.literal('aihot-brief-selection/1'),
  events: z.array(z.object({ article_id: id, event_id: z.string().nullable(), section,
    publication_time: z.string().nullable(), source_utc_offset: z.string(),
    date_basis: z.enum(['published', 'observed_version']), observed_version_at: z.string().nullable(),
  }).strict()).min(5).max(12),
  pages: z.array(z.object({ url: z.url(), title: z.string() }).strict()).max(30),
}).strict();
export const briefMetadataSchema = z.object({
  schema: z.literal('aihot-brief/1'),
  highlight_event_ids: z.array(id).length(3),
  items: z.array(z.object({ event_id: id, sources: z.array(sourceBinding).min(1).max(12), section,
    evidence: z.array(evidence).min(1).max(8),
  }).strict()).min(5).max(12),
}).strict();
export type BriefSelection = z.infer<typeof briefSelectionSchema>;
export type BriefMetadata = z.infer<typeof briefMetadataSchema>;

const plain = z.string().trim().min(1);
const generatedItem = z.object({
  event_key: id, article_ids: z.array(id).min(1).max(12), primary_article_id: id, section,
  title_en: plain.max(200), body_en: plain.max(2400), title_zh: plain.max(200), review_zh: plain.max(2400),
  news_status: z.enum(['reported', 'unconfirmed']).default('reported'),
  hook_anchor_quote: plain.max(350), evidence: z.array(evidence).min(1).max(8),
  why_it_matters_en: plain.max(800).optional(),
  go_deeper: z.object({ url: z.url(), label_en: plain.max(140) }).strict().optional(),
}).strict();
export const briefGenerationSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('hold'), reason_zh: plain.max(1000) }).strict(),
  z.object({ decision: z.literal('draft'), title_en: plain.max(250), title_zh: plain.max(250),
    in_5_seconds: z.array(z.object({ event_key: id, text_en: plain.max(250) }).strict()).length(3),
    items: z.array(generatedItem).min(5).max(12),
    questions_zh: z.array(z.string().max(1000)).max(30), keyword_hypothesis: plain.max(2000), meta_description_en: plain.max(2000),
    camos_rule_ids: z.array(z.string()).optional(), figures: z.array(figureSpecSchema).max(3).optional(),
  }).strict(),
]);
type GeneratedBrief = Extract<z.infer<typeof briefGenerationSchema>, { decision: 'draft' }>;
type Draft = Response['drafts'][number];
const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (message: string): never => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const sameBinding = (a: z.infer<typeof sourceBinding>, b: z.infer<typeof sourceBinding>) => a.article_id === b.article_id && a.revision === b.revision && a.content_sha256 === b.content_sha256 && a.url === b.url && a.published_at === b.published_at;
const dom = (html: string) => load(html, { xml: { xmlMode: false, withStartIndices: true, withEndIndices: true } }, false);
function range(node: { startIndex?: number | null; endIndex?: number | null } | undefined) {
  if (node?.startIndex == null || node.endIndex == null) return null;
  return { start: node.startIndex, end: node.endIndex + 1 };
}
function sourceDateLabel(source: Packet['articles'][number]['binding'], selected: BriefSelection['events'][number]) {
  const date = selected.publication_time || source.published_at;
  return date ? `Original source date: ${date}` : `Original source date: not provided; new version observed: ${selected.observed_version_at ?? 'unknown'}`;
}

/** Renderer takes plain copy, not model-supplied HTML/CSS or image URLs. */
export function buildBriefResponse(packet: Packet, generated: GeneratedBrief, producer: Response['producer'], runId: string): Response {
  if (!packet.brief) return fail('此任务未绑定短讯合集要求。');
  const articles = new Map(packet.articles.map(a => [a.binding.article_id, a]));
  const expected = new Map(packet.brief.events.map(e => [e.article_id, e]));
  const used = new Set<string>(), eventKeys = new Set<string>(), grouped = new Map<string, string>();
  const items: BriefMetadata['items'] = [];
  const itemHtml: string[] = [], chinese: string[] = [];
  for (const item of generated.items) {
    if (eventKeys.has(item.event_key)) return fail('同一事件不能拆成多条短讯。');
    eventKeys.add(item.event_key);
    if (!item.article_ids.includes(item.primary_article_id)) return fail('短讯主出处不在本事件中。');
    const ids = [item.primary_article_id, ...item.article_ids.filter(value => value !== item.primary_article_id)];
    if (new Set(ids).size !== item.article_ids.length) return fail('短讯事件包含重复来源。');
    for (const articleId of ids) {
      const selected = expected.get(articleId);
      if (!selected || used.has(articleId)) return fail('每条已选材料必须且只能归到一个短讯事件。');
      used.add(articleId);
      if (selected.event_id) {
        const previous = grouped.get(selected.event_id);
        if (previous && previous !== item.event_key) return fail('已归组的同一事件被重复计入短讯。');
        grouped.set(selected.event_id, item.event_key);
      }
    }
    const primary = articles.get(item.primary_article_id)!;
    if (!primary?.body_text?.includes(item.hook_anchor_quote) && !primary?.title.includes(item.hook_anchor_quote)) return fail('钩子标题的事实锚点未在本事件主出处找到。');
    for (const fact of item.evidence) {
      const source = articles.get(fact.article_id);
      if (!ids.includes(fact.article_id) || !source || !(source.body_text?.includes(fact.quote) || source.title.includes(fact.quote))) return fail('短讯证据必须逐条定位到本事件的对应原文，不能借用别的事件。');
    }
    if (item.go_deeper && !packet.brief.pages.some(p => p.url === item.go_deeper!.url)) return fail('Go deeper 只能选择已登记的已有页面。');
    const eventId = `event-${hash(item.event_key + ':' + ids.slice().sort().join(',')).slice(0, 24)}`;
    items.push({ event_id: eventId, sources: ids.map(articleId => articles.get(articleId)!.binding), section: item.section, evidence: item.evidence });
    const sourceHtml = ids.map((articleId, i) => {
      const source = articles.get(articleId)!, selected = expected.get(articleId)!;
      // Date-only source precision stays date-only; an observed version never becomes a publication date.
      const label = sourceDateLabel(source.binding, selected);
      return `<p class="cs-brief-source"><a href="${esc(source.binding.url)}" rel="noopener">${i ? 'Additional source' : 'Original source'}</a> · ${esc(label)}</p>`;
    }).join('\n');
    const status = item.news_status === 'unconfirmed' ? 'Unconfirmed report: ' : '';
    itemHtml.push(`<article id="brief-${eventId}" class="cs-brief-item">\n<p class="cs-brief-label">${esc(CATEGORIES.find(c => c.key === item.section)?.section ?? item.section)}</p>\n<h2>${esc(status + item.title_en)}</h2>\n<p>${esc(status + item.body_en)}</p>\n${item.why_it_matters_en ? `<p><strong>Why it matters:</strong> ${esc(item.why_it_matters_en)}</p>\n` : ''}${item.go_deeper ? `<p><a href="${esc(item.go_deeper.url)}">Go deeper: ${esc(item.go_deeper.label_en)}</a></p>\n` : ''}${sourceHtml}\n</article>`);
    chinese.push(`## [${eventId}] ${item.title_zh}\n${item.news_status === 'unconfirmed' ? '尚未证实：' : ''}${item.review_zh}\n出处：${ids.map(articleId => articles.get(articleId)!.binding.url).join('、')}`);
  }
  if (used.size !== expected.size || packet.articles.some(a => !used.has(a.binding.article_id))) return fail('短讯遗漏选中材料；如去重后少于 5 个独立事件，请保留待补材料状态。');
  if (new Set(generated.in_5_seconds.map(s => s.event_key)).size !== 3 || generated.in_5_seconds.some(s => !eventKeys.has(s.event_key))) return fail('In 5 seconds 必须引用本期三个不同事件。');
  const highlightIds: string[] = [];
  const highlights = generated.in_5_seconds.map(s => {
    const item = generated.items.find(i => i.event_key === s.event_key)!;
    const eventId = items[generated.items.indexOf(item)].event_id; highlightIds.push(eventId);
    return `<li id="brief-highlight-${eventId}">${esc((item.news_status === 'unconfirmed' ? 'Unconfirmed report: ' : '') + s.text_en)}</li>`;
  }).join('\n');
  const draft: Draft = { source: items[0].sources[0], brief: { schema: 'aihot-brief/1', highlight_event_ids: highlightIds, items }, news_status: 'reported',
    title_en: generated.title_en, title_zh: generated.title_zh,
    body_en: `<section class="cs-brief">\n<aside class="cs-brief-summary"><h2>In 5 seconds</h2><ul>${highlights}</ul></aside>\n${itemHtml.join('\n')}\n</section>`,
    review_zh: chinese.join('\n\n'), evidence: items.flatMap(item => item.evidence.map(({ claim, quote }) => ({ claim, quote }))),
    questions_zh: generated.questions_zh, keyword_hypothesis: generated.keyword_hypothesis, meta_description_en: generated.meta_description_en,
    ...(generated.camos_rule_ids ? { camos_rule_ids: generated.camos_rule_ids } : {}), ...(generated.figures ? { figures: generated.figures } : {}),
  };
  return { task_id: packet.task_id, run_id: runId, producer, decisions: packet.articles.map(a => ({ article_id: a.binding.article_id, decision: 'KEEP', reason_zh: '已按事件归并到一期短讯；仍待运营审稿，尚未发布。' })), drafts: [draft] };
}

/** File handoff shows the SAME one-document contract, with unmistakable non-publishable placeholders. */
export function briefHandoffFormat(packet: Packet): Response {
  if (!packet.brief) return fail('此任务不是短讯合集。');
  const items: GeneratedBrief['items'] = packet.articles.map((a, i) => ({ event_key: `template-${i + 1}`, article_ids: [a.binding.article_id], primary_article_id: a.binding.article_id,
    section: packet.brief!.events.find(e => e.article_id === a.binding.article_id)!.section,
    title_en: 'TEMPLATE: replace with a source-anchored headline', body_en: 'TEMPLATE ONLY: replace with an attributed factual summary of this event.',
    title_zh: '模板占位，请按事件改写', review_zh: '模板占位，须与英文逐项对应。', news_status: 'reported', hook_anchor_quote: a.title.slice(0, 350),
    evidence: [{ article_id: a.binding.article_id, claim: 'TEMPLATE: replace with the specific claim supported by this quote.', quote: (a.body_text || a.title).slice(0, 250) }],
  }));
  return buildBriefResponse(packet, { decision: 'draft', title_en: 'TEMPLATE ONLY: one reviewed LED Display Brief', title_zh: '模板占位：一期短讯',
    in_5_seconds: items.slice(0, 3).map(item => ({ event_key: item.event_key, text_en: 'TEMPLATE: replace with the corresponding event highlight.' })),
    items, questions_zh: ['模板不是成稿；按原文完善所有事实、钩子和中英正文。'], keyword_hypothesis: 'TEMPLATE: a keyword hypothesis, not demonstrated traffic.',
    meta_description_en: 'TEMPLATE: replace with an accurate English issue description.',
    ...(packet.methods?.status === 'connected' && packet.methods.ruleIds[0] ? { camos_rule_ids: [packet.methods.ruleIds[0]] } : {}),
  }, { agent_id: 'REPLACE_WITH_ACTUAL_AGENT', model: null, input_files: ['request.json', 'WRITING_START_HERE.md'] }, 'assigned-run-id');
}

/** Used by the normal task receiver. Opt-in never relaxes legacy one-source contracts. */
export function validateBriefResponse(packet: Packet, response: Response) {
  if (!packet.brief) {
    if (response.drafts.some(d => d.brief)) return fail('普通任务不能导入短讯合集。');
    return;
  }
  if (response.drafts.length === 0) {
    if (response.decisions.some(d => d.decision !== 'HOLD' && d.decision !== 'SKIP')) return fail('未产出短讯时，全部材料必须如实保留 HOLD/SKIP。');
    return;
  }
  if (response.drafts.length !== 1 || !response.drafts[0].brief) return fail('短讯任务只能生成 1 篇合集待审稿。');
  const draft = response.drafts[0], metadata = briefMetadataSchema.parse(draft.brief), articles = new Map(packet.articles.map(a => [a.binding.article_id, a]));
  const used = new Set<string>(), events = new Set<string>(), grouped = new Map<string, string>();
  const $ = dom(draft.body_en);
  if ($('.cs-brief').length !== 1 || $('.cs-brief-summary li').length !== 3 || $('.cs-brief-item').length !== metadata.items.length) return fail('短讯正文缺少完整 .cs-brief 结构或三条 In 5 seconds。');
  if (new Set(metadata.highlight_event_ids).size !== 3 || metadata.highlight_event_ids.some(id => !metadata.items.some(item => item.event_id === id) || $(`.cs-brief-summary li#brief-highlight-${id}`).length !== 1)) return fail('三条速览必须分别绑定本期三个不同事件。');
  for (const item of metadata.items) {
    if (events.has(item.event_id)) return fail('短讯事件重复。');
    events.add(item.event_id);
    const node = $(`#brief-${item.event_id}`);
    if (node.length !== 1 || !node.is('article.cs-brief-item')) return fail('短讯事件与正文位置不一致。');
    for (const [index, bound] of item.sources.entries()) {
      const source = articles.get(bound.article_id);
      if (!source || !sameBinding(bound, source.binding) || used.has(bound.article_id)) return fail('短讯来源版本不匹配或重复计数。');
      used.add(bound.article_id);
      const selection = packet.brief.events.find(e => e.article_id === bound.article_id);
      if (!selection) return fail('短讯来源未在本期选择快照中。');
      const event = selection.event_id;
      if (event && grouped.has(event) && grouped.get(event) !== item.event_id) return fail('同一已归组事件被拆成多条短讯。');
      if (event) grouped.set(event, item.event_id);
      if (!node.find('a').toArray().some(a => $(a).attr('href') === bound.url)) return fail('每条短讯必须保留对应原文链接。');
      const footer = node.find('p.cs-brief-source').filter((_i, el) => $(el).find('a').toArray().some(a => $(a).attr('href') === bound.url));
      if (footer.length !== 1 || footer.text().trim() !== `${index ? 'Additional source' : 'Original source'} · ${sourceDateLabel(bound, selection)}`) return fail('短讯原文日期/发现日期必须与冻结出处一致，不能手改为新日期。');
    }
    for (const fact of item.evidence) {
      const source = articles.get(fact.article_id);
      if (!item.sources.some(s => s.article_id === fact.article_id) || !source || !(source.body_text?.includes(fact.quote) || source.title.includes(fact.quote))) return fail('证据未在本事件对应来源中找到。');
    }
  }
  if (used.size !== articles.size || response.decisions.some(d => d.decision !== 'KEEP')) return fail('合集必须覆盖本期所有选中材料，逐条留下 KEEP 归并记录。');
  if (!sameBinding(draft.source, metadata.items[0].sources[0])) return fail('合集主身份必须绑定首条事件的主来源。');
  const flattened = metadata.items.flatMap(item => item.evidence.map(({ claim, quote }) => ({ claim, quote })));
  if (JSON.stringify(flattened) !== JSON.stringify(draft.evidence)) return fail('合集证据索引与逐事件记录不一致。');
}

export function briefDraftSegments(draft: Draft) {
  if (!draft.brief) return [];
  const $ = dom(draft.body_en);
  return draft.brief.items.map(item => {
    const node = $(`#brief-${item.event_id}`), location = range(node[0]);
    if (node.length !== 1 || !location) return fail('短讯事件边界已改变，请恢复事件结构后再批准。');
    const start = draft.review_zh.indexOf(`## [${item.event_id}]`), next = start < 0 ? -1 : draft.review_zh.indexOf('\n\n## [', start + 1);
    const zh = start < 0 ? null : { start, end: next < 0 ? draft.review_zh.length : next };
    const highlight = range($(`#brief-highlight-${item.event_id}`)[0]);
    return { item, bodyOffset: location.start, bodyEnd: location.end, zh,
      highlight,
      draft: { ...draft, brief: undefined, source: item.sources[0], title_en: '', title_zh: '', meta_description_en: '',
        body_en: draft.body_en.slice(location.start, location.end), review_zh: zh ? draft.review_zh.slice(zh.start, zh.end) : '',
        evidence: item.evidence.map(({ claim, quote }) => ({ claim, quote })), figures: undefined },
    };
  });
}

/** The callback is the existing gate, so brief support cannot introduce a weaker parallel gate. */
export function evaluateBriefDraft(packet: Packet, draft: Draft, context: GateContext, evaluate: (packet: Packet, draft: Draft, context: GateContext) => GateReport): GateReport {
  const findings: Finding[] = [], mandatory = new Set<string>();
  const block = (reason: string) => findings.push({ ruleId: 'D1', severity: 'BLOCK', field: 'body_en', start: 0, end: Math.min(300, draft.body_en.length), quote: draft.body_en.slice(0, 300), reason });
  let segments: ReturnType<typeof briefDraftSegments>;
  try {
    validateBriefResponse(packet, { task_id: packet.task_id, run_id: 'current-brief-review', producer: { agent_id: 'editorial-gate', model: null, input_files: ['current draft'] },
      decisions: packet.articles.map(a => ({ article_id: a.binding.article_id, decision: 'KEEP', reason_zh: '当前稿结构核对，不代表批准。' })), drafts: [draft] });
    segments = briefDraftSegments(draft);
  } catch (error) { block(error instanceof Error ? error.message : '短讯结构无法核验。'); return { version: 'editorial-gate/1', blocked: true, findings, mandatoryReview: [] }; }
  const scopedPacket = (ids: string[]) => {
    const selected = ids.map(value => packet.articles.find(a => a.binding.article_id === value)).filter((a): a is Packet['articles'][number] => !!a);
    if (selected.length !== ids.length) block('短讯来源快照缺失，不能批准。');
    const textParts: { id: string; start: number; end: number }[] = [];
    let text = '';
    for (const source of selected) { const start = text.length; text += source.body_text ?? ''; textParts.push({ id: source.binding.article_id, start, end: text.length }); text += '\n\n'; }
    return { packet: { ...packet, brief: undefined, articles: selected.map((a, i) => i === 0 ? { ...a, body_text: text } : a) }, textParts };
  };
  for (const segment of segments) {
    const scope = scopedPacket(segment.item.sources.map(s => s.article_id));
    const pieces = [{ draft: segment.draft, offset: segment.bodyOffset, zh: segment.zh },
      ...(segment.highlight ? [{ draft: { ...segment.draft, body_en: draft.body_en.slice(segment.highlight.start, segment.highlight.end), review_zh: '' }, offset: segment.highlight.start, zh: null }] : [])];
    for (const piece of pieces) {
      const result = evaluate(scope.packet, piece.draft, context);
      result.mandatoryReview.forEach(reason => mandatory.add(reason));
      for (const f of result.findings) {
      if (f.field === 'body_en') findings.push({ ...f, start: f.start + piece.offset, end: f.end + piece.offset, quote: draft.body_en.slice(f.start + piece.offset, f.end + piece.offset) });
      else if (f.field === 'review_zh' && piece.zh) findings.push({ ...f, start: f.start + piece.zh.start, end: f.end + piece.zh.start, quote: draft.review_zh.slice(f.start + piece.zh.start, f.end + piece.zh.start) });
      else if (f.field === 'source.body_text') {
        const part = scope.textParts.find(p => f.start >= p.start && f.end <= p.end);
        findings.push({ ...f, field: part ? `source[${part.id}].body_text` : 'body_en', start: part ? f.start - part.start : segment.bodyOffset, end: part ? f.end - part.start : segment.bodyEnd,
          quote: part ? f.quote : draft.body_en.slice(segment.bodyOffset, segment.bodyEnd), reason: `${f.reason}（本事件：${segment.item.event_id}）` });
      } else findings.push(f);
      }
    }
  }
  // Keep offsets stable while auditing issue title, three highlights, meta and any text outside events.
  const masked = (text: string, ranges: { start: number; end: number }[]) => ranges.reduce((value, r) => value.slice(0, r.start) + value.slice(r.start, r.end).replace(/[^\n]/g, ' ') + value.slice(r.end), text);
  const scope = scopedPacket(packet.articles.map(a => a.binding.article_id));
  const global = evaluate(scope.packet, { ...draft, brief: undefined, body_en: masked(draft.body_en, segments.flatMap(s => [{ start: s.bodyOffset, end: s.bodyEnd }, ...(s.highlight ? [s.highlight] : [])])), review_zh: masked(draft.review_zh, segments.flatMap(s => s.zh ? [s.zh] : [])) }, context);
  global.mandatoryReview.forEach(reason => mandatory.add(reason));
  findings.push(...global.findings.filter(f => f.field !== 'source.body_text').map(f => f.field === 'body_en' ? { ...f, quote: draft.body_en.slice(f.start, f.end) } : f));
  const unique = [...new Map(findings.map(f => [JSON.stringify([f.ruleId, f.severity, f.field, f.start, f.end, f.reason]), f])).values()];
  return { version: 'editorial-gate/1', blocked: unique.some(f => f.severity === 'BLOCK'), findings: unique, mandatoryReview: [...mandatory] };
}
