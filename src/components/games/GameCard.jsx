import React from 'react';
import { Play, Users, CheckCircle, Cloud, Download, Star } from 'lucide-react';

export function GameCard({ game, isAvailable, isBiosReady, onLaunchSolo, onLaunchNetplay }) {
  const getShortGenre = (genre) => {
    if (!genre) return '';
    const map = {
      'Versus Fighting': 'VS Fight',
      'Run and Gun': 'Run&Gun',
      "Shoot 'em up": 'Shmup',
      'Sports / Arcade': 'Sports',
      "Beat 'em up": "Beat'em",
      'Puzzle / Maze': 'Puzzle',
      'Platformer / Action': 'Platform'
    };
    return map[genre] || genre;
  };

  return (
    <div className="group relative bg-neutral-900/80 rounded-xl sm:rounded-2xl border border-neutral-800 overflow-hidden flex flex-col hover:border-cyan-500/60 hover:shadow-2xl hover:shadow-cyan-500/10 transition-all duration-300 min-w-0">
      {/* Visual Cover Container */}
      <div className="relative aspect-[16/10] overflow-hidden bg-neutral-950">
        <img
          src={game.coverUrl?.startsWith('/') ? '.' + game.coverUrl : game.coverUrl}
          alt={game.title}
          className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500 opacity-90 group-hover:opacity-100"
          loading="lazy"
        />

        {/* Scanline CRT overlay */}
        <div className="absolute inset-0 crt-scanlines opacity-40 group-hover:opacity-10 transition-opacity" />

        {/* Status Badge */}
        <div className="absolute top-1.5 sm:top-2.5 right-1.5 sm:right-2.5 z-10">
          {isAvailable ? (
            <span className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[8px] sm:text-[10px] font-mono font-bold bg-emerald-950/85 border border-emerald-500/50 text-emerald-400 backdrop-blur-md">
              <CheckCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0" />
              <span className="hidden sm:inline">ROM PRÊTE</span>
              <span className="sm:hidden">PRÊT</span>
            </span>
          ) : (
            <span className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[8px] sm:text-[10px] font-mono font-bold bg-cyan-950/85 border border-cyan-500/50 text-cyan-300 backdrop-blur-md">
              <Cloud className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-cyan-400 shrink-0" />
              <span className="hidden sm:inline">EN LIGNE</span>
              <span className="sm:hidden">WEB</span>
            </span>
          )}
        </div>

        {/* Meta badges (Genre + Year) */}
        <div className="absolute bottom-1.5 sm:bottom-2.5 left-1.5 sm:left-2.5 flex items-center gap-1 z-10">
          <span className="px-1 sm:px-2 py-0.5 rounded text-[8px] sm:text-[10px] font-mono font-medium bg-black/80 border border-neutral-700/80 text-cyan-300 backdrop-blur-md">
            <span className="sm:hidden">{getShortGenre(game.genre)}</span>
            <span className="hidden sm:inline">{game.genre}</span>
          </span>
          <span className="px-1 sm:px-2 py-0.5 rounded text-[8px] sm:text-[10px] font-mono font-medium bg-black/80 border border-neutral-700/80 text-neutral-300 backdrop-blur-md">
            {game.year}
          </span>
        </div>
      </div>

      {/* Info Content */}
      <div className="p-2 sm:p-4 flex-1 flex flex-col justify-between min-w-0">
        <div>
          <div className="flex items-start justify-between gap-1 mb-1">
            <h3 className="font-bold text-[11px] sm:text-sm text-neutral-100 group-hover:text-cyan-300 transition-colors truncate">
              {game.title}
            </h3>
            <div className="flex items-center gap-0.5 text-[9px] sm:text-[11px] font-mono text-amber-400 shrink-0">
              <Star className="w-2.5 h-2.5 sm:w-3 sm:h-3 fill-amber-400" />
              <span>{game.rating}</span>
            </div>
          </div>
          <p className="text-[10px] sm:text-xs text-neutral-400 line-clamp-1 sm:line-clamp-2 leading-tight sm:leading-relaxed mb-2 sm:mb-4">
            {game.description}
          </p>
        </div>

        {/* Actions Toolbar */}
        <div className="grid grid-cols-2 gap-1 sm:gap-2 pt-1.5 sm:pt-2 border-t border-neutral-800/80">
          {isAvailable ? (
            <button
              onClick={() => onLaunchSolo(game)}
              className="flex items-center justify-center gap-1 py-1.5 sm:py-2 px-1 sm:px-3 rounded-lg text-[10px] sm:text-xs font-bold font-mono uppercase tracking-wider transition-all bg-cyan-500 hover:bg-cyan-400 text-black shadow-md shadow-cyan-500/20 active:scale-95 min-w-0"
            >
              <Play className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 fill-current shrink-0" />
              <span className="truncate">Solo</span>
            </button>
          ) : (
            <button
              onClick={() => onLaunchSolo(game)}
              title="Téléchargement automatique interne vers public/roms/ et lancement"
              className="flex items-center justify-center gap-1 py-1.5 sm:py-2 px-1 sm:px-3 rounded-lg text-[10px] sm:text-xs font-bold font-mono uppercase tracking-wider transition-all bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-md shadow-cyan-500/20 active:scale-95 min-w-0"
            >
              <Download className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 shrink-0" />
              <span className="truncate">JOUER</span>
            </button>
          )}

          <button
            onClick={() => onLaunchNetplay(game)}
            title={`Créer ou rejoindre une partie réseau local (${game.players || 2} Joueurs)`}
            className="flex items-center justify-center gap-1 py-1.5 sm:py-2 px-1 sm:px-3 rounded-lg text-[10px] sm:text-xs font-bold font-mono uppercase tracking-wider transition-all bg-neutral-800 hover:bg-neutral-700 text-rose-400 border border-rose-500/30 hover:border-rose-500/60 active:scale-95 min-w-0"
          >
            <Users className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 shrink-0" />
            <span className="truncate">{game.players === 4 ? '4P LAN' : '2P LAN'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
