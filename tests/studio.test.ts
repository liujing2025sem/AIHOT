import { tag, stub, gate } from './setup.ts';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import Fastify from 'fastify';
import { sql, closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { passwordLogin, SESSION_COOKIE, sessionPrincipal } from '@aihot/backend/admin/auth';
import { registerAdminStudio } from '../apps/api/src/routes/admin-studio.ts';
import { createStudioTask, exportStudioTask, receiveStudioTask, generateStudioTask, studioDraft, saveStudioDraft, reviewStudioDraft, exportStudioDraft, extractStudioMaterial, studioMaterial, studioOverview } from '@aihot/backend/admin/studio';
import { updateChannel } from '@aihot/backend/providers/channel';
import { upsertMaterial } from '@aihot/backend/content/materials';
const suffix=tag(),source=`studio-${suffix}`,article=`studio-item-${suffix}`,actor='test:studio';
const original={password:config.adminPassword,dev:config.devAdmin,privateNetwork:config.allowPrivateNetworkFetch};
const repairSource=`studio-repair-${suffix}`;
const repairText='The LED manufacturer describes the driver operating conditions and the sample schedule. '.repeat(8);
let pageStatus=200,pageDate='2020-06-17',pageBody=repairText;
let pageGate: { entered: ReturnType<typeof gate<void>>; release: ReturnType<typeof gate<void>> } | null = null;
const materialPage=http.createServer(async(_req,res)=>{
 const hold=pageGate;if(hold){hold.entered.open();await hold.release.promise;}
 res.writeHead(pageStatus,{'content-type':'text/html'});
 res.end(`<html><head><title>LED original</title><meta property="article:published_time" content="2019-01-01"></head><body><article><h1>LED original</h1><div class="news-date">${pageDate}</div><p>${pageBody}</p></article></body></html>`);
});
await new Promise<void>(resolve=>materialPage.listen(0,'127.0.0.1',resolve));
const materialBase=`http://127.0.0.1:${(materialPage.address() as {port:number}).port}`;
const app=Fastify({logger:false});registerAdminStudio(app);
before(async()=>{config.adminPassword='studio-test-admin-long-password';config.devAdmin=null;config.allowPrivateNetworkFetch=true;
 await sql`INSERT INTO sources(id,name,kind,enabled) VALUES (${source},'LED source','web_list',false)`;
 await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at,body_status,body_text) VALUES (${article},${source},${article},${`https://example.com/${article}`},'LED driver launch',now(),now(),'ok','At full 64-scan, the stated refresh rate is 15360 Hz. Samples are expected in Q4.')`;
 await sql`INSERT INTO sources(id,name,kind,enabled,config) VALUES (${repairSource},'Manufacturer repair','web_list',false,${sql.json({url:materialBase,detail:{publishedAtSelector:'.news-date',publishedAtAuthoritative:true}})})`;
});
after(async()=>{await app.close();await new Promise<void>(resolve=>materialPage.close(()=>resolve()));config.adminPassword=original.password;config.devAdmin=original.dev;config.allowPrivateNetworkFetch=original.privateNetwork;await closeDb()});
async function input(){const task=await createStudioTask({article_ids:[article]},actor);const pack=(await exportStudioTask(task.id))!;const a=pack.request.articles[0];return {task,pack,response:{task_id:task.id,run_id:`run-${suffix}`,producer:{agent_id:'test-agent',model:null,input_files:['request.json']},decisions:[{article_id:article,decision:'KEEP',reason_zh:'直接涉及LED驱动器'}],drafts:[{source:a.binding,title_zh:'LED驱动器样品计划',review_zh:'厂商表示将于第四季度送样，刷新率须保留扫描条件。',title_en:'LED driver sample plan',body_en:`Samples are expected in Q4. Source: ${a.binding.url}`,evidence:[{claim:'送样尚未完成',quote:'Samples are expected in Q4.'}],questions_zh:['核实当前送样阶段'],keyword_hypothesis:'LED display driver',meta_description_en:'Driver sample timing and scan conditions.'}]}}}
test('admin session and CSRF protect workspace and all mutations',async()=>{
 assert.equal((await app.inject('/api/admin/studio')).statusCode,401);
 const {token}=await passwordLogin(config.adminPassword!,'/admin','test');const cookie=`${SESSION_COOKIE}=${token}`,p=(await sessionPrincipal(cookie))!;
 assert.equal((await app.inject({method:'POST',url:'/api/admin/studio/tasks',headers:{cookie},payload:{article_ids:[article]}})).statusCode,403);
 const res=await app.inject({method:'POST',url:'/api/admin/studio/tasks',headers:{cookie,'x-csrf-token':p.csrf},payload:{article_ids:[article]}});assert.equal(res.statusCode,200,res.body);
});
test('handoff returns actual source and embedded writing rules; bodyless sources cannot be selected',async()=>{
 const {pack}=await input();assert.match(pack.files['WRITING_RULES.md'],/型号|参数/);assert.equal(pack.request.articles[0].body_text?.includes('64-scan'),true);
 await assert.rejects(createStudioTask({article_ids:['missing']},actor),/不存在/);
});
test('receive, edit, review and export persist; duplicate receives do not overwrite human changes',async()=>{
 const {task,response}=await input();await receiveStudioTask(task.id,response,actor);
 const [row]=await sql`SELECT id FROM studio_drafts WHERE task_id=${task.id}`;let d=(await studioDraft(row.id))!;
 await assert.rejects(exportStudioDraft(d.id,'md'),/审稿/);
 const edit={...response.drafts[0],version:d.version,title_zh:'人工改过的标题'};await saveStudioDraft(d.id,edit,actor);
 await receiveStudioTask(task.id,response,actor);d=(await studioDraft(row.id))!;assert.equal(d.document.title_zh,'人工改过的标题');
 await assert.rejects(saveStudioDraft(d.id,edit,actor),/已被修改/);
 await assert.rejects(reviewStudioDraft(d.id,{version:d.version,action:'approve'},actor),/先提交/);
 await reviewStudioDraft(d.id,{version:d.version,action:'submit'},actor);d=(await studioDraft(row.id))!;
 await reviewStudioDraft(d.id,{version:d.version,action:'approve',note:'已核对原文'},actor);d=(await studioDraft(row.id))!;
 assert.equal(d.status,'approved');assert.match((await exportStudioDraft(d.id,'html'))!.body,/人工改过/);
 await saveStudioDraft(d.id,{...edit,version:d.version,title_zh:'再次修改'},actor);assert.equal((await studioDraft(d.id))!.status,'draft');await assert.rejects(exportStudioDraft(d.id,'md'),/审稿/);
});
test('source revision drift rejects imported results; no partial drafts are inserted',async()=>{
 const {task,response}=await input();await sql`UPDATE articles SET revision=revision+1 WHERE id=${article}`;
 await assert.rejects(receiveStudioTask(task.id,response,actor),/原文已更新/);assert.equal((await sql`SELECT count(*)::int AS n FROM studio_drafts WHERE task_id=${task.id}`)[0].n,0);
});
test('API generation really calls the configured endpoint, stores drafts and reuses the completed task',async()=>{
 const {task,response}=await input();let calls=0;
 const provider=await stub(()=>{calls++;return {model:'fake-flash',choices:[{message:{content:JSON.stringify(response)}}]};});
 const oldDir=config.credentialsDir,oldEnabled=config.modelCallsEnabled;
 const dir=await mkdtemp(path.join(tmpdir(),'studio-channel-'));
 try{config.credentialsDir=dir;config.modelCallsEnabled=true;
  await updateChannel('custom',{baseUrl:provider.url+'/v1',model:'fake-flash',key:'synthetic-private-key',activate:true,reason:'workspace test'},actor);
  const result=await generateStudioTask(task.id,actor);assert.ok(result&&'receiptId' in result);assert.equal(calls,1);
  await generateStudioTask(task.id,actor);assert.equal(calls,1);
  assert.equal((await sql`SELECT count(*)::int AS n FROM studio_drafts WHERE task_id=${task.id}`)[0].n,1);
 }finally{config.credentialsDir=oldDir;config.modelCallsEnabled=oldEnabled;await provider.close();await rm(dir,{recursive:true,force:true});}
});

async function repairMaterial(bodyText?: string) {
 pageStatus=200;pageDate='2020-06-17';pageBody=repairText;pageGate=null;
 return upsertMaterial({sourceId:repairSource,url:`${materialBase}/${tag()}`,title:'LED original',via:'fetch',...(bodyText?{bodyText}:{})});
}
test('manual repair uses the source date rule and persists body, precise date and result together',async()=>{
 const {articleId}=await repairMaterial();
 const result=(await extractStudioMaterial(articleId,actor))!;
 assert.equal(result.state,'ok');assert.deepEqual(result.changes,{body:true,date:true});
 assert.equal(result.material!.publication_time,'2020-06-17');
 assert.equal(new Date(result.material!.published_at).toISOString(),'2020-06-16T16:00:00.000Z');
 assert.match(result.material!.body_text,/LED manufacturer/);
 assert.equal(result.material!.last_extraction.state,'ok');
 const overview=await studioOverview({source:repairSource,quality:''});
 assert.equal(overview.rows.find(a=>a.id===articleId)!.last_extraction.state,'ok');
 const revision=result.material!.revision;
 assert.equal((await extractStudioMaterial(articleId,actor))!.state,'skipped');
 assert.equal((await studioMaterial(articleId))!.revision,revision);
});
test('date-only repair preserves a readable body and invalidates an older handoff version',async()=>{
 const originalBody='The existing source text remains unchanged during date repair.';
 const {articleId}=await repairMaterial(originalBody);
 const previous=(await studioMaterial(articleId))!;
 const result=(await extractStudioMaterial(articleId,actor))!;
 assert.deepEqual(result.changes,{body:false,date:true});assert.equal(result.material!.body_text,originalBody);
 assert.equal(result.material!.revision,previous.revision+1);
});
test('a failed fetch remains a failure in the workspace without damaging stored content',async()=>{
 const {articleId}=await repairMaterial('Existing readable source remains safe.');pageStatus=503;
 const before=(await studioMaterial(articleId))!;
 const result=(await extractStudioMaterial(articleId,actor))!;
 assert.equal(result.state,'failed');assert.match(result.notice,/503/);
 assert.equal(result.material!.body_text,before.body_text);assert.equal(result.material!.revision,before.revision);
 assert.equal(result.material!.last_extraction.state,'failed');assert.equal(result.material!.published_at,null);
});
test('a date without readable body is partial; a later retry fills only the missing body',async()=>{
 const {articleId}=await repairMaterial();pageBody='Too short to be a full source.';
 const first=(await extractStudioMaterial(articleId,actor))!;
 assert.equal(first.state,'partial');assert.deepEqual(first.changes,{body:false,date:true});
 assert.equal(first.material!.body_status,'unconfirmed');
 pageBody=repairText;pageDate='2021-02-02';
 const second=(await extractStudioMaterial(articleId,actor))!;
 assert.equal(second.state,'ok');assert.deepEqual(second.changes,{body:true,date:false});
 assert.equal(second.material!.publication_time,'2020-06-17','a repair must not replace a known original publication date');
});
test('a repair fetched against an older revision cannot overwrite newer original material',async()=>{
 const {articleId}=await repairMaterial();
 const hold={entered:gate<void>(),release:gate<void>()};pageGate=hold;
 const pending=extractStudioMaterial(articleId,actor);await hold.entered.promise;
 try {await sql`UPDATE articles SET title='Newer source title',revision=revision+1 WHERE id=${articleId}`;}
 finally {hold.release.open();}
 const result=(await pending)!;
 assert.equal(result.state,'conflict');assert.equal(result.material!.title,'Newer source title');
 assert.equal(result.material!.body_text,null);assert.equal(result.material!.published_at,null);pageGate=null;
});
