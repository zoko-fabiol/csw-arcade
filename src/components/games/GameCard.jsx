import React from 'react';
import { Play, Users, CheckCircle, Cloud, Download, Star } from 'lucide-react';

export function GameCard({ game, isAvailable, isBiosReady, onLaunchSolo, onLaunchNetplay }) {
  return (
    <div className="group relative bg-neutral-900/80 rounded-2xl border border-neutral-800 overflow-hidden flex flex-col hover:border-cyan-500/60 hover:shadow-2xl hover:shadow-cyan-500/10 transition-all duration-300">
      {/* Visual Cover Container */}
      <div className="relative aspect-[16/10] overflow-hidden bg-neutral-950">
        <img
          src={game.coverUrl}
          alt={game.title}
          className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500 opacity-90 group-hover:opacity-100"
          loading="lazy"
        />

        {/* Scanline CRT overlay */}
        <div className="absolute inset-0 crt-scanlines opacity-40 group-hover:opacity-10 transition-opacity" />

        {/* Status Badge */}
        <div className="absolute top-2.5 right-2.5 z-10">
          {isAvailable ? (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-emerald-950/80 border border-emerald-500/50 text-emerald-400 backdrop-blur-md">
              <CheckCircle className="w-3 h-3" />
              ROM PRÊTE
            </span>
          ) : (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 backdrop-blur-md">
              <Cloud className="w-3 h-3 text-cyan-400" />
              EN LIGNE
            </span>
          )}
        </div>

        {/* Meta badges (Genre + Year) */}
        <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 z-10">
          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-medium bg-black/70 border border-neutral-700/80 text-cyan-300 backdrop-blur-md">
            {game.genre}
          </span>
          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-medium bg-black/70 border border-neutral-700/80 text-neutral-300 backdrop-blur-md">
            {game.year}
          </span>
        </div>
      </div>

      {/* Info Content */}
      <div className="p-4 flex-1 flex flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="font-bold text-sm text-neutral-100 group-hover:text-cyan-300 transition-colors line-clamp-1">
              {game.title}
            </h3>
            <div className="flex items-center gap-1 text-[11px] font-mono text-amber-400 shrink-0">
              <Star className="w-3 h-3 fill-amber-400" />
              <span>{game.rating}</span>
            </div>
          </div>
          <p className="text-xs text-neutral-400 line-clamp-2 leading-relaxed mb-4">
            {game.description}
          </p>
        </div>

        {/* Actions Toolbar */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-neutral-800/80">
          {isAvailable ? (
            <button
              onClick={() => onLaunchSolo(game)}
              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold font-mono uppercase tracking-wider transition-all bg-cyan-500 hover:bg-cyan-400 text-black shadow-lg shadow-cyan-500/20 active:scale-95"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Solo
            </button>
          ) : (
            <button
              onClick={() => onLaunchSolo(game)}
              title="Téléchargement automatique interne vers public/roms/ et lancement"
              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold font-mono uppercase tracking-wider transition-all bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20 active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              JOUER
            </button>
          )}

          <button
            onClick={() => onLaunchNetplay(game)}
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold font-mono uppercase tracking-wider transition-all bg-neutral-800 hover:bg-neutral-700 text-red-400 border border-red-500/30 hover:border-red-500/60 active:scale-95"
          >
            <Users className="w-3.5 h-3.5" />
            1v1 P2P
          </button>
        </div>
      </div>
    </div>
  );
}

