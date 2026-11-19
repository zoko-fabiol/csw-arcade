/**
 * Service React unifié pour le cache IndexedDB, la recherche Archive.org et le téléchargement des ROMs.
 */

const PLATFORM_IDB_NAME = 'csw_platform_roms_db';
const PLATFORM_IDB_STORE = 'rom_files';

const SYSTEM_SEARCH_HINTS = {
  mame2003_plus: { keywords: 'mame arcade', extensions: ['.zip'] },
  fbneo: { keywords: 'neogeo fbneo arcade', extensions: ['.zip'] },
  sega32x: { keywords: 'sega 32x', extensions: ['.32x', '.bin', '.zip'] },
  nes: { keywords: 'nes nintendo', extensions: ['.nes', '.zip'] },
  snes: { keywords: 'snes super nintendo', extensions: ['.sfc', '.smc', '.zip'] },
  gba: { keywords: 'gba game boy advance', extensions: ['.gba', '.zip'] },
  gb: { keywords: 'game boy', extensions: ['.gb', '.zip'] },
  gbc: { keywords: 'game boy color', extensions: ['.gbc', '.zip'] },
  n64: { keywords: 'nintendo 64 n64', extensions: ['.z64', '.n64', '.v64', '.zip'] },
  segaMD: { keywords: 'genesis mega drive sega', extensions: ['.md', '.gen', '.bin', '.zip'] },
  segaMS: { keywords: 'master system sega', extensions: ['.sms', '.zip'] },
  segaGG: { keywords: 'game gear sega', extensions: ['.gg', '.zip'] },
  pce: { keywords: 'pc engine turbografx', extensions: ['.pce', '.zip'] },
  nds: { keywords: 'nintendo ds nds', extensions: ['.nds', '.zip'] },
  psx: { keywords: 'playstation ps1 psx', extensions: ['.chd', '.pbp', '.bin', '.iso', '.zip'] },
  ps1: { keywords: 'playstation ps1 psx', extensions: ['.chd', '.pbp', '.bin', '.iso', '.zip'] },
  j2me: { keywords: 'j2me gameloft java', extensions: ['.jar', '.zip'] },
};

export function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!n) return '0 o';
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

function openPlatformDb() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB indisponible'));
    }
    const req = window.indexedDB.open(PLATFORM_IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(PLATFORM_IDB_STORE)) {
        db.createObjectStore(PLATFORM_IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erreur IndexedDB'));
  });
}

export async function getCachedRom(id) {
  try {
    const db = await openPlatformDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(PLATFORM_IDB_STORE, 'readonly');
      const req = tx.objectStore(PLATFORM_IDB_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveCachedRom(id, buffer, meta = {}) {
  try {
    const db = await openPlatformDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(PLATFORM_IDB_STORE, 'readwrite');
      tx.objectStore(PLATFORM_IDB_STORE).put({
        id,
        title: meta.title || id,
        filename: meta.filename || `${id}.bin`,
        mode: meta.mode || 'retro',
        platform: meta.platform || 'retro',
        core: meta.core || 'nes',
        size: buffer.byteLength,
        data: buffer,
        cachedAt: Date.now(),
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export async function listCachedRoms(mode = null) {
  try {
    const db = await openPlatformDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(PLATFORM_IDB_STORE, 'readonly');
      const req = tx.objectStore(PLATFORM_IDB_STORE).getAll();
      req.onsuccess = () => {
        const rows = Array.isArray(req.result) ? req.result : [];
        resolve(
          rows
            .filter((r) => !mode || r.mode === mode)
            .map((r) => ({
              id: r.id,
              title: r.title,
              filename: r.filename,
              mode: r.mode,
              platform: r.platform,
              core: r.core,
              size: r.size || r.data?.byteLength || 0,
              cachedAt: r.cachedAt || 0,
            }))
            .sort((a, b) => b.cachedAt - a.cachedAt)
        );
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function removeCachedRom(id) {
  try {
    const db = await openPlatformDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(PLATFORM_IDB_STORE, 'readwrite');
      tx.objectStore(PLATFORM_IDB_STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export async function getPlatformCacheStats() {
  const rows = await listCachedRoms();
  return {
    count: rows.length,
    totalBytes: rows.reduce((sum, r) => sum + (r.size || 0), 0),
  };
}

let jsZipPromise = null;
async function ensureJSZip() {
  if (typeof window !== 'undefined' && window.JSZip) return window.JSZip;
  if (!jsZipPromise) {
    jsZipPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
      s.onload = () => (window.JSZip ? resolve(window.JSZip) : reject(new Error('JSZip indisponible')));
      s.onerror = () => reject(new Error('Échec chargement JSZip'));
      document.head.append(s);
    });
  }
  return jsZipPromise;
}

export async function searchOnlineRoms(query, { system = 'nes', limit = 12 } = {}) {
  const hint = SYSTEM_SEARCH_HINTS[system] || { keywords: system, extensions: ['.zip'] };
  const cleanQ = String(query || '').trim();
  if (!cleanQ) return [];

  const q = `(${cleanQ}) AND (${hint.keywords}) AND mediatype:(software OR data)`;
  const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier,title,downloads&sort[]=downloads+desc&rows=8&output=json`;
  const res = await fetch(searchUrl);
  if (!res.ok) throw new Error(`Archive.org HTTP ${res.status}`);
  const data = await res.json();
  const docs = data?.response?.docs || [];
  const results = [];

  for (const doc of docs.slice(0, 4)) {
    try {
      const metaRes = await fetch(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}/files`);
      if (!metaRes.ok) continue;
      const meta = await metaRes.json();
      const files = (meta?.result || []).filter((f) => {
        const lower = String(f.name || '').toLowerCase();
        return hint.extensions.some((ext) => lower.endsWith(ext)) && Number(f.size || 0) < 160 * 1024 * 1024;
      });
      for (const f of files.slice(0, 4)) {
        const encoded = f.name.split('/').map((s) => encodeURIComponent(s)).join('/');
        const dl = `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encoded}`;
        results.push({
          id: `${doc.identifier}-${f.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          title: f.name.split('/').pop().replace(/\.[^.]+$/, ''),
          filename: f.name.split('/').pop(),
          size: Number(f.size || 0),
          sourceLabel: doc.title || doc.identifier,
          urls: [
            `https://archive.org/cors/${encodeURIComponent(doc.identifier)}/${encoded}`,
            `/api/rom-proxy?url=${encodeURIComponent(dl)}`,
            dl,
          ],
        });
        if (results.length >= limit) return results;
      }
    } catch {
      /* continue */
    }
  }
  return results;
}

export async function downloadAndCacheRom(entry, { mode = 'retro', core = 'nes', extractExtensions = [], onProgress } = {}) {
  const cached = await getCachedRom(entry.id);
  if (cached?.data) {
    return new File([cached.data], cached.filename || entry.filename, { type: 'application/octet-stream' });
  }

  const urls = Array.isArray(entry.urls) ? entry.urls : [];
  let buffer = null;
  let lastErr = null;

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length') || 0);
      if (res.body?.getReader) {
        const reader = res.body.getReader();
        const chunks = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          onProgress?.({ received, total });
        }
        const merged = new Uint8Array(received);
        let offset = 0;
        for (const c of chunks) {
          merged.set(c, offset);
          offset += c.byteLength;
        }
        buffer = merged.buffer;
      } else {
        buffer = await res.arrayBuffer();
      }
      if (buffer && buffer.byteLength > 0) break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!buffer) {
    throw lastErr || new Error('Impossible de télécharger cette ROM depuis Archive.org');
  }

  let finalFilename = entry.filename || `${entry.id}.bin`;
  let finalBuffer = buffer;

  if (finalFilename.toLowerCase().endsWith('.zip') && Array.isArray(extractExtensions) && extractExtensions.length > 0) {
    try {
      const JSZip = await ensureJSZip();
      const zip = await JSZip.loadAsync(buffer);
      const match = Object.values(zip.files).find(
        (f) => !f.dir && !f.name.startsWith('__MACOSX/') && extractExtensions.some((ext) => f.name.toLowerCase().endsWith(ext))
      );
      if (match) {
        finalBuffer = await match.async('arraybuffer');
        finalFilename = match.name.split('/').pop();
      }
    } catch {
      /* keep zip as fallback */
    }
  }

  await saveCachedRom(entry.id, finalBuffer, {
    title: entry.title,
    filename: finalFilename,
    mode,
    platform: entry.platform || core,
    core,
  });

  return new File([finalBuffer], finalFilename, { type: 'application/octet-stream' });
}
