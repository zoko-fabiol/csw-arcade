/**
 * Service unifié de recherche en ligne, téléchargement automatique et cache IndexedDB des ROMs
 * (Inspiré du pipeline Arcade Neo Geo dans player.html, étendu aux Consoles Rétro & PlayStation).
 */

import { h, showToast } from '../components/ui.js';
import { formatBytes } from './storage.js';
import { ensureJSZip, getExtension } from './zip.js';

const PLATFORM_IDB_NAME = 'csw_platform_roms_db';
const PLATFORM_IDB_STORE = 'rom_files';

export const SYSTEM_SEARCH_HINTS = {
  mame2003_plus: { keywords: 'mame arcade', extensions: ['.zip'] },
  fbneo: { keywords: 'neogeo fbneo arcade', extensions: ['.zip'] },
  sega32x: { keywords: 'sega 32x', extensions: ['.32x', '.bin', '.zip'] },
  nes: { keywords: 'nes nintendo', extensions: ['.nes', '.zip'] },
  snes: { keywords: 'snes super nintendo', extensions: ['.sfc', '.smc', '.zip'] },
  gba: { keywords: 'gba game boy advance', extensions: ['.gba', '.zip'] },
  gb: { keywords: 'game boy', extensions: ['.gb', '.zip'] },
  gbc: { keywords: 'game boy color', extensions: ['.gbc', '.zip'] },
  n64: { keywords: 'nintendo 64 n64', extensions: ['.z64', '.n64', '.v64', '.zip'] },
  'parallel-n64': { keywords: 'nintendo 64 n64', extensions: ['.z64', '.n64', '.v64', '.zip'] },
  segaMD: { keywords: 'genesis mega drive sega', extensions: ['.md', '.gen', '.bin', '.zip'] },
  segaMS: { keywords: 'master system sega', extensions: ['.sms', '.zip'] },
  segaGG: { keywords: 'game gear sega', extensions: ['.gg', '.zip'] },
  pce: { keywords: 'pc engine turbografx', extensions: ['.pce', '.zip'] },
  nds: { keywords: 'nintendo ds nds', extensions: ['.nds', '.zip'] },
  psx: { keywords: 'playstation ps1 psx', extensions: ['.chd', '.pbp', '.bin', '.iso', '.zip'] },
  ps1: { keywords: 'playstation ps1 psx', extensions: ['.chd', '.pbp', '.bin', '.iso', '.zip'] },
  j2me: { keywords: 'j2me gameloft java', extensions: ['.jar', '.zip'] },
};

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
        const mapped = rows
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
          .sort((a, b) => b.cachedAt - a.cachedAt);
        resolve(mapped);
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
 * Construit les URLs candidates (direct CORS + proxy local/Hostinger + download fallback).
 */
export function buildArchiveCandidateUrls(identifier, filename) {
  const encodedFile = filename
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const downloadUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodedFile}`;
  return [
    `https://archive.org/cors/${encodeURIComponent(identifier)}/${encodedFile}`,
    `/api/rom-proxy?url=${encodeURIComponent(downloadUrl)}`,
    downloadUrl,
  ];
}

/**
 * Recherche des items sur Archive.org puis inspecte leurs fichiers ROM compatibles.
 */
export async function searchOnlineRoms(query, { system = 'all', limit = 10, signal } = {}) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return [];

  const hint = SYSTEM_SEARCH_HINTS[system];
  const systemPart = hint ? ` AND (${hint.keywords.split(' ').slice(0, 2).join(' OR ')})` : '';
  const q = `(${cleanQuery})${systemPart} AND mediatype:(software OR data)`;
  const searchUrl =
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}` +
    `&fl[]=identifier,title,downloads,item_size&sort[]=downloads+desc&rows=${Math.min(limit, 15)}&output=json`;

  const res = await fetch(searchUrl, { signal });
  if (!res.ok) throw new Error(`Recherche Archive.org HTTP ${res.status}`);
  const json = await res.json();
  const docs = json?.response?.docs || [];
  if (!docs.length) return [];

  const allowedExts = hint
    ? hint.extensions
    : [
        '.nes', '.sfc', '.smc', '.gba', '.gb', '.gbc',
        '.n64', '.z64', '.v64', '.md', '.gen', '.sms', '.gg', '.pce', '.nds',
        '.chd', '.pbp', '.bin', '.iso', '.zip',
      ];

  const results = [];
  const topDocs = docs.slice(0, 8);

  await Promise.all(
    topDocs.map(async (doc) => {
      try {
        const metaRes = await fetch(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}/files`, {
          signal,
        });
        if (!metaRes.ok) return;
        const metaJson = await metaRes.json();
        const files = Array.isArray(metaJson?.result) ? metaJson.result : [];

        const matchingFiles = files.filter((f) => {
          if (!f.name) return false;
          const lower = f.name.toLowerCase();
          if (lower.endsWith('_archive.torrent') || lower.includes('__macosx')) return false;
          const size = Number(f.size || 0);
          if (size > 0 && size < 1024) return false;
          // Éviter les packs complets de plusieurs Go si on cherche un jeu précis
          if (size > 1.8 * 1024 * 1024 * 1024) return false;
          return allowedExts.some((ext) => lower.endsWith(ext));
        });

        if (!matchingFiles.length) return;

        // Préférer le fichier dont le nom ressemble le plus à la requête (et éviter .bin si .chd/.pbp dispo)
        const queryTokens = cleanQuery.toLowerCase().split(/\s+/).filter(Boolean);
        matchingFiles.sort((a, b) => {
          const scoreFile = (f) => {
            const name = f.name.toLowerCase();
            let s = 0;
            for (const t of queryTokens) {
              if (name.includes(t)) s += 10;
            }
            if (name.endsWith('.chd') || name.endsWith('.pbp')) s += 5;
            if (!name.endsWith('.zip')) s += 2;
            return s;
          };
          return scoreFile(b) - scoreFile(a);
        });

        const best = matchingFiles[0];
        results.push({
          id: `ia-${doc.identifier}-${best.name}`.toLowerCase().replace(/[^a-z0-9_-]/g, '_'),
          identifier: doc.identifier,
          title: doc.title || best.name,
          filename: best.name.split('/').pop(),
          fullPath: best.name,
          size: Number(best.size || 0),
          downloads: Number(doc.downloads || 0),
          urls: buildArchiveCandidateUrls(doc.identifier, best.name),
          sourceLabel: 'Archive.org',
        });
      } catch {
        // Ignore les items inaccessibles
      }
    })
  );

  // Trier par pertinence du titre puis nombre de téléchargements
  const tokens = cleanQuery.toLowerCase().split(/\s+/).filter(Boolean);
  results.sort((a, b) => {
    const matchCount = (item) =>
      tokens.reduce((acc, t) => acc + (`${item.title} ${item.filename}`.toLowerCase().includes(t) ? 1 : 0), 0);
    const diff = matchCount(b) - matchCount(a);
    if (diff !== 0) return diff;
    return (b.downloads || 0) - (a.downloads || 0);
  });

  return results;
}

/**
 * Télécharge une ROM depuis une liste d'URLs candidates avec suivi de progression,
 * extraction ZIP optionnelle et sauvegarde automatique dans IndexedDB.
 */
export async function downloadAndCacheRom({
  id,
  title,
  filename,
  urls = [],
  mode = 'retro',
  platform = 'retro',
  core = 'nes',
  extractExtensions = null,
  onProgress,
  signal,
}) {
  // 1. Vérifier le cache IndexedDB
  onProgress?.({ status: 'Vérification du cache local (IndexedDB)…', loaded: 0, total: 0, percent: 5 });
  const cached = await getCachedRom(id);
  if (cached && cached.data) {
    onProgress?.({ status: 'ROM trouvée en cache local !', loaded: cached.size, total: cached.size, percent: 100 });
    return new File([cached.data], cached.filename || filename || `${id}.bin`, {
      type: 'application/octet-stream',
    });
  }

  // 2. Construire la liste des URLs candidates (inclut /roms/ local + proxy fallback)
  const candidates = [];
  if (filename) {
    candidates.push(`/roms/${encodeURIComponent(filename)}`);
  }
  for (const u of urls) {
    if (!u) continue;
    candidates.push(u);
    if (u.startsWith('http') && !u.includes('/api/rom-proxy')) {
      candidates.push(`/api/rom-proxy?url=${encodeURIComponent(u)}`);
    }
  }

  let downloadedBuffer = null;
  let finalFilename = filename || 'rom.bin';
  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i];
    if (signal?.aborted) throw new DOMException('Téléchargement annulé', 'AbortError');

    try {
      const hostLabel = url.startsWith('/') ? 'Serveur local' : new URL(url).hostname;
      onProgress?.({
        status: `Connexion à ${hostLabel} (${i + 1}/${candidates.length})…`,
        loaded: 0,
        total: 0,
        percent: 8,
      });

      const res = await fetch(url, { signal });
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('text/html')) {
        lastError = new Error('Réponse HTML reçue au lieu d’un binaire ROM');
        continue;
      }

      const contentLength = Number(res.headers.get('content-length') || 0);
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const chunks = [];
        let loaded = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.byteLength;
          const percent = contentLength > 0 ? Math.min(95, Math.round((loaded / contentLength) * 90) + 5) : 50;
          onProgress?.({
            status: `Téléchargement de ${title || finalFilename}…`,
            loaded,
            total: contentLength,
            percent,
          });
        }

        const merged = new Uint8Array(loaded);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.byteLength;
        }
        downloadedBuffer = merged.buffer;
      } else {
        downloadedBuffer = await res.arrayBuffer();
      }

      if (!downloadedBuffer || downloadedBuffer.byteLength < 1024) {
        downloadedBuffer = null;
        lastError = new Error('Fichier ROM vide ou trop petit');
        continue;
      }

      // Vérifier qu'il ne s'agit pas d'une page HTML d'erreur
      const headText = new TextDecoder().decode(new Uint8Array(downloadedBuffer, 0, Math.min(64, downloadedBuffer.byteLength)));
      if (/^\s*(<!doctype|<html)/i.test(headText)) {
        downloadedBuffer = null;
        lastError = new Error('Page HTML détectée au lieu de la ROM');
        continue;
      }

      // Déduire le nom de fichier si absent
      if (!filename && url.includes('/')) {
        const cleanPath = url.split('?')[0];
        const tail = decodeURIComponent(cleanPath.split('/').pop() || '');
        if (tail && tail.includes('.')) finalFilename = tail;
      }
      break;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastError = err;
    }
  }

  if (!downloadedBuffer) {
    throw lastError || new Error('Aucune source en ligne n’a pu fournir cette ROM.');
  }

  // 3. Extraction ZIP automatique si demandée et si c'est un ZIP mono-ROM
  if (getExtension(finalFilename) === 'zip' && Array.isArray(extractExtensions) && extractExtensions.length) {
    try {
      onProgress?.({ status: 'Extraction de l’archive ZIP…', loaded: downloadedBuffer.byteLength, total: downloadedBuffer.byteLength, percent: 96 });
      const JSZip = await ensureJSZip();
      const archive = await JSZip.loadAsync(downloadedBuffer);
      const candidatesZip = Object.values(archive.files).filter(
        (f) =>
          !f.dir &&
          !f.name.startsWith('__MACOSX/') &&
          extractExtensions.some((ext) => f.name.toLowerCase().endsWith(ext))
      );
      if (candidatesZip.length >= 1) {
        const picked = candidatesZip[0];
        if ((picked._data?.uncompressedSize || 0) <= 512 * 1024 * 1024) {
          downloadedBuffer = await picked.async('arraybuffer');
          finalFilename = picked.name.split('/').pop();
        }
      }
    } catch {
      // Si l'extraction échoue, on garde le .zip tel quel
    }
  }

  // 4. Sauvegarde persistante dans IndexedDB
  onProgress?.({
    status: 'Sauvegarde en cache IndexedDB…',
    loaded: downloadedBuffer.byteLength,
    total: downloadedBuffer.byteLength,
    percent: 98,
  });
  await saveCachedRom(id, downloadedBuffer, {
    title: title || finalFilename,
    filename: finalFilename,
    mode,
    platform,
    core,
  });

  onProgress?.({
    status: 'ROM prête, lancement de l’émulateur…',
    loaded: downloadedBuffer.byteLength,
    total: downloadedBuffer.byteLength,
    percent: 100,
  });

  return new File([downloadedBuffer], finalFilename, { type: 'application/octet-stream' });
}

/**
 * Affiche un modal de progression pour le téléchargement automatique de ROM.
 */
export function showDownloadOverlay({ title, subtitle = 'Préparation…' }) {
  const controller = new AbortController();
  const statusEl = h('p', { className: 'csw-dl-status' }, subtitle);
  const barFill = h('div', { className: 'csw-dl-bar-fill', style: 'width: 4%' });
  const statsEl = h('div', { className: 'csw-dl-stats' }, 'Initialisation…');

  const cancelBtn = h(
    'button',
    {
      type: 'button',
      className: 'csw-btn csw-btn--ghost',
      onClick: () => {
        controller.abort();
        close();
      },
    },
    'Annuler'
  );

  const backdrop = h(
    'div',
    { className: 'csw-dl-backdrop', role: 'dialog', 'aria-modal': 'true' },
    h(
      'div',
      { className: 'csw-dl-modal' },
      h('div', { className: 'csw-dl-head' }, h('span', { className: 'csw-dl-spinner' }), h('h3', {}, title)),
      statusEl,
      h('div', { className: 'csw-dl-bar-track' }, barFill),
      statsEl,
      h('div', { className: 'csw-dl-actions' }, cancelBtn)
    )
  );

  document.body.append(backdrop);

  function update({ status, loaded = 0, total = 0, percent = 0 }) {
    if (status) statusEl.textContent = status;
    barFill.style.width = `${Math.max(4, Math.min(100, percent))}%`;
    if (total > 0) {
      statsEl.textContent = `${formatBytes(loaded)} / ${formatBytes(total)} (${percent}%)`;
    } else if (loaded > 0) {
      statsEl.textContent = `${formatBytes(loaded)} téléchargés…`;
    } else {
      statsEl.textContent = `${percent}%`;
    }
  }

  function close() {
    backdrop.remove();
  }

  return { controller, update, close };
}

/**
 * Recherche en ligne (si besoin), télécharge, met en cache et lance un jeu automatiquement.
 */
export async function autoSearchDownloadAndLaunch({
  id,
  title,
  searchQuery,
  system,
  core,
  mode,
  filename,
  urls = [],
  extractExtensions = null,
  onLaunch,
  onAfterCache,
}) {
  const overlay = showDownloadOverlay({
    title: `Téléchargement : ${title}`,
    subtitle: 'Vérification du cache local…',
  });

  try {
    let targetUrls = [...urls];
    let targetFilename = filename;

    // 1. Vérifier si déjà en cache avant toute requête réseau
    const cached = await getCachedRom(id);
    if (!cached && !targetUrls.length) {
      overlay.update({ status: `Recherche en ligne de « ${searchQuery || title} »…`, percent: 10 });
      const found = await searchOnlineRoms(searchQuery || title, {
        system: system || core,
        limit: 8,
        signal: overlay.controller.signal,
      });
      if (!found.length) {
        throw new Error(`Aucune ROM trouvée en ligne pour « ${title} ». Vous pouvez importer votre propre fichier local.`);
      }
      targetUrls = found[0].urls;
      targetFilename = targetFilename || found[0].filename;
    }

    const file = await downloadAndCacheRom({
      id,
      title,
      filename: targetFilename,
      urls: targetUrls,
      mode,
      platform: system || core,
      core,
      extractExtensions,
      onProgress: overlay.update,
      signal: overlay.controller.signal,
    });

    overlay.close();
    onAfterCache?.(file);
    onLaunch(file);
  } catch (err) {
    overlay.close();
    if (err.name === 'AbortError') {
      showToast('Téléchargement annulé.', 'info');
      return;
    }
    showToast(err.message || 'Échec du téléchargement automatique.', 'error');
  }
}
