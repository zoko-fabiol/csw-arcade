import React, { useState, useEffect, useRef } from 'react';
import { useSettings } from './hooks/useSettings';
import { SettingsModal } from './components/settings/SettingsModal';
import { useOnlineStatus } from './hooks/useMobileNavigation';
import {
  downloadAndCacheRom,
  formatBytes,
  getPlatformCacheStats,
  markRomAsDead,
} from './services/platformRomService';
import { PlatformCatalogView } from './components/shell/PlatformCatalogView';
import { UnifiedStageModal } from './components/shell/UnifiedStageModal';
import { FightcadeChannelsDock } from './components/shell/FightcadeChannelsDock';
import { FightcadeLobbyView } from './components/shell/FightcadeLobbyView';
import { AuthModal } from './components/auth/AuthModal';
import { SasPayModal } from './components/wallet/SasPayModal';
import { getPendingSasPayPayment, savePendingSasPayPayment, verifySasPayPayment } from './services/saspayService';
import { addCoins, consumeCoin, fillMaxCoins, hasCoins, setWalletCoins, subscribeWallet } from './services/walletService';
import {
  firebaseFightcadeService,
  GLOBAL_CHANNEL,
  GLOBAL_CHANNEL_ID,
  normalizeGameChannelId,
  playChallengeSound,
} from './services/firebaseFightcadeService';
import { getCurrentUserProfile, subscribeAuthProfile } from './services/authService';
import {
  fetchCloudSavestate,
  getDeviceInfo,
  pushActiveSession,
  pushChannelsSync,
  pushCloudSavestate,
  pushCoinsSync,
  subscribeAccountSync,
} from './services/accountSyncService';
import { applyRemoteSyncedStats, getRankTierMeta } from './services/scoreRankingService';
import { countryCodeToFlag } from './data/countries';
import { RollbackP2PEngine } from './services/rollbackP2P';
import {
  Gamepad2, Disc, Cpu, Coffee, Settings, Joystick, Coins, Layers, Swords, UserCheck, Cloud, Play, X
} from 'lucide-react';

const SHELL_MODES = [
  { id: 'all', label: 'Tous les jeux', subtitle: 'Game Mode Unifié · Tous Univers', icon: Layers },
  { id: 'arcade', label: 'Arcade / Neo Geo', subtitle: 'Neo Geo MVS · MAME 2003-Plus · Rollback P2P', icon: Joystick },
  { id: 'playstation', label: 'PlayStation', subtitle: 'PS1 (Web HLE) · Téléchargement Auto CHD', icon: Disc },
  { id: 'nintendo', label: 'Nintendo', subtitle: 'NES · SNES · GB · GBC · GBA · Nintendo 64', icon: Gamepad2 },
  { id: 'sega', label: 'Sega', subtitle: 'Mega Drive / Genesis · Master System · Game Gear', icon: Cpu },
  { id: 'java', label: 'Mobile / J2ME', subtitle: 'J2ME (.jar) · Gameloft Classics (Solo)', icon: Coffee },
];

export default function App() {
  const {
    settings,
    updateKeyBinding,
    updateConsoleKeyBinding,
    updateConsoleGamepadBinding,
    resetConsoleControls,
    updateVideoSetting,
    updateAudioSetting,
    updateSystemSetting,
    updateGamepadSetting,
    updateTouchSetting,
    updatePerformanceSetting,
    updateNetplaySetting,
    resetToDefaults,
  } = useSettings();

  const isOnline = useOnlineStatus();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [userProfile, setUserProfile] = useState(() => getCurrentUserProfile());

  const [platformMode, setPlatformMode] = useState(() => {
    if (typeof window === 'undefined') return 'arcade';
    const m = new URLSearchParams(window.location.search).get('mode');
    return SHELL_MODES.some((sm) => sm.id === m) ? m : 'arcade';
  });

  const [stageSession, setStageSession] = useState(null);
  const [cacheStats, setCacheStats] = useState({ count: 0, totalBytes: 0 });
  const [coins, setCoins] = useState(0);
  const [buyMenuOpen, setBuyMenuOpen] = useState(false);
  const [isSasPayOpen, setIsSasPayOpen] = useState(false);
  const [noCoinsModalOpen, setNoCoinsModalOpen] = useState(false);

  // Fightcade 2 : Lobby Global + 3 salons actifs max, défis 15s & WebRTC Rollback P2P
  const [activeChannels, setActiveChannels] = useState([]);
  const [selectedChannelId, setSelectedChannelId] = useState(null);
  const [limitModalGame, setLimitModalGame] = useState(null);
  const [incomingChallenge, setIncomingChallenge] = useState(null);
  const [p2pStats, setP2pStats] = useState(null);
  const [bootNotice, setBootNotice] = useState('');
  const [remoteActiveSession, setRemoteActiveSession] = useState(null);
  const [dismissedSessionTs, setDismissedSessionTs] = useState(0);
  const [resumingHandoff, setResumingHandoff] = useState(false);

  const p2pEngineRef = useRef(null);
  const localDeviceRef = useRef(getDeviceInfo());
  const activeGameEntryRef = useRef(null);
  const sessionStartedAtRef = useRef(0);
  const lastRemoteCoinsTsRef = useRef(0);
  const lastRemoteChannelsTsRef = useRef(0);
  const stageSessionRef = useRef(null);
  stageSessionRef.current = stageSession;
  const userProfileRef = useRef(userProfile);
  userProfileRef.current = userProfile;

  const handleLaunchStage = (sessionObj, gameEntry = null) => {
    setStageSession(sessionObj);
    activeGameEntryRef.current = gameEntry;
    sessionStartedAtRef.current = Date.now();
    const isJ2me =
      sessionObj?.kind === 'j2me' ||
      sessionObj?.core === 'j2me' ||
      gameEntry?.core === 'j2me' ||
      gameEntry?.platform === 'j2me';

    if (sessionObj) {
      const uid = userProfileRef.current?.uid;
      if (uid) {
        pushActiveSession(uid, {
          gameId: normalizeGameChannelId(gameEntry || { id: sessionObj.gameId, title: sessionObj.title }),
          title: sessionObj.title,
          core: sessionObj.core,
          kind: sessionObj.kind,
          platformLabel: gameEntry?.platformLabel || sessionObj.core?.toUpperCase() || 'Arcade',
          filename: sessionObj.filename,
          gameEntry,
          inSalon: !isJ2me,
          status: 'playing',
          hasSavestate: Boolean(sessionObj.initialStateBase64),
        });
      }
      if (!isJ2me) {
        firebaseFightcadeService.setActivePlayingGame(
          gameEntry || {
            id: sessionObj.gameId || sessionObj.title,
            title: sessionObj.title,
            platformLabel: sessionObj.core?.toUpperCase() || 'Arcade',
            core: sessionObj.core,
            filename: sessionObj.filename,
          },
          {
            isNetplay: Boolean(sessionObj.isNetplay),
            opponentName: sessionObj.opponentName || null,
          }
        );
      }
    }
  };

  const launchEntryWithRom = async (
    gameEntry,
    {
      isNetplay = false,
      isHost = true,
      playerIndex = 0,
      badgeSuffix = 'LOCAL',
      refundCoinOnFail = true,
      opponentName = null,
      initialStateBase64 = null,
    } = {}
  ) => {
    if (!gameEntry) return;
    const core = gameEntry.core || gameEntry.platform || 'fbneo';
    const isArcadeZip = core === 'fbneo' || core === 'mame2003_plus';
    const extractExts = isArcadeZip
      ? []
      : ['.nes', '.sfc', '.smc', '.gba', '.gb', '.gbc', '.n64', '.z64', '.v64', '.md', '.gen', '.bin', '.sms', '.gg', '.pce', '.nds', '.chd', '.pbp', '.iso', '.jar'];

    setBootNotice(`Téléchargement & vérification de « ${gameEntry.title} »…`);
    try {
      const fileBlob = await downloadAndCacheRom(gameEntry, {
        mode: core,
        core,
        extractExtensions: extractExts,
        onProgress: ({ received, total }) => {
          if (total > 0) {
            const pct = Math.min(100, Math.round((received / total) * 100));
            setBootNotice(`Chargement « ${gameEntry.title} » : ${pct}% (${formatBytes(received)})`);
          }
        },
      });
      refreshPlatformCache();
      setBootNotice('');
      handleLaunchStage(
        {
          kind: core === 'j2me' ? 'j2me' : 'emu',
          gameId: normalizeGameChannelId(gameEntry),
          title: gameEntry.title || 'CSW Game',
          filename: fileBlob.name || gameEntry.filename || '',
          badge: `${core.toUpperCase()} · ${badgeSuffix}`,
          core,
          fileBlob,
          gameUrl: gameEntry.urls?.[0] || '',
          isNetplay,
          isHost,
          playerIndex,
          opponentName,
          initialStateBase64,
          accent: '#00f0ff',
        },
        gameEntry
      );
    } catch {
      if (refundCoinOnFail) addCoins(isNetplay && isHost ? 2 : 1);
      setBootNotice(`Téléchargement indisponible pour « ${gameEntry.title} » (Coin remboursé). Réessayez dans un instant.`);
      setTimeout(() => setBootNotice(''), 4200);
    }
  };

  // Poursuivre une partie active synchronisée depuis un autre appareil (sans re-payer de Coin)
  const handleResumeRemoteSession = async (remoteSess) => {
    if (!remoteSess || resumingHandoff) return;
    const uid = userProfileRef.current?.uid;
    setResumingHandoff(true);
    setBootNotice(`Synchronisation de « ${remoteSess.title} » depuis ${remoteSess.deviceName}…`);
    try {
      const stateBase64 =
        remoteSess.kind !== 'j2me' && uid
          ? await fetchCloudSavestate(uid, remoteSess.gameId)
          : null;

      const targetEntry =
        remoteSess.gameEntry ||
        activeChannels.find((c) => c.gameId === remoteSess.gameId)?.entry || {
          id: remoteSess.gameId,
          title: remoteSess.title,
          core: remoteSess.core,
          platform: remoteSess.core,
          platformLabel: remoteSess.platformLabel,
          filename: remoteSess.filename,
          urls: [],
        };

      setRemoteActiveSession(null);
      await launchEntryWithRom(targetEntry, {
        isNetplay: false,
        isHost: true,
        playerIndex: 0,
        badgeSuffix: stateBase64 ? 'REPRISE CLOUD ☁️' : 'SYNC COMPTE',
        refundCoinOnFail: false,
        initialStateBase64: stateBase64,
      });
    } finally {
      setResumingHandoff(false);
    }
  };

  // Consomme des Coins (1 en Solo, 2 pour l'hôte en match Multijoueur qui offre la partie à son invité)
  const requireAndConsumeCoin = (amount = 1) => {
    if (!hasCoins(amount)) {
      setNoCoinsModalOpen(true);
      return false;
    }
    const res = consumeCoin(amount);
    if (!res.ok) {
      setNoCoinsModalOpen(true);
      return false;
    }
    return true;
  };

  const handleJoinFightcadeChannel = async (gameEntry) => {
    const res = await firebaseFightcadeService.joinChannel(gameEntry);
    if (!res.ok && res.reason === 'MAX_3_CHANNELS') {
      setLimitModalGame(gameEntry);
      return;
    }
    if (res.channel) {
      setSelectedChannelId(res.channel.gameId);
    }
  };

  const handleReplaceFightcadeChannel = async (oldGameId, newGameEntry) => {
    await firebaseFightcadeService.leaveChannel(oldGameId);
    setLimitModalGame(null);
    await handleJoinFightcadeChannel(newGameEntry);
  };

  const handleLeaveFightcadeChannel = async (gameId) => {
    await firebaseFightcadeService.leaveChannel(gameId);
    if (selectedChannelId === gameId) setSelectedChannelId(null);
  };

  const startRollbackP2PMatch = async ({ challengeId, isHost, gameEntry }) => {
    p2pEngineRef.current?.destroy();
    const engine = new RollbackP2PEngine({
      isHost,
      inputDelay: settings?.netplay?.inputDelay ?? 1,
      onSignalIce: (cand) => {
        firebaseFightcadeService.postIceCandidate(challengeId, isHost ? 'caller' : 'callee', cand);
      },
      onStats: (st) => setP2pStats(st),
    });
    p2pEngineRef.current = engine;

    if (isHost) {
      const offer = await engine.initConnection();
      await firebaseFightcadeService.postOffer(challengeId, offer);
      firebaseFightcadeService.subscribeIceCandidates(challengeId, 'callee', (c) => engine.addRemoteCandidate(c));
      firebaseFightcadeService.subscribeChallenge(challengeId, (ch) => {
        if (ch.answer && !engine.hasRemoteDesc) {
          engine.acceptAnswer(ch.answer);
        }
      });
    } else {
      await engine.initConnection();
      firebaseFightcadeService.subscribeIceCandidates(challengeId, 'caller', (c) => engine.addRemoteCandidate(c));
      firebaseFightcadeService.subscribeChallenge(challengeId, async (ch) => {
        if (ch.offer && !engine.hasRemoteDesc) {
          const answer = await engine.acceptOfferAndCreateAnswer(ch.offer);
          await firebaseFightcadeService.postAnswer(challengeId, answer);
        }
      });
    }

    if (gameEntry) {
      if (selectedChannelId) {
        firebaseFightcadeService.upsertPresence(selectedChannelId, 'playing', { challengeId });
      }
      await launchEntryWithRom(gameEntry, {
        isNetplay: true,
        isHost,
        playerIndex: isHost ? 0 : 1,
        badgeSuffix: isHost ? 'P1 HOST · ROLLBACK P2P' : 'P2 GUEST · ROLLBACK P2P',
      });
    }
  };

  const handleChallengePlayer = async (channel, targetUser) => {
    // Règle CSW-Arcade : L'hôte paie pour les deux joueurs (2 Coins requis chez l'hôte, 0 pour l'invité)
    if (!hasCoins(2)) {
      setNoCoinsModalOpen(true);
      return;
    }
    const challengeId = await firebaseFightcadeService.sendChallenge(channel.gameId, targetUser, channel.entry);
    const unsub = firebaseFightcadeService.subscribeChallenge(challengeId, (ch) => {
      if (ch.status === 'accepted') {
        unsub();
        // Débiter exactement 2 Coins chez l'hôte pour financer les deux slots du match multijoueur
        if (!requireAndConsumeCoin(2)) return;
        startRollbackP2PMatch({ challengeId, isHost: true, gameEntry: channel.entry });
      }
    });
  };

  const handleRespondChallenge = async (accept) => {
    if (!incomingChallenge) return;
    const ch = incomingChallenge;
    // L'invité NE PAIE RIEN : 0 Coin débité chez l'invité (l'hôte a payé pour les deux)
    setIncomingChallenge(null);
    await firebaseFightcadeService.respondChallenge(ch.challengeId, accept);
    if (accept) {
      const channel = activeChannels.find((c) => c.gameId === ch.gameId);
      await startRollbackP2PMatch({
        challengeId: ch.challengeId,
        isHost: false,
        gameEntry: ch.gameEntry || channel?.entry || { id: ch.gameId, title: ch.gameTitle },
      });
    }
  };

  const refreshPlatformCache = () => {
    getPlatformCacheStats().then(setCacheStats).catch(() => {});
  };

  useEffect(() => {
    const unsubAuth = subscribeAuthProfile(setUserProfile);
    const unsubW = subscribeWallet(setCoins);
    const unsubC = firebaseFightcadeService.subscribeActiveChannels(setActiveChannels);
    const unsubCh = firebaseFightcadeService.subscribeIncomingChallenges((list) => {
      if (list.length > 0) {
        setIncomingChallenge(list[0]);
        if (settings?.netplay?.challengeSound ?? true) playChallengeSound();
      }
    });
    refreshPlatformCache();

    const onKey = (e) => {
      if (e.altKey && ['1', '2', '3', '4', '5', '6'].includes(e.key)) {
        e.preventDefault();
        const m = SHELL_MODES[Number(e.key) - 1];
        if (m) {
          setSelectedChannelId(null);
          setPlatformMode(m.id);
        }
      }
      if (e.key === 'Escape' && isSettingsOpen) {
        setIsSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      unsubAuth();
      unsubW();
      unsubC();
      unsubCh();
      window.removeEventListener('keydown', onKey);
    };
  }, [isSettingsOpen, settings?.netplay?.challengeSound]);

  // Vérifier automatiquement un paiement SasPay en attente au retour sur l'application
  useEffect(() => {
    const pending = getPendingSasPayPayment();
    if (!pending?.paymentId) return;
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    if (params?.get('saspay_status') === 'cancel') {
      savePendingSasPayPayment(null);
      return;
    }
    verifySasPayPayment(pending.paymentId, userProfileRef.current?.uid)
      .then((res) => {
        if (res?.paid) {
          const added = res.coinsAdded || pending.coins || 10;
          addCoins(added);
          savePendingSasPayPayment(null);
          setBootNotice(`✅ Paiement SasPay confirmé : +${added} Coins ajoutés à votre compte !`);
          setTimeout(() => setBootNotice(''), 5500);
        }
      })
      .catch(() => {});
  }, []);

  // Synchronisation Parfaite du Compte Multi-Appareils (Crédits, Salons actifs, Partie en cours / Reprise Cloud)
  useEffect(() => {
    const uid = userProfile?.uid;
    if (!uid) return;
    const myDevId = localDeviceRef.current.deviceId;

    const unsubSync = subscribeAccountSync(uid, (sync) => {
      // 1. Synchroniser les Crédits si un autre appareil a mis à jour le portefeuille
      if (typeof sync.coins === 'number' && sync.coinsUpdatedAtMs > lastRemoteCoinsTsRef.current) {
        lastRemoteCoinsTsRef.current = sync.coinsUpdatedAtMs;
        setWalletCoins(sync.coins);
      }

      // 2. Synchroniser les 3 Salons Fightcade 2 actifs entre tous les appareils du compte
      if (Array.isArray(sync.activeChannels) && sync.channelsUpdatedAtMs > lastRemoteChannelsTsRef.current) {
        lastRemoteChannelsTsRef.current = sync.channelsUpdatedAtMs;
        firebaseFightcadeService.applySyncedChannels(sync.activeChannels);
      }

      // 2b. Synchroniser les statistiques & meilleurs scores des jeux entre tous les appareils du compte
      if (Array.isArray(sync.gameStats) && sync.gameStats.length > 0) {
        applyRemoteSyncedStats(uid, sync.gameStats);
      }

      // 3. Détecter si une partie est en cours sur un AUTRE appareil connecté au même compte
      const sess = sync.activeSession;
      if (sess && sess.deviceId && sess.deviceId !== myDevId && sess.status === 'playing') {
        if (stageSessionRef.current && (sess.updatedAtMs || 0) > sessionStartedAtRef.current + 1500) {
          // Un autre appareil vient de reprendre la partie !
          setBootNotice(`☁️ Votre partie « ${sess.title} » a été poursuivie sur ${sess.deviceName}.`);
          setTimeout(() => setBootNotice(''), 5000);
        } else if (!stageSessionRef.current) {
          setRemoteActiveSession({
            ...sess,
            hasSavestate: Boolean(sync.hasSavestate || sess.hasSavestate),
          });
        }
      } else {
        setRemoteActiveSession(null);
      }
    });

    return () => unsubSync?.();
  }, [userProfile?.uid]);

  // Pousser les changements locaux de crédits & salons vers les autres appareils du compte
  useEffect(() => {
    const uid = userProfile?.uid;
    if (!uid) return;
    pushCoinsSync(uid, coins);
  }, [userProfile?.uid, coins]);

  useEffect(() => {
    const uid = userProfile?.uid;
    if (!uid) return;
    pushChannelsSync(uid, activeChannels, selectedChannelId);
  }, [userProfile?.uid, activeChannels, selectedChannelId]);

  // Heartbeat régulier pour maintenir la session active tant qu'on joue (expire après 3 minutes en cas d'inactivité)
  useEffect(() => {
    if (!stageSession) return;
    const interval = setInterval(() => {
      const uid = userProfileRef.current?.uid;
      const curSess = stageSessionRef.current;
      if (uid && curSess) {
        const gid = normalizeGameChannelId(activeGameEntryRef.current || { id: curSess.gameId, title: curSess.title });
        pushActiveSession(uid, {
          gameId: gid,
          title: curSess.title,
          core: curSess.core,
          kind: curSess.kind,
          platformLabel: activeGameEntryRef.current?.platformLabel || curSess.core?.toUpperCase() || 'Arcade',
          filename: curSess.filename,
          gameEntry: activeGameEntryRef.current,
          inSalon: curSess.kind !== 'j2me',
          status: 'playing',
          hasSavestate: curSess.kind !== 'j2me',
        });
      }
    }, 45000);
    return () => clearInterval(interval);
  }, [stageSession]);

  // Nettoyage immédiat de la session lors de la fermeture de la fenêtre / onglet du navigateur
  useEffect(() => {
    const handleBeforeUnload = () => {
      const uid = userProfileRef.current?.uid;
      if (uid && stageSessionRef.current) {
        pushActiveSession(uid, null);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
    };
  }, []);

  const currentModeMeta = SHELL_MODES.find((m) => m.id === platformMode) || SHELL_MODES[0];
  const resolvedSelectedChannel =
    selectedChannelId === GLOBAL_CHANNEL_ID
      ? GLOBAL_CHANNEL
      : activeChannels.find((c) => c.gameId === selectedChannelId) || null;

  return (
    <div className="flex flex-col h-[100dvh] w-screen overflow-hidden bg-neutral-950 font-sans text-neutral-100 pt-safe">
      {/* Topbar Unifiée Game Mode — 1 ligne ultra-compacte sur mobile, complète sur desktop */}
      <header className="flex flex-col md:flex-row md:flex-wrap md:items-center md:justify-between gap-1.5 md:gap-2 px-2.5 md:px-3 py-1.5 md:py-2 bg-neutral-950/95 border-b border-neutral-800 shrink-0 z-30">
        {/* Ligne 1 : Logo + Actions essentielles */}
        <div className="flex items-center justify-between gap-2 w-full md:w-auto">
          <div className="flex items-center gap-2 min-w-0">
            <img src="./icons/icon-192.png" alt="CSW Arcade" className="w-7 h-7 md:w-8 md:h-8 rounded-lg shrink-0" />
            <div className="min-w-0">
              <div className="font-black tracking-wider text-sm text-white leading-tight">
                CSW<span className="text-cyan-400">.</span>ARCADE
              </div>
              <div className="text-[10px] font-mono text-neutral-400 hidden lg:block truncate">
                {currentModeMeta.subtitle}
              </div>
            </div>
          </div>

          {/* Actions rapides mobile (visibles sur mobile dans la ligne 1) */}
          <div className="flex md:hidden items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsSasPayOpen(true)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-mono font-bold ${
                coins <= 0
                  ? 'bg-rose-950/60 border-rose-500/60 text-rose-300 animate-pulse'
                  : 'bg-amber-950/40 border-amber-500/40 text-amber-300'
              }`}
              title="Portefeuille Coins"
            >
              <Coins className="w-3.5 h-3.5" />
              <span>{String(coins).padStart(2, '0')}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsAuthOpen(true)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg border bg-cyan-950/40 border-cyan-500/40 text-cyan-200 text-xs font-bold"
              title="Profil & Rang"
            >
              <span
                className={`px-1 rounded border text-[10px] font-mono font-black ${
                  getRankTierMeta(userProfile?.rank || 'D').color
                }`}
              >
                {userProfile?.rank || 'D'}
              </span>
              <span className="truncate max-w-[72px]">{userProfile?.displayName || 'Joueur'}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              title="Paramètres"
              className="p-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-200"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Barre d'Univers — Masquée sur mobile quand on est dans un Salon pour maximiser le Chat */}
        <nav
          className={`${
            selectedChannelId !== null ? 'hidden md:flex' : 'flex'
          } items-center gap-1 overflow-x-auto no-scrollbar snap-x py-0.5 md:py-0`}
          role="tablist"
          aria-label="Univers de jeux"
        >
          {SHELL_MODES.map((m, idx) => {
            const Icon = m.icon;
            const active = selectedChannelId === null && platformMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={active}
                title={`${m.label} (Alt+${idx + 1})`}
                onClick={() => {
                  setSelectedChannelId(null);
                  setPlatformMode(m.id);
                }}
                className={`snap-start flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors shrink-0 ${
                  active
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/50'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-900 border border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5 md:w-4 md:h-4" />
                <span>{m.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Actions Desktop (md+) */}
        <div className="hidden md:flex items-center gap-2 relative">
          {/* Bouton Profil / Login / Stats & Rang Firebase */}
          <button
            type="button"
            onClick={() => setIsAuthOpen(true)}
            title={`Connexion / Stats & Rang (${userProfile?.ratingPoints || 0} RP)`}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-colors ${
              userProfile?.isAuthenticated
                ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200 hover:bg-emerald-950/80'
                : 'bg-cyan-950/40 border-cyan-500/40 text-cyan-200 hover:bg-cyan-950/70'
            }`}
          >
            <span
              className={`px-1.5 py-0.2 rounded border text-[10px] font-mono font-black ${
                getRankTierMeta(userProfile?.rank || 'D').color
              }`}
            >
              {userProfile?.rank || 'D'}
            </span>
            <span className="truncate max-w-[110px]">{userProfile?.displayName || 'Joueur'}</span>
            <span className="text-[10px] font-mono px-1 rounded bg-neutral-800 text-neutral-300">
              {countryCodeToFlag(userProfile?.region)} {userProfile?.region || 'FR'}
            </span>
            <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
          </button>

          {/* Portefeuille Coins (0-99) + Bouton Test */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsSasPayOpen(true)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono font-bold transition-colors ${
                coins <= 0
                  ? 'bg-rose-950/60 border-rose-500/60 text-rose-300 animate-pulse'
                  : 'bg-amber-950/40 border-amber-500/40 text-amber-300 hover:bg-amber-950/70'
              }`}
              title="Portefeuille Coins · Acheter via SasPay"
            >
              <Coins className="w-3.5 h-3.5" />
              <span>{String(coins).padStart(2, '0')}/99 COINS</span>
              <span className="hidden lg:inline text-[10px] px-1.5 py-0.5 rounded bg-amber-500 text-black font-black">
                + Acheter (SasPay)
              </span>
            </button>
          </div>

          <span className="hidden xl:inline px-2.5 py-1 rounded-full bg-neutral-900 border border-neutral-800 text-[11px] font-mono text-neutral-300">
            Cache : {cacheStats.count} · {formatBytes(cacheStats.totalBytes)}
          </span>
          <span
            className={`hidden lg:inline px-2 py-1 rounded-full border text-[11px] font-mono ${
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
            title="Paramètres unifiés"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs font-semibold text-neutral-200 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Popover Portefeuille Test partagé Mobile & Desktop */}
        {buyMenuOpen && (
          <div className="fixed top-14 right-3 w-64 rounded-xl bg-neutral-900 border border-amber-500/40 p-3 shadow-2xl z-50 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-amber-300">Portefeuille Coins (Test)</span>
              <span className="font-mono text-white">{coins} / 99</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[1, 5, 10].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => addCoins(amt)}
                  className="py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-black"
                >
                  +{amt}
                </button>
              ))}
              <button
                type="button"
                onClick={() => fillMaxCoins()}
                className="py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black"
              >
                Max
              </button>
            </div>
            <button
              type="button"
              onClick={() => setBuyMenuOpen(false)}
              className="w-full py-1.5 rounded-lg bg-neutral-800 text-neutral-300 text-[11px] font-bold"
            >
              Fermer
            </button>
          </div>
        )}
      </header>

      {/* Corps Unifié : Dock Salons Fightcade 2 (Desktop gauche / Mobile Bottom Bar) + Vue Active */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        <FightcadeChannelsDock
          activeChannels={activeChannels}
          selectedChannelId={selectedChannelId}
          onSelectLibrary={() => setSelectedChannelId(null)}
          onSelectChannel={(id) => setSelectedChannelId(id)}
          onLeaveChannel={handleLeaveFightcadeChannel}
          onOpenProfile={() => setIsAuthOpen(true)}
          userRank={userProfile?.rank || 'D'}
          limitModalGame={limitModalGame}
          onCloseLimitModal={() => setLimitModalGame(null)}
          onReplaceChannel={handleReplaceFightcadeChannel}
        />

        {resolvedSelectedChannel ? (
          <FightcadeLobbyView
            channel={resolvedSelectedChannel}
            activeChannels={activeChannels}
            onChallengePlayer={handleChallengePlayer}
            onSelectChannel={(id) => setSelectedChannelId(id)}
            onOpenAuth={() => setIsAuthOpen(true)}
            onTestLocal={(entry) => {
              if (!requireAndConsumeCoin()) return;
              launchEntryWithRom(entry, {
                isNetplay: false,
                isHost: true,
                playerIndex: 0,
                badgeSuffix: 'TRAINING · AU SALON',
              });
            }}
            onSpectateMatch={(channel, targetUser) => {
              const targetEntry = channel.entry || targetUser?.currentGame;
              if (!targetEntry) return;
              launchEntryWithRom(targetEntry, {
                isNetplay: false,
                isHost: false,
                playerIndex: 2,
                badgeSuffix: `SPECTATEUR (${targetUser.name})`,
                refundCoinOnFail: false,
              });
            }}
            onLeaveChannel={handleLeaveFightcadeChannel}
          />
        ) : (
          <PlatformCatalogView
            mode={platformMode}
            onLaunchStage={handleLaunchStage}
            onCacheChanged={refreshPlatformCache}
            onJoinChannel={handleJoinFightcadeChannel}
            onRequireCoin={requireAndConsumeCoin}
          />
        )}
      </div>

      {/* Modale Login / Sign-Up / Profil Firebase Fightcade 2 */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        userProfile={userProfile}
        activeChannels={activeChannels}
      />

      {/* Boutique Paiement SasPay */}
      <SasPayModal
        isOpen={isSasPayOpen}
        onClose={() => setIsSasPayOpen(false)}
        onOpenAuth={() => setIsAuthOpen(true)}
        userProfile={userProfile}
        currentCoins={coins}
      />

      {/* Modale Crédits Insuffisants (0 Coin) */}
      {noCoinsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-neutral-900 border border-rose-500/50 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <Coins className="w-7 h-7 text-amber-400 shrink-0" />
              <div>
                <h3 className="text-sm font-black text-white">Crédits insuffisants</h3>
                <p className="text-xs text-neutral-300 mt-1">
                  1 Coin est requis en Solo, et 2 Coins sont requis pour lancer un défi Multijoueur (vous financez les deux slots pour jouer à deux).
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setNoCoinsModalOpen(false);
                  setIsSasPayOpen(true);
                }}
                className="py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-black"
              >
                Acheter des Coins (SasPay)
              </button>
              <button
                type="button"
                onClick={() => setNoCoinsModalOpen(false)}
                className="py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-bold"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale Défi Entrant Fightcade 2 (15s) — visible même par-dessus l'émulateur */}
      {incomingChallenge && (
        <div className="fixed bottom-20 md:bottom-6 inset-x-3 md:inset-x-auto md:right-6 z-[120] md:w-80 rounded-2xl bg-neutral-900 border-2 border-cyan-400 p-4 shadow-2xl space-y-3">
          <div className="flex items-center gap-2 text-cyan-300 font-black text-xs uppercase">
            <Swords className="w-4 h-4 animate-pulse" />
            <span>Défi Fightcade 2 reçu !</span>
          </div>
          <p className="text-xs text-neutral-200">
            <strong>{incomingChallenge.fromName}</strong> vous défie sur <strong>{incomingChallenge.gameTitle}</strong> (Match offert par l'hôte · 0 Coin requis).
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleRespondChallenge(true)}
              className="flex-1 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black"
            >
              Accepter (Offert)
            </button>
            <button
              type="button"
              onClick={() => handleRespondChallenge(false)}
              className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-rose-950 text-neutral-300 text-xs font-bold"
            >
              Refuser
            </button>
          </div>
        </div>
      )}

      {/* Bannière Synchronisation Compte Multi-Appareils : Poursuivre sa partie directement sur cet appareil */}
      {remoteActiveSession &&
        !stageSession &&
        remoteActiveSession.status === 'playing' &&
        (remoteActiveSession.updatedAtMs || 0) !== dismissedSessionTs && (
          <div className="fixed bottom-20 md:bottom-6 left-3 right-3 md:left-auto md:right-6 z-[115] md:w-[400px] rounded-2xl bg-neutral-900/95 backdrop-blur-xl border-2 border-emerald-400/70 p-4 shadow-2xl space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-emerald-300 font-black text-xs uppercase">
                <Cloud className="w-4 h-4 animate-pulse shrink-0" />
                <span>Partie active sur votre compte !</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDismissedSessionTs(remoteActiveSession.updatedAtMs || Date.now());
                  const uid = userProfileRef.current?.uid;
                  if (uid) {
                    pushActiveSession(uid, null);
                  }
                  setRemoteActiveSession(null);
                }}
                className="p-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white"
                title="Fermer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-neutral-100">
                Vous jouez actuellement à{' '}
                <strong className="text-white">« {remoteActiveSession.title} »</strong> sur{' '}
                <strong className="text-cyan-300">{remoteActiveSession.deviceName}</strong>.
              </p>
              <p className="text-[11px] font-mono text-emerald-300/90">
                {remoteActiveSession.hasSavestate
                  ? '☁️ Sauvegarde instantanée prête · Reprise sans dépenser de Coin'
                  : '🟢 Salon synchronisé · Reprise immédiate sans dépenser de Coin'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={resumingHandoff}
                onClick={() => handleResumeRemoteSession(remoteActiveSession)}
                className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black text-xs font-black flex items-center justify-center gap-1.5 transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{resumingHandoff ? 'Synchronisation…' : 'Poursuivre ma partie ici'}</span>
              </button>
              {remoteActiveSession.inSalon && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedChannelId(remoteActiveSession.gameId);
                    setDismissedSessionTs(remoteActiveSession.updatedAtMs || Date.now());
                  }}
                  className="px-3 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-cyan-300 text-xs font-bold shrink-0"
                >
                  Salon
                </button>
              )}
            </div>
          </div>
        )}

      {/* Paramètres Unifiés (Contrôles, Vidéo, Audio, BIOS, Fightcade 2 & Cache) */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        updateKeyBinding={updateKeyBinding}
        updateConsoleKeyBinding={updateConsoleKeyBinding}
        updateConsoleGamepadBinding={updateConsoleGamepadBinding}
        resetConsoleControls={resetConsoleControls}
        updateVideoSetting={updateVideoSetting}
        updateAudioSetting={updateAudioSetting}
        updateSystemSetting={updateSystemSetting}
        updateGamepadSetting={updateGamepadSetting}
        updateTouchSetting={updateTouchSetting}
        updatePerformanceSetting={updatePerformanceSetting}
        updateNetplaySetting={updateNetplaySetting}
        onCacheCleared={refreshPlatformCache}
        resetToDefaults={resetToDefaults}
      />

      {bootNotice && (
        <div className="fixed bottom-20 md:bottom-14 left-1/2 -translate-x-1/2 z-[125] px-4 py-2 rounded-xl bg-neutral-900/95 border border-cyan-500/50 text-cyan-200 text-xs font-mono shadow-2xl max-w-[92%] text-center">
          {bootNotice}
        </div>
      )}

      {/* Lecteur Unifié EmulatorJS / J2ME */}
      <UnifiedStageModal
        session={stageSession}
        settings={settings}
        p2pEngine={p2pEngineRef.current}
        p2pStats={settings?.netplay?.showHud === false ? null : p2pStats}
        activeChannels={activeChannels}
        onCloudCheckpoint={(stateBase64) => {
          const uid = userProfileRef.current?.uid;
          const curSess = stageSessionRef.current;
          if (!uid || !curSess) return;
          const gid = normalizeGameChannelId(activeGameEntryRef.current || { id: curSess.gameId, title: curSess.title });
          pushCloudSavestate(uid, gid, stateBase64).then((ok) => {
            if (ok) {
              pushActiveSession(uid, {
                gameId: gid,
                title: curSess.title,
                core: curSess.core,
                kind: curSess.kind,
                platformLabel: activeGameEntryRef.current?.platformLabel || curSess.core?.toUpperCase() || 'Arcade',
                filename: curSess.filename,
                gameEntry: activeGameEntryRef.current,
                inSalon: curSess.kind !== 'j2me',
                status: 'playing',
                hasSavestate: true,
              });
            }
          });
        }}
        onOpenSalon={() => {
          const targetId = stageSession?.gameId || activeChannels[0]?.gameId || GLOBAL_CHANNEL_ID;
          const uid = userProfileRef.current?.uid;
          if (uid) {
            pushActiveSession(uid, null);
          }
          setRemoteActiveSession(null);
          p2pEngineRef.current?.destroy();
          p2pEngineRef.current = null;
          setP2pStats(null);
          setStageSession(null);
          firebaseFightcadeService.clearActivePlayingGame();
          setSelectedChannelId(targetId);
        }}
        onInputDelayChange={(d) => p2pEngineRef.current?.setInputDelay(d)}
        onClose={() => {
          const uid = userProfileRef.current?.uid;
          if (uid) {
            pushActiveSession(uid, null);
          }
          setRemoteActiveSession(null);
          p2pEngineRef.current?.destroy();
          p2pEngineRef.current = null;
          setP2pStats(null);
          setStageSession(null);
          firebaseFightcadeService.clearActivePlayingGame();
        }}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
    </div>
  );
}
