import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Move, Check, RotateCcw, Gamepad2, Pencil, ArrowDown, ArrowUp, Zap } from 'lucide-react';

// RetroPad IDs & Macros pour Neo Geo
const RETROPAD = {
  B: 0,           // Neo Geo A (Bouton A mobile / Poing Faible / Tir)
  A: 8,           // Neo Geo B (Bouton B mobile / Pied Faible / Saut)
  Y: 1,           // Neo Geo C (Bouton X mobile / Poing Fort / Grenade)
  X: 9,           // Neo Geo D (Bouton Y mobile / Pied Fort / Spécial)
  SELECT: 2,      // Coin / Crédit
  START: 3,       // Start
  UP: 4,
  DOWN: 5,
  LEFT: 6,
  RIGHT: 7,
  L: 10,          // L1 standard
  R: 11,          // R1 standard
  MACRO_AB: 100,  // Macro A+B (Roulade / Esquive KOF)
  MACRO_CD: 101,  // Macro C+D (Attaque de Projection Blowback)
  MACRO_ABC: 102, // Macro A+B+C (MAX Mode / Super KOF)
  TURBO_A: 103    // Turbo A (Tir Automatique 30Hz Metal Slug)
};

// Positions initiales ergonomiques (en pourcentage de l'écran en mode Overlay)
const DEFAULT_TOUCH_LAYOUT = {
  dpad: { x: 18, y: 72 },       // Gauche bas
  buttons: { x: 82, y: 72 },    // Droite bas (A, B, X, Y)
  l1: { x: 14, y: 22 },         // En haut à gauche
  r1: { x: 86, y: 22 },         // En haut à droite
  turbo: { x: 50, y: 76 },      // Centre intermédiaire
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

  const triggerInput = useCallback((btnId, isPressed, skipHaptic = false) => {
    if (isEditMode || isStylusActive) return;
    if (typeof onInput === 'function') {
      onInput(btnId, isPressed);
    }
    setActiveButtons(prev => ({ ...prev, [btnId]: isPressed }));
    if (isPressed && !skipHaptic) {
      triggerHaptic();
    }
  }, [onInput, isEditMode, isStylusActive, triggerHaptic]);

  // Options tactiles avancées Neo Geo
  const dpadType = settings?.touch?.dpadType ?? 'analog'; // 'analog' | 'dpad'
  const isDpadMode = dpadType === 'dpad';
  const turboEnabled = settings?.touch?.turboEnabled ?? true;
  const macroAbEnabled = settings?.touch?.macroAbEnabled ?? true;
  const macroCdEnabled = settings?.touch?.macroCdEnabled ?? true;

  // Joystick analogique tactile 360° avec centrage par ressort et 8 directions Neo Geo
  const isFloatingMode = (settings?.touch?.joystickMode ?? 'floating') === 'floating';
  const joystickRef = useRef(null);
  const [stickPos, setStickPos] = useState({ x: 0, y: 0 });
  const [isStickActive, setIsStickActive] = useState(false);
  const [floatingOrigin, setFloatingOrigin] = useState(null); // { x, y } coordonnées écran du centre flottant
  const floatingOriginRef = useRef(null);
  const activeTouchIdRef = useRef(null);
  const isCompactStickRef = useRef(false);

  // Initialisation instantanée du joystick flottant à l'endroit du contact tactile
  const startFloatingStick = useCallback((clientX, clientY, identifier, isCompact = false) => {
    if (isEditMode || isStylusActive) return;
    isCompactStickRef.current = isCompact;
    activeTouchIdRef.current = identifier;
    floatingOriginRef.current = { x: clientX, y: clientY };
    setFloatingOrigin({ x: clientX, y: clientY });
    setIsStickActive(true);
    setStickPos({ x: 0, y: 0 });
    setActiveDirections({ up: false, down: false, left: false, right: false });
  }, [isEditMode, isStylusActive]);

  const handleStickMove = useCallback((clientX, clientY, isCompact = false) => {
    if (isEditMode || isStylusActive) return;

    let centerX = 0;
    let centerY = 0;
    const isFloating = isFloatingMode && floatingOriginRef.current !== null;

    if (isFloating) {
      centerX = floatingOriginRef.current.x;
      centerY = floatingOriginRef.current.y;
    } else {
      if (!joystickRef.current) return;
      const rect = joystickRef.current.getBoundingClientRect();
      centerX = rect.left + rect.width / 2;
      centerY = rect.top + rect.height / 2;
    }

    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const distance = Math.hypot(dx, dy);
    const maxRadius = isCompact ? 34 : 44;
    const maxFollowRadius = maxRadius + 14;

    // Déplacement visuel bridé au rayon maximum du socle
    let clampedX = dx;
    let clampedY = dy;
    if (distance > maxRadius) {
      clampedX = (dx / distance) * maxRadius;
      clampedY = (dy / distance) * maxRadius;
    }

    // Suivi dynamique de socle (Smooth Follow style Fortnite / COD Mobile) :
    // Quand le pouce se déplace loin, le socle glisse doucement vers le doigt
    // pour garantir une réversibilité immédiate sans latence de retour
    if (isFloating && distance > maxFollowRadius) {
      const excess = distance - maxFollowRadius;
      const nx = dx / distance;
      const ny = dy / distance;
      const newOrigin = {
        x: floatingOriginRef.current.x + nx * excess,
        y: floatingOriginRef.current.y + ny * excess
      };
      floatingOriginRef.current = newOrigin;
      setFloatingOrigin(newOrigin);
    }

    setStickPos({ x: clampedX, y: clampedY });
    setIsStickActive(true);

    // Détection de zone morte et mapping 8 directions Neo Geo RetroPad
    const deadzone = maxRadius * 0.25;
    if (distance < deadzone) {
      setActiveDirections({ up: false, down: false, left: false, right: false });
      triggerInput(RETROPAD.UP, false, true);
      triggerInput(RETROPAD.DOWN, false, true);
      triggerInput(RETROPAD.LEFT, false, true);
      triggerInput(RETROPAD.RIGHT, false, true);
      return;
    }

    // Calcul précis des 8 directions avec angle trigonométrique (-180° à +180°)
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const up = angle > -157.5 && angle < -22.5;
    const down = angle > 22.5 && angle < 157.5;
    const left = angle > 112.5 || angle < -112.5;
    const right = angle > -67.5 && angle < 67.5;

    setActiveDirections({ up, down, left, right });
    // Zéro vibration sur l'analogue : skipHaptic = true
    triggerInput(RETROPAD.UP, up, true);
    triggerInput(RETROPAD.DOWN, down, true);
    triggerInput(RETROPAD.LEFT, left, true);
    triggerInput(RETROPAD.RIGHT, right, true);
  }, [isEditMode, isStylusActive, isFloatingMode, triggerInput]);

  const handleStickRelease = useCallback(() => {
    setStickPos({ x: 0, y: 0 });
    setIsStickActive(false);
    activeTouchIdRef.current = null;
    floatingOriginRef.current = null;
    setFloatingOrigin(null);
    setActiveDirections({ up: false, down: false, left: false, right: false });
    triggerInput(RETROPAD.UP, false, true);
    triggerInput(RETROPAD.DOWN, false, true);
    triggerInput(RETROPAD.LEFT, false, true);
    triggerInput(RETROPAD.RIGHT, false, true);
  }, [triggerInput]);

  // D-Pad classique rétro (Croix directionnelle MVS/AES)
  const dpadRef = useRef(null);
  const [isDpadActive, setIsDpadActive] = useState(false);
  const dpadTouchIdRef = useRef(null);

  const handleDpadMove = useCallback((clientX, clientY) => {
    if (isEditMode || isStylusActive || !dpadRef.current) return;
    const rect = dpadRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const distance = Math.hypot(dx, dy);

    // Zone morte au centre de la croix
    if (distance < 12) {
      setActiveDirections({ up: false, down: false, left: false, right: false });
      triggerInput(RETROPAD.UP, false, true);
      triggerInput(RETROPAD.DOWN, false, true);
      triggerInput(RETROPAD.LEFT, false, true);
      triggerInput(RETROPAD.RIGHT, false, true);
      return;
    }

    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const up = angle > -157.5 && angle < -22.5;
    const down = angle > 22.5 && angle < 157.5;
    const left = angle > 112.5 || angle < -112.5;
    const right = angle > -67.5 && angle < 67.5;

    setActiveDirections({ up, down, left, right });
    // Strictement sans vibration (skipHaptic: true)
    triggerInput(RETROPAD.UP, up, true);
    triggerInput(RETROPAD.DOWN, down, true);
    triggerInput(RETROPAD.LEFT, left, true);
    triggerInput(RETROPAD.RIGHT, right, true);
  }, [isEditMode, isStylusActive, triggerInput]);

  const handleDpadRelease = useCallback(() => {
    setIsDpadActive(false);
    dpadTouchIdRef.current = null;
    setActiveDirections({ up: false, down: false, left: false, right: false });
    triggerInput(RETROPAD.UP, false, true);
    triggerInput(RETROPAD.DOWN, false, true);
    triggerInput(RETROPAD.LEFT, false, true);
    triggerInput(RETROPAD.RIGHT, false, true);
  }, [triggerInput]);

  // Suivi continu des contrôles directionnels (Joystick et D-Pad)
  useEffect(() => {
    if (!isStickActive && !isDpadActive) return;

    const handleWindowTouchMove = (e) => {
      for (let i = 0; i < e.touches.length; i++) {
        const touch = e.touches[i];
        if (isStickActive && touch.identifier === activeTouchIdRef.current) {
          if (e.cancelable) e.preventDefault();
          handleStickMove(touch.clientX, touch.clientY, isCompactStickRef.current);
        }
        if (isDpadActive && touch.identifier === dpadTouchIdRef.current) {
          if (e.cancelable) e.preventDefault();
          handleDpadMove(touch.clientX, touch.clientY);
        }
      }
    };

    const handleWindowTouchEnd = (e) => {
      if (isStickActive && activeTouchIdRef.current !== null) {
        let stillActive = false;
        for (let i = 0; i < e.touches.length; i++) {
          if (e.touches[i].identifier === activeTouchIdRef.current) {
            stillActive = true;
            break;
          }
        }
        if (!stillActive) handleStickRelease();
      }

      if (isDpadActive && dpadTouchIdRef.current !== null) {
        let stillActive = false;
        for (let i = 0; i < e.touches.length; i++) {
          if (e.touches[i].identifier === dpadTouchIdRef.current) {
            stillActive = true;
            break;
          }
        }
        if (!stillActive) handleDpadRelease();
      }
    };

    const handleWindowMouseMove = (e) => {
      if (isStickActive && activeTouchIdRef.current === 'mouse') {
        handleStickMove(e.clientX, e.clientY, isCompactStickRef.current);
      }
      if (isDpadActive && dpadTouchIdRef.current === 'mouse') {
        handleDpadMove(e.clientX, e.clientY);
      }
    };

    const handleWindowMouseUp = () => {
      if (isStickActive && activeTouchIdRef.current === 'mouse') handleStickRelease();
      if (isDpadActive && dpadTouchIdRef.current === 'mouse') handleDpadRelease();
    };

    window.addEventListener('touchmove', handleWindowTouchMove, { passive: false });
    window.addEventListener('touchend', handleWindowTouchEnd);
    window.addEventListener('touchcancel', handleWindowTouchEnd);
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('touchmove', handleWindowTouchMove);
      window.removeEventListener('touchend', handleWindowTouchEnd);
      window.removeEventListener('touchcancel', handleWindowTouchEnd);
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [isStickActive, isDpadActive, handleStickMove, handleStickRelease, handleDpadMove, handleDpadRelease]);

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

  // Rendu du Joystick Analogique Virtuel Arcade 360°
  const renderAnalogStick = (isCompact = false, isFloatingInstance = false) => {
    if (!isFloatingInstance) {
      isCompactStickRef.current = isCompact;
    }
    const baseSize = isCompact ? 'w-36 h-36' : 'w-40 h-40';
    const stickSize = isCompact ? 'w-14 h-14' : 'w-16 h-16';

    const onStickTouchStart = (e) => {
      if (isEditMode || isStylusActive) return;
      e.preventDefault();
      const touch = e.touches[0];
      if (isFloatingMode) {
        startFloatingStick(touch.clientX, touch.clientY, touch.identifier, isCompact);
      } else {
        activeTouchIdRef.current = touch.identifier;
        handleStickMove(touch.clientX, touch.clientY, isCompact);
      }
    };

    const onStickMouseDown = (e) => {
      if (isEditMode || isStylusActive) return;
      if (isFloatingMode) {
        startFloatingStick(e.clientX, e.clientY, 'mouse', isCompact);
      } else {
        activeTouchIdRef.current = 'mouse';
        handleStickMove(e.clientX, e.clientY, isCompact);
      }
    };

    const isCurrentActive = isFloatingInstance ? isStickActive : (!isFloatingMode && isStickActive);
    const currentStickPos = isFloatingInstance ? stickPos : (!isFloatingMode ? stickPos : { x: 0, y: 0 });
    const currentDirs = isFloatingInstance ? activeDirections : (!isFloatingMode ? activeDirections : { up: false, down: false, left: false, right: false });

    return (
      <div
        ref={isFloatingInstance ? null : joystickRef}
        onTouchStart={isFloatingInstance ? undefined : onStickTouchStart}
        onMouseDown={isFloatingInstance ? undefined : onStickMouseDown}
        className={`relative ${baseSize} rounded-full border-2 transition-all duration-100 ${
          isFloatingInstance
            ? 'border-cyan-400 bg-gradient-to-b from-neutral-900/98 via-neutral-950/98 to-black/98 shadow-[0_0_35px_rgba(6,182,212,0.45)] ring-2 ring-cyan-500/30'
            : 'border-cyan-500/40 bg-gradient-to-b from-neutral-900/95 via-neutral-950/95 to-black/95 shadow-2xl'
        } backdrop-blur-md select-none touch-none flex items-center justify-center`}
      >
        {/* Anneau de guidage concentrique */}
        <div className="absolute inset-2 rounded-full border border-neutral-700/40 pointer-events-none" />
        <div className="absolute inset-5 rounded-full border border-dashed border-cyan-500/20 pointer-events-none" />

        {/* Indicateurs directionnels cardinaux lumineux */}
        <div className={`absolute top-1.5 left-1/2 -translate-x-1/2 text-[10px] font-bold transition-all pointer-events-none ${
          currentDirs.up ? 'text-cyan-300 scale-125 drop-shadow-[0_0_8px_rgba(6,182,212,0.9)]' : 'text-neutral-600'
        }`}>▲</div>
        <div className={`absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[10px] font-bold transition-all pointer-events-none ${
          currentDirs.down ? 'text-cyan-300 scale-125 drop-shadow-[0_0_8px_rgba(6,182,212,0.9)]' : 'text-neutral-600'
        }`}>▼</div>
        <div className={`absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold transition-all pointer-events-none ${
          currentDirs.left ? 'text-cyan-300 scale-125 drop-shadow-[0_0_8px_rgba(6,182,212,0.9)]' : 'text-neutral-600'
        }`}>◀</div>
        <div className={`absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold transition-all pointer-events-none ${
          currentDirs.right ? 'text-cyan-300 scale-125 drop-shadow-[0_0_8px_rgba(6,182,212,0.9)]' : 'text-neutral-600'
        }`}>▶</div>

        {/* Zone morte centrale */}
        <div className="w-8 h-8 rounded-full border border-neutral-800/80 bg-neutral-950/50 pointer-events-none" />

        {/* Tête de stick analogique 3D déplaçable avec ressort */}
        <div
          style={{
            transform: `translate(calc(-50% + ${currentStickPos.x}px), calc(-50% + ${currentStickPos.y}px))`
          }}
          className={`absolute top-1/2 left-1/2 ${stickSize} rounded-full border-2 border-cyan-400/90 shadow-xl pointer-events-none flex items-center justify-center ${
            isCurrentActive 
              ? 'bg-gradient-to-b from-neutral-700 via-neutral-800 to-neutral-950 shadow-cyan-400/40 scale-105 transition-none' 
              : 'bg-gradient-to-b from-neutral-800 via-neutral-900 to-black shadow-black/80 transition-transform duration-150 ease-out'
          }`}
        >
          {/* Grip concave texturé */}
          <div className="w-8 h-8 rounded-full bg-gradient-to-b from-neutral-900 to-neutral-950 border border-neutral-600/60 shadow-inner flex items-center justify-center">
            {/* LED centrale néon */}
            <div className={`w-2.5 h-2.5 rounded-full transition-all ${
              isCurrentActive ? 'bg-cyan-300 shadow-[0_0_10px_rgba(6,182,212,1)] scale-110' : 'bg-cyan-600/70'
            }`} />
          </div>
        </div>
      </div>
    );
  };

  // Rendu de la Croix Directionnelle Rétro (D-Pad Neo Geo CD / Arcade)
  const renderClassicDpad = (isCompact = false) => {
    const sizeClass = isCompact ? 'w-36 h-36' : 'w-40 h-40';

    const onDpadTouchStart = (e) => {
      if (isEditMode || isStylusActive) return;
      e.preventDefault();
      const touch = e.touches[0];
      dpadTouchIdRef.current = touch.identifier;
      setIsDpadActive(true);
      handleDpadMove(touch.clientX, touch.clientY);
    };

    const onDpadMouseDown = (e) => {
      if (isEditMode || isStylusActive) return;
      dpadTouchIdRef.current = 'mouse';
      setIsDpadActive(true);
      handleDpadMove(e.clientX, e.clientY);
    };

    return (
      <div
        ref={dpadRef}
        onTouchStart={onDpadTouchStart}
        onMouseDown={onDpadMouseDown}
        className={`relative ${sizeClass} select-none touch-none flex items-center justify-center`}
      >
        {/* Socle circulaire encastré */}
        <div className="absolute inset-1 rounded-full bg-gradient-to-b from-neutral-950/90 via-neutral-900/90 to-black/95 border border-neutral-800 shadow-2xl pointer-events-none" />

        {/* Croix - Branche Horizontale (Gauche / Droite) */}
        <div className="absolute w-[88%] h-[34%] bg-gradient-to-b from-neutral-800 via-neutral-900 to-black rounded-lg border-2 border-neutral-700/80 shadow-md pointer-events-none flex items-center justify-between px-2">
          {/* Aile Gauche */}
          <div className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
            activeDirections.left ? 'bg-cyan-500/40 text-cyan-300 drop-shadow-[0_0_8px_rgba(6,182,212,0.9)]' : 'text-neutral-500'
          }`}>
            <span className="font-bold text-sm">◀</span>
          </div>
          {/* Aile Droite */}
          <div className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
            activeDirections.right ? 'bg-cyan-500/40 text-cyan-300 drop-shadow-[0_0_8px_rgba(6,182,212,0.9)]' : 'text-neutral-500'
          }`}>
            <span className="font-bold text-sm">▶</span>
          </div>
        </div>

        {/* Croix - Branche Verticale (Haut / Bas) */}
        <div className="absolute h-[88%] w-[34%] bg-gradient-to-b from-neutral-800 via-neutral-900 to-black rounded-lg border-2 border-neutral-700/80 shadow-md pointer-events-none flex flex-col items-center justify-between py-2">
          {/* Aile Haut */}
          <div className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
            activeDirections.up ? 'bg-cyan-500/40 text-cyan-300 drop-shadow-[0_0_8px_rgba(6,182,212,0.9)]' : 'text-neutral-500'
          }`}>
            <span className="font-bold text-sm">▲</span>
          </div>
          {/* Aile Bas */}
          <div className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
            activeDirections.down ? 'bg-cyan-500/40 text-cyan-300 drop-shadow-[0_0_8px_rgba(6,182,212,0.9)]' : 'text-neutral-500'
          }`}>
            <span className="font-bold text-sm">▼</span>
          </div>
        </div>

        {/* Pivot Central Incurvé (Empreinte ergonomique) */}
        <div className="relative w-8 h-8 rounded-full bg-gradient-to-b from-neutral-900 to-black border border-neutral-700/60 shadow-inner flex items-center justify-center pointer-events-none z-10">
          <div className={`w-2 h-2 rounded-full transition-all ${
            isDpadActive ? 'bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,1)]' : 'bg-neutral-700'
          }`} />
        </div>
      </div>
    );
  };

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
              onTouchStart={(e) => { e.preventDefault(); triggerInput(macroAbEnabled ? RETROPAD.MACRO_AB : RETROPAD.L, true); }}
              onTouchEnd={(e) => { e.preventDefault(); triggerInput(macroAbEnabled ? RETROPAD.MACRO_AB : RETROPAD.L, false); }}
              onMouseDown={() => triggerInput(macroAbEnabled ? RETROPAD.MACRO_AB : RETROPAD.L, true)}
              onMouseUp={() => triggerInput(macroAbEnabled ? RETROPAD.MACRO_AB : RETROPAD.L, false)}
              className={`px-3 py-1 rounded-lg border text-xs font-bold transition-all flex flex-col items-center justify-center ${
                (activeButtons[RETROPAD.MACRO_AB] || activeButtons[RETROPAD.L])
                  ? 'bg-white text-black border-white scale-95 shadow-md shadow-white/50'
                  : 'bg-neutral-900/90 text-neutral-300 border-neutral-700 active:scale-95'
              }`}
              title={macroAbEnabled ? 'Macro L1 (A+B : Roulade / Esquive KOF)' : 'L1'}
            >
              <span className="leading-none">L1</span>
              {macroAbEnabled && <span className="text-[7px] text-amber-400 font-mono tracking-tighter opacity-90 font-semibold">A+B</span>}
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

              {/* BOUTON TURBO A (Metal Slug) */}
              {turboEnabled && (
                <button
                  onTouchStart={(e) => { e.preventDefault(); triggerInput(RETROPAD.TURBO_A, true); }}
                  onTouchEnd={(e) => { e.preventDefault(); triggerInput(RETROPAD.TURBO_A, false); }}
                  onMouseDown={() => triggerInput(RETROPAD.TURBO_A, true)}
                  onMouseUp={() => triggerInput(RETROPAD.TURBO_A, false)}
                  className={`px-2 py-1 rounded-lg border text-[10px] font-mono font-bold uppercase transition-transform flex items-center gap-1 ${
                    activeButtons[RETROPAD.TURBO_A]
                      ? 'bg-red-500 text-white border-red-400 scale-95 shadow-md shadow-red-500/50'
                      : 'bg-red-950/80 text-red-300 border-red-500/50 hover:bg-red-900 active:scale-95'
                  }`}
                  title="Tir Automatique Turbo A 30Hz (Metal Slug)"
                >
                  <Zap className="w-3 h-3 text-amber-400 animate-pulse" />
                  <span>TURBO</span>
                </button>
              )}

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
              onTouchStart={(e) => { e.preventDefault(); triggerInput(macroCdEnabled ? RETROPAD.MACRO_CD : RETROPAD.R, true); }}
              onTouchEnd={(e) => { e.preventDefault(); triggerInput(macroCdEnabled ? RETROPAD.MACRO_CD : RETROPAD.R, false); }}
              onMouseDown={() => triggerInput(macroCdEnabled ? RETROPAD.MACRO_CD : RETROPAD.R, true)}
              onMouseUp={() => triggerInput(macroCdEnabled ? RETROPAD.MACRO_CD : RETROPAD.R, false)}
              className={`px-3 py-1 rounded-lg border text-xs font-bold transition-all flex flex-col items-center justify-center ${
                (activeButtons[RETROPAD.MACRO_CD] || activeButtons[RETROPAD.R])
                  ? 'bg-white text-black border-white scale-95 shadow-md shadow-white/50'
                  : 'bg-neutral-900/90 text-neutral-300 border-neutral-700 active:scale-95'
              }`}
              title={macroCdEnabled ? 'Macro R1 (C+D : Blowback KOF)' : 'R1'}
            >
              <span className="leading-none">R1</span>
              {macroCdEnabled && <span className="text-[7px] text-rose-400 font-mono tracking-tighter opacity-90 font-semibold">C+D</span>}
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
              <Move className="w-2.5 h-2.5" /> Glisser pour ajuster {isDpadMode ? 'D-Pad' : 'Joystick'} & Boutons
            </div>
          )}

          {/* Contrôle directionnel gauche : D-Pad rétro OU Joystick analogique 360° */}
          <div className="relative w-1/2 h-full flex items-center justify-center">
            {isDpadMode ? (
              renderClassicDpad(true)
            ) : (
              <>
                {isFloatingMode && !isStylusActive && (
                  <div
                    className="absolute inset-0 z-20 pointer-events-auto touch-none select-none"
                    onTouchStart={(e) => {
                      if (activeTouchIdRef.current !== null || isStylusActive) return;
                      e.preventDefault();
                      const touch = e.changedTouches[0];
                      if (touch) {
                        startFloatingStick(touch.clientX, touch.clientY, touch.identifier, true);
                      }
                    }}
                    onMouseDown={(e) => {
                      if (activeTouchIdRef.current !== null || isStylusActive) return;
                      startFloatingStick(e.clientX, e.clientY, 'mouse', true);
                    }}
                  />
                )}
                <div className={`transition-opacity duration-150 ${isFloatingMode && isStickActive ? 'opacity-20 scale-95' : 'opacity-100'}`}>
                  {renderAnalogStick(true, false)}
                </div>
              </>
            )}
          </div>

          {/* Boutons arcade droite */}
          <div className="w-1/2 h-full flex items-center justify-center">
            {renderActionButtons(true)}
          </div>
        </div>

        {/* Joystick Flottant Dynamique actif sous le pouce en mode Portrait Pad (mode analogique uniquement) */}
        {!isDpadMode && isFloatingMode && isStickActive && floatingOrigin && (
          <div
            style={{
              position: 'fixed',
              left: `${floatingOrigin.x}px`,
              top: `${floatingOrigin.y}px`,
              transform: 'translate(-50%, -50%)',
              zIndex: 70,
              pointerEvents: 'none'
            }}
            className="select-none touch-none animate-in fade-in zoom-in-90 duration-75"
          >
            {renderAnalogStick(true, true)}
          </div>
        )}
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

      {/* ZONE TACTILE GAUCHE PLEIN ÉCRAN (JOYSTICK FLOTTANT DYNAMIQUE FORTNITE) - UNIQUEMENT EN MODE ANALOGIQUE */}
      {!isDpadMode && isFloatingMode && !isEditMode && (
        <div
          className="absolute top-16 bottom-0 left-0 w-1/2 pointer-events-auto touch-none select-none z-10"
          onTouchStart={(e) => {
            if (activeTouchIdRef.current !== null) return;
            e.preventDefault();
            const touch = e.changedTouches[0];
            if (touch) {
              startFloatingStick(touch.clientX, touch.clientY, touch.identifier, false);
            }
          }}
          onMouseDown={(e) => {
            if (activeTouchIdRef.current !== null) return;
            startFloatingStick(e.clientX, e.clientY, 'mouse', false);
          }}
        />
      )}

      {/* --- D-PAD / VIRTUAL JOYSTICK GAUCHE --- */}
      <div
        style={{
          left: `${layout.dpad.x}%`,
          top: `${layout.dpad.y}%`,
          transform: `translate(-50%, -50%) scale(${scaleFactor})`
        }}
        className={`absolute rounded-full transition-all duration-150 ${
          isEditMode ? 'ring-2 ring-dashed ring-amber-400 cursor-move pointer-events-auto z-40' : ''
        } ${
          isDpadMode
            ? 'pointer-events-auto z-20'
            : isFloatingMode 
              ? (isStickActive ? 'opacity-15 scale-90 pointer-events-none' : 'opacity-60 pointer-events-none') 
              : 'pointer-events-auto z-20'
        }`}
        onMouseDown={(e) => isEditMode && handleStartDrag('dpad', e.clientX, e.clientY)}
        onTouchStart={(e) => isEditMode && handleStartDrag('dpad', e.touches[0].clientX, e.touches[0].clientY)}
      >
        {isDpadMode ? renderClassicDpad(false) : renderAnalogStick(false, false)}
      </div>

      {/* --- CLUSTER DE TOUCHES MOBILE (A, B, X, Y) --- */}
      <div
        style={{
          left: `${layout.buttons.x}%`,
          top: `${layout.buttons.y}%`,
          transform: `translate(-50%, -50%) scale(${scaleFactor})`
        }}
        className={`absolute pointer-events-auto z-30 rounded-full ${
          isEditMode ? 'ring-2 ring-dashed ring-amber-400 cursor-move' : ''
        }`}
        onMouseDown={(e) => isEditMode && handleStartDrag('buttons', e.clientX, e.clientY)}
        onTouchStart={(e) => isEditMode && handleStartDrag('buttons', e.touches[0].clientX, e.touches[0].clientY)}
      >
        {renderActionButtons(false)}
      </div>

      {/* --- TOUCHE L1 AUTONOME (MACRO A+B ROULADE) --- */}
      <div
        style={{
          left: `${layout.l1?.x ?? 14}%`,
          top: `${layout.l1?.y ?? 22}%`,
          transform: `translate(-50%, -50%) scale(${scaleFactor})`
        }}
        className={`absolute pointer-events-auto z-30 ${
          isEditMode ? 'ring-2 ring-dashed ring-amber-400 cursor-move rounded-xl p-1' : ''
        }`}
        onMouseDown={(e) => isEditMode && handleStartDrag('l1', e.clientX, e.clientY)}
        onTouchStart={(e) => isEditMode && handleStartDrag('l1', e.touches[0].clientX, e.touches[0].clientY)}
      >
        <button
          onTouchStart={(e) => { e.preventDefault(); triggerInput(macroAbEnabled ? RETROPAD.MACRO_AB : RETROPAD.L, true); }}
          onTouchEnd={(e) => { e.preventDefault(); triggerInput(macroAbEnabled ? RETROPAD.MACRO_AB : RETROPAD.L, false); }}
          onMouseDown={() => triggerInput(macroAbEnabled ? RETROPAD.MACRO_AB : RETROPAD.L, true)}
          onMouseUp={() => triggerInput(macroAbEnabled ? RETROPAD.MACRO_AB : RETROPAD.L, false)}
          className={`px-4 py-2 rounded-xl border-2 font-bold text-xs tracking-wider shadow-xl transition-all flex flex-col items-center justify-center ${
            (activeButtons[RETROPAD.MACRO_AB] || activeButtons[RETROPAD.L])
              ? 'bg-white text-black border-white scale-95 shadow-white/40'
              : 'bg-neutral-900/90 text-neutral-200 border-neutral-600 active:scale-95 hover:border-cyan-400'
          }`}
          title={macroAbEnabled ? 'Macro L1 (A+B : Roulade / Esquive KOF)' : 'L1'}
        >
          <span className="leading-none">L1</span>
          {macroAbEnabled && <span className="text-[8px] text-amber-400 font-mono tracking-tighter opacity-90 font-semibold">ESQUIVE A+B</span>}
        </button>
      </div>

      {/* --- TOUCHE R1 AUTONOME (MACRO C+D BLOWBACK) --- */}
      <div
        style={{
          left: `${layout.r1?.x ?? 86}%`,
          top: `${layout.r1?.y ?? 22}%`,
          transform: `translate(-50%, -50%) scale(${scaleFactor})`
        }}
        className={`absolute pointer-events-auto z-30 ${
          isEditMode ? 'ring-2 ring-dashed ring-amber-400 cursor-move rounded-xl p-1' : ''
        }`}
        onMouseDown={(e) => isEditMode && handleStartDrag('r1', e.clientX, e.clientY)}
        onTouchStart={(e) => isEditMode && handleStartDrag('r1', e.touches[0].clientX, e.touches[0].clientY)}
      >
        <button
          onTouchStart={(e) => { e.preventDefault(); triggerInput(macroCdEnabled ? RETROPAD.MACRO_CD : RETROPAD.R, true); }}
          onTouchEnd={(e) => { e.preventDefault(); triggerInput(macroCdEnabled ? RETROPAD.MACRO_CD : RETROPAD.R, false); }}
          onMouseDown={() => triggerInput(macroCdEnabled ? RETROPAD.MACRO_CD : RETROPAD.R, true)}
          onMouseUp={() => triggerInput(macroCdEnabled ? RETROPAD.MACRO_CD : RETROPAD.R, false)}
          className={`px-4 py-2 rounded-xl border-2 font-bold text-xs tracking-wider shadow-xl transition-all flex flex-col items-center justify-center ${
            (activeButtons[RETROPAD.MACRO_CD] || activeButtons[RETROPAD.R])
              ? 'bg-white text-black border-white scale-95 shadow-white/40'
              : 'bg-neutral-900/90 text-neutral-200 border-neutral-600 active:scale-95 hover:border-cyan-400'
          }`}
          title={macroCdEnabled ? 'Macro R1 (C+D : Blowback KOF)' : 'R1'}
        >
          <span className="leading-none">R1</span>
          {macroCdEnabled && <span className="text-[8px] text-rose-400 font-mono tracking-tighter opacity-90 font-semibold">CHOC C+D</span>}
        </button>
      </div>

      {/* --- TOUCHE TURBO A DÉDIÉE (METAL SLUG 30Hz) --- */}
      {turboEnabled && (
        <div
          style={{
            left: `${layout.turbo?.x ?? 50}%`,
            top: `${layout.turbo?.y ?? 76}%`,
            transform: `translate(-50%, -50%) scale(${scaleFactor})`
          }}
          className={`absolute pointer-events-auto z-30 ${
            isEditMode ? 'ring-2 ring-dashed ring-amber-400 cursor-move rounded-xl p-1' : ''
          }`}
          onMouseDown={(e) => isEditMode && handleStartDrag('turbo', e.clientX, e.clientY)}
          onTouchStart={(e) => isEditMode && handleStartDrag('turbo', e.touches[0].clientX, e.touches[0].clientY)}
        >
          <button
            onTouchStart={(e) => { e.preventDefault(); triggerInput(RETROPAD.TURBO_A, true); }}
            onTouchEnd={(e) => { e.preventDefault(); triggerInput(RETROPAD.TURBO_A, false); }}
            onMouseDown={() => triggerInput(RETROPAD.TURBO_A, true)}
            onMouseUp={() => triggerInput(RETROPAD.TURBO_A, false)}
            className={`px-3 py-1.5 rounded-xl border-2 font-bold text-xs tracking-wider shadow-xl transition-all flex items-center gap-1 ${
              activeButtons[RETROPAD.TURBO_A]
                ? 'bg-red-500 text-white border-red-400 scale-95 shadow-red-500/50'
                : 'bg-red-950/85 text-red-200 border-red-500/50 active:scale-95 hover:border-red-400'
            }`}
            title="Tir Automatique Turbo A 30Hz (Metal Slug)"
          >
            <Zap className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            <span>TURBO A</span>
          </button>
        </div>
      )}

      {/* --- TOUCHES COIN & START AU CENTRE --- */}
      <div
        style={{
          left: `${layout.coins?.x ?? 50}%`,
          top: `${layout.coins?.y ?? 90}%`,
          transform: `translate(-50%, -50%) scale(${scaleFactor})`
        }}
        className={`absolute pointer-events-auto z-30 flex items-center gap-4 ${
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

      {/* Joystick Flottant Dynamique actif sous le doigt en mode Overlay (Style Fortnite - mode analogique uniquement) */}
      {!isDpadMode && isFloatingMode && isStickActive && floatingOrigin && (
        <div
          style={{
            position: 'fixed',
            left: `${floatingOrigin.x}px`,
            top: `${floatingOrigin.y}px`,
            transform: `translate(-50%, -50%) scale(${scaleFactor})`,
            zIndex: 70,
            pointerEvents: 'none'
          }}
          className="select-none touch-none animate-in fade-in zoom-in-90 duration-75"
        >
          {renderAnalogStick(false, true)}
        </div>
      )}
    </div>
  );
}
