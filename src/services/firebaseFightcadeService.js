/**
 * Pilier 3A : Salons Fightcade 2 sur Firebase Firestore
 * - Canal communautaire global (#global-lobby) + jusqu'à 3 salons de jeux actifs
 * - Présence enrichie : indique si le joueur est au salon, à quel jeu il joue actuellement,
 *   et la liste de tous les jeux sélectionnés où il est actif pour jouer
 * - Messagerie communautaire temps réel avec rangs, drapeaux, mentions @pseudo & commandes /gg, /afk, /ready
 * - Défis 15s & Signaling WebRTC Rollback P2P
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { getCurrentUserProfile, subscribeAuthProfile, updateUserProfile } from './authService';

const MAX_ACTIVE_CHANNELS = 3;
const CHANNELS_KEY = 'csw_fc_channels_v1';
export const GLOBAL_CHANNEL_ID = 'global-lobby';

export const GLOBAL_CHANNEL = {
  gameId: GLOBAL_CHANNEL_ID,
  title: 'Salon Communautaire Global',
  platformLabel: 'FIGHTCADE 2 · GLOBAL',
  filename: '',
  isGlobal: true,
};

export function getPlayerIdentity() {
  const p = getCurrentUserProfile();
  return {
    uid: p.uid,
    name: p.displayName || p.name || 'Joueur',
    region: p.region || 'FR',
    rank: p.rank || 'B',
    photoURL: p.photoURL || null,
    isAuthenticated: Boolean(p.isAuthenticated),
  };
}

export function setPlayerDisplayName(newName) {
  updateUserProfile({ displayName: newName });
}

export function playChallengeSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.09);
      gain.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.09 + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.09);
      osc.stop(ctx.currentTime + i * 0.09 + 0.26);
    });
  } catch {
    /* noop */
  }
}

export function normalizeGameChannelId(gameEntry) {
  return String(gameEntry?.id || gameEntry?.gameId || gameEntry?.title || 'arcade')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
}

class FirebaseFightcadeService {
  constructor() {
    this.identity = getPlayerIdentity();
    this.activeChannels = this.loadSavedChannels();
    this.currentPlayingGame = null; // { gameId, title, platformLabel, isNetplay, opponentName }
    this.customStatus = 'available'; // 'available' | 'afk'
    this.heartbeats = new Map();
    this.channelListeners = new Set();

    // Toujours maintenir la présence dans le salon global + les salons actifs
    this.startHeartbeat(GLOBAL_CHANNEL_ID);
    this.activeChannels.forEach((ch) => {
      this.startHeartbeat(ch.gameId);
    });

    subscribeAuthProfile((profile) => {
      const prevUid = this.identity?.uid;
      this.identity = {
        uid: profile.uid,
        name: profile.displayName || profile.name || 'Joueur',
        region: profile.region || 'FR',
        rank: profile.rank || 'B',
        photoURL: profile.photoURL || null,
        isAuthenticated: Boolean(profile.isAuthenticated),
      };
      if (prevUid && prevUid !== this.identity.uid) {
        deleteDoc(doc(db, 'fc_lobbies', GLOBAL_CHANNEL_ID, 'users', prevUid)).catch(() => {});
        this.activeChannels.forEach((ch) => {
          deleteDoc(doc(db, 'fc_lobbies', ch.gameId, 'users', prevUid)).catch(() => {});
        });
      }
      this.refreshAllPresences();
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        deleteDoc(doc(db, 'fc_lobbies', GLOBAL_CHANNEL_ID, 'users', this.identity.uid)).catch(() => {});
        this.activeChannels.forEach((ch) => {
          deleteDoc(doc(db, 'fc_lobbies', ch.gameId, 'users', this.identity.uid)).catch(() => {});
        });
      });
    }
  }

  loadSavedChannels() {
    try {
      const raw = localStorage.getItem(CHANNELS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(0, MAX_ACTIVE_CHANNELS) : [];
    } catch {
      return [];
    }
  }

  saveChannels() {
    try {
      localStorage.setItem(CHANNELS_KEY, JSON.stringify(this.activeChannels));
    } catch {
      /* noop */
    }
    this.channelListeners.forEach((cb) => cb([...this.activeChannels]));
  }

  subscribeActiveChannels(cb) {
    this.channelListeners.add(cb);
    cb([...this.activeChannels]);
    return () => this.channelListeners.delete(cb);
  }

  getActiveChannels() {
    return [...this.activeChannels];
  }

  applySyncedChannels(remoteChannels) {
    if (!Array.isArray(remoteChannels)) return false;
    const clean = remoteChannels.slice(0, MAX_ACTIVE_CHANNELS).filter((c) => c && c.gameId);
    const curIds = this.activeChannels.map((c) => c.gameId).join(',');
    const nextIds = clean.map((c) => c.gameId).join(',');
    if (curIds === nextIds) return false;
    this.activeChannels.forEach((ch) => {
      if (!clean.some((n) => n.gameId === ch.gameId)) {
        this.stopHeartbeat(ch.gameId);
      }
    });
    this.activeChannels = clean;
    this.saveChannels();
    this.activeChannels.forEach((ch) => {
      this.startHeartbeat(ch.gameId);
    });
    return true;
  }

  getActiveGamesSummary() {
    const list = this.activeChannels.map((c) => ({
      gameId: c.gameId,
      title: c.title,
      platformLabel: c.platformLabel || 'Arcade',
    }));
    if (
      this.currentPlayingGame &&
      !list.some((g) => g.gameId === this.currentPlayingGame.gameId)
    ) {
      list.unshift({
        gameId: this.currentPlayingGame.gameId,
        title: this.currentPlayingGame.title,
        platformLabel: this.currentPlayingGame.platformLabel || 'Arcade',
      });
    }
    return list;
  }

  getEffectiveStatus() {
    if (this.currentPlayingGame) {
      return this.currentPlayingGame.isNetplay ? 'playing' : 'in_game_available';
    }
    return this.customStatus === 'afk' ? 'afk' : 'available';
  }

  async refreshAllPresences() {
    await this.upsertPresence(GLOBAL_CHANNEL_ID);
    for (const ch of this.activeChannels) {
      await this.upsertPresence(ch.gameId);
    }
  }

  async joinChannel(gameEntry, { silent = false, autoReplaceOldest = false } = {}) {
    if (!gameEntry) return { ok: false };
    if (gameEntry.gameId === GLOBAL_CHANNEL_ID || gameEntry.id === GLOBAL_CHANNEL_ID) {
      await this.upsertPresence(GLOBAL_CHANNEL_ID);
      return { ok: true, channel: GLOBAL_CHANNEL };
    }

    const gameId = normalizeGameChannelId(gameEntry);

    const existing = this.activeChannels.find((c) => c.gameId === gameId);
    if (existing) {
      await this.refreshAllPresences();
      return { ok: true, channel: existing };
    }

    if (this.activeChannels.length >= MAX_ACTIVE_CHANNELS) {
      if (autoReplaceOldest && this.activeChannels.length > 0) {
        const oldest = this.activeChannels[0];
        await this.leaveChannel(oldest.gameId, { silent: true });
      } else {
        return { ok: false, reason: 'MAX_3_CHANNELS', activeChannels: [...this.activeChannels] };
      }
    }

    const channel = {
      gameId,
      title: gameEntry.title || gameId,
      platformLabel: gameEntry.platformLabel || 'Arcade',
      filename: gameEntry.filename || '',
      entry: gameEntry,
      joinedAt: Date.now(),
    };

    this.activeChannels = [...this.activeChannels, channel];
    this.saveChannels();
    this.startHeartbeat(gameId);
    await this.refreshAllPresences();

    if (!silent) {
      const gamesList = this.getActiveGamesSummary().map((g) => g.title).join(', ');
      this.sendMessage(
        gameId,
        `🟢 ${this.identity.name} [${this.identity.rank}] a rejoint le salon #${channel.title} (Actif sur : ${gamesList})`,
        'system'
      ).catch(() => {});
    }
    return { ok: true, channel };
  }

  async leaveChannel(gameId, { silent = false } = {}) {
    if (gameId === GLOBAL_CHANNEL_ID) return;
    const target = this.activeChannels.find((c) => c.gameId === gameId);
    this.stopHeartbeat(gameId);
    this.activeChannels = this.activeChannels.filter((c) => c.gameId !== gameId);
    this.saveChannels();
    await deleteDoc(doc(db, 'fc_lobbies', gameId, 'users', this.identity.uid)).catch(() => {});
    await this.refreshAllPresences();
    if (!silent && target) {
      this.sendMessage(gameId, `⚪ ${this.identity.name} a quitté le salon.`, 'system').catch(() => {});
    }
  }

  /**
   * Appelé dès que le joueur lance un jeu (en solo/training ou en match P2P) :
   * - L'inscrit automatiquement comme actif dans le salon de ce jeu
   * - Affiche aux autres joueurs qu'il est "Au salon & En jeu sur [Titre]" et prêt à être défié
   */
  async setActivePlayingGame(gameEntry, { isNetplay = false, opponentName = null } = {}) {
    if (!gameEntry) return;
    const gameId = normalizeGameChannelId(gameEntry);
    const title = gameEntry.title || gameId;
    const platformLabel = gameEntry.platformLabel || gameEntry.core?.toUpperCase() || 'Arcade';

    // Rejoindre automatiquement le salon du jeu lancé (en remplaçant le plus ancien si 3 salons sont déjà pleins)
    await this.joinChannel(
      { ...gameEntry, id: gameId, title, platformLabel },
      { silent: true, autoReplaceOldest: true }
    );

    this.currentPlayingGame = {
      gameId,
      title,
      platformLabel,
      isNetplay: Boolean(isNetplay),
      opponentName: opponentName || null,
      startedAt: Date.now(),
    };

    await this.refreshAllPresences();

    const activeTitles = this.getActiveGamesSummary().map((g) => g.title).join(' · ');
    const announcement = isNetplay
      ? `⚔️ Match P2P en cours : ${this.identity.name} vs ${opponentName || 'Adversaire'} sur « ${title} » !`
      : `🎮 ${this.identity.name} est au salon et joue à « ${title} » (Actif pour jouer sur : ${activeTitles})`;

    this.sendMessage(gameId, announcement, 'system').catch(() => {});
    this.sendMessage(GLOBAL_CHANNEL_ID, announcement, 'system').catch(() => {});
  }

  async clearActivePlayingGame() {
    if (!this.currentPlayingGame) return;
    this.currentPlayingGame = null;
    await this.refreshAllPresences();
  }

  async setCustomStatus(status) {
    this.customStatus = status === 'afk' ? 'afk' : 'available';
    await this.refreshAllPresences();
  }

  _localMsgKey(gameId) {
    return `csw_fc_msgs_v1_${gameId}`;
  }

  _readLocalMsgs(gameId) {
    try {
      const raw = localStorage.getItem(this._localMsgKey(gameId));
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  _saveLocalMsg(gameId, msg) {
    try {
      const cur = this._readLocalMsgs(gameId);
      if (!cur.some((m) => m.id === msg.id)) {
        const next = [...cur, msg].slice(-80);
        localStorage.setItem(this._localMsgKey(gameId), JSON.stringify(next));
      }
    } catch {
      /* noop */
    }
  }

  _emitLocalBus(payload) {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('csw_fc_lobby_bus_v1');
        bc.postMessage(payload);
        bc.close();
      }
      window.dispatchEvent(new CustomEvent('csw-fc-lobby-event', { detail: payload }));
    } catch {
      /* noop */
    }
  }

  async upsertPresence(gameId, explicitStatus = null, matchMeta = null) {
    this.identity = getPlayerIdentity();
    const status = explicitStatus || this.getEffectiveStatus();
    const activeGames = this.getActiveGamesSummary();
    const userPayload = {
      uid: this.identity.uid,
      name: this.identity.name,
      region: this.identity.region,
      rank: this.identity.rank || 'D',
      photoURL: this.identity.photoURL || null,
      isAuthenticated: Boolean(this.identity.isAuthenticated),
      status, // 'available' | 'in_game_available' | 'playing' | 'afk'
      currentGame: this.currentPlayingGame,
      activeGames,
      matchMeta: matchMeta || (this.currentPlayingGame?.isNetplay ? this.currentPlayingGame : null),
      lastSeen: Date.now(),
      ping: Math.floor(14 + Math.random() * 20),
    };

    // 1. Relais serveur local / LAN (toujours actif même sans règles Firestore publiées)
    fetch(`/api/fc-lobby?gameId=${encodeURIComponent(gameId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'presence', gameId, user: userPayload }),
    }).catch(() => {});
    this._emitLocalBus({ kind: 'presence', gameId, user: userPayload });

    // 2. Synchronisation cloud Firebase Firestore
    const ref = doc(db, 'fc_lobbies', gameId, 'users', this.identity.uid);
    await setDoc(ref, userPayload, { merge: true }).catch(() => {});
  }

  startHeartbeat(gameId) {
    this.stopHeartbeat(gameId);
    this.upsertPresence(gameId);
    const id = setInterval(() => {
      this.upsertPresence(gameId);
    }, 15000);
    this.heartbeats.set(gameId, id);
  }

  stopHeartbeat(gameId) {
    const id = this.heartbeats.get(gameId);
    if (id) clearInterval(id);
    this.heartbeats.delete(gameId);
  }

  subscribeChannelUsers(gameId, cb) {
    let firestoreUsers = [];
    let relayUsers = [];

    const emitMerged = () => {
      const now = Date.now();
      const map = new Map();
      [...relayUsers, ...firestoreUsers].forEach((u) => {
        if (u && u.uid && now - (u.lastSeen || 0) < 65000) {
          const prev = map.get(u.uid);
          if (!prev || (u.lastSeen || 0) >= (prev.lastSeen || 0)) {
            map.set(u.uid, u);
          }
        }
      });
      // Toujours inclure soi-même si connecté au salon
      const me = getPlayerIdentity();
      if (!map.has(me.uid)) {
        map.set(me.uid, {
          uid: me.uid,
          name: me.name,
          region: me.region,
          rank: me.rank || 'D',
          status: this.getEffectiveStatus(),
          currentGame: this.currentPlayingGame,
          activeGames: this.getActiveGamesSummary(),
          lastSeen: now,
          ping: 16,
        });
      }
      const order = { in_game_available: 0, available: 1, playing: 2, afk: 3 };
      const list = Array.from(map.values()).sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
      cb(list);
    };

    const pullRelay = async () => {
      try {
        const res = await fetch(`/api/fc-lobby?gameId=${encodeURIComponent(gameId)}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.users)) {
            relayUsers = data.users;
            emitMerged();
          }
        }
      } catch {
        emitMerged();
      }
    };

    pullRelay();
    const pollId = setInterval(pullRelay, 4000);

    const onLocalEv = (e) => {
      const d = e?.detail || e?.data;
      if (d?.kind === 'presence' && d.gameId === gameId && d.user) {
        relayUsers = [...relayUsers.filter((u) => u.uid !== d.user.uid), d.user];
        emitMerged();
      }
    };
    window.addEventListener('csw-fc-lobby-event', onLocalEv);
    let bc = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('csw_fc_lobby_bus_v1');
        bc.onmessage = onLocalEv;
      }
    } catch {}

    const q = query(collection(db, 'fc_lobbies', gameId, 'users'));
    const unsubFs = onSnapshot(
      q,
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push(d.data()));
        firestoreUsers = list;
        emitMerged();
      },
      () => emitMerged()
    );

    return () => {
      clearInterval(pollId);
      window.removeEventListener('csw-fc-lobby-event', onLocalEv);
      try { bc?.close(); } catch {}
      unsubFs?.();
    };
  }

  subscribeChannelMessages(gameId, cb) {
    let firestoreMsgs = [];
    let relayMsgs = this._readLocalMsgs(gameId);

    const emitMerged = () => {
      const map = new Map();
      [...relayMsgs, ...firestoreMsgs].forEach((m) => {
        if (!m || !m.text) return;
        const key = m.id || `${m.uid}_${m.createdAtMs}_${m.text}`;
        if (!map.has(key)) map.set(key, m);
      });
      const sorted = Array.from(map.values())
        .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0))
        .slice(-80);
      cb(sorted);
    };

    const pullRelay = async () => {
      try {
        const res = await fetch(`/api/fc-lobby?gameId=${encodeURIComponent(gameId)}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.messages)) {
            relayMsgs = [...this._readLocalMsgs(gameId), ...data.messages];
            emitMerged();
          }
        }
      } catch {
        emitMerged();
      }
    };

    emitMerged();
    pullRelay();
    const pollId = setInterval(pullRelay, 2500);

    const onLocalEv = (e) => {
      const d = e?.detail || e?.data;
      if (d?.kind === 'message' && d.gameId === gameId && d.message) {
        relayMsgs = [...relayMsgs, d.message];
        emitMerged();
      }
    };
    window.addEventListener('csw-fc-lobby-event', onLocalEv);
    let bc = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('csw_fc_lobby_bus_v1');
        bc.onmessage = onLocalEv;
      }
    } catch {}

    const q = query(collection(db, 'fc_lobbies', gameId, 'messages'), orderBy('createdAtMs', 'asc'), limit(80));
    const unsubFs = onSnapshot(
      q,
      (snap) => {
        const msgs = [];
        snap.forEach((d) => msgs.push({ id: d.id, ...d.data() }));
        firestoreMsgs = msgs;
        emitMerged();
      },
      () => emitMerged()
    );

    return () => {
      clearInterval(pollId);
      window.removeEventListener('csw-fc-lobby-event', onLocalEv);
      try { bc?.close(); } catch {}
      unsubFs?.();
    };
  }

  async sendMessage(gameId, text, type = 'chat', extra = {}) {
    const clean = String(text || '').trim();
    if (!clean) return;
    this.identity = getPlayerIdentity();
    const activeGames = this.getActiveGamesSummary();
    const now = Date.now();
    const msgId = `m_${now}_${Math.random().toString(36).slice(2, 7)}`;

    const msgObj = {
      id: msgId,
      uid: this.identity.uid,
      name: this.identity.name,
      region: this.identity.region || 'FR',
      rank: this.identity.rank || 'D',
      currentGameTitle: this.currentPlayingGame?.title || null,
      activeGames: activeGames.map((g) => g.title),
      text: clean,
      type, // 'chat' | 'system' | 'challenge'
      ...extra,
      createdAtMs: now,
    };

    // 1. Affichage instantané local + diffusion multi-onglets + relais LAN /api/fc-lobby
    this._saveLocalMsg(gameId, msgObj);
    this._emitLocalBus({ kind: 'message', gameId, message: msgObj });
    fetch(`/api/fc-lobby?gameId=${encodeURIComponent(gameId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'message', gameId, message: msgObj }),
    }).catch(() => {});

    // 2. Écriture cloud Firebase Firestore (silencieuse si règles non publiées)
    addDoc(collection(db, 'fc_lobbies', gameId, 'messages'), {
      ...msgObj,
      createdAt: serverTimestamp(),
    }).catch(() => {});
  }

  async sendChallenge(gameId, targetUser, gameEntry) {
    this.identity = getPlayerIdentity();
    const challengeId = `ch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const gameTitle = gameEntry?.title || targetUser?.currentGame?.title || gameId;
    const ref = doc(db, 'fc_challenges', challengeId);
    await setDoc(ref, {
      challengeId,
      gameId,
      gameTitle,
      fromUid: this.identity.uid,
      fromName: this.identity.name,
      fromRank: this.identity.rank || 'B',
      toUid: targetUser.uid,
      toName: targetUser.name,
      status: 'pending', // 'pending' | 'accepted' | 'declined' | 'expired'
      expiresAt: Date.now() + 15000,
      createdAt: Date.now(),
      offer: null,
      answer: null,
    });

    this.sendMessage(
      gameId,
      `⚔️ ${this.identity.name} [${this.identity.rank}] défie @${targetUser.name} sur « ${gameTitle} » (15s) !`,
      'challenge'
    ).catch(() => {});

    return challengeId;
  }

  subscribeIncomingChallenges(cb) {
    this.identity = getPlayerIdentity();
    const q = query(
      collection(db, 'fc_challenges'),
      where('toUid', '==', this.identity.uid),
      where('status', '==', 'pending')
    );
    return onSnapshot(
      q,
      (snap) => {
        const now = Date.now();
        const list = [];
        snap.forEach((d) => {
          const c = d.data();
          if (c && c.expiresAt > now) list.push(c);
        });
        cb(list);
      },
      () => cb([])
    );
  }

  subscribeChallenge(challengeId, cb) {
    return onSnapshot(doc(db, 'fc_challenges', challengeId), (snap) => {
      if (snap.exists()) cb(snap.data());
    });
  }

  async respondChallenge(challengeId, accept = true) {
    await updateDoc(doc(db, 'fc_challenges', challengeId), {
      status: accept ? 'accepted' : 'declined',
    });
  }

  async postOffer(challengeId, offer) {
    await updateDoc(doc(db, 'fc_challenges', challengeId), { offer });
  }

  async postAnswer(challengeId, answer) {
    await updateDoc(doc(db, 'fc_challenges', challengeId), { answer });
  }

  async postIceCandidate(challengeId, role, candidate) {
    if (!candidate) return;
    const subCol = role === 'caller' ? 'callerCandidates' : 'calleeCandidates';
    await addDoc(collection(db, 'fc_challenges', challengeId, subCol), candidate.toJSON());
  }

  subscribeIceCandidates(challengeId, remoteRole, cb) {
    const subCol = remoteRole === 'caller' ? 'callerCandidates' : 'calleeCandidates';
    return onSnapshot(collection(db, 'fc_challenges', challengeId, subCol), (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === 'added') {
          cb(change.doc.data());
        }
      });
    });
  }
}

export const firebaseFightcadeService = new FirebaseFightcadeService();
