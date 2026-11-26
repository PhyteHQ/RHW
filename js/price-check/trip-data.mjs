import { comparisonFleet, COMPARISON_FLEET } from '../supply/comparison-fleet.mjs';
import { normalizeNpcMarket } from '../supply/npc-market.mjs';
import { database, loadNavigation, mapCache, mapUpdates, read } from '../supply/routing-data.mjs';
import { FALLBACK_SHIPS, normalizeShipRegistry } from '../supply/ship-profiles.mjs';
export { fixedRouteHome, quoteHourly } from './hourly.mjs';
export { COMPARISON_FLEET };

const CACHE_KEY = 'price-check-reference';
const DAY = 86400000;
const RETRY_MS = 300000;
let reference, referenceRequest, mapRequest, attemptedAt = -Infinity;

async function loadReference(force) {
  if (referenceRequest) return referenceRequest;
  if (!force && reference && Date.now() - attemptedAt < RETRY_MS) return reference;
  referenceRequest = (async () => {
    const saved = reference || await database('get', undefined, CACHE_KEY).catch(() => null) || {};
    const now = Date.now();
    if (navigator.onLine === false) return saved;
    attemptedAt = now;
    const refreshGoods = force || !saved.commodityAt || now - saved.commodityAt >= DAY;
    const refreshShips = force || !saved.shipAt || now - saved.shipAt >= DAY;
    const signal = AbortSignal.timeout(18000);
    const [goods, ships] = await Promise.allSettled([
      refreshGoods ? read('commodities', { include_market_goods: false, filter_to_useful: true }, signal)
        .then(commodities => normalizeNpcMarket(commodities, []).goods) : Promise.resolve(null),
      refreshShips ? read('ships', { include_tech_compat: false }, signal)
        .then(rows => comparisonFleet(normalizeShipRegistry(rows))) : Promise.resolve(null)
    ]);
    const next = { ...saved };
    if (goods.status === 'fulfilled' && goods.value?.length) Object.assign(next, { goods: goods.value, commodityAt: now });
    if (ships.status === 'fulfilled' && ships.value) Object.assign(next, { ships: ships.value, shipAt: now });
    if (next.commodityAt !== saved.commodityAt || next.shipAt !== saved.shipAt) {
      void database('put', next, CACHE_KEY).catch(() => null);
    }
    return next;
  })().then(next => { reference = next; return next; }).finally(() => { referenceRequest = null; });
  return referenceRequest;
}

async function loadMap() {
  const cached = mapCache.get();
  if (cached) return cached;
  mapRequest ||= loadNavigation(AbortSignal.timeout(15000)).then(navigation => mapCache.ready(navigation))
    .finally(() => { mapRequest = null; });
  return mapRequest;
}

export function onMapUpdate(callback) {
  mapUpdates.addEventListener('change', () => callback(mapCache.get()?.snapshot.capturedAt));
}

function runWorker(data, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../supply/worker.mjs', import.meta.url), { type: 'module' });
    const finish = (settle, value) => {
      signal.removeEventListener('abort', abort);
      worker.terminate();
      settle(value);
    };
    const abort = () => finish(reject, signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => data.type === 'result'
      ? finish(resolve, data.result) : finish(reject, Error(data.message || 'Round trip unavailable'));
    worker.onerror = () => finish(reject, Error('Round trip worker unavailable'));
    try { worker.postMessage({ type: 'price-check', ...data }); }
    catch (error) { finish(reject, error); }
  });
}

export async function loadTrips(home, routes, { force = false, signal }) {
  const [map, refs] = await Promise.all([loadMap(), loadReference(force)]);
  if (navigator.onLine !== false) void mapCache.refresh();
  const trips = await runWorker({ home, routes, navigation: map.navigation, goods: refs.goods || [],
    ships: refs.ships || comparisonFleet(FALLBACK_SHIPS) }, signal);
  return { trips, mapAt: map.snapshot.capturedAt, latestMapAt: mapCache.get().snapshot.capturedAt,
    savedReferences: !refs.shipAt || !refs.commodityAt || Date.now() - Math.min(refs.shipAt, refs.commodityAt) >= DAY };
}
