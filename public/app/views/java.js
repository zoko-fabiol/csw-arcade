/**
 * Mode 5 — Java / Gameloft Mobile (J2ME .jar).
 * Bibliothèque de 300+ jeux Java & Gameloft, téléchargement automatique, cache IndexedDB et lancement dans FreeJ2ME-Web.
 */

import { createModeLayout } from '../components/shell-layout.js';
import { createDropZone, createGameCard, createViewHeader, h, showToast } from '../components/ui.js';
import { launchJ2me } from '../services/stage.js';
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

const JAVA_ACCEPTED = '.jar,.zip';

export function createJavaView() {
  let activeFilter = 'all';
  let search = '';
  let viewMode = loadPrefs().viewMode || 'grid';
  let mobileOpen = false;
  let onlineQuery = '';
  let onlineResults = [];
  let onlineSearching = false;
  let cachedJavaRoms = [];
  let catalog = [];
  let visibleLimit = 48;

  const container = h('div', { className: 'csw-view-root' });

  async function loadCatalog() {
    try {
      const res = await fetch('./app/data/java-catalog.json');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        catalog = data;
        render();
      }
    } catch {
      // Ignore si hors-ligne
    }
  }

  async function refreshCachedList() {
    cachedJavaRoms = await listCachedRoms('java');
    render();
  }

  async function launchJavaFile(file, customTitle) {
    if (!file) return;
    let targetFile = file;
    let ext = getExtension(file.name);

    if (ext === 'zip') {
      try {
        const JSZip = await ensureJSZip();
        const archive = await JSZip.loadAsync(file);
        const candidates = Object.values(archive.files).filter(
          (f) => !f.dir && !f.name.startsWith('__MACOSX/') && getExtension(f.name) === 'jar'
        );
        if (candidates.length >= 1) {
          const item = candidates[0];
          const blob = await item.async('blob');
          targetFile = new File([blob], item.name.split('/').pop(), { type: 'application/java-archive' });
          ext = 'jar';
        }
      } catch (err) {
        showToast(`Extraction ZIP ignorée (${err.message}).`, 'warn');
      }
    }

    if (ext !== 'jar') {
      showToast(`Format .${ext} non supporté pour Java J2ME (.jar ou .zip).`, 'error');
      return;
    }

    const id = `java-${targetFile.name.toLowerCase()}`;
    registerSessionFile('java', id, targetFile, {
      title: customTitle || targetFile.name.replace(/\.jar$/i, ''),
      platform: 'j2me',
      platformLabel: 'Java J2ME',
    });
    render();

    launchJ2me({
      title: customTitle || targetFile.name,
      badge: 'Java J2ME · FreeJ2ME',
      fileBlob: targetFile,
      filename: targetFile.name,
    });
  }

  function autoLaunchEntry(entry) {
    const existing = getSessionFile('java', entry.id);
    if (existing) {
      launchJavaFile(existing, entry.title);
      return;
    }

    autoSearchDownloadAndLaunch({
      id: entry.id,
      title: entry.title,
      searchQuery: `${entry.title} j2me`,
      filename: entry.filename,
      urls: entry.urls || [],
      mode: 'java',
      system: 'j2me',
      core: 'j2me',
      extractExtensions: ['.jar'],
      onAfterCache: () => refreshCachedList(),
      onLaunch: (file) => launchJavaFile(file, entry.title),
    });
  }

  async function runOnlineSearch(queryText) {
    const q = (queryText ?? onlineQuery).trim();
    if (!q) {
      showToast('Entrez le nom d’un jeu Java / Gameloft à rechercher.', 'warn');
      return;
    }
    onlineQuery = q;
    onlineSearching = true;
    render();
    try {
      onlineResults = await searchOnlineRoms(q, { system: 'j2me', limit: 12 });
      if (!onlineResults.length) {
        showToast(`Aucun .jar trouvé en ligne pour « ${q} ».`, 'warn');
      }
    } catch (err) {
      showToast(`Erreur recherche en ligne : ${err.message}`, 'error');
    } finally {
      onlineSearching = false;
      render();
    }
  }

  function render() {
    const imported = listImportedLibrary('java');
    const q = search.trim().toLowerCase();

    const filteredCatalog = catalog.filter((item) => {
      if (['gameloft', 'action', 'racing', 'rpg'].includes(activeFilter) && item.category !== activeFilter) {
        return false;
      }
      if (q && !`${item.title} ${item.publisher} ${item.filename}`.toLowerCase().includes(q)) return false;
      return true;
    });

    const filteredCached = cachedJavaRoms.filter(
      (item) => !q || `${item.title} ${item.filename}`.toLowerCase().includes(q)
    );

    const filteredImported = imported.filter(
      (item) => !q || `${item.title} ${item.filename}`.toLowerCase().includes(q)
    );

    const countCat = (cat) => catalog.filter((g) => g.category === cat).length;

    const sidebarSections = [
      {
        label: 'Java & Gameloft Mobile',
        items: [
          { id: 'all', icon: 'java', label: 'Tout le catalogue', badge: catalog.length || '…' },
          { id: 'gameloft', icon: 'handheld', label: 'Gameloft Classics', badge: countCat('gameloft') },
          { id: 'action', icon: 'gamepad', label: 'Action & Arcade', badge: countCat('action') },
          { id: 'racing', icon: 'cube', label: 'Course', badge: countCat('racing') },
          { id: 'rpg', icon: 'book', label: 'RPG & Stratégie', badge: countCat('rpg') },
        ],
      },
      {
        label: 'Ma Bibliothèque',
        items: [
          { id: 'local', icon: 'database', label: 'En cache & locaux', badge: cachedJavaRoms.length + imported.length },
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
        visibleLimit = 48;
        render();
      },
    });

    const header = createViewHeader({
      title: 'JAVA & GAMELOFT MOBILE',
      countText: `${catalog.length} jeux J2ME (.jar) vérifiés (< 2 Mo) · Téléchargement automatique & FreeJ2ME`,
      searchValue: search,
      searchPlaceholder: 'Filtrer Asphalt, Assassin, Diamond Rush…',
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
      icon: 'java',
      title: 'Importer un jeu Java mobile local (.jar ou .zip)',
      subtitle: 'Chargement direct dans FreeJ2ME-Web',
      accept: JAVA_ACCEPTED,
      onFiles: (files) => launchJavaFile(files[0]),
    });

    const onlineSearchInput = h('input', {
      type: 'search',
      className: 'csw-input',
      value: onlineQuery,
      placeholder: 'Rechercher un jeu Java / Gameloft en ligne (ex: Asphalt, Gangstar, Real Football…) — téléchargement auto',
      'aria-label': 'Recherche jeu Java en ligne',
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
        h('strong', {}, 'Recherche & Téléchargement Automatique Java J2ME (Archive.org + Cache IndexedDB)'),
        h('span', { className: 'csw-muted' }, 'Cliquez sur un jeu pour télécharger le .jar et lancer FreeJ2ME')
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
          h('h3', {}, `Résultats Java en ligne (${onlineResults.length})`),
          h('span', { className: 'csw-section-note' }, 'Téléchargement automatique + cache IndexedDB')
        ),
        h(
          'div',
          { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
          onlineResults.map((item) =>
            createGameCard({
              title: item.title,
              platformLabel: 'Java J2ME',
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
                    filename: item.filename,
                    urls: item.urls,
                  }),
              },
            })
          )
        )
      );
    }

    if ((activeFilter === 'local' || activeFilter === 'all') && filteredCached.length > 0) {
      content.append(
        h(
          'div',
          { className: 'csw-section-head' },
          h('h3', {}, `Jeux Java en cache persistant (${filteredCached.length})`),
          h('span', { className: 'csw-section-note' }, 'Stockés dans IndexedDB — lancement instantané')
        ),
        h(
          'div',
          { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
          filteredCached.map((item) =>
            createGameCard({
              title: item.title,
              platformLabel: 'Java J2ME',
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
                    showToast('Archive .jar absente du cache.', 'warn');
                    refreshCachedList();
                    return;
                  }
                  const f = new File([cached.data], cached.filename || item.filename, {
                    type: 'application/java-archive',
                  });
                  launchJavaFile(f, item.title);
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
        h('div', { className: 'csw-section-head' }, h('h3', {}, 'Jeux Java importés localement')),
        h(
          'div',
          { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
          filteredImported.map((item) => {
            const file = getSessionFile('java', item.id);
            return createGameCard({
              title: item.title,
              platformLabel: item.platformLabel,
              sizeLabel: formatBytes(item.size),
              description: `Fichier local : ${item.filename}`,
              statusLabel: file ? 'Prêt' : 'À relier',
              statusTone: file ? 'ready' : 'warn',
              viewMode,
              primaryAction: {
                label: file ? 'Lancer' : 'Sélectionner',
                onClick: () => {
                  if (file) launchJavaFile(file, item.title);
                },
              },
              secondaryAction: {
                label: 'Retirer',
                onClick: () => {
                  removeImportedEntry('java', item.id);
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
          h('h3', {}, `Catalogue Java & Gameloft (${filteredCatalog.length} jeux vérifiés)`),
          h('span', { className: 'csw-section-note' }, 'Cliquez sur « Télécharger & Jouer » pour lancer automatiquement')
        ),
        visibleItems.length
          ? h(
              'div',
              { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
              visibleItems.map((entry) => {
                const isCached = cachedJavaRoms.some((c) => c.id === entry.id) || Boolean(getSessionFile('java', entry.id));
                return createGameCard({
                  title: entry.title,
                  platformLabel: entry.platformLabel,
                  genre: entry.publisher,
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
          : h('p', { className: 'csw-empty-state' }, 'Chargement du catalogue Java & Gameloft…')
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

  window.addEventListener('csw:prefs-changed', (e) => {
    const nextMode = e.detail?.viewMode;
    if (nextMode && nextMode !== viewMode) {
      viewMode = nextMode;
      render();
    }
  });

  loadCatalog();
  refreshCachedList();
  render();
  return { element: container, refresh: refreshCachedList };
}
