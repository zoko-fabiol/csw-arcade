/**
 * Service Groupe & Chat Vocal Non-Intrusif CSW Arcade passant par le VPS (/ws/voice)
 * - Jusqu'à 6 joueurs par groupe salon, continu du salon jusqu'en jeu sans coupure
 * - Audio Opus 24 kbps mono ultra-léger (zéro impact sur le ping Netplay)
 * - Hybride : WebRTC Audio P2P + Relais Audio VPS automatique si NAT/4G bloque UDP
 * - Paramètres CSW Arcade : Confidentialité (everyone | friends | party | off),
 *   Mode Micro (open | ptt), Canal (party | game), Mute individuel, Détection de parole
 * - Transporte aussi les événements DM temps réel sur la même connexion WS VPS
 */

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

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

    // Audio local & détection de parole
    this.localStream = null;
    this.audioCtx = null;
    this.analyser = null;
    this.vadTimer = null;
    this.lastSpeakingSent = false;
    this.speakingHoldUntil = 0;

    // WebRTC peers & VPS relay fallback
    this.peers = new Map(); // peerUid -> { pc, audioEl, connected }
    this.mediaRecorder = null;
    this.relayAudioQueue = new Map(); // peerUid -> HTMLAudioElement
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

    // Appliquer le volume sur les flux distants actifs
    const vol = Math.max(0, Math.min(1, Number(this.settings.volume ?? 85) / 100));
    for (const [peerUid, peer] of this.peers.entries()) {
      if (peer.audioEl) {
        peer.audioEl.volume = this.state.mutedPeers[peerUid] ? 0 : vol;
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
      this.playRelayedAudioChunk(msg.fromUid, msg.mimeType, msg.chunk);
    }
  }

  dismissInvite() {
    this.state.incomingInvite = null;
    this.emit();
  }

  async ensureLocalAudio() {
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
    this.startVoiceActivityDetection(stream);
    this.startVpsRelayRecorder(stream);
    return stream;
  }

  startVoiceActivityDetection(stream) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.audioCtx = new Ctx();
      const src = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      src.connect(this.analyser);
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
          this.speakingHoldUntil = now + 900;
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

  startVpsRelayRecorder(stream) {
    // Fallback VPS relay uniquement actif si au moins un pair dans la room n'a pas de P2P connecté
    try {
      if (typeof MediaRecorder === 'undefined') return;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : '';
      if (!mimeType) return;
      const rec = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 24000 });
      this.mediaRecorder = rec;
      rec.ondataavailable = async (ev) => {
        if (!ev.data || ev.data.size === 0) return;
        if (!this.state.roomId || this.isEffectivelyMuted()) return;
        // Vérifier s'il y a un autre membre sans lien P2P WebRTC direct
        const myUid = this.userProfile?.uid;
        const needsRelay = this.state.members.some((m) => {
          if (m.uid === myUid) return false;
          if ((m.channel || 'party') !== (this.state.channel || 'party')) return false;
          const peer = this.peers.get(m.uid);
          return !peer || !peer.connected;
        });
        if (!needsRelay) return;
        try {
          const buf = await ev.data.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let bin = '';
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          const b64 = btoa(bin);
          this.sendWs({
            type: 'voice_audio',
            roomId: this.state.roomId,
            mimeType,
            chunk: b64,
          });
        } catch {}
      };
      rec.start(450);
    } catch {}
  }

  playRelayedAudioChunk(fromUid, mimeType, b64) {
    if (!fromUid || !b64 || this.state.mutedPeers[fromUid]) return;
    // Si le P2P WebRTC direct est déjà actif avec ce pair, ne pas doubler le son
    const peer = this.peers.get(fromUid);
    if (peer?.connected) return;
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: mimeType || 'audio/webm;codecs=opus' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = Math.max(0, Math.min(1, Number(this.settings.volume ?? 85) / 100));
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = () => URL.revokeObjectURL(url);
      audio.play().catch(() => URL.revokeObjectURL(url));
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

  async joinRoom({ roomId, title = 'Groupe Vocal', channel = 'party' } = {}) {
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
    // Mettre à jour le volume des pairs selon le canal
    const vol = Math.max(0, Math.min(1, Number(this.settings.volume ?? 85) / 100));
    for (const member of this.state.members) {
      const peer = this.peers.get(member.uid);
      if (peer?.audioEl) {
        const sameChan = (member.channel || 'party') === clean;
        peer.audioEl.volume = sameChan && !this.state.mutedPeers[member.uid] ? vol : 0;
      }
    }
    this.emit();
  }

  togglePeerMute(peerUid) {
    if (!peerUid) return;
    const next = !this.state.mutedPeers[peerUid];
    if (next) this.state.mutedPeers[peerUid] = true;
    else delete this.state.mutedPeers[peerUid];
    const peer = this.peers.get(peerUid);
    const vol = Math.max(0, Math.min(1, Number(this.settings.volume ?? 85) / 100));
    if (peer?.audioEl) {
      peer.audioEl.volume = next ? 0 : vol;
    }
    this.emit();
  }

  syncPeersWithRoom(members = []) {
    const myUid = this.userProfile?.uid;
    if (!myUid || !this.localStream) return;
    const activeIds = new Set(members.map((m) => m.uid));

    // Fermer les pairs sortis
    for (const [peerUid, peer] of this.peers.entries()) {
      if (!activeIds.has(peerUid)) {
        try {
          peer.pc?.close();
          peer.audioEl?.remove();
        } catch {}
        this.peers.delete(peerUid);
      }
    }

    // Créer les connexions WebRTC audio vers les nouveaux membres (initiateur = UID le plus grand)
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
    if (this.boundKeyDown) window.removeEventListener('keydown', this.boundKeyDown);
    if (this.boundKeyUp) window.removeEventListener('keyup', this.boundKeyUp);
    this.boundKeyDown = null;
    this.boundKeyUp = null;

    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
    } catch {}
    this.mediaRecorder = null;

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
  }
}

export const voiceChatService = new VoiceChatService();
