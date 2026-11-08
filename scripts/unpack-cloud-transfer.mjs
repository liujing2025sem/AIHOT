// Materialize the private Drive snapshot. This does not connect to a database or call a model.
import fs from 'node:fs';
import path from 'node:path';

const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node scripts/unpack-cloud-transfer.mjs PRIVATE_SNAPSHOT.json NEW_PRIVATE_DIRECTORY');
const snapshot=JSON.parse(fs.readFileSync(input,'utf8'));
if(snapshot.format!=='aihot.cloud-transfer.v1'||snapshot.database?.format!=='postgres-custom')throw Error('Unsupported snapshot');
const root=path.resolve(output);
if(fs.existsSync(root))throw Error('Use a new private directory; existing files will not be replaced');
const entries=(snapshot.camos?.files??[]).map(file=>{
  const relative=String(file.path).replaceAll('\\','/');
  if(!/^(app|data\/expert_knowledge)\//.test(relative)||relative.split('/').some(p=>p==='..'||p==='.'||!p)||typeof file.content!=='string')throw Error('Invalid CAMOS file path');
  return {target:path.join(root,'camos',...relative.split('/')),content:file.content};
});
fs.mkdirSync(root,{recursive:true,mode:0o700});
fs.writeFileSync(path.join(root,'database.dump'),Buffer.from(snapshot.database.base64,'base64'),{mode:0o600});
for(const file of entries){fs.mkdirSync(path.dirname(file.target),{recursive:true,mode:0o700});fs.writeFileSync(file.target,file.content,{mode:0o600});}
fs.writeFileSync(path.join(root,'current-work.json'),JSON.stringify(snapshot.current_work,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({directory:root,database:path.join(root,'database.dump'),camos:path.join(root,'camos'),currentWork:path.join(root,'current-work.json'),capturedAt:snapshot.capturedAt,counts:snapshot.current_work.counts,modelCalled:false,databaseRestored:false,credentialsIncluded:false},null,2));
