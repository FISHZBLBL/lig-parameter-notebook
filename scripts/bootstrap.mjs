import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cli=path.join(root,'node_modules/wrangler/bin/wrangler.js');
async function wrangler(args,input) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[cli,...args],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,CI:'true'}});
    let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
    child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(new Error('Wrangler failed: '+output)));
    child.stdin.end(input===undefined?'':input+'\n');
  });
}
await wrangler(['d1','migrations','apply','DB','--remote']);
const listing=await wrangler(['d1','execute','DB','--remote','--command','SELECT COUNT(*) AS total FROM lig_auth_owner','--json']);
const start=listing.indexOf('['),end=listing.lastIndexOf(']');
const data=JSON.parse(listing.slice(start,end+1));
if(data[0]?.results?.[0]?.total!==0)throw new Error('Owner already initialized; existing access code was not changed.');
const setupToken=randomBytes(32).toString('base64url');
const setupHash=createHash('sha256').update(setupToken).digest('hex');
const rateSecret=randomBytes(32).toString('base64url');
await wrangler(['secret','put','SETUP_TOKEN_SHA256'],setupHash);
await wrangler(['secret','put','AUTH_RATE_SECRET'],rateSecret);
const configPath=path.join(root,'wrangler.jsonc'),config=JSON.parse(fs.readFileSync(configPath,'utf8'));
const expiresAt=Math.floor(Date.now()/1000)+1800;
config.vars.AUTH_MODE='code';config.vars.SETUP_TOKEN_EXPIRES_AT=String(expiresAt);
delete config.vars.ACCESS_TEAM_DOMAIN;delete config.vars.ACCESS_AUD;
fs.writeFileSync(configPath,JSON.stringify(config,null,2)+'\n');
const deployed=await wrangler(['deploy']);
const match=deployed.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/);
if(!match)throw new Error('Deployment URL missing; do not create the owner until deployment is verified.');
// Caller keeps this one-time invitation in session memory. It is not a login
// access code. The actual access code is generated later by the owner's browser
// action and is never available to this helper.
process.stdout.write('SETUP_READY '+JSON.stringify({url:match[0]+'/#setup='+setupToken,origin:match[0],expiresAt})+'\n');
