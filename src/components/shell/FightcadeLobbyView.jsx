import React, { useEffect, useRef, useState } from 'react';
import {
  Swords, Eye, Send, Play, LogOut, Wifi, UserCheck, Globe, Megaphone, Sparkles, Gamepad2, Trophy, MessageSquare, Users, UserPlus, Check, Clock, Terminal, PhoneCall, Mic, MicOff, Crown, PhoneOff
} from 'lucide-react';
import {
  firebaseFightcadeService,
  getPlayerIdentity,
  GLOBAL_CHANNEL_ID,
} from '../../services/firebaseFightcadeService';
import { getRankTierMeta, subscribeGameLeaderboard } from '../../services/scoreRankingService';
import { acceptFriendRequest, sendFriendRequest } from '../../services/friendsService';
import { countryCodeToFlag } from '../../data/countries';
import { GameCover } from './GameCover';
import { PlayerAvatar } from '../common/PlayerAvatar';
import { CountryFlagBadge, FightcadePingIndicator } from '../common/PlayerNetBadges';
import { supportsOnlineMultiplayer } from '../../utils/gameCapabilities';

const RANK_BADGE_STYLE = {
  'S+': 'bg-gradient-to-r from-amber-600/40 to-rose-600/40 text-rose-200 border-rose-400',
  S: 'bg-amber-500/20 text-amber-300 border-amber-500/50',
  A: 'bg-purple-500/20 text-purple-300 border-purple-500/50',
  B: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50',
  C: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50',
  D: 'bg-neutral-800 text-neutral-300 border-neutral-700',
};

function PingBars({ ping = 25 }) {
  const color = ping < 50 ? 'bg-emerald-400' : ping < 110 ? 'bg-amber-400' : 'bg-rose-500';
  const bars = ping < 50 ? 3 : ping < 110 ? 2 : 1;
  return (
    <span className="inline-flex items-end gap-0.5 h-3" title={`Ping estimé : ${ping} ms`}>
      {[1, 2, 3].map((b) => (
        <span
          key={b}
          className={`w-1 rounded-sm ${b <= bars ? color : 'bg-neutral-700'}`}
          style={{ height: `${b * 4}px` }}
        />
      ))}
    </span>
  );
}

function formatTime(ms) {
  if (!ms) return '';
  try {
    const d = new Date(ms);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function FightcadeLobbyView({
  channel,
  activeChannels = [],
  userProfile = null,
  friendsState = { friends: [], incomingRequests: [], outgoingRequests: [] },
  voiceState = null,
  onJoinUserParty,
  onToggleVoiceMute,
  onTogglePartyReady,
  onLeaveVoiceParty,
  onChallengePlayer,
  onTestLocal,
  onLeaveChannel,
  onSpectateMatch,
  onSelectChannel,
  onOpenAuth,
}) {
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [rightTab, setRightTab] = useState('users'); // 'users' | 'scores'
  const [mobilePanel, setMobilePanel] = useState('chat'); // 'chat' | 'users' | 'scores'
  const [chatFilter, setChatFilter] = useState('all'); // 'all' | 'chat' | 'system'
  const [chatInput, setChatInput] = useState('');
  const [pendingChallengeId, setPendingChallengeId] = useState(null);
  const [peerPings, setPeerPings] = useState({});
  const chatEndRef = useRef(null);
  const me = getPlayerIdentity();
  const isGlobal = channel?.gameId === GLOBAL_CHANNEL_ID || channel?.isGlobal;

  useEffect(() => firebaseFightcadeService.subscribePeerPings(setPeerPings), []);

  useEffect(() => {
    const peerUids = users.map((u) => u?.uid).filter((id) => id && id !== me.uid);
    if (peerUids.length === 0) return undefined;
    firebaseFightcadeService.probePeersPing(peerUids);
    const id = setInterval(() => {
      firebaseFightcadeService.probePeersPing(peerUids);
    }, 10000);
    return () => clearInterval(id);
  }, [users, me.uid]);

  useEffect(() => {
    if (!channel?.gameId) return;
    setRightTab('users');
    setMobilePanel('chat');
    const unsubUsers = firebaseFightcadeService.subscribeChannelUsers(channel.gameId, setUsers);
    const unsubMsgs = firebaseFightcadeService.subscribeChannelMessages(channel.gameId, setMessages);
    let unsubLb = null;
    if (!isGlobal) {
      unsubLb = subscribeGameLeaderboard(channel.gameId, setLeaderboard);
    } else {
      setLeaderboard([]);
    }
    return () => {
      unsubUsers?.();
      unsubMsgs?.();
      unsubLb?.();
    };
  }, [channel?.gameId, isGlobal]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendChat = async (e) => {
    e.preventDefault();
    const raw = chatInput.trim();
    if (!raw) return;
    setChatInput('');

    // Commandes slash CSW Arcade
    if (raw.toLowerCase() === '/gg') {
      await firebaseFightcadeService.sendMessage(channel.gameId, '🏆 GG ! Bien joué !', 'chat');
      return;
    }
    if (raw.toLowerCase() === '/afk') {
      await firebaseFightcadeService.setCustomStatus('afk');
      await firebaseFightcadeService.sendMessage(
        channel.gameId,
        `⚪ ${me.name} est passé en mode AFK.`,
        'system'
      );
      return;
    }
    if (raw.toLowerCase() === '/ready') {
      await firebaseFightcadeService.setCustomStatus('available');
      const games = activeChannels.map((c) => c.title).join(', ') || channel.title;
      await firebaseFightcadeService.sendMessage(
        channel.gameId,
        `🟢 ${me.name} est au salon et prêt à jouer sur : ${games} !`,
        'system'
      );
      return;
    }

    await firebaseFightcadeService.sendMessage(channel.gameId, raw, 'chat');
  };

  const handleAnnounceActiveGames = async () => {
    const games =
      activeChannels.map((c) => c.title).join(' · ') ||
      (!isGlobal ? channel.title : 'Tous les jeux');
    await firebaseFightcadeService.setCustomStatus('available');
    await firebaseFightcadeService.sendMessage(
      channel.gameId,
      `📢 Au salon et actif pour jouer sur : [ ${games} ] — Envoyez un défi ⚔️ !`,
      'chat'
    );
  };

  const handleChallenge = async (u, targetGameOverride = null) => {
    let resolvedEntry = null;
    let targetGid = null;
    let targetTitle = null;
    let targetPlatform = 'Arcade';

    if (!isGlobal && channel && channel.entry) {
      // Dans le salon d'un jeu précis (ex: Street Fighter II) : toujours prioriser le jeu du salon courant !
      targetGid = channel.gameId;
      targetTitle = channel.title;
      targetPlatform = channel.platformLabel || 'Arcade';
      resolvedEntry = channel.entry;
    } else if (targetGameOverride) {
      targetGid = targetGameOverride.gameId || targetGameOverride.id;
      targetTitle = targetGameOverride.title;
      targetPlatform = targetGameOverride.platformLabel || 'Arcade';
      resolvedEntry =
        targetGameOverride.entry ||
        activeChannels.find((c) => c.gameId === targetGid)?.entry ||
        (channel?.gameId === targetGid ? channel.entry : null) ||
        targetGameOverride;
    } else {
      targetGid = channel.gameId;
      targetTitle = channel.title;
      targetPlatform = channel.platformLabel || 'Arcade';
      resolvedEntry = channel.entry;
    }

    if (!resolvedEntry || !supportsOnlineMultiplayer(resolvedEntry)) {
      const fallbackActive = activeChannels.find((c) => c.entry && supportsOnlineMultiplayer(c.entry));
      if (fallbackActive) {
        targetGid = fallbackActive.gameId;
        targetTitle = fallbackActive.title;
        targetPlatform = fallbackActive.platformLabel || 'Arcade';
        resolvedEntry = fallbackActive.entry;
      } else {
        return;
      }
    }

    if (!supportsOnlineMultiplayer(resolvedEntry)) return;

    setPendingChallengeId(u.uid);
    const targetChannel = {
      gameId: targetGid,
      title: targetTitle,
      platformLabel: targetPlatform,
      entry: resolvedEntry,
    };
    await onChallengePlayer(targetChannel, u);
    setTimeout(() => setPendingChallengeId(null), 15000);
  };

  const handleMentionUser = (name) => {
    if (!name) return;
    setChatInput((prev) => `${prev ? prev + ' ' : ''}@${name} `);
  };

  const isSystemMsg = (m) => m?.type === 'system' || m?.type === 'challenge';
  const realChatCount = messages.filter((m) => !isSystemMsg(m)).length;
  const systemMsgCount = messages.length - realChatCount;
  const filteredMessages =
    chatFilter === 'chat'
      ? messages.filter((m) => !isSystemMsg(m))
      : chatFilter === 'system'
      ? messages.filter((m) => isSystemMsg(m))
      : messages;

  return (
    <div className="flex-1 min-w-0 w-full max-w-full flex flex-col min-h-0 overflow-x-hidden bg-transparent text-neutral-100 pb-16 md:pb-0">
      {/* En-tête du salon CSW Arcade — Zéro débordement sur mobile/tablette, thématisé par console */}
      <div className="u-banner w-full min-w-0 flex flex-col gap-2.5 px-3 md:px-4 py-2.5 md:py-3 backdrop-blur-md border-b shrink-0 overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {isGlobal ? (
              <div className="w-11 h-11 md:w-12 md:h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shrink-0">
                <Globe className="w-5 h-5 md:w-6 md:h-6" aria-hidden="true" />
              </div>
            ) : (
              <div className="shrink-0">
                <GameCover
                  title={channel.title}
                  platformLabel={channel.platformLabel}
                  filename={channel.filename}
                  compact
                />
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <h2 className="text-sm sm:text-base font-black text-white leading-tight line-clamp-2">
                {channel.title}
              </h2>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border whitespace-nowrap ${
                    isGlobal
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-700/60'
                      : 'u-badge'
                  }`}
                >
                  {channel.platformLabel}
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950/70 text-emerald-300 border border-emerald-500/40 tabular-nums whitespace-nowrap">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" aria-hidden="true" />
                  <span>{users.length} en ligne</span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <button
              type="button"
              onClick={handleAnnounceActiveGames}
              title="Publier dans le chat que vous êtes au salon et prêt à jouer sur vos jeux sélectionnés"
              className="arcade-focus-ring flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] lg:min-h-[38px] rounded-xl u-tab-active text-xs font-bold transition-colors whitespace-nowrap"
            >
              <Megaphone className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="sm:hidden">Annoncer</span>
              <span className="hidden sm:inline">Annoncer mes jeux actifs</span>
            </button>

            {!isGlobal && channel.entry && (
              <button
                type="button"
                onClick={() => onTestLocal(channel.entry)}
                className="arcade-focus-ring flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[44px] lg:min-h-[38px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black transition-colors whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="sm:hidden">Jouer</span>
                <span className="hidden sm:inline">Jouer / Training</span>
              </button>
            )}

            {!isGlobal && (
              <button
                type="button"
                onClick={() => onLeaveChannel(channel.gameId)}
                title="Quitter ce salon"
                className="arcade-focus-ring flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] lg:min-h-[38px] rounded-xl bg-neutral-900 hover:bg-rose-950 border border-white/15 text-neutral-100 hover:text-rose-200 text-xs font-bold transition-colors whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Quitter</span>
              </button>
            )}
          </div>
        </div>

        {/* Barre indiquant les jeux sélectionnés où vous êtes actif — Scroll fluide dans la largeur exacte */}
        <div className="relative w-full min-w-0 overflow-hidden">
          <div className="flex items-center gap-1.5 w-full overflow-x-auto no-scrollbar text-[11px] pb-0.5 pr-7">
            <span className="font-mono text-neutral-300 shrink-0">Vos jeux actifs :</span>
            {activeChannels.length === 0 ? (
              <span className="text-neutral-300 font-mono truncate">
                Aucun jeu sélectionné (lancez un jeu ou cliquez sur Salon dans le catalogue)
              </span>
            ) : (
              activeChannels.map((ch) => (
                <button
                  key={ch.gameId}
                  type="button"
                  onClick={() => onSelectChannel?.(ch.gameId)}
                  className={`arcade-focus-ring inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[34px] rounded-lg font-bold text-[11px] border shrink-0 transition-colors ${
                    ch.gameId === channel.gameId
                      ? 'u-btn-primary'
                      : 'bg-neutral-900/90 hover:bg-neutral-800 text-neutral-100 border-white/15'
                  }`}
                >
                  <Gamepad2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="max-w-[200px] truncate">{ch.title}</span>
                </button>
              ))
            )}
          </div>
          <div
            className="pointer-events-none absolute right-0 top-0 bottom-0 w-7 bg-gradient-to-l from-neutral-950/90 to-transparent"
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Bandeau Groupe Salon CSW Arcade (jusqu'à 6 joueurs + Vocal en direct) */}
      {voiceState?.roomId && (
        <div className="px-3 md:px-4 py-2 bg-neutral-950/85 border-b u-accent-border flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[10px] font-mono font-black shrink-0">
              <Users className="w-3 h-3" aria-hidden="true" />
              <span>
                GROUPE {voiceState.members?.length || 1}/{voiceState.maxMembers || 6}
              </span>
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {Array.from({ length: voiceState.maxMembers || 6 }).map((_, idx) => {
                const member = voiceState.members?.[idx];
                if (!member) {
                  return (
                    <span
                      key={`empty-${idx}`}
                      title="Emplacement libre (6 joueurs max)"
                      className="w-7 h-7 rounded-full border border-dashed border-white/15 bg-white/[0.03] flex items-center justify-center text-[10px] font-mono text-neutral-500"
                    >
                      +
                    </span>
                  );
                }
                const isHostMember = member.uid === voiceState.hostUid;
                return (
                  <div
                    key={member.uid}
                    title={`${member.name}${isHostMember ? ' (Chef)' : ''}${member.ready ? ' · Prêt' : ''}`}
                    className={`relative flex items-center gap-1 pl-0.5 pr-2 py-0.5 rounded-full border text-[10px] font-bold ${
                      member.speaking && !member.muted
                        ? 'bg-emerald-950/60 border-emerald-400 text-emerald-200 ring-1 ring-emerald-400/60'
                        : 'bg-neutral-900 border-white/15 text-neutral-200'
                    }`}
                  >
                    <PlayerAvatar photoURL={member.photoURL} name={member.name} size="xs" />
                    <span className="truncate max-w-[70px]">{member.name}</span>
                    {isHostMember && <Crown className="w-2.5 h-2.5 text-amber-400 shrink-0" aria-hidden="true" />}
                    {member.ready && <Check className="w-2.5 h-2.5 text-emerald-400 shrink-0" aria-hidden="true" />}
                    {member.muted && <MicOff className="w-2.5 h-2.5 text-rose-400 shrink-0" aria-hidden="true" />}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onTogglePartyReady?.()}
              className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-black transition-colors cursor-pointer ${
                voiceState.ready
                  ? 'bg-emerald-500 border-emerald-400 text-black'
                  : 'bg-neutral-800 border-white/15 text-neutral-200 hover:bg-neutral-700'
              }`}
            >
              {voiceState.ready ? 'Prêt ✓' : 'Se mettre prêt'}
            </button>
            <button
              type="button"
              onClick={() => onToggleVoiceMute?.()}
              title={voiceState.muted ? 'Activer le micro' : 'Couper le micro'}
              className={`p-1.5 rounded-xl border transition-colors cursor-pointer ${
                voiceState.muted
                  ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                  : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
              }`}
            >
              {voiceState.muted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => onLeaveVoiceParty?.()}
              title="Quitter le groupe vocal"
              className="p-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/35 border border-rose-500/40 text-rose-300 cursor-pointer"
            >
              <PhoneOff className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Onglets Mobile & Tablette (< lg) : bascule plein écran entre Chat / Joueurs / Records */}
      <div className="lg:hidden w-full min-w-0 grid grid-cols-3 border-b border-white/10 bg-neutral-900/60 text-xs font-bold shrink-0">
        <button
          type="button"
          onClick={() => setMobilePanel('chat')}
          className={`arcade-focus-ring flex items-center justify-center gap-1.5 py-2.5 min-h-[44px] border-b-2 transition-colors ${
            mobilePanel === 'chat'
              ? 'u-accent-border u-accent-text bg-white/5'
              : 'border-transparent text-neutral-300'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Chat</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setMobilePanel('users');
            setRightTab('users');
          }}
          className={`arcade-focus-ring flex items-center justify-center gap-1.5 py-2.5 min-h-[44px] border-b-2 transition-colors tabular-nums ${
            mobilePanel === 'users'
              ? 'border-emerald-400 text-emerald-300 bg-emerald-950/25'
              : 'border-transparent text-neutral-300'
          }`}
        >
          <Users className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Joueurs ({users.length})</span>
        </button>
        {!isGlobal ? (
          <button
            type="button"
            onClick={() => {
              setMobilePanel('scores');
              setRightTab('scores');
            }}
            className={`arcade-focus-ring flex items-center justify-center gap-1.5 py-2.5 min-h-[44px] border-b-2 transition-colors tabular-nums ${
              mobilePanel === 'scores'
                ? 'border-amber-400 text-amber-300 bg-amber-950/25'
                : 'border-transparent text-neutral-300'
            }`}
          >
            <Trophy className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Records ({leaderboard.length})</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleAnnounceActiveGames}
            className="arcade-focus-ring flex items-center justify-center gap-1.5 py-2.5 min-h-[44px] border-b-2 border-transparent text-cyan-300 active:bg-cyan-950/30"
          >
            <Megaphone className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Dispo</span>
          </button>
        )}
      </div>

      {/* Corps : Chat Communautaire en direct + Liste des joueurs et leurs jeux actifs */}
      <div className="flex-1 w-full min-w-0 grid grid-cols-1 lg:grid-cols-3 min-h-0 overflow-hidden">
        {/* Chat Communautaire du salon */}
        <div
          className={`${
            mobilePanel === 'chat' ? 'flex' : 'hidden lg:flex'
          } lg:col-span-2 min-w-0 flex-col min-h-0 lg:border-r border-white/10`}
        >
          <div className="flex flex-wrap px-3 md:px-4 py-1.5 md:py-2 bg-neutral-900/40 border-b border-white/10 items-center justify-between gap-2 text-[10px] md:text-[11px] font-mono">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className="uppercase tracking-wider text-neutral-300 font-bold truncate">
                #{channel.gameId}
              </span>
              {/* Filtre rapide : Tous / Chat réel / Système */}
              <div
                className="inline-flex items-center rounded-lg bg-black/35 border border-white/10 p-0.5 gap-0.5"
                role="tablist"
                aria-label="Filtrer les messages du salon"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={chatFilter === 'all'}
                  onClick={() => setChatFilter('all')}
                  className={`px-2 py-1 rounded-md text-[10px] font-sans font-bold transition-colors tabular-nums ${
                    chatFilter === 'all'
                      ? 'u-tab-active'
                      : 'text-neutral-300 hover:text-white'
                  }`}
                >
                  Tous ({messages.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={chatFilter === 'chat'}
                  onClick={() => setChatFilter('chat')}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-sans font-bold transition-colors tabular-nums ${
                    chatFilter === 'chat'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'text-neutral-300 hover:text-white border border-transparent'
                  }`}
                >
                  <MessageSquare className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span>Chat réel ({realChatCount})</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={chatFilter === 'system'}
                  onClick={() => setChatFilter('system')}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-sans font-bold transition-colors tabular-nums ${
                    chatFilter === 'system'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-neutral-300 hover:text-white border border-transparent'
                  }`}
                >
                  <Terminal className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span>Système ({systemMsgCount})</span>
                </button>
              </div>
            </div>
            <span className="hidden sm:inline text-[10px] text-neutral-400 truncate">
              /gg · /ready · /afk · Cliquer un pseudo pour @mentionner
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2.5 sm:p-4 space-y-2 text-xs">
            {filteredMessages.length === 0 ? (
              <div className="text-neutral-400 font-mono text-center py-8 px-4">
                {chatFilter === 'chat'
                  ? 'Aucun message de joueur pour le moment — soyez le premier à dire bonjour ou lancer un match !'
                  : chatFilter === 'system'
                  ? 'Aucun événement système ou défi enregistré dans ce salon.'
                  : `Bienvenue dans le salon ${channel.title}. Dites bonjour, annoncez vos jeux actifs ou défiez un joueur !`}
              </div>
            ) : (
              filteredMessages.map((m) => {
                const isMentioned =
                  m.text && me.name && m.text.toLowerCase().includes(`@${me.name.toLowerCase()}`);
                const isMine = Boolean(m.uid && me.uid && m.uid === me.uid);
                const rankStyle = RANK_BADGE_STYLE[m.rank || 'B'] || RANK_BADGE_STYLE.B;

                /* === MESSAGES SYSTÈME & DÉFIS : discrets, compacts, badge SYSTÈME / DÉFI === */
                if (isSystemMsg(m)) {
                  const isChallenge = m.type === 'challenge';
                  return (
                    <div
                      key={m.id}
                      className={`font-mono text-[11px] px-2.5 py-1.5 rounded-lg border border-dashed flex items-start sm:items-center justify-between gap-2 ${
                        isChallenge
                          ? 'bg-amber-950/25 border-amber-500/35 border-l-2 border-l-amber-400 text-amber-200'
                          : 'bg-white/[0.03] border-white/10 border-l-2 border-l-cyan-500/50 text-neutral-400'
                      }`}
                    >
                      <div className="flex items-start sm:items-center gap-2 min-w-0">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider shrink-0 mt-0.5 sm:mt-0 ${
                            isChallenge
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-white/10 text-neutral-300 border border-white/15'
                          }`}
                        >
                          {isChallenge ? (
                            <Swords className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                          ) : (
                            <Terminal className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                          )}
                          <span>{isChallenge ? 'DÉFI' : 'SYSTÈME'}</span>
                        </span>
                        <span className="min-w-0 break-words leading-snug">{m.text}</span>
                      </div>
                      {m.createdAtMs && (
                        <span className="text-[10px] text-neutral-500 shrink-0 tabular-nums">
                          {formatTime(m.createdAtMs)}
                        </span>
                      )}
                    </div>
                  );
                }

                /* === VRAIS MESSAGES DE JOUEURS : bulles riches avec avatar, bordure accentuée & badge === */
                return (
                  <div
                    key={m.id}
                    className={`px-3 py-2.5 rounded-2xl border border-l-[3px] transition-colors space-y-1.5 shadow-sm ${
                      isMentioned
                        ? 'bg-amber-500/15 border-amber-500/40 border-l-amber-400'
                        : isMine
                        ? 'bg-emerald-950/30 border-emerald-500/30 border-l-emerald-400'
                        : 'bg-neutral-900/75 border-white/10 u-accent-border'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                        <PlayerAvatar
                          photoURL={m.photoURL}
                          name={m.name || 'Joueur'}
                          size="xs"
                        />
                        <button
                          type="button"
                          onClick={() => handleMentionUser(m.name)}
                          className={`text-xs font-black hover:underline truncate ${
                            isMine ? 'text-emerald-300' : 'u-accent-text'
                          }`}
                          title="Cliquer pour mentionner ce joueur"
                        >
                          {m.name}
                        </button>
                        {isMine && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0">
                            MOI
                          </span>
                        )}
                        <span
                          className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-black border shrink-0 ${rankStyle}`}
                        >
                          {m.rank || 'B'}
                        </span>
                        {m.region && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/10 text-neutral-300 shrink-0">
                            {m.region}
                          </span>
                        )}
                        {m.createdAtMs && (
                          <span className="text-[10px] font-mono text-neutral-400 shrink-0 tabular-nums">
                            · {formatTime(m.createdAtMs)}
                          </span>
                        )}
                      </div>
                      {m.currentGameTitle && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/70 border border-emerald-500/30 text-emerald-300 max-w-full truncate">
                          <Gamepad2 className="w-3 h-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{m.currentGameTitle}</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs sm:text-[13px] font-medium text-neutral-100 leading-relaxed break-words pl-7">
                      {m.text}
                    </p>
                  </div>
                );
              })
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Barre de raccourcis communautaires CSW Arcade — 1 ligne scrollable propre */}
          <div className="px-2.5 sm:px-3 py-1.5 border-t border-white/10 bg-neutral-900/40 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
            <button
              type="button"
              onClick={() => firebaseFightcadeService.sendMessage(channel.gameId, 'GG ! Bon match !', 'chat')}
              className="arcade-focus-ring inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-neutral-800/90 hover:bg-neutral-700 border border-white/5 text-[11px] font-mono text-amber-300 shrink-0"
            >
              <Trophy className="w-3 h-3 shrink-0" aria-hidden="true" />
              <span>GG !</span>
            </button>
            <button
              type="button"
              onClick={handleAnnounceActiveGames}
              className="arcade-focus-ring inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-neutral-800/90 hover:bg-neutral-700 border border-white/5 text-[11px] font-mono text-cyan-300 shrink-0"
            >
              <Swords className="w-3 h-3 shrink-0" aria-hidden="true" />
              <span>Dispo match</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                await firebaseFightcadeService.setCustomStatus('available');
              }}
              className="arcade-focus-ring inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-800/90 hover:bg-neutral-700 border border-white/5 text-[11px] font-mono text-emerald-300 shrink-0"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" aria-hidden="true" />
              <span>Prêt</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                await firebaseFightcadeService.setCustomStatus('afk');
              }}
              className="arcade-focus-ring inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-800/90 hover:bg-neutral-700 border border-white/5 text-[11px] font-mono text-neutral-300 shrink-0"
            >
              <span className="w-2 h-2 rounded-full bg-neutral-500 shrink-0" aria-hidden="true" />
              <span>AFK</span>
            </button>
            {onOpenAuth && (
              <button
                type="button"
                onClick={onOpenAuth}
                className="arcade-focus-ring ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-950/70 hover:bg-cyan-900/70 border border-cyan-500/30 text-[11px] font-mono text-cyan-200 shrink-0"
              >
                <Sparkles className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span>Profil ({me.name})</span>
              </button>
            )}
          </div>

          <form onSubmit={handleSendChat} className="p-2.5 sm:p-3 border-t border-white/10 bg-neutral-900/60 flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={`Message #${channel.title}…`}
              aria-label={`Message dans ${channel.title}`}
              className="arcade-focus-ring flex-1 px-3 py-2 min-h-[44px] rounded-xl bg-neutral-950 border border-white/15 text-base sm:text-xs text-white placeholder:text-neutral-400"
            />
            <button
              type="submit"
              aria-label="Envoyer le message"
              title="Envoyer le message"
              className="arcade-focus-ring px-4 py-2 min-w-[44px] min-h-[44px] rounded-xl u-btn-primary text-xs font-black flex items-center justify-center gap-1.5 shrink-0"
            >
              <Send className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">Envoyer</span>
            </button>
          </form>
        </div>

        {/* Colonne Droite : Joueurs au salon + Classement Meilleurs Scores du jeu */}
        <div
          className={`${
            mobilePanel !== 'chat' ? 'flex' : 'hidden lg:flex'
          } min-w-0 flex-col min-h-0 bg-neutral-900/20`}
        >
          <div className="hidden lg:flex px-3 py-2 bg-neutral-900/40 border-b border-white/10 items-center justify-between gap-2 text-[11px] font-mono uppercase tracking-wider text-neutral-300">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setRightTab('users')}
                className={`arcade-focus-ring px-2.5 py-1.5 rounded-lg font-bold transition-colors border ${
                  rightTab === 'users'
                    ? 'u-tab-active'
                    : 'border-transparent text-neutral-300 hover:text-white'
                }`}
              >
                Joueurs ({users.length})
              </button>
              {!isGlobal && (
                <button
                  type="button"
                  onClick={() => setRightTab('scores')}
                  className={`px-2 py-1 rounded-lg font-bold flex items-center gap-1 transition-colors ${
                    rightTab === 'scores'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'text-neutral-400 hover:text-amber-300'
                  }`}
                >
                  <Trophy className="w-3 h-3" />
                  <span>Records ({leaderboard.length})</span>
                </button>
              )}
            </div>
            <span className="flex items-center gap-1 text-emerald-400 text-[10px]">
              <Wifi className="w-3 h-3" /> P2P
            </span>
          </div>

          {rightTab === 'scores' && !isGlobal ? (
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {leaderboard.length === 0 ? (
                <div className="p-5 rounded-xl bg-neutral-900/70 border border-neutral-800 text-center text-xs text-neutral-400 space-y-1">
                  <Trophy className="w-6 h-6 text-amber-400 mx-auto mb-1 opacity-70" />
                  <p className="font-bold text-neutral-200">Aucun record enregistré</p>
                  <p className="text-[11px]">
                    Lancez « {channel.title} » : vos scores sont capturés et classés automatiquement depuis la RAM du jeu !
                  </p>
                </div>
              ) : (
                leaderboard.map((row, idx) => {
                  const rowRankMeta = getRankTierMeta(row.rank || 'D');
                  const gameRankMeta = getRankTierMeta(row.gameRank || 'D');
                  return (
                    <div
                      key={row.uid || idx}
                      className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 ${
                        idx === 0
                          ? 'bg-amber-950/35 border-amber-500/50'
                          : 'bg-neutral-900 border-neutral-800'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono font-black text-xs text-amber-400 w-6 shrink-0">
                          #{idx + 1}
                        </span>
                        <PlayerAvatar photoURL={row.photoURL} name={row.displayName} size="xs" />
                        <span className="text-sm shrink-0">{countryCodeToFlag(row.region)}</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`px-1 py-0.2 rounded border text-[9px] font-mono font-black ${rowRankMeta.color}`}>
                              {rowRankMeta.id}
                            </span>
                            <span className="text-xs font-bold text-white truncate">{row.displayName}</span>
                          </div>
                          <div className="text-[10px] font-mono text-neutral-400">
                            {row.gamesPlayed || 1} partie(s) · Rang jeu{' '}
                            <span className="text-cyan-300 font-bold">{gameRankMeta.id}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs font-mono font-black text-amber-300">
                          {(row.bestScore || 0).toLocaleString('fr-FR')}
                        </div>
                        <div className="text-[9px] font-mono text-neutral-300">POINTS</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {users.map((u) => {
                const isMe = u.uid === me.uid;
                const isNetplayMatch = u.status === 'playing';
                const isInGameAvailable = u.status === 'in_game_available' || Boolean(u.currentGame && !isNetplayMatch);
                const isAfk = u.status === 'afk';
                const rankStyle = RANK_BADGE_STYLE[u.rank || 'D'] || RANK_BADGE_STYLE.D;
                const userActiveGames = (Array.isArray(u.activeGames) ? u.activeGames : []).filter((g) =>
                  supportsOnlineMultiplayer(g)
                );
                const challengeCandidate = !isGlobal
                  ? (supportsOnlineMultiplayer(channel?.entry) ? channel : null)
                  : (supportsOnlineMultiplayer(u.currentGame)
                      ? u.currentGame
                      : userActiveGames[0] ||
                        activeChannels.find((c) => c.entry && supportsOnlineMultiplayer(c.entry)) ||
                        null);
                const canChallengeUser = Boolean(challengeCandidate);
                const isFriend = (friendsState?.friends || []).some((f) => f.uid === u.uid);
                const incomingReq = (friendsState?.incomingRequests || []).find((r) => r.fromUid === u.uid);
                const isOutgoingReq = (friendsState?.outgoingRequests || []).some((r) => r.toUid === u.uid);

                return (
                  <div
                    key={u.uid}
                    className={`p-3 rounded-xl border transition-colors space-y-2 ${
                      isInGameAvailable
                        ? 'bg-emerald-950/20 border-emerald-500/40'
                        : 'bg-neutral-900 border-neutral-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0">
                        <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                          <CountryFlagBadge
                            countryCode={u.countryCode}
                            countryName={u.countryName}
                            city={u.city}
                            region={u.region}
                            size={20}
                          />
                          <PlayerAvatar
                            photoURL={u.photoURL}
                            name={u.name}
                            size="sm"
                            status={isNetplayMatch ? 'playing' : isInGameAvailable ? 'in_game_available' : isAfk ? 'afk' : 'available'}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-black border ${rankStyle}`}
                            >
                              {u.rank || 'D'}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleMentionUser(u.name)}
                              className="text-xs font-bold text-white hover:text-cyan-300 truncate"
                            >
                              {u.name} {isMe && '(Vous)'}
                            </button>
                            {!isMe && (
                              <FightcadePingIndicator
                                pingMs={peerPings[u.uid] ?? null}
                                isDirect={Boolean(peerPings.__meta?.[u.uid]?.direct)}
                              />
                            )}
                          </div>

                          {/* Statut précis du joueur */}
                          <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-neutral-300 flex-wrap">
                            {u.countryName && (
                              <>
                                <span className="text-neutral-400">
                                  {u.city ? `${u.countryName} · ${u.city}` : u.countryName}
                                </span>
                                <span>·</span>
                              </>
                            )}
                            {isNetplayMatch ? (
                              <span className="text-amber-300 font-bold">
                                En match P2P {u.currentGame?.title ? `sur ${u.currentGame.title}` : ''}
                              </span>
                            ) : isInGameAvailable ? (
                              <span className="text-emerald-300 font-bold">
                                En jeu &amp; Au salon ({u.currentGame?.title || 'Training'})
                              </span>
                            ) : isAfk ? (
                              <span className="text-neutral-300">AFK</span>
                            ) : (
                              <span className="text-emerald-300">Au salon · Prêt à jouer</span>
                            )}
                          </div>
                        </div>
                      </div>

                    {!isMe && (
                      <div className="flex items-center gap-1 shrink-0">
                        {onJoinUserParty && (
                          <button
                            type="button"
                            onClick={() => onJoinUserParty(u)}
                            title={`Rejoindre le groupe salon & vocal de ${u.name} (max 6 joueurs)`}
                            className="p-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 transition-colors cursor-pointer"
                          >
                            <PhoneCall className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}
                        {isFriend ? (
                          <span
                            title="Déjà dans vos amis"
                            className="p-1.5 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300"
                          >
                            <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          </span>
                        ) : incomingReq ? (
                          <button
                            type="button"
                            onClick={() => acceptFriendRequest(userProfile || me, incomingReq)}
                            title="Accepter la demande d'ami"
                            className="p-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black"
                          >
                            <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        ) : isOutgoingReq ? (
                          <span
                            title="Demande d'ami envoyée"
                            className="p-1.5 rounded-lg bg-neutral-800 text-neutral-400"
                          >
                            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => sendFriendRequest(userProfile || me, { ...u, displayName: u.name })}
                            aria-label={`Ajouter ${u.name} en ami`}
                            title={`Ajouter ${u.name} en ami`}
                            className="p-1.5 rounded-lg bg-neutral-800 hover:bg-cyan-950 border border-neutral-700 hover:border-cyan-500/50 text-cyan-300 transition-colors cursor-pointer"
                          >
                            <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}

                        {isNetplayMatch ? (
                          <div className="flex items-center gap-1 shrink-0">
                            {canChallengeUser && (
                              <button
                                type="button"
                                disabled={pendingChallengeId === u.uid}
                                onClick={() => handleChallenge(u, challengeCandidate)}
                                title="Rejoindre cette partie en cours en tant que joueur supplémentaire (Drop-In)"
                                className="arcade-focus-ring px-2.5 py-1.5 min-h-[36px] rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-[11px] font-black flex items-center gap-1 shrink-0"
                              >
                                <Gamepad2 className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>{pendingChallengeId === u.uid ? 'Envoi…' : 'Rejoindre'}</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onSpectateMatch?.(channel, u)}
                              className="arcade-focus-ring px-2.5 py-1.5 min-h-[36px] rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-white/10 text-neutral-100 text-[11px] font-bold flex items-center gap-1 shrink-0"
                            >
                              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Regarder</span>
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={pendingChallengeId === u.uid || !canChallengeUser}
                            onClick={() => handleChallenge(u, challengeCandidate)}
                            title={
                              isInGameAvailable
                                ? `Rejoindre ${u.name} dans sa partie en cours en tant que Joueur 2 (Drop-In)`
                                : canChallengeUser
                                ? "Lancer le défi (2 Coins débités chez vous pour financer les deux slots · Gratuit pour l'invité)"
                                : 'Sélectionnez ou rejoignez un jeu multijoueur pour défier ce joueur'
                            }
                            className={`arcade-focus-ring px-2.5 py-1.5 min-h-[36px] rounded-lg disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-black flex items-center gap-1 shrink-0 ${
                              isInGameAvailable
                                ? 'bg-emerald-500 hover:bg-emerald-400 text-black'
                                : 'u-btn-primary'
                            }`}
                          >
                            {isInGameAvailable ? (
                              <Gamepad2 className="w-3.5 h-3.5" aria-hidden="true" />
                            ) : (
                              <Swords className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                            <span>
                              {pendingChallengeId === u.uid
                                ? 'Envoi…'
                                : isInGameAvailable && canChallengeUser
                                ? 'Rejoindre (J2)'
                                : canChallengeUser
                                ? 'Défier'
                                : 'Aucun jeu'}
                            </span>
                          </button>
                        )}
                      </div>
                    )}
                    {isMe && (
                      <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1 shrink-0">
                        <UserCheck className="w-3.5 h-3.5" /> Actif
                      </span>
                    )}
                  </div>

                  {/* Liste des jeux sélectionnés où ce joueur est actif pour jouer */}
                  <div className="pt-1.5 border-t border-neutral-800/80 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-mono text-neutral-400 flex items-center gap-1">
                      <Gamepad2 className="w-3 h-3 text-cyan-400" />
                      Actif sur :
                    </span>
                    {userActiveGames.length === 0 ? (
                      <span className="text-[10px] font-mono text-neutral-400">
                        {isGlobal ? 'Lobby Global' : channel.title}
                      </span>
                    ) : (
                      userActiveGames.map((g) => {
                        const isCurrentlyPlayingThis = u.currentGame?.gameId === g.gameId;
                        return (
                          <button
                            key={g.gameId}
                            type="button"
                            onClick={() => {
                              if (!isMe && !isNetplayMatch) {
                                handleChallenge(u, g);
                              } else if (onSelectChannel) {
                                onSelectChannel(g.gameId);
                              }
                            }}
                            title={
                              !isMe
                                ? `Cliquer pour défier ${u.name} sur ${g.title}`
                                : `Ouvrir le salon ${g.title}`
                            }
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                              isCurrentlyPlayingThis
                                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                                : 'bg-neutral-950 hover:bg-cyan-950/60 border-neutral-700 hover:border-cyan-500/50 text-cyan-300'
                            }`}
                          >
                            {isCurrentlyPlayingThis ? '🎮 ' : '🟢 '}
                            {g.title}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
