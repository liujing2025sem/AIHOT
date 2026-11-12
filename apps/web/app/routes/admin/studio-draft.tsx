import { useState, useEffect } from 'react';
import { Link, useBeforeUnload, useBlocker, useRevalidator, useSearchParams } from 'react-router';
import { ExternalLink, FileCheck2, FileText, History, Link2, LocateFixed, MessageSquareText, Save, ShieldAlert } from 'lucide-react';
import { CATEGORIES } from '@aihot/industry/taxonomy';
import type { Route } from './+types/studio-draft';
import { adminGet } from '../../lib/admin.server';
import { scrollBehavior } from '../../lib/motion';
import { useAdminAction } from '../../features/admin/action';
import { AdminPage, Card, Button, Badge, Field, Input, Select, Textarea, Time } from '../../features/admin/ui';
import { DirectPublish } from '../../features/admin/publishing';
import { useDelivery, type DeliveryCapability } from '../../features/admin/delivery';
import { ArticleWorkflow, type DraftStage } from '../../features/admin/workflow';
import { DraftCovers } from '../../features/admin/draft-covers';
import { Checkbox } from '../../components/ui/primitives/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/primitives/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/primitives/accordion';

function quoteText(value: string) {
  const entities: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
  return value.replace(/<\/?[a-z][^>]*>/gi, ' ').replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, token => entities[token]).replace(/\s+/g, ' ').trim();
}

type Document = {
  news_status?: 'reported' | 'unconfirmed' | 'confirmed' | 'denied' | 'corrected';
  camos?: { status: string; ruleIds: string[]; suppliedRuleIds?: string[] };
  title_zh: string; title_en: string; review_zh: string; body_en: string;
  keyword_hypothesis: string; meta_description_en: string; questions_zh: string[];
  evidence: { claim: string; quote: string }[];
  brief?: { items: { sources: { article_id: string; url: string }[]; evidence: { article_id: string; claim: string; quote: string }[] }[] };
  source: { url: string; revision: number; published_at: string | null };
};
type SourceSnapshot = { binding: { article_id: string; url: string }; title: string; body_text: string | null };
type Finding = { ruleId: string; severity: 'BLOCK' | 'WARN'; field: string; start: number; end: number; quote: string; reason: string };
type Issue = { id: string; fingerprint: string; ruleId: string; severity: 'BLOCK' | 'WARN'; title: string; group: 'required' | 'recommended'; confirmable: boolean; count: number; occurrences: Finding[] };
type WordPressReceipt = { version: number; kind: string; section: string; editUrl: string | null; recoveryKey: string | null } & (
  { state: 'pushed'; media: 'set' | 'not_configured' | 'not_applied'; metaDescription: string } |
  { state: 'unknown'; httpStatus?: number } | { state: 'mismatch'; reason?: string } | { state: 'pending' | 'blocked' }
);
type Detail = {
  delivery?: DeliveryCapability;
  pitch_id?: string | null;
  editorial_context?: { question: string; scope_question?: string; unanswered_questions: string[]; additions?: string[] } | null;
  revision_request?: { status: 'queued' | 'running' | 'done' | 'failed' | 'unknown' | 'cancelled'; version: number; goals: string[]; note: string; error?: string; receipt_id?: number } | null;
  source_snapshots?: SourceSnapshot[];
  suggestions?: {id:string;issueId:string;fingerprint:string;field:string;before:string;after:string;label:string;explanation:string}[];
  review_sync?: {status:'stale';english_hash:string}|null;
  upgrade_context?: {target_existing_url:string;target_post_id:number|null;baseline_sha256:string|null;changes:{operation:string;paragraph:string;reason:string}[];notice:string}|null;
  engineer_review?: {mode:'conservative'|'engineer';name:string;reply:string;answers:{question_id:string;choice:string;note?:string}[]}|null;
  source_snapshot: { body_text: string | null; title: string };
  issues: { items: Issue[]; summary: { findingCount: number; issueCount: number; requiredCount: number; recommendedCount: number } };
  confirmed_issues: { issueId: string; fingerprint: string }[];
  gate: { blocked: boolean; findings: Finding[]; mandatoryReview: string[] };
  id: string; document: Document; status: string; version: number; updated_at: string;
  material: { title: string; body_text: string; revision: number };
  history: { created_at: string; actor: string; action: string; reason: string | null }[];
  wordpress: { ready: boolean; message: string | null; receipt: WordPressReceipt | null;
    currentVersion?: number | null; approvedVersion?: number | null; syncedVersion?: number | null; currentSynced?: boolean; recoveryReady?: boolean };
};
export async function loader({ request, params }: Route.LoaderArgs) {
  return adminGet<Detail>(request, '/api/admin/studio/drafts/' + params.id);
}
const label: Record<string, string> = { draft: '待编辑', in_review: '待审稿', approved: '审核通过' };
export default function DraftPage({ loaderData: row }: Route.ComponentProps) {
  return <Editor key={row.id + ':' + row.version} row={row} />;
}

function editableDocument(document: Document) {
  const { title_zh, title_en, review_zh, body_en, keyword_hypothesis, meta_description_en, questions_zh, news_status = 'reported' } = document;
  return { title_zh, title_en, review_zh, body_en, keyword_hypothesis, meta_description_en, questions_zh, news_status };
}

function WordPressDraft({ row, dirty, busy, run }: { row: Detail; dirty: boolean; busy: boolean; run: ReturnType<typeof useAdminAction>['run'] }) {
  const inheritedDelivery = useDelivery();
  const delivery = row.delivery ?? inheritedDelivery;
  const { ready, message, receipt } = row.wordpress;
  const unresolvedDelivery = receipt?.state === 'unknown' || receipt?.state === 'pending';
  const [kind, setKind] = useState(row.upgrade_context?'guide':receipt?.kind ?? ''), [section, setSection] = useState(receipt?.section ?? '');
  const hold = message ?? (dirty ? '请先保存修改，再审核当前版本。'
    : row.status !== 'approved' ? '审核通过后可以推送英文稿。'
    : row.material?.revision !== row.document.source.revision ? '原文已变化，请重新建立采编任务并审核。'
    : row.gate.blocked ? '当前稿件有否决项，请修改并重新审核。' : null);
  return <Card title={delivery.wordpressWritesAllowed ? '上线与 WordPress 草稿' : '历史送达记录'}>
    {!delivery.wordpressWritesAllowed && <p className="mb-3 text-sm leading-7 text-ink-3">{delivery.message || '当前采用手工交付，可查看历史记录和核对已有回执。'}</p>}
    {row.upgrade_context ? <div className="space-y-2 text-xs leading-6">
      <Badge tone="warn">更新已有页面</Badge>
      <a className="block break-all text-accent" href={row.upgrade_context.target_existing_url} target="_blank" rel="noreferrer">{row.upgrade_context.target_existing_url}</a>
      <p>{row.upgrade_context.notice}</p>
      <p className="text-amber-ink">{delivery.draftPushAllowed ? '影子稿用于预览。覆盖原页须另行确认。' : '运营上传时请核对目标原页和改动清单，保留原有网址。'}</p>
      {!!row.upgrade_context.changes.length&&<details><summary className="cursor-pointer text-accent">查看原页改动清单（{row.upgrade_context.changes.length}）</summary><ul className="mt-2 space-y-1">{row.upgrade_context.changes.map((c,index)=><li key={index}>{c.paragraph} · {c.operation}：{c.reason}</li>)}</ul></details>}
    </div> : delivery.wordpressWritesAllowed && <DirectPublish draft={{ id: row.id, version: row.version, title: row.document.title_en }} disabled={dirty || busy} />}
    {delivery.draftPushAllowed && dirty && <p className="mt-3 text-xs leading-5 text-amber-ink">修改尚未保存，请先保存当前版本。</p>}
    {delivery.draftPushAllowed && <div className="mt-5 border-t border-line pt-5">
      <h3 className="mb-2 text-sm font-semibold text-ink">先送入草稿箱</h3>
      <p className="mb-3 text-xs leading-6 text-ink-3">人审后上线：已审核的英文稿进入 WordPress 草稿箱，由你发布。升级稿单独建草稿，不覆盖原公开页面。</p>
      {hold && <p className="mb-3 rounded-control bg-bg-sunk p-3 text-xs leading-5 text-ink-3">{hold}</p>}
      {ready && <div className="mb-4 space-y-3">
        <Field label="稿件类型"><Select value={kind} onChange={e => setKind(e.target.value)} disabled={busy || !!hold || !!row.upgrade_context}>
          <option value="">请选择类型</option><option value="brief">短讯或短文章 → Industry News</option><option value="guide">长文或升级稿 → Choose Guides</option>
        </Select></Field>
        <Field label="文章或头条分节"><Select value={section} onChange={e => setSection(e.target.value)} disabled={busy || !!hold}>
          <option value="">请选择分节</option>{CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.section}</option>)}
        </Select></Field>
      </div>}
      <Button className="w-full" disabled={busy || !!hold || !kind || !section || unresolvedDelivery} onClick={() => void run('POST', '/api/admin/studio/drafts/' + row.id + '/wordpress', { version: row.version, kind, section })}>{row.upgrade_context?'推送原页影子预览稿':'推送WordPress草稿'}</Button>
    </div>}
    {receipt && <div className="mt-4 space-y-2 text-sm leading-6" aria-live="polite">
      {receipt.state === 'pushed' && <>
        <p>{row.wordpress.recoveryReady ? '此前记录已推送版本 ' + receipt.version + '，正文尚待回读核对。' : '已核对送达版本 ' + receipt.version + '。'}{(receipt.version !== row.version || row.status !== 'approved' || dirty) && '这是此前的推送记录。'}</p>
        <p className="text-xs text-ink-3">{receipt.media === 'set' ? '已应用分节特色图。' : receipt.media === 'not_applied' ? 'WordPress 未确认应用特色图，请在草稿中核对。' : '本分节未配置特色图，本次未设置。'}</p>
        <Field label="SEO 描述未写入，请复制到 WordPress"><Input readOnly value={receipt.metaDescription} onFocus={e => e.currentTarget.select()} /></Field>
      </>}
      {receipt.state === 'blocked' && <p>WordPress 文章已不是草稿，或已找不到。已停止改写，请在 WordPress 中核对。</p>}
      {receipt.state === 'mismatch' && <p className="rounded-control bg-amber/10 p-3 text-sm">已找回原 WordPress 草稿，内容与送稿记录尚未对上。{delivery.draftPushAllowed ? '请核对原草稿；要采用当前稿件，审核后再次点击送稿，将更新同一草稿。' : '请核对原草稿，并由运营处理内容差异。'}</p>}
      {unresolvedDelivery && <>
        <p>上次送稿结果待核对{receipt.state === 'unknown' && receipt.httpStatus ? '（HTTP ' + receipt.httpStatus + '）' : ''}。先查回 WordPress 中的原草稿，核对标题和正文后再继续。</p>
      </>}
      {delivery.readOnlyRecoveryAllowed && (unresolvedDelivery || row.wordpress.recoveryReady) && <>
        <Button className="w-full" disabled={busy || !row.wordpress.recoveryReady} onClick={() => void run('POST', '/api/admin/studio/drafts/' + row.id + '/wordpress',
          { version: receipt.version, kind: receipt.kind, section: receipt.section, recoverOnly: true }, { success: '核对已结束，请查看送达状态。' })}>核对上次送达结果</Button>
        <p className="text-xs text-ink-3">此操作只读取草稿，不重新送稿。</p>
      </>}
      {receipt.recoveryKey && <details><summary className="cursor-pointer text-xs text-ink-3">查看查找编号</summary><p className="mt-2 break-all text-xs text-ink-3">{receipt.recoveryKey}</p></details>}
      {receipt.editUrl && <a className="inline-flex items-center gap-1 text-accent" href={receipt.editUrl} target="_blank" rel="noreferrer">打开 WordPress 文章 <ExternalLink className="size-3.5" aria-hidden="true" /></a>}
    </div>}
    {!receipt && !row.upgrade_context && !delivery.wordpressWritesAllowed && <p className="text-sm leading-7 text-ink-3">这篇尚无历史送达记录。</p>}
  </Card>;
}

function DraftFigures({id,version}:{id:string;version:number}){
  type Preview={issues:{code:string;message:string}[];figures:{hash:string;src:string;alt_en:string;caption_en:string;role:string;width:number;height:number}[]};
  const [preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const show=async()=>{
    setBusy(true);setError('');
    try{
      const response=await fetch(`/api/admin/studio/drafts/${id}/figures`,{credentials:'same-origin'});
      if(!response.ok)throw Error('配图预览暂不可用，文字审稿与保存不受影响。');
      const result=await response.json() as Preview;
      if(!Array.isArray(result.figures)||!Array.isArray(result.issues))throw Error('配图预览未返回完整结果，可稍后重试。');
      setPreview(result);
    }catch(e){setError(e instanceof Error?e.message:'配图预览暂不可用。');}finally{setBusy(false);}
  };
  return <Card title="配图与 ALT"><p className="mb-3 text-xs leading-6 text-ink-3">预览当前版本 {version} 的图片。装饰底图不冒充产品实拍，信息图单独保留说明与 ALT。</p>
    <Button disabled={busy} onClick={()=>void show()}>{busy?'正在准备预览':'查看配图预览'}</Button>
    {error&&<p role="status" className="mt-3 text-xs leading-6 text-amber-ink">{error}</p>}
    {preview&&<div className="mt-4 space-y-4">{preview.figures.map(f=><figure key={f.hash} className="space-y-2">
      <img src={f.src} alt={f.alt_en} width={f.width} height={f.height} className="h-auto w-full rounded-control" />
      <figcaption className="text-xs leading-6">{f.role==='decorative'?'装饰封面 · ALT 为空是有意设置':f.caption_en}</figcaption>
      {f.role!=='decorative'&&<p className="break-words text-xs leading-6 text-ink-3">ALT：{f.alt_en}</p>}
      <a href={f.src} download className="inline-flex text-sm font-medium text-accent">下载这张配图</a>
    </figure>)}{preview.issues.map((i,index)=><p key={i.code+index} className="text-xs leading-6 text-amber-ink">{i.message}</p>)}</div>}
  </Card>;
}

function evidenceUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function evidenceEntries(document: Document, snapshots: SourceSnapshot[]) {
  // The flat brief evidence loses article_id; the canonical event keeps that binding.
  if (document.brief) return document.brief.items.flatMap(item => item.evidence.map(evidence => {
    const sources = item.sources.filter(source => source.article_id === evidence.article_id);
    const urls = [...new Set(sources.map(source => evidenceUrl(source.url)))];
    return { ...evidence, sourceUrl: urls.length === 1 ? urls[0] : null };
  }));
  return document.evidence.map(evidence => {
    if (snapshots.length <= 1) return { ...evidence, sourceUrl: evidenceUrl(document.source.url) };
    const quote = quoteText(evidence.quote);
    const matches = quote ? snapshots.filter(source => quoteText(source.body_text ?? '').includes(quote) || quoteText(source.title).includes(quote)) : [];
    return { ...evidence, sourceUrl: matches.length === 1 ? evidenceUrl(matches[0].binding.url) : null };
  });
}

function EvidenceDesk({ document, snapshots, onOpenSources }: { document: Document; snapshots: SourceSnapshot[]; onOpenSources: () => void }) {
  const evidence = evidenceEntries(document, snapshots);
  const [selected, setSelected] = useState(0);
  const current = evidence[selected] ?? evidence[0];
  if (!current) return null;
  return <details className="draft-evidence-desk" aria-label="稿件说法与原文依据">
    <summary>对照稿件说法与原文依据<span>{evidence.length} 条摘录</span></summary>
    <div className="draft-evidence-switcher" aria-label="选择对照说法">{evidence.map((item, index) => <button key={index} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}>{quoteText(item.claim).slice(0, 64)}{quoteText(item.claim).length > 64 ? '…' : ''}</button>)}</div>
    <div className="draft-evidence-pair"><section><h3>稿件中的说法</h3><p>{quoteText(current.claim)}</p></section><section><h3>对应原文摘录</h3><blockquote>{quoteText(current.quote)}</blockquote>{current.sourceUrl ? <a href={current.sourceUrl} target="_blank" rel="noreferrer">打开原始来源</a> : <div className="mt-3"><p className="text-sm text-amber-ink">这条摘录暂时无法唯一定位来源。</p><Button className="mt-3" onClick={onOpenSources}>查看全部绑定原文</Button></div>}</section></div>
    <p className="draft-evidence-note">核对数字、适用条件和归属。摘录由原稿携带，最终事实判断由审稿人确认。</p>
  </details>;
}

function Editor({ row }: { row: Detail }) {
  const inheritedDelivery = useDelivery();
  const delivery = row.delivery ?? inheritedDelivery;
  const [search, setSearch] = useSearchParams();
  const requestedStage = search.get('stage');
  const stage: DraftStage = requestedStage === 'cover' || requestedStage === 'delivery' ? requestedStage : 'review';
  const setStage = (value: DraftStage) => {
    if (value === stage) return;
    setSearch(previous => { const next = new URLSearchParams(previous); next.set('stage', value); return next; }, { replace: true });
  };
  const [confirmed, setConfirmed] = useState<string[]>(row.confirmed_issues.map(c => c.issueId));
  const confirmations = row.issues.items.filter(i => i.confirmable && confirmed.includes(i.id)).map(i => ({ issueId: i.id, fingerprint: i.fingerprint }));
  const allConfirmed = row.issues.items.every(i => i.confirmable && confirmed.includes(i.id));
  const remaining = row.issues.items.filter(i => !i.confirmable || !confirmed.includes(i.id)).length;
  const [substantive, setSubstantive] = useState(false), [categories, setCategories] = useState<string[]>([]), [minutes, setMinutes] = useState(''), [fullReview, setFullReview] = useState(false);
  const [d, setD] = useState(row.document), [tab, setTab] = useState(row.review_sync?.status==='stale'?'en':'zh'), [note, setNote] = useState('');
  const [englishReviewed,setEnglishReviewed]=useState(false);
  const [fulltextOpen, setFulltextOpen] = useState(false);
  const [revisionGoals, setRevisionGoals] = useState<string[]>(['clarify_buyer_answer']);
  const [metadataOpen, setMetadataOpen] = useState('');
  const [recoveryWait, setRecoveryWait] = useState<{ version: number; until: number; request: string } | null>(null);
  const [recoveryTimedOut, setRecoveryTimedOut] = useState(false);
  const { run, busy: actionBusy, pending } = useAdminAction();
  const revisionActive = ['queued', 'running', 'unknown'].includes(row.revision_request?.status ?? '');
  const busy = actionBusy || revisionActive || recoveryWait !== null;
  const { revalidate, state: revalidationState } = useRevalidator();
  const revisionSnapshot = JSON.stringify(row.revision_request ?? null);
  useEffect(() => {
    if (!recoveryWait) return;
    const status = row.revision_request?.status ?? '';
    if (row.version !== recoveryWait.version || ['done', 'cancelled'].includes(status)
      || (['failed', 'unknown'].includes(status) && revisionSnapshot !== recoveryWait.request)) {
      setRecoveryWait(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setRecoveryWait(null);
      setRecoveryTimedOut(true);
    }, Math.max(0, recoveryWait.until - Date.now()));
    return () => window.clearTimeout(timer);
  }, [row.version, row.revision_request?.status, revisionSnapshot, recoveryWait]);
  useEffect(() => {
    if ((!recoveryWait && !['queued', 'running'].includes(row.revision_request?.status ?? '')) || revalidationState !== 'idle') return;
    const timer = window.setTimeout(() => void revalidate(), 3500);
    return () => window.clearTimeout(timer);
  }, [row.revision_request?.status, recoveryWait, revalidationState, revalidate]);
  const recoverRevision = async () => {
    setRecoveryTimedOut(false);
    const result = await run('POST', '/api/admin/studio/drafts/' + row.id + '/review', { version: row.version, action: 'recover_revision' }, { success: '已安排核对现有修订回执，未重新调用模型。', revalidate: false });
    if (!result) return;
    setRecoveryWait({ version: row.version, until: Date.now() + 20_000, request: revisionSnapshot });
    void revalidate();
  };
  const dirty = JSON.stringify(editableDocument(d)) !== JSON.stringify(editableDocument(row.document));
  useBeforeUnload(event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty &&
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('稿件还有未保存的修改。确定放弃修改并继续？')) {
        setD(row.document);
        blocker.proceed();
      }
      else blocker.reset();
    }
  }, [blocker, row.document]);
  const locate = (f: Finding) => {
    setStage('review');
    setFulltextOpen(true);
    setTab(f.field === 'source.body_text'||f.field.startsWith('source[') ? 'source' : f.field.endsWith('_zh') ? 'zh' : 'en');
    if (f.field === 'meta_description_en' || f.field === 'keyword_hypothesis') setMetadataOpen('metadata');
    setTimeout(() => {
      const el = document.querySelector('[data-field="' + f.field + '"]');
      if (!el) return;
      const details = el.closest('details');
      if (details) details.open = true;
      el.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        el.focus(); el.setSelectionRange(f.start, f.end);
      } else if (el.firstChild) {
        const range = document.createRange();
        range.setStart(el.firstChild, Math.min(f.start, el.firstChild.textContent?.length ?? 0));
        range.setEnd(el.firstChild, Math.min(f.end, el.firstChild.textContent?.length ?? 0));
        const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      }
    }, 50);
  };
  const issueList = (group: 'required' | 'recommended') => <ul className="space-y-3">
    {row.issues.items.filter(i => i.group === group).map(i => {
      const checked = i.confirmable && confirmed.includes(i.id);
      return <li key={i.id} className="rounded-card border border-line p-3.5">
        <div className="flex items-start gap-3">
          {i.confirmable ? <Checkbox id={'confirm-' + i.id} aria-label={'确认 ' + i.title} disabled={busy || dirty} checked={checked} onCheckedChange={value => setConfirmed(v => value === true ? [...v, i.id] : v.filter(id => id !== i.id))} className="mt-0.5" /> : <ShieldAlert className="mt-0.5 size-5 shrink-0 text-hot" aria-hidden="true" />}
          <div className="min-w-0 flex-1">
            <Badge tone={checked ? 'ok' : i.confirmable ? 'warn' : 'bad'}>{checked ? '已核对' : i.confirmable ? '待确认' : '需要修改'}</Badge>
            {i.confirmable ? <label htmlFor={'confirm-' + i.id} className="mt-2 block cursor-pointer break-words text-sm font-medium leading-6 text-ink">{i.title}</label> : <p className="mt-2 break-words text-sm font-medium leading-6 text-ink">{i.title}</p>}
            <p className="mt-1 text-xs leading-5 text-ink-3">{i.confirmable ? '核对原文后勾选，确认仅对当前版本有效。' : '人审模式下需要修改内容，不能勾选放行。'}</p>
          </div>
        </div>
        {i.occurrences[0] && <blockquote className="mt-3 whitespace-pre-wrap break-words border-l-2 border-line pl-3 text-sm leading-6">{quoteText(i.occurrences[0].quote).slice(0, 240)}{quoteText(i.occurrences[0].quote).length > 240 && '…'}</blockquote>}
        {(row.suggestions??[]).filter(s=>s.issueId===i.id).map(s=><div key={s.id} className="mt-3 space-y-2 rounded-control bg-bg-sunk p-3">
          <p className="text-xs font-medium text-ink">建议修改英文主稿</p>
          <p className="break-words text-xs leading-6 text-ink-2">{s.before}</p>
          <p className="break-words text-xs leading-6 text-ink-2">建议结果：{s.after || '删除这句无依据的表述，保留其余内容。'}</p>
          <p className="text-xs leading-5 text-ink-3">{s.explanation}</p>
          <Button className="w-full" disabled={dirty||busy} onClick={()=>void run('POST',`/api/admin/studio/drafts/${row.id}/apply-edit`,{version:row.version,issueId:i.id,fingerprint:i.fingerprint,suggestionId:s.id})}>{s.label}</Button>
        </div>)}
        <Accordion type="single" collapsible className="mt-1">
          <AccordionItem value="evidence" className="border-0">
            <AccordionTrigger className="py-2 text-xs text-accent">查看原因与 {i.count} 处原文</AccordionTrigger>
            <AccordionContent className="pb-0">
              {i.occurrences.map((f, index) => <div key={index} className="mt-3 border-l-2 border-line pl-3">
                <p className="text-xs leading-6 text-ink-2">{f.reason}</p>
                <blockquote className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-control bg-bg-sunk p-2.5 text-xs leading-6 text-ink-3">{quoteText(f.quote)}</blockquote>
                <Button size="sm" tone="ghost" className="mt-1" onClick={() => locate(f)}><LocateFixed aria-hidden="true" />定位到稿件</Button>
                <p className="mt-1 break-all text-[11px] text-ink-4">规则 {f.ruleId} · {f.severity} · {f.field} · {f.start}–{f.end}</p>
              </div>)}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </li>;
    })}
  </ul>;
  const change = (key: keyof Document, value: string) => setD(x => ({ ...x, [key]: key === 'questions_zh' ? value.split('\n').filter(Boolean) : value }));
  const field = (key: keyof Document, title: string, large = false) => <div className="mb-5"><Field label={title}>
    {large ? <Textarea data-field={key} readOnly={busy} value={String(d[key])} onChange={e => change(key, e.target.value)} className={'min-h-[440px] text-[15px] leading-8' + (key === 'body_en' ? ' draft-english-body' : '')} /> : <Input data-field={key} readOnly={busy} value={String(d[key])} onChange={e => change(key, e.target.value)} />}
  </Field></div>;
  const history = <div className="divide-y divide-line">
    {row.history.map((h, i) => <div className="py-3 text-xs leading-6" key={i}>
      <p>{({ 'studio.draft.confirm': '逐项确认风险', 'studio.draft.save': '保存稿件', 'studio.draft.apply-edit':'采纳英文修改', 'studio.draft.submit': '提交审稿', 'studio.draft.approve': '审核通过', 'studio.draft.return': '退回修改' } as Record<string, string>)[h.action] || h.action} · {h.actor} · <Time at={h.created_at} /></p>
      {h.reason && <p className="mt-1 text-ink-3">{h.reason}</p>}
    </div>)}
    {!row.history.length && <p className="py-3 text-xs text-ink-3">由 Agent 结果导入，尚无人工修改。</p>}
  </div>;

  return <AdminPage title={row.document.title_zh} subtitle={<span><Badge tone={row.status === 'approved' ? 'ok' : 'warn'}>{label[row.status]}</Badge><span className="ml-2">版本 {row.version} · <Time at={row.updated_at} /></span></span>} actions={<Link to="/admin/studio?tab=drafts" className="text-sm font-medium text-accent">返回稿件</Link>}>
    <ArticleWorkflow current={stage} draftId={row.id} directionTo={row.pitch_id ? '/admin/studio/pitch?id=' + encodeURIComponent(row.pitch_id) : '/admin/studio/pitch'} onStage={setStage} />
    <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-card border border-line bg-surface px-4 py-3 text-xs text-ink-3">
      <span className="inline-flex items-center gap-2"><FileText className="size-4 text-accent" aria-hidden="true" />中文核对，英文交付</span>
      <span>原信源日期：{d.source.published_at ?? '尚待核实'}</span>
      <a href={d.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-accent"><Link2 className="size-3.5" aria-hidden="true" />打开原始来源</a>
      {row.material?.revision !== d.source.revision && <span className="text-hot">原文版本已变化，请重新建立采编任务核对。</span>}
    </div>

    {dirty && stage !== 'review' && <p role="status" className="mb-5 rounded-control bg-amber-soft p-4 text-sm leading-7 text-amber-ink">正文还有未保存的修改。先回到审正文保存，再继续配图和交付。<Button className="ml-3" onClick={() => setStage('review')}>返回审正文</Button></p>}
    <div hidden={stage !== 'review'}>
    <Card title="中文决策摘要" className="mb-5 draft-decision-summary">
      <p className="text-sm font-semibold leading-6">这篇帮助读者解决：{row.editorial_context?.scope_question || row.editorial_context?.question || row.document.title_zh}</p>
      <p className="mt-2 text-sm leading-6">{row.review_sync?.status === 'stale' ? '英文已更新，中文全文对照暂未同步。请按下方原句和建议核对当前英文。' : row.document.review_zh.split(/\n/).find(line => line.trim())?.slice(0, 220)}</p>
      <p className="mt-2 text-sm leading-6">需要你决定 {remaining} 项。先看待确认原句和修改建议，完整稿件可随时展开。</p>
      {!!row.editorial_context?.unanswered_questions.length && <div className="mt-3 rounded-control bg-amber/10 p-3 text-sm leading-6">
        <p className="font-medium">本次明确未回答</p>
        <ul className="list-disc pl-4">{row.editorial_context.unanswered_questions.map((question, i) => <li key={i}>{question}</li>)}</ul>
      </div>}
      <Button className="mt-3" onClick={() => { setFulltextOpen(true); document.getElementById('draft-fulltext')?.scrollIntoView({ block: 'start', behavior: scrollBehavior() }); }}>展开完整稿件</Button>
      {row.revision_request && <p role="status" className="mt-3 text-sm leading-6">{
        row.revision_request.status === 'queued' ? '已安排按所选目标修订。当前仍展示原版本，完成后需重新审稿。'
        : row.revision_request.status === 'running' ? '正在修订。原版本与审核记录保留，暂不代表修改已完成。'
        : row.revision_request.status === 'done' ? '修订已返回，请核对当前版本。'
        : row.revision_request.status === 'cancelled' ? '已保留原稿，结束本次修订等待。可以继续审阅。'
        : row.revision_request.status === 'unknown' ? '修订调用结果未知，可能已计费。已保留回执，不会自动重试。'
        : '修订未完成，原稿仍保留。'}{row.revision_request.error ? ' ' + row.revision_request.error : ''}</p>}
      {recoveryWait && <p role="status" className="mt-2 text-sm leading-6">正在核对已有修订结果，最多等待 20 秒；可随时保留原稿继续。</p>}
      {recoveryTimedOut && <p role="status" className="mt-2 text-sm leading-6 text-amber-ink">本次核对尚未返回新结果，可稍后再查或保留原稿继续。未重新调用付费模型。</p>}
      {['queued', 'running', 'unknown', 'failed'].includes(row.revision_request?.status ?? '') && <div className="mt-3 space-y-2">
        <p className="text-xs leading-6 text-ink-3">核对已有回执可取回已返回的结果；保留原稿可结束本次等待。这两个操作均不重新调用付费模型，原审核要求保留。</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending !== null || dirty || recoveryWait !== null} onClick={() => void recoverRevision()}>核对修订结果</Button>
          <Button disabled={pending !== null || dirty} onClick={() => void run('POST', '/api/admin/studio/drafts/' + row.id + '/review', { version: row.version, action: 'keep_revision_original' }, { success: '已保留原稿并退出本次修订等待。' })}>保留原稿继续</Button>
        </div>
      </div>}
    </Card>

    <EvidenceDesk document={d} snapshots={row.source_snapshots ?? []} onOpenSources={() => {
      setFulltextOpen(true); setTab('source');
      setTimeout(() => document.getElementById('draft-fulltext')?.scrollIntoView({ block: 'start', behavior: scrollBehavior() }), 50);
    }} />
    <div className="draft-review-layout grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="order-2 min-w-0 space-y-5 xl:order-1">
        {row.review_sync?.status==='stale'&&<div role="status" className="rounded-card border border-amber-ink/20 bg-amber-ink/5 p-4 text-sm leading-6 text-amber-ink">英文主稿已变更。中文对照是旧版，仅供参考；请核对当前英文后批准。保存与采纳修改都不会上线。</div>}
        {!fulltextOpen && <section className="draft-manuscript-preview" aria-label="当前英文开篇预览">
          <p className="draft-manuscript-caption">当前英文稿</p>
          <h2 lang="en">{d.title_en}</h2>
          <div lang="en">{d.body_en.trim().split(/\n\s*\n/).filter(Boolean).slice(0, 3).map((paragraph, index) => <p key={index}>{quoteText(paragraph.replace(/^(?:#{1,6}|>|[-*])\s+/, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')).slice(0, 650)}</p>)}</div>
          <Button onClick={() => { setFulltextOpen(true); setTab('en'); }}>阅读完整英文并编辑</Button>
        </section>}
        <details id="draft-fulltext" open={fulltextOpen} onToggle={event => setFulltextOpen(event.currentTarget.open)}>
          <summary className="mb-3 cursor-pointer rounded-card border border-line bg-surface p-4 text-sm font-medium text-accent">完整稿件与原文（随时展开）</summary>
          <Card title="审阅与编辑" right={<span>{dirty ? '有修改未保存' : '当前版本已保存'}</span>}>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="稿件阅读方式" className="w-full justify-start">
              <TabsTrigger value="zh">中文审稿</TabsTrigger>
              <TabsTrigger value="en">英文交付</TabsTrigger>
              <TabsTrigger value="source">原文与证据</TabsTrigger>
            </TabsList>
            <TabsContent value="zh">
              <p className="mb-4 text-xs leading-6 text-ink-3">中文仅用于内部理解。修改中文不会改写待发布英文；需要修改文章时，请使用建议卡或英文交付页。</p>
              {field('title_zh', '中文标题')}
              {field('review_zh', '中文正文', true)}
              <Field label="待核实问题（每行一项）"><Textarea readOnly={busy} value={d.questions_zh.join('\n')} onChange={e => change('questions_zh', e.target.value)} className="min-h-28 leading-6" /></Field>
            </TabsContent>
            <TabsContent value="en">
              <p className="mb-4 text-xs leading-6 text-ink-3">公开交付为英文，位置为 Chipshow Blog；中文仅内部审稿。具体网站路径待 CMS 映射。限定语、原日期和出处会进入英文导出。</p>
              {field('title_en', 'English title')}
              {field('body_en', 'English body · Markdown', true)}
              <Accordion type="single" collapsible value={metadataOpen} onValueChange={setMetadataOpen}>
                <AccordionItem value="metadata">
                  <AccordionTrigger>搜索摘要与消息状态</AccordionTrigger>
                  <AccordionContent>
                    {field('meta_description_en', 'Meta description')}
                    {field('keyword_hypothesis', '关键词假设')}
                    <Field label="消息状态"><Select aria-label="消息状态" disabled={busy} value={d.news_status ?? 'reported'} onChange={e => change('news_status', e.target.value)}>
                      {[['reported', '原信源报道'], ['unconfirmed', '尚未证实 / 据传'], ['confirmed', '后续确认'], ['denied', '否认 / 更新'], ['corrected', '更正']].map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                    </Select></Field>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </TabsContent>
            <TabsContent value="source">
              <a className="inline-flex items-center gap-2 text-sm font-medium text-accent" href={d.source.url} target="_blank" rel="noreferrer">打开原始来源 <ExternalLink className="size-3.5" aria-hidden="true" /></a>
              <p className="mt-2 text-xs leading-6 text-ink-3">下方列出稿件说法与原文摘录。点右侧“定位到稿件”，可以回到需要核对的句子。</p>
              <div className="my-5 space-y-4">
                {d.evidence.map((e, i) => <div key={i} className="rounded-card border border-line p-4">
                  <p className="text-sm font-medium leading-6 text-ink">{e.claim}</p>
                  <blockquote className="mt-3 whitespace-pre-wrap border-l-2 border-accent pl-3 text-sm leading-7 text-ink-3">{e.quote}</blockquote>
                </div>)}
                {!d.evidence.length && <p className="rounded-control bg-bg-sunk p-4 text-sm leading-6 text-ink-3">本稿没有单独列出的证据摘录，请展开绑定原文核对。</p>}
              </div>
              <details className="rounded-control border border-line p-4">
                <summary className="cursor-pointer text-sm font-medium text-accent">展开稿件绑定版本的原文正文</summary>
                <pre data-field="source.body_text" className="mt-4 whitespace-pre-wrap break-words font-sans text-sm leading-7">{row.source_snapshot.body_text}</pre>
              </details>
              {(row.source_snapshots??[]).length>1&&<div className="mt-4 space-y-3">{row.source_snapshots!.map(s=><details key={s.binding.article_id} className="rounded-control border border-line p-4">
                <summary className="cursor-pointer text-sm font-medium text-accent">{s.title}</summary>
                <a className="my-2 block break-all text-xs text-accent" href={s.binding.url} target="_blank" rel="noreferrer">打开此条原文</a>
                <pre data-field={`source[${s.binding.article_id}].body_text`} className="whitespace-pre-wrap break-words font-sans text-sm leading-7">{s.body_text}</pre>
              </details>)}</div>}
              {d.camos && <details className="mt-4 rounded-control border border-line p-4 text-xs leading-6">
                <summary className="cursor-pointer font-medium text-ink-3">CAMOS 方法引用</summary>
                <p className="mt-2">接入状态：{d.camos.status === 'connected' ? '已接入' : '未接入'}。</p>
                <p>写作者声明采用的规则：{d.camos.ruleIds.join('、') || '未记录'}。</p>
                <p>条目 ID 证明引用可追踪，不证明方法已正确应用或事实已批准。</p>
              </details>}
            </TabsContent>
          </Tabs>
          </Card>
        </details>

        <Card>
          <Accordion type="multiple">
            <AccordionItem value="history"><AccordionTrigger><span className="inline-flex items-center gap-2"><History className="size-4" aria-hidden="true" />修改记录 · {row.history.length}</span></AccordionTrigger><AccordionContent>{history}</AccordionContent></AccordionItem>
            <AccordionItem value="review-help">
              <AccordionTrigger>人工全审参考</AccordionTrigger>
              <AccordionContent>
                <p className="text-xs leading-6 text-ink-3">先判断变化是否值得写、是否与已有内容重复。再核对型号、数字、条件、日期、归属和消息状态；认证、商务承诺、客户案例和新领域首篇逐字确认。人审档的所有 WARN 仍须逐项确认，数量不会改变放行规则。</p>
                <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => { setFulltextOpen(true); setTab('source'); }}>看原文与证据</Button><Button size="sm" onClick={() => { setFulltextOpen(true); setTab('zh'); }}>审中文</Button><Button size="sm" onClick={() => { setFulltextOpen(true); setTab('en'); }}>核对英文出口</Button></div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Card>
      </div>

      <aside className="order-1 min-w-0 space-y-5 xl:order-2" aria-label="审稿确认与交付">
        <Card title={<span className="inline-flex items-center gap-2">{row.gate.blocked ? <ShieldAlert className="size-4 text-hot" aria-hidden="true" /> : <FileCheck2 className="size-4 text-accent" aria-hidden="true" />}{row.gate.blocked ? '需要修改' : '待你确认'}</span>} right={<Badge tone={row.gate.blocked ? 'bad' : remaining ? 'warn' : 'ok'}>{row.gate.blocked ? '人审待修改' : remaining ? '剩余 ' + remaining + ' 项' : '逐项核对完成'}</Badge>}>
          <p className="mb-4 text-xs leading-6 text-ink-3">系统把 {row.issues.summary.findingCount} 处提示整理为 {row.issues.summary.issueCount} 个问题。查看对应原文，再勾选确认。</p>
          {row.gate.blocked && <p className="mb-4 rounded-control bg-hot-soft p-3 text-xs leading-6 text-hot">还有 {remaining} 个未处理问题，可以继续修改、保存和记录已核对项。批准及人审交付继续拦截未解的否决项。</p>}
          {issueList('required')}
          {row.issues.summary.recommendedCount > 0 && <Accordion type="single" collapsible className="mt-2">
            <AccordionItem value="recommended">
              <AccordionTrigger className="text-xs">其他待确认 · {row.issues.summary.recommendedCount} 项</AccordionTrigger>
              <AccordionContent>{issueList('recommended')}</AccordionContent>
            </AccordionItem>
          </Accordion>}
          {row.issues.items.length === 0 && <div className={'flex items-start gap-2 rounded-control p-3 text-sm leading-6 ' + (row.gate.blocked ? 'bg-hot-soft text-hot' : 'bg-bg-sunk text-ink-3')}>{row.gate.blocked ? <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <FileCheck2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}<p>{row.gate.blocked ? '当前未提供可勾选的放行项。请查看稿件与原文，处理否决项后再审核。' : '当前未列出可勾选的问题，请继续核对事实与原文。没有提示不代表事实已获批准。'}</p></div>}
          {dirty && <p className="mt-3 text-xs leading-6 text-amber-ink">先保存修改，系统会按新版本重新核对。</p>}
          <Button className="mt-4 w-full" disabled={busy || dirty} onClick={() => void run('POST', '/api/admin/studio/drafts/' + row.id + '/review', { version: row.version, action: 'confirm', confirmations, note }, { success: '逐项确认已保存，同版本继续审稿时可复用。' })}>保存逐项确认</Button>
          <p className="mt-2 text-[11px] leading-5 text-ink-4">确认绑定当前稿件、原文版本与条件；内容修改后重新核对。</p>
        </Card>

        <Card title="当前动作">
          <Button tone={dirty ? 'primary' : 'secondary'} className="w-full" disabled={busy || !dirty} onClick={() => void run('PATCH', '/api/admin/studio/drafts/' + row.id, { version: row.version, ...editableDocument(d) }, { success: '已保存为待编辑稿。' })}><Save aria-hidden="true" />保存修改</Button>
          <p className="my-2 text-xs leading-5 text-ink-3">{dirty ? '有修改尚未保存。保存后将按新版本重新审核。' : '当前版本已保存。'}</p>
          <fieldset disabled={busy || dirty} className="my-4 space-y-2">
            <legend className="mb-2 text-sm font-semibold">让系统怎样修改（可多选）</legend>
            <p className="text-xs leading-6 text-ink-3">选择修改目标，系统据此修订。补充意见可留空，修订后仍需审核。</p>
            {([['clarify_buyer_answer', '更直接回答买家问题'], ['shorten', '压缩篇幅与重复内容'], ['evidence_only', '只保留有依据的说法']] as const).map(([key, text]) => <label key={key} className="flex items-center gap-2 text-sm">
              <Checkbox checked={revisionGoals.includes(key)} onCheckedChange={value => setRevisionGoals(goals => value === true ? [...goals, key] : goals.filter(goal => goal !== key))} />{text}
            </label>)}
          </fieldset>
          <div className="my-4"><Field label="审稿意见（选填）" hint="有额外逻辑再补充。留空也能按所选目标修改。"><Textarea aria-label="审稿意见" value={note} disabled={busy} maxLength={2000} onChange={e => setNote(e.target.value)} placeholder="额外要求，可留空" className="min-h-20" /></Field></div>
          {row.review_sync?.status==='stale'&&<label className="mb-3 flex items-start gap-2 text-xs leading-6"><Checkbox checked={englishReviewed} onCheckedChange={value=>setEnglishReviewed(value===true)} disabled={busy||dirty} aria-label="已按当前英文主稿核对" className="mt-1" />已按当前英文主稿核对，未以旧中文代替审稿</label>}
          <div className="flex flex-wrap gap-2">
            {row.status === 'draft' && <Button tone="primary" className="w-full" disabled={busy || dirty} onClick={() => void run('POST', '/api/admin/studio/drafts/' + row.id + '/review', { version: row.version, action: 'submit', note }, { success: '已提交审稿。' })}>提交审稿</Button>}
            {row.status === 'in_review' && <Button tone="primary" className="w-full" disabled={busy || dirty || row.gate.blocked || !allConfirmed || (row.review_sync?.status==='stale'&&!englishReviewed)} onClick={() => void run('POST', '/api/admin/studio/drafts/' + row.id + '/review', { version: row.version, action: 'approve', note, confirmations,...(row.review_sync?.status==='stale'?{english_reviewed:englishReviewed}:{}) }, { success: '审核通过，可以导出。' })}>确认审核通过</Button>}
            <Button className="w-full" disabled={busy || dirty || (!revisionGoals.length && !note.trim()) || row.revision_request?.status === 'queued' || row.revision_request?.status === 'running' || row.revision_request?.status === 'unknown'} onClick={() => void run('POST', '/api/admin/studio/drafts/' + row.id + '/review', { version: row.version, action: 'return', revision_goals: revisionGoals, note }, { success: '已安排按所选目标修订。完成后请重新审稿。' })}>按选择修订</Button>
          </div>
          {row.status === 'in_review' && <p className="mt-3 text-xs leading-6 text-ink-3">{dirty ? '保存修改后再核对并审核。' : row.gate.blocked ? '先处理上方需要修改的问题。' : !allConfirmed ? '还有待确认的问题，全部核对后可审核。' : '确认审核只记录审稿结果，不会自动公开。'}</p>}
          {!revisionGoals.length && !note.trim() && <p className="mt-2 text-[11px] text-ink-4">选择至少一个修改目标即可，无需填写意见。</p>}
        </Card>

        {row.engineer_review&&<Card title="工程师确认记录"><Badge tone={row.engineer_review.mode==='engineer'?'ok':'warn'}>{row.engineer_review.mode==='engineer'?'已有人工回复':'保守写法 · 未获工程署名'}</Badge>
          <p className="mt-2 text-xs leading-6 text-ink-3">{row.engineer_review.mode==='engineer'?'以下为本任务已存档的真实答复，不代表所有公司参数已获许可。':'不代勾工程确认，未确认的公司参数继续保留限制。'}</p>
          <ul className="mt-3 space-y-2 text-xs leading-6">{row.engineer_review.answers.map(a=><li key={a.question_id}>{a.question_id}：{a.choice}{a.note?' · '+a.note:''}</li>)}</ul>
          {row.engineer_review.reply&&<p className="mt-2 text-xs leading-6">{row.engineer_review.reply}</p>}
        </Card>}
        <Card>
          <Accordion type="single" collapsible>
            <AccordionItem value="intervention" className="border-0">
              <AccordionTrigger className="py-1 text-sm"><span className="inline-flex items-center gap-2"><MessageSquareText className="size-4" aria-hidden="true" />记录人工介入</span></AccordionTrigger>
              <AccordionContent className="pb-0 pt-4">
                <p className="mb-4 text-xs leading-6 text-ink-3">没有记录的稿件不会被当作零修改；分母按稿件数计算。</p>
                <label className="flex items-start gap-2.5 text-sm leading-6"><Checkbox checked={substantive} onCheckedChange={value => setSubstantive(value === true)} className="mt-0.5" />本稿需要实质修改才能发布</label>
                <div className="my-4 flex flex-wrap gap-3">{[['fact', '事实'], ['attribution', '归属'], ['conclusion', '结论'], ['title', '标题'], ['format', '格式']].map(([key, name]) => <label key={key} className="flex items-center gap-2 text-xs"><Checkbox checked={categories.includes(key)} onCheckedChange={value => setCategories(v => value === true ? [...v, key] : v.filter(x => x !== key))} />{name}</label>)}</div>
                <Field label="人工耗时（分钟，可留空）"><Input type="number" min="0" max="1440" value={minutes} onChange={e => setMinutes(e.target.value)} /></Field>
                <label className="my-4 flex items-start gap-2.5 text-sm leading-6"><Checkbox checked={fullReview} onCheckedChange={value => setFullReview(value === true)} className="mt-0.5" />本次完成了逐篇全审</label>
                <Button className="w-full" disabled={busy || dirty || !note.trim()} onClick={() => void run('POST', '/api/admin/studio/drafts/' + row.id + '/intervention', { version: row.version, substantive, categories, minutes: minutes === '' ? null : Number(minutes), full_review: fullReview, missed_block: false, major_fact_error: false, note }, { success: '人工介入记录已保存。' })}>保存审稿观察</Button>
                <Button className="mt-3 w-full" disabled={busy || dirty || !note.trim()} onClick={() => void run('POST', '/api/admin/studio/drafts/' + row.id + '/intervention', { version: row.version, substantive: true, categories: ['fact'], minutes: minutes === '' ? null : Number(minutes), full_review: fullReview, missed_block: true, major_fact_error: true, note }, { success: '已记录重大事实错误，审稿策略退回上一档。' })}>记录重大事实错误并退档</Button>
                <p className="mt-3 text-xs leading-5 text-ink-3">以上使用“审稿意见”作为说明。记录严重错误时写清原文位置。</p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Card>
      </aside>
    </div>
    {row.status === 'approved' && <div className="mt-5 flex justify-end"><Button tone="primary" disabled={busy || dirty} onClick={() => setStage('cover')}>继续配封面</Button></div>}
    </div>

    <section hidden={stage !== 'cover'} aria-label="配封面" className="draft-stage-content space-y-5">
      {stage === 'cover' && <DraftCovers id={row.id} version={row.version} approved={row.status === 'approved'} disabled={busy || dirty} stage="cover" onDelivery={() => setStage('delivery')} onReview={() => setStage('review')} />}
      <DraftFigures id={row.id} version={row.version} />
    </section>

    <section hidden={stage !== 'delivery'} aria-label="手工交付" className="draft-stage-content space-y-5">
      {stage === 'delivery' && <DraftCovers id={row.id} version={row.version} approved={row.status === 'approved'} disabled={busy || dirty} stage="delivery" onDelivery={() => setStage('delivery')} onReview={() => setStage('review')} />}
      <Card title="当前稿件与交付版本">
        <dl className="space-y-2 text-sm" aria-label="稿件版本对应">
          <div className="flex justify-between gap-3"><dt>当前稿件</dt><dd>版本 {row.version}{dirty && '，尚有未保存修改'}</dd></div>
          <div className="flex justify-between gap-3"><dt>最近人工批准</dt><dd>{row.wordpress.approvedVersion != null ? '版本 ' + row.wordpress.approvedVersion : '尚未批准'}</dd></div>
          <div className="flex justify-between gap-3"><dt>已核对送达 WP</dt><dd>{row.wordpress.syncedVersion != null ? '版本 ' + row.wordpress.syncedVersion : '尚未核对送达'}</dd></div>
        </dl>
        <p className="mt-3 text-sm leading-7 text-ink-3">{row.wordpress.currentSynced && !dirty ? '当前版本与已核对的 WordPress 草稿对应。' : delivery.wordpressWritesAllowed ? '修改稿件后，需要审核当前版本，再更新原 WordPress 草稿。' : '正文变更后重新审核。采用封面后，确认当前成品再下载交付包。'}</p>
      </Card>
      <Card title="单独下载正文">
        {row.status === 'approved' && !dirty ? <div className="flex flex-wrap gap-3">
          {['md', 'html', 'json'].map(format => <a key={format} href={'/api/admin/studio/drafts/' + row.id + '/export?format=' + format + '&version=' + row.version} className="rounded-control border border-accent/30 px-4 py-3 text-sm font-medium text-accent">{'英文 ' + format.toUpperCase()}</a>)}
          <a href={'/api/admin/studio/drafts/' + row.id + '/export?format=review&version=' + row.version} className="rounded-control border border-line px-4 py-3 text-sm text-ink-3">内部中英审稿包</a>
        </div> : <p className="text-sm leading-7 text-ink-3">人工审核通过并保存后，可下载 Markdown、HTML 和结构化稿件。</p>}
      </Card>
      {(!row.upgrade_context || row.status === 'approved' || row.wordpress.receipt) && <WordPressDraft row={row} dirty={dirty} busy={busy} run={run} />}
    </section>
  </AdminPage>;
}
