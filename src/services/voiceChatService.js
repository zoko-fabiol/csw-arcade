/**
 * Service Groupe & Chat Vocal CSW Arcade — WebRTC P2P Pur + Cloudflare TURN (modèle VoiceBridge)
 * - Jusqu'à 6 joueurs par groupe salon, continu du salon jusqu'en jeu sans coupure
 * - Audio 100 % natif C++ WebRTC Opus (getUserMedia -> addTrack -> <audio autoplay>),
 *   zéro ScriptProcessorNode ni ré-encodage JS sur le thread de l'émulateur
 * - Signalisation temps réel WebSocket (/ws/voice) + STUN + Cloudflare Anycast TURN en secours NAT strict
 * - Reprise automatique ICE (restartIce) sur micro-coupure Wi-Fi/4G + gestion autoplay bloqué
 */

import { fetchDynamicTurnServers } from './rollbackP2P';

function buildBaseVoiceIceServers() {
  const servers = [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
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
  return servers;
}

const BASE_VOICE_ICE_SERVERS = buildBaseVoiceIceServers();
let cachedVoiceIceServers = BASE_VOICE_ICE_SERVERS;

async function getVoiceIceServers() {
  try {
    const dynTurn = await Promise.race([
      fetchDynamicTurnServers(),
      new Promise((r) => setTimeout(() => r([]), 2500)),
    ]);
    if (Array.isArray(dynTurn) && dynTurn.length > 0) {
      cachedVoiceIceServers = [...BASE_VOICE_ICE_SERVERS, ...dynTurn];
    }
  } catch {}
  return cachedVoiceIceServers;
}

if (typeof window !== 'undefined') {
  setTimeout(() => {
    getVoiceIceServers().catch(() => {});
  }, 800);
}

const DEFAULT_CF_VOICE_WS_URL = 'wss://csw-arcade-signaling.clausephwandji044.workers.dev/ws/voice';

function getVoiceWsUrl() {
  if (typeof window === 'undefined') return '';
  try {
    const override = import.meta?.env?.VITE_VOICE_WS_URL;
    if (override) return override;
  } catch {}
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws/voice`;
  }
  return DEFAULT_CF_VOICE_WS_URL;
}

/**
 * Règle dynamiquement le bitrate Opus quel que soit le numéro de payload négocié dans le SDP.
 */
function configureOpusSdp(sdp = '', maxKbps = 32) {
  try {
    const bps = Math.max(16000, Math.min(64000, Number(maxKbps || 32) * 1000));
    const ptMatch = sdp.match(/a=rtpmap:(\d+)\s+opus\/48000/i);
    const pt = ptMatch?.[1];
    if (!pt) return sdp;

    const fmtpRe = new RegExp(`(a=fmtp:${pt}\\s+[^\\r\\n]+)`, 'g');
    if (fmtpRe.test(sdp)) {
      return sdp.replace(fmtpRe, (line) => {
        let next = line;
        if (!next.includes('ptime=')) next += ';ptime=10';
        if (!next.includes('maxaveragebitrate=')) next += `;maxaveragebitrate=${bps}`;
        if (!next.includes('useinbandfec=')) next += ';useinbandfec=1';
        if (!next.includes('usedtx=')) next += ';usedtx=1';
        return next;
      });
    }
    return sdp.replace(
      new RegExp(`(a=rtpmap:${pt}\\s+opus\\/48000[^\\r\\n]*)`, 'i'),
      `$1\r\na=fmtp:${pt} minptime=10;ptime=10;useinbandfec=1;usedtx=1;maxaveragebitrate=${bps}`
    );
  } catch {
    return sdp;
  }
}

function applySenderBitrate(pc, maxKbps = 32) {
  try {
    const maxBitrate = Math.max(16000, Math.min(64000, Number(maxKbps || 32) * 1000));
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== 'audio' || typeof sender.getParameters !== 'function') continue;
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = maxBitrate;
      params.encodings[0].networkPriority = 'high';
      sender.setParameters(params).catch(() => {});
    }
  } catch {}
}

class VoiceChatService {
  constructor() {
    this.ws = null;
    this.reconnectTimer = null;
    this.userProfile = null;
    this.settings = {
      privacy: 'friends',
      micMode: 'open',
      pttKey: 'KeyV',
      volume: 85,
      sensitivity: 20,
      defaultMuted: false,
      audioDucking: true,
    };

    this.state = {
      connected: false,
      roomId: null,
      roomTitle: '',
      hostUid: null,
      maxMembers: 6,
      channel: 'party',
      members: [],
      ready: false,
      muted: false,
      speaking: false,
      pttActive: false,
      audioBlocked: false,
      incomingInvite: null,
      error: '',
      mutedPeers: {},
      unreadByPeer: {},
      totalUnreadDm: 0,
    };

    this.listeners = new Set();
    this.dmListeners = new Set();

    // Capture micro & indicateur visuel léger (AnalyserNode uniquement, zéro ScriptProcessorNode)
    this.localStream = null;
    this.localAudioPromise = null;
    this.audioCtx = null;
    this.analyser = null;
    this.vadTimer = null;
    this.lastSpeakingSent = false;
    this.speakingHoldUntil = 0;

    // Connexions WebRTC natives directes (Opus P2P + Cloudflare TURN en secours)
    this.peers = new Map(); // peerUid -> { pc, audioEl, connected, pendingCandidates, iceRestartTimer, makingOffer, ignoreOffer }
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
      }, 4500);
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

  async unlockRemoteAudio() {
    let anyBlocked = false;
    for (const peer of this.peers.values()) {
      if (!peer.audioEl?.srcObject) continue;
      try {
        await peer.audioEl.play();
      } catch {
        anyBlocked = true;
      }
    }
    if (this.audioCtx?.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    if (this.state.audioBlocked !== anyBlocked) {
      this.state.audioBlocked = anyBlocked;
      this.emit();
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
          this.reconnectTimer = setTimeout(() => this.connect(this.userProfile), 2000);
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

    this.refreshPeerVolumes();
    this.applyMicTrackState();
    this.setupPushToTalkListeners();
    this.emit();
  }

  refreshPeerVolumes() {
    const vol = Math.max(0, Math.min(1, Number(this.settings.volume ?? 85) / 100));
    const myChannel = this.state.channel || 'party';
    for (const [peerUid, peer] of this.peers.entries()) {
      if (!peer.audioEl) continue;
      const member = this.state.members.find((m) => m.uid === peerUid);
      const sameChan = !member || (member.channel || 'party') === myChannel;
      peer.audioEl.volume = sameChan && !this.state.mutedPeers[peerUid] ? vol : 0;
    }
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
      this.state.audioBlocked = false;
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
      this.refreshPeerVolumes();
      this.syncPeersWithRoom(this.state.members);
      this.emit();
      return;
    }

    if (msg.type === 'webrtc_signal') {
      this.handleWebRtcSignal(msg.fromUid, msg.signal);
    }
  }

  dismissInvite() {
    this.state.incomingInvite = null;
    this.emit();
  }

  async ensureLocalAudio() {
    if (this.localStream) return this.localStream;
    if (this.localAudioPromise) return this.localAudioPromise;

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      throw new Error('Le microphone nécessite HTTPS ou localhost.');
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone non supporté sur ce navigateur.');
    }

    this.localAudioPromise = navigator.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      })
      .then((stream) => {
        this.localStream = stream;
        this.applyMicTrackState();
        this.startLightweightVad(stream);
        if (this.state.roomId && this.state.members.length > 0) {
          this.syncPeersWithRoom(this.state.members);
        }
        return stream;
      })
      .finally(() => {
        this.localAudioPromise = null;
      });

    return this.localAudioPromise;
  }

  /**
   * Détection visuelle de parole passive (AnalyserNode uniquement, zéro ScriptProcessorNode).
   */
  startLightweightVad(stream) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.audioCtx = new Ctx();
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      const src = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 128;
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
          this.speakingHoldUntil = Math.max(this.speakingHoldUntil, now + 850);
        }
        const isSpeakingNow = now < this.speakingHoldUntil;
        if (isSpeakingNow !== this.lastSpeakingSent) {
          this.lastSpeakingSent = isSpeakingNow;
          this.state.speaking = isSpeakingNow;
          this.sendWs({ type: 'voice_state', muted: false, speaking: isSpeakingNow, channel: this.state.channel });
          this.emit();
        }
      }, 180);
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
    this.unlockRemoteAudio();
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
    this.unlockRemoteAudio();
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
      await Promise.all([this.ensureLocalAudio(), getVoiceIceServers()]);
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
    this.unlockRemoteAudio();
    if (!targetUser?.uid || !this.userProfile?.uid) return false;
    if (this.settings.privacy === 'off') {
      this.setError('Activez le chat vocal dans Paramètres → Audio.');
      return false;
    }
    this.connect(this.userProfile);
    try {
      await Promise.all([this.ensureLocalAudio(), getVoiceIceServers()]);
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
    this.state.audioBlocked = false;
    this.emit();
  }

  toggleMute() {
    this.unlockRemoteAudio();
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
    this.refreshPeerVolumes();
    this.emit();
  }

  togglePeerMute(peerUid) {
    if (!peerUid) return;
    const next = !this.state.mutedPeers[peerUid];
    if (next) this.state.mutedPeers[peerUid] = true;
    else delete this.state.mutedPeers[peerUid];
    this.refreshPeerVolumes();
    this.emit();
  }

  closePeerEntry(peerUid, entry) {
    if (!entry) return;
    clearTimeout(entry.iceRestartTimer);
    try {
      entry.pc.onconnectionstatechange = null;
      entry.pc.oniceconnectionstatechange = null;
      entry.pc.onicecandidate = null;
      entry.pc.ontrack = null;
      entry.pc.close();
      entry.audioEl?.remove();
    } catch {}
    this.peers.delete(peerUid);
  }

  syncPeersWithRoom(members = []) {
    const myUid = this.userProfile?.uid;
    if (!myUid || !this.localStream) return;
    const activeIds = new Set(members.map((m) => m.uid));

    for (const [peerUid, entry] of this.peers.entries()) {
      if (!activeIds.has(peerUid)) {
        this.closePeerEntry(peerUid, entry);
      }
    }

    getVoiceIceServers().then(() => {
      if (!this.state.roomId || !this.localStream) return;
      for (const m of this.state.members) {
        if (!m.uid || m.uid === myUid) continue;
        if (!this.peers.has(m.uid)) {
          const shouldInitiate = String(myUid) > String(m.uid);
          this.createPeerConnection(m.uid, shouldInitiate);
        }
      }
    });
  }

  async sendOffer(peerUid, entry, { iceRestart = false } = {}) {
    const pc = entry?.pc;
    if (!pc || entry.makingOffer) return;
    entry.makingOffer = true;
    try {
      const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      if (pc.signalingState !== 'stable') return;
      offer.sdp = configureOpusSdp(offer.sdp, 32);
      await pc.setLocalDescription(offer);
      applySenderBitrate(pc, 32);
      this.sendWs({
        type: 'webrtc_signal',
        toUid: peerUid,
        signal: { type: 'offer', sdp: pc.localDescription },
      });
    } catch {} finally {
      entry.makingOffer = false;
    }
  }

  createPeerConnection(peerUid, initiate = false) {
    if (typeof RTCPeerConnection === 'undefined') return null;
    const pc = new RTCPeerConnection({
      iceServers: cachedVoiceIceServers,
      iceCandidatePoolSize: 2,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    this.ensureAudioContainer()?.appendChild(audioEl);

    const entry = {
      pc,
      audioEl,
      connected: false,
      pendingCandidates: [],
      iceRestartTimer: null,
      makingOffer: false,
      polite: String(this.userProfile?.uid || '') < String(peerUid),
      ignoreOffer: false,
    };
    this.peers.set(peerUid, entry);
    this.refreshPeerVolumes();

    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        pc.addTrack(track, this.localStream);
      }
      applySenderBitrate(pc, 32);
    }

    pc.ontrack = (ev) => {
      if (this.peers.get(peerUid) !== entry) return;
      const remoteStream = ev.streams?.[0] || new MediaStream([ev.track]);
      audioEl.srcObject = remoteStream;
      this.refreshPeerVolumes();
      audioEl.play().catch(() => {
        if (this.peers.get(peerUid) === entry && !this.state.audioBlocked) {
          this.state.audioBlocked = true;
          this.emit();
        }
      });
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate && this.peers.get(peerUid) === entry) {
        this.sendWs({
          type: 'webrtc_signal',
          toUid: peerUid,
          signal: { type: 'candidate', candidate: ev.candidate },
        });
      }
    };

    const scheduleIceRecovery = (delayMs) => {
      if (entry.iceRestartTimer || this.peers.get(peerUid) !== entry) return;
      entry.iceRestartTimer = setTimeout(() => {
        entry.iceRestartTimer = null;
        if (this.peers.get(peerUid) !== entry || !this.state.roomId) return;
        const st = pc.connectionState;
        const iceSt = pc.iceConnectionState;
        if (st === 'connected' || iceSt === 'connected' || iceSt === 'completed') return;
        if (!entry.polite) {
          try { pc.restartIce?.(); } catch {}
          this.sendOffer(peerUid, entry, { iceRestart: true });
        } else {
          this.sendWs({
            type: 'webrtc_signal',
            toUid: peerUid,
            signal: { type: 'renegotiate_request' },
          });
        }
      }, delayMs);
    };

    const updateConn = () => {
      if (this.peers.get(peerUid) !== entry) return;
      const st = pc.connectionState;
      const iceSt = pc.iceConnectionState;
      entry.connected = st === 'connected' || iceSt === 'connected' || iceSt === 'completed';
      if (entry.connected) {
        clearTimeout(entry.iceRestartTimer);
        entry.iceRestartTimer = null;
      } else if (st === 'failed' || iceSt === 'failed') {
        scheduleIceRecovery(250);
      } else if (st === 'disconnected' || iceSt === 'disconnected') {
        scheduleIceRecovery(2000);
      }
    };
    pc.onconnectionstatechange = updateConn;
    pc.oniceconnectionstatechange = updateConn;

    if (initiate) {
      this.sendOffer(peerUid, entry);
    }

    return entry;
  }

  async handleWebRtcSignal(fromUid, signal) {
    if (!fromUid || !signal || !this.state.roomId) return;
    await Promise.all([this.ensureLocalAudio().catch(() => null), getVoiceIceServers()]);
    if (!this.state.roomId) return;

    let entry = this.peers.get(fromUid);
    if (!entry) {
      entry = this.createPeerConnection(fromUid, false);
    }
    if (!entry?.pc) return;
    const pc = entry.pc;

    if (signal.type === 'renegotiate_request') {
      if (!entry.polite) {
        try { pc.restartIce?.(); } catch {}
        await this.sendOffer(fromUid, entry, { iceRestart: true });
      }
      return;
    }

    const flushPending = async () => {
      const list = entry.pendingCandidates || [];
      entry.pendingCandidates = [];
      for (const c of list) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        } catch {}
      }
    };

    try {
      if (signal.type === 'offer' && signal.sdp) {
        const offerCollision = entry.makingOffer || pc.signalingState !== 'stable';
        entry.ignoreOffer = !entry.polite && offerCollision;
        if (entry.ignoreOffer) return;

        if (offerCollision && entry.polite) {
          await Promise.all([
            pc.setLocalDescription({ type: 'rollback' }),
            pc.setRemoteDescription(new RTCSessionDescription(signal.sdp)),
          ]);
        } else {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        }
        await flushPending();
        const answer = await pc.createAnswer();
        answer.sdp = configureOpusSdp(answer.sdp, 32);
        await pc.setLocalDescription(answer);
        applySenderBitrate(pc, 32);
        this.sendWs({
          type: 'webrtc_signal',
          toUid: fromUid,
          signal: { type: 'answer', sdp: pc.localDescription },
        });
      } else if (signal.type === 'answer' && signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        await flushPending();
      } else if (signal.type === 'candidate' && signal.candidate) {
        if (!pc.remoteDescription) {
          entry.pendingCandidates.push(signal.candidate);
        } else {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } catch (err) {
            if (!entry.ignoreOffer) throw err;
          }
        }
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
      this.audioCtx?.close();
    } catch {}
    this.audioCtx = null;
    this.analyser = null;

    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        try {
          track.stop();
        } catch {}
      }
      this.localStream = null;
    }

    for (const [peerUid, entry] of Array.from(this.peers.entries())) {
      this.closePeerEntry(peerUid, entry);
    }
    this.peers.clear();
  }
}

export const voiceChatService = new VoiceChatService();
