/**
 * Sous-mode Consoles Rétro (intégré au Mode Arcade) — remplace console.html et library.html.
 */

import { NINTENDO_CATALOG, RETRO_SYSTEMS, RETRO_EXT_CORE_MAP } from '../data/catalogs.js';
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
import { ensureJSZip, getExtension } from '../services/zip.js';
import {
  autoSearchDownloadAndLaunch,
  getCachedRom,
  listCachedRoms,
  removeCachedRom,
  searchOnlineRoms,
} from '../services/rom-downloader.js';

const RETRO_EXTRACT_EXTS = ['.nes', '.sfc', '.smc', '.gba', '.gb', '.gbc', '.n64', '.z64', '.v64', '.md', '.gen', '.sms', '.gg', '.pce', '.nds'];
const PAGE_SIZE = 48;

export function createArcadeConsolesView({ onSwitchToNeoGeo }) {
  let activeFilter = 'all';
  let search = '';
  let viewMode = loadPrefs().viewMode || 'grid';
  let mobileOpen = false;
  let selectedCore = 'mame2003_plus';
  let zipAutoExtract = true;
  let homebrewSources = [];
  let onlineQuery = '';
  let onlineResults = [];
  let onlineSearching = false;
  let cachedRetroRoms = [];
  let arcadeCatalog = NINTENDO_CATALOG.filter((g) => g.platform === 'n64' || g.platform === 'gba');
  let visibleLimit = PAGE_SIZE;

  async function loadArcadeCatalog() {
    try {
      const res = await fetch('./app/data/arcade-catalog.json');
      if (!res.ok) return;
      const json = await res.json();
      const extra64_32 = NINTENDO_CATALOG.filter((g) => g.platform === 'n64' || g.platform === 'gba');
      arcadeCatalog = [
        ...(Array.isArray(json.neogeo) ? json.neogeo : []),
        ...(Array.isArray(json.mame) ? json.mame : []),
        ...(Array.isArray(json.retro64_32) ? json.retro64_32 : []),
        ...extra64_32,
      ];
      render();
    } catch {}
  }

  const container = h('div', { className: 'csw-view-root' });

  async function loadRetroFile(file, overrideCore) {
    if (!file) return;
    let targetFile = file;
    let ext = getExtension(file.name);

    const isArcadeZip = overrideCore === 'fbneo' || overrideCore === 'mame2003_plus';
    if (ext === 'zip' && zipAutoExtract && !isArcadeZip) {
      try {
        showToast('Analyse de l’archive ZIP…', 'info');
        const JSZip = await ensureJSZip();
        const archive = await JSZip.loadAsync(file);
        const candidates = Object.values(archive.files).filter(
          (f) => !f.dir && !f.name.startsWith('__MACOSX/') && RETRO_EXT_CORE_MAP[getExtension(f.name)]
        );
        if (candidates.length === 1) {
          const item = candidates[0];
          if ((item._data?.uncompressedSize || 0) > 256 * 1024 * 1024) {
            throw new Error('La ROM extraite dépasse la limite de 256 Mo.');
          }
          const blob = await item.async('blob');
          targetFile = new File([blob], item.name.split('/').pop(), { type: 'application/octet-stream' });
          ext = getExtension(targetFile.name);
        }
      } catch (err) {
        showToast(`Extraction ZIP ignorée (${err.message}). Chargement direct…`, 'warn');
      }
    }

    const core = overrideCore || RETRO_EXT_CORE_MAP[ext] || selectedCore;
    if (!RETRO_EXT_CORE_MAP[ext] && !['zip', 'bin'].includes(ext)) {
      showToast(`Extension .${ext} non reconnue pour les consoles rétro.`, 'error');
      return;
    }

    const id = `retro-${targetFile.name.toLowerCase()}`;
    registerSessionFile('retro', id, targetFile, {
      platform: core,
      platformLabel: core.toUpperCase(),
    });
    render();

    launchEmulator({
      title: targetFile.name,
      badge: `${core.toUpperCase()} · EmulatorJS`,
      core,
      fileBlob: targetFile,
      accent: '#00f0ff',
    });
  }

  async function refreshCachedList() {
    cachedRetroRoms = await listCachedRoms('retro');
    render();
  }

  async function runOnlineSearch(queryText) {
    const q = (queryText ?? onlineQuery).trim();
    if (!q) {
      showToast('Entrez le nom d’un jeu à rechercher en ligne.', 'warn');
      return;
    }
    onlineQuery = q;
    onlineSearching = true;
    render();
    try {
      const targetSystem = RETRO_SYSTEMS.some((s) => s.core === activeFilter) ? activeFilter : selectedCore;
      onlineResults = await searchOnlineRoms(q, { system: targetSystem, limit: 12 });
      if (!onlineResults.length) {
        showToast(`Aucune ROM trouvée en ligne pour « ${q} ».`, 'warn');
      }
    } catch (err) {
      showToast(`Erreur recherche en ligne : ${err.message}`, 'error');
    } finally {
      onlineSearching = false;
      render();
    }
  }

  function launchOnlineResult(item, overrideCore) {
    const ext = getExtension(item.filename || '');
    const core = overrideCore || RETRO_EXT_CORE_MAP[ext] || selectedCore;
    const isArcadeZip = core === 'fbneo' || core === 'mame2003_plus';
    autoSearchDownloadAndLaunch({
      id: item.id,
      title: item.title,
      filename: item.filename,
      urls: item.urls,
      mode: 'retro',
      system: core,
      core,
      extractExtensions: zipAutoExtract && !isArcadeZip ? RETRO_EXTRACT_EXTS : [],
      onAfterCache: () => refreshCachedList(),
      onLaunch: (file) => loadRetroFile(file, core),
    });
  }

  async function autoLaunchArcadeEntry(entry) {
    const core = entry.core || entry.platform || 'mame2003_plus';
    const existing = getSessionFile('retro', entry.id);
    if (existing) {
      loadRetroFile(existing, core);
      return;
    }
    const isArcadeZip = core === 'fbneo' || core === 'mame2003_plus';
    await autoSearchDownloadAndLaunch({
      id: entry.id,
      title: entry.title,
      filename: entry.filename,
      urls: entry.urls,
      mode: 'retro',
      system: core,
      core,
      extractExtensions: isArcadeZip ? [] : RETRO_EXTRACT_EXTS,
      onAfterCache: () => refreshCachedList(),
      onLaunch: (file) => loadRetroFile(file, core),
    });
  }

  function render() {
    const imported = listImportedLibrary('retro');
    const q = search.trim().toLowerCase();

    const filteredSystems = RETRO_SYSTEMS.filter((sys) => {
      if (activeFilter !== 'all' && activeFilter !== 'systems' && activeFilter !== sys.core) return false;
      if (!q) return true;
      return `${sys.name} ${sys.detail} ${sys.core}`.toLowerCase().includes(q);
    });

    const filteredImported = imported.filter((item) => {
      if (q && !`${item.title} ${item.filename} ${item.platformLabel}`.toLowerCase().includes(q)) return false;
      return true;
    });

    const filteredSources = homebrewSources.filter((src) => {
      if (src.core === 'psx') return false;
      if (q && !`${src.title} ${src.system} ${src.core}`.toLowerCase().includes(q)) return false;
      return true;
    });

    const filteredCatalog = arcadeCatalog.filter((item) => {
      if (['fbneo', 'mame2003_plus', 'n64', 'gba', 'sega32x'].includes(activeFilter) && item.core !== activeFilter && item.platform !== activeFilter) {
        return false;
      }
      if (activeFilter === 'systems' || activeFilter === 'sources' || activeFilter === 'local') return false;
      if (!q) return true;
      return `${item.title} ${item.platformLabel} ${item.genre} ${item.filename}`.toLowerCase().includes(q);
    });

    const countByCore = (core) => arcadeCatalog.filter((g) => g.core === core || g.platform === core).length;

    const sidebarSections = [
      {
        label: 'Arcade & Rétro',
        items: [
          { id: 'neogeo', icon: 'arcade', label: 'Moteur Neo Geo (181)', badge: 'MVS' },
          { id: 'all', icon: 'gamepad', label: 'Tout le catalogue', badge: arcadeCatalog.length },
          { id: 'fbneo', icon: 'arcade', label: 'Neo Geo MVS (Auto-DL)', badge: countByCore('fbneo') },
          { id: 'mame2003_plus', icon: 'arcade', label: 'MAME 2003-Plus (32/16-bit)', badge: countByCore('mame2003_plus') },
          { id: 'n64', icon: 'gamepad', label: 'Nintendo 64 (64-bit)', badge: countByCore('n64') },
          { id: 'gba', icon: 'handheld', label: 'GBA (32-bit)', badge: countByCore('gba') },
          { id: 'local', icon: 'database', label: 'En cache & locaux', badge: cachedRetroRoms.length + imported.length },
          { id: 'systems', icon: 'settings', label: 'Cœurs supportés', badge: RETRO_SYSTEMS.length },
          { id: 'sources', icon: 'globe', label: 'Sources Homebrew', badge: homebrewSources.filter((s) => s.core !== 'psx').length || '…' },
        ],
      },
      {
        label: 'Consoles supportées',
        items: RETRO_SYSTEMS.slice(0, 8).map((s) => ({
          id: s.core,
          icon: 'playstation',
          label: s.name.split(' (')[0],
          badge: s.core.toUpperCase(),
        })),
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
        if (id === 'neogeo') {
          onSwitchToNeoGeo?.();
          return;
        }
        activeFilter = id;
        visibleLimit = PAGE_SIZE;
        render();
      },
    });

    const header = createViewHeader({
      title: 'ARCADE & CONSOLES RÉTRO',
      countText: `${arcadeCatalog.length} jeux (Neo Geo MVS, MAME 2003-Plus, 64-bit, 32-bit) · ${RETRO_SYSTEMS.length} cœurs`,
      searchValue: search,
      searchPlaceholder: 'Filtrer une console ou une ROM…',
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

    // Barre d'importation / URL directe
    const systemSelect = h(
      'select',
      {
        className: 'csw-select',
        'aria-label': 'Système cible',
        onChange: (e) => {
          selectedCore = e.target.value;
        },
      },
      RETRO_SYSTEMS.map((s) =>
        h('option', { value: s.core, selected: s.core === selectedCore }, `${s.name} (${s.core})`)
      )
    );

    const urlInput = h('input', {
      type: 'url',
      className: 'csw-input',
      placeholder: 'URL directe HTTPS vers une ROM (.nes, .sfc, .gba, .zip…)',
      'aria-label': 'URL directe de ROM',
    });

    const zipToggle = h('input', {
      type: 'checkbox',
      checked: zipAutoExtract,
      onChange: (e) => {
        zipAutoExtract = e.target.checked;
      },
    });

    const dropzone = createDropZone({
      icon: 'folder',
      title: 'Glissez ou sélectionnez votre ROM console',
      subtitle: 'Formats : .nes, .sfc, .smc, .gba, .gb, .gbc, .n64, .z64, .md, .sms, .gg, .pce, .nds, .zip',
      accept: '.nes,.sfc,.smc,.gba,.gb,.gbc,.n64,.z64,.v64,.md,.gen,.bin,.sms,.gg,.pce,.nds,.zip',
      onFiles: (files) => loadRetroFile(files[0]),
    });

    const launchPanel = h(
      'section',
      { className: 'csw-action-panel' },
      dropzone,
      h(
        'div',
        { className: 'csw-action-side' },
        h(
          'div',
          { className: 'csw-field-row' },
          h('label', { className: 'csw-field-label' }, 'Système manuel (si .zip / .bin)', systemSelect)
        ),
        h(
          'div',
          { className: 'csw-url-row' },
          urlInput,
          h(
            'button',
            {
              type: 'button',
              className: 'csw-btn csw-btn--primary',
              onClick: () => {
                const raw = urlInput.value.trim();
                try {
                  const u = new URL(raw);
                  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Protocole HTTP/HTTPS requis');
                  const fname = decodeURIComponent(u.pathname.split('/').pop() || 'rom');
                  const core = RETRO_EXT_CORE_MAP[getExtension(fname)] || selectedCore;
                  autoSearchDownloadAndLaunch({
                    id: `url-${u.href.toLowerCase()}`,
                    title: fname,
                    filename: fname,
                    urls: [u.href],
                    mode: 'retro',
                    system: core,
                    core,
                    extractExtensions: zipAutoExtract ? RETRO_EXTRACT_EXTS : null,
                    onAfterCache: () => refreshCachedList(),
                    onLaunch: (file) => loadRetroFile(file, core),
                  });
                } catch {
                  showToast('Entrez une URL HTTP/HTTPS valide vers un fichier ROM compatible CORS.', 'warn');
                }
              },
            },
            'Charger URL'
          )
        ),
        h(
          'label',
          { className: 'csw-checkbox-row' },
          zipToggle,
          h('span', {}, 'Extraire automatiquement les archives .zip mono-ROM avant lancement')
        )
      )
    );

    const onlineSearchInput = h('input', {
      type: 'search',
      className: 'csw-input',
      value: onlineQuery,
      placeholder: 'Rechercher une ROM en ligne (ex: Mario, Sonic, Zelda, Contra…) — téléchargement auto',
      'aria-label': 'Recherche ROM en ligne',
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
        h('strong', {}, 'Recherche & Téléchargement Automatique (Archive.org + Cache IndexedDB)'),
        h('span', { className: 'csw-muted' }, 'Comme en mode Arcade : cliquez pour télécharger la ROM et lancer le jeu automatiquement')
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

    const content = h('div', { className: 'csw-scroll-content' }, launchPanel, onlineSearchBar);

    if (onlineResults.length > 0) {
      content.append(
        h(
          'div',
          { className: 'csw-section-head' },
          h('h3', {}, `Résultats en ligne (${onlineResults.length})`),
          h('span', { className: 'csw-section-note' }, 'Cliquez sur « ▶ Télécharger & Jouer » pour lancer directement')
        ),
        h(
          'div',
          { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
          onlineResults.map((item) => {
            const ext = getExtension(item.filename || '');
            const guessedCore = RETRO_EXT_CORE_MAP[ext] || selectedCore;
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
                onClick: () => launchOnlineResult(item, guessedCore),
              },
            });
          })
        )
      );
    }

    const filteredCached = cachedRetroRoms.filter(
      (item) => !q || `${item.title} ${item.filename} ${item.core}`.toLowerCase().includes(q)
    );

    if ((activeFilter === 'local' || activeFilter === 'all') && filteredCached.length > 0) {
      content.append(
        h(
          'div',
          { className: 'csw-section-head' },
          h('h3', {}, `ROMs en cache persistant (${filteredCached.length})`),
          h('span', { className: 'csw-section-note' }, 'Stockées dans IndexedDB — lancement instantané sans re-téléchargement')
        ),
        h(
          'div',
          { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
          filteredCached.map((item) =>
            createGameCard({
              title: item.title,
              platformLabel: (item.core || item.platform || 'RETRO').toUpperCase(),
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
                  loadRetroFile(f, item.core);
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

    if (activeFilter === 'local' || (activeFilter === 'all' && filteredImported.length > 0)) {
      content.append(
        h('div', { className: 'csw-section-head' }, h('h3', {}, 'ROMs importées durant la session')),
        filteredImported.length
          ? h(
              'div',
              { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
              filteredImported.map((item) => {
                const file = getSessionFile('retro', item.id);
                return createGameCard({
                  title: item.title,
                  platformLabel: item.platformLabel,
                  filename: item.filename,
                  sizeLabel: formatBytes(item.size),
                  description: `Fichier local : ${item.filename}`,
                  statusLabel: file ? 'Prêt en session' : 'Ré-importer requis',
                  statusTone: file ? 'ready' : 'warn',
                  viewMode,
                  primaryAction: {
                    label: file ? 'Lancer' : 'Relier le fichier',
                    onClick: () => {
                      if (file) {
                        loadRetroFile(file, item.platform);
                      } else {
                        const picker = h('input', {
                          type: 'file',
                          accept: '.nes,.sfc,.smc,.gba,.gb,.gbc,.n64,.z64,.v64,.md,.gen,.bin,.sms,.gg,.pce,.nds,.zip',
                          onChange: () => picker.files?.[0] && loadRetroFile(picker.files[0], item.platform),
                        });
                        picker.click();
                      }
                    },
                  },
                  secondaryAction: {
                    label: 'Retirer',
                    onClick: () => {
                      removeImportedEntry('retro', item.id);
                      render();
                    },
                  },
                });
              })
            )
          : h('p', { className: 'csw-empty-state' }, 'Aucune ROM importée pour le moment.')
      );
    }

    if (activeFilter !== 'systems' && activeFilter !== 'sources' && activeFilter !== 'local') {
      const visibleItems = filteredCatalog.slice(0, visibleLimit);
      content.append(
        h(
          'div',
          { className: 'csw-section-head' },
          h('h3', {}, `Catalogue Arcade & 32/64-bit (${filteredCatalog.length} jeux vérifiés)`),
          h('span', { className: 'csw-section-note' }, 'Neo Geo MVS · MAME 2003-Plus · 64-bit · 32-bit — Lancement en 1 clic')
        ),
        filteredCatalog.length
          ? h(
              'div',
              { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
              visibleItems.map((entry) => {
                const isCached = cachedRetroRoms.some((c) => c.id === entry.id) || Boolean(getSessionFile('retro', entry.id));
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
                    onClick: () => autoLaunchArcadeEntry(entry),
                  },
                });
              })
            )
          : h('p', { className: 'csw-empty-state' }, 'Aucun jeu Arcade ne correspond à votre filtre.')
      );

      if (filteredCatalog.length > visibleLimit) {
        content.append(
          h(
            'div',
            { style: 'display:flex;justify-content:center;padding:12px 0;' },
            h(
              'button',
              {
                type: 'button',
                className: 'csw-btn csw-btn--ghost',
                onClick: () => {
                  visibleLimit += PAGE_SIZE;
                  render();
                },
              },
              `Afficher plus (${filteredCatalog.length - visibleLimit} restants)`
            )
          )
        );
      }
    }

    if (activeFilter === 'systems' || (activeFilter !== 'local' && activeFilter !== 'sources' && filteredSystems.length > 0)) {
      content.append(
        h('div', { className: 'csw-section-head' }, h('h3', {}, `Systèmes compatibles (${RETRO_SYSTEMS.length} cœurs EmulatorJS)`)),
        h(
          'div',
          { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
          filteredSystems.map((sys) =>
            createGameCard({
              title: sys.name,
              platformLabel: sys.core.toUpperCase(),
              description: sys.detail,
              formats: sys.extensions,
              noCover: true,
              statusLabel: 'Prêt (Web)',
              statusTone: 'ready',
              viewMode,
              primaryAction: {
                label: 'Choisir une ROM',
                onClick: () => {
                  selectedCore = sys.core;
                  const picker = h('input', {
                    type: 'file',
                    accept: [...sys.extensions, '.zip'].join(','),
                    onChange: () => picker.files?.[0] && loadRetroFile(picker.files[0], sys.core),
                  });
                  picker.click();
                },
              },
            })
          )
        )
      );
    }

    if (activeFilter === 'sources' || activeFilter === 'all') {
      content.append(
        h(
          'div',
          { className: 'csw-section-head' },
          h('h3', {}, 'Sources Homebrew & Open-Source (Découverte)'),
          h('span', { className: 'csw-section-note' }, 'Liens vérifiés itch.io / GitHub (sans ROMs commerciales)')
        ),
        h(
          'div',
          { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
          filteredSources.map((src) =>
            createGameCard({
              title: src.title,
              platformLabel: src.system,
              description: 'Catalogue externe de créateurs homebrew et projets open-source.',
              noCover: true,
              statusLabel: 'Externe',
              statusTone: 'neutral',
              viewMode,
              primaryAction: {
                label: 'Parcourir',
                onClick: () => window.open(src.url, '_blank', 'noopener,noreferrer'),
              },
              secondaryAction: {
                label: 'Importer ROM',
                onClick: () => {
                  selectedCore = src.core;
                  const picker = h('input', {
                    type: 'file',
                    accept: '.nes,.sfc,.smc,.gba,.gb,.gbc,.n64,.z64,.v64,.md,.gen,.bin,.sms,.gg,.pce,.nds,.zip',
                    onChange: () => picker.files?.[0] && loadRetroFile(picker.files[0], src.core),
                  });
                  picker.click();
                },
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
  loadArcadeCatalog();

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
