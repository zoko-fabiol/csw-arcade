/**
 * ============================================================================
 * CSW-ARCADE : ROLLBACK NETCODE ENGINE (TYPE GGPO)
 * ============================================================================
 * Moteur de synchronisation déterministe prédictif avec retour en arrière
 * (Rollback & Fast-Forward Resimulation) pour FinalBurn Neo (FBNeo) WebAssembly.
 *
 * Principes architecturaux :
 * 1. Emulateur FBNeo traité comme une boîte noire déterministe.
 * 2. Ring Buffers circulaires pour inputs locaux, inputs distants et savestates.
 * 3. Boucle à pas de temps fixe (Fixed Timestep 60Hz) avec accumulateur.
 * 4. Prédiction des inputs distants en cas de gigue/latence réseau.
 * 5. Réconciliation immédiate (Rollback + Fast-forward sans rendu visuel/audio)
 *    lors de la réception d'un input distant divergent.
 * 6. Gestion zéro-allocation dans la boucle critique via pointeurs persistants
 *    sur le tas linéaire Emscripten (HEAPU8).
 * ============================================================================
 */

export const BUFFER_SIZE = 128; // Puissance de 2 pour modulo binaire (& BUFFER_MASK)
export const BUFFER_MASK = BUFFER_SIZE - 1;
export const MAX_ROLLBACK_FRAMES = 120; // Seuil maximal de réconciliation en frames
export const FRAME_TIME_MS = 1000 / 60; // 16.6667 ms (60 FPS standard NTSC Arcade)

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

    // --- ETAT TEMPOREL ---
    this.currentFrame = 0;
    this.remoteFrameAdvancement = 0;
    this.isRunning = false;
    this.isRollingBack = false;
    this.animationFrameId = null;
    this.lastTimestamp = 0;
    this.timeAccumulator = 0;

    // --- TAILLE DE SAVESTATE & MEMOIRE WASM ---
    this.stateSize = 0;
    this.wasmStatePtr = null;

    // --- RING BUFFERS (Mémoires Tampons Circulaires) ---
    // Inputs sous forme d'entiers 32-bit (masques de boutons RetroPad Neo Geo)
    this.localInputs = new Int32Array(BUFFER_SIZE);
    this.remoteInputs = new Int32Array(BUFFER_SIZE);
    this.remoteInputPredicted = new Uint8Array(BUFFER_SIZE); // 1 = prédit, 0 = confirmé réel
    this.frameNumbers = new Int32Array(BUFFER_SIZE).fill(-1);

    // Tableau de Uint8Array contenant les instantanés mémoire de FBNeo
    this.savestates = new Array(BUFFER_SIZE);

    // File d'attente des paquets reçus par WebRTC avant intégration
    this.incomingPacketQueue = [];

    // --- STATISTIQUES & TELEMETRIE GGPO ---
    this.stats = {
      fps: 60,
      totalFrames: 0,
      totalRollbacks: 0,
      lastRollbackDistance: 0,
      mispredictions: 0,
      predictedFramesCount: 0,
      rttMs: 0
    };
    this.statsInterval = null;

    // Liaison des méthodes de rappel
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
        // Recherche dans ccall/cwrap si non exporté directement avec underscore
        const cleanName = fn.replace(/^_/, '');
        if (typeof this.module[cleanName] === 'function') {
          this.module[fn] = this.module[cleanName];
        } else {
          console.warn(`[RollbackManager] Avertissement: Symbole WASM ${fn} non trouvé directement sur Module.`);
        }
      }
    }

    // Détermination de la taille en octets de l'état déterministe de FBNeo
    try {
      this.stateSize = this.module._serialize_size ? this.module._serialize_size() : 0;
    } catch(e) {
      console.warn('[RollbackManager] Erreur appel _serialize_size:', e.message);
      this.stateSize = 0;
    }

    if (this.stateSize <= 0) {
      // Taille standard de repli pour la RAM Neo Geo (68000 + Z80 + VRAM + YM2610) ~ 512 Ko
      this.stateSize = 512 * 1024;
      console.info(`[RollbackManager] Utilisation d'une taille de savestate par défaut : ${this.stateSize} octets.`);
    } else {
      console.info(`[RollbackManager] Taille de savestate FBNeo détectée : ${this.stateSize} octets.`);
    }

    // Allocation d'un bloc de mémoire persistant dans le tas WebAssembly (HEAPU8)
    // Réutilisé à chaque frame pour éviter la fragmentation et le ramasse-miettes (GC)
    if (typeof this.module._malloc === 'function') {
      this.wasmStatePtr = this.module._malloc(this.stateSize);
    } else {
      throw new Error('[RollbackManager] Module._malloc introuvable. Emscripten doit exporter _malloc.');
    }

    // Pré-allocation des TypedArrays du Ring Buffer de savestates
    for (let i = 0; i < BUFFER_SIZE; i++) {
      this.savestates[i] = new Uint8Array(this.stateSize);
    }

    // Capture de la frame initiale 0
    this.saveStateToRingBuffer(0);
    console.log('[RollbackManager] Initialisé avec succès. Ring buffer alloué.');
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

    // Télémétrie toutes les 500 ms
    this.statsInterval = setInterval(() => {
      if (this.onStatsUpdate) {
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
  // GESTION DU RESEAU WEBRTC & PAQUETS BINAIRES COMPACTS
  // ==========================================================================

  /**
   * Émet l'input local sur le DataChannel WebRTC
   * Format compact : [Type: 0x01 (1o), Frame (4o uint32), Input (4o int32)] = 9 octets
   */
  sendLocalInput(frame, input) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;

    try {
      const buffer = new ArrayBuffer(9);
      const view = new DataView(buffer);
      view.setUint8(0, 0x01); // Header identifiant paquet input
      view.setUint32(1, frame, false); // Big endian
      view.setInt32(5, input, false);
      this.dataChannel.send(buffer);
    } catch(err) {
      console.warn('[RollbackManager] Erreur envoi WebRTC:', err.message);
    }
  }

  /**
   * Réception asynchrone des messages réseau via le DataChannel
   */
  handleDataChannelMessage(event) {
    try {
      if (event.data instanceof ArrayBuffer) {
        const view = new DataView(event.data);
        const type = view.getUint8(0);
        if (type === 0x01) {
          const frame = view.getUint32(1, false);
          const input = view.getInt32(5, false);
          this.incomingPacketQueue.push({ frame, input });
        }
      } else if (typeof event.data === 'string') {
        const json = JSON.parse(event.data);
        if (json.type === 'INPUT' && typeof json.frame === 'number') {
          this.incomingPacketQueue.push({ frame: json.frame, input: json.input || 0 });
        }
      }
    } catch(e) {
      console.warn('[RollbackManager] Paquet WebRTC malformé:', e);
    }
  }

  /**
   * Traite la file des paquets distants reçus et déclenche la réconciliation si nécessaire
   */
  processIncomingRemotePackets() {
    if (this.incomingPacketQueue.length === 0) return;

    let earliestMispredictedFrame = -1;

    while (this.incomingPacketQueue.length > 0) {
      const packet = this.incomingPacketQueue.shift();
      const { frame, input } = packet;

      if (frame > this.remoteFrameAdvancement) {
        this.remoteFrameAdvancement = frame;
      }

      // Si le paquet correspond à une frame déjà simulée dans le passé
      if (frame < this.currentFrame) {
        const delta = this.currentFrame - frame;
        if (delta <= MAX_ROLLBACK_FRAMES) {
          const ringIndex = frame & BUFFER_MASK;
          const predictedInput = this.remoteInputs[ringIndex];
          const wasPredicted = this.remoteInputPredicted[ringIndex] === 1;

          // Enregistrement du vrai input reçu
          this.remoteInputs[ringIndex] = input;
          this.remoteInputPredicted[ringIndex] = 0; // Confirmé

          // Vérification de divergence entre la prédiction et la réalité
          if (wasPredicted && predictedInput !== input) {
            this.stats.mispredictions++;
            if (earliestMispredictedFrame === -1 || frame < earliestMispredictedFrame) {
              earliestMispredictedFrame = frame;
            }
          }
        } else {
          console.warn(`[RollbackManager] Paquet trop ancien ignoré (Delta: ${delta} frames).`);
        }
      } else {
        // Paquet reçu à temps pour la frame courante ou future
        const ringIndex = frame & BUFFER_MASK;
        this.remoteInputs[ringIndex] = input;
        this.remoteInputPredicted[ringIndex] = 0; // Confirmé réel
        this.frameNumbers[ringIndex] = frame;
      }
    }

    // Si une divergence a été constatée, déclencher le Rollback depuis la frame la plus ancienne erronée
    if (earliestMispredictedFrame !== -1) {
      this.executeRollback(earliestMispredictedFrame);
    }
  }

  // ==========================================================================
  // GESTION DES SAVESTATES DANS LA MEMOIRE LINEAIRE WASM (HEAPU8)
  // ==========================================================================

  /**
   * Sauvegarde l'état du core FBNeo dans le ring buffer pour une frame donnée
   * @param {number} frame
   */
  saveStateToRingBuffer(frame) {
    if (!this.wasmStatePtr || !this.module._serialize) return;

    // 1. Demande au module C++ d'écrire la RAM dans notre pointeur WASM
    this.module._serialize(this.wasmStatePtr);

    // 2. Copie immédiate depuis Module.HEAPU8 vers le TypedArray du Ring Buffer
    const ringIndex = frame & BUFFER_MASK;
    const destBuffer = this.savestates[ringIndex];
    destBuffer.set(this.module.HEAPU8.subarray(this.wasmStatePtr, this.wasmStatePtr + this.stateSize));

    this.frameNumbers[ringIndex] = frame;
  }

  /**
   * Restaure l'état du core FBNeo depuis le ring buffer pour une frame donnée
   * @param {number} frame
   */
  loadStateFromRingBuffer(frame) {
    if (!this.wasmStatePtr || !this.module._unserialize) return;

    const ringIndex = frame & BUFFER_MASK;
    const srcBuffer = this.savestates[ringIndex];

    // 1. Copie depuis notre buffer JS vers la mémoire WASM
    this.module.HEAPU8.set(srcBuffer, this.wasmStatePtr);

    // 2. Restauration de l'état dans l'émulateur FBNeo
    this.module._unserialize(this.wasmStatePtr);
  }

  // ==========================================================================
  // ALGORITHME DE ROLLBACK & RESIMULATION (FAST-FORWARD)
  // ==========================================================================

  /**
   * Exécute le Rollback depuis une frame passée jusqu'à la frame courante
   * @param {number} rollbackFrame Numéro de frame à restaurer
   */
  executeRollback(rollbackFrame) {
    const rollbackDistance = this.currentFrame - rollbackFrame;
    if (rollbackDistance <= 0) return;

    this.isRollingBack = true;
    this.stats.totalRollbacks++;
    this.stats.lastRollbackDistance = rollbackDistance;

    if (this.onRollback) {
      this.onRollback(rollbackDistance, this.currentFrame);
    }

    // 1. Charger la savestate saine de la frame erronée
    this.loadStateFromRingBuffer(rollbackFrame);

    // 2. Boucle de resimulation en avance rapide (Fast-Forward)
    // Note: renderVideo = false pour désactiver le rendu vidéo et audio,
    // garantissant une ré-exécution ultra-rapide en moins d'une milliseconde.
    for (let f = rollbackFrame; f < this.currentFrame; f++) {
      const ringIndex = f & BUFFER_MASK;

      // Si l'input distant pour les frames intermédiaires était une prédiction,
      // la mettre à jour avec la dernière valeur réelle confirmée
      if (this.remoteInputPredicted[ringIndex] === 1) {
        const prevIndex = (f - 1) & BUFFER_MASK;
        this.remoteInputs[ringIndex] = this.remoteInputs[prevIndex];
      }

      const p1Input = this.playerIndex === 0 ? this.localInputs[ringIndex] : this.remoteInputs[ringIndex];
      const p2Input = this.playerIndex === 0 ? this.remoteInputs[ringIndex] : this.localInputs[ringIndex];

      // Exécution de la frame SANS rendu graphique/audio
      this.module._step(p1Input, p2Input, false);

      // Ré-enregistrement de la savestate corrigée
      this.saveStateToRingBuffer(f + 1);
    }

    this.isRollingBack = false;
  }

  // ==========================================================================
  // BOUCLE PRINCIPALE (FRAME LOOP A 60 HZ)
  // ==========================================================================

  /**
   * Avance l'émulateur d'une frame (Tick déterministe)
   */
  tick() {
    const frame = this.currentFrame;
    const ringIndex = frame & BUFFER_MASK;

    // 1. Récupération de l'input physique local
    const localInput = this.getLocalInput() | 0;
    this.localInputs[ringIndex] = localInput;

    // 2. Envoi immédiat de l'input sur le réseau via WebRTC DataChannel
    this.sendLocalInput(frame, localInput);

    // 3. Vérification de l'input distant pour cette frame
    let remoteInput = 0;
    if (this.remoteInputPredicted[ringIndex] === 0 && this.frameNumbers[ringIndex] === frame) {
      // L'input réel distant est déjà arrivé à temps !
      remoteInput = this.remoteInputs[ringIndex];
    } else {
      // PREDICTION GGPO : L'input n'est pas encore arrivé à cause de la latence réseau.
      // On prédit qu'il est identique à l'input de la frame précédente.
      const prevRingIndex = (frame - 1) & BUFFER_MASK;
      remoteInput = frame > 0 ? this.remoteInputs[prevRingIndex] : 0;

      this.remoteInputs[ringIndex] = remoteInput;
      this.remoteInputPredicted[ringIndex] = 1; // Marqué comme prédit
      this.stats.predictedFramesCount++;
    }

    // 4. Sauvegarder l'état complet du core avant de faire le step
    this.saveStateToRingBuffer(frame);

    // 5. Mapper les inputs selon notre rôle (P1 ou P2)
    const p1Input = this.playerIndex === 0 ? localInput : remoteInput;
    const p2Input = this.playerIndex === 0 ? remoteInput : localInput;

    // 6. Avancer l'émulateur d'une frame AVEC rendu vidéo et audio normal
    this.module._step(p1Input, p2Input, true);

    this.currentFrame++;
    this.stats.totalFrames++;
  }

  /**
   * Boucle requestAnimationFrame avec régulateur de cadence fixe
   */
  gameLoop(now) {
    if (!this.isRunning) return;

    const delta = now - this.lastTimestamp;
    this.lastTimestamp = now;

    // Protection contre les pauses d'onglets (delta cap à 100ms)
    this.timeAccumulator += Math.min(delta, 100);

    // Traiter d'abord les paquets réseau arrivés
    this.processIncomingRemotePackets();

    // Consommer le temps accumulé à cadence fixe de 60Hz
    while (this.timeAccumulator >= FRAME_TIME_MS) {
      this.tick();
      this.timeAccumulator -= FRAME_TIME_MS;
    }

    this.animationFrameId = requestAnimationFrame(this.gameLoop);
  }
}

export default RollbackManager;
