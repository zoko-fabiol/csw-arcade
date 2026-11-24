import React, { useState, useMemo, useEffect } from 'react';
import { getUniverseTheme } from '../../data/universeThemes';

const FAILED_COVER_URLS = new Set();
const RESOLVED_COVER_CACHE = new Map();

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
  [/ps\s*vita|psvita|vita3k/i, 'Sony - PlayStation Vita'],
  [/\bpsp\b|ppsspp|portable/i, 'Sony - PlayStation Portable'],
  [/playstation|\bps1\b|\bpsx\b|pcsx/i, 'Sony - PlayStation'],
  [/arcade|fbneo|mame|neo\s*geo/i, 'FBNeo - Arcade Games'],
];

function sanitizeLibretroName(name) {
  return String(name || '').replace(/[&*/:`<>?\\|]/g, '_').trim();
}

function resolveCoverCandidates({ title, platformLabel, filename, imageUrl }) {
  const cacheKey = `${platformLabel || ''}|${filename || ''}|${title || ''}|${imageUrl || ''}`;
  const resolved = RESOLVED_COVER_CACHE.get(cacheKey);
  if (resolved === 'none') return [];
  if (resolved) return [resolved];

  const candidates = [];
  if (imageUrl && !FAILED_COVER_URLS.has(imageUrl)) candidates.push(imageUrl);

  const label = String(platformLabel || '');
  const match = LIBRETRO_SYSTEM_MAP.find(([re]) => re.test(label));
  if (!match || !title) return candidates;

  const systemDir = encodeURIComponent(match[1]);
  const base = `https://thumbnails.libretro.com/${systemDir}/Named_Boxarts/`;

  const names = [];
  if (filename) {
    const noExt = String(filename).replace(
      /\.(zip|7z|rar|bin|iso|cso|vpk|chd|pbp|md|gen|nes|sfc|smc|gba|gbc|gb|z64|n64|nds|sms|gg)$/i,
      ''
    );
    if (noExt) names.push(sanitizeLibretroName(noExt));
  }
  const cleanTitle = sanitizeLibretroName(String(title).replace(/\s*\([^)]*\)\s*$/g, ''));
  if (cleanTitle) {
    names.push(`${cleanTitle} (USA)`, `${cleanTitle} (Europe)`, cleanTitle);
  }

  const seen = new Set();
  for (const n of names) {
    if (!n || seen.has(n)) continue;
    seen.add(n);
    const u = `${base}${encodeURIComponent(n)}.png`;
    if (!FAILED_COVER_URLS.has(u)) candidates.push(u);
    if (candidates.length >= 4) break;
  }
  return candidates;
}

function detectCoverUniverse(platformLabel = '', filename = '') {
  const s = `${platformLabel} ${filename}`.toLowerCase();
  if (/java|j2me|gameloft|\.jar$/.test(s)) return 'java';
  if (/playstation|\bps1\b|\bpsx\b|pcsx|\bpsp\b/.test(s)) return 'playstation';
  if (/nintendo|\bnes\b|snes|famicom|game\s*boy|\bgb\b|\bgbc\b|\bgba\b|\bn64\b|\bnds\b/.test(s)) return 'nintendo';
  if (/sega|mega\s*drive|genesis|master\s*system|game\s*gear|saturn/.test(s)) return 'sega';
  if (/neo\s*geo|mame|fbneo|arcade|cps/.test(s)) return 'arcade';
  return 'all';
}

export function GameCover({ title, platformLabel, filename, imageUrl, compact = false }) {
  const coverKey = `${platformLabel || ''}|${filename || ''}|${title || ''}|${imageUrl || ''}`;
  const candidates = useMemo(
    () => resolveCoverCandidates({ title, platformLabel, filename, imageUrl }),
    [coverKey]
  );

  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setIdx(0);
    setLoaded(false);
  }, [coverKey]);

  const initials = useMemo(() => {
    const clean = String(title || '?').replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
    const parts = clean.split(/\s+/).filter(Boolean).slice(0, 2);
    return parts.map((w) => w[0]?.toUpperCase() || '').join('') || 'CSW';
  }, [title]);

  const coverUniverse = useMemo(
    () => detectCoverUniverse(platformLabel, filename),
    [platformLabel, filename]
  );
  const theme = getUniverseTheme(coverUniverse);
  const isJ2me = coverUniverse === 'java';
  const currentSrc = idx < candidates.length ? candidates[idx] : null;

  return (
    <div
      className={`keep-dark relative overflow-hidden rounded-lg border ${theme.coverBorder} bg-gradient-to-br ${theme.coverGradient} flex items-center justify-center shrink-0 ${
        compact ? 'w-24 aspect-[4/3]' : 'w-full aspect-[16/10]'
      }`}
    >
      {!loaded && (
        <div className="flex flex-col items-center justify-center gap-1.5 p-2 text-center select-none w-full">
          {!compact && (
            <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/45 border border-white/15 text-[9px] font-mono font-bold uppercase tracking-wider text-neutral-200">
              {theme.symbols ? (
                <span className="inline-flex items-center gap-0.5" aria-hidden="true">
                  {theme.symbols.map((s) => (
                    <span key={s.label} style={{ color: s.color }}>{s.glyph}</span>
                  ))}
                </span>
              ) : (
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: theme.accentHex }}
                  aria-hidden="true"
                />
              )}
              <span>{isJ2me ? 'GAMELOFT · J2ME' : theme.badgeLabel}</span>
            </div>
          )}
          <span
            className={`font-black tracking-wider ${theme.coverText} ${compact ? 'text-sm' : 'text-2xl'}`}
          >
            {initials}
          </span>
          {platformLabel && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-300 truncate max-w-[90%]">
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
          onLoad={(e) => {
            if (e.currentTarget.naturalWidth > 0 && e.currentTarget.naturalHeight > 0) {
              if (currentSrc) RESOLVED_COVER_CACHE.set(coverKey, currentSrc);
              setLoaded(true);
            } else {
              setIdx((prev) => prev + 1);
            }
          }}
          onError={() => {
            if (currentSrc) {
              if (FAILED_COVER_URLS.size > 1500) FAILED_COVER_URLS.clear();
              FAILED_COVER_URLS.add(currentSrc);
            }
            const nextIdx = idx + 1;
            if (nextIdx >= candidates.length) {
              if (RESOLVED_COVER_CACHE.size > 1500) RESOLVED_COVER_CACHE.clear();
              RESOLVED_COVER_CACHE.set(coverKey, 'none');
            }
            setLoaded(false);
            setIdx(nextIdx);
          }}
          className={`absolute inset-0 w-full h-full object-contain bg-black/75 transition-opacity duration-200 ${
            loaded ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        />
      )}
    </div>
  );
}
