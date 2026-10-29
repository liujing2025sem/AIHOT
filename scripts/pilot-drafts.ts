// Put selected, already-reviewed local drafts on the isolated preview site.
// These are Agent-assisted drafts, never model-pipeline acceptance evidence.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import { config } from '@aihot/backend/config';
import { sql, closeDb } from '@aihot/backend/db';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { publishArticle } from '@aihot/backend/publication/publish';
import { stopBoss } from '@aihot/backend/jobs/queue';
const input = process.argv[2];
if (!input) throw Error('Pass the content-pilot directory');
const db=new URL(config.databaseUrl);
if(db.hostname!=='127.0.0.1'||!db.pathname.endsWith('_test')||!config.siteUrl.startsWith('http://127.0.0.1:'))throw Error('Use the isolated loopback pilot only');
const source='local-editorial-pilot';
const drafts=[
  {file:'01-outdoor-led-sign-electricity-cost.en.md',id:'pilot-electricity-cost',title:'试验稿｜户外 LED 招牌一年用多少电？',summary:'带面积、适用平均 AC 功率、运行时间和电价的预算说明。演示输入仅用于说明计算，不代表 Chipshow 实测。英文正文含条件表、算例及原厂出处。'},
  {file:'02-compare-led-display-quotes.en.md',id:'pilot-compare-quotes',title:'试验稿｜两份 LED 商显报价该怎么比？',summary:'从型号与配置、测试条件、样品身份和服务范围提炼补问清单。外部厂商数据保留归属，等待 Chipshow 工程证据。'},
  {file:'03-meanwell-udp-procurement-brief.en.md',id:'pilot-udp-procurement',title:'试验稿｜明纬 UDP 电源变化，采购先问三件事',summary:'依据明纬两份官方资料提出精确型号、整屏影响与交付维护问题。系列页与公告的尺寸口径存在差异，具体型号需核对；不证明 Chipshow 采用该电源。'}
];
try {
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,enabled,site_fulltext,syndicate_fulltext)
    VALUES (${source},'本机编辑试验 · 非自动成稿','external','T2','editorial',false,true,false) ON CONFLICT(id) DO NOTHING`;
  const links=[];
  for(const d of drafts){
    const body=readFileSync(path.join(input,d.file),'utf8');
    const {articleId}=await upsertMaterial({id:d.id,identityKey:`local-pilot:${d.id}`,sourceId:source,url:`${config.siteUrl}/items/${d.id}`,title:d.title,
      bodyHtml:marked.parse(body,{async:false}),bodyText:body,bodyStatus:'ok',language:'en',author:'Agent-assisted local editorial pilot',
      publishedAt:new Date(),via:'local-editorial-pilot',raw:{draft:true,automatedPipeline:false,originalFile:d.file}});
    const [a]=await sql`SELECT revision FROM articles WHERE id=${articleId}`;
    const [existing]=await sql`SELECT id FROM analyses WHERE article_id=${articleId} AND input_revision=${a!.revision}`;
    if(!existing)await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,category,title_zh,summary_zh,reason_zh,score,selected)
      VALUES (${articleId},${a!.revision},'rule','pass','industry',${d.title},${d.summary},'用于本机流程及编辑评审；未核准发布。',null,true)`;
    await sql`UPDATE articles SET grouping_status='complete' WHERE id=${articleId}`;
    await publishArticle(articleId,{releasedAt:new Date(Date.now()-1000)});
    links.push({id:articleId,url:`${config.siteUrl}/items/${articleId}`,file:d.file});
  }
  const result={at:new Date().toISOString(),mode:'LOCAL_AGENT_ASSISTED_DRAFTS',automatedPipeline:false,links};
  writeFileSync(path.join(input,'local-preview.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}finally{await stopBoss();await closeDb();}
