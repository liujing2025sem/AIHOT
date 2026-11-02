// Read-only replay of existing Studio drafts. No model calls or changes to business rows.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import path from 'node:path';
import postgres from 'postgres';
import { packetSchema, responseSchema } from './editorial-pilot-lib.ts';
import { evaluateDraft } from '../packages/backend/src/admin/editorial-gate.ts';
import { buildEditorialIssues } from '../packages/backend/src/admin/editorial-issues.ts';

const [input,second,third] = process.argv.slice(2);
const fileMode=input==='--fixtures', output=fileMode?third:second;
if(!input||!second||!output)throw Error('Usage: node scripts/editorial-backtest.ts <local database env file> <report.json> OR --fixtures <saved-input.json> <report.json>');
const fixture=fileMode?JSON.parse(await readFile(second,'utf8')):null;
const settings=fileMode?null:parseEnv(await readFile(input,'utf8'));
const db=settings?postgres(settings.DATABASE_URL!,{max:1,onnotice:()=>{}}):null;
// User/WorkBuddy handoff labels these two imported drafts as known-correct. This is a
// two-draft reference set, not independent human approval of every claim or the third API draft.
const safe=new Set(['cbdd5a6d-b2e7-4d68-96a7-fe0c47915107','708b04fb-eb10-49df-9054-671de7ddbbd7']);
try {
  const records: {id:string;document:unknown;status:string;request:unknown}[]=fixture?.records??await db!`SELECT d.id,d.document,d.status,t.request FROM studio_drafts d JOIN studio_tasks t ON t.id=d.task_id ORDER BY d.created_at,d.id`;
  const rows=records.map(r=>{
    const packet=packetSchema.parse(r.request);const draft=responseSchema.shape.drafts.element.parse(r.document);
    const gate=evaluateDraft(packet,draft,{publishedTexts:[]});
    const issues=buildEditorialIssues(packet,draft,gate);
    return {id:r.id,title:draft.title_zh,status:r.status,mode:'FULL_RULE_REPLAY',expectedSafe:safe.has(r.id),labelSource:safe.has(r.id)?'USER_WORKBUDDY_HANDOFF_REFERENCE':'UNLABELED',gate,issues};
  });
  // A saved hit list can demonstrate grouping without pretending missing draft fields were recovered.
  const savedOnly=(fixture?.savedOnly??[]).map((r:any)=>{
    const groups=new Map<string,any>();
    for(const f of r.gate.findings){
      const object=['W1','W2','W5','W7','W8'].includes(f.ruleId)?'draft':['W6','D4'].includes(f.ruleId)?f.quote.normalize('NFKC').trim():JSON.stringify([f.field,f.start,f.end,f.quote]);
      const key=JSON.stringify([f.ruleId,f.severity,object]);const item=groups.get(key)??{ruleId:f.ruleId,severity:f.severity,occurrences:[]};item.occurrences.push(f);groups.set(key,item);
    }
    return {id:r.id,title:r.title,mode:'SAVED_FINDINGS_GROUPING_ONLY',accuracyDenominator:false,rawWarnings:r.gate.findings.filter((f:any)=>f.severity==='WARN').length,issueCount:groups.size,blockFindingCount:r.gate.findings.filter((f:any)=>f.severity==='BLOCK').length,allLocationsRetained:true,groups:[...groups.values()]};
  });
  const labelled=rows.filter(r=>r.expectedSafe),falseBlocks=labelled.filter(r=>r.gate.blocked);
  const report={at:new Date().toISOString(),mode:fileMode?'READ_ONLY_ARCHIVE_REPLAY':'READ_ONLY_EXISTING_DRAFTS',total:rows.length,savedOnly,provenance:fixture?.provenance??null,labelledSafe:labelled.length,
    falseBlockCount:falseBlocks.length,falsePositiveRate:labelled.length?falseBlocks.length/labelled.length:null,
    missedBlockRate:null,truthBoundary:'误报率仅针对交接书标注的两篇参考稿；缺少独立真值的稿件不计入分母，漏检率未知。',rows};
  await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify({total:rows.length,labelledSafe:labelled.length,falsePositiveRate:report.falsePositiveRate,rows:rows.map(r=>({id:r.id,blocked:r.gate.blocked,block:r.gate.findings.filter(f=>f.severity==='BLOCK').map(f=>({rule:f.ruleId,quote:f.quote,field:f.field})),warnings:r.gate.findings.filter(f=>f.severity==='WARN').length}))}));
} finally {if(db)await db.end();}
