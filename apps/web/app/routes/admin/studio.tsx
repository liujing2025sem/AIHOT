import { useEffect, useRef, useState } from 'react';
import { Form, Link, useNavigate, useRevalidator, useSearchParams } from 'react-router';
import type { Route } from './+types/studio';
import { adminGet } from '../../lib/admin.server';
import { useAdminAction } from '../../features/admin/action';
import { AdminPage, Badge, Button, ButtonLink, Card, healthTone, Input, Stat, Time } from '../../features/admin/ui';
import { DirectPublish } from '../../features/admin/publishing';
import { ArrowRight, BookOpenText, ExternalLink, FileCheck2, Newspaper, SlidersHorizontal, X } from 'lucide-react';
import { Checkbox } from '../../components/ui/primitives/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/primitives/dialog';
import { studioPageLabels } from '../../features/admin/navigation';

type ExtractionState = 'ok' | 'partial' | 'unconfirmed' | 'skipped' | 'conflict' | 'unsupported' | 'failed';
type Editorial = { decision: 'KEEP' | 'SKIP' | 'HOLD'; reason_zh: string; task_id?: string };
type Material = { id: string; title: string; url: string; source_name: string; published_at: string | null; publication_time: string | null; discovered_at: string; body_status: string; body_length: number | null; body_text?: string | null; editorial?: Editorial | null; last_extraction: { state: ExtractionState; notice: string; at: string } | null };
type Extraction = { state: ExtractionState; notice: string; changes: { body: boolean; date: boolean }; material: Material };
type BatchResult = { id: string; title: string; result: Extraction | null };
type Draft = { id: string; title_zh: string; title_en: string; status: string; updated_at: string; version: number };
type ReviewMetrics={tier:number;backtestConfirmed:boolean;totalDrafts:number;observedDrafts:number;unobservedDrafts:number;interventionRate:number|null;zeroMissStreak:number;eligible20:boolean;eligible10:boolean;note:string;trend:{at:string;substantive:boolean;minutes:number|null;fullReview:boolean;majorFactError:boolean}[]};
type PlanningMetrics={adopted:number;rejected:number;adoptionRate:number|null;update_opportunities:number;updates_completed:number;baseline_missed_updates:number;baseline_unknown:number;denominator:string;reasons:{reason:string;count:number}[]};
type Overview = { reviewMetrics:ReviewMetrics; rows: Material[]; total: number; page: number; stats: Record<string, number>; generation: { ready: boolean; reason: string }; sources: { id: string; name: string; kind: string; health: string; materials: number; last_fetch: string | null; last_fetch_status: string | null; last_fetch_error: string | null }[]; tasks: { editorial_plan?:{question:string;requires_first_party:boolean;action:string}; id: string; state: string; materials: number; created_at: string; editorial_gate?:{blocked:boolean;findings:{ruleId:string;severity:string;field:string;start:number;end:number;quote:string;reason:string}[]}; drafts: number; articles: { id: string; title: string }[]; decisions: (Editorial & { article_id: string })[] | null }[]; drafts: Draft[] };
const decisionLabels = { KEEP: '值得成稿', SKIP: '暂不采用', HOLD: '待核实' };
function EditorialResult({ value }: { value: Editorial }) {
  return <div className="mt-2 text-xs leading-5"><Badge tone={value.decision === 'KEEP' ? 'ok' : value.decision === 'HOLD' ? 'warn' : 'muted'}>{decisionLabels[value.decision]}</Badge><p className="mt-1 break-words text-ink-3">{value.reason_zh}</p></div>;
}
const labels: Record<string, string> = { draft: '待编辑', in_review: '待审稿', approved: '可导出' };
const extractionLabels: Record<ExtractionState, string> = { ok: '补齐完成', partial: '部分补齐', unconfirmed: '仍待核实', skipped: '已齐', conflict: '版本冲突', unsupported: '暂不支持', failed: '补齐失败' };
const healthLabels: Record<string, string> = { ok: '正常', degraded: '不稳定', failing: '采集失败', paused: '已暂停', unknown: '待检查' };
const fetchLabels: Record<string, string> = { ok: '采集完成', failed: '采集失败', error: '采集失败', running: '采集中', skipped: '已齐', partial: '部分完成', aborted: '已中断' };
const bodyReady = (a: Material) => a.body_status === 'ok' && (a.body_length ?? a.body_text?.length ?? 0) > 0;
function PublicationDate({ material: a }: { material: Material }) {
  if (!a.published_at) return <Badge tone="warn">发布日期待核</Badge>;
  const value = a.publication_time;
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return <time dateTime={value}>{value}（原文仅日期）</time>;
  return <><Time at={a.published_at} />{!value && <span>（原始精度未知）</span>}</>;
}
export async function loader({ request }: Route.LoaderArgs) {
  const url=new URL(request.url);
  const [overview,reviewMetrics,planning]=await Promise.all([
    adminGet<Omit<Overview,'reviewMetrics'>>(request, '/api/admin/studio'+url.search),
    adminGet<ReviewMetrics>(request,'/api/admin/studio/review-metrics'),
    url.searchParams.get('tab')==='review'?adminGet<{metrics:PlanningMetrics}>(request,'/api/admin/studio/recommendations'):Promise.resolve(null),
  ]);
  return {...overview,reviewMetrics,planningMetrics:planning?.metrics??null};
}
export const meta = () => [{ title: '采编工作台 · Chipshow Studio' }];
export default function Studio({ loaderData: data }: Route.ComponentProps) {
  const [sp, setSp] = useSearchParams();
  const navigate=useNavigate(),bindingTask=sp.get('bind_task'),bindingCard=sp.get('bind_card');
  const binding=bindingCard||bindingTask;
  const tab = sp.get('tab') || 'materials';
  const [selected, setSelected] = useState<Material[]>([]);
  const [target, setTarget] = useState('');
  const [pageType, setPageType] = useState('行业资讯');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsTrigger = useRef<HTMLButtonElement>(null);
  const [policyNote,setPolicyNote]=useState(''),[backtestConfirmed,setBacktestConfirmed]=useState(false);
  const [importError, setImportError] = useState('');
  const [generationStep, setGenerationStep] = useState('');
  const generatingRef = useRef(false);
  const { run, busy: actionBusy } = useAdminAction();
  const revalidator = useRevalidator();
  const [extracting, setExtracting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [batchTotal, setBatchTotal] = useState(0);
  const [results, setResults] = useState<BatchResult[]>([]);
  const extractingRef = useRef(false);
  const stopRef = useRef(false);
  const busy = actionBusy || extracting || !!generationStep;
  const targetValid = !target.trim() || /^https:\/\/(www\.)?(chipshow\.com|chipshowledusa\.com|chipshow\.eu|unishineled\.com)(\/|$)/.test(target.trim());
  const missingBodies = selected.filter(a => !bodyReady(a)).length;
  const page = studioPageLabels[tab] ?? studioPageLabels.materials;
  const nextDraft = data.drafts.find(d => d.status === 'in_review') ?? data.drafts.find(d => d.status === 'draft');
  const generationHold = selected.length > 4 ? '自动成稿每次最多 4 条；请减少选择，或保存为 Agent 文件任务。'
    : missingBodies ? `还缺 ${missingBodies} 条完整正文，请先补齐或移除。`
    : !data.generation.ready ? data.generation.reason || '写作模型尚未就绪，请检查模型连接。'
    : !targetValid ? '目标页面须为允许的 Chipshow 站点 HTTPS 地址。'
    : busy ? generationStep || '正在处理当前操作，请稍候。' : null;
  useEffect(() => {
    setSelected(items => items.map(a => data.rows.find(row => row.id === a.id) ?? a));
  }, [data.rows]);
  useEffect(() => () => { stopRef.current = true; }, []);
  const extract = async () => {
    if (busy || extractingRef.current || !selected.length || selected.length > 12) return;
    extractingRef.current = true;
    stopRef.current = false;
    const batch = [...selected];
    setExtracting(true);
    setStopping(false);
    setBatchTotal(batch.length);
    setResults([]);
    try {
      for (const a of batch) {
        if (stopRef.current) break;
        const result = await run<Extraction>('POST', `/api/admin/studio/materials/${a.id}/extract`, {}, { revalidate: false });
        setResults(items => [...items, { id: a.id, title: a.title, result }]);
        if (result?.material) setSelected(items => items.map(item => item.id === a.id ? { ...item, ...result.material, body_length: result.material.body_length ?? result.material.body_text?.length ?? item.body_length } : item));
      }
    } finally {
      extractingRef.current = false;
      setExtracting(false);
      void revalidator.revalidate();
    }
  };
  const switchTab = (value: string) => { const next = new URLSearchParams(sp); next.set('tab', value); setSp(next); };
  const bindMaterials=async()=>{
    if(busy||!binding||!selected.length||missingBodies>0||selected.length>12)return;
    const path=bindingCard?`/api/admin/studio/recommendations/${encodeURIComponent(bindingCard)}/materials`:`/api/admin/studio/tasks/${encodeURIComponent(binding)}/materials`;
    if(await run('POST',path,{article_ids:selected.map(a=>a.id)},{success:bindingCard?'证据已绑定，返回卡片核对后再决定是否采纳。':'证据已绑定，请继续原任务。'})){
      setSelected([]);
      navigate(bindingCard?'/admin/studio/planning':'/admin/studio?tab=tasks');
    }
  };
  const create = async (generate = false) => {
    if (busy || extractingRef.current || generatingRef.current || !selected.length || selected.length > (generate ? 4 : 12) || missingBodies) return;
    if (!targetValid || generate && !data.generation.ready) return;
    generatingRef.current = true;
    const writing = target.trim() ? { site: new URL(target).hostname.replace(/^www\./, ''), target_url: target.trim(), page_type: pageType } : undefined;
    try {
      if (generate) setGenerationStep('正在保存本次素材与写作要求…');
      const result = await run<{ id: string }>('POST', '/api/admin/studio/tasks', { article_ids: selected.map(a => a.id), writing }, { revalidate: false, ...(generate ? {} : { success: '任务已保存，可下载后交给 Codex。' }) });
      if (!result) return;
      setSelected([]);
      switchTab('tasks');
      if (generate) {
        setGenerationStep('正在判断选题价值，并为值得写的材料生成中英稿；请保持页面打开…');
        const written = await run<{ drafts?: number }>('POST', `/api/admin/studio/tasks/${result.id}/generate`, {}, { revalidate: false });
        if (written && (written.drafts ?? 0) > 0) switchTab('drafts');
      }
    } finally {
      generatingRef.current = false;
      setGenerationStep('');
      void revalidator.revalidate();
    }
  };
  return <AdminPage title={page.title} subtitle={page.description} actions={<ButtonLink tone="primary" to="/admin/studio/pitch"><BookOpenText className="size-4" aria-hidden="true"/>写专业文章</ButtonLink>}>
    {tab === 'materials' && !binding && nextDraft && <section className="mb-6 flex flex-wrap items-center gap-4 rounded-panel border border-accent/20 bg-accent-softer p-5" aria-label="继续已有稿件"><span className="grid size-11 shrink-0 place-items-center rounded-card bg-surface text-accent"><FileCheck2 className="size-6" aria-hidden="true"/></span><div className="min-w-0 flex-1"><p className="text-xs font-medium text-accent">已有稿件，随时继续</p><h2 className="mt-1 text-base font-semibold text-ink">{nextDraft.title_zh || nextDraft.title_en}</h2><p className="mt-1 text-xs text-ink-3">核对文章和证据，无需重新生成。</p></div><ButtonLink to={`/admin/studio/drafts/${nextDraft.id}`}><span>继续审稿</span><ArrowRight className="size-4" aria-hidden="true"/></ButtonLink></section>}
    {generationStep && <p role="status" aria-live="polite" className="mb-4 rounded-card bg-accent-soft p-4 text-sm text-accent">{generationStep}</p>}
    {tab==='review'&&data.planningMetrics&&<Card title="本期选题成效" className="mb-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="自动建议已采纳" value={data.planningMetrics.adopted}/><Stat label="自动建议已否决" value={data.planningMetrics.rejected}/>
        <Stat label="自动建议采纳率" value={data.planningMetrics.adoptionRate===null?'未知':`${(data.planningMetrics.adoptionRate*100).toFixed(1)}%`}/>
        <Stat label="旧页更新机会" value={data.planningMetrics.update_opportunities}/><Stat label="已记录完成" value={data.planningMetrics.updates_completed} hint="人工记录，不是CMS回读"/>
      </div>
      <p className="mt-3 text-xs leading-6 text-ink-3">采纳率分母：{data.planningMetrics.denominator}。基线未发现的旧页更新：{data.planningMetrics.baseline_missed_updates}；尚未对照：{data.planningMetrics.baseline_unknown}。人工分钟和调用成本继续记录，不作本期门槛。</p>
      {data.planningMetrics.reasons.length>0&&<details className="mt-3 text-sm"><summary className="cursor-pointer text-accent">否决理由分布</summary>{data.planningMetrics.reasons.map(item=><p key={item.reason} className="mt-2 break-words">{item.reason} · {item.count}</p>)}</details>}
      <Link to="/admin/studio/planning" className="mt-3 block text-sm text-accent">记录基线对照与旧页更新完成 →</Link>
    </Card>}
    {tab==='materials'&&binding&&<Card className="mb-5" title={bindingCard?'采纳前：为选题卡补证据':'为原选题任务补证据'}><p className="mb-3 text-sm leading-6 text-ink-3">选择完整原文；更新已有页面须同时选择旧页正文，实机教程须选择人工上传的实机资料。{bindingCard?'本次只绑定到原卡片，完成后返回选题页核对证据清单，再决定是否采纳。':'绑定后继续原任务。'}</p><div className="flex flex-wrap items-center gap-3"><Button tone="primary" disabled={busy||!selected.length||missingBodies>0||selected.length>12} onClick={()=>void bindMaterials()}>绑定所选 {selected.length} 条素材</Button><Link to={bindingCard?'/admin/studio/planning':'/admin/studio?tab=tasks'} className="text-sm text-accent">取消绑定</Link></div></Card>}

    {batchTotal > 0 && <Card className="mb-4" title={`素材补齐 ${results.length}/${batchTotal}`} right={extracting ? <Button size="sm" disabled={stopping} onClick={() => { stopRef.current = true; setStopping(true); }}>停止后续</Button> : undefined}>
      <p role="status" aria-live="polite" className="text-sm text-ink-3">{extracting ? stopping ? '正在完成当前请求，随后停止。' : `正在处理第 ${Math.min(results.length + 1, batchTotal)} 条，请稍候。` : results.length < batchTotal ? `已停止，剩余 ${batchTotal - results.length} 条未处理。` : '本批处理结束，请查看每条结果。'}</p>
      <div role="progressbar" aria-valuenow={results.length} aria-valuemin={0} aria-valuemax={batchTotal} aria-label="素材补齐进度" className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-sunk"><div className="h-full bg-accent" style={{width: `${results.length / batchTotal * 100}%`}} /></div>
      <ul className="mt-3 divide-y divide-line">{results.map(({ id, title, result }) => <li key={id} className="py-3 text-sm"><p className="font-medium text-ink">{title}</p><div className="mt-2 flex flex-wrap gap-2"><Badge tone={result?.state === 'ok' || result?.state === 'skipped' ? 'ok' : !result || result.state === 'failed' || result.state === 'conflict' ? 'bad' : 'warn'}>{result ? extractionLabels[result.state] : '请求失败'}</Badge><Badge tone={result?.changes.body ? 'ok' : 'muted'}>{!result ? '正文未确认' : result.changes.body ? '已补正文' : result.material?.body_status === 'ok' ? '正文已齐' : '待补正文'}</Badge><Badge tone={result?.changes.date ? 'ok' : 'muted'}>{!result ? '日期未确认' : result.changes.date ? '已补日期' : result.material?.published_at ? '日期已齐' : '日期待核'}</Badge></div><p className="mt-2 break-words text-xs leading-5 text-ink-3">{result?.notice || '未取得补齐结果，请查看错误提示后重试。'}</p></li>)}</ul>
    </Card>}
    {tab==='review'&&<><div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="当前审稿策略" value={`${data.reviewMetrics.tier}%档`} hint="档位名称，不代表实际工时占比"/><Stat label="零漏检全审样本" value={data.reviewMetrics.zeroMissStreak}/><Stat label="人工观察覆盖" value={`${data.reviewMetrics.observedDrafts}/${data.reviewMetrics.totalDrafts}`} hint={`${data.reviewMetrics.unobservedDrafts}篇未记录`}/><Stat label="人工介入率" value={data.reviewMetrics.interventionRate===null?'未知':`${(data.reviewMetrics.interventionRate*100).toFixed(1)}%`}/></div><Card title="先回测，再决定是否降档"><p className="text-sm leading-6 text-ink-3">{data.reviewMetrics.note} 30档每篇全审；20档审WARN并每5篇抽1篇；10档仍逐字审认证、商务、客户案例和新领域首篇。</p><p className="mt-3 text-sm">历史回测人工评审：{data.reviewMetrics.backtestConfirmed?'已记录':'尚未记录'}。20档：{data.reviewMetrics.eligible20?'条件满足':'条件不足'}；10档：{data.reviewMetrics.eligible10?'条件满足':'条件不足'}。</p><textarea aria-label="档位评审说明" placeholder="填写回测报告位置、误报结论或档位变更理由" value={policyNote} onChange={e=>setPolicyNote(e.target.value)} className="my-3 min-h-24 w-full rounded-control border border-line bg-surface p-3 text-sm"/><label className="flex gap-2 text-sm"><input type="checkbox" checked={backtestConfirmed} onChange={e=>setBacktestConfirmed(e.target.checked)}/>我已评审历史BLOCK回测和误报，确认可用于降档判断</label><div className="mt-4 flex flex-wrap gap-3"><Button disabled={busy||!policyNote.trim()||!backtestConfirmed} onClick={()=>void run('POST','/api/admin/studio/review-policy',{tier:data.reviewMetrics.tier,backtest_confirmed:true,note:policyNote},{success:'已记录回测人工评审。'})}>记录回测评审</Button>{[20,10].map(tier=><Button key={tier} disabled={busy||!policyNote.trim()||!(tier===20?data.reviewMetrics.eligible20:data.reviewMetrics.eligible10)} onClick={()=>void run('POST','/api/admin/studio/review-policy',{tier,backtest_confirmed:true,note:policyNote},{success:'审稿策略已调整。'})}>采用{tier}%档</Button>)}</div></Card><Card className="mt-5" title="最近稿件的人工介入"><div className="divide-y divide-line">{data.reviewMetrics.trend.map((r,i)=><p key={i} className="py-3 text-sm"><Time at={r.at}/> · {r.substantive?'实质修改':'无需实质修改'} · {r.minutes===null?'耗时未知':`${r.minutes}分钟`} · {r.fullReview?'全审':'局部审查'}{r.majorFactError?' · 重大事实错误，已退档':''}</p>)}{!data.reviewMetrics.trend.length&&<p className="py-6 text-sm text-ink-3">尚无人工观察记录。请在稿件页填写本稿修改类型、耗时和全审情况。</p>}</div></Card></>}
    {tab === 'materials' && <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-ink-3"><Newspaper className="size-4" aria-hidden="true"/><span>已采集 {data.stats.materials ?? data.total} 条</span><span className="text-line-strong">·</span><span>可读正文 {data.stats.body_ready ?? 0} 条</span></div>
        <Link to="/admin/studio?tab=sources" className="text-xs font-medium text-accent">管理信源与采集 →</Link>
      </div>
      <Form className="mb-5 flex flex-wrap items-center gap-2 rounded-panel border border-line bg-surface p-3" method="get">
        <input type="hidden" name="tab" value="materials"/>
        {bindingCard ? <input type="hidden" name="bind_card" value={bindingCard}/> : bindingTask && <input type="hidden" name="bind_task" value={bindingTask}/>}
        <Input name="q" defaultValue={sp.get('q') || ''} placeholder="搜索你关心的厂商、产品或新闻" aria-label="搜索素材" className="min-w-0 flex-1 basis-60"/>
        <select aria-label="筛选信源" name="source" defaultValue={sp.get('source') || ''} className="h-10 min-w-0 max-w-full rounded-control border border-line bg-surface px-3 text-sm"><option value="">全部信源</option>{data.sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select aria-label="筛选素材状态" name="quality" defaultValue={sp.get('quality') ?? 'ready'} className="h-10 min-w-0 max-w-full rounded-control border border-line bg-surface px-3 text-sm"><option value="">全部材料</option><option value="ready">正文可读</option><option value="missing-body">待补正文</option><option value="missing-date">待核发布日期</option></select>
        <Button type="submit">筛选</Button>
      </Form>
      <div className={'grid gap-4 xl:grid-cols-2 ' + (selected.length ? 'pb-40' : '')}>
        {data.rows.map(a => {
          const checked = selected.some(item => item.id === a.id);
          return <article key={a.id} className={'group flex min-w-0 gap-3 rounded-panel border bg-surface p-5 transition-colors ' + (checked ? 'border-accent ring-1 ring-accent/20' : 'border-line hover:border-accent/35')}>
            <Checkbox className="mt-1 shrink-0" aria-label={'选择 ' + a.title} disabled={busy || selected.length >= 12 && !checked} checked={checked} onCheckedChange={value => setSelected(items => value === true ? items.length < 12 && !items.some(item => item.id === a.id) ? [...items, a] : items : items.filter(item => item.id !== a.id))}/>
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-4"><span className="font-medium text-ink-3">{a.source_name}</span><span>·</span><PublicationDate material={a}/></div>
              <h2><Link to={'/admin/studio/materials/' + a.id} className="text-[15px] font-semibold leading-6 text-ink hover:text-accent">{a.title}</Link></h2>
              {a.editorial ? <EditorialResult value={a.editorial}/> : <p className="mt-3 text-xs leading-6 text-ink-3">勾选后由 AI 评估写作价值，成稿保留事实出处。</p>}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3"><Badge tone={bodyReady(a) ? 'ok' : 'warn'}>{bodyReady(a) ? '可用于采编' : '缺少正文'}</Badge><a className="inline-flex items-center gap-1 text-xs text-accent" href={a.url} target="_blank" rel="noreferrer">查看原文<ExternalLink className="size-3" aria-hidden="true"/></a></div>
              {a.last_extraction && <p className="mt-2 break-words text-xs leading-5 text-ink-3">最近补齐：{extractionLabels[a.last_extraction.state]} · {a.last_extraction.notice}</p>}
            </div>
          </article>;
        })}
      </div>
      {!data.rows.length && <section className="rounded-panel border border-dashed border-line-strong bg-surface px-6 py-12 text-center"><Newspaper className="mx-auto mb-3 size-8 text-ink-4" aria-hidden="true"/><h2 className="text-base font-semibold text-ink">{sp.get('q') || sp.get('source') || sp.get('quality') ? '这个筛选下还没有材料' : '从第一条行业信息开始'}</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-ink-3">可以更换筛选条件，或查看信源与采集；如果已有买家问题，也可以直接写专业文章。</p><div className="mt-5 flex flex-wrap justify-center gap-3"><ButtonLink to="/admin/studio?tab=sources">信源与采集</ButtonLink><ButtonLink to="/admin/studio/pitch">从买家问题开始</ButtonLink></div></section>}
      <div className="mt-5 flex flex-wrap justify-between gap-3 text-xs text-ink-3"><span>共 {data.total} 条 · 第 {data.page} 页</span><span className="flex gap-4">{data.page > 1 && <Link to={'?' + new URLSearchParams({...Object.fromEntries(sp), page: String(data.page - 1)})}>上一页</Link>}{data.page * 30 < data.total && <Link to={'?' + new URLSearchParams({...Object.fromEntries(sp), page: String(data.page + 1)})}>下一页</Link>}</span></div>
      {selected.length > 0 && <section role="region" aria-label="已选素材操作" className="fixed inset-x-3 bottom-3 z-40 rounded-panel border border-line-strong bg-surface p-4 shadow-[0_8px_32px_rgba(0,0,0,0.12)] sm:inset-x-6 lg:left-[calc(var(--studio-sidebar-width)+2rem)] lg:right-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-ink">已选 {selected.length} 条 <span className="ml-1 text-xs font-normal text-ink-4">/ 12</span></p><p className="mt-1 text-xs leading-5 text-ink-3">翻页和筛选保留选择。{binding ? '将材料补回原任务。' : '先出稿，再决定是否发布。'}</p></div>
          <Button tone="ghost" size="sm" disabled={busy} aria-label="清空选择" onClick={() => setSelected([])}><X className="size-4" aria-hidden="true"/>清空</Button>
          <Button ref={optionsTrigger} disabled={busy} onClick={() => setOptionsOpen(true)}><SlidersHorizontal className="size-4" aria-hidden="true"/>选稿设置</Button>
          {binding ? <Button tone="primary" disabled={busy || missingBodies > 0} onClick={() => void bindMaterials()}>绑定证据并返回</Button> : <Button tone="primary" disabled={!!generationHold} onClick={() => void create(true)}>一键评估并成稿<ArrowRight className="size-4" aria-hidden="true"/></Button>}
        </div>
        {((!binding && generationHold) || missingBodies > 0) && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs leading-5 text-amber-ink" role="status"><span>{binding && missingBodies ? '还缺 ' + missingBodies + ' 条正文，请先补齐。' : generationHold}</span>{missingBodies > 0 && <Button size="sm" disabled={busy} onClick={() => void extract()}>补齐所选正文 / 日期</Button>}{!data.generation.ready && !binding && <Link to="/admin/channels" className="text-accent">检查模型连接 →</Link>}</div>}
      </section>}
      <Dialog open={optionsOpen} onOpenChange={setOptionsOpen}><DialogContent className="space-y-4" onCloseAutoFocus={event => { const target = optionsTrigger.current?.isConnected ? optionsTrigger.current : document.querySelector<HTMLInputElement>('input[name="q"]'); if (target) { event.preventDefault(); target.focus(); } }}><DialogTitle>所选材料与写作设置</DialogTitle><DialogDescription>一次最多选 12 条材料；现有自动成稿每次最多 4 条。多条合成一期短讯的流程尚未接入。</DialogDescription>
        <ul className="max-h-44 divide-y divide-line overflow-y-auto">{selected.map(a => <li key={a.id} className="flex items-start gap-2 py-3 text-sm"><span className="min-w-0 flex-1">{a.title}<span className="mt-1 block text-xs text-ink-4">{bodyReady(a) ? '正文可读' : '缺少正文'}</span></span><Button size="sm" tone="ghost" disabled={busy} aria-label={'移除 ' + a.title} onClick={() => setSelected(items => items.filter(item => item.id !== a.id))}>移除</Button></li>)}</ul>
        <Button disabled={busy || !selected.length} onClick={() => { setOptionsOpen(false); void extract(); }}>{extracting ? '正在补齐…' : '补齐所选正文 / 日期'}</Button>
        {!binding && <><label className="text-sm text-ink-2">目标页面（选填）<Input value={target} onChange={e => setTarget(e.target.value)} placeholder="https://www.chipshow.com/..." className="mt-2"/></label><label className="text-sm text-ink-2">内容类型<Input value={pageType} onChange={e => setPageType(e.target.value)} className="mt-2"/></label><DirectPublish materialIds={selected.map(a => a.id)} disabled={busy || !data.generation.ready || missingBodies > 0} onQueued={() => {setSelected([]); setOptionsOpen(false); switchTab('tasks');}}/><Button disabled={busy || !selected.length || missingBodies > 0 || !targetValid} onClick={async () => {await create(); setOptionsOpen(false);}}>另存为 Agent 文件任务</Button><p className="text-xs leading-5 text-ink-4">直接上线沿用当前设置；打开此面板不会切换发布模式或调用模型。</p></>}
      </DialogContent></Dialog>
    </>}
    {tab==='tasks'&&<Card title="采编任务"><p className="mb-4 text-sm leading-6 text-ink-3">这里保留每次评估的判断理由。写作中断后可继续原任务；需要其他 Agent 协助时再下载任务并导入结果。</p>{importError&&<p role="alert" className="mb-3 text-sm text-hot">{importError}</p>}<div className="divide-y divide-line">{data.tasks.map(t=><article key={t.id} id={'task-'+t.id} className="flex scroll-mt-20 flex-wrap items-center gap-3 py-4 target:bg-accent-soft"><div className="min-w-0 flex-1"><span className="text-sm font-medium">{t.editorial_plan?.question??`${t.materials} 条素材`}</span><span className="ml-3 text-xs text-ink-4"><Time at={t.created_at}/></span><p className="mt-1 break-all font-mono text-[10px] text-ink-4">{t.id}</p></div><Badge tone={t.state==='blocked'?'bad':t.state==='received'?'ok':'warn'}>{t.state==='blocked'?'否决项阻断':t.state==='received'?`已评估 · ${t.drafts} 份稿件`:'待成稿 / 可继续'}</Badge>{t.state==='waiting'&&<Button disabled={busy||!data.generation.ready||t.materials===0||t.materials>4} onClick={async()=>{const result=await run<{drafts?:number}>('POST',`/api/admin/studio/tasks/${t.id}/generate`,{}, {success:'评估完成，请查看选题理由和稿件。',label:t.id});if(result&&(result.drafts??0)>0)switchTab('drafts');}}>评估并成稿</Button>}{t.editorial_plan&&t.state==='waiting'&&<Link to={`/admin/studio?tab=materials&bind_task=${t.id}`} className="text-sm text-accent">绑定/补充证据</Link>}<a href={`/api/admin/studio/tasks/${t.id}/export`} className="text-sm font-medium text-accent">下载任务</a><label className="cursor-pointer rounded-control border border-line px-3 py-2 text-sm">导入结果<input className="sr-only" type="file" accept=".json,application/json" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{setImportError('');const response=JSON.parse(await file.text());const done=await run('POST',`/api/admin/studio/tasks/${t.id}/receive`,response,{success:'结果已导入，请进入稿件审稿。'});if(done)switchTab('drafts');}catch{setImportError('文件不是可读取的 JSON，请使用任务要求的返回文件。')}e.target.value='';}}/></label>{t.editorial_gate?.blocked&&<details className="w-full"><summary className="cursor-pointer text-sm text-hot">查看否决项与命中位置</summary><ul>{t.editorial_gate.findings.filter(f=>f.severity==='BLOCK').map((f,i)=><li key={i} className="my-3 break-words text-sm"><strong>{f.ruleId} · {f.field} · {f.start}–{f.end}</strong><p>{f.reason}</p><blockquote>{f.quote}</blockquote></li>)}</ul><p className="text-xs text-ink-3">请修改原返回文件后重新导入；人工确认不能放行BLOCK。</p></details>}{t.decisions&&<details className="w-full"><summary className="cursor-pointer text-sm text-accent">查看逐条选题理由</summary><ul className="mt-3 space-y-3">{t.decisions.map(d=><li key={d.article_id}><p className="text-sm font-medium">{t.articles.find(a=>a.id===d.article_id)?.title??d.article_id}</p><EditorialResult value={d}/></li>)}</ul></details>}</article>)}{!data.tasks.length&&<p className="py-8 text-sm text-ink-3">还没有任务。先在素材池中选择完整正文，点击“创建采编任务”。</p>}</div></Card>}
    {tab==='drafts'&&<Card title="稿件与审稿"><div className="mb-3 flex flex-wrap gap-2">{['','draft','in_review','approved'].map(state=><button key={state} className={`rounded-full px-3 py-1.5 text-xs ${(sp.get('status')||'')===state?'bg-accent text-white':'bg-bg-sunk text-ink-3'}`} onClick={()=>setSp(new URLSearchParams({tab:'drafts',status:state}))}>{labels[state]||'全部稿件'}</button>)}</div><div className="divide-y divide-line">{data.drafts.filter(d=>!sp.get('status')||d.status===sp.get('status')).map(d=><Link key={d.id} to={`/admin/studio/drafts/${d.id}`} className="flex items-center gap-3 py-4"><div className="min-w-0 flex-1"><h2 className="text-[15px] font-medium text-ink">{d.title_zh}</h2><p className="mt-1 text-xs text-ink-4">{d.title_en}</p></div><Badge tone={d.status==='approved'?'ok':d.status==='in_review'?'warn':'muted'}>{labels[d.status]}</Badge><span className="text-xs text-ink-4">v{d.version}</span></Link>)}{!data.drafts.length&&<p className="py-8 text-sm text-ink-3">导入 Agent 结果后，稿件会出现在这里。原文和草稿不会直接对外发布。</p>}</div></Card>}
    {tab==='sources'&&<div className="grid gap-4 md:grid-cols-2"><div className="md:col-span-2"><Link to="/admin/sources/new" className="text-sm font-medium text-accent">＋ 添加信源</Link><p className="mt-2 text-xs text-ink-3">支持手动采集。失败会保留错误原因和已有材料，可调整来源后重试。</p></div>{data.sources.map(s=><Card key={s.id} title={s.name} right={<Badge tone={healthTone(s.health)}>{healthLabels[s.health]||'待检查'}</Badge>}><p className="text-sm text-ink-3">{s.materials} 条素材 · 最近采集 <Time at={s.last_fetch}/></p>{s.last_fetch_status&&<p className="mt-2 text-xs text-ink-3">最近结果：{fetchLabels[s.last_fetch_status]||'待核实'}</p>}{s.last_fetch_error&&<p role="status" className="mt-2 break-words text-sm leading-6 text-hot">最近采集失败：{s.last_fetch_error}</p>}<div className="mt-4 flex items-center gap-3"><Button tone="primary" disabled={busy||!['rss','web_list','json_list'].includes(s.kind)} onClick={async()=>{const result=await run<{status:string;created:number;error?:string}>('POST',`/api/admin/studio/sources/${s.id}/collect`,{}, {label:s.id});if(result)setImportError(result.status==='ok'?`${s.name} 采集完成，新增 ${result.created} 条。`:`${s.name}：${result.error||fetchLabels[result.status]||'结果待核实'}`);}}>{s.last_fetch_error||['failed','error','aborted'].includes(s.last_fetch_status||'')?'重试采集':'立即采集'}</Button><Link className="text-sm text-accent" to={`/admin/sources/${s.id}`}>调整信源</Link></div></Card>)}{importError&&<p role="status" className="text-sm text-ink-2">{importError}</p>}</div>}
  </AdminPage>;
}
