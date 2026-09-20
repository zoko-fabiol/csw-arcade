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
    { urls: 'stun:stun.metered.ca:80' },
    // Serveurs TURN pour traverser les CGNAT mobiles (Orange, MTN, Camtel) & pare-feux
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

    // --- REDONDANCE N-3 & FLUX GGPO ---
    this.localSeq = 0;
    this.currentFrame = 0;
    this.inputHistory = []; // [ { seq, frame, buttonId, isPressed, playerIndex } ]
    this.lastRemoteSeq = new Map(); // playerIndex -> last received seq
    this.incomingStateChunks = new Map(); // transferId -> { chunks, receivedCount, totalChunks, isHeartbeat }
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
    if (this.ntfyWs) {
      try { this.ntfyWs.close(); } catch(e) {}
      this.ntfyWs = null;
    }
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
    const cleanCode = roomCode.trim().toLowerCase();
    const topic = `csw-arcade-${cleanCode}`;
    this.currentTopic = topic;
    this.pendingNtfyCandidates = [];

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
            console.log('[Netplay P2P] Invité détecté dans le salon !');
            if (this.currentRoom) {
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
            }
            this.setupWebRTCHostNtfy(topic);
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
        headers: { 'Content-Type': 'application/json' },
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

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendNtfySignal(topic, {
            type: 'ICE_CANDIDATE',
            candidate: event.candidate.toJSON()
          });
        }
      };

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

      this.sendNtfySignal(topic, {
        type: 'WEBRTC_OFFER',
        offer: { type: offer.type, sdp: offer.sdp }
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

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendNtfySignal(topic, {
            type: 'ICE_CANDIDATE',
            candidate: event.candidate.toJSON()
          });
        }
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
      while (this.pendingNtfyCandidates && this.pendingNtfyCandidates.length > 0) {
        const c = this.pendingNtfyCandidates.shift();
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e) {}
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.sendNtfySignal(topic, {
        type: 'WEBRTC_ANSWER',
        answer: { type: answer.type, sdp: answer.sdp }
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
      // 1. Décodage binaire ultra-rapide 9 octets (Zero garbage collection, latence minimale)
      if (event.data instanceof ArrayBuffer) {
        const u8 = new Uint8Array(event.data);
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

      this.currentRoom = initialRoom;
      this.myPlayerIndex = 0;
      this.myRole = 'p1';

      // 1. Initialiser IMMÉDIATEMENT le relais de signalisation P2P sans quota (ntfy.sh WebSocket)
      this.setupNtfySignaling(roomCode, true);

      // 2. Tenter Firestore en arrière-plan (sans bloquer ni crasher si quota dépassé ou hors-ligne)
      try {
        const roomRef = doc(db, 'rooms', roomCode);
        await setDoc(roomRef, initialRoom);

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

          // Détection demande de savestate
          if (data.stateRequest && data.stateRequest.fromPlayerIndex !== this.myPlayerIndex && data.stateRequest.time !== lastProcessedStateReq) {
            lastProcessedStateReq = data.stateRequest.time;
            this.emit('request_state', data.stateRequest);
          }

          // Réception du savestate
          if (data.stateSync && (data.stateSync.toPlayerIndex === undefined || data.stateSync.toPlayerIndex === 0) && data.stateSync.fromPlayerIndex !== 0 && data.stateSync.time !== lastProcessedStateSync) {
            lastProcessedStateSync = data.stateSync.time;
            this.emit('sync_state', data.stateSync);
          }
        }, (err) => {
          console.warn('[Netplay Cloud] Listener Firestore désactivé (quota ou hors-ligne):', err.message);
        });
      } catch(fbErr) {
        console.warn('[Netplay Cloud] Firestore indisponible ou quota dépassé, basculement automatique WebRTC P2P direct (Zéro Quota):', fbErr.message);
      }

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
      console.error('[Netplay Cloud] Erreur création salon:', err);
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

        return wsRes;
      } catch(err) {
        console.log('[Netplay] Salon non trouvé sur LAN ou timeout, essai immédiat sur Cloud / WebRTC...');
      }
    }

    // 2. Mode Cloud + WebRTC (Netlify / Internet / Même Wi-Fi)
    let joinedRoomData = null;
    let playerIndex = 1;
    let role = 'p2';

    // Tenter Firestore si disponible
    try {
      const roomRef = doc(db, 'rooms', cleanCode);
      const snap = await getDoc(roomRef);

      if (snap.exists()) {
        const roomData = snap.data();
        const currentPlayers = roomData.players || [];

        if (currentPlayers.length >= roomData.maxPlayers) {
          throw new Error(`Le salon ${cleanCode} est complet (${roomData.maxPlayers}/${roomData.maxPlayers}).`);
        }

        playerIndex = currentPlayers.length;
        role = `p${playerIndex + 1}`;
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
        }).catch(() => {});

        joinedRoomData = { ...roomData, players: updatedPlayers };

        // Lancement WebRTC Guest standard Firestore si offer déjà présent
        if (roomData.offer) {
          this.setupWebRTCGuest(roomRef, roomData.offer);
        } else {
          const unsubOffer = onSnapshot(roomRef, (snapshot) => {
            const d = snapshot.data();
            if (d?.offer && !this.pc) {
              unsubOffer();
              this.setupWebRTCGuest(roomRef, d.offer);
            }
          }, () => {});
          this.webrtcUnsubs.push(unsubOffer);
        }

        if (this.firestoreUnsub) this.firestoreUnsub();
        this.firestoreUnsub = onSnapshot(roomRef, (snapshot) => {
          if (!snapshot.exists()) {
            this.emit('host_disconnected', 'Le salon a été fermé.');
            return;
          }
          const data = snapshot.data();
          this.currentRoom = data;
          this.emit('room_update', data);

          if (data.gameState === 'started') {
            this.emit('game_started_by_host', data);
          }
        }, (err) => {
          console.warn('[Netplay] Écoute Firestore désactivée (quota ou hors-ligne):', err.message);
        });
      }
    } catch(fbErr) {
      if (fbErr.message && fbErr.message.includes('complet')) {
        throw fbErr;
      }
      console.warn('[Netplay] Firestore indisponible ou quota dépassé pour joinRoom, fallback P2P:', fbErr.message);
    }

    // Si Firestore n'était pas joignable ou n'a pas répondu, métadonnées de secours
    if (!joinedRoomData) {
      joinedRoomData = {
        code: cleanCode,
        gameId: 'arcade',
        gameTitle: 'Partie Arcade Multijoueur',
        maxPlayers: 2,
        players: [
          { name: 'Hôte', slot: 1, isHost: true, playerIndex: 0, role: 'p1' },
          { name: playerName, slot: 2, isHost: false, playerIndex: 1, role: 'p2' }
        ],
        gameState: 'waiting'
      };
    }

    this.currentRoom = joinedRoomData;
    this.myPlayerIndex = playerIndex;
    this.myRole = role;

    // Relais de signalisation P2P garanti sans quota (ntfy.sh WebSocket)
    this.setupNtfySignaling(cleanCode, false, playerName);

    const resData = {
      roomCode: cleanCode,
      gameId: joinedRoomData.gameId,
      gameTitle: joinedRoomData.gameTitle,
      maxPlayers: joinedRoomData.maxPlayers,
      playerIndex,
      role
    };

    this.emit('joined_success', resData);
    console.log(`[Netplay Cloud] Salon ${cleanCode} rejoint avec succès (Slot J${playerIndex + 1}) !`);
    return resData;
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

    // 1. PRIORITÉ ABSOLUE : Canal UDP rapide non ordonné sans retransmission
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

  // Demander la synchronisation de l'état (Guest -> Host)
  requestStateSync() {
    const payload = {
      type: 'REQUEST_STATE',
      fromPlayerIndex: this.myPlayerIndex
    };

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

    // 1. WebRTC DataChannels P2P
    const targetChannel = (this.reliableChannel && this.reliableChannel.readyState === 'open')
      ? this.reliableChannel
      : (this.fastInputChannel && this.fastInputChannel.readyState === 'open' ? this.fastInputChannel : null);

    if (targetChannel) {
      try {
        targetChannel.send(JSON.stringify(startMsg));
      } catch(e) {}
    }

    // 2. Relais Ntfy (Zéro quota)
    if (this.currentTopic) {
      this.sendNtfySignal(this.currentTopic, {
        type: 'GAME_STARTED_BY_HOST',
        ...startMsg
      });
    }

    // 3. Mode WebSocket LAN
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(startMsg));
    }

    // 4. Firestore optionnel
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

    // 1. WebRTC DataChannels
    const targetChannel = (this.reliableChannel && this.reliableChannel.readyState === 'open')
      ? this.reliableChannel
      : (this.fastInputChannel && this.fastInputChannel.readyState === 'open' ? this.fastInputChannel : null);

    if (targetChannel) {
      try {
        targetChannel.send(JSON.stringify(leaveMsg));
      } catch(e) {}
    }

    // 2. Relais Ntfy
    if (this.currentTopic) {
      this.sendNtfySignal(this.currentTopic, leaveMsg);
      if (this.ntfyWs) {
        try { this.ntfyWs.close(); } catch(e) {}
        this.ntfyWs = null;
      }
      this.currentTopic = null;
    }

    // 3. WS LAN
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentRoom) {
      try {
        this.ws.send(JSON.stringify(leaveMsg));
      } catch(e) {}
    }

    // 4. Firestore optionnel
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
