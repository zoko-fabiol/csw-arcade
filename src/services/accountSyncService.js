/**
 * Synchronisation Parfaite du Compte Multi-Appareils & Reprise de Partie Instantanée (Cloud Handoff)
 * Synchronise en temps réel sur tous les appareils connectés au même compte (uid) :
 * - Portefeuille de Crédits (0-99)
 * - Salons Fightcade 2 actifs (jusqu'à 3 jeux) & salon ouvert
 * - Partie en cours + Checkpoint Savestate compressé (gzip) pour poursuivre exactement au même endroit sur un autre appareil
 * Double couche : Firebase Firestore (Internet) + Relais serveur /api/account-sync & BroadcastChannel (Instantané LAN / multi-onglets)
 */
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from './localFirestore';
import { db } from '../config/firebase';
import { supportsOnlineMultiplayer } from '../utils/gameCapabilities';

const DEVICE_ID_KEY = 'csw_device_session_id_v1';
const HANDOFF_MAX_AGE_MS = 3 * 60 * 1000; // Expiration automatique après 3 minutes d'inactivité

export function getDeviceInfo() {
  let deviceId = 'dev_' + Math.random().toString(36).slice(2, 10);
  try {
    deviceId = localStorage.getItem(DEVICE_ID_KEY) || sessionStorage.getItem(DEVICE_ID_KEY) || deviceId;
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
    sessionStorage.setItem(DEVICE_ID_KEY, deviceId);
  } catch {
    /* noop */
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  let deviceName = 'Navigateur Web';
  if (/iPhone|iPad|iPod/i.test(ua)) deviceName = 'iPhone / iPad';
  else if (/Android/i.test(ua)) deviceName = 'Smartphone Android';
  else if (/Windows/i.test(ua)) deviceName = 'PC Windows';
  else if (/Macintosh|Mac OS/i.test(ua)) deviceName = 'Mac';
  else if (/Linux/i.test(ua)) deviceName = 'PC Linux';

  return { deviceId, deviceName };
}

function uint8ToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToUint8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function compressStateBase64(rawBase64) {
  if (!rawBase64) return null;
  try {
    if (typeof CompressionStream !== 'undefined') {
      const rawBytes = base64ToUint8(rawBase64);
      const cs = new CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      writer.write(rawBytes);
      writer.close();
      const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
      return { encoding: 'gzip', dataBase64: uint8ToBase64(compressed) };
    }
  } catch {
    /* fallback raw */
  }
  return { encoding: 'raw', dataBase64: rawBase64 };
}

export async function decompressStateToBase64(statePayload) {
  if (!statePayload?.dataBase64) return null;
  if (statePayload.encoding !== 'gzip') return statePayload.dataBase64;
  try {
    if (typeof DecompressionStream !== 'undefined') {
      const gzBytes = base64ToUint8(statePayload.dataBase64);
      const ds = new DecompressionStream('gzip');
      const writer = ds.writable.getWriter();
      writer.write(gzBytes);
      writer.close();
      const raw = new Uint8Array(await new Response(ds.readable).arrayBuffer());
      return uint8ToBase64(raw);
    }
  } catch {
    return null;
  }
  return null;
}

function emitSyncBus(uid, patch) {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('csw_account_sync_v1');
      bc.postMessage({ uid, patch, at: Date.now() });
      bc.close();
    }
  } catch {
    /* noop */
  }
}

function stripUndefinedDeep(val) {
  if (Array.isArray(val)) return val.map(stripUndefinedDeep).filter((v) => v !== undefined);
  if (val && typeof val === 'object' && Object.getPrototypeOf(val) === Object.prototype) {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) out[k] = stripUndefinedDeep(v);
    }
    return out;
  }
  return val;
}

async function postAccountPatch(uid, patch) {
  if (!uid) return;
  const now = Date.now();
  const payload = stripUndefinedDeep({ uid, ...patch, updatedAtMs: now });

  // 1. Relais serveur / LAN + BroadcastChannel multi-onglets
  emitSyncBus(uid, payload);
  fetch(`/api/account-sync?uid=${encodeURIComponent(uid)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});

  // 2. Cloud Firebase Firestore (document présence/compte léger, sans gros blob)
  const fsDoc = { ...payload, updatedAt: serverTimestamp() };
  delete fsDoc.statePayload;
  setDoc(doc(db, 'users', uid, 'sync', 'state'), fsDoc, { merge: true }).catch(() => {});

  // Si un savestate compressé est fourni et tient dans la limite Firestore (< 750 Ko base64), le pousser aussi dans Firestore !
  if (patch.statePayload?.dataBase64 && patch.statePayload.dataBase64.length < 750000) {
    setDoc(
      doc(db, 'users', uid, 'sync', 'handoff_state'),
      {
        ...patch.statePayload,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch(() => {});
  }
}

export function pushCoinsSync(uid, coins) {
  if (!uid) return;
  const now = Date.now();
  return postAccountPatch(uid, { coins, coinsUpdatedAtMs: now });
}

export function pushChannelsSync(uid, activeChannels, selectedChannelId) {
  if (!uid) return;
  const now = Date.now();
  const dev = getDeviceInfo();
  // Préserver players & supportsMultiplayer pour que la validation multijoueur reste intacte après synchro
  const cleanChannels = (Array.isArray(activeChannels) ? activeChannels : []).slice(0, 3).map((ch) => ({
    gameId: ch.gameId,
    title: ch.title,
    platformLabel: ch.platformLabel || 'Arcade',
    filename: ch.filename || '',
    joinedAt: ch.joinedAt || now,
    entry: ch.entry
      ? {
          id: ch.entry.id,
          title: ch.entry.title,
          core: ch.entry.core,
          platform: ch.entry.platform,
          platformLabel: ch.entry.platformLabel,
          filename: ch.entry.filename,
          players: ch.entry.players ?? null,
          maxPlayers: ch.entry.maxPlayers ?? null,
          supportsMultiplayer:
            typeof ch.entry.supportsMultiplayer === 'boolean'
              ? ch.entry.supportsMultiplayer
              : supportsOnlineMultiplayer(ch.entry),
          urls: Array.isArray(ch.entry.urls) ? ch.entry.urls.slice(0, 4) : [],
          imageUrl: ch.entry.imageUrl || ch.entry.coverUrl || null,
        }
      : null,
  }));
  return postAccountPatch(uid, {
    activeChannels: cleanChannels,
    channelsUpdatedAtMs: now,
    channelsSourceDeviceId: dev.deviceId,
    selectedChannelId: selectedChannelId ?? null,
  });
}

export function pushActiveSession(uid, sessionMeta) {
  if (!uid) return;
  const dev = getDeviceInfo();
  const cleanSession = sessionMeta
    ? {
        deviceId: dev.deviceId,
        deviceName: dev.deviceName,
        gameId: sessionMeta.gameId,
        title: sessionMeta.title,
        core: sessionMeta.core,
        kind: sessionMeta.kind || (sessionMeta.core === 'j2me' ? 'j2me' : 'emu'),
        platformLabel: sessionMeta.platformLabel || sessionMeta.core?.toUpperCase() || 'Arcade',
        filename: sessionMeta.filename || '',
        gameEntry: sessionMeta.gameEntry
          ? {
              id: sessionMeta.gameEntry.id || sessionMeta.gameId,
              title: sessionMeta.gameEntry.title || sessionMeta.title,
              core: sessionMeta.gameEntry.core || sessionMeta.core,
              platform: sessionMeta.gameEntry.platform || sessionMeta.core,
              platformLabel: sessionMeta.gameEntry.platformLabel || sessionMeta.platformLabel,
              filename: sessionMeta.gameEntry.filename || sessionMeta.filename,
              urls: Array.isArray(sessionMeta.gameEntry.urls) ? sessionMeta.gameEntry.urls.slice(0, 4) : [],
              imageUrl: sessionMeta.gameEntry.imageUrl || sessionMeta.gameEntry.coverUrl || null,
            }
          : null,
        inSalon: Boolean(sessionMeta.inSalon),
        status: sessionMeta.status || 'playing',
        hasSavestate: Boolean(sessionMeta.hasSavestate),
        updatedAtMs: Date.now(),
      }
    : null;

  if (!sessionMeta) {
    try {
      setDoc(doc(db, 'users', uid, 'sync', 'handoff_state'), { dataBase64: null, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
    } catch {}
  }

  return postAccountPatch(uid, { activeSession: cleanSession, hasSavestate: Boolean(cleanSession?.hasSavestate) });
}

export async function pushCloudSavestate(uid, gameId, rawStateBase64) {
  if (!uid || !gameId || !rawStateBase64) return false;
  const compressed = await compressStateBase64(rawStateBase64);
  if (!compressed?.dataBase64) return false;
  await postAccountPatch(uid, {
    statePayload: {
      gameId,
      encoding: compressed.encoding,
      dataBase64: compressed.dataBase64,
      savedAtMs: Date.now(),
    },
  });
  return true;
}

export async function fetchCloudSavestate(uid, expectedGameId) {
  if (!uid) return null;
  // 1. Essayer le relais serveur rapide (/api/account-sync?includeState=1)
  try {
    const res = await fetch(`/api/account-sync?uid=${encodeURIComponent(uid)}&includeState=1`);
    if (res.ok) {
      const data = await res.json();
      const sp = data?.statePayload;
      if (sp?.dataBase64 && (!expectedGameId || sp.gameId === expectedGameId)) {
        const raw = await decompressStateToBase64(sp);
        if (raw) return raw;
      }
    }
  } catch {
    /* fallback Firestore */
  }

  // 2. Fallback Cloud Firebase Firestore
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'sync', 'handoff_state'));
    if (snap.exists()) {
      const sp = snap.data();
      if (sp?.dataBase64 && (!expectedGameId || sp.gameId === expectedGameId)) {
        return await decompressStateToBase64(sp);
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function subscribeAccountSync(uid, onUpdate) {
  if (!uid) return () => {};
  let latestRelay = null;
  let latestFs = null;

  const emitMerged = () => {
    const r = latestRelay || {};
    const f = latestFs || {};
    const useFsCoins = (f.coinsUpdatedAtMs || 0) > (r.coinsUpdatedAtMs || 0);
    const useFsChannels = (f.channelsUpdatedAtMs || 0) > (r.channelsUpdatedAtMs || 0);
    
    // Déterminer la source de session la plus récente pour activeSession
    const rTime = r.updatedAtMs || 0;
    const fTime = f.updatedAtMs || (f.updatedAt?.toMillis ? f.updatedAt.toMillis() : 0);
    const mostRecentSource = fTime > rTime ? f : r;
    const activeSession = mostRecentSource?.activeSession !== undefined
      ? mostRecentSource.activeSession
      : (f.activeSession ?? r.activeSession ?? null);

    const now = Date.now();
    const isFreshSession = Boolean(
      activeSession &&
      activeSession.status === 'playing' &&
      now - (activeSession.updatedAtMs || 0) < HANDOFF_MAX_AGE_MS
    );

    onUpdate({
      uid,
      coins: useFsCoins ? f.coins : (r.coins ?? f.coins ?? null),
      coinsUpdatedAtMs: Math.max(f.coinsUpdatedAtMs || 0, r.coinsUpdatedAtMs || 0),
      activeChannels: useFsChannels ? f.activeChannels : (r.activeChannels ?? f.activeChannels ?? null),
      channelsUpdatedAtMs: Math.max(f.channelsUpdatedAtMs || 0, r.channelsUpdatedAtMs || 0),
      channelsSourceDeviceId: useFsChannels
        ? f.channelsSourceDeviceId || null
        : (r.channelsSourceDeviceId ?? f.channelsSourceDeviceId ?? null),
      selectedChannelId: r.selectedChannelId ?? f.selectedChannelId ?? null,
      activeSession: isFreshSession ? activeSession : null,
      hasSavestate: Boolean(isFreshSession && (r.hasSavestate || activeSession?.hasSavestate)),
      gameStats: Array.isArray(r.gameStats) ? r.gameStats : null,
    });
  };

  const pullRelay = async () => {
    try {
      const res = await fetch(`/api/account-sync?uid=${encodeURIComponent(uid)}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.ok) {
          latestRelay = data;
          emitMerged();
        }
      }
    } catch {
      /* ignore */
    }
  };

  pullRelay();
  const pollId = setInterval(pullRelay, 15000);

  let bc = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel('csw_account_sync_v1');
      bc.onmessage = (e) => {
        if (e?.data?.uid === uid) {
          pullRelay();
        }
      };
    }
  } catch {}

  const unsubFs = onSnapshot(
    doc(db, 'users', uid, 'sync', 'state'),
    (snap) => {
      if (snap.exists()) {
        latestFs = snap.data();
        emitMerged();
      }
    },
    () => {}
  );

  return () => {
    clearInterval(pollId);
    try { bc?.close(); } catch {}
    unsubFs?.();
  };
}
