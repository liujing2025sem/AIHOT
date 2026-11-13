import { createHash } from 'node:crypto';
import type { Packet, Response } from '../../../../scripts/editorial-pilot-lib.ts';
import type { Finding, GateReport } from './editorial-gate.ts';

export type EditorialDraft = Response['drafts'][number];
export type EditorialConfirmation = { issueId: string; fingerprint: string };
export type EditorialIssue = {
  id: string; fingerprint: string; ruleId: string; severity: Finding['severity'];
  kind: 'finding' | 'mandatory-review'; title: string;
  wordByWord?: boolean;
  group: 'required' | 'recommended'; requiredForApproval: true; confirmable: boolean;
  object: { kind: 'source' | 'draft' | 'quote' | 'occurrence'; key: string; label: string };
  source: EditorialDraft['source'];
  /** Every input finding survives, including repeated identical records. UTF-16 [start,end). */
  occurrences: (Finding & { context: { field: string; text: string } })[];
  count: number;
};
export type EditorialIssues = {
  version: string; items: EditorialIssue[];
  summary: {
    blocked: boolean; issueCount: number; findingCount: number; blockCount: number; warningCount: number;
    blockIssueCount: number; warningIssueCount: number; mandatoryReviewCount: number;
    requiredCount: number; recommendedCount: number; requiredConfirmationCount: number;
  };
};
export type EditorialConfirmationError = {
  code: 'invalid-input' | 'unknown-issue' | 'stale-fingerprint' | 'block-not-confirmable';
  issueId?: string;
};
export type EditorialApprovalCheck = {
  canApprove: boolean; confirmed: EditorialConfirmation[]; missingIssueIds: string[];
  blockedIssueIds: string[]; errors: EditorialConfirmationError[];
};

const VERSION = 'editorial-issues/1';
const groupedRules = new Set(['W1', 'W2', 'W5', 'W7', 'W8']);
// Display priority only: every WARN in either group requires its own confirmation.
const recommendedRules = new Set(['W1', 'W2', 'W5', 'W6', 'W8']);
const manualReviews: Record<string, string> = {
  D5: '认证资质：逐字核对声明主体、标准、适用范围和可信核验记录。',
  D6: '价格交期质保：逐字核对对象、日期、条件和可信商务记录。',
  D8: '客户案例：逐字核对客户/项目身份、披露范围和授权记录。',
  W5: '新领域首篇：逐字核对主题、应用边界和事实归属。',
};
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
// Sorted object keys make identities independent of JS property insertion order.
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter(k => record[k] !== undefined).sort(compare)
      .map(k => `${JSON.stringify(k)}:${stable(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
const hash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');
// Do not lowercase numbers/units or names: mW and MW are different objects.
const normalizedQuote = (quote: string) => quote.normalize('NFKC').replace(/\s+/gu, ' ').trim();

function fieldText(draft: EditorialDraft, source: string, field: string, packet?:Packet): string {
  if (field === 'source.body_text') return source;
  const sourceId=/^source\[([^\]]+)\]\.body_text$/.exec(field)?.[1];
  if(sourceId&&packet){
    const article=packet.articles.find(a=>a.binding.article_id===sourceId);
    if(article)return article.body_text??'';
  }
  if (Object.hasOwn(draft, field) && typeof draft[field as keyof EditorialDraft] === 'string') {
    return draft[field as keyof EditorialDraft] as string;
  }
  throw Error(`Use a per-draft GateReport from evaluateDraft; unsupported field: ${field}`);
}
function paragraph(text: string, start: number, end: number): { text: string; start: number } {
  const breaks = [...text.matchAll(/\r?\n[\t ]*\r?\n/g)];
  let left = 0, right = text.length;
  for (const boundary of breaks) {
    if (boundary.index! + boundary[0].length <= start) left = boundary.index! + boundary[0].length;
    else if (boundary.index! >= end) { right = boundary.index!; break; }
  }
  return { text: text.slice(left, right), start: left };
}
function objectFor(f: Finding, text: string): EditorialIssue['object'] {
  if (groupedRules.has(f.ruleId)) {
    const kind = f.ruleId === 'W1' ? 'source' : 'draft';
    return { kind, key: kind, label: kind === 'source' ? '当前来源' : '当前稿件' };
  }
  const quote = normalizedQuote(f.quote);
  if (f.ruleId === 'W6' || f.ruleId === 'D4' || f.ruleId === 'W3') {
    return { kind: 'quote', key: quote, label: quote };
  }
  if (f.ruleId === 'W4') {
    // An explicitly named model's table row/paragraph is one missing-conditions task.
    // Different model rows and different condition text remain different objects.
    const lineStart=text.lastIndexOf('\n',f.start-1)+1;
    const lineEnd=text.indexOf('\n',f.end);
    const line=text.slice(lineStart,lineEnd<0?text.length:lineEnd);
    const models=[...line.matchAll(/\b(?:[A-Z]{1,6}-?\d{3,}[\w-]*|\d{3,}-[A-Z][\w-]*)\b/g)].map(m=>m[0]);
    if(models.length)return {kind:'quote',key:stable(['model-spec-row',[...new Set(models)].sort(),line.trim()]),label:`${[...new Set(models)].join(' / ')} 参数的测试条件`};
    // A number alone cannot identify its metric. Distinguish positions inside a paragraph;
    // only the same position in an exact repeated paragraph shares the object identity.
    const context = paragraph(text, f.start, f.end);
    return { kind: 'quote', key: stable([quote, context.text, f.start - context.start]), label: quote };
  }
  if(f.ruleId==='D8'&&f.severity==='WARN'&&/^(客户|项目|案例|customer|client|project|case study)$/i.test(quote))return {kind:'draft',key:'customer-disclosure-scope',label:'本稿客户/项目披露范围与授权'};
  if(f.ruleId==='D9')return {kind:'quote',key:stable([f.field,paragraph(text,f.start,f.end).text]),label:'同一统计段落的来源、期间与定义'};
  // Unknown rules/objects never get a guessed shared identity. Only identical findings coalesce.
  return { kind: 'occurrence', key: stable(f), label: quote };
}

/** Pure, per-draft projection; does not evaluate rules, approve, store, or call services.
 * Pass evaluateDraft(packet,draft,context), NOT the multi-draft editorialGate report.
 * IDs identify an object within a task/source. Fingerprints additionally bind the gate version,
 * both source bindings, actual source text/title/status and the complete draft/conditions.
 * Conservatively, any draft edit invalidates its confirmations (even an edit outside the hit).
 */
export function buildEditorialIssues(packet: Packet, draft: EditorialDraft, gate: GateReport): EditorialIssues {
  const articles = packet.articles.filter(a => a.binding.article_id === draft.source.article_id);
  if (articles.length !== 1 || stable(articles[0].binding) !== stable(draft.source)) {
    throw Error('Source version mismatch: rebuild the draft/gate against the current packet');
  }
  const article = articles[0];
  const scope = hash({ version: VERSION, gateVersion: gate.version, taskId: packet.task_id,
    createdAt: packet.created_at, writing: packet.writing, methods: packet.methods, article,
    ...(draft.brief?{articles:packet.articles}:{}),draft });
  const buckets = new Map<string, EditorialIssue>();
  for (const finding of gate.findings) {
    const text = fieldText(draft, article.body_text ?? '', finding.field,packet);
    if (!Number.isInteger(finding.start) || !Number.isInteger(finding.end) || finding.start < 0
      || finding.end <= finding.start || finding.end > text.length
      || text.slice(finding.start, finding.end) !== finding.quote) {
      throw Error(`Finding no longer matches current text: ${finding.ruleId} ${finding.field}`);
    }
    const object = objectFor(finding, text);
    const sourceId=/^source\[([^\]]+)\]\.body_text$/.exec(finding.field)?.[1];
    const findingSource=sourceId?packet.articles.find(a=>a.binding.article_id===sourceId)!.binding:draft.source;
    const identity = [packet.task_id, findingSource.article_id, 'finding', finding.ruleId, finding.severity, object];
    const id = `issue-${hash(identity)}`;
    let item = buckets.get(id);
    if (!item) {
      item = { id, fingerprint: '', ruleId: finding.ruleId, severity: finding.severity, kind: 'finding',
        title: `${finding.ruleId} · ${object.label}`, group: finding.severity === 'BLOCK' || !recommendedRules.has(finding.ruleId) ? 'required' : 'recommended',
        requiredForApproval: true, confirmable: finding.severity === 'WARN', object, source: { ...findingSource }, occurrences: [], count: 0 };
      buckets.set(id, item);
    }
    item.occurrences.push({ ...finding, context: { field: finding.field, text } });
    item.count++;
  }
  // Four sensitive categories get a distinct word-by-word task when the gate requests it.
  // Preserve future/unknown mandatory requests as well, even if no finding was supplied.
  for (const ruleId of [...new Set(gate.mandatoryReview)].sort(compare)) {
    if (!Object.hasOwn(manualReviews, ruleId) && gate.findings.some(f => f.ruleId === ruleId)) continue;
    const related=[...buckets.values()].filter(i=>i.ruleId===ruleId);
    if(Object.hasOwn(manualReviews,ruleId)&&related.length){
      for(const item of related){item.wordByWord=true;item.group='required';item.title+=` · ${manualReviews[ruleId]}`;}
      continue;
    }
    const id = `issue-${hash([packet.task_id, draft.source.article_id, 'mandatory-review', ruleId])}`;
    const occurrences = [...buckets.values()].filter(i => i.ruleId === ruleId).flatMap(i => i.occurrences)
      .map(o => ({ ...o, context: { ...o.context } }));
    buckets.set(id, { id, fingerprint: '', ruleId, severity: 'WARN', kind: 'mandatory-review',
      title: Object.hasOwn(manualReviews, ruleId) ? manualReviews[ruleId] : `${ruleId}：按门槛要求逐字人工核对。`,
      group: 'required', requiredForApproval: true, confirmable: true,
      object: { kind: 'draft', key: ruleId, label: '逐字人工检查' }, source: { ...draft.source }, occurrences, count: occurrences.length });
  }
  const items = [...buckets.values()];
  for (const item of items) {
    item.occurrences.sort((a, b) => compare(stable(a), stable(b)));
    item.fingerprint = hash([scope, item.id, item.occurrences, [...new Set(gate.mandatoryReview)].sort(compare)]);
  }
  items.sort((a, b) => Number(b.severity === 'BLOCK') - Number(a.severity === 'BLOCK')
    || compare(a.group, b.group) * -1 || compare(a.ruleId, b.ruleId) || compare(a.id, b.id));
  const blockCount = gate.findings.filter(f => f.severity === 'BLOCK').length;
  return { version: VERSION, items, summary: {
    blocked: gate.blocked || blockCount > 0, issueCount: items.length, findingCount: gate.findings.length,
    blockCount, warningCount: gate.findings.length - blockCount,
    blockIssueCount: items.filter(i => i.severity === 'BLOCK').length,
    warningIssueCount: items.filter(i => i.severity === 'WARN').length,
    mandatoryReviewCount: items.filter(i => i.kind === 'mandatory-review'||i.wordByWord).length,
    requiredCount: items.filter(i => i.group === 'required').length,
    recommendedCount: items.filter(i => i.group === 'recommended').length,
    requiredConfirmationCount: items.filter(i => i.confirmable).length,
  } };
}

/** input = { confirmations: [{issueId,fingerprint}, ...] }; total booleans are rejected.
 * existing must come from caller-owned, previously accepted audit records, never generated prose.
 * Rebuild issues on the server immediately before calling this function, including at export.
 * A matching fingerprint binds the review version; the caller authenticates the human reviewer.
 * This is only the risk-confirmation condition, not business approval/publication authority.
 */
export function validateEditorialConfirmations(
  issues: EditorialIssues, input: unknown, existing: readonly EditorialConfirmation[] = [],
): EditorialApprovalCheck {
  const errors: EditorialConfirmationError[] = [];
  const confirmed = new Map<string, EditorialConfirmation>();
  const byId = new Map(issues.items.map(i => [i.id, i]));
  const accept = (records: unknown) => {
    if (!Array.isArray(records)) { errors.push({ code: 'invalid-input' }); return; }
    for (const record of records) {
      if (!record || typeof record !== 'object' || Array.isArray(record)
        || Object.keys(record).some(k => k !== 'issueId' && k !== 'fingerprint')
        || typeof record.issueId !== 'string' || typeof record.fingerprint !== 'string') {
        errors.push({ code: 'invalid-input' }); continue;
      }
      const issue = byId.get(record.issueId);
      if (!issue) { errors.push({ code: 'unknown-issue', issueId: record.issueId }); continue; }
      if (issue.severity === 'BLOCK' || !issue.confirmable) {
        errors.push({ code: 'block-not-confirmable', issueId: issue.id }); continue;
      }
      if (record.fingerprint !== issue.fingerprint) {
        errors.push({ code: 'stale-fingerprint', issueId: issue.id }); continue;
      }
      confirmed.set(issue.id, { issueId: issue.id, fingerprint: issue.fingerprint });
    }
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(k => k !== 'confirmations') || !Object.hasOwn(input, 'confirmations')) {
    errors.push({ code: 'invalid-input' });
  } else accept((input as { confirmations: unknown }).confirmations);
  accept(existing);
  const blockedIssueIds = issues.items.filter(i => i.severity === 'BLOCK').map(i => i.id);
  const missingIssueIds = issues.items.filter(i => i.severity === 'WARN' && !confirmed.has(i.id)).map(i => i.id);
  return { canApprove: !issues.summary.blocked && blockedIssueIds.length === 0 && missingIssueIds.length === 0 && errors.length === 0,
    confirmed: [...confirmed.values()].sort((a, b) => compare(a.issueId, b.issueId)),
    missingIssueIds, blockedIssueIds, errors };
}
