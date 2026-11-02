import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createMapCache, BUNDLED_MAP_AT, MAP_MAX_AGE_MS } from '../js/supply/map-cache.mjs';

const unpack = path => JSON.parse(gunzipSync(readFileSync(new URL(path, import.meta.url))));
const geometry = unpack('../assets/navigation.json.gz');
const bundled = unpack('../assets/navigation-last-verified.json.gz');
let clock = Date.parse('2026-11-02T12:00:00Z'), disk = null, reads = 0, writes = 0, requests = 0;
let send = async () => structuredClone(bundled.systems);
const settings = {
  now: () => clock,
  fetchSystems: signal => { requests++; return send(signal); },
  loadBundled: async () => structuredClone(bundled),
  readCache: async () => { reads++; return disk; },
  writeCache: async snapshot => { writes++; disk = structuredClone(snapshot); }
};
const store = createMapCache(settings);
const initial = await store.ready(geometry);
assert.equal(initial.origin, 'bundled');
assert.equal(initial.snapshot.capturedAt, BUNDLED_MAP_AT);
assert.equal(requests, 0, 'The route map must be usable before any live request');
const closure = edge => edge.from === 'iw06:iw06_to_ku02' && edge.to === 'ku02:ku02_to_iw06';
assert(!initial.navigation.links.some(closure), 'Known closures apply to the bundled map');

let release;
send = () => new Promise(resolve => { release = resolve; });
const update = store.refresh();
await Promise.resolve();
assert.equal(store.state().updating, true);
assert.equal(store.get(), initial, 'A hanging update cannot hold the saved map hostage');
assert.equal(await store.ready(geometry), initial);
assert.equal(store.refresh(true), update, 'Overlapping manual and automatic updates share one request');
release(structuredClone(bundled.systems));
await update;
const live = store.get();
assert.equal(live.origin, 'live');
assert.equal(live.snapshot.capturedAt, new Date(clock).toISOString());
assert.equal(writes, 1);
assert(!live.navigation.links.some(closure), 'The API cannot reopen the reported closed jump');
assert.equal(initial.snapshot.capturedAt, BUNDLED_MAP_AT, 'An ongoing route keeps its original immutable snapshot');
assert.equal(store.state().updating, false);
await store.refresh(); await store.ready(geometry);
assert.equal(requests, 1, 'Fresh maps are reused for a day');
assert.equal(reads, 1, 'Warm searches do not reread browser storage');

const restored = createMapCache(settings);
assert.equal((await restored.ready(geometry)).origin, 'saved');
assert.equal(restored.get().snapshot.capturedAt, live.snapshot.capturedAt);
await restored.refresh();
assert.equal(requests, 1, 'Reloading the app preserves the original freshness period');

send = async () => { throw Error('Network unavailable'); };
clock += MAP_MAX_AGE_MS + 1;
await restored.refresh();
assert.equal(restored.state().error, 'Network unavailable');
assert.equal(restored.get().snapshot.capturedAt, live.snapshot.capturedAt);
assert.equal(writes, 1);
await restored.refresh();
assert.equal(requests, 2, 'Rapid searches during an outage respect the retry cooldown');
await restored.refresh(true);
assert.equal(requests, 3, 'A manual update can retry immediately');

send = async () => [{ nickname: 'br01', Objs: [] }];
await restored.refresh(true);
assert.match(restored.state().error, /invalid system/);
assert.equal(writes, 1, 'Incomplete/malformed responses never replace a checked map');
send = async () => [{ nickname: 'other', Objs: [], Jumpholes: [] }];
await restored.refresh(true);
assert.match(restored.state().error, /does not cover/);
assert.equal(writes, 1);

// The timeout belongs to map refresh, never to the caller's trade request.
let aborted = false;
const timed = createMapCache({ ...settings, timeoutMs: 5,
  fetchSystems: signal => new Promise((resolve, reject) => signal.addEventListener('abort', () => {
    aborted = true; reject(new DOMException('Canceled', 'AbortError'));
  }, { once: true })) });
await timed.ready(geometry);
await timed.refresh(true);
assert(aborted);
assert.equal(timed.state().error, 'Map update timed out');
assert.equal(timed.get().snapshot.capturedAt, live.snapshot.capturedAt);

for (const invalid of [null, { ...disk, schema: 0 }, { ...disk, capturedAt: '2099-01-01T00:00:00Z' },
  { ...disk, systems: [] }, { ...disk, capturedAt: '2026-10-28T00:00:00Z' }]) {
  const corrupt = createMapCache({ ...settings, readCache: async () => invalid });
  assert.equal((await corrupt.ready(geometry)).origin, 'bundled', 'Invalid/older caches fall back to the packaged map');
}
send = async () => structuredClone(bundled.systems);
const fullDisk = createMapCache({ ...settings, writeCache: async () => { throw Error('Quota exceeded'); } });
await fullDisk.ready(geometry); await fullDisk.refresh(true);
assert.equal(fullDisk.get().origin, 'live', 'Storage failure must not discard a valid in-memory update');
assert.equal(fullDisk.state().error, '');
console.log('Map cache: independent updates, daily reuse, persistence, failure/timeout recovery, validation and pinned snapshots passed.');
