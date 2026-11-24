import React, { useEffect, useRef, useState } from 'react';
import {
  X, Maximize2, Minimize2, RotateCcw, Settings, Coins, Play, Pause, Sliders, Save, UploadCloud, Trophy, Award, Gamepad2, Trash2, Swords, MessageSquare, ShieldAlert, Radio, Send, Eye, Mic, MicOff
} from 'lucide-react';
import { VoicePartyPill } from '../social/VoicePartyPill';
import { addCoins, consumeCoin, hasCoins, setWalletCoins, subscribeWallet } from '../../services/walletService';
import { getCurrentUserProfile, subscribeAuthProfile } from '../../services/authService';
import {
  getRankTierMeta,
  normalizeScoreGameId,
  recordGameScore,
  recordGameSessionActivity,
  subscribeGameLeaderboard,
} from '../../services/scoreRankingService';
import { firebaseFightcadeService, GLOBAL_CHANNEL_ID } from '../../services/firebaseFightcadeService';
import { deleteGameSlot, listGameSlots, loadGameSlot, saveGameSlot } from '../../services/gameSaveService';
import { countryCodeToFlag } from '../../data/countries';
import { MobilePlatformController } from './MobilePlatformController';
import PerfOverlay from '../PerfOverlay';
import { supportsOnlineMultiplayer } from '../../utils/gameCapabilities';

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
  incomingChallenge = null,
  onRespondChallenge,
  voiceState = null,
  onToggleVoiceMute = null,
  onVoicePttChange = null,
  onAcceptVoiceInvite = null,
  onDismissVoiceInvite = null,
  onOpenSalon,
  onCloudCheckpoint,
  onInputDelayChange,
  onUpdateVideoSetting,
  onClose,
  onOpenSettings,
}) {
  const stageRef = useRef(null);
  const iframeRef = useRef(null);
  const [statusText, setStatusText] = useState('Initialisation…');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [filter, setFilter] = useState(settings?.video?.filter === 'smooth' ? 'smooth' : 'sharp');
  const [ratio, setRatio] = useState(
    settings?.video?.aspectRatio === '16:9'
      ? 'stretch'
      : settings?.video?.aspectRatio === 'pixel-perfect'
      ? 'pixel-perfect'
      : 'fit'
  );
  const [bootKey, setBootKey] = useState(0);
  const [coins, setCoins] = useState(0);
  const [coinLocked, setCoinLocked] = useState(false);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const [pauseMenuOpen, setPauseMenuOpen] = useState(false);
  const [scorePanelOpen, setScorePanelOpen] = useState(false);
  const [fsBarVisible, setFsBarVisible] = useState(false);
  const fsHideTimerRef = useRef(null);
  const fsTouchStartYRef = useRef(null);
  const [liveRamTelemetry, setLiveRamTelemetry] = useState({ score: 0, lives: null, mode: 'heuristic' });
  const [ramToast, setRamToast] = useState(null); // { tone: 'loss' | 'record', text: string }
  const [gameLeaderboard, setGameLeaderboard] = useState([]);
  const [userProfile, setUserProfile] = useState(() => getCurrentUserProfile());
  const userProfileRef = useRef(userProfile);
  userProfileRef.current = userProfile;
  const toastTimerRef = useRef(null);
  const sessionActivityLoggedRef = useRef(false);
  const [savedState, setSavedState] = useState(null);
  const [savedSlots, setSavedSlots] = useState([]);
  const [inputDelay, setInputDelay] = useState(p2pStats?.inputDelay ?? settings?.netplay?.inputDelay ?? 1);
  const [autoHealSync, setAutoHealSync] = useState(true);
  const [touchPadVisible, setTouchPadVisible] = useState(() => detectDefaultTouchPad());
  const [netplayPanelOpen, setNetplayPanelOpen] = useState(false);
  const [opponentLeftModal, setOpponentLeftModal] = useState(null); // { name, reason }
  const [rematchInviteFrom, setRematchInviteFrom] = useState(null); // string senderName
  const [rematchPending, setRematchPending] = useState(false);
  const [remotePausedBy, setRemotePausedBy] = useState(null); // string senderName
  const [netplayChatBubble, setNetplayChatBubble] = useState(null); // { sender, text }
  const [quickChatInput, setQuickChatInput] = useState('');
  const chatBubbleTimerRef = useRef(null);
  const [localEmuReady, setLocalEmuReady] = useState(false);
  const [remoteEmuReady, setRemoteEmuReady] = useState(false);
  const [netplaySyncReady, setNetplaySyncReady] = useState(() => !session?.isNetplay);
  const [spectatorsCount, setSpectatorsCount] = useState(0);
  const [continuedSolo, setContinuedSolo] = useState(false);
  const isSpectator = Boolean(session?.isSpectator || session?.playerIndex === -1);

  useEffect(() => {
    if (!session) return;
    setOpponentLeftModal(null);
    // DROP-IN SANS REDÉMARRAGE : si l'hôte joue déjà à ce jeu, on garde l'émulateur vivant sans écran d'attente !
    if (session.isLiveDropIn && session.isHost) {
      setLocalEmuReady(true);
      setNetplaySyncReady(true);
      try {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'ENABLE_LIVE_NETPLAY', playerIndex: 0 },
          window.location.origin
        );
        p2pEngine?.notifyEmuReady?.(true);
      } catch {}
      showRamToast('record', `${session.opponentName || 'Un joueur'} rejoint votre partie en direct !`);
      return;
    }
    setLocalEmuReady(false);
    setRemoteEmuReady(false);
    setSpectatorsCount(0);
    setNetplaySyncReady(!session.isNetplay);
  }, [session?.gameId, session?.title, session?.isNetplay, session?.isSpectator, session?.isLiveDropIn, bootKey]);

  useEffect(() => {
    if (!session?.isNetplay || isSpectator || netplaySyncReady || !localEmuReady || !remoteEmuReady) return;
    const safetyTimer = setTimeout(() => setNetplaySyncReady(true), 18000);
    return () => clearTimeout(safetyTimer);
  }, [session?.isNetplay, isSpectator, netplaySyncReady, localEmuReady, remoteEmuReady]);

  useEffect(() => {
    if (session?.isNetplay && typeof p2pStats?.pingMs === 'number' && p2pStats.pingMs > 0) {
      try {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'SET_PEER_PING', pingMs: p2pStats.pingMs },
          window.location.origin
        );
      } catch {}
    }
  }, [session?.isNetplay, p2pStats?.pingMs]);

  const getMyDisplayName = () =>
    userProfileRef.current?.displayName ||
    userProfileRef.current?.name ||
    (session?.isHost ? 'Joueur 1 (Hôte)' : 'Joueur 2 (Invité)');

  const showNetplayBubble = (sender, text) => {
    setNetplayChatBubble({ sender, text });
    if (chatBubbleTimerRef.current) clearTimeout(chatBubbleTimerRef.current);
    chatBubbleTimerRef.current = setTimeout(() => setNetplayChatBubble(null), 5000);
  };

  const showRamToast = (tone, text) => {
    setRamToast({ tone, text });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setRamToast(null), 4800);
  };

  const openPauseMenu = (fromRemote = false) => {
    setQuickMenuOpen(false);
    setScorePanelOpen(false);
    setNetplayPanelOpen(false);
    setPauseMenuOpen(true);
    if (isSpectator) return;
    try {
      iframeRef.current?.contentWindow?.postMessage({ type: 'PAUSE_EMU' }, window.location.origin);
    } catch {}
    if (!fromRemote && session?.isNetplay && !opponentLeftModal) {
      p2pEngine?.sendNetplayEvent?.({
        event: 'SYNC_PAUSE',
        senderName: getMyDisplayName(),
      });
    }
  };

  const closePauseMenuAndResume = (fromRemote = false) => {
    setPauseMenuOpen(false);
    setRemotePausedBy(null);
    if (isSpectator) return;
    try {
      iframeRef.current?.focus();
      iframeRef.current?.contentWindow?.postMessage({ type: 'RESUME_EMU' }, window.location.origin);
    } catch {}
    if (!fromRemote && session?.isNetplay && !opponentLeftModal) {
      p2pEngine?.sendNetplayEvent?.({
        event: 'SYNC_RESUME',
        senderName: getMyDisplayName(),
      });
    }
  };

  useEffect(() => subscribeWallet(setCoins), []);
  useEffect(() => subscribeAuthProfile(setUserProfile), []);

  useEffect(() => {
    if (!session || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { type: 'SET_CUSTOM_TOUCH_PAD', enabled: isSpectator ? false : touchPadVisible },
      window.location.origin
    );
  }, [session, touchPadVisible, bootKey]);

  useEffect(() => {
    if (!session) {
      setScorePanelOpen(false);
      setPauseMenuOpen(false);
      setQuickMenuOpen(false);
      setLiveRamTelemetry({ score: 0, lives: null, mode: 'heuristic' });
      setRamToast(null);
      setGameLeaderboard([]);
      return;
    }
    const gid = normalizeScoreGameId(session.gameId || session.title);
    const unsub = subscribeGameLeaderboard(gid, setGameLeaderboard);
    listGameSlots(userProfileRef.current?.uid, gid).then(setSavedSlots).catch(() => setSavedSlots([]));
    return () => unsub?.();
  }, [session?.gameId, session?.title]);

  useEffect(() => {
    const onFs = () => {
      const fs = Boolean(document.fullscreenElement);
      setIsFullscreen(fs);
      setFsBarVisible(false);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      if (fsHideTimerRef.current) clearTimeout(fsHideTimerRef.current);
    };
  }, []);

  const revealFsBar = (autoHideDelayMs = 3200) => {
    setFsBarVisible(true);
    if (fsHideTimerRef.current) clearTimeout(fsHideTimerRef.current);
    if (autoHideDelayMs > 0) {
      fsHideTimerRef.current = setTimeout(() => {
        setFsBarVisible(false);
      }, autoHideDelayMs);
    }
  };

  const scheduleHideFsBar = (delayMs = 1100) => {
    if (fsHideTimerRef.current) clearTimeout(fsHideTimerRef.current);
    fsHideTimerRef.current = setTimeout(() => {
      setFsBarVisible(false);
    }, delayMs);
  };

  useEffect(() => {
    const isTypingTarget = (el) => {
      const tag = el?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable;
    };
    const onKeyDown = (e) => {
      if (!session) return;
      if (e.key === 'Tab') {
        e.preventDefault();
        if (pauseMenuOpen) closePauseMenuAndResume();
        else openPauseMenu();
        return;
      }
      if (session.kind !== 'j2me' && !isSpectator && !quickMenuOpen && !pauseMenuOpen && !isTypingTarget(e.target)) {
        try {
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: 'FORWARD_KEY',
              eventType: 'keydown',
              code: e.code || '',
              key: e.key || '',
              keyCode: e.keyCode || e.which || 0,
            },
            window.location.origin
          );
        } catch {}
      }
    };
    const onKeyUp = (e) => {
      if (!session || session.kind === 'j2me' || isSpectator || quickMenuOpen || pauseMenuOpen || isTypingTarget(e.target)) return;
      try {
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: 'FORWARD_KEY',
            eventType: 'keyup',
            code: e.code || '',
            key: e.key || '',
            keyCode: e.keyCode || e.which || 0,
          },
          window.location.origin
        );
      } catch {}
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [session, isSpectator, quickMenuOpen, pauseMenuOpen]);

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
    sessionActivityLoggedRef.current = false;

    const gid = normalizeScoreGameId(session.gameId || session.title);
    const platformLabel = session.kind === 'j2me' ? 'Mobile / J2ME' : session.core?.toUpperCase() || 'Arcade';
    const logSessionStartOnce = () => {
      if (sessionActivityLoggedRef.current) return;
      sessionActivityLoggedRef.current = true;
      recordGameSessionActivity({
        userProfile: userProfileRef.current,
        gameId: gid,
        gameTitle: session.title,
        platformLabel,
        incrementParty: true,
        addPlayTimeSeconds: 0,
      }).catch(() => {});
    };

    // Enregistrer automatiquement la partie dans les stats du joueur même si le moteur met quelques secondes à émettre STAGE_STATUS
    const fallbackLogTimer = setTimeout(logSessionStartOnce, 3500);

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
                maxPlayers: session.maxPlayers ?? 2,
                accent: session.accent || '#00f0ff',
                filter,
                ratio,
                volume: settings?.audio?.volume ?? 80,
                muted: Boolean(settings?.audio?.muted),
                localData: true,
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
          logSessionStartOnce();
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
        if (session?.isSpectator || session?.playerIndex === 2) return;
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
            if (!res) return;
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
        if (session?.isNetplay) return;
        // Signal RAM de défaite / Game Over / Restart sur les profils vérifiés en Solo
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
      } else if (event.data.type === 'NETPLAY_GGPO_PACKET' && event.data.buffer) {
        p2pEngine?.sendGgpoPacket?.(event.data.buffer);
      } else if (event.data.type === 'NETPLAY_EMU_READY') {
        setLocalEmuReady(true);
        p2pEngine?.notifyEmuReady?.(Boolean(session?.isHost));
      } else if (event.data.type === 'NETPLAY_GUEST_READY') {
        setLocalEmuReady(true);
        p2pEngine?.notifyGuestEmuReady?.();
      } else if (event.data.type === 'NETPLAY_FRAME0_ACK') {
        p2pEngine?.sendFrame0Ack?.(Number(event.data.syncFrame || 0));
      } else if (event.data.type === 'NETPLAY_FRAME0_GO') {
        p2pEngine?.sendFrame0Go?.(Number(event.data.syncFrame || 0));
      } else if (event.data.type === 'NETPLAY_SYNC_COMPLETE') {
        setNetplaySyncReady(true);
      } else if (event.data.type === 'NETPLAY_SPECTATOR_READY') {
        if (isSpectator) {
          firebaseFightcadeService.joinSpectate({
            challengeId: session.challengeId,
            hostUid: session.hostUid,
            targetUid: session.opponentUid,
            spectatorName: getMyDisplayName(),
          });
        }
      } else if (event.data.type === 'NETPLAY_SPECTATE_RESYNC') {
        if (isSpectator) {
          firebaseFightcadeService.requestSpectateResync({
            challengeId: session.challengeId,
            hostUid: session.hostUid,
          });
        }
      } else if (event.data.type === 'NETPLAY_SPECTATE_STATE' && event.data.stateBase64) {
        if (session?.isNetplay && session?.isHost) {
          firebaseFightcadeService.sendSpectatorState(
            event.data.stateBase64,
            Number(event.data.syncFrame || 0),
            {
              challengeId: session.challengeId,
              targetUid: event.data.targetUid || null,
            }
          );
        }
      } else if (event.data.type === 'NETPLAY_SPECTATE_BATCH' && Array.isArray(event.data.frames)) {
        if (session?.isNetplay && session?.isHost) {
          firebaseFightcadeService.sendSpectatorInputBatch({
            challengeId: session.challengeId,
            frames: event.data.frames,
          });
        }
      } else if (event.data.type === 'ROLLBACK_TELEMETRY' && event.data.stats) {
        p2pEngine?.updateRollbackTelemetry?.(event.data.stats);
      } else if (event.data.type === 'STATE_EXPORTED' && event.data.stateBase64) {
        setSavedState(event.data.stateBase64);
        const slotName = event.data.slot || 'quick';
        if (slotName === 'frame0' || slotName === 'resync') {
          p2pEngine?.sendFrame0State?.(event.data.stateBase64, Number(event.data.syncFrame || 0));
        } else if (slotName === 'cloud_handoff') {
          onCloudCheckpoint?.(event.data.stateBase64);
        } else {
          // Sauvegarde manuelle persistante dans IndexedDB (États 1 à 5) + miniature écran + synchro Cloud
          const slotMatch = String(slotName).match(/^slot_(\d)$/);
          const slotNum = slotMatch ? Number(slotMatch[1]) : 1;
          const uid = userProfileRef.current?.uid;
          saveGameSlot(uid, gid, slotNum, event.data.stateBase64, {
            title: session.title,
            core: session.core,
            screenshotDataUrl: event.data.screenshotDataUrl || null,
          })
            .then(() => listGameSlots(uid, gid))
            .then((slots) => {
              setSavedSlots(slots);
              showRamToast('record', `💾 État ${slotNum} sauvegardé !`);
            })
            .catch(() => showRamToast('record', `💾 État sauvegardé en mémoire rapide !`));
          if (slotNum === 1) {
            onCloudCheckpoint?.(event.data.stateBase64);
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      clearTimeout(fallbackLogTimer);
      window.removeEventListener('message', handleMessage);
    };
  }, [session, bootKey, p2pEngine]);

  // Suivi automatique du temps de jeu (toutes les 15s) pour toutes les plateformes (Arcade, PS1, Nintendo, Sega, Java/J2ME)
  useEffect(() => {
    if (!session) return;
    const gid = normalizeScoreGameId(session.gameId || session.title);
    const platformLabel = session.kind === 'j2me' ? 'Mobile / J2ME' : session.core?.toUpperCase() || 'Arcade';
    const id = setInterval(() => {
      recordGameSessionActivity({
        userProfile: userProfileRef.current,
        gameId: gid,
        gameTitle: session.title,
        platformLabel,
        incrementParty: false,
        addPlayTimeSeconds: 15,
      }).catch(() => {});
    }, 15000);
    return () => clearInterval(id);
  }, [session?.gameId, session?.title, session?.core, session?.kind, bootKey]);

  // Sauvegarde automatique Cloud Handoff en arrière-plan (espacée sur les cœurs 3D lourds pour éviter tout freeze)
  useEffect(() => {
    if (!session || session.kind === 'j2me' || session.isNetplay) return;
    const isHeavy = ['n64', 'mupen64plus_next', 'psx', 'ps1', 'pcsx_rearmed', 'nds', 'melonds'].includes(
      String(session.core || '').toLowerCase()
    );
    const intervalMs = isHeavy ? 45000 : 20000;
    const id = setInterval(() => {
      try {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'EXPORT_STATE', slot: 'cloud_handoff' },
          window.location.origin
        );
      } catch {}
    }, intervalMs);
    return () => clearInterval(id);
  }, [session, bootKey]);

  // Pont P2P entrant : répercuter les paquets GGPO, inputs distants, événements multijoueur et le savestate Frame 0 dans l'iframe de l'émulateur
  useEffect(() => {
    if (!p2pEngine) return;
    p2pEngine.onGgpoPacket = (buffer) => {
      if (buffer) {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'NETPLAY_GGPO_PACKET', buffer },
          window.location.origin
        );
      }
    };
    p2pEngine.onRemoteButton = ({ buttonIdx, pressed }) => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'NETPLAY_REMOTE_BTN', buttonIdx, pressed },
        window.location.origin
      );
    };
    p2pEngine.onFrame0State = (stateBase64, syncFrame = 0) => {
      if (stateBase64) {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'LOAD_STATE', stateBase64, syncFrame: Number(syncFrame || 0), isNetplaySync: true },
          window.location.origin
        );
      }
    };
    if (p2pEngine.pendingIncomingFrame0?.stateBase64) {
      const { stateBase64, syncFrame } = p2pEngine.pendingIncomingFrame0;
      p2pEngine.pendingIncomingFrame0 = null;
      p2pEngine.onFrame0State(stateBase64, syncFrame);
    }
    p2pEngine.onFrame0Ack = (syncFrame = 0) => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'NETPLAY_FRAME0_ACK', syncFrame: Number(syncFrame || 0) },
        window.location.origin
      );
    };
    p2pEngine.onFrame0Go = (syncFrame = 0) => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'NETPLAY_FRAME0_GO', syncFrame: Number(syncFrame || 0) },
        window.location.origin
      );
    };
    p2pEngine.onGuestReady = () => {
      setRemoteEmuReady(true);
      if (session?.isNetplay && session?.isHost) {
        try {
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'EXPORT_NETPLAY_SYNC', slot: 'frame0', force: Boolean(session?.isLiveDropIn) },
            window.location.origin
          );
        } catch {}
      }
    };
    p2pEngine.onPeerEmuReady = () => {
      setRemoteEmuReady(true);
      if (session?.isLiveDropIn && session?.isHost) {
        try {
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'EXPORT_NETPLAY_SYNC', slot: 'frame0', force: true },
            window.location.origin
          );
        } catch {}
      }
    };
    p2pEngine.onNetplayEvent = (ev) => {
      if (!ev || !ev.event) return;
      const peerName = ev.senderName || session?.opponentName || 'Votre adversaire';
      if (ev.event === 'PEER_RECONNECTING') {
        showRamToast('record', `Reconnexion de ${peerName} en cours (15s)…`);
        return;
      }
      if (ev.event === 'MATCH_LEAVE') {
        // Ne jamais détruire ni éjecter le joueur restant : mettre simplement en pause douce et lui proposer Continuer ou Quitter
        try {
          iframeRef.current?.contentWindow?.postMessage({ type: 'PAUSE_EMU' }, window.location.origin);
        } catch {}
        setPauseMenuOpen(false);
        setQuickMenuOpen(false);
        setNetplayPanelOpen(false);
        setOpponentLeftModal({
          name: peerName,
          reason: ev.reason || 'quit',
        });
      } else if (ev.event === 'SYNC_PAUSE') {
        setRemotePausedBy(peerName);
        try {
          iframeRef.current?.contentWindow?.postMessage({ type: 'PAUSE_EMU' }, window.location.origin);
        } catch {}
        showRamToast('record', `⏸️ ${peerName} a mis le match en pause.`);
      } else if (ev.event === 'SYNC_RESUME') {
        setRemotePausedBy(null);
        setPauseMenuOpen(false);
        try {
          iframeRef.current?.focus();
          iframeRef.current?.contentWindow?.postMessage({ type: 'RESUME_EMU' }, window.location.origin);
        } catch {}
        showRamToast('record', `▶️ ${peerName} a repris le match !`);
      } else if (ev.event === 'REMATCH_REQUEST') {
        setRematchInviteFrom(peerName);
        showRamToast('record', `⚔️ ${peerName} demande une REVANCHE !`);
      } else if (ev.event === 'REMATCH_ACCEPT') {
        setRematchPending(false);
        setRematchInviteFrom(null);
        setRemotePausedBy(null);
        setPauseMenuOpen(false);
        showRamToast('record', `🔥 Revanche acceptée ! Redémarrage synchronisé…`);
        if (session?.isHost) {
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'NETPLAY_REMATCH_RESET' },
            window.location.origin
          );
        }
      } else if (ev.event === 'QUICK_CHAT' && ev.text) {
        showNetplayBubble(peerName, ev.text);
      } else if (ev.event === 'SET_INPUT_DELAY' && typeof ev.inputDelay === 'number') {
        setInputDelay(ev.inputDelay);
        p2pEngine?.setInputDelay?.(ev.inputDelay);
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'SET_GGPO_OPTIONS', inputDelay: ev.inputDelay },
          window.location.origin
        );
        showRamToast('record', `⚡ Délai GGPO ajusté à ${ev.inputDelay} frame(s) par ${peerName}`);
      } else if (ev.event === 'SHARED_COIN') {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'PRESS_BUTTON', button: 'coin' },
          window.location.origin
        );
        showRamToast('record', `🪙 +1 Crédit partagé inséré par ${peerName} !`);
      }
    };
  }, [p2pEngine, session?.isNetplay, session?.isHost, session?.opponentName]);

  // Pont Spectateur Live CSW Arcade : demande/envoi savestate + flux d'inputs confirmés + arrêt propre fin de match
  useEffect(() => {
    if (!session?.isNetplay) return;
    const unsubSpectate = firebaseFightcadeService.subscribeSpectate((ev) => {
      if (!ev || !ev.type) return;
      if (ev.type === 'SPECTATE_COUNT_UPDATE') {
        const count = Number(ev.spectatorsCount || 0);
        setSpectatorsCount(count);
        try {
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'NETPLAY_SPECTATOR_COUNT', count },
            window.location.origin
          );
        } catch {}
      } else if (ev.type === 'SPECTATE_SNAPSHOT_REQ' && session.isHost && !isSpectator) {
        try {
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'NETPLAY_SPECTATE_SNAPSHOT_REQ', targetUid: ev.targetUid || null },
            window.location.origin
          );
        } catch {}
      } else if (ev.type === 'SPECTATE_STATE' && isSpectator && ev.stateBase64) {
        try {
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: 'NETPLAY_SPECTATE_STATE',
              stateBase64: ev.stateBase64,
              syncFrame: Number(ev.syncFrame || 0),
            },
            window.location.origin
          );
        } catch {}
      } else if (ev.type === 'SPECTATE_INPUT_BATCH' && isSpectator && Array.isArray(ev.frames)) {
        try {
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'NETPLAY_SPECTATE_BATCH', frames: ev.frames },
            window.location.origin
          );
        } catch {}
      } else if ((ev.type === 'SPECTATE_ENDED' || ev.type === 'SPECTATE_UNAVAILABLE') && isSpectator) {
        try {
          iframeRef.current?.contentWindow?.postMessage({ type: 'STOP_NETPLAY_MATCH' }, window.location.origin);
        } catch {}
        setPauseMenuOpen(false);
        setQuickMenuOpen(false);
        setNetplayPanelOpen(false);
        setOpponentLeftModal({
          name: ev.senderName || session.opponentName || 'Un joueur',
          reason: ev.type === 'SPECTATE_UNAVAILABLE' ? 'unavailable' : 'spectate_ended',
          customMessage:
            ev.reason ||
            'La diffusion en direct est terminée car un des joueurs a quitté ou arrêté la partie.',
        });
      }
    });
    return () => unsubSpectate();
  }, [session?.isNetplay, session?.isHost, session?.opponentName, isSpectator]);

  // Si l'utilisateur ferme l'onglet, quitte via PWA (pagehide) ou recharge en plein match, arrêter immédiatement chez l'adversaire (ou désinscrire le spectateur)
  useEffect(() => {
    if (!session?.isNetplay) return;
    const onUnloadLeave = () => {
      try {
        if (isSpectator) {
          firebaseFightcadeService.leaveSpectate({ challengeId: session.challengeId });
          return;
        }
        const leaveEv = {
          event: 'MATCH_LEAVE',
          senderName: getMyDisplayName(),
          reason: 'disconnect',
          eventId: `leave_${Date.now()}`,
        };
        p2pEngine?.sendNetplayEvent?.(leaveEv);
        if (session.opponentUid) {
          firebaseFightcadeService.sendRelayInput(session.opponentUid, {
            syncType: 'NETPLAY_EVENT',
            eventData: leaveEv,
          });
        }
      } catch {}
    };
    window.addEventListener('beforeunload', onUnloadLeave);
    window.addEventListener('pagehide', onUnloadLeave);
    return () => {
      window.removeEventListener('beforeunload', onUnloadLeave);
      window.removeEventListener('pagehide', onUnloadLeave);
    };
  }, [session?.isNetplay, session?.opponentUid, session?.challengeId, isSpectator, p2pEngine]);

  // Synchroniser en direct les changements effectués dans SettingsModal (Lissage, Ratio 4:3 / 16:9 / 1:1)
  useEffect(() => {
    setFilter(settings?.video?.filter === 'smooth' ? 'smooth' : 'sharp');
  }, [settings?.video?.filter]);

  useEffect(() => {
    const ar = settings?.video?.aspectRatio;
    setRatio(ar === '16:9' ? 'stretch' : ar === 'pixel-perfect' ? 'pixel-perfect' : 'fit');
  }, [settings?.video?.aspectRatio]);

  // Masquage automatique du pad tactile lorsqu'une manette physique est branchée
  useEffect(() => {
    if (!session || settings?.touch?.autoHideOnGamepad === false) return undefined;
    const syncGamepadHide = () => {
      try {
        const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
        if (pads.length > 0) setTouchPadVisible(false);
        else setTouchPadVisible(detectDefaultTouchPad());
      } catch {}
    };
    syncGamepadHide();
    window.addEventListener('gamepadconnected', syncGamepadHide);
    window.addEventListener('gamepaddisconnected', syncGamepadHide);
    return () => {
      window.removeEventListener('gamepadconnected', syncGamepadHide);
      window.removeEventListener('gamepaddisconnected', syncGamepadHide);
    };
  }, [session, settings?.touch?.autoHideOnGamepad]);

  const gamepadActionRef = useRef({});

  // Raccourcis manette physique : Select = Sync Crédits (Coin), Double Start = Menu du jeu
  useEffect(() => {
    if (!session || session.kind === 'j2me' || typeof navigator === 'undefined' || !navigator.getGamepads) {
      return undefined;
    }
    let rafId = 0;
    let prevSelect = false;
    let prevStart = false;
    let lastStartTapAt = 0;

    const pollPad = () => {
      try {
        const pads = navigator.getGamepads();
        let selectNow = false;
        let startNow = false;
        for (let i = 0; i < pads.length; i += 1) {
          const p = pads[i];
          if (!p?.buttons) continue;
          if (p.buttons[8]?.pressed) selectNow = true;
          if (p.buttons[9]?.pressed) startNow = true;
        }

        const actions = gamepadActionRef.current;

        if (selectNow && !prevSelect && !actions.isSpectator && !actions.pauseMenuOpen) {
          actions.sendButton('coin');
          actions.showRamToast('record', `🪙 Crédits synchronisés (${String(actions.coins).padStart(2, '0')}/99)`);
        }

        if (startNow && !prevStart) {
          const now = performance.now();
          if (now - lastStartTapAt <= 400) {
            lastStartTapAt = 0;
            if (actions.pauseMenuOpen) actions.closePauseMenuAndResume();
            else actions.openPauseMenu();
          } else {
            lastStartTapAt = now;
          }
        }

        prevSelect = selectNow;
        prevStart = startNow;
      } catch {}
      rafId = requestAnimationFrame(pollPad);
    };

    rafId = requestAnimationFrame(pollPad);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [session]);

  const someoneSpeakingInVoice = Boolean(
    voiceState?.roomId &&
      settings?.voice?.audioDucking !== false &&
      (voiceState.members || []).some((m) => m.speaking && !m.muted)
  );

  useEffect(() => {
    if (!session || !iframeRef.current?.contentWindow) return;
    const baseVol = settings?.audio?.volume ?? 80;
    const effectiveVol = someoneSpeakingInVoice ? Math.round(baseVol * 0.6) : baseVol;
    iframeRef.current.contentWindow.postMessage(
      {
        type: 'UPDATE_DISPLAY',
        filter,
        ratio,
        shader: settings?.video?.shader || 'none',
        scanlines: Boolean(settings?.video?.scanlines),
        streamMode: Boolean(settings?.performance?.streamMode),
        volume: effectiveVol,
        muted: Boolean(settings?.audio?.muted),
      },
      window.location.origin
    );
  }, [
    session,
    filter,
    ratio,
    settings?.video?.shader,
    settings?.video?.scanlines,
    settings?.performance?.streamMode,
    settings?.audio?.volume,
    settings?.audio?.muted,
    someoneSpeakingInVoice,
  ]);

  if (!session) return null;

  const iframeSrc = session.kind === 'j2me' ? './app/stages/j2me-frame.html' : './app/stages/emu-frame.html';

  const sendButton = (button) => {
    if (button === 'coin') {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.focus();
        iframeRef.current.contentWindow.postMessage(
          { type: 'UPDATE_COINS', coins, locked: coins <= 0, resume: coins > 0 },
          window.location.origin
        );
        iframeRef.current.contentWindow.postMessage({ type: 'FORCE_SYNC_CREDITS' }, window.location.origin);
      }
      return;
    }
    if (!iframeRef.current?.contentWindow) return;
    iframeRef.current.focus();
    iframeRef.current.contentWindow.postMessage({ type: 'PRESS_BUTTON', button }, window.location.origin);
  };

  gamepadActionRef.current = {
    pauseMenuOpen,
    coins,
    isSpectator,
    openPauseMenu,
    closePauseMenuAndResume,
    sendButton,
    showRamToast,
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

  const handleForceResync = () => {
    if (!session?.isNetplay) return;
    if (session.isHost) {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'EXPORT_NETPLAY_SYNC', slot: 'resync', force: true },
        window.location.origin
      );
    } else {
      p2pEngine?.notifyGuestEmuReady?.();
    }
    showRamToast('record', '🔄 Resynchronisation GGPO 100% envoyée !');
  };

  const handleRequestRematch = () => {
    if (!session?.isNetplay || !p2pEngine) return;
    setRematchPending(true);
    p2pEngine.sendNetplayEvent({
      event: 'REMATCH_REQUEST',
      senderName: getMyDisplayName(),
    });
    showRamToast('record', '⚔️ Demande de revanche envoyée à votre adversaire…');
  };

  const handleAcceptRematch = () => {
    if (!session?.isNetplay || !p2pEngine) return;
    setRematchInviteFrom(null);
    setRematchPending(false);
    setRemotePausedBy(null);
    setPauseMenuOpen(false);
    p2pEngine.sendNetplayEvent({
      event: 'REMATCH_ACCEPT',
      senderName: getMyDisplayName(),
    });
    showRamToast('record', '🔥 Revanche lancée ! Synchronisation Frame 0…');
    if (session.isHost) {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'NETPLAY_REMATCH_RESET' },
        window.location.origin
      );
    }
  };

  const handleSendQuickChat = (text) => {
    const clean = String(text || '').trim().slice(0, 80);
    if (!clean || !session?.isNetplay || !p2pEngine) return;
    const myName = getMyDisplayName();
    p2pEngine.sendNetplayEvent({
      event: 'QUICK_CHAT',
      senderName: myName,
      text: clean,
    });
    showNetplayBubble(myName, clean);
    setQuickChatInput('');
  };

  const handleChangeNetplayDelay = (d) => {
    const clean = Math.max(0, Math.min(4, Number(d) || 0));
    setInputDelay(clean);
    onInputDelayChange?.(clean);
    p2pEngine?.setInputDelay?.(clean);
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'SET_GGPO_OPTIONS', inputDelay: clean },
      window.location.origin
    );
    if (session?.isNetplay && p2pEngine) {
      p2pEngine.sendNetplayEvent({
        event: 'SET_INPUT_DELAY',
        senderName: getMyDisplayName(),
        inputDelay: clean,
      });
    }
  };

  const handleToggleAutoHeal = (enabled) => {
    setAutoHealSync(enabled);
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'SET_GGPO_OPTIONS', autoHeal: enabled },
      window.location.origin
    );
  };

  const handleSharedCoin = () => {
    if (!session?.isNetplay) return;
    sendButton('coin');
    p2pEngine?.sendNetplayEvent?.({
      event: 'SHARED_COIN',
      senderName: getMyDisplayName(),
    });
    showRamToast('record', '🪙 +1 Crédit partagé envoyé aux 2 joueurs !');
  };

  const handleCloseStage = () => {
    try {
      if (session?.isNetplay) {
        try {
          iframeRef.current?.contentWindow?.postMessage({ type: 'STOP_NETPLAY_MATCH' }, window.location.origin);
        } catch {}
        if (isSpectator) {
          firebaseFightcadeService.leaveSpectate({ challengeId: session.challengeId });
        } else if (!opponentLeftModal) {
          const leaveEv = {
            event: 'MATCH_LEAVE',
            senderName: getMyDisplayName(),
            reason: 'quit',
            eventId: `quit_${Date.now()}`,
          };
          p2pEngine?.sendNetplayEvent?.(leaveEv);
          if (session.opponentUid) {
            firebaseFightcadeService.sendRelayInput(session.opponentUid, {
              syncType: 'NETPLAY_EVENT',
              eventData: leaveEv,
            });
          }
        }
      }
      if (!isSpectator) {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'FLUSH_RAM_SCORE', reason: 'session_end' },
          window.location.origin
        );
      }
      if (session?.kind !== 'j2me' && !session?.isNetplay && !isSpectator) {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'EXPORT_STATE', slot: 'cloud_handoff' },
          window.location.origin
        );
      }
    } catch {}
    setTimeout(() => onClose?.(), 180);
  };

  const showFsBar = !isFullscreen || fsBarVisible || pauseMenuOpen || quickMenuOpen || scorePanelOpen || netplayPanelOpen;

  return (
    <div
      ref={stageRef}
      className="keep-dark fixed inset-0 h-[100dvh] z-50 flex flex-col bg-neutral-950 text-neutral-100 pt-safe pb-safe"
      role="dialog"
      aria-modal="true"
    >
      {/* Zone sensible en haut de l'écran en mode Plein Écran (curseur en haut sur PC ou swipe vers le bas sur mobile) */}
      {isFullscreen && !showFsBar && (
        <div
          onMouseEnter={() => revealFsBar(0)}
          onMouseMove={() => revealFsBar(0)}
          onTouchStart={(e) => {
            fsTouchStartYRef.current = e.touches?.[0]?.clientY ?? null;
          }}
          onTouchMove={(e) => {
            const y0 = fsTouchStartYRef.current;
            const y1 = e.touches?.[0]?.clientY;
            if (typeof y0 === 'number' && typeof y1 === 'number' && y1 - y0 > 12) {
              fsTouchStartYRef.current = null;
              revealFsBar(4000);
            }
          }}
          onTouchEnd={() => {
            fsTouchStartYRef.current = null;
          }}
          className="fixed top-0 inset-x-0 h-6 sm:h-4 z-[55] bg-transparent"
          title="Glissez vers le bas ou placez le curseur en haut pour afficher la barre"
        />
      )}

      <div
        onMouseEnter={() => {
          if (isFullscreen && fsHideTimerRef.current) clearTimeout(fsHideTimerRef.current);
        }}
        onMouseLeave={() => {
          if (isFullscreen) scheduleHideFsBar(900);
        }}
        onTouchStart={(e) => {
          if (isFullscreen) {
            fsTouchStartYRef.current = e.touches?.[0]?.clientY ?? null;
            revealFsBar(4500);
          }
        }}
        onTouchMove={(e) => {
          const y0 = fsTouchStartYRef.current;
          const y1 = e.touches?.[0]?.clientY;
          if (isFullscreen && typeof y0 === 'number' && typeof y1 === 'number' && y0 - y1 > 18) {
            fsTouchStartYRef.current = null;
            setFsBarVisible(false);
          }
        }}
        className={`${
          isFullscreen
            ? `fixed top-0 inset-x-0 z-[60] transition-all duration-300 ease-out shadow-2xl ${
                showFsBar
                  ? 'translate-y-0 opacity-100 pointer-events-auto'
                  : '-translate-y-full opacity-0 pointer-events-none'
              }`
            : 'relative shrink-0'
        } h-12 flex items-center justify-between gap-2 px-2.5 sm:px-3.5 bg-neutral-950/95 backdrop-blur-md border-b border-white/10`}
      >
        {/* Gauche : Quitter + Titre lisible + Badge discret */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={handleCloseStage}
            title="Quitter le jeu"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-neutral-800/90 hover:bg-neutral-700 text-xs font-bold text-neutral-100 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
            <span className="hidden sm:inline">Quitter</span>
          </button>

          <div className="min-w-0 flex items-center gap-2">
            <span className="font-black text-xs sm:text-sm text-white truncate">
              {session.title}
            </span>
            <span className="hidden md:inline-flex px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-cyan-950/80 border border-cyan-700/50 text-cyan-300 shrink-0">
              {session.badge}
            </span>
          </div>
        </div>

        {/* Droite : Crédits / Statut Spectateur / Options 2P / Menu */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {session.kind !== 'j2me' && !isSpectator && (
            <div className="px-2 py-1 rounded-xl bg-amber-950/50 border border-amber-500/40 text-amber-300 text-[11px] font-mono font-bold flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>{String(coins).padStart(2, '0')}</span>
              <span className="hidden lg:inline text-amber-400/70">/99</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  addCoins(10);
                }}
                title="Mode Test : Ajouter +10 Coins gratuitement"
                className="px-1.5 py-0.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-black text-[10px] font-black transition-all active:scale-95"
              >
                +10
              </button>
            </div>
          )}

          {isSpectator && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-purple-950/80 border border-purple-500/50 text-purple-200 text-[11px] font-mono font-bold">
              <Eye className="w-3.5 h-3.5 text-purple-300 animate-pulse shrink-0" />
              <span>LIVE</span>
              {spectatorsCount > 0 && (
                <span className="text-purple-300/80">· {spectatorsCount}</span>
              )}
            </div>
          )}

          {session.isNetplay && !isSpectator && session.kind !== 'j2me' && (() => {
            const ping = Number(p2pStats?.pingMs || 0);
            const pingColor =
              ping === 0
                ? 'text-cyan-300'
                : ping < 90
                  ? 'text-emerald-300'
                  : ping < 200
                    ? 'text-amber-300'
                    : 'text-rose-300';
            return (
              <button
                type="button"
                onClick={() => {
                  setQuickMenuOpen(false);
                  setScorePanelOpen(false);
                  setPauseMenuOpen(false);
                  setNetplayPanelOpen((v) => !v);
                }}
                title="Options Multijoueur 2P (Resync, Revanche, Chat, GGPO)"
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-colors ${
                  netplayPanelOpen
                    ? 'bg-cyan-500 text-black border-cyan-400'
                    : 'bg-indigo-950/80 hover:bg-indigo-900/80 border-indigo-500/50 text-indigo-100'
                }`}
              >
                <Radio className="w-3.5 h-3.5 shrink-0" />
                <span>2P</span>
                {p2pStats && (
                  <span className={`font-mono text-[10px] font-black ${netplayPanelOpen ? 'text-black' : pingColor}`}>
                    {ping}ms
                  </span>
                )}
                {spectatorsCount > 0 && (
                  <span className={`inline-flex items-center gap-0.5 font-mono text-[10px] ${netplayPanelOpen ? 'text-black' : 'text-purple-300'}`}>
                    · <Eye className="w-3 h-3" /> {spectatorsCount}
                  </span>
                )}
              </button>
            );
          })()}

          {voiceState?.roomId && (
            <button
              type="button"
              onClick={() => onToggleVoiceMute?.()}
              title={voiceState.muted ? 'Activer votre micro (Vocal actif)' : 'Couper votre micro (Vocal actif)'}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-colors ${
                voiceState.muted
                  ? 'bg-rose-500/20 border-rose-500/50 text-rose-200'
                  : voiceState.speaking
                  ? 'bg-emerald-500 border-emerald-400 text-black'
                  : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
              }`}
            >
              {voiceState.muted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{voiceState.muted ? 'Muet' : 'Vocal'}</span>
            </button>
          )}

          {session.kind !== 'j2me' && !isSpectator && (
            <button
              type="button"
              onClick={() => {
                sendButton('coin');
                showRamToast('record', `🪙 Crédits synchronisés (${String(coins).padStart(2, '0')}/99)`);
              }}
              title="Synchroniser vos crédits / insérer un crédit"
              className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-bold transition-colors shrink-0"
            >
              <Coins className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden md:inline">Sync Crédits</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              const next = ratio === 'fit' ? 'stretch' : ratio === 'stretch' ? 'pixel-perfect' : 'fit';
              setRatio(next);
              const savedVal = next === 'stretch' ? '16:9' : next === 'pixel-perfect' ? 'pixel-perfect' : '4:3';
              onUpdateVideoSetting?.('aspectRatio', savedVal);
              showRamToast(
                'record',
                `🖥️ Taille d'écran : ${next === 'stretch' ? '16:9 Plein Écran' : next === 'pixel-perfect' ? '1:1 Pixel Perfect' : '4:3 Arcade'}`
              );
            }}
            title="Changer la taille d'écran (4:3 · 16:9 · 1:1)"
            className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-xl bg-neutral-800/90 hover:bg-neutral-700 border border-white/15 text-neutral-100 text-[11px] font-mono font-bold transition-colors shrink-0"
          >
            <span>{ratio === 'stretch' ? '16:9' : ratio === 'pixel-perfect' ? '1:1' : '4:3'}</span>
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
            aria-label={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
            className="flex items-center justify-center p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl bg-neutral-800/90 hover:bg-neutral-700 border border-white/15 text-neutral-100 text-xs font-bold transition-colors shrink-0"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {session.kind !== 'j2me' && !session.isNetplay && (
            <button
              type="button"
              onClick={() => sendButton('start')}
              onDoubleClick={() => (pauseMenuOpen ? closePauseMenuAndResume() : openPauseMenu())}
              title="Démarrer / Start (Touche 1 · Double-clic : Menu du jeu)"
              className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Start</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => (pauseMenuOpen ? closePauseMenuAndResume() : openPauseMenu())}
            title="Menu du jeu (Pause, Affichage, Pad, Sauvegardes, Score RAM, Paramètres)"
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors ${
              pauseMenuOpen
                ? 'bg-cyan-500 text-black border-cyan-400'
                : 'bg-cyan-500/20 hover:bg-cyan-500/30 border-cyan-500/50 text-cyan-100'
            }`}
          >
            {pauseMenuOpen ? <Play className="w-3.5 h-3.5" /> : <Sliders className="w-3.5 h-3.5" />}
            <span>{pauseMenuOpen ? 'Reprendre' : 'Menu'}</span>
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

        {/* Sas d'attente mutuel Netplay OU connexion Spectateur Live */}
        {session.isNetplay && !netplaySyncReady && !opponentLeftModal && (
          <div className="absolute inset-0 z-[55] bg-neutral-950/92 backdrop-blur-md flex items-center justify-center p-4">
            <div className="max-w-md w-full rounded-2xl bg-neutral-900 border-2 border-cyan-500/50 p-6 text-center space-y-4 shadow-2xl">
              <div className="w-12 h-12 rounded-full bg-cyan-500/15 border-2 border-cyan-400 flex items-center justify-center mx-auto">
                {isSpectator ? (
                  <Eye className="w-6 h-6 text-purple-300 animate-pulse" />
                ) : (
                  <Radio className="w-6 h-6 text-cyan-300 animate-pulse" />
                )}
              </div>
              {isSpectator ? (
                <div className="space-y-1.5">
                  <h3 className="text-base font-black text-white uppercase tracking-wide">
                    Connexion au match en direct…
                  </h3>
                  <p className="text-xs text-neutral-300 leading-relaxed">
                    {localEmuReady
                      ? 'Réception du savestate live depuis l’Hôte et remplissage du tampon CSW Arcade (0 Coin requis)…'
                      : 'Préparation du moteur WASM en mode lecture seule pour observer le match…'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <h3 className="text-base font-black text-white uppercase tracking-wide">
                      Synchronisation des 2 joueurs…
                    </h3>
                    <p className="text-xs text-neutral-300">
                      {localEmuReady && remoteEmuReady
                        ? 'Transfert & verrouillage de la Frame 0 pour un départ simultané…'
                        : 'Le premier joueur prêt patiente jusqu’à la fin du chargement de son adversaire.'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 text-xs">
                    <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 space-y-1">
                      <div className="text-[10px] font-mono text-cyan-300 font-bold">
                        {session.isHost ? 'VOUS (P1 HÔTE)' : 'ADVERSAIRE (P1)'}
                      </div>
                      <div className={`font-black ${(session.isHost ? localEmuReady : remoteEmuReady) ? 'text-emerald-400' : 'text-amber-300 animate-pulse'}`}>
                        {(session.isHost ? localEmuReady : remoteEmuReady) ? 'Moteur prêt ✅' : 'Chargement… ⏳'}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 space-y-1">
                      <div className="text-[10px] font-mono text-rose-300 font-bold">
                        {!session.isHost ? 'VOUS (P2 INVITÉ)' : 'ADVERSAIRE (P2)'}
                      </div>
                      <div className={`font-black ${(!session.isHost ? localEmuReady : remoteEmuReady) ? 'text-emerald-400' : 'text-amber-300 animate-pulse'}`}>
                        {(!session.isHost ? localEmuReady : remoteEmuReady) ? 'Moteur prêt ✅' : 'Chargement… ⏳'}
                      </div>
                    </div>
                  </div>
                </>
              )}
              <button
                type="button"
                onClick={handleCloseStage}
                className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs font-bold text-neutral-300 transition-colors"
              >
                {isSpectator ? 'Quitter le mode Spectateur' : 'Annuler & Quitter'}
              </button>
            </div>
          </div>
        )}

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

        {/* Bulle de Chat Rapide / Provocation Arcade en direct (Multijoueur) */}
        {netplayChatBubble && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-neutral-900/95 border-2 border-cyan-400 text-white text-xs font-bold shadow-2xl flex items-center gap-2 pointer-events-none animate-bounce">
            <MessageSquare className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="text-cyan-300 font-black">{netplayChatBubble.sender} :</span>
            <span>{netplayChatBubble.text}</span>
          </div>
        )}

        {/* Bannière Proposition de Revanche Entrante */}
        {rematchInviteFrom && !opponentLeftModal && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 w-full max-w-md mx-auto px-4 py-3 rounded-2xl bg-neutral-900/95 backdrop-blur-xl border-2 border-rose-500 shadow-2xl flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Swords className="w-5 h-5 text-rose-400 animate-pulse shrink-0" />
              <div className="text-xs">
                <div className="font-black text-white truncate">{rematchInviteFrom} veut une REVANCHE !</div>
                <div className="text-[11px] text-neutral-300">Relancer le match à zéro maintenant ?</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleAcceptRematch}
                className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black transition-colors"
              >
                Accepter
              </button>
              <button
                type="button"
                onClick={() => setRematchInviteFrom(null)}
                className="px-2.5 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-bold"
              >
                Non
              </button>
            </div>
          </div>
        )}

        {/* Overlay Pause Réseau Synchronisée déclenchée par l'adversaire */}
        {remotePausedBy && !pauseMenuOpen && !opponentLeftModal && (
          <div className="absolute inset-0 z-40 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="max-w-md w-full rounded-2xl bg-neutral-900 border-2 border-amber-500/60 p-6 text-center space-y-4 shadow-2xl">
              <Pause className="w-10 h-10 text-amber-400 mx-auto animate-pulse" />
              <div>
                <h3 className="text-base font-black text-white uppercase">Match mis en pause par {remotePausedBy}</h3>
                <p className="text-xs text-neutral-300 mt-1">
                  La simulation GGPO est figée sur les deux écrans pour conserver une synchronisation à 100 %.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => closePauseMenuAndResume(false)}
                  className="px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-black flex items-center gap-1.5"
                >
                  <Play className="w-4 h-4" />
                  <span>Reprendre pour les 2 joueurs</span>
                </button>
                <button
                  type="button"
                  onClick={handleCloseStage}
                  className="px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-rose-950 text-neutral-200 text-xs font-bold"
                >
                  Quitter le match
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TOAST INVITATION / DROP-IN IN-GAME (dans stageRef -> z-[220] toujours au premier plan même en Plein Écran) */}
        {incomingChallenge && (
          <div
            className="fixed top-14 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-4 z-[220] w-[calc(100%-1.5rem)] max-w-sm rounded-2xl bg-neutral-950/95 backdrop-blur-xl border-2 border-emerald-400 p-4 shadow-2xl ring-4 ring-emerald-500/30 space-y-3 animate-fade-in"
            role="alertdialog"
            aria-label="Invitation à rejoindre votre partie"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 u-accent-text font-black text-xs uppercase">
                <Swords className="w-4 h-4 animate-pulse shrink-0" aria-hidden="true" />
                <span>Demande de Drop-In reçue !</span>
              </div>
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 text-[10px] font-mono font-bold">
                Sans redémarrer
              </span>
            </div>
            <p className="text-xs text-neutral-100 leading-relaxed">
              <strong className="text-white">{incomingChallenge.fromName}</strong> veut rejoindre{' '}
              <strong className="u-accent-text">{incomingChallenge.gameTitle}</strong> directement là où vous êtes (J2 · il appuie juste sur Start).
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onRespondChallenge?.(true)}
                className="arcade-focus-ring flex-1 py-2.5 px-3 min-h-[44px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black transition-colors"
              >
                Accepter (Continuer ici)
              </button>
              <button
                type="button"
                onClick={() => onRespondChallenge?.(false)}
                className="arcade-focus-ring px-3.5 py-2.5 min-h-[44px] rounded-xl bg-neutral-800 hover:bg-rose-950 border border-white/15 text-neutral-200 hover:text-rose-200 text-xs font-bold transition-colors"
              >
                Refuser
              </button>
            </div>
          </div>
        )}

        {/* MODALE CHOIX QUAND UN JOUEUR QUITTE LA PARTIE : CONTINUER OU QUITTER */}
        {opponentLeftModal && (
          <div
            className="absolute inset-0 z-[70] bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Un joueur a quitté la partie"
          >
            <div className="max-w-md w-full rounded-3xl bg-neutral-900 border-2 u-accent-border p-6 text-center space-y-4 shadow-2xl">
              <div className="w-14 h-14 rounded-2xl u-badge flex items-center justify-center mx-auto">
                <Trophy className="w-7 h-7" />
              </div>
              <div className="space-y-1.5">
                <span className="inline-block px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 text-[10px] font-mono font-black uppercase">
                  {isSpectator ? 'Diffusion terminée' : 'Départ d’un joueur · Partie en pause'}
                </span>
                <h3 className="text-lg font-black text-white">
                  {isSpectator
                    ? `Le match (${opponentLeftModal.name}) est terminé`
                    : `${opponentLeftModal.name} a quitté la partie`}
                </h3>
                <p className="text-xs text-neutral-300 leading-relaxed">
                  {isSpectator
                    ? opponentLeftModal.customMessage || 'La diffusion du match en direct est terminée.'
                    : 'Votre progression est intacte. Voulez-vous continuer la partie maintenant (0 Coin) ou quitter vers le salon ?'}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                {!isSpectator && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpponentLeftModal(null);
                      setContinuedSolo(true);
                      try {
                        p2pEngine?.destroy?.();
                        iframeRef.current?.contentWindow?.postMessage({ type: 'CONVERT_TO_SOLO' }, window.location.origin);
                        iframeRef.current?.contentWindow?.postMessage({ type: 'RESUME_EMU' }, window.location.origin);
                        iframeRef.current?.focus();
                      } catch {}
                      showRamToast('record', 'Partie poursuivie sans interruption (0 Coin) !');
                    }}
                    className="arcade-focus-ring flex-1 py-3 px-4 min-h-[44px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black transition-colors"
                  >
                    Continuer la partie
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setOpponentLeftModal(null);
                    onOpenSalon?.();
                  }}
                  className={`arcade-focus-ring ${isSpectator ? 'flex-1 u-btn-primary' : 'py-3 px-4 bg-neutral-800 hover:bg-rose-950 border border-white/15 text-neutral-200 hover:text-rose-200'} py-3 px-4 min-h-[44px] rounded-xl text-xs font-bold transition-colors`}
                >
                  {isSpectator ? 'Retourner au Salon' : 'Quitter vers le salon'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PANNEAU OPTIONS MULTIJOUEUR FIGHTCADE GGPO (Options 2P) */}
        {netplayPanelOpen && session.isNetplay && (
          <aside className="absolute inset-y-0 right-0 w-96 max-w-full bg-neutral-950/95 backdrop-blur-xl border-l border-cyan-500/40 p-4 flex flex-col gap-3.5 z-40 shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2">
                <Radio className="w-5 h-5 text-cyan-400 animate-pulse" />
                <div>
                  <h3 className="text-sm font-black text-white">OPTIONS MULTIJOUEUR · GGPO</h3>
                  <p className="text-[11px] font-mono text-cyan-300 truncate max-w-[230px]">
                    VS {session.opponentName || 'Adversaire'} · {session.isHost ? 'P1 Hôte' : 'P2 Invité'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNetplayPanelOpen(false)}
                className="p-1.5 rounded-lg bg-neutral-800 text-neutral-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Télémétrie GGPO temps réel */}
            <div className="p-3 rounded-xl bg-neutral-900 border border-cyan-500/30 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-neutral-400 font-bold uppercase">Moteur Rollback 60.00 FPS</span>
                <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-500/50 text-emerald-300 font-black">
                  SYNC {p2pStats?.syncStatus || '100%'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded-lg bg-neutral-950 border border-neutral-800">
                  <div className="text-[9px] font-mono text-neutral-400">PING RTT</div>
                  <div className="text-xs font-mono font-black text-emerald-300">{p2pStats?.pingMs ?? 0} ms</div>
                </div>
                <div className="p-2 rounded-lg bg-neutral-950 border border-neutral-800">
                  <div className="text-[9px] font-mono text-neutral-400">ROLLBACK</div>
                  <div className="text-xs font-mono font-black text-cyan-300">
                    {p2pStats?.rollbackFrames ?? 0}f ({p2pStats?.totalRollbacks ?? 0})
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-neutral-950 border border-neutral-800">
                  <div className="text-[9px] font-mono text-neutral-400">FRAME #</div>
                  <div className="text-xs font-mono font-black text-amber-300">{p2pStats?.currentFrame ?? 0}</div>
                </div>
              </div>
            </div>

            {/* Actions Rapides de Match */}
            <div className="space-y-2">
              <div className="text-[11px] font-mono uppercase text-neutral-400 font-bold">Actions de Match</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleForceResync}
                  className="p-2.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 text-cyan-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Resync RAM 100%</span>
                </button>
                <button
                  type="button"
                  onClick={handleRequestRematch}
                  disabled={rematchPending}
                  className="p-2.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 disabled:opacity-50 border border-rose-500/50 text-rose-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Swords className="w-3.5 h-3.5" />
                  <span>{rematchPending ? 'Envoyé…' : 'Revanche 2P'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleSharedCoin}
                  className="p-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Coins className="w-3.5 h-3.5" />
                  <span>+1 Crédit Partagé</span>
                </button>
                <button
                  type="button"
                  onClick={() => (pauseMenuOpen ? closePauseMenuAndResume(false) : openPauseMenu(false))}
                  className="p-2.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/50 text-purple-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause Sync 2P</span>
                </button>
              </div>
            </div>

            {/* Réglage du Délai d'Entrée GGPO (0f à 4f) synchronisé */}
            <div className="p-3 rounded-xl bg-neutral-900 border border-neutral-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-white">Délai d&apos;entrée GGPO (Input Delay)</span>
                <span className="font-mono font-black text-cyan-300">{inputDelay} frame(s)</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {[
                  { f: 0, label: '0f LAN' },
                  { f: 1, label: '1f Fast' },
                  { f: 2, label: '2f Auto' },
                  { f: 3, label: '3f WiFi' },
                  { f: 4, label: '4f 4G' },
                ].map((opt) => (
                  <button
                    key={opt.f}
                    type="button"
                    onClick={() => handleChangeNetplayDelay(opt.f)}
                    className={`py-1.5 rounded-lg border text-[10px] font-mono font-bold transition-colors ${
                      inputDelay === opt.f
                        ? 'bg-cyan-500 text-black border-cyan-400 font-black'
                        : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:border-neutral-600'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <label className="flex items-center justify-between pt-2 border-t border-neutral-800 text-xs cursor-pointer">
                <span className="text-neutral-300">Auto-Resync Checksum RAM (0xCB)</span>
                <input
                  type="checkbox"
                  checked={autoHealSync}
                  onChange={(e) => handleToggleAutoHeal(e.target.checked)}
                  className="accent-cyan-400 w-4 h-4"
                />
              </label>
            </div>

            {/* Chat Rapide & Provocations Arcade en Direct */}
            <div className="p-3 rounded-xl bg-neutral-900 border border-neutral-800 space-y-2.5 flex-1">
              <div className="text-[11px] font-mono uppercase text-cyan-300 font-bold flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Chat Rapide &amp; Emotes En Jeu</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  '🔥 GG !',
                  '👏 Bien joué !',
                  '⚔️ Revanche ?',
                  '⚡ Prêt !',
                  '😎 Trop fort !',
                  '😱 Quel match !',
                  '🪙 +1 Crédit !',
                  '📡 Petit lag',
                ].map((emote) => (
                  <button
                    key={emote}
                    type="button"
                    onClick={() => handleSendQuickChat(emote)}
                    className="px-2.5 py-1.5 rounded-lg bg-neutral-950 hover:bg-cyan-950/60 border border-neutral-800 hover:border-cyan-500/50 text-left text-xs text-neutral-200 font-semibold transition-colors"
                  >
                    {emote}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendQuickChat(quickChatInput);
                }}
                className="flex gap-1.5 pt-1"
              >
                <input
                  type="text"
                  value={quickChatInput}
                  onChange={(e) => setQuickChatInput(e.target.value)}
                  placeholder="Message rapide à l'écran…"
                  maxLength={60}
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 text-xs text-white focus:outline-none focus:border-cyan-400"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-black flex items-center gap-1"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>

            <button
              type="button"
              onClick={handleCloseStage}
              className="w-full py-2.5 rounded-xl bg-rose-950/80 hover:bg-rose-900 border border-rose-500/50 text-rose-200 text-xs font-black transition-colors"
            >
              🏳️ Abandonner &amp; Quitter le Match
            </button>
          </aside>
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
                  <div className="p-4 rounded-xl bg-neutral-900/70 border border-neutral-800 text-center text-xs text-neutral-400">
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

        {/* MENU PAUSE STYLE PPSSPP (Jeu figé + 5 États de sauvegarde avec aperçu + Paramètres directs) */}
        {pauseMenuOpen && (
          <div className="absolute inset-0 z-50 bg-neutral-950/90 backdrop-blur-lg flex flex-col p-3 sm:p-6 overflow-y-auto">
            <div className="max-w-5xl w-full mx-auto flex flex-col gap-4 sm:gap-5 my-auto">
              {/* En-tête PPSSPP */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-neutral-800">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/50 text-amber-300 text-[10px] font-mono font-black uppercase">
                      {isSpectator ? '👁 Spectateur Live' : '⏸ Jeu en Pause'}
                    </span>
                    <span className="text-[11px] font-mono text-cyan-300">{session.badge}</span>
                  </div>
                  <h2 className="text-base sm:text-xl font-black text-white mt-1 truncate">
                    {session.title}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closePauseMenuAndResume}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-black text-xs sm:text-sm transition-colors shadow-lg"
                >
                  <Play className="w-4 h-4" />
                  <span>{isSpectator ? 'Revenir au direct' : 'Reprendre la partie'}</span>
                </button>
              </div>

              {/* Barre d'outils rapide (Pad, Affichage, Plein écran, Score RAM, Start/Crédits, Salon) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                {!isSpectator && (
                  <button
                    type="button"
                    onClick={() => setTouchPadVisible((v) => !v)}
                    className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                      touchPadVisible
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                        : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:text-white'
                    }`}
                  >
                    <Gamepad2 className="w-3.5 h-3.5" />
                    <span>Pad : {touchPadVisible ? 'ON' : 'OFF'}</span>
                  </button>
                )}
                {session.kind !== 'j2me' && (
                  <>
                    <button
                      type="button"
                      onClick={() => setFilter((f) => (f === 'smooth' ? 'sharp' : 'smooth'))}
                      className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs font-bold text-neutral-200 transition-colors"
                    >
                      {filter === 'smooth' ? '✨ Lissé' : '🟦 Pixel net'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRatio((r) => (r === 'stretch' ? 'fit' : 'stretch'))}
                      className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs font-bold text-neutral-200 transition-colors"
                    >
                      {ratio === 'stretch' ? '📐 16:9 Étiré' : '📺 4:3 Origine'}
                    </button>
                    {!isSpectator && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setPauseMenuOpen(false);
                            setScorePanelOpen(true);
                          }}
                          className="px-3 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Trophy className="w-3.5 h-3.5 text-amber-400" />
                          <span>
                            {liveRamTelemetry.score > 0
                              ? `${liveRamTelemetry.score.toLocaleString('fr-FR')} pts`
                              : 'Score RAM'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            closePauseMenuAndResume();
                            if (iframeRef.current?.contentWindow) {
                              iframeRef.current.contentWindow.postMessage({ type: 'FORCE_SYNC_CREDITS' }, window.location.origin);
                            }
                          }}
                          className="px-3 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Coins className="w-3.5 h-3.5" />
                          <span>Sync Crédits (5)</span>
                        </button>
                      </>
                    )}
                  </>
                )}
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="px-3 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs font-bold text-cyan-200 flex items-center justify-center gap-1.5 transition-colors"
                >
                  {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                  <span>{isFullscreen ? 'Fenêtré' : 'Plein écran'}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
                {/* Colonne Gauche : Actions rapides (Reprendre, Paramètres, Recommencer, Quitter) */}
                <div className="lg:col-span-4 flex flex-col gap-2.5">
                  <button
                    type="button"
                    onClick={closePauseMenuAndResume}
                    className="w-full px-4 py-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-cyan-500/40 text-left flex items-center gap-3 transition-colors"
                  >
                    <Play className="w-4 h-4 text-cyan-400 shrink-0" />
                    <div>
                      <div className="text-xs font-black text-white">Continuer</div>
                      <div className="text-[10px] text-neutral-400">Relancer l’émulation immédiatement</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenSettings?.()}
                    className="w-full px-4 py-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-purple-500/40 text-left flex items-center gap-3 transition-colors"
                  >
                    <Settings className="w-4 h-4 text-purple-400 shrink-0" />
                    <div>
                      <div className="text-xs font-black text-white">Paramètres</div>
                      <div className="text-[10px] text-neutral-400">
                        Configurer manettes, clavier par console, vidéo &amp; audio
                      </div>
                    </div>
                  </button>

                  {!session.isNetplay && !isSpectator && (
                    <button
                      type="button"
                      onClick={() => {
                        setPauseMenuOpen(false);
                        handleRestartGame();
                      }}
                      className="w-full px-4 py-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-left flex items-center gap-3 transition-colors"
                    >
                      <RotateCcw className="w-4 h-4 text-amber-400 shrink-0" />
                      <div>
                        <div className="text-xs font-black text-white">Recommencer</div>
                        <div className="text-[10px] text-neutral-400">Redémarrer le jeu (-1 crédit)</div>
                      </div>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setPauseMenuOpen(false);
                      handleCloseStage();
                    }}
                    className="w-full px-4 py-3 rounded-xl bg-rose-950/35 hover:bg-rose-950/60 border border-rose-500/35 text-left flex items-center gap-3 transition-colors"
                  >
                    <X className="w-4 h-4 text-rose-400 shrink-0" />
                    <div>
                      <div className="text-xs font-black text-rose-200">Quitter le jeu</div>
                      <div className="text-[10px] text-rose-300/70">Retourner au catalogue</div>
                    </div>
                  </button>
                </div>

                {/* Colonne Droite : 5 États de Sauvegarde (PPSSPP Save States avec aperçu écran) */}
                <div className="lg:col-span-8 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-mono uppercase tracking-wider text-cyan-300 font-bold">
                      États de Sauvegarde (5 Emplacements)
                    </h3>
                    <span className="text-[10px] font-mono text-neutral-400">
                      {session.kind === 'j2me' ? 'Indisponible sur J2ME' : 'Sauvés localement + aperçu'}
                    </span>
                  </div>

                  {session.kind === 'j2me' ? (
                    <div className="p-6 rounded-xl bg-neutral-900 border border-neutral-800 text-center text-xs text-neutral-400">
                      Les sauvegardes d’état visuelles sont disponibles sur Arcade, Nintendo, PlayStation et Sega. Utilisez la sauvegarde interne des jeux Java.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                      {[1, 2, 3, 4, 5].map((slotNum) => {
                        const existing = savedSlots.find((s) => s.slot === slotNum);
                        const gid = normalizeScoreGameId(session.gameId || session.title);
                        return (
                          <div
                            key={slotNum}
                            className={`rounded-xl border overflow-hidden flex flex-col transition-colors ${
                              existing
                                ? 'bg-neutral-900 border-cyan-500/40'
                                : 'bg-neutral-900/60 border-neutral-800'
                            }`}
                          >
                            {/* Aperçu visuel de la sauvegarde */}
                            <div className="relative h-24 sm:h-28 bg-black flex items-center justify-center overflow-hidden border-b border-neutral-800">
                              {existing?.screenshotDataUrl ? (
                                <img
                                  src={existing.screenshotDataUrl}
                                  alt={`État ${slotNum}`}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="text-[11px] font-mono text-neutral-400">
                                  {existing ? 'Sauvegarde prête' : 'Emplacement vide'}
                                </span>
                              )}
                              <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/75 border border-neutral-700 text-[10px] font-mono font-black text-white">
                                État {slotNum}
                              </span>
                              {existing && (
                                <button
                                  type="button"
                                  title={`Supprimer État ${slotNum}`}
                                  onClick={async () => {
                                    const uid = userProfileRef.current?.uid;
                                    await deleteGameSlot(uid, gid, slotNum);
                                    const next = await listGameSlots(uid, gid);
                                    setSavedSlots(next);
                                  }}
                                  className="absolute top-1.5 right-1.5 p-1 rounded bg-black/75 hover:bg-rose-900 text-neutral-400 hover:text-rose-200 transition-colors"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>

                            {/* Infos & Boutons Sauver / Charger */}
                            <div className="p-2.5 flex flex-col gap-2">
                              <div className="text-[10px] font-mono text-neutral-400 truncate">
                                {existing
                                  ? new Date(existing.savedAtMs).toLocaleString('fr-FR', {
                                      day: '2-digit',
                                      month: '2-digit',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : 'Aucune donnée enregistrée'}
                              </div>
                              <div className="grid grid-cols-2 gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    iframeRef.current?.contentWindow?.postMessage(
                                      { type: 'EXPORT_STATE', slot: `slot_${slotNum}` },
                                      window.location.origin
                                    );
                                  }}
                                  className="py-1.5 px-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 text-[11px] font-bold flex items-center justify-center gap-1"
                                >
                                  <Save className="w-3 h-3" />
                                  <span>Sauver</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={!existing}
                                  onClick={async () => {
                                    const b64 = await loadGameSlot(userProfileRef.current?.uid, gid, slotNum);
                                    if (b64) {
                                      iframeRef.current?.contentWindow?.postMessage(
                                        { type: 'LOAD_STATE', stateBase64: b64 },
                                        window.location.origin
                                      );
                                      closePauseMenuAndResume();
                                      showRamToast('record', `📂 État ${slotNum} chargé !`);
                                    }
                                  }}
                                  className="py-1.5 px-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-35 border border-emerald-500/40 text-emerald-200 text-[11px] font-bold flex items-center justify-center gap-1"
                                >
                                  <UploadCloud className="w-3 h-3" />
                                  <span>Charger</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

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

            {/* Réseau & Input Delay (Hors Java J2ME et jeux Solo uniquement) */}
            {session.kind !== 'j2me' && (session.isNetplay || supportsOnlineMultiplayer(session)) && (
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

            {/* Sauvegardes Persistantes (3 Slots par jeu dans IndexedDB) */}
            {session.kind !== 'j2me' && (
              <div className="p-3 rounded-xl bg-neutral-900 border border-cyan-500/30 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-cyan-300">
                  <span>Sauvegardes de la partie</span>
                  <span className="text-[10px] font-mono text-neutral-400">Persistées par jeu</span>
                </div>
                <div className="space-y-1.5">
                  {[1, 2, 3].map((slotNum) => {
                    const existing = savedSlots.find((s) => s.slot === slotNum);
                    return (
                      <div
                        key={slotNum}
                        className="flex items-center justify-between gap-2 p-2 rounded-lg bg-neutral-950 border border-neutral-800"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white">Slot {slotNum}</div>
                          <div className="text-[10px] font-mono text-neutral-400 truncate">
                            {existing
                              ? `Sauvé à ${new Date(existing.savedAtMs).toLocaleTimeString('fr-FR', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}`
                              : 'Vide'}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              iframeRef.current?.focus();
                              iframeRef.current?.contentWindow?.postMessage(
                                { type: 'EXPORT_STATE', slot: `slot_${slotNum}` },
                                window.location.origin
                              );
                            }}
                            className="px-2 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-[11px] font-bold text-cyan-200"
                          >
                            Sauver
                          </button>
                          <button
                            type="button"
                            disabled={!existing && !savedState}
                            onClick={async () => {
                              const gid = normalizeScoreGameId(session.gameId || session.title);
                              const b64 = existing
                                ? await loadGameSlot(userProfileRef.current?.uid, gid, slotNum)
                                : savedState;
                              if (b64) {
                                iframeRef.current?.focus();
                                iframeRef.current?.contentWindow?.postMessage(
                                  { type: 'LOAD_STATE', stateBase64: b64 },
                                  window.location.origin
                                );
                                setQuickMenuOpen(false);
                                showRamToast('record', `📂 Sauvegarde Slot ${slotNum} chargée !`);
                              }
                            }}
                            className="px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-35 border border-emerald-500/40 text-[11px] font-bold text-emerald-200"
                          >
                            Charger
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
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
                {!session.isNetplay && !isSpectator && (
                  <button
                    type="button"
                    onClick={handleRestartGame}
                    className="px-2.5 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-bold text-neutral-200 flex items-center justify-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Recommencer (-1 Coin)
                  </button>
                )}
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
              onClick={handleCloseStage}
              className="mt-auto w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors"
            >
              {session.kind === 'j2me' || !supportsOnlineMultiplayer(session) ? 'Quitter le jeu' : 'Quitter vers le salon'}
            </button>
          </aside>
        )}
      </div>

      {/* Overlay FPS & Frame Time si activé dans les Paramètres Performance */}
      {settings?.performance?.showOverlay && <PerfOverlay visible />}

      {/* HUD Vocal Non-Intrusif en Jeu & Plein Écran (pastilles de parole uniquement + toast invitation) */}
      <VoicePartyPill
        inGame
        voiceState={voiceState}
        micMode={settings?.voice?.micMode || 'open'}
        onToggleMute={onToggleVoiceMute}
        onPttChange={onVoicePttChange}
        onAcceptInvite={onAcceptVoiceInvite}
        onDismissInvite={onDismissVoiceInvite}
      />

      {/* Contrôleurs Tactiles Mobile Sur-Mesure par Plateforme (Arcade / PS1 / Nintendo / Sega / Java J2ME) */}
      {!isSpectator && touchPadVisible && (
        <MobilePlatformController
          kind={session.kind}
          core={session.core}
          settings={settings}
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
