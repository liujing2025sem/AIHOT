// Portable Windows launcher. Paths derive from this file; settings live in INSTALLATION.json.
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {root,source,runtime,node,data,settings,localSecrets,appEnv,baseEnv,startDb,pgRunning,pgRun,freePort,workspaceLinks,readJson,writeJson,run} from './studio-common.mjs';
const action=process.argv[2]||'start',logs=path.join(runtime,'logs'),record=path.join(logs,'processes.json');
fs.mkdirSync(logs,{recursive:true});
const s=settings(),urls=[`http://127.0.0.1:${s.apiPort}/api/health`,`http://${s.webHost}:${s.webPort}/admin/login`];
const health=async url=>{try{return (await fetch(url,{signal:AbortSignal.timeout(3000)})).ok;}catch{return false;}};
function owned(pid){
 if(!Number.isInteger(pid)||pid<1)return false;
 const q=`Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress`;
 const r=spawnSync('powershell.exe',['-NoProfile','-Command',q],{env:baseEnv(),encoding:'utf8',windowsHide:true,timeout:10000});
 if(r.status!==0)throw Error('Cannot inspect process ownership; nothing stopped');
 if(!r.stdout.trim())return false;
 const p=JSON.parse(r.stdout);return p.ExecutablePath?.toLowerCase()===node.toLowerCase()&&p.CommandLine?.toLowerCase().includes(source.toLowerCase()+path.sep);
}
const jobs=()=>fs.existsSync(record)?readJson(record):[];
const workerEnabled=appEnv().STUDIO_WORKER_ONLY==='true';
function stopApps(){for(const p of jobs())if(owned(p.pid))process.kill(p.pid);if(fs.existsSync(record))fs.unlinkSync(record);}
try{
 if(action==='start'){
  workspaceLinks();
  if(jobs().length===(workerEnabled?3:2)&&jobs().every(p=>owned(p.pid))&&(await Promise.all(urls.map(health))).every(Boolean))console.log(JSON.stringify({status:'ALREADY_RUNNING',root,url:urls[1]}));
  else{
   await freePort(s.apiPort);await freePort(s.webPort,s.webHost);await startDb();
   run(node,[path.join(source,'scripts/migrate.ts')],{env:appEnv(),cwd:source,stdio:'inherit'});
   const env=appEnv(),started=[];
   try{
    for(const [name,entry] of [['api','apps/api/src/main.ts'],['web','apps/web/server.ts'],...(workerEnabled?[['studio-worker','apps/worker/src/main.ts']]:[])]){
     const out=fs.openSync(path.join(logs,name+'.log'),'a'),err=fs.openSync(path.join(logs,name+'.error.log'),'a');
     const childEnv=name==='web'?{...baseEnv(),NODE_ENV:'production',API_BASE_URL:env.API_BASE_URL,WEB_HOST:env.WEB_HOST,WEB_PORT:env.WEB_PORT,SITE_URL:env.SITE_URL,TRUST_PROXY:'false'}:name==='studio-worker'?{...env,STUDIO_WORKER_ONLY:'true',MODEL_CALLS_ENABLED:localSecrets().MODEL_CALLS_ENABLED==='true'?'true':'false'}:env;
     const child=spawn(node,[path.join(source,entry)],{cwd:source,env:childEnv,detached:true,windowsHide:true,stdio:['ignore',out,err]});
     await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
     child.unref();fs.closeSync(out);fs.closeSync(err);started.push({name,pid:child.pid,root,entry});writeJson(record,started);
    }
    let ok=false;for(let i=0;i<60;i++){if((await Promise.all(urls.map(health))).every(Boolean)){ok=true;break;}await new Promise(r=>setTimeout(r,500));}
    if(!ok)throw Error('Application startup failed; see runtime/logs');
    console.log(JSON.stringify({status:'RUNNING',root,node,database:data,url:urls[1],mode:s.mode,jobs:started}));
   }catch(e){stopApps();throw e;}
  }
 }else if(action==='stop'||action==='stop-apps'){
  stopApps();if(action==='stop'&&pgRunning())pgRun('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  console.log(JSON.stringify({status:action==='stop'?'STOPPED':'APPS_STOPPED',root}));
 }else if(action==='status')console.log(JSON.stringify({root,node,database:data,settings:s,postgres_running:pgRunning(),jobs:jobs().map(p=>({...p,owned:owned(p.pid)})),endpoints:await Promise.all(urls.map(async url=>({url,ok:await health(url)})))}));
 else throw Error('Use start, stop, stop-apps or status');
}catch(e){console.error(e.message);process.exitCode=1;}
