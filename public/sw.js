const SHELL_CACHE_NAME = 'csw-arcade-shell-v2';
const ENGINE_CACHE_NAME = 'csw-arcade-engine-v1';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/player.html',
  '/manifest.json',
  '/favicon.png',
  '/roms-manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

// Installation : pré-mise en cache immédiate du shell applicatif
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE_NAME).then((cache) => {
      console.log('[CSW-Arcade SW] Précache du shell applicatif (index, player, manifest)...');
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activation : nettoyage des anciennes versions de caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== SHELL_CACHE_NAME && name !== ENGINE_CACHE_NAME)
          .map((name) => {
            console.log('[CSW-Arcade SW] Suppression ancien cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Interception réseau avec stratégies optimisées pour le mode 100% hors-ligne
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Ignorer les API dynamiques de salons et les flux WebSockets / WebRTC
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/') || url.protocol === 'ws:' || url.protocol === 'wss:') {
    return;
  }

  // 1. STRATÉGIE CACHE-FIRST POUR LE MOTEUR EMULATORJS (CDN WASM FBNEO)
  // Permet de jouer 100% hors-ligne en mode avion dès que le moteur a été chargé une fois
  if (url.hostname.includes('cdn.emulatorjs.org')) {
    event.respondWith(
      caches.open(ENGINE_CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return fetch(event.request).then((networkResponse) => {
            if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch((err) => {
            console.warn('[CSW-Arcade SW] Échec réseau CDN hors-ligne:', url.pathname);
            throw err;
          });
        });
      })
    );
    return;
  }

  // 2. STRATÉGIE POUR LES ASSETS STATIQUES LOCAUX (Vite Chunks, CSS, Images, HTML)
  // Cache-first avec mise à jour en arrière-plan (Stale-While-Revalidate)
  if (url.origin === self.location.origin) {
    // Si requête de navigation HTML
    if (event.request.mode === 'navigate') {
      event.respondWith(
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              caches.open(SHELL_CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return networkResponse;
          })
          .catch(() => {
            return caches.match('/index.html');
          })
      );
      return;
    }

    // Fichiers statiques et player.html
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(SHELL_CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        }).catch(() => null);

        return cached || fetchPromise.then(res => res || new Response('Hors-ligne', { status: 503 }));
      })
    );
    return;
  }

  // Fallback réseau standard
  event.respondWith(fetch(event.request));
});
