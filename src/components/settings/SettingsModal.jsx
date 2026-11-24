import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  Move,
  Sparkles,
  ShieldAlert,
  Swords,
  Database,
  Trash2,
  Sun,
  Moon,
  Monitor,
  Mic,
  MicOff,
  Headphones,
  FolderOpen,
  Upload,
  Download,
  RefreshCw,
} from 'lucide-react';
import { getPlayerIdentity, setPlayerDisplayName } from '../../services/firebaseFightcadeService';
import { formatBytes, getPlatformCacheStats, listCachedRoms, removeCachedRom, transferAllCacheToDirectory, restoreAllRomsFromDirectory } from '../../services/platformRomService';
import { romStorage } from '../../services/romStorage';
import { GamepadVisualizer } from './GamepadVisualizer';
import { CONSOLE_CONTROL_PROFILES, getConsoleControlProfile } from '../../data/consoleControlProfiles';
import { useDeviceType } from '../../utils/deviceDetector';
import { SHADER_PRESETS, resolveProfile } from '../../utils/performanceProfile';
import { getUniverseTheme } from '../../data/universeThemes';

function SettingsSwitch({ checked, onChange, label, description, icon: Icon, accentTone = 'universe' }) {
  const activeStyle =
    accentTone === 'amber'
      ? { backgroundColor: '#f59e0b' }
      : { backgroundColor: 'var(--u-accent)' };

  return (
    <div className="p-3.5 rounded-2xl bg-neutral-950/80 border border-white/10 hover:border-white/20 transition-colors flex items-center justify-between gap-3">
      <div className="flex items-start gap-3 min-w-0">
        {Icon && (
          <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 mt-0.5">
            <Icon
              className={`w-4 h-4 ${accentTone === 'amber' ? 'text-amber-400' : 'u-accent-text'}`}
              aria-hidden="true"
            />
          </div>
        )}
        <div className="min-w-0">
          <span className="font-bold text-neutral-100 block text-xs sm:text-[13px] leading-snug">
            {label}
          </span>
          {description && (
            <span className="text-[11px] text-neutral-400 block mt-0.5 leading-relaxed">
              {description}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={Boolean(checked)}
        aria-label={label}
        onClick={() => onChange(!checked)}
        style={checked ? activeStyle : undefined}
        className={`arcade-focus-ring relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
          checked ? 'border-transparent' : 'bg-neutral-800 border-white/15'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

const NAV_TABS = [
  { id: 'controls', label: 'Contrôles', short: 'Contrôles', desc: 'Tactile, Manette & Clavier', icon: Gamepad2 },
  { id: 'video', label: 'Affichage & CRT', short: 'Vidéo', desc: 'Shaders, Ratio & Stream', icon: Tv },
  { id: 'audio', label: 'Audio', short: 'Audio', desc: 'Volume & Sortie son', icon: Volume2 },
  { id: 'system', label: 'Système & BIOS', short: 'BIOS', desc: 'MVS/AES & Région', icon: Cpu },
  { id: 'storage', label: 'Stockage ROMs', short: 'ROMs', desc: 'Dossier partagé & Cache', icon: FolderOpen },
  { id: 'netplay', label: 'Salon & Netplay', short: 'Salon', desc: 'CSW Arcade & P2P', icon: Swords },
];

export function SettingsModal({
  isOpen,
  onClose,
  platformMode = 'all',
  settings,
  updateKeyBinding,
  updateConsoleKeyBinding,
  updateConsoleGamepadBinding,
  resetConsoleControls,
  updateVideoSetting,
  updateAudioSetting,
  updateSystemSetting,
  updateGamepadSetting,
  updateTouchSetting,
  updatePerformanceSetting,
  updateNetplaySetting,
  updateUiSetting,
  updateVoiceSetting,
  onCacheCleared,
  resetToDefaults,
  resetSettings,
}) {
  const handleReset = resetToDefaults || resetSettings;
  const [activeTab, setActiveTab] = useState('controls');
  const [playerName, setPlayerName] = useState(() => getPlayerIdentity().name);
  const [cacheInfo, setCacheInfo] = useState({ count: 0, totalBytes: 0 });
  const [arcadeStats, setArcadeStats] = useState({ count: 0, totalMB: '0.0' });
  const [dirInfo, setDirInfo] = useState({ supported: false, configured: false, name: null, permission: 'none' });
  const [isSyncingRoms, setIsSyncingRoms] = useState(false);
  const romImportInputRef = useRef(null);
  const [portalTarget, setPortalTarget] = useState(() => (typeof document !== 'undefined' ? document.body : null));
  const [controlSubTab, setControlSubTab] = useState('touch');
  const [selectedConsoleId, setSelectedConsoleId] = useState('arcade');
  const [activePlayer, setActivePlayer] = useState('p1');
  const [listeningAction, setListeningAction] = useState(null);
  const [connectedGamepad, setConnectedGamepad] = useState(null);
  const [inlineNotice, setInlineNotice] = useState('');
  const { isMobile } = useDeviceType();
  const currentProfile = resolveProfile(settings?.performance?.profile ?? 'auto');
  const isStreamMode = !!settings?.performance?.streamMode;
  const currentShaderId = settings?.video?.shader || 'none';

  // Synchroniser le profil de console sélectionné avec l'univers actif à l'ouverture
  useEffect(() => {
    if (!isOpen) return;
    if (CONSOLE_CONTROL_PROFILES.some((p) => p.id === platformMode)) {
      setSelectedConsoleId(platformMode);
    }
    getPlatformCacheStats().then(setCacheInfo).catch(() => {});
    romStorage.getStorageStats().then(setArcadeStats).catch(() => {});
    romStorage.getSavedDirectoryInfo().then(setDirInfo).catch(() => {});
  }, [isOpen, platformMode]);

  useEffect(() => {
    if (!inlineNotice) return;
    const t = setTimeout(() => setInlineNotice(''), 3000);
    return () => clearTimeout(t);
  }, [inlineNotice]);

  // Détection des manettes connectées
  useEffect(() => {
    const checkGamepads = () => {
      if (typeof navigator !== 'undefined' && navigator.getGamepads) {
        const gps = navigator.getGamepads();
        const gp = gps[0] || gps[1];
        setConnectedGamepad(gp ? gp.id : null);
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

      if (e.code === 'Escape') {
        setListeningAction(null);
        return;
      }

      if (updateConsoleKeyBinding) {
        updateConsoleKeyBinding(selectedConsoleId, activePlayer, listeningAction, e.code);
      } else {
        updateKeyBinding(activePlayer, listeningAction, e.code);
      }
      setListeningAction(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePlayer, listeningAction, selectedConsoleId, updateConsoleKeyBinding, updateKeyBinding]);

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

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const resolveTarget = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl && fsEl.tagName !== 'IFRAME') {
        setPortalTarget(fsEl);
      } else {
        if (fsEl?.tagName === 'IFRAME') {
          try {
            (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
          } catch {}
        }
        setPortalTarget(document.body);
      }
    };
    resolveTarget();
    document.addEventListener('fullscreenchange', resolveTarget);
    document.addEventListener('webkitfullscreenchange', resolveTarget);
    return () => {
      document.removeEventListener('fullscreenchange', resolveTarget);
      document.removeEventListener('webkitfullscreenchange', resolveTarget);
    };
  }, [isOpen]);

  if (!isOpen || !portalTarget) return null;

  const selectedConsoleProfile = getConsoleControlProfile(selectedConsoleId);
  const universeTheme = getUniverseTheme(platformMode);
  const activeKeyboardMap =
    settings?.consoleControls?.[selectedConsoleId]?.keyboard?.[activePlayer] ||
    settings?.controls?.[activePlayer] ||
    {};

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-end md:items-center justify-center bg-black/80 backdrop-blur-md p-0 md:p-4 font-sans select-none cursor-pointer"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div
        className="relative w-full max-w-4xl bg-neutral-900 border-t md:border border-white/15 rounded-t-3xl md:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[94dvh] md:h-[82dvh] pb-safe cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modale — Thématisé par la console active */}
        <div className="u-banner px-4 sm:px-6 py-3.5 sm:py-4 border-b flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl u-badge flex items-center justify-center shrink-0">
              <Sliders className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3
                  id="settings-modal-title"
                  className="text-sm sm:text-base font-black text-white tracking-tight truncate"
                >
                  {universeTheme.settingsTitle}
                </h3>
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md u-badge text-[10px] font-mono font-bold shrink-0">
                  {universeTheme.symbols ? (
                    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
                      {universeTheme.symbols.map((s) => (
                        <span key={s.label} style={{ color: s.color }}>{s.glyph}</span>
                      ))}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
                      {universeTheme.jewels.map((hex, i) => (
                        <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: hex }} />
                      ))}
                    </span>
                  )}
                  <span>{universeTheme.hardwareTag}</span>
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-neutral-300 truncate mt-0.5">
                {universeTheme.settingsSubtitle}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer les paramètres"
            title="Fermer (Échap)"
            className="arcade-focus-ring p-2 min-w-[44px] min-h-[44px] rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-neutral-200 hover:text-white flex items-center justify-center transition-colors shrink-0"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Navigation Mobile (< md) — Pilules horizontales tactiles 44px */}
        <div className="md:hidden relative border-b border-white/10 bg-neutral-950/90 shrink-0">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar px-3 py-2 pr-8">
            {NAV_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    setListeningAction(null);
                  }}
                  className={`arcade-focus-ring px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-bold shrink-0 flex items-center gap-1.5 border transition-all ${
                    active
                      ? 'u-btn-primary'
                      : 'bg-neutral-900 border-white/10 text-neutral-200 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{tab.short}</span>
                </button>
              );
            })}
          </div>
          <div
            className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-neutral-950 to-transparent"
            aria-hidden="true"
          />
        </div>

        {/* Corps principal : Sidebar gauche (Desktop md+) + Contenu scrollable */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Sidebar Desktop (md+) */}
          <aside className="hidden md:flex w-60 shrink-0 flex-col gap-1.5 p-3 border-r border-white/10 bg-neutral-950/60 overflow-y-auto">
            {NAV_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    setListeningAction(null);
                  }}
                  className={`arcade-focus-ring w-full text-left px-3 py-2.5 rounded-2xl border transition-all flex items-center gap-3 ${
                    active
                      ? 'u-tab-active'
                      : 'border-transparent text-neutral-300 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                      active ? 'bg-black/30' : 'bg-white/5'
                    }`}
                  >
                    <Icon className="w-4 h-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold leading-tight truncate">{tab.label}</div>
                    <div className="text-[10px] text-neutral-400 truncate mt-0.5">{tab.desc}</div>
                  </div>
                </button>
              );
            })}

            {/* Carte statut manette en bas de sidebar */}
            <div className="mt-auto pt-3 border-t border-white/10">
              <div className="p-3 rounded-2xl bg-neutral-900/90 border border-white/10 space-y-1">
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                  <Gamepad2 className="w-3.5 h-3.5 u-accent-text" aria-hidden="true" />
                  <span>Manette détectée</span>
                </div>
                <div className="text-xs font-semibold truncate text-neutral-200" title={connectedGamepad || 'Aucune'}>
                  {connectedGamepad ? (
                    <span className="text-emerald-300">{connectedGamepad}</span>
                  ) : (
                    <span className="text-neutral-400">Aucune manette active</span>
                  )}
                </div>
              </div>
            </div>
          </aside>

          {/* Panneau de contenu actif */}
          <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
            {inlineNotice && (
              <div className="px-3.5 py-2.5 rounded-xl bg-emerald-950/70 border border-emerald-500/40 text-emerald-200 text-xs font-semibold flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                <span>{inlineNotice}</span>
              </div>
            )}

            {/* ================= ONGLET 1 : CONTRÔLES ================= */}
            {activeTab === 'controls' && (
              <div className="space-y-4">
                {/* Sous-navigation Contrôles : Tactile / Manette / Clavier */}
                <div className="grid grid-cols-3 gap-1.5 p-1.5 bg-neutral-950 rounded-2xl border border-white/10 text-xs font-bold">
                  {[
                    { id: 'touch', full: 'Tactile Mobile', short: 'Tactile', icon: Smartphone },
                    { id: 'gamepad', full: 'Manette BT/USB', short: 'Manette', icon: Gamepad2 },
                    { id: 'keyboard', full: 'Clavier (P1/P2)', short: 'Clavier', icon: Keyboard },
                  ].map((sub) => {
                    const SubIcon = sub.icon;
                    const active = controlSubTab === sub.id;
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => setControlSubTab(sub.id)}
                        className={`arcade-focus-ring py-2 px-2.5 min-h-[42px] rounded-xl flex items-center justify-center gap-1.5 transition-all ${
                          active
                            ? 'u-btn-primary'
                            : 'text-neutral-300 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <SubIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span className="hidden sm:inline">{sub.full}</span>
                        <span className="sm:hidden">{sub.short}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Sélecteur de Console pour Manette & Clavier (scrollable sur mobile) */}
                {(controlSubTab === 'gamepad' || controlSubTab === 'keyboard') && (
                  <div className="p-3.5 rounded-2xl bg-neutral-950/80 border border-white/10 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-300 font-semibold">
                        Console ({controlSubTab === 'keyboard' ? 'Clavier' : 'Manette'})
                      </span>
                      {resetConsoleControls && (
                        <button
                          type="button"
                          onClick={() => {
                            resetConsoleControls(selectedConsoleId);
                            setListeningAction(null);
                            setInlineNotice(`Touches ${selectedConsoleProfile.shortLabel} réinitialisées.`);
                          }}
                          className="arcade-focus-ring px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-[11px] font-bold text-amber-300 flex items-center gap-1"
                        >
                          <RotateCcw className="w-3 h-3" aria-hidden="true" />
                          <span>Réinitialiser {selectedConsoleProfile.shortLabel}</span>
                        </button>
                      )}
                    </div>
                    <div className="flex sm:grid sm:grid-cols-5 gap-1.5 overflow-x-auto no-scrollbar">
                      {CONSOLE_CONTROL_PROFILES.map((prof) => {
                        const active = prof.id === selectedConsoleId;
                        return (
                          <button
                            key={prof.id}
                            type="button"
                            onClick={() => {
                              setSelectedConsoleId(prof.id);
                              setListeningAction(null);
                            }}
                            className={`arcade-focus-ring py-2 px-3 min-h-[40px] rounded-xl text-xs font-bold border transition-all shrink-0 truncate ${
                              active
                                ? 'u-tab-active'
                                : 'bg-neutral-900 border-white/10 text-neutral-300 hover:text-white hover:border-white/25'
                            }`}
                            title={prof.description}
                          >
                            {prof.shortLabel}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-neutral-400">
                      {selectedConsoleProfile.description}
                    </p>
                  </div>
                )}

                {/* Sous-onglet : MANETTE INTERACTIVE */}
                {controlSubTab === 'gamepad' && (
                  <GamepadVisualizer
                    settings={settings}
                    onUpdateGamepadSetting={updateGamepadSetting}
                    consoleProfile={selectedConsoleProfile}
                    consoleGamepadButtons={settings?.consoleControls?.[selectedConsoleId]?.gamepad || {}}
                    onUpdateConsoleGamepadButton={(actionKey, physIdx) =>
                      updateConsoleGamepadBinding?.(selectedConsoleId, actionKey, physIdx)
                    }
                  />
                )}

                {/* Sous-onglet : CLAVIER */}
                {controlSubTab === 'keyboard' && (
                  <div className="space-y-3.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap bg-neutral-950/80 p-2.5 rounded-2xl border border-white/10">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setActivePlayer('p1');
                            setListeningAction(null);
                          }}
                          className={`arcade-focus-ring px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold transition-all ${
                            activePlayer === 'p1'
                              ? 'u-btn-primary'
                              : 'bg-neutral-900 text-neutral-300 hover:text-white border border-white/10'
                          }`}
                        >
                          Joueur 1
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActivePlayer('p2');
                            setListeningAction(null);
                          }}
                          className={`arcade-focus-ring px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold transition-all ${
                            activePlayer === 'p2'
                              ? 'bg-rose-500 text-white shadow-sm'
                              : 'bg-neutral-900 text-neutral-300 hover:text-white border border-white/10'
                          }`}
                        >
                          Joueur 2
                        </button>
                      </div>
                      <span className="text-[11px] text-neutral-400">
                        Cliquez sur une touche pour la réassigner
                      </span>
                    </div>

                    {listeningAction && (
                      <div className="p-3.5 u-tab-active rounded-2xl text-center font-bold animate-pulse">
                        Appuyez sur une touche pour [{selectedConsoleProfile.label}] « {listeningAction.toUpperCase()} » (Échap pour annuler)…
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {selectedConsoleProfile.actions.map(({ key, label }) => {
                        const currentCode = activeKeyboardMap[key] || 'Non assigné';
                        const isListening = listeningAction === key;
                        return (
                          <div
                            key={key}
                            className="p-3 bg-neutral-950/80 border border-white/10 rounded-2xl flex items-center justify-between gap-2 hover:border-white/20 transition-colors"
                          >
                            <span className="text-neutral-200 text-xs font-semibold truncate">{label}</span>
                            <button
                              type="button"
                              onClick={() => setListeningAction(key)}
                              className={`arcade-focus-ring px-3 py-1.5 min-h-[38px] min-w-[72px] rounded-xl text-xs font-bold font-mono shrink-0 transition-all border ${
                                isListening
                                  ? 'u-btn-primary animate-pulse'
                                  : 'bg-neutral-900 hover:bg-neutral-800 border-white/15 text-white'
                              }`}
                            >
                              {isListening ? 'Écoute…' : String(currentCode).replace('Key', '').replace('Digit', '')}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Sous-onglet : TACTILE MOBILE */}
                {controlSubTab === 'touch' && (
                  <div className="space-y-3.5">
                    <div className="p-4 rounded-2xl u-banner border flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="text-xs sm:text-sm font-black text-white flex items-center gap-2">
                          <Smartphone className="w-4 h-4 u-accent-text shrink-0" aria-hidden="true" />
                          <span>Contrôleur Tactile &amp; Ergonomie</span>
                        </h4>
                        <p className="text-[11px] text-neutral-300 mt-0.5">
                          Personnalisez votre pad virtuel sur smartphone et tablette
                        </p>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg u-badge text-[10px] font-mono font-bold whitespace-nowrap shrink-0">
                        A · B · X · Y
                      </span>
                    </div>

                    <SettingsSwitch
                      icon={Vibrate}
                      label="Vibration Haptique"
                      description="Micro-vibration à chaque appui pour simuler de vrais boutons arcade"
                      checked={settings.touch?.vibration ?? true}
                      onChange={(val) => updateTouchSetting('vibration', val)}
                    />

                    {/* Opacité des Touches */}
                    <div className="p-3.5 rounded-2xl bg-neutral-950/80 border border-white/10 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                            <Eye className="w-4 h-4 u-accent-text" aria-hidden="true" />
                          </div>
                          <div>
                            <span className="font-bold text-neutral-100 block text-xs sm:text-[13px]">Opacité des Touches</span>
                            <span className="text-[11px] text-neutral-400">Transparence des contrôles sur l&apos;écran</span>
                          </div>
                        </div>
                        <span className="px-2.5 py-1 rounded-lg u-badge text-xs font-mono font-bold tabular-nums">
                          {settings.touch?.opacity ?? 75}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="20"
                        max="100"
                        step="5"
                        aria-label="Opacité des touches tactiles"
                        value={settings.touch?.opacity ?? 75}
                        onChange={(e) => updateTouchSetting('opacity', Number(e.target.value))}
                        style={{ accentColor: 'var(--u-accent)' }}
                        className="w-full cursor-pointer h-2 bg-neutral-800 rounded-lg"
                      />
                    </div>

                    {/* Taille des Touches */}
                    <div className="p-3.5 rounded-2xl bg-neutral-950/80 border border-white/10 space-y-2.5">
                      <span className="font-bold text-neutral-100 block text-xs sm:text-[13px]">
                        Taille des Boutons &amp; D-Pad
                      </span>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { val: 80, label: 'Compact', sub: '80%' },
                          { val: 100, label: 'Normal', sub: '100%' },
                          { val: 120, label: 'Grand', sub: '120%' },
                        ].map((item) => (
                          <button
                            key={item.val}
                            type="button"
                            onClick={() => updateTouchSetting('scale', item.val)}
                            className={`arcade-focus-ring py-2.5 px-2 min-h-[44px] rounded-xl text-xs font-bold border transition-all flex flex-col items-center justify-center ${
                              (settings.touch?.scale ?? 100) === item.val
                                ? 'u-tab-active'
                                : 'bg-neutral-900 border-white/10 text-neutral-300 hover:text-white'
                            }`}
                          >
                            <span>{item.label}</span>
                            <span className="text-[10px] font-mono opacity-80">{item.sub}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Type de Contrôle Directionnel */}
                    <div className="p-3.5 rounded-2xl bg-neutral-950/80 border border-white/10 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-neutral-100 text-xs sm:text-[13px]">Contrôle Directionnel</span>
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md u-badge">
                          {(settings.touch?.dpadType ?? 'analog') === 'dpad' ? 'CROIX D-PAD' : 'JOYSTICK'}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => updateTouchSetting('dpadType', 'dpad')}
                          className={`arcade-focus-ring p-3 min-h-[48px] rounded-xl border text-left transition-all ${
                            (settings.touch?.dpadType ?? 'analog') === 'dpad'
                              ? 'u-tab-active'
                              : 'bg-neutral-900 border-white/10 text-neutral-300 hover:text-white'
                          }`}
                        >
                          <span className="flex items-center gap-1.5 font-bold text-xs">
                            <Move className="w-3.5 h-3.5 u-accent-text shrink-0" aria-hidden="true" />
                            <span>Croix D-Pad Classique</span>
                          </span>
                          <span className="text-[11px] text-neutral-400 block mt-0.5">
                            Croix rétro précise 4/8 directions
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => updateTouchSetting('dpadType', 'analog')}
                          className={`arcade-focus-ring p-3 min-h-[48px] rounded-xl border text-left transition-all ${
                            (settings.touch?.dpadType ?? 'analog') === 'analog'
                              ? 'u-tab-active'
                              : 'bg-neutral-900 border-white/10 text-neutral-300 hover:text-white'
                          }`}
                        >
                          <span className="flex items-center gap-1.5 font-bold text-xs">
                            <Compass className="w-3.5 h-3.5 u-accent-text shrink-0" aria-hidden="true" />
                            <span>Joystick Analogue Virtuel</span>
                          </span>
                          <span className="text-[11px] text-neutral-400 block mt-0.5">
                            Stick rotatif 360° avec centrage
                          </span>
                        </button>
                      </div>

                      {(settings.touch?.dpadType ?? 'analog') === 'analog' && (
                        <div className="pt-2.5 border-t border-white/10 space-y-2">
                          <span className="text-[11px] text-neutral-300 block font-semibold">Comportement du stick :</span>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => updateTouchSetting('joystickMode', 'floating')}
                              className={`arcade-focus-ring py-2 px-3 min-h-[40px] rounded-xl text-xs font-bold border transition-all ${
                                (settings.touch?.joystickMode ?? 'floating') === 'floating'
                                  ? 'u-tab-active'
                                  : 'bg-neutral-900 border-white/10 text-neutral-300 hover:text-white'
                              }`}
                            >
                              Flottant (dynamique)
                            </button>
                            <button
                              type="button"
                              onClick={() => updateTouchSetting('joystickMode', 'fixed')}
                              className={`arcade-focus-ring py-2 px-3 min-h-[40px] rounded-xl text-xs font-bold border transition-all ${
                                (settings.touch?.joystickMode ?? 'floating') === 'fixed'
                                  ? 'u-tab-active'
                                  : 'bg-neutral-900 border-white/10 text-neutral-300 hover:text-white'
                              }`}
                            >
                              Position Fixe
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Guide & Macros 8 Touches */}
                    <div className="p-3.5 rounded-2xl bg-neutral-950/80 border border-white/10 space-y-3">
                      <div>
                        <span className="font-bold text-neutral-100 block text-xs sm:text-[13px]">
                          Boutons &amp; Macros Arcade (8 Touches)
                        </span>
                        <span className="text-[11px] text-neutral-400">
                          Disposition optimisée pour jeux de combat (KOF) et Metal Slug
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="p-2.5 rounded-xl bg-neutral-900 border border-white/10 flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-emerald-500 text-black font-black flex items-center justify-center text-[10px] shrink-0">A</span>
                          <div className="min-w-0">
                            <span className="font-bold text-emerald-300 block truncate">Bouton A</span>
                            <span className="text-neutral-400 text-[10px] block truncate">Poing faible · Tir</span>
                          </div>
                        </div>
                        <div className="p-2.5 rounded-xl bg-neutral-900 border border-white/10 flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-rose-500 text-white font-black flex items-center justify-center text-[10px] shrink-0">B</span>
                          <div className="min-w-0">
                            <span className="font-bold text-rose-300 block truncate">Bouton B</span>
                            <span className="text-neutral-400 text-[10px] block truncate">Pied faible · Saut</span>
                          </div>
                        </div>
                        <div className="p-2.5 rounded-xl bg-neutral-900 border border-white/10 flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-sky-400 text-black font-black flex items-center justify-center text-[10px] shrink-0">X</span>
                          <div className="min-w-0">
                            <span className="font-bold text-sky-300 block truncate">Bouton X (C)</span>
                            <span className="text-neutral-400 text-[10px] block truncate">Poing fort · Grenade</span>
                          </div>
                        </div>
                        <div className="p-2.5 rounded-xl bg-neutral-900 border border-white/10 flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-amber-400 text-black font-black flex items-center justify-center text-[10px] shrink-0">Y</span>
                          <div className="min-w-0">
                            <span className="font-bold text-amber-300 block truncate">Bouton Y (D)</span>
                            <span className="text-neutral-400 text-[10px] block truncate">Pied fort · Spécial</span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2 pt-1">
                        <SettingsSwitch
                          label="L1 — Macro A+B (Roulade / Esquive)"
                          description="Esquive rapide KOF '98 / '2002"
                          checked={settings.touch?.macroAbEnabled ?? true}
                          onChange={(val) => updateTouchSetting('macroAbEnabled', val)}
                        />
                        <SettingsSwitch
                          label="R1 — Macro C+D (Projection)"
                          description="Attaque lourde Blowback de repoussement"
                          checked={settings.touch?.macroCdEnabled ?? true}
                          onChange={(val) => updateTouchSetting('macroCdEnabled', val)}
                        />
                        <SettingsSwitch
                          icon={Zap}
                          accentTone="amber"
                          label="Turbo A — Tir Continu 30 Hz (Metal Slug)"
                          description="Tir automatique ultra-rapide tant que le bouton est maintenu"
                          checked={settings.touch?.turboEnabled ?? true}
                          onChange={(val) => updateTouchSetting('turboEnabled', val)}
                        />
                      </div>
                    </div>

                    {/* Disposition Portrait Smartphone */}
                    <div className="p-3.5 rounded-2xl bg-neutral-950/80 border border-white/10 space-y-2.5">
                      <span className="font-bold text-neutral-100 block text-xs sm:text-[13px]">
                        Disposition en Mode Portrait
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => updateTouchSetting('portraitMode', 'pad-bottom')}
                          className={`arcade-focus-ring p-3 min-h-[48px] rounded-xl border text-left transition-all ${
                            (settings.touch?.portraitMode ?? 'pad-bottom') === 'pad-bottom'
                              ? 'u-tab-active'
                              : 'bg-neutral-900 border-white/10 text-neutral-300 hover:text-white'
                          }`}
                        >
                          <span className="flex items-center gap-1.5 font-bold text-xs">
                            <Gamepad2 className="w-3.5 h-3.5 u-accent-text shrink-0" aria-hidden="true" />
                            <span>Arcade Pad Bas</span>
                          </span>
                          <span className="text-[11px] text-neutral-400 block mt-0.5">
                            Écran 4:3 en haut, manette en bas sans masquer le jeu
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => updateTouchSetting('portraitMode', 'overlay')}
                          className={`arcade-focus-ring p-3 min-h-[48px] rounded-xl border text-left transition-all ${
                            (settings.touch?.portraitMode ?? 'pad-bottom') === 'overlay'
                              ? 'u-tab-active'
                              : 'bg-neutral-900 border-white/10 text-neutral-300 hover:text-white'
                          }`}
                        >
                          <span className="flex items-center gap-1.5 font-bold text-xs">
                            <Smartphone className="w-3.5 h-3.5 u-accent-text shrink-0" aria-hidden="true" />
                            <span>Superposé</span>
                          </span>
                          <span className="text-[11px] text-neutral-400 block mt-0.5">
                            Contrôles transparents sur toute la hauteur
                          </span>
                        </button>
                      </div>
                    </div>

                    <SettingsSwitch
                      label="Masquer si Manette Connectée"
                      description="Cache automatiquement le tactile dès qu'une manette Bluetooth / USB est active"
                      checked={settings.touch?.autoHideOnGamepad ?? true}
                      onChange={(val) => updateTouchSetting('autoHideOnGamepad', val)}
                    />

                    <button
                      type="button"
                      onClick={() => {
                        try {
                          localStorage.removeItem('csw_touch_layout_v3');
                          updateTouchSetting('opacity', 75);
                          updateTouchSetting('scale', 100);
                          updateTouchSetting('vibration', true);
                          updateTouchSetting('portraitMode', 'pad-bottom');
                          setInlineNotice('Réglages et positions tactiles réinitialisés aux valeurs optimales.');
                        } catch {}
                      }}
                      className="arcade-focus-ring flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-white/10 text-neutral-100 text-xs font-bold transition-colors w-full"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Réinitialiser les réglages tactiles par défaut</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ================= ONGLET 2 : AFFICHAGE & CRT ================= */}
            {activeTab === 'video' && (
              <div className="space-y-4">
                {/* Apparence & Mode Clair / Sombre / Système */}
                <div className="p-4 rounded-2xl bg-neutral-950/80 border border-white/10 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Sun className="w-4 h-4 u-accent-text shrink-0" aria-hidden="true" />
                      <h4 className="font-bold text-white text-xs sm:text-[13px]">
                        Apparence de l&apos;interface
                      </h4>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-lg u-badge font-bold">
                      6 Univers Adaptatifs
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-400">
                    Adapte automatiquement les couleurs de chaque console tout en gardant l&apos;écran de jeu en mode cinéma sombre.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'dark', label: 'Sombre', sub: 'Néon Arcade', icon: Moon },
                      { id: 'light', label: 'Clair', sub: 'Jour Haute Lisibilité', icon: Sun },
                      { id: 'system', label: 'Système', sub: 'Auto OS', icon: Monitor },
                    ].map((opt) => {
                      const OptIcon = opt.icon;
                      const currentTheme = settings?.ui?.theme || 'dark';
                      const isActive = currentTheme === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => updateUiSetting?.('theme', opt.id)}
                          aria-pressed={isActive}
                          className={`arcade-focus-ring py-2.5 px-3 min-h-[48px] rounded-xl text-left border transition-all flex items-center gap-2.5 ${
                            isActive
                              ? 'u-tab-active'
                              : 'bg-neutral-900 border-white/10 text-neutral-300 hover:border-white/25'
                          }`}
                        >
                          <OptIcon className={`w-4 h-4 shrink-0 ${isActive ? 'u-accent-text' : 'text-neutral-400'}`} aria-hidden="true" />
                          <div className="min-w-0">
                            <span className="font-bold text-xs block truncate">{opt.label}</span>
                            <span className="text-[10px] text-neutral-400 block truncate">{opt.sub}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <SettingsSwitch
                  icon={ShieldAlert}
                  accentTone="amber"
                  label="Mode Stream (Streamlabs, OBS, enregistreur d'écran)"
                  description="Allège l'affichage (30 i/s visibles, résolution réduite, son 22 kHz) pour laisser la puissance à votre app de stream. S'applique au prochain lancement."
                  checked={!!settings.performance?.streamMode}
                  onChange={(val) => updatePerformanceSetting?.('streamMode', val)}
                />

                <SettingsSwitch
                  icon={Tv}
                  label="Filtre Scanlines CRT (Cathodique)"
                  description="Reproduit les lignes de balayage caractéristiques des bornes d'arcade des années 90."
                  checked={settings.video.scanlines}
                  onChange={(val) => updateVideoSetting('scanlines', val)}
                />

                {/* Textures & Shaders HD */}
                <div className="p-4 rounded-2xl bg-neutral-950/80 border border-white/10 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 u-accent-text shrink-0" aria-hidden="true" />
                      <h4 className="font-bold text-white text-xs sm:text-[13px]">
                        Textures &amp; Rendu Haute Définition
                      </h4>
                    </div>
                    <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-lg u-badge font-bold">
                      Profil : {currentProfile.label}
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-400 leading-relaxed">
                    Lissage HD des sprites, rendu borne rétro ou écran CRT incurvé. Les shaders avancés nécessitent un GPU plus puissant.
                  </p>

                  {isStreamMode && (
                    <div className="p-3 rounded-xl bg-amber-950/60 border border-amber-500/50 flex items-center gap-2 text-amber-200 text-[11px]">
                      <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" aria-hidden="true" />
                      <span>Mode Stream actif : textures lourdes désactivées pour préserver le GPU.</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    {SHADER_PRESETS.map((preset) => {
                      const isSelected = currentShaderId === preset.id;
                      const isLockedByStream = isStreamMode && preset.id !== 'none';
                      const isDemanding = preset.tier > currentProfile.maxShaderTier;

                      return (
                        <button
                          key={preset.id}
                          type="button"
                          disabled={isLockedByStream}
                          onClick={() => updateVideoSetting('shader', preset.id)}
                          className={`arcade-focus-ring p-3.5 rounded-2xl border text-left transition-all flex flex-col justify-between ${
                            isLockedByStream
                              ? 'opacity-40 cursor-not-allowed bg-neutral-900/50 border-white/5'
                              : isSelected
                              ? 'u-tab-active'
                              : 'bg-neutral-900/90 border-white/10 text-neutral-200 hover:border-white/25'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-xs text-white">{preset.label}</span>
                              {isSelected && <Check className="w-3.5 h-3.5 u-accent-text shrink-0" aria-hidden="true" />}
                            </div>
                            <span
                              className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                                preset.tier === 1
                                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/35'
                                  : preset.tier === 2
                                  ? 'u-badge'
                                  : 'bg-purple-950/80 text-purple-200 border border-purple-500/35'
                              }`}
                            >
                              {preset.badge}
                            </span>
                          </div>
                          <p className="text-[11px] text-neutral-400 leading-snug mb-2">{preset.desc}</p>
                          <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400 pt-1.5 border-t border-white/10">
                            <span>
                              GPU :{' '}
                              <b className={preset.tier === 1 ? 'text-emerald-400' : preset.tier === 2 ? 'text-amber-300' : 'text-rose-400'}>
                                {preset.cost}
                              </b>
                            </span>
                            {isDemanding && !isLockedByStream && (
                              <span className="text-amber-300 font-sans font-bold">Appareil puissant requis</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Ratio d'Aspect */}
                <div className="p-4 rounded-2xl bg-neutral-950/80 border border-white/10 space-y-2.5">
                  <h4 className="font-bold text-white text-xs sm:text-[13px]">Ratio d&apos;Aspect de l&apos;Écran</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {[
                      { id: '4:3', label: '4:3 Arcade', sub: 'Ratio authentique' },
                      { id: '16:9', label: '16:9 Plein Écran', sub: 'Image étirée' },
                      { id: 'pixel-perfect', label: '1:1 Pixel Perfect', sub: 'Netteté exacte' },
                    ].map((ratio) => (
                      <button
                        key={ratio.id}
                        type="button"
                        onClick={() => updateVideoSetting('aspectRatio', ratio.id)}
                        className={`arcade-focus-ring py-2.5 px-3 min-h-[44px] rounded-xl text-left border transition-all ${
                          settings.video.aspectRatio === ratio.id
                            ? 'u-tab-active'
                            : 'bg-neutral-900 border-white/10 text-neutral-300 hover:text-white'
                        }`}
                      >
                        <span className="font-bold text-xs block">{ratio.label}</span>
                        <span className="text-[10px] text-neutral-400">{ratio.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Lissage Graphique */}
                <div className="p-4 rounded-2xl bg-neutral-950/80 border border-white/10 space-y-2.5">
                  <h4 className="font-bold text-white text-xs sm:text-[13px]">Lissage Graphique</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {[
                      { id: 'pixelated', label: 'Pixel Art Brut', sub: 'Sharp Nearest-Neighbor' },
                      { id: 'smooth', label: 'Lissé Bilinéaire', sub: 'Bilinear Interpolation' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => updateVideoSetting('filter', f.id)}
                        className={`arcade-focus-ring py-2.5 px-3 min-h-[44px] rounded-xl text-left border transition-all ${
                          settings.video.filter === f.id
                            ? 'u-tab-active'
                            : 'bg-neutral-900 border-white/10 text-neutral-300 hover:text-white'
                        }`}
                      >
                        <span className="font-bold text-xs block">{f.label}</span>
                        <span className="text-[10px] text-neutral-400">{f.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ================= ONGLET 3 : AUDIO ================= */}
            {activeTab === 'audio' && (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-neutral-950/80 border border-white/10 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                        <Volume2 className="w-4 h-4 u-accent-text" aria-hidden="true" />
                      </div>
                      <div>
                        <span className="font-bold text-white block text-xs sm:text-[13px]">
                          Volume Général de l&apos;Émulateur
                        </span>
                        <span className="text-[11px] text-neutral-400">Sortie Web Audio API</span>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg u-badge font-mono font-bold text-xs tabular-nums">
                      {settings.audio.volume}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    aria-label="Volume général"
                    value={settings.audio.volume}
                    onChange={(e) => updateAudioSetting('volume', Number(e.target.value))}
                    style={{ accentColor: 'var(--u-accent)' }}
                    className="w-full cursor-pointer h-2 bg-neutral-800 rounded-lg"
                  />
                </div>

                <SettingsSwitch
                  icon={settings.audio.muted ? VolumeX : Volume2}
                  label="Couper le Son (Mute)"
                  description="Désactive temporairement la sortie audio de tous les émulateurs"
                  checked={Boolean(settings.audio.muted)}
                  onChange={(val) => updateAudioSetting('muted', val)}
                />

                {/* Chat Vocal CSW Arcade (VPS · Opus 24 kbps) */}
                <div className="p-4 rounded-2xl bg-neutral-950/80 border border-white/10 space-y-3.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Headphones className="w-4 h-4 u-accent-text shrink-0" aria-hidden="true" />
                      <h4 className="font-bold text-white text-xs sm:text-[13px]">
                        Chat Vocal (CSW Arcade · VPS)
                      </h4>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-lg u-badge font-bold">
                      Opus 24 kbps · Zéro Lag
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-400">
                    Discutez dès le salon jusqu&apos;en pleine partie sans coupure. Choisissez qui peut vous inviter ou vous parler.
                  </p>

                  {/* Confidentialité */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-bold text-neutral-200 block">
                      Qui peut me parler / m&apos;inviter en vocal ?
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: 'everyone', label: 'Tout le monde', sub: 'Salons, matchs & amis' },
                        { id: 'friends', label: 'Amis uniquement', sub: 'Recommandé' },
                        { id: 'party', label: 'Groupe uniquement', sub: 'Invités du groupe' },
                        { id: 'off', label: 'Désactivé', sub: 'Personne' },
                      ].map((opt) => {
                        const cur = settings?.voice?.privacy || 'friends';
                        const active = cur === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => updateVoiceSetting?.('privacy', opt.id)}
                            aria-pressed={active}
                            className={`arcade-focus-ring py-2 px-3 min-h-[44px] rounded-xl text-left border transition-all ${
                              active
                                ? 'u-tab-active'
                                : 'bg-neutral-900 border-white/10 text-neutral-300 hover:border-white/25'
                            }`}
                          >
                            <span className="font-bold text-xs block">{opt.label}</span>
                            <span className="text-[10px] text-neutral-400 block">{opt.sub}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Mode Microphone */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-bold text-neutral-200 block">
                      Mode Microphone
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: 'open', label: 'Micro Ouvert', sub: 'Détection vocale auto' },
                        { id: 'ptt', label: 'Appuyer pour parler', sub: 'Touche V / Bouton tactile' },
                      ].map((opt) => {
                        const cur = settings?.voice?.micMode || 'open';
                        const active = cur === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => updateVoiceSetting?.('micMode', opt.id)}
                            aria-pressed={active}
                            className={`arcade-focus-ring py-2 px-3 min-h-[44px] rounded-xl text-left border transition-all ${
                              active
                                ? 'u-tab-active'
                                : 'bg-neutral-900 border-white/10 text-neutral-300 hover:border-white/25'
                            }`}
                          >
                            <span className="font-bold text-xs block">{opt.label}</span>
                            <span className="text-[10px] text-neutral-400 block">{opt.sub}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Volume Chat Vocal */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-neutral-200">Volume des voix</span>
                      <span className="font-mono u-accent-text font-bold tabular-nums">
                        {settings?.voice?.volume ?? 85}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      aria-label="Volume du chat vocal"
                      value={settings?.voice?.volume ?? 85}
                      onChange={(e) => updateVoiceSetting?.('volume', Number(e.target.value))}
                      style={{ accentColor: 'var(--u-accent)' }}
                      className="w-full cursor-pointer h-2 bg-neutral-800 rounded-lg"
                    />
                  </div>

                  <SettingsSwitch
                    icon={MicOff}
                    label="Micro coupé par défaut à l'entrée"
                    description="Vous rejoignez les groupes vocaux en silencieux jusqu'à ce que vous activiez votre micro."
                    checked={Boolean(settings?.voice?.defaultMuted)}
                    onChange={(val) => updateVoiceSetting?.('defaultMuted', val)}
                  />
                </div>
              </div>
            )}

            {/* ================= ONGLET 4 : SYSTÈME & BIOS ================= */}
            {activeTab === 'system' && (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-neutral-950/80 border border-white/10 space-y-3">
                  <div>
                    <h4 className="font-bold text-white text-xs sm:text-[13px]">Mode Matériel Neo Geo (MVS / AES)</h4>
                    <p className="text-[11px] text-neutral-400 mt-0.5">
                      Basculez entre la borne d&apos;arcade originale (crédits) et la console de salon (Free Play).
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {[
                      { id: 'mvs', title: 'Arcade (MVS)', desc: "Exige l'insertion de Coins / Crédits" },
                      { id: 'aes', title: 'Console (AES)', desc: 'Mode Free Play & Options SNK' },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => updateSystemSetting('biosMode', m.id)}
                        className={`arcade-focus-ring p-3.5 min-h-[52px] rounded-xl border text-left transition-all ${
                          settings.system.biosMode === m.id
                            ? 'u-tab-active'
                            : 'bg-neutral-900 border-white/10 text-neutral-300 hover:text-white'
                        }`}
                      >
                        <span className="font-bold block text-xs text-white">{m.title}</span>
                        <span className="text-[11px] text-neutral-400">{m.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-neutral-950/80 border border-white/10 space-y-2.5">
                  <div>
                    <h4 className="font-bold text-white text-xs sm:text-[13px]">Région / Continent (BIOS &amp; Serveur)</h4>
                    <p className="text-[11px] text-neutral-400 mt-0.5">
                      Adapte le standard BIOS (PAL / NTSC) et la région affichée selon votre continent.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[
                      { id: 'africa', label: 'Afrique', sub: 'PAL · 50/60 Hz' },
                      { id: 'europe', label: 'Europe', sub: 'PAL · 50/60 Hz' },
                      { id: 'north_america', label: 'Amérique du Nord', sub: 'NTSC-U · 60 Hz' },
                      { id: 'south_america', label: 'Amérique du Sud', sub: 'NTSC · 60 Hz' },
                      { id: 'asia', label: 'Asie', sub: 'NTSC-J · 60 Hz' },
                      { id: 'oceania', label: 'Océanie', sub: 'PAL · 50/60 Hz' },
                    ].map((reg) => {
                      const cur = settings.system.region || 'europe';
                      const isSelected =
                        cur === reg.id ||
                        (cur === 'usa' && reg.id === 'north_america') ||
                        (cur === 'japan' && reg.id === 'asia');
                      return (
                        <button
                          key={reg.id}
                          type="button"
                          onClick={() => updateSystemSetting('region', reg.id)}
                          className={`arcade-focus-ring py-2.5 px-3 min-h-[48px] rounded-xl text-left border transition-all ${
                            isSelected
                              ? 'u-tab-active'
                              : 'bg-neutral-900 border-white/10 text-neutral-300 hover:text-white'
                          }`}
                        >
                          <span className="font-bold text-xs block">{reg.label}</span>
                          <span className="text-[10px] text-neutral-400 block">{reg.sub}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ================= ONGLET 5 : SALON & CACHE ================= */}
            {activeTab === 'netplay' && (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-neutral-950/80 border border-white/10 space-y-2.5">
                  <label htmlFor="settings-player-name" className="font-bold text-white text-xs sm:text-[13px] block">
                    Pseudo dans les Salons CSW Arcade
                  </label>
                  <input
                    id="settings-player-name"
                    type="text"
                    value={playerName}
                    onChange={(e) => {
                      setPlayerName(e.target.value);
                      setPlayerDisplayName(e.target.value);
                    }}
                    maxLength={24}
                    placeholder="Votre pseudo dans les salons…"
                    className="arcade-focus-ring w-full px-3.5 py-2.5 min-h-[44px] rounded-xl bg-neutral-900 border border-white/15 text-sm sm:text-xs text-white placeholder:text-neutral-400"
                  />
                </div>

                <div className="p-4 rounded-2xl bg-neutral-950/80 border border-white/10 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <h4 className="font-bold text-white text-xs sm:text-[13px]">WebRTC Rollback P2P</h4>
                      <p className="text-[11px] text-neutral-400">Input Delay par défaut (0 à 3 frames)</p>
                    </div>
                    <div className="flex gap-1.5">
                      {[0, 1, 2, 3].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => updateNetplaySetting?.('inputDelay', d)}
                          className={`arcade-focus-ring px-3 py-2 min-w-[42px] min-h-[40px] rounded-xl font-mono text-xs font-bold border transition-all ${
                            (settings?.netplay?.inputDelay ?? 1) === d
                              ? 'u-btn-primary'
                              : 'bg-neutral-900 border-white/10 text-neutral-300 hover:text-white'
                          }`}
                        >
                          {d}f
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <SettingsSwitch
                  label="Afficher le HUD Réseau (PING | ROLLBACK | P2P)"
                  description="Affiche la latence et les statistiques Rollback en temps réel pendant les matchs"
                  checked={settings?.netplay?.showHud ?? true}
                  onChange={(val) => updateNetplaySetting?.('showHud', val)}
                />

                <SettingsSwitch
                  label="Son d'alerte lors d'un défi CSW Arcade"
                  description="Joue une notification sonore lorsqu'un joueur vous défie au salon"
                  checked={settings?.netplay?.challengeSound ?? true}
                  onChange={(val) => updateNetplaySetting?.('challengeSound', val)}
                />
              </div>
            )}

            {activeTab === 'storage' && (
              <div className="space-y-4">
                {/* Gestion du cache IndexedDB */}
                <div className="p-4 rounded-2xl bg-neutral-950/80 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center shrink-0">
                      <Database className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                    </div>
                    <div>
                      <div className="font-bold text-white text-xs sm:text-[13px]">Cache ROMs IndexedDB</div>
                      <div className="text-[11px] font-mono text-neutral-300 tabular-nums">
                        {cacheInfo.count} jeu(x) · {formatBytes(cacheInfo.totalBytes)}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => getPlatformCacheStats().then(setCacheInfo)}
                      className="arcade-focus-ring flex-1 sm:flex-initial px-3.5 py-2 min-h-[42px] rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-white/10 text-xs font-bold text-neutral-100 transition-colors"
                    >
                      Actualiser
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const rows = await listCachedRoms();
                        for (const r of rows) await removeCachedRom(r.id);
                        const stats = await getPlatformCacheStats();
                        setCacheInfo(stats);
                        onCacheCleared?.();
                        setInlineNotice('Cache IndexedDB vidé avec succès.');
                      }}
                      className="arcade-focus-ring flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[42px] rounded-xl bg-rose-600/20 hover:bg-rose-600/35 border border-rose-500/45 text-rose-200 text-xs font-bold transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Vider</span>
                    </button>
                  </div>
                </div>

                {/* Dossier ROMs Partagé (Multi-navigateurs : macOS, Windows, Android, iOS) */}
                <div className="p-4 rounded-2xl bg-neutral-950/80 border border-white/10 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/35 flex items-center justify-center shrink-0 mt-0.5">
                        <FolderOpen className="w-4 h-4 text-sky-400" aria-hidden="true" />
                      </div>
                      <div>
                        <div className="font-bold text-white text-xs sm:text-[13px]">
                          Dossier ROMs Partagé (Multi-navigateurs)
                        </div>
                        <div className="text-[11px] font-mono text-neutral-300 tabular-nums mt-0.5">
                          {arcadeStats.count} archive(s) Arcade · {arcadeStats.totalMB} Mo
                        </div>
                        <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
                          {dirInfo.supported
                            ? 'Liez un dossier sur votre appareil : chaque ROM téléchargée y est enregistrée et vous retrouvez vos jeux en changeant de navigateur.'
                            : 'Sur Android, iOS ou Safari, importez vos fichiers .zip depuis votre dossier Fichiers / iCloud Drive sans rien re-télécharger.'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {dirInfo.supported && dirInfo.configured && (
                    <div className="px-3 py-2.5 rounded-xl bg-neutral-900/90 border border-white/10 flex items-center justify-between gap-2 flex-wrap">
                      <div className="text-xs text-neutral-200 flex items-center gap-2 min-w-0">
                        <FolderOpen className="w-3.5 h-3.5 text-sky-400 shrink-0" aria-hidden="true" />
                        <span className="truncate font-semibold">{dirInfo.name}</span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                            dirInfo.permission === 'granted'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {dirInfo.permission === 'granted' ? 'Connecté' : 'À réautoriser'}
                        </span>
                      </div>
                      <div className="flex gap-1.5">
                        {dirInfo.permission !== 'granted' ? (
                          <button
                            type="button"
                            disabled={isSyncingRoms}
                            onClick={async () => {
                              setIsSyncingRoms(true);
                              try {
                                const res = await romStorage.reauthorizeDirectory();
                                const [info, stats] = await Promise.all([
                                  romStorage.getSavedDirectoryInfo(),
                                  romStorage.getStorageStats(),
                                ]);
                                setDirInfo(info);
                                setArcadeStats(stats);
                                if (res.granted) {
                                  setInlineNotice(`Dossier réautorisé : ${res.imported} importée(s), ${res.exported} exportée(s).`);
                                }
                              } finally {
                                setIsSyncingRoms(false);
                              }
                            }}
                            className="arcade-focus-ring px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-[11px] font-bold transition-colors"
                          >
                            Réautoriser
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isSyncingRoms}
                            onClick={async () => {
                              setIsSyncingRoms(true);
                              try {
                                const res = await romStorage.syncWithDirectory();
                                const stats = await romStorage.getStorageStats();
                                setArcadeStats(stats);
                                setInlineNotice(`Synchronisé : ${res.imported} importée(s), ${res.exported} exportée(s).`);
                              } finally {
                                setIsSyncingRoms(false);
                              }
                            }}
                            className="arcade-focus-ring flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-white/10 text-neutral-200 text-[11px] font-bold transition-colors"
                          >
                            <RefreshCw className={`w-3 h-3 ${isSyncingRoms ? 'animate-spin' : ''}`} aria-hidden="true" />
                            <span>Sync</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={async () => {
                            await romStorage.clearDirectory();
                            setDirInfo(await romStorage.getSavedDirectoryInfo());
                            setInlineNotice('Dossier dissocié (vos fichiers restent sur le disque).');
                          }}
                          className="arcade-focus-ring px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-rose-950/50 border border-white/10 hover:border-rose-500/40 text-neutral-300 hover:text-rose-200 text-[11px] font-bold transition-colors"
                        >
                          Dissocier
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {dirInfo.supported && (
                      <button
                        type="button"
                        disabled={isSyncingRoms}
                        onClick={async () => {
                          setIsSyncingRoms(true);
                          try {
                            const res = await romStorage.pickRomsDirectory();
                            const [info, stats] = await Promise.all([
                              romStorage.getSavedDirectoryInfo(),
                              romStorage.getStorageStats(),
                            ]);
                            setDirInfo(info);
                            setArcadeStats(stats);
                            setInlineNotice(`Dossier « ${res.name} » lié : ${res.imported} importée(s), ${res.exported} exportée(s).`);
                          } catch (err) {
                            if (err?.name !== 'AbortError') {
                              setInlineNotice(err?.message || 'Impossible de lier ce dossier.');
                            }
                          } finally {
                            setIsSyncingRoms(false);
                          }
                        }}
                        className="arcade-focus-ring flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[42px] rounded-xl u-btn-primary text-xs font-bold transition-all"
                      >
                        <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{dirInfo.configured ? 'Changer de dossier' : 'Choisir le dossier ROMs'}</span>
                      </button>
                    )}

                    <input
                      ref={romImportInputRef}
                      type="file"
                      multiple
                      accept=".zip,.7z,.nes,.sfc,.smc,.gba,.gb,.gbc,.n64,.z64,.v64,.md,.gen,.bin,.sms,.gg,.pce,.nds,.iso,.pbp,.chd,.jar"
                      className="hidden"
                      onChange={async (e) => {
                        const files = e.target.files;
                        if (!files || files.length === 0) return;
                        setIsSyncingRoms(true);
                        try {
                          const res = await romStorage.importFilesToStorage(files);
                          const stats = await romStorage.getStorageStats();
                          setArcadeStats(stats);
                          setInlineNotice(`${res.imported} ROM(s) importée(s) localement (${formatBytes(res.totalBytes)}).`);
                        } finally {
                          setIsSyncingRoms(false);
                          e.target.value = '';
                        }
                      }}
                    />

                    {dirInfo.supported && dirInfo.configured && (
                      <button
                        type="button"
                        disabled={isSyncingRoms}
                        onClick={async () => {
                          setIsSyncingRoms(true);
                          try {
                            const res = await restoreAllRomsFromDirectory();
                            const [pStats, aStats, info] = await Promise.all([
                              getPlatformCacheStats(),
                              romStorage.getStorageStats(),
                              romStorage.getSavedDirectoryInfo(),
                            ]);
                            setCacheInfo(pStats);
                            setArcadeStats(aStats);
                            setDirInfo(info);
                            onCacheCleared?.();
                            const totalRestored = (res.restoredPlatform || 0) + (res.restoredArcade || 0);
                            setInlineNotice(
                              totalRestored > 0
                                ? `${totalRestored} jeu(x) restauré(s) dans l’émulateur depuis « ${info.name} » (${formatBytes(res.totalBytes)}).`
                                : `Aucune nouvelle ROM à restaurer dans « ${info.name} ».`
                            );
                          } catch (err) {
                            setInlineNotice(err?.message || 'Erreur lors de la restauration des ROMs.');
                          } finally {
                            setIsSyncingRoms(false);
                          }
                        }}
                        className="arcade-focus-ring flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[42px] rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-colors"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isSyncingRoms ? 'animate-spin' : ''}`} aria-hidden="true" />
                        <span>Restaurer les ROMs</span>
                      </button>
                    )}

                    {dirInfo.supported && dirInfo.configured && (cacheInfo.count > 0 || Number(arcadeStats.count) > 0) && (
                      <button
                        type="button"
                        disabled={isSyncingRoms}
                        onClick={async () => {
                          setIsSyncingRoms(true);
                          try {
                            const res = await transferAllCacheToDirectory();
                            const [pStats, aStats, info] = await Promise.all([
                              getPlatformCacheStats(),
                              romStorage.getStorageStats(),
                              romStorage.getSavedDirectoryInfo(),
                            ]);
                            setCacheInfo(pStats);
                            setArcadeStats(aStats);
                            setDirInfo(info);
                            onCacheCleared?.();
                            if (res.failed > 0) {
                              setInlineNotice(
                                `${res.transferred} jeu(x) transféré(s) (${formatBytes(res.totalBytes)}), ${res.failed} échec(s) conservé(s) en cache.`
                              );
                            } else {
                              setInlineNotice(
                                `${res.transferred} jeu(x) transféré(s) vers « ${info.name} » (${formatBytes(res.totalBytes)}) et cache vidé.`
                              );
                            }
                          } catch (err) {
                            setInlineNotice(err?.message || 'Erreur lors du transfert vers le dossier.');
                          } finally {
                            setIsSyncingRoms(false);
                          }
                        }}
                        className="arcade-focus-ring flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[42px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors"
                      >
                        <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Transférer le cache vers le dossier &amp; vider</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={isSyncingRoms}
                      onClick={() => romImportInputRef.current?.click()}
                      className="arcade-focus-ring flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[42px] rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-white/10 text-xs font-bold text-neutral-100 transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Importer des ROMs (.zip)</span>
                    </button>

                    {arcadeStats.count > 0 && (
                      <button
                        type="button"
                        disabled={isSyncingRoms}
                        onClick={async () => {
                          setIsSyncingRoms(true);
                          try {
                            const count = await romStorage.exportAllSavedRoms();
                            setInlineNotice(`${count} archive(s) exportée(s) vers vos téléchargements.`);
                          } finally {
                            setIsSyncingRoms(false);
                          }
                        }}
                        className="arcade-focus-ring flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[42px] rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-white/10 text-xs font-bold text-neutral-100 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Exporter (.zip)</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions — Sticky, clair & tactile */}
        <div className="px-4 sm:px-6 py-3 border-t border-white/10 bg-neutral-950/90 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              handleReset?.();
              setInlineNotice("Paramètres d'usine restaurés.");
            }}
            className="arcade-focus-ring flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-xl text-neutral-300 hover:text-rose-300 hover:bg-rose-950/40 border border-transparent hover:border-rose-500/30 transition-colors text-xs font-semibold"
          >
            <RotateCcw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">Paramètres d&apos;Usine</span>
            <span className="sm:hidden">Réinitialiser</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="arcade-focus-ring px-5 py-2.5 min-h-[44px] rounded-xl u-btn-primary font-black text-xs transition-all active:scale-95 flex items-center gap-1.5"
          >
            <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Enregistrer &amp; Fermer</span>
          </button>
        </div>
      </div>
    </div>,
    portalTarget
  );
}
