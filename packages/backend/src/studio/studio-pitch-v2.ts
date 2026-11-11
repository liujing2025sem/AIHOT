import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {sql} from '../db.ts';
import {audit,Conflict} from '../audit.ts';
import {enqueue,QUEUES} from '../jobs/queue.ts';
import {sha256} from '../lib/ids.ts';
import {normalizeUrl} from '../lib/url.ts';
import {chatJson,type ChatJsonOptions} from '../providers/llm.ts';
import {failureKind,failedReceiptId,ReceiptUnknownError} from '../providers/receipts.ts';
import {searchPitchMaterials} from './studio-pitch-evidence.ts';
import {importLink,type Prep} from './studio-pitch.ts';
import {studioMaterial,studioGenerationStatus,studioTask,receiveStudioTask} from './studio.ts';
import {companyFactRules} from './studio-company-facts.ts';
import {discoverPitchEvidence} from './studio-pitch-research.ts';
import {buyerQuestionsSchema,editPlanSchema,pageUpdatePlanSchema,fragmentPlanSchema,fragmentSchema,editorialAdditions,type Pitch} from '../../../../scripts/editorial-pitch-lib.ts';
import {packetSchema} from '../../../../scripts/editorial-pilot-lib.ts';
import {writingPolicyBundle} from './writing-policy-bundle.ts';
import {splitPage,answerEvidence,evidenceFactQuote,pixelInputEvidence,calculateFact,validateEditPlan,validateFragment,assembleFragments,revisionCharacterLimit,type Fact,type Paragraph,type EditOperation} from './studio-pitch-fragments.ts';

function invalid(s:string):never{throw Object.assign(new Error(s),{statusCode:400});}
const prompt=(name:string)=>readFileSync(new URL(`../../../../industry/prompts/${name}.md`,import.meta.url),'utf8');
type Question=z.infer<typeof buyerQuestionsSchema>['subquestions'][number];
type Coverage={status:'page_good'|'page_weak'|'direct'|'calc'|'engineer'|'missing';page_paragraphs:string[];evidence:string[];reason?:string;action?:string};
type Fragment={op_index:number;status:'pending'|'running'|'done'|'unknown'|'failed';html_en?:string;zh_review?:string;used_facts?:string[];figure?:z.infer<typeof fragmentSchema>['figure'];receipt_id?:number|null;error?:string;elapsed_ms?:number};
type V2=Prep & {workflow_version:2;reuse_questions?:boolean;research_question_id?:string;subquestions?:Array<Question&{coverage:Coverage;demand:{queries:Record<string,unknown>[];inquiries:number}}>;paragraphs?:Paragraph[];source_html?:string;original_title?:string;facts?:Fact[];edit_plan?:EditOperation[];weak_material_ids?:string[];conclusion?:string;fragments?:Fragment[];assembled?:Record<string,unknown>};
const cardFor=async(id:string)=>{const [row]=await sql`SELECT * FROM studio_recommendations WHERE id=${id}`;return row;};
const savePrep=async(id:string,prep:V2)=>sql`UPDATE studio_recommendations SET document=jsonb_set(document,'{prep}',${sql.json(prep as never)}),updated_at=now() WHERE id=${id} AND (document->'prep'->>'version')::int=${prep.version}`;

/** A saved answer is always replayed; a missing answer is never silently repurchased. */
async function call<S extends z.ZodType>(options:ChatJsonOptions<S>,replay=false){
  const tag=options.attemptTag??'';
  const [old]=await sql`SELECT * FROM receipts WHERE subject=${options.subject} AND purpose=${options.purpose}
    AND (${!tag} OR right(logical_key,length(${tag})+1)=${`:${tag}`}) ORDER BY id DESC LIMIT 1`;
  if(old){
    if(!old.response){if(old.status==='unknown')throw new ReceiptUnknownError(Number(old.id),'已有调用结果待核对，未重复调用');invalid(`调用 ${old.id} 没有可重放结果，未重复调用。`);}
    const content=old.response.choices?.[0]?.message?.content??'';
    return {data:options.schema.parse(JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g,''))),receiptId:Number(old.id),usage:old.usage,model:old.model,reused:true};
  }
  if(replay)invalid('没有已保存的回答，免调用重放已停止。');
  const enabled=await studioGenerationStatus();if(!enabled.ready)invalid(enabled.reason);
  return chatJson(options);
}
const quoted=(text:string,body:string)=>body.includes(text);
const canonical=(value:string)=>normalizeUrl(value)?.replace(/^http:/,'https:').replace('://www.','://').replace(/\/$/,'');
function shortQuote(text:string,body:string){
  const exact=text.trim();
  if(exact.length<=300&&body.includes(exact))return exact;
  for(const sentence of exact.split(/(?<=[.!?。！？])\s+|\n+/)){const s=sentence.trim().slice(0,300);if(s&&body.includes(s))return s;}
  return '';
}
function answerQuote(hit:{quote:string},body:string){
  const whole=evidenceFactQuote(hit);if(!whole)return '';
  if(body.includes(whole))return whole;
  const flat=whole.replace(/\s+/g,' ').trim();
  return body.includes(flat)?flat:'';
}
async function demandFor(questions:Question[],url:string){
  const signals=await sql`SELECT record FROM studio_search_signals`;
  const inquiries=await sql`SELECT record FROM studio_demand_signals`;
  return Object.fromEntries(questions.map(q=>[q.id,{queries:signals.filter(r=>canonical(r.record.page)===canonical(url)&&q.terms.some(t=>String(r.record.query).toLowerCase().includes(t.toLowerCase()))).map(r=>r.record),inquiries:inquiries.filter(r=>q.terms.some(t=>String(r.record.question_rewrite).toLowerCase().includes(t.toLowerCase()))).length}]));
}

export async function preparePitchV2(id:string,version:number,actor:string,mode:boolean|{retryEditPlanReceiptId:number}=false,research:typeof discoverPitchEvidence=discoverPitchEvidence){
  const replay=mode===true,retry=typeof mode==='object'?mode:null,reuseInputs=replay||!!retry;
  const card=await cardFor(id);let prep=card?.document.prep as V2;
  if(!prep||prep.version!==version||prep.status!=='preparing'&&!reuseInputs||retry&&prep.status==='ready')return {reused:true};
  if(retry){
    const [previous]=await sql`SELECT id,status FROM receipts WHERE id=${retry.retryEditPlanReceiptId}
      AND subject=${`studio-pitch:${id}:${version}`} AND purpose='studio_prep_edit_plan'`;
    if(!previous||previous.status!=='unknown'||prep.pending_receipt_id!==Number(previous.id))invalid('请核对待确认的编辑计划回执，本次未发送请求。');
    await audit(actor,'studio.pitch.edit-plan-retry',`studio-recommendation:${id}`,'用户授权复用现有拆题，只补调一次编辑计划',null,{previous_receipt:previous.id,attempt_tag:`edit-plan-after-${previous.id}`});
  }
  const start=performance.now(),receipts:NonNullable<Prep['metrics']>['receipts']=[];
  const complete=async(status:Prep['status'],error?:string)=>{prep={...prep,status,error,finished_at:new Date().toISOString(),metrics:{preparation_ms:replay?(prep.metrics?.preparation_ms??null):Math.round(performance.now()-start),receipts,...(replay?{replayed:true}: {})}};await savePrep(id,prep);};
  try{
    const linked:NonNullable<Prep['materials']>=[];const link_errors=[];
    for(const url of [...new Set([prep.existing_url,...prep.links].filter(Boolean))]){
      if(reuseInputs){
        const saved=prep.materials?.find(m=>canonical(m.url)===canonical(url));
        if(saved)linked.push({...saved,existing_page:canonical(url)===canonical(prep.existing_url)});
        else link_errors.push({url,reason:'未保存该链接的素材，本次免费重放未重新抓取。'});
        continue;
      }
      try{const mid=await importLink(url,actor);const m=await studioMaterial(mid) as NonNullable<Prep['materials']>[number];linked.push({...m,first_party:false,hit_count:0,snippet:m.body_text?.slice(0,300)||'',existing_page:canonical(m.url)===canonical(prep.existing_url)});}
      catch(e){link_errors.push({url,reason:String(e).slice(0,250)});}
    }
    const page=linked.find(m=>m.existing_page);
    const [htmlRow]=page?await sql`SELECT body_html FROM articles WHERE id=${page.id}`:[];
    const sourceHtml=reuseInputs?(prep.source_html??''):htmlRow?.body_html??'';
    if(prep.existing_url&&!sourceHtml)invalid('旧页正文 HTML 未取得，无法逐段保留；请补正文。');
    const paragraphs=splitPage(sourceHtml);
    prep={...prep,paragraphs,source_html:sourceHtml,original_title:page?.title??'',link_errors};
    const system=prompt('studio-pitch-subquestions');
    let decomposition:{question_en:string;subquestions:Question[]};
    if(prep.reuse_questions&&prep.subquestions?.length){
      decomposition={question_en:prep.question_en??prep.question,subquestions:prep.subquestions};
    }else{
      const first=await call({model:'default',purpose:'studio_prep_subquestions',subject:`studio-pitch:${id}:${version}`,promptVersion:sha256(system),system,user:JSON.stringify({question:prep.question,existing_page:page?{title:page.title,paragraphs:paragraphs.map(p=>({id:p.id,text:p.text.slice(0,110)}))}:null}),schema:buyerQuestionsSchema,maxTokens:2400,timeoutMs:45000,sessionId:id},reuseInputs);
      receipts.push({id:first.receiptId,usage:first.usage,model:first.model});decomposition=first.data;
    }
    const questions=decomposition.subquestions;
    if(new Set(questions.map(q=>q.id)).size!==questions.length)invalid('子问题编号重复，需检查保存的回答。');
    const candidates=reuseInputs?(prep.materials??[]):await searchPitchMaterials([...new Set(questions.flatMap(q=>q.terms))],50);
    const materials:NonNullable<Prep['materials']>=[...linked,...candidates.filter(m=>!linked.some(l=>l.id===m.id))];
    let htmls=await sql`SELECT id,body_html,revision FROM articles WHERE id=ANY(${materials.map(m=>m.id)})`;
    let evidence=answerEvidence(questions,materials.map(m=>({...m,body_html:m.existing_page?sourceHtml:
      htmls.find(h=>h.id===m.id&&h.revision===m.revision)?.body_html})));
    const missing=questions.filter(q=>prep.research_question_id?q.id===prep.research_question_id:!(evidence.by_question[q.id]?.length));
    if(!reuseInputs&&missing.length){
      const acquired=await research(missing,url=>importLink(url,actor,true,true));prep.research=acquired.report;
      for(const mid of acquired.article_ids){
        if(materials.some(m=>m.id===mid))continue;
        const m=await studioMaterial(mid) as NonNullable<Prep['materials']>[number];
        if(m?.body_text)materials.push({...m,first_party:false,hit_count:0,snippet:m.body_text.slice(0,300)});
      }
      htmls=await sql`SELECT id,body_html,revision FROM articles WHERE id=ANY(${materials.map(m=>m.id)})`;
      evidence=answerEvidence(questions,materials.map(m=>({...m,body_html:m.existing_page?sourceHtml:htmls.find(h=>h.id===m.id&&h.revision===m.revision)?.body_html})));
    }
    const facts:Fact[]=[];
    const addFact=(value:Omit<Fact,'id'>)=>{const f={...value,id:`f${facts.length+1}`} as Fact;facts.push(f);return f;};
    const demand=await demandFor(questions,prep.existing_url);
    const subquestions:NonNullable<V2['subquestions']>=questions.map(q=>{
      const matched=evidence.by_question[q.id]??[];
      const ids=matched.flatMap(e=>{
        const m=materials.find(m=>m.id===e.article_id)!;const quote=answerQuote(e,m?.body_text??'');if(!quote)return [];
        return [addFact({kind:m.existing_page?'page':'source',statement:quote,quote,article_id:m.id,revision:m.revision,date:m.publication_time??null,attribution:m.existing_page?'Chipshow page':m.source_name,url:m.url}).id];
      });
      let status:Coverage['status']=ids.length?'direct':q.need==='company'?'engineer':'missing';
      if(q.need==='calc'&&q.calculation){
        const basis=q.calculation.basis;
        const inputQuotes=q.calculation.fn==='pixels'&&page
          ?pixelInputEvidence(q.calculation.inputs,{id:page.id,body_text:page.body_text,body_html:sourceHtml}):[];
        if(inputQuotes.length||quoted(basis,`${prep.question}\n${page?.body_text??''}`)){
          for(const quote of inputQuotes)ids.push(addFact({kind:'page',statement:quote,quote,article_id:page!.id,
            revision:page!.revision,date:page!.publication_time??null,attribution:'Chipshow page',url:page!.url}).id);
          const computed=calculateFact(q.calculation.fn,q.calculation.inputs);
          const f=addFact({...computed.fact,kind:'calc',quote:''});ids.push(f.id);status='calc';
        }
      }
      return {...q,coverage:{status,page_paragraphs:[],evidence:ids,action:ids.length?'':page&&q.need!=='company'
        ?'未自动命中答案；待编辑计划核对旧页是否已答，暂不认定为内容缺口。'
        :`需要${q.need==='company'?'工程确认':q.need==='calc'?'可核对的计算输入':'参考资料'}：${q.zh}`},demand:demand[q.id]};
    });
    // A short exact quote from the existing page anchors titles without sending the whole page.
    if(page&&!facts.some(f=>f.article_id===page.id)){const quote=shortQuote(paragraphs[0]?.text??'',page.body_text??'');if(quote)addFact({kind:'page',statement:quote,quote,article_id:page.id,revision:page.revision,date:page.publication_time??null,attribution:'Chipshow page',url:page.url});}
    const rules=companyFactRules();
    const unresolved=subquestions.filter(q=>q.coverage.status==='missing');
    const supported=subquestions.filter(q=>['direct','calc'].includes(q.coverage.status)&&q.coverage.evidence.some(fid=>facts.find(f=>f.id===fid)?.article_id));
    const scope_options=!page&&unresolved.length?supported.map(q=>({id:`scope-${q.id}`,question:q.zh,includes:[q.zh],omits:subquestions.filter(other=>other.id!==q.id).map(other=>other.zh),subquestion_ids:[q.id]})):[];
    prep={...prep,question_en:decomposition.question_en,keywords:[...new Set(questions.flatMap(q=>q.terms))],entities:[],materials,related_pages:[],subquestions,facts,scope_options,weak_material_ids:evidence.weak_material_ids,blacklist:{configured:rules.configured,blocked:0,pending:0}};
    await savePrep(id,prep);
    if(!page&&(!facts.some(f=>f.kind!=='calc')||unresolved.length)){
      await complete('insufficient',scope_options.length?'已找到可回答的买家问题，请选择保留的范围；未核实的部分不会写入正文。':'自动检索暂未取得足够原文。可以继续自动查找，或保存这个命题稍后处理。');
      return {status:'insufficient'};
    }
    const oldPage=(prep.output_type==='auto'||prep.output_type==='update')?page:undefined;
    const system2=prompt(oldPage?'studio-pitch-update-plan':'studio-pitch-edit-plan');
    const excerptLength=Math.max(90,Math.min(240,Math.floor(10500/Math.max(1,paragraphs.length))));
    const company_rules=rules.rules.map(r=>({id:r.id,match:r.match,action:r.action,conservative:r.conservative}));
    const user=JSON.stringify(oldPage?{
      subquestions:subquestions.map(q=>({id:q.id,en:q.en,need:q.need,coverage:q.coverage.status,evidence:q.coverage.evidence,
        demand:{queries:q.demand.queries.slice(0,3).map(r=>({query:r.query,impressions:r.impressions,position:r.position})),inquiries:q.demand.inquiries}})),
      facts:facts.map(f=>({id:f.id,kind:f.kind,statement:f.statement,attribution:f.attribution})),
      paragraphs:paragraphs.map(p=>[p.id,p.text.replace(/\s+/g,' ').slice(0,Math.min(excerptLength,100))]),company_rules,
    }:{question:prep.question,output_type:prep.output_type,subquestions,facts,paragraphs:paragraphs.map(p=>({id:p.id,text:p.text.slice(0,excerptLength)})),company_rules});
    const remainingMs=90000-Math.round(performance.now()-start);
    if(!replay&&remainingMs<1000)invalid('本轮备料已用完90秒，已保存拆题与检索结果，未发送第二段。');
    const options={model:'default',purpose:'studio_prep_edit_plan',subject:`studio-pitch:${id}:${version}`,promptVersion:sha256(system2),system:system2,user,maxTokens:3500,timeoutMs:replay?90000:remainingMs,sessionId:id,...(retry?{attemptTag:`edit-plan-after-${retry.retryEditPlanReceiptId}`}:{})};
    const result=oldPage
      ?await call({...options,schema:pageUpdatePlanSchema,maxTokens:1800,maxTotalTokens:4096},replay).then(r=>({
        ...r,data:{...r.data,titles:[{title:oldPage.title.slice(0,60),anchor:'沿用旧页标题',article_id:oldPage.id,quote:oldPage.title.slice(0,60)}],hooks:[]},
      }))
      :await call({...options,schema:editPlanSchema},replay);
    receipts.push({id:result.receiptId,usage:result.usage,model:result.model});
    const plan=result.data;
    if(Number(result.usage?.prompt_tokens)>6000)invalid('第二段备料输入超过6000 token；已保存回答，停止新增调用。');
    const editPlan:EditOperation[]=paragraphs.map(p=>plan.edits.find(e=>e.op==='revise'&&e.paragraph===p.id)??{op:'keep',paragraph:p.id,facts:[]});
    editPlan.push(...plan.edits.filter(e=>e.op==='insert_after'));
    const errors=validateEditPlan(paragraphs,editPlan,questions,facts);if(errors.length)invalid(errors.join('；'));
    const {titles,hooks}=plan;
    for(const t of [...titles,...hooks])if(!materials.some(m=>m.id===t.article_id&&(m.body_text?.includes(t.quote)||m.title.includes(t.quote))))invalid('标题/钩子的逐字出处未匹配。');
    for(const q of plan.engineer_questions)if(!q.options[0]?.conservative||q.options[0].id!=='A'||/\d/.test(q.options[0].label+q.options[0].instruction))invalid('工程题A须为无数字的保守写法。');
    for(const q of subquestions){
      const c=plan.coverage.find(c=>c.id===q.id);if(!c)invalid(`缺少子问题 ${q.id} 的覆盖判断。`);
      if(c.page_paragraphs.some(pid=>!paragraphs.some(p=>p.id===pid)))invalid('旧页覆盖引用了不存在的段落。');
      if(['page_good','page_weak'].includes(c.status)&&!c.page_paragraphs.length)invalid('旧页覆盖必须指出实际段落。');
      if(c.status==='direct'&&!q.coverage.evidence.length||c.status==='calc'&&!q.coverage.evidence.some(fid=>facts.find(f=>f.id===fid)?.kind==='calc'))invalid('覆盖状态没有对应证据。');
      q.coverage={...q.coverage,...c};
    }
    const changes=editPlan.filter(e=>e.op!=='keep');
    if(plan.conclusion==='no_change'&&changes.length)invalid('无需升级与改动计划冲突。');
    const outline=changes.map((e,i)=>({id:`change-${i}`,heading:e.heading??subquestions.find(q=>q.id===e.subquestion)?.zh??e.reason!,evidence:(e.facts??[]).flatMap(id=>{const f=facts.find(f=>f.id===id)!;return f.article_id&&f.quote?[{article_id:f.article_id,quote:f.quote}]:[]}),gap:'',action:e.reason??''}));
    const engineer=plan.engineer_questions.map(q=>({...q,section_ids:q.section_ids.flatMap(id=>changes.map((e,i)=>e.subquestion===id?`change-${i}`:'').filter(Boolean))}));
    prep={...prep,subquestions,edit_plan:editPlan,conclusion:changes.length?'upgrade':'no_change',outline,titles,hooks,engineer_questions:engineer,output_type:prep.output_type==='auto'?(page?'update':'guide'):prep.output_type};
    delete prep.model_outcome;delete prep.pending_receipt_id;
    await complete('ready');return {status:'ready',subquestions:subquestions.length,changes:changes.length};
  }catch(error){
    const receiptId=failedReceiptId(error);
    if(failureKind(error)==='unknown')prep={...prep,model_outcome:'unknown',pending_receipt_id:receiptId};
    await complete('failed',failureKind(error)==='unknown'?`调用 ${receiptId} 结果待核对，可能已计费；未重复调用。已保存拆题与检索结果。`:String(error instanceof Error?error.message:error).slice(0,500));throw error;
  }
}

export function confirmedFragmentPlan(raw:Prep,input:{article_ids:string[];outline:{id:string;include:boolean}[]},pitch:Pitch){
  const prep=raw as V2;
  if(prep.conclusion==='no_change')invalid('旧页无需升级；请保留原页，不重复出稿。');
  let index=0;
  const plan=prep.edit_plan!.flatMap(e=>{if(e.op==='keep')return [e];const sectionId=`change-${index++}`;const included=input.outline.find(s=>s.id===sectionId)?.include;return included?[e]:e.op==='revise'?[{op:'keep' as const,paragraph:e.paragraph,facts:[]}]:[];});
  if(!plan.some(e=>e.op!=='keep'))invalid('没有保留任何改动，不需要成稿。');
  if(plan.some(e=>e.op!=='keep'&&!e.facts?.length))invalid('所选小节尚无可引用事实，请选择已有证据的小节或继续自动查找。');
  const facts=prep.facts!.filter(f=>!f.article_id||input.article_ids.includes(f.article_id));
  const errors=validateEditPlan(prep.paragraphs!,plan,prep.subquestions!,facts);if(errors.length)invalid(errors.join('；'));
  return fragmentPlanSchema.parse({paragraphs:prep.paragraphs,subquestions:prep.subquestions,facts,edit_plan:plan,source_html:prep.source_html,original_title:prep.original_title,method_rule_ids:[]});
}

/** Upgrade a saved v1 attempt explicitly; retain its task and unknown receipt intact. */
export async function upgradePitch(id:string,input:unknown,actor:string){
  const b=z.object({version:z.number().int()}).strict().parse(input);
  return sql.begin(async tx=>{
    const [card]=await tx`SELECT * FROM studio_recommendations WHERE id=${id} FOR UPDATE`;
    if(!card)return null;const old=card.document.prep as V2;
    if(old.version!==b.version)throw new Conflict('命题已变化，请刷新。');
    if(old.workflow_version===2)invalid('已经是片段采编，请使用现有任务。');
    const prep:V2={workflow_version:2,version:old.version+1,status:'preparing',question:old.question,output_type:old.output_type,existing_url:old.existing_url,links:old.links,started_at:new Date().toISOString()};
    await tx`UPDATE studio_recommendations SET task_id=NULL,status='pending',document=${tx.json({...card.document,previous_attempts:[...(card.document.previous_attempts??[]),{task_id:card.task_id,prep:old}],prep} as never)},updated_by=${actor},updated_at=now() WHERE id=${id}`;
    await enqueue(QUEUES.studioPrep,{cardId:id,version:prep.version,actor,phase:'prepare'},{singletonKey:`${id}:${prep.version}`,retryLimit:0},tx);
    await audit(actor,'studio.pitch.fragment-upgrade',`studio-recommendation:${id}`,'按用户批准的PRDv2新建片段流程，原未知调用保留，不重试',null,{version:prep.version,previous_task_id:card.task_id},{db:tx});
    return {id,version:prep.version,status:'preparing'};
  });
}

export async function supplementPitchEvidence(id:string,input:unknown,actor:string){
  const b=z.object({version:z.number().int(),subquestion_id:z.string().optional(),url:z.union([z.url(),z.literal('')]).optional()}).strict().parse(input);
  return continuePreparation(id,b.version,actor,old=>{
    if(b.subquestion_id&&!old.subquestions?.some(q=>q.id===b.subquestion_id))invalid('子问题不存在。');
    if(b.url){const u=new URL(b.url);if(!normalizeUrl(b.url)||u.username||u.password)invalid('补充链接必须是公开网页地址。');}
    return {...old,links:b.url?[...new Set([...old.links,b.url])].slice(-3):old.links,research_question_id:b.subquestion_id};
  },'studio.pitch.research');
}

export async function choosePitchScope(id:string,input:unknown,actor:string){
  const b=z.object({version:z.number().int(),scope_id:z.string()}).strict().parse(input);
  return continuePreparation(id,b.version,actor,old=>{
    const choice=old.scope_options?.find(option=>option.id===b.scope_id);if(!choice)throw new Conflict('范围建议已经变化，请刷新后选择。');
    const questions=old.subquestions?.filter(q=>choice.subquestion_ids.includes(q.id))??[];
    if(!questions.length)invalid('所选范围没有可回答的买家问题。');
    return {...old,question:choice.question,question_en:questions.map(q=>q.en).join(' '),subquestions:questions,research_question_id:undefined,
      scope:{original_question:old.scope?.original_question??old.question,question:choice.question,omitted_questions:[...new Set([...(old.scope?.omitted_questions??[]),...choice.omits])]},scope_options:[]};
  },'studio.pitch.scope');
}

async function continuePreparation(id:string,version:number,actor:string,change:(old:V2)=>V2,action:string){
  const {ensureQueue}=await import('../jobs/queue.ts');await ensureQueue(QUEUES.studioPrep);
  return sql.begin(async tx=>{
    const [card]=await tx`SELECT * FROM studio_recommendations WHERE id=${id} FOR UPDATE`;
    if(!card)return null;
    const old=card.document.prep as V2;
    if(!old||old.version!==version||card.task_id||!['ready','insufficient','failed'].includes(old.status))throw new Conflict('备料状态已变化，请刷新后继续。');
    if(old.model_outcome==='unknown')invalid('已有模型调用结果待核对，未重复发送。');
    const prep:V2={...change(old),version:old.version+1,status:'preparing',started_at:new Date().toISOString(),reuse_questions:!!old.subquestions?.length};
    delete prep.editorial_choices;delete prep.edit_plan;delete prep.outline;delete prep.titles;delete prep.hooks;delete prep.error;delete prep.finished_at;
    await tx`UPDATE studio_recommendations SET document=jsonb_set(document,'{prep}',${tx.json(prep as never)}),updated_by=${actor},updated_at=now() WHERE id=${id}`;
    const queued=await enqueue(QUEUES.studioPrep,{cardId:id,version:prep.version,actor,phase:'prepare'},{singletonKey:`${id}:${prep.version}`,retryLimit:0},tx);
    await audit(actor,action,`studio-recommendation:${id}`,'已保存选择并排队备料；原始命题和未回答问题保留',null,{version:prep.version,scope:prep.scope},{db:tx});
    return {id,status:prep.status,version:prep.version,queued:!!queued,model_calls:0};
  });
}

export async function queueFragmentRetry(id:string,index:number,input:unknown,actor:string){
  const b=z.object({version:z.number().int(),confirm_unknown:z.literal(true)}).strict().parse(input);
  const card=await cardFor(id);if(!card)return null;const prep=card.document.prep as V2;
  if(prep.version!==b.version)throw new Conflict('版本已变化。');
  const f=prep.fragments?.find(f=>f.op_index===index);if(!f||!['unknown','failed'].includes(f.status))invalid('仅失败或结果未知片段可人工重试。');
  const tag=`manual-${randomUUID()}`;
  await audit(actor,'studio.pitch.fragment-retry',`studio-recommendation:${id}`,'用户确认可能重复计费，只重试此片段',null,{op_index:index,previous_receipt:f.receipt_id,attempt_tag:tag});
  const queued=await enqueue(QUEUES.studioPrep,{cardId:id,version:b.version,actor,phase:'draft',fragmentIndex:index,attemptTag:tag},{singletonKey:`fragment:${card.task_id}:${index}`,retryLimit:0});
  return {queued:!!queued};
}

export async function generatePitchFragments(id:string,actor:string,options:{fragmentIndex?:number;attemptTag?:string;replay?:boolean}={},modelCall:typeof call=call){
  const card=await cardFor(id);if(!card?.task_id)return null;
  const task=await studioTask(card.task_id),packet=packetSchema.parse(task?.request),plan=packet.pitch?.fragments_plan;
  if(!plan)invalid('请先按片段流程重新备料。');
  if(task!.state==='received')return {reused:true};
  const prep=card.document.prep as V2,start=performance.now();
  const items=plan.edit_plan.flatMap((op,i)=>op.op==='keep'?[]:[i]);
  const fragments:Fragment[]=prep.fragments??items.map(op_index=>({op_index,status:'pending'}));prep.fragments=fragments;
  const persist=()=>savePrep(id,prep);
  const system=prompt('studio-pitch-fragment')+'\n\n'+writingPolicyBundle(packet,'fragment').text;
  const methodId=packet.methods?.ruleIds.find(id=>id==='chipshow-three-site-writing')??packet.methods?.ruleIds[0];
  const methodSection=methodId?packet.methods!.text.split(/\n(?=## CAMOS )/).find(s=>s.split('\n')[0].includes(methodId)):undefined;
  const methodExcerpt=methodSection?.slice(0,700)??'';
  if(packet.methods?.status==='connected'&&!methodExcerpt)invalid('CAMOS采用条目没有可读取的方法片段。');
  plan.method_rule_ids=methodExcerpt?[methodId!]:[];
  await persist();
  const run=async(index:number)=>{
    const fragment=fragments.find(f=>f.op_index===index)!;
    if(fragment.status==='done'||!options.attemptTag&&['unknown','failed','running'].includes(fragment.status)&&!options.replay)return;
    const op=plan.edit_plan[index],pidx=plan.paragraphs.findIndex(p=>p.id===op.paragraph),target=plan.paragraphs[pidx];
    const facts=plan.facts.filter(f=>op.facts.includes(f.id));
    const question=plan.subquestions.find(q=>q.id===op.subquestion);
    const before=plan.paragraphs[pidx-1]?.text.slice(0,600)??'',after=plan.paragraphs[pidx+1]?.text.slice(0,600)??'';
    const revision=op.op==='revise'&&target?{
      target:target.text.slice(0,600), target_tag:target.html.match(/^\s*<([a-z][a-z0-9]*)\b/i)?.[1]?.toLowerCase(),
      max_visible_chars_per_language:revisionCharacterLimit(target),
    }:{};
    const user=JSON.stringify({operation:op.op,heading:op.op==='insert_after'?op.heading:undefined,
      editorial_reason:op.reason,question:question?.en,...revision,context:{before,after},facts,
      engineer:packet.pitch!.engineer,withheld_numbers:packet.pitch!.withheld_numbers,
      editorial_choices:packet.pitch!.editorial_choices?{additions:packet.pitch!.editorial_choices.additions.map(id=>editorialAdditions[id]),note:packet.pitch!.editorial_choices.note,instruction:'这些是结构与表达要求，不是事实证据。只使用本次提供的facts；无法支持的比较项和数值不写。'}:undefined,
      approved_scope:packet.pitch!.scope,
      method:methodExcerpt?{id:methodId,text:methodExcerpt}:null,
      output_format:{html_en:'HTML fragment only',zh_review:'仅本片段中文审校',used_facts:op.facts}});
    const saveFragment=()=>sql`UPDATE studio_recommendations SET document=jsonb_set(document,${['prep','fragments',String(fragments.indexOf(fragment))]}::text[],${sql.json(fragment as never)}),updated_at=now() WHERE id=${id} AND (document->'prep'->>'version')::int=${prep.version}`;
    const began=performance.now();fragment.status='running';delete fragment.error;await saveFragment();
    try{
      const answer=await modelCall({model:'default',purpose:'studio_fragment',subject:`studio-fragment:${task!.id}:${index}`,promptVersion:sha256(system),system,user,schema:fragmentSchema,maxTokens:2400,timeoutMs:90000,sessionId:task!.id,attemptTag:options.attemptTag},options.replay);
      Object.assign(fragment,answer.data,{receipt_id:answer.receiptId,elapsed_ms:Math.round(performance.now()-began)});
      const errors=validateFragment(op,answer.data,facts,plan.paragraphs);
      if(Number(answer.usage?.prompt_tokens)>4000)errors.push('片段输入超过4000 token');
      if(errors.length)invalid(errors.join('；'));
      fragment.status='done';
    }catch(error){fragment.status=failureKind(error)==='unknown'?'unknown':'failed';fragment.receipt_id??=failedReceiptId(error);fragment.elapsed_ms=Math.round(performance.now()-began);fragment.error=String(error instanceof Error?error.message:error).slice(0,500);}
    await saveFragment();
  };
  const pending=options.fragmentIndex===undefined?items:[options.fragmentIndex];
  for(let i=0;i<pending.length;i+=2)await Promise.all(pending.slice(i,i+2).map(run));
  if(fragments.some(f=>f.status!=='done'))return {status:fragments.some(f=>f.status==='unknown')?'unknown':'partial',fragments};
  const done=fragments.map(f=>({op_index:f.op_index,html_en:f.html_en!,zh_review:f.zh_review!,used_facts:f.used_facts!,...(f.figure?{figure:f.figure}:{})}));
  const assembled=assembleFragments(plan.paragraphs,plan.edit_plan,done);
  // Bind the checked fragment results to this task before the normal response gate and database write.
  plan.fragments=done;
  await sql`UPDATE studio_tasks SET request=${sql.json(packet as never)} WHERE id=${task!.id} AND state='waiting'`;
  const primary=packet.articles.find(a=>a.binding.article_id===packet.pitch!.primary_article_id)!;
  const cited=plan.facts.filter(f=>done.some(d=>d.used_facts.includes(f.id))&&f.article_id&&f.quote);
  if(!cited.length){const quote=shortQuote(primary.body_text??'',primary.body_text??'');if(quote)cited.push({id:'page-context',kind:'page',statement:'Existing page retained.',quote,attribution:'Chipshow page',article_id:primary.binding.article_id});}
  const body=assembled.html_en;
  const response={task_id:task!.id,run_id:`fragments-${task!.id}`,producer:{agent_id:'studio-fragment-worker',model:'default',input_files:['confirmed fragment plan','bounded fact table','studio-pitch-fragment.md']},decisions:packet.articles.map(a=>({article_id:a.binding.article_id,decision:'KEEP',reason_zh:a.binding.article_id===primary.binding.article_id?'按已确认的编辑计划保留旧页并补足买家问题':'为改动片段提供已核对的逐字证据'})),drafts:[{news_status:'reported',source:primary.binding,title_zh:`[UPDATE] ${packet.pitch!.question}`,title_en:`[UPDATE] ${packet.pitch!.selected_title}`,body_en:body,review_zh:done.map(d=>d.zh_review).join('\n\n'),evidence:cited.map(f=>({claim:f.statement,quote:f.quote})),questions_zh:prep.engineer_questions?.map(q=>q.question)??[],keyword_hypothesis:prep.question_en??prep.question,meta_description_en:packet.pitch!.selected_title,camos_rule_ids:plan.method_rule_ids,figures:done.flatMap(f=>f.figure?[{...f.figure,fact_ids:f.figure.fact_ids??f.used_facts}]:[]).slice(0,3)}]};
  const received=await receiveStudioTask(task!.id,response,actor);
  const [draft]=await sql`SELECT id FROM studio_drafts WHERE task_id=${task!.id} ORDER BY created_at DESC LIMIT 1`;
  prep.assembled={html_en:assembled.html_en,diff:assembled.diff,zh_review:response.drafts[0].review_zh,draft_id:draft?.id??null,gate:received?.gate??{blocked:false},elapsed_ms:Math.round(performance.now()-start)};
  await persist();await audit(actor,'studio.pitch.fragments',`studio-task:${task!.id}`,null,null,{fragments:fragments.length,receipt_ids:fragments.map(f=>f.receipt_id),result:received});
  return {...received,fragment_count:fragments.length,draft_id:draft?.id??null};
}
