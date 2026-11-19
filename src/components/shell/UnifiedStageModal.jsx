import React, { useEffect, useRef, useState } from 'react';
import {
  X, Maximize2, Minimize2, RotateCcw, Settings, Coins, Play, Sliders, Save, UploadCloud, Trophy, Award, Gamepad2
} from 'lucide-react';
import { addCoins, consumeCoin, hasCoins, setWalletCoins, subscribeWallet } from '../../services/walletService';
import { getCurrentUserProfile, subscribeAuthProfile } from '../../services/authService';
import {
  getRankTierMeta,
  normalizeScoreGameId,
  recordGameScore,
  subscribeGameLeaderboard,
} from '../../services/scoreRankingService';
import { firebaseFightcadeService, GLOBAL_CHANNEL_ID } from '../../services/firebaseFightcadeService';
import { countryCodeToFlag } from '../../data/countries';
import { MobilePlatformController } from './MobilePlatformController';

function detectDefaultTouchPad() {
  if (typeof window === 'undefined') return false;
  return (
    window.innerWidth < 820 ||
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
    'ontouchstart' in window
  );
}

export function UnifiedStageModal({
  session,
  settings,
  p2pEngine = null,
  p2pStats = null,
  activeChannels = [],
  onOpenSalon,
  onCloudCheckpoint,
  onInputDelayChange,
  onClose,
  onOpenSettings,
}) {
  const stageRef = useRef(null);
  const iframeRef = useRef(null);
  const [statusText, setStatusText] = useState('Initialisation…');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [filter, setFilter] = useState(settings?.video?.filter === 'smooth' ? 'smooth' : 'sharp');
  const [ratio, setRatio] = useState(settings?.video?.aspectRatio === '16:9' ? 'stretch' : 'fit');
  const [bootKey, setBootKey] = useState(0);
  const [coins, setCoins] = useState(0);
  const [coinLocked, setCoinLocked] = useState(false);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const [scorePanelOpen, setScorePanelOpen] = useState(false);
  const [liveRamTelemetry, setLiveRamTelemetry] = useState({ score: 0, lives: null, mode: 'heuristic' });
  const [ramToast, setRamToast] = useState(null); // { tone: 'loss' | 'record', text: string }
  const [gameLeaderboard, setGameLeaderboard] = useState([]);
  const [userProfile, setUserProfile] = useState(() => getCurrentUserProfile());
  const userProfileRef = useRef(userProfile);
  userProfileRef.current = userProfile;
  const toastTimerRef = useRef(null);
  const [savedState, setSavedState] = useState(null);
  const [inputDelay, setInputDelay] = useState(p2pStats?.inputDelay ?? 1);
  const [touchPadVisible, setTouchPadVisible] = useState(() => detectDefaultTouchPad());

  const showRamToast = (tone, text) => {
    setRamToast({ tone, text });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setRamToast(null), 4800);
  };

  useEffect(() => subscribeWallet(setCoins), []);
  useEffect(() => subscribeAuthProfile(setUserProfile), []);

  useEffect(() => {
    if (!session || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { type: 'SET_CUSTOM_TOUCH_PAD', enabled: touchPadVisible },
      window.location.origin
    );
  }, [session, touchPadVisible, bootKey]);

  useEffect(() => {
    if (!session) {
      setScorePanelOpen(false);
      setLiveRamTelemetry({ score: 0, lives: null, mode: 'heuristic' });
      setRamToast(null);
      setGameLeaderboard([]);
      return;
    }
    const gid = normalizeScoreGameId(session.gameId || session.title);
    const unsub = subscribeGameLeaderboard(gid, setGameLeaderboard);
    return () => unsub?.();
  }, [session?.gameId, session?.title]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Tab' && session) {
        e.preventDefault();
        setQuickMenuOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  useEffect(() => {
    if (!session || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { type: 'UPDATE_COINS', coins, locked: coinLocked, resume: !coinLocked },
      window.location.origin
    );
  }, [session, coins, coinLocked]);

  useEffect(() => {
    if (!session) return;
    setStatusText('Chargement du moteur…');
    setCoinLocked(false);

    const handleMessage = (event) => {
      if (event.source !== iframeRef.current?.contentWindow || !event.data) return;
      if (event.data.type === 'STAGE_FRAME_READY') {
        const bootMsg =
          session.kind === 'j2me'
            ? {
                type: 'BOOT_J2ME',
                gameName: session.title,
                filename: session.filename || session.fileBlob?.name || 'game.jar',
                fileBlob: session.fileBlob,
              }
            : {
                type: 'BOOT_EMU',
                core: session.core,
                gameName: session.title,
                filename: session.filename || session.fileBlob?.name || '',
                fileBlob: session.fileBlob,
                gameUrl: session.gameUrl || '',
                isNetplay: Boolean(session.isNetplay),
                playerIndex: session.playerIndex ?? 0,
                accent: session.accent || '#00f0ff',
                filter,
                ratio,
                volume: settings?.audio?.volume ?? 80,
                muted: Boolean(settings?.audio?.muted),
                localData: false,
              };
        iframeRef.current.contentWindow.postMessage(bootMsg, window.location.origin);
        iframeRef.current.contentWindow.postMessage(
          { type: 'UPDATE_COINS', coins, locked: false },
          window.location.origin
        );
        iframeRef.current.contentWindow.postMessage(
          { type: 'SET_CUSTOM_TOUCH_PAD', enabled: touchPadVisible },
          window.location.origin
        );
      } else if (event.data.type === 'STAGE_STATUS') {
        if (event.data.message) setStatusText(event.data.message);
        if (event.data.status === 'playing') {
          try {
            iframeRef.current?.focus();
            // Si on reprend une partie synchronisée depuis un autre appareil, injecter le savestate automatiquement !
            if (session.initialStateBase64 && session.kind !== 'j2me') {
              const stateToLoad = session.initialStateBase64;
              setTimeout(() => {
                try {
                  iframeRef.current?.contentWindow?.postMessage(
                    { type: 'LOAD_STATE', stateBase64: stateToLoad },
                    window.location.origin
                  );
                  showRamToast('record', '☁️ Partie reprise exactement où vous l’aviez laissée !');
                } catch {}
              }, 700);
            }
            if (
              session.isNetplay &&
              session.isHost &&
              p2pEngine &&
              ['psx', 'ps1', 'n64', 'nds'].includes(String(session.core).toLowerCase())
            ) {
              const stream = iframeRef.current?.contentWindow?.captureStageStream?.(30);
              if (stream) p2pEngine.attachMediaStream(stream);
            }
          } catch {
            /* noop */
          }
        }
      } else if (event.data.type === 'TOGGLE_QUICK_MENU') {
        setQuickMenuOpen((prev) => !prev);
      } else if (event.data.type === 'REQUEST_COIN_FROM_KEYBOARD') {
        sendButton('coin');
      } else if (event.data.type === 'SYNC_WALLET_FROM_RAM' && typeof event.data.coins === 'number') {
        const nextC = setWalletCoins(event.data.coins);
        if (nextC <= 0) setCoinLocked(true);
      } else if (event.data.type === 'RAM_TELEMETRY_TICK') {
        setLiveRamTelemetry({
          score: Number(event.data.score || 0),
          lives: typeof event.data.lives === 'number' ? event.data.lives : null,
          mode: event.data.mode || 'heuristic',
        });
      } else if (event.data.type === 'RAM_AUTO_SCORE' && typeof event.data.score === 'number' && event.data.score > 0) {
        const gid = normalizeScoreGameId(session.gameId || session.title);
        const profile = userProfileRef.current;
        recordGameScore({
          userProfile: profile,
          gameId: gid,
          gameTitle: session.title,
          platformLabel: session.core?.toUpperCase() || 'Arcade',
          score: event.data.score,
          source: `ram_${event.data.reason || 'auto'}`,
        })
          .then((res) => {
            if (res.rankChanged) {
              showRamToast(
                'record',
                `⬆️ RANK UP (RAM) ! Rang ${res.newRank} (${res.evaluation.rankLabel}) · ${res.newBest.toLocaleString('fr-FR')} pts`
              );
              if (session.kind !== 'j2me') {
                const msgTxt = `🏆 ${profile.displayName} passe au RANG ${res.newRank} grâce à un score RAM de ${res.newBest.toLocaleString('fr-FR')} pts sur « ${session.title} » !`;
                firebaseFightcadeService.sendMessage(gid, msgTxt, 'challenge').catch(() => {});
                firebaseFightcadeService.sendMessage(GLOBAL_CHANNEL_ID, msgTxt, 'challenge').catch(() => {});
              }
            } else if (res.isNewRecord) {
              showRamToast(
                'record',
                `🏆 NOUVEAU RECORD RAM AUTO : ${res.newBest.toLocaleString('fr-FR')} pts (Rang Jeu ${res.gameStat.gameRank})`
              );
              if (session.kind !== 'j2me' && event.data.reason !== 'milestone') {
                const msgTxt = `🏆 Nouveau record RAM de ${profile.displayName} sur « ${session.title} » : ${res.newBest.toLocaleString('fr-FR')} pts !`;
                firebaseFightcadeService.sendMessage(gid, msgTxt, 'challenge').catch(() => {});
              }
            }
          })
          .catch(() => {});
      } else if (event.data.type === 'RAM_LOSS_CONSUME_CREDIT') {
        // Signal RAM de défaite / Game Over / Restart sur TOUTES les consoles (Arcade, Sega, PS1, Nintendo, Java)
        const res = consumeCoin(1);
        const remaining = res.coins;
        if (remaining <= 0) {
          setCoinLocked(true);
          showRamToast('loss', '💀 PARTIE PERDUE (RAM) · 0/99 CRÉDIT — Ajoutez un crédit pour recommencer !');
        } else {
          showRamToast(
            'loss',
            `💀 PARTIE PERDUE (Signal RAM) · -1 CRÉDIT (${String(remaining).padStart(2, '0')}/99 restants)`
          );
        }
      } else if (event.data.type === 'NETPLAY_LOCAL_BTN') {
        p2pEngine?.sendButtonEvent?.(event.data.buttonIdx, event.data.pressed);
      } else if (event.data.type === 'STATE_EXPORTED' && event.data.stateBase64) {
        setSavedState(event.data.stateBase64);
        if (event.data.slot === 'frame0') {
          p2pEngine?.sendFrame0State?.(event.data.stateBase64);
        } else if (event.data.slot === 'cloud_handoff') {
          onCloudCheckpoint?.(event.data.stateBase64);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [session, bootKey, p2pEngine]);

  // Sauvegarde automatique Cloud Handoff toutes les 12 secondes pendant la partie (pour reprendre sur un autre appareil)
  useEffect(() => {
    if (!session || session.kind === 'j2me') return;
    const id = setInterval(() => {
      try {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'EXPORT_STATE', slot: 'cloud_handoff' },
          window.location.origin
        );
      } catch {}
    }, 12000);
    return () => clearInterval(id);
  }, [session, bootKey]);

  // Pont P2P entrant : répercuter les inputs distants et le savestate Frame 0 dans l'iframe de l'émulateur
  useEffect(() => {
    if (!p2pEngine) return;
    p2pEngine.onRemoteButton = ({ buttonIdx, pressed }) => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'NETPLAY_REMOTE_BTN', buttonIdx, pressed },
        window.location.origin
      );
    };
    p2pEngine.onFrame0State = (stateBase64) => {
      if (stateBase64) {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'LOAD_STATE', stateBase64 },
          window.location.origin
        );
      }
    };
  }, [p2pEngine]);

  useEffect(() => {
    if (!session || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      {
        type: 'UPDATE_DISPLAY',
        filter,
        ratio,
        volume: settings?.audio?.volume ?? 80,
        muted: Boolean(settings?.audio?.muted),
      },
      window.location.origin
    );
  }, [session, filter, ratio, settings?.audio?.volume, settings?.audio?.muted]);

  if (!session) return null;

  const iframeSrc = session.kind === 'j2me' ? './app/stages/j2me-frame.html' : './app/stages/emu-frame.html';

  const sendButton = (button) => {
    if (button === 'coin') {
      const next = addCoins(1);
      setCoinLocked(false);
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.focus();
        iframeRef.current.contentWindow.postMessage(
          { type: 'UPDATE_COINS', coins: next, locked: false, resume: true },
          window.location.origin
        );
      }
      return;
    }
    if (!iframeRef.current?.contentWindow) return;
    iframeRef.current.focus();
    iframeRef.current.contentWindow.postMessage({ type: 'PRESS_BUTTON', button }, window.location.origin);
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen?.();
    } catch {
      /* noop */
    }
  };

  const handleRestartGame = () => {
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'FLUSH_RAM_SCORE', reason: 'restart' },
        window.location.origin
      );
    } catch {}
    if (!hasCoins(1)) {
      setCoinLocked(true);
      showRamToast('loss', '⛔ 0/99 CRÉDIT — Ajoutez des coins dans le Quick Menu pour recommencer !');
      return;
    }
    const res = consumeCoin(1);
    setLiveRamTelemetry({ score: 0, lives: null, mode: 'heuristic' });
    showRamToast('loss', `🔄 Nouvelle partie · -1 CRÉDIT (${String(res.coins).padStart(2, '0')}/99 restants)`);
    setQuickMenuOpen(false);
    setBootKey((k) => k + 1);
  };

  const handleCloseStage = () => {
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'FLUSH_RAM_SCORE', reason: 'session_end' },
        window.location.origin
      );
      if (session?.kind !== 'j2me') {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'EXPORT_STATE', slot: 'cloud_handoff' },
          window.location.origin
        );
      }
    } catch {}
    setTimeout(() => onClose?.(), 180);
  };

  return (
    <div
      ref={stageRef}
      className="fixed inset-0 h-[100dvh] z-50 flex flex-col bg-neutral-950 text-neutral-100 pt-safe pb-safe"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-center justify-between gap-1.5 md:gap-2 px-2 md:px-3 py-1.5 md:py-2 bg-neutral-900/95 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-1.5 md:gap-2.5 min-w-0">
          <button
            type="button"
            onClick={handleCloseStage}
            title="Quitter le jeu"
            className="flex items-center gap-1 px-2 md:px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-bold text-neutral-200 transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Quitter</span>
          </button>
          <span className="font-bold text-xs sm:text-sm text-white truncate max-w-[110px] sm:max-w-[200px]">
            {session.title}
          </span>
          <span className="hidden lg:inline px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-950 border border-cyan-700/60 text-cyan-300 shrink-0">
            {session.badge}
          </span>
          {session.kind !== 'j2me' && (
            <button
              type="button"
              onClick={() => onOpenSalon?.()}
              title="Cliquez pour afficher le salon Fightcade 2"
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-950/70 hover:bg-emerald-900/70 border border-emerald-500/50 text-emerald-300 text-[10px] sm:text-[11px] font-mono font-bold transition-colors truncate max-w-[90px] sm:max-w-xs lg:max-w-md"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span className="sm:hidden">Salon</span>
              <span className="hidden sm:inline truncate">
                AU SALON · Actif sur :{' '}
                {activeChannels.length > 0
                  ? activeChannels.map((c) => c.title).join(' · ')
                  : session.title}
              </span>
            </button>
          )}
          {p2pStats && session.kind !== 'j2me' && (
            <span className="hidden md:inline px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950/80 border border-emerald-600/50 text-emerald-300 shrink-0">
              {p2pStats.pingMs}ms · RB {p2pStats.rollbackFrames}f
            </span>
          )}
          <span className="hidden xl:inline text-xs font-mono text-neutral-400 truncate">{statusText}</span>
        </div>

        <div className="flex items-center gap-1 md:gap-1.5 shrink-0">
          {session.kind !== 'j2me' && (
            <span className="px-2 md:px-2.5 py-1 rounded-lg bg-amber-950/50 border border-amber-500/40 text-amber-300 text-[11px] md:text-xs font-mono font-bold">
              <span className="lg:hidden">{String(coins).padStart(2, '0')}</span>
              <span className="hidden lg:inline">CRÉDITS SYNCHRONISÉS : {String(coins).padStart(2, '0')}/99</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => setTouchPadVisible((v) => !v)}
            title="Afficher / Masquer le contrôleur tactile adapté à cette console"
            className={`flex items-center gap-1 px-2 md:px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-colors ${
              touchPadVisible
                ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200'
                : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:text-white'
            }`}
          >
            <Gamepad2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Pad</span>
          </button>
          {session.kind !== 'j2me' && (
            <>
              <button
                type="button"
                onClick={() => {
                  if (iframeRef.current?.contentWindow) {
                    iframeRef.current.focus();
                    iframeRef.current.contentWindow.postMessage({ type: 'FORCE_SYNC_CREDITS' }, window.location.origin);
                  }
                }}
                title="Forcer la synchronisation des crédits dans la RAM (Touche 5)"
                className="flex items-center gap-1 px-2 md:px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-bold transition-colors"
              >
                <Coins className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Sync Crédits (5)</span>
              </button>
              <button
                type="button"
                onClick={() => sendButton('start')}
                title="Démarrer / Start (Touche 1)"
                className="flex items-center gap-1 px-2 md:px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Start (1)</span>
              </button>
              <button
                type="button"
                onClick={() => setFilter((f) => (f === 'smooth' ? 'sharp' : 'smooth'))}
                className="hidden lg:inline-flex px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 transition-colors"
              >
                {filter === 'smooth' ? 'Lissé' : 'Pixel net'}
              </button>
              <button
                type="button"
                onClick={() => setRatio((r) => (r === 'stretch' ? 'fit' : 'stretch'))}
                className="hidden lg:inline-flex px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 transition-colors"
              >
                {ratio === 'stretch' ? 'Étiré' : '4:3'}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setQuickMenuOpen(false);
              setScorePanelOpen((v) => !v);
            }}
            title="Score détecté automatiquement depuis la RAM & Classement du jeu"
            className="flex items-center gap-1 px-2 md:px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-200 text-xs font-bold transition-colors"
          >
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden md:inline font-mono">
              {liveRamTelemetry.score > 0
                ? `${liveRamTelemetry.score.toLocaleString('fr-FR')} pts`
                : 'Score RAM'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setScorePanelOpen(false);
              setQuickMenuOpen((v) => !v);
            }}
            title="Quick Menu (Tab)"
            className="flex items-center gap-1 px-2 md:px-2.5 py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-200 text-xs font-bold transition-colors"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Quick Menu (Tab)</span>
          </button>
          <button
            type="button"
            onClick={handleRestartGame}
            className="hidden md:inline-flex p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors"
            title="Recommencer la partie (-1 Crédit)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="hidden md:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-bold transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span className="hidden xl:inline">{isFullscreen ? 'Fenêtré' : 'Plein écran'}</span>
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            title="Paramètres"
            className="hidden md:inline-flex p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 bg-black relative overflow-hidden">
        <iframe
          key={`${session.title}-${bootKey}`}
          ref={iframeRef}
          src={iframeSrc}
          title={session.title}
          allow="autoplay; fullscreen; gamepad"
          className="w-full h-full border-0"
        />

        {/* Notification RAM temps réel (Défaite -1 Crédit ou Nouveau Record Auto RAM) */}
        {ramToast && (
          <div
            className={`absolute top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl border text-xs font-mono font-bold shadow-2xl backdrop-blur-md pointer-events-none text-center max-w-[92%] ${
              ramToast.tone === 'loss'
                ? 'bg-rose-950/90 border-rose-500/70 text-rose-100'
                : 'bg-amber-950/90 border-amber-400/70 text-amber-100'
            }`}
          >
            {ramToast.text}
          </div>
        )}

        {/* Panneau Télémétrie RAM Automatique & Classement du Jeu (AUCUNE saisie manuelle autorisée) */}
        {scorePanelOpen && (() => {
          const gid = normalizeScoreGameId(session.gameId || session.title);
          const myStat = (userProfile?.gameStats || []).find((s) => s.gameId === gid);
          const globalRankMeta = getRankTierMeta(userProfile?.rank || 'D');
          const gameRankMeta = getRankTierMeta(myStat?.gameRank || 'D');

          return (
            <aside className="absolute inset-y-0 right-0 w-96 max-w-full bg-neutral-950/95 backdrop-blur-xl border-l border-amber-500/40 p-4 flex flex-col gap-3.5 z-40 shadow-2xl overflow-y-auto">
              <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
                <div className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-amber-400" />
                  <div>
                    <h3 className="text-sm font-black text-white">TÉLÉMÉTRIE RAM &amp; RANG</h3>
                    <p className="text-[11px] font-mono text-neutral-400 truncate max-w-[230px]">
                      {session.title}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setScorePanelOpen(false)}
                  className="p-1.5 rounded-lg bg-neutral-800 text-neutral-300 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Carte Rang Global & Record sur ce jeu */}
              <div className="p-3 rounded-xl bg-neutral-900 border border-amber-500/30 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded border text-xs font-mono font-black ${globalRankMeta.color}`}>
                      Rang {globalRankMeta.id}
                    </span>
                    <span className="text-xs font-bold text-white">{userProfile?.displayName}</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-cyan-300">
                    {userProfile?.ratingPoints || 0} RP
                  </span>
                </div>

                <div className="w-full h-1.5 rounded-full bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-400 to-amber-400"
                    style={{ width: `${userProfile?.progressPercent || 0}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400 pt-0.5">
                  <span>
                    Record auto :{' '}
                    <strong className="text-amber-300">
                      {(myStat?.bestScore || 0).toLocaleString('fr-FR')} pts
                    </strong>
                  </span>
                  <span className={`px-1.5 py-0.2 rounded border text-[10px] font-black ${gameRankMeta.color}`}>
                    Jeu : {gameRankMeta.id}
                  </span>
                </div>
              </div>

              {/* Lecture directe RAM en temps réel (Saisie manuelle impossible) */}
              <div className="p-3 rounded-xl bg-cyan-950/25 border border-cyan-500/40 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono uppercase text-cyan-300 font-bold">
                  <span>Lecture directe RAM</span>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-500/40 text-emerald-300 text-[9px]">
                    100% AUTO · ANTI-TRICHE
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded-lg bg-neutral-950 border border-neutral-800">
                    <div className="text-[9px] font-mono text-neutral-400">SCORE RAM DIRECT</div>
                    <div className="text-sm font-mono font-black text-amber-300">
                      {liveRamTelemetry.score.toLocaleString('fr-FR')} pts
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-neutral-950 border border-neutral-800">
                    <div className="text-[9px] font-mono text-neutral-400">VIES / ÉTAT RAM</div>
                    <div className="text-sm font-mono font-black text-emerald-300">
                      {liveRamTelemetry.lives !== null ? `${liveRamTelemetry.lives} vie(s)` : 'Actif'}
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-neutral-400 leading-relaxed">
                  Le score est lu directement dans la mémoire RAM du jeu et enregistré automatiquement lors d’une victoire, d’un record ou d’une défaite (<strong>-1 crédit automatique</strong> si vous perdez ou recommencez).
                </p>
              </div>

              {/* Classement / Top 10 du jeu */}
              <div className="space-y-2 flex-1">
                <div className="flex items-center justify-between text-[11px] font-mono uppercase text-neutral-400">
                  <span className="flex items-center gap-1">
                    <Award className="w-3.5 h-3.5 text-amber-400" /> Top Scores du Jeu
                  </span>
                  <span>{gameLeaderboard.length} joueur(s)</span>
                </div>

                {gameLeaderboard.length === 0 ? (
                  <div className="p-4 rounded-xl bg-neutral-900/70 border border-neutral-800 text-center text-xs text-neutral-500">
                    Soyez le premier à établir un record sur « {session.title} » !
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {gameLeaderboard.slice(0, 10).map((row, idx) => {
                      const rowRank = getRankTierMeta(row.rank || 'D');
                      return (
                        <div
                          key={row.uid || idx}
                          className={`px-3 py-2 rounded-xl border flex items-center justify-between gap-2 text-xs ${
                            idx === 0
                              ? 'bg-amber-950/35 border-amber-500/50'
                              : 'bg-neutral-900 border-neutral-800'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono font-black text-amber-400 w-5 shrink-0">
                              #{idx + 1}
                            </span>
                            <span>{countryCodeToFlag(row.region)}</span>
                            <span className={`px-1 py-0.2 rounded border text-[9px] font-mono font-black ${rowRank.color}`}>
                              {rowRank.id}
                            </span>
                            <span className="font-bold text-white truncate">{row.displayName}</span>
                          </div>
                          <span className="font-mono font-black text-amber-300 shrink-0">
                            {(row.bestScore || 0).toLocaleString('fr-FR')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </aside>
          );
        })()}

        {/* Quick Menu Overlay (Style Guide Xbox / PS) */}
        {quickMenuOpen && (
          <aside className="absolute inset-y-0 right-0 w-80 max-w-full bg-neutral-950/92 backdrop-blur-xl border-l border-cyan-500/30 p-4 flex flex-col gap-4 z-40 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div>
                <h3 className="text-sm font-black text-white">QUICK MENU</h3>
                <p className="text-[11px] font-mono text-neutral-400">Guide en jeu · Tab pour fermer</p>
              </div>
              <button
                type="button"
                onClick={() => setQuickMenuOpen(false)}
                className="p-1.5 rounded-lg bg-neutral-800 text-neutral-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Portefeuille & Coins Synchronisés */}
            <div className="p-3 rounded-xl bg-amber-950/25 border border-amber-500/30 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-300">Crédits Synchronisés (RAM ↔ Salon)</span>
                <span className="font-mono text-sm font-black text-amber-200">{coins} / 99</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  addCoins(5);
                  setCoinLocked(false);
                }}
                className="w-full px-2.5 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-amber-300 text-xs font-bold border border-amber-500/30"
              >
                +5 Coins (Achat Test Salon)
              </button>
            </div>

            {/* Réseau & Input Delay (Hors Java J2ME solo) */}
            {session.kind !== 'j2me' && (
              <div className="p-3 rounded-xl bg-neutral-900 border border-neutral-800 space-y-2">
                <div className="text-xs font-bold text-cyan-300">Réseau &amp; Rollback P2P</div>
                <div className="text-xs font-mono text-neutral-300">
                  {p2pStats
                    ? `PING: ${p2pStats.pingMs}ms · ROLLBACK: ${p2pStats.rollbackFrames}f · ${p2pStats.p2pState}`
                    : 'Mode Local (Hors match P2P)'}
                </div>
                <label className="flex items-center justify-between text-xs text-neutral-300 pt-1">
                  <span>Input Delay (0–3f)</span>
                  <select
                    value={inputDelay}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setInputDelay(v);
                      onInputDelayChange?.(v);
                    }}
                    className="px-2 py-1 rounded bg-neutral-950 border border-neutral-700 text-xs text-white"
                  >
                    <option value={0}>0 frame</option>
                    <option value={1}>1 frame</option>
                    <option value={2}>2 frames</option>
                    <option value={3}>3 frames</option>
                  </select>
                </label>
              </div>
            )}

            {/* Savestate Rapide */}
            {session.kind !== 'j2me' && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => iframeRef.current?.contentWindow?.postMessage({ type: 'EXPORT_STATE' }, window.location.origin)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-bold text-white"
                >
                  <Save className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Sauver État</span>
                </button>
                <button
                  type="button"
                  disabled={!savedState}
                  onClick={() =>
                    savedState &&
                    iframeRef.current?.contentWindow?.postMessage(
                      { type: 'LOAD_STATE', stateBase64: savedState },
                      window.location.origin
                    )
                  }
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-xs font-bold text-white"
                >
                  <UploadCloud className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Charger État</span>
                </button>
              </div>
            )}

            {/* Affichage & Actions rapides (essentiel sur mobile où la topbar est épurée) */}
            <div className="p-3 rounded-xl bg-neutral-900 border border-neutral-800 space-y-2">
              <div className="text-xs font-bold text-neutral-300">Affichage &amp; Système</div>
              <div className="grid grid-cols-2 gap-2">
                {session.kind !== 'j2me' && (
                  <>
                    <button
                      type="button"
                      onClick={() => setFilter((f) => (f === 'smooth' ? 'sharp' : 'smooth'))}
                      className="px-2.5 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-bold text-neutral-200"
                    >
                      Filtre : {filter === 'smooth' ? 'Lissé' : 'Pixel net'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRatio((r) => (r === 'stretch' ? 'fit' : 'stretch'))}
                      className="px-2.5 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-bold text-neutral-200"
                    >
                      Format : {ratio === 'stretch' ? 'Étiré' : '4:3'}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={handleRestartGame}
                  className="px-2.5 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-bold text-neutral-200 flex items-center justify-center gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Recommencer (-1 Coin)
                </button>
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="px-2.5 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-xs font-bold flex items-center justify-center gap-1"
                >
                  {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                  {isFullscreen ? 'Fenêtré' : 'Plein écran'}
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setQuickMenuOpen(false);
                  onOpenSettings?.();
                }}
                className="w-full py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-bold text-neutral-200 flex items-center justify-center gap-1.5"
              >
                <Settings className="w-3.5 h-3.5" /> Paramètres complets
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="mt-auto w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors"
            >
              {session.kind === 'j2me' ? 'Quitter le jeu' : 'Quitter vers le salon'}
            </button>
          </aside>
        )}
      </div>

      {/* Contrôleurs Tactiles Mobile Sur-Mesure par Plateforme (Arcade / PS1 / Nintendo / Sega / Java J2ME) */}
      {touchPadVisible && (
        <MobilePlatformController
          kind={session.kind}
          core={session.core}
          onEmuButton={(buttonIdx, pressed) => {
            iframeRef.current?.contentWindow?.postMessage(
              { type: 'VIRTUAL_PAD_BTN', buttonIdx, pressed },
              window.location.origin
            );
          }}
          onJ2meKey={(code, pressed) => {
            iframeRef.current?.contentWindow?.postMessage(
              { type: 'J2ME_KEY', code, pressed },
              window.location.origin
            );
          }}
          onSyncCredits={() => {
            iframeRef.current?.contentWindow?.postMessage(
              { type: 'FORCE_SYNC_CREDITS' },
              window.location.origin
            );
          }}
        />
      )}
    </div>
  );
}
