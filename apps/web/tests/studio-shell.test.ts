// Production build with synthetic HTTP data. Selection checks do not prove production content quality.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { fakeApi, startWebServer, visit, type WebServer } from './web-server.ts';

let web: WebServer;
const writes: string[] = [];
const fixtureMaterials = [
  { id: 'source-fixture', title: 'LED cabinet reference', analysis: { category: 'displays-projects', item_type: 'tutorial_explainer', reason_zh: '列出安装前需要核对的箱体尺寸和接口条件。' } },
  { id: 'source-unassessed', title: '尚待评估的显示材料', analysis: null },
  { id: 'source-unknown', title: '未识别分类的原始材料', analysis: { category: 'unrecognized-category', item_type: 'unrecognized-type', reason_zh: null } },
  { id: 'source-reviewed', title: '户外显示项目的补充资料', analysis: { category: 'displays-projects', item_type: 'industry_event', reason_zh: '旧的分析理由不应覆盖当前编辑判断。' }, editorial: { decision: 'HOLD', reason_zh: '需要核对项目竣工日期。' } },
  { id: 'source-long', title: '长标题隔离样本：采购户外 LED 显示屏时怎样比较不同箱体尺寸、安装条件与 P3.91 型号的适用范围', analysis: { category: 'components-ics', item_type: 'research_paper', reason_zh: '对照现有原文列出参数条件，保留型号和单位；这份内容用于检查长标题与理由换行。' } },
  { id: 'source-missing', title: '需要补齐正文的材料', analysis: null },
].map(item => ({ url: 'https://maker.example.test/' + item.id, source_name: 'Synthetic manufacturer', published_at: '2026-11-08T08:00:00Z', publication_time: '2026-11-08', discovered_at: '2026-11-08T08:00:00Z', body_status: item.id === 'source-missing' ? 'missing' : 'ok', body_length: item.id === 'source-missing' ? 0 : 500, last_extraction: null, ...item }));
const api = fakeApi((url, _res, req) => {
  if (req.method !== 'GET' && url.pathname !== '/api/site/track') writes.push(url.pathname);
  if (url.pathname === '/api/admin/me') return { name: 'Synthetic editor', csrf: 'fixture', dev: false };
  if (url.pathname === '/api/admin/nav-counts') return {};
  if (url.pathname === '/api/admin/studio/review-metrics') return {};
  if (url.pathname === '/api/admin/studio/pitches') return { rows: [{ id: 'pitch-fixture', title: '买家如何核对箱体尺寸？', version: 2, status: 'ready', task_id: null }] };
  if (url.pathname === '/api/admin/studio') return {
    rows: fixtureMaterials,
    total: fixtureMaterials.length, page: 1, stats: { materials: fixtureMaterials.length, body_ready: fixtureMaterials.length - 1 }, sources: [], tasks: [],
    generation: { ready: false, reason: 'Synthetic model unavailable' },
    drafts: [{ id: 'draft-fixture', title_zh: '尺寸指南测试稿', title_en: 'Synthetic dimensions guide', status: 'in_review', version: 2, updated_at: '2026-11-08T08:00:00Z' }],
  };
});

test('original workbench home resumes API drafts and exposes original tools without starting work', async () => {
  const response = await fetch(web.origin + '/admin/workbench');
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const text of ['尺寸指南测试稿', '买家如何核对箱体尺寸？', '今日选稿', '选题与旧页升级', '采编任务', '社媒派生', '内容诊断', '模型连接']) assert.ok(html.includes(text), text);
  assert.match(html, /href="\/admin\/studio\/drafts\/draft-fixture"/);
  assert.match(html, /href="\/admin\/studio\/pitch\?id=pitch-fixture"/);
  assert.deepEqual(writes, []);
});

before(async () => { web = await startWebServer(api); });
after(() => web.stop());

test('editor desk SSR contains real material selection and existing-draft entry without starting work', async () => {
  const response = await fetch(web.origin + '/admin/studio');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control') ?? '', /\bno-store\b/);
  const html = await response.text();
  for (const text of ['今日选稿', '专业内容', '我的稿件', '发布记录', '继续审稿', 'LED cabinet reference']) assert.ok(html.includes(text), text);
  assert.match(html, /href="\/admin\/studio\/drafts\/draft-fixture"/);
  assert.match(html, /role="checkbox"[^>]*aria-label="选择 LED cabinet reference"|aria-label="选择 LED cabinet reference"[^>]*role="checkbox"/);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.deepEqual(writes, []);
});

test('draft query changes the one highlighted destination while retaining review links', async () => {
  const response = await fetch(web.origin + '/admin/studio?tab=drafts&status=in_review');
  assert.equal(response.status, 200);
  const html = await response.text();
  const currentLinks = html.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
  assert.equal(currentLinks.length, 1);
  assert.match(currentLinks[0], /href="\/admin\/studio\?tab=drafts"/);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, /href="\/admin\/studio\/drafts\/draft-fixture"/);
  assert.deepEqual(writes, []);
});

for (const width of [1440, 390, 320]) test(`candidate choices expose stored context and keep selection separate from generation at ${width}`, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await visit(page, web.origin + '/admin/studio');
    const material = (id: string) => page.locator('article').filter({ has: page.getByRole('link', { name: fixtureMaterials.find(item => item.id === id)!.title, exact: true }) });
    const screenshot = async (name: string) => {
      const directory = process.env.AIHOT_UI_REVIEW_DIR;
      if (!directory) return;
      mkdirSync(directory, { recursive: true });
      await page.screenshot({ path: path.join(directory, `impeccable-selection-${name}-${width}.png`), fullPage: name === 'context' });
    };
    await expect(material('source-fixture').getByText('Displays & Projects', { exact: true })).toBeVisible();
    await expect(material('source-fixture').getByText('教程说明', { exact: true })).toBeVisible();
    await expect(material('source-fixture').getByText('参考理由：列出安装前需要核对的箱体尺寸和接口条件。', { exact: true })).toBeVisible();
    await expect(material('source-unassessed').getByText('暂无选题建议', { exact: true })).toBeVisible();
    await expect(material('source-unknown').getByText('暂无选题建议', { exact: true })).toBeVisible();
    await expect(page.getByText('unrecognized-category', { exact: true })).toHaveCount(0);
    await expect(material('source-reviewed').getByText('需要核对项目竣工日期。', { exact: true })).toBeVisible();
    await expect(page.getByText('旧的分析理由不应覆盖当前编辑判断。', { exact: true })).toHaveCount(0);
    await expect(material('source-fixture').getByRole('link', { name: '查看原文', exact: true })).toHaveAttribute('href', fixtureMaterials[0].url);
    await screenshot('context');

    const first = page.getByRole('checkbox', { name: '选择 ' + fixtureMaterials[0].title, exact: true });
    await first.focus(); await page.keyboard.press('Space');
    await expect(first).toBeChecked();
    await expect(page.getByRole('region', { name: '已选素材操作' })).toContainText('已选 1 条');
    await page.keyboard.press('Space');
    await expect(first).not.toBeChecked();
    await expect(page.getByRole('region', { name: '已选素材操作' })).toHaveCount(0);
    // The visible label is a selection target; it does not navigate to the material.
    await material('source-fixture').locator('label').filter({ hasText: '选择' }).click();
    await expect(first).toBeChecked();
    for (const item of fixtureMaterials.slice(1, 4)) await page.getByRole('checkbox', { name: '选择 ' + item.title, exact: true }).check();
    await expect(page.getByRole('button', { name: '一键评估并成稿', exact: true })).toBeDisabled();
    await expect(page.getByRole('region', { name: '已选素材操作' })).toContainText('再选 1 条');
    await page.getByRole('checkbox', { name: '选择 ' + fixtureMaterials[4].title, exact: true }).check();
    await expect(page.getByRole('button', { name: '合成一期短讯', exact: true })).toBeDisabled();
    await expect(page.getByRole('region', { name: '已选素材操作' })).toContainText('去重后满 5 个独立事件');
    await screenshot('selected');

    const options = page.getByRole('button', { name: '选稿设置', exact: true });
    await options.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: '所选材料与写作设置', exact: true })).toBeVisible();
    await expect(dialog).toContainText('这里设置本次选材与写作要求，成稿后继续审稿。');
    await expect(dialog.getByText(/直接上线|一键成文并上线/)).toHaveCount(0);
    await screenshot('manual-options');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(options).toBeFocused();
    await expect(first).toBeChecked();
    await page.getByRole('checkbox', { name: '选择 ' + fixtureMaterials[5].title, exact: true }).check();
    await expect(page.getByRole('region', { name: '已选素材操作' })).toContainText('还缺 1 条完整正文');
    await expect(page.getByRole('button', { name: '补齐所选正文 / 日期', exact: true })).toBeEnabled();
    await screenshot('needs-body');
    await page.getByRole('button', { name: '清空选择', exact: true }).click();
    await expect(page.getByRole('region', { name: '已选素材操作' })).toHaveCount(0);
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
  } finally { await browser.close(); }
});
