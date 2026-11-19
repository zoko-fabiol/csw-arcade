/**
 * Gestion unifiée des préférences du Shell, du stockage local et des références de fichiers importés.
 */

const PREFS_KEY = 'csw_shell_prefs_v1';
const LOCAL_LIB_KEY = 'csw_platform_library_v1';
const ARCADE_IDB_NAME = 'csw_arcade_roms_db';
const ARCADE_IDB_STORE = 'rom_archives';

const DEFAULT_PREFS = {
  defaultMode: 'arcade',
  videoFilter: 'sharp',
  screenRatio: 'fit',
  volume: 80,
  muted: false,
  viewMode: 'grid',
};

/** Conserve les objets File importés durant la session pour relance rapide en 1 clic. */
const sessionFiles = new Map();

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(partial) {
  const next = { ...loadPrefs(), ...partial };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota / privacy mode errors
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('csw:prefs-changed', { detail: next }));
  }
  return next;
}

export function resetPrefs() {
  try {
    localStorage.removeItem(PREFS_KEY);
  } catch {
    // Ignore
  }
  const next = { ...DEFAULT_PREFS };
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('csw:prefs-changed', { detail: next }));
  }
  return next;
}

export function clearPlatformRomCache() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) return resolve(false);
    try {
      const req = window.indexedDB.open('csw_platform_roms_db', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('rom_files')) {
          db.createObjectStore('rom_files', { keyPath: 'id' });
        }
      };
      req.onerror = () => resolve(false);
      req.onsuccess = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains('rom_files')) return resolve(true);
          const tx = db.transaction('rom_files', 'readwrite');
          tx.objectStore('rom_files').clear();
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      };
    } catch {
      resolve(false);
    }
  });
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Mo';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

export function registerSessionFile(mode, id, file, meta = {}) {
  sessionFiles.set(`${mode}:${id}`, file);
  const items = listImportedLibrary(mode).filter((item) => item.id !== id);
  items.unshift({
    id,
    mode,
    title: meta.title || file.name.replace(/\.[^.]+$/, ''),
    filename: file.name,
    size: file.size,
    platform: meta.platform || mode,
    platformLabel: meta.platformLabel || mode.toUpperCase(),
    addedAt: Date.now(),
  });
  saveImportedLibrary(mode, items.slice(0, 40));
}

export function getSessionFile(mode, id) {
  return sessionFiles.get(`${mode}:${id}`) || null;
}

export function listImportedLibrary(mode) {
  try {
    const raw = localStorage.getItem(LOCAL_LIB_KEY);
    const all = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(all)) return [];
    return mode ? all.filter((x) => x.mode === mode) : all;
  } catch {
    return [];
  }
}

export function removeImportedEntry(mode, id) {
  sessionFiles.delete(`${mode}:${id}`);
  try {
    const raw = localStorage.getItem(LOCAL_LIB_KEY);
    const all = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(all)) return;
    localStorage.setItem(
      LOCAL_LIB_KEY,
      JSON.stringify(all.filter((x) => !(x.mode === mode && x.id === id)))
    );
  } catch {
    // Ignore
  }
}

function saveImportedLibrary(mode, modeItems) {
  try {
    const raw = localStorage.getItem(LOCAL_LIB_KEY);
    const all = Array.isArray(raw ? JSON.parse(raw) : null) ? JSON.parse(raw) : [];
    const others = all.filter((x) => x.mode !== mode);
    localStorage.setItem(LOCAL_LIB_KEY, JSON.stringify([...modeItems, ...others]));
  } catch {
    // Ignore
  }
}

/**
 * Audite les ROMs Neo Geo déjà stockées dans IndexedDB sans modifier la base existante.
 */
export function getArcadeCacheStats() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return resolve({ count: 0, totalBytes: 0, files: [] });
    }
    const timer = setTimeout(() => resolve({ count: 0, totalBytes: 0, files: [] }), 1200);
    try {
      const req = window.indexedDB.open(ARCADE_IDB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(ARCADE_IDB_STORE)) {
          db.createObjectStore(ARCADE_IDB_STORE, { keyPath: 'id' });
        }
      };
      req.onerror = () => {
        clearTimeout(timer);
        resolve({ count: 0, totalBytes: 0, files: [] });
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(ARCADE_IDB_STORE)) {
            clearTimeout(timer);
            return resolve({ count: 0, totalBytes: 0, files: [] });
          }
          const tx = db.transaction(ARCADE_IDB_STORE, 'readonly');
          const store = tx.objectStore(ARCADE_IDB_STORE);
          const allReq = store.getAll();
          allReq.onsuccess = () => {
            clearTimeout(timer);
            const rows = Array.isArray(allReq.result) ? allReq.result : [];
            const totalBytes = rows.reduce((sum, r) => sum + (r.size || r.data?.byteLength || 0), 0);
            resolve({
              count: rows.length,
              totalBytes,
              files: rows.map((r) => r.filename || r.id),
            });
          };
          allReq.onerror = () => {
            clearTimeout(timer);
            resolve({ count: 0, totalBytes: 0, files: [] });
          };
        } catch {
          clearTimeout(timer);
          resolve({ count: 0, totalBytes: 0, files: [] });
        }
      };
    } catch {
      clearTimeout(timer);
      resolve({ count: 0, totalBytes: 0, files: [] });
    }
  });
}

let cachedCatalogJson = null;

export async function fetchHomebrewCatalog() {
  if (cachedCatalogJson) return cachedCatalogJson;
  try {
    const res = await fetch('./catalog.json');
    if (!res.ok) return [];
    const data = await res.json();
    cachedCatalogJson = Array.isArray(data) ? data : [];
    return cachedCatalogJson;
  } catch {
    return [];
  }
}
