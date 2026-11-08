import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import Fastify from 'fastify';
import { sql, closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { passwordLogin, SESSION_COOKIE, sessionPrincipal } from '@aihot/backend/admin/auth';
import { registerAdminStudioPlanning } from '../apps/api/src/routes/admin-studio-planning.ts';
import { saveStudioQuestion, importStudioQuestions, studioQuestions } from '@aihot/backend/admin/studio-questions';
import { importDemandCsv } from '@aihot/backend/studio/studio-demand';
import { demandCsvFields } from '@aihot/backend/studio/studio-demand-csv';
import { createStudioTask, exportStudioTask } from '@aihot/backend/studio/studio';

const actor='test:planning',suffix=tag();
const doc={question:`户外招牌电费怎么计算-${suffix}？`,roles:['终端业主/广告媒体主'],scenario:'户外招牌',dimension:'费用',keywords:['电费','用电','power']};
after(async()=>{await closeDb();});

test('question map import is all-or-nothing, repeatable and never overwrites operator changes',async()=>{
  const first=await importStudioQuestions({questions:[doc]},actor);assert.deepEqual(first,{created:1,skipped:0});
  const again=await importStudioQuestions({questions:[doc]},actor);assert.deepEqual(again,{created:0,skipped:1});
  const row=(await studioQuestions()).rows.find(row=>row.document.question===doc.question)!;
  await saveStudioQuestion({id:row.id,version:row.version,document:{...row.document,existing_url:'https://www.chipshow.com/an-operator-supplied-page'}},actor);
  await importStudioQuestions({questions:[doc]},actor);
  const updated=(await studioQuestions()).rows.find(q=>q.id===row.id)!;assert.equal(updated.document.existing_url,'https://www.chipshow.com/an-operator-supplied-page');
  await assert.rejects(saveStudioQuestion({id:row.id,version:row.version,document:doc},actor),/已被更新/);
  await assert.rejects(importStudioQuestions({questions:[{...doc,question:`another-${suffix}`},{...doc,question:`invalid-${suffix}`,source_ids:['not-a-registered-source']}]},actor),/信源尚未配置/);
  assert.equal((await sql`SELECT 1 FROM studio_questions WHERE document->>'question'=${`another-${suffix}`}`).length,0);
});

test('planning endpoints require login and CSRF, and examples do not auto-import',async()=>{
  const app=Fastify();registerAdminStudioPlanning(app);const old={password:config.adminPassword,dev:config.devAdmin};config.adminPassword='test-planning-password-123';config.devAdmin=null;
  try{
    assert.equal((await app.inject('/api/admin/studio/questions')).statusCode,401);
    const {token}=await passwordLogin(config.adminPassword,'/admin','test');const cookie=`${SESSION_COOKIE}=${token}`,principal=(await sessionPrincipal(cookie))!;
    const before=(await sql`SELECT count(*)::int AS n FROM studio_questions`)[0].n;
    const example=await app.inject({url:'/api/admin/studio/questions/example',headers:{cookie}});assert.equal(example.statusCode,200);assert.equal(example.json().questions.length,36);
    assert.equal((await sql`SELECT count(*)::int AS n FROM studio_questions`)[0].n,before);
    const payload={document:{...doc,question:`endpoint-${suffix}`}};
    assert.equal((await app.inject({method:'POST',url:'/api/admin/studio/questions',headers:{cookie},payload})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/api/admin/studio/questions',headers:{cookie,'x-csrf-token':principal.csrf},payload})).statusCode,200);
    const csv=demandCsvFields.join(',')+'\n2026-W45,欧洲,网站,集成商/安装商/招牌制作商,LED显示屏,户外招牌,安装,联系someone@example.com,A';
    const rejected=await app.inject({method:'POST',url:'/api/admin/studio/demand/import',headers:{cookie,'x-csrf-token':principal.csrf},payload:{csv}});
    assert.equal(rejected.statusCode,400);assert.match(rejected.body,/第2行/);assert.match(rejected.body,/question_rewrite/);assert.equal(rejected.body.includes('someone@example.com'),false);
  }finally{config.adminPassword=old.password;config.devAdmin=old.dev;await app.close();}
});

test('task writing receives aggregate readership only and never another brand profile',async()=>{
  const source=`planning-source-${suffix}`,article=`planning-article-${suffix}`,privateQuestion=`只保留在聚合界面代表问法里的内容-${suffix}`;
  await sql`INSERT INTO sources(id,name,kind,enabled) VALUES(${source},'Synthetic LED source','web_list',false)`;
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at,body_status,body_text) VALUES(${article},${source},${article},${`https://example.com/${article}`},'LED display driver update',now(),now(),'ok','The manufacturer announced a display driver update.')`;
  await importDemandCsv({csv:demandCsvFields.join(',')+`\n2026-W45,欧洲,网站,集成商/安装商/招牌制作商,LED显示屏,户外招牌,交付与运输,${privateQuestion},A`},actor);
  const task=await createStudioTask({article_ids:[article]},actor),pack=(await exportStudioTask(task.id))!;
  assert.equal(pack.request.reader_profile?.totals.recordCount,1);
  assert.match(pack.request.reader_profile!.descriptions[0],/登记提及 1 条/);
  assert.equal(JSON.stringify(pack).includes(privateQuestion),false);
  const other=await createStudioTask({article_ids:[article],writing:{site:'unishineled.com',target_url:'https://unishineled.com/example',page_type:'article'}},actor);
  assert.equal((await exportStudioTask(other.id))!.request.reader_profile,undefined);
});
