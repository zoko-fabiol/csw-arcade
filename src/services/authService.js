/**
 * Service d'Authentification Firebase & Profil Joueur CSW-Arcade / Fightcade 2
 * - Inscription complète : Nom, Prénom, Pseudo, Pays (tous les pays), Email, Mot de passe
 * - Connexion Email / Mot de passe & Google
 * - Rang évalué automatiquement (D -> C -> B -> A -> S -> S+) à partir des meilleurs scores par jeu
 */
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from '../config/firebase';
import { getCoins, setWalletCoins } from './walletService';
import {
  evaluatePlayerRank,
  loadPlayerGameStats,
  subscribeLocalStatsUpdates,
} from './scoreRankingService';

const UID_KEY = 'csw_player_uid_v1';
const NAME_KEY = 'csw_player_name';
const FIRST_NAME_KEY = 'csw_player_first_name_v1';
const LAST_NAME_KEY = 'csw_player_last_name_v1';
const REGION_KEY = 'csw_player_region_v1';
const RANK_KEY = 'csw_player_rank_v1';

const authListeners = new Set();

function getDefaultRegion() {
  try {
    return (
      localStorage.getItem(REGION_KEY) ||
      (typeof navigator !== 'undefined' && (navigator.language || 'fr').slice(0, 2).toUpperCase()) ||
      'FR'
    );
  } catch {
    return 'FR';
  }
}

function getFallbackGuestProfile() {
  let uid = 'p_' + Math.random().toString(36).slice(2, 10);
  let name = 'Joueur';
  let firstName = '';
  let lastName = '';
  let region = getDefaultRegion();
  let rank = 'D';
  try {
    uid = localStorage.getItem(UID_KEY) || uid;
    localStorage.setItem(UID_KEY, uid);
    name = localStorage.getItem(NAME_KEY) || `Joueur_${uid.slice(-4).toUpperCase()}`;
    localStorage.setItem(NAME_KEY, name);
    firstName = localStorage.getItem(FIRST_NAME_KEY) || '';
    lastName = localStorage.getItem(LAST_NAME_KEY) || '';
    rank = localStorage.getItem(RANK_KEY) || 'D';
  } catch {
    /* noop */
  }
  const baseEval = evaluatePlayerRank([]);
  return {
    uid,
    name,
    displayName: name,
    firstName,
    lastName,
    email: null,
    photoURL: null,
    region,
    rank,
    rankLabel: baseEval.rankLabel,
    ratingPoints: 0,
    gamesCount: 0,
    totalParties: 0,
    highestScore: 0,
    nextRank: baseEval.nextRank,
    nextRankThreshold: baseEval.nextRankThreshold,
    progressPercent: 0,
    gameStats: [],
    isAuthenticated: false,
    isAnonymous: true,
    provider: 'guest',
    wins: 0,
    losses: 0,
  };
}

let currentUserProfile = getFallbackGuestProfile();

function notifyAuthListeners() {
  authListeners.forEach((cb) => {
    try {
      cb({ ...currentUserProfile });
    } catch {
      /* noop */
    }
  });
}

// Charger les stats locales/Firestore pour l'invité au démarrage
async function hydrateProfileStats(uid) {
  if (!uid) return;
  const { stats, evaluation } = await loadPlayerGameStats(uid);
  if (currentUserProfile.uid !== uid) return;
  try {
    localStorage.setItem(RANK_KEY, evaluation.rank);
  } catch {
    /* noop */
  }
  currentUserProfile = {
    ...currentUserProfile,
    rank: evaluation.rank,
    rankLabel: evaluation.rankLabel,
    ratingPoints: evaluation.ratingPoints,
    gamesCount: evaluation.gamesCount,
    totalParties: evaluation.totalParties,
    highestScore: evaluation.highestScore,
    nextRank: evaluation.nextRank,
    nextRankThreshold: evaluation.nextRankThreshold,
    progressPercent: evaluation.progressPercent,
    gameStats: stats,
  };
  notifyAuthListeners();
}

// Synchroniser en temps réel dès qu'un score est enregistré
subscribeLocalStatsUpdates(({ uid, stats, evaluation }) => {
  if (currentUserProfile.uid !== uid) return;
  try {
    localStorage.setItem(RANK_KEY, evaluation.rank);
  } catch {
    /* noop */
  }
  currentUserProfile = {
    ...currentUserProfile,
    rank: evaluation.rank,
    rankLabel: evaluation.rankLabel,
    ratingPoints: evaluation.ratingPoints,
    gamesCount: evaluation.gamesCount,
    totalParties: evaluation.totalParties,
    highestScore: evaluation.highestScore,
    nextRank: evaluation.nextRank,
    nextRankThreshold: evaluation.nextRankThreshold,
    progressPercent: evaluation.progressPercent,
    gameStats: stats,
  };
  notifyAuthListeners();
});

async function syncFirestoreUserProfile(firebaseUser, overrides = {}) {
  if (!firebaseUser?.uid) return currentUserProfile;
  const uid = firebaseUser.uid;
  const ref = doc(db, 'users', uid);
  let remoteData = {};
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      remoteData = snap.data() || {};
    }
  } catch {
    /* ignore offline */
  }

  const displayName =
    overrides.displayName ||
    firebaseUser.displayName ||
    remoteData.displayName ||
    localStorage.getItem(NAME_KEY) ||
    (firebaseUser.email ? firebaseUser.email.split('@')[0] : `Joueur_${uid.slice(-4).toUpperCase()}`);

  const firstName =
    overrides.firstName !== undefined
      ? overrides.firstName
      : remoteData.firstName || localStorage.getItem(FIRST_NAME_KEY) || '';
  const lastName =
    overrides.lastName !== undefined
      ? overrides.lastName
      : remoteData.lastName || localStorage.getItem(LAST_NAME_KEY) || '';
  const region = (overrides.region || remoteData.region || getDefaultRegion()).toUpperCase();

  // Évaluer le rang automatiquement à partir des meilleurs scores enregistrés
  const { stats, evaluation } = await loadPlayerGameStats(uid);
  const rank = evaluation.rank;
  const wins = Number(remoteData.wins || 0);
  const losses = Number(remoteData.losses || 0);

  try {
    localStorage.setItem(UID_KEY, uid);
    localStorage.setItem(NAME_KEY, displayName);
    localStorage.setItem(FIRST_NAME_KEY, firstName);
    localStorage.setItem(LAST_NAME_KEY, lastName);
    localStorage.setItem(REGION_KEY, region);
    localStorage.setItem(RANK_KEY, rank);
  } catch {
    /* noop */
  }

  const profilePayload = {
    uid,
    name: displayName,
    displayName,
    firstName,
    lastName,
    email: firebaseUser.email || remoteData.email || null,
    photoURL: firebaseUser.photoURL || remoteData.photoURL || null,
    region,
    rank,
    rankLabel: evaluation.rankLabel,
    ratingPoints: evaluation.ratingPoints,
    gamesCount: evaluation.gamesCount,
    totalParties: evaluation.totalParties,
    highestScore: evaluation.highestScore,
    nextRank: evaluation.nextRank,
    nextRankThreshold: evaluation.nextRankThreshold,
    progressPercent: evaluation.progressPercent,
    gameStats: stats,
    wins,
    losses,
    isAuthenticated: !firebaseUser.isAnonymous,
    isAnonymous: Boolean(firebaseUser.isAnonymous),
    provider: firebaseUser.isAnonymous
      ? 'anonymous'
      : firebaseUser.providerData?.[0]?.providerId || 'password',
    coins: typeof remoteData.coins === 'number' ? remoteData.coins : getCoins(),
  };

  if (typeof remoteData.coins === 'number') {
    setWalletCoins(remoteData.coins);
  }

  const firestoreDoc = { ...profilePayload, updatedAt: serverTimestamp() };
  delete firestoreDoc.gameStats;
  setDoc(ref, firestoreDoc, { merge: true }).catch(() => {});

  currentUserProfile = profilePayload;
  notifyAuthListeners();
  return currentUserProfile;
}

if (typeof window !== 'undefined') {
  hydrateProfileStats(currentUserProfile.uid);
  onAuthStateChanged(auth, async (fbUser) => {
    if (fbUser) {
      await syncFirestoreUserProfile(fbUser);
    } else {
      currentUserProfile = getFallbackGuestProfile();
      notifyAuthListeners();
      hydrateProfileStats(currentUserProfile.uid);
    }
  });
}

export function getCurrentUserProfile() {
  return { ...currentUserProfile };
}

export function subscribeAuthProfile(cb) {
  authListeners.add(cb);
  cb({ ...currentUserProfile });
  return () => authListeners.delete(cb);
}

export async function registerWithEmail({
  firstName,
  lastName,
  displayName,
  region = 'FR',
  email,
  password,
}) {
  const cleanFirst = String(firstName || '').trim().slice(0, 40);
  const cleanLast = String(lastName || '').trim().slice(0, 40);
  const cleanEmail = String(email || '').trim();
  const cleanName = String(displayName || '').trim().slice(0, 24);
  const cleanRegion = String(region || 'FR').trim().toUpperCase().slice(0, 2);

  if (!cleanLast || !cleanFirst) {
    throw new Error('Veuillez renseigner votre nom et votre prénom.');
  }
  if (!cleanName) {
    throw new Error('Veuillez choisir un pseudo.');
  }
  if (!cleanEmail || !password) {
    throw new Error('Veuillez renseigner un email et un mot de passe.');
  }
  if (password.length < 6) {
    throw new Error('Le mot de passe doit contenir au moins 6 caractères.');
  }

  const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
  if (cred.user && cleanName) {
    await updateProfile(cred.user, { displayName: cleanName }).catch(() => {});
  }
  return await syncFirestoreUserProfile(cred.user, {
    firstName: cleanFirst,
    lastName: cleanLast,
    displayName: cleanName,
    region: cleanRegion,
  });
}

export async function loginWithEmail({ email, password }) {
  const cleanEmail = String(email || '').trim();
  if (!cleanEmail || !password) {
    throw new Error('Veuillez renseigner votre email et votre mot de passe.');
  }
  const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
  return await syncFirestoreUserProfile(cred.user);
}

export async function loginWithGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  const parts = String(cred.user?.displayName || '').trim().split(/\s+/);
  return await syncFirestoreUserProfile(cred.user, {
    firstName: parts[0] || undefined,
    lastName: parts.slice(1).join(' ') || undefined,
  });
}

export async function loginAsGuest({ firstName = '', lastName = '', displayName, region = 'FR' } = {}) {
  const cleanName = String(displayName || '').trim().slice(0, 24);
  try {
    const cred = await signInAnonymously(auth);
    if (cred.user && cleanName) {
      await updateProfile(cred.user, { displayName: cleanName }).catch(() => {});
    }
    return await syncFirestoreUserProfile(cred.user, {
      firstName: String(firstName || '').trim(),
      lastName: String(lastName || '').trim(),
      displayName: cleanName || undefined,
      region,
    });
  } catch {
    return await updateUserProfile({
      firstName,
      lastName,
      displayName: cleanName || currentUserProfile.name,
      region,
    });
  }
}

export async function updateUserProfile({ firstName, lastName, displayName, region }) {
  const cleanName = String(displayName || currentUserProfile.name || 'Joueur').trim().slice(0, 24);
  const cleanFirst = String(
    firstName !== undefined ? firstName : currentUserProfile.firstName || ''
  ).trim().slice(0, 40);
  const cleanLast = String(
    lastName !== undefined ? lastName : currentUserProfile.lastName || ''
  ).trim().slice(0, 40);
  const cleanRegion = String(region || currentUserProfile.region || 'FR').trim().toUpperCase().slice(0, 2);

  try {
    localStorage.setItem(NAME_KEY, cleanName);
    localStorage.setItem(FIRST_NAME_KEY, cleanFirst);
    localStorage.setItem(LAST_NAME_KEY, cleanLast);
    localStorage.setItem(REGION_KEY, cleanRegion);
  } catch {
    /* noop */
  }

  if (auth.currentUser) {
    await updateProfile(auth.currentUser, { displayName: cleanName }).catch(() => {});
    return await syncFirestoreUserProfile(auth.currentUser, {
      firstName: cleanFirst,
      lastName: cleanLast,
      displayName: cleanName,
      region: cleanRegion,
    });
  }

  currentUserProfile = {
    ...currentUserProfile,
    name: cleanName,
    displayName: cleanName,
    firstName: cleanFirst,
    lastName: cleanLast,
    region: cleanRegion,
  };
  setDoc(
    doc(db, 'users', currentUserProfile.uid),
    {
      uid: currentUserProfile.uid,
      displayName: cleanName,
      firstName: cleanFirst,
      lastName: cleanLast,
      region: cleanRegion,
      rank: currentUserProfile.rank,
      ratingPoints: currentUserProfile.ratingPoints || 0,
      coins: getCoins(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  ).catch(() => {});
  notifyAuthListeners();
  return currentUserProfile;
}

export async function logoutUser() {
  try {
    await signOut(auth);
  } catch {
    /* noop */
  }
  try {
    const newGuestUid = 'p_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(UID_KEY, newGuestUid);
    localStorage.setItem(NAME_KEY, `Joueur_${newGuestUid.slice(-4).toUpperCase()}`);
    localStorage.removeItem(FIRST_NAME_KEY);
    localStorage.removeItem(LAST_NAME_KEY);
    localStorage.setItem(RANK_KEY, 'D');
  } catch {
    /* noop */
  }
  currentUserProfile = getFallbackGuestProfile();
  notifyAuthListeners();
  return currentUserProfile;
}

export function formatFirebaseAuthError(err) {
  const code = String(err?.code || '');
  if (code.includes('auth/invalid-credential') || code.includes('auth/wrong-password') || code.includes('auth/user-not-found')) {
    return 'Email ou mot de passe incorrect.';
  }
  if (code.includes('auth/email-already-in-use')) {
    return 'Cet email est déjà utilisé par un compte CSW-Arcade.';
  }
  if (code.includes('auth/invalid-email')) {
    return 'Format d’adresse email invalide.';
  }
  if (code.includes('auth/weak-password')) {
    return 'Mot de passe trop faible (6 caractères minimum).';
  }
  if (code.includes('auth/popup-closed-by-user')) {
    return 'Fenêtre de connexion Google fermée.';
  }
  if (code.includes('auth/operation-not-allowed')) {
    return 'Cette méthode de connexion doit être activée dans la console Firebase Authentication.';
  }
  return err?.message || 'Erreur d’authentification Firebase.';
}
