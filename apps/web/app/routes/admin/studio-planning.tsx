import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { Route } from './+types/studio-planning';
import { adminGet } from '../../lib/admin.server';
import { useAdminAction } from '../../features/admin/action';
import { AdminPage, Card, Button, Badge, Time } from '../../features/admin/ui';

type QuestionDocument={question:string;question_en?:string;keywords_zh?:string[];keywords_en?:string[];roles:string[];scenario:string;dimension:string;existing_url:string;existing_url_provenance:'operator_entered'|'read_from_source';condition_refs:string[];source_ids:string[];demand_evidence:{type:string;reference:string}[];keywords:string[];content_type:string;requires_first_party:boolean;active:boolean};
type Question={id:string;version:number;document:QuestionDocument};
type MapData={rows:Question[];options:{roles:string[];dimensions:string[];sources:{id:string;name:string}[]}};
type Profiles={groups:{role:string;region:string;scenario:string;recordCount:number;needTags:{tag:string;count:number}[];representativeQuestions:{questionRewrite:string;count:number}[]}[];lastImportedAt:string|null;totals:{recordCount:number;groupCount:number};countingBasis:string};
type Batch={id:string;row_count:number;created_at:string};
type RecommendationRow={id:string;status:string;task_id:string|null;capacity_full?:boolean;expired?:boolean;stale:boolean;completed:boolean;baseline_found:boolean|null;document:{trigger:string;title:string;change:string;reason:string;action:string;channels:string[];existing_url:string;requires_first_party:boolean;needs_material:boolean;demand_mentions?:number;evidence_checklist?:{source_body:boolean;existing_page_body:boolean|null;first_party:boolean|null};affected_page?:{url:string;paragraph:string|null;article_id:string|null;revision:number|null}|null;evidence:{url:string;date:string|null;discovered_at?:string|null;revision:number|null;before?:string;after?:string;query?:string}[]}};
type Recommendations={rows:RecommendationRow[];weeklyLimit:number|null;lookbackDays:number|null;pendingCount:number;activeCount:number;capacityFullCount:number;ownershipConfigured:boolean;metrics:{total:number;adopted:number;rejected:number;adoptionRate:number|null;update_opportunities:number;updates_completed:number;baseline_missed_updates:number;baseline_unknown:number;denominator:string;reasons:{reason:string;count:number}[]};note:string};
type SearchData={rows:{id:string;record:{kind:string;query:string;page:string;position:number;period:string|null}}[];batches:(Batch&{kind:string})[];note:string};
type Data={map:MapData;profiles:Profiles;batches:{rows:Batch[]};demandOptions:Record<string,string[]>;recommendations:Recommendations;search:SearchData};
const actions:Record<string,string>={new_brief:'新写短讯',new_explainer:'新写解释文/工具页',new_tutorial:'新增实机教程',update_page:'更新已有页面'};
const control='mt-1 w-full rounded-control border border-line bg-surface p-2 text-sm';
const blank=(role:string):QuestionDocument=>({question:'',question_en:'',keywords_zh:[],keywords_en:[],roles:[role],scenario:'',dimension:'场景',existing_url:'',existing_url_provenance:'operator_entered',condition_refs:[],source_ids:[],demand_evidence:[],keywords:[],content_type:'explainer',requires_first_party:false,active:true});

const splitKeywords=(value:string)=>value.split(/[,，\n]/).map(v=>v.trim()).filter(Boolean);
const englishKeyword=(value:string)=>!/[^\x00-\x7f]/.test(value)&&/[a-z]{2}/i.test(value);
function questionForm(document:QuestionDocument):QuestionDocument{
  const zh=document.keywords_zh??[],en=document.keywords_en??[];
  const assigned=new Set([...zh,...en]),legacy=document.keywords.filter(k=>!assigned.has(k));
  return {...document,question_en:document.question_en??'',keywords_zh:[...new Set([...zh,...legacy.filter(k=>!englishKeyword(k))])],keywords_en:[...new Set([...en,...legacy.filter(englishKeyword)])]};
}
// Keep the first changed words in view; the full quotations remain in the disclosure below.
function changeExcerpt(before:string,after:string){
  let start=0;
  while(start<before.length&&start<after.length&&before[start]===after[start])start++;
  const offset=Math.max(0,start-8);
  return {before:(offset?'…':'')+before.slice(offset),after:(offset?'…':'')+after.slice(offset)};
}
function CardEvidence({card}:{card:RecommendationRow}){
  const doc=card.document,delta=doc.evidence.find(e=>e.before||e.after);
  const excerpt=delta?changeExcerpt(delta.before??'',delta.after??''):null;
  const checklist=doc.evidence_checklist;
  const checks=[{label:'原文正文',ready:checklist?.source_body},
    ...(doc.existing_url||doc.action==='update_page'||(checklist?.existing_page_body!==undefined&&checklist.existing_page_body!==null)?[{label:'旧页正文',ready:checklist?.existing_page_body}]:[]),
    ...(doc.requires_first_party||(checklist?.first_party!==undefined&&checklist.first_party!==null)?[{label:'实机资料',ready:checklist?.first_party}]:[])];
  const missing=checks.some(c=>c.ready!==true);
  const queries=new Set(doc.evidence.map(e=>e.query).filter(Boolean));
  const bindUrl=`/admin/studio?tab=materials&bind_card=${encodeURIComponent(card.id)}`;
  return <div className="space-y-2 text-sm leading-6">
    <div className="rounded-control bg-bg-sunk px-3 py-2">
      {excerpt?<><p className="line-clamp-1 break-all" title={delta?.before}><span className="text-ink-3">旧：</span>{excerpt.before||'未提供旧值'}</p><p className="line-clamp-1 break-all font-medium" title={delta?.after}><span className="text-accent">→ 新：</span>{excerpt.after||'未提供新值'}</p></>:<p className="line-clamp-2 break-words"><strong>变化：</strong>{doc.change}</p>}
      {delta&&<p className="text-xs text-ink-3">{delta.discovered_at&&<>发现日期：{delta.discovered_at.slice(0,10)} · </>}{delta.date?`原日期：${delta.date}`:'原日期未知'} · 素材版本：{delta.revision??'未知'}</p>}
    </div>
    {(doc.affected_page||doc.existing_url||doc.action==='update_page')&&<div><p className="line-clamp-2 break-words"><strong>旧页受影响段落：</strong>{doc.affected_page?.paragraph?.trim()||'尚未读到，需绑定旧页正文；不能用上游原文代替。'}</p>{(doc.affected_page?.url||doc.existing_url)&&<a href={doc.affected_page?.url||doc.existing_url} target="_blank" rel="noreferrer" className="text-xs text-accent">查看已有页面 ↗</a>}{doc.affected_page?.revision!=null&&<span className="ml-2 text-xs text-ink-3">旧页正文版本 {doc.affected_page.revision}</span>}</div>}
    <p className="text-xs text-ink-3">需求：{doc.demand_mentions??'未知'}条登记提及 · 搜索：{queries.size||(doc.trigger==='C'?'未知':0)}条查询证据（非流量）</p>
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">{checks.map(c=>c.ready===true?<span key={c.label} className="text-accent">{c.label} ✓</span>:<Link key={c.label} to={bindUrl} className="text-hot underline underline-offset-2">{c.label} ✗ · {c.ready===undefined?'未核验，去绑定':'去绑定'}</Link>)}</div>
    {missing&&<p className="text-xs text-hot">采纳前已知仍有证据缺口；可先建待补任务，补齐后再成稿。</p>}
    <details className="text-xs"><summary className="cursor-pointer text-accent">完整引用、变化与处理理由</summary><p className="mt-2 break-words">{doc.change}</p><p className="mt-2 break-words">{doc.reason}</p>{doc.affected_page?.paragraph&&<blockquote className="my-2 whitespace-pre-wrap break-words">旧页受影响段落：{doc.affected_page.paragraph}</blockquote>}{doc.evidence.length?doc.evidence.map((e,i)=><div key={i} className="mt-3"><a href={e.url} target="_blank" rel="noreferrer" className="break-all text-accent">{e.url}</a><p className="text-ink-3">原日期：{e.date??'未知'} · 版本：{e.revision??'查询/页面信号'}{e.query&&` · 查询：${e.query}`}</p>{e.before&&<blockquote className="my-2 whitespace-pre-wrap break-words">旧：{e.before}</blockquote>}{e.after&&<blockquote className="my-2 whitespace-pre-wrap break-words">新：{e.after}</blockquote>}</div>):<p className="mt-2 text-ink-3">尚未提供事实原文。</p>}<p className="mt-2 text-ink-3">{actions[doc.action]} · {doc.channels.join(' / ')}；均须人工批准。</p></details>
  </div>;
}

export async function loader({request}:Route.LoaderArgs){
  const [map,profiles,batches,demandOptions,recommendations,search]=await Promise.all([
    adminGet<MapData>(request,'/api/admin/studio/questions'),
    adminGet<Profiles>(request,'/api/admin/studio/demand/profiles'),
    adminGet<{rows:Batch[]}>(request,'/api/admin/studio/demand/batches'),
    adminGet<Record<string,string[]>>(request,'/api/admin/studio/demand/options'),
    adminGet<Recommendations>(request,'/api/admin/studio/recommendations'),
    adminGet<SearchData>(request,'/api/admin/studio/search-signals'),
  ]);
  return {map,profiles,batches,demandOptions,recommendations,search};
}
export const meta=()=>[{title:'今日值得处理 · Chipshow Studio'}];
export default function Planning({loaderData:data}:Route.ComponentProps){return <PlanningEditor data={data}/>}
function PlanningEditor({data}:{data:Data}){
  const [sp,setSp]=useSearchParams(),tab=sp.get('tab')??'recommendations',navigate=useNavigate();
  const {run,busy}=useAdminAction();
  const [editing,setEditing]=useState<Question|null>(null),[form,setForm]=useState<QuestionDocument>(blank(data.map.options.roles[0]));
  const [keywordsZh,setKeywordsZh]=useState(''),[keywordsEn,setKeywordsEn]=useState('');
  const [csv,setCsv]=useState(''),[filename,setFilename]=useState(''),[localError,setLocalError]=useState('');
  const [capacity,setCapacity]=useState(String(data.recommendations.weeklyLimit??'')),[lookback,setLookback]=useState(String(data.recommendations.lookbackDays??'')),[showSettings,setShowSettings]=useState(false),[showHandled,setShowHandled]=useState(false),[rejecting,setRejecting]=useState(''),[reasons,setReasons]=useState<Record<string,string>>({});
  const [searchCsv,setSearchCsv]=useState(''),[searchKind,setSearchKind]=useState('gsc');
  const [demandImport,setDemandImport]=useState<{overlapping_rows?:number}|null>(null);
  const readyCards=data.recommendations.rows.filter(c=>(c.status==='pending'||c.status==='later')&&!c.stale&&!c.expired&&!c.capacity_full);
  const overflowCards=data.recommendations.rows.filter(c=>(c.status==='pending'||c.status==='later')&&!c.stale&&!c.expired&&c.capacity_full);
  const expiredCards=data.recommendations.rows.filter(c=>c.expired&&!c.stale&&['pending','later'].includes(c.status));
  const historyCards=data.recommendations.rows.filter(c=>c.stale||!['pending','later'].includes(c.status));
  const validCapacity=Number.isInteger(Number(capacity))&&Number(capacity)>=5&&Number(capacity)<=15;
  const validLookback=lookback.trim()===''||Number.isInteger(Number(lookback))&&Number(lookback)>0;
  const configured=data.recommendations.weeklyLimit!=null&&data.recommendations.lookbackDays!=null;
  const change=<K extends keyof QuestionDocument>(key:K,value:QuestionDocument[K])=>setForm(f=>({...f,[key]:value}));
  const save=async()=>{
    if(!(form.keywords_en??[]).some(englishKeyword)){setLocalError('至少填写一个英文关键词，才能保存问题。');return;}
    setLocalError('');
    const document={...form,keywords:[...new Set([...(form.keywords_zh??[]),...(form.keywords_en??[])])]};
    const result=await run('POST','/api/admin/studio/questions',{...(editing?{id:editing.id,version:editing.version}:{}),document},{label:'保存问题',success:'问题已保存；这是一条选题记录，不是已核事实。'});
    if(result){setEditing(null);setForm(blank(data.map.options.roles[0]));setKeywordsZh('');setKeywordsEn('');}
  };
  const renderCard=(card:RecommendationRow)=><Card key={card.id} title={<span className="line-clamp-2 break-words">{card.document.title}</span>}>
        <div className="mb-3 flex flex-wrap gap-2"><Badge>{card.document.trigger} · {actions[card.document.action]}</Badge><Badge tone={card.status==='adopted'?'ok':card.status==='rejected'?'muted':'warn'}>{{pending:'待处理',adopted:'已采纳',rejected:'已否决',later:'稍后再看'}[card.status]??card.status}</Badge>{card.capacity_full&&<Badge tone="warn">待处理名额已满</Badge>}{card.expired&&<Badge tone="muted">已过时 · 不占名额</Badge>}{card.stale&&<Badge tone="warn">原文版本已变</Badge>}</div>
        <CardEvidence card={card}/>
        {card.status==='pending'||card.status==='later'?<div className="mt-4 flex flex-wrap gap-2"><Button tone="primary" disabled={busy||card.stale||card.expired||card.capacity_full} onClick={async()=>{const result=await run<{task_id:string}>('POST',`/api/admin/studio/recommendations/${card.id}/decision`,{action:'adopt'},{success:'已进入原有采编任务。'});if(result)navigate('/admin/studio?tab=tasks');}}>{card.expired?'已过时，保留参考':card.capacity_full?'待处理名额已满':'采纳并创建任务'}</Button><Button disabled={busy} onClick={()=>void run('POST',`/api/admin/studio/recommendations/${card.id}/decision`,{action:'later'},{success:'已保留，稍后再看。'})}>稍后再看</Button><Button disabled={busy} onClick={()=>setRejecting(card.id)}>否决</Button></div>:card.task_id&&<Link to="/admin/studio?tab=tasks" className="mt-4 block text-sm text-accent">继续原采编任务 →</Link>}
        {rejecting===card.id&&<div className="mt-3"><textarea aria-label="否决理由" placeholder="为什么不采用？用于改进选题，不是写作必填。" value={reasons[card.id]??''} onChange={e=>setReasons(v=>({...v,[card.id]:e.target.value}))} className={`${control} min-h-20`}/><Button className="mt-2" disabled={busy||!reasons[card.id]?.trim()} onClick={async()=>{if(await run('POST',`/api/admin/studio/recommendations/${card.id}/decision`,{action:'reject',reason:reasons[card.id]},{success:'否决理由已记录。'}))setRejecting('');}}>记录否决</Button></div>}
        {card.document.action==='update_page'&&<details className="mt-4 text-xs"><summary className="cursor-pointer text-accent">可选：记录基线对照与更新完成</summary><label className="mt-2 block">定时检索基线是否也发现<select aria-label="基线是否也发现" value={card.baseline_found===null?'unknown':String(card.baseline_found)} disabled={busy} className={control} onChange={e=>void run('POST',`/api/admin/studio/recommendations/${card.id}/decision`,{action:'observe',baseline_found:e.target.value==='unknown'?null:e.target.value==='true'},{success:'基线观察已记录，未观察保持未知。'})}><option value="unknown">未知 / 未核对</option><option value="true">也发现了</option><option value="false">没有发现</option></select></label>{card.status==='adopted'&&<Button className="mt-3" disabled={busy||card.completed} onClick={()=>void run('POST',`/api/admin/studio/recommendations/${card.id}/decision`,{action:'complete'},{success:'已记录人工确认的旧页更新完成；不代表系统自动发布。'})}>{card.completed?'已记录完成':'我已完成旧页更新'}</Button>}</details>}
      </Card>;
  return <AdminPage title="选题与客户画像" subtitle={tab==='recommendations'?undefined:"先认识客户在问什么，再决定新写、更新或不做。画像只做定向，不当作公司或产品事实。"} actions={<Link to="/admin/studio?tab=materials" className="text-sm text-accent">进入素材与采编 →</Link>}>
    <div className="mb-3 flex flex-wrap gap-2">{[['recommendations','今日值得处理'],['questions','问题地图'],['profiles','客户画像与导入'],['search','搜索信号']].map(([id,label])=><button key={id} onClick={()=>setSp({tab:id})} className={`rounded-full px-3 py-2 text-sm ${tab===id?'bg-accent text-white':'bg-surface text-ink-3 ring-1 ring-line'}`}>{label}</button>)}</div>
    {localError&&<p role="alert" className="mb-4 text-sm text-hot">{localError}</p>}
    {tab==='recommendations'&&<>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
        <p>待处理 {data.recommendations.pendingCount??readyCards.length}/{data.recommendations.weeklyLimit??'未设'} · 采纳率 {data.recommendations.metrics.adoptionRate===null?'未知':`${Math.round(data.recommendations.metrics.adoptionRate*100)}%`} · <button className="text-accent" aria-expanded={showSettings} aria-controls="planning-settings" onClick={()=>setShowSettings(v=>!v)}>设置 {showSettings?'↑':'↓'}</button></p>
        <Button tone="primary" disabled={busy||!configured} onClick={()=>void run('POST','/api/admin/studio/recommendations/refresh',{}, {label:'整理选题建议',success:'建议已整理；没有新增时保留原计划。'})}>整理今日建议</Button>
      </div>
      {showSettings&&<Card title="整理范围与产能" className="mb-4"><div id="planning-settings" className="flex flex-wrap items-end gap-3"><label className="text-sm">待处理名额（5–15件）<input aria-label="待处理名额" type="number" min="5" max="15" step="1" value={capacity} onChange={e=>setCapacity(e.target.value)} className={control}/></label><label className="text-sm">近多少天素材（首次必填）<input aria-label="整理回看天数" type="number" min="1" step="1" value={lookback} onChange={e=>setLookback(e.target.value)} placeholder={data.recommendations.lookbackDays==null?'请由运营填写':`沿用 ${data.recommendations.lookbackDays} 天`} className={control}/></label><Button disabled={busy||!validCapacity||!validLookback||data.recommendations.lookbackDays==null&&!lookback.trim()} onClick={()=>void run('POST','/api/admin/studio/recommendations/capacity',{weekly_limit:Number(capacity),...(lookback.trim()?{lookback_days:Number(lookback)}:{})},{success:'整理范围与待处理名额已保存。'})}>保存设置</Button></div><p className="mt-3 text-xs leading-6 text-ink-3">当前回看：{data.recommendations.lookbackDays==null?'未设置':`${data.recommendations.lookbackDays} 天`}；已有回看范围时留空沿用。首次需两项均设置后才能整理；不自动填写天数或名额。活跃卡：{data.recommendations.activeCount??'未知'} · 超出名额：{data.recommendations.capacityFullCount??overflowCards.length}。名额按当前待处理卡计数；过时短讯不占名额，本次不调用模型。</p><p className="mt-2 text-xs leading-6 text-ink-3">采纳率分母：{data.recommendations.metrics.denominator}。{data.recommendations.note} <Link to="/admin/studio?tab=review" className="text-accent">查看审稿统计 →</Link></p></Card>}
      {!configured&&<p className="mb-3 text-xs text-hot">先在“设置”填写待处理名额与回看天数，再整理建议。</p>}
      <div className="space-y-4">{readyCards.map(renderCard)}</div>
      {!readyCards.length&&<Card><p className="py-3 text-sm text-ink-3">{overflowCards.length?'有候选待处理，待处理名额已满；可展开下方候选查看。':'暂无新增，保留原计划。可补充问题地图、脱敏需求或实际信源材料后再整理。'}</p></Card>}
      {overflowCards.length>0&&<details className="mt-4"><summary className="cursor-pointer text-sm text-accent">待处理名额已满 · {overflowCards.length} 张候选（展开查看，暂不可采纳）</summary><div className="mt-3 space-y-4">{overflowCards.map(renderCard)}</div></details>}
      {expiredCards.length>0&&<details className="mt-4"><summary className="cursor-pointer text-sm text-accent">已过时短讯 · {expiredCards.length} 张（不占待处理名额，展开查看）</summary><div className="mt-3 space-y-4">{expiredCards.map(renderCard)}</div></details>}
      <Button className="mt-4" onClick={()=>setShowHandled(v=>!v)}>{showHandled?'收起稍后、已处理与历史':`查看已处理与历史（${historyCards.length}）`}</Button>
      {showHandled&&<div className="mt-3 space-y-4">{historyCards.map(renderCard)}</div>}
      {data.recommendations.metrics.reasons.length>0&&<details className="mt-5 text-sm"><summary className="cursor-pointer text-accent">否决理由分布</summary>{data.recommendations.metrics.reasons.map(r=><p key={r.reason} className="mt-2 break-words">{r.reason} · {r.count}</p>)}</details>}
    </>}
    {tab==='search'&&<>
      {!data.recommendations.ownershipConfigured&&<p className="mb-3 text-sm text-hot">自有域名清单尚未确认，Semrush 自有/竞品分类等待配置；暂不据此判断新写或补强旧页。</p>}
      <Card title="导入GSC或Semrush CSV" className="mb-5"><p className="text-sm leading-6 text-ink-3">P0只导入CSV，不连接API。按模板保留查询/关键词、页面、排名和对应指标；没有的数据期留空。{data.search.note}</p><div className="my-3 flex flex-wrap items-center gap-3"><select aria-label="搜索数据类型" value={searchKind} onChange={e=>setSearchKind(e.target.value)} className="rounded-control border border-line bg-surface p-2 text-sm"><option value="gsc">GSC 查询与页面</option><option value="semrush">Semrush 对标</option></select><a href={`/api/admin/studio/search-signals/template/${searchKind}`} className="text-sm text-accent">下载对应模板</a><label className="cursor-pointer text-sm text-accent">读取CSV<input aria-label="读取搜索CSV" type="file" accept=".csv,text/csv" className="sr-only" onChange={async e=>{const f=e.target.files?.[0];if(f){if(f.size>2*1024*1024){setLocalError('文件最大2MB。');return;}setSearchCsv(await f.text());}e.target.value='';}}/></label></div><textarea aria-label="搜索CSV内容" value={searchCsv} onChange={e=>setSearchCsv(e.target.value)} className="min-h-40 w-full rounded-control border border-line bg-surface p-3 font-mono text-xs"/><Button className="mt-3" disabled={busy||!searchCsv.trim()} onClick={async()=>{const result=await run<{overlapping_rows?:number}>('POST','/api/admin/studio/search-signals/import',{kind:searchKind,csv:searchCsv},{success:'搜索信号已导入，可在今日建议中整理。'});if(result){setSearchCsv('');}}}>检查并导入</Button></Card>
      <Card title={`搜索信号 · ${data.search.rows.length}行`}><div className="divide-y divide-line">{data.search.rows.slice(0,100).map(s=><div key={s.id} className="py-3 text-sm"><p>{s.record.query} · {s.record.kind.toUpperCase()} · 排名{s.record.position}</p><a href={s.record.page} target="_blank" rel="noreferrer" className="break-all text-xs text-accent">{s.record.page}</a><p className="text-xs text-ink-4">数据期：{s.record.period??'未知'}</p></div>)}</div>{data.search.batches.map(b=><div key={b.id} className="flex flex-wrap items-center gap-3 border-t border-line py-3 text-sm"><span className="flex-1"><Time at={b.created_at}/> · {b.kind} · {b.row_count}行</span><Button disabled={busy} onClick={()=>{if(window.confirm('撤回该搜索数据批次？已生成的选题卡保留历史。'))void run('DELETE',`/api/admin/studio/search-signals/batches/${b.id}`,undefined,{success:'搜索数据批次已撤回。'});}}>撤回本批</Button></div>)}</Card>
    </>}
    {tab==='profiles'&&<>
      {demandImport&&<p role="status" className="mb-3 text-sm text-ink-3">本次脱敏需求导入完成；重复行数：{demandImport.overlapping_rows??'后端未返回'}。未自动合并或删除旧批次；是否撤回由运营决定。</p>}
      <Card title="导入脱敏需求" className="mb-5"><p className="text-sm leading-6 text-ink-3">只接收规定字段。不要上传客户名、公司名、联系方式、报价、项目地址或聊天原文。邮箱、电话、网址等模式一旦命中，整批不入库；系统不会替你清洗后保存。</p>
        <div className="my-3 flex flex-wrap items-center gap-3"><a href="/api/admin/studio/demand/template" className="text-sm text-accent">下载合成示例 CSV</a><label className="cursor-pointer rounded-control border border-line px-3 py-2 text-sm">读取脱敏 CSV<input aria-label="读取脱敏CSV" className="sr-only" type="file" accept=".csv,text/csv" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>2*1024*1024){setLocalError('文件最大2MB，请分批导入。');return;}setLocalError('');setCsv(await file.text());setFilename(file.name);e.target.value='';}}/></label><span className="text-xs text-ink-4">{filename||'示例不会自动导入'}</span></div>
        <textarea aria-label="脱敏CSV内容" value={csv} onChange={e=>setCsv(e.target.value)} className="min-h-36 w-full rounded-control border border-line bg-surface p-3 font-mono text-xs" placeholder="week,region,channel,role,product_direction,scenario,need_tags,question_rewrite,grade"/>
        <Button className="mt-3" disabled={busy||!csv.trim()} onClick={async()=>{const result=await run<{overlapping_rows?:number}>('POST','/api/admin/studio/demand/import',{csv,filename},{label:'检查并导入脱敏需求',success:'整批校验通过并导入；原始CSV未保存。'});if(result){setDemandImport(result);setCsv('');setFilename('');}}}>检查并导入整批</Button>
        <details className="mt-3 text-xs leading-6 text-ink-3"><summary className="cursor-pointer text-accent">查看枚举与填写说明</summary>{Object.entries(data.demandOptions).map(([key,values])=><p key={key}>{key}：{values.join(' / ')}</p>)}<p>week填写ISO周，如2026-W44；need_tags用 | 分隔。product_direction、scenario与question_rewrite必须先脱敏。导入可选，不继续导入也能使用系统。</p></details>
      </Card>
      <Card title="聚合画像" className="mb-5"><p className="mb-3 text-sm text-ink-3">{data.profiles.countingBasis}。共{data.profiles.totals.recordCount}条登记提及、{data.profiles.totals.groupCount}组。最近导入：{data.profiles.lastImportedAt?<Time at={data.profiles.lastImportedAt}/>: '当前无有效批次'}。</p>
        <div className="grid gap-4 lg:grid-cols-2">{data.profiles.groups.map(g=><article key={JSON.stringify([g.role,g.region,g.scenario])} className="min-w-0 rounded-control border border-line p-4"><h2 className="text-sm font-medium">{g.role} · {g.region}</h2><p className="mt-1 text-sm">{g.scenario} · {g.recordCount}条提及</p><div className="my-2 flex flex-wrap gap-2">{g.needTags.map(t=><Badge key={t.tag}>{t.tag} {t.count}</Badge>)}</div><ul className="space-y-1 text-xs leading-6 text-ink-3">{g.representativeQuestions.map(q=><li key={q.questionRewrite} className="break-words">{q.questionRewrite}（{q.count}）</li>)}</ul></article>)}</div>
        {!data.profiles.groups.length&&<p className="py-4 text-sm text-ink-3">尚无需求数据。不会用合成示例假装真实客户画像。</p>}
      </Card>
      <Card title="导入批次"><p className="mb-2 text-xs text-ink-3">撤回会删除该批次及其行，聚合计数随即重新计算；不影响其他批次。</p>{data.batches.rows.map(b=><div key={b.id} className="flex flex-wrap items-center gap-3 border-t border-line py-3 text-sm"><span className="min-w-0 flex-1 break-words"><Time at={b.created_at}/> · {b.row_count}行</span><Button disabled={busy} onClick={()=>{if(window.confirm('撤回本批脱敏需求及其全部行？其他批次保留。'))void run('DELETE',`/api/admin/studio/demand/batches/${b.id}`,undefined,{success:'批次已撤回，画像已更新。'});}}>撤回本批</Button></div>)}</Card>
    </>}
    {tab==='questions'&&<div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,420px)]">
      <Card title={`问题地图 · ${data.map.rows.length}题`}><div className="mb-4 flex flex-wrap gap-3"><a href="/api/admin/studio/questions/example" className="text-sm text-accent">下载36题规划示例</a><label className="cursor-pointer text-sm text-accent">确认后导入清单<input aria-label="导入问题清单" className="sr-only" type="file" accept=".json,application/json" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>512*1024)throw Error('size');const input=JSON.parse(await file.text());if(window.confirm('导入这份待完善的选题清单？已有同名问题会保留，不覆盖人工修改。'))await run('POST','/api/admin/studio/questions/import',input,{success:'清单已导入。示例的来源、现有页面和需求证据仍须核对。'});setLocalError('');}catch{setLocalError('文件须为小于512KB的JSON问题清单。');}e.target.value='';}}/></label></div>
        <p className="mb-3 text-xs leading-6 text-ink-3">示例不是已核客户事实。已有页面只填你实际提供或读取的URL，未知留空。教程缺工程实机材料须HOLD。</p>
        <div className="divide-y divide-line">{data.map.rows.map(q=><article key={q.id} className="py-4"><div className="flex flex-wrap items-start gap-2"><h2 className="min-w-0 flex-1 break-words text-[15px] font-medium">{q.document.question}</h2><Badge tone={q.document.active?'ok':'muted'}>{q.document.active?'使用中':'已暂停'}</Badge>{!questionForm(q.document).keywords_en?.some(englishKeyword)&&<Badge tone="warn">缺英文关键词</Badge>}<Button disabled={busy} onClick={()=>{setEditing(q);const next=questionForm(q.document);setForm(next);setKeywordsZh((next.keywords_zh??[]).join(', '));setKeywordsEn((next.keywords_en??[]).join(', '));setLocalError('');}}>编辑</Button></div>{q.document.question_en&&<p className="mt-2 break-words text-sm text-ink-3">{q.document.question_en}</p>}<p className="mt-2 text-xs leading-6 text-ink-3">{q.document.roles.join('、')} · {q.document.scenario} · {q.document.dimension}</p>{q.document.existing_url?<a href={q.document.existing_url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-xs text-accent">已有页面：{q.document.existing_url}</a>:<p className="mt-1 text-xs text-ink-4">已有页面未知，未编造路径</p>}{q.document.requires_first_party&&<p className="mt-1 text-xs text-hot">教程须绑定工程实机资料，模型不补步骤。</p>}</article>)}</div>
        {!data.map.rows.length&&<p className="py-5 text-sm text-ink-3">尚无问题。可手工建一题，或核对示例后导入；页面不会自动写入示例。</p>}
      </Card>
      <Card title={editing?'编辑问题':'新建问题'}><div className="space-y-3">
        <label className="block text-sm">客户问法<textarea aria-label="客户问法" value={form.question} onChange={e=>change('question',e.target.value)} className={`${control} min-h-20`}/></label>
        <label className="block text-sm">客户问法（英文）<textarea aria-label="客户问法（英文）" value={form.question_en??''} onChange={e=>change('question_en',e.target.value)} className={`${control} min-h-20`}/></label>
        <fieldset><legend className="text-sm">客户角色</legend><div className="mt-2 space-y-1">{data.map.options.roles.map(role=><label key={role} className="block text-xs leading-6"><input type="checkbox" checked={form.roles.includes(role)} onChange={e=>change('roles',e.target.checked?[...form.roles,role]:form.roles.filter(r=>r!==role))}/> {role}</label>)}</div></fieldset>
        <label className="block text-sm">场景<input aria-label="场景" value={form.scenario} onChange={e=>change('scenario',e.target.value)} className={control}/></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-sm">维度<select aria-label="维度" value={form.dimension} onChange={e=>change('dimension',e.target.value)} className={control}>{data.map.options.dimensions.map(d=><option key={d}>{d}</option>)}</select></label><label className="text-sm">内容形式<select aria-label="内容形式" value={form.content_type} onChange={e=>{const type=e.target.value;setForm(f=>({...f,content_type:type,requires_first_party:type==='tutorial'||f.requires_first_party}));}} className={control}>{[['explainer','解释文'],['tutorial','实机教程'],['tool','工具页'],['news','短讯']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label></div>
        <label className="block text-sm">中文关键词（逗号分隔）<input aria-label="中文关键词" value={keywordsZh} onChange={e=>{setKeywordsZh(e.target.value);change('keywords_zh',splitKeywords(e.target.value));}} className={control}/></label>
        <label className="block text-sm">英文关键词（至少一个，逗号分隔）<input aria-label="英文关键词" value={keywordsEn} onChange={e=>{setKeywordsEn(e.target.value);change('keywords_en',splitKeywords(e.target.value));}} className={control}/></label>
        {!(form.keywords_en??[]).some(englishKeyword)&&<p className="text-xs text-hot">缺英文关键词，补齐后才能保存。</p>}
        <label className="block text-sm">已有页面URL（未知留空）<input aria-label="已有页面URL" type="url" value={form.existing_url} onChange={e=>setForm(f=>({...f,existing_url:e.target.value,existing_url_provenance:'operator_entered'}))} className={control}/></label>
        <label className="block text-sm">条件数据引用（每行一项）<textarea aria-label="条件数据引用" value={form.condition_refs.join('\n')} onChange={e=>change('condition_refs',e.target.value.split('\n').filter(Boolean))} className={control}/></label>
        <details><summary className="cursor-pointer text-sm text-accent">关联已配置的信源</summary><div className="mt-2 max-h-48 space-y-1 overflow-y-auto">{data.map.options.sources.map(s=><label key={s.id} className="block text-xs leading-6"><input type="checkbox" checked={form.source_ids.includes(s.id)} onChange={e=>change('source_ids',e.target.checked?[...form.source_ids,s.id]:form.source_ids.filter(id=>id!==s.id))}/> {s.name}</label>)}</div></details>
        <label className="block text-sm"><input type="checkbox" checked={form.requires_first_party} disabled={form.content_type==='tutorial'} onChange={e=>change('requires_first_party',e.target.checked)}/> 需要工程一手资料（实机步骤、版本、截图与报错处理；手册不能替代）</label>
        <label className="block text-sm"><input type="checkbox" checked={form.active} onChange={e=>change('active',e.target.checked)}/> 用于选题推荐</label>
        <div className="flex gap-2"><Button tone="primary" disabled={busy||!form.question.trim()||!form.roles.length||!form.scenario.trim()||!(form.keywords_en??[]).some(englishKeyword)} onClick={()=>void save()}>保存问题</Button>{editing&&<Button disabled={busy} onClick={()=>{setEditing(null);setForm(blank(data.map.options.roles[0]));setKeywordsZh('');setKeywordsEn('');}}>取消编辑</Button>}</div>
      </div></Card>
    </div>}
  </AdminPage>;
}
