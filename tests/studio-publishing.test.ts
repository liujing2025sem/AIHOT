import { tag } from './setup.ts';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, closeDb } from '@aihot/backend/db';
import { createStudioTask, exportStudioTask, studioDraft } from '@aihot/backend/studio/studio';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { getStudioPublishingSettings, setStudioPublishingSettings, publishStudioDraft, listStudioPublishingReviews, actOnStudioPublishingReview, enqueueStudioMaterialPublication, runStudioMaterialPublication } from '@aihot/backend/studio/studio-publishing';
import { preparePublicationCopy } from '@aihot/backend/studio/studio-publishing-content';
import { fragmentSchema } from '../scripts/editorial-pitch-lib.ts';

const actor='test:publishing', suffix=tag();
after(async()=>{await stopBoss();await closeDb();});

test('one-click publication retains manual draft state, reads back, corrects and rolls back, with default off',async t=>{
  Object.assign(process.env,{WP_BASE_URL:'https://wp.example.test/',WP_USER:'fixture',WP_APP_PASSWORD:'test-only',WP_GUIDE_CATEGORY_SLUG:'choose-guides',WP_DRAFT_PUSH_ENABLED:'true'});
  t.after(()=>{for(const key of ['WP_BASE_URL','WP_USER','WP_APP_PASSWORD','WP_GUIDE_CATEGORY_SLUG'])delete process.env[key];process.env.WP_DRAFT_PUSH_ENABLED='false';});
  const source='publish-'+suffix, article='article-'+suffix;
  const sourceText='A supplier describes packaging choices for an indoor LED display. It separates component measurements from completed display performance. The source also explains inspection and installation conditions.';
  await sql`INSERT INTO sources(id,name,kind,enabled) VALUES (${source},'Kinglight','web_list',false)`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at,body_status,body_text) VALUES (${article},${source},${article},${'https://source.example.test/'+article},'MiP packaging guidance',now(),now(),'ok',${sourceText})`;
  const task=await createStudioTask({article_ids:[article]},actor),packet=(await exportStudioTask(task.id))!.request;
  const id=randomUUID(),document={source:packet.articles[0].binding,title_zh:'封装选型',title_en:'MiP packaging guide',review_zh:'内部核对',body_en:'<p>MiP encapsulation is a component choice. Buyers should confirm the complete display specifications with their supplier.</p>',evidence:[{claim:'Inspect conditions',quote:'The source also explains inspection and installation conditions.'}],questions_zh:['工程师尚未回复'],keyword_hypothesis:'MiP',meta_description_en:'Compare MiP packaging with the specifications of a completed LED display.'};
  await sql`INSERT INTO studio_drafts(id,task_id,article_id,document,updated_by) VALUES (${id},${task.id},${article},${sql.json(document)},${actor})`;
  type Post={id:number;slug:string;link:string;status:string;title:{raw:string};content:{raw:string};excerpt:{raw:string};meta:Record<string,string>;categories:number[];tags:number[];featured_media:number};
  const posts=new Map<number,Post>(),revisions=new Map<number,Post[]>();let next=200,mediaNext=500,loseCreate=true,badRead=false,modelCalls=0;
  const mediaIds:number[]=[];
  t.mock.method(globalThis,'fetch',async(input:string|URL|Request,init?:RequestInit)=>{
    const url=new URL(input instanceof Request?input.url:input);const json=(data:unknown,status=200)=>Response.json(data,{status});
    if(url.hostname==='llm.example.test'){modelCalls++;const {source:_source,...draft}=document;return json({choices:[{message:{content:JSON.stringify({decision:'draft',draft})}}],usage:{prompt_tokens:100,completion_tokens:70}});}
    assert.equal(url.hostname,'wp.example.test','no external services in this test');
    if(!url.pathname.startsWith('/wp-json/'))return new Response('<article>Published</article>');
    if(url.pathname.endsWith('/categories'))return json([{id: url.searchParams.get('slug')==='industry-news'?72:29,slug:url.searchParams.get('slug')}]);
    if(url.pathname.endsWith('/tags'))return json([{id:8,slug:'consumer-display'}]);
    if(url.pathname.endsWith('/media')&&init?.body instanceof FormData){const mid=mediaNext++;mediaIds.push(mid);return json({id:mid,slug:init.body.get('slug'),source_url:'https://wp.example.test/uploads/'+mid+'.png',alt_text:init.body.get('alt_text'),caption:{raw:init.body.get('caption')}});}
    const rev=/\/posts\/(\d+)\/revisions$/.exec(url.pathname);if(rev)return json((revisions.get(Number(rev[1]))??[]).map((p,i)=>({...p,id:1000+i,parent:p.id,slug:p.id+'-revision-'+i})).reverse());
    const match=/\/posts\/(\d+)$/.exec(url.pathname);const postId=match?Number(match[1]):undefined;
    if(!init?.body){assert.equal(init?.method,'POST');assert.equal(new Headers(init?.headers).get('X-HTTP-Method-Override'),'GET','authenticated reads avoid the observed stale CDN cache');if(postId!==undefined){const p=posts.get(postId)!;return json(badRead&&p.status==='publish'?{...p,content:{raw:'Mismatched remote content'}}:p);}return json([...posts.values()].filter(p=>p.slug===url.searchParams.get('slug')));}
    const data=JSON.parse(init.body as string);const previous=postId?posts.get(postId):undefined;
    if(previous){const list=revisions.get(postId!)??[];list.push(structuredClone(previous));revisions.set(postId!,list);}
    const actualId=postId??next++;const p:Post={id:actualId,slug:data.slug??previous?.slug??'',link:'https://wp.example.test/?p='+actualId,status:data.status??previous?.status??'draft',title:{raw:data.title??previous?.title.raw??''},content:{raw:data.content??previous?.content.raw??''},excerpt:{raw:data.excerpt??previous?.excerpt.raw??''},meta:data.meta??previous?.meta??{},categories:data.categories??previous?.categories??[],tags:data.tags??previous?.tags??[],featured_media:data.featured_media??previous?.featured_media??0};posts.set(actualId,p);
    if(postId===undefined&&loseCreate){loseCreate=false;throw Error('simulated lost acknowledgement');}
    return json(p);
  });
  assert.deepEqual(await getStudioPublishingSettings(),{mode:'review',enabled:false,daily_limits:{brief:1,article:2,guide:1,update:0}});
  await assert.rejects(publishStudioDraft(id,{version:1,kind:'guide',section:'components-ics'},actor),/未开启/);
  assert.equal(posts.size,0);
  await setStudioPublishingSettings({mode:'one_click',enabled:true},actor);
  process.env.WP_DRAFT_PUSH_ENABLED='false'; // The explicit one-click setting is its switch; this older valve is for the draft-only path.
  const published=await publishStudioDraft(id,{version:1,kind:'guide',section:'components-ics'},actor);
  assert.equal(published!.status,'published',JSON.stringify(published!.issues));
  assert.equal(posts.size,1,'lost create acknowledgement is reconciled before creating again');
  assert.equal((await studioDraft(id))!.status,'draft','no human approval was manufactured');
  const p=posts.get(published!.postId!)!;
  assert.equal(p.status,'publish');assert.deepEqual(p.categories,[29]);
  assert.equal(p.meta._yoast_wpseo_metadesc,document.meta_description_en);
  assert.ok(p.featured_media);assert.match(p.content.raw,/<figure class="cs-figure">/);
  assert.ok(published!.figures?.[0].score?.total);
  const corrected=await actOnStudioPublishingReview(id,{action:'correct',title:'Corrected MiP guide',reason:'attribution'},actor);
  assert.equal(corrected!.title,'Corrected MiP guide');
  await actOnStudioPublishingReview(id,{action:'unpublish',reason:'other'},actor);
  assert.equal(posts.get(p.id)!.status,'draft');
  assert.equal((await listStudioPublishingReviews()).weekly.reasons.length,2);
  // A separate update record uses WordPress revisions and does not select an unrelated post.
  await sql`UPDATE studio_tasks SET request=jsonb_set(request,'{editorial_plan}',${sql.json({card_id:'synthetic-card',question_id:null,action:'update_page',question:'Refresh packaging wording',existing_url:p.link,requires_first_party:false})}) WHERE id=${task.id}`;
  // Private smoke supports rollback without changing the public post or editorial approval.
  const {publishStudioDraftPrivateTest,actOnStudioPublishingPrivateTest}=await import('@aihot/backend/studio/studio-publishing');
  await sql`UPDATE studio_tasks SET request=request-'editorial_plan' WHERE id=${task.id}`;
  const privatePost=await publishStudioDraftPrivateTest(id,{version:1,kind:'guide',section:'components-ics'},actor);
  assert.equal(posts.get(privatePost!.postId!)!.status,'private');
  assert.notEqual(privatePost!.figures![0].mediaId,published!.figures![0].mediaId,'each article has its own image attachment');
  await actOnStudioPublishingPrivateTest(privatePost!.id,{action:'correct',title:'Private correction'},actor);
  await actOnStudioPublishingPrivateTest(privatePost!.id,{action:'unpublish'},actor);
  await actOnStudioPublishingPrivateTest(privatePost!.id,{action:'rollback'},actor);
  assert.equal(posts.get(privatePost!.postId!)!.title.raw,document.title_en);
  assert.equal(posts.get(privatePost!.postId!)!.status,'draft');
  // The same input response is saved as an unapproved draft by the background material path.
  Object.assign(process.env,{LLM_BASE_URL:'https://llm.example.test/v1',LLM_API_KEY:'fixture-key',LLM_MODEL:'test-flash'});
  const queued=await enqueueStudioMaterialPublication({article_ids:[article],kind:'article',section:'components-ics'},actor);
  await runStudioMaterialPublication({id:queued.id,actor,article_ids:[article],kind:'article',section:'components-ics'});
  assert.equal(modelCalls,1);
  const materialResult=(await listStudioPublishingReviews()).rows.find(r=>r.id===queued.id)!;
  assert.equal(materialResult.status,'published',JSON.stringify(materialResult.issues));
  await runStudioMaterialPublication({id:queued.id,actor,article_ids:[article],kind:'article',section:'components-ics'});
  assert.equal(modelCalls,1,'completed work is not regenerated');
  // Wrong readback is demoted automatically.
  badRead=true;
  await sql`UPDATE studio_drafts SET version=version+1 WHERE id=${id}`;
  const failed=await publishStudioDraft(id,{version:2,kind:'guide',section:'components-ics'},actor);
  assert.equal(failed!.status,'draft');assert.equal(posts.get(failed!.postId!)!.status,'draft');
});

test('five automatic filters remove content, keep WARN optional and preserve authorised own-page wording',()=>{
  const packet={articles:[{source_name:'Kinglight',title:'Reference',body_text:'A long copied sentence contains enough distinct English words to reproduce the original source text without any editorial transformation or additional insight for the potential display purchaser today.',binding:{url:'https://maker.example.test/source'}}]} as unknown as Parameters<typeof preparePublicationCopy>[0]['packet'];
  const draft={source:{url:'https://maker.example.test/source',published_at:null},title_en:'Packaging selection',title_zh:'包装',review_zh:'内部',body_en:'<p>Buyers can compare packaging technologies using application requirements.</p><p>Email: buyer@example.test.</p><p>Kinglight is inferior and unreliable.</p><p>api_key=sk-abcdefghijklmnopqrstuvwx</p><p>'+packet.articles[0].body_text+'</p>',questions_zh:['Unanswered'],meta_description_en:'Application requirements guide packaging selection.',evidence:[],keyword_hypothesis:'packaging'} as unknown as Parameters<typeof preparePublicationCopy>[0]['draft'];
  const clean=preparePublicationCopy({draft,packet});
  assert.match(clean.html,/Buyers can compare/);assert.doesNotMatch(clean.html,/buyer@example|inferior|api_key|long copied/);
  assert.ok(clean.issues.some(i=>i.code==='privacy'));assert.ok(clean.issues.some(i=>i.code==='copy'));
  const own=preparePublicationCopy({draft:{...draft,body_en:'<p>'+packet.articles[0].body_text+'</p>'},packet,existingUrl:packet.articles[0].binding.url,correction:true});
  assert.ok(own.html.includes(packet.articles[0].body_text!),'authorised old-page keep text is not plagiarism');
  assert.equal(fragmentSchema.parse({html_en:'<p>Readable text.</p>',zh_review:'文本',used_facts:['f1'],figure:{template:'invented'}}).figure,undefined,'a malformed optional figure does not block text');
});
