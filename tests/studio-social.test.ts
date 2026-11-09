import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { closeDb, sql } from '@aihot/backend/db';
import { createStudioTask, exportStudioTask, receiveStudioTask, studioDraft, reviewStudioDraft, saveStudioDraft, exportStudioDraft } from '@aihot/backend/studio/studio';
import { deriveStudioSocial, listStudioSocial, saveStudioSocial, reviewStudioSocial, exportStudioSocial } from '@aihot/backend/admin/studio-social';

after(closeDb);
const suffix = tag(), actor = `test:social:${suffix}`, sourceId = `social-source-${suffix}`;
const sourceBody = 'The manufacturer describes LED display operating conditions. The display installation checklist covers mounting and maintenance access.';
before(async () => {
  await sql`INSERT INTO sources (id, name, kind, enabled) VALUES (${sourceId}, 'Synthetic LED Manufacturer', 'web_list', false)`;
});
async function blog(approve = true) {
  const article = `social-article-${tag()}`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at, published_at, body_status, body_text)
    VALUES (${article}, ${sourceId}, ${article}, ${`https://maker.example.test/${article}`}, 'LED display operating conditions', now(), now(), now(), 'ok', ${sourceBody})`;
  const task = await createStudioTask({ article_ids: [article] }, actor);
  const packet = (await exportStudioTask(task.id))!.request;
  const binding = packet.articles[0].binding;
  const draft = { source: binding, title_zh: '显示屏安装条件', review_zh: '据原厂介绍，显示屏安装前应核对结构和维护空间。',
    title_en: 'LED display operating conditions', body_en: `According to the manufacturer, the display installation checklist covers mounting and maintenance access.\n\nOriginal source: ${binding.url}`,
    meta_description_en: 'Manufacturer guidance for display installation.', keyword_hypothesis: 'LED display conditions',
    evidence: [{ claim: 'The manufacturer describes display conditions.', quote: 'The manufacturer describes LED display operating conditions.' }], questions_zh: [] };
  await receiveStudioTask(task.id, { task_id: task.id, run_id: `social-run-${tag()}`, producer: { agent_id: 'synthetic-social-test', model: null, input_files: ['synthetic-request.json'] },
    decisions: [{ article_id: article, decision: 'KEEP', reason_zh: '合成显示屏安装资料' }], drafts: [draft] }, actor);
  const [stored] = await sql`SELECT id FROM studio_drafts WHERE task_id = ${task.id}`;
  let row = (await studioDraft(stored.id))!;
  if (approve) {
    await reviewStudioDraft(row.id, { version: row.version, action: 'submit' }, actor);
    row = (await studioDraft(row.id))!;
    await reviewStudioDraft(row.id, { version: row.version, action: 'approve', confirmations: row.issues.items.filter(issue => issue.confirmable)
      .map(issue => ({ issueId: issue.id, fingerprint: issue.fingerprint })) }, actor);
  }
  return { row: (await studioDraft(stored.id))!, article, draft };
}
const confirmations = (row: Awaited<ReturnType<typeof listStudioSocial>>[number]) => row.issues.items.filter(issue => issue.confirmable)
  .map(issue => ({ issueId: issue.id, fingerprint: issue.fingerprint }));
async function social(parent: string, language: 'en' | 'zh' = 'en', platform: 'facebook' | 'linkedin' = 'facebook') {
  return deriveStudioSocial({ draft_id: parent, platform, language, blog_url: `https://chipshow.com/blog/operator-supplied-${suffix}/` }, actor);
}

test('only approved Blogs derive independent Chinese/English social drafts; Blog export remains English and statuses stay separate', async () => {
  const pending = await blog(false);
  await assert.rejects(social(pending.row.id), /审核/);
  const { row } = await blog();
  const zh = await social(row.id, 'zh'), en = await social(row.id, 'en', 'linkedin');
  assert.equal(zh.status, 'draft');
  assert.equal(en.status, 'draft');
  assert.match(zh.document.body, /显示屏/);
  assert.ok(zh.issues.items.every(issue => issue.ruleId !== 'W7'));
  await assert.rejects(exportStudioSocial(zh.id), /独立审核/);
  const approved = (await reviewStudioSocial(zh.id, { version: zh.version, action: 'approve', confirmations: confirmations(zh) }, actor))!;
  assert.equal(approved.status, 'approved');
  const output = JSON.parse((await exportStudioSocial(zh.id, 'json'))!.body).publication;
  assert.equal(output.language, 'zh');
  assert.equal(output.platform, 'facebook');
  assert.equal(output.publication, 'NOT_PERFORMED');
  assert.ok(output.text.includes(zh.document.blog_url));
  assert.ok(output.text.includes(zh.document.source.url));
  assert.ok(output.text.includes(zh.document.source.published_at));
  assert.ok(output.characterCount > 0 && output.wordCount > 0);
  assert.equal((await listStudioSocial(row.id)).find(post => post.id === en.id)!.status, 'draft');
  const english = (await exportStudioDraft(row.id, 'md'))!;
  assert.doesNotMatch(english.body, /[\u3400-\u9fff]/);
  assert.equal((await studioDraft(row.id))!.version, row.version);
  await assert.rejects(saveStudioSocial(en.id, { version: en.version, title: '中文不能进入英文帖', body: 'English text.', blog_url: en.document.blog_url }, actor), /含中文/);
});

test('post edits clear approval, require current per-issue WARN confirmations, preserve fixed backlink and cannot confirm BLOCK', async () => {
  const { row } = await blog();
  let post = await social(row.id);
  post = (await reviewStudioSocial(post.id, { version: post.version, action: 'approve', confirmations: confirmations(post) }, actor))!;
  post = (await saveStudioSocial(post.id, { version: post.version, title: post.document.title,
    body: 'According to the manufacturer, brightness is 5000 nits.', blog_url: post.document.blog_url }, actor))!;
  assert.equal(post.status, 'draft');
  assert.equal(post.reviewed_at, null);
  assert.deepEqual(post.confirmations, []);
  await assert.rejects(exportStudioSocial(post.id), /独立审核/);
  await assert.rejects(reviewStudioSocial(post.id, { version: post.version, action: 'approve' }, actor), /WARN/);
  await assert.rejects(reviewStudioSocial(post.id, { version: post.version, action: 'approve', confirmAll: true }, actor));
  post = (await reviewStudioSocial(post.id, { version: post.version, action: 'approve', confirmations: confirmations(post) }, actor))!;
  assert.ok((await exportStudioSocial(post.id))!.body.includes(post.document.blog_url), 'backlink survives an edited body without the link');
  await assert.rejects(saveStudioSocial(post.id, { version: post.version - 1, title: post.document.title, body: 'A stale edit.', blog_url: post.document.blog_url }, actor), /刷新/);
  post = (await saveStudioSocial(post.id, { version: post.version, title: post.document.title, body: 'This is the best display.', blog_url: post.document.blog_url }, actor))!;
  assert.ok(post.gate.blocked);
  await assert.rejects(reviewStudioSocial(post.id, { version: post.version, action: 'approve', confirmations: post.issues.items.map(issue => ({ issueId: issue.id, fingerprint: issue.fingerprint })) }, actor), /否决项/);
  await assert.rejects(saveStudioSocial(post.id, { version: post.version, title: post.document.title, body: post.document.body, blog_url: 'https://chipshow.com/' }, actor), /非根路径/);
});

test('source revision drift invalidates approval/export for both approved and draft social posts', async () => {
  const { row, article } = await blog();
  const draft = await social(row.id, 'zh');
  let approved = await social(row.id);
  approved = (await reviewStudioSocial(approved.id, { version: approved.version, action: 'approve', confirmations: confirmations(approved) }, actor))!;
  await sql`UPDATE articles SET revision = revision + 1 WHERE id = ${article}`;
  assert.ok((await listStudioSocial(row.id)).every(post => post.stale));
  await assert.rejects(exportStudioSocial(approved.id), /原文已更新/);
  await assert.rejects(reviewStudioSocial(draft.id, { version: draft.version, action: 'approve', confirmations: confirmations(draft) }, actor), /原文已更新/);
});

test('a Blog version change invalidates its prior social binding even after the Blog is independently reapproved', async () => {
  const { row, draft } = await blog();
  let post = await social(row.id);
  post = (await reviewStudioSocial(post.id, { version: post.version, action: 'approve', confirmations: confirmations(post) }, actor))!;
  await saveStudioDraft(row.id, { ...draft, version: row.version, title_zh: '人工修订后的显示屏安装条件' }, actor);
  let updated = (await studioDraft(row.id))!;
  await reviewStudioDraft(row.id, { version: updated.version, action: 'submit' }, actor);
  updated = (await studioDraft(row.id))!;
  await reviewStudioDraft(row.id, { version: updated.version, action: 'approve', english_reviewed: true, confirmations: updated.issues.items.filter(issue => issue.confirmable)
    .map(issue => ({ issueId: issue.id, fingerprint: issue.fingerprint })) }, actor);
  await assert.rejects(exportStudioSocial(post.id), /父 Blog 版本已变化/);
  await assert.rejects(reviewStudioSocial(post.id, { version: post.version, action: 'approve', confirmations: confirmations(post) }, actor), /父 Blog 版本已变化/);
});
