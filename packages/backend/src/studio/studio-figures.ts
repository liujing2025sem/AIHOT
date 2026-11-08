import { z } from 'zod';
import {
  inspectFigure, openFigureBrowser, renderFigure, shortLabel,
} from './studio-figures-render.ts';
import type { FigureLayout, FigureProof } from './studio-figures-render.ts';

export type FigureSpec = {
  template: 'grid-sizer' | 'bar-compare' | 'layer-stack' | 'signal-flow';
  params: Record<string, unknown>;
  alt_en: string;
  caption_en: string;
  fact_ids?: string[];
};
type Fact = { id: string; statement: string; quote: string; calculation?: unknown };
type FigureScore = { total: number; data: number; render: number; text: number; file: number };
type FigureResult = {
  svg: string; png: Buffer; alt_en: string; caption_en: string; hash: string;
  score: FigureScore; usable: boolean; notes: string[];
};

const model = z.string().trim().min(1).max(120).regex(/^[\p{L}\p{N}][\p{L}\p{N} ._+\/&()%-]*$/u);
const pitch = z.number().min(0.01).max(100);
const dimension = (min: number, max: number) => z.number().min(min).max(max);
const schemas = {
  'grid-sizer': z.object({
    target_m: z.tuple([dimension(0.01, 100), dimension(0.01, 100)]),
    options: z.array(z.object({
      cabinet_mm: z.tuple([dimension(1, 10000), dimension(1, 10000)]),
      pitch: z.union([pitch, z.string().regex(/^P\d+(?:\.\d+)?$/i)]).optional(),
      pitch_mm: pitch.optional(),
    })).min(1).max(2),
  }),
  'bar-compare': z.object({
    unit: z.string().trim().min(1).max(24).regex(/^[\p{L}\p{N} ./^%$€¥²³°-]+$/u),
    items: z.array(z.object({
      label: model, value: z.number().nonnegative().max(1e10).optional(), pitch_mm: pitch.optional(),
    })).min(2).max(6),
  }),
  'layer-stack': z.object({ columns: z.array(z.enum(['SMD', 'COB', 'MiP', 'GOB'])).min(1).max(4) }),
  'signal-flow': z.object({
    source: model, ports: z.number().int().min(1).max(8),
    grid: z.tuple([z.number().int().min(1).max(8), z.number().int().min(1).max(6)]),
    backup: z.boolean(),
  }),
};

const n = String.raw`[+\-−]?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)`;
const parseNumber = (value: string) => Number(value.replaceAll(',', '').replace('−', '-'));
// Only absorb binary floating-point noise; a rounded model name is never an exact pitch alias.
const same = (a: number, b: number) => Math.abs(a - b) <= Number.EPSILON * 8 * Math.max(1, Math.abs(a), Math.abs(b));
const floor = (value: number) => same(value, Math.round(value)) ? Math.round(value) : Math.floor(value);
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const symbol = (value: string) => `(?<![\\p{L}\\p{N}])${escapeRegex(value)}(?![\\p{L}\\p{N}]|\\.\\d)`;
const unitGroups = [
  ['dots/m²', String.raw`(?:dots?|pixels?|px)\s*(?:\/|per\s+)\s*(?:m\s*\^?2|square met(?:er|re)s?)|点\s*\/\s*(?:m2|平方米)`],
  ['nits', String.raw`nits?|cd\s*\/\s*m\s*\^?2|尼特`],
  ['mm', 'mm|millimet(?:er|re)s?|毫米'], ['m', 'm|met(?:er|re)s?|米'],
  ['W/m²', String.raw`(?:w|watts?)\s*(?:\/|per\s+)\s*(?:m\s*\^?2|square met(?:er|re)s?)`],
  ['W', 'w|watts?|瓦'], ['kW', 'kw|kilowatts?|千瓦'], ['Hz', 'hz|hertz'],
  ['px', 'px|pixels?|像素'], ['%', '%|percent|per cent'],
];
function unitPattern(unit: string): string {
  const normalized = unit.normalize('NFKC').toLowerCase();
  return unitGroups.find(([name, aliases]) => name.normalize('NFKC').toLowerCase() === normalized
    || new RegExp(`^(?:${aliases})$`, 'iu').test(normalized))?.[1] ?? escapeRegex(normalized);
}
const measured = (unit: string) => new RegExp(
  `(?<![\\p{L}\\p{N}.,+−-])(${n})\\s*(?:${unitPattern(unit)})(?![a-z0-9/^²³]|\\s*\\/)`, 'giu',
);
const structured = z.object({
  fn: z.string(), inputs: z.record(z.string(), z.number()).optional(), result: z.record(z.string(), z.number()),
});

function evidence(facts: readonly Fact[]) {
  const lines = facts.flatMap(fact => [fact.statement, fact.quote].flatMap(value => value.normalize('NFKC')
    .replace(/(?:https?:\/\/|www\.)[^\s]+/giu, ' ').split(/\r?\n|[;；。!?]|\.\s+(?=[A-Z])/u)));
  const calculations = facts.flatMap(fact => {
    const parsed = structured.safeParse(fact.calculation);
    return parsed.success ? [{ ...parsed.data, fact }] : [];
  });
  function pair(values: readonly [number, number], unit: 'm' | 'mm'): boolean {
    const u = unitPattern(unit);
    const expression = new RegExp(`(?<![\\p{L}\\p{N}.,+−-])(${n})(?:\\s*(?:${u}))?\\s*[×x*]\\s*(${n})\\s*(?:${u})(?![a-z0-9/^]|\\s*\\/)`, 'giu');
    if (lines.some(line => [...line.matchAll(expression)].some(match =>
      same(values[0], parseNumber(match[1])) && same(values[1], parseNumber(match[2]))))) return true;
    if (unit !== 'm') return false;
    const feet = new RegExp(`(?<![\\p{L}\\p{N}.,+−-])(${n})(?:\\s*(?:ft|feet))?\\s*[×x*]\\s*(${n})\\s*(?:ft|feet)(?![a-z0-9])`, 'giu');
    return lines.some(line => [...line.matchAll(feet)].some(match =>
      same(values[0], parseNumber(match[1]) * 0.3048) && same(values[1], parseNumber(match[2]) * 0.3048)))
      || calculations.some(({ fn, inputs }) => fn === 'pixels' && inputs && inputs.width_ft > 0 && inputs.height_ft > 0
        && same(values[0], inputs.width_ft * 0.3048) && same(values[1], inputs.height_ft * 0.3048));
  }
  function hasPitch(mm: number, label?: string): boolean {
    const pitchCode = new RegExp(symbol(label ?? `P${mm}`), 'iu');
    const nominal = label ? nominalPitch(label) : mm;
    let nominalFound = false;
    const explicit: number[] = [];
    for (const line of lines) {
      const code = pitchCode.exec(line);
      if (label && !code) continue;
      const codeEnd = code ? code.index + code[0].length : 0;
      const others = [...line.matchAll(/(?<![\p{L}\p{N}])P\d+(?:\.\d+)?(?![\p{L}\p{N}]|\.\d)/giu)];
      const next = others.find(other => other.index >= codeEnd);
      const start = code && others.some(other => other.index !== code.index) ? codeEnd : 0;
      const segment = line.slice(start, code ? next?.index : undefined);
      for (const value of segment.matchAll(measured('mm'))) {
        const before = segment.slice(0, value.index), after = segment.slice(value.index + value[0].length);
        if (/(?:\bpitch|点间距|像素间距)\s*(?:[:=]|is|of)?\s*$/iu.test(before) || /^\s*(?:pitch\b|点间距|像素间距)/iu.test(after)
          || (code && start + value.index >= codeEnd
            && /^\s*(?:(?:[:=(]|is|at)\s*){0,2}$/iu.test(before.slice(codeEnd - start)))) explicit.push(parseNumber(value[1]));
      }
      nominalFound ||= !!code && nominal !== undefined && same(mm, nominal);
    }
    const calculated = calculations.some(({ fn, inputs, fact }) => ['pixels', 'pixel_density'].includes(fn)
      && inputs?.pitch_mm !== undefined && same(mm, inputs.pitch_mm)
      && (!label || (nominal !== undefined && same(nominal, mm)) || pitchCode.test(fact.statement) || pitchCode.test(fact.quote)));
    if (explicit.length && label) return explicit.every(value => same(mm, value));
    return explicit.some(value => same(mm, value)) || nominalFound || calculated;
  }
  function barValue(value: number, label: string, unit: string, labels: string[]): boolean {
    const mark = new RegExp(symbol(label), 'iu');
    // Do not take another plotted model's value from a shared fact sentence.
    const marker = new RegExp(labels.slice().sort((a, b) => b.length - a.length).map(symbol).join('|'), 'giu');
    return lines.some(line => [...line.matchAll(measured(unit))].some(match => {
      if (!same(value, parseNumber(match[1]))) return false;
      const markers = [...line.matchAll(marker)];
      // Prefer the preceding label for compact sequences such as A 10 W, B 20 W.
      const nearest = markers.findLast(candidate => candidate.index <= match.index) ?? markers[0];
      return nearest !== undefined && mark.test(nearest[0]);
    })) || calculations.some(({ fn, inputs, result, fact }) => {
      if (!mark.test(fact.statement) && !mark.test(fact.quote)) return false;
      if (!inputs) return false;
      if (unitPattern(unit) === unitPattern('dots/m²') && fn === 'pixel_density' && inputs.pitch_mm > 0) {
        const exact = 1e6 / inputs.pitch_mm ** 2;
        return roundedDensity(value, exact);
      }
      if (unitPattern(unit) === unitPattern('m') && fn === 'feet_to_meters' && inputs.feet > 0) {
        return same(value, inputs.feet * 0.3048);
      }
      return unitPattern(unit) === unitPattern('px') && fn === 'pixels' && inputs.pitch_mm > 0
        && [inputs.width_ft, inputs.height_ft].some(side => side > 0 && same(value, floor(side * 304.8 / inputs.pitch_mm)))
        && [result.width_px, result.height_px].some(pixel => pixel === value);
    });
  }
  return { pair, hasPitch, barValue };
}

function nominalPitch(label: string): number | undefined {
  return /^P\d+(?:\.\d+)?$/i.test(label) ? Number(label.slice(1)) : undefined;
}

function roundedDensity(value: number, exact: number): boolean {
  return same(value, exact) || same(value, Math.trunc(exact * 10_000) / 10_000)
    || [0, 1, 2, 3, 4, 5, 6].some(places => same(value, Number(exact.toFixed(places))));
}

function plan(spec: FigureSpec, facts: readonly Fact[], notes: string[]): FigureLayout | undefined {
  const source = evidence(facts);
  switch (spec.template) {
    case 'grid-sizer': {
      const parsed = schemas[spec.template].safeParse(spec.params);
      if (!parsed.success) break;
      const { target_m: target, options } = parsed.data;
      if (!source.pair(target, 'm')) notes.push('Target dimensions are not supported by the selected facts.');
      const panels = [];
      for (const option of options) {
        const cabinet = option.cabinet_mm;
        const label = typeof option.pitch === 'string' ? option.pitch : undefined;
        const mm = option.pitch_mm ?? (typeof option.pitch === 'number' ? option.pitch : label && nominalPitch(label));
        if (!mm || !pitch.safeParse(mm).success || (typeof option.pitch === 'number' && !same(mm, option.pitch))) {
          notes.push('Each grid option needs a consistent numeric pitch in mm.');
          return;
        }
        if (!source.pair(cabinet, 'mm')) notes.push(`Cabinet ${cabinet.join(' × ')} mm is not supported by the selected facts.`);
        if (!source.hasPitch(mm, label)) notes.push(`Pitch ${label ?? ''} ${mm} mm is not supported by the selected facts.`);
        const cols = floor(target[0] * 1000 / cabinet[0]);
        const rows = floor(target[1] * 1000 / cabinet[1]);
        if (cols < 1 || rows < 1 || cols > 64 || rows > 64 || cols * rows > 1024 || cabinet.some(side => side < mm)) {
          notes.push('The cabinet grid must fit the target and stay within 64 rows/columns and 1,024 cabinets.');
          return;
        }
        panels.push({ cabinet, label, pitch: mm, cols, rows, width: cols * cabinet[0] / 1000, height: rows * cabinet[1] / 1000,
          widthPx: cols * floor(cabinet[0] / mm), heightPx: rows * floor(cabinet[1] / mm) });
      }
      return { kind: spec.template, target, panels };
    }
    case 'bar-compare': {
      const parsed = schemas[spec.template].safeParse(spec.params);
      if (!parsed.success) break;
      const { unit, items } = parsed.data;
      const labels = items.map(item => item.label.normalize('NFKC'));
      if (new Set(labels.map(label => label.toLowerCase())).size !== labels.length) break;
      const density = unitPattern(unit) === unitPattern('dots/m²');
      const bars = [];
      for (const { label: raw, value, pitch_mm } of items) {
        const label = raw.normalize('NFKC');
        const mm = pitch_mm ?? nominalPitch(label);
        const calculated = density && mm !== undefined && pitch.safeParse(mm).success
          && source.hasPitch(mm, label) ? 1e6 / mm ** 2 : undefined;
        const result = value ?? (calculated === undefined ? undefined : Number(calculated.toFixed(4)));
        if (result === undefined) {
          notes.push(`Bar ${label} needs a sourced value or a supported density calculation.`);
          return;
        }
        const matchesCalculation = calculated !== undefined && roundedDensity(result, calculated);
        if (!matchesCalculation && (calculated !== undefined || pitch_mm !== undefined || !source.barValue(result, label, unit, labels))) {
          notes.push(`Bar ${label}: ${result} ${unit} does not match a selected fact or calculation.`);
        }
        bars.push({ label, value: matchesCalculation ? Number(calculated.toFixed(4)) : result, calculated: matchesCalculation });
      }
      return { kind: spec.template, unit, bars };
    }
    case 'layer-stack': {
      const parsed = schemas[spec.template].safeParse(spec.params);
      if (!parsed.success || new Set(parsed.data.columns).size !== parsed.data.columns.length) break;
      return { kind: spec.template, ...parsed.data };
    }
    case 'signal-flow': {
      const parsed = schemas[spec.template].safeParse(spec.params);
      if (!parsed.success) break;
      const { ports, grid: [cols, rows], backup } = parsed.data;
      if (cols * rows > 32 || ports > cols * rows + Number(backup) || (backup && ports < 2)) break;
      return { kind: spec.template, ...parsed.data };
    }
  }
  notes.push(`Invalid ${spec.template} parameters.`);
}

const words = (text: string) => (text.toLowerCase().match(/[a-z0-9]+(?:[.'-][a-z0-9]+)*/g) ?? []);
export function validFigureAlt(text: string): boolean {
  const tokens = words(text);
  return !/^image of\b/i.test(text.trim()) && !/[<>]|[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u.test(text)
    && tokens.length >= 10 && tokens.length <= 18 && tokens.filter(word => /[a-z]/.test(word)).length >= 7
    && tokens.every(word => tokens.filter(token => token === word).length <= 2);
}

function figureText(layout: FigureLayout, spec: FigureSpec, repair: boolean) {
  let alt = spec.alt_en.trim();
  let caption = spec.caption_en.trim();
  switch (layout.kind) {
    case 'grid-sizer': {
      const target = layout.target.map(side => Number(side.toFixed(8))).join(' × ');
      if (repair && !validFigureAlt(alt)) alt = `LED cabinet layout showing whole panels inside a ${target} m target opening`;
      caption = `The ${target} m opening fits ${layout.panels.map(panel => `${panel.cols} × ${panel.rows} cabinets of ${panel.cabinet.join(' × ')} mm`).join(' or ')}, using whole pixels per cabinet. Calculated by Chipshow for planning; verify the model drawing.`;
      break;
    }
    case 'bar-compare': {
      const density = unitPattern(layout.unit) === unitPattern('dots/m²');
      if (repair && !validFigureAlt(alt)) {
        alt = density ? `Horizontal bar chart comparing LED pixel density across display pitches including ${shortLabel(layout.bars[0].label)}`
          : `Horizontal bar chart comparing values in ${layout.unit} across the selected LED display models`;
        if (!validFigureAlt(alt)) alt = 'Horizontal bar chart comparing a common metric across the selected LED display models';
      }
      if (layout.bars.every(bar => bar.calculated)) {
        caption = 'Pixel density is one million divided by the square of the pitch in millimeters, rounded for display. Calculated by Chipshow.';
      }
      break;
    }
    case 'layer-stack':
      alt = `Cross section diagram showing ${layout.columns.join(', ')} LED packaging above a circuit board`;
      caption = '① Circuit board; ② LED chip; ③ package or encapsulant. Source: Chipshow schematic, not to scale.';
      break;
    case 'signal-flow':
      alt = `Schematic of ${shortLabel(layout.source)} signal routing to LED receiving cards ${layout.backup ? 'with a backup return' : 'through a controller'}`;
      if (!validFigureAlt(alt)) alt = `Schematic of LED display signal routing through a controller to receiving cards ${layout.backup ? 'with a backup return' : 'in sequence'}`;
      caption = `Illustrative routing through a controller to receiving cards${layout.backup ? ', with a dashed backup return' : ''}. Source: Chipshow schematic, not to scale.`;
      break;
  }
  return { alt, caption };
}

function captionSource(text: string): boolean {
  return /(?:\bcalculated by\s+[\w-]+|\b(?:source|sources)\s*:\s*\w|\b(?:according to|data from)\s+[\w-]+)/iu.test(text)
    && text.split(/[.!?](?:\s+|$)/u).filter(part => part.trim()).length <= 2;
}

/**
 * Prototype params live under `params`. Grid uses `target_m` and `options[{cabinet_mm,pitch}]`;
 * a pitch can be numeric or a P-code with a separately sourced `pitch_mm` override.
 * Bar uses `unit` and `items[{label,value}]`; for density, `value` may be omitted when
 * the label's numeric pitch (or explicit `pitch_mm`) is supported by the selected facts.
 * Layer uses `columns`; signal uses `source`, `ports`, `grid` [columns, rows], and `backup`.
 */
export async function buildFigure(spec: FigureSpec, facts: readonly Fact[], publishedHashes: string[] = []): Promise<FigureResult> {
  const notes: string[] = [];
  const score: FigureScore = { total: 0, data: 0, render: 0, text: 0, file: 0 };
  const empty = { svg: '', png: Buffer.alloc(0), hash: '', alt_en: spec.alt_en, caption_en: spec.caption_en, score, usable: false, notes };
  const chosen = spec.fact_ids === undefined ? facts : facts.filter(fact => spec.fact_ids?.includes(fact.id));
  for (const id of spec.fact_ids ?? []) if (!chosen.some(fact => fact.id === id)) notes.push(`Unknown figure fact: ${id}.`);
  const layout = plan(spec, chosen, notes);
  if (!layout || notes.length) return empty;
  score.data = 30;
  let browser;
  try {
    browser = await openFigureBrowser();
    const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 1 });
    let proof: FigureProof;
    let svg: string;
    let copy = figureText(layout, spec, false);
    let repaired = false;
    let reflow = false;
    const assess = (candidate: FigureProof) => {
      score.render = candidate.render;
      score.file = candidate.file;
      score.text = (validFigureAlt(copy.alt) ? 15 : 0) + (captionSource(copy.caption) ? 10 : 0);
      score.total = score.data + score.render + score.text + score.file;
    };
    svg = renderFigure(layout, copy.alt);
    proof = await inspectFigure(page, svg, publishedHashes);
    assess(proof);
    if ((score.total >= 60 && score.total < 80) || !validFigureAlt(copy.alt) || proof.render < 25) {
      repaired = true;
      reflow = proof.render < 25;
      copy = figureText(layout, spec, true);
      const revised = renderFigure(layout, copy.alt, reflow);
      if (revised !== svg) {
        svg = revised;
        proof = await inspectFigure(page, svg, publishedHashes);
      }
      assess(proof);
    }
    notes.push(...proof.notes);
    if (!validFigureAlt(copy.alt)) notes.push('ALT must have 10–18 English words without repeated keywords.');
    if (!captionSource(copy.caption)) notes.push('Caption has no explicit source or exceeds two sentences.');
    if (repaired) notes.push('Figure received one automatic repair pass.');
    const labelsUnique = layout.kind !== 'bar-compare' || !reflow
      || new Set(layout.bars.map(bar => shortLabel(bar.label).toLowerCase())).size === layout.bars.length;
    if (!labelsUnique) notes.push('Shortened bar labels would no longer identify distinct items.');
    return { svg, png: proof.png, hash: proof.hash, alt_en: copy.alt, caption_en: copy.caption, score,
      usable: score.total >= 60 && labelsUnique, notes };
  } catch (error) {
    score.total = score.data;
    notes.push(`Figure rendering failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    return empty;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
