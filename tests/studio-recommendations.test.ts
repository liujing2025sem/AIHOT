import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after,beforeEach,test } from 'node:test';
import { closeDb,sql } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { saveStudioQuestion } from '@aihot/backend/admin/studio-questions';
import { setRecommendationCapacity,refreshRecommendations,recommendationOverview,decideRecommendation,bindRecommendationEvidence,createManualRecommendation } from '@aihot/backend/admin/studio-recommendations';
import { createStudioTask,bindStudioTaskMaterials,exportStudioTask,generateStudioTask,receiveStudioTask } from '@aihot/backend/admin/studio';
import { importDemandCsv } from '@aihot/backend/admin/studio-demand';
import { demandCsvFields } from '@aihot/backend/admin/studio-demand-csv';
import { importSearchSignals } from '@aihot/backend/admin/studio-search-signals';
import preview from './fixtures/editorial-preview-20261103.json' with {type:'json'};
const suffix=tag(),actor=`test:recommendations:${suffix}`,source='web-macroblock-news';
after(closeDb);
beforeEach(async()=>{
  await sql`TRUNCATE studio_recommendations,studio_tasks,studio_questions,articles,sources CASCADE`;
  await sql`DELETE FROM settings WHERE key IN ('studio.recommendations.weekly_limit','studio.recommendations.lookback_days','studio.recommendations.last_refresh')`;
});
async function material(id:string,body='The manufacturer describes LED power conditions.',external=false){
  const sourceId=external?`${source}-engineering`:source;
  await sql`INSERT INTO sources(id,name,kind,enabled,first_party) VALUES(${sourceId},'Synthetic planning source',${external?'external':'web_list'},false,${external}) ON CONFLICT(id) DO NOTHING`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at,published_at,body_status,body_text) VALUES(${id},${sourceId},${id},${`https://example.com/${id}`},'LED power supply update',now(),now(),now(),'ok',${body})`;
  return id;
}
async function importVersionHistory(){
  const entries=preview.previews.filter(p=>['web-huidu-hdplayer','web-colorlight-software','web-colorlight-ledvision','web-colorlight-firmware'].includes(p.id)).flatMap(p=>p.output.items.map((entry,i)=>({...entry,source_id:p.id,id:`history-${suffix}-${p.id}-${i}`})));
  assert.equal(entries.length,22);
  for(const sourceId of new Set(entries.map(entry=>entry.source_id)))await sql`INSERT INTO sources(id,name,kind,enabled) VALUES(${sourceId},${sourceId},'web_list',false)`;
  for(const entry of entries)await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at,published_at,body_status,backfill_reason) VALUES(${entry.id},${entry.source_id},${entry.id},${entry.url},${entry.title},now(),now(),${entry.publishedAt},'pending','first-import')`;
  return entries;
}
test('operator topics reuse one card, bind dated technical evidence and adopt without claiming automatic discovery',async()=>{
  const question=await saveStudioQuestion({document:{question:'MiP封装与整屏性能怎么区分？',roles:['集成商/安装商/招牌制作商'],scenario:'小间距商显',dimension:'部件',keywords:['MiP'],content_type:'explainer'}},actor);
  await setRecommendationCapacity({weekly_limit:10,lookback_days:180},actor);
  const materialId=await material(`manual-mip-${suffix}`,'The manufacturer describes a MiP LED package; its specifications are not whole-display measurements.');
  await sql`UPDATE articles SET published_at='2021-05-01T00:00:00Z' WHERE id=${materialId}`;
  assert.equal((await refreshRecommendations(actor)).created,0);
  const request={question_id:question.id,question_version:question.version};
  const [first,again]=await Promise.all([createManualRecommendation(request,actor),createManualRecommendation(request,actor)]);
  assert.equal(first.id,again.id);assert.equal(Number(first.created)+Number(again.created),1);
  let overview=await recommendationOverview(),card=overview.rows.find(r=>r.id===first.id)!;
  assert.equal(card.document.trigger,'M');assert.equal(card.document.demand_mentions,0);assert.deepEqual(card.document.evidence,[]);
  assert.equal(card.document.evidence_checklist?.source_body,false);assert.equal(card.expired,false);
  assert.equal(overview.metrics.total,0);assert.equal(overview.metrics.manual_total,1);assert.equal(overview.metrics.adoptionRate,null);
  assert.equal((await sql`SELECT count(*)::int AS n FROM studio_tasks`)[0].n,0);
  await bindRecommendationEvidence(first.id,{article_ids:[materialId]},actor);
  card=(await recommendationOverview()).rows.find(r=>r.id===first.id)!;
  assert.equal(card.document.evidence_checklist?.source_body,true);assert.equal(card.document.evidence[0].date,'2021-05-01T00:00:00.000Z');
  const adopted=await decideRecommendation(first.id,{action:'adopt'},actor),reused=await decideRecommendation(first.id,{action:'adopt'},actor);
  assert.equal(adopted!.task_id,reused!.task_id);
  const packet=(await exportStudioTask(adopted!.task_id))!.request;
  assert.equal(packet.editorial_plan!.selection_origin,'operator');assert.equal(packet.editorial_plan!.question,question.document.question);
  assert.equal(packet.articles[0].binding.published_at,'2021-05-01T00:00:00.000Z');
  overview=await recommendationOverview();assert.equal(overview.metrics.adopted,0);assert.equal(overview.metrics.manual_adopted,1);assert.equal(overview.metrics.adoptionRate,null);
});

test('manual topics require a current active question and retain tutorial evidence requirements',async()=>{
  await assert.rejects(createManualRecommendation({question_id:'missing',question_version:1},actor),/启用的问题/);
  const document={question:'LEDVISION升级前先做什么？',roles:['集成商/安装商/招牌制作商'],scenario:'控制系统',dimension:'控制软件',keywords:['LEDVISION'],content_type:'tutorial',requires_first_party:true};
  const question=await saveStudioQuestion({document},actor);
  await assert.rejects(createManualRecommendation({question_id:question.id,question_version:question.version+1},actor),/问题已修改/);
  const first=await createManualRecommendation({question_id:question.id,question_version:question.version},actor);
  const card=(await recommendationOverview()).rows.find(r=>r.id===first.id)!;
  assert.equal(card.document.requires_first_party,true);assert.equal(card.document.evidence_checklist?.first_party,false);
  const updated=await saveStudioQuestion({id:question.id,version:question.version,document:{...document,active:false}},actor);
  await assert.rejects(createManualRecommendation({question_id:question.id,question_version:updated.version},actor),/启用的问题/);
  const brief=await saveStudioQuestion({document:{...document,question:'本周LED行业有什么新闻？',content_type:'news',requires_first_party:false}},actor);
  await assert.rejects(createManualRecommendation({question_id:brief.id,question_version:brief.version},actor),/时讯请使用近期新闻卡/);
});

test('cards require an explicit capacity, reuse the same version, require rejection reason, and adopt atomically once',async()=>{
  await material(`card-material-${suffix}`);
  assert.equal((await recommendationOverview()).rows.length,0);
  await assert.rejects(refreshRecommendations(actor),/先由运营设置/);
  await assert.rejects(setRecommendationCapacity({weekly_limit:16},actor));
  await setRecommendationCapacity({weekly_limit:5,lookback_days:30},actor);
  assert.equal((await refreshRecommendations(actor)).created,1);
  assert.equal((await refreshRecommendations(actor)).created,0);
  const card=(await recommendationOverview()).rows[0];
  await assert.rejects(decideRecommendation(card.id,{action:'reject'},actor),/填写理由/);
  const [adopted]=await Promise.all([decideRecommendation(card.id,{action:'adopt'},actor),refreshRecommendations(actor)]),again=await decideRecommendation(card.id,{action:'adopt'},actor);
  assert.equal(adopted!.task_id,again!.task_id);
  assert.equal((await sql`SELECT count(*)::int AS n FROM studio_tasks`)[0].n,1);
  assert.equal((await exportStudioTask(adopted!.task_id))!.request.editorial_plan!.card_id,card.id);
  const metrics=(await recommendationOverview()).metrics;assert.equal(metrics.adoptionRate,1);assert.equal(metrics.baseline_unknown,0);
  const pendingId=await material(`pending-card-${suffix}`);
  await sql`UPDATE articles SET body_status='pending',body_text=NULL WHERE id=${pendingId}`;
  await refreshRecommendations(actor);
  const pending=(await recommendationOverview()).rows.find(c=>c.article_id===pendingId)!;
  const research=await decideRecommendation(pending.id,{action:'adopt'},actor);
  assert.equal((await exportStudioTask(research!.task_id))!.request.articles.length,0);
  await assert.rejects(generateStudioTask(research!.task_id,actor),/先补证据/);
});
test('source revisions create a new card, old cards cannot be adopted, and the pending queue keeps overflow visible',async()=>{
  await setRecommendationCapacity({weekly_limit:5,lookback_days:30},actor);
  const id=`version-material-${suffix}`;await material(id);
  await refreshRecommendations(actor);
  const old=(await recommendationOverview()).rows.find(c=>c.article_id===id)!;
  await sql`UPDATE articles SET revision=2,body_text='The manufacturer changed LED power conditions.' WHERE id=${id}`;
  await assert.rejects(decideRecommendation(old.id,{action:'adopt'},actor),/版本已变化/);
  assert.equal((await refreshRecommendations(actor)).created,1);
  assert.equal((await recommendationOverview()).rows.filter(c=>c.article_id===id).length,2);
  for(let n=0;n<8;n++)await material(`cap-${suffix}-${n}`);
  await refreshRecommendations(actor);assert.equal((await recommendationOverview()).activeCount,5);assert.ok((await recommendationOverview()).capacityFullCount>0);
});

test('undated title-only versions are discovered once and body completion refreshes the pending card',async()=>{
  await setRecommendationCapacity({weekly_limit:5,lookback_days:30},actor);
  const id=`ledvision-${suffix}`,versionSource='web-colorlight-ledvision',discovered=new Date(Date.now()-3600000);
  await sql`INSERT INTO sources(id,name,kind,enabled) VALUES(${versionSource},'LEDVISION','web_list',false)`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at,published_at,body_status) VALUES(${id},${versionSource},${id},'https://example.com/ledvision','LEDVISION V9.7',${discovered},${discovered},NULL,'pending')`;
  await saveStudioQuestion({document:{question:'LEDVISION 升级前需要检查什么？',roles:['集成商/安装商/招牌制作商'],scenario:'控制系统',dimension:'控制软件',keywords:['LEDVISION'],content_type:'tutorial',requires_first_party:true}},actor);
  assert.equal((await refreshRecommendations(actor)).created,1);
  const first=(await recommendationOverview()).rows.find(c=>c.article_id===id)!;
  assert.equal(first.document.trigger,'E');assert.equal(first.document.evidence[0].date,null);assert.equal(first.document.evidence[0].discovered_at,discovered.toISOString());
  assert.equal((await refreshRecommendations(actor)).created,0);
  const engineering=await material(`ledvision-engineering-${suffix}`,'Synthetic hands-on LEDVISION steps.',true);
  await bindRecommendationEvidence(first.id,{article_ids:[engineering]},actor);
  await sql`INSERT INTO article_revisions(article_id,revision,title,body_text) SELECT id,revision,title,body_text FROM articles WHERE id=${id}`;
  await sql`UPDATE articles SET revision=2,body_status='ok',body_text='LEDVISION V9.7 download instructions.',updated_at=now() WHERE id=${id}`;
  assert.equal((await refreshRecommendations(actor)).created,0);
  const filled=(await recommendationOverview()).rows.filter(c=>c.article_id===id);
  assert.equal(filled.length,1);assert.equal(filled[0].id,first.id);assert.equal(filled[0].article_revision,2);assert.equal(filled[0].stale,false);
  assert.deepEqual(filled[0].document.bound_article_ids,[engineering]);assert.equal(filled[0].document.evidence_checklist?.source_body,true);
  await sql`INSERT INTO article_revisions(article_id,revision,title,body_text) SELECT id,revision,title,body_text FROM articles WHERE id=${id}`;
  await sql`UPDATE articles SET revision=3,title='LEDVISION V9.8',body_text=NULL,body_status='pending',updated_at=now() WHERE id=${id}`;
  assert.equal((await refreshRecommendations(actor)).created,1);
  const changed=(await recommendationOverview()).rows.filter(c=>c.article_id===id);assert.equal(changed.length,2);
  assert.equal(changed.find(c=>c.id===first.id)!.stale,true);assert.equal(changed.find(c=>!c.stale)!.document.trigger,'E');
});

test('R1-0 refresh carries first-import history: 22 real records produce zero cards, then synthetic undated V9.8 produces one E once',async()=>{
  await setRecommendationCapacity({weekly_limit:5,lookback_days:30},actor);
  const entries=await importVersionHistory();
  const first=await refreshRecommendations(actor);
  assert.equal(first.scanned,22);assert.equal(first.candidates,0);assert.equal(first.created,0);
  let overview=await recommendationOverview();
  assert.equal(overview.historicalVersionCount,22);assert.equal(overview.rows.length,0);
  assert.equal((await refreshRecommendations(actor)).created,0);
  const original=entries.find(entry=>entry.title==='LEDVISION V9.7')!,id=`synthetic-ledvision-v9-8-${suffix}`;
  // Synthetic counterfactual only: fixture URL reused, no invented publication date or source body.
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at,published_at,body_status) VALUES(${id},${original.source_id},${id},${original.url},'LEDVISION V9.8',now(),now(),NULL,'pending')`;
  const next=await refreshRecommendations(actor);
  assert.equal(next.candidates,1);assert.equal(next.created,1);
  overview=await recommendationOverview();
  assert.equal(overview.historicalVersionCount,22);assert.equal(overview.rows.length,1);
  const card=overview.rows[0];
  assert.equal(card.article_id,id);assert.equal(card.document.trigger,'E');assert.equal(card.document.evidence[0].date,null);
  assert.equal(card.document.evidence[0].url,original.url);assert.equal(card.document.evidence[0].after,'LEDVISION V9.8');
  assert.equal((await refreshRecommendations(actor)).created,0);
  overview=await recommendationOverview();
  assert.equal(overview.historicalVersionCount,22);assert.deepEqual(overview.rows.map(row=>row.id),[card.id]);
});

test('R1-0 refresh suppresses same-version historical body completion but allows a same-item synthetic V9.8 with the persistent marker',async()=>{
  await setRecommendationCapacity({weekly_limit:5,lookback_days:30},actor);
  const entries=await importVersionHistory(),original=entries.find(entry=>entry.title==='LEDVISION V9.7')!;
  assert.equal((await refreshRecommendations(actor)).created,0);
  await sql`INSERT INTO article_revisions(article_id,revision,title,body_text) SELECT id,revision,title,body_text FROM articles WHERE id=${original.id}`;
  // Synthetic completion control uses the real title as body, not invented source paragraphs.
  await sql`UPDATE articles SET revision=2,body_status='ok',body_text=title,updated_at=now() WHERE id=${original.id}`;
  const completed=await refreshRecommendations(actor);
  assert.equal(completed.candidates,0);assert.equal(completed.created,0);assert.equal((await recommendationOverview()).rows.length,0);
  await sql`INSERT INTO article_revisions(article_id,revision,title,body_text) SELECT id,revision,title,body_text FROM articles WHERE id=${original.id}`;
  await sql`UPDATE articles SET revision=3,title='LEDVISION V9.8',body_text=NULL,body_status='pending',updated_at=now() WHERE id=${original.id}`;
  const changed=await refreshRecommendations(actor);
  assert.equal(changed.candidates,1);assert.equal(changed.created,1);
  assert.equal((await sql`SELECT backfill_reason FROM articles WHERE id=${original.id}`)[0].backfill_reason,'first-import');
  const overview=await recommendationOverview();
  assert.equal(overview.historicalVersionCount,22);assert.equal(overview.rows.length,1);
  assert.equal(overview.rows[0].article_id,original.id);assert.equal(overview.rows[0].document.trigger,'E');
  assert.equal(overview.rows[0].document.evidence[0].date,null);
  assert.equal((await refreshRecommendations(actor)).created,0);
  assert.deepEqual((await recommendationOverview()).rows.map(row=>row.id),overview.rows.map(row=>row.id));
  await sql`INSERT INTO article_revisions(article_id,revision,title,body_text) SELECT id,revision,title,body_text FROM articles WHERE id=${original.id}`;
  await sql`UPDATE articles SET revision=4,body_text=title,body_status='ok',updated_at=now() WHERE id=${original.id}`;
  assert.equal((await refreshRecommendations(actor)).created,0);
  const filled=(await recommendationOverview()).rows[0];
  assert.equal(filled.id,overview.rows[0].id);assert.equal(filled.article_revision,4);assert.equal(filled.stale,false);
});

test('news ages out on overview and adoption without needing another refresh, and stays readable',async()=>{
  await setRecommendationCapacity({weekly_limit:5,lookback_days:30},actor);
  for(let n=0;n<5;n++)await material(`aging-${suffix}-${n}`);
  await refreshRecommendations(actor);
  const old=(await recommendationOverview()).rows[0];
  await sql`UPDATE studio_recommendations SET document=jsonb_set(document,'{evidence,0,date}',to_jsonb((now()-interval '8 days')::text))`;
  await sql`UPDATE articles SET published_at=now()-interval '8 days'`;
  const aged=await recommendationOverview();assert.equal(aged.activeCount,0);assert.equal(aged.pendingCount,0);assert.equal(aged.rows.length,5);assert.ok(aged.rows.every(c=>c.expired&&!c.capacity_full));
  await assert.rejects(decideRecommendation(old.id,{action:'adopt'},actor),/超过7天/);
  const fresh=await material(`current-${suffix}`);
  await refreshRecommendations(actor);
  const current=await recommendationOverview();assert.equal(current.activeCount,1);assert.equal(current.pendingCount,1);assert.equal(current.rows.length,6);
  assert.equal(current.rows.find(c=>c.article_id===fresh)!.expired,false);
});
test('repeated demand creates an evidence-pending task; binding continues it without using inquiry rows as facts',async()=>{
  await setRecommendationCapacity({weekly_limit:15,lookback_days:30},actor);
  const question=await saveStudioQuestion({document:{question:`安装运输要确认什么-${suffix}？`,roles:['集成商/安装商/招牌制作商'],scenario:'运输安装',dimension:'供货',keywords:['安装','运输','transport']}},actor);
  const row='2026-W45,欧洲,网站,集成商/安装商/招牌制作商,LED显示屏,运输安装,交付与运输,合成问题只用于画像界面,A';
  await importDemandCsv({csv:demandCsvFields.join(',')+'\n'+row+'\n'+row},actor);
  await refreshRecommendations(actor);
  const card=(await recommendationOverview()).rows.find(c=>c.question_id===question.id&&c.document.trigger==='B')!;
  const adopted=await decideRecommendation(card.id,{action:'adopt'},actor);
  const request=(await exportStudioTask(adopted!.task_id))!.request;assert.equal(request.articles.length,0);assert.equal(JSON.stringify(request).includes('合成问题只用于画像界面'),false);
  await assert.rejects(generateStudioTask(adopted!.task_id,actor),/先补证据/);
  const id=await material(`bound-${suffix}`);await bindStudioTaskMaterials(adopted!.task_id,{article_ids:[id]},actor);
  assert.equal((await exportStudioTask(adopted!.task_id))!.request.articles[0].binding.article_id,id);
});
test('tutorial and existing-page updates HOLD before a paid call when the required evidence is missing',async()=>{
  const materialId=await material(`tutorial-${suffix}`,'NovaLCT version 5.6.1 was announced.');
  const cardId=`test-tutorial-card-${suffix}`;
  await sql`INSERT INTO studio_recommendations(id,input_key,article_id,article_revision,document,updated_by) VALUES(${cardId},${cardId},${materialId},1,${sql.json({title:'实机教程',priority:1})},${actor})`;
  const planned={card_id:cardId,question_id:null,action:'new_tutorial',question:'NovaLCT实机教程',existing_url:'',requires_first_party:true};
  const task=await createStudioTask({article_ids:[materialId],planning_context:planned},actor);
  const before=(await sql`SELECT count(*)::int AS n FROM receipts`)[0].n;
  await assert.rejects(generateStudioTask(task.id,actor),/实机来源/);
  assert.equal((await sql`SELECT count(*)::int AS n FROM receipts`)[0].n,before);
  const packet=(await exportStudioTask(task.id))!.request,binding=packet.articles[0].binding;
  await assert.rejects(receiveStudioTask(task.id,{task_id:task.id,run_id:'synthetic-tutorial-return',producer:{agent_id:'fixture',model:null,input_files:['request.json']},decisions:[{article_id:materialId,decision:'KEEP',reason_zh:'模拟结果'}],drafts:[{source:binding,title_zh:'实机教程',review_zh:'模拟教程',title_en:'Tutorial',body_en:`Source: ${binding.url}`,evidence:[{claim:'Source',quote:'NovaLCT version 5.6.1 was announced.'}],questions_zh:[],keyword_hypothesis:'NovaLCT',meta_description_en:'Tutorial.'}]},actor),/实机来源/);
  const update=await createStudioTask({article_ids:[materialId],planning_context:{...planned,action:'update_page',requires_first_party:false,existing_url:'https://www.chipshow.com/an-actual-old-page'}},actor);
  await assert.rejects(generateStudioTask(update.id,actor),/旧页正文/);
  assert.equal(config.modelCallsEnabled,true);
});
test('GSC and Semrush imports enter candidate evidence while optional baseline stays unknown until observed',async()=>{
  await setRecommendationCapacity({weekly_limit:15,lookback_days:30},actor);
  const question=await saveStudioQuestion({document:{question:`屏幕维护缺口-${suffix}？`,roles:['集成商/安装商/招牌制作商'],scenario:'维护',dimension:'维护',keywords:['maintenance'],existing_url:'https://www.chipshow.com/maintenance'}},actor);
  await importSearchSignals({kind:'gsc',csv:'query,page,impressions,clicks,position,period\nmaintenance,https://www.chipshow.com/maintenance,100,2,20,2026-10'},actor);
  await refreshRecommendations(actor);
  const card=(await recommendationOverview()).rows.find(c=>c.question_id===question.id&&c.document.trigger==='C')!;
  assert.equal(card.baseline_found,null);
  await decideRecommendation(card.id,{action:'observe',baseline_found:false},actor);
  assert.equal((await recommendationOverview()).metrics.baseline_missed_updates,1);
  await decideRecommendation(card.id,{action:'adopt'},actor);
  await decideRecommendation(card.id,{action:'complete'},actor);
  assert.equal((await recommendationOverview()).metrics.updates_completed,1);
});

test('late A preempts a full D queue and a card exposes its evidence before adoption',async()=>{
  await setRecommendationCapacity({weekly_limit:5,lookback_days:30},actor);
  for(let n=0;n<5;n++)await material(`early-${suffix}-${n}`);
  await refreshRecommendations(actor);
  assert.equal((await recommendationOverview()).activeCount,5);
  const question=await saveStudioQuestion({document:{question:'MBI123刷新率变化会影响哪种拍摄？',roles:['集成商/安装商/招牌制作商'],scenario:'拍摄',dimension:'部件',keywords:['MBI123','refresh rate'],existing_url:'https://chipshow.com/refresh'}},actor);
  const changed=await material(`changed-${suffix}`,'MBI123 refresh rate is 3840 Hz.');
  await sql`INSERT INTO article_revisions(article_id,revision,title,body_text) VALUES(${changed},1,'MBI123','MBI123 refresh rate is 1920 Hz.')`;
  await sql`UPDATE articles SET revision=2 WHERE id=${changed}`;
  await refreshRecommendations(actor);
  let overview=await recommendationOverview();const card=overview.rows.find(c=>c.question_id===question.id)!;
  assert.equal(card.document.trigger,'A');assert.equal(card.capacity_full,false);assert.equal(overview.capacityFullCount,1);
  assert.match(card.document.evidence[0].before!,/1920/);assert.match(card.document.evidence[0].after!,/3840/);
  assert.equal(card.document.evidence_checklist!.existing_page_body,false);
  const page=await material(`old-page-${suffix}`,'Existing explanation: MBI123 refresh rate is 1920 Hz.');
  await sql`UPDATE articles SET url='https://chipshow.com/refresh' WHERE id=${page}`;
  await bindRecommendationEvidence(card.id,{article_ids:[page]},actor);
  overview=await recommendationOverview();const ready=overview.rows.find(c=>c.id===card.id)!;
  assert.equal(ready.document.evidence_checklist!.existing_page_body,true);
  assert.match(ready.document.affected_page!.paragraph!,/1920 Hz/);
  const adopted=await decideRecommendation(card.id,{action:'adopt'},actor);
  assert.equal((await exportStudioTask(adopted!.task_id))!.request.articles.length,2);
});

test('200 GSC rows group by problem and page per batch; own Semrush winners are not gaps',async()=>{
  await setRecommendationCapacity({weekly_limit:5,lookback_days:30},actor);
  const question=await saveStudioQuestion({document:{question:'户外电源如何选？',roles:['集成商/安装商/招牌制作商'],scenario:'供电',dimension:'部件',keywords:['power supply']}},actor);
  const rows=Array.from({length:200},(_,i)=>`power supplies ${i},https://chipshow.com/power,100,2,20,2026-10`);
  await importSearchSignals({kind:'gsc',csv:'query,page,impressions,clicks,position,period\n'+rows.join('\n')},actor);
  await importSearchSignals({kind:'semrush',csv:'keyword,url,position,volume,period\npower supply,https://chipshow.com/power,2,100,2026-10'},actor);
  await refreshRecommendations(actor);
  const cards=(await recommendationOverview()).rows.filter(c=>c.question_id===question.id);
  assert.equal(cards.length,1);assert.equal(cards[0].document.action,'update_page');assert.equal(cards[0].document.evidence.length,5);
  assert.match(cards[0].document.reason,/200个查询/);
});

test('10k-material refresh reads only configured LED/referenced sources and operator window',async()=>{
  await setRecommendationCapacity({weekly_limit:5,lookback_days:30},actor);
  await sql`INSERT INTO sources(id,name,kind,enabled) VALUES(${source},'Synthetic LED source','web_list',false),('rss-openai-news','AI demo','rss',false)`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at,published_at,body_status,body_text,updated_at)
    SELECT 'bench-'||n,CASE WHEN n<=5000 THEN 'rss-openai-news' ELSE ${source} END,'bench-'||n,'https://example.com/bench-'||n,'LED power supply','2020-01-01'::timestamptz,now(),CASE WHEN n>9990 THEN now() ELSE '2020-01-01'::timestamptz END,'ok','Synthetic LED power supply body.','2020-01-01'::timestamptz FROM generate_series(1,10000) n`;
  const start=performance.now(),result=await refreshRecommendations(actor),elapsedMs=performance.now()-start;
  assert.equal(result.scanned,10);assert.equal(result.created,10);
  assert.equal((await recommendationOverview()).activeCount,5);
  console.log(JSON.stringify({benchmark:'A7',totalMaterials:10000,scanned:result.scanned,elapsedMs:Number(elapsedMs.toFixed(2)),modelCalls:0}));
});
