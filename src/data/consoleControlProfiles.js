/**
 * Profils de touches configurables (Clavier + Manette) pour chaque univers console :
 * Arcade / Neo Geo, Nintendo, PlayStation, Sega et Java / J2ME.
 */

export const CONSOLE_CONTROL_PROFILES = [
  {
    id: 'arcade',
    label: 'Arcade / Neo Geo',
    shortLabel: 'Arcade',
    description: 'Neo Geo MVS/AES · CPS1/CPS2 · MAME (4 boutons + Macros + Coin/Start)',
    actions: [
      { key: 'up', label: 'Direction : HAUT', badge: '↑', defaultP1: 'KeyW', defaultP2: 'ArrowUp', defaultPad: null },
      { key: 'down', label: 'Direction : BAS', badge: '↓', defaultP1: 'KeyS', defaultP2: 'ArrowDown', defaultPad: null },
      { key: 'left', label: 'Direction : GAUCHE', badge: '←', defaultP1: 'KeyA', defaultP2: 'ArrowLeft', defaultPad: null },
      { key: 'right', label: 'Direction : DROITE', badge: '→', defaultP1: 'KeyD', defaultP2: 'ArrowRight', defaultPad: null },
      { key: 'a', label: 'Bouton A (Poing Faible / Tir)', badge: 'A', defaultP1: 'KeyJ', defaultP2: 'Numpad4', defaultPad: 0 },
      { key: 'b', label: 'Bouton B (Pied Faible / Saut)', badge: 'B', defaultP1: 'KeyK', defaultP2: 'Numpad5', defaultPad: 1 },
      { key: 'c', label: 'Bouton C (Poing Fort / Grenade)', badge: 'C', defaultP1: 'KeyU', defaultP2: 'Numpad7', defaultPad: 2 },
      { key: 'd', label: 'Bouton D (Pied Fort / Spécial)', badge: 'D', defaultP1: 'KeyI', defaultP2: 'Numpad8', defaultPad: 3 },
      { key: 'ab', label: 'Macro A+B (Roulade / Esquive KOF)', badge: 'A+B', defaultP1: 'KeyO', defaultP2: 'Numpad9', defaultPad: 4 },
      { key: 'cd', label: 'Macro C+D (Projection Blowback)', badge: 'C+D', defaultP1: 'KeyP', defaultP2: 'Numpad6', defaultPad: 5 },
      { key: 'abc', label: 'Macro A+B+C (MAX Mode / Super)', badge: 'MAX', defaultP1: 'KeyL', defaultP2: 'Numpad1', defaultPad: 6 },
      { key: 'turbo', label: 'Turbo A (Tir Automatique 30Hz)', badge: 'TURBO', defaultP1: 'KeyH', defaultP2: 'Numpad0', defaultPad: 7 },
      { key: 'coin', label: 'COIN (Sync Crédits RAM)', badge: 'COIN', defaultP1: 'Digit5', defaultP2: 'Digit6', defaultPad: 8 },
      { key: 'start', label: 'START (Lancer Partie)', badge: 'START', defaultP1: 'Digit1', defaultP2: 'Digit2', defaultPad: 9 },
    ],
  },
  {
    id: 'nintendo',
    label: 'Nintendo',
    shortLabel: 'Nintendo',
    description: 'NES · SNES · GBA · Game Boy · Nintendo 64 (Stick + Croix + A/B/X/Y + L/R/Z)',
    actions: [
      { key: 'up', label: 'Stick / Croix : HAUT', badge: '↑', defaultP1: 'KeyW', defaultP2: 'ArrowUp', defaultPad: null },
      { key: 'down', label: 'Stick / Croix : BAS', badge: '↓', defaultP1: 'KeyS', defaultP2: 'ArrowDown', defaultPad: null },
      { key: 'left', label: 'Stick / Croix : GAUCHE', badge: '←', defaultP1: 'KeyA', defaultP2: 'ArrowLeft', defaultPad: null },
      { key: 'right', label: 'Stick / Croix : DROITE', badge: '→', defaultP1: 'KeyD', defaultP2: 'ArrowRight', defaultPad: null },
      { key: 'a', label: 'Bouton B / A (Confirmer / Saut)', badge: 'B/A', defaultP1: 'KeyJ', defaultP2: 'Numpad4', defaultPad: 0 },
      { key: 'b', label: 'Bouton A / B (Action / Frein)', badge: 'A/B', defaultP1: 'KeyK', defaultP2: 'Numpad5', defaultPad: 1 },
      { key: 'c', label: 'Bouton Y / C-Bas', badge: 'Y/C↓', defaultP1: 'KeyU', defaultP2: 'Numpad7', defaultPad: 2 },
      { key: 'd', label: 'Bouton X / C-Haut', badge: 'X/C↑', defaultP1: 'KeyI', defaultP2: 'Numpad8', defaultPad: 3 },
      { key: 'l1', label: 'Gâchette L (SNES / GBA / N64)', badge: 'L', defaultP1: 'KeyQ', defaultP2: 'Numpad9', defaultPad: 4 },
      { key: 'r1', label: 'Gâchette R (SNES / GBA / N64)', badge: 'R', defaultP1: 'KeyE', defaultP2: 'Numpad6', defaultPad: 5 },
      { key: 'l2', label: 'Gâchette Z-Trigger (N64)', badge: 'Z', defaultP1: 'KeyZ', defaultP2: 'Numpad1', defaultPad: 6 },
      { key: 'r2', label: 'Bouton C-Droite / R2', badge: 'C→', defaultP1: 'KeyC', defaultP2: 'Numpad3', defaultPad: 7 },
      { key: 'coin', label: 'SELECT', badge: 'SEL', defaultP1: 'ShiftLeft', defaultP2: 'NumpadSubtract', defaultPad: 8 },
      { key: 'start', label: 'START (Pause / Menu)', badge: 'START', defaultP1: 'Enter', defaultP2: 'NumpadEnter', defaultPad: 9 },
    ],
  },
  {
    id: 'playstation',
    label: 'PlayStation',
    shortLabel: 'PS1',
    description: 'PS1 DualShock (Croix ✕ · Rond ○ · Carré □ · Triangle △ · L1/R1/L2/R2)',
    actions: [
      { key: 'up', label: 'Croix / Stick : HAUT', badge: '↑', defaultP1: 'KeyW', defaultP2: 'ArrowUp', defaultPad: null },
      { key: 'down', label: 'Croix / Stick : BAS', badge: '↓', defaultP1: 'KeyS', defaultP2: 'ArrowDown', defaultPad: null },
      { key: 'left', label: 'Croix / Stick : GAUCHE', badge: '←', defaultP1: 'KeyA', defaultP2: 'ArrowLeft', defaultPad: null },
      { key: 'right', label: 'Croix / Stick : DROITE', badge: '→', defaultP1: 'KeyD', defaultP2: 'ArrowRight', defaultPad: null },
      { key: 'a', label: 'Bouton Croix ✕', badge: '✕', defaultP1: 'KeyJ', defaultP2: 'Numpad4', defaultPad: 0 },
      { key: 'b', label: 'Bouton Rond ○', badge: '○', defaultP1: 'KeyK', defaultP2: 'Numpad5', defaultPad: 1 },
      { key: 'c', label: 'Bouton Carré □', badge: '□', defaultP1: 'KeyU', defaultP2: 'Numpad7', defaultPad: 2 },
      { key: 'd', label: 'Bouton Triangle △', badge: '△', defaultP1: 'KeyI', defaultP2: 'Numpad8', defaultPad: 3 },
      { key: 'l1', label: 'Gâchette L1', badge: 'L1', defaultP1: 'KeyQ', defaultP2: 'Numpad9', defaultPad: 4 },
      { key: 'r1', label: 'Gâchette R1', badge: 'R1', defaultP1: 'KeyE', defaultP2: 'Numpad6', defaultPad: 5 },
      { key: 'l2', label: 'Gâchette L2', badge: 'L2', defaultP1: 'KeyZ', defaultP2: 'Numpad1', defaultPad: 6 },
      { key: 'r2', label: 'Gâchette R2', badge: 'R2', defaultP1: 'KeyC', defaultP2: 'Numpad3', defaultPad: 7 },
      { key: 'coin', label: 'SELECT', badge: 'SEL', defaultP1: 'ShiftLeft', defaultP2: 'NumpadSubtract', defaultPad: 8 },
      { key: 'start', label: 'START', badge: 'START', defaultP1: 'Enter', defaultP2: 'NumpadEnter', defaultPad: 9 },
    ],
  },
  {
    id: 'sega',
    label: 'Sega',
    shortLabel: 'Sega',
    description: 'Mega Drive / Genesis (6 boutons A/B/C/X/Y/Z) · Master System · Game Gear',
    actions: [
      { key: 'up', label: 'Croix D-Pad : HAUT', badge: '↑', defaultP1: 'KeyW', defaultP2: 'ArrowUp', defaultPad: null },
      { key: 'down', label: 'Croix D-Pad : BAS', badge: '↓', defaultP1: 'KeyS', defaultP2: 'ArrowDown', defaultPad: null },
      { key: 'left', label: 'Croix D-Pad : GAUCHE', badge: '←', defaultP1: 'KeyA', defaultP2: 'ArrowLeft', defaultPad: null },
      { key: 'right', label: 'Croix D-Pad : DROITE', badge: '→', defaultP1: 'KeyD', defaultP2: 'ArrowRight', defaultPad: null },
      { key: 'a', label: 'Bouton A', badge: 'A', defaultP1: 'KeyJ', defaultP2: 'Numpad4', defaultPad: 0 },
      { key: 'b', label: 'Bouton B', badge: 'B', defaultP1: 'KeyK', defaultP2: 'Numpad5', defaultPad: 1 },
      { key: 'c', label: 'Bouton C', badge: 'C', defaultP1: 'KeyU', defaultP2: 'Numpad7', defaultPad: 2 },
      { key: 'd', label: 'Bouton X (6 boutons)', badge: 'X', defaultP1: 'KeyI', defaultP2: 'Numpad8', defaultPad: 3 },
      { key: 'l1', label: 'Bouton Y (6 boutons)', badge: 'Y', defaultP1: 'KeyQ', defaultP2: 'Numpad9', defaultPad: 4 },
      { key: 'r1', label: 'Bouton Z (6 boutons)', badge: 'Z', defaultP1: 'KeyE', defaultP2: 'Numpad6', defaultPad: 5 },
      { key: 'coin', label: 'MODE / SELECT', badge: 'MODE', defaultP1: 'ShiftLeft', defaultP2: 'NumpadSubtract', defaultPad: 8 },
      { key: 'start', label: 'START', badge: 'START', defaultP1: 'Enter', defaultP2: 'NumpadEnter', defaultPad: 9 },
    ],
  },
  {
    id: 'java',
    label: 'Java / J2ME',
    shortLabel: 'Java',
    description: 'Gameloft Classics · Nokia J2ME (D-Pad + OK/5 + Softkeys + Pavé 1/3/7/9/*)',
    actions: [
      { key: 'up', label: 'Navigation : HAUT (Touche 2)', badge: '↑', defaultP1: 'ArrowUp', defaultP2: 'KeyW', defaultPad: null },
      { key: 'down', label: 'Navigation : BAS (Touche 8)', badge: '↓', defaultP1: 'ArrowDown', defaultP2: 'KeyS', defaultPad: null },
      { key: 'left', label: 'Navigation : GAUCHE (Touche 4)', badge: '←', defaultP1: 'ArrowLeft', defaultP2: 'KeyA', defaultPad: null },
      { key: 'right', label: 'Navigation : DROITE (Touche 6)', badge: '→', defaultP1: 'ArrowRight', defaultP2: 'KeyD', defaultPad: null },
      { key: 'a', label: 'OK / Action / Tir (Touche 5)', badge: 'OK/5', defaultP1: 'Space', defaultP2: 'KeyJ', defaultPad: 0 },
      { key: 'b', label: 'Softkey Gauche (Menu / Valider)', badge: 'SOFT-G', defaultP1: 'Enter', defaultP2: 'KeyK', defaultPad: 1 },
      { key: 'c', label: 'Softkey Droite (Retour / Pause)', badge: 'SOFT-D', defaultP1: 'KeyU', defaultP2: 'Backspace', defaultPad: 2 },
      { key: 'd', label: 'Touche * (Étoile / Spécial)', badge: '*', defaultP1: 'KeyI', defaultP2: 'NumpadMultiply', defaultPad: 3 },
      { key: 'l1', label: 'Touche 7 (Diagonale / Raccourci)', badge: '7', defaultP1: 'KeyQ', defaultP2: 'Numpad7', defaultPad: 4 },
      { key: 'r1', label: 'Touche 9 (Diagonale / Raccourci)', badge: '9', defaultP1: 'KeyE', defaultP2: 'Numpad9', defaultPad: 5 },
      { key: 'l2', label: 'Touche 1 (Raccourci haut-gauche)', badge: '1', defaultP1: 'KeyZ', defaultP2: 'Numpad1', defaultPad: 6 },
      { key: 'r2', label: 'Touche 3 (Raccourci haut-droite)', badge: '3', defaultP1: 'KeyC', defaultP2: 'Numpad3', defaultPad: 7 },
      { key: 'start', label: 'Touche 0 (Option / Menu Jeu)', badge: '0', defaultP1: 'Digit0', defaultP2: 'Numpad0', defaultPad: 9 },
    ],
  },
];

export function buildDefaultConsoleControls() {
  const out = {};
  for (const prof of CONSOLE_CONTROL_PROFILES) {
    const p1 = {};
    const p2 = {};
    const gamepad = {};
    for (const act of prof.actions) {
      p1[act.key] = act.defaultP1;
      p2[act.key] = act.defaultP2;
      if (act.defaultPad !== null && act.defaultPad !== undefined) {
        gamepad[act.key] = act.defaultPad;
      }
    }
    out[prof.id] = {
      keyboard: { p1, p2 },
      gamepad,
    };
  }
  return out;
}

export function getConsoleControlProfile(consoleId) {
  return CONSOLE_CONTROL_PROFILES.find((p) => p.id === consoleId) || CONSOLE_CONTROL_PROFILES[0];
}
