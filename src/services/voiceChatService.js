/**
 * Service Groupe & Chat Vocal Non-Intrusif CSW Arcade passant par le VPS (/ws/voice)
 * - Jusqu'à 6 joueurs par groupe salon, continu du salon jusqu'en jeu sans coupure
 * - Fonctionne en LAN ET à distance (4G / NAT strict / VPN / Samsung Internet / iOS / Desktop) :
 *   1) WebRTC Audio Opus 24 kbps avec STUN + TURN/TURNS (port 443 TCP/TLS)
 *   2) Relais Audio VPS natif Web Audio G.711 µ-law 12 kHz (trames auto-portantes 100 ms sur wss://.../ws/voice)
 *      actif automatiquement dès qu'un pair distant n'a pas de lien WebRTC P2P direct !
 * - Paramètres CSW Arcade : Confidentialité (everyone | friends | party | off),
 *   Mode Micro (open | ptt), Canal (party | game), Mute individuel, Détection de parole
 * - Transporte aussi les événements DM temps réel sur la même connexion WS VPS
 */

function buildVoiceIceServers() {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  try {
    const turnUrlsRaw = import.meta?.env?.VITE_TURN_URLS || '';
    const turnUser = import.meta?.env?.VITE_TURN_USERNAME || '';
    const turnCred = import.meta?.env?.VITE_TURN_CREDENTIAL || '';
    if (turnUrlsRaw) {
      const urls = String(turnUrlsRaw)
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean);
      if (urls.length > 0) {
        servers.push({
          urls,
          ...(turnUser ? { username: turnUser } : {}),
          ...(turnCred ? { credential: turnCred } : {}),
        });
      }
    }
  } catch {}
  // Fallback TURN/TURNS port 443 TCP/TLS pour traverser les réseaux 4G/NAT symétriques
  servers.push(
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    }
  );
  return servers;
}

const ICE_SERVERS = buildVoiceIceServers();
const RELAY_SAMPLE_RATE = 12000;
const RELAY_FRAME_SAMPLES = 1200; // 100 ms à 12 kHz = 1,2 Ko en µ-law

// Codec G.711 µ-law (standard télécom, 100 % auto-portant sans en-tête, zéro latence de décodage)
function linearToUlaw(sample) {
  const MULAW_MAX = 0x1fff;
  const MULAW_BIAS = 33;
  let pcm = Math.max(-1, Math.min(1, sample)) * 32767;
  let sign = 0;
  if (pcm < 0) {
    sign = 0x80;
    pcm = -pcm;
  }
  pcm = Math.min(MULAW_MAX * 4, Math.floor(pcm)) >> 2;
  pcm += MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (pcm & mask) === 0 && exponent > 0; exponent--, mask >>= 1) {}
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

function ulawToLinear(uVal) {
  const u = (~uVal) & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return (sign ? -sample : sample) / 32768;
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function getVoiceWsUrl() {
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws/voice`;
}

function capOpusBitrate(sdp = '', maxKbps = 24) {
  try {
    const bps = Math.max(12000, Math.min(48000, Number(maxKbps || 24) * 1000));
    return sdp.replace(/(a=fmtp:111 [^\r\n]+)/g, (line) => {
      if (line.includes('maxaveragebitrate=')) return line;
      return `${line};maxaveragebitrate=${bps};stereo=0;useinbandfec=1`;
    });
  } catch {
    return sdp;
  }
}

class VoiceChatService {
  constructor() {
    this.ws = null;
    this.reconnectTimer = null;
    this.userProfile = null;
    this.settings = {
      privacy: 'friends', // 'everyone' | 'friends' | 'party' | 'off'
      micMode: 'open', // 'open' | 'ptt'
      pttKey: 'KeyV',
      volume: 85,
      sensitivity: 20, // 0..100
      defaultMuted: false,
      audioDucking: true,
    };

    this.state = {
      connected: false,
      roomId: null,
      roomTitle: '',
      hostUid: null,
      maxMembers: 6,
      channel: 'party', // 'party' | 'game'
      members: [],
      ready: false,
      muted: false,
      speaking: false,
      pttActive: false,
      incomingInvite: null,
      error: '',
      mutedPeers: {}, // uid -> true
      unreadByPeer: {},
      totalUnreadDm: 0,
    };

    this.listeners = new Set();
    this.dmListeners = new Set();

    // Audio local, détection de parole & capture relais VPS µ-law
    this.localStream = null;
    this.audioCtx = null;
    this.playbackCtx = null;
    this.analyser = null;
    this.relayProcessor = null;
    this.relayGain = null;
    this.relayPending = [];
    this.vadTimer = null;
    this.lastSpeakingSent = false;
    this.speakingHoldUntil = 0;

    // WebRTC peers & jitter buffer de lecture VPS par interlocuteur
    this.peers = new Map(); // peerUid -> { pc, audioEl, connected }
    this.speakerQueues = new Map(); // peerUid -> { nextTime, gainNode }
    this.audioContainer = null;
    this.boundKeyDown = null;
    this.boundKeyUp = null;
  }

  subscribe(cb) {
    this.listeners.add(cb);
    cb({ ...this.state });
    return () => this.listeners.delete(cb);
  }

  onDmEvent(cb) {
    this.dmListeners.add(cb);
    return () => this.dmListeners.delete(cb);
  }

  emit() {
    const snap = { ...this.state, members: [...this.state.members], mutedPeers: { ...this.state.mutedPeers } };
    for (const cb of this.listeners) {
      try {
        cb(snap);
      } catch {}
    }
  }

  setError(msg) {
    this.state.error = msg || '';
    this.emit();
    if (msg) {
      setTimeout(() => {
        if (this.state.error === msg) {
          this.state.error = '';
          this.emit();
        }
      }, 4000);
    }
  }

  ensureAudioContainer() {
    if (typeof document === 'undefined') return null;
    if (this.audioContainer && document.body.contains(this.audioContainer)) {
      return this.audioContainer;
    }
    const el = document.createElement('div');
    el.id = 'csw-voice-audio-sink';
    el.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;pointer-events:none;opacity:0;';
    document.body.appendChild(el);
    this.audioContainer = el;
    return el;
  }

  unlockPlaybackContext() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!this.playbackCtx || this.playbackCtx.state === 'closed') {
        this.playbackCtx = new Ctx();
      }
      if (this.playbackCtx.state === 'suspended') {
        this.playbackCtx.resume().catch(() => {});
      }
      return this.playbackCtx;
    } catch {
      return null;
    }
  }

  connect(userProfile, voiceSettings = null) {
    this.userProfile = userProfile || this.userProfile;
    if (voiceSettings) {
      this.settings = { ...this.settings, ...voiceSettings };
    }
    if (!this.userProfile?.uid) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (this.ws.readyState === WebSocket.OPEN) this.sendRegister();
      return;
    }

    const wsUrl = getVoiceWsUrl();
    if (!wsUrl) return;
    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.onopen = () => {
        this.state.connected = true;
        this.sendRegister();
        this.emit();
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          this.handleWsMessage(msg);
        } catch {}
      };
      ws.onclose = () => {
        this.state.connected = false;
        this.emit();
        if (this.userProfile?.uid) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => this.connect(this.userProfile), 2500);
        }
      };
      ws.onerror = () => {};
    } catch {}
  }

  sendWs(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(obj));
        return true;
      } catch {}
    }
    return false;
  }

  sendRegister() {
    if (!this.userProfile?.uid) return;
    this.sendWs({
      type: 'register',
      uid: this.userProfile.uid,
      name: this.userProfile.displayName || this.userProfile.name || 'Joueur',
      rank: this.userProfile.rank || 'D',
      region: this.userProfile.region || 'FR',
      photoURL:
        this.userProfile.photoURL && !String(this.userProfile.photoURL).startsWith('data:')
          ? this.userProfile.photoURL
          : null,
      privacy: this.settings.privacy || 'friends',
      channel: this.state.channel || 'party',
    });
  }

  updateSettings(nextVoiceSettings = {}) {
    const prevPrivacy = this.settings.privacy;
    this.settings = { ...this.settings, ...nextVoiceSettings };

    if (this.settings.privacy !== prevPrivacy) {
      this.sendWs({ type: 'update_privacy', privacy: this.settings.privacy });
      if (this.settings.privacy === 'off' && this.state.roomId) {
        this.leaveRoom();
      }
    }

    const vol = Math.max(0, Math.min(1, Number(this.settings.volume ?? 85) / 100));
    for (const [peerUid, peer] of this.peers.entries()) {
      if (peer.audioEl) {
        peer.audioEl.volume = this.state.mutedPeers[peerUid] ? 0 : vol;
      }
    }
    for (const [peerUid, sq] of this.speakerQueues.entries()) {
      if (sq.gainNode) {
        sq.gainNode.gain.value = this.state.mutedPeers[peerUid] ? 0 : vol;
      }
    }

    this.applyMicTrackState();
    this.setupPushToTalkListeners();
    this.emit();
  }

  handleWsMessage(msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'registered') {
      if (msg.unreadByPeer) {
        this.state.unreadByPeer = msg.unreadByPeer;
        this.state.totalUnreadDm = Number(msg.totalUnread || 0);
        this.emit();
      }
      return;
    }

    if (msg.type === 'dm_message' || msg.type === 'dm_unread') {
      if (msg.unreadByPeer) {
        this.state.unreadByPeer = msg.unreadByPeer;
        this.state.totalUnreadDm = Number(msg.totalUnread || 0);
        this.emit();
      }
      for (const cb of this.dmListeners) {
        try {
          cb(msg);
        } catch {}
      }
      return;
    }

    if (msg.type === 'voice_error') {
      this.setError(msg.error || 'Erreur chat vocal.');
      return;
    }

    if (msg.type === 'voice_invite_received') {
      if (this.settings.privacy === 'off') return;
      this.state.incomingInvite = msg;
      this.emit();
      return;
    }

    if (msg.type === 'left_room') {
      this.cleanupAudioAndPeers();
      this.state.roomId = null;
      this.state.roomTitle = '';
      this.state.members = [];
      this.state.speaking = false;
      this.emit();
      return;
    }

    if (msg.type === 'room_state') {
      this.state.roomId = msg.roomId;
      this.state.roomTitle = msg.title || 'Groupe CSW Arcade';
      this.state.hostUid = msg.hostUid || null;
      this.state.maxMembers = Number(msg.maxMembers || 6);
      this.state.members = Array.isArray(msg.members) ? msg.members : [];
      const meRow = this.state.members.find((m) => m.uid === this.userProfile?.uid);
      if (meRow) this.state.ready = Boolean(meRow.ready);
      this.syncPeersWithRoom(this.state.members);
      this.emit();
      return;
    }

    if (msg.type === 'webrtc_signal') {
      this.handleWebRtcSignal(msg.fromUid, msg.signal);
      return;
    }

    if (msg.type === 'voice_audio') {
      this.playRelayedAudioChunk(msg.fromUid, msg.codec, msg.sampleRate, msg.chunk);
    }
  }

  dismissInvite() {
    this.state.incomingInvite = null;
    this.emit();
  }

  async ensureLocalAudio() {
    this.unlockPlaybackContext();
    if (this.localStream) return this.localStream;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone non supporté sur ce navigateur.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });
    this.localStream = stream;
    this.startCapturePipeline(stream);
    return stream;
  }

  startCapturePipeline(stream) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.audioCtx = new Ctx();
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      const src = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      src.connect(this.analyser);

      // Pipeline Relais Audio VPS (G.711 µ-law 12 kHz) : 100 % fiable sur 4G / NAT / VPN / Mobile
      const inputRate = this.audioCtx.sampleRate || 48000;
      const ratio = inputRate / RELAY_SAMPLE_RATE;
      const proc = this.audioCtx.createScriptProcessor(2048, 1, 1);
      const silentGain = this.audioCtx.createGain();
      silentGain.gain.value = 0;
      src.connect(proc);
      proc.connect(silentGain);
      silentGain.connect(this.audioCtx.destination);
      this.relayProcessor = proc;
      this.relayGain = silentGain;
      this.relayPending = [];

      let fracPos = 0;
      proc.onaudioprocess = (ev) => {
        if (!this.state.roomId || this.isEffectivelyMuted()) {
          this.relayPending.length = 0;
          return;
        }
        const myUid = this.userProfile?.uid;
        // N'envoyer via le relais VPS que si au moins 1 membre du même canal n'a pas de P2P WebRTC direct actif
        const needsRelay = this.state.members.some((m) => {
          if (m.uid === myUid) return false;
          if ((m.channel || 'party') !== (this.state.channel || 'party')) return false;
          const peer = this.peers.get(m.uid);
          return !peer || !peer.connected;
        });
        if (!needsRelay) {
          this.relayPending.length = 0;
          return;
        }

        const input = ev.inputBuffer.getChannelData(0);
        // Détection rapide d'énergie pour ne rien envoyer pendant le silence total
        let peak = 0;
        for (let i = 0; i < input.length; i += 4) {
          const a = Math.abs(input[i]);
          if (a > peak) peak = a;
        }
        const now = Date.now();
        if (peak > 0.008) {
          this.speakingHoldUntil = Math.max(this.speakingHoldUntil, now + 650);
        }
        if (now > this.speakingHoldUntil && !this.state.pttActive) {
          this.relayPending.length = 0;
          return;
        }

        // Sous-échantillonnage linéaire vers 12 kHz + encodage µ-law
        while (fracPos < input.length) {
          const idx = Math.floor(fracPos);
          const s = input[idx] || 0;
          this.relayPending.push(linearToUlaw(s));
          fracPos += ratio;
        }
        fracPos -= input.length;

        while (this.relayPending.length >= RELAY_FRAME_SAMPLES) {
          const frame = new Uint8Array(this.relayPending.splice(0, RELAY_FRAME_SAMPLES));
          this.sendWs({
            type: 'voice_audio',
            roomId: this.state.roomId,
            codec: 'ulaw12k',
            sampleRate: RELAY_SAMPLE_RATE,
            chunk: bytesToBase64(frame),
          });
        }
      };

      // Détection de parole visuelle (anneau vert)
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      clearInterval(this.vadTimer);
      this.vadTimer = setInterval(() => {
        if (!this.state.roomId || !this.analyser) return;
        const effectivelyMuted = this.isEffectivelyMuted();
        if (effectivelyMuted) {
          if (this.lastSpeakingSent) {
            this.lastSpeakingSent = false;
            this.state.speaking = false;
            this.sendWs({ type: 'voice_state', muted: true, speaking: false, channel: this.state.channel });
            this.emit();
          }
          return;
        }
        this.analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        const threshold = Math.max(4, Math.min(45, 50 - Number(this.settings.sensitivity ?? 20) * 0.45));
        const now = Date.now();
        if (avg > threshold) {
          this.speakingHoldUntil = Math.max(this.speakingHoldUntil, now + 900);
        }
        const isSpeakingNow = now < this.speakingHoldUntil;
        if (isSpeakingNow !== this.lastSpeakingSent) {
          this.lastSpeakingSent = isSpeakingNow;
          this.state.speaking = isSpeakingNow;
          this.sendWs({ type: 'voice_state', muted: false, speaking: isSpeakingNow, channel: this.state.channel });
          this.emit();
        }
      }, 140);
    } catch {}
  }

  playRelayedAudioChunk(fromUid, codec, sampleRate, b64) {
    if (!fromUid || !b64 || this.state.mutedPeers[fromUid]) return;
    // Si le P2P WebRTC direct est connecté avec ce pair, pas besoin de doubler via le relais VPS
    const peer = this.peers.get(fromUid);
    if (peer?.connected) return;
    if (codec && codec !== 'ulaw12k') return;

    const ctx = this.unlockPlaybackContext();
    if (!ctx) return;
    try {
      const bytes = base64ToBytes(b64);
      if (bytes.length === 0) return;
      const sr = Number(sampleRate || RELAY_SAMPLE_RATE);
      const audioBuf = ctx.createBuffer(1, bytes.length, sr);
      const ch = audioBuf.getChannelData(0);
      for (let i = 0; i < bytes.length; i++) {
        ch[i] = ulawToLinear(bytes[i]);
      }

      let sq = this.speakerQueues.get(fromUid);
      if (!sq) {
        const gainNode = ctx.createGain();
        const vol = Math.max(0, Math.min(1, Number(this.settings.volume ?? 85) / 100));
        gainNode.gain.value = this.state.mutedPeers[fromUid] ? 0 : vol;
        gainNode.connect(ctx.destination);
        sq = { nextTime: 0, gainNode };
        this.speakerQueues.set(fromUid, sq);
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuf;
      source.connect(sq.gainNode);

      const now = ctx.currentTime;
      // Jitter buffer souple (40 ms min, reset si dérive > 350 ms)
      if (sq.nextTime < now + 0.015 || sq.nextTime > now + 0.35) {
        sq.nextTime = now + 0.04;
      }
      source.start(sq.nextTime);
      sq.nextTime += audioBuf.duration;
    } catch {}
  }

  isEffectivelyMuted() {
    if (this.state.muted) return true;
    if (this.settings.micMode === 'ptt' && !this.state.pttActive) return true;
    return false;
  }

  applyMicTrackState() {
    const enabled = !this.isEffectivelyMuted();
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = enabled;
      }
    }
  }

  setupPushToTalkListeners() {
    if (typeof window === 'undefined') return;
    if (this.boundKeyDown) window.removeEventListener('keydown', this.boundKeyDown);
    if (this.boundKeyUp) window.removeEventListener('keyup', this.boundKeyUp);
    this.boundKeyDown = null;
    this.boundKeyUp = null;

    if (!this.state.roomId || this.settings.micMode !== 'ptt') return;
    const pttCode = this.settings.pttKey || 'KeyV';
    this.boundKeyDown = (e) => {
      if (e.code !== pttCode || e.repeat) return;
      const tag = String(e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      this.setPushToTalkPressed(true);
    };
    this.boundKeyUp = (e) => {
      if (e.code !== pttCode) return;
      this.setPushToTalkPressed(false);
    };
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
  }

  setPushToTalkPressed(pressed) {
    this.unlockPlaybackContext();
    const next = Boolean(pressed);
    if (this.state.pttActive === next) return;
    this.state.pttActive = next;
    this.applyMicTrackState();
    this.sendWs({
      type: 'voice_state',
      muted: this.isEffectivelyMuted(),
      speaking: next && !this.state.muted,
      channel: this.state.channel,
    });
    this.emit();
  }

  async joinRoom({ roomId, title = 'Groupe CSW Arcade', channel = 'party' } = {}) {
    this.unlockPlaybackContext();
    if (!this.userProfile?.uid) {
      this.setError('Connectez-vous pour utiliser le chat vocal.');
      return false;
    }
    if (this.settings.privacy === 'off') {
      this.setError('Activez le chat vocal dans Paramètres → Audio.');
      return false;
    }
    this.connect(this.userProfile);
    try {
      await this.ensureLocalAudio();
    } catch (err) {
      this.setError(err?.message || 'Accès au microphone refusé.');
      return false;
    }

    const initialMuted = Boolean(this.settings.defaultMuted);
    this.state.muted = initialMuted;
    this.state.channel = channel === 'game' ? 'game' : 'party';
    this.state.incomingInvite = null;
    this.applyMicTrackState();

    const targetRoomId = roomId || `party_${this.userProfile.uid}`;
    this.sendWs({
      type: 'join_room',
      roomId: targetRoomId,
      title,
      channel: this.state.channel,
      muted: this.isEffectivelyMuted(),
    });
    this.setupPushToTalkListeners();
    this.emit();
    return true;
  }

  async inviteUser({ toUid, roomTitle, channel = 'party' }) {
    this.unlockPlaybackContext();
    if (!toUid || !this.userProfile?.uid) return false;
    if (!this.state.roomId) {
      const ok = await this.joinRoom({
        roomId: `party_${this.userProfile.uid}`,
        title: roomTitle || `Groupe de ${this.userProfile.displayName || 'Joueur'}`,
        channel,
      });
      if (!ok) return false;
    }
    this.sendWs({
      type: 'voice_invite',
      toUid,
      roomId: this.state.roomId,
      roomTitle: this.state.roomTitle || roomTitle,
      channel: this.state.channel,
    });
    return true;
  }

  async joinUserParty(targetUser) {
    this.unlockPlaybackContext();
    if (!targetUser?.uid || !this.userProfile?.uid) return false;
    if (this.settings.privacy === 'off') {
      this.setError('Activez le chat vocal dans Paramètres → Audio.');
      return false;
    }
    this.connect(this.userProfile);
    try {
      await this.ensureLocalAudio();
    } catch (err) {
      this.setError(err?.message || 'Accès au microphone refusé.');
      return false;
    }
    this.state.muted = Boolean(this.settings.defaultMuted);
    this.state.channel = 'party';
    this.state.incomingInvite = null;
    this.applyMicTrackState();
    this.sendWs({
      type: 'join_user_party',
      targetUid: targetUser.uid,
      targetName: targetUser.displayName || targetUser.name || 'Joueur',
      muted: this.isEffectivelyMuted(),
    });
    this.setupPushToTalkListeners();
    this.emit();
    return true;
  }

  setReady(nextReady) {
    this.state.ready = Boolean(nextReady);
    this.sendWs({ type: 'set_ready', ready: this.state.ready });
    this.emit();
  }

  kickMember(targetUid) {
    if (!targetUid) return;
    this.sendWs({ type: 'kick_member', targetUid });
  }

  transferHost(targetUid) {
    if (!targetUid) return;
    this.sendWs({ type: 'transfer_host', targetUid });
  }

  leaveRoom() {
    this.sendWs({ type: 'leave_room' });
    this.cleanupAudioAndPeers();
    this.state.roomId = null;
    this.state.roomTitle = '';
    this.state.members = [];
    this.state.speaking = false;
    this.state.pttActive = false;
    this.emit();
  }

  toggleMute() {
    this.unlockPlaybackContext();
    this.state.muted = !this.state.muted;
    this.applyMicTrackState();
    this.sendWs({
      type: 'voice_state',
      muted: this.isEffectivelyMuted(),
      speaking: this.isEffectivelyMuted() ? false : this.state.speaking,
      channel: this.state.channel,
    });
    this.emit();
  }

  setChannel(nextChannel) {
    const clean = nextChannel === 'game' ? 'game' : 'party';
    if (this.state.channel === clean) return;
    this.state.channel = clean;
    this.sendWs({
      type: 'voice_state',
      muted: this.isEffectivelyMuted(),
      speaking: this.state.speaking,
      channel: clean,
    });
    const vol = Math.max(0, Math.min(1, Number(this.settings.volume ?? 85) / 100));
    for (const member of this.state.members) {
      const peer = this.peers.get(member.uid);
      const sameChan = (member.channel || 'party') === clean;
      const targetVol = sameChan && !this.state.mutedPeers[member.uid] ? vol : 0;
      if (peer?.audioEl) peer.audioEl.volume = targetVol;
      const sq = this.speakerQueues.get(member.uid);
      if (sq?.gainNode) sq.gainNode.gain.value = targetVol;
    }
    this.emit();
  }

  togglePeerMute(peerUid) {
    if (!peerUid) return;
    const next = !this.state.mutedPeers[peerUid];
    if (next) this.state.mutedPeers[peerUid] = true;
    else delete this.state.mutedPeers[peerUid];
    const vol = Math.max(0, Math.min(1, Number(this.settings.volume ?? 85) / 100));
    const peer = this.peers.get(peerUid);
    if (peer?.audioEl) peer.audioEl.volume = next ? 0 : vol;
    const sq = this.speakerQueues.get(peerUid);
    if (sq?.gainNode) sq.gainNode.gain.value = next ? 0 : vol;
    this.emit();
  }

  syncPeersWithRoom(members = []) {
    const myUid = this.userProfile?.uid;
    if (!myUid || !this.localStream) return;
    const activeIds = new Set(members.map((m) => m.uid));

    for (const [peerUid, peer] of this.peers.entries()) {
      if (!activeIds.has(peerUid)) {
        try {
          peer.pc?.close();
          peer.audioEl?.remove();
        } catch {}
        this.peers.delete(peerUid);
      }
    }
    for (const [peerUid, sq] of this.speakerQueues.entries()) {
      if (!activeIds.has(peerUid)) {
        try {
          sq.gainNode?.disconnect();
        } catch {}
        this.speakerQueues.delete(peerUid);
      }
    }

    for (const m of members) {
      if (!m.uid || m.uid === myUid) continue;
      if (!this.peers.has(m.uid)) {
        const shouldInitiate = String(myUid) > String(m.uid);
        this.createPeerConnection(m.uid, shouldInitiate);
      }
    }
  }

  createPeerConnection(peerUid, initiate = false) {
    if (typeof RTCPeerConnection === 'undefined') return null;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    const vol = Math.max(0, Math.min(1, Number(this.settings.volume ?? 85) / 100));
    audioEl.volume = this.state.mutedPeers[peerUid] ? 0 : vol;
    this.ensureAudioContainer()?.appendChild(audioEl);

    const entry = { pc, audioEl, connected: false };
    this.peers.set(peerUid, entry);

    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.ontrack = (ev) => {
      if (ev.streams?.[0]) {
        audioEl.srcObject = ev.streams[0];
        audioEl.play().catch(() => {});
      }
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.sendWs({
          type: 'webrtc_signal',
          toUid: peerUid,
          signal: { type: 'candidate', candidate: ev.candidate },
        });
      }
    };

    pc.onconnectionstatechange = () => {
      entry.connected = pc.connectionState === 'connected';
    };

    if (initiate) {
      pc.createOffer()
        .then((offer) => {
          offer.sdp = capOpusBitrate(offer.sdp, 24);
          return pc.setLocalDescription(offer);
        })
        .then(() => {
          this.sendWs({
            type: 'webrtc_signal',
            toUid: peerUid,
            signal: { type: 'offer', sdp: pc.localDescription },
          });
        })
        .catch(() => {});
    }

    return entry;
  }

  async handleWebRtcSignal(fromUid, signal) {
    if (!fromUid || !signal || !this.state.roomId) return;
    let entry = this.peers.get(fromUid);
    if (!entry) {
      entry = this.createPeerConnection(fromUid, false);
    }
    if (!entry?.pc) return;
    const pc = entry.pc;
    try {
      if (signal.type === 'offer' && signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await pc.createAnswer();
        answer.sdp = capOpusBitrate(answer.sdp, 24);
        await pc.setLocalDescription(answer);
        this.sendWs({
          type: 'webrtc_signal',
          toUid: fromUid,
          signal: { type: 'answer', sdp: pc.localDescription },
        });
      } else if (signal.type === 'answer' && signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      } else if (signal.type === 'candidate' && signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch {}
  }

  cleanupAudioAndPeers() {
    clearInterval(this.vadTimer);
    this.vadTimer = null;
    this.lastSpeakingSent = false;
    this.relayPending = [];
    if (this.boundKeyDown) window.removeEventListener('keydown', this.boundKeyDown);
    if (this.boundKeyUp) window.removeEventListener('keyup', this.boundKeyUp);
    this.boundKeyDown = null;
    this.boundKeyUp = null;

    try {
      this.relayProcessor?.disconnect();
      this.relayGain?.disconnect();
    } catch {}
    this.relayProcessor = null;
    this.relayGain = null;

    try {
      this.audioCtx?.close();
    } catch {}
    this.audioCtx = null;
    this.analyser = null;

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        try {
          track.stop();
        } catch {}
      }
      this.localStream = null;
    }

    for (const peer of this.peers.values()) {
      try {
        peer.pc?.close();
        peer.audioEl?.remove();
      } catch {}
    }
    this.peers.clear();

    for (const sq of this.speakerQueues.values()) {
      try {
        sq.gainNode?.disconnect();
      } catch {}
    }
    this.speakerQueues.clear();
  }
}

export const voiceChatService = new VoiceChatService();
