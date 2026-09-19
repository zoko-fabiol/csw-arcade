import React, { useState, useEffect } from 'react';
import gamesData from './data/games.json';
import { useRomAudit } from './hooks/useRomAudit';
import { useSettings } from './hooks/useSettings';
import { Sidebar } from './components/layout/Sidebar';
import { GameLibrary } from './components/games/GameLibrary';
import { EmulatorCore } from './components/emulator/EmulatorCore';
import { NetplayModal } from './components/netplay/NetplayModal';
import { MobileControllerView } from './components/netplay/MobileControllerView';
import { WebRTCNetplayDemo } from './components/netplay/WebRTCNetplayDemo';
import { SettingsModal } from './components/settings/SettingsModal';
import { netplayService } from './services/NetplayService';

import { launchNativeNeoRAGEx } from './services/nativeLauncher';
import { useMobileNavigation, useOnlineStatus } from './hooks/useMobileNavigation';

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

  // État Session Netplay
  const [netplaySession, setNetplaySession] = useState({
    isHost: true,
    playerIndex: 0,
    role: 'p1'
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
      role: options.role ?? 'p1'
    });
    setActiveGame(game);
    setGameMode('netplay');
  };

  // Quitter le jeu et libérer les ressources
  const handleExitGame = () => {
    if (gameMode === 'netplay') {
      netplayService.leaveRoom();
      setNetplaySession({ isHost: true, playerIndex: 0, role: 'p1' });
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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-950 font-sans">
      {/* Toast PWA Mobile : Double-tap pour quitter */}
      {exitToastVisible && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded-full bg-neutral-900/95 border border-neutral-700 text-neutral-200 text-xs font-mono shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2">
          Appuyez encore une fois pour quitter
        </div>
      )}

      {/* Bannière discrète Mode Hors-Ligne (Mode Avion) */}
      {!isOnline && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-40 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-mono shadow-lg backdrop-blur-md flex items-center gap-1.5 pointer-events-none">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span>Mode Hors-Ligne • Jeux téléchargés 100% jouables</span>
        </div>
      )}
      {/* Sidebar de navigation (Desktop ancré & Mobile Drawer) */}
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

      {/* Toast Notification Lancement Natif */}
      {nativeStatus && (
        <div className="fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl bg-cyan-950 border border-cyan-500/60 text-cyan-300 font-mono text-xs shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-4">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
          <span className="font-bold">{nativeStatus}</span>
        </div>
      )}

      {/* Catalogue des jeux avec bascule Grille / Liste et hamburger */}
      <GameLibrary
        games={gamesData}
        selectedGenre={selectedGenre}
        isBiosReady={isBiosReady}
        isRomAvailable={isRomAvailable}
        onLaunchSolo={handleLaunchSolo}
        onLaunchNetplay={handleLaunchNetplay}
        onToggleMobileSidebar={() => setIsMobileSidebarOpen(prev => !prev)}
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
        resetToDefaults={resetToDefaults}
      />

      {/* Vue Plein Écran de l'Émulateur */}
      {activeGame && (
        <EmulatorCore
          game={activeGame}
          mode={gameMode}
          settings={settings}
          onExit={handleExitGame}
          onOpenSettings={() => setIsSettingsOpen(true)}
          isHost={netplaySession.isHost}
        />
      )}
    </div>
  );
}
