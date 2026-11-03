import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { closeDb, sql } from '@aihot/backend/db';
import { aggregateWritingProfile, DemandCsvError, demandProfiles, importDemandCsv, listStudioImports, withdrawStudioImport } from '@aihot/backend/admin/studio-demand';
import { demandCsvFields } from '@aihot/backend/admin/studio-demand-csv';

after(closeDb);
const actor = `test:demand:${tag()}`;
const header = demandCsvFields.join(',');
const row = '2026-W45,欧洲,网站,集成商/安装商/招牌制作商,户外LED显示屏,户外招牌,系统配套与安装|交付与运输,安装前需要核对哪些配套条件？,A';
const csv = `${header}\r\n${row}\r\n${row}`;

test('import, metadata-only lists, overlapping profiles and withdrawal cascade; writing and audit exclude questions', async () => {
  const first = await importDemandCsv({ csv, filename: 'synthetic-only.csv' }, actor);
  const second = await importDemandCsv({ csv: `${header}\r\n${row}` }, actor);
  const gsc = `test-gsc-${tag()}`, semrush = `test-semrush-${tag()}`;
  try {
    await sql`INSERT INTO studio_import_batches (id, kind, row_count, created_by) VALUES
      (${gsc}, 'gsc', 0, ${actor}), (${semrush}, 'semrush', 0, ${actor})`;
    assert.equal(first.row_count, 2);
    const imports = await listStudioImports();
    assert.ok(imports.some(batch => batch.id === first.id));
    assert.ok(imports.every(batch => batch.kind === 'inquiry'));
    assert.doesNotMatch(JSON.stringify(imports), /question_rewrite|安装前|synthetic-only|"record"/);
    assert.ok((await listStudioImports('gsc')).some(batch => batch.id === gsc));
    assert.ok((await listStudioImports('semrush')).some(batch => batch.id === semrush));
    const profile = await demandProfiles();
    assert.equal(profile.totals.recordCount, 3, 'repeat imports count mentions, not unique customers');
    assert.equal(profile.groups.length, 1);
    assert.equal(profile.groups[0].recordCount, 3);
    assert.ok(profile.needTags.every(item => item.count === 3));
    assert.deepEqual(profile.groups[0].representativeQuestions, [{ questionRewrite: '安装前需要核对哪些配套条件？', count: 3 }]);
    const newest = Math.max(...imports.map(batch => new Date(batch.created_at).getTime()));
    assert.equal(profile.lastImportedAt, new Date(newest).toISOString());
    assert.doesNotMatch(JSON.stringify(profile), /batch_id|created_by|product_direction|channel|week|grade|"record"|"id"/);
    assert.doesNotMatch(JSON.stringify(await aggregateWritingProfile()), /安装前需要核对|representativeQuestions|questionRewrite|question_rewrite/);
    await withdrawStudioImport(second.id, actor);
    assert.equal((await demandProfiles()).totals.recordCount, 2);
    assert.equal((await demandProfiles()).lastImportedAt, new Date(first.created_at).toISOString());
    assert.deepEqual(await withdrawStudioImport(first.id, actor), { id: first.id, kind: 'inquiry', row_count: 2, withdrawn: true });
    assert.equal((await sql`SELECT count(*)::int AS n FROM studio_demand_signals WHERE batch_id IN (${first.id}, ${second.id})`)[0].n, 0);
    const empty = await demandProfiles();
    assert.deepEqual(empty.totals, { recordCount: 0, groupCount: 0 });
    assert.deepEqual(empty.groups, []);
    assert.equal(empty.lastImportedAt, null);
    assert.equal(await withdrawStudioImport(first.id, actor), null);
    const logs = await sql`SELECT action, before, after FROM audit_log WHERE actor = ${actor}`;
    assert.ok(logs.some(entry => entry.action === 'studio.import.create'));
    assert.ok(logs.some(entry => entry.action === 'studio.import.withdraw'));
    assert.doesNotMatch(JSON.stringify(logs), /安装前|question_rewrite|synthetic-only|户外LED显示屏/);
    assert.equal((await withdrawStudioImport(gsc, actor))?.kind, 'gsc');
    assert.equal((await withdrawStudioImport(semrush, actor))?.kind, 'semrush');
  } finally {
    await sql`DELETE FROM studio_import_batches WHERE created_by = ${actor}`;
  }
});

test('an invalid final row rejects all prior rows and leaves no batch, signals or audit payload', async () => {
  const before = Number((await sql`SELECT count(*) AS n FROM studio_import_batches`)[0].n);
  const logCount = Number((await sql`SELECT count(*) AS n FROM audit_log WHERE actor = ${actor}`)[0].n);
  const invalid = row.replace('安装前需要核对哪些配套条件？', 'synthetic.private@example.test');
  await assert.rejects(importDemandCsv({ csv: `${csv}\r\n${invalid}` }, actor), error => error instanceof DemandCsvError
    && error.errors.some(issue => issue.row === 4 && issue.field === 'question_rewrite' && issue.code === 'PII_EMAIL')
    && !JSON.stringify(error).includes('synthetic.private'));
  assert.equal(Number((await sql`SELECT count(*) AS n FROM studio_import_batches`)[0].n), before);
  assert.equal(Number((await sql`SELECT count(*) AS n FROM studio_demand_signals`)[0].n), 0);
  assert.equal(Number((await sql`SELECT count(*) AS n FROM audit_log WHERE actor = ${actor}`)[0].n), logCount);
});

