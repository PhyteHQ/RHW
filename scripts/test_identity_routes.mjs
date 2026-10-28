import assert from 'node:assert/strict';
import { BMM_ID, dockingAccess } from '../js/supply/access.mjs';
import { normalizeShipRegistry } from '../js/supply/ship-profiles.mjs';
import { parseIdentityRules, identityRegistry, identityShipCheck, autoIdentityShips } from '../js/supply/identity-profiles.mjs';
import { searchIdentities } from '../js/supply/identity-planner.mjs';

const JUNKERS = 'dsy_license_fc_j_grp';
const card = lines => ({ infocard: lines.map(phrase => ({ phrases: [{ phrase }] })) });
const bmmCard = card(['Permitted ships: Fighters, Freighters, Transports, Gunboats']);
const junkerCard = card(['Permitted ships: Fighters, Freighters, Transports, Gunboats', 'Cannot use any Transports with more than 4,300 cargo.']);
const tractors = [{ nickname: BMM_ID, name: 'BMM ID', rephacks: [
  { faction_nickname: 'br_n_grp', reputation: .3, rep_type: 1 }, { faction_nickname: 'fc_m_grp', reputation: -.7, rep_type: 0 }] },
{ nickname: JUNKERS, name: 'Junkers ID', rephacks: {
  navy: { faction_nickname: 'br_n_grp', reputation: .1, rep_type: 1 }, molly: { faction_nickname: 'fc_m_grp', reputation: .3, rep_type: 1 } } }];
const identities = identityRegistry(tractors, { [BMM_ID]: bmmCard, [JUNKERS]: junkerCard }, Date.now());
const [bmm, junkers] = identities;
assert.equal(junkers.rules.transportLimit, 4300);
assert.equal(junkers.rules.state, 'known');
assert.equal(parseIdentityRules(null).state, 'unknown');
assert.equal(parseIdentityRules(card(['Allowed ships: Freighters, Transports'])).state, 'known');
assert.equal(parseIdentityRules(card(['Permitted ships:', 'Freighters, Transports'])).state, 'known');
assert.equal(parseIdentityRules(card(['Allowed ships: Freighters, Transports up to 4,300 cargo'])).state, 'conditional', 'Unparsed restrictions in the ship list cannot become unrestricted permission');
assert.equal(parseIdentityRules(card(['Permitted ships: Freighters, Transports. Cannot use any Transports with more than 4,300 cargo.'])).transportLimit, 4300);
const regional = parseIdentityRules(card(['Permitted ships: Freighters, Transports', 'Cannot dock Transports with more than 3,600 cargo on any base within House Sovereign Space.']));
assert.equal(regional.state, 'conditional');
assert.equal(regional.transportLimit, null, 'A regional docking condition is not a global hull limit');
assert.equal(parseIdentityRules(card(['Permitted ships: Transports', 'Cannot use any Transports with more than 4,300 cargo, except for a special train.'])).state, 'conditional');

const tech_compat = { techchompat_by_id: { [BMM_ID]: 1, [JUNKERS]: 1 } };
const ships = normalizeShipRegistry([
  { nickname: 'dsy_advanced_train', name: 'Advanced Train', class: 9, type: 'freighter', hold_size: 5000, cruise_speed: 350, dock_type: 2, tech_compat, ship_packages: [{ nickname: 'fixture_package' }] },
  { nickname: 'small_transport', name: 'Small Transport', class: 6, type: 'freighter', hold_size: 3600, cruise_speed: 500, dock_type: 2, tech_compat, ship_packages: [{ nickname: 'fixture_package' }] },
  { nickname: 'pilgrim_liner', name: 'Pilgrim Liner', class: 10, type: 'freighter', hold_size: 4300, cruise_speed: 415, dock_type: 3, tech_compat, ship_packages: [{ nickname: 'fixture_package' }] }
]);
const train = ships.find(ship => ship.nickname === 'dsy_advanced_train');
const small = ships.find(ship => ship.nickname === 'small_transport');
assert.equal(train.volumeClass, 9);
assert.equal(identityShipCheck(junkers, train).state, 'blocked', 'A 5k hull is illegal under the test 4.3k limit even when partially loaded');
assert.equal(identityShipCheck(junkers, small).state, 'checked');
assert.equal(identityShipCheck(bmm, train).state, 'checked');
assert.ok(!autoIdentityShips(ships, junkers).some(ship => ship.id === train.id));
assert.equal(identityShipCheck({ ...junkers, rules: parseIdentityRules(null) }, small).state, 'conditional');
assert.equal(identityShipCheck(junkers, { ...small, techCompat: { [JUNKERS]: .75 } }).state, 'conditional', 'A technical penalty is not a legal ship-class ban');
assert.equal(identityShipCheck(junkers, { ...small, techCompat: {} }).state, 'conditional');
assert.equal(identityShipCheck(junkers, { ...small, playerShip: null }).state, 'conditional');
assert.equal(identityShipCheck(junkers, { ...small, playerShip: false }).state, 'blocked');
assert.equal(identityShipCheck(junkers, { ...train, shipClass: null, type: 'freighter' }).state, 'conditional', 'Generic FREIGHTER engine type cannot bypass missing RP ship-class data');
assert.equal(identityShipCheck(junkers, { ...train, shipClass: 99, type: 'freighter' }).state, 'conditional');
const combatCondition = parseIdentityRules(card(['Permitted ships: Freighters, Transports, Cruisers', 'Cannot dock Cruisers within House space.']));
assert.equal(identityShipCheck({ ...junkers, rules: combatCondition }, small).state, 'checked', 'A cruiser-only condition must not invalidate a checked transport');
const alternateSpelling = normalizeShipRegistry([{ nickname: 'legacy_transport', name: 'Legacy Transport', class: 6, type: 'freighter', hold_size: 2000, cruise_speed: 350, dock_type: 2,
  ship_packages: [{ nickname: 'package' }], tech_compat: { techcompat_by_id: { [JUNKERS]: 1 } } }]);
assert.equal(identityShipCheck(junkers, alternateSpelling[0]).state, 'checked');

const gold = { id: 'wcg', name: 'Wildcat Gold', volume: 1, originalVolume: 1, buy: 100, sell: 150 };
const rhw = { id: 'rhw', name: 'Resolution Heavy Works', kind: 'pob', system: 'br01', systemName: 'New London', pos: [0, 0, 0], cash: 1e8, space: 1e6,
  offers: [{ ...gold, stock: 0, min: 0, max: 100000 }] };
const trafalgar = { id: 'trafalgar', name: 'Trafalgar', kind: 'npc', system: 'br01', systemName: 'New London', pos: [600000, 0, 0], offers: [{ ...gold }] };
const molly = { id: 'molly', name: 'Dublin Molly Test Base', kind: 'npc', system: 'br05', systemName: 'Dublin', pos: [100000, 0, 0], offers: [{ ...gold, buy: 50 }] };
const bases = [rhw, trafalgar, molly], owners = [{ nickname: 'trafalgar', faction_nickname: 'br_n_grp' }, { nickname: 'molly', faction_nickname: 'fc_m_grp' }];
const bmmAccess = dockingAccess(bases, owners, [], tractors);
const junkerAccess = dockingAccess(bases, owners, [], tractors, JUNKERS);
assert.deepEqual(bmmAccess.blocked, ['molly']);
assert.deepEqual(junkerAccess.blocked, []);
assert.equal(junkerAccess.byId.molly.state, 'possible');
const whitelist = dockingAccess([rhw], [], [], tractors, JUNKERS, [{ nickname: 'rhw', defense_mode: 2 }]);
assert.equal(whitelist.byId.rhw.state, 'unknown');
assert.match(whitelist.byId.rhw.reason, /whitelist/);
const cappedNeutral = [{ ...tractors[0], rephacks: [{ faction_nickname: 'fc_m_grp', reputation: .3, rep_type: 0 }] }];
assert.equal(dockingAccess([molly], owners, [], cappedNeutral).byId.molly.state, 'unknown', 'A neutral maximum cannot guarantee the pilot’s actual reputation');
const floorHostile = [{ ...tractors[0], rephacks: [{ faction_nickname: 'fc_m_grp', reputation: -.7, rep_type: 1 }] }];
assert.equal(dockingAccess([molly], owners, [], floorHostile).byId.molly.state, 'unknown');

const navigation = { schema: 1, nodes: bases.map(base => ({ id: base.id, system: base.system, pos: base.pos, kind: 'base', allows: ['medium'] })),
  baseNodes: Object.fromEntries(bases.map(base => [base.id, base.id])), links: [
    ...['trafalgar', 'molly'].flatMap(id => [{ from: 'rhw', to: id, kind: 'lane', speed: 2500 }, { from: id, to: 'rhw', kind: 'lane', speed: 2500 }])
  ] };
const data = { schema: 1, asOf: new Date().toISOString(), bases };
const scopes = [{ identity: bmm, blocked: bmmAccess.blocked, accessReady: bmmAccess.ready }, { identity: junkers, blocked: junkerAccess.blocked, accessReady: junkerAccess.ready }];
const compared = await searchIdentities(data, navigation, ships, scopes, { commodity: 'Wildcat Gold', extraPercent: 20, shipId: 'auto' });
assert.equal(compared.results[0].identity.id, JUNKERS);
assert.equal(compared.results[0].ship.id, small.id, 'The nearby base needs the smaller permitted and physically dockable hauler');
assert.equal(compared.results[0].legs.at(-1).from, molly.name);
assert.equal(compared.results[0].delivered, 3600);
assert.ok(compared.results[0].recommendation);
assert.equal(compared.stats.identities, 2);
assert.deepEqual(compared.results[0].compatibleIdentities.map(row => row.identity.id), [JUNKERS]);
assert.ok(compared.results.filter(row => row.identity.id === BMM_ID).every(row => !row.stops.includes('molly')));
assert.ok(compared.results.every(row => row.identity.id === BMM_ID || row.ship.id !== train.id));
assert.ok(compared.results.every(row => row.legs.every(leg => leg.flight)), 'Every leg, including return travel, is checked for the same ship');
const forbidden = await searchIdentities(data, navigation, ships, [scopes[1]], { commodity: 'Wildcat Gold', shipId: train.id });
assert.equal(forbidden.results.length, 0);
assert.match(forbidden.reason, /Hull exceeds/);
const unverified = await searchIdentities(data, navigation, ships, [{ identity: { ...junkers, rules: parseIdentityRules(null) }, blocked: [] }],
  { commodity: 'Wildcat Gold', shipId: small.id });
assert.ok(unverified.results.length);
assert.ok(unverified.results.every(row => row.recommendation === null && row.shipCheck.state === 'conditional'));
const missingAccess = await searchIdentities(data, navigation, ships, [{ identity: junkers, blocked: [], accessReady: false }], { commodity: 'Wildcat Gold', shipId: small.id });
assert.ok(missingAccess.results.every(row => row.recommendation === null && /docking rules/.test(row.shipCheck.reason)));
const exportData = structuredClone(data);
const exportedGold = { id: 'gold', name: 'Gold', buy: 100, sell: 1, volume: 1, originalVolume: 1, stock: 1000, min: 0, max: 10000 };
exportData.bases[0].offers.push(exportedGold);
exportData.bases[1].offers.push({ ...exportedGold, sell: 150 });
exportData.bases[2].offers.push({ ...exportedGold, sell: 200 });
const exported = await searchIdentities(exportData, navigation, ships, scopes, { mode: 'export', commodity: 'Gold', extraPercent: 20, shipId: 'auto' });
assert.equal(exported.results[0].identity.id, JUNKERS);
assert.equal(exported.results[0].buyer.id, 'molly');
assert.equal(exported.results[0].returnTrade.good, 'wcg', 'Import-only Wildcat Gold remains valid as inbound return cargo');
assert.ok(exported.results.filter(row => row.identity.id === BMM_ID).every(row => !row.stops.includes('molly')));
assert.ok(exported.results.filter(row => row.identity.id === JUNKERS).every(row => row.ship.id !== train.id));
const pobData = structuredClone(data); pobData.bases[2].kind = 'pob'; pobData.bases[2].cash = 1e8; pobData.bases[2].space = 1e6;
pobData.bases[2].offers[0] = { ...pobData.bases[2].offers[0], stock: 20000, min: 1000, max: 100000 };
const pobMetadata = [{ nickname: 'molly', faction_nickname: 'fc_m_grp', defense_mode: 1 }];
const pobScopes = identities.map(identity => {
  const access = dockingAccess(pobData.bases, owners, [], tractors, identity.id, pobMetadata);
  return { identity, blocked: access.blocked, accessReady: access.ready, approvalDocks: access.approvalDocks };
});
assert.ok(pobScopes[0].approvalDocks.includes('molly'));
assert.ok(!pobScopes[1].approvalDocks.includes('molly'));
const pobCompared = await searchIdentities(pobData, navigation, ships, pobScopes, { commodity: 'Wildcat Gold', extraPercent: 20, shipId: 'auto' });
assert.equal(pobCompared.results[0].identity.id, JUNKERS);
assert.equal(pobCompared.results[0].legs.at(-1).from, molly.name);
assert.ok(pobCompared.results.filter(row => row.identity.id === BMM_ID).every(row => !row.stops.includes('molly')), 'Hostile POB IFF is excluded unless owner-approval quotes are explicitly requested');
const approvalQuote = await searchIdentities(pobData, navigation, ships, [pobScopes[0]], { commodity: 'Wildcat Gold', shipId: train.id, includeRestrictedPobs: true });
assert.ok(approvalQuote.results.some(row => row.stops.includes('molly') && row.recommendation === null && /owner approval/.test(row.shipCheck.reason)));

// Search all IDs automatically and merge equivalent routes; a profile beyond
// the former six-ID comparison must be eligible for the winning source.
const EXTRA = 'fixture_eighth_id';
const extraIdentity = { ...junkers, id: EXTRA, name: 'Eighth Trader ID' };
const expandedShips = ships.map(ship => ({ ...ship, techCompat: { ...ship.techCompat, [EXTRA]: 1 } }));
const manyScopes = [scopes[0], ...Array.from({ length: 6 }, (_, i) => ({ ...scopes[0], identity: { ...bmm, id: 'unused_' + i } })),
  { ...scopes[1], identity: extraIdentity }];
const allIds = await searchIdentities(data, navigation, expandedShips, manyScopes, { commodity: 'Wildcat Gold', shipId: 'auto' });
assert.equal(allIds.stats.identities, 8);
assert.equal(allIds.results[0].identity.id, EXTRA);
const duplicated = await searchIdentities(data, navigation, expandedShips, [...scopes, manyScopes.at(-1)], { commodity: 'Wildcat Gold', shipId: 'auto' });
assert.equal(duplicated.stats.checked, compared.stats.checked, 'Another compatible ID must not repeat the navigation and market search');
assert.deepEqual(duplicated.results[0].compatibleIdentities.filter(row => row.shipCheck.state === 'checked').map(row => row.identity.id).sort(), [JUNKERS, EXTRA].sort());
assert.equal(new Set(duplicated.results.map(route => JSON.stringify([route.ship.id, route.stops, route.quantities]))).size, duplicated.results.length);
const pinned = await searchIdentities(data, navigation, expandedShips, [...scopes, manyScopes.at(-1)], { commodity: 'Wildcat Gold', shipId: 'auto', identityId: BMM_ID });
assert.ok(pinned.results.length);
assert.ok(pinned.results.every(route => !route.stops.includes('molly') && route.identity.id === BMM_ID));

// An ID that can dock at the export buyer cannot borrow another ID's access
// to a lucrative return source. A third ID valid at both may use that tour.
const split = structuredClone(exportData);
split.bases[1].offers[0].buy = 1;
split.bases[2].offers[0].buy = 149;
split.bases[1].offers.find(offer => offer.id === 'gold').sell = 1;
split.bases[1].pos = [8000, 0, 0]; split.bases[2].pos = [8000, 0, 0];
const splitNav = structuredClone(navigation);
splitNav.nodes.find(node => node.id === 'trafalgar').pos = [8000, 0, 0];
splitNav.nodes.find(node => node.id === 'molly').pos = [8000, 0, 0];
const splitScopes = [{ ...scopes[0], blocked: ['molly'] }, { ...scopes[1], blocked: ['trafalgar'] }];
const completeScope = { identity: extraIdentity, accessReady: true, blocked: [] };
const combined = await searchIdentities(split, splitNav, expandedShips, [...splitScopes, completeScope], { mode: 'export', commodity: 'Gold', shipId: small.id, extraPercent: 50 });
assert.ok(combined.results.some(route => route.buyer.id === 'molly' && route.returnTrade?.source === 'trafalgar'), 'The mixed-access tour is economically attractive and physically reachable when one ID permits every stop');
const splitExport = await searchIdentities(split, splitNav, ships, splitScopes, { mode: 'export', commodity: 'Gold', shipId: small.id, extraPercent: 50 });
assert.ok(splitExport.results.every(route => !route.stops.includes('molly') || !route.stops.includes('trafalgar')));
assert.ok(splitExport.results.every(route => route.compatibleIdentities.every(row => {
  const scope = splitScopes.find(item => item.identity.id === row.identity.id);
  return route.stops.every(id => !scope.blocked.includes(id));
})));
console.log('Identity routes passed: full-registry route search, shared compatible-ID badges, fixed-ID filter, whole-hull limits, technical penalties, per-ID docking, POB approvals and no mixing IDs across return stops.');
