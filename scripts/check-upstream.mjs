// Fetch the original project and report changes. Does not alter the worktree or deploy.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname,'..');
const arg = name => { const i=process.argv.indexOf(name); return i<0?null:process.argv[i+1]; };
const output = path.resolve(arg('--out') || path.join(root,'.data','upstream'));
const proxy = arg('--proxy');
mkdirSync(output,{recursive:true});
const git = args => execFileSync('git',[...(proxy?['-c',`http.proxy=${proxy}`]:[]),...args],{cwd:root,encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']}).trim();
const previousFile=path.join(output,'status.json');
const previous=existsSync(previousFile)?JSON.parse(readFileSync(previousFile,'utf8')):null;
const record={checkedAt:new Date().toISOString(),timezone:'America/Los_Angeles',upstream:'https://github.com/KKKKhazix/AIHOT',status:'UNKNOWN',changed:false,head:null,upstreamHead:null,pendingCommits:[],error:null};
try {
  if(git(['remote','get-url','upstream'])!==`${record.upstream}.git`) throw Error('upstream remote is not the original project');
  git(['fetch','upstream','main']);
  record.head=git(['rev-parse','HEAD']);
  record.upstreamHead=git(['rev-parse','upstream/main']);
  record.pendingCommits=git(['log','--format=%h %s','HEAD..upstream/main']).split('\n').filter(Boolean);
  record.status=record.pendingCommits.length?'UPDATE_AVAILABLE':'CURRENT';
  record.changed=previous!==null&&(previous.status!==record.status||previous.upstreamHead!==record.upstreamHead);
} catch(error) {
  record.status='CHECK_FAILED';
  record.error=String(error.stderr || error.message).slice(0,1200);
  record.changed=previous===null||previous.status!=='CHECK_FAILED';
}
writeFileSync(previousFile,JSON.stringify(record,null,2)+'\n');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const title=record.status==='CURRENT'?'已同步当前上游':record.status==='UPDATE_AVAILABLE'?'原项目有更新待评估':'本次检查未成功';
writeFileSync(path.join(output,'status.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AIHOT 更新跟踪</title><style>body{max-width:850px;margin:45px auto;padding:24px;font:16px/1.8 system-ui;color:#173c37;background:#f4f7f5}article{background:white;padding:28px;border:1px solid #d9e5df;border-radius:14px}li{margin:12px 0}code{overflow-wrap:anywhere}</style><article><p>AIHOT · 原项目更新跟踪</p><h1>${title}</h1><p>检查时间：${esc(new Date(record.checkedAt).toLocaleString('zh-CN',{timeZone:record.timezone}))}，洛杉矶时间。</p><p>本任务只读取版本变化。更新由维护者在本地分支评估并测试后采用。</p><p>上游：<a href="${record.upstream}">KKKKhazix/AIHOT</a></p><p>最新提交：<code>${esc(record.upstreamHead??'未知')}</code></p><ul>${record.pendingCommits.map(c=>`<li>${esc(c)}</li>`).join('')}</ul>${record.error?`<pre>${esc(record.error)}</pre>`:''}</article></html>`);
console.log(JSON.stringify({status:record.status,changed:record.changed,pending:record.pendingCommits.length,output}));
if(record.status==='CHECK_FAILED')process.exitCode=1;
