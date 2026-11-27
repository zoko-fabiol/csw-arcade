import React, { useState } from 'react';
import { Mic, MicOff, PhoneOff, PhoneCall, Users, Gamepad2, ChevronDown, ChevronUp, VolumeX, Volume2 } from 'lucide-react';
import { PlayerAvatar } from '../common/PlayerAvatar';

/**
 * HUD Vocal Non-Intrusif CSW Arcade (Hors-Jeu : pilule compacte repliable, 6 joueurs max)
 */
export function VoicePartyPill({
  voiceState,
  micMode = 'open',
  onToggleMute,
  onLeave,
  onChangeChannel,
  onTogglePeerMute,
  onPttChange,
  onUnlockAudio,
  onAcceptInvite,
  onDismissInvite,
  inGame = false,
}) {
  const [expanded, setExpanded] = useState(false);

  const hasRoom = Boolean(voiceState?.roomId);
  const invite = voiceState?.incomingInvite;
  const members = voiceState?.members || [];
  const activeChannel = voiceState?.channel || 'party';

  // EN JEU (y compris Plein Écran) : Pastilles de parole 100 % passives en haut à gauche + toast invitation
  if (inGame) {
    const speakingMembers = members.filter((m) => m.speaking && !m.muted);
    return (
      <>
        {/* Pastilles passives qui n'apparaissent QUE quand quelqu'un parle */}
        {hasRoom && speakingMembers.length > 0 && (
          <div
            className="pointer-events-none fixed top-14 left-3 z-[85] flex flex-col gap-1.5"
            aria-live="polite"
          >
            {speakingMembers.slice(0, 4).map((m) => (
              <div
                key={m.uid}
                className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-md border border-emerald-400/60 shadow-lg text-white text-[11px] font-bold animate-pulse"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" aria-hidden="true" />
                <Mic className="w-3 h-3 text-emerald-300 shrink-0" aria-hidden="true" />
                <span className="truncate max-w-[120px]">{m.name}</span>
              </div>
            ))}
          </div>
        )}

        {hasRoom && voiceState?.audioBlocked && onUnlockAudio && (
          <button
            type="button"
            onClick={onUnlockAudio}
            title="Cliquer pour activer l'audio WebRTC"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-amber-500 hover:bg-amber-400 text-black text-xs font-extrabold shadow-lg shadow-amber-900/30 animate-pulse transition cursor-pointer"
          >
            <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Activer son</span>
          </button>
        )}

        {/* Bouton Push-to-Talk discret en jeu sur mobile/desktop si mode PTT actif */}
        {hasRoom && micMode === 'ptt' && (
          <button
            type="button"
            onPointerDown={() => onPttChange?.(true)}
            onPointerUp={() => onPttChange?.(false)}
            onPointerLeave={() => onPttChange?.(false)}
            onPointerCancel={() => onPttChange?.(false)}
            className={`fixed bottom-4 left-4 z-[85] px-3 py-2 rounded-full border text-xs font-black flex items-center gap-1.5 shadow-xl transition-all select-none ${
              voiceState.pttActive
                ? 'bg-emerald-500 border-emerald-300 text-black scale-105'
                : 'bg-black/70 border-white/25 text-white backdrop-blur-md'
            }`}
            title="Maintenir pour parler (Touche V)"
          >
            <Mic className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{voiceState.pttActive ? 'Parle…' : 'Parler (V)'}</span>
          </button>
        )}

        {/* Toast d'invitation vocale non-intrusif en jeu (visible même en Plein Écran) */}
        {invite && (
          <div className="fixed top-14 right-3 z-[96] w-72 max-w-[calc(100vw-24px)] rounded-2xl bg-neutral-900/95 backdrop-blur-md border-2 border-emerald-400/70 p-3 shadow-2xl space-y-2 text-white">
            <div className="flex items-center gap-2 text-emerald-300 text-xs font-black">
              <PhoneCall className="w-4 h-4 animate-pulse shrink-0" aria-hidden="true" />
              <span className="truncate">Invitation Vocale</span>
            </div>
            <p className="text-[11px] text-neutral-200 leading-snug">
              <strong>{invite.fromName}</strong> vous invite dans <strong>{invite.roomTitle}</strong>.
            </p>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => onAcceptInvite?.(invite)}
                className="flex-1 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-[11px] font-black cursor-pointer"
              >
                Rejoindre
              </button>
              <button
                type="button"
                onClick={() => onDismissInvite?.()}
                className="px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[11px] font-bold cursor-pointer"
              >
                Ignorer
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // HORS-JEU (Salon / Catalogue) : Pilule flottante ultra-compacte + toast d'invitation
  return (
    <div className="fixed bottom-[74px] md:bottom-5 left-3 z-[140] flex flex-col items-start gap-2 pointer-events-none max-w-[calc(100vw-24px)]">
      {voiceState?.error && (
        <div className="pointer-events-auto px-3 py-2 rounded-xl bg-rose-950/90 border border-rose-500/50 text-rose-200 text-xs font-semibold shadow-xl">
          {voiceState.error}
        </div>
      )}

      {invite && (
        <div className="pointer-events-auto w-72 sm:w-80 rounded-2xl bg-neutral-900 border-2 border-emerald-500/60 p-3.5 shadow-2xl space-y-2.5">
          <div className="flex items-center gap-2 text-emerald-300 font-black text-xs uppercase">
            <PhoneCall className="w-4 h-4 animate-pulse shrink-0" aria-hidden="true" />
            <span>Invitation Chat Vocal</span>
          </div>
          <p className="text-xs text-neutral-200">
            <strong>{invite.fromName}</strong> vous invite dans <strong>{invite.roomTitle}</strong> (continu du salon jusqu&apos;en jeu).
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onAcceptInvite?.(invite)}
              className="arcade-focus-ring flex-1 py-2 min-h-[38px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black cursor-pointer"
            >
              Rejoindre Vocal
            </button>
            <button
              type="button"
              onClick={() => onDismissInvite?.()}
              className="arcade-focus-ring px-3 py-2 min-h-[38px] rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-bold cursor-pointer"
            >
              Ignorer
            </button>
          </div>
        </div>
      )}

      {hasRoom && (
        <div className="pointer-events-auto rounded-2xl bg-neutral-900/95 backdrop-blur-md border u-accent-border shadow-2xl overflow-hidden w-72 sm:w-80">
          {/* Barre compacte toujours visible */}
          <div className="px-3 py-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
              title="Déplier / Replier le groupe vocal"
            >
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </span>
              <div className="min-w-0">
                <div className="text-xs font-black text-white truncate">
                  {voiceState.roomTitle || 'Groupe Vocal'}
                </div>
                <div className="text-[10px] font-mono text-neutral-400 truncate">
                  {activeChannel === 'party' ? 'Canal Groupe' : 'Canal Jeu'} · {members.length}/{voiceState.maxMembers || 6} joueurs
                </div>
              </div>
              {expanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5 text-neutral-400 shrink-0" aria-hidden="true" />
              )}
            </button>

            <div className="flex items-center gap-1 shrink-0">
              {voiceState?.audioBlocked && (
                <button
                  type="button"
                  onClick={() => onUnlockAudio?.()}
                  title="Débloquer le son vocal"
                  className="px-2 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-[10px] font-black cursor-pointer"
                >
                  Activer son
                </button>
              )}
              <button
                type="button"
                onClick={onToggleMute}
                title={voiceState.muted ? 'Activer le micro' : 'Couper le micro'}
                className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                  voiceState.muted
                    ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                    : voiceState.speaking
                    ? 'bg-emerald-500 border-emerald-400 text-black'
                    : 'bg-neutral-800 border-white/10 text-neutral-200 hover:bg-neutral-700'
                }`}
              >
                {voiceState.muted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={onLeave}
                title="Quitter le chat vocal"
                className="p-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/35 border border-rose-500/40 text-rose-300 transition-colors cursor-pointer"
              >
                <PhoneOff className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Panneau déplié : Canal Groupe / Jeu + Liste des membres avec mute individuel */}
          {expanded && (
            <div className="px-3 pb-3 pt-1.5 border-t border-white/10 space-y-2.5">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => onChangeChannel?.('party')}
                  className={`py-1.5 px-2 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 border transition-colors cursor-pointer ${
                    activeChannel === 'party'
                      ? 'u-tab-active'
                      : 'bg-neutral-950/70 border-white/10 text-neutral-300'
                  }`}
                >
                  <Users className="w-3 h-3" aria-hidden="true" />
                  <span>Groupe</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChangeChannel?.('game')}
                  className={`py-1.5 px-2 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 border transition-colors cursor-pointer ${
                    activeChannel === 'game'
                      ? 'u-tab-active'
                      : 'bg-neutral-950/70 border-white/10 text-neutral-300'
                  }`}
                >
                  <Gamepad2 className="w-3 h-3" aria-hidden="true" />
                  <span>Canal Jeu</span>
                </button>
              </div>

              <div className="space-y-1 max-h-36 overflow-y-auto">
                {members.map((m) => {
                  const isPeerMuted = Boolean(voiceState.mutedPeers?.[m.uid]);
                  return (
                    <div
                      key={m.uid}
                      className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-xl border text-xs ${
                        m.speaking && !m.muted
                          ? 'bg-emerald-950/40 border-emerald-500/50'
                          : 'bg-neutral-950/60 border-white/5'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`rounded-full p-0.5 ${m.speaking && !m.muted ? 'ring-2 ring-emerald-400' : ''}`}>
                          <PlayerAvatar photoURL={m.photoURL} name={m.name} size="xs" />
                        </div>
                        <span className="font-bold text-neutral-100 truncate">{m.name}</span>
                        {m.muted && <MicOff className="w-3 h-3 text-rose-400 shrink-0" />}
                      </div>
                      <button
                        type="button"
                        onClick={() => onTogglePeerMute?.(m.uid)}
                        title={isPeerMuted ? `Réactiver ${m.name}` : `Rendre muet ${m.name}`}
                        className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
                      >
                        {isPeerMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  );
                })}
              </div>

              {micMode === 'ptt' && (
                <button
                  type="button"
                  onPointerDown={() => onPttChange?.(true)}
                  onPointerUp={() => onPttChange?.(false)}
                  onPointerLeave={() => onPttChange?.(false)}
                  className={`w-full py-2 rounded-xl border text-xs font-black flex items-center justify-center gap-1.5 select-none cursor-pointer ${
                    voiceState.pttActive
                      ? 'bg-emerald-500 border-emerald-300 text-black'
                      : 'bg-neutral-800 border-white/15 text-neutral-100'
                  }`}
                >
                  <Mic className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{voiceState.pttActive ? 'Micro actif — Parlez…' : 'Maintenir pour parler (V)'}</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
