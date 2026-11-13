export const batchPhases = ['direction', 'review', 'artifacts', 'preflight'] as const;
export type BatchPhase = typeof batchPhases[number];
export type DirectionId = 'answer' | 'scenario' | 'compare';
export type ReviewChoice = 'patch' | 'narrow';
export type Tweak = 'shorter' | 'technical' | 'checklist';
export type CoverAngle = 'product' | 'scene' | 'diagram';
export type UploadedCover = {
  id: string; name: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  dataUrl: string; width: number; height: number; bytes: number;
};
export type CoverDraft = { id: number; title: string; angle: CoverAngle; requirement: string; imageId: string | null; templateVariant?: number };
export type CoverFormDraft = Pick<CoverDraft, 'title' | 'angle' | 'requirement'>;
export type CoverFormDrafts = Record<string, CoverFormDraft>;

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
  covers: CoverDraft[];
  coverAssets: Record<string, UploadedCover>;
  uploadRequestId: string | null;
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
  activeDay: string | null;
  budgetDismissed: boolean;
  message: string;
};

export type BatchTarget = { articleId: string; phase: BatchPhase; revision: number };

export function coverFormKey(articleId: string, candidate: number): string {
  return `${articleId}:${candidate}`;
}

function validCoverFormDraft(value: unknown): value is CoverFormDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const draft = value as CoverFormDraft;
  return typeof draft.title === 'string' && draft.title.length <= 140 && typeof draft.requirement === 'string' && draft.requirement.length <= 1000 && ['product', 'scene', 'diagram'].includes(draft.angle);
}

export function setCoverFormDraft(drafts: CoverFormDrafts, articleId: string, candidate: number, draft: CoverFormDraft | null): CoverFormDrafts {
  const key = coverFormKey(articleId, candidate);
  if (draft === null) {
    if (!Object.hasOwn(drafts, key)) return drafts;
    const next = { ...drafts };
    delete next[key];
    return next;
  }
  if (!validCoverFormDraft(draft) || !articleId || !Number.isSafeInteger(candidate) || candidate < 0) return drafts;
  return { ...drafts, [key]: { title: draft.title, angle: draft.angle, requirement: draft.requirement } };
}

export function restoreCoverFormDrafts(value: unknown, articles: Record<string, BatchArticle>): CoverFormDrafts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const restored: CoverFormDrafts = {};
  for (const [articleId, article] of Object.entries(articles)) {
    for (const candidate of article.covers) {
      const key = coverFormKey(articleId, candidate.id);
      if (!Object.hasOwn(value, key)) continue;
      const draft = (value as Record<string, unknown>)[key];
      if (validCoverFormDraft(draft)) restored[key] = { title: draft.title, angle: draft.angle, requirement: draft.requirement };
    }
  }
  return restored;
}

export type ArticleAction =
  | { type: 'select_direction'; id: DirectionId }
  | { type: 'clear_direction' }
  | { type: 'shuffle_directions' }
  | { type: 'toggle_tweak'; tweak: Tweak }
  | { type: 'set_note'; note: string }
  | { type: 'confirm_direction' }
  | { type: 'select_review'; choice: ReviewChoice }
  | { type: 'clear_review' }
  | { type: 'confirm_review' }
  | { type: 'revoke_confirmation' }
  | { type: 'new_cover_candidate' }
  | { type: 'edit_cover_candidate'; candidate: number; title: string; angle: CoverAngle; requirement: string }
  | { type: 'select_cover_candidate'; candidate: number }
  | { type: 'revoke_cover_adoption' }
  | { type: 'start_cover_upload'; candidate: number; requestId: string }
  | { type: 'complete_cover_upload'; candidate: number; requestId: string; image: UploadedCover }
  | { type: 'cancel_cover_upload'; requestId: string }
  | { type: 'adopt_cover'; candidate: number }
  | { type: 'confirm_artifacts'; cover: number }
  | { type: 'confirm_delivery' };

export type BatchAction = ArticleAction & { target: BatchTarget }
  | { type: 'open_article'; id: string }
  | { type: 'next_phase'; phase: BatchPhase }
  | { type: 'navigate_phase'; phase: BatchPhase }
  | { type: 'defer_articles'; ids: string[]; reason: 'skip' | 'verify' }
  | { type: 'restore_article'; id: string }
  | { type: 'interrupt' }
  | { type: 'return_to_batch' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'tick'; seconds: number }
  | { type: 'rollover_day'; day: string }
  | { type: 'dismiss_budget' };

export function createBatchSession(ids: string[], hotId: string): BatchSession {
  const order = [...new Set(ids)].slice(0, 5);
  const articles: Record<string, BatchArticle> = {};
  for (const id of [...order, hotId]) {
    articles[id] = {
      direction: null, directionRound: 0, tweaks: [], note: '', revision: 1,
      directionConfirmed: false, reviewChoice: null, reviewedRevision: null,
      coverCandidate: 0, adoptedCover: null, artifactsConfirmed: false,
      covers: [{ id: 0, title: '', angle: 'product', requirement: '', imageId: null }], coverAssets: {}, uploadRequestId: null,
      delivered: false, deferred: null,
    };
  }
  return {
    schema: 1, order, hotId, articles, phase: 'direction', currentId: order[0] ?? null,
    interrupted: null, paused: false, elapsedSeconds: 0, activeDay: null, budgetDismissed: false, message: '',
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

export function canVisitPhase(state: BatchSession, phase: BatchPhase): boolean {
  const index = batchPhases.indexOf(phase);
  const ids = activeArticleIds(state);
  return index === 0 || index > 0 && ids.length > 0 && ids.every(id => articleComplete(state.articles[id], batchPhases[index - 1]));
}

export function validateUploadedCover(image: UploadedCover): boolean {
  if (!image || typeof image.id !== 'string' || !image.id || image.id.length > 100 || typeof image.name !== 'string' || !image.name || image.name.length > 160) return false;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType)) return false;
  if (![image.width, image.height, image.bytes].every(Number.isSafeInteger) || image.width < 320 || image.height < 180 || image.width > 1600 || image.height > 1600 || image.width * image.height > 2_000_000 || image.bytes < 1 || image.bytes > 200_000) return false;
  if (typeof image.dataUrl !== 'string' || image.dataUrl.length > 270_000) return false;
  const prefix = `data:${image.mimeType};base64,`;
  if (!image.dataUrl.startsWith(prefix)) return false;
  const data = image.dataUrl.slice(prefix.length);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) return false;
  try {
    const raw = atob(data), b = (i: number) => raw.charCodeAt(i);
    if (raw.length !== image.bytes) return false;
    if (image.mimeType === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b(i) === v);
    if (image.mimeType === 'image/jpeg') return b(0) === 255 && b(1) === 216 && b(2) === 255;
    return raw.slice(0, 4) === 'RIFF' && raw.slice(8, 12) === 'WEBP';
  } catch { return false; }
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

function invalidatePackaging(article: BatchArticle): Partial<BatchArticle> {
  return { revision: article.revision + 1, reviewedRevision: article.reviewedRevision === article.revision ? article.revision + 1 : null, artifactsConfirmed: false, delivered: false, uploadRequestId: null };
}

function cancelCurrentUpload(state: BatchSession): BatchSession {
  return state.currentId && state.articles[state.currentId].uploadRequestId ? updateCurrent(state, { uploadRequestId: null }) : state;
}

function appendCover(state: BatchSession, draft: Omit<CoverDraft, 'id'>, assets?: Record<string, UploadedCover>): BatchSession {
  const article = state.articles[state.currentId!];
  const id = Math.max(...article.covers.map(cover => cover.id)) + 1;
  return updateCurrent(state, { covers: [...article.covers, { ...draft, id }], coverCandidate: id, coverAssets: assets ?? article.coverAssets, uploadRequestId: null });
}

function returnToBatch(state: BatchSession, message: string): BatchSession {
  if (!state.interrupted) return state;
  return { ...state, ...state.interrupted, interrupted: null, message };
}

export function batchReducer(state: BatchSession, action: BatchAction): BatchSession {
  const article = state.currentId ? state.articles[state.currentId] : null;
  if ('target' in action && (action.target.articleId !== state.currentId || action.target.phase !== state.phase || action.target.revision !== article?.revision)) return state;
  if (action.type === 'pause') return { ...cancelCurrentUpload(state), paused: true, message: '已停在这里，选择与成品保留。' };
  if (action.type === 'resume') return { ...state, paused: false, message: '继续上次的位置。' };
  if (action.type === 'dismiss_budget') return { ...state, budgetDismissed: true };
  if (action.type === 'rollover_day') {
    if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(action.day) || state.activeDay === action.day) return state;
    return { ...state, activeDay: action.day, ...(state.activeDay === null ? {} : { elapsedSeconds: 0, budgetDismissed: false }) };
  }
  if (action.type === 'tick') {
    if (state.paused || !Number.isFinite(action.seconds) || action.seconds <= 0) return state;
    return { ...state, elapsedSeconds: state.elapsedSeconds + Math.min(action.seconds, 5) };
  }
  if (state.paused) return state;
  if (action.type === 'navigate_phase') {
    if (!batchPhases.includes(action.phase) || !canVisitPhase(state, action.phase)) return state;
    const next = cancelCurrentUpload(state);
    const ids = activeArticleIds(next);
    return { ...next, phase: action.phase, currentId: next.currentId && ids.includes(next.currentId) ? next.currentId : ids[0] ?? null, message: '已返回所选环节。已有确认保留，修改后会更新相关状态。' };
  }
  if (action.type === 'interrupt') {
    if (state.interrupted || state.articles[state.hotId].delivered) return state;
    const hot = { ...state.articles[state.hotId], deferred: null };
    return {
      ...cancelCurrentUpload(state), articles: { ...cancelCurrentUpload(state).articles, [state.hotId]: hot },
      interrupted: { phase: state.phase, currentId: state.currentId },
      phase: firstIncompletePhase(hot), currentId: state.hotId,
      message: '原批次已保留。现在先处理这条热点示例。',
    };
  }
  if (action.type === 'return_to_batch') return returnToBatch(cancelCurrentUpload(state), '已回到插队前的位置，热点进度也已保留。');
  if (action.type === 'open_article') {
    if (!activeArticleIds(state).includes(action.id)) return state;
    return { ...cancelCurrentUpload(state), currentId: action.id, message: '' };
  }
  if (action.type === 'defer_articles') {
    const valid = action.ids.filter(id => activeArticleIds(state).includes(id));
    if (!valid.length) return state;
    const articles = { ...state.articles };
    for (const id of valid) articles[id] = { ...articles[id], deferred: action.reason, uploadRequestId: null };
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
    const next = { ...cancelCurrentUpload(state), phase, currentId: null, message: '' };
    return { ...next, currentId: phase === 'finished' ? null : nextPending(next) };
  }
  if (!article || article.deferred) return state;
  if (action.type === 'revoke_confirmation') {
    if (state.phase === 'direction') return updateCurrent(state, { ...invalidateReview(article), directionConfirmed: false, uploadRequestId: null });
    if (state.phase === 'review') return updateCurrent(state, { ...invalidateReview(article), uploadRequestId: null });
    if (state.phase === 'artifacts') return updateCurrent(state, invalidatePackaging(article));
    if (state.phase === 'preflight') return updateCurrent(state, { ...invalidatePackaging(article), artifactsConfirmed: article.artifactsConfirmed });
    return state;
  }
  if (action.type === 'clear_direction' && state.phase === 'direction' && article.direction) return updateCurrent(state, { ...invalidateContent(article), direction: null });
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
  if (action.type === 'clear_review' && state.phase === 'review' && article.reviewChoice) return updateCurrent(state, { ...invalidateReview(article), reviewChoice: null });
  if (action.type === 'confirm_review' && state.phase === 'review' && article.reviewChoice && article.directionConfirmed) {
    const next = updateCurrent(state, { reviewedRevision: article.revision });
    return { ...next, currentId: nextPending(next), message: '当前版本已确认，其他稿件仍需分别确认。' };
  }
  if (action.type === 'new_cover_candidate' && state.phase === 'artifacts' && articleComplete(article, 'review')) {
    const current = article.covers.find(cover => cover.id === article.coverCandidate)!;
    return appendCover(state, { ...current, imageId: null, templateVariant: ((current.templateVariant ?? current.id) + 1) % 3 });
  }
  if (action.type === 'edit_cover_candidate' && state.phase === 'artifacts' && articleComplete(article, 'review')) {
    if (action.candidate !== article.coverCandidate || !['product', 'scene', 'diagram'].includes(action.angle)) return state;
    const current = article.covers.find(cover => cover.id === article.coverCandidate)!;
    const title = action.title.slice(0, 140), requirement = action.requirement.slice(0, 1000);
    if (title === current.title && requirement === current.requirement && action.angle === current.angle) return state;
    return appendCover(state, { ...current, title, requirement, angle: action.angle, templateVariant: current.templateVariant ?? current.id % 3 });
  }
  if (action.type === 'select_cover_candidate' && state.phase === 'artifacts') {
    if (!article.covers.some(cover => cover.id === action.candidate)) return state;
    return updateCurrent(state, { coverCandidate: action.candidate, uploadRequestId: null });
  }
  if (action.type === 'revoke_cover_adoption' && state.phase === 'artifacts') {
    return updateCurrent(state, { ...invalidatePackaging(article), adoptedCover: null });
  }
  if (action.type === 'start_cover_upload' && state.phase === 'artifacts' && articleComplete(article, 'review')) {
    if (action.candidate !== article.coverCandidate || !action.requestId || action.requestId.length > 100) return state;
    return updateCurrent(state, { uploadRequestId: action.requestId });
  }
  if (action.type === 'cancel_cover_upload' && action.requestId === article.uploadRequestId) return updateCurrent(state, { uploadRequestId: null });
  if (action.type === 'complete_cover_upload' && state.phase === 'artifacts' && articleComplete(article, 'review')) {
    if (article.uploadRequestId !== action.requestId || action.candidate !== article.coverCandidate || !validateUploadedCover(action.image) || article.coverAssets[action.image.id]) return state;
    const current = article.covers.find(cover => cover.id === article.coverCandidate)!;
    return appendCover(state, { ...current, imageId: action.image.id, templateVariant: current.templateVariant ?? current.id % 3 }, { ...article.coverAssets, [action.image.id]: action.image });
  }
  if (action.type === 'adopt_cover' && state.phase === 'artifacts' && articleComplete(article, 'review')) {
    if (action.candidate !== article.coverCandidate || article.uploadRequestId) return state;
    return updateCurrent(state, { adoptedCover: article.coverCandidate, artifactsConfirmed: false, delivered: false });
  }
  if (action.type === 'confirm_artifacts' && state.phase === 'artifacts' && article.adoptedCover !== null && articleComplete(article, 'review')) {
    if (action.cover !== article.adoptedCover || article.uploadRequestId) return state;
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
    if (saved.activeDay === undefined) saved.activeDay = null;
    if (saved.activeDay !== null && (typeof saved.activeDay !== 'string' || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(saved.activeDay))) return fallback;
    if (saved.currentId !== null && !fallback.articles[saved.currentId]) return fallback;
    if (!saved.articles || Object.keys(saved.articles).length !== Object.keys(fallback.articles).length) return fallback;
    for (const id of Object.keys(fallback.articles)) {
      const a = saved.articles[id];
      if (!a || ![null, 'answer', 'scenario', 'compare'].includes(a.direction) || ![null, 'patch', 'narrow'].includes(a.reviewChoice)) return fallback;
      if (!Array.isArray(a.tweaks) || a.tweaks.some(t => !['shorter', 'technical', 'checklist'].includes(t)) || typeof a.note !== 'string' || a.note.length > 500) return fallback;
      if (![a.revision, a.directionRound, a.coverCandidate].every(n => Number.isSafeInteger(n) && n >= 0)) return fallback;
      if (a.adoptedCover !== null && (!Number.isSafeInteger(a.adoptedCover) || a.adoptedCover < 0)) return fallback;
      if (a.covers === undefined && a.coverAssets === undefined && a.uploadRequestId === undefined) {
        if (a.coverCandidate > 500 || a.adoptedCover !== null && a.adoptedCover > a.coverCandidate) return fallback;
        a.covers = Array.from({ length: a.coverCandidate + 1 }, (_, id) => ({ id, title: '', angle: 'product', requirement: '', imageId: null }));
        a.coverAssets = {};
        a.uploadRequestId = null;
      }
      if (!Array.isArray(a.covers) || !a.covers.length || a.covers.length > 1000 || !a.coverAssets || typeof a.coverAssets !== 'object' || Array.isArray(a.coverAssets)) return fallback;
      const coverIds = new Set<number>();
      for (const cover of a.covers) {
        if (!cover || !Number.isSafeInteger(cover.id) || cover.id < 0 || coverIds.has(cover.id) || typeof cover.title !== 'string' || cover.title.length > 140 || typeof cover.requirement !== 'string' || cover.requirement.length > 1000 || !['product', 'scene', 'diagram'].includes(cover.angle)) return fallback;
        if (cover.templateVariant !== undefined && ![0, 1, 2].includes(cover.templateVariant)) return fallback;
        if (cover.imageId !== null && (typeof cover.imageId !== 'string' || !Object.hasOwn(a.coverAssets, cover.imageId))) return fallback;
        coverIds.add(cover.id);
      }
      if (!coverIds.has(a.coverCandidate) || a.adoptedCover !== null && !coverIds.has(a.adoptedCover)) return fallback;
      for (const [assetId, asset] of Object.entries(a.coverAssets)) if (assetId !== asset.id || !validateUploadedCover(asset)) return fallback;
      if (a.uploadRequestId !== null && typeof a.uploadRequestId !== 'string') return fallback;
      a.uploadRequestId = null;
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
