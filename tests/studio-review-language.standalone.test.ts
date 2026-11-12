import assert from 'node:assert/strict';
import {test} from 'node:test';
import {packetSchema,sha256,validateResponse,type Packet,type Response} from '../scripts/editorial-pilot-lib.ts';
import {evaluateDraft} from '../packages/backend/src/studio/editorial-gate.ts';
import {buildEditorialIssues} from '../packages/backend/src/studio/editorial-issues.ts';
import {applyDraftRevision, revisionGoalSchema} from '../packages/backend/src/studio/studio-revision-edits.ts';
import {briefGenerationSchema,buildBriefResponse} from '../packages/backend/src/studio/studio-brief-content.ts';
import {editedFragmentPacket,manuallyEditedFragmentPacket} from '../packages/backend/src/studio/studio-review-edits.ts';
import {assembleFragments} from '../packages/backend/src/studio/studio-pitch-fragments.ts';

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

function revisionFixture() {
  const source={article_id:'revision-source',revision:1,content_sha256:'a'.repeat(64),url:'https://maker.example/news',published_at:'2026-11-08T00:00:00Z'};
  const packet:Packet={schema:'aihot-editorial-pilot/1',task_id:'revision-task',created_at:'2026-11-09T00:00:00Z',scope:'LOCAL_AGENT_HANDOFF_NOT_AUTOMATED_AIHOT_PIPELINE',draft_article_ids:[source.article_id],articles:[{binding:source,source_id:'maker',source_name:'Maker',title:'Cabinet installation guide',body_status:'ok',body_text:'Check the installation drawing before mounting.'}]};
  const draft:Response['drafts'][number]={source,title_zh:'安装检查',review_zh:'安装前核对图纸。',title_en:'Installation checklist',body_en:'Before mounting, check the installation drawing. This guide explains the installation drawing. Source: https://maker.example/news',meta_description_en:'A checklist for installation drawings.',keyword_hypothesis:'installation drawing',questions_zh:[],evidence:[{claim:'Check the drawing',quote:'Check the installation drawing before mounting.'}]};
  return {packet,draft};
}

function manualFragmentFixture() {
  const {packet,draft}=revisionFixture();
  const paragraphs=[
    {id:'p1',html:'<div class="original-wrapper">\n<p>Before mounting, consult the installation drawing and its original mounting instructions.</p>\n</div>',text:'Before mounting, consult the installation drawing and its original mounting instructions.'},
    {id:'p2',html:'<p>Keep this original paragraph.</p>',text:'Keep this original paragraph.'},
  ];
  packet.pitch={question:'What should a buyer check?',output_type:'update',existing_url:draft.source.url,selected_title:draft.title_en,primary_article_id:draft.source.article_id,
    outline:[{id:'installation',heading:'Installation checklist',evidence:[{article_id:draft.source.article_id,quote:'Check the installation drawing before mounting.'}],gap:'',action:''}],
    engineer:{mode:'conservative',name:'',reply:'',answers:[]},withheld_numbers:[],fragments_plan:{paragraphs,
      facts:[{id:'f1',kind:'source',statement:'Check the installation drawing before mounting.',quote:'Check the installation drawing before mounting.',article_id:draft.source.article_id,revision:1,attribution:'Maker'}],subquestions:[],
      edit_plan:[{op:'revise',paragraph:'p1',facts:['f1']},{op:'keep',paragraph:'p2',facts:[]},{op:'insert_after',paragraph:'p2',facts:['f1']}],
      fragments:[{op_index:0,html_en:'<p>Before mounting, check the installation drawing.</p>',zh_review:'安装前核对图纸。',used_facts:['f1']},{op_index:2,html_en:'<p>Confirm the mounting instructions with the maker.</p>',zh_review:'向厂商核对安装说明。',used_facts:['f1']}],
      source_html:paragraphs.map(p=>p.html).join(''),original_title:draft.title_en,method_rule_ids:[]}};
  const plan=packet.pitch.fragments_plan!;
  draft.body_en=assembleFragments(plan.paragraphs,plan.edit_plan,plan.fragments!).html_en;
  return {packet,draft};
}

test('manual edits in separated fragments preserve wrappers, kept bytes and their original evidence',()=>{
  const {packet,draft}=manualFragmentFixture(),snapshot=structuredClone(packet);
  const body=draft.body_en.replace('Before mounting','Before installation').replace('Confirm the mounting','Check the mounting');
  const updated=manuallyEditedFragmentPacket(packet,{...draft,body_en:body});
  assert.ok(updated);
  const before=packet.pitch!.fragments_plan!,after=updated.pitch!.fragments_plan!;
  assert.equal(assembleFragments(after.paragraphs,after.edit_plan,after.fragments!).html_en,body);
  assert.deepEqual(after.paragraphs,before.paragraphs);
  assert.deepEqual(after.facts,before.facts);
  assert.deepEqual(after.edit_plan,before.edit_plan);
  assert.deepEqual(after.fragments!.map(({html_en:_,...rest})=>rest),before.fragments!.map(({html_en:_,...rest})=>rest));
  assert.equal(body.split('class="original-wrapper"').length,2);
  assert.equal(evaluateDraft(updated,{...draft,body_en:body},{reviewLanguage:'en'}).blocked,false);
  assert.deepEqual(packet,snapshot);
  assert.equal(manuallyEditedFragmentPacket(updated,{...draft,body_en:body}),updated,'a consistent save leaves the packet unchanged');
});

test('an insertion at a kept paragraph boundary belongs to the unique editable raw fragment',()=>{
  for(const [html,prefix] of [['Check the mounting drawing.','Before installation, '],['<p>Check the mounting drawing.</p>','\n']]){
    const {packet,draft}=manualFragmentFixture(),plan=packet.pitch!.fragments_plan!;
    plan.fragments![1].html_en=html;
    draft.body_en=assembleFragments(plan.paragraphs,plan.edit_plan,plan.fragments!).html_en;
    const snapshot=structuredClone(packet),start=draft.body_en.length-html.length;
    const body=draft.body_en.slice(0,start)+prefix+html;
    for(const updated of [
      editedFragmentPacket(packet,draft,start,start,prefix),
      manuallyEditedFragmentPacket(packet,{...draft,body_en:body}),
    ]){
      assert.ok(updated,`accept the prefix ${JSON.stringify(prefix)} without changing the kept paragraph`);
      const after=updated.pitch!.fragments_plan!;
      assert.equal(after.fragments![1].html_en,prefix+html);
      assert.deepEqual(after.paragraphs,plan.paragraphs);
      assert.deepEqual(after.fragments![0],plan.fragments![0]);
      assert.equal(assembleFragments(after.paragraphs,after.edit_plan,after.fragments!).html_en,body);
    }
    assert.deepEqual(packet,snapshot);
  }
});

test('fragment boundary insertions keep wrapper bytes protected and adjacent editable ownership unambiguous',()=>{
  const {packet,draft}=manualFragmentFixture(),plan=packet.pitch!.fragments_plan!;
  const html=plan.fragments![0].html_en,start=draft.body_en.indexOf(html);
  const inserted=editedFragmentPacket(packet,draft,start,start,'\n');
  assert.ok(inserted);
  assert.equal(inserted.pitch!.fragments_plan!.fragments![0].html_en,'\n'+html);
  assert.equal(editedFragmentPacket(packet,draft,start-1,start,' '),null,'existing wrapper whitespace stays protected');
  plan.edit_plan.push({op:'insert_after',paragraph:'p2',facts:['f1']});
  plan.fragments!.push({op_index:3,html_en:'<p>Ask the maker about installation access.</p>',zh_review:'向厂商核对安装通道。',used_facts:['f1']});
  draft.body_en=assembleFragments(plan.paragraphs,plan.edit_plan,plan.fragments!).html_en;
  const boundary=draft.body_en.length-plan.fragments![2].html_en.length;
  assert.equal(editedFragmentPacket(packet,draft,boundary,boundary,'\n'),null,'neither adjacent fragment owns the shared insertion boundary');
  assert.equal(manuallyEditedFragmentPacket(packet,{...draft,body_en:draft.body_en.slice(0,boundary)+'\n'+draft.body_en.slice(boundary)}),null);
});

test('manual save reconciles already-saved English against the canonical fragments and keeps content gates',()=>{
  const {packet,draft}=manualFragmentFixture();
  draft.body_en=draft.body_en.replace('Before mounting','Before installation');
  assert.equal(evaluateDraft(packet,draft,{reviewLanguage:'en'}).blocked,true);
  const repaired=manuallyEditedFragmentPacket(packet,draft);
  assert.ok(repaired);
  assert.equal(evaluateDraft(repaired,draft,{reviewLanguage:'en'}).blocked,false);
  const unsafe={...draft,body_en:draft.body_en.replace('check the installation drawing','expect 9000 nits')};
  const updated=manuallyEditedFragmentPacket(repaired,unsafe);
  assert.ok(updated,'content problems can still be saved for review');
  assert.equal(evaluateDraft(updated,unsafe,{reviewLanguage:'en'}).blocked,true,'fragment synchronization does not approve unsupported numbers');
});

test('manual save rejects changed keep bytes, revised wrappers and an emptied fragment without changing the packet',()=>{
  const {packet,draft}=manualFragmentFixture(),snapshot=structuredClone(packet);
  const keep=packet.pitch!.fragments_plan!.paragraphs[1].html;
  const fragment=packet.pitch!.fragments_plan!.fragments![0].html_en;
  for(const body of [
    draft.body_en.replace(keep,'<p>Replace the original paragraph.</p>'),
    draft.body_en.replace(keep,''),
    draft.body_en.replace('class="original-wrapper"','class="changed-wrapper"'),
    draft.body_en.replace(fragment,''),
  ])assert.equal(manuallyEditedFragmentPacket(packet,{...draft,body_en:body}),null);
  assert.deepEqual(packet,snapshot);
});

test('manual save keeps adjacent fragment ownership and refuses ambiguous cross-fragment edits',()=>{
  const {packet,draft}=manualFragmentFixture();
  const plan=packet.pitch!.fragments_plan!;
  plan.edit_plan.push({op:'insert_after',paragraph:'p2',facts:['f1']});
  plan.fragments!.push({op_index:3,html_en:'<p>Ask the maker about installation access.</p>',zh_review:'向厂商核对安装通道。',used_facts:['f1']});
  draft.body_en=assembleFragments(plan.paragraphs,plan.edit_plan,plan.fragments!).html_en;
  const snapshot=structuredClone(packet);
  const one=draft.body_en.replace('Confirm the mounting','Check the mounting');
  const accepted=manuallyEditedFragmentPacket(packet,{...draft,body_en:one});
  assert.ok(accepted);
  assert.deepEqual(accepted.pitch!.fragments_plan!.fragments![2],plan.fragments![2]);
  const both=one.replace('Ask the maker','Consult the maker');
  assert.equal(manuallyEditedFragmentPacket(packet,{...draft,body_en:both}),null);
  assert.deepEqual(packet,snapshot);
});

test('repeated bytes cannot move an insertion or deletion into a neighboring fragment',()=>{
  const {packet,draft}=manualFragmentFixture();
  const plan=packet.pitch!.fragments_plan!;
  plan.edit_plan.push({op:'insert_after',paragraph:'p2',facts:['f1']});
  plan.fragments![1].html_en='<p>Check the drawing.</p>';
  plan.fragments!.push({...plan.fragments![1],op_index:3});
  draft.body_en=assembleFragments(plan.paragraphs,plan.edit_plan,plan.fragments!).html_en;
  assert.equal(manuallyEditedFragmentPacket(packet,{...draft,body_en:draft.body_en+plan.fragments![1].html_en}),null);
  plan.fragments![1].html_en='aaaa';plan.fragments![2].html_en='aaaa';
  draft.body_en=assembleFragments(plan.paragraphs,plan.edit_plan,plan.fragments!).html_en;
  assert.equal(manuallyEditedFragmentPacket(packet,{...draft,body_en:draft.body_en.slice(0,-1)}),null);
});

test('chosen revision goals need no free text and bounded edits preserve the original draft and evidence',()=>{
  assert.equal(revisionGoalSchema.parse('shorten'),'shorten');
  assert.throws(()=>revisionGoalSchema.parse('invent_company_case'));
  const {packet,draft}=revisionFixture(),snapshot=structuredClone(draft);
  const revised=applyDraftRevision(packet,draft,{edits:[{field:'body_en',original:' This guide explains the installation drawing.',replacement:''}]});
  assert.ok(revised.draft.body_en.startsWith('Before mounting, check the installation drawing. Source:'));
  assert.deepEqual(revised.draft.source,draft.source);
  assert.deepEqual(revised.draft.evidence,draft.evidence);
  assert.deepEqual(draft,snapshot);
  assert.equal(revised.chineseStale,true,'an English-only change never silently approves the Chinese review');
});

test('a model Chinese review patch never clears the stale flag from an English revision',()=>{
  const {packet,draft}=revisionFixture(),snapshot=structuredClone(draft);
  for(const change of [
    {field:'title_en',original:draft.title_en,replacement:'Installation drawing checklist'},
    {field:'body_en',original:' This guide explains the installation drawing.',replacement:''},
    {field:'meta_description_en',original:draft.meta_description_en,replacement:'Check installation drawings before mounting.'},
  ]){
    const revised=applyDraftRevision(packet,draft,{edits:[change,
      {field:'review_zh',original:draft.review_zh,replacement:draft.review_zh+'请核对。'},
    ]});
    assert.equal(revised.chineseStale,true,`${change.field} still needs human English review`);
    assert.notEqual(revised.draft.review_zh,draft.review_zh);
  }
  assert.deepEqual(draft,snapshot);
});

function revisionBriefFixture(count:number) {
  const articles=Array.from({length:count},(_,i)=>{
    const title=`Maker ${i+1} announces a driver`,body=`Maker ${i+1} announces a driver.`;
    return {binding:{article_id:`revision-brief-${i+1}`,revision:1,content_sha256:sha256(JSON.stringify([title,'ok',body])),url:`https://example.com/driver-${i+1}`,published_at:'2026-11-03T00:00:00.000Z'},title,body_status:'ok',body_text:body,source_id:`maker-${i+1}`,source_name:`Maker ${i+1}`};
  });
  const packet=packetSchema.parse({schema:'aihot-editorial-pilot/1',task_id:'revision-brief',created_at:'2026-11-09T00:00:00.000Z',scope:'LOCAL_AGENT_HANDOFF_NOT_AUTOMATED_AIHOT_PIPELINE',articles,draft_article_ids:articles.map(a=>a.binding.article_id),
    brief:{schema:'aihot-brief-selection/1',events:articles.map((a,i)=>({article_id:a.binding.article_id,event_id:`fact-${i+1}`,section:'components-ics',publication_time:'2026-11-03',source_utc_offset:'+00:00',date_basis:'published',observed_version_at:null})),pages:[]}});
  const generated=briefGenerationSchema.parse({decision:'draft',title_en:'LED driver announcements',title_zh:'驱动器件更新',
    in_5_seconds:[1,2,3].map(i=>({event_key:`driver-${i}`,text_en:`Maker ${i} announces a driver.`})),
    items:articles.map((a,i)=>({event_key:`driver-${i+1}`,article_ids:[a.binding.article_id],primary_article_id:a.binding.article_id,section:'components-ics',title_en:a.title,title_zh:`厂商${i+1}发布器件`,body_en:a.body_text,review_zh:'厂商发布器件。',news_status:'reported',hook_anchor_quote:a.title,evidence:[{article_id:a.binding.article_id,claim:'Manufacturer announcement.',quote:a.body_text}]})),
    questions_zh:[],keyword_hypothesis:'LED driver announcements',meta_description_en:'Manufacturer driver announcements with original dates and sources.'});
  if(generated.decision!=='draft')throw Error('Invalid synthetic brief fixture');
  const response=buildBriefResponse(packet,generated,{agent_id:'revision-test',model:null,input_files:['synthetic fixtures']},'revision-brief-run');
  validateResponse(packet,response);
  return {packet,response};
}

for(const count of [5,12])test(`a ${count}-event brief accepts a title-only revision without losing its KEEP source coverage`,()=>{
  const {packet,response}=revisionBriefFixture(count),draft=response.drafts[0]!;
  const originalPacket=structuredClone(packet),originalDraft=structuredClone(draft);
  const revised=applyDraftRevision(packet,draft,{edits:[{field:'title_en',original:draft.title_en,replacement:'LED driver updates'}]});
  assert.equal(revised.draft.title_en,'LED driver updates');
  assert.equal(revised.chineseStale,true);
  assert.equal(revised.draft.brief?.items.length,count);
  assert.equal(revised.draft.body_en,draft.body_en);
  assert.deepEqual(revised.draft.source,draft.source);
  assert.deepEqual(revised.draft.evidence,draft.evidence);
  assert.deepEqual(revised.draft.brief,draft.brief);
  assert.deepEqual(revised.packet,originalPacket);
  assert.deepEqual(draft,originalDraft);
  assert.doesNotThrow(()=>validateResponse(packet,{...response,drafts:[revised.draft]}));
});

test('revision refuses stale, ambiguous, overlapping, empty and source-removing edits atomically',()=>{
  const {packet,draft}=revisionFixture(),snapshot=structuredClone(draft);
  const change=(original:string,replacement='')=>({field:'body_en',original,replacement});
  for(const edits of [
    [change('not in the draft')],
    [change('installation drawing')],
    [change(draft.body_en)],
    [change('https://maker.example/news')],
    [change('Before mounting, check the installation drawing.'),change('Before mounting, check')],
  ])assert.throws(()=>applyDraftRevision(packet,draft,{edits}));
  assert.deepEqual(draft,snapshot);
});

test('a revision cannot rewrite a preserved live-page paragraph or bypass current content gates',()=>{
  const {packet,draft}=revisionFixture();
  draft.body_en='<p>Keep this original paragraph.</p><p>Improve this new paragraph.</p> Source: https://maker.example/news';
  packet.pitch={question:'What should a buyer check?',output_type:'update',existing_url:'https://chipshow.com/guide',selected_title:draft.title_en,primary_article_id:draft.source.article_id,outline:[],engineer:{mode:'conservative',name:'',reply:'',answers:[]},withheld_numbers:[],fragments_plan:{paragraphs:[{id:'p1',html:'<p>Keep this original paragraph.</p>',text:'Keep this original paragraph.'}],facts:[],subquestions:[],edit_plan:[{op:'keep',paragraph:'p1',facts:[]}],source_html:draft.body_en,original_title:draft.title_en,method_rule_ids:[]}};
  assert.throws(()=>applyDraftRevision(packet,draft,{edits:[{field:'body_en',original:'Keep this original paragraph.',replacement:'Replace the live page.'}]}),/保留段落/);
  const revised=applyDraftRevision(packet,draft,{edits:[{field:'body_en',original:'Improve this new paragraph.',replacement:'Our screen reaches 9000 nits.'}]});
  assert.equal(evaluateDraft(packet,revised.draft,{publishedTexts:[],reviewLanguage:'en'}).blocked,true,'a model edit is still a draft and must pass the existing gate');
});
