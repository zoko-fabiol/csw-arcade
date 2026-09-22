// Service universel pour le multijoueur CSW-Arcade (Hybride WebSocket LAN & WebRTC P2P / PeerJS Cloud / Firebase)
import { Peer } from 'peerjs';
import { db } from '../config/firebase';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc, 
  onSnapshot, 
  getDocs, 
  deleteDoc,
  addDoc
} from 'firebase/firestore';

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ],
  iceCandidatePoolSize: 10
};

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
    this.isFirestoreQuotaExceeded = false;

    // --- PeerJS DataChannel P2P (Zero Quota, Zero 429) ---
    this.peer = null;
    this.peerConn = null;

    // --- WebRTC P2P DataChannels ---
    this.pc = null;
    this.fastInputChannel = null; // Canal UDP ultra-rapide (ordered: false, maxRetransmits: 0)
    this.reliableChannel = null; // Canal fiable ordonné pour états et contrôle
    this.webrtcUnsubs = [];
    this.webrtcPingInterval = null;
    this.isP2PConnected = false;
    this.inputDelayFrames = 0; // Buffer adaptatif GGPO (0 à 3 frames)
    this.mySessionId = 'csw_' + Math.random().toString(36).slice(2, 10);
    this.ntfyWs = null;
    this.currentTopic = null;

    // --- LOBBY GLOBAL EN TEMPS RÉEL (Zero-Quota Ntfy) ---
    this.discoveredRooms = new Map();
    this.lobbyWs = null;
    this.lobbyHeartbeatInterval = null;
    this.onDataReceived = null; // Callback binaire pour NetplaySyncEngine

    // --- REDONDANCE N-3 & FLUX GGPO ---
    this.localSeq = 0;
    this.currentFrame = 0;
    this.inputHistory = []; // [ { seq, frame, buttonId, isPressed, playerIndex } ]
    this.lastRemoteSeq = new Map(); // playerIndex -> last received seq
    this.myActiveRoomCode = (typeof localStorage !== 'undefined' ? localStorage.getItem('csw_my_active_room') : null);

    // --- BARRIÈRE DE DÉMARRAGE SYNCHRONISÉ FRAME 0 ---
    this.localCoreReady = false;
    this.remoteCoreReady = false;
    this.startBarrierTimer = null;

    // --- SIMULATEUR DE CONDITIONS RÉSEAU (DEBUG / TESTS) ---
    this.networkSimulator = { latency: 0, jitter: 0, packetLoss: 0 };

    // Initialisation immédiate du lobby global
    this.initLobbyDiscovery();
  }

  setNetworkSimulator(sim) {
    this.networkSimulator = {
      latency: Math.max(0, sim?.latency || 0),
      jitter: Math.max(0, sim?.jitter || 0),
      packetLoss: Math.max(0, Math.min(100, sim?.packetLoss || 0))
    };
    console.log('[Netplay] Simulateur réseau mis à jour :', this.networkSimulator);
  }

  // Connexion au lobby global temps réel sans quota
  initLobbyDiscovery() {
    if (typeof window === 'undefined') return;
    if (this.lobbyWs && (this.lobbyWs.readyState === WebSocket.OPEN || this.lobbyWs.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      const ws = new WebSocket('wss://ntfy.sh/csw-arcade-global-lobby/ws');
      this.lobbyWs = ws;

      ws.onopen = () => {
        console.log('[Netplay Lobby] Connecté au lobby global en temps réel (Zero-Quota)');
        // Interroger les hôtes actifs
        this.sendNtfySignal('csw-arcade-global-lobby', { type: 'QUERY_ROOMS' });
      };

      ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data);
          if (raw.event !== 'message' || !raw.message) return;
          const msg = JSON.parse(raw.message);
          if (msg.sender === this.mySessionId) return;

          if (msg.type === 'ROOM_ANNOUNCE' && msg.room && msg.room.code) {
            this.discoveredRooms.set(msg.room.code, {
              ...msg.room,
              lastSeen: Date.now()
            });
            this.emit('rooms_discovered', Array.from(this.discoveredRooms.values()));
          }

          if (msg.type === 'ROOM_CLOSED' && msg.roomCode) {
            this.discoveredRooms.delete(msg.roomCode);
            this.emit('rooms_discovered', Array.from(this.discoveredRooms.values()));
          }

          if (msg.type === 'QUERY_ROOMS') {
            if (this.currentRoom && this.myPlayerIndex === 0) {
              const now = Date.now();
              if (!this._lastLobbyAnnounce || now - this._lastLobbyAnnounce > 1000) {
                this.announceRoomToLobby();
              }
            }
          }
        } catch(e) {}
      };

      ws.onclose = () => {
        this.lobbyWs = null;
        setTimeout(() => this.initLobbyDiscovery(), 3000);
      };

      ws.onerror = () => {
        try { ws.close(); } catch(e) {}
        this.lobbyWs = null;
      };
    } catch(err) {
      console.warn('[Netplay Lobby] Erreur connexion lobby ws:', err);
    }
  }

  startLobbyAnnouncement() {
    this.announceRoomToLobby();
    if (this.lobbyHeartbeatInterval) clearInterval(this.lobbyHeartbeatInterval);
    this.lobbyHeartbeatInterval = setInterval(() => {
      if (this.currentRoom && this.myPlayerIndex === 0) {
        this.announceRoomToLobby();
      } else {
        clearInterval(this.lobbyHeartbeatInterval);
        this.lobbyHeartbeatInterval = null;
      }
    }, 45000);
  }

  announceRoomToLobby() {
    if (!this.currentRoom || this.myPlayerIndex !== 0) return;
    this._lastLobbyAnnounce = Date.now();
    const roomInfo = {
      code: this.currentRoom.code,
      gameId: this.currentRoom.gameId,
      gameTitle: this.currentRoom.gameTitle,
      maxPlayers: this.currentRoom.maxPlayers || 2,
      currentPlayers: (this.currentRoom.players || []).length,
      players: this.currentRoom.players || [],
      hostName: this.currentRoom.hostName || this.currentRoom.players?.[0]?.name || 'Hôte',
      networkMode: this.currentRoom.networkMode || 'online',
      createdAt: this.currentRoom.createdAt || Date.now(),
      updatedAt: Date.now()
    };
    this.discoveredRooms.set(roomInfo.code, {
      ...roomInfo,
      lastSeen: Date.now()
    });
    this.sendNtfySignal('csw-arcade-global-lobby', {
      type: 'ROOM_ANNOUNCE',
      room: roomInfo
    });
  }

  stopLobbyAnnouncement() {
    if (this.lobbyHeartbeatInterval) {
      clearInterval(this.lobbyHeartbeatInterval);
      this.lobbyHeartbeatInterval = null;
    }
    if (this.currentRoom?.code && this.myPlayerIndex === 0) {
      this.discoveredRooms.delete(this.currentRoom.code);
      this.sendNtfySignal('csw-arcade-global-lobby', {
        type: 'ROOM_CLOSED',
        roomCode: this.currentRoom.code
      });
    }
  }

  // Nettoyage de tout salon précédent créé par cet hôte
  async cleanupPreviousRoom() {
    const oldCode = this.myActiveRoomCode || (typeof localStorage !== 'undefined' ? localStorage.getItem('csw_my_active_room') : null);
    if (!oldCode) return;

    console.log(`[Netplay] Nettoyage de l'ancien salon de l'hôte : ${oldCode}`);

    this.stopLobbyAnnouncement();

    // 1. Fermeture via serveur WebSocket LAN
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'CLOSE_ROOM', roomCode: oldCode }));
      } catch(e) {}
    }

    // 2. Annonce de fermeture sur le lobby global et le topic Ntfy
    try {
      this.sendNtfySignal('csw-arcade-global-lobby', {
        type: 'ROOM_CLOSED',
        roomCode: oldCode
      });
      this.sendNtfySignal(`csw-arcade-${oldCode.toLowerCase().replace(/[^a-z0-9]/g, '')}`, {
        type: 'HOST_DISCONNECTED',
        message: "L'hôte a ouvert un nouveau salon."
      });
    } catch(e) {}

    // 3. Suppression dans Firestore (non bloquante)
    try {
      deleteDoc(doc(db, 'rooms', oldCode)).catch(() => {});
    } catch(e) {}

    this.discoveredRooms.delete(oldCode);
    this.myActiveRoomCode = null;
    if (typeof localStorage !== 'undefined') {
      try { localStorage.removeItem('csw_my_active_room'); } catch(e) {}
    }
  }

  get webrtcChannel() {
    return (this.fastInputChannel && this.fastInputChannel.readyState === 'open')
      ? this.fastInputChannel
      : this.reliableChannel;
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
  async connect(forceWs = false) {
    const isLocalHost = typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' || 
      window.location.hostname === '127.0.0.1' || 
      window.location.hostname.startsWith('192.168.') || 
      window.location.hostname.startsWith('10.')
    );
    if (this.mode === 'firebase' && !forceWs && !isLocalHost) return Promise.resolve();
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }

    // Détection immédiate Vercel / Netlify / Cloud : pas de WebSockets persistants Node.js locaux, bascule directe Firebase + WebRTC P2P
    const isCloud = typeof window !== 'undefined' && (
      window.location.hostname.includes('vercel.app') ||
      window.location.hostname.includes('netlify.app') || 
      (window.location.protocol === 'https:' && !window.location.hostname.match(/^(localhost|127\.0\.0\.1|192\.168\.|10\.)/))
    );

    if (isCloud) {
      console.log('[Netplay] Environnement Cloud (Vercel / Netlify) détecté : activation du mode WebRTC + Firebase Cloud');
      this.mode = 'firebase';
      this.emit('connected');
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.log('[Netplay] Timeout WebSocket LAN, basculement vers WebRTC + Firebase Cloud...');
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

        this.ws.onerror = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.log('[Netplay] Erreur WebSocket LAN, basculement vers WebRTC + Firebase Cloud');
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

  // Traitement centralisé des messages (reçus soit via WebSocket LAN, soit via WebRTC DataChannel)
  handleMessage(data) {
    if (!data || !data.type) return;

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
        const pIndex = typeof data.playerIndex === 'number' ? data.playerIndex : 1;
        let players = data.players;
        if (!players || !Array.isArray(players) || players.length === 0) {
          players = [
            { name: 'Hôte', slot: 1, isHost: true, playerIndex: 0, role: 'p1', ping: 0 },
            { name: this.playerName || 'Joueur 2', slot: 2, isHost: false, playerIndex: 1, role: 'p2', ping: 0 }
          ];
        }
        this.currentRoom = {
          code: data.roomCode,
          maxPlayers: data.maxPlayers || 2,
          gameId: data.gameId,
          gameTitle: data.gameTitle,
          players
        };
        this.myPlayerIndex = pIndex;
        this.myRole = data.role || `p${pIndex + 1}`;
        this.emit('joined_success', data);
        break;
      }

      case 'ROOM_UPDATE': {
        this.currentRoom = data.room;
        this.emit('room_update', data.room);
        break;
      }

      case 'SEND_INPUT':
      case 'REMOTE_INPUT': {
        const pIdx = data.playerIndex ?? 1;
        // Si c'est notre propre input, on ne le rejoue pas
        if (pIdx === this.myPlayerIndex) return;

        const incomingSeq = data.seq || 0;
        const lastSeq = this.lastRemoteSeq.get(pIdx) || 0;

        // Auto-réparation N-3 en cas de perte de paquets (gap de séquence > 1)
        if (incomingSeq > lastSeq + 1 && Array.isArray(data.history) && data.history.length > 0) {
          const missedCount = incomingSeq - (lastSeq + 1);
          console.log(`[Netplay N-3] ${missedCount} paquet(s) manquant(s) pour J${pIdx + 1}. Restauration via N-3...`);
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

        this.emit('remote_input', {
          playerIndex: pIdx,
          buttonId: data.buttonId,
          isPressed: !!data.isPressed,
          frame: data.frame || 0,
          seq: incomingSeq
        });
        break;
      }

      case 'REQUEST_STATE': {
        this.emit('request_state', data);
        break;
      }

      case 'SEND_STATE':
      case 'SYNC_STATE': {
        this.emit('sync_state', data);
        break;
      }

      case 'STATE_CHUNK': {
        const { transferId, chunkIndex, totalChunks, chunk, stateSize, fromPlayerIndex, toPlayerIndex, isHeartbeat, time } = data;
        if (!this.incomingStateChunks.has(transferId)) {
          this.incomingStateChunks.set(transferId, {
            chunks: new Array(totalChunks),
            receivedCount: 0,
            totalChunks,
            stateSize,
            fromPlayerIndex,
            toPlayerIndex,
            isHeartbeat,
            time
          });
        }
        const transfer = this.incomingStateChunks.get(transferId);
        if (transfer && !transfer.chunks[chunkIndex]) {
          transfer.chunks[chunkIndex] = chunk;
          transfer.receivedCount++;
        }

        if (transfer && transfer.receivedCount === transfer.totalChunks) {
          const fullBase64 = transfer.chunks.join('');
          this.incomingStateChunks.delete(transferId);
          this.emit('sync_state', {
            stateBase64: fullBase64,
            stateSize: transfer.stateSize,
            fromPlayerIndex: transfer.fromPlayerIndex,
            toPlayerIndex: transfer.toPlayerIndex,
            isHeartbeat: transfer.isHeartbeat,
            time: transfer.time
          });
        }
        break;
      }

      case 'PEER_LEFT': {
        this.emit('peer_left', data);
        break;
      }

      case 'HOST_DISCONNECTED': {
        this.currentRoom = null;
        this.myPlayerIndex = -1;
        this.myRole = null;
        this.emit('host_disconnected', data.message || "L'hôte a quitté la partie.");
        break;
      }

      case 'START_GAME':
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

      case 'PEER_CORE_READY': {
        console.log(`[Netplay] Le pair distant J${(data.fromPlayerIndex ?? 1) + 1} a chargé sa ROM et est prêt !`);
        this.remoteCoreReady = true;
        this.checkAndReleaseStartBarrier();
        break;
      }

      case 'START_SIMULATION_NOW': {
        console.log('[Netplay] Ordre de lancement simultané reçu ! Top départ Frame 0 à', data.startTime);
        const delay = Math.max(0, (data.startTime || Date.now()) - Date.now());
        setTimeout(() => {
          this.emit('start_simulation_now', data);
        }, delay);
        break;
      }

      case 'REQUEST_SURVIVOR_CATCHUP': {
        console.log(`[Netplay] Demande d'autorité du survivant reçue pour le retour en jeu de J${(data.fromPlayerIndex ?? 0) + 1}`);
        this.emit('survivor_catchup_requested', data);
        break;
      }

      case 'GUEST_JOINED': {
        console.log('[Netplay] Joueur invité connecté :', data?.playerName, 'PeerID:', data?.peerId);
        if (data?.peerId) {
          this.remotePeerId = data.peerId;
        }
        break;
      }

      case 'REQUEST_VIDEO_STREAM': {
        console.log('[Netplay PeerJS] Demande de flux vidéo reçue de l\'invité ! PeerID:', data?.peerId);
        if (data?.peerId) {
          this.remotePeerId = data.peerId;
        }
        this.emit('video_stream_requested');
        if (this.localVideoStream) {
          this.startVideoStream(this.localVideoStream);
        }
        break;
      }
    }
  }

  // --- GESTION DU TUNNEL WEBRTC P2P VIA PEERJS (Zero Quota, Zero 429, Zero CORS) ---
  closePeer() {
    if (this.peerConn) {
      try {
        this.peerConn.close();
      } catch(e) {}
      this.peerConn = null;
    }
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch(e) {}
      this.peer = null;
    }
  }

  setupPeerConnection(roomCode, isHost, playerName = null) {
    if (playerName) this.playerName = playerName;
    let cleanCode = (roomCode || '').trim().toUpperCase();
    if (!cleanCode.startsWith('ARC-') && cleanCode.length <= 4) {
      cleanCode = `ARC-${cleanCode}`;
    }
    const cleanId = cleanCode.toLowerCase().replace(/[^a-z0-9]/g, '');
    const hostPeerId = `csw-arcade-${cleanId}`;

    this.closePeer();

    try {
      if (isHost) {
        console.log(`[Netplay PeerJS] Initialisation du salon Hôte P2P : ${hostPeerId}`);
        const peer = new Peer(hostPeerId, {
          config: RTC_CONFIG,
          debug: 1
        });
        this.peer = peer;

        peer.on('open', (id) => {
          console.log(`[Netplay PeerJS] ✓ Salon Hôte prêt avec ID P2P : ${id}`);
          this.emit('host_ready', { id, roomCode: cleanCode });
        });

        peer.on('connection', (conn) => {
          console.log(`[Netplay PeerJS] ✓ Connexion entrante reçue de : ${conn.peer}`);
          this.remotePeerId = conn.peer;
          this.peerConn = conn;
          this.setupPeerDataConnection(conn, true);
          if (this.localVideoStream) {
            console.log('[Netplay PeerJS] Nouveau pair connecté, relance automatique du flux vidéo 60 FPS...');
            setTimeout(() => this.startVideoStream(this.localVideoStream), 500);
          }
        });

        peer.on('error', (err) => {
          console.warn('[Netplay PeerJS] Statut Peer Hôte:', err.type || err.message);
          if (err.type === 'unavailable-id') {
            console.warn(`[Netplay PeerJS] ID ${hostPeerId} temporairement occupé sur le broker, nouvelle tentative dans 1s...`);
            setTimeout(() => {
              if (this.peer === peer && isHost) {
                this.setupPeerConnection(roomCode, true, playerName);
              }
            }, 1000);
          }
        });
      } else {
        console.log(`[Netplay PeerJS] Invité : tentative de connexion P2P vers ${hostPeerId}...`);
        const peer = new Peer({
          config: RTC_CONFIG,
          debug: 1
        });
        this.peer = peer;

        // Réception du flux vidéo 60 FPS émis par l'hôte en mode Remote Play
        peer.on('call', (call) => {
          console.log('[Netplay PeerJS] Appel vidéo entrant reçu de l\'Hôte !');
          call.answer(); // Répond sans renvoyer de vidéo
          call.on('stream', (remoteStream) => {
            console.log('[Netplay PeerJS] ✓ Flux vidéo & audio WebRTC 60 FPS reçu avec succès !');
            this.remoteStream = remoteStream;
            this.emit('stream_received', remoteStream);
          });
          if (call.peerConnection) {
            call.peerConnection.ontrack = (event) => {
              if (event.streams && event.streams[0]) {
                console.log('[Netplay PeerJS] ✓ Piste média attachée via ontrack fallback');
                this.remoteStream = event.streams[0];
                this.emit('stream_received', event.streams[0]);
              }
            };
          }
        });

        peer.on('open', (myId) => {
          console.log(`[Netplay PeerJS] Invité connecté au broker (ID: ${myId}), liaison vers l'Hôte : ${hostPeerId}`);
          const conn = peer.connect(hostPeerId, {
            reliable: true
          });
          this.peerConn = conn;
          this.setupPeerDataConnection(conn, false);
        });

        peer.on('error', (err) => {
          console.warn('[Netplay PeerJS] Statut Peer Invité:', err.type || err.message);
          if (err.type === 'peer-unavailable') {
            this.emit('error', `Impossible de joindre le salon ${cleanCode}. Vérifiez le code ou que l'hôte a bien créé ce salon.`);
          }
        });
      }
    } catch(err) {
      console.warn('[Netplay PeerJS] Erreur initialisation:', err);
    }
  }

  setupPeerDataConnection(conn, isHost) {
    conn.on('open', () => {
      console.log(`[Netplay PeerJS] ✓✓ CANAL DIRECT P2P OUVERT ! Latence zéro active (isHost=${isHost}).`);
      this.isP2PConnected = true;
      this.emit('p2p_connected', { label: 'peerjs-webrtc' });

      // Ping périodique ultra-léger pour mesurer la latence directe
      if (this.webrtcPingInterval) clearInterval(this.webrtcPingInterval);
      this.webrtcPingInterval = setInterval(() => {
        if (this.peerConn && this.peerConn.open) {
          try {
            this.peerConn.send({ type: 'PING', t: Date.now() });
          } catch(e) {}
        }
      }, 2000);

      if (!isHost) {
        console.log('[Netplay PeerJS] Invité : envoi du signal GUEST_JOINED à l\'hôte...');
        conn.send({
          type: 'GUEST_JOINED',
          playerName: this.playerName || 'Joueur 2',
          sessionId: this.mySessionId,
          peerId: this.peer?.id
        });
      }
    });

    conn.on('data', (data) => {
      if (!data) return;

      // Détection binaire ultra-rapide (NetplaySyncEngine / Entités Delta)
      if (data instanceof ArrayBuffer || (data && data.byteLength !== undefined)) {
        const rawBuf = (data instanceof ArrayBuffer) 
          ? data 
          : (data && data.buffer 
              ? (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength 
                  ? data.buffer 
                  : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) 
              : data);
        this.emit('binary_data', rawBuf);
        if (typeof this.onDataReceived === 'function') {
          try { this.onDataReceived(rawBuf); } catch(e) {}
        }
        return;
      }

      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch(e) {}
      }

      // Décodage des paquets Rollback universels JSON (0x5A et 0xCB)
      if (data.type === 'ROLLBACK_FRAME_DATA') {
        const buf = new ArrayBuffer(15);
        const view = new DataView(buf);
        view.setUint8(0, 0x5A);
        view.setUint16(1, data.seq || 0, false);
        view.setUint32(3, data.frame || 0, false);
        view.setUint16(7, data.curMask || 0, false);
        view.setUint16(9, data.h1 || 0, false);
        view.setUint16(11, data.h2 || 0, false);
        view.setUint16(13, data.h3 || 0, false);
        this.emit('binary_data', buf);
        if (typeof this.onDataReceived === 'function') {
          try { this.onDataReceived(buf); } catch(e) {}
        }
        return;
      }

      if (data.type === 'ROLLBACK_CHECKSUM') {
        const buf = new ArrayBuffer(9);
        const view = new DataView(buf);
        view.setUint8(0, 0xCB);
        view.setUint32(1, data.frame || 0, false);
        view.setUint32(5, data.checksum || 0, false);
        this.emit('binary_data', buf);
        return;
      }

      // 1. Handshake : L'Hôte détecte l'invité et l'enregistre
      if (data.type === 'GUEST_JOINED' && isHost) {
        console.log('[Netplay PeerJS] ✓ Hôte : Invité connecté avec succès :', data.playerName);
        const guestName = data.playerName || 'Joueur 2';
        const p1 = this.currentRoom?.players?.[0] || { 
          name: this.currentRoom?.hostName || this.playerName || 'Hôte', 
          slot: 1, 
          isHost: true, 
          playerIndex: 0, 
          role: 'p1', 
          ping: 10 
        };
        const p2 = { 
          name: guestName, 
          slot: 2, 
          isHost: false, 
          playerIndex: 1, 
          role: 'p2', 
          ping: 15 
        };
        
        this.currentRoom = {
          ...this.currentRoom,
          players: [p1, p2],
          updatedAt: Date.now()
        };
        this.emit('room_update', this.currentRoom);

        // Envoyer la confirmation officielle et la synchronisation du salon à l'invité
        conn.send({
          type: 'HOST_WELCOME',
          room: this.currentRoom,
          playerIndex: 1,
          role: 'p2'
        });

        // Mettre à jour l'API des salons en direct (2/2 joueurs)
        try {
          fetch('/api/netplay/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'heartbeat',
              roomCode: this.currentRoom.code,
              players: this.currentRoom.players,
              currentPlayers: 2
            })
          }).catch(() => {});
        } catch(e) {}
      }

      // 2. Handshake : L'Invité reçoit l'acquittement de l'Hôte
      if (data.type === 'HOST_WELCOME' && !isHost) {
        console.log('[Netplay PeerJS] ✓ Invité : Confirmation reçue de l\'Hôte ! Salon validé.');
        if (data.room) {
          this.currentRoom = { ...this.currentRoom, ...data.room };
          this.myPlayerIndex = data.playerIndex ?? 1;
          this.myRole = data.role ?? 'p2';
          this.emit('room_update', this.currentRoom);
          this.emit('joined_success', {
            roomCode: this.currentRoom.code,
            gameId: this.currentRoom.gameId,
            gameTitle: this.currentRoom.gameTitle,
            playerIndex: this.myPlayerIndex,
            role: this.myRole,
            players: this.currentRoom.players
          });
        }
      }

      // 3. Lancement du jeu (supporte les deux types de message GAME_STARTED_BY_HOST et START_GAME)
      if ((data.type === 'GAME_STARTED_BY_HOST' || data.type === 'START_GAME') && !isHost) {
        console.log('[Netplay PeerJS] ✓ Invité : Signal de lancement reçu de l\'Hôte !', data);
        this.emit('game_started_by_host', data);
      }

      // 4. Inputs en temps réel
      if (data.type === 'SEND_INPUT') {
        this.handleMessage(data);
      }

      // 5. Synchronisation de Savestate
      if (data.type === 'REQUEST_STATE') {
        this.emit('request_state', { fromPlayerIndex: data.fromPlayerIndex });
      }
      if (data.type === 'SYNC_STATE') {
        this.emit('sync_state', data);
      }

      // 6. Ping / Pong
      if (data.type === 'PING') {
        try { conn.send({ type: 'PONG', t: data.t }); } catch(e) {}
      }
      if (data.type === 'PONG') {
        if (data.t) {
          this.ping = Math.max(1, Math.round((Date.now() - data.t) / 2));
          this.emit('ping', this.ping);
        }
      }

      // 7. Déconnexion
      if (data.type === 'PEER_LEFT') {
        this.emit('peer_left', data);
      }
      if (data.type === 'HOST_DISCONNECTED') {
        this.emit('host_disconnected', data.message || "L'hôte a fermé le salon.");
      }

      // 8. Barrière de synchronisation Frame 0 & Autorité du survivant
      if (data.type === 'PEER_CORE_READY' || data.type === 'START_SIMULATION_NOW' || data.type === 'REQUEST_SURVIVOR_CATCHUP') {
        this.handleMessage(data);
      }
    });

    conn.on('close', () => {
      console.log('[Netplay PeerJS] Canal P2P fermé.');
      this.isP2PConnected = false;
      this.emit('p2p_disconnected');
      if (this.webrtcPingInterval) {
        clearInterval(this.webrtcPingInterval);
        this.webrtcPingInterval = null;
      }
    });

    conn.on('error', (err) => {
      console.warn('[Netplay PeerJS] Erreur DataConnection:', err);
    });
  }

  // --- GESTION DU CANAL WEBRTC DATACHANNEL P2P ---
  closeWebRTC() {
    this.closePeer();
    if (this.webrtcPingInterval) {
      clearInterval(this.webrtcPingInterval);
      this.webrtcPingInterval = null;
    }
    if (this.webrtcUnsubs && Array.isArray(this.webrtcUnsubs)) {
      this.webrtcUnsubs.forEach(u => {
        try { u(); } catch(e) {}
      });
      this.webrtcUnsubs = [];
    }
    // Note: this.ntfyWs ne doit PAS être fermé ici car il sert de canal de signalisation persistant
    if (this.fastInputChannel) {
      try {
        this.fastInputChannel.onopen = null;
        this.fastInputChannel.onclose = null;
        this.fastInputChannel.onerror = null;
        this.fastInputChannel.onmessage = null;
        if (this.fastInputChannel.readyState !== 'closed') this.fastInputChannel.close();
      } catch(e) {}
      this.fastInputChannel = null;
    }
    if (this.reliableChannel) {
      try {
        this.reliableChannel.onopen = null;
        this.reliableChannel.onclose = null;
        this.reliableChannel.onerror = null;
        this.reliableChannel.onmessage = null;
        if (this.reliableChannel.readyState !== 'closed') this.reliableChannel.close();
      } catch(e) {}
      this.reliableChannel = null;
    }
    if (this.pc) {
      try {
        this.pc.onicecandidate = null;
        this.pc.onconnectionstatechange = null;
        this.pc.ondatachannel = null;
        this.pc.close();
      } catch(e) {}
      this.pc = null;
    }
    this.isP2PConnected = false;
  }

  // --- SIGNALING P2P UNIVERSEL SANS QUOTA (ntfy.sh WebSocket) ---
  setupNtfySignaling(roomCode, isHost, playerName = null) {
    if (playerName) this.playerName = playerName;
    let cleanCode = (roomCode || '').trim().toUpperCase();
    if (!cleanCode.startsWith('ARC-') && cleanCode.length <= 4) {
      cleanCode = `ARC-${cleanCode}`;
    }
    const topic = `csw-arcade-${cleanCode.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    this.currentTopic = topic;
    this.pendingNtfyCandidates = [];

    // Si déjà connecté et actif sur ce topic, ne pas détruire la liaison WebSocket !
    if (this.ntfyWs && (this.ntfyWs.readyState === WebSocket.OPEN || this.ntfyWs.readyState === WebSocket.CONNECTING) && this.currentTopic === topic) {
      if (!isHost) {
        this.sendNtfySignal(topic, {
          type: 'GUEST_JOINED',
          playerName: this.playerName || 'Invité'
        });
      }
      return;
    }

    if (this.ntfyWs) {
      try { this.ntfyWs.close(); } catch(e) {}
      this.ntfyWs = null;
    }

    try {
      const ntfyWs = new WebSocket(`wss://ntfy.sh/${topic}/ws`);
      this.ntfyWs = ntfyWs;

      ntfyWs.onopen = () => {
        console.log(`[Netplay] Tunnel direct P2P sans quota connecté (${topic})`);
        if (!isHost) {
          this.sendNtfySignal(topic, {
            type: 'GUEST_JOINED',
            playerName: this.playerName || 'Invité'
          });
        }
      };

      ntfyWs.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data);
          if (raw.event !== 'message' || !raw.message) return;
          const msg = JSON.parse(raw.message);
          if (msg.sender === this.mySessionId) return;

          if (msg.type === 'GUEST_JOINED' && isHost) {
            console.log('[Netplay P2P] Invité détecté dans le salon :', msg.playerName);
            if (this.currentRoom) {
              const currentGuests = (this.currentRoom.players || []).filter(p => !p.isHost);
              const isSameGuest = currentGuests.some(p => p.name === msg.playerName);

              // Si le salon a déjà un autre joueur activement connecté en P2P
              if (this.isP2PConnected && currentGuests.length >= (this.currentRoom.maxPlayers - 1) && !isSameGuest) {
                console.warn('[Netplay P2P] Salon déjà complet');
                this.sendNtfySignal(topic, {
                  type: 'ROOM_FULL',
                  targetSession: msg.sender,
                  message: `Le salon ${this.currentRoom.code} est complet (${this.currentRoom.maxPlayers}/${this.currentRoom.maxPlayers}).`
                });
                return;
              }

              const newPlayer = {
                name: msg.playerName || 'Joueur 2',
                slot: 2,
                isHost: false,
                playerIndex: 1,
                role: 'p2',
                ping: 20
              };
              this.currentRoom.players = [this.currentRoom.players[0], newPlayer];
              this.emit('room_update', this.currentRoom);
              this.sendNtfySignal(topic, {
                type: 'ROOM_SYNC',
                room: this.currentRoom
              });
              this.announceRoomToLobby();
            }
            this.setupWebRTCHostNtfy(topic);
          }

          if (msg.type === 'ROOM_FULL' && !isHost) {
            if (!msg.targetSession || msg.targetSession === this.mySessionId) {
              this.emit('error', msg.message || 'Le salon est complet.');
            }
          }

          if (msg.type === 'ROOM_SYNC' && !isHost) {
            if (msg.room) {
              this.currentRoom = { ...this.currentRoom, ...msg.room };
              this.emit('room_update', this.currentRoom);
            }
          }

          if (msg.type === 'WEBRTC_OFFER' && !isHost) {
            console.log('[Netplay P2P] Offre WebRTC reçue !');
            this.setupWebRTCGuestNtfy(topic, msg.offer);
          }

          if (msg.type === 'WEBRTC_ANSWER' && isHost) {
            console.log('[Netplay P2P] Réponse WebRTC reçue !');
            if (this.pc && !this.pc.currentRemoteDescription) {
              this.pc.setRemoteDescription(new RTCSessionDescription(msg.answer))
                .then(() => {
                  while (this.pendingNtfyCandidates && this.pendingNtfyCandidates.length > 0) {
                    const c = this.pendingNtfyCandidates.shift();
                    try { this.pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e) {}
                  }
                })
                .catch(console.warn);
            }
          }

          if (msg.type === 'ICE_CANDIDATE') {
            if (this.pc && this.pc.remoteDescription && msg.candidate) {
              this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
            } else if (msg.candidate) {
              if (!this.pendingNtfyCandidates) this.pendingNtfyCandidates = [];
              this.pendingNtfyCandidates.push(msg.candidate);
            }
          }

          if (msg.type === 'GAME_STARTED_BY_HOST' && !isHost) {
            this.emit('game_started_by_host', msg);
          }

          if (msg.type === 'PEER_LEFT') {
            this.emit('peer_left', msg);
          }

          if (msg.type === 'HOST_DISCONNECTED') {
            this.emit('host_disconnected', msg.message || "Le salon a été fermé par l'hôte.");
          }
        } catch(e) {}
      };
    } catch(err) {
      console.warn('[Netplay] Erreur initialisation ntfy ws:', err);
    }
  }

  sendNtfySignal(topic, data) {
    try {
      fetch(`https://ntfy.sh/${topic}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          sender: this.mySessionId,
          ...data
        })
      }).catch(() => {});
    } catch(e) {}
  }

  async setupWebRTCHostNtfy(topic) {
    try {
      this.closeWebRTC();
      if (!this.ntfyWs) {
        this.setupNtfySignaling(this.currentRoom?.code || topic, true);
      }
      const pc = new RTCPeerConnection(RTC_CONFIG);
      this.pc = pc;

      const fastDc = pc.createDataChannel('csw-fast-inputs', {
        ordered: false,
        maxRetransmits: 0
      });
      this.fastInputChannel = fastDc;
      this.setupDataChannel(fastDc);

      const reliableDc = pc.createDataChannel('csw-reliable-channel', {
        ordered: true
      });
      this.reliableChannel = reliableDc;
      this.setupDataChannel(reliableDc);

      pc.onconnectionstatechange = () => {
        console.log('[Netplay WebRTC Hôte Ntfy] ConnectionState:', pc.connectionState);
        if (pc.connectionState === 'connected') {
          this.isP2PConnected = true;
          this.emit('p2p_connected');
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          this.isP2PConnected = false;
          this.emit('p2p_disconnected');
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Attente compacte Vanilla ICE pour intégrer tous les candidats dans l'offre unique
      await new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve();
        const check = () => {
          if (pc.iceGatheringState === 'complete') resolve();
        };
        pc.onicegatheringstatechange = check;
        setTimeout(resolve, 600);
      });

      this.sendNtfySignal(topic, {
        type: 'WEBRTC_OFFER',
        offer: { type: pc.localDescription?.type || offer.type, sdp: pc.localDescription?.sdp || offer.sdp }
      });
    } catch(err) {
      console.warn('[Netplay WebRTC] Erreur initialisation Hôte Ntfy:', err);
    }
  }

  async setupWebRTCGuestNtfy(topic, offer) {
    try {
      this.closeWebRTC();
      if (!this.ntfyWs) {
        this.setupNtfySignaling(this.currentRoom?.code || topic, false);
      }
      const pc = new RTCPeerConnection(RTC_CONFIG);
      this.pc = pc;

      pc.ondatachannel = (event) => {
        const dc = event.channel;
        console.log(`[Netplay WebRTC Invité Ntfy] DataChannel capté : ${dc.label}`);
        if (dc.label === 'csw-fast-inputs') {
          this.fastInputChannel = dc;
        } else {
          this.reliableChannel = dc;
        }
        this.setupDataChannel(dc);
      };

      pc.onconnectionstatechange = () => {
        console.log('[Netplay WebRTC Invité Ntfy] ConnectionState:', pc.connectionState);
        if (pc.connectionState === 'connected') {
          this.isP2PConnected = true;
          this.emit('p2p_connected');
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          this.isP2PConnected = false;
          this.emit('p2p_disconnected');
        }
      };

      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Attente compacte Vanilla ICE pour intégrer tous les candidats dans la réponse unique
      await new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve();
        const check = () => {
          if (pc.iceGatheringState === 'complete') resolve();
        };
        pc.onicegatheringstatechange = check;
        setTimeout(resolve, 600);
      });

      this.sendNtfySignal(topic, {
        type: 'WEBRTC_ANSWER',
        answer: { type: pc.localDescription?.type || answer.type, sdp: pc.localDescription?.sdp || answer.sdp }
      });
    } catch(err) {
      console.warn('[Netplay WebRTC] Erreur initialisation Invité Ntfy:', err);
    }
  }

  setupDataChannel(dc) {
    try {
      dc.binaryType = 'arraybuffer';
    } catch(e) {}

    dc.onopen = () => {
      console.log(`[Netplay WebRTC] ✓ DataChannel '${dc.label}' OUVERT ! Liaison P2P active.`);
      this.isP2PConnected = true;
      this.emit('p2p_connected', { label: dc.label });

      // Mesure du RTT P2P sur le canal de contrôle
      if (!this.webrtcPingInterval && (dc.label === 'csw-reliable-channel' || dc.label === 'csw-arcade-netplay' || dc.label === 'csw-fast-inputs')) {
        this.webrtcPingInterval = setInterval(() => {
          const pingTarget = (this.reliableChannel && this.reliableChannel.readyState === 'open')
            ? this.reliableChannel
            : (this.fastInputChannel && this.fastInputChannel.readyState === 'open' ? this.fastInputChannel : null);
          if (pingTarget) {
            try {
              pingTarget.send(JSON.stringify({ type: 'PING', clientTime: Date.now() }));
            } catch(e) {}
          }
        }, 2000);
      }
    };

    dc.onclose = () => {
      console.log(`[Netplay WebRTC] DataChannel '${dc.label}' FERMÉ.`);
      const hasOpenChannel = (this.fastInputChannel?.readyState === 'open') || (this.reliableChannel?.readyState === 'open');
      if (!hasOpenChannel) {
        this.isP2PConnected = false;
        if (this.webrtcPingInterval) {
          clearInterval(this.webrtcPingInterval);
          this.webrtcPingInterval = null;
        }
        if (this.currentRoom) {
          this.emit('peer_left', { message: "Connexion P2P fermée ou perdue avec l'autre joueur." });
        }
      }
    };

    dc.onerror = (err) => {
      console.warn(`[Netplay WebRTC] Erreur DataChannel '${dc.label}':`, err);
    };

    dc.onmessage = (event) => {
      // 1. Détection binaire ultra-rapide (Rollback inputs 0x5A, Checksums 0xCB, Entités Delta)
      if (event.data instanceof ArrayBuffer) {
        const u8 = new Uint8Array(event.data);

        // Paquets Rollback Netcode (0x5A) et Checksum (0xCB)
        if (u8[0] === 0x5A || u8[0] === 0xCB) {
          this.emit('binary_data', event.data);
          if (typeof this.onDataReceived === 'function') {
            try { this.onDataReceived(event.data); } catch(e) {}
          }
          return;
        }

        // Paquet binaire rétro-compatible 0xA5
        if (u8[0] === 0xA5 && u8.length >= 9) {
          const incomingSeq = (u8[1] << 8) | u8[2];
          const pIdx = u8[3];
          const buttonId = u8[4];
          const isPressed = u8[5] === 1;
          const history = [];
          for (let i = 0; i < 3; i++) {
            const val = u8[6 + i];
            if (val !== 0xFF) {
              history.push({
                buttonId: val & 0x0F,
                isPressed: (val & 0x80) !== 0,
                seq: Math.max(0, incomingSeq - (3 - i))
              });
            }
          }
          this.handleMessage({
            type: 'REMOTE_INPUT',
            playerIndex: pIdx,
            buttonId,
            isPressed,
            seq: incomingSeq,
            history
          });
          return;
        }
      }

      // 2. Décodage JSON pour le contrôle et signaux
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'PING') {
          if (dc.readyState === 'open') {
            try { dc.send(JSON.stringify({ type: 'PONG', clientTime: msg.clientTime })); } catch(e) {}
          }
          return;
        }
        if (msg.type === 'PONG') {
          if (msg.clientTime) {
            this.ping = Math.max(1, Date.now() - msg.clientTime);
            // Calcul automatique du buffer de délai optimal (style Fightcade / GGPO)
            // Ping < 40ms -> 0 frame delay
            // Ping 40-90ms -> 1 frame delay (16ms)
            // Ping 90-160ms (Cameroun-France) -> 2 frames delay (33ms)
            // Ping > 160ms -> 3 frames delay (50ms)
            if (this.ping < 40) {
              this.inputDelayFrames = 0;
            } else if (this.ping < 90) {
              this.inputDelayFrames = 1;
            } else if (this.ping < 160) {
              this.inputDelayFrames = 2;
            } else {
              this.inputDelayFrames = 3;
            }
            this.emit('ping', this.ping);
            this.emit('delay_update', this.inputDelayFrames);
          }
          return;
        }
        this.handleMessage(msg);
      } catch(e) {
        console.warn('[Netplay WebRTC] Erreur parsing message entrant:', e);
      }
    };
  }

  async setupWebRTCHost(roomRef) {
    try {
      this.closeWebRTC();
      const pc = new RTCPeerConnection(RTC_CONFIG);
      this.pc = pc;
      const pendingCandidates = [];
      let isRemoteDescSet = false;

      // 1. Canal UDP rapide pour les inputs 60 FPS (ordered: false, maxRetransmits: 0 -> 0 blocage HOL)
      const fastDc = pc.createDataChannel('csw-fast-inputs', {
        ordered: false,
        maxRetransmits: 0
      });
      this.fastInputChannel = fastDc;
      this.setupDataChannel(fastDc);

      // 2. Canal fiable ordonné pour états lourds (savestates) et signaux
      const reliableDc = pc.createDataChannel('csw-reliable-channel', {
        ordered: true
      });
      this.reliableChannel = reliableDc;
      this.setupDataChannel(reliableDc);

      const callerCandidatesCol = collection(roomRef, 'callerCandidates');
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          addDoc(callerCandidatesCol, event.candidate.toJSON()).catch(() => {});
        }
      };

      pc.onconnectionstatechange = () => {
        console.log('[Netplay WebRTC Hôte] ConnectionState:', pc.connectionState);
        if (pc.connectionState === 'connected') {
          this.isP2PConnected = true;
          this.emit('p2p_connected');
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          this.isP2PConnected = false;
          this.emit('p2p_disconnected');
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await updateDoc(roomRef, {
        offer: { type: offer.type, sdp: offer.sdp }
      });

      // Écoute de l'answer de l'invité
      const unsubAnswer = onSnapshot(roomRef, async (snapshot) => {
        const d = snapshot.data();
        if (d?.answer && !pc.currentRemoteDescription) {
          console.log('[Netplay WebRTC Hôte] Réponse SDP reçue de l\'invité ! Établissement du tunnel...');
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(d.answer));
            isRemoteDescSet = true;
            while (pendingCandidates.length > 0) {
              const cand = pendingCandidates.shift();
              try { await pc.addIceCandidate(cand); } catch(e) {}
            }
          } catch(err) {
            console.warn('[Netplay WebRTC] Erreur remote description hôte:', err);
          }
        }
      });
      this.webrtcUnsubs.push(unsubAnswer);

      // Écoute des candidats ICE de l'invité avec mise en file d'attente sécurisée
      const calleeCandidatesCol = collection(roomRef, 'calleeCandidates');
      const unsubCallee = onSnapshot(calleeCandidatesCol, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
          if (change.type === 'added') {
            const cand = new RTCIceCandidate(change.doc.data());
            if (isRemoteDescSet && pc.remoteDescription) {
              try {
                await pc.addIceCandidate(cand);
              } catch (e) {}
            } else {
              pendingCandidates.push(cand);
            }
          }
        });
      });
      this.webrtcUnsubs.push(unsubCallee);
    } catch(err) {
      console.warn('[Netplay WebRTC] Erreur initialisation Hôte:', err);
    }
  }

  async setupWebRTCGuest(roomRef, offer) {
    try {
      this.closeWebRTC();
      const pc = new RTCPeerConnection(RTC_CONFIG);
      this.pc = pc;
      const pendingCandidates = [];
      let isRemoteDescSet = false;

      pc.ondatachannel = (event) => {
        const dc = event.channel;
        console.log(`[Netplay WebRTC Invité] DataChannel capté depuis l'hôte : ${dc.label}`);
        if (dc.label === 'csw-fast-inputs') {
          this.fastInputChannel = dc;
        } else {
          this.reliableChannel = dc;
        }
        this.setupDataChannel(dc);
      };

      const calleeCandidatesCol = collection(roomRef, 'calleeCandidates');
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          addDoc(calleeCandidatesCol, event.candidate.toJSON()).catch(() => {});
        }
      };

      pc.onconnectionstatechange = () => {
        console.log('[Netplay WebRTC Invité] ConnectionState:', pc.connectionState);
        if (pc.connectionState === 'connected') {
          this.isP2PConnected = true;
          this.emit('p2p_connected');
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          this.isP2PConnected = false;
          this.emit('p2p_disconnected');
        }
      };

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      isRemoteDescSet = true;
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await updateDoc(roomRef, {
        answer: { type: answer.type, sdp: answer.sdp }
      });

      // Vider les candidats qui ont pu arriver avant ou pendant le setLocalDescription
      while (pendingCandidates.length > 0) {
        const cand = pendingCandidates.shift();
        try { await pc.addIceCandidate(cand); } catch(e) {}
      }

      // Écoute des candidats ICE de l'hôte avec mise en file d'attente sécurisée
      const callerCandidatesCol = collection(roomRef, 'callerCandidates');
      const unsubCaller = onSnapshot(callerCandidatesCol, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
          if (change.type === 'added') {
            const cand = new RTCIceCandidate(change.doc.data());
            if (isRemoteDescSet && pc.remoteDescription) {
              try {
                await pc.addIceCandidate(cand);
              } catch (e) {}
            } else {
              pendingCandidates.push(cand);
            }
          }
        });
      });
      this.webrtcUnsubs.push(unsubCaller);
    } catch(err) {
      console.warn('[Netplay WebRTC] Erreur initialisation Invité:', err);
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
  async createRoom({ gameId, gameTitle, maxPlayers = 2, hostName = 'Hôte', networkMode = 'local', playMode = 'stream' }) {
    await this.connect();

    // Nettoyage immédiat de tout salon ouvert précédemment par cet hôte
    await this.cleanupPreviousRoom();

    // 1. Tenter le mode WebSocket LAN si disponible (serveur local)
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
            hostName,
            networkMode,
            playMode
          }));

          setTimeout(() => {
            this.off('room_created', onCreated);
            reject(new Error('Délai d\'attente création de salle LAN dépassé.'));
          }, 3000);
        });

        this.myActiveRoomCode = wsRes.roomCode;
        if (typeof localStorage !== 'undefined') {
          try { localStorage.setItem('csw_my_active_room', wsRes.roomCode); } catch(e) {}
        }

        // Toujours initialiser la liaison PeerJS P2P directe et la signalisation Ntfy
        this.setupPeerConnection(wsRes.roomCode, true, hostName);
        this.setupNtfySignaling(wsRes.roomCode, true);
        this.startLobbyAnnouncement();

        // Mirrorer immédiatement dans Firebase si quota disponible
        if (!this.isFirestoreQuotaExceeded) {
          try {
            const roomRef = doc(db, 'rooms', wsRes.roomCode);
            await setDoc(roomRef, {
              code: wsRes.roomCode,
              gameId,
              gameTitle,
              maxPlayers: wsRes.maxPlayers || maxPlayers,
              hostName,
              networkMode,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              players: [
                { name: hostName, slot: 1, isHost: true, playerIndex: 0, role: 'p1', ping: 5 }
              ],
              gameState: 'waiting',
              isLanBridged: true
            });

            // Setup WebRTC Host pour les connexions directes
            this.setupWebRTCHost(roomRef);

            // Écouter les joueurs distants
            if (this.firestoreUnsub) this.firestoreUnsub();
            let lastProcessedInputTime = 0;
            let lastProcessedStateReq = 0;

            this.firestoreUnsub = onSnapshot(roomRef, (snapshot) => {
              if (!snapshot.exists()) return;
              const data = snapshot.data();
              // Détection symétrique des inputs
              if (this.myPlayerIndex === 0 && data.lastInput && data.lastInput.playerIndex > 0 && data.lastInput.time !== lastProcessedInputTime) {
                lastProcessedInputTime = data.lastInput.time;
                this.handleMessage({
                  type: 'REMOTE_INPUT',
                  ...data.lastInput
                });
              }
              // Détection demande de savestate
              if (this.myPlayerIndex === 0 && data.stateRequest && data.stateRequest.time !== lastProcessedStateReq) {
                lastProcessedStateReq = data.stateRequest.time;
                this.handleMessage({
                  type: 'REQUEST_INITIAL_STATE',
                  fromPlayerIndex: data.stateRequest.fromPlayerIndex,
                  requestId: data.stateRequest.requestId
                });
              }
            });
          } catch(fbErr) {
            if (fbErr?.code === 'resource-exhausted' || fbErr?.message?.includes('Quota exceeded')) {
              this.isFirestoreQuotaExceeded = true;
            }
          }
        }

        return wsRes;
      } catch(err) {
        console.warn('[Netplay] Erreur/timeout LAN, basculement automatique sur Firebase Cloud:', err.message);
      }
    }

    // 2. Mode Firebase Cloud + WebRTC (Netlify / Internet / Même Wi-Fi sans serveur dédié)
    const res = await this.createFirebaseRoom({ gameId, gameTitle, maxPlayers, hostName, networkMode, playMode });
    if (res?.roomCode) {
      this.myActiveRoomCode = res.roomCode;
      if (typeof localStorage !== 'undefined') {
        try { localStorage.setItem('csw_my_active_room', res.roomCode); } catch(e) {}
      }
    }
    return res;
  }

  async createFirebaseRoom({ gameId, gameTitle, maxPlayers = 2, hostName = 'Hôte', networkMode = 'online', playMode = 'stream' }) {
    try {
      const roomCode = this.generateRoomCode();
      const initialRoom = {
        code: roomCode,
        gameId,
        gameTitle,
        maxPlayers,
        hostName,
        networkMode,
        playMode,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        players: [
          { name: hostName, slot: 1, isHost: true, playerIndex: 0, role: 'p1', ping: 5 }
        ],
        gameState: 'waiting',
        inputs: {}
      };

      this.currentRoom = initialRoom;
      this.myPlayerIndex = 0;
      this.myRole = 'p1';
      this.playerName = hostName;

      // 1. Initialiser le salon Hôte PeerJS (Zero Quota, Zero 429)
      this.setupPeerConnection(roomCode, true, hostName);

      // 2. Publier immédiatement le salon dans l'API de découverte Vercel / LAN
      try {
        fetch('/api/netplay/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'create', room: initialRoom })
        }).catch(() => {});
      } catch(e) {}

      // 3. Heartbeat périodique (toutes les 20s) pour garder le salon actif dans la liste des salons
      if (this.roomHeartbeatInterval) clearInterval(this.roomHeartbeatInterval);
      this.roomHeartbeatInterval = setInterval(() => {
        if (this.currentRoom && this.myPlayerIndex === 0) {
          fetch('/api/netplay/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              action: 'heartbeat', 
              roomCode: this.currentRoom.code,
              players: this.currentRoom.players,
              currentPlayers: (this.currentRoom.players || []).length
            })
          }).catch(() => {});
        } else {
          clearInterval(this.roomHeartbeatInterval);
          this.roomHeartbeatInterval = null;
        }
      }, 20000);

      // 4. Annonce et battement de cœur en temps réel sur le lobby global sans quota
      this.startLobbyAnnouncement();

      const resData = {
        roomCode,
        gameId,
        gameTitle,
        maxPlayers,
        hostName,
        role: 'p1',
        playerIndex: 0,
        players: initialRoom.players
      };

      this.emit('room_created', resData);
      console.log(`[Netplay Cloud] Salon ${roomCode} créé avec succès et publié dans la liste des salons !`);
      return resData;
    } catch(err) {
      console.error('[Netplay Cloud] Erreur création salon:', err);
      throw new Error('Échec de la création du salon : ' + err.message);
    }
  }

  // Rejoindre un salon avec un code (ex: ARC-74 ou 74)
  async joinRoom(roomCode, playerName = 'Invité') {
    await this.connect();
    this.playerName = playerName;
    let cleanCode = (roomCode || '').trim().toUpperCase();
    if (!cleanCode.startsWith('ARC-') && cleanCode.length <= 4) {
      cleanCode = `ARC-${cleanCode}`;
    }

    // 1. Mode WebSocket LAN si serveur local actif (ex: même réseau Wi-Fi avec serveur Node)
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
          }, 2500);
        });

        // Toujours initialiser la liaison PeerJS P2P en parallèle
        this.setupPeerConnection(cleanCode, false, playerName);
        return wsRes;
      } catch(err) {
        console.log('[Netplay] Salon non trouvé sur LAN ou timeout, essai immédiat sur Cloud / WebRTC...');
      }
    }

    // 2. Mode Cloud + WebRTC (Vercel / Netlify / Internet)
    this.myPlayerIndex = 1;
    this.myRole = 'p2';

    // Attente bloquante du véritable handshake HOST_WELCOME avec l'Hôte
    return new Promise((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error(`Délai dépassé (10s). Impossible de joindre l'hôte du salon ${cleanCode}. Vérifiez que le code est exact et que l'hôte a bien son salon ouvert.`));
        }
      }, 10000);

      const onSuccess = (data) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve(data);
        }
      };

      const onError = (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          cleanup();
          const msg = typeof err === 'string' ? err : (err?.message || 'Échec de connexion au salon');
          reject(new Error(msg));
        }
      };

      const cleanup = () => {
        this.off('joined_success', onSuccess);
        this.off('error', onError);
      };

      this.on('joined_success', onSuccess);
      this.on('error', onError);

      console.log(`[Netplay Cloud] Tentative de connexion directe P2P vers le salon ${cleanCode}...`);
      this.setupPeerConnection(cleanCode, false, playerName);
    });
  }

  // Envoyer un input (D-pad ou bouton) vers l'autre joueur avec redondance N-3
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

    // Format Binaire Ultra-Compact 9 octets (Zéro overhead JSON, 0 fragmentation UDP)
    // [0]   : 0xA5 (Magic Header)
    // [1-2] : seq 16 bits
    // [3]   : playerIndex & 0x03
    // [4]   : buttonId & 0x0F
    // [5]   : isPressed (1 ou 0)
    // [6-8] : Historique N-3 compacté ou 0xFF
    const binPacket = new Uint8Array(9);
    binPacket[0] = 0xA5;
    binPacket[1] = (this.localSeq >> 8) & 0xFF;
    binPacket[2] = this.localSeq & 0xFF;
    binPacket[3] = pIdx & 0x03;
    binPacket[4] = buttonId & 0x0F;
    binPacket[5] = isPressed ? 1 : 0;
    for (let i = 0; i < 3; i++) {
      const h = historyPayload[i];
      if (h) {
        binPacket[6 + i] = (h.buttonId & 0x0F) | (h.isPressed ? 0x80 : 0);
      } else {
        binPacket[6 + i] = 0xFF;
      }
    }

    // 0. PRIORITÉ ABSOLUE : PeerJS P2P (0 ms de latence, direct DataChannel sans quota)
    if (this.peerConn && this.peerConn.open) {
      try {
        this.peerConn.send({
          type: 'SEND_INPUT',
          playerIndex: pIdx,
          buttonId,
          isPressed: !!isPressed,
          frame: this.currentFrame,
          seq: this.localSeq,
          history: historyPayload
        });
        return;
      } catch(e) {}
    }

    // 1. Canal UDP rapide non ordonné sans retransmission
    const targetChannel = (this.fastInputChannel && this.fastInputChannel.readyState === 'open')
      ? this.fastInputChannel
      : (this.reliableChannel && this.reliableChannel.readyState === 'open' ? this.reliableChannel : null);

    if (targetChannel) {
      try {
        targetChannel.send(binPacket.buffer);
        return;
      } catch(e) {
        try {
          targetChannel.send(JSON.stringify({
            type: 'SEND_INPUT',
            playerIndex: pIdx,
            buttonId,
            isPressed: !!isPressed,
            frame: this.currentFrame,
            seq: this.localSeq,
            history: historyPayload
          }));
          return;
        } catch(e2) {}
      }
    }

    // 2. Mode WebSocket LAN
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

    // 3. Remarque : Zéro écriture Firestore pour les inputs (les inputs transitent exclusivement via P2P UDP ou WS LAN)
  }

  // Envoi de messages de contrôle fiables (P2P DataChannel, PeerJS ou WS LAN)
  sendControlMessage(payload) {
    if (this.peerConn && this.peerConn.open) {
      try {
        this.peerConn.send(payload);
        return true;
      } catch(e) {}
    }

    const targetChannel = (this.reliableChannel && this.reliableChannel.readyState === 'open')
      ? this.reliableChannel
      : (this.fastInputChannel && this.fastInputChannel.readyState === 'open' ? this.fastInputChannel : null);

    if (targetChannel) {
      try {
        targetChannel.send(JSON.stringify(payload));
        return true;
      } catch(e) {}
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentRoom) {
      try {
        this.ws.send(JSON.stringify(payload));
        return true;
      } catch(e) {}
    }

    return false;
  }

  // Barrière de synchronisation Frame 0 : Notification de fin de chargement du core
  notifyCoreReady() {
    this.localCoreReady = true;
    console.log(`[Netplay] Moteur local prêt pour J${this.myPlayerIndex + 1}. Signalement au pair...`);
    this.sendControlMessage({
      type: 'PEER_CORE_READY',
      fromPlayerIndex: this.myPlayerIndex
    });
    this.checkAndReleaseStartBarrier();

    // Sécurité : si après 5 secondes l'autre joueur n'a pas répondu, débloquer automatiquement
    if (this.startBarrierTimer) clearTimeout(this.startBarrierTimer);
    this.startBarrierTimer = setTimeout(() => {
      if (!this.remoteCoreReady) {
        console.warn('[Netplay] Timeout barrière : le second joueur tarde, déverrouillage de sécurité...');
        this.emit('start_simulation_now', { startTime: Date.now() });
      }
    }, 5000);
  }

  // Vérification et déblocage coordonné de la barrière de départ simultané
  checkAndReleaseStartBarrier() {
    const connectedPeerCount = this.connections ? Object.keys(this.connections).length : 0;
    const isSinglePlayer = !this.isP2PConnected && connectedPeerCount === 0 && (!this.currentRoom?.players || this.currentRoom.players.filter(Boolean).length <= 1);

    if (isSinglePlayer && this.localCoreReady) {
      if (this.startBarrierTimer) {
        clearTimeout(this.startBarrierTimer);
        this.startBarrierTimer = null;
      }
      console.log('[Netplay] Joueur seul dans le salon : déverrouillage immédiat de la Frame 0...');
      this.emit('start_simulation_now', { startTime: Date.now() });
      return;
    }

    // Seul l'hôte donne le top départ pour éviter tout conflit d'horodatage
    if (this.myPlayerIndex === 0 && this.localCoreReady && this.remoteCoreReady) {
      if (this.startBarrierTimer) {
        clearTimeout(this.startBarrierTimer);
        this.startBarrierTimer = null;
      }

      // Marge de synchronisation (60 ms) pour garantir que le paquet atteint l'invité avant la frame 0
      const startTime = Date.now() + 60;
      console.log('[Netplay] Barrière franchie ! Top départ Frame 0 synchronisé calé à', startTime);

      const startMsg = {
        type: 'START_SIMULATION_NOW',
        startTime
      };

      this.sendControlMessage(startMsg);

      const delay = Math.max(0, startTime - Date.now());
      setTimeout(() => {
        this.emit('start_simulation_now', startMsg);
      }, delay);
    }
  }

  // Autorité Dynamique du Survivant : demande flash de savestate au joueur actif
  requestSurvivorCatchup() {
    console.log(`[Netplay] Joueur J${this.myPlayerIndex + 1} demande le Flash-Savestate du survivant (Respawn/Crédit)...`);
    this.sendControlMessage({
      type: 'REQUEST_SURVIVOR_CATCHUP',
      fromPlayerIndex: this.myPlayerIndex
    });
  }

  // Demander la synchronisation de l'état (Guest -> Host)
  requestStateSync() {
    const payload = {
      type: 'REQUEST_STATE',
      fromPlayerIndex: this.myPlayerIndex
    };

    if (this.peerConn && this.peerConn.open) {
      try {
        this.peerConn.send(payload);
        return;
      } catch(e) {}
    }

    const targetChannel = (this.reliableChannel && this.reliableChannel.readyState === 'open')
      ? this.reliableChannel
      : (this.fastInputChannel && this.fastInputChannel.readyState === 'open' ? this.fastInputChannel : null);

    if (targetChannel) {
      try {
        targetChannel.send(JSON.stringify(payload));
        return;
      } catch(e) {}
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentRoom) {
      this.ws.send(JSON.stringify(payload));
      return;
    }

    if (!this.isFirestoreQuotaExceeded && this.currentRoom?.code) {
      try {
        const roomRef = doc(db, 'rooms', this.currentRoom.code);
        updateDoc(roomRef, {
          stateRequest: {
            fromPlayerIndex: this.myPlayerIndex,
            time: Date.now()
          }
        }).catch((e) => {
          if (e?.code === 'resource-exhausted' || e?.message?.includes('Quota exceeded')) {
            this.isFirestoreQuotaExceeded = true;
          }
        });
      } catch(e) {}
    }
  }

  // Envoyer l'état sérialisé (Host -> Guest)
  sendStateSync(payload, toPlayerIndex = undefined) {
    const isObj = payload && typeof payload === 'object' && ('stateBase64' in payload);
    const stateBase64 = isObj ? payload.stateBase64 : (typeof payload === 'string' ? payload : null);
    const stateSize = isObj ? payload.stateSize : 0;
    const isHeartbeat = !!(isObj && payload.isHeartbeat);
    const stateData = !isObj ? payload : null;

    const syncMsg = {
      type: 'SYNC_STATE',
      fromPlayerIndex: this.myPlayerIndex,
      toPlayerIndex,
      stateBase64,
      stateSize,
      stateData,
      isHeartbeat,
      time: Date.now()
    };

    // 0. Priorité PeerJS P2P Direct
    if (this.peerConn && this.peerConn.open) {
      try {
        this.peerConn.send(syncMsg);
        return;
      } catch(e) {}
    }

    // 1. Envoi direct via le canal fiable ordonné WebRTC DataChannel (avec chunking à 32 Ko)
    const targetStateChannel = (this.reliableChannel && this.reliableChannel.readyState === 'open')
      ? this.reliableChannel
      : (this.fastInputChannel && this.fastInputChannel.readyState === 'open' ? this.fastInputChannel : null);

    if (targetStateChannel) {
      try {
        if (stateBase64 && stateBase64.length > 32768) {
          const CHUNK_SIZE = 32768;
          const totalChunks = Math.ceil(stateBase64.length / CHUNK_SIZE);
          const transferId = 'sync_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
          for (let i = 0; i < totalChunks; i++) {
            const chunk = stateBase64.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            targetStateChannel.send(JSON.stringify({
              type: 'STATE_CHUNK',
              transferId,
              chunkIndex: i,
              totalChunks,
              chunk,
              stateSize,
              fromPlayerIndex: this.myPlayerIndex,
              toPlayerIndex,
              isHeartbeat,
              time: syncMsg.time
            }));
          }
        } else {
          targetStateChannel.send(JSON.stringify(syncMsg));
        }
        return;
      } catch(e) {
        console.warn('[Netplay] Erreur envoi state WebRTC:', e);
      }
    }

    // 2. Mode WebSocket LAN
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentRoom) {
      this.ws.send(JSON.stringify({
        type: 'SEND_STATE',
        ...syncMsg
      }));
      return;
    }

    // 3. Fallback Firestore (Uniquement pour le savestate initial à froid si quota disponible)
    if (!this.isFirestoreQuotaExceeded && !isHeartbeat && this.currentRoom?.code) {
      try {
        const roomRef = doc(db, 'rooms', this.currentRoom.code);
        updateDoc(roomRef, {
          stateSync: syncMsg
        }).catch((e) => {
          if (e?.code === 'resource-exhausted' || e?.message?.includes('Quota exceeded')) {
            this.isFirestoreQuotaExceeded = true;
          }
        });
      } catch(e) {}
    }
  }

  // Lancer la partie en tant qu'hôte
  startGame(game = null, options = {}) {
    const gameId = game?.id || this.currentRoom?.gameId;
    const gameTitle = game?.title || this.currentRoom?.gameTitle;
    const playMode = options.playMode || this.currentRoom?.playMode || 'stream';
    const startPayload = {
      type: 'GAME_STARTED_BY_HOST',
      gameId,
      gameTitle,
      playMode,
      timestamp: Date.now()
    };

    // 0. Priorité PeerJS P2P (Zéro quota, connexion directe)
    if (this.peerConn && this.peerConn.open) {
      try {
        this.peerConn.send(startPayload);
        // Émission de sécurité redondante pour garantir la réception immédiate
        setTimeout(() => {
          try {
            if (this.peerConn && this.peerConn.open) {
              this.peerConn.send(startPayload);
            }
          } catch(e) {}
        }, 60);
        console.log('[Netplay PeerJS] Ordre de démarrage transmis avec succès à l\'invité !');
      } catch(e) {
        console.warn('[Netplay PeerJS] Erreur envoi START_GAME:', e);
      }
    }

    // 1. WebRTC DataChannels P2P natifs
    const targetChannel = (this.reliableChannel && this.reliableChannel.readyState === 'open')
      ? this.reliableChannel
      : (this.fastInputChannel && this.fastInputChannel.readyState === 'open' ? this.fastInputChannel : null);

    if (targetChannel) {
      try {
        targetChannel.send(JSON.stringify(startPayload));
      } catch(e) {}
    }

    // 2. Mode WebSocket LAN
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(startPayload));
    }
  }

  // Lancement du flux vidéo P2P vers l'invité (Mode Remote Play Stream 60 FPS)
  startVideoStream(stream) {
    if (stream) {
      this.localVideoStream = stream;
    }
    const targetStream = stream || this.localVideoStream;
    if (!this.peer || !this.remotePeerId || !targetStream) {
      console.warn('[Netplay PeerJS] Impossible de lancer le stream : peer, remotePeerId ou stream manquant', {
        hasPeer: !!this.peer,
        remotePeerId: this.remotePeerId,
        hasStream: !!targetStream
      });
      return;
    }

    const videoTracks = targetStream.getVideoTracks();
    console.log('[Netplay PeerJS] Lancement de l\'appel vidéo WebRTC P2P vers l\'invité :', this.remotePeerId, 'Pistes vidéo:', videoTracks.length);

    try {
      if (this.currentMediaCall) {
        try { this.currentMediaCall.close(); } catch(e) {}
        this.currentMediaCall = null;
      }

      const call = this.peer.call(this.remotePeerId, targetStream);
      this.currentMediaCall = call;
      call.on('error', (err) => console.warn('[Netplay PeerJS] Erreur media call:', err));
    } catch(e) {
      console.warn('[Netplay PeerJS] Erreur startVideoStream:', e);
    }
  }

  // Demander à l'hôte d'envoyer son flux vidéo
  requestVideoStream() {
    console.log('[Netplay] Envoi de la demande de flux vidéo vers l\'hôte...');
    const req = { 
      type: 'REQUEST_VIDEO_STREAM', 
      peerId: this.peer?.id,
      timestamp: Date.now() 
    };
    if (this.peerConn && this.peerConn.open) {
      try { this.peerConn.send(req); } catch(e) {}
    }
    const targetChannel = (this.reliableChannel && this.reliableChannel.readyState === 'open')
      ? this.reliableChannel
      : (this.fastInputChannel && this.fastInputChannel.readyState === 'open' ? this.fastInputChannel : null);
    if (targetChannel) {
      try { targetChannel.send(JSON.stringify(req)); } catch(e) {}
    }
  }

  // Envoi d'un paquet binaire ultra-léger (Rollback Inputs 0x5A / Checksums 0xCB / NetplaySyncEngine)
  sendBinary(buffer) {
    // Simulateur Réseau : Perte artificielle de paquets UDP
    if (this.networkSimulator.packetLoss > 0) {
      if (Math.random() * 100 < this.networkSimulator.packetLoss) {
        return; // Paquet délibérément abandonné
      }
    }

    const doSend = () => {
      // 0. Priorité DataChannel matériel WebRTC si direct
      if (this.peerConn?.dataChannel && this.peerConn.dataChannel.readyState === 'open') {
        try {
          this.peerConn.dataChannel.send(buffer);
          return;
        } catch(e) {}
      }

      // 1. PeerJS P2P avec encodage universel garanti
      if (this.peerConn && this.peerConn.open) {
        try {
          if (buffer && buffer.byteLength >= 15) {
            const v = (buffer instanceof DataView) ? buffer : new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer.byteOffset || 0, buffer.byteLength);
            if (v.getUint8(0) === 0x5A) {
              this.peerConn.send({
                type: 'ROLLBACK_FRAME_DATA',
                seq: v.getUint16(1, false),
                frame: v.getUint32(3, false),
                curMask: v.getUint16(7, false),
                h1: v.getUint16(9, false),
                h2: v.getUint16(11, false),
                h3: v.getUint16(13, false)
              });
              return;
            }
          }
          if (buffer && buffer.byteLength === 9) {
            const v = (buffer instanceof DataView) ? buffer : new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer.byteOffset || 0, buffer.byteLength);
            if (v.getUint8(0) === 0xCB) {
              this.peerConn.send({
                type: 'ROLLBACK_CHECKSUM',
                frame: v.getUint32(1, false),
                checksum: v.getUint32(5, false)
              });
              return;
            }
          }
          this.peerConn.send(buffer);
          return;
        } catch(e) {}
      }

      const targetChannel = (this.fastInputChannel && this.fastInputChannel.readyState === 'open')
        ? this.fastInputChannel
        : (this.reliableChannel && this.reliableChannel.readyState === 'open' ? this.reliableChannel : null);
      if (targetChannel) {
        try {
          targetChannel.send(buffer);
        } catch(e) {}
      }
    };

    // Simulateur Réseau : Latence et jitter artificiels
    if (this.networkSimulator.latency > 0) {
      const jitterOffset = this.networkSimulator.jitter > 0
        ? (Math.random() * 2 - 1) * this.networkSimulator.jitter
        : 0;
      const totalDelay = Math.max(0, this.networkSimulator.latency + jitterOffset);
      setTimeout(doSend, totalDelay);
    } else {
      doSend();
    }
  }

  // Quitter le salon actuel
  leaveRoom() {
    const isHost = this.myPlayerIndex === 0;
    const leaveMsg = {
      type: isHost ? 'HOST_DISCONNECTED' : 'PEER_LEFT',
      playerIndex: this.myPlayerIndex,
      message: isHost ? "L'hôte a quitté la partie." : "L'autre joueur a quitté la partie."
    };

    if (this.roomHeartbeatInterval) {
      clearInterval(this.roomHeartbeatInterval);
      this.roomHeartbeatInterval = null;
    }

    // Stopper le battement de cœur du lobby global
    this.stopLobbyAnnouncement();

    // Fermer le salon dans l'API des salons Vercel / LAN
    if (isHost && this.currentRoom?.code) {
      try {
        fetch('/api/netplay/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'close', roomCode: this.currentRoom.code })
        }).catch(() => {});
      } catch(e) {}
    }

    // 0. PeerJS P2P
    if (this.peerConn && this.peerConn.open) {
      try { this.peerConn.send(leaveMsg); } catch(e) {}
    }
    this.closePeer();

    // 1. WebRTC DataChannels
    const targetChannel = (this.reliableChannel && this.reliableChannel.readyState === 'open')
      ? this.reliableChannel
      : (this.fastInputChannel && this.fastInputChannel.readyState === 'open' ? this.fastInputChannel : null);

    if (targetChannel) {
      try {
        targetChannel.send(JSON.stringify(leaveMsg));
      } catch(e) {}
    }

    // 2. WS LAN
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentRoom) {
      try {
        this.ws.send(JSON.stringify(leaveMsg));
      } catch(e) {}
    }

    this.closeWebRTC();

    if (this.firestoreUnsub) {
      this.firestoreUnsub();
      this.firestoreUnsub = null;
    }

    if (isHost) {
      this.myActiveRoomCode = null;
      if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem('csw_my_active_room'); } catch(e) {}
      }
    }

    this.currentRoom = null;
    this.myPlayerIndex = -1;
    this.myRole = null;
    this.localCoreReady = false;
    this.remoteCoreReady = false;
    if (this.startBarrierTimer) {
      clearTimeout(this.startBarrierTimer);
      this.startBarrierTimer = null;
    }
    this.emit('left_room');
  }

  // Récupérer la liste des salons actifs (Vercel API, LAN ou Cloud)
  async fetchRooms() {
    const combined = new Map();
    const now = Date.now();

    // 1. API des salons (/api/netplay/rooms - Vercel Serverless & Vite LAN)
    try {
      const res = await fetch('/api/netplay/rooms');
      if (res.ok) {
        const data = await res.json();
        if (data.rooms && Array.isArray(data.rooms)) {
          data.rooms.forEach(r => {
            if (r && r.code) combined.set(r.code, r);
          });
        }
      }
    } catch(e) {}

    // 2. Récupérer les salons découverts en temps réel via Ntfy Global Lobby (Zéro Quota, Instantané)
    this.sendNtfySignal('csw-arcade-global-lobby', { type: 'QUERY_ROOMS' });

    for (const [code, r] of this.discoveredRooms.entries()) {
      // Purge automatique : si le salon n'a pas émis de battement de cœur depuis plus de 25s (onglet fermé)
      if (r.lastSeen && (now - r.lastSeen > 25000)) {
        this.discoveredRooms.delete(code);
      } else if (!combined.has(code)) {
        combined.set(code, {
          code: r.code,
          gameId: r.gameId,
          gameTitle: r.gameTitle,
          maxPlayers: r.maxPlayers || 2,
          currentPlayers: r.currentPlayers || (r.players ? r.players.length : 1),
          players: r.players || [],
          networkMode: r.networkMode || 'online',
          createdAt: r.createdAt || now
        });
      }
    }

    // 3. Fallback Firestore avec timeout strict de 400ms (silencieux si quota dépassé)
    try {
      const snap = await Promise.race([
        getDocs(collection(db, 'rooms')),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 400))
      ]);

      if (snap && snap.forEach) {
        snap.forEach(docSnap => {
          const d = docSnap.data();
          if (!d || !d.code) return;

          const age = now - (d.createdAt || 0);
          const lastActive = now - (d.updatedAt || d.createdAt || 0);
          const playersCount = (d.players || []).length;
          const isClosed = d.gameState === 'closed' || d.gameState === 'finished';

          // NETTOYAGE : Si le salon est fermé, n'a plus de joueur, ou est inactif depuis plus de 10 min
          if (isClosed || playersCount === 0 || lastActive > 10 * 60 * 1000 || age > 30 * 60 * 1000) {
            deleteDoc(doc(db, 'rooms', d.code)).catch(() => {});
            return;
          }

          if (!combined.has(d.code)) {
            combined.set(d.code, {
              code: d.code,
              gameId: d.gameId,
              gameTitle: d.gameTitle,
              maxPlayers: d.maxPlayers || 2,
              currentPlayers: playersCount,
              players: d.players || [],
              networkMode: d.networkMode || 'online',
              createdAt: d.createdAt || now
            });
          }
        });
      }
    } catch(err) {
      // Ignorer silencieusement si quota Firebase épuisé
    }

    // Le dernier salon créé doit être en haut (tri par createdAt décroissant)
    const list = Array.from(combined.values());
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return list;
  }
}

export const netplayService = new NetplayService();
