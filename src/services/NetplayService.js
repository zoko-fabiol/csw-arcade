// Service universel pour le multijoueur CSW-Arcade (Hybride WebSocket LAN & Firebase Cloud)
import { db } from '../config/firebase';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc, 
  onSnapshot, 
  getDocs, 
  deleteDoc 
} from 'firebase/firestore';

class NetplayService {
  constructor() {
    this.ws = null;
    this.mode = 'auto'; // 'ws' | 'firebase'
    this.currentRoom = null;
    this.myPlayerIndex = -1; // 0: J1 (Hôte), 1: J2, 2: J3, 3: J4
    this.myRole = null; // 'p1' | 'p2' | 'p3' | 'p4' | 'spectator'
    this.listeners = new Map();
    this.ping = 0;
    this.pingInterval = null;
    this.firestoreUnsub = null;
    this.isConnecting = false;

    // --- REDONDANCE N-3 & FLUX GGPO ---
    this.localSeq = 0;
    this.currentFrame = 0;
    this.inputHistory = []; // [ { seq, frame, buttonId, isPressed, playerIndex } ]
    this.lastRemoteSeq = new Map(); // playerIndex -> last received seq
  }

  // Système d'événements
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

  // Connexion intelligente : Tente le WebSocket local d'abord, puis bascule en Firebase Cloud
  async connect() {
    if (this.mode === 'firebase') return Promise.resolve();
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }

    // Détection immédiate Netlify : Netlify ne gère pas les WebSockets persistants, bascule directe Firebase
    const isNetlify = typeof window !== 'undefined' && (
      window.location.hostname.includes('netlify.app') || 
      window.location.protocol === 'https:' && !window.location.hostname.match(/^(localhost|127\.0\.0\.1|192\.168\.|10\.)/)
    );

    if (isNetlify) {
      console.log('[Netplay] Environnement Cloud / Netlify détecté : activation du mode Firebase Cloud');
      this.mode = 'firebase';
      this.emit('connected');
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.log('[Netplay] Timeout WebSocket LAN, basculement vers Firebase Cloud...');
          this.mode = 'firebase';
          this.emit('connected');
          resolve();
        }
      }, 1500);

      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}/ws/netplay`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            this.mode = 'ws';
            console.log('[Netplay] Connecté au serveur WebSocket LAN:', wsUrl);
            this.startPingLoop();
            this.emit('connected');
            resolve();
          }
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
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.log('[Netplay] Erreur WebSocket LAN, basculement vers Firebase Cloud');
            this.mode = 'firebase';
            this.emit('connected');
            resolve();
          }
        };
      } catch(err) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.mode = 'firebase';
          resolve();
        }
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
          gameTitle: data.gameTitle,
          players: [{ name: data.hostName || 'Hôte', slot: 1, isHost: true, playerIndex: 0, role: 'p1' }]
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
        const pIdx = data.playerIndex ?? 1;
        const incomingSeq = data.seq || 0;
        const lastSeq = this.lastRemoteSeq.get(pIdx) || 0;

        // Auto-réparation N-3 en cas de perte de paquets (gap de séquence > 1)
        if (incomingSeq > lastSeq + 1 && Array.isArray(data.history) && data.history.length > 0) {
          const missedCount = incomingSeq - (lastSeq + 1);
          console.log(`[Netplay N-3] ${missedCount} paquet(s) manquant(s) détecté(s). Restauration via redondance N-3...`);
          // Réinjecter les inputs manquants dans l'ordre chronologique
          for (const item of data.history) {
            if (item && item.seq > lastSeq && item.seq < incomingSeq) {
              this.emit('remote_input', {
                playerIndex: pIdx,
                buttonId: item.buttonId,
                isPressed: item.isPressed,
                frame: item.frame || 0,
                seq: item.seq,
                recovered: true
              });
              this.lastRemoteSeq.set(pIdx, item.seq);
            }
          }
        }

        if (incomingSeq > 0) {
          this.lastRemoteSeq.set(pIdx, Math.max(lastSeq, incomingSeq));
        }
        this.emit('remote_input', data);
        break;
      }

      case 'REQUEST_STATE': {
        this.emit('request_state', data);
        break;
      }

      case 'SYNC_STATE': {
        this.emit('sync_state', data);
        break;
      }

      case 'HOST_DISCONNECTED': {
        this.currentRoom = null;
        this.myPlayerIndex = -1;
        this.myRole = null;
        this.emit('host_disconnected', data.message);
        break;
      }

      case 'GAME_STARTED_BY_HOST': {
        this.emit('game_started_by_host', data);
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

  generateRoomCode() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `ARC-${code}`;
  }

  // Créer un salon (l'utilisateur devient J1 / Hôte)
  async createRoom({ gameId, gameTitle, maxPlayers = 2, hostName = 'Hôte' }) {
    await this.connect();

    // 1. Tenter le mode WebSocket LAN si disponible
    if (this.mode === 'ws' && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        const wsRes = await new Promise((resolve, reject) => {
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
            reject(new Error('Délai d\'attente création de salle LAN dépassé.'));
          }, 3000);
        });

        // Mirrorer immédiatement dans Firebase pour que les amis sur 4G / Netlify puissent aussi rejoindre
        try {
          const roomRef = doc(db, 'rooms', wsRes.roomCode);
          await setDoc(roomRef, {
            code: wsRes.roomCode,
            gameId,
            gameTitle,
            maxPlayers: wsRes.maxPlayers || maxPlayers,
            hostName,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            players: [
              { name: hostName, slot: 1, isHost: true, playerIndex: 0, role: 'p1', ping: 5 }
            ],
            gameState: 'waiting',
            isLanBridged: true
          });

          // Écouter les joueurs distants qui rejoignent via le Cloud
          if (this.firestoreUnsub) this.firestoreUnsub();
          this.firestoreUnsub = onSnapshot(roomRef, (snapshot) => {
            if (!snapshot.exists()) return;
            const data = snapshot.data();
            // Si des inputs arrivent depuis le cloud
            if (this.myPlayerIndex === 0 && data.lastInput && data.lastInput.playerIndex > 0) {
              this.emit('remote_input', data.lastInput);
            }
          });
        } catch(e) {
          console.warn('[Netplay] Mirroring cloud non-bloquant:', e.message);
        }

        return wsRes;
      } catch(err) {
        console.warn('[Netplay] Erreur/timeout LAN, basculement automatique sur Firebase Cloud:', err.message);
      }
    }

    // 2. Mode Firebase Cloud (Netlify / Internet / Secours universel)
    return this.createFirebaseRoom({ gameId, gameTitle, maxPlayers, hostName });
  }

  async createFirebaseRoom({ gameId, gameTitle, maxPlayers = 2, hostName = 'Hôte' }) {
    try {
      const roomCode = this.generateRoomCode();
      const initialRoom = {
        code: roomCode,
        gameId,
        gameTitle,
        maxPlayers,
        hostName,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        players: [
          { name: hostName, slot: 1, isHost: true, playerIndex: 0, role: 'p1', ping: 12 }
        ],
        gameState: 'waiting',
        inputs: {}
      };

      const roomRef = doc(db, 'rooms', roomCode);
      await setDoc(roomRef, initialRoom);

      this.currentRoom = initialRoom;
      this.myPlayerIndex = 0;
      this.myRole = 'p1';

      // Écoute en temps réel des changements de joueurs et des inputs
      if (this.firestoreUnsub) this.firestoreUnsub();
      this.firestoreUnsub = onSnapshot(roomRef, (snapshot) => {
        if (!snapshot.exists()) {
          this.emit('host_disconnected', 'Le salon a été fermé.');
          return;
        }
        const data = snapshot.data();
        this.currentRoom = data;
        this.emit('room_update', data);

        // Détection des inputs distants pour l'hôte
        if (this.myPlayerIndex === 0 && data.lastInput && data.lastInput.playerIndex > 0) {
          this.emit('remote_input', data.lastInput);
        }
      });

      const resData = {
        roomCode,
        gameId,
        gameTitle,
        maxPlayers,
        hostName,
        role: 'p1',
        playerIndex: 0
      };

      this.emit('room_created', resData);
      console.log(`[Netplay Cloud] Salon ${roomCode} créé avec succès sur Firebase !`);
      return resData;
    } catch(err) {
      console.error('[Netplay Cloud] Erreur création salon Firebase:', err);
      throw new Error('Échec de la création du salon : ' + err.message);
    }
  }

  // Rejoindre un salon avec un code (ex: ARC-74)
  async joinRoom(roomCode, playerName = 'Invité') {
    await this.connect();
    const cleanCode = roomCode.trim().toUpperCase();

    // 1. Mode WebSocket LAN
    if (this.mode === 'ws' && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        const wsRes = await new Promise((resolve, reject) => {
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
            roomCode: cleanCode,
            playerName
          }));

          setTimeout(() => {
            this.off('joined_success', onSuccess);
            this.off('error', onError);
            reject(new Error('Délai d\'attente connexion LAN dépassé.'));
          }, 3500);
        });

        return wsRes;
      } catch(err) {
        console.log('[Netplay] Salon non trouvé sur LAN ou timeout, essai immédiat sur Firebase Cloud...');
      }
    }

    // 2. Mode Firebase Cloud (Netlify / Internet)
    return this.joinFirebaseRoom(cleanCode, playerName);
  }

  async joinFirebaseRoom(cleanCode, playerName = 'Invité') {
    try {
      const roomRef = doc(db, 'rooms', cleanCode);
      const snap = await getDoc(roomRef);

      if (!snap.exists()) {
        throw new Error(`Salon "${cleanCode}" introuvable.`);
      }

      const roomData = snap.data();
      const currentPlayers = roomData.players || [];

      if (currentPlayers.length >= roomData.maxPlayers) {
        throw new Error(`Le salon ${cleanCode} est complet (${roomData.maxPlayers}/${roomData.maxPlayers}).`);
      }

      const playerIndex = currentPlayers.length;
      const role = `p${playerIndex + 1}`;
      const newPlayer = {
        name: playerName,
        slot: playerIndex + 1,
        isHost: false,
        playerIndex,
        role,
        ping: 25
      };

      const updatedPlayers = [...currentPlayers, newPlayer];
      await updateDoc(roomRef, {
        players: updatedPlayers,
        updatedAt: Date.now()
      });

      this.currentRoom = { ...roomData, players: updatedPlayers };
      this.myPlayerIndex = playerIndex;
      this.myRole = role;

      if (this.firestoreUnsub) this.firestoreUnsub();
      this.firestoreUnsub = onSnapshot(roomRef, (snapshot) => {
        if (!snapshot.exists()) {
          this.emit('host_disconnected', 'Le salon a été fermé.');
          return;
        }
        const data = snapshot.data();
        this.currentRoom = data;
        this.emit('room_update', data);

        // Détection de l'événement de lancement par l'hôte
        if (data.gameState === 'started') {
          this.emit('game_started_by_host', data);
        }
      });

      const resData = {
        roomCode: cleanCode,
        gameId: roomData.gameId,
        gameTitle: roomData.gameTitle,
        maxPlayers: roomData.maxPlayers,
        playerIndex,
        role
      };

      this.emit('joined_success', resData);
      console.log(`[Netplay Cloud] Salon ${cleanCode} rejoint avec succès (Slot J${playerIndex + 1}) !`);
      return resData;
    } catch(err) {
      console.error('[Netplay Cloud] Erreur connexion salon:', err);
      throw new Error(err.message || 'Impossible de rejoindre le salon.');
    }
  }

  // Envoyer un input (D-pad ou bouton) vers l'hôte ou les autres joueurs avec redondance N-3
  sendInput(buttonId, isPressed, playerIndex = null) {
    const pIdx = (typeof playerIndex === 'number') ? playerIndex : (this.myPlayerIndex >= 0 ? this.myPlayerIndex : 0);
    this.localSeq = (this.localSeq + 1) & 0x7FFFFFFF;

    const currentItem = {
      seq: this.localSeq,
      frame: this.currentFrame,
      buttonId,
      isPressed: !!isPressed,
      playerIndex: pIdx
    };

    // Historique des 3 frames précédentes (N-3)
    const historyPayload = this.inputHistory.slice(-3);
    this.inputHistory.push(currentItem);
    if (this.inputHistory.length > 16) {
      this.inputHistory.shift();
    }

    // Mode WebSocket LAN
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentRoom) {
      this.ws.send(JSON.stringify({
        type: 'SEND_INPUT',
        playerIndex: pIdx,
        buttonId,
        isPressed: !!isPressed,
        frame: this.currentFrame,
        seq: this.localSeq,
        history: historyPayload
      }));
      return;
    }

    // Mode Firebase Cloud : Envoi rapide avec redondance N-3
    if (this.currentRoom?.code) {
      try {
        const roomRef = doc(db, 'rooms', this.currentRoom.code);
        updateDoc(roomRef, {
          lastInput: {
            playerIndex: pIdx,
            role: this.myRole || (pIdx === 0 ? 'p1' : 'p2'),
            buttonId,
            isPressed: !!isPressed,
            seq: this.localSeq,
            history: historyPayload,
            time: Date.now()
          }
        }).catch(() => {});
      } catch(e) {}
    }
  }

  // Demander la synchronisation de l'état (Guest -> Host)
  requestStateSync() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentRoom) {
      this.ws.send(JSON.stringify({
        type: 'REQUEST_STATE'
      }));
    }
  }

  // Envoyer l'état sérialisé (Host -> Guest)
  sendStateSync(stateData, toPlayerIndex = undefined) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentRoom) {
      this.ws.send(JSON.stringify({
        type: 'SEND_STATE',
        toPlayerIndex,
        stateData
      }));
    }
  }

  // Lancer la partie en tant qu'hôte
  startGame() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'START_GAME' }));
    }
    if (this.currentRoom?.code && this.myPlayerIndex === 0) {
      try {
        const roomRef = doc(db, 'rooms', this.currentRoom.code);
        updateDoc(roomRef, { gameState: 'started', updatedAt: Date.now() }).catch(() => {});
      } catch(e) {}
    }
  }

  // Quitter le salon actuel
  leaveRoom() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentRoom) {
      this.ws.send(JSON.stringify({ type: 'LEAVE_ROOM' }));
    }
    
    if (this.currentRoom?.code) {
      try {
        const roomRef = doc(db, 'rooms', this.currentRoom.code);
        if (this.myPlayerIndex === 0) {
          deleteDoc(roomRef).catch(() => {});
        } else {
          const remaining = (this.currentRoom.players || []).filter(p => p.playerIndex !== this.myPlayerIndex);
          updateDoc(roomRef, { players: remaining }).catch(() => {});
        }
      } catch(e) {}
    }

    if (this.firestoreUnsub) {
      this.firestoreUnsub();
      this.firestoreUnsub = null;
    }

    this.currentRoom = null;
    this.myPlayerIndex = -1;
    this.myRole = null;
    this.emit('left_room');
  }

  // Récupérer la liste des salons actifs (LAN ou Cloud)
  async fetchRooms() {
    const combined = new Map();

    // 1. Tenter l'API locale LAN
    try {
      const res = await fetch('/api/netplay/rooms');
      if (res.ok) {
        const data = await res.json();
        if (data.rooms && Array.isArray(data.rooms)) {
          data.rooms.forEach(r => combined.set(r.code, r));
        }
      }
    } catch(e) {}

    // 2. Récupération Cloud Firebase
    try {
      const snap = await getDocs(collection(db, 'rooms'));
      const now = Date.now();
      snap.forEach(docSnap => {
        const d = docSnap.data();
        // Conserver les salons récents (< 2 heures)
        if (d && (!d.updatedAt || (now - d.updatedAt) < 7200000)) {
          if (!combined.has(d.code)) {
            combined.set(d.code, {
              code: d.code,
              gameId: d.gameId,
              gameTitle: d.gameTitle,
              maxPlayers: d.maxPlayers || 2,
              currentPlayers: (d.players || []).length,
              players: d.players || [],
              createdAt: d.createdAt
            });
          }
        }
      });
    } catch(err) {
      console.warn('[Netplay] Erreur lecture salons cloud:', err);
    }

    return Array.from(combined.values());
  }
}

export const netplayService = new NetplayService();
