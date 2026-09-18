import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'csw_arcade_settings_v1';

export const DEFAULT_SETTINGS = {
  controls: {
    p1: {
      up: 'KeyW',
      down: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      a: 'KeyJ',
      b: 'KeyK',
      c: 'KeyU',
      d: 'KeyI',
      coin: 'Digit5',
      start: 'Digit1'
    },
    p2: {
      up: 'ArrowUp',
      down: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight',
      a: 'Numpad4',
      b: 'Numpad5',
      c: 'Numpad7',
      d: 'Numpad8',
      coin: 'Digit6',
      start: 'Digit2'
    }
  },
  gamepad: {
    p1Index: 0,
    p2Index: 1,
    dpadMode: 'both', // 'both' | 'dpad' | 'analog'
    controllerType: 'auto', // 'auto' | 'xbox' | 'playstation' | 'switch'
    buttons: {
      a: 0,     // Bouton A (Croix / A)
      b: 1,     // Bouton B (Rond / B)
      c: 2,     // Bouton C (Carré / X)
      d: 3,     // Bouton D (Triangle / Y)
      coin: 8,  // Select / Share
      start: 9  // Start / Options
    }
  },
  video: {
    scanlines: true,
    aspectRatio: '4:3', // '4:3' | '16:9' | 'pixel-perfect'
    filter: 'pixelated', // 'pixelated' | 'smooth'
    intensity: 40 // 0 to 100
  },
  audio: {
    volume: 85,
    muted: false
  },
  system: {
    biosMode: 'mvs', // 'mvs' (Arcade) | 'aes' (Console Free Play)
    region: 'europe'  // 'europe' | 'usa' | 'japan'
  }
};

/**
 * Hook centralisant les préférences utilisateur NeoRAGEx avec persistance localStorage
 */
export function useSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          controls: {
            p1: { ...DEFAULT_SETTINGS.controls.p1, ...(parsed.controls?.p1 || {}) },
            p2: { ...DEFAULT_SETTINGS.controls.p2, ...(parsed.controls?.p2 || {}) }
          },
          gamepad: { ...DEFAULT_SETTINGS.gamepad, ...(parsed.gamepad || {}) },
          video: { ...DEFAULT_SETTINGS.video, ...(parsed.video || {}) },
          audio: { ...DEFAULT_SETTINGS.audio, ...(parsed.audio || {}) },
          system: { ...DEFAULT_SETTINGS.system, ...(parsed.system || {}) }
        };
      }
    } catch (e) {
      console.warn('[useSettings] Échec chargement localStorage:', e);
    }
    return DEFAULT_SETTINGS;
  });

  // Sauvegarde automatique lors de chaque modification
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('[useSettings] Échec écriture localStorage:', e);
    }
  }, [settings]);

  /**
   * Remappe une touche clavier pour un joueur
   * @param {'p1' | 'p2'} player
   * @param {string} action - 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'c' | 'd' | 'coin' | 'start'
   * @param {string} keyCode - Ex: 'KeyJ', 'Space', 'ArrowUp'
   */
  const updateKeyBinding = useCallback((player, action, keyCode) => {
    setSettings((prev) => ({
      ...prev,
      controls: {
        ...prev.controls,
        [player]: {
          ...prev.controls[player],
          [action]: keyCode
        }
      }
    }));
  }, []);

  /**
   * Met à jour les options d'affichage
   */
  const updateVideoSetting = useCallback((key, value) => {
    setSettings((prev) => ({
      ...prev,
      video: {
        ...prev.video,
        [key]: value
      }
    }));
  }, []);

  /**
   * Met à jour les options audio
   */
  const updateAudioSetting = useCallback((key, value) => {
    setSettings((prev) => ({
      ...prev,
      audio: {
        ...prev.audio,
        [key]: value
      }
    }));
  }, []);

  /**
   * Met à jour les options matérielles du BIOS
   */
  const updateSystemSetting = useCallback((key, value) => {
    setSettings((prev) => ({
      ...prev,
      system: {
        ...prev.system,
        [key]: value
      }
    }));
  }, []);

  /**
   * Met à jour les options de la manette
   */
  const updateGamepadSetting = useCallback((key, value) => {
    setSettings((prev) => ({
      ...prev,
      gamepad: {
        ...prev.gamepad,
        [key]: value
      }
    }));
  }, []);

  /**
   * Met à jour les options tactiles mobiles
   */
  const updateTouchSetting = useCallback((key, value) => {
    setSettings((prev) => ({
      ...prev,
      touch: {
        ...prev.touch,
        [key]: value
      }
    }));
  }, []);

  /**
   * Réinitialise l'ensemble des paramètres d'usine NeoRAGEx
   */
  const resetToDefaults = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, []);

  return {
    settings,
    updateKeyBinding,
    updateVideoSetting,
    updateAudioSetting,
    updateSystemSetting,
    updateGamepadSetting,
    updateTouchSetting,
    resetToDefaults
  };
}
