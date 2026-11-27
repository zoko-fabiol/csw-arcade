import test from 'node:test';
import assert from 'node:assert/strict';

// Polyfill minimal de `cloudflare:workers` pour tester en Node pur sans runtime workerd
const cloudflareWorkersHook = `
  export class DurableObject {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  }
`;

// Création d'un mock SQLite + WebSocket Hibernation pour exécuter VoiceBridgeRoomDO & SignalingHubDO en Node
function createSqliteMock() {
  const tables = { room_state: null, hub_state: new Map() };
  return {
    exec(sql, ...args) {
      const s = sql.trim();
      if (s.startsWith('CREATE TABLE')) return { toArray: () => [] };
      if (s.startsWith('SELECT json FROM room_state')) {
        return { toArray: () => (tables.room_state ? [{ json: tables.room_state }] : []) };
      }
      if (s.startsWith('DELETE FROM room_state')) {
        tables.room_state = null;
        return { toArray: () => [] };
      }
      if (s.includes('INSERT INTO room_state')) {
        tables.room_state = args[0];
        return { toArray: () => [] };
      }
      if (s.startsWith('SELECT key, json FROM hub_state')) {
        return {
          toArray: () => Array.from(tables.hub_state.entries()).map(([key, json]) => ({ key, json })),
        };
      }
      if (s.includes('INSERT INTO hub_state')) {
        const key = s.includes("'voiceRooms'") ? 'voiceRooms' : 'challenges';
        tables.hub_state.set(key, args[0]);
        return { toArray: () => [] };
      }
      return { toArray: () => [] };
    },
  };
}

function createFakeDoCtx() {
  const sql = createSqliteMock();
  const sockets = [];
  return {
    storage: { sql },
    blockConcurrencyWhile: (fn) => fn(),
    acceptWebSocket(ws, tags = []) {
      ws._tags = tags;
      sockets.push(ws);
    },
    getWebSockets(tag) {
      return tag ? sockets.filter((s) => s._tags?.includes(tag)) : sockets;
    },
  };
}

// Injecte le module virtuel `cloudflare:workers` via Module.registerHooks (Node >= 22.15)
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(cloudflareWorkersHook) };
    }
    return nextResolve(specifier, context);
  },
});

const { default: worker } = await import('../src/index.js');
const { handleVoiceBridgeRequest, VoiceBridgeRoomDO } = await import('../src/voicebridge.js');
const { SignalingHubDO } = await import('../src/signalingHub.js');
const { handleTurnCredentialsRequest, resetTurnCacheForTest } = await import('../src/turn.js');

function wrapStub(doInstance) {
  return {
    fetch(input, init) {
      const req = input instanceof Request ? input : new Request(input, init);
      return doInstance.fetch(req);
    },
  };
}

function createTestEnv() {
  const roomObjects = new Map();
  const hubCtx = createFakeDoCtx();
  const hub = new SignalingHubDO(hubCtx, {});
  return {
    CLOUDFLARE_TURN_KEY_ID: '8359ae79314f32ee98e0ed87b257d524',
    CLOUDFLARE_TURN_API_TOKEN: '',
    VOICEBRIDGE_ROOMS: {
      getByName(name) {
        if (!roomObjects.has(name)) {
          roomObjects.set(name, wrapStub(new VoiceBridgeRoomDO(createFakeDoCtx(), {})));
        }
        return roomObjects.get(name);
      },
    },
    SIGNALING_HUB: {
      getByName() {
        return wrapStub(hub);
      },
    },
    _hub: hub,
  };
}

async function postRoute(env, route, body, headers = {}) {
  const req = new Request(`https://example.workers.dev/api.php?route=${encodeURIComponent(route)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', ...headers },
    body: JSON.stringify(body),
  });
  const res = await handleVoiceBridgeRequest(req, env);
  return { status: res.status, json: await res.json() };
}

test('VoiceBridge api.php : cycle complet create -> join -> ring -> accept -> offer -> answer -> candidate -> hangup -> leave', async () => {
  const env = createTestEnv();

  // 1. Create room (Caller)
  const created = await postRoute(env, 'create', {});
  assert.equal(created.status, 200);
  assert.ok(created.json.room);
  assert.ok(created.json.session);
  assert.ok(Array.isArray(created.json.iceServers));

  const room = created.json.room;
  const s1 = created.json.session;

  // 2. Join room (Callee) + 3e joueur rejeté en 409
  const joined = await postRoute(env, 'join', { room });
  assert.equal(joined.status, 200);
  const s2 = joined.json.session;

  const full = await postRoute(env, 'join', { room });
  assert.equal(full.status, 409);

  // 3. Poll voit peer === true
  const poll1 = await postRoute(env, 'poll', { room, session: s1, since: 0 });
  assert.equal(poll1.status, 200);
  assert.equal(poll1.json.peer, true);

  // 4. Ring -> caller reçoit outgoing, callee reçoit ring
  const ringed = await postRoute(env, 'action', { room, session: s1, action: 'ring' });
  assert.equal(ringed.status, 200);
  const callId = ringed.json.callId;
  assert.ok(callId);

  const poll2 = await postRoute(env, 'poll', { room, session: s2, since: 0 });
  assert.equal(poll2.json.events[0].type, 'ring');
  assert.equal(poll2.json.events[0].callId, callId);

  // 5. Accept -> caller reçoit accepted
  const acc = await postRoute(env, 'action', { room, session: s2, action: 'accept', callId });
  assert.equal(acc.status, 200);

  // 6. Seul le caller peut envoyer offer (callee -> 403)
  const badOffer = await postRoute(env, 'action', {
    room,
    session: s2,
    action: 'offer',
    callId,
    payload: { type: 'offer', sdp: 'v=0' },
  });
  assert.equal(badOffer.status, 403);

  const goodOffer = await postRoute(env, 'action', {
    room,
    session: s1,
    action: 'offer',
    callId,
    payload: { type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111' },
  });
  assert.equal(goodOffer.status, 200);

  const ans = await postRoute(env, 'action', {
    room,
    session: s2,
    action: 'answer',
    callId,
    payload: { type: 'answer', sdp: 'v=0' },
  });
  assert.equal(ans.status, 200);

  const cand = await postRoute(env, 'action', {
    room,
    session: s1,
    action: 'candidate',
    callId,
    payload: { candidate: 'candidate:1 1 UDP 2122252543 1.2.3.4 50000 typ host' },
  });
  assert.equal(cand.status, 200);

  // 7. Hangup & Leave
  const hu = await postRoute(env, 'action', { room, session: s1, action: 'hangup', callId });
  assert.equal(hu.status, 200);
  const lv = await postRoute(env, 'leave', { room, session: s2 });
  assert.equal(lv.status, 200);
  const afterLeave = await postRoute(env, 'poll', { room, session: s2, since: 0 });
  assert.equal(afterLeave.status, 401);
});

test('VoiceBridge api.php : validations HTTP & sécurité (405, 403 cross-site, 415, 413)', async () => {
  const env = createTestEnv();
  const getRes = await handleVoiceBridgeRequest(new Request('https://example.workers.dev/api.php?route=create'), env);
  assert.equal(getRes.status, 405);

  const cross = await postRoute(env, 'create', {}, { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(cross.status, 403);

  const nonJson = await handleVoiceBridgeRequest(
    new Request('https://example.workers.dev/api.php?route=create', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' }),
    env
  );
  assert.equal(nonJson.status, 415);
});

test('/api/turn-credentials priorise UDP et retombe sur STUN sans token', async () => {
  resetTurnCacheForTest();
  const res = await handleTurnCredentialsRequest({ CLOUDFLARE_TURN_KEY_ID: 'k1', CLOUDFLARE_TURN_API_TOKEN: '' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(data.iceServers.some((s) => String(s.urls).includes('stun.cloudflare.com:3478')));
});

test('SignalingHubDO : relaye webrtc_signal (/ws/voice) & RTC_SIGNAL (/ws/netplay) sans audio WS', async () => {
  const env = createTestEnv();
  const hub = env._hub;

  const makeMockWs = (tag) => {
    const sent = [];
    let att = { channelType: tag, uid: null, roomId: null, name: 'Joueur', privacy: 'everyone', channel: 'party', muted: true, ready: false, speaking: false };
    const ws = {
      sent,
      serializeAttachment(v) { att = v; },
      deserializeAttachment() { return att; },
      send(txt) { sent.push(JSON.parse(txt)); },
    };
    hub.ctx.acceptWebSocket(ws, [tag]);
    return ws;
  };

  const v1 = makeMockWs('voice');
  const v2 = makeMockWs('voice');
  await hub.webSocketMessage(v1, JSON.stringify({ type: 'register', uid: 'u1', name: 'P1', privacy: 'everyone' }));
  await hub.webSocketMessage(v2, JSON.stringify({ type: 'register', uid: 'u2', name: 'P2', privacy: 'everyone' }));
  await hub.webSocketMessage(v1, JSON.stringify({ type: 'join_room', roomId: 'party_1' }));
  await hub.webSocketMessage(v2, JSON.stringify({ type: 'join_room', roomId: 'party_1' }));
  await hub.webSocketMessage(v1, JSON.stringify({ type: 'webrtc_signal', toUid: 'u2', signal: { type: 'offer', sdp: 'v=0' } }));

  assert.ok(v2.sent.some((m) => m.type === 'webrtc_signal' && m.fromUid === 'u1' && m.signal?.type === 'offer'));

  const n1 = makeMockWs('netplay');
  const n2 = makeMockWs('netplay');
  await hub.webSocketMessage(n1, JSON.stringify({ type: 'IDENTIFY', uid: 'u1', name: 'P1' }));
  await hub.webSocketMessage(n2, JSON.stringify({ type: 'IDENTIFY', uid: 'u2', name: 'P2' }));
  await hub.webSocketMessage(n1, JSON.stringify({ type: 'RTC_SIGNAL', challengeId: 'c1', targetUid: 'u2', signalType: 'offer', payload: { sdp: 'v=0' } }));

  assert.ok(n2.sent.some((m) => m.type === 'RTC_SIGNAL' && m.fromUid === 'u1' && m.signalType === 'offer'));
});

test('Worker entrypoint /health & /api/voicebridge', async () => {
  const env = createTestEnv();
  const hRes = await worker.fetch(new Request('https://example.workers.dev/health'), env);
  assert.equal(hRes.status, 200);
  const hJson = await hRes.json();
  assert.equal(hJson.ok, true);

  const vbRes = await worker.fetch(
    new Request('https://example.workers.dev/api/voicebridge?route=create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),
    env
  );
  assert.equal(vbRes.status, 200);
  const vbJson = await vbRes.json();
  assert.ok(vbJson.room && vbJson.session);
});
