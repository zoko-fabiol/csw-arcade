import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Move, Check, RotateCcw } from 'lucide-react';

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

// Positions initiales ergonomiques (en pourcentage de l'écran)
const DEFAULT_TOUCH_LAYOUT = {
  dpad: { x: 20, y: 72 },       // Gauche bas
  buttons: { x: 80, y: 72 },    // Droite bas (A, B, X, Y)
  l1: { x: 16, y: 22 },         // En haut à gauche (index gauche / claw)
  r1: { x: 84, y: 22 },         // En haut à droite (index droit / claw)
  coins: { x: 50, y: 90 },      // Centre bas
  scale: 100,                   // 70 à 140 %
  opacity: 75                   // 20 à 100 %
};

const STORAGE_KEY = 'csw_touch_layout_v3';

export function TouchOverlay({ onInput, isVisible, onToggleVisibility }) {
  const [layout, setLayout] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...DEFAULT_TOUCH_LAYOUT, ...JSON.parse(saved) };
    } catch (e) {}
    return DEFAULT_TOUCH_LAYOUT;
  });

  const [isEditMode, setIsEditMode] = useState(false);
  const [draggingTarget, setDraggingTarget] = useState(null); // 'dpad' | 'buttons' | 'l1' | 'r1' | 'coins'
  const dragStartRef = useRef({ startX: 0, startY: 0, initPosX: 0, initPosY: 0 });

  const [activeDirections, setActiveDirections] = useState({ up: false, down: false, left: false, right: false });
  const [activeButtons, setActiveButtons] = useState({});

  const saveLayout = useCallback((newLayout) => {
    setLayout(newLayout);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newLayout));
    } catch (e) {}
  }, []);

  const resetLayout = () => {
    saveLayout(DEFAULT_TOUCH_LAYOUT);
  };

  const triggerInput = useCallback((btnId, isPressed) => {
    if (isEditMode) return;
    if (typeof onInput === 'function') {
      onInput(btnId, isPressed);
    }
    setActiveButtons(prev => ({ ...prev, [btnId]: isPressed }));
  }, [onInput, isEditMode]);

  // D-Pad tactile fluide 8 directions
  const dpadRef = useRef(null);
  const handleDpadTouch = useCallback((clientX, clientY, isEnd = false) => {
    if (isEditMode) return;
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

  // Drag & drop en mode édition
  const handleStartDrag = (target, clientX, clientY) => {
    if (!isEditMode) return;
    setDraggingTarget(target);
    dragStartRef.current = {
      startX: clientX,
      startY: clientY,
      initPosX: layout[target]?.x ?? 50,
      initPosY: layout[target]?.y ?? 50
    };
  };

  useEffect(() => {
    if (!isEditMode || !draggingTarget) return;

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
  }, [isEditMode, draggingTarget, layout, saveLayout]);

  if (!isVisible) return null;

  const scaleFactor = (layout.scale || 100) / 100;
  const opacityVal = (layout.opacity || 75) / 100;

  return (
    <div 
      className="absolute inset-0 pointer-events-none z-30 select-none overflow-hidden font-mono"
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
            <div className="flex items-center gap-2 text-[10px] text-neutral-400">
              <span>Taille:</span>
              <input
                type="range"
                min="70"
                max="140"
                value={layout.scale}
                onChange={(e) => saveLayout({ ...layout, scale: Number(e.target.value) })}
                className="w-16 accent-cyan-500"
              />
            </div>
          </>
        )}
      </div>

      {/* --- D-PAD / VIRTUAL JOYSTICK GAUCHE --- */}
      <div
        ref={dpadRef}
        style={{
          left: `${layout.dpad.x}%`,
          top: `${layout.dpad.y}%`,
          transform: `translate(-50%, -50%) scale(${scaleFactor})`
        }}
        className={`absolute pointer-events-auto w-40 h-40 rounded-full flex items-center justify-center transition-shadow ${
          isEditMode
            ? 'border-2 border-dashed border-amber-400 bg-amber-950/20 cursor-move'
            : 'border border-cyan-500/30 bg-black/40 backdrop-blur-sm'
        }`}
        onMouseDown={(e) => isEditMode && handleStartDrag('dpad', e.clientX, e.clientY)}
        onTouchStart={(e) => {
          if (isEditMode) {
            handleStartDrag('dpad', e.touches[0].clientX, e.touches[0].clientY);
          } else {
            e.preventDefault();
            handleDpadTouch(e.touches[0].clientX, e.touches[0].clientY);
          }
        }}
        onTouchMove={(e) => !isEditMode && handleDpadTouch(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchEnd={() => !isEditMode && handleDpadTouch(0, 0, true)}
        onTouchCancel={() => !isEditMode && handleDpadTouch(0, 0, true)}
      >
        <div className="relative w-32 h-32 flex items-center justify-center">
          <div className={`absolute top-0 w-10 h-10 rounded-t-xl flex items-center justify-center font-bold text-xs border ${
            activeDirections.up ? 'bg-cyan-500 text-black border-cyan-400 scale-95' : 'bg-neutral-800/80 text-neutral-300 border-neutral-700'
          }`}>▲</div>
          <div className={`absolute bottom-0 w-10 h-10 rounded-b-xl flex items-center justify-center font-bold text-xs border ${
            activeDirections.down ? 'bg-cyan-500 text-black border-cyan-400 scale-95' : 'bg-neutral-800/80 text-neutral-300 border-neutral-700'
          }`}>▼</div>
          <div className={`absolute left-0 w-10 h-10 rounded-l-xl flex items-center justify-center font-bold text-xs border ${
            activeDirections.left ? 'bg-cyan-500 text-black border-cyan-400 scale-95' : 'bg-neutral-800/80 text-neutral-300 border-neutral-700'
          }`}>◀</div>
          <div className={`absolute right-0 w-10 h-10 rounded-r-xl flex items-center justify-center font-bold text-xs border ${
            activeDirections.right ? 'bg-cyan-500 text-black border-cyan-400 scale-95' : 'bg-neutral-800/80 text-neutral-300 border-neutral-700'
          }`}>▶</div>
          <div className="w-8 h-8 rounded-full bg-neutral-900 border border-neutral-700 shadow-inner" />
        </div>
      </div>

      {/* --- CLUSTER DE TOUCHES MOBILE (A, B, X, Y) SEULEMENT --- */}
      <div
        style={{
          left: `${layout.buttons.x}%`,
          top: `${layout.buttons.y}%`,
          transform: `translate(-50%, -50%) scale(${scaleFactor})`
        }}
        className={`absolute pointer-events-auto w-44 h-44 rounded-full flex items-center justify-center ${
          isEditMode ? 'border-2 border-dashed border-amber-400 bg-amber-950/20 cursor-move' : ''
        }`}
        onMouseDown={(e) => isEditMode && handleStartDrag('buttons', e.clientX, e.clientY)}
        onTouchStart={(e) => isEditMode && handleStartDrag('buttons', e.touches[0].clientX, e.touches[0].clientY)}
      >
        <div className="relative w-40 h-40">
          {/* Bouton Y (Haut / Jaune) -> Neo Geo Bouton D */}
          <button
            onTouchStart={(e) => { e.preventDefault(); triggerInput(RETROPAD.X, true); }}
            onTouchEnd={(e) => { e.preventDefault(); triggerInput(RETROPAD.X, false); }}
            onMouseDown={() => triggerInput(RETROPAD.X, true)}
            onMouseUp={() => triggerInput(RETROPAD.X, false)}
            className={`absolute top-0 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full border-2 border-amber-400/90 flex flex-col items-center justify-center font-bold shadow-lg transition-transform ${
              activeButtons[RETROPAD.X]
                ? 'bg-amber-400 text-black scale-95 shadow-amber-400/50'
                : 'bg-amber-950/80 text-amber-300 active:scale-95'
            }`}
          >
            <span className="text-base font-black">Y</span>
            <span className="text-[8px] opacity-70">D</span>
          </button>

          {/* Bouton X (Gauche / Bleu) -> Neo Geo Bouton C */}
          <button
            onTouchStart={(e) => { e.preventDefault(); triggerInput(RETROPAD.Y, true); }}
            onTouchEnd={(e) => { e.preventDefault(); triggerInput(RETROPAD.Y, false); }}
            onMouseDown={() => triggerInput(RETROPAD.Y, true)}
            onMouseUp={() => triggerInput(RETROPAD.Y, false)}
            className={`absolute left-0 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full border-2 border-cyan-400/90 flex flex-col items-center justify-center font-bold shadow-lg transition-transform ${
              activeButtons[RETROPAD.Y]
                ? 'bg-cyan-400 text-black scale-95 shadow-cyan-400/50'
                : 'bg-cyan-950/80 text-cyan-300 active:scale-95'
            }`}
          >
            <span className="text-base font-black">X</span>
            <span className="text-[8px] opacity-70">C</span>
          </button>

          {/* Bouton B (Droite / Rouge) -> Neo Geo Bouton B */}
          <button
            onTouchStart={(e) => { e.preventDefault(); triggerInput(RETROPAD.A, true); }}
            onTouchEnd={(e) => { e.preventDefault(); triggerInput(RETROPAD.A, false); }}
            onMouseDown={() => triggerInput(RETROPAD.A, true)}
            onMouseUp={() => triggerInput(RETROPAD.A, false)}
            className={`absolute right-0 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full border-2 border-rose-500/90 flex flex-col items-center justify-center font-bold shadow-lg transition-transform ${
              activeButtons[RETROPAD.A]
                ? 'bg-rose-500 text-white scale-95 shadow-rose-500/50'
                : 'bg-rose-950/80 text-rose-300 active:scale-95'
            }`}
          >
            <span className="text-base font-black">B</span>
            <span className="text-[8px] opacity-70">B</span>
          </button>

          {/* Bouton A (Bas / Vert) -> Neo Geo Bouton A */}
          <button
            onTouchStart={(e) => { e.preventDefault(); triggerInput(RETROPAD.B, true); }}
            onTouchEnd={(e) => { e.preventDefault(); triggerInput(RETROPAD.B, false); }}
            onMouseDown={() => triggerInput(RETROPAD.B, true)}
            onMouseUp={() => triggerInput(RETROPAD.B, false)}
            className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full border-2 border-emerald-400/90 flex flex-col items-center justify-center font-bold shadow-lg transition-transform ${
              activeButtons[RETROPAD.B]
                ? 'bg-emerald-400 text-black scale-95 shadow-emerald-400/50'
                : 'bg-emerald-950/80 text-emerald-300 active:scale-95'
            }`}
          >
            <span className="text-base font-black">A</span>
            <span className="text-[8px] opacity-70">A</span>
          </button>
        </div>
      </div>

      {/* --- TOUCHE L1 AUTONOME (DÉPLAÇABLE N'IMPORTE OÙ) --- */}
      <div
        style={{
          left: `${layout.l1?.x ?? 16}%`,
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

      {/* --- TOUCHE R1 AUTONOME (DÉPLAÇABLE N'IMPORTE OÙ) --- */}
      <div
        style={{
          left: `${layout.r1?.x ?? 84}%`,
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

      {/* --- TOUCHES COIN & START AU CENTRE (DÉPLAÇABLES) --- */}
      <div
        style={{
          left: `${layout.coins?.x ?? 50}%`,
          top: `${layout.coins?.y ?? 90}%`,
          transform: `translate(-50%, -50%) scale(${scaleFactor})`
        }}
        className={`absolute pointer-events-auto flex items-center gap-6 ${
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
          className={`px-4 py-2 rounded-xl border border-neutral-700 text-xs font-mono font-bold tracking-wider uppercase transition-transform ${
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
          className={`px-4 py-2 rounded-xl border border-cyan-500/40 text-xs font-mono font-bold tracking-wider uppercase transition-transform ${
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
