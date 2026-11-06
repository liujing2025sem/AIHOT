import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { packetSchema, sha256, validateResponse, renderReview, writingHandoffFiles, instructions, type Packet, type Response } from '../scripts/editorial-pilot-lib.ts';

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
  const dir = mkdtempSync(path.resolve('industry/writing/.editorial-test-'));
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

test('production prompt includes apply writing rules while preserving each existing output contract', async () => {
  const { promptText, promptVersion } = await import('../packages/backend/src/editorial/prompts.ts');
  const rules = readFileSync('industry/prompts/rules-editorial-writing.md', 'utf8');
  const values = { publishedDate: '2026-09-20', today: '2026-10-29', sourceName: 'Manufacturer', identity: '', title: 'Source title', body: 'Source body', post: 'Source post', kindName: '周报', span: '一周', sentences: '两句', chars: '160', sections: '', sectionsExample: '[]' };
  for (const name of ['understand', 'summarize-article', 'summarize-long-post', 'summarize-short-post', 'translate-body', 'translate-post', 'story-digest', 'report-period']) {
    const rendered = promptText(name, values);
    assert.ok(rendered.includes(rules), `${name} must use the actual common wording`);
    assert.doesNotMatch(rendered, /\{\{[>\w]/);
    assert.match(promptVersion(name), /@[a-f0-9]{10}$/);
  }
  assert.match(promptText('summarize-article', values), /title_zh:.*\r?\nsummary_zh:/);
  assert.match(promptText('translate-body'), /同样数量|同样.*数量/);
  assert.match(promptText('translate-body'), /不增删信息/);
});

test('old news packets stay neutral, brand pages use an explicit exact site and isolated reference', () => {
  assert.equal(packetSchema.parse(packet).writing, undefined);
  assert.match(instructions(packet), /行业新闻.*无品牌目标页/);
  for (const site of ['chipshow.com', 'chipshowledusa.com', 'chipshow.eu', 'unishineled.com'] as const) {
    const branded = packetSchema.parse({ ...packet, writing: { site, target_url: `https://www.${site}/assigned-page/`, page_type: 'guide' } });
    assert.match(instructions(branded), site === 'unishineled.com' ? /writing\/unishine-candidate\.md/ : /writing\/chipshow-candidate\.md/);
  }
  for (const target_url of ['https://chipshow.com.evil.example/page', 'https://unishineled.com/page', 'https://chipshowledusa.com/page']) {
    assert.throws(() => packetSchema.parse({ ...packet, writing: { site: 'chipshow.com', target_url, page_type: 'guide' } }), /must match exactly/);
  }
  assert.throws(() => packetSchema.parse({ ...packet, writing: { site: 'chipshow.cn', target_url: 'https://chipshow.cn/page', page_type: 'guide' } }));
});

test('two real LED sources retain exact evidence and provide a self-contained handoff in a fresh process', () => {
  const examples = JSON.parse(readFileSync('industry/writing/led-rule-examples.json', 'utf8')).examples;
  const real: Packet = packetSchema.parse({ ...packet, articles: examples.map((e: { source: Packet['articles'][number] }) => e.source), draft_article_ids: examples.map((e: { source: Packet['articles'][number] }) => e.source.binding.article_id) });
  assert.equal(real.articles.length, 2);
  const answer: Response = { ...response, decisions: real.articles.map(a => ({ article_id: a.binding.article_id, decision: 'KEEP', reason_zh: '厂商显示器件资料，可作中立行业选题' })), drafts: examples.map((e: { source: Packet['articles'][number]; example_zh: string; example_en: string; evidence_quotes: string[]; questions_zh: string[] }) => ({ source: e.source.binding, title_zh: e.source.title, title_en: e.source.title, review_zh: e.example_zh, body_en: e.example_en, evidence: e.evidence_quotes.map(quote => ({ claim: '原文事实或须确认的归属表述', quote })), questions_zh: e.questions_zh, keyword_hypothesis: 'hypothesis only', meta_description_en: 'Manufacturer component statements and their conditions.' })) };
  assert.equal(validateResponse(real, answer).drafts.length, 2);
  const king = answer.drafts.find(d => d.source.url.includes('kinglight'))!;
  const macro = answer.drafts.find(d => d.source.url.includes('mblock'))!;
  assert.match(king.body_en, /stability evaluation.*environment and operating conditions/);
  assert.match(king.body_en, /manufacturer statement/);
  assert.match(macro.body_en, /15,360Hz under a full 64-scan/);
  assert.match(macro.body_en, /expected in Q4/);
  assert.ok(macro.questions_zh.some(q => q.includes('MBI5292') && q.includes('归属')));
  const files = writingHandoffFiles(real);
  const dir = mkdtempSync(path.resolve('industry/writing/.editorial-handoff-test-'));
  try {
    writeFileSync(path.join(dir, 'request.json'), JSON.stringify(real));
    writeFileSync(path.join(dir, 'RESPONSE_FORMAT.json'), JSON.stringify(answer));
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(dir, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content);
    }
    // This reader has no repo cwd, credentials, installed skills or originals path.
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { readFileSync } from 'node:fs';
      import assert from 'node:assert/strict';
      const read = name => readFileSync(name, 'utf8');
      const request = JSON.parse(read('request.json'));
      assert.equal(request.articles.length, 2);
      assert.ok(request.articles.every(a => a.body_text && a.binding.url));
      for (const name of ${JSON.stringify(Object.keys(files))}) assert.ok(read(name).length);
      assert.ok(read('WRITING_START_HERE.md').includes('WRITING_RULES.md'));
      assert.ok(read('WRITING_RULES.md').includes('数字与论断逐项对应'));
      assert.ok(read('WRITING_SOURCES.md').includes('4fda173f3fef7fb808f3eba991eeb2528ea4b189'));
      assert.ok(read('LICENSE-human-writing.txt').includes('Permission is hereby granted'));
      console.log('PORTABLE_RULES_AND_REAL_SOURCES_READABLE');
    `], { cwd: dir, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /PORTABLE_RULES_AND_REAL_SOURCES_READABLE/);
    const resultFile = path.join(dir, 'response.json'); writeFileSync(resultFile, JSON.stringify(answer));
    const received = spawnSync(process.execPath, [path.resolve('scripts/editorial-pilot.ts'), 'receive', dir, resultFile], { encoding: 'utf8' });
    assert.equal(received.status, 0, received.stderr);
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'received/run-a/receipt.json'), 'utf8')).human_approval, 'PENDING');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


import { editorialDirection, editorialTopic } from '../site/editorial.ts';
import { publicDraft } from '../packages/backend/src/admin/studio-publication.ts';

test('approved multi-direction Blog brief reaches file handoff without a mandatory buyer question',()=>{
 const p={...packet,editorial_policy:editorialDirection};const parsed=packetSchema.parse(p);assert.equal(parsed.editorial_policy?.daily_digest,true);
 const files=writingHandoffFiles(parsed);assert.match(files['WRITING_START_HERE.md'],/Blog英文对外，中文Blog稿仅内部审稿/);assert.match(files['EDITORIAL_DIRECTION.md'],/中文社媒和中文视频可公开/);assert.match(files['EDITORIAL_DIRECTION.md'],/箱体/);assert.match(files['EDITORIAL_DIRECTION.md'],/未匹配既有采购问题不能单独作为淘汰理由/);
 assert.equal(editorialTopic('The driver IC MBI model'),'ic');assert.equal(editorialTopic('LED package and MiP'),'led-package');assert.equal(editorialTopic('Display cabinet with front maintenance'),'cabinet');
});

test('unconfirmed status survives public title, summary and body while dates remain original',()=>{
 const d={...response.drafts[0],review_zh:'据传厂商准备更新器件，尚未证实。'};
 const published=publicDraft(d,undefined,{publicationTime:'2026-08-18',utcOffset:'+08:00'});assert.equal(published.news_status,'unconfirmed');assert.match(published.title,/^Unconfirmed report:/);assert.match(published.meta_description,/^Unconfirmed report/);assert.match(published.body,/Unconfirmed report/);assert.match(published.body,/August 18, 2026/);assert.equal(published.canonical,null);assert.equal(published.placement,'blog');assert.ok(!('review_zh' in published));
 const unknown=publicDraft({...d,source:{...d.source,published_at:null}});assert.match(unknown.body,/date: not provided/);
});


test('public exporter rejects Chinese prose but preserves original non-Latin source URLs',()=>{
 assert.throws(()=>publicDraft({...response.drafts[0],body_en:'仅供内部审稿，不得公开。'}),/公开英文稿 body_en/);
 const d={...response.drafts[0],body_en:'English source reference https://maker.example/中文原文'};assert.doesNotThrow(()=>publicDraft(d));assert.ok(!('keyword_hypothesis' in publicDraft(d)));
});
