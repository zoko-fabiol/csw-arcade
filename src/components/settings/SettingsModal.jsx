import React, { useState, useEffect } from 'react';
import { 
  X, 
  Gamepad2, 
  Tv, 
  Volume2, 
  VolumeX, 
  Cpu, 
  RotateCcw, 
  Check, 
  Sliders, 
  Keyboard,
  Smartphone,
  Vibrate,
  Eye,
  Compass,
  Zap,
  Move
} from 'lucide-react';
import { GamepadVisualizer } from './GamepadVisualizer';
import { useDeviceType } from '../../utils/deviceDetector';

export function SettingsModal({ 
  isOpen, 
  onClose, 
  settings, 
  updateKeyBinding, 
  updateVideoSetting, 
  updateAudioSetting, 
  updateSystemSetting, 
  updateGamepadSetting,
  updateTouchSetting,
  resetSettings 
}) {
  const [activeTab, setActiveTab] = useState('controls');
  const [controlSubTab, setControlSubTab] = useState('touch');
  const [activePlayer, setActivePlayer] = useState('p1');
  const [listeningAction, setListeningAction] = useState(null);
  const [connectedGamepad, setConnectedGamepad] = useState(null);
  const { isMobile } = useDeviceType();

  // Détection des manettes connectées
  useEffect(() => {
    const checkGamepads = () => {
      if (typeof navigator !== 'undefined' && navigator.getGamepads) {
        const gps = navigator.getGamepads();
        const gp = gps[0] || gps[1];
        if (gp) {
          setConnectedGamepad(gp.id);
        } else {
          setConnectedGamepad(null);
        }
      }
    };

    checkGamepads();
    window.addEventListener('gamepadconnected', checkGamepads);
    window.addEventListener('gamepaddisconnected', checkGamepads);

    return () => {
      window.removeEventListener('gamepadconnected', checkGamepads);
      window.removeEventListener('gamepaddisconnected', checkGamepads);
    };
  }, []);

  // Écouteur de touche lorsque l'utilisateur clique sur une action
  useEffect(() => {
    if (!listeningAction) return;

    const handleKeyDown = (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Touche Escape pour annuler
      if (e.code === 'Escape') {
        setListeningAction(null);
        return;
      }

      // Assignation de la touche
      updateKeyBinding(activePlayer, listeningAction, e.code);
      setListeningAction(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePlayer, listeningAction, updateKeyBinding]);

  // Fermer avec Escape si pas en écoute de touche
  useEffect(() => {
    if (!isOpen || listeningAction) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, listeningAction, onClose]);

  if (!isOpen) return null;

  const controlLabels = [
    { key: 'up', label: 'Direction : HAUT' },
    { key: 'down', label: 'Direction : BAS' },
    { key: 'left', label: 'Direction : GAUCHE' },
    { key: 'right', label: 'Direction : DROITE' },
    { key: 'a', label: 'Touche 1 : Bouton A (Poing Faible / Tir)' },
    { key: 'b', label: 'Touche 2 : Bouton B (Pied Faible / Saut)' },
    { key: 'c', label: 'Touche 3 : Bouton C (Poing Fort / Grenade)' },
    { key: 'd', label: 'Touche 4 : Bouton D (Pied Fort / Spécial)' },
    { key: 'ab', label: 'Touche 5 : Macro A+B (Roulade / Esquive KOF)' },
    { key: 'cd', label: 'Touche 6 : Macro C+D (Attaque Projection Blowback)' },
    { key: 'abc', label: 'Touche 7 : Macro A+B+C (MAX Mode / Super KOF)' },
    { key: 'turbo', label: 'Touche 8 : Turbo A (Tir Automatique 30Hz Metal Slug)' },
    { key: 'coin', label: 'COIN (Insérer Crédit)' },
    { key: 'start', label: 'START (Lancer Partie)' }
  ];

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-4 font-mono select-none cursor-pointer"
      onClick={onClose}
    >
      <div 
        className="relative w-full max-w-3xl bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Header Modale */}
        <div className="p-3.5 sm:p-5 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/60">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0">
              <Sliders className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">
                <span className="hidden sm:inline">Configuration Matérielle NeoRAGEx</span>
                <span className="sm:hidden">PARAMÈTRES NEORAGEX</span>
              </h3>
              <p className="text-[9px] sm:text-[10px] text-neutral-400">
                Inputs, CRT & MVS/AES
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Onglets Principaux Responsive */}
        <div className="grid grid-cols-4 border-b border-neutral-800 bg-neutral-950 text-[10px] sm:text-xs font-bold text-center">
          {[
            { id: 'controls', full: 'CONTRÔLES', short: 'CONTRÔLE', icon: Gamepad2 },
            { id: 'video', full: 'AFFICHAGE & CRT', short: 'VIDÉO', icon: Tv },
            { id: 'audio', full: 'AUDIO', short: 'AUDIO', icon: Volume2 },
            { id: 'system', full: 'SYSTÈME & BIOS', short: 'BIOS', icon: Cpu }
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setListeningAction(null); }}
                className={`py-2.5 sm:py-3 flex items-center justify-center gap-1.5 sm:gap-2 border-b-2 transition-all ${
                  active 
                    ? 'border-cyan-400 text-cyan-400 bg-cyan-950/20' 
                    : 'border-transparent text-neutral-400 hover:text-white'
                }`}
              >
                <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                <span className="hidden sm:inline">{tab.full}</span>
                <span className="sm:hidden">{tab.short}</span>
              </button>
            );
          })}
        </div>

        {/* Corps de la Modale */}
        <div className="p-3.5 sm:p-6 flex-1 overflow-y-auto space-y-4 sm:space-y-6 text-xs">
          
          {/* ================= ONGLET 1 : CONTRÔLES ================= */}
          {activeTab === 'controls' && (
            <div className="space-y-4 sm:space-y-5">
              {/* Sous-navigation Contrôles : Tactile (priorité mobile) / Manette / Clavier (desktop uniquement) */}
              <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-3'} gap-1.5 sm:gap-2 p-1 bg-neutral-950 rounded-xl border border-neutral-800 text-[11px] sm:text-xs font-bold`}>
                <button
                  onClick={() => setControlSubTab('touch')}
                  className={`py-1.5 sm:py-2 px-2 sm:px-3 rounded-lg flex items-center justify-center gap-1.5 sm:gap-2 transition-all ${
                    controlSubTab === 'touch'
                      ? 'bg-cyan-500 text-black shadow-md'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">TACTILE MOBILE</span>
                  <span className="sm:hidden">TACTILE</span>
                </button>

                <button
                  onClick={() => setControlSubTab('gamepad')}
                  className={`py-1.5 sm:py-2 px-2 sm:px-3 rounded-lg flex items-center justify-center gap-1.5 sm:gap-2 transition-all ${
                    controlSubTab === 'gamepad'
                      ? 'bg-cyan-500 text-black shadow-md'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
                  }`}
                >
                  <Gamepad2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">MANETTE (BLUETOOTH)</span>
                  <span className="sm:hidden">MANETTE</span>
                </button>

                {!isMobile && (
                  <button
                    onClick={() => setControlSubTab('keyboard')}
                    className={`py-1.5 sm:py-2 px-2 sm:px-3 rounded-lg flex items-center justify-center gap-1.5 sm:gap-2 transition-all ${
                      controlSubTab === 'keyboard'
                        ? 'bg-cyan-500 text-black shadow-md'
                        : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
                    }`}
                  >
                    <Keyboard className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden sm:inline">CLAVIER (P1 / P2)</span>
                    <span className="sm:hidden">CLAVIER</span>
                  </button>
                )}
              </div>

              {/* Sous-onglet 1 : MANETTE INTERACTIVE */}
              {controlSubTab === 'gamepad' && (
                <GamepadVisualizer
                  settings={settings}
                  onUpdateGamepadSetting={updateGamepadSetting}
                />
              )}

              {/* Sous-onglet 2 : CLAVIER */}
              {controlSubTab === 'keyboard' && (
                <div className="space-y-4">
                  {/* Sélecteur Joueur 1 / Joueur 2 */}
                  <div className="flex items-center justify-between bg-neutral-950 p-2 rounded-xl border border-neutral-800">
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setActivePlayer('p1'); setListeningAction(null); }}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          activePlayer === 'p1' 
                            ? 'bg-cyan-500 text-black shadow-sm' 
                            : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        JOUEUR 1
                      </button>
                      <button
                        onClick={() => { setActivePlayer('p2'); setListeningAction(null); }}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          activePlayer === 'p2' 
                            ? 'bg-red-500 text-black shadow-sm' 
                            : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        JOUEUR 2
                      </button>
                    </div>

                    <div className="text-[11px] flex items-center gap-2 text-neutral-400">
                      <Gamepad2 className="w-3.5 h-3.5 text-cyan-400" />
                      {connectedGamepad ? (
                        <span className="text-emerald-400 font-bold truncate max-w-[200px]" title={connectedGamepad}>
                          {connectedGamepad}
                        </span>
                      ) : (
                        <span className="text-neutral-500">Aucune manette détectée</span>
                      )}
                    </div>
                  </div>

                  {/* Message instructif si écoute de touche */}
                  {listeningAction && (
                    <div className="p-3 bg-cyan-950/80 border border-cyan-500 rounded-xl text-center text-cyan-300 animate-pulse font-bold">
                      Appuyez sur la touche souhaitée pour "{listeningAction.toUpperCase()}" (ou Échap pour annuler)...
                    </div>
                  )}

                  {/* Grille de Mapping des Touches */}
                  <div className="grid grid-cols-2 gap-2.5">
                    {controlLabels.map(({ key, label }) => {
                      const currentCode = settings.controls[activePlayer][key] || 'Non assigné';
                      const isListening = listeningAction === key;

                      return (
                        <div 
                          key={key}
                          className="p-3 bg-neutral-950 border border-neutral-800 rounded-xl flex items-center justify-between hover:border-neutral-700 transition-colors"
                        >
                          <span className="text-neutral-400 text-[11px] font-medium">{label}</span>
                          <button
                            onClick={() => setListeningAction(key)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-all ${
                              isListening 
                                ? 'bg-cyan-500 text-black animate-bounce' 
                                : 'bg-neutral-800 hover:bg-neutral-700 text-white'
                            }`}
                          >
                            {isListening ? 'Appuyez...' : currentCode.replace('Key', '').replace('Digit', '')}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Sous-onglet 3 : TACTILE MOBILE */}
              {controlSubTab === 'touch' && (
                <div className="space-y-4 p-4 rounded-xl bg-neutral-950 border border-neutral-800">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-cyan-400" />
                        Options Tactiles & Ergonomie Mobile
                      </h4>
                      <p className="text-[11px] text-neutral-400 mt-0.5">
                        Personnalisez le contrôleur virtuel pour une expérience arcade optimale
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-[10px] bg-cyan-950 border border-cyan-500/40 text-cyan-300 font-bold">
                      A, B, X, Y
                    </span>
                  </div>

                  {/* 1. Retour Haptique (Vibration) */}
                  <div className="p-3 bg-neutral-900/90 border border-neutral-800 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Vibrate className="w-4 h-4 text-cyan-400 shrink-0" />
                      <div>
                        <span className="font-bold text-neutral-200 block text-xs">Vibration Haptique</span>
                        <span className="text-[10px] text-neutral-400">Micro-vibration à chaque appui pour simuler de vrais boutons</span>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.touch?.vibration ?? true}
                      onChange={(e) => updateTouchSetting('vibration', e.target.checked)}
                      className="w-5 h-5 accent-cyan-500 cursor-pointer rounded"
                    />
                  </div>

                  {/* 2. Opacité des Touches */}
                  <div className="p-3 bg-neutral-900/90 border border-neutral-800 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Eye className="w-4 h-4 text-cyan-400 shrink-0" />
                        <div>
                          <span className="font-bold text-neutral-200 block text-xs">Opacité des Touches</span>
                          <span className="text-[10px] text-neutral-400">Transparence des contrôles sur l'écran</span>
                        </div>
                      </div>
                      <span className="text-xs font-mono font-bold text-cyan-400">
                        {settings.touch?.opacity ?? 75}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="100"
                      step="5"
                      value={settings.touch?.opacity ?? 75}
                      onChange={(e) => updateTouchSetting('opacity', Number(e.target.value))}
                      className="w-full accent-cyan-500 cursor-pointer h-1.5 bg-neutral-800 rounded-lg"
                    />
                  </div>

                  {/* 3. Taille des Touches */}
                  <div className="p-3 bg-neutral-900/90 border border-neutral-800 rounded-xl space-y-2">
                    <span className="font-bold text-neutral-200 block text-xs">Taille des Boutons & D-Pad</span>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { val: 80, label: 'Compact (80%)' },
                        { val: 100, label: 'Normal (100%)' },
                        { val: 120, label: 'Grand (120%)' }
                      ].map((item) => (
                        <button
                          key={item.val}
                          onClick={() => updateTouchSetting('scale', item.val)}
                          className={`py-1.5 px-2 rounded-lg text-[11px] font-bold border transition-all ${
                            (settings.touch?.scale ?? 100) === item.val
                              ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                              : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 4. Type de Contrôle Directionnel (Croix D-Pad vs Analogue) */}
                  <div className="p-3 bg-neutral-900/90 border border-neutral-800 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-neutral-200 block text-xs">Type de Contrôle Directionnel</span>
                      <span className="text-[10px] text-cyan-400 font-mono font-bold">
                        {(settings.touch?.dpadType ?? 'analog') === 'dpad' ? 'CROIX D-PAD' : 'JOYSTICK'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => updateTouchSetting('dpadType', 'dpad')}
                        className={`py-2 px-2.5 rounded-lg text-[11px] font-bold border text-left transition-all ${
                          (settings.touch?.dpadType ?? 'analog') === 'dpad'
                            ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 shadow-sm'
                            : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 font-bold">
                          <Move className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                          <span>Croix D-Pad Classique</span>
                        </span>
                        <span className="text-[9px] text-neutral-400 font-normal block mt-0.5">
                          Croix directionnelle rétro 4/8 directions
                        </span>
                      </button>

                      <button
                        onClick={() => updateTouchSetting('dpadType', 'analog')}
                        className={`py-2 px-2.5 rounded-lg text-[11px] font-bold border text-left transition-all ${
                          (settings.touch?.dpadType ?? 'analog') === 'analog'
                            ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 shadow-sm'
                            : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 font-bold">
                          <Compass className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                          <span>Joystick Analogue Virtuel</span>
                        </span>
                        <span className="text-[9px] text-neutral-400 font-normal block mt-0.5">
                          Stick rotatif 360° avec centrage
                        </span>
                      </button>
                    </div>

                    {/* Si Joystick Analogue est sélectionné : Choix Flottant vs Fixe */}
                    {(settings.touch?.dpadType ?? 'analog') === 'analog' && (
                      <div className="pt-2 border-t border-neutral-800/80 space-y-1.5">
                        <span className="text-[10px] text-neutral-400 block font-semibold">Comportement du stick :</span>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => updateTouchSetting('joystickMode', 'floating')}
                            className={`py-1.5 px-2 rounded-lg text-[10px] font-bold border text-left transition-all ${
                              (settings.touch?.joystickMode ?? 'floating') === 'floating'
                                ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                                : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white'
                            }`}
                          >
                            Flottant (Fortnite style)
                          </button>
                          <button
                            onClick={() => updateTouchSetting('joystickMode', 'fixed')}
                            className={`py-1.5 px-2 rounded-lg text-[10px] font-bold border text-left transition-all ${
                              (settings.touch?.joystickMode ?? 'floating') === 'fixed'
                                ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                                : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white'
                            }`}
                          >
                            Position Fixe
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 5. Guide & Configuration des Touches Tactiles Neo Geo (8 Touches) */}
                  <div className="p-3 bg-neutral-900/90 border border-neutral-800 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Gamepad2 className="w-4 h-4 text-cyan-400 shrink-0" />
                        <div>
                          <span className="font-bold text-neutral-200 block text-xs">Rôle des Touches Tactiles (Disposition 8 Touches)</span>
                          <span className="text-[10px] text-neutral-400">Guide des actions pour les jeux de combat et Metal Slug</span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
                      {/* Bouton A */}
                      <div className="p-2 rounded-lg bg-neutral-950 border border-neutral-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-emerald-500 text-black font-black flex items-center justify-center text-[10px]">A</span>
                          <div>
                            <span className="font-bold text-emerald-300 block">Bouton A (Vert)</span>
                            <span className="text-neutral-400 text-[9px]">Poing Faible (KOF) • Tir (Metal Slug)</span>
                          </div>
                        </div>
                      </div>

                      {/* Bouton B */}
                      <div className="p-2 rounded-lg bg-neutral-950 border border-neutral-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-rose-500 text-white font-black flex items-center justify-center text-[10px]">B</span>
                          <div>
                            <span className="font-bold text-rose-300 block">Bouton B (Rose)</span>
                            <span className="text-neutral-400 text-[9px]">Pied Faible (KOF) • Saut (Metal Slug)</span>
                          </div>
                        </div>
                      </div>

                      {/* Bouton X / C */}
                      <div className="p-2 rounded-lg bg-neutral-950 border border-neutral-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-cyan-400 text-black font-black flex items-center justify-center text-[10px]">X</span>
                          <div>
                            <span className="font-bold text-cyan-300 block">Bouton X (Neo Geo C)</span>
                            <span className="text-neutral-400 text-[9px]">Poing Fort (KOF) • Grenades / Bombes</span>
                          </div>
                        </div>
                      </div>

                      {/* Bouton Y / D */}
                      <div className="p-2 rounded-lg bg-neutral-950 border border-neutral-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-amber-400 text-black font-black flex items-center justify-center text-[10px]">Y</span>
                          <div>
                            <span className="font-bold text-amber-300 block">Bouton Y (Neo Geo D)</span>
                            <span className="text-neutral-400 text-[9px]">Pied Fort (KOF) • Coup Violent / Spécial</span>
                          </div>
                        </div>
                      </div>

                      {/* Touche L1 : Macro A+B */}
                      <div className="p-2 rounded-lg bg-neutral-950 border border-neutral-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-neutral-800 border border-cyan-500/50 text-cyan-300 font-bold text-[9px]">L1</span>
                          <div>
                            <span className="font-bold text-white block">Touche 5 : Macro A+B (Roulade)</span>
                            <span className="text-neutral-400 text-[9px]">Esquive / Roulade rapide KOF '98/'2002</span>
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={settings.touch?.macroAbEnabled ?? true}
                          onChange={(e) => updateTouchSetting('macroAbEnabled', e.target.checked)}
                          className="w-4 h-4 accent-cyan-500 cursor-pointer rounded"
                        />
                      </div>

                      {/* Touche R1 : Macro C+D */}
                      <div className="p-2 rounded-lg bg-neutral-950 border border-neutral-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-neutral-800 border border-cyan-500/50 text-cyan-300 font-bold text-[9px]">R1</span>
                          <div>
                            <span className="font-bold text-white block">Touche 6 : Macro C+D (Projection)</span>
                            <span className="text-neutral-400 text-[9px]">Attaque lourde Blowback de repoussement</span>
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={settings.touch?.macroCdEnabled ?? true}
                          onChange={(e) => updateTouchSetting('macroCdEnabled', e.target.checked)}
                          className="w-4 h-4 accent-cyan-500 cursor-pointer rounded"
                        />
                      </div>

                      {/* Touche Turbo A */}
                      <div className="p-2 rounded-lg bg-neutral-950 border border-neutral-800 flex items-center justify-between sm:col-span-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/60 text-amber-300 font-bold text-[9px] flex items-center gap-1">
                            <Zap className="w-3 h-3 text-amber-400" />
                            TURBO A
                          </span>
                          <div>
                            <span className="font-bold text-white block">Touche 8 : Turbo 30 Hz (Metal Slug)</span>
                            <span className="text-neutral-400 text-[9px]">Tir continu ultra-rapide tant que le bouton est maintenu</span>
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={settings.touch?.turboEnabled ?? true}
                          onChange={(e) => updateTouchSetting('turboEnabled', e.target.checked)}
                          className="w-4 h-4 accent-cyan-500 cursor-pointer rounded"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 4. Mode Portrait Smartphone */}
                  <div className="p-3 bg-neutral-900/90 border border-neutral-800 rounded-xl space-y-2">
                    <span className="font-bold text-neutral-200 block text-xs">Disposition en Mode Portrait (Smartphone)</span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => updateTouchSetting('portraitMode', 'pad-bottom')}
                        className={`py-2 px-2.5 rounded-lg text-[11px] font-bold border text-left transition-all ${
                          (settings.touch?.portraitMode ?? 'pad-bottom') === 'pad-bottom'
                            ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                            : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 font-bold">
                          <Gamepad2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                          <span>Arcade Pad Bas</span>
                        </span>
                        <span className="text-[9px] text-neutral-400 font-normal">Écran 4:3 en haut, manette en bas sans masquer le jeu</span>
                      </button>

                      <button
                        onClick={() => updateTouchSetting('portraitMode', 'overlay')}
                        className={`py-2 px-2.5 rounded-lg text-[11px] font-bold border text-left transition-all ${
                          (settings.touch?.portraitMode ?? 'pad-bottom') === 'overlay'
                            ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                            : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 font-bold">
                          <Smartphone className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                          <span>Superposé</span>
                        </span>
                        <span className="text-[9px] text-neutral-400 font-normal">Contrôles transparents sur toute la hauteur</span>
                      </button>
                    </div>
                  </div>

                  {/* 5. Auto-masquer si Manette Détectée */}
                  <div className="p-3 bg-neutral-900/90 border border-neutral-800 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="font-bold text-neutral-200 block text-xs">Masquer si Manette Connectée</span>
                      <span className="text-[10px] text-neutral-400">Cache le tactile dès qu'une manette Bluetooth / USB est active</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.touch?.autoHideOnGamepad ?? true}
                      onChange={(e) => updateTouchSetting('autoHideOnGamepad', e.target.checked)}
                      className="w-5 h-5 accent-cyan-500 cursor-pointer rounded"
                    />
                  </div>

                  <button
                    onClick={() => {
                      try {
                        localStorage.removeItem('csw_touch_layout_v3');
                        updateTouchSetting('opacity', 75);
                        updateTouchSetting('scale', 100);
                        updateTouchSetting('vibration', true);
                        updateTouchSetting('portraitMode', 'pad-bottom');
                        alert('Paramètres et positions tactiles réinitialisés aux valeurs optimales !');
                      } catch(e) {}
                    }}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-bold transition-all w-full justify-center"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Réinitialiser les réglages tactiles par défaut
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ================= ONGLET 2 : AFFICHAGE & CRT ================= */}
          {activeTab === 'video' && (
            <div className="space-y-4">
              {/* Scanlines CRT Toggle */}
              <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-white text-xs">Filtre Scanlines CRT (Cathodique)</h4>
                  <p className="text-[11px] text-neutral-400 mt-0.5">
                    Reproduit les lignes de balayage caractéristiques des bornes d'arcade des années 90.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.video.scanlines}
                  onChange={(e) => updateVideoSetting('scanlines', e.target.checked)}
                  className="w-5 h-5 accent-cyan-500 cursor-pointer"
                />
              </div>

              {/* Ratio d'Aspect */}
              <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl space-y-2">
                <h4 className="font-bold text-white text-xs">Ratio d'Aspect de l'Écran</h4>
                <div className="grid grid-cols-3 gap-2 pt-1">
                  {[
                    { id: '4:3', label: '4:3 (Arcade Authentique)' },
                    { id: '16:9', label: '16:9 (Plein Écran Étiré)' },
                    { id: 'pixel-perfect', label: '1:1 Pixel Perfect' }
                  ].map((ratio) => (
                    <button
                      key={ratio.id}
                      onClick={() => updateVideoSetting('aspectRatio', ratio.id)}
                      className={`py-2 px-3 rounded-lg text-xs font-bold border transition-all ${
                        settings.video.aspectRatio === ratio.id 
                          ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300' 
                          : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
                      }`}
                    >
                      {ratio.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Rendu Pixels */}
              <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl space-y-2">
                <h4 className="font-bold text-white text-xs">Lissage Graphique</h4>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {[
                    { id: 'pixelated', label: 'Pixel Art Brut (Sharp Nearest-Neighbor)' },
                    { id: 'smooth', label: 'Lissé Bilinéaire (Bilinear Interpolation)' }
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => updateVideoSetting('filter', f.id)}
                      className={`py-2 px-3 rounded-lg text-xs font-bold border transition-all ${
                        settings.video.filter === f.id 
                          ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300' 
                          : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ================= ONGLET 3 : AUDIO ================= */}
          {activeTab === 'audio' && (
            <div className="space-y-4">
              <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-xs">Volume Général de l'Émulateur</span>
                  <span className="text-cyan-400 font-bold">{settings.audio.volume}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={settings.audio.volume}
                  onChange={(e) => updateAudioSetting('volume', Number(e.target.value))}
                  className="w-full accent-cyan-500 cursor-pointer"
                />
              </div>

              <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-white text-xs">Couper le Son (Mute)</h4>
                  <p className="text-[11px] text-neutral-400 mt-0.5">
                    Désactive la sortie Web Audio API
                  </p>
                </div>
                <button
                  onClick={() => updateAudioSetting('muted', !settings.audio.muted)}
                  className={`p-2 rounded-lg border transition-all ${
                    settings.audio.muted 
                      ? 'bg-rose-500/20 border-rose-500 text-rose-400' 
                      : 'bg-neutral-900 border-neutral-800 text-neutral-400'
                  }`}
                >
                  {settings.audio.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {/* ================= ONGLET 4 : SYSTÈME & BIOS ================= */}
          {activeTab === 'system' && (
            <div className="space-y-4">
              {/* Mode Arcade MVS vs Console AES */}
              <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl space-y-2">
                <h4 className="font-bold text-white text-xs">Mode Matériel du Système Neo Geo</h4>
                <p className="text-[11px] text-neutral-400">
                  Comme dans NeoRAGEx, basculez entre la borne d'arcade originale et la console de salon.
                </p>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {[
                    { id: 'mvs', title: 'Arcade (MVS)', desc: 'Exige l\'insertion de Coins / Crédits' },
                    { id: 'aes', title: 'Console (AES)', desc: 'Mode Free Play & Options SNK' }
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      onClick={() => updateSystemSetting('biosMode', mode.id)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        settings.system.biosMode === mode.id 
                          ? 'bg-cyan-500/20 border-cyan-500 text-white' 
                          : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
                      }`}
                    >
                      <span className="font-bold block text-xs">{mode.title}</span>
                      <span className="text-[10px] text-neutral-500">{mode.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Région */}
              <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl space-y-2">
                <h4 className="font-bold text-white text-xs">Région du BIOS</h4>
                <div className="grid grid-cols-3 gap-2 pt-1">
                  {['europe', 'usa', 'japan'].map((reg) => (
                    <button
                      key={reg}
                      onClick={() => updateSystemSetting('region', reg)}
                      className={`py-2 px-3 rounded-lg text-xs font-bold uppercase border transition-all ${
                        settings.system.region === reg 
                          ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300' 
                          : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
                      }`}
                    >
                      {reg}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-950/80 flex items-center justify-between">
          <button
            onClick={resetToDefaults}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-neutral-400 hover:text-rose-400 hover:bg-neutral-800 transition-colors text-xs"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Paramètres d'Usine
          </button>

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs shadow-lg shadow-cyan-500/20 transition-all active:scale-95 flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            ENREGISTRER & FERMER
          </button>
        </div>
      </div>
    </div>
  );
}
