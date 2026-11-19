/**
 * Pilier 3A : Salons Fightcade 2 sur Firebase Firestore (max 3 salons actifs, présence, chat, défis 15s, signaling WebRTC).
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

const MAX_ACTIVE_CHANNELS = 3;
const UID_KEY = 'csw_player_uid_v1';
const NAME_KEY = 'csw_player_name';
const CHANNELS_KEY = 'csw_fc_channels_v1';

export function getPlayerIdentity() {
  let uid = 'p_' + Math.random().toString(36).slice(2, 10);
  let name = 'Joueur';
  try {
    uid = localStorage.getItem(UID_KEY) || uid;
    localStorage.setItem(UID_KEY, uid);
    name = localStorage.getItem(NAME_KEY) || `Joueur_${uid.slice(-4).toUpperCase()}`;
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* noop */
  }
  return { uid, name, region: (navigator.language || 'fr').slice(0, 2).toUpperCase() };
}

export function setPlayerDisplayName(newName) {
  const clean = String(newName || '').trim().slice(0, 24);
  if (!clean) return;
  try {
    localStorage.setItem(NAME_KEY, clean);
  } catch {
    /* noop */
  }
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

class FirebaseFightcadeService {
  constructor() {
    this.identity = getPlayerIdentity();
    this.activeChannels = this.loadSavedChannels();
    this.heartbeats = new Map();
    this.channelListeners = new Set();

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
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

  async joinChannel(gameEntry) {
    const gameId = String(gameEntry.id || gameEntry.gameId || gameEntry.title)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-');

    const existing = this.activeChannels.find((c) => c.gameId === gameId);
    if (existing) {
      await this.upsertPresence(gameId, 'available');
      return { ok: true, channel: existing };
    }

    if (this.activeChannels.length >= MAX_ACTIVE_CHANNELS) {
      return { ok: false, reason: 'MAX_3_CHANNELS', activeChannels: [...this.activeChannels] };
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
    await this.upsertPresence(gameId, 'available');
    this.startHeartbeat(gameId);
    this.sendMessage(gameId, `${this.identity.name} a rejoint le salon.`, 'system').catch(() => {});
    return { ok: true, channel };
  }

  async leaveChannel(gameId) {
    this.stopHeartbeat(gameId);
    this.activeChannels = this.activeChannels.filter((c) => c.gameId !== gameId);
    this.saveChannels();
    await deleteDoc(doc(db, 'fc_lobbies', gameId, 'users', this.identity.uid)).catch(() => {});
  }

  async upsertPresence(gameId, status = 'available', matchMeta = null) {
    this.identity = getPlayerIdentity();
    const ref = doc(db, 'fc_lobbies', gameId, 'users', this.identity.uid);
    await setDoc(
      ref,
      {
        uid: this.identity.uid,
        name: this.identity.name,
        region: this.identity.region,
        status, // 'available' | 'playing' | 'afk'
        matchMeta,
        lastSeen: Date.now(),
        ping: Math.floor(14 + Math.random() * 24),
      },
      { merge: true }
    ).catch(() => {});
  }

  startHeartbeat(gameId) {
    this.stopHeartbeat(gameId);
    const id = setInterval(() => {
      this.upsertPresence(gameId, 'available');
    }, 15000);
    this.heartbeats.set(gameId, id);
  }

  stopHeartbeat(gameId) {
    const id = this.heartbeats.get(gameId);
    if (id) clearInterval(id);
    this.heartbeats.delete(gameId);
  }

  subscribeChannelUsers(gameId, cb) {
    const q = query(collection(db, 'fc_lobbies', gameId, 'users'));
    return onSnapshot(
      q,
      (snap) => {
        const now = Date.now();
        const users = [];
        snap.forEach((d) => {
          const u = d.data();
          if (u && now - (u.lastSeen || 0) < 60000) {
            users.push(u);
          }
        });
        const order = { available: 0, playing: 1, afk: 2 };
        users.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
        cb(users);
      },
      () => cb([])
    );
  }

  subscribeChannelMessages(gameId, cb) {
    const q = query(collection(db, 'fc_lobbies', gameId, 'messages'), orderBy('createdAtMs', 'asc'), limit(60));
    return onSnapshot(
      q,
      (snap) => {
        const msgs = [];
        snap.forEach((d) => msgs.push({ id: d.id, ...d.data() }));
        cb(msgs);
      },
      () => cb([])
    );
  }

  async sendMessage(gameId, text, type = 'chat') {
    const clean = String(text || '').trim();
    if (!clean) return;
    this.identity = getPlayerIdentity();
    await addDoc(collection(db, 'fc_lobbies', gameId, 'messages'), {
      uid: this.identity.uid,
      name: this.identity.name,
      text: clean,
      type,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
    });
  }

  async sendChallenge(gameId, targetUser, gameEntry) {
    this.identity = getPlayerIdentity();
    const challengeId = `ch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const ref = doc(db, 'fc_challenges', challengeId);
    await setDoc(ref, {
      challengeId,
      gameId,
      gameTitle: gameEntry?.title || gameId,
      fromUid: this.identity.uid,
      fromName: this.identity.name,
      toUid: targetUser.uid,
      toName: targetUser.name,
      status: 'pending', // 'pending' | 'accepted' | 'declined' | 'expired'
      expiresAt: Date.now() + 15000,
      createdAt: Date.now(),
      offer: null,
      answer: null,
    });
    return challengeId;
  }

  subscribeIncomingChallenges(cb) {
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
          if (c && (c.expiresAt || 0) > now) list.push(c);
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

  async respondChallenge(challengeId, accept) {
    await updateDoc(doc(db, 'fc_challenges', challengeId), {
      status: accept ? 'accepted' : 'declined',
      respondedAt: Date.now(),
    });
  }

  async postOffer(challengeId, offer) {
    await updateDoc(doc(db, 'fc_challenges', challengeId), {
      offer: { type: offer.type, sdp: offer.sdp },
    });
  }

  async postAnswer(challengeId, answer) {
    await updateDoc(doc(db, 'fc_challenges', challengeId), {
      answer: { type: answer.type, sdp: answer.sdp },
    });
  }

  async postIceCandidate(challengeId, role, candidate) {
    const subCol = role === 'caller' ? 'callerCandidates' : 'calleeCandidates';
    await addDoc(collection(db, 'fc_challenges', challengeId, subCol), candidate);
  }

  subscribeIceCandidates(challengeId, role, cb) {
    const subCol = role === 'caller' ? 'callerCandidates' : 'calleeCandidates';
    return onSnapshot(collection(db, 'fc_challenges', challengeId, subCol), (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === 'added') cb(change.doc.data());
      });
    });
  }
}

export const firebaseFightcadeService = new FirebaseFightcadeService();
