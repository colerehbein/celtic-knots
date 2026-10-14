// Celtic Knot Generator — cache-first service worker.
//
// Served from the deployment root (its own scope), so every precached URL is
// relative to it. Reads are answered from the cache first and the network is
// only consulted on a miss; successful same-origin GET responses are copied
// back in, so the app keeps working offline after one visit.
//
// Deliberately minimal: no build step, no version manifest to hand-edit, and
// no navigation preload — the deployed page is a single self-contained file.

const CACHE_NAME = 'celtic-knots-v1';
const PRECACHE_URLS = ['./', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Only plain navigations and asset reads are cacheable; anything else goes
  // straight to the network untouched.
  if (request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached !== undefined) {
        return cached;
      }
      return fetch(request)
        .then((response) => {
          // Only cache complete, same-origin responses — a partial or opaque
          // cross-origin body would poison later reads.
          if (response.ok && new URL(request.url).origin === self.location.origin) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => void cache.put(request, copy));
          }
          return response;
        })
        // Offline and uncached: fall back to the cached app shell, and only
        // if even that is missing report a genuine network error.
        .catch(() => caches.match('./').then((shell) => shell ?? Response.error()));
    }),
  );
});
