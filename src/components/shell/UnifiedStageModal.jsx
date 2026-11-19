import React, { useEffect, useRef, useState } from 'react';
import {
  X, Maximize2, Minimize2, RotateCcw, Settings, Coins, Play, Sliders, Save, UploadCloud
} from 'lucide-react';
import { addCoins, setWalletCoins, subscribeWallet } from '../../services/walletService';

export function UnifiedStageModal({
  session,
  settings,
  p2pEngine = null,
  p2pStats = null,
  onInputDelayChange,
  onClose,
  onOpenSettings,
}) {
  const stageRef = useRef(null);
  const iframeRef = useRef(null);
  const [statusText, setStatusText] = useState('Initialisation…');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [filter, setFilter] = useState(settings?.video?.filter === 'smooth' ? 'smooth' : 'sharp');
  const [ratio, setRatio] = useState(settings?.video?.aspectRatio === '16:9' ? 'stretch' : 'fit');
  const [bootKey, setBootKey] = useState(0);
  const [coins, setCoins] = useState(0);
  const [coinLocked, setCoinLocked] = useState(false);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const [savedState, setSavedState] = useState(null);
  const [inputDelay, setInputDelay] = useState(p2pStats?.inputDelay ?? 1);

  useEffect(() => subscribeWallet(setCoins), []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Tab' && session) {
        e.preventDefault();
        setQuickMenuOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  useEffect(() => {
    if (!session || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { type: 'UPDATE_COINS', coins, locked: coinLocked, resume: !coinLocked },
      window.location.origin
    );
  }, [session, coins, coinLocked]);

  useEffect(() => {
    if (!session) return;
    setStatusText('Chargement du moteur…');
    setCoinLocked(false);

    const handleMessage = (event) => {
      if (event.source !== iframeRef.current?.contentWindow || !event.data) return;
      if (event.data.type === 'STAGE_FRAME_READY') {
        const bootMsg =
          session.kind === 'j2me'
            ? {
                type: 'BOOT_J2ME',
                gameName: session.title,
                filename: session.filename || session.fileBlob?.name || 'game.jar',
                fileBlob: session.fileBlob,
              }
            : {
                type: 'BOOT_EMU',
                core: session.core,
                gameName: session.title,
                filename: session.filename || session.fileBlob?.name || '',
                fileBlob: session.fileBlob,
                gameUrl: session.gameUrl || '',
                isNetplay: Boolean(session.isNetplay),
                playerIndex: session.playerIndex ?? 0,
                accent: session.accent || '#00f0ff',
                filter,
                ratio,
                volume: settings?.audio?.volume ?? 80,
                muted: Boolean(settings?.audio?.muted),
                localData: false,
              };
        iframeRef.current.contentWindow.postMessage(bootMsg, window.location.origin);
        iframeRef.current.contentWindow.postMessage(
          { type: 'UPDATE_COINS', coins, locked: false },
          window.location.origin
        );
      } else if (event.data.type === 'STAGE_STATUS') {
        if (event.data.message) setStatusText(event.data.message);
        if (event.data.status === 'playing') {
          try {
            iframeRef.current?.focus();
            if (
              session.isNetplay &&
              session.isHost &&
              p2pEngine &&
              ['psx', 'ps1', 'n64', 'nds'].includes(String(session.core).toLowerCase())
            ) {
              const stream = iframeRef.current?.contentWindow?.captureStageStream?.(30);
              if (stream) p2pEngine.attachMediaStream(stream);
            }
          } catch {
            /* noop */
          }
        }
      } else if (event.data.type === 'TOGGLE_QUICK_MENU') {
        setQuickMenuOpen((prev) => !prev);
      } else if (event.data.type === 'REQUEST_COIN_FROM_KEYBOARD') {
        sendButton('coin');
      } else if (event.data.type === 'SYNC_WALLET_FROM_RAM' && typeof event.data.coins === 'number') {
        const nextC = setWalletCoins(event.data.coins);
        if (nextC <= 0) setCoinLocked(true);
      } else if (event.data.type === 'NETPLAY_LOCAL_BTN') {
        p2pEngine?.sendButtonEvent?.(event.data.buttonIdx, event.data.pressed);
      } else if (event.data.type === 'STATE_EXPORTED' && event.data.stateBase64) {
        setSavedState(event.data.stateBase64);
        if (event.data.slot === 'frame0') {
          p2pEngine?.sendFrame0State?.(event.data.stateBase64);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [session, bootKey, p2pEngine]);

  // Pont P2P entrant : répercuter les inputs distants et le savestate Frame 0 dans l'iframe de l'émulateur
  useEffect(() => {
    if (!p2pEngine) return;
    p2pEngine.onRemoteButton = ({ buttonIdx, pressed }) => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'NETPLAY_REMOTE_BTN', buttonIdx, pressed },
        window.location.origin
      );
    };
    p2pEngine.onFrame0State = (stateBase64) => {
      if (stateBase64) {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'LOAD_STATE', stateBase64 },
          window.location.origin
        );
      }
    };
  }, [p2pEngine]);

  useEffect(() => {
    if (!session || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      {
        type: 'UPDATE_DISPLAY',
        filter,
        ratio,
        volume: settings?.audio?.volume ?? 80,
        muted: Boolean(settings?.audio?.muted),
      },
      window.location.origin
    );
  }, [session, filter, ratio, settings?.audio?.volume, settings?.audio?.muted]);

  if (!session) return null;

  const iframeSrc = session.kind === 'j2me' ? './app/stages/j2me-frame.html' : './app/stages/emu-frame.html';

  const sendButton = (button) => {
    if (button === 'coin') {
      const next = addCoins(1);
      setCoinLocked(false);
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.focus();
        iframeRef.current.contentWindow.postMessage(
          { type: 'UPDATE_COINS', coins: next, locked: false, resume: true },
          window.location.origin
        );
      }
      return;
    }
    if (!iframeRef.current?.contentWindow) return;
    iframeRef.current.focus();
    iframeRef.current.contentWindow.postMessage({ type: 'PRESS_BUTTON', button }, window.location.origin);
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen?.();
    } catch {
      /* noop */
    }
  };

  return (
    <div
      ref={stageRef}
      className="fixed inset-0 z-50 flex flex-col bg-neutral-950 text-neutral-100"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-neutral-900/95 border-b border-neutral-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-bold text-neutral-200 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            <span>Quitter</span>
          </button>
          <span className="font-bold text-sm text-white truncate">{session.title}</span>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-950 border border-cyan-700/60 text-cyan-300">
            {session.badge}
          </span>
          {p2pStats && (
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950/80 border border-emerald-600/50 text-emerald-300">
              PING: {p2pStats.pingMs}ms | ROLLBACK: {p2pStats.rollbackFrames}f | P2P
            </span>
          )}
          <span className="hidden xl:inline text-xs font-mono text-neutral-400 truncate">{statusText}</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="px-2.5 py-1 rounded-lg bg-amber-950/50 border border-amber-500/40 text-amber-300 text-xs font-mono font-bold">
            CRÉDITS SYNCHRONISÉS : {String(coins).padStart(2, '0')}/99
          </span>
          {session.kind !== 'j2me' && (
            <>
              <button
                type="button"
                onClick={() => {
                  if (iframeRef.current?.contentWindow) {
                    iframeRef.current.focus();
                    iframeRef.current.contentWindow.postMessage({ type: 'FORCE_SYNC_CREDITS' }, window.location.origin);
                  }
                }}
                title="Forcer la synchronisation des crédits dans la RAM (Touche 5)"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-bold transition-colors"
              >
                <Coins className="w-3.5 h-3.5" />
                <span>Sync Crédits (5)</span>
              </button>
              <button
                type="button"
                onClick={() => sendButton('start')}
                title="Démarrer / Start (Touche 1)"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Start (1)</span>
              </button>
              <button
                type="button"
                onClick={() => setFilter((f) => (f === 'smooth' ? 'sharp' : 'smooth'))}
                className="px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 transition-colors"
              >
                {filter === 'smooth' ? 'Lissé' : 'Pixel net'}
              </button>
              <button
                type="button"
                onClick={() => setRatio((r) => (r === 'stretch' ? 'fit' : 'stretch'))}
                className="px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 transition-colors"
              >
                {ratio === 'stretch' ? 'Étiré' : '4:3'}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setQuickMenuOpen((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-200 text-xs font-bold transition-colors"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Quick Menu (Tab)</span>
          </button>
          <button
            type="button"
            onClick={() => setBootKey((k) => k + 1)}
            className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors"
            title="Redémarrer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-bold transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isFullscreen ? 'Fenêtré' : 'Plein écran'}</span>
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            title="Paramètres"
            className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 bg-black relative overflow-hidden">
        <iframe
          key={`${session.title}-${bootKey}`}
          ref={iframeRef}
          src={iframeSrc}
          title={session.title}
          allow="autoplay; fullscreen; gamepad"
          className="w-full h-full border-0"
        />

        {/* Quick Menu Overlay (Style Guide Xbox / PS) */}
        {quickMenuOpen && (
          <aside className="absolute inset-y-0 right-0 w-80 max-w-full bg-neutral-950/92 backdrop-blur-xl border-l border-cyan-500/30 p-4 flex flex-col gap-4 z-40 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div>
                <h3 className="text-sm font-black text-white">QUICK MENU</h3>
                <p className="text-[11px] font-mono text-neutral-400">Guide en jeu · Tab pour fermer</p>
              </div>
              <button
                type="button"
                onClick={() => setQuickMenuOpen(false)}
                className="p-1.5 rounded-lg bg-neutral-800 text-neutral-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Portefeuille & Coins Synchronisés */}
            <div className="p-3 rounded-xl bg-amber-950/25 border border-amber-500/30 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-300">Crédits Synchronisés (RAM ↔ Salon)</span>
                <span className="font-mono text-sm font-black text-amber-200">{coins} / 99</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  addCoins(5);
                  setCoinLocked(false);
                }}
                className="w-full px-2.5 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-amber-300 text-xs font-bold border border-amber-500/30"
              >
                +5 Coins (Achat Test Salon)
              </button>
            </div>

            {/* Réseau & Input Delay */}
            <div className="p-3 rounded-xl bg-neutral-900 border border-neutral-800 space-y-2">
              <div className="text-xs font-bold text-cyan-300">Réseau & Rollback P2P</div>
              <div className="text-xs font-mono text-neutral-300">
                {p2pStats
                  ? `PING: ${p2pStats.pingMs}ms · ROLLBACK: ${p2pStats.rollbackFrames}f · ${p2pStats.p2pState}`
                  : 'Mode Local (Hors match P2P)'}
              </div>
              <label className="flex items-center justify-between text-xs text-neutral-300 pt-1">
                <span>Input Delay (0–3f)</span>
                <select
                  value={inputDelay}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setInputDelay(v);
                    onInputDelayChange?.(v);
                  }}
                  className="px-2 py-1 rounded bg-neutral-950 border border-neutral-700 text-xs text-white"
                >
                  <option value={0}>0 frame</option>
                  <option value={1}>1 frame</option>
                  <option value={2}>2 frames</option>
                  <option value={3}>3 frames</option>
                </select>
              </label>
            </div>

            {/* Savestate Rapide */}
            {session.kind !== 'j2me' && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => iframeRef.current?.contentWindow?.postMessage({ type: 'EXPORT_STATE' }, window.location.origin)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-bold text-white"
                >
                  <Save className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Sauver État</span>
                </button>
                <button
                  type="button"
                  disabled={!savedState}
                  onClick={() =>
                    savedState &&
                    iframeRef.current?.contentWindow?.postMessage(
                      { type: 'LOAD_STATE', stateBase64: savedState },
                      window.location.origin
                    )
                  }
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-xs font-bold text-white"
                >
                  <UploadCloud className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Charger État</span>
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="mt-auto w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors"
            >
              Quitter vers le salon
            </button>
          </aside>
        )}
      </div>
    </div>
  );
}
