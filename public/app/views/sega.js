/**
 * Mode 3 — Sega : Mega Drive / Genesis, Master System & Game Gear.
 * Téléchargement automatique en 1 clic, cache IndexedDB et lancement via EmulatorJS.
 */

import { RETRO_EXT_CORE_MAP, SEGA_CATALOG } from '../data/catalogs.js';
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

const SEGA_ACCEPTED = '.md,.gen,.bin,.sms,.gg,.zip';
const SEGA_EXTRACT_EXTS = ['.md', '.gen', '.bin', '.sms', '.gg'];

export function createSegaView() {
  let activeFilter = 'all';
  let search = '';
  let viewMode = loadPrefs().viewMode || 'grid';
  let mobileOpen = false;
  let onlineQuery = '';
  let onlineResults = [];
  let onlineSearching = false;
  let cachedSegaRoms = [];
  let extendedSega = [];
  let visibleLimit = 48;

  const container = h('div', { className: 'csw-view-root' });

  async function loadExtendedSega() {
    try {
      const res = await fetch('./app/data/extended-catalogs.json');
      if (!res.ok) return;
      const json = await res.json();
      if (Array.isArray(json?.segaMD)) {
        const baseIds = new Set(SEGA_CATALOG.map((g) => g.title.toLowerCase()));
        extendedSega = json.segaMD.filter((g) => !baseIds.has(g.title.toLowerCase()));
        render();
      }
    } catch {
      // Ignore si hors-ligne
    }
  }

  async function refreshCachedList() {
    cachedSegaRoms = await listCachedRoms('sega');
    render();
  }

  async function launchSegaFile(file, overrideCore, customTitle) {
    if (!file) return;
    let targetFile = file;
    let ext = getExtension(file.name);

    if (ext === 'zip') {
      try {
        const JSZip = await ensureJSZip();
        const archive = await JSZip.loadAsync(file);
        const candidates = Object.values(archive.files).filter(
          (f) => !f.dir && !f.name.startsWith('__MACOSX/') && ['md', 'gen', 'bin', 'sms', 'gg'].includes(getExtension(f.name))
        );
        if (candidates.length >= 1) {
          const item = candidates[0];
          if ((item._data?.uncompressedSize || 0) <= 64 * 1024 * 1024) {
            const blob = await item.async('blob');
            targetFile = new File([blob], item.name.split('/').pop(), { type: 'application/octet-stream' });
            ext = getExtension(targetFile.name);
          }
        }
      } catch (err) {
        showToast(`Extraction ZIP ignorée (${err.message}). Chargement direct…`, 'warn');
      }
    }

    const core = overrideCore || RETRO_EXT_CORE_MAP[ext] || 'segaMD';
    const id = `sega-${targetFile.name.toLowerCase()}`;
    registerSessionFile('sega', id, targetFile, {
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
      accent: '#0ea5e9',
    });
  }

  function autoLaunchEntry(entry) {
    const existing = getSessionFile('sega', entry.id);
    if (existing) {
      launchSegaFile(existing, entry.core, entry.title);
      return;
    }

    autoSearchDownloadAndLaunch({
      id: entry.id,
      title: entry.title,
      searchQuery: entry.title,
      filename: entry.filename,
      urls: entry.urls || [],
      mode: 'sega',
      system: entry.platform,
      core: entry.core,
      extractExtensions: SEGA_EXTRACT_EXTS,
      onAfterCache: () => refreshCachedList(),
      onLaunch: (file) => launchSegaFile(file, entry.core, entry.title),
    });
  }

  async function runOnlineSearch(queryText) {
    const q = (queryText ?? onlineQuery).trim();
    if (!q) {
      showToast('Entrez le nom d’un jeu Sega à rechercher en ligne.', 'warn');
      return;
    }
    onlineQuery = q;
    onlineSearching = true;
    render();
    try {
      const targetSystem = ['segaMD', 'segaMS', 'segaGG'].includes(activeFilter) ? activeFilter : 'segaMD';
      onlineResults = await searchOnlineRoms(q, { system: targetSystem, limit: 12 });
      if (!onlineResults.length) {
        showToast(`Aucune ROM Sega trouvée en ligne pour « ${q} ».`, 'warn');
      }
    } catch (err) {
      showToast(`Erreur recherche en ligne : ${err.message}`, 'error');
    } finally {
      onlineSearching = false;
      render();
    }
  }

  function render() {
    const imported = listImportedLibrary('sega');
    const q = search.trim().toLowerCase();
    const allCatalog = [...SEGA_CATALOG, ...extendedSega];

    const filteredCatalog = allCatalog.filter((item) => {
      if (['segaMD', 'segaMS', 'segaGG'].includes(activeFilter) && item.platform !== activeFilter) {
        return false;
      }
      if (q && !`${item.title} ${item.genre} ${item.platformLabel}`.toLowerCase().includes(q)) return false;
      return true;
    });

    const filteredCached = cachedSegaRoms.filter(
      (item) => !q || `${item.title} ${item.filename} ${item.core}`.toLowerCase().includes(q)
    );

    const filteredImported = imported.filter(
      (item) => !q || `${item.title} ${item.filename}`.toLowerCase().includes(q)
    );

    const countBy = (plat) => allCatalog.filter((g) => g.platform === plat).length;

    const sidebarSections = [
      {
        label: 'Consoles Sega',
        items: [
          { id: 'all', icon: 'sega', label: 'Tout le catalogue', badge: allCatalog.length },
          { id: 'segaMD', icon: 'arcade', label: 'Mega Drive / Genesis', badge: countBy('segaMD') },
          { id: 'segaMS', icon: 'playstation', label: 'Master System', badge: countBy('segaMS') },
          { id: 'segaGG', icon: 'handheld', label: 'Game Gear', badge: countBy('segaGG') },
        ],
      },
      {
        label: 'Ma Bibliothèque',
        items: [
          { id: 'local', icon: 'database', label: 'En cache & locaux', badge: cachedSegaRoms.length + imported.length },
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
      title: 'UNIVERS SEGA',
      countText: `${allCatalog.length} jeux vérifiés en ligne (< 5 Mo) · Mega Drive, Master System, Game Gear`,
      searchValue: search,
      searchPlaceholder: 'Filtrer le catalogue Sega…',
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
      icon: 'sega',
      title: 'Importer une ROM Sega locale (.md, .gen, .bin, .sms, .gg, .zip)',
      subtitle: 'Lancement immédiat dans le navigateur via EmulatorJS',
      accept: SEGA_ACCEPTED,
      onFiles: (files) => launchSegaFile(files[0]),
    });

    const onlineSearchInput = h('input', {
      type: 'search',
      className: 'csw-input',
      value: onlineQuery,
      placeholder: 'Rechercher un autre jeu Sega en ligne (ex: Sonic, Golden Axe, Shinobi…) — téléchargement auto',
      'aria-label': 'Recherche ROM Sega en ligne',
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
        h('strong', {}, 'Recherche & Téléchargement Automatique Sega (Archive.org + Cache IndexedDB)'),
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
          h('h3', {}, `Résultats Sega en ligne (${onlineResults.length})`),
          h('span', { className: 'csw-section-note' }, 'Téléchargement automatique + cache IndexedDB')
        ),
        h(
          'div',
          { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
          onlineResults.map((item) => {
            const ext = getExtension(item.filename || '');
            const guessedCore = RETRO_EXT_CORE_MAP[ext] || 'segaMD';
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
          h('h3', {}, `Jeux Sega en cache persistant (${filteredCached.length})`),
          h('span', { className: 'csw-section-note' }, 'Stockés dans IndexedDB — lancement instantané')
        ),
        h(
          'div',
          { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
          filteredCached.map((item) =>
            createGameCard({
              title: item.title,
              platformLabel: (item.core || item.platform || 'SEGA').toUpperCase(),
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
                  launchSegaFile(f, item.core, item.title);
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
            const file = getSessionFile('sega', item.id);
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
                  if (file) launchSegaFile(file, item.platform, item.title);
                },
              },
              secondaryAction: {
                label: 'Retirer',
                onClick: () => {
                  removeImportedEntry('sega', item.id);
                  render();
                },
              },
            });
          })
        )
      );
    }

    if (activeFilter !== 'local') {
      const visibleItems = filteredCatalog.slice(0, visibleLimit);
      content.append(
        h(
          'div',
          { className: 'csw-section-head' },
          h('h3', {}, `Catalogue Sega (${filteredCatalog.length} jeux vérifiés)`),
          h('span', { className: 'csw-section-note' }, 'Cliquez sur « ▶ Télécharger & Jouer » pour lancer automatiquement')
        ),
        visibleItems.length
          ? h(
              'div',
              { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
              visibleItems.map((entry) => {
                const isCached = cachedSegaRoms.some((c) => c.id === entry.id) || Boolean(getSessionFile('sega', entry.id));
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
          : h('p', { className: 'csw-empty-state' }, 'Aucun jeu Sega ne correspond à votre filtre.')
      );

      if (filteredCatalog.length > visibleLimit) {
        content.append(
          h(
            'div',
            { style: 'display:flex;justify-content:center;padding:8px 0;' },
            h(
              'button',
              {
                type: 'button',
                className: 'csw-btn csw-btn--primary',
                onClick: () => {
                  visibleLimit += 48;
                  render();
                },
              },
              `Afficher plus (${filteredCatalog.length - visibleLimit} restants)`
            )
          )
        );
      }
    }

    main.append(header, content);
    container.replaceChildren(root);
  }

  refreshCachedList();
  loadExtendedSega();
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
