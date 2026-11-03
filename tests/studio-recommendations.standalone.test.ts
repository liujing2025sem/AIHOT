import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enrichRecommendation, planRecommendations, type PlanningMaterial } from '../packages/backend/src/admin/studio-recommendations.ts';
import { questionSchema, type StudioQuestionRow } from '../packages/backend/src/admin/studio-questions.ts';
import { summarizeDemandSignals } from '../packages/backend/src/admin/studio-demand.ts';
import { parseDemandCsv,demandCsvTemplate, type DemandRecord } from '../packages/backend/src/admin/studio-demand-csv.ts';
import { parseSearchSignals, type SearchSignal } from '../packages/backend/src/admin/studio-search-signals.ts';

const now='2026-11-03T12:00:00Z';
const q=(extra:Record<string,unknown>={}):StudioQuestionRow=>({id:'question-1',version:1,created_at:new Date(now),updated_at:new Date(now),document:questionSchema.parse({question:'户外招牌电费怎么估算？',roles:['集成商/安装商/招牌制作商'],scenario:'户外招牌',dimension:'费用',keywords:['电费','power'],...extra})});
const material=(extra:Partial<PlanningMaterial>={}):PlanningMaterial=>({id:'material-1',revision:1,title:'LED power supply announcement',body_text:'The manufacturer announced a power supply for LED displays.',body_status:'ok',url:'https://maker.example/news',source_id:'web-meanwell-new-products',published_at:'2026-11-02T00:00:00Z',...extra});
const empty=summarizeDemandSignals([]);
const plan=(questions:StudioQuestionRow[],materials:PlanningMaterial[],profile=empty)=>planRecommendations({questions,materials,profiles:profile,search:[],now});

test('changed source paragraphs create one material-version card linked to the known page',()=>{
  const row=material({revision:2,published_at:'2021-01-01T00:00:00Z',previous_revision:1,previous_body:'Manufacturer power was 200 W.',body_text:'Manufacturer power is now 180 W.'});
  const result=plan([q({existing_url:'https://www.chipshow.com/energy-guide'}),{...q(),id:'question-2'}],[row]);
  assert.equal(result.length,1);assert.equal(result[0].trigger,'A');assert.equal(result[0].action,'update_page');assert.equal(result[0].needs_material,true);
  assert.match(result[0].evidence[0].before!,/200 W/);assert.match(result[0].evidence[0].after!,/180 W/);
  assert.equal(plan([q({existing_url:'https://www.chipshow.com/energy-guide'})],[{...row,revision:3}])[0].key.endsWith(':3'),true);
});
test('first-time completion of an undated/old archive does not manufacture a source change or fresh news',()=>{
  for(const published_at of [null,'2021-01-01T00:00:00Z','2026-11-04T00:00:00Z'])assert.equal(plan([q()],[material({revision:2,previous_body:null,published_at})]).length,0);
  const unchanged=material({revision:2,published_at:'2021-01-01',previous_body:'same LED power text',body_text:'same LED power text'});
  assert.equal(plan([q({existing_url:'https://www.chipshow.com/energy'})],[unchanged]).length,0);
});
test('software versions become tutorial proposals with explicit first-party dependency',()=>{
  const question=q({dimension:'控制软件',content_type:'tutorial',requires_first_party:true,keywords:['NovaLCT']});
  const result=plan([question],[material({title:'NovaLCT v5.6.1 release notes',body_text:'NovaLCT software version 5.6.1 release notes.'})]);
  assert.equal(result[0].trigger,'E');assert.equal(result[0].action,'new_tutorial');assert.equal(result[0].requires_first_party,true);assert.equal(result[0].needs_material,true);
});
test('repeated demand remains mention counts and creates a research task proposal, never invented facts',()=>{
  const parsed=parseDemandCsv(demandCsvTemplate);assert.ok(parsed.ok);
  const profile=summarizeDemandSignals([{record:parsed.records[0],imported_at:now},{record:parsed.records[0],imported_at:now}]);
  const result=plan([q()],[ ],profile);assert.equal(result[0].trigger,'B');assert.equal(result[0].article_id,null);assert.equal(result[0].needs_material,true);assert.match(result[0].reason,/未按客户去重/);
  assert.equal(plan([q({existing_url:'https://www.chipshow.com/energy'})],[],profile).length,0);
});
test('fresh industry news can stand without an existing question and old research remains reference',()=>{
  assert.equal(plan([],[material()])[0].trigger,'D');
  assert.equal(plan([],[material({published_at:'2026-09-01'})]).length,0);
});
test('search imports preserve periods and reject malformed/identifying input before creating any batch',()=>{
  const gsc=parseSearchSignals('gsc','query,page,impressions,clicks,position,period\npower costs,https://www.chipshow.com/energy,100,3,18,2026-10');
  const result=planRecommendations({questions:[q()],materials:[],profiles:empty,search:gsc,now});assert.equal(result[0].trigger,'C');assert.equal(result[0].action,'update_page');assert.equal(result[0].existing_url,gsc[0].page);assert.match(result[0].reason,/2026-10/);
  assert.throws(()=>parseSearchSignals('gsc','query,page,impressions,clicks,position\nperson@example.com,https://www.chipshow.com/energy,100,3,18'),/整批未导入/);
  assert.throws(()=>parseSearchSignals('semrush','keyword,url,position,volume\npower,https://user:password@example.com/p,3,100'),/HTTP/);
  assert.throws(()=>parseSearchSignals('gsc','query,page,impressions,clicks,position\npower,https://www.chipshow.com/energy,100,3,NaN'),/非负数字/);
});

// All controls below are synthetic planning inputs, not evidence of real editorial or business results.
const runPlan=(input:Partial<Parameters<typeof planRecommendations>[0]>={})=>planRecommendations({questions:[q()],materials:[],profiles:empty,search:[],now,ownedDomains:['example.com'],...input});
const englishQuestion=(terms:string[],extra:Record<string,unknown>={})=>q({keywords:[],keywords_zh:['测试用词'],keywords_en:terms,...extra});
function demandFor(question:StudioQuestionRow,count:number,extra:Partial<DemandRecord>={}){
  const parsed=parseDemandCsv(demandCsvTemplate);
  assert.ok(parsed.ok);
  return summarizeDemandSignals(Array.from({length:count},()=>({imported_at:now,record:{...parsed.records[0],role:question.document.roles[0],scenario:question.document.scenario,need_tags:['合成需求'],...extra}})));
}
const searchSignal=(extra:Partial<SearchSignal>={}):SearchSignal=>({kind:'gsc',query:'LED power cost',page:'https://example.com/energy',position:18,impressions:100,clicks:3,volume:null,period:'2026-10',...extra});

for(const sample of [
  {name:'power supply rating',terms:['power supply'],before:'The power supply output rating is 200 W.',after:'The power supply output rating is 180 W.'},
  {name:'driver IC refresh rate',terms:['driver IC'],before:'The driver IC supports 1920 Hz.',after:'The driver IC supports 3840 Hz.'},
  {name:'LED package dimensions',terms:['LED package'],before:'The LED package measures 2.7 mm.',after:'The LED package measures 2.1 mm.'},
])test(`A2 synthetic A positive: ${sample.name}`,()=>{
  const question=englishQuestion(sample.terms,{existing_url:'https://example.com/guide'});
  const row=material({title:sample.name,revision:2,previous_revision:1,previous_body:sample.before,body_text:sample.after,published_at:'2021-01-01T00:00:00Z'});
  const cards=runPlan({questions:[question],materials:[row]}).filter(card=>card.trigger==='A');
  assert.equal(cards.length,1);assert.equal(cards[0].question_id,question.id);assert.equal(cards[0].action,'update_page');
  assert.equal(cards[0].existing_url,question.document.existing_url);
  assert.equal(cards[0].evidence[0].before,sample.before);assert.equal(cards[0].evidence[0].after,sample.after);
});

for(const sample of [
  {name:'no known page',question:q(),row:material({revision:2,previous_body:'Power was 200 W.',body_text:'Power is 180 W.'})},
  {name:'unchanged paragraph',question:q({existing_url:'https://example.com/energy'}),row:material({revision:2,previous_body:'Power is 200 W.',body_text:'Power is 200 W.'})},
])test(`A2 synthetic A negative: ${sample.name}`,()=>{
  const result=runPlan({questions:[sample.question],materials:[sample.row]});
  assert.equal(result.some(card=>card.trigger==='A'),false);
});

for(const sample of [
  {software:'NovaLCT',version:'5.6.1',source:'web-novastar-news'},
  {software:'HDPlayer',version:'7.9.2',source:'web-huidu-hdplayer'},
  {software:'controller firmware',version:'2.4.0',source:'web-colorlight-firmware'},
])test(`A2 synthetic E positive: ${sample.software}`,()=>{
  const question=englishQuestion([sample.software],{dimension:'控制软件',content_type:'tutorial',requires_first_party:true});
  const result=runPlan({questions:[question],materials:[material({source_id:sample.source,title:`${sample.software} v${sample.version} release`,body_text:`${sample.software} version ${sample.version} release notes.`})]});
  const cards=result.filter(card=>card.trigger==='E');
  assert.equal(cards.length,1);assert.equal(cards[0].question_id,question.id);assert.equal(cards[0].action,'new_tutorial');
  assert.equal(cards[0].requires_first_party,true);assert.equal(cards[0].needs_material,true);
});

for(const sample of [
  {name:'no version number',row:material({title:'Controller firmware maintenance guide',body_text:'Controller firmware maintenance overview.'})},
  {name:'old release without a revision change',row:material({title:'Controller firmware v2.4.0',body_text:'Controller firmware version 2.4.0 release notes.',published_at:'2021-01-01T00:00:00Z'})},
])test(`A2 synthetic E negative: ${sample.name}`,()=>{
  const question=englishQuestion(['controller firmware'],{dimension:'控制软件',content_type:'tutorial',requires_first_party:true});
  assert.equal(runPlan({questions:[question],materials:[sample.row]}).some(card=>card.trigger==='E'),false);
});

for(const sample of [
  {name:'fresh date',published_at:'2026-11-02T00:00:00Z'},
  {name:'old date',published_at:'2021-01-01T00:00:00Z'},
])test(`A2 synthetic E negative: version 1.2.0 description-only edit with ${sample.name}`,()=>{
  const question=englishQuestion(['controller firmware'],{dimension:'控制软件',content_type:'tutorial',requires_first_party:true});
  const row=material({title:'Controller firmware version 1.2.0',revision:2,previous_revision:1,published_at:sample.published_at,
    previous_body:'Controller firmware version 1.2.0. The guide describes the connection procedure.',
    body_text:'Controller firmware version 1.2.0. The guide clarifies the connection procedure.'});
  assert.equal(runPlan({questions:[question],materials:[row]}).some(card=>card.trigger==='E'),false);
});

for(const sample of [
  {name:'installer/outdoor',question:q(),count:2},
  {name:'media owner/DOOH',question:englishQuestion(['DOOH'],{roles:['终端业主/广告媒体主'],scenario:'DOOH'}),count:3},
  {name:'distributor/control system',question:englishQuestion(['controller'],{roles:['分销商/代理商'],scenario:'控制系统采购'}),count:4},
])test(`A2 synthetic B positive: ${sample.name}`,()=>{
  const cards=runPlan({questions:[sample.question],profiles:demandFor(sample.question,sample.count)}).filter(card=>card.trigger==='B');
  assert.equal(cards.length,1);assert.equal(cards[0].question_id,sample.question.id);assert.equal(cards[0].demand_mentions,sample.count);
  assert.equal(cards[0].article_id,null);assert.equal(cards[0].needs_material,true);assert.match(cards[0].reason,/未按客户去重/);
});

for(const sample of [
  {name:'only one mention',question:q(),count:1},
  {name:'page already known',question:q({existing_url:'https://example.com/energy'}),count:3},
])test(`A2 synthetic B negative: ${sample.name}`,()=>{
  assert.equal(runPlan({questions:[sample.question],profiles:demandFor(sample.question,sample.count)}).some(card=>card.trigger==='B'),false);
});

for(const sample of [
  {name:'GSC visible low-ranking page',signal:searchSignal(),question:q(),action:'update_page'},
  {name:'GSC known page',signal:searchSignal({position:11}),question:q({existing_url:'https://example.com/energy'}),action:'update_page'},
  {name:'Semrush competitor top ten',signal:searchSignal({kind:'semrush',page:'https://competitor.example/energy',position:3,impressions:null,clicks:null,volume:500}),question:q(),action:'new_explainer'},
])test(`A2 synthetic C positive: ${sample.name}`,()=>{
  const cards=runPlan({questions:[sample.question],search:[sample.signal]}).filter(card=>card.trigger==='C');
  assert.equal(cards.length,1);assert.equal(cards[0].question_id,sample.question.id);assert.equal(cards[0].action,sample.action);
  assert.match(cards[0].reason,/2026-10/);assert.equal(cards[0].needs_material,true);
});

for(const sample of [
  {name:'GSC already top ten',signal:searchSignal({position:8})},
  {name:'GSC has no impressions',signal:searchSignal({impressions:0})},
  {name:'Semrush own domain',signal:searchSignal({kind:'semrush',page:'https://example.com/energy',position:3,impressions:null,clicks:null,volume:500})},
  {name:'Semrush own www hostname',signal:searchSignal({kind:'semrush',page:'https://www.example.com/energy',position:3,impressions:null,clicks:null,volume:500})},
])test(`A2 synthetic C negative: ${sample.name}`,()=>{
  assert.equal(runPlan({search:[sample.signal]}).some(card=>card.trigger==='C'),false);
});

for(const sample of [
  {name:'English power supplies',terms:['power supply'],title:'New POWER SUPPLIES for LED displays'},
  {name:'English controllers',terms:['controller'],title:'New CONTROLLERS for outdoor LED displays'},
  {name:'English DOOH',terms:['DOOH'],title:'New dooh advertising network opens'},
])test(`A2 synthetic D positive: ${sample.name}`,()=>{
  const question=englishQuestion(sample.terms);
  const cards=runPlan({questions:[question],materials:[material({title:sample.title,body_text:sample.title})]}).filter(card=>card.trigger==='D');
  assert.equal(cards.length,1);assert.equal(cards[0].question_id,question.id);assert.equal(cards[0].article_revision,1);
});

for(const sample of [
  {name:'older than seven days',row:material({published_at:'2026-10-26T12:00:00Z'})},
  {name:'unrelated fresh material',row:material({title:'Local poetry award announced',body_text:'A poet received a literary prize.'})},
])test(`A2 synthetic D negative: ${sample.name}`,()=>{
  assert.equal(runPlan({materials:[sample.row]}).some(card=>card.trigger==='D'),false);
});

const oldIcParagraph='The driver IC refresh rate is 1920 Hz at 1/16 scan.';
const newIcParagraph='The driver IC refresh rate is 3840 Hz at 1/16 scan.';
const icQuestion=englishQuestion(['driver IC','refresh rate'],{question:'驱动 IC 的刷新率变化后，原来的选型指南要更新什么？',existing_url:'https://example.com/ic-guide'});
const icUpdate=material({id:'synthetic-ic-update',source_id:'web-macroblock-news',title:'Driver IC refresh rate update',revision:2,previous_revision:1,previous_body:oldIcParagraph,body_text:newIcParagraph});
const icPage=material({id:'synthetic-existing-page',url:'https://example.com/ic-guide',source_id:'synthetic-owned-page',title:'Existing IC selection guide',revision:4,body_text:`Selection guide\n${oldIcParagraph}\nMaintenance intervals depend on the installation.`,first_party:true,source_kind:'external',reference_only:true});

test('A10 synthetic IC card exposes old/new numbers and the affected existing-page paragraph',()=>{
  const card=runPlan({questions:[icQuestion],materials:[icUpdate,icPage]}).find(card=>card.trigger==='A');
  assert.ok(card);
  assert.match(card.change,/1920 Hz.*→.*3840 Hz/);
  assert.equal(card.evidence[0].before,oldIcParagraph);assert.equal(card.evidence[0].after,newIcParagraph);
  assert.equal(card.evidence[0].date,'2026-11-02T00:00:00.000Z');assert.equal(card.evidence[0].revision,2);
  assert.deepEqual(card.affected_page,{url:icPage.url,paragraph:oldIcParagraph,article_id:icPage.id,revision:4});
  assert.deepEqual(card.evidence_checklist,{source_body:true,existing_page_body:false,first_party:null});
  assert.equal(card.needs_material,true);
  assert.equal(card.bound_article_ids?.includes(icPage.id)??false,false);
});

test('A10 long specification evidence retains changed numbers beyond character 500',()=>{
  const prefix='Reference conditions remain unchanged. '.repeat(20);
  const before=prefix+oldIcParagraph;
  const after=prefix+newIcParagraph;
  assert.equal(before.slice(0,350),after.slice(0,350));
  assert.ok(before.indexOf('1920 Hz')>500);assert.ok(after.indexOf('3840 Hz')>500);
  const row={...icUpdate,previous_body:before,body_text:after};
  const card=runPlan({questions:[icQuestion],materials:[row]}).find(card=>card.trigger==='A');
  assert.ok(card);
  assert.match(card.evidence[0].before!,/1920 Hz/);assert.match(card.evidence[0].after!,/3840 Hz/);
  assert.match(card.change,/1920 Hz.*→.*3840 Hz/);
});

test('A10 only an explicitly bound readable old page completes the existing-page checklist',()=>{
  const proposed=runPlan({questions:[icQuestion],materials:[icUpdate,icPage]}).find(card=>card.trigger==='A');
  assert.ok(proposed);
  const bound=enrichRecommendation({...proposed,bound_article_ids:[icPage.id]},[icUpdate,icPage],icQuestion.document);
  assert.deepEqual(bound.evidence_checklist,{source_body:true,existing_page_body:true,first_party:null});
  assert.equal(bound.needs_material,false);
  assert.deepEqual(bound.affected_page,proposed.affected_page);
  assert.equal(proposed.evidence_checklist?.existing_page_body,false);
  const unreadable=enrichRecommendation({...proposed,bound_article_ids:[icPage.id]},[icUpdate,{...icPage,body_text:null,body_status:'missing'}],icQuestion.document);
  assert.equal(unreadable.evidence_checklist.existing_page_body,false);
  assert.equal(unreadable.needs_material,true);
});

for(const sample of [
  {name:'original absent from pool',row:null},
  {name:'original body missing',row:{...icUpdate,body_text:null,body_status:'missing'}},
  {name:'original body blank despite ok status',row:{...icUpdate,body_text:' \n\t ',body_status:'ok'}},
  {name:'original text present but body status incomplete',row:{...icUpdate,body_status:'pending'}},
])test(`A10 another bound body cannot replace the specified original: ${sample.name}`,()=>{
  const proposed=runPlan({questions:[icQuestion],materials:[icUpdate,icPage]}).find(card=>card.trigger==='A');
  assert.ok(proposed);
  const unrelated=material({id:'synthetic-unrelated-readable',body_text:'Another source has complete power supply specifications.',reference_only:true});
  const materials=sample.row?[sample.row,icPage,unrelated]:[icPage,unrelated];
  const card=enrichRecommendation({...proposed,bound_article_ids:[icPage.id,unrelated.id]},materials,icQuestion.document);
  assert.equal(card.article_id,icUpdate.id);
  assert.deepEqual(card.evidence_checklist,{source_body:false,existing_page_body:true,first_party:null});
  assert.equal(card.affected_page?.paragraph,oldIcParagraph);
  assert.equal(card.needs_material,true);
});

test('A10 synthetic IC card exposes a missing old-page body before adoption',()=>{
  const card=runPlan({questions:[icQuestion],materials:[icUpdate]}).find(card=>card.trigger==='A');
  assert.ok(card);
  assert.match(card.change,/1920 Hz.*→.*3840 Hz/);
  assert.deepEqual(card.evidence_checklist,{source_body:true,existing_page_body:false,first_party:null});
  assert.deepEqual(card.affected_page,{url:icQuestion.document.existing_url,paragraph:null,article_id:null,revision:null});
  assert.equal(card.needs_material,true);
});

test('A10 synthetic tutorial card exposes missing source body and engineering evidence before adoption',()=>{
  const question=englishQuestion(['controller firmware'],{dimension:'控制软件',content_type:'tutorial',requires_first_party:true});
  const card=runPlan({questions:[question],materials:[material({title:'Controller firmware v2.4.0',body_text:null,body_status:'missing'})]}).find(card=>card.trigger==='E');
  assert.ok(card);
  assert.deepEqual(card.evidence_checklist,{source_body:false,existing_page_body:null,first_party:false});
  assert.equal(card.affected_page,null);assert.equal(card.needs_material,true);
});

for(const sample of [
  {name:'engineering external evidence',first_party:true,source_kind:'external',available:true},
  {name:'publisher material is not engineering evidence',first_party:false,source_kind:'web_list',available:false},
  {name:'first-party flag without external evidence',first_party:true,source_kind:'web_list',available:false},
])test(`A10 synthetic tutorial evidence checklist: ${sample.name}`,()=>{
  const question=englishQuestion(['controller firmware'],{dimension:'控制软件',content_type:'tutorial',requires_first_party:true});
  const card=runPlan({questions:[question],materials:[material({title:'Controller firmware v2.4.0',body_text:'Controller firmware version 2.4.0 verified steps.',first_party:sample.first_party,source_kind:sample.source_kind})]}).find(card=>card.trigger==='E');
  assert.ok(card);
  assert.deepEqual(card.evidence_checklist,{source_body:true,existing_page_body:null,first_party:sample.available});
  assert.equal(card.requires_first_party,true);
});

for(const domain of ['chipshow.com','chipshow.eu','chipshowledusa.com','unishineled.com'])test(`A5 confirmed default owned domain: ${domain}`,()=>{
  // Synthetic search rows only; these paths are not claimed to be real published pages.
  const page=`https://www.${domain}/synthetic-energy-guide`;
  const signal=searchSignal({kind:'semrush',page,position:3,impressions:null,clicks:null,volume:500});
  assert.equal(runPlan({ownedDomains:undefined,search:[signal]}).some(card=>card.trigger==='C'),false);
  const cards=runPlan({ownedDomains:undefined,search:[{...signal,position:18}]}).filter(card=>card.trigger==='C');
  assert.equal(cards.length,1);assert.equal(cards[0].action,'update_page');assert.equal(cards[0].existing_url,page);
});
