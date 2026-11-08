import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after,beforeEach,test } from 'node:test';
import { closeDb,sql } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { saveStudioQuestion } from '@aihot/backend/admin/studio-questions';
import { setRecommendationCapacity,refreshRecommendations,recommendationOverview,decideRecommendation,bindRecommendationEvidence,createManualRecommendation } from '@aihot/backend/admin/studio-recommendations';
import { createStudioTask,bindStudioTaskMaterials,exportStudioTask,generateStudioTask,receiveStudioTask } from '@aihot/backend/studio/studio';
import { importDemandCsv } from '@aihot/backend/studio/studio-demand';
import { demandCsvFields } from '@aihot/backend/studio/studio-demand-csv';
import { importSearchSignals } from '@aihot/backend/admin/studio-search-signals';
import { normalizePitch, pitchMaterialHits, redactPitch, searchPitchMaterials } from '@aihot/backend/studio/studio-pitch-evidence';
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
  const publishedAt=new Date(Date.now()-60_000); // Avoid a DB/app clock edge making a fixture look future-dated.
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at,published_at,body_status,body_text) VALUES(${id},${sourceId},${id},${`https://example.com/${id}`},'LED power supply update',now(),now(),${publishedAt},'ok',${body})`;
  return id;
}

test('pitch evidence finds historical body-only matches and ranks distinct hits, first-party status, then date', async () => {
  const body = 'Background sentence. For 户外LED显示, use the P2.5 cabinet and check power. Power is listed twice.';
  await material('pitch-history', body);
  await material('pitch-first-recent', 'The reference mentions 户外 and power.', true);
  await material('pitch-first-old', 'The reference mentions 户外 and power.', true);
  await material('pitch-third-recent', 'The reference mentions 户外 and power.');
  await material('pitch-title-only', '', true);
  await material('pitch-false', 'An empowering display uses P2.50 and highpower circuitry.');
  await sql`UPDATE articles SET title='Cabinet reference'`;
  await sql`UPDATE articles SET published_at='2019-02-01T00:00:00Z',publication_time='2019-02-01',revision=4
    WHERE id='pitch-history'`;
  await sql`UPDATE articles SET published_at='2020-01-01' WHERE id='pitch-first-old'`;
  await sql`UPDATE articles SET title='P2.5 reference',published_at=NULL,body_status='pending',body_text=NULL
    WHERE id='pitch-title-only'`;

  const keywords = ['户外 P2.5', 'power', 'POWER', '  '];
  const rows = await searchPitchMaterials(keywords);
  assert.deepEqual(rows.map(({ id, hit_count }) => [id, hit_count]), [
    ['pitch-history', 3], ['pitch-first-recent', 2], ['pitch-first-old', 2],
    ['pitch-third-recent', 2], ['pitch-title-only', 1],
  ]);
  assert.equal(rows[0].revision, 4);
  assert.equal(rows[0].publication_time, '2019-02-01');
  assert.ok(rows[0].published_at!.toISOString().startsWith('2019-02-01'));
  assert.equal(rows[0].body_text, body);
  assert.equal(rows[0].snippet, 'For 户外LED显示, use the P2.5 cabinet and check power.');
  assert.equal(rows.at(-1)?.snippet, 'P2.5 reference');
  assert.deepEqual((await searchPitchMaterials(keywords, 2, sql, { offset: 1 })).map(r => r.id), [
    'pitch-first-recent', 'pitch-first-old',
  ]);
});

test('pitch evidence treats LIKE wildcards as literal text and supports reuse in material filters', async () => {
  await material('pitch-literal', 'The A_B code is calibrated to 100%.');
  await material('pitch-lookalike', 'The ACB code is calibrated to 1000.');
  const keywords = ['A_B', '100%'];
  const rows = await searchPitchMaterials(keywords);
  assert.deepEqual(rows.map(r => [r.id, r.hit_count]), [['pitch-literal', 2]]);
  const [count] = await sql`SELECT count(*)::int AS n FROM articles a WHERE ${pitchMaterialHits(keywords)} > 0`;
  assert.equal(count.n, 1);
  assert.deepEqual(await searchPitchMaterials([' ']), []);
});

test('pitch evidence masks customer contact details and signoffs while keeping LED technical text', () => {
  const technical = 'NATIONSTAR 2727 / 3535 / 5050, Colorlight LEDVISION V9.7, NovaStar A8s-N, MiP、P2.5、12 V、100-240 V。';
  const raw = [
    'Dear Jane Smith,', '王女士您好，张工您好。', '联系人：李晓梅',
    'alice+quote@customer.example 或 sales@client.test',
    'WhatsApp: +44 20 7946 0958；电话：+1 (415) 555-0123；13800138000。',
    'https://customer.example/project?contact=alice，client.test/path 和 www.other-client.com。',
    '客户公司：光明贸易有限公司。', `Company: Meadow Optics Inc. ${technical}`,
    'Best regards,', 'Alice Johnson', 'Northfield Displays Ltd.',
  ].join('\n');
  const result = redactPitch(raw);
  assert.deepEqual(Object.fromEntries(result.redactions.map(({ kind, count }) => [kind, count])), {
    url: 3, email: 2, phone: 3, person: 5, company: 3,
  });
  assert.match(result.text, /Dear \[PERSON\],\n\[PERSON\]女士您好，\[PERSON\]工您好。\n联系人：\[PERSON\]/);
  assert.match(result.text, /\[EMAIL\] 或 \[EMAIL\]/);
  assert.match(result.text, /WhatsApp: \[PHONE\]；电话：\[PHONE\]；\[PHONE\]。/);
  assert.match(result.text, /\[URL\]，\[URL\] 和 \[URL\]。/);
  assert.match(result.text, /客户公司：\[COMPANY\]。\n/);
  assert.ok(result.text.includes(`Company: [COMPANY] ${technical}`));
  assert.ok(result.text.endsWith('Best regards,\n[PERSON]\n[COMPANY]'));
  assert.deepEqual(redactPitch(result.text), { text: result.text, redactions: [] });
  assert.equal(normalizePitch('  ＬＥＤ　 P2.5\n怎么选？ '), 'led p2.5 怎么选?');
});

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
  // The planner uses the app clock and excludes future dates; keep fixtures inside the intended window.
  const now=Date.now(),recentAt=new Date(now-60_000).toISOString(),expiredAt=new Date(now-8*86400_000).toISOString();
  for(let n=0;n<5;n++)await material(`aging-${suffix}-${n}`);
  await sql`UPDATE articles SET published_at=${recentAt}`;
  assert.equal((await refreshRecommendations(actor)).created,5);
  const old=(await recommendationOverview()).rows[0];
  await sql`UPDATE studio_recommendations SET document=jsonb_set(document,'{evidence,0,date}',to_jsonb(${expiredAt}::text))`;
  await sql`UPDATE articles SET published_at=${expiredAt}`;
  const aged=await recommendationOverview();assert.equal(aged.activeCount,0);assert.equal(aged.pendingCount,0);assert.equal(aged.rows.length,5);assert.ok(aged.rows.every(c=>c.expired&&!c.capacity_full));
  await assert.rejects(decideRecommendation(old.id,{action:'adopt'},actor),/超过7天/);
  const fresh=await material(`current-${suffix}`);
  await sql`UPDATE articles SET published_at=${recentAt} WHERE id=${fresh}`;
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

import {
  answerEvidence, assembleFragments, calculateFact, evidenceFactQuote, splitPage, validateEditPlan, validateFragment,
  type EditOperation, type Fact, type Subquestion,
} from '@aihot/backend/studio/studio-pitch-fragments';

const pitchNumberQuestion: Subquestion = {
  id: 'q-pixels', zh: '如何估算广告牌像素？', en: 'How many pixels are on the billboard?',
  need: 'reference', answer_shape: 'number', terms: ['billboard', 'pixel pitch', 'P10', 'P10'],
};

test('pitch fragments: evidence needs two distinct terms and an answer in the same verbatim sentence', () => {
  const sentence = 'For the billboard, the P10 pixel pitch is 10 mm.';
  const result = answerEvidence([
    pitchNumberQuestion,
    { id: 'q-permits', zh: '什么时候申请许可？', en: 'When should I apply for a permit?', need: 'reference',
      answer_shape: 'steps', terms: ['billboard', 'permit', 'site survey'] },
  ], [
    { id: 'split', body_text: 'The P10 pixel pitch was discussed. The board uses a 10 mm module.' },
    { id: 'repeated', body_text: 'P10 or P10 is listed at 10 mm.' },
    { id: 'lookalike', body_text: 'The P100 pixel pitch is 100 mm.' },
    { id: 'shared', body_text: 'The billboard pixel pitch is 4 mm.' },
    { id: 'no-unit', body_text: 'The P10 pixel pitch is 10.' },
    { id: 'answer', body_text: 'Background. ' + sentence + ' Check the cabinet next.' },
    { id: 'also', body_text: 'The P10 pixel pitch is 10 mm in this example.' },
    { id: 'not-shown', body_text: 'A second P10 pixel pitch example uses 10 mm.' },
    { id: 'procedure', body_text: 'First, confirm the permit requirements during the site survey.' },
  ]);
  assert.deepEqual(result.by_question['q-pixels'], [
    { article_id: 'answer', quote: sentence, context: { before: 'Background.', after: 'Check the cabinet next.' }, score: 2 },
    { article_id: 'also', quote: 'The P10 pixel pitch is 10 mm in this example.', context: { before: null, after: null }, score: 2 },
  ]);
  assert.equal(result.by_question['q-permits'][0]?.article_id, 'procedure');
  assert.deepEqual(result.weak_material_ids, ['split', 'repeated', 'lookalike', 'shared', 'no-unit']);
});

const pitchStepsQuestion: Subquestion = {
  id: 'q-steps', zh: '选址时要检查什么？', en: 'What should a site review cover?',
  need: 'page', answer_shape: 'steps', terms: ['viewing distance', 'traffic speed'],
};

test('pitch fragments: evidence binds a table row to its column header and quotes only the row', () => {
  const question: Subquestion = {
    id: 'q-table', zh: '箱体尺寸是多少？', en: 'What cabinet sizes are listed?',
    need: 'page', answer_shape: 'table', terms: ['cabinet size', '300 mm'],
  };
  const head = '<thead><tr><th>Cabinet size</th><th>Use case</th></tr></thead>';
  const body_html = '<p>Background.</p><table>' + head
    + '<tr><td><b>300</b>&nbsp;mm</td><td>Indoor &amp; outdoor</td></tr></table><p>Next paragraph.</p>';
  const result = answerEvidence([question], [
    { id: 'answer', body_html },
    { id: 'unbound', body_html: '<table>' + head + '<tr><td></td><td>300 mm</td><td>Indoor</td></tr></table>' },
    { id: 'header-only', body_html: '<table><thead><tr><th>Cabinet size</th><th>300 mm</th></tr></thead>'
      + '<tr><td>Indoor</td><td>Outdoor</td></tr></table>' },
    { id: 'split-rows', body_html: '<table><tr><td>Cabinet size</td><td>Indoor</td></tr>'
      + '<tr><td>300 mm</td><td>Outdoor</td></tr></table>' },
    { id: 'wrong-shape', body_html: '<p>Cabinet size is 300 mm.</p>' },
  ]);
  assert.deepEqual(result.weak_material_ids, ['unbound', 'header-only', 'split-rows', 'wrong-shape']);
  const [hit] = result.by_question[question.id];
  assert.equal(result.by_question[question.id].length, 1);
  assert.equal(hit.article_id, 'answer');
  assert.equal(hit.score, 2);
  assert.deepEqual(hit.context, { before: 'Background.', after: 'Next paragraph.' });
  const location = hit.location;
  assert.ok(location?.kind === 'table_row');
  const column = location.headers.find(header => header.column === 1);
  assert.ok(column);
  assert.equal(column.quote, 'Cabinet size');
  assert.equal(body_html.slice(column.start, column.end), '<th>Cabinet size</th>');
  const row = body_html.slice(location.start, location.end);
  assert.equal(hit.quote, '300 mm\n\nIndoor & outdoor');
  assert.equal(evidenceFactQuote(hit), splitPage('<table>' + row + '</table>')[0].text);
});

test('pitch fragments: evidence requires distinct visible terms within one checklist item', () => {
  const body_html = '<p>Before installation, review:</p><ul><li>Viewing distance &amp; traffic speed</li>'
    + '<li>Other constraints</li></ul>';
  const weak = [
    { id: 'split', body_html: '<p>Review:</p><ul><li>Viewing distance</li><li>Traffic speed</li></ul>',
      body_text: 'Review viewing distance and traffic speed.' },
    { id: 'nested', body_html: '<p>Review:</p><ul><li>Viewing distance<ul><li>Traffic speed</li></ul></li></ul>' },
    { id: 'script', body_html: '<ul><li>Review viewing distance <script>traffic speed</script>.</li></ul>' },
    { id: 'hidden', body_html: '<ul><li>Review viewing distance <span hidden>traffic speed</span>.</li></ul>' },
    { id: 'passive', body_html: '<ul><li>Viewing distance and traffic speed received mentions.</li></ul>' },
    { id: 'lead-only', body_html: '<p>Review viewing distance:</p><ul><li>Traffic speed</li></ul>' },
  ];
  const material = { id: 'answer', body_html };
  const result = answerEvidence([pitchStepsQuestion], [material, ...weak]);
  assert.deepEqual(result.weak_material_ids, weak.map(item => item.id));
  assert.equal(result.by_question[pitchStepsQuestion.id].length, 1);
  const [hit] = result.by_question[pitchStepsQuestion.id];
  const location = hit.location;
  assert.ok(location?.kind === 'list_item');
  assert.equal(hit.quote, 'Viewing distance & traffic speed');
  assert.equal(splitPage(body_html.slice(location.start, location.end))[0].text, hit.quote);

  const overlap = { ...pitchStepsQuestion, terms: ['traffic speed', 'speed'] };
  assert.deepEqual(answerEvidence([overlap], [material]).by_question[overlap.id], []);
  const shared = { ...pitchStepsQuestion, id: 'shared', terms: ['traffic speed', 'road width'] };
  assert.deepEqual(answerEvidence([pitchStepsQuestion, shared], [material]).by_question[pitchStepsQuestion.id], []);
});

test('pitch fragments: evidence keeps the complete answer when a fact quote would exceed 300 characters', () => {
  const sentence = 'Review ' + 'supporting constraints '.repeat(16)
    + 'and record viewing distance and traffic speed at 300.25 km/h.';
  const result = answerEvidence([pitchStepsQuestion], [{ id: 'long', body_html: '<p>' + sentence + '</p>' }]);
  const [hit] = result.by_question[pitchStepsQuestion.id];
  assert.ok(sentence.length > 300 && sentence.indexOf('300.25 km/h') > 300);
  assert.equal(hit.quote, sentence);
  assert.equal(evidenceFactQuote(hit), null);
});

test('pitch fragments: splitting and assembly preserve kept HTML bytes, tables and nested containers', () => {
  const old = '\r\n<H2>Size &amp; pitch</H2> \t\n'
    + "<table data-size='48'><tr><td>48&nbsp;ft</td></tr></table>\r\n"
    + "<div class='extractor'><h3>尺寸</h3><p>Original text &copy; unchanged.</p></div>\n"
    + '<p>Survey the site.</p>\n<!-- retained -->\t';
  const paragraphs = splitPage(old);
  assert.deepEqual(paragraphs.map(p => p.id), ['p1', 'p2', 'p3', 'p4']);
  assert.deepEqual(Buffer.from(paragraphs.map(p => p.html).join('')), Buffer.from(old));
  assert.equal(paragraphs[1].text, '48 ft');
  assert.match(paragraphs[2].html, /^<div[^>]+><h3>尺寸<\/h3><p>.*<\/p><\/div>\n$/);
  const plan: EditOperation[] = [
    { op: 'insert_after', paragraph: 'p2', subquestion: pitchNumberQuestion.id, reason: '解释像素' },
    { op: 'keep', paragraph: 'p4' },
    { op: 'keep', paragraph: 'p1' },
    { op: 'revise', paragraph: 'p3', subquestion: pitchNumberQuestion.id, reason: '更新文字' },
    { op: 'keep', paragraph: 'p2' },
  ];
  assert.deepEqual(validateEditPlan(paragraphs, plan, [pitchNumberQuestion], []), []);
  const insert = { op_index: 0, html_en: '<p>Check pitch.</p>', zh_review: '确认间距。', used_facts: [] };
  const revision = { op_index: 3, html_en: '<p>Replacement.</p>', zh_review: '新文字。', used_facts: [] };
  const preview = assembleFragments(paragraphs, plan, [insert, { op_index: 3, status: 'unknown' }]);
  assert.equal(preview.complete, false);
  assert.equal(preview.html_en, paragraphs[0].html + paragraphs[1].html + insert.html_en + paragraphs[2].html + paragraphs[3].html);
  assert.equal(preview.diff.find(row => row.op_index === 3)?.status, 'unknown');
  const assembled = assembleFragments(paragraphs, plan, [revision, insert]);
  assert.equal(assembled.complete, true);
  assert.equal(assembled.html_en, paragraphs[0].html + paragraphs[1].html + insert.html_en
    + "<div class='extractor'><p>Replacement.</p></div>\n" + paragraphs[3].html);
  assert.deepEqual(assembled.diff.map(row => row.op_index), [2, 4, 0, 3, 1]);
  for (const row of assembled.diff.filter(row => row.op === 'keep')) {
    assert.deepEqual(Buffer.from(row.after), Buffer.from(row.before));
  }
  assert.ok(assembled.html_en.includes(paragraphs[1].html));
});

test('pitch fragments: calculated pixels are floored per side and numeric claims need their used facts in both languages', () => {
  const { result, fact } = calculateFact('pixels', { width_ft: 48, height_ft: 14, pitch_mm: 10 });
  assert.deepEqual(result, { width_px: 1463, height_px: 426 });
  assert.deepEqual(fact.calculation, {
    fn: 'pixels', inputs: { width_ft: 48, height_ft: 14, pitch_mm: 10 },
    formula: 'floor(side_ft * 304.8 / pitch_mm) for each side', result,
  });
  assert.equal(calculateFact('feet_to_meters', { feet: 1 }).result.meters, 0.3048);
  const ratio = calculateFact('aspect_ratio', { width: 1920, height: 1080 });
  assert.equal(ratio.result.ratio, 16 / 9);
  assert.throws(() => calculateFact('pixels', { width_ft: 48, height_ft: 14, pitch_mm: 0 }), /pitch_mm/);
  const op: EditOperation = { op: 'insert_after', paragraph: 'p1', facts: [fact.id, ratio.fact.id] };
  const accepted = {
    html_en: '<h2>9. Mathematical example</h2><p><a href="https://example.org/spec/999">The 48 × 14 ft example</a> at P10 yields 1,463 × 426 px, compared with 16:9.</p>',
    zh_review: '<h2>第 8 章：计算示例</h2><p>约 14.63 × 4.27 米，像素间距 10 毫米，像素数为 1463 × 426 像素。对比 16:9。</p>',
    used_facts: [fact.id, ratio.fact.id],
  };
  const paragraphs = splitPage('<p>The existing page states 77 kg.</p>');
  assert.deepEqual(validateFragment(op, accepted, [fact, ratio.fact], paragraphs), []);
  const formatted = {
    html_en: '<h2>7. Example</h2><table><tr><th colspan="29">Width</th></tr></table><ol start="88"><li value="90">Check pitch.</li></ol>',
    zh_review: '<h3>第 6 节：示例</h3><table><tr><td rowspan="23">确认间距。</td></tr></table>',
    used_facts: [],
  };
  assert.deepEqual(validateFragment(op, formatted, [], paragraphs), []);
  const bad = {
    ...accepted, html_en: '<p>At 15 m, 1,463 kg and 4:3 are required.</p>',
    zh_review: '输出宽度是 1464 像素。', used_facts: [fact.id, ratio.fact.id, 'outside'],
  };
  const issues = validateFragment(op, bad, [fact, ratio.fact], paragraphs).join('\n');
  for (const value of ['15 m', '1,463 kg', '4:3', '1464 像素', 'outside']) assert.ok(issues.includes(value), issues);
  assert.match(validateFragment(op, { ...accepted, used_facts: [fact.id] }, [fact, ratio.fact], paragraphs).join('\n'), /16:9/u);
  const plan: EditOperation[] = [{ op: 'keep', paragraph: 'p1' }, op];
  const assembled = assembleFragments(paragraphs, plan, [{ op_index: 1, ...accepted }]);
  assert.equal(assembled.html_en, paragraphs[0].html + accepted.html_en);
  assert.match(assembled.html_en, /77 kg/u);
});

test('pitch fragments: reject incomplete plans, excessive changes and unsafe or oversized fragments', () => {
  const paragraphs = splitPage('<p>Keep this.</p>'.repeat(4));
  const facts: Fact[] = Array.from({ length: 7 }, (_, index) => ({
    id: 'f' + index, kind: 'page', statement: 'Keep this.', quote: 'Keep this.', attribution: 'Old page',
  }));
  const plan: EditOperation[] = [
    { op: 'revise', paragraph: 'p1', subquestion: pitchNumberQuestion.id, reason: '需要补充', facts: facts.map(f => f.id) },
    { op: 'revise', paragraph: 'p2', facts: ['missing'] },
    { op: 'keep', paragraph: 'p2' },
    { op: 'insert_after', paragraph: 'p3', subquestion: pitchNumberQuestion.id, reason: '需要补充' },
  ];
  const errors = validateEditPlan(paragraphs, plan, [pitchNumberQuestion], facts).join('\n');
  for (const value of ['6 条', '30%', '只能有一次', 'p3：缺少', 'p4：缺少', '买家子问题', '理由', 'missing']) {
    assert.ok(errors.includes(value), errors);
  }
  const unsafe = { html_en: '<p><a href="jav&#x61;script:alert(1)">Unsafe</a></p>', zh_review: '审校文字。', used_facts: [] };
  assert.match(validateFragment(plan[3], unsafe, facts, paragraphs).join('\n'), /不安全/u);
  const oversized = { html_en: '<p>' + 'word '.repeat(251) + '</p>', zh_review: '审校文字。', used_facts: [] };
  assert.match(validateFragment(plan[3], oversized, facts, paragraphs).join('\n'), /250 英文词/u);
  assert.match(validateFragment(plan[0], oversized, facts, paragraphs).join('\n'), /2 倍/u);
});

test('pitch fragments: a new page inserts at start in plan order', () => {
  const first = { html_en: '<h2>First topic</h2>', zh_review: '第一个主题', used_facts: [], op_index: 0 };
  const second = { html_en: '<h2>Second topic</h2>', zh_review: '第二个主题', used_facts: [], op_index: 1 };
  const plan: EditOperation[] = ['First topic', 'Second topic'].map(heading => ({
    op: 'insert_after', paragraph: 'start', subquestion: pitchNumberQuestion.id, reason: '回答买家问题', heading,
  }));
  assert.deepEqual(validateEditPlan([], plan, [pitchNumberQuestion], []), []);
  const result = assembleFragments([], plan, [second, first]);
  assert.equal(result.html_en, first.html_en + second.html_en);
  assert.equal(result.complete, true);
  assert.deepEqual(result.diff.map(({ op_index }) => op_index), [0, 1]);
});
