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
const telemetry = { available: true, stale: false, fetchedAt: new Date(now).toISOString() };
let payout = { sell_price: 500, price: 900 };
const app = {
  config: { storageKeys: { priceCheckOverrides: 'prices' } }, state: {},
  route: { parse() {}, write() {} }, util: { escape: v => String(v ?? '') },
  store: { get: (k, d) => saved.get(k) ?? d, set: (k, v) => { saved.set(k, v); return true; } }
};
const ctx = vm.createContext({ Date: Clock, console,
  RHWV4: app, telemetrySnapshot: () => telemetry, findCommodity: () => payout, allBases: [],
  document: { getElementById: () => null, createElement: () => ({ dataset: {} }),
    head: { appendChild() {} }, documentElement: { classList: { add() {} } } }
});
ctx.window = ctx;
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/37-app-price-check.js'), 'utf8'), ctx);
const api = app.pricecheck;
const route = api.routes.find(r => r.key === 'hull-panels');
const source = { name: 'Portsmouth Shipyard', nickname: 'portsmouth', system_name: 'Cambridge',
  market_goods: [{ name: 'Hull Panels', nickname: 'hull', base_sells: true, price_base_sells_for: 200 }] };

api.snapshotRoutes([source], { resolve: true });
let row = api.effectiveRow(route);
assert.equal(row.difference, 300);
assert.ok(row.fresh, 'A verified row remains fresh even when other routes are missing');
assert.match(api.rowMarkup(row), /LIVE \$200/);
api.state.lastError = 'offline';
row = api.effectiveRow(route);
assert.equal(row.difference, 300, 'Cached comparison remains usable with explicit provenance');
assert.ok(!row.fresh);
assert.match(api.rowMarkup(row), /CACHED \$200/);
assert.match(api.rowMarkup(row), /FROM CACHED PRICES/);
assert.doesNotMatch(api.rowMarkup(row), /LIVE \$200/);
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

assert.equal(api.resolveSource(route, [{ ...source, name: '' }]), null, 'Blank names are never matches');
assert.equal(api.resolveSource(route, [source, { ...source, nickname: 'other-port' }]), null, 'Ambiguous sources remain unresolved');
assert.equal(api.resolveSource(route, [source]).nickname, 'portsmouth');

api.state.overrides[route.key] = 0;
assert.equal(api.effectiveRow(route).difference, 500, 'Zero is a valid deliberate manual price');
api.state.overrides[route.key] = 500;
assert.equal(api.effectiveRow(route).tone, 'neutral');
api.state.overrides[route.key] = 600;
assert.equal(api.effectiveRow(route).tone, 'negative');
delete api.state.overrides[route.key];
payout = { price: 900 };
assert.equal(api.effectiveRow(route).payout, null, 'RHW asking price is not its purchase price');
payout = { sell_price: 500 };
telemetry.available = false;
assert.equal(api.effectiveRow(route).payout, null);
assert.match(api.rowMarkup(api.effectiveRow(route)), /RHW DATA UNAVAILABLE/);
telemetry.available = true;

const copper = api.routes.find(r => r.key === 'copper');
ctx.allBases.push({ name: 'Copperland', nickname: 'copperland', shop_items: [{ name: 'Copper', price: 80, sell_price: 60 }] });
assert.equal(api.effectiveRow(copper).sourcePrice, 80);
ctx.allBases.length = 0;
assert.equal(api.effectiveRow(copper).sourcePrice, null, 'A missing POB is not an NPC cache quote');

api.importOverrides({ 'hull-panels': 125, copper: 0 });
assert.equal(saved.get('prices').copper, 0);
assert.equal(api.state.overrides['hull-panels'], 125);
for (const raw of [{ copper: -1 }, { copper: '100' }, { copper: true }, { copper: Infinity }, { unknown: 1 }, []]) {
  assert.throws(() => api.normalizeOverrides(raw));
}
const before = api.state.overrides;
app.store.set = () => false;
assert.throws(() => api.importOverrides({ copper: 80 }), /COULD NOT BE SAVED/);
assert.equal(api.state.overrides, before, 'Failed import preserves current overrides');
console.log('Price Check passed: provenance, partial/empty data, six-hour retries, source identity, price direction, sign colors and import validation');

// Round-trip the new section through the actual storage module.
app.store.set = (key, value) => { saved.set(key, value); return true; };
Object.assign(app.config.storageKeys, { localSenders: 'senders', commsDrafts: 'drafts', commsCurrent: 'current' });
app.config.senders = [{ key: 'rhw', name: 'RHW' }];
app.config.templates = [{ key: 'official', classification: 'RHW OFFICIAL', salutation: 'Hello', closing: 'Regards' }];
app.config.forum = { footerMotto: 'RHW' };
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/14-app-v40-cache.js'), 'utf8'), ctx);
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
