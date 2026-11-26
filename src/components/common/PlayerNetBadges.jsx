import React, { useState } from 'react';

const REGION_FALLBACK_CC = {
  europe: 'EU',
  eu: 'EU',
  africa: 'CM',
  af: 'CM',
  americas: 'US',
  na: 'US',
  asia: 'JP',
};

export function resolveCountryCode(user) {
  const raw = String(user?.countryCode || user?.country || user?.region || '')
    .trim()
    .toUpperCase();
  if (/^[A-Z]{2}$/.test(raw) && raw !== 'UN' && raw !== 'XX') return raw;
  const lower = raw.toLowerCase();
  if (REGION_FALLBACK_CC[lower]) return REGION_FALLBACK_CC[lower];
  return null;
}

/**
 * Drapeau circulaire façon Fightcade 2 (image réelle flagcdn.com + fallback ISO propre)
 */
export function CountryFlagBadge({ countryCode, countryName, city, region, size = 18 }) {
  const [imgFailed, setImgFailed] = useState(false);
  const cc = resolveCountryCode({ countryCode, region });
  const isLan = String(countryCode || '').toUpperCase() === 'LAN';
  const label = countryName
    ? city
      ? `${countryName} · ${city}`
      : countryName
    : isLan
      ? 'Réseau local (LAN)'
      : cc || 'Pays inconnu';

  if (isLan || !cc || cc === 'EU' || imgFailed) {
    return (
      <span
        title={label}
        style={{ width: size, height: size }}
        className="inline-flex items-center justify-center rounded-full bg-neutral-800 border border-white/20 text-[8px] font-mono font-black text-cyan-200 shrink-0 select-none"
      >
        {isLan ? 'LN' : cc || '??'}
      </span>
    );
  }

  return (
    <span
      title={label}
      style={{ width: size, height: size }}
      className="inline-flex items-center justify-center rounded-full overflow-hidden ring-1 ring-white/25 bg-neutral-800 shrink-0"
    >
      <img
        src={`https://flagcdn.com/w40/${cc.toLowerCase()}.png`}
        alt={label}
        loading="lazy"
        onError={() => setImgFailed(true)}
        className="w-full h-full object-cover"
      />
    </span>
  );
}

/**
 * Indicateur de Ping réel façon Fightcade 2 (4 barres ascendantes + valeur exacte en ms)
 */
export function FightcadePingIndicator({ pingMs, isSelf = false, showLabel = true }) {
  const valid = typeof pingMs === 'number' && Number.isFinite(pingMs) && pingMs > 0;
  const ms = valid ? Math.round(pingMs) : null;

  let bars = 0;
  let barColor = 'bg-neutral-600';
  let textColor = 'text-neutral-400';
  let qualityLabel = 'Mesure du ping…';

  if (ms !== null) {
    if (ms < 60) {
      bars = 4;
      barColor = 'bg-emerald-400';
      textColor = 'text-emerald-300';
      qualityLabel = 'Excellent';
    } else if (ms < 120) {
      bars = 3;
      barColor = 'bg-lime-400';
      textColor = 'text-lime-300';
      qualityLabel = 'Bon';
    } else if (ms < 180) {
      bars = 2;
      barColor = 'bg-amber-400';
      textColor = 'text-amber-300';
      qualityLabel = 'Moyen';
    } else {
      bars = 1;
      barColor = 'bg-rose-500';
      textColor = 'text-rose-400';
      qualityLabel = 'Élevé';
    }
  }

  const tooltip =
    ms !== null
      ? `${isSelf ? 'Votre ping vers le serveur' : 'Ping réel mesuré'} : ${ms} ms (${qualityLabel})`
      : 'Mesure du ping réel en cours…';

  return (
    <span className="inline-flex items-center gap-1.5 shrink-0" title={tooltip}>
      <span className="inline-flex items-end gap-[2px] h-3.5">
        {[1, 2, 3, 4].map((lvl) => (
          <span
            key={lvl}
            className={`w-[3px] rounded-[1px] transition-colors ${
              lvl <= bars ? barColor : 'bg-neutral-700/80'
            }`}
            style={{ height: `${lvl * 3 + 2}px` }}
          />
        ))}
      </span>
      {showLabel && (
        <span className={`text-[10px] font-mono font-bold tabular-nums ${textColor}`}>
          {ms !== null ? `${ms}ms` : '…'}
        </span>
      )}
    </span>
  );
}
