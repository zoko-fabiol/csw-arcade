// Service universel pour le multijoueur CSW-Arcade (Hybride WebSocket LAN & WebRTC P2P / Firebase Cloud)
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
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    // Serveurs TURN publics gratuits pour traverser les NAT symétriques, 4G/5G et pare-feux à distance
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
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

    // --- WebRTC P2P DataChannel ---
    this.pc = null;
    this.webrtcChannel = null;
    this.webrtcUnsubs = [];
    this.webrtcPingInterval = null;
    this.isP2PConnected = false;

    // --- REDONDANCE N-3 & FLUX GGPO ---
    this.localSeq = 0;
    this.currentFrame = 0;
    this.inputHistory = []; // [ { seq, frame, buttonId, isPressed, playerIndex } ]
    this.lastRemoteSeq = new Map(); // playerIndex -> last received seq
    this.incomingStateChunks = new Map(); // transferId -> { chunks, receivedCount, totalChunks, isHeartbeat }
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
      (window.location.protocol === 'https:' && !window.location.hostname.match(/^(localhost|127\.0\.0\.1|192\.168\.|10\.)/))
    );

    if (isNetlify) {
      console.log('[Netplay] Environnement Cloud / Netlify détecté : activation du mode WebRTC + Firebase Cloud');
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
    }
  }

  // --- GESTION DU CANAL WEBRTC DATACHANNEL P2P ---
  closeWebRTC() {
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
    if (this.webrtcChannel) {
      try {
        this.webrtcChannel.onopen = null;
        this.webrtcChannel.onclose = null;
        this.webrtcChannel.onerror = null;
        this.webrtcChannel.onmessage = null;
        if (this.webrtcChannel.readyState !== 'closed') {
          this.webrtcChannel.close();
        }
      } catch(e) {}
      this.webrtcChannel = null;
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

  setupDataChannel(dc) {
    dc.onopen = () => {
      console.log(`[Netplay WebRTC] ✓ DataChannel '${dc.label}' OUVERT ! Connexion P2P directe active (0 ms latence interne).`);
      this.isP2PConnected = true;
      this.emit('p2p_connected');

      // Mesure du RTT P2P
      if (this.webrtcPingInterval) clearInterval(this.webrtcPingInterval);
      this.webrtcPingInterval = setInterval(() => {
        if (dc.readyState === 'open') {
          try {
            dc.send(JSON.stringify({ type: 'PING', clientTime: Date.now() }));
          } catch(e) {}
        }
      }, 2000);
    };

    dc.onclose = () => {
      console.log(`[Netplay WebRTC] DataChannel '${dc.label}' FERMÉ.`);
      this.isP2PConnected = false;
      if (this.webrtcPingInterval) clearInterval(this.webrtcPingInterval);
      if (this.currentRoom) {
        this.emit('peer_left', { message: "Connexion P2P fermée ou perdue avec l'autre joueur." });
      }
    };

    dc.onerror = (err) => {
      console.warn('[Netplay WebRTC] Erreur DataChannel:', err);
    };

    dc.onmessage = (event) => {
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
            this.emit('ping', this.ping);
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

      // Création du DataChannel bidirectionnel ordonné pour garantir l'ordre des touches et savestates
      const dc = pc.createDataChannel('csw-arcade-netplay', {
        ordered: true
      });
      this.webrtcChannel = dc;
      this.setupDataChannel(dc);

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
        console.log('[Netplay WebRTC Invité] DataChannel capté depuis l\'hôte !');
        this.webrtcChannel = event.channel;
        this.setupDataChannel(event.channel);
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
  async createRoom({ gameId, gameTitle, maxPlayers = 2, hostName = 'Hôte', networkMode = 'local' }) {
    await this.connect();

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
            networkMode
          }));

          setTimeout(() => {
            this.off('room_created', onCreated);
            reject(new Error('Délai d\'attente création de salle LAN dépassé.'));
          }, 3000);
        });

        // Mirrorer immédiatement dans Firebase pour que les amis sur le même Wi-Fi ou à distance puissent se joindre
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
          console.warn('[Netplay] Mirroring Firestore facultatif ignoré:', fbErr.message);
        }

        return wsRes;
      } catch(err) {
        console.warn('[Netplay] Erreur/timeout LAN, basculement automatique sur Firebase Cloud:', err.message);
      }
    }

    // 2. Mode Firebase Cloud + WebRTC (Netlify / Internet / Même Wi-Fi sans serveur dédié)
    return this.createFirebaseRoom({ gameId, gameTitle, maxPlayers, hostName, networkMode });
  }

  async createFirebaseRoom({ gameId, gameTitle, maxPlayers = 2, hostName = 'Hôte', networkMode = 'local' }) {
    try {
      const roomCode = this.generateRoomCode();
      const initialRoom = {
        code: roomCode,
        gameId,
        gameTitle,
        maxPlayers,
        hostName,
        networkMode,
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

      // Initialiser l'hôte WebRTC P2P direct
      this.setupWebRTCHost(roomRef);

      // Écoute en temps réel des changements de joueurs et des inputs
      if (this.firestoreUnsub) this.firestoreUnsub();
      let lastProcessedInputTime = 0;
      let lastProcessedStateReq = 0;
      let lastProcessedStateSync = 0;

      this.firestoreUnsub = onSnapshot(roomRef, (snapshot) => {
        if (!snapshot.exists()) {
          this.emit('host_disconnected', 'Le salon a été fermé.');
          return;
        }
        const data = snapshot.data();
        this.currentRoom = data;
        this.emit('room_update', data);

        // SYMETRIQUE : Détection des inputs distants pour l'hôte (venant du joueur 2)
        if (this.myPlayerIndex === 0 && data.lastInput && data.lastInput.playerIndex > 0 && data.lastInput.time !== lastProcessedInputTime) {
          lastProcessedInputTime = data.lastInput.time;
          this.handleMessage({
            type: 'REMOTE_INPUT',
            ...data.lastInput
          });
        }

        // Détection demande de savestate (Bidirectionnel : J2 demande l'état à J1)
        if (data.stateRequest && data.stateRequest.fromPlayerIndex !== this.myPlayerIndex && data.stateRequest.time !== lastProcessedStateReq) {
          lastProcessedStateReq = data.stateRequest.time;
          this.emit('request_state', data.stateRequest);
        }

        // Réception du savestate envoyé par J2 vers J1 (Bidirectionnel : J2 -> J1)
        if (data.stateSync && (data.stateSync.toPlayerIndex === undefined || data.stateSync.toPlayerIndex === 0) && data.stateSync.fromPlayerIndex !== 0 && data.stateSync.time !== lastProcessedStateSync) {
          lastProcessedStateSync = data.stateSync.time;
          this.emit('sync_state', data.stateSync);
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
      console.log(`[Netplay Cloud] Salon ${roomCode} créé avec succès (WebRTC P2P prêt) !`);
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

    // 1. Mode WebSocket LAN si serveur local actif
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

        // Mirroring / écoute Firebase en parallèle pour la synchronisation WebRTC
        try {
          const roomRef = doc(db, 'rooms', cleanCode);
          const snap = await getDoc(roomRef);
          if (snap.exists()) {
            const data = snap.data();
            if (data.offer) {
              this.setupWebRTCGuest(roomRef, data.offer);
            }
          }
        } catch(e) {}

        return wsRes;
      } catch(err) {
        console.log('[Netplay] Salon non trouvé sur LAN ou timeout, essai immédiat sur Firebase Cloud / WebRTC...');
      }
    }

    // 2. Mode Firebase Cloud + WebRTC (Netlify / Internet / Même Wi-Fi)
    try {
      const roomRef = doc(db, 'rooms', cleanCode);
      const snap = await getDoc(roomRef);

      if (!snap.exists()) {
        throw new Error(`Le salon ${cleanCode} n'existe pas ou est fermé.`);
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
      let lastProcessedInputTime = 0;
      let lastProcessedStateSync = 0;
      let lastProcessedStateReq = 0;

      this.firestoreUnsub = onSnapshot(roomRef, (snapshot) => {
        if (!snapshot.exists()) {
          this.emit('host_disconnected', 'Le salon a été fermé.');
          return;
        }
        const data = snapshot.data();
        this.currentRoom = data;
        this.emit('room_update', data);

        // Détection du démarrage du match par l'hôte
        if (data.gameState === 'started') {
          this.emit('game_started_by_host', data);
        }

        // SYMETRIQUE : Si un input arrive depuis le Cloud pour l'invité (venant de l'hôte J1)
        if (data.lastInput && data.lastInput.playerIndex !== this.myPlayerIndex && data.lastInput.time !== lastProcessedInputTime) {
          lastProcessedInputTime = data.lastInput.time;
          this.handleMessage({
            type: 'REMOTE_INPUT',
            ...data.lastInput
          });
        }

        // Réception d'une demande de savestate (Bidirectionnel : J1 demande l'état à J2)
        if (data.stateRequest && data.stateRequest.fromPlayerIndex !== this.myPlayerIndex && data.stateRequest.time !== lastProcessedStateReq) {
          lastProcessedStateReq = data.stateRequest.time;
          this.emit('request_state', data.stateRequest);
        }

        // Réception du savestate envoyé par l'hôte via Firebase (J1 -> J2)
        if (data.stateSync && (data.stateSync.toPlayerIndex === undefined || data.stateSync.toPlayerIndex === this.myPlayerIndex) && data.stateSync.fromPlayerIndex !== this.myPlayerIndex && data.stateSync.time !== lastProcessedStateSync) {
          lastProcessedStateSync = data.stateSync.time;
          this.emit('sync_state', data.stateSync);
        }
      });

      // Lancement WebRTC Guest
      if (roomData.offer) {
        this.setupWebRTCGuest(roomRef, roomData.offer);
      } else {
        const unsubOffer = onSnapshot(roomRef, (snapshot) => {
          const d = snapshot.data();
          if (d?.offer && !this.pc) {
            unsubOffer();
            this.setupWebRTCGuest(roomRef, d.offer);
          }
        });
        this.webrtcUnsubs.push(unsubOffer);
      }

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

    const payloadObj = {
      type: 'SEND_INPUT',
      playerIndex: pIdx,
      buttonId,
      isPressed: !!isPressed,
      frame: this.currentFrame,
      seq: this.localSeq,
      history: historyPayload
    };

    // 1. PRIORITÉ ABSOLUE : WebRTC DataChannel P2P direct (<20ms)
    if (this.webrtcChannel && this.webrtcChannel.readyState === 'open') {
      try {
        this.webrtcChannel.send(JSON.stringify(payloadObj));
      } catch(e) {}
      return;
    }

    // 2. Mode WebSocket LAN
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentRoom) {
      this.ws.send(JSON.stringify(payloadObj));
      return;
    }

    // 3. Fallback Firebase Cloud (Bidirectionnel)
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
    const payload = {
      type: 'REQUEST_STATE',
      fromPlayerIndex: this.myPlayerIndex
    };

    if (this.webrtcChannel && this.webrtcChannel.readyState === 'open') {
      try {
        this.webrtcChannel.send(JSON.stringify(payload));
        return;
      } catch(e) {}
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentRoom) {
      this.ws.send(JSON.stringify(payload));
      return;
    }

    if (this.currentRoom?.code) {
      try {
        const roomRef = doc(db, 'rooms', this.currentRoom.code);
        updateDoc(roomRef, {
          stateRequest: {
            fromPlayerIndex: this.myPlayerIndex,
            time: Date.now()
          }
        }).catch(() => {});
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

    // 1. Envoi direct ultra-rapide via WebRTC DataChannel (avec chunking de sécurité à 32 Ko)
    if (this.webrtcChannel && this.webrtcChannel.readyState === 'open') {
      try {
        if (stateBase64 && stateBase64.length > 32768) {
          const CHUNK_SIZE = 32768;
          const totalChunks = Math.ceil(stateBase64.length / CHUNK_SIZE);
          const transferId = 'sync_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
          for (let i = 0; i < totalChunks; i++) {
            const chunk = stateBase64.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            this.webrtcChannel.send(JSON.stringify({
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
          this.webrtcChannel.send(JSON.stringify(syncMsg));
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

    // 3. Fallback Firestore (Uniquement pour le savestate initial à froid, JAMAIS pour les heartbeats périodiques)
    if (!isHeartbeat && this.currentRoom?.code) {
      try {
        const roomRef = doc(db, 'rooms', this.currentRoom.code);
        updateDoc(roomRef, {
          stateSync: syncMsg
        }).catch(() => {});
      } catch(e) {}
    }
  }

  // Lancer la partie en tant qu'hôte
  startGame() {
    const startMsg = {
      type: 'START_GAME',
      gameId: this.currentRoom?.gameId,
      gameTitle: this.currentRoom?.gameTitle
    };

    if (this.webrtcChannel && this.webrtcChannel.readyState === 'open') {
      try {
        this.webrtcChannel.send(JSON.stringify(startMsg));
      } catch(e) {}
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(startMsg));
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
    const isHost = this.myPlayerIndex === 0;
    const leaveMsg = {
      type: isHost ? 'HOST_DISCONNECTED' : 'PEER_LEFT',
      playerIndex: this.myPlayerIndex,
      message: isHost ? "L'hôte a quitté la partie." : "L'autre joueur a quitté la partie."
    };

    if (this.webrtcChannel && this.webrtcChannel.readyState === 'open') {
      try {
        this.webrtcChannel.send(JSON.stringify(leaveMsg));
      } catch(e) {}
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentRoom) {
      try {
        this.ws.send(JSON.stringify(leaveMsg));
      } catch(e) {}
    }

    if (this.currentRoom?.code) {
      try {
        const roomRef = doc(db, 'rooms', this.currentRoom.code);
        if (isHost) {
          deleteDoc(roomRef).catch(() => {});
        } else {
          const remaining = (this.currentRoom.players || []).filter(p => p.playerIndex !== this.myPlayerIndex);
          updateDoc(roomRef, { 
            players: remaining,
            lastEvent: { type: 'PEER_LEFT', playerIndex: this.myPlayerIndex, time: Date.now() }
          }).catch(() => {});
        }
      } catch(e) {}
    }

    this.closeWebRTC();

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

    // 1. Tenter l'API locale LAN si sur serveur dev
    try {
      const res = await fetch('/api/netplay/rooms');
      if (res.ok) {
        const data = await res.json();
        if (data.rooms && Array.isArray(data.rooms)) {
          data.rooms.forEach(r => combined.set(r.code, r));
        }
      }
    } catch(e) {}

    // 2. Récupération Cloud Firebase (Salons créés sur Netlify ou distants)
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
