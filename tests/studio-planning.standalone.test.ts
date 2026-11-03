import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { questionSchema } from '../packages/backend/src/admin/studio-questions.ts';

const example={question:'户外招牌一年用多少电？',roles:['终端业主/广告媒体主'],scenario:'户外招牌',dimension:'费用',keywords:['用电','电费']};
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
  assert.ok(seed.questions.length>=30&&seed.questions.length<=50);
  for(const input of seed.questions){const q=questionSchema.parse(input);assert.equal(q.existing_url,'');assert.ok(q.demand_evidence.every(e=>e.type==='grill-example'));}
});
