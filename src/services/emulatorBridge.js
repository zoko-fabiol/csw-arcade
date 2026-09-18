/**
 * Neo Geo Button Bitmask Constants (16-bit format)
 * Structure compacte pour encodage binaire haute performance (60 FPS)
 */
export const NEO_GEO_INPUTS = {
  UP:    1 << 0,  // 0x0001
  DOWN:  1 << 1,  // 0x0002
  LEFT:  1 << 2,  // 0x0004
  RIGHT: 1 << 3,  // 0x0008
  BTN_A: 1 << 4,  // 0x0010 (Light Punch / Attack 1)
  BTN_B: 1 << 5,  // 0x0020 (Light Kick / Attack 2)
  BTN_C: 1 << 6,  // 0x0040 (Heavy Punch / Attack 3)
  BTN_D: 1 << 7,  // 0x0080 (Heavy Kick / Attack 4)
  COIN:  1 << 8,  // 0x0100 (Coin / Select)
  START: 1 << 9   // 0x0200 (Start)
};

/**
 * Service de gestion et d'orchestration du Module WebAssembly Emscripten
 */
class EmulatorBridgeService {
  constructor() {
    this.module = null;
    this.isInitialized = false;
    this.isRunning = false;
    this.currentLoopId = null;
    this.audioContext = null;
    this.onFrameCallback = null;

    // Buffer d'input 16-bit pour Player 1 et Player 2
    this.inputStateP1 = 0;
    this.inputStateP2 = 0;
  }

  /**
   * Initialise le contexte audio Web Audio API
   */
  initAudio() {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx({ latencyHint: 'interactive', sampleRate: 44100 });
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  /**
   * Monte les fichiers binaires des ROMs dans le Virtual File System (Emscripten MEMFS)
   * @param {Object} emscriptenModule - Instance Module injectée par Emscripten
   * @param {ArrayBuffer} neogeoBuffer - Binaire neogeo.zip
   * @param {string} gameFilename - Ex: "mslug.zip"
   * @param {ArrayBuffer} gameBuffer - Binaire de la ROM de jeu
   */
  mountRomsToFS(emscriptenModule, neogeoBuffer, gameFilename, gameBuffer) {
    const FS = emscriptenModule.FS;
    if (!FS) {
      throw new Error("L'objet FS (Emscripten Virtual File System) n'est pas disponible.");
    }

    try {
      // Création du répertoire virtuel /roms
      try {
        FS.mkdir('/roms');
      } catch (e) {
        // Le répertoire existe déjà lors de rechargements
      }

      // Écriture du BIOS universel Neo Geo
      console.log('[EmulatorBridge] Montage FS de neogeo.zip...');
      FS.writeFile('/roms/neogeo.zip', new Uint8Array(neogeoBuffer));

      // Écriture du fichier du jeu
      console.log(`[EmulatorBridge] Montage FS de ${gameFilename}...`);
      FS.writeFile(`/roms/${gameFilename}`, new Uint8Array(gameBuffer));

      console.log('[EmulatorBridge] Montage FS Emscripten terminé avec succès.');
    } catch (err) {
      console.error('[EmulatorBridge] Erreur critique lors de FS.writeFile:', err);
      throw err;
    }
  }

  /**
   * Injection directe des inputs dans la mémoire / ports du core WASM
   * @param {number} player - 1 ou 2
   * @param {number} bitmask - 16-bit input bitmask
   */
  injectInput(player, bitmask) {
    if (player === 1) {
      this.inputStateP1 = bitmask;
    } else if (player === 2) {
      this.inputStateP2 = bitmask;
    }

    // Si le core WASM exporte une fonction C/C++ directe (ex: retro_set_controller_port_device ou fbneo_set_input)
    if (this.module && typeof this.module._fbneo_set_input === 'function') {
      this.module._fbneo_set_input(player - 1, bitmask);
    } else if (this.module && this.module.ccall) {
      try {
        this.module.ccall('set_player_input', 'void', ['number', 'number'], [player - 1, bitmask]);
      } catch {
        // Fallback silencieux si export dynamique
      }
    }
  }

  /**
   * Arrêt propre du moteur et libération de la mémoire
   */
  shutdown() {
    this.isRunning = false;
    if (this.currentLoopId) {
      cancelAnimationFrame(this.currentLoopId);
      this.currentLoopId = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.module = null;
    this.isInitialized = false;
    console.log('[EmulatorBridge] Moteur émulateur stoppé.');
  }
}

export const emulatorBridge = new EmulatorBridgeService();
