/**
 * Formules pures d'évaluation des scores, assainissement des stats RAM et calcul des Rangs (D -> S+).
 */

export const STATS_FORMULA_VERSION = 2;

export const LOW_SCORE_SPORTS_REGEX =
  /street.*hoop|dunk.*dream|windjammer|flying.*power.*disc|super.*sidekick|soccer|football|futsal|goal.*goal|tennis|golf|baseball|bowling|volleyball|hockey|nba|fifa/i;

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

export function isPlausibleGameScore(gameIdOrTitle, score, source = 'manual') {
  const s = Math.floor(Number(score) || 0);
  if (s <= 0) return false;
  if (String(source || '').startsWith('ram_')) {
    if (LOW_SCORE_SPORTS_REGEX.test(String(gameIdOrTitle || '')) && s > 500) {
      return false;
    }
    if (s > 5000000) {
      return false;
    }
  }
  return true;
}

export function evaluateSingleGameScore(bestScore = 0, gamesPlayed = 1, playTimeSeconds = 0) {
  const s = Math.min(Math.max(0, Math.floor(Number(bestScore) || 0)), 5000000);
  const plays = Math.max(1, Math.floor(Number(gamesPlayed) || 1));
  const minutes = Math.max(0, Math.floor(Math.max(0, Number(playTimeSeconds || 0)) / 60));

  let gameRank = 'D';
  if (s >= 1000000) gameRank = 'S+';
  else if (s >= 350000) gameRank = 'S';
  else if (s >= 100000) gameRank = 'A';
  else if (s >= 25000) gameRank = 'B';
  else if (s >= 5000) gameRank = 'C';

  // Courbe progressive réaliste (max ~221 RP score + 60 RP régularité + 60 RP temps = ~341 RP/jeu max)
  const scoreRp = s > 0 ? Math.round(Math.pow(Math.log10(s + 1), 1.45) * 14) : 0;
  const playBonus = Math.min(plays * 4, 60);
  const timeBonus = Math.min(minutes, 60);
  const gameRatingPoints = scoreRp + playBonus + timeBonus;

  return { gameRank, gameRatingPoints };
}

export function sanitizeGameStatEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  let bestScore = Math.max(0, Math.floor(Number(entry.bestScore || 0)));
  let lastScore = Math.max(0, Math.floor(Number(entry.lastScore || 0)));
  let totalScore = Math.max(0, Math.floor(Number(entry.totalScore || 0)));
  let gamesPlayed = Math.max(1, Math.floor(Number(entry.gamesPlayed || 1)));
  const playTimeSeconds = Math.max(0, Math.floor(Number(entry.playTimeSeconds || 0)));
  const version = Number(entry.statsFormulaVersion || 1);
  const label = `${entry.gameId || ''} ${entry.gameTitle || ''}`;

  if (LOW_SCORE_SPORTS_REGEX.test(label)) {
    if (bestScore > 500) {
      bestScore = 0;
      totalScore = 0;
    }
    if (lastScore > 500) {
      lastScore = 0;
    }
  }

  if (version < STATS_FORMULA_VERSION) {
    if (bestScore > 5000000) {
      bestScore = 0;
      lastScore = 0;
      totalScore = 0;
    }
    if (playTimeSeconds > 0 && gamesPlayed > Math.max(8, Math.ceil(playTimeSeconds / 45))) {
      gamesPlayed = Math.max(1, Math.min(gamesPlayed, Math.max(3, Math.ceil(playTimeSeconds / 90))));
    } else if (
      playTimeSeconds === 0 &&
      gamesPlayed > 20 &&
      Array.isArray(entry.history) &&
      entry.history.some((h) => String(h?.source || '').startsWith('ram_'))
    ) {
      gamesPlayed = Math.max(1, Math.min(gamesPlayed, 5));
    }
  }

  const { gameRank, gameRatingPoints } = evaluateSingleGameScore(bestScore, gamesPlayed, playTimeSeconds);
  return {
    ...entry,
    bestScore,
    lastScore,
    totalScore,
    gamesPlayed,
    playTimeSeconds,
    gameRank,
    gameRatingPoints,
    statsFormulaVersion: STATS_FORMULA_VERSION,
  };
}

export function evaluatePlayerRank(gameStatsList = []) {
  const valid = Array.isArray(gameStatsList) ? gameStatsList.filter(Boolean).map(sanitizeGameStatEntry) : [];
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

  const sorted = [...valid].sort((a, b) => (b.gameRatingPoints || 0) - (a.gameRatingPoints || 0));

  let totalRp = 0;
  let totalParties = 0;
  let highestScore = 0;

  sorted.forEach((st, idx) => {
    const rp = Number(st.gameRatingPoints || 0);
    const weight = idx < 8 ? 1 : 0.5;
    totalRp += Math.round(rp * weight);
    totalParties += Number(st.gamesPlayed || 0);
    if (Number(st.bestScore || 0) > highestScore) {
      highestScore = Number(st.bestScore || 0);
    }
  });

  const diversityBonus = Math.min(Math.max(0, sorted.length - 1) * 35, 420);
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
