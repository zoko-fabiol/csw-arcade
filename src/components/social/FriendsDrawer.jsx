import React, { useEffect, useRef, useState } from 'react';
import {
  X, Users, UserPlus, Search, Copy, Check, Swords, Eye, UserMinus, Clock, MessageSquare, Sparkles, ArrowLeft, Send, PhoneCall
} from 'lucide-react';
import { PlayerAvatar } from '../common/PlayerAvatar';
import { countryCodeToFlag } from '../../data/countries';
import { getPlayerFriendTag } from '../../services/authService';
import { getRankTierMeta } from '../../services/scoreRankingService';
import {
  acceptFriendRequest,
  declineOrCancelFriendRequest,
  removeFriend,
  searchPlayersDirectory,
  sendFriendRequest,
} from '../../services/friendsService';
import {
  markDirectMessagesRead,
  sendDirectMessage,
  subscribeDirectMessages,
} from '../../services/directMessageService';
import { supportsOnlineMultiplayer } from '../../utils/gameCapabilities';

function describeFriendActivity(friend) {
  if (!friend?.isOnline) return '⚪ Hors-ligne';
  if (friend.status === 'playing') {
    return `⚔️ En match P2P${friend.currentGame?.title ? ` · ${friend.currentGame.title}` : ''}`;
  }
  if (friend.status === 'in_game_available' || friend.currentGame) {
    return `🎮 En jeu · ${friend.currentGame?.title || 'En partie'}`;
  }
  if (friend.status === 'afk') return '🌙 AFK';
  if (Array.isArray(friend.activeGames) && friend.activeGames.length > 0) {
    return `🟢 En ligne · ${friend.activeGames[0].title}`;
  }
  return '🟢 En ligne · Au salon';
}

export function FriendsDrawer({
  isOpen,
  onClose,
  userProfile,
  friendsState = { friends: [], incomingRequests: [], outgoingRequests: [] },
  activeChannels = [],
  unreadByPeer = {},
  initialChatFriend = null,
  voiceState = null,
  onChallengeFriend,
  onJoinFriendGameChannel,
  onSpectateFriend,
  onInviteVoiceFriend,
  onJoinFriendParty,
}) {
  const [tab, setTab] = useState('friends'); // 'friends' | 'requests' | 'find'
  const [activeChatFriend, setActiveChatFriend] = useState(null);
  const [dmMessages, setDmMessages] = useState([]);
  const [dmInput, setDmInput] = useState('');
  const [dmSending, setDmSending] = useState(false);
  const dmEndRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [copiedTag, setCopiedTag] = useState(false);
  const [busyUid, setBusyUid] = useState(null);
  const [confirmRemoveUid, setConfirmRemoveUid] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const friends = friendsState?.friends || [];
  const incomingRequests = friendsState?.incomingRequests || [];
  const outgoingRequests = friendsState?.outgoingRequests || [];

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);
  const onlineFriends = friends.filter((f) => f.isOnline);
  const offlineFriends = friends.filter((f) => !f.isOnline);
  const myTag =
    userProfile?.friendTag ||
    getPlayerFriendTag(userProfile?.displayName || userProfile?.name, userProfile?.uid);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg('');
    setConfirmRemoveUid(null);
    if (initialChatFriend?.uid) {
      setActiveChatFriend(initialChatFriend);
    } else if (incomingRequests.length > 0 && friends.length === 0) {
      setTab('requests');
    }
  }, [isOpen, initialChatFriend?.uid]);

  useEffect(() => {
    if (!isOpen || !activeChatFriend?.uid || !userProfile?.uid) {
      setDmMessages([]);
      return undefined;
    }
    markDirectMessagesRead(userProfile.uid, activeChatFriend.uid);
    const unsub = subscribeDirectMessages(userProfile.uid, activeChatFriend.uid, (list) => {
      setDmMessages(list);
      markDirectMessagesRead(userProfile.uid, activeChatFriend.uid);
    });
    return () => unsub?.();
  }, [isOpen, activeChatFriend?.uid, userProfile?.uid]);

  useEffect(() => {
    if (activeChatFriend) {
      dmEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [dmMessages.length, activeChatFriend?.uid]);

  useEffect(() => {
    if (!isOpen || tab !== 'find') return undefined;
    let active = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const list = await searchPlayersDirectory(userProfile, searchQuery, friendsState);
        if (active) setSearchResults(list);
      } finally {
        if (active) setSearching(false);
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [isOpen, tab, searchQuery, userProfile?.uid, friendsState]);

  if (!isOpen) return null;

  const showToast = (msg) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(''), 2500);
  };

  const handleCopyTag = async () => {
    try {
      await navigator.clipboard.writeText(myTag);
      setCopiedTag(true);
      setTimeout(() => setCopiedTag(false), 1800);
    } catch {
      /* noop */
    }
  };

  const handleAddFriend = async (targetUser) => {
    setErrorMsg('');
    setBusyUid(targetUser.uid);
    try {
      const res = await sendFriendRequest(userProfile, targetUser);
      showToast(
        res?.autoAccepted
          ? `Vous et ${targetUser.displayName} êtes maintenant amis !`
          : `Demande d'ami envoyée à ${targetUser.displayName} !`
      );
      const updated = await searchPlayersDirectory(userProfile, searchQuery, friendsState);
      setSearchResults(updated);
    } catch (err) {
      setErrorMsg(err?.message || 'Impossible d’ajouter ce joueur.');
    } finally {
      setBusyUid(null);
    }
  };

  const handleAccept = async (req) => {
    setErrorMsg('');
    setBusyUid(req.fromUid);
    try {
      await acceptFriendRequest(userProfile, req);
      showToast(`${req.fromUser?.displayName || 'Joueur'} ajouté à vos amis !`);
    } finally {
      setBusyUid(null);
    }
  };

  const handleDeclineOrCancel = async (req) => {
    setBusyUid(req.fromUid || req.toUid);
    try {
      await declineOrCancelFriendRequest(userProfile, req);
    } finally {
      setBusyUid(null);
    }
  };

  const handleRemoveFriend = async (friendUid) => {
    setBusyUid(friendUid);
    try {
      await removeFriend(userProfile, friendUid);
      setConfirmRemoveUid(null);
      showToast('Ami retiré.');
    } finally {
      setBusyUid(null);
    }
  };

  const resolveFriendMultiplayerGame = (friend) => {
    if (supportsOnlineMultiplayer(friend?.currentGame)) return friend.currentGame;
    const friendMulti = (friend?.activeGames || []).find((g) => supportsOnlineMultiplayer(g));
    if (friendMulti) return friendMulti;
    const myMulti = (activeChannels || []).find((c) => c.entry && supportsOnlineMultiplayer(c.entry));
    return myMulti || null;
  };

  const friendFilterLower = tab === 'friends' ? searchQuery.trim().toLowerCase() : '';
  const filterFriends = (list) =>
    !friendFilterLower
      ? list
      : list.filter((f) =>
          [f.displayName, f.friendTag, f.firstName, f.lastName]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(friendFilterLower)
        );

  const visibleOnline = filterFriends(onlineFriends);
  const visibleOffline = filterFriends(offlineFriends);

  const renderFriendRow = (friend) => {
    const rankMeta = getRankTierMeta(friend.rank || 'D');
    const gameTarget = resolveFriendMultiplayerGame(friend);
    const isPlayingMatch = friend.isOnline && friend.status === 'playing';
    const isConfirming = confirmRemoveUid === friend.uid;

    return (
      <div
        key={friend.uid}
        className={`p-3 rounded-xl border transition-colors space-y-2 ${
          friend.isOnline
            ? 'bg-neutral-950/90 border-white/15 hover:u-accent-border'
            : 'bg-neutral-950/70 border-white/10'
        }`}
      >
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <PlayerAvatar
              photoURL={friend.photoURL}
              name={friend.displayName}
              size="sm"
              status={friend.isOnline ? friend.status || 'available' : 'offline'}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`px-1 py-0.2 rounded border text-[9px] font-mono font-black ${rankMeta.color}`}>
                  {rankMeta.id}
                </span>
                <span className="text-xs font-bold text-white truncate">{friend.displayName}</span>
                <span className="text-[10px] font-mono text-neutral-300">#{friend.friendCode}</span>
                <span className="text-[10px] font-mono px-1 rounded bg-white/10 text-neutral-200">
                  {String(friend.region || 'FR').toUpperCase()}
                </span>
              </div>
              <div className="text-[11px] font-mono text-neutral-300 truncate mt-0.5">
                {describeFriendActivity(friend)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
            {/* Bouton Écrire en privé (DM) */}
            <button
              type="button"
              onClick={() => setActiveChatFriend(friend)}
              title={`Écrire en privé à ${friend.displayName}`}
              className="arcade-focus-ring relative p-2 min-w-[36px] min-h-[36px] rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-white/10 u-accent-text flex items-center justify-center cursor-pointer transition-colors"
            >
              <MessageSquare aria-hidden="true" className="w-3.5 h-3.5" />
              {Number(unreadByPeer?.[friend.uid] || 0) > 0 && (
                <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[9px] font-mono font-black leading-tight">
                  {unreadByPeer[friend.uid]}
                </span>
              )}
            </button>

            {/* Bouton Rejoindre le Groupe Salon & Vocal (6 joueurs max) */}
            {friend.isOnline && (onJoinFriendParty || onInviteVoiceFriend) && (
              <button
                type="button"
                onClick={async () => {
                  if (onJoinFriendParty) {
                    await onJoinFriendParty(friend);
                    showToast(`Vous avez rejoint le groupe vocal de ${friend.displayName} !`);
                  } else {
                    await onInviteVoiceFriend(friend);
                    showToast(`Invitation vocale envoyée à ${friend.displayName} !`);
                  }
                }}
                title={`Rejoindre le groupe salon & parler en vocal avec ${friend.displayName} (6 max)`}
                className="arcade-focus-ring px-2 py-1.5 min-h-[36px] rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
              >
                <PhoneCall aria-hidden="true" className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Groupe</span>
              </button>
            )}

            {friend.isOnline && isPlayingMatch && (
              <>
                {gameTarget && (
                  <button
                    type="button"
                    onClick={() => onChallengeFriend?.(friend, gameTarget)}
                    title={`Rejoindre la partie en cours de ${friend.displayName} (Drop-In)`}
                    className="arcade-focus-ring px-2.5 py-1.5 min-h-[36px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-[11px] font-black flex items-center gap-1 cursor-pointer"
                  >
                    <Swords aria-hidden="true" className="w-3.5 h-3.5" />
                    <span>Rejoindre</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onSpectateFriend?.(friend)}
                  title="Regarder la partie en direct"
                  className="arcade-focus-ring px-2.5 py-1.5 min-h-[36px] rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Eye aria-hidden="true" className="w-3.5 h-3.5" />
                  <span>Regarder</span>
                </button>
              </>
            )}
            {friend.isOnline && !isPlayingMatch && gameTarget && (
              <>
                <button
                  type="button"
                  onClick={() => onChallengeFriend?.(friend, gameTarget)}
                  title={
                    friend.status === 'in_game_available' || friend.currentGame
                      ? `Rejoindre ${friend.displayName} sur ${gameTarget.title} en tant que J2 (Drop-In)`
                      : `Défier ${friend.displayName} sur ${gameTarget.title}`
                  }
                  className={`arcade-focus-ring px-2.5 py-1.5 min-h-[36px] rounded-xl text-[11px] font-black flex items-center gap-1 cursor-pointer ${
                    friend.status === 'in_game_available' || friend.currentGame
                      ? 'bg-emerald-500 hover:bg-emerald-400 text-black'
                      : 'u-btn-primary'
                  }`}
                >
                  <Swords aria-hidden="true" className="w-3.5 h-3.5" />
                  <span>
                    {friend.status === 'in_game_available' || friend.currentGame ? 'Rejoindre (J2)' : 'Défier'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onJoinFriendGameChannel?.(gameTarget)}
                  title={`Rejoindre le salon ${gameTarget.title}`}
                  className="arcade-focus-ring p-2 min-w-[36px] min-h-[36px] rounded-xl bg-neutral-800 hover:bg-neutral-700 u-accent-text flex items-center justify-center cursor-pointer"
                >
                  <MessageSquare aria-hidden="true" className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            {isConfirming ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={busyUid === friend.uid}
                  onClick={() => handleRemoveFriend(friend.uid)}
                  className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold cursor-pointer"
                >
                  Retirer
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemoveUid(null)}
                  className="px-1.5 py-1 rounded bg-neutral-800 text-neutral-300 text-[10px] font-bold cursor-pointer"
                >
                  Non
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmRemoveUid(friend.uid)}
                aria-label={`Retirer ${friend.displayName} de mes amis`}
                title="Retirer de mes amis"
                className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-300 hover:bg-rose-950/40 transition-colors cursor-pointer"
              >
                <UserMinus aria-hidden="true" className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[115] flex justify-end bg-black/75 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Amis & Social"
    >
      <div
        className="flex-1"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        aria-label="Système d'amitié CSW-Arcade"
        className="w-full max-w-md h-full bg-neutral-900 border-l u-accent-border sm:rounded-l-3xl shadow-2xl flex flex-col text-neutral-100 overflow-hidden"
      >
        {/* Vue Conversation Privée Directe (DM) si un ami est sélectionné */}
        {activeChatFriend ? (
          <div className="flex flex-col h-full min-h-0">
            <div className="u-banner px-3.5 py-3.5 border-b flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  onClick={() => setActiveChatFriend(null)}
                  aria-label="Retour à la liste d'amis"
                  className="arcade-focus-ring p-2 min-w-[40px] min-h-[40px] rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-neutral-200 flex items-center justify-center shrink-0 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                </button>
                <PlayerAvatar
                  photoURL={activeChatFriend.photoURL}
                  name={activeChatFriend.displayName || activeChatFriend.name}
                  size="sm"
                  status={activeChatFriend.isOnline ? activeChatFriend.status || 'available' : 'offline'}
                />
                <div className="min-w-0">
                  <div className="text-xs sm:text-sm font-black text-white truncate">
                    {activeChatFriend.displayName || activeChatFriend.name}
                  </div>
                  <div className="text-[10px] font-mono text-neutral-300 truncate">
                    {describeFriendActivity(activeChatFriend)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {activeChatFriend.isOnline && onInviteVoiceFriend && (
                  <button
                    type="button"
                    onClick={async () => {
                      await onInviteVoiceFriend(activeChatFriend);
                      showToast(`Invitation vocale envoyée à ${activeChatFriend.displayName} !`);
                    }}
                    title="Inviter en chat vocal"
                    className="arcade-focus-ring px-2.5 py-2 min-h-[38px] rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <PhoneCall className="w-3.5 h-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Vocal</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Fermer le panneau Amis"
                  className="arcade-focus-ring p-2 min-w-[38px] min-h-[38px] rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-neutral-200 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            {feedback && (
              <div className="mx-3 mt-2 px-3 py-2 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs font-semibold">
                {feedback}
              </div>
            )}
            {errorMsg && (
              <div className="mx-3 mt-2 px-3 py-2 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-300 text-xs font-semibold">
                {errorMsg}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 text-xs">
              {dmMessages.length === 0 ? (
                <div className="text-center py-10 px-4 text-neutral-400 font-mono text-[11px]">
                  Démarrez une discussion privée avec <strong>{activeChatFriend.displayName}</strong> !
                </div>
              ) : (
                dmMessages.map((m) => {
                  const isMine = m.fromUid === userProfile?.uid;
                  const timeStr = m.createdAtMs
                    ? new Date(m.createdAtMs).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                    : '';
                  return (
                    <div key={m.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                      <div
                        className={`max-w-[84%] px-3 py-2 rounded-2xl border text-xs sm:text-[13px] leading-relaxed break-words ${
                          isMine
                            ? 'u-btn-primary rounded-br-sm'
                            : 'bg-neutral-800/90 border-white/10 text-neutral-100 rounded-bl-sm'
                        }`}
                      >
                        <p>{m.text}</p>
                        {timeStr && (
                          <span className={`block text-[9px] font-mono mt-1 text-right ${isMine ? 'opacity-80' : 'text-neutral-400'}`}>
                            {timeStr}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={dmEndRef} />
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const clean = dmInput.trim();
                if (!clean || dmSending) return;
                setDmSending(true);
                setErrorMsg('');
                try {
                  const sent = await sendDirectMessage(userProfile, activeChatFriend.uid, clean);
                  setDmInput('');
                  if (sent) {
                    setDmMessages((prev) => (prev.some((x) => x.id === sent.id) ? prev : [...prev, sent]));
                  }
                } catch (err) {
                  setErrorMsg(err?.message || 'Échec de l’envoi.');
                } finally {
                  setDmSending(false);
                }
              }}
              className="p-3 border-t border-white/10 bg-neutral-950/90 flex items-center gap-2 shrink-0 pb-safe"
            >
              <input
                type="text"
                value={dmInput}
                onChange={(e) => setDmInput(e.target.value)}
                placeholder={`Écrire à ${activeChatFriend.displayName}…`}
                maxLength={500}
                className="arcade-focus-ring flex-1 min-w-0 px-3.5 py-2.5 min-h-[42px] rounded-xl bg-neutral-900 border border-white/15 text-xs text-white placeholder:text-neutral-400"
              />
              <button
                type="submit"
                disabled={dmSending || !dmInput.trim()}
                aria-label="Envoyer le message privé"
                className="arcade-focus-ring px-3.5 py-2.5 min-h-[42px] rounded-xl u-btn-primary disabled:opacity-45 font-bold text-xs flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </form>
          </div>
        ) : (
        <>
        {/* En-tête Social — Thématisé selon la console active */}
        <div className="u-banner px-4 py-4 border-b flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <PlayerAvatar
              photoURL={userProfile?.photoURL}
              name={userProfile?.displayName || userProfile?.name || 'Joueur'}
              size="md"
              status="available"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Users aria-hidden="true" className="w-4 h-4 u-accent-text shrink-0" />
                <h2 className="text-sm sm:text-base font-black tracking-tight text-white truncate">
                  Amis &amp; Social
                </h2>
              </div>
              <button
                type="button"
                onClick={handleCopyTag}
                title="Copier votre Tag Ami pour l'envoyer à vos amis"
                className="arcade-focus-ring mt-0.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md u-badge text-[11px] font-mono cursor-pointer transition-opacity hover:opacity-90"
              >
                <span>{myTag}</span>
                <Copy aria-hidden="true" className="w-3 h-3" />
                {copiedTag && <span className="text-emerald-300 font-bold ml-0.5">Copié !</span>}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le panneau Amis"
            className="arcade-focus-ring p-2 min-w-[44px] min-h-[44px] rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-neutral-200 hover:text-white flex items-center justify-center cursor-pointer transition-colors shrink-0"
          >
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>

        {/* Onglets — Style pilules segmentées thématisées */}
        <div className="p-2.5 border-b border-white/10 bg-neutral-950/80 shrink-0">
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-neutral-900 border border-white/10 text-xs font-bold">
            <button
              type="button"
              onClick={() => setTab('friends')}
              className={`arcade-focus-ring py-2 min-h-[40px] rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                tab === 'friends'
                  ? 'u-btn-primary'
                  : 'text-neutral-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>Amis</span>
              <span className="px-1.5 py-0.5 rounded-full bg-black/30 text-[10px] font-mono tabular-nums">
                {onlineFriends.length}/{friends.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setTab('requests')}
              className={`arcade-focus-ring py-2 min-h-[40px] rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                tab === 'requests'
                  ? 'u-btn-primary'
                  : 'text-neutral-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>Demandes</span>
              {incomingRequests.length + outgoingRequests.length > 0 && (
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-black ${
                    incomingRequests.length > 0
                      ? 'bg-amber-500 text-black'
                      : 'bg-black/30 text-neutral-200'
                  }`}
                >
                  {incomingRequests.length + outgoingRequests.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setTab('find')}
              className={`arcade-focus-ring py-2 min-h-[40px] rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                tab === 'find'
                  ? 'u-btn-primary'
                  : 'text-neutral-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <UserPlus aria-hidden="true" className="w-3.5 h-3.5" />
              <span>Ajouter</span>
            </button>
          </div>
        </div>

        {/* Barre de recherche contextuelle */}
        {(tab === 'friends' || tab === 'find') && (
          <div className="px-3.5 py-2.5 border-b border-white/10 bg-neutral-950/50 shrink-0">
            <div className="relative">
              <Search aria-hidden="true" className="w-4 h-4 text-neutral-300 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  tab === 'find'
                    ? 'Pseudo, Tag (#XXXX), Nom ou Email…'
                    : 'Filtrer mes amis…'
                }
                className="arcade-focus-ring w-full pl-10 pr-9 py-2.5 min-h-[44px] rounded-xl bg-neutral-950 border border-white/15 text-sm sm:text-xs text-white placeholder:text-neutral-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Effacer la recherche"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-300 hover:text-white cursor-pointer"
                >
                  <X aria-hidden="true" className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Messages retour */}
        {(feedback || errorMsg) && (
          <div className="px-3 pt-2 shrink-0">
            {feedback && (
              <div className="px-3 py-2 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-200 text-xs">
                {feedback}
              </div>
            )}
            {errorMsg && (
              <div className="px-3 py-2 rounded-lg bg-rose-950/60 border border-rose-500/40 text-rose-200 text-xs">
                {errorMsg}
              </div>
            )}
          </div>
        )}

        {/* Contenu principal */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {tab === 'friends' && (
            <>
              {friends.length === 0 ? (
                <div className="p-6 rounded-2xl u-card border text-center space-y-3.5">
                  <div className="w-12 h-12 rounded-2xl u-badge flex items-center justify-center mx-auto">
                    <Sparkles aria-hidden="true" className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-white">Aucun ami pour le moment</p>
                    <p className="text-xs text-neutral-300 leading-relaxed">
                      Partagez votre Tag <span className="font-mono u-accent-text font-bold">{myTag}</span> ou recherchez un ami pour voir son jeu en cours et le défier en 1 clic !
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTab('find')}
                    className="arcade-focus-ring px-5 py-2.5 min-h-[44px] rounded-xl u-btn-primary text-xs font-black inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <UserPlus aria-hidden="true" className="w-4 h-4" />
                    <span>Trouver des amis</span>
                  </button>
                </div>
              ) : (
                <>
                  {visibleOnline.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 px-1">
                        En ligne ({visibleOnline.length})
                      </div>
                      {visibleOnline.map(renderFriendRow)}
                    </div>
                  )}

                  {visibleOffline.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 px-1">
                        Hors-ligne ({visibleOffline.length})
                      </div>
                      {visibleOffline.map(renderFriendRow)}
                    </div>
                  )}

                  {visibleOnline.length === 0 && visibleOffline.length === 0 && (
                    <p className="text-center text-xs text-neutral-400 py-6">
                      Aucun ami ne correspond à « {searchQuery} ».
                    </p>
                  )}
                </>
              )}
            </>
          )}

          {tab === 'requests' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-amber-300 px-1">
                  Demandes reçues ({incomingRequests.length})
                </div>
                {incomingRequests.length === 0 ? (
                  <p className="text-xs text-neutral-400 px-1">Aucune demande reçue en attente.</p>
                ) : (
                  incomingRequests.map((req) => {
                    const u = req.fromUser || {};
                    const rMeta = getRankTierMeta(u.rank || 'D');
                    return (
                      <div
                        key={req.id || req.fromUid}
                        className="p-3 rounded-xl bg-neutral-950 border border-amber-500/30 flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <PlayerAvatar photoURL={u.photoURL} name={u.displayName} size="sm" status={u.isOnline ? 'available' : 'offline'} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`px-1 py-0.2 rounded border text-[9px] font-mono font-black ${rMeta.color}`}>
                                {rMeta.id}
                              </span>
                              <span className="text-xs font-bold text-white truncate">{u.displayName || 'Joueur'}</span>
                            </div>
                            <div className="text-[10px] font-mono text-neutral-400">
                              {u.friendTag} · {countryCodeToFlag(u.region)}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={busyUid === req.fromUid}
                            onClick={() => handleAccept(req)}
                            aria-label="Accepter la demande d'ami"
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-[11px] font-black flex items-center gap-1 cursor-pointer"
                          >
                            <Check aria-hidden="true" className="w-3.5 h-3.5" />
                            <span>Accepter</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyUid === req.fromUid}
                            onClick={() => handleDeclineOrCancel(req)}
                            aria-label="Refuser la demande d'ami"
                            className="p-1.5 rounded-lg bg-neutral-800 hover:bg-rose-950 text-neutral-300 hover:text-rose-200 cursor-pointer"
                          >
                            <X aria-hidden="true" className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 px-1">
                  Demandes envoyées ({outgoingRequests.length})
                </div>
                {outgoingRequests.length === 0 ? (
                  <p className="text-xs text-neutral-400 px-1">Aucune demande envoyée en attente.</p>
                ) : (
                  outgoingRequests.map((req) => {
                    const u = req.toUser || {};
                    return (
                      <div
                        key={req.id || req.toUid}
                        className="p-3 rounded-xl bg-neutral-950/70 border border-neutral-800 flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <PlayerAvatar photoURL={u.photoURL} name={u.displayName} size="sm" />
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-white truncate">{u.displayName || 'Joueur'}</div>
                            <div className="text-[10px] font-mono text-neutral-400 flex items-center gap-1">
                              <Clock aria-hidden="true" className="w-3 h-3" /> En attente de réponse…
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={busyUid === req.toUid}
                          onClick={() => handleDeclineOrCancel(req)}
                          className="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[11px] font-bold cursor-pointer"
                        >
                          Annuler
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {tab === 'find' && (
            <div className="space-y-2.5">
              <div className="text-[11px] font-mono uppercase tracking-wider text-neutral-300 px-1 flex items-center justify-between">
                <span>{searchQuery.trim() ? 'Résultats de recherche' : 'Joueurs actifs & communauté'}</span>
                {searching && <span className="u-accent-text">Recherche…</span>}
              </div>

              {!searching && searchResults.length === 0 ? (
                <div className="p-6 rounded-2xl u-card border text-center text-xs text-neutral-300 leading-relaxed">
                  Aucun joueur trouvé. Demandez à votre ami son Tag (<span className="font-mono u-accent-text font-bold">Pseudo#XXXX</span>) ou son pseudo exact !
                </div>
              ) : (
                searchResults.map((u) => {
                  const rMeta = getRankTierMeta(u.rank || 'D');
                  return (
                    <div
                      key={u.uid}
                      className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <PlayerAvatar
                          photoURL={u.photoURL}
                          name={u.displayName}
                          size="sm"
                          status={u.isOnline ? u.status || 'available' : 'offline'}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`px-1 py-0.2 rounded border text-[9px] font-mono font-black ${rMeta.color}`}>
                              {rMeta.id}
                            </span>
                            <span className="text-xs font-bold text-white truncate">{u.displayName}</span>
                            <span className="text-[10px] font-mono text-neutral-400">#{u.friendCode}</span>
                          </div>
                          <div className="text-[10px] font-mono text-neutral-400 truncate">
                            {countryCodeToFlag(u.region)} · {u.isOnline ? 'En ligne' : 'Hors-ligne'}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0">
                        {u.relation === 'friend' ? (
                          <span className="px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold inline-flex items-center gap-1">
                            <Check aria-hidden="true" className="w-3 h-3" /> Ami
                          </span>
                        ) : u.relation === 'incoming' ? (
                          <button
                            type="button"
                            disabled={busyUid === u.uid}
                            onClick={() => handleAccept({ id: u.requestId, fromUid: u.uid, fromUser: u })}
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-[11px] font-black cursor-pointer"
                          >
                            Accepter
                          </button>
                        ) : u.relation === 'outgoing' ? (
                          <span className="px-2.5 py-1 rounded-lg bg-neutral-800 text-neutral-400 text-[11px] font-mono inline-flex items-center gap-1">
                            <Clock aria-hidden="true" className="w-3 h-3" /> Envoyée
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={busyUid === u.uid}
                            onClick={() => handleAddFriend(u)}
                            className="arcade-focus-ring px-3 py-2 min-h-[38px] rounded-xl u-btn-primary disabled:opacity-50 text-[11px] font-black inline-flex items-center gap-1 cursor-pointer"
                          >
                            <UserPlus aria-hidden="true" className="w-3.5 h-3.5" />
                            <span>Ajouter</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
        </>
        )}
      </aside>
    </div>
  );
}
