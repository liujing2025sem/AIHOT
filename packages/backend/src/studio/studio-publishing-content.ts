import { isIP } from 'node:net';
import { load } from 'cheerio';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { ENTITIES } from '@aihot/industry/taxonomy';
import type { Packet, Response } from '../../../../scripts/editorial-pilot-lib.ts';
import { config } from '../config.ts';
import { isBlockedAddress } from '../lib/url.ts';
import { evaluateDraft, type Finding } from './editorial-gate.ts';
import { companyFactRules } from './studio-company-facts.ts';
import { redactPitch } from './studio-pitch-evidence.ts';
import { publicationStatus } from './studio-publication.ts';

export type PublicationIssue = { code: string; message: string };
export type EditorialDraft = Response['drafts'][number];
const words = (text: string) => [...text.matchAll(/[a-zA-Z]+(?:['’-][a-zA-Z]+)*/g)];
const comparable = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const escaped = (value: string) => value.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
const hasTerm = (text: string, term: string) => new RegExp('(?<![a-z0-9])' + escaped(term) + '(?![a-z0-9])', 'i').test(text);
const textOf = (value: string) => /<[a-z][^>]*>/i.test(value) ? load(value, {}, false).text() : value;
const blockTags = 'address,article,aside,blockquote,dd,div,dl,dt,figure,figcaption,h1,h2,h3,h4,h5,h6,hr,li,main,ol,p,pre,section,table,tbody,td,tfoot,th,thead,tr,ul,br';
const blocks = new Set(blockTags.split(','));
const purifier = {
  allowedTags: [...new Set([...sanitizeHtml.defaults.allowedTags, 'figure', 'figcaption', 'img', 'details', 'summary', 'del', 's', 'sup', 'sub'])],
  allowedAttributes: { '*': ['class', 'id', 'title', 'lang', 'dir'], a: ['href', 'target', 'rel'], img: ['src', 'alt', 'width', 'height', 'loading'],
    th: ['scope', 'colspan', 'rowspan'], td: ['colspan', 'rowspan'], ol: ['start'] },
  allowedSchemes: ['http', 'https'],
};

export function sameWordPressHtml(left: string, right: string): boolean {
  const canonical = (html: string) => {
    const $ = load(html.replace(/\r\n?/g, '\n'), {}, false);
    $('*').each((_i, el) => {
      if (!('attribs' in el)) return;
      el.attribs = Object.fromEntries(Object.entries(el.attribs).sort(([a], [b]) => a.localeCompare(b)));
    });
    // Ignore indentation between blocks. Preserve spaces around inline tags, in text and in code.
    $(blockTags).add($.root()).contents().each((_i, el) => {
      if (el.type !== 'text' || el.data.trim() || $(el).parents('pre,code').length) return;
      const isBlockEdge = (node: typeof el.prev) => !node || ('name' in node && blocks.has(node.name));
      if (isBlockEdge(el.prev) && isBlockEdge(el.next)) $(el).remove();
    });
    return $.html().trim();
  };
  return canonical(left) === canonical(right);
}

function privateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return isIP(host) ? isBlockedAddress(host) :
    host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') ||
    host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.corp') ||
    config.privateFeedHosts.includes(host) || !host.includes('.');
}
const secret = /(?:-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|Bearer\s+[A-Za-z0-9_.=-]{12,})\b|\b(?:api[_ -]?key|app[_ -]?password|access[_ -]?token|client[_ -]?secret|password)\s*[:=]\s*["']?[A-Za-z0-9_+/=.~-]{8,})/i;
const keyBlock = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|$)/g;
const address = /(?:https?:\/\/[^\s<>"']+|(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.]|\s*(?:mm|cm|m)\b)|\[[0-9a-f:]+\]|(?<![\w.])(?:[a-z0-9-]+\.)+(?:internal|local|lan|corp|localhost)\b|\blocalhost(?=:\d|\b))/gi;
const sensitive = (text: string) => secret.test(text) || [...text.matchAll(address)].some(([value]) => {
  if (!value) return false;
  try {
    const u = new URL(value.startsWith('http') ? value : 'http://' + value);
    return !!(u.username || u.password) || privateHost(u.hostname) ||
      [...u.searchParams.keys()].some(key => /^(?:api[_-]?key|access[_-]?token|password|secret)$/i.test(key));
  } catch { return false; }
});
const negative = /\b(?:inferior|lags? behind|obsolete|outdated|unreliable|substandard|unsafe|defective|overpriced|scam|fraud|poor quality|worst|worse than|fails? (?:to|under))\b|不如|落后|淘汰|劣质|质量差|不可靠|欺诈|有缺陷|故障频发/i;
const negatedRisk = /\b(?:not|isn't|aren't|wasn't|weren't|never|no evidence (?:of|that))\s+(?:\w+\s+){0,3}(?:inferior|obsolete|outdated|unreliable|substandard|unsafe|defective|overpriced|a scam)\b|并不(?:落后|劣质|不可靠)/i;
const brands = [...new Set(Object.values(ENTITIES).flatMap(entity => [...entity.aliases, ...(entity.orgNames ?? [])]))];
const companyRisk = (text: string, extra: readonly string[]) =>
  (negative.test(text) && !negatedRisk.test(text) && (
    /\b(?:we|our (?:displays?|products?|panels?|company|screens?|brand))\b|我们|本公司|我司/.test(text) ||
    [...brands, ...extra].some(name => hasTerm(text, name)))) ||
  (/\b(?:replaced|retired|upgraded|swapped out)\b|替换|更换|淘汰/i.test(text) &&
    /\b(?:old|original|previous|legacy|aging)\b|原屏|老屏|旧屏/i.test(text) &&
    brands.some(name => hasTerm(text, name)));

/** Reuse inquiry redaction only for contact/person data. Source links and company names stay intact. */
function redactContact(text: string) {
  const preserved: string[] = [];
  const marker = (value: string) => '\uE000' + String.fromCharCode(0xE100 + preserved.push(value)) + '\uE001';
  const masked = text
    .replace(/https?:\/\/[^\s<>"']+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/gi,
      (value, offset: number) => text[offset - 1] === '@' ? value : marker(value))
    .replace(/(?:\b(?:company(?: name)?|organization)\b|客户公司|公司(?:名称|名)?|单位)[ \t]*[:：]/gi, marker);
  return redactPitch(masked).text
    .replace(/\uE000([\uE101-\uF8FF])\uE001/g, (value, key: string) => preserved[key.charCodeAt(0) - 0xE101] ?? value)
    .replace(/\[(EMAIL|PHONE|PERSON)\]/g, (_match, kind: string) =>
      kind === 'EMAIL' ? '[email removed]' : kind === 'PHONE' ? '[phone removed]' : '[name removed]');
}

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
const segments = (text: string) => [...segmenter.segment(text)].flatMap(segment =>
  [...segment.segment.matchAll(/[^\n]+/g)].map(m => ({ start: segment.index + m.index, end: segment.index + m.index + m[0].length, text: m[0] })));
const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;
const copiedLength = 26;
const wordKey = (tokens: ReturnType<typeof words>, at: number) =>
  tokens.slice(at, at + copiedLength).map(m => m[0].toLowerCase()).join(' ');
function sourceWindows(sources: readonly Packet['articles'][number][]) {
  const windows = new Set<string>();
  for (const source of sources) {
    const tokens = words(textOf(source.body_text ?? ''));
    for (let i = 0; i <= tokens.length - copiedLength; i++) windows.add(wordKey(tokens, i));
  }
  return windows;
}
function copiedSpans(text: string, windows: Set<string>) {
  const tokens = words(text), ranges: { start: number; end: number }[] = [];
  for (let i = 0; i <= tokens.length - copiedLength; i++) {
    if (!windows.has(wordKey(tokens, i))) continue;
    const first = tokens[i], last = tokens[i + copiedLength - 1];
    const end = last.index + last[0].length;
    const prev = ranges.at(-1);
    if (prev && first.index <= prev.end) prev.end = end;
    else ranges.push({ start: first.index, end });
  }
  return ranges;
}

function attributable(text: string, findings: Finding[], draft: EditorialDraft, packet: Packet) {
  if (findings.some(f => /明确否定|明确禁止|不能人工放行|尚无对应工程确认|没有获得工程确认|不能署名/.test(f.reason))) return null;
  if (/\b(?:we|our|us)\b/i.test(text)) return null;
  const normalized = comparable(text).replace(/[.!?]+$/, '');
  const tokens = [...new Set(words(normalized).map(m => m[0]).filter(w => w.length >= 4))];
  const source = packet.articles.flatMap(article => {
    const name = article.source_name.trim().replace(/\s+(?:Product\s+)?News$/i, '');
    if (!name || /^(?:source|manufacturer|vendor|original source|unknown|imported link|manual)$/i.test(name)) return [];
    const sourceText = textOf((article.body_text ?? '') + '\n' + article.title);
    const evidence = draft.evidence.filter(e => (article.body_text?.includes(e.quote) || article.title.includes(e.quote)) &&
      comparable(e.claim).replace(/[.!?]+$/, '') === normalized).map(e => e.quote);
    const matching = [...evidence, ...segments(sourceText).map(s => s.text)].some(line => {
      const candidate = comparable(line);
      return findings.every(f => candidate.includes(comparable(f.quote))) &&
        (evidence.includes(line) || (tokens.length >= 2 && tokens.filter(t => hasTerm(candidate, t)).length >= Math.max(2, Math.ceil(tokens.length * .65))));
    });
    return matching && !sensitive(name) ? [name] : [];
  });
  const unique = [...new Set(source)];
  return unique.length === 1 ? unique[0] : null;
}

type Part = { start: number; end: number; text: string };
type Edit = { start: number; end: number; value: string };

function htmlText(html: string, keepImages: boolean) {
  const $ = load(sanitizeHtml(html, purifier), {}, false);
  const nodes: (Part & { set: (value: string) => void })[] = [];
  let text = '';
  const newline = () => { if (text && !text.endsWith('\n')) text += '\n'; };
  type Node = ReturnType<ReturnType<typeof load>['root']>[number];
  // Traverse the document once so findings address text even when a sentence spans inline tags.
  const visit = (node: Node['children'][number]) => {
    if (node.type === 'text') {
      nodes.push({ start: text.length, end: text.length + node.data.length, text: node.data, set: value => { node.data = value; } });
      text += node.data;
      return;
    }
    const block = 'name' in node && blocks.has(node.name);
    if (block) newline();
    if ('children' in node) node.children.forEach(visit);
    if (block) newline();
  };
  const root = $.root()[0];
  if (root) visit(root);
  const removedImages = !keepImages && $('img').length > 0;
  if (!keepImages) $('img,picture,source').remove();
  let removedSensitive = false;
  $('*').each((_i, el) => {
    if (!('attribs' in el)) return;
    for (const [attr, value] of Object.entries(el.attribs)) if (sensitive(value)) {
      removedSensitive = true;
      if (el.name === 'img' && attr === 'src') $(el).remove();
      else $(el).removeAttr(attr);
    }
  });
  return { text, removedImages, removedSensitive, apply(edits: Edit[]) {
    for (const node of nodes) {
      let value = node.text;
      for (const edit of edits.toReversed()) {
        if (edit.start === edit.end ? !(edit.start >= node.start && edit.start < node.end) : !overlap(node, edit)) continue;
        const start = Math.max(0, edit.start - node.start), end = Math.min(node.end, edit.end) - node.start;
        value = value.slice(0, start) + (node.start <= edit.start ? edit.value : '') + value.slice(end);
      }
      node.set(value);
    }
    $('a,em,strong,span,p,li,blockquote,h1,h2,h3,h4,h5,h6,figure,figcaption').each((_i, el) => {
      if (!$(el).text().trim() && !$(el).find('img,hr,table').length && !$(el).is('a[id],span[id]')) $(el).remove();
    });
    return $.html().trim();
  } };
}

/** Correction/rollback reuse the same five filters; editorial BLOCK repair is for incoming drafts. */
export function preparePublicationCopy(input: {
  draft: EditorialDraft; packet: Packet; html?: boolean; correction?: boolean; existingUrl?: string;
}) {
  const { draft, packet } = input;
  const rules = companyFactRules().rules;
  const notes = new Map<string, PublicationIssue>();
  const note = (code: string, message: string) => notes.set(code, { code, message });
  const sourceNames = packet.articles.map(a => a.source_name.trim().replace(/\s+(?:Product\s+)?News$/i, '')).filter(Boolean);
  const withheld = packet.pitch?.withheld_numbers.filter(Boolean) ?? [];
  const fakeEngineer = packet.pitch?.engineer.mode !== 'engineer' || !packet.pitch.engineer.answers.length;
  const noConfirm = rules.filter(rule => rule.action === 'confirm' &&
    !packet.pitch?.engineer.answers.some(answer => packet.pitch?.engineer.mode === 'engineer' && answer.question_id === 'fact-' + rule.id && answer.choice !== 'A'));
  // A verbatim paragraph from the authorized page being updated is the site's own text.
  const ownHost = input.existingUrl && new URL(input.existingUrl).hostname.replace(/^www\./, '');
  const sources = packet.articles.filter(a => !ownHost || new URL(a.binding.url).hostname.replace(/^www\./, '') !== ownHost);
  const windows = sourceWindows(sources);
  const rendered = input.html ? draft.body_en : marked.parse(draft.body_en, { async: false });
  const body = htmlText(rendered, !!input.correction);
  if (body.removedImages) note('original_image', '已移除未核验的原始图片。');
  if (body.removedSensitive) note('secret', '已移除密钥或内部地址。');
  const plain = { ...draft, body_en: body.text };
  const gate = input.correction ? [] : evaluateDraft(
    { ...packet, ...(packet.pitch ? { pitch: { ...packet.pitch, fragments_plan: undefined } } : {}) }, plain,
  ).findings.filter(f => f.severity === 'BLOCK' && /^D(?:[1-9]|10)$/.test(f.ruleId));

  function edit(text: string, field: 'body_en' | 'title_en' | 'meta_description_en') {
    const copies = copiedSpans(text, windows);
    const keys = [...text.matchAll(keyBlock)].map(m => ({ start: m.index, end: m.index + m[0].length }));
    let removed = 0;
    const changes: Edit[] = [];
    for (const span of segments(text)) {
      const value = span.text.trim();
      if (!value) continue;
      const deny = rules.some(r => r.action === 'deny' && comparable(value).includes(comparable(r.match)));
      const risk = companyRisk(value, sourceNames);
      const copied = copies.some(copy => overlap(span, copy));
      const privateValue = sensitive(value) || keys.some(key => overlap(span, key));
      const unsigned = fakeEngineer && /(?:reviewed|approved|verified|validated|signed off)\s+by\s+(?:the\s+)?(?:Chipshow\s+)?engineering(?:\s+team)?|齐普工程(?:团队|师)(?:审核|审阅|确认)/i.test(value);
      const unconfirmed = !input.correction && (withheld.some(n => hasTerm(value, n)) ||
        noConfirm.some(r => comparable(value).includes(comparable(r.match))));
      const hits = gate.filter(f => f.field === field && overlap(span, f));
      const name = !deny && !risk && !copied && !privateValue && !unsigned && !unconfirmed && hits.length
        ? attributable(value, hits, draft, packet) : null;
      if (deny) note('company_deny', '已移除公司禁止项。');
      if (risk) note('risk_list_v2', '已移除点名贬损或旧屏原厂的内容。');
      if (copied) note('copy', '已移除与原文连续相同超过 25 个英文词的内容。');
      if (privateValue) note('secret', '已移除密钥或内部地址。');
      if (unsigned || unconfirmed) note('unconfirmed', '已移除未经工程确认的表述或署名。');
      if (hits.length) note('editorial_block', '已按出处归属或移除需要处理的句子。');
      if (deny || risk || copied || privateValue || unsigned || unconfirmed || (hits.length && !name)) {
        changes.push({ ...span, value: '' });
        removed += value.replace(/\s/g, '').length;
        continue;
      }
      const cleaned = redactContact(value);
      const start = span.start + span.text.indexOf(value);
      if (cleaned !== value) {
        note('privacy', '已替换个人联系方式或姓名。');
        // Keep formatting and links on either side of the private detail.
        let left = 0, right = 0;
        while (left < value.length && left < cleaned.length && value[left] === cleaned[left]) left++;
        while (right < value.length - left && right < cleaned.length - left && value.at(-1 - right) === cleaned.at(-1 - right)) right++;
        changes.push({ start: start + left, end: start + value.length - right, value: (left === 0 && name ? name + ' says: ' : '') + cleaned.slice(left, cleaned.length - right) });
        if (left !== 0 && name) changes.push({ start, end: start, value: name + ' says: ' });
      } else if (name) changes.push({ start, end: start, value: name + ' says: ' });
    }
    return { changes: changes.sort((a, b) => a.start - b.start), removed };
  }
  const flatten = (text: string, field: 'title_en' | 'meta_description_en') => {
    let value = text;
    for (const e of edit(text, field).changes.toReversed()) value = value.slice(0, e.start) + e.value + value.slice(e.end);
    return value.trim();
  };
  let title = flatten(draft.title_en, 'title_en');
  let description = flatten(draft.meta_description_en, 'meta_description_en');
  const edited = edit(body.text, 'body_en');
  const html = body.apply(edited.changes);
  const characters = body.text.replace(/\s/g, '').length;
  const retained = characters ? Math.max(0, 1 - edited.removed / characters) : 0;
  const news = publicationStatus(draft);
  if (!input.correction && news === 'unconfirmed') {
    if (title && !/^unconfirmed report:/i.test(title)) title = 'Unconfirmed report: ' + title;
    if (description && !/^unconfirmed report[.:]/i.test(description)) description = 'Unconfirmed report. ' + description;
  }
  if (!title && html) title = 'Industry update';
  return { title, description, html, retained, issues: [...notes.values()] };
}
