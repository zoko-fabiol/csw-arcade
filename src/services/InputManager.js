import { NEO_GEO_INPUTS } from './emulatorBridge';

/**
 * Gestionnaire d'Inputs Multi-Joueurs Haute Fréquence (60 Hz)
 * Prend en charge le remapping dynamique de touches et 2 manettes simultanées
 */
export class InputManager {
  constructor() {
    this.keyState = new Set();
    this.isListening = false;
    this.animationFrameId = null;
    this.onFrameCallback = null;

    // Mappings clavier dynamiques
    this.keyMapP1 = {};
    this.keyMapP2 = {};

    // Mappings manettes
    this.gamepadP1Index = 0;
    this.gamepadP2Index = 1;
    this.gamepadButtons = { a: 0, b: 1, c: 2, d: 3, coin: 8, start: 9 };

    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.tick = this.tick.bind(this);
  }

  /**
   * Met à jour les mappings depuis les paramètres utilisateur
   */
  applySettings(settings) {
    if (!settings || !settings.controls) return;

    // Reconstruction du dictionnaire P1 (CodeTouche -> Bitmask)
    const p1 = settings.controls.p1 || {};
    this.keyMapP1 = {
      [p1.up]: NEO_GEO_INPUTS.UP,
      [p1.down]: NEO_GEO_INPUTS.DOWN,
      [p1.left]: NEO_GEO_INPUTS.LEFT,
      [p1.right]: NEO_GEO_INPUTS.RIGHT,
      [p1.a]: NEO_GEO_INPUTS.BTN_A,
      [p1.b]: NEO_GEO_INPUTS.BTN_B,
      [p1.c]: NEO_GEO_INPUTS.BTN_C,
      [p1.d]: NEO_GEO_INPUTS.BTN_D,
      [p1.coin]: NEO_GEO_INPUTS.COIN,
      [p1.start]: NEO_GEO_INPUTS.START
    };

    // Reconstruction du dictionnaire P2
    const p2 = settings.controls.p2 || {};
    this.keyMapP2 = {
      [p2.up]: NEO_GEO_INPUTS.UP,
      [p2.down]: NEO_GEO_INPUTS.DOWN,
      [p2.left]: NEO_GEO_INPUTS.LEFT,
      [p2.right]: NEO_GEO_INPUTS.RIGHT,
      [p2.a]: NEO_GEO_INPUTS.BTN_A,
      [p2.b]: NEO_GEO_INPUTS.BTN_B,
      [p2.c]: NEO_GEO_INPUTS.BTN_C,
      [p2.d]: NEO_GEO_INPUTS.BTN_D,
      [p2.coin]: NEO_GEO_INPUTS.COIN,
      [p2.start]: NEO_GEO_INPUTS.START
    };

    if (settings.gamepad) {
      this.gamepadP1Index = settings.gamepad.p1Index ?? 0;
      this.gamepadP2Index = settings.gamepad.p2Index ?? 1;
      this.dpadMode = settings.gamepad.dpadMode || 'both';
      if (settings.gamepad.buttons) {
        this.gamepadButtons = { ...this.gamepadButtons, ...settings.gamepad.buttons };
      }
    }
  }

  start(onFrameCallback) {
    if (this.isListening) return;
    this.isListening = true;
    this.onFrameCallback = onFrameCallback;

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);

    this.animationFrameId = requestAnimationFrame(this.tick);
    console.log('[InputManager] Boucle de capture 60 Hz active.');
  }

  stop() {
    this.isListening = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.keyState.clear();
    console.log('[InputManager] Boucle de capture stoppée.');
  }

  handleKeyDown(event) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
      event.preventDefault();
    }
    this.keyState.add(event.code);
  }

  handleKeyUp(event) {
    this.keyState.delete(event.code);
  }

  /**
   * Échantillonne les inputs pour un joueur donné (Clavier + Manette associée)
   */
  pollPlayerInputs(playerNumber) {
    let mask = 0;
    const keyMap = playerNumber === 1 ? this.keyMapP1 : this.keyMapP2;
    const gamepadIdx = playerNumber === 1 ? this.gamepadP1Index : this.gamepadP2Index;

    // 1. Clavier
    for (const code of this.keyState) {
      if (keyMap[code]) {
        mask |= keyMap[code];
      }
    }

    // 2. Gamepad API
    if (navigator.getGamepads) {
      const gamepads = navigator.getGamepads();
      const gp = gamepads[gamepadIdx];

      if (gp && gp.connected) {
        // D-Pad standard et/ou Stick analogique selon le mode configuré
        const dpadMode = this.dpadMode || 'both';
        const useDpad = dpadMode === 'both' || dpadMode === 'dpad';
        const useAnalog = dpadMode === 'both' || dpadMode === 'analog';

        const up = (useDpad && !!gp.buttons[12]?.pressed) || (useAnalog && gp.axes[1] < -0.4);
        const down = (useDpad && !!gp.buttons[13]?.pressed) || (useAnalog && gp.axes[1] > 0.4);
        const left = (useDpad && !!gp.buttons[14]?.pressed) || (useAnalog && gp.axes[0] < -0.4);
        const right = (useDpad && !!gp.buttons[15]?.pressed) || (useAnalog && gp.axes[0] > 0.4);

        if (up) mask |= NEO_GEO_INPUTS.UP;
        if (down) mask |= NEO_GEO_INPUTS.DOWN;
        if (left) mask |= NEO_GEO_INPUTS.LEFT;
        if (right) mask |= NEO_GEO_INPUTS.RIGHT;

        // Boutons configurés
        const b = this.gamepadButtons;
        if (gp.buttons[b.a]?.pressed) mask |= NEO_GEO_INPUTS.BTN_A;
        if (gp.buttons[b.b]?.pressed) mask |= NEO_GEO_INPUTS.BTN_B;
        if (gp.buttons[b.c]?.pressed) mask |= NEO_GEO_INPUTS.BTN_C;
        if (gp.buttons[b.d]?.pressed) mask |= NEO_GEO_INPUTS.BTN_D;

        if (gp.buttons[b.coin]?.pressed) mask |= NEO_GEO_INPUTS.COIN;
        if (gp.buttons[b.start]?.pressed) mask |= NEO_GEO_INPUTS.START;
      }
    }

    return mask;
  }

  tick() {
    if (!this.isListening) return;

    const p1Mask = this.pollPlayerInputs(1);
    const p2Mask = this.pollPlayerInputs(2);

    if (this.onFrameCallback) {
      this.onFrameCallback({ p1: p1Mask, p2: p2Mask });
    }

    this.animationFrameId = requestAnimationFrame(this.tick);
  }
}

export const inputManager = new InputManager();
