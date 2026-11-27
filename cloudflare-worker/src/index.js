/**
 * Point d'entrée Cloudflare Worker :
 *  - POST /api.php?route=... & /api/voicebridge?route=... -> Traduction complète VoiceBridge (Durable Objects SQLite)
 *  - GET  /api/turn-credentials -> Identifiants éphémères Cloudflare Anycast TURN + STUN
 *  - GET  /ws/voice & /ws/netplay -> WebSocket Hibernation sur Durable Object (`SignalingHubDO`)
 *  - GET  /health -> Vérification d'état edge
 */

import { handleTurnCredentialsRequest } from './turn.js';
import { handleVoiceBridgeRequest, VoiceBridgeRoomDO } from './voicebridge.js';
import { SignalingHubDO } from './signalingHub.js';

export { VoiceBridgeRoomDO, SignalingHubDO };

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = getCorsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === '/health') {
      return Response.json(
        { ok: true, mode: 'cloudflare-worker-webrtc-p2p', edge: true },
        { headers: cors }
      );
    }

    if (url.pathname === '/api/turn-credentials') {
      return handleTurnCredentialsRequest(env, cors);
    }

    if (url.pathname === '/api.php' || url.pathname === '/api/voicebridge') {
      return handleVoiceBridgeRequest(request, env, cors);
    }

    if (url.pathname === '/ws/voice' || url.pathname === '/ws/netplay') {
      const hubStub = env.SIGNALING_HUB.getByName('global-hub');
      return hubStub.fetch(request);
    }

    return Response.json({ error: 'Unknown endpoint.' }, { status: 404, headers: cors });
  },
};
