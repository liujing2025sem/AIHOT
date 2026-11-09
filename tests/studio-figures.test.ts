import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { buildFigure, validFigureAlt } from '../packages/backend/src/studio/studio-figures.ts';
import type { FigureSpec } from '../packages/backend/src/studio/studio-figures.ts';
import { inspectFigure, openFigureBrowser } from '../packages/backend/src/studio/studio-figures-render.ts';
import { prepareStudioFigures, previewStudioDraftMedia } from '../packages/backend/src/studio/studio-draft-media.ts';
import { wpFigures } from '../packages/backend/src/studio/studio-publishing-wordpress.ts';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const fact = (id: string, quote: string) => ({ id, statement: quote, quote });
const spec = (template: FigureSpec['template'], params: FigureSpec['params'], overrides: Partial<FigureSpec> = {}): FigureSpec => ({
  template, params, alt_en: 'Image of bars', caption_en: '', ...overrides,
});

test('cabinet sizing floors both dimensions and uses the supplied pitch, with fact selection', async () => {
  // Synthetic fixtures, not evidence for the 6098 page or any commercial cabinet.
  const facts = [fact('target', 'The opening is 48 × 14 ft.'), fact('cabinet', 'The example cabinet is 500 × 500 mm.'),
    fact('pitch', 'The nominal pitch code is P3.91.'), fact('exact', 'P3.91 uses a pitch of 3.90625 mm.')];
  const grid = spec('grid-sizer', {
    target_m: [48 * 0.3048, 14 * 0.3048], options: [{ cabinet_mm: [500, 500], pitch: 3.91 }],
  }, { fact_ids: ['target', 'cabinet', 'pitch'] });
  const nominal = await buildFigure(grid, facts);
  assert.equal(nominal.usable, true, nominal.notes.join('\n'));
  assert.match(nominal.svg, /14\.50 × 4\.00 m/);
  assert.match(nominal.svg, /500 × 500 mm · 29 × 8/);
  assert.match(nominal.svg, /3\.91 mm · 3,683 × 1,016 px/);
  assert.match(nominal.svg, /Δ −0\.1304 × −0\.2672 m/);
  assert.match(nominal.caption_en, /14\.6304 × 4\.2672 m/);

  const exact = spec('grid-sizer', {
    target_m: [14.6304, 4.2672], options: [{ cabinet_mm: [500, 500], pitch: 'P3.91', pitch_mm: 3.90625 }],
  }, { fact_ids: ['target', 'cabinet', 'exact'] });
  const precise = await buildFigure(exact, facts);
  assert.equal(precise.usable, true, precise.notes.join('\n'));
  assert.match(precise.svg, /3\.90625 mm · 3,712 × 1,024 px/);

  for (const fact_ids of [['target', 'cabinet', 'pitch'], ['target', 'exact']]) {
    const unsupported = await buildFigure({ ...exact, fact_ids }, facts);
    assert.equal(unsupported.usable, false);
    assert.equal(unsupported.score.data, 0);
    assert.equal(unsupported.png.length, 0);
  }
  const oversized = await buildFigure(spec('grid-sizer', {
    target_m: [14.6304, 4.2672], options: [{ cabinet_mm: [10, 10], pitch: 'P3.91' }],
  }), [...facts, fact('small', 'The example is 10 × 10 mm.')]);
  assert.equal(oversized.usable, false);
  assert.match(oversized.notes.join('\n'), /64 rows\/columns/);
});

test('density is calculated from the exact pitch inputs and the chart rejects the prototype aliases', async () => {
  const facts = [fact('pitch', 'Common nominal pitches include P3.91, P6.67, and P10.')];
  const chart = spec('bar-compare', { unit: 'dots/m²', items: [{ label: 'P3.91' }, { label: 'P6.67', value: 22_477.5168 }, { label: 'P10' }] });
  const result = await buildFigure(chart, facts);
  assert.equal(result.usable, true, result.notes.join('\n'));
  assert.deepEqual(result.score, { total: 100, data: 30, render: 25, text: 25, file: 20 });
  assert.match(result.svg, /65,410\.3518/);
  assert.match(result.svg, /22,477\.5169/);
  assert.match(result.svg, /data-decoration="scale">0<\/text>/);
  assert.match(result.caption_en, /Calculated by Chipshow/);
  const png = await sharp(result.png).metadata();
  assert.deepEqual([png.format, png.width, png.height], ['png', 1200, 675]);
  assert.ok(result.png.length <= 300_000);

  const wrong = await buildFigure({ ...chart, params: {
    unit: 'dots/m²', items: [{ label: 'P3.91', value: 65_536 }, { label: 'P6.67', value: 22_500 }],
  } }, facts);
  assert.equal(wrong.usable, false);
  assert.equal(wrong.score.data, 0);
  assert.match(wrong.notes.join('\n'), /22500 dots\/m²/);

  const similarHash = (BigInt(`0x${result.hash}`) ^ 1n).toString(16).padStart(16, '0');
  const duplicate = await buildFigure(chart, facts, [similarHash]);
  assert.equal(duplicate.usable, true, 'duplication deducts quality points; the PRD uses the resulting score');
  assert.equal(duplicate.score.file, 10);
  assert.match(duplicate.notes.join('\n'), /visually too similar/);
});

test('bars bind evidence to the item, value and unit; labels reflow and ALT is repaired once', async () => {
  const names = [
    'VERY WIDE SERIES ALPHA SPECIFICATION FOR DISPLAY MODULE A102',
    'SECOND DISPLAY MODULE SERIES PRODUCT REFERENCE FOR CABINET B204',
    'Series C', 'Series D', 'Series E', 'Series F',
  ];
  const items = names.map((label, i) => ({ label, value: (i + 1) * 100 }));
  const facts = [fact('power', items.map(({ label, value }) => `${label}: ${value} W`).join(', '))];
  const chart = spec('bar-compare', { unit: 'W', items }, { caption_en: 'Power figures use the listed test conditions. Source: Example datasheet.' });
  const result = await buildFigure(chart, facts);
  assert.equal(result.usable, true, result.notes.join('\n'));
  assert.equal(result.score.render, 25);
  assert.equal(result.notes.filter(note => /repair pass/.test(note)).length, 1);
  assert.ok(validFigureAlt(result.alt_en));
  const englishWordCount = result.alt_en.trim().split(/\s+/).length;
  assert.ok(englishWordCount >= 10 && englishWordCount <= 18);
  assert.ok(!result.svg.includes(names[0]));

  const swapped = await buildFigure({ ...chart, params: { unit: 'W', items: [
    { label: names[0], value: 200 }, { label: names[1], value: 100 },
  ] } }, facts);
  assert.equal(swapped.score.data, 0);
  const wrongUnit = await buildFigure({ ...chart, params: { unit: 'Hz', items } }, facts);
  assert.equal(wrongUnit.score.data, 0);
  assert.equal(validFigureAlt('LED LED LED horizontal bars comparing display power across several models'), false);
});

test('real Chromium rejects overlapping and clipped text, including a failed layout repair', async () => {
  const browser = await openFigureBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
    const result = await inspectFigure(page, '<svg width="1200" height="675" xmlns="http://www.w3.org/2000/svg">'
      + '<rect width="1200" height="675" fill="#fbfaf7"/>'
      + '<text x="10" y="50" font-size="24">Overlapping label</text><text x="11" y="51" font-size="24">Second label</text>'
      + '<text x="1199" y="100" font-size="24">Outside label</text><text x="20" y="170" font-size="10">Small</text>'
      + '<text x="20" y="210" font-size="20" fill="#2ce2e8">Low contrast</text></svg>', []);
    assert.equal(result.render, 0);
    for (const expected of [/available area/, /Text overlaps/, /smaller than 14 px/, /below 4.5:1/]) {
      assert.match(result.notes.join('\n'), expected);
    }
  } finally { await browser.close(); }

  const colliding = ['MMMMMMMMM longer cabinet suffix MMMM', 'MMMMMMMMM different cabinet suffix MMMM'];
  const result = await buildFigure(spec('bar-compare', { unit: 'W', items: colliding.map((label, i) => ({ label, value: i + 10 })) }),
    colliding.map((label, i) => fact(String(i), `${label} uses ${i + 10} W.`)));
  assert.equal(result.usable, false);
  assert.equal(result.score.data, 30);
  assert.match(result.notes.join('\n'), /no longer identify distinct items/);
});

test('one to four packaging columns and bounded receiving-card chains remain illustrative', async () => {
  for (const columns of [['MiP'], ['SMD', 'COB', 'MiP', 'GOB']]) {
    const layers = await buildFigure(spec('layer-stack', { columns }, { caption_en: 'Lab testing proves a 20% gain.' }), []);
    assert.equal(layers.usable, true, layers.notes.join('\n'));
    assert.match(layers.svg, /data-decoration="callout">③<\/text>/);
    assert.match(layers.caption_en, /Chipshow schematic, not to scale/);
    assert.doesNotMatch(layers.caption_en, /20%|Lab testing/);
  }
  const route = await buildFigure(spec('signal-flow', { source: 'HDMI', grid: [8, 4], ports: 4, backup: true }), []);
  assert.equal(route.usable, true, route.notes.join('\n'));
  assert.equal((route.svg.match(/>RX<\/text>/g) ?? []).length, 32);
  assert.match(route.svg, /stroke-dasharray="8 6"/);
  assert.match(route.caption_en, /Illustrative routing/);
  const invalid = await buildFigure(spec('signal-flow', { source: 'HDMI', grid: [8, 6], ports: 1, backup: true }), []);
  assert.equal(invalid.usable, false);
  assert.equal(invalid.png.length, 0);
});

test('reviewed media plumbing reuses its preview metadata and never rewrites a shared attachment', async t => {
  // Inject the already-inspected renderer result. This verifies plumbing without launching a browser.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#0a6f75"/></svg>';
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const chosen = spec('bar-compare', { unit: 'W', items: [{ label: 'A', value: 100 }, { label: 'B', value: 200 }] },
    { alt_en: 'Chart comparing power measurements for two display modules under identical conditions', caption_en: 'Example source: A 100 W; B 200 W.', fact_ids: ['e1'] });
  const packet = { articles: [{ title: 'Test fixture', body_text: 'A 100 W; B 200 W.' }] } as unknown as Parameters<typeof previewStudioDraftMedia>[0];
  const draft = { body_en: '<p>Reviewed fixture only.</p>', figures: [chosen], evidence: [{ claim: 'Power fixture', quote: 'A 100 W; B 200 W.' }] } as Parameters<typeof previewStudioDraftMedia>[1];
  const renderer: typeof buildFigure = async (_spec, facts) => {
    assert.equal(facts[0].id, 'e1');
    return { svg, png, alt_en: chosen.alt_en, caption_en: chosen.caption_en, hash: 'fixture-hash',
      score: { total: 100, data: 30, render: 25, text: 25, file: 20 }, usable: true, notes: [] };
  };
  const preview = await previewStudioDraftMedia(packet, draft, renderer);
  assert.match(preview.figures[0].src, /^data:image\/png;base64,/);
  assert.equal(preview.figures[0].alt_en, chosen.alt_en);
  assert.equal(preview.figures[0].caption_en, chosen.caption_en);
  const prepared = await prepareStudioFigures({ kind: 'guide', packet, draft, specs: [chosen], content: draft.body_en }, renderer);
  let uploads = 0;
  const items: { id: number; slug: string; source_url: string; alt_text: string; caption: { raw: string } }[] = [];
  const request = async (endpoint: string, query: Record<string, string>, payload?: object) => {
    assert.equal(endpoint, 'media', 'no mutation of shared IDs or WordPress posts');
    if (!payload) return items.filter(item => item.slug === query.slug);
    assert.ok(payload instanceof FormData);
    uploads++;
    const item = { id: 5000 + uploads, slug: String(payload.get('slug')), source_url: 'https://wp.example.test/figures/' + uploads + '.png',
      alt_text: String(payload.get('alt_text')), caption: { raw: String(payload.get('caption')) } };
    items.push(item);
    return item;
  };
  const input = { kind: 'guide' as const, specs: [chosen], packet, draft, title: 'Reviewed guide', content: draft.body_en,
    slug: 'test-reviewed-media-' + randomUUID(), parent: 8000, publishedHashes: [], allowFallback: false, prepared };
  const delivered = await wpFigures(request, input);
  t.after(async () => { for (const receipt of delivered.figures) await unlink(receipt.svgPath); });
  assert.equal(delivered.figures[0].alt_en, preview.figures[0].alt_en);
  assert.equal(delivered.figures[0].caption_en, preview.figures[0].caption_en);
  assert.match(delivered.content, /<figure class="cs-figure"><img[^>]+alt="Chart comparing/);
  assert.match(delivered.content, /<figcaption>Example source: A 100 W; B 200 W\.<\/figcaption>/);
  const repeated = await wpFigures(request, input);
  assert.equal(repeated.featured, delivered.featured);
  assert.equal(uploads, 1, 'repeated draft pushes reuse this article-owned image rather than duplicating it');

  const brand = await prepareStudioFigures({ ...input, kind: 'brief', specs: [] }, renderer);
  assert.equal(brand.figures[0].role, 'decorative');
  assert.equal(brand.figures[0].alt_en, '', 'decorative brand art does not claim to depict each news story');
  const noGuess = await prepareStudioFigures({ ...input, specs: [], content: 'MiP and COB', allowFallback: false }, async () => {
    assert.fail('the approved draft did not request an informative image');
  });
  assert.equal(noGuess.figures.length, 0);
  assert.equal(noGuess.issues[0].code, 'figure_missing');
});
