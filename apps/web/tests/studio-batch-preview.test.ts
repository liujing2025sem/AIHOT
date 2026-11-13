import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import {
  activeArticleIds, batchReducer, coverFormKey, createBatchSession, phaseComplete, restoreBatchSession,
  restoreCoverFormDrafts, setCoverFormDraft, validateUploadedCover,
  type BatchAction, type BatchSession, type BatchTarget, type CoverFormDrafts, type UploadedCover,
} from '../app/features/admin/batch-session.ts';
import { defaultBatchIds, demoCatalog } from '../app/features/admin/batch-preview-fixtures.ts';

type ArticleCommand<T> = T extends { target: BatchTarget } ? Omit<T, 'target'> : never;
const newSession = () => createBatchSession(['a', 'b', 'c'], 'hot');

function target(state: BatchSession): BatchTarget {
  if (!state.currentId || state.phase === 'finished') throw new Error('An active article is required.');
  return { articleId: state.currentId, phase: state.phase, revision: state.articles[state.currentId].revision };
}

function articleAction(state: BatchSession, action: ArticleCommand<BatchAction>): BatchSession {
  return batchReducer(state, { ...action, target: target(state) });
}

function reviewSession(): BatchSession {
  let state = newSession();
  for (const id of ['a', 'b', 'c']) {
    state = batchReducer(state, { type: 'open_article', id });
    state = articleAction(state, { type: 'select_direction', id: 'answer' });
    state = articleAction(state, { type: 'confirm_direction' });
  }
  return batchReducer(state, { type: 'next_phase', phase: 'direction' });
}

function artifactsSession(): BatchSession {
  let state = reviewSession();
  for (const id of ['a', 'b', 'c']) {
    state = batchReducer(state, { type: 'open_article', id });
    state = articleAction(state, { type: 'select_review', choice: 'patch' });
    state = articleAction(state, { type: 'confirm_review' });
  }
  return batchReducer(state, { type: 'next_phase', phase: 'review' });
}

function preflightSession(): BatchSession {
  let state = artifactsSession();
  for (const id of ['a', 'b', 'c']) {
    state = batchReducer(state, { type: 'open_article', id });
    state = articleAction(state, { type: 'adopt_cover', candidate: 0 });
    state = articleAction(state, { type: 'confirm_artifacts', cover: 0 });
  }
  return batchReducer(state, { type: 'next_phase', phase: 'artifacts' });
}

function uploadedCover(id = 'local-cover'): UploadedCover {
  const width = 640, height = 360;
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1;
    }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(height * (width * 4 + 1)))), chunk('IEND', Buffer.alloc(0)),
  ]);
  return { id, name: `${id}.png`, mimeType: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, width, height, bytes: bytes.length };
}

test('batch keeps all directions before review and opens the first pending article of each stage', () => {
  let state = newSession();
  assert.equal(state.currentId, 'a');
  state = articleAction(state, { type: 'select_direction', id: 'answer' });
  state = articleAction(state, { type: 'confirm_direction' });
  assert.equal(state.currentId, 'b');
  assert.equal(state.phase, 'direction');
  assert.equal(state.articles.b.directionConfirmed, false);
  assert.equal(phaseComplete(state), false);
  state = batchReducer(state, { type: 'next_phase', phase: 'direction' });
  assert.equal(state.phase, 'direction');
  for (const id of ['b', 'c']) {
    assert.equal(state.currentId, id);
    state = articleAction(state, { type: 'select_direction', id: 'answer' });
    state = articleAction(state, { type: 'confirm_direction' });
  }
  assert.equal(state.currentId, null);
  assert.equal(state.phase, 'direction');
  assert.equal(phaseComplete(state), true);
  state = batchReducer(state, { type: 'next_phase', phase: 'direction' });
  assert.equal(state.phase, 'review');
  assert.equal(state.currentId, 'a');
  assert.ok(Object.values(state.articles).every(article => article.reviewedRevision === null));
  const firstReview = state;
  state = batchReducer(state, { type: 'next_phase', phase: 'direction' });
  assert.deepEqual(state, firstReview);
  assert.equal(artifactsSession().currentId, 'a');
});

test('old-screen confirmations cannot approve the next article or a changed direction', () => {
  let state = newSession();
  state = batchReducer(state, { type: 'open_article', id: 'b' });
  state = articleAction(state, { type: 'select_direction', id: 'scenario' });
  state = batchReducer(state, { type: 'open_article', id: 'a' });
  state = articleAction(state, { type: 'select_direction', id: 'answer' });
  const confirm: BatchAction = { type: 'confirm_direction', target: target(state) };
  state = batchReducer(state, confirm);
  assert.equal(state.currentId, 'b');
  const afterFirstClick = state;
  state = batchReducer(state, confirm);
  assert.deepEqual(state, afterFirstClick);
  assert.equal(state.articles.b.directionConfirmed, false);
  const stale: BatchAction = { type: 'confirm_direction', target: target(state) };
  state = articleAction(state, { type: 'select_direction', id: 'compare' });
  state = batchReducer(state, stale);
  assert.equal(state.articles.b.directionConfirmed, false);
});

test('hot interruption preserves unfinished choices, exact position and the original batch', () => {
  let state = newSession();
  state = batchReducer(state, { type: 'open_article', id: 'b' });
  state = articleAction(state, { type: 'select_direction', id: 'compare' });
  state = articleAction(state, { type: 'toggle_tweak', tweak: 'checklist' });
  state = articleAction(state, { type: 'set_note', note: '保留安装条件的比较。' });
  const originalArticles = structuredClone(state.articles);
  state = batchReducer(state, { type: 'interrupt' });
  assert.equal(state.currentId, 'hot');
  assert.deepEqual(state.interrupted, { phase: 'direction', currentId: 'b' });
  assert.deepEqual(activeArticleIds(state), ['hot']);
  const once = state;
  state = batchReducer(state, { type: 'interrupt' });
  assert.deepEqual(state, once);
  state = articleAction(state, { type: 'select_direction', id: 'scenario' });
  state = batchReducer(state, { type: 'return_to_batch' });
  assert.equal(state.currentId, 'b');
  assert.equal(state.phase, 'direction');
  assert.equal(state.interrupted, null);
  for (const id of ['a', 'b', 'c']) assert.deepEqual(state.articles[id], originalArticles[id]);
  assert.equal(state.articles.hot.direction, 'scenario');
});

test('finishing the hot-topic simulation returns to the interrupted review without approving it', () => {
  let state = reviewSession();
  state = batchReducer(state, { type: 'open_article', id: 'b' });
  state = articleAction(state, { type: 'select_review', choice: 'narrow' });
  const original = structuredClone(state.articles.b);
  state = batchReducer(state, { type: 'interrupt' });
  state = articleAction(state, { type: 'select_direction', id: 'answer' });
  state = articleAction(state, { type: 'confirm_direction' });
  state = batchReducer(state, { type: 'next_phase', phase: 'direction' });
  state = articleAction(state, { type: 'select_review', choice: 'patch' });
  state = articleAction(state, { type: 'confirm_review' });
  state = batchReducer(state, { type: 'next_phase', phase: 'review' });
  state = articleAction(state, { type: 'adopt_cover', candidate: 0 });
  state = articleAction(state, { type: 'confirm_artifacts', cover: 0 });
  state = batchReducer(state, { type: 'next_phase', phase: 'artifacts' });
  state = articleAction(state, { type: 'confirm_delivery' });
  assert.equal(state.phase, 'review');
  assert.equal(state.currentId, 'b');
  assert.equal(state.interrupted, null);
  assert.deepEqual(state.articles.b, original);
  assert.equal(state.articles.hot.delivered, true);
  assert.match(state.message, /演示/);
  assert.match(state.message, /没有发出真实请求/);
});

test('skipping the current item moves to the next remaining item, and skipping all is recoverable', () => {
  let state = newSession();
  state = articleAction(state, { type: 'select_direction', id: 'compare' });
  state = articleAction(state, { type: 'set_note', note: '留下这条思路。' });
  const saved = structuredClone(state.articles.a);
  state = batchReducer(state, { type: 'defer_articles', ids: ['a'], reason: 'skip' });
  assert.equal(state.currentId, 'b');
  state = batchReducer(state, { type: 'defer_articles', ids: ['b', 'c'], reason: 'skip' });
  assert.deepEqual(activeArticleIds(state), []);
  assert.equal(state.currentId, null);
  assert.equal(state.phase, 'direction');
  assert.equal(phaseComplete(state), false);
  state = batchReducer(state, { type: 'next_phase', phase: 'direction' });
  assert.equal(state.phase, 'direction');
  state = batchReducer(state, { type: 'restore_article', id: 'a' });
  assert.equal(state.currentId, 'a');
  assert.deepEqual(activeArticleIds(state), ['a']);
  assert.deepEqual(state.articles.a, saved);
});

test('restoring an unfinished item revisits its required phase without losing other approvals', () => {
  let state = newSession();
  state = batchReducer(state, { type: 'defer_articles', ids: ['c'], reason: 'verify' });
  for (const id of ['a', 'b']) {
    state = batchReducer(state, { type: 'open_article', id });
    state = articleAction(state, { type: 'select_direction', id: 'answer' });
    state = articleAction(state, { type: 'confirm_direction' });
  }
  state = batchReducer(state, { type: 'next_phase', phase: 'direction' });
  state = articleAction(state, { type: 'select_review', choice: 'patch' });
  state = articleAction(state, { type: 'confirm_review' });
  const acceptedA = structuredClone(state.articles.a);
  state = batchReducer(state, { type: 'restore_article', id: 'c' });
  assert.equal(state.phase, 'direction');
  assert.equal(state.currentId, 'c');
  assert.equal(state.articles.c.directionConfirmed, false);
  assert.deepEqual(state.articles.a, acceptedA);
});

test('scope reduction needs its own explicit review confirmation and invalidates a prior choice', () => {
  let state = reviewSession();
  const noChoice = articleAction(state, { type: 'confirm_review' });
  assert.deepEqual(noChoice, state);
  state = articleAction(state, { type: 'select_review', choice: 'patch' });
  const oldConfirm: BatchAction = { type: 'confirm_review', target: target(state) };
  state = articleAction(state, { type: 'select_review', choice: 'narrow' });
  assert.equal(state.articles.a.reviewedRevision, null);
  state = batchReducer(state, oldConfirm);
  assert.equal(state.articles.a.reviewedRevision, null, 'a confirmation from the old scope must not approve the new scope');
  state = articleAction(state, { type: 'confirm_review' });
  assert.equal(state.articles.a.reviewChoice, 'narrow');
  assert.equal(state.articles.a.reviewedRevision, state.articles.a.revision);
  assert.equal(state.currentId, 'b');
});

test('new cover candidates preserve the adopted cover and other articles until explicit adoption', () => {
  let state = artifactsSession();
  state = articleAction(state, { type: 'adopt_cover', candidate: 0 });
  const acceptedReview = state.articles.a.reviewedRevision;
  const otherArticles = { b: structuredClone(state.articles.b), c: structuredClone(state.articles.c) };
  state = articleAction(state, { type: 'new_cover_candidate' });
  state = articleAction(state, { type: 'new_cover_candidate' });
  assert.equal(state.articles.a.coverCandidate, 2);
  assert.equal(state.articles.a.adoptedCover, 0);
  assert.equal(state.articles.a.reviewedRevision, acceptedReview);
  state = articleAction(state, { type: 'adopt_cover', candidate: 1 });
  assert.equal(state.articles.a.adoptedCover, 0, 'a stale candidate cannot be adopted by a mismatched button');
  state = articleAction(state, { type: 'adopt_cover', candidate: 2 });
  assert.equal(state.articles.a.adoptedCover, 2);
  assert.equal(state.articles.a.artifactsConfirmed, false);
  assert.deepEqual({ b: state.articles.b, c: state.articles.c }, otherArticles);
});

test('changing a confirmed direction invalidates only that article and stale confirmations are ignored', () => {
  let state = newSession();
  state = articleAction(state, { type: 'select_direction', id: 'answer' });
  state = articleAction(state, { type: 'confirm_direction' });
  state = articleAction(state, { type: 'select_direction', id: 'scenario' });
  const other = structuredClone(state.articles.b);
  state = batchReducer(state, { type: 'open_article', id: 'a' });
  const oldConfirm: BatchAction = { type: 'confirm_direction', target: target(state) };
  state = articleAction(state, { type: 'toggle_tweak', tweak: 'technical' });
  assert.equal(state.articles.a.directionConfirmed, false);
  assert.equal(state.articles.a.reviewedRevision, null);
  assert.equal(state.articles.a.artifactsConfirmed, false);
  assert.equal(state.articles.a.delivered, false);
  state = batchReducer(state, oldConfirm);
  assert.equal(state.articles.a.directionConfirmed, false);
  assert.deepEqual(state.articles.b, other);
});

test('review tweaks retain the chosen direction and fix but invalidate previous review and delivery', () => {
  let state = newSession();
  state = batchReducer(state, { type: 'defer_articles', ids: ['c'], reason: 'verify' });
  for (const id of ['a', 'b']) {
    state = batchReducer(state, { type: 'open_article', id });
    state = articleAction(state, { type: 'select_direction', id: 'answer' });
    state = articleAction(state, { type: 'confirm_direction' });
  }
  state = batchReducer(state, { type: 'next_phase', phase: 'direction' });
  for (const id of ['a', 'b']) {
    state = batchReducer(state, { type: 'open_article', id });
    state = articleAction(state, { type: 'select_review', choice: 'patch' });
    state = articleAction(state, { type: 'confirm_review' });
  }
  state = batchReducer(state, { type: 'next_phase', phase: 'review' });
  for (const id of ['a', 'b']) {
    state = batchReducer(state, { type: 'open_article', id });
    state = articleAction(state, { type: 'adopt_cover', candidate: 0 });
    state = articleAction(state, { type: 'confirm_artifacts', cover: 0 });
  }
  state = batchReducer(state, { type: 'next_phase', phase: 'artifacts' });
  for (const id of ['a', 'b']) {
    state = batchReducer(state, { type: 'open_article', id });
    state = articleAction(state, { type: 'confirm_delivery' });
  }
  state = batchReducer(state, { type: 'restore_article', id: 'c' });
  state = articleAction(state, { type: 'select_direction', id: 'answer' });
  state = articleAction(state, { type: 'confirm_direction' });
  state = batchReducer(state, { type: 'next_phase', phase: 'direction' });
  state = batchReducer(state, { type: 'open_article', id: 'a' });
  assert.equal(state.articles.a.artifactsConfirmed, true);
  assert.equal(state.articles.a.delivered, true);
  const previousRevision = state.articles.a.revision;
  const stale: BatchAction = { type: 'confirm_review', target: target(state) };
  const otherArticle = structuredClone(state.articles.b);
  state = articleAction(state, { type: 'toggle_tweak', tweak: 'shorter' });
  assert.deepEqual(state.articles.a.tweaks, ['shorter']);
  assert.equal(state.articles.a.revision, previousRevision + 1);
  assert.equal(state.articles.a.directionConfirmed, true);
  assert.equal(state.articles.a.reviewChoice, 'patch');
  assert.equal(state.articles.a.reviewedRevision, null);
  assert.equal(state.articles.a.artifactsConfirmed, false);
  assert.equal(state.articles.a.delivered, false);
  assert.equal(state.articles.a.adoptedCover, 0);
  assert.deepEqual(state.articles.b, otherArticle);
  state = batchReducer(state, stale);
  assert.equal(state.articles.a.reviewedRevision, null);
});

test('optional review notes preserve the scope choice and require a fresh confirmation only when changed', () => {
  let state = reviewSession();
  state = articleAction(state, { type: 'select_review', choice: 'narrow' });
  state = articleAction(state, { type: 'confirm_review' });
  state = batchReducer(state, { type: 'open_article', id: 'a' });
  const previousRevision = state.articles.a.revision;
  const stale: BatchAction = { type: 'confirm_review', target: target(state) };
  state = articleAction(state, { type: 'set_note', note: '请保留供应商需要确认的条件。' });
  assert.equal(state.articles.a.note, '请保留供应商需要确认的条件。');
  assert.equal(state.articles.a.revision, previousRevision + 1);
  assert.equal(state.articles.a.directionConfirmed, true);
  assert.equal(state.articles.a.reviewChoice, 'narrow');
  assert.equal(state.articles.a.reviewedRevision, null);
  const unchanged = articleAction(state, { type: 'set_note', note: '请保留供应商需要确认的条件。' });
  assert.deepEqual(unchanged, state);
  state = batchReducer(state, stale);
  assert.equal(state.articles.a.reviewedRevision, null);
  state = articleAction(state, { type: 'confirm_review' });
  assert.equal(state.articles.a.reviewedRevision, state.articles.a.revision);
});

test('time accounting and dismissing the budget reminder never change article approvals', () => {
  let state = reviewSession();
  const articles = structuredClone(state.articles);
  state = batchReducer(state, { type: 'tick', seconds: 5 });
  assert.equal(state.elapsedSeconds, 5);
  state = batchReducer(state, { type: 'dismiss_budget' });
  assert.equal(state.elapsedSeconds, 5);
  assert.equal(state.paused, false);
  state = batchReducer(state, { type: 'pause' });
  state = batchReducer(state, { type: 'tick', seconds: 5 });
  assert.equal(state.elapsedSeconds, 5);
  state = batchReducer(state, { type: 'resume' });
  state = batchReducer(state, { type: 'tick', seconds: 2 });
  assert.equal(state.elapsedSeconds, 7);
  assert.deepEqual(state.articles, articles);
  assert.equal(state.phase, 'review');
  assert.equal(state.currentId, 'a');
});

test('persisted sessions restore choices and the interrupted position in a paused state', () => {
  let state = reviewSession();
  state = batchReducer(state, { type: 'open_article', id: 'b' });
  state = articleAction(state, { type: 'select_review', choice: 'narrow' });
  state = batchReducer(state, { type: 'tick', seconds: 5 });
  state = batchReducer(state, { type: 'interrupt' });
  state = articleAction(state, { type: 'select_direction', id: 'scenario' });
  const restored = restoreBatchSession(JSON.stringify(state), newSession());
  assert.equal(restored.paused, true);
  assert.equal(restored.currentId, 'hot');
  assert.equal(restored.elapsedSeconds, 5);
  assert.deepEqual(restored.articles, state.articles);
  assert.deepEqual(restored.interrupted, { phase: 'review', currentId: 'b' });
  const returned = batchReducer(batchReducer(restored, { type: 'resume' }), { type: 'return_to_batch' });
  assert.equal(returned.currentId, 'b');
  assert.equal(returned.phase, 'review');
  assert.equal(returned.articles.b.reviewChoice, 'narrow');
  assert.equal(returned.articles.b.reviewedRevision, null);
});

test('broken, unknown and forged-finished records cannot manufacture progress', () => {
  const initial = newSession();
  const missingReviewChoice = structuredClone(initial);
  missingReviewChoice.phase = 'finished';
  missingReviewChoice.currentId = null;
  for (const id of ['a', 'b', 'c']) {
    Object.assign(missingReviewChoice.articles[id], {
      direction: 'answer', directionConfirmed: true, reviewedRevision: 1,
      reviewChoice: null, adoptedCover: 0, artifactsConfirmed: true, delivered: true,
    });
  }
  for (const raw of [
    '{bad json',
    JSON.stringify({ ...initial, schema: 9 }),
    JSON.stringify({ ...initial, currentId: 'unknown' }),
    JSON.stringify({ ...initial, currentId: 'hot' }),
    JSON.stringify({ ...initial, phase: 'finished', currentId: null }),
    JSON.stringify({ ...initial, phase: 'review' }),
    JSON.stringify(missingReviewChoice),
  ]) {
    const restored = restoreBatchSession(raw, initial);
    assert.equal(restored.phase, 'direction');
    assert.equal(restored.currentId, 'a');
    assert.deepEqual(restored.articles, initial.articles);
    assert.match(restored.message, /无法恢复/);
  }
});

test('each simulated delivery needs its own confirmation before the batch can finish', () => {
  let state = artifactsSession();
  for (const id of ['a', 'b', 'c']) {
    state = batchReducer(state, { type: 'open_article', id });
    state = articleAction(state, { type: 'adopt_cover', candidate: 0 });
    state = articleAction(state, { type: 'confirm_artifacts', cover: 0 });
  }
  state = batchReducer(state, { type: 'next_phase', phase: 'artifacts' });
  assert.equal(state.phase, 'preflight');
  assert.equal(state.currentId, 'a');
  const firstDelivery: BatchAction = { type: 'confirm_delivery', target: target(state) };
  state = batchReducer(state, firstDelivery);
  assert.equal(state.currentId, 'b');
  assert.equal(state.articles.a.delivered, true);
  assert.equal(state.articles.b.delivered, false);
  state = batchReducer(state, firstDelivery);
  assert.equal(state.articles.b.delivered, false);
  assert.equal(state.phase, 'preflight');
  for (const id of ['b', 'c']) {
    assert.equal(state.currentId, id);
    state = articleAction(state, { type: 'confirm_delivery' });
    assert.match(state.message, /演示/);
    assert.match(state.message, /没有创建真实 WordPress 草稿/);
  }
  assert.equal(state.phase, 'preflight');
  assert.equal(phaseComplete(state), true);
  state = batchReducer(state, { type: 'next_phase', phase: 'preflight' });
  assert.equal(state.phase, 'finished');
  assert.equal(state.currentId, null);
  assert.equal(state.articles.hot.delivered, false);
});

test('traffic opportunity is ranked before effort, with effort only breaking equal opportunity ties', () => {
  assert.deepEqual(defaultBatchIds, ['size-guide', 'maintenance', 'power', 'camera']);
  assert.ok(demoCatalog['size-guide'].effort > demoCatalog.maintenance.effort);
  assert.ok(defaultBatchIds.indexOf('size-guide') < defaultBatchIds.indexOf('maintenance'));
  assert.equal(demoCatalog.maintenance.priority, demoCatalog.power.priority);
  assert.ok(demoCatalog.maintenance.effort < demoCatalog.power.effort);
  assert.ok(defaultBatchIds.indexOf('maintenance') < defaultBatchIds.indexOf('power'));
  assert.match(demoCatalog['size-guide'].reason, /演示/);
});

test('returning to earlier stages keeps the article choices, reviews and adopted work intact', () => {
  let state = preflightSession();
  const before = structuredClone(state.articles);
  for (const phase of ['review', 'direction', 'artifacts', 'preflight'] as const) {
    state = batchReducer(state, { type: 'navigate_phase', phase });
    assert.equal(state.phase, phase);
    assert.equal(state.currentId, 'a');
    assert.deepEqual(state.articles, before);
  }
  const initial = newSession();
  for (const phase of ['review', 'artifacts', 'preflight'] as const) {
    assert.deepEqual(batchReducer(initial, { type: 'navigate_phase', phase }), initial);
  }
});

test('editing a returned review invalidates only that article and a fresh confirmation restores its route forward', () => {
  let state = preflightSession();
  state = batchReducer(state, { type: 'navigate_phase', phase: 'review' });
  const otherArticles = { b: structuredClone(state.articles.b), c: structuredClone(state.articles.c) };
  const before = structuredClone(state.articles.a);
  const stale: BatchAction = { type: 'confirm_review', target: target(state) };
  state = articleAction(state, { type: 'select_review', choice: 'narrow' });
  assert.equal(state.articles.a.directionConfirmed, true);
  assert.equal(state.articles.a.reviewChoice, 'narrow');
  assert.equal(state.articles.a.reviewedRevision, null);
  assert.equal(state.articles.a.artifactsConfirmed, false);
  assert.equal(state.articles.a.delivered, false);
  assert.equal(state.articles.a.adoptedCover, before.adoptedCover);
  assert.deepEqual({ b: state.articles.b, c: state.articles.c }, otherArticles);
  state = batchReducer(state, stale);
  assert.equal(state.articles.a.reviewedRevision, null);
  assert.equal(batchReducer(state, { type: 'navigate_phase', phase: 'artifacts' }).phase, 'review');
  state = articleAction(state, { type: 'confirm_review' });
  state = batchReducer(state, { type: 'navigate_phase', phase: 'artifacts' });
  assert.equal(state.phase, 'artifacts');
  assert.equal(state.articles.a.reviewedRevision, state.articles.a.revision);
  assert.equal(state.articles.a.artifactsConfirmed, false);
  assert.deepEqual({ b: state.articles.b, c: state.articles.c }, otherArticles);
});

test('clearing a selected direction or review removes the choice and requires an explicit new selection', () => {
  let state = preflightSession();
  state = batchReducer(state, { type: 'navigate_phase', phase: 'review' });
  const other = structuredClone(state.articles.b);
  state = articleAction(state, { type: 'clear_review' });
  assert.equal(state.articles.a.reviewChoice, null);
  assert.equal(state.articles.a.reviewedRevision, null);
  assert.equal(state.articles.a.directionConfirmed, true);
  assert.equal(state.articles.a.artifactsConfirmed, false);
  assert.deepEqual(articleAction(state, { type: 'confirm_review' }), state);
  state = batchReducer(state, { type: 'navigate_phase', phase: 'direction' });
  state = articleAction(state, { type: 'clear_direction' });
  assert.equal(state.articles.a.direction, null);
  assert.equal(state.articles.a.directionConfirmed, false);
  assert.deepEqual(articleAction(state, { type: 'confirm_direction' }), state);
  assert.deepEqual(state.articles.b, other);
});

test('revoking the current confirmation preserves its choice and blocks old confirmation events', () => {
  for (const phase of ['direction', 'review', 'artifacts'] as const) {
    let state = preflightSession();
    state = batchReducer(state, { type: 'navigate_phase', phase });
    const before = structuredClone(state.articles.a);
    const other = structuredClone(state.articles.b);
    const confirm: BatchAction = phase === 'direction'
      ? { type: 'confirm_direction', target: target(state) }
      : phase === 'review'
        ? { type: 'confirm_review', target: target(state) }
        : { type: 'confirm_artifacts', cover: before.adoptedCover!, target: target(state) };
    state = articleAction(state, { type: 'revoke_confirmation' });
    assert.equal(state.articles.a.direction, before.direction);
    if (phase !== 'direction') assert.equal(state.articles.a.reviewChoice, before.reviewChoice);
    assert.equal(state.articles.a.adoptedCover, before.adoptedCover);
    assert.equal(state.articles.a.artifactsConfirmed, false);
    assert.equal(state.articles.a.delivered, false);
    if (phase === 'direction') assert.equal(state.articles.a.directionConfirmed, false);
    else assert.equal(state.articles.a.directionConfirmed, true);
    if (phase === 'review') assert.equal(state.articles.a.reviewedRevision, null);
    if (phase === 'artifacts') assert.equal(state.articles.a.reviewedRevision, state.articles.a.revision);
    const revoked = state;
    state = batchReducer(state, confirm);
    assert.deepEqual(state, revoked);
    assert.deepEqual(state.articles.b, other);
  }
});

test('editing a cover creates a new candidate while the adopted version remains available and unchanged', () => {
  let state = preflightSession();
  state = batchReducer(state, { type: 'navigate_phase', phase: 'artifacts' });
  const adoptedId = state.articles.a.adoptedCover!;
  const adopted = structuredClone(state.articles.a.covers.find(cover => cover.id === adoptedId));
  const review = state.articles.a.reviewedRevision;
  const other = structuredClone(state.articles.b);
  state = articleAction(state, {
    type: 'edit_cover_candidate', candidate: state.articles.a.coverCandidate,
    title: 'A supplier checklist for installation access', angle: 'scene',
    requirement: 'Show a technician standing behind the cabinet; keep the access space visible.',
  });
  const editedId = state.articles.a.coverCandidate;
  assert.notEqual(editedId, adoptedId);
  assert.equal(state.articles.a.adoptedCover, adoptedId);
  assert.deepEqual(state.articles.a.covers.find(cover => cover.id === adoptedId), adopted);
  const edited = state.articles.a.covers.find(cover => cover.id === editedId)!;
  assert.equal(edited.title, 'A supplier checklist for installation access');
  assert.equal(edited.angle, 'scene');
  assert.match(edited.requirement, /access space/);
  assert.equal(state.articles.a.reviewedRevision, review);
  assert.equal(state.articles.a.artifactsConfirmed, true);
  state = articleAction(state, { type: 'adopt_cover', candidate: editedId });
  assert.equal(state.articles.a.adoptedCover, editedId);
  assert.equal(state.articles.a.artifactsConfirmed, false);
  state = articleAction(state, { type: 'select_cover_candidate', candidate: adoptedId });
  state = articleAction(state, { type: 'adopt_cover', candidate: adoptedId });
  assert.equal(state.articles.a.adoptedCover, adoptedId);
  assert.deepEqual(state.articles.a.covers.find(cover => cover.id === adoptedId), adopted);
  assert.deepEqual(state.articles.b, other);
});

test('revoking the adopted cover keeps every candidate and the reviewed text while blocking delivery', () => {
  let state = preflightSession();
  state = batchReducer(state, { type: 'navigate_phase', phase: 'artifacts' });
  const before = structuredClone(state.articles.a);
  const stale: BatchAction = { type: 'confirm_artifacts', cover: before.adoptedCover!, target: target(state) };
  state = articleAction(state, { type: 'revoke_cover_adoption' });
  assert.equal(state.articles.a.adoptedCover, null);
  assert.equal(state.articles.a.artifactsConfirmed, false);
  assert.equal(state.articles.a.delivered, false);
  assert.deepEqual(state.articles.a.covers, before.covers);
  assert.equal(state.articles.a.reviewedRevision, state.articles.a.revision);
  state = batchReducer(state, stale);
  assert.equal(state.articles.a.artifactsConfirmed, false);
  assert.equal(batchReducer(state, { type: 'navigate_phase', phase: 'preflight' }).phase, 'artifacts');
});

test('cover metadata validation rejects unsupported types, mismatched data, and oversized images', () => {
  const valid = uploadedCover();
  assert.equal(validateUploadedCover(valid), true);
  for (const invalid of [
    { ...valid, name: '' },
    { ...valid, id: '' },
    { ...valid, mimeType: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' },
    { ...valid, mimeType: 'image/jpeg' },
    { ...valid, dataUrl: 'https://example.com/image.png' },
    { ...valid, dataUrl: `data:image/png;base64,${Buffer.alloc(valid.bytes).toString('base64')}` },
    { ...valid, bytes: valid.bytes + 1 },
    { ...valid, bytes: 200001 },
    { ...valid, width: 319 },
    { ...valid, height: 179 },
    { ...valid, width: 1601 },
    { ...valid, width: 1600, height: 1600 },
    { ...valid, width: 640.5 },
  ]) assert.equal(validateUploadedCover(invalid as UploadedCover), false);
});

test('an upload finishing after moving to another article cannot replace either article cover', () => {
  let state = artifactsSession();
  const candidate = state.articles.a.coverCandidate;
  state = articleAction(state, { type: 'start_cover_upload', candidate, requestId: 'upload-a' });
  const late: BatchAction = { type: 'complete_cover_upload', candidate, requestId: 'upload-a', image: uploadedCover('asset-a'), target: target(state) };
  state = batchReducer(state, { type: 'open_article', id: 'b' });
  const afterMove = structuredClone(state.articles);
  state = batchReducer(state, late);
  assert.deepEqual(state.articles, afterMove);
  state = batchReducer(state, { type: 'open_article', id: 'a' });
  const afterReturn = structuredClone(state.articles);
  state = batchReducer(state, late);
  assert.deepEqual(state.articles, afterReturn);
  assert.equal(state.articles.a.covers.every(cover => cover.imageId === null), true);
});

test('an older upload or a changed candidate cannot overwrite the latest cover intent', () => {
  let state = artifactsSession();
  const candidate = state.articles.a.coverCandidate;
  state = articleAction(state, { type: 'start_cover_upload', candidate, requestId: 'upload-1' });
  const older: BatchAction = { type: 'complete_cover_upload', candidate, requestId: 'upload-1', image: uploadedCover('asset-old'), target: target(state) };
  state = articleAction(state, { type: 'start_cover_upload', candidate, requestId: 'upload-2' });
  const pending = state;
  assert.deepEqual(batchReducer(state, older), pending);
  state = articleAction(state, { type: 'cancel_cover_upload', requestId: 'upload-1' });
  assert.equal(state.articles.a.uploadRequestId, 'upload-2');
  const completion: BatchAction = { type: 'complete_cover_upload', candidate, requestId: 'upload-2', image: uploadedCover('asset-new'), target: target(state) };
  state = articleAction(state, { type: 'edit_cover_candidate', candidate, title: 'Keep this latest title', angle: 'diagram', requirement: 'Show the data path.' });
  const edited = structuredClone(state.articles.a);
  state = batchReducer(state, completion);
  assert.deepEqual(state.articles.a, edited);
});

test('a valid upload becomes a candidate and is saved separately from the adopted cover', () => {
  let state = preflightSession();
  state = batchReducer(state, { type: 'navigate_phase', phase: 'artifacts' });
  const adopted = structuredClone(state.articles.a.covers.find(cover => cover.id === state.articles.a.adoptedCover));
  const before = structuredClone(state.articles.a);
  const candidate = state.articles.a.coverCandidate;
  const image = uploadedCover('asset-local');
  state = articleAction(state, { type: 'start_cover_upload', candidate, requestId: 'upload-local' });
  state = articleAction(state, { type: 'complete_cover_upload', candidate, requestId: 'upload-local', image });
  assert.equal(state.articles.a.uploadRequestId, null);
  const uploadedId = state.articles.a.coverCandidate;
  assert.notEqual(uploadedId, before.adoptedCover);
  assert.equal(state.articles.a.covers.find(cover => cover.id === uploadedId)?.imageId, image.id);
  assert.deepEqual(state.articles.a.coverAssets[image.id], image);
  assert.equal(state.articles.a.adoptedCover, before.adoptedCover);
  assert.deepEqual(state.articles.a.covers.find(cover => cover.id === before.adoptedCover), adopted);
  assert.equal(state.articles.a.reviewedRevision, before.reviewedRevision);
  assert.equal(state.articles.a.artifactsConfirmed, true);
  state = articleAction(state, { type: 'adopt_cover', candidate: uploadedId });
  assert.equal(state.articles.a.artifactsConfirmed, false);
  const restored = restoreBatchSession(JSON.stringify(state), newSession());
  assert.equal(restored.phase, 'artifacts');
  assert.equal(restored.articles.a.adoptedCover, uploadedId);
  assert.deepEqual(restored.articles.a.coverAssets[image.id], image);
  assert.equal(restored.paused, true);
});

test('restoring the earlier preview retains prior choices and adopted template covers', () => {
  let state = preflightSession();
  state = batchReducer(state, { type: 'navigate_phase', phase: 'artifacts' });
  state = articleAction(state, { type: 'new_cover_candidate' });
  const legacy = JSON.parse(JSON.stringify(state));
  for (const article of Object.values(legacy.articles) as Record<string, unknown>[]) {
    delete article.covers;
    delete article.coverAssets;
    delete article.uploadRequestId;
  }
  const restored = restoreBatchSession(JSON.stringify(legacy), newSession());
  assert.equal(restored.phase, 'artifacts');
  assert.equal(restored.currentId, 'a');
  assert.equal(restored.articles.a.direction, state.articles.a.direction);
  assert.equal(restored.articles.a.reviewedRevision, state.articles.a.reviewedRevision);
  assert.equal(restored.articles.a.coverCandidate, 1);
  assert.equal(restored.articles.a.adoptedCover, 0);
  assert.ok(restored.articles.a.covers.some(cover => cover.id === 0));
  assert.ok(restored.articles.a.covers.some(cover => cover.id === 1));
  assert.equal(restored.articles.a.artifactsConfirmed, true);
});

test('invalid saved image relationships cannot create an adopted image and pending uploads do not resume by themselves', () => {
  let state = artifactsSession();
  state = articleAction(state, { type: 'start_cover_upload', candidate: 0, requestId: 'pending-on-close' });
  const restored = restoreBatchSession(JSON.stringify(state), newSession());
  assert.equal(restored.phase, 'artifacts');
  assert.equal(restored.articles.a.uploadRequestId, null);
  assert.equal(restored.articles.a.adoptedCover, null);
  assert.equal(restored.paused, true);
  for (const mutate of [
    (copy: BatchSession) => { copy.articles.a.covers[0].imageId = 'missing'; },
    (copy: BatchSession) => { copy.articles.a.covers.push({ ...copy.articles.a.covers[0] }); },
    (copy: BatchSession) => { copy.articles.a.adoptedCover = 999; },
    (copy: BatchSession) => {
      copy.articles.a.coverAssets.unsafe = { ...uploadedCover('unsafe'), dataUrl: 'https://example.com/not-a-local-file.png' };
      copy.articles.a.covers[0].imageId = 'unsafe';
    },
  ]) {
    const copy = structuredClone(state);
    mutate(copy);
    const rejected = restoreBatchSession(JSON.stringify(copy), newSession());
    assert.equal(rejected.phase, 'direction');
    assert.equal(rejected.currentId, 'a');
    assert.deepEqual(rejected.articles, newSession().articles);
    assert.match(rejected.message, /无法恢复/);
  }
});

test('daily budget rolls over while paused without changing retained article work or resetting the same day twice', () => {
  let state = preflightSession();
  state = batchReducer(state, { type: 'tick', seconds: 5 });
  const articles = structuredClone(state.articles);
  state = batchReducer(state, { type: 'rollover_day', day: '2026-11-10' });
  assert.equal(state.activeDay, '2026-11-10');
  assert.equal(state.elapsedSeconds, 5, 'first day attribution retains already recorded activity');
  state = batchReducer(state, { type: 'dismiss_budget' });
  const sameDay = state;
  state = batchReducer(state, { type: 'rollover_day', day: '2026-11-10' });
  assert.deepEqual(state, sameDay);
  state = batchReducer(state, { type: 'pause' });
  const pausedContext = { phase: state.phase, currentId: state.currentId, interrupted: state.interrupted };
  state = batchReducer(state, { type: 'rollover_day', day: '2026-11-11' });
  assert.equal(state.activeDay, '2026-11-11');
  assert.equal(state.elapsedSeconds, 0);
  assert.equal(state.budgetDismissed, false);
  assert.equal(state.paused, true);
  assert.deepEqual(state.articles, articles);
  assert.deepEqual({ phase: state.phase, currentId: state.currentId, interrupted: state.interrupted }, pausedContext);
  const restored = restoreBatchSession(JSON.stringify(state), newSession());
  assert.equal(restored.activeDay, '2026-11-11');
  assert.deepEqual(restored.articles, articles);
  state = batchReducer(restored, { type: 'resume' });
  state = batchReducer(state, { type: 'tick', seconds: 3 });
  state = batchReducer(state, { type: 'rollover_day', day: '2026-11-11' });
  assert.equal(state.elapsedSeconds, 3);
  assert.equal(state.budgetDismissed, false);
  assert.deepEqual(state.articles, articles);
});

test('unsaved cover forms stay isolated by article and candidate and can restore or clear without changing approvals', () => {
  let state = artifactsSession();
  state = articleAction(state, { type: 'adopt_cover', candidate: 0 });
  const adoptedArticles = structuredClone(state.articles);
  const original = { title: 'Keep this local title', angle: 'scene' as const, requirement: 'Keep the whole screen in frame.' };
  const secondArticle = { title: 'Another article', angle: 'product' as const, requirement: 'Show cabinet details.' };
  let forms: CoverFormDrafts = {};
  forms = setCoverFormDraft(forms, 'a', 0, original);
  forms = setCoverFormDraft(forms, 'b', 0, secondArticle);
  state = batchReducer(state, { type: 'navigate_phase', phase: 'review' });
  state = batchReducer(state, { type: 'open_article', id: 'b' });
  state = batchReducer(state, { type: 'interrupt' });
  state = batchReducer(state, { type: 'pause' });
  state = batchReducer(state, { type: 'resume' });
  state = batchReducer(state, { type: 'return_to_batch' });
  state = batchReducer(state, { type: 'navigate_phase', phase: 'artifacts' });
  state = batchReducer(state, { type: 'open_article', id: 'a' });
  assert.deepEqual(state.articles, adoptedArticles);
  assert.deepEqual(forms[coverFormKey('a', 0)], original);
  assert.deepEqual(forms[coverFormKey('b', 0)], secondArticle);

  state = articleAction(state, { type: 'new_cover_candidate' });
  const candidate = state.articles.a.coverCandidate;
  const latest = { title: 'Separate candidate text', angle: 'diagram' as const, requirement: 'Label the signal path.' };
  const beforeFormEdit = structuredClone(state.articles);
  forms = setCoverFormDraft(forms, 'a', candidate, latest);
  assert.deepEqual(forms[coverFormKey('a', 0)], original);
  assert.deepEqual(forms[coverFormKey('a', candidate)], latest);
  assert.deepEqual(state.articles, beforeFormEdit);
  const restored = restoreCoverFormDrafts(JSON.parse(JSON.stringify(forms)), state.articles);
  assert.deepEqual(restored, forms);
  const cleared = setCoverFormDraft(restored, 'a', candidate, null);
  assert.equal(cleared[coverFormKey('a', candidate)], undefined);
  assert.deepEqual(cleared[coverFormKey('a', 0)], original);
  assert.deepEqual(cleared[coverFormKey('b', 0)], secondArticle);
  assert.deepEqual(restored[coverFormKey('a', candidate)], latest, 'clearing returns a new cache object');
  assert.deepEqual(state.articles, beforeFormEdit);
});

test('cover form restoration drops invalid keys and values and retains only the three editable fields', () => {
  const state = artifactsSession(), articles = structuredClone(state.articles);
  const key = coverFormKey('a', 0);
  const safe = { title: 'Saved input', angle: 'product' as const, requirement: 'Use a real cabinet photo.' };
  const restored = restoreCoverFormDrafts({
    [key]: { ...safe, adoptedCover: 99, artifactsConfirmed: true, imageId: 'unverified' },
    [coverFormKey('unknown', 0)]: safe,
    [coverFormKey('a', 999)]: safe,
  }, state.articles);
  assert.deepEqual(restored, { [key]: safe });
  for (const invalid of [
    null, [], 'text', 5,
    { ...safe, title: 'x'.repeat(141) },
    { ...safe, title: 42 },
    { ...safe, angle: 'unknown' },
    { ...safe, requirement: 'x'.repeat(1001) },
    { ...safe, requirement: null },
  ]) assert.deepEqual(restoreCoverFormDrafts({ [key]: invalid }, state.articles), {});
  for (const invalidEnvelope of [null, undefined, [], 'broken', 3]) {
    assert.deepEqual(restoreCoverFormDrafts(invalidEnvelope, state.articles), {});
  }
  assert.deepEqual(state.articles, articles);
});
