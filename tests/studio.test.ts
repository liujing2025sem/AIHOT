import { tag, stub, gate, Reply } from './setup.ts';
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
import { createStudioTask, exportStudioTask, receiveStudioTask, generateStudioTask, studioGenerationStatus, studioDraft, saveStudioDraft, applyStudioReviewEdit, reviewStudioDraft, exportStudioDraft, extractStudioMaterial, studioMaterial, studioOverview } from '@aihot/backend/studio/studio';
import { studioReviewMetrics, recordStudioReview, setStudioReviewPolicy } from '@aihot/backend/studio/studio-review';
import { updateChannel } from '@aihot/backend/providers/channel';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { previewPitch, createPitch, getPitch, preparePitch, confirmPitch, confirmedPitch } from '@aihot/backend/studio/studio-pitch';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { pitchDraftFindings } from '@aihot/backend/studio/studio-company-facts';
import {generatePitchFragments,preparePitchV2} from '@aihot/backend/studio/studio-pitch-v2';
import {ReceiptUnknownError} from '@aihot/backend/providers/receipts';
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
after(async()=>{await app.close();await new Promise<void>(resolve=>materialPage.close(()=>resolve()));config.adminPassword=original.password;config.devAdmin=original.dev;config.allowPrivateNetworkFetch=original.privateNetwork;await stopBoss();await closeDb()});
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
 await reviewStudioDraft(d.id,{version:d.version,action:'approve',english_reviewed:true,note:'已核对原文',confirmations:d.issues.items.filter(i=>i.confirmable).map(i=>({issueId:i.id,fingerprint:i.fingerprint}))},actor);d=(await studioDraft(row.id))!;
 assert.equal(d.status,'approved');assert.match((await exportStudioDraft(d.id,'html'))!.body,/LED driver sample plan/);assert.doesNotMatch((await exportStudioDraft(d.id,'html'))!.body,/人工改过/);assert.match((await exportStudioDraft(d.id,'review'))!.body,/人工改过/);
 await saveStudioDraft(d.id,{...edit,version:d.version,title_zh:'再次修改'},actor);assert.equal((await studioDraft(d.id))!.status,'draft');await assert.rejects(exportStudioDraft(d.id,'md'),/审稿/);
});
test('source revision drift rejects imported results; no partial drafts are inserted',async()=>{
 const {task,response}=await input();await sql`UPDATE articles SET revision=revision+1 WHERE id=${article}`;
 await assert.rejects(receiveStudioTask(task.id,response,actor),/原文已更新/);assert.equal((await sql`SELECT count(*)::int AS n FROM studio_drafts WHERE task_id=${task.id}`)[0].n,0);
});
test('private draft progress and partial confirmations persist with BLOCKs; adopt edits never approve or publish',async()=>{
 const {task,response}=await input();await receiveStudioTask(task.id,response,actor);
 const [row]=await sql`SELECT id FROM studio_drafts WHERE task_id=${task.id}`;
 let d=(await studioDraft(row.id))!;
 const body=`Our screen reaches 9000 nits.\n\nOur product is the best.\n\nThe installation guide explains cabinet layout and service access for buyers.\n\nSource: ${d.document.source.url}`;
 await saveStudioDraft(d.id,{...response.drafts[0],version:d.version,body_en:body,review_zh:'我们的屏幕达到9000 nits。'},actor);
 d=(await studioDraft(d.id))!;
 assert.equal(d.document.body_en,body);assert.equal(d.gate.blocked,true);assert.equal(d.status,'draft');
 assert.equal(d.review_sync?.status,'stale');
 const confirmations=d.issues.items.filter(i=>i.confirmable).slice(0,1).map(i=>({issueId:i.id,fingerprint:i.fingerprint}));
 await reviewStudioDraft(d.id,{version:d.version,action:'confirm',confirmations},actor);
 d=(await studioDraft(d.id))!;assert.equal(d.confirmed_issues.length,confirmations.length);
 await reviewStudioDraft(d.id,{version:d.version,action:'submit'},actor);d=(await studioDraft(d.id))!;
 await assert.rejects(reviewStudioDraft(d.id,{version:d.version,action:'approve',english_reviewed:true},actor),/否决项/);
 const suggestion=d.suggestions.find(s=>d.issues.items.find(i=>i.id===s.issueId)?.ruleId==='D1')!;
 assert.ok(suggestion);
 await assert.rejects(applyStudioReviewEdit(d.id,{version:d.version,issueId:suggestion.issueId,fingerprint:'changed',suggestionId:suggestion.id},actor),/版本不一致/);
 await applyStudioReviewEdit(d.id,{version:d.version,issueId:suggestion.issueId,fingerprint:suggestion.fingerprint,suggestionId:suggestion.id},actor);
 const before=d;d=(await studioDraft(d.id))!;
 assert.doesNotMatch(d.document.body_en,/9000 nits/);assert.match(d.document.body_en,/Our product is the best/);
 assert.equal(d.document.review_zh,before.document.review_zh);assert.equal(d.review_sync?.status,'stale');
 assert.equal(d.status,'draft');assert.equal(d.gate.blocked,true);assert.equal(d.confirmed_issues.length,0);
 await assert.rejects(exportStudioDraft(d.id,'html'),/审稿/);
 await assert.rejects(applyStudioReviewEdit(d.id,{version:before.version,issueId:suggestion.issueId,fingerprint:suggestion.fingerprint,suggestionId:suggestion.id},actor),/版本已更新/);
 assert.equal((await sql`SELECT count(*)::int AS n FROM audit_log WHERE subject=${`studio-draft:${d.id}`} AND action IN ('studio.draft.wordpress','studio.draft.publish')`)[0].n,0);
 await saveStudioDraft(d.id,{...response.drafts[0],version:d.version,review_zh:d.document.review_zh},actor);
 d=(await studioDraft(d.id))!;await reviewStudioDraft(d.id,{version:d.version,action:'submit'},actor);d=(await studioDraft(d.id))!;
 const all=d.issues.items.filter(i=>i.confirmable).map(i=>({issueId:i.id,fingerprint:i.fingerprint}));
 await assert.rejects(reviewStudioDraft(d.id,{version:d.version,action:'approve',confirmations:all},actor),/当前英文主稿/);
 await reviewStudioDraft(d.id,{version:d.version,action:'approve',english_reviewed:true,confirmations:all},actor);
 assert.match((await exportStudioDraft(d.id,'md'))!.body,/Samples are expected/);
});
test('incomplete source links and English edits can be saved privately but cannot be approved',async()=>{
 const {task,response}=await input();await receiveStudioTask(task.id,response,actor);
 const [row]=await sql`SELECT id FROM studio_drafts WHERE task_id=${task.id}`;
 let d=(await studioDraft(row.id))!;
 await saveStudioDraft(d.id,{...response.drafts[0],version:d.version,body_en:'The cabinet layout still needs a source link. 待翻译'},actor);
 d=(await studioDraft(d.id))!;
 assert.equal(d.document.body_en,'The cabinet layout still needs a source link. 待翻译');
 assert.ok(d.gate.findings.some(f=>f.severity==='BLOCK'&&f.reason.includes('原文链接')));
 assert.ok(d.gate.findings.some(f=>f.severity==='BLOCK'&&f.reason.includes('含中文')));
 await reviewStudioDraft(d.id,{version:d.version,action:'submit'},actor);d=(await studioDraft(d.id))!;
 await assert.rejects(reviewStudioDraft(d.id,{version:d.version,action:'approve',english_reviewed:true},actor),/否决项/);
 await assert.rejects(exportStudioDraft(d.id,'html'),/审稿/);
});
test('WordPress push only writes approved English to one draft, with safe recovery',async t=>{
 const env=process.env;
 const keyValues={WP_BASE_URL:'https://wp.invalid/subsite/',WP_USER:'studio-fixture',WP_APP_PASSWORD:'synthetic-wp-secret',
   WP_GUIDE_CATEGORY_SLUG:'choose-guides',WP_FEATURED_MEDIA_COMPONENTS_CONTROL:'91'};
 Object.assign(env,keyValues);
 delete env.WP_DRAFT_PUSH_ENABLED;
 t.after(()=>{for(const key of Object.keys(keyValues))delete env[key];env.WP_DRAFT_PUSH_ENABLED='false';});
 const {token}=await passwordLogin(config.adminPassword!,'/admin','wordpress-test');
 const cookie=`${SESSION_COOKIE}=${token}`, csrf=(await sessionPrincipal(cookie))!.csrf;
 async function fixture(){
   const {task,response}=await input();
   await receiveStudioTask(task.id,response,actor);
   const [row]=await sql`SELECT id FROM studio_drafts WHERE task_id=${task.id}`;
   const draft=(await studioDraft(row.id))!;
   return {draft,edit:response.drafts[0]};
 }
 async function approve(id:string,version:number){
   await reviewStudioDraft(id,{version,action:'submit'},actor);
   const current=(await studioDraft(id))!;
   const result=await reviewStudioDraft(id,{version:current.version,action:'approve',english_reviewed:true,confirmations:current.issues.items.filter(i=>i.confirmable).map(i=>({issueId:i.id,fingerprint:i.fingerprint}))},actor);
   return result!.version;
 }
 const push=(id:string,version:number,kind='guide',section='components-ics',withCsrf=true)=>
   app.inject({method:'POST',url:`/api/admin/studio/drafts/${id}/wordpress`,headers:{cookie,...(withCsrf?{'x-csrf-token':csrf}:{})},payload:{version,kind,section}});
 const detail=(id:string)=>app.inject({url:`/api/admin/studio/drafts/${id}`,headers:{cookie}});
 type Post={id:number;slug:string;status:string;categories:number[];tags:number[];featured_media:number};
 type Write={id:number|null;title:string;content:string;status:string;slug?:string;categories:number[];tags:number[];featured_media?:number};
 const unrelated:Post={id:999,slug:'unrelated-latest-post',status:'draft',categories:[29],tags:[],featured_media:0};
 const posts=new Map<number,Post>([[unrelated.id,unrelated]]);
 const writes:Write[]=[];
 let nextId=100, shortReady=false, mode:'ok'|'fail'|'disconnect'='ok', mismatchedRead=false, redirect=false;
 const wp=await stub((_hit,req)=>{
   const url=new URL(req.url,'http://loopback.invalid'), slug=url.searchParams.get('slug');
   if(url.pathname.endsWith('/categories'))return slug==='choose-guides'?[{id:29,slug}]:shortReady&&slug==='industry-news'?[{id:72,slug}]:[];
   if(url.pathname.endsWith('/tags'))return slug==='consumer-display'?[{id:12,slug}]:[];
   const match=/\/posts\/(\d+)$/.exec(url.pathname), id=match?Number(match[1]):null;
   if(!req.body){
     if(id===null)return [...posts.values()]; // The site may ignore filters and return unrelated recent posts first.
     return mismatchedRead?unrelated:posts.get(id)??new Reply(404,{code:'rest_post_invalid_id'});
   }
   const data=JSON.parse(req.body);
   writes.push({id,...data});
   if(mode==='fail')return new Reply(503,{message:'synthetic-wp-secret'});
   const post:Post={id:id??nextId++,slug:data.slug??posts.get(id!)?.slug,status:data.status,categories:data.categories,tags:data.tags,featured_media:data.featured_media??0};
   posts.set(post.id,post);
   return post;
 });
 t.after(()=>wp.close());
 const localFetch=globalThis.fetch;
 const calls:{url:string;init?:RequestInit}[]=[];
 t.mock.method(globalThis,'fetch',async (input: URL | string | Request,init?:RequestInit)=>{
   const url=new URL(input instanceof Request?input.url:input);
   calls.push({url:url.href,init});
   if(url.origin!=='https://wp.invalid')throw new Error('Unexpected request in WordPress test');
   if(redirect)return Response.redirect('https://other.invalid/wp-json/',302);
   const response=await localFetch(wp.url+url.pathname+url.search,init);
   if(mode==='disconnect'&&init?.method==='POST'&&init?.body){
     await response.text(); // Remote committed but the acknowledgement never reached Studio.
     throw new Error('synthetic-wp-secret');
   }
   return response;
 });

 const {draft,edit}=await fixture(), id=draft.id;
 assert.match((await push(id,draft.version)).json().detail,/尚未开启/);
 assert.equal((await detail(id)).json().wordpress.ready,false);
 env.WP_DRAFT_PUSH_ENABLED='true';
 assert.equal((await push(id,draft.version,'guide','components-ics',false)).statusCode,403);
 assert.match((await push(id,draft.version)).json().detail,/审稿/);
 assert.equal(calls.length,0);
 const version=await approve(id,draft.version);
 env.WP_BASE_URL='http://wp.invalid/subsite/';
 assert.match((await push(id,version)).json().detail,/HTTPS/);
 assert.equal(calls.length,0);
 env.WP_BASE_URL=keyValues.WP_BASE_URL;
 env.WP_GUIDE_CATEGORY_SLUG='company-news';
 assert.match((await push(id,version)).json().detail,/不会使用 Company News/);
 assert.equal(calls.length,0);
 env.WP_GUIDE_CATEGORY_SLUG=keyValues.WP_GUIDE_CATEGORY_SLUG;
 assert.match((await push(id,version,'brief')).json().detail,/industry-news/);
 assert.equal(writes.length,0);
 redirect=true;
 const beforeRedirect=calls.length;
 assert.match((await push(id,version)).json().detail,/HTTP 302/);
 assert.equal(calls.length,beforeRedirect+1);
 redirect=false;

 const [first,second]=await Promise.all([push(id,version),push(id,version)]);
 assert.ok([first,second].some(res=>res.statusCode===200&&res.json().state==='pushed'));
 assert.equal(writes.filter(write=>write.id===null).length,1);
 const saved=(await detail(id)).json().wordpress.receipt;
 assert.equal(saved.state,'pushed');assert.equal(saved.postId,100);assert.equal(saved.media,'set');
 assert.equal(saved.editUrl,'https://wp.invalid/subsite/wp-admin/post.php?post=100&action=edit');
 assert.equal(saved.metaDescription,'Driver sample timing and scan conditions.');
 assert.equal((await push(id,version,'guide','control-software')).json().postId,100);
 assert.deepEqual(writes[0]?.categories,[29]);
 assert.equal(writes.at(-1)?.id,100);assert.equal(writes.at(-1)?.featured_media,91);
 assert.match(writes[0]!.content,/Original source date/);
 assert.doesNotMatch(writes[0]!.content,/厂商/);
 assert.equal('meta' in writes[0]!,false);
 assert.equal('slug' in writes.at(-1)!,false);
 assert.ok(writes.every(write=>write.status==='draft'));
 const requestCount=writes.length;
 for (const status of ['publish','trash']) {
   posts.get(100)!.status=status;
   assert.equal((await push(id,version)).json().state,'blocked');
   assert.equal(writes.length,requestCount);
 }
 posts.get(100)!.status='draft';
 const changed=await saveStudioDraft(id,{...edit,version,title_en:'Updated LED driver sample plan'},actor);
 assert.match((await push(id,version)).json().detail,/版本已更新/);
 assert.match((await push(id,changed!.version)).json().detail,/审稿/);
 assert.equal(writes.length,requestCount);
 const updatedVersion=await approve(id,changed!.version);
 assert.equal((await push(id,updatedVersion)).json().postId,100);
 assert.equal(writes.at(-1)?.title,'Updated LED driver sample plan');

 const errorDraft=(await fixture()).draft, errorVersion=await approve(errorDraft.id,errorDraft.version);
 mode='fail';
 const failed=await push(errorDraft.id,errorVersion);
 assert.equal(failed.json().state,'unknown');assert.equal(failed.json().httpStatus,503);
 assert.doesNotMatch(failed.body,/synthetic-wp-secret/);
 const afterFailure=writes.length;
 mode='ok';
 assert.equal((await push(errorDraft.id,errorVersion)).json().state,'unknown');
 assert.equal(writes.length,afterFailure);

 const lost=(await fixture()).draft, lostVersion=await approve(lost.id,lost.version);
 mode='disconnect';shortReady=true;
 const lostResponse=(await push(lost.id,lostVersion,'brief','consumer-near-eye')).json();
 assert.equal(lostResponse.state,'unknown');
 assert.equal(writes.at(-1)?.slug,lostResponse.recoveryKey);
 const afterLost=writes.length;
 mode='ok';mismatchedRead=true;
 assert.match((await push(lost.id,lostVersion,'brief','consumer-near-eye')).json().detail,/无法确认/);
 assert.equal(writes.length,afterLost);
 mismatchedRead=false;
 const recovered=(await push(lost.id,lostVersion,'brief','consumer-near-eye')).json();
 assert.equal(recovered.state,'pushed');assert.equal(recovered.postId,101);
 assert.equal(writes.at(-1)?.id,101);assert.deepEqual(writes.at(-1)?.categories,[72]);assert.deepEqual(writes.at(-1)?.tags,[12]);
 assert.match(writes.at(-1)!.content,/class="cs-brief"/);
 assert.equal(recovered.media,'not_configured');
 assert.ok(calls.every(call=>call.url.startsWith('https://wp.invalid/subsite/wp-json/wp/v2/')&&call.init?.redirect==='manual'));
 assert.ok(calls.every(call=>new Headers(call.init?.headers).get('authorization')===`Basic ${Buffer.from('studio-fixture:synthetic-wp-secret').toString('base64')}`));
 const log=await sql`SELECT after FROM audit_log WHERE action='studio.draft.wordpress'`;
 assert.doesNotMatch(JSON.stringify(log),/synthetic-wp-secret|Authorization/);
 const beforeSourceChange=calls.length;
 await sql`UPDATE articles SET revision=revision+1 WHERE id=${article}`;
 try{assert.match((await push(id,updatedVersion)).json().detail,/原文已更新/);assert.equal(calls.length,beforeSourceChange);}
 finally{await sql`UPDATE articles SET revision=revision-1 WHERE id=${article}`;}
});
test('API generation really calls the configured endpoint, stores drafts and reuses the completed task',async()=>{
 const {task,response}=await input();let calls=0;
 const provider=await stub((_hit,req)=>{calls++;assert.equal(req.headers['x-opencode-session'],task.id);assert.equal(req.headers['user-agent'],'chipshow-studio/0.1');assert.equal(JSON.parse(req.body).max_tokens,20000);return {model:'fake-flash',choices:[{message:{content:JSON.stringify(response)}}]};});
 const oldDir=config.credentialsDir,oldEnabled=config.modelCallsEnabled,oldReasoning=process.env.LLM_REASONING_TOKENS;
 process.env.LLM_REASONING_TOKENS='8000';
 const dir=await mkdtemp(path.join(tmpdir(),'studio-channel-'));
 try{config.credentialsDir=dir;config.modelCallsEnabled=true;
  await updateChannel('opencode-go',{key:'synthetic-go-key',activate:true,reason:'independent studio'},actor);
  assert.equal((await studioGenerationStatus()).ready,true);
  await updateChannel('custom',{baseUrl:provider.url+'/v1',model:'fake-flash',key:'synthetic-private-key',activate:true,reason:'workspace test'},actor);
  const result=await generateStudioTask(task.id,actor);assert.ok(result&&'receiptId' in result);assert.equal(calls,1);
  await generateStudioTask(task.id,actor);assert.equal(calls,1);
  assert.equal((await sql`SELECT count(*)::int AS n FROM studio_drafts WHERE task_id=${task.id}`)[0].n,1);
 }finally{if(oldReasoning===undefined)delete process.env.LLM_REASONING_TOKENS;else process.env.LLM_REASONING_TOKENS=oldReasoning;config.credentialsDir=oldDir;config.modelCallsEnabled=oldEnabled;await provider.close();await rm(dir,{recursive:true,force:true});}
});

test('editorial decisions allow zero drafts and only describe the assessed material version',async()=>{
 const {task,response}=await input();
 const skipped={...response,decisions:[{article_id:article,decision:'SKIP',reason_zh:'正文只有重复宣传，没有具体的新变化。'}],drafts:[]};
 await receiveStudioTask(task.id,skipped,actor);
 let overview=await studioOverview({source,quality:''});
 assert.equal(overview.rows.find(a=>a.id===article)!.editorial.decision,'SKIP');
 assert.equal(overview.tasks.find(t=>t.id===task.id)!.drafts,0);
 assert.equal(overview.tasks.find(t=>t.id===task.id)!.decisions[0].reason_zh,skipped.decisions[0].reason_zh);
 await sql`UPDATE articles SET revision=revision+1 WHERE id=${article}`;
 overview=await studioOverview({source,quality:''});
 assert.equal(overview.rows.find(a=>a.id===article)!.editorial,null);
});

test('writing readiness explains missing setup and allows a genuine zero-draft API result',async()=>{
 const {task,response}=await input();
 const dir=await mkdtemp(path.join(tmpdir(),'studio-readiness-'));
 const oldDir=config.credentialsDir,oldEnabled=config.modelCallsEnabled;
 let calls=0;
 const provider=await stub((_hit,req)=>{
  calls++;
  assert.match(JSON.parse(req.body).messages[0].content,/If none qualify, return drafts/);
  return {model:'fake-flash',choices:[{message:{content:JSON.stringify({...response,decisions:[{article_id:article,decision:'HOLD',reason_zh:'需要核对当前送样状态。'}],drafts:[]})}}]};
 });
 try {
  config.credentialsDir=dir;config.modelCallsEnabled=false;
  assert.equal((await studioGenerationStatus()).ready,false);
  await assert.rejects(generateStudioTask(task.id,actor),/尚未开启/);
  assert.equal(calls,0);
  config.modelCallsEnabled=true;
  await updateChannel('custom',{baseUrl:provider.url+'/v1',model:'fake-flash',key:'test-writing-key',activate:true,reason:'readiness test'},actor);
  assert.equal((await studioGenerationStatus()).ready,true);
  const result=await generateStudioTask(task.id,actor);
  assert.ok(result && 'drafts' in result);assert.equal(result.drafts,0);assert.equal(calls,1);
  await generateStudioTask(task.id,actor);assert.equal(calls,1);
  await updateChannel('custom',{deleteKey:true,reason:'missing key test'},actor);
  assert.match((await studioGenerationStatus()).reason,/缺少密钥/);
 } finally {config.credentialsDir=oldDir;config.modelCallsEnabled=oldEnabled;await provider.close();await rm(dir,{recursive:true,force:true});}
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


test('BLOCK stops draft insertion, cannot be approved, and corrected reimport can recover',async()=>{
 const {task,response}=await input();response.drafts[0].title_zh='最好的LED驱动器';
 const blocked=await receiveStudioTask(task.id,response,actor);assert.equal(blocked!.state,'blocked');
 assert.equal((await sql`SELECT count(*)::int AS n FROM studio_drafts WHERE task_id=${task.id}`)[0].n,0);
 assert.equal((await sql`SELECT state FROM studio_tasks WHERE id=${task.id}`)[0].state,'blocked');
 const again=await generateStudioTask(task.id,actor);assert.equal(again!.state,'blocked');
 response.drafts[0].title_zh='LED驱动器样品计划';
 await receiveStudioTask(task.id,response,actor);
 const [row]=await sql`SELECT id FROM studio_drafts WHERE task_id=${task.id}`;let d=(await studioDraft(row.id))!;
 assert.equal(d.gate.blocked,false);assert.ok(d.gate.findings.some(f=>f.severity==='WARN'));
 await reviewStudioDraft(d.id,{version:d.version,action:'submit'},actor);d=(await studioDraft(d.id))!;
 await assert.rejects(reviewStudioDraft(d.id,{version:d.version,action:'approve'},actor),/确认风险/);
 await reviewStudioDraft(d.id,{version:d.version,action:'approve',confirmations:d.issues.items.filter(i=>i.confirmable).map(i=>({issueId:i.id,fingerprint:i.fingerprint}))},actor);
 assert.ok(await exportStudioDraft(d.id,'json'));
});

test('manual observations stay unknown when incomplete, reject premature reduction and retreat on major error',async()=>{
 const {task,response}=await input();await receiveStudioTask(task.id,response,actor);
 const [row]=await sql`SELECT id,version FROM studio_drafts WHERE task_id=${task.id}`;
 const before=await studioReviewMetrics();assert.equal(before.interventionRate,null);
 await assert.rejects(setStudioReviewPolicy({tier:20,backtest_confirmed:true,note:'not enough observed drafts'},actor),/条件/);
 await recordStudioReview(row.id,{version:row.version,substantive:false,categories:['format'],minutes:3,full_review:true,missed_block:false,major_fact_error:false,note:'只改格式，事实未改'},actor);
 const metrics=await studioReviewMetrics();assert.equal(metrics.observedDrafts,before.observedDrafts+1);assert.equal(metrics.interventionRate,null);
 await sql`INSERT INTO audit_log(actor,action,subject,after) VALUES (${actor},'studio.review.policy','studio-review-policy',${sql.json({tier:20,backtest_confirmed:true})})`;
 await recordStudioReview(row.id,{version:row.version,substantive:true,categories:['fact'],minutes:5,full_review:true,missed_block:true,major_fact_error:true,note:'发现重大事实错误'},actor);
 assert.equal((await studioReviewMetrics()).tier,30);
 await assert.rejects(recordStudioReview(row.id,{version:row.version+1,substantive:false,categories:[],minutes:null,full_review:true,missed_block:false,major_fact_error:false,note:'old version'},actor),/版本/);
});


test('CAMOS connected tasks require per-draft supplied rule IDs and persist declared usage separately',async()=>{
 const {task,pack,response}=await input();
 const request={...pack.request,methods:{status:'connected',ruleIds:['expert_knowledge:test-rule'],text:'Method only; no company facts.',provenance:{businessLoaded:false}}};
 await sql`UPDATE studio_tasks SET request=${sql.json(request)} WHERE id=${task.id}`;
 await assert.rejects(receiveStudioTask(task.id,response,actor),/规则ID/);
 const returned={...response,drafts:response.drafts.map(d=>({...d,camos_rule_ids:['expert_knowledge:test-rule']}))};
 await receiveStudioTask(task.id,returned,actor);
 const [row]=await sql`SELECT id FROM studio_drafts WHERE task_id=${task.id}`;const d=await studioDraft(row.id);
 assert.deepEqual((d!.document.camos as any).ruleIds,['expert_knowledge:test-rule']);
 assert.deepEqual((d!.document.camos as any).suppliedRuleIds,['expert_knowledge:test-rule']);
 assert.match((d!.document.camos as any).usageEvidence,/NOT_SEMANTICALLY_VERIFIED/);
});


test('lower review tiers need a new complete sample in the current stage and major errors roll back',async()=>{
 for(let i=0;i<10;i++){const {task,response}=await input();await receiveStudioTask(task.id,response,actor);}
 for(const d of await sql`SELECT id,version FROM studio_drafts`){await recordStudioReview(d.id,{version:d.version,substantive:false,categories:['format'],minutes:1,full_review:true,missed_block:false,major_fact_error:false,note:'test full review reference'},actor);}
 await setStudioReviewPolicy({tier:30,backtest_confirmed:true,note:'reference backtest reviewed'},actor);
 const initialMetrics=await studioReviewMetrics();assert.equal(initialMetrics.eligible20,true,JSON.stringify(initialMetrics));
 await setStudioReviewPolicy({tier:20,backtest_confirmed:true,note:'adopt stage twenty'},actor);
 assert.equal((await studioReviewMetrics()).eligible10,false,'prior-stage observations cannot qualify the next stage');
 let last:any;for(let i=0;i<20;i++){const {task,response}=await input();await receiveStudioTask(task.id,response,actor);[last]=await sql`SELECT id,version FROM studio_drafts WHERE task_id=${task.id}`;await recordStudioReview(last.id,{version:last.version,substantive:false,categories:[],minutes:1,full_review:true,missed_block:false,major_fact_error:false,note:'new stage full review'},actor);}
 assert.equal((await studioReviewMetrics()).eligible10,true);await setStudioReviewPolicy({tier:10,backtest_confirmed:true,note:'adopt stage ten'},actor);
 await recordStudioReview(last.id,{version:last.version,substantive:true,categories:['fact'],minutes:2,full_review:true,missed_block:true,major_fact_error:true,note:'major factual issue'},actor);
 assert.equal((await studioReviewMetrics()).tier,20);
});


test('individual confirmations persist, global confirmation cannot approve, and changed text invalidates them',async()=>{
 const {task,response}=await input();await receiveStudioTask(task.id,response,actor);
 const [row]=await sql`SELECT id FROM studio_drafts WHERE task_id=${task.id}`;
 let d=(await studioDraft(row.id))!;
 assert.ok(d.issues.items.length>0);
 const confirmations=d.issues.items.filter(i=>i.confirmable).map(i=>({issueId:i.id,fingerprint:i.fingerprint}));
 await reviewStudioDraft(d.id,{version:d.version,action:'confirm',confirmations},actor);
 d=(await studioDraft(d.id))!;assert.equal(d.confirmed_issues.length,confirmations.length);
 await reviewStudioDraft(d.id,{version:d.version,action:'submit'},actor);d=(await studioDraft(d.id))!;
 await assert.rejects(reviewStudioDraft(d.id,{version:d.version,action:'approve',confirm_warnings:true,confirm_mandatory:true},actor));
 await reviewStudioDraft(d.id,{version:d.version,action:'approve'},actor);d=(await studioDraft(d.id))!;
 assert.equal(d.status,'approved');
 await saveStudioDraft(d.id,{...response.drafts[0],version:d.version,body_en:response.drafts[0].body_en+' Operating conditions remain to be checked.'},actor);
 d=(await studioDraft(d.id))!;assert.equal(d.confirmed_issues.length,0);
 await reviewStudioDraft(d.id,{version:d.version,action:'submit'},actor);d=(await studioDraft(d.id))!;
 await assert.rejects(reviewStudioDraft(d.id,{version:d.version,action:'approve',confirmations},actor),/失效/);
});

test('public export is English with source/date/status, internal review remains separate',async()=>{
 const {task,response}=await input();const draft={...response.drafts[0],news_status:'unconfirmed' as const,title_zh:'据传驱动器送样计划',review_zh:'据传，厂商表示将于第四季度送样，具体情况尚未证实。',title_en:'Reportedly, a driver sample plan is being discussed',body_en:`Unconfirmed report: the manufacturer says samples are expected in Q4. Source: ${response.drafts[0].source.url}`,meta_description_en:'Unconfirmed report about a driver sample plan.'};response.drafts=[draft];
 await receiveStudioTask(task.id,response,actor);const [row]=await sql`SELECT id FROM studio_drafts WHERE task_id=${task.id}`;
 let d=(await studioDraft(row.id))!;await reviewStudioDraft(d.id,{version:d.version,action:'submit'},actor);d=(await studioDraft(d.id))!;
 await reviewStudioDraft(d.id,{version:d.version,action:'approve',confirmations:d.issues.items.filter(i=>i.confirmable).map(i=>({issueId:i.id,fingerprint:i.fingerprint}))},actor);
 const json=JSON.parse((await exportStudioDraft(d.id,'json'))!.body);assert.equal(json.publication.language,'en');assert.equal(json.publication.placement,'blog');assert.equal(json.publication.news_status,'unconfirmed');assert.equal(json.publication.canonical,null);assert.ok(!('review_zh' in json.publication));assert.match(json.publication.body,/Original source date: not provided/);
 const html=(await exportStudioDraft(d.id,'html'))!.body;assert.match(html,/lang="en"/);assert.match(html,/Unconfirmed report/);assert.doesNotMatch(html,/据传/);
 assert.match((await exportStudioDraft(d.id,'review'))!.body,/据传/);
 try {
  await sql`UPDATE articles SET published_at='2026-10-23T00:00:00Z' WHERE id=${article}`;
  await assert.rejects(exportStudioDraft(d.id,'json'),/原文已更新/);
 } finally { await sql`UPDATE articles SET published_at=NULL WHERE id=${article}`; }
});


test('approval freezes source precision and offset, and legacy approvals must be reviewed again',async()=>{
 const [original]=await sql`SELECT published_at,publication_time FROM articles WHERE id=${article}`;
 const [originalSource]=await sql`SELECT config FROM sources WHERE id=${source}`;
 try {
  await sql`UPDATE articles SET published_at='2026-10-22T16:00:00Z',publication_time='2026-10-23' WHERE id=${article}`;
  const {task,response}=await input();await receiveStudioTask(task.id,response,actor);
  const [row]=await sql`SELECT id FROM studio_drafts WHERE task_id=${task.id}`;
  const approve=async()=>{
   let d=(await studioDraft(row.id))!;
   if(d.status==='approved'){await reviewStudioDraft(d.id,{version:d.version,action:'return',note:'重新核对来源日期'},actor);d=(await studioDraft(row.id))!;}
   await reviewStudioDraft(d.id,{version:d.version,action:'submit'},actor);d=(await studioDraft(row.id))!;
   await reviewStudioDraft(d.id,{version:d.version,action:'approve',confirmations:d.issues.items.filter(i=>i.confirmable).map(i=>({issueId:i.id,fingerprint:i.fingerprint}))},actor);
  };
  await approve();
  assert.match((await exportStudioDraft(row.id,'md'))!.body,/October 23, 2026/);
  // Ingestion can recover precision without changing revision or the stored instant.
  await sql`UPDATE articles SET publication_time='2026-10-22T16:00:00.000Z' WHERE id=${article}`;
  await assert.rejects(exportStudioDraft(row.id,'json'),e=>(e as {code?:string}).code==='conflict'&&/日期精度或时区/.test((e as Error).message));
  await approve();assert.match((await exportStudioDraft(row.id,'md'))!.body,/00:00:00 UTC\+08:00/);
  await sql`UPDATE sources SET config=${sql.json({...originalSource.config,publishedAtUtcOffset:'-04:00'})} WHERE id=${source}`;
  await assert.rejects(exportStudioDraft(row.id,'html'),/日期精度或时区/);
  await approve();assert.match((await exportStudioDraft(row.id,'md'))!.body,/October 22, 2026/);
  // A record from before source-date snapshots cannot borrow today's context silently.
  await sql`UPDATE audit_log SET after=after-'source_date' WHERE subject=${`studio-draft:${row.id}`} AND action='studio.draft.approve'`;
  await assert.rejects(exportStudioDraft(row.id,'json'),/重新审稿/);
  await approve();assert.ok(await exportStudioDraft(row.id,'json'));
 } finally {
  await sql`UPDATE articles SET published_at=${original.published_at},publication_time=${original.publication_time} WHERE id=${article}`;
  await sql`UPDATE sources SET config=${sql.json(originalSource.config)} WHERE id=${source}`;
 }
});

test('export waits for an in-flight revocation and cannot return the previously approved snapshot',async()=>{
 const {task,response}=await input();await receiveStudioTask(task.id,response,actor);
 const [row]=await sql`SELECT id FROM studio_drafts WHERE task_id=${task.id}`;
 let d=(await studioDraft(row.id))!;await reviewStudioDraft(d.id,{version:d.version,action:'submit'},actor);d=(await studioDraft(row.id))!;
 await reviewStudioDraft(d.id,{version:d.version,action:'approve',confirmations:d.issues.items.filter(i=>i.confirmable).map(i=>({issueId:i.id,fingerprint:i.fingerprint}))},actor);
 const locked=gate<void>(),release=gate<void>();
 const writer=sql.begin(async tx=>{
  await tx`UPDATE studio_drafts SET status='draft',version=version+1,reviewed_by=NULL,reviewed_at=NULL WHERE id=${row.id}`;
  locked.open();await release.promise;
 });
 await locked.promise;
 let completed=false;
 const output=exportStudioDraft(row.id,'json').then(value=>({value,error:null}),error=>({value:null,error})).finally(()=>{completed=true;});
 try {
  let blocked=false;
  for(let i=0;i<200&&!completed;i++){
   const waiting=await sql`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM studio_drafts WHERE id=%FOR SHARE%'`;
   if(waiting.length){blocked=true;break;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(blocked,true,'export must wait for the writer transaction instead of reading the old approval');
 } finally {release.open();await writer;}
 const result=await output;assert.ok(result.error);assert.match(result.error.message,/审稿/);
});

test('Chinese text is rejected at receive; private English edits persist but approval and export stay blocked',async()=>{
 const {task,response}=await input();response.drafts[0].body_en=`这是仅供内部审稿的中文正文。 ${response.drafts[0].source.url}`;
 await assert.rejects(receiveStudioTask(task.id,response,actor),/公开英文稿 body_en.*字符/);
 const clean=await input();await receiveStudioTask(clean.task.id,clean.response,actor);const [row]=await sql`SELECT id FROM studio_drafts WHERE task_id=${clean.task.id}`;let d=(await studioDraft(row.id))!;
 await saveStudioDraft(d.id,{...clean.response.drafts[0],version:d.version,title_en:'不应公开的中文标题'},actor);
 d=(await studioDraft(d.id))!;
 assert.equal(d.document.title_en,'不应公开的中文标题');assert.equal(d.status,'draft');
 assert.ok(d.gate.findings.some(f=>f.ruleId==='D1'&&f.severity==='BLOCK'&&f.field==='title_en'&&f.reason.includes('含中文')));
 await reviewStudioDraft(d.id,{version:d.version,action:'submit'},actor);d=(await studioDraft(d.id))!;
 await assert.rejects(reviewStudioDraft(d.id,{version:d.version,action:'approve',english_reviewed:true},actor),/否决项/);
 await assert.rejects(exportStudioDraft(d.id,'html'),/审稿/);
});

test('withdrawing one confirmation from an approved draft revokes approval and export',async()=>{
 const {task,response}=await input();await receiveStudioTask(task.id,response,actor);const [row]=await sql`SELECT id FROM studio_drafts WHERE task_id=${task.id}`;
 let d=(await studioDraft(row.id))!;await reviewStudioDraft(d.id,{version:d.version,action:'submit'},actor);d=(await studioDraft(d.id))!;
 const confirmations=d.issues.items.filter(i=>i.confirmable).map(i=>({issueId:i.id,fingerprint:i.fingerprint}));await reviewStudioDraft(d.id,{version:d.version,action:'approve',confirmations},actor);d=(await studioDraft(d.id))!;
 for(let i=0;i<21;i++){await reviewStudioDraft(d.id,{version:d.version,action:'confirm',confirmations},actor);d=(await studioDraft(row.id))!;}
 assert.ok(await exportStudioDraft(d.id,'json'));
 await reviewStudioDraft(d.id,{version:d.version,action:'confirm',confirmations:confirmations.slice(1)},actor);d=(await studioDraft(d.id))!;
 assert.equal(d.status,'in_review');assert.equal(d.reviewed_by,null);await assert.rejects(exportStudioDraft(d.id,'md'),/审稿/);
});

test('bound source snapshot remains the review target when live material changes',async()=>{
 const {task,response}=await input();await receiveStudioTask(task.id,response,actor);const [row]=await sql`SELECT id FROM studio_drafts WHERE task_id=${task.id}`;
 const d=(await studioDraft(row.id))!;const old=d.source_snapshot.body_text;
 const [saved]=await sql`SELECT body_text,revision FROM articles WHERE id=${article}`;
 try {await sql`UPDATE articles SET body_text='Changed latest source material',revision=revision+1 WHERE id=${article}`;const current=(await studioDraft(row.id))!;assert.equal(current.source_snapshot.body_text,old);assert.equal(current.material.body_text,'Changed latest source material');assert.notEqual(current.material.revision,current.document.source.revision);}
 finally {await sql`UPDATE articles SET body_text=${saved.body_text},revision=${saved.revision} WHERE id=${article}`;}
});


test('pitch preparation uses redacted questions and exact source quotes, resumes duplicates, and permits only evidenced conservative drafting',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'studio-pitch-'));
 const oldDir=config.credentialsDir, oldEnabled=config.modelCallsEnabled,oldReasoning=process.env.LLM_REASONING_TOKENS;
 config.credentialsDir=dir;config.modelCallsEnabled=true;
 const ids=[`pitch-one-${suffix}`,`pitch-two-${suffix}`,`pitch-old-${suffix}`];
 const body='Cabinet dimensions are the measurements stated in the installation drawing. Check service access against the selected cabinet.';
 for(const id of ids)await sql`INSERT INTO articles(id,source_id,identity_key,url,title,published_at,discovered_at,timeline_at,body_status,body_text) VALUES(${id},${source},${id},${`https://example.com/${id}`},'Cabinet installation drawing','2020-01-01',now(),now(),'ok',${body})`;
 const submitted:string[]=[];
 const provider=await stub((_hit,req)=>{
  const request=JSON.parse(req.body),data=JSON.parse(request.messages.at(-1).content);submitted.push(req.body);
  const empty=data.question?.includes('ZZZZ')??false;
  const compact=Array.isArray(data.paragraphs?.[0]);
  const materialId=data.facts?.[0]?.article_id??ids[0];
  const answer=compact?{
   conclusion:'no_change',coverage:data.subquestions.map((q:{id:string;need:string})=>({id:q.id,status:q.need==='company'?'engineer':'page_good',page_paragraphs:q.need==='company'?[]:['p1'],reason:''})),
   edits:[],engineer_questions:[],
  }:data.facts?{
   conclusion:'upgrade',coverage:data.subquestions.map((q:{id:string},i:number)=>({id:q.id,status:i<2?'direct':'engineer',page_paragraphs:[],reason:''})),
   edits:[{op:'insert_after',paragraph:'start',subquestion:'q1',reason:'解释图纸尺寸',heading:'Cabinet dimensions',facts:[data.facts[0].id]},{op:'insert_after',paragraph:'start',subquestion:'q2',reason:'核对维护空间',heading:'Service access',facts:[data.facts.at(-1).id]}],
   titles:['Cabinet Dimensions and Installation','Plan LED Cabinet Access','Cabinet Drawings for Buyers'].map(title=>({title,anchor:'图纸决定尺寸',article_id:materialId,quote:'Cabinet dimensions are the measurements stated in the installation drawing.'})),hooks:[],
   engineer_questions:[{id:'q1',question:'维护空间怎么写？',section_ids:['q1'],options:[{id:'A',label:'按图纸确定',instruction:'按选定型号安装图确定，不写数值',conservative:true},{id:'B',label:'工程师提供实测条件',instruction:'保留确认条件',conservative:false},{id:'C',label:'其他，请写明',instruction:'依据工程回复',conservative:false}],withheld_numbers:['600 mm']}]
  }:{question_en:'How should cabinet installation be planned?',subquestions:[{id:'q1',zh:'图纸尺寸是什么',en:'What are cabinet dimensions?',need:'reference',answer_shape:'definition',terms:empty?['ZZZZ','ZZZX']:['cabinet dimensions','installation drawing']},{id:'q2',zh:'怎么核对维护空间',en:'How to check service access?',need:'reference',answer_shape:'steps',terms:empty?['ZZZY','ZZZK']:['service access','selected cabinet']},{id:'q3',zh:'公司保证的空间是多少',en:'What clearance is guaranteed?',need:'company',answer_shape:'number',terms:['guaranteed clearance','service millimeters']}]};
  return {model:'fake-flash',choices:[{message:{content:JSON.stringify(answer)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}};
 });
 try{
  await updateChannel('custom',{baseUrl:provider.url+'/v1',model:'fake-flash',key:'synthetic-pitch-key',activate:true,reason:'pitch fixture'},actor);
  const raw='Cabinet installation question. Contact email: buyer@example.org';
  const cleaned=previewPitch({question:raw});assert.ok(cleaned.redactions.some(r=>r.kind==='email'));
  await assert.rejects(createPitch({question:raw,privacy_confirmed:true},actor),/个人信息/);
  const card=await createPitch({question:cleaned.text,privacy_confirmed:true},actor);
  assert.equal(card.reused,false);assert.equal(provider.hits(),0,'the HTTP create path must only enqueue');
  const duplicate=await createPitch({question:cleaned.text,privacy_confirmed:true},actor);assert.equal(duplicate.id,card.id);assert.equal(duplicate.reused,true);
  await preparePitch(card.id,1,actor);
  const ready=(await getPitch(card.id))!;assert.equal(ready.status,'ready');assert.equal(provider.hits(),2);
  assert.ok(ready.prep!.materials!.some(m=>ids.includes(m.id)),'old technical references remain eligible');
  assert.ok(ready.prep!.materials!.every(m=>m.body_text?.includes(m.snippet)||m.title.includes(m.snippet)));
  assert.ok(submitted.every(x=>!x.includes('buyer@example.org')));
  const selected=ready.prep!.materials!.filter(m=>ids.includes(m.id)).map(m=>m.id);
  const input={version:1,article_ids:selected,selected_title:ready.prep!.titles![0].title,output_type:'guide',outline:ready.prep!.outline!.map(s=>({id:s.id,heading:s.heading,include:true})),engineer:{mode:'conservative',name:'',reply:'',answers:[]}};
  assert.throws(()=>confirmedPitch(ready.prep!,{...input,article_ids:[selected[0]]}),/证据不足/);
  assert.throws(()=>confirmedPitch(ready.prep!,{...input,engineer:{mode:'engineer',name:'',reply:'',answers:[{question_id:'q1',choice:'B',note:'600 mm'}]}}),/工程师/);
  const confirmed=(await confirmPitch(card.id,input,actor))!;
  const pack=(await exportStudioTask(confirmed.task_id))!;
  assert.equal(pack.request.pitch?.engineer.mode,'conservative');assert.equal(pack.request.pitch?.engineer.name,'');assert.deepEqual(pack.request.pitch?.withheld_numbers,['600 mm']);
  assert.equal(pack.request.articles.length,selected.length);assert.equal(pack.request.draft_article_ids.length,1);
  assert.equal((await confirmPitch(card.id,input,actor))?.task_id,confirmed.task_id);
  const draft={source:pack.request.articles[0].binding,title_zh:'按图纸确定',review_zh:'按型号图纸核对。',title_en:'Cabinet installation',body_en:'Use the selected cabinet drawing.',evidence:[],questions_zh:[],keyword_hypothesis:'cabinet',meta_description_en:'Cabinet drawings.'};
  assert.equal(pitchDraftFindings(pack.request,draft).length,0);
  assert.ok(pitchDraftFindings(pack.request,{...draft,body_en:'Allow 600 mm. Reviewed by Chipshow Engineering Team.'}).length>=2);
  let fragmentCalls=0;
  assert.equal(pack.request.pitch!.fragments_plan!.edit_plan.length,2);
  const partial=await generatePitchFragments(card.id,actor,{},async options=>{
   fragmentCalls++;
   assert.equal(options.timeoutMs,90000);
   if(options.subject.endsWith(':1'))throw new ReceiptUnknownError(991,'simulated response timeout');
   const result={html_en:'<p>According to the source, cabinet dimensions follow the installation drawing.</p>',zh_review:'据原文，箱体尺寸以安装图为准。',used_facts:JSON.parse(String(options.user)).facts.map((f:{id:string})=>f.id)};
   return {data:options.schema.parse(result),receiptId:990,usage:{prompt_tokens:100,completion_tokens:60},model:'fake-flash',reused:false};
  });
  assert.equal(partial?.status,'unknown');
  const fragmentCard=(await getPitch(card.id))!;
  const savedFragments=(fragmentCard.prep as unknown as {fragments:{status:string}[]}).fragments;
  assert.deepEqual(savedFragments.map(f=>f.status),['done','unknown'],'one timeout preserves the other result');
  await generatePitchFragments(card.id,actor,{},async()=>{throw Error('must not retry unknown');});
  assert.equal(fragmentCalls,2);
  assert.equal((await sql`SELECT id FROM studio_drafts WHERE task_id=${confirmed.task_id}`).length,0);
  const missing=await createPitch({question:'ZZZZ unmatched imaginary fixture',privacy_confirmed:true},actor);
  await preparePitch(missing.id,1,actor);assert.equal((await getPitch(missing.id))?.status,'insufficient');
  assert.equal(provider.hits(),3,'insufficient evidence must not spend the second preparation call');
  await assert.rejects(confirmPitch(missing.id,input,actor),/尚未就绪/);
  const retryCard=await createPitch({question:'Cabinet installation retry fixture',privacy_confirmed:true},actor);
  await preparePitch(retryCard.id,1,actor);
  const [prior]=await sql`SELECT id FROM receipts WHERE subject=${`studio-pitch:${retryCard.id}:1`} AND purpose='studio_prep_edit_plan'`;
  await sql`UPDATE receipts SET status='unknown',response=NULL WHERE id=${prior.id}`;
  const readyPrep=(await getPitch(retryCard.id))!.prep!;
  const oldPage=readyPrep.materials!.find(m=>m.id===ids[2])!;
  await sql`UPDATE studio_recommendations SET document=jsonb_set(document,'{prep}',${sql.json({...readyPrep,output_type:'update',
    existing_url:oldPage.url,source_html:`<p>${body}</p>`,status:'failed',model_outcome:'unknown',pending_receipt_id:Number(prior.id)} as never)}) WHERE id=${retryCard.id}`;
  const beforeRetry=provider.hits();
  await assert.rejects(preparePitchV2(retryCard.id,1,actor,true),/未重复调用/);
  assert.equal(provider.hits(),beforeRetry);
  process.env.LLM_REASONING_TOKENS='8000';
  await preparePitchV2(retryCard.id,1,actor,{retryEditPlanReceiptId:Number(prior.id)});
  assert.equal(provider.hits(),beforeRetry+1,'authorized retry reuses questions and sends only the edit plan');
  const restored=(await getPitch(retryCard.id))!;
  assert.equal(restored.status,'ready');assert.equal(restored.prep!.model_outcome,undefined);
  assert.deepEqual(restored.prep!.titles?.map(t=>t.title),[oldPage.title],'existing title needs no model output');
  assert.deepEqual(restored.prep!.hooks,[]);
  const updateRequest=JSON.parse(submitted.at(-1)!);
  assert.equal(updateRequest.max_tokens,4096,'the whole completion budget includes reasoning');
  await preparePitchV2(retryCard.id,1,actor,{retryEditPlanReceiptId:Number(prior.id)});
  await preparePitchV2(retryCard.id,1,actor,true);
  assert.equal(provider.hits(),beforeRetry+1,'the same authorization cannot buy another plan');
  assert.equal((await sql`SELECT status FROM receipts WHERE id=${prior.id}`)[0].status,'unknown','old unknown receipt remains intact');
 }finally{config.credentialsDir=oldDir;config.modelCallsEnabled=oldEnabled;if(oldReasoning===undefined)delete process.env.LLM_REASONING_TOKENS;else process.env.LLM_REASONING_TOKENS=oldReasoning;await provider.close();await rm(dir,{recursive:true,force:true});}
});
