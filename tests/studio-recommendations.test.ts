import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after,beforeEach,test } from 'node:test';
import { closeDb,sql } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { saveStudioQuestion } from '@aihot/backend/admin/studio-questions';
import { setRecommendationCapacity,refreshRecommendations,recommendationOverview,decideRecommendation,bindRecommendationEvidence } from '@aihot/backend/admin/studio-recommendations';
import { createStudioTask,bindStudioTaskMaterials,exportStudioTask,generateStudioTask,receiveStudioTask } from '@aihot/backend/admin/studio';
import { importDemandCsv } from '@aihot/backend/admin/studio-demand';
import { demandCsvFields } from '@aihot/backend/admin/studio-demand-csv';
import { importSearchSignals } from '@aihot/backend/admin/studio-search-signals';
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
