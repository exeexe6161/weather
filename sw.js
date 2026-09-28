/* WeatherPure Service Worker
 *
 * Strategy:
 *   - HTML navigation           → network-first, exact offline match
 *   - Versioned/static assets   → cache-first
 *   - Everything else / cross-origin → pass-through (no SW handling)
 *
 * Eigene /api Routen werden vor jeder Cacheklassifizierung ausgeschlossen.
 *
 * Cache invalidation: CACHE_VERSION below is injected at build time by
 * build-sw.mjs (from VERCEL_GIT_COMMIT_SHA, else a core asset content hash).
 * Old WeatherPure caches are removed when a new cache version activates.
 * Do not edit the value by hand — build-sw.mjs is the single source.
 */

const CACHE_VERSION  = 'v065a5b200e89';
const STATIC_CACHE   = 'weather-static-' + CACHE_VERSION;
const RUNTIME_CACHE  = 'weather-runtime-' + CACHE_VERSION;

const CORE_PRECACHE_URLS = [
  '/',
  '/site.webmanifest',
  '/styles-app.min.css?v=065a5b200e89',
  '/theme-init.js?v=065a5b200e89',
  '/script.min.js?v=065a5b200e89',
];

const OPTIONAL_PRECACHE_URLS = [
  '/fonts/InterVariable.woff2',
  '/fonts/InstrumentSerif-Italic-latin.woff2',
  '/fonts/InstrumentSerif-Italic-latin-ext.woff2',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/logos/weatherpure-wordmark-karbon.svg',
  '/logos/weatherpure-wordmark-white.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      // addAll is atomic for the required shell. Reload bypasses an old HTTP
      // cache entry even when the deployed asset path itself is unchanged.
      await cache.addAll(CORE_PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })));
      await Promise.allSettled(OPTIONAL_PRECACHE_URLS.map(async (url) => {
        const response = await fetch(new Request(url, { cache: 'reload' }));
        if (response && response.ok) await cache.put(url, response);
      }));
      await self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => (k.startsWith('weather-static-') || k.startsWith('weather-runtime-'))
            && k !== STATIC_CACHE && k !== RUNTIME_CACHE)
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
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  // Don't cache the SW itself.
  if (url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  const isVersioned = url.searchParams.has('v');
  const isStaticAsset = /\.(?:js|css|woff2?|ttf|png|jpe?g|webp|svg|ico|xml|webmanifest)$/i
    .test(url.pathname);
  if (isVersioned || isStaticAsset) {
    event.respondWith(cacheFirst(request));
  }
  // else: pass-through (browser default)
});

async function cacheFirst(request) {
  const staticCache = await caches.open(STATIC_CACHE);
  const cached = await staticCache.match(request) || await (await caches.open(RUNTIME_CACHE)).match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok && response.status === 200 && response.type !== 'opaque'
        && !/\bno-store\b/i.test(response.headers.get('Cache-Control') || '')) {
      try { await (await caches.open(RUNTIME_CACHE)).put(request, response.clone()); }
      catch (_) { /* A valid network response remains usable without a cache write. */ }
    }
    return response;
  } catch (_) {
    return Response.error();
  }
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok && response.status === 200
        && /\btext\/html\b/i.test(response.headers.get('Content-Type') || '')) {
      try { await (await caches.open(RUNTIME_CACHE)).put(request, response.clone()); }
      catch (_) { /* Online navigation must still succeed if storage is unavailable. */ }
    }
    return response;
  } catch (_) {
    const cached = await (await caches.open(RUNTIME_CACHE)).match(request);
    if (cached) return cached;
    const path = new URL(request.url).pathname;
    if (path === '/' || path === '/index.html') {
      const shell = await (await caches.open(STATIC_CACHE)).match('/');
      if (shell) return shell;
    }
    return Response.error();
  }
}
