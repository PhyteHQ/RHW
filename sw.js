/* RHW V4.0.2 · unified workspace service worker
   App assets are available offline. Live telemetry remains network-only. */
importScripts('./js/build-info.js');
const CACHE_PREFIX = 'rhw-v4.0.2-pwa-';
const CACHE_NAME = `${CACHE_PREFIX}${self.RHW_BUILD.revision}`;
const CSS_NAMES = [
  'core', 'ticker', 'production', 'responsive', 'shipyard', 'shipyard-detail', 'mobile', 'headings', 'v35',
  'maintenance', 'layout-v36', 'app-v40', 'app-v40-navigation', 'app-v40-composer', 'app-v40-audit',
  'app-v40-operations', 'app-v40-calculator-polish', 'app-v40-nav-hierarchy', 'app-v402-fixes', 'app-v402-qol',
  'app-v402-mobile-ui', 'app-pr3-command-mobile', 'app-pr3-yard-production', 'app-pr3-operations-calculator',
  'app-pr3-comms-workflow', 'app-pr3-newswire-manager', 'app-pr4-pwa', 'app-pr5-newswire-2',
  'app-pr6-discovery-sync', 'app-pr7-diagnostics', 'app-pr8-production-orders', 'app-pr9-transfer-center',
  'app-pr10-newswire-review', 'app-pr11-full-audit', 'app-interface-cleanup'
];
const APP_SHELL = [
  './', './index.html', './manifest.webmanifest',
  './assets/RHW_Newswire.md', './assets/discovery-status.json', './assets/rhw-crest.png', './assets/favicon.png',
  './assets/apple-touch-icon.png', './assets/pwa-icon-192.png', './assets/pwa-icon-512.png',
  './assets/pwa-icon-maskable-512.png',
  ...CSS_NAMES.map((name, index) => `./css/${String(index + 1).padStart(2, '0')}-${name}.css`),
  './js/build-info.js', './js/config.js', './js/00-bootstrap.js', './js/01-wire.js', './js/02-utils.js', './js/03-telemetry.js',
  './js/04-state-production.js', './js/05-shipyard.js', './js/06-logistics.js', './js/07-overview.js',
  './js/08-data.js', './js/09-newswire.js', './js/10-maintenance.js', './js/11-layout-v36.js',
  './js/12-app-config.js', './js/13-app-v40.js', './js/14-app-v40-cache.js', './js/15-app-v40-navigation.js',
  './js/16-app-v40-composer.js', './js/16a-app-v40-comms-safety.js', './js/16b-app-v40-newswire-manager.js',
  './js/16c-app-v40-newswire-ordering.js', './js/17-app-v40-operations-core.js', './js/18-app-v40-operations-ui.js',
  './js/18a-app-v40-nav-hierarchy.js', './js/18b-app-v40-production-pricing.js', './js/18c-app-v40-recipe-corrections.js',
  './js/18d-app-v40-final-ui-polish.js', './js/19-app-v40-runtime.js', './js/20-app-v402-fixes.js',
  './js/21-app-v402-qol.js', './js/22-app-v402-mobile-ui.js', './js/23-app-v40-pwa.js',
  './js/24-app-v40-newswire-2.js', './js/25-app-v40-discovery-status.js', './js/26-app-v40-diagnostics.js',
  './js/27-app-v40-production-orders.js', './js/28-app-v40-transfer-center.js', './js/29-app-v40-newswire-review.js',
  './js/30-app-v40-full-audit.js', './js/31-app-command-rework.js', './js/32-app-unified-workspaces.js',
  './js/33-app-ui-polish-fix.js', './js/34-app-stability-polish.js', './js/35-app-command-compact-polish.js',
  './js/36-app-focus-pass.js', './js/37-app-price-check.js',
  ...Array.from({ length: 6 }, (_, index) => `./assets/recipes/catalog-v1-part-${String(index + 1).padStart(2, '0')}.js`)
];

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

function sourceResponse(response, source, fetchedAt) {
  const headers = new Headers(response.headers);
  headers.set('X-RHW-Source', source);
  if (fetchedAt) headers.set('X-RHW-Fetched-At', fetchedAt);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function newswireResponse(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (!response.ok) throw new Error(`NETWORK RESPONSE ${response.status}`);
    const marked = sourceResponse(response, 'network', new Date().toISOString());
    await cache.put(request, marked.clone());
    return marked;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true }) || await cache.match('./assets/RHW_Newswire.md');
    if (!cached) throw error;
    return sourceResponse(cached, 'cache', cached.headers.get('X-RHW-Fetched-At'));
  }
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
    const isNewswire = url.pathname.endsWith('/assets/RHW_Newswire.md');
    const isDiscoveryStatus = url.pathname.endsWith('/assets/discovery-status.json');
    const isRecipeChunk = /\/assets\/recipes\/catalog-v1-part-\d+\.js$/.test(url.pathname);
    if (isNewswire) event.respondWith(newswireResponse(request));
    else if (isDiscoveryStatus || isRecipeChunk) event.respondWith(networkFirstData(request));
    else event.respondWith(cacheFirst(request));
    return;
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request));
  }
});
