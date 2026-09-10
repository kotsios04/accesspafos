/**
 * AccessPafos AI service worker.
 *
 * Scope is deliberately narrow: an offline application shell so the app opens
 * and explains itself without a connection, plus a stale-while-revalidate
 * cache for static build assets.
 *
 * What it does NOT cache: accessibility data, route calculations, segment
 * evidence or anything from Firestore and Cloud Functions. Serving a stale
 * accessibility rating from a cache would be exactly the failure mode this
 * product exists to avoid - a user must never be shown a two-week-old "this
 * street is fine" without the app knowing it is doing so.
 */

const VERSION = 'v3';
const SHELL_CACHE = `accesspafos-shell-${VERSION}`;
const ASSET_CACHE = `accesspafos-assets-${VERSION}`;

const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-32.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL_URLS).catch(() => { /* a missing asset must not block install */ });
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('accesspafos-') && !key.endsWith(VERSION))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

/** True when a response is the SPA shell standing in for a file that is not there. */
function isSpaFallback(response) {
  return (response.headers.get('content-type') || '').includes('text/html');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache live data or authenticated endpoints.
  if (/^\/(?:__\/|api\/)/.test(url.pathname)) return;

  // Navigations: network first, shell as the offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('/index.html', response.clone());
        return response;
      } catch {
        const cached = await caches.match('/index.html');
        return cached || new Response(
          '<h1>AccessPafos AI</h1><p>You are offline. Reconnect to load the accessibility map.</p>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
        );
      }
    })());
    return;
  }

  // Hashed build assets are immutable: cache first.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached && !isSpaFallback(cached)) return cached;
      const response = await fetch(request);
      // A missing asset does not 404 here: the SPA rewrite answers with
      // index.html and a 200, which cache-first would then store forever under
      // the asset's URL. Storing that once is enough to break the app for a
      // returning visitor long after the missing file has been restored, so
      // an HTML answer to an asset request is never written to the cache.
      if (response.ok && !isSpaFallback(response)) {
        const cache = await caches.open(ASSET_CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })());
  }
});
