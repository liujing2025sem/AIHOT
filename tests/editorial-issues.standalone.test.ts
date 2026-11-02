import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Packet } from '../scripts/editorial-pilot-lib.ts';
import { evaluateDraft, type Finding, type GateReport } from '../packages/backend/src/admin/editorial-gate.ts';
import { buildEditorialIssues, validateEditorialConfirmations, type EditorialDraft, type EditorialIssues } from '../packages/backend/src/admin/editorial-issues.ts';

function fixture(body = 'Maker reports 5000 nits.\n\nMaker reports 6000 nits.') {
  const binding = { article_id: 'source-1', revision: 1, content_sha256: 'a'.repeat(64), url: 'https://maker.example/news', published_at: '2026-10-31T00:00:00Z' };
  const packet: Packet = { schema: 'aihot-editorial-pilot/1', task_id: 'issues-task', created_at: '2026-11-01T00:00:00Z',
    scope: 'LOCAL_AGENT_HANDOFF_NOT_AUTOMATED_AIHOT_PIPELINE', draft_article_ids: ['source-1'],
    articles: [{ binding: { ...binding }, source_id: 'maker', source_name: 'Maker', title: 'Outdoor components', body_status: 'ok', body_text: 'At 25°C, Maker reports 5000 nits for outdoor components.' }] };
  const draft: EditorialDraft = { source: { ...binding }, title_zh: '户外器件', review_zh: '原厂称户外器件可达5000 nits。', title_en: 'Outdoor components', body_en: body,
    evidence: [{ claim: 'Manufacturer figure', quote: 'Maker reports 5000 nits' }], questions_zh: ['是否适用？'], keyword_hypothesis: 'outdoor components', meta_description_en: 'Manufacturer component reference.' };
  const hit = (ruleId: string, quote: string, field = 'body_en', severity: Finding['severity'] = 'WARN', from = 0): Finding => {
    const text = field === 'source.body_text' ? packet.articles[0].body_text! : draft[field as 'body_en'];
    const start = text.indexOf(quote, from); assert.ok(start >= 0, quote);
    return { ruleId, quote, field, severity, start, end: start + quote.length, reason: `${ruleId} needs review` };
  };
  return { packet, draft, hit };
}
const report = (findings: Finding[], mandatoryReview: string[] = []): GateReport => ({ version: 'editorial-gate/1', blocked: findings.some(f => f.severity === 'BLOCK'), findings, mandatoryReview });
const receipts = (issues: EditorialIssues) => issues.items.filter(i => i.confirmable).map(i => ({ issueId: i.id, fingerprint: i.fingerprint }));
const approve = (issues: EditorialIssues) => validateEditorialConfirmations(issues, { confirmations: receipts(issues) });

test('numbers, units, terms and names keep different objects; unknown rules do not guess identity', () => {
  const f = fixture('Maker reports 5000 nits and 6000 nits. MiP and COB. 5 mW and 5 MW. 星光大学与星河大学。 mystery mystery');
  const findings = [f.hit('W4', '5000 nits'), f.hit('W4', '6000 nits'), f.hit('W4', '5 mW'), f.hit('W4', '5 MW'),
    f.hit('W6', 'MiP'), f.hit('W6', 'COB'), f.hit('D4', '星光大学'), f.hit('D4', '星河大学'),
    f.hit('future-rule', 'mystery'), f.hit('future-rule', 'mystery', 'body_en', 'WARN', f.draft.body_en.indexOf('mystery') + 1)];
  const issues = buildEditorialIssues(f.packet, f.draft, report(findings));
  assert.equal(issues.items.length, findings.length);
  assert.equal(issues.summary.findingCount, findings.length);
  assert.equal(approve(issues).canApprove, true);
  const sameValue = fixture('Component brightness is 5000 nits; screen brightness is 5000 nits.');
  const first = sameValue.hit('W4', '5000 nits');
  const second = sameValue.hit('W4', '5000 nits', 'body_en', 'WARN', first.end);
  assert.equal(buildEditorialIssues(sameValue.packet, sameValue.draft, report([first, second])).items.length, 2);
});

test('repeated objects aggregate every location/count; equal numbers with different conditions stay separate', () => {
  const sentence = 'Maker reports 5000 nits.';
  const f = fixture(`${sentence}\n\n${sentence}\n\nAt 60°C, Maker reports 5000 nits. MiP MiP`);
  const first = f.hit('W4', '5000 nits');
  const second = f.hit('W4', '5000 nits', 'body_en', 'WARN', sentence.length);
  const different = f.hit('W4', '5000 nits', 'body_en', 'WARN', sentence.length * 2 + 4);
  const term = f.hit('W6', 'MiP');
  const term2 = f.hit('W6', 'MiP', 'body_en', 'WARN', term.end);
  const gate = report([first, second, first, different, term, term2]);
  const original = structuredClone(gate);
  const issues = buildEditorialIssues(f.packet, f.draft, gate);
  const numbers = issues.items.filter(i => i.ruleId === 'W4');
  assert.equal(numbers.length, 2);
  assert.deepEqual(numbers.map(i => i.count).sort(), [1, 3]);
  assert.equal(issues.items.find(i => i.ruleId === 'W6')!.count, 2);
  assert.deepEqual(issues.items.flatMap(i => i.occurrences).map(({ context: _, ...finding }) => finding)
    .sort((a, b) => a.start - b.start), [...gate.findings].sort((a, b) => a.start - b.start));
  assert.equal(numbers.find(i => i.count === 3)!.occurrences[0].context.text, f.draft.body_en);
  assert.deepEqual(gate, original);
});

test('all BLOCKs survive, cannot be confirmed, and even an inconsistent blocked flag cannot bypass them', () => {
  const f = fixture('We have 5000 nits, best, CE, guaranteed delivery.');
  const gate = report([f.hit('D1', '5000 nits', 'body_en', 'BLOCK'), f.hit('D2', 'best', 'body_en', 'BLOCK'),
    f.hit('D5', 'CE', 'body_en', 'BLOCK'), f.hit('D6', 'delivery', 'body_en', 'BLOCK'), f.hit('W2', 'We')]);
  gate.blocked = false;
  const issues = buildEditorialIssues(f.packet, f.draft, gate);
  assert.equal(issues.summary.blockCount, 4);
  assert.equal(issues.items.filter(i => !i.confirmable).flatMap(i => i.occurrences).length, 4);
  assert.equal(approve(issues).canApprove, false);
  const bypass = validateEditorialConfirmations(issues, { confirmations: issues.items.map(i => ({ issueId: i.id, fingerprint: i.fingerprint })) });
  assert.equal(bypass.canApprove, false);
  assert.equal(bypass.errors.filter(e => e.code === 'block-not-confirmable').length, 4);
  const flagOnly = buildEditorialIssues(f.packet, f.draft, { ...report([]), blocked: true });
  assert.equal(approve(flagOnly).canApprove, false);
});

test('every WARN needs a versioned per-issue confirmation, including recommended items and lists longer than five', () => {
  const f = fixture('5000 nits MiP COB 星光大学');
  const gate = report(['W1', 'W2', 'W5', 'W7', 'W8'].map(rule => f.hit(rule, '5000 nits'))
    .concat(f.hit('W4', '5000 nits'), f.hit('W6', 'MiP'), f.hit('W6', 'COB'), f.hit('D4', '星光大学')));
  const issues = buildEditorialIssues(f.packet, f.draft, gate);
  assert.equal(issues.items.length, 9);
  assert.ok(issues.items.every(i => i.requiredForApproval));
  assert.ok(issues.items.some(i => i.group === 'recommended'));
  for (const input of [true, { confirm_warnings: true, confirm_mandatory: true }, { confirmations: true }, { confirmations: [] }]) {
    assert.equal(validateEditorialConfirmations(issues, input).canApprove, false);
  }
  const all = receipts(issues);
  for (let index = 0; index < all.length; index++) {
    assert.equal(validateEditorialConfirmations(issues, { confirmations: all.filter((_, i) => i !== index) }).canApprove, false);
  }
  assert.equal(approve(issues).canApprove, true);
  assert.equal(validateEditorialConfirmations(issues, { confirmations: [] }, all).canApprove, true);
  const bad = validateEditorialConfirmations(issues, { confirmations: [...all, { issueId: 'unknown', fingerprint: 'x' }] });
  assert.equal(bad.canApprove, false);
  assert.ok(bad.errors.some(e => e.code === 'unknown-issue'));
  const clean = buildEditorialIssues(f.packet, f.draft, report([]));
  assert.equal(validateEditorialConfirmations(clean, true).canApprove, false);
  assert.equal(validateEditorialConfirmations(clean, { confirmations: [], confirm_warnings: true }).canApprove, false);
  assert.equal(approve(clean).canApprove, true);
});

test('source identity/version/date/content and draft conditions invalidate old confirmations despite identical hit text', () => {
  const f = fixture('At 25°C, Maker reports 5000 nits.');
  const gate = report([f.hit('W4', '5000 nits'), f.hit('W6', 'Maker')]);
  const initial = buildEditorialIssues(f.packet, f.draft, gate);
  const original = structuredClone({ packet: f.packet, draft: f.draft });
  const changes: ((p: Packet, d: EditorialDraft) => void)[] = [
    (p, d) => { p.articles[0].binding.revision++; d.source.revision++; },
    (p, d) => { p.articles[0].binding.content_sha256 = d.source.content_sha256 = 'b'.repeat(64); },
    (p, d) => { p.articles[0].binding.url = d.source.url = 'https://maker.example/revised'; },
    (p, d) => { p.articles[0].binding.published_at = d.source.published_at = '2026-10-30T00:00:00Z'; },
    (p, d) => { p.articles[0].binding.article_id = d.source.article_id = 'source-2'; },
    p => { p.articles[0].body_text = p.articles[0].body_text!.replace('25°C', '60°C'); },
    (_, d) => { d.body_en = d.body_en.replace('25°C', '60°C'); },
    (_, d) => { d.review_zh += '仅适用特定扫描条件。'; },
    p => { p.created_at = '2026-12-01T00:00:00Z'; },
  ];
  for (const change of changes) {
    const packet = structuredClone(f.packet), draft = structuredClone(f.draft);
    change(packet, draft);
    const updated = buildEditorialIssues(packet, draft, gate);
    assert.ok(updated.items.every(i => !initial.items.some(old => old.fingerprint === i.fingerprint)));
    const check = validateEditorialConfirmations(updated, { confirmations: [] }, receipts(initial));
    assert.equal(check.canApprove, false);
    assert.ok(check.errors.some(e => e.code === 'stale-fingerprint' || e.code === 'unknown-issue'));
    assert.equal(approve(updated).canApprove, true);
  }
  assert.deepEqual(f.packet, original.packet); assert.deepEqual(f.draft, original.draft);
  const stalePacket = structuredClone(f.packet); stalePacket.articles[0].binding.revision++;
  assert.throws(() => buildEditorialIssues(stalePacket, f.draft, gate), /Source version mismatch/);
});

test('four sensitive checks stay explicit without a duplicate checkbox; absent findings keep standalone tasks', () => {
  const f = fixture('CE delivery customer outdoor');
  const gate = report([f.hit('D5', 'CE'), f.hit('D6', 'delivery'), f.hit('D8', 'customer'), f.hit('W5', 'outdoor')], ['D5', 'D6', 'D8', 'W5']);
  const issues = buildEditorialIssues(f.packet, f.draft, gate);
  assert.equal(issues.summary.mandatoryReviewCount, 4);
  assert.equal(issues.summary.requiredConfirmationCount, 4);
  assert.ok(issues.items.every(i=>i.wordByWord));
  assert.equal(validateEditorialConfirmations(issues, { confirmations: [] }).missingIssueIds.length, 4);
  assert.equal(approve(issues).canApprove, true);
  const alone = buildEditorialIssues(f.packet, f.draft, report([], ['D5', 'D6', 'D8', 'W5', 'future-review']));
  assert.equal(alone.items.length, 5);
  assert.equal(validateEditorialConfirmations(alone, { confirmations: [] }).canApprove, false);
  assert.equal(approve(alone).canApprove, true);
});

test('same input gives identical deterministic output; source offsets and gate version are bound', () => {
  const f = fixture();
  const gate = report([f.hit('W3', 'Maker', 'source.body_text'), f.hit('W2', '5000 nits')], ['W2']);
  const initial = buildEditorialIssues(f.packet, f.draft, gate);
  assert.deepEqual(buildEditorialIssues(f.packet, f.draft, gate), initial);
  assert.deepEqual(buildEditorialIssues(structuredClone(f.packet), structuredClone(f.draft), { ...gate, findings: [...gate.findings].reverse() }), initial);
  const changed = buildEditorialIssues(f.packet, f.draft, { ...gate, version: 'editorial-gate/2' });
  assert.equal(validateEditorialConfirmations(changed, { confirmations: receipts(initial) }).canApprove, false);
  const source = initial.items.find(i => i.ruleId === 'W3')!.occurrences[0];
  assert.equal(source.context.text.slice(source.start, source.end), source.quote);
  assert.throws(() => buildEditorialIssues(f.packet, f.draft, report([{ ...gate.findings[0], quote: 'wrong' }])), /no longer matches/);
  assert.throws(() => buildEditorialIssues(f.packet, f.draft, report([{ ...gate.findings[1], field: 'drafts[0].body_en' }])), /per-draft/);
});

test('accepts the existing real gate contract without external services or database', () => {
  const f = fixture();
  const gate = evaluateDraft(f.packet, f.draft);
  const issues = buildEditorialIssues(f.packet, f.draft, gate);
  assert.equal(issues.summary.findingCount, gate.findings.length);
  assert.equal(issues.summary.blocked, gate.blocked);
  assert.equal(issues.items.filter(i => i.kind === 'finding').reduce((sum, i) => sum + i.count, 0), gate.findings.length);
  assert.ok(issues.summary.warningCount > 0);
  assert.equal(validateEditorialConfirmations(issues, { confirmations: [] }).canApprove, false);
});


test('model specification row shares a conditions question while all values and positions survive',()=>{
 const f=fixture('MC0606: 2000 nits, 100000:1 contrast.\nMF0808: 4000 nits.');
 const gate=report([f.hit('W4','2000 nits'),f.hit('W4','100000:1'),f.hit('W4','4000 nits')]);const issues=buildEditorialIssues(f.packet,f.draft,gate);assert.equal(issues.items.length,2);assert.equal(issues.items.reduce((sum,i)=>sum+i.count,0),3);assert.ok(issues.items.some(i=>i.count===2));
});
