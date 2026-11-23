/**
 * Système d'enregistrement des Meilleurs Scores, Stats du Personnage/Joueur par jeu
 * et Évaluation Automatique du Rang Global (D -> C -> B -> A -> S -> S+) sur Firebase Firestore + Cache Local.
 */
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import {
  STATS_FORMULA_VERSION,
  RANK_TIERS,
  getRankTierMeta,
  normalizeScoreGameId,
  isPlausibleGameScore,
  evaluateSingleGameScore,
  sanitizeGameStatEntry,
  evaluatePlayerRank,
} from '../utils/scoreFormula.js';

export {
  STATS_FORMULA_VERSION,
  RANK_TIERS,
  getRankTierMeta,
  normalizeScoreGameId,
  isPlausibleGameScore,
  evaluateSingleGameScore,
  sanitizeGameStatEntry,
  evaluatePlayerRank,
};

const LOCAL_STATS_PREFIX = 'csw_player_game_stats_v1_';
const statsListeners = new Set();

function readLocalStatsMap(uid) {
  if (!uid) return {};
  try {
    const raw = localStorage.getItem(LOCAL_STATS_PREFIX + uid);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalStatsMap(uid, map) {
  if (!uid) return;
  try {
    localStorage.setItem(LOCAL_STATS_PREFIX + uid, JSON.stringify(map));
  } catch {
    /* noop */
  }
}

function notifyStatsListeners(uid, list) {
  const evaluation = evaluatePlayerRank(list);
  statsListeners.forEach((cb) => {
    try {
      cb({ uid, stats: list, evaluation });
    } catch {
      /* noop */
    }
  });
}

export function subscribeLocalStatsUpdates(cb) {
  statsListeners.add(cb);
  return () => statsListeners.delete(cb);
}

function mergeStatEntry(existingRaw, incomingRaw) {
  if (!existingRaw) return sanitizeGameStatEntry(incomingRaw);
  if (!incomingRaw) return sanitizeGameStatEntry(existingRaw);
  const existing = sanitizeGameStatEntry(existingRaw);
  const incoming = sanitizeGameStatEntry(incomingRaw);
  const bestScore = Math.max(Number(existing.bestScore || 0), Number(incoming.bestScore || 0));
  const gamesPlayed = Math.max(Number(existing.gamesPlayed || 0), Number(incoming.gamesPlayed || 0));
  const playTimeSeconds = Math.max(Number(existing.playTimeSeconds || 0), Number(incoming.playTimeSeconds || 0));
  const totalScore = Math.max(Number(existing.totalScore || 0), Number(incoming.totalScore || 0));
  const { gameRank, gameRatingPoints } = evaluateSingleGameScore(
    bestScore,
    Math.max(1, gamesPlayed),
    playTimeSeconds
  );
  const newest = (incoming.updatedAtMs || 0) >= (existing.updatedAtMs || 0) ? incoming : existing;
  return {
    ...existing,
    ...incoming,
    gameTitle: newest.gameTitle || existing.gameTitle || incoming.gameTitle,
    platformLabel: newest.platformLabel || existing.platformLabel || incoming.platformLabel,
    bestScore,
    lastScore: newest.lastScore ?? existing.lastScore ?? 0,
    totalScore,
    gamesPlayed,
    playTimeSeconds,
    gameRank,
    gameRatingPoints,
    statsFormulaVersion: STATS_FORMULA_VERSION,
    updatedAtMs: Math.max(Number(existing.updatedAtMs || 0), Number(incoming.updatedAtMs || 0)),
  };
}

function migrateGuestStatsIntoMap(uid, targetMap) {
  if (!uid || String(uid).startsWith('p_')) return false;
  let changed = false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LOCAL_STATS_PREFIX + 'p_')) {
        const guestMap = JSON.parse(localStorage.getItem(k) || '{}');
        if (guestMap && typeof guestMap === 'object') {
          Object.values(guestMap).forEach((st) => {
            if (!st?.gameId) return;
            targetMap[st.gameId] = mergeStatEntry(targetMap[st.gameId], st);
            changed = true;
          });
        }
      }
    }
  } catch {
    /* noop */
  }
  return changed;
}

export function applyRemoteSyncedStats(uid, remoteStatsList) {
  if (!uid || !Array.isArray(remoteStatsList) || remoteStatsList.length === 0) return;
  const localMap = readLocalStatsMap(uid);
  let changed = false;
  for (const st of remoteStatsList) {
    if (!st?.gameId) continue;
    const prev = localMap[st.gameId];
    const merged = mergeStatEntry(prev, st);
    if (
      !prev ||
      merged.bestScore !== prev.bestScore ||
      merged.gamesPlayed !== prev.gamesPlayed ||
      merged.playTimeSeconds !== prev.playTimeSeconds
    ) {
      localMap[st.gameId] = merged;
      changed = true;
    }
  }
  if (changed) {
    writeLocalStatsMap(uid, localMap);
    const list = Object.values(localMap).sort((a, b) => (b.bestScore || 0) - (a.bestScore || 0));
    notifyStatsListeners(uid, list);
  }
}

/**
 * Charge toutes les stats de jeux d'un joueur (fusion localStorage + migration invité + relais /api/account-sync + Firestore).
 */
export async function loadPlayerGameStats(uid) {
  if (!uid) return { stats: [], evaluation: evaluatePlayerRank([]) };
  const localMap = readLocalStatsMap(uid);
  const migrated = migrateGuestStatsIntoMap(uid, localMap);

  // 1. Récupérer depuis le relais serveur /api/account-sync (fonctionne même sans règles Firestore publiées)
  try {
    const res = await fetch(`/api/account-sync?uid=${encodeURIComponent(uid)}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.gameStats)) {
        data.gameStats.forEach((remote) => {
          if (!remote?.gameId) return;
          localMap[remote.gameId] = mergeStatEntry(localMap[remote.gameId], remote);
        });
      }
    }
  } catch {
    /* ignore */
  }

  // 2. Récupérer depuis Firebase Firestore
  const docsToCleanInFirestore = [];
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'gameStats'));
    snap.forEach((d) => {
      const remote = d.data();
      if (!remote?.gameId) return;
      const merged = mergeStatEntry(localMap[remote.gameId], remote);
      localMap[remote.gameId] = merged;
      if (Number(remote.statsFormulaVersion || 1) < STATS_FORMULA_VERSION) {
        docsToCleanInFirestore.push(merged);
      }
    });
  } catch {
    /* offline fallback */
  }

  const stats = Object.values(localMap)
    .map(sanitizeGameStatEntry)
    .sort((a, b) => (b.bestScore || 0) - (a.bestScore || 0) || (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  stats.forEach((st) => {
    localMap[st.gameId] = st;
  });
  writeLocalStatsMap(uid, localMap);
  const evaluation = evaluatePlayerRank(stats);

  if (docsToCleanInFirestore.length > 0) {
    docsToCleanInFirestore.forEach((cleaned) => {
      const latest = localMap[cleaned.gameId] || cleaned;
      setDoc(
        doc(db, 'users', uid, 'gameStats', latest.gameId),
        { ...latest, updatedAt: serverTimestamp() },
        { merge: true }
      ).catch(() => {});
    });
    setDoc(
      doc(db, 'users', uid),
      {
        rank: evaluation.rank,
        rankLabel: evaluation.rankLabel,
        ratingPoints: evaluation.ratingPoints,
        gamesCount: evaluation.gamesCount,
        totalParties: evaluation.totalParties,
        highestScore: evaluation.highestScore,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch(() => {});
  }

  if (stats.length > 0 && migrated) {
    fetch(`/api/account-sync?uid=${encodeURIComponent(uid)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, gameStats: stats }),
    }).catch(() => {});
  } else if (stats.length > 0) {
    // Synchronisation bidirectionnelle vers le relais serveur si ce navigateur détient déjà des stats locales
    fetch(`/api/account-sync?uid=${encodeURIComponent(uid)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, gameStats: stats }),
    }).catch(() => {});
  }

  notifyStatsListeners(uid, stats);
  return { stats, evaluation };
}

/**
 * Enregistre automatiquement l'activité d'une partie lancée (parties jouées, temps de jeu, présence dans les stats du personnage).
 */
export async function recordGameSessionActivity({
  userProfile,
  gameId,
  gameTitle,
  platformLabel = 'Arcade',
  incrementParty = false,
  addPlayTimeSeconds = 0,
}) {
  if (!userProfile?.uid) return null;
  const uid = userProfile.uid;
  const normGameId = normalizeScoreGameId(gameId || gameTitle);
  const title = String(gameTitle || normGameId).trim();

  const localMap = readLocalStatsMap(uid);
  const prev = sanitizeGameStatEntry(localMap[normGameId] || {
    gameId: normGameId,
    gameTitle: title,
    platformLabel,
    bestScore: 0,
    lastScore: 0,
    totalScore: 0,
    gamesPlayed: 0,
    playTimeSeconds: 0,
    history: [],
    statsFormulaVersion: STATS_FORMULA_VERSION,
  });

  const gamesPlayed = Math.max(1, Number(prev.gamesPlayed || 0) + (incrementParty ? 1 : 0));
  const playTimeSeconds = Number(prev.playTimeSeconds || 0) + Math.max(0, Math.floor(addPlayTimeSeconds));
  const { gameRank, gameRatingPoints } = evaluateSingleGameScore(
    prev.bestScore || 0,
    gamesPlayed,
    playTimeSeconds
  );

  const updated = {
    ...prev,
    gameId: normGameId,
    gameTitle: title,
    platformLabel,
    gamesPlayed,
    playTimeSeconds,
    gameRank,
    gameRatingPoints,
    statsFormulaVersion: STATS_FORMULA_VERSION,
    updatedAtMs: Date.now(),
  };

  localMap[normGameId] = updated;
  writeLocalStatsMap(uid, localMap);

  const nextStatsList = Object.values(localMap).sort(
    (a, b) => (b.bestScore || 0) - (a.bestScore || 0) || (b.updatedAtMs || 0) - (a.updatedAtMs || 0)
  );
  const evaluation = evaluatePlayerRank(nextStatsList);

  fetch(`/api/account-sync?uid=${encodeURIComponent(uid)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, gameStats: [updated] }),
  }).catch(() => {});

  setDoc(
    doc(db, 'users', uid, 'gameStats', normGameId),
    { ...updated, updatedAt: serverTimestamp() },
    { merge: true }
  ).catch(() => {});

  notifyStatsListeners(uid, nextStatsList);
  return { gameStat: updated, allStats: nextStatsList, evaluation };
}

/**
 * Enregistre un score pour un jeu donné dans :
 * 1) Les stats du personnage/joueur : users/{uid}/gameStats/{gameId}
 * 2) Le classement (Leaderboard) du jeu : game_scores/{gameId}/entries/{uid}
 * 3) Met à jour le rang global évalué dans users/{uid}
 */
export async function recordGameScore({
  userProfile,
  gameId,
  gameTitle,
  platformLabel = 'Arcade',
  score,
  source = 'manual',
}) {
  const cleanScore = Math.floor(Number(score));
  if (!Number.isFinite(cleanScore) || cleanScore <= 0) {
    throw new Error('Veuillez entrer un score valide supérieur à 0.');
  }
  if (!userProfile?.uid) {
    throw new Error('Profil joueur introuvable.');
  }

  const uid = userProfile.uid;
  const normGameId = normalizeScoreGameId(gameId || gameTitle);
  const title = String(gameTitle || normGameId).trim();

  if (!isPlausibleGameScore(`${normGameId} ${title}`, cleanScore, source)) {
    return null;
  }

  // Charger les stats existantes
  const { stats: prevStats, evaluation: prevEval } = await loadPlayerGameStats(uid);
  const statsMap = {};
  prevStats.forEach((s) => {
    statsMap[s.gameId] = s;
  });

  const prevGame = sanitizeGameStatEntry(statsMap[normGameId] || {
    gameId: normGameId,
    gameTitle: title,
    platformLabel,
    bestScore: 0,
    lastScore: 0,
    totalScore: 0,
    gamesPlayed: 0,
    playTimeSeconds: 0,
    history: [],
    statsFormulaVersion: STATS_FORMULA_VERSION,
  });

  const previousBest = Number(prevGame.bestScore || 0);
  const isNewRecord = cleanScore > previousBest;
  const newBest = Math.max(previousBest, cleanScore);
  // Seuls les enregistrements manuels ou fins de partie (Game Over / Victoire) comptent une nouvelle partie, jamais les jalons RAM en cours de session
  const countsAsCompletedParty =
    source === 'manual' || source === 'ram_game_over' || source === 'ram_victory';
  const gamesPlayed = Math.max(1, Number(prevGame.gamesPlayed || 0) + (countsAsCompletedParty ? 1 : 0));
  const playTimeSeconds = Math.max(0, Number(prevGame.playTimeSeconds || 0));
  const totalScore = countsAsCompletedParty
    ? Number(prevGame.totalScore || 0) + cleanScore
    : Math.max(Number(prevGame.totalScore || 0), newBest);
  const { gameRank, gameRatingPoints } = evaluateSingleGameScore(newBest, gamesPlayed, playTimeSeconds);

  const history = [
    { score: cleanScore, at: Date.now(), source },
    ...(Array.isArray(prevGame.history) ? prevGame.history : []),
  ].slice(0, 12);

  const updatedGameStat = {
    gameId: normGameId,
    gameTitle: title,
    platformLabel,
    bestScore: newBest,
    lastScore: cleanScore,
    totalScore,
    gamesPlayed,
    playTimeSeconds,
    gameRank,
    gameRatingPoints,
    statsFormulaVersion: STATS_FORMULA_VERSION,
    history,
    updatedAtMs: Date.now(),
  };

  statsMap[normGameId] = updatedGameStat;
  writeLocalStatsMap(uid, statsMap);

  const nextStatsList = Object.values(statsMap).sort((a, b) => (b.bestScore || 0) - (a.bestScore || 0));
  const evaluation = evaluatePlayerRank(nextStatsList);
  const oldRank = prevEval.rank;
  const rankChanged = oldRank !== evaluation.rank;

  // Relais serveur multi-appareils : stats personnelles du compte
  fetch(`/api/account-sync?uid=${encodeURIComponent(uid)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, gameStats: [updatedGameStat] }),
  }).catch(() => {});

  // Persistance Firestore : stats personnelles par jeu
  await setDoc(
    doc(db, 'users', uid, 'gameStats', normGameId),
    {
      ...updatedGameStat,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  ).catch(() => {});

  const lbEntry = {
    uid,
    gameId: normGameId,
    gameTitle: title,
    displayName: userProfile.displayName || userProfile.name || 'Joueur',
    firstName: userProfile.firstName || '',
    lastName: userProfile.lastName || '',
    photoURL: userProfile.photoURL || null,
    region: userProfile.region || 'FR',
    rank: evaluation.rank,
    ratingPoints: evaluation.ratingPoints,
    bestScore: newBest,
    lastScore: cleanScore,
    gamesPlayed,
    gameRank,
    source,
    updatedAtMs: Date.now(),
  };

  // Relais serveur : classement partagé du jeu
  fetch(`/api/game-leaderboard?gameId=${encodeURIComponent(normGameId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lbEntry),
  }).catch(() => {});

  // Cache local du classement du jeu (fonctionne même sans règles Firestore publiées)
  try {
    const lbKey = `csw_local_lb_v1_${normGameId}`;
    const existingLb = JSON.parse(localStorage.getItem(lbKey) || '[]');
    const filtered = (Array.isArray(existingLb) ? existingLb : []).filter((r) => r.uid !== uid);
    filtered.push(lbEntry);
    filtered.sort((a, b) => (b.bestScore || 0) - (a.bestScore || 0));
    localStorage.setItem(lbKey, JSON.stringify(filtered.slice(0, 25)));
    window.dispatchEvent(new CustomEvent('csw-lb-updated', { detail: { gameId: normGameId } }));
  } catch {
    /* noop */
  }

  // Persistance Firestore : classement global du jeu (Leaderboard)
  await setDoc(
    doc(db, 'game_scores', normGameId, 'entries', uid),
    {
      ...lbEntry,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  ).catch(() => {});

  // Persistance Firestore : profil global évalué
  await setDoc(
    doc(db, 'users', uid),
    {
      rank: evaluation.rank,
      rankLabel: evaluation.rankLabel,
      ratingPoints: evaluation.ratingPoints,
      gamesCount: evaluation.gamesCount,
      totalParties: evaluation.totalParties,
      highestScore: evaluation.highestScore,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  ).catch(() => {});

  notifyStatsListeners(uid, nextStatsList);

  return {
    isNewRecord,
    previousBest,
    newBest,
    gameStat: updatedGameStat,
    allStats: nextStatsList,
    evaluation,
    oldRank,
    newRank: evaluation.rank,
    rankChanged,
  };
}

/**
 * Écoute en temps réel le classement (Top 25) des meilleurs scores pour un jeu donné (Firestore + relais serveur + local).
 */
export function subscribeGameLeaderboard(gameId, cb) {
  const normGameId = normalizeScoreGameId(gameId);
  let fsRows = [];
  let relayRows = [];

  const emitMerged = () => {
    let localRows = [];
    try {
      const raw = localStorage.getItem(`csw_local_lb_v1_${normGameId}`);
      localRows = raw ? JSON.parse(raw) : [];
    } catch {
      localRows = [];
    }
    const map = new Map();
    [...(Array.isArray(localRows) ? localRows : []), ...relayRows, ...fsRows].forEach((r) => {
      if (!r?.uid) return;
      const prev = map.get(r.uid);
      if (!prev || Number(r.bestScore || 0) >= Number(prev.bestScore || 0)) {
        map.set(r.uid, r);
      }
    });
    const sorted = Array.from(map.values())
      .sort((a, b) => (b.bestScore || 0) - (a.bestScore || 0))
      .slice(0, 25);
    cb(sorted);
  };

  const pullRelay = async () => {
    try {
      const res = await fetch(`/api/game-leaderboard?gameId=${encodeURIComponent(normGameId)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.rows)) {
          relayRows = data.rows;
          emitMerged();
        }
      }
    } catch {
      /* ignore */
    }
  };

  emitMerged();
  pullRelay();
  const pollId = setInterval(pullRelay, 5000);

  const onLocal = (e) => {
    if (!e?.detail?.gameId || e.detail.gameId === normGameId) {
      emitMerged();
      pullRelay();
    }
  };
  window.addEventListener('csw-lb-updated', onLocal);

  const q = query(
    collection(db, 'game_scores', normGameId, 'entries'),
    orderBy('bestScore', 'desc'),
    limit(25)
  );
  const unsubFs = onSnapshot(
    q,
    (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      fsRows = rows;
      emitMerged();
    },
    () => emitMerged()
  );

  return () => {
    clearInterval(pollId);
    window.removeEventListener('csw-lb-updated', onLocal);
    unsubFs?.();
  };
}
