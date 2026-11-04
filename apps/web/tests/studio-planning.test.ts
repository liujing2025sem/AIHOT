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
