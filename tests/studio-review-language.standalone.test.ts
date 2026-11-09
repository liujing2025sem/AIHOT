import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Packet,Response} from '../scripts/editorial-pilot-lib.ts';
import {evaluateDraft} from '../packages/backend/src/studio/editorial-gate.ts';
import {buildEditorialIssues} from '../packages/backend/src/studio/editorial-issues.ts';

test('stale Chinese remains visible history while all current English BLOCKs stay effective',()=>{
  const source={article_id:'language-source',revision:1,content_sha256:'a'.repeat(64),url:'https://maker.example/news',published_at:'2026-11-08T00:00:00Z'};
  const packet:Packet={schema:'aihot-editorial-pilot/1',task_id:'language-task',created_at:'2026-11-09T00:00:00Z',scope:'LOCAL_AGENT_HANDOFF_NOT_AUTOMATED_AIHOT_PIPELINE',draft_article_ids:[source.article_id],articles:[{binding:source,source_id:'maker',source_name:'Maker',title:'Outdoor cabinet layout',body_status:'ok',body_text:'The maker explains cabinet layout and service access for buyers.'}]};
  const draft:Response['drafts'][number]={source,title_zh:'户外箱体',review_zh:'我们的屏幕达到9000 nits。',title_en:'Outdoor cabinet layout',body_en:'The guide explains cabinet layout and service access for buyers. Source: https://maker.example/news',meta_description_en:'A cabinet layout and service access guide.',keyword_hypothesis:'cabinet layout',questions_zh:[],evidence:[{claim:'Source topic',quote:'cabinet layout'}]};
  const unchanged=structuredClone(draft);
  assert.ok(evaluateDraft(packet,draft,{publishedTexts:[]}).findings.some(f=>f.field==='review_zh'&&f.severity==='BLOCK'));
  const english=evaluateDraft(packet,draft,{publishedTexts:[],reviewLanguage:'en'});
  assert.equal(english.blocked,false);
  assert.ok(english.findings.every(f=>f.field!=='review_zh'&&f.field!=='title_zh'));
  assert.equal(english.findings.some(f=>f.ruleId==='W7'),false,'no stale bilingual mismatch is treated as current fact');
  assert.doesNotThrow(()=>buildEditorialIssues(packet,draft,english),'locations still address the unmodified stored document');
  assert.deepEqual(draft,unchanged,'internal review text is never silently erased');
  const bad={...draft,body_en:'Our screen reaches 9000 nits. '+draft.body_en};
  const live=evaluateDraft(packet,bad,{publishedTexts:[],reviewLanguage:'en'});
  assert.ok(live.findings.some(f=>f.field==='body_en'&&f.severity==='BLOCK'));
  assert.equal(live.blocked,true,'English-first review is not a bypass for public claims');
});
