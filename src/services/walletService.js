/**
 * Pilier 2 : Portefeuille Global Persistant des Coins (0 à 99 crédits).
 */
import { doc, setDoc } from './localFirestore';
import { db } from '../config/firebase';

const STORAGE_KEY = 'csw_wallet_coins_v1';
const UID_KEY = 'csw_player_uid_v1';
const MAX_COINS = 99;
const MIN_COINS = 0;

const listeners = new Set();

function clampCoins(val) {
  const n = Number.parseInt(val, 10);
  if (Number.isNaN(n)) return MIN_COINS;
  return Math.min(MAX_COINS, Math.max(MIN_COINS, n));
}

function getOrCreateUid() {
  if (typeof localStorage === 'undefined') return 'anon';
  let uid = localStorage.getItem(UID_KEY);
  if (!uid) {
    uid = 'p_' + Math.random().toString(36).slice(2, 10);
    try {
      localStorage.setItem(UID_KEY, uid);
    } catch {
      /* noop */
    }
  }
  return uid;
}

let currentCoins = (() => {
  if (typeof localStorage === 'undefined') return 5;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    try {
      localStorage.setItem(STORAGE_KEY, '5');
    } catch {
      /* noop */
    }
    return 5;
  }
  return clampCoins(raw);
})();

function persistCoins(next) {
  currentCoins = clampCoins(next);
  try {
    localStorage.setItem(STORAGE_KEY, String(currentCoins));
  } catch {
    /* noop */
  }
  const uid = getOrCreateUid();
  setDoc(doc(db, 'wallets', uid), { coins: currentCoins, updatedAt: Date.now() }, { merge: true }).catch(() => {});
  listeners.forEach((cb) => {
    try {
      cb(currentCoins);
    } catch {
      /* noop */
    }
  });
  return currentCoins;
}

export function playCoinSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(987.77, now); // B5
    osc.frequency.setValueAtTime(1318.51, now + 0.08); // E6
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.34);
  } catch {
    /* noop */
  }
}

export function getCoins() {
  return currentCoins;
}

export function setWalletCoins(exactVal) {
  return persistCoins(exactVal);
}

export function hasCoins(required = 1) {
  return currentCoins >= required;
}

export function addCoins(amount) {
  const next = persistCoins(currentCoins + Number(amount || 0));
  playCoinSound();
  return next;
}

export function fillMaxCoins() {
  const next = persistCoins(MAX_COINS);
  playCoinSound();
  return next;
}

export function consumeCoin(amount = 1) {
  if (currentCoins < amount) return { ok: false, coins: currentCoins };
  const next = persistCoins(currentCoins - amount);
  playCoinSound();
  return { ok: true, coins: next };
}

export function subscribeWallet(cb) {
  listeners.add(cb);
  cb(currentCoins);
  return () => listeners.delete(cb);
}
