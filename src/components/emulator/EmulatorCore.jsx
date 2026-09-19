import React, { useEffect, useRef, useState } from 'react';
import { 
  Maximize, 
  Minimize, 
  Tv, 
  Volume2, 
  VolumeX, 
  ArrowLeft, 
  Cpu, 
  Gamepad2, 
  Loader2, 
  Radio,
  Sliders,
  Smartphone
} from 'lucide-react';
import { emulatorBridge } from '../../services/emulatorBridge';
import { inputManager } from '../../services/InputManager';
import { NetplaySyncEngine } from '../../services/NetplaySyncEngine';
import { emulatorLoader } from '../../services/emulatorLoader';
import { TouchOverlay } from './TouchOverlay';
import { useDeviceType } from '../../utils/deviceDetector';
import { netplayService } from '../../services/NetplayService';

export function EmulatorCore({ 
  game, 
  mode = 'solo', 
  settings, 
  onExit, 
  onOpenSettings, 
  isHost = true 
}) {
  const containerRef = useRef(null);
  const iframeRef = useRef(null);

  const { isMobile, isLandscape } = useDeviceType();

  const [isReady, setIsReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fps, setFps] = useState(60);
  const [ping, setPing] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [netplayRoom, setNetplayRoom] = useState(() => netplayService.currentRoom);

  // Détection automatique du mode tactile (mobile / tablette / tactile)
  const [isTouchVisible, setIsTouchVisible] = useState(() => {
    return ('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth <= 1024);
  });

  const handleTouchInput = (buttonId, isPressed) => {
    const myIdx = netplayService.myPlayerIndex >= 0 ? netplayService.myPlayerIndex : (isHost ? 0 : 1);
    if (mode === 'netplay') {
      netplayService.sendInput(buttonId, isPressed, myIdx);
    }
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'TOUCH_INPUT',
        playerIndex: myIdx,
        buttonId,
        isPressed
      }, '*');
    }
  };

  // Écoute des entrées des joueurs distants et synchronisation d'état en mode Netplay
  useEffect(() => {
    if (mode !== 'netplay') return;

    // Réception des inputs des autres joueurs (J1 pour l'invité, J2 pour l'hôte)
    const unsubInput = netplayService.on('remote_input', ({ playerIndex, buttonId, isPressed }) => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'NETPLAY_INPUT',
          playerIndex,
          buttonId,
          isPressed
        }, '*');
      }
    });

    // L'hôte reçoit une demande de synchronisation d'état (d'un joueur arrivant en cours de partie)
    const unsubReqState = netplayService.on('request_state', ({ fromPlayerIndex }) => {
      if (isHost && iframeRef.current?.contentWindow) {
        console.log('[EmulatorCore] Demande de savestate reçue pour le joueur', fromPlayerIndex);
        iframeRef.current.contentWindow.postMessage({ type: 'GET_STATE', toPlayerIndex: fromPlayerIndex }, '*');
      }
    });

    // L'invité reçoit le savestate officiel de l'hôte pour se caler sur sa frame exacte
    const unsubSyncState = netplayService.on('sync_state', ({ stateData }) => {
      if (!isHost && iframeRef.current?.contentWindow) {
        console.log('[EmulatorCore] Savestate reçu de l\'hôte, synchronisation...');
        iframeRef.current.contentWindow.postMessage({ type: 'LOAD_STATE', state: stateData }, '*');
      }
    });

    const unsubPing = netplayService.on('ping', (p) => setPing(p));
    const unsubRoom = netplayService.on('room_update', (r) => setNetplayRoom(r));

    return () => {
      unsubInput();
      unsubReqState();
      unsubSyncState();
      unsubPing();
      unsubRoom();
    };
  }, [mode, isHost]);

  // 1. Initialisation des contrôles matériels avec les paramètres utilisateur
  useEffect(() => {
    if (settings) {
      inputManager.applySettings(settings);
    }
  }, [settings]);

  // 2. Écoute des événements provenant de l'iframe player (Inputs locaux & État de démarrage)
  useEffect(() => {
    const handleMessage = (event) => {
      if (!event.data) return;

      if (event.data.type === 'EJS_GAME_STARTED') {
        setIsReady(true);
        // Si invité en Netplay, demander immédiatement le savestate actuel à l'hôte
        if (mode === 'netplay' && !isHost) {
          console.log('[EmulatorCore] Invité prêt, demande de synchronisation du savestate à l\'hôte...');
          netplayService.requestStateSync();
        }
      }

      // Quand un joueur local joue au clavier ou à la manette dans l'iframe, diffuser l'input à l'autre joueur
      if (event.data.type === 'LOCAL_INPUT' && mode === 'netplay') {
        const myIdx = netplayService.myPlayerIndex >= 0 ? netplayService.myPlayerIndex : (isHost ? 0 : 1);
        netplayService.sendInput(event.data.buttonId, event.data.isPressed, myIdx);
      }

      // L'iframe de l'hôte a extrait le savestate, l'envoyer au joueur distant
      if (event.data.type === 'STATE_DATA' && mode === 'netplay' && isHost) {
        console.log('[EmulatorCore] Savestate extrait par l\'iframe, transmission au joueur distant...');
        netplayService.sendStateSync(event.data.state);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [mode, isHost]);

  // Gestion plein écran universel (iOS Safari WebKit, Android Chrome, Desktop)
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    const elem = containerRef.current;
    const isCurrentlyFs = !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    );

    if (!isCurrentlyFs) {
      const req = elem.requestFullscreen || elem.webkitRequestFullscreen || elem.mozRequestFullScreen || elem.msRequestFullscreen;
      if (req) {
        req.call(elem).then(() => {
          setIsFullscreen(true);
          // Tenter de verrouiller en paysage si sur mobile
          if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.lock === 'function') {
            screen.orientation.lock('landscape').catch(() => {});
          }
        }).catch(() => {
          setIsFullscreen(true);
        });
      }
    } else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
      if (exit) {
        exit.call(document).then(() => {
          setIsFullscreen(false);
          if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.unlock === 'function') {
            try { screen.orientation.unlock(); } catch(e) {}
          }
        }).catch(() => {
          setIsFullscreen(false);
        });
      }
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      const isCurrentlyFs = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      );
      setIsFullscreen(isCurrentlyFs);
    };

    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
    };
  }, []);

  // 4. Synchronisation en temps réel des paramètres avec le player dans l'iframe
  useEffect(() => {
    if (iframeRef.current?.contentWindow && settings) {
      iframeRef.current.contentWindow.postMessage({
        type: 'UPDATE_SETTINGS',
        settings
      }, '*');
    }
  }, [settings]);

  // 5. Transfert transparent des touches du clavier vers le player de l'iframe
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Éviter d'intercepter les saisies de formulaires ou inputs
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'KEY_EVENT',
          eventType: 'keydown',
          keyCode: e.keyCode,
          code: e.code
        }, '*');
      }
    };

    const handleKeyUp = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'KEY_EVENT',
          eventType: 'keyup',
          keyCode: e.keyCode,
          code: e.code
        }, '*');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const isScanlinesActive = settings?.video?.scanlines ?? true;
  const aspectRatio = settings?.video?.aspectRatio ?? '4:3';
  const settingsParam = encodeURIComponent(JSON.stringify(settings || {}));
  const playerUrl = `./player.html?game=${encodeURIComponent(game.filename)}&settings=${settingsParam}`;

  const isPortraitPadMode = isMobile && !isLandscape && (settings?.touch?.portraitMode ?? 'pad-bottom') === 'pad-bottom' && isTouchVisible;

  return (
    <div 
      ref={containerRef}
      className="fixed inset-0 z-50 bg-black flex flex-col select-none overflow-hidden font-mono"
    >
      {/* Barre de Contrôle Supérieure Responsive */}
      <div className="h-11 sm:h-14 bg-neutral-950/95 border-b border-neutral-800 px-2.5 sm:px-6 flex items-center justify-between text-xs text-neutral-300 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <button
            onClick={onExit}
            className="flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-neutral-700 hover:text-white transition-all active:scale-95 text-[11px] sm:text-xs font-bold shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden xs:inline">QUITTER</span>
          </button>

          <div className="flex items-center gap-1.5 truncate">
            <span className="font-bold text-white tracking-wide truncate text-[11px] sm:text-sm">
              {game.title}
            </span>
            <span className="hidden md:inline px-2 py-0.5 rounded bg-neutral-800 text-[10px] text-cyan-400">
              {game.filename}
            </span>
          </div>
        </div>

        {/* Télémétrie & Mode */}
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          {mode === 'netplay' ? (
            <div className="flex items-center gap-1.5 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full bg-cyan-950/90 border border-cyan-500/50 text-cyan-300 text-[10px] sm:text-[11px]">
              <Radio className="w-3 h-3 animate-pulse text-cyan-400" />
              <span className="hidden sm:inline">
                LAN {netplayRoom?.code ? `[${netplayRoom.code}]` : ''} {isHost ? '• HÔTE (J1)' : `• JOUEUR ${netplayService.myPlayerIndex >= 0 ? netplayService.myPlayerIndex + 1 : 2}`}
                {netplayRoom ? ` (${netplayRoom.players ? netplayRoom.players.filter(Boolean).length : 2}/${netplayRoom.maxPlayers || 2}P)` : ''}
              </span>
              <span className="sm:hidden">
                {netplayRoom?.code || 'LAN'} {isHost ? 'J1' : `J${netplayService.myPlayerIndex >= 0 ? netplayService.myPlayerIndex + 1 : 2}`}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full bg-cyan-950/80 border border-cyan-500/40 text-cyan-400 text-[10px] sm:text-[11px]">
              <Gamepad2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="hidden sm:inline">ARCADE 60 FPS</span>
              <span className="sm:hidden">60 FPS</span>
            </div>
          )}

          {ping !== null && (
            <span className={`text-[10px] sm:text-[11px] font-bold ${ping < 60 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {ping}ms
            </span>
          )}

          <span className="text-emerald-400 font-bold text-[10px] sm:text-xs">{fps} FPS</span>
        </div>

        {/* Commandes Utilitaires */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            onClick={() => setIsTouchVisible(!isTouchVisible)}
            className={`p-1.5 sm:p-2 rounded-lg border transition-all ${
              isTouchVisible
                ? 'bg-cyan-500 text-black border-cyan-400 shadow-md'
                : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
            }`}
            title={isTouchVisible ? "Masquer commandes tactiles" : "Afficher commandes tactiles"}
          >
            <Smartphone className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          <button
            onClick={onOpenSettings}
            className="p-1.5 sm:p-2 rounded-lg bg-neutral-900 border border-neutral-800 hover:text-cyan-400 transition-all"
            title="Options & Paramètres"
          >
            <Sliders className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          <button
            onClick={toggleFullscreen}
            className={`p-1.5 sm:p-2 rounded-lg border transition-all ${
              isFullscreen 
                ? 'bg-amber-500 text-black border-amber-400 font-bold' 
                : 'bg-neutral-900 border-neutral-800 hover:text-white'
            }`}
            title="Plein Écran"
          >
            {isFullscreen ? <Minimize className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Maximize className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
          </button>
        </div>
      </div>

      {/* Zone de Rendu : Deux modes intelligents */}
      {isPortraitPadMode ? (
        /* MODE A : PORTRAIT MOBILE SMARTPHONE AVEC ARCADE PAD EN BAS */
        <div className="flex-1 flex flex-col w-full h-full overflow-hidden bg-black">
          {/* Écran de Jeu 4:3 en haut */}
          <div className="w-full aspect-[4/3] max-h-[46vh] relative flex items-center justify-center bg-black border-b border-neutral-800/80 shrink-0">
            <iframe
              ref={iframeRef}
              src={playerUrl}
              className="w-full h-full border-0 bg-black block"
              allow="autoplay"
              title={game.title}
            />
            {isScanlinesActive && (
              <div 
                className="absolute inset-0 crt-scanlines pointer-events-none z-10" 
                style={{ opacity: Math.max(0.1, (settings?.video?.intensity ?? 40) / 100) }}
              />
            )}
          </div>

          {/* Manette tactile dédiée en bas sans recouvrir le jeu */}
          <div className="flex-1 relative w-full bg-gradient-to-b from-neutral-950 via-neutral-900 to-black overflow-hidden flex flex-col justify-center">
            <TouchOverlay
              isVisible={isTouchVisible}
              onInput={handleTouchInput}
              onToggleVisibility={() => setIsTouchVisible(!isTouchVisible)}
              settings={settings}
              isPortraitPad={true}
            />
          </div>
        </div>
      ) : (
        /* MODE B : MODE STANDARD / PAYSAGE / OVERLAY LIBRE */
        <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
          <div 
            className={`relative max-h-full w-full h-full transition-all duration-200 flex items-center justify-center ${
              aspectRatio === '4:3' 
                ? 'aspect-[4/3] w-auto h-full max-w-[calc(100vh*(4/3))]' 
                : aspectRatio === 'pixel-perfect'
                ? 'w-[640px] h-[448px]'
                : 'w-full h-full'
            }`}
          >
            <iframe
              ref={iframeRef}
              src={playerUrl}
              className="w-full h-full border-0 bg-black block"
              allow="autoplay"
              title={game.title}
            />

            {isScanlinesActive && (
              <div 
                className="absolute inset-0 crt-scanlines pointer-events-none z-10" 
                style={{ opacity: Math.max(0.1, (settings?.video?.intensity ?? 40) / 100) }}
              />
            )}
          </div>

          {/* Overlay tactile transparent flottant sur toute la fenêtre */}
          <TouchOverlay
            isVisible={isTouchVisible}
            onInput={handleTouchInput}
            onToggleVisibility={() => setIsTouchVisible(!isTouchVisible)}
            settings={settings}
            isPortraitPad={false}
          />
        </div>
      )}
    </div>
  );
}
