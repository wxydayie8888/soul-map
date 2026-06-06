// Soul Map service worker
// Strategy:
//   - Static shell (HTML + icons + manifest): stale-while-revalidate so the
//     user always sees something instantly, and a fresh copy is pulled in
//     the background for next time.
//   - /api/* requests: network-only (responses are user-specific and write
//     to D1 — caching would silently desync state).
//   - Everything else (Google Fonts, p5, three.js, etc.): cache-first with
//     a 7-day max-age so the first visit warms the cache and subsequent
//     visits go offline-tolerant.
//
// On a new SW version, the install handler skipWaiting()s so updates apply
// on the next navigation (no second-reload required).

const VERSION = 'sm-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
  '/icons/og-image.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => {
        // If any single shell URL fails (offline first install,
        // 4xx from a not-yet-deployed asset), don't abort the install —
        // the runtime cache will still warm up on first navigation.
      }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop old version caches
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// SkipWaiting message — frontend can postMessage({type:'SKIP_WAITING'}) to
// force-activate a freshly-installed SW without waiting for next nav.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Skip non-GET (POST/PUT/DELETE shouldn't be cached)
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // /api/* — always network. Don't pretend offline data is fresh.
  if (url.pathname.startsWith('/api/')) return;

  // Same-origin shell HTML — stale-while-revalidate
  if (url.origin === self.location.origin && (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html'))) {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }

  // Same-origin assets (icons/manifest) — cache-first, fall back to network
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  // Cross-origin (Google Fonts, CDN-served three.js / p5.js etc.) —
  // cache-first with runtime cache. Slow first paint becomes instant next time.
  event.respondWith(cacheFirst(req, RUNTIME_CACHE));
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((resp) => {
      if (resp && resp.ok) cache.put(req, resp.clone());
      return resp;
    })
    .catch(() => null);
  return cached || network || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const resp = await fetch(req);
    if (resp && resp.ok && (req.url.startsWith(self.location.origin) || resp.type === 'opaque' || resp.status === 200)) {
      cache.put(req, resp.clone());
    }
    return resp;
  } catch (e) {
    // Offline + no cache hit: return a degraded response rather than throwing
    return cached || new Response('', { status: 504, statusText: 'Offline cache miss' });
  }
}
