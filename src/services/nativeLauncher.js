/**
 * Service de pilotage du moteur natif NeoRAGEx 5.0 (Windows / Electron)
 */
export async function launchNativeNeoRAGEx({ game = null, settings = null } = {}) {
  try {
    // 1. Si nous sommes dans l'application desktop Electron
    if (window.electronAPI && typeof window.electronAPI.launchNativeEmulator === 'function') {
      const res = await window.electronAPI.launchNativeEmulator({ game, settings });
      return res;
    }

    // 2. Si nous sommes dans le navigateur Web (localhost:3003)
    const res = await fetch('/api/launch-native', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game, settings })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Erreur serveur HTTP ${res.status}`);
    }

    return await res.json();
  } catch (err) {
    console.error('[nativeLauncher] Échec lancement:', err);
    return { success: false, error: err.message };
  }
}
