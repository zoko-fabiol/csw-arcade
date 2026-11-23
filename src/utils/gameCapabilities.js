/**
 * Règle métier unique déterminant si un jeu est éligible au multijoueur en ligne
 * (salons Fightcade 2, défis P2P, synchronisation Rollback, présence multi).
 *
 * Module pur ESM sans dépendance DOM afin d'être partagé entre le client React et le backend Node.
 */

export const SOLO_ONLY_CORES = new Set([
  'j2me',
  'java',
  'gb',
  'gbc',
  'gba',
  'mgba',
  'gambatte',
  'segagg',
  'nds',
  'melonds',
  'desmume',
  'dos',
  'xbox',
]);

export const NETPLAY_CAPABLE_CORES = new Set([
  'fbneo',
  'arcade',
  'mame2003_plus',
  'nes',
  'fceumm',
  'nestopia',
  'snes',
  'snes9x',
  'n64',
  'mupen64plus_next',
  'parallel-n64',
  'segamd',
  'genesis_plus_gx',
  'picodrive',
  'segams',
  'sega32x',
  'pce',
  'psx',
  'ps1',
  'pcsx_rearmed',
]);

/**
 * Détecte de façon exhaustive tout jeu Java / Gameloft / J2ME.
 */
export function isJ2meGame(entry, options = {}) {
  if (options?.mode === 'java') return true;
  if (!entry || typeof entry !== 'object') return false;
  if (entry.kind === 'j2me') return true;

  const core = String(entry.core || options?.core || '').trim().toLowerCase();
  const platform = String(entry.platform || options?.platform || '').trim().toLowerCase();
  if (core === 'j2me' || core === 'java' || platform === 'j2me' || platform === 'java') {
    return true;
  }

  const filename = String(entry.filename || '').trim().toLowerCase();
  if (filename.endsWith('.jar') || filename.endsWith('.jad')) {
    return true;
  }

  const id = String(entry.id || entry.gameId || '').trim().toLowerCase();
  if (id.startsWith('java-')) {
    return true;
  }

  const platformLabel = String(entry.platformLabel || '');
  if (/\b(j2me|gameloft|java)\b/i.test(platformLabel)) {
    return true;
  }

  return false;
}

/**
 * Extrait le nombre maximal de joueurs supporté depuis le champ `players`
 * (ex: '1J' -> 1, '1–2J' -> 2, '1-4J' -> 4, 2 -> 2).
 */
export function parseMaxPlayers(playersValue) {
  if (typeof playersValue === 'number') {
    return Number.isFinite(playersValue) ? playersValue : 0;
  }
  if (typeof playersValue !== 'string') return 0;
  const matches = playersValue.match(/\d+/g);
  if (!matches || matches.length === 0) return 0;
  return Math.max(...matches.map((n) => Number(n) || 0));
}

/**
 * Indique si un jeu peut accéder aux salons Fightcade 2 et au multijoueur en ligne P2P.
 * - Tout jeu Java / Gameloft (J2ME) retourne toujours false.
 * - Toute console portable mono-écran sans câble Link (GB/GBC/GBA/Game Gear/NDS) retourne false.
 * - Tout import local sans fiche catalogue ou résultat externe non qualifié retourne false.
 * - Tout jeu marqué supportsMultiplayer: false ou '1J' retourne false.
 */
export function supportsOnlineMultiplayer(entry, options = {}) {
  if (!entry || typeof entry !== 'object') return false;
  if (options?.isLocalImport || entry.isLocalImport) return false;
  if (entry.isGlobal || entry.gameId === 'global-lobby' || entry.id === 'global-lobby') {
    return false;
  }

  if (isJ2meGame(entry, options)) return false;

  const core = String(entry.core || options?.core || '').trim().toLowerCase();
  const platform = String(entry.platform || options?.platform || '').trim().toLowerCase();

  if (SOLO_ONLY_CORES.has(core) || SOLO_ONLY_CORES.has(platform)) {
    return false;
  }

  const effectiveSystem = core || platform;
  if (effectiveSystem && !NETPLAY_CAPABLE_CORES.has(effectiveSystem)) {
    return false;
  }

  if (entry.supportsMultiplayer === false) return false;
  if (entry.supportsMultiplayer === true) return true;

  return parseMaxPlayers(entry.players) >= 2;
}

/**
 * Libellé lisible pour les badges de catalogue (ex: 'Solo' ou '1–2J · En ligne').
 */
export function getMultiplayerBadgeMeta(entry, options = {}) {
  const isMulti = supportsOnlineMultiplayer(entry, options);
  if (!isMulti) {
    return {
      isMultiplayer: false,
      shortLabel: 'Solo',
      detailLabel: isJ2meGame(entry, options) ? 'Solo (J2ME)' : 'Solo (1J)',
    };
  }

  const maxPlayers = parseMaxPlayers(entry?.players);
  const rawPlayers =
    typeof entry?.players === 'string' && entry.players.trim()
      ? entry.players.trim()
      : maxPlayers >= 2
        ? `1–${maxPlayers}J`
        : '1–2J';

  return {
    isMultiplayer: true,
    shortLabel: `${rawPlayers} · En ligne`,
    detailLabel: `${rawPlayers} · Multijoueur en ligne`,
  };
}
