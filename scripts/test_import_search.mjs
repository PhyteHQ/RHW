import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { searchSupply, quoteSupply } from '../js/supply/planner.mjs';
import { makeLeg, simulate, optimizeTour, normalizeDarkstat } from '../js/supply/core/trade.mjs';
import { dockingAccess } from '../js/supply/access.mjs';
import { identityRegistry } from '../js/supply/identity-profiles.mjs';
import { normalizeShipRegistry } from '../js/supply/ship-profiles.mjs';
import { searchIdentities } from '../js/supply/identity-planner.mjs';
import { comparisonFleet } from '../js/supply/comparison-fleet.mjs';
import { identityShipCheck } from '../js/supply/identity-profiles.mjs';
import { ShipNavigator } from '../js/supply/navigation.mjs';

const good = { id: 'ablative', name: 'Ablative Armor Plating', buy: 30, sell: 105, volume: 1, originalVolume: 1, volumes: {} };
const alloy = { id: 'alloy', name: 'Super Alloy', buy: 56, sell: 122, volume: 1, originalVolume: 1, volumes: {} };
const waste = { id: 'waste', name: 'Toxic Waste', buy: 5, sell: 14, volume: 1, originalVolume: 1, volumes: {} };
const home = { id: 'home', name: 'Resolution Heavy Works', kind: 'pob', system: 'br01', pos: [0, 0, 0], cash: 1e8, space: 1e6,
  offers: [{ ...good, stock: 0, min: 0, max: 30000 }, { ...waste, stock: 10000, min: 0, max: 20000 }] };
const pickup = { id: 'pickup', name: 'Local Alloy Supplier', kind: 'npc', system: 'br01', pos: [150000, 0, 0], offers: [alloy] };
const supplier = { id: 'supplier', name: 'Plating Supplier', kind: 'npc', system: 'br01', pos: [300000, 0, 0], offers: [good, alloy, waste] };
const distractions = Array.from({ length: 25 }, (_, i) => ({ id: 'other_' + i, name: 'Other Market ' + i,
  kind: 'npc', system: 'br01', pos: [10000 + i * 1000, 0, 0], offers: [] }));
const data = { schema: 1, asOf: '2026-10-29T09:00:00Z', bases: [home, pickup, supplier, ...distractions] };
const nav = { schema: 1, nodes: data.bases.map(base => ({ id: base.id, system: base.system, pos: base.pos, kind: 'base' })),
  baseNodes: Object.fromEntries(data.bases.map(base => [base.id, base.id])), links: [
    ['home', 'pickup'], ['pickup', 'home'], ['pickup', 'supplier'], ['supplier', 'pickup']
  ].map(([from, to]) => ({ from, to, kind: 'lane', speed: 2500 })) };
const train = { id: 'train', name: '5k Test Transport', cargo: 5000, cruise: 350, dock: 'medium', tradeLanes: true, cruiseCharge: 5 };
const slow = { ...train, id: 'slow_bulk', name: 'Slow Bulk Test Hull', cargo: 30000, cruise: 90, tradeLanes: false };

// Reverse trees must preserve directed jumps and the original lane-entry costs,
// including mixed base/lane edges, explicit cruise links and no-lane hulls.
const directed = { schema: 1, nodes: [
  { id: 'a', kind: 'base', system: 'a', pos: [0, 0, 0] },
  { id: 'l1', kind: 'lane', system: 'a', pos: [100, 0, 0] },
  { id: 'l2', kind: 'lane', system: 'a', pos: [10000, 0, 0] },
  { id: 'b', kind: 'base', system: 'a', pos: [12000, 0, 0] },
  { id: 'ga', kind: 'jump', system: 'a', pos: [13000, 0, 0] },
  { id: 'gb', kind: 'jump', system: 'b', pos: [0, 0, 0] },
  { id: 'c', kind: 'base', system: 'b', pos: [10000, 0, 0] }
], baseNodes: { a: 'a', b: 'b', c: 'c' }, links: [
  { from: 'a', to: 'l1', kind: 'lane', speed: 2500 },
  { from: 'l1', to: 'l2', kind: 'lane', speed: 2500 },
  { from: 'l2', to: 'b', kind: 'cruise' },
  { from: 'ga', to: 'gb', kind: 'jump', cargoLimit: 10000 }
] };
const beforeNavigation = structuredClone(directed);
for (const ship of [train, slow]) {
  const forward = new ShipNavigator(directed, [], ship), reverse = new ShipNavigator(directed, [], ship, { reverse: true });
  for (const from of ['a', 'b', 'c']) for (const to of ['a', 'b', 'c']) {
    const expected = forward.route(from, to), actual = reverse.route(to, from);
    assert.equal(Boolean(actual), Boolean(expected));
    if (expected) {
      assert.ok(Math.abs(actual.seconds - expected.seconds) < 1e-6, 'Reverse lookup must equal the actual directed flight');
      assert.equal(actual.jumps, expected.jumps);
    }
  }
}
assert.deepEqual(directed, beforeNavigation);

// Deterministic cost model: checking a slow hull against every optional pickup
// consumes the budget. Such a hull cannot fit the fastest-import time window.
// Its irrelevant approach scan must not starve a viable ordinary transport.
let tick = 0;
const descriptor = Object.getOwnPropertyDescriptor(performance, 'now');
Object.defineProperty(performance, 'now', { configurable: true, value: () => tick });
try {
  const found = await searchSupply(data, nav, [slow, train], { commodity: 'ablative', extraPercent: 20, importGoal: 'price', searchMs: 1000,
    routeEligibility: (ship, stops) => { if (ship.id === slow.id && stops.length === 3) tick += 100; return 'checked'; } });
  assert.equal(found.results[0].ship.id, train.id);
  assert.deepEqual(found.results[0].stops, ['home', 'pickup', 'supplier', 'home']);
  assert.equal(found.results[0].profit, 705000);
  assert.equal(found.results[0].delivered, 5000);
  assert.ok(found.results[0].seconds <= found.stats.benchmarkSeconds * 1.2);
  assert.equal(found.stats.timedOut, false);
  assert.ok(found.stats.approachJobs && found.stats.approachChecked);
} finally {
  if (descriptor) Object.defineProperty(performance, 'now', descriptor);
  else delete performance.now;
}

// A seller receives the player's money and frees its storage. Unknown balances
// stay unknown; buyer funds/storage, reserves and player capital still apply.
const undisclosed = { ...structuredClone(supplier), kind: 'pob', cash: null, space: null,
  offers: [{ ...good, stock: 400, min: 300, max: 3000 }] };
const leg = makeLeg(undisclosed, home, good.id, train);
assert.ok(leg);
const quote = quoteSupply([{ source: home.id, target: supplier.id, good: null }, leg], [home, undisclosed], train);
assert.equal(quote.delivered, 100);
const sellerEvent = quote.events.find(event => event.base === supplier.id);
assert.equal(sellerEvent.after.cash, null);
assert.equal(sellerEvent.after.space, null);
assert.equal(makeLeg(home, undisclosed, good.id, train), null, 'An undisclosed buyer cannot promise payment/storage');
assert.equal(quoteSupply([{ source: home.id, target: supplier.id, good: null }, leg], [home, undisclosed], train, { capital: 29 }), null);
const mixedLeg = { ...leg, items: [leg] };
assert.equal(simulate([mixedLeg], [[100]], [home, undisclosed], { capital: 3000, cargo: 5000 }).profit, 7500);
assert.equal(optimizeTour([mixedLeg], [home, undisclosed], { capital: 3000, cargo: 5000 }).profit, 7500);
const broke = { ...home, cash: 0 };
assert.equal(quoteSupply([{ source: home.id, target: supplier.id, good: null }, leg], [broke, undisclosed], train), null);

// Actual Gifu disclosure shape and normal Spa ID: no whitelist is inferred
// from a missing mode. The default stays unverified; the explicit unverified
// option may show a conditional quote, never a normal recommendation.
const capture = JSON.parse(await readFile(new URL('./fixtures/live-navigation-2026-10-29.json', import.meta.url)));
const identityData = JSON.parse(await readFile(new URL('./fixtures/player-id-routes-2026-10-28.json', import.meta.url)));
const flight = JSON.parse(await readFile(new URL('./fixtures/hauler-flight-2026-10-28.json', import.meta.url)));
const spa = identityRegistry(identityData.tractors, identityData.cards).find(id => id.id === 'dsy_license_co_os_grp');
const realTrain = normalizeShipRegistry(flight.ships).find(ship => ship.nickname === 'dsy_advanced_train');
const gifuRaw = { ...capture.gifu, faction_nickname: 'fc_h_grp', base_pos: [300000, 0, 0] };
const gifu = normalizeDarkstat([gifuRaw], [], capture.capturedAt).bases[0];
const target = { ...home, offers: [{ ...gifu.offers[0], buy: 14000, sell: 14000, stock: 0, min: 0, max: 300 }] };
const market = { schema: 1, asOf: capture.capturedAt, bases: [target, gifu] };
const scopeFor = raw => {
  const access = dockingAccess(market.bases, [], [], identityData.tractors, spa.id,
    [{ nickname: home.id, faction_nickname: 'br_m_grp', defense_mode: 1 }, raw]);
  return { identity: spa, accessReady: access.ready, blocked: access.blocked, unverifiedDocks: access.unverifiedDocks, approvalDocks: access.approvalDocks };
};
const scope = scopeFor(gifuRaw);
assert.ok(scope.unverifiedDocks.includes(gifu.id));
assert.ok(!scope.approvalDocks.includes(gifu.id));
const gifuNav = { schema: 1, nodes: market.bases.map(base => ({ id: base.id, system: base.system, pos: base.pos, kind: 'base' })),
  baseNodes: Object.fromEntries(market.bases.map(base => [base.id, base.id])), links: [
    { from: home.id, to: gifu.id, kind: 'jump' }, { from: gifu.id, to: home.id, kind: 'jump' }
  ] };
const options = { commodity: gifu.offers[0].id, shipId: realTrain.id, extraPercent: 0 };
assert.equal((await searchIdentities(market, gifuNav, [realTrain], [scope], options)).results.length, 0);
const conditional = await searchIdentities(market, gifuNav, [realTrain], [scope], { ...options, includeUnverified: true });
assert.equal(conditional.results[0].delivered, 166);
assert.equal(conditional.results[0].shipCheck.state, 'conditional');
assert.equal(conditional.results[0].recommendation, null);
const whitelist = scopeFor({ ...gifuRaw, defense_mode: 2 });
assert.ok(whitelist.approvalDocks.includes(gifu.id));
assert.equal((await searchIdentities(market, gifuNav, [realTrain], [whitelist], { ...options, includeUnverified: true })).results.length, 0);

const registry = normalizeShipRegistry(flight.ships);
const fastHull = { ...realTrain, id: 'ship:dsy_firefly', nickname: 'dsy_firefly', name: 'Controlled 3.6k Hull',
  cargo: 3600, cruise: 500, shipClass: 6, volumeClass: 6 };
const available = [...registry, fastHull];
const fleet = comparisonFleet(available);
assert.deepEqual(fleet.map(ship => ship.fleetId), ['barge', 'transport-5000', 'pilgrim', 'transport-3600']);
assert.deepEqual(fleet.map(ship => [ship.cargo, ship.cruise]), [[30000, 90], [5000, 350], [4300, 415], [3600, 500]]);
assert.equal(fastHull.cruise, 500);
assert.equal(Object.hasOwn(fleet[3], 'userCruise'), false);
assert.equal(Object.hasOwn(fleet[3], 'reportedCruise'), false);
assert.deepEqual(comparisonFleet(fleet), fleet);
const cached = { ...fastHull, cruise: 600, reportedCruise: 500, userCruise: true };
assert.equal(comparisonFleet([cached])[0].cruise, 500, 'An existing 600 m/s cache is migrated before route calculation');
assert.equal(comparisonFleet([{ ...fastHull, cruise: 600 }]).length, 0, 'A different real registry speed cannot silently become a 500 m/s hull');
assert.equal(identityShipCheck(spa, { ...fleet[3], techCompat: { [spa.id]: .1 } }).state, 'blocked',
  'Fleet selection never changes the reference hull’s ID or technical restrictions');
const otherHull = registry.find(ship => ship.nickname === 'zoner_exploration_fr');
assert.equal((await searchIdentities(market, gifuNav, available, [scope], { ...options, fleetOnly: true, shipId: otherHull.id, includeUnverified: true })).results.length, 0);
for (const mode of ['supply', 'export']) {
  const result = await searchIdentities(data, nav, available, [
    { identity: spa, accessReady: true, blocked: [], unverifiedDocks: [], approvalDocks: [] }
  ], { commodity: 'ablative', fleetOnly: true, mode, extraPercent: 20, returnCargo: false });
  assert.ok(result.stats.ships <= 4);
  assert.ok(result.results.every(route => fleet.some(ship => ship.id === route.ship.id)));
}
console.log('Import search passed: bounded multi-hull approaches, local alloy profit, seller/buyer disclosure, unverified/approval-only access, the four-profile fleet and migration of the corrected 500 m/s transport.');
