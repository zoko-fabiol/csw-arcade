import React, { useState, useEffect } from 'react';
import gamesData from './data/games.json';
import { useRomAudit } from './hooks/useRomAudit';
import { useSettings } from './hooks/useSettings';
import { Sidebar } from './components/layout/Sidebar';
import { GameLibrary } from './components/games/GameLibrary';
import { EmulatorCore } from './components/emulator/EmulatorCore';
import { RemoteStreamPlayer } from './components/emulator/RemoteStreamPlayer';
import { NetplayModal } from './components/netplay/NetplayModal';
import { MobileControllerView } from './components/netplay/MobileControllerView';
import { WebRTCNetplayDemo } from './components/netplay/WebRTCNetplayDemo';
import { SettingsModal } from './components/settings/SettingsModal';
import { netplayService } from './services/NetplayService';

import { launchNativeNeoRAGEx } from './services/nativeLauncher';
import { useMobileNavigation, useOnlineStatus } from './hooks/useMobileNavigation';
import { formatBytes, getPlatformCacheStats } from './services/platformRomService';
import { PlatformCatalogView } from './components/shell/PlatformCatalogView';
import { UnifiedStageModal } from './components/shell/UnifiedStageModal';
import { Gamepad2, Disc, Cpu, Coffee, Settings, Joystick } from 'lucide-react';

const SHELL_MODES = [
  { id: 'arcade', label: 'Arcade', subtitle: 'Neo Geo MVS / AES · MAME · Netplay P2P', icon: Joystick },
  { id: 'playstation', label: 'PlayStation', subtitle: 'PS1 (Web HLE) · Téléchargement Auto CHD', icon: Disc },
  { id: 'sega', label: 'Sega', subtitle: 'Mega Drive / Genesis · Master System · Game Gear', icon: Cpu },
  { id: 'nintendo', label: 'Nintendo', subtitle: 'NES · SNES · GB · GBC · GBA · Nintendo 64', icon: Gamepad2 },
  { id: 'java', label: 'Java / Gameloft', subtitle: 'J2ME (.jar) · Gameloft Classics', icon: Coffee },
];

export default function App() {
  const [selectedGenre, setSelectedGenre] = useState('Tous les Jeux');
  const [activeGame, setActiveGame] = useState(null);
  const [gameMode, setGameMode] = useState(null); // 'solo' | 'netplay'
  const [nativeStatus, setNativeStatus] = useState(null);

  // État Modales & Responsive
  const [isLobbyOpen, setIsLobbyOpen] = useState(false);
  const [netplayPreselectedGame, setNetplayPreselectedGame] = useState(null);
  const [mobileControllerSession, setMobileControllerSession] = useState(null);
  const [isWebRtcTestOpen, setIsWebRtcTestOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Shell unifié 5 modes
  const [platformMode, setPlatformMode] = useState(() => {
    if (typeof window === 'undefined') return 'arcade';
    const m = new URLSearchParams(window.location.search).get('mode');
    return ['arcade', 'playstation', 'sega', 'nintendo', 'java'].includes(m) ? m : 'arcade';
  });
  const [arcadeSub, setArcadeSub] = useState(() => {
    if (typeof window === 'undefined') return 'consoles';
    const p = new URLSearchParams(window.location.search);
    return p.get('join') || p.get('sub') === 'neogeo' ? 'neogeo' : 'consoles';
  });
  const [stageSession, setStageSession] = useState(null);
  const [cacheStats, setCacheStats] = useState({ count: 0, totalBytes: 0 });

  const refreshPlatformCache = () => {
    getPlatformCacheStats().then(setCacheStats).catch(() => {});
  };

  useEffect(() => {
    refreshPlatformCache();
    const onKey = (e) => {
      if (e.altKey && ['1', '2', '3', '4', '5'].includes(e.key)) {
        e.preventDefault();
        setPlatformMode(SHELL_MODES[Number(e.key) - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // État Session Netplay
  const [netplaySession, setNetplaySession] = useState({
    isHost: true,
    playerIndex: 0,
    role: 'p1',
    playMode: 'rollback'
  });

  // Audit des ROMs locales
  const {
    availableRoms,
    isBiosReady,
    refreshAudit,
    isRomAvailable
  } = useRomAudit();

  // Gestionnaire de paramètres matériels NeoRAGEx
  const {
    settings,
    updateKeyBinding,
    updateVideoSetting,
    updateAudioSetting,
    updateSystemSetting,
    updateGamepadSetting,
    updateTouchSetting,
    updatePerformanceSetting,
    resetToDefaults
  } = useSettings();

  // Lancement Solo In-App WebAssembly (FBNeo 60 FPS)
  const handleLaunchSolo = (game) => {
    setActiveGame(game);
    setGameMode('solo');
  };

  // Lancement direct du moteur NeoRAGEx
  const handleLaunchNativeGeneral = async () => {
    setNativeStatus('Démarrage du moteur natif NeoRAGEx 5.0...');
    const res = await launchNativeNeoRAGEx({ settings });
    if (res.success) {
      setNativeStatus(`NeoRAGEx 5.0 démarré (PID: ${res.pid})`);
      setTimeout(() => setNativeStatus(null), 4000);
    } else {
      setNativeStatus(`Erreur: ${res.error}`);
      setTimeout(() => setNativeStatus(null), 5000);
    }
  };

  // Clic Partie en Réseau LAN
  const handleLaunchNetplay = (game = null) => {
    setNetplayPreselectedGame(game);
    setIsLobbyOpen(true);
  };

  // Démarrage effectif du match Netplay LAN
  const handleStartNetplayGame = (game, options = {}) => {
    setIsLobbyOpen(false);
    setNetplaySession({
      isHost: options.isHost ?? true,
      playerIndex: options.playerIndex ?? 0,
      role: options.role ?? 'p1',
      playMode: options.playMode || 'rollback'
    });
    setActiveGame(game);
    setGameMode('netplay');
  };

  // Quitter le jeu et libérer les ressources
  const handleExitGame = () => {
    if (gameMode === 'netplay') {
      netplayService.leaveRoom();
      setNetplaySession({ isHost: true, playerIndex: 0, role: 'p1', playMode: 'rollback' });
    }
    setActiveGame(null);
    setGameMode(null);
  };

  // Détection du paramètre ?join= dans l'URL pour ouvrir directement le salon multijoueur
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('join')) {
        setIsLobbyOpen(true);
      }
    }
  }, []);

  const isOnline = useOnlineStatus();
  const { exitToastVisible } = useMobileNavigation({
    activeGame,
    onExitGame: handleExitGame,
    isSettingsOpen,
    onCloseSettings: () => setIsSettingsOpen(false),
    isLobbyOpen,
    onCloseLobby: () => {
      setIsLobbyOpen(false);
      setNetplayPreselectedGame(null);
    },
    mobileControllerSession,
    onCloseMobileController: () => setMobileControllerSession(null),
    isWebRtcTestOpen,
    onCloseWebRtcTest: () => setIsWebRtcTestOpen(false),
    isMobileSidebarOpen,
    onCloseMobileSidebar: () => setIsMobileSidebarOpen(false)
  });

  const installedCount = gamesData.filter(g => isRomAvailable(g.filename)).length;

  const currentModeMeta = SHELL_MODES.find((m) => m.id === platformMode) || SHELL_MODES[0];

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-neutral-950 font-sans text-neutral-100">
      {/* Topbar Unifiée 5 Modes (React) */}
      <header className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-neutral-950/95 border-b border-neutral-800 shrink-0 z-30">
        <div className="flex items-center gap-2.5">
          <img src="./icons/icon-192.png" alt="CSW Arcade" className="w-8 h-8 rounded-lg" />
          <div>
            <div className="font-black tracking-wider text-sm text-white">
              CSW<span className="text-cyan-400">.</span>ARCADE
            </div>
            <div className="text-[10px] font-mono text-neutral-400 hidden sm:block">
              {currentModeMeta.subtitle}
            </div>
          </div>
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Modes de la plateforme">
          {SHELL_MODES.map((m, idx) => {
            const Icon = m.icon;
            const active = platformMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={active}
                title={`${m.label} (Alt+${idx + 1})`}
                onClick={() => setPlatformMode(m.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shrink-0 ${
                  active
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/50'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-900 border border-transparent'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{m.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <span className="hidden lg:inline px-2.5 py-1 rounded-full bg-neutral-900 border border-neutral-800 text-[11px] font-mono text-neutral-300">
            Cache : {cacheStats.count} jeu(x) · {formatBytes(cacheStats.totalBytes)}
          </span>
          <span
            className={`px-2.5 py-1 rounded-full border text-[11px] font-mono ${
              isOnline
                ? 'bg-emerald-950/50 border-emerald-700/50 text-emerald-300'
                : 'bg-amber-950/50 border-amber-700/50 text-amber-300'
            }`}
          >
            {isOnline ? 'En ligne' : 'Hors-ligne'}
          </span>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs font-semibold text-neutral-200 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Paramètres</span>
          </button>
        </div>
      </header>

      {/* Sous-barre Mode Arcade */}
      {platformMode === 'arcade' && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-neutral-900/80 border-b border-neutral-800 shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setArcadeSub('consoles')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                arcadeSub === 'consoles'
                  ? 'bg-cyan-500 text-black'
                  : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
              }`}
            >
              Catalogue Arcade & Rétro (MAME, Neo Geo, 64-bit, 32-bit)
            </button>
            <button
              type="button"
              onClick={() => setArcadeSub('neogeo')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                arcadeSub === 'neogeo'
                  ? 'bg-cyan-500 text-black'
                  : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
              }`}
            >
              Neo Geo MVS / AES (181 jeux · Netplay)
            </button>
          </div>
          <span className="hidden md:inline text-[11px] font-mono text-neutral-400">
            Moteur React + FBNeo WASM + EmulatorJS · Alt+1 à Alt+5
          </span>
        </div>
      )}

      {/* Zone de contenu principale */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Toast PWA Mobile : Double-tap pour quitter */}
        {exitToastVisible && (
          <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded-full bg-neutral-900/95 border border-neutral-700 text-neutral-200 text-xs font-mono shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2">
            Appuyez encore une fois pour quitter
          </div>
        )}

        {/* Toast Notification Lancement Natif */}
        {nativeStatus && (
          <div className="fixed top-16 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl bg-cyan-950 border border-cyan-500/60 text-cyan-300 font-mono text-xs shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-4">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
            <span className="font-bold">{nativeStatus}</span>
          </div>
        )}

        {platformMode === 'arcade' && arcadeSub === 'neogeo' ? (
          <>
            <Sidebar
              selectedGenre={selectedGenre}
              onSelectGenre={setSelectedGenre}
              isBiosReady={isBiosReady}
              availableCount={installedCount}
              totalCount={gamesData.length}
              onRefreshAudit={refreshAudit}
              onOpenNetplayLobby={() => setIsLobbyOpen(true)}
              onOpenWebRtcTest={() => setIsWebRtcTestOpen(true)}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onLaunchNative={handleLaunchNativeGeneral}
              isOpenMobile={isMobileSidebarOpen}
              onCloseMobile={() => setIsMobileSidebarOpen(false)}
            />
            <GameLibrary
              games={gamesData}
              selectedGenre={selectedGenre}
              onSelectGenre={setSelectedGenre}
              isBiosReady={isBiosReady}
              isRomAvailable={isRomAvailable}
              onLaunchSolo={handleLaunchSolo}
              onLaunchNetplay={handleLaunchNetplay}
              onToggleMobileSidebar={() => setIsMobileSidebarOpen((prev) => !prev)}
            />
          </>
        ) : (
          <PlatformCatalogView
            mode={platformMode}
            onLaunchStage={setStageSession}
            onCacheChanged={refreshPlatformCache}
          />
        )}
      </div>

      {/* Lecteur unifié EmulatorJS / J2ME */}
      <UnifiedStageModal
        session={stageSession}
        settings={settings}
        onClose={() => setStageSession(null)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Modal Matchmaking Multijoueur LAN (2 à 4 Joueurs) */}
      <NetplayModal
        isOpen={isLobbyOpen}
        onClose={() => {
          setIsLobbyOpen(false);
          setNetplayPreselectedGame(null);
        }}
        games={gamesData}
        currentGame={netplayPreselectedGame || activeGame}
        onLaunchGame={handleStartNetplayGame}
        onOpenMobileController={(sessionData) => setMobileControllerSession(sessionData)}
      />

      {/* Vue Manette Sans Fil Smartphone Dédiée */}
      {mobileControllerSession && (
        <MobileControllerView
          sessionData={mobileControllerSession}
          onExit={() => setMobileControllerSession(null)}
        />
      )}

      {/* Modal Démonstrateur WebRTC 60 FPS (UDP-like) */}
      {isWebRtcTestOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="relative w-full max-w-2xl">
            <button
              onClick={() => setIsWebRtcTestOpen(false)}
              className="absolute -top-10 right-0 text-neutral-400 hover:text-white font-mono text-xs bg-neutral-900 border border-neutral-800 px-3 py-1 rounded-lg"
            >
              FERMER [ESC]
            </button>
            <WebRTCNetplayDemo />
          </div>
        </div>
      )}

      {/* Modal de Configuration Matérielle NeoRAGEx */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        updateKeyBinding={updateKeyBinding}
        updateVideoSetting={updateVideoSetting}
        updateAudioSetting={updateAudioSetting}
        updateSystemSetting={updateSystemSetting}
        updateGamepadSetting={updateGamepadSetting}
        updateTouchSetting={updateTouchSetting}
        updatePerformanceSetting={updatePerformanceSetting}
        resetToDefaults={resetToDefaults}
      />

      {/* Vue Plein Écran de l'Émulateur */}
      {activeGame && (
        gameMode === 'netplay' && !netplaySession.isHost && netplaySession.playMode === 'stream' ? (
          <RemoteStreamPlayer
            game={activeGame}
            playerIndex={netplaySession.playerIndex}
            settings={settings}
            onExit={handleExitGame}
            onOpenSettings={() => setIsSettingsOpen(true)}
            isSettingsOpen={isSettingsOpen}
          />
        ) : (
          <EmulatorCore
            game={activeGame}
            mode={gameMode}
            settings={settings}
            onExit={handleExitGame}
            onOpenSettings={() => setIsSettingsOpen(true)}
            isHost={netplaySession.isHost}
            playerIndex={netplaySession.playerIndex}
            isStreamingHost={gameMode === 'netplay' && netplaySession.isHost && netplaySession.playMode === 'stream'}
            isSettingsOpen={isSettingsOpen}
          />
        )
      )}
    </div>
  );
}
