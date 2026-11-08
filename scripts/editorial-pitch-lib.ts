import { z } from 'zod';

export const pitchType = z.enum(['auto','update','guide','short']);
export const outlineSection = z.object({
  id:z.string().min(1).max(80), heading:z.string().min(1).max(200),
  evidence:z.array(z.object({article_id:z.string(),quote:z.string().min(1).max(600)})).max(8),
  gap:z.string().max(800).default(''), action:z.string().max(800).default(''),
});
export const engineerQuestion = z.object({
  id:z.string().min(1).max(80),question:z.string().min(1).max(500),section_ids:z.array(z.string()).max(7),
  options:z.array(z.object({id:z.string().regex(/^[A-D]$/),label:z.string().min(1).max(500),instruction:z.string().max(800),conservative:z.boolean()})).min(2).max(4),
  withheld_numbers:z.array(z.string().min(1).max(100)).max(20),
});
const pitchPlanObject=z.object({
  output_type:z.enum(['update','guide','short']),
  outline:z.array(outlineSection).min(4).max(7),
  titles:z.array(z.object({title:z.string().min(1).max(60),anchor:z.string().min(1).max(600),article_id:z.string(),quote:z.string().min(1).max(600)})).length(3),
  hooks:z.array(z.object({title:z.string().min(1).max(180),anchor:z.string().min(1).max(600),article_id:z.string(),quote:z.string().min(1).max(600)})).max(3),
  engineer_questions:z.array(engineerQuestion).max(3),
});
// Real Flash response used `type: update`; normalize this exact field alias, then validate everything.
export const pitchPlanSchema=z.preprocess(value=>{
  if(value&&typeof value==='object'&&!Array.isArray(value)){const v=value as Record<string,unknown>;if(v.output_type===undefined&&['update','guide','short'].includes(String(v.type)))return {...v,output_type:v.type};}
  return value;
},pitchPlanObject);
export const pitchKeywordsSchema=z.object({question_en:z.string().min(4).max(500),keywords:z.array(z.string().min(2).max(80)).min(5).max(10),entities:z.array(z.string().max(100)).max(15)});
export const pitchSchema=z.object({
  question:z.string().max(1000),output_type:z.enum(['update','guide','short']),existing_url:z.string(),selected_title:z.string().max(80),
  primary_article_id:z.string(),outline:z.array(outlineSection).min(1).max(7),
  engineer:z.object({mode:z.enum(['conservative','engineer']),name:z.string().max(100),reply:z.string().max(2000),
    answers:z.array(z.object({question_id:z.string(),choice:z.string(),note:z.string().max(1000),instruction:z.string().max(800)})).max(3)}),
  withheld_numbers:z.array(z.string().max(100)).max(60),
}).strict();
export type Pitch=z.infer<typeof pitchSchema>;
