/**
 * Mode 4 — PC : MS-DOS (js-dos v8), Mini-Jeux Web (Canvas), Inspecteur Windows (.EXE) et Lecteur Média.
 * Remplace exe.html et games.html dans une interface 100 % cohérente en français.
 */

import { PC_MINIGAMES } from '../data/catalogs.js';
import { createModeLayout } from '../components/shell-layout.js';
import { createDropZone, createGameCard, createViewHeader, h, showToast } from '../components/ui.js';
import { launchDos, launchMedia, launchMiniGame } from '../services/stage.js';
import { formatBytes } from '../services/storage.js';
import { ensureJSZip } from '../services/zip.js';

const MAX_DOS_BYTES = 160 * 1024 * 1024;
const MAX_DOS_FILES = 600;
const DOS_RUN_EXT = /\.(exe|com|bat)$/i;

function sanitizeDosPath(rawPath) {
  const p = String(rawPath || '').replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+/g, '/');
  const bits = p.split('/').filter(Boolean);
  if (!bits.length || bits.some((x) => x === '.' || x === '..' || /[\x00-\x1f"'<>|:*?]/.test(x)) || p.length > 200) {
    throw new Error('Un fichier contient un nom de chemin non sécurisé.');
  }
  return bits.join('/');
}

async function inspectBinaryHeader(bytes) {
  const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (d.length < 2 || d[0] !== 0x4d || d[1] !== 0x5a) {
    return 'Pas un exécutable MZ standard (peut être un fichier .COM ou .BAT).';
  }
  if (d.length >= 64) {
    const offset = (d[60] | (d[61] << 8) | (d[62] << 16) | (d[63] << 24)) >>> 0;
    if (offset + 6 < d.length && d[offset] === 0x50 && d[offset + 1] === 0x45 && d[offset + 2] === 0 && d[offset + 3] === 0) {
      const m = d[offset + 4] | (d[offset + 5] << 8);
      if (m === 0x8664) return 'Windows 64-bit (PE x64)';
      if (m === 0x14c) return 'Windows 32-bit (PE x86)';
      return 'Exécutable Windows PE';
    }
    if (offset + 2 < d.length && d[offset] === 0x4e && d[offset + 1] === 0x45) {
      return 'Windows 16-bit (NE)';
    }
  }
  return 'Exécutable MS-DOS (MZ) probable';
}

function buildDosboxConfig(exePath) {
  const pieces = exePath.split('/');
  const exe = pieces.pop();
  let cmd = '@echo off\nmount c .\nc:\n';
  for (const part of pieces) cmd += `cd "${part}"\n`;
  return `[sdl]\nfullscreen=false\n[dosbox]\nmemsize=32\n[cpu]\ncore=auto\ncycles=auto\n[autoexec]\n${cmd}"${exe}"\n`;
}

export function createPcView({ initialSubTab } = {}) {
  let activeTab = ['dos', 'minigames', 'windows', 'media'].includes(initialSubTab) ? initialSubTab : 'dos';
  let mobileOpen = false;
  let search = '';

  // État MS-DOS
  let dosEntries = [];
  let dosBundle = null;
  let dosExecutables = [];
  let selectedExe = '';
  let dosStatus = 'Prêt. Déposez un programme DOS (.exe, .com, .bat, .zip, .jsdos) ou essayez la démo.';

  // État Inspecteur Windows
  let winStatus = 'Aucun fichier inspecté. L’analyse de l’en-tête PE reste 100 % locale sur votre appareil.';

  const container = h('div', { className: 'csw-view-root' });

  async function prepareDosFiles(fileList) {
    const items = [...fileList];
    if (!items.length) return;
    if (items.length > MAX_DOS_FILES) {
      dosStatus = `Trop de fichiers (maximum ${MAX_DOS_FILES}).`;
      render();
      return;
    }

    dosStatus = 'Lecture des fichiers locaux…';
    render();

    try {
      let entries = [];
      let bundle = null;

      if (items.length === 1 && /\.(zip|jsdos)$/i.test(items[0].name)) {
        const f = items[0];
        if (f.size > MAX_DOS_BYTES) throw new Error('L’archive dépasse 160 Mo.');
        const JSZip = await ensureJSZip();
        const archive = await JSZip.loadAsync(f);
        const all = Object.values(archive.files).filter((x) => !x.dir && !x.name.startsWith('__MACOSX/'));
        if (all.length > MAX_DOS_FILES) throw new Error('L’archive contient trop de fichiers.');

        if (all.some((x) => sanitizeDosPath(x.name) === '.jsdos/dosbox.conf') || /\.jsdos$/i.test(f.name)) {
          bundle = f;
        } else {
          let total = 0;
          for (const member of all) {
            const p = sanitizeDosPath(member.name);
            if (p.startsWith('.')) continue;
            total += member._data?.uncompressedSize || 0;
            if (total > MAX_DOS_BYTES) throw new Error('L’archive décompressée dépasse 160 Mo.');
            entries.push({ path: p, bytes: new Uint8Array(await member.async('uint8array')) });
          }
        }
      } else {
        let total = 0;
        for (const f of items) {
          const name = sanitizeDosPath(f.webkitRelativePath || f.name);
          total += f.size;
          if (total > MAX_DOS_BYTES) throw new Error('Les fichiers dépassent 160 Mo.');
          entries.push({ path: name, bytes: new Uint8Array(await f.arrayBuffer()) });
        }
      }

      if (!bundle && !entries.length) throw new Error('Aucun fichier exploitable trouvé.');

      if (bundle) {
        dosBundle = bundle;
        dosEntries = [];
        dosExecutables = [];
        selectedExe = 'bundle';
        dosStatus = `Bundle prêt : ${bundle.name}`;
      } else {
        const execs = entries.filter((x) => DOS_RUN_EXT.test(x.path));
        if (!execs.length) throw new Error('Aucun exécutable DOS (.exe, .com, .bat) trouvé.');
        const preferred =
          execs.find((x) => /\.(com|bat)$/i.test(x.path)) ||
          execs.find((x) => !/setup|install|uninst|config/i.test(x.path)) ||
          execs[0];
        dosBundle = null;
        dosEntries = entries;
        dosExecutables = execs;
        selectedExe = preferred.path;
        dosStatus = `${entries.length} fichier(s) chargés. Sélectionnez l’exécutable et cliquez sur Lancer.`;
      }
    } catch (err) {
      dosBundle = null;
      dosEntries = [];
      dosExecutables = [];
      selectedExe = '';
      dosStatus = `Erreur : ${err.message}`;
    }
    render();
  }

  async function runDosSelection() {
    if (!dosBundle && !dosEntries.length) {
      showToast('Sélectionnez d’abord un programme DOS ou une archive.', 'warn');
      return;
    }
    if (dosBundle) {
      launchDos({
        title: dosBundle.name,
        mode: 'bundle',
        bundleBlob: dosBundle,
      });
      return;
    }

    const chosen = dosEntries.find((x) => x.path === selectedExe);
    if (chosen && /\.exe$/i.test(chosen.path)) {
      const format = await inspectBinaryHeader(chosen.bytes);
      if (format.startsWith('Windows')) {
        winStatus = `${chosen.path} · ${format} détecté depuis l’onglet MS-DOS. Les binaires Windows ne tournent pas dans DOSBox ; utilisez Boxedwine / ExeBrowser ci-dessous.`;
        activeTab = 'windows';
        showToast(`${format} détecté — bascule vers l’onglet Windows.`, 'warn');
        render();
        return;
      }
    }

    launchDos({
      title: selectedExe,
      mode: 'files',
      dosboxConf: buildDosboxConfig(selectedExe),
      initFs: dosEntries.map((x) => ({ path: x.path, contents: x.bytes })),
    });
  }

  async function inspectWindowsExe(file) {
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
      const kind = await inspectBinaryHeader(bytes);
      winStatus = `${file.name} (${formatBytes(file.size)}) · ${kind}. Pour les anciens programmes Windows 32-bit compatibles, ouvrez l’émulateur Boxedwine / ExeBrowser et resélectionnez le fichier.`;
    } catch (err) {
      winStatus = `Impossible d’inspecter le fichier : ${err.message}`;
    }
    render();
  }

  function renderDosPanel() {
    const exeSelect = h(
      'select',
      {
        className: 'csw-select',
        disabled: Boolean(dosBundle),
        'aria-label': 'Exécutable DOS à lancer',
        onChange: (e) => {
          selectedExe = e.target.value;
        },
      },
      dosBundle
        ? [h('option', { value: 'bundle', selected: true }, `Bundle .jsdos (${dosBundle.name})`)]
        : dosExecutables.map((e) => h('option', { value: e.path, selected: e.path === selectedExe }, e.path))
    );

    const panel = h(
      'div',
      { className: 'csw-pc-stack' },
      h(
        'section',
        { className: 'csw-action-panel' },
        createDropZone({
          icon: '⌨',
          title: 'Choisir un programme DOS (.exe, .com, .bat, .zip, .jsdos)',
          subtitle: 'Tout reste local dans votre navigateur · Moteur js-dos v8 (DOSBox WebAssembly)',
          accept: '.exe,.com,.bat,.zip,.jsdos',
          multiple: true,
          onFiles: prepareDosFiles,
        }),
        createDropZone({
          icon: '📁',
          title: 'Ou choisir un dossier de jeu complet',
          subtitle: 'Recommandé si le jeu nécessite des fichiers de données à côté du .EXE',
          directory: true,
          multiple: true,
          onFiles: prepareDosFiles,
        })
      ),
      dosBundle || dosExecutables.length
        ? h(
            'div',
            { className: 'csw-selection-box' },
            h(
              'div',
              { className: 'csw-selection-head' },
              h('strong', {}, 'Exécutable prêt au lancement'),
              h('span', { className: 'csw-muted' }, dosBundle ? dosBundle.name : `${dosEntries.length} fichier(s)`)
            ),
            h(
              'div',
              { className: 'csw-url-row' },
              exeSelect,
              h(
                'button',
                { type: 'button', className: 'csw-btn csw-btn--primary', onClick: runDosSelection },
                '▶ Lancer dans le lecteur'
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'csw-btn csw-btn--ghost',
                  onClick: () => {
                    dosBundle = null;
                    dosEntries = [];
                    dosExecutables = [];
                    selectedExe = '';
                    dosStatus = 'Sélection effacée.';
                    render();
                  },
                },
                'Effacer'
              )
            )
          )
        : null,
      h(
        'div',
        { className: 'csw-pc-actions-bar' },
        h(
          'button',
          {
            type: 'button',
            className: 'csw-btn csw-btn--primary',
            onClick: () => launchDos({ title: 'Digger (Démo DOS)', mode: 'demo' }),
          },
          '▶ Essayer la démo gratuite Digger (MS-DOS)'
        ),
        h('span', { className: 'csw-status-line' }, dosStatus)
      )
    );

    return panel;
  }

  function renderMiniGamesPanel() {
    const q = search.trim().toLowerCase();
    const list = PC_MINIGAMES.filter(
      (g) => !q || `${g.title} ${g.genre} ${g.description}`.toLowerCase().includes(q)
    );
    return h(
      'div',
      { className: 'csw-pc-stack' },
      h(
        'div',
        { className: 'csw-cards-grid' },
        list.map((g) =>
          createGameCard({
            title: g.title,
            platformLabel: g.badge,
            genre: g.genre,
            description: `${g.description} — ${g.controls}`,
            statusLabel: 'Jouable immédiatement',
            statusTone: 'ready',
            primaryAction: {
              label: '▶ Jouer maintenant',
              onClick: () => launchMiniGame({ id: g.id, title: g.title }),
            },
          })
        )
      )
    );
  }

  function renderWindowsPanel() {
    return h(
      'div',
      { className: 'csw-pc-stack' },
      h(
        'section',
        { className: 'csw-action-panel' },
        createDropZone({
          icon: '▣',
          title: 'Inspecter un exécutable Windows (.EXE)',
          subtitle: 'Identifie localement 32-bit (PE x86), 64-bit (PE x64), 16-bit (NE) ou DOS (MZ) sans aucun envoi réseau',
          accept: '.exe,.com',
          onFiles: (files) => inspectWindowsExe(files[0]),
        }),
        h(
          'div',
          { className: 'csw-info-card' },
          h('h4', {}, 'Compatibilité Win32 navigateur'),
          h('p', {}, h('strong', {}, 'Meilleures chances : '), 'petits utilitaires et jeux 2D Windows 32-bit classiques (1995–2008).'),
          h('p', { className: 'csw-muted' }, 'Les logiciels 64-bit modernes (ou VLC récent) ne fonctionnent pas dans Boxedwine Web.')
        )
      ),
      h('div', { className: 'csw-selection-box' }, h('strong', {}, 'Résultat de l’inspection locale : '), winStatus),
      h(
        'div',
        { className: 'csw-pc-actions-bar' },
        h(
          'a',
          {
            className: 'csw-btn csw-btn--primary',
            href: 'https://www.exebrowser.com/',
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          '↗ Ouvrir l’émulateur Windows ExeBrowser'
        ),
        h(
          'a',
          {
            className: 'csw-btn csw-btn--ghost',
            href: 'https://www.boxedwine.org/',
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          'À propos de Boxedwine'
        )
      )
    );
  }

  function renderMediaPanel() {
    return h(
      'div',
      { className: 'csw-pc-stack' },
      h(
        'section',
        { className: 'csw-action-panel' },
        createDropZone({
          icon: '♫',
          title: 'Lire une vidéo ou un fichier audio local',
          subtitle: 'MP4, WebM, MP3, WAV, OGG, FLAC, M4A (selon les codecs du navigateur) · Aucun upload',
          accept: 'video/*,audio/*,.mkv,.flac,.m4a,.mov,.avi',
          onFiles: (files) => files[0] && launchMedia({ file: files[0] }),
        }),
        h(
          'div',
          { className: 'csw-info-card' },
          h('h4', {}, 'Lecteur HTML5 intégré'),
          h('p', {}, 'Les fichiers s’ouvrent directement dans le Lecteur Plein Écran Unifié sans quitter la plateforme.'),
          h('p', { className: 'csw-muted' }, 'Certains conteneurs MKV/AVI dépendent du support natif de votre navigateur.')
        )
      )
    );
  }

  function render() {
    const sidebarSections = [
      {
        label: 'Espace PC Unifié',
        items: [
          { id: 'dos', icon: '⌨', label: 'MS-DOS (js-dos)', badge: 'WASM' },
          { id: 'minigames', icon: '🕹️', label: 'Mini-Jeux Web', badge: PC_MINIGAMES.length },
          { id: 'windows', icon: '▣', label: 'Windows (.EXE)', badge: 'PE' },
          { id: 'media', icon: '▶', label: 'Lecteur Média', badge: 'AV' },
        ],
      },
      {
        label: 'Actions rapides',
        items: [
          { id: 'demo-digger', icon: '⚡', label: 'Démo Digger (DOS)' },
        ],
      },
    ];

    const { root, main } = createModeLayout({
      sidebarSections,
      activeKey: activeTab,
      mobileOpen,
      onCloseMobile: () => {
        mobileOpen = false;
        render();
      },
      onSelect: (id) => {
        if (id === 'demo-digger') {
          launchDos({ title: 'Digger (Démo DOS)', mode: 'demo' });
          return;
        }
        activeTab = id;
        render();
      },
    });

    const titles = {
      dos: ['LABORATOIRE MS-DOS', 'Exécutez vos .EXE, .COM, .BAT, .ZIP et bundles .JSDOS dans DOSBox WASM'],
      minigames: ['MINI-JEUX WEB NATIFS', 'Jeux HTML5 Canvas jouables instantanément au clavier ou au tactile'],
      windows: ['PROGRAMMES WINDOWS CLASSIQUES', 'Inspection locale d’en-tête PE/MZ et lancement Boxedwine / ExeBrowser'],
      media: ['LECTEUR MÉDIA LOCAL', 'Lecture vidéo et audio directe dans le lecteur unifié'],
    };
    const [viewTitle, viewSub] = titles[activeTab];

    const header = createViewHeader({
      title: viewTitle,
      countText: viewSub,
      searchValue: search,
      searchPlaceholder: activeTab === 'minigames' ? 'Filtrer les mini-jeux…' : 'Filtrer…',
      onSearch: activeTab === 'minigames' ? (val) => { search = val; render(); } : null,
      onToggleSidebar: () => {
        mobileOpen = !mobileOpen;
        render();
      },
    });

    const content = h('div', { className: 'csw-scroll-content' });
    if (activeTab === 'dos') content.append(renderDosPanel());
    else if (activeTab === 'minigames') content.append(renderMiniGamesPanel());
    else if (activeTab === 'windows') content.append(renderWindowsPanel());
    else content.append(renderMediaPanel());

    main.append(header, content);
    container.replaceChildren(root);
  }

  render();
  return {
    element: container,
    refresh: render,
    setSubTab: (tab) => {
      if (['dos', 'minigames', 'windows', 'media'].includes(tab)) {
        activeTab = tab;
        render();
      }
    },
  };
}
