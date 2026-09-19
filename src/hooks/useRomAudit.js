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
      let biosFound = false;

      if (window.electronAPI && typeof window.electronAPI.listAvailableRoms === 'function') {
        const res = await window.electronAPI.listAvailableRoms();
        if (res.success && Array.isArray(res.files)) {
          files = res.files;
        }
      } else {
        // 1. Essayer le manifeste statique (Netlify / Web CDN)
        try {
          const manifestRes = await fetch('/roms-manifest.json');
          if (manifestRes.ok) {
            const mData = await manifestRes.json();
            if (mData.success && Array.isArray(mData.files)) {
              files = mData.files;
            }
          }
        } catch (mErr) {}

        // 2. Si non trouvé ou vide, essayer l'API dev Vite
        if (files.length === 0) {
          try {
            const res = await fetch('/api/roms-list');
            if (res.ok) {
              const data = await res.json();
              if (data.success && Array.isArray(data.files)) {
                files = data.files;
              }
            }
          } catch (apiErr) {}
        }
      }

      const fileSet = new Set(files.map(f => f.toLowerCase()));

      // 3. Vérification directe du BIOS /roms/neogeo.zip (présent dans public/roms sur Netlify)
      if (fileSet.has('neogeo.zip')) {
        biosFound = true;
      } else {
        try {
          const headRes = await fetch('/roms/neogeo.zip', { method: 'HEAD' });
          if (headRes.ok) {
            biosFound = true;
            fileSet.add('neogeo.zip');
          }
        } catch (hErr) {}
      }

      setAvailableRoms(fileSet);
      setIsBiosReady(biosFound || fileSet.has('neogeo.zip'));
    } catch (err) {
      console.error('[useRomAudit] Exception:', err);
      setError(err.message);
      // En cas d'erreur de parsing d'API sur le web, vérifier le BIOS en secours
      try {
        const headFallback = await fetch('/roms/neogeo.zip', { method: 'HEAD' });
        if (headFallback.ok) {
          setIsBiosReady(true);
        }
      } catch (e) {}
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

