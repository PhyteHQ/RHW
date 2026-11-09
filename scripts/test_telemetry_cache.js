#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.join(__dirname, '..');
const bases = [{ name: 'Resolution Heavy Works', money: 100, shop_items: [{ name: 'Food Rations', quantity: 12 }] }];
const fetchedAt = '2026-10-01T12:00:00.000Z';

function disk() {
  let value, fail = false;
  const db = { objectStoreNames: { contains: () => true }, close() {},
    transaction(_store, mode) {
      const tx = {};
      tx.objectStore = () => ({
        get() {
          const req = {};
          queueMicrotask(() => { req.result = structuredClone(value); req.onsuccess?.(); });
          return req;
        },
        put(next) {
          queueMicrotask(() => {
            if (fail) tx.onabort?.();
            else { assert.equal(mode, 'readwrite'); value = structuredClone(next); tx.oncomplete?.(); }
          });
        }
      });
      return tx;
    }
  };
  return { indexedDB: { open() { const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess?.(); }); return req; } },
    fail(value) { fail = value; } };
}
function cache(indexedDB) {
  const ctx = vm.createContext({ indexedDB, Date, DASHBOARD_CONFIG: { baseName: 'resolution heavy works' } });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/data/telemetry-cache.js'), 'utf8'), ctx);
  return ctx.RHWTelemetryCache;
}

(async () => {
  const storage = disk(), first = cache(storage.indexedDB);
  assert.equal(await first.read(), null);
  assert.equal(await first.write({ bases, fetchedAt }), true);
  const reloaded = cache(storage.indexedDB), saved = await reloaded.read();
  assert.equal(saved.fetchedAt, fetchedAt, 'Reload retains the original timestamp');
  assert.equal(saved.bases[0].shop_items[0].quantity, 12, 'Reload restores the reported stock');
  storage.fail(true);
  assert.equal(await reloaded.write({ bases: [], fetchedAt }), false, 'Invalid data cannot replace the snapshot');
  assert.equal(await reloaded.write({ bases, fetchedAt: new Date().toISOString() }), false, 'Quota failure is nonfatal');
  assert.equal((await reloaded.read()).fetchedAt, fetchedAt, 'A failed transaction preserves the previous snapshot');
  assert.equal(await cache(undefined).read(), null, 'Unsupported storage falls back to live-only behavior');
  assert.equal(first.valid({ schemaVersion: 1, bases, fetchedAt: 'invalid' }), false);
  assert.equal(first.valid({ schemaVersion: 1, bases, fetchedAt: '2999-01-01' }), false);
  assert.equal(first.valid({ schemaVersion: 2, bases, fetchedAt }), false);

  let written, failNetwork = true;
  const renders = [];
  const ctx = vm.createContext({ console: { error() {} }, Date, Map, Event,
    BASE_NAME: 'resolution heavy works', API_URL: 'https://fixture.test/pobs', REMOTE_FACILITIES: [], AUTO_REFRESH_MS: 300000,
    FEATURES: {}, navigator: { onLine: true }, items: [], allBases: [], rhwBase: null,
    lastLoaded: null, lastSyncError: '', dataIsStale: false, isLoading: false, refreshTimer: null,
    nextSyncAt: null, document: { hidden: false, body: { classList: { add() {}, remove() {} } },
      getElementById() {}, addEventListener() {} },
    els: { roleSegmentButtons: [], tableHeaders: [] },
    normalize: value => String(value || '').trim().toLowerCase(),
    addEventListener() {}, dispatchEvent() {}, setTimeout: () => 1, clearTimeout() {},
    setTelemetryState() {}, setFooterConnection() {}, updateSyncCountdown() {}, updateTelemetryNotice() {},
    findRemoteFacility() {}, rebuildItemCaches() {},
    hasVerifiedTelemetry: () => Boolean(ctx.rhwBase && ctx.lastLoaded),
    renderAll: () => renders.push({ stale: ctx.dataIsStale, at: ctx.lastLoaded?.toISOString() }),
    RHWTelemetryCache: { read: async () => saved, write: async snapshot => { written = snapshot; return true; } },
    fetchWithTimeout: async () => {
      if (failNetwork) throw Error('offline');
      return { ok: true, json: async () => [{ ...bases[0], shop_items: [{ name: 'Food Rations', quantity: 99 }] }] };
    }
  });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(root, 'js/data/refresh.js'), 'utf8'), ctx);
  await ctx.loadData();
  assert.equal(ctx.items[0].quantity, 12);
  assert.equal(ctx.lastLoaded.toISOString(), fetchedAt);
  assert.equal(ctx.dataIsStale, true, 'Restored snapshots never become live on a failed fetch');
  assert.equal(written, undefined, 'Network failures never overwrite the cache');
  failNetwork = false;
  await ctx.loadData();
  assert.equal(ctx.items[0].quantity, 99);
  assert.equal(ctx.dataIsStale, false);
  assert.notEqual(ctx.lastLoaded.toISOString(), fetchedAt);
  assert.equal(written.bases[0].shop_items[0].quantity, 99, 'Successful fetch replaces public cached stock');
  assert.ok(renders.some(render => render.stale && render.at === fetchedAt));
  console.log('Telemetry cache passed: persisted reload, original age, corrupt data, quota failures and live recovery.');
})().catch(error => { console.error(error); process.exitCode = 1; });
