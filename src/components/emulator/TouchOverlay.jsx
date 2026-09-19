import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Move, Check, RotateCcw, Gamepad2, Pencil, ArrowDown, ArrowUp } from 'lucide-react';

// RetroPad IDs pour Neo Geo
const RETROPAD = {
  B: 0,      // Neo Geo A (Bouton A mobile)
  A: 8,      // Neo Geo B (Bouton B mobile)
  Y: 1,      // Neo Geo C (Bouton X mobile)
  X: 9,      // Neo Geo D (Bouton Y mobile)
  SELECT: 2, // Coin / Crédit
  START: 3,  // Start
  UP: 4,
  DOWN: 5,
  LEFT: 6,
  RIGHT: 7,
  L: 10,     // L1
  R: 11      // R1
};

// Positions initiales ergonomiques (en pourcentage de l'écran en mode Overlay)
const DEFAULT_TOUCH_LAYOUT = {
  dpad: { x: 18, y: 72 },       // Gauche bas
  buttons: { x: 82, y: 72 },    // Droite bas (A, B, X, Y)
  l1: { x: 14, y: 22 },         // En haut à gauche
  r1: { x: 86, y: 22 },         // En haut à droite
  coins: { x: 50, y: 90 },      // Centre bas
  scale: 100,
  opacity: 75
};

const STORAGE_KEY = 'csw_touch_layout_v3';

export function TouchOverlay({ 
  onInput, 
  isVisible, 
  onToggleVisibility, 
  settings, 
  isPortraitPad = false 
}) {
  const [layout, setLayout] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...DEFAULT_TOUCH_LAYOUT, ...JSON.parse(saved) };
    } catch (e) {}
    return DEFAULT_TOUCH_LAYOUT;
  });

  const [isEditMode, setIsEditMode] = useState(false);
  const [draggingTarget, setDraggingTarget] = useState(null);
  const dragStartRef = useRef({ startX: 0, startY: 0, initPosX: 0, initPosY: 0 });

  const [activeDirections, setActiveDirections] = useState({ up: false, down: false, left: false, right: false });
  const [activeButtons, setActiveButtons] = useState({});
  const [hasActiveGamepad, setHasActiveGamepad] = useState(false);

  // Déplacement strictement vertical pour le pad portrait (stylet de configuration)
  const [topBarOffsetY, setTopBarOffsetY] = useState(() => {
    try {
      const saved = localStorage.getItem('csw_portrait_topbar_offset_y');
      return saved !== null ? Number(saved) : 0;
    } catch (e) {
      return 0;
    }
  });

  const [padOffsetY, setPadOffsetY] = useState(() => {
    try {
      const saved = localStorage.getItem('csw_portrait_pad_offset_y');
      return saved !== null ? Number(saved) : 0;
    } catch (e) {
      return 0;
    }
  });

  const [isStylusActive, setIsStylusActive] = useState(false);
  const [activeVerticalDrag, setActiveVerticalDrag] = useState(null); // 'topbar' | 'controls' | null
  const verticalDragStartRef = useRef({ startY: 0, initialOffset: 0 });

  const saveTopBarOffsetY = (val) => {
    const clamped = Math.max(0, Math.min(260, Math.round(val)));
    setTopBarOffsetY(clamped);
    try {
      localStorage.setItem('csw_portrait_topbar_offset_y', String(clamped));
    } catch (e) {}
  };

  const savePadOffsetY = (val) => {
    const clamped = Math.max(-60, Math.min(120, Math.round(val)));
    setPadOffsetY(clamped);
    try {
      localStorage.setItem('csw_portrait_pad_offset_y', String(clamped));
    } catch (e) {}
  };

  const resetPortraitPositions = () => {
    saveTopBarOffsetY(0);
    savePadOffsetY(0);
  };

  const handleStartVerticalDrag = (target, clientY) => {
    if (!isStylusActive) return;
    setActiveVerticalDrag(target);
    const initial = target === 'topbar' ? topBarOffsetY : padOffsetY;
    verticalDragStartRef.current = {
      startY: clientY,
      initialOffset: initial
    };
  };

  useEffect(() => {
    if (!isStylusActive || !activeVerticalDrag) return;

    const handleMove = (e) => {
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const deltaY = clientY - verticalDragStartRef.current.startY;
      const targetVal = verticalDragStartRef.current.initialOffset + deltaY;
      if (activeVerticalDrag === 'topbar') {
        saveTopBarOffsetY(targetVal);
      } else {
        savePadOffsetY(targetVal);
      }
    };

    const handleEnd = () => {
      setActiveVerticalDrag(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isStylusActive, activeVerticalDrag, topBarOffsetY, padOffsetY]);

  // Détection d'une manette externe connectée
  useEffect(() => {
    const checkGp = () => {
      if (typeof navigator !== 'undefined' && navigator.getGamepads) {
        const gps = navigator.getGamepads();
        setHasActiveGamepad(!!(gps[0] || gps[1]));
      }
    };
    checkGp();
    window.addEventListener('gamepadconnected', checkGp);
    window.addEventListener('gamepaddisconnected', checkGp);
    return () => {
      window.removeEventListener('gamepadconnected', checkGp);
      window.removeEventListener('gamepaddisconnected', checkGp);
    };
  }, []);

  const saveLayout = useCallback((newLayout) => {
    setLayout(newLayout);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newLayout));
    } catch (e) {}
  }, []);

  const resetLayout = () => {
    saveLayout(DEFAULT_TOUCH_LAYOUT);
  };

  // Vibration haptique
  const triggerHaptic = useCallback(() => {
    const isVibrationEnabled = settings?.touch?.vibration ?? true;
    if (isVibrationEnabled && typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(14);
      } catch (e) {}
    }
  }, [settings?.touch?.vibration]);

  const triggerInput = useCallback((btnId, isPressed) => {
    if (isEditMode || isStylusActive) return;
    if (typeof onInput === 'function') {
      onInput(btnId, isPressed);
    }
    setActiveButtons(prev => ({ ...prev, [btnId]: isPressed }));
    if (isPressed) {
      triggerHaptic();
    }
  }, [onInput, isEditMode, isStylusActive, triggerHaptic]);

  // D-Pad tactile fluide 8 directions
  const dpadRef = useRef(null);
  const handleDpadTouch = useCallback((clientX, clientY, isEnd = false) => {
    if (isEditMode || isStylusActive) return;
    if (isEnd) {
      setActiveDirections({ up: false, down: false, left: false, right: false });
      triggerInput(RETROPAD.UP, false);
      triggerInput(RETROPAD.DOWN, false);
      triggerInput(RETROPAD.LEFT, false);
      triggerInput(RETROPAD.RIGHT, false);
      return;
    }

    if (!dpadRef.current) return;
    const rect = dpadRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const deadzone = rect.width * 0.15;

    const up = dy < -deadzone;
    const down = dy > deadzone;
    const left = dx < -deadzone;
    const right = dx > deadzone;

    setActiveDirections({ up, down, left, right });
    triggerInput(RETROPAD.UP, up);
    triggerInput(RETROPAD.DOWN, down);
    triggerInput(RETROPAD.LEFT, left);
    triggerInput(RETROPAD.RIGHT, right);
  }, [isEditMode, triggerInput]);

  // Drag & drop en mode édition (uniquement en mode overlay)
  const handleStartDrag = (target, clientX, clientY) => {
    if (!isEditMode || isPortraitPad) return;
    setDraggingTarget(target);
    dragStartRef.current = {
      startX: clientX,
      startY: clientY,
      initPosX: layout[target]?.x ?? 50,
      initPosY: layout[target]?.y ?? 50
    };
  };

  useEffect(() => {
    if (!isEditMode || !draggingTarget || isPortraitPad) return;

    const handleMove = (e) => {
      const touch = e.touches ? e.touches[0] : e;
      const deltaX = (touch.clientX - dragStartRef.current.startX) / window.innerWidth * 100;
      const deltaY = (touch.clientY - dragStartRef.current.startY) / window.innerHeight * 100;

      const newX = Math.max(5, Math.min(95, dragStartRef.current.initPosX + deltaX));
      const newY = Math.max(5, Math.min(95, dragStartRef.current.initPosY + deltaY));

      setLayout(prev => ({
        ...prev,
        [draggingTarget]: { x: Math.round(newX), y: Math.round(newY) }
      }));
    };

    const handleEnd = () => {
      setDraggingTarget(null);
      saveLayout(layout);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isEditMode, draggingTarget, layout, saveLayout, isPortraitPad]);

  if (!isVisible) return null;

  // Auto-masquage si une manette Bluetooth est active
  const autoHideOnGamepad = settings?.touch?.autoHideOnGamepad ?? true;
  if (hasActiveGamepad && autoHideOnGamepad && !isEditMode) {
    return (
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 pointer-events-auto">
        <button
          onClick={onToggleVisibility}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-950/90 border border-cyan-500/50 text-cyan-300 text-[10px] backdrop-blur-md shadow-lg"
        >
          <Gamepad2 className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
          <span>Manette active • Toucher pour afficher tactile</span>
        </button>
      </div>
    );
  }

  const scaleSetting = settings?.touch?.scale ?? layout.scale ?? 100;
  const opacitySetting = settings?.touch?.opacity ?? layout.opacity ?? 75;
  const scaleFactor = scaleSetting / 100;
  const opacityVal = opacitySetting / 100;

  // Rendu des boutons A, B, X, Y
  const renderActionButtons = (isCompact = false) => (
    <div className={`relative ${isCompact ? 'w-36 h-36' : 'w-44 h-44'} select-none`}>
      {/* Bouton Y (Haut / Jaune) -> Neo Geo Bouton D */}
      <button
        onTouchStart={(e) => { e.preventDefault(); triggerInput(RETROPAD.X, true); }}
        onTouchEnd={(e) => { e.preventDefault(); triggerInput(RETROPAD.X, false); }}
        onMouseDown={() => triggerInput(RETROPAD.X, true)}
        onMouseUp={() => triggerInput(RETROPAD.X, false)}
        className={`absolute top-0 left-1/2 -translate-x-1/2 ${isCompact ? 'w-12 h-12' : 'w-14 h-14'} rounded-full border-2 border-amber-400/90 flex flex-col items-center justify-center font-bold shadow-lg transition-transform ${
          activeButtons[RETROPAD.X]
            ? 'bg-amber-400 text-black scale-95 shadow-amber-400/50'
            : 'bg-amber-950/85 text-amber-300 active:scale-95'
        }`}
      >
        <span className={`${isCompact ? 'text-sm' : 'text-base'} font-black leading-none`}>Y</span>
        <span className="text-[8px] opacity-70">D</span>
      </button>

      {/* Bouton X (Gauche / Cyan) -> Neo Geo Bouton C */}
      <button
        onTouchStart={(e) => { e.preventDefault(); triggerInput(RETROPAD.Y, true); }}
        onTouchEnd={(e) => { e.preventDefault(); triggerInput(RETROPAD.Y, false); }}
        onMouseDown={() => triggerInput(RETROPAD.Y, true)}
        onMouseUp={() => triggerInput(RETROPAD.Y, false)}
        className={`absolute left-0 top-1/2 -translate-y-1/2 ${isCompact ? 'w-12 h-12' : 'w-14 h-14'} rounded-full border-2 border-cyan-400/90 flex flex-col items-center justify-center font-bold shadow-lg transition-transform ${
          activeButtons[RETROPAD.Y]
            ? 'bg-cyan-400 text-black scale-95 shadow-cyan-400/50'
            : 'bg-cyan-950/85 text-cyan-300 active:scale-95'
        }`}
      >
        <span className={`${isCompact ? 'text-sm' : 'text-base'} font-black leading-none`}>X</span>
        <span className="text-[8px] opacity-70">C</span>
      </button>

      {/* Bouton B (Droite / Rose) -> Neo Geo Bouton B */}
      <button
        onTouchStart={(e) => { e.preventDefault(); triggerInput(RETROPAD.A, true); }}
        onTouchEnd={(e) => { e.preventDefault(); triggerInput(RETROPAD.A, false); }}
        onMouseDown={() => triggerInput(RETROPAD.A, true)}
        onMouseUp={() => triggerInput(RETROPAD.A, false)}
        className={`absolute right-0 top-1/2 -translate-y-1/2 ${isCompact ? 'w-12 h-12' : 'w-14 h-14'} rounded-full border-2 border-rose-500/90 flex flex-col items-center justify-center font-bold shadow-lg transition-transform ${
          activeButtons[RETROPAD.A]
            ? 'bg-rose-500 text-white scale-95 shadow-rose-500/50'
            : 'bg-rose-950/85 text-rose-300 active:scale-95'
        }`}
      >
        <span className={`${isCompact ? 'text-sm' : 'text-base'} font-black leading-none`}>B</span>
        <span className="text-[8px] opacity-70">B</span>
      </button>

      {/* Bouton A (Bas / Vert) -> Neo Geo Bouton A */}
      <button
        onTouchStart={(e) => { e.preventDefault(); triggerInput(RETROPAD.B, true); }}
        onTouchEnd={(e) => { e.preventDefault(); triggerInput(RETROPAD.B, false); }}
        onMouseDown={() => triggerInput(RETROPAD.B, true)}
        onMouseUp={() => triggerInput(RETROPAD.B, false)}
        className={`absolute bottom-0 left-1/2 -translate-x-1/2 ${isCompact ? 'w-12 h-12' : 'w-14 h-14'} rounded-full border-2 border-emerald-400/90 flex flex-col items-center justify-center font-bold shadow-lg transition-transform ${
          activeButtons[RETROPAD.B]
            ? 'bg-emerald-400 text-black scale-95 shadow-emerald-400/50'
            : 'bg-emerald-950/85 text-emerald-300 active:scale-95'
        }`}
      >
        <span className={`${isCompact ? 'text-sm' : 'text-base'} font-black leading-none`}>A</span>
        <span className="text-[8px] opacity-70">A</span>
      </button>
    </div>
  );

  // Rendu du D-Pad 8 directions
  const renderDpad = (isCompact = false) => (
    <div
      ref={dpadRef}
      className={`${isCompact ? 'w-36 h-36' : 'w-40 h-40'} rounded-full flex items-center justify-center border border-cyan-500/30 bg-neutral-900/80 backdrop-blur-sm shadow-xl select-none`}
      onTouchStart={(e) => {
        e.preventDefault();
        handleDpadTouch(e.touches[0].clientX, e.touches[0].clientY);
      }}
      onTouchMove={(e) => handleDpadTouch(e.touches[0].clientX, e.touches[0].clientY)}
      onTouchEnd={() => handleDpadTouch(0, 0, true)}
      onTouchCancel={() => handleDpadTouch(0, 0, true)}
    >
      <div className={`relative ${isCompact ? 'w-28 h-28' : 'w-32 h-32'} flex items-center justify-center`}>
        <div className={`absolute top-0 w-9 h-9 rounded-t-xl flex items-center justify-center font-bold text-xs border ${
          activeDirections.up ? 'bg-cyan-500 text-black border-cyan-400 scale-95' : 'bg-neutral-800/80 text-neutral-300 border-neutral-700'
        }`}>▲</div>
        <div className={`absolute bottom-0 w-9 h-9 rounded-b-xl flex items-center justify-center font-bold text-xs border ${
          activeDirections.down ? 'bg-cyan-500 text-black border-cyan-400 scale-95' : 'bg-neutral-800/80 text-neutral-300 border-neutral-700'
        }`}>▼</div>
        <div className={`absolute left-0 w-9 h-9 rounded-l-xl flex items-center justify-center font-bold text-xs border ${
          activeDirections.left ? 'bg-cyan-500 text-black border-cyan-400 scale-95' : 'bg-neutral-800/80 text-neutral-300 border-neutral-700'
        }`}>◀</div>
        <div className={`absolute right-0 w-9 h-9 rounded-r-xl flex items-center justify-center font-bold text-xs border ${
          activeDirections.right ? 'bg-cyan-500 text-black border-cyan-400 scale-95' : 'bg-neutral-800/80 text-neutral-300 border-neutral-700'
        }`}>▶</div>
        <div className="w-7 h-7 rounded-full bg-neutral-900 border border-neutral-700 shadow-inner" />
      </div>
    </div>
  );

  // 1. DISPOSITION A : MANETTE DÉDIÉE BAS D'ÉCRAN (MODE PORTRAIT ARCADE PAD)
  if (isPortraitPad) {
    return (
      <div 
        className="w-full h-full flex flex-col p-2 select-none font-mono relative overflow-hidden"
        style={{ opacity: opacityVal }}
      >
        {/* Panneau de configuration activé par le petit stylet */}
        {isStylusActive && (
          <div className="mx-1 my-1 p-2 bg-neutral-900/98 border border-amber-500/70 rounded-xl shadow-2xl backdrop-blur-md animate-in fade-in shrink-0 z-50 flex flex-col gap-2">
            {/* Entête du stylet */}
            <div className="flex items-center justify-between pb-1 border-b border-neutral-800">
              <div className="flex items-center gap-1.5 font-bold text-amber-300 text-[11px]">
                <Pencil className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span>Régler la hauteur des touches</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={resetPortraitPositions}
                  className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] flex items-center gap-1 transition-colors"
                  title="Réinitialiser les hauteurs par défaut"
                >
                  <RotateCcw className="w-3 h-3" /> Défaut
                </button>
                <button
                  onClick={() => setIsStylusActive(false)}
                  className="px-2.5 py-0.5 rounded bg-amber-400 hover:bg-amber-300 text-black text-[10px] font-bold flex items-center gap-1 shadow-sm active:scale-95 transition-transform"
                >
                  <Check className="w-3.5 h-3.5" /> OK
                </button>
              </div>
            </div>

            {/* Contrôle 1 : Descendre la barre L1 / COIN / START / R1 */}
            <div className="flex items-center justify-between gap-1.5 text-[10px]">
              <span className="text-amber-300 font-bold shrink-0">Barre L1/Coin/Start :</span>
              <div className="flex items-center gap-1 flex-1 justify-end">
                <button
                  onClick={() => saveTopBarOffsetY(topBarOffsetY - 15)}
                  className="px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-200 active:scale-95 flex items-center gap-0.5"
                  title="Monter la barre"
                >
                  <ArrowUp className="w-3 h-3 text-amber-400" />
                </button>
                <input
                  type="range"
                  min="0"
                  max="260"
                  step="5"
                  value={topBarOffsetY}
                  onChange={(e) => saveTopBarOffsetY(Number(e.target.value))}
                  className="w-24 xs:w-32 accent-amber-400 cursor-pointer"
                  title="Descendre/monter la barre L1/Coin/Start"
                />
                <button
                  onClick={() => saveTopBarOffsetY(topBarOffsetY + 15)}
                  className="px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-200 active:scale-95 flex items-center gap-0.5"
                  title="Descendre la barre"
                >
                  <ArrowDown className="w-3 h-3 text-amber-400" />
                </button>
                <span className="w-8 text-right font-mono text-amber-400 text-[10px] font-bold">+{topBarOffsetY}px</span>
              </div>
            </div>

            {/* Contrôle 2 : Position D-Pad et Boutons Arcade */}
            <div className="flex items-center justify-between gap-1.5 text-[10px]">
              <span className="text-cyan-300 font-bold shrink-0">D-Pad & Boutons :</span>
              <div className="flex items-center gap-1 flex-1 justify-end">
                <button
                  onClick={() => savePadOffsetY(padOffsetY - 15)}
                  className="px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-200 active:scale-95 flex items-center gap-0.5"
                  title="Monter les touches"
                >
                  <ArrowUp className="w-3 h-3 text-cyan-400" />
                </button>
                <input
                  type="range"
                  min="-60"
                  max="120"
                  step="5"
                  value={padOffsetY}
                  onChange={(e) => savePadOffsetY(Number(e.target.value))}
                  className="w-24 xs:w-32 accent-cyan-400 cursor-pointer"
                  title="Ajuster hauteur D-Pad et Boutons"
                />
                <button
                  onClick={() => savePadOffsetY(padOffsetY + 15)}
                  className="px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-200 active:scale-95 flex items-center gap-0.5"
                  title="Descendre les touches"
                >
                  <ArrowDown className="w-3 h-3 text-cyan-400" />
                </button>
                <span className="w-8 text-right font-mono text-cyan-300 text-[10px] font-bold">{padOffsetY >= 0 ? `+${padOffsetY}` : padOffsetY}px</span>
              </div>
            </div>
          </div>
        )}

        {/* LIGNE 1 : BARRE L1, COIN, STYLET, START, R1 (DÉPLAÇABLE DIRECTEMENT VERS LE BAS) */}
        <div 
          style={{ transform: `translateY(${topBarOffsetY}px)` }}
          className={`transition-transform duration-75 relative z-20 ${
            isStylusActive 
              ? 'p-1 rounded-xl border-2 border-dashed border-amber-400 bg-amber-950/30 cursor-ns-resize shadow-lg shadow-amber-400/20' 
              : ''
          }`}
          onMouseDown={(e) => isStylusActive && handleStartVerticalDrag('topbar', e.clientY)}
          onTouchStart={(e) => isStylusActive && handleStartVerticalDrag('topbar', e.touches[0].clientY)}
        >
          {isStylusActive && (
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-amber-400 text-black text-[9px] font-bold rounded-full pointer-events-none uppercase tracking-wider flex items-center gap-1 shadow-md whitespace-nowrap">
              <Move className="w-2.5 h-2.5" /> Glisser pour descendre cette barre
            </div>
          )}

          <div className="flex items-center justify-between px-2 pt-1">
            <button
              onTouchStart={(e) => { e.preventDefault(); triggerInput(RETROPAD.L, true); }}
              onTouchEnd={(e) => { e.preventDefault(); triggerInput(RETROPAD.L, false); }}
              onMouseDown={() => triggerInput(RETROPAD.L, true)}
              onMouseUp={() => triggerInput(RETROPAD.L, false)}
              className={`px-3.5 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                activeButtons[RETROPAD.L]
                  ? 'bg-white text-black border-white scale-95'
                  : 'bg-neutral-900/90 text-neutral-300 border-neutral-700 active:scale-95'
              }`}
            >
              L1
            </button>

            <div className="flex items-center gap-1.5">
              <button
                onTouchStart={(e) => { e.preventDefault(); triggerInput(RETROPAD.SELECT, true); }}
                onTouchEnd={(e) => { e.preventDefault(); triggerInput(RETROPAD.SELECT, false); }}
                onMouseDown={() => triggerInput(RETROPAD.SELECT, true)}
                onMouseUp={() => triggerInput(RETROPAD.SELECT, false)}
                className={`px-2.5 py-1 rounded-lg border text-[10px] font-mono font-bold uppercase transition-transform ${
                  activeButtons[RETROPAD.SELECT]
                    ? 'bg-amber-400 text-black scale-95'
                    : 'bg-neutral-900 text-amber-400 border-neutral-700'
                }`}
              >
                COIN (5)
              </button>

              {/* LE PETIT STYLET POUR CONFIGURER LA HAUTEUR VERTICALE DES TOUCHES */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsStylusActive(prev => !prev);
                }}
                className={`p-1.5 rounded-lg border transition-all ${
                  isStylusActive
                    ? 'bg-amber-400 text-black border-amber-300 shadow-md shadow-amber-400/40 animate-pulse scale-105'
                    : 'bg-neutral-900/90 text-cyan-400 border-cyan-500/40 hover:bg-neutral-800'
                }`}
                title="Ajuster verticalement la position des touches et de cette barre"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>

              <button
                onTouchStart={(e) => { e.preventDefault(); triggerInput(RETROPAD.START, true); }}
                onTouchEnd={(e) => { e.preventDefault(); triggerInput(RETROPAD.START, false); }}
                onMouseDown={() => triggerInput(RETROPAD.START, true)}
                onMouseUp={() => triggerInput(RETROPAD.START, false)}
                className={`px-2.5 py-1 rounded-lg border text-[10px] font-mono font-bold uppercase transition-transform ${
                  activeButtons[RETROPAD.START]
                    ? 'bg-cyan-400 text-black scale-95'
                    : 'bg-neutral-900 text-cyan-300 border-cyan-500/40'
                }`}
              >
                START (1)
              </button>
            </div>

            <button
              onTouchStart={(e) => { e.preventDefault(); triggerInput(RETROPAD.R, true); }}
              onTouchEnd={(e) => { e.preventDefault(); triggerInput(RETROPAD.R, false); }}
              onMouseDown={() => triggerInput(RETROPAD.R, true)}
              onMouseUp={() => triggerInput(RETROPAD.R, false)}
              className={`px-3.5 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                activeButtons[RETROPAD.R]
                  ? 'bg-white text-black border-white scale-95'
                  : 'bg-neutral-900/90 text-neutral-300 border-neutral-700 active:scale-95'
              }`}
            >
              R1
            </button>
          </div>
        </div>

        {/* LIGNE 2 : D-PAD À GAUCHE, BOUTONS ARCADE À DROITE (DÉPLAÇABLE VERTICALEMENT) */}
        <div 
          style={{ transform: `translateY(${padOffsetY}px)` }}
          className={`flex-1 flex items-center justify-between px-3 py-2 transition-transform duration-75 relative z-10 ${
            isStylusActive 
              ? 'rounded-xl border-2 border-dashed border-cyan-400/70 bg-cyan-950/20 cursor-ns-resize mt-2 shadow-lg shadow-cyan-500/10' 
              : ''
          }`}
          onMouseDown={(e) => isStylusActive && handleStartVerticalDrag('controls', e.clientY)}
          onTouchStart={(e) => isStylusActive && handleStartVerticalDrag('controls', e.touches[0].clientY)}
        >
          {isStylusActive && (
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-cyan-400 text-black text-[9px] font-bold rounded-full pointer-events-none uppercase tracking-wider flex items-center gap-1 shadow-md whitespace-nowrap">
              <Move className="w-2.5 h-2.5" /> Glisser pour ajuster D-Pad & Boutons
            </div>
          )}

          {/* D-Pad gauche */}
          <div className="flex items-center justify-center">
            {renderDpad(true)}
          </div>

          {/* Boutons arcade droite */}
          <div className="flex items-center justify-center">
            {renderActionButtons(true)}
          </div>
        </div>
      </div>
    );
  }

  // 2. DISPOSITION B : MODE OVERLAY TRANSPARENT FLOTTANT (PAYSAGE OU LIBRE)
  return (
    <div 
      className="fixed inset-0 pointer-events-none z-30 select-none overflow-hidden font-mono"
      style={{ opacity: opacityVal }}
    >
      {/* Barre de contrôle du Mode Édition */}
      <div className="absolute top-16 left-1/2 -translate-x-1/2 pointer-events-auto flex items-center gap-2 bg-neutral-900/90 border border-neutral-700/80 px-4 py-2 rounded-full shadow-2xl backdrop-blur-md">
        <button
          onClick={() => setIsEditMode(!isEditMode)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all ${
            isEditMode
              ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20'
              : 'bg-neutral-800 text-neutral-300 hover:text-white'
          }`}
        >
          {isEditMode ? <Check className="w-3.5 h-3.5" /> : <Move className="w-3.5 h-3.5" />}
          <span>{isEditMode ? 'VALIDER POSITION' : 'DÉPLACER TOUCHES'}</span>
        </button>

        {isEditMode && (
          <>
            <div className="h-4 w-[1px] bg-neutral-700 mx-1" />
            <button
              onClick={resetLayout}
              title="Réinitialiser positions par défaut"
              className="p-1.5 rounded-full text-neutral-400 hover:text-white hover:bg-neutral-800"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {/* --- D-PAD / VIRTUAL JOYSTICK GAUCHE --- */}
      <div
        style={{
          left: `${layout.dpad.x}%`,
          top: `${layout.dpad.y}%`,
          transform: `translate(-50%, -50%) scale(${scaleFactor})`
        }}
        className={`absolute pointer-events-auto rounded-full ${
          isEditMode ? 'ring-2 ring-dashed ring-amber-400 cursor-move' : ''
        }`}
        onMouseDown={(e) => isEditMode && handleStartDrag('dpad', e.clientX, e.clientY)}
        onTouchStart={(e) => isEditMode && handleStartDrag('dpad', e.touches[0].clientX, e.touches[0].clientY)}
      >
        {renderDpad(false)}
      </div>

      {/* --- CLUSTER DE TOUCHES MOBILE (A, B, X, Y) --- */}
      <div
        style={{
          left: `${layout.buttons.x}%`,
          top: `${layout.buttons.y}%`,
          transform: `translate(-50%, -50%) scale(${scaleFactor})`
        }}
        className={`absolute pointer-events-auto rounded-full ${
          isEditMode ? 'ring-2 ring-dashed ring-amber-400 cursor-move' : ''
        }`}
        onMouseDown={(e) => isEditMode && handleStartDrag('buttons', e.clientX, e.clientY)}
        onTouchStart={(e) => isEditMode && handleStartDrag('buttons', e.touches[0].clientX, e.touches[0].clientY)}
      >
        {renderActionButtons(false)}
      </div>

      {/* --- TOUCHE L1 AUTONOME --- */}
      <div
        style={{
          left: `${layout.l1?.x ?? 14}%`,
          top: `${layout.l1?.y ?? 22}%`,
          transform: `translate(-50%, -50%) scale(${scaleFactor})`
        }}
        className={`absolute pointer-events-auto ${
          isEditMode ? 'ring-2 ring-dashed ring-amber-400 cursor-move rounded-xl p-1' : ''
        }`}
        onMouseDown={(e) => isEditMode && handleStartDrag('l1', e.clientX, e.clientY)}
        onTouchStart={(e) => isEditMode && handleStartDrag('l1', e.touches[0].clientX, e.touches[0].clientY)}
      >
        <button
          onTouchStart={(e) => { e.preventDefault(); triggerInput(RETROPAD.L, true); }}
          onTouchEnd={(e) => { e.preventDefault(); triggerInput(RETROPAD.L, false); }}
          onMouseDown={() => triggerInput(RETROPAD.L, true)}
          onMouseUp={() => triggerInput(RETROPAD.L, false)}
          className={`px-5 py-2.5 rounded-xl border-2 font-bold text-xs tracking-wider shadow-xl transition-all ${
            activeButtons[RETROPAD.L]
              ? 'bg-white text-black border-white scale-95 shadow-white/40'
              : 'bg-neutral-900/90 text-neutral-200 border-neutral-600 active:scale-95 hover:border-cyan-400'
          }`}
        >
          L1
        </button>
      </div>

      {/* --- TOUCHE R1 AUTONOME --- */}
      <div
        style={{
          left: `${layout.r1?.x ?? 86}%`,
          top: `${layout.r1?.y ?? 22}%`,
          transform: `translate(-50%, -50%) scale(${scaleFactor})`
        }}
        className={`absolute pointer-events-auto ${
          isEditMode ? 'ring-2 ring-dashed ring-amber-400 cursor-move rounded-xl p-1' : ''
        }`}
        onMouseDown={(e) => isEditMode && handleStartDrag('r1', e.clientX, e.clientY)}
        onTouchStart={(e) => isEditMode && handleStartDrag('r1', e.touches[0].clientX, e.touches[0].clientY)}
      >
        <button
          onTouchStart={(e) => { e.preventDefault(); triggerInput(RETROPAD.R, true); }}
          onTouchEnd={(e) => { e.preventDefault(); triggerInput(RETROPAD.R, false); }}
          onMouseDown={() => triggerInput(RETROPAD.R, true)}
          onMouseUp={() => triggerInput(RETROPAD.R, false)}
          className={`px-5 py-2.5 rounded-xl border-2 font-bold text-xs tracking-wider shadow-xl transition-all ${
            activeButtons[RETROPAD.R]
              ? 'bg-white text-black border-white scale-95 shadow-white/40'
              : 'bg-neutral-900/90 text-neutral-200 border-neutral-600 active:scale-95 hover:border-cyan-400'
          }`}
        >
          R1
        </button>
      </div>

      {/* --- TOUCHES COIN & START AU CENTRE --- */}
      <div
        style={{
          left: `${layout.coins?.x ?? 50}%`,
          top: `${layout.coins?.y ?? 90}%`,
          transform: `translate(-50%, -50%) scale(${scaleFactor})`
        }}
        className={`absolute pointer-events-auto flex items-center gap-4 ${
          isEditMode ? 'ring-2 ring-dashed ring-amber-400 cursor-move rounded-xl p-1.5' : ''
        }`}
        onMouseDown={(e) => isEditMode && handleStartDrag('coins', e.clientX, e.clientY)}
        onTouchStart={(e) => isEditMode && handleStartDrag('coins', e.touches[0].clientX, e.touches[0].clientY)}
      >
        <button
          onTouchStart={(e) => { e.preventDefault(); triggerInput(RETROPAD.SELECT, true); }}
          onTouchEnd={(e) => { e.preventDefault(); triggerInput(RETROPAD.SELECT, false); }}
          onMouseDown={() => triggerInput(RETROPAD.SELECT, true)}
          onMouseUp={() => triggerInput(RETROPAD.SELECT, false)}
          className={`px-3 py-1.5 rounded-xl border border-neutral-700 text-xs font-mono font-bold tracking-wider uppercase transition-transform ${
            activeButtons[RETROPAD.SELECT]
              ? 'bg-amber-400 text-black scale-95 shadow-lg shadow-amber-400/30'
              : 'bg-black/70 text-amber-400 hover:bg-neutral-900 active:scale-95'
          }`}
        >
          COIN (5)
        </button>

        <button
          onTouchStart={(e) => { e.preventDefault(); triggerInput(RETROPAD.START, true); }}
          onTouchEnd={(e) => { e.preventDefault(); triggerInput(RETROPAD.START, false); }}
          onMouseDown={() => triggerInput(RETROPAD.START, true)}
          onMouseUp={() => triggerInput(RETROPAD.START, false)}
          className={`px-3 py-1.5 rounded-xl border border-cyan-500/40 text-xs font-mono font-bold tracking-wider uppercase transition-transform ${
            activeButtons[RETROPAD.START]
              ? 'bg-cyan-400 text-black scale-95 shadow-lg shadow-cyan-400/30'
              : 'bg-cyan-950/70 text-cyan-300 hover:bg-cyan-900 active:scale-95'
          }`}
        >
          START (1)
        </button>
      </div>
    </div>
  );
}
