import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { closeDb } from '../packages/backend/src/db.ts';
import { deriveStudioSocialDocument, evaluateStudioSocial, studioSocialContent, validateSocialBlogUrl, type StudioSocialDocument } from '../packages/backend/src/admin/studio-social.ts';
import { validateEditorialConfirmations } from '../packages/backend/src/admin/editorial-issues.ts';
import { sha256, type Packet } from '../scripts/editorial-pilot-lib.ts';

after(closeDb);
const sourceText = 'The manufacturer describes LED display operating conditions. Unused detail: citing TrendForce.';
const source = { article_id: 'social-synthetic', revision: 1, content_sha256: sha256(JSON.stringify(['LED display source', 'ok', sourceText])),
  url: 'https://maker.example.test/led-news', published_at: '2026-11-03T09:00:00Z' };
const packet = { schema: 'aihot-editorial-pilot/1', task_id: 'social-synthetic-task', created_at: '2026-11-03T10:00:00Z',
  scope: 'LOCAL_AGENT_HANDOFF_NOT_AUTOMATED_AIHOT_PIPELINE', draft_article_ids: [source.article_id],
  articles: [{ binding: source, source_id: 'social-synthetic-maker', source_name: 'Synthetic Manufacturer',
    title: 'LED display source', body_status: 'ok', body_text: sourceText }],
} satisfies Packet;
const binding = { id: 'social-synthetic-post', draft_id: 'social-synthetic-blog', parent_version: 4, created_at: new Date('2026-11-03T11:00:00Z') };
const document = { platform: 'facebook', language: 'en', title: 'LED display operating conditions',
  body: 'According to the manufacturer, the LED display operating conditions should be checked before planning an installation.',
  blog_url: 'https://chipshow.com/blog/synthetic-operator-supplied-url/', source, news_status: 'reported',
} satisfies StudioSocialDocument;
const review = (body: string, language: 'en' | 'zh' = 'en') => evaluateStudioSocial(packet, { ...document, language, body }, binding);

test('stored Blog metadata and unused paragraphs stay out of deterministic complete-paragraph derivation', () => {
  const first = 'According to the manufacturer, the maximum brightness is 5000 nits under the stated test conditions.';
  const parent = { source, title_en: document.title, title_zh: '原厂显示屏条件', review_zh: '据原厂介绍，安装前需要核对显示屏条件。\n\n未使用段落。',
    body_en: `## Overview\n\n${first}\n\nUNUSED_PARENT_PARAGRAPH`, meta_description_en: 'LED display conditions.',
    evidence: [{ claim: 'Conditions', quote: 'LED display operating conditions.' }], questions_zh: [], keyword_hypothesis: 'LED display',
    editorial_gate: { stored: 'UNUSED_PARENT_GATE' }, camos: { private: 'UNUSED_PARENT_CAMOS' } };
  const en = deriveStudioSocialDocument(parent, { platform: 'linkedin', language: 'en', blog_url: document.blog_url });
  assert.equal(en.body, first);
  assert.doesNotMatch(JSON.stringify(en), /UNUSED_PARENT|未使用段落|editorial_gate|camos/);
  const zh = deriveStudioSocialDocument(parent, { platform: 'facebook', language: 'zh', blog_url: document.blog_url });
  assert.equal(zh.body, '据原厂介绍，安装前需要核对显示屏条件。');
  assert.deepEqual(zh.source, source);
});

test('operator Blog URLs require the matching Chipshow site and a non-root path, without inventing a URL', () => {
  for (const site of ['chipshow.com', 'chipshowledusa.com', 'chipshow.eu']) {
    const url = `https://www.${site}/blog/actual-operator-url/?ref=social`;
    assert.equal(validateSocialBlogUrl(url, site), url);
  }
  for (const url of ['https://chipshow.com/', 'https://chipshow.com////', 'http://chipshow.com/blog/post/',
    'https://chipshow.com.evil.test/blog/post/', 'https://unishineled.com/blog/post/', 'https://chipshow.eu/blog/post/',
    'https://user:password@chipshow.com/blog/post/', 'https://chipshow.com:1234/blog/post/', 'https://chipshow.com/blog/../']) {
    assert.throws(() => validateSocialBlogUrl(url));
  }
});

test('single-language review keeps locators on the social title/body and excludes unused parent/source and W7 reminders', () => {
  for (const language of ['en', 'zh'] as const) {
    const doc = { ...document, language, title: language === 'zh' ? '显示屏安装条件' : document.title,
      body: language === 'zh' ? '据原厂介绍，安装显示屏前需要确认使用环境和配套条件。' : document.body,
      news_status: 'unconfirmed' as const };
    const result = evaluateStudioSocial(packet, doc, binding);
    assert.ok(result.issues.items.every(item => item.ruleId !== 'W7' && item.ruleId !== 'W3'));
    for (const finding of result.gate.findings) {
      assert.ok(['title', 'body'].includes(finding.field));
      const text = finding.field === 'title' ? doc.title : doc.body;
      assert.equal(text.slice(finding.start, finding.end), finding.quote);
    }
    assert.equal(result.gate.blocked, false);
  }
  const used = review('According to the manufacturer, citing TrendForce, the display details need checking.');
  assert.ok(used.gate.findings.some(finding => finding.ruleId === 'W3' && finding.field === 'body' && finding.quote === 'TrendForce'));
});

test('D1–D10 relevant to edited posts remain enforceable with only post-local occurrences', () => {
  const cases: [string, string, 'en' | 'zh'][] = [
    ['D1', 'Brightness is 6000 nits.', 'en'], ['D2', 'This is the best display.', 'en'],
    ['D4', '星光大学介绍了新的显示屏资料。', 'zh'], ['D5', 'Our display is CE certified.', 'en'],
    ['D6', 'We guarantee delivery in 5 days.', 'en'], ['D7', 'COB is obsolete.', 'en'],
    ['D8', 'Our customer case study needs checking.', 'en'], ['D9', 'Market share is 30%.', 'en'],
    ['D10', '![image](https://images.example.test/synthetic.jpg)', 'en'],
  ];
  for (const [ruleId, text, language] of cases) {
    assert.ok(review(text, language).gate.findings.some(finding => finding.ruleId === ruleId), ruleId);
  }
  const old = { ...binding, created_at: new Date('2026-12-20T11:00:00Z') };
  assert.ok(evaluateStudioSocial(packet, { ...document, body: 'The latest LED display release.' }, old).gate.findings
    .some(finding => finding.ruleId === 'D3' && finding.severity === 'BLOCK'));
});

test('WARN requires individual current fingerprints, BLOCK cannot be checked, and edits invalidate confirmations', () => {
  const warned = review('According to the manufacturer, brightness is 5000 nits.');
  assert.equal(warned.gate.blocked, false);
  assert.ok(warned.issues.items.some(item => item.ruleId === 'W4'));
  assert.equal(validateEditorialConfirmations(warned.issues, { confirmations: [] }).canApprove, false);
  assert.equal(validateEditorialConfirmations(warned.issues, { confirmAll: true }).canApprove, false);
  const confirmations = warned.issues.items.filter(item => item.confirmable).map(item => ({ issueId: item.id, fingerprint: item.fingerprint }));
  assert.equal(validateEditorialConfirmations(warned.issues, { confirmations }).canApprove, true);
  const edited = review('According to the manufacturer, brightness is 5500 nits.');
  assert.equal(validateEditorialConfirmations(edited.issues, { confirmations }).canApprove, false);
  const blocked = review('This is the best display.');
  const checkedBlock = blocked.issues.items.map(item => ({ issueId: item.id, fingerprint: item.fingerprint }));
  assert.equal(validateEditorialConfirmations(blocked.issues, { confirmations: checkedBlock }).canApprove, false);
  assert.ok(validateEditorialConfirmations(blocked.issues, { confirmations: checkedBlock }).errors.some(error => error.code === 'block-not-confirmable'));
});

test('fixed export text retains Blog backlink, original source/date/status and Unicode counts for either independent language', () => {
  for (const language of ['en', 'zh'] as const) {
    const doc = { ...document, language, title: language === 'zh' ? '显示屏条件😀' : document.title,
      body: language === 'zh' ? '请在使用前核对安装条件。' : 'Check operating conditions before installation.' };
    const { text, counts } = studioSocialContent(doc);
    assert.ok(text.includes(doc.blog_url));
    assert.ok(text.includes(source.url));
    assert.ok(text.includes(source.published_at));
    assert.equal(counts.characterCount, [...text].length);
    assert.ok(counts.wordCount > 0);
    if (language === 'en') assert.doesNotMatch(text, /[\u3400-\u9fff]/);
  }
  const unknown = studioSocialContent({ ...document, source: { ...source, published_at: null }, news_status: 'unconfirmed' });
  assert.match(unknown.text, /not provided/);
  assert.match(unknown.text, /Unconfirmed report/);
});
