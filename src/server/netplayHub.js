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
      const activeRooms = [];
      for (const [code, r] of rooms.entries()) {
        activeRooms.push({
          code,
          gameId: r.gameId,
          gameTitle: r.gameTitle,
          maxPlayers: r.maxPlayers,
          currentPlayers: r.players.filter(p => p !== null).length,
          slots: r.players.map((p, idx) => ({
            slot: idx + 1,
            role: `p${idx + 1}`,
            isOccupied: p !== null,
            playerName: p ? p.name : null
          })),
          createdAt: r.createdAt
        });
      }
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

  // Attach WebSocket server to httpServer
  const wss = new WebSocketServer({ noServer: true });

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
            const room = rooms.get(roomCode?.toUpperCase());
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

            if (assignedSlot !== -1) {
              // Joueur actif assigné
              room.players[assignedSlot] = {
                ws,
                name: playerName || `Joueur ${assignedSlot + 1}`,
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
                gameTitle: room.gameTitle
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
                gameTitle: room.gameTitle
              }));
            }

            broadcastRoomUpdate(room);
            break;
          }

          case 'SEND_INPUT': {
            // Un joueur distant envoie une action (D-pad ou bouton) vers l'hôte
            const info = clientRooms.get(ws);
            if (!info || info.playerIndex <= 0) return;
            const room = rooms.get(info.roomCode);
            if (!room || !room.hostWs) return;

            const { buttonId, isPressed } = data;

            // Relayer immédiatement vers l'hôte
            if (room.hostWs.readyState === WebSocket.OPEN) {
              room.hostWs.send(JSON.stringify({
                type: 'REMOTE_INPUT',
                playerIndex: info.playerIndex,
                buttonId,
                isPressed: !!isPressed
              }));
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
