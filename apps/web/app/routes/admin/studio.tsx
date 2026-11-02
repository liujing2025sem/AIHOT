import { useEffect, useRef, useState } from 'react';
import { Form, Link, useRevalidator, useSearchParams } from 'react-router';
import type { Route } from './+types/studio';
import { adminGet } from '../../lib/admin.server';
import { useAdminAction } from '../../features/admin/action';
import { AdminPage, Badge, Button, Card, healthTone, Input, Stat, Time } from '../../features/admin/ui';

type ExtractionState = 'ok' | 'partial' | 'unconfirmed' | 'skipped' | 'conflict' | 'unsupported' | 'failed';
type Editorial = { decision: 'KEEP' | 'SKIP' | 'HOLD'; reason_zh: string; task_id?: string };
type Material = { id: string; title: string; url: string; source_name: string; published_at: string | null; publication_time: string | null; discovered_at: string; body_status: string; body_length: number | null; body_text?: string | null; editorial?: Editorial | null; last_extraction: { state: ExtractionState; notice: string; at: string } | null };
type Extraction = { state: ExtractionState; notice: string; changes: { body: boolean; date: boolean }; material: Material };
type BatchResult = { id: string; title: string; result: Extraction | null };
type Draft = { id: string; title_zh: string; title_en: string; status: string; updated_at: string; version: number };
type ReviewMetrics={tier:number;backtestConfirmed:boolean;totalDrafts:number;observedDrafts:number;unobservedDrafts:number;interventionRate:number|null;zeroMissStreak:number;eligible20:boolean;eligible10:boolean;note:string;trend:{at:string;substantive:boolean;minutes:number|null;fullReview:boolean;majorFactError:boolean}[]};
type Overview = { reviewMetrics:ReviewMetrics; rows: Material[]; total: number; page: number; stats: Record<string, number>; generation: { ready: boolean; reason: string }; sources: { id: string; name: string; kind: string; health: string; materials: number; last_fetch: string | null; last_fetch_status: string | null; last_fetch_error: string | null }[]; tasks: { id: string; state: string; materials: number; created_at: string; editorial_gate?:{blocked:boolean;findings:{ruleId:string;severity:string;field:string;start:number;end:number;quote:string;reason:string}[]}; drafts: number; articles: { id: string; title: string }[]; decisions: (Editorial & { article_id: string })[] | null }[]; drafts: Draft[] };
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
  const [overview,reviewMetrics]=await Promise.all([adminGet<Omit<Overview,'reviewMetrics'>>(request, '/api/admin/studio' + new URL(request.url).search),adminGet<ReviewMetrics>(request,'/api/admin/studio/review-metrics')]);
  return {...overview,reviewMetrics};
}
export const meta = () => [{ title: '采编工作台 · Chipshow Studio' }];
export default function Studio({ loaderData: data }: Route.ComponentProps) {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'materials';
  const [selected, setSelected] = useState<Material[]>([]);
  const [target, setTarget] = useState('');
  const [pageType, setPageType] = useState('行业资讯');
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
  return <AdminPage title="采编工作台" subtitle="从原始资讯到可交付稿件，所有内容都保留来源。" actions={<Link className="text-sm text-accent" to="/admin/channels">API 渠道设置 →</Link>}>
    <Card className="mb-5" title="选素材 → 一键评估并成稿 → 审稿"><p className="text-sm leading-6 text-ink-3">系统先判断信息增量、行业影响和证据条件，只为值得写的材料成稿；不适合的说明原因。稿件保留原文与日期，供你核对后使用。</p><p className="mt-2 text-sm text-ink-3">{data.generation.reason} {!data.generation.ready && <Link className="text-accent" to="/admin/channels">配置写作渠道 →</Link>}</p><p role="status" aria-live="polite" className="mt-2 text-sm text-accent">{generationStep}</p></Card>
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="素材总量" value={data.stats.materials} /><Stat label="正文可读" value={data.stats.body_ready} hint={`${data.stats.undated} 条发布日期待核实`} /><Stat label="等待审稿" value={data.stats.review} /><Stat label="审核通过" value={data.stats.approved} /></div>
    <nav aria-label="采编阶段" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">{[['materials','素材池'],['tasks','Agent 任务'],['drafts','稿件与审稿'],['sources','采集信源'],['review','人工介入与档位']].map(([key,label])=><button key={key} onClick={()=>switchTab(key)} className={`shrink-0 border-b-2 px-5 py-3 text-sm ${tab===key?'border-accent font-semibold text-accent':'border-transparent text-ink-3'}`}>{label}</button>)}</nav>
    {selected.length > 0 && <Card className="mb-4" title={`已选 ${selected.length}/12 条 · 筛选、翻页后仍保留`} right={<Button size="sm" disabled={busy} onClick={() => setSelected([])}>清空选择</Button>}>
      <details><summary className="cursor-pointer text-sm text-accent">查看已选素材{missingBodies > 0 ? `，其中 ${missingBodies} 条还缺完整正文` : '，正文均可用于采编'}</summary><ul className="mt-3 divide-y divide-line">{selected.map(a => <li key={a.id} className="flex items-start gap-3 py-2 text-sm"><div className="min-w-0 flex-1"><Link to={`/admin/studio/materials/${a.id}`} className="text-accent">{a.title}</Link><p className="mt-1 text-xs text-ink-3">{a.source_name} · {bodyReady(a) ? '正文可读' : '待补正文'} · {a.published_at ? '有发布日期' : '日期待核'}</p></div><Button size="sm" tone="ghost" disabled={busy} aria-label={`移除 ${a.title}`} onClick={() => setSelected(items => items.filter(item => item.id !== a.id))}>移除</Button></li>)}</ul></details>
    </Card>}
    {batchTotal > 0 && <Card className="mb-4" title={`素材补齐 ${results.length}/${batchTotal}`} right={extracting ? <Button size="sm" disabled={stopping} onClick={() => { stopRef.current = true; setStopping(true); }}>停止后续</Button> : undefined}>
      <p role="status" aria-live="polite" className="text-sm text-ink-3">{extracting ? stopping ? '正在完成当前请求，随后停止。' : `正在处理第 ${Math.min(results.length + 1, batchTotal)} 条，请稍候。` : results.length < batchTotal ? `已停止，剩余 ${batchTotal - results.length} 条未处理。` : '本批处理结束，请查看每条结果。'}</p>
      <div role="progressbar" aria-valuenow={results.length} aria-valuemin={0} aria-valuemax={batchTotal} aria-label="素材补齐进度" className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-sunk"><div className="h-full bg-accent" style={{width: `${results.length / batchTotal * 100}%`}} /></div>
      <ul className="mt-3 divide-y divide-line">{results.map(({ id, title, result }) => <li key={id} className="py-3 text-sm"><p className="font-medium text-ink">{title}</p><div className="mt-2 flex flex-wrap gap-2"><Badge tone={result?.state === 'ok' || result?.state === 'skipped' ? 'ok' : !result || result.state === 'failed' || result.state === 'conflict' ? 'bad' : 'warn'}>{result ? extractionLabels[result.state] : '请求失败'}</Badge><Badge tone={result?.changes.body ? 'ok' : 'muted'}>{!result ? '正文未确认' : result.changes.body ? '已补正文' : result.material?.body_status === 'ok' ? '正文已齐' : '待补正文'}</Badge><Badge tone={result?.changes.date ? 'ok' : 'muted'}>{!result ? '日期未确认' : result.changes.date ? '已补日期' : result.material?.published_at ? '日期已齐' : '日期待核'}</Badge></div><p className="mt-2 break-words text-xs leading-5 text-ink-3">{result?.notice || '未取得补齐结果，请查看错误提示后重试。'}</p></li>)}</ul>
    </Card>}
    {tab==='review'&&<><div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="当前审稿策略" value={`${data.reviewMetrics.tier}%档`} hint="档位名称，不代表实际工时占比"/><Stat label="零漏检全审样本" value={data.reviewMetrics.zeroMissStreak}/><Stat label="人工观察覆盖" value={`${data.reviewMetrics.observedDrafts}/${data.reviewMetrics.totalDrafts}`} hint={`${data.reviewMetrics.unobservedDrafts}篇未记录`}/><Stat label="人工介入率" value={data.reviewMetrics.interventionRate===null?'未知':`${(data.reviewMetrics.interventionRate*100).toFixed(1)}%`}/></div><Card title="先回测，再决定是否降档"><p className="text-sm leading-6 text-ink-3">{data.reviewMetrics.note} 30档每篇全审；20档审WARN并每5篇抽1篇；10档仍逐字审认证、商务、客户案例和新领域首篇。</p><p className="mt-3 text-sm">历史回测人工评审：{data.reviewMetrics.backtestConfirmed?'已记录':'尚未记录'}。20档：{data.reviewMetrics.eligible20?'条件满足':'条件不足'}；10档：{data.reviewMetrics.eligible10?'条件满足':'条件不足'}。</p><textarea aria-label="档位评审说明" placeholder="填写回测报告位置、误报结论或档位变更理由" value={policyNote} onChange={e=>setPolicyNote(e.target.value)} className="my-3 min-h-24 w-full rounded-control border border-line bg-surface p-3 text-sm"/><label className="flex gap-2 text-sm"><input type="checkbox" checked={backtestConfirmed} onChange={e=>setBacktestConfirmed(e.target.checked)}/>我已评审历史BLOCK回测和误报，确认可用于降档判断</label><div className="mt-4 flex flex-wrap gap-3"><Button disabled={busy||!policyNote.trim()||!backtestConfirmed} onClick={()=>void run('POST','/api/admin/studio/review-policy',{tier:data.reviewMetrics.tier,backtest_confirmed:true,note:policyNote},{success:'已记录回测人工评审。'})}>记录回测评审</Button>{[20,10].map(tier=><Button key={tier} disabled={busy||!policyNote.trim()||!(tier===20?data.reviewMetrics.eligible20:data.reviewMetrics.eligible10)} onClick={()=>void run('POST','/api/admin/studio/review-policy',{tier,backtest_confirmed:true,note:policyNote},{success:'审稿策略已调整。'})}>采用{tier}%档</Button>)}</div></Card><Card className="mt-5" title="最近稿件的人工介入"><div className="divide-y divide-line">{data.reviewMetrics.trend.map((r,i)=><p key={i} className="py-3 text-sm"><Time at={r.at}/> · {r.substantive?'实质修改':'无需实质修改'} · {r.minutes===null?'耗时未知':`${r.minutes}分钟`} · {r.fullReview?'全审':'局部审查'}{r.majorFactError?' · 重大事实错误，已退档':''}</p>)}{!data.reviewMetrics.trend.length&&<p className="py-6 text-sm text-ink-3">尚无人工观察记录。请在稿件页填写本稿修改类型、耗时和全审情况。</p>}</div></Card></>}
    {tab==='materials' && <>
      <Form className="mb-4 flex flex-wrap gap-2" method="get"><input type="hidden" name="tab" value="materials" /><Input name="q" defaultValue={sp.get('q')||''} placeholder="搜索标题" aria-label="搜索素材" className="max-w-xs" /><select name="source" defaultValue={sp.get('source')||''} className="rounded-control border border-line bg-surface px-3 py-2 text-sm"><option value="">全部信源</option>{data.sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><select name="quality" defaultValue={sp.get('quality')??'ready'} className="rounded-control border border-line bg-surface px-3 py-2 text-sm"><option value="">全部材料</option><option value="ready">正文可读</option><option value="missing-body">待补正文</option><option value="missing-date">待核发布日期</option></select><Button type="submit">筛选</Button></Form>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card pad={false}><div className="divide-y divide-line">{data.rows.map(a=><article key={a.id} className="flex gap-3 p-4"><input className="mt-1 size-4 shrink-0 accent-[#176b75]" type="checkbox" aria-label={`选择 ${a.title}`} disabled={busy||selected.length>=12&&!selected.some(item=>item.id===a.id)} checked={selected.some(item=>item.id===a.id)} onChange={e=>setSelected(items=>e.target.checked?items.length<12&&!items.some(item=>item.id===a.id)?[...items,a]:items:items.filter(item=>item.id!==a.id))}/><div className="min-w-0 flex-1"><Link to={`/admin/studio/materials/${a.id}`} className="text-[15px] font-semibold leading-6 text-ink hover:text-accent">{a.title}</Link><div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-3"><span>{a.source_name}</span><span>·</span><PublicationDate material={a}/><Badge tone={a.body_status==='ok'?'ok':'warn'}>{a.body_status==='ok'?`正文 ${a.body_length ?? 0} 字`:'待补正文'}</Badge></div>{a.editorial ? <EditorialResult value={a.editorial}/> : <p className="mt-2 text-xs text-ink-4">尚未评估选题价值</p>}{a.last_extraction&&<p className="mt-2 break-words text-xs leading-5 text-ink-3">最近补齐：{extractionLabels[a.last_extraction.state]} · {a.last_extraction.notice}</p>}</div><a className="shrink-0 text-xs text-accent" href={a.url} target="_blank" rel="noreferrer">原文 ↗</a></article>)}{!data.rows.length&&<p className="p-8 text-sm text-ink-3">暂无符合条件的素材。可换个筛选条件，或在“采集信源”中采集。</p>}</div><div className="flex justify-between border-t border-line p-4 text-sm"><span>共 {data.total} 条 · 第 {data.page} 页</span><span className="flex gap-4">{data.page>1&&<Link to={'?'+new URLSearchParams({...Object.fromEntries(sp),page:String(data.page-1)})}>上一页</Link>}{data.page*30<data.total&&<Link to={'?'+new URLSearchParams({...Object.fromEntries(sp),page:String(data.page+1)})}>下一页</Link>}</span></div></Card>
        <div className="space-y-4"><Card title={`已选 ${selected.length} 条素材`}><p className="mb-3 text-sm leading-6 text-ink-3">可选择待补正文或日期的材料，每批最多12条。补齐后，正文完整的材料才能创建采编任务。</p><Button className="mb-3 w-full" disabled={busy||!selected.length||selected.length>12} onClick={()=>void extract()}>{extracting?'正在补齐…':'补齐所选正文 / 日期'}</Button><p className="mb-4 text-xs leading-5 text-ink-3">{missingBodies ? `还缺 ${missingBodies} 条完整正文，请先补齐或移除这些材料。` : selected.length ? '所选正文均完整，可以创建采编任务。' : '先勾选素材；翻页或筛选不会清空已选列表。'}{selected.length===12&&' 已达本批上限。'}</p><label className="block text-xs text-ink-3">目标页面（选填）<input value={target} onChange={e=>setTarget(e.target.value)} placeholder="https://www.chipshow.com/..." className="mt-1 w-full rounded-control border border-line bg-surface p-2 text-sm" /></label><label className="mt-3 block text-xs text-ink-3">内容类型<input value={pageType} onChange={e=>setPageType(e.target.value)} className="mt-1 w-full rounded-control border border-line bg-surface p-2 text-sm" /></label><Button tone="primary" className="mt-4 w-full" disabled={busy||!data.generation.ready||!selected.length||selected.length>4||missingBodies>0||!targetValid} onClick={()=>void create(true)}>一键评估并成稿</Button><p className="mt-2 text-xs leading-5 text-ink-3">每次最多4条。覆盖IC、灯珠、箱体等商显方向；中文内部审稿、英文供Blog发布，其余保留判断理由。</p><Button className="mt-4 w-full" disabled={busy||!selected.length||selected.length>12||missingBodies>0||!!target&&!/^https:\/\/(www\.)?(chipshow\.com|chipshowledusa\.com|chipshow\.eu|unishineled\.com)(\/|$)/.test(target)} onClick={()=>void create()}>另存为 Agent 文件任务</Button><p className="mt-3 text-xs leading-5 text-ink-4">不填目标页面时，写中立行业资讯并准备英文Blog交付，不迁移厂商事实为齐普事实。缺少发布日期如实标明。</p></Card><Card title="同事协作"><p className="text-sm leading-6 text-ink-3">所有登录同事均为管理员。保存、送审、退回和通过审核会留下记录。</p></Card></div>
      </div>
    </>}
    {tab==='tasks'&&<Card title="Agent 采编任务"><p className="mb-4 text-sm leading-6 text-ink-3">这里保留每次评估的判断理由。写作中断后可继续原任务；需要其他 Agent 协助时再下载任务并导入结果。</p>{importError&&<p role="alert" className="mb-3 text-sm text-hot">{importError}</p>}<div className="divide-y divide-line">{data.tasks.map(t=><article key={t.id} className="flex flex-wrap items-center gap-3 py-4"><div className="min-w-0 flex-1"><span className="text-sm font-medium">{t.materials} 条素材</span><span className="ml-3 text-xs text-ink-4"><Time at={t.created_at}/></span><p className="mt-1 break-all font-mono text-[10px] text-ink-4">{t.id}</p></div><Badge tone={t.state==='blocked'?'bad':t.state==='received'?'ok':'warn'}>{t.state==='blocked'?'否决项阻断':t.state==='received'?`已评估 · ${t.drafts} 份稿件`:'待成稿 / 可继续'}</Badge>{t.state==='waiting'&&<Button disabled={busy||!data.generation.ready||t.materials>4} onClick={async()=>{const result=await run<{drafts?:number}>('POST',`/api/admin/studio/tasks/${t.id}/generate`,{}, {success:'评估完成，请查看选题理由和稿件。',label:t.id});if(result&&(result.drafts??0)>0)switchTab('drafts');}}>评估并成稿</Button>}<a href={`/api/admin/studio/tasks/${t.id}/export`} className="text-sm font-medium text-accent">下载任务</a><label className="cursor-pointer rounded-control border border-line px-3 py-2 text-sm">导入结果<input className="sr-only" type="file" accept=".json,application/json" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{setImportError('');const response=JSON.parse(await file.text());const done=await run('POST',`/api/admin/studio/tasks/${t.id}/receive`,response,{success:'结果已导入，请进入稿件审稿。'});if(done)switchTab('drafts');}catch{setImportError('文件不是可读取的 JSON，请使用任务要求的返回文件。')}e.target.value='';}}/></label>{t.editorial_gate?.blocked&&<details className="w-full"><summary className="cursor-pointer text-sm text-hot">查看否决项与命中位置</summary><ul>{t.editorial_gate.findings.filter(f=>f.severity==='BLOCK').map((f,i)=><li key={i} className="my-3 break-words text-sm"><strong>{f.ruleId} · {f.field} · {f.start}–{f.end}</strong><p>{f.reason}</p><blockquote>{f.quote}</blockquote></li>)}</ul><p className="text-xs text-ink-3">请修改原返回文件后重新导入；人工确认不能放行BLOCK。</p></details>}{t.decisions&&<details className="w-full"><summary className="cursor-pointer text-sm text-accent">查看逐条选题理由</summary><ul className="mt-3 space-y-3">{t.decisions.map(d=><li key={d.article_id}><p className="text-sm font-medium">{t.articles.find(a=>a.id===d.article_id)?.title??d.article_id}</p><EditorialResult value={d}/></li>)}</ul></details>}</article>)}{!data.tasks.length&&<p className="py-8 text-sm text-ink-3">还没有任务。先在素材池中选择完整正文，点击“创建采编任务”。</p>}</div></Card>}
    {tab==='drafts'&&<Card title="稿件与审稿"><div className="mb-3 flex flex-wrap gap-2">{['','draft','in_review','approved'].map(state=><button key={state} className={`rounded-full px-3 py-1.5 text-xs ${(sp.get('status')||'')===state?'bg-accent text-white':'bg-bg-sunk text-ink-3'}`} onClick={()=>setSp(new URLSearchParams({tab:'drafts',status:state}))}>{labels[state]||'全部稿件'}</button>)}</div><div className="divide-y divide-line">{data.drafts.filter(d=>!sp.get('status')||d.status===sp.get('status')).map(d=><Link key={d.id} to={`/admin/studio/drafts/${d.id}`} className="flex items-center gap-3 py-4"><div className="min-w-0 flex-1"><h2 className="text-[15px] font-medium text-ink">{d.title_zh}</h2><p className="mt-1 text-xs text-ink-4">{d.title_en}</p></div><Badge tone={d.status==='approved'?'ok':d.status==='in_review'?'warn':'muted'}>{labels[d.status]}</Badge><span className="text-xs text-ink-4">v{d.version}</span></Link>)}{!data.drafts.length&&<p className="py-8 text-sm text-ink-3">导入 Agent 结果后，稿件会出现在这里。原文和草稿不会直接对外发布。</p>}</div></Card>}
    {tab==='sources'&&<div className="grid gap-4 md:grid-cols-2"><div className="md:col-span-2"><Link to="/admin/sources/new" className="text-sm font-medium text-accent">＋ 添加信源</Link><p className="mt-2 text-xs text-ink-3">支持手动采集。失败会保留错误原因和已有材料，可调整来源后重试。</p></div>{data.sources.map(s=><Card key={s.id} title={s.name} right={<Badge tone={healthTone(s.health)}>{healthLabels[s.health]||'待检查'}</Badge>}><p className="text-sm text-ink-3">{s.materials} 条素材 · 最近采集 <Time at={s.last_fetch}/></p>{s.last_fetch_status&&<p className="mt-2 text-xs text-ink-3">最近结果：{fetchLabels[s.last_fetch_status]||'待核实'}</p>}{s.last_fetch_error&&<p role="status" className="mt-2 break-words text-sm leading-6 text-hot">最近采集失败：{s.last_fetch_error}</p>}<div className="mt-4 flex items-center gap-3"><Button tone="primary" disabled={busy||!['rss','web_list','json_list'].includes(s.kind)} onClick={async()=>{const result=await run<{status:string;created:number;error?:string}>('POST',`/api/admin/studio/sources/${s.id}/collect`,{}, {label:s.id});if(result)setImportError(result.status==='ok'?`${s.name} 采集完成，新增 ${result.created} 条。`:`${s.name}：${result.error||fetchLabels[result.status]||'结果待核实'}`);}}>{s.last_fetch_error||['failed','error','aborted'].includes(s.last_fetch_status||'')?'重试采集':'立即采集'}</Button><Link className="text-sm text-accent" to={`/admin/sources/${s.id}`}>调整信源</Link></div></Card>)}{importError&&<p role="status" className="text-sm text-ink-2">{importError}</p>}</div>}
  </AdminPage>;
}
