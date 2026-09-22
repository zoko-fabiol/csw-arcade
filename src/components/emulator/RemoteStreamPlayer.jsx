import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Maximize2, Minimize2, Volume2, VolumeX, Wifi, Zap } from 'lucide-react';
import { netplayService } from '../../services/NetplayService';
import { TouchOverlay } from './TouchOverlay';

export function RemoteStreamPlayer({
  game,
  onExit,
  settings,
  onOpenSettings
}) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [fps, setFps] = useState(60);
  const [ping, setPing] = useState(netplayService.ping || 15);
  const [isTouchVisible, setIsTouchVisible] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth <= 1024 || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    }
    return true;
  });

  // 1. Réception et attachement du flux vidéo WebRTC
  useEffect(() => {
    // Si un flux existe déjà
    if (netplayService.remoteStream && videoRef.current) {
      videoRef.current.srcObject = netplayService.remoteStream;
      videoRef.current.play().catch(() => {});
      setStreamConnected(true);
    }

    const unsubStream = netplayService.on('stream_received', (stream) => {
      console.log('[RemoteStreamPlayer] Flux vidéo & audio WebRTC reçu du joueur 1 !');
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
        setStreamConnected(true);
      }
    });

    const unsubPing = netplayService.on('ping', (p) => setPing(p));

    return () => {
      unsubStream();
      unsubPing();
    };
  }, []);

  // Mesure du FPS réel
  useEffect(() => {
    let animId;
    let frameCount = 0;
    let lastTime = performance.now();

    const checkLoop = () => {
      frameCount++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        setFps(Math.round((frameCount * 1000) / (now - lastTime)));
        frameCount = 0;
        lastTime = now;
      }
      animId = requestAnimationFrame(checkLoop);
    };

    animId = requestAnimationFrame(checkLoop);
    return () => cancelAnimationFrame(animId);
  }, []);

  // 2. Envoi des entrées Joueur 2 vers l'Hôte
  const handleInput = useCallback((buttonId, isPressed) => {
    netplayService.sendInput(buttonId, isPressed, 1);
  }, []);

  // 3. Contrôles clavier Joueur 2
  useEffect(() => {
    const KEY_MAP = {
      ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7,
      KeyW: 4, KeyS: 5, KeyA: 6, KeyD: 7,
      KeyJ: 0, KeyK: 8, KeyU: 1, KeyI: 9,
      Numpad4: 0, Numpad5: 8, Numpad7: 1, Numpad8: 9,
      Digit5: 2, Digit6: 2, KeyC: 2,
      Digit1: 3, Digit2: 3, Enter: 3
    };

    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const btn = KEY_MAP[e.code];
      if (btn !== undefined) {
        handleInput(btn, true);
      }
    };

    const onKeyUp = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const btn = KEY_MAP[e.code];
      if (btn !== undefined) {
        handleInput(btn, false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [handleInput]);

  // 4. Polling Gamepad physique Joueur 2
  useEffect(() => {
    let padLoop;
    const lastPadState = {};

    const poll = () => {
      if (navigator.getGamepads) {
        const pads = navigator.getGamepads();
        const gp = pads[0] || pads[1];
        if (gp && gp.connected) {
          const check = (btnId, pressed) => {
            if (lastPadState[btnId] !== pressed) {
              lastPadState[btnId] = pressed;
              handleInput(btnId, pressed);
            }
          };
          check(4, !!gp.buttons[12]?.pressed || gp.axes[1] < -0.4);
          check(5, !!gp.buttons[13]?.pressed || gp.axes[1] > 0.4);
          check(6, !!gp.buttons[14]?.pressed || gp.axes[0] < -0.4);
          check(7, !!gp.buttons[15]?.pressed || gp.axes[0] > 0.4);
          check(0, !!gp.buttons[0]?.pressed); // A
          check(8, !!gp.buttons[1]?.pressed); // B
          check(1, !!gp.buttons[2]?.pressed); // C
          check(9, !!gp.buttons[3]?.pressed); // D
          check(2, !!gp.buttons[8]?.pressed); // Select / Coin
          check(3, !!gp.buttons[9]?.pressed); // Start
        }
      }
      padLoop = requestAnimationFrame(poll);
    };

    padLoop = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(padLoop);
  }, [handleInput]);

  // Plein écran
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  };

  const handleExit = () => {
    netplayService.leaveRoom();
    onExit();
  };

  return (
    <div 
      ref={containerRef}
      className="fixed inset-0 z-50 bg-black flex flex-col select-none overflow-hidden font-mono touch-none"
    >
      {/* Barre de contrôle supérieure */}
      <div className="h-11 sm:h-14 bg-neutral-950/95 border-b border-neutral-800 px-3 sm:px-6 flex items-center justify-between text-xs text-neutral-300 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={handleExit}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-neutral-700 hover:text-white transition-all text-xs font-bold"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>QUITTER</span>
          </button>

          <span className="font-bold text-white uppercase hidden sm:inline-block">
            {game?.title || 'Partie Arcade'}
          </span>

          <span className="text-[10px] px-2 py-0.5 rounded border border-rose-500/40 bg-rose-500/10 text-rose-400 font-bold">
            J2 (INVITÉ)
          </span>

          <span className="text-[10px] px-2 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-400 font-bold flex items-center gap-1">
            <Zap className="w-3 h-3 text-cyan-400 animate-pulse" />
            <span>STREAM P2P 60 FPS</span>
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-neutral-900/80 px-2.5 py-1 rounded-lg border border-neutral-800">
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-emerald-400 font-bold text-[11px]">{ping} ms</span>
            <span className="text-neutral-500">|</span>
            <span className="text-cyan-400 font-bold text-[11px]">{fps} FPS</span>
          </div>

          <button
            onClick={() => setIsMuted(prev => !prev)}
            className="p-1.5 rounded-lg bg-neutral-900 border border-neutral-800 hover:text-white"
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5 text-neutral-300" />}
          </button>

          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg bg-neutral-900 border border-neutral-800 hover:text-white"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Zone d'affichage du stream vidéo */}
      <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isMuted}
          className="w-full h-full object-contain pointer-events-none"
          style={{ imageRendering: 'pixelated' }}
        />

        {!streamConnected && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 z-20">
            <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-neutral-400 font-mono">
              Connexion au flux vidéo direct de l'Hôte...
            </span>
          </div>
        )}

        {/* Overlay tactile Joueur 2 pour smartphones & tablettes */}
        {isTouchVisible && (
          <TouchOverlay
            isVisible={isTouchVisible}
            onInput={handleInput}
            onToggleVisibility={() => setIsTouchVisible(prev => !prev)}
            settings={settings}
          />
        )}
      </div>
    </div>
  );
}
