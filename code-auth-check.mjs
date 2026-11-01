import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createWorker } from './src/worker.mjs';
import { createCodeAuth, tokenHash, CODE_AUTH_LIMITS } from './src/code-auth.mjs';
import C from './src/core.mjs';

class SQLiteD1 {
  constructor() {
    this.sql = new DatabaseSync(':memory:'); this.sql.exec('PRAGMA foreign_keys=ON');
    for (const migration of ['0001_notebook.sql', '0002_code_auth.sql']) this.sql.exec(readFileSync(new URL('./migrations/' + migration, import.meta.url), 'utf8'));
  }
  withSession() { return this; }
  prepare(sql) {
    const db = this;
    return { sql, parameters: [], bind(...values) { this.parameters = values; return this; },
      async first() { return db.sql.prepare(this.sql).get(...this.parameters) || null; },
      async all() { return { results: db.sql.prepare(this.sql).all(...this.parameters) }; }
    };
  }
  async batch(statements) {
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(statement => {
        const compiled = this.sql.prepare(statement.sql);
        if (compiled.columns().length) return { results: compiled.all(...statement.parameters) };
        compiled.run(...statement.parameters); return { results: [] };
      });
      this.sql.exec('COMMIT'); return results;
    } catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}
const db = new SQLiteD1();
let clock = Date.now(), assetCalls = 0;
const worker = createWorker({ codeAuth: createCodeAuth({ now: () => clock }) });
const setupToken = randomBytes(32).toString('base64url');
const env = {
  AUTH_MODE: 'code', DB: db, OWNER_EMAIL: 'Owner@Example.com', AUTH_RATE_SECRET: randomBytes(32).toString('base64url'),
  SETUP_TOKEN_SHA256: await tokenHash(setupToken), SETUP_TOKEN_EXPIRES_AT: String(Math.floor(clock / 1000) + 600),
  ASSETS: { async fetch() { assetCalls++; return new Response('<html>private experiment table</html>', { headers: { 'Content-Type': 'text/html' } }); } }
};
async function call({ path = '/auth/status', method = 'GET', body, cookie, origin, headers = {}, runtime = env, base = 'https://lig.example.com', ip = '203.0.113.1', clientVersion = 'qc-records-v5' } = {}) {
  const requestHeaders = new Headers(headers);
  if (method === 'POST' && path === '/api/state' && clientVersion !== null) requestHeaders.set('X-LIG-Client-Version', clientVersion);
  if (cookie) requestHeaders.set('Cookie', cookie);
  if (origin !== null) requestHeaders.set('Origin', origin || base);
  if (body !== undefined && !requestHeaders.has('Content-Type')) requestHeaders.set('Content-Type', 'application/json');
  requestHeaders.set('CF-Connecting-IP', ip);
  const response = await worker.fetch(new Request(base + path, { method, headers: requestHeaders, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }), runtime, {});
  const text = await response.text();
  assert.match(response.headers.get('Cache-Control') || '', /no-store/);
  return { status: response.status, text, headers: response.headers, data: (response.headers.get('Content-Type') || '').includes('application/json') ? JSON.parse(text) : null };
}
function sessionCookie(result) { return result.headers.get('Set-Cookie')?.split(';')[0]; }
const login = (accessCode, extra = {}) => call({ path: '/auth/login', method: 'POST', body: { accessCode }, ...extra });
const setup = (candidate, extra = {}) => call({ path: '/auth/setup', method: 'POST', body: { setupToken: candidate }, ...extra });

// Closed configuration, explicit production HTTPS and unauthenticated separation.
assert.equal((await call({ runtime: { ...env, AUTH_RATE_SECRET: '' } })).status, 503);
assert.equal((await call({ runtime: { ...env, SETUP_TOKEN_SHA256: '' } })).status, 503);
assert.equal((await call({ base: 'http://lig.example.com' })).status, 403);
assert.deepEqual((await call()).data, { initialized: false, authenticated: false });
assert.equal((await call({ path: '/' })).status, 200); assert.equal(assetCalls, 0);
assert.equal((await call({ path: '/api/state' })).status, 401);
assert.equal((await setup('not-a-setup-token')).status, 401);
assert.equal((await setup(setupToken, { runtime: { ...env, SETUP_TOKEN_EXPIRES_AT: String(Math.floor(clock / 1000) - 1) } })).status, 410);
assert.equal(db.sql.prepare('SELECT count(*) AS n FROM lig_auth_owner').get().n, 0);

// Exactly one concurrent bootstrap response can reveal the server-generated code.
const initialized = await Promise.all([setup(setupToken, { ip: '203.0.113.2' }), setup(setupToken, { ip: '203.0.113.3' })]);
assert.deepEqual(initialized.map(result => result.status).sort(), [200, 409]);
const winner = initialized.find(result => result.status === 200), loser = initialized.find(result => result.status === 409);
assert.deepEqual(Object.keys(winner.data), ['accessCode']);
const accessCode = winner.data.accessCode;
assert.match(accessCode, /^[A-Za-z0-9_-]{43}$/); assert.equal(Buffer.from(accessCode, 'base64url').length, 32);
assert.ok(!Object.hasOwn(loser.data, 'accessCode')); assert.equal(loser.headers.get('Set-Cookie'), null);
const cookie1 = sessionCookie(winner), cookieHeader = winner.headers.get('Set-Cookie');
assert.match(cookieHeader, /^__Host-lig-session=/);
for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=604800']) assert.ok(cookieHeader.includes(flag));
assert.equal(cookieHeader.includes('Domain='), false);
assert.equal(db.sql.prepare('SELECT count(*) AS n FROM lig_auth_owner').get().n, 1);
assert.equal(db.sql.prepare('SELECT count(*) AS n FROM lig_auth_sessions').get().n, 1);
assert.equal(db.sql.prepare('SELECT access_code_hash FROM lig_auth_owner').get().access_code_hash, await tokenHash(accessCode));
assert.ok(!JSON.stringify(db.sql.prepare('SELECT * FROM lig_auth_owner').all()).includes(accessCode));
assert.equal(db.sql.prepare('SELECT session_hash FROM lig_auth_sessions').get().session_hash, await tokenHash(cookie1.split('=')[1]));
assert.deepEqual((await call({ cookie: cookie1 })).data, { initialized: true, authenticated: true });
assert.equal((await call({ path: '/', cookie: cookie1 })).status, 200); assert.equal(assetCalls, 1);
assert.equal((await setup(setupToken)).status, 409);
assert.equal((await setup('wrong', { runtime: { ...env, SETUP_TOKEN_SHA256: await tokenHash(randomBytes(32).toString('base64url')) } })).status, 409);
assert.equal((await call({ runtime: { ...env, OWNER_EMAIL: 'other@example.com' } })).status, 503);

// Bootstrap secrets can be removed after initialization. Both devices share the
// fixed owner namespace and keep independent sessions.
const daily = { ...env }; delete daily.SETUP_TOKEN_SHA256; delete daily.SETUP_TOKEN_EXPIRES_AT;
const second = await login(accessCode, { runtime: daily });
assert.equal(second.status, 200); assert.deepEqual(second.data, { ok: true });
const cookie2 = sessionCookie(second); assert.notEqual(cookie1, cookie2);
const state = { version: 3, groups: [C.createGroup({ power: 20, powerMode: 'percent', arrayPercent: 50, speed: 100, frequency: 100, spacing: 25 }, [])], selectedId: 'C001',lenses:[],qcReferences:[] };
state.groups[0].electrical[0].values = ['100'];
state.groups[0].legacyPowerW = 0.12;
state.groups[0].measuredPowerW = 0.0025;
for (const clientVersion of [null, 'old-ui', 'trash-v1']) {
  const outdated = await call({ path: '/api/state', method: 'POST', body: { state, expectedRevision: 0 }, cookie: cookie1, clientVersion });
  assert.equal(outdated.status, 426); assert.equal(outdated.data.code, 'CLIENT_UPDATE_REQUIRED');
}
assert.equal((await call({ path: '/api/state', method: 'POST', body: { state, expectedRevision: 0 }, clientVersion: null })).status, 401);
assert.equal((await call({ path: '/api/state', method: 'POST', body: { state, expectedRevision: 0 }, cookie: cookie1, clientVersion: null, origin: 'https://evil.example' })).status, 403);
assert.deepEqual((await call({ path: '/api/state', cookie: cookie1 })).data, { state: null, revision: 0 });
const saved = await call({ path: '/api/state', method: 'POST', body: { state, expectedRevision: 0 }, cookie: cookie1 });
assert.equal(saved.status, 200);
assert.deepEqual((await call({ path: '/api/state', cookie: cookie2 })).data, { state, revision: 1 });
assert.equal(db.sql.prepare('SELECT owner_id FROM lig_user_states').get().owner_id, 'owner:owner@example.com');
assert.equal((await call({ path: '/api/state', cookie: cookie1 + 'x' })).status, 401);
assert.equal((await call({ path: '/api/state', cookie: cookie1 + '; ' + cookie2 })).status, 401);
const loggedOut = await call({ path: '/auth/logout', method: 'POST', body: {}, cookie: cookie1 });
assert.equal(loggedOut.status, 200); assert.deepEqual(loggedOut.data, { ok: true }); assert.match(loggedOut.headers.get('Set-Cookie'), /Max-Age=0/);
assert.equal((await call({ path: '/api/state', cookie: cookie1 })).status, 401);
assert.equal((await call({ path: '/api/state', cookie: cookie2 })).status, 200);
clock += (CODE_AUTH_LIMITS.sessionSeconds + 1) * 1000;
assert.equal((await call({ path: '/api/state', cookie: cookie2 })).status, 401);
assert.deepEqual((await call({ cookie: cookie2 })).data, { initialized: true, authenticated: false });

// Auth endpoints enforce same-origin JSON and bounded bodies independently of
// application state APIs. There is no public reset or access-code lookup route.
for (const origin of [null, 'https://evil.example', 'null']) assert.equal((await login(accessCode, { origin })).status, 403);
assert.equal((await login(accessCode, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
assert.equal((await login(accessCode, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
assert.equal((await login(accessCode, { headers: { 'Content-Encoding': 'gzip' } })).status, 415);
assert.equal((await call({ path: '/auth/login', method: 'POST', body: '{' })).status, 400);
assert.equal((await call({ path: '/auth/login', method: 'POST', body: ' '.repeat(8193) })).status, 413);
assert.equal((await call({ path: '/auth/login', method: 'POST', body: {}, headers: { 'Content-Length': '8193' } })).status, 413);
assert.equal((await call({ path: '/auth/status', method: 'POST', body: {} })).status, 405);
assert.equal((await call({ path: '/auth/login', method: 'GET' })).status, 405);
assert.equal((await call({ path: '/auth/reset', method: 'POST', body: {} })).status, 404);

// IP and global failure cooldowns are finite; blocked retries do not extend them.
clock += 120000;
const wrongCode = randomBytes(32).toString('base64url');
for (let index = 0; index < CODE_AUTH_LIMITS.ipFailures; index++) assert.equal((await login(wrongCode, { ip: '198.51.100.7' })).status, 401);
const cooling = await login(accessCode, { ip: '198.51.100.7' });
assert.equal(cooling.status, 429); assert.equal(cooling.headers.get('Retry-After'), '60');
const blockedUntil = db.sql.prepare("SELECT blocked_until FROM lig_auth_rate_limits WHERE bucket_key LIKE 'login:ip:%' AND blocked_until > 0").get().blocked_until;
clock += 10000;
assert.equal((await login(wrongCode, { ip: '198.51.100.7' })).status, 429);
assert.equal(db.sql.prepare("SELECT blocked_until FROM lig_auth_rate_limits WHERE bucket_key LIKE 'login:ip:%' AND blocked_until > 0").get().blocked_until, blockedUntil);
clock += 51000;
assert.equal((await login(accessCode, { ip: '198.51.100.7' })).status, 200);
clock += 120000;
for (let index = 0; index < CODE_AUTH_LIMITS.globalFailures; index++) assert.equal((await login(wrongCode, { ip: '192.0.2.' + (index + 1) })).status, 401);
const globalCooling = await login(accessCode, { ip: '192.0.2.100' });
assert.equal(globalCooling.status, 429); assert.equal(globalCooling.headers.get('Retry-After'), '15');
clock += 16000;
assert.equal((await login(accessCode, { ip: '192.0.2.100' })).status, 200);
const rateRows = JSON.stringify(db.sql.prepare('SELECT * FROM lig_auth_rate_limits').all());
assert.ok(!rateRows.includes('198.51.100.7') && !rateRows.includes('192.0.2.') && !rateRows.includes(accessCode) && !rateRows.includes(env.AUTH_RATE_SECRET));

// Explicit HTTP development uses a distinct cookie; it never changes the
// production cookie, owner checks, or grants an HTTP production login.
const devRuntime = { ...daily, DEV_CODE_AUTH: 'true' };
const localLogin = await login(accessCode, { runtime: devRuntime, base: 'http://localhost:8770' });
assert.equal(localLogin.status, 200); assert.match(localLogin.headers.get('Set-Cookie'), /^lig-dev-session=/); assert.ok(!localLogin.headers.get('Set-Cookie').includes('; Secure'));
assert.equal((await call({ path: '/api/state', cookie: sessionCookie(localLogin), runtime: devRuntime, base: 'http://localhost:8770' })).status, 200);
assert.equal((await call({ path: '/api/state', cookie: sessionCookie(localLogin) })).status, 401);
assert.equal((await login(accessCode, { runtime: devRuntime, base: 'http://lig.example.com' })).status, 403);

// Administrator-only SQL recovery preserves experiment state. The old code is
// not revealed or accepted after a new bootstrap; no HTTP reset exists.
db.sql.exec('DELETE FROM lig_auth_owner WHERE singleton=1');
assert.equal(db.sql.prepare('SELECT count(*) AS n FROM lig_auth_sessions').get().n, 0);
assert.equal(db.sql.prepare('SELECT revision FROM lig_user_states WHERE owner_id=?').get('owner:owner@example.com').revision, 1);
const recoveryToken = randomBytes(32).toString('base64url');
const recoveredEnv = { ...daily, SETUP_TOKEN_SHA256: await tokenHash(recoveryToken), SETUP_TOKEN_EXPIRES_AT: String(Math.floor(clock / 1000) + 600) };
const recovered = await setup(recoveryToken, { runtime: recoveredEnv, ip: '198.51.100.100' });
assert.equal(recovered.status, 200); assert.notEqual(recovered.data.accessCode, accessCode);
assert.deepEqual((await call({ path: '/api/state', cookie: sessionCookie(recovered), runtime: recoveredEnv })).data, { state, revision: 1 });
assert.equal((await login(accessCode, { runtime: recoveredEnv, ip: '198.51.100.101' })).status, 401);
db.sql.close();
console.log('PASS: one-time concurrent bootstrap, hash-only storage, secure independent sessions, shared owner state, legacy-client writes rejected after auth and CSRF; setup replay/expiry, session expiry/logout, CSRF/JSON/8KB, finite IP/global throttles, local-only dev cookie, administrator recovery preserving data.');
