import { WebSocketServer, WebSocket } from 'ws';
import fs from 'node:fs';
import path from 'node:path';

function loadEnvValue(key, fallback = '') {
  if (process.env[key]) return process.env[key];
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0 && trimmed.slice(0, eq).trim() === key) {
          return trimmed.slice(eq + 1).trim();
        }
      }
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

const SASPAY_COIN_PACKS = {
  pack_10: { id: 'pack_10', coins: 10, amount: 250, currency: 'XOF', label: '10 Coins CSW-Arcade' },
  pack_25: { id: 'pack_25', coins: 25, amount: 400, currency: 'XOF', label: '25 Coins CSW-Arcade' },
  pack_50: { id: 'pack_50', coins: 50, amount: 550, currency: 'XOF', label: '50 Coins CSW-Arcade' },
  pack_99: { id: 'pack_99', coins: 99, amount: 655, currency: 'XOF', label: '99 Coins (Meilleure Offre)' },
};

export function setupNetplayHub(server) {
  const rooms = new Map(); // roomCode -> Room
  const clientRooms = new Map(); // ws -> { roomCode, playerIndex, role }
  const connectedUsers = new Map(); // uid -> Set<WebSocket>

  // Génération d'un code court de salon (ex: ARC-72 ou 4 caractères simples)
  function generateRoomCode() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `ARC-${code}`;
  }

  // REST API pour lister les salons ouverts sur le réseau local
  server.middlewares.use('/api/netplay/rooms', (req, res) => {
    try {
      const now = Date.now();
      const activeRooms = [];
      for (const [code, r] of rooms.entries()) {
        const age = now - (r.createdAt || 0);
        const occupiedPlayers = r.players.filter(p => p !== null).length;
        // Supprimer automatiquement les salons inactifs ou vides de plus de 25 minutes
        if (occupiedPlayers <= 1 && age > 25 * 60 * 1000) {
          rooms.delete(code);
          continue;
        }

        activeRooms.push({
          code,
          gameId: r.gameId,
          gameTitle: r.gameTitle,
          maxPlayers: r.maxPlayers,
          currentPlayers: occupiedPlayers,
          slots: r.players.map((p, idx) => ({
            slot: idx + 1,
            role: `p${idx + 1}`,
            isOccupied: p !== null,
            playerName: p ? p.name : null
          })),
          networkMode: 'local',
          createdAt: r.createdAt || now
        });
      }

      // Le dernier salon créé doit être en haut (tri par createdAt décroissant)
      activeRooms.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ success: true, rooms: activeRooms }));
    } catch(e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
  });

  // Relais temps réel local / LAN pour les salons Fightcade 2 (chat & présence) — garantit le fonctionnement même sans règles Firestore publiées
  const fcLobbies = new Map(); // gameId -> { messages: [], users: Map<uid, userObj> }
  const fcChallenges = new Map(); // challengeId -> challengeObj

  // Nettoyage automatique des défis expirés
  setInterval(() => {
    const now = Date.now();
    for (const [id, ch] of fcChallenges.entries()) {
      if (now > (ch.expiresAt || 0) + 60000) {
        fcChallenges.delete(id);
      }
    }
  }, 10000);

  server.middlewares.use('/api/fc-challenge', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    const url = new URL(req.url, 'http://localhost:3003');
    const challengeId = url.searchParams.get('id');
    const toUid = url.searchParams.get('toUid');

    if (req.method === 'GET') {
      const now = Date.now();
      if (challengeId) {
        const ch = fcChallenges.get(challengeId);
        if (ch) {
          res.statusCode = 200;
          return res.end(JSON.stringify({ ok: true, challenge: ch }));
        }
        res.statusCode = 404;
        return res.end(JSON.stringify({ ok: false, error: 'Challenge introuvable' }));
      }

      if (toUid) {
        const list = [];
        for (const ch of fcChallenges.values()) {
          if (ch.toUid === toUid && ch.status === 'pending' && ch.expiresAt > now) {
            list.push(ch);
          }
        }
        res.statusCode = 200;
        return res.end(JSON.stringify({ ok: true, challenges: list }));
      }

      res.statusCode = 400;
      return res.end(JSON.stringify({ ok: false, error: 'Paramètre id ou toUid requis' }));
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const { action, challenge, id, status, offer, answer, role, candidate } = payload;

          if (action === 'create' && challenge?.challengeId) {
            fcChallenges.set(challenge.challengeId, {
              ...challenge,
              callerCandidates: [],
              calleeCandidates: [],
              updatedAtMs: Date.now()
            });
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true }));
          }

          const targetId = id || challenge?.challengeId;
          const target = fcChallenges.get(targetId);
          if (!target) {
            res.statusCode = 404;
            return res.end(JSON.stringify({ ok: false, error: 'Challenge introuvable' }));
          }

          if (action === 'respond') {
            target.status = status;
            target.updatedAtMs = Date.now();
          } else if (action === 'postOffer') {
            target.offer = offer;
            target.updatedAtMs = Date.now();
          } else if (action === 'postAnswer') {
            target.answer = answer;
            target.updatedAtMs = Date.now();
          } else if (action === 'addCandidate') {
            const list = role === 'caller' ? target.callerCandidates : target.calleeCandidates;
            list.push(candidate);
            target.updatedAtMs = Date.now();
          }

          res.statusCode = 200;
          return res.end(JSON.stringify({ ok: true, challenge: target }));
        } catch (err) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false }));
  });

  const getFcLobby = (gameId) => {
    const key = String(gameId || 'global-lobby');
    if (!fcLobbies.has(key)) {
      fcLobbies.set(key, { messages: [], users: new Map() });
    }
    return fcLobbies.get(key);
  };

  server.middlewares.use('/api/fc-lobby', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    const url = new URL(req.url, 'http://localhost:3003');
    const gameId = url.searchParams.get('gameId') || 'global-lobby';

    if (req.method === 'GET') {
      const lobby = getFcLobby(gameId);
      const now = Date.now();
      const users = [];
      for (const [uid, u] of lobby.users.entries()) {
        if (now - (u.lastSeen || 0) < 60000) {
          users.push(u);
        } else {
          lobby.users.delete(uid);
        }
      }
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, messages: lobby.messages.slice(-80), users }));
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = body ? JSON.parse(body) : {};
          const targetId = payload.gameId || gameId;
          const lobby = getFcLobby(targetId);

          if (payload.action === 'message' && payload.message) {
            const msg = {
              id: payload.message.id || `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              ...payload.message,
              createdAtMs: payload.message.createdAtMs || Date.now(),
            };
            if (!lobby.messages.some((m) => m.id === msg.id)) {
              lobby.messages.push(msg);
              if (lobby.messages.length > 120) lobby.messages = lobby.messages.slice(-80);
            }
          } else if (payload.action === 'presence' && payload.user?.uid) {
            lobby.users.set(payload.user.uid, {
              ...payload.user,
              lastSeen: Date.now(),
            });
          } else if (payload.action === 'leave' && payload.uid) {
            lobby.users.delete(payload.uid);
          }

          res.statusCode = 200;
          return res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false }));
  });

  // Relais de Synchronisation Parfaite du Compte Multi-Appareils (Crédits, Salons actifs, Stats/Scores, Reprise de partie / Savestate Cloud)
  const accountSyncStore = new Map(); // uid -> { coins, ..., gameStats: Map<gameId, stat>, ... }
  const gameLeaderboards = new Map(); // gameId -> Map<uid, lbEntry>

  const getAccountRecord = (uid) => {
    const key = String(uid || '');
    if (!accountSyncStore.has(key)) {
      accountSyncStore.set(key, {
        uid: key,
        coins: null,
        coinsUpdatedAtMs: 0,
        activeChannels: null,
        channelsUpdatedAtMs: 0,
        selectedChannelId: null,
        activeSession: null,
        statePayload: null,
        gameStats: new Map(),
        updatedAtMs: 0,
      });
    }
    return accountSyncStore.get(key);
  };

  server.middlewares.use('/api/game-leaderboard', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }
    const url = new URL(req.url, 'http://localhost:3003');
    const gameId = url.searchParams.get('gameId') || '';

    if (req.method === 'GET') {
      const lbMap = gameLeaderboards.get(gameId);
      const rows = lbMap
        ? Array.from(lbMap.values()).sort((a, b) => (b.bestScore || 0) - (a.bestScore || 0)).slice(0, 25)
        : [];
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, rows }));
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const entry = body ? JSON.parse(body) : {};
          const gid = entry.gameId || gameId;
          if (gid && entry.uid) {
            if (!gameLeaderboards.has(gid)) gameLeaderboards.set(gid, new Map());
            const lbMap = gameLeaderboards.get(gid);
            const prev = lbMap.get(entry.uid);
            if (!prev || Number(entry.bestScore || 0) >= Number(prev.bestScore || 0)) {
              lbMap.set(entry.uid, { ...prev, ...entry, updatedAtMs: Date.now() });
            }
          }
          res.statusCode = 200;
          return res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false }));
  });

  server.middlewares.use('/api/account-sync', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    const url = new URL(req.url, 'http://localhost:3003');
    const uid = url.searchParams.get('uid');
    const includeState = url.searchParams.get('includeState') === '1';

    if (req.method === 'GET') {
      if (!uid) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'Missing uid' }));
      }
      const rec = getAccountRecord(uid);
      res.statusCode = 200;
      return res.end(
        JSON.stringify({
          ok: true,
          uid: rec.uid,
          coins: rec.coins,
          coinsUpdatedAtMs: rec.coinsUpdatedAtMs,
          activeChannels: rec.activeChannels,
          channelsUpdatedAtMs: rec.channelsUpdatedAtMs,
          selectedChannelId: rec.selectedChannelId,
          activeSession: rec.activeSession,
          gameStats: Array.from(rec.gameStats.values()),
          hasSavestate: Boolean(rec.statePayload && rec.statePayload.dataBase64),
          savestateMeta: rec.statePayload
            ? {
                gameId: rec.statePayload.gameId,
                encoding: rec.statePayload.encoding,
                savedAtMs: rec.statePayload.savedAtMs,
                size: rec.statePayload.dataBase64?.length || 0,
              }
            : null,
          statePayload: includeState ? rec.statePayload : null,
          updatedAtMs: rec.updatedAtMs,
        })
      );
    }

    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        try {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          const payload = rawBody ? JSON.parse(rawBody) : {};
          const targetUid = payload.uid || uid;
          if (!targetUid) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ ok: false, error: 'Missing uid' }));
          }
          const rec = getAccountRecord(targetUid);
          const now = Date.now();

          if (typeof payload.coins === 'number' && (payload.coinsUpdatedAtMs || now) >= rec.coinsUpdatedAtMs) {
            rec.coins = Math.max(0, Math.min(99, Math.floor(payload.coins)));
            rec.coinsUpdatedAtMs = payload.coinsUpdatedAtMs || now;
          }
          if (Array.isArray(payload.activeChannels) && (payload.channelsUpdatedAtMs || now) >= rec.channelsUpdatedAtMs) {
            rec.activeChannels = payload.activeChannels.slice(0, 3);
            rec.channelsUpdatedAtMs = payload.channelsUpdatedAtMs || now;
          }
          if (payload.selectedChannelId !== undefined) {
            rec.selectedChannelId = payload.selectedChannelId;
          }
          if (payload.activeSession !== undefined) {
            rec.activeSession = payload.activeSession
              ? { ...payload.activeSession, updatedAtMs: now }
              : null;
          }
          if (Array.isArray(payload.gameStats)) {
            for (const st of payload.gameStats) {
              if (!st?.gameId) continue;
              const prev = rec.gameStats.get(st.gameId);
              if (
                !prev ||
                Number(st.bestScore || 0) > Number(prev.bestScore || 0) ||
                Number(st.gamesPlayed || 0) > Number(prev.gamesPlayed || 0) ||
                Number(st.playTimeSeconds || 0) > Number(prev.playTimeSeconds || 0)
              ) {
                rec.gameStats.set(st.gameId, {
                  ...prev,
                  ...st,
                  bestScore: Math.max(Number(prev?.bestScore || 0), Number(st.bestScore || 0)),
                  gamesPlayed: Math.max(Number(prev?.gamesPlayed || 0), Number(st.gamesPlayed || 0)),
                  playTimeSeconds: Math.max(Number(prev?.playTimeSeconds || 0), Number(st.playTimeSeconds || 0)),
                });
              }
            }
          }
          if (payload.statePayload && payload.statePayload.dataBase64) {
            rec.statePayload = {
              gameId: payload.statePayload.gameId,
              encoding: payload.statePayload.encoding || 'raw',
              dataBase64: payload.statePayload.dataBase64,
              savedAtMs: now,
            };
          }
          rec.updatedAtMs = now;

          res.statusCode = 200;
          return res.end(JSON.stringify({ ok: true, updatedAtMs: now }));
        } catch (err) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false }));
  });

  // Attach WebSocket server to httpServer avec support de payload de 64 Mo pour les savestates à froid
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });

  if (server.httpServer) {
    server.httpServer.on('upgrade', (request, socket, head) => {
      try {
        const url = new URL(request.url, 'http://localhost:3003');
        if (url.pathname === '/ws/netplay') {
          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
          });
        }
      } catch(e) {
        socket.destroy();
      }
    });
  }

  // ============================================================================
  // PASSERELLE DE PAIEMENT SASPAY (Clé secrète côté serveur uniquement)
  // ============================================================================
  const saspayTransactions = new Map(); // paymentId -> { paymentId, uid, coins, amount, currency, status, credited, createdAtMs }

  function creditSyncedWalletCoins(uid, coinsToAdd) {
    if (!uid || !coinsToAdd) return 0;
    const rec = getAccountRecord(uid);
    const base = typeof rec.coins === 'number' ? rec.coins : 0;
    const next = Math.max(0, Math.min(99, base + Math.floor(coinsToAdd)));
    rec.coins = next;
    rec.coinsUpdatedAtMs = Date.now();
    rec.updatedAtMs = Date.now();
    return next;
  }

  function isSasPayPaidStatus(statusStr) {
    const s = String(statusStr || '').toLowerCase();
    return ['paid', 'success', 'succeeded', 'completed', 'complete', 'approved'].includes(s);
  }

  function formatSasPayError(apiData, statusCode) {
    const raw = apiData?.message || apiData?.detail || apiData?.error;
    if (typeof raw === 'string' && raw.trim()) return raw;
    if (raw && typeof raw === 'object') {
      const parts = [];
      for (const [k, v] of Object.entries(raw)) {
        const msg = Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
        parts.push(`${k}: ${msg}`);
      }
      if (parts.length > 0) return parts.join(' · ');
    }
    return `Erreur SasPay (HTTP ${statusCode})`;
  }

  let cachedSasPayNetworks = null;
  let cachedSasPayNetworksAt = 0;

  server.middlewares.use('/api/saspay/networks', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const now = Date.now();
    if (cachedSasPayNetworks && now - cachedSasPayNetworksAt < 10 * 60 * 1000) {
      return res.end(JSON.stringify({ ok: true, data: cachedSasPayNetworks }));
    }
    const baseUrl = loadEnvValue('SASPAY_BASE_URL', 'https://api.saspay.me/api/v1');
    const secretKey = loadEnvValue('SASPAY_SECRET_KEY');
    try {
      const all = [];
      let nextUrl = `${baseUrl}/networks/?page=1`;
      for (let guard = 0; guard < 10 && nextUrl; guard++) {
        const r = await fetch(nextUrl, {
          headers: {
            Accept: 'application/json',
            ...(secretKey ? { Authorization: `Bearer ${secretKey}` } : {}),
          },
        });
        if (!r.ok) break;
        const json = await r.json().catch(() => ({}));
        const d = json?.data || json;
        const rows = Array.isArray(d?.results) ? d.results : Array.isArray(d) ? d : [];
        all.push(...rows);
        nextUrl = d?.next || null;
      }
      cachedSasPayNetworks = all.filter((n) => n?.is_active !== false);
      cachedSasPayNetworksAt = now;
      return res.end(JSON.stringify({ ok: true, data: cachedSasPayNetworks }));
    } catch (e) {
      res.statusCode = 502;
      return res.end(JSON.stringify({ ok: false, error: e?.message || 'SasPay networks unreachable' }));
    }
  });

  server.middlewares.use('/api/saspay/countries', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const baseUrl = loadEnvValue('SASPAY_BASE_URL', 'https://api.saspay.me/api/v1');
    try {
      const r = await fetch(`${baseUrl}/countries/`, {
        headers: { Accept: 'application/json' },
      });
      const data = await r.json().catch(() => ({}));
      res.statusCode = r.ok ? 200 : r.status;
      return res.end(JSON.stringify({ ok: r.ok, data }));
    } catch (e) {
      res.statusCode = 502;
      return res.end(JSON.stringify({ ok: false, error: e?.message || 'SasPay unreachable' }));
    }
  });

  server.middlewares.use('/api/saspay/checkout', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'POST') {
      res.statusCode = 405;
      return res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
    }
    const secretKey = loadEnvValue('SASPAY_SECRET_KEY');
    const baseUrl = loadEnvValue('SASPAY_BASE_URL', 'https://api.saspay.me/api/v1');
    if (!secretKey) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: 'SASPAY_SECRET_KEY manquante côté serveur' }));
    }

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const pack = SASPAY_COIN_PACKS[body.packId];
        if (!pack) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ ok: false, error: 'Pack de coins invalide' }));
        }
        const uid = String(body.uid || 'guest');
        const origin = String(body.origin || 'http://localhost:3003').replace(/\/+$/, '');
        const method = body.mode === 'softpay' ? 'softpay' : 'checkout';

        let targetUrl = `${baseUrl}/checkout-sessions/`;
        const custEmail = String(body.email || 'joueur@csw-arcade.com').trim();
        const custName = String(body.displayName || 'Joueur CSW').trim();
        const nameParts = custName.split(/\s+/).filter(Boolean);
        const custFirstName = String(body.firstName || nameParts[0] || 'Joueur').trim();
        const custLastName = String(body.lastName || nameParts.slice(1).join(' ') || custFirstName).trim();
        const custPhone = body.phone ? String(body.phone).trim() : undefined;

        let saspayPayload = {
          amount: pack.amount,
          currency: pack.currency,
          description: `${pack.label} (${uid})`,
          return_url: `${origin}/?saspay_status=success`,
          success_url: `${origin}/?saspay_status=success`,
          cancel_url: `${origin}/?saspay_status=cancel`,
          customer_email: custEmail,
          customer_name: `${custFirstName} ${custLastName}`.trim(),
          ...(custPhone ? { customer_phone: custPhone } : {}),
          metadata: { uid, packId: pack.id, coins: pack.coins },
        };

        if (method === 'softpay' && body.phone && body.network) {
          targetUrl = `${baseUrl}/payments/softpay/`;
          saspayPayload = {
            amount: pack.amount,
            currency: pack.currency,
            phone: String(body.phone).trim(),
            network: String(body.network).trim().toLowerCase(),
            country: body.country ? String(body.country).trim().toUpperCase() : undefined,
            description: `${pack.label} (${uid})`,
            metadata: { uid, packId: pack.id, coins: pack.coins },
            customer: {
              first_name: custFirstName,
              last_name: custLastName,
              email: custEmail,
              phone: String(body.phone).trim(),
            },
          };
        }

        const apiRes = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${secretKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(saspayPayload),
        });

        const apiData = await apiRes.json().catch(() => ({}));
        if (!apiRes.ok) {
          res.statusCode = apiRes.status || 400;
          return res.end(
            JSON.stringify({
              ok: false,
              error: formatSasPayError(apiData, apiRes.status),
              details: apiData,
            })
          );
        }

        const paymentId =
          apiData?.id ||
          apiData?.payment_id ||
          apiData?.reference ||
          apiData?.data?.id ||
          apiData?.data?.payment_id ||
          `sp_${Date.now()}`;

        const checkoutUrl =
          apiData?.checkout_url ||
          apiData?.payment_url ||
          apiData?.url ||
          apiData?.redirect_url ||
          apiData?.data?.checkout_url ||
          apiData?.data?.url ||
          null;

        const status = apiData?.status || apiData?.data?.status || 'pending';
        const paidNow = isSasPayPaidStatus(status);
        let newCoins = null;
        if (paidNow) {
          newCoins = creditSyncedWalletCoins(uid, pack.coins);
        }

        saspayTransactions.set(String(paymentId), {
          paymentId: String(paymentId),
          uid,
          coins: pack.coins,
          amount: pack.amount,
          currency: pack.currency,
          status: String(status),
          credited: paidNow,
          createdAtMs: Date.now(),
        });

        res.statusCode = 200;
        return res.end(
          JSON.stringify({
            ok: true,
            paymentId: String(paymentId),
            checkoutUrl,
            status,
            paid: paidNow,
            coinsAdded: paidNow ? pack.coins : 0,
            newCoins,
            pack,
            raw: apiData,
          })
        );
      } catch (e) {
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error: e?.message || 'Erreur serveur SasPay' }));
      }
    });
  });

  server.middlewares.use('/api/saspay/verify', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const url = new URL(req.url, 'http://localhost');
    const paymentId = url.searchParams.get('paymentId');
    const uidParam = url.searchParams.get('uid');
    if (!paymentId) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok: false, error: 'paymentId manquant' }));
    }

    const tx = saspayTransactions.get(paymentId);
    if (tx?.credited) {
      return res.end(
        JSON.stringify({ ok: true, paid: true, alreadyCredited: true, coinsAdded: tx.coins, status: tx.status })
      );
    }

    const secretKey = loadEnvValue('SASPAY_SECRET_KEY');
    const baseUrl = loadEnvValue('SASPAY_BASE_URL', 'https://api.saspay.me/api/v1');
    try {
      const apiRes = await fetch(`${baseUrl}/payments/${encodeURIComponent(paymentId)}/verify/`, {
        headers: {
          Authorization: `Bearer ${secretKey}`,
          Accept: 'application/json',
        },
      });
      const apiData = await apiRes.json().catch(() => ({}));
      const status = apiData?.status || apiData?.data?.status || 'pending';
      const paid = apiRes.ok && isSasPayPaidStatus(status);
      let newCoins = null;
      let coinsAdded = 0;

      if (paid) {
        const targetUid = tx?.uid || uidParam || apiData?.metadata?.uid;
        coinsAdded = tx?.coins || Number(apiData?.metadata?.coins || 10);
        if (targetUid && !tx?.credited) {
          newCoins = creditSyncedWalletCoins(targetUid, coinsAdded);
        }
        saspayTransactions.set(paymentId, {
          ...(tx || { paymentId, uid: targetUid, coins: coinsAdded }),
          status: String(status),
          credited: true,
        });
      }

      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, paid, status, coinsAdded, newCoins }));
    } catch (e) {
      res.statusCode = 502;
      return res.end(JSON.stringify({ ok: false, error: e?.message || 'Erreur vérification SasPay' }));
    }
  });

  server.middlewares.use('/api/saspay/webhook', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'POST') {
      res.statusCode = 405;
      return res.end(JSON.stringify({ ok: false }));
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const event = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const data = event?.data || event;
        const paymentId = String(data?.id || data?.payment_id || data?.reference || '');
        const status = data?.status || event?.event || '';
        if (paymentId && isSasPayPaidStatus(status)) {
          const tx = saspayTransactions.get(paymentId);
          if (tx && !tx.credited) {
            creditSyncedWalletCoins(tx.uid, tx.coins);
            tx.credited = true;
            tx.status = String(status);
          }
        }
      } catch {}
      res.statusCode = 200;
      res.end(JSON.stringify({ received: true }));
    });
  });

  function broadcastRoomUpdate(room) {
    const payload = JSON.stringify({
      type: 'ROOM_UPDATE',
      room: {
        code: room.code,
        gameId: room.gameId,
        gameTitle: room.gameTitle,
        maxPlayers: room.maxPlayers,
        players: room.players.map((p, idx) => p ? {
          slot: idx + 1,
          name: p.name,
          playerIndex: idx,
          isHost: idx === 0,
          ping: p.ping || 0
        } : null),
        spectatorsCount: room.spectators.length
      }
    });

    for (const p of room.players) {
      if (p && p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(payload);
      }
    }
    for (const s of room.spectators) {
      if (s.ws.readyState === WebSocket.OPEN) {
        s.ws.send(payload);
      }
    }
  }

  function handleClientDisconnect(ws) {
    if (ws.uid && connectedUsers.has(ws.uid)) {
      const set = connectedUsers.get(ws.uid);
      set.delete(ws);
      if (set.size === 0) connectedUsers.delete(ws.uid);
    }

    const info = clientRooms.get(ws);
    if (!info) return;
    clientRooms.delete(ws);

    const room = rooms.get(info.roomCode);
    if (!room) return;

    if (info.playerIndex === 0) {
      // L'hôte a quitté -> notifier tout le monde et fermer le salon
      for (const p of room.players) {
        if (p && p.ws !== ws && p.ws.readyState === WebSocket.OPEN) {
          p.ws.send(JSON.stringify({ type: 'HOST_DISCONNECTED', message: "L'hôte a fermé la partie." }));
        }
      }
      for (const s of room.spectators) {
        if (s.ws.readyState === WebSocket.OPEN) {
          s.ws.send(JSON.stringify({ type: 'HOST_DISCONNECTED', message: "L'hôte a fermé la partie." }));
        }
      }
      rooms.delete(room.code);
    } else if (info.playerIndex > 0) {
      // Un joueur invité (J2, J3, J4) a quitté -> libérer son slot
      room.players[info.playerIndex] = null;
      broadcastRoomUpdate(room);
    } else {
      // Spectateur
      room.spectators = room.spectators.filter(s => s.ws !== ws);
      broadcastRoomUpdate(room);
    }
  }

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        switch(data.type) {
          case 'IDENTIFY': {
            const { uid, name } = data;
            if (uid) {
              ws.uid = uid;
              ws.userName = name;
              if (!connectedUsers.has(uid)) connectedUsers.set(uid, new Set());
              connectedUsers.get(uid).add(ws);
              ws.send(JSON.stringify({ type: 'IDENTIFIED', uid, ok: true }));
            }
            break;
          }

          case 'CHALLENGE_INVITE': {
            const { challenge } = data;
            if (challenge && challenge.challengeId) {
              fcChallenges.set(challenge.challengeId, challenge);
              const targetUid = challenge.toUid;
              const sockets = connectedUsers.get(targetUid);
              if (sockets) {
                const msg = JSON.stringify({ type: 'INCOMING_CHALLENGE', challenge });
                for (const s of sockets) {
                  if (s.readyState === WebSocket.OPEN) s.send(msg);
                }
              }
            }
            break;
          }

          case 'CHALLENGE_REPLY': {
            const { challengeId, status, toUid } = data;
            const ch = fcChallenges.get(challengeId);
            if (ch) {
              ch.status = status;
              ch.updatedAtMs = Date.now();
            }
            const sockets = connectedUsers.get(toUid);
            if (sockets) {
              const msg = JSON.stringify({ type: 'CHALLENGE_STATUS_CHANGED', challengeId, status, challenge: ch });
              for (const s of sockets) {
                if (s.readyState === WebSocket.OPEN) s.send(msg);
              }
            }
            break;
          }

          case 'MATCH_SYNC_UPDATE': {
            const { challengeId, targetUid, romPct, romReady, isReady } = data;
            const sockets = connectedUsers.get(targetUid);
            if (sockets) {
              const msg = JSON.stringify({
                type: 'MATCH_SYNC_UPDATE',
                challengeId,
                romPct,
                romReady: Boolean(romReady),
                isReady: Boolean(isReady),
              });
              for (const s of sockets) {
                if (s.readyState === WebSocket.OPEN) s.send(msg);
              }
            }
            break;
          }

          case 'MATCH_COUNTDOWN_START': {
            const { challengeId, targetUid } = data;
            const sockets = connectedUsers.get(targetUid);
            if (sockets) {
              const msg = JSON.stringify({ type: 'MATCH_COUNTDOWN_START', challengeId });
              for (const s of sockets) {
                if (s.readyState === WebSocket.OPEN) s.send(msg);
              }
            }
            break;
          }

          case 'MATCH_CANCEL': {
            const { challengeId, targetUid } = data;
            if (challengeId && fcChallenges.has(challengeId)) {
              const ch = fcChallenges.get(challengeId);
              ch.status = 'declined';
            }
            const sockets = connectedUsers.get(targetUid);
            if (sockets) {
              const msg = JSON.stringify({ type: 'MATCH_CANCELLED', challengeId });
              for (const s of sockets) {
                if (s.readyState === WebSocket.OPEN) s.send(msg);
              }
            }
            break;
          }

          case 'RELAY_INPUT': {
            const { targetUid, buttonIdx, pressed, frame } = data;
            const sockets = connectedUsers.get(targetUid);
            if (sockets) {
              const msg = JSON.stringify({ type: 'REMOTE_BTN_RELAY', buttonIdx, pressed, frame });
              for (const s of sockets) {
                if (s.readyState === WebSocket.OPEN) s.send(msg);
              }
            }
            break;
          }

          case 'CREATE_ROOM': {
            const { gameId, gameTitle, maxPlayers = 2, hostName = 'Hôte' } = data;

            // Si cet hôte avait déjà un salon ouvert, supprimer immédiatement l'ancien salon !
            const prevClientInfo = clientRooms.get(ws);
            if (prevClientInfo && rooms.has(prevClientInfo.roomCode)) {
              console.log(`[NetplayHub] Remplacement de l'ancien salon de l'hôte: ${prevClientInfo.roomCode}`);
              rooms.delete(prevClientInfo.roomCode);
            }
            // Supprimer tout autre salon inactif créé précédemment par le même pseudo
            for (const [c, r] of rooms.entries()) {
              if (r.players[0]?.name === hostName && r.players.filter(Boolean).length <= 1) {
                rooms.delete(c);
              }
            }

            const cleanMaxPlayers = Math.max(2, Math.min(4, Number(maxPlayers) || 2));
            const code = generateRoomCode();

            const players = new Array(cleanMaxPlayers).fill(null);
            players[0] = {
              ws,
              name: hostName,
              playerIndex: 0,
              isHost: true,
              ping: 0
            };

            const room = {
              code,
              hostWs: ws,
              gameId,
              gameTitle,
              maxPlayers: cleanMaxPlayers,
              createdAt: Date.now(),
              players,
              spectators: []
            };

            rooms.set(code, room);
            clientRooms.set(ws, { roomCode: code, playerIndex: 0, role: 'p1' });

            ws.send(JSON.stringify({
              type: 'ROOM_CREATED',
              roomCode: code,
              playerIndex: 0,
              maxPlayers: cleanMaxPlayers,
              role: 'p1',
              gameId,
              gameTitle,
              hostName
            }));

            broadcastRoomUpdate(room);
            break;
          }

          case 'JOIN_ROOM': {
            const { roomCode, playerName = 'Joueur' } = data;
            const raw = (roomCode || '').trim().toUpperCase();
            const fullCode = raw.startsWith('ARC-') ? raw : (raw.length <= 4 ? `ARC-${raw}` : raw);
            const room = rooms.get(fullCode) || rooms.get(raw);
            if (!room) {
              ws.send(JSON.stringify({ type: 'ERROR', message: `Le salon "${roomCode}" n'existe pas.` }));
              return;
            }

            // Trouver le premier slot disponible entre 1 et maxPlayers - 1
            let assignedSlot = -1;
            for (let i = 1; i < room.maxPlayers; i++) {
              if (room.players[i] === null) {
                assignedSlot = i;
                break;
              }
            }

            const currentPlayersList = room.players.map((p, idx) => p ? {
              slot: idx + 1,
              name: p.name,
              playerIndex: idx,
              isHost: idx === 0,
              ping: p.ping || 0
            } : null);

            if (assignedSlot !== -1) {
              // Joueur actif assigné
              const newPlayer = {
                ws,
                name: playerName || `Joueur ${assignedSlot + 1}`,
                playerIndex: assignedSlot,
                isHost: false,
                ping: 0
              };
              room.players[assignedSlot] = newPlayer;
              currentPlayersList[assignedSlot] = {
                slot: assignedSlot + 1,
                name: newPlayer.name,
                playerIndex: assignedSlot,
                isHost: false,
                ping: 0
              };
              const role = `p${assignedSlot + 1}`;
              clientRooms.set(ws, { roomCode: room.code, playerIndex: assignedSlot, role });

              ws.send(JSON.stringify({
                type: 'JOINED_SUCCESS',
                roomCode: room.code,
                playerIndex: assignedSlot,
                maxPlayers: room.maxPlayers,
                role,
                gameId: room.gameId,
                gameTitle: room.gameTitle,
                players: currentPlayersList
              }));
            } else {
              // Plus de slots joueur disponibles -> Spectateur
              room.spectators.push({ ws, name: playerName });
              clientRooms.set(ws, { roomCode: room.code, playerIndex: -1, role: 'spectator' });

              ws.send(JSON.stringify({
                type: 'JOINED_SUCCESS',
                roomCode: room.code,
                playerIndex: -1,
                maxPlayers: room.maxPlayers,
                role: 'spectator',
                gameId: room.gameId,
                gameTitle: room.gameTitle,
                players: currentPlayersList
              }));
            }

            broadcastRoomUpdate(room);
            break;
          }

          case 'SEND_INPUT': {
            // Relayer l'action vers tous les autres joueurs (J1 -> J2, J2 -> J1)
            const info = clientRooms.get(ws);
            if (!info) return;
            const room = rooms.get(info.roomCode);
            if (!room) return;

            const { buttonId, isPressed, frame, playerIndex, history, ackFrame, seq } = data;
            const effectiveIndex = (typeof playerIndex === 'number') ? playerIndex : info.playerIndex;

            const payload = JSON.stringify({
              type: 'REMOTE_INPUT',
              playerIndex: effectiveIndex,
              buttonId,
              isPressed: !!isPressed,
              frame: frame || 0,
              history: Array.isArray(history) ? history : [],
              ackFrame: ackFrame || 0,
              seq: seq || 0
            });

            // Diffuser à TOUS les autres clients du salon (l'hôte et les invités)
            for (const p of room.players) {
              if (p && p.ws !== ws && p.ws.readyState === WebSocket.OPEN) {
                p.ws.send(payload);
              }
            }
            for (const s of room.spectators) {
              if (s && s.ws !== ws && s.ws.readyState === WebSocket.OPEN) {
                s.ws.send(payload);
              }
            }
            break;
          }

          case 'REQUEST_STATE': {
            // Un joueur arrivant en cours de partie demande le savestate actuel à l'hôte
            const info = clientRooms.get(ws);
            if (!info) return;
            const room = rooms.get(info.roomCode);
            if (!room || !room.hostWs) return;

            if (room.hostWs.readyState === WebSocket.OPEN) {
              room.hostWs.send(JSON.stringify({
                type: 'REQUEST_STATE',
                fromPlayerIndex: info.playerIndex
              }));
            }
            break;
          }

          case 'SEND_STATE': {
            // L'hôte envoie son savestate de synchronisation à froid
            const info = clientRooms.get(ws);
            if (!info || info.playerIndex !== 0) return;
            const room = rooms.get(info.roomCode);
            if (!room) return;

            const { toPlayerIndex, stateBase64, stateSize, stateData, frame } = data;
            const payload = JSON.stringify({
              type: 'SYNC_STATE',
              stateBase64: stateBase64 || null,
              stateSize: stateSize || 0,
              stateData: stateData || null,
              frame: frame || 0
            });

            if (toPlayerIndex !== undefined && room.players[toPlayerIndex]) {
              const targetWs = room.players[toPlayerIndex].ws;
              if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(payload);
              }
            } else {
              for (const p of room.players) {
                if (p && p.playerIndex > 0 && p.ws.readyState === WebSocket.OPEN) {
                  p.ws.send(payload);
                }
              }
            }
            break;
          }

          case 'START_GAME': {
            const info = clientRooms.get(ws);
            if (!info || info.playerIndex !== 0) return;
            const room = rooms.get(info.roomCode);
            if (!room) return;

            const payload = JSON.stringify({
              type: 'GAME_STARTED_BY_HOST',
              roomCode: room.code,
              gameId: room.gameId,
              gameTitle: room.gameTitle
            });

            for (const p of room.players) {
              if (p && p.ws.readyState === WebSocket.OPEN) {
                p.ws.send(payload);
              }
            }
            for (const s of room.spectators) {
              if (s.ws && s.ws.readyState === WebSocket.OPEN) {
                s.ws.send(payload);
              }
            }
            break;
          }

          case 'PING': {
            ws.send(JSON.stringify({
              type: 'PONG',
              clientTime: data.clientTime,
              serverTime: Date.now()
            }));
            break;
          }

          case 'CLOSE_ROOM': {
            const { roomCode } = data;
            if (roomCode && rooms.has(roomCode)) {
              console.log(`[NetplayHub] Fermeture explicite du salon ${roomCode}`);
              const r = rooms.get(roomCode);
              for (const p of r.players) {
                if (p && p.ws !== ws && p.ws.readyState === WebSocket.OPEN) {
                  p.ws.send(JSON.stringify({ type: 'HOST_DISCONNECTED', message: "Le salon a été fermé par l'hôte." }));
                }
              }
              rooms.delete(roomCode);
            }
            break;
          }

          case 'LEAVE_ROOM': {
            handleClientDisconnect(ws);
            ws.send(JSON.stringify({ type: 'LEFT_ROOM' }));
            break;
          }
        }
      } catch(e) {
        console.warn('[NetplayHub] Erreur message WS:', e.message);
      }
    });

    ws.on('close', () => {
      handleClientDisconnect(ws);
    });

    ws.on('error', () => {
      handleClientDisconnect(ws);
    });
  });

  // Nettoyage périodique des connexions mortes
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      try { ws.ping(); } catch(e) {}
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));
}
