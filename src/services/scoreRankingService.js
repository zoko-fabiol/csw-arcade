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

const LOCAL_STATS_PREFIX = 'csw_player_game_stats_v1_';
const statsListeners = new Set();

export const RANK_TIERS = [
  { id: 'D', label: 'Débutant', minRp: 0, color: 'text-neutral-300 border-neutral-600 bg-neutral-800/80' },
  { id: 'C', label: 'Challenger', minRp: 300, color: 'text-emerald-300 border-emerald-500/60 bg-emerald-950/60' },
  { id: 'B', label: 'Combattant', minRp: 800, color: 'text-cyan-300 border-cyan-500/60 bg-cyan-950/60' },
  { id: 'A', label: 'Vétéran', minRp: 1600, color: 'text-purple-300 border-purple-500/60 bg-purple-950/60' },
  { id: 'S', label: 'Maître Arcade', minRp: 3000, color: 'text-amber-300 border-amber-500/60 bg-amber-950/60' },
  { id: 'S+', label: 'Légende CSW', minRp: 5000, color: 'text-rose-200 border-rose-400 bg-gradient-to-r from-amber-600/40 to-rose-600/40' },
];

export function getRankTierMeta(rankId) {
  return RANK_TIERS.find((t) => t.id === rankId) || RANK_TIERS[0];
}

export function normalizeScoreGameId(gameIdOrTitle) {
  return String(gameIdOrTitle || 'arcade')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
}

/**
 * Évalue le rang obtenu sur un jeu précis en fonction du meilleur score enregistré.
 */
export function evaluateSingleGameScore(bestScore = 0, gamesPlayed = 1) {
  const s = Math.max(0, Math.floor(Number(bestScore) || 0));
  const plays = Math.max(1, Math.floor(Number(gamesPlayed) || 1));

  let gameRank = 'D';
  if (s >= 1000000) gameRank = 'S+';
  else if (s >= 350000) gameRank = 'S';
  else if (s >= 100000) gameRank = 'A';
  else if (s >= 25000) gameRank = 'B';
  else if (s >= 5000) gameRank = 'C';

  // Courbe logarithmique progressive + régularité
  const scoreRp = s > 0 ? Math.round(Math.pow(Math.log10(s + 10), 2.15) * 42) : 0;
  const playBonus = Math.min(plays * 20, 220);
  const gameRatingPoints = scoreRp + playBonus;

  return { gameRank, gameRatingPoints };
}

/**
 * Évalue le Rang Global du joueur en fonction de tous les jeux qu'il joue et de ses meilleurs scores.
 */
export function evaluatePlayerRank(gameStatsList = []) {
  const valid = Array.isArray(gameStatsList) ? gameStatsList.filter(Boolean) : [];
  if (valid.length === 0) {
    return {
      rank: 'D',
      rankLabel: 'Débutant',
      ratingPoints: 0,
      gamesCount: 0,
      totalParties: 0,
      highestScore: 0,
      nextRank: 'C',
      nextRankThreshold: 300,
      progressPercent: 0,
    };
  }

  // Trier par maîtrise décroissante
  const sorted = [...valid].sort((a, b) => (b.gameRatingPoints || 0) - (a.gameRatingPoints || 0));

  let totalRp = 0;
  let totalParties = 0;
  let highestScore = 0;

  sorted.forEach((st, idx) => {
    const rp = Number(st.gameRatingPoints || 0);
    // Les 5 meilleurs jeux comptent à 100%, les suivants apportent un bonus de polyvalence (45%)
    const weight = idx < 5 ? 1 : 0.45;
    totalRp += Math.round(rp * weight);
    totalParties += Number(st.gamesPlayed || 0);
    if (Number(st.bestScore || 0) > highestScore) {
      highestScore = Number(st.bestScore || 0);
    }
  });

  // Bonus polyvalence : jouer et scorer sur plusieurs jeux différents augmente l'évaluation
  const diversityBonus = Math.min(Math.max(0, sorted.length - 1) * 75, 600);
  const ratingPoints = totalRp + diversityBonus;

  let currentTier = RANK_TIERS[0];
  let nextTier = RANK_TIERS[1];
  for (let i = 0; i < RANK_TIERS.length; i++) {
    if (ratingPoints >= RANK_TIERS[i].minRp) {
      currentTier = RANK_TIERS[i];
      nextTier = RANK_TIERS[i + 1] || null;
    }
  }

  let progressPercent = 100;
  if (nextTier) {
    const span = Math.max(1, nextTier.minRp - currentTier.minRp);
    progressPercent = Math.min(100, Math.max(0, Math.round(((ratingPoints - currentTier.minRp) / span) * 100)));
  }

  return {
    rank: currentTier.id,
    rankLabel: currentTier.label,
    ratingPoints,
    gamesCount: sorted.length,
    totalParties,
    highestScore,
    nextRank: nextTier ? nextTier.id : null,
    nextRankThreshold: nextTier ? nextTier.minRp : currentTier.minRp,
    progressPercent,
  };
}

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

/**
 * Charge toutes les stats de jeux d'un joueur (fusion localStorage + Firestore users/{uid}/gameStats).
 */
export async function loadPlayerGameStats(uid) {
  if (!uid) return { stats: [], evaluation: evaluatePlayerRank([]) };
  const localMap = readLocalStatsMap(uid);

  try {
    const snap = await getDocs(collection(db, 'users', uid, 'gameStats'));
    snap.forEach((d) => {
      const remote = d.data();
      if (!remote?.gameId) return;
      const existing = localMap[remote.gameId];
      if (!existing || Number(remote.bestScore || 0) >= Number(existing.bestScore || 0)) {
        localMap[remote.gameId] = { ...existing, ...remote };
      }
    });
    writeLocalStatsMap(uid, localMap);
  } catch {
    /* offline fallback */
  }

  const stats = Object.values(localMap).sort((a, b) => (b.bestScore || 0) - (a.bestScore || 0));
  const evaluation = evaluatePlayerRank(stats);
  return { stats, evaluation };
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

  // Charger les stats existantes
  const { stats: prevStats, evaluation: prevEval } = await loadPlayerGameStats(uid);
  const statsMap = {};
  prevStats.forEach((s) => {
    statsMap[s.gameId] = s;
  });

  const prevGame = statsMap[normGameId] || {
    gameId: normGameId,
    gameTitle: title,
    platformLabel,
    bestScore: 0,
    lastScore: 0,
    totalScore: 0,
    gamesPlayed: 0,
    history: [],
  };

  const previousBest = Number(prevGame.bestScore || 0);
  const isNewRecord = cleanScore > previousBest;
  const newBest = Math.max(previousBest, cleanScore);
  const gamesPlayed = Number(prevGame.gamesPlayed || 0) + 1;
  const totalScore = Number(prevGame.totalScore || 0) + cleanScore;
  const { gameRank, gameRatingPoints } = evaluateSingleGameScore(newBest, gamesPlayed);

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
    gameRank,
    gameRatingPoints,
    history,
    updatedAtMs: Date.now(),
  };

  statsMap[normGameId] = updatedGameStat;
  writeLocalStatsMap(uid, statsMap);

  const nextStatsList = Object.values(statsMap).sort((a, b) => (b.bestScore || 0) - (a.bestScore || 0));
  const evaluation = evaluatePlayerRank(nextStatsList);
  const oldRank = prevEval.rank;
  const rankChanged = oldRank !== evaluation.rank;

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
 * Écoute en temps réel le classement (Top 25) des meilleurs scores pour un jeu donné (Firestore + local).
 */
export function subscribeGameLeaderboard(gameId, cb) {
  const normGameId = normalizeScoreGameId(gameId);
  let fsRows = [];

  const emitMerged = () => {
    let localRows = [];
    try {
      const raw = localStorage.getItem(`csw_local_lb_v1_${normGameId}`);
      localRows = raw ? JSON.parse(raw) : [];
    } catch {
      localRows = [];
    }
    const map = new Map();
    [...(Array.isArray(localRows) ? localRows : []), ...fsRows].forEach((r) => {
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

  emitMerged();
  const onLocal = (e) => {
    if (!e?.detail?.gameId || e.detail.gameId === normGameId) emitMerged();
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
    window.removeEventListener('csw-lb-updated', onLocal);
    unsubFs?.();
  };
}
