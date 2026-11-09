import { tag } from './setup.ts';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, closeDb } from '@aihot/backend/db';
import { createStudioTask, exportStudioTask, reviewStudioDraft, studioDraft } from '@aihot/backend/studio/studio';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { getStudioPublishingSettings, setStudioPublishingSettings, publishStudioDraft, listStudioPublishingReviews, actOnStudioPublishingReview, enqueueStudioMaterialPublication, runStudioMaterialPublication } from '@aihot/backend/studio/studio-publishing';
import { preparePublicationCopy } from '@aihot/backend/studio/studio-publishing-content';
import { fragmentSchema } from '../scripts/editorial-pitch-lib.ts';
import { checkedUpdatePatch, publicStudioTitle, studioUpgradeContext, updateBaselineHash } from '@aihot/backend/studio/studio-upgrade';
import { wpUpdateTarget, wpWrite, type WpPost } from '@aihot/backend/studio/studio-publishing-wordpress';
import { pushStudioWordPressDraft, sanitizeReviewedHtml, studioWordPressReceipt, WordPressError } from '@aihot/backend/studio/studio-wordpress';

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

test('bound upgrade identity protects the published original and patches only reviewed ranges', async () => {
  const keep = '<h2 id="retained">Existing guide section</h2>';
  const old = '<p id="rounding">Use whole cabinet counts.</p>';
  const revised = '<p id="rounding">Use whole cabinet counts and verify the resulting resolution.</p>';
  const baseline = '<section class="existing-theme">\n<!-- retained theme marker -->' + keep + '\n' + old + '</section>';
  const url = 'https://wp.example.test/size-guide/';
  const packet = { articles: [{ binding: { url } }], pitch: { output_type: 'update', existing_url: url,
    fragments_plan: { source_html: baseline, original_title: 'Screen dimension guide',
      paragraphs: [{ id: 'p1', html: keep, text: 'Existing guide section' }, { id: 'p2', html: old, text: 'Use whole cabinet counts.' }],
      edit_plan: [{ op: 'keep', paragraph: 'p1', facts: [] }, { op: 'revise', paragraph: 'p2', facts: [], reason: 'Clarify rounding' }],
      fragments: [{ op_index: 1, html_en: revised, zh_review: '核对取整', used_facts: ['f1'] }],
    } } } as unknown as Parameters<typeof studioUpgradeContext>[0];
  const original: WpPost = { id: 6098, link: url, slug: 'size-guide', status: 'publish',
    title: { raw: 'Screen dimension guide' }, content: { raw: baseline } };
  const context = studioUpgradeContext(packet)!;
  assert.equal(context.delivery, 'shadow_draft');
  assert.equal(context.target_existing_url, url);
  assert.equal(context.changes.length, 1);
  assert.match(context.notice, /请勿在 WordPress 直接发布/);
  const confirmation = { target_post_id: 6098, baseline_sha256: context.baseline_sha256! };
  const result = checkedUpdatePatch(packet, keep + revised, original, confirmation);
  assert.equal(result.content, baseline.replace(old, revised));
  assert.equal(result.title, original.title.raw);
  assert.equal(result.baseline_sha256, updateBaselineHash(original.title.raw, baseline));
  assert.equal(publicStudioTitle('[UPDATE] Screen dimension guide'), 'Screen dimension guide');
  assert.equal(publicStudioTitle('Unconfirmed report: [UPDATE] Screen dimension guide'), 'Unconfirmed report: Screen dimension guide');
  assert.throws(() => checkedUpdatePatch(packet, keep + revised, { ...original, status: 'draft' }, confirmation), /已变化|不符/);
  assert.throws(() => checkedUpdatePatch(packet, keep + revised, original, { ...confirmation, target_post_id: 9597 }), /不符/);
  assert.throws(() => checkedUpdatePatch(packet, keep + revised, { ...original, content: { raw: baseline + '<p>Manual edit</p>' } }, confirmation), /已变化/);
  assert.throws(() => checkedUpdatePatch(packet, keep + '<p>Unchecked replacement</p>', original, confirmation), /不一致/);
  assert.throws(() => studioUpgradeContext({ ...packet, articles: [] }), /原页绑定/);
  assert.equal(studioUpgradeContext({ ...packet, pitch: undefined }), null, 'an UPDATE title alone never grants original-page write authority');

  const calls: string[] = [];
  const request = async (endpoint: string, _query: Record<string, string>, payload?: object) => {
    assert.equal(payload, undefined, 'resolving the update target must stay read-only');
    calls.push(endpoint);
    return endpoint === 'posts' ? [{ id: 6098, slug: original.slug }] : original;
  };
  assert.equal((await wpUpdateTarget(request, new URL('https://wp.example.test/'), url))?.id, 6098);
  assert.deepEqual(calls, ['posts', 'posts/6098']);
  let writes = 0;
  await assert.rejects(wpWrite(async () => { writes++; throw new WordPressError(); }, 6098,
    { status: 'publish', content: result.content }, false), WordPressError);
  assert.equal(writes, 1, 'an uncertain live update is not blindly repeated');
});

test('reviewed HTML keeps brief semantics and image metadata without injecting a WordPress theme', () => {
  const html = '<section class="cs-brief"><aside class="cs-brief-summary"><h2>In 5 seconds</h2><ul><li>First</li><li>Second</li><li>Third</li></ul></aside>' +
    '<article id="brief-event-a" class="cs-brief-item"><p class="cs-brief-label">Components</p><h2>A factual hook</h2>' +
    '<p class="cs-brief-source"><a href="https://source.example.test/notice" rel="noopener">Original source</a> · Original source date: 2026-11-09</p>' +
    '<figure class="cs-figure"><img src="https://wp.example.test/diagram.png" width="1200" height="675" alt="Cabinet layout with dimension labels" loading="lazy"><figcaption>Source and conditions remain readable.</figcaption></figure></article></section>';
  const result = sanitizeReviewedHtml(html);
  assert.match(result, /<aside class="cs-brief-summary">/);
  assert.match(result, /<p class="cs-brief-label">Components<\/p>/);
  assert.match(result, /<p class="cs-brief-source">/);
  assert.match(result, /alt="Cabinet layout with dimension labels"/);
  assert.match(result, /<figcaption>Source and conditions remain readable\.<\/figcaption>/);
  assert.match(result, /id="brief-event-a"/);
  const hostile = sanitizeReviewedHtml(html + '<style>body{display:none}</style><script>alert(1)</script>' +
    '<p class="theme-dark cs-brief-label" style="position:fixed" onclick="alert(2)">Allowed copy</p>' +
    '<img src="javascript:alert(3)" onerror="alert(4)" alt="Retained ALT"><iframe src="https://bad.example.test"></iframe>');
  assert.doesNotMatch(hostile, /<style|<script|<iframe|onclick|onerror|javascript:|position:fixed|theme-dark|body\{display/);
  assert.match(hostile, /class="cs-brief-label">Allowed copy/);
  assert.match(hostile, /alt="Retained ALT"/);
});

test('upgrade delivery creates an independent shadow and never demotes the live original on failed readback', async t => {
  Object.assign(process.env, { WP_BASE_URL: 'https://wp-update.example.test/', WP_USER: 'fixture',
    WP_APP_PASSWORD: 'test-only', WP_GUIDE_CATEGORY_SLUG: 'choose-guides' });
  t.after(() => { for (const key of ['WP_BASE_URL', 'WP_USER', 'WP_APP_PASSWORD', 'WP_GUIDE_CATEGORY_SLUG']) delete process.env[key]; });
  await setStudioPublishingSettings({ mode: 'one_click', enabled: true }, actor);
  const source = 'update-source-' + suffix, article = 'update-article-' + suffix, url = 'https://wp-update.example.test/?p=6098';
  const title = 'Screen dimension guide';
  const parts = [
    '<p>Buyers should match installation space and viewing tasks before choosing a display.</p>',
    '<p id="rounding">Use whole cabinet counts.</p>',
    '<p><a href="' + url + '">Original guide</a></p>',
  ];
  const changed = '<p id="rounding">Use whole cabinet counts and verify the resulting resolution.</p>';
  const baseline = parts.join(''), proposed = parts[0] + changed + parts[2];
  await sql`INSERT INTO sources(id,name,kind,enabled) VALUES (${source},'Chipshow','web_list',false)`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at,body_status,body_text)
    VALUES (${article},${source},${article},${url},${title},now(),now(),'ok','Use whole cabinet counts.')`;
  const task = await createStudioTask({ article_ids: [article] }, actor);
  const packet = (await exportStudioTask(task.id))!.request;
  packet.pitch = {
    question: 'Clarify cabinet rounding', output_type: 'update', existing_url: url, selected_title: title,
    primary_article_id: article, outline: [{ id: 'rounding', heading: 'Rounding', evidence: [], gap: '', action: 'Clarify the existing paragraph' }],
    engineer: { mode: 'conservative', name: '', reply: '', answers: [] }, withheld_numbers: [],
    fragments_plan: {
      source_html: baseline, original_title: title, method_rule_ids: [], subquestions: [], facts: [],
      paragraphs: parts.map((html, i) => ({ id: 'p' + i, html, text: html.replace(/<[^>]+>/g, '') })),
      edit_plan: parts.map((_html, i) => ({ op: i === 1 ? 'revise' as const : 'keep' as const, paragraph: 'p' + i, facts: [], reason: 'Clarify rounding' })),
      fragments: [{ op_index: 1, html_en: changed, zh_review: '仅修改取整提醒', used_facts: ['page-context'] }],
    },
  };
  await sql`UPDATE studio_tasks SET request=${sql.json(packet as never)} WHERE id=${task.id}`;
  const id = randomUUID();
  const document = { source: packet.articles[0].binding, title_zh: '取整说明', title_en: '[UPDATE] ' + title,
    review_zh: '核对取整说明', body_en: proposed, evidence: [{ claim: 'Whole cabinets', quote: 'Use whole cabinet counts.' }],
    questions_zh: [], keyword_hypothesis: 'screen dimensions', meta_description_en: 'Choose whole cabinet layouts.' };
  await sql`INSERT INTO studio_drafts(id,task_id,article_id,document,updated_by)
    VALUES (${id},${task.id},${article},${sql.json(document)},${actor})`;
  const original: WpPost = { id: 6098, slug: 'size-guide', link: url, status: 'publish', title: { raw: title },
    content: { raw: baseline }, categories: [29], tags: [], featured_media: 0, meta: {}, excerpt: { raw: '' } };
  const posts = new Map<number, WpPost>([[6098, original]]);
  const writes: { id: number; payload: Record<string, unknown> }[] = [];
  let next = 9000, failAfterLiveWrite = false, corrupt = false;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(input instanceof Request ? input.url : input);
    assert.equal(u.hostname, 'wp-update.example.test');
    if (!u.pathname.startsWith('/wp-json/')) return new Response('Published original');
    if (u.pathname.endsWith('/categories')) return Response.json([{ id: 29, slug: 'choose-guides' }]);
    const match = /\/posts\/(\d+)$/.exec(u.pathname), postId = match ? Number(match[1]) : null;
    if (!init?.body) {
      if (postId === null) return Response.json([...posts.values()].filter(post => post.slug === u.searchParams.get('slug')));
      const current = posts.get(postId)!;
      return Response.json(corrupt && postId === 6098 ? { ...current, content: { raw: 'Uncertain readback' } } : current);
    }
    const payload = JSON.parse(init.body as string), actualId = postId ?? next++, previous = posts.get(actualId);
    writes.push({ id: actualId, payload });
    const saved: WpPost = { id: actualId, slug: payload.slug ?? previous?.slug ?? '', link: previous?.link ?? 'https://wp-update.example.test/?p=' + actualId,
      status: payload.status ?? previous?.status ?? 'draft', title: { raw: payload.title ?? previous?.title.raw ?? '' },
      content: { raw: payload.content ?? previous?.content.raw ?? '' }, excerpt: { raw: payload.excerpt ?? previous?.excerpt?.raw ?? '' },
      categories: payload.categories ?? previous?.categories ?? [], tags: payload.tags ?? previous?.tags ?? [],
      featured_media: payload.featured_media ?? previous?.featured_media ?? 0, meta: payload.meta ?? previous?.meta ?? {} };
    posts.set(actualId, saved);
    if (actualId === 6098 && failAfterLiveWrite) corrupt = true;
    return Response.json(saved);
  });
  const shadow = await publishStudioDraft(id, { version: 1, kind: 'guide', section: 'displays-projects' }, actor);
  assert.equal(shadow?.status, 'draft', JSON.stringify(shadow?.issues));
  assert.equal(shadow?.kind, 'update', 'a misleading frontend guide selection cannot change task identity');
  assert.equal(shadow?.target_post_id, 6098);
  assert.notEqual(shadow?.postId, 6098);
  assert.equal(shadow?.title, title);
  assert.deepEqual(posts.get(6098), original);
  assert.equal(writes.some(write => write.id === 6098), false);
  const repeated = await publishStudioDraft(id, { version: 1, kind: 'guide', section: 'displays-projects' }, actor);
  assert.equal(repeated?.postId, shadow?.postId);
  const confirmation = { target_post_id: 6098, baseline_sha256: studioUpgradeContext(packet)!.baseline_sha256! };
  posts.set(6098, { ...original, content: { raw: baseline + '<p>Manual edit</p>' } });
  const before = writes.length;
  await assert.rejects(publishStudioDraft(id, { version: 1, kind: 'guide', section: 'displays-projects', confirm_update: confirmation }, actor), /原页面已变化/);
  assert.equal(writes.length, before);
  posts.set(6098, structuredClone(original));
  failAfterLiveWrite = true;
  const failed = await publishStudioDraft(id, { version: 1, kind: 'update', section: 'displays-projects', confirm_update: confirmation }, actor);
  assert.equal(failed?.status, 'failed');
  assert.ok(failed?.issues.some(problem => problem.code === 'original_page_protected'));
  assert.equal(posts.get(6098)?.status, 'publish');
  assert.equal(posts.get(6098)?.title.raw, title);
  assert.equal(posts.get(6098)?.content.raw, proposed);
  assert.equal(writes.filter(write => write.id === 6098).length, 1);
  assert.equal(writes.some(write => write.id === 6098 && write.payload.status === 'draft'), false);
});

test('a read-only shadow preflight failure releases its reservation without retrying an unknown write', async t => {
  Object.assign(process.env, { WP_BASE_URL: 'https://wp-pending.example.test/', WP_USER: 'fixture', WP_APP_PASSWORD: 'test-only',
    WP_GUIDE_CATEGORY_SLUG: 'choose-guides', WP_DRAFT_PUSH_ENABLED: 'true' });
  t.after(() => { for (const key of ['WP_BASE_URL', 'WP_USER', 'WP_APP_PASSWORD', 'WP_GUIDE_CATEGORY_SLUG']) delete process.env[key]; process.env.WP_DRAFT_PUSH_ENABLED = 'false'; });
  const source = 'pending-source-' + suffix, article = 'pending-article-' + suffix, url = 'https://wp-pending.example.test/?p=6098';
  const text = 'A supplier describes inspection conditions for an indoor display.';
  await sql`INSERT INTO sources(id,name,kind,enabled) VALUES (${source},'Supplier','web_list',false)`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at,body_status,body_text)
    VALUES (${article},${source},${article},${url},'Inspection notes',now(),now(),'ok',${text})`;
  const task = await createStudioTask({ article_ids: [article] }, actor), packet = (await exportStudioTask(task.id))!.request;
  packet.pitch = { question: 'Clarify inspection conditions', output_type: 'update', existing_url: url, selected_title: 'Inspection notes',
    primary_article_id: article, outline: [{ id: 'inspection', heading: 'Inspection', evidence: [], gap: '', action: 'Retain the source attribution' }],
    engineer: { mode: 'conservative', name: '', reply: '', answers: [] }, withheld_numbers: [] };
  await sql`UPDATE studio_tasks SET request=${sql.json(packet as never)} WHERE id=${task.id}`;
  const id = randomUUID(), document = { source: packet.articles[0].binding, title_zh: '检查说明', title_en: '[UPDATE] Inspection notes',
    review_zh: '仅核对来源中的检查说明', body_en: '<p>' + text + '</p><p><a href="' + url + '">Original source</a></p>',
    evidence: [{ claim: 'Inspection conditions', quote: text }], questions_zh: [], keyword_hypothesis: 'inspection conditions', meta_description_en: 'Supplier inspection notes.' };
  await sql`INSERT INTO studio_drafts(id,task_id,article_id,document,updated_by)
    VALUES (${id},${task.id},${article},${sql.json(document)},${actor})`;
  await reviewStudioDraft(id, { version: 1, action: 'submit' }, actor);
  const draft = (await studioDraft(id))!;
  const approved = await reviewStudioDraft(id, { version: draft.version, action: 'approve',
    confirmations: draft.issues.items.filter(item => item.confirmable).map(item => ({ issueId: item.id, fingerprint: item.fingerprint })) }, actor);
  let failRead = true, loseWrite = false, writes = 0;
  const original: WpPost = { id: 6098, slug: 'inspection', link: url, status: 'publish', title: { raw: 'Inspection notes' }, content: { raw: '<p>' + text + '</p>' } };
  let shadow: Record<string, unknown> | undefined;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(input instanceof Request ? input.url : input);
    assert.equal(u.hostname, 'wp-pending.example.test');
    if (u.pathname.endsWith('/categories')) return Response.json([{ id: 29, slug: 'choose-guides' }]);
    if (u.pathname.endsWith('/posts/6098')) {
      assert.equal(init?.body, undefined, 'original page is always read-only on the draft route');
      return failRead ? Response.json({}, { status: 503 }) : Response.json(original);
    }
    if (!init?.body) return Response.json(u.pathname.endsWith('/posts/9000') ? shadow : shadow ? [shadow] : []);
    writes++;
    const body = JSON.parse(init.body as string);
    shadow = { ...shadow, ...body, id: 9000, featured_media: body.featured_media ?? 0 };
    if (loseWrite) throw Error('simulated lost acknowledgement');
    return Response.json(shadow);
  });
  const input = { version: approved!.version, kind: 'guide', section: 'displays-projects' };
  await assert.rejects(pushStudioWordPressDraft(id, input, actor), /HTTP 503/);
  assert.equal(writes, 0);
  assert.equal((await studioWordPressReceipt(id))?.state, 'not_sent');
  failRead = false; loseWrite = true;
  const uncertain = await pushStudioWordPressDraft(id, input, actor);
  assert.equal(uncertain?.state, 'unknown');
  assert.equal((await studioWordPressReceipt(id))?.state, 'unknown', 'after a post mutation, the reservation is never reset to not_sent');
  assert.equal(writes, 1);
  loseWrite = false;
  const recovered = await pushStudioWordPressDraft(id, input, actor);
  assert.equal(recovered?.state, 'pushed');
  assert.equal(recovered?.postId, 9000);
  assert.equal(writes, 2, 'the known shadow is updated after recovery, no second shadow is created');
});
