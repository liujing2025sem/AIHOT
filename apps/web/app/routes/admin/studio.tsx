import { useEffect, useRef, useState } from 'react';
import { Form, Link, useRevalidator, useSearchParams } from 'react-router';
import type { Route } from './+types/studio';
import { adminGet } from '../../lib/admin.server';
import { useAdminAction } from '../../features/admin/action';
import { AdminPage, Badge, Button, Card, healthTone, Input, Stat, Time } from '../../features/admin/ui';

type ExtractionState = 'ok' | 'partial' | 'unconfirmed' | 'skipped' | 'conflict' | 'unsupported' | 'failed';
type Material = { id: string; title: string; url: string; source_name: string; published_at: string | null; publication_time: string | null; discovered_at: string; body_status: string; body_length: number | null; body_text?: string | null; last_extraction: { state: ExtractionState; notice: string; at: string } | null };
type Extraction = { state: ExtractionState; notice: string; changes: { body: boolean; date: boolean }; material: Material };
type BatchResult = { id: string; title: string; result: Extraction | null };
type Draft = { id: string; title_zh: string; title_en: string; status: string; updated_at: string; version: number };
type Overview = { rows: Material[]; total: number; page: number; stats: Record<string, number>; sources: { id: string; name: string; kind: string; health: string; materials: number; last_fetch: string | null; last_fetch_status: string | null; last_fetch_error: string | null }[]; tasks: { id: string; state: string; materials: number; created_at: string }[]; drafts: Draft[] };
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
  return adminGet<Overview>(request, '/api/admin/studio' + new URL(request.url).search);
}
export const meta = () => [{ title: '采编工作台 · Chipshow Studio' }];
export default function Studio({ loaderData: data }: Route.ComponentProps) {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'materials';
  const [selected, setSelected] = useState<Material[]>([]);
  const [target, setTarget] = useState('');
  const [pageType, setPageType] = useState('行业资讯');
  const [importError, setImportError] = useState('');
  const { run, busy: actionBusy } = useAdminAction();
  const revalidator = useRevalidator();
  const [extracting, setExtracting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [batchTotal, setBatchTotal] = useState(0);
  const [results, setResults] = useState<BatchResult[]>([]);
  const extractingRef = useRef(false);
  const stopRef = useRef(false);
  const busy = actionBusy || extracting;
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
  const create = async () => {
    if (busy || extractingRef.current || !selected.length || selected.length > 12 || missingBodies) return;
    const writing = target.trim() ? { site: new URL(target).hostname.replace(/^www\./, ''), target_url: target.trim(), page_type: pageType } : undefined;
    const result = await run<{ id: string }>('POST', '/api/admin/studio/tasks', { article_ids: selected.map(a => a.id), writing }, { success: '任务已保存。下载后交给 Codex 或其他 Agent，导入返回的 JSON 即可继续审稿。' });
    if (result) { setSelected([]); switchTab('tasks'); }
  };
  return <AdminPage title="采编工作台" subtitle="从原始资讯到可交付稿件，所有内容都保留来源。" actions={<Link className="text-sm text-accent" to="/admin/channels">API 渠道设置 →</Link>}>
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="素材总量" value={data.stats.materials} /><Stat label="正文可读" value={data.stats.body_ready} hint={`${data.stats.undated} 条发布日期待核实`} /><Stat label="等待审稿" value={data.stats.review} /><Stat label="审核通过" value={data.stats.approved} /></div>
    <nav aria-label="采编阶段" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">{[['materials','素材池'],['tasks','Agent 任务'],['drafts','稿件与审稿'],['sources','采集信源']].map(([key,label])=><button key={key} onClick={()=>switchTab(key)} className={`shrink-0 border-b-2 px-5 py-3 text-sm ${tab===key?'border-accent font-semibold text-accent':'border-transparent text-ink-3'}`}>{label}</button>)}</nav>
    {selected.length > 0 && <Card className="mb-4" title={`已选 ${selected.length}/12 条 · 筛选、翻页后仍保留`} right={<Button size="sm" disabled={busy} onClick={() => setSelected([])}>清空选择</Button>}>
      <details><summary className="cursor-pointer text-sm text-accent">查看已选素材{missingBodies > 0 ? `，其中 ${missingBodies} 条还缺完整正文` : '，正文均可用于采编'}</summary><ul className="mt-3 divide-y divide-line">{selected.map(a => <li key={a.id} className="flex items-start gap-3 py-2 text-sm"><div className="min-w-0 flex-1"><Link to={`/admin/studio/materials/${a.id}`} className="text-accent">{a.title}</Link><p className="mt-1 text-xs text-ink-3">{a.source_name} · {bodyReady(a) ? '正文可读' : '待补正文'} · {a.published_at ? '有发布日期' : '日期待核'}</p></div><Button size="sm" tone="ghost" disabled={busy} aria-label={`移除 ${a.title}`} onClick={() => setSelected(items => items.filter(item => item.id !== a.id))}>移除</Button></li>)}</ul></details>
    </Card>}
    {batchTotal > 0 && <Card className="mb-4" title={`素材补齐 ${results.length}/${batchTotal}`} right={extracting ? <Button size="sm" disabled={stopping} onClick={() => { stopRef.current = true; setStopping(true); }}>停止后续</Button> : undefined}>
      <p role="status" aria-live="polite" className="text-sm text-ink-3">{extracting ? stopping ? '正在完成当前请求，随后停止。' : `正在处理第 ${Math.min(results.length + 1, batchTotal)} 条，请稍候。` : results.length < batchTotal ? `已停止，剩余 ${batchTotal - results.length} 条未处理。` : '本批处理结束，请查看每条结果。'}</p>
      <div role="progressbar" aria-valuenow={results.length} aria-valuemin={0} aria-valuemax={batchTotal} aria-label="素材补齐进度" className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-sunk"><div className="h-full bg-accent" style={{width: `${results.length / batchTotal * 100}%`}} /></div>
      <ul className="mt-3 divide-y divide-line">{results.map(({ id, title, result }) => <li key={id} className="py-3 text-sm"><p className="font-medium text-ink">{title}</p><div className="mt-2 flex flex-wrap gap-2"><Badge tone={result?.state === 'ok' || result?.state === 'skipped' ? 'ok' : !result || result.state === 'failed' || result.state === 'conflict' ? 'bad' : 'warn'}>{result ? extractionLabels[result.state] : '请求失败'}</Badge><Badge tone={result?.changes.body ? 'ok' : 'muted'}>{!result ? '正文未确认' : result.changes.body ? '已补正文' : result.material?.body_status === 'ok' ? '正文已齐' : '待补正文'}</Badge><Badge tone={result?.changes.date ? 'ok' : 'muted'}>{!result ? '日期未确认' : result.changes.date ? '已补日期' : result.material?.published_at ? '日期已齐' : '日期待核'}</Badge></div><p className="mt-2 break-words text-xs leading-5 text-ink-3">{result?.notice || '未取得补齐结果，请查看错误提示后重试。'}</p></li>)}</ul>
    </Card>}
    {tab==='materials' && <>
      <Form className="mb-4 flex flex-wrap gap-2" method="get"><input type="hidden" name="tab" value="materials" /><Input name="q" defaultValue={sp.get('q')||''} placeholder="搜索标题" aria-label="搜索素材" className="max-w-xs" /><select name="source" defaultValue={sp.get('source')||''} className="rounded-control border border-line bg-surface px-3 py-2 text-sm"><option value="">全部信源</option>{data.sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><select name="quality" defaultValue={sp.get('quality')??'ready'} className="rounded-control border border-line bg-surface px-3 py-2 text-sm"><option value="">全部材料</option><option value="ready">正文可读</option><option value="missing-body">待补正文</option><option value="missing-date">待核发布日期</option></select><Button type="submit">筛选</Button></Form>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card pad={false}><div className="divide-y divide-line">{data.rows.map(a=><article key={a.id} className="flex gap-3 p-4"><input className="mt-1 size-4 shrink-0 accent-[#176b75]" type="checkbox" aria-label={`选择 ${a.title}`} disabled={busy||selected.length>=12&&!selected.some(item=>item.id===a.id)} checked={selected.some(item=>item.id===a.id)} onChange={e=>setSelected(items=>e.target.checked?items.length<12&&!items.some(item=>item.id===a.id)?[...items,a]:items:items.filter(item=>item.id!==a.id))}/><div className="min-w-0 flex-1"><Link to={`/admin/studio/materials/${a.id}`} className="text-[15px] font-semibold leading-6 text-ink hover:text-accent">{a.title}</Link><div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-3"><span>{a.source_name}</span><span>·</span><PublicationDate material={a}/><Badge tone={a.body_status==='ok'?'ok':'warn'}>{a.body_status==='ok'?`正文 ${a.body_length ?? 0} 字`:'待补正文'}</Badge></div>{a.last_extraction&&<p className="mt-2 break-words text-xs leading-5 text-ink-3">最近补齐：{extractionLabels[a.last_extraction.state]} · {a.last_extraction.notice}</p>}</div><a className="shrink-0 text-xs text-accent" href={a.url} target="_blank" rel="noreferrer">原文 ↗</a></article>)}{!data.rows.length&&<p className="p-8 text-sm text-ink-3">暂无符合条件的素材。可换个筛选条件，或在“采集信源”中采集。</p>}</div><div className="flex justify-between border-t border-line p-4 text-sm"><span>共 {data.total} 条 · 第 {data.page} 页</span><span className="flex gap-4">{data.page>1&&<Link to={'?'+new URLSearchParams({...Object.fromEntries(sp),page:String(data.page-1)})}>上一页</Link>}{data.page*30<data.total&&<Link to={'?'+new URLSearchParams({...Object.fromEntries(sp),page:String(data.page+1)})}>下一页</Link>}</span></div></Card>
        <div className="space-y-4"><Card title={`已选 ${selected.length} 条素材`}><p className="mb-3 text-sm leading-6 text-ink-3">可选择待补正文或日期的材料，每批最多12条。补齐后，正文完整的材料才能创建采编任务。</p><Button className="mb-3 w-full" disabled={busy||!selected.length||selected.length>12} onClick={()=>void extract()}>{extracting?'正在补齐…':'补齐所选正文 / 日期'}</Button><p className="mb-4 text-xs leading-5 text-ink-3">{missingBodies ? `还缺 ${missingBodies} 条完整正文，请先补齐或移除这些材料。` : selected.length ? '所选正文均完整，可以创建采编任务。' : '先勾选素材；翻页或筛选不会清空已选列表。'}{selected.length===12&&' 已达本批上限。'}</p><label className="block text-xs text-ink-3">目标页面（选填）<input value={target} onChange={e=>setTarget(e.target.value)} placeholder="https://www.chipshow.com/..." className="mt-1 w-full rounded-control border border-line bg-surface p-2 text-sm" /></label><label className="mt-3 block text-xs text-ink-3">内容类型<input value={pageType} onChange={e=>setPageType(e.target.value)} className="mt-1 w-full rounded-control border border-line bg-surface p-2 text-sm" /></label><Button tone="primary" className="mt-4 w-full" disabled={busy||!selected.length||selected.length>12||missingBodies>0||!!target&&!/^https:\/\/(www\.)?(chipshow\.com|chipshowledusa\.com|chipshow\.eu|unishineled\.com)(\/|$)/.test(target)} onClick={()=>void create()}>创建采编任务</Button><p className="mt-3 text-xs leading-5 text-ink-4">不填目标页面时，按中立行业资讯成稿。缺少发布日期的素材会保留待核标记。</p></Card><Card title="同事协作"><p className="text-sm leading-6 text-ink-3">所有登录同事均为管理员。保存、送审、退回和通过审核会留下记录。</p></Card></div>
      </div>
    </>}
    {tab==='tasks'&&<Card title="Agent 采编任务"><p className="mb-4 text-sm leading-6 text-ink-3">下载任务文件，交给 Codex / Harness；文件包含原文、写作规则和返回格式。导入结果后在“稿件与审稿”继续工作。</p>{importError&&<p role="alert" className="mb-3 text-sm text-hot">{importError}</p>}<div className="divide-y divide-line">{data.tasks.map(t=><article key={t.id} className="flex flex-wrap items-center gap-3 py-4"><div className="min-w-0 flex-1"><span className="text-sm font-medium">{t.materials} 条素材</span><span className="ml-3 text-xs text-ink-4"><Time at={t.created_at}/></span><p className="mt-1 break-all font-mono text-[10px] text-ink-4">{t.id}</p></div><Badge tone={t.state==='received'?'ok':'warn'}>{t.state==='received'?'结果已导入':'等待 Agent 返回'}</Badge>{t.state==='waiting'&&<Button disabled={busy||t.materials>4} onClick={async()=>{const result=await run('POST',`/api/admin/studio/tasks/${t.id}/generate`,{}, {success:'API 成稿已进入稿件列表。',label:t.id});if(result)switchTab('drafts');}}>通过 API 成稿</Button>}<a href={`/api/admin/studio/tasks/${t.id}/export`} className="text-sm font-medium text-accent">下载任务</a><label className="cursor-pointer rounded-control border border-line px-3 py-2 text-sm">导入结果<input className="sr-only" type="file" accept=".json,application/json" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{setImportError('');const response=JSON.parse(await file.text());const done=await run('POST',`/api/admin/studio/tasks/${t.id}/receive`,response,{success:'结果已导入，请进入稿件审稿。'});if(done)switchTab('drafts');}catch{setImportError('文件不是可读取的 JSON，请使用任务要求的返回文件。')}e.target.value='';}}/></label></article>)}{!data.tasks.length&&<p className="py-8 text-sm text-ink-3">还没有任务。先在素材池中选择完整正文，点击“创建采编任务”。</p>}</div></Card>}
    {tab==='drafts'&&<Card title="稿件与审稿"><div className="mb-3 flex flex-wrap gap-2">{['','draft','in_review','approved'].map(state=><button key={state} className={`rounded-full px-3 py-1.5 text-xs ${(sp.get('status')||'')===state?'bg-accent text-white':'bg-bg-sunk text-ink-3'}`} onClick={()=>setSp(new URLSearchParams({tab:'drafts',status:state}))}>{labels[state]||'全部稿件'}</button>)}</div><div className="divide-y divide-line">{data.drafts.filter(d=>!sp.get('status')||d.status===sp.get('status')).map(d=><Link key={d.id} to={`/admin/studio/drafts/${d.id}`} className="flex items-center gap-3 py-4"><div className="min-w-0 flex-1"><h2 className="text-[15px] font-medium text-ink">{d.title_zh}</h2><p className="mt-1 text-xs text-ink-4">{d.title_en}</p></div><Badge tone={d.status==='approved'?'ok':d.status==='in_review'?'warn':'muted'}>{labels[d.status]}</Badge><span className="text-xs text-ink-4">v{d.version}</span></Link>)}{!data.drafts.length&&<p className="py-8 text-sm text-ink-3">导入 Agent 结果后，稿件会出现在这里。原文和草稿不会直接对外发布。</p>}</div></Card>}
    {tab==='sources'&&<div className="grid gap-4 md:grid-cols-2"><div className="md:col-span-2"><Link to="/admin/sources/new" className="text-sm font-medium text-accent">＋ 添加信源</Link><p className="mt-2 text-xs text-ink-3">支持手动采集。失败会保留错误原因和已有材料，可调整来源后重试。</p></div>{data.sources.map(s=><Card key={s.id} title={s.name} right={<Badge tone={healthTone(s.health)}>{healthLabels[s.health]||'待检查'}</Badge>}><p className="text-sm text-ink-3">{s.materials} 条素材 · 最近采集 <Time at={s.last_fetch}/></p>{s.last_fetch_status&&<p className="mt-2 text-xs text-ink-3">最近结果：{fetchLabels[s.last_fetch_status]||'待核实'}</p>}{s.last_fetch_error&&<p role="status" className="mt-2 break-words text-sm leading-6 text-hot">最近采集失败：{s.last_fetch_error}</p>}<div className="mt-4 flex items-center gap-3"><Button tone="primary" disabled={busy||!['rss','web_list','json_list'].includes(s.kind)} onClick={async()=>{const result=await run<{status:string;created:number;error?:string}>('POST',`/api/admin/studio/sources/${s.id}/collect`,{}, {label:s.id});if(result)setImportError(result.status==='ok'?`${s.name} 采集完成，新增 ${result.created} 条。`:`${s.name}：${result.error||fetchLabels[result.status]||'结果待核实'}`);}}>{s.last_fetch_error||['failed','error','aborted'].includes(s.last_fetch_status||'')?'重试采集':'立即采集'}</Button><Link className="text-sm text-accent" to={`/admin/sources/${s.id}`}>调整信源</Link></div></Card>)}{importError&&<p role="status" className="text-sm text-ink-2">{importError}</p>}</div>}
  </AdminPage>;
}
