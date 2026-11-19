/**
 * Point d’entrée principal du Shell Unifié 4 Modes CSW-Arcade.
 */

import { MODE_META } from './data/catalogs.js';
import { createArcadeConsolesView } from './views/arcade-consoles.js';
import { createPlayStationView } from './views/playstation.js';
import { createSegaView } from './views/sega.js';
import { createNintendoView } from './views/nintendo.js';
import { createJavaView } from './views/java.js';
import { closeStage, initStage, isStageOpen, refreshStageDisplay } from './services/stage.js';
import { getPlatformCacheStats } from './services/rom-downloader.js';
import {
  formatBytes,
  getArcadeCacheStats,
  listImportedLibrary,
  loadPrefs,
  resetPrefs,
  savePrefs,
} from './services/storage.js';
import { showToast } from './components/ui.js';

const VALID_MODES = ['arcade', 'playstation', 'sega', 'nintendo', 'java'];

function initApp() {
  const params = new URLSearchParams(window.location.search);
  const prefs = loadPrefs();
  const initialMode = VALID_MODES.includes(params.get('mode'))
    ? params.get('mode')
    : VALID_MODES.includes(prefs.defaultMode)
      ? prefs.defaultMode
      : 'arcade';

  let currentMode = initialMode;
  const joinParam = params.get('join');
  let arcadeSub = joinParam || params.get('sub') === 'neogeo' ? 'neogeo' : 'consoles';

  // Instances paresseuses / persistantes des vues
  let arcadeFrameLoaded = false;
  const views = {
    consoles: null,
    playstation: null,
    sega: null,
    nintendo: null,
    java: null,
  };

  const els = {
    modeButtons: [...document.querySelectorAll('[data-mode-btn]')],
    modePanels: {
      arcade: document.getElementById('panel-arcade'),
      playstation: document.getElementById('panel-playstation'),
      sega: document.getElementById('panel-sega'),
      nintendo: document.getElementById('panel-nintendo'),
      java: document.getElementById('panel-java'),
    },
    arcadeSubButtons: [...document.querySelectorAll('[data-arcade-sub]')],
    arcadeNeoGeoPane: document.getElementById('arcade-neogeo-pane'),
    arcadeConsolesPane: document.getElementById('arcade-consoles-pane'),
    arcadeFrame: document.getElementById('arcade-legacy-frame'),
    netBadge: document.getElementById('topbar-net-badge'),
    cacheBadge: document.getElementById('topbar-cache-badge'),
    modeSubtitle: document.getElementById('topbar-mode-subtitle'),
    settingsModal: document.getElementById('modal-settings'),
  };

  function ensureArcadeFrame() {
    if (arcadeFrameLoaded || !els.arcadeFrame) return;
    arcadeFrameLoaded = true;
    els.arcadeFrame.src = joinParam
      ? `./arcade-app.html?join=${encodeURIComponent(joinParam)}`
      : './arcade-app.html';
  }

  function ensureView(key) {
    if (key === 'consoles' && !views.consoles) {
      views.consoles = createArcadeConsolesView({
        onSwitchToNeoGeo: () => setArcadeSub('neogeo'),
      });
      els.arcadeConsolesPane?.replaceChildren(views.consoles.element);
    } else if (key === 'playstation' && !views.playstation) {
      views.playstation = createPlayStationView();
      els.modePanels.playstation?.replaceChildren(views.playstation.element);
    } else if (key === 'sega' && !views.sega) {
      views.sega = createSegaView();
      els.modePanels.sega?.replaceChildren(views.sega.element);
    } else if (key === 'nintendo' && !views.nintendo) {
      views.nintendo = createNintendoView();
      els.modePanels.nintendo?.replaceChildren(views.nintendo.element);
    } else if (key === 'java' && !views.java) {
      views.java = createJavaView();
      els.modePanels.java?.replaceChildren(views.java.element);
    }
  }

  function setArcadeSub(sub) {
    arcadeSub = sub === 'consoles' ? 'consoles' : 'neogeo';
    for (const btn of els.arcadeSubButtons) {
      const active = btn.dataset.arcadeSub === arcadeSub;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    }
    if (arcadeSub === 'neogeo') {
      ensureArcadeFrame();
      if (els.arcadeNeoGeoPane) els.arcadeNeoGeoPane.hidden = false;
      if (els.arcadeConsolesPane) els.arcadeConsolesPane.hidden = true;
    } else {
      ensureView('consoles');
      if (els.arcadeNeoGeoPane) els.arcadeNeoGeoPane.hidden = true;
      if (els.arcadeConsolesPane) els.arcadeConsolesPane.hidden = false;
      views.consoles?.refresh?.();
    }
    syncUrl();
  }

  function syncUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('mode', currentMode);
    if (currentMode === 'arcade' && arcadeSub === 'consoles') {
      url.searchParams.set('sub', 'consoles');
    } else {
      url.searchParams.delete('sub');
    }
    window.history.replaceState({}, '', url.toString());
  }

  function switchMode(mode) {
    if (!VALID_MODES.includes(mode)) return;
    currentMode = mode;
    document.documentElement.dataset.mode = mode;

    const meta = MODE_META[mode];
    if (els.modeSubtitle && meta) {
      els.modeSubtitle.textContent = meta.subtitle;
    }

    for (const btn of els.modeButtons) {
      const active = btn.dataset.modeBtn === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    }

    for (const m of VALID_MODES) {
      const panel = els.modePanels[m];
      if (panel) panel.hidden = m !== mode;
    }

    if (mode === 'arcade') {
      setArcadeSub(arcadeSub);
    } else {
      ensureView(mode);
      views[mode]?.refresh?.();
      syncUrl();
    }
  }

  // --- Statut réseau & cache IndexedDB ---
  function updateNetworkIndicator() {
    if (!els.netBadge) return;
    const online = navigator.onLine;
    els.netBadge.textContent = online ? 'En ligne' : 'Hors-ligne';
    els.netBadge.classList.toggle('is-offline', !online);
  }

  async function refreshCacheIndicator() {
    const [arcadeStats, platformStats] = await Promise.all([
      getArcadeCacheStats(),
      getPlatformCacheStats(),
    ]);
    const psCount = listImportedLibrary('playstation').length;
    const segaCount = listImportedLibrary('sega').length;
    const nintendoCount = listImportedLibrary('nintendo').length;
    const retroCount = listImportedLibrary('retro').length;
    const totalItems = arcadeStats.count + platformStats.count;
    const totalBytes = arcadeStats.totalBytes + platformStats.totalBytes;
    if (els.cacheBadge) {
      els.cacheBadge.textContent = `Cache : ${totalItems} jeu(x) · ${formatBytes(totalBytes)}`;
    }
    const auditEl = document.getElementById('settings-storage-summary');
    if (auditEl) {
      auditEl.textContent = `Arcade Neo Geo : ${arcadeStats.count} (${formatBytes(arcadeStats.totalBytes)}) · Consoles/PS1/Sega/Nintendo (IndexedDB) : ${platformStats.count} (${formatBytes(platformStats.totalBytes)}) · Session : Rétro ${retroCount}, PS1 ${psCount}, Sega ${segaCount}, Nintendo ${nintendoCount}`;
    }
  }

  function syncArcadeIframeSettings() {
    const p = loadPrefs();
    try {
      const raw = localStorage.getItem('csw_arcade_settings_v1');
      const cur = raw ? JSON.parse(raw) : {};
      cur.audio = { ...(cur.audio || {}), volume: p.volume, muted: Boolean(p.muted) };
      cur.video = {
        ...(cur.video || {}),
        filter: p.videoFilter === 'smooth' ? 'smooth' : 'pixelated',
        aspectRatio: p.screenRatio === 'stretch' ? '16:9' : '4:3',
      };
      localStorage.setItem('csw_arcade_settings_v1', JSON.stringify(cur));
    } catch {}
    if (els.arcadeFrame?.contentWindow) {
      els.arcadeFrame.contentWindow.postMessage(
        {
          type: 'CSW_SHELL_SETTINGS',
          videoFilter: p.videoFilter,
          screenRatio: p.screenRatio,
          volume: p.volume,
          muted: Boolean(p.muted),
        },
        window.location.origin
      );
    }
  }

  // --- Modale Paramètres Globaux ---
  function syncSettingsForm() {
    const p = loadPrefs();
    const setVal = (id, val) => {
      const node = document.getElementById(id);
      if (node) node.value = String(val);
    };
    setVal('pref-default-mode', p.defaultMode);
    setVal('pref-video-filter', p.videoFilter);
    setVal('pref-screen-ratio', p.screenRatio);
    setVal('pref-volume', p.volume);
    setVal('pref-view-mode', p.viewMode || 'grid');
    const mutedEl = document.getElementById('pref-muted');
    if (mutedEl) mutedEl.checked = Boolean(p.muted);
    const volLabel = document.getElementById('pref-volume-label');
    if (volLabel) volLabel.textContent = p.muted ? 'Muet' : `${p.volume}%`;
  }

  function openSettingsModal() {
    syncSettingsForm();
    refreshCacheIndicator();
    if (els.settingsModal) els.settingsModal.hidden = false;
  }

  function closeSettingsModal() {
    if (els.settingsModal) els.settingsModal.hidden = true;
  }

  // Événements Top Bar & Switcher
  for (const btn of els.modeButtons) {
    btn.addEventListener('click', () => switchMode(btn.dataset.modeBtn));
  }
  for (const btn of els.arcadeSubButtons) {
    btn.addEventListener('click', () => setArcadeSub(btn.dataset.arcadeSub));
  }

  document.getElementById('btn-open-settings')?.addEventListener('click', openSettingsModal);
  document.getElementById('btn-close-settings')?.addEventListener('click', closeSettingsModal);
  els.settingsModal?.addEventListener('click', (e) => {
    if (e.target === els.settingsModal) closeSettingsModal();
  });

  document.getElementById('pref-default-mode')?.addEventListener('change', (e) => {
    savePrefs({ defaultMode: e.target.value });
  });
  document.getElementById('pref-video-filter')?.addEventListener('change', (e) => {
    savePrefs({ videoFilter: e.target.value });
    refreshStageDisplay();
  });
  document.getElementById('pref-screen-ratio')?.addEventListener('change', (e) => {
    savePrefs({ screenRatio: e.target.value });
    refreshStageDisplay();
  });
  document.getElementById('pref-volume')?.addEventListener('input', (e) => {
    const v = Number.parseInt(e.target.value, 10) || 0;
    const p = savePrefs({ volume: v });
    const volLabel = document.getElementById('pref-volume-label');
    if (volLabel) volLabel.textContent = p.muted ? 'Muet' : `${v}%`;
  });
  document.getElementById('pref-view-mode')?.addEventListener('change', (e) => {
    savePrefs({ viewMode: e.target.value === 'list' ? 'list' : 'grid' });
  });
  document.getElementById('pref-muted')?.addEventListener('change', (e) => {
    const p = savePrefs({ muted: Boolean(e.target.checked) });
    const volLabel = document.getElementById('pref-volume-label');
    if (volLabel) volLabel.textContent = p.muted ? 'Muet' : `${p.volume}%`;
  });
  document.getElementById('btn-clear-rom-cache')?.addEventListener('click', async () => {
    await clearPlatformRomCache();
    await refreshCacheIndicator();
    Object.values(views).forEach((v) => v?.refresh?.());
    showToast('Cache des ROMs (PlayStation, Sega, Nintendo, Rétro) vidé.', 'info');
  });
  document.getElementById('btn-reset-prefs')?.addEventListener('click', () => {
    resetPrefs();
    syncSettingsForm();
    showToast('Paramètres généraux réinitialisés.', 'info');
  });

  window.addEventListener('csw:prefs-changed', () => {
    refreshStageDisplay();
    syncArcadeIframeSettings();
  });

  window.addEventListener('storage', (e) => {
    if (e.key === 'csw_arcade_settings_v1' && e.newValue) {
      try {
        const hw = JSON.parse(e.newValue);
        savePrefs({
          videoFilter: hw.video?.filter === 'smooth' ? 'smooth' : 'sharp',
          screenRatio: hw.video?.aspectRatio === '16:9' ? 'stretch' : 'fit',
          volume: typeof hw.audio?.volume === 'number' ? hw.audio.volume : loadPrefs().volume,
          muted: Boolean(hw.audio?.muted),
        });
        syncSettingsForm();
      } catch {}
    }
  });

  document.getElementById('btn-open-hw-settings')?.addEventListener('click', () => {
    closeSettingsModal();
    switchMode('arcade');
    setArcadeSub('neogeo');
    setTimeout(() => {
      try {
        const doc = els.arcadeFrame?.contentDocument;
        const btn = doc?.querySelector('[title*="Paramètres"], [aria-label*="Paramètres"], button:has(svg)');
        const gear = [...(doc?.querySelectorAll('button') || [])].find((b) =>
          /param|config|setting/i.test(b.textContent || b.title || b.getAttribute('aria-label') || '')
        );
        gear?.click();
      } catch {}
    }, 350);
  });

  els.arcadeFrame?.addEventListener('load', syncArcadeIframeSettings);

  // Raccourcis clavier (Alt+1..4 pour changer de mode, Echap pour fermer modale/lecteur)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (els.settingsModal && !els.settingsModal.hidden) {
        closeSettingsModal();
        return;
      }
      if (isStageOpen() && !document.fullscreenElement) {
        closeStage();
        return;
      }
    }
    if (e.altKey && ['1', '2', '3', '4', '5'].includes(e.key)) {
      e.preventDefault();
      switchMode(VALID_MODES[Number.parseInt(e.key, 10) - 1]);
    }
  });

  window.addEventListener('online', updateNetworkIndicator);
  window.addEventListener('offline', updateNetworkIndicator);

  initStage({ onOpenSettings: openSettingsModal });
  updateNetworkIndicator();
  refreshCacheIndicator();
  switchMode(initialMode);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
