// Explicit local-only collection exercise, without a worker or model execution.
// Usage: node --env-file=.env scripts/pilot-collect.ts <receipt.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { config } from '@aihot/backend/config';
import { sql, closeDb } from '@aihot/backend/db';
import { collectSource } from '@aihot/backend/sources/collect';
import { stopBoss } from '@aihot/backend/jobs/queue';
const db = new URL(config.databaseUrl);
if (!['127.0.0.1','localhost'].includes(db.hostname) || !db.pathname.endsWith('_test')) throw Error('Use the isolated local pilot *_test database');
if (config.modelCallsEnabled) throw Error('This collection exercise does not run models');
const ids = ['web-macroblock-news','web-kinglight-news','web-nationstar-product-news'];
const seed = JSON.parse(readFileSync(new URL('../industry/sources.json',import.meta.url),'utf8'));
const results: unknown[] = [];
try {
  for (const id of ids) {
    const source = seed.sources.find((s: {id:string}) => s.id === id);
    await sql`INSERT INTO sources (id,name,kind,config,tier,first_party,owner_entity_id,participation_mode,interval_minutes,enabled,site_fulltext,syndicate_fulltext)
      VALUES (${id},${source.name},${source.kind},${sql.json(source.config)},${source.tier},true,${source.owner_entity_id},'editorial',360,false,false,false)
      ON CONFLICT (id) DO NOTHING`;
  }
  // No scheduler is started. A source remains disabled before and after the manual run.
  for (let round=1;round<=2;round++) {
    for (const id of ids) {
      const run = await collectSource(id,{force:true});
      const [state] = await sql`SELECT id,enabled,health,cursor FROM sources WHERE id=${id}`;
      const [counts] = await sql`SELECT count(*)::int AS total,count(*) FILTER (WHERE published_at IS NULL)::int AS unknown_date,count(DISTINCT identity_key)::int AS unique_identities FROM articles WHERE source_id=${id}`;
      results.push({round,run,state,counts});
      console.log(JSON.stringify({round,source:id,status:run.status,created:run.created,counts}));
    }
  }
  const [published] = await sql`SELECT count(*)::int AS publications FROM publications WHERE source_id IN ${sql(ids)}`;
  writeFileSync(process.argv[2] || 'pilot-collection.json',JSON.stringify({at:new Date().toISOString(),scope:'real public HTTP -> collectSource -> isolated PostgreSQL; no worker/model/publication',results,published},null,2));
} finally { await stopBoss(); await closeDb(); }
