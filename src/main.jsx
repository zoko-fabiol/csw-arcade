import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

import gamesData from './data/games.json';

// Polyfill de compatibilité si l'application est ouverte directement dans un navigateur Web (Chrome/Edge/Firefox)
if (!window.electronAPI) {
  console.log('[CSW-Arcade] Navigateur Web détecté : activation du polyfill client Web');
  window.electronAPI = {
    readRom: async (filename) => {
      try {
        const res = await fetch(`/api/rom?file=${encodeURIComponent(filename)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.arrayBuffer();
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
