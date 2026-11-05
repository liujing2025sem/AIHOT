// P0 imports only. Search estimates are demand/visibility signals, not customer or company facts.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../db.ts';
import { audit } from '../audit.ts';
import { readCsv, piiCode } from './studio-demand-csv.ts';
const invalid=(message:string):never=>{throw Object.assign(new Error(message),{statusCode:400});};
export type SearchSignal={kind:'gsc'|'semrush';query:string;page:string;position:number;impressions:number|null;clicks:number|null;volume:number|null;period:string|null;batch_id?:string};
const aliases:Record<string,string>={query:'query',queries:'query','热门查询':'query','查询':'query',keyword:'query','关键词':'query',page:'page',url:'page','网页':'page','着陆页':'page',position:'position','排名':'position','平均排名':'position',impressions:'impressions','展示':'impressions','展示次数':'impressions',clicks:'clicks','点击':'clicks','点击次数':'clicks',volume:'volume','search volume':'volume','搜索量':'volume',period:'period','数据期':'period',ctr:'ignored'};
function publicUrl(value:string){try{const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password;}catch{return false;}}
export function parseSearchSignals(kind:'gsc'|'semrush',csv:string):SearchSignal[]{
  if(Buffer.byteLength(csv,'utf8')>2*1024*1024)invalid('搜索CSV最大2MB。');
  const parsed=readCsv(csv);if(parsed.rows.length>5000)invalid('每批最多5000行。');
  const headers=parsed.headers.map(h=>aliases[h.trim().toLowerCase()]);
  if(headers.some(h=>!h))invalid('存在不支持的列；请使用下载的GSC/Semrush模板，不导入联系方式或客户身份列。');
  if(new Set(headers.filter(h=>h!=='ignored')).size!==headers.filter(h=>h!=='ignored').length)invalid('存在重复列。');
  for(const required of ['query','page','position',...(kind==='gsc'?['impressions','clicks']:['volume'])])if(!headers.includes(required))invalid(`缺少列：${required}`);
  if(!parsed.rows.length)invalid('CSV没有数据行。');
  return parsed.rows.map(row=>{
    if(row.values.length!==headers.length)invalid(`第${row.line}行列数不一致。`);
    const fields=Object.fromEntries(headers.map((key,i)=>[key,row.values[i]]));
    if(!fields.query?.trim()||fields.query.length>500)invalid(`第${row.line}行 query为空或过长。`);
    if(piiCode(fields.query))invalid(`第${row.line}行 query命中联系方式模式，整批未导入。`);
    if(!publicUrl(fields.page)||fields.page.length>2000)invalid(`第${row.line}行 page需要实际HTTP(S) URL。`);
    const number=(field:string,required:boolean)=>{
      const value=fields[field];if(value===undefined||value===''){if(required)invalid(`第${row.line}行 ${field}缺失。`);return null;}
      const n=Number(value.replace(/,/g,''));if(!Number.isFinite(n)||n<0)invalid(`第${row.line}行 ${field}不是非负数字。`);return n;
    };
    const position=number('position',true)!;if(position===0)invalid(`第${row.line}行 position应大于0。`);
    const period=fields.period||null;if(period&&(period.length>100||piiCode(period)))invalid(`第${row.line}行 period格式不支持。`);
    return {kind,query:fields.query,page:fields.page,position,impressions:number('impressions',kind==='gsc'),clicks:number('clicks',kind==='gsc'),volume:number('volume',kind==='semrush'),period};
  });
}
export async function importSearchSignals(input:unknown,actor:string){
  const body=z.object({kind:z.enum(['gsc','semrush']),csv:z.string()}).strict().parse(input),records=parseSearchSignals(body.kind,body.csv),id=`studio-import-${randomUUID()}`;
  return sql.begin(async tx=>{
    await tx`INSERT INTO studio_import_batches(id,kind,row_count,created_by) VALUES(${id},${body.kind},${records.length},${actor})`;
    for(const record of records)await tx`INSERT INTO studio_search_signals(id,batch_id,record) VALUES(${`search-${randomUUID()}`},${id},${tx.json(record)})`;
    await audit(actor,'studio.search.import',`studio-import:${id}`,null,null,{kind:body.kind,row_count:records.length},{db:tx});
    return {id,kind:body.kind,row_count:records.length};
  });
}
export async function studioSearchSignals(){
  const rows=await sql`SELECT s.id,s.record,b.created_at FROM studio_search_signals s JOIN studio_import_batches b ON b.id=s.batch_id ORDER BY b.created_at DESC,s.id`;
  const batches=await sql`SELECT id,kind,row_count,created_at FROM studio_import_batches WHERE kind IN ('gsc','semrush') ORDER BY created_at DESC,id`;
  return {rows,batches,note:'GSC按导入查询/页面观察；Semrush为对应地区和日期的估算，不等于实际访问或询盘。未知数据期保持未知。'};
}
export const searchTemplates={gsc:'query,page,impressions,clicks,position,period\n',semrush:'keyword,url,position,volume,period\n'};
