// Several apps share this origin (this production app at the site root, trials and copies in
// sub-directories). This worker only touches its own directory and its own caches.
const CACHE_VERSION = 'atokore-pwa-v15';
const SCOPE_PATH = new URL(self.registration ? self.registration.scope : './', self.location.href).pathname;
const CACHE_PREFIX = 'atokore-shell:' + SCOPE_PATH + ':';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
// Cache names this production worker used before v15 (trials used other names).
const LEGACY_OWN_CACHES = ['atokore-pwa-v12', 'atokore-pwa-v13', 'atokore-pwa-v14'];
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

// Only files directly in this directory (plus icons/) belong to this app. Every nested directory
// (preview-*/, atokore/, future trials) is another app and is never cached or answered here.
function ownsPath(pathname) {
  if (!pathname.startsWith(SCOPE_PATH)) return false;
  const rest = pathname.slice(SCOPE_PATH.length);
  return !rest.includes('/') || rest.startsWith('icons/');
}

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      // Delete only this app's older caches; other apps' caches on the same origin are left alone.
      .then(keys => Promise.all(keys
        .filter(key => key !== CACHE_NAME && (key.startsWith(CACHE_PREFIX) || LEGACY_OWN_CACHES.includes(key)))
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function remember(request, response) {
  if (response && response.ok && response.type === 'basic') {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !ownsPath(url.pathname)) return;

  if (request.mode === 'navigate') {
    // Network first, revalidating the HTTP cache, so a release never keeps showing an old page.
    event.respondWith(
      fetch(new Request(request.url, { cache: 'no-cache', credentials: 'same-origin' }))
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(SCOPE_PATH, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.open(CACHE_NAME).then(cache => cache.match(SCOPE_PATH).then(hit => hit || cache.match('./index.html'))))
    );
    return;
  }

  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then(response => remember(request, response))
      .catch(() => caches.open(CACHE_NAME).then(cache => cache.match(request).then(hit => hit || cache.match(request, { ignoreSearch: true }))))
  );
});
