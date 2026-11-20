// Versioned JSON passed between Studio and the handoff CLI.
import { z } from 'zod';
import { CATEGORIES } from '@aihot/industry/taxonomy';
import { pitchSchema, figureSpecSchema } from './studio-pitch.ts';

export const safeId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/);
const sourceBinding = z.object({
  article_id: safeId, revision: z.number().int().positive(), content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  url: z.url(), published_at: z.string().nullable(),
}).strict();
export type SourceBinding = z.infer<typeof sourceBinding>;

const section = z.enum(CATEGORIES.map(c => c.key));
const evidence = z.object({ article_id: safeId, claim: z.string().min(1).max(1500), quote: z.string().min(1).max(350) }).strict();
export const briefSelectionSchema = z.object({
  schema: z.literal('aihot-brief-selection/1'),
  events: z.array(z.object({ article_id: safeId, event_id: z.string().nullable(), section,
    publication_time: z.string().nullable(), source_utc_offset: z.string(),
    date_basis: z.enum(['published', 'observed_version']), observed_version_at: z.string().nullable(),
  }).strict()).min(5).max(12),
  pages: z.array(z.object({ url: z.url(), title: z.string() }).strict()).max(30),
}).strict();
export const briefMetadataSchema = z.object({
  schema: z.literal('aihot-brief/1'),
  highlight_event_ids: z.array(safeId).length(3),
  items: z.array(z.object({ event_id: safeId, sources: z.array(sourceBinding).min(1).max(12), section,
    evidence: z.array(evidence).min(1).max(8),
  }).strict()).min(5).max(12),
}).strict();
export type BriefSelection = z.infer<typeof briefSelectionSchema>;
export type BriefMetadata = z.infer<typeof briefMetadataSchema>;

const plain = z.string().trim().min(1);
const generatedItem = z.object({
  event_key: safeId, article_ids: z.array(safeId).min(1).max(12), primary_article_id: safeId, section,
  title_en: plain.max(200), body_en: plain.max(2400), title_zh: plain.max(200), review_zh: plain.max(2400),
  news_status: z.enum(['reported', 'unconfirmed']).default('reported'),
  hook_anchor_quote: plain.max(350), evidence: z.array(evidence).min(1).max(8),
  why_it_matters_en: plain.max(800).optional(),
  go_deeper: z.object({ url: z.url(), label_en: plain.max(140) }).strict().optional(),
}).strict();
export const briefGenerationSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('hold'), reason_zh: plain.max(1000) }).strict(),
  z.object({ decision: z.literal('draft'), title_en: plain.max(250), title_zh: plain.max(250),
    in_5_seconds: z.array(z.object({ event_key: safeId, text_en: plain.max(250) }).strict()).length(3),
    items: z.array(generatedItem).min(5).max(12),
    questions_zh: z.array(z.string().max(1000)).max(30), keyword_hypothesis: plain.max(2000), meta_description_en: plain.max(2000),
    camos_rule_ids: z.array(z.string()).optional(), figures: z.array(figureSpecSchema).max(3).optional(),
  }).strict(),
]);
export type GeneratedBrief = Extract<z.infer<typeof briefGenerationSchema>, { decision: 'draft' }>;

export const packetShapeSchema = z.object({
  schema: z.literal('aihot-editorial-pilot/1'), task_id: safeId, created_at: z.string(),
  scope: z.literal('LOCAL_AGENT_HANDOFF_NOT_AUTOMATED_AIHOT_PIPELINE'),
  articles: z.array(z.object({
    binding: sourceBinding, source_id: z.string(), source_name: z.string(), title: z.string(),
    body_status: z.string(), body_text: z.string().nullable(),
  }).strict()).max(12),
  draft_article_ids: z.array(safeId),
  pitch: pitchSchema.optional(),
  brief: briefSelectionSchema.optional(),
  editorial_plan:z.object({card_id:safeId,question_id:z.string().nullable(),selection_origin:z.enum(['operator','automatic']).optional(),action:z.enum(['new_brief','new_explainer','new_tutorial','update_page']),question:z.string().min(1),existing_url:z.string(),requires_first_party:z.boolean()}).strict().optional(),
  reader_profile: z.object({countingBasis:z.string(),lastImportedAt:z.string().nullable(),totals:z.object({recordCount:z.number().int().nonnegative(),groupCount:z.number().int().nonnegative()}).strict(),descriptions:z.array(z.string()).max(20)}).strict().optional(),
  editorial_policy: z.object({ version: z.string(), publication_site: z.literal('chipshow.com'), placement: z.literal('blog'), public_language: z.literal('en'), review_language: z.literal('zh'), directions: z.array(z.string()), daily_digest: z.literal(true), allow_unconfirmed: z.literal(true), canonical_path: z.null() }).strict().optional(),
  methods: z.object({ status: z.enum(['connected','not_configured','unavailable']), ruleIds: z.array(z.string()), text: z.string(), provenance: z.record(z.string(),z.unknown()), reason: z.string().optional() }).optional(),
  // Older packets and neutral manufacturer news omit this; cwd never selects a brand.
  writing: z.object({
    site: z.enum(['chipshow.com', 'chipshowledusa.com', 'chipshow.eu', 'unishineled.com']),
    target_url: z.url(), page_type: z.string().min(1), reader_task: z.string().min(1).optional(),
  }).strict().optional(),
}).strict();
export type Packet = z.infer<typeof packetShapeSchema>;

export const responseSchema = z.object({
  task_id: safeId, run_id: safeId,
  run_cost: z.null().optional(), readback_receipt: z.null().optional(),
  producer: z.object({ agent_id: z.string().min(1), model: z.string().nullable(), input_files: z.array(z.string()).min(1) }).strict(),
  decisions: z.array(z.object({ article_id: safeId, decision: z.enum(['KEEP', 'SKIP', 'HOLD']), reason_zh: z.string().min(1) }).strict()),
  drafts: z.array(z.object({
    news_status: z.enum(['reported','unconfirmed','confirmed','denied','corrected']).optional(),
    camos_rule_ids: z.array(z.string().min(1)).optional(),
    figures: z.array(figureSpecSchema).max(3).optional().catch(undefined),
    brief: briefMetadataSchema.optional(),
    source: sourceBinding, title_zh: z.string().min(1), review_zh: z.string().min(1), title_en: z.string().min(1), body_en: z.string().min(1),
    evidence: z.array(z.object({ claim: z.string().min(1), quote: z.string().min(1).max(350) }).strict()).min(1),
    questions_zh: z.array(z.string()), keyword_hypothesis: z.string().min(1), meta_description_en: z.string().min(1),
  }).strict()),
}).strict();
export type Response = z.infer<typeof responseSchema>;
