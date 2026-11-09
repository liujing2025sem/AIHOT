// Runs only in npm test's isolated *_test / *_ci PostgreSQL database with an in-process model stub.
import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import Fastify from 'fastify';
import { sql, closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { passwordLogin, SESSION_COOKIE, sessionPrincipal } from '@aihot/backend/admin/auth';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { studioTask, studioDraft, reviewStudioDraft, exportStudioDraft } from '@aihot/backend/studio/studio';
import { composeStudioBrief, runStudioBriefJob, studioBriefStatus } from '@aihot/backend/studio/studio-brief';
import { registerAdminStudio } from '../apps/api/src/routes/admin-studio.ts';

const actor = 'test:brief-closeout';
after(async () => { await stopBoss(); await closeDb(); });
async function sources() {
  const suffix = tag(), source = `brief-${suffix}`, ids: string[] = [];
  await sql`INSERT INTO sources(id,name,kind,enabled,config) VALUES(${source},'LED manufacturer','web_list',false,${sql.json({ publishedAtUtcOffset: '+00:00' })})`;
  const date = new Date(Date.now() - 86400000).toISOString(), day = date.slice(0, 10);
  for (let i = 1; i <= 5; i++) {
    const id = `brief-${i}-${suffix}`; ids.push(id);
    const title = `Maker ${i} launches a new LED driver IC`, body = `Maker ${i} describes a driver IC for display modules. The announcement distinguishes sample availability from volume production and gives application conditions. Further specifications remain subject to the manufacturer's published configuration.`;
    await sql`INSERT INTO articles(id,source_id,identity_key,url,title,published_at,publication_time,discovered_at,timeline_at,body_status,body_text)
      VALUES(${id},${source},${id},${`https://maker.example.test/${id}`},${title},${day + 'T00:00:00Z'},${day},${date},${date},'ok',${body})`;
  }
  return ids;
}

test('authenticated compose API produces one review-only draft, double clicks reuse it, changed secondary source blocks approval', async t => {
  const previous = { model: config.modelCallsEnabled, password: config.adminPassword, dev: config.devAdmin };
  config.modelCallsEnabled = true; config.adminPassword = 'brief-test-password-only-long'; config.devAdmin = null;
  const keys = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'] as const;
  const env = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { LLM_BASE_URL: 'https://brief-model.example.test/v1', LLM_API_KEY: 'test-only', LLM_MODEL: 'brief-test-model' });
  const app = Fastify({ logger: false }); registerAdminStudio(app);
  t.after(async () => { await app.close(); config.modelCallsEnabled = previous.model; config.adminPassword = previous.password; config.devAdmin = previous.dev; for (const key of keys) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; } });
  let modelCalls = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(new URL(input instanceof Request ? input.url : input).hostname, 'brief-model.example.test', 'no CMS or external request is permitted');
    modelCalls++;
    const request = JSON.parse(init!.body as string), inputPacket = JSON.parse(request.messages.find((m: { role: string }) => m.role === 'user').content);
    const inputs = inputPacket.sources as { binding: { article_id: string }; title: string; body_text: string }[];
    const result = { decision: 'draft', title_en: 'LED component announcements', title_zh: '器件动态合集',
      in_5_seconds: [1, 2, 3].map(i => ({ event_key: `event-${i}`, text_en: `Maker ${i} introduces an IC.` })),
      items: inputs.map((source, i) => ({ event_key: `event-${i + 1}`, article_ids: [source.binding.article_id], primary_article_id: source.binding.article_id, section: 'components-ics',
        title_en: `Maker ${i + 1} outlines an IC release`, title_zh: '驱动器件更新', body_en: `According to the manufacturer, this LED driver announcement describes its intended application. Buyers should confirm the stated availability before specifying it.`,
        review_zh: '厂商说明驱动器件用途，采购前需核对供货阶段。', news_status: 'reported', hook_anchor_quote: source.title,
        evidence: [{ article_id: source.binding.article_id, claim: 'The manufacturer states application and production scope.', quote: source.body_text.split('. ')[0] }],
      })), questions_zh: [], keyword_hypothesis: 'LED driver IC', meta_description_en: 'Five manufacturer announcements, with their dates and original sources.' };
    return Response.json({ choices: [{ message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 50, completion_tokens: 100 } });
  });
  const ids = await sources();
  assert.equal((await app.inject({ method: 'POST', url: '/api/admin/studio/briefs', payload: { article_ids: ids } })).statusCode, 401);
  const login = await passwordLogin(config.adminPassword!, '/admin', 'test');
  const cookie = `${SESSION_COOKIE}=${login.token}`, principal = (await sessionPrincipal(cookie))!;
  assert.equal((await app.inject({ method: 'POST', url: '/api/admin/studio/briefs', headers: { cookie }, payload: { article_ids: ids } })).statusCode, 403);
  const post = () => app.inject({ method: 'POST', url: '/api/admin/studio/briefs', headers: { cookie, 'x-csrf-token': principal.csrf }, payload: { article_ids: ids } });
  const [first, second] = await Promise.all([post(), post()]);
  assert.equal(first.statusCode, 202, first.body); assert.equal(second.statusCode, 202, second.body);
  const taskId = first.json().task_id;
  assert.equal(second.json().task_id, taskId); assert.equal(modelCalls, 0, 'enqueueing never calls a model in the API process');
  await runStudioBriefJob({ taskId, actor });
  await runStudioBriefJob({ taskId, actor });
  assert.equal(modelCalls, 1, 'a completed worker invocation cannot buy another answer');
  const state = await studioBriefStatus(taskId);
  assert.equal(state?.state, 'in_review', JSON.stringify(state)); assert.equal(state!.drafts.length, 1);
  const draft = (await studioDraft(state!.drafts[0].id))!;
  assert.equal(draft.status, 'in_review'); assert.equal(draft.document.brief?.items.length, 5);
  assert.equal((draft.document.body_en.match(/class="cs-brief"/g) ?? []).length, 1);
  await assert.rejects(exportStudioDraft(draft.id, 'html'), /审稿|批准/);
  const receipts = await sql`SELECT id FROM audit_log WHERE action IN ('studio.draft.wordpress','studio.publishing.receipt')`;
  assert.equal(receipts.length, 0, 'human-review composition cannot call either publication path');
  await sql`UPDATE articles SET revision=revision+1 WHERE id=${ids[4]}`;
  await assert.rejects(reviewStudioDraft(draft.id, { version: draft.version, action: 'approve', english_reviewed: true,
    confirmations: draft.issues.items.filter(item => item.confirmable).map(item => ({ issueId: item.id, fingerprint: item.fingerprint })) }, actor), /原文已更新/);
});

test('dedupe leaving fewer than five events becomes HOLD; uncertain model attempt is not retried', async t => {
  const previous = config.modelCallsEnabled; config.modelCallsEnabled = true;
  const keys = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'] as const, env = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { LLM_BASE_URL: 'https://brief-hold.example.test/v1', LLM_API_KEY: 'test-only', LLM_MODEL: 'brief-test-model' });
  t.after(() => { config.modelCallsEnabled = previous; for (const key of keys) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; } });
  let calls = 0, unknown = false;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    assert.equal(new URL(input instanceof Request ? input.url : input).hostname, 'brief-hold.example.test'); calls++;
    if (unknown) throw Error('synthetic provider disconnect');
    return Response.json({ choices: [{ message: { content: JSON.stringify({ decision: 'hold', reason_zh: '两条材料是同一事件转载，去重后只剩四条，请补充动态。' }) } }], usage: { prompt_tokens: 40, completion_tokens: 20 } });
  });
  const held = await composeStudioBrief({ article_ids: await sources() }, actor);
  await runStudioBriefJob({ taskId: held.task_id, actor });
  assert.equal((await studioBriefStatus(held.task_id))?.state, 'held');
  assert.equal((await studioBriefStatus(held.task_id))?.drafts.length, 0);
  assert.ok((await studioTask(held.task_id))!.response.decisions.every((d: { decision: string }) => d.decision === 'HOLD'));
  unknown = true;
  const uncertain = await composeStudioBrief({ article_ids: await sources() }, actor);
  await runStudioBriefJob({ taskId: uncertain.task_id, actor });
  const called = calls;
  await runStudioBriefJob({ taskId: uncertain.task_id, actor });
  assert.equal(calls, called, 'a result-unknown attempt cannot auto-retry');
  assert.equal((await studioBriefStatus(uncertain.task_id))?.drafts.length, 0);
});
