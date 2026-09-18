import React from 'react';
import { 
  Gamepad2, 
  Users, 
  Settings, 
  HardDrive, 
  Sparkles, 
  Flame, 
  ShieldAlert, 
  CheckCircle2,
  RefreshCw,
  Radio
} from 'lucide-react';

export function Sidebar({ 
  selectedGenre, 
  onSelectGenre, 
  isBiosReady, 
  availableCount, 
  totalCount, 
  onRefreshAudit,
  onOpenNetplayLobby,
  onOpenWebRtcTest,
  onOpenSettings,
  onLaunchNative
}) {
  const genres = [
    'Tous les Jeux', 
    'Disponibles', 
    'Versus Fighting', 
    'Run and Gun', 
    "Shoot 'em up", 
    'Sports / Arcade', 
    "Beat 'em up", 
    'Puzzle / Maze', 
    'Platformer / Action'
  ];

  return (
    <aside className="w-64 bg-neutral-900/90 border-r border-neutral-800 flex flex-col justify-between select-none h-screen backdrop-blur-md">
      {/* Brand Header */}
      <div>
        <div className="p-5 border-b border-neutral-800/80 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Gamepad2 className="w-6 h-6 text-black stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-wider text-white font-arcade uppercase">
              CSW<span className="text-cyan-400">.</span>ARCADE
            </h1>
            <p className="text-[10px] uppercase font-mono tracking-widest text-neutral-400">
              NeoRAGEx Modern Engine
            </p>
          </div>
        </div>

        {/* Audit Status Card */}
        <div className="p-4 mx-3 my-4 rounded-xl bg-neutral-950/80 border border-neutral-800 text-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-neutral-400 flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
              STOCKAGE ROMS
            </span>
            <button 
              onClick={onRefreshAudit}
              title="Scanner à nouveau le dossier public/roms"
              className="text-neutral-400 hover:text-cyan-400 transition-colors p-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-1.5 font-mono text-[11px]">
            <div className="flex justify-between items-center">
              <span className="text-neutral-400">Jeux Installés :</span>
              <span className="text-cyan-300 font-bold">
                {availableCount} / {totalCount}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-neutral-400">BIOS NeoGeo :</span>
              {isBiosReady ? (
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> PRÊT
                </span>
              ) : (
                <span className="text-rose-400 font-bold flex items-center gap-1 animate-pulse">
                  <ShieldAlert className="w-3 h-3" /> MANQUANT
                </span>
              )}
            </div>
          </div>

          {/* Bouton de Lancement Direct NeoRAGEx 5.0 Natif */}
          <button
            onClick={onLaunchNative}
            className="mt-3 w-full py-2.5 px-3 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-mono font-bold text-xs tracking-wider uppercase shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2 transition-all active:scale-95 group"
          >
            <Sparkles className="w-4 h-4 text-cyan-200 group-hover:rotate-12 transition-transform" />
            Lancer NeoRAGEx 5.0
          </button>
        </div>

        {/* Navigation Categories */}
        <div className="px-3 py-2">
          <span className="px-3 text-[10px] font-mono uppercase tracking-wider text-neutral-500">
            Bibliothèque
          </span>
          <nav className="mt-2 space-y-1">
            {genres.map((genre) => {
              const active = selectedGenre === genre;
              return (
                <button
                  key={genre}
                  onClick={() => onSelectGenre(genre)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-lg text-xs font-medium transition-all ${
                    active
                      ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/40 shadow-sm'
                      : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200'
                  }`}
                >
                  <Flame className={`w-3.5 h-3.5 ${active ? 'text-cyan-400' : 'text-neutral-500'}`} />
                  {genre}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Multijoueur Netplay Action */}
        <div className="px-3 py-3 space-y-2">
          <span className="px-3 text-[10px] font-mono uppercase tracking-wider text-neutral-500">
            En Ligne (P2P)
          </span>
          <button
            onClick={onOpenNetplayLobby}
            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-gradient-to-r from-red-600/20 to-orange-600/20 border border-red-500/40 text-red-300 hover:from-red-600/30 hover:to-orange-600/30 transition-all group"
          >
            <span className="flex items-center gap-2.5 text-xs font-bold font-mono">
              <Users className="w-4 h-4 text-red-400 group-hover:scale-110 transition-transform" />
              SALONS NETPLAY
            </span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          </button>

          <button
            onClick={onOpenWebRtcTest}
            className="w-full flex items-center gap-2 px-3.5 py-2 rounded-lg bg-neutral-950 border border-neutral-800 text-[11px] font-mono text-cyan-400 hover:border-cyan-500/50 hover:bg-cyan-950/20 transition-all"
          >
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            TESTEUR UDP 60 FPS
          </button>
        </div>
      </div>

      {/* Footer Settings & Engine Info */}
      <div className="p-3 border-t border-neutral-800/80">
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs font-medium text-neutral-400 hover:bg-neutral-800/60 hover:text-white transition-all"
        >
          <Settings className="w-4 h-4 text-neutral-400" />
          Configuration NeoRAGEx
        </button>
        <div className="mt-3 px-3 text-[10px] font-mono text-neutral-600 flex justify-between">
          <span>FBNeo WASM Core</span>
          <span>v1.0.0.3</span>
        </div>
      </div>
    </aside>
  );
}
