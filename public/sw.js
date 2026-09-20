const SHELL_CACHE_NAME = 'csw-arcade-shell-v4';
const ENGINE_CACHE_NAME = 'csw-arcade-engine-v4';

// Assets essentiels du moteur WebAssembly (FBNeo + EmulatorJS)
const ENGINE_ASSETS = [
  '/emulatorjs/loader.js',
  '/emulatorjs/emulator.min.js',
  '/emulatorjs/emulator.min.css',
  '/emulatorjs/version.json',
  '/emulatorjs/localization/en-US.json',
  '/emulatorjs/localization/fr-FR.json',
  '/emulatorjs/localization/fr.json',
  '/emulatorjs/cores/reports/fbneo.json',
  '/emulatorjs/cores/fbneo-wasm.data',
  '/emulatorjs/cores/fbneo-legacy-wasm.data',
  '/emulatorjs/compression/extract7z.js'
];

// Assets de l'interface et du shell CSW-Arcade
const SHELL_ASSETS = [
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

// Installation résiliente : mise en cache garantie sans échec atomique bloquant
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(ENGINE_CACHE_NAME).then(async (cache) => {
        console.log('[CSW-Arcade SW] Précache autonome du moteur WebAssembly (FBNeo)...');
        await Promise.allSettled(
          ENGINE_ASSETS.map((url) =>
            cache.add(url).catch((err) => console.warn('[CSW-Arcade SW] Warning cache moteur:', url, err.message))
          )
        );
      }),
      caches.open(SHELL_CACHE_NAME).then(async (cache) => {
        console.log('[CSW-Arcade SW] Précache du shell applicatif...');
        await Promise.allSettled(
          SHELL_ASSETS.map((url) =>
            cache.add(url).catch((err) => console.warn('[CSW-Arcade SW] Warning cache shell:', url, err.message))
          )
        );
      })
    ]).then(() => self.skipWaiting())
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
            console.log('[CSW-Arcade SW] Nettoyage ancien cache obsolète:', name);
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

  // 1. STRATÉGIE CACHE-FIRST POUR LE MOTEUR EMULATORJS ET WASM
  // Permet un démarrage instantané 100% hors-ligne sans dépendance réseau une fois hébergé
  if (url.pathname.startsWith('/emulatorjs/') || url.hostname.includes('cdn.emulatorjs.org')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            const clone = networkResponse.clone();
            caches.open(ENGINE_CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        }).catch(() => {
          // Secours : recherche sans paramètres d'URL (ex: hash ou query)
          return caches.match(url.pathname);
        });
      })
    );
    return;
  }

  // 2. STRATÉGIE POUR LES ASSETS STATIQUES LOCAUX (Vite Chunks, CSS, Images, HTML)
  if (url.origin === self.location.origin) {
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
            return caches.match('/index.html') || caches.match('/');
          })
      );
      return;
    }

    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(SHELL_CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        }).catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
  }
});
