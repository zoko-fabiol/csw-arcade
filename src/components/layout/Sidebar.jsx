import React, { useState, useEffect, useRef } from 'react';
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
  Radio,
  Download,
  X,
  Zap,
  Swords,
  Crosshair,
  Rocket,
  Trophy,
  Puzzle,
  Footprints
} from 'lucide-react';
import { useDeviceType } from '../../utils/deviceDetector';

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
  onLaunchNative,
  isOpenMobile,
  onCloseMobile
}) {
  const genres = [
    { id: 'Tous les Jeux', full: 'Tous les Jeux', short: 'Tous', icon: Gamepad2, color: 'text-cyan-400' },
    { id: 'Disponibles', full: 'Disponibles (Prêts)', short: 'Disponibles', icon: Zap, color: 'text-amber-400' },
    { id: 'Versus Fighting', full: 'Versus Fighting', short: 'VS Fighting', icon: Swords, color: 'text-rose-400' },
    { id: 'Run and Gun', full: 'Run and Gun', short: 'Run & Gun', icon: Crosshair, color: 'text-orange-400' },
    { id: "Shoot 'em up", full: "Shoot 'em up", short: 'Shmup', icon: Rocket, color: 'text-purple-400' },
    { id: 'Sports / Arcade', full: 'Sports / Arcade', short: 'Sports', icon: Trophy, color: 'text-emerald-400' },
    { id: "Beat 'em up", full: "Beat 'em up", short: "Beat'em up", icon: Flame, color: 'text-red-400' },
    { id: 'Puzzle / Maze', full: 'Puzzle / Maze', short: 'Puzzle', icon: Puzzle, color: 'text-sky-400' },
    { id: 'Platformer / Action', full: 'Platformer / Action', short: 'Plateforme', icon: Footprints, color: 'text-teal-400' }
  ];

  const { isMobile } = useDeviceType();
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const touchStartX = useRef(null);

  // Fermeture rapide avec la touche Échap sur mobile
  useEffect(() => {
    if (!isOpenMobile) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && typeof onCloseMobile === 'function') {
        onCloseMobile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpenMobile, onCloseMobile]);

  // Gestes tactiles pour fermer en balayant vers la gauche
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diffX = touchStartX.current - touchEndX;
    if (diffX > 45 && typeof onCloseMobile === 'function') {
      onCloseMobile();
    }
    touchStartX.current = null;
  };

  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallPwa = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const handleGenreClick = (genreId) => {
    onSelectGenre(genreId);
    if (typeof onCloseMobile === 'function') onCloseMobile();
  };

  const content = (
    <div className="flex flex-col justify-between h-full select-none font-mono">
      {/* Brand Header */}
      <div>
        <div className="p-4 sm:p-5 border-b border-neutral-800/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img 
              src="/icons/icon-192.png" 
              alt="CSW-Arcade" 
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl shadow-lg shadow-cyan-500/30 object-cover border border-cyan-500/40 shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-black tracking-wider text-white font-arcade uppercase truncate">
                CSW<span className="text-cyan-400">.</span>ARCADE
              </h1>
              <p className="text-[9px] sm:text-[10px] uppercase tracking-widest text-neutral-400 truncate">
                NeoRAGEx Modern Engine
              </p>
            </div>
          </div>

          {/* Bouton Fermer sur Mobile */}
          {typeof onCloseMobile === 'function' && (
            <button
              onClick={onCloseMobile}
              className="lg:hidden p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
              title="Fermer le menu"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Audit Status Card */}
        <div className="p-3 sm:p-4 mx-2.5 sm:mx-3 my-3 rounded-xl bg-neutral-950/80 border border-neutral-800 text-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-neutral-400 flex items-center gap-1.5 text-[11px]">
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

          <div className="space-y-1.5 text-[11px]">
            <div className="flex justify-between items-center">
              <span className="text-neutral-400">Installés :</span>
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

          {/* Bouton de Lancement Direct NeoRAGEx 5.0 Natif (PC Desktop uniquement) */}
          {!isMobile && (
            <button
              onClick={() => {
                onLaunchNative();
                if (onCloseMobile) onCloseMobile();
              }}
              className="mt-3 w-full py-2 px-3 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-[11px] sm:text-xs tracking-wider uppercase shadow-md shadow-cyan-500/20 flex items-center justify-center gap-2 transition-all active:scale-95 group"
            >
              <Sparkles className="w-3.5 h-3.5 text-cyan-200 group-hover:rotate-12 transition-transform" />
              Lancer NeoRAGEx
            </button>
          )}
        </div>

        {/* Categories / Genres Navigation */}
        <nav className="px-2 sm:px-3 py-1 space-y-1 overflow-y-auto max-h-[36vh] sm:max-h-[42vh] scrollbar-thin scrollbar-thumb-neutral-800">
          <span className="px-3 text-[10px] uppercase tracking-wider text-neutral-500">
            Catégories
          </span>
          {genres.map((genre) => {
            const isActive = selectedGenre === genre.id;
            const Icon = genre.icon;
            return (
              <button
                key={genre.id}
                onClick={() => handleGenreClick(genre.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-bold shadow-sm'
                    : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-cyan-400' : genre.color}`} />
                  <span className="truncate">{genre.full}</span>
                </div>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-sm shadow-cyan-400 shrink-0" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Multijoueur Netplay Action */}
        <div className="px-2.5 sm:px-3 py-2.5 space-y-1.5 border-t border-neutral-800/80 mt-2">
          <span className="px-3 text-[10px] uppercase tracking-wider text-neutral-500">
            En Ligne (P2P)
          </span>
          <button
            onClick={() => {
              onOpenNetplayLobby();
              if (onCloseMobile) onCloseMobile();
            }}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-gradient-to-r from-red-600/20 to-orange-600/20 border border-red-500/40 text-red-300 hover:from-red-600/30 hover:to-orange-600/30 transition-all group text-xs font-bold"
          >
            <span className="flex items-center gap-2">
              <Users className="w-3.5 h-3.5 text-red-400 group-hover:scale-110 transition-transform" />
              SALONS NETPLAY
            </span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
          </button>

          <button
            onClick={() => {
              onOpenWebRtcTest();
              if (onCloseMobile) onCloseMobile();
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 text-[10px] text-cyan-400 hover:border-cyan-500/50 hover:bg-cyan-950/20 transition-all"
          >
            <Radio className="w-3 h-3 animate-pulse shrink-0" />
            TESTEUR UDP 60 FPS
          </button>
        </div>
      </div>

      {/* Footer Settings & Engine Info */}
      <div className="p-3 border-t border-neutral-800/80 bg-neutral-950/50 shrink-0">
        {deferredPrompt && (
          <button
            onClick={handleInstallPwa}
            className="mb-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-cyan-500/20 border border-cyan-400 text-cyan-300 hover:bg-cyan-500/30 text-xs font-bold transition-all animate-pulse"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            INSTALLER L'APP (PWA)
          </button>
        )}

        <button
          onClick={() => {
            onOpenSettings();
            if (onCloseMobile) onCloseMobile();
          }}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-neutral-400 hover:bg-neutral-800/60 hover:text-white transition-all"
        >
          <Settings className="w-4 h-4 text-neutral-400 shrink-0" />
          Configuration NeoRAGEx
        </button>

        <div className="mt-2 px-3 text-[9px] text-neutral-500 flex justify-between">
          <span>FBNeo WASM Core</span>
          <span>v1.0.0.3</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* 1. Version Desktop Ancrée (visible sur lg: et au-delà) */}
      <aside className="hidden lg:flex w-64 bg-neutral-900/90 border-r border-neutral-800 flex-col justify-between select-none h-screen backdrop-blur-md shrink-0">
        {content}
      </aside>

      {/* 2. Version Mobile / Tablette (Tiroir coulissant avec Backdrop) */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          {/* Backdrop sombre semi-transparent */}
          <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
            onClick={onCloseMobile}
          />
          {/* Tiroir coulissant avec support swipe-to-close */}
          <div 
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className="relative w-72 max-w-[85vw] bg-neutral-900 border-r border-neutral-800 h-full shadow-2xl z-10 animate-in slide-in-from-left duration-200"
          >
            {content}
          </div>
        </div>
      )}
    </>
  );
}
