import React, { useEffect, useState } from 'react';
import { getPlayerInitials } from '../../utils/avatarUtils';

const SIZE_CLASSES = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-xs',
  card: 'w-12 h-12 text-sm',
  lg: 'w-14 h-14 text-base',
  xl: 'w-16 h-16 text-lg',
};

const DOT_COLOR = {
  available: 'bg-emerald-400',
  in_game_available: 'bg-emerald-400',
  playing: 'bg-amber-400',
  afk: 'bg-neutral-400',
  offline: 'bg-neutral-600',
};

export function PlayerAvatar({
  photoURL = null,
  name = 'Joueur',
  size = 'md',
  shape = 'circle',
  status = null,
  className = '',
}) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [photoURL]);

  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.md;
  const shapeClass =
    shape === 'rounded'
      ? 'rounded-xl border-2 border-amber-500/50'
      : 'rounded-full border border-cyan-500/40';
  const hasPhoto = Boolean(photoURL && !imgError);
  const dotClass = status ? DOT_COLOR[status] || DOT_COLOR.offline : null;

  return (
    <div className={`relative inline-flex shrink-0 ${className}`}>
      <div
        className={`${sizeClass} ${shapeClass} overflow-hidden bg-gradient-to-br from-cyan-950 via-neutral-900 to-indigo-950 flex items-center justify-center font-black text-cyan-200 select-none shadow-inner`}
      >
        {hasPhoto ? (
          <img
            src={photoURL}
            alt={name || 'Avatar'}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <span>{getPlayerInitials(name)}</span>
        )}
      </div>
      {dotClass && (
        <span
          aria-hidden="true"
          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-neutral-950 ${dotClass}`}
        />
      )}
    </div>
  );
}
