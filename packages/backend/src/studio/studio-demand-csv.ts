import { z } from 'zod';

export class CsvParseError extends Error {
  readonly code = 'CSV_SYNTAX';
  readonly line: number;
  constructor(line: number) {
    super('CSV 格式错误，请检查引号与分隔符。');
    this.line = line;
  }
}

/** CSV syntax only; line is the physical start line, including quoted newlines. */
export function readCsv(text: string): { headers: string[]; rows: { line: number; values: string[] }[] } {
  const input = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const records: { line: number; values: string[] }[] = [];
  let line = 1, startLine = 1, value = '';
  let values: string[] = [];
  let mode: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  let started = false;
  const finish = () => {
    // Ignore empty physical lines after the header, but keep explicitly empty cells.
    if (started || values.length || records.length === 0) records.push({ line: startLine, values: [...values, value] });
    value = ''; values = []; mode = 'start'; started = false;
  };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const newline = char === '\r' || char === '\n';
    if (mode === 'quoted') {
      if (char === '"') {
        if (input[i + 1] === '"') { value += '"'; i++; }
        else mode = 'closed';
      } else {
        value += char;
        if (newline) {
          if (char === '\r' && input[i + 1] === '\n') { value += '\n'; i++; }
          line++;
        }
      }
    } else if (newline) {
      finish();
      if (char === '\r' && input[i + 1] === '\n') i++;
      line++; startLine = line;
    } else if (char === ',') {
      values.push(value); value = ''; mode = 'start'; started = true;
    } else if (char === '"') {
      if (mode !== 'start') throw new CsvParseError(line);
      mode = 'quoted'; started = true;
    } else {
      if (mode === 'closed') throw new CsvParseError(line);
      value += char; mode = 'plain'; started = true;
    }
  }
  if (mode === 'quoted') throw new CsvParseError(line);
  if (started || values.length) finish();
  const [header, ...rows] = records;
  return { headers: header?.values ?? [], rows };
}

export const demandCsvFields = ['week', 'region', 'channel', 'role', 'product_direction', 'scenario', 'need_tags', 'question_rewrite', 'grade'] as const;
export const demandCsvOptions = {
  region: ['中非拉美', '欧洲', '亚太', '北美', '其他', '未知'],
  channel: ['Facebook', 'WhatsApp', '网站', 'MIC', '邮件', 'ChatGPT', '其他', '未知'],
  role: ['集成商/安装商/招牌制作商', '分销商/代理商', '终端业主/广告媒体主', '租赁公司/政府与交通', '未知'],
  grade: ['A', 'B', 'C', '未知'],
} as const;
export const demandCsvLimits = { bytes: 2 * 1024 * 1024, rows: 5000, shortText: 120, question: 600, tags: 12, tagLength: 40 } as const;

function isoWeek(value: string): boolean {
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match || Number(match[1]) < 1900 || Number(match[1]) > 9999) return false;
  const year = Number(match[1]), week = Number(match[2]);
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return week >= 1 && week <= (jan1 === 4 || (jan1 === 3 && leap) ? 53 : 52);
}

const requiredText = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0);
const demandRecord = z.object({
  week: z.string().refine(isoWeek),
  region: z.enum(demandCsvOptions.region),
  channel: z.enum(demandCsvOptions.channel),
  role: z.enum(demandCsvOptions.role),
  product_direction: requiredText(demandCsvLimits.shortText),
  scenario: requiredText(demandCsvLimits.shortText),
  need_tags: z.array(requiredText(demandCsvLimits.tagLength).refine(value => value === value.trim()))
    .min(1).max(demandCsvLimits.tags).refine(tags => new Set(tags).size === tags.length),
  question_rewrite: requiredText(demandCsvLimits.question),
  grade: z.enum(demandCsvOptions.grade),
}).strict();
export type DemandRecord = z.infer<typeof demandRecord>;
type DemandField = typeof demandCsvFields[number];
export type DemandCsvIssue = {
  row: number;
  field: DemandField | '_csv' | '_header' | '_row';
  code: 'CSV_SYNTAX' | 'EMPTY_CSV' | 'TOO_LARGE' | 'TOO_MANY_ROWS' | 'MISSING_COLUMN' | 'UNEXPECTED_COLUMN'
    | 'DUPLICATE_COLUMN' | 'COLUMN_COUNT' | 'REQUIRED' | 'INVALID_ENUM' | 'INVALID_WEEK' | 'INVALID_TAGS'
    | 'TOO_LONG' | 'CONTROL_CHARACTER' | 'PII_EMAIL' | 'PII_PHONE' | 'PII_URL';
};
export type DemandCsvResult = { ok: true; records: DemandRecord[] } | { ok: false; errors: DemandCsvIssue[] };

export function piiCode(value: string): DemandCsvIssue['code'] | null {
  // Detection normalization never changes the stored value. Reject, never redact.
  const text = value.normalize('NFKC');
  if (/[\p{L}\p{N}._%+-]+\s*@\s*[\p{L}\p{N}.-]+/u.test(text)) return 'PII_EMAIL';
  if (/(?:https?|ftp):\/\/|\b(?:mailto|tel):|\bwww\.|(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[\p{L}]{2,63}(?=$|[^\p{L}\p{N}_-])|\b(?:\d{1,3}\.){3}\d{1,3}\b/iu.test(text)) return 'PII_URL';
  // Ignore complete week/unit-range tokens only in the detection view. This
  // prevents adjacent technical values from being joined into a phone number;
  // another number in the same cell must still be checked.
  const phoneText = text.replace(/\b\d{4}-W\d{2}\b/g, week => isoWeek(week) ? '#' : week)
    .replace(/(?<![+\d-])\b\d{1,4}\s*[-\u2010-\u2015]\s*\d{1,4}\s*(?:VAC|VDC|V|W|Hz|mm|cm)\b/gi, '#');
  if (/(?:\+|00)?\d(?:[\s().\-\u2010-\u2015]*\d){6,}/u.test(phoneText)) return 'PII_PHONE';
  return null;
}

/** Strict inquiry schema on top of readCsv. Errors contain locations/codes only. */
export function parseDemandCsv(csv: string): DemandCsvResult {
  if (typeof csv !== 'string') return { ok: false, errors: [{ row: 1, field: '_csv', code: 'EMPTY_CSV' }] };
  if (Buffer.byteLength(csv, 'utf8') > demandCsvLimits.bytes) return { ok: false, errors: [{ row: 1, field: '_csv', code: 'TOO_LARGE' }] };
  let parsed: ReturnType<typeof readCsv>;
  try { parsed = readCsv(csv); }
  catch (error) {
    if (!(error instanceof CsvParseError)) throw error;
    return { ok: false, errors: [{ row: error.line, field: '_csv', code: error.code }] };
  }
  const errors: DemandCsvIssue[] = [];
  const { headers, rows } = parsed;
  for (const name of demandCsvFields) {
    if (!headers.includes(name)) errors.push({ row: 1, field: name, code: 'MISSING_COLUMN' });
  }
  const seen = new Set<string>();
  for (const name of headers) {
    const field = demandCsvFields.find(field => field === name);
    if (!field) errors.push({ row: 1, field: '_header', code: 'UNEXPECTED_COLUMN' });
    else if (seen.has(name)) errors.push({ row: 1, field, code: 'DUPLICATE_COLUMN' });
    seen.add(name);
    const code = piiCode(name);
    if (code) errors.push({ row: 1, field: field ?? '_header', code });
  }
  if (!rows.length) errors.push({ row: 1, field: '_csv', code: 'EMPTY_CSV' });
  if (rows.length > demandCsvLimits.rows) return { ok: false, errors: [...errors, { row: rows[demandCsvLimits.rows].line, field: '_csv', code: 'TOO_MANY_ROWS' }] };
  const invalidHeaders = errors.length > 0;
  const records: DemandRecord[] = [];
  for (const row of rows) {
    if (row.values.length !== headers.length) errors.push({ row: row.line, field: '_row', code: 'COLUMN_COUNT' });
    row.values.forEach((value, index) => {
      const field = demandCsvFields.find(field => field === headers[index]) ?? '_row';
      const code = piiCode(value);
      if (code) errors.push({ row: row.line, field, code });
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) errors.push({ row: row.line, field, code: 'CONTROL_CHARACTER' });
    });
    if (invalidHeaders || row.values.length !== headers.length) continue;
    const candidate = Object.fromEntries(headers.map((field, index) => [field, field === 'need_tags' ? row.values[index].split('|') : row.values[index]]));
    const result = demandRecord.safeParse(candidate);
    if (result.success) records.push(result.data);
    else for (const issue of result.error.issues) {
      const field = demandCsvFields.find(field => field === issue.path[0]) ?? '_row';
      const code = issue.code === 'too_big' ? 'TOO_LONG'
        : field === 'week' ? 'INVALID_WEEK'
        : field === 'need_tags' ? 'INVALID_TAGS'
        : ['region', 'channel', 'role', 'grade'].includes(field) ? 'INVALID_ENUM' : 'REQUIRED';
      errors.push({ row: row.line, field, code });
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, records };
}

// Synthetic examples only. No original filename or customer material is retained.
export const demandCsvTemplate = '\uFEFF' + demandCsvFields.join(',') + '\r\n'
  + '2026-W45,欧洲,网站,集成商/安装商/招牌制作商,户外LED显示屏,户外招牌,系统配套与安装|交付与运输,安装前需要核对哪些配套条件？,A\r\n'
  + '2026-W45,未知,其他,未知,LED显示屏,室内商显,选型,怎样按使用场景选择显示方案？,未知\r\n';
