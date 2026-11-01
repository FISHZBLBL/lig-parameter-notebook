(function (root) {
  'use strict';

  // The parent owns login UI and domain validation. This module owns the queued
  // document, its CAS revision, and safe delivery to the same-origin API.
  function emptyState() { return { version: 3, groups: [], selectedId: '',lenses:[] }; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function stateCopy(value) {
    if (!value || value.version !== 3 || !Array.isArray(value.groups) || typeof value.selectedId !== 'string') throw new Error('实验记录格式不正确');
    return clone(value);
  }
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + stable(value[key]); }).join(',') + '}';
    return JSON.stringify(value);
  }
  function same(left, right) { return left !== null && right !== null && stable(left) === stable(right); }
  function formalCount(state) { return state.groups.filter(function (group) { return group.isDemo !== true; }).length+(state.lenses||[]).length; }
  function isEmpty(state) { return state.groups.length === 0 && !(state.lenses||[]).length; }
  function validRevision(value) { return Number.isSafeInteger(value) && value >= 0; }
  function problem(code, message, retryable) { const error = new Error(message); error.code = code; error.retryable = !!retryable; return error; }

  function mount(options) {
    if (!options || typeof options.getState !== 'function' || typeof options.onRemote !== 'function') throw new Error('云同步缺少本机记录或加载回调');
    // Normalize both the durable outbox and remote documents with the same
    // domain schema, so older offline drafts survive newly added metadata.
    function stateCopy(value) {
      const normalized=typeof options.normalize==='function'?options.normalize(value):value;
      if(!normalized||normalized.version!==3||!Array.isArray(normalized.groups)||typeof normalized.selectedId!=='string')throw new Error('实验记录格式不正确');
      return clone(normalized);
    }
    const endpoint = options.endpoint || '/api/state';
    if (!/^\/(?!\/)/.test(endpoint)) throw new Error('云同步接口必须使用同源相对路径');
    const cacheKey = options.cacheKey || 'lig-cloud-sync-v3:' + endpoint;
    const fetcher = options.fetch || (root.fetch && root.fetch.bind(root));
    const timers = options.timers || { setTimeout: root.setTimeout.bind(root), clearTimeout: root.clearTimeout.bind(root) };
    const now = options.now || Date.now;
    const eventTarget = options.eventTarget || root;
    const pageDocument = options.document || root.document;
    const debounceMs = Number.isFinite(options.debounceMs) ? Math.max(0, options.debounceMs) : 700;
    let storage = options.storage;
    if (storage === undefined) { try { storage = root.localStorage; } catch (_) { storage = null; } }

    let snapshot = stateCopy(options.getState()), revision = null, remoteState = null;
    let dirty = false, generation = 0, conflict = null, uncertain = null, lastSync = null;
    let kind = 'idle', lastError = null, storageAvailable = !!storage, cacheProtected = false;
    let started = false, attached = false, applying = false, debounceTimer = null, retryTimer = null, retryIndex = 0;
    let pullPromise = null, sendPromise = null, lastConflictToken = '', lastStatusToken = '';

    function status() {
      return {
        kind: kind, dirty: dirty, inFlight: !!sendPromise, revision: revision,
        lastSync: lastSync, storageAvailable: storageAvailable, conflict: !!conflict,
        needsUpload: kind === 'needs-upload', localFormalCount: formalCount(snapshot),
        error: lastError ? { code: lastError.code || 'unknown', message: lastError.message, retryable: !!lastError.retryable } : null
      };
    }
    function notify() {
      const current = status(), token = JSON.stringify(current);
      if (token === lastStatusToken) return;
      lastStatusToken = token;
      if (typeof options.onStatus === 'function') { try { options.onStatus(current); } catch (_) {} }
    }
    function setKind(value) { kind = value; notify(); }
    function report(error) {
      lastError = error;
      if (typeof options.onError === 'function') {
        try { options.onError({ code: error.code || 'unknown', message: error.message, retryable: !!error.retryable }); } catch (_) {}
      }
      notify();
    }
    function persist() {
      if (!storage || cacheProtected) { storageAvailable = false; return; }
      try {
        storage.setItem(cacheKey, JSON.stringify({
          cacheVersion: 1, state: snapshot, dirty: dirty, revision: revision,
          remoteState: remoteState, generation: generation, uncertain: uncertain,
          conflict: conflict, lastSync: lastSync
        }));
        storageAvailable = true;
      } catch (_) {
        const firstFailure = storageAvailable;
        storageAvailable = false;
        if (firstFailure) report(problem('storage', '本机待同步缓存无法写入，请下载备份保留当前记录。', false));
      }
    }
    function loadCache() {
      if (!storage) return;
      try {
        const raw = storage.getItem(cacheKey);
        if (!raw) return;
        const cache = JSON.parse(raw);
        if (cache.cacheVersion !== 1 || typeof cache.dirty !== 'boolean' || !(cache.revision === null || validRevision(cache.revision))) throw new Error('cache');
        snapshot = stateCopy(cache.state);
        revision = cache.revision;
        dirty = cache.dirty;
        generation = Number.isSafeInteger(cache.generation) && cache.generation >= 0 ? cache.generation : 0;
        remoteState = cache.remoteState === null || cache.remoteState === undefined ? null : stateCopy(cache.remoteState);
        lastSync = typeof cache.lastSync === 'number' ? cache.lastSync : null;
        if (cache.uncertain) {
          if (!validRevision(cache.uncertain.expectedRevision)) throw new Error('uncertain');
          uncertain = { state: stateCopy(cache.uncertain.state), expectedRevision: cache.uncertain.expectedRevision };
        }
        if (cache.conflict) {
          if (!validRevision(cache.conflict.revision)) throw new Error('conflict');
          conflict = { state: stateCopy(cache.conflict.state), revision: cache.conflict.revision };
          dirty = true;
        }
      } catch (_) {
        // Never replace an unreadable queue with a new blank cache.
        cacheProtected = true; storageAvailable = false;
        report(problem('cache-unreadable', '待同步缓存无法读取，原缓存已保留。请先备份本机记录。', false));
      }
    }
    loadCache();

    function cancelDebounce() { if (debounceTimer !== null) { timers.clearTimeout(debounceTimer); debounceTimer = null; } }
    function cancelRetry() { if (retryTimer !== null) { timers.clearTimeout(retryTimer); retryTimer = null; } }
    function apply(state, source, reason) {
      if (same(state, options.getState())) return;
      applying = true;
      try { options.onRemote(stateCopy(state), { source: source, reason: reason, revision: revision, dirty: dirty }); }
      finally { applying = false; }
    }
    function localBackup() {
      return { localState: stateCopy(snapshot), remoteState: conflict ? stateCopy(conflict.state) : null, revision: conflict ? conflict.revision : revision };
    }
    function notifyConflict() {
      if (!conflict) return;
      const token = String(conflict.revision) + ':' + stable(conflict.state) + ':local:' + generation;
      if (token === lastConflictToken) return;
      lastConflictToken = token;
      if (typeof options.onConflict === 'function') {
        try { options.onConflict(localBackup()); } catch (error) { report(problem('callback', error.message || '无法显示云端冲突提示。', false)); }
      }
    }
    function blockConflict(document) {
      cancelDebounce(); cancelRetry();
      conflict = { state: stateCopy(document.state), revision: document.revision };
      dirty = true; uncertain = null; lastError = null;
      persist(); setKind('conflict'); notifyConflict();
    }
    function accept(document, reason, applyUI) {
      revision = document.revision; remoteState = stateCopy(document.state); snapshot = stateCopy(document.state);
      dirty = false; conflict = null; uncertain = null; lastConflictToken = ''; lastError = null;
      lastSync = now(); retryIndex = 0; cancelRetry(); persist();
      if (applyUI !== false) apply(snapshot, 'remote', reason);
      setKind(isEmpty(snapshot) ? 'empty' : 'synced');
    }
    function scheduleRetry(error) {
      if (!dirty || conflict || !error.retryable || retryTimer !== null) return;
      const delays = [2000, 5000, 15000, 30000];
      const delay = delays[Math.min(retryIndex++, delays.length - 1)];
      retryTimer = timers.setTimeout(function () { retryTimer = null; retry().catch(function () {}); }, delay);
    }
    function failed(error) {
      persist();
      kind = error.code === 'auth-required' ? 'auth-required' : error.code === 'network' ? 'offline' : 'error';
      report(error); scheduleRetry(error);
    }
    async function request(method, body) {
      if (!fetcher) throw problem('network', '当前浏览器无法连接云端，本机记录仍保留。', true);
      let response;
      try {
        response = await fetcher(endpoint, {
          method: method, credentials: 'same-origin', redirect: 'manual', cache: 'no-store',
          headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json', 'X-LIG-Client-Version': 'qc-records-v5' },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
      } catch (_) { throw problem('network', '暂时无法连接云端，修改已留在本机待同步。', true); }
      const type = response.headers && response.headers.get ? (response.headers.get('content-type') || '').toLowerCase() : '';
      if (response.status === 401 || response.status === 403 || response.redirected || response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400 || response.ok && type.indexOf('text/html') !== -1) {
        throw problem('auth-required', '登录已过期，请重新登录；本机待同步记录仍保留。', false);
      }
      if (type.indexOf('application/json') === -1 && type.indexOf('+json') === -1) throw problem('protocol', '云端未返回记录数据，本机修改没有被清除。', response.status >= 500);
      let payload;
      try { payload = await response.json(); } catch (_) { throw problem('protocol', '云端记录响应无法读取，本机修改没有被清除。', response.status >= 500); }
      if (response.status !== 409 && !response.ok) throw problem('http-' + response.status, payload && payload.error && typeof payload.error === 'string' ? payload.error : '云端保存失败（' + response.status + '），本机修改仍保留。', response.status >= 500 || response.status === 429);
      if (!payload || !validRevision(payload.revision)) throw problem('protocol', '云端版本信息不正确，本机修改仍保留。', false);
      let state;
      try { state = payload.state === null && payload.revision === 0 ? emptyState() : stateCopy(payload.state); }
      catch (_) { throw problem('protocol', '云端实验记录格式不正确，本机修改仍保留。', false); }
      return { state: state, revision: payload.revision, conflict: response.status === 409 };
    }

    function reconcile(document, reason) {
      if (conflict) {
        // Retry updates the remote candidate, never chooses it for the user.
        conflict = { state: stateCopy(document.state), revision: document.revision };
        persist(); setKind('conflict'); notifyConflict(); return;
      }
      if (dirty) {
        if (same(snapshot, document.state)) { accept(document, 'already-saved', false); return; }
        if (uncertain && document.revision === uncertain.expectedRevision + 1 && same(uncertain.state, document.state)) {
          revision = document.revision; remoteState = stateCopy(document.state); uncertain = null;
          persist(); lastError = null; setKind('pending'); return;
        }
        if (revision !== null && document.revision === revision || revision === null && isEmpty(document.state)) {
          revision = document.revision; remoteState = stateCopy(document.state); uncertain = null;
          persist(); lastError = null; setKind('pending'); return;
        }
        blockConflict(document); return;
      }
      let local;
      try { local = stateCopy(options.getState()); } catch (_) { local = stateCopy(snapshot); }
      // A first connection is a read. Existing local experiments need an explicit
      // queue() action, while an established remote clear is safe to load.
      if (isEmpty(document.state) && (remoteState === null || isEmpty(remoteState))) {
        revision = document.revision; remoteState = stateCopy(document.state); snapshot = local; lastError = null;
        persist(); setKind(formalCount(local) ? 'needs-upload' : 'empty'); return;
      }
      const untrackedLocal = formalCount(local) > 0 && !same(local, document.state) && (remoteState === null || !same(local, remoteState));
      if (untrackedLocal) { snapshot = local; blockConflict(document); return; }
      accept(document, reason, true);
    }
    function pull(reason) {
      if (pullPromise) return pullPromise;
      pullPromise = (async function () {
        if (!dirty && !conflict) setKind('loading');
        try { const document = await request('GET'); reconcile(document, reason || 'refresh'); return status(); }
        catch (error) { failed(error); return status(); }
        finally { pullPromise = null; notify(); }
      })();
      return pullPromise;
    }
    function attach() {
      if (attached) return; attached = true;
      if (eventTarget && typeof eventTarget.addEventListener === 'function') {
        eventTarget.addEventListener('online', function () { retry().catch(function () {}); });
        eventTarget.addEventListener('focus', function () {
          if (pageDocument && pageDocument.visibilityState === 'hidden') return;
          if (!sendPromise) { if (dirty) retry().catch(function () {}); else pull('focus'); }
        });
      }
      if (pageDocument && typeof pageDocument.addEventListener === 'function') pageDocument.addEventListener('visibilitychange', function () {
        if (pageDocument.visibilityState !== 'hidden' && !sendPromise) { if (dirty) retry().catch(function () {}); else pull('visible'); }
      });
    }
    async function start() {
      attach();
      if (sendPromise) return sendPromise;
      if (!started) {
        started = true;
        if (dirty || conflict) {
          try { apply(snapshot, 'local-cache', 'restore-pending'); }
          catch (error) { failed(problem('callback', error.message || '待同步记录无法加载，请下载备份。', false)); return status(); }
        }
      }
      await pull('start');
      if (dirty && !conflict && kind === 'pending') return flush();
      return status();
    }
    function queue(value) {
      let next;
      try { next = stateCopy(value); }
      catch (error) { report(problem('local-state', error.message, false)); return status(); }
      if (applying && same(next, snapshot)) return status();
      if (conflict && same(next, conflict.state)) {
        // This is an explicit parent-UI resolution: back up, load the remote
        // candidate, and queue that exact candidate to accept its CAS base.
        accept({ state: next, revision: conflict.revision }, 'conflict-accepted', true);
        return status();
      }
      snapshot = next; generation++;
      if (!sendPromise && !conflict && remoteState !== null && same(next, remoteState)) {
        dirty = false; uncertain = null; cancelDebounce(); persist(); setKind(isEmpty(next) ? 'empty' : 'synced'); return status();
      }
      if (!sendPromise && !conflict && !formalCount(next) && !dirty && (remoteState === null && revision === null || remoteState !== null && isEmpty(remoteState) && revision === 0)) {
        persist(); setKind('empty'); return status();
      }
      dirty = true; persist();
      if (conflict) { setKind('conflict'); notifyConflict(); return status(); }
      lastError = null; setKind(sendPromise ? 'syncing' : 'pending'); cancelDebounce();
      if (!sendPromise) debounceTimer = timers.setTimeout(function () { debounceTimer = null; flush().catch(function () {}); }, debounceMs);
      return status();
    }
    function flush() {
      cancelDebounce();
      if (sendPromise) return sendPromise;
      if (!dirty || conflict) return Promise.resolve(status());
      sendPromise = (async function () {
        try {
          if (!started || revision === null || uncertain || kind === 'offline' || kind === 'auth-required' || kind === 'error') {
            started = true; attach(); await pull('before-save');
          }
          while (dirty && !conflict && revision !== null && kind !== 'offline' && kind !== 'auth-required' && kind !== 'error') {
            const sentState = stateCopy(snapshot), sentGeneration = generation, expectedRevision = revision;
            uncertain = { state: sentState, expectedRevision: expectedRevision }; persist(); setKind('syncing');
            const result = await request('POST', { state: sentState, expectedRevision: expectedRevision });
            if (result.conflict) {
              if (same(snapshot, result.state)) accept(result, 'already-saved', false); else blockConflict(result);
              break;
            }
            if (result.revision <= expectedRevision || !same(result.state, sentState)) throw problem('protocol', '云端保存确认不一致，本机修改仍保留。', false);
            revision = result.revision; remoteState = stateCopy(result.state); uncertain = null; lastSync = now(); lastError = null; retryIndex = 0; cancelRetry();
            dirty = generation !== sentGeneration || !same(snapshot, sentState);
            persist(); setKind(dirty ? 'pending' : 'synced');
          }
        } catch (error) { failed(error); }
        finally { sendPromise = null; notify(); }
        return status();
      })();
      notify(); return sendPromise;
    }
    async function retry() {
      cancelRetry(); cancelDebounce();
      if (sendPromise) return sendPromise;
      await pull('retry');
      if (dirty && !conflict && kind === 'pending') return flush();
      return status();
    }
    notify();
    return Object.freeze({ start: start, queue: queue, flush: flush, status: status, retry: retry });
  }

  root.LIGCloud = Object.freeze({ mount: mount });
})(globalThis);
