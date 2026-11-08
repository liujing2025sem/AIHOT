// Operator-maintained question map. Demand is a planning signal, never a company fact.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import sourcePack from '../../../../industry/sources.json' with { type: 'json' };
import { sql } from '../db.ts';
import { audit, Conflict } from '../audit.ts';
import { hasEnglishKeyword } from './studio-question-match.ts';

export const customerRoles = ['集成商/安装商/招牌制作商','分销商/代理商','终端业主/广告媒体主','租赁公司/政府与交通','未知'] as const;
const SOURCES = sourcePack.sources;
export const questionDimensions = ['场景','部件','工况','费用','维护','供货','控制软件'] as const;
const invalid = (message: string): never => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const realUrl = z.string().max(2000).refine(value => {
  if (!value) return true;
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password; } catch { return false; }
}, '请输入实际页面的HTTP(S) URL，未知留空');
export const questionSchema = z.object({
  question: z.string().trim().min(4).max(500),
  origin:z.enum(['operator','pitch']).optional(),
  question_en: z.string().trim().max(500).default(''),
  roles: z.array(z.enum(customerRoles)).min(1).max(5),
  scenario: z.string().trim().min(1).max(100),
  dimension: z.enum(questionDimensions),
  existing_url: realUrl.default(''),
  existing_url_provenance: z.enum(['operator_entered','read_from_source']).default('operator_entered'),
  condition_refs: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  source_ids: z.array(z.string().min(1).max(150)).max(30).default([]),
  demand_evidence: z.array(z.object({ type: z.enum(['inquiry','gsc','semrush','engineering','grill-example']), reference: z.string().min(1).max(300) }).strict()).max(30).default([]),
  keywords: z.array(z.string().trim().min(2).max(80)).max(50).default([]),
  keywords_zh: z.array(z.string().trim().min(2).max(80)).max(25).default([]),
  keywords_en: z.array(z.string().trim().min(2).max(80)).max(25).default([]),
  content_type: z.enum(['explainer','tutorial','tool','news']).default('explainer'),
  requires_first_party: z.boolean().default(false),
  active: z.boolean().default(true),
}).strict().superRefine((q,ctx) => {
  if(!hasEnglishKeyword(q))ctx.addIssue({code:'custom',path:['keywords_en'],message:'至少填写一个英文关键词，以便匹配英文信源'});
  if(q.content_type==='tutorial'&&!q.requires_first_party)ctx.addIssue({code:'custom',path:['requires_first_party'],message:'软件教程必须要求工程实机材料'});
});
export type StudioQuestion = z.infer<typeof questionSchema>;
export type StudioQuestionRow = {id:string;document:StudioQuestion;version:number;created_at:Date;updated_at:Date};

async function checkSourceIds(questions: StudioQuestion[]) {
  const stored = await sql`SELECT id FROM sources`;
  const available = new Set([...SOURCES.map(source=>source.id), ...stored.map(row=>row.id)]);
  for (const q of questions) for (const id of q.source_ids) if (!available.has(id)) invalid(`问题“${q.question.slice(0,30)}”的信源尚未配置：${id}；请先预览并注册，或留空。`);
}

export async function studioQuestions() {
  const rows = await sql<StudioQuestionRow[]>`SELECT id,document,version,created_at,updated_at FROM studio_questions ORDER BY updated_at DESC,id`;
  const sources = await sql`SELECT id,name FROM sources ORDER BY name`;
  const catalogue = new Map([...SOURCES.map(s=>[s.id,{id:s.id,name:s.name}] as const),...sources.map(s=>[s.id,{id:s.id,name:s.name}] as const)]);
  return {rows,options:{roles:customerRoles,dimensions:questionDimensions,sources:[...catalogue.values()]}};
}

export async function saveStudioQuestion(input: unknown, actor: string) {
  const body = z.object({id:z.string().optional(),version:z.number().int().positive().optional(),document:questionSchema}).strict().parse(input);
  await checkSourceIds([body.document]);
  return sql.begin(async tx=>{
    if (body.id) {
      const [before] = await tx<StudioQuestionRow[]>`SELECT id,document,version,created_at,updated_at FROM studio_questions WHERE id=${body.id} FOR UPDATE`;
      if(!before)invalid('问题不存在。');
      if(before.version!==body.version)throw new Conflict('问题已被更新，请刷新后修改。');
      const [after] = await tx`UPDATE studio_questions SET document=${tx.json(body.document)},version=version+1,updated_by=${actor},updated_at=now() WHERE id=${body.id} RETURNING id,document,version`;
      await audit(actor,'studio.question.save',`studio-question:${body.id}`,null,{version:before.version},{version:after.version},{db:tx});
      return after;
    }
    const id=`question-${randomUUID()}`;
    await tx`INSERT INTO studio_questions(id,document,created_by,updated_by) VALUES(${id},${tx.json(body.document)},${actor},${actor})`;
    await audit(actor,'studio.question.create',`studio-question:${id}`,null,null,{version:1},{db:tx});
    return {id,document:body.document,version:1};
  }).catch(error=>{if(error.code==='23505')invalid('已有相同问法，请打开原问题修改。');throw error;});
}

export async function importStudioQuestions(input: unknown, actor: string) {
  const body=z.object({questions:z.array(questionSchema).min(1).max(100)}).strict().parse(input);
  if(new Set(body.questions.map(q=>q.question)).size!==body.questions.length)invalid('同一导入中存在重复问法。');
  await checkSourceIds(body.questions);
  return sql.begin(async tx=>{
    let created=0,skipped=0;
    // Do not overwrite an operator's edited question when reimporting the example.
    for(const question of body.questions){
      const inserted=await tx`INSERT INTO studio_questions(id,document,created_by,updated_by) VALUES(${`question-${randomUUID()}`},${tx.json(question)},${actor},${actor}) ON CONFLICT DO NOTHING RETURNING id`;
      if(inserted.length)created++;else skipped++;
    }
    await audit(actor,'studio.questions.import','studio-questions',null,null,{created,skipped},{db:tx});
    return {created,skipped};
  });
}
