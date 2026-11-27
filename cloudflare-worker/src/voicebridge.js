/**
 * Traduction 1:1 en JavaScript + Cloudflare Durable Objects (SQLite) de `api.php` (VoiceBridge).
 *
 * Remplace :
 *  - Le fichier verrouillé `state.json` (flock) -> 1 Durable Object isolé par salon (`VoiceBridgeRoomDO`)
 *  - Les limites IP en JSON -> compteur par IP dans SQLite / Durable Object
 *  - La config statique `config.php` -> STUN Cloudflare + génération dynamique TURN Cloudflare
 */

import { DurableObject } from 'cloudflare:workers';
import { getIceServers } from './turn.js';

const MAX_BODY_BYTES = 32768;
const MAX_EVENTS_PER_MEMBER = 128;
const MEMBER_TIMEOUT_SEC = 90;
const RING_TIMEOUT_SEC = 45;
const ROOM_IDLE_TTL_SEC = 3600;
const RATE_WINDOW_SEC = 60;
const MAX_REQUESTS_PER_MIN = 360;
const MAX_CREATES_PER_MIN = 10;

export class VoiceBridgeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function randomTokenHex(byteLen = 24) {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function strField(data, key) {
  return typeof data?.[key] === 'string' ? data[key] : '';
}

function sendEvent(member, type, extra = {}) {
  member.seq += 1;
  member.events.push({ seq: member.seq, type, ...extra });
  if (member.events.length > MAX_EVENTS_PER_MEMBER) {
    member.events.shift();
  }
}

function endCall(room, reason) {
  if (!room.call) return;
  const callId = room.call.id;
  room.call = null;
  for (const member of Object.values(room.members)) {
    sendEvent(member, 'ended', { callId, reason });
  }
}

function removeMember(room, memberId, nowSec) {
  endCall(room, 'disconnected');
  delete room.members[memberId];
  room.touched = nowSec;
}

function cleanupRoom(room, nowSec) {
  if (!room) return;
  for (const [mid, member] of Object.entries(room.members)) {
    if (nowSec - member.seen > MEMBER_TIMEOUT_SEC) {
      removeMember(room, mid, nowSec);
    }
  }
  if (room.call?.phase === 'ringing' && nowSec - room.call.started > RING_TIMEOUT_SEC) {
    endCall(room, 'no-answer');
  }
}

function joinRoomState(room, iceServers, nowSec) {
  if (Object.keys(room.members).length >= 2) {
    throw new VoiceBridgeError(409, 'This room already has two people.');
  }
  const sessionId = randomTokenHex(24);
  room.members[sessionId] = { seen: nowSec, seq: 0, events: [] };
  room.touched = nowSec;
  return {
    room: room.id,
    session: sessionId,
    iceServers,
  };
}

/**
 * Durable Object SQLite par salon VoiceBridge (`VOICEBRIDGE_ROOMS.getByName(roomId)`).
 * Équivalent strict et scalable du verrou `flock($lock, LOCK_EX)` sur `state.json`.
 */
export class VoiceBridgeRoomDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          json TEXT NOT NULL
        )
      `);
    });
  }

  _loadRoom() {
    const rows = this.ctx.storage.sql.exec('SELECT json FROM room_state WHERE id = 1').toArray();
    if (!rows.length) return null;
    try {
      return JSON.parse(rows[0].json);
    } catch {
      return null;
    }
  }

  _saveRoom(room) {
    if (!room) {
      this.ctx.storage.sql.exec('DELETE FROM room_state WHERE id = 1');
      return;
    }
    this.ctx.storage.sql.exec(
      'INSERT INTO room_state (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json',
      JSON.stringify(room)
    );
  }

  async _processRoomAction(route, roomId, data, iceServers, nowSec = Math.floor(Date.now() / 1000)) {
    let room = this._loadRoom();
    if (room) {
      cleanupRoom(room, nowSec);
      if (Object.keys(room.members).length === 0 && nowSec - room.touched > ROOM_IDLE_TTL_SEC) {
        room = null;
      }
    }

    if (route === 'create') {
      room = { id: roomId, members: {}, call: null, touched: nowSec };
      const res = joinRoomState(room, iceServers, nowSec);
      this._saveRoom(room);
      return res;
    }

    if (!room) {
      throw new VoiceBridgeError(
        route === 'join' ? 404 : 401,
        'This room has expired. Create a new invitation.'
      );
    }

    if (route === 'join') {
      const res = joinRoomState(room, iceServers, nowSec);
      this._saveRoom(room);
      return res;
    }

    const session = strField(data, 'session');
    const member = room.members[session];
    if (!member) {
      this._saveRoom(room);
      throw new VoiceBridgeError(401, 'Your session expired. Rejoin the room.');
    }

    member.seen = nowSec;
    const peerId = Object.keys(room.members).find((mid) => mid !== session) || null;

    if (route === 'poll') {
      const since = data?.since;
      if (!Number.isInteger(since) || since < 0 || since > member.seq) {
        this._saveRoom(room);
        throw new VoiceBridgeError(400, 'Invalid event cursor.');
      }
      if (member.events.length > 0 && since < member.events[0].seq - 1) {
        this._saveRoom(room);
        throw new VoiceBridgeError(409, 'Too many missed events. Rejoin the room.');
      }
      member.events = member.events.filter((e) => e.seq > since);
      this._saveRoom(room);
      return { peer: peerId !== null, events: member.events };
    }

    if (route === 'leave') {
      removeMember(room, session, nowSec);
      this._saveRoom(room);
      return { ok: true };
    }

    if (route !== 'action') {
      throw new VoiceBridgeError(404, 'Unknown endpoint.');
    }

    const action = strField(data, 'action');
    if (action === 'ring') {
      if (peerId === null || room.call) {
        this._saveRoom(room);
        throw new VoiceBridgeError(409, 'Wait for the other person or the current call to end.');
      }
      const callId = randomTokenHex(24);
      room.call = { id: callId, caller: session, phase: 'ringing', started: nowSec };
      sendEvent(member, 'outgoing', { callId });
      sendEvent(room.members[peerId], 'ring', { callId });
      this._saveRoom(room);
      return { callId };
    }

    const call = room.call;
    if (!call || strField(data, 'callId') !== call.id) {
      this._saveRoom(room);
      throw new VoiceBridgeError(409, 'This call is no longer active.');
    }
    const callId = call.id;

    if (action === 'accept' || action === 'decline') {
      if (call.phase !== 'ringing' || call.caller === session || peerId === null) {
        this._saveRoom(room);
        throw new VoiceBridgeError(409, 'Cannot answer this call.');
      }
      if (action === 'decline') {
        endCall(room, 'declined');
      } else {
        room.call.phase = 'active';
        sendEvent(room.members[peerId], 'accepted', { callId });
      }
      this._saveRoom(room);
      return { ok: true };
    }

    if (action === 'hangup') {
      endCall(room, 'hangup');
      this._saveRoom(room);
      return { ok: true };
    }

    if (action === 'offer' || action === 'answer' || action === 'candidate') {
      if (call.phase !== 'active' || peerId === null) {
        this._saveRoom(room);
        throw new VoiceBridgeError(409, 'No active call.');
      }
      const payload = data?.payload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        this._saveRoom(room);
        throw new VoiceBridgeError(400, 'Invalid signaling message.');
      }
      if (action === 'candidate') {
        if (typeof payload.candidate !== 'string' || payload.candidate.length > 4096) {
          this._saveRoom(room);
          throw new VoiceBridgeError(400, 'Invalid ICE candidate.');
        }
      } else {
        if ((action === 'offer') !== (call.caller === session)) {
          this._saveRoom(room);
          throw new VoiceBridgeError(403, 'Invalid signaling direction.');
        }
        if (
          payload.type !== action ||
          typeof payload.sdp !== 'string' ||
          payload.sdp.length > 16000
        ) {
          this._saveRoom(room);
          throw new VoiceBridgeError(400, 'Invalid description.');
        }
      }
      sendEvent(room.members[peerId], action, { callId, payload });
      this._saveRoom(room);
      return { ok: true };
    }

    this._saveRoom(room);
    throw new VoiceBridgeError(400, 'Unknown action.');
  }

  async fetch(request) {
    try {
      const { route, roomId, data, iceServers, nowSec } = await request.json();
      const result = await this._processRoomAction(route, roomId, data, iceServers, nowSec);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    } catch (err) {
      const status = err instanceof VoiceBridgeError ? err.status : 500;
      const message = err instanceof VoiceBridgeError ? err.message : 'Server error.';
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
  }
}

// Limitation de débit légère par isolat Worker (équivalent du tableau `limits` d'api.php)
const ipRateLimits = new Map();

function checkRateLimit(ipKey, route, nowSec) {
  for (const [k, entry] of ipRateLimits.entries()) {
    if (nowSec - entry.start >= RATE_WINDOW_SEC) ipRateLimits.delete(k);
  }
  let entry = ipRateLimits.get(ipKey);
  if (!entry) {
    entry = { start: nowSec, count: 0, creates: 0 };
    ipRateLimits.set(ipKey, entry);
  }
  entry.count += 1;
  if (entry.count > MAX_REQUESTS_PER_MIN) {
    throw new VoiceBridgeError(429, 'Too many requests. Try again shortly.');
  }
  if (route === 'create') {
    entry.creates += 1;
    if (entry.creates > MAX_CREATES_PER_MIN) {
      throw new VoiceBridgeError(429, 'Room limit reached. Try again later.');
    }
  }
}

function jsonResponse(payload, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...corsHeaders,
    },
  });
}

/**
 * Point d'entrée HTTP compatible avec `api.php?route=...`
 */
export async function handleVoiceBridgeRequest(request, env, corsHeaders = {}, fetchImpl = fetch) {
  try {
    if (request.method !== 'POST') {
      throw new VoiceBridgeError(405, 'Use POST.');
    }
    if ((request.headers.get('Sec-Fetch-Site') || '') === 'cross-site' && !env?.ALLOW_CROSS_ORIGIN) {
      throw new VoiceBridgeError(403, 'Cross-site request denied.');
    }
    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.startsWith('application/json')) {
      throw new VoiceBridgeError(415, 'Expected JSON.');
    }

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      throw new VoiceBridgeError(413, 'Request too large.');
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new VoiceBridgeError(400, 'Invalid JSON.');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new VoiceBridgeError(400, 'Invalid JSON.');
    }

    const url = new URL(request.url);
    const route = url.searchParams.get('route') || '';
    const nowSec = Math.floor(Date.now() / 1000);
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    checkRateLimit(clientIp, route, nowSec);

    const roomId = route === 'create' ? randomTokenHex(24) : strField(data, 'room');
    if (!roomId) {
      throw new VoiceBridgeError(route === 'join' ? 404 : 401, 'This room has expired. Create a new invitation.');
    }

    const needsIce = route === 'create' || route === 'join';
    const iceServers = needsIce ? await getIceServers(env, fetchImpl) : [];

    const stub = env.VOICEBRIDGE_ROOMS.getByName(roomId);
    const doRes = await stub.fetch('https://voicebridge-do/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route, roomId, data, iceServers, nowSec }),
    });
    const bodyText = await doRes.text();
    return new Response(bodyText, {
      status: doRes.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        ...corsHeaders,
      },
    });
  } catch (err) {
    if (err instanceof VoiceBridgeError) {
      return jsonResponse({ error: err.message }, err.status, corsHeaders);
    }
    return jsonResponse({ error: 'Server error.' }, 500, corsHeaders);
  }
}
