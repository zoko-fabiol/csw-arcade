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

export function EmulatorCore({ 
  game, 
  mode = 'solo', 
  settings, 
  onExit, 
  onOpenSettings, 
  netplayService = null, 
  isHost = true 
}) {
  const containerRef = useRef(null);
  const iframeRef = useRef(null);

  const [isReady, setIsReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fps, setFps] = useState(60);
  const [ping, setPing] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  // Détection automatique du mode tactile (mobile / tablette / tactile)
  const [isTouchVisible, setIsTouchVisible] = useState(() => {
    return ('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth <= 1024);
  });

  const handleTouchInput = (buttonId, isPressed) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'TOUCH_INPUT',
        buttonId,
        isPressed
      }, '*');
    }
  };

  // 1. Initialisation des contrôles matériels avec les paramètres utilisateur
  useEffect(() => {
    if (settings) {
      inputManager.applySettings(settings);
    }
  }, [settings]);

  // 2. Initialisation des boucles de synchronisation et d'inputs
  useEffect(() => {
    let syncEngine = null;

    if (mode === 'netplay' && netplayService) {
      syncEngine = new NetplaySyncEngine(netplayService, isHost);
      syncEngine.onSyncStats = ({ rtt }) => setPing(rtt);
      syncEngine.start();

      inputManager.start(({ p1 }) => {
        syncEngine.processLocalInput(p1);
      });
    }

    return () => {
      inputManager.stop();
      if (syncEngine) syncEngine.stop();
    };
  }, [mode, netplayService, isHost]);

  // 3. Écoute des événements provenant de l'iframe player
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data?.type === 'EJS_GAME_STARTED') {
        setIsReady(true);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

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
  const playerUrl = `/player.html?game=${encodeURIComponent(game.filename)}&settings=${settingsParam}`;

  return (
    <div 
      ref={containerRef}
      className="fixed inset-0 z-50 bg-black flex flex-col select-none overflow-hidden font-mono"
    >
      {/* Barre de Contrôle Supérieure */}
      <div className="h-14 bg-neutral-950/90 border-b border-neutral-800 px-6 flex items-center justify-between text-xs text-neutral-300 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={onExit}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-neutral-700 hover:text-white transition-all active:scale-95"
          >
            <ArrowLeft className="w-4 h-4" />
            QUITTER
          </button>

          <div className="flex items-center gap-2">
            <span className="font-bold text-white tracking-wide">{game.title}</span>
            <span className="px-2 py-0.5 rounded bg-neutral-800 text-[10px] text-cyan-400">
              {game.filename}
            </span>
          </div>
        </div>

        {/* Télémétrie & Mode */}
        <div className="flex items-center gap-4">
          {mode === 'netplay' ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-red-950/80 border border-red-500/40 text-red-400 text-[11px]">
              <Radio className="w-3.5 h-3.5 animate-pulse text-red-500" />
              <span>NETPLAY {isHost ? '[HÔTE P1]' : '[INVITÉ P2]'}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/80 border border-cyan-500/40 text-cyan-400 text-[11px]">
              <Gamepad2 className="w-3.5 h-3.5" />
              <span>ARCADE 60 FPS</span>
            </div>
          )}

          {ping !== null && (
            <span className={`text-[11px] font-bold ${ping < 60 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {ping} ms
            </span>
          )}

          <span className="text-emerald-400 font-bold">{fps} FPS</span>
        </div>

        {/* Commandes Utilitaires */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsTouchVisible(!isTouchVisible)}
            className={`p-2 rounded-lg border transition-all ${
              isTouchVisible
                ? 'bg-cyan-500 text-black border-cyan-400 shadow-md'
                : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
            }`}
            title={isTouchVisible ? "Masquer commandes tactiles" : "Afficher commandes tactiles"}
          >
            <Smartphone className="w-4 h-4" />
          </button>

          <button
            onClick={onOpenSettings}
            className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 hover:text-cyan-400 transition-all"
            title="Options & Remapping Touches"
          >
            <Sliders className="w-4 h-4" />
          </button>

          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 hover:text-white transition-all"
            title="Plein Écran"
          >
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Zone de Rendu */}
      <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
        {/* Conteneur d'Écran avec Ratio Configuré */}
        <div 
          className={`relative max-h-full w-full h-full transition-all duration-200 flex items-center justify-center ${
            aspectRatio === '4:3' 
              ? 'aspect-[4/3] w-auto h-full max-w-[calc(100vh*(4/3))]' 
              : aspectRatio === 'pixel-perfect'
              ? 'w-[640px] h-[448px]'
              : 'w-full h-full'
          }`}
        >
          {/* Iframe Runner Isolé pour le Core Arcade WebAssembly */}
          <iframe
            ref={iframeRef}
            src={playerUrl}
            className="w-full h-full border-0 bg-black block"
            allow="autoplay"
            title={game.title}
          />

          {/* Calque Shaders Scanlines CRT */}
          {isScanlinesActive && (
            <div 
              className="absolute inset-0 crt-scanlines pointer-events-none z-10" 
              style={{ opacity: Math.max(0.1, (settings?.video?.intensity ?? 40) / 100) }}
            />
          )}

          {/* Overlay Tactile Virtuel Mobile / Tablette */}
          <TouchOverlay
            isVisible={isTouchVisible}
            onInput={handleTouchInput}
            onToggleVisibility={() => setIsTouchVisible(!isTouchVisible)}
          />
        </div>
      </div>
    </div>
  );
}
