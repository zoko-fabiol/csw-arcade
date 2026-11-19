import React from 'react';
import { Gamepad2, MessageSquare, X, AlertTriangle } from 'lucide-react';
import { GameCover } from './GameCover';

export function FightcadeChannelsDock({
  activeChannels = [],
  selectedChannelId = null,
  onSelectLibrary,
  onSelectChannel,
  onLeaveChannel,
  limitModalGame = null,
  onCloseLimitModal,
  onReplaceChannel,
}) {
  return (
    <>
      <nav
        className="w-16 sm:w-20 shrink-0 border-r border-neutral-800 bg-neutral-950 flex flex-col items-center py-3 gap-3 z-20"
        aria-label="Salons Fightcade 2 actifs (max 3)"
      >
        <button
          type="button"
          onClick={onSelectLibrary}
          title="Catalogue des jeux (Game Mode)"
          className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all border ${
            selectedChannelId === null
              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-lg shadow-cyan-500/20'
              : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-700'
          }`}
        >
          <Gamepad2 className="w-5 h-5" />
          <span className="text-[9px] font-bold">JEUX</span>
        </button>

        <div className="w-8 h-px bg-neutral-800" />

        <div className="text-[9px] font-mono text-neutral-500 uppercase">
          {activeChannels.length}/3
        </div>

        <div className="flex-1 flex flex-col gap-2.5 w-full items-center overflow-y-auto px-1">
          {activeChannels.map((ch) => {
            const active = selectedChannelId === ch.gameId;
            return (
              <div key={ch.gameId} className="relative group">
                <button
                  type="button"
                  onClick={() => onSelectChannel(ch.gameId)}
                  title={`${ch.title} (${ch.platformLabel})`}
                  className={`w-12 h-12 rounded-xl overflow-hidden border-2 transition-all flex items-center justify-center bg-neutral-900 ${
                    active
                      ? 'border-cyan-400 shadow-lg shadow-cyan-500/30 scale-105'
                      : 'border-neutral-800 hover:border-neutral-600'
                  }`}
                >
                  <GameCover
                    title={ch.title}
                    platformLabel={ch.platformLabel}
                    filename={ch.filename}
                    compact
                  />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onLeaveChannel(ch.gameId);
                  }}
                  title="Quitter ce salon"
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-neutral-900 border border-neutral-700 text-neutral-300 hover:bg-rose-600 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="text-[9px] font-mono text-neutral-600 flex flex-col items-center gap-0.5">
          <MessageSquare className="w-3.5 h-3.5" />
          <span>FC2</span>
        </div>
      </nav>

      {/* Alerte limite stricte de 3 salons actifs */}
      {limitModalGame && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-neutral-900 border border-amber-500/40 p-5 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-black text-white">Limite de 3 salons actifs atteinte</h3>
                <p className="text-xs text-neutral-300 mt-1">
                  Comme dans Fightcade 2, vous ne pouvez rester connecté qu’à <strong>3 salons simultanément</strong>.
                  Fermez un salon ci-dessous pour rejoindre <strong>{limitModalGame.title}</strong> :
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {activeChannels.map((ch) => (
                <div
                  key={ch.gameId}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-neutral-950 border border-neutral-800"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">{ch.title}</div>
                    <div className="text-[10px] font-mono text-neutral-400">{ch.platformLabel}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onReplaceChannel(ch.gameId, limitModalGame)}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shrink-0"
                  >
                    Fermer &amp; Remplacer
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={onCloseLimitModal}
              className="w-full py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs font-bold text-neutral-300"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </>
  );
}
