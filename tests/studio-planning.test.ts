import { gate, tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import Fastify from 'fastify';
import { sql, closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { passwordLogin, SESSION_COOKIE, sessionPrincipal } from '@aihot/backend/admin/auth';
import { registerAdminStudioPlanning } from '../apps/api/src/routes/admin-studio-planning.ts';
import { saveStudioQuestion, importStudioQuestions, studioQuestions } from '@aihot/backend/admin/studio-questions';
import { importDemandCsv } from '@aihot/backend/studio/studio-demand';
import { demandCsvFields } from '@aihot/backend/studio/studio-demand-csv';
import { createStudioTask, exportStudioTask, receiveStudioTask, reviewStudioDraft, runStudioDraftRevision } from '@aihot/backend/studio/studio';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { englishReviewHash } from '@aihot/backend/studio/studio-review-edits';
import type { RevisionRequest } from '@aihot/backend/studio/studio-revision-edits';
import { responseSchema, sha256 } from '../scripts/editorial-pilot-lib.ts';
import {getPitch,savePitchChoices,confirmPitch,type Prep} from '../packages/backend/src/studio/studio-pitch.ts';
import {savePitchFacts,generatePitchFragments} from '../packages/backend/src/studio/studio-pitch-v2.ts';

const actor='test:planning',suffix=tag();
const doc={question:`户外招牌电费怎么计算-${suffix}？`,roles:['终端业主/广告媒体主'],scenario:'户外招牌',dimension:'费用',keywords:['电费','用电','power']};
const originalModelCalls=config.modelCallsEnabled;
before(()=>{config.modelCallsEnabled=false;});
after(async()=>{try{await stopBoss();}finally{config.modelCallsEnabled=originalModelCalls;await closeDb();}});

test('question map import is all-or-nothing, repeatable and never overwrites operator changes',async()=>{
  const first=await importStudioQuestions({questions:[doc]},actor);assert.deepEqual(first,{created:1,skipped:0});
  const again=await importStudioQuestions({questions:[doc]},actor);assert.deepEqual(again,{created:0,skipped:1});
  const row=(await studioQuestions()).rows.find(row=>row.document.question===doc.question)!;
  await saveStudioQuestion({id:row.id,version:row.version,document:{...row.document,existing_url:'https://www.chipshow.com/an-operator-supplied-page'}},actor);
  await importStudioQuestions({questions:[doc]},actor);
  const updated=(await studioQuestions()).rows.find(q=>q.id===row.id)!;assert.equal(updated.document.existing_url,'https://www.chipshow.com/an-operator-supplied-page');
  await assert.rejects(saveStudioQuestion({id:row.id,version:row.version,document:doc},actor),/已被更新/);
  await assert.rejects(importStudioQuestions({questions:[{...doc,question:`another-${suffix}`},{...doc,question:`invalid-${suffix}`,source_ids:['not-a-registered-source']}]},actor),/信源尚未配置/);
  assert.equal((await sql`SELECT 1 FROM studio_questions WHERE document->>'question'=${`another-${suffix}`}`).length,0);
});

test('planning endpoints require login and CSRF, and examples do not auto-import',async()=>{
  const app=Fastify();registerAdminStudioPlanning(app);const old={password:config.adminPassword,dev:config.devAdmin};config.adminPassword='test-planning-password-123';config.devAdmin=null;
  try{
    assert.equal((await app.inject('/api/admin/studio/questions')).statusCode,401);
    const {token}=await passwordLogin(config.adminPassword,'/admin','test');const cookie=`${SESSION_COOKIE}=${token}`,principal=(await sessionPrincipal(cookie))!;
    const before=(await sql`SELECT count(*)::int AS n FROM studio_questions`)[0].n;
    const example=await app.inject({url:'/api/admin/studio/questions/example',headers:{cookie}});assert.equal(example.statusCode,200);assert.equal(example.json().questions.length,36);
    assert.equal((await sql`SELECT count(*)::int AS n FROM studio_questions`)[0].n,before);
    const payload={document:{...doc,question:`endpoint-${suffix}`}};
    assert.equal((await app.inject({method:'POST',url:'/api/admin/studio/questions',headers:{cookie},payload})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/api/admin/studio/questions',headers:{cookie,'x-csrf-token':principal.csrf},payload})).statusCode,200);
    const csv=demandCsvFields.join(',')+'\n2026-W45,欧洲,网站,集成商/安装商/招牌制作商,LED显示屏,户外招牌,安装,联系someone@example.com,A';
    const rejected=await app.inject({method:'POST',url:'/api/admin/studio/demand/import',headers:{cookie,'x-csrf-token':principal.csrf},payload:{csv}});
    assert.equal(rejected.statusCode,400);assert.match(rejected.body,/第2行/);assert.match(rejected.body,/question_rewrite/);assert.equal(rejected.body.includes('someone@example.com'),false);
  }finally{config.adminPassword=old.password;config.devAdmin=old.dev;await app.close();}
});

test('task writing receives aggregate readership only and never another brand profile',async()=>{
  // Keep random identifiers out of inquiry text: a numeric run in tag() can correctly trigger PII_PHONE.
  const source=`planning-source-${suffix}`,article=`planning-article-${suffix}`,privateQuestion='只保留在聚合界面代表问法里的内容';
  await sql`INSERT INTO sources(id,name,kind,enabled) VALUES(${source},'Synthetic LED source','web_list',false)`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at,body_status,body_text) VALUES(${article},${source},${article},${`https://example.com/${article}`},'LED display driver update',now(),now(),'ok','The manufacturer announced a display driver update.')`;
  await importDemandCsv({csv:demandCsvFields.join(',')+`\n2026-W45,欧洲,网站,集成商/安装商/招牌制作商,LED显示屏,户外招牌,交付与运输,${privateQuestion},A`},actor);
  const task=await createStudioTask({article_ids:[article]},actor),pack=(await exportStudioTask(task.id))!;
  assert.equal(pack.request.reader_profile?.totals.recordCount,1);
  assert.match(pack.request.reader_profile!.descriptions[0],/登记提及 1 条/);
  assert.equal(JSON.stringify(pack).includes(privateQuestion),false);
  const other=await createStudioTask({article_ids:[article],writing:{site:'unishineled.com',target_url:'https://unishineled.com/example',page_type:'article'}},actor);
  assert.equal((await exportStudioTask(other.id))!.request.reader_profile,undefined);
});

async function revisionDraftFixture(status:RevisionRequest['status']='running',stale=false) {
  const key=`revision-${tag()}`,source=`${key}-source`,article=`${key}-article`;
  await sql`INSERT INTO sources(id,name,kind,enabled) VALUES(${source},'Synthetic revision source','web_list',false)`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at,body_status,body_text)
    VALUES(${article},${source},${article},${`https://example.com/${article}`},'Installation drawing guidance',now(),now(),'ok','Check the installation drawing before mounting.')`;
  const task=await createStudioTask({article_ids:[article]},actor),pack=(await exportStudioTask(task.id))!;
  const draft=responseSchema.shape.drafts.element.parse({source:pack.request.articles[0]!.binding,title_zh:'安装检查',review_zh:'安装前核对图纸。',title_en:'Installation checklist',
    body_en:`Before mounting, check the installation drawing. Source: ${pack.request.articles[0]!.binding.url}`,meta_description_en:'A checklist for installation drawings.',keyword_hypothesis:'installation drawing',questions_zh:[],
    evidence:[{claim:'Check the drawing',quote:'Check the installation drawing before mounting.'}]});
  const received=await receiveStudioTask(task.id,{task_id:task.id,run_id:`run-${key}`,producer:{agent_id:'revision-fixture',model:null,input_files:['synthetic fixtures']},
    decisions:[{article_id:article,decision:'KEEP',reason_zh:'安装前核对图纸。'}],drafts:[draft]},actor);
  assert.equal(received?.state,'received');
  const [row]=await sql<{id:string}[]>`SELECT id FROM studio_drafts WHERE task_id=${task.id}`;
  assert.ok(row);
  const version=2;
  const revision:RevisionRequest={version,status,goals:['shorten'],note:'',base_hash:sha256(JSON.stringify(draft))};
  const document={...draft,revision_request:revision,...(stale?{review_sync:{status:'stale',english_hash:englishReviewHash(draft)}}:{})};
  await sql`UPDATE studio_drafts SET document=${sql.json(document as never)},version=${version},status='draft' WHERE id=${row.id}`;
  return {id:row.id,version,draft,revision};
}

async function revisionReceipt(fixture:{id:string;version:number},status:'received'|'unknown'|'pending',edits?:unknown) {
  const response=edits?{choices:[{message:{content:JSON.stringify(edits)}}]}:null;
  const [receipt]=await sql<{id:number}[]>`INSERT INTO receipts(logical_key,service,purpose,subject,status,response,origin)
    VALUES(${`revision-fixture-${tag()}`},'test-fixture','studio_revision',${`studio-revision:${fixture.id}:${fixture.version}`},${status},${response?sql.json(response):null},'imported') RETURNING id`;
  return receipt!.id;
}

async function revisionReceiptCount(id:string) {
  return (await sql<{n:number}[]>`SELECT count(*)::int AS n FROM receipts WHERE subject LIKE ${`studio-revision:${id}:%`} AND purpose='studio_revision'`)[0]!.n;
}

test('running revision recovers an already received answer once without any new model receipt',async()=>{
  const fixture=await revisionDraftFixture();
  const receiptId=await revisionReceipt(fixture,'received',{edits:[{field:'title_en',original:fixture.draft.title_en,replacement:'Installation drawing checklist'}]});
  const queued=await reviewStudioDraft(fixture.id,{version:fixture.version,action:'recover_revision'},actor);
  assert.equal(queued?.version,fixture.version);
  const result=await runStudioDraftRevision({draftId:fixture.id,version:fixture.version,actor,recoverOnly:true});
  assert.ok('receiptId' in result);assert.equal(result.receiptId,receiptId);
  const [saved]=await sql`SELECT document,version,status FROM studio_drafts WHERE id=${fixture.id}`;
  assert.equal(saved.document.title_en,'Installation drawing checklist');
  assert.equal(saved.document.body_en,fixture.draft.body_en);
  assert.equal(saved.document.revision_request.status,'done');
  assert.equal(saved.document.revision_request.receipt_id,receiptId);
  assert.equal(saved.version,fixture.version+1);assert.equal(saved.status,'draft');
  assert.equal(saved.document.review_sync.status,'stale');
  await runStudioDraftRevision({draftId:fixture.id,version:fixture.version,actor,recoverOnly:true});
  assert.deepEqual((await sql`SELECT document,version,status FROM studio_drafts WHERE id=${fixture.id}`)[0],saved);
  assert.equal(await revisionReceiptCount(fixture.id),1);
});

test('unknown and pending receipts never create another paid revision, including after keeping the original',async()=>{
  for(const status of ['unknown','pending'] as const){
    const fixture=await revisionDraftFixture('unknown');
    const receiptId=await revisionReceipt(fixture,status);
    await reviewStudioDraft(fixture.id,{version:fixture.version,action:'recover_revision'},actor);
    await assert.rejects(runStudioDraftRevision({draftId:fixture.id,version:fixture.version,actor,recoverOnly:true}),/待核对.*未重复调用/);
    const [saved]=await sql`SELECT document,version FROM studio_drafts WHERE id=${fixture.id}`;
    assert.equal(saved.document.body_en,fixture.draft.body_en);assert.equal(saved.document.title_en,fixture.draft.title_en);
    assert.equal(saved.document.revision_request.status,'unknown');assert.equal(saved.document.revision_request.receipt_id,receiptId);
    assert.equal(saved.version,fixture.version);assert.equal(await revisionReceiptCount(fixture.id),1);
    const kept=await reviewStudioDraft(fixture.id,{version:fixture.version,action:'keep_revision_original'},actor);
    assert.ok(kept);
    await assert.rejects(reviewStudioDraft(fixture.id,{version:kept.version,action:'return',revision_goals:['shorten']},actor),/账单结果待核对/);
    assert.equal(await revisionReceiptCount(fixture.id),1);
  }
});

test('queued or running revision without a receipt fails recovery safely and the original can continue',async()=>{
  for(const status of ['queued','running'] as const){
    const fixture=await revisionDraftFixture(status);
    await reviewStudioDraft(fixture.id,{version:fixture.version,action:'recover_revision'},actor);
    await assert.rejects(runStudioDraftRevision({draftId:fixture.id,version:fixture.version,actor,recoverOnly:true}),/没有找到可恢复.*本次未调用模型/);
    const [saved]=await sql`SELECT document,version FROM studio_drafts WHERE id=${fixture.id}`;
    assert.equal(saved.document.body_en,fixture.draft.body_en);assert.equal(saved.document.title_en,fixture.draft.title_en);
    assert.equal(saved.document.revision_request.status,'failed');assert.equal(saved.version,fixture.version);
    assert.equal(await revisionReceiptCount(fixture.id),0);
    const kept=await reviewStudioDraft(fixture.id,{version:fixture.version,action:'keep_revision_original'},actor);
    assert.ok(kept);
    const submitted=await reviewStudioDraft(fixture.id,{version:kept.version,action:'submit'},actor);
    assert.equal(submitted?.status,'in_review');
  }
});

test('cancelling a revision after its snapshot prevents its old worker from overwriting the original',async()=>{
  const fixture=await revisionDraftFixture();
  await revisionReceipt(fixture,'received',{edits:[{field:'title_en',original:fixture.draft.title_en,replacement:'Late model revision'}]});
  const locked=gate<void>(),release=gate<void>();
  const blocker=sql.begin(async tx=>{
    await tx`LOCK TABLE receipts IN ACCESS EXCLUSIVE MODE`;
    locked.open();await release.promise;
  });
  await locked.promise;
  let finished=false;
  const worker=runStudioDraftRevision({draftId:fixture.id,version:fixture.version,actor,recoverOnly:true})
    .then(value=>({value,error:null}),error=>({value:null,error})).finally(()=>{finished=true;});
  try{
    let waiting=false;
    for(let i=0;i<500&&!finished;i++){
      const rows=await sql`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
        AND query LIKE 'SELECT id,status,response FROM receipts WHERE subject=%'`;
      if(rows.length){waiting=true;break;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(waiting,true,'worker must have saved its running snapshot before cancellation');
    const kept=await reviewStudioDraft(fixture.id,{version:fixture.version,action:'keep_revision_original'},actor);
    assert.equal(kept?.version,fixture.version+1);
  }finally{release.open();await blocker;await worker;}
  const outcome=await worker;
  assert.equal(outcome.error,null);assert.ok(outcome.value&&'superseded' in outcome.value);assert.equal(outcome.value.superseded,true);
  const [saved]=await sql`SELECT document,version,status FROM studio_drafts WHERE id=${fixture.id}`;
  assert.equal(saved.document.title_en,fixture.draft.title_en);assert.equal(saved.document.body_en,fixture.draft.body_en);
  assert.equal(saved.document.revision_request.status,'cancelled');assert.equal(saved.version,fixture.version+1);assert.equal(saved.status,'draft');
  await runStudioDraftRevision({draftId:fixture.id,version:fixture.version,actor});
  assert.deepEqual((await sql`SELECT document,version,status FROM studio_drafts WHERE id=${fixture.id}`)[0],saved);
  assert.equal(await revisionReceiptCount(fixture.id),1);
});

test('a recovered Chinese-title-only patch preserves the existing stale English-review requirement',async()=>{
  const fixture=await revisionDraftFixture('running',true);
  await revisionReceipt(fixture,'received',{edits:[{field:'title_zh',original:fixture.draft.title_zh,replacement:'安装图纸检查'}]});
  await runStudioDraftRevision({draftId:fixture.id,version:fixture.version,actor,recoverOnly:true});
  const [saved]=await sql`SELECT document,version FROM studio_drafts WHERE id=${fixture.id}`;
  assert.equal(saved.document.title_zh,'安装图纸检查');assert.equal(saved.document.title_en,fixture.draft.title_en);
  assert.equal(saved.document.review_sync.status,'stale');assert.equal(saved.document.review_sync.english_hash,englishReviewHash(fixture.draft));
  assert.equal(saved.document.revision_request.status,'done');assert.equal(saved.version,fixture.version+1);
  assert.equal(await revisionReceiptCount(fixture.id),1);
});

test('queued revision rejects submit and confirm without advancing the draft version',async()=>{
  const fixture=await revisionDraftFixture('queued');
  const [before]=await sql`SELECT document,version,status FROM studio_drafts WHERE id=${fixture.id}`;
  for(const action of ['submit','confirm'] as const)await assert.rejects(reviewStudioDraft(fixture.id,{version:fixture.version,action},actor),/修订尚未结束/);
  assert.deepEqual((await sql`SELECT document,version,status FROM studio_drafts WHERE id=${fixture.id}`)[0],before);
  assert.equal(await revisionReceiptCount(fixture.id),0);
});

async function pitchChoiceFixture(){
  const key=`pitch-input-${tag()}`,source=`${key}-source`,article=`${key}-article`,quote='Check the pickup notice before warehouse collection.';
  await sql`INSERT INTO sources(id,name,kind,enabled) VALUES(${source},'Synthetic pickup source','web_list',false)`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at,body_status,body_text)
    VALUES(${article},${source},${article},${`https://example.com/${article}`},'Title-only promise',now(),now(),'ok',${quote})`;
  const [m]=await sql`SELECT a.id,a.title,a.url,a.source_id,a.revision,a.body_status,a.body_text FROM articles a WHERE id=${article}`;
  const prep={workflow_version:2,version:1,status:'ready',question:'提货之前需要核对哪些文件',output_type:'guide',existing_url:'',links:[],started_at:new Date().toISOString(),finished_at:new Date().toISOString(),materials:[{...m,source_name:'Synthetic source',hit_count:1,first_party:false,snippet:quote}],
    facts:[{id:'f1',kind:'source',statement:quote,quote,article_id:article,revision:m!.revision,attribution:'Synthetic source'}],paragraphs:[],source_html:'',original_title:'',
    subquestions:[{id:'q1',zh:'提货文件',en:'Pickup documents',need:'reference',answer_shape:'steps',terms:['pickup','notice'],coverage:{status:'direct',page_paragraphs:[],evidence:['f1']},demand:{queries:[],inquiries:0}}],
    conclusion:'upgrade',edit_plan:[{op:'insert_after',paragraph:'start',subquestion:'q1',heading:'Old heading',reason:'Answer the buyer document question',facts:['f1']},{op:'insert_after',paragraph:'start',subquestion:'q1',heading:'Omitted heading',reason:'Not selected',facts:['f1']}],
    outline:[{id:'change-0',heading:'Original heading',evidence:[{article_id:article,quote}],gap:'',action:''},{id:'change-1',heading:'Omitted heading',evidence:[{article_id:article,quote}],gap:'',action:''}],
    titles:[{title:'Chosen pickup checklist',anchor:'pickup document',article_id:article,quote}],hooks:[],engineer_questions:[]};
  await sql`INSERT INTO studio_recommendations(id,input_key,document,updated_by) VALUES(${key},${key},${sql.json({title:prep.question,prep} as never)},${actor})`;
  return {id:key,article,quote,prep};
}

test('fact input persists without model calls, preserves materials, invalidates the plan and retains old choices in audit',async()=>{
  const f=await pitchChoiceFixture();
  const choices={version:1,choice_revision:0,selected_title:'Chosen pickup checklist',article_ids:[f.article],outline:[{id:'change-0',heading:'Chosen heading',include:true},{id:'change-1',heading:'Omitted heading',include:false}],additions:['checklist'],note:'Use a concise checklist.'};
  await savePitchChoices(f.id,choices,actor);
  const before=(await sql`SELECT count(*)::int AS n FROM receipts`)[0].n;
  const saved=await savePitchFacts(f.id,{version:1,facts:[{statement:f.quote,attribution:'Saved source',article_id:f.article,quote:f.quote},{statement:'User supplied timing, still unchecked',attribution:'Operator note',url:'https://example.com/not-imported'}]},actor);
  assert.equal(saved?.version,2);assert.equal(saved?.status,'insufficient');assert.equal(saved?.model_calls,0);
  const loaded=(await getPitch(f.id))!;
  assert.deepEqual(loaded.prep!.operator_facts,saved!.facts);
  assert.deepEqual(saved!.facts.map(row=>row.verification),['source_verified','operator_supplied']);
  assert.equal(loaded.prep!.materials?.[0].id,f.article);assert.equal(loaded.prep!.editorial_choices,undefined);assert.equal(loaded.prep!.outline,undefined);
  assert.equal((loaded.prep as Prep&{edit_plan?:unknown}).edit_plan,undefined);
  const [record]=await sql`SELECT after FROM audit_log WHERE subject=${`studio-recommendation:${f.id}`} AND action='studio.pitch.facts'`;
  assert.equal(record.after.previous_choices.selected_title,choices.selected_title);assert.equal(record.after.previous_choices.outline[0].heading,'Chosen heading');
  assert.equal((await sql`SELECT count(*)::int AS n FROM receipts`)[0].n,before);
  await assert.rejects(savePitchFacts(f.id,{version:1,facts:[]},actor),/刷新/);
  const again=await savePitchFacts(f.id,{version:2,facts:saved!.facts.map(({verification,revision,...row})=>row)},actor);
  assert.deepEqual(again!.facts.map(row=>row.id),saved!.facts.map(row=>row.id));
});

test('chosen title, section and additions enter the actual fragment request; omitted sections never run',async()=>{
  const f=await pitchChoiceFixture();
  const outline=[{id:'change-0',heading:'Chosen buyer document heading',include:true},{id:'change-1',heading:'Omitted heading',include:false}];
  const choices={version:1,choice_revision:0,selected_title:'Chosen pickup checklist',article_ids:[f.article],outline,additions:['checklist'],note:'Use a concise checklist.'};
  await savePitchChoices(f.id,choices,actor);
  const confirmed=await confirmPitch(f.id,{version:1,choice_revision:1,article_ids:[f.article],selected_title:choices.selected_title,output_type:'guide',outline,engineer:{mode:'conservative'}},actor);
  const [task]=await sql`SELECT request FROM studio_tasks WHERE id=${confirmed!.task_id}`;
  assert.equal(task.request.pitch.selected_title,choices.selected_title);assert.equal(task.request.pitch.fragments_plan.edit_plan.length,1);
  const requests:Record<string,any>[]=[];
  await generatePitchFragments(f.id,actor,{},async options=>{
    requests.push(JSON.parse(String(options.user)));
    throw new Error('Synthetic capture: no model called.');
  });
  assert.equal(requests.length,1);assert.equal(requests[0].selected_title,choices.selected_title);assert.equal(requests[0].heading,outline[0].heading);
  assert.match(requests[0].editorial_choices.additions[0],/核对清单/);assert.equal(requests[0].editorial_choices.note,choices.note);
  assert.deepEqual(requests[0].facts.map((row:{article_id:string})=>row.article_id),[f.article]);
  await assert.rejects(savePitchFacts(f.id,{version:1,facts:[]},actor),/原稿件/);
});
