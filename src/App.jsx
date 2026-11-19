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
import { addCoins, consumeCoin, fillMaxCoins, hasCoins, subscribeWallet } from './services/walletService';
import { firebaseFightcadeService, playChallengeSound } from './services/firebaseFightcadeService';
import { RollbackP2PEngine } from './services/rollbackP2P';
import {
  Gamepad2, Disc, Cpu, Coffee, Settings, Joystick, Coins, Monitor, Box, Layers, Swords
} from 'lucide-react';

const SHELL_MODES = [
  { id: 'all', label: 'Tous les jeux', subtitle: 'Game Mode Unifié · Tous Univers', icon: Layers },
  { id: 'arcade', label: 'Arcade / Neo Geo', subtitle: 'Neo Geo MVS · MAME 2003-Plus · Rollback P2P', icon: Joystick },
  { id: 'playstation', label: 'PlayStation', subtitle: 'PS1 (Web HLE) · Téléchargement Auto CHD', icon: Disc },
  { id: 'nintendo', label: 'Nintendo', subtitle: 'NES · SNES · GB · GBC · GBA · Nintendo 64', icon: Gamepad2 },
  { id: 'sega', label: 'Sega', subtitle: 'Mega Drive / Genesis · Master System · Game Gear', icon: Cpu },
  { id: 'xbox', label: 'Xbox', subtitle: 'Xbox & Xbox 360 · Salons & ISO', icon: Box },
  { id: 'pc', label: 'PC / DOS', subtitle: 'MS-DOS · js-dos WebAssembly', icon: Monitor },
  { id: 'java', label: 'Mobile / J2ME', subtitle: 'J2ME (.jar) · Gameloft Classics', icon: Coffee },
];

export default function App() {
  const {
    settings,
    updateKeyBinding,
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

  const [platformMode, setPlatformMode] = useState(() => {
    if (typeof window === 'undefined') return 'arcade';
    const m = new URLSearchParams(window.location.search).get('mode');
    return SHELL_MODES.some((sm) => sm.id === m) ? m : 'arcade';
  });

  const [stageSession, setStageSession] = useState(null);
  const [cacheStats, setCacheStats] = useState({ count: 0, totalBytes: 0 });
  const [coins, setCoins] = useState(0);
  const [buyMenuOpen, setBuyMenuOpen] = useState(false);
  const [noCoinsModalOpen, setNoCoinsModalOpen] = useState(false);

  // Fightcade 2 : 3 salons actifs max, défis 15s & WebRTC Rollback P2P
  const [activeChannels, setActiveChannels] = useState([]);
  const [selectedChannelId, setSelectedChannelId] = useState(null);
  const [limitModalGame, setLimitModalGame] = useState(null);
  const [incomingChallenge, setIncomingChallenge] = useState(null);
  const [p2pStats, setP2pStats] = useState(null);
  const [bootNotice, setBootNotice] = useState('');
  const p2pEngineRef = useRef(null);

  const launchEntryWithRom = async (
    gameEntry,
    { isNetplay = false, isHost = true, playerIndex = 0, badgeSuffix = 'LOCAL', refundCoinOnFail = true } = {}
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
      setStageSession({
        kind: core === 'j2me' ? 'j2me' : 'emu',
        title: gameEntry.title || 'CSW Game',
        filename: fileBlob.name || gameEntry.filename || '',
        badge: `${core.toUpperCase()} · ${badgeSuffix}`,
        core,
        fileBlob,
        gameUrl: gameEntry.urls?.[0] || '',
        isNetplay,
        isHost,
        playerIndex,
        accent: '#00f0ff',
      });
    } catch {
      markRomAsDead(gameEntry.id);
      if (refundCoinOnFail) addCoins(1);
      if (selectedChannelId === gameEntry.id) setSelectedChannelId(null);
      setBootNotice(`ROM indisponible (« ${gameEntry.title} ») : jeu supprimé de la liste (Coin remboursé).`);
      setTimeout(() => setBootNotice(''), 4200);
    }
  };

  const requireAndConsumeCoin = () => {
    if (!hasCoins(1)) {
      setNoCoinsModalOpen(true);
      return false;
    }
    const res = consumeCoin(1);
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
    if (!hasCoins(1)) {
      setNoCoinsModalOpen(true);
      return;
    }
    const challengeId = await firebaseFightcadeService.sendChallenge(channel.gameId, targetUser, channel.entry);
    const unsub = firebaseFightcadeService.subscribeChallenge(challengeId, (ch) => {
      if (ch.status === 'accepted') {
        unsub();
        if (!requireAndConsumeCoin()) return;
        startRollbackP2PMatch({ challengeId, isHost: true, gameEntry: channel.entry });
      }
    });
  };

  const handleRespondChallenge = async (accept) => {
    if (!incomingChallenge) return;
    const ch = incomingChallenge;
    if (accept && !requireAndConsumeCoin()) return;
    setIncomingChallenge(null);
    await firebaseFightcadeService.respondChallenge(ch.challengeId, accept);
    if (accept) {
      const channel = activeChannels.find((c) => c.gameId === ch.gameId);
      await startRollbackP2PMatch({
        challengeId: ch.challengeId,
        isHost: false,
        gameEntry: channel?.entry || { id: ch.gameId, title: ch.gameTitle },
      });
    }
  };

  const refreshPlatformCache = () => {
    getPlatformCacheStats().then(setCacheStats).catch(() => {});
  };

  useEffect(() => {
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
      if (e.altKey && ['1', '2', '3', '4', '5', '6', '7', '8'].includes(e.key)) {
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
      unsubW();
      unsubC();
      unsubCh();
      window.removeEventListener('keydown', onKey);
    };
  }, [isSettingsOpen, settings?.netplay?.challengeSound]);

  const currentModeMeta = SHELL_MODES.find((m) => m.id === platformMode) || SHELL_MODES[0];

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-neutral-950 font-sans text-neutral-100">
      {/* Topbar Unifiée Game Mode */}
      <header className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-neutral-950/95 border-b border-neutral-800 shrink-0 z-30">
        <div className="flex items-center gap-2.5">
          <img src="./icons/icon-192.png" alt="CSW Arcade" className="w-8 h-8 rounded-lg" />
          <div>
            <div className="font-black tracking-wider text-sm text-white">
              CSW<span className="text-cyan-400">.</span>ARCADE
            </div>
            <div className="text-[10px] font-mono text-neutral-400 hidden sm:block">
              {currentModeMeta.subtitle}
            </div>
          </div>
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Univers de jeux">
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
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors shrink-0 ${
                  active
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/50'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-900 border border-transparent'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{m.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 relative">
          {/* Portefeuille Coins (0-99) + Bouton Test */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setBuyMenuOpen((v) => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono font-bold transition-colors ${
                coins <= 0
                  ? 'bg-rose-950/60 border-rose-500/60 text-rose-300 animate-pulse'
                  : 'bg-amber-950/40 border-amber-500/40 text-amber-300 hover:bg-amber-950/70'
              }`}
              title="Portefeuille Coins (0-99)"
            >
              <Coins className="w-3.5 h-3.5" />
              <span>{String(coins).padStart(2, '0')}/99 COINS</span>
              <span className="hidden md:inline text-[10px] px-1.5 py-0.5 rounded bg-amber-500 text-black font-black">
                + Acheter (Test)
              </span>
            </button>

            {buyMenuOpen && (
              <div className="absolute right-0 mt-2 w-60 rounded-xl bg-neutral-900 border border-amber-500/40 p-3 shadow-2xl z-50 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-amber-300">Portefeuille Test</span>
                  <span className="font-mono text-white">{coins} / 99</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {[1, 5, 10].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => addCoins(amt)}
                      className="py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-black"
                    >
                      +{amt}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => fillMaxCoins()}
                    className="py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black"
                  >
                    Max
                  </button>
                </div>
              </div>
            )}
          </div>

          <span className="hidden xl:inline px-2.5 py-1 rounded-full bg-neutral-900 border border-neutral-800 text-[11px] font-mono text-neutral-300">
            Cache : {cacheStats.count} · {formatBytes(cacheStats.totalBytes)}
          </span>
          <span
            className={`px-2 py-1 rounded-full border text-[11px] font-mono ${
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
      </header>

      {/* Corps Unifié : Dock 3 Salons Fightcade 2 + Vue Active */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        <FightcadeChannelsDock
          activeChannels={activeChannels}
          selectedChannelId={selectedChannelId}
          onSelectLibrary={() => setSelectedChannelId(null)}
          onSelectChannel={(id) => setSelectedChannelId(id)}
          onLeaveChannel={handleLeaveFightcadeChannel}
          limitModalGame={limitModalGame}
          onCloseLimitModal={() => setLimitModalGame(null)}
          onReplaceChannel={handleReplaceFightcadeChannel}
        />

        {selectedChannelId && activeChannels.find((c) => c.gameId === selectedChannelId) ? (
          <FightcadeLobbyView
            channel={activeChannels.find((c) => c.gameId === selectedChannelId)}
            onChallengePlayer={handleChallengePlayer}
            onTestLocal={(entry) => {
              if (!requireAndConsumeCoin()) return;
              launchEntryWithRom(entry, {
                isNetplay: false,
                isHost: true,
                playerIndex: 0,
                badgeSuffix: 'TRAINING',
              });
            }}
            onSpectateMatch={(channel, targetUser) => {
              launchEntryWithRom(channel.entry, {
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
            onLaunchStage={setStageSession}
            onCacheChanged={refreshPlatformCache}
            onJoinChannel={handleJoinFightcadeChannel}
            onRequireCoin={requireAndConsumeCoin}
          />
        )}
      </div>

      {/* Modale Crédits Insuffisants (0 Coin) */}
      {noCoinsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-neutral-900 border border-rose-500/50 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <Coins className="w-7 h-7 text-amber-400 shrink-0" />
              <div>
                <h3 className="text-sm font-black text-white">Crédits insuffisants (0 Coin)</h3>
                <p className="text-xs text-neutral-300 mt-1">
                  Achetez des coins dans le salon pour démarrer une partie ou lancer un défi.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  addCoins(5);
                  setNoCoinsModalOpen(false);
                }}
                className="py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-black"
              >
                +5 Coins (Test)
              </button>
              <button
                type="button"
                onClick={() => {
                  fillMaxCoins();
                  setNoCoinsModalOpen(false);
                }}
                className="py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black"
              >
                Max 99 Coins
              </button>
              <button
                type="button"
                onClick={() => setNoCoinsModalOpen(false)}
                className="py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-bold"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale Défi Entrant Fightcade 2 (15s) */}
      {incomingChallenge && (
        <div className="fixed bottom-6 right-6 z-50 w-80 rounded-2xl bg-neutral-900 border-2 border-cyan-400 p-4 shadow-2xl space-y-3 animate-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2 text-cyan-300 font-black text-xs uppercase">
            <Swords className="w-4 h-4 animate-pulse" />
            <span>Défi Fightcade 2 reçu !</span>
          </div>
          <p className="text-xs text-neutral-200">
            <strong>{incomingChallenge.fromName}</strong> vous défie sur <strong>{incomingChallenge.gameTitle}</strong> (1 Coin requis).
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleRespondChallenge(true)}
              className="flex-1 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black"
            >
              Accepter (1 Coin)
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

      {/* Paramètres Unifiés (Contrôles, Vidéo, Audio, BIOS, Fightcade 2 & Cache) */}
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
        updatePerformanceSetting={updatePerformanceSetting}
        updateNetplaySetting={updateNetplaySetting}
        onCacheCleared={refreshPlatformCache}
        resetToDefaults={resetToDefaults}
      />

      {bootNotice && (
        <div className="fixed bottom-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-neutral-900/95 border border-cyan-500/50 text-cyan-200 text-xs font-mono shadow-2xl">
          {bootNotice}
        </div>
      )}

      {/* Lecteur Unifié EmulatorJS / J2ME */}
      <UnifiedStageModal
        session={stageSession}
        settings={settings}
        p2pEngine={p2pEngineRef.current}
        p2pStats={settings?.netplay?.showHud === false ? null : p2pStats}
        onInputDelayChange={(d) => p2pEngineRef.current?.setInputDelay(d)}
        onClose={() => {
          p2pEngineRef.current?.destroy();
          p2pEngineRef.current = null;
          setP2pStats(null);
          setStageSession(null);
          if (selectedChannelId) {
            firebaseFightcadeService.upsertPresence(selectedChannelId, 'available');
          }
        }}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
    </div>
  );
}
