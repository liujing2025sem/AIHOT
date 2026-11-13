import {readFileSync} from 'node:fs';
import {isIP} from 'node:net';
import {load} from 'cheerio';
import {XMLParser} from 'fast-xml-parser';
import {credential} from '../config.ts';
import {guardedFetch,requireOk,type GuardedFetchOptions,type GuardedResponse} from '../lib/http-fetch.ts';
import {isBlockedAddress,normalizeUrl} from '../lib/url.ts';
import {redactPitch} from './studio-pitch-evidence.ts';
import {SITE} from '@aihot/site';

type Question={id:string;zh:string;en:string;terms:string[]};
type ResearchSource={name:string;url:string;terms:string[]};
export type ResearchReport={state:'complete'|'partial'|'unavailable';queries:string[];imported:number;failures:{url:string;reason:string}[]};
export type ResearchResult={article_ids:string[];report:ResearchReport};
type FetchPage=(url:string,options?:GuardedFetchOptions)=>Promise<GuardedResponse>;
type ImportPage=(url:string)=>Promise<string>;
const references=JSON.parse(readFileSync(new URL('../../../../industry/reference-pages.json',import.meta.url),'utf8')) as {topic:string;name:string;url:string;scope:string}[];
const sources=JSON.parse(readFileSync(new URL('../../../../industry/research-sources.json',import.meta.url),'utf8')) as ResearchSource[];
const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

function candidateUrl(value:unknown,base?:string):string|null{
  if(typeof value!=='string')return null;
  let url:URL;try{url=new URL(value,base);}catch{return null;}
  if(!normalizeUrl(url.href))return null;
  const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  if(url.username||url.password||host==='localhost'||/\.(?:localhost|internal|local)$/.test(host)||isIP(host)&&isBlockedAddress(host))return null;
  if(/\.(?:pdf|zip|jpg|png|mp4)$/i.test(url.pathname))return null;
  return url.href;
}

function robots(text:string){
  type Rule={pattern:RegExp;length:number;allow:boolean};
  const groups:{agents:string[];rules:Rule[]}[]=[],sitemaps:string[]=[];
  let group:typeof groups[number]|undefined,previousAgent=false;
  for(const line of text.split(/\r?\n/)){
    const match=/^\s*([\w-]+)\s*:\s*(.*?)\s*(?:#.*)?$/.exec(line);if(!match)continue;
    const key=match[1].toLowerCase(),value=match[2];
    if(key==='sitemap'){sitemaps.push(value);continue;}
    if(key==='user-agent'){
      if(!previousAgent){group={agents:[],rules:[]};groups.push(group);}
      group!.agents.push(value.toLowerCase());previousAgent=true;continue;
    }
    previousAgent=false;
    if(group&&value&&['allow','disallow'].includes(key))group.rules.push({pattern:new RegExp('^'+value.split('*').map(escape).join('.*').replace(/\\\$$/,'$')),length:value.length,allow:key==='allow'});
  }
  const crawler=SITE.crawlerName.toLowerCase();
  const ranked=groups.map(group=>({...group,specificity:Math.max(...group.agents.map(agent=>agent==='*'?0:agent&&crawler.includes(agent)?agent.length:-1))}));
  const best=Math.max(-1,...ranked.map(group=>group.specificity));
  const rules=ranked.filter(group=>best>=0&&group.specificity===best).flatMap(group=>group.rules);
  return {sitemaps,allows:(url:string)=>{
    const u=new URL(url),matches=rules.filter(r=>r.pattern.test(u.pathname+u.search)).sort((a,b)=>b.length-a.length||Number(b.allow)-Number(a.allow));
    return matches[0]?.allow??true;
  }};
}

export async function discoverPitchEvidence(questions:readonly Question[],importPage:ImportPage,fetchPage:FetchPage=guardedFetch):Promise<ResearchResult>{
  const report:ResearchReport={state:'unavailable',queries:[],imported:0,failures:[]};
  if(!questions.length)return {article_ids:[],report};
  if(credential('collectors','COLLECT_ENABLED')!=='true'){
    report.failures.push({url:'',reason:'自动采集尚未启用，已保留命题和现有资料。'});
    return {article_ids:[],report};
  }
  report.queries=[...new Set(questions.map(q=>redactPitch(`${q.en} ${q.terms.join(' ')}`).text.replace(/\[[A-Z]+\]/g,'').trim().slice(0,360)))].slice(0,6);
  const terms=[...new Set(questions.flatMap(q=>q.terms.flatMap(term=>[term.toLowerCase(),...(term.toLowerCase().match(/[a-z]{4,}/g)??[])])))].filter(term=>!['display','displays','screen','screens','with','from','which','what','when'].includes(term));
  const patterns=terms.map(term=>new RegExp((/^[a-z]/.test(term)?'\\b':'')+escape(term)+(/[a-z]$/.test(term)?'(?:s|es)?\\b':''),'i'));
  const score=(text:string)=>patterns.filter(pattern=>pattern.test(text)).length;
  const selected=[...sources].sort((a,b)=>score(b.terms.join(' '))-score(a.terms.join(' '))).slice(0,3);
  const referenceSeeds=references.filter(r=>score(`${r.topic} ${r.name} ${r.scope}`)>0).slice(0,2).map(r=>({name:r.name,url:r.url,terms:[r.topic,r.scope]}));
  const candidates=new Map<string,{url:string;score:number;order:number}>();
  const deadline=Date.now()+26000;
  const fetch=async(url:string)=>{
    const remaining=deadline-Date.now();if(remaining<=0)throw new Error('本轮公开资料检索已到时间上限。');
    return fetchPage(url,{timeoutMs:Math.min(6000,remaining),maxBytes:256*1024,redirectPolicy:'same-origin',maxRedirects:0});
  };
  await Promise.all([...referenceSeeds,...selected].slice(0,4).map(async(source,order)=>{
    const seed=candidateUrl(source.url);if(!seed)return;
    try{
      const origin=new URL(seed).origin,robotUrl=new URL('/robots.txt',origin).href;
      const response=await fetch(robotUrl);
      if(![200,404].includes(response.status))throw new Error(`robots.txt 返回 ${response.status}，已停止该来源采集。`);
      if(response.status===200&&/<(?:!doctype\s+html|html|head|body)\b/i.test(response.text()))throw new Error('robots.txt 返回了网页，未确认采集规则，已停止该来源。');
      const policy=robots(response.status===200?response.text():'');
      if(!policy.allows(seed))throw new Error('该来源的采集规则不允许读取此入口。');
      const page=requireOk(await fetch(seed)),base=page.url;
      if(new URL(base).hostname.replace(/^www\./,'')!==new URL(seed).hostname.replace(/^www\./,''))throw new Error('入口跳转到不同来源，未继续抓取。');
      const add=(value:unknown,label:string)=>{
        const url=candidateUrl(typeof value==='string'?value.replace(/&amp;/g,'&'):value,base);if(!url||new URL(url).origin!==new URL(base).origin||!policy.allows(url))return;
        let pathname:string;try{pathname=decodeURIComponent(new URL(url).pathname);}catch{return;}
        const relevance=score(`${label} ${pathname}`);if(!relevance)return;
        const key=normalizeUrl(url)!,old=candidates.get(key);
        if(!old||relevance>old.score)candidates.set(key,{url,score:relevance,order});
      };
      const $=load(page.text());
      $('a[href]').each((_i,node)=>add($(node).attr('href'),$(node).text()));
      if(referenceSeeds.some(r=>r.url===source.url))add(base,`${source.name} ${source.terms.join(' ')}`);
      if([...candidates.values()].filter(c=>c.order===order).length>=2)return;
      const sitemap=policy.sitemaps.map(url=>candidateUrl(url,base)).find(url=>url&&new URL(url).origin===new URL(base).origin)??new URL('/sitemap.xml',base).href;
      if(!policy.allows(sitemap))return;
      const xml=requireOk(await fetch(sitemap));
      const parser=new XMLParser({ignoreAttributes:true,processEntities:false});
      const parsed=parser.parse(xml.text());
      const items=parsed?.urlset?.url;
      if(items)for(const item of (Array.isArray(items)?items:[items]).slice(0,500))add(item?.loc,'');
      const children=parsed?.sitemapindex?.sitemap;
      if(children){
        const priority=(url:string)=>/pages?(?:[-_.\/]|$)/i.test(new URL(url).pathname)?3:/posts?(?:[-_.\/]|$)/i.test(new URL(url).pathname)?2:/products?(?:[-_.\/]|$)/i.test(new URL(url).pathname)?1:0;
        const childUrls=[...new Set((Array.isArray(children)?children:[children]).slice(0,500).map(item=>candidateUrl(item?.loc,base)).filter((url):url is string=>!!url&&new URL(url).origin===new URL(base).origin&&policy.allows(url)&&!/(?:users?|authors?|tags?|categor(?:y|ies))(?:[-_.\/]|$)/i.test(new URL(url).pathname)))];
        for(const child of childUrls.sort((a,b)=>priority(b)-priority(a)).slice(0,2)){
          const detail=parser.parse(requireOk(await fetch(child)).text());
          for(const item of (Array.isArray(detail?.urlset?.url)?detail.urlset.url:[detail?.urlset?.url]).slice(0,500))add(item?.loc,'');
        }
      }
    }catch(error){report.failures.push({url:seed,reason:error instanceof Error?error.message.slice(0,180):'公开目录读取未完成'});}
  }));
  const results=await Promise.all([...candidates.values()].sort((a,b)=>b.score-a.score||a.order-b.order||a.url.localeCompare(b.url)).slice(0,4).map(async({url})=>{
    try{return await importPage(url);}
    catch(error){report.failures.push({url,reason:error instanceof Error?error.message.slice(0,180):'资料正文未取得'});return null;}
  }));
  const article_ids=[...new Set(results.filter((id):id is string=>!!id))];
  report.imported=article_ids.length;report.state=report.imported?(report.failures.length?'partial':'complete'):'unavailable';
  if(!report.imported&&!report.failures.length)report.failures.push({url:'',reason:'已检查公开目录，暂未找到与这道买家问题相关的可读资料。'});
  return {article_ids,report};
}
