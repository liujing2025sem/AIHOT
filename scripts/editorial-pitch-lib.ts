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
export const buyerSubquestionSchema=z.object({id:z.string().min(1).max(30),zh:z.string().min(1).max(300),en:z.string().min(1).max(300),need:z.enum(['page','reference','calc','company','news']),answer_shape:z.enum(['number','table','definition','steps']),terms:z.array(z.string().min(1).max(60)).min(2).max(4),calculation:z.object({fn:z.enum(['pixels','feet_to_meters','aspect_ratio']),inputs:z.record(z.string(),z.number()),basis:z.string().min(1).max(300)}).optional()});
export const buyerQuestionsSchema=z.object({question_en:z.string().max(500),subquestions:z.array(buyerSubquestionSchema).min(3).max(6)});
export const pitchFactSchema=z.object({id:z.string(),kind:z.enum(['page','source','calc','engineer']),statement:z.string(),quote:z.string().max(300),article_id:z.string().optional(),revision:z.number().optional(),date:z.string().nullable().optional(),attribution:z.string(),url:z.string().optional(),calculation:z.object({fn:z.string(),inputs:z.record(z.string(),z.number()),result:z.record(z.string(),z.number()),formula:z.string()}).optional()});
export const pageParagraphSchema=z.object({id:z.string(),html:z.string(),text:z.string()});
export const editOperationSchema=z.object({op:z.enum(['keep','revise','insert_after']),paragraph:z.string(),subquestion:z.string().optional(),reason:z.string().optional(),heading:z.string().optional(),facts:z.array(z.string()).max(6).default([])});
export const editPlanSchema=z.object({conclusion:z.enum(['upgrade','no_change']),coverage:z.array(z.object({id:z.string(),status:z.enum(['page_good','page_weak','direct','calc','engineer','missing']),page_paragraphs:z.array(z.string()),reason:z.string().max(500).default('')})),edits:z.array(editOperationSchema).max(12),titles:pitchPlanObject.shape.titles,hooks:pitchPlanObject.shape.hooks,engineer_questions:pitchPlanObject.shape.engineer_questions});
export const pageUpdatePlanSchema=editPlanSchema.omit({titles:true,hooks:true});
export const figureSpecSchema=z.object({template:z.enum(['grid-sizer','bar-compare','layer-stack','signal-flow']),params:z.record(z.string(),z.json()),alt_en:z.string(),caption_en:z.string(),fact_ids:z.array(z.string()).max(6).optional()});
export const fragmentSchema=z.object({html_en:z.string().min(1),zh_review:z.string().min(1),used_facts:z.array(z.string()).min(1).max(6),figure:figureSpecSchema.optional().catch(undefined)});
export const fragmentPlanSchema=z.object({paragraphs:z.array(pageParagraphSchema),facts:z.array(pitchFactSchema),subquestions:z.array(buyerSubquestionSchema),edit_plan:z.array(editOperationSchema),fragments:z.array(fragmentSchema.extend({op_index:z.number().int()})).optional(),source_html:z.string(),original_title:z.string(),method_rule_ids:z.array(z.string()).default([])});
export const editorialAdditions={comparison:'用可核对条件做对照表',checklist:'给买家可执行的核对清单',decision_summary:'英文正文先给结论与适用条件；中文对照只写入 zh_review'} as const;
export const editorialChoicesSchema=z.object({
  revision:z.number().int().nonnegative(),selected_title:z.string().min(1).max(60),
  article_ids:z.array(z.string()).min(1).max(12),
  outline:z.array(z.object({id:z.string(),heading:z.string().min(1).max(200),include:z.boolean()})).min(1).max(7),
  additions:z.array(z.enum(['comparison','checklist','decision_summary'])).max(3).default([]),
  note:z.string().max(2000).default(''),
});
export type EditorialChoices=z.infer<typeof editorialChoicesSchema>;
export const pitchSchema=z.object({
  question:z.string().max(1000),output_type:z.enum(['update','guide','short']),existing_url:z.string(),selected_title:z.string().max(80),
  primary_article_id:z.string(),outline:z.array(outlineSection).min(1).max(7),
  engineer:z.object({mode:z.enum(['conservative','engineer']),name:z.string().max(100),reply:z.string().max(2000),
    answers:z.array(z.object({question_id:z.string(),choice:z.string(),note:z.string().max(1000),instruction:z.string().max(800)})).max(3)}),
  withheld_numbers:z.array(z.string().max(100)).max(60),
  editorial_choices:editorialChoicesSchema.optional(),
  scope:z.object({original_question:z.string(),question:z.string(),omitted_questions:z.array(z.string())}).optional(),
  fragments_plan:fragmentPlanSchema.optional(),
}).strict();
export type Pitch=z.infer<typeof pitchSchema>;
