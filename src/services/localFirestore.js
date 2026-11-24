/**
 * Client Local Firestore compatible API Firebase v10 (`firebase/firestore`).
 * Remplace Firestore distant par :
 * - Cache mémoire instantané (0 ms) + BroadcastChannel inter-onglets
 * - Persistance serveur locale `/api/local-firebase` (< 2 ms sur localhost/LAN)
 * - Synchronisation temps réel via WebSocket `/ws/netplay` (évènement `LOCAL_FS_EVENT`)
 * - Fallback automatique `localStorage` si hébergement purement statique sans backend Node
 */

const LOCAL_STORAGE_CACHE_KEY = 'csw_local_fs_cache_v1';
const BROADCAST_CHANNEL_NAME = 'csw_local_fs_v1';
const AUTO_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateAutoId() {
  let out = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < 20; i++) {
      out += AUTO_ID_CHARS[bytes[i] % AUTO_ID_CHARS.length];
    }
    return out;
  }
  for (let i = 0; i < 20; i++) {
    out += AUTO_ID_CHARS[Math.floor(Math.random() * AUTO_ID_CHARS.length)];
  }
  return out;
}

function normalizePath(raw) {
  return String(raw || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/');
}

function getParentPath(docPath) {
  const norm = normalizePath(docPath);
  const idx = norm.lastIndexOf('/');
  return idx > 0 ? norm.slice(0, idx) : '';
}

function getDocId(docPath) {
  const norm = normalizePath(docPath);
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v) && !v.__cswServerTimestamp && !v.__cswDeleteField && typeof v.__cswTsMs !== 'number';
}

export class LocalTimestamp {
  constructor(seconds, nanoseconds = 0) {
    this.seconds = Math.floor(Number(seconds || 0));
    this.nanoseconds = Math.floor(Number(nanoseconds || 0));
  }

  static fromMillis(ms) {
    const clean = Number(ms || 0);
    const sec = Math.floor(clean / 1000);
    const ns = Math.floor((clean % 1000) * 1e6);
    return new LocalTimestamp(sec, ns);
  }

  static now() {
    return LocalTimestamp.fromMillis(Date.now());
  }

  toMillis() {
    return this.seconds * 1000 + Math.round(this.nanoseconds / 1e6);
  }

  toDate() {
    return new Date(this.toMillis());
  }

  valueOf() {
    return this.toMillis();
  }

  toJSON() {
    return { __cswTsMs: this.toMillis() };
  }
}

export const Timestamp = LocalTimestamp;

export function serverTimestamp() {
  return { __cswServerTimestamp: true };
}

export function deleteField() {
  return { __cswDeleteField: true };
}

export function where(field, op, value) {
  return { type: 'where', field: String(field || ''), op, value };
}

export function orderBy(field, dir = 'asc') {
  return { type: 'orderBy', field: String(field || ''), dir: String(dir || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc' };
}

export function limit(count) {
  return { type: 'limit', count: Math.max(0, Number(count || 0)) };
}

export function limitToLast(count) {
  return { type: 'limitToLast', count: Math.max(0, Number(count || 0)) };
}

function resolveSentinelsClient(value, nowMs = Date.now()) {
  if (value === null || value === undefined) return value;
  if (value instanceof LocalTimestamp) {
    return { __cswTsMs: value.toMillis() };
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveSentinelsClient(item, nowMs));
  }
  if (typeof value === 'object') {
    if (value.__cswServerTimestamp === true) return { __cswTsMs: nowMs };
    if (value.__cswDeleteField === true) return { __cswDeleteField: true };
    if (typeof value.__cswTsMs === 'number') return { __cswTsMs: value.__cswTsMs };
    const next = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      next[k] = resolveSentinelsClient(v, nowMs);
    }
    return next;
  }
  return value;
}

function hydrateData(val) {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) return val.map((item) => hydrateData(item));
  if (typeof val === 'object') {
    if (typeof val.__cswTsMs === 'number') {
      return LocalTimestamp.fromMillis(val.__cswTsMs);
    }
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = hydrateData(v);
    }
    return out;
  }
  return val;
}

function cloneRaw(val) {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) return val.map((item) => cloneRaw(item));
  if (typeof val === 'object') {
    if (val instanceof LocalTimestamp) return { __cswTsMs: val.toMillis() };
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = cloneRaw(v);
    }
    return out;
  }
  return val;
}

function deepMergeRaw(target, source) {
  const base = isPlainObject(target) ? cloneRaw(target) : {};
  if (!isPlainObject(source)) return base;
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && v.__cswDeleteField === true) {
      delete base[k];
      continue;
    }
    if (isPlainObject(v) && isPlainObject(base[k])) {
      base[k] = deepMergeRaw(base[k], v);
    } else {
      base[k] = cloneRaw(v);
    }
  }
  return base;
}

function applyDottedPatchRaw(target, patch) {
  const out = isPlainObject(target) ? cloneRaw(target) : {};
  for (const [rawKey, val] of Object.entries(patch || {})) {
    if (!rawKey) continue;
    const parts = rawKey.split('.');
    if (parts.length === 1) {
      if (val && typeof val === 'object' && val.__cswDeleteField === true) {
        delete out[rawKey];
      } else {
        out[rawKey] = cloneRaw(val);
      }
      continue;
    }
    let cursor = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!isPlainObject(cursor[seg])) cursor[seg] = {};
      cursor = cursor[seg];
    }
    const leaf = parts[parts.length - 1];
    if (val && typeof val === 'object' && val.__cswDeleteField === true) {
      delete cursor[leaf];
    } else {
      cursor[leaf] = cloneRaw(val);
    }
  }
  return out;
}

function readField(docObj, fieldPath) {
  if (!docObj || !fieldPath) return undefined;
  const parts = String(fieldPath).split('.');
  let cur = docObj;
  for (const seg of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

function toComparable(val) {
  if (val && typeof val === 'object') {
    if (typeof val.__cswTsMs === 'number') return val.__cswTsMs;
    if (typeof val.toMillis === 'function') return val.toMillis();
    if (typeof val.seconds === 'number') return val.seconds * 1000 + Math.round((val.nanoseconds || 0) / 1e6);
  }
  return val;
}

function matchesWhere(docObj, c) {
  const raw = readField(docObj, c.field);
  const actual = toComparable(raw);
  const expected = toComparable(c.value);
  switch (c.op) {
    case '==':
      return actual === expected;
    case '!=':
      return actual !== expected;
    case '<':
      return actual !== undefined && actual !== null && actual < expected;
    case '<=':
      return actual !== undefined && actual !== null && actual <= expected;
    case '>':
      return actual !== undefined && actual !== null && actual > expected;
    case '>=':
      return actual !== undefined && actual !== null && actual >= expected;
    case 'in':
      return Array.isArray(expected) && expected.some((v) => toComparable(v) === actual);
    case 'not-in':
      return Array.isArray(expected) && !expected.some((v) => toComparable(v) === actual);
    case 'array-contains':
      return Array.isArray(raw) && raw.includes(c.value);
    case 'array-contains-any':
      return Array.isArray(raw) && Array.isArray(expected) && expected.some((v) => raw.includes(v));
    default:
      return true;
  }
}

function applyClientConstraints(entries, constraints = []) {
  const wheres = [];
  const orders = [];
  let limitCount = null;
  let limitToLastCount = null;

  for (const c of Array.isArray(constraints) ? constraints : []) {
    if (!c) continue;
    if (c.type === 'where') wheres.push(c);
    else if (c.type === 'orderBy') orders.push(c);
    else if (c.type === 'limit') limitCount = Math.max(0, Number(c.count || 0));
    else if (c.type === 'limitToLast') limitToLastCount = Math.max(0, Number(c.count || 0));
  }

  let list = wheres.length === 0 ? entries.slice() : entries.filter((e) => wheres.every((w) => matchesWhere(e.data, w)));

  if (orders.length > 0) {
    list.sort((a, b) => {
      for (const ord of orders) {
        const va = toComparable(readField(a.data, ord.field));
        const vb = toComparable(readField(b.data, ord.field));
        if (va === vb) continue;
        if (va === undefined || va === null) return ord.dir === 'desc' ? 1 : -1;
        if (vb === undefined || vb === null) return ord.dir === 'desc' ? -1 : 1;
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
        if (cmp !== 0) return ord.dir === 'desc' ? -cmp : cmp;
      }
      return a.id.localeCompare(b.id);
    });
  }

  if (limitCount !== null) list = list.slice(0, limitCount);
  else if (limitToLastCount !== null && list.length > limitToLastCount) list = list.slice(list.length - limitToLastCount);
  return list;
}

function makeDocSnapshot(docPath, rawData, fromCache = false) {
  const norm = normalizePath(docPath);
  const id = getDocId(norm);
  const hydrated = rawData ? hydrateData(rawData) : undefined;
  return {
    id,
    path: norm,
    exists: () => Boolean(rawData),
    data: () => (hydrated ? cloneRawOrHydrated(hydrated) : undefined),
    metadata: { fromCache, hasPendingWrites: false },
  };
}

function cloneRawOrHydrated(val) {
  if (val === null || val === undefined) return val;
  if (val instanceof LocalTimestamp) return LocalTimestamp.fromMillis(val.toMillis());
  if (Array.isArray(val)) return val.map((x) => cloneRawOrHydrated(x));
  if (typeof val === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(val)) {
      o[k] = cloneRawOrHydrated(v);
    }
    return o;
  }
  return val;
}

function makeQuerySnapshot(entries, prevSnapshotMap = new Map()) {
  const docs = entries.map((e) => ({
    id: e.id,
    path: e.path,
    exists: () => true,
    data: () => hydrateData(cloneRaw(e.data)),
  }));

  let cachedChanges = null;
  const computeChanges = () => {
    if (cachedChanges) return cachedChanges;
    const changes = [];
    const seen = new Set();
    entries.forEach((entry, idx) => {
      seen.add(entry.id);
      const prev = prevSnapshotMap.get(entry.id);
      const dataStr = JSON.stringify(entry.data);
      const docSnap = docs[idx];
      if (!prev) {
        changes.push({ type: 'added', doc: docSnap, oldIndex: -1, newIndex: idx });
      } else if (prev.dataStr !== dataStr || prev.index !== idx) {
        changes.push({ type: 'modified', doc: docSnap, oldIndex: prev.index, newIndex: idx });
      }
    });
    for (const [oldId, prev] of prevSnapshotMap.entries()) {
      if (!seen.has(oldId)) {
        changes.push({ type: 'removed', doc: prev.doc, oldIndex: prev.index, newIndex: -1 });
      }
    }
    cachedChanges = changes;
    return changes;
  };

  return {
    empty: docs.length === 0,
    size: docs.length,
    docs,
    forEach(cb) {
      docs.forEach((d, i) => cb(d, i));
    },
    docChanges() {
      return computeChanges();
    },
  };
}

export class LocalFirestoreDatabase {
  constructor(options = {}) {
    this._kind = 'db';
    this.isLocal = true;
    this.memoryDocs = new Map();
    this.docListeners = new Map(); // docPath -> Set<() => void>
    this.colListeners = new Map(); // colPath -> Set<() => void>
    this.persistTimer = null;
    this.backendMode = options.backendMode || 'auto'; // 'auto' | 'memory-only'
    this.serverReachable = null; // null | true | false
    this.lastServerFailMs = 0;
    this.channel = null;

    if (typeof window !== 'undefined' && this.backendMode !== 'memory-only') {
      this._hydrateFromLocalStorage();
      try {
        if ('BroadcastChannel' in window) {
          this.channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
          this.channel.onmessage = (ev) => {
            if (ev?.data?.type === 'MUTATION') {
              this.applyRemoteEvent(ev.data.event, false);
            }
          };
        }
      } catch {
        this.channel = null;
      }
    }
  }

  _hydrateFromLocalStorage() {
    try {
      const raw = window.localStorage?.getItem(LOCAL_STORAGE_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (k && v && typeof v === 'object') {
            this.memoryDocs.set(normalizePath(k), v);
          }
        }
      }
    } catch {
      /* ignore corrupt cache */
    }
  }

  _schedulePersistLocalStorage() {
    if (typeof window === 'undefined' || this.backendMode === 'memory-only') return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try {
        const obj = {};
        for (const [k, v] of this.memoryDocs.entries()) {
          // Ne pas saturer localStorage avec les gros savestates (> 150 Ko)
          if (k.includes('/sync/handoff_state')) continue;
          const json = JSON.stringify(v);
          if (json.length > 180000 && k.startsWith('fc_lobbies/')) continue;
          obj[k] = v;
        }
        window.localStorage?.setItem(LOCAL_STORAGE_CACHE_KEY, JSON.stringify(obj));
      } catch {
        /* ignore quota error */
      }
    }, 300);
  }

  _canTryServer() {
    if (this.backendMode === 'memory-only') return false;
    if (typeof fetch !== 'function' || typeof window === 'undefined') return false;
    if (this.serverReachable === false && Date.now() - this.lastServerFailMs < 25000) {
      return false;
    }
    return true;
  }

  async _rpc(payload, timeoutMs = 2600) {
    if (!this._canTryServer()) return null;
    if (
      payload &&
      ['setDoc', 'updateDoc', 'addDoc', 'deleteDoc'].includes(payload.op) &&
      typeof payload.path === 'string' &&
      (payload.path === 'wallets' || payload.path.startsWith('wallets/'))
    ) {
      return null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch('/api/local-firebase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (res.status === 404 || res.status === 405) {
        this.serverReachable = false;
        this.lastServerFailMs = Date.now();
        return null;
      }
      if (!res.ok) return null;
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (!ct.includes('json')) {
        this.serverReachable = false;
        this.lastServerFailMs = Date.now();
        return null;
      }
      const data = await res.json();
      if (data && data.ok) {
        this.serverReachable = true;
        return data;
      }
      return null;
    } catch {
      this.serverReachable = false;
      this.lastServerFailMs = Date.now();
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  _getLocalCollectionEntries(colPath) {
    const norm = normalizePath(colPath);
    const prefix = norm ? `${norm}/` : '';
    const out = [];
    for (const [p, data] of this.memoryDocs.entries()) {
      if (prefix) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        if (!rest || rest.includes('/')) continue;
        out.push({ id: rest, path: p, data: cloneRaw(data) });
      } else if (!p.includes('/')) {
        out.push({ id: p, path: p, data: cloneRaw(data) });
      }
    }
    return out;
  }

  _notifyPathChanged(docPath) {
    const norm = normalizePath(docPath);
    const parent = getParentPath(norm);

    const docSet = this.docListeners.get(norm);
    if (docSet) {
      docSet.forEach((fn) => {
        try {
          fn();
        } catch {}
      });
    }

    const colSet = this.colListeners.get(parent);
    if (colSet) {
      colSet.forEach((fn) => {
        try {
          fn();
        } catch {}
      });
    }
  }

  applyRemoteEvent(event, rebroadcast = false) {
    if (!event || !event.path) return;
    const norm = normalizePath(event.path);
    if (event.opType === 'delete' || event.changeType === 'removed' || event.type === 'delete') {
      this.memoryDocs.delete(norm);
    } else if (event.data && typeof event.data === 'object') {
      this.memoryDocs.set(norm, cloneRaw(event.data));
    }
    this._schedulePersistLocalStorage();
    this._notifyPathChanged(norm);
    if (rebroadcast && this.channel) {
      try {
        this.channel.postMessage({ type: 'MUTATION', event });
      } catch {}
    }
  }

  async getDoc(docRef) {
    const norm = normalizePath(docRef?.path);
    if (!norm) return makeDocSnapshot('', null, true);

    const srv = await this._rpc({ op: 'getDoc', path: norm });
    if (srv) {
      if (srv.exists && srv.data) {
        this.memoryDocs.set(norm, cloneRaw(srv.data));
        this._schedulePersistLocalStorage();
        return makeDocSnapshot(norm, srv.data, false);
      }
      this.memoryDocs.delete(norm);
      return makeDocSnapshot(norm, null, false);
    }

    const localData = this.memoryDocs.get(norm) || null;
    return makeDocSnapshot(norm, localData, true);
  }

  async getDocs(targetRef) {
    const norm = normalizePath(targetRef?.path);
    const constraints = targetRef?.constraints || [];

    const srv = await this._rpc({ op: 'getDocs', path: norm, constraints });
    if (srv && Array.isArray(srv.docs)) {
      srv.docs.forEach((d) => {
        if (d?.path && d?.data) {
          this.memoryDocs.set(normalizePath(d.path), cloneRaw(d.data));
        }
      });
      this._schedulePersistLocalStorage();
      return makeQuerySnapshot(srv.docs);
    }

    const localEntries = applyClientConstraints(this._getLocalCollectionEntries(norm), constraints);
    return makeQuerySnapshot(localEntries);
  }

  async setDoc(docRef, data, options = {}) {
    const norm = normalizePath(docRef?.path);
    if (!norm) return;
    const now = Date.now();
    const resolved = resolveSentinelsClient(data || {}, now);
    const prev = this.memoryDocs.get(norm) || null;
    const optimistic = options?.merge && prev ? deepMergeRaw(prev, resolved) : deepMergeRaw({}, resolved);

    this.memoryDocs.set(norm, optimistic);
    this._schedulePersistLocalStorage();
    this._notifyPathChanged(norm);
    if (this.channel) {
      try {
        this.channel.postMessage({
          type: 'MUTATION',
          event: { changeType: prev ? 'modified' : 'added', path: norm, parentPath: getParentPath(norm), data: optimistic },
        });
      } catch {}
    }

    const srv = await this._rpc({
      op: 'setDoc',
      path: norm,
      data: cloneRaw(data || {}),
      merge: Boolean(options?.merge),
    });
    if (srv?.data) {
      this.memoryDocs.set(norm, cloneRaw(srv.data));
    }
  }

  async updateDoc(docRef, patch) {
    const norm = normalizePath(docRef?.path);
    if (!norm) return;
    const now = Date.now();
    const resolvedPatch = resolveSentinelsClient(patch || {}, now);
    const prev = this.memoryDocs.get(norm) || {};
    const optimistic = applyDottedPatchRaw(prev, resolvedPatch);

    this.memoryDocs.set(norm, optimistic);
    this._schedulePersistLocalStorage();
    this._notifyPathChanged(norm);
    if (this.channel) {
      try {
        this.channel.postMessage({
          type: 'MUTATION',
          event: { changeType: 'modified', path: norm, parentPath: getParentPath(norm), data: optimistic },
        });
      } catch {}
    }

    const srv = await this._rpc({ op: 'updateDoc', path: norm, patch: cloneRaw(patch || {}) });
    if (srv?.data) {
      this.memoryDocs.set(norm, cloneRaw(srv.data));
    }
  }

  async addDoc(colRef, data) {
    const colPath = normalizePath(colRef?.path);
    const srv = await this._rpc({ op: 'addDoc', path: colPath, data: cloneRaw(data || {}) });
    if (srv?.id && srv?.path) {
      if (srv.data) {
        this.memoryDocs.set(normalizePath(srv.path), cloneRaw(srv.data));
        this._schedulePersistLocalStorage();
        this._notifyPathChanged(srv.path);
      }
      return doc(colRef, srv.id);
    }

    const id = generateAutoId();
    const docRef = doc(colRef, id);
    await this.setDoc(docRef, data, { merge: false });
    return docRef;
  }

  async deleteDoc(docRef) {
    const norm = normalizePath(docRef?.path);
    if (!norm) return;
    this.memoryDocs.delete(norm);
    this._schedulePersistLocalStorage();
    this._notifyPathChanged(norm);
    if (this.channel) {
      try {
        this.channel.postMessage({
          type: 'MUTATION',
          event: { changeType: 'removed', path: norm, parentPath: getParentPath(norm), data: null },
        });
      } catch {}
    }
    await this._rpc({ op: 'deleteDoc', path: norm });
  }

  onSnapshot(target, onNext, onError) {
    let active = true;
    const path = normalizePath(target?.path);
    const isDocTarget = target?._kind === 'doc';

    if (!path) {
      return () => {};
    }

    let prevEntriesMap = new Map();
    let lastEmitJson = null;

    const emitFromMemory = () => {
      if (!active) return;
      if (isDocTarget) {
        const raw = this.memoryDocs.get(path) || null;
        const json = raw ? JSON.stringify(raw) : 'null';
        if (json === lastEmitJson) return;
        lastEmitJson = json;
        onNext?.(makeDocSnapshot(path, raw, true));
      } else {
        const entries = applyClientConstraints(this._getLocalCollectionEntries(path), target?.constraints || []);
        const snap = makeQuerySnapshot(entries, prevEntriesMap);
        const nextMap = new Map();
        entries.forEach((e, idx) => {
          nextMap.set(e.id, {
            index: idx,
            dataStr: JSON.stringify(e.data),
            doc: snap.docs[idx],
          });
        });
        const sig = entries.map((e) => `${e.id}:${JSON.stringify(e.data)}`).join('|');
        if (sig === lastEmitJson) return;
        lastEmitJson = sig;
        prevEntriesMap = nextMap;
        onNext?.(snap);
      }
    };

    const syncFromServer = async () => {
      if (!active) return;
      try {
        if (isDocTarget) {
          const snap = await this.getDoc(target);
          if (!active) return;
          const raw = this.memoryDocs.get(path) || null;
          const json = raw ? JSON.stringify(raw) : 'null';
          if (json !== lastEmitJson) {
            lastEmitJson = json;
            onNext?.(snap);
          }
        } else {
          const entriesRes = await this._rpc({ op: 'getDocs', path, constraints: target?.constraints || [] });
          if (!active) return;
          if (entriesRes && Array.isArray(entriesRes.docs)) {
            // Remplacer proprement la vue locale pour cette collection si requête complète sans contrainte where/limit
            if (!target?.constraints || target.constraints.length === 0) {
              const prefix = `${path}/`;
              for (const k of Array.from(this.memoryDocs.keys())) {
                if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) {
                  this.memoryDocs.delete(k);
                }
              }
            }
            entriesRes.docs.forEach((d) => {
              if (d?.path && d?.data) this.memoryDocs.set(normalizePath(d.path), cloneRaw(d.data));
            });
            this._schedulePersistLocalStorage();
            const entries = entriesRes.docs;
            const snap = makeQuerySnapshot(entries, prevEntriesMap);
            const nextMap = new Map();
            entries.forEach((e, idx) => {
              nextMap.set(e.id, {
                index: idx,
                dataStr: JSON.stringify(e.data),
                doc: snap.docs[idx],
              });
            });
            const sig = entries.map((e) => `${e.id}:${JSON.stringify(e.data)}`).join('|');
            if (sig !== lastEmitJson) {
              lastEmitJson = sig;
              prevEntriesMap = nextMap;
              onNext?.(snap);
            }
          } else {
            emitFromMemory();
          }
        }
      } catch (err) {
        onError?.(err);
      }
    };

    const map = isDocTarget ? this.docListeners : this.colListeners;
    if (!map.has(path)) map.set(path, new Set());
    map.get(path).add(emitFromMemory);

    // 1. Si le cache mémoire contient déjà des données, émission immédiate (0 ms)
    if (isDocTarget ? this.memoryDocs.has(path) : this._getLocalCollectionEntries(path).length > 0) {
      emitFromMemory();
    }
    // 2. Synchronisation initiale serveur (1-2 ms) pour garantir l'état à jour
    syncFromServer();

    return () => {
      active = false;
      const set = map.get(path);
      if (set) {
        set.delete(emitFromMemory);
        if (set.size === 0) map.delete(path);
      }
    };
  }
}

let singletonDb = null;

export function getLocalFirestore() {
  if (!singletonDb) {
    singletonDb = new LocalFirestoreDatabase();
  }
  return singletonDb;
}

export function createLocalFirestore(options = {}) {
  return new LocalFirestoreDatabase(options);
}

export function notifyLocalFirestoreRemoteEvent(event) {
  if (!singletonDb || !event) return;
  singletonDb.applyRemoteEvent(event, false);
}

export function collection(parentOrDb, ...segments) {
  const base = parentOrDb?._kind === 'doc' || parentOrDb?._kind === 'collection' ? parentOrDb.path : '';
  const path = normalizePath([base, ...segments].filter(Boolean).join('/'));
  return {
    _kind: 'collection',
    _db: parentOrDb?._kind === 'db' ? parentOrDb : parentOrDb?._db || getLocalFirestore(),
    id: getDocId(path),
    path,
  };
}

export function doc(parentOrDb, ...segments) {
  if (parentOrDb?._kind === 'collection' && segments.length === 0) {
    const autoId = generateAutoId();
    const path = normalizePath(`${parentOrDb.path}/${autoId}`);
    return {
      _kind: 'doc',
      _db: parentOrDb._db || getLocalFirestore(),
      id: autoId,
      path,
      parent: parentOrDb,
    };
  }
  const base = parentOrDb?._kind === 'doc' || parentOrDb?._kind === 'collection' ? parentOrDb.path : '';
  const path = normalizePath([base, ...segments].filter(Boolean).join('/'));
  return {
    _kind: 'doc',
    _db: parentOrDb?._kind === 'db' ? parentOrDb : parentOrDb?._db || getLocalFirestore(),
    id: getDocId(path),
    path,
  };
}

export function query(target, ...constraints) {
  return {
    _kind: 'query',
    _db: target?._db || getLocalFirestore(),
    id: target?.id || '',
    path: normalizePath(target?.path || ''),
    constraints: [...(target?.constraints || []), ...constraints.filter(Boolean)],
  };
}

function resolveDbFromTarget(target) {
  return target?._db || getLocalFirestore();
}

export function getDoc(docRef) {
  return resolveDbFromTarget(docRef).getDoc(docRef);
}

export function getDocs(targetRef) {
  return resolveDbFromTarget(targetRef).getDocs(targetRef);
}

export function setDoc(docRef, data, options) {
  return resolveDbFromTarget(docRef).setDoc(docRef, data, options);
}

export function updateDoc(docRef, patch) {
  return resolveDbFromTarget(docRef).updateDoc(docRef, patch);
}

export function addDoc(colRef, data) {
  return resolveDbFromTarget(colRef).addDoc(colRef, data);
}

export function deleteDoc(docRef) {
  return resolveDbFromTarget(docRef).deleteDoc(docRef);
}

export function onSnapshot(targetRef, onNext, onError) {
  return resolveDbFromTarget(targetRef).onSnapshot(targetRef, onNext, onError);
}
