import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSettings } from './hooks/useSettings';
import { SettingsModal } from './components/settings/SettingsModal';
import { useMobileNavigation, useOnlineStatus } from './hooks/useMobileNavigation';
import { useGamepadNavigation } from './hooks/useGamepadNavigation';
import { showBackgroundNotification, syncPushSubscriptionIfGranted } from './services/pushNotificationService';
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
import { MatchSyncModal } from './components/netplay/MatchSyncModal';
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
import { subscribeFriendsState } from './services/friendsService';
import { PlayerAvatar } from './components/common/PlayerAvatar';
import { FriendsDrawer } from './components/social/FriendsDrawer';
import { VoicePartyPill } from './components/social/VoicePartyPill';
import { voiceChatService } from './services/voiceChatService';
import { countryCodeToFlag } from './data/countries';
import { RollbackP2PEngine } from './services/rollbackP2P';
import { isJ2meGame, parseMaxPlayers, supportsOnlineMultiplayer } from './utils/gameCapabilities';
import { getUniverseTheme } from './data/universeThemes';
import {
  Gamepad2, Disc, Cpu, Coffee, Settings, Joystick, Coins, Layers, Swords, UserCheck, Cloud, Play, X, Plus, Wifi, WifiOff, Database, Users, Sun, Moon
} from 'lucide-react';

// ============================================================================
// MODE TEST DÉVELOPPEUR : Afficher le bouton "+10 COINS (Test Gratuit)"
// Passez simplement cette variable à `false` avant la mise sur le marché !
// ============================================================================
export const ENABLE_DEV_TEST_COINS = true;

const SHELL_MODES = [
  { id: 'all', label: 'Tous les jeux', subtitle: 'Game Mode Unifié · Tous Univers', icon: Layers },
  { id: 'arcade', label: 'Arcade / Neo Geo', subtitle: 'Neo Geo MVS · MAME 2003-Plus · Rollback P2P', icon: Joystick },
  { id: 'playstation', label: 'PlayStation', subtitle: 'PS1 · PSP (PPSSPP) · PS Vita (Vita3K)', icon: Disc },
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
    updateUiSetting,
    updateVoiceSetting,
    resetToDefaults,
  } = useSettings();

  const [voiceState, setVoiceState] = useState(() => ({ ...voiceChatService.state }));
  const [activeDmFriend, setActiveDmFriend] = useState(null);
  const [dmToast, setDmToast] = useState(null);

  const themePreference = settings?.ui?.theme || 'dark';
  const [resolvedTheme, setResolvedTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark';
    if (themePreference === 'system') {
      return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    return themePreference === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    const mql = window.matchMedia?.('(prefers-color-scheme: light)');
    const applyTheme = () => {
      const next =
        themePreference === 'system'
          ? mql?.matches
            ? 'light'
            : 'dark'
          : themePreference === 'light'
          ? 'light'
          : 'dark';
      setResolvedTheme(next);
      const root = document.documentElement;
      root.dataset.theme = next;
      if (next === 'light') {
        root.classList.remove('dark');
        root.classList.add('light');
      } else {
        root.classList.remove('light');
        root.classList.add('dark');
      }
      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) {
        metaTheme.setAttribute('content', next === 'light' ? '#f2f6fb' : '#090b10');
      }
    };

    applyTheme();
    if (themePreference === 'system' && mql) {
      mql.addEventListener?.('change', applyTheme);
      return () => mql.removeEventListener?.('change', applyTheme);
    }
    return undefined;
  }, [themePreference]);

  const handleToggleTheme = useCallback(() => {
    updateUiSetting('theme', resolvedTheme === 'light' ? 'dark' : 'light');
  }, [resolvedTheme, updateUiSetting]);

  const isOnline = useOnlineStatus();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isFriendsOpen, setIsFriendsOpen] = useState(false);
  const [userProfile, setUserProfile] = useState(() => getCurrentUserProfile());
  const [friendsState, setFriendsState] = useState({ friends: [], incomingRequests: [], outgoingRequests: [] });

  // Connexion temps réel au Hub Vocal VPS (/ws/voice) & notifications DM
  const isFriendsOpenRef = useRef(false);
  useEffect(() => {
    isFriendsOpenRef.current = isFriendsOpen;
    if (!isFriendsOpen) setActiveDmFriend(null);
  }, [isFriendsOpen]);

  useEffect(() => {
    const unsub = voiceChatService.subscribe(setVoiceState);
    const unsubDm = voiceChatService.onDmEvent((ev) => {
      if (ev?.type === 'dm_message' && ev.message && ev.message.fromUid !== userProfileRef.current?.uid) {
        showBackgroundNotification({
          title: `💬 Message de ${ev.message.fromName || 'un ami'}`,
          body: String(ev.message.text || '').slice(0, 100),
          tag: `dm_${ev.message.fromUid}`,
        });
        if (!isFriendsOpenRef.current) {
          setDmToast(ev.message);
          setTimeout(() => {
            setDmToast((cur) => (cur?.id === ev.message.id ? null : cur));
          }, 5500);
        }
      }
    });
    return () => {
      unsub?.();
      unsubDm?.();
    };
  }, []);

  useEffect(() => {
    if (userProfile?.uid) {
      voiceChatService.connect(userProfile, settings?.voice);
      syncPushSubscriptionIfGranted(userProfile.uid).catch(() => {});
    }
  }, [userProfile?.uid, userProfile?.displayName, userProfile?.photoURL]);

  useEffect(() => {
    if (settings?.voice) {
      voiceChatService.updateSettings(settings.voice);
    }
  }, [settings?.voice]);

  const voiceInviteCooldownRef = useRef(new Map());
  const challengeSendLockRef = useRef(new Map());
  const challengeRespondLockRef = useRef(new Set());

  const handleInviteVoiceFriend = useCallback(
    async (friend) => {
      if (!friend?.uid) return;
      const now = Date.now();
      const prev = voiceInviteCooldownRef.current.get(friend.uid) || 0;
      if (now - prev < 4000) return;
      voiceInviteCooldownRef.current.set(friend.uid, now);
      await voiceChatService.inviteUser({
        toUid: friend.uid,
        roomTitle: `Groupe de ${userProfile?.displayName || 'Joueur'}`,
        channel: 'party',
      });
    },
    [userProfile?.displayName]
  );

  const handleAcceptVoiceInvite = useCallback(async (invite) => {
    if (!invite?.roomId) return;
    const key = `accept_${invite.roomId}`;
    const now = Date.now();
    const prev = voiceInviteCooldownRef.current.get(key) || 0;
    if (now - prev < 3000) return;
    voiceInviteCooldownRef.current.set(key, now);
    await voiceChatService.joinRoom({
      roomId: invite.roomId,
      title: invite.roomTitle || 'Groupe CSW Arcade',
      channel: invite.channel || 'party',
    });
  }, []);

  const handleJoinUserParty = useCallback(async (targetUser) => {
    if (!targetUser?.uid) return;
    await voiceChatService.joinUserParty(targetUser);
  }, []);

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

  // CSW Arcade : Lobby Global + 3 salons actifs max, défis 15s & WebRTC Rollback P2P
  const [activeChannels, setActiveChannels] = useState([]);
  const [selectedChannelId, setSelectedChannelId] = useState(null);
  const [onlineCount, setOnlineCount] = useState(1);
  const [limitModalGame, setLimitModalGame] = useState(null);
  const [incomingChallenge, setIncomingChallenge] = useState(null);
  const [activeMatchSync, setActiveMatchSync] = useState(null);
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
  const channelsTouchedRef = useRef(false);
  const stageSessionRef = useRef(null);
  stageSessionRef.current = stageSession;
  useGamepadNavigation({ isGameplayActive: Boolean(stageSession) });
  const userProfileRef = useRef(userProfile);
  userProfileRef.current = userProfile;

  const handleLaunchStage = (sessionObj, gameEntry = null) => {
    setStageSession(sessionObj);
    activeGameEntryRef.current = gameEntry;
    sessionStartedAtRef.current = Date.now();
    const targetEntry = gameEntry || sessionObj;
    const isJ2me = isJ2meGame(targetEntry);
    const canOnlineMulti = !isJ2me && supportsOnlineMultiplayer(targetEntry);

    if (sessionObj && !sessionObj.isSpectator) {
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
          inSalon: canOnlineMulti,
          status: 'playing',
          hasSavestate: Boolean(sessionObj.initialStateBase64),
        });
      }
      if (canOnlineMulti) {
        firebaseFightcadeService.setActivePlayingGame(
          gameEntry || {
            id: sessionObj.gameId || sessionObj.title,
            title: sessionObj.title,
            platformLabel: sessionObj.core?.toUpperCase() || 'Arcade',
            core: sessionObj.core,
            filename: sessionObj.filename,
            players: sessionObj.players,
            supportsMultiplayer: sessionObj.supportsMultiplayer,
          },
          {
            isNetplay: Boolean(sessionObj.isNetplay),
            opponentName: sessionObj.opponentName || null,
            opponentUid: sessionObj.opponentUid || null,
            challengeId: sessionObj.challengeId || null,
            hostUid: sessionObj.isNetplay ? (sessionObj.isHost ? uid : sessionObj.opponentUid) : null,
          }
        );
      } else {
        firebaseFightcadeService.clearActivePlayingGame();
      }
    }
  };

  const launchEntryWithRom = async (
    gameEntry,
    {
      isNetplay = false,
      isHost = true,
      isSpectator = false,
      playerIndex = 0,
      badgeSuffix = 'LOCAL',
      refundCoinOnFail = true,
      opponentName = null,
      opponentUid = null,
      hostUid = null,
      challengeId = null,
      initialStateBase64 = null,
      preloadedBlob = null,
    } = {}
  ) => {
    if (!gameEntry) return;
    const core = gameEntry.core || gameEntry.platform || 'fbneo';
    const isArcadeZip = core === 'fbneo' || core === 'mame2003_plus';
    const extractExts = isArcadeZip
      ? []
      : ['.nes', '.sfc', '.smc', '.gba', '.gb', '.gbc', '.n64', '.z64', '.v64', '.md', '.gen', '.bin', '.sms', '.gg', '.pce', '.nds', '.chd', '.pbp', '.iso', '.jar'];

    setBootNotice(`Lancement de « ${gameEntry.title} »…`);
    try {
      const fileBlob =
        preloadedBlob ||
        (await downloadAndCacheRom(gameEntry, {
          mode: core,
          core,
          extractExtensions: extractExts,
          onProgress: ({ received, total }) => {
            if (total > 0) {
              const pct = Math.min(100, Math.round((received / total) * 100));
              setBootNotice(`Chargement « ${gameEntry.title} » : ${pct}% (${formatBytes(received)})`);
            }
          },
        }));
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
          players: gameEntry.players || (isNetplay ? '1–2J' : '1J'),
          supportsMultiplayer: supportsOnlineMultiplayer(gameEntry),
          isNetplay,
          isHost,
          isSpectator: Boolean(isSpectator),
          playerIndex,
          opponentName,
          opponentUid,
          hostUid,
          challengeId,
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
    if (!supportsOnlineMultiplayer(gameEntry)) {
      setBootNotice(`« ${gameEntry?.title || 'Ce jeu'} » est uniquement disponible en mode Solo.`);
      setTimeout(() => setBootNotice(''), 3500);
      return;
    }
    channelsTouchedRef.current = true;
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
    channelsTouchedRef.current = true;
    await firebaseFightcadeService.leaveChannel(oldGameId);
    setLimitModalGame(null);
    await handleJoinFightcadeChannel(newGameEntry);
  };

  const handleLeaveFightcadeChannel = async (gameId) => {
    channelsTouchedRef.current = true;
    await firebaseFightcadeService.leaveChannel(gameId);
    if (selectedChannelId === gameId) setSelectedChannelId(null);
  };

  const startRollbackP2PMatch = async ({
    challengeId,
    isHost,
    gameEntry,
    preloadedBlob = null,
    opponentName = null,
    opponentUid = null,
    preserveRunningGame = false,
  }) => {
    p2pEngineRef.current?.destroy();
    const engine = new RollbackP2PEngine({
      isHost,
      inputDelay: settings?.netplay?.inputDelay ?? 1,
      onSignalIce: (cand) => {
        firebaseFightcadeService.postIceCandidate(challengeId, isHost ? 'caller' : 'callee', cand, opponentUid);
      },
      onRenegotiateOffer: (offer) => {
        firebaseFightcadeService.postRenegotiateOffer(challengeId, offer, opponentUid);
      },
      onStats: (st) => setP2pStats(st),
    });

    // Secours WebSocket VPS en cas de filtrage NAT / Box (supporte les paquets binaires GGPO 0x5A/0xCB et les savestates Frame 0)
    engine.onRelayButtonFallback = (payload) => {
      if (opponentUid && payload) {
        firebaseFightcadeService.sendRelayInput(opponentUid, payload);
      }
    };
    firebaseFightcadeService.onRelayInput((data) => {
      engine.handleRelayData(data);
    });
    engine.addCleanup(() => firebaseFightcadeService.onRelayInput(null));

    const unsubRtc = firebaseFightcadeService.subscribeRtcSignal(challengeId, async (msg) => {
      if (!msg?.signalType || !msg.payload) return;
      try {
        if (msg.signalType === 'candidate') {
          await engine.addRemoteCandidate(msg.payload);
        } else if (!isHost && msg.signalType === 'offer' && !engine.hasRemoteDesc) {
          const answer = await engine.acceptOfferAndCreateAnswer(msg.payload);
          if (answer) await firebaseFightcadeService.postAnswer(challengeId, answer, opponentUid);
        } else if (isHost && msg.signalType === 'answer' && !engine.hasRemoteDesc) {
          await engine.acceptAnswer(msg.payload);
        } else if (!isHost && msg.signalType === 'renegotiateOffer') {
          const answer = await engine.acceptRenegotiateOffer(msg.payload);
          if (answer) await firebaseFightcadeService.postRenegotiateAnswer(challengeId, answer, opponentUid);
        } else if (isHost && msg.signalType === 'renegotiateAnswer') {
          await engine.acceptRenegotiateAnswer(msg.payload);
        }
      } catch {
        /* noop */
      }
    });
    engine.addCleanup(unsubRtc);

    p2pEngineRef.current = engine;

    if (isHost) {
      const offer = await engine.initConnection();
      await firebaseFightcadeService.postOffer(challengeId, offer, opponentUid);
      // Si l'invité (P2) rejoint après l'envoi initial (Drop-In / Invitation), rejouer instantanément l'offre + tous les candidats ICE
      engine.onRequestOffer = () => {
        if (engine.destroyed || !engine.localOffer) return;
        firebaseFightcadeService.postOffer(challengeId, engine.localOffer, opponentUid);
        for (const cand of engine.localCandidates) {
          firebaseFightcadeService.postIceCandidate(challengeId, 'caller', cand, opponentUid);
        }
      };
      const unsubIce = firebaseFightcadeService.subscribeIceCandidates(challengeId, 'callee', (c) =>
        engine.addRemoteCandidate(c)
      );
      const unsubCh = firebaseFightcadeService.subscribeChallenge(challengeId, async (ch) => {
        if (ch?.answer && !engine.hasRemoteDesc) {
          engine.acceptAnswer(ch.answer);
        }
        if (ch?.renegotiateAnswer) {
          await engine.acceptRenegotiateAnswer(ch.renegotiateAnswer);
        }
      });
      engine.addCleanup(unsubIce);
      engine.addCleanup(unsubCh);
    } else {
      await engine.initConnection();
      // Demander immédiatement à l'hôte (P1) de rejouer son offre + candidats ICE (résout la race condition Drop-In / Web <-> Desktop)
      if (opponentUid) {
        firebaseFightcadeService.sendRelayInput(opponentUid, { syncType: 'REQUEST_OFFER' });
        const retryOffer1 = setTimeout(() => {
          if (!engine.destroyed && !engine.hasRemoteDesc) {
            firebaseFightcadeService.sendRelayInput(opponentUid, { syncType: 'REQUEST_OFFER' });
          }
        }, 700);
        const retryOffer2 = setTimeout(() => {
          if (!engine.destroyed && !engine.hasRemoteDesc) {
            firebaseFightcadeService.sendRelayInput(opponentUid, { syncType: 'REQUEST_OFFER' });
          }
        }, 1800);
        engine.addCleanup(() => {
          clearTimeout(retryOffer1);
          clearTimeout(retryOffer2);
        });
      }
      const unsubIce = firebaseFightcadeService.subscribeIceCandidates(challengeId, 'caller', (c) =>
        engine.addRemoteCandidate(c)
      );
      const unsubCh = firebaseFightcadeService.subscribeChallenge(challengeId, async (ch) => {
        if (ch?.offer && !engine.hasRemoteDesc) {
          const answer = await engine.acceptOfferAndCreateAnswer(ch.offer);
          if (answer) {
            await firebaseFightcadeService.postAnswer(challengeId, answer, opponentUid);
          }
        }
        if (ch?.renegotiateOffer) {
          const answer = await engine.acceptRenegotiateOffer(ch.renegotiateOffer);
          if (answer) {
            await firebaseFightcadeService.postRenegotiateAnswer(challengeId, answer, opponentUid);
          }
        }
      });
      engine.addCleanup(unsubIce);
      engine.addCleanup(unsubCh);
    }

    // Calibration automatique du stabilisateur de ping VPS selon les continents des deux joueurs
    const myReg = settings?.system?.region || userProfileRef.current?.region || 'europe';
    const oppFriend = friendsState.friends.find((f) => f.uid === opponentUid);
    const oppReg = oppFriend?.region || myReg;
    fetch(`/api/netplay-profile?r1=${encodeURIComponent(myReg)}&r2=${encodeURIComponent(oppReg)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.ok && data.profile && p2pEngineRef.current === engine) {
          engine.applyRegionalProfile(data.profile);
        }
      })
      .catch(() => {});

    if (gameEntry) {
      const myUid = userProfileRef.current?.uid || null;
      const resolvedHostUid = isHost ? myUid : opponentUid;
      const resolvedGuestUid = isHost ? opponentUid : myUid;
      firebaseFightcadeService.registerSpectateMatch({
        challengeId,
        hostUid: resolvedHostUid,
        guestUid: resolvedGuestUid,
        isHost,
      });
      if (selectedChannelId) {
        firebaseFightcadeService.upsertPresence(selectedChannelId, 'playing', {
          challengeId,
          hostUid: resolvedHostUid,
          isHost,
        });
      }
      const maxP = parseMaxPlayers(gameEntry) || 2;
      const pIdx = isHost ? 0 : 1;

      // DROP-IN SANS REDÉMARRAGE : si l'hôte joue déjà à ce jeu (ex: Mission 3 Metal Slug), on garde l'émulateur vivant !
      if (preserveRunningGame && isHost && stageSessionRef.current) {
        setStageSession((prev) =>
          prev
            ? {
                ...prev,
                isNetplay: true,
                isHost: true,
                isSpectator: false,
                isLiveDropIn: true,
                playerIndex: 0,
                maxPlayers: maxP,
                badgeSuffix: `P1 HÔTE · DROP-IN LIVE (${opponentName})`,
                opponentName,
                opponentUid,
                hostUid: resolvedHostUid,
                challengeId,
              }
            : prev
        );
      } else {
        await launchEntryWithRom(gameEntry, {
          isNetplay: true,
          isHost,
          isSpectator: false,
          playerIndex: pIdx,
          maxPlayers: maxP,
          badgeSuffix: `${isHost ? 'P1 HÔTE' : `P${pIdx + 1} INVITÉ`} · NETPLAY ${maxP}J`,
          preloadedBlob,
          opponentName,
          opponentUid,
          hostUid: resolvedHostUid,
          challengeId,
        });
      }
    }
  };

  const handleLaunchMatchFromSync = async ({
    gameEntry,
    fileBlob,
    isHost,
    playerIndex,
    challengeId,
    opponentName,
    opponentUid,
  }) => {
    setActiveMatchSync(null);
    if (isHost) {
      if (!requireAndConsumeCoin(2)) {
        if (challengeId && opponentUid) {
          firebaseFightcadeService.sendMatchCancel(challengeId, opponentUid);
        }
        return;
      }
    }
    await startRollbackP2PMatch({
      challengeId,
      isHost,
      gameEntry,
      preloadedBlob: fileBlob,
      opponentName,
      opponentUid,
    });
  };

  const handleChallengePlayer = async (channel, targetUser) => {
    const targetEntry = channel?.entry || channel;
    if (!supportsOnlineMultiplayer(targetEntry)) {
      setBootNotice(`« ${channel?.title || targetEntry?.title || 'Ce jeu'} » est uniquement jouable en Solo.`);
      setTimeout(() => setBootNotice(''), 3500);
      return;
    }
    const lockKey = `${channel?.gameId || targetEntry?.id || ''}:${targetUser?.uid || ''}`;
    const now = Date.now();
    const lastAttempt = challengeSendLockRef.current.get(lockKey) || 0;
    if (now - lastAttempt < 4000) return;
    challengeSendLockRef.current.set(lockKey, now);

    const targetIsAlreadyPlaying = Boolean(
      targetUser?.status === 'in_game_available' ||
      targetUser?.status === 'playing' ||
      targetUser?.currentGame
    );
    // En mode Drop-In (rejoindre quelqu'un déjà en partie), seul 1 Coin est requis (sinon 2 Coins pour un défi classique)
    const requiredCoins = targetIsAlreadyPlaying ? 1 : 2;
    if (!hasCoins(requiredCoins)) {
      setNoCoinsModalOpen(true);
      return;
    }
    const challengeId = await firebaseFightcadeService.sendChallenge(channel.gameId, targetUser, channel.entry);
    if (!challengeId) return;
    setActiveMatchSync({
      challengeId,
      challenge: {
        challengeId,
        gameId: channel.gameId,
        gameTitle: channel.title,
        gameEntry: channel.entry,
        fromUid: userProfileRef.current?.uid,
        fromName: userProfileRef.current?.displayName || userProfileRef.current?.name || 'Joueur',
        toUid: targetUser.uid,
        toName: targetUser.name,
        isDropIn: targetIsAlreadyPlaying,
        status: 'pending',
      },
      // Si la cible joue déjà (ex: Mission 3 Metal Slug), ELLE reste l'Hôte P1 pour ne jamais redémarrer sa partie !
      isHost: !targetIsAlreadyPlaying,
    });
  };

  const handleRespondChallenge = async (accept) => {
    if (!incomingChallenge) return;
    const ch = incomingChallenge;
    if (!ch.challengeId || challengeRespondLockRef.current.has(ch.challengeId)) return;
    challengeRespondLockRef.current.add(ch.challengeId);
    const channel = activeChannels.find((c) => c.gameId === ch.gameId);
    const resolvedGameEntry = ch.gameEntry || channel?.entry || { id: ch.gameId, title: ch.gameTitle };
    const allowAccept = Boolean(accept) && supportsOnlineMultiplayer(resolvedGameEntry);
    setIncomingChallenge(null);
    await firebaseFightcadeService.respondChallenge(ch.challengeId, allowAccept, ch.fromUid);
    if (allowAccept) {
      const curStage = stageSessionRef.current;
      const isAlreadyPlayingSameGame = Boolean(
        curStage &&
        !curStage.isSpectator &&
        curStage.kind !== 'j2me' &&
        (normalizeGameChannelId(curStage) === normalizeGameChannelId(resolvedGameEntry) ||
          String(curStage.title || '').toLowerCase() === String(resolvedGameEntry.title || ch.gameTitle || '').toLowerCase())
      );

      // ZERO-REBOOT DROP-IN : si le joueur est DÉJÀ en partie sur ce jeu (sélection perso ou Mission 3 Metal Slug),
      // il reste Hôte P1 sans fermer ni redémarrer l'émulateur et envoie son savestate live à J2 !
      if (isAlreadyPlayingSameGame) {
        await startRollbackP2PMatch({
          challengeId: ch.challengeId,
          isHost: true,
          gameEntry: resolvedGameEntry,
          opponentName: ch.fromName,
          opponentUid: ch.fromUid,
          preserveRunningGame: true,
        });
        return;
      }

      setActiveMatchSync({
        challengeId: ch.challengeId,
        challenge: {
          ...ch,
          gameEntry: resolvedGameEntry,
        },
        isHost: false,
      });
    }
  };

  const handleCatalogLoaded = useCallback((items) => {
    firebaseFightcadeService.revalidateChannelsWithCatalog(items);
  }, []);

  const handleSpectateTarget = useCallback((channel, targetUser) => {
    const targetEntry = !channel?.isGlobal && channel?.entry
      ? { ...(targetUser?.currentGame || {}), ...channel.entry }
      : targetUser?.currentGame || channel?.entry;
    if (!targetEntry || !supportsOnlineMultiplayer(targetEntry)) return;
    const cg = targetUser?.currentGame || {};
    const mm = targetUser?.matchMeta || {};
    const challengeId = mm.challengeId || cg.challengeId || null;
    const hostUid = mm.hostUid || cg.hostUid || (mm.isHost === true ? targetUser.uid : null);
    const vsName = cg.opponentName ? ` vs ${cg.opponentName}` : '';
    p2pEngineRef.current?.destroy();
    p2pEngineRef.current = null;
    setP2pStats(null);
    launchEntryWithRom(targetEntry, {
      isNetplay: true,
      isHost: false,
      isSpectator: true,
      playerIndex: -1,
      maxPlayers: parseMaxPlayers(targetEntry) || 2,
      badgeSuffix: `SPECTATEUR LIVE (${targetUser.name || targetUser.displayName}${vsName})`,
      refundCoinOnFail: false,
      opponentName: targetUser.name || targetUser.displayName,
      opponentUid: targetUser.uid,
      hostUid,
      challengeId,
    });
  }, []);

  const refreshPlatformCache = () => {
    getPlatformCacheStats().then(setCacheStats).catch(() => {});
  };

  useEffect(() => {
    const unsubAuth = subscribeAuthProfile(setUserProfile);
    const unsubW = subscribeWallet(setCoins);
    const unsubC = firebaseFightcadeService.subscribeActiveChannels(setActiveChannels);
    const unsubCh = firebaseFightcadeService.subscribeIncomingChallenges((list) => {
      const validList = [];
      for (const ch of list) {
        const entry = ch?.gameEntry || { id: ch?.gameId, title: ch?.gameTitle };
        if (supportsOnlineMultiplayer(entry)) {
          validList.push(ch);
        } else if (ch?.challengeId) {
          firebaseFightcadeService.respondChallenge(ch.challengeId, false, ch.fromUid);
        }
      }
      if (validList.length > 0) {
        const firstCh = validList[0];
        setIncomingChallenge(firstCh);
        if (settings?.netplay?.challengeSound ?? true) playChallengeSound();
        showBackgroundNotification({
          title: `⚔️ Défi reçu de ${firstCh.fromName || 'un joueur'} !`,
          body: `Viens l'affronter sur ${firstCh.gameTitle || 'CSW-Arcade'} !`,
          tag: `challenge_${firstCh.challengeId || Date.now()}`,
        });
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

  // Écoute temps-réel du système d'amitié (amis en ligne, demandes reçues/envoyées)
  useEffect(() => {
    const unsub = subscribeFriendsState(userProfile, setFriendsState);
    return () => unsub?.();
  }, [userProfile?.uid, userProfile?.displayName, userProfile?.photoURL, userProfile?.rank, userProfile?.region]);

  // Écoute temps-réel du nombre de joueurs connectés aux Salons CSW Arcade
  useEffect(() => {
    const unsub = firebaseFightcadeService.subscribeChannelUsers(GLOBAL_CHANNEL_ID, (users) => {
      if (Array.isArray(users)) {
        setOnlineCount(Math.max(1, users.length));
      }
    });
    return () => unsub?.();
  }, []);

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

      // 2. Synchroniser les 3 Salons CSW Arcade actifs uniquement s'ils proviennent d'un autre appareil/session
      if (
        Array.isArray(sync.activeChannels) &&
        sync.channelsUpdatedAtMs > lastRemoteChannelsTsRef.current &&
        (!sync.channelsSourceDeviceId || sync.channelsSourceDeviceId !== myDevId)
      ) {
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
    if (activeChannels.length > 0) channelsTouchedRef.current = true;
    if (!channelsTouchedRef.current && activeChannels.length === 0) return;
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
        const targetEntry = activeGameEntryRef.current || curSess;
        const canMulti = !isJ2meGame(targetEntry) && supportsOnlineMultiplayer(targetEntry);
        pushActiveSession(uid, {
          gameId: gid,
          title: curSess.title,
          core: curSess.core,
          kind: curSess.kind,
          platformLabel: activeGameEntryRef.current?.platformLabel || curSess.core?.toUpperCase() || 'Arcade',
          filename: curSess.filename,
          gameEntry: activeGameEntryRef.current,
          inSalon: canMulti,
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

  const handleCloseStage = () => {
    const uid = userProfileRef.current?.uid;
    const curSess = stageSessionRef.current;
    if (curSess?.isSpectator) {
      firebaseFightcadeService.leaveSpectate({ challengeId: curSess.challengeId });
    } else {
      if (uid) {
        pushActiveSession(uid, null);
      }
      firebaseFightcadeService.clearActivePlayingGame();
    }
    setRemoteActiveSession(null);
    p2pEngineRef.current?.destroy();
    p2pEngineRef.current = null;
    setP2pStats(null);
    setStageSession(null);
  };

  const { exitToastVisible } = useMobileNavigation({
    layers: [
      { id: 'settings', active: isSettingsOpen, onClose: () => setIsSettingsOpen(false) },
      { id: 'auth', active: isAuthOpen, onClose: () => setIsAuthOpen(false) },
      { id: 'saspay', active: isSasPayOpen, onClose: () => setIsSasPayOpen(false) },
      { id: 'noCoins', active: noCoinsModalOpen, onClose: () => setNoCoinsModalOpen(false) },
      { id: 'buyMenu', active: buyMenuOpen, onClose: () => setBuyMenuOpen(false) },
      { id: 'limitModal', active: Boolean(limitModalGame), onClose: () => setLimitModalGame(null) },
      { id: 'matchSync', active: Boolean(activeMatchSync), onClose: () => setActiveMatchSync(null) },
      { id: 'stage', active: Boolean(stageSession), onClose: handleCloseStage },
      { id: 'channel', active: selectedChannelId !== null, onClose: () => setSelectedChannelId(null) },
    ],
  });

  const currentModeMeta = SHELL_MODES.find((m) => m.id === platformMode) || SHELL_MODES[0];
  const universeTheme = getUniverseTheme(platformMode);
  const resolvedSelectedChannel =
    selectedChannelId === GLOBAL_CHANNEL_ID
      ? GLOBAL_CHANNEL
      : activeChannels.find((c) => c.gameId === selectedChannelId) || null;

  return (
    <div
      data-universe={platformMode}
      className="u-shell-bg u-mobile-flow-root flex flex-col h-[100dvh] w-screen overflow-hidden font-sans text-neutral-100 pt-safe-pwa"
    >
      {/* Topbar Unifiée Thématisée par Console — Fixe en haut sur mobile portrait, flux normal sans masquage sur paysage/tablette */}
      <header className="u-header-bg sticky top-0 md:static border-b shrink-0 z-30 px-2.5 sm:px-4 py-1.5 sm:py-2 space-y-1.5">
        {/* Ligne 1 : Identité Console + Statut Système + Actions */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src="./icons/icon-192.png"
              alt="CSW Arcade"
              className="w-8 h-8 rounded-xl shrink-0 ring-1 u-accent-border shadow-md"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-black tracking-wider text-sm sm:text-base text-white leading-tight whitespace-nowrap shrink-0">
                  CSW<span className="u-accent-text">.</span>ARCADE
                </span>
                <span className="hidden lg:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md u-badge text-[10px] font-mono font-bold tracking-wide shrink-0">
                  {universeTheme.symbols ? (
                    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
                      {universeTheme.symbols.map((s) => (
                        <span key={s.label} style={{ color: s.color }} className="text-[11px] leading-none font-black">
                          {s.glyph}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
                      {universeTheme.jewels.map((hex, i) => (
                        <span
                          key={i}
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </span>
                  )}
                  <span>{universeTheme.hardwareTag}</span>
                </span>
              </div>
              <div className="text-[11px] font-mono text-neutral-300 truncate">
                {currentModeMeta.subtitle}
              </div>
            </div>
          </div>

          {/* Actions rapides Mobile (< md) — Cibles tactiles 44×44px sans écraser le titre */}
          <div className="flex md:hidden items-center gap-1.5 shrink-0">
            <span
              className={`inline-flex items-center justify-center w-9 h-9 rounded-xl border ${
                isOnline
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                  : 'bg-amber-950/60 border-amber-500/40 text-amber-300'
              }`}
              title={isOnline ? 'En ligne' : 'Hors-ligne'}
              aria-label={isOnline ? 'Statut : En ligne' : 'Statut : Hors-ligne'}
            >
              {isOnline ? <Wifi className="w-4 h-4 shrink-0" aria-hidden="true" /> : <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />}
            </span>

            <button
              type="button"
              onClick={() => setIsFriendsOpen(true)}
              aria-label="Amis & Social"
              title="Amis & Social"
              className="arcade-focus-ring relative flex items-center justify-center w-11 h-11 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/15 u-accent-text transition-colors"
            >
              <Users className="w-4 h-4" aria-hidden="true" />
              {friendsState.incomingRequests.length + (voiceState.totalUnreadDm || 0) > 0 ? (
                <span className="absolute -top-1 -right-1 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[9px] font-black leading-none">
                  {friendsState.incomingRequests.length + (voiceState.totalUnreadDm || 0)}
                </span>
              ) : friendsState.friends.some((f) => f.isOnline) ? (
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400" aria-hidden="true" />
              ) : null}
            </button>

            <button
              type="button"
              onClick={handleToggleTheme}
              aria-label={resolvedTheme === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair'}
              title={resolvedTheme === 'light' ? 'Mode sombre' : 'Mode clair'}
              className="arcade-focus-ring flex items-center justify-center w-11 h-11 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/15 text-neutral-100 transition-colors"
            >
              {resolvedTheme === 'light' ? (
                <Moon className="w-4 h-4 u-accent-text" aria-hidden="true" />
              ) : (
                <Sun className="w-4 h-4 text-amber-300" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Paramètres unifiés"
              title="Paramètres"
              className="arcade-focus-ring flex items-center justify-center w-11 h-11 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/15 text-neutral-100 transition-colors"
            >
              <Settings className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/* Actions Desktop (md+) — Complètes et adaptatives */}
          <div className="hidden md:flex items-center gap-2 flex-wrap justify-end relative">
            <button
              type="button"
              onClick={() => setIsAuthOpen(true)}
              title={`Connexion / Stats & Rang (${userProfile?.ratingPoints || 0} RP)`}
              className={`arcade-focus-ring flex items-center gap-1.5 px-2.5 py-1.5 min-h-[38px] rounded-xl border text-xs font-bold transition-colors ${
                userProfile?.isAuthenticated
                  ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200 hover:bg-emerald-950/80'
                  : 'u-tab-active hover:opacity-95'
              }`}
            >
              <PlayerAvatar
                photoURL={userProfile?.photoURL}
                name={userProfile?.displayName || 'Joueur'}
                size="xs"
              />
              <span
                className={`px-1.5 py-0.5 rounded border text-[10px] font-mono font-black ${
                  getRankTierMeta(userProfile?.rank || 'D').color
                }`}
              >
                {userProfile?.rank || 'D'}
              </span>
              <span className="truncate max-w-[110px]">{userProfile?.displayName || 'Joueur'}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-neutral-100">
                {userProfile?.region || 'FR'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setIsFriendsOpen(true)}
              title="Amis & Social — Trouver vos amis et jouer ensemble"
              className="arcade-focus-ring relative flex items-center gap-1.5 px-2.5 py-1.5 min-h-[38px] rounded-xl bg-neutral-900 hover:bg-neutral-800 border u-accent-border text-xs font-bold text-neutral-100 transition-colors"
            >
              <Users className="w-3.5 h-3.5 u-accent-text" aria-hidden="true" />
              <span>Amis</span>
              <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-mono tabular-nums">
                {friendsState.friends.filter((f) => f.isOnline).length}
              </span>
              {friendsState.incomingRequests.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-black text-[10px] font-mono font-black">
                  +{friendsState.incomingRequests.length}
                </span>
              )}
              {(voiceState.totalUnreadDm || 0) > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-mono font-black">
                  {voiceState.totalUnreadDm}
                </span>
              )}
            </button>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsSasPayOpen(true)}
                className={`arcade-focus-ring flex items-center gap-1.5 px-2.5 py-1.5 min-h-[38px] rounded-xl border text-xs font-mono font-bold tabular-nums transition-colors ${
                  coins <= 0
                    ? 'bg-rose-950/50 border-rose-500/60 text-rose-200 hover:bg-rose-950/70'
                    : 'bg-amber-950/40 border-amber-500/40 text-amber-200 hover:bg-amber-950/70'
                }`}
                title="Portefeuille Coins · Acheter via SasPay"
              >
                {coins <= 0 && <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping shrink-0" aria-hidden="true" />}
                <Coins className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                <span>{String(coins).padStart(2, '0')}/99 COINS</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500 text-black font-black">
                  Acheter
                </span>
              </button>

              {ENABLE_DEV_TEST_COINS && (
                <button
                  type="button"
                  onClick={() => addCoins(10)}
                  title="Mode Test : Ajouter +10 Coins gratuitement sans payer"
                  className="arcade-focus-ring flex items-center gap-1 px-2.5 py-1.5 min-h-[38px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black shadow-lg shadow-emerald-500/20 border border-emerald-400 transition-all active:scale-95"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[3]" aria-hidden="true" />
                  <span>10 COINS</span>
                </button>
              )}
            </div>

            <span className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-neutral-900/90 border border-white/10 text-[11px] font-mono text-neutral-200 tabular-nums">
              <Database className="w-3 h-3 u-accent-text" aria-hidden="true" />
              <span>Cache : {cacheStats.count} · {formatBytes(cacheStats.totalBytes)}</span>
            </span>
            <span
              className={`hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] font-mono ${
                isOnline
                  ? 'bg-emerald-950/50 border-emerald-700/50 text-emerald-300'
                  : 'bg-amber-950/50 border-amber-700/50 text-amber-300'
              }`}
            >
              {isOnline ? <Wifi className="w-3 h-3" aria-hidden="true" /> : <WifiOff className="w-3 h-3" aria-hidden="true" />}
              <span>{isOnline ? 'En ligne' : 'Hors-ligne'}</span>
            </span>
            <button
              type="button"
              onClick={handleToggleTheme}
              aria-label={resolvedTheme === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair'}
              title={resolvedTheme === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair'}
              className="arcade-focus-ring flex items-center justify-center w-10 h-10 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/15 text-neutral-100 transition-colors"
            >
              {resolvedTheme === 'light' ? (
                <Moon className="w-4 h-4 u-accent-text" aria-hidden="true" />
              ) : (
                <Sun className="w-4 h-4 text-amber-300" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Paramètres unifiés"
              title="Paramètres unifiés"
              className="arcade-focus-ring flex items-center justify-center w-10 h-10 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/15 text-neutral-100 transition-colors"
            >
              <Settings className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Ligne 2 Mobile (< md) : Barre Joueur & Portefeuille proportionnée (bouton compte compact) */}
        <div className="flex md:hidden items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setIsAuthOpen(true)}
            aria-label="Profil, Connexion, Stats et Rang"
            className={`arcade-focus-ring min-w-0 max-w-[220px] sm:max-w-[260px] flex items-center gap-2 px-2.5 py-1.5 min-h-[44px] rounded-xl border text-xs font-bold transition-colors ${
              userProfile?.isAuthenticated
                ? 'u-tab-active'
                : 'bg-neutral-900/90 border-white/15 text-neutral-100'
            }`}
          >
            <PlayerAvatar
              photoURL={userProfile?.photoURL}
              name={userProfile?.displayName || 'Joueur'}
              size="xs"
            />
            <span
              className={`px-1.5 py-0.5 rounded border text-[10px] font-mono font-black shrink-0 ${
                getRankTierMeta(userProfile?.rank || 'D').color
              }`}
            >
              {userProfile?.rank || 'D'}
            </span>
            <span className="truncate">{userProfile?.displayName || 'Joueur'}</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/35 text-neutral-100 shrink-0 ml-auto">
              {userProfile?.region || 'FR'}
            </span>
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsSasPayOpen(true)}
              aria-label="Portefeuille Coins et achat SasPay"
              className={`arcade-focus-ring flex items-center gap-1.5 px-2.5 py-1.5 min-h-[44px] rounded-xl border text-xs font-mono font-bold tabular-nums shrink-0 ${
                coins <= 0
                  ? 'bg-rose-950/50 border-rose-500/60 text-rose-200'
                  : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
              }`}
            >
              {coins <= 0 && <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping shrink-0" aria-hidden="true" />}
              <Coins className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
              <span>{String(coins).padStart(2, '0')}/99</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500 text-black font-black">
                Acheter
              </span>
            </button>

            {ENABLE_DEV_TEST_COINS && (
              <button
                type="button"
                onClick={() => addCoins(10)}
                title="Mode Test : Ajouter +10 Coins gratuitement sans payer"
                className="arcade-focus-ring flex items-center justify-center gap-0.5 px-2.5 min-w-[44px] min-h-[44px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black shadow-md shadow-emerald-500/20 border border-emerald-400 transition-transform active:scale-95 shrink-0 tabular-nums"
              >
                <Plus className="w-3.5 h-3.5 stroke-[3]" aria-hidden="true" />
                <span>10</span>
              </button>
            )}
          </div>
        </div>

        {/* Ligne 3 : Barre d'Univers — Thématisée avec indicateur de défilement */}
        <div className="relative">
          <nav
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar snap-x pr-6 md:pr-0"
            role="tablist"
            aria-label="Univers de jeux"
          >
            {SHELL_MODES.map((m, idx) => {
              const Icon = m.icon;
              const active = selectedChannelId === null && platformMode === m.id;
              const mTheme = getUniverseTheme(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-gamepad-universe-tab
                  data-active={active ? 'true' : 'false'}
                  title={`${m.label} (Alt+${idx + 1})`}
                  onClick={() => {
                    setSelectedChannelId(null);
                    setPlatformMode(m.id);
                  }}
                  className={`arcade-focus-ring snap-start flex items-center gap-1.5 px-3 py-1.5 min-h-[40px] md:min-h-[36px] rounded-xl text-xs font-bold transition-all shrink-0 border ${
                    active
                      ? 'u-btn-primary'
                      : 'bg-neutral-900/75 text-neutral-200 hover:text-white hover:bg-neutral-800/90 border-white/10'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: active ? mTheme.accentFgHex : mTheme.accentHex }}
                    aria-hidden="true"
                  />
                  <Icon className="w-3.5 h-3.5 md:w-4 md:h-4 shrink-0" aria-hidden="true" />
                  <span>{m.label}</span>
                </button>
              );
            })}
          </nav>
          <div
            className="pointer-events-none md:hidden absolute right-0 top-0 bottom-0 w-7 bg-gradient-to-l from-neutral-950/90 to-transparent"
            aria-hidden="true"
          />
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

      {/* Corps Unifié : Dock Salons CSW Arcade (Desktop gauche / Mobile Bottom Bar) + Vue Active */}
      <div className="u-mobile-flow-container flex flex-1 min-h-0 overflow-hidden relative">
        <FightcadeChannelsDock
          activeChannels={activeChannels}
          selectedChannelId={selectedChannelId}
          onlineCount={onlineCount}
          onSelectLibrary={() => setSelectedChannelId(null)}
          onSelectChannel={(id) => setSelectedChannelId(id)}
          onLeaveChannel={handleLeaveFightcadeChannel}
          onOpenProfile={() => setIsAuthOpen(true)}
          userRank={userProfile?.rank || 'D'}
          limitModalGame={limitModalGame}
          onCloseLimitModal={() => setLimitModalGame(null)}
          onReplaceChannel={handleReplaceFightcadeChannel}
        />

        {/* Pile d'overlays flottants au premier plan (z-[200] — toujours devant les tiroirs et modales) */}
        <div className="fixed bottom-[76px] md:bottom-6 left-3 right-3 md:left-auto md:right-6 z-[200] flex flex-col items-end gap-2.5 pointer-events-none">
          {!stageSession && incomingChallenge && incomingChallenge.fromUid !== userProfile?.uid && !activeMatchSync && (
            <div className="pointer-events-auto w-full md:w-80 rounded-2xl bg-neutral-900 border-2 u-accent-border p-4 shadow-2xl space-y-3">
              <div className="flex items-center gap-2 u-accent-text font-black text-xs uppercase">
                <Swords className="w-4 h-4 animate-pulse" aria-hidden="true" />
                <span>Défi CSW Arcade reçu !</span>
              </div>
              <p className="text-xs text-neutral-100">
                <strong>{incomingChallenge.fromName}</strong> vous défie sur <strong>{incomingChallenge.gameTitle}</strong> (Match offert par l&apos;hôte · 0 Coin requis).
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleRespondChallenge(true)}
                  className="arcade-focus-ring flex-1 py-2.5 min-h-[44px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black"
                >
                  Accepter (Offert)
                </button>
                <button
                  type="button"
                  onClick={() => handleRespondChallenge(false)}
                  className="arcade-focus-ring px-3.5 py-2.5 min-h-[44px] rounded-xl bg-neutral-800 hover:bg-rose-950 text-neutral-200 text-xs font-bold"
                >
                  Refuser
                </button>
              </div>
            </div>
          )}

          {remoteActiveSession &&
            !stageSession &&
            remoteActiveSession.status === 'playing' &&
            (remoteActiveSession.updatedAtMs || 0) !== dismissedSessionTs && (
              <div className="pointer-events-auto w-full md:w-[400px] rounded-2xl bg-neutral-900/95 backdrop-blur-xl border-2 border-emerald-400/70 p-4 shadow-2xl space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 text-emerald-300 font-black text-xs uppercase">
                    <Cloud className="w-4 h-4 animate-pulse shrink-0" aria-hidden="true" />
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
                    className="arcade-focus-ring p-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white"
                    aria-label="Fermer la bannière de reprise"
                    title="Fermer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-neutral-100">
                    Vous jouez actuellement à{' '}
                    <strong className="text-white">« {remoteActiveSession.title} »</strong> sur{' '}
                    <strong className="u-accent-text">{remoteActiveSession.deviceName}</strong>.
                  </p>
                  <p className="text-[11px] font-mono text-emerald-300">
                    {remoteActiveSession.hasSavestate
                      ? 'Sauvegarde instantanée prête · Reprise sans dépenser de Coin'
                      : 'Salon synchronisé · Reprise immédiate sans dépenser de Coin'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={resumingHandoff}
                    onClick={() => handleResumeRemoteSession(remoteActiveSession)}
                    className="arcade-focus-ring flex-1 py-2.5 px-3 min-h-[44px] rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black text-xs font-black flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Play className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{resumingHandoff ? 'Synchronisation…' : 'Poursuivre ma partie ici'}</span>
                  </button>
                  {remoteActiveSession.inSalon && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedChannelId(remoteActiveSession.gameId);
                        setDismissedSessionTs(remoteActiveSession.updatedAtMs || Date.now());
                      }}
                      className="arcade-focus-ring px-3.5 py-2.5 min-h-[44px] rounded-xl bg-neutral-800 hover:bg-neutral-700 u-accent-text text-xs font-bold shrink-0"
                    >
                      Salon
                    </button>
                  )}
                </div>
              </div>
            )}

          {onlineCount > 1 && selectedChannelId === null && (
            <button
              type="button"
              onClick={() => setSelectedChannelId(GLOBAL_CHANNEL_ID)}
              className="pointer-events-auto arcade-focus-ring hidden md:flex px-4 py-2.5 min-h-[44px] rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs shadow-2xl shadow-emerald-500/25 items-center gap-2 transition-transform active:scale-95 border-2 border-neutral-950"
              title="Des joueurs sont actuellement connectés au salon. Cliquez pour les rejoindre !"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-black animate-ping shrink-0" aria-hidden="true" />
              <Users className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{onlineCount} Joueurs au Salon · Rejoindre</span>
            </button>
          )}
        </div>

        {resolvedSelectedChannel ? (
          <FightcadeLobbyView
            channel={resolvedSelectedChannel}
            activeChannels={activeChannels}
            userProfile={userProfile}
            friendsState={friendsState}
            voiceState={voiceState}
            onJoinUserParty={handleJoinUserParty}
            onToggleVoiceMute={() => voiceChatService.toggleMute()}
            onTogglePartyReady={() => voiceChatService.setReady(!voiceState.ready)}
            onLeaveVoiceParty={() => voiceChatService.leaveRoom()}
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
            onSpectateMatch={handleSpectateTarget}
            onLeaveChannel={handleLeaveFightcadeChannel}
          />
        ) : (
          <PlatformCatalogView
            mode={platformMode}
            onLaunchStage={handleLaunchStage}
            onCacheChanged={refreshPlatformCache}
            onJoinChannel={handleJoinFightcadeChannel}
            onRequireCoin={requireAndConsumeCoin}
            onCatalogLoaded={handleCatalogLoaded}
          />
        )}
      </div>

      {/* Modale Login / Sign-Up / Profil Firebase CSW Arcade */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        userProfile={userProfile}
        activeChannels={activeChannels}
      />

      {/* Panneau Amis & Social CSW Arcade */}
      <FriendsDrawer
        isOpen={isFriendsOpen}
        onClose={() => setIsFriendsOpen(false)}
        userProfile={userProfile}
        friendsState={friendsState}
        activeChannels={activeChannels}
        unreadByPeer={voiceState.unreadByPeer}
        initialChatFriend={activeDmFriend}
        voiceState={voiceState}
        onInviteVoiceFriend={handleInviteVoiceFriend}
        onJoinFriendParty={handleJoinUserParty}
        onChallengeFriend={(friend, gameCandidate) => {
          const entry = gameCandidate?.entry || gameCandidate;
          if (!entry) return;
          setIsFriendsOpen(false);
          handleChallengePlayer(
            {
              gameId: normalizeGameChannelId(entry),
              title: entry.title || gameCandidate?.title || 'Jeu Arcade',
              entry,
            },
            { ...friend, name: friend.displayName || friend.name }
          );
        }}
        onJoinFriendGameChannel={(gameCandidate) => {
          const entry = gameCandidate?.entry || gameCandidate;
          if (!entry) return;
          setIsFriendsOpen(false);
          handleJoinFightcadeChannel(entry);
        }}
        onSpectateFriend={(friend) => {
          setIsFriendsOpen(false);
          handleSpectateTarget({ isGlobal: true }, friend);
        }}
      />

      {/* Sas de Synchronisation Multijoueur (Match Room) */}
      <MatchSyncModal
        isOpen={Boolean(activeMatchSync)}
        challenge={activeMatchSync?.challenge}
        isHost={activeMatchSync?.isHost}
        userProfile={userProfile}
        onLaunchMatch={handleLaunchMatchFromSync}
        onCancel={() => setActiveMatchSync(null)}
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
              {ENABLE_DEV_TEST_COINS ? (
                <button
                  type="button"
                  onClick={() => {
                    addCoins(10);
                    setNoCoinsModalOpen(false);
                  }}
                  className="py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black"
                >
                  +10 Coins (Test Gratuit)
                </button>
              ) : (
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
              )}
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

      {/* Les overlays Défi Entrant & Reprise Multi-Appareils sont regroupés dans la pile flottante ci-dessus */}

      {/* Paramètres Unifiés (Contrôles, Vidéo, Audio, BIOS, CSW Arcade & Cache) */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        platformMode={platformMode}
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
        updateUiSetting={updateUiSetting}
        updateVoiceSetting={updateVoiceSetting}
        onCacheCleared={refreshPlatformCache}
        resetToDefaults={resetToDefaults}
      />

      {bootNotice && (
        <div className="fixed bottom-20 md:bottom-14 left-1/2 -translate-x-1/2 z-[125] px-4 py-2 rounded-xl bg-neutral-900/95 border border-cyan-500/50 text-cyan-200 text-xs font-mono shadow-2xl max-w-[92%] text-center">
          {bootNotice}
        </div>
      )}

      {exitToastVisible && (
        <div className="fixed bottom-20 md:bottom-14 left-1/2 -translate-x-1/2 z-[140] px-4 py-2 rounded-xl bg-neutral-900/95 border border-white/20 text-white text-xs font-semibold shadow-2xl max-w-[90%] text-center">
          Appuyez encore sur Retour pour quitter l&apos;application
        </div>
      )}

      {/* Toast non-intrusif Message Privé (DM) hors jeu */}
      {!stageSession && dmToast && !isFriendsOpen && (
        <button
          type="button"
          onClick={() => {
            const matched =
              friendsState.friends.find((f) => f.uid === dmToast.fromUid) || {
                uid: dmToast.fromUid,
                displayName: dmToast.fromName,
                name: dmToast.fromName,
                photoURL: dmToast.fromPhotoURL || null,
                isOnline: true,
              };
            setDmToast(null);
            setActiveDmFriend(matched);
            setIsFriendsOpen(true);
          }}
          className="fixed top-20 right-3 z-[155] max-w-xs rounded-2xl bg-neutral-900/95 backdrop-blur-md border-2 u-accent-border px-3.5 py-2.5 shadow-2xl text-left space-y-0.5 cursor-pointer"
        >
          <div className="text-[11px] font-black u-accent-text truncate">
            💬 Message privé · {dmToast.fromName}
          </div>
          <div className="text-xs text-neutral-100 line-clamp-2">{dmToast.text}</div>
        </button>
      )}

      {/* Pilule Vocale Non-Intrusive CSW Arcade (Hors-Jeu / Salon) */}
      {!stageSession && (
        <VoicePartyPill
          voiceState={voiceState}
          micMode={settings?.voice?.micMode || 'open'}
          onToggleMute={() => voiceChatService.toggleMute()}
          onLeave={() => voiceChatService.leaveRoom()}
          onChangeChannel={(ch) => voiceChatService.setChannel(ch)}
          onTogglePeerMute={(uid) => voiceChatService.togglePeerMute(uid)}
          onPttChange={(pressed) => voiceChatService.setPushToTalkPressed(pressed)}
          onAcceptInvite={handleAcceptVoiceInvite}
          onDismissInvite={() => voiceChatService.dismissInvite()}
        />
      )}

      {/* Lecteur Unifié EmulatorJS / J2ME */}
      <UnifiedStageModal
        session={stageSession}
        settings={settings}
        p2pEngine={p2pEngineRef.current}
        p2pStats={settings?.netplay?.showHud === false ? null : p2pStats}
        activeChannels={activeChannels}
        voiceState={voiceState}
        onToggleVoiceMute={() => voiceChatService.toggleMute()}
        onVoicePttChange={(pressed) => voiceChatService.setPushToTalkPressed(pressed)}
        onAcceptVoiceInvite={handleAcceptVoiceInvite}
        onDismissVoiceInvite={() => voiceChatService.dismissInvite()}
        incomingChallenge={
          incomingChallenge && incomingChallenge.fromUid !== userProfile?.uid && !activeMatchSync
            ? incomingChallenge
            : null
        }
        onRespondChallenge={handleRespondChallenge}
        onCloudCheckpoint={(stateBase64) => {
          const uid = userProfileRef.current?.uid;
          const curSess = stageSessionRef.current;
          if (!uid || !curSess) return;
          const gid = normalizeGameChannelId(activeGameEntryRef.current || { id: curSess.gameId, title: curSess.title });
          const targetEntry = activeGameEntryRef.current || curSess;
          const canMulti = !isJ2meGame(targetEntry) && supportsOnlineMultiplayer(targetEntry);
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
                inSalon: canMulti,
                status: 'playing',
                hasSavestate: true,
              });
            }
          });
        }}
        onOpenSalon={() => {
          const currentEntry = activeGameEntryRef.current || stageSession;
          const targetId = supportsOnlineMultiplayer(currentEntry)
            ? stageSession?.gameId || activeChannels[0]?.gameId || GLOBAL_CHANNEL_ID
            : GLOBAL_CHANNEL_ID;
          handleCloseStage();
          setSelectedChannelId(targetId);
        }}
        onInputDelayChange={(d) => p2pEngineRef.current?.setInputDelay(d)}
        onUpdateVideoSetting={updateVideoSetting}
        onClose={handleCloseStage}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
    </div>
  );
}
