import React, { useEffect, useRef, useState } from 'react';
import {
  Swords, Eye, Send, Play, LogOut, Wifi, UserCheck, Globe, Megaphone, Sparkles, Gamepad2, Trophy
} from 'lucide-react';
import {
  firebaseFightcadeService,
  getPlayerIdentity,
  GLOBAL_CHANNEL_ID,
} from '../../services/firebaseFightcadeService';
import { getRankTierMeta, subscribeGameLeaderboard } from '../../services/scoreRankingService';
import { countryCodeToFlag } from '../../data/countries';
import { GameCover } from './GameCover';

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
  const [chatInput, setChatInput] = useState('');
  const [pendingChallengeId, setPendingChallengeId] = useState(null);
  const chatEndRef = useRef(null);
  const me = getPlayerIdentity();
  const isGlobal = channel?.gameId === GLOBAL_CHANNEL_ID || channel?.isGlobal;

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

    // Commandes slash Fightcade 2
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
    setPendingChallengeId(u.uid);
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

    if (!resolvedEntry) {
      const fallbackActive = activeChannels.find((c) => c.entry);
      if (fallbackActive) {
        targetGid = fallbackActive.gameId;
        targetTitle = fallbackActive.title;
        targetPlatform = fallbackActive.platformLabel || 'Arcade';
        resolvedEntry = fallbackActive.entry;
      }
    }

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

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-neutral-950 text-neutral-100 pb-14 md:pb-0">
      {/* En-tête du salon Fightcade 2 — Condensé sur mobile, complet sur desktop */}
      <div className="flex flex-wrap items-center justify-between gap-2 md:gap-3 px-3 md:px-4 py-2 md:py-3 bg-neutral-900/80 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {isGlobal ? (
            <div className="w-9 h-9 md:w-12 md:h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shrink-0">
              <Globe className="w-5 h-5 md:w-6 md:h-6" />
            </div>
          ) : (
            <div className="hidden sm:block">
              <GameCover
                title={channel.title}
                platformLabel={channel.platformLabel}
                filename={channel.filename}
                compact
              />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-sm md:text-base font-black text-white truncate">{channel.title}</h2>
              <span
                className={`hidden sm:inline px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                  isGlobal
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-700/60'
                    : 'bg-cyan-950 text-cyan-300 border-cyan-700/60'
                }`}
              >
                {channel.platformLabel}
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-500/40">
                🟢 {users.length} en ligne
              </span>
            </div>

            {/* Barre indiquant les jeux sélectionnés où vous êtes actif (Desktop & Tablette) */}
            <div className="hidden md:flex items-center gap-1.5 mt-1 flex-wrap text-[11px]">
              <span className="font-mono text-neutral-400">Vos jeux sélectionnés (actifs) :</span>
              {activeChannels.length === 0 ? (
                <span className="text-neutral-500 font-mono">
                  Aucun jeu sélectionné (lancez un jeu ou cliquez sur ⚔️ dans le catalogue)
                </span>
              ) : (
                activeChannels.map((ch) => (
                  <button
                    key={ch.gameId}
                    type="button"
                    onClick={() => onSelectChannel?.(ch.gameId)}
                    className={`px-2 py-0.5 rounded-md font-bold text-[10px] border transition-colors ${
                      ch.gameId === channel.gameId
                        ? 'bg-cyan-500 text-black border-cyan-400'
                        : 'bg-neutral-800 hover:bg-neutral-700 text-cyan-300 border-cyan-500/30'
                    }`}
                  >
                    🎮 {ch.title}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleAnnounceActiveGames}
            title="Publier dans le chat que vous êtes au salon et prêt à jouer sur vos jeux sélectionnés"
            className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-200 text-xs font-bold transition-colors"
          >
            <Megaphone className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden lg:inline">Annoncer mes jeux actifs</span>
          </button>

          {!isGlobal && channel.entry && (
            <button
              type="button"
              onClick={() => onTestLocal(channel.entry)}
              className="flex items-center gap-1.5 px-3 py-1.5 md:py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              <span className="sm:hidden">Jouer</span>
              <span className="hidden sm:inline">Jouer / Training</span>
            </button>
          )}

          {!isGlobal && (
            <button
              type="button"
              onClick={() => onLeaveChannel(channel.gameId)}
              title="Quitter ce salon"
              className="flex items-center gap-1 px-2.5 py-1.5 md:py-2 rounded-xl bg-neutral-800 hover:bg-rose-950 text-neutral-300 hover:text-rose-200 text-xs font-bold transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Quitter</span>
            </button>
          )}
        </div>
      </div>

      {/* Onglets Mobile (< md) : bascule plein écran entre Chat / Joueurs / Records sans écrasement vertical */}
      <div className="md:hidden grid grid-cols-3 border-b border-neutral-800 bg-neutral-900/60 text-xs font-bold shrink-0">
        <button
          type="button"
          onClick={() => setMobilePanel('chat')}
          className={`py-2.5 border-b-2 transition-colors ${
            mobilePanel === 'chat'
              ? 'border-cyan-400 text-cyan-300 bg-cyan-950/25'
              : 'border-transparent text-neutral-400'
          }`}
        >
          💬 Chat
        </button>
        <button
          type="button"
          onClick={() => {
            setMobilePanel('users');
            setRightTab('users');
          }}
          className={`py-2.5 border-b-2 transition-colors ${
            mobilePanel === 'users'
              ? 'border-emerald-400 text-emerald-300 bg-emerald-950/25'
              : 'border-transparent text-neutral-400'
          }`}
        >
          👥 Joueurs ({users.length})
        </button>
        {!isGlobal ? (
          <button
            type="button"
            onClick={() => {
              setMobilePanel('scores');
              setRightTab('scores');
            }}
            className={`py-2.5 border-b-2 transition-colors ${
              mobilePanel === 'scores'
                ? 'border-amber-400 text-amber-300 bg-amber-950/25'
                : 'border-transparent text-neutral-400'
            }`}
          >
            🏆 Records ({leaderboard.length})
          </button>
        ) : (
          <button
            type="button"
            onClick={handleAnnounceActiveGames}
            className="py-2.5 border-b-2 border-transparent text-cyan-300 active:bg-cyan-950/30"
          >
            📢 Dispo
          </button>
        )}
      </div>

      {/* Corps : Chat Communautaire en direct + Liste des joueurs et leurs jeux actifs */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 min-h-0 overflow-hidden">
        {/* Chat Communautaire du salon */}
        <div
          className={`${
            mobilePanel === 'chat' ? 'flex' : 'hidden md:flex'
          } md:col-span-2 flex-col min-h-0 md:border-r border-neutral-800`}
        >
          <div className="hidden md:flex px-4 py-2 bg-neutral-900/40 border-b border-neutral-800 items-center justify-between text-[11px] font-mono uppercase tracking-wider text-neutral-400">
            <span>Chat Communautaire — #{channel.gameId}</span>
            <span className="text-[10px] text-neutral-500">
              Commandes : /gg · /ready · /afk · Cliquez sur un pseudo pour @mentionner
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2 text-xs">
            {messages.length === 0 ? (
              <div className="text-neutral-500 font-mono text-center py-8">
                Bienvenue dans le salon {channel.title}. Dites bonjour, annoncez vos jeux actifs ou défiez un joueur !
              </div>
            ) : (
              messages.map((m) => {
                const isMentioned =
                  m.text && me.name && m.text.toLowerCase().includes(`@${me.name.toLowerCase()}`);
                const rankStyle = RANK_BADGE_STYLE[m.rank || 'B'] || RANK_BADGE_STYLE.B;

                if (m.type === 'system' || m.type === 'challenge') {
                  return (
                    <div
                      key={m.id}
                      className={`font-mono text-[11px] px-3 py-1.5 rounded-lg border flex items-center justify-between gap-2 ${
                        m.type === 'challenge'
                          ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                          : 'bg-cyan-950/20 border-cyan-900/40 text-cyan-300/90'
                      }`}
                    >
                      <span>{m.text}</span>
                      {m.createdAtMs && (
                        <span className="text-[10px] text-neutral-500 shrink-0">
                          {formatTime(m.createdAtMs)}
                        </span>
                      )}
                    </div>
                  );
                }

                return (
                  <div
                    key={m.id}
                    className={`flex items-baseline gap-2 px-2.5 py-1.5 rounded-lg transition-colors ${
                      isMentioned
                        ? 'bg-amber-500/15 border border-amber-500/40'
                        : 'hover:bg-neutral-900/60'
                    }`}
                  >
                    {m.createdAtMs && (
                      <span className="text-[10px] font-mono text-neutral-500 shrink-0">
                        [{formatTime(m.createdAtMs)}]
                      </span>
                    )}
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-black border shrink-0 ${rankStyle}`}
                    >
                      {m.rank || 'B'}
                    </span>
                    {m.region && (
                      <span className="text-[10px] font-mono px-1 rounded bg-neutral-800 text-neutral-400 shrink-0">
                        {m.region}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleMentionUser(m.name)}
                      className="font-bold text-cyan-300 hover:underline shrink-0"
                      title="Cliquer pour mentionner ce joueur"
                    >
                      {m.name} :
                    </button>
                    <span className="text-neutral-100 break-words flex-1">{m.text}</span>
                    {m.currentGameTitle && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/70 border border-emerald-600/40 text-emerald-300 shrink-0">
                        🎮 {m.currentGameTitle}
                      </span>
                    )}
                  </div>
                );
              })
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Barre de raccourcis communautaires Fightcade 2 */}
          <div className="px-3 py-1.5 border-t border-neutral-800/80 bg-neutral-900/30 flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => firebaseFightcadeService.sendMessage(channel.gameId, '🏆 GG ! Bon match !', 'chat')}
              className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-[10px] font-mono text-neutral-300"
            >
              🏆 GG !
            </button>
            <button
              type="button"
              onClick={handleAnnounceActiveGames}
              className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-[10px] font-mono text-cyan-300"
            >
              ⚔️ Dispo pour match
            </button>
            <button
              type="button"
              onClick={async () => {
                await firebaseFightcadeService.setCustomStatus('available');
              }}
              className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-[10px] font-mono text-emerald-300"
            >
              🟢 Statut : Prêt
            </button>
            <button
              type="button"
              onClick={async () => {
                await firebaseFightcadeService.setCustomStatus('afk');
              }}
              className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-[10px] font-mono text-neutral-400"
            >
              ⚪ Statut : AFK
            </button>
            {onOpenAuth && (
              <button
                type="button"
                onClick={onOpenAuth}
                className="ml-auto px-2 py-1 rounded bg-cyan-950/70 hover:bg-cyan-900/70 border border-cyan-500/30 text-[10px] font-mono text-cyan-200 flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3" />
                <span>Profil / Login ({me.name})</span>
              </button>
            )}
          </div>

          <form onSubmit={handleSendChat} className="p-2.5 sm:p-3 border-t border-neutral-800 bg-neutral-900/50 flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={`Message #${channel.title}…`}
              className="flex-1 px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 text-base sm:text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              className="px-3.5 sm:px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-bold flex items-center gap-1.5 shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Envoyer</span>
            </button>
          </form>
        </div>

        {/* Colonne Droite : Joueurs au salon + Classement Meilleurs Scores du jeu */}
        <div
          className={`${
            mobilePanel !== 'chat' ? 'flex' : 'hidden md:flex'
          } flex-col min-h-0 bg-neutral-900/20`}
        >
          <div className="hidden md:flex px-3 py-2 bg-neutral-900/40 border-b border-neutral-800 items-center justify-between gap-2 text-[11px] font-mono uppercase tracking-wider text-neutral-400">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setRightTab('users')}
                className={`px-2 py-1 rounded-lg font-bold transition-colors ${
                  rightTab === 'users'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-neutral-400 hover:text-white'
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
                        <div className="text-[9px] font-mono text-neutral-500">POINTS</div>
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
                const userActiveGames = Array.isArray(u.activeGames) ? u.activeGames : [];

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
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              isNetplayMatch
                                ? 'bg-amber-400'
                                : isInGameAvailable
                                ? 'bg-emerald-400 animate-pulse'
                                : isAfk
                                ? 'bg-neutral-500'
                                : 'bg-emerald-400'
                            }`}
                          />
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-black border ${rankStyle}`}
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
                          <span className="text-[10px] font-mono px-1 rounded bg-neutral-800 text-neutral-300">
                            {countryCodeToFlag(u.region)} {u.region || 'FR'}
                        </span>
                      </div>

                      {/* Statut précis du joueur */}
                      <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-neutral-300">
                        <PingBars ping={u.ping || 22} />
                        <span>{u.ping || 22}ms</span>
                        <span>·</span>
                        {isNetplayMatch ? (
                          <span className="text-amber-300 font-bold">
                            ⚔️ En match P2P {u.currentGame?.title ? `sur ${u.currentGame.title}` : ''}
                          </span>
                        ) : isInGameAvailable ? (
                          <span className="text-emerald-300 font-bold">
                            🎮 En jeu &amp; Au salon ({u.currentGame?.title || 'Training'})
                          </span>
                        ) : isAfk ? (
                          <span className="text-neutral-500">⚪ AFK</span>
                        ) : (
                          <span className="text-emerald-400">🟢 Au salon · Prêt à jouer</span>
                        )}
                      </div>
                    </div>

                    {!isMe && (
                      isNetplayMatch ? (
                        <button
                          type="button"
                          onClick={() => onSpectateMatch?.(channel, u)}
                          className="px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[11px] font-bold flex items-center gap-1 shrink-0"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Regarder</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={pendingChallengeId === u.uid}
                          onClick={() => {
                            if (!isGlobal) {
                              // Salon d'un jeu précis : défier sur le jeu du salon courant !
                              handleChallenge(u, channel);
                            } else {
                              // Salon global : défier sur le jeu en cours ou le premier jeu actif
                              handleChallenge(u, u.currentGame || userActiveGames[0] || null);
                            }
                          }}
                          title="Lancer le défi (2 Coins débités chez vous pour financer les deux slots · Gratuit pour l'invité)"
                          className="px-2.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black text-[11px] font-bold flex items-center gap-1 shrink-0"
                        >
                          <Swords className="w-3.5 h-3.5" />
                          <span>{pendingChallengeId === u.uid ? 'Envoi…' : 'Défier'}</span>
                        </button>
                      )
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
                      <span className="text-[10px] font-mono text-neutral-500">
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
