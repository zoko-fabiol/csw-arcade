// Service client pour le multijoueur local (LAN / Wi-Fi) CSW-Arcade
class NetplayService {
  constructor() {
    this.ws = null;
    this.currentRoom = null;
    this.myPlayerIndex = -1; // 0: J1 (Hôte), 1: J2, 2: J3, 3: J4, -1: Spectateur / Déconnecté
    this.myRole = null; // 'p1' | 'p2' | 'p3' | 'p4' | 'spectator'
    this.listeners = new Map();
    this.ping = 0;
    this.pingInterval = null;
    this.reconnectTimeout = null;
    this.isConnecting = false;
  }

  // Système d'événements simple
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => {
        try { cb(data); } catch(e) { console.error(`[Netplay] Erreur listener ${event}:`, e); }
      });
    }
  }

  // Connexion WebSocket
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}/ws/netplay`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('[Netplay] Connecté au serveur LAN:', wsUrl);
          this.startPingLoop();
          this.emit('connected');
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
          } catch(e) {
            console.warn('[Netplay] Message invalide:', e);
          }
        };

        this.ws.onclose = () => {
          console.log('[Netplay] Déconnecté du serveur LAN');
          this.stopPingLoop();
          this.emit('disconnected');
        };

        this.ws.onerror = (err) => {
          console.warn('[Netplay] Erreur WebSocket:', err);
          this.emit('error', 'Impossible de joindre le serveur réseau.');
          reject(err);
        };
      } catch(err) {
        reject(err);
      }
    });
  }

  handleMessage(data) {
    switch(data.type) {
      case 'ROOM_CREATED': {
        this.currentRoom = {
          code: data.roomCode,
          maxPlayers: data.maxPlayers,
          gameId: data.gameId,
          gameTitle: data.gameTitle
        };
        this.myPlayerIndex = 0;
        this.myRole = 'p1';
        this.emit('room_created', data);
        break;
      }

      case 'JOINED_SUCCESS': {
        this.currentRoom = {
          code: data.roomCode,
          maxPlayers: data.maxPlayers,
          gameId: data.gameId,
          gameTitle: data.gameTitle
        };
        this.myPlayerIndex = data.playerIndex;
        this.myRole = data.role;
        this.emit('joined_success', data);
        break;
      }

      case 'ROOM_UPDATE': {
        this.currentRoom = data.room;
        this.emit('room_update', data.room);
        break;
      }

      case 'REMOTE_INPUT': {
        // Reçu par l'hôte : une touche envoyée par un joueur distant (J2, J3, J4)
        this.emit('remote_input', data);
        break;
      }

      case 'HOST_DISCONNECTED': {
        this.currentRoom = null;
        this.myPlayerIndex = -1;
        this.myRole = null;
        this.emit('host_disconnected', data.message);
        break;
      }

      case 'ERROR': {
        this.emit('error', data.message);
        break;
      }

      case 'PONG': {
        if (data.clientTime) {
          this.ping = Math.max(1, Date.now() - data.clientTime);
          this.emit('ping', this.ping);
        }
        break;
      }
    }
  }

  // Démarrer la boucle de ping toutes les 3s pour surveiller la latence LAN
  startPingLoop() {
    this.stopPingLoop();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'PING', clientTime: Date.now() }));
      }
    }, 3000);
  }

  stopPingLoop() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // Créer un salon (l'utilisateur devient J1 / Hôte)
  async createRoom({ gameId, gameTitle, maxPlayers = 2, hostName = 'Hôte' }) {
    await this.connect();
    return new Promise((resolve, reject) => {
      const onCreated = (data) => {
        this.off('room_created', onCreated);
        resolve(data);
      };
      this.on('room_created', onCreated);

      this.ws.send(JSON.stringify({
        type: 'CREATE_ROOM',
        gameId,
        gameTitle,
        maxPlayers,
        hostName
      }));

      setTimeout(() => {
        this.off('room_created', onCreated);
        reject(new Error('Délai d\'attente création de salle dépassé.'));
      }, 5000);
    });
  }

  // Rejoindre un salon avec un code (ex: ARC-74)
  async joinRoom(roomCode, playerName = 'Invité') {
    await this.connect();
    return new Promise((resolve, reject) => {
      const onSuccess = (data) => {
        this.off('joined_success', onSuccess);
        this.off('error', onError);
        resolve(data);
      };
      const onError = (msg) => {
        this.off('joined_success', onSuccess);
        this.off('error', onError);
        reject(new Error(msg));
      };

      this.on('joined_success', onSuccess);
      this.on('error', onError);

      this.ws.send(JSON.stringify({
        type: 'JOIN_ROOM',
        roomCode: roomCode.trim().toUpperCase(),
        playerName
      }));

      setTimeout(() => {
        this.off('joined_success', onSuccess);
        this.off('error', onError);
        reject(new Error('Délai d\'attente connexion au salon dépassé.'));
      }, 6000);
    });
  }

  // Envoyer un input (D-pad ou bouton) vers l'hôte
  sendInput(buttonId, isPressed) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentRoom) {
      this.ws.send(JSON.stringify({
        type: 'SEND_INPUT',
        buttonId,
        isPressed: !!isPressed
      }));
    }
  }

  // Quitter le salon actuel
  leaveRoom() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentRoom) {
      this.ws.send(JSON.stringify({ type: 'LEAVE_ROOM' }));
    }
    this.currentRoom = null;
    this.myPlayerIndex = -1;
    this.myRole = null;
    this.emit('left_room');
  }

  // Récupérer la liste des salons LAN actifs via l'API REST
  async fetchRooms() {
    try {
      const res = await fetch('/api/netplay/rooms');
      if (!res.ok) return [];
      const data = await res.json();
      return data.rooms || [];
    } catch(e) {
      console.warn('[Netplay] Échec récupération salons:', e);
      return [];
    }
  }
}

export const netplayService = new NetplayService();
