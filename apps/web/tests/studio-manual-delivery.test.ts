import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { fakeApi, startWebServer, visit } from './web-server.ts';

// Original HTTP boundary with synthetic data. Real image validation and ZIP contents are backend tests.
for (const width of [1440, 390]) test(`manual delivery keeps upload, adoption and confirmation separate at ${width}`, async () => {
  const delivery = { mode: 'manual', wordpressWritesAllowed: false, draftPushAllowed: false, readOnlyRecoveryAllowed: true, message: '当前工作台采用手工交付。请下载已批准版本后，由运营上传。' };
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6iWQAAAAASUVORK5CYII=';
  const sourceSentence = 'Measure the complete cabinet before planning the installation.';
  const draft = { id: 'manual-fixture', pitch_id: 'original-pitch', version: 4, status: 'approved', updated_at: '2026-11-11T10:00:00Z', delivery,
    editorial_context: { question: '采购前，怎样确认完整箱体的安装尺寸？', unanswered_questions: [] },
    document: { title_zh: '隔离样本：LED 箱体尺寸核对', title_en: 'Synthetic sample: LED cabinet dimensions', review_zh: '核对尺寸条件与选定封面。本稿仅用于工作台隔离测试。', body_en: sourceSentence, keyword_hypothesis: 'LED cabinet size', meta_description_en: 'Measure the complete cabinet.', questions_zh: [], evidence: [{ claim: sourceSentence, quote: sourceSentence }], source: { url: 'https://example.test/source', revision: 1, published_at: null } },
    source_snapshot: { body_text: sourceSentence, title: 'Synthetic source' }, material: { title: 'Synthetic source', body_text: sourceSentence, revision: 1 },
    gate: { blocked: false, findings: [], mandatoryReview: [] }, issues: { items: [], summary: { findingCount: 0, issueCount: 0, requiredCount: 0, recommendedCount: 0 } }, confirmed_issues: [], history: [],
    wordpress: { ready: true, message: null, receipt: null, approvedVersion: 4 },
  };
  const covers = { revision: 0, selectedHash: null as string | null, candidates: [] as { hash: string; fileName: string; alt_en: string; caption_en: string; width: number; height: number; src: string }[], confirmed: false, confirmedVersion: null as number | null };
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const reads: string[] = [];
  const api = fakeApi(async (url, _res, request) => {
    if (request.method === 'GET') reads.push(url.pathname);
    if (url.pathname === '/api/admin/me') return { name: '隔离测试运营', csrf: 'fixture', dev: false };
    if (url.pathname === '/api/admin/nav-counts') return {};
    if (url.pathname === '/api/admin/studio/capabilities') return { delivery };
    if (url.pathname === '/api/admin/studio') return { delivery, rows: [], total: 0, page: 1, stats: {}, sources: [], tasks: [], generation: { ready: false, reason: '隔离测试不调用模型。' }, drafts: [{ id: draft.id, title_zh: draft.document.title_zh, title_en: draft.document.title_en, status: draft.status, version: draft.version, updated_at: draft.updated_at }] };
    if (url.pathname === '/api/admin/studio/pitches') return { rows: [{ id: 'original-pitch', title: '隔离样本：采购前如何确认 LED 箱体尺寸？', status: 'confirmed', version: 2, task_id: 'original-task' }] };
    if (url.pathname === '/api/admin/settings') return { contact: { wechatQr: null, feishuQr: null }, targets: [], budgets: [] };
    if (url.pathname === '/api/admin/studio/publishing/reviews') return { rows: [{ id: 'old-receipt', title: 'Previous publication', content: '<p>Previous content.</p>', kind: 'guide', status: 'published', postId: 91, url: 'https://example.test/previous', created_at: '2026-11-10T10:00:00Z', issues: [], canRollback: true, reviewed: false }], weekly: { reasons: [] } };
    if (url.pathname === '/api/admin/studio/drafts/manual-fixture') return draft;
    if (url.pathname === '/api/admin/studio/drafts/manual-fixture/figures') return { issues: [], figures: [] };
    if (url.pathname === '/api/admin/studio/drafts/manual-fixture/covers' && request.method === 'GET') return covers;
    if (url.pathname.startsWith('/api/admin/studio/drafts/manual-fixture/') && request.method !== 'GET') {
      let text = ''; for await (const chunk of request) text += chunk;
      const body: Record<string, unknown> = text ? JSON.parse(text) : {};
      writes.push({ path: url.pathname, body });
      assert.equal(body.version, draft.version);
      assert.equal(body.revision, covers.revision);
      if (url.pathname.endsWith('/covers')) {
        covers.candidates.push({ hash: 'candidate-one', fileName: body.fileName as string, alt_en: body.alt_en as string, caption_en: body.caption_en as string, width: 1, height: 1, src: image });
        covers.revision++;
      }
      if (url.pathname.endsWith('/cover-selection')) { covers.selectedHash = body.hash as string | null; covers.confirmed = false; covers.confirmedVersion = null; covers.revision++; }
      if (url.pathname.endsWith('/delivery-confirmation')) { covers.confirmed = true; covers.confirmedVersion = draft.version; covers.revision++; }
      return covers;
    }
  });
  const web = await startWebServer(api); let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const screenshot = async (name: string) => {
      const directory = process.env.AIHOT_UI_REVIEW_DIR;
      if (!directory) return;
      mkdirSync(directory, { recursive: true });
      await page.screenshot({ path: path.join(directory, `original-workbench-${name}-${width}.png`), fullPage: true });
    };
    await visit(page, web.origin + '/admin/workbench');
    await expect(page.getByRole('heading', { name: draft.document.title_zh, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '检查交付文件', exact: true })).toHaveAttribute('href', '/admin/studio/drafts/manual-fixture?stage=delivery');
    await expect(page.getByRole('link', { name: /隔离样本：采购前如何确认 LED 箱体尺寸/ })).toHaveAttribute('href', '/admin/studio/pitch?id=original-pitch');
    for (const destination of ['/admin/studio?tab=materials', '/admin/studio/planning', '/admin/studio?tab=tasks', '/admin/studio/social', '/admin/studio?tab=sources', '/admin/studio?tab=review', '/admin/content', '/admin/studio/published', '/admin/channels', '/admin/runs']) {
      await expect(page.locator(`main a[href="${destination}"]`)).toBeVisible();
    }
    assert.ok(reads.includes('/api/admin/studio'), 'home reads the original overview API');
    assert.ok(reads.includes('/api/admin/studio/pitches'), 'home reads the original pitch API');
    assert.equal(writes.length, 0, 'opening home does not create or generate content');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await screenshot('home');

    const overviewReads = reads.filter(read => read === '/api/admin/studio').length;
    await visit(page, web.origin + '/admin/studio/drafts/manual-fixture?stage=review');
    assert.equal(reads.filter(read => read === '/api/admin/studio').length, overviewReads, 'opening a draft reads capabilities without reloading the full overview');
    await page.getByText('对照稿件说法与原文依据', { exact: false }).click();
    await expect(page.getByRole('heading', { name: '稿件中的说法', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '对应原文摘录', exact: true })).toBeVisible();
    await expect(page.locator('blockquote').filter({ hasText: sourceSentence })).toHaveText(sourceSentence);
    assert.equal(writes.length, 0, 'reading evidence does not approve or generate content');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await screenshot('review-evidence');

    await visit(page, web.origin + '/admin/studio/drafts/manual-fixture?stage=cover');
    await expect(page.getByRole('navigation', { name: '当前稿件流程' }).getByRole('link', { name: '定方向' })).toHaveAttribute('href', '/admin/studio/pitch?id=original-pitch');
    await page.getByLabel('封面图片文件', { exact: true }).setInputFiles({ name: 'cabinet.png', mimeType: 'image/png', buffer: Buffer.from(image.split(',')[1], 'base64') });
    await page.getByLabel('封面英文替代文字', { exact: true }).fill('LED cabinet on a mounting frame');
    await page.getByRole('button', { name: '上传为候选', exact: true }).click();
    await expect(page.getByRole('button', { name: '采用这张', exact: true })).toBeVisible();
    assert.equal(covers.selectedHash, null, 'upload only adds a candidate');
    assert.equal(draft.status, 'approved', 'upload does not alter text approval');
    await page.getByRole('button', { name: '采用这张', exact: true }).click();
    await expect(page.getByRole('button', { name: '当前采用', exact: true })).toBeDisabled();
    assert.equal(covers.confirmed, false, 'adoption requires product confirmation');
    assert.equal(draft.status, 'approved', 'adoption retains text approval');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await screenshot('cover-selected');
    await page.getByRole('button', { name: '继续手工交付', exact: true }).click();
    await expect(page.getByRole('link', { name: '下载交付包', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '确认当前成品', exact: true }).click();
    await expect(page.getByRole('link', { name: '下载交付包', exact: true })).toHaveAttribute('href', '/api/admin/studio/drafts/manual-fixture/export?format=bundle&version=4&coverRevision=3');
    await expect(page.getByRole('link', { name: '英文 HTML', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '直接上线', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '推送WordPress草稿', exact: true })).toHaveCount(0);
    await screenshot('delivery-confirmed');
    await page.reload();
    await expect(page.getByRole('link', { name: '下载交付包', exact: true })).toBeVisible();
    assert.equal(writes.length, 3, 'reload and stage changes issue no writes');
    assert.equal(writes.some(write => /\/(wordpress|publish|review)$/.test(write.path)), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.goto(web.origin + '/admin/settings');
    await expect(page.getByRole('heading', { name: '手工交付', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: '开启直接上线', exact: true })).toHaveCount(0);
    await page.goto(web.origin + '/admin/studio/published');
    await expect(page.getByRole('heading', { name: 'Previous publication', exact: true })).toBeVisible();
    for (const name of ['改一处', '下线', '回滚到上一版']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '没问题', exact: true })).toBeVisible();
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await web.stop(); }
});
