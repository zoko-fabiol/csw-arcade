/**
 * Service Client Web Push (VAPID + Service Worker + Fallback OS Notification)
 * Permet de recevoir les défis, invitations de groupe, demandes d'amis et messages privés
 * même lorsque l'onglet ou la PWA CSW-Arcade est en arrière-plan.
 */

const PUSH_PREF_KEY = 'csw_push_enabled_v1';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

export function isPushEnabledPreference() {
  try {
    const raw = localStorage.getItem(PUSH_PREF_KEY);
    if (raw === '0') return false;
    if (raw === '1') return true;
  } catch {}
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

export function getPushPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

async function getReadyServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  let reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg) {
    reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  }
  await navigator.serviceWorker.ready;
  return reg;
}

export async function enablePushNotifications(uid) {
  if (typeof Notification === 'undefined') {
    throw new Error('Les notifications ne sont pas supportées sur cet appareil.');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    throw new Error('Permission de notification refusée dans le navigateur.');
  }

  try {
    localStorage.setItem(PUSH_PREF_KEY, '1');
  } catch {}

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: true, mode: 'local-only' };
  }

  const keyRes = await fetch('/api/push/vapid-public-key');
  const keyData = keyRes.ok ? await keyRes.json() : null;
  if (!keyData?.publicKey) {
    return { ok: true, mode: 'local-only' };
  }

  const reg = await getReadyServiceWorker();
  if (!reg?.pushManager) {
    return { ok: true, mode: 'local-only' };
  }

  let sub = await reg.pushManager.getSubscription();
  const appServerKey = urlBase64ToUint8Array(keyData.publicKey);
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey,
    });
  }

  if (uid && sub) {
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, subscription: sub.toJSON() }),
    });
  }

  return { ok: true, mode: 'web-push', endpoint: sub?.endpoint };
}

export async function disablePushNotifications(uid) {
  try {
    localStorage.setItem(PUSH_PREF_KEY, '0');
  } catch {}

  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid, endpoint }),
        }).catch(() => {});
      }
    } catch {}
  }
  return { ok: true };
}

export async function syncPushSubscriptionIfGranted(uid) {
  if (!uid || !isPushSupported()) return false;
  if (Notification.permission !== 'granted') return false;
  try {
    if (localStorage.getItem(PUSH_PREF_KEY) === '0') return false;
  } catch {}

  try {
    const keyRes = await fetch('/api/push/vapid-public-key');
    const keyData = keyRes.ok ? await keyRes.json() : null;
    if (!keyData?.publicKey) return false;

    const reg = await getReadyServiceWorker();
    if (!reg?.pushManager) return false;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
      });
    }
    if (sub) {
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, subscription: sub.toJSON() }),
      });
      return true;
    }
  } catch {}
  return false;
}

export async function sendTestPushNotification(uid) {
  if (uid) {
    try {
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid }),
      });
      const data = res.ok ? await res.json() : null;
      if (data?.sent > 0) return { ok: true, mode: 'web-push' };
    } catch {}
  }

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const reg = await navigator.serviceWorker?.getRegistration?.('/');
    if (reg?.showNotification) {
      await reg.showNotification('🔔 CSW-Arcade — Notifications actives', {
        body: 'Vous recevrez vos défis, invitations et messages en direct !',
        icon: '/icons/icon-192.png',
        badge: '/favicon.png',
        tag: 'csw_test_push',
      });
      return { ok: true, mode: 'sw-local' };
    }
    // eslint-disable-next-line no-new
    new Notification('🔔 CSW-Arcade — Notifications actives', {
      body: 'Vous recevrez vos défis, invitations et messages en direct !',
      icon: '/icons/icon-192.png',
    });
    return { ok: true, mode: 'local' };
  }

  throw new Error('Activez d’abord les notifications Push.');
}

export function showBackgroundNotification({ title, body, tag }) {
  if (typeof document === 'undefined' || !document.hidden) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!isPushEnabledPreference()) return;
  try {
    navigator.serviceWorker?.getRegistration?.('/').then((reg) => {
      if (reg?.showNotification) {
        reg.showNotification(title || 'CSW-Arcade', {
          body: body || '',
          icon: '/icons/icon-192.png',
          badge: '/favicon.png',
          tag: tag || `csw_bg_${Date.now()}`,
        });
      } else {
        // eslint-disable-next-line no-new
        new Notification(title || 'CSW-Arcade', { body: body || '', icon: '/icons/icon-192.png' });
      }
    });
  } catch {}
}
