import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Packet } from '../scripts/editorial-pilot-lib.ts';
import { evaluateDraft, type Finding, type GateReport } from '../packages/backend/src/studio/editorial-gate.ts';
import { buildEditorialIssues, validateEditorialConfirmations, type EditorialDraft, type EditorialIssues } from '../packages/backend/src/studio/editorial-issues.ts';
import {applyReviewEdit,englishReviewHash,reviewEditSuggestions} from '../packages/backend/src/studio/studio-review-edits.ts';
import {assembleFragments} from '../packages/backend/src/studio/studio-pitch-fragments.ts';

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

test('a proposed English edit targets one sentence, keeps other BLOCKs and rejects stale fingerprints',()=>{
  const f=fixture('Our screen reaches 9000 nits.\n\nOur product is the best.\n\nThe installation guide explains the cabinet layout and service access.\n\nSource: https://maker.example/news');
  const gate=evaluateDraft(f.packet,f.draft,{publishedTexts:[]}),issues=buildEditorialIssues(f.packet,f.draft,gate);
  const suggestion=reviewEditSuggestions(f.packet,f.draft,issues).find(s=>issues.items.find(i=>i.id===s.issueId)?.ruleId==='D1')!;
  assert.ok(suggestion);
  assert.match(suggestion.before,/9000 nits/);
  const edited=applyReviewEdit(f.packet,f.draft,issues,{issueId:suggestion.issueId,fingerprint:suggestion.fingerprint,suggestionId:suggestion.id});
  assert.doesNotMatch(edited.draft.body_en,/9000 nits/);
  assert.match(edited.draft.body_en,/Our product is the best/);
  assert.equal(edited.draft.review_zh,f.draft.review_zh,'no invented Chinese translation');
  assert.notEqual(englishReviewHash(edited.draft),englishReviewHash(f.draft));
  assert.ok(evaluateDraft(f.packet,edited.draft,{publishedTexts:[]}).findings.some(i=>i.ruleId==='D2'&&i.severity==='BLOCK'));
  assert.throws(()=>applyReviewEdit(f.packet,f.draft,issues,{issueId:suggestion.issueId,fingerprint:'stale',suggestionId:suggestion.id}),/版本不一致/);
  const nextIssues=buildEditorialIssues(f.packet,edited.draft,evaluateDraft(f.packet,edited.draft,{publishedTexts:[]}));
  assert.throws(()=>applyReviewEdit(f.packet,edited.draft,nextIssues,{issueId:suggestion.issueId,fingerprint:suggestion.fingerprint,suggestionId:suggestion.id}),/版本不一致/);
});

test('review suggestions preserve HTML structure, evidence links and noneditable table cells',()=>{
  const f=fixture('<p>Our screen reaches 9000 nits.</p><p>The guide explains cabinet layout and maintenance clearance for buyers.</p><p>Source: <a href="https://maker.example/news">original</a></p>');
  const issues=buildEditorialIssues(f.packet,f.draft,evaluateDraft(f.packet,f.draft));
  const s=reviewEditSuggestions(f.packet,f.draft,issues)[0]!;
  assert.ok(s);
  const changed=applyReviewEdit(f.packet,f.draft,issues,{issueId:s.issueId,fingerprint:s.fingerprint,suggestionId:s.id}).draft;
  assert.match(changed.body_en,/<p><\/p><p>The guide/);
  assert.match(changed.body_en,/<a href="https:\/\/maker.example\/news">original<\/a>/);
  f.draft.body_en='<table><tr><td>Our screen reaches 9000 nits.</td></tr></table><p>Source: https://maker.example/news</p>';
  assert.equal(reviewEditSuggestions(f.packet,f.draft,buildEditorialIssues(f.packet,f.draft,evaluateDraft(f.packet,f.draft))).length,0);
  for(const tag of ['strong','span','em']){
    f.draft.body_en=`<p>Our screen reaches <${tag}>9000 nits</${tag}> at maximum.</p><p>The installation guide explains cabinet layout and service access for buyers.</p><p>Source: https://maker.example/news</p>`;
    assert.equal(reviewEditSuggestions(f.packet,f.draft,buildEditorialIssues(f.packet,f.draft,evaluateDraft(f.packet,f.draft))).length,0,'do not remove a number from inside an inline span and leave a broken sentence');
  }
});

for(const original of [
  '<div class="wp-block-group"><p>Original paragraph.</p></div>\n',
  '\n  <section data-layout="guide">\n<p>Original paragraph.</p>\n</section>\n\n',
  '\n\t<p>Original paragraph.</p>  \n',
])test(`an accepted fragment edit preserves wrappers and edge whitespace: ${JSON.stringify(original.slice(0,35))}`,()=>{
  const before='<h2 id="existing-anchor">Existing&nbsp;heading</h2>\n';
  const after='<p>Source: <a href="https://maker.example/news">Original source</a></p>\n';
  const paragraphs=[{id:'p1',html:before,text:'Existing heading'},{id:'p2',html:original,text:'Original paragraph.'},{id:'p3',html:after,text:'Original source'}];
  const edit_plan=[{op:'keep' as const,paragraph:'p1',facts:[]},{op:'revise' as const,paragraph:'p2',facts:[]},{op:'keep' as const,paragraph:'p3',facts:[]}];
  const raw='<p>Our screen reaches 9000 nits. The remaining technical explanation is long enough for a human to review.</p>';
  const fragments=[{op_index:1,html_en:raw,zh_review:'旧中文审校稿',used_facts:[]}];
  const body=assembleFragments(paragraphs,edit_plan,fragments).html_en;
  const f=fixture(body),packet={...f.packet,pitch:{fragments_plan:{paragraphs,edit_plan,fragments}}} as unknown as Packet;
  const issues=buildEditorialIssues(packet,f.draft,report([f.hit('D1','9000 nits','body_en','BLOCK')]));
  const suggestion=reviewEditSuggestions(packet,f.draft,issues)[0];assert.ok(suggestion);
  const edited=applyReviewEdit(packet,f.draft,issues,{issueId:suggestion.issueId,fingerprint:suggestion.fingerprint,suggestionId:suggestion.id});
  const plan=edited.packet.pitch!.fragments_plan!;
  assert.equal(plan.fragments![0].html_en,raw.replace('Our screen reaches 9000 nits. ',''),'only raw fragment copy changes');
  assert.equal(assembleFragments(plan.paragraphs,plan.edit_plan,plan.fragments!).html_en,edited.draft.body_en,'reassembly exactly equals the saved English');
  assert.ok(edited.draft.body_en.startsWith(before));assert.ok(edited.draft.body_en.endsWith(after));
  assert.deepEqual(plan.paragraphs,paragraphs,'all original paragraphs remain byte-for-byte in the source plan');
  assert.equal(f.draft.body_en,body,'the original input was not mutated');
});

test('a kept paragraph and a deletion that empties a plain fragment do not offer unsafe auto edits',()=>{
  const source='\n\nThe existing installation guide has detailed service and cable access information.\nSource: https://maker.example/news';
  for(const op of ['keep','revise'] as const){
    const paragraphs=[{id:'p1',html:'Our screen reaches 9000 nits. ',text:'Our screen reaches 9000 nits.'},{id:'p2',html:source,text:source}];
    const edit_plan=[{op,paragraph:'p1',facts:[]},{op:'keep' as const,paragraph:'p2',facts:[]}];
    const fragments=op==='revise'?[{op_index:0,html_en:paragraphs[0].html,zh_review:'旧中文',used_facts:[]}]:[];
    const f=fixture(assembleFragments(paragraphs,edit_plan,fragments).html_en);
    const packet={...f.packet,pitch:{fragments_plan:{paragraphs,edit_plan,fragments}}} as unknown as Packet;
    const issues=buildEditorialIssues(packet,f.draft,report([f.hit('D1','9000 nits','body_en','BLOCK')]));
    assert.deepEqual(reviewEditSuggestions(packet,f.draft,issues),[]);
  }
});

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
