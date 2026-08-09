const CACHE_NAME = 'code-ide-v2';
// Relative, not absolute ('/', '/index.html') — these resolve against this
// script's own URL, so they land in the right place whether the app is
// hosted at a domain root or a subfolder. Getting this wrong is worse than
// it sounds: cache.addAll() fails atomically, so if even one of these
// 404s (as '/' does under a subpath deploy), the whole install step
// rejects and the service worker never activates — no caching at all, not
// even a partial one. manifest.json isn't listed here since the build
// gives it a hashed filename (see index.html); it still ends up cached
// via the runtime fetch handler below the first time it's requested.
const urlsToCache = [
  './',
  './index.html',
];

self.addEventListener('install', (event) => {
  // Activate this version immediately instead of waiting for every open tab
  // to close first. Without this, updating sw.js (like this fix) silently
  // has no effect until you manually unregister it or close all tabs — the
  // old, already-running worker just keeps serving.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Take control of any already-open tabs right away, rather than only
      // controlling tabs opened after this activation.
      self.clients.claim(),
    ])
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle plain http(s) requests — the Cache API rejects other
  // schemes (chrome-extension://, moz-extension://, etc.), and trying to
  // cache.put() one throws an unhandled rejection in the console for
  // requests that were never ours to intercept anyway.
  if (!event.request.url.startsWith('http')) {
    return;
  }

  // Network first, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
