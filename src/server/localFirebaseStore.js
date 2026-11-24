import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function normalizeFsPath(rawPath) {
  return String(rawPath || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/');
}

export function getParentPath(docPath) {
  const norm = normalizeFsPath(docPath);
  const idx = norm.lastIndexOf('/');
  return idx > 0 ? norm.slice(0, idx) : '';
}

export function getDocId(docPath) {
  const norm = normalizeFsPath(docPath);
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

export function generateFirestoreId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isSafeKey(key) {
  return typeof key === 'string' && key.length > 0 && !FORBIDDEN_KEYS.has(key);
}

function isPlainObject(val) {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val) && !val.__cswTsMs;
}

export function resolveSentinels(value, nowMs = Date.now()) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => resolveSentinels(item, nowMs));
  }
  if (typeof value === 'object') {
    if (value.__cswServerTimestamp === true) {
      return { __cswTsMs: nowMs };
    }
    if (value.__cswDeleteField === true) {
      return { __cswDeleteField: true };
    }
    if (typeof value.__cswTsMs === 'number') {
      return { __cswTsMs: value.__cswTsMs };
    }
    const next = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined || !isSafeKey(k)) continue;
      next[k] = resolveSentinels(v, nowMs);
    }
    return next;
  }
  return value;
}

function deepMergeObjects(target, source) {
  const base = isPlainObject(target) ? { ...target } : {};
  if (!isPlainObject(source)) return base;
  for (const [k, v] of Object.entries(source)) {
    if (!isSafeKey(k)) continue;
    if (v && typeof v === 'object' && v.__cswDeleteField === true) {
      delete base[k];
      continue;
    }
    if (isPlainObject(v) && isPlainObject(base[k])) {
      base[k] = deepMergeObjects(base[k], v);
    } else if (Array.isArray(v)) {
      base[k] = v.slice();
    } else if (isPlainObject(v)) {
      base[k] = deepMergeObjects({}, v);
    } else {
      base[k] = v;
    }
  }
  return base;
}

function applyDottedPatch(target, patch) {
  const out = isPlainObject(target) ? deepMergeObjects({}, target) : {};
  for (const [rawKey, val] of Object.entries(patch || {})) {
    if (!rawKey) continue;
    const parts = rawKey.split('.');
    if (parts.some((p) => !isSafeKey(p))) continue;
    if (parts.length === 1) {
      if (val && typeof val === 'object' && val.__cswDeleteField === true) {
        delete out[rawKey];
      } else {
        out[rawKey] = val;
      }
      continue;
    }
    let cursor = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!isPlainObject(cursor[seg])) {
        cursor[seg] = {};
      } else {
        cursor[seg] = { ...cursor[seg] };
      }
      cursor = cursor[seg];
    }
    const leaf = parts[parts.length - 1];
    if (val && typeof val === 'object' && val.__cswDeleteField === true) {
      delete cursor[leaf];
    } else {
      cursor[leaf] = val;
    }
  }
  return out;
}

function readFieldValue(docObj, fieldPath) {
  if (!docObj || !fieldPath) return undefined;
  const parts = String(fieldPath).split('.');
  let cur = docObj;
  for (const seg of parts) {
    if (!isSafeKey(seg) || cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function toComparable(val) {
  if (val && typeof val === 'object' && typeof val.__cswTsMs === 'number') {
    return val.__cswTsMs;
  }
  if (val && typeof val === 'object' && typeof val.seconds === 'number') {
    return val.seconds * 1000 + Math.round((val.nanoseconds || 0) / 1e6);
  }
  return val;
}

export function matchesConstraint(docObj, constraint) {
  if (!constraint || constraint.type !== 'where') return true;
  const rawField = readFieldValue(docObj, constraint.field);
  const actual = toComparable(rawField);
  const expected = toComparable(constraint.value);
  switch (constraint.op) {
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
      return Array.isArray(rawField) && rawField.includes(constraint.value);
    case 'array-contains-any':
      return Array.isArray(rawField) && Array.isArray(expected) && expected.some((v) => rawField.includes(v));
    default:
      return true;
  }
}

export function applyQueryConstraints(entries, constraints = []) {
  const wheres = [];
  const orders = [];
  let limitCount = null;
  let limitToLast = null;

  for (const c of Array.isArray(constraints) ? constraints : []) {
    if (!c) continue;
    if (c.type === 'where') wheres.push(c);
    else if (c.type === 'orderBy') orders.push(c);
    else if (c.type === 'limit') limitCount = Math.max(0, Number(c.count || 0));
    else if (c.type === 'limitToLast') limitToLast = Math.max(0, Number(c.count || 0));
  }

  let list = wheres.length === 0
    ? entries.slice()
    : entries.filter((entry) => wheres.every((w) => matchesConstraint(entry.data, w)));

  if (orders.length > 0) {
    list.sort((a, b) => {
      for (const ord of orders) {
        const va = toComparable(readFieldValue(a.data, ord.field));
        const vb = toComparable(readFieldValue(b.data, ord.field));
        if (va === vb) continue;
        if (va === undefined || va === null) return ord.dir === 'desc' ? 1 : -1;
        if (vb === undefined || vb === null) return ord.dir === 'desc' ? -1 : 1;
        let cmp = 0;
        if (typeof va === 'number' && typeof vb === 'number') {
          cmp = va - vb;
        } else {
          cmp = String(va).localeCompare(String(vb));
        }
        if (cmp !== 0) return ord.dir === 'desc' ? -cmp : cmp;
      }
      return a.id.localeCompare(b.id);
    });
  }

  if (limitCount !== null) {
    list = list.slice(0, limitCount);
  } else if (limitToLast !== null && list.length > limitToLast) {
    list = list.slice(list.length - limitToLast);
  }

  return list;
}

export class LocalFirebaseStore {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.resolve(process.cwd(), '.csw-data');
    this.filePath = options.filePath || path.join(this.dataDir, 'local-firebase.json');
    this.docs = new Map();
    this.listeners = new Set();
    this.saveTimer = null;
    this.persistDisabled = Boolean(options.inMemoryOnly);

    if (!this.persistDisabled) {
      this._loadFromDisk();
    }
  }

  _loadFromDisk() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = raw ? JSON.parse(raw) : {};
        const docMap = parsed?.docs && typeof parsed.docs === 'object' ? parsed.docs : {};
        for (const [docPath, data] of Object.entries(docMap)) {
          const norm = normalizeFsPath(docPath);
          if (norm && data && typeof data === 'object') {
            this.docs.set(norm, data);
          }
        }
        return;
      }

      // Import initial social-store users/friendships on first boot if present
      const socialPath = path.join(this.dataDir, 'social-store.json');
      if (fs.existsSync(socialPath)) {
        const social = JSON.parse(fs.readFileSync(socialPath, 'utf8') || '{}');
        if (social?.users && typeof social.users === 'object') {
          for (const [uid, u] of Object.entries(social.users)) {
            if (uid && u) {
              this.docs.set(`users/${uid}`, { ...u, uid });
            }
          }
        }
        if (social?.friendships && typeof social.friendships === 'object') {
          for (const [uid, list] of Object.entries(social.friendships)) {
            if (!Array.isArray(list)) continue;
            for (const friendUid of list) {
              if (!friendUid || friendUid === uid) continue;
              const friendProfile = social.users?.[friendUid] || { uid: friendUid };
              this.docs.set(`users/${uid}/friends/${friendUid}`, {
                ...friendProfile,
                uid: friendUid,
              });
            }
          }
        }
        this.scheduleSave();
      }
    } catch {
      /* ignore corrupted file */
    }
  }

  flushSync() {
    if (this.persistDisabled) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      const docsObj = {};
      for (const [k, v] of this.docs.entries()) {
        docsObj[k] = v;
      }
      const tmpPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify({ version: 1, updatedAtMs: Date.now(), docs: docsObj }, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.filePath);
    } catch {
      /* fallback best effort */
    }
  }

  scheduleSave() {
    if (this.persistDisabled) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushSync();
    }, 200);
  }

  onMutation(cb) {
    if (typeof cb !== 'function') return () => {};
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  _emitMutation(event) {
    for (const cb of this.listeners) {
      try {
        cb(event);
      } catch {
        /* ignore listener errors */
      }
    }
  }

  getDoc(rawPath) {
    const docPath = normalizeFsPath(rawPath);
    if (!docPath) return { exists: false, id: '', path: '', data: null };
    const data = this.docs.get(docPath);
    return {
      exists: Boolean(data),
      id: getDocId(docPath),
      path: docPath,
      data: data ? deepMergeObjects({}, data) : null,
    };
  }

  getCollectionDocs(rawColPath) {
    const colPath = normalizeFsPath(rawColPath);
    const prefix = colPath ? `${colPath}/` : '';
    const out = [];
    for (const [docPath, data] of this.docs.entries()) {
      if (prefix) {
        if (!docPath.startsWith(prefix)) continue;
        const rest = docPath.slice(prefix.length);
        if (!rest || rest.includes('/')) continue;
        out.push({ id: rest, path: docPath, data: deepMergeObjects({}, data) });
      } else if (!docPath.includes('/')) {
        out.push({ id: docPath, path: docPath, data: deepMergeObjects({}, data) });
      }
    }
    return out;
  }

  queryCollection(rawColPath, constraints = []) {
    const entries = this.getCollectionDocs(rawColPath);
    return applyQueryConstraints(entries, constraints);
  }

  setDoc(rawPath, data, options = {}) {
    const docPath = normalizeFsPath(rawPath);
    if (!docPath) throw new Error('Chemin Firestore vide');
    const now = Date.now();
    const resolved = resolveSentinels(data || {}, now);
    const prevData = this.docs.get(docPath) || null;
    const nextData = options?.merge && prevData
      ? deepMergeObjects(prevData, resolved)
      : deepMergeObjects({}, resolved);

    this.docs.set(docPath, nextData);
    this.scheduleSave();

    const event = {
      type: 'set',
      changeType: prevData ? 'modified' : 'added',
      path: docPath,
      parentPath: getParentPath(docPath),
      id: getDocId(docPath),
      data: deepMergeObjects({}, nextData),
    };
    this._emitMutation(event);
    return event;
  }

  updateDoc(rawPath, patch) {
    const docPath = normalizeFsPath(rawPath);
    if (!docPath) throw new Error('Chemin Firestore vide');
    const now = Date.now();
    const resolvedPatch = resolveSentinels(patch || {}, now);
    const prevExisted = this.docs.has(docPath);
    const prevData = prevExisted ? this.docs.get(docPath) : {};
    const nextData = applyDottedPatch(prevData, resolvedPatch);

    this.docs.set(docPath, nextData);
    this.scheduleSave();

    const event = {
      type: 'set',
      changeType: prevExisted ? 'modified' : 'added',
      path: docPath,
      parentPath: getParentPath(docPath),
      id: getDocId(docPath),
      data: deepMergeObjects({}, nextData),
    };
    this._emitMutation(event);
    return event;
  }

  addDoc(rawColPath, data) {
    const colPath = normalizeFsPath(rawColPath);
    const id = generateFirestoreId();
    const docPath = colPath ? `${colPath}/${id}` : id;
    const res = this.setDoc(docPath, data, { merge: false });
    return { ...res, id, path: docPath };
  }

  deleteDoc(rawPath) {
    const docPath = normalizeFsPath(rawPath);
    if (!docPath) return { deleted: false, path: '' };
    const existed = this.docs.delete(docPath);
    if (existed) {
      this.scheduleSave();
      this._emitMutation({
        type: 'delete',
        changeType: 'removed',
        path: docPath,
        parentPath: getParentPath(docPath),
        id: getDocId(docPath),
        data: null,
      });
    }
    return { deleted: existed, path: docPath };
  }
}
