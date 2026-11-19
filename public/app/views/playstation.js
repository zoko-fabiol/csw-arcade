/**
 * Mode 2 — PlayStation : PS1 (lecteur HLE navigateur unifié), PSP & PS2 (préparation Phase 2 / Pont Natif).
 */

import { PLAYSTATION_CATALOG } from '../data/catalogs.js';
import { createModeLayout } from '../components/shell-layout.js';
import { createDropZone, createGameCard, createViewHeader, h, showToast } from '../components/ui.js';
import { launchEmulator } from '../services/stage.js';
import {
  fetchHomebrewCatalog,
  formatBytes,
  getSessionFile,
  listImportedLibrary,
  loadPrefs,
  registerSessionFile,
  removeImportedEntry,
  savePrefs,
} from '../services/storage.js';
import { getExtension } from '../services/zip.js';
import {
  autoSearchDownloadAndLaunch,
  getCachedRom,
  listCachedRoms,
  removeCachedRom,
  searchOnlineRoms,
} from '../services/rom-downloader.js';

const PS1_ACCEPTED = '.chd,.pbp,.bin,.img,.iso,.cue,.zip,.m3u,.ccd,.toc,.mdf';
const PS1_EXTRACT_EXTS = ['.chd', '.pbp', '.bin', '.img', '.iso'];

export function createPlayStationView() {
  let activeFilter = 'all';
  let search = '';
  let viewMode = loadPrefs().viewMode || 'grid';
  let mobileOpen = false;
  let homebrewSources = [];
  let cueHelperNotice = null;
  let onlineQuery = '';
  let onlineResults = [];
  let onlineSearching = false;
  let cachedPsRoms = [];

  const container = h('div', { className: 'csw-view-root' });

  function launchPlayStationFile(file, customTitle) {
    if (!file) return;
    const ext = getExtension(file.name);
    const valid = ['chd', 'pbp', 'bin', 'img', 'iso', 'cue', 'zip', 'm3u', 'ccd', 'toc', 'mdf'];

    if (!valid.includes(ext)) {
      showToast(`Format .${ext} non supporté pour PlayStation. Utilisez .chd, .pbp, .bin ou .iso.`, 'error');
      return;
    }

    if (['cue', 'm3u', 'ccd', 'toc'].includes(ext)) {
      cueHelperNotice = `Le fichier « ${file.name} » est un descripteur de pistes (.${ext}). Dans le navigateur, sélectionnez plutôt l’image complète convertie en .chd ou .pbp (format mono-fichier recommandé).`;
      showToast('Fichier multi-pistes détecté — consultez le guide affiché ci-dessous.', 'warn');
      render();
      return;
    }

    cueHelperNotice = null;
    let payload = file;
    if (ext === 'iso') {
      // Certaines images ISO PS1 nécessitent une détection en .bin pour PCSX ReARMed
      payload = new File([file], file.name.replace(/\.iso$/i, '.bin'), {
        type: 'application/octet-stream',
      });
    }

    const id = `ps1-${file.name.toLowerCase()}`;
    registerSessionFile('playstation', id, file, {
      title: customTitle || file.name.replace(/\.[^.]+$/, ''),
      platform: 'ps1',
      platformLabel: 'PS1',
    });
    render();

    launchEmulator({
      title: customTitle || file.name,
      badge: 'PS1 · PCSX ReARMed HLE',
      core: 'psx',
      fileBlob: payload,
      accent: '#3b82f6',
    });
  }

  async function refreshCachedList() {
    cachedPsRoms = await listCachedRoms('playstation');
    render();
  }

  async function runOnlineSearch(queryText) {
    const q = (queryText ?? onlineQuery).trim();
    if (!q) {
      showToast('Entrez le nom d’un jeu PlayStation à rechercher.', 'warn');
      return;
    }
    onlineQuery = q;
    onlineSearching = true;
    render();
    try {
      onlineResults = await searchOnlineRoms(q, { system: 'ps1', limit: 12 });
      if (!onlineResults.length) {
        showToast(`Aucun disque PS1 trouvé en ligne pour « ${q} ».`, 'warn');
      }
    } catch (err) {
      showToast(`Erreur recherche en ligne : ${err.message}`, 'error');
    } finally {
      onlineSearching = false;
      render();
    }
  }

  function autoDownloadAndLaunchEntry(entry) {
    if (entry.platform === 'psp') {
      showToast(
        `${entry.title} (PSP) nécessite le futur moteur PPSSPP WASM (non encore intégré dans cette version).`,
        'info'
      );
      return;
    }
    if (entry.platform === 'ps2') {
      showToast(
        `${entry.title} (PS2) nécessite le Pont Natif Desktop (PCSX2).`,
        'info'
      );
      return;
    }

    const existing = getSessionFile('playstation', entry.id);
    if (existing) {
      launchPlayStationFile(existing, entry.title);
      return;
    }

    autoSearchDownloadAndLaunch({
      id: entry.id,
      title: entry.title,
      searchQuery: entry.title,
      filename: entry.filename,
      urls: entry.urls || [],
      mode: 'playstation',
      system: 'ps1',
      core: 'psx',
      extractExtensions: PS1_EXTRACT_EXTS,
      onAfterCache: () => refreshCachedList(),
      onLaunch: (file) => launchPlayStationFile(file, entry.title),
    });
  }

  function pickAndLaunchForEntry(entry) {
    if (entry.platform === 'psp') {
      showToast(
        `${entry.title} (PSP) sera téléchargeable et jouable en Phase 2 avec le module OPFS.`,
        'info'
      );
      return;
    }
    if (entry.platform === 'ps2') {
      showToast(
        `${entry.title} (PS2) nécessite le Pont Natif Desktop (PCSX2) ou le futur module Phase 2.`,
        'info'
      );
      return;
    }
    const existing = getSessionFile('playstation', entry.id);
    if (existing) {
      launchPlayStationFile(existing, entry.title);
      return;
    }
    const picker = h('input', {
      type: 'file',
      accept: PS1_ACCEPTED,
      onChange: () => {
        const f = picker.files?.[0];
        if (f) launchPlayStationFile(f, entry.title);
      },
    });
    picker.click();
  }

  function render() {
    const imported = listImportedLibrary('playstation');
    const q = search.trim().toLowerCase();

    const filteredCatalog = PLAYSTATION_CATALOG.filter((item) => {
      if (['ps1', 'psp', 'ps2'].includes(activeFilter) && item.platform !== activeFilter) return false;
      if (q && !`${item.title} ${item.genre} ${item.platformLabel}`.toLowerCase().includes(q)) return false;
      return true;
    });

    const filteredImported = imported.filter(
      (item) => !q || `${item.title} ${item.filename}`.toLowerCase().includes(q)
    );

    const psHomebrew = homebrewSources.filter(
      (s) => s.core === 'psx' && (!q || `${s.title} ${s.system}`.toLowerCase().includes(q))
    );

    const sidebarSections = [
      {
        label: 'Systèmes PlayStation',
        items: [
          { id: 'all', icon: 'playstation', label: 'Tout le catalogue', badge: PLAYSTATION_CATALOG.length },
          { id: 'ps1', icon: 'disc', label: 'PlayStation 1 (Web)', badge: PLAYSTATION_CATALOG.length },
        ],
      },
      {
        label: 'Bibliothèque & Découverte',
        items: [
          { id: 'local', icon: 'database', label: 'Mes jeux importés', badge: imported.length },
          { id: 'sources', icon: 'globe', label: 'Homebrew PS1', badge: psHomebrew.length || '…' },
          { id: 'guide', icon: 'book', label: 'Guide CHD & BIOS HLE' },
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

    const importBtn = h(
      'button',
      {
        type: 'button',
        className: 'csw-btn csw-btn--primary',
        onClick: () => {
          const picker = h('input', {
            type: 'file',
            accept: PS1_ACCEPTED,
            onChange: () => picker.files?.[0] && launchPlayStationFile(picker.files[0]),
          });
          picker.click();
        },
      },
      '+ Importer un disque'
    );

    const header = createViewHeader({
      title: 'UNIVERS PLAYSTATION',
      countText: `${PLAYSTATION_CATALOG.length} jeux PS1 vérifiés en ligne (.chd) · Téléchargement automatique & Cache IndexedDB`,
      searchValue: search,
      searchPlaceholder: 'Rechercher un jeu PlayStation…',
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
      extraButton: importBtn,
      onToggleSidebar: () => {
        mobileOpen = !mobileOpen;
        render();
      },
    });

    const content = h('div', { className: 'csw-scroll-content' });

    const dropzone = createDropZone({
      icon: 'disc',
      title: 'Lancer un jeu PlayStation 1 depuis votre appareil',
      subtitle: 'Formats recommandés : .chd ou .pbp (mono-fichier) · Accepte aussi .bin, .img, .iso, .zip · Aucun BIOS Sony requis',
      accept: PS1_ACCEPTED,
      onFiles: (files) => launchPlayStationFile(files[0]),
    });

    const infoCard = h(
      'div',
      { className: 'csw-info-card' },
      h('h4', {}, 'Compatibilité & Phase 2'),
      h(
        'p',
        {},
        'PS1 tourne directement dans le navigateur via PCSX ReARMed HLE. Les fichiers restent 100 % locaux sur votre appareil.'
      ),
      h(
        'p',
        { className: 'csw-muted' },
        'Les fiches ci-dessous intègrent déjà la structure pour le téléchargement automatique des ROMs/CHD en Phase 2.'
      )
    );

    const onlineSearchInput = h('input', {
      type: 'search',
      className: 'csw-input',
      value: onlineQuery,
      placeholder: 'Rechercher un jeu PS1 en ligne (ex: Tekken 3, Metal Gear, Crash…) — téléchargement auto',
      'aria-label': 'Recherche ROM PS1 en ligne',
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
        h('strong', {}, 'Recherche & Téléchargement Automatique PS1 (Archive.org + Cache IndexedDB)'),
        h('span', { className: 'csw-muted' }, 'Comme en mode Arcade : cliquez pour télécharger l’image disque (.chd / .pbp / .zip) et lancer le jeu')
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

    content.append(h('section', { className: 'csw-action-panel' }, dropzone, infoCard), onlineSearchBar);

    if (onlineResults.length > 0) {
      content.append(
        h(
          'div',
          { className: 'csw-section-head' },
          h('h3', {}, `Résultats PS1 en ligne (${onlineResults.length})`),
          h('span', { className: 'csw-section-note' }, 'Téléchargement direct + cache IndexedDB')
        ),
        h(
          'div',
          { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
          onlineResults.map((item) =>
            createGameCard({
              title: item.title,
              platformLabel: 'PS1',
              filename: item.filename,
              sizeLabel: item.size ? formatBytes(item.size) : 'Auto',
              description: `Fichier : ${item.filename} · Source : ${item.sourceLabel}`,
              statusLabel: 'En ligne · Auto-DL',
              statusTone: 'accent',
              viewMode,
              primaryAction: {
                label: 'Télécharger & Jouer',
                onClick: () => autoDownloadAndLaunchEntry({ ...item, platform: 'ps1' }),
              },
            })
          )
        )
      );
    }

    const filteredCached = cachedPsRoms.filter(
      (item) => !q || `${item.title} ${item.filename}`.toLowerCase().includes(q)
    );

    if ((activeFilter === 'local' || activeFilter === 'all') && filteredCached.length > 0) {
      content.append(
        h(
          'div',
          { className: 'csw-section-head' },
          h('h3', {}, `Disques en cache persistant (${filteredCached.length})`),
          h('span', { className: 'csw-section-note' }, 'Stockés dans IndexedDB — lancement instantané')
        ),
        h(
          'div',
          { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
          filteredCached.map((item) =>
            createGameCard({
              title: item.title,
              platformLabel: 'PS1',
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
                    showToast('Disque absent du cache.', 'warn');
                    refreshCachedList();
                    return;
                  }
                  const f = new File([cached.data], cached.filename || item.filename, {
                    type: 'application/octet-stream',
                  });
                  launchPlayStationFile(f, item.title);
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

    if (cueHelperNotice) {
      content.append(
        h(
          'div',
          { className: 'csw-alert csw-alert--warn' },
          h('strong', {}, 'Fichier multi-pistes détecté (.cue / .m3u) : '),
          cueHelperNotice
        )
      );
    }

    if (activeFilter === 'guide') {
      content.append(
        h(
          'section',
          { className: 'csw-guide-panel' },
          h('h3', {}, 'Guide des formats PlayStation'),
          h(
            'ul',
            {},
            h('li', {}, h('strong', {}, '.CHD / .PBP (Recommandé) : '), 'regroupe toutes les pistes audio et données en un seul fichier compressé compatible navigateur.'),
            h('li', {}, h('strong', {}, '.BIN / .IMG / .ISO : '), 'fonctionne pour les jeux à piste unique ; les jeux multi-pistes CDDA doivent être convertis en .CHD.'),
            h('li', {}, h('strong', {}, 'Mode HLE sans BIOS : '), 'émule le firmware PS1 sans fichier BIOS externe (compatibilité élevée mais variable selon les titres).')
          )
        )
      );
    }

    if (activeFilter === 'local' || (activeFilter === 'all' && filteredImported.length > 0)) {
      content.append(
        h('div', { className: 'csw-section-head' }, h('h3', {}, 'Mes jeux PlayStation importés')),
        filteredImported.length
          ? h(
              'div',
              { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
              filteredImported.map((item) => {
                const file = getSessionFile('playstation', item.id);
                return createGameCard({
                  title: item.title,
                  platformLabel: item.platformLabel,
                  sizeLabel: formatBytes(item.size),
                  description: `Image locale : ${item.filename}`,
                  statusLabel: file ? 'Prêt à jouer' : 'Fichier à resélectionner',
                  statusTone: file ? 'ready' : 'warn',
                  viewMode,
                  primaryAction: {
                    label: file ? '▶ Lancer' : 'Sélectionner',
                    onClick: () => {
                      if (file) launchPlayStationFile(file, item.title);
                      else {
                        const picker = h('input', {
                          type: 'file',
                          accept: PS1_ACCEPTED,
                          onChange: () => picker.files?.[0] && launchPlayStationFile(picker.files[0], item.title),
                        });
                        picker.click();
                      }
                    },
                  },
                  secondaryAction: {
                    label: 'Retirer',
                    onClick: () => {
                      removeImportedEntry('playstation', item.id);
                      render();
                    },
                  },
                });
              })
            )
          : h('p', { className: 'csw-empty-state' }, 'Aucun jeu PlayStation importé dans cette session.')
      );
    }

    if (!['local', 'sources', 'guide'].includes(activeFilter)) {
      content.append(
        h(
          'div',
          { className: 'csw-section-head' },
          h('h3', {}, 'Catalogue PlayStation'),
          h('span', { className: 'csw-section-note' }, 'Cliquez sur « Importer & Jouer » pour vos disques PS1 ou préparez la Phase 2')
        ),
        h(
          'div',
          { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
          filteredCatalog.map((entry) => {
            const local = getSessionFile('playstation', entry.id);
            const isCached = Boolean(local) || cachedPsRoms.some((c) => c.id === entry.id);
            const statusLabel = isCached
              ? 'Prêt (Cache / Local)'
              : entry.platform === 'ps1'
                ? 'PS1 Web · Auto-DL'
                : entry.platform === 'psp'
                  ? 'Phase 2 · PSP'
                  : 'Pont Natif / Phase 2';
            const statusTone = isCached
              ? 'ready'
              : entry.platform === 'ps1'
                ? 'accent'
                : 'neutral';

            return createGameCard({
              title: entry.title,
              platformLabel: entry.platformLabel,
              filename: entry.filename,
              year: entry.year,
              genre: entry.genre,
              players: entry.players,
              sizeLabel: entry.estimatedSize,
              description: entry.description,
              formats: entry.formats,
              statusLabel,
              statusTone,
              viewMode,
              primaryAction: {
                label: isCached
                  ? 'Lancer'
                  : entry.platform === 'ps1'
                    ? 'Télécharger & Jouer'
                    : 'Phase 2',
                onClick: () => autoDownloadAndLaunchEntry(entry),
              },
              secondaryAction:
                entry.platform === 'ps1'
                  ? {
                      label: 'Importer local',
                      onClick: () => pickAndLaunchForEntry(entry),
                    }
                  : undefined,
            });
          })
        )
      );
    }

    if (activeFilter === 'sources' || activeFilter === 'all') {
      content.append(
        h('div', { className: 'csw-section-head' }, h('h3', {}, 'Projets & Homebrew PlayStation 1')),
        h(
          'div',
          { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
          psHomebrew.map((src) =>
            createGameCard({
              title: src.title,
              platformLabel: 'PS1 Homebrew',
              description: 'Répertoire communautaire de créations PlayStation open-source.',
              statusLabel: 'Externe',
              statusTone: 'neutral',
              viewMode,
              primaryAction: {
                label: 'Parcourir',
                onClick: () => window.open(src.url, '_blank', 'noopener,noreferrer'),
              },
            })
          )
        )
      );
    }

    main.append(header, content);
    container.replaceChildren(root);
  }

  fetchHomebrewCatalog().then((items) => {
    homebrewSources = items;
    render();
  });
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
