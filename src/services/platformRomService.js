/**
 * Service React unifié pour le cache IndexedDB, la recherche Archive.org et le téléchargement des ROMs.
 */
import { NINTENDO_CATALOG, PLAYSTATION_CATALOG, SEGA_CATALOG } from '../data/platformCatalogs';
import fbneoMapping from '../data/fbneoMapping.json';
import { romStorage } from './romStorage';

const PLATFORM_IDB_NAME = 'csw_platform_roms_db';
const PLATFORM_IDB_STORE = 'rom_files';
const DEAD_ROMS_KEY = 'csw_dead_roms_v3';
try {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('csw_dead_roms_v1');
    localStorage.removeItem('csw_dead_roms_v2');
  }
} catch {
  /* noop */
}

const deadRomListeners = new Set();
const verifiedRomIds = new Set();
let deadRomSet = new Set();

export function getDeadRomIds() {
  return new Set(deadRomSet);
}

export function markRomAsDead(_id) {
  // Ne plus masquer définitivement les jeux du catalogue d'origine (ex: KOF 2002) en cas d'erreur temporaire Archive.org
}

export function subscribeDeadRoms(cb) {
  deadRomListeners.add(cb);
  cb(new Set(deadRomSet));
  return () => deadRomListeners.delete(cb);
}

const ROM_CACHE_VERSION = 3;

function isValidRomBuffer(buffer, filename = '') {
  if (!buffer || buffer.byteLength < 256) return false;
  const headBytes = new Uint8Array(buffer, 0, Math.min(96, buffer.byteLength));
  let headStr = '';
  for (let i = 0; i < headBytes.length; i++) {
    headStr += String.fromCharCode(headBytes[i]);
  }
  const lower = headStr.trim().toLowerCase();
  if (
    lower.startsWith('<!doctype') ||
    lower.startsWith('<html') ||
    lower.startsWith('<head') ||
    lower.startsWith('{"error"') ||
    lower.includes('item not available') ||
    lower.includes('rom introuvable')
  ) {
    return false;
  }
  const lowerName = String(filename || '').toLowerCase();
  if (lowerName.endsWith('.zip') || lowerName.endsWith('.jar')) {
    if (!(headBytes[0] === 0x50 && headBytes[1] === 0x4b && (headBytes[2] === 0x03 || headBytes[2] === 0x05))) {
      return false;
    }
  }
  return true;
}

export async function probeRomAvailability(entry) {
  if (!entry?.id) return false;
  if (verifiedRomIds.has(entry.id)) return true;
  if (!Array.isArray(entry.urls) || entry.urls.length === 0) return false;
  return true;
}

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

let cachedPlatformDbPromise = null;

function openPlatformDb() {
  if (cachedPlatformDbPromise) return cachedPlatformDbPromise;
  cachedPlatformDbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      cachedPlatformDbPromise = null;
      return reject(new Error('IndexedDB indisponible'));
    }
    const req = window.indexedDB.open(PLATFORM_IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(PLATFORM_IDB_STORE)) {
        db.createObjectStore(PLATFORM_IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => {
        cachedPlatformDbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        cachedPlatformDbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      cachedPlatformDbPromise = null;
      reject(req.error || new Error('Erreur IndexedDB'));
    };
  });
  return cachedPlatformDbPromise;
}

export async function getCachedRom(id) {
  try {
    const db = await openPlatformDb();
    const record = await new Promise((resolve) => {
      const tx = db.transaction(PLATFORM_IDB_STORE, 'readonly');
      const req = tx.objectStore(PLATFORM_IDB_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
    if (!record) {
      // Fallback : vérifier dans le dossier ROMs lié (si autorisé)
      const manifest = await romStorage.readManifestFromLinkedDirectory();
      const meta = manifest?.[id];
      if (meta?.filename) {
        const dirBuffer = await romStorage.readFileFromLinkedDirectory(meta.filename);
        if (dirBuffer && isValidRomBuffer(dirBuffer, meta.filename)) {
          return {
            ...meta,
            data: dirBuffer,
            size: dirBuffer.byteLength,
          };
        }
      }
      return null;
    }
    const isLegacyArcadeCache =
      (record.core === 'mame2003_plus' ||
        record.core === 'fbneo' ||
        String(id || '').startsWith('arc-')) &&
      (record.cacheVersion || 0) < ROM_CACHE_VERSION;
    if (isLegacyArcadeCache || !isValidRomBuffer(record.data, record.filename)) {
      try {
        const delTx = db.transaction(PLATFORM_IDB_STORE, 'readwrite');
        delTx.objectStore(PLATFORM_IDB_STORE).delete(id);
      } catch {
        /* ignore cleanup error */
      }
      return null;
    }
    return record;
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
        players: meta.players || null,
        supportsMultiplayer: typeof meta.supportsMultiplayer === 'boolean' ? meta.supportsMultiplayer : null,
        size: buffer.byteLength,
        data: buffer,
        cacheVersion: ROM_CACHE_VERSION,
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
              players: r.players || null,
              supportsMultiplayer: typeof r.supportsMultiplayer === 'boolean' ? r.supportsMultiplayer : null,
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

/**
 * Transfère toutes les ROMs en cache (IndexedDB plateforme + Arcade) vers le dossier local lié,
 * puis vide les caches IndexedDB pour libérer l'espace du navigateur.
 */
export async function transferAllCacheToDirectory() {
  let dirInfo = await romStorage.getSavedDirectoryInfo();
  if (!dirInfo.supported) {
    throw new Error('Votre navigateur ne supporte pas le transfert direct vers un dossier.');
  }
  if (!dirInfo.configured) {
    throw new Error('Veuillez d’abord sélectionner un dossier ROMs.');
  }
  if (dirInfo.permission !== 'granted') {
    const auth = await romStorage.reauthorizeDirectory();
    if (!auth.granted) {
      throw new Error('Permission d’écriture refusée sur le dossier sélectionné.');
    }
  }

  const manifest = await romStorage.readManifestFromLinkedDirectory();
  const platformRows = await listCachedRoms();
  const arcadeKeys = await romStorage.listSavedRoms();

  let transferred = 0;
  let failed = 0;
  let totalBytes = 0;

  // 1. Transfert des ROMs multi-plateformes (csw_platform_roms_db)
  for (const row of platformRows) {
    const record = await getCachedRom(row.id);
    if (!record?.data) {
      failed += 1;
      continue;
    }
    const safeName = String(record.filename || `${row.id}.bin`)
      .split(/[/\\]/)
      .pop()
      .trim();
    const ok = await romStorage.writeFileToLinkedDirectory(safeName, record.data);
    if (ok) {
      manifest[row.id] = {
        id: row.id,
        title: record.title || row.id,
        filename: safeName,
        mode: record.mode || 'retro',
        platform: record.platform || 'retro',
        core: record.core || 'nes',
        players: record.players || null,
        supportsMultiplayer: typeof record.supportsMultiplayer === 'boolean' ? record.supportsMultiplayer : null,
      };
      transferred += 1;
      totalBytes += record.data.byteLength || 0;
      await removeCachedRom(row.id);
    } else {
      failed += 1;
    }
  }

  // 2. Transfert des archives Arcade/NeoGeo (csw_arcade_roms_db)
  for (const key of arcadeKeys) {
    const buf = await romStorage.getRom(key);
    if (!buf) continue;
    const ok = await romStorage.writeFileToLinkedDirectory(key, buf);
    if (ok) {
      transferred += 1;
      totalBytes += buf.byteLength || 0;
      await romStorage.deleteRom(key);
    } else {
      failed += 1;
    }
  }

  await romStorage.writeManifestToLinkedDirectory(manifest);
  return { transferred, failed, totalBytes };
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

export async function padNeoRAGExZipFile(file, padSpec, targetFilename) {
  if (!padSpec || !file) return file;
  const JSZipLib = await ensureJSZip();
  const zip = await JSZipLib.loadAsync(file);
  for (const [entryName, targetSize] of Object.entries(padSpec)) {
    const zEntry = zip.file(entryName);
    if (!zEntry) continue;
    const bytes = await zEntry.async('uint8array');
    if (bytes.byteLength < targetSize) {
      const padded = new Uint8Array(targetSize);
      padded.fill(0xff);
      padded.set(bytes, 0);
      zip.file(entryName, padded);
    }
  }
  const outBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return new File([outBlob], targetFilename || file.name, { type: 'application/octet-stream' });
}

async function fetchJsonWithTimeout(url, timeoutMs = 4500) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(new Error('Timeout Archive.org')), timeoutMs) : null;
  try {
    const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
    if (!res.ok) throw new Error(`Archive.org HTTP ${res.status}`);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function searchOnlineRoms(query, { system = 'nes', limit = 12 } = {}) {
  const hint = SYSTEM_SEARCH_HINTS[system] || { keywords: system, extensions: ['.zip'] };
  const cleanQ = String(query || '').trim();
  if (!cleanQ) return [];

  const q = `(${cleanQ}) AND (${hint.keywords}) AND mediatype:(software OR data)`;
  const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier,title,downloads&sort[]=downloads+desc&rows=8&output=json`;
  const data = await fetchJsonWithTimeout(searchUrl, 5500);
  const docs = (data?.response?.docs || []).slice(0, 4);

  const metaSettled = await Promise.allSettled(
    docs.map(async (doc) => {
      const meta = await fetchJsonWithTimeout(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}/files`, 4500);
      return { doc, meta };
    })
  );

  const results = [];
  for (const item of metaSettled) {
    if (item.status !== 'fulfilled') continue;
    const { doc, meta } = item.value;
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
  }
  return results;
}

export async function downloadAndCacheRom(entry, { mode = 'retro', core = 'nes', extractExtensions = [], onProgress } = {}) {
  const entryId = entry?.id || entry?.gameId || '';
  const cached = (entryId && (await getCachedRom(entryId))) || null;
  if (cached?.data && isValidRomBuffer(cached.data)) {
    verifiedRomIds.add(entryId);
    return new File([cached.data], cached.filename || entry.filename || `${entryId}.zip`, {
      type: 'application/octet-stream',
    });
  }

  let urls = Array.isArray(entry.urls) ? entry.urls.filter(Boolean) : [];
  if (urls.length === 0) {
    const staticCatalog = [...PLAYSTATION_CATALOG, ...SEGA_CATALOG, ...NINTENDO_CATALOG];
    const lowerTitle = String(entry?.title || '').trim().toLowerCase();
    const matchedStatic = staticCatalog.find(
      (item) =>
        item.id === entryId ||
        (lowerTitle && String(item.title || '').trim().toLowerCase() === lowerTitle)
    );
    if (matchedStatic && Array.isArray(matchedStatic.urls) && matchedStatic.urls.length > 0) {
      urls = [...matchedStatic.urls];
    }
  }

  if (urls.length === 0 && (entry.filename || entryId)) {
    const rawKey = String(entry.filename || entryId)
      .replace(/\.(zip|bin|rom)$/i, '')
      .replace(/^arc-(neo|mame)-/i, '')
      .toLowerCase();
    const mappedKey = fbneoMapping[rawKey] || rawKey;
    const cleanFn = `${mappedKey}.zip`;
    const encoded = encodeURIComponent(cleanFn);
    const isMame =
      /^arc-mame-/i.test(entryId) ||
      String(entry.core || core || '').toLowerCase().includes('mame');

    if (isMame) {
      const mameRef = `https://archive.org/download/MAME_2003-Plus_Reference/roms/${encoded}`;
      const mamePar = `https://archive.org/download/mame2003-parent/mame%202003%20plus%20parent/parents/${encoded}`;
      urls = [
        `https://archive.org/cors/MAME_2003-Plus_Reference/roms/${encoded}`,
        `/api/rom-proxy?url=${encodeURIComponent(mameRef)}`,
        `https://archive.org/cors/mame2003-parent/mame%202003%20plus%20parent/parents/${encoded}`,
        `/api/rom-proxy?url=${encodeURIComponent(mamePar)}`,
        `/api/rom-proxy?file=${encoded}`,
      ];
    } else {
      const neoDl = `https://archive.org/download/neo-geo-mvs-romset/${encoded}`;
      const mameRef = `https://archive.org/download/MAME_2003-Plus_Reference/roms/${encoded}`;
      urls = [
        `https://archive.org/cors/neo-geo-mvs-romset/${encoded}`,
        `/api/rom-proxy?url=${encodeURIComponent(neoDl)}`,
        `https://archive.org/cors/MAME_2003-Plus_Reference/roms/${encoded}`,
        `/api/rom-proxy?url=${encodeURIComponent(mameRef)}`,
        `/api/rom-proxy?file=${encoded}`,
      ];
    }
  }

  // Toujours préférer /cors/ puis /api/rom-proxy?url=... (évite les blocages CORS 302 sur archive.org/download/ dans le navigateur)
  const expandedUrls = [];
  const seenUrls = new Set();
  for (const u of urls) {
    if (!u || seenUrls.has(u)) continue;
    if (/^https?:\/\/archive\.org\/download\//i.test(u)) {
      const cors = u.replace(/^https?:\/\/archive\.org\/download\//i, 'https://archive.org/cors/');
      if (!seenUrls.has(cors)) {
        seenUrls.add(cors);
        expandedUrls.push(cors);
      }
      const proxied = `/api/rom-proxy?url=${encodeURIComponent(u)}`;
      if (!seenUrls.has(proxied)) {
        seenUrls.add(proxied);
        expandedUrls.push(proxied);
      }
      continue;
    }
    seenUrls.add(u);
    expandedUrls.push(u);
  }
  urls = expandedUrls;

  if (urls.length === 0) {
    markRomAsDead(entryId);
    const err = new Error('ROM indisponible (aucune source)');
    err.isDeadRom = true;
    throw err;
  }

  let buffer = null;
  let lastErr = null;

  for (const url of urls) {
    const headerCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const isLocalProxy = url.startsWith('/') || url.includes('/api/rom-proxy');
    const headerTimer = headerCtrl
      ? setTimeout(() => headerCtrl.abort(new Error('Délai réseau dépassé')), isLocalProxy ? 90000 : 30000)
      : null;
    try {
      const res = await fetch(url, headerCtrl ? { signal: headerCtrl.signal } : undefined);
      if (headerTimer) clearTimeout(headerTimer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('text/html')) throw new Error('HTML 404 response');
      const total = Number(res.headers.get('content-length') || 0);
      let candidateBuf = null;
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
        candidateBuf = merged.buffer;
      } else {
        candidateBuf = await res.arrayBuffer();
      }
      if (isValidRomBuffer(candidateBuf, entry.filename)) {
        buffer = candidateBuf;
        break;
      }
      throw new Error('Fichier ROM invalide ou corrompu');
    } catch (err) {
      if (headerTimer) clearTimeout(headerTimer);
      lastErr = err;
    }
  }

  if (!buffer) {
    markRomAsDead(entryId);
    const err = lastErr || new Error('Impossible de télécharger cette ROM depuis Archive.org');
    err.isDeadRom = true;
    throw err;
  }

  verifiedRomIds.add(entryId);

  let finalFilename = entry.filename || `${entryId || 'game'}.zip`;
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

  if (entryId) {
    await saveCachedRom(entryId, finalBuffer, {
      title: entry.title,
      filename: finalFilename,
      mode,
      platform: entry.platform || core,
      core,
      players: entry.players || null,
      supportsMultiplayer: typeof entry.supportsMultiplayer === 'boolean' ? entry.supportsMultiplayer : null,
    });
  }

  return new File([finalBuffer], finalFilename, { type: 'application/octet-stream' });
}
