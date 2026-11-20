import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { isWorkbenchNavActive, workbenchNavigation } from '../app/features/admin/navigation.ts';
import { fakeApi, startWebServer, visit } from './web-server.ts';

const cases = [
  ['/admin/workbench', '', '工作台'],
  ['/admin/studio', '', '新闻材料'],
  ['/admin/studio', '?tab=materials&q=MiP&page=2', '新闻材料'],
  ['/admin/studio/materials/example', '', '新闻材料'],
  ['/admin/studio', '?tab=drafts&status=in_review', '稿件'],
  ['/admin/studio/drafts/example', '', '稿件'],
] as const;

for (const [pathname, search, expected] of cases) {
  test(`workbench navigation has one current destination: ${pathname}${search}`, () => {
    const active = workbenchNavigation.filter(entry => isWorkbenchNavActive(pathname, search, entry.to));
    assert.equal(active.length, 1);
    assert.equal(active[0].label, expected);
  });
}

test('advanced destinations never activate a main workbench tab', () => {
  for (const [pathname, search] of [
    ['/admin/studio', '?tab=tasks'], ['/admin/studio', '?tab=sources'],
    ['/admin/studio', '?tab=review'], ['/admin/studio/planning', ''],
    ['/admin/studio/pitch', '?question_id=example'], ['/admin/studio/published', ''],
    ['/admin/settings', ''], ['/admin/studio/pitchfork', ''],
  ]) assert.equal(workbenchNavigation.some(entry => isWorkbenchNavActive(pathname, search, entry.to)), false);
});

test('query tabs and unrelated route prefixes cannot both be active', () => {
  assert.equal(isWorkbenchNavActive('/admin/studio', '?tab=sources', '/admin/studio?tab=tasks'), false);
  assert.equal(isWorkbenchNavActive('/admin/studio', '?tab=review', '/admin/studio?tab=review'), true);
  assert.equal(isWorkbenchNavActive('/admin/sources/example', '', '/admin/sources'), true);
  assert.equal(isWorkbenchNavActive('/admin/sources-extra', '', '/admin/sources'), false);
});

test('admin configuration keeps edits while operators navigate and inspect data', async t => {
  const writes: string[] = [];
  const channels = ['deepseek', 'custom'].map(id => ({ id, name: id === 'custom' ? 'Custom' : 'DeepSeek', baseUrl: `https://${id}.example.test/v1`, model: 'fixture-model', enabled: true, active: id === 'deepseek', hasKey: false, maskedKey: null, keySource: 'missing' }));
  const channelData = { channels, activeId: 'deepseek', source: 'settings', modelCallsEnabled: false };
  const source = { id: 'fixture', name: 'Saved source', kind: 'rss', enabled: true, interval_minutes: 30, tier: 'official', participation_mode: 'editorial', signal_group_id: null, first_party: false, owner_entity_id: null, site_fulltext: false, syndicate_fulltext: false, tags: [], config: { url: 'https://source.example.test/feed', timezone: '+08:00' }, created_at: '2026-11-20T08:00:00Z', updated_at: '2026-11-20T08:00:00Z', health: 'ok', fail_count: 0 };
  const api = fakeApi(async (url, _res, req) => {
    if (req.method !== 'GET' && url.pathname !== '/api/site/track') writes.push(url.pathname);
    if (url.pathname === '/api/admin/me') return { name: 'Synthetic editor', csrf: 'fixture', dev: false };
    if (url.pathname === '/api/admin/nav-counts') return {};
    if (url.pathname === '/api/admin/channels') return channelData;
    if (url.pathname === '/api/admin/channels/custom' && req.method === 'PUT') {
      let text = ''; for await (const chunk of req) text += chunk;
      const body = JSON.parse(text);
      Object.assign(channels[1]!, { baseUrl: body.baseUrl.trim(), model: body.model.trim(), enabled: body.enabled, hasKey: true, maskedKey: '***fixture' });
      return channelData;
    }
    if (url.pathname === '/api/admin/sources/fixture') {
      if (req.method === 'PATCH') {
        let text = ''; for await (const chunk of req) text += chunk;
        Object.assign(source, JSON.parse(text).patch, { updated_at: '2026-11-20T09:00:00Z' });
        source.config = { url: source.config.url, timezone: source.config.timezone };
        return source;
      }
      return { source, runs: [], items: [], stats: { total: 0, last7d: 0, selected: 0 }, history: [] };
    }
    if (url.pathname === '/api/admin/audit') return { rows: [], page: Number(url.searchParams.get('page') ?? 1) };
    if (url.pathname === '/api/admin/settings') return { contact: { wechatQr: null, feishuQr: null }, targets: [], budgets: [{ service: 'fixture-model', per_minute: 10, per_hour: 100, per_day: 1000, used_hour: 0, used_day: 0, updated_at: '2026-11-20T08:00:00Z' }] };
    if (url.pathname === '/api/admin/selectbench/fixture') return {
      run: { label: 'Synthetic assessment', models: ['fixture-model'], summary: {}, sample_size: 1, created_at: '2026-11-20T08:00:00Z' }, strata: [],
      rows: [{ case_id: 'sample-1', title: 'LED cabinet sample', gold: 'select', by_model: { 'fixture-model': { decision: 'select', score: 90, reason: 'An attributed technical release.' } } }],
    };
  });
  const web = await startWebServer(api);
  t.after(() => web.stop());
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));

  await t.test('channel tabs retain input and API key in memory without making model requests', async () => {
    await visit(page, web.origin + '/admin/channels');
    await page.getByRole('tab', { name: 'Custom', exact: true }).click();
    const panel = page.getByRole('tabpanel', { name: 'Custom', exact: true });
    await panel.getByLabel('API 根地址', { exact: true }).fill(' https://edited.example.test/v1 ');
    await panel.getByLabel('模型', { exact: true }).fill(' edited-model ');
    await panel.getByLabel('API Key', { exact: true }).fill('synthetic-key-not-a-credential');
    await page.getByRole('tab', { name: 'Custom', exact: true }).press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'DeepSeek · 当前', exact: true })).toBeFocused();
    await expect(panel).not.toBeVisible();
    await page.getByRole('tab', { name: 'DeepSeek · 当前', exact: true }).press('ArrowRight');
    await expect(panel.getByLabel('API Key', { exact: true })).toHaveValue('synthetic-key-not-a-credential');
    await expect(panel.getByLabel('模型', { exact: true })).toHaveValue(' edited-model ');
    assert.deepEqual(writes, []);
    assert.equal(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]).includes('synthetic-key-not-a-credential')), false);
    await panel.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(panel.getByLabel('模型', { exact: true })).toHaveValue('edited-model');
    await expect(panel.getByLabel('API 根地址', { exact: true })).toHaveValue('https://edited.example.test/v1');
    await expect(panel.getByLabel('API Key', { exact: true })).toHaveValue('');
    await expect(panel.getByRole('button', { name: '检查模型列表（不生成）' })).toBeEnabled();
    assert.deepEqual(writes, ['/api/admin/channels/custom']);
  });

  await t.test('pausing a source preserves its unsaved name and config', async () => {
    await visit(page, web.origin + '/admin/sources/fixture');
    await page.getByLabel('名称', { exact: true }).fill('Unfinished source edit');
    const config = '{"url":"https://edited.example.test/feed","timezone":"+08:00"}';
    await page.getByLabel('采集配置（JSON）').fill(config);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '暂停这个信源' });
    await dialog.getByLabel('原因（写进审计记录）').fill('Synthetic pause test');
    await dialog.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(page.getByRole('button', { name: '恢复', exact: true })).toBeVisible();
    await expect(page.getByLabel('名称', { exact: true })).toHaveValue('Unfinished source edit');
    await expect(page.getByLabel('采集配置（JSON）')).toHaveValue(config);
    assert.equal(source.name, 'Saved source');
    assert.equal(source.config.url, 'https://source.example.test/feed');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const save = page.getByRole('dialog', { name: '保存信源设置' });
    await save.getByLabel('原因（写进审计记录）').fill('Save the preserved edit');
    await save.getByRole('button', { name: '确认', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    assert.equal(source.name, 'Unfinished source edit');
    assert.equal(source.config.url, 'https://edited.example.test/feed');
    await page.getByLabel('采集配置（JSON）').fill('{"timezone":"+08:00","url":"https://edited.example.test/feed"}');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await save.getByLabel('原因（写进审计记录）').fill('Accept canonical JSON key order');
    await save.getByRole('button', { name: '确认', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    await expect(page.getByLabel('采集配置（JSON）')).toHaveValue(JSON.stringify(source.config, null, 2));
  });

  await t.test('audit filters submit by button and Enter; limits and assessment are keyboard accessible', async () => {
    await visit(page, web.origin + '/admin/audit?page=2');
    await page.getByLabel('操作', { exact: true }).fill('source.');
    await page.getByLabel('对象', { exact: true }).fill('source:fixture');
    await page.getByRole('button', { name: '筛选', exact: true }).click();
    await expect(page).toHaveURL(/action=source\.&subject=source%3Afixture$/);
    await page.getByLabel('操作', { exact: true }).fill('content.');
    await page.getByLabel('操作', { exact: true }).press('Enter');
    await expect(page).toHaveURL(/action=content\.&subject=source%3Afixture$/);
    await visit(page, web.origin + '/admin/settings');
    for (const label of ['每分钟', '每小时', '每天']) await expect(page.getByRole('spinbutton', { name: `fixture-model ${label}`, exact: true })).toBeVisible();
    await visit(page, web.origin + '/admin/selectbench/fixture');
    const sample = page.getByRole('button', { name: 'LED cabinet sample', exact: true });
    await sample.focus();
    await sample.press('Enter');
    await expect(sample).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('An attributed technical release.', { exact: true })).toBeVisible();
    await sample.press('Space');
    await expect(sample).toHaveAttribute('aria-expanded', 'false');
    assert.deepEqual(errors, []);
  });
});
