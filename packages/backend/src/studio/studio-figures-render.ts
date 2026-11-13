/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import type { Page } from 'playwright-core';
import sharp from 'sharp';

const width = 1200, height = 675;
const ink = '#13191c', muted = '#5c676c', teal = '#0a6f75', cyan = '#2ce2e8', warn = '#b5651d';
const paper = '#fbfaf7', hair = '#e2e0da', tint = '#c7f4f3';
type Pair = [number, number];
type Panel = {
  cabinet: Pair; label?: string; pitch: number; cols: number; rows: number;
  width: number; height: number; widthPx: number; heightPx: number;
};
type Layer = 'SMD' | 'COB' | 'MiP' | 'GOB';
export type FigureLayout =
  | { kind: 'grid-sizer'; target: Pair; panels: Panel[] }
  | { kind: 'bar-compare'; unit: string; bars: { label: string; value: number; calculated: boolean }[] }
  | { kind: 'layer-stack'; columns: Layer[] }
  | { kind: 'signal-flow'; source: string; ports: number; grid: Pair; backup: boolean };

const xml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ?? char);
const coord = (value: number) => Number(value.toFixed(4));
const number = (value: number) => (value !== 0 && Math.abs(value) < 0.000001) ? value.toExponential(4)
  : value.toLocaleString('en-US', { maximumFractionDigits: 12 });
const meters = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
const delta = (value: number) => (Math.abs(value) < 1e-12 ? '' : value < 0 ? '−' : '+') + meters(Math.abs(value) < 1e-12 ? 0 : Math.abs(value));
const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, extra = '') =>
  `<line x1="${coord(x1)}" y1="${coord(y1)}" x2="${coord(x2)}" y2="${coord(y2)}" stroke="${stroke}" ${extra}/>`;
const rect = (x: number, y: number, w: number, h: number, fill: string, extra = '') =>
  `<rect x="${coord(x)}" y="${coord(y)}" width="${coord(w)}" height="${coord(h)}" fill="${fill}" ${extra}/>`;
const path = (d: string, stroke: string, extra = '') => `<path d="${d}" fill="none" stroke="${stroke}" ${extra}/>`;
function text(x: number, y: number, content: string, font: number, fill = ink, anchor = 'start', extra = '') {
  return `<text x="${coord(x)}" y="${coord(y)}" font-size="${font}" fill="${fill}" text-anchor="${anchor}" ${extra}>${xml(content)}</text>`;
}
const bold = 'font-weight="600"';
export const shortLabel = (label: string) => {
  const chars = [...label];
  return chars.length <= 14 ? label : `${chars.slice(0, 9).join('').trimEnd()}…${chars.slice(-4).join('').trimStart()}`;
};

function ratio(w: number, h: number): string {
  const a = Math.round(w * 1e6), b = Math.round(h * 1e6);
  let x = a, y = b;
  while (y !== 0) [x, y] = [y, x % y];
  return Math.max(a / x, b / x) <= 9999 ? `${a / x}:${b / x}` : `${(w / h).toFixed(3)}:1`;
}

function gridSizer({ target, panels }: Extract<FigureLayout, { kind: 'grid-sizer' }>): string {
  const [tw, th] = target;
  const dashed = `stroke="${ink}" stroke-width="1.5" stroke-dasharray="8 5"`;
  const slot = panels.length === 1 ? 940 : 560;
  const scale = Math.min((slot - 104) / tw, 266 / th);
  return rect(64, 56, 28, 18, 'none', dashed) + text(102, 71, `${meters(tw)} × ${meters(th)} m`, 16, muted)
    + rect(320, 56, 28, 18, cyan, `fill-opacity=".25" stroke="${teal}"`) + text(358, 71, 'LED', 16, muted)
    + panels.map(({ cabinet, label, pitch, cols, rows, width: w, height: h, widthPx, heightPx }, i) => {
      const cx = panels.length === 1 ? 600 : 348 + i * 560;
      const x = cx - w * scale / 2, y = 283 - h * scale / 2, rw = w * scale, rh = h * scale;
      const tx = cx - tw * scale / 2, ty = 283 - th * scale / 2;
      const cells = Array.from({ length: cols - 1 }, (_, j) => line(x + (j + 1) * rw / cols, y, x + (j + 1) * rw / cols, y + rh, teal)).join('')
        + Array.from({ length: rows - 1 }, (_, j) => line(x, y + (j + 1) * rh / rows, x + rw, y + (j + 1) * rh / rows, teal)).join('');
      const missing = Math.max(Math.abs(w - tw), Math.abs(h - th)) >= 1e-12;
      return text(cx, ty - 18, `${meters(tw)} m`, 18, muted, 'middle')
        + text(tx - 12, 290, `${meters(th)} m`, 18, muted, 'end')
        + rect(x, y, rw, rh, cyan, `fill-opacity=".25" stroke="${teal}" stroke-width="1.5"`) + cells
        + rect(tx, ty, tw * scale, th * scale, 'none', dashed)
        + text(cx, 466, `${meters(w)} × ${meters(h)} m`, 26, teal, 'middle', bold)
        + text(cx, 496, `${cabinet.map(number).join(' × ')} mm · ${cols} × ${rows}`, 17, ink, 'middle')
        + text(cx, 524, `${label ? `${label} · ` : ''}${number(pitch)} mm · ${number(widthPx)} × ${number(heightPx)} px · ${ratio(w, h)}`, 17, muted, 'middle')
        + text(cx, 556, `Δ ${delta(w - tw)} × ${delta(h - th)} m`, 17, missing ? ink : teal, 'middle', bold)
        + (missing ? line(cx - 26, 566, cx + 26, 566, warn, 'stroke-width="2"') : '');
    }).join('');
}

function barCompare({ unit, bars }: Extract<FigureLayout, { kind: 'bar-compare' }>, repair: boolean): string {
  const start = 254, run = 695, top = 120, bottom = 540;
  const largest = Math.max(...bars.map(item => item.value)) || 1;
  const base = Math.max(Number.MIN_VALUE, 10 ** Math.floor(Math.log10(largest / 4)));
  const interval = ([1, 2, 2.5, 5, 10].find(step => step * base >= largest / 4) ?? 10) * base;
  const ticks = Math.min(4, Math.ceil(largest / interval));
  const limit = ticks * interval, row = (bottom - top) / bars.length, barHeight = Math.min(52, row * .65);
  return text(1136, 96, unit, 18, muted, 'end')
    + Array.from({ length: ticks + 1 }, (_, i) => {
      const x = start + (i / ticks) * run;
      return line(x, top, x, bottom, hair) + text(x, 568, number(interval * i), 15, muted, 'middle', 'data-decoration="scale"');
    }).join('')
    + bars.map(({ label, value }, i) => {
      const y = top + (i + .5) * row, w = value / limit * run;
      return text(start - 24, y + 8, repair ? shortLabel(label) : label, repair ? 18 : 24, ink, 'end', `${bold} data-max-width="166"`)
        + rect(start, y - barHeight / 2, w, barHeight, teal)
        + text(start + w + 16, y + 8, number(value), 24, ink, 'start', bold);
    }).join('');
}

function layerStack({ columns }: Extract<FigureLayout, { kind: 'layer-stack' }>): string {
  const gap = 1072 / columns.length;
  return columns.map((layer, i) => {
    const w = Math.min(288, gap - 24), cx = 64 + gap * (i + .5), left = cx - w / 2;
    const count = layer === 'COB' ? 7 : layer === 'MiP' ? 6 : 3;
    const cell = w / count, pkgW = Math.min(cell * .68, layer === 'MiP' ? 28 : 52);
    const pkgH = layer === 'MiP' ? 24 : 46;
    const packageStroke = `stroke="${ink}" stroke-width="1.3"`;
    const coat = `fill-opacity=".35" stroke="${teal}" stroke-width="1.2"`;
    const chips = Array.from({ length: count }, (_, j) => {
      const x = left + (j + .5) * cell;
      return (layer === 'COB' ? '' : rect(x - pkgW / 2, 380 - pkgH, pkgW, pkgH, hair, packageStroke)
        + rect(x - pkgW * .39, 383 - pkgH, pkgW * .78, pkgH * .35, cyan, coat))
        + rect(x - 6, layer === 'COB' ? 368 : 374 - pkgH / 2, 12, 9, teal);
    }).join('');
    const chipX = left + cell / 2, topX = left + cell * (layer === 'GOB' ? 1 : 1.5);
    const cover = layer === 'COB' ? rect(left, 340, w, 40, cyan, coat)
      : layer === 'GOB' ? rect(left, 322, w, 58, cyan, coat) : '';
    return text(cx, 140, layer, 28, ink, 'middle', bold)
      + rect(left, 380, w, 40, ink) + (layer === 'COB' ? cover + chips : chips + cover)
      + line(chipX, layer === 'COB' ? 368 : 374 - pkgH / 2, chipX, 250, muted)
      + line(topX, layer === 'COB' ? 340 : layer === 'GOB' ? 322 : 380 - pkgH, topX, 214, muted)
      + line(cx, 420, cx, 470, muted)
      + text(chipX, 244, '②', 22, ink, 'middle', 'data-decoration="callout"')
      + text(topX, 208, '③', 22, ink, 'middle', 'data-decoration="callout"')
      + text(cx, 496, '①', 22, ink, 'middle', 'data-decoration="callout"');
  }).join('');
}

function signalFlow({ source, ports, grid: [cols, rows], backup }: Extract<FigureLayout, { kind: 'signal-flow' }>, repair: boolean): string {
  const primary = ports - Number(backup), x0 = 526, gapX = 20, gapY = 22;
  const w = (568 - (cols - 1) * gapX) / cols;
  const h = Math.min(110, (340 - (rows - 1) * gapY) / rows);
  const y0 = 340 - (rows * h + (rows - 1) * gapY) / 2;
  const node = (index: number) => {
    const row = Math.floor(index / cols), order = index % cols;
    const col = row % 2 ? cols - 1 - order : order;
    return { x: x0 + col * (w + gapX), y: y0 + row * (h + gapY), row, col };
  };
  const arrow = 'stroke-width="2.5" marker-end="url(#arrow)"';
  const box = `stroke="${ink}" stroke-width="1.5"`;
  const ordinal = 'data-decoration="port"';
  const total = rows * cols;
  let diagram = '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto">'
    + `<path d="M0 0 L10 5 L0 10 z" fill="${teal}"/></marker></defs>`
    + rect(64, 300, 140, 80, paper, box) + text(134, 348, repair ? shortLabel(source) : source, repair ? 14 : 22, ink, 'middle', `${bold} data-max-width="124"`)
    + line(204, 340, 270, 340, teal, arrow) + rect(276, 250, 138, 180, paper, box)
    + text(345, 348, 'TX', 22, ink, 'middle', bold)
    + line(64, 66, 104, 66, teal, 'stroke-width="3"') + text(114, 71, '1', 16, muted, 'start', ordinal)
    + (backup ? line(150, 66, 190, 66, warn, 'stroke-width="3" stroke-dasharray="8 6"') + text(200, 71, String(ports), 16, muted, 'start', ordinal) : '');

  const connectors: string[] = [];
  for (let p = 0; p < primary; p++) {
    const first = Math.floor(p * total / primary), end = Math.floor((p + 1) * total / primary);
    const outY = 260 + (p + 1) * (160 / (ports + 1)), lane = 464 + p * 6;
    const start = node(first);
    const cy = start.y + h / 2;
    diagram += text(424, outY - 4, String(p + 1), 15, muted, 'start', ordinal);
    if (first % cols === 0 && start.col === 0) {
      connectors.push(path(`M414 ${outY} H${lane} V${cy} H${start.x}`, teal, arrow));
    } else {
      // Enter other start nodes through a row gutter, outside the labeled cards.
      const gutter = start.y - gapY / 2 + (p % 3) * 3;
      connectors.push(path(`M414 ${outY} H${lane} V${gutter} H${start.x + w / 2} V${start.y}`, teal, arrow));
    }
    for (let i = first + 1; i < end; i++) {
      const a = node(i - 1), b = node(i), ay = a.y + h / 2, by = b.y + h / 2;
      if (a.row === b.row) {
        const forward = a.x < b.x;
        connectors.push(line(a.x + (forward ? w : 0), ay, b.x + (forward ? 0 : w), by, teal, arrow));
      } else {
        const side = a.row % 2 === 0 ? 1 : 0, ax = a.x + w * side, bx = b.x + w * side, turn = ax + (side ? 24 : -12);
        connectors.push(path(`M${ax} ${ay} H${turn} V${by} H${bx}`, teal, arrow));
      }
    }
  }
  if (backup) {
    const last = node(total - 1), outY = 260 + ports * (160 / (ports + 1));
    connectors.push(path(`M${last.x + w / 2} ${last.y + h} V${last.y + h + 24} H450 V${outY} H414`, warn, 'stroke-width="3" stroke-dasharray="8 6"'));
    diagram += text(424, outY - 4, String(ports), 15, muted, 'start', ordinal);
  }
  diagram += connectors.join('');
  for (let i = 0; i < total; i++) {
    const { x, y } = node(i);
    diagram += rect(x, y, w, h, cyan, `fill-opacity=".25" stroke="${teal}" stroke-width="1.5"`)
      + text(x + 10, y + 23, 'RX', 16, teal, 'start', `${bold} data-background="${tint}"`);
  }
  return diagram;
}

export function renderFigure(layout: FigureLayout, alt: string, repair = false): string {
  const content = layout.kind === 'grid-sizer' ? gridSizer(layout) : layout.kind === 'bar-compare' ? barCompare(layout, repair)
    : layout.kind === 'layer-stack' ? layerStack(layout) : signalFlow(layout, repair);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="figure-title" font-family="Inter, Segoe UI, Arial, sans-serif">`
    + `<title id="figure-title">${xml(alt)}</title>` + rect(0, 0, width, height, paper) + content
    + text(1136, 628, 'CHIPSHOW', 14, muted, 'end', 'letter-spacing="3"') + '</svg>';
}

// A screenshot is the source for both PNG and its 64-bit perceptual hash.
const cos = Array.from({ length: 8 }, (_, u) => Array.from({ length: 32 }, (_, x) => Math.cos((2 * x + 1) * u * Math.PI / 64)));
async function perceptualHash(png: Buffer): Promise<string> {
  const luminance = await sharp(png).resize(32, 32, { fit: 'fill' }).greyscale().raw().toBuffer();
  const coefficients = cos.flatMap(cx => cos.map(cy => {
    let value = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) value += luminance[y * 32 + x] * cx[x] * cy[y];
    return value;
  }));
  const median = coefficients.slice(1).sort((a, b) => a - b)[31];
  let hash = 0n;
  for (const value of coefficients) hash = (hash << 1n) | BigInt(value > median);
  return hash.toString(16).padStart(16, '0');
}
function near(a: string, b: string): boolean {
  if (!/^[\da-f]{16}$/i.test(b)) return false;
  let bits = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), distance = 0;
  while (bits && distance <= 5) { bits &= bits - 1n; distance++; }
  return distance <= 5;
}

async function retryTimeout<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) { if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error; return run(); }
}

export async function openFigureBrowser() {
  // The app can still start and publish text if a deployment omitted dev dependencies.
  const { chromium } = await import('playwright-core');
  // Playwright resolves PLAYWRIGHT_BROWSERS_PATH. Prefer its normal headless shell;
  // if only the matching full Chromium is cached, use that existing binary.
  return retryTimeout(async () => {
    try { return await chromium.launch({ timeout: 15_000 }); }
    catch (error) {
      const full = chromium.executablePath();
      if (!(error instanceof Error) || !/Executable doesn't exist/i.test(error.message) || !existsSync(full)) throw error;
      return chromium.launch({ executablePath: full, timeout: 15_000 });
    }
  });
}

export type FigureProof = { render: number; file: number; png: Buffer; hash: string; notes: string[] };
export function inspectFigure(page: Page, svg: string, publishedHashes: string[]): Promise<FigureProof> {
  return retryTimeout(async () => {
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>body{margin:0}svg{display:block}</style>${svg}`, { timeout: 10_000 });
    const root = page.locator('svg');
    const geometry = await root.evaluate(async (element) => {
      await document.fonts.ready;
      const area = element.getBoundingClientRect();
      const texts = Array.from(element.querySelectorAll('text')).map(node => ({
        text: node.textContent ?? '', box: node.getBoundingClientRect(), style: getComputedStyle(node),
        max: Number(node.getAttribute('data-max-width')) || Infinity,
        background: node.getAttribute('data-background') ?? '#fbfaf7',
      }));
      const luminance = (color: string) => {
        const rgb = color.startsWith('#') ? color.slice(1).match(/../g)?.map(pair => parseInt(pair, 16)) : color.match(/[\d.]+/g)?.map(Number);
        if (!rgb || rgb.length < 3) return NaN;
        const linear = rgb.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
      };
      const outside = texts.find(({ box, max }) => box.left < area.left || box.top < area.top || box.right > area.right || box.bottom > area.bottom || box.width > max);
      let overlap: [string, string] | undefined;
      for (const [i, a] of texts.entries()) for (const b of texts.slice(i + 1)) {
        if (Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > .5
          && Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > .5) overlap ??= [a.text, b.text];
      }
      return {
        outside: outside?.text, overlap, small: texts.find(({ style }) => parseFloat(style.fontSize) < 14)?.text,
        contrast: texts.find(({ style, background }) => {
          const a = luminance(style.fill), b = luminance(background);
          return !((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5);
        })?.text,
      };
    }, undefined, { timeout: 10_000 });
    const notes: string[] = [];
    if (geometry.outside) notes.push(`Text exceeds its available area: ${geometry.outside}.`);
    if (geometry.overlap) notes.push(`Text overlaps: ${geometry.overlap.join(' / ')}.`);
    if (geometry.small) notes.push(`Text is smaller than 14 px: ${geometry.small}.`);
    if (geometry.contrast) notes.push(`Text contrast is below 4.5:1: ${geometry.contrast}.`);
    const render = (geometry.outside || geometry.overlap ? 0 : 15) + (geometry.small ? 0 : 5) + (geometry.contrast ? 0 : 5);
    const screenshot = await root.screenshot({ timeout: 10_000, scale: 'css' });
    const png = await sharp(screenshot).png({ palette: true, colours: 128, dither: 0, compressionLevel: 9 }).toBuffer();
    const hash = await perceptualHash(png);
    const duplicate = publishedHashes.some(other => near(hash, other));
    if (png.length > 300_000) notes.push('PNG exceeds 300 KB.');
    if (duplicate) notes.push('Figure is visually too similar to a published figure.');
    const file = (png.length <= 300_000 ? 10 : 0) + (duplicate ? 0 : 10);
    return { render, file, png, hash, notes };
  });
}
