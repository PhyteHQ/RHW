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
saved.set('prices', { hydrocarbons: 0 });
const telemetry = { available: true, stale: false, fetchedAt: new Date(now).toISOString() };
let savedMarket;
const commodityName = name => String(name || '').trim().toLowerCase().replace(/^super alloys$/, 'super alloy');
const app = {
  onUiUpdate() {},
  config: { storageKeys: { priceCheckOverrides: 'prices' } }, state: {},
  route: { parse() {}, write() {} }, util: { escape: v => String(v ?? '') },
  store: { get: (k, d) => saved.get(k) ?? d, set: (k, v) => { saved.set(k, v); return true; } }
};
const ctx = vm.createContext({ Date: Clock, console, addEventListener() {}, setTimeout() {}, clearTimeout() {}, navigator: { onLine: true },
  RHWV4: app, telemetrySnapshot: () => telemetry, rhwBase: null,
  commodityKey: item => commodityName(item.name), keyFromName: commodityName,
  displayName: item => item.name || item.nickname,
  RHWTelemetryCache: { writeMarket: async value => { savedMarket = value; } },
  document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, createElement: () => ({ dataset: {} }),
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
assert.equal(api.state.hourlyTarget, 750000, 'The default target is $750k/h');
const good = (nickname, name, price_base_sells_for, extra = {}) =>
  ({ nickname, name, base_sells: true, price_base_sells_for, category: 'commodity', ...extra });
const hull = good(hullId, 'Hull Panels', 200);
const source = { name: 'Portsmouth Shipyard', nickname: 'br01_02_base', system_name: 'Cambridge', market_goods: [
  hull, good(moxId, 'MOX', 120), good(oxygenId, 'Oxygen', 90), good(alternateId, 'Wildcat Gold', 600),
  good('commodity_buy_only', 'Bought Here', 99, { base_sells: false }),
  good('weapon', 'Weapon', 15, { category: 'gun' }),
  good('commodity_pob_offer', 'POB Offer', 15, { PoB: true }),
  good('commodity_other_hull', 'Hull Panels', 100),
  good('commodity_synthetic', 'Placeholder', 20),
  good('commodity_equipment', 'Equipment with a commodity listing', 50),
  good('commodity_named_a', 'Ambiguous Ore', 22), good('commodity_named_b', 'Ambiguous Ore', 30)
] };
const hydroId = 'commodity_hydrocarbons';
const hydro = good(hydroId, 'Hydrocarbons', 0);
const thames = { name: 'Thames Outpost', nickname: 'br01_06_base', system_name: 'New London', market_goods: [
  good(hullId, 'Hull Panels', 310), hydro, hydro, good('commodity_missing_quote', 'Missing Quote', null)
] };
const offer = () => api.routes.find(r => r.key === `br01_02_base/${hullId}`);
const irrelevant = Array.from({ length: 50 }, (_, index) => ({
  nickname: `unrelated-base-${index}`, market_goods: Array.from({ length: 54 }, (_, n) => good(`unrelated-${n}`, `Other Good ${n}`, 10))
}));
const fixture = [source, thames, { ...thames, nickname: 'player-base', IsPob: true }, ...irrelevant];
assert.equal(api.snapshotRoutes(fixture), false, 'The NPC response alone cannot define the market list');
assert.equal(api.routes.length, 0);
assert.equal(savedMarket, undefined);
const hullStock = { nickname: hullId, name: 'RHW Hull Parts', sell_price: 500, price: 900 };
const shop = [
  hullStock, { name: 'Hydrocarbons', sell_price: 100 }, { nickname: 'commodity_missing_quote', quantity: 0 },
  { nickname: moxId }, { nickname: oxygenId }, { nickname: alternateId },
  { nickname: 'commodity_synthetic', name: 'Placeholder', synthetic: true },
  { nickname: 'commodity_equipment', category: 'gun' }, { name: 'Ambiguous Ore' },
  { nickname: 'commodity_buy_only', name: 'Bought Here' }, { nickname: 'commodity_pob_offer' },
  { name: 'Named Commodity', category: 'commodity' }, { nickname: 'thruster', category: 'equipment' }
];
ctx.rhwBase = { shop_items: shop };
api.snapshotRoutes(fixture);
assert.deepEqual(Array.from(api.routes, route => [route.source, route.commodity, route.livePrice]), [
  ['Portsmouth Shipyard', 'MOX', 120], ['Portsmouth Shipyard', 'Oxygen', 90],
  ['Portsmouth Shipyard', 'Wildcat Gold', 600], ['Portsmouth Shipyard', 'Hull Panels', 200], ['Thames Outpost', 'Hydrocarbons', 0],
  ['Thames Outpost', 'Missing Quote', null], ['Thames Outpost', 'Hull Panels', 310]
], 'Only NPC sellers of eligible Full Manifest commodities are retained');
assert.equal(savedMarket.routes.length, 7, 'Out-of-scope offers are removed before storing the snapshot');
assert.equal(savedMarket.schema, 4);
assert.equal(savedMarket.fetchedAt, new Date(now).toISOString());
assert.deepEqual(Array.from(saved.keys()), ['prices'], 'Market refreshes never write to the private settings store');
assert.equal(api.rows.filter(row => row.itemKey === hullId).length, 1, 'Two sellers produce one manifest line');
assert.equal(api.rows.find(row => row.itemKey === hullId).route.key, offer().key, 'The lowest published price wins when no flight is available');
assert.ok(api.rows.some(row => row.itemKey === moxId && row.route.sourceNickname), 'An NPC selling a commodity with a recipe is still a source');
assert.equal(api.rows.find(row => row.itemKey === 'commodity_buy_only').missingSource, 'No NPC seller reported');
assert.ok(api.rows.some(row => row.itemKey === 'name:named commodity' && row.missingSource), 'A category-tagged commodity without an ID still has a row');
assert.ok(!api.rows.some(row => row.itemKey === 'thruster'), 'Equipment stays outside the commodity list');

ctx.rhwBase = { shop_items: shop.filter(item => item !== hullStock) };
assert.equal(offer(), undefined, 'Removing a shop listing immediately hides its saved offers');
ctx.rhwBase = { shop_items: shop };
assert.equal(api.effectiveRow(offer()).payout, 500, 'The exact shop nickname works with a different display name');

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

api.state.overrides['hull-panels'] = 9999999;
assert.equal(api.effectiveRow(offer()).difference, 300, 'Archived overrides never replace NPC prices');
hullStock.sell_price = 200;
assert.equal(api.effectiveRow(offer()).tone, 'neutral');
hullStock.sell_price = 100;
assert.equal(api.effectiveRow(offer()).tone, 'negative');
delete api.state.overrides['hull-panels'];
delete hullStock.sell_price;
assert.equal(api.effectiveRow(offer()).payout, null, 'RHW asking price is not its purchase price');
hullStock.sell_price = 500;
telemetry.available = false;
assert.equal(api.effectiveRow(offer()).payout, null);
assert.match(api.rowMarkup(api.effectiveRow(offer())), /RHW DATA UNAVAILABLE/);
telemetry.available = true;
console.log('Price Check passed: one row per Full Manifest commodity, NPC sellers, exact identity, cache and quotes');

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

async function checkEarlierSnapshot() {
  const previous = { ...savedMarket, schema: 3, routes: [offer()] };
  ctx.RHWTelemetryCache.readMarket = async () => previous;
  api.state.marketCache = { routes: [] };
  api.init();
  await new Promise(setImmediate);
  assert.equal(api.state.marketLabel, 'CACHED MARKET');
  assert.equal(api.rows.find(row => row.itemKey === hullId).live, 200, 'The older market still supplies its known quote');
  assert.equal(api.rows.find(row => row.itemKey === moxId).missingSource, 'Awaiting NPC market', 'The previous subset does not prove sellers are absent');
}

checkEarlierSnapshot().catch(error => { console.error(error); process.exitCode = 1; });
