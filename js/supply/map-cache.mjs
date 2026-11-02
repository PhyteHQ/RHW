/* Map availability is independent of a fresh trade quotation. Only validated
   routing facts are persisted; a failed update never replaces a usable map. */
import { currentNavigation } from './live-navigation.mjs';

export const BUNDLED_MAP_AT = '2026-10-29T08:32:15.364670+00:00';
export const MAP_MAX_AGE_MS = 86400000;
const SOURCE = 'https://darkstat.dd84ai.com/api/systems';
const RETRY_MS = 300000;

function projection(systems) {
  if (!Array.isArray(systems)) throw Error('Invalid map response');
  const objects = rows => rows?.map(({ Nickname, Kind, Pos, GotoSystem }) => ({ Nickname, Kind, Pos, GotoSystem })) ?? null;
  return systems.map(({ nickname, Objs, Jumpholes }) => ({ nickname, Objs: objects(Objs), Jumpholes: objects(Jumpholes) }));
}

export function createMapCache({ fetchSystems, loadBundled, readCache, writeCache,
  onChange = () => {}, now = Date.now, timeoutMs = 20000, requiredSystem = 'br01' }) {
  let geometry, current = null, initial = null, pending = null, lastAttempt = -Infinity, error = '';
  const notify = () => onChange();
  const accept = (raw, origin) => {
    const at = Date.parse(raw?.capturedAt);
    if (raw?.schema !== 1 || raw.source !== SOURCE || !Number.isFinite(at) || at > now() + RETRY_MS)
      throw Error('Invalid saved map');
    const navigation = currentNavigation(geometry, raw.systems, raw.capturedAt);
    if (!navigation.nodes.some(node => node.system === requiredSystem)) throw Error('Map does not cover RHW’s system');
    const snapshot = { schema: 1, source: SOURCE, capturedAt: raw.capturedAt, systems: projection(raw.systems) };
    return { snapshot, navigation, origin };
  };
  async function ready(base) {
    if (current) return current;
    if (initial) return initial;
    geometry = base;
    initial = (async () => {
      try {
        const cached = await readCache();
        if (Date.parse(cached?.capturedAt) >= Date.parse(BUNDLED_MAP_AT)) current = accept(cached, 'saved');
      } catch { /* Damaged or unavailable browser storage cannot remove the bundled map. */ }
      if (!current) current = accept({ ...await loadBundled(), schema: 1 }, 'bundled');
      notify();
      return current;
    })().finally(() => { initial = null; });
    return initial;
  }
  function refresh(force = false) {
    if (pending) return pending;
    if (!current) return Promise.reject(Error('Load a saved route map first'));
    if (!force && (now() - Date.parse(current.snapshot.capturedAt) < MAP_MAX_AGE_MS || now() - lastAttempt < RETRY_MS))
      return Promise.resolve(current);
    lastAttempt = now(); error = '';
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    pending = Promise.resolve().then(async () => {
      try {
        const systems = await fetchSystems(controller.signal);
        const next = accept({ schema: 1, source: SOURCE, capturedAt: new Date(now()).toISOString(), systems }, 'live');
        current = next;
        try { await writeCache(next.snapshot); } catch { /* Keep the valid in-memory map when storage is full. */ }
      } catch (failure) {
        error = controller.signal.aborted ? 'Map update timed out' : failure.message || 'Map update unavailable';
      } finally {
        clearTimeout(timer); pending = null; notify();
      }
      return current;
    });
    notify();
    return pending;
  }
  return { ready, refresh, get: () => current, state: () => ({ current, updating: Boolean(pending), error }) };
}
