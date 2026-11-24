/**
 * Service de stockage persistant des ROMs et du BIOS pour CSW-Arcade Web & PWA
 * Utilise IndexedDB pour conserver les jeux téléchargés ou importés sur le terminal de l'utilisateur.
 */

const DB_NAME = 'csw_arcade_roms_db';
const DB_VERSION = 1;
const STORE_NAME = 'rom_archives';

const FS_DB_NAME = 'csw_arcade_fs_handles_db';
const FS_STORE_NAME = 'handles';
const FS_DIR_KEY = 'roms_dir';
const ROM_FILE_REGEX = /\.(zip|7z|nes|sfc|smc|gba|gb|gbc|n64|z64|v64|md|gen|bin|sms|gg|pce|nds|iso|pbp|chd|jar)$/i;
let memoryDirHandle = null;

function openFsDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB non supporté sur ce navigateur'));
    }
    const req = window.indexedDB.open(FS_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(FS_STORE_NAME)) {
        db.createObjectStore(FS_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getStoredDirHandle() {
  if (memoryDirHandle) return memoryDirHandle;
  try {
    const db = await openFsDatabase();
    return await new Promise((resolve) => {
      const tx = db.transaction(FS_STORE_NAME, 'readonly');
      const req = tx.objectStore(FS_STORE_NAME).get(FS_DIR_KEY);
      req.onsuccess = () => {
        memoryDirHandle = req.result || null;
        resolve(memoryDirHandle);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function setStoredDirHandle(handle) {
  memoryDirHandle = handle || null;
  const db = await openFsDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FS_STORE_NAME, 'readwrite');
    const req = handle
      ? tx.objectStore(FS_STORE_NAME).put(handle, FS_DIR_KEY)
      : tx.objectStore(FS_STORE_NAME).delete(FS_DIR_KEY);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function writeBufferToDir(dirHandle, filename, arrayBuffer) {
  if (!dirHandle || !filename || !arrayBuffer) return false;
  try {
    const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return false;
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(arrayBuffer);
    await writable.close();
    return true;
  } catch (e) {
    console.warn('[romStorage] Écriture dossier local impossible:', e.message);
    return false;
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB non supporté sur ce navigateur'));
    }

    const req = window.indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const romStorage = {
  /**
   * Sauvegarde une ROM ou le BIOS dans IndexedDB
   * @param {string} filename - ex: 'aodk.zip' ou 'neogeo.zip'
   * @param {ArrayBuffer|Uint8Array} buffer 
   */
  async saveRom(filename, buffer) {
    if (!filename || !buffer) return false;
    const cleanKey = filename.toLowerCase().trim();
    const arrayBuffer = buffer.buffer ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : buffer;

    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record = {
        id: cleanKey,
        filename: cleanKey,
        data: arrayBuffer,
        size: arrayBuffer.byteLength,
        savedAt: Date.now()
      };

      const req = store.put(record);
      req.onsuccess = async () => {
        console.log(`[romStorage] ROM ${cleanKey} sauvegardée avec succès (${record.size} octets)`);
        const dirHandle = await getStoredDirHandle();
        if (dirHandle) {
          await writeBufferToDir(dirHandle, cleanKey, arrayBuffer);
        }
        window.dispatchEvent(new CustomEvent('rom-downloaded', { detail: { filename: cleanKey } }));
        resolve(true);
      };
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Récupère une ROM stockée par son nom
   * @param {string} filename 
   * @returns {Promise<ArrayBuffer|null>}
   */
  async getRom(filename) {
    if (!filename) return null;
    const cleanKey = filename.toLowerCase().trim();

    try {
      const db = await openDatabase();
      const idbData = await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(cleanKey);

        req.onsuccess = () => {
          if (req.result && req.result.data) {
            resolve(req.result.data);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
      if (idbData) return idbData;
    } catch (e) {
      console.warn('[romStorage] Erreur lecture IndexedDB:', e.message);
    }

    return await this.readFileFromLinkedDirectory(cleanKey);
  },

  /**
   * Vérifie si une ROM existe dans le stockage local
   * @param {string} filename 
   */
  async hasRom(filename) {
    const data = await this.getRom(filename);
    return data !== null;
  },

  /**
   * Liste l'ensemble des ROMs sauvegardées localement
   * @returns {Promise<string[]>} liste des noms de fichiers (ex: ['aodk.zip', 'neogeo.zip'])
   */
  async listSavedRoms() {
    const keys = new Set();
    try {
      const db = await openDatabase();
      const idbKeys = await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAllKeys();

        req.onsuccess = () => {
          resolve((req.result || []).map(k => String(k).toLowerCase()));
        };
        req.onerror = () => resolve([]);
      });
      idbKeys.forEach((k) => keys.add(k));
    } catch (e) {
      // noop
    }

    try {
      const handle = await getStoredDirHandle();
      if (handle) {
        const perm = await handle.queryPermission({ mode: 'read' });
        if (perm === 'granted') {
          for await (const [entryName, entryHandle] of handle.entries()) {
            if (entryHandle.kind === 'file' && ROM_FILE_REGEX.test(entryName)) {
              keys.add(entryName.toLowerCase().trim());
            }
          }
        }
      }
    } catch (e) {
      // noop
    }

    return Array.from(keys);
  },

  /**
   * Supprime une ROM du stockage local
   * @param {string} filename 
   */
  async deleteRom(filename) {
    if (!filename) return false;
    const cleanKey = filename.toLowerCase().trim();
    try {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(cleanKey);
        req.onsuccess = () => {
          window.dispatchEvent(new CustomEvent('rom-downloaded', { detail: { filename: cleanKey } }));
          resolve(true);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      return false;
    }
  },

  /**
   * Calcule l'espace total occupé par les ROMs locales en Mo
   */
  async getStorageStats() {
    try {
      const db = await openDatabase();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();

        req.onsuccess = () => {
          const items = req.result || [];
          const totalBytes = items.reduce((acc, cur) => acc + (cur.size || 0), 0);
          resolve({
            count: items.length,
            totalBytes,
            totalMB: (totalBytes / (1024 * 1024)).toFixed(1),
            items: items.map(i => ({ filename: i.filename, sizeMB: ((i.size || 0) / (1024 * 1024)).toFixed(1) }))
          });
        };
        req.onerror = () => resolve({ count: 0, totalBytes: 0, totalMB: '0.0', items: [] });
      });
    } catch (e) {
      return { count: 0, totalBytes: 0, totalMB: '0.0', items: [] };
    }
  },

  /**
   * Indique si le navigateur supporte la sélection persistante d'un dossier local (Chrome/Edge/Brave Desktop)
   */
  isDirectoryPickerSupported() {
    return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  },

  /**
   * Retourne l'état du dossier ROMs lié (nom + permission)
   */
  async getSavedDirectoryInfo() {
    const supported = this.isDirectoryPickerSupported();
    if (!supported) {
      return { supported: false, configured: false, name: null, permission: 'unsupported' };
    }
    const handle = await getStoredDirHandle();
    if (!handle) {
      return { supported: true, configured: false, name: null, permission: 'none' };
    }
    try {
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      return {
        supported: true,
        configured: true,
        name: handle.name || 'Dossier ROMs',
        permission: perm || 'prompt',
      };
    } catch {
      return {
        supported: true,
        configured: true,
        name: handle.name || 'Dossier ROMs',
        permission: 'prompt',
      };
    }
  },

  /**
   * Ouvre le sélecteur de dossier système, mémorise le handle et synchronise les ROMs
   */
  async pickRomsDirectory() {
    if (!this.isDirectoryPickerSupported()) {
      throw new Error('Votre navigateur ne supporte pas le dossier direct. Utilisez l’import de fichiers.');
    }
    const handle = await window.showDirectoryPicker({
      id: 'csw-arcade-roms-dir',
      mode: 'readwrite',
    });
    await setStoredDirHandle(handle);
    const syncStats = await this.syncWithDirectory(handle);
    return {
      name: handle.name || 'Dossier ROMs',
      ...syncStats,
    };
  },

  /**
   * Redemande la permission d'accès au dossier mémorisé (utile après redémarrage du navigateur)
   */
  async reauthorizeDirectory(mode = 'readwrite') {
    const handle = memoryDirHandle || (await getStoredDirHandle());
    if (!handle) return { granted: false, reason: 'no-handle', imported: 0, exported: 0 };
    try {
      let perm = await handle.queryPermission({ mode });
      if (perm !== 'granted') {
        perm = await handle.requestPermission({ mode });
      }
      if (perm !== 'granted') {
        return { granted: false, reason: `perm-${perm}`, imported: 0, exported: 0 };
      }
      if (mode === 'readwrite') {
        const syncStats = await this.syncWithDirectory(handle);
        return { granted: true, name: handle.name, ...syncStats };
      }
      return { granted: true, name: handle.name, imported: 0, exported: 0 };
    } catch (e) {
      console.error('[romStorage] reauthorizeDirectory error:', e);
      return { granted: false, reason: e?.message || 'error', imported: 0, exported: 0 };
    }
  },

  /**
   * Dissocie le dossier ROMs local (sans supprimer les fichiers du disque)
   */
  async clearDirectory() {
    await setStoredDirHandle(null);
    return true;
  },

  /**
   * Écrit un fichier arbitraire dans le dossier lié (si autorisé)
   */
  async writeFileToLinkedDirectory(filename, buffer) {
    const handle = await getStoredDirHandle();
    if (!handle || !filename || !buffer) return false;
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return false;
    const arrayBuffer = buffer.buffer
      ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      : buffer;
    return writeBufferToDir(handle, filename, arrayBuffer);
  },

  /**
   * Lit un fichier depuis le dossier lié (si autorisé)
   */
  async readFileFromLinkedDirectory(filename) {
    const handle = await getStoredDirHandle();
    if (!handle || !filename) return null;
    try {
      const perm = await handle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') return null;
      const fileHandle = await handle.getFileHandle(filename);
      const file = await fileHandle.getFile();
      return await file.arrayBuffer();
    } catch {
      return null;
    }
  },

  /**
   * Lit le manifeste .csw-arcade-manifest.json du dossier lié
   */
  async readManifestFromLinkedDirectory() {
    const buf = await this.readFileFromLinkedDirectory('.csw-arcade-manifest.json');
    if (!buf) return {};
    try {
      const text = new TextDecoder().decode(buf);
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  },

  /**
   * Enregistre le manifeste .csw-arcade-manifest.json dans le dossier lié
   */
  async writeManifestToLinkedDirectory(manifest) {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(manifest || {}, null, 2));
      return await this.writeFileToLinkedDirectory('.csw-arcade-manifest.json', bytes);
    } catch {
      return false;
    }
  },

  /**
   * Vide toutes les ROMs du cache IndexedDB csw_arcade_roms_db
   */
  async clearAllIdbRoms() {
    const keys = await this.listSavedRoms();
    for (const key of keys) {
      await this.deleteRom(key);
    }
    return keys.length;
  },

  /**
   * Synchronisation bidirectionnelle entre le dossier local choisi et IndexedDB :
   * - Importe dans IndexedDB les ROMs du dossier qui n'y sont pas encore
   * - Exporte vers le dossier les ROMs déjà en cache IndexedDB qui manquent dans le dossier
   */
  async syncWithDirectory(explicitHandle = null, silent = false) {
    const handle = explicitHandle || (await getStoredDirHandle());
    if (!handle) return { imported: 0, exported: 0 };

    const readPerm = await handle.queryPermission({ mode: 'read' });
    if (readPerm !== 'granted') return { imported: 0, exported: 0 };
    const writePerm = await handle.queryPermission({ mode: 'readwrite' });

    const existingIdb = new Set(await this.listSavedRoms());
    const existingDir = new Set();
    let imported = 0;
    let exported = 0;

    for await (const [entryName, entryHandle] of handle.entries()) {
      if (entryHandle.kind !== 'file') continue;
      if (!ROM_FILE_REGEX.test(entryName)) continue;
      const cleanKey = entryName.toLowerCase().trim();
      existingDir.add(cleanKey);

      if (!existingIdb.has(cleanKey)) {
        try {
          const file = await entryHandle.getFile();
          if (file.size >= 256) {
            const buffer = await file.arrayBuffer();
            await this.saveRom(cleanKey, buffer);
            existingIdb.add(cleanKey);
            imported += 1;
          }
        } catch (e) {
          console.warn(`[romStorage] Échec lecture ${entryName}:`, e.message);
        }
      }
    }

    for (const idbKey of existingIdb) {
      if (!existingDir.has(idbKey)) {
        try {
          const buffer = await this.getRom(idbKey);
          if (buffer && (await writeBufferToDir(handle, idbKey, buffer))) {
            exported += 1;
          }
        } catch (e) {
          console.warn(`[romStorage] Échec export ${idbKey}:`, e.message);
        }
      }
    }

    if (imported > 0 && !silent) {
      window.dispatchEvent(new CustomEvent('rom-downloaded', { detail: { filename: 'sync' } }));
    }
    return { imported, exported };
  },

  /**
   * Importe un lot de fichiers ou un dossier complet (Android, iOS, Safari, Firefox, ou changement de navigateur)
   * @param {FileList|File[]} fileList
   */
  async importFilesToStorage(fileList) {
    const files = Array.from(fileList || []).filter((f) => ROM_FILE_REGEX.test(f.name));
    let imported = 0;
    let totalBytes = 0;

    for (const file of files) {
      try {
        if (file.size < 256) continue;
        const buffer = await file.arrayBuffer();
        await this.saveRom(file.name, buffer);
        imported += 1;
        totalBytes += file.size;
      } catch (e) {
        console.warn(`[romStorage] Échec import ${file.name}:`, e.message);
      }
    }

    return { imported, totalBytes };
  },

  /**
   * Exporte toutes les ROMs stockées dans IndexedDB sous forme de téléchargements navigateur
   * (utile sur Android/iOS/Safari pour les ranger dans un dossier Fichiers / iCloud Drive)
   */
  async exportAllSavedRoms() {
    const keys = await this.listSavedRoms();
    let exported = 0;
    for (const key of keys) {
      const buffer = await this.getRom(key);
      if (!buffer) continue;
      const blob = new Blob([buffer], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = key;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      exported += 1;
      await new Promise((r) => setTimeout(r, 250));
    }
    return exported;
  }
};
