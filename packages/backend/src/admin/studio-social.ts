import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql, type Db } from '../db.ts';
import { audit, Conflict } from '../audit.ts';
import { studioDraft, exportStudioDraft } from './studio.ts';
import { evaluateDraft, type GateReport } from './editorial-gate.ts';
import { buildEditorialIssues, validateEditorialConfirmations, type EditorialConfirmation, type EditorialDraft } from './editorial-issues.ts';
import { publicationStatus } from './studio-publication.ts';
import { assertPublicEnglish } from '../../../../site/editorial.ts';
import { packetSchema, responseSchema, sha256, type Packet } from '../../../../scripts/editorial-pilot-lib.ts';

const fail = (message: string): never => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const draftSchema = responseSchema.shape.drafts.element;
const documentSchema = z.object({
  platform: z.enum(['facebook', 'linkedin']), language: z.enum(['en', 'zh']),
  title: z.string().trim().min(1).max(500), body: z.string().trim().min(1).max(15000),
  blog_url: z.url(), source: draftSchema.shape.source,
  news_status: z.enum(['reported', 'unconfirmed', 'confirmed', 'denied', 'corrected']),
}).strict();
export type StudioSocialDocument = z.infer<typeof documentSchema>;
export type StudioSocialRow = {
  id: string; draft_id: string; parent_version: number; document: StudioSocialDocument;
  status: 'draft' | 'approved'; version: number; confirmations: EditorialConfirmation[];
  created_by: string; updated_by: string; reviewed_by: string | null; reviewed_at: Date | null;
  created_at: Date; updated_at: Date;
};
type SocialBinding = Pick<StudioSocialRow, 'id' | 'draft_id' | 'parent_version' | 'created_at'>;
const deriveSchema = z.object({ draft_id: z.string().min(1), platform: documentSchema.shape.platform,
  language: documentSchema.shape.language, blog_url: z.url() }).strict();
const editSchema = z.object({ version: z.number().int().positive(), title: documentSchema.shape.title,
  body: documentSchema.shape.body, blog_url: z.url() }).strict();
const reviewSchema = z.object({ version: z.number().int().positive(), action: z.enum(['approve', 'return']),
  note: z.string().max(3000).default(''),
  confirmations: z.array(z.object({ issueId: z.string(), fingerprint: z.string() }).strict()).default([]),
}).strict();

/** Operator-supplied publication URL only. This checks scope, not whether the URL is live. */
export function validateSocialBlogUrl(value: string, site = 'chipshow.com') {
  let url: URL;
  try { url = new URL(value); } catch { return fail('请提供实际发布的 Blog URL。'); }
  const allowed = ['chipshow.com', 'chipshowledusa.com', 'chipshow.eu'];
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!allowed.includes(site) || host !== site || url.protocol !== 'https:' || url.username || url.password || url.port
    || !url.pathname.replaceAll('/', '').trim()) fail('Blog URL 须为对应 Chipshow 站点的实际非根路径，不可编造未发布地址。');
  return value;
}

function checkDocument(document: StudioSocialDocument, packet: Packet) {
  validateSocialBlogUrl(document.blog_url, packet.writing?.site ?? 'chipshow.com');
  if (document.language === 'en') assertPublicEnglish({ title_en: document.title, body_en: document.body, meta_description_en: '' });
}

/** Deterministic first complete paragraph; stored Blog-only metadata is not post content. */
export function deriveStudioSocialDocument(parent: unknown, input: Pick<StudioSocialDocument, 'platform' | 'language' | 'blog_url'>) {
  const draft = draftSchema.strip().parse(parent);
  const original = input.language === 'en' ? draft.body_en : draft.review_zh;
  const paragraph = original.split(/\r?\n\s*\r?\n/).find(part => part.trim() && !/^#{1,6}\s/.test(part.trim()));
  return documentSchema.parse({ ...input, title: input.language === 'en' ? draft.title_en : draft.title_zh,
    body: paragraph ?? original, source: draft.source, news_status: publicationStatus(draft) });
}

/** Review only this post. Never import unused Blog prose or enforce bilingual W7. */
export function evaluateStudioSocial(packet: Packet, document: StudioSocialDocument, binding: SocialBinding, publishedTexts: string[] = []) {
  const reviewPacket = { ...packet, created_at: new Date(binding.created_at).toISOString() };
  const zh = document.language === 'zh';
  // body_en supplies the evaluator's document-level anchors for either language;
  // Chinese-specific checks use title_zh/review_zh. Only one occurrence survives.
  const draft = { source: document.source, news_status: document.news_status,
    title_en: zh ? '' : document.title, body_en: document.body, meta_description_en: '',
    title_zh: zh ? document.title : '', review_zh: zh ? document.body : '',
    keyword_hypothesis: '', evidence: [], questions_zh: [],
    title: document.title, body: document.body,
    social_binding: { id: binding.id, draft_id: binding.draft_id, parent_version: binding.parent_version,
      platform: document.platform, language: document.language, blog_url: document.blog_url },
  } satisfies EditorialDraft & { title: string; body: string; social_binding: object };
  const raw = evaluateDraft(reviewPacket, draft, { publishedTexts });
  const findings = raw.findings.filter(finding => {
    if (finding.ruleId === 'W7' || finding.field === 'source.body_text') return false;
    if (zh) return ['title_zh', 'review_zh'].includes(finding.field)
      || (finding.field === 'body_en' && ['W1', 'W2', 'W5'].includes(finding.ruleId));
    return ['title_en', 'body_en'].includes(finding.field);
  }).map(finding => ({ ...finding, field: finding.field.startsWith('title_') ? 'title' : 'body' }));
  for (const finding of raw.findings.filter(finding => finding.field === 'source.body_text' && finding.ruleId === 'W3')) {
    for (const field of ['title', 'body'] as const) {
      let start = document[field].indexOf(finding.quote);
      while (start >= 0) {
        findings.push({ ...finding, field, start, end: start + finding.quote.length });
        start = document[field].indexOf(finding.quote, start + finding.quote.length);
      }
    }
  }
  const gate: GateReport = { version: `${raw.version}/social-1`, findings,
    blocked: findings.some(finding => finding.severity === 'BLOCK'),
    mandatoryReview: [...new Set(findings.filter(finding => finding.severity === 'WARN').map(finding => finding.ruleId))] };
  return { gate, issues: buildEditorialIssues(reviewPacket, draft, gate) };
}

export function studioSocialContent(document: StudioSocialDocument) {
  const zh = document.language === 'zh';
  const status = {
    reported: zh ? '原厂报道' : 'Source report', unconfirmed: zh ? '尚未证实的报道' : 'Unconfirmed report',
    confirmed: zh ? '确认消息' : 'Confirmation', denied: zh ? '否认／更新' : 'Denial / update', corrected: zh ? '更正' : 'Correction',
  }[document.news_status];
  const footer = zh
    ? `阅读全文：${document.blog_url}\n原厂来源：${document.source.url}\n原日期：${document.source.published_at ?? '未知'}\n消息状态：${status}`
    : `Read the Blog: ${document.blog_url}\nOriginal source: ${document.source.url}\nOriginal source date: ${document.source.published_at ?? 'not provided'}\nNews status: ${status}`;
  const text = `${document.title}\n\n${document.body}\n\n${footer}`;
  const wordCount = [...new Intl.Segmenter(document.language, { granularity: 'word' }).segment(text)].filter(word => word.isWordLike).length;
  return { text, counts: { wordCount, characterCount: [...text].length,
    basis: 'Complete post including title and fixed links/date/status; Intl word segments and Unicode code points, not model tokens.' } };
}

async function history(id: string, language: string, db: Db) {
  const rows = await db<{ body: string }[]>`SELECT document->>'body' AS body FROM studio_social_drafts
    WHERE status = 'approved' AND id <> ${id} AND document->>'language' = ${language}`;
  return rows.map(row => row.body);
}

async function boundContext(row: StudioSocialRow, db: Db) {
  const [parent] = await db`SELECT d.version, d.status, d.document, t.request, a.revision, a.title, a.body_status, a.body_text, a.url
    FROM studio_drafts d JOIN studio_tasks t ON t.id = d.task_id LEFT JOIN articles a ON a.id = d.article_id WHERE d.id = ${row.draft_id}`;
  if (!parent) return fail('父 Blog 稿已不存在。');
  const packet = packetSchema.parse(parent.request);
  const source = row.document.source;
  const stale = parent.version !== row.parent_version || parent.status !== 'approved' || parent.revision !== source.revision
    || parent.url !== source.url || sha256(JSON.stringify([parent.title, parent.body_status, parent.body_text])) !== source.content_sha256;
  return { packet, stale };
}

async function present(row: StudioSocialRow, db: Db) {
  const { packet, stale } = await boundContext(row, db);
  return { ...row, ...evaluateStudioSocial(packet, row.document, row, await history(row.id, row.document.language, db)),
    stale, counts: studioSocialContent(row.document).counts };
}

/** Existing transaction locks prevent a parent/source edit between validation and commit. */
async function approvedParent(id: string, db: Db, expectedVersion?: number) {
  const [locked] = await db`SELECT id, article_id, task_id FROM studio_drafts WHERE id = ${id} FOR SHARE`;
  if (!locked) return fail('父 Blog 稿不存在。');
  await db`SELECT id FROM articles WHERE id = ${locked.article_id} FOR SHARE`;
  const parent = await studioDraft(id);
  if (!parent || parent.status !== 'approved') return fail('请先完成父 Blog 稿的独立审核。');
  if (expectedVersion !== undefined && parent.version !== expectedVersion) throw new Conflict('父 Blog 版本已变化，请从重新批准的 Blog 派生新社媒稿。');
  await exportStudioDraft(id, 'json');
  const [task] = await db`SELECT request FROM studio_tasks WHERE id = ${locked.task_id}`;
  return { parent, packet: packetSchema.parse(task.request) };
}

export async function listStudioSocial(draftId?: string) {
  const rows = await sql<StudioSocialRow[]>`SELECT * FROM studio_social_drafts
    WHERE (${draftId ?? null}::text IS NULL OR draft_id = ${draftId ?? null}) ORDER BY created_at DESC, id`;
  const result = [];
  for (const row of rows) result.push(await present(row, sql));
  return result;
}

export async function deriveStudioSocial(input: unknown, actor: string) {
  const body = deriveSchema.parse(input);
  return sql.begin(async tx => {
    const { parent, packet } = await approvedParent(body.draft_id, tx);
    const document = deriveStudioSocialDocument(parent.document, { platform: body.platform, language: body.language, blog_url: body.blog_url });
    checkDocument(document, packet);
    const id = `studio-social-${randomUUID()}`;
    const [row] = await tx<StudioSocialRow[]>`INSERT INTO studio_social_drafts (id, draft_id, parent_version, document, created_by, updated_by)
      VALUES (${id}, ${parent.id}, ${parent.version}, ${tx.json(document)}, ${actor}, ${actor}) RETURNING *`;
    await audit(actor, 'studio.social.derive', `studio-social:${id}`, null, null,
      { draft_id: parent.id, parent_version: parent.version, platform: document.platform, language: document.language }, { db: tx });
    return present(row, tx);
  });
}

export async function saveStudioSocial(id: string, input: unknown, actor: string) {
  const body = editSchema.parse(input);
  return sql.begin(async tx => {
    const [row] = await tx<StudioSocialRow[]>`SELECT * FROM studio_social_drafts WHERE id = ${id} FOR UPDATE`;
    if (!row) return null;
    if (row.version !== body.version) throw new Conflict('社媒稿已修改，请刷新后再保存。');
    const { packet } = await approvedParent(row.draft_id, tx, row.parent_version);
    const { version: _, ...fields } = body;
    const document = documentSchema.parse({ ...row.document, ...fields });
    checkDocument(document, packet);
    const [saved] = await tx<StudioSocialRow[]>`UPDATE studio_social_drafts SET document = ${tx.json(document)}, status = 'draft',
      version = version + 1, confirmations = '[]'::jsonb, updated_by = ${actor}, updated_at = now(), reviewed_by = NULL, reviewed_at = NULL
      WHERE id = ${id} RETURNING *`;
    await audit(actor, 'studio.social.save', `studio-social:${id}`, null,
      { version: row.version, status: row.status }, { version: saved.version, status: saved.status }, { db: tx });
    return present(saved, tx);
  });
}

export async function reviewStudioSocial(id: string, input: unknown, actor: string) {
  const body = reviewSchema.parse(input);
  return sql.begin(async tx => {
    const [row] = await tx<StudioSocialRow[]>`SELECT * FROM studio_social_drafts WHERE id = ${id} FOR UPDATE`;
    if (!row) return null;
    if (row.version !== body.version) throw new Conflict('社媒稿版本已变化，请刷新后重新审核。');
    if (body.action === 'return' && !body.note.trim()) fail('请填写退回意见。');
    let confirmations: EditorialConfirmation[] = [];
    if (body.action === 'approve') {
      const { packet } = await approvedParent(row.draft_id, tx, row.parent_version);
      checkDocument(row.document, packet);
      const { issues } = await present(row, tx);
      const checked = validateEditorialConfirmations(issues, { confirmations: body.confirmations });
      if (!checked.canApprove) throw Object.assign(new Error('社媒否决项须修改，WARN 须按当前帖文逐项确认后再批准。'), { statusCode: 400, approval: checked });
      confirmations = checked.confirmed;
    }
    const status = body.action === 'approve' ? 'approved' : 'draft';
    const [saved] = await tx<StudioSocialRow[]>`UPDATE studio_social_drafts SET status = ${status}, version = version + 1,
      confirmations = ${tx.json(confirmations)}, updated_by = ${actor}, updated_at = now(),
      reviewed_by = ${status === 'approved' ? actor : null}, reviewed_at = ${status === 'approved' ? new Date() : null}
      WHERE id = ${id} RETURNING *`;
    await audit(actor, `studio.social.${body.action}`, `studio-social:${id}`, body.note || null,
      { version: row.version, status: row.status }, { version: saved.version, status, confirmations }, { db: tx });
    return present(saved, tx);
  });
}

export async function exportStudioSocial(id: string, format = 'md') {
  if (!['md', 'json'].includes(format)) fail('社媒导出仅支持 md 或 json。');
  return sql.begin(async tx => {
    const [row] = await tx<StudioSocialRow[]>`SELECT * FROM studio_social_drafts WHERE id = ${id} FOR SHARE`;
    if (!row) return null;
    if (row.status !== 'approved') fail('请先独立审核通过这条社媒稿。');
    const { packet } = await approvedParent(row.draft_id, tx, row.parent_version);
    checkDocument(row.document, packet);
    const { issues } = await present(row, tx);
    if (!validateEditorialConfirmations(issues, { confirmations: row.confirmations }).canApprove) fail('社媒提示或确认已变化，请重新逐项审核。');
    const { text, counts } = studioSocialContent(row.document);
    const publication = { platform: row.document.platform, language: row.document.language, ...counts,
      blog_url: row.document.blog_url, source: row.document.source, news_status: row.document.news_status, text,
      publication: 'NOT_PERFORMED' };
    return format === 'json'
      ? { type: 'application/json', extension: 'json', body: JSON.stringify({ id, version: row.version, publication }, null, 2) }
      : { type: 'text/markdown; charset=utf-8', extension: 'md', body: `Platform: ${publication.platform}\nLanguage: ${publication.language}\nWords: ${counts.wordCount}\nCharacters: ${counts.characterCount}\n\n${text}\n` };
  });
}
