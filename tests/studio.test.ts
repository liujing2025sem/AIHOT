import { tag, stub } from './setup.ts';
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
import { createStudioTask, exportStudioTask, receiveStudioTask, generateStudioTask, studioDraft, saveStudioDraft, reviewStudioDraft, exportStudioDraft } from '@aihot/backend/admin/studio';
import { updateChannel } from '@aihot/backend/providers/channel';
const suffix=tag(),source=`studio-${suffix}`,article=`studio-item-${suffix}`,actor='test:studio';
const original={password:config.adminPassword,dev:config.devAdmin};
const app=Fastify({logger:false});registerAdminStudio(app);
before(async()=>{config.adminPassword='studio-test-admin-long-password';config.devAdmin=null;
 await sql`INSERT INTO sources(id,name,kind,enabled) VALUES (${source},'LED source','web_list',false)`;
 await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at,body_status,body_text) VALUES (${article},${source},${article},${`https://example.com/${article}`},'LED driver launch',now(),now(),'ok','At full 64-scan, the stated refresh rate is 15360 Hz. Samples are expected in Q4.')`;
});
after(async()=>{await app.close();config.adminPassword=original.password;config.devAdmin=original.dev;await closeDb()});
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
