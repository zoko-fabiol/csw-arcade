/**
 * ============================================================================
 * CSW-ARCADE : SERVICE DE VERIFICATION DE DETERMINISME ET CHECKSUM (FNV-1a)
 * ============================================================================
 * Calcule et compare les checksums 32-bit de la Work RAM Neo Geo à intervalles
 * réguliers (toutes les 30 frames) pour détecter immédiatement toute divergence
 * d'émulation (desync) entre les deux pairs WebRTC.
 * ============================================================================
 */

export class NetplayChecksumService {
  /**
   * @param {Object} options
   * @param {Object} options.gameManager Instance EJS_GameManager de FBNeo
   * @param {Function} [options.sendPacket] Callback pour émettre le paquet binaire WebRTC
   * @param {Function} [options.onDesync] Callback alertant d'une désynchronisation avérée
   * @param {Function} [options.onSyncConfirmed] Callback confirmant la parfaite parité déterministe
   */
  constructor({
    gameManager = null,
    sendPacket = () => {},
    onDesync = () => {},
    onSyncConfirmed = () => {}
  } = {}) {
    this.gm = gameManager;
    this.sendPacket = sendPacket;
    this.onDesync = onDesync;
    this.onSyncConfirmed = onSyncConfirmed;

    this.checkInterval = 30; // Vérification toutes les 30 frames (~0.5 seconde)
    this.localChecksums = new Map(); // frame -> checksum string
    this.remoteChecksums = new Map(); // frame -> checksum string

    this.desyncDetected = false;
    this.totalChecks = 0;
    this.matchesCount = 0;
    this.mismatchesCount = 0;
  }

  setGameManager(gm) {
    this.gm = gm;
  }

  /**
   * Calcul de hash FNV-1a 32-bit ultra-rapide sur un TypedArray
   * @param {Uint8Array} u8Array 
   * @returns {string} Hash hexadécimal 8 caractères
   */
  static calculateFNV1a(u8Array) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < u8Array.length; i++) {
      hash ^= u8Array[i];
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  /**
   * Extrait la tranche de mémoire vive Neo Geo 68000 (Work RAM de 64 Ko)
   * @returns {Uint8Array}
   */
  getNeoGeoRAMSlice() {
    if (!this.gm) return new Uint8Array(0);
    const heap = this.gm.Module?.HEAPU8;
    if (!heap) return new Uint8Array(0);

    const baseOffset = 0x100000;
    if (heap.length > baseOffset + 0x10000) {
      return heap.subarray(baseOffset, baseOffset + 0x10000);
    }
    return heap.subarray(0, Math.min(heap.length, 0x10000));
  }

  /**
   * Appelée à chaque frame de la simulation
   * @param {number} frame Numéro de frame courante
   */
  onFrame(frame) {
    if (frame % this.checkInterval !== 0) return;

    const ram = this.getNeoGeoRAMSlice();
    if (!ram || ram.length === 0) return;

    const checksum = NetplayChecksumService.calculateFNV1a(ram);
    this.localChecksums.set(frame, checksum);

    // Émission du paquet binaire : [Header 0xCB (1o) | Frame (4o) | ChecksumInt (4o)]
    const checksumInt = parseInt(checksum, 16) >>> 0;
    const buf = new ArrayBuffer(9);
    const view = new DataView(buf);
    view.setUint8(0, 0xCB);
    view.setUint32(1, frame, false);
    view.setUint32(5, checksumInt, false);

    this.sendPacket(buf);

    // Nettoyage de l'historique ancien (> 180 frames)
    if (this.localChecksums.size > 20) {
      const oldestFrame = frame - 180;
      for (const f of this.localChecksums.keys()) {
        if (f < oldestFrame) this.localChecksums.delete(f);
      }
    }

    // Vérifier si le checksum distant est déjà arrivé pour cette frame
    if (this.remoteChecksums.has(frame)) {
      this.compare(frame);
    }
  }

  /**
   * Traite un paquet binaire reçu du pair
   * @param {DataView|ArrayBuffer} data 
   */
  handleRemotePacket(data) {
    const view = data instanceof DataView ? data : new DataView(data);
    const type = view.getUint8(0);
    if (type !== 0xCB) return;

    const frame = view.getUint32(1, false);
    const checksumInt = view.getUint32(5, false);
    const checksum = checksumInt.toString(16).padStart(8, '0');

    this.remoteChecksums.set(frame, checksum);

    // Nettoyage
    if (this.remoteChecksums.size > 20) {
      const oldestFrame = frame - 180;
      for (const f of this.remoteChecksums.keys()) {
        if (f < oldestFrame) this.remoteChecksums.delete(f);
      }
    }

    if (this.localChecksums.has(frame)) {
      this.compare(frame);
    }
  }

  /**
   * Compare le checksum local et distant pour une frame donnée
   * @param {number} frame 
   */
  compare(frame) {
    const local = this.localChecksums.get(frame);
    const remote = this.remoteChecksums.get(frame);
    if (!local || !remote) return;

    this.totalChecks++;

    if (local === remote) {
      this.matchesCount++;
      if (this.onSyncConfirmed) {
        this.onSyncConfirmed(frame, local);
      }
    } else {
      this.mismatchesCount++;
      console.warn(`[NetplayChecksum] ⚠️ DIVERGENCE DÉTECTÉE frame ${frame} : Local=[${local}] vs Distant=[${remote}]`);
      this.desyncDetected = true;
      if (this.onDesync) {
        this.onDesync(frame, local, remote);
      }
    }
  }

  getStats() {
    return {
      totalChecks: this.totalChecks,
      matches: this.matchesCount,
      mismatches: this.mismatchesCount,
      syncRatio: this.totalChecks > 0 ? (this.matchesCount / this.totalChecks) : 1,
      desyncDetected: this.desyncDetected
    };
  }

  reset() {
    this.localChecksums.clear();
    this.remoteChecksums.clear();
    this.desyncDetected = false;
    this.totalChecks = 0;
    this.matchesCount = 0;
    this.mismatchesCount = 0;
  }
}

export default NetplayChecksumService;
