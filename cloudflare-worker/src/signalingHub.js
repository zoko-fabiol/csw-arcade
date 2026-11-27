/**
 * Durable Object avec WebSocket Hibernation pour CSW-Arcade (/ws/voice & /ws/netplay).
 * Remplace les serveurs WebSocket Node.js du VPS pour la mise en relation temps réel.
 *
 * - /ws/voice : groupes vocaux (max 6 joueurs), signalisation SDP/ICE `webrtc_signal`
 *   (zéro relais audio JS/WebSocket : tout l'Opus passe en WebRTC P2P / Cloudflare TURN).
 * - /ws/netplay : présence (`IDENTIFY`), défis (`CHALLENGE_*`), synchro chargement
 *   (`MATCH_*`), signalisation P2P (`RTC_SIGNAL`) et repli d'urgence (`RELAY_INPUT`).
 */

import { DurableObject } from 'cloudflare:workers';

const MAX_PARTY_SIZE = 6;

export class SignalingHubDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.voiceRooms = new Map();
    this.challenges = new Map();

    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS hub_state (
          key TEXT PRIMARY KEY,
          json TEXT NOT NULL
        )
      `);
      const rows = this.ctx.storage.sql.exec('SELECT key, json FROM hub_state').toArray();
      for (const row of rows) {
        try {
          if (row.key === 'voiceRooms') {
            for (const [k, v] of JSON.parse(row.json)) {
              this.voiceRooms.set(k, { ...v, members: new Set(v.members || []) });
            }
          } else if (row.key === 'challenges') {
            for (const [k, v] of JSON.parse(row.json)) {
              this.challenges.set(k, v);
            }
          }
        } catch {}
      }
    });
  }

  _persistVoiceRooms() {
    const serialized = Array.from(this.voiceRooms.entries()).map(([k, r]) => [
      k,
      { roomId: r.roomId, title: r.title, hostUid: r.hostUid, members: Array.from(r.members) },
    ]);
    this.ctx.storage.sql.exec(
      "INSERT INTO hub_state (key, json) VALUES ('voiceRooms', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json",
      JSON.stringify(serialized)
    );
  }

  _persistChallenges() {
    const entries = Array.from(this.challenges.entries()).slice(-200);
    this.ctx.storage.sql.exec(
      "INSERT INTO hub_state (key, json) VALUES ('challenges', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json",
      JSON.stringify(entries)
    );
  }

  _sendJson(ws, payload) {
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  _getVoiceSocketsByUid(uid) {
    return this.ctx.getWebSockets('voice').filter((s) => s.deserializeAttachment()?.uid === uid);
  }

  _getNetplaySocketsByUid(uid) {
    return this.ctx.getWebSockets('netplay').filter((s) => s.deserializeAttachment()?.uid === uid);
  }

  _pushVoiceUser(uid, payload) {
    let delivered = false;
    for (const s of this._getVoiceSocketsByUid(uid)) {
      if (this._sendJson(s, payload)) delivered = true;
    }
    return delivered;
  }

  _pushNetplayUser(uid, payload, excludeWs = null) {
    let delivered = false;
    for (const s of this._getNetplaySocketsByUid(uid)) {
      if (s !== excludeWs && this._sendJson(s, payload)) delivered = true;
    }
    return delivered;
  }

  _broadcastVoiceRoom(roomId) {
    const room = this.voiceRooms.get(roomId);
    if (!room) return;
    const voiceSockets = this.ctx.getWebSockets('voice');
    const membersByUid = new Map();
    for (const s of voiceSockets) {
      const att = s.deserializeAttachment();
      if (att?.uid && room.members.has(att.uid)) {
        membersByUid.set(att.uid, {
          uid: att.uid,
          name: att.name || 'Joueur',
          photoURL: att.photoURL || null,
          rank: att.rank || 'D',
          region: att.region || 'FR',
          ready: Boolean(att.ready),
          muted: Boolean(att.muted),
          speaking: Boolean(att.speaking),
          channel: att.channel || 'party',
        });
      }
    }
    const members = Array.from(membersByUid.values());
    const payload = {
      type: 'room_state',
      roomId: room.roomId,
      title: room.title || 'Groupe CSW Arcade',
      hostUid: room.hostUid,
      maxMembers: MAX_PARTY_SIZE,
      members,
    };
    for (const memberUid of room.members) {
      this._pushVoiceUser(memberUid, payload);
    }
  }

  _removeFromVoiceRoom(uid) {
    for (const s of this._getVoiceSocketsByUid(uid)) {
      const att = s.deserializeAttachment() || {};
      const oldRoomId = att.roomId;
      s.serializeAttachment({ ...att, roomId: null, speaking: false });
      if (oldRoomId) {
        const room = this.voiceRooms.get(oldRoomId);
        if (room) {
          room.members.delete(uid);
          if (room.members.size === 0) {
            this.voiceRooms.delete(oldRoomId);
          } else {
            if (room.hostUid === uid) room.hostUid = Array.from(room.members)[0];
            this._broadcastVoiceRoom(oldRoomId);
          }
          this._persistVoiceRooms();
        }
      }
    }
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    const url = new URL(request.url);
    const channelType = url.pathname.endsWith('/ws/voice') ? 'voice' : 'netplay';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server, [channelType]);
    server.serializeAttachment({
      channelType,
      uid: null,
      name: 'Joueur',
      rank: 'D',
      region: 'FR',
      photoURL: null,
      privacy: 'friends',
      roomId: null,
      channel: 'party',
      muted: true,
      ready: false,
      speaking: false,
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    const att = ws.deserializeAttachment() || {};
    if (att.channelType === 'voice') {
      this._handleVoiceMessage(ws, att, msg);
    } else {
      this._handleNetplayMessage(ws, att, msg);
    }
  }

  _handleVoiceMessage(ws, att, msg) {
    if (msg.type === 'register') {
      const uid = String(msg.uid || '').trim();
      if (!uid) return;
      const nextAtt = {
        ...att,
        uid,
        name: String(msg.name || att.name || 'Joueur').slice(0, 40),
        photoURL: msg.photoURL || att.photoURL || null,
        rank: String(msg.rank || att.rank || 'D').slice(0, 6),
        region: String(msg.region || att.region || 'FR').slice(0, 6),
        privacy: ['everyone', 'friends', 'party', 'off'].includes(msg.privacy)
          ? msg.privacy
          : att.privacy || 'friends',
        channel: msg.channel === 'game' ? 'game' : att.channel || 'party',
      };
      ws.serializeAttachment(nextAtt);
      this._sendJson(ws, { type: 'registered', uid, unreadByPeer: {}, totalUnreadDm: 0 });
      if (nextAtt.roomId && this.voiceRooms.has(nextAtt.roomId)) {
        this._broadcastVoiceRoom(nextAtt.roomId);
      }
      return;
    }

    const uid = att.uid;
    if (!uid) return;

    if (msg.type === 'update_privacy') {
      if (['everyone', 'friends', 'party', 'off'].includes(msg.privacy)) {
        ws.serializeAttachment({ ...att, privacy: msg.privacy });
        if (msg.privacy === 'off' && att.roomId) {
          this._removeFromVoiceRoom(uid);
          this._sendJson(ws, { type: 'left_room', reason: 'privacy_off' });
        }
      }
      return;
    }

    if (msg.type === 'join_room' || msg.type === 'join_user_party') {
      if (att.privacy === 'off') {
        this._sendJson(ws, { type: 'voice_error', error: 'Le chat vocal est désactivé dans vos paramètres.' });
        return;
      }
      const targetUid = msg.type === 'join_user_party' ? String(msg.targetUid || '').trim() : null;
      if (msg.type === 'join_user_party' && (!targetUid || targetUid === uid)) return;

      const roomId = targetUid
        ? `party_${targetUid}`
        : String(msg.roomId || `party_${uid}`).slice(0, 80);

      if (att.roomId && att.roomId !== roomId) {
        this._removeFromVoiceRoom(uid);
      }

      let room = this.voiceRooms.get(roomId);
      if (!room) {
        room = {
          roomId,
          title: String(msg.title || `Groupe de ${att.name}`).slice(0, 60),
          hostUid: targetUid || uid,
          members: new Set(),
        };
        this.voiceRooms.set(roomId, room);
        if (targetUid) room.members.add(targetUid);
      }
      if (!room.members.has(uid) && room.members.size >= MAX_PARTY_SIZE) {
        this._sendJson(ws, { type: 'voice_error', error: `Groupe complet (${MAX_PARTY_SIZE} max).` });
        return;
      }

      room.members.add(uid);
      ws.serializeAttachment({
        ...ws.deserializeAttachment(),
        roomId,
        channel: msg.channel === 'game' ? 'game' : 'party',
        muted: typeof msg.muted === 'boolean' ? msg.muted : att.muted,
        ready: false,
        speaking: false,
      });
      this._persistVoiceRooms();
      this._broadcastVoiceRoom(roomId);
      return;
    }

    if (msg.type === 'set_ready') {
      ws.serializeAttachment({ ...att, ready: Boolean(msg.ready) });
      if (att.roomId) this._broadcastVoiceRoom(att.roomId);
      return;
    }

    if (msg.type === 'voice_state') {
      const muted = typeof msg.muted === 'boolean' ? msg.muted : att.muted;
      const speaking = typeof msg.speaking === 'boolean' ? (muted ? false : msg.speaking) : att.speaking;
      const channel = msg.channel === 'party' || msg.channel === 'game' ? msg.channel : att.channel;
      ws.serializeAttachment({ ...att, muted, speaking, channel });
      if (att.roomId) this._broadcastVoiceRoom(att.roomId);
      return;
    }

    if (msg.type === 'leave_room') {
      this._removeFromVoiceRoom(uid);
      this._sendJson(ws, { type: 'left_room', reason: 'user' });
      return;
    }

    if (msg.type === 'kick_member') {
      const targetUid = String(msg.targetUid || '').trim();
      if (!att.roomId || !targetUid || targetUid === uid) return;
      const room = this.voiceRooms.get(att.roomId);
      if (!room || room.hostUid !== uid || !room.members.has(targetUid)) return;
      this._removeFromVoiceRoom(targetUid);
      this._pushVoiceUser(targetUid, { type: 'left_room', reason: 'kicked' });
      return;
    }

    if (msg.type === 'transfer_host') {
      const targetUid = String(msg.targetUid || '').trim();
      if (!att.roomId || !targetUid || targetUid === uid) return;
      const room = this.voiceRooms.get(att.roomId);
      if (!room || room.hostUid !== uid || !room.members.has(targetUid)) return;
      room.hostUid = targetUid;
      this._persistVoiceRooms();
      this._broadcastVoiceRoom(att.roomId);
      return;
    }

    if (msg.type === 'voice_invite') {
      const toUid = String(msg.toUid || '').trim();
      if (!toUid || toUid === uid) return;
      const targetSockets = this._getVoiceSocketsByUid(toUid);
      const targetPrivacy = targetSockets[0]?.deserializeAttachment()?.privacy || 'friends';
      if (targetPrivacy === 'off') {
        this._sendJson(ws, { type: 'voice_error', error: 'Ce joueur a désactivé le chat vocal.' });
        return;
      }
      let roomId = att.roomId || String(msg.roomId || `party_${uid}`).slice(0, 80);
      if (!att.roomId) {
        let room = this.voiceRooms.get(roomId);
        if (!room) {
          room = {
            roomId,
            title: String(msg.roomTitle || `Groupe de ${att.name}`).slice(0, 60),
            hostUid: uid,
            members: new Set(),
          };
          this.voiceRooms.set(roomId, room);
        }
        room.members.add(uid);
        ws.serializeAttachment({ ...att, roomId });
        this._persistVoiceRooms();
        this._broadcastVoiceRoom(roomId);
      }
      const room = this.voiceRooms.get(roomId);
      const inviteTitle = String(msg.roomTitle || room?.title || `Groupe de ${att.name}`);
      const delivered = this._pushVoiceUser(toUid, {
        type: 'voice_invite_received',
        inviteId: `vinv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        fromUid: uid,
        fromName: att.name,
        fromPhotoURL: att.photoURL || null,
        roomId,
        roomTitle: inviteTitle,
        channel: msg.channel === 'game' ? 'game' : 'party',
        createdAtMs: Date.now(),
      });
      this._sendJson(ws, { type: 'voice_invite_sent', toUid, delivered, roomId });
      return;
    }

    if (msg.type === 'webrtc_signal') {
      const toUid = String(msg.toUid || '').trim();
      if (!toUid || !att.roomId) return;
      this._pushVoiceUser(toUid, {
        type: 'webrtc_signal',
        fromUid: uid,
        fromName: att.name,
        roomId: att.roomId,
        signal: msg.signal,
      });
    }
  }

  _handleNetplayMessage(ws, att, data) {
    switch (data.type) {
      case 'IDENTIFY': {
        const uid = String(data.uid || '').trim();
        if (!uid) break;
        ws.serializeAttachment({
          ...att,
          uid,
          name: String(data.name || 'Joueur').slice(0, 40),
          region: String(data.region || 'FR').slice(0, 6),
        });
        this._sendJson(ws, { type: 'IDENTIFIED', uid, ok: true });
        break;
      }

      case 'PING': {
        this._sendJson(ws, { type: 'PONG', clientTime: data.clientTime, serverTime: Date.now() });
        break;
      }

      case 'CHALLENGE_INVITE': {
        const ch = data.challenge;
        if (!ch?.challengeId) break;
        const stored = { ...this.challenges.get(ch.challengeId), ...ch, updatedAtMs: Date.now() };
        this.challenges.set(ch.challengeId, stored);
        this._persistChallenges();
        if (ch.toUid) {
          this._pushNetplayUser(ch.toUid, { type: 'INCOMING_CHALLENGE', challenge: stored }, ws);
        }
        break;
      }

      case 'CHALLENGE_REPLY': {
        const { challengeId, status, toUid } = data;
        const ch = this.challenges.get(challengeId);
        if (ch && !(ch.status === 'accepted' && status === 'declined')) {
          ch.status = status;
          ch.updatedAtMs = Date.now();
          this._persistChallenges();
        }
        if (toUid) {
          this._pushNetplayUser(
            toUid,
            { type: 'CHALLENGE_STATUS_CHANGED', challengeId, status, challenge: ch || null },
            ws
          );
        }
        break;
      }

      case 'MATCH_SYNC_UPDATE': {
        if (!data.targetUid) break;
        this._pushNetplayUser(
          data.targetUid,
          {
            type: 'MATCH_SYNC_UPDATE',
            challengeId: data.challengeId,
            romPct: data.romPct,
            romReady: Boolean(data.romReady),
            isReady: Boolean(data.isReady),
          },
          ws
        );
        break;
      }

      case 'MATCH_COUNTDOWN_START': {
        if (!data.targetUid) break;
        this._pushNetplayUser(
          data.targetUid,
          { type: 'MATCH_COUNTDOWN_START', challengeId: data.challengeId },
          ws
        );
        break;
      }

      case 'MATCH_CANCEL': {
        if (data.challengeId && this.challenges.has(data.challengeId)) {
          const ch = this.challenges.get(data.challengeId);
          ch.status = 'cancelled';
          ch.updatedAtMs = Date.now();
          this._persistChallenges();
        }
        if (data.targetUid) {
          this._pushNetplayUser(
            data.targetUid,
            { type: 'MATCH_CANCELLED', challengeId: data.challengeId },
            ws
          );
        }
        break;
      }

      case 'RTC_SIGNAL': {
        if (!data.targetUid || !data.signalType) break;
        this._pushNetplayUser(
          data.targetUid,
          {
            type: 'RTC_SIGNAL',
            challengeId: data.challengeId,
            fromUid: att.uid || null,
            signalType: data.signalType,
            payload: data.payload,
          },
          ws
        );
        break;
      }

      case 'PROBE_SIGNAL': {
        if (!data.targetUid || !data.signalType) break;
        this._pushNetplayUser(
          data.targetUid,
          {
            type: 'PROBE_SIGNAL',
            fromUid: att.uid || null,
            signalType: data.signalType,
            payload: data.payload,
          },
          ws
        );
        break;
      }

      case 'RELAY_INPUT': {
        if (!data.targetUid) break;
        this._pushNetplayUser(
          data.targetUid,
          {
            type: 'RELAY_INPUT',
            fromUid: att.uid || null,
            buttonIdx: data.buttonIdx,
            pressed: data.pressed,
            frame: data.frame,
            packetHex: data.packetHex,
            packetB64: data.packetB64,
            ts: Date.now(),
          },
          ws
        );
        break;
      }

      default:
        break;
    }
  }

  async webSocketClose(ws) {
    const att = ws.deserializeAttachment();
    if (att?.channelType === 'voice' && att.uid) {
      const remaining = this._getVoiceSocketsByUid(att.uid).filter((s) => s !== ws);
      if (remaining.length === 0) {
        this._removeFromVoiceRoom(att.uid);
      }
    }
  }
}
