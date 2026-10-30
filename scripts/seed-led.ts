// First install starts with the three real LED sources validated by this project, paused.
// No AI-industry demo feeds, historical business data, model call or network fetch is imported.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '@aihot/backend/config';
import { sql, closeDb } from '@aihot/backend/db';
import { assertSupportedConfig } from '@aihot/backend/sources/config-keys';
const ids=new Set(['web-macroblock-news','web-kinglight-news','web-nationstar-product-news']);
try {
  const pack=JSON.parse(fs.readFileSync(path.join(REPO_ROOT,'industry/sources.json'),'utf8'));
  for(const s of pack.sources.filter((s:{id:string})=>ids.has(s.id))){
    assertSupportedConfig(s.kind,s.config);
    await sql`INSERT INTO sources(id,name,kind,config,tier,first_party,owner_entity_id,participation_mode,interval_minutes,enabled,site_fulltext,syndicate_fulltext)
      VALUES (${s.id},${s.name},${s.kind},${sql.json(s.config)},${s.tier},true,${s.owner_entity_id},'editorial',360,false,false,false)
      ON CONFLICT(id) DO NOTHING`;
  }
  console.log('LED sources configured: 3, automatic collection paused');
} finally { await closeDb(); }
