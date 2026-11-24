import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Hash, Move, Sliders, RotateCcw, Check, Eye } from 'lucide-react';

function vibrate(ms = 10, enabled = true) {
  if (!enabled) return;
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(ms);
    }
  } catch {
    /* noop */
  }
}

/**
 * Bouton tactile réactif multi-touch avec retour haptique et zéro latence.
 * Désactive les inputs de jeu pendant le mode édition de position.
 */
function PadButton({
  label,
  subLabel,
  className = '',
  activeClass = 'scale-95 brightness-125',
  onPress,
  onRelease,
  disabledInput = false,
  vibrationEnabled = true,
}) {
  const [pressed, setPressed] = useState(false);

  const down = (e) => {
    if (disabledInput) return;
    e.preventDefault();
    e.stopPropagation();
    if (!pressed) {
      setPressed(true);
      vibrate(8, vibrationEnabled);
      onPress?.();
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };

  const up = (e) => {
    if (disabledInput) return;
    e.preventDefault();
    e.stopPropagation();
    if (pressed) {
      setPressed(false);
      onRelease?.();
    }
  };

  return (
    <button
      type="button"
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'none' }}
      className={`select-none flex flex-col items-center justify-center transition-transform duration-75 ${className} ${
        pressed ? activeClass : ''
      }`}
    >
      <span className="leading-none">{label}</span>
      {subLabel && <span className="text-[8px] opacity-80 mt-0.5 leading-none">{subLabel}</span>}
    </button>
  );
}

/**
 * Stick / D-Pad 8 directions fluide (supporte le glissement du pouce en 360° + diagonales).
 */
function TouchDirectionalPad({
  styleType = 'cross',
  accent = 'amber',
  onDirectionChange,
  disabledInput = false,
  vibrationEnabled = true,
  translucent = false,
}) {
  const padRef = useRef(null);
  const activeDirsRef = useRef({ up: false, down: false, left: false, right: false });
  const [knob, setKnob] = useState({ x: 0, y: 0, active: false });

  const emitDirs = (next) => {
    const prev = activeDirsRef.current;
    ['up', 'down', 'left', 'right'].forEach((dir) => {
      if (prev[dir] !== next[dir]) {
        onDirectionChange(dir, next[dir]);
      }
    });
    activeDirsRef.current = next;
  };

  const computeFromPointer = (clientX, clientY) => {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width * 0.36;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    const deadzone = rect.width * 0.11;

    let kx = dx;
    let ky = dy;
    if (dist > maxR) {
      kx = (dx / dist) * maxR;
      ky = (dy / dist) * maxR;
    }
    setKnob({ x: kx, y: ky, active: true });

    if (dist < deadzone) {
      emitDirs({ up: false, down: false, left: false, right: false });
      return;
    }

    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    emitDirs({
      right: angle > -67.5 && angle < 67.5,
      down: angle > 22.5 && angle < 157.5,
      left: angle > 112.5 || angle < -112.5,
      up: angle < -22.5 && angle > -157.5,
    });
  };

  const handleDown = (e) => {
    if (disabledInput) return;
    e.preventDefault();
    vibrate(6, vibrationEnabled);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    computeFromPointer(e.clientX, e.clientY);
  };

  const handleMove = (e) => {
    if (disabledInput || !knob.active) return;
    e.preventDefault();
    computeFromPointer(e.clientX, e.clientY);
  };

  const handleUp = (e) => {
    if (disabledInput) return;
    e.preventDefault();
    setKnob({ x: 0, y: 0, active: false });
    emitDirs({ up: false, down: false, left: false, right: false });
  };

  const isArcadeStick = styleType === 'arcade';
  const isSega = styleType === 'sega';
  const ringBorder =
    accent === 'amber'
      ? 'border-amber-400/55 shadow-amber-500/15'
      : accent === 'blue'
      ? 'border-blue-400/55 shadow-blue-500/20'
      : accent === 'sky'
      ? 'border-sky-400/55 shadow-sky-500/20'
      : accent === 'red'
      ? 'border-red-400/55 shadow-red-500/20'
      : 'border-cyan-400/55 shadow-cyan-500/20';

  return (
    <div
      ref={padRef}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onLostPointerCapture={handleUp}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'none' }}
      className={`relative w-32 h-32 sm:w-36 sm:h-36 rounded-full ${
        translucent ? 'bg-black/40 backdrop-blur-md' : 'bg-neutral-900/90 backdrop-blur-md'
      } border-2 ${ringBorder} shadow-2xl flex items-center justify-center`}
    >
      {isArcadeStick ? (
        <>
          <div className="w-16 h-16 rounded-full border border-white/15 bg-black/55" />
          <div
            className="absolute w-14 h-14 rounded-full bg-gradient-to-br from-amber-300 via-amber-500 to-amber-800 border-2 border-amber-200/80 shadow-lg shadow-amber-950/80 transition-transform duration-75"
            style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
          >
            <div className="w-4 h-4 rounded-full bg-white/40 ml-2.5 mt-2 blur-[1px]" />
          </div>
        </>
      ) : isSega ? (
        <div className="w-24 h-24 rounded-full bg-gradient-to-b from-slate-800 to-slate-950 border border-sky-400/35 shadow-inner flex items-center justify-center">
          <div className="w-20 h-6 rounded-full bg-slate-700/80 absolute" />
          <div className="h-20 w-6 rounded-full bg-slate-700/80 absolute" />
          <div
            className="w-9 h-9 rounded-full bg-sky-400/30 border border-sky-300/80 transition-transform duration-75"
            style={{ transform: `translate(${knob.x * 0.45}px, ${knob.y * 0.45}px)` }}
          />
        </div>
      ) : (
        <>
          <div className="w-24 h-8 rounded-lg bg-neutral-800/90 border border-white/20 absolute shadow-inner" />
          <div className="h-24 w-8 rounded-lg bg-neutral-800/90 border border-white/20 absolute shadow-inner" />
          <span className="absolute top-2.5 text-[10px] text-neutral-300 font-black pointer-events-none">▲</span>
          <span className="absolute bottom-2.5 text-[10px] text-neutral-300 font-black pointer-events-none">▼</span>
          <span className="absolute left-2.5 text-[10px] text-neutral-300 font-black pointer-events-none">◄</span>
          <span className="absolute right-2.5 text-[10px] text-neutral-300 font-black pointer-events-none">►</span>
          <div
            className={`w-7 h-7 rounded-full border transition-transform duration-75 ${
              knob.active ? 'bg-white/25 border-white/70' : 'bg-neutral-900/90 border-white/15'
            }`}
            style={{ transform: `translate(${knob.x * 0.35}px, ${knob.y * 0.35}px)` }}
          />
        </>
      )}
    </div>
  );
}

/**
 * Conteneur déplaçable librement (drag & drop tactile/souris) en mode édition.
 */
function DraggableCluster({
  id,
  pos,
  scale = 100,
  opacity = 75,
  isEditMode,
  onMove,
  label,
  children,
  className = '',
}) {
  const dragRef = useRef(null);

  const onPointerDown = (e) => {
    if (!isEditMode) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: pos.x,
      initY: pos.y,
    };
  };

  const onPointerMove = (e) => {
    if (!isEditMode || !dragRef.current) return;
    e.preventDefault();
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const dxPct = ((e.clientX - dragRef.current.startX) / vw) * 100;
    const dyPct = ((e.clientY - dragRef.current.startY) / vh) * 100;
    const nextX = Math.max(6, Math.min(94, dragRef.current.initX + dxPct));
    const nextY = Math.max(10, Math.min(92, dragRef.current.initY + dyPct));
    onMove(id, { x: Math.round(nextX * 10) / 10, y: Math.round(nextY * 10) / 10 });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        left: `${pos.x}%`,
        top: `${pos.y}%`,
        transform: `translate(-50%, -50%) scale(${scale / 100})`,
        opacity: isEditMode ? 0.98 : opacity / 100,
        touchAction: 'none',
      }}
      className={`pointer-events-auto absolute transition-shadow ${
        isEditMode
          ? 'cursor-grab active:cursor-grabbing ring-2 ring-dashed ring-amber-400 rounded-2xl p-1.5 bg-black/50 shadow-2xl'
          : ''
      } ${className}`}
    >
      {isEditMode && label && (
        <span className="absolute -top-5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-amber-400 text-black text-[9px] font-mono font-black whitespace-nowrap pointer-events-none">
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

const DEFAULT_LANDSCAPE_LAYOUT = {
  shouldersLeft: { x: 11, y: 20 },
  shouldersRight: { x: 89, y: 20 },
  meta: { x: 50, y: 12 },
  dpad: { x: 14, y: 68 },
  actions: { x: 86, y: 68 },
  opacity: 65,
  scale: 100,
};

const DEFAULT_PORTRAIT_PREFS = {
  opacity: 92,
  scale: 100,
  offsetY: 0,
};

function loadStoredConfig(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...fallback, ...JSON.parse(raw) };
  } catch {}
  return fallback;
}

/**
 * Contrôleur Tactile Ergonomique Multi-Plateformes :
 * - Portrait (Vertical) : deck matériel dédié en bas sous l'écran 4:3 (zéro obstruction)
 * - Paysage (Horizontal) : overlay translucide superposé directement sur le jeu plein écran
 * - Gâchettes L1 / R1 pour Arcade, Sega et Nintendo ; double gâchettes L1 / L2 / R1 / R2 pour PlayStation
 * - Personnalisation en direct : position libre (drag & drop), transparence (20%-100%) et taille (80%-120%)
 */
export function MobilePlatformController({
  kind = 'emu',
  core = 'fbneo',
  settings,
  onEmuButton,
  onJ2meKey,
  onSyncCredits,
}) {
  const [j2meNumpadOpen, setJ2meNumpadOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [showCustomizeBar, setShowCustomizeBar] = useState(false);
  const [isLandscape, setIsLandscape] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : false
  );

  useEffect(() => {
    const updateOrientation = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };
    updateOrientation();
    window.addEventListener('resize', updateOrientation);
    window.addEventListener('orientationchange', updateOrientation);
    return () => {
      window.removeEventListener('resize', updateOrientation);
      window.removeEventListener('orientationchange', updateOrientation);
    };
  }, []);

  const lowerCore = String(core || '').toLowerCase();
  const profile =
    kind === 'j2me' || lowerCore === 'j2me'
      ? 'j2me'
      : lowerCore === 'psx' || lowerCore === 'ps1'
      ? 'playstation'
      : lowerCore.startsWith('sega')
      ? 'sega'
      : ['nes', 'snes', 'n64', 'gba', 'gb', 'gbc', 'nds'].includes(lowerCore)
      ? 'nintendo'
      : 'arcade';

  const vibrationEnabled = settings?.touch?.vibration ?? true;
  const forceOverlayInPortrait = settings?.touch?.portraitMode === 'overlay';
  const useFloatingOverlay = isLandscape || forceOverlayInPortrait;

  const landscapeKey = `csw_vpad_land_v4_${profile}`;
  const portraitKey = `csw_vpad_port_v4_${profile}`;

  const [landLayout, setLandLayout] = useState(() =>
    loadStoredConfig(landscapeKey, {
      ...DEFAULT_LANDSCAPE_LAYOUT,
      opacity: settings?.touch?.opacity ?? DEFAULT_LANDSCAPE_LAYOUT.opacity,
      scale: settings?.touch?.scale ?? DEFAULT_LANDSCAPE_LAYOUT.scale,
    })
  );

  const [portPrefs, setPortPrefs] = useState(() =>
    loadStoredConfig(portraitKey, {
      ...DEFAULT_PORTRAIT_PREFS,
      opacity: settings?.touch?.opacity ?? DEFAULT_PORTRAIT_PREFS.opacity,
      scale: settings?.touch?.scale ?? DEFAULT_PORTRAIT_PREFS.scale,
    })
  );

  useEffect(() => {
    setLandLayout(
      loadStoredConfig(landscapeKey, {
        ...DEFAULT_LANDSCAPE_LAYOUT,
        opacity: settings?.touch?.opacity ?? DEFAULT_LANDSCAPE_LAYOUT.opacity,
        scale: settings?.touch?.scale ?? DEFAULT_LANDSCAPE_LAYOUT.scale,
      })
    );
    setPortPrefs(
      loadStoredConfig(portraitKey, {
        ...DEFAULT_PORTRAIT_PREFS,
        opacity: settings?.touch?.opacity ?? DEFAULT_PORTRAIT_PREFS.opacity,
        scale: settings?.touch?.scale ?? DEFAULT_PORTRAIT_PREFS.scale,
      })
    );
  }, [landscapeKey, portraitKey]);

  const updateLandLayout = useCallback(
    (patch) => {
      setLandLayout((prev) => {
        const next = { ...prev, ...patch };
        try {
          localStorage.setItem(landscapeKey, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [landscapeKey]
  );

  const updatePortPrefs = useCallback(
    (patch) => {
      setPortPrefs((prev) => {
        const next = { ...prev, ...patch };
        try {
          localStorage.setItem(portraitKey, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [portraitKey]
  );

  const handleClusterMove = useCallback(
    (clusterId, pos) => {
      updateLandLayout({ [clusterId]: pos });
    },
    [updateLandLayout]
  );

  const emitDir = (dir, pressed) => {
    if (isEditMode) return;
    if (profile === 'j2me') {
      const map = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
      onJ2meKey?.(map[dir], pressed);
    } else {
      const idxMap = { up: 4, down: 5, left: 6, right: 7 };
      onEmuButton?.(idxMap[dir], pressed);
    }
  };

  const bindEmu = (idx) => ({
    disabledInput: isEditMode,
    vibrationEnabled,
    onPress: () => onEmuButton?.(idx, true),
    onRelease: () => onEmuButton?.(idx, false),
  });

  const bindJ2me = (code) => ({
    disabledInput: isEditMode,
    vibrationEnabled,
    onPress: () => onJ2meKey?.(code, true),
    onRelease: () => onJ2meKey?.(code, false),
  });

  const accent =
    profile === 'j2me' || profile === 'arcade'
      ? 'amber'
      : profile === 'playstation'
      ? 'blue'
      : profile === 'sega'
      ? 'sky'
      : 'red';

  const deckThemeClass =
    profile === 'playstation'
      ? 'from-[#070b18] via-[#0c142a] to-[#111b36] border-blue-400/35'
      : profile === 'nintendo'
      ? 'from-[#12080a] via-[#1c0e12] to-[#261217] border-red-500/35'
      : profile === 'sega'
      ? 'from-[#060c14] via-[#0b1626] to-[#102038] border-sky-400/35'
      : 'from-[#0c0a06] via-[#17130b] to-[#211b0f] border-amber-400/35';

  const shoulderBtnClass =
    profile === 'playstation'
      ? 'bg-slate-900/90 border border-blue-400/55 text-blue-100 hover:bg-blue-950/80 shadow-md shadow-blue-950/50'
      : profile === 'nintendo'
      ? 'bg-neutral-900/90 border border-red-400/55 text-red-100 hover:bg-red-950/70 shadow-md shadow-red-950/50'
      : profile === 'sega'
      ? 'bg-slate-900/90 border border-sky-400/55 text-sky-100 hover:bg-sky-950/70 shadow-md shadow-sky-950/50'
      : 'bg-stone-900/90 border border-amber-400/55 text-amber-100 hover:bg-amber-950/70 shadow-md shadow-amber-950/50';

  const dpadStyle =
    settings?.touch?.dpadType === 'dpad'
      ? 'cross'
      : profile === 'arcade'
      ? 'arcade'
      : profile === 'sega'
      ? 'sega'
      : 'cross';

  // Rendu des gâchettes gauche (L1 seul pour Arcade/Sega/Nintendo ; L2+L1 empilés pour PlayStation)
  const renderLeftShoulders = () => {
    if (profile === 'j2me') {
      return (
        <PadButton
          label="SOFT G"
          subLabel="Menu"
          {...bindJ2me('KeyQ')}
          className="w-20 h-9 rounded-xl bg-amber-950/80 border border-amber-400/55 text-amber-100 text-[10px] font-black"
        />
      );
    }
    if (profile === 'playstation') {
      return (
        <div className="flex flex-col gap-1.5">
          <PadButton
            label="L2"
            {...bindEmu(12)}
            className={`w-16 h-8 rounded-t-xl rounded-b-md text-xs font-black tracking-wider ${shoulderBtnClass}`}
          />
          <PadButton
            label="L1"
            {...bindEmu(10)}
            className={`w-16 h-9 rounded-t-md rounded-b-xl text-xs font-black tracking-wider ${shoulderBtnClass}`}
          />
        </div>
      );
    }
    return (
      <PadButton
        label="L1"
        {...bindEmu(10)}
        className={`w-20 h-9 rounded-2xl text-xs font-black tracking-wider ${shoulderBtnClass}`}
      />
    );
  };

  // Rendu des gâchettes droite (R1 seul pour Arcade/Sega/Nintendo ; R2+R1 empilés pour PlayStation)
  const renderRightShoulders = () => {
    if (profile === 'j2me') {
      return (
        <PadButton
          label="SOFT D"
          subLabel="Retour"
          {...bindJ2me('KeyW')}
          className="w-20 h-9 rounded-xl bg-amber-950/80 border border-amber-400/55 text-amber-100 text-[10px] font-black"
        />
      );
    }
    if (profile === 'playstation') {
      return (
        <div className="flex flex-col gap-1.5">
          <PadButton
            label="R2"
            {...bindEmu(13)}
            className={`w-16 h-8 rounded-t-xl rounded-b-md text-xs font-black tracking-wider ${shoulderBtnClass}`}
          />
          <PadButton
            label="R1"
            {...bindEmu(11)}
            className={`w-16 h-9 rounded-t-md rounded-b-xl text-xs font-black tracking-wider ${shoulderBtnClass}`}
          />
        </div>
      );
    }
    return (
      <PadButton
        label="R1"
        {...bindEmu(11)}
        className={`w-20 h-9 rounded-2xl text-xs font-black tracking-wider ${shoulderBtnClass}`}
      />
    );
  };

  // Rendu des touches centrales (COIN/START ou SELECT/START ou MODE/START)
  const renderMetaButtons = () => {
    if (profile === 'arcade') {
      return (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isEditMode}
            onClick={() => {
              vibrate(12, vibrationEnabled);
              onSyncCredits?.();
            }}
            className="px-3 h-7 rounded-full bg-amber-500/20 border border-amber-400/65 text-amber-200 text-[10px] font-mono font-black active:scale-95 whitespace-nowrap"
          >
            COIN
          </button>
          <PadButton
            label="START"
            {...bindEmu(3)}
            className="px-3.5 h-7 rounded-full bg-emerald-500/25 border border-emerald-400/65 text-emerald-200 text-[10px] font-mono font-black whitespace-nowrap"
          />
        </div>
      );
    }
    if (profile === 'sega') {
      return (
        <div className="flex items-center gap-2">
          <PadButton
            label="MODE"
            {...bindEmu(2)}
            className="px-3 h-7 rounded-full bg-slate-900/90 border border-sky-400/50 text-sky-200 text-[10px] font-mono font-bold"
          />
          <PadButton
            label="START"
            {...bindEmu(3)}
            className="px-3.5 h-7 rounded-full bg-sky-500/25 border border-sky-400/65 text-sky-100 text-[10px] font-mono font-black"
          />
        </div>
      );
    }
    if (profile === 'j2me') {
      return (
        <div className="flex items-center gap-1.5">
          <PadButton
            label="C"
            {...bindJ2me('KeyE')}
            className="w-10 h-7 rounded-full bg-neutral-800 border border-white/20 text-neutral-100 text-[10px] font-black"
          />
          <button
            type="button"
            onClick={() => setJ2meNumpadOpen((v) => !v)}
            className={`px-2.5 h-7 rounded-full border text-[10px] font-black flex items-center gap-1 ${
              j2meNumpadOpen
                ? 'bg-amber-400 text-black border-amber-300'
                : 'bg-neutral-900 text-amber-300 border-amber-400/50'
            }`}
          >
            <Hash className="w-3 h-3" />
            <span>123</span>
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <PadButton
          label="SELECT"
          {...bindEmu(2)}
          className="px-3 h-7 rounded-full bg-neutral-900/90 border border-white/25 text-[10px] font-mono font-bold text-neutral-200"
        />
        <PadButton
          label="START"
          {...bindEmu(3)}
          className="px-3 h-7 rounded-full bg-neutral-900/90 border border-white/25 text-[10px] font-mono font-bold text-neutral-200"
        />
      </div>
    );
  };

  // Rendu du cluster de boutons d'action par plateforme
  const renderActionButtons = () => {
    if (profile === 'arcade') {
      return (
        <div className="grid grid-cols-2 gap-2.5 pr-0.5">
          <PadButton
            label="A"
            subLabel="Poing"
            {...bindEmu(0)}
            className="w-14 h-14 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-700 border-2 border-emerald-200/85 text-black font-black text-base shadow-lg shadow-emerald-950/80"
          />
          <PadButton
            label="B"
            subLabel="Pied"
            {...bindEmu(8)}
            className="w-14 h-14 rounded-full bg-gradient-to-b from-rose-500 to-red-700 border-2 border-rose-200/85 text-white font-black text-base shadow-lg shadow-red-950/80 -mt-2"
          />
          <PadButton
            label="C"
            subLabel="Fort"
            {...bindEmu(1)}
            className="w-14 h-14 rounded-full bg-gradient-to-b from-cyan-400 to-sky-700 border-2 border-cyan-200/85 text-black font-black text-base shadow-lg shadow-sky-950/80"
          />
          <PadButton
            label="D"
            subLabel="Spécial"
            {...bindEmu(9)}
            className="w-14 h-14 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 border-2 border-amber-100/85 text-black font-black text-base shadow-lg shadow-amber-950/80 -mt-2"
          />
        </div>
      );
    }

    if (profile === 'playstation') {
      return (
        <div className="relative w-36 h-36 shrink-0">
          <PadButton
            label="△"
            {...bindEmu(9)}
            className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full bg-slate-950/90 border-2 border-emerald-400 text-emerald-400 font-black text-lg shadow-lg shadow-emerald-500/25"
          />
          <PadButton
            label="□"
            {...bindEmu(1)}
            className="absolute left-0 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-slate-950/90 border-2 border-fuchsia-400 text-fuchsia-400 font-black text-lg shadow-lg shadow-fuchsia-500/25"
          />
          <PadButton
            label="○"
            {...bindEmu(8)}
            className="absolute right-0 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-slate-950/90 border-2 border-rose-400 text-rose-400 font-black text-lg shadow-lg shadow-rose-500/25"
          />
          <PadButton
            label="✕"
            {...bindEmu(0)}
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full bg-slate-950/90 border-2 border-sky-400 text-sky-400 font-black text-lg shadow-lg shadow-sky-500/25"
          />
        </div>
      );
    }

    if (profile === 'nintendo') {
      if (['nes', 'gb', 'gbc', 'gba'].includes(lowerCore)) {
        return (
          <div className="flex items-center gap-3 pr-1">
            <PadButton
              label="B"
              {...bindEmu(0)}
              className="w-16 h-16 rounded-full bg-gradient-to-b from-amber-400 to-amber-600 border-2 border-amber-200 text-black font-black text-lg shadow-lg mt-4"
            />
            <PadButton
              label="A"
              {...bindEmu(8)}
              className="w-16 h-16 rounded-full bg-gradient-to-b from-red-500 to-red-700 border-2 border-red-300 text-white font-black text-lg shadow-lg -mt-4"
            />
          </div>
        );
      }
      return (
        <div className="relative w-36 h-36 shrink-0">
          <PadButton
            label="X"
            {...bindEmu(9)}
            className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full bg-gradient-to-b from-blue-500 to-blue-700 border-2 border-blue-200 text-white font-black text-sm shadow-lg"
          />
          <PadButton
            label="Y"
            {...bindEmu(1)}
            className="absolute left-0 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-gradient-to-b from-emerald-500 to-emerald-700 border-2 border-emerald-200 text-white font-black text-sm shadow-lg"
          />
          <PadButton
            label="A"
            {...bindEmu(8)}
            className="absolute right-0 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-gradient-to-b from-red-500 to-red-700 border-2 border-red-200 text-white font-black text-sm shadow-lg"
          />
          <PadButton
            label="B"
            {...bindEmu(0)}
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full bg-gradient-to-b from-amber-400 to-amber-600 border-2 border-amber-200 text-black font-black text-sm shadow-lg"
          />
        </div>
      );
    }

    if (profile === 'sega') {
      return (
        <div className="flex flex-col gap-2 pr-0.5">
          <div className="flex gap-2 justify-end">
            <PadButton
              label="X"
              {...bindEmu(9)}
              className="w-11 h-11 rounded-full bg-slate-900 border-2 border-sky-400/65 text-sky-200 font-black text-xs shadow"
            />
            <PadButton
              label="Y"
              {...bindEmu(10)}
              className="w-11 h-11 rounded-full bg-slate-900 border-2 border-sky-400/65 text-sky-200 font-black text-xs shadow -mt-1.5"
            />
            <PadButton
              label="Z"
              {...bindEmu(11)}
              className="w-11 h-11 rounded-full bg-slate-900 border-2 border-sky-400/65 text-sky-200 font-black text-xs shadow"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <PadButton
              label="A"
              {...bindEmu(1)}
              className="w-12 h-12 rounded-full bg-gradient-to-b from-sky-500 to-blue-800 border-2 border-sky-200 text-white font-black text-sm shadow-lg"
            />
            <PadButton
              label="B"
              {...bindEmu(0)}
              className="w-12 h-12 rounded-full bg-gradient-to-b from-sky-500 to-blue-800 border-2 border-sky-200 text-white font-black text-sm shadow-lg -mt-1.5"
            />
            <PadButton
              label="C"
              {...bindEmu(8)}
              className="w-12 h-12 rounded-full bg-gradient-to-b from-sky-500 to-blue-800 border-2 border-sky-200 text-white font-black text-sm shadow-lg"
            />
          </div>
        </div>
      );
    }

    return (
      <div className="relative w-36 h-36 shrink-0">
        <PadButton
          label="5"
          subLabel="Action"
          {...bindJ2me('Digit5')}
          className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full bg-neutral-900 border-2 border-amber-400/75 text-amber-300 font-black text-xs shadow-lg"
        />
        <PadButton
          label="0"
          subLabel="Spécial"
          {...bindJ2me('Digit0')}
          className="absolute left-0 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-neutral-900 border-2 border-neutral-500 text-neutral-100 font-black text-xs shadow-lg"
        />
        <PadButton
          label="#"
          subLabel="Alt"
          {...bindJ2me('KeyT')}
          className="absolute right-0 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-neutral-900 border-2 border-neutral-500 text-neutral-100 font-black text-xs shadow-lg"
        />
        <PadButton
          label="OK"
          subLabel="Entrée"
          {...bindJ2me('Enter')}
          className="absolute bottom-0 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-gradient-to-b from-amber-400 to-amber-600 border-2 border-amber-200 text-black font-black text-sm shadow-lg"
        />
      </div>
    );
  };

  // =========================================================================
  // MODE PAYSAGE (HORIZONTAL) OU OVERLAY : SUPERPOSÉ TRANSPARENT SUR LE JEU
  // =========================================================================
  if (useFloatingOverlay) {
    return (
      <div
        className="fixed inset-0 z-30 pointer-events-none select-none overflow-hidden"
        style={{ touchAction: 'none' }}
      >
        {/* Bouton discret d'édition Position & Transparence (en haut au centre) */}
        <div className="pointer-events-auto absolute top-2 right-2 z-40 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsEditMode((v) => !v)}
            title="Personnaliser la position et la transparence du contrôleur"
            className={`px-2.5 py-1.5 rounded-full text-[10px] font-bold border backdrop-blur-md flex items-center gap-1 transition-all ${
              isEditMode
                ? 'bg-amber-400 text-black border-amber-200 shadow-lg'
                : 'bg-black/55 text-neutral-200 border-white/20 hover:bg-black/80'
            }`}
          >
            {isEditMode ? <Check className="w-3.5 h-3.5" /> : <Move className="w-3.5 h-3.5" />}
            <span>{isEditMode ? 'Valider' : 'Pad'}</span>
          </button>
        </div>

        {/* Barre flottante de personnalisation (Transparence + Taille + Reset) */}
        {isEditMode && (
          <div className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2 z-40 px-3.5 py-2 rounded-2xl bg-neutral-950/95 border border-amber-400/50 shadow-2xl flex items-center gap-3 flex-wrap max-w-[94vw] text-[11px] text-white">
            <span className="font-bold text-amber-300 flex items-center gap-1">
              <Move className="w-3.5 h-3.5" /> Glissez les blocs
            </span>
            <label className="flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-neutral-300" />
              <input
                type="range"
                min="20"
                max="100"
                step="5"
                value={landLayout.opacity}
                onChange={(e) => updateLandLayout({ opacity: Number(e.target.value) })}
                className="w-20 accent-amber-400 cursor-pointer"
              />
              <span className="font-mono text-[10px] w-8">{landLayout.opacity}%</span>
            </label>
            <div className="flex items-center gap-1">
              {[80, 100, 120].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => updateLandLayout({ scale: s })}
                  className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold border ${
                    landLayout.scale === s
                      ? 'bg-amber-400 text-black border-amber-300'
                      : 'bg-neutral-900 text-neutral-300 border-white/15'
                  }`}
                >
                  {s}%
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => updateLandLayout(DEFAULT_LANDSCAPE_LAYOUT)}
              className="px-2 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 flex items-center gap-1 text-[10px] font-bold"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </div>
        )}

        {/* Blocs repositionnables indépendamment */}
        <DraggableCluster
          id="shouldersLeft"
          label={profile === 'playstation' ? 'L1 / L2' : 'L1'}
          pos={landLayout.shouldersLeft}
          scale={landLayout.scale}
          opacity={landLayout.opacity}
          isEditMode={isEditMode}
          onMove={handleClusterMove}
        >
          {renderLeftShoulders()}
        </DraggableCluster>

        <DraggableCluster
          id="shouldersRight"
          label={profile === 'playstation' ? 'R1 / R2' : 'R1'}
          pos={landLayout.shouldersRight}
          scale={landLayout.scale}
          opacity={landLayout.opacity}
          isEditMode={isEditMode}
          onMove={handleClusterMove}
        >
          {renderRightShoulders()}
        </DraggableCluster>

        <DraggableCluster
          id="meta"
          label="START / SELECT"
          pos={landLayout.meta}
          scale={landLayout.scale}
          opacity={landLayout.opacity}
          isEditMode={isEditMode}
          onMove={handleClusterMove}
        >
          {renderMetaButtons()}
        </DraggableCluster>

        <DraggableCluster
          id="dpad"
          label="DIRECTION"
          pos={landLayout.dpad}
          scale={landLayout.scale}
          opacity={landLayout.opacity}
          isEditMode={isEditMode}
          onMove={handleClusterMove}
        >
          <TouchDirectionalPad
            styleType={dpadStyle}
            accent={accent}
            onDirectionChange={emitDir}
            disabledInput={isEditMode}
            vibrationEnabled={vibrationEnabled}
            translucent
          />
        </DraggableCluster>

        <DraggableCluster
          id="actions"
          label="BOUTONS"
          pos={landLayout.actions}
          scale={landLayout.scale}
          opacity={landLayout.opacity}
          isEditMode={isEditMode}
          onMove={handleClusterMove}
        >
          {renderActionButtons()}
        </DraggableCluster>
      </div>
    );
  }

  // =========================================================================
  // MODE PORTRAIT (VERTICAL) : DECK MATÉRIEL DÉDIÉ EN BAS SOUS LE JEU
  // =========================================================================
  return (
    <div
      className={`w-full shrink-0 bg-gradient-to-t ${deckThemeClass} border-t px-3 pt-2 pb-3 pb-safe select-none transition-all`}
      style={{
        touchAction: 'none',
        opacity: portPrefs.opacity / 100,
      }}
    >
      {/* Mini-barre de personnalisation rapide (Opacité, Taille, Hauteur) */}
      <div className="flex items-center justify-between gap-2 mb-2 max-w-xl mx-auto">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md bg-white/10 text-neutral-200 font-bold">
            {profile === 'playstation'
              ? 'DUALSHOCK · L1/L2/R1/R2'
              : profile === 'nintendo'
              ? 'NINTENDO · L1/R1'
              : profile === 'sega'
              ? 'SEGA · L1/R1'
              : profile === 'j2me'
              ? 'JAVA MOBILE'
              : 'ARCADE · L1/R1'}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setShowCustomizeBar((v) => !v)}
          className={`px-2 py-1 rounded-lg text-[10px] font-bold border flex items-center gap-1 transition-colors ${
            showCustomizeBar
              ? 'u-tab-active'
              : 'bg-white/5 border-white/15 text-neutral-300 hover:text-white'
          }`}
        >
          <Sliders className="w-3 h-3" aria-hidden="true" />
          <span>Réglages Pad</span>
        </button>
      </div>

      {showCustomizeBar && (
        <div className="mb-2.5 p-2.5 rounded-xl bg-black/55 border border-white/15 max-w-xl mx-auto flex flex-wrap items-center justify-between gap-2 text-[10px] text-neutral-200">
          <label className="flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5 u-accent-text" />
            <span>Opacité</span>
            <input
              type="range"
              min="30"
              max="100"
              step="5"
              value={portPrefs.opacity}
              onChange={(e) => updatePortPrefs({ opacity: Number(e.target.value) })}
              className="w-20 accent-amber-400 cursor-pointer"
            />
            <span className="font-mono w-7">{portPrefs.opacity}%</span>
          </label>

          <div className="flex items-center gap-1">
            <span>Taille</span>
            {[85, 100, 115].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => updatePortPrefs({ scale: s })}
                className={`px-2 py-0.5 rounded font-mono font-bold border ${
                  portPrefs.scale === s ? 'u-btn-primary' : 'bg-neutral-900 border-white/15 text-neutral-300'
                }`}
              >
                {s}%
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => updatePortPrefs(DEFAULT_PORTRAIT_PREFS)}
            className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 flex items-center gap-1 font-bold"
          >
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        </div>
      )}

      {/* Rangée Gâchettes (L1/R1 pour Arcade/Sega/Nintendo ; L1+L2 / R1+R2 pour PlayStation) + START/SELECT */}
      <div className="flex items-center justify-between gap-2 mb-2.5 max-w-xl mx-auto">
        {renderLeftShoulders()}
        {renderMetaButtons()}
        {renderRightShoulders()}
      </div>

      {/* Pavé numérique 1-9 escamotable pour les jeux Java / Gameloft */}
      {profile === 'j2me' && j2meNumpadOpen && (
        <div className="grid grid-cols-6 gap-1.5 mb-2.5 p-2 rounded-xl bg-black/50 border border-amber-400/35 max-w-xl mx-auto">
          {[
            ['1', 'Digit1'], ['2', 'Digit2'], ['3', 'Digit3'], ['4', 'Digit4'], ['5', 'Digit5'], ['6', 'Digit6'],
            ['7', 'Digit7'], ['8', 'Digit8'], ['9', 'Digit9'], ['*', 'KeyR'], ['0', 'Digit0'], ['#', 'KeyT'],
          ].map(([lbl, code]) => (
            <PadButton
              key={code}
              label={lbl}
              {...bindJ2me(code)}
              className="h-9 rounded-lg bg-neutral-800 border border-white/15 text-white text-xs font-black"
            />
          ))}
        </div>
      )}

      {/* Corps Principal du Contrôleur : Direction à gauche + Boutons d'action à droite */}
      <div
        className="flex items-center justify-between gap-2 max-w-xl mx-auto transition-transform"
        style={{ transform: `scale(${portPrefs.scale / 100})`, transformOrigin: 'center center' }}
      >
        <TouchDirectionalPad
          styleType={dpadStyle}
          accent={accent}
          onDirectionChange={emitDir}
          disabledInput={isEditMode}
          vibrationEnabled={vibrationEnabled}
        />
        {renderActionButtons()}
      </div>
    </div>
  );
}
