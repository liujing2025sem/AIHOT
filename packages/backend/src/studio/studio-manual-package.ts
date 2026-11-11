import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { marked } from 'marked';
import { z } from 'zod';
import { sql } from '../db.ts';
import { Conflict } from '../audit.ts';
import { lockStudioPublication } from './studio.ts';
import { sanitizeReviewedHtml } from './studio-wordpress.ts';
import { storedStudioCovers, selectedStudioCover, readStudioCover, studioDeliveryConfirmed } from './studio-covers.ts';
import { previewStudioDraftMedia } from './studio-draft-media.ts';
import { studioUpgradeContext } from './studio-upgrade.ts';

const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const requestSchema = z.object({ version: z.coerce.number().int().positive(), coverRevision: z.coerce.number().int().nonnegative() });

// ZIP store records keep already compressed PNGs intact. All names below are fixed application paths.
function zip(files: Record<string, Buffer>) {
  const local: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const filename = Buffer.from(name), checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(0x21, 12); header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); header.copy(central, 6, 4, 30);
    central.writeUInt32LE(offset, 42);
    local.push(header, filename, data); directory.push(central, filename);
    offset += header.length + filename.length + data.length;
  }
  const dir = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dir, end]);
}

/** Snapshot under the same draft lock as approval. Download never changes publication or delivery receipts. */
export async function exportStudioManualPackage(id: string, input: unknown) {
  const b = requestSchema.parse(input);
  return sql.begin(async tx => {
    const publication = await lockStudioPublication(id, b.version, tx);
    if (!publication) return null;
    const covers = await storedStudioCovers(id, tx);
    if (covers.revision !== b.coverRevision || !studioDeliveryConfirmed(covers, b.version)) {
      throw new Conflict('成品确认已过期，请核对当前正文和封面后重新确认。');
    }
    const selected = selectedStudioCover(covers);
    const files: Record<string, Buffer> = {};
    if (selected) files['cover.png'] = await readStudioCover(selected.contentHash);
    const preview = await previewStudioDraftMedia(publication.packet, publication.draft);
    const figures = preview.figures.filter(figure => figure.role === 'informative').map((figure, index) => {
      const name = `figures/figure-${index + 1}.png`;
      const data = Buffer.from(figure.src.slice(figure.src.indexOf(',') + 1), 'base64');
      files[name] = data;
      return { file: name, sha256: digest(data), alt_en: figure.alt_en, caption_en: figure.caption_en };
    });
    const figureHtml = figures.map(figure => `<figure><img src="${figure.file}" alt="${escape(figure.alt_en)}">${figure.caption_en ? `<figcaption>${escape(figure.caption_en)}</figcaption>` : ''}</figure>`).join('\n');
    const bodyMarkdown = `${publication.body}\n${figureHtml ? '\n'+figureHtml+'\n' : ''}`;
    const markdown = `# ${publication.title}\n\n${bodyMarkdown}`;
    const content = sanitizeReviewedHtml(marked.parse(bodyMarkdown, { async: false }) as string);
    const coverHtml = selected ? `<figure><img src="cover.png" alt="${escape(selected.alt_en)}">${selected.caption_en ? `<figcaption>${escape(selected.caption_en)}</figcaption>` : ''}</figure>` : '';
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(publication.title)}</title><meta name="description" content="${escape(publication.meta_description)}"><style>body{max-width:72ch;margin:40px auto;padding:20px;font:18px/1.75 Georgia,serif;color:#000}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #ccd3df;padding:8px}a{color:#2c4fc4}</style></head><body><article><h1>${escape(publication.title)}</h1>${coverHtml}${content}</article></body></html>`;
    files['article.html']=Buffer.from(html);files['article.md']=Buffer.from(markdown);files['content.html']=Buffer.from(content);
    const upgrade = studioUpgradeContext(publication.packet);
    files['seo.json'] = Buffer.from(JSON.stringify({ title: publication.title, meta_description: publication.meta_description,
      keyword_hypothesis: publication.draft.keyword_hypothesis, target_site: publication.target_site,
      existing_url: upgrade?.target_existing_url ?? null, cover: selected ? { file: 'cover.png', alt_en: selected.alt_en, caption_en: selected.caption_en } : null, figures }, null, 2));
    files['delivery.json'] = Buffer.from(JSON.stringify({ draft_id: id, version: b.version, cover_revision: covers.revision,
      confirmed_at: covers.confirmation!.at, state: 'manual_upload_required', published: false,
      files: Object.entries(files).map(([file, data]) => ({ file, sha256: digest(data), bytes: data.length })),
      source_urls: publication.packet.articles.map(article => article.binding.url),
      upgrade: upgrade ? { target_url: upgrade.target_existing_url, target_post_id: upgrade.target_post_id, notice: upgrade.notice } : null,
      figure_notices: preview.issues }, null, 2));
    files['操作说明.txt'] = Buffer.from(`这份交付包对应已批准正文版本 ${b.version} 和已确认封面。\n\narticle.html 用于完整预览。content.html 为英文正文，article.md 为 Markdown。SEO 标题、描述、封面 ALT 与图注见 seo.json。封面和配图需要由运营上传。\n\n下载不会发布文章，也不会标记已经送达。${upgrade ? `\n此稿用于更新已有页面：${upgrade.target_existing_url}。请核对原网址，避免另建重复页面。原页覆盖仍须用户确认。\n` : ''}${selected ? '' : '\n本包未采用封面。\n'}${preview.issues.map(issue => '\n配图提示：' + issue.message).join('')}\n`);
    return { type: 'application/zip', extension: `v${b.version}.zip`, body: zip(files) };
  });
}
