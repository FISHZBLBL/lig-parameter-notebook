import { createRemoteJWKSet, jwtVerify } from 'jose';
import LIGCore from './core.mjs';
import LOGIN_HTML from './login-page.mjs';
import { createCodeAuth, CodeAuthError } from './code-auth.mjs';
import {createBackup,listBackups,readBackup,scheduledBackups} from './backups.mjs';

export const LIMITS = Object.freeze({ requestBytes: 8 * 1024 * 1024, chunkCharacters: 400000 });
const encoder = new TextEncoder();
const localHosts = new Set(['localhost', '127.0.0.1']);

class HTTPError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', ...extraHeaders }
  });
}
function userId(value) {
  return typeof value === 'string' && /^[^\s\u0000-\u001f\u007f]{1,256}$/.test(value) ? value : null;
}
function configuration(env) {
  try {
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.OWNER_EMAIL) return null;
    const rawDomain = String(env.ACCESS_TEAM_DOMAIN).trim();
    const domain = new URL(rawDomain.includes('://') ? rawDomain : 'https://' + rawDomain);
    if (domain.protocol !== 'https:' || domain.username || domain.password || domain.port || domain.pathname !== '/' || domain.search || domain.hash) return null;
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(domain.hostname)) return null;
    const audience = userId(env.ACCESS_AUD);
    const email = String(env.OWNER_EMAIL).trim().toLowerCase();
    if (!audience || email.length > 320 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
    return { issuer: domain.origin, audience, email };
  } catch { return null; }
}
function checkOrigin(request, url) {
  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (origin !== null && origin !== url.origin) throw new HTTPError(403, 'ORIGIN_REJECTED', '只允许从本站访问云端记录。');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') throw new HTTPError(403, 'ORIGIN_REJECTED', '只允许从本站访问云端记录。');
  if (request.method === 'POST' && origin !== url.origin) throw new HTTPError(403, 'ORIGIN_REQUIRED', '保存请求缺少本站来源，请刷新网页后重试。');
}
async function readBody(request) {
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new HTTPError(415, 'JSON_REQUIRED', '保存请求须使用 application/json。');
  const encoding = request.headers.get('Content-Encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') throw new HTTPError(415, 'ENCODING_REJECTED', '不支持压缩请求正文。');
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) throw new HTTPError(400, 'INVALID_LENGTH', '请求长度无效。');
    if (Number(declaredLength) > LIMITS.requestBytes) throw new HTTPError(413, 'STATE_TOO_LARGE', '记录超过8MiB，请先导出备份并减少本次记录。');
  }
  if (!request.body) throw new HTTPError(400, 'INVALID_JSON', '请求正文为空。');
  const reader = request.body.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > LIMITS.requestBytes) {
        await reader.cancel().catch(() => {});
        throw new HTTPError(413, 'STATE_TOO_LARGE', '记录超过8MiB，请先导出备份并减少本次记录。');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new HTTPError(400, 'INVALID_JSON', '请求正文不是有效的UTF-8 JSON。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HTTPError(400, 'INVALID_BODY', '请求正文必须包含 state 和 expectedRevision。');
  return body;
}
function splitState(text) {
  const chunks = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + LIMITS.chunkCharacters, text.length);
    const last = text.charCodeAt(end - 1), next = text.charCodeAt(end);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
    chunks.push(text.slice(offset, end)); offset = end;
  }
  return chunks;
}
function database(env) {
  if (!env.DB || typeof env.DB.prepare !== 'function' || typeof env.DB.batch !== 'function') throw new HTTPError(503, 'DATABASE_NOT_CONFIGURED', '云端数据库尚未连接，请保留本地记录。');
  return typeof env.DB.withSession === 'function' ? env.DB.withSession('first-primary') : env.DB;
}
async function loadState(db, owner) {
  const result = await db.prepare(`SELECT s.revision, s.schema_version, s.chunk_count, s.state_bytes,
    c.chunk_index, c.state_chunk FROM lig_user_states AS s
    LEFT JOIN lig_state_chunks AS c ON c.owner_id = s.owner_id
    WHERE s.owner_id = ? ORDER BY c.chunk_index`).bind(owner).all();
  const rows = result.results || [];
  if (!rows.length) return { state: null, revision: 0 };
  const first = rows[0];
  if (first.schema_version !== 3 || !Number.isSafeInteger(first.revision) || first.revision < 1 || first.chunk_count !== rows.length) throw new Error('Stored state metadata invalid');
  if (rows.some((row, index) => row.chunk_index !== index || typeof row.state_chunk !== 'string')) throw new Error('Stored state chunks invalid');
  const text = rows.map(row => row.state_chunk).join('');
  if (encoder.encode(text).byteLength !== first.state_bytes || first.state_bytes > LIMITS.requestBytes) throw new Error('Stored state length invalid');
  return { state: LIGCore.validateState(JSON.parse(text)), revision: first.revision };
}
async function saveState(db, owner, state, expectedRevision) {
  const serialized = JSON.stringify(state), bytes = encoder.encode(serialized).byteLength;
  if (bytes > LIMITS.requestBytes) throw new HTTPError(413, 'STATE_TOO_LARGE', '规范化后的记录超过8MiB，未保存。');
  const chunks = splitState(serialized), token = crypto.randomUUID(), now = new Date().toISOString();
  const mutation = expectedRevision === 0
    ? db.prepare(`INSERT INTO lig_user_states (owner_id, revision, schema_version, chunk_count, state_bytes, write_token, created_at, updated_at)
        VALUES (?, 1, 3, ?, ?, ?, ?, ?) ON CONFLICT(owner_id) DO NOTHING RETURNING revision`)
      .bind(owner, chunks.length, bytes, token, now, now)
    : db.prepare(`UPDATE lig_user_states SET revision = revision + 1, schema_version = 3, chunk_count = ?, state_bytes = ?, write_token = ?, updated_at = ?
        WHERE owner_id = ? AND revision = ? RETURNING revision`)
      .bind(chunks.length, bytes, token, now, owner, expectedRevision);
  // D1 batch() is one transaction. The fresh token makes every chunk mutation a
  // no-op when CAS failed, including a concurrent initial INSERT conflict.
  const statements = [mutation, db.prepare(`DELETE FROM lig_state_chunks WHERE owner_id = ?
    AND EXISTS (SELECT 1 FROM lig_user_states WHERE owner_id = ? AND write_token = ?)`).bind(owner, owner, token)];
  chunks.forEach((chunk, index) => {
    statements.push(db.prepare(`INSERT INTO lig_state_chunks (owner_id, chunk_index, state_chunk)
      SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM lig_user_states WHERE owner_id = ? AND write_token = ?)`)
      .bind(owner, index, chunk, owner, token));
  });
  const result = await db.batch(statements);
  const revision = result[0]?.results?.[0]?.revision;
  if (revision === undefined) return json({ error: '其他设备已更新记录，请核对云端版本后再保存。', code: 'REVISION_CONFLICT', ...await loadState(db, owner) }, 409);
  return json({ state, revision });
}

export function createWorker({ keySetFactory = createRemoteJWKSet, codeAuth = createCodeAuth() } = {}) {
  const keySets = new Map();
  async function authenticate(request, env, url) {
    // DEV_USER_ID is server configuration, never a request header. It works only
    // on literal local hostnames and must be omitted from every deployed config.
    if (localHosts.has(url.hostname) && userId(env.DEV_USER_ID)) return 'dev:' + env.DEV_USER_ID;
    const config = configuration(env);
    if (!config) throw new HTTPError(503, 'AUTH_NOT_CONFIGURED', '云端登录尚未配置，当前站点暂不可用。');
    const token = request.headers.get('CF-Access-Jwt-Assertion');
    if (!token || token.length > 16384) throw new HTTPError(401, 'AUTH_REQUIRED', '请通过本站登录入口登录后重试。');
    if (!keySets.has(config.issuer)) {
      if (keySets.size >= 4) keySets.delete(keySets.keys().next().value);
      keySets.set(config.issuer, keySetFactory(new URL(config.issuer + '/cdn-cgi/access/certs'), { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000 }));
    }
    let payload;
    try {
      ({ payload } = await jwtVerify(token, keySets.get(config.issuer), {
        issuer: config.issuer, audience: config.audience, algorithms: ['RS256'],
        requiredClaims: ['exp', 'iat', 'sub', 'email'], clockTolerance: 0
      }));
    } catch { throw new HTTPError(401, 'INVALID_ACCESS_TOKEN', '登录凭证无效或已过期，请重新登录。'); }
    if (payload.type !== 'app' || !userId(payload.sub) || typeof payload.email !== 'string') throw new HTTPError(401, 'INVALID_ACCESS_IDENTITY', '需要本人登录身份，不能使用匿名或服务凭证。');
    if (payload.email.trim().toLowerCase() !== config.email) throw new HTTPError(403, 'OWNER_ONLY', '此站点仅限所有者访问。');
    return 'access:' + new URL(config.issuer).hostname + ':' + payload.sub;
  }
  return {
    async scheduled(controller,env){await scheduledBackups(env,controller.scheduledTime);},
    async fetch(request, env = {}, ctx) {
      try {
        const url = new URL(request.url);
        const mode = env.AUTH_MODE || 'access';
        if (!['access', 'code'].includes(mode)) throw new HTTPError(503, 'AUTH_NOT_CONFIGURED', '登录方式尚未配置。');
        if (mode === 'code' && (url.pathname === '/auth' || url.pathname.startsWith('/auth/'))) return await codeAuth.handle(request, env, url);
        let owner;
        if (mode === 'code') {
          try { owner = await codeAuth.authenticate(request, env, url); }
          catch (error) {
            if (error instanceof CodeAuthError && error.status === 401 && ['/', '/index.html'].includes(url.pathname) && ['GET', 'HEAD'].includes(request.method)) {
              return new Response(request.method === 'HEAD' ? null : LOGIN_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } });
            }
            throw error;
          }
        } else owner = await authenticate(request, env, url);
        if (url.pathname === '/auth' || url.pathname.startsWith('/auth/')) throw new HTTPError(404, 'NOT_FOUND', '登录接口不存在。');
        if(url.pathname==='/api/backups'||url.pathname.startsWith('/api/backups/')){
          checkOrigin(request,url);if(url.search)throw new HTTPError(400,'QUERY_REJECTED','备份接口不接受查询参数。');
          if(url.pathname==='/api/backups'){
            if(request.method==='GET')return json(await listBackups(env,owner));
            if(request.method==='POST'){await readBody(request);return json(await createBackup(env,owner));}
            return json({error:'此接口仅支持GET和POST。'},405,{Allow:'GET, POST'});
          }
          if(request.method!=='GET')return json({error:'仅支持下载备份。'},405,{Allow:'GET'});
          const result=await readBackup(env,owner,url.pathname.slice('/api/backups/'.length));
          if(!result)throw new HTTPError(404,'BACKUP_NOT_FOUND','备份不存在或不属于此账号。');
          return new Response(result.serialized,{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="LIG_backup_${result.backup.createdAt.slice(0,10)}_rev${result.backup.revision}.json"`,'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'}});
        }
        if (url.pathname === '/api/state') {
          if (url.search) throw new HTTPError(400, 'QUERY_REJECTED', '此接口不接受查询参数。');
          if (!['GET', 'POST'].includes(request.method)) return json({ error: '此接口仅支持GET和POST。', code: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST' });
          checkOrigin(request, url);
          const db = database(env);
          if (request.method === 'GET') {
            const current=await loadState(db,owner);
            if(current.state&&env.BACKUP_DB&&ctx?.waitUntil)ctx.waitUntil(createBackup(env,owner,{initial:true}).catch(()=>console.error('LIG_INITIAL_BACKUP_FAILED')));
            return json(current);
          }
          // Older open tabs strip deletion and legacy-power metadata while normalizing state.
          // Keep their drafts intact, but require a fresh client before writing.
          if (request.headers.get('X-LIG-Client-Version') !== 'qc-records-v5') throw new HTTPError(426, 'CLIENT_UPDATE_REQUIRED', '网站已更新，请先下载本机完整备份，再刷新网页后继续同步。本机修改仍保留。');
          const body = await readBody(request);
          if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision >= Number.MAX_SAFE_INTEGER) throw new HTTPError(400, 'INVALID_REVISION', 'expectedRevision须为非负整数。');
          let state;
          try { state = LIGCore.validateState(body.state); }
          catch (error) { throw new HTTPError(422, 'INVALID_STATE', error.message || '实验记录格式无效。'); }
          return await saveState(db, owner, state, body.expectedRevision);
        }
        if (url.pathname === '/api' || url.pathname.startsWith('/api/')) throw new HTTPError(404, 'NOT_FOUND', '接口不存在。');
        if (!['GET', 'HEAD'].includes(request.method)) return json({ error: '静态页面仅支持GET和HEAD。', code: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, HEAD' });
        if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') throw new HTTPError(404, 'NOT_FOUND', '页面不存在。');
        const asset = await env.ASSETS.fetch(request);
        const headers = new Headers(asset.headers);
        headers.set('Cache-Control', 'no-store, private'); headers.set('X-Content-Type-Options', 'nosniff');
        return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
      } catch (error) {
        if (error instanceof HTTPError) return json({ error: error.message, code: error.code }, error.status);
        if (error instanceof CodeAuthError) return json({ error: error.message, code: error.code }, error.status, error.headers);
        return json({ error: '云端服务暂时不可用，请保留本地草稿后重试。', code: 'SERVICE_UNAVAILABLE' }, 503);
      }
    }
  };
}

export default createWorker();
