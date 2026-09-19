import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

import gamesData from './data/games.json';

// Polyfill de compatibilité uniquement en environnement de développement local (Vite dev)
if (!window.electronAPI && import.meta.env.DEV) {
  console.log('[CSW-Arcade] Environnement DEV détecté : activation du polyfill client local');
  window.electronAPI = {
    readRom: async (filename) => {
      try {
        const res = await fetch(`/api/rom?file=${encodeURIComponent(filename)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/html')) throw new Error('SPA redirect HTML');
        const data = await res.arrayBuffer();
        const u8 = new Uint8Array(data);
        if (u8.length < 5000 || u8[0] !== 0x50 || u8[1] !== 0x4B) throw new Error('Fichier non-ZIP');
        return { success: true, data };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
    checkRomExists: async (filename) => {
      try {
        const res = await fetch(`/api/rom?file=${encodeURIComponent(filename)}`, { method: 'HEAD' });
        return { success: true, exists: res.ok };
      } catch {
        return { success: true, exists: false };
      }
    },
    listAvailableRoms: async () => {
      try {
        const res = await fetch('/api/roms-list');
        return await res.json();
      } catch (err) {
        return { success: false, error: err.message, files: [] };
      }
    },
    launchNativeEmulator: async ({ settings } = {}) => {
      try {
        const res = await fetch('/api/launch-native', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings })
        });
        return await res.json();
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
    onNativeEmulatorClosed: () => () => {},
    windowControls: {
      minimize: () => {},
      maximize: () => {},
      close: () => {}
    }
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
