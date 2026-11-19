import React, { useEffect, useRef, useState } from 'react';
import { X, Maximize2, Minimize2, RotateCcw, Settings, Coins, Play } from 'lucide-react';

export function UnifiedStageModal({ session, settings, onClose, onOpenSettings }) {
  const stageRef = useRef(null);
  const iframeRef = useRef(null);
  const [statusText, setStatusText] = useState('Initialisation…');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [filter, setFilter] = useState(settings?.video?.filter === 'smooth' ? 'smooth' : 'sharp');
  const [ratio, setRatio] = useState(settings?.video?.aspectRatio === '16:9' ? 'stretch' : 'fit');
  const [bootKey, setBootKey] = useState(0);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    if (!session) return;
    setStatusText('Chargement du moteur…');

    const handleMessage = (event) => {
      if (event.source !== iframeRef.current?.contentWindow || !event.data) return;
      if (event.data.type === 'STAGE_FRAME_READY') {
        const bootMsg =
          session.kind === 'j2me'
            ? {
                type: 'BOOT_J2ME',
                gameName: session.title,
                fileBlob: session.fileBlob,
              }
            : {
                type: 'BOOT_EMU',
                core: session.core,
                gameName: session.title,
                fileBlob: session.fileBlob,
                accent: session.accent || '#00f0ff',
                filter,
                ratio,
                volume: settings?.audio?.volume ?? 80,
                muted: Boolean(settings?.audio?.muted),
                localData: false,
              };
        iframeRef.current.contentWindow.postMessage(bootMsg, window.location.origin);
      } else if (event.data.type === 'STAGE_STATUS') {
        if (event.data.message) setStatusText(event.data.message);
        if (event.data.status === 'playing') {
          try {
            iframeRef.current?.focus();
          } catch {
            /* noop */
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [session, bootKey]);

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
          <span className="hidden md:inline text-xs font-mono text-neutral-400 truncate">{statusText}</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {session.kind !== 'j2me' && (
            <>
              <button
                type="button"
                onClick={() => sendButton('coin')}
                title="Insérer un crédit / Select (Touche 5)"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-bold transition-colors"
              >
                <Coins className="w-3.5 h-3.5" />
                <span>+ Crédit (5)</span>
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
                {filter === 'smooth' ? 'Filtre : Lissé' : 'Filtre : Pixel net'}
              </button>
              <button
                type="button"
                onClick={() => setRatio((r) => (r === 'stretch' ? 'fit' : 'stretch'))}
                className="px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 transition-colors"
              >
                {ratio === 'stretch' ? 'Format : Étiré' : 'Format : 4:3'}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setBootKey((k) => k + 1)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Redémarrer</span>
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

      <div className="flex-1 bg-black relative">
        <iframe
          key={`${session.title}-${bootKey}`}
          ref={iframeRef}
          src={iframeSrc}
          title={session.title}
          allow="autoplay; fullscreen; gamepad"
          className="w-full h-full border-0"
        />
      </div>
    </div>
  );
}
