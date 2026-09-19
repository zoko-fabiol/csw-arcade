/**
 * ============================================================================
 * CSW-ARCADE : ROLLBACK NETCODE ENGINE (TYPE GGPO)
 * ============================================================================
 * Moteur de synchronisation déterministe prédictif avec retour en arrière
 * (Rollback & Fast-Forward Resimulation) pour FinalBurn Neo (FBNeo) WebAssembly.
 *
 * Principes architecturaux (Standards GGPO de l'industrie) :
 * 1. ZERO savestate sur le réseau en cours de jeu. Le savestate réseau ne sert
 *    qu'UNE SEULE FOIS à la synchronisation à froid (initial join).
 * 2. Chaque machine capture et conserve ses savestates localement en mémoire
 *    dans un Ring Buffer circulaire (128 frames).
 * 3. En cas de retard ou d'input divergent : restauration du savestate local passé,
 *    correction de l'input et ré-exécution ultra-rapide (Fast-Forward) SANS rendu
 *    graphique/audio jusqu'à l'image actuelle.
 * 4. Pacing dynamique par "Skip Render" : en cas de retard de K frames, calcul de K frames
 *    d'un coup dans le même tick avec skip-render sur les K-1 premières frames,
 *    sans jamais modifier la fréquence requestAnimationFrame ni détruire le buffer audio.
 * 5. Redondance d'Inputs N-3 : chaque paquet d'input transporte la frame F et l'historique
 *    des 3 frames précédentes (F-1, F-2, F-3) pour immuniser contre la perte de paquets UDP/Wi-Fi.
 * ============================================================================
 */

export const BUFFER_SIZE = 128; // Puissance de 2 pour modulo binaire (& BUFFER_MASK)
export const BUFFER_MASK = BUFFER_SIZE - 1;
export const MAX_ROLLBACK_FRAMES = 120; // Seuil maximal de réconciliation en frames
export const FRAME_TIME_MS = 1000 / 60; // 16.6667 ms (60 FPS standard NTSC Arcade)
export const MAX_CATCHUP_FRAMES = 5;    // Maximum de frames rattrapables par tick (Skip Render)

export class RollbackManager {
  /**
   * @param {Object} options Configuration d'initialisation
   * @param {Object} options.wasmModule Instance window.Module Emscripten exposant _serialize, _unserialize, _step
   * @param {RTCDataChannel|Object} [options.dataChannel] Canal WebRTC DataChannel RTC pour l'échange binaire UDP-like
   * @param {number} [options.playerIndex=0] 0 pour Joueur 1 (Hôte), 1 pour Joueur 2 (Invité)
   * @param {Function} [options.getLocalInput] Callback synchrone retournant l'input physique local (uint16/uint32)
   * @param {Function} [options.onRollback] Callback informatif notifiant un rollback (frames, currentFrame)
   * @param {Function} [options.onStatsUpdate] Callback périodique de télémétrie (fps, ping, rollbacks)
   */
  constructor({
    wasmModule = (typeof window !== 'undefined' ? window.Module : null),
    dataChannel = null,
    playerIndex = 0,
    getLocalInput = () => 0,
    onRollback = null,
    onStatsUpdate = null
  } = {}) {
    this.module = wasmModule;
    this.dataChannel = dataChannel;
    this.playerIndex = playerIndex; // 0 = P1, 1 = P2
    this.getLocalInput = getLocalInput;
    this.onRollback = onRollback;
    this.onStatsUpdate = onStatsUpdate;

    // --- ETAT TEMPOREL ET CADENCE ---
    this.currentFrame = 0;
    this.remoteFrameAdvancement = 0;
    this.remoteAckFrame = 0;
    this.isRunning = false;
    this.isRollingBack = false;
    this.animationFrameId = null;
    this.lastTimestamp = 0;
    this.timeAccumulator = 0;

    // --- TAILLE DE SAVESTATE & MEMOIRE WASM ---
    this.stateSize = 0;
    this.wasmStatePtr = null;

    // --- RING BUFFERS CIRCULAIRES ---
    // Inputs sous forme d'entiers 32-bit (masques RetroPad Neo Geo)
    this.localInputs = new Int32Array(BUFFER_SIZE);
    this.remoteInputs = new Int32Array(BUFFER_SIZE);
    this.remoteInputPredicted = new Uint8Array(BUFFER_SIZE); // 1 = prédit, 0 = confirmé réel
    this.frameNumbers = new Int32Array(BUFFER_SIZE).fill(-1);

    // Tableau de TypedArray pour stocker les instantanés de la RAM FBNeo
    this.savestates = new Array(BUFFER_SIZE);

    // Historique des 3 dernières frames pour la redondance N-3
    this.localInputHistory = [0, 0, 0];

    // File d'attente des paquets reçus
    this.incomingPacketQueue = [];

    // --- STATISTIQUES & TELEMETRIE GGPO ---
    this.stats = {
      fps: 60,
      totalFrames: 0,
      totalRollbacks: 0,
      lastRollbackDistance: 0,
      mispredictions: 0,
      predictedFramesCount: 0,
      recoveredByRedundancy: 0,
      catchupFramesExecuted: 0,
      frameAdvantage: 0
    };
    this.statsInterval = null;

    // Liaison des méthodes
    this.gameLoop = this.gameLoop.bind(this);
    this.handleDataChannelMessage = this.handleDataChannelMessage.bind(this);

    this.attachDataChannel(this.dataChannel);
  }

  /**
   * Initialisation du sous-système mémoire et validation des exports WASM Emscripten
   */
  init() {
    if (!this.module) {
      throw new Error('[RollbackManager] Module WebAssembly non spécifié ou absent.');
    }

    // Validation des symboles C/C++ exportés
    const requiredFunctions = ['_serialize_size', '_serialize', '_unserialize', '_step'];
    for (const fn of requiredFunctions) {
      if (typeof this.module[fn] !== 'function') {
        const cleanName = fn.replace(/^_/, '');
        if (typeof this.module[cleanName] === 'function') {
          this.module[fn] = this.module[cleanName];
        } else {
          console.warn(`[RollbackManager] Symbole WASM ${fn} non trouvé directement sur Module.`);
        }
      }
    }

    // Détermination de la taille en octets de l'état déterministe de FBNeo
    try {
      this.stateSize = this.module._serialize_size ? this.module._serialize_size() : 0;
    } catch(e) {
      this.stateSize = 0;
    }

    if (this.stateSize <= 0) {
      this.stateSize = 512 * 1024; // 512 Ko par défaut pour Neo Geo MVS
      console.info(`[RollbackManager] Taille de savestate par défaut : ${this.stateSize} octets.`);
    } else {
      console.info(`[RollbackManager] Taille de savestate FBNeo détectée : ${this.stateSize} octets.`);
    }

    // Allocation persistante dans le tas WebAssembly (HEAPU8) - Zéro allocation per-frame
    if (typeof this.module._malloc === 'function') {
      this.wasmStatePtr = this.module._malloc(this.stateSize);
    } else {
      throw new Error('[RollbackManager] Module._malloc introuvable. Emscripten doit exporter _malloc.');
    }

    // Pré-allocation des TypedArrays du Ring Buffer
    for (let i = 0; i < BUFFER_SIZE; i++) {
      this.savestates[i] = new Uint8Array(this.stateSize);
    }

    // Capture de la frame initiale 0
    this.saveStateToRingBuffer(0);
    console.log('[RollbackManager] Initialisé avec succès. Ring buffer alloué.');
  }

  /**
   * Capture une savestate complète à froid (utilisée UNIQUEMENT lors du cold start / connexion initiale)
   * @returns {Uint8Array}
   */
  serializeColdState() {
    if (!this.wasmStatePtr || !this.module._serialize) return null;
    this.module._serialize(this.wasmStatePtr);
    const snapshot = new Uint8Array(this.stateSize);
    snapshot.set(this.module.HEAPU8.subarray(this.wasmStatePtr, this.wasmStatePtr + this.stateSize));
    return snapshot;
  }

  /**
   * Restaure une savestate complète à froid (utilisée UNIQUEMENT lors du cold start / connexion initiale)
   * @param {Uint8Array} stateBytes 
   */
  unserializeColdState(stateBytes) {
    if (!this.wasmStatePtr || !this.module._unserialize || !stateBytes) return;
    this.module.HEAPU8.set(stateBytes, this.wasmStatePtr);
    this.module._unserialize(this.wasmStatePtr);
    this.saveStateToRingBuffer(this.currentFrame);
    console.log('[RollbackManager] Savestate à froid injecté avec succès.');
  }

  /**
   * Associe ou change le DataChannel WebRTC pour les échanges d'inputs
   * @param {RTCDataChannel} channel
   */
  attachDataChannel(channel) {
    if (!channel) return;
    this.dataChannel = channel;
    this.dataChannel.binaryType = 'arraybuffer';
    this.dataChannel.onmessage = this.handleDataChannelMessage;
  }

  /**
   * Démarre la boucle temporelle 60 FPS
   */
  start() {
    if (this.isRunning) return;
    if (!this.wasmStatePtr) {
      this.init();
    }
    this.isRunning = true;
    this.lastTimestamp = performance.now();
    this.timeAccumulator = 0;
    this.animationFrameId = requestAnimationFrame(this.gameLoop);

    this.statsInterval = setInterval(() => {
      if (this.onStatsUpdate) {
        this.stats.frameAdvantage = this.currentFrame - this.remoteFrameAdvancement;
        this.onStatsUpdate({ ...this.stats });
      }
    }, 500);

    console.log('[RollbackManager] Boucle Rollback démarrée à 60 FPS.');
  }

  /**
   * Stoppe la boucle temporelle
   */
  stop() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    console.log('[RollbackManager] Boucle Rollback stoppée.');
  }

  /**
   * Libère la mémoire WebAssembly et les écouteurs réseau
   */
  destroy() {
    this.stop();
    if (this.wasmStatePtr && this.module && typeof this.module._free === 'function') {
      this.module._free(this.wasmStatePtr);
      this.wasmStatePtr = null;
    }
    this.savestates = [];
    this.incomingPacketQueue = [];
    console.log('[RollbackManager] Ressources libérées.');
  }

  // ==========================================================================
  // PROTOCOLE RESEAU D'INPUTS AVEC REDONDANCE N-3 (IMMUNITE AUX PERTES UDP)
  // ==========================================================================

  /**
   * Émet l'input local avec redondance N-3 sur le DataChannel WebRTC
   * Format binaire compact (22 octets) :
   * [Header: 0x03 (1o) | PlayerIndex: 1o | Frame: 4o | CurrentInput: 4o | InputF-1: 4o | InputF-2: 4o | InputF-3: 4o]
   */
  sendLocalInput(frame, currentInput) {
    // Mise à jour de l'historique circulaire N-3
    const h1 = this.localInputHistory[0] || 0;
    const h2 = this.localInputHistory[1] || 0;
    const h3 = this.localInputHistory[2] || 0;

    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        const buffer = new ArrayBuffer(22);
        const view = new DataView(buffer);
        view.setUint8(0, 0x03); // Protocole redondant N-3
        view.setUint8(1, this.playerIndex);
        view.setUint32(2, frame, false);
        view.setInt32(6, currentInput, false);
        view.setInt32(10, h1, false);
        view.setInt32(14, h2, false);
        view.setInt32(18, h3, false);
        this.dataChannel.send(buffer);
      } catch(err) {
        console.warn('[RollbackManager] Erreur envoi WebRTC:', err.message);
      }
    }

    // Décalage de l'historique
    this.localInputHistory[2] = h2;
    this.localInputHistory[1] = h1;
    this.localInputHistory[0] = currentInput;
  }

  /**
   * Réception asynchrone des paquets d'inputs redondants
   */
  handleDataChannelMessage(event) {
    try {
      if (event.data instanceof ArrayBuffer) {
        const view = new DataView(event.data);
        const type = view.getUint8(0);

        if (type === 0x03) {
          // Paquet Redondant N-3
          const pIdx = view.getUint8(1);
          const frame = view.getUint32(2, false);
          const currentInput = view.getInt32(6, false);
          const h1 = view.getInt32(10, false);
          const h2 = view.getInt32(14, false);
          const h3 = view.getInt32(18, false);

          this.incomingPacketQueue.push({
            frame,
            inputs: [
              { f: frame, input: currentInput },
              { f: frame - 1, input: h1 },
              { f: frame - 2, input: h2 },
              { f: frame - 3, input: h3 }
            ]
          });
        } else if (type === 0x01) {
          // Paquet simple de compatibilité
          const frame = view.getUint32(1, false);
          const input = view.getInt32(5, false);
          this.incomingPacketQueue.push({
            frame,
            inputs: [{ f: frame, input }]
          });
        }
      } else if (typeof event.data === 'string') {
        const json = JSON.parse(event.data);
        if (json.type === 'INPUT_N3') {
          this.incomingPacketQueue.push({
            frame: json.frame,
            inputs: [
              { f: json.frame, input: json.input },
              { f: json.frame - 1, input: json.history?.[0] ?? json.input },
              { f: json.frame - 2, input: json.history?.[1] ?? json.input },
              { f: json.frame - 3, input: json.history?.[2] ?? json.input }
            ]
          });
        } else if (json.type === 'INPUT') {
          this.incomingPacketQueue.push({
            frame: json.frame,
            inputs: [{ f: json.frame, input: json.input || 0 }]
          });
        }
      }
    } catch(e) {
      console.warn('[RollbackManager] Paquet WebRTC malformé:', e);
    }
  }

  /**
   * Traite la file des paquets distants reçus et déclenche la réconciliation locale si divergence
   */
  processIncomingRemotePackets() {
    if (this.incomingPacketQueue.length === 0) return;

    let earliestMispredictedFrame = -1;

    while (this.incomingPacketQueue.length > 0) {
      const packet = this.incomingPacketQueue.shift();
      if (packet.frame > this.remoteFrameAdvancement) {
        this.remoteFrameAdvancement = packet.frame;
      }

      // Parcourir chaque entrée du paquet (frame courante + redondance N-3)
      for (const item of packet.inputs) {
        const { f, input } = item;
        if (f < 0) continue;

        const ringIndex = f & BUFFER_MASK;

        // Si la frame est dans le passé de notre simulation locale
        if (f < this.currentFrame) {
          const delta = this.currentFrame - f;
          if (delta <= MAX_ROLLBACK_FRAMES) {
            const predictedInput = this.remoteInputs[ringIndex];
            const wasPredicted = this.remoteInputPredicted[ringIndex] === 1;

            if (wasPredicted) {
              // Confirmer le vrai input
              this.remoteInputs[ringIndex] = input;
              this.remoteInputPredicted[ringIndex] = 0;

              // Divergence constatée : Rollback nécessaire
              if (predictedInput !== input) {
                this.stats.mispredictions++;
                if (earliestMispredictedFrame === -1 || f < earliestMispredictedFrame) {
                  earliestMispredictedFrame = f;
                }
              } else {
                // Prédiction correcte réparée par la redondance
                this.stats.recoveredByRedundancy++;
              }
            }
          }
        } else {
          // Input reçu à temps pour la frame courante ou future
          this.remoteInputs[ringIndex] = input;
          this.remoteInputPredicted[ringIndex] = 0; // Confirmé réel
          this.frameNumbers[ringIndex] = f;
        }
      }
    }

    // Déclencher le Rollback local depuis la frame divergente la plus ancienne
    if (earliestMispredictedFrame !== -1) {
      this.executeRollback(earliestMispredictedFrame);
    }
  }

  // ==========================================================================
  // GESTION DES SAVESTATES DANS LA MEMOIRE WASM (Zéro-Réseau en cours de jeu)
  // ==========================================================================

  saveStateToRingBuffer(frame) {
    if (!this.wasmStatePtr || !this.module._serialize) return;
    this.module._serialize(this.wasmStatePtr);
    const ringIndex = frame & BUFFER_MASK;
    this.savestates[ringIndex].set(this.module.HEAPU8.subarray(this.wasmStatePtr, this.wasmStatePtr + this.stateSize));
    this.frameNumbers[ringIndex] = frame;
  }

  loadStateFromRingBuffer(frame) {
    if (!this.wasmStatePtr || !this.module._unserialize) return;
    const ringIndex = frame & BUFFER_MASK;
    this.module.HEAPU8.set(this.savestates[ringIndex], this.wasmStatePtr);
    this.module._unserialize(this.wasmStatePtr);
  }

  // ==========================================================================
  // RECONCILIATION LOCALE : ROLLBACK & FAST-FORWARD RESIMULATION
  // ==========================================================================

  executeRollback(rollbackFrame) {
    const rollbackDistance = this.currentFrame - rollbackFrame;
    if (rollbackDistance <= 0) return;

    this.isRollingBack = true;
    this.stats.totalRollbacks++;
    this.stats.lastRollbackDistance = rollbackDistance;

    if (this.onRollback) {
      this.onRollback(rollbackDistance, this.currentFrame);
    }

    // 1. Recharger notre propre savestate saine locale de la frame erronée
    this.loadStateFromRingBuffer(rollbackFrame);

    // 2. Resimulation en Fast-Forward SANS rendu graphique/audio
    for (let f = rollbackFrame; f < this.currentFrame; f++) {
      const ringIndex = f & BUFFER_MASK;

      // Si l'input distant pour une frame suivante n'a pas encore été reçu, propager le dernier input réel
      if (this.remoteInputPredicted[ringIndex] === 1) {
        const prevIndex = (f - 1) & BUFFER_MASK;
        this.remoteInputs[ringIndex] = this.remoteInputs[prevIndex];
      }

      const p1Input = this.playerIndex === 0 ? this.localInputs[ringIndex] : this.remoteInputs[ringIndex];
      const p2Input = this.playerIndex === 0 ? this.remoteInputs[ringIndex] : this.localInputs[ringIndex];

      // Exécution de l'émulateur avec renderVideo = false (Skip Render)
      this.module._step(p1Input, p2Input, false);

      // Ré-enregistrement de la savestate corrigée
      this.saveStateToRingBuffer(f + 1);
    }

    this.isRollingBack = false;
  }

  // ==========================================================================
  // BOUCLE PRINCIPALE (FRAME LOOP 60 HZ) AVEC PACING SKIP-RENDER SANS PERTE AUDIO
  // ==========================================================================

  /**
   * Exécute un tick déterministe
   * @param {boolean} renderVideo Si false, exécute en Skip Render (Fast-Forward sans rendu canvas/audio)
   */
  tick(renderVideo = true) {
    const frame = this.currentFrame;
    const ringIndex = frame & BUFFER_MASK;

    // 1. Lecture de l'input physique local
    const localInput = this.getLocalInput() | 0;
    this.localInputs[ringIndex] = localInput;

    // 2. Émission WebRTC avec redondance N-3
    this.sendLocalInput(frame, localInput);

    // 3. Vérification de l'input distant
    let remoteInput = 0;
    if (this.remoteInputPredicted[ringIndex] === 0 && this.frameNumbers[ringIndex] === frame) {
      remoteInput = this.remoteInputs[ringIndex];
    } else {
      // Prédiction GGPO
      const prevRingIndex = (frame - 1) & BUFFER_MASK;
      remoteInput = frame > 0 ? this.remoteInputs[prevRingIndex] : 0;

      this.remoteInputs[ringIndex] = remoteInput;
      this.remoteInputPredicted[ringIndex] = 1;
      this.stats.predictedFramesCount++;
    }

    // 4. Capture de l'état local dans le Ring Buffer
    this.saveStateToRingBuffer(frame);

    // 5. Application des inputs (P1 / P2)
    const p1Input = this.playerIndex === 0 ? localInput : remoteInput;
    const p2Input = this.playerIndex === 0 ? remoteInput : localInput;

    // 6. Exécution de l'image (renderVideo contrôle le rendu visuel et audio)
    this.module._step(p1Input, p2Input, renderVideo);

    this.currentFrame++;
    this.stats.totalFrames++;
  }

  /**
   * Boucle requestAnimationFrame avec régulation de cadence (Pacing) par Skip Render
   * L'horloge audio et le timer du navigateur restent purs à 60Hz.
   */
  gameLoop(now) {
    if (!this.isRunning) return;

    const delta = now - this.lastTimestamp;
    this.lastTimestamp = now;

    // Plafond de protection contre les onglets masqués
    this.timeAccumulator += Math.min(delta, 100);

    // Dépouillement des paquets réseau
    this.processIncomingRemotePackets();

    // Consommation du temps accumulé
    while (this.timeAccumulator >= FRAME_TIME_MS) {
      // PACING DYNAMIQUE GGPO (Étage A optimisé) :
      // Si nous avons du retard par rapport à la progression confirmée du joueur distant
      const frameLag = this.remoteFrameAdvancement - this.currentFrame;

      if (frameLag > 1 && frameLag <= MAX_CATCHUP_FRAMES) {
        // Exécuter frameLag - 1 frames en Skip Render (Fast-Forward invisible)
        const catchupCount = frameLag - 1;
        for (let k = 0; k < catchupCount; k++) {
          this.tick(false); // renderVideo = false
          this.stats.catchupFramesExecuted++;
        }
      }

      // Exécuter la frame courante avec rendu visuel et audio normal
      this.tick(true);
      this.timeAccumulator -= FRAME_TIME_MS;
    }

    this.animationFrameId = requestAnimationFrame(this.gameLoop);
  }
}

export default RollbackManager;
