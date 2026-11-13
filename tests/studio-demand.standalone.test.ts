import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { closeDb } from '../packages/backend/src/db.ts';
import { CsvParseError, demandCsvFields, demandCsvLimits, demandCsvOptions, demandCsvTemplate, parseDemandCsv, readCsv,
  type DemandCsvIssue, type DemandRecord } from '../packages/backend/src/studio/studio-demand-csv.ts';
import { DemandCsvError, describeWritingProfile, importDemandCsv, summarizeDemandSignals } from '../packages/backend/src/studio/studio-demand.ts';

after(closeDb);
const synthetic = { week: '2026-W45', region: '欧洲', channel: '网站', role: '集成商/安装商/招牌制作商',
  product_direction: '户外LED显示屏', scenario: '户外招牌', need_tags: ['系统配套与安装', '交付与运输'],
  question_rewrite: '安装前需要核对哪些配套条件？', grade: 'A' } satisfies DemandRecord;
function cell(value: string) { return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value; }
function csv(rows: Record<string, unknown>[] = [synthetic], headers: readonly string[] = demandCsvFields) {
  return headers.join(',') + '\r\n' + rows.map(row => headers.map(field => cell(Array.isArray(row[field])
    ? row[field].join('|') : String(row[field] ?? ''))).join(',')).join('\r\n');
}
function issues(text: string): DemandCsvIssue[] {
  const parsed = parseDemandCsv(text);
  assert.equal(parsed.ok, false);
  if (parsed.ok) throw new Error('expected invalid synthetic fixture');
  assert.deepEqual(Object.keys(parsed), ['ok', 'errors'], 'invalid batches never return partial records');
  for (const error of parsed.errors) assert.deepEqual(Object.keys(error), ['row', 'field', 'code']);
  return parsed.errors;
}

test('shared CSV reader handles BOM, escaping, commas, CRLF and multiline physical row numbers without rewriting values', () => {
  assert.deepEqual(readCsv('\uFEFFa,b\r\n"one,two","say ""yes""\r\nnext"\r\n\r\nplain, value \n'), {
    headers: ['a', 'b'], rows: [
      { line: 2, values: ['one,two', 'say "yes"\r\nnext'] }, { line: 5, values: ['plain', ' value '] },
    ],
  });
  assert.deepEqual(readCsv('a,b\r1,2\r3,4'), { headers: ['a', 'b'], rows: [{ line: 2, values: ['1', '2'] }, { line: 3, values: ['3', '4'] }] });
  assert.deepEqual(readCsv(''), { headers: [], rows: [] });
  assert.deepEqual(readCsv('a,b\n"",'), { headers: ['a', 'b'], rows: [{ line: 2, values: ['', ''] }] });
});

test('shared CSV reader rejects malformed quotes with safe line-only errors', () => {
  for (const value of ['a\n"open', 'a\nx"y', 'a\n"closed"oops', 'a\n"closed" "extra"']) {
    assert.throws(() => readCsv(value), error => error instanceof CsvParseError && error.line === 2
      && !JSON.stringify(error).includes('oops') && !error.message.includes('open'));
    assert.ok(issues(value).some(error => error.code === 'CSV_SYNTAX'));
  }
});

test('synthetic template and reordered headers parse all nine strict fields, explicit fallback enums and ISO week boundaries', () => {
  const template = parseDemandCsv(demandCsvTemplate);
  assert.ok(template.ok);
  assert.equal(template.records.length, 2);
  const parsed = parseDemandCsv(csv([synthetic], [...demandCsvFields].reverse()));
  assert.deepEqual(parsed, { ok: true, records: [synthetic] });
  for (const field of ['region', 'channel', 'role', 'grade'] as const) {
    for (const option of demandCsvOptions[field]) assert.ok(parseDemandCsv(csv([{ ...synthetic, [field]: option }])).ok);
  }
  assert.ok(parseDemandCsv(csv([{ ...synthetic, week: '2020-W53' }])).ok);
  for (const week of ['2021-W53', '2026-W00', '2026-W54', '2026-11-03', 'W45']) {
    assert.ok(issues(csv([{ ...synthetic, week }])).some(error => error.field === 'week' && error.code === 'INVALID_WEEK'));
  }
});

test('missing/extra/duplicate columns, mismatched widths and missing values reject the whole batch without echoing headers', () => {
  assert.ok(issues(csv([synthetic], demandCsvFields.filter(field => field !== 'grade'))).some(error => error.code === 'MISSING_COLUMN' && error.field === 'grade'));
  for (const identity of ['customer_name', 'company', 'contact', 'email', 'phone', 'url', 'quote_amount', 'project_address', 'chat_original', 'synthetic-private@example.test']) {
    const text = csv([{ ...synthetic, [identity]: 'SYNTHETIC_PRIVATE_VALUE' }], [...demandCsvFields, identity]);
    const result = issues(text);
    assert.ok(result.some(error => error.field === '_header' && error.code === 'UNEXPECTED_COLUMN'));
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE_VALUE|synthetic-private/);
  }
  assert.ok(issues(csv([synthetic], [...demandCsvFields, 'grade'])).some(error => error.code === 'DUPLICATE_COLUMN'));
  assert.ok(issues(csv() + ',extra').some(error => error.code === 'COLUMN_COUNT'));
  for (const field of demandCsvFields) {
    assert.ok(issues(csv([synthetic, { ...synthetic, [field]: '' }])).some(error => error.row === 3 && error.field === field));
  }
  assert.ok(issues(demandCsvFields.join(',')).some(error => error.code === 'EMPTY_CSV'));
});

test('unknown enums and text/tag limits reject rather than silently trim, map or truncate', () => {
  for (const field of ['region', 'role', 'channel', 'grade'] as const) {
    for (const value of ['UNRECOGNIZED', ` ${synthetic[field]}`]) {
      assert.ok(issues(csv([{ ...synthetic, [field]: value }])).some(error => error.field === field && error.code === 'INVALID_ENUM'));
    }
  }
  for (const field of ['product_direction', 'scenario', 'question_rewrite'] as const) {
    const limit = field === 'question_rewrite' ? demandCsvLimits.question : demandCsvLimits.shortText;
    assert.ok(issues(csv([{ ...synthetic, [field]: '文'.repeat(limit + 1) }])).some(error => error.field === field && error.code === 'TOO_LONG'));
  }
  for (const need_tags of [[], ['安装', '安装'], [' 安装'], ['安装', ''], ['文'.repeat(41)], Array.from({ length: 13 }, (_, i) => `标签${i}`)]) {
    assert.ok(issues(csv([{ ...synthetic, need_tags }])).some(error => error.field === 'need_tags'));
  }
  assert.ok(issues(csv([{ ...synthetic, scenario: '室内\u0000商显' }])).some(error => error.code === 'CONTROL_CHARACTER'));
  assert.ok(issues('文'.repeat(demandCsvLimits.bytes)).some(error => error.code === 'TOO_LARGE'));
  assert.ok(issues(csv(Array.from({ length: demandCsvLimits.rows + 1 }, () => synthetic))).some(error => error.code === 'TOO_MANY_ROWS'));
});

test('D6 roles and grades reject other while keeping explicit unknown and regional other', () => {
  for (const field of ['role', 'grade'] as const) {
    assert.ok(issues(csv([{ ...synthetic, [field]: '其他' }])).some(error => error.field === field && error.code === 'INVALID_ENUM'));
    assert.ok(parseDemandCsv(csv([{ ...synthetic, [field]: '未知' }])).ok);
  }
  for (const region of ['其他', '未知']) assert.ok(parseDemandCsv(csv([{ ...synthetic, region }])).ok);
});

test('ISO weeks and bounded technical ranges remain unchanged and do not hide phones in the same cell', () => {
  for (const technical of ['110-220V', '110–220V', '1000-2400W', '50-60Hz', '2026-W44 110-220V', '2026-W44 1000-2400W']) {
    const record = { ...synthetic, week: '2026-W44', product_direction: technical,
      scenario: `户外招牌 ${technical}`, need_tags: [technical], question_rewrite: `需要核对 ${technical} 的使用条件。` };
    assert.deepEqual(parseDemandCsv(csv([record])), { ok: true, records: [record] }, technical);
  }
  for (const phone of ['13800138000', '202-555-0123', '555-0123', '+44 (0)20 7946 0123', '＋１ (２０２) ５５５-０１２３']) {
    for (const question_rewrite of [phone, `2026-W44 110-220V；联系号码 ${phone}`]) {
      const result = issues(csv([{ ...synthetic, week: '2026-W44', question_rewrite }]));
      assert.ok(result.some(error => error.row === 2 && error.field === 'question_rewrite' && error.code === 'PII_PHONE'));
      assert.ok(!JSON.stringify(result).includes(phone));
    }
  }
});

test('PII in any cell rejects the entire batch and exposes only row, canonical field and code', () => {
  const poisons = [
    ['synthetic.person@example.test', 'PII_EMAIL'], ['＋１ (２０２) ５５５-０１２３', 'PII_PHONE'],
    ['+44 (0)20 7946 0123', 'PII_PHONE'], ['13800138000', 'PII_PHONE'],
    ['https://example.test/private', 'PII_URL'], ['www.example.test', 'PII_URL'], ['example.test', 'PII_URL'], ['访问 example.test。', 'PII_URL'],
    ['192.0.2.1', 'PII_URL'],
  ];
  for (const field of demandCsvFields) for (const [value, code] of poisons) {
    const result = issues(csv([synthetic, { ...synthetic, [field]: value }]));
    assert.ok(result.some(error => error.row === 3 && error.field === field && error.code === code), `${field}/${code}`);
    assert.ok(!JSON.stringify(result).includes(value));
  }
  const multiline = csv([{ ...synthetic, question_rewrite: '合成问法第一行\n合成问法第二行' }, { ...synthetic, scenario: 'example.test' }]);
  assert.ok(issues(multiline).some(error => error.row === 4 && error.field === 'scenario' && error.code === 'PII_URL'));
});

test('a rejected import fails before opening a database transaction and never exposes a partial batch', async () => {
  await assert.rejects(importDemandCsv({ csv: csv([synthetic, { ...synthetic, question_rewrite: 'synthetic.person@example.test' }]), filename: 'private-synthetic.csv' }, 'test:demand'),
    error => error instanceof DemandCsvError && error.statusCode === 400 && error.errors.some(issue => issue.row === 3 && issue.code === 'PII_EMAIL')
      && !JSON.stringify(error).includes('synthetic.person') && !JSON.stringify(error).includes('private-synthetic'));
});

test('profiles count overlapping mentions, role × region × scenario, top questions and latest import without returning signals', () => {
  const early = '2026-11-02T08:00:00Z', late = '2026-11-03T09:00:00Z';
  const profile = summarizeDemandSignals([
    { record: synthetic, imported_at: early }, { record: synthetic, imported_at: late },
    { record: { ...synthetic, question_rewrite: '装柜前要确认哪些尺寸？' }, imported_at: early },
    { record: { ...synthetic, region: '北美', need_tags: ['交付与运输'] }, imported_at: early },
    { record: { ...synthetic, role: '分销商/代理商' }, imported_at: early },
    { record: { ...synthetic, scenario: '交通 VMS' }, imported_at: early },
  ]);
  assert.deepEqual(profile.totals, { recordCount: 6, groupCount: 4 });
  assert.equal(profile.lastImportedAt, '2026-11-03T09:00:00.000Z');
  assert.match(profile.countingBasis, /提及.*可重叠.*未按客户去重/);
  assert.equal(profile.groups[0].recordCount, 3);
  assert.deepEqual(profile.groups[0].representativeQuestions, [
    { questionRewrite: synthetic.question_rewrite, count: 2 }, { questionRewrite: '装柜前要确认哪些尺寸？', count: 1 },
  ]);
  assert.ok(profile.needTags.reduce((n, item) => n + item.count, 0) > profile.totals.recordCount);
  assert.deepEqual(profile.needTags.find(item => item.tag === '交付与运输'), { tag: '交付与运输', count: 6 });
  assert.doesNotMatch(JSON.stringify(profile), /batch_id|created_by|product_direction|channel|week|grade|"record"|"id"/);
});

test('writing receives aggregate descriptions without representative or single rewritten questions; empty profiles stay explicit', () => {
  const profile = summarizeDemandSignals([{ record: synthetic, imported_at: '2026-11-03T09:00:00Z' }]);
  const writing = describeWritingProfile(profile);
  assert.equal(writing.totals.recordCount, 1);
  assert.match(writing.descriptions[0], /欧洲.*户外招牌.*登记提及 1 条/);
  assert.match(writing.descriptions[0], /系统配套与安装/);
  assert.ok(!JSON.stringify(writing).includes(synthetic.question_rewrite));
  assert.doesNotMatch(JSON.stringify(writing), /representativeQuestions|questionRewrite|question_rewrite|product_direction|channel|week|grade/);
  const empty = summarizeDemandSignals([]);
  assert.deepEqual(empty.groups, []);
  assert.deepEqual(empty.needTags, []);
  assert.deepEqual(empty.totals, { recordCount: 0, groupCount: 0 });
  assert.equal(empty.lastImportedAt, null);
  assert.deepEqual(describeWritingProfile(empty).descriptions, []);
});
