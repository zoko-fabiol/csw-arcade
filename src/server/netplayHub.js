import { WebSocketServer, WebSocket } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { supportsOnlineMultiplayer } from '../utils/gameCapabilities.js';
import { LocalFirebaseStore } from './localFirebaseStore.js';

async function fetchWithHeaderTimeout(url, options = {}, timeoutMs = 8500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function loadEnvValue(key, fallback = '') {
  if (process.env[key]) return process.env[key];
  try {
    const candidates = [
      path.resolve(process.cwd(), '.env'),
      '/opt/csw-arcade/.env',
      '/etc/csw-arcade.env',
    ];
    for (const envPath of candidates) {
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
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

const COUNTRY_DIAL_CODES = {
  CM: '237',
  CI: '225',
  SN: '221',
  BF: '226',
  BJ: '229',
  TG: '228',
  ML: '223',
  NE: '227',
  GA: '241',
  CG: '242',
  CD: '243',
  GN: '224',
  KE: '254',
  GH: '233',
  NG: '234',
  RW: '250',
  UG: '256',
  TZ: '255',
  ZM: '260',
  MW: '265',
  FR: '33',
};

function normalizeSasPayPhone(rawPhone, countryCode = '') {
  if (!rawPhone) return '';
  const digits = String(rawPhone).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return '+' + digits.slice(2);
  const cc = String(countryCode || '').trim().toUpperCase();
  const dial = COUNTRY_DIAL_CODES[cc];
  if (dial) {
    if (digits.startsWith(dial) && digits.length > dial.length + 6) {
      return '+' + digits;
    }
    const localDigits = digits.startsWith('0') && cc !== 'CI' ? digits.slice(1) : digits;
    return `+${dial}${localDigits}`;
  }
  return digits;
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
  const spectateMatches = new Map(); // matchKey -> { matchKey, challengeId, hostUid, guestUid, spectators: Map<uid, { uid, name }> }

  function sendToUid(uid, payloadObj) {
    if (!uid) return false;
    const sockets = connectedUsers.get(uid);
    if (!sockets || sockets.size === 0) return false;
    const raw = typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj);
    let sent = false;
    for (const s of sockets) {
      if (s.readyState === WebSocket.OPEN) {
        try {
          s.send(raw);
          sent = true;
        } catch {}
      }
    }
    return sent;
  }

  function findSpectateMatch({ challengeId = null, hostUid = null, targetUid = null, ws = null } = {}) {
    if (challengeId && spectateMatches.has(challengeId)) {
      return spectateMatches.get(challengeId);
    }
    for (const m of spectateMatches.values()) {
      if (
        (hostUid && (m.hostUid === hostUid || m.guestUid === hostUid)) ||
        (targetUid && (m.hostUid === targetUid || m.guestUid === targetUid)) ||
        (ws?.uid && (m.hostUid === ws.uid || m.guestUid === ws.uid))
      ) {
        return m;
      }
    }
    return null;
  }

  function broadcastSpectateCount(match) {
    if (!match) return;
    const count = match.spectators.size;
    const payload = JSON.stringify({
      type: 'SPECTATE_COUNT_UPDATE',
      matchKey: match.matchKey,
      challengeId: match.challengeId,
      spectatorsCount: count,
    });
    sendToUid(match.hostUid, payload);
    sendToUid(match.guestUid, payload);
    for (const specUid of match.spectators.keys()) {
      sendToUid(specUid, payload);
    }
  }

  function endSpectateMatch(matchKeyOrUid, reason = 'quit', senderName = 'Un joueur') {
    const match =
      spectateMatches.get(matchKeyOrUid) ||
      findSpectateMatch({ targetUid: matchKeyOrUid });
    if (!match) return;
    const payload = JSON.stringify({
      type: 'SPECTATE_ENDED',
      matchKey: match.matchKey,
      challengeId: match.challengeId,
      reason,
      senderName,
    });
    for (const specUid of match.spectators.keys()) {
      sendToUid(specUid, payload);
    }
    match.spectators.clear();
    spectateMatches.delete(match.matchKey);
  }

  function removeSpectatorFromMatch(ws, specificMatchKey = null) {
    const key = specificMatchKey || ws.spectatingMatchKey;
    ws.spectatingMatchKey = null;
    if (!key || !ws.uid) return;
    const match = spectateMatches.get(key);
    if (!match || !match.spectators.has(ws.uid)) return;
    match.spectators.delete(ws.uid);
    broadcastSpectateCount(match);
  }

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

  // Proxy ROM universel en production (standalone.js port 3003) & dev : streaming local public/roms ou proxy Archive.org
  const mappingPath = path.resolve(process.cwd(), 'src/data/fbneoMapping.json');
  let romNameMap = {};
  try {
    if (fs.existsSync(mappingPath)) {
      romNameMap = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
    }
  } catch {
    /* ignore */
  }

  server.middlewares.use('/api/rom-proxy', async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        });
        return res.end();
      }

      const romsDir = path.resolve(process.cwd(), 'public/roms');
      const url = new URL(req.url, 'http://localhost:3003');
      const customUrl = url.searchParams.get('url');

      if (customUrl && /^https?:\/\//i.test(customUrl)) {
        const remoteRes = await fetchWithHeaderTimeout(
          customUrl,
          {
            method: req.method === 'HEAD' ? 'HEAD' : 'GET',
            redirect: 'follow',
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CSW-Arcade' },
          },
          8500
        );
        const ct = (remoteRes.headers.get('content-type') || 'application/octet-stream').toLowerCase();
        if (!remoteRes.ok || ct.includes('text/html')) {
          res.writeHead(404, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'ROM indisponible', status: remoteRes.status }));
        }
        const cl = remoteRes.headers.get('content-length');
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          ...(cl ? { 'Content-Length': cl } : {}),
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
          'Cache-Control': 'public, max-age=31536000',
        });
        if (req.method === 'HEAD' || !remoteRes.body) return res.end();
        const reader = remoteRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
        return res.end();
      }

      const rawParam = url.searchParams.get('file') || url.searchParams.get('id') || '';
      const cleanName = path
        .basename(decodeURIComponent(rawParam))
        .replace(/\.(zip|bin|dat|rom)$/i, '')
        .replace(/^arc-(neo|mame)-/i, '')
        .toLowerCase();
      const resolvedName = romNameMap[cleanName] || cleanName;

      if (!resolvedName) {
        res.writeHead(400, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Paramètre file ou url manquant' }));
      }

      let filePath = path.resolve(romsDir, `${resolvedName}.zip`);
      if (!fs.existsSync(filePath)) {
        const altPath = path.resolve(romsDir, `${cleanName}.zip`);
        if (fs.existsSync(altPath)) filePath = altPath;
      }

      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Length': stat.size,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
          'Cache-Control': 'public, max-age=31536000',
        });
        if (req.method === 'HEAD') return res.end();
        return fs.createReadStream(filePath).pipe(res);
      }

      const candidateUrls = [
        `https://archive.org/download/neo-geo-mvs-romset/${encodeURIComponent(resolvedName)}.zip`,
        `https://archive.org/download/MAME_2003-Plus_Reference_Set_2018/roms/${encodeURIComponent(resolvedName)}.zip`,
        `https://archive.org/download/NeoGeoRomCollectionByGhostware/${encodeURIComponent(resolvedName)}.zip`,
      ];

      for (const remoteUrl of candidateUrls) {
        try {
          const remoteRes = await fetchWithHeaderTimeout(
            remoteUrl,
            {
              method: req.method === 'HEAD' ? 'HEAD' : 'GET',
              redirect: 'follow',
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CSW-Arcade' },
            },
            7000
          );
          const ct = (remoteRes.headers.get('content-type') || '').toLowerCase();
          if (remoteRes.ok && !ct.includes('text/html')) {
            const cl = remoteRes.headers.get('content-length');
            res.writeHead(200, {
              'Content-Type': 'application/zip',
              ...(cl ? { 'Content-Length': cl } : {}),
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
              'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
              'Cache-Control': 'public, max-age=31536000',
            });
            if (req.method === 'HEAD' || !remoteRes.body) return res.end();
            const reader = remoteRes.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(Buffer.from(value));
            }
            return res.end();
          }
        } catch {
          /* try next candidate */
        }
      }

      res.writeHead(404, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `ROM introuvable: ${resolvedName}.zip` }));
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
  });

  // Cache disque local pour les cores EmulatorJS (/emulatorjs/cores/*) :
  // sert d'abord public/emulatorjs/cores/, puis .csw-data/emu-cores-cache/, sinon télécharge une fois depuis CDN.
  const emuCorePublicDir = path.resolve(process.cwd(), 'public/emulatorjs/cores');
  const emuCoreCacheDir = path.resolve(process.cwd(), '.csw-data/emu-cores-cache');
  const emuCoreInflight = new Map();

  const getMimeForCoreAsset = (filePath) => {
    const low = filePath.toLowerCase();
    if (low.endsWith('.json')) return 'application/json; charset=utf-8';
    if (low.endsWith('.wasm')) return 'application/wasm';
    if (low.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (low.endsWith('.css')) return 'text/css; charset=utf-8';
    return 'application/octet-stream';
  };

  server.middlewares.use('/emulatorjs/cores', async (req, res, next) => {
    try {
      const reqUrl = new URL(req.url, 'http://localhost:3003');
      const rawRel = decodeURIComponent(reqUrl.pathname || '').replace(/^\/+/, '');
      if (!rawRel || rawRel.includes('..') || rawRel.includes('\\')) {
        return typeof next === 'function' ? next() : (res.writeHead(404), res.end());
      }

      const publicCandidate = path.resolve(emuCorePublicDir, rawRel);
      if (publicCandidate.startsWith(emuCorePublicDir) && fs.existsSync(publicCandidate) && fs.statSync(publicCandidate).isFile()) {
        const stat = fs.statSync(publicCandidate);
        res.writeHead(200, {
          'Content-Type': getMimeForCoreAsset(publicCandidate),
          'Content-Length': stat.size,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=31536000',
          'X-CSW-Cache': 'public-hit',
        });
        return fs.createReadStream(publicCandidate).pipe(res);
      }

      const cacheCandidate = path.resolve(emuCoreCacheDir, rawRel);
      if (cacheCandidate.startsWith(emuCoreCacheDir) && fs.existsSync(cacheCandidate) && fs.statSync(cacheCandidate).isFile()) {
        const stat = fs.statSync(cacheCandidate);
        res.writeHead(200, {
          'Content-Type': getMimeForCoreAsset(cacheCandidate),
          'Content-Length': stat.size,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=31536000',
          'X-CSW-Cache': 'disk-hit',
        });
        return fs.createReadStream(cacheCandidate).pipe(res);
      }

      let downloadPromise = emuCoreInflight.get(rawRel);
      if (!downloadPromise) {
        downloadPromise = (async () => {
          const cdnUrl = `https://cdn.emulatorjs.org/stable/data/cores/${rawRel}`;
          const remoteRes = await fetchWithHeaderTimeout(
            cdnUrl,
            { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 CSW-Arcade' } },
            10000
          );
          if (!remoteRes.ok) {
            throw new Error(`CDN HTTP ${remoteRes.status}`);
          }
          const ab = await remoteRes.arrayBuffer();
          const buf = Buffer.from(ab);
          if (buf.byteLength > 0 && cacheCandidate.startsWith(emuCoreCacheDir)) {
            fs.mkdirSync(path.dirname(cacheCandidate), { recursive: true });
            const tmp = `${cacheCandidate}.tmp_${Date.now()}`;
            fs.writeFileSync(tmp, buf);
            fs.renameSync(tmp, cacheCandidate);
          }
          return buf;
        })().finally(() => {
          emuCoreInflight.delete(rawRel);
        });
        emuCoreInflight.set(rawRel, downloadPromise);
      }

      const buf = await downloadPromise;
      res.writeHead(200, {
        'Content-Type': getMimeForCoreAsset(rawRel),
        'Content-Length': buf.byteLength,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=31536000',
        'X-CSW-Cache': 'cdn-cached',
      });
      return res.end(buf);
    } catch {
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
      return res.end('Core asset unavailable');
    }
  });

  // Relais temps réel local / LAN pour les salons Fightcade 2 (chat & présence) — garantit le fonctionnement même sans règles Firestore publiées
  const fcLobbies = new Map(); // gameId -> { messages: [], users: Map<uid, userObj> }
  const allGlobalUsers = new Map(); // uid -> userObj (présence unifiée partagée sur tous les salons)
  const fcChallenges = new Map(); // challengeId -> challengeObj

  // Répertoire joueurs & système d'amitié (persistance locale .csw-data/social-store.json + temps réel WS)
  const socialDir = path.resolve(process.cwd(), '.csw-data');
  const socialStorePath = path.join(socialDir, 'social-store.json');
  const userDirectory = new Map(); // uid -> public user profile
  const friendships = new Map(); // uid -> Set<friendUid>
  const friendRequests = new Map(); // reqId -> { id, fromUid, toUid, fromUser, toUser, createdAtMs }
  let socialSaveTimer = null;

  const computeFriendCode = (uid) => {
    const clean = String(uid || '0000').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    return (clean.slice(-4) || '0000').padStart(4, '0');
  };

  const toPublicUserSummary = (raw = {}) => {
    const uid = String(raw.uid || '').trim();
    if (!uid) return null;
    const displayName = String(raw.displayName || raw.name || `Joueur_${computeFriendCode(uid)}`).trim();
    const baseName = displayName.replace(/#[a-zA-Z0-9]+$/, '') || 'Joueur';
    const friendCode = String(raw.friendCode || computeFriendCode(uid)).toUpperCase();
    const friendTag = String(raw.friendTag || `${baseName}#${friendCode}`);
    return {
      uid,
      name: displayName,
      displayName,
      friendCode,
      friendTag,
      firstName: String(raw.firstName || ''),
      lastName: String(raw.lastName || ''),
      email: raw.email ? String(raw.email) : null,
      region: String(raw.region || 'FR').toUpperCase().slice(0, 2),
      rank: String(raw.rank || 'D'),
      ratingPoints: Number(raw.ratingPoints || 0),
      photoURL: raw.photoURL !== undefined ? raw.photoURL : null,
      isAuthenticated: Boolean(raw.isAuthenticated),
      updatedAtMs: Number(raw.updatedAtMs || Date.now()),
    };
  };

  const loadSocialStore = () => {
    try {
      if (!fs.existsSync(socialStorePath)) return;
      const parsed = JSON.parse(fs.readFileSync(socialStorePath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        if (parsed.users && typeof parsed.users === 'object') {
          for (const u of Object.values(parsed.users)) {
            const summary = toPublicUserSummary(u);
            if (summary) userDirectory.set(summary.uid, summary);
          }
        }
        if (parsed.friendships && typeof parsed.friendships === 'object') {
          for (const [uid, arr] of Object.entries(parsed.friendships)) {
            if (Array.isArray(arr)) {
              friendships.set(uid, new Set(arr.filter(Boolean)));
            }
          }
        }
        if (Array.isArray(parsed.friendRequests)) {
          for (const req of parsed.friendRequests) {
            if (req?.id && req?.fromUid && req?.toUid) {
              friendRequests.set(req.id, req);
            }
          }
        }
      }
    } catch {
      /* ignore corrupt store */
    }
  };

  const persistSocialStoreNow = () => {
    try {
      if (!fs.existsSync(socialDir)) fs.mkdirSync(socialDir, { recursive: true });
      const usersObj = {};
      for (const [uid, u] of userDirectory.entries()) {
        // Ne pas dupliquer les photos base64 uploadées sur le disque (elles sont stockées sur Firestore)
        usersObj[uid] = {
          ...u,
          photoURL: u.photoURL && !String(u.photoURL).startsWith('data:') ? u.photoURL : null,
        };
      }
      const friendsObj = {};
      for (const [uid, set] of friendships.entries()) {
        if (set.size > 0) friendsObj[uid] = Array.from(set);
      }
      fs.writeFileSync(
        socialStorePath,
        JSON.stringify(
          {
            users: usersObj,
            friendships: friendsObj,
            friendRequests: Array.from(friendRequests.values()),
          },
          null,
          2
        ),
        'utf8'
      );
    } catch {
      /* noop */
    }
  };

  const scheduleSaveSocialStore = () => {
    if (socialSaveTimer) clearTimeout(socialSaveTimer);
    socialSaveTimer = setTimeout(persistSocialStoreNow, 400);
  };

  const upsertDirectoryUser = (rawUser) => {
    if (!rawUser?.uid) return null;
    const prev = userDirectory.get(rawUser.uid);
    const merged = toPublicUserSummary({
      ...prev,
      ...rawUser,
      photoURL: rawUser.photoURL !== undefined ? rawUser.photoURL : (prev?.photoURL ?? null),
      email: rawUser.email !== undefined ? rawUser.email : (prev?.email ?? null),
      firstName: rawUser.firstName !== undefined ? rawUser.firstName : (prev?.firstName ?? ''),
      lastName: rawUser.lastName !== undefined ? rawUser.lastName : (prev?.lastName ?? ''),
      updatedAtMs: Date.now(),
    });
    if (merged) {
      userDirectory.set(merged.uid, merged);
      scheduleSaveSocialStore();
    }
    return merged;
  };

  const enrichSocialUser = (uid, fallbackRaw = null) => {
    const dir = userDirectory.get(uid);
    const liveRaw = allGlobalUsers.get(uid);
    const now = Date.now();
    const isLive = Boolean(liveRaw && now - (liveRaw.lastSeen || 0) < 65000);
    const base = toPublicUserSummary({ ...(fallbackRaw || {}), ...(dir || {}), ...(isLive ? liveRaw : {}), uid });
    return {
      ...base,
      isOnline: isLive,
      status: isLive ? liveRaw.status || 'available' : 'offline',
      currentGame: isLive ? liveRaw.currentGame || null : null,
      activeGames: isLive && Array.isArray(liveRaw.activeGames) ? liveRaw.activeGames : [],
      matchMeta: isLive ? liveRaw.matchMeta || null : null,
      ping: isLive ? liveRaw.ping || 22 : null,
      lastSeen: isLive ? liveRaw.lastSeen : dir?.updatedAtMs || 0,
    };
  };

  const getFriendSet = (uid) => {
    if (!friendships.has(uid)) friendships.set(uid, new Set());
    return friendships.get(uid);
  };

  const linkFriends = (uidA, uidB) => {
    if (!uidA || !uidB || uidA === uidB) return;
    getFriendSet(uidA).add(uidB);
    getFriendSet(uidB).add(uidA);
    friendRequests.delete(`${uidA}__${uidB}`);
    friendRequests.delete(`${uidB}__${uidA}`);
    scheduleSaveSocialStore();
  };

  const pushFriendWsEvent = (targetUid, eventPayload) => {
    const sockets = connectedUsers.get(targetUid);
    if (!sockets) return;
    const msg = JSON.stringify({ type: 'FRIEND_EVENT', ...eventPayload });
    for (const s of sockets) {
      if (s.readyState === WebSocket.OPEN) {
        try { s.send(msg); } catch {}
      }
    }
  };

  loadSocialStore();

  // Nettoyage automatique des défis expirés (conserver 10 min si accepté pour gros téléchargements CHD/PS1)
  setInterval(() => {
    const now = Date.now();
    for (const [id, ch] of fcChallenges.entries()) {
      const ttl = ch.status === 'accepted'
        ? (ch.updatedAtMs || ch.createdAt || now) + 10 * 60 * 1000
        : (ch.expiresAt || 0) + 60000;
      if (now > ttl) {
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
            if (challenge.gameEntry && !supportsOnlineMultiplayer(challenge.gameEntry)) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ ok: false, error: 'SOLO_ONLY_GAME' }));
            }
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
            // Statut monotone : un défi déjà accepté ne peut plus devenir "declined" (réponse tardive/obsolète)
            if (!(target.status === 'accepted' && status === 'declined')) {
              target.status = status;
            }
            target.updatedAtMs = Date.now();
          } else if (action === 'postOffer') {
            target.offer = offer;
            target.updatedAtMs = Date.now();
          } else if (action === 'postAnswer') {
            target.answer = answer;
            target.updatedAtMs = Date.now();
          } else if (action === 'renegotiateOffer') {
            target.renegotiateOffer = offer;
            target.updatedAtMs = Date.now();
          } else if (action === 'renegotiateAnswer') {
            target.renegotiateAnswer = answer;
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
      const usersMap = new Map();

      // 1. Utilisateurs du salon courant
      for (const [uid, u] of lobby.users.entries()) {
        if (now - (u.lastSeen || 0) < 65000) {
          usersMap.set(uid, u);
        } else {
          lobby.users.delete(uid);
        }
      }

      // 2. Présence globale unifiée : toujours inclure tous les joueurs connectés sur le site
      for (const [uid, u] of allGlobalUsers.entries()) {
        if (now - (u.lastSeen || 0) < 65000) {
          if (!usersMap.has(uid)) {
            usersMap.set(uid, u);
          }
        } else {
          allGlobalUsers.delete(uid);
        }
      }

      const users = Array.from(usersMap.values());
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
              channelId: targetId,
              createdAtMs: payload.message.createdAtMs || Date.now(),
            };
            if (!lobby.messages.some((m) => m.id === msg.id)) {
              lobby.messages.push(msg);
              if (lobby.messages.length > 120) lobby.messages = lobby.messages.slice(-80);
            }

            // Si le message est écrit dans un salon de jeu spécifique, l'annoncer également dans le lobby global
            if (targetId !== 'global-lobby') {
              const globalLobby = getFcLobby('global-lobby');
              const relayedMsg = {
                ...msg,
                text: `[#${targetId.replace(/^arc-neo-/, '')}] ${msg.text}`,
              };
              if (!globalLobby.messages.some((m) => m.id === msg.id)) {
                globalLobby.messages.push(relayedMsg);
                if (globalLobby.messages.length > 120) globalLobby.messages = globalLobby.messages.slice(-80);
              }
            }
          } else if (payload.action === 'presence' && payload.user?.uid) {
            console.log(`[LOBBY PRESENCE] ${payload.user.name} (${payload.user.uid}) in ${targetId}`);
            const u = {
              ...payload.user,
              currentLobby: targetId,
              lastSeen: Date.now(),
            };
            lobby.users.set(payload.user.uid, u);
            allGlobalUsers.set(payload.user.uid, u);
            upsertDirectoryUser(u);
          } else if (payload.action === 'leave' && payload.uid) {
            console.log(`[LOBBY LEAVE] ${payload.uid} from ${targetId}`);
            lobby.users.delete(payload.uid);
            allGlobalUsers.delete(payload.uid);
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

  // API Système d'Amitié (style Fortnite) + Répertoire Joueurs
  server.middlewares.use('/api/friends', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    const url = new URL(req.url, 'http://localhost:3003');
    const uid = url.searchParams.get('uid') || '';
    const action = url.searchParams.get('action') || 'state';

    if (req.method === 'GET') {
      if (!uid) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'Missing uid' }));
      }

      if (action === 'search') {
        const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
        const qBare = q.replace(/^#/, '');
        const myFriends = friendships.get(uid) || new Set();
        const combinedUids = new Set([...userDirectory.keys(), ...allGlobalUsers.keys()]);
        const results = [];

        for (const candidateUid of combinedUids) {
          if (!candidateUid || candidateUid === uid) continue;
          const user = enrichSocialUser(candidateUid);
          if (!user) continue;
          if (q) {
            const haystack = [
              user.displayName,
              user.friendTag,
              user.friendCode,
              user.firstName,
              user.lastName,
              user.email,
              user.uid,
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            if (!haystack.includes(q) && (!qBare || !haystack.includes(qBare))) continue;
          }
          let relation = 'none';
          let requestId = null;
          if (myFriends.has(candidateUid)) {
            relation = 'friend';
          } else if (friendRequests.has(`${candidateUid}__${uid}`)) {
            relation = 'incoming';
            requestId = `${candidateUid}__${uid}`;
          } else if (friendRequests.has(`${uid}__${candidateUid}`)) {
            relation = 'outgoing';
            requestId = `${uid}__${candidateUid}`;
          }
          results.push({ ...user, relation, requestId });
        }

        results.sort((a, b) => {
          if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
          return (b.lastSeen || 0) - (a.lastSeen || 0);
        });

        res.statusCode = 200;
        return res.end(JSON.stringify({ ok: true, results: results.slice(0, 30) }));
      }

      const myFriends = friendships.get(uid) || new Set();
      const friends = Array.from(myFriends)
        .map((fid) => enrichSocialUser(fid))
        .filter(Boolean)
        .sort((a, b) => {
          if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
          const rankOrder = { playing: 0, in_game_available: 1, available: 2, afk: 3, offline: 4 };
          const d = (rankOrder[a.status] ?? 4) - (rankOrder[b.status] ?? 4);
          if (d !== 0) return d;
          return String(a.displayName || '').localeCompare(String(b.displayName || ''));
        });

      const incomingRequests = [];
      const outgoingRequests = [];
      for (const reqObj of friendRequests.values()) {
        if (reqObj.toUid === uid) {
          incomingRequests.push({
            ...reqObj,
            fromUser: enrichSocialUser(reqObj.fromUid, reqObj.fromUser),
          });
        } else if (reqObj.fromUid === uid) {
          outgoingRequests.push({
            ...reqObj,
            toUser: enrichSocialUser(reqObj.toUid, reqObj.toUser),
          });
        }
      }
      incomingRequests.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
      outgoingRequests.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, friends, incomingRequests, outgoingRequests }));
    }

    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const act = payload.action;

          if (act === 'register_profile' && payload.user?.uid) {
            const saved = upsertDirectoryUser(payload.user);
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true, user: saved }));
          }

          if (act === 'send_request') {
            const { fromUid, toUid, fromUser, toUser } = payload;
            if (!fromUid || !toUid || fromUid === toUid) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ ok: false, error: 'Destinataire invalide' }));
            }
            if (fromUser?.uid) upsertDirectoryUser(fromUser);
            if (toUser?.uid) upsertDirectoryUser(toUser);

            if (getFriendSet(fromUid).has(toUid)) {
              res.statusCode = 200;
              return res.end(JSON.stringify({ ok: true, alreadyFriends: true }));
            }

            // Si l'autre joueur a déjà envoyé une demande, accepter automatiquement (comme Fortnite)
            const reverseId = `${toUid}__${fromUid}`;
            if (friendRequests.has(reverseId)) {
              linkFriends(fromUid, toUid);
              pushFriendWsEvent(toUid, { event: 'accepted', byUid: fromUid });
              pushFriendWsEvent(fromUid, { event: 'accepted', byUid: toUid });
              res.statusCode = 200;
              return res.end(JSON.stringify({ ok: true, autoAccepted: true }));
            }

            const reqId = `${fromUid}__${toUid}`;
            const reqObj = {
              id: reqId,
              fromUid,
              toUid,
              fromUser: enrichSocialUser(fromUid, fromUser),
              toUser: enrichSocialUser(toUid, toUser),
              createdAtMs: Date.now(),
            };
            friendRequests.set(reqId, reqObj);
            scheduleSaveSocialStore();
            pushFriendWsEvent(toUid, { event: 'request_received', request: reqObj });
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true, request: reqObj }));
          }

          if (act === 'accept_request') {
            const targetUid = payload.uid;
            const reqId = payload.requestId || (payload.fromUid && targetUid ? `${payload.fromUid}__${targetUid}` : '');
            const reqObj = friendRequests.get(reqId);
            const fromUid = reqObj?.fromUid || payload.fromUid;
            const toUid = reqObj?.toUid || targetUid;
            if (!fromUid || !toUid) {
              res.statusCode = 404;
              return res.end(JSON.stringify({ ok: false, error: 'Demande introuvable' }));
            }
            linkFriends(fromUid, toUid);
            pushFriendWsEvent(fromUid, { event: 'accepted', byUid: toUid });
            pushFriendWsEvent(toUid, { event: 'accepted', byUid: fromUid });
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true }));
          }

          if (act === 'decline_request' || act === 'cancel_request') {
            const reqId = payload.requestId || `${payload.fromUid}__${payload.toUid}`;
            const reqObj = friendRequests.get(reqId);
            friendRequests.delete(reqId);
            scheduleSaveSocialStore();
            if (reqObj) {
              pushFriendWsEvent(reqObj.fromUid, { event: 'updated' });
              pushFriendWsEvent(reqObj.toUid, { event: 'updated' });
            }
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true }));
          }

          if (act === 'remove_friend') {
            const { uid: u1, friendUid: u2 } = payload;
            if (u1 && u2) {
              getFriendSet(u1).delete(u2);
              getFriendSet(u2).delete(u1);
              scheduleSaveSocialStore();
              pushFriendWsEvent(u2, { event: 'removed', byUid: u1 });
            }
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true }));
          }

          res.statusCode = 400;
          return res.end(JSON.stringify({ ok: false, error: 'Action invalide' }));
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
              const incomingVer = Number(st.statsFormulaVersion || 1);
              const prevVer = Number(prev?.statsFormulaVersion || 1);
              if (incomingVer > prevVer) {
                rec.gameStats.set(st.gameId, st);
              } else if (
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

  // Moteur Local Firebase (Firestore local persistant + diffusion temps réel WebSocket)
  const localFirebase = new LocalFirebaseStore();
  localFirebase.onMutation((event) => {
    try {
      if (event?.type === 'set' && event.parentPath === 'users' && event.data && event.id) {
        upsertDirectoryUser({ ...event.data, uid: event.id });
      }
      const raw = JSON.stringify({
        type: 'LOCAL_FS_EVENT',
        changeType: event.changeType,
        opType: event.type,
        path: event.path,
        parentPath: event.parentPath,
        id: event.id,
        data: event.data,
      });
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(raw);
          } catch {}
        }
      }
    } catch {
      /* ignore broadcast errors */
    }
  });

  server.middlewares.use('/api/local-firebase', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    if (req.method === 'GET') {
      try {
        const reqUrl = new URL(req.url, 'http://localhost:3003');
        const op = reqUrl.searchParams.get('op') || 'health';
        const targetPath = reqUrl.searchParams.get('path') || '';
        if (op === 'health') {
          res.statusCode = 200;
          return res.end(JSON.stringify({ ok: true, localFirebase: true, docsCount: localFirebase.docs.size }));
        }
        if (op === 'getDoc') {
          res.statusCode = 200;
          return res.end(JSON.stringify({ ok: true, ...localFirebase.getDoc(targetPath) }));
        }
        if (op === 'getDocs') {
          const docs = localFirebase.getCollectionDocs(targetPath);
          res.statusCode = 200;
          return res.end(JSON.stringify({ ok: true, docs }));
        }
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'Opération GET inconnue' }));
      } catch (err) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: err?.message || 'Erreur GET' }));
      }
    }

    if (req.method === 'POST') {
      const chunks = [];
      let totalBytes = 0;
      const MAX_BODY = 8 * 1024 * 1024;
      let aborted = false;
      req.on('data', (chunk) => {
        if (aborted) return;
        totalBytes += chunk.length;
        if (totalBytes > MAX_BODY) {
          aborted = true;
          res.statusCode = 413;
          res.end(JSON.stringify({ ok: false, error: 'Payload trop volumineux (>8 Mo)' }));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (aborted) return;
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          const body = raw ? JSON.parse(raw) : {};
          const op = body.op;
          if (op === 'health') {
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true, localFirebase: true, docsCount: localFirebase.docs.size }));
          }
          if (op === 'getDoc') {
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true, ...localFirebase.getDoc(body.path) }));
          }
          if (op === 'getDocs') {
            const docs = localFirebase.queryCollection(body.path, body.constraints);
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true, docs }));
          }
          if (op === 'setDoc') {
            const ev = localFirebase.setDoc(body.path, body.data, { merge: Boolean(body.merge) });
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true, ...ev }));
          }
          if (op === 'updateDoc') {
            const ev = localFirebase.updateDoc(body.path, body.patch || body.data);
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true, ...ev }));
          }
          if (op === 'addDoc') {
            const ev = localFirebase.addDoc(body.path, body.data);
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true, ...ev }));
          }
          if (op === 'deleteDoc') {
            const ev = localFirebase.deleteDoc(body.path);
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true, ...ev }));
          }
          if (op === 'batchGetDocs') {
            const paths = Array.isArray(body.paths) ? body.paths : [];
            const results = paths.map((p) => localFirebase.getDoc(p));
            res.statusCode = 200;
            return res.end(JSON.stringify({ ok: true, results }));
          }
          res.statusCode = 400;
          return res.end(JSON.stringify({ ok: false, error: `Opération inconnue: ${op}` }));
        } catch (err) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ ok: false, error: err?.message || 'Requête invalide' }));
        }
      });
      return;
    }

    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false }));
  });

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
    try {
      localFirebase.setDoc(`wallets/${uid}`, { coins: next, updatedAt: Date.now() }, { merge: true });
    } catch {}
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
    if (Array.isArray(cachedSasPayNetworks) && cachedSasPayNetworks.length > 0 && now - cachedSasPayNetworksAt < 10 * 60 * 1000) {
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
      const activeList = all.filter((n) => n?.is_active !== false);
      if (activeList.length > 0) {
        cachedSasPayNetworks = activeList;
        cachedSasPayNetworksAt = now;
        return res.end(JSON.stringify({ ok: true, data: cachedSasPayNetworks }));
      }
    } catch {
      /* fallback below */
    }
    try {
      const fbPath = path.resolve(process.cwd(), 'src/data/saspayNetworks.json');
      if (fs.existsSync(fbPath)) {
        const fbData = JSON.parse(fs.readFileSync(fbPath, 'utf8'));
        return res.end(JSON.stringify({ ok: true, data: fbData }));
      }
    } catch {}
    return res.end(JSON.stringify({ ok: true, data: [] }));
  });

  server.middlewares.use('/api/saspay/sync-env', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'POST') {
      res.statusCode = 405;
      return res.end(JSON.stringify({ ok: false }));
    }
    const secret = req.headers['x-deploy-secret'];
    if (secret !== 'csw_arcade_deploy_secure_key_2026') {
      res.statusCode = 403;
      return res.end(JSON.stringify({ ok: false, error: 'Forbidden' }));
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (typeof body.envContent === 'string' && body.envContent.includes('SASPAY_')) {
          const targetPath = fs.existsSync('/opt/csw-arcade')
            ? '/opt/csw-arcade/.env'
            : path.resolve(process.cwd(), '.env');
          fs.writeFileSync(targetPath, body.envContent, { encoding: 'utf8', mode: 0o600 });
          return res.end(JSON.stringify({ ok: true, path: targetPath }));
        }
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'Contenu .env invalide' }));
      } catch (e) {
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error: e?.message }));
      }
    });
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
        const countryIso = body.country ? String(body.country).trim().toUpperCase() : '';
        const custPhone = body.phone ? normalizeSasPayPhone(body.phone, countryIso) : undefined;

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

        if (method === 'softpay' && custPhone && body.network) {
          targetUrl = `${baseUrl}/payments/softpay/`;
          saspayPayload = {
            amount: pack.amount,
            currency: pack.currency,
            phone: custPhone,
            phone_number: custPhone,
            network: String(body.network).trim().toLowerCase(),
            country: countryIso || undefined,
            description: `${pack.label} (${uid})`,
            metadata: { uid, packId: pack.id, coins: pack.coins },
            customer: {
              first_name: custFirstName,
              last_name: custLastName,
              email: custEmail,
              phone: custPhone,
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
    let wasLastUserSocket = false;
    if (ws.uid && connectedUsers.has(ws.uid)) {
      const set = connectedUsers.get(ws.uid);
      set.delete(ws);
      if (set.size === 0) {
        connectedUsers.delete(ws.uid);
        wasLastUserSocket = true;
      }
    }

    // Retirer proprement le spectateur s'il ferme son onglet (sans perturber le match des 2 joueurs)
    if (ws.spectatingMatchKey && wasLastUserSocket) {
      removeSpectatorFromMatch(ws);
    } else {
      ws.spectatingMatchKey = null;
    }

    // Si ce joueur ferme brutalement son onglet/app en plein match Netplay, arrêter net la partie chez son adversaire et les spectateurs
    const partnerUid = ws.activeMatchPartnerUid;
    if (partnerUid && wasLastUserSocket) {
      const disconnectedUid = ws.uid;
      const disconnectedName = ws.userName || 'Adversaire';
      setTimeout(() => {
        // Ne notifier que si l'utilisateur ne s'est pas reconnecté entre-temps (< 1.2s)
        if (disconnectedUid && !connectedUsers.has(disconnectedUid)) {
          endSpectateMatch(disconnectedUid, 'disconnect', disconnectedName);
          const partnerSockets = connectedUsers.get(partnerUid);
          if (partnerSockets) {
            const leavePayload = JSON.stringify({
              type: 'REMOTE_BTN_RELAY',
              syncType: 'NETPLAY_EVENT',
              eventData: {
                event: 'MATCH_LEAVE',
                senderName: disconnectedName,
                reason: 'disconnect',
                eventId: `srv_disc_${Date.now()}_${disconnectedUid}`,
              },
            });
            for (const s of partnerSockets) {
              s.activeMatchPartnerUid = null;
              if (s.readyState === WebSocket.OPEN) {
                try { s.send(leavePayload); } catch {}
              }
            }
          }
        }
      }, 1200);
    }
    ws.activeMatchPartnerUid = null;

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
            const { uid, name, region } = data;
            if (uid) {
              if (ws.uid && ws.uid !== uid && connectedUsers.has(ws.uid)) {
                const oldSet = connectedUsers.get(ws.uid);
                oldSet.delete(ws);
                if (oldSet.size === 0) connectedUsers.delete(ws.uid);
              }
              ws.uid = uid;
              ws.userName = name;
              if (!connectedUsers.has(uid)) connectedUsers.set(uid, new Set());
              connectedUsers.get(uid).add(ws);
              upsertDirectoryUser({ uid, name, displayName: name, region });
              ws.send(JSON.stringify({ type: 'IDENTIFIED', uid, ok: true }));
            }
            break;
          }

          case 'CHALLENGE_INVITE': {
            const { challenge } = data;
            if (challenge && challenge.challengeId) {
              if (challenge.gameEntry && !supportsOnlineMultiplayer(challenge.gameEntry)) {
                break;
              }
              const existing = fcChallenges.get(challenge.challengeId);
              fcChallenges.set(challenge.challengeId, {
                callerCandidates: [],
                calleeCandidates: [],
                ...existing,
                ...challenge,
                status: existing?.status && existing.status !== 'pending' ? existing.status : challenge.status,
                updatedAtMs: Date.now(),
              });
              const targetUid = challenge.toUid;
              const sockets = connectedUsers.get(targetUid);
              if (sockets) {
                const msg = JSON.stringify({ type: 'INCOMING_CHALLENGE', challenge });
                for (const s of sockets) {
                  if (s !== ws && s.readyState === WebSocket.OPEN) s.send(msg);
                }
              }
            }
            break;
          }

          case 'CHALLENGE_REPLY': {
            const { challengeId, status, toUid } = data;
            const ch = fcChallenges.get(challengeId);
            if (ch && !(ch.status === 'accepted' && status === 'declined')) {
              ch.status = status;
              ch.updatedAtMs = Date.now();
            }
            const sockets = connectedUsers.get(toUid);
            if (sockets) {
              const msg = JSON.stringify({ type: 'CHALLENGE_STATUS_CHANGED', challengeId, status, challenge: ch });
              for (const s of sockets) {
                if (s !== ws && s.readyState === WebSocket.OPEN) s.send(msg);
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
                if (s !== ws && s.readyState === WebSocket.OPEN) s.send(msg);
              }
            }
            break;
          }

          case 'MATCH_COUNTDOWN_START': {
            const { challengeId, targetUid } = data;
            if (targetUid) ws.activeMatchPartnerUid = targetUid;
            const sockets = connectedUsers.get(targetUid);
            if (sockets) {
              const msg = JSON.stringify({ type: 'MATCH_COUNTDOWN_START', challengeId });
              for (const s of sockets) {
                if (s !== ws && s.readyState === WebSocket.OPEN) s.send(msg);
              }
            }
            break;
          }

          case 'MATCH_CANCEL': {
            const { challengeId, targetUid } = data;
            ws.activeMatchPartnerUid = null;
            if (challengeId && fcChallenges.has(challengeId)) {
              const ch = fcChallenges.get(challengeId);
              ch.status = 'cancelled';
              ch.updatedAtMs = Date.now();
            }
            const sockets = connectedUsers.get(targetUid);
            if (sockets) {
              const msg = JSON.stringify({ type: 'MATCH_CANCELLED', challengeId });
              for (const s of sockets) {
                if (s !== ws && s.readyState === WebSocket.OPEN) s.send(msg);
              }
            }
            break;
          }

          case 'RTC_SIGNAL': {
            const { challengeId, targetUid, signalType, payload } = data;
            if (targetUid) ws.activeMatchPartnerUid = targetUid;
            const sockets = connectedUsers.get(targetUid);
            if (sockets && signalType) {
              const msg = JSON.stringify({
                type: 'RTC_SIGNAL',
                challengeId,
                fromUid: ws.uid || null,
                signalType,
                payload,
              });
              for (const s of sockets) {
                if (s !== ws && s.readyState === WebSocket.OPEN) s.send(msg);
              }
            }
            break;
          }

          case 'RELAY_INPUT': {
            const {
              targetUid,
              buttonIdx,
              pressed,
              frame,
              packetHex,
              syncType,
              transferId,
              chunkIndex,
              chunkTotal,
              stateBase64,
              syncFrame,
              eventData,
              t,
            } = data;
            if (syncType === 'NETPLAY_EVENT' && eventData?.event === 'MATCH_LEAVE') {
              ws.activeMatchPartnerUid = null;
              endSpectateMatch(ws.uid, eventData.reason || 'quit', eventData.senderName || ws.userName || 'Un joueur');
            } else if (targetUid) {
              ws.activeMatchPartnerUid = targetUid;
            }
            const sockets = connectedUsers.get(targetUid);
            if (sockets) {
              const msg = JSON.stringify({
                type: 'REMOTE_BTN_RELAY',
                buttonIdx,
                pressed,
                frame,
                packetHex,
                syncType,
                transferId,
                chunkIndex,
                chunkTotal,
                stateBase64,
                syncFrame,
                eventData,
                t,
              });
              for (const s of sockets) {
                if (syncType === 'NETPLAY_EVENT' && eventData?.event === 'MATCH_LEAVE') {
                  s.activeMatchPartnerUid = null;
                }
                if (s !== ws && s.readyState === WebSocket.OPEN) s.send(msg);
              }
            }
            break;
          }

          case 'SPECTATE_HOST_REGISTER': {
            const { challengeId, hostUid, guestUid } = data;
            const resolvedHost = hostUid || (data.isHost ? ws.uid : null);
            const resolvedGuest = guestUid || (!data.isHost ? ws.uid : null);
            if (!resolvedHost) break;
            const matchKey = challengeId || `host:${resolvedHost}`;
            for (const [k, existing] of spectateMatches.entries()) {
              if (k !== matchKey && (existing.hostUid === resolvedHost || existing.guestUid === resolvedHost)) {
                endSpectateMatch(k, 'replaced', 'Hôte');
              }
            }
            let match = spectateMatches.get(matchKey);
            if (!match) {
              match = {
                matchKey,
                challengeId: challengeId || null,
                hostUid: resolvedHost,
                guestUid: resolvedGuest || null,
                spectators: new Map(),
              };
              spectateMatches.set(matchKey, match);
            } else {
              match.hostUid = resolvedHost;
              if (resolvedGuest) match.guestUid = resolvedGuest;
            }
            broadcastSpectateCount(match);
            break;
          }

          case 'SPECTATE_JOIN': {
            const { challengeId, hostUid, targetUid, spectatorName } = data;
            let match = findSpectateMatch({ challengeId, hostUid, targetUid });
            if (!match) {
              const ch = challengeId ? fcChallenges.get(challengeId) : null;
              const effectiveHost = hostUid || ch?.fromUid || targetUid;
              const effectiveGuest = ch?.toUid && ch.toUid !== effectiveHost ? ch.toUid : (targetUid && targetUid !== effectiveHost ? targetUid : null);
              if (effectiveHost && connectedUsers.has(effectiveHost)) {
                const matchKey = challengeId || `host:${effectiveHost}`;
                match = {
                  matchKey,
                  challengeId: challengeId || null,
                  hostUid: effectiveHost,
                  guestUid: effectiveGuest,
                  spectators: new Map(),
                };
                spectateMatches.set(matchKey, match);
              }
            }
            if (!match || !match.hostUid || !connectedUsers.has(match.hostUid)) {
              ws.send(JSON.stringify({
                type: 'SPECTATE_UNAVAILABLE',
                challengeId: challengeId || null,
                reason: 'Match introuvable ou hôte déconnecté.',
              }));
              break;
            }
            if (ws.spectatingMatchKey && ws.spectatingMatchKey !== match.matchKey) {
              removeSpectatorFromMatch(ws, ws.spectatingMatchKey);
            }
            const cleanName = spectatorName || ws.userName || 'Spectateur';
            if (ws.uid) {
              match.spectators.set(ws.uid, { uid: ws.uid, name: cleanName });
              ws.spectatingMatchKey = match.matchKey;
            }
            broadcastSpectateCount(match);
            sendToUid(match.hostUid, {
              type: 'SPECTATE_SNAPSHOT_REQ',
              matchKey: match.matchKey,
              challengeId: match.challengeId,
              targetUid: ws.uid,
              spectatorName: cleanName,
            });
            break;
          }

          case 'SPECTATE_RESYNC_REQ': {
            const { challengeId, hostUid } = data;
            const match = findSpectateMatch({ challengeId, hostUid, targetUid: hostUid }) || (ws.spectatingMatchKey ? spectateMatches.get(ws.spectatingMatchKey) : null);
            if (match && match.hostUid && connectedUsers.has(match.hostUid)) {
              sendToUid(match.hostUid, {
                type: 'SPECTATE_SNAPSHOT_REQ',
                matchKey: match.matchKey,
                challengeId: match.challengeId,
                targetUid: ws.uid,
                spectatorName: ws.userName || 'Spectateur',
              });
            } else {
              ws.send(JSON.stringify({ type: 'SPECTATE_ENDED', reason: 'disconnect', senderName: 'Hôte' }));
            }
            break;
          }

          case 'SPECTATE_LEAVE': {
            const matchKey = data.matchKey || data.challengeId || ws.spectatingMatchKey;
            removeSpectatorFromMatch(ws, matchKey);
            break;
          }

          case 'SPECTATE_STATE_CHUNK': {
            const { matchKey, challengeId, targetUid, transferId, chunkIndex, chunkTotal, stateBase64, syncFrame } = data;
            const match = (matchKey && spectateMatches.get(matchKey)) || findSpectateMatch({ challengeId, ws });
            const payload = {
              type: 'SPECTATE_STATE_CHUNK',
              matchKey: match?.matchKey || matchKey || null,
              challengeId: match?.challengeId || challengeId || null,
              transferId,
              chunkIndex,
              chunkTotal,
              stateBase64,
              syncFrame,
            };
            if (targetUid) {
              sendToUid(targetUid, payload);
            } else if (match) {
              for (const specUid of match.spectators.keys()) {
                sendToUid(specUid, payload);
              }
            }
            break;
          }

          case 'SPECTATE_INPUT_BATCH': {
            const { matchKey, challengeId, frames } = data;
            if (!Array.isArray(frames) || frames.length === 0) break;
            const match = (matchKey && spectateMatches.get(matchKey)) || findSpectateMatch({ challengeId, ws });
            if (!match || match.spectators.size === 0) break;
            const payload = JSON.stringify({
              type: 'SPECTATE_INPUT_BATCH',
              matchKey: match.matchKey,
              challengeId: match.challengeId,
              frames,
            });
            for (const specUid of match.spectators.keys()) {
              sendToUid(specUid, payload);
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

          case 'LOCAL_FS_OP': {
            const { reqId, op, path: fsPath, data: docData, patch, merge, constraints } = data;
            let result = { ok: false };
            try {
              if (op === 'getDoc') result = { ok: true, ...localFirebase.getDoc(fsPath) };
              else if (op === 'getDocs') result = { ok: true, docs: localFirebase.queryCollection(fsPath, constraints) };
              else if (op === 'setDoc') result = { ok: true, ...localFirebase.setDoc(fsPath, docData, { merge: Boolean(merge) }) };
              else if (op === 'updateDoc') result = { ok: true, ...localFirebase.updateDoc(fsPath, patch || docData) };
              else if (op === 'addDoc') result = { ok: true, ...localFirebase.addDoc(fsPath, docData) };
              else if (op === 'deleteDoc') result = { ok: true, ...localFirebase.deleteDoc(fsPath) };
              else result = { ok: false, error: `Unknown op: ${op}` };
            } catch (opErr) {
              result = { ok: false, error: opErr?.message || 'LocalFS error' };
            }
            if (reqId && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'LOCAL_FS_RES', reqId, ...result }));
            }
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
