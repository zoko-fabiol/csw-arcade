import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Gamepad2, Wifi, LogOut, Radio } from 'lucide-react';
import { netplayService } from '../../services/NetplayService';

// RetroPad IDs pour Neo Geo FBNeo
const RETROPAD = {
  B: 0,      // Neo Geo Bouton A (Poing Faible)
  A: 8,      // Neo Geo Bouton B (Pied Faible)
  Y: 1,      // Neo Geo Bouton C (Poing Fort)
  X: 9,      // Neo Geo Bouton D (Pied Fort)
  SELECT: 2, // Coin
  START: 3,  // Start
  UP: 4,
  DOWN: 5,
  LEFT: 6,
  RIGHT: 7,
  L: 10,     // L1
  R: 11      // R1
};

export function MobileControllerView({ sessionData, onExit }) {
  const [ping, setPing] = useState(0);
  const [activeButtons, setActiveButtons] = useState({});
  const [activeDirections, setActiveDirections] = useState({ up: false, down: false, left: false, right: false });

  const playerIndex = sessionData?.playerIndex ?? netplayService.myPlayerIndex ?? 1;
  const playerNum = playerIndex + 1;
  const gameTitle = sessionData?.gameTitle || netplayService.currentRoom?.gameTitle || 'Partie Arcade';
  const roomCode = sessionData?.roomCode || netplayService.currentRoom?.code || '';

  // Palette de couleur selon le numéro de joueur
  const colorThemes = [
    { name: 'J1 (Cyan)', accent: 'text-cyan-400', border: 'border-cyan-500', bg: 'bg-cyan-950/40', badge: 'bg-cyan-500 text-black' },
    { name: 'J2 (Rose)', accent: 'text-rose-400', border: 'border-rose-500', bg: 'bg-rose-950/40', badge: 'bg-rose-500 text-white' },
    { name: 'J3 (Jaune)', accent: 'text-amber-400', border: 'border-amber-500', bg: 'bg-amber-950/40', badge: 'bg-amber-400 text-black' },
    { name: 'J4 (Vert)', accent: 'text-emerald-400', border: 'border-emerald-500', bg: 'bg-emerald-950/40', badge: 'bg-emerald-400 text-black' }
  ];
  const theme = colorThemes[playerIndex] || colorThemes[1];

  // Écouter le ping et les déconnexions
  useEffect(() => {
    const unsubs = [
      netplayService.on('ping', p => setPing(p)),
      netplayService.on('host_disconnected', () => {
        alert("L'hôte a fermé la partie.");
        onExit();
      })
    ];
    return () => unsubs.forEach(u => u());
  }, [onExit]);

  // Haptique
  const triggerHaptic = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(14); } catch(e) {}
    }
  }, []);

  const handleInput = useCallback((btnId, isPressed) => {
    netplayService.sendInput(btnId, isPressed);
    setActiveButtons(prev => ({ ...prev, [btnId]: isPressed }));
    if (isPressed) {
      triggerHaptic();
    }
  }, [triggerHaptic]);

  // D-Pad tactile fluide
  const dpadRef = useRef(null);
  const handleDpadTouch = useCallback((clientX, clientY, isEnd = false) => {
    if (isEnd) {
      setActiveDirections({ up: false, down: false, left: false, right: false });
      handleInput(RETROPAD.UP, false);
      handleInput(RETROPAD.DOWN, false);
      handleInput(RETROPAD.LEFT, false);
      handleInput(RETROPAD.RIGHT, false);
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
    handleInput(RETROPAD.UP, up);
    handleInput(RETROPAD.DOWN, down);
    handleInput(RETROPAD.LEFT, left);
    handleInput(RETROPAD.RIGHT, right);
  }, [handleInput]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col justify-between p-3 select-none font-mono touch-none">
      {/* Barre d'état en haut */}
      <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-neutral-900/90 border border-neutral-800 shrink-0">
        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-1 rounded-lg text-xs font-black uppercase ${theme.badge}`}>
            JOUEUR {playerNum}
          </span>
          <div>
            <p className="text-xs font-bold text-white line-clamp-1">{gameTitle}</p>
            <span className="text-[10px] text-neutral-400">Salon : <strong className="text-white">{roomCode}</strong></span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-[10px] text-emerald-400">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            <span>{ping > 0 ? `${ping} ms` : 'LAN'}</span>
          </div>

          <button
            onClick={() => {
              netplayService.leaveRoom();
              onExit();
            }}
            className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
            title="Quitter la partie"
          >
            <LogOut className="w-4 h-4 text-rose-400" />
          </button>
        </div>
      </div>

      {/* Barre L1, COIN, START, R1 */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0">
        <button
          onTouchStart={(e) => { e.preventDefault(); handleInput(RETROPAD.L, true); }}
          onTouchEnd={(e) => { e.preventDefault(); handleInput(RETROPAD.L, false); }}
          className="px-4 py-2 rounded-xl bg-neutral-900 border border-neutral-700 text-xs font-bold text-neutral-300 active:scale-95"
        >
          L1
        </button>

        <div className="flex items-center gap-3">
          <button
            onTouchStart={(e) => { e.preventDefault(); handleInput(RETROPAD.SELECT, true); }}
            onTouchEnd={(e) => { e.preventDefault(); handleInput(RETROPAD.SELECT, false); }}
            className={`px-3.5 py-1.5 rounded-xl border text-xs font-bold uppercase transition-transform ${
              activeButtons[RETROPAD.SELECT] ? 'bg-amber-400 text-black scale-95' : 'bg-neutral-900 text-amber-400 border-neutral-700'
            }`}
          >
            COIN
          </button>

          <button
            onTouchStart={(e) => { e.preventDefault(); handleInput(RETROPAD.START, true); }}
            onTouchEnd={(e) => { e.preventDefault(); handleInput(RETROPAD.START, false); }}
            className={`px-3.5 py-1.5 rounded-xl border text-xs font-bold uppercase transition-transform ${
              activeButtons[RETROPAD.START] ? 'bg-cyan-400 text-black scale-95' : 'bg-neutral-900 text-cyan-300 border-cyan-500/40'
            }`}
          >
            START
          </button>
        </div>

        <button
          onTouchStart={(e) => { e.preventDefault(); handleInput(RETROPAD.R, true); }}
          onTouchEnd={(e) => { e.preventDefault(); handleInput(RETROPAD.R, false); }}
          className="px-4 py-2 rounded-xl bg-neutral-900 border border-neutral-700 text-xs font-bold text-neutral-300 active:scale-95"
        >
          R1
        </button>
      </div>

      {/* Zone Principale : D-Pad (Gauche) et Boutons Arcade (Droite) */}
      <div className="flex-1 flex items-center justify-between px-4 py-2">
        {/* D-Pad tactile */}
        <div
          ref={dpadRef}
          className="w-44 h-44 rounded-full flex items-center justify-center border-2 border-neutral-700 bg-neutral-950/90 shadow-2xl relative"
          onTouchStart={(e) => {
            e.preventDefault();
            handleDpadTouch(e.touches[0].clientX, e.touches[0].clientY);
          }}
          onTouchMove={(e) => handleDpadTouch(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchEnd={() => handleDpadTouch(0, 0, true)}
          onTouchCancel={() => handleDpadTouch(0, 0, true)}
        >
          <div className="relative w-36 h-36 flex items-center justify-center">
            <div className={`absolute top-0 w-11 h-11 rounded-t-xl flex items-center justify-center font-bold text-sm border ${
              activeDirections.up ? 'bg-cyan-500 text-black border-cyan-400 scale-95' : 'bg-neutral-800 text-neutral-300 border-neutral-700'
            }`}>▲</div>
            <div className={`absolute bottom-0 w-11 h-11 rounded-b-xl flex items-center justify-center font-bold text-sm border ${
              activeDirections.down ? 'bg-cyan-500 text-black border-cyan-400 scale-95' : 'bg-neutral-800 text-neutral-300 border-neutral-700'
            }`}>▼</div>
            <div className={`absolute left-0 w-11 h-11 rounded-l-xl flex items-center justify-center font-bold text-sm border ${
              activeDirections.left ? 'bg-cyan-500 text-black border-cyan-400 scale-95' : 'bg-neutral-800 text-neutral-300 border-neutral-700'
            }`}>◀</div>
            <div className={`absolute right-0 w-11 h-11 rounded-r-xl flex items-center justify-center font-bold text-sm border ${
              activeDirections.right ? 'bg-cyan-500 text-black border-cyan-400 scale-95' : 'bg-neutral-800 text-neutral-300 border-neutral-700'
            }`}>▶</div>
            <div className="w-8 h-8 rounded-full bg-neutral-900 border border-neutral-700" />
          </div>
        </div>

        {/* Boutons d'action Arcade (A, B, X, Y) */}
        <div className="relative w-48 h-48 select-none">
          {/* Bouton Y (D) */}
          <button
            onTouchStart={(e) => { e.preventDefault(); handleInput(RETROPAD.X, true); }}
            onTouchEnd={(e) => { e.preventDefault(); handleInput(RETROPAD.X, false); }}
            className={`absolute top-0 left-1/2 -translate-x-1/2 w-16 h-16 rounded-full border-2 border-amber-400 flex flex-col items-center justify-center font-bold shadow-lg transition-transform ${
              activeButtons[RETROPAD.X] ? 'bg-amber-400 text-black scale-95' : 'bg-amber-950/90 text-amber-300 active:scale-95'
            }`}
          >
            <span className="text-base font-black">Y</span>
            <span className="text-[9px] opacity-70">D</span>
          </button>

          {/* Bouton X (C) */}
          <button
            onTouchStart={(e) => { e.preventDefault(); handleInput(RETROPAD.Y, true); }}
            onTouchEnd={(e) => { e.preventDefault(); handleInput(RETROPAD.Y, false); }}
            className={`absolute left-0 top-1/2 -translate-y-1/2 w-16 h-16 rounded-full border-2 border-cyan-400 flex flex-col items-center justify-center font-bold shadow-lg transition-transform ${
              activeButtons[RETROPAD.Y] ? 'bg-cyan-400 text-black scale-95' : 'bg-cyan-950/90 text-cyan-300 active:scale-95'
            }`}
          >
            <span className="text-base font-black">X</span>
            <span className="text-[9px] opacity-70">C</span>
          </button>

          {/* Bouton B (B) */}
          <button
            onTouchStart={(e) => { e.preventDefault(); handleInput(RETROPAD.A, true); }}
            onTouchEnd={(e) => { e.preventDefault(); handleInput(RETROPAD.A, false); }}
            className={`absolute right-0 top-1/2 -translate-y-1/2 w-16 h-16 rounded-full border-2 border-rose-500 flex flex-col items-center justify-center font-bold shadow-lg transition-transform ${
              activeButtons[RETROPAD.A] ? 'bg-rose-500 text-white scale-95' : 'bg-rose-950/90 text-rose-300 active:scale-95'
            }`}
          >
            <span className="text-base font-black">B</span>
            <span className="text-[9px] opacity-70">B</span>
          </button>

          {/* Bouton A (A) */}
          <button
            onTouchStart={(e) => { e.preventDefault(); handleInput(RETROPAD.B, true); }}
            onTouchEnd={(e) => { e.preventDefault(); handleInput(RETROPAD.B, false); }}
            className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-16 rounded-full border-2 border-emerald-400 flex flex-col items-center justify-center font-bold shadow-lg transition-transform ${
              activeButtons[RETROPAD.B] ? 'bg-emerald-400 text-black scale-95' : 'bg-emerald-950/90 text-emerald-300 active:scale-95'
            }`}
          >
            <span className="text-base font-black">A</span>
            <span className="text-[9px] opacity-70">A</span>
          </button>
        </div>
      </div>
    </div>
  );
}
