#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let now = Date.parse('2026-09-10T10:00:00Z');
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const saved = new Map();
saved.set('rhw-webapp-v4:price-check-sources', { resolvedAt: now,
  sources: { hydrocarbons: { nickname: 'br01_07_base', name: 'Kensington Shipping Platform' } } });
saved.set('rhw-webapp-v4:price-check-market-cache', { fetchedAt: new Date(now).toISOString(),
  routes: { hydrocarbons: { sourceNickname: 'br01_07_base', livePrice: 22, found: true, sold: true } } });
saved.set('prices', { hydrocarbons: 0 });
const telemetry = { available: true, stale: false, fetchedAt: new Date(now).toISOString() };
let payout = { sell_price: 500, price: 900 };
const app = {
  onUiUpdate() {},
  config: { storageKeys: { priceCheckOverrides: 'prices' } }, state: {},
  route: { parse() {}, write() {} }, util: { escape: v => String(v ?? '') },
  store: { get: (k, d) => saved.get(k) ?? d, set: (k, v) => { saved.set(k, v); return true; } }
};
const ctx = vm.createContext({ Date: Clock, console, addEventListener() {}, setTimeout() {}, clearTimeout() {}, navigator: { onLine: true },
  RHWV4: app, telemetrySnapshot: () => telemetry, findCommodity: () => payout, allBases: [],
  document: { addEventListener() {}, getElementById: () => null, createElement: () => ({ dataset: {} }),
    head: { appendChild() {} }, documentElement: { classList: { add() {} } } }
});
ctx.window = ctx;
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/core/lifecycle.js'), 'utf8'), ctx);
app.lifecycle = ctx.createRhwLifecycle();
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/core/refresh.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/price-check/workspace.js'), 'utf8'), ctx);
const api = app.pricecheck;
assert.equal(api.routes.length, 11);
assert.equal(api.state.sourceCache.sources, undefined, 'A pre-upgrade station cache is invalidated');
assert.equal(api.state.marketCache.routes, undefined, 'A pre-upgrade price cache is invalidated');
const hydroRoute = api.routes.find(r => r.key === 'hydrocarbons');
assert.equal(api.effectiveRow(hydroRoute).sourcePrice, null, 'Neither the old station nor a saved override supplies a price');
assert.match(api.rowMarkup(api.effectiveRow(hydroRoute)), /Thames Outpost/);
for (const key of ['mox', 'hydrocarbons', 'mining-machinery']) {
  assert.equal(api.routes.find(r => r.key === key).sourceNickname, 'br01_06_base');
}
assert.equal(api.routes.find(r => r.key === 'super-alloy').sourceNickname, 'br01_04_base');
const route = api.routes.find(r => r.key === 'hull-panels');
const source = { name: 'Portsmouth Shipyard', nickname: 'br01_02_base', system_name: 'Cambridge',
  market_goods: [{ name: 'Hull Panels', nickname: 'hull', base_sells: true, price_base_sells_for: 200 }] };

api.snapshotRoutes([source], { resolve: true });
let row = api.effectiveRow(route);
assert.equal(row.difference, 300);
assert.ok(row.fresh, 'A verified row remains fresh even when other routes are missing');
assert.match(api.rowMarkup(row), /pricecheck-source-price">\$200/);
assert.match(api.rowMarkup(row), /LIVE ·/);
assert.doesNotMatch(api.rowMarkup(row), /<input|pricecheck-reset|MANUAL ACTIVE/);
ctx.navigator.onLine = false;
row = api.effectiveRow(route);
assert.equal(row.difference, 300, 'An offline cached comparison remains usable');
assert.equal(row.fresh, false, 'Losing the network immediately changes source provenance');
assert.match(api.rowMarkup(row), /CACHED ·/);
assert.match(api.rowMarkup(row), /FROM CACHED PRICES/);
ctx.navigator.onLine = true;
assert.equal(api.effectiveRow(route).fresh, true, 'A still-recent snapshot can be used when back online');
api.state.lastError = 'offline';
row = api.effectiveRow(route);
assert.equal(row.difference, 300, 'Cached comparison remains usable with explicit provenance');
assert.ok(!row.fresh);
assert.match(api.rowMarkup(row), /CACHED ·/);
assert.match(api.rowMarkup(row), /FROM CACHED PRICES/);
assert.doesNotMatch(api.rowMarkup(row), /LIVE ·/);
api.state.lastError = '';

api.snapshotRoutes([], { resolve: true });
row = api.effectiveRow(route);
assert.equal(row.live, null, 'A successful empty response cannot refresh an old price');
assert.equal(row.difference, null);
api.snapshotRoutes([{ ...source, market_goods: [] }], { resolve: true });
assert.equal(api.effectiveRow(route).sourcePrice, null, 'A missing commodity is unknown');
api.snapshotRoutes([{ ...source, market_goods: [{ ...source.market_goods[0], base_sells: false }] }], { resolve: true });
assert.equal(api.effectiveRow(route).sourcePrice, null, 'A non-selling base has no offered source price');

api.snapshotRoutes([source], { resolve: true });
const resolvedAt = api.state.sourceCache.resolvedAt;
let retry = false;
for (let i = 0; i < 72; i++) {
  now += 300000;
  api.snapshotRoutes([source]);
  retry ||= api.shouldResolveSources(false);
}
assert.equal(api.state.sourceCache.resolvedAt, resolvedAt, 'Market refreshes do not renew source-resolution time');
assert.ok(retry, 'Missing sources are retried after six hours of normal refreshes');

assert.equal(api.resolveSource(route, [{ ...source, nickname: 'other-port' }]), null, 'An identical station name cannot replace the configured ID');
assert.equal(api.resolveSource(route, [source, { ...source }]), null, 'Duplicate configured IDs remain unresolved');
assert.equal(api.resolveSource(route, [source]).nickname, 'br01_02_base');
const thames = { name: 'Thames Outpost', nickname: 'br01_06_base', system_name: 'New London', market_goods: [
  { name: 'Hydrocarbons', base_sells: true, price_base_sells_for: 22 },
  { name: 'MOX', base_sells: true, price_base_sells_for: 17 },
  { name: 'Mining Machinery', base_sells: true, price_base_sells_for: 7 }
] };
const wrongSource = { ...thames, nickname: 'br01_07_base', name: 'Kensington Shipping Platform' };
api.snapshotRoutes([wrongSource], { resolve: true });
assert.equal(api.effectiveRow(hydroRoute).sourcePrice, null, 'An old source selling the same good is not a fallback');
api.snapshotRoutes([thames, wrongSource]);
assert.equal(api.effectiveRow(hydroRoute).sourcePrice, 22);
assert.equal(api.effectiveRow(api.routes.find(r => r.key === 'mining-machinery')).sourcePrice, 7);
assert.ok(saved.get('rhw-webapp-v4:price-check-sources').sourceRevision);
assert.equal(saved.get('rhw-webapp-v4:price-check-sources').sourceRevision, saved.get('rhw-webapp-v4:price-check-market-cache').sourceRevision);
api.state.marketCache.routes.hydrocarbons = { sourceNickname: 'br01_07_base', sourceName: 'Kensington', livePrice: 1, found: true, sold: true };
assert.equal(api.effectiveRow(hydroRoute).sourcePrice, null, 'A mismatched cached quote cannot be relabelled as Thames');

api.snapshotRoutes([source], { resolve: true });
api.state.overrides[route.key] = 0;
assert.equal(api.effectiveRow(route).difference, 300, 'Archived zero overrides never replace NPC prices');
api.state.overrides[route.key] = 9999999;
assert.equal(api.effectiveRow(route).difference, 300, 'Archived overrides never replace NPC prices');
payout = { sell_price: 200 };
assert.equal(api.effectiveRow(route).tone, 'neutral');
payout = { sell_price: 100 };
assert.equal(api.effectiveRow(route).tone, 'negative');
delete api.state.overrides[route.key];
payout = { price: 900 };
assert.equal(api.effectiveRow(route).payout, null, 'RHW asking price is not its purchase price');
payout = { sell_price: 500 };
telemetry.available = false;
assert.equal(api.effectiveRow(route).payout, null);
assert.match(api.rowMarkup(api.effectiveRow(route)), /RHW DATA UNAVAILABLE/);
telemetry.available = true;

// Saved prices from retired list entries remain compatible with old backups.
api.importOverrides({ 'hull-panels': 125, copper: 0 });
assert.equal(saved.get('prices').copper, 0);
assert.equal(api.state.overrides['hull-panels'], 125);
assert.equal(api.effectiveRow(route).sourcePrice, 200, 'Importing an old backup cannot reactivate manual pricing');
for (const raw of [{ copper: -1 }, { copper: '100' }, { copper: true }, { copper: Infinity }, { unknown: 1 }, []]) {
  assert.throws(() => api.normalizeOverrides(raw));
}
const before = api.state.overrides;
app.store.set = () => false;
assert.throws(() => api.importOverrides({ copper: 80 }), /COULD NOT BE SAVED/);
assert.equal(api.state.overrides, before, 'Failed import preserves current overrides');
console.log('Price Check passed: fixed station IDs, cache migration, read-only NPC quotes, provenance, missing data, price direction and archived overrides');

// Round-trip the new section through the actual storage module.
app.store.set = (key, value) => { saved.set(key, value); return true; };
Object.assign(app.config.storageKeys, { localSenders: 'senders', commsDrafts: 'drafts', commsCurrent: 'current' });
app.config.senders = [{ key: 'rhw', name: 'RHW' }];
app.config.templates = [{ key: 'official', classification: 'RHW OFFICIAL', salutation: 'Hello', closing: 'Regards' }];
app.config.forum = { footerMotto: 'RHW' };
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/data/storage.js'), 'utf8'), ctx);
app.storage.init();
const backup = app.storage.exportPayload();
assert.equal(backup.version, 5);
assert.equal(backup.priceCheckOverrides.copper, 0);
api.state.overrides = {}; saved.set('prices', {});
app.storage.importPayload(backup, { sections: ['priceCheckOverrides'] });
assert.equal(api.state.overrides['hull-panels'], 125);
assert.equal(api.state.overrides.copper, 0);
assert.equal(saved.get('prices').copper, 0);
const badBackup = { ...backup, priceCheckOverrides: { copper: -1 }, current: { subject: 'DO NOT IMPORT' } };
const originalCurrent = app.state.comms;
assert.throws(() => app.storage.importPayload(badBackup, { sections: ['priceCheckOverrides', 'current'] }));
assert.equal(app.state.comms, originalCurrent, 'Invalid prices fail before unrelated backup sections mutate');
console.log('Price Check backup passed: detached export, round trip, zero prices and validation before mutations');
