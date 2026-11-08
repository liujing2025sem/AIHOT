import { load } from 'cheerio';
import sanitizeHtml from 'sanitize-html';

export type Paragraph = { id: string; html: string; text: string };
export type Fact = {
  id: string;
  kind: 'page' | 'source' | 'calc' | 'engineer';
  statement: string;
  quote: string;
  article_id?: string;
  revision?: number;
  date?: string | null;
  attribution: string;
  url?: string;
  calculation?: unknown;
};
export type CalculationName = 'pixels' | 'feet_to_meters' | 'aspect_ratio';
export type Subquestion = {
  id: string;
  zh: string;
  en: string;
  need: 'page' | 'reference' | 'calc' | 'company' | 'news';
  answer_shape: 'number' | 'table' | 'definition' | 'steps';
  terms: string[];
  calculation?: { fn: CalculationName; inputs: Record<string, number>; basis: string };
};
export type EvidenceMaterial = { id: string; body_text?: string | null };
export type EvidenceSentence = { article_id: string; quote: string; context: { before: string | null; after: string | null }; score: number };
export type EditOperation = {
  op: 'keep' | 'revise' | 'insert_after';
  paragraph: string;
  subquestion?: string;
  reason?: string;
  heading?: string;
  facts?: string[];
};
export type FragmentContent = { html_en: string; zh_review: string; used_facts: string[] };
export type Fragment = { op_index: number; receipt_id?: number } & (
  | (FragmentContent & { status?: 'done' })
  | (Partial<FragmentContent> & { status: 'unknown' | 'failed' })
);
export type FragmentDiff = {
  op_index: number;
  op: EditOperation['op'];
  paragraph: string;
  before: string;
  after: string;
  status: 'done' | 'pending' | 'unknown' | 'failed';
};

const BLOCKS = 'address,article,aside,blockquote,dd,div,dl,dt,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,tbody,td,th,tr,ul';
const blockTags = new Set(BLOCKS.split(','));
const wrappers = new Set(['article', 'aside', 'div', 'main', 'section']);
const ordinal = /^(?:#{1,6}[ \t]+)?[ \t]*(?:(?:section|step|chapter|part)\s+\d+\s*[:.、)）-]\s*|第\s*\d+\s*[章节步部分]\s*[:：.、]?\s*|\d+[.)、）][ \t]+|[（(]\d+[)）][ \t]*)/iu;

function visibleText(html: string, ignoreOrdinals = false): string {
  const $ = load(html, {}, false);
  $('script,style,template').remove();
  if (ignoreOrdinals) {
    $('h1,h2,h3,h4,h5,h6,li').each((_, el) => {
      const text = $(el).text();
      $(el).text(text.replace(ordinal, ''));
    });
  }
  $('br').replaceWith('\n');
  $(BLOCKS).before('\n').after('\n');
  const text = $.root().text();
  return (ignoreOrdinals ? text.split(/\r?\n/u).map(line => line.replace(ordinal, '')).join('\n') : text)
    .replace(/[^\S\r\n]+/gu, ' ').trim();
}

function topNodes(html: string) {
  const $ = load(html, { sourceCodeLocationInfo: true }, false);
  return $.root().contents().toArray().flatMap(node => {
    const loc = node.sourceCodeLocation;
    if (!loc || node.type === 'comment' || node.type === 'directive' || (node.type === 'text' && !node.data.trim())) return [];
    return [{ node, loc }];
  }).sort((a, b) => a.loc.startOffset - b.loc.startOffset || b.loc.endOffset - a.loc.endOffset);
}

/** Use parser offsets only. Serializing the DOM would rewrite entities, whitespace and tables. */
export function splitPage(html: string): Paragraph[] {
  if (!html) return [];
  const starts = [0];
  let coveredUntil = 0;
  let previousBlock = false;
  let seen = false;
  for (const { node, loc } of topNodes(html)) {
    // HTML recovery can move a text node out of a table while its bytes still belong to that table.
    if (loc.startOffset < coveredUntil) continue;
    const block = 'name' in node && blockTags.has(node.name);
    if (seen && (block || previousBlock)) starts.push(loc.startOffset);
    coveredUntil = loc.endOffset;
    previousBlock = block;
    seen = true;
  }
  return starts.map((start, index) => {
    const original = html.slice(start, starts[index + 1]);
    return { id: 'p' + (index + 1), html: original, text: visibleText(original) };
  });
}

const UNIT_GROUPS = [
  ['mm', 'length', 1, 'mm|millimet(?:er|re)s?|毫米'],
  ['cm', 'length', 10, 'cm|centimet(?:er|re)s?|厘米|公分'],
  ['m', 'length', 1000, 'm|met(?:er|re)s?|米'],
  ['km', 'length', 1_000_000, 'km|kilomet(?:er|re)s?|千米|公里'],
  ['ft', 'length', 304.8, "ft|feet|foot|英尺|英呎|[′']"],
  ['in', 'length', 25.4, 'in\\.(?!\\w)|inches|inch|英寸|英吋|[″"]'],
  ['in', 'length', 25.4, 'in(?=[ \\t]*(?:$|[.,;:!?)×x–—，。；：]))'],
  ['m2', 'area', 1, 'm\\s*(?:\\^2|2)|square met(?:er|re)s?|平方米'],
  ['ft2', 'area', 0.09290304, 'ft\\s*(?:\\^2|2)|sq\\.?\\s*ft|square (?:feet|foot)|平方英尺'],
  ['px', 'pixels', 1, 'px|pixels?|像素点?'],
  ['%', 'percent', 1, '%|percent|per cent'],
  ['cd/m2', 'luminance', 1, 'cd\\s*/\\s*m\\s*(?:\\^2|2)|nits?|尼特'],
  ['V', 'voltage', 1, 'volts?|v(?:ac|dc)?|伏特?'],
  ['A', 'current', 1, 'amperes?|amps?|a|安培'],
  ['W', 'power', 1, 'watts?|w|瓦特?'],
  ['kW', 'power', 1000, 'kilowatts?|kw|千瓦'],
  ['Hz', 'frequency', 1, 'hertz|hz|赫兹'],
  ['kHz', 'frequency', 1000, 'khz|千赫兹?'],
  ['kg', 'mass', 1, 'kg|kilograms?|千克|公斤'],
  ['g', 'mass', 0.001, 'grams?|g|克'],
  ['lb', 'mass', 0.45359237, 'lbs?|pounds?|磅'],
  ['°C', 'temperatureC', 1, '°\\s*c|degrees? celsius|摄氏度'],
  ['°F', 'temperatureF', 1, '°\\s*f|degrees? fahrenheit|华氏度'],
  ['°', 'angle', 1, '°|degrees?|度'],
  ['ms', 'time', 0.001, 'ms|milliseconds?|毫秒'],
  ['s', 'time', 1, 'seconds?|secs?|s|秒'],
  ['min', 'time', 60, 'minutes?|mins?|分钟'],
  ['h', 'time', 3600, 'hours?|hrs?|h|小时'],
] as const;
type Unit = { name: string; dimension: string; factor: number };
const unitMatchers = UNIT_GROUPS.map(([name, dimension, factor, aliases]) => ({
  name, dimension, factor, match: new RegExp('^[ \\t]*(?:' + aliases + ')(?![a-z0-9_])', 'iu'),
})).sort((a, b) => Number(b.dimension === 'area') - Number(a.dimension === 'area'));
const pitchUnit: Unit = { name: 'mm', dimension: 'length', factor: 1 };
const percentUnit: Unit = { name: '%', dimension: 'percent', factor: 1 };
const numeral = String.raw`(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)`;
const numericPattern = new RegExp(
  String.raw`(?:\d+(?:\.\d+)?[ \t]*:[ \t]*\d+(?:\.\d+)?|(?:(?<![a-z0-9])p|(?<!\d)[+−-])?` + numeral + ')', 'giu',
);
type Quantity = { raw: string; value: number; unit?: Unit; decimals: number; start: number; end: number };
const ratioUnit: Unit = { name: 'ratio', dimension: 'ratio', factor: 1 };

function quantities(input: string): Quantity[] {
  const text = input.normalize('NFKC').replace(/(?:https?:\/\/|www\.)[^\s<>"，。]+/giu, ' ');
  const found: Quantity[] = [];
  for (const match of text.matchAll(numericPattern)) {
    const start = match.index;
    if (start < (found.at(-1)?.end ?? 0)) continue;
    const literal = match[0];
    const isPitch = /^p/i.test(literal);
    const [a, b] = literal.split(':').map(part => part.trim().replace(/,|^p/gi, '').replace('−', '-'));
    let end = start + literal.length;
    let unit = b !== undefined ? ratioUnit : isPitch ? pitchUnit : undefined;
    let from = start;
    if (!unit && text.slice(0, start).endsWith('百分之')) {
      unit = percentUnit;
      from -= 3;
    }
    if (!unit) {
      for (const candidate of unitMatchers) {
        const suffix = candidate.match.exec(text.slice(end));
        if (!suffix) continue;
        unit = candidate;
        end += suffix[0].length;
        break;
      }
    }
    found.push({ raw: text.slice(from, end), value: b === undefined ? Number(a) : Number(a) / Number(b),
      unit, decimals: a.split('.')[1]?.length ?? 0, start: from, end });
  }
  // A trailing unit also applies to the preceding sides/endpoints in "48 × 14 ft" and "12–24 V".
  for (let i = found.length - 2; i >= 0; i--) {
    const current = found[i], next = found[i + 1];
    if (!current.unit && next.unit && next.unit !== ratioUnit
      && /^[ \t]*(?:×|x|[-–—~]|to|至|到)[ \t]*$/iu.test(text.slice(current.end, next.start))) current.unit = next.unit;
  }
  return found;
}

function matchesQuantity(claim: Quantity, basis: Quantity): boolean {
  if (!Number.isFinite(claim.value) || !Number.isFinite(basis.value) || claim.unit?.dimension !== basis.unit?.dimension) return false;
  const claimFactor = claim.unit?.factor ?? 1;
  const expected = basis.value * (basis.unit?.factor ?? 1) / claimFactor;
  const epsilon = Number.EPSILON * 8 * Math.max(Math.abs(claim.value), Math.abs(expected), 1);
  const rounding = claim.unit?.name !== basis.unit?.name && claim.decimals > 0 ? 0.5 * 10 ** -claim.decimals : 0;
  return Math.abs(claim.value - expected) <= epsilon + rounding;
}

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
function sentences(body: string): string[] {
  return body.split(/\r?\n/u).flatMap(line => [...segmenter.segment(line)].map(({ segment }) => segment.trim()).filter(Boolean));
}
const normalizeTerm = (text: string) => text.normalize('NFKC').toLowerCase()
  .replace(/(?<=\d)\s*[x×]\s*(?=\d)/gu, ' x ').trim().replace(/\s+/gu, ' ');
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function termPattern(term: string): RegExp {
  const left = /^[a-z0-9]/u.test(term) ? '(?<![a-z0-9_])' : '';
  const right = /[a-z0-9]$/u.test(term) ? '(?![a-z0-9_]|\\.\\d)' : '';
  const plural = /(?:^| )[a-z]{3,}(?<!s)$/u.test(term) ? '(?:s|es)?' : '';
  return new RegExp(left + escapeRegex(term) + plural + right, 'gu');
}

function answerShape(shape: Subquestion['answer_shape'], sentence: string): boolean {
  const text = sentence.normalize('NFKC');
  switch (shape) {
    case 'number':
      return quantities(text).some(q => q.unit && !/^p/iu.test(q.raw) && Number.isFinite(q.value));
    case 'table':
      return text.split(/\t+|\|/u).filter(cell => cell.trim()).length >= 3;
    case 'definition':
      return /\b(?:means?|refers? to|is defined as)\b|\b(?:is|are) (?:an?|the) (?=[a-z])|是指|指的是|定义为/iu.test(text);
    case 'steps':
      return /\b(?:step\s+\d+|then|followed by)\b|\b(?:first|next),|^(?:check|measure|confirm|verify|select|contact|calculate|install|identify|divide|multiply)\b|先.{1,80}再|首先|然后|接着|步骤\s*\d+/iu.test(text);
  }
}

export function answerEvidence(subquestions: readonly Subquestion[], materials: readonly EvidenceMaterial[]): {
  by_question: Record<string, EvidenceSentence[]>;
  weak_material_ids: string[];
} {
  const docs = materials.map(material => ({ id: material.id, sentences: sentences(material.body_text ?? '') }));
  const terms = subquestions.map(question => new Set(question.terms.map(normalizeTerm).filter(Boolean)));
  const owners = new Map<string, number>();
  for (const own of terms) for (const term of own) owners.set(term, (owners.get(term) ?? 0) + 1);
  const strong = new Set<string>();
  const by_question = Object.fromEntries(subquestions.map((question, qIndex) => {
    const patterns = [...terms[qIndex]].filter(term => owners.get(term) === 1).sort((a, b) => b.length - a.length).map(termPattern);
    const hits: EvidenceSentence[] = [];
    if (patterns.length >= 2) for (const doc of docs) {
      doc.sentences.forEach((sentence, index) => {
        const normalized = normalizeTerm(sentence);
        const spans: { start: number; end: number }[] = [];
        for (const pattern of patterns) {
          const occurrence = [...normalized.matchAll(pattern)].find(match =>
            spans.every(span => span.end <= match.index || span.start >= match.index + match[0].length));
          if (occurrence) spans.push({ start: occurrence.index, end: occurrence.index + occurrence[0].length });
        }
        if (spans.length < 2 || !answerShape(question.answer_shape, sentence)) return;
        strong.add(doc.id);
        hits.push({ article_id: doc.id, quote: sentence, score: spans.length,
          context: { before: doc.sentences[index - 1] ?? null, after: doc.sentences[index + 1] ?? null },
        });
      });
    }
    return [question.id, hits.sort((a, b) => b.score - a.score).slice(0, 2)];
  }));
  return { by_question, weak_material_ids: [...new Set(docs.map(doc => doc.id))].filter(id => !strong.has(id)) };
}

type CalculationResults = {
  pixels: { width_px: number; height_px: number };
  feet_to_meters: { meters: number };
  aspect_ratio: { ratio: number };
};
type Calculated<R> = Pick<Fact, 'statement' | 'quote' | 'attribution'> & {
  result: R;
  calculation: { fn: CalculationName; inputs: Record<string, number>; formula: string; result: R };
  fact: Fact;
};

export function calculateFact<F extends CalculationName>(fn: F, inputs: Readonly<Record<string, number>>): Calculated<CalculationResults[F]>;
export function calculateFact(fn: CalculationName, inputs: Readonly<Record<string, number>>): Calculated<CalculationResults[CalculationName]> {
  function read(key: string) {
    const value = inputs[key];
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(key + ' must be a finite positive number.');
    return value;
  }
  function calculated<R extends CalculationResults[CalculationName]>(values: Record<string, number>, result: R, formula: string, statement: string): Calculated<R> {
    if (Object.values(result).some(value => !Number.isFinite(value))) throw new RangeError(fn + ' result is not finite.');
    const details = { statement, quote: statement.slice(0, 300), attribution: 'Code calculation',
      calculation: { fn, inputs: values, formula, result },
    };
    return { result, ...details, fact: { id: 'calc:' + fn + ':' + Object.values(values).join(':'), kind: 'calc', ...details } };
  }
  switch (fn) {
    case 'pixels': {
      const width_ft = read('width_ft'), height_ft = read('height_ft'), pitch_mm = read('pitch_mm');
      const width_px = Math.floor(width_ft * 304.8 / pitch_mm), height_px = Math.floor(height_ft * 304.8 / pitch_mm);
      return calculated({ width_ft, height_ft, pitch_mm }, { width_px, height_px },
        'floor(side_ft * 304.8 / pitch_mm) for each side',
        width_ft + ' × ' + height_ft + ' ft at ' + pitch_mm + ' mm pitch yields ' + width_px + ' × ' + height_px + ' pixels.');
    }
    case 'feet_to_meters': {
      const feet = read('feet'), meters = feet * 0.3048;
      return calculated({ feet }, { meters }, 'feet * 0.3048', feet + ' ft = ' + meters + ' m.');
    }
    case 'aspect_ratio': {
      const width = read('width'), height = read('height'), ratio = width / height;
      return calculated({ width, height }, { ratio }, 'width / height (same input unit)',
        'Width ' + width + ' and height ' + height + ' give an aspect ratio of ' + width + ':' + height + '.');
    }
  }
}

export function validateEditPlan(paragraphs: readonly Paragraph[], plan: readonly EditOperation[], subquestions: readonly Subquestion[], facts: readonly Fact[]): string[] {
  const ids = new Set(paragraphs.map(paragraph => paragraph.id));
  const questions = new Set(subquestions.map(question => question.id));
  const factIds = new Set(facts.map(fact => fact.id));
  const covered = new Set<string>();
  const revised = new Set<string>();
  const errors: string[] = [];
  plan.forEach((op, index) => {
    const label = '操作 ' + (index + 1) + '（' + op.paragraph + '）';
    if (!ids.has(op.paragraph) && !(paragraphs.length === 0 && op.op === 'insert_after' && op.paragraph === 'start')) {
      errors.push(label + '：找不到目标段落。');
    }
    if (op.op !== 'insert_after') {
      if (covered.has(op.paragraph)) errors.push(label + '：同一段只能有一次 keep 或 revise。');
      covered.add(op.paragraph);
      if (op.op === 'revise') revised.add(op.paragraph);
    }
    if (op.op === 'keep') return;
    if (!op.subquestion || !questions.has(op.subquestion)) errors.push(label + '：必须关联一个有效的买家子问题。');
    if (!op.reason?.trim()) errors.push(label + '：缺少改动理由。');
    if ((op.facts?.length ?? 0) > 6) errors.push(label + '：最多可使用 6 条事实。');
    for (const id of op.facts ?? []) if (!factIds.has(id)) errors.push(label + '：找不到事实 ' + id + '。');
  });
  for (const id of ids) if (!covered.has(id)) errors.push(id + '：缺少 keep 或 revise。');
  if (revised.size * 10 > paragraphs.length * 3) errors.push('改写 ' + revised.size + '/' + paragraphs.length + ' 段，超过 30% 上限。');
  return errors;
}

const safeTags = new Set('p h2 h3 h4 h5 h6 ul ol li dl dt dd blockquote table caption thead tbody tfoot tr th td strong em b i u s del mark sup sub code pre span a br hr'.split(' '));
const voidTags = new Set(['br', 'hr']);
function safeFragment(html: string): boolean {
  const stack: string[] = [];
  // Check the raw closing tags too: a browser may apply a stray close tag to the old page.
  const markup = /<!--|<!|<\?|<\/?([a-z][a-z0-9:-]*)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>|<\/?[a-z]/giu;
  for (const match of html.matchAll(markup)) {
    const tag = match[1]?.toLowerCase();
    if (!tag || !safeTags.has(tag)) return false;
    if (match[0].startsWith('</')) {
      if (!new RegExp('^</' + tag + '\\s*>$', 'iu').test(match[0]) || stack.pop() !== tag) return false;
    } else if (!voidTags.has(tag)) {
      if (/\/>$/u.test(match[0])) return false;
      stack.push(tag);
    }
  }
  if (stack.length) return false;
  let safe = true;
  sanitizeHtml(html, {
    allowedTags: [...safeTags],
    onOpenTag(tag, attributes) {
      for (const [name, value] of Object.entries(attributes)) {
        const allowed = (tag === 'a' && name === 'href'
          && /^(?:https?:\/\/|\/(?![\\/])|#)[^\x00-\x20\x7f\\]*$/iu.test(value))
          || (/^[1-9]\d*$/u.test(value) && (
            ((tag === 'td' || tag === 'th') && /^(?:colspan|rowspan)$/u.test(name))
            || (tag === 'ol' && name === 'start') || (tag === 'li' && name === 'value')
          ));
        if (!allowed) safe = false;
      }
    },
  });
  return safe;
}

function factQuantities(facts: readonly Fact[]): Quantity[] {
  return facts.flatMap(fact => [fact.statement, fact.quote].flatMap(text => quantities(visibleText(text, true))));
}

function unsupported(text: string, allowed: readonly Quantity[]): string[] {
  return [...new Set(quantities(visibleText(text, true))
    .filter(claim => !allowed.some(basis => matchesQuantity(claim, basis))).map(claim => claim.raw))];
}

export function validateFragment(op: EditOperation, fragment: FragmentContent, facts: readonly Fact[], paragraphs: readonly Paragraph[]): string[] {
  const errors: string[] = [];
  const label = op.paragraph || '新增节';
  const supplied = new Set(op.facts ?? []);
  const used = new Set(fragment.used_facts);
  const factIds = new Set(facts.map(fact => fact.id));
  if (op.op === 'keep') errors.push(label + '：保留段无需生成片段。');
  if (fragment.used_facts.length > 6) errors.push(label + '：最多可使用 6 条事实。');
  for (const id of used) if (!supplied.has(id) || !factIds.has(id)) errors.push(label + '：事实 ' + id + ' 不在本片段的可用范围内。');
  const english = visibleText(fragment.html_en);
  const chinese = visibleText(fragment.zh_review);
  if (!english || !chinese) errors.push(label + '：英文片段和中文审校稿都必须有正文。');
  if (!safeFragment(fragment.html_en) || !safeFragment(fragment.zh_review)) errors.push(label + '：片段含不安全的 HTML 或未闭合的标签。');
  if (op.op === 'revise') {
    const original = paragraphs.find(paragraph => paragraph.id === op.paragraph);
    if (!original) errors.push(label + '：找不到要改写的原段落。');
    else {
      const length = (text: string) => [...text.replace(/\s+/gu, ' ')].length;
      for (const [language, text] of [['英文', english], ['中文', chinese]]) {
        if (length(text) > 2 * length(original.text)) errors.push(label + '：改写的' + language + '正文超过原段长度的 2 倍。');
      }
    }
  }
  if (op.op === 'insert_after' && (english.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0) > 250) {
    errors.push(label + '：新增一节超过 250 英文词。');
  }
  const allowed = factQuantities(facts.filter(fact => supplied.has(fact.id) && used.has(fact.id)));
  for (const [language, text] of [['英文', fragment.html_en], ['中文', fragment.zh_review]]) {
    for (const value of unsupported(text, allowed)) errors.push(label + '：' + language + '数字「' + value + '」没有所用事实支持。');
  }
  return errors;
}

function reviseHtml(original: string, changed: string): string {
  const nodes = topNodes(original);
  const first = nodes[0], last = nodes.at(-1);
  if (!first || !last) return changed;
  if (first === last && 'name' in first.node && wrappers.has(first.node.name)
    && 'startTag' in first.loc && 'endTag' in first.loc && first.loc.startTag && first.loc.endTag) {
    return original.slice(0, first.loc.startTag.endOffset) + changed + original.slice(first.loc.endTag.startOffset);
  }
  return original.slice(0, first.loc.startOffset) + changed + original.slice(last.loc.endOffset);
}

/** Preview in original page order; pending revisions retain the source until their fragment is ready. */
export function assembleFragments(paragraphs: readonly Paragraph[], plan: readonly EditOperation[], fragments: readonly Fragment[]): {
  html_en: string; diff: FragmentDiff[]; complete: boolean;
} {
  const byOp = new Map(fragments.map(fragment => [fragment.op_index, fragment]));
  const diff: FragmentDiff[] = [];
  function apply(op: EditOperation, index: number, before: string): string {
    const fragment = byOp.get(index);
    const ready = fragment && (fragment.status === undefined || fragment.status === 'done') && fragment.html_en.trim();
    const status = op.op === 'keep' || ready ? 'done'
      : fragment?.status === 'failed' || fragment?.status === 'unknown' ? fragment.status : 'pending';
    const after = ready && op.op !== 'keep'
      ? op.op === 'revise' ? reviseHtml(before, fragment.html_en) : fragment.html_en
      : before;
    diff.push({ op_index: index, op: op.op, paragraph: op.paragraph, before, after, status });
    return after;
  }
  const byParagraph = new Map<string, { op: EditOperation; index: number }[]>();
  plan.forEach((op, index) => {
    const entries = byParagraph.get(op.paragraph) ?? [];
    entries.push({ op, index });
    byParagraph.set(op.paragraph, entries);
  });
  function inserts(entries: { op: EditOperation; index: number }[]) {
    return entries.filter(({ op }) => op.op === 'insert_after').map(({ op, index }) => apply(op, index, '')).join('');
  }
  let html = '';
  for (const paragraph of paragraphs) {
    const entries = byParagraph.get(paragraph.id) ?? [];
    const base = entries.find(({ op }) => op.op !== 'insert_after');
    html += (base ? apply(base.op, base.index, paragraph.html) : paragraph.html) + inserts(entries);
  }
  if (!paragraphs.length) html = inserts(byParagraph.get('start') ?? []);
  const complete = diff.length === plan.length && diff.every(row => row.status === 'done')
    && diff.filter(row => row.op !== 'insert_after').length === paragraphs.length;
  return { html_en: html, diff, complete };
}
