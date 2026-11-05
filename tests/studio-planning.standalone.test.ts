import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { questionSchema } from '../packages/backend/src/admin/studio-questions.ts';
import { questionKeywords, keywordMatch } from '../packages/backend/src/admin/studio-question-match.ts';

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
