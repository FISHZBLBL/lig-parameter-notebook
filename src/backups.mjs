const encoder=new TextEncoder();
export const BACKUP_POLICY=Object.freeze({daily:30,manual:7,timeZone:'Asia/Shanghai',dailyHour:22});
function dbSession(db){if(!db?.prepare||!db?.batch)throw new Error('BACKUP_DATABASE_NOT_CONFIGURED');return typeof db.withSession==='function'?db.withSession('first-primary'):db;}
function localDay(time){return new Date(time+8*3600000).toISOString().slice(0,10);}
function hex(buffer){return Array.from(new Uint8Array(buffer),value=>value.toString(16).padStart(2,'0')).join('');}
function metadata(row){return {id:row.snapshot_id,revision:row.source_revision,createdAt:row.created_at,kind:row.kind,bytes:row.state_bytes,sha256:row.sha256};}
export async function listBackups(env,owner){
  const db=dbSession(env.BACKUP_DB);
  const result=await db.prepare('SELECT snapshot_id,source_revision,created_at,kind,state_bytes,sha256 FROM lig_backup_snapshots WHERE owner_id=? ORDER BY created_at DESC,snapshot_id DESC LIMIT 37').bind(owner).all();
  return {backups:(result.results||[]).map(metadata),policy:BACKUP_POLICY};
}
export async function createBackup(env,owner,{kind='manual',time=Date.now(),initial=false}={}){
  const source=dbSession(env.DB),destination=dbSession(env.BACKUP_DB);
  if(!['manual','daily'].includes(kind)||!Number.isFinite(time))throw new Error('INVALID_BACKUP_REQUEST');
  const slot=kind==='daily'?localDay(time):initial?'initial':crypto.randomUUID();
  if(kind==='daily'||initial){const existing=await destination.prepare('SELECT snapshot_id,source_revision,created_at,kind,state_bytes,sha256 FROM lig_backup_snapshots WHERE owner_id=? AND kind=? AND slot=?').bind(owner,kind,slot).first();if(existing)return {backup:metadata(existing),existing:true};}
  const result=await source.prepare('SELECT s.revision,s.schema_version,s.chunk_count,s.state_bytes,c.chunk_index,c.state_chunk FROM lig_user_states s LEFT JOIN lig_state_chunks c ON c.owner_id=s.owner_id WHERE s.owner_id=? ORDER BY c.chunk_index').bind(owner).all();
  const rows=result.results||[];if(!rows.length)return {backup:null,empty:true};
  const first=rows[0];if(first.schema_version!==3||first.chunk_count!==rows.length||rows.some((row,index)=>row.revision!==first.revision||row.chunk_index!==index||typeof row.state_chunk!=='string'))throw new Error('SOURCE_BACKUP_CHUNKS_INVALID');
  const bytes=encoder.encode(rows.map(row=>row.state_chunk).join(''));if(bytes.byteLength!==first.state_bytes||bytes.byteLength>8388608)throw new Error('SOURCE_BACKUP_BYTES_INVALID');
  const sha256=hex(await crypto.subtle.digest('SHA-256',bytes)),id=crypto.randomUUID(),createdAt=new Date(time).toISOString();
  const statements=[destination.prepare('INSERT INTO lig_backup_snapshots(snapshot_id,owner_id,source_revision,created_at,kind,slot,chunk_count,state_bytes,sha256) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,kind,slot) DO NOTHING RETURNING snapshot_id').bind(id,owner,first.revision,createdAt,kind,slot,rows.length,bytes.byteLength,sha256)];
  for(const row of rows)statements.push(destination.prepare('INSERT INTO lig_backup_chunks(snapshot_id,chunk_index,state_chunk) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM lig_backup_snapshots WHERE snapshot_id=?)').bind(id,row.chunk_index,row.state_chunk,id));
  const saved=await destination.batch(statements);
  if(!saved[0]?.results?.length){const existing=await destination.prepare('SELECT snapshot_id,source_revision,created_at,kind,state_bytes,sha256 FROM lig_backup_snapshots WHERE owner_id=? AND kind=? AND slot=?').bind(owner,kind,slot).first();if(!existing)throw new Error('BACKUP_CREATE_CONFLICT');return {backup:metadata(existing),existing:true};}
  // Only old snapshots in this independent database are pruned; active notebook data is untouched.
  await destination.batch(['daily','manual'].map(type=>destination.prepare('DELETE FROM lig_backup_snapshots WHERE snapshot_id IN (SELECT snapshot_id FROM lig_backup_snapshots WHERE owner_id=? AND kind=? AND snapshot_id<>? ORDER BY created_at DESC,snapshot_id DESC LIMIT -1 OFFSET ?)').bind(owner,type,id,BACKUP_POLICY[type]-(type===kind?1:0))));
  return {backup:{id,revision:first.revision,createdAt,kind,bytes:bytes.byteLength,sha256},existing:false};
}
export async function readBackup(env,owner,id){
  if(typeof id!=='string'||!/^[-a-zA-Z0-9]{1,64}$/.test(id))return null;
  const db=dbSession(env.BACKUP_DB);
  const result=await db.prepare('SELECT s.*,c.chunk_index,c.state_chunk FROM lig_backup_snapshots s LEFT JOIN lig_backup_chunks c ON c.snapshot_id=s.snapshot_id WHERE s.owner_id=? AND s.snapshot_id=? ORDER BY c.chunk_index').bind(owner,id).all();
  const rows=result.results||[];if(!rows.length)return null;const first=rows[0];
  if(first.chunk_count!==rows.length||rows.some((row,index)=>row.chunk_index!==index||typeof row.state_chunk!=='string'))throw new Error('BACKUP_CHUNKS_INVALID');
  const serialized=rows.map(row=>row.state_chunk).join(''),bytes=encoder.encode(serialized);
  if(bytes.length!==first.state_bytes||hex(await crypto.subtle.digest('SHA-256',bytes))!==first.sha256)throw new Error('BACKUP_CHECKSUM_INVALID');
  return {serialized,backup:metadata(first)};
}
export async function scheduledBackups(env,time=Date.now()){
  const source=dbSession(env.DB),owners=await source.prepare('SELECT owner_id FROM lig_user_states').all();
  const results=[];for(const row of owners.results||[])results.push(await createBackup(env,row.owner_id,{kind:'daily',time}));return results;
}
