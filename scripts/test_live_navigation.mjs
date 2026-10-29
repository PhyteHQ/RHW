import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { currentNavigation, KNOWN_JUMP_CLOSURES } from '../js/supply/live-navigation.mjs';
import { ShipNavigator } from '../js/supply/navigation.mjs';
import { normalizeDarkstat } from '../js/supply/core/trade.mjs';
import { searchSupply } from '../js/supply/planner.mjs';
import { searchExports } from '../js/supply/export-planner.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/live-navigation-2026-10-29.json', import.meta.url)));
const time = fixture.capturedAt;
const node = (id, system, pos, kind = 'jump', extra = {}) => ({ id, system, pos: [pos, 0, 0], kind, ...extra });
const jump = (Nickname, GotoSystem, pos, Kind = 4) => ({ Nickname, GotoSystem, Pos: { X: pos, Y: 0, Z: 0 }, Kind });
const base = { schema: 1, builtAt: '2026-10-15T00:00:00Z', nodes: [
  node('iw06:iw06_to_ku02', 'iw06', 0), node('ku02:ku02_to_iw06', 'ku02', 0),
  node('iw06:alt', 'iw06', 35000), node('ku02:alt', 'ku02', 35000),
  node('iw05:from_iw06', 'iw05', 0), node('iw05:from_ku02', 'iw05', 35000),
  node('iw06:lane_a', 'iw06', 0, 'lane'), node('iw06:lane_b', 'iw06', 35000, 'lane')
], links: [
  ['iw06:iw06_to_ku02', 'ku02:ku02_to_iw06'], ['iw06:alt', 'iw05:from_iw06'], ['iw05:from_ku02', 'ku02:alt']
].flatMap(([from, to]) => [{ from, to, kind: 'jump' }, { from: to, to: from, kind: 'jump' }]),
baseNodes: { home: 'iw06:iw06_to_ku02', supplier: 'ku02:ku02_to_iw06' } };
base.links.push({ from: 'iw06:lane_a', to: 'iw06:lane_b', kind: 'lane', speed: 2250 });
const feed = [
  { nickname: 'iw06', Jumpholes: [jump('iw06_to_ku02', 'ku02', 0), jump('alt', 'iw05', 35000)],
    Objs: ['lane_a', 'lane_b'].map((Nickname, i) => ({ Nickname, Kind: 2, Pos: { X: i * 35000, Y: 0, Z: 0 } })) },
  { nickname: 'ku02', Jumpholes: [jump('ku02_to_iw06', 'iw06', 0), jump('alt', 'iw05', 35000)], Objs: [] },
  { nickname: 'iw05', Jumpholes: [jump('from_iw06', 'iw06', 0), jump('from_ku02', 'ku02', 35000)], Objs: [] }
];
const profile = { id: 'train', cargo: 5000, cruise: 350, dock: 'medium', tradeLanes: true, cruiseCharge: 5 };
const original = structuredClone(base);
const live = currentNavigation(base, feed, time);
assert.deepEqual(base, original, 'Refreshing cannot mutate the reusable geometry or previous quote');
assert.ok(!live.links.some(edge => edge.kind === 'jump' && edge.from === KNOWN_JUMP_CLOSURES[0].from && edge.to === KNOWN_JUMP_CLOSURES[0].to));
assert.ok(!live.links.some(edge => edge.kind === 'jump' && edge.to === KNOWN_JUMP_CLOSURES[0].from && edge.from === KNOWN_JUMP_CLOSURES[0].to));
const route = new ShipNavigator(live, [], profile).route('home', 'supplier', true);
assert.equal(route.jumps, 2, 'A server closure overrides the feed’s ordinary gate and forces the alternative');
assert.ok(route.path.some(step => step.toSystem === 'iw05'));
assert.equal(live.live.receivedAt, time);
assert.equal(live.live.geometryBuiltAt, base.builtAt);
assert.equal(live.links.find(edge => edge.kind === 'lane').speed, 2500);
const open = currentNavigation(base, feed, time, []);
assert.equal(new ShipNavigator(open, [], profile).route('home', 'supplier').jumps, 1,
  'Each refresh starts from original geometry so a confirmed reopening can restore a connection');
for (const Kind of [0, 6, 99, null]) {
  const closed = structuredClone(feed); closed[0].Jumpholes[0].Kind = Kind;
  assert.ok(!currentNavigation(base, closed, time, []).links.some(edge => edge.from === 'iw06:iw06_to_ku02' || edge.to === 'iw06:iw06_to_ku02'),
    'Unknown or campaign-locked gate metadata cannot retain an old connection');
}
const missing = structuredClone(feed); missing[0].Jumpholes.shift();
assert.ok(!currentNavigation(base, missing, time, []).nodes.some(node => node.id === 'iw06:iw06_to_ku02'));
const wrongDestination = structuredClone(feed); wrongDestination[0].Jumpholes[0].GotoSystem = 'iw05';
const redirected = currentNavigation(base, wrongDestination, time, []);
assert.ok(!redirected.links.some(edge => edge.from === 'iw06:iw06_to_ku02' && edge.to === 'ku02:ku02_to_iw06'));
assert.ok(redirected.links.some(edge => edge.from === 'ku02:ku02_to_iw06' && edge.to === 'iw06:iw06_to_ku02'), 'Directed links stay directed');
const moved = structuredClone(feed); moved[0].Jumpholes[0].Pos.X = 70000; moved[0].Objs.pop();
const updated = currentNavigation(base, moved, time, []);
assert.equal(updated.nodes.find(node => node.id === 'iw06:iw06_to_ku02').pos[0], 70000);
assert.ok(!updated.links.some(edge => edge.kind === 'lane'), 'A deleted lane ring removes its old lane connection');
const restricted = structuredClone(feed); restricted[0].Jumpholes[0].Kind = 2;
assert.deepEqual(currentNavigation(base, restricted, time, []).nodes.find(node => node.id === 'iw06:iw06_to_ku02').allows, ['berth']);
restricted[0].Jumpholes[0].Kind = 1;
assert.ok(!currentNavigation(base, restricted, time, []).nodes.some(node => node.id === 'iw06:iw06_to_ku02'), 'A newly limited gate without its exact capacity stays excluded');
const limitedBase = structuredClone(base); limitedBase.nodes[0].cargoLimit = 650;
assert.equal(currentNavigation(limitedBase, restricted, time, []).links.find(edge => edge.from === 'iw06:iw06_to_ku02').cargoLimit, 650);
assert.throws(() => currentNavigation(base, [], time));
assert.throws(() => currentNavigation(base, [{ nickname: 'iw06' }], time));
assert.throws(() => currentNavigation(base, feed.concat(feed[0]), time));

// Repeated rendering entries are not a global map failure. Only routing facts
// determine equivalence, including vector/object coordinate representations.
const repeated = structuredClone(feed);
repeated[0].Jumpholes.push({ ...repeated[0].Jumpholes[0], Name: 'Different rendering label', Pos: [0, 0, 0] });
repeated[0].Objs.push({ ...repeated[0].Objs[0], ShapeName: 'another_rendering_shape' });
const deduplicated = currentNavigation(base, repeated, time);
assert.deepEqual(deduplicated.nodes, live.nodes);
assert.deepEqual(deduplicated.links, live.links);
assert.equal(deduplicated.live.duplicateObjects, 2);
assert.equal(deduplicated.live.ambiguousObjects, 0);
assert.equal(new ShipNavigator(deduplicated, [], profile).route('home', 'supplier').jumps, 2);
for (const change of [{ Kind: 6 }, { GotoSystem: 'iw05' }, { Pos: [1, 0, 0] }]) {
  const conflicting = structuredClone(feed), first = conflicting[0].Jumpholes[0];
  conflicting[0].Jumpholes.push({ ...first, ...change }, { ...first });
  const scoped = currentNavigation(base, conflicting, time, []);
  assert.equal(scoped.live.ambiguousObjects, 1);
  assert.ok(!scoped.nodes.some(node => node.id === 'iw06:iw06_to_ku02'), 'A conflicting gate cannot be restored by the last duplicate');
  assert.ok(!scoped.links.some(edge => edge.from === 'iw06:iw06_to_ku02' || edge.to === 'iw06:iw06_to_ku02'));
  const elsewhere = { ...scoped, baseNodes: { otherHome: 'iw06:alt', otherSupplier: 'ku02:alt' } };
  assert.equal(new ShipNavigator(elsewhere, [], profile).route('otherHome', 'otherSupplier').jumps, 2,
    'An ambiguous object cannot block unrelated viable routes');
}
const badLane = structuredClone(feed), lane = badLane[0].Objs[0];
badLane[0].Objs.push({ ...lane, Kind: 10 }, { ...lane });
const noLane = currentNavigation(base, badLane, time);
assert.ok(!noLane.nodes.some(node => node.id === 'iw06:lane_a'));
assert.ok(!noLane.links.some(edge => edge.kind === 'lane'));
assert.ok(new ShipNavigator(noLane, [], profile).route('home', 'supplier'));

// Real current response: the API still advertises the destroyed gate. Its
// explicit server-closure policy must win over this freshly received data.
const map = JSON.parse(gunzipSync(await readFile(new URL('../assets/navigation.json.gz', import.meta.url))));
const captured = currentNavigation(map, fixture.systems, time);
assert.ok(!captured.links.some(edge => [
  'iw06:iw06_to_ku02|ku02:ku02_to_iw06', 'ku02:ku02_to_iw06|iw06:iw06_to_ku02'
].includes(edge.from + '|' + edge.to)));
assert.equal(fixture.systems.find(system => system.nickname === 'iw06').Jumpholes[0].Kind, 4);
const gifu = normalizeDarkstat([fixture.gifu], [], time).bases[0].offers[0];
assert.equal(gifu.stock, 669);
assert.equal(gifu.stock - gifu.min, 369, 'The new total stock is not confused with units available above the reserve');

// Complete routing projection of the real 146-system response that reproduced
// the production failure. Keep all 25k objects, including the identical planet
// ring in br07 that is unrelated to the requested RHW route.
const complete = JSON.parse(gunzipSync(await readFile(new URL('./fixtures/live-navigation-complete-2026-10-29.json.gz', import.meta.url))));
const completeMap = currentNavigation(map, complete.systems, complete.capturedAt);
assert.equal(completeMap.live.systems, 146);
assert.equal(completeMap.live.duplicateObjects, 1);
assert.equal(completeMap.live.ambiguousObjects, 0);
assert.ok(completeMap.nodes.length > 2000 && completeMap.links.length > 2000);
const realDuplicate = complete.systems.find(system => system.nickname === 'br07').Objs.filter(object => object.Nickname === 'br07_planet_5_ring_1');
assert.equal(realDuplicate.length, 2);
assert.deepEqual(realDuplicate[0], realDuplicate[1]);

// Synthetic trades on this complete real map must reach both planners. These
// prices and quantities are controlled test data, not current game offers.
const item = { id: 'map_fixture', name: 'Map Fixture', buy: 100, sell: 150, volume: 1, originalVolume: 1, volumes: {} };
const markets = { schema: 1, asOf: time, bases: [
  { id: 'map_home', name: 'Resolution Heavy Works', kind: 'pob', system: 'br01', pos: [-56474, 0, 53702], cash: 1e8, space: 1e6,
    offers: [{ ...item, stock: 6000, min: 0, max: 20000 }] },
  { id: 'map_source', name: 'New Tokyo Route Fixture', kind: 'npc', system: 'ku01', pos: [38824, 105, -7336], offers: [{ ...item, sell: 200 }] }
] };
for (const result of [await searchSupply(markets, completeMap, [profile], { commodity: item.id, extraPercent: 0 }),
  await searchExports(markets, completeMap, [profile], { commodity: item.id, returnCargo: false })]) {
  assert.ok(result.results.length, 'The full current response must calculate import and export results');
  assert.equal(result.results[0].delivered, 5000);
  for (const route of result.results) for (const leg of route.legs) for (const step of leg.flight.path)
    assert.ok(!KNOWN_JUMP_CLOSURES.some(closure => step.from === closure.from && step.to === closure.to
      || closure.bidirectional && step.from === closure.to && step.to === closure.from));
}
console.log('Live map passed: complete 146-system response, identical and conflicting duplicates, local exclusion, import/export calculation, current positions, gate/lane restrictions, server closure and Gifu reserve arithmetic.');
