import React from 'react';
import { Play, Users, CheckCircle, Cloud, Download, Star } from 'lucide-react';

export function GameListItem({ game, isAvailable, isBiosReady, onLaunchSolo, onLaunchNetplay }) {
  // Raccourcissement intelligent du genre pour économiser l'espace
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
    <div className="group relative bg-neutral-900/60 hover:bg-neutral-900 border border-neutral-800/80 hover:border-cyan-500/50 rounded-xl p-2.5 sm:p-3 flex items-center justify-between gap-3 sm:gap-4 transition-all duration-200 shadow-sm hover:shadow-lg hover:shadow-cyan-500/5">
      
      {/* 1. Vignette Miniature */}
      <div className="relative w-14 h-11 sm:w-20 sm:h-14 rounded-lg overflow-hidden shrink-0 bg-neutral-950 border border-neutral-800">
        <img
          src={game.coverUrl}
          alt={game.title}
          className="w-full h-full object-cover object-center group-hover:scale-110 transition-transform duration-300 opacity-90 group-hover:opacity-100"
          loading="lazy"
        />
        <div className="absolute inset-0 crt-scanlines opacity-30" />
      </div>

      {/* 2. Informations du Jeu */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-xs sm:text-sm text-neutral-100 group-hover:text-cyan-300 transition-colors truncate">
            {game.title}
          </h3>
          <div className="hidden sm:flex items-center gap-0.5 text-[10px] font-mono text-amber-400 shrink-0">
            <Star className="w-2.5 h-2.5 fill-amber-400" />
            <span>{game.rating}</span>
          </div>
        </div>

        {/* Badges métadonnées condensées */}
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="px-1.5 py-0.2 rounded text-[9px] sm:text-[10px] font-mono font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 shrink-0">
            <span className="sm:hidden">{getShortGenre(game.genre)}</span>
            <span className="hidden sm:inline">{game.genre}</span>
          </span>
          <span className="px-1.5 py-0.2 rounded text-[9px] sm:text-[10px] font-mono text-neutral-400 bg-neutral-950 border border-neutral-800 shrink-0">
            {game.year}
          </span>
          <span className="hidden md:inline-block text-[10px] font-mono text-neutral-500 truncate max-w-[120px]">
            {game.filename}
          </span>
        </div>

        {/* Résumé textuel court (visible sur écrans moyens et grands) */}
        {game.description && (
          <p className="hidden lg:block text-[11px] text-neutral-400/90 truncate mt-1 leading-snug">
            {game.description}
          </p>
        )}
      </div>

      {/* 3. Statut & Boutons d'Action Rapides */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        
        {/* Badge Disponibilité compact */}
        <div className="hidden sm:block">
          {isAvailable ? (
            <span className="flex items-center gap-1 px-2 py-1 rounded-full text-[9px] sm:text-[10px] font-mono font-bold bg-emerald-950/80 border border-emerald-500/40 text-emerald-400">
              <CheckCircle className="w-3 h-3" />
              <span className="hidden md:inline">ROM PRÊTE</span>
              <span className="md:hidden">PRÊT</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 px-2 py-1 rounded-full text-[9px] sm:text-[10px] font-mono font-bold bg-cyan-950/80 border border-cyan-500/40 text-cyan-300">
              <Cloud className="w-3 h-3 text-cyan-400" />
              <span className="hidden md:inline">EN LIGNE</span>
              <span className="md:hidden">WEB</span>
            </span>
          )}
        </div>

        {/* Pastille mobile de statut */}
        <span 
          className={`sm:hidden w-2 h-2 rounded-full shrink-0 ${isAvailable ? 'bg-emerald-400 shadow-sm shadow-emerald-400' : 'bg-cyan-400 shadow-sm shadow-cyan-400'}`}
          title={isAvailable ? 'ROM locale prête' : 'Téléchargement auto'}
        />

        {/* Boutons d'action */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {isAvailable ? (
            <button
              onClick={() => onLaunchSolo(game)}
              className="flex items-center justify-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold font-mono uppercase tracking-wider bg-cyan-500 hover:bg-cyan-400 text-black shadow-md shadow-cyan-500/20 active:scale-95 transition-all"
              title="Jouer en Solo"
            >
              <Play className="w-3 h-3 fill-current" />
              <span className="hidden sm:inline">Solo</span>
            </button>
          ) : (
            <button
              onClick={() => onLaunchSolo(game)}
              className="flex items-center justify-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold font-mono uppercase tracking-wider bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-md shadow-cyan-500/20 active:scale-95 transition-all"
              title="Télécharger et Lancer"
            >
              <Download className="w-3 h-3" />
              <span>Jouer</span>
            </button>
          )}

          <button
            onClick={() => onLaunchNetplay(game)}
            className="flex items-center justify-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold font-mono uppercase tracking-wider bg-neutral-950 hover:bg-neutral-800 text-rose-400 border border-rose-500/30 hover:border-rose-500/60 active:scale-95 transition-all"
            title={`Partie Multijoueur Réseau (${game.players || 2} Joueurs)`}
          >
            <Users className="w-3 h-3" />
            <span className="hidden md:inline">{game.players === 4 ? '4P LAN' : '2P LAN'}</span>
          </button>
        </div>
      </div>

    </div>
  );
}
