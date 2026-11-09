import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { Packet } from '../../../../scripts/editorial-pilot-lib.ts';
import type { EditorialDraft, EditorialIssue, EditorialIssues } from './editorial-issues.ts';
import { assembleFragments } from './studio-pitch-fragments.ts';

export type ReviewEdit = {
  id: string; issueId: string; fingerprint: string;
  field: 'body_en'; start: number; end: number; before: string; after: string;
  label: string; explanation: string;
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const englishReviewHash = (draft: Pick<EditorialDraft, 'title_en' | 'body_en' | 'meta_description_en'>) =>
  hash([draft.title_en, draft.body_en, draft.meta_description_en]);

/** Suggestions remove an unsupported sentence. They never invent test conditions, numbers or approval.
 * HTML parser offsets preserve every unrelated byte, including original-page kept paragraphs.
 */
function sentenceAt(body: string, start: number, end: number) {
  let left = 0, right = body.length;
  if (/<[a-z][\s\S]*>/i.test(body)) {
    const $ = load(body, { sourceCodeLocationInfo: true }, false);
    let range: { start: number; end: number } | undefined;
    const visit = (node: AnyNode) => {
      const loc = node.sourceCodeLocation;
      if (node.type === 'text' && loc && loc.startOffset <= start && loc.endOffset >= end &&
        !$(node).parents('a,table,figure,pre,code,h1,h2,h3,h4,h5,h6,strong,em,span,b,i,u,s,small,mark,sub,sup').length &&
        !node.parent?.children.some(sibling=>'name' in sibling)) {
        range = { start: loc.startOffset, end: loc.endOffset };
      }
      if ('children' in node) node.children.forEach(visit);
    };
    $.root().contents().each((_i, node) => visit(node));
    if (!range) return null;
    left = range.start; right = range.end;
  } else {
    left = body.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = body.indexOf('\n', end);
    right = lineEnd < 0 ? body.length : lineEnd;
    if (/^\s*(?:#{1,6}\s|[|>]|```)/.test(body.slice(left, right))) return null;
  }
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  for (const part of segmenter.segment(body.slice(left, right))) {
    const a = left + part.index, b = a + part.segment.length;
    if (a <= start && b >= end) {
      const text = body.slice(a, b);
      // A sentence split across inline elements or a source link needs a deliberate manual edit.
      if (/<|>|&[a-z#\d]+;|https?:\/\/|\[[^\]]*\]\(|^\s*[-*+]\s/.test(text)) return null;
      if (text.trim().length < 8 || text.length > 1200) return null;
      return { start: a, end: b, text };
    }
  }
  return null;
}

function editedFragmentPacket(packet: Packet, draft: EditorialDraft, start: number, end: number, after: string): Packet | null {
  const plan = packet.pitch?.fragments_plan;
  if (!plan?.fragments) return packet;
  const assembled = assembleFragments(plan.paragraphs, plan.edit_plan, plan.fragments);
  if (!assembled.complete || assembled.html_en !== draft.body_en) return null;
  let at = 0;
  for (const row of assembled.diff) {
    const next = at + row.after.length;
    if (start >= at && end <= next) {
      if (row.op === 'keep') return null;
      const fragment = plan.fragments.find(f => f.op_index === row.op_index);
      if (!fragment || typeof fragment.html_en !== 'string' || !fragment.html_en) return null;
      // reviseHtml keeps the original block's wrapper/edge whitespace outside the raw fragment.
      // Edit the exact inner fragment only; writing row.after back would add that wrapper twice.
      const inner = row.after.indexOf(fragment.html_en);
      if (inner < 0 || row.after.lastIndexOf(fragment.html_en) !== inner) return null;
      const from = start - at - inner, to = end - at - inner;
      if (from < 0 || to > fragment.html_en.length) return null;
      const fragments = plan.fragments.map(f => f.op_index === row.op_index ? { ...f,
        html_en: fragment.html_en!.slice(0, from) + after + fragment.html_en!.slice(to) } : f);
      const expected = draft.body_en.slice(0, start) + after + draft.body_en.slice(end);
      // An empty fragment would be treated as pending by assembly and restore the old paragraph.
      if (assembleFragments(plan.paragraphs, plan.edit_plan, fragments).html_en !== expected) return null;
      return { ...packet, pitch: { ...packet.pitch!, fragments_plan: { ...plan, fragments } } };
    }
    at = next;
  }
  return null;
}

export function reviewEditSuggestions(packet: Packet, draft: EditorialDraft, issues: EditorialIssues): ReviewEdit[] {
  const result: ReviewEdit[] = [];
  for (const issue of issues.items) {
    // Source-only warnings, Chinese notes and ambiguous whole-document checks cannot be auto-rewritten.
    if (!['D1','D2','D3','D5','D6','D7','D8','D9','W4'].includes(issue.ruleId)) continue;
    const seen = new Set<string>();
    for (const finding of issue.occurrences) {
      if (finding.field !== 'body_en') continue;
      const range = sentenceAt(draft.body_en, finding.start, finding.end);
      if (!range || !editedFragmentPacket(packet, draft, range.start, range.end, '')) continue;
      const proposed = draft.body_en.slice(0, range.start) + draft.body_en.slice(range.end);
      const prose = load(proposed, {}, false).text().replace(/https?:\/\/\S+/g, '').trim();
      if (prose.length < 40 || !proposed.includes(draft.source.url)&&!(packet.pitch?.fragments_plan&&packet.pitch.output_type==='update')) continue;
      const key = `${range.start}:${range.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const data = { issueId: issue.id, fingerprint: issue.fingerprint, field: 'body_en' as const,
        start: range.start, end: range.end, before: range.text, after: '' };
      result.push({ ...data, id: hash(data), label: '采纳修改：删去这句待核实表述',
        explanation: '只删除下方英文句子，不补造参数或条件。保存后重新检查全部问题；中文对照会标为旧版。' });
    }
  }
  return result;
}

export function applyReviewEdit(packet: Packet, draft: EditorialDraft, issues: EditorialIssues,
  input: { issueId: string; fingerprint: string; suggestionId: string }) {
  const issue: EditorialIssue | undefined = issues.items.find(i => i.id === input.issueId && i.fingerprint === input.fingerprint);
  const edit = issue && reviewEditSuggestions(packet, draft, issues).find(e => e.issueId === issue.id && e.id === input.suggestionId);
  if (!edit || draft.body_en.slice(edit.start, edit.end) !== edit.before) {
    throw Error('修改建议与当前英文版本不一致，请刷新后核对。');
  }
  const body = draft.body_en.slice(0, edit.start) + edit.after + draft.body_en.slice(edit.end);
  const updated = { ...draft, body_en: body };
  const updatedPacket = editedFragmentPacket(packet, draft, edit.start, edit.end, edit.after);
  if (!updatedPacket) throw Error('此建议超出已批准的修改段落，未改变原页保留段。');
  return { draft: updated, packet: updatedPacket, edit };
}
