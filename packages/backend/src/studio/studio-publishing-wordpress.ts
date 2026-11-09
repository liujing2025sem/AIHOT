import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Packet } from '../../../../scripts/editorial-pilot-lib.ts';
import { WordPressError, wordpressClient } from './studio-wordpress.ts';
import { config } from '../config.ts';
import type { FigureSpec } from './studio-figures.ts';
import { sameWordPressHtml, type EditorialDraft, type PublicationIssue } from './studio-publishing-content.ts';
import { prepareStudioFigures, type DraftFigure } from './studio-draft-media.ts';
import { samePage } from './studio-upgrade.ts';

type Request = ReturnType<typeof wordpressClient>;
export const postId = z.number().int().positive();
const raw = z.object({ raw: z.string() });
const post = z.object({
  id: postId, slug: z.string(), link: z.url(), status: z.string(), title: raw, content: raw, excerpt: raw.optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  categories: z.array(postId).optional(), tags: z.array(postId).optional(), featured_media: z.number().int().nonnegative().optional(),
});
export type WpPost = z.infer<typeof post>;
export type Visibility = 'publish' | 'private' | 'draft';
const postQuery = { context: 'edit', _fields: 'id,slug,link,status,title,content,excerpt,meta,categories,tags,featured_media' };
const identity = post.pick({ id: true, slug: true });
const revision = z.object({ id: postId, parent: postId, slug: z.string(), title: raw, content: raw, excerpt: raw.optional() });
const retryable = (error: unknown) => error instanceof WordPressError &&
  (error.status === undefined || [408, 500, 502, 503, 504].includes(error.status));

export async function wpRetry<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (error) {
    if (!retryable(error)) throw error;
    return fn();
  }
}
function checked<T extends z.ZodType>(schema: T, result: unknown): z.infer<T> {
  const parsed = schema.safeParse(result);
  if (!parsed.success) throw new WordPressError();
  return parsed.data;
}
export async function wpRead(request: Request, id: number) {
  const result = checked(post, await wpRetry(() => request('posts/' + id, postQuery)));
  if (result.id !== id) throw new WordPressError();
  return result;
}
async function wpLookup(request: Request, slug: string, schema: typeof identity, status = 'any') {
  const query = { context: 'edit', _fields: 'id,slug', slug, status, per_page: '2' };
  const matching = checked(z.array(schema), await wpRetry(() => request('posts', query))).filter(item => item.slug === slug);
  if (matching.length > 1) throw new WordPressError();
  return matching[0];
}
export function equivalentPage(first: string, second: string) {
  return samePage(first, second);
}
export async function wpUpdateTarget(request: Request, base: URL, target: string) {
  const url = new URL(target);
  if (url.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '') ||
      url.port !== base.port || url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
  const pathSlug = url.pathname.split('/').filter(Boolean).at(-1);
  const queryId = postId.safeParse(Number(url.searchParams.get('p')));
  const match = queryId.success ? { id: queryId.data } :
    pathSlug ? await wpLookup(request, decodeURIComponent(pathSlug), identity, 'publish') : null;
  if (!match) return null;
  const current = await wpRead(request, match.id);
  return equivalentPage(current.link, target) ? current : null;
}

/** Reserve the slug with a non-public draft before any publish. A timed out create is reconciled
 * by that slug first; a late WordPress response can leave a draft, but cannot publish a second post. */
export async function wpReserve(request: Request, slug: string) {
  const existing = await wpLookup(request, slug, identity);
  if (existing) return existing.id;
  const create = async () => {
    const saved = checked(identity, await request('posts', { _fields: 'id,slug' }, { slug, status: 'draft', title: slug }));
    if (saved.slug !== slug) throw new WordPressError();
    return saved.id;
  };
  try { return await create(); }
  catch (error) {
    if (!retryable(error)) throw error;
    const recovered = await wpLookup(request, slug, identity);
    if (recovered) return recovered.id;
    try { return await create(); }
    catch (retryError) {
      if (!retryable(retryError)) throw retryError;
      const recoveredAgain = await wpLookup(request, slug, identity);
      if (recoveredAgain) return recoveredAgain.id;
      throw retryError;
    }
  }
}

type Write = {
  status?: Visibility; title?: string; content?: string; excerpt?: string;
  categories?: number[]; tags?: number[]; featured_media?: number; meta?: Record<string, string>;
};
export async function wpWrite(request: Request, id: number, payload: Write, retry = true) {
  const write = () => request('posts/' + id, { _fields: 'id' }, payload);
  if (retry) await wpRetry(write);
  else await write(); // Never blindly repeat an in-place update of an already published page.
}
export async function wpVerify(request: Request, base: URL, id: number, payload: Write & { status: Visibility }) {
  const actual = await wpRead(request, id);
  const sameTerms = (expected: number[] | undefined, saved: number[] | undefined) =>
    expected === undefined || (saved?.length === expected.length && expected.every(term => saved.includes(term)));
  if (actual.status !== payload.status ||
    (payload.title !== undefined && actual.title.raw.replace(/\r\n?/g, '\n') !== payload.title.replace(/\r\n?/g, '\n')) ||
    (payload.content !== undefined && !sameWordPressHtml(actual.content.raw, payload.content)) ||
    !sameTerms(payload.categories, actual.categories) || !sameTerms(payload.tags, actual.tags) ||
    (payload.featured_media !== undefined && actual.featured_media !== payload.featured_media) ||
    Object.entries(payload.meta ?? {}).some(([key, value]) => actual.meta?.[key] !== value)) throw new WordPressError();
  if (payload.status === 'publish') {
    const link = new URL(actual.link);
    if (link.protocol !== 'https:' || link.username || link.password ||
      link.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '') || link.port !== base.port) throw new WordPressError();
    await wpRetry(async () => {
      try {
        const res = await fetch(link, { method: 'GET', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
        await res.body?.cancel().catch(() => {});
        if (res.status !== 200) throw new WordPressError(res.status);
      } catch (error) { throw error instanceof WordPressError ? error : new WordPressError(); }
    });
  }
  return actual;
}
export async function wpPreviousRevision(request: Request, current: WpPost, baselineRevision?: number) {
  const revisions = checked(z.array(revision), await wpRetry(() => request('posts/' + current.id + '/revisions', {
    context: 'edit', per_page: '20', order: 'desc', orderby: 'date', _fields: 'id,parent,slug,title,content,excerpt',
  })));
  return revisions.find(r => r.parent === current.id && !/-autosave(?:-|$)/.test(r.slug) &&
    (!baselineRevision || r.id === baselineRevision) &&
    (r.title.raw !== current.title.raw || !sameWordPressHtml(r.content.raw, current.content.raw) ||
      (r.excerpt?.raw ?? '') !== (current.excerpt?.raw ?? '')));
}

export function wpMeta(description: string) {
  return { excerpt: description, meta: { _yoast_wpseo_metadesc: description } };
}

export const figureSpecSchema = z.object({
  template: z.enum(['grid-sizer', 'bar-compare', 'layer-stack', 'signal-flow']),
  params: z.record(z.string(), z.unknown()), alt_en: z.string().max(300), caption_en: z.string().max(500),
  fact_ids: z.array(z.string()).max(30).optional(),
});
const media = z.object({ id: postId, slug: z.string(), source_url: z.url(), alt_text: z.string(), caption: raw });
export type PublishedFigure = {
  mediaId: number; hash: string; svgPath: string; score: DraftFigure['score']; alt_en: string; caption_en: string;
};
const mediaQuery = { context: 'edit', _fields: 'id,slug,source_url,alt_text,caption' };
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
async function wpMedia(request: Request, args: { slug: string; png: Buffer; alt: string; caption: string; parent: number }) {
  const lookup = async () => {
    const matches = checked(z.array(media), await wpRetry(() => request('media', { ...mediaQuery, slug: args.slug })))
      .filter(item => item.slug === args.slug);
    if (matches.length > 1) throw new WordPressError();
    return matches[0];
  };
  const upload = async () => {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(args.png)], { type: 'image/png' }), args.slug + '.png');
    form.set('slug', args.slug);
    form.set('alt_text', args.alt);
    form.set('caption', args.caption);
    form.set('post', String(args.parent));
    return checked(media, await request('media', mediaQuery, form));
  };
  let item: z.infer<typeof media>;
  try { item = await lookup() ?? await upload(); }
  catch (error) {
    if (!retryable(error)) throw error;
    item = await lookup() ?? await upload();
  }
  if (item.alt_text !== args.alt || !sameWordPressHtml(item.caption.raw, args.caption)) {
    const id = item.id;
    item = checked(media, await wpRetry(() => request('media/' + id, mediaQuery, {
      alt_text: args.alt, caption: args.caption, post: args.parent,
    })));
  }
  const url = new URL(item.source_url);
  if (item.alt_text !== args.alt || !sameWordPressHtml(item.caption.raw, args.caption) ||
    url.protocol !== 'https:' || url.username || url.password) throw new WordPressError();
  return item;
}

export async function wpFigures(request: Request, input: {
  kind: 'brief' | 'article' | 'guide' | 'update'; specs: FigureSpec[]; packet: Packet; draft: EditorialDraft;
  title: string; content: string; slug: string; parent: number; publishedHashes: string[]; allowFallback?: boolean;
  prepared?: Awaited<ReturnType<typeof prepareStudioFigures>>;
}) {
  const prepared = input.prepared ?? await prepareStudioFigures({ ...input, allowFallback: input.allowFallback ?? true });
  const issues: PublicationIssue[] = [...prepared.issues];
  const figures: string[] = [];
  const receipts: PublishedFigure[] = [];
  let featured: number | undefined;
  async function attach(svg: string, png: Buffer, alt: string, caption: string, index: number) {
    const hash = createHash('sha256').update(svg).digest('hex').slice(0, 12);
    const name = input.slug + '-figure-' + (index + 1) + '-' + hash;
    const dir = path.join(config.dataDir, 'studio-figures');
    await mkdir(dir, { recursive: true });
    const svgPath = path.resolve(dir, name + '.svg');
    await writeFile(svgPath, svg);
    const item = await wpMedia(request, { slug: name, png, alt, caption, parent: input.parent });
    return { item, svgPath };
  }
  for (const [index, figure] of prepared.figures.entries()) {
    try {
      const { item, svgPath } = await attach(figure.svg, figure.png, figure.alt_en, figure.caption_en, index);
      featured ??= item.id;
      receipts.push({ mediaId: item.id, svgPath, score: figure.score, hash: figure.hash, alt_en: figure.alt_en, caption_en: figure.caption_en });
      if (figure.role === 'informative') {
        figures.push('<figure class="cs-figure"><img src="' + escape(item.source_url) +
          '" width="1200" height="675" alt="' + escape(figure.alt_en) + '" loading="lazy"><figcaption>' +
          escape(figure.caption_en) + '</figcaption></figure>');
      }
    } catch { issues.push({ code: 'figure_missing', message: '配图未能上传，文字已保留。' }); }
  }
  const body = [input.content, ...figures].filter(Boolean).join('\n');
  return { content: input.kind === 'brief' && !/<(?:section|div)\b[^>]*class=["'][^"']*\bcs-brief\b/i.test(body)
    ? '<section class="cs-brief">' + body + '</section>' : body, featured, issues, figures: receipts };
}
