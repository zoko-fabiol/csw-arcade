import React, { useState } from 'react';
import { Gamepad2, MessageSquare, Globe, X, AlertTriangle, Swords, Trophy } from 'lucide-react';
import { GameCover } from './GameCover';
import { GLOBAL_CHANNEL_ID } from '../../services/firebaseFightcadeService';

export function FightcadeChannelsDock({
  activeChannels = [],
  selectedChannelId = null,
  onlineCount = 1,
  onSelectLibrary,
  onSelectChannel,
  onLeaveChannel,
  onOpenProfile,
  userRank = 'D',
  limitModalGame = null,
  onCloseLimitModal,
  onReplaceChannel,
}) {
  const isGlobalSelected = selectedChannelId === GLOBAL_CHANNEL_ID;
  const isGameChannelSelected = Boolean(selectedChannelId && !isGlobalSelected);
  const [mobileChannelsSheetOpen, setMobileChannelsSheetOpen] = useState(false);

  return (
    <>
      {/* DOCK VERTICAL GAUCHE — DESKTOP & TABLETTE (md+) */}
      <nav
        className="hidden md:flex w-[72px] lg:w-20 shrink-0 border-r border-white/10 arcade-glass flex-col items-center py-3 gap-3 z-20 overflow-y-auto no-scrollbar"
        aria-label="Salons CSW Arcade actifs (Lobby Global + max 3 jeux)"
      >
        <button
          type="button"
          onClick={onSelectLibrary}
          title="Catalogue des jeux (Game Mode)"
          className={`arcade-focus-ring w-12 h-12 rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-all border ${
            selectedChannelId === null
              ? 'u-btn-primary'
              : 'bg-neutral-900/80 border-white/15 text-neutral-200 hover:text-white hover:border-white/30'
          }`}
        >
          <Gamepad2 className="w-5 h-5" aria-hidden="true" />
          <span className="text-[9px] font-black">JEUX</span>
        </button>

        {/* Bouton Salon Communautaire Global CSW Arcade */}
        <button
          type="button"
          onClick={() => onSelectChannel(GLOBAL_CHANNEL_ID)}
          title="Salon Communautaire Global CSW Arcade (Tous les joueurs & messages)"
          className={`arcade-focus-ring relative w-12 h-12 rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-all border ${
            isGlobalSelected
              ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200 shadow-lg shadow-emerald-500/20'
              : 'bg-neutral-900/80 border-white/15 text-neutral-200 hover:text-emerald-300 hover:border-emerald-500/40'
          }`}
        >
          <Globe className="w-5 h-5" aria-hidden="true" />
          <span className="text-[9px] font-bold">SALON</span>
          <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.2 rounded-full bg-emerald-500 text-black text-[9px] font-mono font-black border border-neutral-950 tabular-nums">
            {onlineCount}
          </span>
        </button>

        <div className="w-8 h-px bg-white/15" />

        <div className="text-[9px] font-mono font-semibold text-neutral-300 uppercase" title="Vos jeux sélectionnés (actifs aux salons)">
          ACTIFS {activeChannels.length}/3
        </div>

        <div className="flex-1 flex flex-col gap-2.5 w-full items-center overflow-y-auto px-1">
          {activeChannels.map((ch) => {
            const active = selectedChannelId === ch.gameId;
            const initials = String(ch.title || 'J')
              .replace(/[^a-zA-Z0-9\s]/g, ' ')
              .trim()
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase() || '')
              .join('') || 'FC';
            return (
              <div key={ch.gameId} className="relative group">
                <button
                  type="button"
                  onClick={() => onSelectChannel(ch.gameId)}
                  title={`Salon actif : ${ch.title} (${ch.platformLabel})`}
                  aria-label={`Ouvrir le salon ${ch.title}`}
                  className={`arcade-focus-ring w-12 h-12 rounded-xl overflow-hidden border-2 transition-all flex flex-col items-center justify-center px-1 ${
                    active
                      ? 'u-tab-active scale-105'
                      : 'bg-neutral-900/90 border-white/15 text-neutral-100 hover:border-white/35'
                  }`}
                >
                  <span className="text-xs font-black tracking-tight leading-none u-accent-text">{initials}</span>
                  <span className="text-[8px] font-mono text-neutral-300 truncate max-w-full mt-0.5 leading-none">
                    {ch.platformLabel ? ch.platformLabel.split(' ')[0] : 'SALON'}
                  </span>
                </button>
                <span
                  className="absolute -bottom-0.5 -left-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-neutral-950"
                  title="Vous êtes actif sur ce jeu"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onLeaveChannel(ch.gameId);
                  }}
                  aria-label={`Quitter le salon ${ch.title}`}
                  title="Quitter ce salon"
                  className="arcade-focus-ring absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-neutral-900 border border-white/25 text-neutral-200 hover:bg-rose-600 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="text-[10px] font-mono text-neutral-400 flex flex-col items-center gap-0.5">
          <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
          <span>FC2</span>
        </div>
      </nav>

      {/* BOTTOM NAVIGATION BAR — MOBILE (< md) */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 arcade-glass border-t border-white/15 pb-safe"
        aria-label="Navigation mobile"
      >
        <div className="grid grid-cols-4 h-16 px-1.5 gap-1">
          <button
            type="button"
            onClick={() => {
              setMobileChannelsSheetOpen(false);
              onSelectLibrary();
            }}
            className={`arcade-focus-ring flex flex-col items-center justify-center gap-1 min-h-[44px] rounded-xl transition-colors ${
              selectedChannelId === null ? 'u-tab-active' : 'text-neutral-200'
            }`}
          >
            <Gamepad2 className="w-5 h-5" aria-hidden="true" />
            <span className="text-[10px] font-bold">Jeux</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMobileChannelsSheetOpen(false);
              onSelectChannel(GLOBAL_CHANNEL_ID);
            }}
            className={`arcade-focus-ring relative flex flex-col items-center justify-center gap-1 min-h-[44px] rounded-xl transition-colors ${
              isGlobalSelected ? 'text-emerald-300 bg-emerald-500/10' : 'text-neutral-300'
            }`}
          >
            <span className="relative">
              <Globe className="w-5 h-5" aria-hidden="true" />
              <span className="absolute -top-1 -right-2 px-1 rounded-full bg-emerald-500 text-black text-[9px] font-black leading-tight tabular-nums">
                {onlineCount}
              </span>
            </span>
            <span className="text-[10px] font-bold">Salon</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (activeChannels.length === 1 && !mobileChannelsSheetOpen) {
                onSelectChannel(activeChannels[0].gameId);
              } else {
                setMobileChannelsSheetOpen((v) => !v);
              }
            }}
            className={`arcade-focus-ring relative flex flex-col items-center justify-center gap-1 min-h-[44px] rounded-xl transition-colors ${
              isGameChannelSelected || mobileChannelsSheetOpen ? 'text-cyan-300 bg-cyan-500/10' : 'text-neutral-300'
            }`}
          >
            <span className="relative">
              <Swords className="w-5 h-5" aria-hidden="true" />
              {activeChannels.length > 0 && (
                <span className="absolute -top-1 -right-2 px-1 rounded-full bg-cyan-500 text-black text-[9px] font-black leading-tight tabular-nums">
                  {activeChannels.length}
                </span>
              )}
            </span>
            <span className="text-[10px] font-bold">Actifs ({activeChannels.length}/3)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMobileChannelsSheetOpen(false);
              onOpenProfile?.();
            }}
            className="arcade-focus-ring flex flex-col items-center justify-center gap-1 min-h-[44px] rounded-xl text-neutral-300 active:text-amber-300 transition-colors"
          >
            <span className="relative flex items-center justify-center">
              <Trophy className="w-5 h-5 text-amber-400" aria-hidden="true" />
              <span className="absolute -top-1 -right-2.5 px-1 rounded bg-neutral-800 border border-amber-500/40 text-amber-300 text-[8px] font-mono font-black">
                {userRank}
              </span>
            </span>
            <span className="text-[10px] font-bold">Rang &amp; Profil</span>
          </button>
        </div>
      </nav>

      {/* Bottom Sheet Mobile : Sélection rapide parmi les 3 salons de jeux actifs */}
      {mobileChannelsSheetOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-end"
          onClick={() => setMobileChannelsSheetOpen(false)}
        >
          <div
            className="w-full rounded-t-2xl bg-neutral-900 border-t border-cyan-500/40 p-4 pb-20 space-y-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-white">Vos Salons de Jeux Actifs ({activeChannels.length}/3)</h3>
                <p className="text-[11px] font-mono text-neutral-400">
                  Sélectionnez un salon pour discuter ou défier un joueur
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMobileChannelsSheetOpen(false)}
                className="p-1.5 rounded-lg bg-neutral-800 text-neutral-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeChannels.length === 0 ? (
              <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 text-center text-xs text-neutral-400">
                Aucun salon actif. Cliquez sur <strong>⚔️</strong> sur une carte du catalogue ou lancez un jeu pour activer son salon.
              </div>
            ) : (
              <div className="space-y-2">
                {activeChannels.map((ch) => (
                  <div
                    key={ch.gameId}
                    className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border ${
                      selectedChannelId === ch.gameId
                        ? 'bg-cyan-950/40 border-cyan-400'
                        : 'bg-neutral-950 border-neutral-800'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectChannel(ch.gameId);
                        setMobileChannelsSheetOpen(false);
                      }}
                      className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                    >
                      <GameCover
                        title={ch.title}
                        platformLabel={ch.platformLabel}
                        filename={ch.filename}
                        compact
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">🟢 {ch.title}</div>
                        <div className="text-[10px] font-mono text-neutral-400">{ch.platformLabel}</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onLeaveChannel(ch.gameId)}
                      className="p-2 rounded-lg bg-neutral-800 text-neutral-300 hover:bg-rose-600 hover:text-white shrink-0"
                      title="Quitter ce salon"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Alerte limite stricte de 3 salons actifs */}
      {limitModalGame && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-neutral-900 border border-amber-500/40 p-5 space-y-4 shadow-2xl pb-safe">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-black text-white">Limite de 3 salons actifs atteinte</h3>
                <p className="text-xs text-neutral-300 mt-1">
                  Comme dans CSW Arcade, vous pouvez être actif sur <strong>3 jeux simultanément</strong>.
                  Fermez un salon ci-dessous pour activer <strong>{limitModalGame.title}</strong> :
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
                    Remplacer
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={onCloseLimitModal}
              className="w-full py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs font-bold text-neutral-300"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </>
  );
}
