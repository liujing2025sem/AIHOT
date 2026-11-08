import { createHash } from 'node:crypto';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { CATEGORIES } from '@aihot/industry/taxonomy';
import { audit, Conflict } from '../audit.ts';
import { config, credential } from '../config.ts';
import { sql, type Tx } from '../db.ts';
import { lockStudioPublication } from './studio.ts';

const shortCategory = 'industry-news';
const consumerTag = 'consumer-display';
const auditAction = 'studio.draft.wordpress';
const idSchema = z.number().int().positive();
const pushSchema = z.object({
  version: idSchema,
  kind: z.enum(['brief', 'guide']),
  section: z.enum(CATEGORIES.map(({ key }) => key)),
}).strict();
type Push = z.infer<typeof pushSchema>;
type Publication = NonNullable<Awaited<ReturnType<typeof lockStudioPublication>>>;
type Receipt = { site: string; version: number; kind: Push['kind']; section: Push['section'] } & (
  { state: 'pending' | 'not_sent' } |
  { state: 'unknown'; postId?: number; httpStatus?: number } |
  { state: 'blocked'; postId: number } |
  { state: 'pushed'; postId: number; media: 'set' | 'not_configured' | 'not_applied'; metaDescription: string }
);

function invalid(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}
function settings() {
  if (!config.wpDraftPushEnabled) return { ready: false as const, message: 'WordPress 草稿推送尚未开启。' };
  try {
    const base = new URL(credential('integrations', 'WP_BASE_URL') ?? '');
    const user = credential('integrations', 'WP_USER')?.trim();
    const password = credential('integrations', 'WP_APP_PASSWORD')?.trim();
    if (base.protocol === 'https:' && !base.username && !base.password && !base.search && !base.hash && user && !user.includes(':') && password) {
      base.pathname = base.pathname.replace(/\/*$/, '/');
      return { ready: true as const, base, user, password };
    }
  } catch {
    // Configuration errors never echo URLs or credential values.
  }
  return { ready: false as const, message: '请让维护人检查 WordPress 的 HTTPS 站点、用户名和应用密码配置。' };
}
type Settings = Extract<ReturnType<typeof settings>, { ready: true }>;
const slugOf = (id: string) => 'aihot-studio-' + createHash('sha256').update(id).digest('hex').slice(0, 24);
const subjectOf = (id: string) => `studio-draft:${id}`;

async function latest(id: string, db: Tx | typeof sql = sql) {
  const [entry] = await db<{ after: Receipt }[]>`SELECT after FROM audit_log
    WHERE subject=${subjectOf(id)} AND action=${auditAction} ORDER BY id DESC LIMIT 1`;
  return entry?.after;
}
function receiptView(receipt: Receipt, target: Settings, draftId: string) {
  const postId = 'postId' in receipt ? receipt.postId : undefined;
  const editUrl = postId && receipt.site === target.base.href
    ? new URL(`wp-admin/post.php?post=${postId}&action=edit`, target.base).href
    : null;
  const { site: _site, ...result } = receipt;
  return { ...result, editUrl, recoveryKey: !postId && (receipt.state === 'pending' || receipt.state === 'unknown') ? slugOf(draftId) : null };
}
export async function studioWordPressDetail(id: string) {
  const target = settings();
  if (!target.ready) return { ready: false, message: target.message, receipt: null };
  const receipt = await latest(id);
  if (receipt && receipt.state !== 'not_sent' && receipt.site !== target.base.href) {
    return { ready: false, message: '此稿已绑定另一 WordPress 站点，请让维护人核对站点配置。', receipt: null };
  }
  return { ready: true, message: null, receipt: receipt && receipt.state !== 'not_sent' ? receiptView(receipt, target, id) : null };
}

const postFields = 'id,slug,status,categories,tags,featured_media';
const postSchema = z.object({ id: idSchema, slug: z.string(), status: z.string(),
  categories: z.array(idSchema), tags: z.array(idSchema), featured_media: z.number().int().nonnegative() });
const termsSchema = z.array(z.object({ id: idSchema, slug: z.string() }));
class WordPressError extends Error {
  readonly status?: number;
  constructor(status?: number) {
    super(status ? `WordPress 返回 HTTP ${status}，请让维护人检查站点、权限或访问限制。`
      : '无法确认 WordPress 返回的结果，请让维护人检查连接和 REST 设置。');
    this.status = status;
  }
}
function client(target: Settings) {
  const authorization = 'Basic ' + Buffer.from(`${target.user}:${target.password}`).toString('base64');
  const signal = AbortSignal.timeout(15_000);
  return async (path: string, query: Record<string, string>, payload?: object): Promise<unknown> => {
    const url = new URL(`wp-json/wp/v2/${path}`, target.base);
    url.search = new URLSearchParams(query).toString();
    try {
      const res = await fetch(url, {
        method: payload ? 'POST' : 'GET', redirect: 'manual', cache: 'no-store', signal,
        headers: { Authorization: authorization, Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new WordPressError(res.status);
      }
      return await res.json();
    } catch (error) {
      // Do not attach the request, response body, underlying error or credentials to logs or receipts.
      throw error instanceof WordPressError ? error : new WordPressError();
    }
  };
}
type Request = ReturnType<typeof client>;
const mediaKey: Record<Push['section'], string> = {
  'components-ics': 'WP_FEATURED_MEDIA_COMPONENTS_CONTROL',
  'control-software': 'WP_FEATURED_MEDIA_COMPONENTS_CONTROL',
  'displays-projects': 'WP_FEATURED_MEDIA_DISPLAYS_PROJECTS',
  industry: 'WP_FEATURED_MEDIA_MARKET_DOOH',
  'consumer-near-eye': 'WP_FEATURED_MEDIA_CONSUMER',
};
async function resolvePlacement(request: Request, input: Push) {
  const guide = credential('integrations', 'WP_GUIDE_CATEGORY_SLUG')?.trim();
  const slug = input.kind === 'brief' ? shortCategory : guide;
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug === 'company-news' || (input.kind === 'guide' && slug === shortCategory)) {
    invalid('长文和升级稿需配置已确认的 WordPress 指南分类，无法确定时不会使用 Company News。');
  }
  async function term(path: 'categories' | 'tags', slug: string, name: string) {
    const result = termsSchema.safeParse(await request(path, { slug, _fields: 'id,slug' }));
    if (!result.success) throw new WordPressError();
    const matches = result.data.filter(item => item.slug === slug);
    if (matches.length !== 1 || !matches[0]) invalid(`WordPress 未找到唯一的${name}（${slug}），请让维护人确认。`);
    return matches[0].id;
  }
  const mediaSetting = credential('integrations', mediaKey[input.section]);
  const media = mediaSetting ? idSchema.safeParse(Number(mediaSetting)) : null;
  if (media && !media.success) invalid('本分节的 WordPress 特色图编号无效，请让维护人核对媒体库。');
  return {
    category: await term('categories', slug, '分类'),
    tags: input.section === 'consumer-near-eye' ? [await term('tags', consumerTag, '标签')] : [],
    media: media?.data,
  };
}
type Placement = Awaited<ReturnType<typeof resolvePlacement>>;

async function readPost(request: Request, postId: number) {
  try {
    const parsed = postSchema.safeParse(await request(`posts/${postId}`, { context: 'edit', _fields: postFields }));
    if (!parsed.success || parsed.data.id !== postId) throw new WordPressError();
    return parsed.data;
  } catch (error) {
    if (error instanceof WordPressError && (error.status === 404 || error.status === 410)) return null;
    throw error;
  }
}
async function recoverDraft(request: Request, slug: string) {
  const parsed = z.array(postSchema).safeParse(await request('posts', { context: 'edit', status: 'draft', slug, _fields: postFields }));
  if (!parsed.success) throw new WordPressError();
  const matches = parsed.data.filter(post => post.slug === slug);
  return matches.length === 1 && matches[0]?.status === 'draft' ? matches[0].id : undefined;
}

export async function pushStudioWordPressDraft(id: string, raw: unknown, actor: string) {
  const configured = settings();
  if (!configured.ready) invalid(configured.message);
  const target: Settings = configured;
  const input = pushSchema.parse(raw);
  const site = target.base.href;
  const version = input.version;
  const receiptBase = { site, ...input };
  const slug = slugOf(id);
  const save = (tx: Tx, before: Receipt | undefined, after: Receipt) =>
    audit(actor, auditAction, subjectOf(id), null, before, after, { db: tx });

  async function write(tx: Tx, before: Receipt, request: Request, publication: Publication, placement: Placement, postId?: number) {
    const html = sanitizeHtml(marked.parse(publication.body, { async: false }));
    const content = input.kind === 'brief' ? `<div class="cs-brief">${html}</div>` : html;
    let receipt: Receipt = { ...receiptBase, state: 'unknown', postId };
    try {
      const response = await request(postId ? `posts/${postId}` : 'posts', { _fields: postFields }, {
        status: 'draft', title: publication.title, content, ...(postId ? {} : { slug }),
        categories: [placement.category], tags: placement.tags,
        ...(placement.media ? { featured_media: placement.media } : {}),
      });
      const saved = postSchema.safeParse(response);
      if (saved.success && (postId ? postId === saved.data.id : saved.data.slug === slug)) {
        const post = saved.data;
        receipt = { ...receiptBase, state: 'unknown', postId: post.id };
        if (post.status !== 'draft') receipt = { ...receiptBase, state: 'blocked', postId: post.id };
        else if (post.categories.length === 1 && post.categories[0] === placement.category &&
          post.tags.length === placement.tags.length && placement.tags.every(tag => post.tags.includes(tag))) {
          receipt = { ...receiptBase, state: 'pushed', postId: post.id,
            media: !placement.media ? 'not_configured' : post.featured_media === placement.media ? 'set' : 'not_applied',
            metaDescription: publication.meta_description.replace(/\s+/g, ' ').trim() };
        }
      }
    } catch (error) {
      if (!(error instanceof WordPressError)) throw error;
      // Even an HTTP error can arrive after WordPress creates the post (for example when setting terms).
      receipt = { ...receiptBase, state: 'unknown', postId, httpStatus: error.status };
    }
    await save(tx, before, receipt);
    return receiptView(receipt, target, id);
  }

  try {
    const first = await sql.begin(async tx => {
      const publication = await lockStudioPublication(id, version, tx);
      if (!publication) return { kind: 'done' as const, result: null };
      const before = await latest(id, tx);
      const request = client(target);
      if (!before || before.state === 'not_sent') {
        const placement = await resolvePlacement(request, input);
        const reservation: Receipt = { ...receiptBase, state: 'pending' };
        // Commit this before the first POST. A crash or failed DB commit after the POST must not allow another create.
        await save(tx, before, reservation);
        return { kind: 'create' as const, reservation, placement };
      }
      if (before.site !== site) throw new Conflict('此稿已绑定另一 WordPress 站点，请让维护人核对站点配置。');
      const knownId = 'postId' in before ? before.postId : undefined;
      const postId = knownId ?? await recoverDraft(request, slug);
      if (!postId) return { kind: 'done' as const, result: receiptView(before, target, id) };
      const placement = await resolvePlacement(request, input);
      const current = await readPost(request, postId);
      if (!knownId && current?.slug !== slug) return { kind: 'done' as const, result: receiptView(before, target, id) };
      if (current?.status !== 'draft') {
        const blocked: Receipt = { ...receiptBase, state: 'blocked', postId };
        await save(tx, before, blocked);
        return { kind: 'done' as const, result: receiptView(blocked, target, id) };
      }
      return { kind: 'done' as const, result: await write(tx, before, request, publication, placement, postId) };
    });
    if (first.kind === 'done') return first.result;

    const second = await sql.begin(async tx => {
      let publication;
      try { publication = await lockStudioPublication(id, version, tx); }
      catch (error) {
        if (!(error instanceof Conflict) && !(error instanceof Error && 'statusCode' in error && error.statusCode === 400)) throw error;
        // No POST was issued in this phase. A corrected/approved version may safely start again.
        const current = await latest(id, tx);
        if (current?.state === 'pending') await save(tx, current, { ...receiptBase, state: 'not_sent' });
        return { error };
      }
      if (!publication) return { result: null };
      const current = await latest(id, tx);
      if (!current || current.state !== 'pending') return { result: current ? receiptView(current, target, id) : null };
      return { result: await write(tx, first.reservation, client(target), publication, first.placement) };
    });
    if (second.error) throw second.error;
    return second.result;
  } catch (error) {
    if (error instanceof WordPressError) invalid(error.message);
    throw error;
  }
}
