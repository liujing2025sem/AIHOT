import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planRecommendations, type PlanningMaterial } from '../packages/backend/src/admin/studio-recommendations.ts';
import { questionSchema, type StudioQuestionRow } from '../packages/backend/src/admin/studio-questions.ts';
import { summarizeDemandSignals } from '../packages/backend/src/admin/studio-demand.ts';
import { parseDemandCsv,demandCsvTemplate } from '../packages/backend/src/admin/studio-demand-csv.ts';
import { parseSearchSignals } from '../packages/backend/src/admin/studio-search-signals.ts';

const now='2026-11-03T12:00:00Z';
const q=(extra:Record<string,unknown>={}):StudioQuestionRow=>({id:'question-1',version:1,created_at:new Date(now),updated_at:new Date(now),document:questionSchema.parse({question:'户外招牌电费怎么估算？',roles:['集成商/安装商/招牌制作商'],scenario:'户外招牌',dimension:'费用',keywords:['电费','power'],...extra})});
const material=(extra:Partial<PlanningMaterial>={}):PlanningMaterial=>({id:'material-1',revision:1,title:'LED power supply announcement',body_text:'The manufacturer announced a power supply for LED displays.',body_status:'ok',url:'https://maker.example/news',source_id:'maker',published_at:'2026-11-02T00:00:00Z',...extra});
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
