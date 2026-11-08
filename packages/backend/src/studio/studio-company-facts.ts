import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Packet, Response } from '../../../../scripts/editorial-pilot-lib.ts';
import type { Finding } from './editorial-gate.ts';

const schema=z.array(z.object({id:z.string().min(1),match:z.string().min(2).max(300),action:z.enum(['deny','confirm']),conservative:z.string().min(1).max(500)}).strict()).max(30);
export function companyFactRules(){
  const path=process.env.AIHOT_COMPANY_FACTS_FILE?.trim();
  if(!path)return {configured:false,rules:[] as z.infer<typeof schema>};
  try{return {configured:true,rules:schema.parse(JSON.parse(readFileSync(path,'utf8')))};}
  catch{throw Object.assign(new Error('公司事实文件无法读取或格式不正确，请维护人检查私有配置。'),{statusCode:400});}
}
export function pitchDraftFindings(packet:Packet,draft:Response['drafts'][number]):Finding[]{
  if(!packet.pitch)return [];
  const out:Finding[]=[];
  const rules=companyFactRules().rules;
  for(const field of ['title_en','body_en','meta_description_en','title_zh','review_zh'] as const){
    const text=draft[field];
    const add=(value:string,reason:string)=>{
      const start=text.toLocaleLowerCase().indexOf(value.toLocaleLowerCase());
      if(start>=0)out.push({ruleId:'D1',severity:'BLOCK',field,start,end:start+value.length,quote:text.slice(start,start+value.length),reason});
    };
    for(const rule of rules){
      const answered=packet.pitch.engineer.mode==='engineer'&&packet.pitch.engineer.answers.some(a=>a.question_id===`fact-${rule.id}`&&a.choice!=='A');
      if(rule.action==='deny'||!answered)add(rule.match,rule.action==='deny'?'公司事实禁止项命中，不能人工放行。':'公司事实尚无对应工程确认，请采用保守写法。');
    }
    for(const value of packet.pitch.withheld_numbers)add(value,'备料确认选择了保守写法，此数值没有获得工程确认，须从成稿移除。');
    if(packet.pitch.engineer.mode!=='engineer')add('Reviewed by Chipshow Engineering Team','工程师未确认，不能署名为工程团队已审。');
  }
  return out;
}
