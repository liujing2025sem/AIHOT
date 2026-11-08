import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { fakeApi, startWebServer, visit } from './web-server.ts';

for (const width of [1440, 390]) test(`operator enables one-click, publishes an unapproved draft and corrects it at ${width}`, async () => {
  let settings = { mode: 'review', enabled: false, daily_limits: { brief: 1, article: 2, guide: 1, update: 0 } };
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const review = { id: 'receipt-1', title: 'MiP package sizes', content: '<p>The package measurement is conditional.</p>', kind: 'guide', status: 'private', postId: 99, url: 'https://example.test/?p=99', created_at: '2026-11-08T15:00:00Z', issues: [], canRollback: true, reviewed: false };
  const api = fakeApi(async (url, _res, req) => {
    if (url.pathname === '/api/admin/me') return { name: 'Synthetic operator', csrf: 'fixture', dev: false };
    let text = ''; for await (const chunk of req) text += chunk;
    const input = text ? JSON.parse(text) : {};
    if (req.method !== 'GET') writes.push({ path: url.pathname, body: input });
    if (url.pathname === '/api/admin/settings') return { contact: { wechatQr: null, feishuQr: null }, targets: [], budgets: [] };
    if (url.pathname === '/api/admin/studio/publishing/settings') { if (req.method === 'PUT') settings = input; return settings; }
    if (url.pathname === '/api/admin/studio/drafts/mip') return { id: 'mip', version: 3, status: 'draft', updated_at: '2026-11-08T15:00:00Z', document: { title_en: 'MiP package sizes', title_zh: 'MiP封装尺寸', review_zh: '内部审校', body_en: review.content, keyword_hypothesis: 'MiP LED', meta_description_en: 'MiP packaging', questions_zh: ['待工程回复'], evidence: [], source: { url: 'https://example.test/source', revision: 1, published_at: null } }, source_snapshot: { body_text: 'Source text', title: 'Source' }, material: { title: 'Source', body_text: 'Source text', revision: 1 }, gate: { blocked: true, findings: [], mandatoryReview: [] }, issues: { items: [], summary: { findingCount: 1, issueCount: 1, requiredCount: 1, recommendedCount: 0 } }, confirmed_issues: [], history: [], wordpress: { ready: false, message: '人审草稿通道未启用。', receipt: null } };
    if (url.pathname === '/api/admin/studio/drafts/mip/publish') return { state: 'private', message: '私密验收样例已保存。' };
    if (url.pathname === '/api/admin/studio/publishing/reviews') return { rows: [review], weekly: { reasons: [{ reason: 'attribution', count: 1 }] } };
    if (url.pathname === '/api/admin/studio/publishing/reviews/receipt-1/action') { if (input.action === 'correct') { review.title = input.title; review.content = input.content; } if (input.action === 'unpublish') review.status = 'draft'; if (input.action === 'ok') review.reviewed = true; return review; }
  });
  const web = await startWebServer(api); const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } }); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await visit(page, web.origin + '/admin/studio/drafts/mip');
    await expect(page.getByRole('button', { name: '直接上线', exact: true })).toBeDisabled();
    assert.equal(writes.filter(w => w.path.endsWith('/publish')).length, 0);
    await page.getByRole('link', { name: '去设置开启一键上线 →' }).click();
    await page.getByRole('radio', { name: /一键上线 点/ }).check();
    await page.getByRole('checkbox', { name: '开启直接上线', exact: true }).check();
    await page.getByRole('button', { name: '保存上线方式', exact: true }).click();
    assert.equal(settings.enabled, true); assert.equal(settings.mode, 'one_click');
    await page.goto(web.origin + '/admin/studio/drafts/mip');
    await expect(page.getByRole('button', { name: '直接上线', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '直接上线', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '私密验收样例已保存' })).toBeVisible();
    assert.deepEqual(writes.find(w => w.path.endsWith('/publish'))?.body, { version: 3, kind: 'guide', section: 'components-ics' });
    assert.equal(writes.some(w => w.path.endsWith('/review')), false, 'one click does not manufacture human approval');
    await page.getByRole('link', { name: '查看结果 →', exact: true }).click();
    await page.getByRole('button', { name: '改一处', exact: true }).click();
    await page.getByLabel('要改的原句（只改标题时留空）').fill('package measurement');
    await page.getByLabel('改成', { exact: true }).fill('package-level measurement');
    await page.getByRole('button', { name: '保存这一处修改', exact: true }).click();
    await expect.poll(() => review.content).toContain('package-level measurement');
    await page.getByRole('button', { name: '下线', exact: true }).click();
    await expect(page.getByText('已转草稿', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '回滚到上一版', exact: true }).click();
    assert.equal(writes.filter(w => w.body.action === 'unpublish').length, 1, 'one click removes publication without a confirmation dialog');
    assert.equal(writes.filter(w => w.body.action === 'rollback').length, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await web.stop(); }
});
