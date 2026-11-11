// Production SSR with synthetic HTTP data. These checks do not replace browser interaction tests.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fakeApi, startWebServer, type WebServer } from './web-server.ts';

let web: WebServer;
const writes: string[] = [];
const api = fakeApi((url, _res, req) => {
  if (req.method !== 'GET' && url.pathname !== '/api/site/track') writes.push(url.pathname);
  if (url.pathname === '/api/admin/me') return { name: 'Synthetic editor', csrf: 'fixture', dev: false };
  if (url.pathname === '/api/admin/nav-counts') return {};
  if (url.pathname === '/api/admin/studio/review-metrics') return {};
  if (url.pathname === '/api/admin/studio/pitches') return { rows: [{ id: 'pitch-fixture', title: '买家如何核对箱体尺寸？', version: 2, status: 'ready', task_id: null }] };
  if (url.pathname === '/api/admin/studio') return {
    rows: [{ id: 'source-fixture', title: 'LED cabinet reference', url: 'https://maker.example.test/reference',
      source_name: 'Synthetic manufacturer', published_at: '2026-11-08T08:00:00Z', publication_time: '2026-11-08',
      discovered_at: '2026-11-08T08:00:00Z', body_status: 'ok', body_length: 500, last_extraction: null }],
    total: 1, page: 1, stats: { materials: 1, body_ready: 1 }, sources: [], tasks: [],
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
