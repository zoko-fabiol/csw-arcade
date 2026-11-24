/**
 * Service Messagerie Privée Directe entre Amis (DM 1-à-1) via VPS (/api/dm + WS PUSH)
 */
import { voiceChatService } from './voiceChatService';

const DM_CACHE_PREFIX = 'csw_dm_cache_v1_';

export function buildDmId(uidA, uidB) {
  return [String(uidA || ''), String(uidB || '')].sort().join('__');
}

function readCachedMessages(dmId) {
  try {
    const raw = localStorage.getItem(DM_CACHE_PREFIX + dmId);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedMessages(dmId, list) {
  try {
    localStorage.setItem(DM_CACHE_PREFIX + dmId, JSON.stringify((list || []).slice(-100)));
  } catch {}
}

export async function fetchDirectMessages(myUid, peerUid) {
  if (!myUid || !peerUid) return [];
  const dmId = buildDmId(myUid, peerUid);
  try {
    const res = await fetch(
      `/api/dm?uid=${encodeURIComponent(myUid)}&peerUid=${encodeURIComponent(peerUid)}`
    );
    const data = await res.json();
    if (data?.ok && Array.isArray(data.messages)) {
      writeCachedMessages(dmId, data.messages);
      return data.messages;
    }
  } catch {}
  return readCachedMessages(dmId);
}

export async function sendDirectMessage(userProfile, peerUid, text) {
  const fromUid = userProfile?.uid;
  const clean = String(text || '').trim().slice(0, 500);
  if (!fromUid || !peerUid || !clean) {
    throw new Error('Message vide ou destinataire invalide.');
  }
  const res = await fetch('/api/dm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'send',
      fromUid,
      fromName: userProfile.displayName || userProfile.name || 'Joueur',
      fromPhotoURL:
        userProfile.photoURL && !String(userProfile.photoURL).startsWith('data:')
          ? userProfile.photoURL
          : null,
      toUid: peerUid,
      text: clean,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || 'Impossible d’envoyer le message.');
  }
  return data.message;
}

export async function markDirectMessagesRead(myUid, peerUid) {
  if (!myUid || !peerUid) return;
  try {
    await fetch('/api/dm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark_read', uid: myUid, peerUid }),
    });
  } catch {}
}

export function subscribeDirectMessages(myUid, peerUid, cb) {
  if (!myUid || !peerUid) {
    cb([]);
    return () => {};
  }
  const dmId = buildDmId(myUid, peerUid);
  let active = true;
  let current = readCachedMessages(dmId);
  cb(current);

  const syncFromServer = async () => {
    const fresh = await fetchDirectMessages(myUid, peerUid);
    if (!active) return;
    current = fresh;
    cb(current);
  };
  syncFromServer();

  const unsubWs = voiceChatService.onDmEvent((ev) => {
    if (!active) return;
    if (ev?.type === 'dm_message' && ev.message?.dmId === dmId) {
      if (!current.some((m) => m.id === ev.message.id)) {
        current = [...current, ev.message].slice(-100);
        writeCachedMessages(dmId, current);
        cb(current);
      }
    }
  });

  // Fallback polling doux toutes les 8s au cas où WS serait brièvement coupé
  const poll = setInterval(syncFromServer, 8000);
  return () => {
    active = false;
    unsubWs?.();
    clearInterval(poll);
  };
}
