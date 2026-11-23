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
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from './localFirestore';
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

function clearLegacyLocalPhotos() {
  try {
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('csw_player_photo_v1_')) toDelete.push(k);
    }
    toDelete.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* noop */
  }
}
if (typeof window !== 'undefined') clearLegacyLocalPhotos();

export function getPlayerFriendCode(uid) {
  const clean = String(uid || '0000').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return (clean.slice(-4) || '0000').padStart(4, '0');
}

export function getPlayerFriendTag(displayName, uid) {
  const base = String(displayName || 'Joueur').trim().replace(/#[a-zA-Z0-9]+$/, '') || 'Joueur';
  return `${base}#${getPlayerFriendCode(uid)}`;
}

function pushDirectoryProfile(profile) {
  if (!profile?.uid || typeof fetch !== 'function') return;
  fetch('/api/friends', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'register_profile',
      user: {
        uid: profile.uid,
        name: profile.displayName || profile.name,
        displayName: profile.displayName || profile.name,
        firstName: profile.firstName || '',
        lastName: profile.lastName || '',
        email: profile.email || null,
        friendCode: getPlayerFriendCode(profile.uid),
        friendTag: getPlayerFriendTag(profile.displayName || profile.name, profile.uid),
        region: profile.region || 'FR',
        rank: profile.rank || 'D',
        ratingPoints: Number(profile.ratingPoints || 0),
        photoURL: profile.photoURL || null,
        isAuthenticated: Boolean(profile.isAuthenticated),
      },
    }),
  }).catch(() => {});
}

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
  const friendCode = getPlayerFriendCode(uid);
  return {
    uid,
    name,
    displayName: name,
    friendCode,
    friendTag: getPlayerFriendTag(name, uid),
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

// Charger les stats & la photo Firestore pour le joueur au démarrage
let activeUserDocUnsub = null;
let activeUserDocUid = null;

function watchFirestoreUserDoc(uid) {
  if (!uid || activeUserDocUid === uid) return;
  activeUserDocUnsub?.();
  activeUserDocUid = uid;
  try {
    activeUserDocUnsub = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (!snap.exists() || currentUserProfile.uid !== uid) return;
        const d = snap.data() || {};
        const nextPhoto = d.photoURL
          ? d.photoURL
          : d.photoCleared
          ? null
          : auth.currentUser?.photoURL || currentUserProfile.photoURL || null;
        if (nextPhoto !== currentUserProfile.photoURL) {
          currentUserProfile = {
            ...currentUserProfile,
            photoURL: nextPhoto,
          };
          pushDirectoryProfile(currentUserProfile);
          notifyAuthListeners();
        }
      },
      () => {}
    );
  } catch {
    /* noop */
  }
}

async function hydrateProfileStats(uid) {
  if (!uid) return;
  watchFirestoreUserDoc(uid);
  const [snapRes, statsRes] = await Promise.all([
    getDoc(doc(db, 'users', uid)).catch(() => null),
    loadPlayerGameStats(uid),
  ]);
  let remotePhoto = currentUserProfile.photoURL;
  if (snapRes?.exists?.()) {
    const d = snapRes.data() || {};
    if (d.photoURL !== undefined) remotePhoto = d.photoURL;
  }
  const { stats, evaluation } = statsRes;
  if (currentUserProfile.uid !== uid) return;
  try {
    localStorage.setItem(RANK_KEY, evaluation.rank);
  } catch {
    /* noop */
  }
  currentUserProfile = {
    ...currentUserProfile,
    photoURL: remotePhoto ?? null,
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
  pushDirectoryProfile(currentUserProfile);
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
  pushDirectoryProfile(currentUserProfile);
  notifyAuthListeners();
});

async function syncFirestoreUserProfile(firebaseUser, overrides = {}) {
  if (!firebaseUser?.uid) return currentUserProfile;
  const uid = firebaseUser.uid;
  const ref = doc(db, 'users', uid);
  const [snapRes, statsRes] = await Promise.all([
    getDoc(ref).catch(() => null),
    loadPlayerGameStats(uid),
  ]);
  let remoteData = {};
  if (snapRes?.exists?.()) {
    remoteData = snapRes.data() || {};
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
  const photoCleared =
    overrides.photoURL === null
      ? true
      : overrides.photoURL
      ? false
      : Boolean(remoteData.photoCleared);
  const photoURL =
    overrides.photoURL !== undefined
      ? overrides.photoURL
      : remoteData.photoURL
      ? remoteData.photoURL
      : photoCleared
      ? null
      : firebaseUser.photoURL || null;

  // Évaluer le rang automatiquement à partir des meilleurs scores enregistrés
  const { stats, evaluation } = statsRes;
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

  const friendCode = getPlayerFriendCode(uid);
  const friendTag = getPlayerFriendTag(displayName, uid);
  const profilePayload = {
    uid,
    name: displayName,
    displayName,
    friendCode,
    friendTag,
    firstName,
    lastName,
    email: firebaseUser.email || remoteData.email || null,
    photoURL,
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

  const firestoreDoc = { ...profilePayload, photoCleared, updatedAt: serverTimestamp() };
  delete firestoreDoc.gameStats;
  if (overrides && Object.keys(overrides).length > 0) {
    try {
      await setDoc(ref, firestoreDoc, { merge: true });
    } catch (err) {
      if (overrides.photoURL !== undefined) {
        throw new Error(
          `Impossible d'enregistrer la photo sur Firestore (${err?.code || err?.message || 'accès refusé'}). Déployez les règles Firestore.`
        );
      }
    }
  } else {
    setDoc(ref, firestoreDoc, { merge: true }).catch(() => {});
  }

  watchFirestoreUserDoc(uid);
  currentUserProfile = profilePayload;
  pushDirectoryProfile(currentUserProfile);
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

export async function loginAsGuest({ firstName = '', lastName = '', displayName, region = 'FR', photoURL } = {}) {
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
      ...(photoURL !== undefined ? { photoURL } : {}),
    });
  } catch {
    return await updateUserProfile({
      firstName,
      lastName,
      displayName: cleanName || currentUserProfile.name,
      region,
      ...(photoURL !== undefined ? { photoURL } : {}),
    });
  }
}

export async function updateUserProfile({ firstName, lastName, displayName, region, photoURL }) {
  const cleanName = String(displayName || currentUserProfile.name || 'Joueur').trim().slice(0, 24);
  const cleanFirst = String(
    firstName !== undefined ? firstName : currentUserProfile.firstName || ''
  ).trim().slice(0, 40);
  const cleanLast = String(
    lastName !== undefined ? lastName : currentUserProfile.lastName || ''
  ).trim().slice(0, 40);
  const cleanRegion = String(region || currentUserProfile.region || 'FR').trim().toUpperCase().slice(0, 2);
  const nextPhoto = photoURL !== undefined ? photoURL : (currentUserProfile.photoURL || null);

  try {
    localStorage.setItem(NAME_KEY, cleanName);
    localStorage.setItem(FIRST_NAME_KEY, cleanFirst);
    localStorage.setItem(LAST_NAME_KEY, cleanLast);
    localStorage.setItem(REGION_KEY, cleanRegion);
  } catch {
    /* noop */
  }

  if (auth.currentUser) {
    const authPatch = { displayName: cleanName };
    if (
      nextPhoto === null ||
      (typeof nextPhoto === 'string' && !nextPhoto.startsWith('data:') && nextPhoto.length < 1800)
    ) {
      authPatch.photoURL = nextPhoto || '';
    }
    await updateProfile(auth.currentUser, authPatch).catch(() => {});
    return await syncFirestoreUserProfile(auth.currentUser, {
      firstName: cleanFirst,
      lastName: cleanLast,
      displayName: cleanName,
      region: cleanRegion,
      ...(photoURL !== undefined ? { photoURL: nextPhoto } : {}),
    });
  }

  const friendCode = getPlayerFriendCode(currentUserProfile.uid);
  const friendTag = getPlayerFriendTag(cleanName, currentUserProfile.uid);
  const guestDoc = {
    uid: currentUserProfile.uid,
    displayName: cleanName,
    friendCode,
    friendTag,
    firstName: cleanFirst,
    lastName: cleanLast,
    region: cleanRegion,
    photoURL: nextPhoto,
    photoCleared: photoURL === null,
    rank: currentUserProfile.rank,
    ratingPoints: currentUserProfile.ratingPoints || 0,
    coins: getCoins(),
    updatedAt: serverTimestamp(),
  };

  if (photoURL !== undefined) {
    try {
      await setDoc(doc(db, 'users', currentUserProfile.uid), guestDoc, { merge: true });
    } catch (err) {
      throw new Error(
        `Impossible d'enregistrer la photo sur Firestore (${err?.code || err?.message || 'accès refusé'}). Déployez les règles Firestore.`
      );
    }
  } else {
    setDoc(doc(db, 'users', currentUserProfile.uid), guestDoc, { merge: true }).catch(() => {});
  }

  currentUserProfile = {
    ...currentUserProfile,
    name: cleanName,
    displayName: cleanName,
    friendCode,
    friendTag,
    firstName: cleanFirst,
    lastName: cleanLast,
    region: cleanRegion,
    photoURL: nextPhoto,
  };
  pushDirectoryProfile(currentUserProfile);
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
