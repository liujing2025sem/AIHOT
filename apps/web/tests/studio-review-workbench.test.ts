import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { fakeApi, startWebServer, visit } from './web-server.ts';

function reviewFixture() {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const body = 'A whole-cabinet layout is 5760 mm wide.';
  const meta = 'Review the 5760 mm LED cabinet layout.';
  const finding = (field: string, value: string) => ({
    ruleId: 'numeric-source', severity: 'WARN', field,
    start: value.indexOf('5760'), end: value.indexOf('5760') + 4,
    quote: '5760', reason: '请把这处计算结果与绑定原文对照。',
  });
  const draft = {
    id: 'review-fixture', version: 7, status: 'in_review', updated_at: '2026-11-09T08:00:00Z',
    document: {
      title_en: 'LED cabinet layout', title_zh: 'LED 箱体布局核对',
      review_zh: '先核对完整箱体数量，再确认最终显示尺寸。', body_en: body,
      keyword_hypothesis: 'LED cabinet layout', meta_description_en: meta,
      questions_zh: [], evidence: [{ claim: '5760 mm comes from six whole cabinets.', quote: '6 × 960 mm = 5760 mm.' }],
      source: { url: 'https://example.test/cabinets', revision: 3, published_at: '2026-11-08T12:00:00Z' },
    },
    source_snapshot: { body_text: '6 × 960 mm = 5760 mm.', title: 'Synthetic source' },
    material: { title: 'Synthetic source', body_text: '6 × 960 mm = 5760 mm.', revision: 3 },
    gate: { blocked: false, findings: [], mandatoryReview: [] },
    issues: {
      items: [
        { id: 'body-number', fingerprint: 'body-number-v7-source3', ruleId: 'numeric-source', severity: 'WARN', title: '正文尺寸数字需与原文一致', group: 'required', confirmable: true, count: 1, occurrences: [finding('body_en', body)] },
        { id: 'meta-number', fingerprint: 'meta-number-v7-source3', ruleId: 'numeric-source', severity: 'WARN', title: '搜索摘要数字需与原文一致', group: 'required', confirmable: true, count: 1, occurrences: [finding('meta_description_en', meta)] },
      ],
      summary: { findingCount: 2, issueCount: 2, requiredCount: 2, recommendedCount: 0 },
    },
    confirmed_issues: [], history: [],
    wordpress: { ready: false, message: '人审草稿通道未启用。', receipt: null },
  };
  const api = fakeApi(async (url, _res, req) => {
    if (url.pathname === '/api/admin/me') return { name: 'Synthetic operator', csrf: 'fixture', dev: false };
    if (url.pathname === '/api/admin/nav-counts') return {};
    if (url.pathname === '/api/admin/studio/publishing/settings') return { mode: 'review', enabled: false, daily_limits: { brief: 1, article: 2, guide: 1, update: 0 } };
    if (url.pathname === '/api/admin/studio/drafts/review-fixture' && req.method === 'GET') return draft;
    if (url.pathname.startsWith('/api/admin/studio/drafts/review-fixture') && req.method !== 'GET') {
      let text = ''; for await (const chunk of req) text += chunk;
      const input: Record<string, unknown> = text ? JSON.parse(text) : {};
      writes.push({ path: url.pathname, body: input });
      if (url.pathname.endsWith('/review') && input.action === 'approve') draft.status = 'approved';
      return draft;
    }
  });
  return { api, draft, writes };
}

for (const width of [1440, 390]) test('review workbench locates evidence and submits only explicit approval at ' + width, async () => {
  const fixture = reviewFixture();
  const web = await startWebServer(fixture.api);
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await visit(page, web.origin + '/admin/studio/drafts/review-fixture');
    await expect(page.getByRole('tab', { name: '中文审稿', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('中文正文', { exact: true })).toHaveValue(fixture.draft.document.review_zh);
    await expect(page.getByRole('complementary', { name: '审稿确认与交付', exact: true })).toBeVisible();
    const approve = page.getByRole('button', { name: '确认审核通过', exact: true });
    await expect(approve).toBeDisabled();

    const bodyIssue = page.getByRole('listitem').filter({ has: page.getByText('正文尺寸数字需与原文一致', { exact: true }) });
    await bodyIssue.getByRole('button', { name: '查看原因与 1 处原文', exact: true }).click();
    await bodyIssue.getByRole('button', { name: '定位到稿件', exact: true }).click();
    await expect(page.getByRole('tab', { name: '英文交付', exact: true })).toHaveAttribute('aria-selected', 'true');
    const body = page.getByLabel('English body · Markdown', { exact: true });
    await expect(body).toBeFocused();
    assert.equal(await body.evaluate(el => { const text = el as HTMLTextAreaElement; return text.value.slice(text.selectionStart, text.selectionEnd); }), '5760');

    const metaIssue = page.getByRole('listitem').filter({ has: page.getByText('搜索摘要数字需与原文一致', { exact: true }) });
    await metaIssue.getByRole('button', { name: '查看原因与 1 处原文', exact: true }).click();
    await metaIssue.getByRole('button', { name: '定位到稿件', exact: true }).click();
    await expect(page.getByRole('button', { name: '搜索摘要与消息状态', exact: true })).toHaveAttribute('aria-expanded', 'true');
    const description = page.getByLabel('Meta description', { exact: true });
    await expect(description).toBeFocused();
    assert.equal(await description.evaluate(el => { const text = el as HTMLInputElement; return text.value.slice(text.selectionStart ?? 0, text.selectionEnd ?? 0); }), '5760');

    await page.getByRole('checkbox', { name: '确认 正文尺寸数字需与原文一致', exact: true }).check();
    await expect(approve).toBeDisabled();
    await page.getByRole('checkbox', { name: '确认 搜索摘要数字需与原文一致', exact: true }).check();
    await expect(approve).toBeEnabled();
    assert.equal(fixture.writes.length, 0, 'viewing evidence and checking issues do not approve, publish, or modify the draft');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

    await approve.click();
    await expect.poll(() => fixture.writes.length).toBe(1);
    assert.deepEqual(fixture.writes[0], {
      path: '/api/admin/studio/drafts/review-fixture/review',
      body: {
        version: 7, action: 'approve', note: '',
        confirmations: [
          { issueId: 'body-number', fingerprint: 'body-number-v7-source3' },
          { issueId: 'meta-number', fingerprint: 'meta-number-v7-source3' },
        ],
      },
    });
    await expect(page.getByRole('link', { name: '英文 HTML', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '直接上线', exact: true })).toBeDisabled();
    assert.equal(fixture.writes.some(write => /\/(publish|wordpress)$/.test(write.path)), false, 'human approval does not initiate a publishing request');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await web.stop(); }
});

for (const width of [1440, 390]) test('unsaved draft changes disable issue confirmation and human approval at ' + width, async () => {
  const fixture = reviewFixture();
  const web = await startWebServer(fixture.api);
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await visit(page, web.origin + '/admin/studio/drafts/review-fixture');
    const first = page.getByRole('checkbox', { name: '确认 正文尺寸数字需与原文一致', exact: true });
    const second = page.getByRole('checkbox', { name: '确认 搜索摘要数字需与原文一致', exact: true });
    await first.check(); await second.check();
    const approve = page.getByRole('button', { name: '确认审核通过', exact: true });
    await expect(approve).toBeEnabled();

    await page.getByLabel('中文正文', { exact: true }).fill('修改后的内容需要重新保存和核对。');
    await expect(first).toBeDisabled(); await expect(second).toBeDisabled();
    await expect(approve).toBeDisabled();
    await expect(page.getByRole('button', { name: '保存逐项确认', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
    await expect(page.getByText('先保存修改，系统会按新版本重新核对。', { exact: true })).toBeVisible();
    assert.equal(fixture.writes.length, 0, 'editing local text never manufactures a review or starts publication');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  } finally { await browser?.close(); await web.stop(); }
});

test('a BLOCK draft can save progress and adopt an exact English suggestion without any publishing call',async()=>{
  const fixture=reviewFixture();
  const issue=fixture.draft.issues.items[0];
  issue.severity='BLOCK';issue.confirmable=false;fixture.draft.gate.blocked=true;
  Object.assign(fixture.draft,{suggestions:[{id:'current-edit',issueId:issue.id,fingerprint:issue.fingerprint,field:'body_en',before:fixture.draft.document.body_en,after:'',label:'采纳修改：删去这句待核实表述',explanation:'只修改英文主稿；其余问题保留。'}]});
  const web=await startWebServer(fixture.api);let browser;
  try{
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:900}});
    await visit(page,web.origin+'/admin/studio/drafts/review-fixture');
    await expect(page.getByRole('button',{name:'保存逐项确认',exact:true})).toBeEnabled();
    await expect(page.getByRole('button',{name:'确认审核通过',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'采纳修改：删去这句待核实表述',exact:true}).click();
    await expect.poll(()=>fixture.writes.length).toBe(1);
    assert.deepEqual(fixture.writes[0],{path:'/api/admin/studio/drafts/review-fixture/apply-edit',body:{version:7,issueId:issue.id,fingerprint:issue.fingerprint,suggestionId:'current-edit'}});
    assert.equal(fixture.writes.some(w=>/\/(publish|wordpress)$/.test(w.path)),false);
  }finally{await browser?.close();await web.stop();}
});

test('a stale Chinese review requires current English acknowledgement and a bound upgrade has no publish button',async()=>{
  const fixture=reviewFixture();
  Object.assign(fixture.draft,{review_sync:{status:'stale',english_hash:'test-current-hash'},upgrade_context:{target_existing_url:'https://example.test/original-6098',target_post_id:6098,baseline_sha256:'original-hash',changes:[{operation:'revise',paragraph:'p3',reason:'像素取整'}],notice:'独立影子预览，不修改原页面。'}});
  const web=await startWebServer(fixture.api);let browser;
  try{
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:900}});
    await visit(page,web.origin+'/admin/studio/drafts/review-fixture');
    await expect(page.getByRole('tab',{name:'英文交付',exact:true})).toHaveAttribute('aria-selected','true');
    await page.getByRole('checkbox',{name:'确认 正文尺寸数字需与原文一致',exact:true}).check();
    await page.getByRole('checkbox',{name:'确认 搜索摘要数字需与原文一致',exact:true}).check();
    const approve=page.getByRole('button',{name:'确认审核通过',exact:true});await expect(approve).toBeDisabled();
    await page.getByRole('checkbox',{name:'已按当前英文主稿核对',exact:true}).check();await expect(approve).toBeEnabled();
    assert.equal(await page.getByRole('button',{name:'直接上线',exact:true}).count(),0);
    await expect(page.getByRole('button',{name:'推送原页影子预览稿',exact:true})).toBeDisabled();
    await approve.click();await expect.poll(()=>fixture.writes.length).toBe(1);
    assert.equal(fixture.writes[0].body.english_reviewed,true);
    assert.equal(fixture.writes.some(w=>/\/(publish|wordpress)$/.test(w.path)),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }finally{await browser?.close();await web.stop();}
});
