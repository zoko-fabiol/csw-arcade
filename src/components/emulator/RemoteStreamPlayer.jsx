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
  const userExplicitlyMuted = useRef(false);

  const [isFullscreen, setIsFullscreen] = useState(false);
  // Démarrer muet par sécurité pour satisfaire la politique d'autoplay des navigateurs mobiles
  const [isMuted, setIsMuted] = useState(true);
  const [audioBlockedNotice, setAudioBlockedNotice] = useState(false);
  const [hasVideoData, setHasVideoData] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [fps, setFps] = useState(60);
  const [ping, setPing] = useState(netplayService.ping || 15);
  const [isTouchVisible, setIsTouchVisible] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth <= 1024 || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    }
    return true;
  });

  const [windowOrientation, setWindowOrientation] = useState(() => 
    typeof window !== 'undefined' && window.innerHeight > window.innerWidth ? 'portrait' : 'landscape'
  );

  // Détection réactive de l'orientation mobile
  useEffect(() => {
    const handleResize = () => {
      setWindowOrientation(window.innerHeight > window.innerWidth ? 'portrait' : 'landscape');
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  const isPortrait = windowOrientation === 'portrait' || (typeof window !== 'undefined' && window.innerHeight > window.innerWidth);
  const isPortraitPadMode = isPortrait && (settings?.touch?.portraitMode ?? 'pad-bottom') === 'pad-bottom';

  // Lancement garanti du flux vidéo sans blocage autoplay
  const attachAndPlayStream = useCallback(async (stream) => {
    if (!videoRef.current || !stream) return;
    console.log('[RemoteStreamPlayer] Attachement du MediaStream au lecteur vidéo...', stream.getTracks());
    videoRef.current.srcObject = stream;
    setStreamConnected(true);

    const vTrack = stream.getVideoTracks()[0];
    if (vTrack) {
      if (!vTrack.muted) {
        setHasVideoData(true);
      }
      vTrack.onunmute = () => {
        console.log('[RemoteStreamPlayer] ✓ Piste vidéo WebRTC active (unmute) !');
        setHasVideoData(true);
        videoRef.current?.play().catch(() => {});
      };
    }

    try {
      // 1. Tenter la lecture
      await videoRef.current.play();
      console.log('[RemoteStreamPlayer] ✓ Lecture vidéo 60 FPS démarrée ! Dimensions:', videoRef.current.videoWidth, 'x', videoRef.current.videoHeight);
      if (videoRef.current.videoWidth > 0) {
        setHasVideoData(true);
      }
    } catch (err) {
      console.warn('[RemoteStreamPlayer] Lecture directe bloquée par le navigateur (autoplay policy), bascule en muet :', err.message);
      // 2. Fallback muet garanti pour démarrer le flux visuel immédiatement
      if (videoRef.current) {
        videoRef.current.muted = true;
        setIsMuted(true);
        setAudioBlockedNotice(true);
        try {
          await videoRef.current.play();
          console.log('[RemoteStreamPlayer] ✓ Lecture vidéo démarrée en mode muet sécurisé.');
          if (videoRef.current.videoWidth > 0) {
            setHasVideoData(true);
          }
        } catch(e) {
          console.warn('[RemoteStreamPlayer] Erreur critique play() :', e);
        }
      }
    }
  }, []);

  // Débloquer le son lors de n'importe quel toucher ou interaction
  const handleUserGesture = useCallback(() => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play().catch(() => {});
      }
      if (videoRef.current.muted && !userExplicitlyMuted.current) {
        videoRef.current.muted = false;
        setIsMuted(false);
        setAudioBlockedNotice(false);
        console.log('[RemoteStreamPlayer] Son réactivé suite au geste utilisateur !');
      }
    }
  }, []);

  // 1. Réception du flux WebRTC et demande active
  useEffect(() => {
    if (netplayService.remoteStream) {
      attachAndPlayStream(netplayService.remoteStream);
    }

    const unsubStream = netplayService.on('stream_received', (stream) => {
      console.log('[RemoteStreamPlayer] Signal stream_received reçu !');
      attachAndPlayStream(stream);
    });

    const unsubPing = netplayService.on('ping', (p) => setPing(p));

    // Demande proactive répétée du flux vidéo jusqu'à ce que des frames réelles soient décodées
    netplayService.requestVideoStream();
    const reqInterval = setInterval(() => {
      const isVideoActive = videoRef.current?.srcObject && (videoRef.current?.videoWidth || 0) > 0;
      if (!isVideoActive) {
        netplayService.requestVideoStream();
      } else {
        setHasVideoData(true);
        clearInterval(reqInterval);
      }
    }, 1200);

    return () => {
      unsubStream();
      unsubPing();
      clearInterval(reqInterval);
    };
  }, [attachAndPlayStream]);

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
    handleUserGesture();
    netplayService.sendInput(buttonId, isPressed, 1);
  }, [handleUserGesture]);

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

  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    userExplicitlyMuted.current = nextMuted;
    setIsMuted(nextMuted);
    setAudioBlockedNotice(false);
    if (videoRef.current) {
      videoRef.current.muted = nextMuted;
      if (!nextMuted && videoRef.current.paused) {
        videoRef.current.play().catch(() => {});
      }
    }
  };

  const handleExit = () => {
    netplayService.leaveRoom();
    onExit();
  };

  return (
    <div 
      ref={containerRef}
      onClick={handleUserGesture}
      onTouchStart={handleUserGesture}
      className="fixed inset-0 z-50 bg-black flex flex-col select-none overflow-hidden font-mono touch-none"
    >
      {/* Barre de contrôle supérieure */}
      <div className="h-11 sm:h-14 bg-neutral-950/95 border-b border-neutral-800 px-3 sm:px-6 flex items-center justify-between text-xs text-neutral-300 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            onClick={handleExit}
            className="flex items-center gap-1 px-2.5 py-1 sm:py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-neutral-700 hover:text-white transition-all text-xs font-bold shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">QUITTER</span>
          </button>

          <span className="font-bold text-white uppercase hidden sm:inline-block truncate">
            {game?.title || 'Partie Arcade'}
          </span>

          <span className="text-[10px] px-2 py-0.5 rounded border border-rose-500/40 bg-rose-500/10 text-rose-400 font-bold shrink-0">
            J2 (INVITÉ)
          </span>

          <span className="text-[10px] px-2 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-400 font-bold hidden xs:flex items-center gap-1 shrink-0">
            <Zap className="w-3 h-3 text-cyan-400 animate-pulse" />
            <span>STREAM P2P 60 FPS</span>
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="flex items-center gap-1.5 sm:gap-2 bg-neutral-900/80 px-2 sm:px-2.5 py-1 rounded-lg border border-neutral-800">
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-emerald-400 font-bold text-[10px] sm:text-[11px]">{ping} ms</span>
            <span className="text-neutral-500">|</span>
            <span className="text-cyan-400 font-bold text-[10px] sm:text-[11px]">{fps} FPS</span>
          </div>

          <button
            onClick={handleToggleMute}
            className={`p-1.5 rounded-lg border transition-colors ${
              isMuted ? 'bg-rose-950/40 border-rose-500/50 text-rose-400' : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:text-white'
            }`}
            title={isMuted ? 'Activer le son' : 'Couper le son'}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg bg-neutral-900 border border-neutral-800 hover:text-white"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Notification discrète d'activation audio sur mobile */}
      {audioBlockedNotice && (
        <div 
          onClick={handleUserGesture}
          className="absolute top-14 left-1/2 -translate-x-1/2 z-40 px-3.5 py-1.5 bg-amber-400 text-black font-bold text-[11px] rounded-full shadow-xl cursor-pointer flex items-center gap-2 animate-bounce"
        >
          <VolumeX className="w-3.5 h-3.5" />
          <span>Touchez pour activer le son 🔊</span>
        </div>
      )}

      {/* Zone de Rendu : 2 Modes (Portrait Smartphone Pad vs Plein Écran) */}
      {isPortraitPadMode ? (
        /* MODE A : PORTRAIT MOBILE SMARTPHONE AVEC ARCADE PAD EN BAS */
        <div className="flex-1 flex flex-col w-full h-full overflow-hidden bg-black">
          {/* Écran de Jeu 4:3 en haut */}
          <div className="w-full aspect-[4/3] max-h-[46vh] relative flex items-center justify-center bg-black border-b border-neutral-800/80 shrink-0">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted={isMuted}
              onLoadedMetadata={() => { if (videoRef.current?.videoWidth > 0) setHasVideoData(true); }}
              onPlaying={() => { if (videoRef.current?.videoWidth > 0) setHasVideoData(true); }}
              onResize={() => { if (videoRef.current?.videoWidth > 0) setHasVideoData(true); }}
              className="w-full h-full object-contain pointer-events-none"
              style={{ imageRendering: 'pixelated' }}
            />

            {!hasVideoData && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 z-20">
                <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-neutral-400 font-mono text-center px-4">
                  {streamConnected ? "Réception et décodage du flux vidéo 60 FPS..." : "Connexion au flux vidéo direct de l'Hôte..."}
                </span>
              </div>
            )}
          </div>

          {/* Manette tactile dédiée en bas sans recouvrir le jeu */}
          <div className="flex-1 relative w-full bg-gradient-to-b from-neutral-950 via-neutral-900 to-black overflow-hidden flex flex-col justify-center">
            <TouchOverlay
              isVisible={isTouchVisible}
              onInput={handleInput}
              onToggleVisibility={() => setIsTouchVisible(!isTouchVisible)}
              settings={settings}
              isPortraitPad={true}
            />
          </div>
        </div>
      ) : (
        /* MODE B : MODE STANDARD / PAYSAGE / OVERLAY FLOTTANT */
        <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isMuted}
            onLoadedMetadata={() => { if (videoRef.current?.videoWidth > 0) setHasVideoData(true); }}
            onPlaying={() => { if (videoRef.current?.videoWidth > 0) setHasVideoData(true); }}
            onResize={() => { if (videoRef.current?.videoWidth > 0) setHasVideoData(true); }}
            className="w-full h-full object-contain pointer-events-none"
            style={{ imageRendering: 'pixelated' }}
          />

          {!hasVideoData && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 z-20">
              <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-neutral-400 font-mono text-center px-4">
                {streamConnected ? "Réception et décodage du flux vidéo 60 FPS..." : "Connexion au flux vidéo direct de l'Hôte..."}
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
              isPortraitPad={false}
            />
          )}
        </div>
      )}
    </div>
  );
}
