/**
 * Thèmes matériels authentiques par univers console (WCAG AA+ garanti)
 * Chaque palette associe un fond d'ambiance, une surface, un accent principal,
 * un texte de bouton à fort contraste (>= 5:1) et une signature visuelle matérielle.
 */
export const UNIVERSE_THEMES = {
  all: {
    id: 'all',
    brandName: 'CSW-ARCADE',
    consoleTitle: 'Multi-Plateforme',
    settingsTitle: 'Configuration Unifiée CSW-Arcade',
    settingsSubtitle: 'Inputs, Affichage CRT, Audio & Réseau',
    accentHex: '#22d3ee',
    accentFgHex: '#041014',
    accentTextHex: '#67e8f9',
    badgeLabel: 'MULTI-SYSTÈME',
    hardwareTag: '15 CŒURS',
    motif: 'prism',
    jewels: ['#22d3ee', '#fbbf24', '#60a5fa', '#ef4444'],
    coverGradient: 'from-cyan-950/90 via-slate-950 to-neutral-950',
    coverBorder: 'border-cyan-400/30',
    coverText: 'text-cyan-300',
  },
  arcade: {
    id: 'arcade',
    brandName: 'NEO GEO · ARCADE',
    consoleTitle: 'Arcade & Neo Geo MVS',
    settingsTitle: 'Configuration Matérielle Arcade & Neo Geo',
    settingsSubtitle: 'MVS / AES, Scanlines CRT, Stick Arcade & Netplay',
    accentHex: '#fbbf24',
    accentFgHex: '#140d02',
    accentTextHex: '#fcd34d',
    badgeLabel: 'MVS / MAME',
    hardwareTag: 'SNK · MVS 24-BIT',
    motif: 'neogeo',
    // Les 4 boutons iconiques Neo Geo MVS : A (Rouge), B (Jaune), C (Vert), D (Bleu)
    jewels: ['#ef4444', '#facc15', '#22c55e', '#3b82f6'],
    coverGradient: 'from-amber-950/90 via-stone-950 to-neutral-950',
    coverBorder: 'border-amber-400/35',
    coverText: 'text-amber-300',
  },
  playstation: {
    id: 'playstation',
    brandName: 'PLAYSTATION',
    consoleTitle: 'Univers PlayStation',
    settingsTitle: 'Configuration Matérielle PlayStation',
    settingsSubtitle: 'PS1 · PSP (PPSSPP) · PS Vita (Vita3K), DualShock & Rendu 3D',
    accentHex: '#60a5fa',
    accentFgHex: '#050d1f',
    accentTextHex: '#93c5fd',
    badgeLabel: 'PS1 · PSP · VITA',
    hardwareTag: 'SONY · PSX / PSP / VITA',
    motif: 'playstation',
    // Les 4 symboles iconiques PlayStation : △ (Vert), ○ (Rouge), × (Bleu), □ (Rose)
    symbols: [
      { glyph: '△', color: '#34d399', label: 'Triangle' },
      { glyph: '○', color: '#f87171', label: 'Rond' },
      { glyph: '×', color: '#60a5fa', label: 'Croix' },
      { glyph: '□', color: '#f472b6', label: 'Carré' },
    ],
    jewels: ['#34d399', '#f87171', '#60a5fa', '#f472b6'],
    coverGradient: 'from-blue-950/90 via-slate-950 to-neutral-950',
    coverBorder: 'border-blue-400/35',
    coverText: 'text-blue-300',
  },
  nintendo: {
    id: 'nintendo',
    brandName: 'NINTENDO',
    consoleTitle: 'Univers Nintendo',
    settingsTitle: 'Configuration Matérielle Nintendo',
    settingsSubtitle: 'NES · SNES · GB/GBA · N64, Manette & Filtres Pixel',
    accentHex: '#dc2626',
    accentFgHex: '#ffffff',
    accentTextHex: '#fca5a5',
    badgeLabel: 'FAMICOM · SNES · N64',
    hardwareTag: 'NINTENDO · 8/16/64-BIT',
    motif: 'nintendo',
    // Les 4 boutons Super Famicom / SNES PAL : Rouge, Jaune, Bleu, Vert
    jewels: ['#ef4444', '#facc15', '#3b82f6', '#22c55e'],
    coverGradient: 'from-red-950/90 via-neutral-950 to-neutral-950',
    coverBorder: 'border-red-500/35',
    coverText: 'text-red-300',
  },
  sega: {
    id: 'sega',
    brandName: 'SEGA',
    consoleTitle: 'Univers Sega',
    settingsTitle: 'Configuration Matérielle Sega',
    settingsSubtitle: 'Mega Drive / Genesis · Master System · Game Gear',
    accentHex: '#38bdf8',
    accentFgHex: '#04111c',
    accentTextHex: '#7dd3fc',
    badgeLabel: 'MEGA DRIVE · 16-BIT',
    hardwareTag: 'SEGA · 16-BIT BLAST',
    motif: 'sega',
    jewels: ['#0284c7', '#38bdf8', '#7dd3fc', '#e0f2fe'],
    coverGradient: 'from-sky-950/90 via-slate-950 to-neutral-950',
    coverBorder: 'border-sky-400/35',
    coverText: 'text-sky-300',
  },
  java: {
    id: 'java',
    brandName: 'MOBILE · J2ME',
    consoleTitle: 'Univers Mobile & Java J2ME',
    settingsTitle: 'Configuration Mobile & Java J2ME',
    settingsSubtitle: 'MIDP 2.0 · Clavier T9 / D-Pad Tactile · Écran LCD',
    accentHex: '#f59e0b',
    accentFgHex: '#120b02',
    accentTextHex: '#fcd34d',
    badgeLabel: 'J2ME · MIDP 2.0',
    hardwareTag: 'JAVA MOBILE · .JAR',
    motif: 'java',
    jewels: ['#f59e0b', '#fbbf24', '#84cc16', '#fde047'],
    coverGradient: 'from-amber-950/85 via-zinc-950 to-neutral-950',
    coverBorder: 'border-amber-500/35',
    coverText: 'text-amber-300',
  },
};

export function getUniverseTheme(mode) {
  return UNIVERSE_THEMES[mode] || UNIVERSE_THEMES.all;
}

export function getUniverseFromCore(core = '') {
  const c = String(core || '').toLowerCase();
  if (c === 'j2me' || c === 'java') return 'java';
  if (['psx', 'ps1', 'playstation', 'psp', 'ppsspp', 'psvita'].includes(c)) return 'playstation';
  if (['nes', 'snes', 'gb', 'gbc', 'gba', 'n64', 'nds'].includes(c)) return 'nintendo';
  if (['sega', 'segamd', 'megadrive', 'genesis', 'sms', 'gg', 'sega32x', 'segacd', 'saturn'].includes(c)) return 'sega';
  if (['fbneo', 'neogeo', 'mame2003_plus', 'mame', 'arcade', 'cps1', 'cps2'].includes(c)) return 'arcade';
  return 'all';
}
