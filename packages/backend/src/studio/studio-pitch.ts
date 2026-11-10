import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { sql } from '../db.ts';
import { audit, Conflict } from '../audit.ts';
import { enqueue, QUEUES } from '../jobs/queue.ts';
import { normalizeUrl } from '../lib/url.ts';
import { sha256 } from '../lib/ids.ts';
import { upsertMaterial } from '../content/materials.ts';
import { fetchDetail } from '../sources/web-list.ts';
import type { SourceRow } from '../sources/types.ts';
import { chatJson, type ChatJsonOptions, type ChatJsonResult } from '../providers/llm.ts';
import { createStudioTask, extractStudioMaterial, generateStudioTask, studioMaterial, studioGenerationStatus } from './studio.ts';
import { redactPitch, normalizePitch, searchPitchMaterials } from './studio-pitch-evidence.ts';
import { companyFactRules } from './studio-company-facts.ts';
import { pitchType, pitchPlanSchema, pitchKeywordsSchema, pitchSchema, editorialChoicesSchema, type EditorialChoices, type Pitch } from '../../../../scripts/editorial-pitch-lib.ts';
import type { ResearchReport, discoverPitchEvidence } from './studio-pitch-research.ts';

function invalid(message:string):never {throw Object.assign(new Error(message),{statusCode:400});}
const urlSchema=z.string().trim().max(2000).refine(value=>!value||!!normalizeUrl(value)&&!new URL(value).username&&!new URL(value).password,'请填写公开网页链接');
const inputSchema=z.object({question:z.string().trim().min(4).max(1000),privacy_confirmed:z.literal(true),output_type:pitchType.default('auto'),existing_url:urlSchema.default(''),links:z.array(urlSchema.refine(Boolean)).max(3).default([]),question_id:z.string().optional()}).strict();
type Material=Awaited<ReturnType<typeof searchPitchMaterials>>[number]&{existing_page?:boolean};
export type Prep=Omit<Partial<z.infer<typeof pitchPlanSchema>>,'output_type'>&{
  workflow_version?:2;
  model_outcome?:'unknown';pending_receipt_id?:number|null;
  version:number;status:'preparing'|'ready'|'insufficient'|'failed'|'confirmed';question:string;output_type:z.infer<typeof pitchType>;existing_url:string;links:string[];
  started_at:string;finished_at?:string;question_en?:string;keywords?:string[];entities?:string[];materials?:Material[];
  related_pages?:{title:string;url:string}[];blacklist?:{configured:boolean;blocked:number;pending:number};
  research?:ResearchReport;editorial_choices?:EditorialChoices;
  scope_options?:{id:string;question:string;includes:string[];omits:string[];subquestion_ids:string[]}[];
  scope?:{original_question:string;question:string;omitted_questions:string[]};
  error?:string;link_errors?:{url:string;reason:string}[];metrics?:{preparation_ms:number|null;replayed?:boolean;replay_ms?:number;confirmation_elapsed_ms?:number;receipts:{id:number;usage:unknown;model:string}[]};
};
type Card={id:string;question_id:string;task_id:string|null;status:string;document:Record<string,any>&{prep?:Prep};updated_at:Date;task_state?:string|null};
const prompt=(name:string)=>readFileSync(new URL(`../../../../industry/prompts/${name}.md`,import.meta.url),'utf8');
const canonical=(value:string)=>value?normalizeUrl(value)??value:'';
const ongoing=(state:string)=>!['rejected'].includes(state);

export function previewPitch(input:unknown){return redactPitch(z.object({question:z.string().max(4000)}).parse(input).question);}
function view(card:Card){const fragments=card.document.prep&&'fragments' in card.document.prep?card.document.prep.fragments as {status:string}[]:[];return {id:card.id,title:card.document.title,status:card.document.prep?.status??(card.task_id?'confirmed':'unprepared'),version:card.document.prep?.version??0,task_id:card.task_id,task_state:fragments?.some(f=>f.status==='running')?'writing':fragments?.some(f=>f.status==='unknown')?'unknown':card.task_state??null,prep:card.document.prep??null};}
export async function listPitches(){
  const rows=await sql<Card[]>`SELECT * FROM studio_recommendations WHERE document ? 'prep' ORDER BY updated_at DESC LIMIT 50`;
  return {rows:rows.map(view)};
}
export async function getPitch(id:string){const [card]=await sql<Card[]>`SELECT r.*,(SELECT CASE WHEN t.state='waiting' AND EXISTS(SELECT 1 FROM receipts p WHERE p.subject='studio-task:'||t.id AND p.status='unknown') THEN 'unknown' WHEN t.state='waiting' AND EXISTS(SELECT 1 FROM receipts p WHERE p.subject='studio-task:'||t.id AND p.status='pending') THEN 'writing' ELSE t.state END FROM studio_tasks t WHERE t.id=r.task_id) AS task_state FROM studio_recommendations r WHERE r.id=${id}`;return card?view(card):null;}

export async function createPitch(input:unknown,actor:string){
  const b=inputSchema.parse(input),redacted=redactPitch(b.question);
  if(redacted.text!==b.question)invalid('还有可识别的个人信息，请先预览脱敏结果并确认。');
  if(b.output_type==='update'&&!b.existing_url)invalid('升级已有页需要填写真实页面链接。');
  const key=normalizePitch(b.question),page=canonical(b.existing_url);
  const questions=await sql`SELECT id,document,version FROM studio_questions`;
  const same=questions.find(q=>b.question_id?q.id===b.question_id:normalizePitch(q.document.question)===key||normalizePitch(q.document.question_en??'')===key);
  if(b.question_id&&!same)invalid('原问题已不存在，请刷新问题地图。');
  const questionId=same?.id??`question-pitch-${sha256(key).slice(0,24)}`;
  // Existing question/card identities and the card row lock arbitrate repeated clicks.
  const id=`recommendation-${sha256(page?`pitch-page:${page}`:`pitch-question:${questionId}`).slice(0,32)}`;
  await enqueueReady();
  return sql.begin(async tx=>{
    const existing=await tx<Card[]>`SELECT * FROM studio_recommendations WHERE question_id=${questionId} OR id=${id} OR (${!!page} AND document->>'existing_url'<>'') ORDER BY created_at DESC`;
    const match=existing.find(c=>(c.question_id===questionId||c.id===id||!!page&&canonical(c.document.existing_url??'')===page)&&ongoing(c.status)&&(c.task_id||c.document.prep));
    if(match)return {...view(match),reused:true};
    if(!same){
      const doc={question:b.question,question_en:'',origin:'pitch',roles:['未知'],scenario:'运营命题',dimension:'场景',existing_url:b.existing_url,existing_url_provenance:'operator_entered',condition_refs:[],source_ids:[],demand_evidence:[],keywords:[],keywords_zh:[],keywords_en:['LED display'],content_type:'explainer',requires_first_party:false,active:true};
      await tx`INSERT INTO studio_questions(id,document,created_by,updated_by) VALUES(${questionId},${tx.json(doc)},${actor},${actor}) ON CONFLICT DO NOTHING`;
    }
    const prep:Prep={workflow_version:2,version:1,status:'preparing',question:b.question,output_type:b.output_type,existing_url:b.existing_url,links:b.links,started_at:new Date().toISOString()};
    const document={key:`pitch:${id}`,trigger:'M',question_id:questionId,article_id:null,article_revision:null,title:b.question,evidence:[],change:'运营命题，正在备料。',reason:'人工选题，先核对资料再成稿。',action:page?'update_page':b.output_type==='short'?'new_brief':'new_explainer',channels:['blog','social'],existing_url:b.existing_url,requires_first_party:false,needs_material:true,demand_mentions:0,priority:2,prep};
    const [row]=await tx<Card[]>`INSERT INTO studio_recommendations(id,input_key,question_id,document,updated_by) VALUES(${id},${`pitch:${id}`},${questionId},${tx.json(document as never)},${actor}) ON CONFLICT DO NOTHING RETURNING *`;
    if(!row){const [current]=await tx<Card[]>`SELECT * FROM studio_recommendations WHERE id=${id}`;return {...view(current),reused:true};}
    await enqueue(QUEUES.studioPrep,{cardId:id,version:1,actor,phase:'prepare'},{singletonKey:`${id}:1`,retryLimit:0},tx);
    await audit(actor,'studio.pitch.create',`studio-recommendation:${id}`,null,null,{question_id:questionId},{db:tx});
    return {...view(row),reused:false};
  });
}
async function enqueueReady(){const {ensureQueue}=await import('../jobs/queue.ts');await ensureQueue(QUEUES.studioPrep);}

export async function revisePitch(id:string,input:unknown,actor:string){
  const b=z.object({version:z.number().int(),links:z.array(urlSchema.refine(Boolean)).max(3),output_type:pitchType,existing_url:urlSchema}).strict().parse(input);
  if(b.output_type==='update'&&!b.existing_url)invalid('升级已有页需要真实链接。');
  await enqueueReady();
  return sql.begin(async tx=>{
    const [card]=await tx<Card[]>`SELECT * FROM studio_recommendations WHERE id=${id} FOR UPDATE`;
    if(!card)return null;
    const old=card.document.prep;
    if(!old||old.version!==b.version)throw new Conflict('备料卡已变化，请刷新。');
    if(card.task_id)invalid('已经建立成稿任务，请在原任务继续。');
    if(old.status==='preparing')invalid('备料正在进行，请等待结果。');
    if(old.model_outcome==='unknown')invalid('已有备料调用结果待核对，不会用重新备料重复发送。');
    const prep:Prep={workflow_version:2,version:old.version+1,status:'preparing',question:old.question,output_type:b.output_type,existing_url:b.existing_url,links:b.links,started_at:new Date().toISOString(),...(old.scope?{scope:old.scope}:{})};
    await tx`UPDATE studio_recommendations SET document=${tx.json({...card.document,existing_url:b.existing_url,prep} as never)},updated_by=${actor},updated_at=now() WHERE id=${id}`;
    await enqueue(QUEUES.studioPrep,{cardId:id,version:prep.version,actor,phase:'prepare'},{singletonKey:`${id}:${prep.version}`,retryLimit:0},tx);
    return {id,status:prep.status,version:prep.version};
  });
}

export async function importLink(url:string,actor:string,reference=false,automatic=false){
  const rows=await sql`SELECT id,url,title,source_id FROM articles`;
  const existing=rows.find(row=>canonical(row.url)===canonical(url));
  if(existing&&existing.title!==new URL(url).hostname&&!automatic){
    let material=await studioMaterial(existing.id);
    if(!material?.body_text){await extractStudioMaterial(existing.id,actor);material=await studioMaterial(existing.id);}
    if(!material?.body_text?.trim())throw new Error('该资料正文暂未取得，未记为可用证据。');
    return existing.id as string;
  }
  if(existing&&automatic){const material=await studioMaterial(existing.id);if(material?.body_text?.trim())return existing.id as string;}
  const sourceId=existing&&automatic?existing.source_id:reference?'studio-reference-pages':'studio-operator-links';
  if(!(existing&&automatic))await sql`INSERT INTO sources(id,name,kind,config,tier,participation_mode,first_party,enabled) VALUES(${sourceId},${reference?'参考资料':'运营提供'},'web_list',${sql.json({detail:{titleSelector:'h1'}})},'T2','isolated',false,false) ON CONFLICT(id) DO UPDATE SET config=sources.config||EXCLUDED.config`;
  const [source]=await sql<SourceRow[]>`SELECT * FROM sources WHERE id=${sourceId}`;
  const result=await fetchDetail(url,automatic?{...source,config:{...source.config,url:undefined}}:source,{title:true,date:true,body:true,summary:false},automatic?0:undefined);
  if(!result.body?.text)throw new Error(automatic?'已发现链接，但本轮未取得可读正文。可以继续自动查找其他资料。':'当前抽取器没有取得可读正文，请补充可访问的网页版资料。');
  const saved=await upsertMaterial({sourceId,url,title:existing&&automatic?existing.title:result.title||new URL(url).hostname,bodyText:result.body.text,bodyHtml:result.body.html,bodyStatus:'ok',publishedAt:result.publishedAt,publicationTime:result.publicationTime,via:'studio-pitch',backfill:'operator-reference'});
  await audit(actor,'studio.material.extract',`content:${saved.articleId}`,automatic?'自动发现公开链接，复用正文抽取':'运营提供链接，复用正文抽取',null,{state:'ok',via:'studio-pitch'});
  return saved.articleId;
}
async function linkedMaterial(id:string,existingUrl:string):Promise<Material>{
  const m=await studioMaterial(id);
  return {...m,first_party:false,hit_count:0,snippet:m.body_text?.slice(0,400)??'',existing_page:!!existingUrl&&canonical(m.url)===canonical(existingUrl)} as Material;
}

export function validatePitchEvidence(plan:z.infer<typeof pitchPlanSchema>,materials:Material[]){
  const supports=(id:string,quote:string)=>materials.some(m=>m.id===id&&(m.body_text?.includes(quote)||m.title.includes(quote)));
  for(const s of plan.outline){
    s.evidence=s.evidence.filter(e=>supports(e.article_id,e.quote));
    if(!s.evidence.length&&!s.gap){s.gap='未找到可核对的原文句子';s.action='补链接或删除本节';}
  }
  for(const t of [...plan.titles,...plan.hooks])if(!supports(t.article_id,t.quote))invalid('模型标题的事实锚点不在提供的原文中，请调整备料。');
  const sections=new Set(plan.outline.map(s=>s.id));
  if(sections.size!==plan.outline.length)invalid('模型返回重复小节编号。');
  for(const q of plan.engineer_questions){
    if(q.options[0]?.id!=='A'||!q.options[0].conservative||q.options.slice(1).some(o=>o.conservative)||/\d/.test(q.options[0].instruction+q.options[0].label))invalid('工程问题的A选项必须是无数值的保守写法。');
    if(q.section_ids.some(id=>!sections.has(id)))invalid('工程问题没有对应的大纲小节。');
  }
  return plan;
}

async function pitchModel<S extends z.ZodType>(options:ChatJsonOptions<S>,replay:boolean):Promise<ChatJsonResult<z.infer<S>>>{
  if(!replay)return chatJson(options);
  const [saved]=await sql`SELECT id,model,response,usage FROM receipts WHERE subject=${options.subject} AND purpose=${options.purpose} AND response IS NOT NULL ORDER BY id DESC LIMIT 1`;
  if(!saved)invalid('没有已保存的模型结果，不能进行免调用重放。');
  const content=saved.response?.choices?.[0]?.message?.content;
  const data=options.schema.parse(JSON.parse(content));
  return {data,receiptId:Number(saved.id),model:saved.model,usage:saved.usage,reused:true};
}
export async function preparePitch(id:string,version:number,actor:string,replay=false,research?:typeof discoverPitchEvidence){
  const [card]=await sql<Card[]>`SELECT * FROM studio_recommendations WHERE id=${id}`;
  const prep=card?.document.prep;
  if(prep?.workflow_version===2){const {preparePitchV2}=await import('./studio-pitch-v2.ts');return preparePitchV2(id,version,actor,replay,research);}
  if(!card||!prep||prep.version!==version||prep.status!=='preparing'&&!(replay&&prep.status==='failed'))return {reused:true};
  const receipts:NonNullable<Prep['metrics']>['receipts']=[];
  const start=performance.now();
  const save=async(next:Prep)=>sql`UPDATE studio_recommendations SET document=jsonb_set(document,'{prep}',${sql.json(next as never)}),updated_at=now() WHERE id=${id} AND (document->'prep'->>'version')::int=${version}`;
  try{
    if(!replay){const enabled=await studioGenerationStatus();if(!enabled.ready)invalid(enabled.reason);}
    const system=prompt('studio-pitch-keywords');
    const query=await pitchModel({model:'default',purpose:'studio_prep_keywords',subject:`studio-pitch:${id}:${version}`,promptVersion:sha256(system),system,user:JSON.stringify({question:prep.question,schema:{question_en:'English buyer question',keywords:['5-10 Chinese/English terms'],entities:['exact entities']}}),schema:pitchKeywordsSchema,maxTokens:1500,temperature:0.2,timeoutMs:120000,sessionId:id},replay);
    receipts.push({id:query.receiptId,usage:query.usage,model:query.model});
    const keywords=query.data.keywords;
    const materials=await searchPitchMaterials(keywords,8);
    const linkErrors:{url:string;reason:string}[]=[];
    for(const url of [...new Set([prep.existing_url,...prep.links].filter(Boolean))]){
      try{const mid=await importLink(url,actor);const m=await linkedMaterial(mid,prep.existing_url);const found=materials.findIndex(x=>x.id===mid);if(found>=0)materials.splice(found,1);materials.unshift(m);}
      catch(error){linkErrors.push({url,reason:error instanceof Error?error.message.slice(0,250):'取文失败'});}
    }
    const selected=materials.slice(0,9) as Material[];
    const questions=await sql`SELECT document FROM studio_questions WHERE document->>'existing_url'<>''`;
    const related=questions.filter(q=>keywords.some(k=>(q.document.question+' '+q.document.question_en+' '+(q.document.keywords??[]).join(' ')).toLowerCase().includes(k.toLowerCase()))).map(q=>({title:q.document.question,url:q.document.existing_url})).slice(0,5);
    const facts=companyFactRules();
    const common={...prep,...query.data,materials:selected,related_pages:related,link_errors:linkErrors,blacklist:{configured:facts.configured,blocked:0,pending:0}};
    await save(common);
    const complete=(next:Prep)=>({...next,finished_at:new Date().toISOString(),metrics:{preparation_ms:replay?(prep.metrics?.preparation_ms??null):Math.round(performance.now()-start),...(replay?{replayed:true,replay_ms:Math.round(performance.now()-start)}:{}),receipts}});
    if(selected.filter(m=>m.body_status==='ok'&&m.body_text).length<2&&!selected.some(m=>m.existing_page)){
      await save(complete({...common,status:'insufficient',error:'证据不足：请补充线索链接，或调整为短文章后重新核对；不生成全文。'}));return {status:'insufficient'};
    }
    const system2=prompt('studio-pitch-outline');
    const result=await pitchModel({model:'default',purpose:'studio_prep_outline',subject:`studio-pitch:${id}:${version}`,promptVersion:sha256(system2),system:system2,user:JSON.stringify({question:prep.question,question_en:query.data.question_en,output_type:prep.output_type,existing_url:prep.existing_url,materials:selected.map(m=>({id:m.id,title:m.title,body_text:m.body_text?.slice(0,18000),published_at:m.publication_time??m.published_at,existing_page:m.existing_page})),response_format:{output_type:prep.output_type==='auto'?'guide':prep.output_type,outline:[{id:'s1',heading:'中文小节',evidence:[{article_id:'provided ID',quote:'exact source sentence'}],gap:'',action:''}],titles:[{title:'English title <=60 chars',anchor:'中文说明',article_id:'provided ID',quote:'exact quote'}],hooks:[{title:'English social hook',anchor:'中文说明',article_id:'provided ID',quote:'exact quote'}],engineer_questions:[{id:'q1',question:'中文问题',section_ids:['s1'],options:[{id:'A',label:'保守写法',instruction:'以型号安装图为准，不写数值',conservative:true},{id:'B',label:'其他，请写明',instruction:'依据工程师回复',conservative:false}],withheld_numbers:['only actual unsupported values with units']}]}}),schema:pitchPlanSchema,maxTokens:6000,temperature:0.2,timeoutMs:180000,sessionId:id},replay);
    receipts.push({id:result.receiptId,usage:result.usage,model:result.model});
    const plan=validatePitchEvidence(result.data,selected);
    if(prep.output_type!=='auto')plan.output_type=prep.output_type;
    let blocked=0,pending=0;
    plan.outline=plan.outline.filter(section=>{
      const text=JSON.stringify(section);
      const hits=facts.rules.filter(rule=>text.toLowerCase().includes(rule.match.toLowerCase()));
      if(hits.some(r=>r.action==='deny')){blocked++;return false;}
      for(const rule of hits.filter(r=>r.action==='confirm')){
        pending++;
        if(plan.engineer_questions.length>=3){section.gap='公司事实尚需工程确认';section.action='删除本节或补充确认';continue;}
        plan.engineer_questions.push({id:`fact-${rule.id}`,question:'这一节涉及待确认的公司说法，应怎样写？',section_ids:[section.id],options:[{id:'A',label:'使用保守表述',instruction:rule.conservative,conservative:true},{id:'B',label:'工程师提供经批准的表述',instruction:'按工程师原回复并保留适用条件',conservative:false},{id:'C',label:'其他，请写明',instruction:'按工程师补充说明',conservative:false}],withheld_numbers:rule.match.match(/\d[\d.,]*\s*(?:kW|W|mm|m|%|nits)/gi)??[]});
      }
      return true;
    });
    if(!plan.outline.length)invalid('备料大纲全部命中公司事实禁止项，请更换选题范围。');
    await save(complete({...common,...plan,status:'ready',blacklist:{configured:facts.configured,blocked,pending}}));
    if(replay)await audit(actor,'studio.pitch.replay',`studio-recommendation:${id}`, '复用已保存的模型回答，重新验证结构和逐字出处，无新调用',null,{version,receipt_ids:receipts.map(r=>r.id)});
    await sql`UPDATE studio_questions SET document=document||${sql.json({question_en:query.data.question_en,keywords:[],keywords_en:keywords.filter(k=>/[a-z]/i.test(k)),keywords_zh:keywords.filter(k=>/[\u3400-\u9fff]/.test(k)),source_ids:[...new Set(selected.map(m=>m.source_id))]})} WHERE id=${card.question_id} AND document->>'origin'='pitch'`;
    return {status:'ready',materials:selected.length};
  }catch(error){
    const message=error instanceof Error?error.message.slice(0,300):'备料失败';
    await save({...prep,status:'failed',error:message,finished_at:new Date().toISOString(),metrics:{preparation_ms:replay?(prep.metrics?.preparation_ms??null):Math.round(performance.now()-start),...(replay?{replayed:true,replay_ms:Math.round(performance.now()-start)}:{}),receipts}});
    throw error;
  }
}

const confirmSchema=z.object({version:z.number().int(),choice_revision:z.number().int().nonnegative().optional(),article_ids:z.array(z.string()).min(1).max(12),selected_title:z.string().min(1).max(60),output_type:z.enum(['update','guide','short']),outline:z.array(z.object({id:z.string(),heading:z.string().min(1).max(200),include:z.boolean()})).min(1).max(7),engineer:z.object({mode:z.enum(['conservative','engineer']),name:z.string().max(100).default(''),reply:z.string().max(2000).default(''),answers:z.array(z.object({question_id:z.string(),choice:z.string().regex(/^[A-D]$/),note:z.string().max(1000).default('')})).max(3).default([])})}).strict();
export function confirmedPitch(prep:Prep,input:unknown):Pitch{
  const b=confirmSchema.parse(input);
  if(prep.version!==b.version)throw new Conflict('备料已更新，请刷新后确认。');
  if(prep.status!=='ready')invalid('备料尚未就绪，不能成稿。');
  if(prep.scope_options?.length)invalid('请先选择这篇要解决的买家问题，范围变化需要明确确认。');
  const saved=prep.editorial_choices;
  if(saved&&(b.choice_revision!==saved.revision||b.selected_title!==saved.selected_title||JSON.stringify(b.article_ids)!==JSON.stringify(saved.article_ids)||JSON.stringify(b.outline)!==JSON.stringify(saved.outline)))throw new Conflict('方向或大纲已变化，请先保存当前选择，再确认成稿。');
  const materials=(prep.materials??[]).filter(m=>b.article_ids.includes(m.id));
  if(new Set(b.article_ids).size!==b.article_ids.length||materials.length!==b.article_ids.length)invalid('所选素材不在本次备料卡中。');
  if(materials.some(m=>m.body_status!=='ok'||!m.body_text))invalid('所选素材正文尚未齐全。');
  if(prep.workflow_version!==2&&materials.length<2&&!materials.some(m=>m.existing_page))invalid('证据不足：至少选两条素材，或绑定已有页面正文。');
  if(b.output_type==='update'&&(!prep.existing_url||!materials.some(m=>m.existing_page)))invalid('升级稿必须选中已有页面正文。');
  if(!prep.titles?.some(t=>t.title===b.selected_title&&b.article_ids.includes(t.article_id)))invalid('请选用有已选素材支撑的标题。');
  const engineer=b.engineer;
  const questions=prep.engineer_questions??[];
  if(engineer.mode==='engineer'&&(!engineer.name.trim()||!engineer.reply.trim()))invalid('录入工程回复需要答题工程师和原回复；没有回复请选择保守写法。');
  const answers=questions.map((q,index)=>{
    const answer=engineer.answers.find(a=>a.question_id===q.id);
    const choice=engineer.mode==='conservative'?'A':answer?.choice;
    const option=q.options.find(o=>o.id===choice);
    if(!option)invalid('请完整录入工程师的每道答案。');
    if(engineer.mode==='engineer'&&!new RegExp(`(?:^|[A-D\\s,，;；])${index+1}\\s*${choice}(?=$|[\\d\\s,，;；])`,'i').test(engineer.reply))invalid('选项与工程师原回复不一致。');
    if(choice!=='A'&&!answer?.note.trim())invalid('非保守选项须附工程师的具体依据或补充说明。');
    return {question_id:q.id,choice:choice!,note:engineer.mode==='conservative'?'':answer?.note??'',instruction:option.instruction};
  });
  const outline=b.outline.filter(s=>s.include).map(section=>{
    const original=prep.outline?.find(s=>s.id===section.id);if(!original)invalid('大纲编号已变化。');
    const evidence=original.evidence.filter(e=>b.article_ids.includes(e.article_id));
    const related=questions.filter(q=>q.section_ids.includes(section.id));
    if(!evidence.length&&!related.length&&prep.workflow_version!==2)invalid('保留的小节没有所选证据或工程确认，请补资料或删除。');
    return {...original,heading:section.heading,evidence,action:related.map(q=>answers.find(a=>a.question_id===q.id)!.instruction).join('；')||original.action};
  });
  if(!outline.length)invalid('至少保留一个有依据的小节。');
  return pitchSchema.parse({question:prep.question,output_type:b.output_type,existing_url:prep.existing_url,selected_title:b.selected_title,primary_article_id:(materials.find(m=>m.existing_page)??materials[0]).id,outline,
    ...(saved?{editorial_choices:saved}:{}),...(prep.scope?{scope:prep.scope}:{}),
    engineer:{mode:engineer.mode,name:engineer.mode==='engineer'?engineer.name:'',reply:engineer.mode==='engineer'?engineer.reply:'',answers},
    withheld_numbers:questions.filter(q=>answers.find(a=>a.question_id===q.id)?.choice==='A').flatMap(q=>q.withheld_numbers)});
}
export async function savePitchChoices(id:string,input:unknown,actor:string){
  const b=editorialChoicesSchema.omit({revision:true}).extend({version:z.number().int(),choice_revision:z.number().int().nonnegative()}).strict().parse(input);
  return sql.begin(async tx=>{
    const [card]=await tx<Card[]>`SELECT * FROM studio_recommendations WHERE id=${id} FOR UPDATE`;
    if(!card)return null;
    const prep=card.document.prep;
    if(!prep||prep.version!==b.version||prep.status!=='ready'||card.task_id)throw new Conflict('此备料卡不能修改方向，请刷新。');
    if((prep.editorial_choices?.revision??0)!==b.choice_revision)throw new Conflict('选择已在另一处更新，请刷新。');
    if(prep.scope_options?.length)invalid('请先确认有证据支持的采编范围。');
    if(new Set(b.outline.map(s=>s.id)).size!==b.outline.length||b.outline.length!==prep.outline?.length)invalid('请保存当前完整大纲。');
    const choices=editorialChoicesSchema.parse({...b,revision:b.choice_revision+1,additions:[...new Set(b.additions)]});
    const candidate={...prep,editorial_choices:choices};
    const pitch=confirmedPitch(candidate,{version:b.version,choice_revision:choices.revision,article_ids:b.article_ids,selected_title:b.selected_title,output_type:prep.output_type==='auto'?'guide':prep.output_type,outline:b.outline,engineer:{mode:'conservative'}});
    if(prep.workflow_version===2){const {confirmedFragmentPlan}=await import('./studio-pitch-v2.ts');confirmedFragmentPlan(candidate,b,pitch);}
    await tx`UPDATE studio_recommendations SET document=jsonb_set(document,'{prep,editorial_choices}',${tx.json(choices as never)}),updated_by=${actor},updated_at=now() WHERE id=${id}`;
    await audit(actor,'studio.pitch.choices',`studio-recommendation:${id}`,'保存方向与选填要求；未生成正文',null,{choice_revision:choices.revision,additions:choices.additions},{db:tx});
    return {id,choice_revision:choices.revision,editorial_choices:choices};
  });
}
export async function confirmPitch(id:string,input:unknown,actor:string){
  const b=confirmSchema.parse(input);
  return sql.begin(async tx=>{
    const [card]=await tx<Card[]>`SELECT * FROM studio_recommendations WHERE id=${id} FOR UPDATE`;
    if(!card)return null;if(card.task_id)return {id,status:'confirmed',task_id:card.task_id,reused:true};
    if(!card.document.prep)invalid('此卡没有备料结果。');
    const pitch=confirmedPitch(card.document.prep,b);
    if(card.document.prep.workflow_version===2){const {confirmedFragmentPlan}=await import('./studio-pitch-v2.ts');pitch.fragments_plan=confirmedFragmentPlan(card.document.prep,b,pitch);}
    for(const material of card.document.prep.materials!.filter(m=>b.article_ids.includes(m.id))){
      const [current]=await tx`SELECT revision FROM articles WHERE id=${material.id} FOR SHARE`;
      if(!current||current.revision!==material.revision)throw new Conflict('素材版本已变化，请重新备料。');
    }
    const task=await createStudioTask({article_ids:b.article_ids,pitch,writing:{site:'chipshow.com',target_url:pitch.existing_url||'https://www.chipshow.com/blog/',page_type:pitch.output_type,reader_task:pitch.question},planning_context:{card_id:id,question_id:card.question_id,selection_origin:'operator',action:pitch.output_type==='update'?'update_page':pitch.output_type==='short'?'new_brief':'new_explainer',question:pitch.question,existing_url:pitch.existing_url,requires_first_party:false}},actor,tx);
    const prep={...card.document.prep,status:'confirmed',...(pitch.fragments_plan?{edit_plan:pitch.fragments_plan.edit_plan,outline:pitch.outline}:{}),metrics:{...card.document.prep.metrics,confirmation_elapsed_ms:Date.now()-Date.parse(card.document.prep.finished_at!)}};
    await tx`UPDATE studio_recommendations SET task_id=${task.id},status='adopted',document=${tx.json({...card.document,bound_article_ids:b.article_ids,prep} as never)},updated_at=now(),updated_by=${actor} WHERE id=${id}`;
    await audit(actor,'studio.pitch.confirm',`studio-recommendation:${id}`,null,null,{task_id:task.id,engineer_mode:pitch.engineer.mode,engineer_name:pitch.engineer.name},{db:tx});
    return {id,status:'confirmed',task_id:task.id};
  });
}
export async function queuePitchDraft(id:string,actor:string){
  const [card]=await sql<Card[]>`SELECT * FROM studio_recommendations WHERE id=${id}`;
  if(!card)return null;
  if(!card.task_id||card.document.prep?.status!=='confirmed')invalid('请先确认备料。');
  const queued=await enqueue(QUEUES.studioPrep,{cardId:id,version:card.document.prep.version,actor,phase:'draft'},{singletonKey:`draft:${card.task_id}`,retryLimit:0});
  return {id,task_id:card.task_id,queued:!!queued};
}
export async function runPitchJob(data:{cardId:string;version:number;actor:string;phase:'prepare'|'draft';fragmentIndex?:number;attemptTag?:string}){
  if(data.phase==='prepare')return preparePitch(data.cardId,data.version,data.actor);
  const [card]=await sql<Card[]>`SELECT * FROM studio_recommendations WHERE id=${data.cardId}`;
  if(card?.task_id&&card.document.prep?.version===data.version){
    if(card.document.prep.workflow_version===2){const {generatePitchFragments}=await import('./studio-pitch-v2.ts');return generatePitchFragments(data.cardId,data.actor,{fragmentIndex:data.fragmentIndex,attemptTag:data.attemptTag});}
    return generateStudioTask(card.task_id,data.actor);
  }
  return {reused:true};
}
