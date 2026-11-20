// Production build with synthetic HTTP data. Selection checks do not prove production content quality.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { fakeApi, startWebServer, visit, type WebServer } from './web-server.ts';
import type { AdminChannels, AdminSource, Timestamp } from '@aihot/contracts/admin';

let web: WebServer;
const writes: string[] = [];
let homeDrafts = [{ id: 'draft-fixture', title_zh: '尺寸指南测试稿', title_en: 'Synthetic dimensions guide', status: 'in_review', version: 2, updated_at: '2026-11-08T08:00:00Z' }];
let homeTasks: { id: string; state: string }[] = [];
let sourceDraftFixture: AdminSource = {
  id: 'editable-fixture', name: 'Synthetic editable source', kind: 'rss', config: { url: 'https://example.test/feed' },
  tags: ['LED'], first_party: true, owner_entity_id: null, tier: 'T1', participation_mode: 'editorial',
  signal_group_id: null, interval_minutes: 60, site_fulltext: false, syndicate_fulltext: false,
  enabled: true, health: 'ok', fail_count: 0, last_fetch_at: null, last_ok_at: null, last_error: null,
  cursor: null, next_fetch_at: null, created_at: '2026-11-20T08:00:00Z' as Timestamp, updated_at: '2026-11-20T08:00:00Z' as Timestamp,
};
let channelDraftFixture: AdminChannels = {
  activeId: 'opencode-go', source: 'settings', modelCallsEnabled: false,
  channels: (['opencode-go', 'deepseek', 'custom'] as const).map(id => ({
    id, name: id, baseUrl: `https://${id}.example.test/v1`, model: `${id}-model`, enabled: true,
    active: id === 'opencode-go', hasKey: false, maskedKey: null, keySource: 'missing',
  })),
};
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
  if (url.pathname === '/api/admin/audit') return { page: 1, rows: [] };
  if (url.pathname === '/api/admin/settings') return {
    contact: { wechatQr: null, feishuQr: null }, targets: [],
    budgets: [{ service: 'fixture-model', per_minute: 2, per_hour: 20, per_day: 100, updated_at: '2026-11-08T08:00:00Z', used_hour: 0, used_day: 0 }],
  };
  if (url.pathname === '/api/admin/selectbench') return { runs: [] };
  if (url.pathname === '/api/admin/selectbench/keyboard-fixture') return {
    run: { id: 'keyboard-fixture', label: '键盘核对运行', created_at: '2026-11-08T08:00:00Z', split: null, sample_size: 1, prompt_version: null, models: ['fixture-model'], summary: { 'fixture-model': {} } },
    rows: [{ case_id: 'case-keyboard', title: '键盘核对样本', stratum: null, gold: 'select', by_model: { 'fixture-model': { decision: 'select', score: 80, relevance: 'direct', category: null, reason: '隔离样本判断依据', error: null, receiptId: null } } }], strata: [],
  };
  if (url.pathname === '/api/admin/studio/review-metrics') return {};
  if (url.pathname === '/api/admin/sources/editable-fixture') return { source: sourceDraftFixture, runs: [], items: [], history: [], stats: { total: 0, last7d: 0, selected: 0 }, republish: null };
  if (url.pathname === '/api/admin/channels') return channelDraftFixture;
  if (url.pathname === '/api/admin/studio/pitches') return { rows: [{ id: 'pitch-fixture', title: '买家如何核对箱体尺寸？', version: 2, status: 'ready', task_id: null }] };
  if (url.pathname === '/api/admin/studio') return {
    rows: fixtureMaterials,
    total: fixtureMaterials.length, page: 1, stats: { materials: fixtureMaterials.length, body_ready: fixtureMaterials.length - 1 }, sources: [], tasks: homeTasks,
    generation: { ready: false, reason: 'Synthetic model unavailable' },
    drafts: homeDrafts,
  };
});

test('original workbench home resumes API drafts and exposes original tools without starting work', async () => {
  const response = await fetch(web.origin + '/admin/workbench');
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const text of ['尺寸指南测试稿', '买家如何核对箱体尺寸？', '新闻材料', '选题与旧页升级', '处理进度', '改写社媒稿', '内容诊断', '模型连接']) assert.ok(html.includes(text), text);
  assert.match(html, /href="\/admin\/studio\/drafts\/draft-fixture"/);
  assert.match(html, /href="\/admin\/studio\/pitch\?id=pitch-fixture"/);
  assert.deepEqual(writes, []);
});

before(async () => { web = await startWebServer(api); });
after(() => web.stop());

test('home resumes an English-only draft, a saved pitch and waiting database tasks', async t => {
  const original = homeDrafts;
  t.after(() => { homeDrafts = original; homeTasks = []; });
  homeDrafts = [{ ...original[0], title_zh: '' }];
  let html = await (await fetch(web.origin + '/admin/workbench')).text();
  assert.match(html, /<h2[^>]*id="resume-title"[^>]*lang="en"[^>]*>Synthetic dimensions guide<\/h2>/);
  homeDrafts = [];
  homeTasks = [{ id: 'task-existing', state: 'waiting' }];
  html = await (await fetch(web.origin + '/admin/workbench')).text();
  assert.match(html, /<h2[^>]*id="resume-title"[^>]*>买家如何核对箱体尺寸？<\/h2>/);
  assert.match(html, /href="\/admin\/studio\/pitch\?id=pitch-fixture"[^>]*>继续选题</);
  assert.match(html, /项未完成任务/);
  assert.deepEqual(writes, []);
});

test('editor desk SSR contains real material selection and existing-draft entry without starting work', async () => {
  const response = await fetch(web.origin + '/admin/studio');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control') ?? '', /\bno-store\b/);
  const html = await response.text();
  for (const text of ['选题', '写下买家问题', '稿件', '继续审稿', 'LED cabinet reference']) assert.ok(html.includes(text), text);
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
    if (width === 320) {
      // The final source action must clear the fixed selection bar at the end of the page.
      const lastSource = material('source-missing').getByRole('link', { name: '查看原文', exact: true });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect.poll(async () => {
        const link = await lastSource.boundingBox();
        const toolbar = await page.getByRole('region', { name: '已选素材操作' }).boundingBox();
        return !!link && !!toolbar && link.y + link.height <= toolbar.y;
      }).toBe(true);
      await lastSource.click({ trial: true });
      await screenshot('last-material-clear');
    }
    await page.getByRole('button', { name: '清空选择', exact: true }).click();
    await expect(page.getByRole('region', { name: '已选素材操作' })).toHaveCount(0);
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
  } finally { await browser.close(); }
});

test('source pause preserves edits, save keeps the paused status, and restore uses the latest saved source', async t => {
  const original = sourceDraftFixture;
  t.after(() => { sourceDraftFixture = original; });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const patches: Record<string, unknown>[] = [];
    await page.route('**/api/admin/sources/editable-fixture', async route => {
      const body = route.request().postDataJSON();
      patches.push(body.patch);
      sourceDraftFixture = { ...sourceDraftFixture, ...body.patch, updated_at: `2026-11-20T08:0${patches.length}:00Z` as Timestamp };
      await route.fulfill({ json: sourceDraftFixture });
    });
    await visit(page, web.origin + '/admin/sources/editable-fixture');
    const name = page.getByRole('textbox', { name: '名称', exact: true });
    await name.fill('Unsaved local title');
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').fill('Synthetic pause test');
    await dialog.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(page.getByRole('button', { name: '恢复', exact: true })).toBeVisible();
    await expect(name).toHaveValue('Unsaved local title');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await dialog.getByRole('textbox').fill('Synthetic save test');
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    assert.deepEqual(patches, [{ enabled: false }, { name: 'Unsaved local title' }]);
    assert.equal(sourceDraftFixture.enabled, false);
    await name.fill('Discard this edit');
    await page.getByRole('button', { name: '还原', exact: true }).click();
    await expect(name).toHaveValue('Unsaved local title');
  } finally { await browser.close(); }
});

test('channel tabs support arrows, Home and End while preserving separate drafts and memory-only keys', async t => {
  const original = channelDraftFixture;
  t.after(() => { channelDraftFixture = original; });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    let savedModel = '';
    await page.route('**/api/admin/channels/deepseek', async route => {
      const body = route.request().postDataJSON();
      savedModel = body.model;
      channelDraftFixture = {
        ...channelDraftFixture,
        channels: channelDraftFixture.channels.map(channel => channel.id === 'deepseek' ? { ...channel, model: body.model, baseUrl: body.baseUrl, enabled: body.enabled } : channel),
      };
      await route.fulfill({ json: { saved: true } });
    });
    await page.route('**/api/admin/channels/deepseek/test', route => route.fulfill({ json: {
      channelId: 'deepseek', kind: 'models', ok: true, status: 200, model: 'deepseek-model',
      returnedModel: 'deepseek-model', models: ['deepseek-model'], detail: 'Synthetic connection result',
    } }));
    await visit(page, web.origin + '/admin/channels');
    const go = page.getByRole('tab', { name: 'opencode-go · 当前', exact: true });
    const deepseek = page.getByRole('tab', { name: 'deepseek', exact: true });
    const custom = page.getByRole('tab', { name: 'custom', exact: true });
    const activePanel = () => page.getByRole('tabpanel');
    await go.focus();
    await page.keyboard.press('End');
    await expect(custom).toBeFocused();
    await expect(custom).toHaveAttribute('aria-selected', 'true');
    await expect(activePanel()).toHaveCount(1);
    await activePanel().getByRole('textbox', { name: '模型', exact: true }).fill('Custom unsaved model');
    await activePanel().getByLabel('API Key', { exact: true }).fill('fixture-only-secret');
    await custom.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(deepseek).toBeFocused();
    await expect(deepseek).toHaveAttribute('aria-selected', 'true');
    await activePanel().getByRole('button', { name: '检查模型列表（不生成）', exact: true }).click();
    await expect(activePanel().getByText('Synthetic connection result', { exact: true })).toBeVisible();
    await activePanel().locator('summary').filter({ hasText: '实际生成测试' }).click();
    await activePanel().getByRole('checkbox', { name: '确认执行一次实际生成测试', exact: true }).check();
    await activePanel().getByRole('textbox', { name: '模型', exact: true }).fill('DeepSeek saved model');
    await activePanel().getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(activePanel().getByRole('button', { name: '检查模型列表（不生成）', exact: true })).toBeEnabled();
    assert.equal(savedModel, 'DeepSeek saved model');
    await expect(activePanel().getByRole('checkbox', { name: '确认执行一次实际生成测试', exact: true })).not.toBeChecked();
    await expect(activePanel().getByText('Synthetic connection result', { exact: true })).toHaveCount(0);
    await deepseek.focus();
    await page.keyboard.press('ArrowRight');
    await expect(custom).toBeFocused();
    await expect(activePanel().getByRole('textbox', { name: '模型', exact: true })).toHaveValue('Custom unsaved model');
    await expect(activePanel().getByLabel('API Key', { exact: true })).toHaveValue('fixture-only-secret');
    assert.equal(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]).includes('fixture-only-secret')), false);
    await page.keyboard.press('Home');
    await expect(go).toBeFocused();
    await expect(go).toHaveAttribute('aria-selected', 'true');
    await expect(activePanel()).toHaveCount(1);
    await page.keyboard.press('End');
    await expect(custom).toBeFocused();
    await expect(activePanel().getByRole('textbox', { name: '模型', exact: true })).toHaveValue('Custom unsaved model');
  } finally { await browser.close(); }
});

test('operator tools name budgets, submit audit filters and expand benchmark details from the keyboard', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await visit(page, web.origin + '/admin/settings');
    for (const [window, value] of [['每分钟', '2'], ['每小时', '20'], ['每天', '100']]) {
      await expect(page.getByRole('spinbutton', { name: `fixture-model ${window}`, exact: true })).toHaveValue(value);
    }
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();

    await visit(page, web.origin + '/admin/audit?page=3');
    const boundaryContrast = await page.getByLabel('操作前缀', { exact: true }).evaluate(field => {
      const luminance = (color: string) => {
        const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const style = getComputedStyle(field);
      const levels = [luminance(style.borderTopColor), luminance(style.backgroundColor)].sort((a, b) => a - b);
      return (levels[1] + 0.05) / (levels[0] + 0.05);
    });
    assert.ok(boundaryContrast >= 3, `input boundary contrast ${boundaryContrast}:1 must be at least 3:1`);
    await page.getByLabel('操作前缀', { exact: true }).fill('source.');
    await page.getByLabel('对象', { exact: true }).fill('source:fixture');
    await page.getByRole('button', { name: '筛选', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('action')).toBe('source.');
    assert.equal(new URL(page.url()).searchParams.get('subject'), 'source:fixture');
    assert.equal(new URL(page.url()).searchParams.has('page'), false);
    await page.getByLabel('操作前缀', { exact: true }).fill('content.');
    await page.getByLabel('操作前缀', { exact: true }).press('Enter');
    await expect.poll(() => new URL(page.url()).searchParams.get('action')).toBe('content.');

    await visit(page, web.origin + '/admin/selectbench/keyboard-fixture');
    const sample = page.getByRole('button', { name: '键盘核对样本', exact: true });
    await sample.focus();
    await page.keyboard.press('Space');
    await expect(sample).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('隔离样本判断依据', { exact: true })).toBeVisible();
    await expect(sample).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(sample).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('隔离样本判断依据', { exact: true })).toHaveCount(0);
    await sample.click();
    await expect(sample).toHaveAttribute('aria-expanded', 'true');
    assert.deepEqual(writes, []);
  } finally { await browser.close(); }
});

test('reduced-motion notifications coalesce repeated errors and retain different errors', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
    const imported: unknown[] = [];
    await page.route('**/api/admin/selectbench/import', async route => {
      imported.push(route.request().postDataJSON());
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: '隔离测试服务暂不可用' }) });
    });
    await visit(page, web.origin + '/admin/selectbench');
    const upload = page.locator('input[type="file"]');
    const invalid = { name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{') };
    await upload.setInputFiles(invalid);
    const repeated = page.getByText('文件不是合法的报告 JSON', { exact: true });
    await expect(repeated).toBeVisible();
    await upload.setInputFiles(invalid);
    await expect(repeated).toHaveCount(1);
    await upload.setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await expect(page.getByText('隔离测试服务暂不可用', { exact: true })).toBeVisible();
    await expect(repeated).toHaveCount(1);
    assert.equal(imported.length, 1);
    assert.deepEqual(writes, []);
    const directory = process.env.AIHOT_UI_REVIEW_DIR;
    if (directory) {
      mkdirSync(directory, { recursive: true });
      await page.screenshot({ path: path.join(directory, 'impeccable-reduced-motion-distinct-toasts-390.png') });
    }
  } finally { await browser.close(); }
});
