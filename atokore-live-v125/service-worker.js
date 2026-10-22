// Several apps share this origin (the production app at the site root and sandboxed trials in
// sub-directories). This worker therefore only touches its own directory and its own caches.
// Refreshed worker for the direct one-tap repeat-list stock-add release.
const CACHE_VERSION = 'atokore-pwa-v41';
const SCOPE_PATH = new URL(self.registration ? self.registration.scope : './', self.location.href).pathname;
const CACHE_PREFIX = 'atokore-shell:' + SCOPE_PATH + ':';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
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
  './compact-add.css',
  './edit-after-add.css',
  './edit-after-add.js',
  './product-photos-v30.js',
  './product-photos-v30.css',
  './batch-review-v36.css',
  './household-sync-v37.css',
  './household-config-v37.js',
  './household-core-v37.js',
  './household-google-v40.js',
  './household-sync-v37.js',
  './receipt-v38.css',
  './receipt-match-v38.js',
  './onboarding-v39.js',
  './onboarding-v39.css',
  './baby-kit-v17.js',
  './baby-food-catalog-v35.js',
  './baby-flow-v17.js',
  './baby-focus-v17.css',
  './add-clarity-v18.css',
  './p0-fixes-v19.css',
  './routine-catalog-v20.css',
  './routine-catalog-v20.js',
  './storage-bootstrap-v19.js',
  './data-safety-v19.js',
  './product-icons.js',
  './quick-add.js',
  './pwa.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/baby/diaper-bear-v24.webp',
  './icons/baby/wipes-bear-v24.webp',
  './icons/baby/milk-bear-v26.webp'
];

// Only files directly in this directory (plus icons/) belong to this app. Nested directories
// such as preview-*/ or atokore/ are other apps and must never be cached or answered here.
function ownsPath(pathname) {
  if (!pathname.startsWith(SCOPE_PATH)) return false;
  const rest = pathname.slice(SCOPE_PATH.length);
  return !rest.includes('/') || rest.startsWith('icons/');
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      // Delete only this app's older shells; other apps' caches on the same origin are left alone.
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))))
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
    // Always try the network first and revalidate the HTTP cache (GitHub Pages sends max-age=600),
    // so a new release never keeps showing an old page.
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

  // Scripts and styles: network first (the exact URL incl. ?v= is the cache key), cache when offline.
  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then(response => remember(request, response))
      .catch(() => caches.open(CACHE_NAME).then(cache => cache.match(request).then(hit => hit || cache.match(request, { ignoreSearch: true }))))
  );
});
