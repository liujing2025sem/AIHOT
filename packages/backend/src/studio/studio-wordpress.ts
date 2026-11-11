import { createHash } from 'node:crypto';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { CATEGORIES } from '@aihot/industry/taxonomy';
import { audit, Conflict } from '../audit.ts';
import { config, credential } from '../config.ts';
import { sql, type Tx } from '../db.ts';
import { lockStudioPublication } from './studio.ts';
import { publicStudioTitle, studioUpgradeContext } from './studio-upgrade.ts';
import { wpFigures, wpUpdateTarget, type PublishedFigure } from './studio-publishing-wordpress.ts';
import type { PublicationIssue } from './studio-publishing-content.ts';

const shortCategory = 'industry-news';
const consumerTag = 'consumer-display';
const auditAction = 'studio.draft.wordpress';
const idSchema = z.number().int().positive();
const pushSchema = z.object({
  version: idSchema,
  kind: z.enum(['brief', 'guide']),
  section: z.enum(CATEGORIES.map(({ key }) => key)),
  recoverOnly: z.boolean().optional(),
}).strict();
type Push = z.infer<typeof pushSchema>;
type Publication = NonNullable<Awaited<ReturnType<typeof lockStudioPublication>>>;
class DraftPreflightFailure extends Error {
  readonly error: unknown;
  constructor(error: unknown) { super('WordPress draft preflight failed before any mutation'); this.error = error; }
}
type Receipt = { site: string; version: number; kind: Push['kind']; section: Push['section'];
  expected?: { title: string; content_sha256: string; categories: number[]; tags: number[]; featured_media?: number; metaDescription: string };
  delivery?: 'shadow_draft'; target_post_id?: number; target_existing_url?: string; baseline_sha256?: string | null;
  changes?: NonNullable<ReturnType<typeof studioUpgradeContext>>['changes']; notice?: string;
  figures?: PublishedFigure[]; issues?: PublicationIssue[];
} & (
  { state: 'pending' | 'not_sent' } |
  { state: 'unknown'; postId?: number; httpStatus?: number } |
  { state: 'mismatch'; postId: number; reason: 'content_mismatch' | 'snapshot_unavailable' } |
  { state: 'blocked'; postId: number } |
  { state: 'pushed'; postId: number; media: 'set' | 'not_configured' | 'not_applied'; metaDescription: string }
);

function invalid(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}
export function wordpressSettings(requireDraftValve = true) {
  if (requireDraftValve && !config.wpDraftPushEnabled) return { ready: false as const, message: 'WordPress 草稿推送尚未开启。' };
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
type Settings = Extract<ReturnType<typeof wordpressSettings>, { ready: true }>;
export const studioWordPressSlug = (id: string) => 'aihot-studio-' + createHash('sha256').update(id).digest('hex').slice(0, 24);
const slugOf = studioWordPressSlug;
const settings = wordpressSettings;
const subjectOf = (id: string) => `studio-draft:${id}`;

export async function studioWordPressReceipt(id: string, db: Tx | typeof sql = sql) {
  const [entry] = await db<{ after: Receipt }[]>`SELECT after FROM audit_log
    WHERE subject=${subjectOf(id)} AND action=${auditAction} ORDER BY id DESC LIMIT 1`;
  return entry?.after;
}
const latest = studioWordPressReceipt;
function receiptView(receipt: Receipt, target: Settings, draftId: string) {
  const postId = 'postId' in receipt ? receipt.postId : undefined;
  const editUrl = postId && receipt.site === target.base.href
    ? new URL(`wp-admin/post.php?post=${postId}&action=edit`, target.base).href
    : null;
  const { site: _site, ...result } = receipt;
  return { ...result, editUrl, recoveryKey: !postId && (receipt.state === 'pending' || receipt.state === 'unknown') ? slugOf(draftId) : null };
}
export async function studioWordPressDetail(id: string) {
  const target = settings(false);
  const [draft] = await sql<{ version: number }[]>`SELECT version FROM studio_drafts WHERE id=${id}`;
  const [approval] = await sql<{ after: { version?: number } }[]>`SELECT after FROM audit_log WHERE subject=${`studio-draft:${id}`}
    AND action='studio.draft.approve' ORDER BY id DESC LIMIT 1`;
  const [synced] = await sql<{ after: Receipt }[]>`SELECT after FROM audit_log WHERE subject=${subjectOf(id)}
    AND action=${auditAction} AND after->>'state'='pushed' AND after ? 'expected' ORDER BY id DESC LIMIT 1`;
  const versions = { currentVersion: draft?.version ?? null, approvedVersion: approval?.after.version ?? null,
    syncedVersion: target.ready && synced?.after.site === target.base.href ? synced.after.version : null };
  const state = { ...versions, currentSynced: versions.currentVersion !== null && versions.currentVersion === versions.syncedVersion };
  if (!target.ready) return { ...state, ready: false, recoveryReady: false, message: target.message, receipt: null };
  const receipt = await latest(id);
  if (receipt && receipt.state !== 'not_sent' && receipt.site !== target.base.href) {
    return { ...state, currentSynced: false, ready: false, recoveryReady: false, message: '此稿已绑定另一 WordPress 站点，请让维护人核对站点配置。', receipt: null };
  }
  return { ...state, currentSynced: state.currentSynced && receipt?.state === 'pushed' && receipt.version === versions.currentVersion,
    ready: config.wpDraftPushEnabled, recoveryReady: !!receipt && (['pending', 'unknown'].includes(receipt.state) || receipt.state === 'pushed' && !receipt.expected),
    message: config.wpDraftPushEnabled ? null : 'WordPress 草稿推送尚未开启。',
    receipt: receipt && receipt.state !== 'not_sent' ? receiptView(receipt, target, id) : null };
}

const postFields = 'id,slug,status,title,content,categories,tags,featured_media';
const postSchema = z.object({ id: idSchema, slug: z.string(), status: z.string(),
  title: z.object({ raw: z.string() }), content: z.object({ raw: z.string() }),
  categories: z.array(idSchema), tags: z.array(idSchema), featured_media: z.number().int().nonnegative() });
const postIdentity = postSchema.pick({ id: true, slug: true });
const contentHash = (value: string) => createHash('sha256').update(value.replace(/\r\n?/g, '\n').trim()).digest('hex');
function matchesExpected(post: z.infer<typeof postSchema>, expected: NonNullable<Receipt['expected']>) {
  return post.title.raw === expected.title && contentHash(post.content.raw) === expected.content_sha256 &&
    post.categories.length === expected.categories.length && expected.categories.every(id => post.categories.includes(id)) &&
    post.tags.length === expected.tags.length && expected.tags.every(id => post.tags.includes(id)) &&
    (expected.featured_media === undefined || post.featured_media === expected.featured_media);
}
const termsSchema = z.array(z.object({ id: idSchema, slug: z.string() }));
export class WordPressError extends Error {
  readonly status?: number;
  constructor(status?: number) {
    super(status ? `WordPress 返回 HTTP ${status}，请让维护人检查站点、权限或访问限制。`
      : '无法确认 WordPress 返回的结果，请让维护人检查连接和 REST 设置。');
    this.status = status;
  }
}
export function wordpressClient(target: Settings, options?: { perRequestTimeout: true }) {
  const authorization = 'Basic ' + Buffer.from(`${target.user}:${target.password}`).toString('base64');
  const signal = AbortSignal.timeout(15_000);
  return async (path: string, query: Record<string, string>, payload?: object, method?: 'OPTIONS'): Promise<unknown> => {
    const url = new URL(`wp-json/wp/v2/${path}`, target.base);
    url.search = new URLSearchParams(query).toString();
    // Chipshow's CDN cached authenticated GETs and ignored query parameters (real post 9597).
    // WordPress's documented POST method override keeps reads uncached with the same permissions.
    const freshRead = !payload && !method;
    try {
      const res = await fetch(url, {
        method: method ?? 'POST', redirect: 'manual', cache: 'no-store',
        signal: options ? AbortSignal.timeout(15_000) : signal,
        headers: { Authorization: authorization, Accept: 'application/json', ...(freshRead ? { 'X-HTTP-Method-Override': 'GET', 'Cache-Control': 'no-cache, no-store' } : {}), ...(payload && !(payload instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
        body: payload instanceof FormData ? payload : payload ? JSON.stringify(payload) : undefined,
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
const client = wordpressClient;
type Request = ReturnType<typeof client>;
const mediaKey: Record<Push['section'], string> = {
  'components-ics': 'WP_FEATURED_MEDIA_COMPONENTS_CONTROL',
  'control-software': 'WP_FEATURED_MEDIA_COMPONENTS_CONTROL',
  'displays-projects': 'WP_FEATURED_MEDIA_DISPLAYS_PROJECTS',
  industry: 'WP_FEATURED_MEDIA_MARKET_DOOH',
  'consumer-near-eye': 'WP_FEATURED_MEDIA_CONSUMER',
};
export async function resolveWordPressPlacement(request: Request, input: Pick<Push, 'kind' | 'section'>, useSharedMedia = true) {
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
  const mediaSetting = useSharedMedia ? credential('integrations', mediaKey[input.section]) : undefined;
  const media = mediaSetting ? idSchema.safeParse(Number(mediaSetting)) : null;
  if (media && !media.success) invalid('本分节的 WordPress 特色图编号无效，请让维护人核对媒体库。');
  return {
    category: await term('categories', slug, '分类'),
    tags: input.section === 'consumer-near-eye' ? [await term('tags', consumerTag, '标签')] : [],
    media: media?.data,
  };
}
const resolvePlacement = resolveWordPressPlacement;
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
  const parsed = z.array(postSchema).safeParse(await request('posts', { context: 'edit', status: 'any', slug, _fields: postFields }));
  if (!parsed.success) throw new WordPressError();
  const matches = parsed.data.filter(post => post.slug === slug);
  return matches.length === 1 ? matches[0]?.id : undefined;
}

/** One safe HTML projection for reviewed export and WP. No theme-wide CSS, scripts or event handlers. */
export function sanitizeReviewedHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: [...new Set([...sanitizeHtml.defaults.allowedTags, 'section', 'aside', 'article', 'figure', 'figcaption', 'img'])],
    allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, '*': ['id'],
      a: ['href', 'title', 'name', 'rel', 'target'],
      section: ['class', 'id'], div: ['class', 'id'], article: ['class', 'id'], aside: ['class', 'id'], p: ['class', 'id'],
      figure: ['class'], img: ['src', 'alt', 'width', 'height', 'loading'], th: ['scope', 'colspan'], td: ['colspan'] },
    allowedClasses: { section: ['cs-brief', 'cs-brief-*'], div: ['cs-brief', 'cs-brief-*'],
      article: ['cs-brief-*'], aside: ['cs-brief-*'], p: ['cs-brief-*'], figure: ['cs-figure'] },
    allowedSchemes: ['https', 'http'],
  });
}

export async function pushStudioWordPressDraft(id: string, raw: unknown, actor: string) {
  const { recoverOnly, ...input } = pushSchema.parse(raw);
  const configured = settings(!recoverOnly);
  if (!configured.ready) invalid(configured.message);
  const target: Settings = configured;
  const site = target.base.href;
  const version = input.version;
  const receiptBase = { site, ...input };
  const slug = slugOf(id);
  const save = (tx: Tx, before: Receipt | undefined, after: Receipt) =>
    audit(actor, auditAction, subjectOf(id), null, before, after, { db: tx });
  async function unconfirmed(tx: Tx, before: Receipt, error?: WordPressError) {
    const receipt: Receipt = { ...before, state: 'unknown', postId: 'postId' in before ? before.postId : undefined,
      ...(error?.status !== undefined ? { httpStatus: error.status } : {}) };
    await save(tx, before, receipt);
    return receiptView(receipt, target, id);
  }

  async function preflight(request: Request, publication: Publication, postId?: number) {
    const upgrade = studioUpgradeContext(publication.packet);
    if ((upgrade && input.kind !== 'guide') || (publication.packet.brief && input.kind !== 'brief')) {
      throw new Conflict('交付类型由采编任务锁定，请刷新后再推送。');
    }
    const existing = upgrade && await wpUpdateTarget(request, target.base, upgrade.target_existing_url);
    if (upgrade && (!existing || existing.status !== 'publish' || existing.id === postId)) {
      throw new Conflict('影子稿须独立于原已发布页面；原页绑定或状态无法确认时不会写入。');
    }
    const base = { ...receiptBase, ...(upgrade && existing ? { ...upgrade, target_post_id: existing.id } : {}) };
    const html = sanitizeReviewedHtml(marked.parse(publication.body, { async: false }));
    const content = input.kind === 'brief' && !/<(?:section|div)\b[^>]*class=["'][^"']*\bcs-brief\b/i.test(html)
      ? `<section class="cs-brief">${html}</section>` : html;
    return { base, content };
  }
  async function write(tx: Tx, before: Receipt, request: Request, publication: Publication, placement: Placement, postId?: number) {
    let ready: Awaited<ReturnType<typeof preflight>>;
    try { ready = await preflight(request, publication, postId); }
    catch (error) { throw new DraftPreflightFailure(error); }
    const { base, content } = ready;
    let receipt: Receipt = { ...base, state: 'unknown', postId };
    try {
      // Only requested/approved figure specs enter the human path. No inferred technical picture at push time.
      const media = publication.draft.figures?.length || publication.packet.brief
        ? await wpFigures(request, { kind: input.kind, specs: publication.draft.figures ?? [],
          packet: publication.packet, draft: publication.draft, title: publicStudioTitle(publication.title),
          content, slug, parent: postId ?? 0, publishedHashes: [], allowFallback: false })
        : { content, featured: undefined, issues: [], figures: [] };
      const featured = media.featured ?? placement.media;
      const expected = { title: publicStudioTitle(publication.title), content_sha256: contentHash(media.content),
        categories: [placement.category], tags: placement.tags, featured_media: featured,
        metaDescription: publication.meta_description.replace(/\s+/g, ' ').trim() };
      Object.assign(base, { figures: media.figures, issues: media.issues, expected });
      receipt = { ...base, expected, state: 'unknown', postId };
      // Commit the exact outgoing identity before the POST, independently of the draft lock transaction.
      // If the process/DB acknowledgement is lost after WordPress commits, recovery can still prove this version.
      await audit(actor, auditAction, subjectOf(id), null, before, receipt);
      const response = await request(postId ? `posts/${postId}` : 'posts', { _fields: postFields }, {
        status: 'draft', title: publicStudioTitle(publication.title), content: media.content, ...(postId ? {} : { slug }),
        categories: [placement.category], tags: placement.tags,
        ...(featured ? { featured_media: featured } : {}),
      });
      const saved = postIdentity.safeParse(response);
      if (saved.success && (postId ? postId === saved.data.id : saved.data.slug === slug)) {
        receipt = { ...base, expected, state: 'unknown', postId: saved.data.id };
        const post = await readPost(request, saved.data.id);
        if (post && post.status !== 'draft') receipt = { ...base, expected, state: 'blocked', postId: post.id };
        else if (post && matchesExpected(post, expected)) {
          receipt = { ...base, expected, state: 'pushed', postId: post.id,
            media: !featured ? 'not_configured' : 'set', metaDescription: expected.metaDescription };
        } else if (post) receipt = { ...base, expected, state: 'mismatch', postId: post.id, reason: 'content_mismatch' };
      }
    } catch (error) {
      if (!(error instanceof WordPressError)) throw error;
      // Even an HTTP error can arrive after WordPress creates the post (for example when setting terms).
      receipt = { ...receipt, state: 'unknown', postId: 'postId' in receipt ? receipt.postId : postId, httpStatus: error.status };
    }
    await save(tx, before, receipt);
    return receiptView(receipt, target, id);
  }

  try {
    const first = await sql.begin(async tx => {
      // Recovery is a read of the saved attempt. It must also work after an editor saves a newer, unapproved draft.
      const [draft] = await tx<{ id: string; version: number; status: string }[]>`SELECT id,version,status FROM studio_drafts WHERE id=${id} FOR UPDATE`;
      if (!draft) return { kind: 'done' as const, result: null };
      const before = await latest(id, tx);
      const request = client(target);
      if (before && before.state !== 'not_sent' && before.site !== site) throw new Conflict('此稿已绑定另一 WordPress 站点，请让维护人核对站点配置。');
      if (before && (recoverOnly || before.state === 'unknown' || before.state === 'pending')) {
        const knownId = 'postId' in before ? before.postId : undefined;
        let post;
        try {
          const recoveredId = knownId ?? await recoverDraft(request, slug);
          post = recoveredId ? await readPost(request, recoveredId) : null;
          if (post && !knownId && post.slug !== slug) throw new WordPressError();
        } catch (error) {
          if (!(error instanceof WordPressError)) throw error;
          return { kind: 'done' as const, result: await unconfirmed(tx, before, error) };
        }
        if (!post) return { kind: 'done' as const, result: await unconfirmed(tx, before) };
        let expected = before.expected;
        // Older receipts had no content identity. Rebuild it only from the very same, still-approved version.
        // Figures require their saved upload identity; never generate or upload them on a recovery request.
        if (!expected && draft.version === before.version && draft.status === 'approved' && before.kind === input.kind) {
          try {
            const publication = await lockStudioPublication(id, before.version, tx);
            if (publication && !publication.draft.figures?.length && !publication.packet.brief) {
              const placement = await resolvePlacement(request, before);
              const ready = await preflight(request, publication, post.id);
              expected = { title: publicStudioTitle(publication.title), content_sha256: contentHash(ready.content),
                categories: [placement.category], tags: placement.tags, featured_media: placement.media,
                metaDescription: publication.meta_description.replace(/\s+/g, ' ').trim() };
            }
          } catch (error) {
            if (error instanceof WordPressError) return { kind: 'done' as const, result: await unconfirmed(tx, before, error) };
            if (!(error instanceof Conflict) && !(error instanceof Error && 'statusCode' in error && error.statusCode === 400)) throw error;
          }
        }
        let recovered: Receipt = { ...before, state: 'unknown', postId: post.id };
        if (post.status !== 'draft' || post.id === before.target_post_id) recovered = { ...before, state: 'blocked', postId: post.id };
        else if (expected && matchesExpected(post, expected)) recovered = { ...before, expected, state: 'pushed', postId: post.id,
          media: expected.featured_media ? 'set' : 'not_configured', metaDescription: expected.metaDescription };
        else recovered = { ...before, state: 'mismatch', postId: post.id, reason: expected ? 'content_mismatch' : 'snapshot_unavailable' };
        await save(tx, before, recovered);
        return { kind: 'done' as const, result: receiptView(recovered, target, id) };
      }
      if (recoverOnly) return { kind: 'done' as const, result: before ? receiptView(before, target, id) : null };
      const publication = await lockStudioPublication(id, version, tx);
      if (!publication) return { kind: 'done' as const, result: null };
      if (!before || before.state === 'not_sent') {
        const placement = await resolvePlacement(request, input);
        const reservation: Receipt = { ...receiptBase, state: 'pending' };
        // Commit this before the first POST. A crash or failed DB commit after the POST must not allow another create.
        await save(tx, before, reservation);
        return { kind: 'create' as const, reservation, placement };
      }
      const knownId = 'postId' in before ? before.postId : undefined;
      const postId = knownId ?? await recoverDraft(request, slug);
      if (!postId) return { kind: 'done' as const, result: receiptView(before, target, id) };
      let placement;
      try { placement = await resolvePlacement(request, input); }
      catch (error) {
        if (!(error instanceof WordPressError)) throw error;
        return { kind: 'done' as const, result: await unconfirmed(tx, before, error) };
      }
      let current;
      try { current = await readPost(request, postId); }
      catch (error) {
        if (!(error instanceof WordPressError)) throw error;
        return { kind: 'done' as const, result: await unconfirmed(tx, before, error) };
      }
      if (!current) return { kind: 'done' as const, result: await unconfirmed(tx, before) };
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
      try { return { result: await write(tx, first.reservation, client(target), publication, first.placement) }; }
      catch (error) {
        if (!(error instanceof DraftPreflightFailure)) throw error;
        // The preflight contains only local checks and authenticated reads. No post/media write was attempted.
        // Commit this reset before reporting the error; unknown results after any write remain recover-only.
        await save(tx, current, { ...receiptBase, state: 'not_sent' });
        return { error: error.error };
      }
    });
    if (second.error) throw second.error;
    return second.result;
  } catch (error) {
    if (error instanceof DraftPreflightFailure) error = error.error;
    if (error instanceof WordPressError) invalid(error.message);
    throw error;
  }
}
