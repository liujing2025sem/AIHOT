// Offline L0 scope reconciliation. Does not collect, seed, enable sources, or read a database.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../',import.meta.url));
const read = name => JSON.parse(readFileSync(path.join(root,name),'utf8'));
const sources = read('industry/sources.json').sources;
const plan = read('industry/led-source-plan.json');
const preview = read('tests/fixtures/editorial-preview-20261103.json');
const verification = readFileSync(path.join(root,'docs/led-source-verification.md'),'utf8');
const previewTotals = new Map([...verification.matchAll(/^\|\s*((?:web|rss)-[^| ]+)\s*\|\s*(\d+)\s*\|[^\n]+\|\s*\d+\/\d+\s*\|$/gm)].map(m=>[m[1],Number(m[2])]));
const byId = new Map(preview.previews.map(p=>[p.id,p.output.items]));
const baselineIds = new Set(['web-huidu-hdplayer','web-colorlight-software','web-colorlight-ledvision','web-colorlight-firmware']);
const referenceIds = new Set(['led-energy-star-displays','led-eu-display-ecodesign','led-macroblock-monthly-revenue','led-cninfo-investor-records','led-eia-electricity','led-roe-carbon-markii','led-absen-kv3-manual','led-huidu-firmware','led-linsn-software','led-novastar-software','led-eurostat-nrg-pc-205','led-linsn-firmware']);
const entry = source => source.config.url ?? source.config.feedUrl ?? null;
const mapped = new Map();
for(const candidate of plan.candidates){
  const matches = sources.filter(s=>entry(s)===candidate.official_entry);
  if(matches.length>1)throw Error('Ambiguous candidate mapping: '+candidate.id);
  if(matches.length) mapped.set(candidate.id,matches[0].id);
}
const runtimeIds = new Set([...plan.existing_source_refs.map(s=>s.source_id),...mapped.values()]);
if([...byId.keys()].some(id=>!runtimeIds.has(id)))throw Error('Preview source missing from LED scope');
const percent = (n,d) => d ? Number((100*n/d).toFixed(2)) : null;
function counts(items){
  const total=items.length,dated=items.filter(i=>i.publishedAt).length;
  return {items:total,dated,undated:total-dated,date_field_nonempty_pct:percent(dated,total),duplicate_exact_urls:total-new Set(items.map(i=>i.url)).size};
}
function row(source,candidate){
  const id=source?.id ?? candidate.id;
  const items=source ? byId.get(source.id) ?? [] : [];
  const stats=counts(items);
  const observations=candidate?.evidence ?? [];
  const stops=observations.filter(e=>/403|429|captcha|验证码|机器人验证|robots.*disallow/i.test(e.observation));
  const stopEntry=stops.some(e=>e.url===(source?entry(source):candidate.official_entry));
  const use=source ? baselineIds.has(source.id)?'version_baseline':'news_discovery' : referenceIds.has(id)?'reference_baseline':'news_discovery';
  const conclusion=stopEntry?'停用':!source?'待定':use==='version_baseline'?'保留':stats.undated?'修复':'保留';
  const reason=stopEntry?'保留既有拒绝，不重试该入口':!source?'候选尚无运行映射；先核原入口和现有解析能力':use==='version_baseline'?'只建版本基线，日期未知不冒充新闻日期':stats.undated?'列表缺日期；需要真实详情补抓对比，暂不能归咎解析器':'保留已核列表入口，等待正文与30天范围验证';
  const sample=[...items].sort((a,b)=>createHash('sha256').update(id+a.url).digest('hex').localeCompare(createHash('sha256').update(id+b.url).digest('hex'))).slice(0,3);
  return {
    id,source_id:source?.id??null,candidate_id:candidate?.id??null,name:source?.name??candidate.name,
    entry_url:source?entry(source):candidate.official_entry,use,config_enabled:source?.enabled??null,
    runtime_enabled:null,current_run_status:'NOT_RUN',historical_status:candidate?.access??'PREVIEW_SUCCESS',
    historical_preview_total:source?previewTotals.get(source.id)??null:null,
    historical_sample:source?stats:null,original_date_precision:'UNKNOWN_IN_PREVIEW_FIXTURE',
    latest_preview_timestamp:items.map(i=>i.publishedAt).filter(Boolean).sort().at(-1)??null,
    current_date_coverage_pct:null,body_extraction_pct:null,average_body_characters:null,current_duplicate_count:null,
    language:source?.config.acceptLanguage??null,language_basis:'source_configuration_or_unknown',
    samples:sample.map(i=>({title:i.title,url:i.url,original_timestamp:i.publishedAt??null,body_characters:null})),
    sample_method:'first 3 by SHA256(source_id + original URL), reproducible sample of historical listing only',
    historical_observations:observations,stopped_urls:stops,conclusion,reason,
  };
}
const rows=sources.filter(s=>runtimeIds.has(s.id)).map(s=>row(s,plan.candidates.find(c=>mapped.get(c.id)===s.id)));
rows.push(...plan.candidates.filter(c=>!mapped.has(c.id)).map(c=>row(null,c)));
const all=preview.previews.flatMap(p=>p.output.items);
const news=preview.previews.filter(p=>!baselineIds.has(p.id)).flatMap(p=>p.output.items);
const versions=preview.previews.filter(p=>baselineIds.has(p.id)).flatMap(p=>p.output.items);
const result={
  schema:'chipshow-crawl-quality-preflight/1',report_date:'2026-11-06',snapshot_at:preview.generatedAt,
  reference_commit:'d0488ee8e59033d0440b061dac268984e02ae40d',status:'PREFLIGHT_ONLY_L0_NOT_COMPLETE',
  collection_runs:0,model_calls:0,source_config_changes:0,
  scope:{all_configured:sources.length,led_runtime_ids:[...runtimeIds],mapped_candidate_count:mapped.size,candidate_count:plan.candidates.length,unmapped_candidates:plan.candidates.filter(c=>!mapped.has(c.id)).map(c=>c.id),distinct_led_entries:rows.length,excluded_ai_example_ids:sources.filter(s=>!runtimeIds.has(s.id)).map(s=>s.id),runtime_state:'UNKNOWN_REQUIRES_TARGET_RECEIPT',keyword_rss:'No configured LED keyword aggregator feed found; LEDinside RSS is included'},
  metrics:{historical_preview_total:[...previewTotals.values()].reduce((a,b)=>a+b,0),mixed:counts(all),news:counts(news),version_baselines:counts(versions),post_detail_fixed_sample:null,new_30_day_batch:null},
  rows,
};
const output=path.join(root,'docs/crawl-quality');mkdirSync(output,{recursive:true});
writeFileSync(path.join(output,'2026-11-06-preflight.json'),JSON.stringify(result,null,2)+'\n');
const lines=[
  '# L0 首轮采集范围与历史质量基线',
  '',
  '日期：2026-11-06。状态：预检完成，目标机采集未运行。本文不代表新采集、入库或补抓验收。',
  '',
  `已将 ${sources.length} 个运行配置中的 ${runtimeIds.size} 个 LED 配置与 ${plan.candidates.length} 个候选按完全一致的入口 URL 核对。${mapped.size} 个候选已有映射，${rows.length} 个独立 LED 入口均列在下表；另有 ${sources.length-runtimeIds.size} 个 AI 示例源排除在本轮清单外，未删除、未改开关。`,
  '',
  '## 原样本基线',
  '',
  '| 范围 | 条数 | 有日期字段 | 缺日期 | 日期字段非空率 |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...[['混合样本',all],['新闻列表',news],['软件与固件基线',versions]].map(([n,a])=>{const c=counts(a);return `| ${n} | ${c.items} | ${c.dated} | ${c.undated} | ${c.date_field_nonempty_pct}% |`}),
  '',
  '旧核验表的 preview 总条数合计 '+result.metrics.historical_preview_total+'；最多 20 条/源返回的样本合计 '+all.length+'。两者都不代表入库数。样本日期为 '+preview.generatedAt+'。非空率不证明日期正确；样本不含正文，正文抽取率、字数及补抓后覆盖率均未知。目录分类来自既有用途，版本号不作新闻日期。新采集批次与这份固定样本分别统计。',
  '',
  '## 逐入口结论',
  '',
  '| 运行 ID 或候选 ID | 类型 | 历史样本条数 | 缺日期 | 预检结论 | 原因 |',
  '| --- | --- | ---: | ---: | --- | --- |',
  ...rows.map(r=>`| ${r.id} | ${r.use} | ${r.historical_sample?.items??'未知'} | ${r.historical_sample?.undated??'未知'} | ${r.conclusion} | ${r.reason} |`),
  '',
  '每行的入口 URL、候选映射、停止 URL、历史错误原话和三条可复算样本见同名 JSON。新批次所有指标保持 null，未采不填 0。正文前 80 字仅进入目标机或私有结果包。',
  '',
  '## WorkBuddy 下一步',
  '',
  '1. 返回目标实例别名、运行 SHA、16 个 source ID 的数据库启停状态、本批尚未执行证明，以及采集/模型/外发开关的非秘密布尔状态。不要提供密码或 webhook。',
  '2. 复用现有 collectSource、Studio 素材补抓和 fetch_runs。不要运行通用 seed：它会把未显式 enabled 的 AI 示例默认启用。缺失的 LED 记录仅按明确 ID 补入，继续默认停用。',
  '3. 按同名 JSON 的 34 行闭合覆盖。18 个尚无映射的候选先做原入口及现有解析器核验；遇已有拒绝的 URL 保留停止。文档、版本与数据表只做基线，不能强塞新闻解析器。',
  '4. 在目标机执行一次授权批次，临时采集、模型和外发关闭。新闻以批次开始时间回看 30 天，日期未知的条目单列。记录分页与链接边界、限额及详情 pending；一次 collect 返回 ok 不代表完整补抓。不得清空已有 cursor 或覆盖历史数据来凑完整。',
  '5. 详情每次限额为 2 或 8 等配置值，首导条数也有上限。逐条记录成功、无日期、拒绝、错误及待补；不循环重试 403、429、验证码。正文补抓完成后再计算正文抽取率。',
  '6. 结束后恢复并回读采集开关；返回元数据报告与私有正文包位置。未经过这一步，本报告一直保持预检。',
  '',
  '说明：当前执行环境没有可用的 WorkBuddy 派发入口和目标数据库。本次只完成读取、对照与离线复算。未发送任务，目标端接收状态 UNKNOWN。',
];
writeFileSync(path.join(output,'2026-11-06-preflight.md'),lines.join('\n')+'\n');
console.log(JSON.stringify({scope:result.scope,metrics:result.metrics,rows:rows.length}));
