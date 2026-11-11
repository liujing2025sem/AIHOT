import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { fakeApi, startWebServer, visit } from './web-server.ts';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

type FixtureRevision = { status: string; version: number; goals: string[]; note: string; receipt_id?: number; error?: string };

function reviewFixture() {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  let reads = 0;
  const body = 'A whole-cabinet layout is 5760 mm wide.';
  const meta = 'Review the 5760 mm LED cabinet layout.';
  const finding = (field: string, value: string) => ({
    ruleId: 'numeric-source', severity: 'WARN', field,
    start: value.indexOf('5760'), end: value.indexOf('5760') + 4,
    quote: '5760', reason: '请把这处计算结果与绑定原文对照。',
  });
  const draft = {
    id: 'review-fixture', version: 7, status: 'in_review', updated_at: '2026-11-09T08:00:00Z',
    revision_request: null as FixtureRevision | null,
    document: {
      revision_request: null as FixtureRevision | null,
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
  const setRevision = (revision: FixtureRevision) => {
    draft.revision_request = revision;
    draft.document.revision_request = revision;
  };
  const api = fakeApi(async (url, _res, req) => {
    if (url.pathname === '/api/admin/me') return { name: 'Synthetic operator', csrf: 'fixture', dev: false };
    if (url.pathname === '/api/admin/nav-counts') return {};
    if (url.pathname === '/api/admin/studio/capabilities') return { delivery: { mode: 'manual', wordpressWritesAllowed: false, draftPushAllowed: false, readOnlyRecoveryAllowed: true, message: '当前工作台采用手工交付。请下载已批准版本后，由运营上传。' } };
    if (url.pathname === '/api/admin/studio/drafts/review-fixture/covers') return { revision: 0, selectedHash: null, candidates: [], confirmed: false, confirmedVersion: null };
    if (url.pathname === '/api/admin/studio/publishing/settings') return { mode: 'review', enabled: false, daily_limits: { brief: 1, article: 2, guide: 1, update: 0 } };
    if (url.pathname === '/api/admin/studio/drafts/review-fixture' && req.method === 'GET') { reads++; return draft; }
    if (url.pathname.startsWith('/api/admin/studio/drafts/review-fixture') && req.method !== 'GET') {
      let text = ''; for await (const chunk of req) text += chunk;
      const input: Record<string, unknown> = text ? JSON.parse(text) : {};
      writes.push({ path: url.pathname, body: input });
      if (url.pathname.endsWith('/review') && (input.action === 'approve' || input.action === 'submit')) {
        draft.status = input.action === 'approve' ? 'approved' : 'in_review';
        draft.version++;
      }
      if (url.pathname.endsWith('/review') && input.action === 'return') {
        draft.version++;
        draft.status = 'draft';
        setRevision({ status: 'queued', version: draft.version, goals: input.revision_goals as string[], note: input.note as string });
      }
      if (url.pathname.endsWith('/review') && input.action === 'keep_revision_original') {
        draft.version++;
        draft.status = 'draft';
        setRevision({ ...draft.revision_request!, status: 'cancelled' });
      }
      return draft;
    }
  });
  return { api, draft, writes, setRevision, get reads() { return reads; } };
}

test('an older unknown delivery can be checked from an unapproved current draft without resending', async () => {
  const fixture = reviewFixture();
  Object.assign(fixture.draft.wordpress, { recoveryReady: true, currentVersion: 7, approvedVersion: 6, syncedVersion: 4, currentSynced: false,
    receipt: { version: 6, kind: 'guide', section: 'industry', state: 'unknown', editUrl: 'https://example.test/wp-admin/post.php?post=123&action=edit', recoveryKey: 'fixture-only' } });
  const web = await startWebServer(fixture.api); let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await page.route('**/*', route => new URL(route.request().url()).origin === web.origin ? route.continue() : route.abort());
    await visit(page, web.origin + '/admin/studio/drafts/review-fixture?stage=delivery');
    const versions = page.getByLabel('稿件版本对应');
    await expect(versions).toContainText('版本 7');
    await expect(versions).toContainText('版本 6');
    await expect(versions).toContainText('版本 4');
    await expect(page.getByRole('button', { name: '推送WordPress草稿', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '核对上次送达结果', exact: true }).click();
    await expect(page.getByRole('button', { name: '核对上次送达结果', exact: true })).toBeEnabled();
    assert.deepEqual(fixture.writes, [{ path: '/api/admin/studio/drafts/review-fixture/wordpress', body: { version: 6, kind: 'guide', section: 'industry', recoverOnly: true } }]);
    await page.reload();
    await expect(page.getByText('上次送稿结果待核对', { exact: false })).toBeVisible();
    assert.equal(fixture.writes.length, 1, 'reload neither sends nor repeats recovery');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (process.env.AIHOT_VISUAL_DIR) {
      mkdirSync(process.env.AIHOT_VISUAL_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.AIHOT_VISUAL_DIR, 'delivery-390.png'), fullPage: true });
    }
  } finally { await browser?.close(); await web.stop(); }
});

for (const width of [1440, 390]) test('review workbench locates evidence and submits only explicit approval at ' + width, async () => {
  const fixture = reviewFixture();
  const web = await startWebServer(fixture.api);
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await visit(page, web.origin + '/admin/studio/drafts/review-fixture');
    await expect(page.getByRole('heading', { name: '中文决策摘要', exact: true })).toBeVisible();
    await expect(page.getByLabel('中文正文', { exact: true })).toBeHidden();
    await page.getByRole('button', { name: '展开完整稿件', exact: true }).click();
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
    await page.getByRole('navigation', { name: '当前稿件流程' }).getByRole('button', { name: '手工交付', exact: true }).click();
    await expect(page.getByRole('link', { name: '英文 HTML', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '直接上线', exact: true })).toHaveCount(0);
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

    await page.getByRole('button', { name: '展开完整稿件', exact: true }).click();
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
    await page.getByRole('button',{name:'展开完整稿件',exact:true}).click();
    await expect(page.getByRole('tab',{name:'英文交付',exact:true})).toHaveAttribute('aria-selected','true');
    await page.getByRole('checkbox',{name:'确认 正文尺寸数字需与原文一致',exact:true}).check();
    await page.getByRole('checkbox',{name:'确认 搜索摘要数字需与原文一致',exact:true}).check();
    const approve=page.getByRole('button',{name:'确认审核通过',exact:true});await expect(approve).toBeDisabled();
    await page.getByRole('checkbox',{name:'已按当前英文主稿核对',exact:true}).check();await expect(approve).toBeEnabled();
    assert.equal(await page.getByRole('button',{name:'直接上线',exact:true}).count(),0);
    await expect(page.getByRole('button',{name:'推送原页影子预览稿',exact:true})).toHaveCount(0);
    await approve.click();await expect.poll(()=>fixture.writes.length).toBe(1);
    assert.equal(fixture.writes[0].body.english_reviewed,true);
    assert.equal(fixture.writes.some(w=>/\/(publish|wordpress)$/.test(w.path)),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }finally{await browser?.close();await web.stop();}
});

test('review revision goals accept empty optional notes and do not approve or publish',async()=>{
  const fixture=reviewFixture();
  Object.assign(fixture.draft,{editorial_context:{question:'如何选择区域仓现货与原厂直发？',scope_question:'下单前如何核对交付路径？',unanswered_questions:['本次不承诺具体库存与交期']}});
  const web=await startWebServer(fixture.api);let browser;
  try{
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:900}});
    await visit(page,web.origin+'/admin/studio/drafts/review-fixture');
    await expect(page.getByRole('heading',{name:'中文决策摘要',exact:true})).toBeVisible();
    await expect(page.getByText('本次不承诺具体库存与交期',{exact:true})).toBeVisible();
    await expect(page.getByLabel('审稿意见',{exact:true})).toHaveValue('');
    await expect(page.getByRole('checkbox',{name:'更直接回答买家问题',exact:true})).toBeChecked();
    await page.getByRole('checkbox',{name:'只保留有依据的说法',exact:true}).check();
    const revise=page.getByRole('button',{name:'按选择修订',exact:true});
    await expect(revise).toBeEnabled();
    assert.equal(fixture.writes.length,0,'selecting goals does not start a model or change review state');
    await revise.click();
    await expect.poll(()=>fixture.writes.length).toBe(1);
    assert.deepEqual(fixture.writes,[{path:'/api/admin/studio/drafts/review-fixture/review',body:{version:7,action:'return',revision_goals:['clarify_buyer_answer','evidence_only'],note:''}}]);
    await expect(page.getByText('已安排按所选目标修订。当前仍展示原版本，完成后需重新审稿。',{exact:true})).toBeVisible();
    await expect(revise).toBeDisabled();
    await expect(page.getByRole('button',{name:'提交审稿',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'确认审核通过',exact:true})).toHaveCount(0);
    assert.equal(fixture.writes.some(write=>/\/(publish|wordpress)$/.test(write.path)),false);
  }finally{await browser?.close();await web.stop();}
});

for(const status of ['queued','running','unknown','failed'] as const)test(`revision ${status} exposes explicit no-charge recovery and keeps the original without a note`,async()=>{
  const fixture=reviewFixture();
  fixture.setRevision({status,version:7,goals:['clarify_buyer_answer'],note:'',receipt_id:27});
  const {revision_request: _originalRevision,...original}=fixture.draft.document;
  const web=await startWebServer(fixture.api);let browser;
  try{
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:900}});
    await visit(page,web.origin+'/admin/studio/drafts/review-fixture');
    const recover=page.getByRole('button',{name:'核对修订结果',exact:true});
    const keep=page.getByRole('button',{name:'保留原稿继续',exact:true});
    await expect(recover).toBeEnabled();await expect(keep).toBeEnabled();
    await expect(page.getByText(/这两个操作均不重新调用付费模型/)).toBeVisible();
    assert.equal(fixture.writes.length,0,'loading a revision never triggers recovery or another model call');
    await recover.click();
    await expect.poll(()=>fixture.writes.length).toBe(1);
    assert.deepEqual(fixture.writes[0],{path:'/api/admin/studio/drafts/review-fixture/review',body:{version:7,action:'recover_revision'}});
    await expect(keep).toBeEnabled();await keep.click();
    await expect.poll(()=>fixture.writes.length).toBe(2);
    assert.deepEqual(fixture.writes[1],{path:'/api/admin/studio/drafts/review-fixture/review',body:{version:7,action:'keep_revision_original'}});
    await expect(page.getByText('已保留原稿，结束本次修订等待。可以继续审阅。',{exact:true})).toBeVisible();
    await expect(recover).toHaveCount(0);await expect(keep).toHaveCount(0);
    await expect(page.getByRole('button',{name:'按选择修订',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'展开完整稿件',exact:true}).click();
    await expect(page.getByLabel('中文正文',{exact:true})).toBeEditable();
    await expect(page.getByRole('button',{name:'确认审核通过',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'提交审稿',exact:true}).click();
    await expect.poll(()=>fixture.writes.length).toBe(3);
    assert.deepEqual(fixture.writes[2],{path:'/api/admin/studio/drafts/review-fixture/review',body:{version:8,action:'submit',note:''}});
    const approve=page.getByRole('button',{name:'确认审核通过',exact:true});await expect(approve).toBeDisabled();
    await page.getByRole('checkbox',{name:'确认 正文尺寸数字需与原文一致',exact:true}).check();
    await page.getByRole('checkbox',{name:'确认 搜索摘要数字需与原文一致',exact:true}).check();
    await expect(approve).toBeEnabled();
    const {revision_request: _cancelledRevision,...retained}=fixture.draft.document;
    assert.deepEqual(retained,original);
    assert.equal(fixture.writes.some(write=>write.body.action==='return'||write.body.action==='approve'||/\/(publish|wordpress)$/.test(write.path)),false);
  }finally{await browser?.close();await web.stop();}
});

test('same-version revision metadata updates leave both recovery exits usable without unsaved edits',async()=>{
  const fixture=reviewFixture();
  fixture.setRevision({status:'queued',version:7,goals:['clarify_buyer_answer'],note:''});
  const web=await startWebServer(fixture.api);let browser;
  try{
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:900}});
    await page.clock.install();
    await visit(page,web.origin+'/admin/studio/drafts/review-fixture');
    await expect(page.getByText('已安排按所选目标修订。当前仍展示原版本，完成后需重新审稿。',{exact:true})).toBeVisible();
    fixture.setRevision({status:'running',version:7,goals:['clarify_buyer_answer'],note:'',receipt_id:27});
    await page.clock.runFor(3600);
    await expect(page.getByText('正在修订。原版本与审核记录保留，暂不代表修改已完成。',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'核对修订结果',exact:true})).toBeEnabled();
    await expect(page.getByRole('button',{name:'保留原稿继续',exact:true})).toBeEnabled();
    await expect(page.getByText('先保存修改，系统会按新版本重新核对。',{exact:true})).toHaveCount(0);
    assert.equal(fixture.draft.version,7);
    assert.deepEqual(fixture.writes,[]);
  }finally{await browser?.close();await web.stop();}
});

test('unknown revision recovery observes a later result without another recovery or writer request',async()=>{
  const fixture=reviewFixture();
  fixture.setRevision({status:'unknown',version:7,goals:['clarify_buyer_answer'],note:'',receipt_id:27});
  const web=await startWebServer(fixture.api);let browser;
  try{
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:900}});
    await page.clock.install();
    await visit(page,web.origin+'/admin/studio/drafts/review-fixture');
    const reads=fixture.reads;
    await page.getByRole('button',{name:'核对修订结果',exact:true}).click();
    await expect.poll(()=>fixture.reads).toBeGreaterThan(reads);
    await expect(page.getByText('正在核对已有修订结果，最多等待 20 秒；可随时保留原稿继续。',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'保留原稿继续',exact:true})).toBeEnabled();
    fixture.draft.version=8;fixture.draft.status='draft';
    fixture.draft.document.review_zh='修订结果：先按箱体数量复核可用显示面积。';
    fixture.setRevision({status:'done',version:7,goals:['clarify_buyer_answer'],note:'',receipt_id:27});
    await page.clock.runFor(3600);
    await expect(page.getByText(fixture.draft.document.review_zh,{exact:true}).first()).toBeVisible();
    await expect(page.getByText('修订已返回，请核对当前版本。',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'提交审稿',exact:true})).toBeEnabled();
    await expect(page.getByRole('button',{name:'核对修订结果',exact:true})).toHaveCount(0);
    await expect(page.getByText(/正在核对已有修订结果/)).toHaveCount(0);
    assert.deepEqual(fixture.writes,[{path:'/api/admin/studio/drafts/review-fixture/review',body:{version:7,action:'recover_revision'}}]);
  }finally{await browser?.close();await web.stop();}
});

test('recovery stops waiting after twenty seconds without claiming completion or locking the original',async()=>{
  const fixture=reviewFixture();
  fixture.setRevision({status:'failed',version:7,goals:['clarify_buyer_answer'],note:'',receipt_id:27});
  const web=await startWebServer(fixture.api);let browser;
  try{
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:900}});
    await page.clock.install();
    await visit(page,web.origin+'/admin/studio/drafts/review-fixture');
    await page.getByRole('button',{name:'核对修订结果',exact:true}).click();
    await expect(page.getByText(/正在核对已有修订结果/)).toBeVisible();
    await expect(page.getByRole('button',{name:'保留原稿继续',exact:true})).toBeEnabled();
    await page.clock.runFor(20_100);
    await expect(page.getByText('本次核对尚未返回新结果，可稍后再查或保留原稿继续。未重新调用付费模型。',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'核对修订结果',exact:true})).toBeEnabled();
    await expect(page.getByRole('button',{name:'保留原稿继续',exact:true})).toBeEnabled();
    await expect(page.getByText('修订已返回，请核对当前版本。',{exact:true})).toHaveCount(0);
    await page.clock.runFor(8_000);
    assert.deepEqual(fixture.writes,[{path:'/api/admin/studio/drafts/review-fixture/review',body:{version:7,action:'recover_revision'}}]);
  }finally{await browser?.close();await web.stop();}
});
