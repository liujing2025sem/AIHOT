// Manual observations reuse the audit log. Missing observations never mean no human edits.
import { z } from 'zod';
import { sql } from '../db.ts';
import { audit, Conflict } from '../audit.ts';
import { sha256 } from '../../../../scripts/editorial-pilot-lib.ts';

export const documentIdentity = (d: Record<string, unknown>) => sha256(JSON.stringify([d.title_zh,d.title_en,d.review_zh,d.body_en,d.meta_description_en,d.keyword_hypothesis,d.news_status??'reported',d.questions_zh??[],d.source,d.figures??[],d.brief??null]));
const observation = z.object({ version:z.number().int().positive(),substantive:z.boolean(),categories:z.array(z.enum(['fact','attribution','conclusion','title','format'])),
  minutes:z.number().finite().min(0).max(1440).nullable(),full_review:z.boolean(),missed_block:z.boolean(),major_fact_error:z.boolean(),note:z.string().trim().min(1).max(3000) });

export async function studioReviewMetrics() {
  const [drafts, records, policies] = await Promise.all([
    sql`SELECT id,document FROM studio_drafts ORDER BY created_at DESC,id`,
    sql`SELECT DISTINCT ON (subject) subject,after,created_at FROM audit_log WHERE action='studio.review.observation' ORDER BY subject,created_at DESC,id DESC`,
    sql`SELECT after FROM audit_log WHERE action='studio.review.policy' ORDER BY created_at DESC,id DESC LIMIT 1`,
  ]);
  const reviews = drafts.map(d => records.find(r=>r.subject===`studio-draft:${d.id}` && r.after.document_hash===documentIdentity(d.document)))
    .filter((r):r is NonNullable<typeof r>=>!!r).sort((a,b)=>+new Date(b.created_at)-+new Date(a.created_at));
  const policy=policies[0]?.after??{tier:30,backtest_confirmed:false};
  const stageReviews=reviews.filter(r=>!policy.started_at||+new Date(r.created_at)>=Date.parse(policy.started_at));
  const substantive=reviews.filter(r=>r.after.substantive).length;
  const complete=drafts.length>0&&reviews.length===drafts.length;
  const qualifies=(n:number,rate:number)=>policy.backtest_confirmed===true&&complete&&stageReviews.length>=n
    &&stageReviews.slice(0,n).every(r=>r.after.full_review&&!r.after.missed_block&&!r.after.major_fact_error)
    &&stageReviews.slice(0,n).filter(r=>r.after.substantive).length/n<=rate;
  let streak=0;for(const r of stageReviews){if(!r.after.full_review||r.after.missed_block||r.after.major_fact_error)break;streak++;}
  return {tier:Number(policy.tier),tierStartedAt:policy.started_at??null,backtestConfirmed:policy.backtest_confirmed===true,totalDrafts:drafts.length,observedDrafts:reviews.length,unobservedDrafts:drafts.length-reviews.length,
    substantiveDrafts:substantive,interventionRate:complete?substantive/drafts.length:null,observedInterventionRate:reviews.length?substantive/reviews.length:null,
    zeroMissStreak:streak,eligible20:qualifies(10,.3),eligible10:qualifies(20,.2),
    mandatoryAlways:['认证资质','价格交期质保','客户案例','新领域首篇'],
    trend:reviews.slice(0,20).map(r=>({at:r.created_at,substantive:r.after.substantive,minutes:r.after.minutes,fullReview:r.after.full_review,missedBlock:r.after.missed_block,majorFactError:r.after.major_fact_error})),
    note:'30/20/10为审稿策略档位，不能作为已实现的人工工时占比。缺少人工记录时介入率保留未知。'};
}
export async function recordStudioReview(id:string,input:unknown,actor:string) {
  const b=observation.parse(input);
  if(b.substantive&&!b.categories.some(c=>c!=='format'))throw Object.assign(Error('实质修改需指出事实、归属、结论或标题。'),{statusCode:400});
  return sql.begin(async tx=>{
    const [row]=await tx`SELECT version,document FROM studio_drafts WHERE id=${id} FOR UPDATE`;
    if(!row)return null;if(row.version!==b.version)throw new Conflict('稿件版本已更新，请刷新后记录。');
    await audit(actor,'studio.review.observation',`studio-draft:${id}`,b.note,null,{...b,document_hash:documentIdentity(row.document)},{db:tx});
    if(b.major_fact_error){
      const [p]=await tx`SELECT after FROM audit_log WHERE action='studio.review.policy' ORDER BY created_at DESC,id DESC LIMIT 1`;
      const tier=Number(p?.after?.tier??30);const next=tier===10?20:30;
      await audit(actor,'studio.review.policy','studio-review-policy','重大事实错误，立即退回上一档',p?.after??null,{tier:next,backtest_confirmed:false,started_at:new Date().toISOString(),trigger_draft:id},{db:tx});
    }
    return {id,recorded:true};
  });
}
export async function setStudioReviewPolicy(input:unknown,actor:string) {
  const b=z.object({tier:z.union([z.literal(30),z.literal(20),z.literal(10)]),backtest_confirmed:z.boolean(),note:z.string().trim().min(1).max(3000)}).parse(input);
  const metrics=await studioReviewMetrics();
  if(b.tier===10&&!(metrics.tier===20&&metrics.eligible10)||b.tier===20&&metrics.tier===30&&!metrics.eligible20)throw Object.assign(Error('连续样本、人工记录或历史回测条件尚未满足，不能降档。'),{statusCode:400});
  await audit(actor,'studio.review.policy','studio-review-policy',b.note,null,{...b,started_at:b.tier===metrics.tier?metrics.tierStartedAt:new Date().toISOString()});
  return studioReviewMetrics();
}
