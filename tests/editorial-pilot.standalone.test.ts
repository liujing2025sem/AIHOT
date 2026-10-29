import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { packetSchema, sha256, validateResponse, renderReview, type Packet, type Response } from '../scripts/editorial-pilot-lib.ts';

const body = 'The component supports 4000–5000 nits when used in a suitable display. This is a manufacturer claim.';
const source = { article_id: 'article-1', revision: 3, content_sha256: sha256(JSON.stringify(['Component update', 'ok', body])), url: 'https://example.com/component', published_at: '2026-08-17T16:00:00.000Z' };
const packet: Packet = { schema: 'aihot-editorial-pilot/1', task_id: 'pilot-task', created_at: '2026-10-29T00:00:00Z', scope: 'LOCAL_AGENT_HANDOFF_NOT_AUTOMATED_AIHOT_PIPELINE', articles: [{ binding: source, source_id: 'manufacturer', source_name: 'Manufacturer', title: 'Component update', body_status: 'ok', body_text: body }], draft_article_ids: ['article-1'] };
const response: Response = { task_id: 'pilot-task', run_id: 'run-a', producer: { agent_id: 'fixture-agent', model: null, input_files: ['request.json'] }, decisions: [{ article_id: 'article-1', decision: 'KEEP', reason_zh: '显示应用' }], drafts: [{ source, title_zh: '器件更新', review_zh: '厂商说法，条件待核。', title_en: 'Component update', body_en: 'Manufacturer claim, not a measured whole-screen result. https://example.com/component', evidence: [{ claim: '厂商声称范围', quote: '4000–5000 nits' }], questions_zh: ['确认整屏配置'], keyword_hypothesis: 'display component', meta_description_en: 'Manufacturer component update.' }] };

test('a changed source snapshot or a stale version cannot inherit a handoff result', () => {
  assert.doesNotThrow(() => packetSchema.parse(packet));
  const changed = structuredClone(packet);
  changed.articles[0].body_text += ' Changed conditions.';
  assert.throws(() => packetSchema.parse(changed), /exported version/);
  for (const field of ['revision', 'url', 'published_at'] as const) {
    const stale = structuredClone(response);
    if (field === 'revision') stale.drafts[0].source.revision++;
    else if (field === 'url') stale.drafts[0].source.url = 'https://example.com/other';
    else stale.drafts[0].source.published_at = null;
    assert.throws(() => validateResponse(packet, stale), /Source version mismatch/);
  }
});

test('receive requires decisions for every input and real source quotes', () => {
  const missing = structuredClone(response); missing.decisions = [];
  assert.throws(() => validateResponse(packet, missing), /Every source/);
  const invented = structuredClone(response); invented.drafts[0].evidence[0].quote = 'Certified to save 80 percent';
  assert.throws(() => validateResponse(packet, invented), /quote not found/);
  assert.equal(validateResponse(packet, response).drafts.length, 1);
});

test('a headline without body remains on hold in this full-text drafting experiment', () => {
  const incomplete = structuredClone(packet);
  incomplete.articles[0].body_text = null; incomplete.articles[0].body_status = 'pending';
  const answer = structuredClone(response); answer.drafts = [];
  assert.throws(() => validateResponse(incomplete, answer), /Selected draft missing|holds incomplete/);
  answer.decisions[0].decision = 'HOLD';
  assert.doesNotThrow(() => validateResponse(incomplete, answer));
});

test('untrusted generated markup cannot run in the offline review', () => {
  const answer = structuredClone(response);
  answer.drafts[0].body_en += '<script>untrusted()</script><img src=x onerror="untrusted()">[go](javascript:untrusted())';
  const html = renderReview(packet, answer);
  assert.doesNotMatch(html, /untrusted\(|onerror|javascript:/);
  assert.match(html, /待运营审核/);
});

test('a new process resumes a partial receive, replay keeps edits, changed output is refused', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aihot-editorial-test-'));
  const cli = path.resolve('scripts/editorial-pilot.ts');
  try {
    const bytes = JSON.stringify(response);
    const result = path.join(dir, 'response.json');
    writeFileSync(path.join(dir, 'request.json'), JSON.stringify(packet));
    writeFileSync(result, bytes);
    const received = path.join(dir, 'received', 'run-a');
    mkdirSync(received, { recursive: true });
    // Simulate an earlier receiver stopping after it persisted the returned response.
    writeFileSync(path.join(received, 'response.json'), bytes);
    const run = () => spawnSync(process.execPath, [cli, 'receive', dir, result], { encoding: 'utf8' });
    const recovered = run(); assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(JSON.parse(readFileSync(path.join(received, 'receipt.json'), 'utf8')).human_approval, 'PENDING');
    const draft = path.join(received, 'article-1.en.md');
    writeFileSync(draft, 'Colleague edit, keep this.');
    const replay = run(); assert.equal(replay.status, 0, replay.stderr);
    assert.match(replay.stdout, /ALREADY_RECEIVED/);
    assert.equal(readFileSync(draft, 'utf8'), 'Colleague edit, keep this.');
    const changed = structuredClone(response); changed.drafts[0].body_en += ' A revised draft.';
    writeFileSync(result, JSON.stringify(changed));
    const conflict = run(); assert.notEqual(conflict.status, 0);
    assert.match(conflict.stderr, /already received with different/);
    assert.equal(readFileSync(draft, 'utf8'), 'Colleague edit, keep this.');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
