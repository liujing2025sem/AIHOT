import { tag } from './setup.ts';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, closeDb } from '@aihot/backend/db';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { createStudioTask, exportStudioTask, studioDraft, reviewStudioDraft, saveStudioDraft, exportStudioDraft } from '@aihot/backend/studio/studio';
import { pushStudioWordPressDraft, studioWordPressDetail, studioWordPressReceipt } from '@aihot/backend/studio/studio-wordpress';

const actor = 'test:wordpress-versions', suffix = tag();
after(async () => { await stopBoss(); await closeDb(); });

test('draft delivery verifies the exact approved version, recovers by slug or ID without writing, and updates the same draft', async t => {
  Object.assign(process.env, { WP_BASE_URL: 'https://wp-versions.example.test/', WP_USER: 'fixture', WP_APP_PASSWORD: 'test-only',
    WP_GUIDE_CATEGORY_SLUG: 'choose-guides', WP_FEATURED_MEDIA_COMPONENTS_CONTROL: '91', WP_DRAFT_PUSH_ENABLED: 'true' });
  t.after(() => { for (const key of ['WP_BASE_URL', 'WP_USER', 'WP_APP_PASSWORD', 'WP_GUIDE_CATEGORY_SLUG', 'WP_FEATURED_MEDIA_COMPONENTS_CONTROL']) delete process.env[key]; process.env.WP_DRAFT_PUSH_ENABLED = 'false'; });
  const source = 'wp-versions-' + suffix, article = source + '-article';
  const text = 'The supplier describes inspection conditions for an indoor LED display.';
  await sql`INSERT INTO sources(id,name,kind,enabled) VALUES (${source},'Supplier','web_list',false)`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at,body_status,body_text)
    VALUES (${article},${source},${article},${'https://source.example.test/' + article},'Inspection conditions',now(),now(),'ok',${text})`;
  async function fixture() {
    const task = await createStudioTask({ article_ids: [article] }, actor), packet = (await exportStudioTask(task.id))!.request;
    const id = randomUUID(), document = { source: packet.articles[0].binding, title_zh: '检查条件', title_en: 'LED display inspection conditions',
      review_zh: '供应商描述室内显示屏检查条件。', body_en: text + '\n\nSource: ' + packet.articles[0].binding.url,
      evidence: [{ claim: 'Inspection conditions', quote: text }], questions_zh: [], keyword_hypothesis: 'display inspection', meta_description_en: 'Supplier inspection conditions.' };
    await sql`INSERT INTO studio_drafts(id,task_id,article_id,document,updated_by) VALUES (${id},${task.id},${article},${sql.json(document)},${actor})`;
    return { id, document, version: await approve(id) };
  }
  async function approve(id: string) {
    let current = (await studioDraft(id))!;
    await reviewStudioDraft(id, { version: current.version, action: 'submit' }, actor);
    current = (await studioDraft(id))!;
    return (await reviewStudioDraft(id, { version: current.version, action: 'approve', english_reviewed: true,
      confirmations: current.issues.items.filter(item => item.confirmable).map(item => ({ issueId: item.id, fingerprint: item.fingerprint })) }, actor))!.version;
  }
  type Post = { id: number; slug: string; status: string; title: { raw: string }; content: { raw: string }; categories: number[]; tags: number[]; featured_media: number };
  const posts = new Map<number, Post>(), writes: number[] = [];
  let nextId = 2000, loseAcknowledgement = false, corrupt: 'title' | 'content' | 'categories' | 'tags' | 'featured_media' | null = null;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.hostname, 'wp-versions.example.test', 'only the synthetic WordPress endpoint may be used');
    if (url.pathname.endsWith('/categories')) return Response.json([{ id: 29, slug: 'choose-guides' }]);
    const match = /\/posts\/(\d+)$/.exec(url.pathname), id = match ? Number(match[1]) : null;
    if (!init?.body) {
      assert.equal(new Headers(init?.headers).get('X-HTTP-Method-Override'), 'GET');
      if (id === null) return Response.json([...posts.values()].filter(post => post.slug === url.searchParams.get('slug')));
      const post = posts.get(id);
      if (!post) return Response.json({}, { status: 404 });
      const changed = structuredClone(post);
      if (corrupt === 'title') changed.title.raw += ' changed';
      if (corrupt === 'content') changed.content.raw += '<p>Unreviewed sentence</p>';
      if (corrupt === 'categories') changed.categories = [99];
      if (corrupt === 'tags') changed.tags = [99];
      if (corrupt === 'featured_media') changed.featured_media = 99;
      return Response.json(changed);
    }
    const payload = JSON.parse(init.body as string), actualId = id ?? nextId++, previous = posts.get(actualId);
    writes.push(actualId);
    const post: Post = { id: actualId, slug: payload.slug ?? previous?.slug ?? '', status: payload.status,
      title: { raw: payload.title }, content: { raw: payload.content }, categories: payload.categories, tags: payload.tags, featured_media: payload.featured_media ?? 0 };
    posts.set(actualId, post);
    if (loseAcknowledgement) throw Error('simulated lost acknowledgement');
    return Response.json(post);
  });
  const push = (id: string, version: number, recoverOnly = false) => pushStudioWordPressDraft(id, { version, kind: 'guide', section: 'components-ics', recoverOnly }, actor);

  const first = await fixture();
  let detail = await studioWordPressDetail(first.id);
  assert.equal(detail.currentVersion, first.version); assert.equal(detail.approvedVersion, first.version); assert.equal(detail.syncedVersion, null);
  loseAcknowledgement = true;
  assert.equal((await push(first.id, first.version))?.state, 'unknown');
  const count = writes.length, originalId = writes.at(-1)!;
  await saveStudioDraft(first.id, { ...first.document, version: first.version, title_en: 'Updated LED display inspection conditions' }, actor);
  const edited = (await studioDraft(first.id))!;
  process.env.WP_DRAFT_PUSH_ENABLED = 'false';
  detail = await studioWordPressDetail(first.id);
  assert.equal(detail.ready, false); assert.equal(detail.recoveryReady, true);
  loseAcknowledgement = false;
  const recovered = await push(first.id, edited.version, true);
  assert.equal(recovered?.state, 'pushed'); assert.equal(recovered?.version, first.version); assert.equal(recovered?.postId, originalId);
  assert.equal(writes.length, count, 'slug recovery must not create or update a post');
  detail = await studioWordPressDetail(first.id);
  assert.equal(detail.currentVersion, edited.version); assert.equal(detail.approvedVersion, first.version);
  assert.equal(detail.syncedVersion, first.version); assert.equal(detail.currentSynced, false);
  process.env.WP_DRAFT_PUSH_ENABLED = 'true';
  await assert.rejects(push(first.id, edited.version), /审稿/);
  const approvedVersion = await approve(first.id);
  const updated = await push(first.id, approvedVersion);
  assert.equal(updated?.state, 'pushed');
  assert.equal(updated && 'postId' in updated ? updated.postId : null, originalId);
  assert.equal(writes.at(-1), originalId); assert.equal(posts.size, 1);
  assert.equal((await studioWordPressDetail(first.id)).currentSynced, true);
  // Losing the final local receipt must leave the independently committed outgoing identity recoverable.
  await sql`DELETE FROM audit_log WHERE id=(SELECT id FROM audit_log WHERE subject=${`studio-draft:${first.id}`}
    AND action='studio.draft.wordpress' ORDER BY id DESC LIMIT 1)`;
  assert.equal((await studioWordPressReceipt(first.id))?.state, 'unknown');
  const beforeLocalRecovery = writes.length;
  assert.equal((await push(first.id, approvedVersion, true))?.state, 'pushed');
  assert.equal(writes.length, beforeLocalRecovery);

  // Legacy receipts can only borrow content from their exact still-approved draft version.
  await sql`UPDATE audit_log SET after=after-'expected' WHERE subject=${`studio-draft:${first.id}`} AND action='studio.draft.wordpress'`;
  const legacy = await studioWordPressDetail(first.id);
  assert.equal(legacy.syncedVersion, null); assert.equal(legacy.currentSynced, false); assert.equal(legacy.recoveryReady, true);
  assert.equal((await push(first.id, approvedVersion, true))?.state, 'pushed');
  assert.equal(writes.length, beforeLocalRecovery);

  // A known post ID is retained even when the independent readback fails.
  corrupt = 'content';
  assert.equal((await push(first.id, approvedVersion))?.state, 'mismatch');
  const knownCount = writes.length;
  const mismatch = await push(first.id, approvedVersion, true);
  assert.equal(mismatch?.state, 'mismatch');
  assert.equal(mismatch && 'reason' in mismatch ? mismatch.reason : null, 'content_mismatch');
  assert.equal(writes.length, knownCount, 'mismatch recovery only reads back');
  corrupt = null;
  const resent = await push(first.id, approvedVersion);
  assert.equal(resent?.state, 'pushed');
  assert.equal(resent && 'postId' in resent ? resent.postId : null, originalId);
  assert.equal(writes.length, knownCount + 1, 'a separate explicit send repairs the same confirmed draft');
  assert.equal(posts.size, 1);

  for (const field of ['title', 'content', 'categories', 'tags', 'featured_media'] as const) {
    corrupt = field;
    assert.equal((await push(first.id, approvedVersion))?.state, 'mismatch', field + ' mismatch cannot report success');
    const before = writes.length;
    assert.equal((await push(first.id, approvedVersion, true))?.state, 'mismatch');
    assert.equal(writes.length, before);
    corrupt = null;
    assert.equal((await push(first.id, approvedVersion, true))?.state, 'pushed');
  }
  posts.get(originalId)!.status = 'publish';
  const beforePublished = writes.length;
  assert.equal((await push(first.id, approvedVersion))?.state, 'blocked');
  assert.equal(writes.length, beforePublished, 'a published post must never be changed to draft');

  // Approval of equal text at an older version does not approve a later review operation.
  const strict = await fixture();
  await sql`UPDATE studio_drafts SET version=version+1 WHERE id=${strict.id}`;
  await assert.rejects(push(strict.id, strict.version + 1), /当前版本尚无有效批准/);
  await assert.rejects(exportStudioDraft(strict.id, 'html'), /当前版本尚无有效批准/);
  assert.equal((await studioWordPressDetail(strict.id)).approvedVersion, strict.version);
});
