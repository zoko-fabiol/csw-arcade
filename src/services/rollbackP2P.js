/**
 * Pilier 3B : Moteur WebRTC DataChannel (UDP-like) + Buffer Circulaire Rollback (8 frames).
 */

function buildIceServers() {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
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
  } catch {
    /* ignore non-vite env */
  }
  // Relais TURN/TURNS port 443 TCP/TLS pour traverser les NAT mobiles (4G/MTN/Orange) quand STUN seul échoue
  servers.push({
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turns:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  });
  return servers;
}

const ICE_SERVERS = buildIceServers();

const MAX_ROLLBACK_FRAMES = 8;
const PACKET_BTN_MASK_SYNC = 0xb1;
const PACKET_PING_BIN = 0xee;
const PACKET_PONG_BIN = 0xef;

export class RollbackP2PEngine {
  constructor({
    isHost,
    inputDelay = 1,
    onSignalIce,
    onRenegotiateOffer,
    onStateChange,
    onRemoteInput,
    onRemoteButton,
    onFrame0State,
    onGuestReady,
    onRemoteMediaStream,
    onStats,
  }) {
    this.isHost = Boolean(isHost);
    this.inputDelay = Math.min(3, Math.max(0, Number(inputDelay) || 0));
    this.onSignalIce = onSignalIce;
    this.onRenegotiateOffer = onRenegotiateOffer;
    this.onStateChange = onStateChange;
    this.onRemoteInput = onRemoteInput;
    this.onRemoteButton = onRemoteButton;
    this.onFrame0State = onFrame0State;
    this.onGuestReady = onGuestReady;
    this.onRemoteMediaStream = onRemoteMediaStream;
    this.onStats = onStats;

    this.pc = null;
    this.udpChannel = null; // { ordered: false, maxRetransmits: 0 }
    this.reliableChannel = null; // { ordered: true }
    this.pingInterval = null;
    this.iceRestartTimer = null;
    this.connectTimeoutTimer = null;
    this.pendingCandidates = [];
    this.pendingFrame0State = null;
    this.cleanupCallbacks = [];
    this.hasRemoteDesc = false;
    this.processingRemoteDesc = false;
    this.initialOfferSent = false;
    this.lastRenegotiateTs = 0;
    this.destroyed = false;

    this.currentFrame = 0;
    this.inputSeq = 0;
    this.localBtnMask = 0;
    this.remoteBtnMask = 0;
    this.lastRemoteSeq = 0;
    this.stateRing = new Map(); // frame % 8 -> stateBase64/bytes
    this.remoteInputs = new Map(); // frame -> bitmask
    this.localInputs = new Map(); // frame -> bitmask
    this.lastConfirmedRemoteFrame = -1;
    this.incomingStateTransfers = new Map(); // transferId -> { total, syncFrame, chunks: Map }
    this.lastDeliveredTransferId = null;
    this.deliveredEventIds = new Set();

    this.onGgpoPacket = null;
    this.onFrame0Ack = null;
    this.onFrame0Go = null;
    this.onNetplayEvent = null;
    this.frame0FallbackTimer = null;

    this.rttSamples = [];
    this.smoothedRttMs = 0;
    this.jitterMs = 0;
    this.lastAutoDelayAdjustMs = 0;
    this.regionalProfile = {
      tier: 'same_continent',
      label: 'Auto',
      minDelay: 0,
      maxDelay: 4,
      recommendedDelay: this.inputDelay,
      jitterMarginMs: 12,
      ewmaAlpha: 0.25,
    };
    this.stats = {
      pingMs: 0,
      jitterMs: 0,
      regionTier: 'Auto',
      rollbackFrames: 0,
      totalRollbacks: 0,
      frameAdvantage: 0,
      currentFrame: 0,
      syncStatus: '100%',
      p2pState: 'connecting',
      inputDelay: this.inputDelay,
      recommendedDelay: this.inputDelay,
    };
  }

  applyRegionalProfile(profile) {
    if (!profile || typeof profile !== 'object') return;
    this.regionalProfile = { ...this.regionalProfile, ...profile };
    this.stats.regionTier = this.regionalProfile.label || 'Auto';
    const target = Math.max(
      this.regionalProfile.minDelay || 0,
      Math.min(this.regionalProfile.maxDelay || 4, Number(this.regionalProfile.recommendedDelay ?? this.inputDelay))
    );
    if (target > this.inputDelay) {
      this.setInputDelay(target);
    } else {
      this.emitStats();
    }
  }

  _recordRttSample(rawRttMs) {
    const clamped = Math.max(1, Math.min(2500, Math.round(rawRttMs)));
    this.rttSamples.push(clamped);
    if (this.rttSamples.length > 7) this.rttSamples.shift();
    const sorted = [...this.rttSamples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    // Lissage EWMA + calcul du jitter pour stabiliser le ping entre continents
    const alpha = Number(this.regionalProfile?.ewmaAlpha || 0.22);
    if (!this.smoothedRttMs) {
      this.smoothedRttMs = median;
      this.jitterMs = 0;
    } else {
      const diff = Math.abs(median - this.smoothedRttMs);
      this.jitterMs = Math.round(this.jitterMs * 0.75 + diff * 0.25);
      this.smoothedRttMs = Math.round(this.smoothedRttMs * (1 - alpha) + median * alpha);
    }

    const effectiveRtt = this.smoothedRttMs + Math.round(this.jitterMs * 1.1);
    const rawRec = effectiveRtt < 40 ? 0 : effectiveRtt < 90 ? 1 : effectiveRtt < 150 ? 2 : effectiveRtt < 210 ? 3 : 4;
    const minD = Number(this.regionalProfile?.minDelay || 0);
    const maxD = Number(this.regionalProfile?.maxDelay || 4);
    const stabilizedRec = Math.max(minD, Math.min(maxD, rawRec));

    this.stats.pingMs = this.smoothedRttMs;
    this.stats.jitterMs = this.jitterMs;
    this.stats.recommendedDelay = stabilizedRec;

    // Auto-stabilisation douce avec hystérésis de 6s pour absorber les pics sans osciller
    const now = performance.now();
    if (stabilizedRec !== this.inputDelay && now - this.lastAutoDelayAdjustMs > 6000 && this.rttSamples.length >= 4) {
      this.lastAutoDelayAdjustMs = now;
      this.inputDelay = stabilizedRec;
      this.stats.inputDelay = stabilizedRec;
    }
    this.emitStats();
  }

  addCleanup(fn) {
    if (typeof fn === 'function') {
      this.cleanupCallbacks.push(fn);
    }
  }

  setInputDelay(delay) {
    this.inputDelay = Math.min(4, Math.max(0, Number(delay) || 0));
    this.stats.inputDelay = this.inputDelay;
    this.emitStats();
  }

  emitStats() {
    this.onStats?.({ ...this.stats });
  }

  async initConnection() {
    this.pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 4,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.onSignalIce?.(e.candidate.toJSON());
      }
    };

    this.pc.onnegotiationneeded = async () => {
      if (!this.isHost || !this.initialOfferSent || this.destroyed || !this.pc) return;
      if (this.pc.signalingState !== 'stable') return;
      try {
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.onRenegotiateOffer?.(offer);
      } catch {
        /* noop */
      }
    };

    if (this.connectTimeoutTimer) clearTimeout(this.connectTimeoutTimer);
    this.connectTimeoutTimer = setTimeout(() => {
      if (this.destroyed || !this.pc) return;
      if (this.udpChannel?.readyState !== 'open') {
        this.stats.p2pState = 'relay-vps';
        this.emitStats();
        this.startPingLoop();
      }
    }, 4500);

    this.pc.oniceconnectionstatechange = () => {
      const s = this.pc?.iceConnectionState || 'closed';
      this.stats.p2pState = s;
      this.emitStats();
      this.onStateChange?.(s);

      if ((s === 'disconnected' || s === 'failed') && !this.destroyed) {
        if (this.iceRestartTimer) clearTimeout(this.iceRestartTimer);
        this.iceRestartTimer = setTimeout(async () => {
          if (this.destroyed || !this.pc) return;
          const cur = this.pc.iceConnectionState;
          if ((cur === 'disconnected' || cur === 'failed') && this.isHost) {
            try {
              if (typeof this.pc.restartIce === 'function') {
                this.pc.restartIce();
              }
              if (this.pc.signalingState === 'stable') {
                const offer = await this.pc.createOffer({ iceRestart: true });
                await this.pc.setLocalDescription(offer);
                this.onRenegotiateOffer?.(offer);
              }
            } catch {
              /* noop */
            }
          }
        }, 1500);
      } else if (s === 'connected' || s === 'completed') {
        if (this.iceRestartTimer) {
          clearTimeout(this.iceRestartTimer);
          this.iceRestartTimer = null;
        }
        if (this.connectTimeoutTimer) {
          clearTimeout(this.connectTimeoutTimer);
          this.connectTimeoutTimer = null;
        }
      }
    };

    this.pc.ontrack = (e) => {
      const stream = e.streams?.[0] || new MediaStream([e.track]);
      this.onRemoteMediaStream?.(stream);
    };

    if (this.isHost) {
      const udp = this.pc.createDataChannel('fc-udp-inputs', {
        ordered: false,
        maxRetransmits: 0,
      });
      this.attachUdpChannel(udp);

      const rel = this.pc.createDataChannel('fc-reliable-state', { ordered: true });
      this.attachReliableChannel(rel);

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.initialOfferSent = true;
      return offer;
    }

    this.pc.ondatachannel = (e) => {
      if (e.channel.label === 'fc-udp-inputs') {
        this.attachUdpChannel(e.channel);
      } else if (e.channel.label === 'fc-reliable-state') {
        this.attachReliableChannel(e.channel);
      }
    };
    return null;
  }

  async acceptRenegotiateOffer(offer) {
    if (!this.pc || this.destroyed || !offer || this.processingRemoteDesc) return null;
    if (offer.ts && offer.ts <= this.lastRenegotiateTs) return null;
    this.lastRenegotiateTs = offer.ts || Date.now();
    this.processingRemoteDesc = true;
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription({ type: offer.type, sdp: offer.sdp }));
      await this.flushCandidates();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      return answer;
    } catch {
      return null;
    } finally {
      this.processingRemoteDesc = false;
    }
  }

  async acceptRenegotiateAnswer(answer) {
    if (!this.pc || this.destroyed || !answer || this.processingRemoteDesc) return;
    if (answer.ts && answer.ts <= this.lastRenegotiateTs) return;
    if (this.pc.signalingState !== 'have-local-offer') return;
    this.lastRenegotiateTs = answer.ts || Date.now();
    this.processingRemoteDesc = true;
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription({ type: answer.type, sdp: answer.sdp }));
      await this.flushCandidates();
    } catch {
      /* noop */
    } finally {
      this.processingRemoteDesc = false;
    }
  }

  async acceptOfferAndCreateAnswer(offer) {
    if (!this.pc || this.destroyed || this.hasRemoteDesc || this.processingRemoteDesc) return null;
    this.processingRemoteDesc = true;
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
      this.hasRemoteDesc = true;
      await this.flushCandidates();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      return answer;
    } finally {
      this.processingRemoteDesc = false;
    }
  }

  async acceptAnswer(answer) {
    if (!this.pc || this.destroyed || this.hasRemoteDesc || this.processingRemoteDesc) return;
    if (this.pc.signalingState !== 'have-local-offer') return;
    this.processingRemoteDesc = true;
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
      this.hasRemoteDesc = true;
      await this.flushCandidates();
    } finally {
      this.processingRemoteDesc = false;
    }
  }

  async addRemoteCandidate(cand) {
    if (!cand) return;
    if (!this.hasRemoteDesc || !this.pc) {
      this.pendingCandidates.push(cand);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(cand));
    } catch {
      /* ignore stale ICE */
    }
  }

  async flushCandidates() {
    const list = [...this.pendingCandidates];
    this.pendingCandidates = [];
    for (const c of list) {
      await this.addRemoteCandidate(c);
    }
  }

  attachUdpChannel(dc) {
    this.udpChannel = dc;
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => {
      this.stats.p2pState = 'connected';
      this.emitStats();
      this.startPingLoop();
    };
    dc.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        this.handleBinaryPacket(e.data);
        return;
      }
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'PING') {
          dc.send(JSON.stringify({ type: 'PONG', t: msg.t }));
        } else if (msg.type === 'PONG') {
          this.stats.pingMs = Math.max(1, Math.round((performance.now() - msg.t) / 2));
          this.emitStats();
        } else if (msg.type === 'BTN') {
          this.onRemoteButton?.({
            buttonIdx: Number(msg.b),
            pressed: Boolean(msg.p),
            frame: Number(msg.f || 0),
          });
        }
      } catch {
        /* noop */
      }
    };
  }

  attachReliableChannel(dc) {
    this.reliableChannel = dc;
    dc.onopen = () => {
      if (!this.isHost && this.guestEmuReady) {
        try {
          dc.send(JSON.stringify({ type: 'GUEST_READY' }));
        } catch {
          /* noop */
        }
      }
      if (this.pendingFrame0State) {
        const { stateBase64, syncFrame } = this.pendingFrame0State;
        this.pendingFrame0State = null;
        this.sendFrame0State(stateBase64, syncFrame);
      }
    };
    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'FRAME0_STATE' && msg.stateBase64) {
          this._deliverFrame0State(msg.stateBase64, Number(msg.syncFrame || 0));
        } else if (msg.type === 'FRAME0_CHUNK') {
          this._handleIncomingChunk(msg.transferId, msg.index, msg.total, msg.chunk, msg.syncFrame);
        } else if (msg.type === 'GUEST_READY') {
          this.onGuestReady?.();
        } else if (msg.type === 'EMU_READY') {
          this.onPeerEmuReady?.(Boolean(msg.isHost));
        } else if (msg.type === 'FRAME0_ACK') {
          if (this.frame0FallbackTimer) {
            clearTimeout(this.frame0FallbackTimer);
            this.frame0FallbackTimer = null;
          }
          this.onFrame0Ack?.(Number(msg.syncFrame || 0));
        } else if (msg.type === 'FRAME0_GO') {
          this.onFrame0Go?.(Number(msg.syncFrame || 0));
        } else if (msg.type === 'NETPLAY_EVENT' && msg.eventData) {
          this._deliverNetplayEvent(msg.eventData);
        }
      } catch {
        /* noop */
      }
    };
  }

  _deliverNetplayEvent(eventData) {
    if (!eventData || !eventData.event) return;
    if (eventData.eventId) {
      if (this.deliveredEventIds.has(eventData.eventId)) return;
      this.deliveredEventIds.add(eventData.eventId);
    }
    this.onNetplayEvent?.(eventData);
  }

  sendNetplayEvent(eventData = {}) {
    if (!eventData || !eventData.event) return;
    const payload = {
      ...eventData,
      eventId: eventData.eventId || `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
    };
    if (this.reliableChannel?.readyState === 'open') {
      try {
        this.reliableChannel.send(JSON.stringify({ type: 'NETPLAY_EVENT', eventData: payload }));
      } catch {
        /* noop */
      }
    }
    this.onRelayButtonFallback?.({ syncType: 'NETPLAY_EVENT', eventData: payload });
  }

  notifyEmuReady(isHost) {
    this.localEmuReady = true;
    const payload = { type: 'EMU_READY', isHost: Boolean(isHost) };
    if (this.reliableChannel?.readyState === 'open') {
      try {
        this.reliableChannel.send(JSON.stringify(payload));
      } catch {
        /* noop */
      }
    }
    this.onRelayButtonFallback?.({ syncType: 'EMU_READY', isHost: Boolean(isHost) });
  }

  notifyGuestEmuReady() {
    this.guestEmuReady = true;
    this.notifyEmuReady(false);
    if (this.reliableChannel?.readyState === 'open') {
      try {
        this.reliableChannel.send(JSON.stringify({ type: 'GUEST_READY' }));
      } catch {
        /* noop */
      }
    }
    this.onRelayButtonFallback?.({ syncType: 'GUEST_READY' });
  }

  sendFrame0Ack(syncFrame = 0) {
    this.pendingAckTransferId = null;
    if (this.frame0FallbackTimer) {
      clearTimeout(this.frame0FallbackTimer);
      this.frame0FallbackTimer = null;
    }
    if (this.reliableChannel?.readyState === 'open') {
      try {
        this.reliableChannel.send(JSON.stringify({ type: 'FRAME0_ACK', syncFrame }));
      } catch {
        /* noop */
      }
    }
    this.onRelayButtonFallback?.({ syncType: 'FRAME0_ACK', syncFrame });
  }

  sendFrame0Go(syncFrame = 0) {
    if (this.reliableChannel?.readyState === 'open') {
      try {
        this.reliableChannel.send(JSON.stringify({ type: 'FRAME0_GO', syncFrame }));
      } catch {
        /* noop */
      }
    }
    this.onRelayButtonFallback?.({ syncType: 'FRAME0_GO', syncFrame });
  }

  updateRollbackTelemetry(emuStats = {}) {
    if (typeof emuStats.lastRollbackDistance === 'number') {
      this.stats.rollbackFrames = emuStats.lastRollbackDistance;
    }
    if (typeof emuStats.totalRollbacks === 'number') {
      this.stats.totalRollbacks = emuStats.totalRollbacks;
    }
    if (typeof emuStats.frameAdvantage === 'number') {
      this.stats.frameAdvantage = emuStats.frameAdvantage;
    }
    if (typeof emuStats.currentFrame === 'number') {
      this.stats.currentFrame = emuStats.currentFrame;
    }
    if (emuStats.syncStatus) {
      this.stats.syncStatus = emuStats.syncStatus;
    }
    this.emitStats();
  }

  sendGgpoPacket(buffer) {
    if (!buffer) return;
    const rawBuf =
      buffer instanceof ArrayBuffer
        ? buffer
        : ArrayBuffer.isView(buffer)
          ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
          : null;
    if (!rawBuf || rawBuf.byteLength < 1) return;

    const bytes = new Uint8Array(rawBuf);
    const magic = bytes[0];
    let sentUdp = false;

    if (this.udpChannel?.readyState === 'open') {
      try {
        this.udpChannel.send(rawBuf);
        sentUdp = true;
      } catch {
        /* noop */
      }
    }

    // Pour les paquets de contrôle critiques (0x5B = FRAME0_ACK, 0x5C = FRAME0_GO, 0xCC = DESYNC_REQ) ou si l'UDP WebRTC n'est pas encore ouvert
    if (!sentUdp || magic === 0x5b || magic === 0x5c || magic === 0xcc) {
      if (this.onRelayButtonFallback) {
        let hex = '';
        for (let i = 0; i < bytes.length; i++) {
          hex += bytes[i].toString(16).padStart(2, '0');
        }
        try {
          this.onRelayButtonFallback({ packetHex: hex });
        } catch {
          /* noop */
        }
      }
    }
  }

  _deliverFrame0State(stateBase64, syncFrame = 0) {
    if (!stateBase64) return;
    if (typeof this.onFrame0State === 'function') {
      this.pendingIncomingFrame0 = null;
      this.onFrame0State(stateBase64, Number(syncFrame || 0));
    } else {
      this.pendingIncomingFrame0 = { stateBase64, syncFrame: Number(syncFrame || 0) };
    }
  }

  _handleIncomingChunk(transferId, index, total, chunk, syncFrame = 0) {
    if (!transferId || typeof index !== 'number' || !total || !chunk) return;
    const baseId = String(transferId).replace(/_(rtc|ws)$/, '');
    if (this.lastDeliveredTransferId === baseId) return;
    let entry = this.incomingStateTransfers.get(transferId);
    if (!entry) {
      entry = { total, syncFrame: Number(syncFrame || 0), chunks: new Map() };
      this.incomingStateTransfers.set(transferId, entry);
    }
    entry.chunks.set(index, chunk);
    if (entry.chunks.size === entry.total) {
      const parts = [];
      for (let i = 0; i < entry.total; i++) {
        if (!entry.chunks.has(i)) return;
        parts.push(entry.chunks.get(i));
      }
      this.incomingStateTransfers.delete(transferId);
      this.incomingStateTransfers.delete(`${baseId}_rtc`);
      this.incomingStateTransfers.delete(`${baseId}_ws`);
      this.lastDeliveredTransferId = baseId;
      this._deliverFrame0State(parts.join(''), entry.syncFrame);
    }
  }

  handleRelayData(data) {
    if (!data) return;
    if (data.syncType === 'PING' && typeof data.t === 'number') {
      this.onRelayButtonFallback?.({ syncType: 'PONG', t: data.t });
      return;
    }
    if (data.syncType === 'PONG' && typeof data.t === 'number') {
      if (this.udpChannel?.readyState !== 'open') {
        this.stats.p2pState = 'relay-vps';
        this._recordRttSample(performance.now() - data.t);
      }
      return;
    }
    if (data.syncType === 'NETPLAY_EVENT' && data.eventData) {
      this._deliverNetplayEvent(data.eventData);
      return;
    }
    if (data.syncType === 'EMU_READY') {
      this.onPeerEmuReady?.(Boolean(data.isHost));
      return;
    }
    if (data.syncType === 'GUEST_READY') {
      this.onGuestReady?.();
      return;
    }
    if (data.syncType === 'FRAME0_ACK') {
      if (this.frame0FallbackTimer) {
        clearTimeout(this.frame0FallbackTimer);
        this.frame0FallbackTimer = null;
      }
      this.onFrame0Ack?.(Number(data.syncFrame || 0));
      return;
    }
    if (data.syncType === 'FRAME0_GO') {
      this.onFrame0Go?.(Number(data.syncFrame || 0));
      return;
    }
    if (data.syncType === 'FRAME0_CHUNK' && data.stateBase64) {
      this._handleIncomingChunk(
        data.transferId,
        data.chunkIndex,
        data.chunkTotal,
        data.stateBase64,
        data.syncFrame
      );
      return;
    }
    if (data.syncType === 'FRAME0_STATE' && data.stateBase64) {
      if (data.transferId && this.lastDeliveredTransferId === data.transferId) return;
      if (data.transferId) this.lastDeliveredTransferId = data.transferId;
      this._deliverFrame0State(data.stateBase64, Number(data.syncFrame || 0));
      return;
    }
    if (typeof data.packetHex === 'string' && data.packetHex.length >= 2) {
      const hex = data.packetHex;
      const len = hex.length >> 1;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
      }
      this.handleBinaryPacket(bytes.buffer);
      return;
    }
    if (typeof data.buttonIdx === 'number') {
      this.onRemoteButton?.({
        buttonIdx: data.buttonIdx,
        pressed: Boolean(data.pressed),
        frame: Number(data.frame || 0),
      });
    }
  }

  startPingLoop() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      if (this.destroyed) return;
      if (this.udpChannel?.readyState === 'open') {
        try {
          // Paquet PING binaire ultra-léger de 9 octets (zéro JSON sur UDP)
          const pBuf = new ArrayBuffer(9);
          const pView = new DataView(pBuf);
          pView.setUint8(0, PACKET_PING_BIN);
          pView.setFloat64(1, performance.now(), false);
          this.udpChannel.send(pBuf);
          // Keepalive bitmask pour éviter toute touche bloquée même après perte UDP isolée
          const buf = new ArrayBuffer(7);
          const view = new DataView(buf);
          view.setUint8(0, PACKET_BTN_MASK_SYNC);
          view.setUint32(1, this.inputSeq, false);
          view.setUint16(5, this.localBtnMask & 0xffff, false);
          this.udpChannel.send(buf);
        } catch {
          /* noop */
        }
      } else if (this.onRelayButtonFallback) {
        try {
          this.onRelayButtonFallback({ syncType: 'PING', t: performance.now() });
        } catch {
          /* noop */
        }
      }
    }, 1000);
  }

  sendButtonEvent(buttonIdx, pressed) {
    const idx = Number(buttonIdx);
    if (idx < 0 || idx > 15) return;
    this.currentFrame += 1;
    this.inputSeq += 1;
    if (pressed) {
      this.localBtnMask |= 1 << idx;
    } else {
      this.localBtnMask &= ~(1 << idx);
    }

    let sentP2P = false;
    if (this.udpChannel?.readyState === 'open') {
      try {
        // Paquet binaire d'état complet 7 octets [0xB1 | seq(4B) | fullBitmask(2B)]
        // Résistant aux paquets hors-ordre et aux pertes de keyup
        const buf = new ArrayBuffer(7);
        const view = new DataView(buf);
        view.setUint8(0, PACKET_BTN_MASK_SYNC);
        view.setUint32(1, this.inputSeq, false);
        view.setUint16(5, this.localBtnMask & 0xffff, false);
        this.udpChannel.send(buf);
        // Double envoi sur relâchement (keyup) pour fiabilité quasi-100% en UDP
        if (!pressed) {
          this.udpChannel.send(buf);
        }
        sentP2P = true;
      } catch {
        /* noop */
      }
    }
    // Secours WebSocket VPS garanti : si le canal UDP direct WebRTC n'est pas prêt ou bloqué par le NAT
    if (!sentP2P && this.onRelayButtonFallback) {
      try {
        this.onRelayButtonFallback({
          buttonIdx: idx,
          pressed: Boolean(pressed),
          frame: this.currentFrame + this.inputDelay,
        });
      } catch {}
    }
  }

  attachMediaStream(stream) {
    if (!this.pc || !stream) return;
    try {
      stream.getTracks().forEach((t) => this.pc.addTrack(t, stream));
    } catch {
      /* noop */
    }
  }

  // Envoie un paquet binaire compact (6 octets : uint32 frame + uint16 bitmask)
  sendLocalInput(frame, bitmask) {
    const targetFrame = frame + this.inputDelay;
    this.localInputs.set(targetFrame, bitmask);
    if (this.localInputs.size > 240) {
      const cutoff = targetFrame - 180;
      for (const k of this.localInputs.keys()) {
        if (k < cutoff) this.localInputs.delete(k);
        else break;
      }
    }
    if (this.udpChannel?.readyState === 'open') {
      const buf = new ArrayBuffer(6);
      const view = new DataView(buf);
      view.setUint32(0, targetFrame, false);
      view.setUint16(4, bitmask & 0xffff, false);
      try {
        this.udpChannel.send(buf);
      } catch {
        /* noop */
      }
    }
  }

  sendFrame0State(stateBase64, syncFrame = 0) {
    if (!stateBase64) return;
    if (this.frame0FallbackTimer) {
      clearTimeout(this.frame0FallbackTimer);
      this.frame0FallbackTimer = null;
    }
    const cleanSyncFrame = Number(syncFrame || 0);
    const transferId = `f0_${Date.now()}_${cleanSyncFrame}`;
    this.pendingAckTransferId = transferId;
    const CHUNK_SIZE = 24576; // 24 KB par paquet SCTP WebRTC fiable
    const total = Math.ceil(stateBase64.length / CHUNK_SIZE);
    let sentOverRtc = false;

    if (this.reliableChannel?.readyState === 'open') {
      sentOverRtc = true;
      const rtcTransferId = `${transferId}_rtc`;
      const dc = this.reliableChannel;
      // Envoi avec contrôle de flux (backpressure < 64 Ko) pour ne jamais saturer le canal UDP
      (async () => {
        try {
          for (let i = 0; i < total; i++) {
            if (this.destroyed || this.pendingAckTransferId !== transferId || dc.readyState !== 'open') break;
            let waits = 0;
            while (dc.bufferedAmount > 65536 && waits < 50) {
              await new Promise((r) => setTimeout(r, 8));
              waits++;
            }
            const chunk = stateBase64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            dc.send(
              JSON.stringify({
                type: 'FRAME0_CHUNK',
                transferId: rtcTransferId,
                index: i,
                total,
                chunk,
                syncFrame: cleanSyncFrame,
              })
            );
          }
        } catch {
          this.pendingFrame0State = { stateBase64, syncFrame: cleanSyncFrame };
        }
      })();
    } else {
      this.pendingFrame0State = { stateBase64, syncFrame: cleanSyncFrame };
    }

    const dispatchWsChunks = async () => {
      if (!this.onRelayButtonFallback || this.destroyed) return;
      const WS_CHUNK = 16384; // 16 Ko cadencés pour laisser passer les touches & pings sans latence
      const wsTotal = Math.ceil(stateBase64.length / WS_CHUNK);
      const wsTransferId = `${transferId}_ws`;
      try {
        for (let i = 0; i < wsTotal; i++) {
          if (this.destroyed || this.pendingAckTransferId !== transferId) break;
          const chunk = stateBase64.slice(i * WS_CHUNK, (i + 1) * WS_CHUNK);
          this.onRelayButtonFallback({
            syncType: 'FRAME0_CHUNK',
            transferId: wsTransferId,
            chunkIndex: i,
            chunkTotal: wsTotal,
            stateBase64: chunk,
            syncFrame: cleanSyncFrame,
          });
          if (i + 1 < wsTotal) {
            await new Promise((r) => setTimeout(r, 16));
          }
        }
      } catch {
        /* noop */
      }
    };

    // Si WebRTC fiable est ouvert, basculer sur le relais WS uniquement si l'ACK tarde (> 2500ms).
    if (!sentOverRtc) {
      dispatchWsChunks();
    } else if (this.onRelayButtonFallback) {
      this.frame0FallbackTimer = setTimeout(() => {
        this.frame0FallbackTimer = null;
        dispatchWsChunks();
      }, 2500);
    }
  }

  saveCircularState(frame, stateBase64) {
    const slot = frame % MAX_ROLLBACK_FRAMES;
    this.stateRing.set(slot, { frame, stateBase64 });
  }

  getCircularState(frame) {
    const slot = frame % MAX_ROLLBACK_FRAMES;
    const entry = this.stateRing.get(slot);
    return entry && entry.frame === frame ? entry.stateBase64 : null;
  }

  handleBinaryPacket(buffer) {
    if (!buffer || buffer.byteLength < 1) return;
    const view = new DataView(buffer);
    const magic = view.getUint8(0);

    // Paquets binaires PING/PONG 9 octets (zéro surcharge JSON sur UDP)
    if (buffer.byteLength === 9 && magic === PACKET_PING_BIN) {
      const ts = view.getFloat64(1, false);
      if (this.udpChannel?.readyState === 'open') {
        try {
          const pongBuf = new ArrayBuffer(9);
          const pView = new DataView(pongBuf);
          pView.setUint8(0, PACKET_PONG_BIN);
          pView.setFloat64(1, ts, false);
          this.udpChannel.send(pongBuf);
        } catch {}
      }
      return;
    }
    if (buffer.byteLength === 9 && magic === PACKET_PONG_BIN) {
      const ts = view.getFloat64(1, false);
      this.stats.p2pState = 'connected';
      this._recordRttSample(performance.now() - ts);
      return;
    }

    // Paquets binaires GGPO Fightcade :
    // 0x5A = Input Frame + Redondance N-3 (15 octets, 2J)
    // 0x5D = Input Frame Multi-Joueurs 4J+ avec octet playerIndex (16 octets)
    // 0x5B = Frame-0 / Sync ACK (5 octets)
    // 0x5C = Frame-0 / Simultaneous GO (5 octets)
    // 0xCB = Checksum RAM 68000 (9 octets)
    // 0xCC = Demande d'Auto-Resync sur divergence checksum (5 octets)
    if (magic === 0x5a || magic === 0x5d || magic === 0x5b || magic === 0x5c || magic === 0xcb || magic === 0xcc) {
      if (magic === 0x5b && buffer.byteLength >= 5) {
        const ackFrame = view.getUint32(1, false);
        if (this.frame0FallbackTimer) {
          clearTimeout(this.frame0FallbackTimer);
          this.frame0FallbackTimer = null;
        }
        this.onFrame0Ack?.(ackFrame);
      } else if (magic === 0x5c && buffer.byteLength >= 5) {
        const goFrame = view.getUint32(1, false);
        this.onFrame0Go?.(goFrame);
      }
      this.onGgpoPacket?.(buffer);
      return;
    }

    if (buffer.byteLength === 7 && magic === PACKET_BTN_MASK_SYNC) {
      const seq = view.getUint32(1, false);
      const mask = view.getUint16(5, false);
      if (seq < this.lastRemoteSeq) return; // Ignorer les paquets UDP hors-ordre obsolètes
      this.lastRemoteSeq = seq;
      const diff = mask ^ this.remoteBtnMask;
      if (diff !== 0) {
        this.remoteBtnMask = mask;
        for (let i = 0; i < 16; i++) {
          if ((diff >> i) & 1) {
            this.onRemoteButton?.({
              buttonIdx: i,
              pressed: Boolean((mask >> i) & 1),
              frame: seq,
            });
          }
        }
      }
      return;
    }
    if (buffer.byteLength < 6) return;
    const frame = view.getUint32(0, false);
    const bitmask = view.getUint16(4, false);

    const predicted = this.remoteInputs.get(frame);
    this.remoteInputs.set(frame, bitmask);
    if (frame > this.lastConfirmedRemoteFrame) {
      this.lastConfirmedRemoteFrame = frame;
    }
    if (this.remoteInputs.size > 240) {
      const cutoff = frame - 180;
      for (const k of this.remoteInputs.keys()) {
        if (k < cutoff) this.remoteInputs.delete(k);
        else break;
      }
    }

    if (predicted !== undefined && predicted !== bitmask && frame < this.currentFrame) {
      const rollbackDepth = Math.min(MAX_ROLLBACK_FRAMES, this.currentFrame - frame);
      this.stats.rollbackFrames = rollbackDepth;
      this.emitStats();
    }

    this.onRemoteInput?.({ frame, bitmask });
  }

  destroy() {
    this.destroyed = true;
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.iceRestartTimer) clearTimeout(this.iceRestartTimer);
    if (this.connectTimeoutTimer) clearTimeout(this.connectTimeoutTimer);
    if (this.frame0FallbackTimer) clearTimeout(this.frame0FallbackTimer);
    this.pingInterval = null;
    this.iceRestartTimer = null;
    this.connectTimeoutTimer = null;
    this.frame0FallbackTimer = null;

    const cleanups = [...this.cleanupCallbacks];
    this.cleanupCallbacks = [];
    for (const fn of cleanups) {
      try {
        fn();
      } catch {
        /* noop */
      }
    }

    this.onRemoteButton = null;
    this.onRemoteInput = null;
    this.onGgpoPacket = null;
    this.onFrame0State = null;
    this.onFrame0Ack = null;
    this.onFrame0Go = null;
    this.onGuestReady = null;
    this.onRelayButtonFallback = null;
    this.onStats = null;
    this.onStateChange = null;

    try {
      this.udpChannel?.close();
      this.reliableChannel?.close();
      this.pc?.close();
    } catch {
      /* noop */
    }
    this.pc = null;
    this.udpChannel = null;
    this.reliableChannel = null;
    this.pendingFrame0State = null;
    this.incomingStateTransfers.clear();
    this.localInputs.clear();
    this.remoteInputs.clear();
    this.stateRing.clear();
  }
}
