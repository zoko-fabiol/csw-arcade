import React, { useEffect, useState } from 'react';
import {
  X, Users, UserPlus, Search, Copy, Check, Swords, Eye, UserMinus, Clock, MessageSquare, Sparkles
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
  onChallengeFriend,
  onJoinFriendGameChannel,
  onSpectateFriend,
}) {
  const [tab, setTab] = useState('friends'); // 'friends' | 'requests' | 'find'
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
  const onlineFriends = friends.filter((f) => f.isOnline);
  const offlineFriends = friends.filter((f) => !f.isOnline);
  const myTag =
    userProfile?.friendTag ||
    getPlayerFriendTag(userProfile?.displayName || userProfile?.name, userProfile?.uid);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg('');
    setConfirmRemoveUid(null);
    if (incomingRequests.length > 0 && friends.length === 0) {
      setTab('requests');
    }
  }, [isOpen]);

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
            ? 'bg-neutral-950/90 border-neutral-800 hover:border-cyan-500/35'
            : 'bg-neutral-950/40 border-neutral-800/70 opacity-75'
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
                <span className="text-[10px] font-mono text-neutral-500">#{friend.friendCode}</span>
                <span className="text-[10px] font-mono text-neutral-400">
                  {countryCodeToFlag(friend.region)}
                </span>
              </div>
              <div className="text-[11px] font-mono text-neutral-300 truncate mt-0.5">
                {describeFriendActivity(friend)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {friend.isOnline && isPlayingMatch && (
              <button
                type="button"
                onClick={() => onSpectateFriend?.(friend)}
                title="Regarder la partie en direct"
                className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <Eye aria-hidden="true" className="w-3.5 h-3.5" />
                <span>Regarder</span>
              </button>
            )}
            {friend.isOnline && !isPlayingMatch && gameTarget && (
              <>
                <button
                  type="button"
                  onClick={() => onChallengeFriend?.(friend, gameTarget)}
                  title={`Défier ${friend.displayName} sur ${gameTarget.title}`}
                  className="px-2.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black text-[11px] font-black flex items-center gap-1 cursor-pointer"
                >
                  <Swords aria-hidden="true" className="w-3.5 h-3.5" />
                  <span>Défier</span>
                </button>
                <button
                  type="button"
                  onClick={() => onJoinFriendGameChannel?.(gameTarget)}
                  title={`Rejoindre le salon ${gameTarget.title}`}
                  className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-cyan-300 cursor-pointer"
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
                className="p-1.5 rounded-lg text-neutral-500 hover:text-rose-300 hover:bg-rose-950/40 transition-colors cursor-pointer"
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
    <div className="fixed inset-0 z-[115] flex justify-end bg-black/75 backdrop-blur-sm">
      <div
        className="flex-1"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        aria-label="Système d'amitié CSW-Arcade"
        className="w-full max-w-md h-full bg-neutral-900 border-l border-cyan-500/35 shadow-2xl flex flex-col text-neutral-100"
      >
        {/* En-tête Social style Fortnite */}
        <div className="px-4 py-3.5 bg-gradient-to-r from-cyan-950/60 via-neutral-900 to-neutral-900 border-b border-neutral-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <PlayerAvatar
              photoURL={userProfile?.photoURL}
              name={userProfile?.displayName || userProfile?.name || 'Joueur'}
              size="md"
              status="available"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Users aria-hidden="true" className="w-4 h-4 text-cyan-400 shrink-0" />
                <h2 className="text-sm font-black uppercase tracking-wide text-white truncate">
                  Amis &amp; Social
                </h2>
              </div>
              <button
                type="button"
                onClick={handleCopyTag}
                title="Copier votre Tag Ami pour l'envoyer à vos amis"
                className="inline-flex items-center gap-1 text-[11px] font-mono text-cyan-300 hover:text-cyan-200 cursor-pointer"
              >
                <span>Mon Tag : {myTag}</span>
                <Copy aria-hidden="true" className="w-3 h-3" />
                {copiedTag && <span className="text-emerald-300 font-bold ml-1">Copié !</span>}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le panneau Amis"
            className="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white cursor-pointer"
          >
            <X aria-hidden="true" className="w-4 h-4" />
          </button>
        </div>

        {/* Onglets */}
        <div className="grid grid-cols-3 border-b border-neutral-800 bg-neutral-950/60 text-xs font-bold shrink-0">
          <button
            type="button"
            onClick={() => setTab('friends')}
            className={`py-2.5 flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
              tab === 'friends'
                ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <span>Amis</span>
            <span className="px-1.5 py-0.2 rounded-full bg-neutral-800 text-[10px] font-mono">
              {onlineFriends.length}/{friends.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setTab('requests')}
            className={`py-2.5 flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
              tab === 'requests'
                ? 'border-amber-400 text-amber-300 bg-amber-950/20'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <span>Demandes</span>
            {incomingRequests.length + outgoingRequests.length > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-black ${
                  incomingRequests.length > 0
                    ? 'bg-amber-500 text-black'
                    : 'bg-neutral-800 text-neutral-300'
                }`}
              >
                {incomingRequests.length + outgoingRequests.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setTab('find')}
            className={`py-2.5 flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
              tab === 'find'
                ? 'border-emerald-400 text-emerald-300 bg-emerald-950/20'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <UserPlus aria-hidden="true" className="w-3.5 h-3.5" />
            <span>Ajouter</span>
          </button>
        </div>

        {/* Barre de recherche contextuelle */}
        {(tab === 'friends' || tab === 'find') && (
          <div className="p-3 border-b border-neutral-800 bg-neutral-950/40 shrink-0">
            <div className="relative">
              <Search aria-hidden="true" className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  tab === 'find'
                    ? 'Pseudo, Tag (#XXXX), Nom ou Email…'
                    : 'Filtrer mes amis…'
                }
                className="w-full pl-9 pr-8 py-2 rounded-xl bg-neutral-950 border border-neutral-800 text-base sm:text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-cyan-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Effacer la recherche"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white cursor-pointer"
                >
                  <X aria-hidden="true" className="w-3.5 h-3.5" />
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
                <div className="p-6 rounded-xl bg-neutral-950 border border-neutral-800 text-center space-y-3">
                  <Sparkles aria-hidden="true" className="w-7 h-7 text-cyan-400 mx-auto" />
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-white">Aucun ami pour le moment</p>
                    <p className="text-[11px] text-neutral-400">
                      Partagez votre Tag <span className="font-mono text-cyan-300">{myTag}</span> ou recherchez un ami pour voir son jeu en cours et le défier en 1 clic !
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTab('find')}
                    className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-black inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <UserPlus aria-hidden="true" className="w-3.5 h-3.5" />
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
                      <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 px-1">
                        Hors-ligne ({visibleOffline.length})
                      </div>
                      {visibleOffline.map(renderFriendRow)}
                    </div>
                  )}

                  {visibleOnline.length === 0 && visibleOffline.length === 0 && (
                    <p className="text-center text-xs text-neutral-500 py-6">
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
                  <p className="text-xs text-neutral-500 px-1">Aucune demande reçue en attente.</p>
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
                  <p className="text-xs text-neutral-500 px-1">Aucune demande envoyée en attente.</p>
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
              <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 px-1 flex items-center justify-between">
                <span>{searchQuery.trim() ? 'Résultats de recherche' : 'Joueurs actifs & communauté'}</span>
                {searching && <span className="text-cyan-400">Recherche…</span>}
              </div>

              {!searching && searchResults.length === 0 ? (
                <div className="p-5 rounded-xl bg-neutral-950 border border-neutral-800 text-center text-xs text-neutral-400">
                  Aucun joueur trouvé. Demandez à votre ami son Tag (<span className="font-mono text-cyan-300">Pseudo#XXXX</span>) ou son pseudo exact !
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
                            <span className="text-[10px] font-mono text-neutral-500">#{u.friendCode}</span>
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
                            className="px-2.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black text-[11px] font-black inline-flex items-center gap-1 cursor-pointer"
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
      </aside>
    </div>
  );
}
