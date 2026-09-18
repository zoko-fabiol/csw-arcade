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
  Smartphone 
} from 'lucide-react';
import { GamepadVisualizer } from './GamepadVisualizer';

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
  resetToDefaults 
}) {
  const [activeTab, setActiveTab] = useState('controls'); // 'controls' | 'video' | 'audio' | 'system'
  const [controlSubTab, setControlSubTab] = useState('gamepad'); // 'keyboard' | 'gamepad' | 'touch'
  const [activePlayer, setActivePlayer] = useState('p1'); // 'p1' | 'p2'
  const [listeningAction, setListeningAction] = useState(null); // action en cours de remapping
  const [connectedGamepad, setConnectedGamepad] = useState(null);

  // Détection des manettes connectées
  useEffect(() => {
    const checkGamepads = () => {
      if (navigator.getGamepads) {
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

      updateKeyBinding(activePlayer, listeningAction, e.code);
      setListeningAction(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [listeningAction, activePlayer, updateKeyBinding]);

  if (!isOpen) return null;

  const controlLabels = [
    { key: 'up', label: 'Direction : HAUT' },
    { key: 'down', label: 'Direction : BAS' },
    { key: 'left', label: 'Direction : GAUCHE' },
    { key: 'right', label: 'Direction : DROITE' },
    { key: 'a', label: 'Bouton A (Poing Faible)' },
    { key: 'b', label: 'Bouton B (Pied Faible)' },
    { key: 'c', label: 'Bouton C (Poing Fort)' },
    { key: 'd', label: 'Bouton D (Pied Fort)' },
    { key: 'coin', label: 'COIN (Insérer Crédit)' },
    { key: 'start', label: 'START (Lancer Partie)' }
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 font-mono select-none">
      <div className="relative w-full max-w-3xl bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        
        {/* Header Modale */}
        <div className="p-5 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/60">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Configuration Matérielle NeoRAGEx
              </h3>
              <p className="text-[10px] text-neutral-400">
                Paramètres d'inputs, filtres d'affichage et architecture MVS / AES
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

        {/* Onglets Principaux */}
        <div className="grid grid-cols-4 border-b border-neutral-800 bg-neutral-950 text-xs font-bold text-center">
          {[
            { id: 'controls', label: 'CONTRÔLES', icon: Gamepad2 },
            { id: 'video', label: 'AFFICHAGE & CRT', icon: Tv },
            { id: 'audio', label: 'AUDIO', icon: Volume2 },
            { id: 'system', label: 'SYSTÈME & BIOS', icon: Cpu }
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setListeningAction(null); }}
                className={`py-3 flex items-center justify-center gap-2 border-b-2 transition-all ${
                  active 
                    ? 'border-cyan-400 text-cyan-400 bg-cyan-950/20' 
                    : 'border-transparent text-neutral-400 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Corps de la Modale */}
        <div className="p-6 flex-1 overflow-y-auto space-y-6 text-xs">
          
          {/* ================= ONGLET 1 : CONTRÔLES ================= */}
          {activeTab === 'controls' && (
            <div className="space-y-5">
              {/* Sous-navigation Contrôles : Clavier / Manette Interactive / Mobile Tactile */}
              <div className="grid grid-cols-3 gap-2 p-1 bg-neutral-950 rounded-xl border border-neutral-800 text-xs font-bold">
                <button
                  onClick={() => setControlSubTab('gamepad')}
                  className={`py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-all ${
                    controlSubTab === 'gamepad'
                      ? 'bg-cyan-500 text-black shadow-md'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
                  }`}
                >
                  <Gamepad2 className="w-3.5 h-3.5" />
                  MANETTE INTERACTIVE
                </button>

                <button
                  onClick={() => setControlSubTab('keyboard')}
                  className={`py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-all ${
                    controlSubTab === 'keyboard'
                      ? 'bg-cyan-500 text-black shadow-md'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
                  }`}
                >
                  <Keyboard className="w-3.5 h-3.5" />
                  CLAVIER (P1 / P2)
                </button>

                <button
                  onClick={() => setControlSubTab('touch')}
                  className={`py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition-all ${
                    controlSubTab === 'touch'
                      ? 'bg-cyan-500 text-black shadow-md'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-900'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  TACTILE MOBILE
                </button>
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
                      <h4 className="text-xs font-bold text-white uppercase">Touches Tactiles Mobiles</h4>
                      <p className="text-[11px] text-neutral-400 mt-0.5">
                        Boutons virtuels A, B, X, Y, D-Pad 8 directions et touches utilitaires
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-[10px] bg-cyan-950 border border-cyan-500/40 text-cyan-300 font-bold">
                      LAYOUT : A, B, X, Y (DIAMANT)
                    </span>
                  </div>

                  <div className="p-3 rounded-lg bg-neutral-900 border border-neutral-800 text-[11px] text-neutral-300 space-y-2">
                    <p>💡 <strong className="text-white">Déplacement libre en jeu :</strong> Cliquez sur le bouton <span className="text-amber-400 font-bold">DÉPLACER TOUCHES</span> directement sur l'écran de jeu pour faire glisser le D-Pad ou les boutons A, B, X, Y où vous le souhaitez sous vos pouces.</p>
                    <p>🎮 <strong className="text-white">Correspondance Neo Geo :</strong> A = Poing Faible, B = Pied Faible, X = Poing Fort, Y = Pied Fort.</p>
                  </div>

                  <button
                    onClick={() => {
                      try {
                        localStorage.removeItem('csw_touch_layout_v2');
                        alert('Disposition tactile réinitialisée aux positions par défaut !');
                      } catch(e) {}
                    }}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-bold transition-all"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Réinitialiser position et taille par défaut
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
