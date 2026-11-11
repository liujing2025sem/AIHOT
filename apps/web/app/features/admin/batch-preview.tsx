import { useEffect, useId, useReducer, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCheck, ChevronDown, ChevronRight, Clock3, FileText, Layers3, ListFilter, Pause, Play, RotateCcw, Sparkles, X, Zap } from 'lucide-react';
import { activeArticleIds, articleComplete, batchPhases, batchReducer, createBatchSession, phaseComplete, restoreBatchSession, type ArticleAction, type BatchArticle, type BatchPhase, type BatchSession, type BatchTarget, type DirectionId, type Tweak } from './batch-session.ts';
import { defaultBatchIds, demoArticleTitle, demoCatalog, type DemoArticle } from './batch-preview-fixtures.ts';
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
  const initial = createBatchSession(defaultBatchIds, 'hot-topic');
  if (typeof window === 'undefined') return initial;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return initial;
    const envelope = JSON.parse(raw) as { day?: string; session?: unknown };
    const session = restoreBatchSession(JSON.stringify(envelope.session), initial);
    return envelope.day === localDay() ? session : { ...session, elapsedSeconds: 0, budgetDismissed: false };
  } catch {
    return { ...initial, message: '本机存储不可用，仍可试用。本次进度仅保留在当前页面。' };
  }
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

function Cover({ article, variant, small = false }: { article: DemoArticle; variant: number; small?: boolean }) {
  return <div className={`bs-cover bs-cover-${variant % 3} ${small ? 'bs-cover-small' : ''}`} role="img" aria-label={`封面候选 ${variant + 1}，${article.title}`}>
    <div className="bs-cover-copy"><span>CHIPSHOW · BUYER GUIDE</span><strong>{article.title}</strong><span className="bs-cover-caption">{article.type} / 示意封面</span></div>
    <div className="bs-screen" aria-hidden="true"><div className="bs-screen-face"><div className="bs-screen-panel"/><div className="bs-screen-panel"/><div className="bs-screen-panel"/><div className="bs-screen-panel"/></div><div className="bs-screen-base"/></div>
    <span className="bs-cover-index">{String(variant + 1).padStart(2, '0')}</span>
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

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ day: localDay(), session })); }
    catch { setStorageAvailable(false); }
  }, [session]);
  useEffect(() => {
    lastActivity.current = Date.now();
    const activity = () => { lastActivity.current = Date.now(); setIdle(false); };
    const visibility = () => { if (document.visibilityState === 'visible') activity(); };
    let previous = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
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
  }, [session.currentId, session.phase]);

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
            return <div key={step} className={`${index === currentIndex ? 'bs-step-active' : ''} ${index < currentIndex ? 'bs-step-complete' : ''}`} aria-current={step === phase ? 'step' : undefined}><span>{index < currentIndex ? <Check size={14}/> : index + 1}</span><strong>{phaseLabels[step]}</strong></div>;
          })}</nav>
          <div className="bs-live-status" role="status" aria-live="polite">{session.message || '本批 4 篇示例已备好，先选方向。你不需要填写提示词。'}</div>
          {session.paused ? <section className="bs-completion"><span className="bs-completion-icon"><Pause size={28}/></span><p className="bs-eyebrow">PROGRESS SAVED</p><h2 ref={focusHeading} tabIndex={-1}>先停在这里，也没关系。</h2><p>{storageAvailable ? '本机已保留你的方向、修改选择和已采用封面。' : '进度保留在当前页面，关闭后可能丢失。'}继续时会回到刚才的位置。</p><button type="button" className="bs-button bs-button-primary" onClick={() => dispatch({ type: 'resume' })}><Play size={16}/> 继续上次的操作</button></section>
          : session.phase === 'finished' ? <section className="bs-completion"><span className="bs-completion-icon"><CheckCheck size={32}/></span><p className="bs-eyebrow">BATCH COMPLETE · DEMO ONLY</p><h2 ref={focusHeading} tabIndex={-1}>这一批，处理完了。</h2><p>{ids.length} 篇已完成交付演示。没有创建真实草稿，没有公开发布。</p><div className="bs-finished-list">{ids.map(id => <div key={id}><Check size={16}/><span>{demoCatalog[id].title}</span><span>演示完成</span></div>)}</div>{deferred.length > 0 && <button type="button" className="bs-button" onClick={() => setSheet('batch')}>查看 {deferred.length} 篇暂存稿</button>}</section>
          : ids.length === 0 ? <section className="bs-completion"><span className="bs-completion-icon"><Layers3 size={30}/></span><h2 ref={focusHeading} tabIndex={-1}>这批先不做，也可以。</h2><p>跳过只移出本轮。已选方向和成品没有被删除，也没有记为交付。</p><button type="button" className="bs-button bs-button-primary" onClick={() => setSheet('batch')}>从暂存稿中放回</button></section>
          : !current || !progress || !phase ? <section className="bs-completion"><span className="bs-completion-icon"><CheckCheck size={30}/></span><p className="bs-eyebrow">ONE STEP AT A TIME</p><h2 ref={focusHeading} tabIndex={-1}>本批{phase ? phaseLabels[phase] : ''}已完成。</h2><p>{completedCount} 篇逐篇确认完毕。接下来集中处理下一环节。</p>{phase && <button type="button" className="bs-button bs-button-primary" onClick={() => dispatch({ type: 'next_phase', phase })}>{phase === 'preflight' ? '查看本批结果' : `一起进入${phaseLabels[batchPhases[batchPhases.indexOf(phase) + 1]]}`}<ArrowRight size={16}/></button>}</section>
          : <>
            <header className="bs-task-heading"><div className="bs-task-kicker"><span>{current.type}</span><span>{phaseLabels[phase]} · 已确认 {completedCount}/{ids.length}</span></div><h2 ref={focusHeading} tabIndex={-1}>{current.title}</h2><p>{phaseHints[phase]}</p></header>
            <section className="bs-summary" aria-label="中文决策摘要"><div><span>帮助谁</span><p>{current.reader}</p></div><div><span>解决什么</span><p>{progress.reviewChoice === 'narrow' ? current.narrowerQuestion : current.question}</p></div><div><span>现在决定</span><p>{phase === 'direction' ? '选择一个表达方向，按需补充偏好。' : phase === 'review' ? '确认原句如何改，或明确缩小范围。' : phase === 'artifacts' ? '选一张封面，再确认当前成品。' : '核对当前采用版本与草稿位置。'}</p></div></section>
            {phase === 'direction' && <div className="bs-stage-content">
              <div className="bs-section-title"><h3>这篇怎样讲，最有用？</h3><button type="button" className="bs-text-button" onClick={() => send({ type: 'shuffle_directions' })}><RotateCcw size={14}/> 换一组表达</button></div>
              <fieldset className="bs-directions"><legend className="bs-sr-only">选择文章方向</legend>{directionIds.map((id, index) => {
                const direction = current.directions[id];
                const extra = progress.directionRound % 2 !== 0;
                return <label className={`bs-direction ${progress.direction === id ? 'bs-selected' : ''}`} key={id}><input type="radio" name={`direction-${current.id}`} checked={progress.direction === id} onChange={() => send({ type: 'select_direction', id })}/><span className="bs-choice-top"><span className="bs-choice-letter">{String.fromCharCode(65 + index)}</span>{index === 0 && <span className="bs-recommend">推荐</span>}<span className="bs-radio" aria-hidden="true">{progress.direction === id && <span/>}</span></span><strong>{extra ? ['从买家最后要做的决定开始', '从现场要核对的细节开始', '从两套方案的差异开始'][index] : direction.label}</strong><p>{direction.reason}</p><span className="bs-outline-label">大纲预览</span><ol>{(extra ? [...direction.outline].reverse() : direction.outline).map(item => <li key={item}>{item}</li>)}</ol></label>;
              })}</fieldset>
              <div className="bs-tweaks"><h4>还想怎样调整？ <span>选填，可多选</span></h4><div>{(Object.keys(tweakLabels) as Tweak[]).map(tweak => <button key={tweak} type="button" aria-pressed={progress.tweaks.includes(tweak)} className={`bs-chip ${progress.tweaks.includes(tweak) ? 'bs-chip-selected' : ''}`} onClick={() => send({ type: 'toggle_tweak', tweak })}>{progress.tweaks.includes(tweak) ? <Check size={13}/> : <span aria-hidden="true">+</span>}{tweakLabels[tweak]}</button>)}</div></div>
              <details className="bs-optional"><summary>补充一句特殊要求 <span>选填</span><ChevronDown size={14}/></summary><label className="bs-sr-only" htmlFor="batch-note">特殊要求，最多 500 字</label><textarea id="batch-note" value={progress.note} maxLength={500} rows={2} placeholder="例如：让经销商也能直接转给终端客户。留空不影响推进。" onChange={event => send({ type: 'set_note', note: event.target.value })}/></details>
              <div className="bs-why"><Sparkles size={16}/><p>{current.reason}</p></div>
            </div>}
            {phase === 'review' && <div className="bs-stage-content">
              <div className="bs-section-title"><h3>这处表述，需要你选一下</h3><button type="button" className="bs-text-button" onClick={() => setSheet('evidence')}><BookOpen size={15}/> 看核对依据</button></div>
              <div className="bs-original"><span>待确认原句</span><p lang="en">{current.original}</p><small>原句承诺过大，建议补充适用条件。</small></div>
              <fieldset className="bs-review-choices"><legend className="bs-sr-only">选择修改方案</legend><label className={`bs-review-choice ${progress.reviewChoice === 'patch' ? 'bs-selected' : ''}`}><input type="radio" name={`review-${current.id}`} checked={progress.reviewChoice === 'patch'} onChange={() => send({ type: 'select_review', choice: 'patch' })}/><span className="bs-choice-top"><strong>采用带条件的建议</strong><span className="bs-recommend">推荐</span><span className="bs-radio" aria-hidden="true">{progress.reviewChoice === 'patch' && <span/>}</span></span><p lang="en">{current.patch}</p><small>保留原买家问题，只修正这一处表达。</small></label><label className={`bs-review-choice ${progress.reviewChoice === 'narrow' ? 'bs-selected' : ''}`}><input type="radio" name={`review-${current.id}`} checked={progress.reviewChoice === 'narrow'} onChange={() => send({ type: 'select_review', choice: 'narrow' })}/><span className="bs-choice-top"><strong>改成一篇更聚焦的核对清单</strong><span className="bs-scope-badge">范围变化</span><span className="bs-radio" aria-hidden="true">{progress.reviewChoice === 'narrow' && <span/>}</span></span><p>仍要回答：{current.narrowerQuestion}</p><small>这次不写：{current.omitted}</small></label></fieldset>
              {progress.reviewChoice === 'narrow' && <p className="bs-scope-note">你将明确确认范围变化。系统会将成品收窄为核对清单，并保留具体买家问题。</p>}
              <div className="bs-tweaks"><h4>还想怎样调整？ <span>选填，可多选</span></h4><div>{(Object.keys(tweakLabels) as Tweak[]).map(tweak => <button key={tweak} type="button" aria-pressed={progress.tweaks.includes(tweak)} className={`bs-chip ${progress.tweaks.includes(tweak) ? 'bs-chip-selected' : ''}`} onClick={() => send({ type: 'toggle_tweak', tweak })}>{progress.tweaks.includes(tweak) ? <Check size={13}/> : <span aria-hidden="true">+</span>}{tweakLabels[tweak]}</button>)}</div></div>
              <details className="bs-optional"><summary>补充一句修改要求 <span>选填</span><ChevronDown size={14}/></summary><label className="bs-sr-only" htmlFor="review-note">修改要求，最多 500 字</label><textarea id="review-note" value={progress.note} maxLength={500} rows={2} placeholder="例如：保留采购前必须核对的条件。留空不影响确认。" onChange={event => send({ type: 'set_note', note: event.target.value })}/></details>
              <p className="bs-recorded-preferences">已记录方向：{current.directions[progress.direction ?? 'answer'].label}{progress.tweaks.length > 0 ? ` · ${progress.tweaks.map(tweak => tweakLabels[tweak]).join('、')}` : ''}{progress.note ? ` · 补充：${progress.note}` : ''}。正文采用固定演示样例，本次没有按偏好调用模型。</p><details className="bs-full-article"><summary><FileText size={16}/> 展开当前英文稿 <ChevronDown size={15}/></summary><ArticleText article={current} progress={progress}/></details>
            </div>}
            {phase === 'artifacts' && <div className="bs-stage-content">
              <div className="bs-section-title"><h3>同一篇稿件，都在这里</h3><span className="bs-small-label">正文版本 {progress.revision}</span></div>
              <div className="bs-artifact-grid"><div className="bs-article-mini"><div className="bs-artifact-label"><FileText size={16}/> 文章 <span className="bs-good-label"><Check size={12}/> 已确认</span></div><h3 lang="en">{demoArticleTitle(current, progress.reviewChoice)}</h3><p>{progress.reviewChoice === 'narrow' ? current.narrowerQuestion : current.answer}</p><div className="bs-paragraph-lines" aria-hidden="true"><span/><span/><span/><span/></div><details className="bs-full-article"><summary>展开全文 <ChevronDown size={14}/></summary><ArticleText article={current} progress={progress}/></details></div><div className="bs-cover-panel"><div className="bs-artifact-label">封面候选 <span className="bs-small-label">第 {progress.coverCandidate + 1} 版</span></div><Cover article={current} variant={progress.coverCandidate}/><div className="bs-cover-actions"><button type="button" className="bs-button" onClick={() => send({ type: 'new_cover_candidate' })}><RotateCcw size={14}/> 只换这张封面</button><button type="button" className="bs-button bs-button-primary" disabled={progress.adoptedCover === progress.coverCandidate} onClick={() => send({ type: 'adopt_cover', candidate: progress.coverCandidate })}>{progress.adoptedCover === progress.coverCandidate ? <><Check size={15}/> 已采用</> : '采用这一版'}</button></div></div></div>
              {progress.adoptedCover !== null && <div className="bs-adopted"><Cover article={current} variant={progress.adoptedCover} small/><div><strong>当前采用 · 封面第 {progress.adoptedCover + 1} 版</strong><p>{progress.adoptedCover === progress.coverCandidate ? '这张封面会进入交付演示。' : '新候选尚未采用。交付仍保留这张封面。'}正文和其他稿件均未改动。</p></div><CheckCheck size={20}/></div>}
              <div className="bs-inline-info"><Layers3 size={16}/><p>本轮先确认文章与封面。图文卡片和更多渠道继续复用同一稿件，本演示不模拟已上线的社媒发布。</p></div>
            </div>}
            {phase === 'preflight' && <div className="bs-stage-content"><div className="bs-section-title"><h3>只确认这一篇</h3><span className="bs-good-label"><Check size={14}/> 当前版本已采用</span></div><div className="bs-preflight-grid"><div><span>本版改了什么</span><strong>{progress.reviewChoice === 'narrow' ? '范围收窄为买家核对清单' : '修正一处过度承诺'}</strong><p>正文版本 {progress.revision} · 封面第 {(progress.adoptedCover ?? 0) + 1} 版</p></div><div><span>还有什么待办</span><strong>本演示内的选择已完成</strong><p>真实信源、目标站点与发布权限未连接。</p></div><div><span>交到哪里</span><strong>WordPress 英文草稿</strong><p>{current.type === '升级旧页' ? '独立影子草稿，保留原公开页。' : '新建草稿，不公开发布。'}本次仅演示。</p></div></div><div className="bs-final-artifact"><Cover article={current} variant={progress.adoptedCover ?? 0} small/><div><span className="bs-eyebrow">CURRENT ADOPTED VERSION</span><h3 lang="en">{demoArticleTitle(current, progress.reviewChoice)}</h3><p>点击后仅记录演示完成，不会调用 WordPress。</p></div></div><details className="bs-full-article"><summary><FileText size={15}/> 再看一次英文稿 <ChevronDown size={15}/></summary><ArticleText article={current} progress={progress}/></details></div>}
            <footer className="bs-decision-bar"><div className="bs-secondary-actions"><button type="button" className="bs-text-button" onClick={() => dispatch({ type: 'defer_articles', ids: [current.id], reason: 'skip' })}>这篇先跳过</button>{phase !== 'preflight' && <button type="button" className="bs-text-button" onClick={() => dispatch({ type: 'defer_articles', ids: [current.id], reason: 'verify' })}>转核验</button>}</div><div className="bs-primary-action"><span>确认后自动带出下一篇</span>{complete ? <button type="button" className="bs-button bs-button-primary" onClick={() => dispatch({ type: 'next_phase', phase })}>{phase === 'preflight' ? '查看本批结果' : `进入${phaseLabels[batchPhases[batchPhases.indexOf(phase) + 1]]}`}<ArrowRight size={16}/></button> : phase === 'direction' ? <button type="button" className="bs-button bs-button-primary" disabled={!progress.direction} onClick={() => send({ type: 'confirm_direction' })}>采用这个方向<ArrowRight size={16}/></button> : phase === 'review' ? <button type="button" className="bs-button bs-button-primary" disabled={!progress.reviewChoice} onClick={() => send({ type: 'confirm_review' })}>{progress.reviewChoice === 'narrow' ? '确认缩小范围' : '确认这次修改'}<ArrowRight size={16}/></button> : phase === 'artifacts' ? <button type="button" className="bs-button bs-button-primary" disabled={progress.adoptedCover === null} onClick={() => { if (progress.adoptedCover !== null) send({ type: 'confirm_artifacts', cover: progress.adoptedCover }); }}>确认当前成品<ArrowRight size={16}/></button> : <button type="button" className="bs-button bs-button-primary" onClick={() => send({ type: 'confirm_delivery' })}>模拟交付这一篇<ArrowUpRight size={16}/></button>}</div></footer>
          </>}
        </main>
      </div>
      <footer className="bs-page-footer"><span>操作只影响演示进度。预览不连接模型、采集器或 WordPress。</span><span>计时为估算，切到后台或 60 秒无操作暂停累计。</span></footer>
    </div>
    {sheet === 'evidence' && current && <Sheet title="这处为什么需要确认？" description="核对依据贴着原句看，不离开当前稿件。" onClose={() => setSheet(null)}><div className="bs-evidence-card"><span className="bs-scope-badge">演示核对项</span><h3>原句</h3><p lang="en">{current.original}</p><h3>需要保留的条件</h3><p>{current.evidence}</p><h3>建议修改</h3><p lang="en">{current.patch}</p></div><p className="bs-demo-note">真实产品将显示原始来源、证据段落和版本。本预览没有装载这些资料，不显示伪造的已核实标记。</p></Sheet>}
    {sheet === 'batch' && <Sheet title="调整本轮稿件" description="移出本轮保留已做的选择。暂存稿可以随时放回。" onClose={() => { setSheet(null); setSkipIds([]); }}><h3 className="bs-sheet-section-title">本轮稿件</h3><div className="bs-manage-list">{ids.map(id => <label key={id}><input type="checkbox" checked={skipIds.includes(id)} onChange={() => setSkipIds(currentIds => currentIds.includes(id) ? currentIds.filter(v => v !== id) : [...currentIds, id])}/><span><strong>{demoCatalog[id].title}</strong><small>{demoCatalog[id].type} · 已做的选择保留</small></span></label>)}</div><button type="button" className="bs-button bs-button-primary" disabled={skipIds.length === 0 || session.paused} onClick={() => { dispatch({ type: 'defer_articles', ids: skipIds, reason: 'skip' }); setSkipIds([]); setSheet(null); }}>移出本轮 {skipIds.length > 0 ? `${skipIds.length} 篇` : ''}</button><h3 className="bs-sheet-section-title">已移出本轮 · {deferred.length} 篇</h3>{deferred.length === 0 && <p className="bs-muted">暂时没有。移出不会删除稿件。</p>}{deferred.map(id => <div className="bs-restore-row" key={id}><div><strong>{demoCatalog[id].title}</strong><small>{session.articles[id].deferred === 'verify' ? '等待核验' : '本轮跳过'}</small></div><button type="button" className="bs-button" disabled={session.paused || !!session.interrupted} onClick={() => { dispatch({ type: 'restore_article', id }); setSheet(null); }}>放回本轮</button></div>)}</Sheet>}
    {sheet === 'hot' && <Sheet title="先处理一条临时热点" description="本批次会停在当前位置。热点处理完或暂存后，再接着做。" onClose={() => setSheet(null)}><div className="bs-hot-preview"><span className="bs-scope-badge">虚构热点，只演示交互</span><h3>{demoCatalog['hot-topic'].title}</h3><p>{demoCatalog['hot-topic'].question}</p><ul><li>原批次的选择、封面与进度保留。</li><li>热点仍需选方向、审稿和确认成品。</li><li>可以随时返回，不必把热点做完。</li></ul></div><button type="button" className="bs-button bs-button-primary" onClick={() => { dispatch({ type: 'interrupt' }); setSheet(null); }}><Zap size={16}/> 先处理这条热点</button></Sheet>}
  </div>;
}
