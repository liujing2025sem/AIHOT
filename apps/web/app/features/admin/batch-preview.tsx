import { useEffect, useId, useReducer, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCheck, ChevronDown, ChevronRight, Clock3, FileText, Layers3, ListFilter, Pause, Play, RotateCcw, Sparkles, Upload, X, Zap } from 'lucide-react';
import { activeArticleIds, articleComplete, batchPhases, batchReducer, canVisitPhase, coverFormKey, createBatchSession, phaseComplete, restoreBatchSession, restoreCoverFormDrafts, setCoverFormDraft, validateUploadedCover, type ArticleAction, type BatchArticle, type BatchPhase, type BatchSession, type BatchTarget, type CoverAngle, type CoverDraft, type CoverFormDraft, type CoverFormDrafts, type DirectionId, type Tweak, type UploadedCover } from './batch-session.ts';
import { coverAngleLabels, coverSuggestion, defaultBatchIds, demoArticleTitle, demoCatalog, type DemoArticle } from './batch-preview-fixtures.ts';
import BatchModuleMap from './batch-module-map';
import './batch-preview.css';

const storageKey = 'chipshow-batch-interaction-demo-v1';
const phaseLabels: Record<BatchPhase, string> = { direction: '选方向', review: '审稿', artifacts: '看成品', preflight: '交付快审' };
const phaseHints: Record<BatchPhase, string> = { direction: '先确定这批稿件怎样回答问题', review: '只看需要你决定的修改', artifacts: '确认当前采用的文章与封面', preflight: '逐篇确认本版与交付位置' };
const tweakLabels: Record<Tweak, string> = { shorter: '更简短', technical: '更专业', checklist: '增加采购清单' };
const directionIds: DirectionId[] = ['answer', 'scenario', 'compare'];

function localDay() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function readSession(): BatchSession {
  const initial = { ...createBatchSession(defaultBatchIds, 'hot-topic'), activeDay: localDay() };
  if (typeof window === 'undefined') return initial;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return initial;
    const envelope = JSON.parse(raw) as { day?: string; session?: unknown };
    const session = restoreBatchSession(JSON.stringify(envelope.session), initial);
    return envelope.day === localDay() ? { ...session, activeDay: localDay() } : { ...session, activeDay: localDay(), elapsedSeconds: 0, budgetDismissed: false };
  } catch {
    return { ...initial, message: '本机存储不可用，仍可试用。本次进度仅保留在当前页面。' };
  }
}

function readCoverFormDrafts(session: BatchSession): CoverFormDrafts {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? restoreCoverFormDrafts((JSON.parse(raw) as { coverDrafts?: unknown }).coverDrafts, session.articles) : {};
  } catch { return {}; }
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="bs-icon-button" aria-label={label} onClick={onClick}>{children}</button>;
}

function Sheet({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId(), descriptionId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = panel.current;
    target?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab' || !target) return;
      const items = [...target.querySelectorAll<HTMLElement>('button:not([disabled]), input, textarea, [tabindex="0"]')];
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === target)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, []);
  return <div className="bs-sheet-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} className="bs-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
      <header><div><p className="bs-eyebrow">当前稿件上下文</p><h2 id={titleId}>{title}</h2></div><IconButton label="关闭面板" onClick={onClose}><X size={20}/></IconButton></header>
      <p id={descriptionId} className="bs-muted">{description}</p>{children}
    </div>
  </div>;
}

function Cover({ article, cover, image, small = false }: { article: DemoArticle; cover: CoverDraft; image?: UploadedCover; small?: boolean }) {
  const title = cover.title || article.title;
  return <div className={`bs-cover bs-cover-${cover.templateVariant ?? cover.id % 3} bs-cover-angle-${cover.angle} ${small ? 'bs-cover-small' : ''} ${image ? 'bs-cover-uploaded' : ''}`} role="img" aria-label={`封面候选 ${cover.id + 1}，${title}${image ? '，本地上传图片' : ''}`}>
    {image ? <><img src={image.dataUrl} alt=""/><strong className="bs-upload-title">{title}</strong></> : <>
      <div className="bs-cover-copy"><span>CHIPSHOW · BUYER GUIDE</span><strong>{title}</strong><span className="bs-cover-caption">{coverAngleLabels[cover.angle]} / 示意封面</span></div>
      <div className="bs-screen" aria-hidden="true"><div className="bs-screen-face"><div className="bs-screen-panel"/><div className="bs-screen-panel"/><div className="bs-screen-panel"/><div className="bs-screen-panel"/></div><div className="bs-screen-base"/></div>
    </>}
    <span className="bs-cover-index">{String(cover.id + 1).padStart(2, '0')}</span>
  </div>;
}

function SourceOriginal({ article }: { article: DemoArticle }) {
  if (!article.sourcePage) return null;
  const source = article.sourcePage;
  const count = source.paragraphs.filter(paragraph => paragraph.highlight).length;
  return <details className="bs-source-original">
    <summary><BookOpen size={16}/><strong>原页面与优化位置</strong><span>{count} 处建议优化</span><ChevronDown size={16}/></summary>
    <div className="bs-source-body"><div className="bs-source-address"><span>源 URL</span><code>{source.url}</code><small>{source.label}</small></div>
      <p className="bs-source-key"><mark>高亮原句</mark> 表示本轮优化位置。原文快照保留在这里，修改后的正文另行确认。</p>
      {source.paragraphs.map((paragraph, index) => {
        const position = paragraph.highlight ? paragraph.text.indexOf(paragraph.highlight) : -1;
        return <section className="bs-source-paragraph" key={paragraph.id}>
          <span className="bs-source-number">{String(index + 1).padStart(2, '0')}</span><div><p lang="en">{position >= 0 && paragraph.highlight ? <>{paragraph.text.slice(0, position)}<mark>{paragraph.highlight}</mark>{paragraph.text.slice(position + paragraph.highlight.length)}</> : paragraph.text}</p>
            {paragraph.reason && <div className="bs-source-suggestion"><strong>为什么优化</strong><p>{paragraph.reason}</p><strong>建议改法</strong><p>{paragraph.suggestion}</p></div>}
          </div>
        </section>;
      })}
    </div>
  </details>;
}

async function prepareCoverUpload(file: File, id: string): Promise<UploadedCover> {
  const allowed = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowed.includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片。');
  if (file.size === 0 || file.size > 5 * 1024 * 1024) throw new Error('请选择 5 MB 以内的图片。');
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const signatureValid = file.type === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => header[index] === value)
    : file.type === 'image/jpeg' ? header[0] === 255 && header[1] === 216 && header[2] === 255
    : String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP';
  if (!signatureValid) throw new Error('图片格式与文件内容不符，请重新导出后上传。');
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('读取图片失败，请重试。'));
    reader.onerror = () => reject(new Error('读取图片失败，请重试。'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const result = new Image();
    result.onload = () => resolve(result);
    result.onerror = () => reject(new Error('图片无法解码，请选择另一张图片。'));
    result.src = source;
  });
  if (image.naturalWidth < 320 || image.naturalHeight < 180) throw new Error('图片至少需要 320 × 180 像素，建议使用 16:9 横图。');
  if (image.naturalWidth > 8192 || image.naturalHeight > 8192 || image.naturalWidth * image.naturalHeight > 20_000_000) throw new Error('图片尺寸过大，请缩小到 8192 像素、2000 万像素以内再上传。');
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(1280, Math.max(320, image.naturalWidth));
  canvas.height = Math.round(canvas.width * 9 / 16);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前环境无法生成轻量预览，请换一张较小图片。');
  let dataUrl = '', bytes = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    context.fillStyle = '#f5f7f6';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    dataUrl = canvas.toDataURL('image/jpeg', 0.82 - attempt * 0.18);
    bytes = atob(dataUrl.split(',')[1] ?? '').length;
    if (bytes <= 200_000) break;
  }
  if (bytes > 200_000 || bytes === 0) throw new Error('图片仍较大，请选择更简单或更小的图片后重试。');
  const prepared: UploadedCover = { id, name: file.name.slice(0, 160) || 'cover.jpg', mimeType: 'image/jpeg', dataUrl, width: canvas.width, height: canvas.height, bytes };
  if (!validateUploadedCover(prepared)) throw new Error('轻量预览未通过校验，请重新导出图片后再试。');
  return prepared;
}

function CoverEditor({ article, progress, draft, onDraftChange, onSave, onNew, onAdopt, onUpload }: {
  article: DemoArticle; progress: BatchArticle;
  draft?: CoverFormDraft; onDraftChange: (draft: CoverFormDraft | null) => void;
  onSave: (draft: CoverFormDraft) => void;
  onNew: () => void; onAdopt: () => void; onUpload: (file: File) => Promise<void>;
}) {
  const cover = progress.covers.find(candidate => candidate.id === progress.coverCandidate)!;
  const { title, angle, requirement } = draft ?? cover;
  const changeDraft = (patch: Partial<CoverFormDraft>) => onDraftChange({ title, angle, requirement, ...patch });
  const [uploadError, setUploadError] = useState('');
  const mounted = useRef(true);
  const adoptButton = useRef<HTMLButtonElement>(null), editor = useRef<HTMLDivElement>(null);
  const inputId = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dirty = title !== cover.title || angle !== cover.angle || requirement !== cover.requirement;
  useEffect(() => {
    if (cover.id > 0) (adoptButton.current && !adoptButton.current.disabled ? adoptButton.current : editor.current)?.focus({ preventScroll: true });
  }, [cover.id]);
  const pending = !!progress.uploadRequestId;
  const preview = { ...cover, title, angle, requirement };
  return <div className="bs-cover-editor" ref={editor} tabIndex={-1}>
    <Cover article={article} cover={preview} image={cover.imageId ? progress.coverAssets[cover.imageId] : undefined}/>
    <div className="bs-cover-actions"><button type="button" className="bs-button" disabled={pending || dirty} onClick={onNew}><RotateCcw size={14}/> 换个示意排版</button><label className={`bs-button bs-upload-button ${pending || dirty ? 'bs-upload-disabled' : ''}`} htmlFor={inputId}><Upload size={14}/>{pending ? '处理图片中' : '上传自己的封面'}</label><input id={inputId} className="bs-sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={pending || dirty} onChange={async event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (!file) return;
      setUploadError('');
      try { await onUpload(file); } catch (error) { if (mounted.current) setUploadError(error instanceof Error ? error.message : '图片处理失败，请重试。'); }
    }}/></div>
    <p className="bs-upload-help">PNG、JPEG、WebP，5 MB 内。按 16:9 完整展示，空余留白；仅保存本机轻量预览，原图请自行保留。</p>
    {uploadError && <p className="bs-upload-error" role="alert">{uploadError}</p>}
    {pending && <p className="bs-upload-progress" role="status">正在准备候选。当前采用版保留；离开本稿会取消这次上传。</p>}
    <label className="bs-cover-field">封面标题 <input type="text" value={title} maxLength={140} placeholder={article.title} disabled={pending} onChange={event => changeDraft({ title: event.target.value })}/></label>
    <fieldset className="bs-cover-angles"><legend>素材角度</legend><div>{(Object.keys(coverAngleLabels) as CoverAngle[]).map(option => <button type="button" key={option} className={`bs-chip ${angle === option ? 'bs-chip-selected' : ''}`} aria-pressed={angle === option} disabled={pending} onClick={() => changeDraft({ angle: option })}>{angle === option && <Check size={13}/>} {coverAngleLabels[option]}</button>)}</div></fieldset>
    <div className="bs-material-brief"><strong>建议准备这类素材</strong><p>{coverSuggestion(article, angle)}</p></div>
    <label className="bs-cover-field">补充图片要求 <span>选填</span><textarea value={requirement} maxLength={1000} rows={3} disabled={pending} placeholder="例如：保留屏幕真实主体；标题放左上角；使用现场拍摄图。" onChange={event => changeDraft({ requirement: event.target.value })}/></label>
    {dirty && <p className="bs-cover-dirty">编辑草稿已暂存，返回或换稿后可接着改。保存为新候选后即可采用，原采用版保留。</p>}
    <div className="bs-cover-save-actions">{dirty && <><button type="button" className="bs-button" onClick={() => onDraftChange(null)}>撤销未保存修改</button><button type="button" className="bs-button bs-button-primary" onClick={() => onSave({ title, angle, requirement })}>保存为新候选</button></>}{!dirty && <button ref={adoptButton} type="button" className="bs-button bs-button-primary" disabled={pending || progress.adoptedCover === cover.id} onClick={onAdopt}>{progress.adoptedCover === cover.id ? <><Check size={15}/> 当前已采用</> : '采用这一版'}</button>}</div>
    <p className="bs-cover-edit-note">标题与示意排版实时预览。素材要求随候选保留，本演示未调用图片生成服务。</p>
  </div>;
}

function ArticleText({ article, progress }: { article: DemoArticle; progress: BatchArticle }) {
  const narrowed = progress.reviewChoice === 'narrow';
  return <article className="bs-english-preview" lang="en">
    <p className="bs-eyebrow">ENGLISH DRAFT · DEMO</p><h3>{demoArticleTitle(article, progress.reviewChoice)}</h3>
    <p>{progress.reviewChoice ? article.patch : article.original}</p>
    {narrowed ? <><h4>Questions to confirm with your supplier</h4><ul>{article.checklist.map(item => <li key={item}>{item}</li>)}</ul><p>Use these questions to prepare a supplier enquiry. Product-specific performance and suitability need separate confirmation.</p></> : article.body.map(block => <section key={block.heading}><h4>{block.heading}</h4><p>{block.text}</p></section>)}
    <p className="bs-draft-notice" lang="zh-CN">演示内容，尚未核验真实来源，不用于发布。</p>
  </article>;
}

export default function BatchPreview() {
  const [session, dispatch] = useReducer(batchReducer, undefined, readSession);
  const [coverDrafts, setCoverDrafts] = useState<CoverFormDrafts>(() => readCoverFormDrafts(session));
  const [sheet, setSheet] = useState<'evidence' | 'batch' | 'hot' | null>(null);
  const [skipIds, setSkipIds] = useState<string[]>([]);
  const [testReminder, setTestReminder] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [idle, setIdle] = useState(false);
  const lastActivity = useRef(0), focusHeading = useRef<HTMLHeadingElement>(null), firstRender = useRef(true);
  const current = session.currentId ? demoCatalog[session.currentId] : null;
  const progress = session.currentId ? session.articles[session.currentId] : null;
  const ids = activeArticleIds(session);
  const complete = phaseComplete(session);
  const deferred = session.order.filter(id => session.articles[id].deferred);
  const phase = session.phase === 'finished' ? null : session.phase;
  const completedCount = phase ? ids.filter(id => articleComplete(session.articles[id], phase)).length : ids.length;
  const target: BatchTarget | null = current && progress && phase ? { articleId: current.id, phase, revision: progress.revision } : null;
  const minutes = Math.floor(session.elapsedSeconds / 60), seconds = session.elapsedSeconds % 60;
  const reminder = testReminder || session.elapsedSeconds >= 25 * 60 && !session.budgetDismissed;
  const send = (action: ArticleAction) => { if (target) dispatch({ ...action, target }); };
  const adoptedCover = progress?.covers.find(cover => cover.id === progress.adoptedCover);
  const selectedCover = progress?.covers.find(cover => cover.id === progress.coverCandidate);
  const formDraft = current && progress ? coverDrafts[coverFormKey(current.id, progress.coverCandidate)] : undefined;
  const coverDirty = phase === 'artifacts' && !!formDraft && !!selectedCover && (formDraft.title !== selectedCover.title || formDraft.angle !== selectedCover.angle || formDraft.requirement !== selectedCover.requirement);
  const uploadCover = async (file: File) => {
    if (!target || !progress) return;
    const uploadTarget = { ...target }, candidate = progress.coverCandidate;
    const requestId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    dispatch({ type: 'start_cover_upload', target: uploadTarget, candidate, requestId });
    try {
      const image = await prepareCoverUpload(file, requestId);
      dispatch({ type: 'complete_cover_upload', target: uploadTarget, candidate, requestId, image });
    } catch (error) {
      dispatch({ type: 'cancel_cover_upload', target: uploadTarget, requestId });
      throw error;
    }
  };

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ day: session.activeDay ?? localDay(), session, coverDrafts })); setStorageAvailable(true); }
    catch { setStorageAvailable(false); }
  }, [session, coverDrafts]);
  useEffect(() => {
    lastActivity.current = Date.now();
    const activity = () => { lastActivity.current = Date.now(); setIdle(false); dispatch({ type: 'rollover_day', day: localDay() }); };
    const visibility = () => { if (document.visibilityState === 'visible') activity(); };
    let previous = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      dispatch({ type: 'rollover_day', day: localDay() });
      const active = document.visibilityState === 'visible' && now - lastActivity.current < 60_000;
      setIdle(!active);
      if (active) dispatch({ type: 'tick', seconds: Math.max(0, Math.min(2, Math.floor((now - previous) / 1000))) });
      previous = now;
    }, 1000);
    window.addEventListener('pointerdown', activity);
    window.addEventListener('keydown', activity);
    window.addEventListener('scroll', activity, { passive: true });
    document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(timer); window.removeEventListener('pointerdown', activity); window.removeEventListener('keydown', activity); window.removeEventListener('scroll', activity); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    focusHeading.current?.focus({ preventScroll: true });
  }, [session.currentId, session.phase, session.paused]);

  return <div className="bs-app" onClickCapture={event => { if (event.detail > 1 && event.target instanceof Element && event.target.closest('button.bs-button-primary, .bs-decision-bar button')) event.stopPropagation(); }}>
    <a className="bs-skip-link" href="#batch-workspace">跳到当前操作</a>
    <header className="bs-topbar">
      <div className="bs-brand"><span className="bs-brand-symbol" aria-hidden="true"><Layers3 size={22}/></span><strong>Chipshow <span>Studio</span></strong><span className="bs-demo-badge">交互演示 · 未连接生产</span></div>
      <div className="bs-top-actions"><span className="bs-local-save"><span/>{storageAvailable ? '演示进度保留在本机' : '仅保留在当前页面'}</span><button type="button" className="bs-button bs-button-quiet" onClick={() => dispatch({ type: session.paused ? 'resume' : 'pause' })}>{session.paused ? <Play size={15}/> : <Pause size={15}/>} {session.paused ? '继续操作' : '今天到这里'}</button></div>
    </header>
    <div className="bs-main">
      <section className="bs-page-heading"><div><p className="bs-eyebrow">YOUR EDITORIAL WORKSPACE</p><h1>把值得做的内容，一批做完。</h1><p>先一起选方向，再一起审稿和看成品。每篇都由你决定。</p></div><div className="bs-budget"><div><Clock3 size={16}/><span>{session.paused ? '已暂停' : idle ? '已停止计时' : '主动操作'} <strong>{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}</strong></span></div><p>每日预算 15 至 30 分钟</p><button type="button" onClick={() => setTestReminder(true)}>试一下收尾提醒</button></div></section>
      {reminder && <section className="bs-reminder" aria-label="收尾提醒"><Clock3 size={20}/><div><strong>{testReminder ? '提醒效果演示：接近今天的时间预算' : '已接近今天的时间预算'}</strong><p>{testReminder ? '实际计时未改变。' : ''}可以收好进度，也可以继续。不会自动批准或交付。</p></div><div className="bs-inline-actions"><button type="button" className="bs-button" onClick={() => { if (!testReminder) dispatch({ type: 'dismiss_budget' }); setTestReminder(false); }}>继续操作</button><button type="button" className="bs-button bs-button-primary" onClick={() => { setTestReminder(false); dispatch({ type: 'pause' }); }}>收好进度</button></div></section>}
      {session.interrupted && <section className="bs-interruption"><Zap size={18}/><span><strong>正在处理插队热点</strong> 原批次的选择和位置已经保留。</span><button type="button" onClick={() => dispatch({ type: 'return_to_batch' })}><ArrowLeft size={15}/> 回到原批次</button></section>}
      {!storageAvailable && <section className="bs-storage-warning" role="alert"><strong>当前进度尚未保存到本机。</strong><p>浏览器存储空间不足或被禁用。页面仍可继续使用，关闭前请保留原图和本次选择。</p></section>}
      <div className="bs-workbench">
        <aside className="bs-queue" aria-label="本批稿件">
          <div className="bs-queue-heading"><div><p className="bs-eyebrow">{session.interrupted ? '临时插队' : '本轮小批次'}</p><h2>{ids.length} 篇{session.interrupted ? '热点' : '稿件'}</h2></div><IconButton label="管理本批与批量跳过" onClick={() => setSheet('batch')}><ListFilter size={18}/></IconButton></div>
          <p className="bs-queue-hint">流量机会相近时，省时的先做。</p>
          <ol className="bs-queue-list">{ids.map((id, index) => {
            const item = demoCatalog[id], state = session.articles[id];
            const done = phase ? articleComplete(state, phase) : state.delivered;
            return <li key={id}><button type="button" className={`bs-queue-item ${id === session.currentId ? 'bs-is-current' : ''}`} onClick={() => dispatch({ type: 'open_article', id })} disabled={session.paused} aria-current={id === session.currentId ? 'step' : undefined}>
              <span className={`bs-order ${done ? 'bs-is-done' : ''}`}>{done ? <Check size={14}/> : String(index + 1).padStart(2, '0')}</span><span className="bs-queue-copy"><span className="bs-queue-meta">{item.type}<span>{done ? '本步已确认' : `约 ${item.effort} 分钟`}</span></span><strong>{item.title}</strong><span className="bs-queue-opportunity">{item.opportunity}<span>示例</span></span></span><ChevronRight size={15}/>
            </button></li>;
          })}</ol>
          {ids.length === 0 && <p className="bs-muted">本轮已全部移出，稿件仍在暂存区。</p>}
          <button type="button" className="bs-hot-button" disabled={session.paused || !!session.interrupted || session.articles[session.hotId].delivered} onClick={() => setSheet('hot')}><Zap size={17}/><span>{session.articles[session.hotId].delivered ? '热点演示已完成' : '临时插队一条热点'}</span><span className="bs-small-label">试用</span></button>
          <button type="button" className="bs-deferred-link" onClick={() => setSheet('batch')}><RotateCcw size={14}/> 本轮移出的稿件 <strong>{deferred.length}</strong></button>
          <p className="bs-demo-note">选题、潜力分组、耗时和正文均为演示样例。没有读取真实流量或稿件。</p>
        </aside>
        <main id="batch-workspace" className="bs-workspace">
          <nav className="bs-steps" aria-label="本批次阶段">{batchPhases.map((step, index) => {
            const currentIndex = phase ? batchPhases.indexOf(phase) : 4;
            const done = ids.length > 0 && ids.every(id => articleComplete(session.articles[id], step));
            return <button type="button" key={step} disabled={session.paused || !canVisitPhase(session, step)} onClick={() => dispatch({ type: 'navigate_phase', phase: step })} className={`${index === currentIndex ? 'bs-step-active' : ''} ${done ? 'bs-step-complete' : ''}`} aria-current={step === phase ? 'step' : undefined} title={canVisitPhase(session, step) ? `回看或修改${phaseLabels[step]}` : '先完成前一步的确认'}><span>{done ? <Check size={14}/> : index + 1}</span><strong>{phaseLabels[step]}</strong></button>;
          })}</nav>
          <div className="bs-live-status" role="status" aria-live="polite">{session.message || '本批 4 篇示例已备好，先选方向。你不需要填写提示词。'}</div>
          {session.paused ? <section className="bs-completion"><span className="bs-completion-icon"><Pause size={28}/></span><p className="bs-eyebrow">PROGRESS SAVED</p><h2 ref={focusHeading} tabIndex={-1}>先停在这里，也没关系。</h2><p>{storageAvailable ? '本机已保留你的方向、修改选择和已采用封面。' : '进度保留在当前页面，关闭后可能丢失。'}继续时会回到刚才的位置。</p><button type="button" className="bs-button bs-button-primary" onClick={() => dispatch({ type: 'resume' })}><Play size={16}/> 继续上次的操作</button></section>
          : session.phase === 'finished' ? <section className="bs-completion"><span className="bs-completion-icon"><CheckCheck size={32}/></span><p className="bs-eyebrow">BATCH COMPLETE · DEMO ONLY</p><h2 ref={focusHeading} tabIndex={-1}>这一批，处理完了。</h2><p>{ids.length} 篇已完成交付演示。没有创建真实草稿，没有公开发布。</p><div className="bs-finished-list">{ids.map(id => <div key={id}><Check size={16}/><span>{demoCatalog[id].title}</span><span>演示完成</span></div>)}</div>{deferred.length > 0 && <button type="button" className="bs-button" onClick={() => setSheet('batch')}>查看 {deferred.length} 篇暂存稿</button>}</section>
          : ids.length === 0 ? <section className="bs-completion"><span className="bs-completion-icon"><Layers3 size={30}/></span><h2 ref={focusHeading} tabIndex={-1}>这批先不做，也可以。</h2><p>跳过只移出本轮。已选方向和成品没有被删除，也没有记为交付。</p><button type="button" className="bs-button bs-button-primary" onClick={() => setSheet('batch')}>从暂存稿中放回</button></section>
          : !current || !progress || !phase ? <section className="bs-completion"><span className="bs-completion-icon"><CheckCheck size={30}/></span><p className="bs-eyebrow">ONE STEP AT A TIME</p><h2 ref={focusHeading} tabIndex={-1}>本批{phase ? phaseLabels[phase] : ''}已完成。</h2><p>{completedCount} 篇逐篇确认完毕。接下来集中处理下一环节。</p>{phase && <button type="button" className="bs-button bs-button-primary" onClick={() => dispatch({ type: 'next_phase', phase })}>{phase === 'preflight' ? '查看本批结果' : `一起进入${phaseLabels[batchPhases[batchPhases.indexOf(phase) + 1]]}`}<ArrowRight size={16}/></button>}</section>
          : <>
            <header className="bs-task-heading"><div className="bs-task-kicker"><span>{current.type}</span><span>{phaseLabels[phase]} · 已确认 {completedCount}/{ids.length}</span></div><h2 ref={focusHeading} tabIndex={-1}>{current.title}</h2><p>{phaseHints[phase]}</p></header>
            <div className="bs-revisit-actions"><div>{batchPhases.indexOf(phase) > 0 && <button type="button" className="bs-text-button" onClick={() => dispatch({ type: 'navigate_phase', phase: batchPhases[batchPhases.indexOf(phase) - 1] })}><ArrowLeft size={15}/> 返回{phaseLabels[batchPhases[batchPhases.indexOf(phase) - 1]]}</button>}<span>可以回看和修改，已有选择随稿保留。</span></div>{articleComplete(progress, phase) && <button type="button" className="bs-text-button" onClick={() => send({ type: 'revoke_confirmation' })}><RotateCcw size={14}/> 撤销本步确认</button>}</div>
            <section className="bs-summary" aria-label="中文决策摘要"><div><span>帮助谁</span><p>{current.reader}</p></div><div><span>解决什么</span><p>{progress.reviewChoice === 'narrow' ? current.narrowerQuestion : current.question}</p></div><div><span>现在决定</span><p>{phase === 'direction' ? '选择一个表达方向，按需补充偏好。' : phase === 'review' ? '确认原句如何改，或明确缩小范围。' : phase === 'artifacts' ? '选一张封面，再确认当前成品。' : '核对当前采用版本与草稿位置。'}</p></div></section>
            <SourceOriginal key={`${current.id}-${phase}`} article={current}/>
            {phase === 'direction' && <div className="bs-stage-content">
              <div className="bs-section-title"><h3>这篇怎样讲，最有用？</h3><button type="button" className="bs-text-button" onClick={() => send({ type: 'shuffle_directions' })}><RotateCcw size={14}/> 换一组表达</button></div>
              <fieldset className="bs-directions"><legend className="bs-sr-only">选择文章方向</legend>{directionIds.map((id, index) => {
                const direction = current.directions[id];
                const extra = progress.directionRound % 2 !== 0;
                return <label className={`bs-direction ${progress.direction === id ? 'bs-selected' : ''}`} key={id}><input type="radio" name={`direction-${current.id}`} checked={progress.direction === id} onChange={() => send({ type: 'select_direction', id })}/><span className="bs-choice-top"><span className="bs-choice-letter">{String.fromCharCode(65 + index)}</span>{index === 0 && <span className="bs-recommend">推荐</span>}<span className="bs-radio" aria-hidden="true">{progress.direction === id && <span/>}</span></span><strong>{extra ? ['从买家最后要做的决定开始', '从现场要核对的细节开始', '从两套方案的差异开始'][index] : direction.label}</strong><p>{direction.reason}</p><span className="bs-outline-label">大纲预览</span><ol>{(extra ? [...direction.outline].reverse() : direction.outline).map(item => <li key={item}>{item}</li>)}</ol></label>;
              })}</fieldset>
              {progress.direction && <button type="button" className="bs-text-button bs-clear-choice" onClick={() => send({ type: 'clear_direction' })}><X size={14}/> 清除方向选择</button>}
              <div className="bs-tweaks"><h4>还想怎样调整？ <span>选填，可多选</span></h4><div>{(Object.keys(tweakLabels) as Tweak[]).map(tweak => <button key={tweak} type="button" aria-pressed={progress.tweaks.includes(tweak)} className={`bs-chip ${progress.tweaks.includes(tweak) ? 'bs-chip-selected' : ''}`} onClick={() => send({ type: 'toggle_tweak', tweak })}>{progress.tweaks.includes(tweak) ? <Check size={13}/> : <span aria-hidden="true">+</span>}{tweakLabels[tweak]}</button>)}</div></div>
              <details className="bs-optional"><summary>补充一句特殊要求 <span>选填</span><ChevronDown size={14}/></summary><label className="bs-sr-only" htmlFor="batch-note">特殊要求，最多 500 字</label><textarea id="batch-note" value={progress.note} maxLength={500} rows={2} placeholder="例如：让经销商也能直接转给终端客户。留空不影响推进。" onChange={event => send({ type: 'set_note', note: event.target.value })}/></details>
              <div className="bs-why"><Sparkles size={16}/><p>{current.reason}</p></div>
            </div>}
            {phase === 'review' && <div className="bs-stage-content">
              <div className="bs-section-title"><h3>这处表述，需要你选一下</h3><button type="button" className="bs-text-button" onClick={() => setSheet('evidence')}><BookOpen size={15}/> 看核对依据</button></div>
              <div className="bs-original"><span>待确认原句</span><p lang="en">{current.original}</p><small>原句承诺过大，建议补充适用条件。</small></div>
              <fieldset className="bs-review-choices"><legend className="bs-sr-only">选择修改方案</legend><label className={`bs-review-choice ${progress.reviewChoice === 'patch' ? 'bs-selected' : ''}`}><input type="radio" name={`review-${current.id}`} checked={progress.reviewChoice === 'patch'} onChange={() => send({ type: 'select_review', choice: 'patch' })}/><span className="bs-choice-top"><strong>采用带条件的建议</strong><span className="bs-recommend">推荐</span><span className="bs-radio" aria-hidden="true">{progress.reviewChoice === 'patch' && <span/>}</span></span><p lang="en">{current.patch}</p><small>保留原买家问题，只修正这一处表达。</small></label><label className={`bs-review-choice ${progress.reviewChoice === 'narrow' ? 'bs-selected' : ''}`}><input type="radio" name={`review-${current.id}`} checked={progress.reviewChoice === 'narrow'} onChange={() => send({ type: 'select_review', choice: 'narrow' })}/><span className="bs-choice-top"><strong>改成一篇更聚焦的核对清单</strong><span className="bs-scope-badge">范围变化</span><span className="bs-radio" aria-hidden="true">{progress.reviewChoice === 'narrow' && <span/>}</span></span><p>仍要回答：{current.narrowerQuestion}</p><small>这次不写：{current.omitted}</small></label></fieldset>
              {progress.reviewChoice && <button type="button" className="bs-text-button bs-clear-choice" onClick={() => send({ type: 'clear_review' })}><X size={14}/> 清除本次修改选择</button>}
              {progress.reviewChoice === 'narrow' && <p className="bs-scope-note">你将明确确认范围变化。系统会将成品收窄为核对清单，并保留具体买家问题。</p>}
              <div className="bs-tweaks"><h4>还想怎样调整？ <span>选填，可多选</span></h4><div>{(Object.keys(tweakLabels) as Tweak[]).map(tweak => <button key={tweak} type="button" aria-pressed={progress.tweaks.includes(tweak)} className={`bs-chip ${progress.tweaks.includes(tweak) ? 'bs-chip-selected' : ''}`} onClick={() => send({ type: 'toggle_tweak', tweak })}>{progress.tweaks.includes(tweak) ? <Check size={13}/> : <span aria-hidden="true">+</span>}{tweakLabels[tweak]}</button>)}</div></div>
              <details className="bs-optional"><summary>补充一句修改要求 <span>选填</span><ChevronDown size={14}/></summary><label className="bs-sr-only" htmlFor="review-note">修改要求，最多 500 字</label><textarea id="review-note" value={progress.note} maxLength={500} rows={2} placeholder="例如：保留采购前必须核对的条件。留空不影响确认。" onChange={event => send({ type: 'set_note', note: event.target.value })}/></details>
              <p className="bs-recorded-preferences">已记录方向：{current.directions[progress.direction ?? 'answer'].label}{progress.tweaks.length > 0 ? ` · ${progress.tweaks.map(tweak => tweakLabels[tweak]).join('、')}` : ''}{progress.note ? ` · 补充：${progress.note}` : ''}。正文采用固定演示样例，本次没有按偏好调用模型。</p><details className="bs-full-article"><summary><FileText size={16}/> 展开当前英文稿 <ChevronDown size={15}/></summary><ArticleText article={current} progress={progress}/></details>
            </div>}
            {phase === 'artifacts' && <div className="bs-stage-content">
              <div className="bs-section-title"><h3>同一篇稿件，都在这里</h3><span className="bs-small-label">稿件版本 {progress.revision}</span></div>
              <div className="bs-artifact-grid">
                <div className="bs-article-mini"><div className="bs-artifact-label"><FileText size={16}/> 文章 <span className="bs-good-label"><Check size={12}/> 已确认</span></div><h3 lang="en">{demoArticleTitle(current, progress.reviewChoice)}</h3><p>{progress.reviewChoice === 'narrow' ? current.narrowerQuestion : current.answer}</p><div className="bs-paragraph-lines" aria-hidden="true"><span/><span/><span/><span/></div><details className="bs-full-article"><summary>展开全文 <ChevronDown size={14}/></summary><ArticleText article={current} progress={progress}/></details><button type="button" className="bs-text-button" onClick={() => dispatch({ type: 'navigate_phase', phase: 'review' })}><ArrowLeft size={14}/> 返回审稿修改正文</button></div>
                <div className="bs-cover-panel"><div className="bs-artifact-label">封面候选 <span className="bs-small-label">第 {progress.coverCandidate + 1} 版</span></div>
                  <CoverEditor key={`${current.id}-${progress.coverCandidate}`} article={current} progress={progress} draft={formDraft}
                    onDraftChange={draft => setCoverDrafts(saved => setCoverFormDraft(saved, current.id, progress.coverCandidate, draft))}
                    onSave={draft => {
                      send({ type: 'edit_cover_candidate', candidate: progress.coverCandidate, ...draft });
                      setCoverDrafts(saved => setCoverFormDraft(saved, current.id, progress.coverCandidate, null));
                    }}
                    onNew={() => send({ type: 'new_cover_candidate' })} onAdopt={() => send({ type: 'adopt_cover', candidate: progress.coverCandidate })} onUpload={uploadCover}/>
                  {progress.covers.length > 1 && <details className="bs-cover-history"><summary>候选历史 · {progress.covers.length} 版 <ChevronDown size={14}/></summary><div>{progress.covers.map(cover => <button type="button" key={cover.id} className={cover.id === progress.coverCandidate ? 'bs-history-selected' : ''} aria-pressed={cover.id === progress.coverCandidate} onClick={() => send({ type: 'select_cover_candidate', candidate: cover.id })}><Cover article={current} cover={cover} image={cover.imageId ? progress.coverAssets[cover.imageId] : undefined} small/><span>第 {cover.id + 1} 版 {cover.id === progress.adoptedCover ? '· 已采用' : ''}</span></button>)}</div></details>}
                </div>
              </div>
              {adoptedCover && <div className="bs-adopted"><Cover article={current} cover={adoptedCover} image={adoptedCover.imageId ? progress.coverAssets[adoptedCover.imageId] : undefined} small/><div><strong>当前采用 · 封面第 {adoptedCover.id + 1} 版</strong><p>{progress.adoptedCover === progress.coverCandidate ? '这张封面会进入交付演示。' : '新候选尚未采用。交付仍保留这张封面。'}正文和其他稿件均未改动。</p>{adoptedCover.requirement && <p>素材要求：{adoptedCover.requirement}</p>}<button type="button" className="bs-text-button" onClick={() => send({ type: 'revoke_cover_adoption' })}><RotateCcw size={13}/> 撤销采用，保留候选</button></div><CheckCheck size={20}/></div>}
              <div className="bs-inline-info"><Layers3 size={16}/><p>本轮先确认文章与封面。图文卡片和更多渠道继续复用同一稿件，本演示不模拟已上线的社媒发布。</p></div>
            </div>}
            {phase === 'preflight' && <div className="bs-stage-content"><div className="bs-section-title"><h3>只确认这一篇</h3><span className="bs-good-label"><Check size={14}/> 当前版本已采用</span></div><div className="bs-preflight-grid"><div><span>本版改了什么</span><strong>{progress.reviewChoice === 'narrow' ? '范围收窄为买家核对清单' : '修正一处过度承诺'}</strong><p>稿件版本 {progress.revision} · 封面第 {(progress.adoptedCover ?? 0) + 1} 版</p></div><div><span>还有什么待办</span><strong>本演示内的选择已完成</strong><p>真实信源、目标站点与发布权限未连接。</p></div><div><span>交到哪里</span><strong>WordPress 英文草稿</strong><p>{current.type === '升级旧页' ? '独立影子草稿，保留原公开页。' : '新建草稿，不公开发布。'}本次仅演示。</p></div></div><div className="bs-final-artifact">{adoptedCover && <Cover article={current} cover={adoptedCover} image={adoptedCover.imageId ? progress.coverAssets[adoptedCover.imageId] : undefined} small/>}<div><span className="bs-eyebrow">CURRENT ADOPTED VERSION</span><h3 lang="en">{demoArticleTitle(current, progress.reviewChoice)}</h3><p>点击后仅记录演示完成，不会调用 WordPress。</p></div></div><details className="bs-full-article"><summary><FileText size={15}/> 再看一次英文稿 <ChevronDown size={15}/></summary><ArticleText article={current} progress={progress}/></details></div>}
            {phase === 'artifacts' && coverDirty && <p className="bs-unsaved-notice" role="status">封面有未保存修改。请先保存为新候选，或撤销修改，再确认成品。</p>}
            <footer className="bs-decision-bar"><div className="bs-secondary-actions"><button type="button" className="bs-text-button" onClick={() => dispatch({ type: 'defer_articles', ids: [current.id], reason: 'skip' })}>这篇先跳过</button>{phase !== 'preflight' && <button type="button" className="bs-text-button" onClick={() => dispatch({ type: 'defer_articles', ids: [current.id], reason: 'verify' })}>转核验</button>}</div><div className="bs-primary-action"><span>确认后自动带出下一篇</span>{complete ? <button type="button" className="bs-button bs-button-primary" disabled={phase === 'artifacts' && coverDirty} onClick={() => dispatch({ type: 'next_phase', phase })}>{phase === 'preflight' ? '查看本批结果' : `进入${phaseLabels[batchPhases[batchPhases.indexOf(phase) + 1]]}`}<ArrowRight size={16}/></button> : phase === 'direction' ? <button type="button" className="bs-button bs-button-primary" disabled={!progress.direction} onClick={() => send({ type: 'confirm_direction' })}>采用这个方向<ArrowRight size={16}/></button> : phase === 'review' ? <button type="button" className="bs-button bs-button-primary" disabled={!progress.reviewChoice} onClick={() => send({ type: 'confirm_review' })}>{progress.reviewChoice === 'narrow' ? '确认缩小范围' : '确认这次修改'}<ArrowRight size={16}/></button> : phase === 'artifacts' ? <button type="button" className="bs-button bs-button-primary" disabled={progress.adoptedCover === null || !!progress.uploadRequestId || coverDirty} onClick={() => { if (progress.adoptedCover !== null) send({ type: 'confirm_artifacts', cover: progress.adoptedCover }); }}>确认当前成品<ArrowRight size={16}/></button> : <button type="button" className="bs-button bs-button-primary" onClick={() => send({ type: 'confirm_delivery' })}>模拟交付这一篇<ArrowUpRight size={16}/></button>}</div></footer>
          </>}
        </main>
      </div>
      <footer className="bs-page-footer"><span>操作只影响演示进度。预览不连接模型、采集器或 WordPress。</span><span>计时为估算，切到后台或 60 秒无操作暂停累计。</span></footer>
      <details className="bs-module-overview"><summary><Layers3 size={17}/><strong>全模块依赖</strong><span>查看 Studio 与采集、内容、分发及流量复盘的关系</span><ChevronDown size={17}/></summary><BatchModuleMap/></details>
    </div>
    {sheet === 'evidence' && current && <Sheet title="这处为什么需要确认？" description="核对依据贴着原句看，不离开当前稿件。" onClose={() => setSheet(null)}><div className="bs-evidence-card"><span className="bs-scope-badge">演示核对项</span><h3>原句</h3><p lang="en">{current.original}</p><h3>需要保留的条件</h3><p>{current.evidence}</p><h3>建议修改</h3><p lang="en">{current.patch}</p></div><p className="bs-demo-note">真实产品将显示原始来源、证据段落和版本。本预览没有装载这些资料，不显示伪造的已核实标记。</p></Sheet>}
    {sheet === 'batch' && <Sheet title="调整本轮稿件" description="移出本轮保留已做的选择。暂存稿可以随时放回。" onClose={() => { setSheet(null); setSkipIds([]); }}><h3 className="bs-sheet-section-title">本轮稿件</h3><div className="bs-manage-list">{ids.map(id => <label key={id}><input type="checkbox" checked={skipIds.includes(id)} onChange={() => setSkipIds(currentIds => currentIds.includes(id) ? currentIds.filter(v => v !== id) : [...currentIds, id])}/><span><strong>{demoCatalog[id].title}</strong><small>{demoCatalog[id].type} · 已做的选择保留</small></span></label>)}</div><button type="button" className="bs-button bs-button-primary" disabled={skipIds.length === 0 || session.paused} onClick={() => { dispatch({ type: 'defer_articles', ids: skipIds, reason: 'skip' }); setSkipIds([]); setSheet(null); }}>移出本轮 {skipIds.length > 0 ? `${skipIds.length} 篇` : ''}</button><h3 className="bs-sheet-section-title">已移出本轮 · {deferred.length} 篇</h3>{deferred.length === 0 && <p className="bs-muted">暂时没有。移出不会删除稿件。</p>}{deferred.map(id => <div className="bs-restore-row" key={id}><div><strong>{demoCatalog[id].title}</strong><small>{session.articles[id].deferred === 'verify' ? '等待核验' : '本轮跳过'}</small></div><button type="button" className="bs-button" disabled={session.paused || !!session.interrupted} onClick={() => { dispatch({ type: 'restore_article', id }); setSheet(null); }}>放回本轮</button></div>)}</Sheet>}
    {sheet === 'hot' && <Sheet title="先处理一条临时热点" description="本批次会停在当前位置。热点处理完或暂存后，再接着做。" onClose={() => setSheet(null)}><div className="bs-hot-preview"><span className="bs-scope-badge">虚构热点，只演示交互</span><h3>{demoCatalog['hot-topic'].title}</h3><p>{demoCatalog['hot-topic'].question}</p><ul><li>原批次的选择、封面与进度保留。</li><li>热点仍需选方向、审稿和确认成品。</li><li>可以随时返回，不必把热点做完。</li></ul></div><button type="button" className="bs-button bs-button-primary" onClick={() => { dispatch({ type: 'interrupt' }); setSheet(null); }}><Zap size={16}/> 先处理这条热点</button></Sheet>}
  </div>;
}
