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
  notifyLocalFirestoreRemoteEvent,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from './localFirestore';
import { db } from '../config/firebase';
import { getCurrentUserProfile, getPlayerFriendCode, getPlayerFriendTag, subscribeAuthProfile, updateUserProfile } from './authService';
import { isJ2meGame, supportsOnlineMultiplayer } from '../utils/gameCapabilities';

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
  const displayName = p.displayName || p.name || 'Joueur';
  return {
    uid: p.uid,
    name: displayName,
    friendCode: p.friendCode || getPlayerFriendCode(p.uid),
    friendTag: p.friendTag || getPlayerFriendTag(displayName, p.uid),
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
    this.ws = null;
    this.wsConnected = false;
    this.wsQueue = [];
    this.wsReconnectDelay = 700;
    this.wsKeepaliveTimer = null;
    this.incomingChallengeListeners = new Set();
    this.challengeListeners = new Map();
    this.matchSyncListeners = new Map();
    this.rtcSignalListeners = new Map();
    this.spectateListeners = new Set();
    this.spectateChunks = new Map();
    this.friendEventListeners = new Set();
    this.relayInputListener = null;

    // Toujours maintenir la présence dans le salon global + les salons actifs
    this.startHeartbeat(GLOBAL_CHANNEL_ID);
    this.activeChannels.forEach((ch) => {
      this.startHeartbeat(ch.gameId);
    });

    this.initWebSocket();

    subscribeAuthProfile((profile) => {
      const prevUid = this.identity?.uid;
      const displayName = profile.displayName || profile.name || 'Joueur';
      this.identity = {
        uid: profile.uid,
        name: displayName,
        friendCode: profile.friendCode || getPlayerFriendCode(profile.uid),
        friendTag: profile.friendTag || getPlayerFriendTag(displayName, profile.uid),
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
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.identity?.uid) {
        this.sendWs({
          type: 'IDENTIFY',
          uid: this.identity.uid,
          name: this.identity.name,
          region: this.identity.region || 'FR',
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

  initWebSocket() {
    if (typeof window === 'undefined') return;
    try {
      const envWs = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_NETPLAY_WS_URL : '';
      const isHttps = window.location.protocol === 'https:';
      const wsProto = isHttps ? 'wss:' : 'ws:';
      const wsUrl = envWs ? envWs : `${wsProto}//${window.location.host}/ws/netplay`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.wsConnected = true;
        this.wsReconnectDelay = 700;
        this.sendWs({
          type: 'IDENTIFY',
          uid: this.identity?.uid,
          name: this.identity?.name,
          region: this.identity?.region || 'FR',
        });
        while (this.wsQueue.length > 0) {
          const item = this.wsQueue.shift();
          try { this.ws.send(JSON.stringify(item)); } catch {}
        }
        if (this.wsKeepaliveTimer) clearInterval(this.wsKeepaliveTimer);
        this.wsKeepaliveTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try { this.ws.send(JSON.stringify({ type: 'PING', clientTime: Date.now() })); } catch {}
          }
        }, 20000);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleWsMessage(data);
        } catch {}
      };

      this.ws.onclose = () => {
        this.wsConnected = false;
        if (this.wsKeepaliveTimer) {
          clearInterval(this.wsKeepaliveTimer);
          this.wsKeepaliveTimer = null;
        }
        const delay = this.wsReconnectDelay || 700;
        this.wsReconnectDelay = Math.min(8000, Math.round(delay * 1.5));
        setTimeout(() => this.initWebSocket(), delay);
      };

      this.ws.onerror = () => {
        this.wsConnected = false;
      };
    } catch {
      const delay = this.wsReconnectDelay || 1200;
      this.wsReconnectDelay = Math.min(8000, Math.round(delay * 1.5));
      setTimeout(() => this.initWebSocket(), delay);
    }
  }

  sendWs(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      // Ne jamais encombrer la file d'attente de reconnexion avec des paquets GGPO/PING temps-réel périmés
      if (
        (data?.type === 'RELAY_INPUT' && (data.packetHex || data.syncType === 'PING' || data.syncType === 'PONG')) ||
        data?.type === 'SPECTATE_INPUT_BATCH'
      ) {
        return;
      }
      if (this.wsQueue.length >= 60) {
        this.wsQueue.shift();
      }
      this.wsQueue.push(data);
    }
  }

  handleWsMessage(data) {
    if (!data || !data.type) return;

    if (data.type === 'LOCAL_FS_EVENT') {
      notifyLocalFirestoreRemoteEvent(data);
      return;
    }

    if (data.type === 'INCOMING_CHALLENGE' && data.challenge) {
      if (data.challenge.fromUid !== this.identity.uid) {
        this.incomingChallengeListeners.forEach((cb) => {
          try { cb([data.challenge]); } catch {}
        });
      }
    } else if (data.type === 'CHALLENGE_STATUS_CHANGED') {
      const listeners = this.challengeListeners.get(data.challengeId);
      if (listeners) {
        listeners.forEach((cb) => {
          try { cb(data.challenge || { status: data.status, challengeId: data.challengeId }); } catch {}
        });
      }
    } else if (
      data.type === 'MATCH_SYNC_UPDATE' ||
      data.type === 'MATCH_COUNTDOWN_START' ||
      data.type === 'MATCH_CANCELLED'
    ) {
      const listeners = this.matchSyncListeners.get(data.challengeId);
      if (listeners) {
        listeners.forEach((cb) => {
          try { cb(data); } catch {}
        });
      }
    } else if (data.type === 'RTC_SIGNAL' && data.challengeId) {
      const listeners = this.rtcSignalListeners.get(data.challengeId);
      if (listeners) {
        listeners.forEach((cb) => {
          try { cb(data); } catch {}
        });
      }
    } else if (data.type === 'REMOTE_BTN_RELAY') {
      this.relayInputListener?.(data);
    } else if (data.type === 'SPECTATE_STATE_CHUNK') {
      this._handleSpectateStateChunk(data);
    } else if (data.type === 'FRIEND_EVENT') {
      this.friendEventListeners.forEach((cb) => {
        try { cb(data); } catch {}
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('csw-friend-event', { detail: data }));
      }
    } else if (
      data.type === 'SPECTATE_COUNT_UPDATE' ||
      data.type === 'SPECTATE_SNAPSHOT_REQ' ||
      data.type === 'SPECTATE_INPUT_BATCH' ||
      data.type === 'SPECTATE_ENDED' ||
      data.type === 'SPECTATE_UNAVAILABLE'
    ) {
      this.spectateListeners.forEach((cb) => {
        try { cb(data); } catch {}
      });
    }
  }

  _handleSpectateStateChunk(data) {
    const { transferId, chunkIndex, chunkTotal, stateBase64, syncFrame, matchKey, challengeId } = data || {};
    if (!transferId || typeof chunkIndex !== 'number' || !chunkTotal || !stateBase64) return;
    let entry = this.spectateChunks.get(transferId);
    if (!entry) {
      entry = {
        total: chunkTotal,
        syncFrame: Number(syncFrame || 0),
        matchKey: matchKey || null,
        challengeId: challengeId || null,
        chunks: new Map(),
      };
      this.spectateChunks.set(transferId, entry);
      if (this.spectateChunks.size > 6) {
        const firstKey = this.spectateChunks.keys().next().value;
        this.spectateChunks.delete(firstKey);
      }
    }
    entry.chunks.set(chunkIndex, stateBase64);
    if (entry.chunks.size === entry.total) {
      const parts = [];
      for (let i = 0; i < entry.total; i++) {
        if (!entry.chunks.has(i)) return;
        parts.push(entry.chunks.get(i));
      }
      this.spectateChunks.delete(transferId);
      const assembled = parts.join('');
      const event = {
        type: 'SPECTATE_STATE',
        transferId,
        stateBase64: assembled,
        syncFrame: entry.syncFrame,
        matchKey: entry.matchKey,
        challengeId: entry.challengeId,
      };
      this.spectateListeners.forEach((cb) => {
        try { cb(event); } catch {}
      });
    }
  }

  sendMatchSyncUpdate(challengeId, targetUid, { romPct = 0, romReady = false, isReady = false } = {}) {
    this.sendWs({
      type: 'MATCH_SYNC_UPDATE',
      challengeId,
      targetUid,
      romPct,
      romReady: Boolean(romReady),
      isReady: Boolean(isReady),
    });

    // Fallback Firestore garanti (si WebSocket VPS absent/coupé)
    if (challengeId && (romReady || isReady || romPct === 0 || romPct >= 100 || romPct % 25 === 0)) {
      const myUid = this.identity?.uid;
      if (myUid) {
        updateDoc(doc(db, 'fc_challenges', challengeId), {
          [`syncByUid.${myUid}`]: {
            romPct: Number(romPct) || 0,
            romReady: Boolean(romReady),
            isReady: Boolean(isReady),
            updatedAtMs: Date.now(),
          },
        }).catch(() => {});
      }
    }
  }

  sendMatchCountdownStart(challengeId, targetUid) {
    this.sendWs({
      type: 'MATCH_COUNTDOWN_START',
      challengeId,
      targetUid,
    });
    if (challengeId) {
      updateDoc(doc(db, 'fc_challenges', challengeId), {
        countdownStartedAt: Date.now(),
      }).catch(() => {});
    }
  }

  sendMatchCancel(challengeId, targetUid) {
    this.sendWs({
      type: 'MATCH_CANCEL',
      challengeId,
      targetUid,
    });
    if (challengeId) {
      updateDoc(doc(db, 'fc_challenges', challengeId), {
        status: 'cancelled',
      }).catch(() => {});
    }
  }

  subscribeMatchSync(challengeId, cb) {
    if (!this.matchSyncListeners.has(challengeId)) {
      this.matchSyncListeners.set(challengeId, new Set());
    }
    this.matchSyncListeners.get(challengeId).add(cb);

    let countdownTriggered = false;
    let cancelTriggered = false;
    const myUid = this.identity?.uid;

    const unsubFs = onSnapshot(
      doc(db, 'fc_challenges', challengeId),
      (snap) => {
        if (!snap.exists()) return;
        const ch = snap.data();
        if (ch.syncByUid && typeof ch.syncByUid === 'object') {
          for (const [uid, st] of Object.entries(ch.syncByUid)) {
            if (uid !== myUid && st) {
              cb({
                type: 'MATCH_SYNC_UPDATE',
                challengeId,
                romPct: st.romPct,
                romReady: st.romReady,
                isReady: st.isReady,
              });
            }
          }
        }
        if (ch.countdownStartedAt && !countdownTriggered) {
          countdownTriggered = true;
          cb({ type: 'MATCH_COUNTDOWN_START', challengeId });
        }
        if (ch.status === 'cancelled' && !cancelTriggered) {
          cancelTriggered = true;
          cb({ type: 'MATCH_CANCELLED', challengeId });
        }
      },
      () => {}
    );

    return () => {
      const set = this.matchSyncListeners.get(challengeId);
      if (set) {
        set.delete(cb);
        if (set.size === 0) this.matchSyncListeners.delete(challengeId);
      }
      unsubFs?.();
    };
  }

  sendRelayInput(targetUid, payload = {}) {
    this.sendWs({
      type: 'RELAY_INPUT',
      targetUid,
      ...payload,
    });
  }

  onRelayInput(cb) {
    this.relayInputListener = cb;
  }

  subscribeSpectate(cb) {
    if (typeof cb !== 'function') return () => {};
    this.spectateListeners.add(cb);
    return () => {
      this.spectateListeners.delete(cb);
    };
  }

  registerSpectateMatch({ challengeId, hostUid, guestUid, isHost } = {}) {
    this.sendWs({
      type: 'SPECTATE_HOST_REGISTER',
      challengeId: challengeId || null,
      hostUid: hostUid || null,
      guestUid: guestUid || null,
      isHost: Boolean(isHost),
    });
  }

  joinSpectate({ challengeId, hostUid, targetUid, spectatorName } = {}) {
    this.sendWs({
      type: 'SPECTATE_JOIN',
      challengeId: challengeId || null,
      hostUid: hostUid || null,
      targetUid: targetUid || null,
      spectatorName: spectatorName || this.identity?.name || 'Spectateur',
    });
  }

  requestSpectateResync({ challengeId, hostUid } = {}) {
    this.sendWs({
      type: 'SPECTATE_RESYNC_REQ',
      challengeId: challengeId || null,
      hostUid: hostUid || null,
    });
  }

  leaveSpectate({ challengeId, matchKey } = {}) {
    this.spectateChunks.clear();
    this.sendWs({
      type: 'SPECTATE_LEAVE',
      challengeId: challengeId || null,
      matchKey: matchKey || null,
    });
  }

  async sendSpectatorState(stateBase64, syncFrame = 0, { challengeId = null, targetUid = null } = {}) {
    if (!stateBase64) return;
    const CHUNK_SIZE = 24576;
    const total = Math.ceil(stateBase64.length / CHUNK_SIZE);
    const transferId = `sp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${Number(syncFrame || 0)}`;
    for (let i = 0; i < total; i++) {
      const chunk = stateBase64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      this.sendWs({
        type: 'SPECTATE_STATE_CHUNK',
        challengeId,
        targetUid,
        transferId,
        chunkIndex: i,
        chunkTotal: total,
        stateBase64: chunk,
        syncFrame: Number(syncFrame || 0),
      });
      if (i + 1 < total) {
        await new Promise((r) => setTimeout(r, 8));
      }
    }
  }

  sendSpectatorInputBatch({ challengeId = null, frames = [] } = {}) {
    if (!Array.isArray(frames) || frames.length === 0) return;
    this.sendWs({
      type: 'SPECTATE_INPUT_BATCH',
      challengeId,
      frames,
    });
  }

  loadSavedChannels() {
    try {
      const raw = localStorage.getItem(CHANNELS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      const clean = parsed
        .filter((c) => c && c.gameId && !isJ2meGame(c.entry || c) && supportsOnlineMultiplayer(c.entry || c))
        .slice(0, MAX_ACTIVE_CHANNELS);
      if (clean.length !== parsed.length) {
        try {
          localStorage.setItem(CHANNELS_KEY, JSON.stringify(clean));
        } catch {
          /* noop */
        }
      }
      return clean;
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
    const clean = remoteChannels
      .filter((c) => c && c.gameId && !isJ2meGame(c.entry || c) && supportsOnlineMultiplayer(c.entry || c))
      .slice(0, MAX_ACTIVE_CHANNELS);
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

  revalidateChannelsWithCatalog(catalogItems = []) {
    if (!Array.isArray(catalogItems) || catalogItems.length === 0 || this.activeChannels.length === 0) return;
    const byId = new Map();
    const byChannelId = new Map();
    for (const item of catalogItems) {
      if (!item) continue;
      if (item.id) byId.set(item.id, item);
      byChannelId.set(normalizeGameChannelId(item), item);
    }

    let changed = false;
    const kept = [];
    for (const ch of this.activeChannels) {
      const matched = byId.get(ch.entry?.id) || byChannelId.get(ch.gameId) || null;
      const candidate = matched ? { ...(ch.entry || {}), ...matched } : ch.entry || ch;
      if (isJ2meGame(candidate) || !supportsOnlineMultiplayer(candidate)) {
        this.stopHeartbeat(ch.gameId);
        deleteDoc(doc(db, 'fc_lobbies', ch.gameId, 'users', this.identity.uid)).catch(() => {});
        changed = true;
      } else {
        const updatedEntry = matched ? { ...(ch.entry || {}), ...matched } : ch.entry;
        if (matched && ch.entry?.supportsMultiplayer !== matched.supportsMultiplayer) {
          changed = true;
        }
        kept.push({ ...ch, entry: updatedEntry });
      }
    }

    if (changed) {
      this.activeChannels = kept;
      this.saveChannels();
      this.refreshAllPresences();
    }
  }

  getActiveGamesSummary() {
    const list = this.activeChannels
      .filter((c) => c && !isJ2meGame(c.entry || c) && supportsOnlineMultiplayer(c.entry || c))
      .map((c) => ({
        id: c.entry?.id || c.gameId,
        gameId: c.gameId,
        title: c.title,
        platformLabel: c.platformLabel || c.entry?.platformLabel || 'Arcade',
        filename: c.filename || c.entry?.filename || '',
        core: c.entry?.core || c.entry?.platform || 'fbneo',
        platform: c.entry?.platform || c.entry?.core || 'fbneo',
        players: c.entry?.players || '1–2J',
        supportsMultiplayer: true,
        urls: Array.isArray(c.entry?.urls) ? c.entry.urls.slice(0, 4) : [],
      }));
    if (
      this.currentPlayingGame &&
      supportsOnlineMultiplayer(this.currentPlayingGame) &&
      !list.some((g) => g.gameId === this.currentPlayingGame.gameId)
    ) {
      list.unshift({
        id: this.currentPlayingGame.id || this.currentPlayingGame.gameId,
        gameId: this.currentPlayingGame.gameId,
        title: this.currentPlayingGame.title,
        platformLabel: this.currentPlayingGame.platformLabel || 'Arcade',
        filename: this.currentPlayingGame.filename || '',
        core: this.currentPlayingGame.core || 'fbneo',
        platform: this.currentPlayingGame.platform || this.currentPlayingGame.core || 'fbneo',
        players: this.currentPlayingGame.players || '1–2J',
        supportsMultiplayer: true,
        urls: Array.isArray(this.currentPlayingGame.urls) ? this.currentPlayingGame.urls.slice(0, 4) : [],
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
    if (isJ2meGame(gameEntry) || !supportsOnlineMultiplayer(gameEntry)) {
      return { ok: false, reason: 'SOLO_ONLY' };
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
  async setActivePlayingGame(
    gameEntry,
    { isNetplay = false, opponentName = null, opponentUid = null, challengeId = null, hostUid = null } = {}
  ) {
    if (!gameEntry || isJ2meGame(gameEntry) || !supportsOnlineMultiplayer(gameEntry)) {
      await this.clearActivePlayingGame();
      return { ok: false, reason: 'SOLO_ONLY' };
    }
    const gameId = normalizeGameChannelId(gameEntry);
    const title = gameEntry.title || gameId;
    const platformLabel = gameEntry.platformLabel || gameEntry.core?.toUpperCase() || 'Arcade';

    // Rejoindre automatiquement le salon du jeu lancé (en remplaçant le plus ancien si 3 salons sont déjà pleins)
    await this.joinChannel(
      { ...gameEntry, id: gameId, title, platformLabel, supportsMultiplayer: true },
      { silent: true, autoReplaceOldest: true }
    );

    this.currentPlayingGame = {
      id: gameEntry.id || gameId,
      gameId,
      title,
      platformLabel,
      filename: gameEntry.filename || '',
      core: gameEntry.core || gameEntry.platform || 'fbneo',
      platform: gameEntry.platform || gameEntry.core || 'fbneo',
      players: gameEntry.players || '1–2J',
      supportsMultiplayer: true,
      urls: Array.isArray(gameEntry.urls) ? gameEntry.urls.slice(0, 4) : [],
      isNetplay: Boolean(isNetplay),
      opponentName: opponentName || null,
      opponentUid: opponentUid || null,
      challengeId: challengeId || null,
      hostUid: hostUid || null,
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
      displayName: this.identity.name,
      friendCode: this.identity.friendCode || getPlayerFriendCode(this.identity.uid),
      friendTag: this.identity.friendTag || getPlayerFriendTag(this.identity.name, this.identity.uid),
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
      // Les utilisateurs reçus du serveur VPS sont déjà filtrés par le heartbeat du backend
      relayUsers.forEach((u) => {
        if (u && u.uid) {
          map.set(u.uid, u);
        }
      });
      firestoreUsers.forEach((u) => {
        if (u && u.uid && (Math.abs(now - (u.lastSeen || 0)) < 180000 || !u.lastSeen)) {
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
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('json')) {
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
    const pollId = setInterval(() => {
      if (!this.wsConnected) pullRelay();
    }, 12000);

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
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('json')) {
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
    const pollId = setInterval(() => {
      if (!this.wsConnected) pullRelay();
    }, 10000);

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
    const fallbackTargetGame =
      (targetUser?.currentGame?.gameId === gameId ? targetUser.currentGame : null) ||
      (Array.isArray(targetUser?.activeGames)
        ? targetUser.activeGames.find((g) => g.gameId === gameId || g.id === gameId)
        : null) ||
      this.activeChannels.find((c) => c.gameId === gameId)?.entry ||
      null;
    const mergedEntry = {
      ...(fallbackTargetGame || {}),
      ...(gameEntry || {}),
      urls:
        Array.isArray(gameEntry?.urls) && gameEntry.urls.length > 0
          ? gameEntry.urls
          : Array.isArray(fallbackTargetGame?.urls)
          ? fallbackTargetGame.urls
          : [],
      filename: gameEntry?.filename || fallbackTargetGame?.filename || '',
      core: gameEntry?.core || gameEntry?.platform || fallbackTargetGame?.core || 'fbneo',
    };
    if (isJ2meGame(mergedEntry) || !supportsOnlineMultiplayer(mergedEntry)) {
      return null;
    }
    const gameTitle = mergedEntry.title || targetUser?.currentGame?.title || gameId;
    const challengeObj = {
      challengeId,
      gameId,
      gameTitle,
      gameEntry: {
        id: mergedEntry.id || mergedEntry.gameId || gameId,
        title: gameTitle,
        filename: mergedEntry.filename || '',
        core: mergedEntry.core || 'fbneo',
        platform: mergedEntry.platform || mergedEntry.core || 'fbneo',
        players: mergedEntry.players || '1–2J',
        supportsMultiplayer: true,
        urls: Array.isArray(mergedEntry.urls) ? mergedEntry.urls : [],
        platformLabel: mergedEntry.platformLabel || 'Arcade',
      },
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
    };

    // 1. Relais serveur VPS (HTTP + WebSocket instantané)
    fetch('/api/fc-challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', challenge: challengeObj }),
    }).catch(() => {});
    this.sendWs({ type: 'CHALLENGE_INVITE', challenge: challengeObj });

    // 2. Synchronisation Firebase Firestore
    const ref = doc(db, 'fc_challenges', challengeId);
    setDoc(ref, challengeObj).catch(() => {});

    this.sendMessage(
      gameId,
      `⚔️ ${this.identity.name} [${this.identity.rank}] défie @${targetUser.name} sur « ${gameTitle} » (15s) !`,
      'challenge'
    ).catch(() => {});

    return challengeId;
  }

  subscribeIncomingChallenges(cb) {
    this.identity = getPlayerIdentity();
    let firestoreList = [];
    let relayList = [];
    this.incomingChallengeListeners.add(cb);

    const emitMerged = () => {
      const now = Date.now();
      const map = new Map();
      [...relayList, ...firestoreList].forEach((c) => {
        if (c && c.challengeId && c.expiresAt > now && c.status === 'pending' && c.fromUid !== this.identity.uid) {
          map.set(c.challengeId, c);
        }
      });
      cb(Array.from(map.values()));
    };

    const pullRelay = async () => {
      try {
        const res = await fetch(`/api/fc-challenge?toUid=${encodeURIComponent(this.identity.uid)}`);
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('json')) {
          const data = await res.json();
          if (Array.isArray(data.challenges)) {
            relayList = data.challenges;
            emitMerged();
          }
        }
      } catch {
        emitMerged();
      }
    };

    pullRelay();
    const pollId = setInterval(() => {
      if (!this.wsConnected) pullRelay();
    }, 8000);

    const q = query(
      collection(db, 'fc_challenges'),
      where('toUid', '==', this.identity.uid),
      where('status', '==', 'pending')
    );
    const unsubFs = onSnapshot(
      q,
      (snap) => {
        const now = Date.now();
        const list = [];
        snap.forEach((d) => {
          const c = d.data();
          if (c && c.expiresAt > now) list.push(c);
        });
        firestoreList = list;
        emitMerged();
      },
      () => emitMerged()
    );

    return () => {
      this.incomingChallengeListeners.delete(cb);
      clearInterval(pollId);
      unsubFs?.();
    };
  }

  subscribeChallenge(challengeId, cb) {
    let lastStatus = null;
    if (!this.challengeListeners.has(challengeId)) {
      this.challengeListeners.set(challengeId, new Set());
    }
    this.challengeListeners.get(challengeId).add(cb);

    const pullRelay = async () => {
      try {
        const res = await fetch(`/api/fc-challenge?id=${encodeURIComponent(challengeId)}`);
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('json')) {
          const data = await res.json();
          if (data.challenge) {
            lastStatus = data.challenge.status;
            cb(data.challenge);
          }
        }
      } catch {}
    };

    pullRelay();
    const pollId = setInterval(() => {
      if (!this.wsConnected) pullRelay();
    }, 6000);

    const unsubFs = onSnapshot(
      doc(db, 'fc_challenges', challengeId),
      (snap) => {
        if (snap.exists()) {
          cb(snap.data());
        }
      },
      () => {}
    );

    return () => {
      const set = this.challengeListeners.get(challengeId);
      if (set) {
        set.delete(cb);
        if (set.size === 0) this.challengeListeners.delete(challengeId);
      }
      clearInterval(pollId);
      unsubFs?.();
    };
  }

  async respondChallenge(challengeId, accept = true, toUid = null) {
    const status = accept ? 'accepted' : 'declined';
    fetch('/api/fc-challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'respond', id: challengeId, status }),
    }).catch(() => {});

    if (toUid) {
      this.sendWs({ type: 'CHALLENGE_REPLY', challengeId, status, toUid });
    }

    updateDoc(doc(db, 'fc_challenges', challengeId), { status }).catch(() => {});
  }

  sendRtcSignal(challengeId, targetUid, signalType, payload) {
    if (!challengeId || !targetUid || !signalType) return;
    this.sendWs({
      type: 'RTC_SIGNAL',
      challengeId,
      targetUid,
      signalType,
      payload,
    });
  }

  subscribeRtcSignal(challengeId, cb) {
    if (!this.rtcSignalListeners.has(challengeId)) {
      this.rtcSignalListeners.set(challengeId, new Set());
    }
    this.rtcSignalListeners.get(challengeId).add(cb);
    return () => {
      const set = this.rtcSignalListeners.get(challengeId);
      if (set) {
        set.delete(cb);
        if (set.size === 0) this.rtcSignalListeners.delete(challengeId);
      }
    };
  }

  async postOffer(challengeId, offer, targetUid = null) {
    const clean = offer ? { type: offer.type, sdp: offer.sdp } : null;
    if (!clean) return;
    if (targetUid) this.sendRtcSignal(challengeId, targetUid, 'offer', clean);
    fetch('/api/fc-challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'postOffer', id: challengeId, offer: clean }),
    }).catch(() => {});

    updateDoc(doc(db, 'fc_challenges', challengeId), { offer: clean }).catch(() => {});
  }

  async postAnswer(challengeId, answer, targetUid = null) {
    const clean = answer ? { type: answer.type, sdp: answer.sdp } : null;
    if (!clean) return;
    if (targetUid) this.sendRtcSignal(challengeId, targetUid, 'answer', clean);
    fetch('/api/fc-challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'postAnswer', id: challengeId, answer: clean }),
    }).catch(() => {});

    updateDoc(doc(db, 'fc_challenges', challengeId), { answer: clean }).catch(() => {});
  }

  async postRenegotiateOffer(challengeId, offer, targetUid = null) {
    const payload = { sdp: offer?.sdp, type: offer?.type, ts: Date.now() };
    if (targetUid) this.sendRtcSignal(challengeId, targetUid, 'renegotiateOffer', payload);
    fetch('/api/fc-challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'renegotiateOffer', id: challengeId, offer: payload }),
    }).catch(() => {});

    updateDoc(doc(db, 'fc_challenges', challengeId), { renegotiateOffer: payload }).catch(() => {});
  }

  async postRenegotiateAnswer(challengeId, answer, targetUid = null) {
    const payload = { sdp: answer?.sdp, type: answer?.type, ts: Date.now() };
    if (targetUid) this.sendRtcSignal(challengeId, targetUid, 'renegotiateAnswer', payload);
    fetch('/api/fc-challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'renegotiateAnswer', id: challengeId, answer: payload }),
    }).catch(() => {});

    updateDoc(doc(db, 'fc_challenges', challengeId), { renegotiateAnswer: payload }).catch(() => {});
  }

  async postIceCandidate(challengeId, role, candidate, targetUid = null) {
    if (!candidate) return;
    const candJson = candidate.toJSON ? candidate.toJSON() : candidate;
    if (targetUid) this.sendRtcSignal(challengeId, targetUid, 'candidate', candJson);

    fetch('/api/fc-challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'addCandidate', id: challengeId, role, candidate: candJson }),
    }).catch(() => {});

    const subCol = role === 'caller' ? 'callerCandidates' : 'calleeCandidates';
    addDoc(collection(db, 'fc_challenges', challengeId, subCol), candJson).catch(() => {});
  }

  subscribeIceCandidates(challengeId, remoteRole, cb) {
    const seenCandidates = new Set();

    const pullRelay = async () => {
      try {
        const res = await fetch(`/api/fc-challenge?id=${encodeURIComponent(challengeId)}`);
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('json')) {
          const data = await res.json();
          const list = remoteRole === 'caller' ? data.challenge?.callerCandidates : data.challenge?.calleeCandidates;
          if (Array.isArray(list)) {
            list.forEach((c) => {
              const key = JSON.stringify(c);
              if (!seenCandidates.has(key)) {
                seenCandidates.add(key);
                cb(c);
              }
            });
          }
        }
      } catch {}
    };

    pullRelay();
    const pollId = setInterval(() => {
      if (!this.wsConnected) pullRelay();
    }, 4500);

    const subCol = remoteRole === 'caller' ? 'callerCandidates' : 'calleeCandidates';
    const unsubFs = onSnapshot(
      collection(db, 'fc_challenges', challengeId, subCol),
      (snap) => {
        snap.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const data = change.doc.data();
            const key = JSON.stringify(data);
            if (!seenCandidates.has(key)) {
              seenCandidates.add(key);
              cb(data);
            }
          }
        });
      },
      () => {}
    );

    return () => {
      clearInterval(pollId);
      unsubFs?.();
    };
  }
}

export const firebaseFightcadeService = new FirebaseFightcadeService();
