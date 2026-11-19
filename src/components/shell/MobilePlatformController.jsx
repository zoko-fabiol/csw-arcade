import React, { useRef, useState } from 'react';
import { Hash } from 'lucide-react';

function vibrate(ms = 10) {
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
 */
function PadButton({
  label,
  subLabel,
  className = '',
  activeClass = 'scale-95 brightness-125',
  onPress,
  onRelease,
}) {
  const [pressed, setPressed] = useState(false);

  const down = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!pressed) {
      setPressed(true);
      vibrate(8);
      onPress?.();
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };

  const up = (e) => {
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
      {subLabel && <span className="text-[8px] opacity-70 mt-0.5 leading-none">{subLabel}</span>}
    </button>
  );
}

/**
 * Stick / D-Pad 8 directions fluide (supporte le glissement du pouce en 360° + diagonales).
 */
function TouchDirectionalPad({ styleType = 'cross', accent = 'cyan', onDirectionChange }) {
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

    const angle = Math.atan2(dy, dx) * (180 / Math.PI); // -180..180
    emitDirs({
      right: angle > -67.5 && angle < 67.5,
      down: angle > 22.5 && angle < 157.5,
      left: angle > 112.5 || angle < -112.5,
      up: angle < -22.5 && angle > -157.5,
    });
  };

  const handleDown = (e) => {
    e.preventDefault();
    vibrate(6);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    computeFromPointer(e.clientX, e.clientY);
  };

  const handleMove = (e) => {
    if (!knob.active) return;
    e.preventDefault();
    computeFromPointer(e.clientX, e.clientY);
  };

  const handleUp = (e) => {
    e.preventDefault();
    setKnob({ x: 0, y: 0, active: false });
    emitDirs({ up: false, down: false, left: false, right: false });
  };

  const isArcadeStick = styleType === 'arcade';
  const isSega = styleType === 'sega';
  const ringBorder =
    accent === 'amber'
      ? 'border-amber-500/45'
      : accent === 'blue'
      ? 'border-blue-500/45'
      : accent === 'red'
      ? 'border-red-500/45'
      : 'border-cyan-500/45';

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
      className={`relative w-32 h-32 sm:w-36 sm:h-36 rounded-full bg-neutral-900/75 backdrop-blur-md border-2 ${ringBorder} shadow-2xl flex items-center justify-center`}
    >
      {/* Visuel interne selon la plateforme */}
      {isArcadeStick ? (
        <>
          <div className="w-16 h-16 rounded-full border border-white/10 bg-black/50" />
          <div
            className="absolute w-14 h-14 rounded-full bg-gradient-to-br from-rose-500 via-red-600 to-rose-900 border-2 border-rose-300/70 shadow-lg shadow-red-950/80 transition-transform duration-75"
            style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
          >
            <div className="w-4 h-4 rounded-full bg-white/35 ml-2.5 mt-2 blur-[1px]" />
          </div>
        </>
      ) : isSega ? (
        <>
          <div className="w-24 h-24 rounded-full bg-gradient-to-b from-neutral-800 to-neutral-950 border border-neutral-700 shadow-inner flex items-center justify-center">
            <div className="w-20 h-6 rounded-full bg-neutral-700/70 absolute" />
            <div className="h-20 w-6 rounded-full bg-neutral-700/70 absolute" />
            <div
              className="w-8 h-8 rounded-full bg-sky-500/30 border border-sky-400/70 transition-transform duration-75"
              style={{ transform: `translate(${knob.x * 0.45}px, ${knob.y * 0.45}px)` }}
            />
          </div>
        </>
      ) : (
        <>
          {/* Croix D-Pad Nintendo / PlayStation / Mobile */}
          <div className="w-24 h-8 rounded-lg bg-neutral-800 border border-neutral-600/80 absolute shadow-inner" />
          <div className="h-24 w-8 rounded-lg bg-neutral-800 border border-neutral-600/80 absolute shadow-inner" />
          <span className="absolute top-2.5 text-[10px] text-neutral-400 font-black pointer-events-none">▲</span>
          <span className="absolute bottom-2.5 text-[10px] text-neutral-400 font-black pointer-events-none">▼</span>
          <span className="absolute left-2.5 text-[10px] text-neutral-400 font-black pointer-events-none">◄</span>
          <span className="absolute right-2.5 text-[10px] text-neutral-400 font-black pointer-events-none">►</span>
          <div
            className={`w-7 h-7 rounded-full border transition-transform duration-75 ${
              knob.active ? 'bg-cyan-400/35 border-cyan-300' : 'bg-neutral-900/90 border-neutral-700'
            }`}
            style={{ transform: `translate(${knob.x * 0.35}px, ${knob.y * 0.35}px)` }}
          />
        </>
      )}
    </div>
  );
}

/**
 * Contrôleur Tactile Mobile Multi-Plateformes :
 * Adapte son design, sa disposition et ses touches au système joué :
 * - Arcade / Neo Geo (Joystick + A/B/C/D 4 couleurs)
 * - PlayStation DualShock (L1/L2/R1/R2 + △/○/✕/□)
 * - Nintendo SNES/N64/GBA/NES (Croix + L/R + A/B/X/Y)
 * - Sega Mega Drive 6 boutons (Pad circulaire + X/Y/Z + A/B/C)
 * - Mobile Java / Gameloft J2ME (D-Pad + OK/Softkeys + Pavé 1-9 escamotable)
 */
export function MobilePlatformController({
  kind = 'emu',
  core = 'fbneo',
  onEmuButton,
  onJ2meKey,
  onSyncCredits,
}) {
  const [j2meNumpadOpen, setJ2meNumpadOpen] = useState(false);

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

  const emitDir = (dir, pressed) => {
    if (profile === 'j2me') {
      const map = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
      onJ2meKey?.(map[dir], pressed);
    } else {
      const idxMap = { up: 4, down: 5, left: 6, right: 7 };
      onEmuButton?.(idxMap[dir], pressed);
    }
  };

  const bindEmu = (idx) => ({
    onPress: () => onEmuButton?.(idx, true),
    onRelease: () => onEmuButton?.(idx, false),
  });

  const bindJ2me = (code) => ({
    onPress: () => onJ2meKey?.(code, true),
    onRelease: () => onJ2meKey?.(code, false),
  });

  const accent =
    profile === 'j2me'
      ? 'amber'
      : profile === 'playstation' || profile === 'sega'
      ? 'blue'
      : profile === 'nintendo'
      ? 'red'
      : 'cyan';

  return (
    <div
      className="w-full shrink-0 bg-gradient-to-t from-neutral-950 via-neutral-950/95 to-neutral-900/90 border-t border-white/10 px-3 py-2.5 pb-safe select-none"
      style={{ touchAction: 'none' }}
    >
      {/* Rangée Gâchettes (L / R / L2 / R2) ou Softkeys J2ME */}
      {profile === 'playstation' && (
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex gap-1.5">
            <PadButton
              label="L2"
              {...bindEmu(12)}
              className="w-14 h-8 rounded-lg bg-neutral-800 border border-blue-500/40 text-blue-200 text-xs font-black"
            />
            <PadButton
              label="L1"
              {...bindEmu(10)}
              className="w-16 h-8 rounded-lg bg-neutral-800 border border-blue-400/60 text-white text-xs font-black"
            />
          </div>
          <div className="flex gap-1.5">
            <PadButton
              label="SELECT"
              {...bindEmu(2)}
              className="px-2.5 h-7 rounded-full bg-neutral-800 border border-neutral-600 text-[9px] font-mono font-bold text-neutral-300"
            />
            <PadButton
              label="START"
              {...bindEmu(3)}
              className="px-2.5 h-7 rounded-full bg-neutral-800 border border-neutral-600 text-[9px] font-mono font-bold text-neutral-300"
            />
          </div>
          <div className="flex gap-1.5">
            <PadButton
              label="R1"
              {...bindEmu(11)}
              className="w-16 h-8 rounded-lg bg-neutral-800 border border-blue-400/60 text-white text-xs font-black"
            />
            <PadButton
              label="R2"
              {...bindEmu(13)}
              className="w-14 h-8 rounded-lg bg-neutral-800 border border-blue-500/40 text-blue-200 text-xs font-black"
            />
          </div>
        </div>
      )}

      {profile === 'nintendo' && (
        <div className="flex items-center justify-between gap-2 mb-2">
          {['snes', 'n64', 'gba', 'nds'].includes(lowerCore) ? (
            <PadButton
              label="L"
              {...bindEmu(10)}
              className="w-20 h-8 rounded-xl bg-neutral-800 border border-red-500/40 text-red-200 text-xs font-black"
            />
          ) : (
            <div className="w-12" />
          )}
          <div className="flex gap-2">
            <PadButton
              label="SELECT"
              {...bindEmu(2)}
              className="px-3 h-7 rounded-full bg-neutral-800 border border-neutral-600 text-[9px] font-mono font-bold text-neutral-300"
            />
            <PadButton
              label="START"
              {...bindEmu(3)}
              className="px-3 h-7 rounded-full bg-neutral-800 border border-neutral-600 text-[9px] font-mono font-bold text-neutral-300"
            />
          </div>
          {['snes', 'n64', 'gba', 'nds'].includes(lowerCore) ? (
            <PadButton
              label="R"
              {...bindEmu(11)}
              className="w-20 h-8 rounded-xl bg-neutral-800 border border-red-500/40 text-red-200 text-xs font-black"
            />
          ) : (
            <div className="w-12" />
          )}
        </div>
      )}

      {profile === 'arcade' && (
        <div className="flex items-center justify-center gap-3 mb-2">
          <button
            type="button"
            onClick={() => {
              vibrate(12);
              onSyncCredits?.();
            }}
            className="px-3.5 h-7 rounded-full bg-amber-500/20 border border-amber-500/60 text-amber-300 text-[10px] font-mono font-black active:scale-95"
          >
            SYNC CRÉDITS (5)
          </button>
          <PadButton
            label="START (1)"
            {...bindEmu(3)}
            className="px-4 h-7 rounded-full bg-emerald-500/25 border border-emerald-400/60 text-emerald-200 text-[10px] font-mono font-black"
          />
        </div>
      )}

      {profile === 'sega' && (
        <div className="flex items-center justify-center gap-3 mb-2">
          <PadButton
            label="MODE"
            {...bindEmu(2)}
            className="px-3.5 h-7 rounded-full bg-neutral-800 border border-sky-500/40 text-sky-300 text-[10px] font-mono font-bold"
          />
          <PadButton
            label="START"
            {...bindEmu(3)}
            className="px-4 h-7 rounded-full bg-sky-500/20 border border-sky-400/60 text-sky-200 text-[10px] font-mono font-black"
          />
        </div>
      )}

      {profile === 'j2me' && (
        <div className="flex items-center justify-between gap-1.5 mb-2">
          <PadButton
            label="SOFT G"
            subLabel="Menu"
            {...bindJ2me('KeyQ')}
            className="flex-1 h-8 rounded-lg bg-blue-950/70 border border-blue-500/50 text-blue-200 text-[10px] font-black"
          />
          <PadButton
            label="RETOUR"
            subLabel="C"
            {...bindJ2me('KeyE')}
            className="w-16 h-8 rounded-lg bg-neutral-800 border border-neutral-600 text-neutral-200 text-[10px] font-black"
          />
          <button
            type="button"
            onClick={() => setJ2meNumpadOpen((v) => !v)}
            className={`px-2.5 h-8 rounded-lg border text-[10px] font-black flex items-center gap-1 ${
              j2meNumpadOpen
                ? 'bg-amber-500 text-black border-amber-300'
                : 'bg-neutral-800 text-amber-300 border-amber-500/40'
            }`}
          >
            <Hash className="w-3 h-3" />
            <span>123</span>
          </button>
          <PadButton
            label="SOFT D"
            subLabel="Retour"
            {...bindJ2me('KeyW')}
            className="flex-1 h-8 rounded-lg bg-blue-950/70 border border-blue-500/50 text-blue-200 text-[10px] font-black"
          />
        </div>
      )}

      {/* Pavé numérique 1-9 escamotable pour les jeux Java / Gameloft */}
      {profile === 'j2me' && j2meNumpadOpen && (
        <div className="grid grid-cols-6 gap-1.5 mb-2 p-2 rounded-xl bg-neutral-900 border border-amber-500/35">
          {[
            ['1', 'Digit1'], ['2', 'Digit2'], ['3', 'Digit3'], ['4', 'Digit4'], ['5', 'Digit5'], ['6', 'Digit6'],
            ['7', 'Digit7'], ['8', 'Digit8'], ['9', 'Digit9'], ['*', 'KeyR'], ['0', 'Digit0'], ['#', 'KeyT'],
          ].map(([lbl, code]) => (
            <PadButton
              key={code}
              label={lbl}
              {...bindJ2me(code)}
              className="h-9 rounded-lg bg-neutral-800 border border-neutral-700 text-white text-xs font-black"
            />
          ))}
        </div>
      )}

      {/* Corps Principal du Contrôleur : Direction à gauche + Boutons d'action à droite */}
      <div className="flex items-center justify-between gap-2 max-w-xl mx-auto">
        <TouchDirectionalPad
          styleType={profile === 'arcade' ? 'arcade' : profile === 'sega' ? 'sega' : 'cross'}
          accent={accent}
          onDirectionChange={emitDir}
        />

        {/* ARCADE / NEO GEO MVS (4 boutons en arc) */}
        {profile === 'arcade' && (
          <div className="grid grid-cols-2 gap-2.5 pr-1">
            <PadButton
              label="A"
              subLabel="Poing"
              {...bindEmu(0)}
              className="w-14 h-14 rounded-full bg-gradient-to-b from-red-500 to-red-700 border-2 border-red-300/80 text-white font-black text-base shadow-lg shadow-red-950/80"
            />
            <PadButton
              label="B"
              subLabel="Pied"
              {...bindEmu(8)}
              className="w-14 h-14 rounded-full bg-gradient-to-b from-amber-400 to-amber-600 border-2 border-amber-200/80 text-black font-black text-base shadow-lg shadow-amber-950/80 -mt-2"
            />
            <PadButton
              label="C"
              subLabel="Fort"
              {...bindEmu(1)}
              className="w-14 h-14 rounded-full bg-gradient-to-b from-emerald-500 to-emerald-700 border-2 border-emerald-300/80 text-white font-black text-base shadow-lg shadow-emerald-950/80"
            />
            <PadButton
              label="D"
              subLabel="Spécial"
              {...bindEmu(9)}
              className="w-14 h-14 rounded-full bg-gradient-to-b from-sky-500 to-blue-700 border-2 border-sky-300/80 text-white font-black text-base shadow-lg shadow-blue-950/80 -mt-2"
            />
          </div>
        )}

        {/* PLAYSTATION DUALSHOCK (Losange △ ○ ✕ □) */}
        {profile === 'playstation' && (
          <div className="relative w-36 h-36 shrink-0">
            <PadButton
              label="△"
              {...bindEmu(9)}
              className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full bg-neutral-900 border-2 border-emerald-400 text-emerald-400 font-black text-lg shadow-lg"
            />
            <PadButton
              label="□"
              {...bindEmu(1)}
              className="absolute left-0 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-neutral-900 border-2 border-fuchsia-400 text-fuchsia-400 font-black text-lg shadow-lg"
            />
            <PadButton
              label="○"
              {...bindEmu(8)}
              className="absolute right-0 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-neutral-900 border-2 border-rose-400 text-rose-400 font-black text-lg shadow-lg"
            />
            <PadButton
              label="✕"
              {...bindEmu(0)}
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full bg-neutral-900 border-2 border-sky-400 text-sky-400 font-black text-lg shadow-lg"
            />
          </div>
        )}

        {/* NINTENDO (SNES / N64 4 couleurs ou NES / GBA 2 boutons) */}
        {profile === 'nintendo' && (
          ['nes', 'gb', 'gbc', 'gba'].includes(lowerCore) ? (
            <div className="flex items-center gap-3 pr-1">
              <PadButton
                label="B"
                {...bindEmu(0)}
                className="w-16 h-16 rounded-full bg-gradient-to-b from-rose-500 to-red-700 border-2 border-rose-300 text-white font-black text-lg shadow-lg mt-4"
              />
              <PadButton
                label="A"
                {...bindEmu(8)}
                className="w-16 h-16 rounded-full bg-gradient-to-b from-rose-500 to-red-700 border-2 border-rose-300 text-white font-black text-lg shadow-lg -mt-4"
              />
            </div>
          ) : (
            <div className="relative w-36 h-36 shrink-0">
              <PadButton
                label="X"
                {...bindEmu(9)}
                className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full bg-gradient-to-b from-blue-500 to-blue-700 border-2 border-blue-300 text-white font-black text-sm shadow-lg"
              />
              <PadButton
                label="Y"
                {...bindEmu(1)}
                className="absolute left-0 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-gradient-to-b from-emerald-500 to-emerald-700 border-2 border-emerald-300 text-white font-black text-sm shadow-lg"
              />
              <PadButton
                label="A"
                {...bindEmu(8)}
                className="absolute right-0 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-gradient-to-b from-red-500 to-red-700 border-2 border-red-300 text-white font-black text-sm shadow-lg"
              />
              <PadButton
                label="B"
                {...bindEmu(0)}
                className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full bg-gradient-to-b from-amber-400 to-amber-600 border-2 border-amber-200 text-black font-black text-sm shadow-lg"
              />
            </div>
          )
        )}

        {/* SEGA MEGA DRIVE 6 BOUTONS */}
        {profile === 'sega' && (
          <div className="flex flex-col gap-2 pr-1">
            <div className="flex gap-2 justify-end">
              <PadButton
                label="X"
                {...bindEmu(9)}
                className="w-11 h-11 rounded-full bg-neutral-800 border-2 border-sky-400/50 text-sky-200 font-black text-xs shadow"
              />
              <PadButton
                label="Y"
                {...bindEmu(10)}
                className="w-11 h-11 rounded-full bg-neutral-800 border-2 border-sky-400/50 text-sky-200 font-black text-xs shadow -mt-1.5"
              />
              <PadButton
                label="Z"
                {...bindEmu(11)}
                className="w-11 h-11 rounded-full bg-neutral-800 border-2 border-sky-400/50 text-sky-200 font-black text-xs shadow"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <PadButton
                label="A"
                {...bindEmu(1)}
                className="w-12 h-12 rounded-full bg-gradient-to-b from-sky-600 to-blue-800 border-2 border-sky-300 text-white font-black text-sm shadow-lg"
              />
              <PadButton
                label="B"
                {...bindEmu(0)}
                className="w-12 h-12 rounded-full bg-gradient-to-b from-sky-600 to-blue-800 border-2 border-sky-300 text-white font-black text-sm shadow-lg -mt-1.5"
              />
              <PadButton
                label="C"
                {...bindEmu(8)}
                className="w-12 h-12 rounded-full bg-gradient-to-b from-sky-600 to-blue-800 border-2 border-sky-300 text-white font-black text-sm shadow-lg"
              />
            </div>
          </div>
        )}

        {/* MOBILE / GAMELOFT J2ME ACTION CLUSTER */}
        {profile === 'j2me' && (
          <div className="relative w-36 h-36 shrink-0">
            <PadButton
              label="5"
              subLabel="Action"
              {...bindJ2me('Digit5')}
              className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full bg-neutral-800 border-2 border-amber-400/70 text-amber-300 font-black text-xs shadow-lg"
            />
            <PadButton
              label="0"
              subLabel="Spécial"
              {...bindJ2me('Digit0')}
              className="absolute left-0 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-neutral-800 border-2 border-neutral-500 text-neutral-200 font-black text-xs shadow-lg"
            />
            <PadButton
              label="#"
              subLabel="Alt"
              {...bindJ2me('KeyT')}
              className="absolute right-0 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-neutral-800 border-2 border-neutral-500 text-neutral-200 font-black text-xs shadow-lg"
            />
            <PadButton
              label="OK"
              subLabel="Entrée"
              {...bindJ2me('Enter')}
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-gradient-to-b from-amber-400 to-amber-600 border-2 border-amber-200 text-black font-black text-sm shadow-lg shadow-amber-950/70"
            />
          </div>
        )}
      </div>
    </div>
  );
}
