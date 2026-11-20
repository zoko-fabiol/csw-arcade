/**
 * Service de sauvegarde persistante des parties par jeu (IndexedDB + synchro Cloud compte).
 * Supporte jusqu'à 3 emplacements (Slots 1, 2, 3) par jeu et par compte, même pour les gros savestates N64 / PS1 (16-32 Mo).
 */

const DB_NAME = 'csw_game_saves_v1';
const DB_VERSION = 1;
const STORE_NAME = 'saves';

function openSaveDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponible'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('byGame', 'gameKey', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erreur IndexedDB'));
  });
}

function makeSaveKey(uid, gameId, slot) {
  return `${uid || 'guest'}::${gameId || 'game'}::slot_${slot}`;
}

function makeGameKey(uid, gameId) {
  return `${uid || 'guest'}::${gameId || 'game'}`;
}

export async function saveGameSlot(uid, gameId, slot = 1, stateBase64, meta = {}) {
  if (!gameId || !stateBase64) return null;
  const db = await openSaveDb();
  const record = {
    key: makeSaveKey(uid, gameId, slot),
    gameKey: makeGameKey(uid, gameId),
    uid: uid || 'guest',
    gameId,
    slot,
    title: meta.title || gameId,
    core: meta.core || 'emu',
    screenshotDataUrl: meta.screenshotDataUrl || null,
    stateBase64,
    sizeBytes: Math.floor((stateBase64.length * 3) / 4),
    savedAtMs: Date.now(),
  };

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return {
    slot: record.slot,
    savedAtMs: record.savedAtMs,
    sizeBytes: record.sizeBytes,
    screenshotDataUrl: record.screenshotDataUrl,
  };
}

export async function deleteGameSlot(uid, gameId, slot) {
  if (!gameId) return;
  const db = await openSaveDb();
  const key = makeSaveKey(uid, gameId, slot);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadGameSlot(uid, gameId, slot = 1) {
  if (!gameId) return null;
  const db = await openSaveDb();
  const key = makeSaveKey(uid, gameId, slot);
  const rec = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  return rec?.stateBase64 || null;
}

export async function listGameSlots(uid, gameId) {
  if (!gameId) return [];
  try {
    const db = await openSaveDb();
    const gameKey = makeGameKey(uid, gameId);
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const idx = tx.objectStore(STORE_NAME).index('byGame');
      const req = idx.getAll(gameKey);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    return rows
      .map((r) => ({
        slot: r.slot,
        savedAtMs: r.savedAtMs,
        sizeBytes: r.sizeBytes,
        screenshotDataUrl: r.screenshotDataUrl || null,
      }))
      .sort((a, b) => a.slot - b.slot);
  } catch {
    return [];
  }
}
