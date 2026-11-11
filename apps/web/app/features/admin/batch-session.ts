export const batchPhases = ['direction', 'review', 'artifacts', 'preflight'] as const;
export type BatchPhase = typeof batchPhases[number];
export type DirectionId = 'answer' | 'scenario' | 'compare';
export type ReviewChoice = 'patch' | 'narrow';
export type Tweak = 'shorter' | 'technical' | 'checklist';

export type BatchArticle = {
  direction: DirectionId | null;
  directionRound: number;
  tweaks: Tweak[];
  note: string;
  revision: number;
  directionConfirmed: boolean;
  reviewChoice: ReviewChoice | null;
  reviewedRevision: number | null;
  coverCandidate: number;
  adoptedCover: number | null;
  artifactsConfirmed: boolean;
  delivered: boolean;
  deferred: 'skip' | 'verify' | null;
};

export type BatchSession = {
  schema: 1;
  order: string[];
  hotId: string;
  articles: Record<string, BatchArticle>;
  phase: BatchPhase | 'finished';
  currentId: string | null;
  interrupted: { phase: BatchPhase | 'finished'; currentId: string | null } | null;
  paused: boolean;
  elapsedSeconds: number;
  budgetDismissed: boolean;
  message: string;
};

export type BatchTarget = { articleId: string; phase: BatchPhase; revision: number };
export type ArticleAction =
  | { type: 'select_direction'; id: DirectionId }
  | { type: 'shuffle_directions' }
  | { type: 'toggle_tweak'; tweak: Tweak }
  | { type: 'set_note'; note: string }
  | { type: 'confirm_direction' }
  | { type: 'select_review'; choice: ReviewChoice }
  | { type: 'confirm_review' }
  | { type: 'new_cover_candidate' }
  | { type: 'adopt_cover'; candidate: number }
  | { type: 'confirm_artifacts'; cover: number }
  | { type: 'confirm_delivery' };

export type BatchAction = ArticleAction & { target: BatchTarget }
  | { type: 'open_article'; id: string }
  | { type: 'next_phase'; phase: BatchPhase }
  | { type: 'defer_articles'; ids: string[]; reason: 'skip' | 'verify' }
  | { type: 'restore_article'; id: string }
  | { type: 'interrupt' }
  | { type: 'return_to_batch' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'tick'; seconds: number }
  | { type: 'dismiss_budget' };

export function createBatchSession(ids: string[], hotId: string): BatchSession {
  const order = [...new Set(ids)].slice(0, 5);
  const articles: Record<string, BatchArticle> = {};
  for (const id of [...order, hotId]) {
    articles[id] = {
      direction: null, directionRound: 0, tweaks: [], note: '', revision: 1,
      directionConfirmed: false, reviewChoice: null, reviewedRevision: null,
      coverCandidate: 0, adoptedCover: null, artifactsConfirmed: false,
      delivered: false, deferred: null,
    };
  }
  return {
    schema: 1, order, hotId, articles, phase: 'direction', currentId: order[0] ?? null,
    interrupted: null, paused: false, elapsedSeconds: 0, budgetDismissed: false, message: '',
  };
}

export function activeArticleIds(state: BatchSession): string[] {
  return state.interrupted
    ? [state.hotId].filter(id => !state.articles[id].deferred)
    : state.order.filter(id => !state.articles[id].deferred);
}

export function articleComplete(article: BatchArticle, phase: BatchPhase): boolean {
  if (phase === 'direction') return article.directionConfirmed;
  if (phase === 'review') return article.directionConfirmed && article.reviewChoice !== null && article.reviewedRevision === article.revision;
  if (phase === 'artifacts') return articleComplete(article, 'review') && article.artifactsConfirmed;
  return articleComplete(article, 'artifacts') && article.delivered;
}

export function firstIncompletePhase(article: BatchArticle): BatchPhase | 'finished' {
  return batchPhases.find(phase => !articleComplete(article, phase)) ?? 'finished';
}

export function phaseComplete(state: BatchSession): boolean {
  if (state.phase === 'finished') return true;
  const ids = activeArticleIds(state);
  return ids.length > 0 && ids.every(id => articleComplete(state.articles[id], state.phase as BatchPhase));
}

function nextPending(state: BatchSession): string | null {
  if (state.phase === 'finished') return null;
  const ids = activeArticleIds(state);
  if (!state.currentId || !ids.includes(state.currentId)) return ids.find(id => !articleComplete(state.articles[id], state.phase as BatchPhase)) ?? null;
  const start = Math.max(0, ids.indexOf(state.currentId ?? ''));
  const rotated = [...ids.slice(start + 1), ...ids.slice(0, start + 1)];
  return rotated.find(id => !articleComplete(state.articles[id], state.phase as BatchPhase)) ?? null;
}

function updateCurrent(state: BatchSession, update: Partial<BatchArticle>): BatchSession {
  if (!state.currentId) return state;
  return { ...state, articles: { ...state.articles, [state.currentId]: { ...state.articles[state.currentId], ...update } } };
}

function invalidateReview(article: BatchArticle): Partial<BatchArticle> {
  return {
    revision: article.revision + 1,
    reviewedRevision: null, artifactsConfirmed: false, delivered: false,
  };
}

function invalidateContent(article: BatchArticle): Partial<BatchArticle> {
  return { ...invalidateReview(article), directionConfirmed: false, reviewChoice: null };
}

function returnToBatch(state: BatchSession, message: string): BatchSession {
  if (!state.interrupted) return state;
  return { ...state, ...state.interrupted, interrupted: null, message };
}

export function batchReducer(state: BatchSession, action: BatchAction): BatchSession {
  const article = state.currentId ? state.articles[state.currentId] : null;
  if ('target' in action && (action.target.articleId !== state.currentId || action.target.phase !== state.phase || action.target.revision !== article?.revision)) return state;
  if (action.type === 'pause') return { ...state, paused: true, message: '已停在这里，选择与成品保留。' };
  if (action.type === 'resume') return { ...state, paused: false, message: '继续上次的位置。' };
  if (action.type === 'dismiss_budget') return { ...state, budgetDismissed: true };
  if (action.type === 'tick') {
    if (state.paused || !Number.isFinite(action.seconds) || action.seconds <= 0) return state;
    return { ...state, elapsedSeconds: state.elapsedSeconds + Math.min(action.seconds, 5) };
  }
  if (state.paused) return state;
  if (action.type === 'interrupt') {
    if (state.interrupted || state.articles[state.hotId].delivered) return state;
    const hot = { ...state.articles[state.hotId], deferred: null };
    return {
      ...state, articles: { ...state.articles, [state.hotId]: hot },
      interrupted: { phase: state.phase, currentId: state.currentId },
      phase: firstIncompletePhase(hot), currentId: state.hotId,
      message: '原批次已保留。现在先处理这条热点示例。',
    };
  }
  if (action.type === 'return_to_batch') return returnToBatch(state, '已回到插队前的位置，热点进度也已保留。');
  if (action.type === 'open_article') {
    if (!activeArticleIds(state).includes(action.id)) return state;
    return { ...state, currentId: action.id, message: '' };
  }
  if (action.type === 'defer_articles') {
    const valid = action.ids.filter(id => activeArticleIds(state).includes(id));
    if (!valid.length) return state;
    const articles = { ...state.articles };
    for (const id of valid) articles[id] = { ...articles[id], deferred: action.reason };
    const next = { ...state, articles, message: `本轮移出 ${valid.length} 篇，已做的选择保留。` };
    if (state.interrupted) return returnToBatch(next, '热点已暂存，回到原批次。');
    return { ...next, currentId: valid.includes(state.currentId ?? '') ? nextPending(next) : state.currentId };
  }
  if (action.type === 'restore_article') {
    const saved = state.articles[action.id];
    if (state.interrupted || !state.order.includes(action.id) || !saved?.deferred) return state;
    const phase = firstIncompletePhase(saved);
    const currentIndex = state.phase === 'finished' ? 4 : batchPhases.indexOf(state.phase);
    const requiredIndex = phase === 'finished' ? 4 : batchPhases.indexOf(phase);
    return {
      ...state, articles: { ...state.articles, [action.id]: { ...saved, deferred: null } },
      phase: requiredIndex < currentIndex ? phase : state.phase, currentId: action.id,
      message: '已放回本轮，保留之前的选择。',
    };
  }
  if (action.type === 'next_phase') {
    if (!phaseComplete(state) || state.phase === 'finished' || action.phase !== state.phase) return state;
    const index = batchPhases.indexOf(state.phase);
    const phase: BatchSession['phase'] = index === batchPhases.length - 1 ? 'finished' : batchPhases[index + 1];
    const next = { ...state, phase, currentId: null, message: '' };
    return { ...next, currentId: phase === 'finished' ? null : nextPending(next) };
  }
  if (!article || article.deferred) return state;
  if (action.type === 'select_direction' && state.phase === 'direction') {
    if (!['answer', 'scenario', 'compare'].includes(action.id) || action.id === article.direction) return state;
    return updateCurrent(state, { ...invalidateContent(article), direction: action.id });
  }
  if (action.type === 'shuffle_directions' && state.phase === 'direction') {
    return updateCurrent(state, { ...invalidateContent(article), direction: null, directionRound: article.directionRound + 1 });
  }
  if (action.type === 'toggle_tweak' && (state.phase === 'direction' || state.phase === 'review' && article.directionConfirmed)) {
    if (!['shorter', 'technical', 'checklist'].includes(action.tweak)) return state;
    const tweaks = article.tweaks.includes(action.tweak)
      ? article.tweaks.filter(tweak => tweak !== action.tweak) : [...article.tweaks, action.tweak];
    return updateCurrent(state, { ...(state.phase === 'review' ? invalidateReview(article) : invalidateContent(article)), tweaks });
  }
  if (action.type === 'set_note' && (state.phase === 'direction' || state.phase === 'review' && article.directionConfirmed)) {
    const note = action.note.slice(0, 500);
    return note === article.note ? state : updateCurrent(state, { ...(state.phase === 'review' ? invalidateReview(article) : invalidateContent(article)), note });
  }
  if (action.type === 'confirm_direction' && state.phase === 'direction' && article.direction) {
    const next = updateCurrent(state, { directionConfirmed: true });
    return { ...next, currentId: nextPending(next), message: '方向已确认，已带出下一篇。正文在本批方向完成后展开。' };
  }
  if (action.type === 'select_review' && state.phase === 'review' && article.directionConfirmed) {
    if (!['patch', 'narrow'].includes(action.choice) || action.choice === article.reviewChoice) return state;
    return updateCurrent(state, { ...invalidateReview(article), reviewChoice: action.choice });
  }
  if (action.type === 'confirm_review' && state.phase === 'review' && article.reviewChoice && article.directionConfirmed) {
    const next = updateCurrent(state, { reviewedRevision: article.revision });
    return { ...next, currentId: nextPending(next), message: '当前版本已确认，其他稿件仍需分别确认。' };
  }
  if (action.type === 'new_cover_candidate' && state.phase === 'artifacts' && articleComplete(article, 'review')) {
    return updateCurrent(state, { coverCandidate: article.coverCandidate + 1 });
  }
  if (action.type === 'adopt_cover' && state.phase === 'artifacts' && articleComplete(article, 'review')) {
    if (action.candidate !== article.coverCandidate) return state;
    return updateCurrent(state, { adoptedCover: article.coverCandidate, artifactsConfirmed: false, delivered: false });
  }
  if (action.type === 'confirm_artifacts' && state.phase === 'artifacts' && article.adoptedCover !== null && articleComplete(article, 'review')) {
    if (action.cover !== article.adoptedCover) return state;
    const next = updateCurrent(state, { artifactsConfirmed: true });
    return { ...next, currentId: nextPending(next), message: '成品已确认，正文和其他已采用成果保持不变。' };
  }
  if (action.type === 'confirm_delivery' && state.phase === 'preflight' && articleComplete(article, 'artifacts')) {
    const next = updateCurrent(state, { delivered: true });
    if (state.interrupted) return returnToBatch(next, '热点已完成交付演示，已回到原批次。没有发出真实请求。');
    return { ...next, currentId: nextPending(next), message: '已完成这一篇的交付演示，没有创建真实 WordPress 草稿。' };
  }
  return state;
}

export function restoreBatchSession(raw: string | null, fallback: BatchSession): BatchSession {
  if (!raw) return fallback;
  fallback = { ...fallback, message: '上次演示记录无法恢复，已回到初始批次。没有读取或修改真实稿件。' };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return fallback;
    const saved = value as BatchSession;
    if (saved.schema !== 1 || JSON.stringify(saved.order) !== JSON.stringify(fallback.order) || saved.hotId !== fallback.hotId) return fallback;
    if (![...batchPhases, 'finished'].includes(saved.phase) || typeof saved.paused !== 'boolean' || typeof saved.budgetDismissed !== 'boolean') return fallback;
    if (!Number.isFinite(saved.elapsedSeconds) || saved.elapsedSeconds < 0 || typeof saved.message !== 'string') return fallback;
    if (saved.currentId !== null && !fallback.articles[saved.currentId]) return fallback;
    if (!saved.articles || Object.keys(saved.articles).length !== Object.keys(fallback.articles).length) return fallback;
    for (const id of Object.keys(fallback.articles)) {
      const a = saved.articles[id];
      if (!a || ![null, 'answer', 'scenario', 'compare'].includes(a.direction) || ![null, 'patch', 'narrow'].includes(a.reviewChoice)) return fallback;
      if (!Array.isArray(a.tweaks) || a.tweaks.some(t => !['shorter', 'technical', 'checklist'].includes(t)) || typeof a.note !== 'string' || a.note.length > 500) return fallback;
      if (![a.revision, a.directionRound, a.coverCandidate].every(n => Number.isSafeInteger(n) && n >= 0)) return fallback;
      if (a.adoptedCover !== null && (!Number.isSafeInteger(a.adoptedCover) || a.adoptedCover < 0 || a.adoptedCover > a.coverCandidate)) return fallback;
      if (![a.directionConfirmed, a.artifactsConfirmed, a.delivered].every(v => typeof v === 'boolean') || ![null, 'skip', 'verify'].includes(a.deferred)) return fallback;
      if (a.reviewedRevision !== null && (a.reviewedRevision !== a.revision || a.reviewChoice === null) || a.directionConfirmed && !a.direction || a.reviewedRevision !== null && !a.directionConfirmed || a.artifactsConfirmed && (a.reviewedRevision !== a.revision || a.adoptedCover === null) || a.delivered && !a.artifactsConfirmed) return fallback;
    }
    const validPhase = (phase: BatchPhase | 'finished', ids: string[]) => {
      const index = phase === 'finished' ? 4 : batchPhases.indexOf(phase);
      return index === 0 || (phase !== 'finished' || ids.length > 0) && ids.every(id => articleComplete(saved.articles[id], batchPhases[index - 1]));
    };
    if (saved.interrupted !== null) {
      if (!saved.interrupted || ![...batchPhases, 'finished'].includes(saved.interrupted.phase)) return fallback;
      if (saved.interrupted.currentId !== null && !saved.order.includes(saved.interrupted.currentId)) return fallback;
      if (saved.currentId !== null && saved.currentId !== saved.hotId) return fallback;
      if (!validPhase(saved.interrupted.phase, saved.order.filter(id => !saved.articles[id].deferred))) return fallback;
    } else if (saved.currentId !== null && !saved.order.includes(saved.currentId)) return fallback;
    if (!validPhase(saved.phase, activeArticleIds(saved))) return fallback;
    if (saved.currentId !== null && saved.articles[saved.currentId].deferred) return fallback;
    if (saved.phase === 'finished' && saved.currentId !== null) {
      saved.currentId = null;
    }
    if (saved.currentId === null && saved.phase !== 'finished' && !phaseComplete(saved)) saved.currentId = nextPending(saved);
    return { ...saved, paused: true, message: '已恢复上次进度。点击继续，再开始计时。' };
  } catch { return fallback; }
}
