import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { fakeApi, startWebServer, visit } from './web-server.ts';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

test('pitch desk keeps raw text out of saved requests, confirms evidence and queues writing separately on mobile',async()=>{
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
  let version=1, status='preparing', task:string|null=null,reads=0,reuse=false;
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
          {...prep,output_type:'update',existing_url:relatedUrl,links:[material.url],materials:[material,oldPage]}};
    }
    if(url.pathname===pitches+'/'+id+'/confirm'){status='confirmed';version++;task=taskId;return {id,status,task_id:task};}
    if(url.pathname===pitches+'/'+id+'/generate')return {id,task_id:task,queued:true};
  });
  const web=await startWebServer(api);let browser;
  try{
    browser=await chromium.launch();
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await visit(page,web.origin+'/admin/studio');
    await expect(page.getByRole('link',{name:'+ 命题',exact:true})).toHaveAttribute('href','/admin/studio/pitch');
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

    await page.getByRole('button',{name:'用作已有页面',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'已有页面 URL'})).toHaveValue(relatedUrl);
    await page.getByRole('textbox',{name:'公开线索链接'}).fill(material.url);
    await page.getByRole('button',{name:'重新备料（调用模型）',exact:true}).click();
    await expect(page.getByText('模拟取文失败：原页面超时。')).toBeVisible();
    await expect(page.getByRole('textbox',{name:'公开线索链接'})).toHaveValue(material.url);
    await page.getByRole('button',{name:'重新备料（调用模型）',exact:true}).click();
    await expect(page.getByText('已有页面正文',{exact:false}).first()).toBeVisible();
    const confirm=page.getByRole('button',{name:'确认备料',exact:true});
    await page.getByRole('checkbox',{name:'选用 '+oldPage.title,exact:true}).uncheck();
    await page.getByRole('button',{name:'标题',exact:true}).click();
    await expect(page.getByRole('radio',{name:/Installation drawing checklist/})).toBeDisabled();
    await expect(confirm).toBeDisabled();
    await expect(page.getByText('请选至少 2 条素材，或选用已有页面正文。')).toBeVisible();
    await page.getByRole('button',{name:'素材',exact:true}).click();
    await page.getByRole('checkbox',{name:'选用 '+oldPage.title,exact:true}).check();
    await page.getByRole('checkbox',{name:'选用 '+material.title,exact:true}).uncheck();
    await page.getByRole('button',{name:'标题',exact:true}).click();
    await page.getByRole('radio',{name:/Installation drawing checklist/}).check();
    await page.getByRole('button',{name:'大纲',exact:true}).click();
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
    await expect(page.getByRole('button',{name:'生成英文稿',exact:true})).toBeEnabled();
    assert.deepEqual(writes.slice(3),[
      {method:'PATCH',path:pitches+'/'+id,body:{version:1,links:[material.url],output_type:'update',existing_url:relatedUrl}},
      {method:'PATCH',path:pitches+'/'+id,body:{version:2,links:[material.url],output_type:'update',existing_url:relatedUrl}},
      {method:'POST',path:pitches+'/'+id+'/confirm',body:{version:3,article_ids:[oldPage.id],selected_title:prep.titles[0].title,output_type:'update',
        outline:[{id:'s1',heading:'先核对图纸',include:true}],engineer:{mode:'conservative',name:'',reply:'',answers:[{question_id:'q1',choice:'A',note:''}]}}},
    ]);
    await page.getByRole('button',{name:'生成英文稿',exact:true}).click();
    await expect(page.getByText('英文成稿已排队。',{exact:false}).first()).toBeVisible();
    assert.deepEqual(writes.at(-1),{method:'POST',path:pitches+'/'+id+'/generate',body:{}});
    await page.reload();
    await expect(page.getByRole('link',{name:'继续原采编任务 →',exact:true})).toHaveAttribute('href','/admin/studio?tab=tasks#task-'+taskId);
    await expect(page.getByRole('button',{name:'生成英文稿',exact:true})).toHaveCount(0);

    reuse=true;
    await page.getByRole('link',{name:'+ 新命题',exact:true}).click();
    await question.fill(savedTitle);await preview.click();await consent.check();await save.click();
    await page.waitForURL('**/admin/studio?tab=tasks#task-'+taskId);
    await expect(page.locator('#task-'+taskId)).toBeVisible();
    assert.equal(writes.filter(write=>write.path.endsWith('/generate')).length,1);
    assert.ok(requestedUrls.every(url=>!decodeURIComponent(url).includes('fixture@example.test')));
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await web.stop();}
});
