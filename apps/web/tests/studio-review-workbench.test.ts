import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, expect, type Page } from '@playwright/test';
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
    manual_edit_recovery: undefined as { available: boolean } | null | undefined,
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
    confirmed_issues: [] as { issueId: string; fingerprint: string }[], history: [],
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
      if (url.pathname === '/api/admin/studio/drafts/review-fixture' && req.method === 'PATCH') {
        if (input.version !== draft.version) {
          _res.statusCode = 409;
          return { code: 'conflict', detail: '这篇稿件已被修改，请刷新查看最新版本后再保存。' };
        }
        const { version: _, ...fields } = input;
        Object.assign(draft.document, fields);
        draft.status = 'draft';
        draft.version++;
        draft.manual_edit_recovery = null;
      }
      if (url.pathname.endsWith('/review') && (input.action === 'approve' || input.action === 'submit')) {
        draft.status = input.action === 'approve' ? 'approved' : 'in_review';
        draft.version++;
      }
      if (url.pathname.endsWith('/review') && input.action === 'confirm') {
        if (input.version !== draft.version) {
          _res.statusCode = 409;
          return { code: 'conflict', detail: '稿件版本已更新，请重新核对后暂存。' };
        }
        draft.confirmed_issues = input.confirmations as typeof draft.confirmed_issues;
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

async function openEnglishDraft(page: Page) {
  await expect(page.getByRole('navigation', { name: '当前稿件流程' }).getByRole('button', { name: '审正文', exact: true })).toHaveAttribute('aria-current', 'step');
  const expand = page.getByRole('button', { name: '展开完整稿件', exact: true });
  if (await expand.isVisible()) await expand.click();
  await page.getByRole('tab', { name: '英文交付', exact: true }).click();
  return page.getByLabel('英文正文（源稿）', { exact: true });
}

async function captureReviewState(page: Page, name: string, width: number) {
  const directory = process.env.AIHOT_UI_REVIEW_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `review-${name}-${width}.png`), fullPage: true });
}

for (const width of [1440, 390]) test('saved fragment changes can be rechecked without editing the current document at ' + width, async () => {
  const fixture = reviewFixture();
  fixture.draft.manual_edit_recovery = { available: true };
  fixture.draft.status = width === 390 ? 'draft' : 'in_review';
  const savedText = fixture.draft.document.body_en;
  const expected = {
    version: fixture.draft.version,
    title_zh: fixture.draft.document.title_zh, title_en: fixture.draft.document.title_en,
    review_zh: fixture.draft.document.review_zh, body_en: savedText,
    keyword_hypothesis: fixture.draft.document.keyword_hypothesis,
    meta_description_en: fixture.draft.document.meta_description_en,
    questions_zh: fixture.draft.document.questions_zh, news_status: 'reported',
  };
  const web = await startWebServer(fixture.api); let browser;
  let release = () => {};
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await visit(page, web.origin + '/admin/studio/drafts/review-fixture');
    const recovery = page.getByRole('button', { name: '重新核对已存修改', exact: true });
    await expect(recovery).toBeEnabled();
    const body = await openEnglishDraft(page);
    await expect(body).toHaveValue(savedText);
    await captureReviewState(page, 'saved-edit-recovery', width);

    await body.fill(savedText + '\nAn unsaved local note.');
    await expect(recovery).toBeDisabled();
    await body.fill(savedText);
    await expect(recovery).toBeEnabled();
    assert.equal(fixture.writes.length, 0, 'opening recovery and restoring a local edit do not save or approve');

    let pending = false;
    const wait = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/admin/studio/drafts/review-fixture', async route => {
      if (route.request().method() === 'PATCH') { pending = true; await wait; }
      await route.continue();
    });
    await recovery.click();
    await expect.poll(() => pending).toBe(true);
    await expect(recovery).toBeDisabled();
    release();
    await expect.poll(() => fixture.draft.version).toBe(8);
    await expect(recovery).toHaveCount(0);
    await expect(page.getByRole('button', { name: '提交审稿', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '确认审核通过', exact: true })).toHaveCount(0);
    await expect(await openEnglishDraft(page)).toHaveValue(savedText);
    assert.deepEqual(fixture.writes, [{ path: '/api/admin/studio/drafts/review-fixture', body: expected }]);
    assert.equal(fixture.draft.status, 'draft');
    assert.equal(fixture.draft.manual_edit_recovery, null);
    assert.equal(fixture.draft.document.body_en, savedText);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  } finally { release(); await browser?.close(); await web.stop(); }
});

test('saved-edit recovery requires the server capability and an editable draft state', async () => {
  const fixture = reviewFixture();
  const web = await startWebServer(fixture.api); let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const cases = [
      { label: 'older response without the capability', status: 'in_review', capability: undefined },
      { label: 'no safe synchronization', status: 'in_review', capability: null },
      { label: 'explicitly unavailable', status: 'draft', capability: { available: false } },
      { label: 'already approved', status: 'approved', capability: { available: true } },
    ];
    for (const entry of cases) {
      fixture.draft.status = entry.status;
      fixture.draft.manual_edit_recovery = entry.capability;
      await visit(page, web.origin + '/admin/studio/drafts/review-fixture');
      await expect(page.getByRole('button', { name: '重新核对已存修改', exact: true }), entry.label).toHaveCount(0);
    }
    fixture.draft.status = 'in_review';
    fixture.draft.manual_edit_recovery = undefined;
    Object.assign(fixture.draft.gate, { blocked: true, findings: [{ ruleId: 'D1', severity: 'BLOCK', field: 'body_en', start: 0, end: 4, quote: '5760', reason: '技术数值缺少可识别的厂商或原文归属；需保留其声明主体。' }] });
    Object.assign(fixture.draft.issues.items[0], { ruleId: 'D1', severity: 'BLOCK', confirmable: false });
    await visit(page, web.origin + '/admin/studio/drafts/review-fixture');
    await expect(page.getByRole('button', { name: '重新核对已存修改', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '确认审核通过', exact: true })).toBeDisabled();
    assert.equal(fixture.writes.length, 0, 'capability checks and ordinary D1 issues never trigger a repair');
  } finally { await browser?.close(); await web.stop(); }
});

test('an outdated saved-edit recovery keeps the local body and recovery action after a conflict', async () => {
  const fixture = reviewFixture();
  fixture.draft.manual_edit_recovery = { available: true };
  const savedText = fixture.draft.document.body_en;
  const web = await startWebServer(fixture.api); let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const local = await context.newPage(), remote = await context.newPage();
    const url = web.origin + '/admin/studio/drafts/review-fixture';
    await visit(local, url); await visit(remote, url);
    const body = await openEnglishDraft(local);
    const recovery = local.getByRole('button', { name: '重新核对已存修改', exact: true });
    await expect(recovery).toBeEnabled();
    const remoteText = 'The other operator saved a newer cabinet installation note.';
    await (await openEnglishDraft(remote)).fill(remoteText);
    await remote.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect.poll(() => fixture.draft.version).toBe(8);

    await recovery.click();
    await expect(local.getByText('这篇稿件已被修改，请刷新查看最新版本后再保存。', { exact: true })).toBeVisible();
    await expect(body).toHaveValue(savedText);
    await expect(recovery).toBeEnabled();
    assert.equal(fixture.writes.length, 2, 'only the remote save and rejected recovery reach the API');
    assert.equal(fixture.writes[1].body.version, 7);
    assert.equal(fixture.writes[1].body.body_en, savedText);
    assert.equal(fixture.draft.version, 8);
    assert.equal(fixture.draft.document.body_en, remoteText);
    assert.equal(fixture.writes.some(write => /\/(review|generate|wordpress|publish)$/.test(write.path)), false);
  } finally { await browser?.close(); await web.stop(); }
});

test('dirty step navigation keeps local text across another page saving and an outdated save', async () => {
  const fixture = reviewFixture();
  const web = await startWebServer(fixture.api); let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const local = await context.newPage(), remote = await context.newPage();
    const url = web.origin + '/admin/studio/drafts/review-fixture?stage=review';
    await visit(local, url); await visit(remote, url);
    const localBody = await openEnglishDraft(local), remoteBody = await openEnglishDraft(remote);
    const localText = 'My unsaved cabinet installation note.';
    const remoteText = 'The other operator saved this cabinet installation note.';
    await localBody.fill(localText);
    await remoteBody.fill(remoteText);
    await remote.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect.poll(() => fixture.draft.version).toBe(8);
    await expect(remote.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled();
    assert.equal(fixture.draft.document.body_en, remoteText);

    const dialogs: string[] = [];
    let discard = false;
    local.on('dialog', async dialog => {
      dialogs.push(dialog.message());
      await (discard ? dialog.accept() : dialog.dismiss());
    });
    const flow = local.getByRole('navigation', { name: '当前稿件流程' });
    for (const step of ['配封面', '手工交付']) {
      const before = dialogs.length;
      await flow.getByRole('button', { name: step, exact: true }).click();
      await expect.poll(() => dialogs.length).toBe(before + 1);
      await expect(localBody).toHaveValue(localText);
      await expect(flow.getByRole('button', { name: '审正文', exact: true })).toHaveAttribute('aria-current', 'step');
      await expect(local).toHaveURL(url);
    }
    await local.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(local.getByText('这篇稿件已被修改，请刷新查看最新版本后再保存。', { exact: true })).toBeVisible();
    await expect(localBody).toHaveValue(localText);
    assert.equal(fixture.draft.document.body_en, remoteText);
    assert.equal(fixture.draft.version, 8);
    assert.equal(fixture.writes.length, 2, 'only the remote save and rejected local save reach the API');
    assert.equal(fixture.writes[1].body.version, 7, 'the rejected buffer retains its original version');

    discard = true;
    await flow.getByRole('button', { name: '配封面', exact: true }).click();
    await expect(flow.getByRole('button', { name: '配封面', exact: true })).toHaveAttribute('aria-current', 'step');
    await flow.getByRole('button', { name: '审正文', exact: true }).click();
    await expect(await openEnglishDraft(local)).toHaveValue(remoteText);
    assert.equal(dialogs.length, 3, 'only dirty transitions ask for a discard decision');
    assert.equal(fixture.writes.length, 2, 'discarding and switching steps do not save or publish');
  } finally { await browser?.close(); await web.stop(); }
});

test('discarding dirty step navigation restores the saved text without changing its version', async () => {
  const fixture = reviewFixture();
  const savedText = fixture.draft.document.body_en;
  const web = await startWebServer(fixture.api); let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await visit(page, web.origin + '/admin/studio/drafts/review-fixture?stage=review');
    const body = await openEnglishDraft(page);
    await body.fill('An unsaved note that the operator decides to discard.');
    const dialogs: string[] = [];
    let discard = false;
    page.on('dialog', async dialog => {
      dialogs.push(dialog.message());
      await (discard ? dialog.accept() : dialog.dismiss());
    });
    const flow = page.getByRole('navigation', { name: '当前稿件流程' });
    await flow.getByRole('button', { name: '手工交付', exact: true }).click();
    await expect.poll(() => dialogs.length).toBe(1);
    await expect(body).toHaveValue('An unsaved note that the operator decides to discard.');
    discard = true;
    await flow.getByRole('button', { name: '手工交付', exact: true }).click();
    await expect(flow.getByRole('button', { name: '手工交付', exact: true })).toHaveAttribute('aria-current', 'step');
    await flow.getByRole('button', { name: '审正文', exact: true }).click();
    await expect(await openEnglishDraft(page)).toHaveValue(savedText);
    assert.equal(dialogs.length, 2, 'returning after explicit discard is clean');
    assert.equal(fixture.draft.version, 7);
    assert.equal(fixture.writes.length, 0, 'discard does not write an unchanged document');

    const newText = 'A deliberately saved cabinet installation note.';
    await body.fill(newText);
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect.poll(() => fixture.draft.version).toBe(8);
    await expect(page.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled();
    await flow.getByRole('button', { name: '配封面', exact: true }).click();
    await expect(flow.getByRole('button', { name: '配封面', exact: true })).toHaveAttribute('aria-current', 'step');
    await flow.getByRole('button', { name: '审正文', exact: true }).click();
    await expect(await openEnglishDraft(page)).toHaveValue(newText);
    assert.equal(dialogs.length, 2, 'a saved draft switches steps without asking to discard');
    assert.equal(fixture.writes.length, 1);
  } finally { await browser?.close(); await web.stop(); }
});

test('clicking the active draft step keeps unsaved text when the server has a newer version', async () => {
  const fixture = reviewFixture();
  const web = await startWebServer(fixture.api); let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await visit(page, web.origin + '/admin/studio/drafts/review-fixture?stage=review');
    const body = await openEnglishDraft(page);
    const localText = 'Keep this local note while reviewing the same step.';
    await body.fill(localText);
    fixture.draft.version++;
    fixture.draft.document.body_en = 'A newer server version.';
    const dialogs: string[] = [];
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    await page.getByRole('navigation', { name: '当前稿件流程' }).getByRole('button', { name: '审正文', exact: true }).click();
    await page.waitForLoadState('networkidle');
    await expect(body).toHaveValue(localText);
    assert.equal(dialogs.length, 0, 'the active step does not ask to leave itself');
    assert.equal(fixture.writes.length, 0);
  } finally { await browser?.close(); await web.stop(); }
});

test('five-event evidence keeps each canonical source and never guesses the first source for unresolved multi-source quotes', async () => {
  const fixture = reviewFixture();
  const sharedQuote = 'This shared condition appears in two different source snapshots.';
  const items = Array.from({ length: 5 }, (_, index) => {
    const number = index + 1, articleId = 'brief-source-' + number;
    return {
      event_id: 'synthetic-event-' + number, section: 'components-ics',
      sources: [{ article_id: articleId, url: `https://example.test/event-${number}`, revision: 1, published_at: '2026-11-08T12:00:00Z' }],
      evidence: [{ article_id: articleId, claim: `Event ${number} clearance comes from its own source.`, quote: `Synthetic event ${number} records a clearance of ${100 + number} mm.` }],
    };
  });
  const snapshots = items.map((item, index) => ({ binding: item.sources[0], title: 'Synthetic event ' + (index + 1), body_text: item.evidence[0].quote + (index < 2 ? '\n' + sharedQuote : '') }));
  Object.assign(fixture.draft.document, {
    title_zh: '隔离样本：5 个事件短讯', title_en: 'Synthetic sample: five-event LED display brief',
    review_zh: '五个独立事件各自使用已绑定原文，仅用于来源定位回归测试。',
    body_en: `<section>${items.map((item, index) => `<article><h2>Synthetic event ${index + 1}</h2><p>${item.evidence[0].claim}</p></article>`).join('')}</section>`,
    source: items[0].sources[0], brief: { schema: 'aihot-brief/1', highlight_event_ids: items.slice(0, 3).map(item => item.event_id), items },
    evidence: items.flatMap(item => item.evidence.map(({ claim, quote }) => ({ claim, quote }))),
  });
  Object.assign(fixture.draft, { source_snapshots: snapshots, source_snapshot: snapshots[0], material: { title: snapshots[0].title, body_text: snapshots[0].body_text, revision: 1 } });
  fixture.draft.issues = { items: [], summary: { findingCount: 0, issueCount: 0, requiredCount: 0, recommendedCount: 0 } };
  const web = await startWebServer(fixture.api); let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await page.route('**/*', route => new URL(route.request().url()).origin === web.origin ? route.continue() : route.abort());
    await visit(page, web.origin + '/admin/studio/drafts/review-fixture');
    const desk = page.getByLabel('稿件说法与原文依据', { exact: true });
    await desk.locator('summary').click();
    await expect(desk.getByRole('button', { name: /^Event [1-5] clearance/ })).toHaveCount(5);
    await desk.getByRole('button', { name: items[1].evidence[0].claim, exact: true }).click();
    await expect(desk.getByRole('link', { name: '打开原始来源', exact: true })).toHaveAttribute('href', items[1].sources[0].url);
    await expect(desk.locator(`a[href="${items[0].sources[0].url}"]`)).toHaveCount(0);
    assert.equal(fixture.draft.document.source.url, items[0].sources[0].url, 'the draft-level source remains the first event');

    Object.assign(fixture.draft.document, { brief: undefined, evidence: [
      { claim: 'The complete quote has one matching source.', quote: items[1].evidence[0].quote },
      { claim: 'The shared quote has more than one matching source.', quote: sharedQuote },
      { claim: 'This quote is absent from all bound source snapshots.', quote: 'No source contains this synthetic missing quotation.' },
    ] });
    await page.reload();
    await desk.locator('summary').click();
    await expect(desk.getByRole('link', { name: '打开原始来源', exact: true })).toHaveAttribute('href', items[1].sources[0].url);
    for (const claim of [fixture.draft.document.evidence[1].claim, fixture.draft.document.evidence[2].claim]) {
      await desk.getByRole('button', { name: claim, exact: true }).click();
      await expect(desk.getByRole('link', { name: '打开原始来源', exact: true })).toHaveCount(0);
      await expect(desk.getByText('这条摘录暂时无法唯一定位来源。', { exact: true })).toBeVisible();
    }
    await desk.getByRole('button', { name: '查看全部绑定原文', exact: true }).click();
    await expect(page.getByRole('tab', { name: '原文与证据', exact: true })).toHaveAttribute('aria-selected', 'true');
    for (const source of snapshots) await expect(page.getByText(source.title, { exact: true })).toBeVisible();
    assert.equal(fixture.writes.length, 0, 'source lookup and opening bound originals do not generate, approve or publish');
    assert.equal(fixture.draft.version, 7);
    assert.equal(fixture.draft.status, 'in_review');
  } finally { await browser?.close(); await web.stop(); }
});

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
    await expect(bodyIssue.getByRole('button', { name: '查看原因与 1 处原文', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(bodyIssue.getByText('请把这处计算结果与绑定原文对照。', { exact: true })).toBeVisible();
    await bodyIssue.getByRole('button', { name: '定位并核对', exact: true }).click();
    await expect(page.getByRole('tab', { name: '英文交付', exact: true })).toHaveAttribute('aria-selected', 'true');
    const body = page.getByLabel('英文正文（源稿）', { exact: true });
    await expect(body).toBeFocused();
    await expect(body).toHaveAccessibleDescription('沿用现有 Markdown 或 HTML 格式，保留来源链接。分片稿只修改新增或计划调整的内容；原文保留段和外层格式保持不变。');
    await expect(body).toHaveAttribute('lang', 'en');
    assert.equal(await body.evaluate(el => { const text = el as HTMLTextAreaElement; return text.value.slice(text.selectionStart, text.selectionEnd); }), '5760');
    await expect(page.getByText(/查看本次旧页改动/)).toHaveCount(0);

    const metaIssue = page.getByRole('listitem').filter({ has: page.getByText('搜索摘要数字需与原文一致', { exact: true }) });
    await metaIssue.getByRole('button', { name: '定位并核对', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: '搜索摘要与消息状态', exact: true })).toHaveAttribute('aria-expanded', 'true');
    const description = page.getByLabel('Meta description', { exact: true });
    await expect(description).toBeFocused();
    assert.equal(await description.evaluate(el => { const text = el as HTMLInputElement; return text.value.slice(text.selectionStart ?? 0, text.selectionEnd ?? 0); }), '5760');

    await page.getByRole('checkbox', { name: '确认 正文尺寸数字需与原文一致', exact: true }).check();
    await expect(approve).toBeDisabled();
    await page.getByRole('checkbox', { name: '确认 搜索摘要数字需与原文一致', exact: true }).check();
    await expect(approve).toBeEnabled();
    await expect(page.getByRole('button', { name: '暂存核对结果', exact: true })).toHaveAccessibleDescription('用于稍后继续核对。确认审核通过时会同时保存当前勾选，无需提前暂存。内容或来源变化后需要重新核对。');
    assert.equal(fixture.writes.length, 0, 'viewing evidence and checking issues do not approve, publish, or modify the draft');
    await captureReviewState(page, 'actionable-remedies', width);
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

test('review remedies open the bound source and position-free review without writes or guessed locations', async () => {
  const fixture = reviewFixture();
  Object.assign(fixture.draft.issues.items[0], { ruleId: 'W3', title: '追溯一手研究', occurrences: [{
    ruleId: 'W3', severity: 'WARN', field: 'source.body_text', start: 0, end: 4, quote: '6 × ', reason: '原文含二次转述线索，请追溯一手。',
  }] });
  Object.assign(fixture.draft.issues.items[1], { ruleId: 'W5', title: '新领域首篇逐字核对', occurrences: [], count: 0 });
  const web = await startWebServer(fixture.api);
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await visit(page, web.origin + '/admin/studio/drafts/review-fixture');
    await expect(page.getByRole('tab', { name: '原文与证据', exact: true })).toBeHidden();
    const sourceIssue = page.getByRole('listitem').filter({ has: page.getByText('追溯一手研究', { exact: true }) });
    await sourceIssue.getByRole('button', { name: '查看对应原文', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: '原文与证据', exact: true })).toHaveAttribute('aria-selected', 'true');
    const source = page.locator('[data-field="source.body_text"]');
    await expect(source).toBeVisible();
    await expect(source).toBeFocused();
    assert.equal(await page.evaluate(() => getSelection()?.toString()), '6 × ');
    const wholeReview = page.getByRole('listitem').filter({ has: page.getByText('新领域首篇逐字核对', { exact: true }) });
    await wholeReview.getByRole('button', { name: '打开英文稿核对', exact: true }).click();
    const body = page.getByLabel('英文正文（源稿）', { exact: true });
    await expect(body).toBeFocused();
    await expect(body).toHaveValue(fixture.draft.document.body_en);
    await expect(page.getByRole('button', { name: '确认审核通过', exact: true })).toBeDisabled();
    assert.equal(fixture.writes.length, 0, 'inspection never mutates, verifies facts, or approves');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await captureReviewState(page, 'source-remedy', 390);
  } finally { await browser?.close(); await web.stop(); }
});

test('temporarily saved review checks survive a failed request and reload without approving the draft', async () => {
  const fixture = reviewFixture();
  Object.assign(fixture.draft, { review_sync: { status: 'stale', english_hash: 'test-current-hash' } });
  const web = await startWebServer(fixture.api); let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const url = web.origin + '/admin/studio/drafts/review-fixture';
    await visit(page, url);
    const first = page.getByRole('checkbox', { name: '确认 正文尺寸数字需与原文一致', exact: true });
    const second = page.getByRole('checkbox', { name: '确认 搜索摘要数字需与原文一致', exact: true });
    const english = page.getByRole('checkbox', { name: '已按当前英文主稿核对', exact: true });
    const saveChecks = page.getByRole('button', { name: '暂存核对结果', exact: true });
    await first.check();
    await english.check();
    const endpoint = '**/api/admin/studio/drafts/review-fixture/review';
    await page.route(endpoint, route => route.fulfill({ status: 503, json: { code: 'unavailable', detail: '本次暂存未完成，请稍后重试。' } }));
    await saveChecks.click();
    await expect(page.getByText('本次暂存未完成，请稍后重试。', { exact: true })).toBeVisible();
    await expect(first).toBeChecked();
    await expect(second).not.toBeChecked();
    await expect(english).toBeChecked();
    await expect(saveChecks).toBeEnabled();
    assert.equal(fixture.writes.length, 0, 'a failed request does not create a persisted confirmation or a false approval');

    await page.unroute(endpoint);
    await saveChecks.click();
    await expect.poll(() => fixture.draft.version).toBe(8);
    await expect(first).toBeChecked();
    await expect(second).not.toBeChecked();
    await expect(english).not.toBeChecked();
    assert.equal(fixture.draft.status, 'in_review');
    assert.deepEqual(fixture.writes.map(write => write.body.action), ['confirm']);
    assert.deepEqual(fixture.writes[0].body.confirmations, [{ issueId: 'body-number', fingerprint: 'body-number-v7-source3' }]);
    assert.equal(fixture.writes[0].body.english_reviewed, undefined, 'temporary check saving never becomes the final English acknowledgement');

    await visit(page, url);
    await expect(first).toBeChecked();
    await expect(second).not.toBeChecked();
    await captureReviewState(page, 'temporarily-saved-checks', 390);
    await second.check();
    const approve = page.getByRole('button', { name: '确认审核通过', exact: true });
    await expect(approve).toBeDisabled();
    await english.check();
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect.poll(() => fixture.draft.status).toBe('approved');
    assert.deepEqual(fixture.writes.map(write => write.body.action), ['confirm', 'approve']);
    assert.equal(fixture.writes[1].body.version, 8);
    assert.equal(fixture.writes[1].body.english_reviewed, true);
    assert.equal((fixture.writes[1].body.confirmations as unknown[]).length, 2);
    assert.equal(fixture.writes.some(write => /\/(wordpress|publish|generate)$/.test(write.path)), false);
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
    const bodyIssue = page.getByRole('listitem').filter({ has: page.getByText('正文尺寸数字需与原文一致', { exact: true }) });
    await bodyIssue.getByRole('button', { name: '定位并核对', exact: true }).click();
    const body = page.getByLabel('英文正文（源稿）', { exact: true });
    const localBody = 'Locally clarified context. ' + fixture.draft.document.body_en;
    await body.fill(localBody);
    await bodyIssue.getByRole('button', { name: '定位并核对', exact: true }).click();
    await expect(body).toBeFocused();
    await expect(body).toHaveValue(localBody);
    await expect(first).toBeDisabled(); await expect(second).toBeDisabled();
    await expect(approve).toBeDisabled();
    await expect(page.getByRole('button', { name: '暂存核对结果', exact: true })).toBeDisabled();
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
    await expect(page.getByRole('button',{name:'暂存核对结果',exact:true})).toBeEnabled();
    await expect(page.getByRole('button',{name:'确认审核通过',exact:true})).toBeDisabled();
    const suggestion = page.getByRole('listitem').filter({ has: page.getByText('正文尺寸数字需与原文一致', { exact: true }) });
    await expect(suggestion.getByText(fixture.draft.document.body_en, { exact: true })).toHaveAttribute('lang', 'en');
    await page.getByRole('button',{name:'采纳修改：删去这句待核实表述',exact:true}).click();
    await expect.poll(()=>fixture.writes.length).toBe(1);
    assert.deepEqual(fixture.writes[0],{path:'/api/admin/studio/drafts/review-fixture/apply-edit',body:{version:7,issueId:issue.id,fingerprint:issue.fingerprint,suggestionId:'current-edit'}});
    assert.equal(fixture.writes.some(w=>/\/(publish|wordpress)$/.test(w.path)),false);
  }finally{await browser?.close();await web.stop();}
});

for (const width of [1440, 390]) test('a stale Chinese review explains the English acknowledgement and a bound upgrade has no publish button at '+width,async()=>{
  const fixture=reviewFixture();
  Object.assign(fixture.draft,{review_sync:{status:'stale',english_hash:'test-current-hash'},upgrade_context:{target_existing_url:'https://example.test/original-6098',target_post_id:6098,baseline_sha256:'original-hash',changes:[{operation:'revise',paragraph:'p3',reason:'像素取整'}],notice:'独立影子预览，不修改原页面。'}});
  fixture.draft.document.body_en = '<p id="kept-source">A whole-cabinet layout is 5760 mm wide.</p>\n<p>Confirm cabinet alignment before installation.</p>';
  const savedBody = fixture.draft.document.body_en;
  const web=await startWebServer(fixture.api);let browser;
  try{
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width,height:900}});
    await visit(page,web.origin+'/admin/studio/drafts/review-fixture');
    await page.getByRole('button',{name:'展开完整稿件',exact:true}).click();
    await expect(page.getByRole('tab',{name:'英文交付',exact:true})).toHaveAttribute('aria-selected','true');
    const sourceDraft = page.getByLabel('英文正文（源稿）', { exact: true });
    await expect(sourceDraft).toHaveValue(savedBody);
    await expect(sourceDraft).toHaveAccessibleDescription('沿用现有 Markdown 或 HTML 格式，保留来源链接。分片稿只修改新增或计划调整的内容；原文保留段和外层格式保持不变。');
    await page.getByText('查看本次旧页改动（1 项）', { exact: true }).click();
    await expect(page.getByText('调整原段，原文位置 p3', { exact: true })).toBeVisible();
    await expect(page.getByText('像素取整', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '对照目标原页', exact: true })).toHaveAttribute('href', 'https://example.test/original-6098');
    await expect(page.getByText('清单说明计划位置与理由；正文中的可改范围尚未高亮。', { exact: true })).toBeVisible();
    await captureReviewState(page, 'planned-edit-help', width);
    assert.equal(fixture.writes.length, 0, 'opening saved plan context never changes or formats the manuscript');
    await page.getByRole('checkbox',{name:'确认 正文尺寸数字需与原文一致',exact:true}).check();
    await page.getByRole('checkbox',{name:'确认 搜索摘要数字需与原文一致',exact:true}).check();
    const approve=page.getByRole('button',{name:'确认审核通过',exact:true});await expect(approve).toBeDisabled();
    const englishHint='请先勾选“已按当前英文主稿核对”，再确认审核通过。';
    const hint=page.getByText(englishHint,{exact:true});
    await expect(hint).toBeVisible();
    await expect(hint).toHaveAttribute('role','status');
    await expect(approve).toHaveAccessibleDescription(englishHint);
    await captureReviewState(page,'english-acknowledgement',width);
    const english=page.getByRole('checkbox',{name:'已按当前英文主稿核对',exact:true});
    await english.check();await expect(approve).toBeEnabled();
    await expect(hint).toHaveCount(0);
    await expect(approve).toHaveAccessibleDescription('确认审核只记录审稿结果，不会自动公开。');
    await english.uncheck();await expect(approve).toBeDisabled();
    await expect(hint).toBeVisible();
    await expect(approve).toHaveAccessibleDescription(englishHint);
    await english.check();await expect(approve).toBeEnabled();
    assert.equal(await page.getByRole('button',{name:'直接上线',exact:true}).count(),0);
    await expect(page.getByRole('button',{name:'推送原页影子预览稿',exact:true})).toHaveCount(0);
    await approve.click();await expect.poll(()=>fixture.writes.length).toBe(1);
    assert.equal(fixture.writes[0].body.english_reviewed,true);
    assert.equal(fixture.writes[0].body.version,7);
    assert.equal(fixture.draft.document.body_en, savedBody);
    assert.equal(fixture.writes.some(w=>/\/(publish|wordpress)$/.test(w.path)),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }finally{await browser?.close();await web.stop();}
});

test('approval explanations prioritize unsaved changes, BLOCKs and outstanding issues before English acknowledgement', async () => {
  const fixture = reviewFixture();
  Object.assign(fixture.draft, { review_sync: { status: 'stale', english_hash: 'test-current-hash' } });
  fixture.draft.gate.blocked = true;
  const web = await startWebServer(fixture.api); let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await visit(page, web.origin + '/admin/studio/drafts/review-fixture');
    const approve = page.getByRole('button', { name: '确认审核通过', exact: true });
    const englishHint = '请先勾选“已按当前英文主稿核对”，再确认审核通过。';
    await expect(approve).toBeDisabled();
    await expect(approve).toHaveAccessibleDescription('先处理上方需要修改的问题。');
    await expect(page.getByText(englishHint, { exact: true })).toHaveCount(0);

    const body = await openEnglishDraft(page);
    await body.fill(fixture.draft.document.body_en + '\nThis local change is not saved.');
    await expect(approve).toBeDisabled();
    await expect(approve).toHaveAccessibleDescription('保存修改后再核对并审核。');
    await expect(page.getByRole('checkbox', { name: '已按当前英文主稿核对', exact: true })).toBeDisabled();
    await body.fill(fixture.draft.document.body_en);
    await expect(approve).toHaveAccessibleDescription('先处理上方需要修改的问题。');

    fixture.draft.gate.blocked = false;
    await page.reload();
    await expect(approve).toBeDisabled();
    await expect(approve).toHaveAccessibleDescription('还有待确认的问题，全部核对后可审核。');
    await expect(page.getByText(englishHint, { exact: true })).toHaveCount(0);
    await page.getByRole('checkbox', { name: '确认 正文尺寸数字需与原文一致', exact: true }).check();
    await page.getByRole('checkbox', { name: '确认 搜索摘要数字需与原文一致', exact: true }).check();
    await expect(approve).toBeDisabled();
    await expect(approve).toHaveAccessibleDescription(englishHint);
    assert.equal(fixture.writes.length, 0, 'reading reasons and checking conditions do not approve or save');
  } finally { await browser?.close(); await web.stop(); }
});

test('a pending approval stays disabled with a processing explanation until the request finishes', async () => {
  const fixture = reviewFixture();
  Object.assign(fixture.draft, { review_sync: { status: 'stale', english_hash: 'test-current-hash' } });
  const web = await startWebServer(fixture.api); let browser;
  let release = () => {};
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await visit(page, web.origin + '/admin/studio/drafts/review-fixture');
    await page.getByRole('checkbox', { name: '确认 正文尺寸数字需与原文一致', exact: true }).check();
    await page.getByRole('checkbox', { name: '确认 搜索摘要数字需与原文一致', exact: true }).check();
    await page.getByRole('checkbox', { name: '已按当前英文主稿核对', exact: true }).check();
    const approve = page.getByRole('button', { name: '确认审核通过', exact: true });
    await expect(approve).toBeEnabled();
    let pending = false;
    const wait = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/admin/studio/drafts/review-fixture/review', async route => {
      if (route.request().method() === 'POST') { pending = true; await wait; }
      await route.continue();
    });
    await approve.click();
    await expect.poll(() => pending).toBe(true);
    await expect(approve).toBeDisabled();
    await expect(approve).toHaveAccessibleDescription('正在处理当前稿件，请稍候。');
    await expect(page.getByText('确认审核只记录审稿结果，不会自动公开。', { exact: true })).toHaveCount(0);
    assert.equal(fixture.writes.length, 0, 'the pending request has not yet been accepted by the server');
    release();
    await expect.poll(() => fixture.draft.status).toBe('approved');
    await expect(approve).toHaveCount(0);
    assert.equal(fixture.writes.length, 1);
    assert.equal(fixture.writes[0].body.english_reviewed, true);
    assert.equal(fixture.writes.some(write => /\/(wordpress|publish)$/.test(write.path)), false);
  } finally { release(); await browser?.close(); await web.stop(); }
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
