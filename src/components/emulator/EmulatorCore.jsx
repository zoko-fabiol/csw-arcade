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
  RefreshCw,
  WifiOff,
  Sliders,
  Smartphone,
  Zap,
  Clock,
  Check,
  Activity
} from 'lucide-react';
import { emulatorBridge } from '../../services/emulatorBridge';
import { inputManager } from '../../services/InputManager';
import { NetplaySyncEngine } from '../../services/NetplaySyncEngine';
import { emulatorLoader } from '../../services/emulatorLoader';
import { TouchOverlay } from './TouchOverlay';
import { useDeviceType } from '../../utils/deviceDetector';
import { netplayService } from '../../services/NetplayService';
import { RollbackManager } from '../../services/RollbackManager';
import { NetplayDebugOverlay } from './NetplayDebugOverlay';

export function EmulatorCore({ 
  game, 
  onExit, 
  settings, 
  onOpenSettings,
  mode = 'solo', // 'solo' | 'netplay'
  netplayRoom = null,
  isHost = true,
  playerIndex = 0
}) {
  const iframeRef = useRef(null);
  const containerRef = useRef(null);
  const [fps, setFps] = useState(60);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isTouchVisible, setIsTouchVisible] = useState(() => {
    // Par défaut sur smartphone, tablette ou écran vertical : activé
    if (typeof window !== 'undefined') {
      return window.innerWidth <= 1024 || 'ontouchstart' in window || (navigator.maxTouchPoints > 0) || window.innerHeight > window.innerWidth;
    }
    return true;
  });
  const [aspectRatio, setAspectRatio] = useState(settings?.video?.aspectRatio || '4:3');
  const [interrupted, setInterrupted] = useState({ isInterrupted: false, message: '' });
  const [ping, setPing] = useState(null);
  const [isP2PDirect, setIsP2PDirect] = useState(false);
  const [inputDelay, setInputDelay] = useState(0);
  const [syncNotification, setSyncNotification] = useState(null);

  const { isMobile } = useDeviceType();
  const [windowOrientation, setWindowOrientation] = useState(() => 
    typeof window !== 'undefined' && window.innerHeight > window.innerWidth ? 'portrait' : 'landscape'
  );

  // Détection réactive du mode portrait mobile avec resize et orientationchange
  useEffect(() => {
    const handleResize = () => {
      const isPort = window.innerHeight > window.innerWidth;
      setWindowOrientation(isPort ? 'portrait' : 'landscape');
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  const isPortrait = windowOrientation === 'portrait' || (typeof window !== 'undefined' && window.innerHeight > window.innerWidth);
  const isPortraitPadMode = (isMobile || (typeof window !== 'undefined' && (window.innerWidth <= 1024 || 'ontouchstart' in window || navigator.maxTouchPoints > 0 || isPortrait))) 
    && isPortrait 
    && (settings?.touch?.portraitMode ?? 'pad-bottom') === 'pad-bottom';

  const hasSyncedInitialState = useRef(false);
  const syncEngineRef = useRef(null);
  const rollbackManagerRef = useRef(null);
  const [rollbackStats, setRollbackStats] = useState({});
  const [showDebugOverlay, setShowDebugOverlay] = useState(false);
  const [networkSim, setNetworkSim] = useState({ latency: 0, jitter: 0, packetLoss: 0 });

  // Raccourci F8 pour basculer le HUD GGPO Rollback
  useEffect(() => {
    const handleF8 = (e) => {
      if (e.key === 'F8' || e.keyCode === 119) {
        e.preventDefault();
        setShowDebugOverlay((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleF8);
    return () => window.removeEventListener('keydown', handleF8);
  }, []);

  const handleTouchInput = (buttonId, isPressed) => {
    const myIdx = netplayService.myPlayerIndex >= 0 ? netplayService.myPlayerIndex : (isHost ? 0 : 1);
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'TOUCH_INPUT',
        playerIndex: myIdx,
        buttonId,
        isPressed
      }, '*');
    }
  };

  // Quitter le jeu et nettoyer la session netplay
  const handleExitGame = () => {
    if (mode === 'netplay') {
      try {
        netplayService.leaveRoom();
      } catch(e) {}
    }
    onExit();
  };

  // Déclenchement manuel de resynchronisation sur l'autre joueur (J1 <-> J2)
  const handleTriggerResync = () => {
    if (mode !== 'netplay') return;
    setSyncNotification("Synchronisation avec l'autre joueur...");
    netplayService.requestStateSync();
  };

  // Écoute des entrées des joueurs distants et synchronisation bidirectionnelle d'état
  useEffect(() => {
    if (mode !== 'netplay') return;

    // Réception des inputs des autres joueurs (J1 pour l'invité, J2 pour l'hôte)
    const unsubInput = netplayService.on('remote_input', ({ playerIndex, buttonId, isPressed, frame, recovered }) => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'NETPLAY_INPUT',
          playerIndex,
          buttonId,
          isPressed,
          frame,
          recovered
        }, '*');
      }
    });

    // Réception d'une demande de savestate (Bidirectionnel : J1 demande à J2 OU J2 demande à J1)
    const unsubReqState = netplayService.on('request_state', ({ fromPlayerIndex }) => {
      const myIdx = netplayService.myPlayerIndex >= 0 ? netplayService.myPlayerIndex : (isHost ? 0 : 1);
      if (fromPlayerIndex !== myIdx && iframeRef.current?.contentWindow) {
        console.log(`[EmulatorCore] Demande de savestate reçue du joueur J${(fromPlayerIndex ?? 0) + 1}. Capture en cours...`);
        iframeRef.current.contentWindow.postMessage({ type: 'GET_STATE', toPlayerIndex: fromPlayerIndex }, '*');
      }
    });

    // Réception du savestate (Bidirectionnel : J1 ou J2 applique l'état de l'autre joueur)
    const unsubSyncState = netplayService.on('sync_state', ({ stateBase64, stateData, fromPlayerIndex, toPlayerIndex, isHeartbeat }) => {
      const myIdx = netplayService.myPlayerIndex >= 0 ? netplayService.myPlayerIndex : (isHost ? 0 : 1);
      if (fromPlayerIndex !== myIdx && (toPlayerIndex === undefined || toPlayerIndex === null || toPlayerIndex === myIdx)) {
        if (iframeRef.current?.contentWindow) {
          console.log(`[EmulatorCore] Savestate reçu du joueur distant J${(fromPlayerIndex ?? 0) + 1}. Application...`);
          hasSyncedInitialState.current = true;
          iframeRef.current.contentWindow.postMessage({
            type: 'LOAD_STATE',
            stateBase64: stateBase64 || null,
            state: stateData || null,
            isHeartbeat: !!isHeartbeat
          }, '*');
          if (!isHeartbeat) {
            setSyncNotification(`Synchronisé sur le Joueur ${fromPlayerIndex + 1} !`);
            setTimeout(() => setSyncNotification(null), 2500);
          }
        }
      }
    });

    // Gestion de la déconnexion de l'autre joueur / arrêt automatique de partie
    const handleDisconnection = (data) => {
      const msg = (data && data.message) ? data.message : "L'autre joueur a quitté la partie.";
      console.log('[EmulatorCore] Interruption de partie détectée :', msg);
      setInterrupted({ isInterrupted: true, message: msg });
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'APP_VISIBILITY', visible: false }, '*');
      }
    };

    const unsubPeerLeft = netplayService.on('peer_left', handleDisconnection);
    const unsubHostDisc = netplayService.on('host_disconnected', (msg) => handleDisconnection({ message: msg }));

    const unsubPing = netplayService.on('ping', (p) => setPing(p));
    const unsubRoom = netplayService.on('room_update', (r) => setNetplayRoom(r));
    const unsubP2POn = netplayService.on('p2p_connected', () => setIsP2PDirect(true));
    const unsubP2POff = netplayService.on('p2p_disconnected', () => setIsP2PDirect(false));
    const unsubDelay = netplayService.on('delay_update', (d) => setInputDelay(d));

    // Déverrouillage simultané Frame 0 commandé par la barrière
    const unsubSimStart = netplayService.on('start_simulation_now', (data) => {
      console.log('[EmulatorCore] Top départ synchronisé reçu ! Transmission à l\'iframe...');
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'START_SIMULATION_NOW',
          startTime: data?.startTime || Date.now()
        }, '*');
      }
    });

    // Demande de rattrapage / savestate du survivant (respawn après Game Over / crédit)
    const unsubSurvivorReq = netplayService.on('survivor_catchup_requested', ({ fromPlayerIndex }) => {
      const myIdx = netplayService.myPlayerIndex >= 0 ? netplayService.myPlayerIndex : (isHost ? 0 : 1);
      if (fromPlayerIndex !== myIdx && iframeRef.current?.contentWindow) {
        console.log(`[EmulatorCore] Le joueur J${(fromPlayerIndex ?? 0) + 1} réapparaît (respawn). Extraction immédiate de l'état du survivant...`);
        iframeRef.current.contentWindow.postMessage({
          type: 'GET_STATE',
          toPlayerIndex: fromPlayerIndex,
          isHeartbeat: false
        }, '*');
      }
    });

    // Relais bidirectionnel WebRTC -> Iframe pour les paquets binaires Rollback (0x5A) et Checksums (0xCB)
    const unsubBinary = netplayService.on('binary_data', (buf) => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'NETPLAY_BINARY_PACKET',
          buffer: buf
        }, '*');
      }
    });

    return () => {
      unsubInput();
      unsubReqState();
      unsubSyncState();
      unsubPeerLeft();
      unsubHostDisc();
      unsubPing();
      unsubRoom();
      unsubP2POn();
      unsubP2POff();
      unsubDelay();
      unsubSimStart();
      unsubSurvivorReq();
      unsubBinary();
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

      // Barrière de synchronisation : notification que le core FBNeo est prêt dans l'iframe
      if (event.data.type === 'CORE_READY_BARRIER' && mode === 'netplay') {
        console.log('[EmulatorCore] Core FBNeo prêt et verrouillé à la Frame 0. Notification à la barrière Netplay...');
        netplayService.notifyCoreReady();
      }

      if (event.data.type === 'EJS_GAME_STARTED') {
        console.log('[EmulatorCore] EJS_GAME_STARTED reçu de l\'iframe player');
      }

      // Relais Iframe -> WebRTC des paquets binaires Rollback ultra-rapides (0x5A / 0xCB)
      if (event.data.type === 'NETPLAY_BINARY_PACKET' && event.data.buffer && mode === 'netplay') {
        netplayService.sendBinary(event.data.buffer);
      }

      // Réception de la télémétrie GGPO émise par le moteur Rollback de l'iframe
      if (event.data.type === 'ROLLBACK_TELEMETRY' && event.data.stats && mode === 'netplay') {
        setRollbackStats(event.data.stats);
      }

      // Quand un joueur local joue au clavier ou à la manette dans l'iframe, diffuser l'input à l'autre joueur
      if (event.data.type === 'LOCAL_INPUT' && mode === 'netplay') {
        const myIdx = typeof event.data.playerIndex === 'number' ? event.data.playerIndex : (netplayService.myPlayerIndex >= 0 ? netplayService.myPlayerIndex : (isHost ? 0 : 1));
        netplayService.sendInput(event.data.buttonId, event.data.isPressed, myIdx);
      }

      // Notification crédit / start pour information
      if (event.data.type === 'PLAYER_INSERTED_COIN_OR_START' && mode === 'netplay') {
        console.log('[EmulatorCore] Crédit / Start synchronisé pour le joueur', event.data.playerIndex + 1);
      }

      // L'iframe a extrait le savestate (soit l'hôte soit l'invité), l'envoyer au joueur distant
      if (event.data.type === 'STATE_DATA' && mode === 'netplay') {
        if (!event.data.isHeartbeat) {
          console.log('[EmulatorCore] Savestate extrait par l\'iframe, transmission au joueur demandeur...');
        }
        netplayService.sendStateSync({
          stateBase64: event.data.stateBase64 || null,
          stateSize: event.data.stateSize || 0,
          isHeartbeat: !!event.data.isHeartbeat
        }, event.data.toPlayerIndex);
      }

      // Hôte : relayer les deltas d'entités (monstres & objets) vers l'invité
      if (event.data.type === 'WORLD_ENTITIES_DELTA' && mode === 'netplay') {
        syncEngineRef.current?.sendWorldEntities(event.data.frame, event.data.entities);
      }

      // Invité : relayer la position du joueur 2 vers l'hôte
      if (event.data.type === 'PLAYER_ENTITY_POS' && mode === 'netplay') {
        syncEngineRef.current?.sendPlayerEntity(event.data.frame, event.data.x, event.data.y);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [mode, isHost]);

  // Screen Wake Lock API et veille zéro-consommation en arrière-plan
  useEffect(() => {
    let wakeLock = null;

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator && !document.hidden) {
          wakeLock = await navigator.wakeLock.request('screen');
        }
      } catch (err) {}
    };

    requestWakeLock();

    const handleVisibility = () => {
      if (document.hidden) {
        if (wakeLock) {
          wakeLock.release().catch(() => {});
          wakeLock = null;
        }
        // Couper le son et suspendre le CPU FBNeo en arrière-plan (0 mW de batterie)
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage({ type: 'APP_VISIBILITY', visible: false }, '*');
        }
      } else {
        requestWakeLock();
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage({ type: 'APP_VISIBILITY', visible: true }, '*');
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (wakeLock) {
        wakeLock.release().catch(() => {});
      }
    };
  }, []);

  // Gestion plein écran universel sans forcer l'orientation si le téléphone est verrouillé en portrait
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
          // Tenter l'orientation paysage uniquement si l'appareil est déjà tenu horizontalement
          if (isLandscape && typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.lock === 'function') {
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

  // Synchronisation de l'index du joueur avec l'iframe
  useEffect(() => {
    if (iframeRef.current?.contentWindow && mode === 'netplay') {
      const pIdx = netplayService.myPlayerIndex >= 0 ? netplayService.myPlayerIndex : (isHost ? 0 : 1);
      iframeRef.current.contentWindow.postMessage({
        type: 'SET_PLAYER_INDEX',
        playerIndex: pIdx
      }, '*');
    }
  }, [mode, isHost, netplayRoom]);

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
  const myPlayerSlot = netplayService.myPlayerIndex >= 0 ? netplayService.myPlayerIndex : (isHost ? 0 : 1);
  const settingsParam = encodeURIComponent(JSON.stringify(settings || {}));
  const playerUrl = `./player.html?game=${encodeURIComponent(game.filename)}&settings=${settingsParam}&playerIndex=${myPlayerSlot}&netplay=${mode === 'netplay' ? 1 : 0}`;

  return (
    <div 
      ref={containerRef}
      className="fixed inset-0 z-50 bg-black flex flex-col select-none overflow-hidden font-mono touch-none"
    >
      {/* Barre de Contrôle Supérieure Responsive */}
      <div className="h-11 sm:h-14 bg-neutral-950/95 border-b border-neutral-800 px-2.5 sm:px-6 flex items-center justify-between text-xs text-neutral-300 backdrop-blur-md shrink-0 pt-safe pl-safe pr-safe">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <button
            onClick={handleExitGame}
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
                {netplayRoom?.code ? `[${netplayRoom.code}]` : ''} {isHost ? 'HÔTE (J1)' : `JOUEUR ${netplayService.myPlayerIndex >= 0 ? netplayService.myPlayerIndex + 1 : 2}`}
                {netplayRoom ? ` (${netplayRoom.players ? netplayRoom.players.filter(Boolean).length : 2}/${netplayRoom.maxPlayers || 2}P)` : ''}
              </span>
              <span className="sm:hidden">
                {netplayRoom?.code || 'NET'} {isHost ? 'J1' : `J${netplayService.myPlayerIndex >= 0 ? netplayService.myPlayerIndex + 1 : 2}`}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 ${isP2PDirect ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'}`}>
                {isP2PDirect ? <Zap className="w-2.5 h-2.5 fill-current" /> : <Clock className="w-2.5 h-2.5" />}
                <span>{isP2PDirect ? 'UDP Direct' : 'Relais'}</span>
              </span>
              {inputDelay > 0 && (
                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40" title="Buffer adaptatif de compensation intercontinentale GGPO">
                  {inputDelay}F Delay
                </span>
              )}
              <button
                onClick={() => setShowDebugOverlay(prev => !prev)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 transition-all ${showDebugOverlay ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-400' : 'bg-neutral-800 text-neutral-300 hover:text-cyan-300'}`}
                title="Afficher/Masquer le HUD GGPO Rollback (F8)"
              >
                <Activity className="w-2.5 h-2.5" />
                <span>HUD</span>
              </button>
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
          {mode === 'netplay' && (
            <button
              onClick={handleTriggerResync}
              className="flex items-center gap-1.5 px-2.5 py-1 sm:py-1.5 rounded-lg bg-cyan-950/80 border border-cyan-500/50 hover:bg-cyan-900 text-cyan-300 transition-all active:scale-95 text-[10px] sm:text-xs font-bold shadow-sm"
              title="Synchroniser mon jeu sur le joueur en tête (J1 ↔ J2)"
            >
              <RefreshCw className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-cyan-400" />
              <span className="hidden xs:inline">SYNCHRO</span>
            </button>
          )}

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

      {/* Toast Notification de Synchronisation */}
      {syncNotification && (
        <div className="absolute top-12 sm:top-16 left-1/2 -translate-x-1/2 z-[80] bg-cyan-950/95 border border-cyan-400/80 text-cyan-200 px-4 py-1.5 rounded-full text-xs font-sans shadow-lg shadow-cyan-500/20 backdrop-blur-md animate-in fade-in slide-in-from-top-2 pointer-events-none flex items-center gap-1.5">
          {syncNotification.includes('Synchronisé') ? (
            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0" />
          )}
          <span>{syncNotification}</span>
        </div>
      )}

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

      {/* Modal d'Interruption / Déconnexion Arcade */}
      {interrupted.isInterrupted && (
        <div className="absolute inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-neutral-900 border-2 border-red-500/70 rounded-2xl max-w-md w-full p-6 text-center shadow-[0_0_60px_rgba(239,68,68,0.4)] animate-in fade-in zoom-in-95">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto mb-4 text-red-400">
              <WifiOff className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-black tracking-wider text-white mb-2 uppercase font-sans">
              Partie Interrompue
            </h3>
            <p className="text-xs sm:text-sm text-neutral-300 mb-6 leading-relaxed font-sans">
              {interrupted.message || "L'autre joueur a quitté la partie ou a été déconnecté. La session est terminée."}
            </p>
            <button
              onClick={handleExitGame}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold tracking-wide shadow-lg shadow-red-600/30 active:scale-95 transition-all text-xs sm:text-sm uppercase flex items-center justify-center gap-2 font-sans"
            >
              <ArrowLeft className="w-4 h-4" />
              Retourner au Menu
            </button>
          </div>
        </div>
      )}

      {/* Overlay Debug GGPO Rollback & Simulateur Réseau */}
      {mode === 'netplay' && (
        <NetplayDebugOverlay
          visible={showDebugOverlay}
          stats={rollbackStats}
          networkStats={{ ping: ping ?? 0, jitter: 1.5, packetLoss: networkSim.packetLoss }}
          networkSimulator={networkSim}
          onSimulatorChange={(sim) => {
            setNetworkSim(sim);
            netplayService.setNetworkSimulator(sim);
          }}
          onClose={() => setShowDebugOverlay(false)}
        />
      )}
    </div>
  );
}
