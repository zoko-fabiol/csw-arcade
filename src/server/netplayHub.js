import { WebSocketServer, WebSocket } from 'ws';

export function setupNetplayHub(server) {
  const rooms = new Map(); // roomCode -> Room
  const clientRooms = new Map(); // ws -> { roomCode, playerIndex, role }

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
