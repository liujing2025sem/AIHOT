import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { questionSchema } from '../packages/backend/src/admin/studio-questions.ts';
import { questionKeywords, keywordMatch } from '../packages/backend/src/admin/studio-question-match.ts';
import {discoverPitchEvidence} from '../packages/backend/src/studio/studio-pitch-research.ts';
import {editorialChoicesSchema,pitchSchema} from '../scripts/editorial-pitch-lib.ts';
import {answerEvidence} from '../packages/backend/src/studio/studio-pitch-fragments.ts';
import {confirmedFragmentPlan} from '../packages/backend/src/studio/studio-pitch-v2.ts';
import {fetchDetail} from '../packages/backend/src/sources/web-list.ts';
import type {SourceRow} from '../packages/backend/src/sources/types.ts';
import {config} from '../packages/backend/src/config.ts';

const example={question:'户外招牌一年用多少电？',roles:['终端业主/广告媒体主'],scenario:'户外招牌',dimension:'费用',keywords:['用电','电费','power']};
test('question planning keeps unknown URLs blank and rejects invented transport or credentials',()=>{
  assert.equal(questionSchema.parse(example).existing_url,'');
  for(const url of ['file:///C:/data','https://user:password@chipshow.com/page','javascript:alert(1)'])assert.equal(questionSchema.safeParse({...example,existing_url:url}).success,false);
  assert.equal(questionSchema.parse({...example,existing_url:'https://www.chipshow.com/blog/example'}).existing_url_provenance,'operator_entered');
});
test('software tutorial questions require first-party evidence; profiles do not become facts',()=>{
  assert.equal(questionSchema.safeParse({...example,dimension:'控制软件',content_type:'tutorial'}).success,false);
  assert.equal(questionSchema.parse({...example,dimension:'控制软件',content_type:'tutorial',requires_first_party:true}).requires_first_party,true);
  assert.equal(questionSchema.safeParse({...example,roles:['虚构角色']}).success,false);
  assert.equal(questionSchema.safeParse({...example,company_facts:'由询盘推断的能力'}).success,false);
});
test('question-map example is a proposed planning list with no asserted existing pages',()=>{
  const seed=JSON.parse(readFileSync(new URL('../industry/question-map.example.json',import.meta.url),'utf8'));
  assert.equal(seed.questions.length,36);
  for(const input of seed.questions){const q=questionSchema.parse(input);assert.equal(q.existing_url,'');assert.ok(q.demand_evidence.every(e=>e.type==='grill-example'));assert.ok(q.question_en);assert.ok(q.keywords_en.length>0);assert.deepEqual(new Set(q.keywords),new Set([...q.keywords_zh,...q.keywords_en]));}
});

test('bilingual question fields and legacy English keywords both remain usable',()=>{
  const grouped=questionSchema.parse({...example,question_en:'How do I choose a power supply?',keywords:[],keywords_zh:['电源'],keywords_en:['power supply']});
  assert.equal(grouped.question_en,'How do I choose a power supply?');
  assert.equal(keywordMatch(grouped,'New POWER SUPPLIES for outdoor displays'),1);
  const legacy=questionSchema.parse(example);
  assert.ok(keywordMatch(legacy,'LED POWER consumption')>0);
  assert.deepEqual(questionKeywords({keywords:['power','电源'],keywords_zh:['电源'],keywords_en:['power','power supply']}),['power','电源','power supply']);
});

test('missing English keywords are rejected even when Chinese groups are filled',()=>{
  for(const terms of [
    {keywords:['电源','功耗']},
    {keywords:[],keywords_zh:['电源'],keywords_en:[]},
    {keywords:['电源'],keywords_zh:['功耗'],keywords_en:['控制器']},
    {keywords:['电源'],keywords_en:['  ']},
  ])assert.equal(questionSchema.safeParse({...example,...terms}).success,false,JSON.stringify(terms));
});

for(const sample of [
  {topic:'power supply',keywords_en:['power supply'],text:'New POWER SUPPLIES for outdoor LED displays',miss:'Powerful outdoor LED displays'},
  {topic:'controller firmware',keywords_en:['controller firmware'],text:'CONTROLLERS FIRMWARE version 2.4.0 is available',miss:'Controllerware roadmap'},
  {topic:'DOOH',keywords_en:['DOOH'],text:'New dooh advertising deployments announced',miss:'An outdoor campaign by doohouse'},
])test(`A1 synthetic English topic matches case and plural: ${sample.topic}`,()=>{
  const question=questionSchema.parse({...example,keywords:[],keywords_zh:['中文占位'],keywords_en:sample.keywords_en});
  assert.ok(keywordMatch(question,sample.text)>0);
  assert.equal(keywordMatch(question,sample.miss),0);
});

test('English singular and plural phrases match in both directions without substring leakage',()=>{
  for(const [term,text] of [
    ['power supply','power supplies'],['power supplies','POWER SUPPLY'],
    ['controller','CONTROLLERS'],['controllers','controller'],
    ['switch','switches'],['switches','SWITCH'],
  ])assert.equal(keywordMatch({keywords_en:[term]},text),1,`${term} / ${text}`);
  for(const [term,text] of [['IC','microchip'],['power','powerful'],['controller','microcontroller']])assert.equal(keywordMatch({keywords_en:[term]},text),0,`${term} / ${text}`);
});

test('topic research discovers public URLs without operator links and imports bodies only',async()=>{
  const requests:string[]=[],imports:string[]=[];
  const result=await discoverPitchEvidence([{id:'q1',zh:'欧洲仓提货需要核对什么',en:'What should a buyer check before Europe warehouse pickup?',terms:['warehouse pickup','delivery steps']}],async url=>{imports.push(url);return 'fetched-body-1';},async(url,options)=>{
    requests.push(url);
    assert.ok(options!.timeoutMs!<=6000);assert.ok(options!.maxBytes!<=256*1024);
    const text=url.endsWith('/robots.txt')?'User-agent: *\nDisallow: /private':`<html><a href="/warehouse-pickup">Warehouse pickup</a><a href="/delivery-steps">Delivery steps</a><p>Unverified listing says next-day pickup.</p></html>`;
    return {status:200,url,headers:new Headers({'content-type':'text/html'}),body:Buffer.alloc(0),truncated:false,text:()=>text};
  });
  assert.ok(requests.some(url=>url.endsWith('/robots.txt')));assert.equal(imports.length,4);
  assert.ok(imports.some(url=>url.includes('chipshow.eu/warehouse-pickup')));
  assert.deepEqual(result.article_ids,['fetched-body-1']);assert.equal(result.report.imported,1);
  assert.equal(JSON.stringify(result).includes('next-day'),false,'listing descriptions cannot become article evidence');
});

test('research rejects unsafe candidates and bounds duplicate and excess results',async()=>{
  const imports:string[]=[],questions=Array.from({length:6},(_,i)=>({id:`q${i}`,zh:'采购问题',en:`Procurement evidence ${i}`,terms:['synthetic research',`entry ${i}`]}));
  let reads=0;
  const links=['file:///etc/passwd','https://user:secret@maker.example.org/a','http://127.0.0.1/private','http://metadata.google.internal/token','/file.pdf','/private/research','https://external.example.org/research',...Array.from({length:8},(_,i)=>`/reference-${i}`),'/reference-0'];
  const result=await discoverPitchEvidence(questions,async url=>{imports.push(url);return url;},async url=>{
    reads++;
    const text=url.endsWith('/robots.txt')?'User-agent: *\nDisallow: /private':`<html>${links.map(link=>`<a href="${link}">Synthetic research</a>`).join('')}</html>`;
    return {status:200,url,headers:new Headers(),body:Buffer.alloc(0),truncated:false,text:()=>text};
  });
  assert.equal(reads,6);assert.equal(imports.length,4);assert.equal(new Set(imports).size,4);
  assert.ok(imports.every(url=>/^https:\/\/www\.chipshow(?:ledusa)?\.(?:com|eu)\/reference-\d$/.test(url)));
  assert.equal(result.report.imported,4);
});

test('research follows an advertised sitemap but respects a denied source',async()=>{
  const requests:string[]=[],imports:string[]=[];
  const result=await discoverPitchEvidence([{id:'q1',zh:'仓储交付',en:'Warehouse delivery',terms:['warehouse','delivery']}],async url=>{imports.push(url);return url;},async url=>{
    requests.push(url);const u=new URL(url);
    const status=u.hostname==='www.chipshowledusa.com'?403:200;
    const text=u.pathname==='/robots.txt'?`User-agent: *\nDisallow: /private\nSitemap: ${u.origin}/source-map.xml`:u.pathname==='/source-map.xml'?`<urlset><url><loc>${u.origin}/warehouse-delivery</loc></url><url><loc>${u.origin}/private/warehouse</loc></url></urlset>`:'<html><p>Public source home</p></html>';
    return {status,url,headers:new Headers(),body:Buffer.alloc(0),truncated:false,text:()=>text};
  });
  assert.equal(requests.filter(url=>url.includes('chipshowledusa.com')).length,1,'a rejected source is not retried at alternative paths');
  assert.equal(imports.length,2);assert.ok(imports.every(url=>url.endsWith('/warehouse-delivery')));assert.equal(result.report.state,'partial');
});

for(const [name,rules] of [
  ['a specific agent overrides the wildcard group','User-agent: ChipshowStudioBot\nDisallow: /private\n\nUser-agent: *\nAllow: /private/warehouse'],
  ['the longest matching agent overrides a shorter match','User-agent: StudioBot\nAllow: /private/warehouse\n\nUser-agent: ChipshowStudioBot\nDisallow: /private'],
  ['equally specific groups combine their rules','User-agent: ChipshowStudioBot\nAllow: /public\n\nUser-agent: chipshowstudiobot\nDisallow: /private\n\nUser-agent: *\nAllow: /private/warehouse'],
])test(`research robots policy: ${name}`,async()=>{
  const imports:string[]=[];
  const result=await discoverPitchEvidence([{id:'q',zh:'提货核对',en:'Warehouse pickup',terms:['warehouse pickup']}],async url=>{imports.push(url);return url;},async url=>{
    const path=new URL(url).pathname;
    const text=path==='/robots.txt'?rules:path==='/sitemap.xml'?'<urlset/>':'<html><a href="/private/warehouse-pickup">Warehouse pickup</a><a href="/public/warehouse-pickup">Warehouse pickup</a></html>';
    return {status:200,url,headers:new Headers(),body:Buffer.alloc(0),truncated:false,text:()=>text};
  });
  assert.equal(result.report.state,'complete');assert.equal(imports.length,3);
  assert.ok(imports.every(url=>new URL(url).pathname==='/public/warehouse-pickup'));
});

test('discovery refuses automatic redirects before a directory can enter a robots-excluded path',async()=>{
  const requests:{url:string;maxRedirects:number|undefined}[]=[],imports:string[]=[];
  const result=await discoverPitchEvidence([{id:'q',zh:'提货核对',en:'Warehouse pickup',terms:['warehouse pickup']}],async url=>{imports.push(url);return url;},async(url,options)=>{
    requests.push({url,maxRedirects:options?.maxRedirects});
    const robots=new URL(url).pathname==='/robots.txt';
    return {status:robots?200:302,url,headers:new Headers(robots?{}:{location:'/private/warehouse-pickup'}),body:Buffer.alloc(0),truncated:false,text:()=>robots?'User-agent: *\nDisallow: /private':''};
  });
  assert.equal(requests.length,6);assert.ok(requests.every(request=>request.maxRedirects===0));
  assert.ok(requests.every(request=>!new URL(request.url).pathname.startsWith('/private')));
  assert.deepEqual(imports,[]);assert.equal(result.report.state,'unavailable');
});

test('research prioritizes page and post sitemaps within a two-child budget',async()=>{
  const requests:string[]=[],imports:string[]=[];
  await discoverPitchEvidence([{id:'q',zh:'仓储交付',en:'Warehouse delivery',terms:['warehouse','delivery']}],async url=>{imports.push(url);return url;},async url=>{
    requests.push(url);const u=new URL(url);
    const text=u.pathname==='/robots.txt'?'User-agent: *\nDisallow: /private':u.pathname==='/'?'<html><p>Source home</p></html>':u.pathname==='/sitemap.xml'?`<sitemapindex>${['users','products','posts','pages'].map(kind=>`<sitemap><loc>${u.origin}/${kind}-sitemap.xml</loc></sitemap>`).join('')}</sitemapindex>`:`<urlset><url><loc>${u.origin}/warehouse-delivery-${u.pathname.slice(1,6)}</loc></url></urlset>`;
    return {status:200,url,headers:new Headers(),body:Buffer.alloc(0),truncated:false,text:()=>text};
  });
  assert.equal(requests.filter(url=>/(?:posts|pages)-sitemap/.test(url)).length,6);
  assert.ok(requests.every(url=>!/(?:users|products)-sitemap/.test(url)));
  assert.equal(imports.length,4);
});

test('automatic body import cannot follow a redirect into an excluded path; existing direct use retains its default',async()=>{
  const old=config.allowPrivateNetworkFetch;config.allowPrivateNetworkFetch=true;
  let targetHits=0;
  const server=http.createServer((req,res)=>{
    if(req.url==='/public-warehouse'){res.writeHead(302,{location:'/private/warehouse'});res.end();return;}
    targetHits++;res.writeHead(200,{'content-type':'text/html'});res.end('<html><head><title>Warehouse guide</title></head><body><article><h1>Warehouse guide</h1><p>'+('Check warehouse delivery documents before pickup. ').repeat(20)+'</p></article></body></html>');
  });
  try{
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();assert.ok(address&&typeof address==='object');
    const url=`http://127.0.0.1:${address.port}/public-warehouse`;
    const source:SourceRow={id:'research-redirect-fixture',name:'fixture',kind:'web_list',config:{detail:{titleSelector:'h1'}},tier:'T2',participation_mode:'isolated',first_party:false,interval_minutes:60,enabled:false,cursor:null,fail_count:0};
    const need={title:true,date:true,body:true,summary:false};
    await assert.rejects(fetchDetail(url,source,need,0),/redirect/i);assert.equal(targetHits,0);
    const ordinary=await fetchDetail(url,source,need);assert.equal(targetHits,1);assert.match(ordinary.body!.text,/warehouse delivery/);
  }finally{config.allowPrivateNetworkFetch=old;await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('shared buyer-topic terms still locate shaped answers and retain question-specific matching',()=>{
  const questions=[
    {id:'delivery',zh:'欧洲仓交付时间',en:'Europe stock warehouse delivery time',need:'reference' as const,terms:['Europe stock','warehouse','delivery'],answer_shape:'number' as const},
    {id:'route',zh:'欧洲仓与原厂直发的条件',en:'Europe stock warehouse versus factory direct',need:'reference' as const,terms:['Europe stock','warehouse','factory direct'],answer_shape:'table' as const},
    {id:'pickup',zh:'欧洲仓提货步骤',en:'Europe stock warehouse pickup steps',need:'reference' as const,terms:['Europe stock','warehouse','pickup'],answer_shape:'steps' as const},
  ];
  const body_html='<p>Europe stock warehouse delivery takes 48 hours after confirmation.</p><table><tr><th>Route</th><th>Condition</th></tr><tr><td>Factory direct</td><td>Compare against Europe stock warehouse availability.</td></tr></table><p>Check Europe stock warehouse pickup documents before collection.</p><p>Europe stock warehouse routing takes 12 hours.</p>';
  const result=answerEvidence(questions,[{id:'verified-body',body_html,body_text:'Fetched source body'}]);
  assert.equal(result.by_question.delivery.length,1);assert.match(result.by_question.delivery[0].quote,/48 hours/);
  assert.equal(result.by_question.route.length,1);assert.equal(result.by_question.pickup.length,1);
  assert.equal(result.by_question.delivery.some(hit=>hit.quote.includes('12 hours')),false,'shared topic words alone do not satisfy a different question');
});

test('shared topic fallback keeps exact P10 parameters and ambiguous questions fail closed',()=>{
  const q={id:'pixels',zh:'P10广告牌像素',en:'P10 billboard pixels',need:'reference' as const,answer_shape:'number' as const,terms:['billboard','pixel pitch','P10']};
  const permits={...q,id:'permits',answer_shape:'steps' as const,terms:['billboard','permit','site survey']};
  const result=answerEvidence([q,permits],[
    {id:'wrong',body_text:'The billboard pixel pitch is 4 mm.'},
    {id:'correct',body_text:'The billboard P10 pixel pitch is 10 mm.'},
  ]);
  assert.deepEqual(result.by_question.pixels.map(hit=>hit.article_id),['correct']);
  assert.deepEqual(result.weak_material_ids,['wrong']);
  assert.deepEqual(answerEvidence([q,{...q,id:'same-terms'}],[{id:'ambiguous',body_text:'The billboard P10 pixel pitch is 10 mm.'}]).by_question.pixels,[]);
});

test('research rejects an HTML challenge at robots and makes no empty-query requests',async()=>{
  let calls=0,imports=0;
  const importer=async()=>{imports++;return 'never';};
  const fetcher=async(url:string)=>{calls++;return {status:200,url,headers:new Headers(),body:Buffer.alloc(0),truncated:false,text:()=>'<html><body>Please authenticate</body></html>'};};
  await discoverPitchEvidence([],importer,fetcher);assert.equal(calls,0);
  const result=await discoverPitchEvidence([{id:'q',zh:'仓储',en:'Warehouse',terms:['warehouse']}],importer,fetcher);
  assert.equal(calls,3);assert.equal(imports,0);assert.equal(result.report.state,'unavailable');assert.match(result.report.failures[0].reason,/采集规则/);
});

test('research failure is recoverable and never turns a search response into evidence',async()=>{
  const result=await discoverPitchEvidence([{id:'q1',zh:'一项具体问题',en:'Specific buyer problem',terms:['synthetic keyword','source condition']}],async()=>{throw new Error('unreachable import');},async()=>{throw new Error('source unavailable');});
  assert.deepEqual(result.article_ids,[]);assert.equal(result.report.state,'unavailable');
  assert.match(result.report.failures[0].reason,/source unavailable/);
});

test('research honors a closed collection valve without external requests',async()=>{
  const old=process.env.COLLECT_ENABLED;process.env.COLLECT_ENABLED='false';
  try{
    const result=await discoverPitchEvidence([{id:'q1',zh:'问题',en:'Question',terms:['test topic']}],async()=>{throw new Error('must not import');},async()=>{throw new Error('must not search');});
    assert.equal(result.report.state,'unavailable');assert.deepEqual(result.report.queries,[]);assert.match(result.report.failures[0].reason,/未启用/);
  }finally{if(old===undefined)delete process.env.COLLECT_ENABLED;else process.env.COLLECT_ENABLED=old;}
});

test('choice cards accept empty optional notes and preserve only supported preference identifiers',()=>{
  const choices=editorialChoicesSchema.parse({revision:1,selected_title:'Buyer checklist',article_ids:['body-1'],outline:[{id:'s1',heading:'核对交付条件',include:true}],additions:['checklist','comparison'],note:''});
  assert.equal(choices.note,'');assert.deepEqual(choices.additions,['checklist','comparison']);
  assert.equal(editorialChoicesSchema.safeParse({...choices,additions:['invent_delivery_days']}).success,false);
  const pitch=pitchSchema.parse({question:'提货前核对哪些资料？',output_type:'guide',existing_url:'',selected_title:'Buyer checklist',primary_article_id:'body-1',outline:[{id:'s1',heading:'核对交付条件',evidence:[{article_id:'body-1',quote:'Check the pickup notice.'}]}],engineer:{mode:'conservative',name:'',reply:'',answers:[]},withheld_numbers:[],editorial_choices:choices,scope:{original_question:'几天能拿到现货？',question:'提货前核对哪些资料？',omitted_questions:['具体库存和交期']}});
  assert.equal(pitch.editorial_choices?.note,'');assert.deepEqual(pitch.scope?.omitted_questions,['具体库存和交期']);
});

test('zero-evidence sections cannot use the new single-source confirmation allowance',()=>{
  const prep={workflow_version:2 as const,version:1,status:'ready' as const,question:'提货前如何核对仓库文件',output_type:'guide' as const,existing_url:'',links:[],started_at:new Date().toISOString(),conclusion:'upgrade',paragraphs:[],facts:[],subquestions:[],edit_plan:[{op:'insert_after',paragraph:'start',subquestion:'q1',reason:'Checklist',facts:[]}]};
  const pitch=pitchSchema.parse({question:prep.question,output_type:'guide',existing_url:'',selected_title:'Pickup checklist',primary_article_id:'body',outline:[{id:'change-0',heading:'Pickup documents',evidence:[]}],engineer:{mode:'conservative',name:'',reply:'',answers:[]},withheld_numbers:[]});
  assert.throws(()=>confirmedFragmentPlan(prep,{article_ids:['body'],outline:[{id:'change-0',include:true}]},pitch),/尚无可引用事实/);
});
