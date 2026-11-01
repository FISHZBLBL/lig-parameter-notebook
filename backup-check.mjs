import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWorker} from './src/worker.mjs';
import {createBackup,listBackups,readBackup,scheduledBackups} from './src/backups.mjs';
import C from './src/core.mjs';
class D1{
  constructor(migration){this.sql=new DatabaseSync(':memory:');this.sql.exec('PRAGMA foreign_keys=ON');this.sql.exec(readFileSync(new URL(migration,import.meta.url),'utf8'));this.failAt=-1;}
  withSession(){return this;}
  prepare(sql){const db=this;return {parameters:[],bind(...args){this.parameters=args;return this;},async all(){return {results:db.sql.prepare(sql).all(...this.parameters)};},async first(){return db.sql.prepare(sql).get(...this.parameters)||null;},sql};}
  async batch(statements){this.sql.exec('BEGIN IMMEDIATE');try{const result=statements.map((s,i)=>{if(this.failAt===i)throw Error('forced rollback');const compiled=this.sql.prepare(s.sql);return compiled.columns().length?{results:compiled.all(...s.parameters)}:{results:[],meta:{changes:compiled.run(...s.parameters).changes}};});this.sql.exec('COMMIT');return result;}catch(error){this.sql.exec('ROLLBACK');throw error;}finally{this.failAt=-1;}}
}
const source=new D1('./migrations/0001_notebook.sql'),backup=new D1('./backup-migrations/0001_backups.sql');
const env={DB:source,BACKUP_DB:backup,DEV_USER_ID:'backup-owner'},owner='dev:backup-owner',worker=createWorker();
async function call(path='/api/backups',method='GET',body,runtime=env,origin='http://localhost'){
  const response=await worker.fetch(new Request('http://localhost'+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-LIG-Client-Version':'qc-records-v5'},...(body!==undefined?{body:JSON.stringify(body)}:{})}),runtime);
  return {response,status:response.status,text:await response.text()};
}
const group=C.createGroup({id:'TEST-BACKUP',powerMode:'percent',power:3,arrayPercent:100,speed:5,frequency:800,spacing:10,electricalCount:3,characterizationCount:1,readingsPerSample:5,measurementLayout:'sample-repeats-v4',notes:'保留中文😀原始数据'},[]);
group.electrical[0].values=['201.11','202.23','203.37','204.41','205.59'];
const state=C.createQCRun(C.addQCReference({version:3,groups:[group],selectedId:group.id,lenses:[],qcReferences:[]},group.id),'QC-1',{date:'2026-11-01'});
assert.equal((await call('/api/state','POST',{state,expectedRevision:0})).status,200);
assert.deepEqual((await listBackups(env,owner)).backups,[]);
const first=await createBackup(env,owner,{time:Date.parse('2026-11-01T00:00:00Z'),initial:true});
assert.equal(first.backup.revision,1);assert.equal((await createBackup(env,owner,{initial:true})).backup.id,first.backup.id);
const download=await call('/api/backups/'+first.backup.id);assert.equal(download.status,200);assert.deepEqual(JSON.parse(download.text),state);assert.ok(download.response.headers.get('Content-Disposition').includes('attachment'));
assert.deepEqual(C.validateState(JSON.parse(download.text)),C.validateState(state));
assert.equal((await call('/api/backups/'+first.backup.id,'GET',undefined,{...env,DEV_USER_ID:'other-owner'})).status,404);
assert.equal((await call('/api/backups','POST',{},env,'http://evil.example')).status,403);
assert.equal((await call('/api/backups','DELETE')).status,405);
const countBefore=backup.sql.prepare('SELECT count(*) AS n FROM lig_backup_snapshots').get().n;
backup.failAt=1;await assert.rejects(()=>createBackup(env,owner),/forced rollback/);assert.equal(backup.sql.prepare('SELECT count(*) AS n FROM lig_backup_snapshots').get().n,countBefore);
assert.deepEqual(JSON.parse((await call('/api/state')).text).state,state,'backup failure must not alter current notebook');
for(let i=0;i<35;i++)await scheduledBackups(env,Date.parse('2026-10-01T14:00:00Z')+i*86400000);
assert.equal(backup.sql.prepare("SELECT count(*) AS n FROM lig_backup_snapshots WHERE kind='daily'").get().n,30);
for(let i=0;i<9;i++)await createBackup(env,owner,{time:Date.parse('2026-11-01T00:00:00Z')+i*1000});
assert.equal(backup.sql.prepare("SELECT count(*) AS n FROM lig_backup_snapshots WHERE kind='manual'").get().n,7);
assert.equal(backup.sql.prepare('SELECT count(*) AS n FROM lig_backup_chunks WHERE snapshot_id NOT IN(SELECT snapshot_id FROM lig_backup_snapshots)').get().n,0);
const latest=(await listBackups(env,owner)).backups[0];backup.sql.prepare('UPDATE lig_backup_chunks SET state_chunk=? WHERE snapshot_id=? AND chunk_index=0').run('corrupt',latest.id);await assert.rejects(()=>readBackup(env,owner,latest.id),/CHECKSUM|CHUNKS/);
const largeGroup={...group,id:'UNICODE',notes:'😀'.repeat(1500)},large={version:3,groups:[],selectedId:'L000',lenses:[],qcReferences:[]};
for(let i=0;i<200;i++)large.groups.push({...largeGroup,id:'L'+String(i).padStart(3,'0')});
assert.equal((await call('/api/state','POST',{state:large,expectedRevision:1})).status,200);
const largeBackup=await createBackup(env,owner);assert.ok(largeBackup.backup.bytes>1000000);assert.deepEqual(JSON.parse((await readBackup(env,owner,largeBackup.backup.id)).serialized),large);
assert.equal((await call('/api/backups')).status,200);
await worker.scheduled({scheduledTime:Date.parse('2026-12-01T14:00:00Z')},env);
assert.ok((await listBackups(env,owner)).backups.some(s=>s.kind==='daily'&&s.createdAt==='2026-12-01T14:00:00.000Z'));
source.sql.close();backup.sql.close();
console.log('PASS: independent SQLite backup DB, original JSON restore read, owner isolation, CSRF, atomic rollback, source preservation, 30 daily/7 manual retention, cascade cleanup, checksum verification, Unicode multi-chunk copy and scheduled handler.');
