const encoder = new TextEncoder();
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const HASH = /^[a-f0-9]{64}$/;
const LOCAL = new Set(['localhost', '127.0.0.1']);
export const CODE_AUTH_LIMITS = Object.freeze({ bodyBytes: 8192, sessionSeconds: 7 * 86400, windowSeconds: 60, ipFailures: 5, globalFailures: 50, ipCooldownSeconds: 60, globalCooldownSeconds: 15 });

export class CodeAuthError extends Error {
  constructor(status, code, message, headers = {}) { super(message); this.status = status; this.code = code; this.headers = headers; }
}
function stop(status, code, message, headers) { throw new CodeAuthError(status, code, message, headers); }
function response(body, headers = {}) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', ...headers } });
}
function normalizedEmail(value) {
  if (typeof value !== 'string') return null;
  const result = value.trim().toLowerCase();
  return result.length <= 320 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(result) ? result : null;
}
function settings(request, env, url) {
  const email = normalizedEmail(env.OWNER_EMAIL), secret = env.AUTH_RATE_SECRET;
  if (!email || typeof secret !== 'string' || secret.length < 32 || secret.length > 512 || /\s/.test(secret)) stop(503, 'AUTH_NOT_CONFIGURED', '访问码登录尚未配置，当前站点暂不可用。');
  const dev = LOCAL.has(url.hostname) && env.DEV_CODE_AUTH === 'true';
  if (url.protocol !== 'https:' && !dev) stop(403, 'HTTPS_REQUIRED', '访问码登录只允许通过HTTPS访问。');
  if (!env.DB || typeof env.DB.prepare !== 'function' || typeof env.DB.batch !== 'function') stop(503, 'DATABASE_NOT_CONFIGURED', '云端数据库尚未连接。');
  const db = typeof env.DB.withSession === 'function' ? env.DB.withSession('first-primary') : env.DB;
  return { owner: 'owner:' + email, secret, dev, db, cookieName: dev ? 'lig-dev-session' : '__Host-lig-session', secure: url.protocol === 'https:' };
}
function bootstrap(env) {
  const hash = typeof env.SETUP_TOKEN_SHA256 === 'string' ? env.SETUP_TOKEN_SHA256.toLowerCase() : '';
  const expiryText = String(env.SETUP_TOKEN_EXPIRES_AT || '');
  const expires = /^\d+$/.test(expiryText) ? Number(expiryText) : NaN;
  if (!HASH.test(hash) || !Number.isSafeInteger(expires) || expires <= 0) stop(503, 'SETUP_NOT_CONFIGURED', '首次初始化尚未配置，请联系管理员。');
  return { hash, expires };
}
function sameOrigin(request, url) {
  const origin = request.headers.get('Origin'), site = request.headers.get('Sec-Fetch-Site');
  if ((origin !== null && origin !== url.origin) || (request.method === 'POST' && origin !== url.origin) || (site && site !== 'same-origin' && site !== 'none')) stop(403, 'ORIGIN_REJECTED', '登录操作只允许从本站发起。');
}
async function bodyJSON(request) {
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') stop(415, 'JSON_REQUIRED', '登录请求须使用application/json。');
  if (request.headers.get('Content-Encoding') && request.headers.get('Content-Encoding').toLowerCase() !== 'identity') stop(415, 'ENCODING_REJECTED', '不支持压缩登录请求。');
  const declared = request.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > CODE_AUTH_LIMITS.bodyBytes)) stop(413, 'AUTH_BODY_TOO_LARGE', '登录请求超过8KB。');
  if (!request.body) stop(400, 'INVALID_JSON', '登录请求正文不能为空。');
  const reader = request.body.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > CODE_AUTH_LIMITS.bodyBytes) { await reader.cancel().catch(() => {}); stop(413, 'AUTH_BODY_TOO_LARGE', '登录请求超过8KB。'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let result;
  try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { stop(400, 'INVALID_JSON', '登录请求不是有效JSON。'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) stop(400, 'INVALID_JSON', '登录请求必须是JSON对象。');
  return result;
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function tokenHash(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}
function equalHash(left, right) {
  if (!HASH.test(left) || !HASH.test(right)) return false;
  let difference = 0;
  for (let index = 0; index < 64; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
function cookieToken(request, name) {
  const matches = (request.headers.get('Cookie') || '').split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1);
  return TOKEN.test(value) ? value : null;
}
function cookie(config, value, clear = false) {
  return config.cookieName + '=' + value + '; Path=/; HttpOnly; SameSite=Strict' + (config.secure ? '; Secure' : '') + '; Max-Age=' + (clear ? 0 : CODE_AUTH_LIMITS.sessionSeconds) + (clear ? '; Expires=Thu, 01 Jan 1970 00:00:00 GMT' : '');
}
async function first(db, sql, ...parameters) { return db.prepare(sql).bind(...parameters).first(); }

export function createCodeAuth({ now = () => Date.now() } = {}) {
  const hmacKeys = new Map();
  const seconds = () => Math.floor(now() / 1000);
  async function context(request, env, url) {
    const config = settings(request, env, url);
    const owner = await first(config.db, 'SELECT owner_id, access_code_hash FROM lig_auth_owner WHERE singleton = 1');
    if (owner && owner.owner_id !== config.owner) stop(503, 'OWNER_CONFIGURATION_CHANGED', '所有者配置发生变化，请联系管理员核对。');
    if (!owner) bootstrap(env);
    return { ...config, initialized: Boolean(owner), codeHash: owner?.access_code_hash };
  }
  async function sessionOwner(request, config) {
    const token = cookieToken(request, config.cookieName);
    if (!token || !config.initialized) return null;
    const row = await first(config.db, 'SELECT owner_id FROM lig_auth_sessions WHERE session_hash = ? AND owner_id = ? AND expires_at > ?', await tokenHash(token), config.owner, seconds());
    return row?.owner_id || null;
  }
  async function keys(request, config, scope) {
    if (!hmacKeys.has(config.secret)) {
      if (hmacKeys.size > 1) hmacKeys.clear();
      hmacKeys.set(config.secret, await crypto.subtle.importKey('raw', encoder.encode(config.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
    }
    const suppliedIP = request.headers.get('CF-Connecting-IP') || '';
    const ip = /^[0-9a-fA-F:.]{1,64}$/.test(suppliedIP) ? suppliedIP : 'unknown';
    async function opaque(value) {
      const digest = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKeys.get(config.secret), encoder.encode(value)));
      return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    return [scope + ':ip:' + await opaque(scope + '|ip|' + ip), scope + ':global:' + await opaque(scope + '|global')];
  }
  async function checkCooldown(db, limits) {
    const result = await db.prepare('SELECT blocked_until FROM lig_auth_rate_limits WHERE bucket_key IN (?, ?)').bind(...limits).all();
    const until = Math.max(0, ...(result.results || []).map(row => row.blocked_until));
    if (until > seconds()) stop(429, 'AUTH_COOLDOWN', '尝试次数较多，请稍后再试。', { 'Retry-After': String(until - seconds()) });
  }
  function failureStatement(db, key, limit, cooldown, timestamp) {
    return db.prepare(`INSERT INTO lig_auth_rate_limits (bucket_key, window_started, failures, blocked_until) VALUES (?, ?, 1, 0)
      ON CONFLICT(bucket_key) DO UPDATE SET
      window_started = CASE WHEN ? >= window_started + 60 THEN ? ELSE window_started END,
      failures = CASE WHEN ? >= window_started + 60 THEN 1 ELSE MIN(failures + 1, 100000) END,
      blocked_until = CASE WHEN ? >= window_started + 60 THEN 0 WHEN failures + 1 >= ? THEN ? + ? ELSE blocked_until END`)
      .bind(key, timestamp, timestamp, timestamp, timestamp, timestamp, limit, timestamp, cooldown);
  }
  async function failCredential(config, rateKeys, code, message) {
    const timestamp = seconds();
    await config.db.batch([
      failureStatement(config.db, rateKeys[0], CODE_AUTH_LIMITS.ipFailures, CODE_AUTH_LIMITS.ipCooldownSeconds, timestamp),
      failureStatement(config.db, rateKeys[1], CODE_AUTH_LIMITS.globalFailures, CODE_AUTH_LIMITS.globalCooldownSeconds, timestamp),
      config.db.prepare('DELETE FROM lig_auth_rate_limits WHERE window_started < ? AND blocked_until < ?').bind(timestamp - 3600, timestamp)
    ]);
    stop(401, code, message);
  }
  async function newSession(config) {
    const value = randomToken(), hash = await tokenHash(value), timestamp = seconds();
    return { value, hash, timestamp, expires: timestamp + CODE_AUTH_LIMITS.sessionSeconds };
  }
  return {
    async authenticate(request, env, url = new URL(request.url)) {
      const config = await context(request, env, url), owner = await sessionOwner(request, config);
      if (!owner) stop(401, 'CODE_LOGIN_REQUIRED', '请先输入访问码登录。');
      return owner;
    },
    async handle(request, env, url = new URL(request.url)) {
      const config = await context(request, env, url);
      sameOrigin(request, url);
      if (url.search) stop(400, 'QUERY_REJECTED', '登录接口不接受查询参数。');
      if (url.pathname === '/auth/status') {
        if (request.method !== 'GET') stop(405, 'METHOD_NOT_ALLOWED', '状态接口仅支持GET。', { Allow: 'GET' });
        return response({ initialized: config.initialized, authenticated: Boolean(await sessionOwner(request, config)) });
      }
      if (!['/auth/setup', '/auth/login', '/auth/logout'].includes(url.pathname)) stop(404, 'NOT_FOUND', '登录接口不存在。');
      if (request.method !== 'POST') stop(405, 'METHOD_NOT_ALLOWED', '登录操作仅支持POST。', { Allow: 'POST' });
      const body = await bodyJSON(request);
      if (url.pathname === '/auth/logout') {
        const token = cookieToken(request, config.cookieName);
        if (token) await config.db.batch([config.db.prepare('DELETE FROM lig_auth_sessions WHERE session_hash = ? AND owner_id = ?').bind(await tokenHash(token), config.owner)]);
        return response({ ok: true }, { 'Set-Cookie': cookie(config, '', true) });
      }
      const rateKeys = await keys(request, config, url.pathname === '/auth/setup' ? 'setup' : 'login');
      await checkCooldown(config.db, rateKeys);
      if (url.pathname === '/auth/setup') {
        if (config.initialized) stop(409, 'ALREADY_INITIALIZED', '访问码已生成，不能再次查看或初始化。');
        const setup = bootstrap(env);
        if (setup.expires <= seconds()) stop(410, 'SETUP_EXPIRED', '初始化链接已过期，请联系管理员重新生成。');
        const candidate = typeof body.setupToken === 'string' ? body.setupToken.trim() : '';
        const hash = await tokenHash(candidate);
        if (!TOKEN.test(candidate) || !equalHash(hash, setup.hash)) return failCredential(config, rateKeys, 'INVALID_SETUP_TOKEN', '初始化凭证无效。');
        const accessCode = randomToken(), codeHash = await tokenHash(accessCode), session = await newSession(config);
        if (setup.expires <= seconds()) stop(410, 'SETUP_EXPIRED', '初始化链接已过期，请联系管理员重新生成。');
        const result = await config.db.batch([
          config.db.prepare(`INSERT INTO lig_auth_owner (singleton, owner_id, access_code_hash, initialized_at) VALUES (1, ?, ?, ?)
            ON CONFLICT(singleton) DO NOTHING RETURNING owner_id`).bind(config.owner, codeHash, session.timestamp),
          config.db.prepare(`INSERT INTO lig_auth_sessions (session_hash, owner_id, created_at, expires_at)
            SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM lig_auth_owner WHERE singleton = 1 AND owner_id = ? AND access_code_hash = ?)`)
            .bind(session.hash, config.owner, session.timestamp, session.expires, config.owner, codeHash)
        ]);
        if (!result[0]?.results?.length) stop(409, 'ALREADY_INITIALIZED', '访问码已由另一个请求生成，不能重复初始化。');
        return response({ accessCode }, { 'Set-Cookie': cookie(config, session.value) });
      }
      if (!config.initialized) stop(409, 'SETUP_REQUIRED', '请先使用初始化链接生成访问码。');
      const candidate = typeof body.accessCode === 'string' ? body.accessCode.trim() : '';
      const hash = await tokenHash(candidate);
      if (!TOKEN.test(candidate) || !equalHash(hash, config.codeHash)) return failCredential(config, rateKeys, 'INVALID_ACCESS_CODE', '访问码无效。');
      const session = await newSession(config);
      await config.db.batch([
        config.db.prepare('DELETE FROM lig_auth_sessions WHERE expires_at <= ?').bind(session.timestamp),
        config.db.prepare('INSERT INTO lig_auth_sessions (session_hash, owner_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(session.hash, config.owner, session.timestamp, session.expires),
        config.db.prepare('DELETE FROM lig_auth_rate_limits WHERE bucket_key = ?').bind(rateKeys[0])
      ]);
      return response({ ok: true }, { 'Set-Cookie': cookie(config, session.value) });
    }
  };
}
