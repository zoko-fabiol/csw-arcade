/**
 * Lecteur Plein Écran Unifié (Stage) partagé entre Consoles Rétro, PlayStation et PC.
 */

import { h, showToast } from '../components/ui.js';
import { loadPrefs, savePrefs } from './storage.js';

let currentCleanup = null;
let currentIframe = null;
let lastLaunchFn = null;
let onOpenSettingsCallback = null;

function els() {
  return {
    root: document.getElementById('unified-stage'),
    body: document.getElementById('stage-body'),
    title: document.getElementById('stage-title'),
    badge: document.getElementById('stage-badge'),
    status: document.getElementById('stage-status'),
    btnFilter: document.getElementById('stage-filter'),
    btnRatio: document.getElementById('stage-ratio'),
  };
}

function updateDisplayButtons() {
  const prefs = loadPrefs();
  const { btnFilter, btnRatio, body } = els();
  if (btnFilter) {
    btnFilter.textContent = prefs.videoFilter === 'smooth' ? 'Filtre : Lissé' : 'Filtre : Pixel net';
  }
  if (btnRatio) {
    btnRatio.textContent = prefs.screenRatio === 'stretch' ? 'Format : Étiré' : 'Format : 4:3 / Original';
  }
  if (body) {
    body.classList.toggle('is-smooth', prefs.videoFilter === 'smooth');
    body.classList.toggle('is-stretch', prefs.screenRatio === 'stretch');
  }
  if (currentIframe?.contentWindow) {
    currentIframe.contentWindow.postMessage(
      {
        type: 'UPDATE_DISPLAY',
        filter: prefs.videoFilter,
        ratio: prefs.screenRatio,
        volume: prefs.volume,
        muted: prefs.muted,
      },
      window.location.origin
    );
  }
}

export function initStage({ onOpenSettings } = {}) {
  onOpenSettingsCallback = onOpenSettings || null;

  document.getElementById('stage-close')?.addEventListener('click', closeStage);
  document.getElementById('stage-coin')?.addEventListener('click', () => {
    if (currentIframe?.contentWindow) {
      currentIframe.focus();
      currentIframe.contentWindow.postMessage({ type: 'PRESS_BUTTON', button: 'coin' }, window.location.origin);
    }
  });
  document.getElementById('stage-start')?.addEventListener('click', () => {
    if (currentIframe?.contentWindow) {
      currentIframe.focus();
      currentIframe.contentWindow.postMessage({ type: 'PRESS_BUTTON', button: 'start' }, window.location.origin);
    }
  });
  document.getElementById('stage-restart')?.addEventListener('click', () => {
    if (typeof lastLaunchFn === 'function') lastLaunchFn();
  });
  document.getElementById('stage-fullscreen')?.addEventListener('click', async () => {
    const { root } = els();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root?.requestFullscreen?.();
    } catch {
      showToast('Plein écran indisponible sur ce navigateur.', 'warn');
    }
  });
  document.getElementById('stage-filter')?.addEventListener('click', () => {
    const prefs = loadPrefs();
    savePrefs({ videoFilter: prefs.videoFilter === 'smooth' ? 'sharp' : 'smooth' });
    updateDisplayButtons();
  });
  document.getElementById('stage-ratio')?.addEventListener('click', () => {
    const prefs = loadPrefs();
    savePrefs({ screenRatio: prefs.screenRatio === 'stretch' ? 'fit' : 'stretch' });
    updateDisplayButtons();
  });
  document.getElementById('stage-settings')?.addEventListener('click', () => {
    onOpenSettingsCallback?.();
  });

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || !event.data) return;
    if (event.data.type === 'STAGE_STATUS') {
      const { status } = els();
      if (status && event.data.message) status.textContent = event.data.message;
      if (event.data.status === 'playing') {
        try { currentIframe?.focus(); } catch {}
      }
    }
  });

  updateDisplayButtons();
}

export function refreshStageDisplay() {
  updateDisplayButtons();
}

export function isStageOpen() {
  const { root } = els();
  return Boolean(root && !root.hidden);
}

export function closeStage() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  if (typeof currentCleanup === 'function') {
    try {
      currentCleanup();
    } catch {}
  }
  currentCleanup = null;
  currentIframe = null;

  const { root, body, status } = els();
  if (body) body.replaceChildren();
  if (status) status.textContent = '';
  if (root) root.hidden = true;
}

function openStageShell(title, badge, statusText) {
  if (typeof currentCleanup === 'function') {
    try {
      currentCleanup();
    } catch {}
  }
  currentCleanup = null;
  currentIframe = null;

  const { root, body, title: titleEl, badge: badgeEl, status } = els();
  if (body) body.replaceChildren();
  if (titleEl) titleEl.textContent = title;
  if (badgeEl) badgeEl.textContent = badge;
  if (status) status.textContent = statusText || 'Prêt';
  if (root) root.hidden = false;
  updateDisplayButtons();
  return body;
}

function mountPostMessageIframe(src, bootMessage) {
  const body = els().body;
  if (!body) return;
  const iframe = document.createElement('iframe');
  iframe.className = 'csw-stage-iframe';
  iframe.setAttribute('allow', 'autoplay; fullscreen; gamepad');
  iframe.src = src;

  const onMessage = (event) => {
    if (event.source !== iframe.contentWindow || !event.data) return;
    if (event.data.type === 'STAGE_FRAME_READY') {
      iframe.contentWindow.postMessage(bootMessage, window.location.origin);
    }
  };
  window.addEventListener('message', onMessage);
  body.append(iframe);
  currentIframe = iframe;

  currentCleanup = () => {
    window.removeEventListener('message', onMessage);
    iframe.src = 'about:blank';
    iframe.remove();
  };
}

export function launchEmulator({ title, badge, core, fileBlob, gameUrl, accent, localData = false }) {
  lastLaunchFn = () => launchEmulator({ title, badge, core, fileBlob, gameUrl, accent, localData });
  openStageShell(title, badge, `Démarrage de ${title} (${core})…`);
  const prefs = loadPrefs();
  mountPostMessageIframe('./app/stages/emu-frame.html', {
    type: 'BOOT_EMU',
    core,
    gameName: title,
    fileBlob: fileBlob || null,
    gameUrl: gameUrl || null,
    accent: accent || '#3b82f6',
    localData,
    filter: prefs.videoFilter,
    ratio: prefs.screenRatio,
    volume: prefs.volume,
    muted: prefs.muted,
  });
}

export function launchJ2me({ title, badge = 'Java J2ME · FreeJ2ME', fileBlob, filename }) {
  lastLaunchFn = () => launchJ2me({ title, badge, fileBlob, filename });
  openStageShell(title, badge, `Initialisation FreeJ2ME pour ${title}…`);
  mountPostMessageIframe('./app/stages/j2me-frame.html', {
    type: 'BOOT_J2ME',
    gameName: title,
    fileBlob: fileBlob || null,
    filename: filename || `${title}.jar`,
  });
}

export function launchDos({ title, badge = 'MS-DOS · js-dos', mode, bundleBlob, dosboxConf, initFs }) {
  lastLaunchFn = () => launchDos({ title, badge, mode, bundleBlob, dosboxConf, initFs });
  openStageShell(title, badge, `Initialisation DOSBox pour ${title}…`);
  const prefs = loadPrefs();
  mountPostMessageIframe('./app/stages/dos-frame.html', {
    type: 'BOOT_DOS',
    mode,
    bundleBlob: bundleBlob || null,
    dosboxConf: dosboxConf || '',
    initFs: initFs || [],
    filter: prefs.videoFilter,
  });
}

export function launchMedia({ file }) {
  lastLaunchFn = () => launchMedia({ file });
  const body = openStageShell(file.name, 'LECTEUR MÉDIA', `Chargement de ${file.name}…`);
  const objectUrl = URL.createObjectURL(file);
  const isAudio =
    file.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a|aac|opus)$/i.test(file.name);

  const player = document.createElement(isAudio ? 'audio' : 'video');
  player.controls = true;
  player.autoplay = true;
  if (!isAudio) player.playsInline = true;
  player.className = isAudio ? 'csw-media-audio' : 'csw-media-video';
  player.src = objectUrl;

  const prefs = loadPrefs();
  player.volume = Math.max(0, Math.min(1, (prefs.volume ?? 80) / 100));

  player.addEventListener('canplay', () => {
    const status = els().status;
    if (status) status.textContent = `Lecture prête : ${file.name} (fichier local, aucun envoi réseau).`;
  });
  player.addEventListener('error', () => {
    const status = els().status;
    if (status) {
      status.textContent = `Codec non supporté par le navigateur pour ${file.name}. Essayez MP4 (H.264), WebM ou MP3.`;
    }
  });

  body.append(h('div', { className: 'csw-media-wrap' }, player));
  currentCleanup = () => {
    try {
      player.pause();
      player.removeAttribute('src');
      player.load();
    } catch {}
    URL.revokeObjectURL(objectUrl);
  };
}

export function launchMiniGame({ id, title }) {
  lastLaunchFn = () => launchMiniGame({ id, title });
  const instructions =
    id === 'adventure'
      ? 'Déplacement : ZQSD / Flèches · Attaque : Espace · Collectez les 5 gemmes et entrez dans le portail. R pour recommencer.'
      : 'Déplacement : A/D ou Flèches · Saut : Espace / W / Haut · Atteignez l’étoile finale. R pour recommencer.';

  const body = openStageShell(title, 'MINI-JEU WEB', instructions);

  const canvas = h('canvas', {
    className: 'csw-minigame-canvas',
    width: 960,
    height: 540,
    'aria-label': title,
  });

  const keys = new Set();
  const makeTouchBtn = (label, code) => {
    const btn = h('button', { type: 'button', className: 'csw-touch-btn' }, label);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      keys.add(code);
      btn.setPointerCapture?.(e.pointerId);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      btn.addEventListener(ev, () => keys.delete(code));
    }
    return btn;
  };

  let resetFn = () => {};
  const restartBtn = h(
    'button',
    { type: 'button', className: 'csw-touch-btn csw-touch-btn--restart', onClick: () => resetFn() },
    '↻ Rejouer'
  );

  const touchBar = h(
    'div',
    { className: 'csw-minigame-touch' },
    makeTouchBtn('◀', 'ArrowLeft'),
    makeTouchBtn('▲', 'ArrowUp'),
    makeTouchBtn('▼', 'ArrowDown'),
    makeTouchBtn('▶', 'ArrowRight'),
    makeTouchBtn('⚔ / Saut', 'Space'),
    restartBtn
  );

  body.append(h('div', { className: 'csw-minigame-wrap' }, canvas, touchBar));

  const ctx = canvas.getContext('2d');
  const W = 960;
  const H = 540;
  let frame = 0;
  let rafId = 0;
  let state;

  resetFn = () => {
    frame = 0;
    state =
      id === 'adventure'
        ? {
            x: 75,
            y: 75,
            hp: 5,
            gems: 0,
            done: false,
            inv: 0,
            slash: 0,
            items: [
              [180, 120],
              [400, 390],
              [650, 110],
              [830, 360],
              [480, 240],
            ],
            foes: [
              [280, 180, 1],
              [580, 300, 1],
              [760, 170, 1],
            ],
          }
        : {
            x: 55,
            y: 400,
            vx: 0,
            vy: 0,
            hp: 3,
            coins: 0,
            done: false,
            ground: false,
            items: [180, 280, 410, 560, 700, 820],
            foes: [340, 650],
            platforms: [
              [0, 485, 960, 55],
              [170, 390, 160, 18],
              [410, 330, 155, 18],
              [665, 385, 130, 18],
            ],
          };
  };

  const rect = (x, y, w, hVal, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, hVal);
  };
  const drawText = (t, x, y, size = 22, color = '#fff') => {
    ctx.fillStyle = color;
    ctx.font = `bold ${size}px system-ui`;
    ctx.fillText(t, x, y);
  };
  const circle = (x, y, r, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const drawBanner = (msg) => {
    state.done = true;
    rect(140, 205, 680, 110, '#101b35');
    drawText(msg, 185, 270, 28, '#f6df8c');
  };

  function stepAdventure() {
    rect(0, 0, W, H, '#244d32');
    for (let i = 0; i < 22; i++) {
      const x = (i * 173 + 50) % W;
      const y = (i * 117 + 45) % H;
      circle(x, y, 24, '#173c2a');
      circle(x - 7, y - 7, 16, '#307344');
    }
    rect(842, 420, 85, 85, state.gems === 5 ? '#d9a72e' : '#64563d');
    drawText('SORTIE', 849, 467, 19);

    for (const gem of state.items) {
      circle(gem[0], gem[1], 12, '#55e8ff');
      circle(gem[0] - 3, gem[1] - 4, 4, '#dfffff');
    }
    for (const f of state.foes) {
      if (!f[2]) continue;
      const dx = state.x - f[0];
      const dy = state.y - f[1];
      const d = Math.hypot(dx, dy) || 1;
      if (d < 250) {
        f[0] += (dx / d) * 0.75;
        f[1] += (dy / d) * 0.75;
      }
      circle(f[0], f[1], 17, '#d34e69');
      circle(f[0] - 5, f[1] - 4, 3, 'white');
      circle(f[0] + 5, f[1] - 4, 3, 'white');
      if (d < 31 && state.inv <= 0) {
        state.hp--;
        state.inv = 65;
      }
    }

    const speed = 3;
    const dx =
      (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) -
      (keys.has('ArrowLeft') || keys.has('KeyA') || keys.has('KeyQ') ? 1 : 0);
    const dy =
      (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0) -
      (keys.has('ArrowUp') || keys.has('KeyW') || keys.has('KeyZ') ? 1 : 0);
    const n = Math.hypot(dx, dy) || 1;
    state.x = Math.max(18, Math.min(W - 18, state.x + (dx / n) * speed));
    state.y = Math.max(18, Math.min(H - 18, state.y + (dy / n) * speed));

    if (keys.has('Space') && frame % 22 === 0) state.slash = 10;
    if (state.slash > 0) {
      circle(state.x, state.y, 35, '#e7d58c');
      for (const f of state.foes) {
        if (f[2] && Math.hypot(state.x - f[0], state.y - f[1]) < 48) f[2] = 0;
      }
      state.slash--;
    }

    circle(state.x, state.y, 16, state.inv % 8 < 4 ? '#e5c36e' : '#fff');
    rect(state.x - 11, state.y - 20, 22, 8, '#3669b3');

    state.items = state.items.filter((g) => {
      if (Math.hypot(state.x - g[0], state.y - g[1]) < 27) {
        state.gems++;
        return false;
      }
      return true;
    });
    if (state.gems === 5 && state.x > 842 && state.y > 420) state.done = true;
    if (state.inv > 0) state.inv--;

    drawText(`♥ ${Math.max(0, state.hp)}    💎 ${state.gems}/5`, 20, 36);
    if (state.hp <= 0) drawBanner('Game Over · Appuyez sur R pour réessayer');
    if (state.done && state.hp > 0) drawBanner('Quête terminée ! · R pour rejouer');
  }

  function stepPlatform() {
    rect(0, 0, W, H, '#17395c');
    circle(780, 100, 48, '#ffe2a0');
    for (let i = 0; i < 8; i++) {
      const x = i * 145 - ((frame * 0.25) % 145);
      circle(x + 30, 100 + (i % 3) * 38, 25, '#bedef3');
      circle(x + 55, 105 + (i % 3) * 38, 20, '#bedef3');
    }
    for (const p of state.platforms) {
      rect(...p, '#5a9d54');
      rect(p[0], p[1], p[2], 7, '#a2db7a');
    }

    state.vx =
      (keys.has('ArrowRight') || keys.has('KeyD') ? 4 : 0) -
      (keys.has('ArrowLeft') || keys.has('KeyA') || keys.has('KeyQ') ? 4 : 0);
    if ((keys.has('Space') || keys.has('ArrowUp') || keys.has('KeyW') || keys.has('KeyZ')) && state.ground) {
      state.vy = -12;
      state.ground = false;
    }
    state.vy = Math.min(14, state.vy + 0.55);
    const oldY = state.y;
    state.x = Math.max(15, Math.min(935, state.x + state.vx));
    state.y += state.vy;
    state.ground = false;

    for (const p of state.platforms) {
      if (sLanding(state, oldY, p)) {
        state.y = p[1] - 30;
        state.vy = 0;
        state.ground = true;
      }
    }

    for (const coin of state.items) {
      if (coin >= 0) circle(coin, 285 + (coin % 3) * 32, 12, '#f7d54c');
    }
    state.items = state.items.map((coin) =>
      coin > 0 && Math.abs(state.x - coin) < 23 && Math.abs(state.y - (285 + (coin % 3) * 32)) < 35
        ? (state.coins++, -1)
        : coin
    );
    for (const e of state.foes) {
      const x = e + Math.sin(frame * 0.035 + e) * 40;
      circle(x, 468, 17, '#d95767');
      if (Math.abs(state.x - x) < 31 && Math.abs(state.y - 468) < 32 && state.inv <= 0) {
        state.hp--;
        state.inv = 70;
        state.vy = -7;
      }
    }
    if (state.inv > 0) state.inv--;

    rect(state.x - 16, state.y - 3, 32, 33, state.inv % 8 < 4 ? '#ffab45' : '#fff');
    rect(state.x - 13, state.y - 12, 26, 12, '#e34c64');
    rect(913, 415, 24, 70, '#d5a62e');
    drawText('★', 907, 412, 38, '#fff7b2');

    if (state.x > 905) state.done = true;
    drawText(`♥ ${Math.max(0, state.hp)}    ● ${state.coins}/6`, 20, 36);
    if (state.hp <= 0 || state.y > H + 50) drawBanner('Game Over · Appuyez sur R pour réessayer');
    if (state.done && state.hp > 0) drawBanner('Niveau terminé ! · R pour rejouer');
  }

  function sLanding(s, oldY, p) {
    return (
      s.vy >= 0 &&
      oldY + 30 <= p[1] + 12 &&
      s.y + 30 >= p[1] &&
      s.x + 17 > p[0] &&
      s.x - 17 < p[0] + p[2]
    );
  }

  function loop() {
    frame++;
    if (!state.done && state.hp > 0) {
      id === 'adventure' ? stepAdventure() : stepPlatform();
    } else {
      drawBanner(
        state.hp <= 0 || state.y > H + 50
          ? 'Game Over · Appuyez sur R pour réessayer'
          : id === 'adventure'
            ? 'Quête terminée ! · R pour rejouer'
            : 'Niveau terminé ! · R pour rejouer'
      );
    }
    rafId = requestAnimationFrame(loop);
  }

  const onKeyDown = (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    keys.add(e.code);
    if (e.code === 'KeyR') resetFn();
  };
  const onKeyUp = (e) => keys.delete(e.code);
  const onBlur = () => keys.clear();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  resetFn();
  rafId = requestAnimationFrame(loop);

  currentCleanup = () => {
    cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}
