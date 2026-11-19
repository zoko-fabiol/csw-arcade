/**
 * Mode 4 — Nintendo : NES, SNES, Game Boy, Game Boy Color, GBA, Nintendo 64 & NDS.
 * Téléchargement automatique en 1 clic, cache IndexedDB et lancement via EmulatorJS.
 */

import { NINTENDO_CATALOG, RETRO_EXT_CORE_MAP } from '../data/catalogs.js';
import { createModeLayout } from '../components/shell-layout.js';
import { createDropZone, createGameCard, createViewHeader, h, showToast } from '../components/ui.js';
import { launchEmulator } from '../services/stage.js';
import {
  formatBytes,
  getSessionFile,
  listImportedLibrary,
  loadPrefs,
  registerSessionFile,
  removeImportedEntry,
  savePrefs,
} from '../services/storage.js';
import { ensureJSZip, getExtension } from '../services/zip.js';
import {
  autoSearchDownloadAndLaunch,
  getCachedRom,
  listCachedRoms,
  removeCachedRom,
  searchOnlineRoms,
} from '../services/rom-downloader.js';

const NINTENDO_ACCEPTED = '.nes,.sfc,.smc,.gba,.gb,.gbc,.n64,.z64,.v64,.nds,.zip';
const NINTENDO_EXTRACT_EXTS = ['.nes', '.sfc', '.smc', '.gba', '.gb', '.gbc', '.n64', '.z64', '.v64', '.nds'];

export function createNintendoView() {
  let activeFilter = 'all';
  let search = '';
  let viewMode = loadPrefs().viewMode || 'grid';
  let mobileOpen = false;
  let onlineQuery = '';
  let onlineResults = [];
  let onlineSearching = false;
  let cachedNintendoRoms = [];

  const container = h('div', { className: 'csw-view-root' });

  async function refreshCachedList() {
    cachedNintendoRoms = await listCachedRoms('nintendo');
    render();
  }

  async function launchNintendoFile(file, overrideCore, customTitle) {
    if (!file) return;
    let targetFile = file;
    let ext = getExtension(file.name);

    if (ext === 'zip') {
      try {
        const JSZip = await ensureJSZip();
        const archive = await JSZip.loadAsync(file);
        const candidates = Object.values(archive.files).filter(
          (f) => !f.dir && !f.name.startsWith('__MACOSX/') && RETRO_EXT_CORE_MAP[getExtension(f.name)]
        );
        if (candidates.length >= 1) {
          const item = candidates[0];
          if ((item._data?.uncompressedSize || 0) <= 256 * 1024 * 1024) {
            const blob = await item.async('blob');
            targetFile = new File([blob], item.name.split('/').pop(), { type: 'application/octet-stream' });
            ext = getExtension(targetFile.name);
          }
        }
      } catch (err) {
        showToast(`Extraction ZIP ignorée (${err.message}). Chargement direct…`, 'warn');
      }
    }

    const core = overrideCore || RETRO_EXT_CORE_MAP[ext] || 'nes';
    const id = `nintendo-${targetFile.name.toLowerCase()}`;
    registerSessionFile('nintendo', id, targetFile, {
      title: customTitle || targetFile.name.replace(/\.[^.]+$/, ''),
      platform: core,
      platformLabel: core.toUpperCase(),
    });
    render();

    launchEmulator({
      title: customTitle || targetFile.name,
      badge: `${core.toUpperCase()} · EmulatorJS`,
      core,
      fileBlob: targetFile,
      accent: '#ef4444',
    });
  }

  function autoLaunchEntry(entry) {
    const existing = getSessionFile('nintendo', entry.id);
    if (existing) {
      launchNintendoFile(existing, entry.core, entry.title);
      return;
    }

    autoSearchDownloadAndLaunch({
      id: entry.id,
      title: entry.title,
      searchQuery: entry.title,
      filename: entry.filename,
      urls: entry.urls || [],
      mode: 'nintendo',
      system: entry.platform,
      core: entry.core,
      extractExtensions: NINTENDO_EXTRACT_EXTS,
      onAfterCache: () => refreshCachedList(),
      onLaunch: (file) => launchNintendoFile(file, entry.core, entry.title),
    });
  }

  async function runOnlineSearch(queryText) {
    const q = (queryText ?? onlineQuery).trim();
    if (!q) {
      showToast('Entrez le nom d’un jeu Nintendo à rechercher en ligne.', 'warn');
      return;
    }
    onlineQuery = q;
    onlineSearching = true;
    render();
    try {
      const targetSystem = ['nes', 'snes', 'gba', 'gb', 'gbc', 'n64', 'nds'].includes(activeFilter)
        ? activeFilter
        : 'nes';
      onlineResults = await searchOnlineRoms(q, { system: targetSystem, limit: 12 });
      if (!onlineResults.length) {
        showToast(`Aucune ROM Nintendo trouvée en ligne pour « ${q} ».`, 'warn');
      }
    } catch (err) {
      showToast(`Erreur recherche en ligne : ${err.message}`, 'error');
    } finally {
      onlineSearching = false;
      render();
    }
  }

  function render() {
    const imported = listImportedLibrary('nintendo');
    const q = search.trim().toLowerCase();

    const filteredCatalog = NINTENDO_CATALOG.filter((item) => {
      if (['nes', 'snes', 'gba', 'gb', 'gbc', 'n64', 'nds'].includes(activeFilter) && item.platform !== activeFilter) {
        return false;
      }
      if (q && !`${item.title} ${item.genre} ${item.platformLabel}`.toLowerCase().includes(q)) return false;
      return true;
    });

    const filteredCached = cachedNintendoRoms.filter(
      (item) => !q || `${item.title} ${item.filename} ${item.core}`.toLowerCase().includes(q)
    );

    const filteredImported = imported.filter(
      (item) => !q || `${item.title} ${item.filename}`.toLowerCase().includes(q)
    );

    const countBy = (plat) => NINTENDO_CATALOG.filter((g) => g.platform === plat).length;

    const sidebarSections = [
      {
        label: 'Consoles Nintendo',
        items: [
          { id: 'all', icon: 'nintendo', label: 'Tout le catalogue', badge: NINTENDO_CATALOG.length },
          { id: 'nes', icon: 'arcade', label: 'NES (8-bit)', badge: countBy('nes') },
          { id: 'snes', icon: 'playstation', label: 'Super Nintendo', badge: countBy('snes') },
          { id: 'gba', icon: 'handheld', label: 'Game Boy Advance', badge: countBy('gba') },
          { id: 'gb', icon: 'handheld', label: 'Game Boy / Color', badge: countBy('gb') + countBy('gbc') },
          { id: 'n64', icon: 'cube', label: 'Nintendo 64', badge: countBy('n64') },
        ],
      },
      {
        label: 'Ma Bibliothèque',
        items: [
          { id: 'local', icon: 'database', label: 'En cache & locaux', badge: cachedNintendoRoms.length + imported.length },
        ],
      },
    ];

    const { root, main } = createModeLayout({
      sidebarSections,
      activeKey: activeFilter,
      mobileOpen,
      onCloseMobile: () => {
        mobileOpen = false;
        render();
      },
      onSelect: (id) => {
        activeFilter = id;
        render();
      },
    });

    const header = createViewHeader({
      title: 'UNIVERS NINTENDO',
      countText: `${NINTENDO_CATALOG.length} jeux vérifiés en ligne · NES, SNES, GB, GBC, GBA, N64`,
      searchValue: search,
      searchPlaceholder: 'Filtrer le catalogue Nintendo…',
      onSearch: (val) => {
        search = val;
        render();
      },
      viewMode,
      onViewMode: (m) => {
        viewMode = m;
        savePrefs({ viewMode: m });
        render();
      },
      onToggleSidebar: () => {
        mobileOpen = !mobileOpen;
        render();
      },
    });

    const content = h('div', { className: 'csw-scroll-content' });

    const dropzone = createDropZone({
      icon: 'nintendo',
      title: 'Importer une ROM Nintendo locale (.nes, .sfc, .gba, .gb, .z64, .nds, .zip)',
      subtitle: 'Lancement immédiat dans le navigateur via EmulatorJS',
      accept: NINTENDO_ACCEPTED,
      onFiles: (files) => launchNintendoFile(files[0]),
    });

    const onlineSearchInput = h('input', {
      type: 'search',
      className: 'csw-input',
      value: onlineQuery,
      placeholder: 'Rechercher un autre jeu Nintendo en ligne (ex: Zelda, Metroid, Kirby…) — téléchargement auto',
      'aria-label': 'Recherche ROM Nintendo en ligne',
      onInput: (e) => {
        onlineQuery = e.target.value;
      },
      onKeydown: (e) => {
        if (e.key === 'Enter') runOnlineSearch(onlineSearchInput.value);
      },
    });

    const onlineSearchBar = h(
      'section',
      { className: 'csw-online-bar' },
      h(
        'div',
        { className: 'csw-online-bar-head' },
        h('strong', {}, 'Recherche & Téléchargement Automatique Nintendo (Archive.org + Cache IndexedDB)'),
        h('span', { className: 'csw-muted' }, 'Cliquez sur un jeu pour le télécharger et le lancer automatiquement')
      ),
      h(
        'div',
        { className: 'csw-url-row' },
        onlineSearchInput,
        h(
          'button',
          {
            type: 'button',
            className: 'csw-btn csw-btn--primary',
            disabled: onlineSearching,
            onClick: () => runOnlineSearch(onlineSearchInput.value),
          },
          onlineSearching ? 'Recherche en cours…' : 'Rechercher en ligne'
        )
      )
    );

    content.append(dropzone, onlineSearchBar);

    if (onlineResults.length > 0) {
      content.append(
        h(
          'div',
          { className: 'csw-section-head' },
          h('h3', {}, `Résultats Nintendo en ligne (${onlineResults.length})`),
          h('span', { className: 'csw-section-note' }, 'Téléchargement automatique + cache IndexedDB')
        ),
        h(
          'div',
          { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
          onlineResults.map((item) => {
            const ext = getExtension(item.filename || '');
            const guessedCore = RETRO_EXT_CORE_MAP[ext] || 'nes';
            return createGameCard({
              title: item.title,
              platformLabel: guessedCore.toUpperCase(),
              filename: item.filename,
              sizeLabel: item.size ? formatBytes(item.size) : 'Auto',
              description: `Fichier : ${item.filename} · Source : ${item.sourceLabel}`,
              statusLabel: 'En ligne · Auto-DL',
              statusTone: 'accent',
              viewMode,
              primaryAction: {
                label: 'Télécharger & Jouer',
                onClick: () =>
                  autoLaunchEntry({
                    id: item.id,
                    title: item.title,
                    platform: guessedCore,
                    core: guessedCore,
                    filename: item.filename,
                    urls: item.urls,
                  }),
              },
            });
          })
        )
      );
    }

    if ((activeFilter === 'local' || activeFilter === 'all') && filteredCached.length > 0) {
      content.append(
        h(
          'div',
          { className: 'csw-section-head' },
          h('h3', {}, `Jeux Nintendo en cache persistant (${filteredCached.length})`),
          h('span', { className: 'csw-section-note' }, 'Stockés dans IndexedDB — lancement instantané')
        ),
        h(
          'div',
          { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
          filteredCached.map((item) =>
            createGameCard({
              title: item.title,
              platformLabel: (item.core || item.platform || 'NINTENDO').toUpperCase(),
              filename: item.filename,
              sizeLabel: formatBytes(item.size),
              description: `En cache : ${item.filename}`,
              statusLabel: 'En cache (Prêt)',
              statusTone: 'ready',
              viewMode,
              primaryAction: {
                label: 'Lancer',
                onClick: async () => {
                  const cached = await getCachedRom(item.id);
                  if (!cached?.data) {
                    showToast('ROM absente du cache.', 'warn');
                    refreshCachedList();
                    return;
                  }
                  const f = new File([cached.data], cached.filename || item.filename, {
                    type: 'application/octet-stream',
                  });
                  launchNintendoFile(f, item.core, item.title);
                },
              },
              secondaryAction: {
                label: 'Supprimer',
                onClick: async () => {
                  await removeCachedRom(item.id);
                  refreshCachedList();
                },
              },
            })
          )
        )
      );
    }

    if (activeFilter === 'local' && filteredImported.length > 0) {
      content.append(
        h('div', { className: 'csw-section-head' }, h('h3', {}, 'ROMs locales importées')),
        h(
          'div',
          { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
          filteredImported.map((item) => {
            const file = getSessionFile('nintendo', item.id);
            return createGameCard({
              title: item.title,
              platformLabel: item.platformLabel,
              filename: item.filename,
              sizeLabel: formatBytes(item.size),
              description: `Fichier local : ${item.filename}`,
              statusLabel: file ? 'Prêt' : 'À relier',
              statusTone: file ? 'ready' : 'warn',
              viewMode,
              primaryAction: {
                label: file ? 'Lancer' : 'Sélectionner',
                onClick: () => {
                  if (file) launchNintendoFile(file, item.platform, item.title);
                },
              },
              secondaryAction: {
                label: 'Retirer',
                onClick: () => {
                  removeImportedEntry('nintendo', item.id);
                  render();
                },
              },
            });
          })
        )
      );
    }

    if (activeFilter !== 'local') {
      const displayItems =
        activeFilter === 'gb'
          ? NINTENDO_CATALOG.filter((item) => ['gb', 'gbc'].includes(item.platform) && (!q || `${item.title} ${item.genre} ${item.platformLabel}`.toLowerCase().includes(q)))
          : filteredCatalog;

      content.append(
        h(
          'div',
          { className: 'csw-section-head' },
          h('h3', {}, 'Catalogue Nintendo (ROMs vérifiées en ligne)'),
          h('span', { className: 'csw-section-note' }, 'Cliquez sur « ▶ Télécharger & Jouer » pour lancer automatiquement')
        ),
        displayItems.length
          ? h(
              'div',
              { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
              displayItems.map((entry) => {
                const isCached = cachedNintendoRoms.some((c) => c.id === entry.id) || Boolean(getSessionFile('nintendo', entry.id));
                return createGameCard({
                  title: entry.title,
                  platformLabel: entry.platformLabel,
                  filename: entry.filename,
                  year: entry.year,
                  genre: entry.genre,
                  players: entry.players,
                  sizeLabel: entry.estimatedSize,
                  description: entry.description,
                  statusLabel: isCached ? 'En cache (Prêt)' : 'En ligne · Auto-DL',
                  statusTone: isCached ? 'ready' : 'accent',
                  viewMode,
                  primaryAction: {
                    label: isCached ? 'Lancer' : 'Télécharger & Jouer',
                    onClick: () => autoLaunchEntry(entry),
                  },
                });
              })
            )
          : h('p', { className: 'csw-empty-state' }, 'Aucun jeu Nintendo ne correspond à votre filtre.')
      );
    }

    main.append(header, content);
    container.replaceChildren(root);
  }

  refreshCachedList();
  window.addEventListener('csw:prefs-changed', (e) => {
    const nextMode = e.detail?.viewMode;
    if (nextMode && nextMode !== viewMode) {
      viewMode = nextMode;
      render();
    }
  });

  render();
  return { element: container, refresh: refreshCachedList };
}
