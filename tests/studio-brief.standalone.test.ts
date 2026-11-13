// Regression fixtures are intentionally synthetic. They are not a collected or publishable issue.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packetSchema, sha256, validateResponse, responseFormat, instructions, type Packet, type Response } from '../scripts/editorial-pilot-lib.ts';
import { briefGenerationSchema, buildBriefResponse, briefDraftSegments, evaluateBriefDraft } from '../packages/backend/src/studio/studio-brief-content.ts';
import { briefSourceWasPublished, composeStudioBrief, selectBriefEvents, type BriefMaterial } from '../packages/backend/src/studio/studio-brief.ts';
import { assessBriefMaterials } from '../packages/backend/src/studio/studio-brief-inspection.ts';
import { evaluateDraft, type GateReport } from '../packages/backend/src/studio/editorial-gate.ts';
import { config } from '../packages/backend/src/config.ts';

const at = '2026-11-09T00:00:00.000Z';
function fixture(count = 5) {
  const articles = Array.from({ length: count }, (_, i) => {
    const title = `Maker ${i + 1} announces a new LED driver IC`, body = `Maker ${i + 1} says the IC supports ${1000 + i * 100} Hz at the stated scan ratio. This is a manufacturer statement.`;
    return { binding: { article_id: `brief-source-${i + 1}`, revision: 1, content_sha256: sha256(JSON.stringify([title, 'ok', body])), url: `https://example.com/driver-${i + 1}`, published_at: '2026-11-03T00:00:00.000Z' }, title, body_text: body, body_status: 'ok', source_id: `maker-${i + 1}`, source_name: `Maker ${i + 1}` };
  });
  const packet: Packet = packetSchema.parse({ schema: 'aihot-editorial-pilot/1', task_id: 'brief-fixture', created_at: at, scope: 'LOCAL_AGENT_HANDOFF_NOT_AUTOMATED_AIHOT_PIPELINE', articles, draft_article_ids: articles.map(a => a.binding.article_id),
    brief: { schema: 'aihot-brief-selection/1', events: articles.map((a, i) => ({ article_id: a.binding.article_id, event_id: `fact-${i + 1}`, section: 'components-ics', publication_time: '2026-11-03', source_utc_offset: '+00:00', date_basis: 'published', observed_version_at: null })), pages: [{ url: 'https://chipshow.com/buyers-guide/', title: 'A buyer guide' }] } });
  const generated = briefGenerationSchema.parse({ decision: 'draft', title_en: 'Five LED driver updates', title_zh: '五条驱动器件更新',
    in_5_seconds: [1, 2, 3].map(i => ({ event_key: `driver-${i}`, text_en: `Maker ${i} announces an IC.` })),
    items: articles.map((a, i) => ({ event_key: `driver-${i + 1}`, article_ids: [a.binding.article_id], primary_article_id: a.binding.article_id, section: 'components-ics', title_en: `Maker ${i + 1} announces an IC`, title_zh: `厂商${i + 1}发布器件`, body_en: a.body_text, review_zh: `厂商称支持 ${1000 + i * 100} Hz，限原文扫描条件。`, news_status: 'reported', hook_anchor_quote: a.title,
      evidence: [{ article_id: a.binding.article_id, claim: 'Manufacturer claim with its scan condition.', quote: a.body_text.split('. ')[0] }], go_deeper: { url: 'https://chipshow.com/buyers-guide/', label_en: 'IC selection guide' } })),
    questions_zh: [], keyword_hypothesis: 'LED driver updates', meta_description_en: 'Manufacturer driver announcements with original dates and sources.' });
  assert.equal(generated.decision, 'draft');
  if (generated.decision !== 'draft') throw Error('fixture');
  const response = buildBriefResponse(packet, generated, { agent_id: 'test-fixture', model: null, input_files: ['synthetic fixtures'] }, 'brief-run');
  const materials: BriefMaterial[] = articles.map((a, i) => ({ id: a.binding.article_id, title: a.title, url: a.binding.url, revision: 1, source_id: a.source_id, source_name: a.source_name, body_text: a.body_text, body_status: 'ok', published_at: a.binding.published_at, publication_time: '2026-11-03', source_utc_offset: '+00:00', category: 'components-ics', event_id: `fact-${i + 1}`, backfill_reason: null, discovered_at: '2026-11-03', source_baseline_at: null, baseline_title: null, baseline_body: null, version_observed_at: null, reference_only: false, already_published: false }));
  return { packet, generated, response, materials };
}

test('five or twelve independent sources become exactly one review draft, never scatter drafts', () => {
  for (const n of [5, 12]) {
    const { packet, response, materials } = fixture(n);
    assert.equal(selectBriefEvents(materials, materials.map(a => a.id), at).length, n);
    const received = validateResponse(packet, response);
    assert.equal(received.drafts.length, 1);
    assert.equal(received.drafts[0].brief?.items.length, n);
    assert.equal((received.drafts[0].body_en.match(/class="cs-brief"/g) ?? []).length, 1);
    assert.equal((received.drafts[0].body_en.match(/id="brief-highlight-/g) ?? []).length, 3);
    assert.equal((received.drafts[0].body_en.match(/Original source date: 2026-11-03/g) ?? []).length, n);
    assert.doesNotMatch(received.drafts[0].body_en, /\.cs-brief\s*\{|<style|<script|\[UPDATE\]/);
    assert.equal(briefDraftSegments(received.drafts[0]).length, n);
  }
});

test('brief membership cannot weaken legacy per-source draft count or source evidence', () => {
  const { packet, response } = fixture();
  const legacy = structuredClone(packet); delete legacy.brief;
  assert.throws(() => validateResponse(legacy, response), /普通任务/);
  const notABrief = structuredClone(response); delete notABrief.drafts[0].brief;
  assert.throws(() => validateResponse(packet, notABrief), /1 篇合集/);
  const repeated = structuredClone(response); repeated.drafts.push(repeated.drafts[0]);
  assert.throws(() => validateResponse(packet, repeated), /1 篇合集/);
  const incorrectQuote = structuredClone(response);
  incorrectQuote.drafts[0].brief!.items[1].evidence[0].quote = packet.articles[0].body_text!;
  assert.throws(() => validateResponse(packet, incorrectQuote), /本事件/);
  const crossBound = structuredClone(response);
  crossBound.drafts[0].brief!.items[1].evidence[0].article_id = packet.articles[0].binding.article_id;
  assert.throws(() => validateResponse(packet, crossBound), /本事件/);
});

test('duplicate event/source/URL selections cannot make a five-event quota', () => {
  const { packet, generated, materials } = fixture();
  assert.throws(() => selectBriefEvents(materials.slice(0, 4), materials.slice(0, 4).map(a => a.id), at), /5–12/);
  for (const key of ['event_id', 'url', 'title', 'body_text'] as const) {
    const duplicate = structuredClone(materials); duplicate[1] = { ...duplicate[1], [key]: duplicate[0][key] };
    assert.throws(() => selectBriefEvents(duplicate, duplicate.map(a => a.id), at), /同一事件|重复原文/);
  }
  const wrongGroup = structuredClone(packet); wrongGroup.brief!.events[1].event_id = wrongGroup.brief!.events[0].event_id;
  assert.throws(() => buildBriefResponse(wrongGroup, generated, { agent_id: 'test', model: null, input_files: ['fixture'] }, 'run'), /重复计入/);
  const fakeCount = structuredClone(generated); fakeCount.items[1].event_key = fakeCount.items[0].event_key;
  assert.throws(() => buildBriefResponse(packet, fakeCount, { agent_id: 'test', model: null, input_files: ['fixture'] }, 'run'), /同一事件/);
});

test('selection inspection counts eligible events before five materials and explains correctable problems', () => {
  const { materials } = fixture(6);
  const before = structuredClone(materials), ids = materials.map(a => a.id);
  const partial = assessBriefMaterials(materials.slice(0, 3), ids.slice(0, 3), at);
  assert.deepEqual(partial.counts, { selected: 3, independent_events: 3, eligible_independent_events: 3, additional_events_needed: 2 });
  assert.equal(partial.can_compose, false);
  const valid = assessBriefMaterials(materials.slice(0, 5), ids.slice(0, 5), at);
  assert.equal(valid.can_compose, true); assert.equal(valid.events.length, 5);
  const changed = structuredClone(materials);
  changed[1].url = changed[0].url + '?utm_source=syndication';
  changed[5].body_status = 'partial'; changed[5].published_at = null;
  const report = assessBriefMaterials(changed, ids, at);
  assert.equal(report.counts.independent_events, 5);
  assert.equal(report.counts.eligible_independent_events, 4);
  assert.equal(report.counts.additional_events_needed, 1);
  assert.equal(report.can_compose, false);
  assert.ok(report.duplicates[0]?.matched_by.includes('canonical_url'));
  assert.equal(report.materials[1].duplicate_of, ids[0]);
  assert.match(report.materials[1].issues.at(-1)!.action_zh, /保留|移除/);
  assert.deepEqual(report.materials[5].issues.map(issue => issue.code), ['missing_body', 'missing_date']);
  assert.match(report.materials[5].issues[1].action_zh, /原文/);
  assert.deepEqual(materials, before, 'the report never mutates original material records');
});

test('inspection merges transitive identity clues and preserves observed-version date evidence', () => {
  const { materials } = fixture(5), ids = materials.map(a => a.id);
  materials[1].event_id = materials[0].event_id;
  materials[2].title = materials[1].title;
  materials[3].body_text = materials[2].body_text;
  const report = assessBriefMaterials(materials, ids, at);
  assert.equal(report.counts.independent_events, 2);
  assert.deepEqual(report.duplicates[0]?.article_ids, ids.slice(0, 4));
  assert.deepEqual(new Set(report.duplicates[0]?.matched_by), new Set(['event_id', 'title', 'body']));
  assert.equal(report.can_compose, false);
  const newer = structuredClone(fixture(5).materials);
  newer[0] = { ...newer[0], title: 'LEDVISION 9.8 software update', source_id: 'web-colorlight-ledvision',
    published_at: null, source_baseline_at: '2026-10-01', discovered_at: '2026-11-03' };
  const version = assessBriefMaterials(newer, newer.map(a => a.id), at);
  assert.equal(version.materials[0].code, 'eligible');
  assert.equal(version.materials[0].date_basis, 'observed_version');
  assert.equal(version.can_compose, true);
});

test('headlines anchor to their own event; links use the registered owned-page allowlist', () => {
  const { packet, generated } = fixture();
  const wrongAnchor = structuredClone(generated); wrongAnchor.items[1].hook_anchor_quote = packet.articles[0].body_text!;
  assert.throws(() => buildBriefResponse(packet, wrongAnchor, { agent_id: 'test', model: null, input_files: ['fixture'] }, 'run'), /主出处/);
  const injected = structuredClone(generated); injected.items[0].body_en += '<img src=x onerror=alert(1)>';
  const escaped = buildBriefResponse(packet, injected, { agent_id: 'test', model: null, input_files: ['fixture'] }, 'run');
  assert.doesNotMatch(escaped.drafts[0].body_en, /<img/); assert.match(escaped.drafts[0].body_en, /&lt;img/);
  const foreignLink = structuredClone(generated); foreignLink.items[0].go_deeper!.url = 'https://example.net/not-an-owned-page';
  assert.throws(() => buildBriefResponse(packet, foreignLink, { agent_id: 'test', model: null, input_files: ['fixture'] }, 'run'), /已登记/);
});

test('14/30 windows, already-published items and undated references are real preflight failures', () => {
  const { materials } = fixture();
  const ids = materials.map(a => a.id);
  for (const flag of ['reference_only', 'already_published'] as const) {
    const changed = structuredClone(materials); changed[0][flag] = true;
    assert.throws(() => selectBriefEvents(changed, ids, at), /参考资料|已发过/);
  }
  const unknown = structuredClone(materials); unknown[0].published_at = null; unknown[0].publication_time = null;
  assert.throws(() => selectBriefEvents(unknown, ids, at), /缺少原文日期/);
  const twenty = structuredClone(materials); twenty[0].published_at = '2026-10-20';
  assert.equal(selectBriefEvents(twenty, ids, at).length, 5);
  twenty[0].title = 'Maker announces a stadium installation';
  assert.throws(() => selectBriefEvents(twenty, ids, at), /14 天/);
  const stale = structuredClone(materials); stale[0].published_at = '2026-09-01';
  assert.throws(() => selectBriefEvents(stale, ids, at), /30 天/);
});

test('a proven new software version retains unknown publication date and can follow an older same-URL version', () => {
  const { packet, response, materials } = fixture();
  const current = { ...materials[0], title: 'LEDVISION 9.8 software update', source_id: 'web-colorlight-ledvision', published_at: null, publication_time: null, source_baseline_at: '2026-10-01', discovered_at: '2026-11-03' };
  assert.equal(briefSourceWasPublished(current, [{ ...packet.articles[0], title: 'LEDVISION 9.7 software update' }]), false);
  assert.equal(briefSourceWasPublished(current, [{ ...packet.articles[0], title: 'LEDVISION 9.8 software update' }]), true);
  materials[0] = current;
  const selected = selectBriefEvents(materials, materials.map(a => a.id), at);
  assert.equal(selected[0].date_basis, 'observed_version');
  assert.equal(selected[0].observed_version_at, '2026-11-03T00:00:00.000Z');
  const held: Response = { ...response, decisions: response.decisions.map(d => ({ ...d, decision: 'HOLD', reason_zh: '去重后只剩四个事件，不凑数。' })), drafts: [] };
  assert.equal(validateResponse(packet, held).drafts.length, 0);
});

test('editing away a source, whole event, or required summary fails the current-draft gate', () => {
  const { packet, response } = fixture();
  const edited = structuredClone(response);
  edited.drafts[0].body_en = edited.drafts[0].body_en.replace('Maker 2 says the IC supports', 'According to Maker 2, the IC supports');
  assert.equal(validateResponse(packet, edited).drafts.length, 1, 'ordinary English copyediting preserves the one-brief structure');
  for (const changed of [
    response.drafts[0].body_en.replace('href="https://example.com/driver-2"', 'href="https://example.com/wrong"'),
    response.drafts[0].body_en.replace('class="cs-brief-item"', 'class="removed"'),
    response.drafts[0].body_en.replace(/<li[^>]*>Maker 1 announces an IC.<\/li>/, ''),
    response.drafts[0].body_en.replace('Original source date: 2026-11-03', 'Original source date: 2026-11-09'),
  ]) {
    const result = evaluateDraft(packet, { ...response.drafts[0], body_en: changed }, { publishedTexts: [] });
    assert.equal(result.blocked, true); assert.ok(result.findings.some(f => f.severity === 'BLOCK'));
  }
});

test('portable task handoff keeps the dedicated one-brief format and never represents placeholders as news', () => {
  const { packet } = fixture();
  const format = responseFormat(packet);
  assert.equal(format.drafts.length, 1);
  assert.equal('brief' in format.drafts[0] && format.drafts[0].brief?.items.length, 5);
  assert.match(format.drafts[0].body_en, /TEMPLATE ONLY/);
  assert.match(instructions(packet), /不足 5 个事件时 drafts=\[\]/);
  assert.match(instructions(packet), /不能按素材各写一篇/);
});

test('event gates use only that event sources and preserve full-document and source offsets', () => {
  const { packet, response } = fixture(), draft = response.drafts[0], calls: Packet[] = [];
  const gate = evaluateBriefDraft(packet, draft, {}, (scoped, fragment): GateReport => {
    calls.push(scoped);
    const start = fragment.body_en.indexOf('Maker 2 says');
    return { version: 'test', mandatoryReview: [], blocked: start >= 0, findings: start < 0 ? [] : [
      { ruleId: 'D1', severity: 'BLOCK', field: 'body_en', start, end: start + 12, quote: fragment.body_en.slice(start, start + 12), reason: 'test finding' },
      { ruleId: 'W3', severity: 'WARN', field: 'source.body_text', start: 0, end: 5, quote: 'Maker', reason: 'source finding' },
    ] };
  });
  assert.equal(calls.length, 9);
  const scopedCalls = calls.slice(0, -1);
  assert.ok(scopedCalls.every(call => call.articles.length === 1));
  for (let i = 0; i < 5; i++) assert.ok(scopedCalls.some(call => call.articles[0].binding.article_id === packet.articles[i].binding.article_id));
  const finding = gate.findings.find(f => f.reason === 'test finding')!;
  assert.equal(finding.start, draft.body_en.indexOf('Maker 2 says'));
  assert.equal(finding.quote, draft.body_en.slice(finding.start, finding.end));
  assert.ok(gate.findings.some(f => f.field === 'source[brief-source-2].body_text'));
});

test('unavailable model refuses composition before querying any database or publishing', async t => {
  const previous = config.modelCallsEnabled; config.modelCallsEnabled = false; t.after(() => { config.modelCallsEnabled = previous; });
  const { materials } = fixture();
  await assert.rejects(composeStudioBrief({ article_ids: materials.map(a => a.id) }, 'test'), /尚未开启写作|缺少密钥|尚未选择写作模型|不可用/);
});
