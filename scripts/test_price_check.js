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
const hullId = 'commodity_ship_hull_panels';
const moxId = 'commodity_mox_fuel';
const oxygenId = 'commodity_oxygen';
const alternateId = 'commodity_pirate_gold';
const catalog = { recipes: [
  { id: 'recipe_container_opening_hull_panels', outputs: [{ id: hullId }] },
  { id: 'recipe_mox_fuel_basic', outputs: [{ id: moxId }] },
  { id: 'recipe_heavy_water_basic', outputs: [{ id: 'commodity_deuterium' }, { id: oxygenId }] },
  { id: 'recipe_gold_basic', outputs: [{ id: 'commodity_gold' }, { id: alternateId }] }
] };
app.lifecycle.emit('catalog:loaded', { catalog });
assert.equal(api.routes.length, 0, 'An old fixed-route cache cannot masquerade as the expanded NPC feed');
const good = (nickname, name, price_base_sells_for, extra = {}) =>
  ({ nickname, name, base_sells: true, price_base_sells_for, category: 'commodity', ...extra });
const hull = good(hullId, 'Hull Panels', 200);
const source = { name: 'Portsmouth Shipyard', nickname: 'br01_02_base', system_name: 'Cambridge', market_goods: [
  hull, good(moxId, 'MOX', 120), good(oxygenId, 'Oxygen', 90), good(alternateId, 'Wildcat Gold', 600),
  good('commodity_buy_only', 'Bought Here', 99, { base_sells: false }),
  good('weapon', 'Weapon', 15, { category: 'gun' }),
  good('commodity_pob_offer', 'POB Offer', 15, { PoB: true })
] };
const hydroId = 'commodity_hydrocarbons';
const hydro = good(hydroId, 'Hydrocarbons', 0);
const thames = { name: 'Thames Outpost', nickname: 'br01_06_base', system_name: 'New London', market_goods: [
  good(hullId, 'Hull Panels', 310), hydro, hydro, good('commodity_missing_quote', 'Missing Quote', null)
] };
const offer = () => api.routes.find(r => r.key === `br01_02_base/${hullId}`);
const fixture = [source, thames, { ...thames, nickname: 'player-base', IsPob: true }];
api.snapshotRoutes(fixture);
assert.deepEqual(Array.from(api.routes, route => [route.source, route.commodity, route.livePrice]), [
  ['Portsmouth Shipyard', 'Hull Panels', 200], ['Thames Outpost', 'Hydrocarbons', 0],
  ['Thames Outpost', 'Missing Quote', null], ['Thames Outpost', 'Hull Panels', 310]
], 'Every NPC seller and genuine zero is retained, while POB manufacture, buyers and equipment are excluded');
assert.equal(saved.get('rhw-webapp-v4:price-check-market-cache').schema, 2);
assert.equal(saved.get('rhw-webapp-v4:price-check-market-cache').fetchedAt, new Date(now).toISOString());

let row = api.effectiveRow(offer());
assert.equal(row.difference, 300);
assert.equal(row.fresh, true);
assert.match(api.rowMarkup(row), /pricecheck-source-price">\$200/);
assert.match(api.rowMarkup(row), /LIVE ·/);
assert.doesNotMatch(api.rowMarkup(row), /<input|pricecheck-reset|MANUAL ACTIVE/);
ctx.navigator.onLine = false;
row = api.effectiveRow(offer());
assert.equal(row.difference, 300, 'An offline cached comparison remains usable');
assert.equal(row.fresh, false, 'Losing the network immediately changes source provenance');
assert.match(api.rowMarkup(row), /CACHED ·/);
assert.match(api.rowMarkup(row), /FROM CACHED PRICES/);
ctx.navigator.onLine = true;
api.state.lastError = 'offline';
assert.equal(api.effectiveRow(offer()).fresh, false, 'A failed refresh relabels the old quote');
api.state.lastError = '';
now += 600000;
assert.equal(api.effectiveRow(offer()).fresh, false, 'Age is measured from the original quote');

api.snapshotRoutes([thames]);
assert.equal(offer(), undefined, 'A disappeared station cannot inherit another source’s quote');
assert.equal(api.routes.find(r => r.goodNickname === hullId).livePrice, 310);
api.snapshotRoutes([]);
assert.equal(api.routes.length, 0, 'A successful empty response replaces old offers');
api.snapshotRoutes([{ ...source, market_goods: [hull, { ...hull, price_base_sells_for: 300 }] }]);
assert.equal(api.effectiveRow(offer()).live, null, 'Conflicting quotes for a station and commodity stay unknown');
api.snapshotRoutes(fixture);

app.lifecycle.emit('catalog:loaded', { catalog: { recipes: [...catalog.recipes, { id: 'recipe_new_hydrocarbons', outputs: [{ id: hydroId }] }] } });
assert.ok(!api.routes.some(r => r.goodNickname === hydroId), 'The latest catalog also filters previously received market offers');
app.lifecycle.emit('catalog:loaded', { catalog });
assert.ok(api.routes.some(r => r.goodNickname === hydroId), 'A catalog change can restore an eligible commodity without guessing a price');

api.state.overrides['hull-panels'] = 9999999;
assert.equal(api.effectiveRow(offer()).difference, 300, 'Archived overrides never replace NPC prices');
payout = { sell_price: 200 };
assert.equal(api.effectiveRow(offer()).tone, 'neutral');
payout = { sell_price: 100 };
assert.equal(api.effectiveRow(offer()).tone, 'negative');
delete api.state.overrides['hull-panels'];
payout = { price: 900 };
assert.equal(api.effectiveRow(offer()).payout, null, 'RHW asking price is not its purchase price');
payout = { nickname: 'other', sell_price: 600 };
assert.equal(api.effectiveRow(offer()).payout, null, 'Identically named goods cannot share RHW purchase prices');
ctx.rhwBase = { shop_items: [{ nickname: hullId, sell_price: 500 }] };
assert.equal(api.effectiveRow(offer()).payout, 500, 'The exact RHW shop item wins over name aliases');
telemetry.available = false;
assert.equal(api.effectiveRow(offer()).payout, null);
assert.match(api.rowMarkup(api.effectiveRow(offer())), /RHW DATA UNAVAILABLE/);
telemetry.available = true;
console.log('Price Check passed: NPC sellers, POB exclusions, exact station and commodity identity, cache and quotes');

// Saved prices from retired list entries remain compatible with old backups.
api.importOverrides({ 'hull-panels': 125, copper: 0 });
assert.equal(saved.get('prices').copper, 0);
assert.equal(api.state.overrides['hull-panels'], 125);
assert.equal(api.effectiveRow(offer()).live, 200, 'Importing an old backup cannot reactivate manual pricing');
for (const raw of [{ copper: -1 }, { copper: '100' }, { copper: true }, { copper: Infinity }, { unknown: 1 }, []]) {
  assert.throws(() => api.normalizeOverrides(raw));
}
const before = api.state.overrides;
app.store.set = () => false;
assert.throws(() => api.importOverrides({ copper: 80 }), /COULD NOT BE SAVED/);
assert.equal(api.state.overrides, before, 'Failed import preserves current overrides');

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

async function checkHourlyTarget() {
  const { estimateRoundTrips, fixedRouteHome, quoteHourly } = await import('../js/price-check/hourly.mjs');
  const { comparisonFleet } = await import('../js/supply/comparison-fleet.mjs');
  const { FALLBACK_SHIPS } = await import('../js/supply/ship-profiles.mjs');
  const home = fixedRouteHome({ nickname: 'rhw', system_nickname: 'br01', base_pos: { X: 0, Y: 0, Z: 0 } });
  assert.deepEqual(home, { id: 'rhw', system: 'br01', pos: [0, 0, 0] });
  assert.equal(fixedRouteHome({ nickname: 'rhw', system_nickname: 'br01' }), null);
  const navigation = { schema: 1, nodes: [
    { id: 'home', system: 'br01', pos: [0, 0, 0], kind: 'base', allows: ['medium', 'large'] },
    { id: 'thames', system: 'br01', pos: [50000, 0, 0], kind: 'base', allows: ['medium'] },
    { id: 'oder', system: 'rh01', pos: [0, 0, 0], kind: 'base', allows: ['medium'] }
  ], baseNodes: { rhw: 'home', br01_06_base: 'thames', rh01_02_base: 'oder' }, links: [
    { from: 'home', to: 'thames', kind: 'lane', speed: 2500 },
    { from: 'home', to: 'oder', kind: 'jump' }
  ] };
  const routes = [
    { key: 'mox', sourceId: 'br01_06_base', system: 'br01', goodId: 'commodity_mox' },
    { key: 'moved', sourceId: 'br01_06_base', system: 'br03', goodId: 'commodity_mox' },
    { key: 'unknown-good', sourceId: 'br01_06_base', system: 'br01', goodId: 'unknown' },
    { key: 'one-way', sourceId: 'rh01_02_base', system: 'rh01', goodId: 'commodity_mox' }
  ];
  const { mox, moved, 'unknown-good': unknown, 'one-way': oneWay } = estimateRoundTrips({ home, routes,
    navigation, ships: comparisonFleet(FALLBACK_SHIPS), goods: [{ id: 'commodity_mox', volume: 1, volumes: { 9: 2 } }] });
  const train = mox.candidates.find(candidate => candidate.hauler === 'transport-5000');
  assert.equal(train.units, 2500, 'Cargo volume depends on the selected hull class');
  assert.equal(train.seconds, 30 + (50000 / 350 + 5) + 90, 'One-way lane changes the return time and each dock is counted');
  const barge = mox.candidates.find(candidate => candidate.hauler === 'barge');
  assert.ok(Math.abs(barge.seconds - (2 * (50000 / 90 + 15) + 90)) < 1e-6, 'Barge cannot use the outbound lane');
  assert.ok(!mox.candidates.some(candidate => candidate.hauler === 'pilgrim'), 'An incompatible docking class has no quote');
  assert.equal(moved.candidates.length, 0, 'A moved supplier cannot borrow its old docking position');
  assert.equal(unknown.candidates.length, 0, 'Missing volume has no guessed default');
  assert.equal(oneWay.candidates.length, 0, 'A route without a usable return has no quote');

  const example = [{ hauler: 'transport-5000', ship: 'Advanced Train', units: 5000, seconds: 900 }];
  const options = { hauler: 'auto', quantity: null, sourcePrice: 200, payout: 220, target: 500000 };
  const quotes = [250000, 500000, 750000, 1000000].map(target => quoteHourly(example, { ...options, target }));
  assert.deepEqual(quotes.map(quote => quote.targetPrice), [213, 225, 238, 250], 'Round target up to a whole per-unit price');
  assert.ok(quotes.every(quote => quote.currentRate === 400000), 'Changing the target does not change today’s profit');
  assert.equal(quoteHourly(example, { ...options, quantity: 2500 }).targetPrice, 250);
  assert.equal(quoteHourly(example, { ...options, quantity: 6000 }).units, 5000);
  assert.equal(quoteHourly(example, { ...options, payout: 190 }).currentRate, -200000);
  assert.equal(quoteHourly(example, { ...options, payout: null }).currentRate, null);
  assert.equal(quoteHourly(example, { ...options, sourcePrice: null }), null);
  assert.equal(quoteHourly(example, { ...options, hauler: 'pilgrim' }), null);
  const auto = quoteHourly(mox.candidates, { ...options, quantity: 1000 });
  assert.equal(auto.hauler, 'transport-3600', 'Auto chooses the highest throughput for the entered load');
  console.log('Price Check targets passed: fixed route, directed travel, hull volumes, docking, selectable cargo and integer payouts');
}

checkHourlyTarget().catch(error => { console.error(error); process.exitCode = 1; });
