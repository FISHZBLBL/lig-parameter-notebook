import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { createWorker, LIMITS } from './src/worker.mjs';
import C from './src/core.mjs';

class SQLiteD1 {
  constructor() {
    this.sql = new DatabaseSync(':memory:');
    this.sql.exec('PRAGMA foreign_keys=ON');
    this.sql.exec(readFileSync(new URL('./migrations/0001_notebook.sql', import.meta.url), 'utf8'));
    this.queries = []; this.sessions = []; this.failAt = -1;
  }
  withSession(mode) { this.sessions.push(mode); return this; }
  prepare(sql) {
    this.queries.push(sql);
    const db = this;
    return {
      sql, parameters: [],
      bind(...parameters) { this.parameters = parameters; return this; },
      async all() { return { success: true, results: db.sql.prepare(this.sql).all(...this.parameters) }; },
      async first() { return db.sql.prepare(this.sql).get(...this.parameters) || null; }
    };
  }
  async batch(statements) {
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement, index) => {
        if (this.failAt === index) throw new Error('forced private SQL failure');
        const compiled = this.sql.prepare(statement.sql);
        if (compiled.columns().length) return { success: true, results: compiled.all(...statement.parameters) };
        const { changes } = compiled.run(...statement.parameters);
        return { success: true, results: [], meta: { changes } };
      });
      this.sql.exec('COMMIT'); return results;
    } catch (error) { this.sql.exec('ROLLBACK'); throw error; }
    finally { this.failAt = -1; }
  }
}

const db = new SQLiteD1();
let assetRequests = 0, jwksFactories = 0;
const { privateKey, publicKey } = await generateKeyPair('RS256');
const publicJWK = { ...await exportJWK(publicKey), kid: 'test-key', use: 'sig', alg: 'RS256' };
const worker = createWorker({ keySetFactory(url) {
  assert.equal(url.href, 'https://lig-test.cloudflareaccess.com/cdn-cgi/access/certs');
  jwksFactories++; return createLocalJWKSet({ keys: [publicJWK] });
} });
const env = {
  DB: db, ACCESS_TEAM_DOMAIN: 'lig-test.cloudflareaccess.com', ACCESS_AUD: 'lig-test-audience', OWNER_EMAIL: 'owner@example.com',
  ASSETS: { async fetch(request) {
    assetRequests++;
    return new URL(request.url).pathname === '/' ? new Response('<html>private notebook</html>', { headers: { 'Content-Type': 'text/html' } }) : new Response('not found', { status: 404 });
  } }
};
async function signed({ email = 'owner@example.com', issuer = 'https://lig-test.cloudflareaccess.com', audience = 'lig-test-audience', subject = 'owner-subject', type = 'app', expiration = '5m', notBefore, algorithm = 'RS256', noExpiration = false } = {}) {
  let jwt = new SignJWT({ email, type }).setProtectedHeader({ alg: algorithm, kid: 'test-key' }).setIssuer(issuer).setAudience(audience).setSubject(subject).setIssuedAt();
  if (!noExpiration) jwt = jwt.setExpirationTime(expiration);
  if (notBefore !== undefined) jwt = jwt.setNotBefore(notBefore);
  return jwt.sign(algorithm === 'HS256' ? new Uint8Array(32).fill(9) : privateKey);
}
const token = await signed();
async function call({ method = 'GET', path = '/api/state', body, origin, headers = {}, token: credential = token, runtime = env, hostname = 'lig.example.com', context = {}, clientVersion = 'qc-records-v5' } = {}) {
  const requestHeaders = new Headers(headers);
  if (method === 'POST' && path === '/api/state' && clientVersion !== null) requestHeaders.set('X-LIG-Client-Version', clientVersion);
  if (credential !== null) requestHeaders.set('CF-Access-Jwt-Assertion', credential);
  if (body !== undefined && !requestHeaders.has('Content-Type')) requestHeaders.set('Content-Type', 'application/json');
  if (origin !== null) requestHeaders.set('Origin', origin || 'https://' + hostname);
  const response = await worker.fetch(new Request('https://' + hostname + path, { method, headers: requestHeaders, body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) }), runtime, context);
  assert.ok((response.headers.get('Cache-Control') || '').includes('no-store'));
  const text = await response.text();
  return { response, status: response.status, text, data: (response.headers.get('Content-Type') || '').includes('application/json') ? JSON.parse(text) : null };
}
const state = { version: 3, groups: [C.createGroup({ power: 20, powerMode: 'percent', arrayPercent: 50, speed: 100, frequency: 100, spacing: 25 }, [])], selectedId: 'C001',lenses:[],qcReferences:[] };
state.groups[0].electrical[0].values = ['100'];
state.groups[0].legacyPowerW = 0.12;
state.groups[0].measuredPowerW = 0.0025;

// Real jose signature/claim validation. Request headers and ctx.access are never
// alternative identities, and missing production configuration closes all routes.
for (const path of ['/', '/api/state']) {
  assert.equal((await call({ path, runtime: { DB: db, ASSETS: env.ASSETS }, token: null })).status, 503);
  assert.equal((await call({ path, token: null, headers: { 'oai-authenticated-user-id': 'spoof', 'CF-Access-Authenticated-User-Email': 'owner@example.com' }, context: { access: { getIdentity: async () => ({ email: 'owner@example.com' }) } } })).status, 401);
}
assert.equal(assetRequests, 0);
for (const invalid of [
  await signed({ issuer: 'https://wrong.cloudflareaccess.com' }), await signed({ audience: 'wrong' }),
  await signed({ expiration: Math.floor(Date.now() / 1000) - 10 }), await signed({ notBefore: '5m' }),
  await signed({ algorithm: 'HS256' }), await signed({ noExpiration: true }),
  token.slice(0, -5) + 'aaaaa', await signed({ subject: '' }), await signed({ type: 'org' })
]) assert.equal((await call({ token: invalid })).status, 401);
assert.equal((await call({ token: await signed({ email: 'other@example.com' }), headers: { 'CF-Access-Authenticated-User-Email': 'owner@example.com' } })).status, 403);
assert.equal((await call({ runtime: { ...env, ACCESS_TEAM_DOMAIN: 'https://evil.example.com' } })).status, 503);
assert.equal((await call({ runtime: { DB: db, DEV_USER_ID: 'local-only' }, token: null })).status, 503);
const html = await call({ path: '/' }); assert.equal(html.status, 200); assert.match(html.text, /private notebook/);
assert.equal(assetRequests, 1); assert.equal(jwksFactories, 1);

// Empty state is distinct from a saved empty notebook. Every SQL value is bound.
assert.deepEqual((await call()).data, { state: null, revision: 0 });
for (const clientVersion of [null, 'old-ui', 'trash-v1']) {
  const outdated = await call({ method: 'POST', body: { state, expectedRevision: 0 }, clientVersion });
  assert.equal(outdated.status, 426); assert.equal(outdated.data.code, 'CLIENT_UPDATE_REQUIRED'); assert.match(outdated.data.error, /备份.*刷新/);
}
assert.equal((await call({ method: 'POST', body: { state, expectedRevision: 0 }, clientVersion: null, token: null })).status, 401);
assert.equal((await call({ method: 'POST', body: { state, expectedRevision: 0 }, clientVersion: null, origin: 'https://evil.example' })).status, 403);
assert.deepEqual((await call()).data, { state: null, revision: 0 });
const saved = await call({ method: 'POST', body: { state, expectedRevision: 0 } });
assert.equal(saved.status, 200); assert.equal(saved.data.revision, 1); assert.deepEqual(saved.data.state, state);
assert.equal(saved.data.state.groups[0].legacyPowerW, 0.12);
assert.equal(saved.data.state.groups[0].measuredPowerW, 0.0025);
assert.deepEqual((await call()).data, saved.data);
const competing = JSON.parse(JSON.stringify(state)); competing.groups[0].electrical[0].values = ['200'];
const conflict = await call({ method: 'POST', body: { state: competing, expectedRevision: 0 } });
assert.equal(conflict.status, 409); assert.equal(conflict.data.code, 'REVISION_CONFLICT'); assert.deepEqual(conflict.data.state, state);
const revised = await call({ method: 'POST', body: { state: competing, expectedRevision: 1 } });
assert.equal(revised.status, 200); assert.equal(revised.data.revision, 2);
const pair = await Promise.all([
  call({ method: 'POST', body: { state, expectedRevision: 2 } }),
  call({ method: 'POST', body: { state: competing, expectedRevision: 2 } })
]);
assert.deepEqual(pair.map(result => result.status).sort(), [200, 409]);
assert.equal((await call()).data.revision, 3);
const otherOwner = await signed({ subject: 'another-owner-subject' });
assert.deepEqual((await call({ token: otherOwner })).data, { state: null, revision: 0 });
assert.equal((await call({ method: 'POST', token: otherOwner, body: { state, expectedRevision: 2 } })).status, 409);
assert.deepEqual((await call({ token: otherOwner })).data, { state: null, revision: 0 });

// Custom IDs and a library-only notebook survive the real API and SQLite path.
const libraryLens=C.validateLens({id:'L-integration',name:'测试镜头',focalLengthMM:100});
const customGroup=C.createGroup({id:'PI-20261031-A',powerMode:'percent',power:3,arrayPercent:90,speed:100,frequency:726.314,spacing:25,lens:libraryLens},[]);
const customState=C.validateState({version:3,groups:[customGroup],selectedId:customGroup.id,lenses:[libraryLens]});
assert.equal((await call({method:'POST',token:otherOwner,body:{state:customState,expectedRevision:0}})).status,200);
assert.deepEqual((await call({token:otherOwner})).data.state,customState);
const libraryOnly=C.validateState({version:3,groups:[],selectedId:'',lenses:[{...libraryLens,focalLengthMM:200}]});
assert.equal((await call({method:'POST',token:otherOwner,body:{state:libraryOnly,expectedRevision:1}})).status,200);
assert.deepEqual((await call({token:otherOwner})).data.state,libraryOnly);

// CSRF, malformed requests, unknown routes, schema and revision checks cannot write.
for (const origin of ['https://evil.example', 'null', null]) assert.equal((await call({ method: 'POST', origin, body: { state, expectedRevision: 3 } })).status, 403);
assert.equal((await call({ headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
assert.equal((await call({ method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
assert.equal((await call({ method: 'POST', headers: { 'Content-Encoding': 'gzip' }, body: '{}' })).status, 415);
assert.equal((await call({ method: 'POST', body: '{' })).status, 400);
assert.equal((await call({ method: 'POST', body: new Uint8Array([255]) })).status, 400);
assert.equal((await call({ method: 'POST', body: [] })).status, 400);
for (const expectedRevision of [-1, 1.2, '3', true, Number.MAX_SAFE_INTEGER]) assert.equal((await call({ method: 'POST', body: { state, expectedRevision } })).status, 400);
assert.equal((await call({ method: 'POST', body: { state: { ...state, version: 4 }, expectedRevision: 3 } })).status, 422);
assert.equal((await call({ method: 'POST', body: { state: { ...state, groups: Array(1001).fill(state.groups[0]) }, expectedRevision: 3 } })).status, 422);
assert.equal((await call({ method: 'POST', headers: { 'Content-Length': String(LIMITS.requestBytes + 1) }, body: '{}' })).status, 413);
assert.equal((await call({ method: 'POST', body: ' '.repeat(LIMITS.requestBytes + 1) })).status, 413);
assert.equal((await call({ path: '/api/unknown' })).status, 404);
assert.equal((await call({ path: '/api/state?owner=another' })).status, 400);
assert.equal((await call({ method: 'DELETE' })).status, 405);
assert.equal((await call()).data.revision, 3);

// A deliberately failed chunk write rolls the earlier CAS and deletion back.
const prior = (await call()).data;
db.failAt = 2;
const failedSave = await call({ method: 'POST', body: { state: competing, expectedRevision: prior.revision } });
assert.equal(failedSave.status, 503); assert.ok(!failedSave.text.includes('private SQL'));
assert.deepEqual((await call()).data, prior);

// Local development is explicit, never enabled by HTTP headers or public hosts.
const dev = { DB: db, DEV_USER_ID: 'local-owner' };
assert.deepEqual((await call({ hostname: 'localhost', runtime: dev, token: null })).data, { state: null, revision: 0 });
const raceEnv = { DB: db, DEV_USER_ID: 'initial-race' };
const firstRace = await Promise.all([
  call({ method: 'POST', hostname: '127.0.0.1', runtime: raceEnv, token: null, body: { state, expectedRevision: 0 } }),
  call({ method: 'POST', hostname: '127.0.0.1', runtime: raceEnv, token: null, body: { state: competing, expectedRevision: 0 } })
]);
assert.deepEqual(firstRace.map(result => result.status).sort(), [200, 409]);
assert.equal(db.sql.prepare('SELECT count(*) AS n FROM lig_user_states WHERE owner_id = ?').get('dev:initial-race').n, 1);
const old = JSON.parse(JSON.stringify(state)); old.version = 1;
delete old.groups[0].measurementPlan;
old.groups[0].electrical.forEach(sample => { sample.values = sample.id === 'E01' ? ['90', '100', '110'] : ['', '', '']; });
const migrated = await call({ method: 'POST', hostname: 'localhost', runtime: dev, token: null, body: { state: old, expectedRevision: 0 } });
assert.equal(migrated.status, 200); assert.equal(migrated.data.state.version, 3);
assert.deepEqual(migrated.data.state.groups[0].electrical[0].values, ['90', '100', '110']);
assert.equal(migrated.data.state.groups[0].powerMode, 'watts');

// Soft deletion remains a full recoverable record in D1. Legacy tabs cannot
// revive it by normalizing away the deletion field before saving.
const trashEnv = { DB: db, DEV_USER_ID: 'trash-roundtrip' };
const trashed = JSON.parse(JSON.stringify(state));
trashed.groups[0].deletedAt = '2026-10-28T04:00:00.000Z';
const deletedSave = await call({ method: 'POST', hostname: 'localhost', runtime: trashEnv, token: null, body: { state: trashed, expectedRevision: 0 } });
assert.equal(deletedSave.status, 200); assert.deepEqual(deletedSave.data.state, trashed);
assert.deepEqual((await call({ hostname: 'localhost', runtime: trashEnv, token: null })).data, { state: trashed, revision: 1 });
const legacyRestore = await call({ method: 'POST', hostname: 'localhost', runtime: trashEnv, token: null, body: { state, expectedRevision: 1 }, clientVersion: null });
assert.equal(legacyRestore.status, 426);
assert.deepEqual((await call({ hostname: 'localhost', runtime: trashEnv, token: null })).data, { state: trashed, revision: 1 });
const restored = JSON.parse(JSON.stringify(trashed)); restored.groups[0].deletedAt = null;
const restoredSave = await call({ method: 'POST', hostname: 'localhost', runtime: trashEnv, token: null, body: { state: restored, expectedRevision: 1 } });
assert.equal(restoredSave.status, 200); assert.deepEqual(restoredSave.data.state, restored); assert.equal(restoredSave.data.revision, 2);

// A >2MB notebook crosses D1's single-row limit, so exercise Unicode-safe chunks
// against the real migration SQL rather than pretending D1 accepts one huge row.
const large = { version: 3, groups: [], selectedId: 'C001',lenses:[],qcReferences:[] };
for (let index = 0; index < 400; index++) {
  const group = C.createGroup({ power: 1.5, speed: 100, frequency: 100, spacing: 25, notes: '😀'.repeat(1500) }, large.groups);
  large.groups.push(group);
}
assert.ok(new TextEncoder().encode(JSON.stringify(large)).byteLength > 2000000);
const largeSave = await call({ method: 'POST', hostname: 'localhost', runtime: dev, token: null, body: { state: large, expectedRevision: 1 } });
assert.equal(largeSave.status, 200); assert.equal(largeSave.data.revision, 2);
assert.deepEqual((await call({ hostname: 'localhost', runtime: dev, token: null })).data.state, large);
const storedChunks = db.sql.prepare('SELECT state_chunk FROM lig_state_chunks WHERE owner_id = ? ORDER BY chunk_index').all('dev:local-owner');
assert.ok(storedChunks.length > 1);
for (const chunk of storedChunks) assert.ok(new TextEncoder().encode(chunk.state_chunk).byteLength <= 1500000);
assert.ok(db.sessions.every(mode => mode === 'first-primary'));
assert.ok(db.queries.every(query => !/\b(CREATE|ALTER|DROP)\b/i.test(query)));
// New measurement structure and the full legacy snapshot survive the real API/SQLite path.
const repeatEnv={DB:db,DEV_USER_ID:'repeat-roundtrip'};
const legacyRepeat=C.createGroup({power:3,powerMode:'percent',arrayPercent:100,speed:5,frequency:800,spacing:10},[]);
legacyRepeat.electrical.forEach((sample,index)=>sample.values=[String(120+index)]);
const migratedRepeat=C.convertLegacyReadings(legacyRepeat,'2026-11-01T00:00:00Z');
const repeatState={version:3,groups:[migratedRepeat],selectedId:migratedRepeat.id,lenses:[],qcReferences:[]};
const repeatSave=await call({method:'POST',hostname:'localhost',runtime:repeatEnv,token:null,body:{state:repeatState,expectedRevision:0}});
assert.equal(repeatSave.status,200);assert.deepEqual(repeatSave.data.state,repeatState);
assert.deepEqual((await call({hostname:'localhost',runtime:repeatEnv,token:null})).data.state.groups[0].measurementArchive.electrical,legacyRepeat.electrical);
assert.equal((await call({method:'POST',hostname:'localhost',runtime:repeatEnv,token:null,body:{state:repeatState,expectedRevision:1},clientVersion:'lens-mm-v3'})).status,426);
const qcState=C.createQCRun(C.addQCReference(repeatState,migratedRepeat.id),'QC-1',{date:'2026-11-01'});
assert.equal((await call({method:'POST',hostname:'localhost',runtime:repeatEnv,token:null,body:{state:qcState,expectedRevision:1}})).status,200);
assert.equal((await call({method:'POST',hostname:'localhost',runtime:repeatEnv,token:null,body:{state:repeatState,expectedRevision:2},clientVersion:'sample-repeats-v4'})).status,426);
assert.deepEqual((await call({hostname:'localhost',runtime:repeatEnv,token:null})).data.state,qcState,'old sample layout client cannot strip QC data');
db.sql.close();
console.log('PASS: real RS256/issuer/audience/expiry/nbf/owner checks; locked static assets; real SQLite schema/CAS insert races and update conflicts; owner isolation; rollback; v1 migration; JSON/CSRF/size limits; legacy W/measured W and soft-delete/restore roundtrip; old UI/trash-v1 write gate; >2MB Unicode chunk roundtrip.');
