import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Packet, Response } from '../scripts/editorial-pilot-lib.ts';
import { editorialGate, evaluateDraft, type GateContext, type GateReport } from '../packages/backend/src/admin/editorial-gate.ts';

const binding = { article_id: 'source-1', revision: 1, content_sha256: 'a'.repeat(64), url: 'https://maker.example/news', published_at: '2026-10-31T00:00:00Z' };
const packet: Packet = {
  schema: 'aihot-editorial-pilot/1', task_id: 'gate-task', created_at: '2026-11-01T00:00:00Z', scope: 'LOCAL_AGENT_HANDOFF_NOT_AUTOMATED_AIHOT_PIPELINE',
  articles: [{ binding, source_id: 'maker', source_name: 'Kinglight', title: 'Outdoor LED display component', body_status: 'ok', body_text: 'Kinglight reports an outdoor display component.' }], draft_article_ids: ['source-1'],
};
const draft: Response['drafts'][number] = {
  source: binding, title_zh: '户外显示器件', review_zh: '厂商称该器件面向户外显示，应用效果仍需结合实际工作环境核实。', title_en: 'Outdoor display component',
  body_en: 'According to Kinglight, this component targets outdoor displays. Its application requires a review of operating conditions. https://maker.example/news',
  evidence: [{ claim: 'Source statement', quote: 'Kinglight reports an outdoor display component.' }], questions_zh: [], keyword_hypothesis: 'outdoor component', meta_description_en: 'Outdoor component reference.',
};
const response: Response = { task_id: 'gate-task', run_id: 'gate-run', producer: { agent_id: 'fixture', model: null, input_files: ['fixture'] }, decisions: [{ article_id: 'source-1', decision: 'KEEP', reason_zh: '户外显示' }], drafts: [draft] };
const withBody = (text: string) => ({ ...structuredClone(draft), body_en: text });
const has = (r: GateReport, ruleId: string, severity?: 'BLOCK' | 'WARN') => r.findings.some(f => f.ruleId === ruleId && (!severity || f.severity === severity));
const check = (d = draft, p = packet, c?: GateContext) => evaluateDraft(p, d, c);
const old = (days: number) => {
  const p = structuredClone(packet);
  p.articles[0].binding.published_at = new Date(Date.parse(p.created_at) - days * 86400000).toISOString();
  return p;
};
const trusted = (kind: 'customer' | 'image' | 'certification' | 'commercial', value: string, status: 'verified' | 'denied' = 'verified'): GateContext => ({
  verifiedEvidence: [{ articleId: 'source-1', kind, value, status, reference: 'operator-record:42' }],
});

test('clean manufacturer draft has no automatic block; context is optional', () => {
  const r = check();
  assert.equal(r.blocked, false);
  assert.ok(has(r, 'W2', 'WARN'));
  assert.ok(has(r, 'W8', 'WARN'));
  assert.deepEqual(r.mandatoryReview, [...new Set(r.findings.filter(f => f.severity === 'WARN').map(f => f.ruleId))]);
});

test('D1 blocks unattributed technical values, accepts Chinese/English named manufacturer framing', () => {
  assert.ok(has(check(withBody('Brightness reaches 5000 nits.')), 'D1', 'BLOCK'));
  for (const text of [
    'According to Kinglight, brightness reaches 5000 nits.',
    'Kinglight says brightness reaches 5000 nits.',
    'The manufacturer claims 5000 nits.',
    'This is a manufacturer statement: 5000 nits.',
    '原厂称亮度为5000 nits。',
    '据晶台表示，亮度为5000 nits。',
    'According to Kinglight, this is a component update.\n\nBrightness reaches 5000 nits under the specified current.',
  ]) assert.equal(has(check(withBody(text)), 'D1', 'BLOCK'), false, text);
});

test('D1 does not treat years or heading/list ordinals as technical numbers', () => {
  const d = withBody('## 2026 component news\n1. Outdoor displays\n2. Installation notes\nPublished in 2026.');
  d.title_en = '2026: first review'; d.title_zh = '2026年器件资料';
  assert.equal(has(check(d), 'D1'), false);
  assert.ok(has(check(withBody('亮度为5000 nits。')), 'D1', 'BLOCK'));
  assert.equal(has(check(withBody('Global market share reached 30% in 2025.')), 'D1'), false);
  assert.ok(has(check(withBody('An unidentified proportion is 30%.')), 'D1', 'WARN'));
});

test('D2 bare rankings block; cited reports, negation and editorial reminders do not', () => {
  assert.ok(has(check(withBody('This is the best outdoor display.')), 'D2', 'BLOCK'));
  assert.ok(has(check(withBody('这是最强产品。')), 'D2', 'BLOCK'));
  for (const text of [
    'According to an independent test at https://lab.example/test, this was the best performer.',
    '原文称第三方评测认为这是“最好”的产品，出处：https://lab.example/test。',
    'We cannot call it the best display.', '不能宣称这是最强产品。', '避免使用“领先”表述。',
    '“最好”等用语应避免。', '第一步是核实参数。',
    'The term "best" should be avoided.', '禁止使用“最强”断言。',
    'Lab rated it "best". https://lab.example/test',
  ]) assert.equal(has(check(withBody(text)), 'D2', 'BLOCK'), false, text);
});

test('D3 uses source date and packet created_at, has exact 7-day boundary', () => {
  const d = withBody('This is the latest release.');
  assert.equal(has(check(d, old(7)), 'D3'), false);
  assert.ok(has(check(d, old(8)), 'D3', 'BLOCK'));
  assert.equal(has(check(withBody('We should not describe it as the latest release.'), old(60)), 'D3'), false);
  assert.equal(has(check(withBody('At the time, the company described it as the latest release.'), old(60)), 'D3'), false);
});

test('D3 missing/invalid/future dates warn; valid timezone offsets stay deterministic', () => {
  const d = withBody('今日发布最新器件。');
  for (const value of [null, 'not a date', '2026-02-30', '2026-10-01T12:00:00', '2026-11-02T00:00:00Z']) {
    const p = structuredClone(packet); p.articles[0].binding.published_at = value;
    const r = check(d, p); assert.ok(has(r, 'D3', 'WARN'), String(value)); assert.equal(has(r, 'D3', 'BLOCK'), false);
  }
  const p = structuredClone(packet); p.articles[0].binding.published_at = '2026-10-01T00:30:00+08:00';
  assert.ok(has(check(d, p), 'D3', 'BLOCK'));
  p.created_at = 'bad'; assert.ok(has(check(d, p), 'D3', 'WARN'));
});

test('D4 no authoritative aliases means Chinese proper-name candidates can only warn', () => {
  const d = { ...draft, review_zh: '张三·史密斯介绍了星光大学的新资料。' };
  assert.ok(has(check(d), 'D4', 'WARN')); assert.equal(has(check(d), 'D4', 'BLOCK'), false);
  const aliases = { Smith: ['张三·史密斯'], University: '星光大学' };
  assert.equal(has(check(d, packet, { knownAliases: aliases }), 'D4'), false);
});

test('D5 distinguishes our certification claim, reported third party and standard discussion', () => {
  assert.ok(has(check(withBody('We are CE certified.')), 'D5', 'BLOCK'));
  assert.ok(has(check(withBody('According to Kinglight, its component is RoHS certified. We are CE certified.')), 'D5', 'BLOCK'));
  for (const text of ['According to Kinglight, its component is AEC-Q102 certified.', 'The manufacturer claims CE certification.', 'The EN12966 standard needs to be checked.', 'We are not CE certified.', 'We report that Kinglight is CE certified.', 'We are reporting Kinglight CE certification.', 'Our article discusses CE certification.']) {
    assert.equal(has(check(withBody(text)), 'D5', 'BLOCK'), false, text);
  }
  assert.ok(has(check(withBody('We are CE certified, certificate number 123.')), 'D5', 'WARN'));
  assert.equal(has(check(withBody('We are CE certified.'), packet, trusted('certification', 'CE')), 'D5'), false);
});

test('D6 concrete first-party commercial promises block; third-party/history/inquiry stays reviewable', () => {
  for (const text of ['We offer a 5 year warranty.', '我们承诺交期为7天。', 'We guarantee delivery.', 'Our warranty is 5 years.']) assert.ok(has(check(withBody(text)), 'D6', 'BLOCK'), text);
  for (const text of ['According to Kinglight, the price is $100.', 'In 2020 we reported a price of $100.', 'Contact us for a quote.', 'We do not guarantee delivery.', 'We report that the supplier will deliver in 7 days.']) assert.equal(has(check(withBody(text)), 'D6', 'BLOCK'), false, text);
});

test('D7 named route denigration blocks; unknown subjects/negation are not invented brand judgments', () => {
  assert.ok(has(check(withBody('COB is obsolete.')), 'D7', 'BLOCK'));
  assert.ok(has(check(withBody('Kinglight落后于其他产品。')), 'D7', 'BLOCK'));
  assert.ok(has(check(withBody('This approach is obsolete.')), 'D7', 'WARN'));
  assert.equal(has(check(withBody('COB is not obsolete.')), 'D7'), false);
});

test('D8 unidentified authorization warns, trusted denial blocks, model self-approval is ignored', () => {
  const text = 'Our customer ExampleProject authorized this case study.';
  const d = withBody(text); d.evidence = [{ claim: 'customer authorized', quote: text }];
  assert.ok(has(check(d), 'D8', 'WARN')); assert.equal(has(check(d), 'D8', 'BLOCK'), false);
  assert.equal(has(check(d, packet, trusted('customer', text)), 'D8'), false);
  assert.ok(has(check(d, packet, trusted('customer', text, 'denied')), 'D8', 'BLOCK'));
  const wrong = trusted('customer', text); wrong.verifiedEvidence![0].articleId = 'unrelated';
  assert.ok(has(check(d, packet, wrong), 'D8', 'WARN'));
});

test('D8 generic projects do not request authorization; disclosure cues and trusted denials still do', () => {
  for (const text of ['适用于户外项目的安装与维护。', '本项目比较驱动方案。', 'This project compares display cabinet maintenance.']) {
    assert.equal(has(check(withBody(text)), 'D8'), false, text);
  }
  for (const text of ['项目名称为海港体育场。', '我们交付了海港体育场项目。', 'The project at Example Arena uses LED cabinets.', 'We completed the Example Arena project.']) {
    const report = check(withBody(text));
    assert.ok(has(report, 'D8', 'WARN'), text);
    for (const finding of report.findings.filter(f => f.ruleId === 'D8')) assert.equal(text.slice(finding.start, finding.end), finding.quote);
  }
  const text = 'This project compares display cabinet maintenance.';
  assert.ok(has(check(withBody(text), packet, trusted('customer', text, 'denied')), 'D8', 'BLOCK'));
});

test('D9 market data without source/period/scope blocks; partial scope warns; complete cues do not assert verification', () => {
  assert.ok(has(check(withBody('市场份额达到30%。')), 'D9', 'BLOCK'));
  assert.ok(has(check(withBody('Global market share reached 30% in 2025.')), 'D9', 'WARN'));
  assert.equal(has(check(withBody('According to Lab at https://lab.example/report, global market share by revenue reached 30% in 2025.')), 'D9'), false);
});

test('D10 Markdown/HTML images require caller-owned exact authorization; self-reported ownership cannot clear', () => {
  for (const text of ['![Own image, authorized](https://cdn.example/a.jpg)', '<img alt="own image" src="https://cdn.example/a.jpg">', '<img src=https://cdn.example/a.jpg>']) {
    assert.ok(has(check(withBody(text)), 'D10', 'WARN'));
    assert.equal(has(check(withBody(text)), 'D10', 'BLOCK'), false);
    assert.equal(has(check(withBody(text), packet, trusted('image', 'https://cdn.example/a.jpg')), 'D10'), false);
    assert.ok(has(check(withBody(text), packet, trusted('image', 'https://cdn.example/a.jpg', 'denied')), 'D10', 'BLOCK'));
  }
  assert.equal(has(check(), 'D10'), false);
});

test('W1 30-day boundary and missing dates are explicit', () => {
  assert.equal(has(check(draft, old(30)), 'W1'), false);
  assert.ok(has(check(draft, old(31)), 'W1', 'WARN'));
  const p = structuredClone(packet); p.articles[0].binding.published_at = null;
  assert.ok(has(check(draft, p), 'W1', 'WARN'));
});

test('W2 counts distinct URLs per draft, never counts unrelated packet sources', () => {
  const p = structuredClone(packet); p.articles.push({ ...p.articles[0], binding: { ...binding, article_id: 'unused', url: 'https://other.example/' } });
  assert.ok(has(check(draft, p), 'W2'));
  assert.ok(has(check(withBody(`${draft.body_en}\n![image](https://cdn.example/a.jpg)`)), 'W2'));
  assert.equal(has(check(withBody(`${draft.body_en}\nhttps://lab.example/report`)), 'W2'), false);
});

test('W3 source offsets point into unchanged source body, same-origin evidence is not called independent', () => {
  const p = structuredClone(packet); p.articles[0].body_text = '😀 Source citing Research and Markets for its figures.';
  const r = check(draft, p);
  assert.ok(has(r, 'W3', 'WARN'));
  for (const f of r.findings.filter(f => f.ruleId === 'W3')) {
    assert.equal(f.field, 'source.body_text'); assert.equal(p.articles[0].body_text.slice(f.start, f.end), f.quote);
  }
});

test('W4 technical performance with no condition warns; recognized conditions avoid the warning', () => {
  assert.ok(has(check(withBody('Kinglight reports 5000 nits.')), 'W4', 'WARN'));
  assert.equal(has(check(withBody('Kinglight reports up to 5000 nits under specified test conditions.')), 'W4'), false);
});

test('W5 lexical topic scope does not make a semantic rejection', () => {
  const p = structuredClone(packet); p.articles[0].title = 'Automotive backlight'; p.articles[0].body_text = 'Cabin backlighting.';
  assert.ok(has(check(draft, p), 'W5', 'WARN')); assert.equal(has(check(draft, p), 'W5', 'BLOCK'), false);
});

test('W6 checks first covered acronym occurrence, recognizes nearby explanation', () => {
  assert.ok(has(check(withBody('MiP is discussed here.')), 'W6', 'WARN'));
  assert.equal(has(check(withBody('COB (chip on board) is discussed here.')), 'W6'), false);
});

test('W7 bilingual technical number mismatch warns, normalized nits and spacing agree', () => {
  const d = withBody('Kinglight says 5000 nits under test conditions.'); d.review_zh = '原厂称在测试条件下为4000 nit。';
  assert.ok(has(check(d), 'W7', 'WARN'));
  d.review_zh = '原厂称在测试条件下为5000 nit。';
  assert.equal(has(check(d), 'W7'), false);
  d.review_zh = '原厂称适用于户外显示。'; d.body_en = 'This targets outdoor displays.';
  assert.ok(has(check(d), 'W7', 'WARN'));
});

test('W8 per-language character 5-gram containment is reproducible; unrelated history does not collide', () => {
  const body = 'A detailed engineering discussion explains how outdoor display modules use thermal paths and operating conditions to support maintenance decisions.';
  const d = withBody(body);
  const r = check(d, packet, { publishedTexts: [body.toUpperCase()] });
  assert.ok(has(r, 'W8', 'WARN'));
  assert.match(r.findings.find(f => f.ruleId === 'W8')!.reason, /100\.00%/);
  assert.equal(has(check(d, packet, { publishedTexts: ['完全不同的中文历史文章，关于办公设施和印刷工艺的介绍。'] }), 'W8'), false);
  assert.deepEqual(check(d, packet, { publishedTexts: [body] }), check(d, packet, { publishedTexts: [body] }));
});

test('W8 absent history differs from an explicitly empty history; no pooling across historical records', () => {
  assert.ok(has(check(), 'W8', 'WARN'));
  assert.equal(has(check(draft, packet, { publishedTexts: [] }), 'W8'), false);
  assert.equal(has(check(withBody('Short.'), packet, { publishedTexts: [] }), 'W8'), false);
  const d = withBody('abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ9876543210');
  const r = check(d, packet, { publishedTexts: [d.body_en.slice(0, 25), d.body_en.slice(30, 55)] });
  assert.equal(has(r, 'W8'), false);
});

test('all findings slice exactly, including emoji, CRLF and aggregate draft prefixes; input stays untouched', () => {
  const p = old(80); p.articles[0].body_text = '😀 厂商转引Research and Markets。';
  const d = withBody('😀 Latest: the best COB is obsolete.\r\n\r\n5000 nits; market share 30%.\r\nOur customer case study. ![image](https://cdn.example/a.jpg)');
  d.review_zh = '张三·史密斯介绍了星光大学的最新资料，市场份额30%。';
  const before = JSON.stringify([p, d]);
  const r = check(d, p);
  for (const f of r.findings) {
    const value: unknown = f.field === 'source.body_text' ? p.articles[0].body_text! : d[f.field as keyof typeof d];
    assert.equal(typeof value, 'string'); assert.equal((value as string).slice(f.start, f.end), f.quote);
    assert.ok(f.start >= 0 && f.end > f.start);
  }
  const aggregate = editorialGate(p, { ...response, drafts: [d, draft] });
  for (const f of aggregate.findings) {
    if (f.field === 'source.body_text') { assert.equal(p.articles[0].body_text!.slice(f.start, f.end), f.quote); continue; }
    const match = /^drafts\[(\d+)\]\.(\w+)$/.exec(f.field)!;
    const value = [d, draft][Number(match[1])][match[2] as keyof typeof d] as string;
    assert.equal(value.slice(f.start, f.end), f.quote);
  }
  assert.equal(JSON.stringify([p, d]), before);
  assert.equal(aggregate.blocked, true);
  assert.deepEqual(editorialGate(p, { ...response, drafts: [] }), { version: r.version, blocked: false, findings: [], mandatoryReview: [] });
});


test('historical editorial reminders and manufacturer tables do not become automatic blocks',()=>{
 const d=structuredClone(draft);d.review_zh='需要注意归属：下文所有性能表述均来自晶台自己的材料，不是第三方评测。\n\n参数表：6,000 nit。\n\n本稿未做“全面优于”的表述，不写成“最新发布”。';
 d.body_en='## Product boundaries as stated\n\nBrightness is up to 6,000 nit.\n\nBrightness figures above are reported by the manufacturer, not independent measurements. https://maker.example/news';
 const report=evaluateDraft(old(60),d);assert.equal(report.blocked,false);
 const ambiguous=withBody('Technical reference.\n\nBrightness is 6000 nits.\n\nThese are manufacturer statements.');
 // A missing local attribution with clear attribution elsewhere is reviewed, not falsely denied.
 assert.equal(evaluateDraft(packet,ambiguous).findings.some(f=>f.ruleId==='D1'&&f.severity==='BLOCK'),false);
});
