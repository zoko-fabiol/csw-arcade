import React, { useEffect, useRef, useState } from 'react';
import { Swords, Eye, Send, Play, LogOut, Wifi, UserCheck } from 'lucide-react';
import {
  firebaseFightcadeService,
  getPlayerIdentity,
} from '../../services/firebaseFightcadeService';
import { GameCover } from './GameCover';

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

export function FightcadeLobbyView({
  channel,
  onChallengePlayer,
  onTestLocal,
  onLeaveChannel,
  onSpectateMatch,
}) {
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [pendingChallengeId, setPendingChallengeId] = useState(null);
  const chatEndRef = useRef(null);
  const me = getPlayerIdentity();

  useEffect(() => {
    if (!channel?.gameId) return;
    const unsubUsers = firebaseFightcadeService.subscribeChannelUsers(channel.gameId, setUsers);
    const unsubMsgs = firebaseFightcadeService.subscribeChannelMessages(channel.gameId, setMessages);
    return () => {
      unsubUsers?.();
      unsubMsgs?.();
    };
  }, [channel?.gameId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendChat = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const txt = chatInput;
    setChatInput('');
    await firebaseFightcadeService.sendMessage(channel.gameId, txt, 'chat');
  };

  const handleChallenge = async (u) => {
    setPendingChallengeId(u.uid);
    await onChallengePlayer(channel, u);
    setTimeout(() => setPendingChallengeId(null), 15000);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-neutral-950 text-neutral-100">
      {/* En-tête du salon Fightcade 2 */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-neutral-900/80 border-b border-neutral-800">
        <div className="flex items-center gap-3 min-w-0">
          <GameCover
            title={channel.title}
            platformLabel={channel.platformLabel}
            filename={channel.filename}
            compact
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-white truncate">{channel.title}</h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-950 text-cyan-300 border border-cyan-700/60">
                {channel.platformLabel}
              </span>
            </div>
            <p className="text-xs font-mono text-neutral-400">
              Salon Fightcade 2 · {users.length} joueur(s) en ligne · WebRTC Rollback P2P
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onTestLocal(channel.entry)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Tester le jeu (Training / Local)</span>
          </button>
          <button
            type="button"
            onClick={() => onLeaveChannel(channel.gameId)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-800 hover:bg-rose-950 text-neutral-300 hover:text-rose-200 text-xs font-bold transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Quitter</span>
          </button>
        </div>
      </div>

      {/* Corps : Chat en direct + Liste des joueurs */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 min-h-0 overflow-hidden">
        {/* Chat du salon */}
        <div className="lg:col-span-2 flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r border-neutral-800">
          <div className="px-4 py-2 bg-neutral-900/40 border-b border-neutral-800 text-[11px] font-mono uppercase tracking-wider text-neutral-400">
            Chat du salon — #{channel.gameId}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2 text-xs">
            {messages.length === 0 ? (
              <div className="text-neutral-500 font-mono text-center py-8">
                Bienvenue dans le salon {channel.title}. Dites bonjour ou défiez un joueur !
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={
                    m.type === 'system'
                      ? 'text-cyan-400/90 font-mono text-[11px] bg-cyan-950/20 px-2.5 py-1 rounded-lg border border-cyan-900/40'
                      : 'flex items-baseline gap-2'
                  }
                >
                  {m.type !== 'system' && (
                    <span className="font-bold text-cyan-300 shrink-0">{m.name} :</span>
                  )}
                  <span className="text-neutral-200 break-words">{m.text}</span>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={handleSendChat} className="p-3 border-t border-neutral-800 bg-neutral-900/50 flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={`Envoyer un message dans #${channel.title}…`}
              className="flex-1 px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-bold flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Envoyer</span>
            </button>
          </form>
        </div>

        {/* Liste des joueurs en ligne */}
        <div className="flex flex-col min-h-0 bg-neutral-900/20">
          <div className="px-4 py-2 bg-neutral-900/40 border-b border-neutral-800 flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-neutral-400">
            <span>Joueurs ({users.length})</span>
            <span className="flex items-center gap-1 text-emerald-400">
              <Wifi className="w-3 h-3" /> P2P
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {users.map((u) => {
              const isMe = u.uid === me.uid;
              const isPlaying = u.status === 'playing';
              const isAfk = u.status === 'afk';
              return (
                <div
                  key={u.uid}
                  className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isPlaying ? 'bg-amber-400' : isAfk ? 'bg-neutral-500' : 'bg-emerald-400'
                        }`}
                      />
                      <span className="text-xs font-bold text-white truncate">
                        {u.name} {isMe && '(Vous)'}
                      </span>
                      <span className="text-[10px] font-mono px-1 rounded bg-neutral-800 text-neutral-400">
                        {u.region || 'FR'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] font-mono text-neutral-400">
                      <PingBars ping={u.ping || 22} />
                      <span>{u.ping || 22}ms</span>
                      <span>· {isPlaying ? 'En match' : isAfk ? 'AFK' : 'Disponible'}</span>
                    </div>
                  </div>

                  {!isMe && (
                    isPlaying ? (
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
                        onClick={() => handleChallenge(u)}
                        className="px-2.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black text-[11px] font-bold flex items-center gap-1 shrink-0"
                      >
                        <Swords className="w-3.5 h-3.5" />
                        <span>{pendingChallengeId === u.uid ? 'Envoi…' : 'Défier'}</span>
                      </button>
                    )
                  )}
                  {isMe && (
                    <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                      <UserCheck className="w-3.5 h-3.5" /> Prêt
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
