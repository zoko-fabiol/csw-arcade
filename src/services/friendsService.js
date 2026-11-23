/**
 * Service Système d'Amitié (style Fortnite) pour CSW-Arcade
 * - Code / Tag Ami unique (#XXXX) + recherche multi-critères (Pseudo, #Tag, Nom/Prénom, Email)
 * - Demandes d'amitié entrantes/sortantes, auto-acceptation mutuelle, suppression
 * - Présence temps réel (En ligne, En jeu + titre, En match P2P, Hors-ligne)
 * - Double couche : Relais serveur /api/friends + WebSocket PUSH + Firebase Firestore (si règles activées)
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { getPlayerFriendCode, getPlayerFriendTag } from './authService';

const LOCAL_FRIENDS_PREFIX = 'csw_friends_state_v1_';

function emitLocalFriendRefresh() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('csw-friends-refresh'));
  }
}

function normalizeUserSummary(u) {
  if (!u?.uid) return null;
  const displayName = String(u.displayName || u.name || 'Joueur').trim();
  const friendCode = u.friendCode || getPlayerFriendCode(u.uid);
  const friendTag = u.friendTag || getPlayerFriendTag(displayName, u.uid);
  return {
    uid: String(u.uid),
    name: displayName,
    displayName,
    friendCode,
    friendTag,
    firstName: u.firstName || '',
    lastName: u.lastName || '',
    email: u.email || null,
    region: u.region || 'FR',
    rank: u.rank || 'D',
    ratingPoints: Number(u.ratingPoints || 0),
    photoURL: u.photoURL || null,
    isOnline: Boolean(u.isOnline),
    status: u.status || (u.isOnline ? 'available' : 'offline'),
    currentGame: u.currentGame || null,
    activeGames: Array.isArray(u.activeGames) ? u.activeGames : [],
    matchMeta: u.matchMeta || null,
    ping: u.ping || null,
    lastSeen: Number(u.lastSeen || u.updatedAtMs || 0),
  };
}

function readCachedState(uid) {
  if (!uid) return { friends: [], incomingRequests: [], outgoingRequests: [] };
  try {
    const raw = localStorage.getItem(LOCAL_FRIENDS_PREFIX + uid);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      return {
        friends: Array.isArray(parsed.friends) ? parsed.friends : [],
        incomingRequests: Array.isArray(parsed.incomingRequests) ? parsed.incomingRequests : [],
        outgoingRequests: Array.isArray(parsed.outgoingRequests) ? parsed.outgoingRequests : [],
      };
    }
  } catch {
    /* noop */
  }
  return { friends: [], incomingRequests: [], outgoingRequests: [] };
}

function writeCachedState(uid, state) {
  if (!uid) return;
  try {
    localStorage.setItem(LOCAL_FRIENDS_PREFIX + uid, JSON.stringify(state));
  } catch {
    /* noop */
  }
}

export async function registerDirectoryProfile(userProfile) {
  const summary = normalizeUserSummary(userProfile);
  if (!summary) return;
  await fetch('/api/friends', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'register_profile', user: summary }),
  }).catch(() => {});
}

export function subscribeFriendsState(userProfile, cb) {
  const uid = userProfile?.uid;
  if (!uid) {
    cb({ friends: [], incomingRequests: [], outgoingRequests: [] });
    return () => {};
  }

  let relayState = readCachedState(uid);
  let fsFriends = [];
  let fsIncoming = [];
  let fsOutgoing = [];
  const fsProfileCache = new Map();
  const fsProfilePending = new Set();
  let disposed = false;

  const hydrateFriendFromFirestore = (friendUid) => {
    if (!friendUid || fsProfileCache.has(friendUid) || fsProfilePending.has(friendUid)) return;
    fsProfilePending.add(friendUid);
    getDoc(doc(db, 'users', friendUid))
      .then((snap) => {
        if (snap.exists()) {
          fsProfileCache.set(friendUid, snap.data() || {});
          emitMerged();
        } else {
          fsProfileCache.set(friendUid, null);
        }
      })
      .catch(() => {})
      .finally(() => {
        fsProfilePending.delete(friendUid);
      });
  };

  const emitMerged = () => {
    if (disposed) return;
    const friendsMap = new Map();
    [...fsFriends, ...relayState.friends].forEach((f) => {
      const norm = normalizeUserSummary(f);
      if (!norm || norm.uid === uid) return;
      const fsCached = fsProfileCache.get(norm.uid);
      if (fsCached === undefined && !norm.photoURL) {
        hydrateFriendFromFirestore(norm.uid);
      }
      const enriched = fsCached ? { ...norm, photoURL: norm.photoURL || fsCached.photoURL || null } : norm;
      const prev = friendsMap.get(enriched.uid);
      if (!prev || enriched.isOnline || (enriched.lastSeen || 0) >= (prev.lastSeen || 0)) {
        friendsMap.set(enriched.uid, { ...prev, ...enriched, photoURL: enriched.photoURL || prev?.photoURL || null });
      }
    });

    const incomingMap = new Map();
    [...fsIncoming, ...relayState.incomingRequests].forEach((r) => {
      if (!r?.fromUid || friendsMap.has(r.fromUid)) return;
      const id = r.id || `${r.fromUid}__${uid}`;
      incomingMap.set(id, {
        ...r,
        id,
        fromUser: normalizeUserSummary(r.fromUser || { uid: r.fromUid, displayName: r.fromName }),
      });
    });

    const outgoingMap = new Map();
    [...fsOutgoing, ...relayState.outgoingRequests].forEach((r) => {
      if (!r?.toUid || friendsMap.has(r.toUid)) return;
      const id = r.id || `${uid}__${r.toUid}`;
      outgoingMap.set(id, {
        ...r,
        id,
        toUser: normalizeUserSummary(r.toUser || { uid: r.toUid, displayName: r.toName }),
      });
    });

    const friends = Array.from(friendsMap.values()).sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      return String(a.displayName || '').localeCompare(String(b.displayName || ''));
    });

    const nextState = {
      friends,
      incomingRequests: Array.from(incomingMap.values()),
      outgoingRequests: Array.from(outgoingMap.values()),
    };
    writeCachedState(uid, nextState);
    cb(nextState);
  };

  const pullRelay = async () => {
    try {
      const res = await fetch(`/api/friends?uid=${encodeURIComponent(uid)}&action=state`);
      if (res.ok) {
        const data = await res.json();
        if (data?.ok) {
          relayState = {
            friends: Array.isArray(data.friends) ? data.friends : [],
            incomingRequests: Array.isArray(data.incomingRequests) ? data.incomingRequests : [],
            outgoingRequests: Array.isArray(data.outgoingRequests) ? data.outgoingRequests : [],
          };
          emitMerged();
        }
      }
    } catch {
      /* ignore offline */
    }
  };

  emitMerged();
  registerDirectoryProfile(userProfile).then(pullRelay);

  const pollId = setInterval(pullRelay, 6000);
  const onEvent = () => pullRelay();
  if (typeof window !== 'undefined') {
    window.addEventListener('csw-friend-event', onEvent);
    window.addEventListener('csw-friends-refresh', onEvent);
  }

  let unsubFsFriends = null;
  let unsubFsIn = null;
  let unsubFsOut = null;
  try {
    unsubFsFriends = onSnapshot(
      collection(db, 'users', uid, 'friends'),
      (snap) => {
        const arr = [];
        snap.forEach((d) => arr.push({ uid: d.id, ...d.data() }));
        fsFriends = arr;
        emitMerged();
      },
      () => {}
    );
    unsubFsIn = onSnapshot(
      query(collection(db, 'friend_requests'), where('toUid', '==', uid)),
      (snap) => {
        const arr = [];
        snap.forEach((d) => {
          const v = d.data();
          if (v?.status === 'pending' || !v?.status) arr.push({ id: d.id, ...v });
        });
        fsIncoming = arr;
        emitMerged();
      },
      () => {}
    );
    unsubFsOut = onSnapshot(
      query(collection(db, 'friend_requests'), where('fromUid', '==', uid)),
      (snap) => {
        const arr = [];
        snap.forEach((d) => {
          const v = d.data();
          if (v?.status === 'pending' || !v?.status) arr.push({ id: d.id, ...v });
        });
        fsOutgoing = arr;
        emitMerged();
      },
      () => {}
    );
  } catch {
    /* fallback to relay only */
  }

  return () => {
    disposed = true;
    clearInterval(pollId);
    if (typeof window !== 'undefined') {
      window.removeEventListener('csw-friend-event', onEvent);
      window.removeEventListener('csw-friends-refresh', onEvent);
    }
    unsubFsFriends?.();
    unsubFsIn?.();
    unsubFsOut?.();
  };
}

export async function searchPlayersDirectory(userProfile, queryText = '', currentFriendsState = null) {
  const uid = userProfile?.uid;
  if (!uid) return [];
  const q = String(queryText || '').trim();
  const qLower = q.toLowerCase();
  const qBare = qLower.replace(/^#/, '');

  const resultsMap = new Map();

  // 1. Recherche serveur (/api/friends?action=search)
  try {
    const res = await fetch(
      `/api/friends?uid=${encodeURIComponent(uid)}&action=search&q=${encodeURIComponent(q)}`
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.results)) {
        data.results.forEach((r) => {
          const norm = normalizeUserSummary(r);
          if (norm && norm.uid !== uid) {
            resultsMap.set(norm.uid, {
              ...norm,
              relation: r.relation || 'none',
              requestId: r.requestId || null,
            });
          }
        });
      }
    }
  } catch {
    /* ignore */
  }

  // 2. Complément Firestore (collection users) pour trouver aussi des joueurs distants hors-ligne
  try {
    const snap = await getDocs(query(collection(db, 'users'), limit(120)));
    const friendUids = new Set((currentFriendsState?.friends || []).map((f) => f.uid));
    const incomingMap = new Map((currentFriendsState?.incomingRequests || []).map((r) => [r.fromUid, r.id]));
    const outgoingMap = new Map((currentFriendsState?.outgoingRequests || []).map((r) => [r.toUid, r.id]));

    snap.forEach((d) => {
      const raw = { uid: d.id, ...d.data() };
      const norm = normalizeUserSummary(raw);
      if (!norm || norm.uid === uid) return;
      if (qLower) {
        const hay = [
          norm.displayName,
          norm.friendTag,
          norm.friendCode,
          norm.firstName,
          norm.lastName,
          norm.email,
          norm.uid,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(qLower) && (!qBare || !hay.includes(qBare))) return;
      }
      if (!resultsMap.has(norm.uid)) {
        let relation = 'none';
        let requestId = null;
        if (friendUids.has(norm.uid)) relation = 'friend';
        else if (incomingMap.has(norm.uid)) {
          relation = 'incoming';
          requestId = incomingMap.get(norm.uid);
        } else if (outgoingMap.has(norm.uid)) {
          relation = 'outgoing';
          requestId = outgoingMap.get(norm.uid);
        }
        resultsMap.set(norm.uid, { ...norm, relation, requestId });
      }
    });
  } catch {
    /* offline/rules fallback */
  }

  return Array.from(resultsMap.values()).sort((a, b) => {
    if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
    return (b.lastSeen || 0) - (a.lastSeen || 0);
  });
}

export async function sendFriendRequest(userProfile, targetUser) {
  const fromUser = normalizeUserSummary(userProfile);
  const toUser = normalizeUserSummary(targetUser);
  if (!fromUser || !toUser || fromUser.uid === toUser.uid) {
    throw new Error('Joueur cible invalide.');
  }

  const reqId = `${fromUser.uid}__${toUser.uid}`;
  const res = await fetch('/api/friends', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'send_request',
      fromUid: fromUser.uid,
      toUid: toUser.uid,
      fromUser,
      toUser,
    }),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || 'Impossible d’envoyer la demande.');
  }

  if (data.autoAccepted) {
    setDoc(
      doc(db, 'users', fromUser.uid, 'friends', toUser.uid),
      { ...toUser, updatedAt: serverTimestamp() },
      { merge: true }
    ).catch(() => {});
    setDoc(
      doc(db, 'users', toUser.uid, 'friends', fromUser.uid),
      { ...fromUser, updatedAt: serverTimestamp() },
      { merge: true }
    ).catch(() => {});
    deleteDoc(doc(db, 'friend_requests', `${toUser.uid}__${fromUser.uid}`)).catch(() => {});
  } else {
    setDoc(
      doc(db, 'friend_requests', reqId),
      {
        id: reqId,
        fromUid: fromUser.uid,
        toUid: toUser.uid,
        fromUser,
        toUser,
        status: 'pending',
        createdAtMs: Date.now(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch(() => {});
  }

  emitLocalFriendRefresh();
  return data;
}

export async function acceptFriendRequest(userProfile, req) {
  const myUser = normalizeUserSummary(userProfile);
  const fromUid = req?.fromUid || req?.uid;
  const fromUser = normalizeUserSummary(req?.fromUser || { uid: fromUid, displayName: req?.fromName });
  const requestId = req?.id || `${fromUid}__${myUser?.uid}`;
  if (!myUser?.uid || !fromUid) return;

  await fetch('/api/friends', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'accept_request',
      uid: myUser.uid,
      fromUid,
      requestId,
    }),
  }).catch(() => {});

  if (fromUser) {
    setDoc(
      doc(db, 'users', myUser.uid, 'friends', fromUid),
      { ...fromUser, updatedAt: serverTimestamp() },
      { merge: true }
    ).catch(() => {});
  }
  setDoc(
    doc(db, 'users', fromUid, 'friends', myUser.uid),
    { ...myUser, updatedAt: serverTimestamp() },
    { merge: true }
  ).catch(() => {});
  deleteDoc(doc(db, 'friend_requests', requestId)).catch(() => {});

  emitLocalFriendRefresh();
}

export async function declineOrCancelFriendRequest(userProfile, req) {
  const myUid = userProfile?.uid;
  if (!myUid || !req) return;
  const requestId = req.id || `${req.fromUid}__${req.toUid}`;
  const isIncoming = req.toUid === myUid;

  await fetch('/api/friends', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: isIncoming ? 'decline_request' : 'cancel_request',
      uid: myUid,
      fromUid: req.fromUid,
      toUid: req.toUid,
      requestId,
    }),
  }).catch(() => {});

  deleteDoc(doc(db, 'friend_requests', requestId)).catch(() => {});
  emitLocalFriendRefresh();
}

export async function removeFriend(userProfile, friendUid) {
  const myUid = userProfile?.uid;
  if (!myUid || !friendUid) return;

  await fetch('/api/friends', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'remove_friend',
      uid: myUid,
      friendUid,
    }),
  }).catch(() => {});

  deleteDoc(doc(db, 'users', myUid, 'friends', friendUid)).catch(() => {});
  deleteDoc(doc(db, 'users', friendUid, 'friends', myUid)).catch(() => {});
  emitLocalFriendRefresh();
}
