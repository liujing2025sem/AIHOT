import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { Packet } from '../../../../scripts/editorial-pilot-lib.ts';
import { buildFigure, type FigureSpec } from './studio-figures.ts';
import type { EditorialDraft, PublicationIssue } from './studio-publishing-content.ts';

type Render = typeof buildFigure;
export type DraftMediaInput = {
  kind: 'brief' | 'article' | 'guide' | 'update'; specs: FigureSpec[]; packet: Packet; draft: EditorialDraft;
  content: string; publishedHashes?: string[]; allowFallback?: boolean;
};
export type DraftFigure = {
  svg: string; png: Buffer; alt_en: string; caption_en: string; hash: string;
  score: Awaited<ReturnType<Render>>['score'] | null; role: 'decorative' | 'informative';
};
const briefSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><defs><pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r="2.5" fill="#2ce2e8" opacity=".45"/></pattern></defs><rect width="1200" height="675" fill="#13191c"/><path d="M340 0h860v675H160Z" fill="#0a6f75"/><path d="M640 0h560v675H350Z" fill="url(#dots)"/><path d="M850 0h35L590 675h-35Z" fill="#2ce2e8"/><path d="M975 0h18L698 675h-18Z" fill="#2ce2e8" opacity=".65"/></svg>';
function fallbackFigure(html: string): FigureSpec[] {
  const columns = ['MiP', 'SMD', 'COB', 'GOB'].filter(name => new RegExp('\\b' + name + '\\b', 'i').test(html));
  return columns.includes('MiP') ? [{ template: 'layer-stack', params: { columns }, alt_en: '', caption_en: '' }] : [];
}

/** One renderer supplies the internal preview and WordPress delivery. No upload, model or approval. */
export async function prepareStudioFigures(input: DraftMediaInput, render: Render = buildFigure) {
  const figures: DraftFigure[] = [], issues: PublicationIssue[] = [];
  if (input.kind === 'brief') {
    try {
      const png = await sharp(Buffer.from(briefSvg)).png().toBuffer();
      figures.push({ svg: briefSvg, png, alt_en: '', caption_en: '', score: null,
        hash: createHash('sha256').update(png).digest('hex'), role: 'decorative' });
    } catch { issues.push({ code: 'figure_missing', message: '本期装饰封面未能生成，可继续审稿。' }); }
    return { figures, issues };
  }
  const evidence = input.draft.evidence.flatMap((e, i) =>
    input.packet.articles.some(a => a.body_text?.includes(e.quote) || a.title.includes(e.quote))
      ? [{ id: 'e' + (i + 1), statement: e.quote, quote: e.quote }] : []);
  const facts = [...(input.packet.pitch?.fragments_plan?.facts ?? []), ...evidence];
  const specs = (input.specs.length ? input.specs : input.allowFallback ? fallbackFigure(input.content) : [])
    .slice(0, input.kind === 'article' ? 1 : 3);
  const usedHashes = [...(input.publishedHashes ?? [])];
  let missed = !specs.length;
  for (const spec of specs) {
    try {
      const figure = await render(spec, facts, usedHashes);
      if (!figure.usable || figure.score.total < 60) { missed = true; continue; }
      figures.push({ ...figure, role: 'informative' });
      usedHashes.push(figure.hash);
    } catch { missed = true; }
  }
  if (missed) issues.push({ code: 'figure_missing', message: '正文配图尚未准备好或未过质检，可继续审稿；未核对的图不会加入交付。' });
  return { figures, issues };
}

export async function previewStudioDraftMedia(packet: Packet, draft: EditorialDraft, render: Render = buildFigure) {
  const result = await prepareStudioFigures({ packet, draft, content: draft.body_en, specs: draft.figures ?? [],
    kind: packet.brief ? 'brief' : packet.pitch?.output_type === 'update' || packet.editorial_plan?.action === 'update_page' ? 'update' : 'guide',
    allowFallback: false }, render);
  return { issues: result.issues, figures: result.figures.map(figure => ({
    hash: figure.hash, src: 'data:image/png;base64,' + figure.png.toString('base64'),
    alt_en: figure.alt_en, caption_en: figure.caption_en, role: figure.role, score: figure.score,
    width: 1200, height: 675,
  })) };
}
