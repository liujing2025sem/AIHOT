import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect, type Locator, type Page } from '@playwright/test';
import { fakeApi, startWebServer, visit } from './web-server.ts';

// Original HTTP boundary with synthetic data. Real image validation and ZIP contents are backend tests.
for (const width of [1440, 390]) test(`manual delivery keeps upload, adoption and confirmation separate at ${width}`, async () => {
  const delivery = { mode: 'manual', wordpressWritesAllowed: false, draftPushAllowed: false, readOnlyRecoveryAllowed: true, message: '当前工作台采用手工交付。请下载已批准版本后，由运营上传。' };
  // Neutral schematic for isolated UI checks; it is not a product photo.
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAeAAAAEOBAMAAACjtNlUAAAAMFBMVEXt8vf////p7vzQ2egsT8S3xNQDAwOIkp5danpwe4rh5+2krLbHztgsLC1SVFZyicw3XfN4AAAACXBIWXMAAAsTAAALEwEAmpwYAAAImUlEQVR42u3da2sb2RkH8GcRs5JmxmbDtl+g7QeY7ZLgpOmWlL6vSvDWMk4JLHvsxFEYKI2kqFsExrZkq0UQZEtxXgwEx5dsi97UstsGBMFeyTjFUHCazdoIStUt7fZN+wH6nJmRLAnLaUoc5Mn/D47nnLlofjq38YWYCEEQBEEQBEEQBEEQBEGQ053Al21F/csjj/L96l8//tsp1D0SB2ZHVV+k3S+KjR0HRE+eafv7z7jwayHWxOnz+oUQu60Vc8U28FqNtIjlFt7mHVtjmhCjck8kHhhzd+ydHnCfSPwi21qxZ7aB67WWfQ6YvitCXLg13qxXTlFLv32T//nqc+rfX/rzH8Vz+kDs/6kv8kj8RXb2pxQUkef+/bLs+FYT3Cd92l7kWf+Bsl+jr764IvZrT55S/wE9qs1d9/1S/LOHwXKATo3T1k2/2BOiXBfioz7u5hG7syfXuPsGRTnI29QO5oNucleo8+6kHBYfXpM9Y21MXOXBLco9Cw6KmyHW0ty4X4z+RGSrIjfcJ56vCeNBxJq68VD89TKDt8Rvox1gfW50hIUPxFbEuiIGyy5YHGSnxhVR690mnhJjVp+w9q76RVYXNU3wGJZNWuQxem5U5Vtn8K3R1jFsg+UYZiHPYB9TP1e4YJ7geBKs7/YuWKmLml/8QST9oqg2wNyfi3PcM6+54Kkb3cBUF8lW8CipfJ642sPTliY+UsXfRbkTPBXZ33/qguuH4A9fDOYTa708Uc99TFMROUk1wXbBXnZc8Ny4u4ZZxL27FcxT27gDHqMHNpjEbi9rn+TO7l2nLX6UaICTFxzwuYjhM0l8fp/Ba5HtIfuZ6x+fiRv8jGU1weciPGn1i2L5QeTClAOuj5IW6lnwllx8uM2uu2AfT0IOmJdgHop74hqD+5xlSeWFS2QV50nLAdd5dufhL3adtUyCz/GJZs+Cf8Mzk3zArLlguiVuOGD6RHDxir0Oq3UhH1D4sYQfRjT7FAes8SF747x7V98Tsw5Yr4tI77Yw+bbtJ+rG1wekPm7uumjwPzv2g7TqfCJ9u+tF1OauxsG9PJIjb9YXwJ+I8TcLPNfDk8yJ5DvD+DYPgiAIgiAIgiAIgiCeyv3NQY9l5MJx3k8HPZjt7l51cPitMx7LO4uDVlfw4uUzHszZ7t+V3HzPi+B3R7r36DOeTNc+7Rv2JnjR6ALWQ94EK+UuYOVH3gR/PQQwwAADDDDAAAMMMMAAAwwwwC8B/toP/q9c6pXzXwH4h/95cc1xN/x6z3958Pe/0ZFvfvvFNd+61CvnAwwwwAADDDDAAAMMMMAAAwwwwAADDDDAAAMMMMAAAwwwwAAD/D+C//1+Ry4+fnHN9y71yvkAo0sDDDDAAAMMMMAAAwwwwAADDDDAAAMMMMAAAwwwwAADDDDAAAOM3wDAbwBgDAMMMMAAAwwwwAADDDDAAAMMMMAAAwwwwAADDDDAAAMMMMAAewb8xv2n+G/anz04g7/kATDAAAMMMMAAAwwwwAADDLD3wXrIm2Cl3AXsG/YmeNHoAlYHvQketLqAafM9L3rfHenmpcXLXgSfHe4KVgeH3/Ia953F7j2a6NNBD2abjsn9Ta9xRy4QgiAIgiAIgiAIgiAIgiAIgvRKLvKPWwzSD3/8tFmmnZ0dS2//gdRn8tCdnZbv6SvGS72OL9tRoRWPOfr3J+ZVCzSQmKX1uOlWrMzPUzSaNzbixU5wKTb/U6ekl4n8oWMv/LijrCcbr+iep5nt5bYkTgzsj1OUwuqEOtG4MVpmTdg3o850ginI92bxLbZg7WJz0wY4n37W2FadgxpgSzGdgzX3s2K2vP2NM04OHK5SiUpKVr5ElDZkVYDBOaemuj6tTtqv3gCvp42l1MR6KsSFUmx2I235U/eomt6g8ym7SyzkJ2kpdcefmpTb9+he/kIsbfjys8lA2ZdUY9NDKZO0aKqoRfNF4gtx+XzqNlXSJTWTUlKzlOArRPOz/IaUTqBH363SUuKOc/GVy3YzV/hdz3INOyvFlWLlYfYQrNzVsiUyZFMHQ+vlITNY9PGpszwyJtWMPKZgDdnvXM7eXqdC2W9q2WDRb4ODpipbVpvwZbSML6Pc1Se4vEBRdVKdV9OWzxqwYlbFihmV+zP2NV51jw5VSSvcdsB6WraRyi8TLDo1FdKyWt44BPt/vjkzFCIHvMGdwV8k3wZ31w09s7NgtzAtWxMUMHL2dqAsPyizbCk2eNnpyvLt5I8cn82ffUka4B5Vku+YOmBE+eWjfFaiOexfYUrvh/kFNhSn+8TsWasoG9ltYW5rdbplDAfno7eVfNEBl9ilmUvzcb7bsDIdtQdejpZXZ/h2c/Z2MMRli3IVnrQkeIAa4JIE83UYzLDlhxI8Q9p8zEiQv5jgK4Q189WD44XUnQwFLiYlT5lnq7pgT5JsyDkt7I+VW1pY9gF9shXMc57dwm5zSHBrC+dkC08sWxKsN1s467RwsL2FZ2jICtgtLMGBSvkkZq0q6ypWTuc5eXmb+9TK71YtHxcmZY0cw+HFuy1jeIIMw+6KTXCC4jx+CzRLq0rIBltyDCfcMZyjxhi2P3gMZ90xzGB7DGftMZzhMTxDYVo35BiWYC1OJwM+X8hRhaddvschi+fNlOnnRrBrqvFpHljR1lk6Za7nTT0daoIrhTBVCnGepSe4wWwwz9I0xE28UMhwWbVn6YWknl5I+vLTaoFn6XhezhI5Ws+HuCxn6aFClMEr6Q0jWpALQ6Cszp7Yw8fhItoSWVNVrdZ12K1uWXsbB1pholUKNI5edapzzmGq1VyR5bYqx7DVto7blyi55YR78fYHgdeTavuDR9cY9sinhx3VXZeVI6Yj9xItT1l+s3fBsfzto6pfBhzLm+1grWC9frB6xNaROfreVrte1zrmEqvHXhNBEARBEARBEARBEARBEAQ5ZfkvCkw+cj8nnX8AAAAASUVORK5CYII=';
  const coverAlt = 'Synthetic panel layout for isolated UI testing';
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
        covers.candidates.push({ hash: 'candidate-one', fileName: body.fileName as string, alt_en: body.alt_en as string, caption_en: body.caption_en as string, width: 480, height: 270, src: image });
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
      // Capture the settled viewport: transient messages and sticky bars retain their real behavior.
      await expect(page.locator('[role="status"][aria-live="polite"]')).toBeEmpty({ timeout: 8000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await page.screenshot({ path: path.join(directory, `original-workbench-${name}-${width}.png`), fullPage: true });
    };
    await visit(page, web.origin + '/admin/workbench');
    await expect(page.getByRole('heading', { name: draft.document.title_zh, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '检查交付文件', exact: true })).toHaveAttribute('href', '/admin/studio/drafts/manual-fixture?stage=delivery');
    await expect(page.getByRole('link', { name: /隔离样本：采购前如何确认 LED 箱体尺寸/ })).toHaveAttribute('href', '/admin/studio/pitch?id=original-pitch');
    const tools = page.getByRole('region', { name: '采编工具', exact: true });
    for (const [label, destination] of [
      ['今日选稿', '/admin/studio?tab=materials'], ['选题与旧页升级', '/admin/studio/planning'],
      ['采编任务', '/admin/studio?tab=tasks'], ['社媒派生', '/admin/studio/social'],
      ['信源与采集', '/admin/studio?tab=sources'], ['审稿策略与观察', '/admin/studio?tab=review'],
      ['内容诊断', '/admin/content'], ['发布历史', '/admin/studio/published'],
      ['模型连接', '/admin/channels'], ['运行记录', '/admin/runs'],
    ]) {
      const link = tools.getByRole('link', { name: new RegExp('^' + label) });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', destination);
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
    await page.getByLabel('封面英文替代文字', { exact: true }).fill(coverAlt);
    await page.getByRole('button', { name: '上传为候选', exact: true }).click();
    await expect(page.getByRole('button', { name: '采用这张', exact: true })).toBeVisible();
    assert.equal(covers.selectedHash, null, 'upload only adds a candidate');
    assert.equal(draft.status, 'approved', 'upload does not alter text approval');
    await page.getByRole('button', { name: '采用这张', exact: true }).click();
    await expect(page.getByRole('button', { name: '当前采用', exact: true })).toBeDisabled();
    assert.equal(covers.confirmed, false, 'adoption requires product confirmation');
    assert.equal(draft.status, 'approved', 'adoption retains text approval');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await expect.poll(() => page.getByRole('img', { name: coverAlt, exact: true }).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await screenshot('cover-selected');
    await page.getByRole('button', { name: '继续手工交付', exact: true }).click();
    await expect(page.getByRole('link', { name: '下载交付包', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '确认当前成品', exact: true }).click();
    await expect(page.getByRole('link', { name: '下载交付包', exact: true })).toHaveAttribute('href', '/api/admin/studio/drafts/manual-fixture/export?format=bundle&version=4&coverRevision=3');
    await expect(page.getByRole('link', { name: '英文 HTML', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '直接上线', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '推送WordPress草稿', exact: true })).toHaveCount(0);
    await expect.poll(() => page.getByRole('img', { name: coverAlt, exact: true }).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
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

function coverInputFixture() {
  const delivery = { mode: 'manual', wordpressWritesAllowed: false, draftPushAllowed: false, readOnlyRecoveryAllowed: true };
  const source = 'Measure the complete cabinet before planning the installation.';
  const drafts = ['一', '二'].map((name, index) => ({
    id: 'cover-input-' + index, version: 4, status: 'approved', updated_at: '2026-11-11T10:00:00Z', delivery,
    document: { title_zh: '封面保护样本' + name, title_en: 'Cover input sample ' + index, review_zh: '仅用于封面输入保护的隔离样本。', body_en: source, keyword_hypothesis: 'cabinet size', meta_description_en: source, questions_zh: [], evidence: [], source: { url: 'https://example.test/source', revision: 1, published_at: null } },
    source_snapshot: { body_text: source, title: 'Synthetic source' }, material: { title: 'Synthetic source', body_text: source, revision: 1 },
    gate: { blocked: false, findings: [], mandatoryReview: [] }, issues: { items: [], summary: { findingCount: 0, issueCount: 0, requiredCount: 0, recommendedCount: 0 } }, confirmed_issues: [], history: [],
    wordpress: { ready: false, message: null, receipt: null, approvedVersion: 4 },
  }));
  const covers = drafts.map(() => ({ revision: 0, selectedHash: null, candidates: [] as { hash: string; fileName: string; alt_en: string; caption_en: string; width: number; height: number; src: string }[], confirmed: false, confirmedVersion: null }));
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const upload = { status: 200, wait: null as Promise<void> | null };
  const coverRead = { status: 200, wait: null as Promise<void> | null, requests: 0 };
  const api = fakeApi(async (url, res, request) => {
    if (url.pathname === '/api/admin/me') return { name: '隔离测试运营', csrf: 'fixture', dev: false };
    if (url.pathname === '/api/admin/nav-counts') return {};
    if (url.pathname === '/api/admin/studio/capabilities') return { delivery };
    if (url.pathname === '/api/admin/studio/pitches') return { rows: [] };
    if (url.pathname === '/api/admin/studio') return { delivery, rows: [], total: 0, page: 1, stats: {}, sources: [], tasks: [], generation: { ready: false, reason: '隔离测试不调用模型。' }, drafts: drafts.map(d => ({ ...d, title_zh: d.document.title_zh, title_en: d.document.title_en })) };
    const index = drafts.findIndex(d => url.pathname === '/api/admin/studio/drafts/' + d.id || url.pathname.startsWith('/api/admin/studio/drafts/' + d.id + '/'));
    if (index < 0) return;
    const draft = drafts[index], state = covers[index], endpoint = '/api/admin/studio/drafts/' + draft.id;
    if (request.method === 'GET') {
      if (url.pathname === endpoint) return draft;
      if (url.pathname === endpoint + '/figures') return { figures: [], issues: [] };
      if (url.pathname === endpoint + '/covers') {
        coverRead.requests++;
        await coverRead.wait;
        if (coverRead.status !== 200) { res.statusCode = coverRead.status; return { detail: '候选列表暂时无法读取。' }; }
        return state;
      }
      return;
    }
    let text = ''; for await (const chunk of request) text += chunk;
    const body: Record<string, unknown> = text ? JSON.parse(text) : {};
    writes.push({ path: url.pathname, body });
    if (url.pathname === endpoint + '/covers' && request.method === 'POST') {
      await upload.wait;
      if (body.version !== draft.version || body.revision !== state.revision) {
        res.statusCode = 409;
        return { detail: '稿件或封面已变化，请刷新后再操作。' };
      }
      if (upload.status !== 200) {
        res.statusCode = upload.status;
        return { detail: '封面候选暂未保存，请重试。' };
      }
      state.candidates.push({ hash: 'cover-' + (state.revision + 1), fileName: body.fileName as string, alt_en: body.alt_en as string, caption_en: body.caption_en as string, width: 320, height: 180, src: body.dataUrl as string });
      state.revision++;
      return state;
    }
    res.statusCode = 400;
    return { detail: '这项隔离测试只允许上传封面候选。' };
  });
  return { api, drafts, covers, writes, upload, coverRead };
}

async function syntheticCover(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#e8edf3'; context.fillRect(0, 0, 320, 180);
    context.fillStyle = '#536c85'; context.fillRect(64, 40, 192, 100);
    context.fillStyle = '#d3deea'; context.fillRect(76, 52, 168, 76);
    return canvas.toDataURL('image/png');
  });
  return { name: '封面输入样本.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') };
}

async function captureCoverReview(page: Page, name: string, width: number) {
  const directory = process.env.AIHOT_UI_REVIEW_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `impeccable-cover-${name}-${width}.png`), fullPage: true });
}

for (const width of [1440, 390]) test(`unuploaded cover inputs survive cancelled navigation and leave only by explicit discard at ${width}`, async () => {
  const fixture = coverInputFixture();
  const web = await startWebServer(fixture.api); let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const dialogs: string[] = []; let discard = false;
    page.on('dialog', async dialog => { dialogs.push(dialog.type()); await (discard ? dialog.accept() : dialog.dismiss()); });
    await visit(page, web.origin + '/admin/workbench');
    await page.getByRole('link', { name: /封面保护样本一/ }).click();
    const flow = page.getByRole('navigation', { name: '当前稿件流程' });
    await flow.getByRole('button', { name: '配封面', exact: true }).click();
    const file = page.getByLabel('封面图片文件', { exact: true });
    const alt = page.getByLabel('封面英文替代文字', { exact: true });
    const caption = page.getByLabel('封面英文图注', { exact: true });
    const image = await syntheticCover(page);
    const altText = 'Synthetic cabinet panel with a light border';
    const captionText = '待核对图注：尺寸仅作布局示意。\nNo product dimensions are claimed. 🧩';
    await file.setInputFiles(image); await alt.fill(altText); await caption.fill(captionText);
    await captureCoverReview(page, 'unsaved', width);
    const expectRetained = async () => {
      await expect(alt).toHaveValue(altText); await expect(caption).toHaveValue(captionText);
      assert.deepEqual(await file.evaluate(input => Array.from((input as HTMLInputElement).files ?? [], f => ({ name: f.name, size: f.size }))), [{ name: image.name, size: image.buffer.length }]);
      await expect(flow.getByRole('button', { name: '配封面', exact: true })).toHaveAttribute('aria-current', 'step');
    };
    fixture.drafts[0].version++;
    await flow.getByRole('button', { name: '配封面', exact: true }).click();
    assert.equal(dialogs.length, 0, 'the current step retains its buffer without a leave decision');
    for (const navigate of [
      () => flow.getByRole('button', { name: '手工交付', exact: true }).click(),
      () => page.getByRole('button', { name: '继续手工交付', exact: true }).click(),
      () => page.getByRole('link', { name: '返回稿件', exact: true }).click(),
      () => page.evaluate(() => history.back()),
    ]) {
      const before = dialogs.length;
      await navigate(); await expect.poll(() => dialogs.length).toBe(before + 1); await expectRetained();
    }
    const beforeReload = dialogs.length;
    await page.reload().catch(error => { assert.match(String(error), /ERR_ABORTED|cancelled|canceled/i); });
    await expect.poll(() => dialogs.length).toBe(beforeReload + 1);
    assert.equal(dialogs.at(-1), 'beforeunload');
    await expectRetained();
    assert.equal(fixture.writes.length, 0, 'cancelled navigation never uploads or confirms');

    discard = true;
    await page.getByRole('button', { name: '继续手工交付', exact: true }).click();
    await expect(flow.getByRole('button', { name: '手工交付', exact: true })).toHaveAttribute('aria-current', 'step');
    const afterDiscard = dialogs.length;
    await flow.getByRole('button', { name: '配封面', exact: true }).click();
    await expect(alt).toHaveValue(''); await expect(caption).toHaveValue('');
    assert.equal(await file.evaluate(input => (input as HTMLInputElement).files?.length), 0);
    assert.equal(dialogs.length, afterDiscard, 'explicit discard leaves a clean buffer');
    discard = false;

    for (const field of [alt, caption]) {
      await field.fill('Only this unsaved field');
      const before = dialogs.length;
      await flow.getByRole('button', { name: '审正文', exact: true }).click();
      await expect.poll(() => dialogs.length).toBe(before + 1);
      await expect(field).toHaveValue('Only this unsaved field');
      await field.fill('');
    }
    await file.setInputFiles(image);
    const beforeFileOnly = dialogs.length;
    await flow.getByRole('button', { name: '审正文', exact: true }).click();
    await expect.poll(() => dialogs.length).toBe(beforeFileOnly + 1);
    assert.equal(await file.evaluate(input => (input as HTMLInputElement).files?.length), 1);
    discard = true;
    await page.getByRole('link', { name: '返回稿件', exact: true }).click();
    await page.getByRole('link', { name: /封面保护样本二/ }).click();
    await flow.getByRole('button', { name: '配封面', exact: true }).click();
    await expect(alt).toHaveValue(''); await expect(caption).toHaveValue('');
    assert.equal(await file.evaluate(input => (input as HTMLInputElement).files?.length), 0, 'another draft never receives the abandoned file');
    assert.equal(fixture.writes.length, 0);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await web.stop(); }
});

for (const width of [1440, 390]) test(`a pending cover upload blocks navigation and rapid repeated submission at ${width}`, async () => {
  const fixture = coverInputFixture();
  const response = Promise.withResolvers<void>(); fixture.upload.wait = response.promise;
  const web = await startWebServer(fixture.api); let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const dialogs: string[] = [];
    page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.accept(); });
    await visit(page, web.origin + '/admin/studio/drafts/cover-input-0?stage=cover');
    const file = page.getByLabel('封面图片文件', { exact: true });
    const alt = page.getByLabel('封面英文替代文字', { exact: true });
    const caption = page.getByLabel('封面英文图注', { exact: true });
    await file.setInputFiles(await syntheticCover(page)); await alt.fill('Synthetic panel during upload'); await caption.fill('Keep this caption until upload succeeds.');
    await page.evaluate(() => {
      const originalRead = FileReader.prototype.readAsDataURL;
      const reads: (() => void)[] = [];
      FileReader.prototype.readAsDataURL = function(blob) { reads.push(() => originalRead.call(this, blob)); };
      (window as unknown as { releaseCoverReads: () => void }).releaseCoverReads = () => {
        FileReader.prototype.readAsDataURL = originalRead;
        for (const read of reads) read();
      };
    });
    await page.getByRole('button', { name: '上传为候选', exact: true }).evaluate(button => {
      for (let i = 0; i < 10; i++) button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const flow = page.getByRole('navigation', { name: '当前稿件流程' });
    await expect(page.getByRole('button', { name: '正在保存候选…', exact: true })).toBeDisabled();
    await flow.getByRole('button', { name: '手工交付', exact: true }).click();
    await expect(flow.getByRole('button', { name: '配封面', exact: true })).toHaveAttribute('aria-current', 'step');
    await expect(alt).toHaveValue('Synthetic panel during upload');
    assert.equal(fixture.writes.length, 0, 'the held file read has not started a request');
    await page.evaluate(() => (window as unknown as { releaseCoverReads: () => void }).releaseCoverReads());
    await expect.poll(() => fixture.writes.length).toBe(1);
    await page.getByRole('link', { name: '返回稿件', exact: true }).click();
    await expect(page).toHaveURL(web.origin + '/admin/studio/drafts/cover-input-0?stage=cover');
    await expect(caption).toHaveValue('Keep this caption until upload succeeds.');
    assert.equal(dialogs.length, 0, 'a pending upload cannot offer a misleading discard decision');
    await captureCoverReview(page, 'upload-pending', width);
    response.resolve();
    await expect(page.getByRole('button', { name: '采用这张', exact: true })).toBeVisible();
    await expect(alt).toHaveValue(''); await expect(caption).toHaveValue('');
    assert.equal(await file.evaluate(input => (input as HTMLInputElement).files?.length), 0);
    assert.equal(fixture.writes.length, 1, 'rapid repeated submission produces only one POST');
    assert.equal(fixture.covers[0].candidates.length, 1);
    assert.equal(fixture.covers[0].selectedHash, null, 'successful upload remains an unadopted candidate');
    await flow.getByRole('button', { name: '手工交付', exact: true }).click();
    await expect(flow.getByRole('button', { name: '手工交付', exact: true })).toHaveAttribute('aria-current', 'step');
    assert.equal(dialogs.length, 0, 'successful upload clears its leave warning');
  } finally { response.resolve(); await browser?.close(); await web.stop(); }
});

test('cover upload failures retain the file and both descriptions until a confirmed successful retry', async () => {
  const fixture = coverInputFixture();
  const web = await startWebServer(fixture.api); let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await visit(page, web.origin + '/admin/studio/drafts/cover-input-0?stage=cover');
    const file = page.getByLabel('封面图片文件', { exact: true });
    const alt = page.getByLabel('封面英文替代文字', { exact: true });
    const caption = page.getByLabel('封面英文图注', { exact: true });
    const image = await syntheticCover(page);
    await file.setInputFiles(image); await alt.fill('Synthetic panel retained after a failed upload'); await caption.fill('Retain this caption until the upload is confirmed.');
    const expectRetained = async () => {
      await expect(alt).toHaveValue('Synthetic panel retained after a failed upload');
      await expect(caption).toHaveValue('Retain this caption until the upload is confirmed.');
      assert.equal(await file.evaluate(input => (input as HTMLInputElement).files?.[0]?.name), image.name);
      await expect(page.getByRole('button', { name: '上传为候选', exact: true })).toBeEnabled();
      assert.equal(fixture.covers[0].candidates.length, 0);
    };
    fixture.covers[0].revision++;
    await page.getByRole('button', { name: '上传为候选', exact: true }).click();
    await expect(page.getByText('稿件或封面已变化，请刷新后再操作。', { exact: true })).toBeVisible();
    await expectRetained();
    assert.equal(fixture.writes[0].body.revision, 0, 'the first upload carries the version originally displayed');
    await captureCoverReview(page, 'version-conflict', 390);
    fixture.upload.status = 500;
    await page.getByRole('button', { name: '上传为候选', exact: true }).click();
    await expect(page.getByText('封面候选暂未保存，请重试。', { exact: true })).toBeVisible();
    await expectRetained();
    assert.equal(fixture.writes[1].body.revision, 1, 'retry uses freshly read cover metadata without changing the input');
    const uploadUrl = web.origin + '/api/admin/studio/drafts/cover-input-0/covers';
    await page.route(uploadUrl, async route => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
    await page.getByRole('button', { name: '上传为候选', exact: true }).click();
    await expect(page.getByText('网络错误，请稍后再试', { exact: true })).toBeVisible();
    await expectRetained();
    await page.unroute(uploadUrl);
    fixture.upload.status = 200;
    await page.getByRole('button', { name: '上传为候选', exact: true }).click();
    await expect(page.getByRole('button', { name: '采用这张', exact: true })).toBeVisible();
    await expect(alt).toHaveValue(''); await expect(caption).toHaveValue('');
    assert.equal(await file.evaluate(input => (input as HTMLInputElement).files?.length), 0);
    assert.equal(fixture.writes.length, 3, 'only the two rejected requests and the successful retry reach the API');
    assert.equal(fixture.covers[0].candidates.length, 1);
    assert.equal(fixture.covers[0].candidates[0].caption_en, 'Retain this caption until the upload is confirmed.');
    assert.equal(fixture.covers[0].selectedHash, null);
    await captureCoverReview(page, 'uploaded-clean', 390);
  } finally { await browser?.close(); await web.stop(); }
});

test('a confirmed cover upload allows departure while the candidate refresh is still pending', async () => {
  const fixture = coverInputFixture();
  const refresh = Promise.withResolvers<void>();
  const web = await startWebServer(fixture.api); let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const dialogs: string[] = [];
    page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
    await visit(page, web.origin + '/admin/studio/drafts/cover-input-0?stage=cover');
    const file = page.getByLabel('封面图片文件', { exact: true });
    const alt = page.getByLabel('封面英文替代文字', { exact: true });
    await file.setInputFiles(await syntheticCover(page)); await alt.fill('Synthetic saved panel');
    fixture.coverRead.wait = refresh.promise;
    await page.getByRole('button', { name: '上传为候选', exact: true }).click();
    await expect.poll(() => fixture.coverRead.requests).toBe(2);
    await expect(alt).toHaveValue('');
    assert.equal(fixture.covers[0].candidates.length, 1);
    const flow = page.getByRole('navigation', { name: '当前稿件流程' });
    await flow.getByRole('button', { name: '手工交付', exact: true }).click();
    await expect(flow.getByRole('button', { name: '手工交付', exact: true })).toHaveAttribute('aria-current', 'step');
    await flow.getByRole('button', { name: '审正文', exact: true }).click();
    await expect(flow.getByRole('button', { name: '审正文', exact: true })).toHaveAttribute('aria-current', 'step');
    assert.equal(dialogs.length, 0, 'a read-only refresh does not hold a completed write open');
    assert.equal(fixture.writes.length, 1);
  } finally { refresh.resolve(); await browser?.close(); await web.stop(); }
});

test('a failed candidate refresh reports the saved upload accurately and leaves the form clean', async () => {
  const fixture = coverInputFixture();
  const web = await startWebServer(fixture.api); let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await visit(page, web.origin + '/admin/studio/drafts/cover-input-0?stage=cover');
    const file = page.getByLabel('封面图片文件', { exact: true });
    const alt = page.getByLabel('封面英文替代文字', { exact: true });
    await file.setInputFiles(await syntheticCover(page)); await alt.fill('Synthetic saved panel');
    fixture.coverRead.status = 500;
    await page.getByRole('button', { name: '上传为候选', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('封面候选已保存，列表暂未刷新');
    await expect(page.getByRole('button', { name: '采用这张', exact: true })).toBeVisible();
    await expect(alt).toHaveValue('');
    assert.equal(await file.evaluate(input => (input as HTMLInputElement).files?.length), 0);
    assert.equal(fixture.writes.length, 1);
    await captureCoverReview(page, 'saved-refresh-failed', 390);
  } finally { await browser?.close(); await web.stop(); }
});

test('cover protection works with Tab, Enter and Space at 820px and 200% CSS zoom', async () => {
  const fixture = coverInputFixture();
  const web = await startWebServer(fixture.api); let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 820, height: 900 } });
    const dialogs: string[] = [];
    page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
    await visit(page, web.origin + '/admin/studio/drafts/cover-input-0?stage=cover');
    // CSS magnification is a layout check; it is not browser-chrome zoom or physical-device evidence.
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    const tabTo = async (target: Locator) => {
      for (let step = 0; step < 80; step++) {
        if (await target.evaluate(element => element === document.activeElement)) return;
        await page.keyboard.press('Tab');
      }
      assert.fail('The intended control was not reachable by Tab.');
    };
    const file = page.getByLabel('封面图片文件', { exact: true });
    const alt = page.getByLabel('封面英文替代文字', { exact: true });
    const caption = page.getByLabel('封面英文图注', { exact: true });
    await expect(file).toBeEnabled();
    await tabTo(file);
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await chooser).setFiles(await syntheticCover(page));
    await tabTo(alt); await page.keyboard.type('Synthetic panel entered with the keyboard');
    await page.keyboard.press('Tab'); await expect(caption).toBeFocused();
    await page.keyboard.type('A keyboard review sample.');
    const flow = page.getByRole('navigation', { name: '当前稿件流程' });
    const delivery = flow.getByRole('button', { name: '手工交付', exact: true });
    await tabTo(delivery); await page.keyboard.press('Enter');
    await expect.poll(() => dialogs.length).toBe(1);
    await expect(alt).toHaveValue('Synthetic panel entered with the keyboard');
    await expect(caption).toHaveValue('A keyboard review sample.');
    assert.equal(await file.evaluate(input => (input as HTMLInputElement).files?.length), 1);
    await captureCoverReview(page, 'keyboard-css-zoom-200-unsaved', 820);
    const upload = page.getByRole('button', { name: '上传为候选', exact: true });
    await tabTo(upload); await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: '采用这张', exact: true })).toBeVisible();
    await expect(alt).toHaveValue(''); await expect(caption).toHaveValue('');
    await captureCoverReview(page, 'keyboard-css-zoom-200-saved', 820);
    await tabTo(delivery); await page.keyboard.press('Enter');
    await expect(delivery).toHaveAttribute('aria-current', 'step');
    assert.equal(dialogs.length, 1);
    assert.equal(fixture.writes.length, 1);
    assert.equal(fixture.covers[0].selectedHash, null);
  } finally { await browser?.close(); await web.stop(); }
});
