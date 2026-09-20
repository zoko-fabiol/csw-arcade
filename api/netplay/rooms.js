// API Vercel Serverless pour la gestion et la découverte des salons multijoueurs CSW-Arcade
// Fonctionne 100% sans quota externe, compatible Vercel et navigateurs

const roomsStore = new Map();

function purgeInactiveRooms() {
  const now = Date.now();
  for (const [code, room] of roomsStore.entries()) {
    const age = now - (room.createdAt || now);
    const lastActive = now - (room.updatedAt || room.createdAt || now);
    // Supprimer les salons inactifs depuis plus de 90 secondes ou créés il y a plus de 2 heures
    if (lastActive > 90 * 1000 || age > 2 * 60 * 60 * 1000 || room.gameState === 'closed') {
      roomsStore.delete(code);
    }
  }
}

export default async function handler(req, res) {
  // En-têtes CORS universels
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  purgeInactiveRooms();

  if (req.method === 'GET') {
    const roomsList = Array.from(roomsStore.values());
    // Le salon le plus récent en premier
    roomsList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return res.status(200).json({
      success: true,
      rooms: roomsList,
      timestamp: Date.now()
    });
  }

  if (req.method === 'POST') {
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch(e) {}
      }
      if (!body && req.readable) {
        const buffers = [];
        for await (const chunk of req) {
          buffers.push(chunk);
        }
        const raw = Buffer.concat(buffers).toString();
        try { body = JSON.parse(raw); } catch(e) {}
      }
      body = body || {};
      const action = body.action || 'create';

      if (action === 'create' || action === 'update') {
        const room = body.room;
        if (!room || !room.code) {
          return res.status(400).json({ success: false, error: 'Données de salon invalides' });
        }

        roomsStore.set(room.code, {
          ...room,
          createdAt: room.createdAt || Date.now(),
          updatedAt: Date.now()
        });

        return res.status(200).json({ success: true, roomCode: room.code });
      }

      if (action === 'heartbeat') {
        const roomCode = body.roomCode;
        if (roomCode && roomsStore.has(roomCode)) {
          const r = roomsStore.get(roomCode);
          r.updatedAt = Date.now();
          if (body.players) r.players = body.players;
          if (body.currentPlayers) r.currentPlayers = body.currentPlayers;
          roomsStore.set(roomCode, r);
          return res.status(200).json({ success: true, updated: true });
        }
        return res.status(200).json({ success: true, updated: false });
      }

      if (action === 'close') {
        const roomCode = body.roomCode;
        if (roomCode) {
          roomsStore.delete(roomCode);
        }
        return res.status(200).json({ success: true, closed: true });
      }

      return res.status(400).json({ success: false, error: 'Action non reconnue' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
}
