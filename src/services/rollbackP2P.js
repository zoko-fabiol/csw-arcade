/**
 * Pilier 3B : Moteur WebRTC DataChannel (UDP-like) + Buffer Circulaire Rollback (8 frames).
 */

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

const MAX_ROLLBACK_FRAMES = 8;

export class RollbackP2PEngine {
  constructor({
    isHost,
    inputDelay = 1,
    onSignalIce,
    onStateChange,
    onRemoteInput,
    onRemoteButton,
    onFrame0State,
    onRemoteMediaStream,
    onStats,
  }) {
    this.isHost = Boolean(isHost);
    this.inputDelay = Math.min(3, Math.max(0, Number(inputDelay) || 0));
    this.onSignalIce = onSignalIce;
    this.onStateChange = onStateChange;
    this.onRemoteInput = onRemoteInput;
    this.onRemoteButton = onRemoteButton;
    this.onFrame0State = onFrame0State;
    this.onRemoteMediaStream = onRemoteMediaStream;
    this.onStats = onStats;

    this.pc = null;
    this.udpChannel = null; // { ordered: false, maxRetransmits: 0 }
    this.reliableChannel = null; // { ordered: true }
    this.pingInterval = null;
    this.pendingCandidates = [];
    this.hasRemoteDesc = false;

    this.currentFrame = 0;
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

  setInputDelay(delay) {
    this.inputDelay = Math.min(3, Math.max(0, Number(delay) || 0));
    this.stats.inputDelay = this.inputDelay;
    this.emitStats();
  }

  emitStats() {
    this.onStats?.({ ...this.stats });
  }

  async initConnection() {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' });

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.onSignalIce?.(e.candidate.toJSON());
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const s = this.pc?.iceConnectionState || 'closed';
      this.stats.p2pState = s;
      this.emitStats();
      this.onStateChange?.(s);
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

  async acceptOfferAndCreateAnswer(offer) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    this.hasRemoteDesc = true;
    await this.flushCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  async acceptAnswer(answer) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    this.hasRemoteDesc = true;
    await this.flushCandidates();
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
    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'FRAME0_STATE') {
          this.onFrame0State?.(msg.stateBase64, msg.romHash);
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
        } catch {
          /* noop */
        }
      }
    }, 1500);
  }

  sendButtonEvent(buttonIdx, pressed) {
    this.currentFrame += 1;
    let sentP2P = false;
    if (this.udpChannel?.readyState === 'open') {
      try {
        this.udpChannel.send(
          JSON.stringify({
            type: 'BTN',
            b: Number(buttonIdx),
            p: pressed ? 1 : 0,
            f: this.currentFrame + this.inputDelay,
          })
        );
        sentP2P = true;
      } catch {
        /* noop */
      }
    }
    // Secours WebSocket VPS garanti : si le canal UDP direct WebRTC n'est pas prêt ou bloqué par le NAT
    if (!sentP2P && this.onRelayButtonFallback) {
      try {
        this.onRelayButtonFallback({
          buttonIdx: Number(buttonIdx),
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
    if (this.reliableChannel?.readyState === 'open') {
      this.reliableChannel.send(JSON.stringify({ type: 'FRAME0_STATE', stateBase64, romHash }));
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
    if (buffer.byteLength < 6) return;
    const view = new DataView(buffer);
    const frame = view.getUint32(0, false);
    const bitmask = view.getUint16(4, false);

    const predicted = this.remoteInputs.get(frame);
    this.remoteInputs.set(frame, bitmask);
    if (frame > this.lastConfirmedRemoteFrame) {
      this.lastConfirmedRemoteFrame = frame;
    }

    if (predicted !== undefined && predicted !== bitmask && frame < this.currentFrame) {
      const rollbackDepth = Math.min(MAX_ROLLBACK_FRAMES, this.currentFrame - frame);
      this.stats.rollbackFrames = rollbackDepth;
      this.emitStats();
    }

    this.onRemoteInput?.({ frame, bitmask });
  }

  destroy() {
    if (this.pingInterval) clearInterval(this.pingInterval);
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
  }
}
