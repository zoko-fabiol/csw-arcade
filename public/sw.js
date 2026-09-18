const CACHE_NAME = 'csw-arcade-pwa-v1';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[CSW-Arcade ServiceWorker] Précache des assets essentiels...');
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[CSW-Arcade ServiceWorker] Nettoyage ancien cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Ne pas intercepter les requêtes non-GET ou de streaming ROM volumineuses
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Ignorer les API dynamiques et les flux WebSockets / WebRTC
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) {
    return;
  }

  // Stratégie : Network-first avec fallback Cache pour les pages HTML et fichiers statiques
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Mettre en cache dynamique les ressources statiques
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // En cas de perte de connexion réseau, servir depuis le cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('Hors ligne', { status: 503, statusText: 'Offline' });
        });
      })
  );
});
