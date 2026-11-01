import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import C from '../src/core.mjs';

// Read-only export of notebook content. Authentication tables and credentials are never exported.
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=app;
const outputDirectory=path.join(root,'backups','lig-cloud');
async function main(){
  const config=JSON.parse(await fs.readFile(path.join(app,'wrangler.jsonc'),'utf8'));
  const owner='owner:'+config.vars.OWNER_EMAIL.trim().toLowerCase();
  const sql=`SELECT s.revision,s.schema_version,s.chunk_count,s.state_bytes,c.chunk_index,c.state_chunk FROM lig_user_states s JOIN lig_state_chunks c ON c.owner_id=s.owner_id WHERE s.owner_id='${owner.replaceAll("'","''")}' ORDER BY c.chunk_index`;
  let raw;
  try{raw=execFileSync(process.execPath,['--dns-result-order=ipv4first',path.join(app,'node_modules/wrangler/bin/wrangler.js'),'d1','execute','lig-lab-notebook','--remote','--json','--command',sql],{cwd:app,encoding:'utf8',maxBuffer:64*1024*1024,timeout:120000,windowsHide:true,stdio:['ignore','pipe','pipe']});}
  catch{throw Object.assign(new Error('Cloudflare read-only export failed; check network and authorization'),{code:'REMOTE_EXPORT_FAILED'});}
  const response=JSON.parse(raw),rows=response[0]?.results;
  if(!Array.isArray(rows)||!rows.length)throw Object.assign(new Error('No saved cloud notebook found; existing backups are untouched'),{code:'NO_CLOUD_NOTEBOOK'});
  const first=rows[0];
  if(first.schema_version!==3||first.chunk_count!==rows.length||rows.some((row,index)=>row.revision!==first.revision||row.chunk_index!==index||typeof row.state_chunk!=='string'))throw Object.assign(new Error('Cloud notebook chunks are incomplete'),{code:'INVALID_CHUNKS'});
  const serialized=rows.map(row=>row.state_chunk).join(''),bytes=Buffer.from(serialized,'utf8');
  if(bytes.length!==first.state_bytes)throw Object.assign(new Error('Cloud notebook byte count mismatch'),{code:'BYTE_COUNT_MISMATCH'});
  const state=JSON.parse(serialized);C.validateState(state);
  const hash=createHash('sha256').update(bytes).digest('hex');
  const now=new Date(),localStamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now).replaceAll(':','').replace(' ','_');
  await fs.mkdir(outputDirectory,{recursive:true});
  try{await fs.writeFile(path.join(root,'backups','.gitignore'),'*\n!.gitignore\n',{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
  const filename=`LIG_${localStamp}_${now.getMilliseconds()}_rev${first.revision}.json`,destination=path.join(outputDirectory,filename),temporary=destination+'.tmp';
  await fs.writeFile(temporary,bytes,{flag:'wx'});
  const verify=await fs.readFile(temporary);
  if(createHash('sha256').update(verify).digest('hex')!==hash)throw Object.assign(new Error('Local backup verification failed'),{code:'LOCAL_HASH_MISMATCH'});
  C.validateState(JSON.parse(verify.toString('utf8')));
  await fs.rename(temporary,destination);
  await fs.writeFile(destination+'.sha256',`${hash}  ${filename}\n`,{flag:'wx'});
  const metadata={backupPath:destination,createdAt:now.toISOString(),revision:first.revision,groups:state.groups.length,lenses:state.lenses?.length||0,bytes:bytes.length,sha256:hash,verified:true};
  await fs.writeFile(path.join(outputDirectory,'latest.json'),JSON.stringify(metadata,null,2)+'\n');
  console.log(JSON.stringify(metadata));
}
main().catch(error=>{console.error(JSON.stringify({ok:false,code:error.code||'BACKUP_FAILED',message:'备份未完成，已有备份和云端记录均未覆盖；请检查网络、存储空间和Cloudflare授权。'}));process.exitCode=1;});
