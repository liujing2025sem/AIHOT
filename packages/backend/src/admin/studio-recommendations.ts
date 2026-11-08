// Programmatic editorial suggestions. Opening the page never runs selection or a model.
import { z } from 'zod';
import { sql } from '../db.ts';
import { audit, Conflict } from '../audit.ts';
import { sha256 } from '../lib/ids.ts';
import { editorialTopic } from '../../../../site/editorial.ts';
import { studioQuestions, type StudioQuestionRow, type StudioQuestion } from './studio-questions.ts';
import { demandProfiles, type DemandProfiles } from '../studio/studio-demand.ts';
import { type SearchSignal } from './studio-search-signals.ts';
import { createStudioTask } from '../studio/studio.ts';
import { keywordMatch } from './studio-question-match.ts';
import { editorialOwnedDomains, pageOwnership } from '../../../../site/editorial-ownership.ts';
import { editorialSourceIds, editorialVersionSourceIds } from '../../../../site/editorial-sources.ts';
export { editorialSourceIds } from '../../../../site/editorial-sources.ts';

const invalid=(message:string):never=>{throw Object.assign(new Error(message),{statusCode:400});};
const policyKey='studio.recommendations.weekly_limit';
const daysKey='studio.recommendations.lookback_days',refreshKey='studio.recommendations.last_refresh';
const plain=(s:string)=>s.replace(/\s+/g,' ').trim();
export type PlanningMaterial={id:string;revision:number;title:string;body_text:string|null;body_status:string;url:string;source_id:string;published_at:string|Date|null;discovered_at?:string|Date|null;backfill_reason?:string|null;imported_title?:string|null;previous_revision?:number|null;previous_title?:string|null;previous_body?:string|null;first_party?:boolean;source_kind?:string;reference_only?:boolean};
export type Recommendation={key:string;trigger:'A'|'E'|'B'|'C'|'D'|'M';question_id:string|null;article_id:string|null;article_revision:number|null;title:string;change:string;evidence:{url:string;date:string|null;discovered_at?:string|null;revision:number|null;before?:string;after?:string;query?:string}[];reason:string;action:'new_brief'|'new_explainer'|'new_tutorial'|'update_page';channels:string[];existing_url:string;requires_first_party:boolean;needs_material:boolean;demand_mentions:number;priority:number;bound_article_ids?:string[];evidence_checklist?:{source_body:boolean;existing_page_body:boolean|null;first_party:boolean|null};affected_page?:{url:string;paragraph:string|null;article_id:string|null;revision:number|null}|null};
type RecommendationCounts={total:number;adopted:number;rejected:number;update_opportunities:number;updates_completed:number;baseline_missed_updates:number;baseline_unknown:number;manual_total:number;manual_adopted:number;manual_rejected:number};
type StoredRecommendation={id:string;status:string;created_at:Date;document:Recommendation;stale?:boolean;article_id:string|null;article_revision:number|null;current_revision?:number|null;question_id:string|null;task_id:string|null;baseline_found:boolean|null;completed:boolean;[key:string]:unknown};
const actionFor=(q:StudioQuestion):Recommendation['action']=>q.existing_url?'update_page':q.content_type==='tutorial'?'new_tutorial':q.content_type==='news'?'new_brief':'new_explainer';
const readership=(q:StudioQuestion,profiles:DemandProfiles)=>profiles.groups.filter(g=>q.roles.includes(g.role)&&(g.scenario===q.scenario||g.needTags.some(tag=>keywordMatch(q,tag.tag)>0)));
const dateValue=(value:PlanningMaterial['published_at'])=>{const ms=value?new Date(value).getTime():NaN;return Number.isFinite(ms)?new Date(ms).toISOString():null;};
const versions=(text:string)=>[...new Set((text.match(/\bv?\d+\.\d+(?:\.\d+){0,2}\b/gi)??[]).map(v=>v.toLowerCase().replace(/^v/,'')))].sort();
function changedParagraphs(before:string,after:string){
  const old=before.split(/\r?\n+/).map(plain).filter(Boolean),next=after.split(/\r?\n+/).map(plain).filter(Boolean);
  const a=old.filter(p=>!next.includes(p)).join('\n'),b=next.filter(p=>!old.includes(p)).join('\n');
  let start=0;while(start<a.length&&start<b.length&&a[start]===b[start])start++;
  const offset=Math.max(0,start-50);
  return {before:a.slice(offset,offset+350),after:b.slice(offset,offset+350),full_before:a,full_after:b};
}

export function enrichRecommendation(card:Recommendation,materials:PlanningMaterial[],question?:StudioQuestion):Recommendation&{evidence_checklist:NonNullable<Recommendation['evidence_checklist']>}{
  const bound=new Set([card.article_id,...(card.bound_article_ids??[])]),readable=(m:PlanningMaterial)=>m.body_status==='ok'&&!!m.body_text?.trim();
  const page=card.existing_url?materials.find(m=>m.url===card.existing_url&&readable(m)):undefined;
  const source=materials.filter(m=>bound.has(m.id)&&readable(m));
  const paragraphs=page?.body_text?.split(/\r?\n+/).filter(p=>p.trim())??[];
  const relevant=question?paragraphs.map(text=>({text,n:keywordMatch(question,text)})).filter(p=>p.n>0).sort((a,b)=>b.n-a.n)[0]?.text:null;
  const checklist={source_body:card.article_id?source.some(m=>m.id===card.article_id):source.some(m=>m.url!==card.existing_url),existing_page_body:card.existing_url?!!page&&bound.has(page.id):null,first_party:card.requires_first_party?source.some(m=>m.first_party&&m.source_kind==='external'):null};
  return {...card,...(card.trigger==='M'?{evidence:source.map(m=>({url:m.url,date:dateValue(m.published_at),revision:m.revision}))}:{}),evidence_checklist:checklist,needs_material:Object.values(checklist).some(value=>value===false),
    affected_page:card.existing_url?{url:card.existing_url,paragraph:relevant?.slice(0,600)??null,article_id:page?.id??null,revision:page?.revision??null}:null};
}
export function planRecommendations(input:{questions:StudioQuestionRow[];materials:PlanningMaterial[];profiles:DemandProfiles;search:SearchSignal[];now:string;ownedDomains?:readonly string[]}):Recommendation[]{
  const result:Recommendation[]=[],questions=input.questions.filter(q=>q.document.active),now=Date.parse(input.now),domains=input.ownedDomains??editorialOwnedDomains;
  for(const material of input.materials){
    if(material.reference_only)continue;
    const text=material.title+'\n'+(material.body_text??''),date=dateValue(material.published_at),age=date?(now-Date.parse(date))/86400000:null;
    const fresh=age!==null&&age>=0&&age<=7;
    const change=material.previous_body&&material.body_text&&plain(material.previous_body)!==plain(material.body_text)?changedParagraphs(material.previous_body,material.body_text):null;
    const ranked=questions.map(q=>({q,matches:keywordMatch(q.document,text)})).filter(x=>x.matches>0).sort((a,b)=>b.matches-a.matches||a.q.id.localeCompare(b.q.id));
    const changed=change?ranked.find(x=>x.q.document.existing_url&&keywordMatch(x.q.document,change.full_before+'\n'+change.full_after)>0):undefined;
    const versionSource=editorialVersionSourceIds.includes(material.source_id),titleVersions=versions(material.title),currentVersions=titleVersions.length?titleVersions:versions(material.body_text??'');
    const previousVersions=versions((material.previous_title??'')+'\n'+(material.previous_body??''));
    const hasPrevious=!!material.previous_title||!!material.previous_body;
    const isVersion=(versionSource||/NovaLCT|ViPlex|LEDVISION|LEDStudio|HDPlayer|firmware|固件|软件版本/i.test(text))&&currentVersions.length>0;
    const hasVersionChange=hasPrevious&&currentVersions.some(v=>!previousVersions.includes(v));
    // The first revision keeps the baseline even after a later version receives body-only edits.
    const importedVersions=versions(material.imported_title??material.previous_title??material.title);
    if(versionSource&&material.backfill_reason==='first-import'&&!changed&&!currentVersions.some(v=>!importedVersions.includes(v)))continue;
    const best=changed?.q??ranked[0]?.q;
    const trigger:Recommendation['trigger']|null=changed?'A':isVersion&&(hasVersionChange||fresh&&(!hasPrevious||versionSource)||versionSource&&!date)?'E':fresh&&(!!best||!!editorialTopic(text))?'D':null;
    if(!trigger)continue;
    const q=best?.document;
    const mentions=q?readership(q,input.profiles).reduce((n,g)=>n+g.recordCount,0):0;
    const queryEvidence=q?input.search.filter(s=>keywordMatch(q,s.query)>0).sort((a,b)=>(b.impressions??b.volume??0)-(a.impressions??a.volume??0)).slice(0,5).map(s=>({url:s.page,date:null,revision:null,query:s.query})):[];
    result.push({key:trigger==='E'?`version:${material.id}:${currentVersions.join(',')}`:`material:${material.id}:${material.revision}`,trigger,question_id:best?.id??null,article_id:material.id,article_revision:material.revision,title:q?.question??material.title,
      change:change?`${change.before.slice(0,160)} → ${change.after.slice(0,160)}`:material.title,
      evidence:[{url:material.url,date,...(trigger==='E'?{discovered_at:dateValue(material.discovered_at??input.now)}:{}),revision:material.revision,...(change?{before:change.before.slice(0,350),after:change.after.slice(0,350)}:{after:material.body_text?.split(/\r?\n/).find(p=>p.trim())?.slice(0,350)??material.title})},...queryEvidence],
      reason:q?`对应“${q.question}”；面向${q.roles.join('、')}，${mentions}条登记提及。`:'LED商显主题线索，尚未挂接已有问题，需确认客户影响。',action:q?actionFor(q):'new_brief',channels:['blog','social'],existing_url:q?.existing_url??'',requires_first_party:!!q?.requires_first_party,needs_material:material.body_status!=='ok'||!material.body_text||!!q?.requires_first_party||!!q?.existing_url&&q.existing_url!==material.url,demand_mentions:mentions,priority:trigger==='A'?0:trigger==='E'?1:4});
  }
  for(const question of questions){
    const q=question.document,groups=readership(q,input.profiles),mentions=groups.reduce((n,g)=>n+g.recordCount,0);
    if(!q.existing_url&&mentions>=2)result.push({key:`demand:${question.id}:${question.version}`,trigger:'B',question_id:question.id,article_id:null,article_revision:null,title:q.question,change:'登记需求反复出现，问题地图尚无承接页面。',evidence:[],reason:`${groups.map(g=>`${g.role}/${g.region}/${g.scenario}`).join('；')}，共${mentions}条登记提及；可重叠，未按客户去重。`,action:actionFor(q),channels:['blog','social'],existing_url:'',requires_first_party:q.requires_first_party,needs_material:true,demand_mentions:mentions,priority:2});
    const grouped=new Map<string,SearchSignal[]>();
    for(const signal of input.search){
      if(!keywordMatch(q,signal.query))continue;
      const owner=pageOwnership(signal.page,domains),own=owner==='own';
      if(!(own&&signal.position>10&&(signal.kind==='semrush'||(signal.impressions??0)>0)||owner==='competitor'&&signal.kind==='semrush'&&signal.position<=10&&!q.existing_url))continue;
      const key=JSON.stringify([signal.batch_id??signal.period??'unknown',signal.page]);grouped.set(key,[...(grouped.get(key)??[]),signal]);
    }
    for(const [group,signals] of grouped){
      signals.sort((a,b)=>(b.impressions??b.volume??0)-(a.impressions??a.volume??0)||a.query.localeCompare(b.query));
      const signal=signals[0],own=pageOwnership(signal.page,domains)==='own',queries=[...new Map(signals.map(s=>[s.query,s])).values()];
      result.push({key:`search:${question.id}:${question.version}:${group}`,trigger:'C',question_id:question.id,article_id:null,article_revision:null,title:q.question,
        change:own?`已有页面的${queries.length}个相关查询排名靠后，检查承接内容。`:`竞品前10有${queries.length}个相关查询，问题地图尚无承接页。`,
        evidence:queries.slice(0,5).map(s=>({url:s.page,date:null,revision:null,query:s.query})),reason:`${q.roles.join('、')}；${queries.length}个查询；数据期${signal.period??'未知'}。${signal.kind==='semrush'?'Semrush为地区估算。':''}`,
        action:own?'update_page':actionFor(q),channels:['blog','social'],existing_url:own?signal.page:q.existing_url,requires_first_party:q.requires_first_party,needs_material:true,demand_mentions:mentions,priority:3});
    }
  }
  return [...new Map(result.map(r=>[r.key,r])).values()].sort((a,b)=>a.priority-b.priority||b.demand_mentions-a.demand_mentions||a.key.localeCompare(b.key))
    .map(card=>enrichRecommendation(card,input.materials,questions.find(q=>q.id===card.question_id)?.document));
}

function queueOrder(a:any,b:any){return a.document.priority-b.document.priority||(a.document.trigger==='D'&&b.document.trigger==='D'?Date.parse(b.document.evidence[0]?.date??b.created_at)-Date.parse(a.document.evidence[0]?.date??a.created_at):0)||b.document.demand_mentions-a.document.demand_mentions||new Date(a.created_at).getTime()-new Date(b.created_at).getTime()||a.id.localeCompare(b.id);}
export function allocateRecommendationCapacity<T extends {id:string;status:string;stale?:boolean;document:Recommendation;created_at:Date|string}>(rows:T[],limit:number|null,now=Date.now()){
  const dated=rows.map(r=>{const date=r.document.evidence[0]?.date,age=date?(now-Date.parse(date))/86400000:NaN;return {...r,expired:r.document.trigger==='D'&&(!Number.isFinite(age)||age>7)};});
  const pending=dated.filter(r=>['pending','later'].includes(r.status)&&!r.stale&&!r.expired).sort(queueOrder),active=new Set(pending.slice(0,limit??0).map(r=>r.id));
  return {pendingCount:pending.length,activeCount:active.size,capacityFullCount:pending.length-active.size,rows:dated.map(r=>({...r,capacity_full:['pending','later'].includes(r.status)&&!r.stale&&!r.expired&&!active.has(r.id)})).sort(queueOrder)};
}
async function cardMaterials(cards:Recommendation[],db=sql){
  const urls=cards.map(c=>c.existing_url).filter(Boolean),ids=cards.flatMap(c=>[...(c.bound_article_ids??[]),...(c.article_id?[c.article_id]:[])]);
  if(!urls.length&&!ids.length)return [];
  return db<PlanningMaterial[]>`SELECT a.id,a.revision,a.title,a.body_text,a.body_status,a.url,a.source_id,a.published_at,s.first_party,s.kind AS source_kind FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.url=ANY(${urls}) OR a.id=ANY(${ids})`;
}

export async function recommendationOverview(){
  const [setting]=await sql`SELECT value FROM settings WHERE key=${policyKey}`;
  const [days]=await sql`SELECT value FROM settings WHERE key=${daysKey}`;
  const [history]=await sql<{n:number}[]>`SELECT count(*)::int AS n FROM articles WHERE source_id=ANY(${editorialVersionSourceIds}) AND backfill_reason='first-import'`;
  const rows=await sql<StoredRecommendation[]>`SELECT r.*,CASE WHEN r.document->>'article_id' IS NOT NULL THEN a.id IS NULL OR a.revision<>r.article_revision ELSE false END AS stale FROM studio_recommendations r LEFT JOIN articles a ON a.id=r.article_id ORDER BY (r.document->>'priority')::int,r.created_at DESC,r.id`;
  const material=await cardMaterials(rows.map(r=>r.document));
  const questions=await studioQuestions();
  const queue=allocateRecommendationCapacity(rows.map(r=>({...r,document:enrichRecommendation(r.document,material,questions.rows.find(q=>q.id===r.question_id)?.document)})),setting?.value??null);
  const [counts]=await sql<RecommendationCounts[]>`SELECT count(*) FILTER(WHERE document->>'trigger'<>'M')::int AS total,count(*) FILTER(WHERE document->>'trigger'<>'M' AND status='adopted')::int AS adopted,count(*) FILTER(WHERE document->>'trigger'<>'M' AND status='rejected')::int AS rejected,
    count(*) FILTER(WHERE document->>'trigger'<>'M' AND document->>'action'='update_page')::int AS update_opportunities,count(*) FILTER(WHERE document->>'trigger'<>'M' AND document->>'action'='update_page' AND completed)::int AS updates_completed,
    count(*) FILTER(WHERE document->>'trigger'<>'M' AND document->>'action'='update_page' AND baseline_found=false)::int AS baseline_missed_updates,
    count(*) FILTER(WHERE document->>'trigger'<>'M' AND document->>'action'='update_page' AND baseline_found IS NULL)::int AS baseline_unknown,
    count(*) FILTER(WHERE document->>'trigger'='M')::int AS manual_total,count(*) FILTER(WHERE document->>'trigger'='M' AND status='adopted')::int AS manual_adopted,count(*) FILTER(WHERE document->>'trigger'='M' AND status='rejected')::int AS manual_rejected FROM studio_recommendations`;
  const reasons=await sql`SELECT rejection_reason AS reason,count(*)::int AS count FROM studio_recommendations WHERE status='rejected' AND document->>'trigger'<>'M' GROUP BY rejection_reason ORDER BY count(*) DESC,rejection_reason`;
  const decided=counts.adopted+counts.rejected;
  return {...queue,historicalVersionCount:history.n,lookbackDays:days?.value??null,ownershipConfigured:editorialOwnedDomains.length>0,weeklyLimit:setting?.value??null,metrics:{...counts,adoptionRate:decided?counts.adopted/decided:null,denominator:'自动推荐采纳数+否决数；人工选题、稍后再看与未处理不计分母',reasons},note:'人工分钟和调用成本继续由现有回执记录，不作为本期验收门槛。'};
}
export async function createManualRecommendation(input:unknown,actor:string){
  const body=z.object({question_id:z.string().min(1),question_version:z.number().int().positive()}).strict().parse(input);
  return sql.begin(async tx=>{
    const [question]=await tx<StudioQuestionRow[]>`SELECT id,document,version,created_at,updated_at FROM studio_questions WHERE id=${body.question_id} FOR SHARE`;
    if(!question||!question.document.active)invalid('请选择问题地图中启用的问题，再发起人工选题。');
    if(question.version!==body.question_version)throw new Conflict('问题已修改，请刷新后确认当前问法再发起。');
    const q=question.document,key=`manual:${question.id}:${question.version}`,id=`recommendation-${sha256(key).slice(0,32)}`;
    if(actionFor(q)==='new_brief')invalid('人工选题用于解释文、工具页、教程或旧页更新；时讯请使用近期新闻卡。');
    const document:Recommendation={key,trigger:'M',question_id:question.id,article_id:null,article_revision:null,title:q.question,
      change:'运营从问题地图主动发起，等待绑定能回答该问题的原文。',reason:'人工选题；保留材料原始日期，补齐证据后继续采编。',evidence:[],action:actionFor(q),channels:['blog','social'],existing_url:q.existing_url,requires_first_party:q.requires_first_party,needs_material:true,demand_mentions:0,priority:2};
    const inserted=await tx`INSERT INTO studio_recommendations(id,input_key,question_id,document,updated_by) VALUES(${id},${key},${question.id},${tx.json(document)},${actor}) ON CONFLICT DO NOTHING RETURNING id`;
    if(inserted.length)await audit(actor,'studio.recommendation.manual',`studio-recommendation:${id}`,null,null,{question_id:question.id,question_version:question.version},{db:tx});
    const [card]=await tx<{id:string;status:string;task_id:string|null}[]>`SELECT id,status,task_id FROM studio_recommendations WHERE input_key=${key}`;
    return {...card,created:inserted.length>0};
  });
}
export async function setRecommendationCapacity(input:unknown,actor:string){
  const body=z.object({weekly_limit:z.number().int().min(5).max(15),lookback_days:z.number().int().positive().optional()}).strict().parse(input);
  await sql.begin(async tx=>{
    await tx`INSERT INTO settings(key,value,updated_by) VALUES(${policyKey},${tx.json(body.weekly_limit)},${actor}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`;
    if(body.lookback_days!==undefined)await tx`INSERT INTO settings(key,value,updated_by) VALUES(${daysKey},${tx.json(body.lookback_days)},${actor}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`;
  });
  await audit(actor,'studio.recommendations.capacity',`settings:${policyKey}`,null,null,body);return body;
}
export async function refreshRecommendations(actor:string){
  const [days]=await sql`SELECT value FROM settings WHERE key=${daysKey}`;
  if(!days)invalid('先由运营设置回看天数，再整理建议。');
  const [last]=await sql`SELECT value FROM settings WHERE key=${refreshKey}`;
  const scanAt=new Date().toISOString(),questions=await studioQuestions(),allowed=[...new Set([...editorialSourceIds,...questions.rows.flatMap(q=>q.document.source_ids)])];
  const materials=allowed.length?await sql<PlanningMaterial[]>`SELECT a.id,a.revision,a.title,a.body_text,a.body_status,a.url,a.source_id,a.published_at,a.discovered_at,a.backfill_reason,initial.title AS imported_title,s.first_party,s.kind AS source_kind,old.revision AS previous_revision,old.title AS previous_title,old.body_text AS previous_body
    FROM articles a JOIN sources s ON s.id=a.source_id LEFT JOIN LATERAL(SELECT revision,title,body_text FROM article_revisions WHERE article_id=a.id AND revision<a.revision ORDER BY revision DESC LIMIT 1) old ON true
    LEFT JOIN LATERAL(SELECT title FROM article_revisions WHERE article_id=a.id AND a.backfill_reason='first-import' ORDER BY revision LIMIT 1) initial ON true
    WHERE a.source_id=ANY(${allowed}) AND (a.updated_at>COALESCE(${last?.value??null}::timestamptz,${scanAt}::timestamptz-${days.value}*interval '1 day') OR COALESCE(a.published_at,a.discovered_at)>=${scanAt}::timestamptz-${days.value}*interval '1 day')`:[];
  const pages=await cardMaterials(questions.rows.filter(q=>q.document.existing_url).map(q=>({existing_url:q.document.existing_url} as Recommendation)));
  const [profiles,search]=await Promise.all([demandProfiles(),sql`SELECT s.record,s.batch_id FROM studio_search_signals s JOIN studio_import_batches b ON b.id=s.batch_id ORDER BY b.created_at DESC,s.id`]);
  const candidates=planRecommendations({questions:questions.rows,profiles,materials:[...materials,...pages.filter(p=>!materials.some(m=>m.id===p.id)).map(p=>({...p,reference_only:true}))],search:search.map(s=>({...s.record,batch_id:s.batch_id} as SearchSignal)),now:scanAt});
  return sql.begin(async tx=>{
    const [policy]=await tx`SELECT value FROM settings WHERE key=${policyKey} FOR UPDATE`;
    if(!policy)invalid('先由运营设置待处理名额（5–15件），再生成建议。');
    let created=0;
    for(const candidate of candidates){
      const inserted=await tx`INSERT INTO studio_recommendations(id,input_key,question_id,article_id,article_revision,document,updated_by) VALUES(${`recommendation-${sha256(candidate.key).slice(0,32)}`},${candidate.key},${candidate.question_id},${candidate.article_id},${candidate.article_revision},${tx.json(candidate)},${actor})
        ON CONFLICT(input_key) DO UPDATE SET article_revision=EXCLUDED.article_revision,document=EXCLUDED.document||jsonb_build_object('bound_article_ids',COALESCE(studio_recommendations.document->'bound_article_ids','[]'::jsonb)),updated_by=EXCLUDED.updated_by,updated_at=now()
        WHERE EXCLUDED.document->>'trigger'='E' AND studio_recommendations.status IN ('pending','later') AND studio_recommendations.article_id=EXCLUDED.article_id AND studio_recommendations.article_revision<EXCLUDED.article_revision RETURNING xmax=0 AS created`;
      if(inserted[0]?.created)created++;
    }
    await tx`INSERT INTO settings(key,value,updated_by) VALUES(${refreshKey},${tx.json(scanAt)},${actor}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`;
    await audit(actor,'studio.recommendations.refresh','studio-recommendations',null,null,{scanned:materials.length,candidates:candidates.length,created},{db:tx});
    return {scanned:materials.length,candidates:candidates.length,created,modelCalled:false};
  });
}
export async function bindRecommendationEvidence(id:string,input:unknown,actor:string){
  const body=z.object({article_ids:z.array(z.string().min(1)).min(1).max(12)}).strict().parse(input);
  return sql.begin(async tx=>{
    const [card]=await tx`SELECT * FROM studio_recommendations WHERE id=${id} FOR UPDATE`;
    if(!card)return null;
    if(!['pending','later'].includes(card.status))invalid('仅待处理卡片可补证据，已采纳请在原任务继续。');
    const ids=[...new Set([...(card.document.bound_article_ids??[]),...body.article_ids])];
    if(ids.length>12)invalid('每张卡最多绑定12条材料。');
    const rows=await tx`SELECT id,body_status,body_text FROM articles WHERE id=ANY(${ids})`;
    if(rows.length!==ids.length||rows.some(r=>r.body_status!=='ok'||!r.body_text?.trim()))invalid('请先补齐所选材料正文，再绑定到卡片。');
    await tx`UPDATE studio_recommendations SET document=${tx.json({...card.document,bound_article_ids:ids})},updated_by=${actor},updated_at=now() WHERE id=${id}`;
    await audit(actor,'studio.recommendation.bind',`studio-recommendation:${id}`,null,null,{article_ids:ids},{db:tx});return {id,article_ids:ids};
  });
}
export async function decideRecommendation(id:string,input:unknown,actor:string){
  const body=z.object({action:z.enum(['adopt','reject','later','complete','observe']),reason:z.string().max(1000).optional(),baseline_found:z.boolean().nullable().optional()}).strict().parse(input);
  if(body.action==='reject'&&!body.reason?.trim())invalid('否决必须填写理由。');
  return sql.begin(async tx=>{
    // Refresh takes the same setting first; keep adoption's lock order consistent.
    const [policy]=body.action==='adopt'?await tx`SELECT value FROM settings WHERE key=${policyKey} FOR UPDATE`:[];
    const [card]=await tx`SELECT * FROM studio_recommendations WHERE id=${id} FOR UPDATE`;
    if(!card)return null;
    const document=card.document as Recommendation;
    if(body.action==='adopt'){
      if(card.status==='adopted')return {id,status:'adopted',task_id:card.task_id,reused:true};
      if(document.article_id&&!card.article_id)throw new Conflict('原素材已不存在，请保留此卡历史，不建立无依据任务。');
      let articleIds:string[]=[...(document.bound_article_ids??[])];
      if(card.article_id){const [current]=await tx`SELECT revision,body_status,body_text FROM articles WHERE id=${card.article_id} FOR SHARE`;if(!current||current.revision!==card.article_revision)throw new Conflict('素材版本已变化，请生成并处理新版本卡片。');if(current.body_status==='ok'&&current.body_text?.trim())articleIds=[...new Set([card.article_id,...articleIds])];}
      const pending=await tx<StoredRecommendation[]>`SELECT r.*,a.revision AS current_revision FROM studio_recommendations r LEFT JOIN articles a ON a.id=r.article_id WHERE r.status IN ('pending','later')`;
      const queue=allocateRecommendationCapacity(pending.map(r=>({...r,stale:r.article_id!==null&&r.current_revision!==r.article_revision})),policy?.value??null);
      if(queue.rows.some(r=>r.id===id&&r.expired))invalid('该短讯已超过7天新鲜窗口，保留作历史参考，不再采纳为时讯。');
      if(!queue.rows.some(r=>r.id===id&&!r.stale&&!r.expired&&!r.capacity_full))invalid('待处理名额已满，请先处理更高优先级的卡片。');
      const task=await createStudioTask({article_ids:articleIds,planning_context:{card_id:id,question_id:card.question_id,selection_origin:document.trigger==='M'?'operator':'automatic',action:document.action,question:document.title,existing_url:document.existing_url,requires_first_party:document.requires_first_party}},actor,tx);
      await tx`UPDATE studio_recommendations SET status='adopted',task_id=${task.id},updated_by=${actor},updated_at=now() WHERE id=${id}`;
      await audit(actor,'studio.recommendation.adopt',`studio-recommendation:${id}`,null,null,{task_id:task.id},{db:tx});
      return {id,status:'adopted',task_id:task.id};
    }
    if(body.action==='reject'||body.action==='later'){
      if(card.status==='adopted')invalid('已采纳的卡片请在原任务继续处理。');
      await tx`UPDATE studio_recommendations SET status=${body.action==='reject'?'rejected':'later'},rejection_reason=${body.action==='reject'?body.reason!:null},updated_by=${actor},updated_at=now() WHERE id=${id}`;
    }else if(body.action==='complete'){
      if(card.status!=='adopted'||document.action!=='update_page')invalid('仅已采纳的旧页更新卡可以标记完成。');
      await tx`UPDATE studio_recommendations SET completed=true,updated_by=${actor},updated_at=now() WHERE id=${id}`;
    }else{
      if(body.baseline_found===undefined)invalid('请选择基线是否也发现，或保留未知。');
      const baseline=body.baseline_found??null;
      await tx`UPDATE studio_recommendations SET baseline_found=${baseline},updated_by=${actor},updated_at=now() WHERE id=${id}`;
    }
    await audit(actor,`studio.recommendation.${body.action}`,`studio-recommendation:${id}`,body.reason??null,null,{baseline_found:body.baseline_found??null},{db:tx});
    return {id,action:body.action};
  });
}
