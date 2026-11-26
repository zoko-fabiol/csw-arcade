/**
 * Sonde de Ping P2P Direct (façon Fightcade 2)
 * Établit un DataChannel WebRTC UDP temporaire DIRECTEMENT entre Joueur A et Joueur B
 * (STUN uniquement, zéro détour par le serveur VPS Europe), mesure 5 pings rapides,
 * retient le p20 (filtre anti-pics bufferbloat) puis ferme proprement la connexion.
 */

const PROBE_STUN_SERVERS = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:csw-arcade.tech:3478' },
];

const CACHE_TTL_MS = 45000;
const PROBE_TIMEOUT_MS = 4000;
const MAX_CONCURRENT_PROBES = 3;

export function trimmedLowRtt(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  // Prend le 2e plus bas sur >= 3 mesures (ignore les pics isolés de bufferbloat sans sous-estimer)
  const idx = sorted.length >= 3 ? 1 : 0;
  return Math.max(1, Math.round(sorted[idx]));
}

export class P2pLobbyProbe {
  constructor({ getMyUid, sendProbeSignal, onDirectPingMeasured }) {
    this.getMyUid = getMyUid;
    this.sendProbeSignal = sendProbeSignal;
    this.onDirectPingMeasured = onDirectPingMeasured;

    this.activeProbes = new Map(); // peerUid -> { pc, dc, samples, timer, pingTimers, pendingCands, hasRemote }
    this.cache = new Map(); // peerUid -> { ms, measuredAt }
    this.lastAttemptAt = new Map(); // peerUid -> ts
  }

  getCachedPing(peerUid) {
    const entry = this.cache.get(peerUid);
    if (!entry) return null;
    if (Date.now() - entry.measuredAt > CACHE_TTL_MS * 2) return null;
    return entry.ms;
  }

  probe(peerUid) {
    if (typeof RTCPeerConnection === 'undefined') return;
    const myUid = this.getMyUid?.();
    if (!myUid || !peerUid || myUid === peerUid) return;

    const now = Date.now();
    const cached = this.cache.get(peerUid);
    if (cached && now - cached.measuredAt < CACHE_TTL_MS) return;

    if (this.activeProbes.has(peerUid)) return;
    const lastAttempt = this.lastAttemptAt.get(peerUid) || 0;
    if (now - lastAttempt < 12000) return;

    if (this.activeProbes.size >= MAX_CONCURRENT_PROBES) return;
    this.lastAttemptAt.set(peerUid, now);

    // Règle déterministe sans collision : seul l'UID lexicographiquement inférieur crée l'offre.
    // L'autre pair lui envoie simplement une demande légère 'want-probe'.
    if (String(myUid) < String(peerUid)) {
      this._startInitiator(peerUid);
    } else {
      this.sendProbeSignal(peerUid, 'want-probe', { ts: now });
    }
  }

  async handleSignal(fromUid, signalType, payload) {
    if (typeof RTCPeerConnection === 'undefined') return;
    const myUid = this.getMyUid?.();
    if (!myUid || !fromUid || fromUid === myUid) return;

    if (signalType === 'want-probe') {
      if (String(myUid) < String(fromUid)) {
        const cached = this.cache.get(fromUid);
        const now = Date.now();
        if (!this.activeProbes.has(fromUid) && (!cached || now - cached.measuredAt >= 15000)) {
          if (this.activeProbes.size < MAX_CONCURRENT_PROBES) {
            this.lastAttemptAt.set(fromUid, now);
            this._startInitiator(fromUid);
          }
        }
      }
      return;
    }

    if (signalType === 'offer' && payload?.sdp) {
      this._cleanupProbe(fromUid);
      if (this.activeProbes.size >= MAX_CONCURRENT_PROBES + 2) return;
      await this._startResponder(fromUid, payload);
      return;
    }

    const session = this.activeProbes.get(fromUid);
    if (!session || !session.pc) return;

    if (signalType === 'answer' && payload?.sdp && !session.hasRemote) {
      try {
        await session.pc.setRemoteDescription(new RTCSessionDescription(payload));
        session.hasRemote = true;
        await this._flushCandidates(session);
      } catch {
        this._cleanupProbe(fromUid);
      }
      return;
    }

    if (signalType === 'ice' && payload) {
      if (!session.hasRemote) {
        session.pendingCands.push(payload);
      } else {
        try {
          await session.pc.addIceCandidate(new RTCIceCandidate(payload));
        } catch {}
      }
    }
  }

  async _startInitiator(peerUid) {
    const session = this._createSession(peerUid, true);
    try {
      const dc = session.pc.createDataChannel('csw-ping', {
        ordered: false,
        maxRetransmits: 0,
      });
      this._attachDataChannel(peerUid, session, dc);
      const offer = await session.pc.createOffer();
      await session.pc.setLocalDescription(offer);
      this.sendProbeSignal(peerUid, 'offer', { type: offer.type, sdp: offer.sdp });
    } catch {
      this._cleanupProbe(peerUid);
    }
  }

  async _startResponder(peerUid, offer) {
    const session = this._createSession(peerUid, false);
    session.pc.ondatachannel = (e) => {
      this._attachDataChannel(peerUid, session, e.channel);
    };
    try {
      await session.pc.setRemoteDescription(new RTCSessionDescription(offer));
      session.hasRemote = true;
      await this._flushCandidates(session);
      const answer = await session.pc.createAnswer();
      await session.pc.setLocalDescription(answer);
      this.sendProbeSignal(peerUid, 'answer', { type: answer.type, sdp: answer.sdp });
    } catch {
      this._cleanupProbe(peerUid);
    }
  }

  _createSession(peerUid, isInitiator) {
    const pc = new RTCPeerConnection({
      iceServers: PROBE_STUN_SERVERS,
      bundlePolicy: 'max-bundle',
    });
    const session = {
      pc,
      dc: null,
      isInitiator,
      samples: [],
      pendingCands: [],
      hasRemote: false,
      pingTimers: [],
      timer: setTimeout(() => this._finishAndCleanup(peerUid), PROBE_TIMEOUT_MS),
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendProbeSignal(peerUid, 'ice', e.candidate.toJSON());
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
        this._cleanupProbe(peerUid);
      }
    };
    this.activeProbes.set(peerUid, session);
    return session;
  }

  _attachDataChannel(peerUid, session, dc) {
    session.dc = dc;
    dc.onopen = () => {
      // Les 2 pairs mesurent simultanément le vrai ping P2P direct (5 salves rapides sur 720ms)
      const sendBurst = (i) => {
        if (dc.readyState !== 'open') return;
        try {
          dc.send(`P:${performance.now()}`);
        } catch {}
        if (i === 4) {
          const doneTimer = setTimeout(() => this._finishAndCleanup(peerUid), 650);
          session.pingTimers.push(doneTimer);
        }
      };
      for (let i = 0; i < 5; i++) {
        const t = setTimeout(() => sendBurst(i), i * 160);
        session.pingTimers.push(t);
      }
    };
    dc.onmessage = (e) => {
      const text = typeof e.data === 'string' ? e.data : '';
      if (text.startsWith('P:')) {
        if (dc.readyState === 'open') {
          try {
            dc.send(`R:${text.slice(2)}`);
          } catch {}
        }
      } else if (text.startsWith('R:')) {
        const sent = parseFloat(text.slice(2));
        if (Number.isFinite(sent)) {
          const rtt = Math.max(1, Math.min(1500, Math.round(performance.now() - sent)));
          session.samples.push(rtt);
          const best = trimmedLowRtt(session.samples);
          if (best !== null) {
            this.cache.set(peerUid, { ms: best, measuredAt: Date.now() });
            this.onDirectPingMeasured?.(peerUid, best);
          }
        }
      }
    };
  }

  async _flushCandidates(session) {
    const list = [...session.pendingCands];
    session.pendingCands = [];
    for (const c of list) {
      try {
        await session.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {}
    }
  }

  _finishAndCleanup(peerUid) {
    const session = this.activeProbes.get(peerUid);
    if (session && session.samples.length > 0) {
      const best = trimmedLowRtt(session.samples);
      if (best !== null) {
        this.cache.set(peerUid, { ms: best, measuredAt: Date.now() });
        this.onDirectPingMeasured?.(peerUid, best);
      }
    }
    this._cleanupProbe(peerUid);
  }

  _cleanupProbe(peerUid) {
    const session = this.activeProbes.get(peerUid);
    if (!session) return;
    this.activeProbes.delete(peerUid);
    if (session.timer) clearTimeout(session.timer);
    for (const t of session.pingTimers) clearTimeout(t);
    try { session.dc?.close(); } catch {}
    try { session.pc?.close(); } catch {}
  }

  destroyAll() {
    for (const uid of Array.from(this.activeProbes.keys())) {
      this._cleanupProbe(uid);
    }
  }
}
