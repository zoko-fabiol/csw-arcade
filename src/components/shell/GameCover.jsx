import React, { useState, useMemo } from 'react';

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
    const noExt = String(filename).replace(
      /\.(zip|7z|rar|bin|iso|chd|pbp|md|gen|nes|sfc|smc|gba|gbc|gb|z64|n64|nds|sms|gg)$/i,
      ''
    );
    if (noExt) names.push(sanitizeLibretroName(noExt));
  }
  const cleanTitle = sanitizeLibretroName(String(title).replace(/\s*\([^)]*\)\s*$/g, ''));
  if (cleanTitle) {
    names.push(
      `${cleanTitle} (USA)`,
      `${cleanTitle} (Europe)`,
      `${cleanTitle} (USA, Europe)`,
      `${cleanTitle} (World)`,
      cleanTitle
    );
  }

  const seen = new Set();
  for (const n of names) {
    if (!n || seen.has(n)) continue;
    seen.add(n);
    candidates.push(`${base}${encodeURIComponent(n)}.png`);
  }
  return candidates;
}

export function GameCover({ title, platformLabel, filename, imageUrl, compact = false }) {
  const candidates = useMemo(
    () => resolveCoverCandidates({ title, platformLabel, filename, imageUrl }),
    [title, platformLabel, filename, imageUrl]
  );

  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const initials = useMemo(() => {
    const parts = String(title || '?').split(/\s+/).filter(Boolean).slice(0, 2);
    return parts.map((w) => w[0]?.toUpperCase() || '').join('') || 'CSW';
  }, [title]);

  const isJ2me = /java|j2me|gameloft/i.test(String(platformLabel || '')) || /\.jar$/i.test(String(filename || ''));
  const currentSrc = idx < candidates.length ? candidates[idx] : null;

  return (
    <div
      className={`relative overflow-hidden rounded-lg border ${
        isJ2me
          ? 'border-amber-500/30 bg-gradient-to-br from-amber-950/60 via-neutral-900 to-neutral-950'
          : 'border-white/10 bg-gradient-to-br from-cyan-950/40 via-neutral-900 to-neutral-950'
      } flex items-center justify-center shrink-0 ${
        compact ? 'w-24 aspect-[4/3]' : 'w-full aspect-[16/10]'
      }`}
    >
      {!loaded && (
        <div className="flex flex-col items-center justify-center gap-1 p-2 text-center select-none">
          {isJ2me && !compact && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-[9px] font-bold uppercase tracking-wider text-amber-300">
              📱 GAMELOFT · J2ME
            </span>
          )}
          <span
            className={`font-black tracking-wider ${
              isJ2me ? 'text-amber-400' : 'text-cyan-400'
            } ${compact ? 'text-sm' : 'text-xl'}`}
          >
            {initials}
          </span>
          {platformLabel && (
            <span className="font-mono text-[9px] uppercase tracking-wider text-neutral-400 truncate max-w-full">
              {platformLabel}
            </span>
          )}
        </div>
      )}
      {currentSrc && (
        <img
          src={currentSrc}
          alt={title ? `Jaquette ${title}` : 'Jaquette du jeu'}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setIdx((prev) => prev + 1)}
          className={`absolute inset-0 w-full h-full object-contain bg-black/70 transition-opacity duration-200 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  );
}
