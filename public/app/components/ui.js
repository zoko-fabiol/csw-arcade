/**
 * Composants UI partagés pour garantir une cohérence absolue entre les 4 modes.
 */

import { icon as svgIcon } from './icons.js';

export function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function showToast(message, tone = 'info') {
  const host = document.getElementById('csw-toast-host');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `csw-toast csw-toast--${tone}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  host.append(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 260);
  }, 3400);
}

/**
 * Construit un élément DOM avec classes et texte optionnel sans HTML brut non sécurisé.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'className') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'disabled' || k === 'checked' || k === 'hidden' || k === 'selected') {
      el[k] = Boolean(v);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      el.append(document.createTextNode(String(child)));
    } else {
      el.append(child);
    }
  }
  return el;
}

/**
 * Crée une zone de glisser-déposer uniforme pour ROMs, disques, exécutables ou médias.
 */
export function createDropZone({
  icon,
  title,
  subtitle,
  accept,
  multiple = false,
  directory = false,
  onFiles,
}) {
  const input = h('input', {
    type: 'file',
    accept: accept || undefined,
    multiple,
  });
  if (directory) input.setAttribute('webkitdirectory', '');

  const zone = h(
    'label',
    { className: 'csw-dropzone' },
    h('span', { className: 'csw-dropzone-icon' }, icon instanceof Node ? icon : svgIcon(typeof icon === 'string' && /^[a-zA-Z]+$/.test(icon) ? icon : 'folder', 32)),
    h('strong', {}, title),
    h('small', {}, subtitle),
    input
  );

  input.addEventListener('change', () => {
    if (input.files && input.files.length) {
      onFiles([...input.files]);
      input.value = '';
    }
  });

  for (const ev of ['dragenter', 'dragover']) {
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add('is-dragging');
    });
  }
  for (const ev of ['dragleave', 'drop']) {
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove('is-dragging');
    });
  }
  zone.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) {
      onFiles([...e.dataTransfer.files]);
    }
  });

  return zone;
}

const LIBRETRO_SYSTEM_MAP = [
  [/mega\s*drive|genesis|segamd|picodrive/i, 'Sega - Mega Drive - Genesis'],
  [/master\s*system|segams|smsplus/i, 'Sega - Master System - Mark III'],
  [/game\s*gear|segagg/i, 'Sega - Game Gear'],
  [/saturn|yabause/i, 'Sega - Saturn'],
  [/super\s*nintendo|snes/i, 'Nintendo - Super Nintendo Entertainment System'],
  [/\bnes\b|famicom|fceumm|nestopia/i, 'Nintendo - Nintendo Entertainment System'],
  [/nintendo\s*64|\bn64\b|mupen64/i, 'Nintendo - Nintendo 64'],
  [/game\s*boy\s*advance|\bgba\b|mgba|vba/i, 'Nintendo - Game Boy Advance'],
  [/game\s*boy\s*color|\bgbc\b/i, 'Nintendo - Game Boy Color'],
  [/game\s*boy|\bgb\b|gambatte/i, 'Nintendo - Game Boy'],
  [/nintendo\s*ds|\bnds\b|desmume|melonds/i, 'Nintendo - Nintendo DS'],
  [/\bpsp\b|ppsspp|portable/i, 'Sony - PlayStation Portable'],
  [/playstation|\bps1\b|\bpsx\b|pcsx/i, 'Sony - PlayStation'],
  [/arcade|fbneo|mame|neo\s*geo/i, 'FBNeo - Arcade Games'],
];

function sanitizeLibretroName(name) {
  return String(name || '').replace(/[&*/:`<>?\\|]/g, '_').trim();
}

function resolveCoverCandidates({ title, platformLabel, filename, imageUrl }) {
  const candidates = [];
  if (imageUrl) candidates.push(imageUrl);

  const label = String(platformLabel || '');
  const match = LIBRETRO_SYSTEM_MAP.find(([re]) => re.test(label));
  if (!match || !title) return candidates;

  const systemDir = encodeURIComponent(match[1]);
  const base = `https://thumbnails.libretro.com/${systemDir}/Named_Boxarts/`;

  const names = [];
  if (filename) {
    const noExt = String(filename).replace(/\.(zip|7z|rar|bin|iso|chd|pbp|md|gen|nes|sfc|smc|gba|gbc|gb|z64|n64|nds|sms|gg)$/i, '');
    if (noExt) names.push(sanitizeLibretroName(noExt));
  }
  const cleanTitle = sanitizeLibretroName(String(title).replace(/\s*\([^)]*\)\s*$/g, ''));
  if (cleanTitle) {
    names.push(`${cleanTitle} (USA)`, `${cleanTitle} (Europe)`, `${cleanTitle} (USA, Europe)`, `${cleanTitle} (World)`, cleanTitle);
  }

  const seen = new Set();
  for (const n of names) {
    if (!n || seen.has(n)) continue;
    seen.add(n);
    candidates.push(`${base}${encodeURIComponent(n)}.png`);
  }
  return candidates;
}

function createCoverElement({ title, platformLabel, filename, imageUrl }) {
  const candidates = resolveCoverCandidates({ title, platformLabel, filename, imageUrl });
  const initials = String(title || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || 'CSW';

  const fallback = h(
    'div',
    { className: 'csw-card-cover-fallback', 'aria-hidden': 'true' },
    h('span', { className: 'csw-card-cover-initials' }, initials),
    platformLabel ? h('span', { className: 'csw-card-cover-plat' }, platformLabel) : null
  );

  const wrap = h('div', { className: 'csw-card-cover' }, fallback);
  if (!candidates.length) return wrap;

  let idx = 0;
  const img = h('img', {
    className: 'csw-card-cover-img',
    alt: title ? `Jaquette ${title}` : 'Jaquette du jeu',
    loading: 'lazy',
    decoding: 'async',
    src: candidates[0],
  });

  img.addEventListener('load', () => {
    wrap.classList.add('has-img');
  });
  img.addEventListener('error', () => {
    idx += 1;
    if (idx < candidates.length) {
      img.src = candidates[idx];
    } else {
      img.remove();
    }
  });

  wrap.append(img);
  return wrap;
}

/**
 * Carte de jeu standardisée (utilisée dans PlayStation, Xbox, Consoles, Mini-Jeux).
 */
export function createGameCard({
  title,
  platformLabel,
  year,
  genre,
  players,
  sizeLabel,
  description,
  statusLabel,
  statusTone = 'neutral',
  formats = [],
  filename,
  imageUrl,
  noCover = false,
  primaryAction,
  secondaryAction,
  viewMode = 'grid',
}) {
  const badges = [
    platformLabel ? h('span', { className: 'csw-badge csw-badge--accent' }, platformLabel) : null,
    statusLabel ? h('span', { className: `csw-badge csw-badge--${statusTone}` }, statusLabel) : null,
  ];

  const metaParts = [year, genre, players, sizeLabel].filter(Boolean).join(' · ');

  const actions = h(
    'div',
    { className: 'csw-card-actions' },
    primaryAction
      ? h(
          'button',
          {
            type: 'button',
            className: 'csw-btn csw-btn--primary',
            onClick: primaryAction.onClick,
          },
          primaryAction.label
        )
      : null,
    secondaryAction
      ? h(
          'button',
          {
            type: 'button',
            className: 'csw-btn csw-btn--ghost',
            onClick: secondaryAction.onClick,
          },
          secondaryAction.label
        )
      : null
  );

  const cover = noCover ? null : createCoverElement({ title, platformLabel, filename, imageUrl });

  return h(
    'article',
    { className: `csw-card ${viewMode === 'list' ? 'csw-card--list' : ''}` },
    cover,
    h('div', { className: 'csw-card-top' }, badges),
    h(
      'div',
      { className: 'csw-card-body' },
      h('h3', { className: 'csw-card-title' }, title),
      metaParts ? h('div', { className: 'csw-card-meta' }, metaParts) : null,
      description ? h('p', { className: 'csw-card-desc' }, description) : null,
      formats.length
        ? h(
            'div',
            { className: 'csw-format-list' },
            formats.map((f) => h('span', { className: 'csw-format-chip' }, f))
          )
        : null
    ),
    actions
  );
}

/**
 * Barre d'en-tête de vue uniforme (Titre, compteur, recherche, vue Grille/Liste, action rapide).
 */
export function createViewHeader({
  title,
  countText,
  searchValue = '',
  searchPlaceholder = 'Rechercher…',
  onSearch,
  viewMode,
  onViewMode,
  extraButton,
  onToggleSidebar,
}) {
  const searchInput = h('input', {
    type: 'search',
    className: 'csw-search-input',
    value: searchValue,
    placeholder: searchPlaceholder,
    'aria-label': searchPlaceholder,
  });
  if (onSearch) {
    searchInput.addEventListener('input', () => onSearch(searchInput.value));
  }

  const viewToggle = onViewMode
    ? h(
        'div',
        { className: 'csw-view-toggle', role: 'group', 'aria-label': 'Mode d’affichage' },
        h(
          'button',
          {
            type: 'button',
            className: `csw-icon-btn ${viewMode === 'grid' ? 'is-active' : ''}`,
            title: 'Affichage en grille',
            'aria-label': 'Affichage en grille',
            onClick: () => onViewMode('grid'),
          },
          svgIcon('grid', 15)
        ),
        h(
          'button',
          {
            type: 'button',
            className: `csw-icon-btn ${viewMode === 'list' ? 'is-active' : ''}`,
            title: 'Affichage en liste',
            'aria-label': 'Affichage en liste',
            onClick: () => onViewMode('list'),
          },
          svgIcon('list', 15)
        )
      )
    : null;

  return h(
    'header',
    { className: 'csw-view-header' },
    h(
      'div',
      { className: 'csw-view-title-wrap' },
      onToggleSidebar
        ? h(
            'button',
            {
              type: 'button',
              className: 'csw-mobile-sidebar-btn',
              'aria-label': 'Ouvrir les catégories',
              onClick: onToggleSidebar,
            },
            svgIcon('list', 16)
          )
        : null,
      h(
        'div',
        {},
        h('h2', { className: 'csw-view-title' }, h('span', { className: 'csw-dot' }), title),
        h('p', { className: 'csw-view-subtitle' }, countText)
      )
    ),
    h(
      'div',
      { className: 'csw-view-controls' },
      onSearch
        ? h('div', { className: 'csw-search-box' }, h('span', { className: 'csw-search-icon' }, svgIcon('search', 14)), searchInput)
        : null,
      extraButton || null,
      viewToggle
    )
  );
}
