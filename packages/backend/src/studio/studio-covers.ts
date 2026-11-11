import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp, { type OutputInfo } from 'sharp';
import { z } from 'zod';
import { sql, type Db } from '../db.ts';
import { config } from '../config.ts';
import { audit, Conflict } from '../audit.ts';
import { lockStudioPublication } from './studio.ts';

type Cover = { hash: string; contentHash: string; fileName: string; alt_en: string; caption_en: string; width: number; height: number };
type CoverState = { revision: number; selectedHash: string | null; candidates: Cover[];
  confirmation: { version: number; fingerprint: string; at: string } | null };
const invalid = (message: string): never => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const keyOf = (id: string) => `studio.cover:${id}`;
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const versionSchema = z.object({ version: z.number().int().positive(), revision: z.number().int().nonnegative() });
const uploadSchema = versionSchema.extend({ fileName: z.string().trim().min(1).max(180), dataUrl: z.string().max(5_700_000),
  alt_en: z.string().trim().min(1, '请填写英文 ALT，描述图片中实际能看到的内容。').max(500), caption_en: z.string().trim().max(1000).default('') });
const selectionSchema = versionSchema.extend({ hash: z.string().regex(/^[a-f0-9]{64}$/).nullable() });
const empty = (): CoverState => ({ revision: 0, selectedHash: null, candidates: [], confirmation: null });

export async function storedStudioCovers(id: string, db: Db = sql): Promise<CoverState> {
  const [row] = await db<{ value: CoverState }[]>`SELECT value FROM settings WHERE key=${keyOf(id)}`;
  return row?.value ?? empty();
}
export function selectedStudioCover(state: CoverState) {
  return state.candidates.find(candidate => candidate.hash === state.selectedHash) ?? null;
}
const fingerprint = (state: CoverState) => {
  const cover = selectedStudioCover(state);
  return hash(JSON.stringify(cover ? [cover.hash, cover.alt_en, cover.caption_en] : null));
};
export const studioDeliveryConfirmed = (state: CoverState, version: number) =>
  state.confirmation?.version === version && state.confirmation.fingerprint === fingerprint(state);

function view(id: string, state: CoverState, version: number, status: string) {
  return { revision: state.revision, selectedHash: state.selectedHash,
    candidates: state.candidates.map(cover => ({ ...cover, src: `/api/admin/studio/drafts/${encodeURIComponent(id)}/covers/${cover.hash}` })),
    confirmed: status === 'approved' && studioDeliveryConfirmed(state, version),
    confirmedVersion: state.confirmation?.version ?? null };
}
export async function studioCovers(id: string) {
  return sql.begin(async tx => {
    const [draft] = await tx`SELECT version,status FROM studio_drafts WHERE id=${id} FOR SHARE`;
    return draft ? view(id, await storedStudioCovers(id, tx), draft.version, draft.status) : null;
  });
}
async function current(id: string, input: z.infer<typeof versionSchema>, tx: Db) {
  const [draft] = await tx`SELECT version,status FROM studio_drafts WHERE id=${id} FOR UPDATE`;
  if (!draft) return null;
  const state = await storedStudioCovers(id, tx);
  if (draft.version !== input.version || state.revision !== input.revision) {
    throw new Conflict('稿件或封面已变化，请刷新后再操作。');
  }
  return { draft, state };
}
async function save(id: string, before: CoverState, next: CoverState, actor: string, action: string, tx: Db) {
  next.revision = before.revision + 1;
  await tx`INSERT INTO settings(key,value,updated_by) VALUES(${keyOf(id)},${tx.json(next as never)},${actor})
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`;
  await audit(actor, action, `studio-draft:${id}`, null,
    { revision: before.revision, selectedHash: before.selectedHash },
    { revision: next.revision, selectedHash: next.selectedHash, candidates: next.candidates.map(c => c.hash), confirmation: next.confirmation }, { db: tx });
}
function assetPath(digest: string) {
  if (!/^[a-f0-9]{64}$/.test(digest)) return invalid('封面编号无效。');
  return path.join(config.dataDir, 'studio-covers', digest + '.png');
}
export async function readStudioCover(digest: string) {
  const data = await readFile(assetPath(digest)).catch(() => null);
  if (!data || hash(data) !== digest) throw new Conflict('封面文件缺失或内容已变化，请重新上传并确认成品。');
  return data;
}
export async function studioCoverAsset(id: string, digest: string) {
  const [draft] = await sql`SELECT id FROM studio_drafts WHERE id=${id}`;
  if (!draft) return null;
  const state = await storedStudioCovers(id);
  const candidate=state.candidates.find(candidate => candidate.hash === digest);
  return candidate ? readStudioCover(candidate.contentHash) : null;
}
export async function uploadStudioCover(id: string, input: unknown, actor: string) {
  const b = uploadSchema.parse(input);
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(b.dataUrl);
  if (!match) return invalid('请上传 PNG、JPG 或 WebP 图片。');
  if (/[\u3400-\u9fff]/.test(b.alt_en + b.caption_en)) return invalid('公开封面的 ALT 与图注请使用英文。');
  const raw = Buffer.from(match[1], 'base64');
  if (!raw.length || raw.length > 4 * 1024 * 1024) return invalid('封面图片最大 4 MB。');
  let normalized: { data: Buffer; info: OutputInfo };
  try {
    const meta = await sharp(raw, { limitInputPixels: 20_000_000 }).metadata();
    if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1) return invalid('请上传静态 PNG、JPG 或 WebP 图片。');
    normalized = await sharp(raw, { limitInputPixels: 20_000_000 }).rotate()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  } catch { return invalid('图片无法读取或尺寸过大，请换一张不超过 2000 万像素的静态图片。'); }
  const digest = hash(normalized.data);
  return sql.begin(async tx => {
    const loaded = await current(id, b, tx);
    if (!loaded) return null;
    const { draft, state } = loaded;
    const candidateId=hash(JSON.stringify([digest,b.alt_en,b.caption_en]));
    const cover: Cover = { hash: candidateId, contentHash: digest, fileName: path.basename(b.fileName.replaceAll('\\', '/')),
      alt_en: b.alt_en, caption_en: b.caption_en, width: normalized.info.width, height: normalized.info.height };
    const previous = state.candidates.find(c => c.hash === candidateId);
    if (!previous && state.candidates.length >= 8) return invalid('最多保留 8 张封面候选，请先移除不用的候选。');
    await mkdir(path.dirname(assetPath(digest)), { recursive: true });
    const temporary = assetPath(digest) + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, normalized.data, { flag: 'wx' });
      await rename(temporary, assetPath(digest));
    } finally { await rm(temporary, { force: true }); }
    if (previous) return view(id, state, draft.version, draft.status);
    const next: CoverState = { ...state, candidates: [...state.candidates, cover] };
    await save(id, state, next, actor, 'studio.cover.upload', tx);
    return view(id, next, draft.version, draft.status);
  });
}
export async function selectStudioCover(id: string, input: unknown, actor: string) {
  const b = selectionSchema.parse(input);
  return sql.begin(async tx => {
    const loaded = await current(id, b, tx);
    if (!loaded) return null;
    const { draft, state } = loaded;
    if (b.hash && !state.candidates.some(c => c.hash === b.hash)) return invalid('这张封面不属于当前稿件，请刷新候选列表。');
    if (b.hash) await readStudioCover(state.candidates.find(c=>c.hash===b.hash)!.contentHash);
    if (state.selectedHash === b.hash) return view(id, state, draft.version, draft.status);
    const next = { ...state, selectedHash: b.hash, confirmation: null };
    await save(id, state, next, actor, 'studio.cover.select', tx);
    return view(id, next, draft.version, draft.status);
  });
}
export async function removeStudioCover(id: string, digest: string, input: unknown, actor: string) {
  const b = versionSchema.parse(input);
  return sql.begin(async tx => {
    const loaded = await current(id, b, tx);
    if (!loaded) return null;
    const { draft, state } = loaded;
    if (state.selectedHash === digest) return invalid('请先选择其他封面或选择无封面，再移除此候选。');
    if (!state.candidates.some(c => c.hash === digest)) return view(id, state, draft.version, draft.status);
    const next = { ...state, candidates: state.candidates.filter(c => c.hash !== digest) };
    await save(id, state, next, actor, 'studio.cover.remove', tx);
    return view(id, next, draft.version, draft.status);
  });
}
export async function confirmStudioDelivery(id: string, input: unknown, actor: string) {
  const b = versionSchema.parse(input);
  return sql.begin(async tx => {
    const publication = await lockStudioPublication(id, b.version, tx);
    if (!publication) return null;
    const state = await storedStudioCovers(id, tx);
    if (state.revision !== b.revision) throw new Conflict('封面已变化，请刷新并核对成品。');
    const selected=selectedStudioCover(state);
    if (selected) await readStudioCover(selected.contentHash);
    if (studioDeliveryConfirmed(state, b.version)) return view(id, state, b.version, 'approved');
    const next: CoverState = { ...state, confirmation: { version: b.version, fingerprint: fingerprint(state), at: new Date().toISOString() } };
    await save(id, state, next, actor, 'studio.delivery.confirm', tx);
    return view(id, next, b.version, 'approved');
  });
}
