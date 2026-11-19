/**
 * Mode 3 — Xbox : Catalogue Xbox Original & Xbox 360, indexation ISO/XISO locale,
 * Pont Natif (/api/launch-native) et Testeur temps réel de manette Xbox.
 */

import { XBOX_CATALOG } from '../data/catalogs.js';
import { createModeLayout } from '../components/shell-layout.js';
import { createDropZone, createGameCard, createViewHeader, h, showToast } from '../components/ui.js';
import {
  formatBytes,
  listImportedLibrary,
  loadPrefs,
  registerSessionFile,
  removeImportedEntry,
  savePrefs,
} from '../services/storage.js';
import { getExtension } from '../services/zip.js';

const XBOX_ACCEPTED = '.iso,.xiso,.xbe,.xex,.zip';

export function createXboxView() {
  let activeFilter = 'all';
  let search = '';
  let viewMode = 'grid';
  let mobileOpen = false;
  let gamepadRaf = 0;

  const container = h('div', { className: 'csw-view-root' });

  function stopGamepadPoll() {
    if (gamepadRaf) {
      cancelAnimationFrame(gamepadRaf);
      gamepadRaf = 0;
    }
  }

  function indexLocalXboxFile(file) {
    if (!file) return;
    const ext = getExtension(file.name);
    if (!['iso', 'xiso', 'xbe', 'xex', 'zip'].includes(ext)) {
      showToast(`Format .${ext} non reconnu pour Xbox (.iso, .xiso, .xbe, .xex).`, 'error');
      return;
    }
    const is360 = ext === 'xex' || /360/i.test(file.name);
    const id = `xbox-local-${file.name.toLowerCase()}-${file.size}`;
    registerSessionFile('xbox', id, file, {
      title: file.name.replace(/\.[^.]+$/, ''),
      platform: is360 ? 'xbox360' : 'xbox',
      platformLabel: is360 ? 'Xbox 360' : 'Xbox Original',
    });
    showToast(`Image « ${file.name} » indexée dans votre bibliothèque Xbox locale.`, 'info');
    render();
  }

  async function triggerNativeLaunch(entry) {
    const prefs = loadPrefs();
    const endpoint = prefs.nativeBridgeUrl || '/api/launch-native';
    showToast(`Envoi de la requête vers le Pont Natif (${endpoint})…`, 'info');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: entry.platform || 'xbox',
          game: { id: entry.id, title: entry.title, filename: entry.filename || '' },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      showToast(`Lancement natif démarré pour ${entry.title}.`, 'info');
    } catch (err) {
      showToast(
        `Pont Natif non connecté (${err.message}). En mode navigateur pur, Xemu/Xenia ou un serveur local dédié est requis.`,
        'warn'
      );
    }
  }

  function buildGamepadTester() {
    const padStatus = h('div', { className: 'csw-pad-status' }, 'Branchez une manette Xbox (USB / Bluetooth) et appuyez sur un bouton…');
    const buttonsMap = [
      { idx: 0, label: 'A', cls: 'is-a' },
      { idx: 1, label: 'B', cls: 'is-b' },
      { idx: 2, label: 'X', cls: 'is-x' },
      { idx: 3, label: 'Y', cls: 'is-y' },
      { idx: 4, label: 'LB' },
      { idx: 5, label: 'RB' },
      { idx: 6, label: 'LT' },
      { idx: 7, label: 'RT' },
      { idx: 8, label: 'View' },
      { idx: 9, label: 'Menu' },
      { idx: 12, label: '↑' },
      { idx: 13, label: '↓' },
      { idx: 14, label: '←' },
      { idx: 15, label: '→' },
    ];

    const btnNodes = new Map();
    const grid = h(
      'div',
      { className: 'csw-xbox-btn-grid' },
      buttonsMap.map((b) => {
        const node = h('div', { className: `csw-xbox-key ${b.cls || ''}` }, b.label);
        btnNodes.set(b.idx, node);
        return node;
      })
    );

    const axesInfo = h('div', { className: 'csw-axes-readout' }, 'Sticks : X 0.00 / Y 0.00 · RX 0.00 / RY 0.00');

    const poll = () => {
      if (!container.isConnected || activeFilter !== 'gamepad') {
        gamepadRaf = 0;
        return;
      }
      const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
      if (pads.length > 0) {
        const pad = pads[0];
        padStatus.textContent = `Manette détectée : ${pad.id}`;
        for (const [idx, node] of btnNodes.entries()) {
          const btn = pad.buttons[idx];
          const pressed = Boolean(btn && (btn.pressed || btn.value > 0.25));
          node.classList.toggle('is-pressed', pressed);
        }
        const ax = (i) => (pad.axes[i] || 0).toFixed(2);
        axesInfo.textContent = `Stick G : (${ax(0)}, ${ax(1)}) · Stick D : (${ax(2)}, ${ax(3)})`;
      } else {
        padStatus.textContent = 'Aucune manette détectée — appuyez sur A/Start pour réveiller le contrôleur.';
      }
      gamepadRaf = requestAnimationFrame(poll);
    };

    gamepadRaf = requestAnimationFrame(poll);

    return h(
      'section',
      { className: 'csw-guide-panel' },
      h('h3', {}, 'Testeur Manette Xbox en direct (Gamepad API)'),
      padStatus,
      grid,
      axesInfo
    );
  }

  function render() {
    stopGamepadPoll();
    const imported = listImportedLibrary('xbox');
    const q = search.trim().toLowerCase();

    const filteredCatalog = XBOX_CATALOG.filter((item) => {
      if (['xbox', 'xbox360'].includes(activeFilter) && item.platform !== activeFilter) return false;
      if (q && !`${item.title} ${item.genre} ${item.platformLabel}`.toLowerCase().includes(q)) return false;
      return true;
    });

    const filteredImported = imported.filter(
      (item) => !q || `${item.title} ${item.filename}`.toLowerCase().includes(q)
    );

    const sidebarSections = [
      {
        label: 'Systèmes Xbox',
        items: [
          { id: 'all', icon: '🟢', label: 'Tous les jeux', badge: XBOX_CATALOG.length },
          { id: 'xbox', icon: '🟩', label: 'Xbox Original', badge: XBOX_CATALOG.filter((g) => g.platform === 'xbox').length },
          { id: 'xbox360', icon: '⚪', label: 'Xbox 360', badge: XBOX_CATALOG.filter((g) => g.platform === 'xbox360').length },
          { id: 'local', icon: '💾', label: 'Mes images locales', badge: imported.length },
        ],
      },
      {
        label: 'Matériel & Pont Natif',
        items: [
          { id: 'bridge', icon: '🔌', label: 'Pont Natif Desktop' },
          { id: 'gamepad', icon: '🎮', label: 'Testeur Manette Xbox' },
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

    const addImageBtn = h(
      'button',
      {
        type: 'button',
        className: 'csw-btn csw-btn--primary',
        onClick: () => {
          const picker = h('input', {
            type: 'file',
            accept: XBOX_ACCEPTED,
            onChange: () => picker.files?.[0] && indexLocalXboxFile(picker.files[0]),
          });
          picker.click();
        },
      },
      '+ Indexer ISO / XISO'
    );

    const header = createViewHeader({
      title: 'UNIVERS XBOX & XBOX 360',
      countText: 'Catalogue structuré · Indexation locale · Pont Natif Desktop & Phase 2',
      searchValue: search,
      searchPlaceholder: 'Rechercher un jeu Xbox ou 360…',
      onSearch: (val) => {
        search = val;
        render();
      },
      viewMode,
      onViewMode: (m) => {
        viewMode = m;
        render();
      },
      extraButton: addImageBtn,
      onToggleSidebar: () => {
        mobileOpen = !mobileOpen;
        render();
      },
    });

    const content = h('div', { className: 'csw-scroll-content' });

    const dropzone = createDropZone({
      icon: '🟢',
      title: 'Indexer une image Xbox / Xbox 360 locale',
      subtitle: 'Formats : .iso, .xiso, .xbe, .xex · Enregistré dans votre bibliothèque locale pour lancement Pont Natif',
      accept: XBOX_ACCEPTED,
      onFiles: (files) => indexLocalXboxFile(files[0]),
    });

    const statusInfo = h(
      'div',
      { className: 'csw-info-card' },
      h('h4', {}, 'Architecture d’exécution Xbox'),
      h(
        'p',
        {},
        'Aucun émulateur Xbox / 360 n’existe en WebAssembly pur côté navigateur. Les jeux Xbox se lancent via votre Pont Natif Desktop (Xemu / Xenia sur /api/launch-native) ou futur streaming.'
      ),
      h(
        'p',
        { className: 'csw-muted' },
        'Les fiches catalogue sont déjà prêtes pour accueillir le gestionnaire de téléchargement de la Phase 2.'
      )
    );

    content.append(h('section', { className: 'csw-action-panel' }, dropzone, statusInfo));

    if (activeFilter === 'gamepad') {
      content.append(buildGamepadTester());
    }

    if (activeFilter === 'bridge') {
      const prefs = loadPrefs();
      const bridgeInput = h('input', {
        type: 'text',
        className: 'csw-input',
        value: prefs.nativeBridgeUrl || '/api/launch-native',
        'aria-label': 'Endpoint du Pont Natif',
      });
      content.append(
        h(
          'section',
          { className: 'csw-guide-panel' },
          h('h3', {}, 'Configuration du Pont Natif Desktop (/api/launch-native)'),
          h(
            'p',
            {},
            'Lorsqu’un wrapper Desktop (Electron / serveur local Xemu-Xenia) écoute cet endpoint, le bouton « Lancer » déclenche directement votre émulateur natif avec le jeu sélectionné.'
          ),
          h(
            'div',
            { className: 'csw-url-row' },
            bridgeInput,
            h(
              'button',
              {
                type: 'button',
                className: 'csw-btn csw-btn--primary',
                onClick: () => {
                  savePrefs({ nativeBridgeUrl: bridgeInput.value.trim() || '/api/launch-native' });
                  showToast('Endpoint du Pont Natif sauvegardé.', 'info');
                },
              },
              'Enregistrer'
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'csw-btn csw-btn--ghost',
                onClick: () => triggerNativeLaunch({ id: 'ping', title: 'Test Pont Natif', platform: 'xbox' }),
              },
              'Tester la connexion'
            )
          )
        )
      );
    }

    if (activeFilter === 'local' || (activeFilter === 'all' && filteredImported.length > 0)) {
      content.append(
        h('div', { className: 'csw-section-head' }, h('h3', {}, 'Mes images Xbox indexées en local')),
        filteredImported.length
          ? h(
              'div',
              { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
              filteredImported.map((item) =>
                createGameCard({
                  title: item.title,
                  platformLabel: item.platformLabel,
                  sizeLabel: formatBytes(item.size),
                  description: `Fichier local : ${item.filename}`,
                  statusLabel: 'Indexé · Pont Natif',
                  statusTone: 'ready',
                  viewMode,
                  primaryAction: {
                    label: '▶ Lancer (Pont Natif)',
                    onClick: () => triggerNativeLaunch(item),
                  },
                  secondaryAction: {
                    label: 'Retirer',
                    onClick: () => {
                      removeImportedEntry('xbox', item.id);
                      render();
                    },
                  },
                })
              )
            )
          : h('p', { className: 'csw-empty-state' }, 'Aucune image Xbox indexée pour le moment.')
      );
    }

    if (!['local', 'bridge', 'gamepad'].includes(activeFilter)) {
      content.append(
        h(
          'div',
          { className: 'csw-section-head' },
          h('h3', {}, 'Catalogue Xbox & Xbox 360'),
          h('span', { className: 'csw-section-note' }, 'Prêt pour Pont Natif Desktop & futur système de téléchargement Phase 2')
        ),
        h(
          'div',
          { className: `csw-cards-grid ${viewMode === 'list' ? 'is-list' : ''}` },
          filteredCatalog.map((entry) =>
            createGameCard({
              title: entry.title,
              platformLabel: entry.platformLabel,
              year: entry.year,
              genre: entry.genre,
              players: entry.players,
              sizeLabel: entry.estimatedSize,
              description: entry.description,
              formats: entry.formats,
              statusLabel: 'Pont Natif / Phase 2',
              statusTone: 'accent',
              viewMode,
              primaryAction: {
                label: '▶ Lancer (Pont Natif)',
                onClick: () => triggerNativeLaunch(entry),
              },
              secondaryAction: {
                label: '⬇ Télécharger (Bientôt)',
                onClick: () =>
                  showToast(
                    `Le téléchargement de « ${entry.title} » sera activé en Phase 2.`,
                    'info'
                  ),
              },
            })
          )
        )
      );
    }

    main.append(header, content);
    container.replaceChildren(root);
  }

  render();
  return {
    element: container,
    refresh: render,
    onHide: stopGamepadPoll,
  };
}
