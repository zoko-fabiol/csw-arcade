/**
 * Pilier 3B : Moteur WebRTC DataChannel (UDP-like) + Buffer Circulaire Rollback (8 frames).
 */

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turns:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turns:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelay',
    credential: 'openrelay',
  },
];

const MAX_ROLLBACK_FRAMES = 8;
const PACKET_BTN_MASK_SYNC = 0xb1;

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

    this.stats = {
      pingMs: 0,
      rollbackFrames: 0,
      p2pState: 'connecting',
      inputDelay: this.inputDelay,
    };
  }

  addCleanup(fn) {
    if (typeof fn === 'function') {
      this.cleanupCallbacks.push(fn);
    }
  }

  setInputDelay(delay) {
    this.inputDelay = Math.min(3, Math.max(0, Number(delay) || 0));
    this.stats.inputDelay = this.inputDelay;
    this.emitStats();
  }

  emitStats() {
    this.onStats?.({ ...this.stats });
  }

  async initConnection() {
    this.pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 10,
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
        this.stats.p2pState = 'relay-fallback';
        this.emitStats();
      }
    }, 7000);

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
      if (!this.isHost) {
        try {
          dc.send(JSON.stringify({ type: 'GUEST_READY' }));
        } catch {
          /* noop */
        }
      }
      if (this.pendingFrame0State) {
        const { stateBase64, romHash } = this.pendingFrame0State;
        this.pendingFrame0State = null;
        this.sendFrame0State(stateBase64, romHash);
      }
    };
    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'FRAME0_STATE') {
          this.onFrame0State?.(msg.stateBase64, msg.romHash);
        } else if (msg.type === 'GUEST_READY') {
          this.onGuestReady?.();
        }
      } catch {
        /* noop */
      }
    };
  }

  startPingLoop() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      if (this.udpChannel?.readyState === 'open') {
        try {
          this.udpChannel.send(JSON.stringify({ type: 'PING', t: performance.now() }));
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
      }
    }, 500);
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

  sendFrame0State(stateBase64, romHash = '') {
    if (!stateBase64) return;
    if (this.reliableChannel?.readyState === 'open') {
      try {
        this.reliableChannel.send(JSON.stringify({ type: 'FRAME0_STATE', stateBase64, romHash }));
      } catch {
        this.pendingFrame0State = { stateBase64, romHash };
      }
    } else {
      this.pendingFrame0State = { stateBase64, romHash };
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
    if (buffer.byteLength === 7) {
      const view = new DataView(buffer);
      if (view.getUint8(0) === PACKET_BTN_MASK_SYNC) {
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
    }
    if (buffer.byteLength < 6) return;
    const view = new DataView(buffer);
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
    this.pingInterval = null;
    this.iceRestartTimer = null;
    this.connectTimeoutTimer = null;

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
    this.onFrame0State = null;
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
    this.localInputs.clear();
    this.remoteInputs.clear();
    this.stateRing.clear();
  }
}
