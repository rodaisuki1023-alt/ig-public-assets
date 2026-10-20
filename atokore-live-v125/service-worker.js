const CACHE_NAME = 'atokore-pwa-v14';
const APP_SHELL = [
  './',
  './index.html',
  './final.css',
  './receipt.js',
  './display.js',
  './bulk.js',
  './history.js',
  './ui.js',
  './stability.js',
  './family.js',
  './baby-visuals.js',
  './atokore-theme.css',
  './atokore-redesign.js',
  './quick-add.css',
  './quick-add.js',
  './pwa.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // A separate review build lives beneath this path. Never cache its navigation
  // as the main app index, and let its own scoped service worker handle assets.
  if (url.pathname.includes('/preview-compact-v15/') || url.pathname.includes('/preview-simple-v16/') || url.pathname.includes('/preview-baby-v17/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => {
      const fresh = fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
      return cached || fresh;
    })
  );
});
