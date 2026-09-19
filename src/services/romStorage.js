/**
 * Service de stockage persistant des ROMs et du BIOS pour CSW-Arcade Web & PWA
 * Utilise IndexedDB pour conserver les jeux téléchargés ou importés sur le terminal de l'utilisateur.
 */

const DB_NAME = 'csw_arcade_roms_db';
const DB_VERSION = 1;
const STORE_NAME = 'rom_archives';

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
      req.onsuccess = () => {
        console.log(`[romStorage] ROM ${cleanKey} sauvegardée avec succès (${record.size} octets)`);
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
      return new Promise((resolve) => {
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
    } catch (e) {
      console.warn('[romStorage] Erreur lecture IndexedDB:', e.message);
      return null;
    }
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
    try {
      const db = await openDatabase();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAllKeys();

        req.onsuccess = () => {
          resolve((req.result || []).map(k => String(k).toLowerCase()));
        };
        req.onerror = () => resolve([]);
      });
    } catch (e) {
      return [];
    }
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
  }
};
