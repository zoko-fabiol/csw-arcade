import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  Wifi,
  CheckCircle2,
  AlertTriangle,
  X,
  Play,
  Loader2,
  Radio,
  Gamepad2,
  Award,
} from 'lucide-react';
import { firebaseFightcadeService } from '../../services/firebaseFightcadeService';
import { downloadAndCacheRom, formatBytes } from '../../services/platformRomService';

/**
 * Sas de Synchronisation Multijoueur CSW-Arcade
 * 
 * Garantit que l'Hôte et l'Invité :
 * 1. S'attendent mutuellement dans la salle de match.
 * 2. Téléchargent et vérifient tous les deux la ROM avant de commencer.
 * 3. Établissent la liaison WebRTC / VPS.
 * 4. Déclenchent un compte à rebours 3... 2... 1... FIGHT synchrone pour un départ à la même milliseconde.
 */
export function MatchSyncModal({
  isOpen,
  challenge,
  isHost,
  userProfile,
  onLaunchMatch,
  onCancel,
}) {
  const [phase, setPhase] = useState('waiting_opponent'); // 'waiting_opponent' | 'syncing' | 'countdown' | 'cancelled'
  const [cancelReason, setCancelReason] = useState('');
  
  // États joueur local
  const [localRomPct, setLocalRomPct] = useState(0);
  const [localRomReady, setLocalRomReady] = useState(false);
  const [localReady, setLocalReady] = useState(false);
  const [localBlob, setLocalBlob] = useState(null);

  // États joueur distant
  const [remoteRomPct, setRemoteRomPct] = useState(0);
  const [remoteRomReady, setRemoteRomReady] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false);

  // Compte à rebours
  const [countdown, setCountdown] = useState(null); // 3, 2, 1, 0 ('FIGHT')
  const [waitTimer, setWaitTimer] = useState(45);

  const countdownIntervalRef = useRef(null);
  const waitTimerRef = useRef(null);
  const isLaunchingRef = useRef(false);

  const opponentUid = isHost ? challenge?.toUid : challenge?.fromUid;
  const opponentName = isHost ? challenge?.toName : challenge?.fromName;
  const gameTitle = challenge?.gameTitle || challenge?.gameEntry?.title || 'Jeu Arcade';
  const platformLabel = challenge?.gameEntry?.platformLabel || 'Arcade FBNeo';

  // 1. Initialisation de la phase
  useEffect(() => {
    if (!isOpen || !challenge) return;
    isLaunchingRef.current = false;
    setCountdown(null);
    setCancelReason('');

    if (isHost) {
      if (challenge.status === 'accepted') {
        setPhase('syncing');
      } else {
        setPhase('waiting_opponent');
        setWaitTimer(45);
        waitTimerRef.current = setInterval(() => {
          setWaitTimer((prev) => {
            if (prev <= 1) {
              clearInterval(waitTimerRef.current);
              setPhase('cancelled');
              setCancelReason("Délai d'attente dépassé (l'adversaire n'a pas répondu).");
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
    } else {
      // Pour l'invité qui a accepté le défi
      setPhase('syncing');
    }

    return () => {
      clearInterval(waitTimerRef.current);
      clearInterval(countdownIntervalRef.current);
    };
  }, [isOpen, challenge?.challengeId, isHost]);

  // 2. Écoute de l'adversaire (Changement de statut défi, Annulation, Sync ROM)
  useEffect(() => {
    if (!isOpen || !challenge?.challengeId) return;

    // Écoute des mises à jour du défi (acceptation de l'hôte/invité)
    const unsubChallenge = firebaseFightcadeService.subscribeChallenge(
      challenge.challengeId,
      (ch) => {
        if (!ch) return;
        if (ch.status === 'accepted') {
          clearInterval(waitTimerRef.current);
          setPhase((prev) => (prev === 'waiting_opponent' ? 'syncing' : prev));
        } else if (ch.status === 'declined' || ch.status === 'expired') {
          clearInterval(waitTimerRef.current);
          setPhase('cancelled');
          setCancelReason(
            ch.status === 'declined'
              ? `${opponentName || "L'adversaire"} a décliné le match.`
              : "Le défi a expiré."
          );
        }
      }
    );

    // Écoute des paquets de synchronisation du Sas (Progression ROM & Ready check)
    const unsubSync = firebaseFightcadeService.subscribeMatchSync(
      challenge.challengeId,
      (data) => {
        if (!data) return;
        if (data.type === 'MATCH_SYNC_UPDATE') {
          if (typeof data.romPct === 'number') setRemoteRomPct(data.romPct);
          if (data.romReady !== undefined) setRemoteRomReady(Boolean(data.romReady));
          if (data.isReady !== undefined) setRemoteReady(Boolean(data.isReady));
        } else if (data.type === 'MATCH_COUNTDOWN_START') {
          startCountdownSequence();
        } else if (data.type === 'MATCH_CANCELLED') {
          setPhase('cancelled');
          setCancelReason(`${opponentName || "L'adversaire"} a quitté la salle d'attente.`);
        }
      }
    );

    return () => {
      unsubChallenge();
      unsubSync();
    };
  }, [isOpen, challenge?.challengeId, opponentName]);

  // 3. Téléchargement & mise en cache de la ROM dès qu'on entre en phase 'syncing'
  useEffect(() => {
    if (phase !== 'syncing' || !challenge?.gameEntry) return;

    let isMounted = true;
    const entry = challenge.gameEntry;
    const core = entry.core || entry.platform || 'fbneo';

    downloadAndCacheRom(entry, {
      mode: core,
      core,
      onProgress: ({ received, total }) => {
        if (!isMounted) return;
        if (total > 0) {
          const pct = Math.min(100, Math.round((received / total) * 100));
          setLocalRomPct(pct);
          firebaseFightcadeService.sendMatchSyncUpdate(challenge.challengeId, opponentUid, {
            romPct: pct,
            romReady: false,
            isReady: false,
          });
        }
      },
    })
      .then((blob) => {
        if (!isMounted) return;
        setLocalBlob(blob);
        setLocalRomPct(100);
        setLocalRomReady(true);
        setLocalReady(true);

        firebaseFightcadeService.sendMatchSyncUpdate(challenge.challengeId, opponentUid, {
          romPct: 100,
          romReady: true,
          isReady: true,
        });
      })
      .catch((err) => {
        if (!isMounted) return;
        setPhase('cancelled');
        setCancelReason(
          `Échec du chargement de la ROM : ${err?.message || 'Fichier indisponible'}. Match annulé.`
        );
        firebaseFightcadeService.sendMatchCancel(challenge.challengeId, opponentUid);
      });

    return () => {
      isMounted = false;
    };
  }, [phase, challenge?.challengeId, opponentUid]);

  // 4. Déclenchement du compte à rebours lorsque les DEUX joueurs sont 100% prêts
  useEffect(() => {
    if (phase === 'syncing' && localReady && remoteReady && countdown === null) {
      if (isHost) {
        // L'hôte donne le top départ du compte à rebours
        firebaseFightcadeService.sendMatchCountdownStart(challenge.challengeId, opponentUid);
        startCountdownSequence();
      }
    }
  }, [phase, localReady, remoteReady, countdown, isHost, challenge?.challengeId, opponentUid]);

  const startCountdownSequence = () => {
    if (countdownIntervalRef.current) return;
    setPhase('countdown');
    setCountdown(3);

    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null) return 3;
        if (prev <= 1) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
          // 0 = FIGHT ! Déclencher le lancement synchrone
          setTimeout(() => {
            if (!isLaunchingRef.current) {
              isLaunchingRef.current = true;
              onLaunchMatch({
                gameEntry: challenge.gameEntry,
                fileBlob: localBlob,
                isHost,
                playerIndex: isHost ? 0 : 1,
                challengeId: challenge.challengeId,
                opponentName,
              });
            }
          }, 600);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleCancel = () => {
    clearInterval(waitTimerRef.current);
    clearInterval(countdownIntervalRef.current);
    if (challenge?.challengeId && opponentUid) {
      firebaseFightcadeService.sendMatchCancel(challenge.challengeId, opponentUid);
      firebaseFightcadeService.respondChallenge(challenge.challengeId, false, opponentUid);
    }
    onCancel?.();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-2xl bg-neutral-900 border-2 border-cyan-500/40 rounded-2xl shadow-2xl shadow-cyan-500/20 overflow-hidden flex flex-col">
        {/* En-tête arcade */}
        <div className="px-6 py-4 bg-gradient-to-r from-neutral-950 via-neutral-900 to-neutral-950 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
            </span>
            <div>
              <h2 className="text-sm font-black tracking-widest text-cyan-400 uppercase">
                Salle d'Attente Multijoueur · Match Room
              </h2>
              <p className="text-xs text-neutral-400 font-semibold truncate max-w-sm">
                {gameTitle} · <span className="text-neutral-300">{platformLabel}</span>
              </p>
            </div>
          </div>

          <button
            onClick={handleCancel}
            type="button"
            className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition"
            title="Quitter la salle"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corps central : Versus Cards */}
        <div className="p-6 flex-1 flex flex-col justify-center">
          {phase === 'cancelled' ? (
            <div className="py-10 text-center flex flex-col items-center">
              <AlertTriangle className="w-12 h-12 text-rose-500 mb-3 animate-bounce" />
              <h3 className="text-lg font-black text-white mb-2">Match annulé</h3>
              <p className="text-sm text-neutral-400 max-w-md mb-6">{cancelReason || "La partie n'a pas pu démarrer."}</p>
              <button
                type="button"
                onClick={handleCancel}
                className="px-6 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-sm transition"
              >
                Retourner au Salon
              </button>
            </div>
          ) : (
            <>
              {/* Cartes Versus */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                {/* JOUEUR 1 (HÔTE) */}
                <div
                  className={`md:col-span-2 p-4 rounded-xl border-2 flex flex-col items-center text-center transition ${
                    isHost
                      ? 'bg-cyan-950/20 border-cyan-500/50 shadow-lg shadow-cyan-500/10'
                      : 'bg-neutral-950/60 border-neutral-800'
                  }`}
                >
                  <div className="relative mb-2">
                    <div className="w-16 h-16 rounded-full bg-cyan-900/40 border-2 border-cyan-400 flex items-center justify-center text-cyan-300 font-black text-xl shadow-inner">
                      {(isHost ? userProfile?.displayName || userProfile?.name : opponentName || 'J1')
                        ?.slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded bg-cyan-500 text-[10px] font-black text-black">
                      P1 HÔTE
                    </span>
                  </div>

                  <span className="text-sm font-black text-white truncate max-w-[150px]">
                    {isHost ? userProfile?.displayName || userProfile?.name || 'Vous' : opponentName || 'Hôte'}
                  </span>
                  <span className="text-[11px] text-cyan-400 font-semibold mb-3">
                    {isHost ? '2 Coins Débités (Offre le match)' : '0 Coin Requis (Invité)'}
                  </span>

                  {/* Statut J1 */}
                  <div className="w-full pt-3 border-t border-neutral-800/80 flex flex-col gap-1.5 text-xs">
                    <div className="flex items-center justify-between text-neutral-400">
                      <span>ROM :</span>
                      <span className="font-bold text-neutral-200">
                        {isHost ? (localRomReady ? 'Prête ✅' : `${localRomPct}%`) : remoteRomReady ? 'Prête ✅' : `${remoteRomPct}%`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-neutral-400">
                      <span>Statut :</span>
                      <span
                        className={`font-black ${
                          (isHost ? localReady : remoteReady) ? 'text-emerald-400' : 'text-amber-400 animate-pulse'
                        }`}
                      >
                        {(isHost ? localReady : remoteReady) ? 'PRÊT ⚡' : 'Chargement…'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* CENTRE VS & COUNTDOWN */}
                <div className="md:col-span-1 flex flex-col items-center justify-center py-2">
                  {phase === 'countdown' ? (
                    <div className="flex flex-col items-center animate-scale-up">
                      <span className="text-6xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-amber-300 to-rose-500 drop-shadow-[0_0_20px_rgba(244,63,94,0.6)]">
                        {countdown === 0 ? 'FIGHT!' : countdown}
                      </span>
                      <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mt-1">
                        Départ Imminent
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-rose-600 to-amber-600 flex items-center justify-center text-white font-black text-lg italic shadow-lg shadow-rose-600/30">
                        VS
                      </div>
                      <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider mt-2">
                        {phase === 'waiting_opponent' ? `Attente (${waitTimer}s)` : 'Synchronisation'}
                      </span>
                    </div>
                  )}
                </div>

                {/* JOUEUR 2 (INVITÉ) */}
                <div
                  className={`md:col-span-2 p-4 rounded-xl border-2 flex flex-col items-center text-center transition ${
                    !isHost
                      ? 'bg-rose-950/20 border-rose-500/50 shadow-lg shadow-rose-500/10'
                      : 'bg-neutral-950/60 border-neutral-800'
                  }`}
                >
                  <div className="relative mb-2">
                    <div className="w-16 h-16 rounded-full bg-rose-900/40 border-2 border-rose-400 flex items-center justify-center text-rose-300 font-black text-xl shadow-inner">
                      {(!isHost ? userProfile?.displayName || userProfile?.name : opponentName || 'J2')
                        ?.slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded bg-rose-500 text-[10px] font-black text-white">
                      P2 CHALLENGER
                    </span>
                  </div>

                  <span className="text-sm font-black text-white truncate max-w-[150px]">
                    {!isHost ? userProfile?.displayName || userProfile?.name || 'Vous' : opponentName || 'Invité'}
                  </span>
                  <span className="text-[11px] text-rose-400 font-semibold mb-3">
                    {!isHost ? '0 Coin (Match offert par l’hôte)' : 'Match Défi'}
                  </span>

                  {/* Statut J2 */}
                  <div className="w-full pt-3 border-t border-neutral-800/80 flex flex-col gap-1.5 text-xs">
                    <div className="flex items-center justify-between text-neutral-400">
                      <span>ROM :</span>
                      <span className="font-bold text-neutral-200">
                        {!isHost ? (localRomReady ? 'Prête ✅' : `${localRomPct}%`) : remoteRomReady ? 'Prête ✅' : `${remoteRomPct}%`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-neutral-400">
                      <span>Statut :</span>
                      <span
                        className={`font-black ${
                          (!isHost ? localReady : remoteReady) ? 'text-emerald-400' : 'text-amber-400 animate-pulse'
                        }`}
                      >
                        {(!isHost ? localReady : remoteReady) ? 'PRÊT ⚡' : 'Chargement…'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Jauge globale & Messages d'état */}
              <div className="mt-6 p-3.5 rounded-xl bg-neutral-950/80 border border-neutral-800 flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="flex items-center gap-2 text-neutral-300">
                    <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                    {phase === 'waiting_opponent'
                      ? `En attente de la réponse de ${opponentName || "l'adversaire"}…`
                      : localReady && remoteReady
                      ? 'Synchronisation terminée ! Les 2 joueurs sont prêts.'
                      : 'Téléchargement de la ROM et connexion multijoueur en cours…'}
                  </span>
                  <span className="text-cyan-400 font-mono">
                    {localReady && remoteReady ? '100%' : `${Math.round((localRomPct + remoteRomPct) / 2)}%`}
                  </span>
                </div>

                {/* Barre de chargement combinée */}
                <div className="w-full h-2 rounded-full bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-400 transition-all duration-300"
                    style={{
                      width: `${localReady && remoteReady ? 100 : Math.round((localRomPct + remoteRomPct) / 2)}%`,
                    }}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Pied de page */}
        <div className="px-6 py-4 bg-neutral-950 border-t border-neutral-800 flex items-center justify-between">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-bold text-xs transition"
          >
            Annuler & Retourner au Salon
          </button>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-neutral-400 font-medium hidden sm:inline">
              {phase === 'countdown' ? 'Démarrage automatique…' : 'Départ automatique dès que les 2 joueurs sont prêts'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
