/* WeatherPure Service Worker
 *
 * Strategy:
 *   - Versioned assets (?v=…)  → cache-first, immutable lifetime
 *   - Static asset extensions   → cache-first, refresh in background
 *   - HTML / navigation         → stale-while-revalidate
 *   - Everything else / cross-origin → pass-through (no SW handling)
 *
 * Die Open-Meteo API läuft cross-origin und damit bewusst am SW vorbei;
 * der letzte Forecast wird stattdessen von der App in localStorage
 * gehalten (local first, offline Anzeige mit Zeitstempel).
 *
 * Cache invalidation: bumping CACHE_VERSION below drops both caches on
 * the next activate.
 */

const CACHE_VERSION  = 'v20260611-7';
const STATIC_CACHE   = 'weather-static-' + CACHE_VERSION;
const RUNTIME_CACHE  = 'weather-runtime-' + CACHE_VERSION;

const PRECACHE_URLS = [
  '/',
  '/site.webmanifest',
  '/styles-app.min.css?v=20260611-7',
  '/theme-init.js?v=20260611-7',
  '/script.min.js?v=20260611-7',
  '/fonts/InterVariable.woff2',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/logos/weatherpure-wordmark-karbon.svg',
  '/logos/weatherpure-wordmark-white.svg',
];

self.addEventListener('install', (event) => {
  // Individual cache.add() under Promise.allSettled so a single missing
  // entry can't abort the whole install (cache.addAll is all-or-nothing).
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => Promise.allSettled(
        PRECACHE_URLS.map((url) => cache.add(url))
      ))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.headers.has('Range')) return;
  if (request.cache === 'no-store') return;

  let url;
  try { url = new URL(request.url); }
  catch (_) { return; }

  if (url.origin !== self.location.origin) return;

  // Don't cache the SW itself.
  if (url.pathname === '/sw.js') return;

  const isVersioned    = url.search.indexOf('v=') !== -1;
  const isStaticAsset  = /\.(?:js|css|woff2?|ttf|png|jpe?g|webp|svg|ico|xml|webmanifest)$/i
                          .test(url.pathname);
  const isNavigation   = request.mode === 'navigate' ||
                         (request.headers.get('Accept') || '').indexOf('text/html') !== -1;

  if (isVersioned || isStaticAsset) {
    event.respondWith(cacheFirst(request));
  } else if (isNavigation) {
    event.respondWith(staleWhileRevalidate(request));
  }
  // else: pass-through (browser default)
});

function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((response) => {
      if (response && response.ok && response.status === 200 && response.type !== 'opaque') {
        const clone = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone)).catch(() => {});
      }
      return response;
    }).catch(() => caches.match('/'));
  });
}

function staleWhileRevalidate(request) {
  return caches.match(request).then((cached) => {
    const network = fetch(request).then((response) => {
      if (response && response.ok && response.status === 200) {
        const clone = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone)).catch(() => {});
      }
      return response;
    }).catch(() => cached || caches.match('/'));
    return cached || network;
  });
}
