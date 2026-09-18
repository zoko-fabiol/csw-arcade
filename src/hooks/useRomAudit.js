import { useState, useEffect, useCallback } from 'react';
import fbneoMapping from '../data/fbneoMapping.json';

/**
 * Hook d'audit local des ROMs et du BIOS NeoGeo
 * Compatible Electron & Navigateur Web standard via /api/roms-list
 */
export function useRomAudit() {
  const [availableRoms, setAvailableRoms] = useState(new Set());
  const [isBiosReady, setIsBiosReady] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const refreshAudit = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      let files = [];
      if (window.electronAPI && typeof window.electronAPI.listAvailableRoms === 'function') {
        const res = await window.electronAPI.listAvailableRoms();
        if (res.success && Array.isArray(res.files)) {
          files = res.files;
        }
      } else {
        const res = await fetch('/api/roms-list').then(r => r.json());
        if (res.success && Array.isArray(res.files)) {
          files = res.files;
        }
      }

      const fileSet = new Set(files.map(f => f.toLowerCase()));
      setAvailableRoms(fileSet);

      // Le BIOS est prêt s'il est présent dans public/roms/neogeo.zip
      setIsBiosReady(fileSet.has('neogeo.zip'));
    } catch (err) {
      console.error('[useRomAudit] Exception:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAudit();

    // Écoute des événements de téléchargement interne terminé
    const handleRomDownloaded = () => {
      console.log('[useRomAudit] ROM téléchargée détectée, actualisation de l\'audit...');
      refreshAudit();
    };

    window.addEventListener('rom-downloaded', handleRomDownloaded);
    const handleMsg = (event) => {
      if (event.data?.type === 'ROM_DOWNLOADED' || event.data?.type === 'EJS_GAME_STARTED') {
        handleRomDownloaded();
      }
    };
    window.addEventListener('message', handleMsg);

    return () => {
      window.removeEventListener('rom-downloaded', handleRomDownloaded);
      window.removeEventListener('message', handleMsg);
    };
  }, [refreshAudit]);

  const isRomAvailable = useCallback(
    (filename) => {
      if (!filename) return false;
      const clean = filename.replace(/\.(zip|rom|bin|dat)$/i, '').toLowerCase();
      const mapped = (fbneoMapping[clean] || clean).toLowerCase();

      return availableRoms.has(filename.toLowerCase()) ||
             availableRoms.has(clean + '.zip') ||
             availableRoms.has(mapped + '.zip');
    },
    [availableRoms]
  );

  return {
    availableRoms,
    isBiosReady,
    isLoading,
    error,
    refreshAudit,
    isRomAvailable
  };
}

