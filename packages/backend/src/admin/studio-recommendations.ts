// Programmatic editorial suggestions. Opening the page never runs selection or a model.
import { z } from 'zod';
import { sql } from '../db.ts';
import { audit, Conflict } from '../audit.ts';
import { sha256 } from '../lib/ids.ts';
import { editorialTopic } from '../../../../site/editorial.ts';
import { studioQuestions, type StudioQuestionRow, type StudioQuestion } from './studio-questions.ts';
import { demandProfiles, type DemandProfiles } from './studio-demand.ts';
import { type SearchSignal } from './studio-search-signals.ts';
import { createStudioTask } from './studio.ts';

const invalid=(message:string):never=>{throw Object.assign(new Error(message),{statusCode:400});};
const policyKey='studio.recommendations.weekly_limit';
const plain=(s:string)=>s.replace(/\s+/g,' ').trim();
export type PlanningMaterial={id:string;revision:number;title:string;body_text:string|null;body_status:string;url:string;source_id:string;published_at:string|Date|null;previous_revision?:number|null;previous_body?:string|null};
export type Recommendation={key:string;trigger:'A'|'E'|'B'|'C'|'D';question_id:string|null;article_id:string|null;article_revision:number|null;title:string;change:string;evidence:{url:string;date:string|null;revision:number|null;before?:string;after?:string}[];reason:string;action:'new_brief'|'new_explainer'|'new_tutorial'|'update_page';channels:string[];existing_url:string;requires_first_party:boolean;needs_material:boolean;demand_mentions:number;priority:number};
type RecommendationCounts={total:number;adopted:number;rejected:number;update_opportunities:number;updates_completed:number;baseline_missed_updates:number;baseline_unknown:number};
const actionFor=(q:StudioQuestion):Recommendation['action']=>q.existing_url?'update_page':q.content_type==='tutorial'?'new_tutorial':q.content_type==='news'?'new_brief':'new_explainer';
const keywordMatch=(q:StudioQuestion,text:string)=>q.keywords.filter(word=>{
  if(/^[a-z0-9 ]+$/i.test(word)){const escaped=word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`,'i').test(text);}
  return text.toLowerCase().includes(word.toLowerCase());
}).length;
const dateValue=(value:PlanningMaterial['published_at'])=>{const ms=value?new Date(value).getTime():NaN;return Number.isFinite(ms)?new Date(ms).toISOString():null;};
function changedParagraphs(before:string,after:string){
  const old=before.split(/\r?\n+/).map(plain).filter(Boolean),next=after.split(/\r?\n+/).map(plain).filter(Boolean);
  return {before:old.filter(p=>!next.includes(p)).join('\n'),after:next.filter(p=>!old.includes(p)).join('\n')};
}

export function planRecommendations(input:{questions:StudioQuestionRow[];materials:PlanningMaterial[];profiles:DemandProfiles;search:SearchSignal[];now:string}):Recommendation[]{
  const result:Recommendation[]=[],questions=input.questions.filter(q=>q.document.active),now=Date.parse(input.now);
  for(const material of input.materials){
    const text=material.title+'\n'+(material.body_text??''),date=dateValue(material.published_at),age=date?(now-Date.parse(date))/86400000:null;
    const fresh=age!==null&&age>=0&&age<=7;
    const change=material.previous_body&&material.body_text&&plain(material.previous_body)!==plain(material.body_text)?changedParagraphs(material.previous_body,material.body_text):null;
    const ranked=questions.map(q=>({q,matches:keywordMatch(q.document,text)})).filter(x=>x.matches>0).sort((a,b)=>b.matches-a.matches||a.q.id.localeCompare(b.q.id));
    const changed=change?ranked.find(x=>x.q.document.existing_url&&keywordMatch(x.q.document,change.before+'\n'+change.after)>0):undefined;
    const isVersion=/NovaLCT|ViPlex|LEDVISION|LEDStudio|HDPlayer|firmware|固件|软件版本/i.test(text)&&/\bv?\d+\.\d+(?:\.\d+){0,2}\b/.test(text);
    const hasVersionChange=!!change&&isVersion&&(/\bv?\d+\.\d+(?:\.\d+){0,2}\b/.test(change.before+'\n'+change.after));
    const best=changed?.q??ranked[0]?.q;
    let trigger:Recommendation['trigger']|null=changed?'A':(fresh||hasVersionChange)&&isVersion?'E':fresh&&(!!best||!!editorialTopic(text))?'D':null;
    if(!trigger)continue;
    const q=best?.document;
    const reason=q?`对应“${q.question}”；面向${q.roles.join('、')}。`:'按LED商显主题线索供集成商和媒体运营确认，尚未挂接已有问题。';
    result.push({key:`material:${material.id}:${material.revision}`,trigger,question_id:best?.id??null,article_id:material.id,article_revision:material.revision,
      title:q?.question??material.title,change:trigger==='A'?`原文第${material.previous_revision??material.revision-1}版与第${material.revision}版出现相关段落差异，需确认是否实质更新。`:trigger==='E'?'发现软件/固件版本资料，请结合实机核对教程是否需更新。':'近7天的原厂或行业材料，需编辑确认客户影响。',
      evidence:[{url:material.url,date,revision:material.revision,...(change?{before:change.before.slice(0,350),after:change.after.slice(0,350)}:{})}],reason,
      action:q?actionFor(q):'new_brief',channels:['blog','social'],existing_url:q?.existing_url??'',requires_first_party:!!q?.requires_first_party,
      needs_material:material.body_status!=='ok'||!material.body_text||!!q?.requires_first_party||!!q?.existing_url&&q.existing_url!==material.url,demand_mentions:0,priority:trigger==='A'?0:trigger==='E'?1:4});
  }
  for(const question of questions){
    const q=question.document;
    const groups=input.profiles.groups.filter(g=>q.roles.includes(g.role)&&(g.scenario===q.scenario||g.needTags.some(tag=>keywordMatch(q,tag.tag)>0)));
    const mentions=groups.reduce((n,g)=>n+g.recordCount,0);
    if(!q.existing_url&&mentions>=2){result.push({key:`demand:${question.id}:${question.version}`,trigger:'B',question_id:question.id,article_id:null,article_revision:null,title:q.question,
      change:'登记需求反复出现，问题地图尚无承接页面。',evidence:[],reason:`${groups.map(g=>`${g.role}/${g.region}/${g.scenario}`).join('；')}，共${mentions}条登记提及；可重叠，未按客户去重。`,action:actionFor(q),channels:['blog','social'],existing_url:'',requires_first_party:q.requires_first_party,needs_material:true,demand_mentions:mentions,priority:2});}
    const search=input.search.filter(s=>keywordMatch(q,s.query)>0&&(s.kind==='gsc'&&(s.impressions??0)>0&&s.position>10||s.kind==='semrush'&&s.position<=10&&!q.existing_url));
    for(const signal of search){result.push({key:`search:${question.id}:${question.version}:${signal.kind}:${signal.query}:${signal.page}:${signal.period??'unknown'}`,trigger:'C',question_id:question.id,article_id:null,article_revision:null,title:q.question,
      change:signal.kind==='gsc'?`导入查询有展示，平均排名为${signal.position}，可检查承接内容。`:`Semrush导入显示相关词前10页面线索；估算不是实测流量。`,evidence:[{url:signal.page,date:null,revision:null}],
      reason:`${q.roles.join('、')}；查询“${signal.query}”；数据期${signal.period??'未知'}。`,action:signal.kind==='gsc'?'update_page':actionFor(q),channels:['blog','social'],existing_url:q.existing_url||(signal.kind==='gsc'?signal.page:''),requires_first_party:q.requires_first_party,needs_material:true,demand_mentions:mentions,priority:3});}
  }
  return [...new Map(result.map(r=>[r.key,r])).values()].sort((a,b)=>a.priority-b.priority||b.demand_mentions-a.demand_mentions||a.key.localeCompare(b.key));
}

export async function recommendationOverview(){
  const [setting]=await sql`SELECT value FROM settings WHERE key=${policyKey}`;
  const rows=await sql`SELECT r.*,CASE WHEN r.document->>'article_id' IS NOT NULL THEN a.id IS NULL OR a.revision<>r.article_revision ELSE false END AS stale FROM studio_recommendations r LEFT JOIN articles a ON a.id=r.article_id ORDER BY (r.document->>'priority')::int,r.created_at DESC,r.id`;
  const [counts]=await sql<RecommendationCounts[]>`SELECT count(*)::int AS total,count(*) FILTER(WHERE status='adopted')::int AS adopted,count(*) FILTER(WHERE status='rejected')::int AS rejected,
    count(*) FILTER(WHERE document->>'action'='update_page')::int AS update_opportunities,count(*) FILTER(WHERE document->>'action'='update_page' AND completed)::int AS updates_completed,
    count(*) FILTER(WHERE document->>'action'='update_page' AND baseline_found=false)::int AS baseline_missed_updates,
    count(*) FILTER(WHERE document->>'action'='update_page' AND baseline_found IS NULL)::int AS baseline_unknown FROM studio_recommendations`;
  const reasons=await sql`SELECT rejection_reason AS reason,count(*)::int AS count FROM studio_recommendations WHERE status='rejected' GROUP BY rejection_reason ORDER BY count(*) DESC,rejection_reason`;
  const decided=counts.adopted+counts.rejected;
  return {rows,weeklyLimit:setting?.value??null,metrics:{...counts,adoptionRate:decided?counts.adopted/decided:null,denominator:'采纳数+否决数；稍后再看与未处理不计分母',reasons},note:'人工分钟和调用成本继续由现有回执记录，不作为本期验收门槛。'};
}
export async function setRecommendationCapacity(input:unknown,actor:string){
  const body=z.object({weekly_limit:z.number().int().min(5).max(15)}).strict().parse(input);
  await sql`INSERT INTO settings(key,value,updated_by) VALUES(${policyKey},${sql.json(body.weekly_limit)},${actor}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`;
  await audit(actor,'studio.recommendations.capacity',`settings:${policyKey}`,null,null,body);return body;
}
export async function refreshRecommendations(actor:string){
  const [questions,profiles,materials,search]=await Promise.all([
    studioQuestions(),demandProfiles(),
    sql<PlanningMaterial[]>`SELECT a.id,a.revision,a.title,a.body_text,a.body_status,a.url,a.source_id,a.published_at,old.revision AS previous_revision,old.body_text AS previous_body FROM articles a LEFT JOIN LATERAL(SELECT revision,body_text FROM article_revisions WHERE article_id=a.id AND revision<a.revision ORDER BY revision DESC LIMIT 1) old ON true`,
    sql`SELECT s.record FROM studio_search_signals s JOIN studio_import_batches b ON b.id=s.batch_id ORDER BY b.created_at DESC,s.id`,
  ]);
  const candidates=planRecommendations({questions:questions.rows,profiles,materials,search:search.map(s=>s.record as SearchSignal),now:new Date().toISOString()});
  return sql.begin(async tx=>{
    const [policy]=await tx`SELECT value FROM settings WHERE key=${policyKey} FOR UPDATE`;
    if(!policy)invalid('先由运营设置每周审核产能（5–15件），再生成建议。');
    const [week]=await tx`SELECT count(*)::int AS n FROM studio_recommendations WHERE created_at>=date_trunc('week',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
    let remaining=Math.max(0,Number(policy.value)-week.n),created=0;
    for(const candidate of candidates){
      if(remaining===0)break;
      const inserted=await tx`INSERT INTO studio_recommendations(id,input_key,question_id,article_id,article_revision,document,updated_by) VALUES(${`recommendation-${sha256(candidate.key).slice(0,32)}`},${candidate.key},${candidate.question_id},${candidate.article_id},${candidate.article_revision},${tx.json(candidate)},${actor}) ON CONFLICT(input_key) DO NOTHING RETURNING id`;
      if(inserted.length){created++;remaining--;}
    }
    await audit(actor,'studio.recommendations.refresh','studio-recommendations',null,null,{scanned:materials.length,candidates:candidates.length,created},{db:tx});
    return {scanned:materials.length,candidates:candidates.length,created,remaining,weekTimezone:'UTC',modelCalled:false};
  });
}
export async function decideRecommendation(id:string,input:unknown,actor:string){
  const body=z.object({action:z.enum(['adopt','reject','later','complete','observe']),reason:z.string().max(1000).optional(),baseline_found:z.boolean().nullable().optional()}).strict().parse(input);
  if(body.action==='reject'&&!body.reason?.trim())invalid('否决必须填写理由。');
  return sql.begin(async tx=>{
    const [card]=await tx`SELECT * FROM studio_recommendations WHERE id=${id} FOR UPDATE`;
    if(!card)return null;
    const document=card.document as Recommendation;
    if(body.action==='adopt'){
      if(card.status==='adopted')return {id,status:'adopted',task_id:card.task_id,reused:true};
      if(document.article_id&&!card.article_id)throw new Conflict('原素材已不存在，请保留此卡历史，不建立无依据任务。');
      let articleIds:string[]=[];
      if(card.article_id){const [current]=await tx`SELECT revision,body_status,body_text FROM articles WHERE id=${card.article_id}`;if(!current||current.revision!==card.article_revision)throw new Conflict('素材版本已变化，请生成并处理新版本卡片。');if(current.body_status==='ok'&&current.body_text?.trim())articleIds=[card.article_id];}
      const task=await createStudioTask({article_ids:articleIds,planning_context:{card_id:id,question_id:card.question_id,action:document.action,question:document.title,existing_url:document.existing_url,requires_first_party:document.requires_first_party}},actor,tx);
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
