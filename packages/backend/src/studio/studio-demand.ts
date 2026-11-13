import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql, type Db } from '../db.ts';
import { audit } from '../audit.ts';
import { sha256 } from '../lib/ids.ts';
import { parseDemandCsv, type DemandCsvIssue, type DemandRecord } from './studio-demand-csv.ts';

export type StudioImportKind = 'inquiry' | 'gsc' | 'semrush';
export type StudioImportBatch = { id: string; kind: StudioImportKind; row_count: number; created_by: string; created_at: Date };
export class DemandCsvError extends Error {
  readonly statusCode = 400;
  readonly code = 'DEMAND_CSV_INVALID';
  readonly errors: DemandCsvIssue[];
  constructor(errors: DemandCsvIssue[]) {
    super('整批未导入，请按行号、字段和错误代码检查脱敏 CSV。');
    this.errors = errors;
  }
}

export async function importDemandCsv(input: { csv: string; filename?: string }, actor: string) {
  const parsed = parseDemandCsv(input.csv);
  if (!parsed.ok) throw new DemandCsvError(parsed.errors);
  const id = `studio-import-${randomUUID()}`;
  const fingerprint=sha256(JSON.stringify(parsed.records.map(record=>JSON.stringify(Object.fromEntries(Object.entries(record).sort(([a],[b])=>a.localeCompare(b))))).sort()));
  // Validate the entire batch before the first query. Filename and rejected cells never enter the audit.
  return sql.begin(async tx => {
    const [overlap]=await tx`SELECT count(*)::int AS n FROM jsonb_array_elements(${tx.json(parsed.records)}::jsonb) incoming(record)
      WHERE EXISTS(SELECT 1 FROM studio_demand_signals s WHERE s.record=incoming.record)`;
    // Legacy batches have no fingerprint. Compare their complete multiset without changing stored rows.
    const [legacy]=await tx`SELECT b.id FROM studio_import_batches b JOIN studio_demand_signals s ON s.batch_id=b.id
      WHERE b.kind='inquiry' AND b.content_fingerprint IS NULL GROUP BY b.id
      HAVING jsonb_agg(s.record ORDER BY s.record::text)=(SELECT jsonb_agg(value ORDER BY value::text) FROM jsonb_array_elements(${tx.json(parsed.records)}::jsonb)) LIMIT 1`;
    if(legacy)throw Object.assign(new Error('相同内容的需求批次已存在，整批未导入。'),{statusCode:400});
    const [batch] = await tx<StudioImportBatch[]>`INSERT INTO studio_import_batches (id, kind, row_count, created_by,content_fingerprint)
      VALUES (${id}, 'inquiry', ${parsed.records.length}, ${actor},${fingerprint}) ON CONFLICT DO NOTHING RETURNING id, kind, row_count, created_by, created_at`;
    if(!batch)throw Object.assign(new Error('相同内容的需求批次已存在，整批未导入。'),{statusCode:400});
    const rows = parsed.records.map(record => ({ id: `studio-demand-${randomUUID()}`, batch_id: id, record: tx.json(record) }));
    await tx`INSERT INTO studio_demand_signals ${tx(rows, 'id', 'batch_id', 'record')}`;
    await audit(actor, 'studio.import.create', `studio-import:${id}`, null, null,
      { kind: 'inquiry', row_count: parsed.records.length }, { db: tx });
    return {...batch,overlapping_rows:overlap.n};
  });
}

/** Metadata only; inquiry is the default. GSC/Semrush share this batch table. */
export async function listStudioImports(kind: StudioImportKind = 'inquiry') {
  if (!z.enum(['inquiry', 'gsc', 'semrush']).safeParse(kind).success) {
    throw Object.assign(new Error('不支持的导入类型。'), { statusCode: 400 });
  }
  return sql<StudioImportBatch[]>`SELECT id, kind, row_count, created_by, created_at FROM studio_import_batches
    WHERE kind = ${kind} ORDER BY created_at DESC, id`;
}

/** Cascades to the importing module's rows. Audit stores counts, never questions. */
export async function withdrawStudioImport(id: string, actor: string) {
  return sql.begin(async tx => {
    const [batch] = await tx<StudioImportBatch[]>`DELETE FROM studio_import_batches WHERE id = ${id}
      RETURNING id, kind, row_count, created_by, created_at`;
    if (!batch) return null;
    await audit(actor, 'studio.import.withdraw', `studio-import:${batch.id}`, null,
      { kind: batch.kind, row_count: batch.row_count }, null, { db: tx });
    return { id: batch.id, kind: batch.kind, row_count: batch.row_count, withdrawn: true };
  });
}

type CountedTag = { tag: string; count: number };
type ProfileGroup = {
  role: DemandRecord['role']; region: DemandRecord['region']; scenario: string; recordCount: number;
  needTags: CountedTag[]; representativeQuestions: { questionRewrite: string; count: number }[];
};
export type DemandProfiles = {
  groups: ProfileGroup[];
  needTags: CountedTag[];
  lastImportedAt: string | null;
  totals: { recordCount: number; groupCount: number };
  countingBasis: string;
};
type Signal = { record: DemandRecord; imported_at: Date | string };
const countingBasis = '按登记提及计数；需求标签可重叠，未按客户去重。仅用于选题与写作定向，不是公司能力事实。';
const compare = (a: string, b: string) => a.localeCompare(b, 'zh-CN');
const add = (counts: Map<string, number>, key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
const tags = (counts: Map<string, number>): CountedTag[] => [...counts].map(([tag, count]) => ({ tag, count }))
  .sort((a, b) => b.count - a.count || compare(a.tag, b.tag));

/** Pure aggregation, also used by the synthetic standalone fixtures. Never returns signal IDs or rows. */
export function summarizeDemandSignals(signals: readonly Signal[]): DemandProfiles {
  const grouped = new Map<string, { group: ProfileGroup; tags: Map<string, number>; questions: Map<string, number> }>();
  const allTags = new Map<string, number>();
  let latest = -Infinity;
  for (const { record, imported_at } of signals) {
    latest = Math.max(latest, new Date(imported_at).getTime());
    const key = JSON.stringify([record.role, record.region, record.scenario]);
    let entry = grouped.get(key);
    if (!entry) {
      entry = { group: { role: record.role, region: record.region, scenario: record.scenario, recordCount: 0,
        needTags: [], representativeQuestions: [] }, tags: new Map(), questions: new Map() };
      grouped.set(key, entry);
    }
    entry.group.recordCount++;
    for (const tag of new Set(record.need_tags)) { add(entry.tags, tag); add(allTags, tag); }
    add(entry.questions, record.question_rewrite);
  }
  const groups = [...grouped.values()].map(({ group, tags: groupTags, questions }) => ({
    ...group, needTags: tags(groupTags), representativeQuestions: [...questions]
      .map(([questionRewrite, count]) => ({ questionRewrite, count }))
      .sort((a, b) => b.count - a.count || compare(a.questionRewrite, b.questionRewrite)).slice(0, 3),
  })).sort((a, b) => b.recordCount - a.recordCount || compare(JSON.stringify([a.role, a.region, a.scenario]), JSON.stringify([b.role, b.region, b.scenario])));
  return { groups, needTags: tags(allTags), lastImportedAt: Number.isFinite(latest) ? new Date(latest).toISOString() : null,
    totals: { recordCount: signals.length, groupCount: groups.length }, countingBasis };
}

export async function demandProfiles(db:Db=sql): Promise<DemandProfiles> {
  // One snapshot, including the latest import time; imports and withdrawals need no profile cache.
  const signals = await db<Signal[]>`SELECT s.record, b.created_at AS imported_at
    FROM studio_demand_signals s JOIN studio_import_batches b ON b.id = s.batch_id WHERE b.kind = 'inquiry'`;
  return summarizeDemandSignals(signals);
}

/** Model boundary: descriptions/counts only, excluding even representative rewritten questions. */
export function describeWritingProfile(profile: DemandProfiles) {
  return { countingBasis: profile.countingBasis, lastImportedAt: profile.lastImportedAt, totals: profile.totals,
    descriptions: profile.groups.map(group => `${group.role}；${group.region}；${group.scenario}：登记提及 ${group.recordCount} 条。需求标签：${group.needTags.map(item => `${item.tag}（${item.count}）`).join('、')}。`) };
}

export async function aggregateWritingProfile(db:Db=sql) {
  return describeWritingProfile(await demandProfiles(db));
}
