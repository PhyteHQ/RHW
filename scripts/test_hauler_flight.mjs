import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { normalizeShipRegistry, shipFlightRules } from '../js/supply/ship-profiles.mjs';
import { ShipNavigator, flightKey } from '../js/supply/navigation.mjs';
import { identityRegistry } from '../js/supply/identity-profiles.mjs';
import { searchIdentities } from '../js/supply/identity-planner.mjs';
import { rankSupplyRoutes, searchSupply } from '../js/supply/planner.mjs';
import { searchExports } from '../js/supply/export-planner.mjs';
import { BMM_ID } from '../js/supply/access.mjs';

const captured = JSON.parse(await readFile(new URL('./fixtures/hauler-flight-2026-10-28.json', import.meta.url)));
const idsFixture = JSON.parse(await readFile(new URL('./fixtures/player-id-routes-2026-10-28.json', import.meta.url)));
const ships = normalizeShipRegistry(captured.ships);
const train = ships.find(ship => ship.nickname === 'dsy_advanced_train');
const barge = ships.find(ship => ship.nickname === 'dsy_cargobarge_1');
const pilgrim = ships.find(ship => ship.nickname === 'pilgrim_liner');
const vector = ships.find(ship => ship.nickname === 'zoner_exploration_fr');
for (const [nickname, fields] of Object.entries(captured.patchFlightRules)) {
  const ship = ships.find(ship => ship.nickname === nickname);
  assert.equal(ship.tradeLanes, fields.can_use_tradelanes);
  if (fields.cruise_charge_time != null) assert.equal(ship.cruiseCharge, fields.cruise_charge_time);
}
assert.equal(barge.cruise, 90);
assert.equal(shipFlightRules({ nickname: barge.nickname }).tradeLanes, false, 'Pre-update cached profiles also receive the no-lane rule');
assert.equal(shipFlightRules({ nickname: barge.nickname }).cruiseCharge, 15);
assert.equal(shipFlightRules({ nickname: 'future_ship', can_use_tradelanes: false, cruise_charge_time: 9 }).cruiseCharge, 9);
assert.equal(shipFlightRules({ nickname: 'future_ship', can_use_tradelanes: false }).tradeLanes, false);

// Full-hold procurement with real hull stats. This controlled market is NOT a
// live quote: the supplier has stock and RHW can buy 16,231 units, as in the
// user's Barge screenshot. All three ordinary IDs may dock at either station.
const good = { id: 'niobium', name: 'Niobium', buy: 105, sell: 150, volume: 1, originalVolume: 1, volumes: {} };
const home = { id: 'rhw', name: 'Resolution Heavy Works', kind: 'pob', system: 'br01', pos: [0, 0, 0], cash: 1e8, space: 1e6,
  offers: [{ ...good, buy: 100, stock: 0, min: 0, max: 16231 }] };
const source = { id: 'source', name: 'Niobium Test Supplier', kind: 'npc', system: 'br01', pos: [300000, 0, 0], offers: [{ ...good, sell: 200 }] };
const data = { schema: 1, asOf: '2026-10-28T14:00:00Z', bases: [home, source] };
const nav = { schema: 1, nodes: data.bases.map(base => ({ id: base.id, system: base.system, pos: base.pos, kind: 'base', allows: ['medium', 'large', 'berth'] })),
  baseNodes: { rhw: 'rhw', source: 'source' }, links: [
    { from: 'rhw', to: 'source', kind: 'lane', speed: 2500 }, { from: 'source', to: 'rhw', kind: 'lane', speed: 2500 }] };
const identities = identityRegistry(idsFixture.tractors, idsFixture.cards).filter(id => [BMM_ID, 'dsy_license_fc_j_grp', 'dsy_license_co_os_grp'].includes(id.id));
const scopes = identities.map(identity => ({ identity, accessReady: true, blocked: [], approvalDocks: [], unverifiedDocks: [] }));
const trainFlight = new ShipNavigator(nav, data.bases, train).route('rhw', 'source', true);
const bargeFlight = new ShipNavigator(nav, data.bases, barge).route('rhw', 'source', true);
assert.ok(trainFlight.path.some(step => step.kind === 'lane'));
assert.ok(bargeFlight.path.every(step => step.kind !== 'lane'));
assert.equal(bargeFlight.seconds, 300000 / 90 + 15, 'No lane speed and no generic five-second charge for a Barge');
assert.notEqual(flightKey(nav, train), flightKey(nav, barge));
const limitedNav = { ...nav, links: nav.links.map(link => ({ ...link, cargoLimit: 4300 })) };
assert.notEqual(flightKey(limitedNav, { ...train, cargo: 4300 }), flightKey(limitedNav, train), 'Path caches cannot share a jump/cargo-limit eligibility boundary');
const found = await searchIdentities(data, nav, ships, scopes, { commodity: 'Niobium', extraPercent: 20 });
assert.equal(found.results[0].ship.id, train.id, 'The Barge and fast small freighter cannot push a 5k train out of automatic comparison');
assert.equal(found.results[0].delivered, 5000);
assert.ok(found.results.every(route => route.ship.id !== vector.id), 'Saving a little flight time does not justify losing most of the hourly delivery');
const junkers = await searchIdentities(data, nav, ships, scopes, { commodity: 'Niobium', identityId: 'dsy_license_fc_j_grp' });
assert.equal(junkers.results[0].ship.id, pilgrim.id, 'The 4.3k ID limit still excludes a 5k hull');
const largeOnly = structuredClone(nav); largeOnly.nodes[1].allows = ['large'];
const docked = await searchIdentities(data, largeOnly, ships, scopes, { commodity: 'Niobium' });
assert.equal(docked.results[0].ship.id, pilgrim.id, 'A large-only supplier can make the Pilgrim the correct hull');

const manualBarge = await searchSupply(data, nav, [barge], { commodity: 'Niobium', extraPercent: 0 });
assert.ok(manualBarge.results[0].seconds > 100 * 60);
assert.ok(manualBarge.results[0].legs.every(leg => leg.flight.path.every(step => step.kind !== 'lane')));
const exportData = structuredClone(data); exportData.bases[0].offers[0].stock = 16231;
const exported = await searchExports(exportData, nav, [barge], { commodity: 'Niobium', returnCargo: false });
assert.ok(exported.results[0].seconds > 100 * 60, 'Exports use the same no-lane flight constraints');
assert.ok(exported.results[0].legs.every(leg => leg.flight.path.every(step => step.kind !== 'lane')));

// Exact reported batch sizes/times. The Vector's 1m45s saving cannot buy an
// 83% drop in supply rate. For an explicitly small order it may be appropriate.
function quote(ship, seconds, delivered) {
  return { ship, seconds, delivered, unitsPerHour: delivered * 3600 / seconds, profit: delivered * 45,
    hourlyProfit: delivered * 45 * 3600 / seconds, extraStop: false,
    legs: [{ source: 'rhw', target: 'source', good: null }, { source: 'source', target: 'rhw', good: 'niobium', buy: 105, sell: 150 }], quantities: [0, delivered] };
}
const normal = quote(pilgrim, 20 * 60 + 15, 4300), tiny = quote(vector, 18 * 60 + 30, 650);
assert.ok(rankSupplyRoutes([normal, tiny], 20, 'price').every(route => route.ship.id !== vector.id));
const tinyLoss = { ...tiny, legs: tiny.legs.map(leg => leg.good ? { ...leg, buy: 173 } : leg) };
assert.ok(rankSupplyRoutes([normal, tinyLoss], 20).every(route => route.ship.id !== vector.id), 'A small loss-making batch is not an express supply improvement either');
assert.equal(rankSupplyRoutes([quote(pilgrim, normal.seconds, 650), tiny], 20, 'price')[0].ship.id, vector.id);

// The real bundled map and captured RHW location: Tau-31 is not a 24-minute
// round trip at 90 m/s. The exact time remains an estimate, not a flight log.
const map = JSON.parse(gunzipSync(await readFile(new URL('../assets/navigation.json.gz', import.meta.url))));
const rhw = idsFixture.pobs[0], pos = rhw.base_pos;
const actualHome = { id: rhw.nickname, name: rhw.name, system: rhw.system_nickname, pos: Array.isArray(pos) ? pos : [pos.X, pos.Y, pos.Z] };
const actualNavigator = new ShipNavigator(map, [actualHome], barge);
const outward = actualNavigator.route(rhw.nickname, 'li12_03_base', true);
const inbound = actualNavigator.route('li12_03_base', rhw.nickname, true);
assert.ok(outward && inbound);
assert.ok(outward.seconds + inbound.seconds + 90 > 90 * 60);
assert.ok([...outward.path, ...inbound.path].every(step => step.kind !== 'lane'));
console.log('Hauler flight passed: published Barge/Miner lane bans, Barge charge, cache boundaries, 5k selection, valid Pilgrim exceptions, comparable-rate alternatives and real Tau-31 geometry.');
