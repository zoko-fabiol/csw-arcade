import React, { useState, useEffect, useRef } from 'react';
import { Gamepad, Sparkles, Activity, ArrowLeftRight, ChevronLeft, ChevronRight, Compass, RotateCcw } from 'lucide-react';

export const CONTROLLER_TYPES = {
  XBOX: 'xbox',
  PLAYSTATION: 'playstation',
  SWITCH: 'switch'
};

const NEO_GEO_ACTIONS = [
  { id: 'a', label: 'Neo Geo A (Poing Faible)', badge: 'A', color: 'emerald' },
  { id: 'b', label: 'Neo Geo B (Pied Faible)', badge: 'B', color: 'rose' },
  { id: 'c', label: 'Neo Geo C (Poing Fort)', badge: 'C', color: 'cyan' },
  { id: 'd', label: 'Neo Geo D (Pied Fort)', badge: 'D', color: 'amber' },
  { id: 'coin', label: 'COIN (Insérer Crédit)', badge: 'COIN', color: 'yellow' },
  { id: 'start', label: 'START (Lancer Partie)', badge: 'START', color: 'purple' }
];

export function GamepadVisualizer({ settings, onUpdateGamepadSetting }) {
  const [selectedType, setSelectedType] = useState(() => {
    return settings?.gamepad?.controllerType || 'auto';
  });
  const [connectedPads, setConnectedPads] = useState([]);
  const [activePhysicalButtons, setActivePhysicalButtons] = useState(new Set());
  const [activeAxes, setActiveAxes] = useState({ x: 0, y: 0 });
  const [configuringKey, setConfiguringKey] = useState(null); // Index physique en cours d'assignation

  const p1Index = settings?.gamepad?.p1Index ?? 0;
  const p2Index = settings?.gamepad?.p2Index ?? 1;
  const dpadMode = settings?.gamepad?.dpadMode || 'both';

  const customButtons = settings?.gamepad?.buttons || {
    a: 0,
    b: 1,
    c: 2,
    d: 3,
    coin: 8,
    start: 9
  };

  // Détection des manettes branchées et identification du profil
  useEffect(() => {
    const scanConnectedGamepads = () => {
      if (!navigator.getGamepads) return;
      const gamepads = Array.from(navigator.getGamepads()).filter(gp => gp && gp.connected);
      setConnectedPads(gamepads);

      // Si sélection en mode 'auto', déduire le modèle depuis la première manette
      if (selectedType === 'auto' || !selectedType) {
        const primary = gamepads[0];
        if (primary) {
          const lower = primary.id.toLowerCase();
          if (lower.includes('dualsense') || lower.includes('dualshock') || lower.includes('sony') || lower.includes('playstation') || lower.includes('054c')) {
            setSelectedType(CONTROLLER_TYPES.PLAYSTATION);
          } else if (lower.includes('switch') || lower.includes('nintendo') || lower.includes('joy-con') || lower.includes('057e')) {
            setSelectedType(CONTROLLER_TYPES.SWITCH);
          } else {
            setSelectedType(CONTROLLER_TYPES.XBOX);
          }
        }
      }
    };

    scanConnectedGamepads();
    window.addEventListener('gamepadconnected', scanConnectedGamepads);
    window.addEventListener('gamepaddisconnected', scanConnectedGamepads);

    const interval = setInterval(scanConnectedGamepads, 1000);

    return () => {
      window.removeEventListener('gamepadconnected', scanConnectedGamepads);
      window.removeEventListener('gamepaddisconnected', scanConnectedGamepads);
      clearInterval(interval);
    };
  }, [selectedType]);

  // Polling 60 Hz pour feedback visuel instantané des touches pressées
  useEffect(() => {
    let animId;
    const pollLoop = () => {
      if (navigator.getGamepads) {
        const gamepads = navigator.getGamepads();
        // Écoute de la manette assignée à P1
        const gp = gamepads[p1Index] || gamepads[0];
        if (gp && gp.connected) {
          const pressed = new Set();
          gp.buttons.forEach((btn, idx) => {
            if (btn.pressed || btn.value > 0.3) pressed.add(idx);
          });
          setActivePhysicalButtons(pressed);

          if (gp.axes && gp.axes.length >= 2) {
            setActiveAxes({ x: gp.axes[0], y: gp.axes[1] });
          }
        } else {
          setActivePhysicalButtons(new Set());
          setActiveAxes({ x: 0, y: 0 });
        }
      }
      animId = requestAnimationFrame(pollLoop);
    };
    animId = requestAnimationFrame(pollLoop);
    return () => cancelAnimationFrame(animId);
  }, [p1Index]);

  // Trouver l'action assignée à un index physique (0, 1, 2, 3, 8, 9...)
  const getAssignedAction = (physicalIndex) => {
    for (const [action, pIdx] of Object.entries(customButtons)) {
      if (pIdx === physicalIndex) {
        return NEO_GEO_ACTIONS.find(a => a.id === action);
      }
    }
    return null;
  };

  const assignAction = (actionId, physicalIndex) => {
    const updated = { ...customButtons, [actionId]: physicalIndex };
    onUpdateGamepadSetting('buttons', updated);
    setConfiguringKey(null);
  };

  const resetMappings = () => {
    onUpdateGamepadSetting('buttons', { a: 0, b: 1, c: 2, d: 3, coin: 8, start: 9 });
  };

  const swapPlayers = () => {
    onUpdateGamepadSetting('p1Index', p2Index);
    onUpdateGamepadSetting('p2Index', p1Index);
  };

  const cycleP1 = (delta) => {
    const max = Math.max(4, connectedPads.length);
    const next = (p1Index + delta + max) % max;
    onUpdateGamepadSetting('p1Index', next);
  };

  const cycleP2 = (delta) => {
    const max = Math.max(4, connectedPads.length);
    const next = (p2Index + delta + max) % max;
    onUpdateGamepadSetting('p2Index', next);
  };

  const activeProfileType = (selectedType === 'auto' || !selectedType) 
    ? CONTROLLER_TYPES.XBOX 
    : selectedType;

  return (
    <div className="flex flex-col gap-5 text-mono select-none">
      
      {/* 1. BARRE SUPÉRIEURE : SÉLECTION DU MODÈLE ET STATUT MANETTE */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-neutral-950/90 border border-neutral-800 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Gamepad className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                Modèle Visuel :
              </span>
              {connectedPads.length > 0 ? (
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/80 border border-emerald-500/40 text-emerald-400">
                  <Activity className="w-3 h-3 animate-pulse" />
                  {connectedPads.length} MANETTE{connectedPads.length > 1 ? 'S' : ''} DÉTECTÉE{connectedPads.length > 1 ? 'S' : ''}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-neutral-800 text-neutral-400 border border-neutral-700">
                  AUCUNE MANETTE DÉTECTÉE
                </span>
              )}
            </div>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              {connectedPads[p1Index] ? connectedPads[p1Index].id : 'Branchez une manette USB ou Bluetooth (XInput / DirectInput)'}
            </p>
          </div>
        </div>

        {/* Sélecteur Xbox / PlayStation / Switch */}
        <div className="flex items-center gap-1.5 bg-neutral-900/90 p-1 rounded-xl border border-neutral-800">
          {[
            { id: CONTROLLER_TYPES.XBOX, label: 'Xbox Series / One' },
            { id: CONTROLLER_TYPES.PLAYSTATION, label: 'PS5 DualSense' },
            { id: CONTROLLER_TYPES.SWITCH, label: 'Switch Pro' }
          ].map(t => (
            <button
              key={t.id}
              onClick={() => {
                setSelectedType(t.id);
                onUpdateGamepadSetting('controllerType', t.id);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeProfileType === t.id
                  ? 'bg-cyan-500 text-black shadow-md'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 2. ATTRIBUTION MANETTES (P1 / P2) & MODE DE DIRECTION */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Attribution P1 / P2 */}
        <div className="p-3.5 rounded-xl bg-neutral-950/80 border border-neutral-800 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
              <Gamepad className="w-3.5 h-3.5 text-cyan-400" />
              Attribution des Joueurs
            </span>
            <button
              onClick={swapPlayers}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-neutral-900 border border-neutral-700 hover:border-cyan-400 text-neutral-300 hover:text-white transition-all"
              title="Inverser les manettes des joueurs 1 et 2"
            >
              <ArrowLeftRight className="w-3 h-3 text-cyan-400" />
              Inverser P1 / P2
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* Joueur 1 */}
            <div className="p-2 rounded-lg bg-neutral-900/90 border border-cyan-500/30 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-cyan-400">JOUEUR 1</span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                  Index #{p1Index}
                </span>
              </div>
              <div className="flex items-center justify-between gap-1 mt-1">
                <button
                  onClick={() => cycleP1(-1)}
                  className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-bold truncate text-white max-w-[100px]" title={connectedPads[p1Index]?.id || `Manette #${p1Index}`}>
                  {connectedPads[p1Index] ? `Pad #${p1Index}` : `Port #${p1Index}`}
                </span>
                <button
                  onClick={() => cycleP1(1)}
                  className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Joueur 2 */}
            <div className="p-2 rounded-lg bg-neutral-900/90 border border-rose-500/30 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-rose-400">JOUEUR 2</span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-800">
                  Index #{p2Index}
                </span>
              </div>
              <div className="flex items-center justify-between gap-1 mt-1">
                <button
                  onClick={() => cycleP2(-1)}
                  className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-bold truncate text-white max-w-[100px]" title={connectedPads[p2Index]?.id || `Manette #${p2Index}`}>
                  {connectedPads[p2Index] ? `Pad #${p2Index}` : `Port #${p2Index}`}
                </span>
                <button
                  onClick={() => cycleP2(1)}
                  className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Choix Commande Direction (D-Pad vs Analogique) */}
        <div className="p-3.5 rounded-xl bg-neutral-950/80 border border-neutral-800 flex flex-col justify-between gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-cyan-400" />
              Direction Neo Geo
            </span>
            <span className="text-[10px] text-neutral-400">
              {dpadMode === 'both' ? 'D-Pad + Stick' : dpadMode === 'dpad' ? 'D-Pad seul' : 'Stick seul'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {[
              { id: 'both', label: 'D-Pad + Stick', sub: 'Simultanés' },
              { id: 'dpad', label: 'D-Pad Seul', sub: 'Croix classique' },
              { id: 'analog', label: 'Stick Seul', sub: 'Analogique L' }
            ].map(m => (
              <button
                key={m.id}
                onClick={() => onUpdateGamepadSetting('dpadMode', m.id)}
                className={`py-2 px-1 rounded-lg border text-center transition-all ${
                  dpadMode === m.id
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-sm'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-700'
                }`}
              >
                <div className="text-[10px] font-black">{m.label}</div>
                <div className="text-[8px] opacity-70 mt-0.5">{m.sub}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3. VISUEL RÉALISTE DE LA MANETTE AVEC RENDU VECTORIEL HAUTE FIDÉLITÉ */}
      <div className="relative w-full rounded-2xl bg-gradient-to-b from-[#090b10] to-[#040507] border border-neutral-800/80 p-6 flex flex-col items-center justify-center min-h-[360px] overflow-hidden shadow-2xl">
        
        {/* Lueur d'ambiance selon le profil */}
        <div 
          className="absolute inset-0 opacity-20 pointer-events-none blur-3xl transition-all duration-700"
          style={{
            background: activeProfileType === CONTROLLER_TYPES.XBOX
              ? 'radial-gradient(circle at 50% 40%, #10b981, transparent 70%)'
              : activeProfileType === CONTROLLER_TYPES.PLAYSTATION
              ? 'radial-gradient(circle at 50% 40%, #3b82f6, transparent 70%)'
              : 'radial-gradient(circle at 50% 40%, #ef4444, transparent 70%)'
          }}
        />

        {/* CONTROLLER MODEL SELECTIVE RENDERING */}
        {activeProfileType === CONTROLLER_TYPES.XBOX && (
          <RealisticXboxController
            activeButtons={activePhysicalButtons}
            activeAxes={activeAxes}
            customButtons={customButtons}
            getAssignedAction={getAssignedAction}
            configuringKey={configuringKey}
            onSelectKey={(k) => setConfiguringKey(configuringKey === k ? null : k)}
          />
        )}

        {activeProfileType === CONTROLLER_TYPES.PLAYSTATION && (
          <RealisticDualSenseController
            activeButtons={activePhysicalButtons}
            activeAxes={activeAxes}
            customButtons={customButtons}
            getAssignedAction={getAssignedAction}
            configuringKey={configuringKey}
            onSelectKey={(k) => setConfiguringKey(configuringKey === k ? null : k)}
          />
        )}

        {activeProfileType === CONTROLLER_TYPES.SWITCH && (
          <RealisticSwitchProController
            activeButtons={activePhysicalButtons}
            activeAxes={activeAxes}
            customButtons={customButtons}
            getAssignedAction={getAssignedAction}
            configuringKey={configuringKey}
            onSelectKey={(k) => setConfiguringKey(configuringKey === k ? null : k)}
          />
        )}

        {/* Légende interactive sous la manette */}
        <div className="w-full flex items-center justify-between text-[11px] text-neutral-400 mt-4 pt-3 border-t border-neutral-800/60">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            Cliquez sur un bouton (A, B, X, Y, Coin, Start) pour modifier son attribution Neo Geo
          </span>
          <button
            onClick={resetMappings}
            className="flex items-center gap-1 text-[10px] font-bold text-neutral-400 hover:text-white px-2 py-1 rounded bg-neutral-900 border border-neutral-700 hover:border-neutral-500 transition-all"
          >
            <RotateCcw className="w-3 h-3" />
            Réinitialiser mapping standard
          </button>
        </div>
      </div>

      {/* 4. MODALE CONTEXTUELLE D'ASSIGNATION RAPIDE */}
      {configuringKey !== null && (
        <div className="p-4 rounded-xl bg-neutral-900/95 border border-amber-500/50 shadow-2xl flex flex-col gap-3 animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
            <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Assigner une action Neo Geo au bouton physique #{configuringKey} :
            </span>
            <button
              onClick={() => setConfiguringKey(null)}
              className="text-neutral-400 hover:text-white text-xs font-bold px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700"
            >
              Fermer
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {NEO_GEO_ACTIONS.map(act => (
              <button
                key={act.id}
                onClick={() => assignAction(act.id, configuringKey)}
                className={`p-2.5 rounded-lg border text-left text-xs font-bold transition-all flex items-center justify-between ${
                  customButtons[act.id] === configuringKey
                    ? 'bg-amber-500 text-black border-amber-400 shadow-md font-black'
                    : 'bg-neutral-950 hover:bg-neutral-800 text-neutral-200 border-neutral-800 hover:border-neutral-700'
                }`}
              >
                <span>{act.label}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/40 text-cyan-300">
                  [{act.badge}]
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   1. MANETTE XBOX SERIES X / ONE RÉALISTE (SILHOUETTE AUTHENTIQUE VECTORIELLE)
   ========================================================================= */
function RealisticXboxController({ activeButtons, activeAxes, customButtons, getAssignedAction, configuringKey, onSelectKey }) {
  const isUp = activeButtons.has(12);
  const isDown = activeButtons.has(13);
  const isLeft = activeButtons.has(14);
  const isRight = activeButtons.has(15);

  const isA = activeButtons.has(0);
  const isB = activeButtons.has(1);
  const isX = activeButtons.has(2);
  const isY = activeButtons.has(3);

  const isLb = activeButtons.has(4);
  const isRb = activeButtons.has(5);
  const isLt = activeButtons.has(6);
  const isRt = activeButtons.has(7);

  const isView = activeButtons.has(8);
  const isMenu = activeButtons.has(9);

  return (
    <div className="relative w-full max-w-[540px] aspect-[1.6/1] flex items-center justify-center select-none">
      <svg viewBox="0 0 540 340" className="w-full h-full drop-shadow-2xl">
        <defs>
          {/* Dégradé de la coque Xbox */}
          <linearGradient id="xboxBodyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#2a2c32" />
            <stop offset="35%" stopColor="#1e2025" />
            <stop offset="70%" stopColor="#141518" />
            <stop offset="100%" stopColor="#0c0d0f" />
          </linearGradient>

          {/* Dégradé des poignées galbées */}
          <linearGradient id="xboxGripLeft" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#151619" />
            <stop offset="100%" stopColor="#090a0c" />
          </linearGradient>
          <linearGradient id="xboxGripRight" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#151619" />
            <stop offset="100%" stopColor="#090a0c" />
          </linearGradient>

          {/* Dégradé sticks concaves */}
          <radialGradient id="stickConcave" cx="45%" cy="40%" r="55%">
            <stop offset="0%" stopColor="#2d3036" />
            <stop offset="60%" stopColor="#1b1c20" />
            <stop offset="100%" stopColor="#0a0a0c" />
          </radialGradient>

          {/* D-Pad Métallique facetté Xbox Series */}
          <radialGradient id="dpadDish" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#32353b" />
            <stop offset="70%" stopColor="#1c1e22" />
            <stop offset="100%" stopColor="#0f1012" />
          </radialGradient>

          {/* Halo vert Xbox */}
          <filter id="xboxGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* 1. GÂCHETTES LT / RT (ARRIÈRE-PLAN) */}
        <path
          d="M 120 40 C 130 18, 170 12, 195 18 L 195 38 C 170 34, 130 38, 120 40 Z"
          fill={isLt ? '#10b981' : '#17181c'}
          stroke="#383b44"
          strokeWidth="1.5"
        />
        <path
          d="M 420 40 C 410 18, 370 12, 345 18 L 345 38 C 370 34, 410 38, 420 40 Z"
          fill={isRt ? '#10b981' : '#17181c'}
          stroke="#383b44"
          strokeWidth="1.5"
        />

        {/* 2. BUMPERS LB / RB */}
        <path
          d="M 108 48 C 130 32, 190 28, 220 32 L 220 54 C 180 50, 130 52, 108 48 Z"
          fill={isLb ? '#10b981' : '#22252b'}
          stroke="#3d414a"
          strokeWidth="1.5"
        />
        <path
          d="M 432 48 C 410 32, 350 28, 320 32 L 320 54 C 360 50, 410 52, 432 48 Z"
          fill={isRb ? '#10b981' : '#22252b'}
          stroke="#3d414a"
          strokeWidth="1.5"
        />

        {/* 3. COQUE PRINCIPALE ERGONOMIQUE XBOX (VRAIE FORME AVEC POIGNÉES ÉVASÉES) */}
        <path
          d="M 105 52 
             C 170 42, 370 42, 435 52 
             C 475 60, 505 130, 492 245 
             C 485 305, 435 328, 395 315 
             C 360 302, 335 240, 315 220 
             C 290 205, 250 205, 225 220 
             C 205 240, 180 302, 145 315 
             C 105 328, 55 305, 48 245 
             C 35 130, 65 60, 105 52 Z"
          fill="url(#xboxBodyGrad)"
          stroke="#3d424e"
          strokeWidth="2"
        />

        {/* Poignées gauche et droite avec texture grip texturée */}
        <path
          d="M 48 245 C 55 305, 105 328, 145 315 C 160 310, 172 285, 178 250 C 130 240, 70 235, 48 245 Z"
          fill="url(#xboxGripLeft)"
          opacity="0.6"
        />
        <path
          d="M 492 245 C 485 305, 435 328, 395 315 C 380 310, 368 285, 362 250 C 410 240, 470 235, 492 245 Z"
          fill="url(#xboxGripRight)"
          opacity="0.6"
        />

        {/* Lignes de relief du capot supérieur Xbox */}
        <path
          d="M 180 50 C 230 65, 310 65, 360 50"
          fill="none"
          stroke="#17181c"
          strokeWidth="1.5"
        />

        {/* 4. BOUTON LOGO XBOX (NEXUS LUMINEUX) */}
        <g transform="translate(270, 74)">
          <circle r="18" fill="#121316" stroke="#33363e" strokeWidth="2" />
          <circle r="14" fill="#0d0e10" />
          {/* Logo X incurvé Xbox */}
          <path
            d="M -7 -7 Q 0 -2 7 -7 Q 2 0 7 7 Q 0 2 -7 7 Q -2 0 -7 -7 Z"
            fill="#ffffff"
            filter="url(#xboxGlow)"
            opacity="0.9"
          />
        </g>

        {/* 5. BOUTON VIEW (SELECT - INDEX 8) */}
        <g
          transform="translate(225, 115)"
          className="cursor-pointer group"
          onClick={() => onSelectKey(8)}
        >
          <circle
            r="12"
            fill={isView ? '#10b981' : configuringKey === 8 ? '#f59e0b' : '#1e2026'}
            stroke={configuringKey === 8 ? '#f59e0b' : isView ? '#10b981' : '#3f4450'}
            strokeWidth={configuringKey === 8 ? '2.5' : '1.5'}
            className="group-hover:stroke-amber-400 group-hover:fill-[#252830] transition-colors"
          />
          {/* Deux carrés superposés (symbole View) */}
          <rect x="-6" y="-5" width="7" height="6" fill="none" stroke={isView ? '#000' : '#8a909d'} strokeWidth="1.2" />
          <rect x="-2" y="-2" width="7" height="6" fill="none" stroke={isView ? '#000' : '#8a909d'} strokeWidth="1.2" />
          <text y="21" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#f59e0b">
            {getAssignedAction(8)?.badge || 'COIN'}
          </text>
        </g>

        {/* BOUTON SHARE (CENTRE BAS) */}
        <g transform="translate(270, 138)">
          <rect x="-6" y="-4" width="12" height="8" rx="3" fill="#1e2026" stroke="#383c46" strokeWidth="1" />
          <path d="M 0 -2 L 0 2 M -2 0 L 0 -2 L 2 0" stroke="#717682" strokeWidth="1" strokeLinecap="round" />
        </g>

        {/* 6. BOUTON MENU (START - INDEX 9) */}
        <g
          transform="translate(315, 115)"
          className="cursor-pointer group"
          onClick={() => onSelectKey(9)}
        >
          <circle
            r="12"
            fill={isMenu ? '#10b981' : configuringKey === 9 ? '#f59e0b' : '#1e2026'}
            stroke={configuringKey === 9 ? '#f59e0b' : isMenu ? '#10b981' : '#3f4450'}
            strokeWidth={configuringKey === 9 ? '2.5' : '1.5'}
            className="group-hover:stroke-cyan-400 group-hover:fill-[#252830] transition-colors"
          />
          {/* 3 lignes horizontales (symbole Menu) */}
          <line x1="-5" y1="-3" x2="5" y2="-3" stroke={isMenu ? '#000' : '#8a909d'} strokeWidth="1.2" />
          <line x1="-5" y1="0" x2="5" y2="0" stroke={isMenu ? '#000' : '#8a909d'} strokeWidth="1.2" />
          <line x1="-5" y1="3" x2="5" y2="3" stroke={isMenu ? '#000' : '#8a909d'} strokeWidth="1.2" />
          <text y="21" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#38bdf8">
            {getAssignedAction(9)?.badge || 'START'}
          </text>
        </g>

        {/* 7. STICK ANALOGIQUE GAUCHE ASYMÉTRIQUE (EN HAUT À GAUCHE) */}
        <g transform="translate(150, 125)">
          <circle r="34" fill="#121316" stroke="#25272e" strokeWidth="2" />
          {/* Chapeau concave du stick avec bague texturée */}
          <circle r="26" fill="url(#stickConcave)" stroke="#3a3d46" strokeWidth="1.5" />
          <circle r="18" fill="none" stroke="#26282e" strokeWidth="1" strokeDasharray="3,3" />
          <circle r="10" fill="#131417" />
          {/* Bille centrale réactive aux axes */}
          <circle
            cx={activeAxes.x * 6}
            cy={activeAxes.y * 6}
            r="5"
            fill="#22c55e"
            opacity={Math.abs(activeAxes.x) > 0.2 || Math.abs(activeAxes.y) > 0.2 ? '0.8' : '0.2'}
          />
        </g>

        {/* 8. CROIX DIRECTIONNELLE D-PAD (FACETTÉE MÉTALLIQUE XBOX SERIES) */}
        <g transform="translate(205, 205)">
          <circle r="32" fill="url(#dpadDish)" stroke="#2b2d35" strokeWidth="1.5" />
          {/* Les 4 branches de la croix */}
          <path
            d="M -8 -26 L 8 -26 L 8 -8 L 26 -8 L 26 8 L 8 8 L 8 26 L -8 26 L -8 8 L -26 8 L -26 -8 L -8 -8 Z"
            fill="#151619"
            stroke="#3a3e47"
            strokeWidth="1.5"
          />
          {/* Flèches en surbrillance si pressées */}
          <path d="M 0 -22 L -4 -16 L 4 -16 Z" fill={isUp ? '#10b981' : '#6b7280'} />
          <path d="M 0 22 L -4 16 L 4 16 Z" fill={isDown ? '#10b981' : '#6b7280'} />
          <path d="M -22 0 L -16 -4 L -16 4 Z" fill={isLeft ? '#10b981' : '#6b7280'} />
          <path d="M 22 0 L 16 -4 L 16 4 Z" fill={isRight ? '#10b981' : '#6b7280'} />
        </g>

        {/* 9. STICK ANALOGIQUE DROIT (EN BAS AU CENTRE-DROIT) */}
        <g transform="translate(335, 205)">
          <circle r="34" fill="#121316" stroke="#25272e" strokeWidth="2" />
          <circle r="26" fill="url(#stickConcave)" stroke="#3a3d46" strokeWidth="1.5" />
          <circle r="18" fill="none" stroke="#26282e" strokeWidth="1" strokeDasharray="3,3" />
          <circle r="10" fill="#131417" />
        </g>

        {/* 10. CLUSTER DE BOUTONS DIAMANT A, B, X, Y (EN HAUT À DROITE) */}
        <g transform="translate(390, 125)">
          {/* Fond du cluster */}
          <circle r="42" fill="#14161a" opacity="0.4" />

          {/* BOUTON Y (JAUNE / NORD - INDEX 3) */}
          <g
            transform="translate(0, -26)"
            className="cursor-pointer group"
            onClick={() => onSelectKey(3)}
          >
            <circle
              r="14"
              fill={isY ? '#eab308' : '#18191d'}
              stroke={configuringKey === 3 ? '#f59e0b' : '#eab308'}
              strokeWidth={configuringKey === 3 ? '2.5' : '1.8'}
              className="group-hover:stroke-white transition-colors"
            />
            <text y="4" textAnchor="middle" fontSize="11" fontWeight="900" fill={isY ? '#000' : '#eab308'}>
              Y
            </text>
            <text y="10" textAnchor="middle" fontSize="6" fontWeight="bold" fill="#9ca3af">
              {getAssignedAction(3)?.badge || 'D'}
            </text>
          </g>

          {/* BOUTON X (BLEU / OUEST - INDEX 2) */}
          <g
            transform="translate(-26, 0)"
            className="cursor-pointer group"
            onClick={() => onSelectKey(2)}
          >
            <circle
              r="14"
              fill={isX ? '#3b82f6' : '#18191d'}
              stroke={configuringKey === 2 ? '#f59e0b' : '#3b82f6'}
              strokeWidth={configuringKey === 2 ? '2.5' : '1.8'}
              className="group-hover:stroke-white transition-colors"
            />
            <text y="4" textAnchor="middle" fontSize="11" fontWeight="900" fill={isX ? '#fff' : '#3b82f6'}>
              X
            </text>
            <text y="10" textAnchor="middle" fontSize="6" fontWeight="bold" fill="#9ca3af">
              {getAssignedAction(2)?.badge || 'C'}
            </text>
          </g>

          {/* BOUTON B (ROUGE / EST - INDEX 1) */}
          <g
            transform="translate(26, 0)"
            className="cursor-pointer group"
            onClick={() => onSelectKey(1)}
          >
            <circle
              r="14"
              fill={isB ? '#ef4444' : '#18191d'}
              stroke={configuringKey === 1 ? '#f59e0b' : '#ef4444'}
              strokeWidth={configuringKey === 1 ? '2.5' : '1.8'}
              className="group-hover:stroke-white transition-colors"
            />
            <text y="4" textAnchor="middle" fontSize="11" fontWeight="900" fill={isB ? '#fff' : '#ef4444'}>
              B
            </text>
            <text y="10" textAnchor="middle" fontSize="6" fontWeight="bold" fill="#9ca3af">
              {getAssignedAction(1)?.badge || 'B'}
            </text>
          </g>

          {/* BOUTON A (VERT / SUD - INDEX 0) */}
          <g
            transform="translate(0, 26)"
            className="cursor-pointer group"
            onClick={() => onSelectKey(0)}
          >
            <circle
              r="14"
              fill={isA ? '#10b981' : '#18191d'}
              stroke={configuringKey === 0 ? '#f59e0b' : '#10b981'}
              strokeWidth={configuringKey === 0 ? '2.5' : '1.8'}
              className="group-hover:stroke-white transition-colors"
            />
            <text y="4" textAnchor="middle" fontSize="11" fontWeight="900" fill={isA ? '#000' : '#10b981'}>
              A
            </text>
            <text y="10" textAnchor="middle" fontSize="6" fontWeight="bold" fill="#9ca3af">
              {getAssignedAction(0)?.badge || 'A'}
            </text>
          </g>
        </g>
      </svg>
    </div>
  );
}

/* =========================================================================
   2. MANETTE PS5 DUALSENSE RÉALISTE (BICOLORE BLANC/NOIR & LIGHTBAR BLEUE)
   ========================================================================= */
function RealisticDualSenseController({ activeButtons, activeAxes, customButtons, getAssignedAction, configuringKey, onSelectKey }) {
  const isUp = activeButtons.has(12);
  const isDown = activeButtons.has(13);
  const isLeft = activeButtons.has(14);
  const isRight = activeButtons.has(15);

  const isCross = activeButtons.has(0);
  const isCircle = activeButtons.has(1);
  const isSquare = activeButtons.has(2);
  const isTriangle = activeButtons.has(3);

  const isL1 = activeButtons.has(4);
  const isR1 = activeButtons.has(5);
  const isL2 = activeButtons.has(6);
  const isR2 = activeButtons.has(7);

  const isCreate = activeButtons.has(8);
  const isOptions = activeButtons.has(9);

  return (
    <div className="relative w-full max-w-[540px] aspect-[1.6/1] flex items-center justify-center select-none">
      <svg viewBox="0 0 540 340" className="w-full h-full drop-shadow-2xl">
        <defs>
          {/* Blanc perle DualSense */}
          <linearGradient id="ps5White" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#f3f4f6" />
            <stop offset="60%" stopColor="#e5e7eb" />
            <stop offset="100%" stopColor="#cbd5e1" />
          </linearGradient>

          {/* Section centrale noire DualSense */}
          <linearGradient id="ps5Black" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#1e2128" />
            <stop offset="70%" stopColor="#111317" />
            <stop offset="100%" stopColor="#08090b" />
          </linearGradient>

          {/* Lightbar bleue PlayStation */}
          <filter id="ps5LightbarGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* 1. GÂCHETTES L2 / R2 ARRIÈRE */}
        <path
          d="M 125 36 C 135 15, 175 10, 195 15 L 195 36 Z"
          fill={isL2 ? '#3b82f6' : '#181a20'}
          stroke="#3b3f4d"
          strokeWidth="1.5"
        />
        <path
          d="M 415 36 C 405 15, 365 10, 345 15 L 345 36 Z"
          fill={isR2 ? '#3b82f6' : '#181a20'}
          stroke="#3b3f4d"
          strokeWidth="1.5"
        />

        {/* 2. BUMPERS L1 / R1 */}
        <path
          d="M 112 44 C 135 28, 190 24, 215 28 L 215 50 C 180 46, 130 48, 112 44 Z"
          fill={isL1 ? '#3b82f6' : '#282b36'}
          stroke="#474d5e"
          strokeWidth="1.5"
        />
        <path
          d="M 428 44 C 405 28, 350 24, 325 28 L 325 50 C 360 46, 410 48, 428 44 Z"
          fill={isR1 ? '#3b82f6' : '#282b36'}
          stroke="#474d5e"
          strokeWidth="1.5"
        />

        {/* 3. COQUE BLANCHE EMBLÉMATIQUE AVEC AILES COURBÉES */}
        <path
          d="M 100 50 
             C 170 38, 370 38, 440 50 
             C 485 58, 510 135, 498 250 
             C 490 310, 442 332, 400 315 
             C 368 300, 345 235, 330 205 
             C 290 190, 250 190, 210 205 
             C 195 235, 172 300, 140 315 
             C 98 332, 50 310, 42 250 
             C 30 135, 55 58, 100 50 Z"
          fill="url(#ps5White)"
          stroke="#94a3b8"
          strokeWidth="2"
        />

        {/* 4. CHÂSSIS INTÉRIEUR NOIR QUI SOUTIENT LES STICKS SYMÉTRIQUES */}
        <path
          d="M 175 125 
             C 210 100, 330 100, 365 125 
             C 395 145, 405 230, 385 275 
             C 365 315, 340 300, 310 240 
             C 285 225, 255 225, 230 240 
             C 200 300, 175 315, 155 275 
             C 135 230, 145 145, 175 125 Z"
          fill="url(#ps5Black)"
          stroke="#252932"
          strokeWidth="1.5"
        />

        {/* 5. PAVÉ TACTILE CENTRAL (TOUCHPAD) AVEC LIGHTBAR */}
        <g transform="translate(205, 55)">
          {/* Lightbar bleue incandescente sur les contours du touchpad */}
          <path
            d="M 0 0 L 130 0 L 120 75 L 10 75 Z"
            fill="#090d16"
            stroke="#38bdf8"
            strokeWidth="3"
            filter="url(#ps5LightbarGlow)"
          />
          <path
            d="M 2 2 L 128 2 L 118 73 L 12 73 Z"
            fill="#1e222b"
            stroke="#2d323f"
            strokeWidth="1"
          />
        </g>

        {/* 6. BOUTON CREATE (SELECT - GAUCHE DU TOUCHPAD - INDEX 8) */}
        <g
          transform="translate(182, 75)"
          className="cursor-pointer group"
          onClick={() => onSelectKey(8)}
        >
          <ellipse
            cx="0"
            cy="0"
            rx="6"
            ry="9"
            fill={isCreate ? '#3b82f6' : configuringKey === 8 ? '#f59e0b' : '#333845'}
            stroke={configuringKey === 8 ? '#f59e0b' : '#4b5563'}
            strokeWidth="1.2"
            className="group-hover:stroke-amber-400 group-hover:fill-[#444b5c] transition-colors"
          />
          {/* 3 rayons symboliques Create */}
          <line x1="-3" y1="-4" x2="-5" y2="-6" stroke="#9ca3af" strokeWidth="1" />
          <line x1="0" y1="-5" x2="0" y2="-7" stroke="#9ca3af" strokeWidth="1" />
          <line x1="3" y1="-4" x2="5" y2="-6" stroke="#9ca3af" strokeWidth="1" />
          <text y="19" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#f59e0b">
            {getAssignedAction(8)?.badge || 'COIN'}
          </text>
        </g>

        {/* 7. BOUTON OPTIONS (START - DROITE DU TOUCHPAD - INDEX 9) */}
        <g
          transform="translate(358, 75)"
          className="cursor-pointer group"
          onClick={() => onSelectKey(9)}
        >
          <ellipse
            cx="0"
            cy="0"
            rx="6"
            ry="9"
            fill={isOptions ? '#3b82f6' : configuringKey === 9 ? '#f59e0b' : '#333845'}
            stroke={configuringKey === 9 ? '#f59e0b' : '#4b5563'}
            strokeWidth="1.2"
            className="group-hover:stroke-cyan-400 group-hover:fill-[#444b5c] transition-colors"
          />
          {/* 3 lignes horizontales Options */}
          <line x1="-3" y1="-3" x2="3" y2="-3" stroke="#9ca3af" strokeWidth="1" />
          <line x1="-3" y1="0" x2="3" y2="0" stroke="#9ca3af" strokeWidth="1" />
          <line x1="-3" y1="3" x2="3" y2="3" stroke="#9ca3af" strokeWidth="1" />
          <text y="19" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#38bdf8">
            {getAssignedAction(9)?.badge || 'START'}
          </text>
        </g>

        {/* 8. CROIX DIRECTIONNELLE PS5 (4 TOUCHES SÉPARÉES SUR FOND NOIR) */}
        <g transform="translate(130, 130)">
          {/* Haut */}
          <path
            d="M -7 -32 L 7 -32 L 7 -14 L -7 -14 Z"
            rx="3"
            fill={isUp ? '#3b82f6' : '#22252e'}
            stroke="#474d5d"
            strokeWidth="1.5"
          />
          <path d="M 0 -26 L -4 -20 L 4 -20 Z" fill={isUp ? '#fff' : '#9ca3af'} />

          {/* Bas */}
          <path
            d="M -7 14 L 7 14 L 7 32 L -7 32 Z"
            rx="3"
            fill={isDown ? '#3b82f6' : '#22252e'}
            stroke="#474d5d"
            strokeWidth="1.5"
          />
          <path d="M 0 26 L -4 20 L 4 20 Z" fill={isDown ? '#fff' : '#9ca3af'} />

          {/* Gauche */}
          <path
            d="M -32 -7 L -14 -7 L -14 7 L -32 7 Z"
            rx="3"
            fill={isLeft ? '#3b82f6' : '#22252e'}
            stroke="#474d5d"
            strokeWidth="1.5"
          />
          <path d="M -26 0 L -20 -4 L -20 4 Z" fill={isLeft ? '#fff' : '#9ca3af'} />

          {/* Droite */}
          <path
            d="M 14 -7 L 32 -7 L 32 7 L 14 7 Z"
            rx="3"
            fill={isRight ? '#3b82f6' : '#22252e'}
            stroke="#474d5d"
            strokeWidth="1.5"
          />
          <path d="M 26 0 L 20 -4 L 20 4 Z" fill={isRight ? '#fff' : '#9ca3af'} />
        </g>

        {/* 9. DEUX STICKS SYMÉTRIQUES PLAYSTATION EN BAS */}
        {/* Stick Gauche */}
        <g transform="translate(205, 215)">
          <circle r="34" fill="#0c0e12" stroke="#252932" strokeWidth="2" />
          <circle r="26" fill="#1c2027" stroke="#3d4452" strokeWidth="1.5" />
          <circle r="18" fill="none" stroke="#2b303c" strokeWidth="1.2" />
          <circle r="8" fill="#111317" />
          <circle
            cx={activeAxes.x * 6}
            cy={activeAxes.y * 6}
            r="4"
            fill="#3b82f6"
            opacity={Math.abs(activeAxes.x) > 0.2 || Math.abs(activeAxes.y) > 0.2 ? '0.8' : '0.2'}
          />
        </g>

        {/* Bouton Home PS entre les sticks */}
        <g transform="translate(270, 185)">
          <path
            d="M -6 4 L -6 -6 L 0 -8 L 6 -6 L 6 4 Z"
            fill="#64748b"
            opacity="0.8"
          />
        </g>

        {/* Stick Droit */}
        <g transform="translate(335, 215)">
          <circle r="34" fill="#0c0e12" stroke="#252932" strokeWidth="2" />
          <circle r="26" fill="#1c2027" stroke="#3d4452" strokeWidth="1.5" />
          <circle r="18" fill="none" stroke="#2b303c" strokeWidth="1.2" />
          <circle r="8" fill="#111317" />
        </g>

        {/* 10. SYMBOLES GÉOMÉTRIQUES PLAYSTATION (CROIX, ROND, CARRÉ, TRIANGLE) */}
        <g transform="translate(410, 130)">
          {/* TRIANGLE (VERT / NORD - INDEX 3) */}
          <g
            transform="translate(0, -26)"
            className="cursor-pointer group"
            onClick={() => onSelectKey(3)}
          >
            <circle
              r="14"
              fill={isTriangle ? '#10b981' : '#1e222a'}
              stroke={configuringKey === 3 ? '#f59e0b' : '#374151'}
              strokeWidth={configuringKey === 3 ? '2.5' : '1.8'}
              className="group-hover:stroke-emerald-400 transition-colors"
            />
            {/* Triangle vert */}
            <path
              d="M 0 -5 L 5 4 L -5 4 Z"
              fill="none"
              stroke={isTriangle ? '#000' : '#10b981'}
              strokeWidth="2"
            />
            <text y="10" textAnchor="middle" fontSize="6" fontWeight="bold" fill="#9ca3af">
              {getAssignedAction(3)?.badge || 'D'}
            </text>
          </g>

          {/* CARRÉ (ROSE / OUEST - INDEX 2) */}
          <g
            transform="translate(-26, 0)"
            className="cursor-pointer group"
            onClick={() => onSelectKey(2)}
          >
            <circle
              r="14"
              fill={isSquare ? '#ec4899' : '#1e222a'}
              stroke={configuringKey === 2 ? '#f59e0b' : '#374151'}
              strokeWidth={configuringKey === 2 ? '2.5' : '1.8'}
              className="group-hover:stroke-pink-400 transition-colors"
            />
            {/* Carré rose */}
            <rect
              x="-4"
              y="-4"
              width="8"
              height="8"
              fill="none"
              stroke={isSquare ? '#fff' : '#ec4899'}
              strokeWidth="2"
            />
            <text y="10" textAnchor="middle" fontSize="6" fontWeight="bold" fill="#9ca3af">
              {getAssignedAction(2)?.badge || 'C'}
            </text>
          </g>

          {/* ROND (ROUGE / EST - INDEX 1) */}
          <g
            transform="translate(26, 0)"
            className="cursor-pointer group"
            onClick={() => onSelectKey(1)}
          >
            <circle
              r="14"
              fill={isCircle ? '#ef4444' : '#1e222a'}
              stroke={configuringKey === 1 ? '#f59e0b' : '#374151'}
              strokeWidth={configuringKey === 1 ? '2.5' : '1.8'}
              className="group-hover:stroke-rose-400 transition-colors"
            />
            {/* Rond rouge */}
            <circle
              r="5"
              fill="none"
              stroke={isCircle ? '#fff' : '#ef4444'}
              strokeWidth="2"
            />
            <text y="10" textAnchor="middle" fontSize="6" fontWeight="bold" fill="#9ca3af">
              {getAssignedAction(1)?.badge || 'B'}
            </text>
          </g>

          {/* CROIX (BLEU / SUD - INDEX 0) */}
          <g
            transform="translate(0, 26)"
            className="cursor-pointer group"
            onClick={() => onSelectKey(0)}
          >
            <circle
              r="14"
              fill={isCross ? '#3b82f6' : '#1e222a'}
              stroke={configuringKey === 0 ? '#f59e0b' : '#374151'}
              strokeWidth={configuringKey === 0 ? '2.5' : '1.8'}
              className="group-hover:stroke-cyan-400 transition-colors"
            />
            {/* Croix bleue */}
            <line x1="-4" y1="-4" x2="4" y2="4" stroke={isCross ? '#fff' : '#3b82f6'} strokeWidth="2" />
            <line x1="4" y1="-4" x2="-4" y2="4" stroke={isCross ? '#fff' : '#3b82f6'} strokeWidth="2" />
            <text y="10" textAnchor="middle" fontSize="6" fontWeight="bold" fill="#9ca3af">
              {getAssignedAction(0)?.badge || 'A'}
            </text>
          </g>
        </g>
      </svg>
    </div>
  );
}

/* =========================================================================
   3. MANETTE NINTENDO SWITCH PRO RÉALISTE (TRANSLUCIDE SOMBRE & BOUTONS B/A)
   ========================================================================= */
function RealisticSwitchProController({ activeButtons, activeAxes, customButtons, getAssignedAction, configuringKey, onSelectKey }) {
  const isUp = activeButtons.has(12);
  const isDown = activeButtons.has(13);
  const isLeft = activeButtons.has(14);
  const isRight = activeButtons.has(15);

  const isB = activeButtons.has(0); // Sud
  const isA = activeButtons.has(1); // Est
  const isY = activeButtons.has(2); // Ouest
  const isX = activeButtons.has(3); // Nord

  const isL = activeButtons.has(4);
  const isR = activeButtons.has(5);

  const isMinus = activeButtons.has(8);
  const isPlus = activeButtons.has(9);

  return (
    <div className="relative w-full max-w-[540px] aspect-[1.6/1] flex items-center justify-center select-none">
      <svg viewBox="0 0 540 340" className="w-full h-full drop-shadow-2xl">
        <defs>
          {/* Coque sombre fumée texturée Switch Pro */}
          <linearGradient id="switchBody" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#25272c" />
            <stop offset="50%" stopColor="#1a1c20" />
            <stop offset="100%" stopColor="#101114" />
          </linearGradient>

          {/* Poignées latérales galbées */}
          <linearGradient id="switchGrip" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#131417" />
            <stop offset="100%" stopColor="#1d1f24" />
          </linearGradient>
        </defs>

        {/* 1. GÂCHETTES ZL / ZR */}
        <path
          d="M 125 38 C 135 18, 175 14, 195 18 L 195 38 Z"
          fill="#17181c"
          stroke="#383b44"
          strokeWidth="1.5"
        />
        <path
          d="M 415 38 C 405 18, 365 14, 345 18 L 345 38 Z"
          fill="#17181c"
          stroke="#383b44"
          strokeWidth="1.5"
        />

        {/* 2. BUMPERS L / R */}
        <path
          d="M 110 46 C 130 32, 190 28, 220 32 L 220 52 C 180 48, 130 50, 110 46 Z"
          fill={isL ? '#ef4444' : '#22252b'}
          stroke="#3d414a"
          strokeWidth="1.5"
        />
        <path
          d="M 430 46 C 410 32, 350 28, 320 32 L 320 52 C 360 48, 410 50, 430 46 Z"
          fill={isR ? '#ef4444' : '#22252b'}
          stroke="#3d414a"
          strokeWidth="1.5"
        />

        {/* 3. COQUE PRINCIPALE SWITCH PRO */}
        <path
          d="M 108 50 
             C 170 44, 370 44, 432 50 
             C 475 60, 505 130, 492 245 
             C 485 305, 435 328, 395 315 
             C 360 302, 335 240, 315 220 
             C 290 205, 250 205, 225 220 
             C 205 240, 180 302, 145 315 
             C 105 328, 55 305, 48 245 
             C 35 130, 65 60, 108 50 Z"
          fill="url(#switchBody)"
          stroke="#3f434e"
          strokeWidth="2"
        />

        {/* Texture semi-transparente interne */}
        <circle cx="270" cy="170" r="70" fill="#ffffff" opacity="0.02" />

        {/* 4. BOUTONS CENTRAUX : MOINS (-), CAPTURE, HOME, PLUS (+) */}
        {/* Bouton Moins (-) - Index 8 */}
        <g
          transform="translate(225, 105)"
          className="cursor-pointer group"
          onClick={() => onSelectKey(8)}
        >
          <circle
            r="11"
            fill={isMinus ? '#ef4444' : configuringKey === 8 ? '#f59e0b' : '#282b33'}
            stroke={configuringKey === 8 ? '#f59e0b' : isMinus ? '#ef4444' : '#454a57'}
            strokeWidth={configuringKey === 8 ? '2.5' : '1.5'}
            className="group-hover:stroke-amber-400 group-hover:fill-[#323640] transition-colors"
          />
          <line x1="-4" y1="0" x2="4" y2="0" stroke={isMinus ? '#fff' : '#9ca3af'} strokeWidth="2" strokeLinecap="round" />
          <text y="20" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#f59e0b">
            {getAssignedAction(8)?.badge || 'COIN'}
          </text>
        </g>

        {/* Bouton Capture */}
        <g transform="translate(242, 145)">
          <rect x="-6" y="-6" width="12" height="12" rx="2" fill="#181a1f" stroke="#3a3e4a" strokeWidth="1" />
          <circle r="3" fill="#3a3e4a" />
        </g>

        {/* Bouton Home */}
        <g transform="translate(298, 145)">
          <circle r="7" fill="#181a1f" stroke="#38bdf8" strokeWidth="1.2" />
          <path d="M -3 1 L 0 -3 L 3 1 L 2 3 L -2 3 Z" fill="#38bdf8" />
        </g>

        {/* Bouton Plus (+) - Index 9 */}
        <g
          transform="translate(315, 105)"
          className="cursor-pointer group"
          onClick={() => onSelectKey(9)}
        >
          <circle
            r="11"
            fill={isPlus ? '#ef4444' : configuringKey === 9 ? '#f59e0b' : '#282b33'}
            stroke={configuringKey === 9 ? '#f59e0b' : isPlus ? '#ef4444' : '#454a57'}
            strokeWidth={configuringKey === 9 ? '2.5' : '1.5'}
            className="group-hover:stroke-cyan-400 group-hover:fill-[#323640] transition-colors"
          />
          <line x1="-4" y1="0" x2="4" y2="0" stroke={isPlus ? '#fff' : '#9ca3af'} strokeWidth="2" strokeLinecap="round" />
          <line x1="0" y1="-4" x2="0" y2="4" stroke={isPlus ? '#fff' : '#9ca3af'} strokeWidth="2" strokeLinecap="round" />
          <text y="20" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#38bdf8">
            {getAssignedAction(9)?.badge || 'START'}
          </text>
        </g>

        {/* 5. STICK GAUCHE ASYMÉTRIQUE (EN HAUT À GAUCHE) */}
        <g transform="translate(150, 125)">
          <circle r="34" fill="#0d0e11" stroke="#25272e" strokeWidth="2" />
          <circle r="26" fill="#1e2026" stroke="#3b3e48" strokeWidth="1.5" />
          <circle r="18" fill="none" stroke="#2a2c34" strokeWidth="1" />
          <circle
            cx={activeAxes.x * 6}
            cy={activeAxes.y * 6}
            r="5"
            fill="#ef4444"
            opacity={Math.abs(activeAxes.x) > 0.2 || Math.abs(activeAxes.y) > 0.2 ? '0.8' : '0.2'}
          />
        </g>

        {/* 6. CROIX DIRECTIONNELLE NINTENDO (D-PAD PLUS CLASSIQUE) */}
        <g transform="translate(205, 205)">
          <circle r="32" fill="#101114" stroke="#26282f" strokeWidth="1.5" />
          <path
            d="M -7 -24 L 7 -24 L 7 -7 L 24 -7 L 24 7 L 7 7 L 7 24 L -7 24 L -7 7 L -24 7 L -24 -7 L -7 -7 Z"
            fill="#1c1e23"
            stroke="#3a3d46"
            strokeWidth="1.5"
          />
          <path d="M 0 -20 L -3 -15 L 3 -15 Z" fill={isUp ? '#ef4444' : '#6b7280'} />
          <path d="M 0 20 L -3 15 L 3 15 Z" fill={isDown ? '#ef4444' : '#6b7280'} />
          <path d="M -20 0 L -15 -3 L -15 3 Z" fill={isLeft ? '#ef4444' : '#6b7280'} />
          <path d="M 20 0 L 15 -3 L 15 3 Z" fill={isRight ? '#ef4444' : '#6b7280'} />
        </g>

        {/* 7. STICK DROIT (EN BAS AU CENTRE-DROIT) */}
        <g transform="translate(335, 205)">
          <circle r="34" fill="#0d0e11" stroke="#25272e" strokeWidth="2" />
          <circle r="26" fill="#1e2026" stroke="#3b3e48" strokeWidth="1.5" />
          <circle r="18" fill="none" stroke="#2a2c34" strokeWidth="1" />
        </g>

        {/* 8. CLUSTER BOUTONS NINTENDO (DISPOSITION B/A & Y/X) */}
        <g transform="translate(390, 125)">
          <circle r="42" fill="#131417" opacity="0.4" />

          {/* BOUTON X (HAUT / NORD - INDEX 3 EN STANDARD) */}
          <g
            transform="translate(0, -26)"
            className="cursor-pointer group"
            onClick={() => onSelectKey(3)}
          >
            <circle
              r="14"
              fill={isX ? '#ef4444' : '#22252c'}
              stroke={configuringKey === 3 ? '#f59e0b' : '#3e434f'}
              strokeWidth={configuringKey === 3 ? '2.5' : '1.8'}
              className="group-hover:stroke-white transition-colors"
            />
            <text y="4" textAnchor="middle" fontSize="11" fontWeight="900" fill={isX ? '#fff' : '#d1d5db'}>
              X
            </text>
            <text y="10" textAnchor="middle" fontSize="6" fontWeight="bold" fill="#9ca3af">
              {getAssignedAction(3)?.badge || 'D'}
            </text>
          </g>

          {/* BOUTON Y (GAUCHE / OUEST - INDEX 2 EN STANDARD) */}
          <g
            transform="translate(-26, 0)"
            className="cursor-pointer group"
            onClick={() => onSelectKey(2)}
          >
            <circle
              r="14"
              fill={isY ? '#ef4444' : '#22252c'}
              stroke={configuringKey === 2 ? '#f59e0b' : '#3e434f'}
              strokeWidth={configuringKey === 2 ? '2.5' : '1.8'}
              className="group-hover:stroke-white transition-colors"
            />
            <text y="4" textAnchor="middle" fontSize="11" fontWeight="900" fill={isY ? '#fff' : '#d1d5db'}>
              Y
            </text>
            <text y="10" textAnchor="middle" fontSize="6" fontWeight="bold" fill="#9ca3af">
              {getAssignedAction(2)?.badge || 'C'}
            </text>
          </g>

          {/* BOUTON A (DROITE / EST - INDEX 1 EN STANDARD) */}
          <g
            transform="translate(26, 0)"
            className="cursor-pointer group"
            onClick={() => onSelectKey(1)}
          >
            <circle
              r="14"
              fill={isA ? '#ef4444' : '#22252c'}
              stroke={configuringKey === 1 ? '#f59e0b' : '#3e434f'}
              strokeWidth={configuringKey === 1 ? '2.5' : '1.8'}
              className="group-hover:stroke-white transition-colors"
            />
            <text y="4" textAnchor="middle" fontSize="11" fontWeight="900" fill={isA ? '#fff' : '#d1d5db'}>
              A
            </text>
            <text y="10" textAnchor="middle" fontSize="6" fontWeight="bold" fill="#9ca3af">
              {getAssignedAction(1)?.badge || 'B'}
            </text>
          </g>

          {/* BOUTON B (BAS / SUD - INDEX 0 EN STANDARD) */}
          <g
            transform="translate(0, 26)"
            className="cursor-pointer group"
            onClick={() => onSelectKey(0)}
          >
            <circle
              r="14"
              fill={isB ? '#ef4444' : '#22252c'}
              stroke={configuringKey === 0 ? '#f59e0b' : '#3e434f'}
              strokeWidth={configuringKey === 0 ? '2.5' : '1.8'}
              className="group-hover:stroke-white transition-colors"
            />
            <text y="4" textAnchor="middle" fontSize="11" fontWeight="900" fill={isB ? '#fff' : '#d1d5db'}>
              B
            </text>
            <text y="10" textAnchor="middle" fontSize="6" fontWeight="bold" fill="#9ca3af">
              {getAssignedAction(0)?.badge || 'A'}
            </text>
          </g>
        </g>
      </svg>
    </div>
  );
}
