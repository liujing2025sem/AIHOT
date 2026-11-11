import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { fakeApi, startWebServer, visit } from './web-server.ts';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

for(const width of [1440,390])test(`editorial cards show the change and missing evidence above the fold at ${width}`,async()=>{
  let bound=false,adopted=false;
  const card={id:'card-fixture',status:'pending',task_id:null,stale:false,completed:false,baseline_found:null,capacity_full:false,document:{trigger:'A',title:'MBI123刷新率变化影响什么？',change:'1920 Hz → 3840 Hz',reason:'合成控制对照，不是业务结果。',action:'update_page',channels:['blog','social'],existing_url:'https://chipshow.com/refresh',requires_first_party:false,needs_material:true,demand_mentions:2,evidence:[{url:'https://maker.example.test/ic',date:'2026-11-03',revision:2,before:'MBI123 refresh rate is 1920 Hz.',after:'MBI123 refresh rate is 3840 Hz.'}],affected_page:{url:'https://chipshow.com/refresh',paragraph:'The existing page cites MBI123 at 1920 Hz.',article_id:'old-page',revision:1},evidence_checklist:{source_body:true,existing_page_body:false,first_party:null}}};
  const version={...card,id:'version-fixture',document:{...card.document,trigger:'E',title:'LEDVISION V9.8 升级前检查什么？',change:'LEDVISION V9.8',action:'new_tutorial',existing_url:'',requires_first_party:true,affected_page:null,evidence:[{url:'https://maker.example.test/ledvision',date:null,discovered_at:'2026-11-03T08:30:00Z',revision:1,after:'LEDVISION V9.8'}],evidence_checklist:{source_body:false,existing_page_body:null,first_party:false}}};
  const expired={...card,id:'expired-news',expired:true,document:{...card.document,trigger:'D',title:'八天前的短讯',action:'new_brief',existing_url:'',affected_page:null,evidence:[{url:'https://maker.example.test/old-news',date:'2026-10-26',revision:1,after:'An earlier LED announcement.'}],evidence_checklist:{source_body:true,existing_page_body:null,first_party:null}}};
  const api=fakeApi(async(url,_res,req)=>{
    let input='';for await(const chunk of req)input+=chunk;
    if(url.pathname==='/api/admin/me')return {name:'Synthetic operator',csrf:'fixture',dev:false};
    if(url.pathname.endsWith('/materials')&&req.method==='POST'){bound=true;card.document.evidence_checklist.existing_page_body=true;return {id:card.id};}
    if(url.pathname.endsWith('/decision')){adopted=true;return {task_id:'fixture-task'};}
    if(url.pathname.endsWith('/recommendations'))return {rows:[{...card,id:'old-card',stale:true,document:{...card.document,title:'已过期的旧版'}},card,version,expired],weeklyLimit:5,lookbackDays:30,pendingCount:2,activeCount:2,capacityFullCount:0,historicalVersionCount:22,ownershipConfigured:true,metrics:{total:4,adopted:0,rejected:0,adoptionRate:null,update_opportunities:1,updates_completed:0,baseline_missed_updates:0,baseline_unknown:1,denominator:'采纳+否决',reasons:[]},note:'合成检查'};
    if(url.pathname.endsWith('/questions'))return {rows:[],options:{roles:['未知'],dimensions:['部件'],sources:[]}};
    if(url.pathname.endsWith('/demand/profiles'))return {groups:[],lastImportedAt:null,totals:{recordCount:0,groupCount:0},countingBasis:'登记提及'};
    if(url.pathname.endsWith('/demand/batches'))return {rows:[]};
    if(url.pathname.endsWith('/demand/options'))return {};
    if(url.pathname.endsWith('/search-signals'))return {rows:[],batches:[],note:'合成检查'};
    if(url.pathname.endsWith('/review-metrics'))return {tier:30,backtestConfirmed:false,totalDrafts:0,observedDrafts:0,unobservedDrafts:0,interventionRate:null,zeroMissStreak:0,eligible20:false,eligible10:false,note:'合成检查',trend:[]};
    if(url.pathname==='/api/admin/studio')return {rows:[{id:'old-page',title:'Old page',url:'https://chipshow.com/refresh',source_name:'Fixture',published_at:null,publication_time:null,discovered_at:'2026-11-03',body_status:'ok',body_length:100,last_extraction:null}],total:1,page:1,stats:{materials:1,body_ready:1,undated:1,review:0,approved:0},generation:{ready:false,reason:'不调用模型'},sources:[],tasks:[],drafts:[]};
  });
  const web=await startWebServer(api);let browser;
  try{
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width,height:900}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await visit(page,web.origin+'/admin/studio/planning');
    await expect(page.getByText(/已记录 22 个历史版本/)).toBeVisible();
    await expect(page.getByRole('heading',{name:'已过期的旧版',exact:true})).toHaveCount(0);
    const first=page.getByRole('heading',{name:card.document.title}).locator('xpath=ancestor::section[1]');
    await expect(first).toBeVisible();const change=first.getByTitle(card.document.evidence[0].before,{exact:true});await expect(change).toBeVisible();
    const box=await change.boundingBox();assert.ok(box&&box.y+box.height<=900,'change is visible without scrolling');
    await expect(first.getByTitle(card.document.evidence[0].after,{exact:true})).toBeVisible();await expect(first.getByText(/The existing page cites MBI123/).first()).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const versionCard=page.getByRole('heading',{name:version.document.title}).locator('xpath=ancestor::section[1]');
    await expect(versionCard.getByText(/发现日期：2026-11-03 · 原日期未知/)).toBeVisible();
    await page.getByText('已过时短讯 · 1 张（不占待处理名额，展开查看）',{exact:true}).click();
    const expiredCard=page.getByRole('heading',{name:expired.document.title}).locator('xpath=ancestor::section[1]');
    await expect(expiredCard).toBeVisible();await expect(expiredCard.getByRole('button',{name:'已过时，保留参考'})).toBeDisabled();
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(tmpdir(),`aihot-phase-a-cards-${width}.png`),fullPage:true});
    await first.getByRole('link',{name:/旧页正文 ✗/}).click();await page.waitForURL(/bind_card=card-fixture/);
    await page.getByRole('checkbox',{name:'选择 Old page',exact:true}).check();await page.getByRole('button',{name:'绑定所选 1 条素材',exact:true}).click();
    await page.waitForURL('**/admin/studio/planning');await expect(first.getByText('旧页正文 ✓',{exact:true})).toBeVisible();
    assert.equal(bound,true);assert.equal(adopted,false,'evidence binding does not adopt or create a task');assert.deepEqual(errors,[]);
  }finally{await browser?.close();await web.stop();}
});

for (const width of [1440, 390]) test('operator facts persist on reload without starting research or generation at ' + width, async () => {
  const id = 'facts-fixture', endpoint = '/api/admin/studio/pitches/' + id;
  const writes: { path: string; body: any }[] = [];
  let version = 2;
  let facts: Record<string, unknown>[] = [];
  const api = fakeApi(async (url, _res, req) => {
    if (url.pathname === '/api/admin/me') return { name: 'Synthetic operator', csrf: 'fixture', dev: false };
    if (url.pathname === '/api/admin/studio/pitches') return { rows: [] };
    if (url.pathname === endpoint + '/facts') {
      let text = ''; for await (const chunk of req) text += chunk;
      const body = JSON.parse(text); writes.push({ path: url.pathname, body });
      assert.equal(body.version, version);
      facts = body.facts.map((fact: Record<string, unknown>, index: number) => ({ ...fact, id: fact.id ?? 'operator-' + index, verification: 'operator_supplied' }));
      return { id, version: ++version, status: 'insufficient', facts, model_calls: 0 };
    }
    if (url.pathname === endpoint) return { id, title: 'LED 尺寸核对', version, task_id: null, status: 'insufficient', prep: {
      workflow_version: 2, question: 'LED 尺寸核对', output_type: 'guide', existing_url: '', links: [], materials: [], operator_facts: facts,
    } };
  });
  const web = await startWebServer(api); let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route('**/*', route => new URL(route.request().url()).origin === web.origin ? route.continue() : route.abort());
    await visit(page, web.origin + '/admin/studio/pitch?id=' + id);
    await page.getByText('我有原始资料或需要更正的事实', { exact: true }).click();
    await page.getByRole('button', { name: '添加事实', exact: true }).click();
    await page.getByRole('textbox', { name: '事实内容 1', exact: true }).fill('此型号宽度 960 mm，需以最终安装图为准。');
    await page.getByRole('textbox', { name: '事实出处 1', exact: true }).fill('合成工程回复，仅用于测试');
    await expect(page.getByRole('button', { name: '继续自动查找资料', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '保存事实，不调用模型', exact: true }).click();
    await expect(page.getByText('已保存 1 条', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '继续自动查找资料', exact: true })).toBeEnabled();
    await page.reload();
    await page.getByText('我有原始资料或需要更正的事实', { exact: true }).click();
    await expect(page.getByRole('textbox', { name: '事实内容 1', exact: true })).toHaveValue('此型号宽度 960 mm，需以最终安装图为准。');
    await expect(page.getByText('用户补充 · 待核对', { exact: true })).toBeVisible();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, endpoint + '/facts');
    assert.equal(writes[0].body.facts[0].verification, undefined);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (process.env.AIHOT_VISUAL_DIR) {
      mkdirSync(process.env.AIHOT_VISUAL_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.AIHOT_VISUAL_DIR, 'facts-' + width + '.png'), fullPage: true });
    }
  } finally { await browser?.close(); await web.stop(); }
});

test('manual editorial card uses the saved question version, binds dated evidence and reopens the rejected card without generation',async()=>{
  const question={id:'question-mip',version:7,document:{question:'MiP封装怎样影响显示屏选型？',question_en:'How does MiP affect LED display selection?',keywords_zh:['MiP封装'],keywords_en:['MiP LED'],roles:['工程师'],scenario:'显示屏选型',dimension:'部件',existing_url:'',existing_url_provenance:'operator_entered',condition_refs:[],source_ids:[],demand_evidence:[],keywords:['MiP LED'],content_type:'explainer',requires_first_party:false,active:true}};
  const evidence:{url:string;date:string|null;revision:number|null}[]=[];
  const card={id:'manual-mip',question_id:question.id,status:'pending',task_id:null,stale:false,completed:false,baseline_found:null,document:{trigger:'M',title:question.document.question,change:'运营主动选择',reason:'人工选择已保存的问题，等待绑定事实原文。',action:'new_explainer',channels:['blog'],existing_url:'',requires_first_party:false,needs_material:true,demand_mentions:0,evidence,evidence_checklist:{source_body:false,existing_page_body:null,first_party:null}}};
  let created=false;
  const writes:{method:string|undefined;path:string;body:unknown}[]=[];
  const manualPath='/api/admin/studio/recommendations/manual';
  const api=fakeApi(async(url,_res,req)=>{
    let input='';for await(const chunk of req)input+=chunk;
    const body:unknown=input?JSON.parse(input):undefined;
    if(req.method!=='GET'&&req.method!=='HEAD'&&url.pathname!=='/api/site/track')writes.push({method:req.method,path:url.pathname,body});
    if(url.pathname==='/api/admin/me')return {name:'Synthetic operator',csrf:'fixture',dev:false};
    if(url.pathname===manualPath){const first=!created;created=true;return {id:card.id,created:first,status:card.status,task_id:card.task_id};}
    if(url.pathname===`/api/admin/studio/recommendations/${card.id}/materials`){evidence.push({url:'https://maker.example.test/mip',date:'2025-05-15',revision:3});card.document.evidence_checklist.source_body=true;card.document.needs_material=false;return {id:card.id};}
    if(url.pathname===`/api/admin/studio/recommendations/${card.id}/decision`){card.status='rejected';return {id:card.id};}
    if(url.pathname.endsWith('/recommendations'))return {rows:created?[card]:[],weeklyLimit:5,lookbackDays:7,pendingCount:created&&card.status==='pending'?1:0,activeCount:created?1:0,capacityFullCount:0,ownershipConfigured:true,metrics:{total:0,adopted:0,rejected:0,adoptionRate:null,manual_total:created?1:0,manual_adopted:0,manual_rejected:card.status==='rejected'?1:0,update_opportunities:0,updates_completed:0,baseline_missed_updates:0,baseline_unknown:0,denominator:'自动建议的采纳+否决，不含人工选题',reasons:[]},note:'合成检查'};
    if(url.pathname.endsWith('/questions'))return {rows:[question,{...question,id:'paused-question',document:{...question.document,question:'已暂停的问题',active:false}}],options:{roles:['工程师'],dimensions:['部件'],sources:[]}};
    if(url.pathname.endsWith('/demand/profiles'))return {groups:[],lastImportedAt:null,totals:{recordCount:0,groupCount:0},countingBasis:'登记提及'};
    if(url.pathname.endsWith('/demand/batches'))return {rows:[]};
    if(url.pathname.endsWith('/demand/options'))return {};
    if(url.pathname.endsWith('/search-signals'))return {rows:[],batches:[],note:'合成检查'};
    if(url.pathname.endsWith('/review-metrics'))return {tier:30,backtestConfirmed:false,totalDrafts:0,observedDrafts:0,unobservedDrafts:0,interventionRate:null,zeroMissStreak:0,eligible20:false,eligible10:false,note:'合成检查',trend:[]};
    if(url.pathname==='/api/admin/studio')return {rows:[{id:'mip-source',title:'Historical MiP source',url:'https://maker.example.test/mip',source_name:'Fixture',published_at:'2025-05-15T00:00:00Z',publication_time:'2025-05-15',discovered_at:'2026-11-03',body_status:'ok',body_length:100,last_extraction:null}],total:1,page:1,stats:{materials:1,body_ready:1,undated:0,review:0,approved:0},generation:{ready:false,reason:'不调用模型'},sources:[],tasks:[],drafts:[]};
  });
  const web=await startWebServer(api);let browser;
  try{
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:900}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await visit(page,web.origin+'/admin/studio/planning?tab=questions');
    const savedQuestion=page.getByRole('heading',{name:question.document.question,exact:true}).locator('xpath=ancestor::article[1]');
    const pitchHref='/admin/studio/pitch?question_id='+question.id;
    await expect(savedQuestion.getByRole('link',{name:'进入命题备料',exact:true})).toHaveAttribute('href',pitchHref);
    await expect(page.getByRole('heading',{name:'已暂停的问题',exact:true}).locator('xpath=ancestor::article[1]').getByRole('button',{name:'发起人工选题',exact:true})).toBeDisabled();
    await savedQuestion.getByRole('button',{name:'发起人工选题',exact:true}).click();
    await page.waitForURL('**/admin/studio/planning?tab=recommendations');
    const manualCard=page.getByRole('heading',{name:card.document.title,exact:true}).locator('xpath=ancestor::section[1]');
    await expect(manualCard.getByRole('link',{name:'进入命题备料',exact:true})).toHaveAttribute('href',pitchHref);
    await expect(manualCard.getByText('人工选题 · 新写解释文/工具页',{exact:true})).toBeVisible();
    await expect(manualCard.getByText('选题依据：运营主动选择的问题；不代表自动发现的新变化或近期新闻。',{exact:true})).toBeVisible();
    await expect(manualCard.getByText(/旧：|→ 新：|变化：/)).toHaveCount(0);
    await expect(manualCard.getByText('需求：0条登记提及 · 搜索：0条查询证据（非流量）',{exact:true})).toBeVisible();
    await expect(page.getByText('人工选题：1 张 · 已采纳 0 · 已否决 0（不计入自动建议采纳率）',{exact:true})).toBeVisible();
    await expect(page.getByText(/自动建议采纳率 未知/)).toBeVisible();
    assert.deepEqual(writes,[{method:'POST',path:manualPath,body:{question_id:question.id,question_version:7}}],'creation only posts the saved question version; it does not create a task, adopt or invoke a model');
    const bind=manualCard.getByRole('link',{name:'原文正文 ✗ · 去绑定',exact:true});
    await expect(bind).toHaveAttribute('href',`/admin/studio?tab=materials&bind_card=${card.id}`);
    await bind.click();await page.waitForURL(/bind_card=manual-mip/);
    await page.getByRole('checkbox',{name:'选择 Historical MiP source',exact:true}).check();
    await page.getByRole('button',{name:'绑定所选 1 条素材',exact:true}).click();await page.waitForURL('**/admin/studio/planning');
    await expect(manualCard.getByText('原文正文 ✓',{exact:true})).toBeVisible();
    await expect(manualCard.getByText('原日期：2025-05-15 · 素材版本：3',{exact:true})).toBeVisible();
    await expect(manualCard.getByText(/发现日期：|2026-11-03|旧：|→ 新：|变化：/)).toHaveCount(0);
    await manualCard.getByRole('button',{name:'否决',exact:true}).click();await manualCard.getByRole('textbox',{name:'否决理由',exact:true}).fill('保留原文供参考，本次暂不采用。');await manualCard.getByRole('button',{name:'记录否决',exact:true}).click();
    await expect(page.getByText('人工选题：1 张 · 已采纳 0 · 已否决 1（不计入自动建议采纳率）',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'问题地图',exact:true}).click();await savedQuestion.getByRole('button',{name:'发起人工选题',exact:true}).click();
    await page.waitForURL('**/admin/studio/planning?tab=recommendations');
    await expect(page.getByText('已找到现有人工选题卡，保留原处理结果。',{exact:false})).toBeVisible();
    await expect(manualCard.getByText('已否决',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:card.document.title,exact:true})).toHaveCount(1);
    await expect(page.getByRole('link',{name:'查看选题卡 →',exact:true})).toHaveAttribute('href',`#recommendation-${card.id}`);
    assert.deepEqual(writes,[{method:'POST',path:manualPath,body:{question_id:question.id,question_version:7}},{method:'POST',path:`/api/admin/studio/recommendations/${card.id}/materials`,body:{article_ids:['mip-source']}},{method:'POST',path:`/api/admin/studio/recommendations/${card.id}/decision`,body:{action:'reject',reason:'保留原文供参考，本次暂不采用。'}},{method:'POST',path:manualPath,body:{question_id:question.id,question_version:7}}]);
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await web.stop();}
});

test('pitch desk keeps raw text private and generates only after explicit outline approval on mobile',async()=>{
  const base='/api/admin/studio',pitches=base+'/pitches',redact=base+'/pitch/redact';
  const questionId='fixture-question',savedTitle='安装前要核对什么？',raw='安装前要核对什么？联系 fixture@example.test',sanitized='安装前要核对什么？联系 [邮箱]';
  const relatedUrl='https://existing.example.test/guide';
  const oldPage={id:'fixture-old-page',title:'Existing installation page',url:relatedUrl,revision:4,published_at:null,publication_time:null,snippet:'Check the installation drawing.',hit_count:1,first_party:true,existing_page:true};
  const material={id:'fixture-material',title:'Installation reference',url:'https://maker.example.test/reference',revision:2,published_at:'2026-09-03T00:00:00Z',publication_time:'2026-09-03',snippet:'Mounting depends on the installation drawing.',hit_count:2,first_party:true};
  const prep={
    question:sanitized,output_type:'auto',existing_url:'',links:[],question_en:'What should I check before installation?',keywords:['installation'],
    materials:[material],related_pages:[{title:oldPage.title,url:oldPage.url}],
    outline:[{id:'s1',heading:'检查图纸',evidence:[{article_id:material.id,quote:material.snippet}],gap:'缺适用条件',action:'请工程师确认'}],
    titles:[{title:'Installation drawing checklist',anchor:'Check the drawing before mounting.',article_id:oldPage.id,quote:oldPage.snippet}],hooks:[{title:'Start with the drawing',anchor:oldPage.snippet}],
    engineer_questions:[{id:'q1',question:'怎样说明安装条件？',section_ids:['s1'],withheld_numbers:['30 mm'],options:[
      {id:'A',label:'以图纸为准',instruction:'不写具体数字',conservative:true},{id:'B',label:'使用确认后的范围',instruction:'仅限已核配置',conservative:false},
    ]}],
    blacklist:{configured:false,blocked:0,pending:0},started_at:'2026-11-08T08:01:00Z',finished_at:'2026-11-08T08:02:00Z',
  };
  const id='fixture-pitch',taskId='fixture-task';
  let version=1, status='preparing', task:string|null=null,reads=0,reuse=false,choiceRevision=0;
  let editorialChoices:Record<string,unknown>|undefined;
  const writes:{method:string|undefined;path:string;body:unknown}[]=[];
  const requestedUrls:string[]=[];
  const api=fakeApi(async(url,_res,req)=>{
    requestedUrls.push(url.pathname+url.search);
    if(url.pathname==='/api/admin/me')return {name:'Synthetic operator',csrf:'fixture',dev:false};
    if(url.pathname===base+'/questions')return {rows:[{id:questionId,document:{question:savedTitle,existing_url:'',active:true}}]};
    if(url.pathname===base)return {rows:[],total:0,page:1,stats:{materials:0,body_ready:0,undated:0,review:0,approved:0},generation:{ready:false,reason:'模拟接口'},sources:[],tasks:task?[{id:task,state:'waiting',materials:1,created_at:'2026-11-08T08:03:00Z',drafts:0,articles:[]}]:[],drafts:[]};
    if(url.pathname===base+'/review-metrics')return {};
    if(url.pathname!==redact&&!url.pathname.startsWith(pitches))return;
    let input='';for await(const chunk of req)input+=chunk;
    const body:unknown=input?JSON.parse(input):undefined;
    if(req.method!=='GET')writes.push({method:req.method,path:url.pathname,body});
    if(url.pathname===redact)return {text:sanitized,redactions:[{kind:'email',count:1}]};
    if(url.pathname===pitches&&req.method==='POST')return {id,reused:reuse,...(reuse?{task_id:taskId}:{})};
    if(url.pathname===pitches&&req.method==='GET')return {rows:version===1&&!reads?[]:[{id,title:sanitized,status,task_id:task,version}]};
    if(url.pathname===pitches+'/'+id&&req.method==='PATCH'){version++;status=version===2?'failed':'ready';return {id,version,status};}
    if(url.pathname===pitches+'/'+id&&req.method==='GET'){
      if(++reads===2)status='insufficient';
      const activePrep={question:sanitized,output_type:'auto',existing_url:'',links:[],started_at:prep.started_at};
      return {id,title:sanitized,status,version,task_id:task,prep:status==='preparing'?activePrep:version===1?prep:
        status==='failed'?{...activePrep,output_type:'update',existing_url:relatedUrl,links:[material.url],error:'模拟取文失败：原页面超时。'}:
          {...prep,output_type:'update',existing_url:relatedUrl,links:[material.url],materials:[material,oldPage],editorial_choices:editorialChoices}};
    }
    if(url.pathname===pitches+'/'+id+'/choices'){editorialChoices={...(body as Record<string,unknown>),revision:++choiceRevision};return {choice_revision:choiceRevision};}
    if(url.pathname===pitches+'/'+id+'/confirm'){status='confirmed';version++;task=taskId;return {id,status,task_id:task};}
    if(url.pathname===pitches+'/'+id+'/generate')return {id,task_id:task,queued:true};
  });
  const web=await startWebServer(api);let browser;
  try{
    browser=await chromium.launch();
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await visit(page,web.origin+'/admin/studio');
    await expect(page.getByRole('link',{name:'写专业文章',exact:true})).toHaveAttribute('href','/admin/studio/pitch');
    await visit(page,web.origin+'/admin/studio/pitch?question_id='+questionId);
    const question=page.getByRole('textbox',{name:'问题或命题',exact:true});
    const preview=page.getByRole('button',{name:'预览脱敏',exact:true}),save=page.getByRole('button',{name:'保存并开始备料',exact:true});
    const consent=page.getByRole('checkbox',{name:'我已核对，脱敏文本可以保存'});
    await expect(question).toHaveValue(savedTitle);
    await question.fill(raw);await preview.click();
    await expect(page.getByText('邮箱 1 处',{exact:false})).toBeVisible();
    await expect(save).toBeDisabled();
    await consent.check();await expect(save).toBeEnabled();
    await question.fill(raw+'?');await expect(save).toBeDisabled();
    await preview.click();await consent.check();await save.click();
    await page.waitForURL('**/admin/studio/pitch?id='+id);
    await expect(page.getByRole('heading',{name:'后台正在备料'})).toBeVisible();
    await expect(page.getByRole('heading',{name:'证据不足'})).toBeVisible({timeout:9000});
    await expect(page.getByRole('button',{name:'生成英文稿',exact:true})).toHaveCount(0);
    await expect(page.getByText('公司事实黑名单未配置。',{exact:false})).toBeVisible();
    assert.deepEqual(writes,[{method:'POST',path:redact,body:{question:raw}},{method:'POST',path:redact,body:{question:raw+'?'}},
      {method:'POST',path:pitches,body:{question:sanitized,privacy_confirmed:true,output_type:'auto',existing_url:'',links:[],question_id:questionId}}]);

    await page.getByText('补参考链接或调整设置（选填）',{exact:true}).click();
    await page.getByRole('button',{name:'用作已有页面',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'已有页面 URL'})).toHaveValue(relatedUrl);
    await page.getByRole('textbox',{name:'公开线索链接'}).fill(material.url);
    await page.getByRole('button',{name:'重新备料（调用模型）',exact:true}).click();
    await expect(page.getByText('模拟取文失败：原页面超时。')).toBeVisible();
    await page.getByText('补参考链接或调整设置（选填）',{exact:true}).click();
    await expect(page.getByRole('textbox',{name:'公开线索链接'})).toHaveValue(material.url);
    await page.getByRole('button',{name:'重新备料（调用模型）',exact:true}).click();
    const confirm=page.getByRole('button',{name:'确认大纲并生成全文',exact:true});
    await page.getByRole('button',{name:'核对依据',exact:true}).click();
    await page.getByRole('checkbox',{name:'选用 '+oldPage.title,exact:true}).uncheck();
    await page.getByRole('button',{name:'方向与大纲',exact:true}).click();
    await expect(page.getByRole('radio',{name:/Installation drawing checklist/})).toBeDisabled();
    await expect(confirm).toBeDisabled();
    await expect(page.getByText('请选至少 2 条素材，或选用已有页面正文。')).toBeVisible();
    await page.getByRole('button',{name:'核对依据',exact:true}).click();
    await page.getByRole('checkbox',{name:'选用 '+oldPage.title,exact:true}).check();
    await page.getByRole('checkbox',{name:'选用 '+material.title,exact:true}).uncheck();
    await page.getByRole('button',{name:'方向与大纲',exact:true}).click();
    await page.getByRole('radio',{name:/Installation drawing checklist/}).check();
    await expect(page.getByText('缺证据：缺适用条件')).toBeVisible();
    await page.getByRole('textbox',{name:'第 1 节标题',exact:true}).fill('先核对图纸');
    await page.getByRole('button',{name:'工程确认',exact:true}).click();
    await page.getByRole('radio',{name:'录入工程师回复',exact:true}).check();
    await page.getByRole('textbox',{name:'工程师原回复',exact:true}).fill('1B');
    await expect(confirm).toBeDisabled();
    await page.getByRole('textbox',{name:'工程师姓名',exact:true}).fill('模拟工程师');
    await expect(confirm).toBeDisabled();
    await page.getByRole('textbox',{name:'工程师原回复',exact:true}).fill('1B 依据是安装图纸');
    await expect(confirm).toBeEnabled();
    await page.getByRole('radio',{name:'用保守写法',exact:true}).check();
    await expect(page.getByText('保守写法省略：30 mm')).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);

    await confirm.click();
    await expect(page.getByText(/英文稿正在后台处理/).first()).toBeVisible();
    assert.deepEqual(writes.slice(3),[
      {method:'PATCH',path:pitches+'/'+id,body:{version:1,links:[material.url],output_type:'update',existing_url:relatedUrl}},
      {method:'PATCH',path:pitches+'/'+id,body:{version:2,links:[material.url],output_type:'update',existing_url:relatedUrl}},
      {method:'POST',path:pitches+'/'+id+'/choices',body:{version:3,choice_revision:0,article_ids:[oldPage.id],selected_title:prep.titles[0].title,
        outline:[{id:'s1',heading:'先核对图纸',include:true}],additions:[],note:''}},
      {method:'POST',path:pitches+'/'+id+'/confirm',body:{version:3,choice_revision:1,article_ids:[oldPage.id],selected_title:prep.titles[0].title,output_type:'update',
        outline:[{id:'s1',heading:'先核对图纸',include:true}],engineer:{mode:'conservative',name:'',reply:'',answers:[{question_id:'q1',choice:'A',note:''}]}}},
      {method:'POST',path:pitches+'/'+id+'/generate',body:{}},
    ]);
    assert.deepEqual(writes.at(-1),{method:'POST',path:pitches+'/'+id+'/generate',body:{}});
    await page.reload();
    await expect(page.getByRole('link',{name:'继续原采编任务 →',exact:true})).toHaveAttribute('href','/admin/studio?tab=tasks#task-'+taskId);
    await expect(page.getByRole('button',{name:'生成英文稿',exact:true})).toHaveCount(0);

    reuse=true;
    await page.getByRole('link',{name:'新命题',exact:true}).click();
    await question.fill(savedTitle);await preview.click();await consent.check();await save.click();
    await page.waitForURL('**/admin/studio?tab=tasks#task-'+taskId);
    await expect(page.locator('#task-'+taskId)).toBeVisible();
    assert.equal(writes.filter(write=>write.path.endsWith('/generate')).length,1);
    assert.ok(requestedUrls.every(url=>!decodeURIComponent(url).includes('fixture@example.test')));
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await web.stop();}
});

function operatorDeskFixture() {
  const writes: { method: string | undefined; path: string; body: unknown }[] = [];
  const generation = { ready: true, reason: '模拟写作接口已就绪。' };
  const rows = Array.from({ length: 6 }, (_, index) => ({
    id: `material-${index + 1}`, title: index === 5 ? '缺正文的公告' : `LED announcement ${index + 1}`,
    url: `https://maker.example.test/announcement-${index + 1}`, source_name: 'Official fixture',
    published_at: '2026-11-08T08:00:00Z', publication_time: '2026-11-08', discovered_at: '2026-11-08T09:00:00Z',
    body_status: index === 5 ? 'unconfirmed' : 'ok', body_length: index === 5 ? 0 : 200, last_extraction: null,
  }));
  const draft = { id: 'real-review-fixture', title_zh: '户外屏尺寸指南', title_en: 'Outdoor LED dimensions', status: 'in_review', version: 4, updated_at: '2026-11-08T10:00:00Z' };
  // Synthetic API contract only: a selected batch yields one pending issue, never business news or a publication receipt.
  const briefTaskId = 'brief-task-fixture';
  const briefDraft = { id: 'brief-draft-fixture', title_zh: '模拟短讯合集', title_en: 'Synthetic LED brief', status: 'in_review', version: 1, updated_at: '2026-11-08T10:05:00Z' };
  let briefCreated = false;
  const api = fakeApi(async (url, _res, req) => {
    if (!['GET', 'HEAD'].includes(req.method ?? 'GET') && url.pathname !== '/api/site/track') {
      let input = ''; for await (const chunk of req) input += chunk;
      writes.push({ method: req.method, path: url.pathname, body: input ? JSON.parse(input) : undefined });
    }
    if (url.pathname === '/api/admin/me') return { name: 'Synthetic operator', csrf: 'fixture', dev: false };
    if (url.pathname === '/api/admin/nav-counts') return {};
    if (url.pathname === '/api/admin/studio/review-metrics') return { tier: 30, backtestConfirmed: false, totalDrafts: 1, observedDrafts: 0, unobservedDrafts: 1, interventionRate: null, zeroMissStreak: 0, eligible20: false, eligible10: false, note: '模拟审稿情况', trend: [] };
    if (url.pathname === '/api/admin/studio/publishing/settings') return { mode: 'review', enabled: false, daily_limits: { brief: 1, article: 2, guide: 1, update: 0 } };
    if (url.pathname === '/api/admin/studio/publishing/reviews') return { rows: [], weekly: { reasons: [] } };
    if (url.pathname === '/api/admin/studio/briefs' && req.method === 'POST') {
      briefCreated = true;
      return { task_id: briefTaskId, state: 'queued' };
    }
    if (url.pathname === '/api/admin/studio/briefs/' + briefTaskId && req.method === 'GET' && briefCreated) return {
      state: 'in_review', message: '模拟结果：1 篇短讯待审稿，尚未发布。', drafts: [{ id: briefDraft.id, status: briefDraft.status }],
    };
    if (url.pathname === '/api/admin/studio') return { rows, total: rows.length, page: 1, stats: { materials: rows.length, body_ready: 5, undated: 0, review: briefCreated ? 2 : 1, approved: 0 }, generation, sources: [],
      tasks: briefCreated ? [{ id: briefTaskId, state: 'received', materials: 5, created_at: '2026-11-08T10:04:00Z', drafts: 1, articles: rows.slice(0, 5).map(({ id, title }) => ({ id, title })), decisions: null, brief: { schema: 'aihot-brief-selection/1' } }] : [],
      drafts: briefCreated ? [draft, briefDraft] : [draft],
    };
  });
  return { api, writes, generation, draft, briefTaskId, briefDraft };
}

for (const width of [1440, 390]) test(`operator sidebar has one current destination and a safe review shortcut at ${width}`, async () => {
  const fixture = operatorDeskFixture();
  const web = await startWebServer(fixture.api); let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await visit(page, web.origin + '/admin/studio');
    await expect(page.getByRole('heading', { name: '今日选稿', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '继续审稿', exact: true })).toHaveAttribute('href', '/admin/studio/drafts/' + fixture.draft.id);
    const trigger = page.getByRole('button', { name: '打开工作台导航', exact: true });
    const dialog = page.getByRole('dialog');
    if (width === 390) {
      await trigger.click(); await expect(dialog).toBeVisible();
    }
    for (const name of ['今日选稿', '专业内容', '我的稿件', '发布记录']) await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '今日选稿', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('a[aria-current="page"]:visible')).toHaveCount(1);
    await expect(page.getByRole('link', { name: '专业内容', exact: true })).toHaveAttribute('href', '/admin/studio/pitch');
    await expect(page.getByRole('link', { name: '发布记录', exact: true })).toHaveAttribute('href', '/admin/studio/published');
    if (width === 390) {
      await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
      await trigger.click();
    }
    await page.getByRole('link', { name: '我的稿件', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/admin/studio' && url.searchParams.get('tab') === 'drafts');
    if (width === 390) { await expect(dialog).toHaveCount(0); await trigger.click(); }
    await expect(page.getByRole('link', { name: '我的稿件', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: '今日选稿', exact: true })).not.toHaveAttribute('aria-current', 'page');
    await expect(page.locator('a[aria-current="page"]:visible')).toHaveCount(1);
    if (width === 390) await page.keyboard.press('Escape');

    await visit(page, web.origin + '/admin/studio?tab=drafts&status=in_review');
    if (width === 390) await trigger.click();
    await expect(page.getByRole('link', { name: '我的稿件', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('a[aria-current="page"]:visible')).toHaveCount(1);
    if (width === 390) await page.keyboard.press('Escape');
    await visit(page, web.origin + '/admin/studio');
    await page.getByRole('checkbox', { name: '选择 LED announcement 1', exact: true }).check();
    assert.deepEqual(fixture.writes, [], 'navigation, existing-draft discovery and selecting material never start a model or publication command');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await web.stop(); }
});

for (const width of [1440, 390]) test(`selected material actions keep single-draft limits and compose five ready sources into one review issue at ${width}`, async () => {
  const fixture = operatorDeskFixture();
  const web = await startWebServer(fixture.api); let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await visit(page, web.origin + '/admin/studio');
    const selected = page.getByRole('region', { name: '已选素材操作', exact: true });
    const generate = selected.getByRole('button', { name: '一键评估并成稿', exact: true });
    const compose = selected.getByRole('button', { name: '合成一期短讯', exact: true });
    for (let number = 1; number <= 4; number++) {
      await page.getByRole('checkbox', { name: `选择 LED announcement ${number}`, exact: true }).check();
      await expect(generate).toBeEnabled(); await expect(compose).toHaveCount(0);
    }
    await expect(selected).toBeVisible(); await expect(selected).toContainText(/已选\s*4\s*条/);
    await page.getByRole('checkbox', { name: '选择 LED announcement 5', exact: true }).check();
    await expect(selected).toContainText(/已选\s*5\s*条/); await expect(generate).toHaveCount(0); await expect(compose).toBeEnabled();
    await expect(selected).toContainText(/5 个独立事件，合成 1 篇短讯待审稿/);
    await page.getByRole('checkbox', { name: '选择 缺正文的公告', exact: true }).check();
    await expect(selected).toContainText(/已选\s*6\s*条/); await expect(compose).toBeDisabled();
    await expect(selected).toContainText(/缺.*正文|正文.*缺|先补齐/);
    for (let number = 2; number <= 5; number++) await page.getByRole('checkbox', { name: `选择 LED announcement ${number}`, exact: true }).uncheck();
    await expect(selected).toContainText(/已选\s*2\s*条/); await expect(generate).toBeDisabled();
    await expect(compose).toHaveCount(0);
    await expect(selected).toContainText(/缺.*正文|正文.*缺|先补齐/);

    fixture.generation.ready = false; fixture.generation.reason = '模型调用未开启，请先配置写作渠道。';
    await page.reload();
    await page.getByRole('checkbox', { name: '选择 LED announcement 1', exact: true }).check();
    await expect(generate).toBeDisabled(); await expect(selected).toContainText(fixture.generation.reason);
    for (let number = 2; number <= 5; number++) await page.getByRole('checkbox', { name: `选择 LED announcement ${number}`, exact: true }).check();
    await expect(generate).toHaveCount(0); await expect(compose).toBeDisabled(); await expect(selected).toContainText(fixture.generation.reason);
    assert.deepEqual(fixture.writes, [], 'selection and disabled-action explanations do not create tasks, call models or publish');

    fixture.generation.ready = true; fixture.generation.reason = '模拟写作接口已就绪。';
    await page.reload();
    for (let number = 1; number <= 5; number++) await page.getByRole('checkbox', { name: `选择 LED announcement ${number}`, exact: true }).check();
    await expect(compose).toBeEnabled(); await compose.click();
    await page.waitForURL(url => url.pathname === '/admin/studio' && url.searchParams.get('tab') === 'tasks' && url.searchParams.get('brief_task') === fixture.briefTaskId);
    const task = page.locator('#task-' + fixture.briefTaskId);
    await expect(task).toHaveCount(1); await expect(task).toContainText('一期短讯 · 5 条选材');
    await expect(task.getByRole('button', { name: '评估并成稿', exact: true })).toHaveCount(0);
    const review = task.getByRole('link', { name: '打开本期短讯审稿 →', exact: true });
    await expect(review).toHaveCount(1); await expect(review).toHaveAttribute('href', '/admin/studio/drafts/' + fixture.briefDraft.id);
    await expect(task).toContainText('1 篇短讯待审稿，尚未发布。');
    assert.deepEqual(fixture.writes, [{ method: 'POST', path: '/api/admin/studio/briefs', body: { article_ids: [1, 2, 3, 4, 5].map(number => `material-${number}`) } }], 'five-source selection issues one composition command, never the per-material generation or publication command');
    await visit(page, web.origin + '/admin/studio?tab=drafts&status=in_review');
    await expect(page.getByRole('heading', { name: fixture.briefDraft.title_zh, exact: true })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: fixture.draft.title_zh, exact: true })).toHaveCount(1);
    assert.equal(fixture.writes.length, 1, 'opening the draft list does not repeat composition');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await web.stop(); }
});

test('pitch v2 saves padded default headings consistently and only retries the chosen fragment after consent on a narrow screen',async()=>{
  const pitches='/api/admin/studio/pitches', id='pitch-v2', url=pitches+'/'+id;
  const oldUrl='https://guide.example.test/dimensions', sourceUrl='https://reference.example.test/dimensions';
  const materials=[
    {id:'page',title:'旧版尺寸指南',url:oldUrl,snippet:'Standard size table.',hit_count:2,first_party:true,existing_page:true},
    {id:'weak',title:'弱相关行业新闻',url:'https://news.example.test/update',snippet:'Billboard industry news.',hit_count:1,first_party:false},
    {id:'reference',title:'尺寸参考资料',url:sourceUrl,snippet:'Verify the enclosure before ordering.',hit_count:3,first_party:false},
  ];
  const paragraphs=[
    {id:'p1',text:'旧版标准尺寸表',html:'<p>Original table</p>'},
    {id:'p2',text:'旧版订购提示',html:'<p>Order today</p>'},
  ];
  const calc={id:'c1',kind:'calc',statement:'按点间距换算画面像素',attribution:'单位换算'};
  const source={id:'f1',kind:'source',statement:'下单前应核对外壳尺寸',quote:materials[2].snippet,url:sourceUrl,attribution:'尺寸参考资料',article_id:'reference'};
  const covered='原文有哪些标准尺寸？', gap='下单前要核对什么尺寸？', pixels='如何换算画面像素？';
  const change=[
    {op:'keep',paragraph:'p1',facts:[]},
    {op:'revise',paragraph:'p2',subquestion:'q2',heading:'下单前的检查清单',reason:'旧页没有下单前的检查步骤',facts:['f1']},
    {op:'insert_after',paragraph:'p2',subquestion:'q3',heading:'画面像素换算示例',reason:'买家需要知道画面分辨率',facts:['c1']},
    {op:'insert_after',paragraph:'p1',subquestion:'q3',heading:'额外的换算附录',reason:'可提供更多换算示例',facts:['c1']},
  ];
  const safeHtml='<p id="probe" onclick="window.fixtureRan=true">New '+ 'x'.repeat(360) + '</p><script>window.fixtureRan=true</script>';
  const chinese='中文审稿：先核对外壳尺寸，再下单。';
  const writes:{path:string;body:unknown}[]=[];
  let phase:'insufficient'|'preparing'|'ready'|'waiting'|'running'|'unknown'|'retry-queued'|'done'='insufficient', version=7, polls=0, legacyUpgraded=false,choiceRevision=0;
  let editorialChoices:Record<string,unknown>|undefined;
  const api=fakeApi(async(requestUrl,_res,req)=>{
    const pathname=requestUrl.pathname;
    if(pathname==='/api/admin/me')return {name:'Synthetic operator',csrf:'fixture',dev:false};
    if(pathname===pitches)return {rows:[]};
    if(pathname===url+'/evidence'){
      let input='';for await(const chunk of req)input+=chunk;
      writes.push({path:pathname,body:JSON.parse(input)});phase='preparing';version++;polls=0;
      return {id,version,status:'preparing',queued:true,model_calls:0};
    }
    if(pathname===url+'/choices'){
      let input='';for await(const chunk of req)input+=chunk;
      const body=JSON.parse(input);writes.push({path:pathname,body});editorialChoices={...body,revision:++choiceRevision};
      return {choice_revision:choiceRevision};
    }
    if(pathname===url+'/confirm'||pathname===url+'/generate'||pathname===url+'/fragments/2/retry'){
      let input='';for await(const chunk of req)input+=chunk;
      const body=JSON.parse(input);writes.push({path:pathname,body});
      if(pathname.endsWith('/confirm')){
        if(body.choice_revision!==choiceRevision||JSON.stringify(body.outline)!==JSON.stringify(editorialChoices?.outline)){
          _res.statusCode=409;return {detail:'方向或大纲已变化，请先保存当前选择，再确认成稿。'};
        }
        phase='waiting';version++;return {id,status:'confirmed',task_id:'task-v2'};
      }
      if(pathname.endsWith('/generate')){phase='running';return {id,task_id:'task-v2',queued:true};}
      phase='retry-queued';polls=0;return {queued:true};
    }
    if(pathname===pitches+'/old-unknown/upgrade'){
      let input='';for await(const chunk of req)input+=chunk;
      writes.push({path:pathname,body:JSON.parse(input)});legacyUpgraded=true;
      return {id:'old-unknown',version:2,status:'preparing'};
    }
    if(pathname===pitches+'/old-unknown')return legacyUpgraded
      ? {id:'old-unknown',title:'旧任务结果待核对',status:'preparing',version:2,task_id:null,prep:{workflow_version:2,question:'旧任务结果待核对',output_type:'update',existing_url:oldUrl,links:[]}}
      : {id:'old-unknown',title:'旧任务结果待核对',status:'confirmed',version:1,task_id:'old-task',task_state:'unknown',prep:null};
    if(pathname!==url&&pathname!==pitches+'/no-change')return;
    const noChange=pathname===pitches+'/no-change';
    if(!noChange&&phase==='preparing'&&++polls>1)phase='ready';
    if(!noChange&&phase==='running'&&++polls>1){phase='unknown';version++;}
    if(!noChange&&phase==='retry-queued'&&++polls>1){phase='done';version++;}
    const task=!noChange&&!['insufficient','preparing','ready'].includes(phase);
    return {id:noChange?'no-change':id,title:'升级尺寸指南',status:noChange?'ready':task?'confirmed':phase,version,
      task_id:task?'task-v2':null,task_state:task?(phase==='running'?'writing':phase==='done'?'received':phase==='retry-queued'?'unknown':phase):null,
      prep:{
        workflow_version:2,question:'升级尺寸指南',output_type:'update',existing_url:oldUrl,links:[],weak_material_ids:['weak'],editorial_choices:editorialChoices,
        materials:phase==='insufficient'?materials.slice(0,2):materials,paragraphs,facts:phase==='insufficient'?[calc]:[calc,source],
        subquestions:[
          {id:'q1',zh:covered,en:'Standard sizes?',need:'page',answer_shape:'table',terms:[],coverage:{status:'page_good',page_paragraphs:['p1'],evidence:[]},demand:{queries:[],inquiries:0}},
          {id:'q2',zh:gap,en:'What to check?',need:'source',answer_shape:'steps',terms:[],coverage:{status:phase==='insufficient'?'missing':'direct',page_paragraphs:[],evidence:phase==='insufficient'?[]:['f1'],action:phase==='insufficient'?'需要一份尺寸参考资料。':null},demand:{queries:[],inquiries:0}},
          {id:'q3',zh:pixels,en:'How many pixels?',need:'calc',answer_shape:'number',terms:[],coverage:{status:'calc',page_paragraphs:[],evidence:['c1']},demand:{queries:[{query:'billboard size in pixels',impressions:31,position:4.5}],inquiries:2}},
        ],
        edit_plan:noChange?[change[0]]:phase==='insufficient'?[]:task?change.slice(0,3):change,conclusion:noChange?'no_change':'upgrade',
        outline:change.slice(1).map((item,i)=>({id:'change-'+i,heading:'  '+item.heading+' \n',evidence:[],gap:null,action:null})),
        titles:[{title:'Billboard Size Guide',anchor:'原页尺寸',article_id:'page'}],
        fragments:task?[{op_index:1,status:phase==='waiting'?'pending':'done',...(phase!=='waiting'?{zh_review:chinese,html_en:safeHtml,used_facts:['f1']}:{})},
          {op_index:2,status:phase==='unknown'||phase==='retry-queued'?'unknown':phase==='done'?'done':phase==='running'?'running':'pending',...(phase==='unknown'||phase==='retry-queued'?{receipt_id:71}:phase==='done'?{zh_review:'中文审稿：给出像素换算方法。'}:{})}]:[],
        assembled:phase==='done'&&!noChange?{html_en:paragraphs[0].html+safeHtml,zh_review:chinese,diff:[
          {op:'keep',paragraph:'p1',before:paragraphs[0].html,after:paragraphs[0].html},
          {op:'revise',paragraph:'p2',before:paragraphs[1].html,after:safeHtml},
        ],draft_id:'draft-v2'}:null,
      }};
  });
  const web=await startWebServer(api);let browser;
  try{
    browser=await chromium.launch();
    const page=await browser.newPage({viewport:{width:360,height:840}});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===web.origin?route.continue():route.abort());
    const open=(pitch:string)=>visit(page,web.origin+'/admin/studio/pitch?id='+pitch);
    await open(id);
    await expect(page.getByRole('heading',{name:'缺证据 · 1 题'})).toBeVisible();
    await expect(page.getByRole('heading',{name:'旧页已答好 · 1 题'})).toBeVisible();
    await expect(page.getByText('无需求数据',{exact:true}).first()).toBeVisible();
    await expect(page.getByText('billboard size in pixels · 曝光 31 · 排名 4.5')).toBeVisible();
    const find=page.getByRole('button',{name:'自动查找这一题'});
    await expect(find).toBeEnabled();
    await expect(page.getByRole('textbox',{name:'补充证据链接：'+gap})).toBeHidden();
    await find.click();
    await expect(page.getByRole('heading',{name:'后台正在备料'})).toBeVisible();
    await expect(page.getByRole('heading',{name:'选择方向与大纲'})).toBeVisible({timeout:9000});
    await page.getByRole('button',{name:'核对依据',exact:true}).click();
    await expect(page.getByRole('heading',{name:'有直接证据 · 1 题'})).toBeVisible();
    assert.deepEqual(writes,[{path:url+'/evidence',body:{version:7,subquestion_id:'q2'}}]);
    const weak=page.getByRole('checkbox',{name:'选用 弱相关行业新闻'});
    await expect(weak).toBeHidden();
    await page.getByText('弱相关 1 条',{exact:true}).click();
    await expect(weak).toBeVisible();
    await expect(weak).not.toBeChecked();
    await expect(page.getByRole('checkbox',{name:'选用 尺寸参考资料'})).toBeChecked();

    await page.getByRole('button',{name:'方向与大纲',exact:true}).click();
    await expect(page.getByText('买家问题：'+gap)).toBeVisible();
    await expect(page.getByText('原文：'+source.quote)).toBeVisible();
    const pixelEdit=page.getByRole('article').filter({has:page.getByRole('heading',{name:'新增 · 画面像素换算示例',exact:true})});
    await expect(pixelEdit.getByText('需求信号：2 条已登记询盘')).toBeVisible();
    const keep=page.getByText('p1：'+paragraphs[0].text,{exact:true});
    await expect(keep).toBeHidden();
    await page.getByText('原样保留 1 段',{exact:true}).click();
    await expect(keep).toBeVisible();
    await page.getByRole('checkbox',{name:'保留改动：额外的换算附录'}).uncheck();
    const chosenHeading = '下单前的实际尺寸核对';
    await page.getByRole('textbox',{name:'第 1 处改动的小节标题',exact:true}).fill(chosenHeading);
    await page.getByRole('radio',{name:/Billboard Size Guide/}).check();
    await page.getByRole('checkbox',{name:'增加条件对照表',exact:true}).check();
    await expect(page.getByRole('textbox',{name:'补充逻辑（选填）',exact:true})).toHaveValue('');
    assert.equal(writes.length,1,'selecting a direction, outline and additions does not create a task or call a writer');
    await page.getByRole('button',{name:'保存选择，稍后生成',exact:true}).click();
    await expect(page.getByText('选择已保存，刷新后可继续。',{exact:true})).toBeVisible();
    assert.deepEqual(writes[1],{path:url+'/choices',body:{version:8,choice_revision:0,article_ids:['page','reference'],selected_title:'Billboard Size Guide',
      outline:[{id:'change-0',heading:chosenHeading,include:true},{id:'change-1',heading:change[2].heading,include:true},{id:'change-2',heading:change[3].heading,include:false}],additions:['comparison'],note:''}});
    await page.reload();
    await expect(page.getByRole('checkbox',{name:'增加条件对照表',exact:true})).toBeChecked();
    await expect(page.getByRole('checkbox',{name:'保留改动：额外的换算附录'})).not.toBeChecked();
    await expect(page.getByRole('textbox',{name:'第 1 处改动的小节标题',exact:true})).toHaveValue(chosenHeading);
    assert.equal(writes.length,2,'saving and reloading choices do not generate a draft');
    await page.getByRole('button',{name:'确认大纲并生成全文',exact:true}).click();
    const generate=page.getByRole('button',{name:'生成英文稿',exact:true});
    await expect(generate).toHaveCount(0);
    assert.deepEqual(writes[2],{path:url+'/confirm',body:{version:8,choice_revision:1,article_ids:['page','reference'],selected_title:'Billboard Size Guide',output_type:'update',
      outline:[{id:'change-0',heading:chosenHeading,include:true},{id:'change-1',heading:change[2].heading,include:true},{id:'change-2',heading:change[3].heading,include:false}],
      engineer:{mode:'conservative',name:'',reply:'',answers:[]}}});
    await expect(page.getByRole('heading',{name:/额外的换算附录/})).toHaveCount(0);

    const retry=page.getByRole('button',{name:'只重试此片段'});
    await expect(retry).toBeVisible({timeout:9000});
    await expect(page.getByText(/上一次调用结果未知，可能已经计费/)).toBeVisible();
    await page.reload();
    await expect(generate).toHaveCount(0);
    await expect(retry).toBeVisible();
    await page.getByText('查看中文片段审稿',{exact:true}).click();
    await expect(page.getByText(chinese,{exact:true})).toBeVisible();
    await retry.click();
    const approveRetry=page.getByRole('button',{name:'确认重试此片段'});
    await expect(approveRetry).toBeVisible();
    assert.deepEqual(writes.slice(3),[{path:url+'/generate',body:{}}],'opening or reloading the unknown result, and reviewing retry, never starts another call');
    await page.getByRole('button',{name:'取消',exact:true}).click();
    await expect(approveRetry).toHaveCount(0);
    await retry.click();await approveRetry.click();
    await expect(page.getByText('重试已提交',{exact:true})).toBeVisible();
    await expect(retry).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'新旧对比'})).toBeVisible({timeout:9000});
    assert.deepEqual(writes.at(-1),{path:url+'/fragments/2/retry',body:{version:10,confirm_unknown:true}});
    assert.equal(writes.length,5);
    await page.getByText('改写 · p2',{exact:true}).click();
    await expect(page.getByText(paragraphs[1].html,{exact:true})).toBeVisible();
    await expect(page.getByText(safeHtml,{exact:true})).toBeVisible();
    await expect(page.locator('#probe')).toHaveCount(0);
    assert.equal(await page.evaluate(()=>Reflect.has(window,'fixtureRan')),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await expect(page.getByRole('link',{name:'打开稿件审阅 →'})).toHaveAttribute('href','/admin/studio/drafts/draft-v2');
    await open('old-unknown');
    await expect(page.getByText(/模型调用没有返回确定结果/)).toBeVisible();
    await expect(generate).toHaveCount(0);
    await expect(retry).toHaveCount(0);
    await expect(page.getByRole('link',{name:'继续原采编任务 →'})).toHaveAttribute('href','/admin/studio?tab=tasks#task-old-task');
    assert.equal(writes.length,5);
    await page.getByRole('button',{name:'改用片段采编（新备料）'}).click();
    await expect(page.getByRole('heading',{name:'后台正在备料'})).toBeVisible();
    assert.deepEqual(writes.at(-1),{path:pitches+'/old-unknown/upgrade',body:{version:1}});
    await open('no-change');
    await expect(page.getByRole('heading',{name:'无需升级',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'确认大纲并生成全文',exact:true})).toHaveCount(0);
    assert.equal(writes.length,6);
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await web.stop();}
});

test('missing evidence offers a concrete scope choice with omissions and needs no text input',async()=>{
  const id='scope-choice',url='/api/admin/studio/pitches/'+id,writes:{path:string;body:unknown}[]=[];
  const question='欧洲现货订单和原厂直发差几天？';
  let selected=false,readsAfterSelection=0;
  const api=fakeApi(async(request,_res,req)=>{
    if(request.pathname==='/api/admin/me')return {name:'Synthetic operator',csrf:'fixture',dev:false};
    if(request.pathname==='/api/admin/studio/pitches')return {rows:[]};
    if(request.pathname===url+'/scope'){
      let text='';for await(const chunk of req)text+=chunk;
      writes.push({path:request.pathname,body:JSON.parse(text)});selected=true;
      return {version:2,status:'preparing',queued:true};
    }
    if(request.pathname===url){
      const ready=selected&&++readsAfterSelection>1;
      return {id,title:question,version:selected?2:1,status:ready?'ready':selected?'preparing':'insufficient',task_id:null,prep:{
      workflow_version:2,question:selected?'下单前如何核对自提与配送条件？':question,output_type:'guide',existing_url:'',links:[],
      materials:[{id:'source',title:'Collection arrangements',url:'https://official.example.test/collection',revision:1,publication_time:null,published_at:null,snippet:'Confirm collection arrangements.',hit_count:1,first_party:true,body_status:'ok'}],
      titles:ready?[{title:'Collection order checks',anchor:'下单前确认提货安排',article_id:'source'}]:[],
      outline:ready?[{id:'checks',heading:'确认提货与配送安排',evidence:[{article_id:'source',quote:'Confirm collection arrangements.'}],gap:null,action:null}]:[],
      facts:[{id:'collection-fact',kind:'source',statement:'Confirm collection arrangements.',quote:'Confirm collection arrangements.',article_id:'source',url:'https://official.example.test/collection'}],
      subquestions:[{id:'order-checks',zh:'下单前如何核对自提与配送条件？',en:'How to check collection arrangements?',need:'source',answer_shape:'checklist',terms:[],coverage:{status:'direct',page_paragraphs:[],evidence:['collection-fact']}}],
      edit_plan:ready?[{op:'insert_after',paragraph:'',subquestion:'order-checks',heading:'确认提货与配送安排',facts:['collection-fact']}]:[],
      research:{state:'partial',queries:['European LED display warehouse collection'],imported:1,failures:[]},
      scope:selected?{original_question:question,question:'下单前如何核对自提与配送条件？',omitted_questions:['未证实的具体交期差值','未证实的德国仓现货案例']}:undefined,
      scope_options:selected?[]:[{id:'supported-order-checks',question:'下单前如何核对自提与配送条件？',includes:['核对提货和配送安排所需的条件'],omits:['未证实的具体交期差值','未证实的德国仓现货案例'],subquestion_ids:['order-checks']}],
    }};}
  });
  const web=await startWebServer(api);let browser;
  try{
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:900}});
    await visit(page,web.origin+'/admin/studio/pitch?id='+id);
    await expect(page.getByText('核对提货和配送安排所需的条件',{exact:true})).toBeVisible();
    await expect(page.getByText('未证实的德国仓现货案例',{exact:true})).toBeVisible();
    assert.deepEqual(writes,[],'scope suggestions do not silently change the buyer question');
    await page.getByRole('button',{name:'选择此范围，准备大纲',exact:true}).click();
    await expect(page.getByRole('heading',{name:'后台正在备料',exact:true})).toBeVisible();
    assert.deepEqual(writes,[{path:url+'/scope',body:{version:1,scope_id:'supported-order-checks'}}]);
    await expect(page.getByRole('button',{name:'生成英文稿',exact:true})).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading',{name:'这篇回答什么',exact:true})).toBeVisible();
    await expect(page.getByText('你已选择的回答范围：下单前如何核对自提与配送条件？',{exact:true})).toBeVisible();
    await expect(page.getByText('未证实的德国仓现货案例',{exact:true})).toBeVisible();
    assert.equal(writes.length,1,'loading the saved narrower scope does not draft or publish');
  }finally{await browser?.close();await web.stop();}
});
