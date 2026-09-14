/* RHW V4.0.2 · unified workspace service worker
   App assets are available offline. Live telemetry remains network-only. */
importScripts('./js/build-info.js', './js/app-shell.js');
const CACHE_PREFIX = 'rhw-v4.0.2-pwa-';
const CACHE_NAME = `${CACHE_PREFIX}${self.RHW_BUILD.revision}`;
const APP_SHELL = [...self.RHW_APP_SHELL, './js/app-shell.js'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // A fresh worker must not seed its new cache from still-fresh HTTP cache
    // entries belonging to the previous deployment.
    await cache.addAll(APP_SHELL.map(src => new Request(new URL(src, self.location.href), { cache: 'reload' })));
    // Updates wait for an explicit restart; active calculator sessions stay open.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirst(request, fallback) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (!response.ok) throw new Error(`NETWORK RESPONSE ${response.status}`);
    await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request) || await cache.match(fallback);
    if (cached) return cached;
    throw error;
  }
}

async function appShellNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  // Keep HTML and scripts on the same installed release until UPDATE NOW.
  // Fetching new HTML over old cache-first scripts can prevent the app booting.
  const shell = await cache.match('./index.html');
  return shell || networkFirst(request, './index.html');
}

async function networkFirstData(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (!response.ok) throw new Error(`NETWORK RESPONSE ${response.status}`);
    await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(appShellNavigation(request));
    return;
  }

  if (url.origin === self.location.origin) {
    const isDiscoveryStatus = url.pathname.endsWith('/assets/discovery-status.json');
    if (isDiscoveryStatus) event.respondWith(networkFirstData(request));
    else event.respondWith(cacheFirst(request));
    return;
  }

});
