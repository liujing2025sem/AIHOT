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
import {buyerQuestionsSchema,editPlanSchema,fragmentPlanSchema,fragmentSchema,type Pitch} from '../../../../scripts/editorial-pitch-lib.ts';
import {packetSchema} from '../../../../scripts/editorial-pilot-lib.ts';
import {splitPage,answerEvidence,calculateFact,validateEditPlan,validateFragment,assembleFragments,type Fact,type Paragraph,type EditOperation} from './studio-pitch-fragments.ts';

function invalid(s:string):never{throw Object.assign(new Error(s),{statusCode:400});}
const prompt=(name:string)=>readFileSync(new URL(`../../../../industry/prompts/${name}.md`,import.meta.url),'utf8');
type Question=z.infer<typeof buyerQuestionsSchema>['subquestions'][number];
type Coverage={status:'page_good'|'page_weak'|'direct'|'calc'|'engineer'|'missing';page_paragraphs:string[];evidence:string[];reason?:string;action?:string};
type Fragment={op_index:number;status:'pending'|'running'|'done'|'unknown'|'failed';html_en?:string;zh_review?:string;used_facts?:string[];receipt_id?:number|null;error?:string;elapsed_ms?:number};
type V2=Prep & {workflow_version:2;subquestions?:Array<Question&{coverage:Coverage;demand:{queries:Record<string,unknown>[];inquiries:number}}>;paragraphs?:Paragraph[];source_html?:string;original_title?:string;facts?:Fact[];edit_plan?:EditOperation[];weak_material_ids?:string[];conclusion?:string;fragments?:Fragment[];assembled?:Record<string,unknown>};
const cardFor=async(id:string)=>{const [row]=await sql`SELECT * FROM studio_recommendations WHERE id=${id}`;return row;};
const savePrep=async(id:string,prep:V2)=>sql`UPDATE studio_recommendations SET document=jsonb_set(document,'{prep}',${sql.json(prep as never)}),updated_at=now() WHERE id=${id} AND (document->'prep'->>'version')::int=${prep.version}`;

/** A saved answer is always replayed; a missing answer is never silently repurchased. */
async function call<S extends z.ZodType>(options:ChatJsonOptions<S>,replay=false){
  const [old]=await sql`SELECT * FROM receipts WHERE subject=${options.subject} AND purpose=${options.purpose} ORDER BY id DESC LIMIT 1`;
  if(old&&!options.attemptTag){
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
async function demandFor(questions:Question[],url:string){
  const signals=await sql`SELECT record FROM studio_search_signals`;
  const inquiries=await sql`SELECT record FROM studio_demand_signals`;
  return Object.fromEntries(questions.map(q=>[q.id,{queries:signals.filter(r=>canonical(r.record.page)===canonical(url)&&q.terms.some(t=>String(r.record.query).toLowerCase().includes(t.toLowerCase()))).map(r=>r.record),inquiries:inquiries.filter(r=>q.terms.some(t=>String(r.record.question_rewrite).toLowerCase().includes(t.toLowerCase()))).length}]));
}

export async function preparePitchV2(id:string,version:number,actor:string,replay=false){
  const card=await cardFor(id);let prep=card?.document.prep as V2;
  if(!prep||prep.version!==version||prep.status!=='preparing'&&!replay)return {reused:true};
  const start=performance.now(),receipts:NonNullable<Prep['metrics']>['receipts']=[];
  const complete=async(status:Prep['status'],error?:string)=>{prep={...prep,status,error,finished_at:new Date().toISOString(),metrics:{preparation_ms:replay?(prep.metrics?.preparation_ms??null):Math.round(performance.now()-start),receipts,...(replay?{replayed:true}: {})}};await savePrep(id,prep);};
  try{
    const linked:NonNullable<Prep['materials']>=[];const link_errors=[];
    for(const url of [...new Set([prep.existing_url,...prep.links].filter(Boolean))]){
      try{const mid=await importLink(url,actor);const m=await studioMaterial(mid) as NonNullable<Prep['materials']>[number];linked.push({...m,first_party:false,hit_count:0,snippet:m.body_text?.slice(0,300)||'',existing_page:canonical(m.url)===canonical(prep.existing_url)});}
      catch(e){link_errors.push({url,reason:String(e).slice(0,250)});}
    }
    const page=linked.find(m=>m.existing_page);
    const [htmlRow]=page?await sql`SELECT body_html FROM articles WHERE id=${page.id}`:[];
    const sourceHtml=htmlRow?.body_html??'';
    if(prep.existing_url&&!sourceHtml)invalid('旧页正文 HTML 未取得，无法逐段保留；请补正文。');
    const paragraphs=splitPage(sourceHtml);
    prep={...prep,paragraphs,source_html:sourceHtml,original_title:page?.title??'',link_errors};
    const system=prompt('studio-pitch-subquestions');
    const first=await call({model:'default',purpose:'studio_prep_subquestions',subject:`studio-pitch:${id}:${version}`,promptVersion:sha256(system),system,user:JSON.stringify({question:prep.question,existing_page:page?{title:page.title,paragraphs:paragraphs.map(p=>({id:p.id,text:p.text.slice(0,110)}))}:null}),schema:buyerQuestionsSchema,maxTokens:2400,timeoutMs:45000,sessionId:id},replay);
    receipts.push({id:first.receiptId,usage:first.usage,model:first.model});
    const questions=first.data.subquestions;
    if(new Set(questions.map(q=>q.id)).size!==questions.length)invalid('子问题编号重复，需检查保存的回答。');
    const candidates=await searchPitchMaterials([...new Set(questions.flatMap(q=>q.terms))],50);
    const materials:NonNullable<Prep['materials']>=[...linked,...candidates.filter(m=>!linked.some(l=>l.id===m.id))];
    const evidence=answerEvidence(questions,materials);
    const facts:Fact[]=[];
    const addFact=(value:Omit<Fact,'id'>)=>{const f={...value,id:`f${facts.length+1}`} as Fact;facts.push(f);return f;};
    const demand=await demandFor(questions,prep.existing_url);
    const subquestions:NonNullable<V2['subquestions']>=questions.map(q=>{
      const matched=evidence.by_question[q.id]??[];
      const ids=matched.flatMap(e=>{
        const m=materials.find(m=>m.id===e.article_id)!;const quote=shortQuote(e.quote,m?.body_text??'');if(!quote)return [];
        return [addFact({kind:m.existing_page?'page':'source',statement:quote,quote,article_id:m.id,revision:m.revision,date:m.publication_time??null,attribution:m.existing_page?'Chipshow page':m.source_name,url:m.url}).id];
      });
      let status:Coverage['status']=ids.length?'direct':q.need==='company'?'engineer':'missing';
      if(q.need==='calc'&&q.calculation){
        const basis=q.calculation.basis;
        if(quoted(basis,`${prep.question}\n${page?.body_text??''}`)){
          const computed=calculateFact(q.calculation.fn,q.calculation.inputs);
          const f=addFact({...computed.fact,kind:'calc',quote:''});ids.push(f.id);status='calc';
        }
      }
      return {...q,coverage:{status,page_paragraphs:[],evidence:ids,action:ids.length?'':`需要${q.need==='company'?'工程确认':q.need==='calc'?'可核对的计算输入':'参考资料'}：${q.zh}`},demand:demand[q.id]};
    });
    // A short exact quote from the existing page anchors titles without sending the whole page.
    if(page&&!facts.some(f=>f.article_id===page.id)){const quote=shortQuote(paragraphs[0]?.text??'',page.body_text??'');if(quote)addFact({kind:'page',statement:quote,quote,article_id:page.id,revision:page.revision,date:page.publication_time??null,attribution:'Chipshow page',url:page.url});}
    const rules=companyFactRules();
    prep={...prep,question_en:first.data.question_en,keywords:[...new Set(questions.flatMap(q=>q.terms))],entities:[],materials,related_pages:[],subquestions,facts,weak_material_ids:evidence.weak_material_ids,blacklist:{configured:rules.configured,blocked:0,pending:0}};
    await savePrep(id,prep);
    if(!page&&facts.filter(f=>f.kind!=='calc').length<2){await complete('insufficient','未找到足够的答案句，请按子问题补参考资料。');return {status:'insufficient'};}
    const system2=prompt('studio-pitch-edit-plan');
    const excerptLength=Math.max(90,Math.min(240,Math.floor(10500/Math.max(1,paragraphs.length))));
    const user=JSON.stringify({question:prep.question,output_type:prep.output_type,subquestions,facts,paragraphs:paragraphs.map(p=>({id:p.id,text:p.text.slice(0,excerptLength)})),company_rules:rules.rules.map(r=>({id:r.id,match:r.match,action:r.action,conservative:r.conservative}))});
    const remainingMs=90000-Math.round(performance.now()-start);
    if(!replay&&remainingMs<1000)invalid('本轮备料已用完90秒，已保存拆题与检索结果，未发送第二段。');
    const result=await call({model:'default',purpose:'studio_prep_edit_plan',subject:`studio-pitch:${id}:${version}`,promptVersion:sha256(system2),system:system2,user,schema:editPlanSchema,maxTokens:3500,timeoutMs:replay?90000:remainingMs,sessionId:id},replay);
    receipts.push({id:result.receiptId,usage:result.usage,model:result.model});
    const plan=result.data;
    if(Number(result.usage?.prompt_tokens)>6000)invalid('第二段备料输入超过6000 token；已保存回答，停止新增调用。');
    const editPlan:EditOperation[]=paragraphs.map(p=>plan.edits.find(e=>e.op==='revise'&&e.paragraph===p.id)??{op:'keep',paragraph:p.id,facts:[]});
    editPlan.push(...plan.edits.filter(e=>e.op==='insert_after'));
    const errors=validateEditPlan(paragraphs,editPlan,questions,facts);if(errors.length)invalid(errors.join('；'));
    for(const t of [...plan.titles,...plan.hooks])if(!materials.some(m=>m.id===t.article_id&&(m.body_text?.includes(t.quote)||m.title.includes(t.quote))))invalid('标题/钩子的逐字出处未匹配。');
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
    prep={...prep,subquestions,edit_plan:editPlan,conclusion:changes.length?'upgrade':'no_change',outline,titles:plan.titles,hooks:plan.hooks,engineer_questions:engineer,output_type:prep.output_type==='auto'?(page?'update':'guide'):prep.output_type};
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
  const b=z.object({version:z.number().int(),subquestion_id:z.string(),url:z.url()}).strict().parse(input);
  const card=await cardFor(id);if(!card)return null;const prep=card.document.prep as V2;
  if(prep.version!==b.version||!['ready','insufficient'].includes(prep.status))throw new Conflict('仅待确认或证据不足的备料可补证据，请刷新。');
  const q=prep.subquestions?.find(q=>q.id===b.subquestion_id);if(!q)invalid('子问题不存在。');
  const mid=await importLink(b.url,actor,true),m=await studioMaterial(mid) as NonNullable<Prep['materials']>[number];
  const hits=answerEvidence([q],[m]).by_question[q.id]??[];
  if(!prep.materials!.some(a=>a.id===mid))prep.materials!.push({...m,snippet:hits[0]?.quote??m.title,hit_count:hits.length,first_party:false});
  const added=hits.flatMap(h=>{const quote=shortQuote(h.quote,m.body_text??'');if(!quote)return [];const f:Fact={id:`f${prep.facts!.length+1}`,kind:'source',statement:quote,quote,article_id:m.id,revision:m.revision,date:m.publication_time??null,attribution:m.source_name,url:m.url};prep.facts!.push(f);return [f.id];});
  q.coverage={...q.coverage,status:added.length?'direct':q.coverage.status,evidence:[...q.coverage.evidence,...added]};
  prep.weak_material_ids=hits.length?(prep.weak_material_ids??[]).filter(x=>x!==mid):[...new Set([...(prep.weak_material_ids??[]),mid])];
  await savePrep(id,prep);await audit(actor,'studio.pitch.supplement',`studio-recommendation:${id}`,'仅补该子问题检索，没有模型调用',null,{subquestion:q.id,article_id:mid,answers:added.length});
  return {id,answers:added.length,model_calls:0};
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
  const system=prompt('studio-pitch-fragment');
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
    const user=JSON.stringify({operation:op.op,heading:op.heading,question:question?.en,target:op.op==='revise'?target?.text.slice(0,600):undefined,context:{before,after},facts,engineer:packet.pitch!.engineer,withheld_numbers:packet.pitch!.withheld_numbers,method:methodExcerpt?{id:methodId,text:methodExcerpt}:null,output_format:{html_en:'HTML fragment only',zh_review:'仅本片段中文审校',used_facts:op.facts}});
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
  const done=fragments.map(f=>({op_index:f.op_index,html_en:f.html_en!,zh_review:f.zh_review!,used_facts:f.used_facts!}));
  const assembled=assembleFragments(plan.paragraphs,plan.edit_plan,done);
  // Bind the checked fragment results to this task before the normal response gate and database write.
  plan.fragments=done;
  await sql`UPDATE studio_tasks SET request=${sql.json(packet as never)} WHERE id=${task!.id} AND state='waiting'`;
  const primary=packet.articles.find(a=>a.binding.article_id===packet.pitch!.primary_article_id)!;
  const cited=plan.facts.filter(f=>done.some(d=>d.used_facts.includes(f.id))&&f.article_id&&f.quote);
  if(!cited.length){const quote=shortQuote(primary.body_text??'',primary.body_text??'');if(quote)cited.push({id:'page-context',kind:'page',statement:'Existing page retained.',quote,attribution:'Chipshow page',article_id:primary.binding.article_id});}
  const body=assembled.html_en;
  const response={task_id:task!.id,run_id:`fragments-${task!.id}`,producer:{agent_id:'studio-fragment-worker',model:'default',input_files:['confirmed fragment plan','bounded fact table','studio-pitch-fragment.md']},decisions:packet.articles.map(a=>({article_id:a.binding.article_id,decision:'KEEP',reason_zh:a.binding.article_id===primary.binding.article_id?'按已确认的编辑计划保留旧页并补足买家问题':'为改动片段提供已核对的逐字证据'})),drafts:[{news_status:'reported',source:primary.binding,title_zh:`[UPDATE] ${packet.pitch!.question}`,title_en:`[UPDATE] ${packet.pitch!.selected_title}`,body_en:body,review_zh:done.map(d=>d.zh_review).join('\n\n'),evidence:cited.map(f=>({claim:f.statement,quote:f.quote})),questions_zh:prep.engineer_questions?.map(q=>q.question)??[],keyword_hypothesis:prep.question_en??prep.question,meta_description_en:packet.pitch!.selected_title,camos_rule_ids:plan.method_rule_ids}]};
  const received=await receiveStudioTask(task!.id,response,actor);
  const [draft]=await sql`SELECT id FROM studio_drafts WHERE task_id=${task!.id} ORDER BY created_at DESC LIMIT 1`;
  prep.assembled={html_en:assembled.html_en,diff:assembled.diff,zh_review:response.drafts[0].review_zh,draft_id:draft?.id??null,gate:received?.gate??{blocked:false},elapsed_ms:Math.round(performance.now()-start)};
  await persist();await audit(actor,'studio.pitch.fragments',`studio-task:${task!.id}`,null,null,{fragments:fragments.length,receipt_ids:fragments.map(f=>f.receipt_id),result:received});
  return {...received,fragment_count:fragments.length,draft_id:draft?.id??null};
}
