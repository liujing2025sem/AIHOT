import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeArticleIds, batchReducer, createBatchSession, phaseComplete, restoreBatchSession,
  type BatchAction, type BatchSession, type BatchTarget,
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
