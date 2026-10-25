import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { searchSupply, quoteSupply, rankSupplyRoutes } from '../js/supply/planner.mjs';
import { makeLeg, normalizeDarkstat } from '../js/supply/core/trade.mjs';
import { validateNavigation } from '../js/supply/core/navigation.mjs';
import { dockingAccess, BMM_ID } from '../js/supply/access.mjs';

const ship = { id: 'train', name: '5k Train', cargo: 5000, cruise: 350, dock: 'medium', dockType: 2 };
const plating = { id: 'ablative', name: 'Ablative Armor Plating', buy: 100, sell: 150, volume: 2, originalVolume: 2, volumes: {} };
const alloy = { id: 'alloy', name: 'Super Alloy', buy: 10, sell: 50, volume: 1, originalVolume: 1, volumes: {} };
const rhw = { id: 'rhw', name: 'Resolution Heavy Works', kind: 'pob', system: 'br01', systemName: 'New London', pos: [0, 0, 0],
  cash: 1e8, space: 1e6, offers: [{ ...plating, stock: 0, min: 0, max: 20000 }] };
const waterloo = { id: 'waterloo', name: 'Waterloo Station', kind: 'npc', system: 'br01', systemName: 'New London', pos: [150000, 0, 0], offers: [{ ...alloy }] };
const oder = { id: 'oder', name: 'Oder Shipyard', kind: 'npc', system: 'br01', systemName: 'New London', pos: [300000, 0, 0], offers: [{ ...plating }, { ...alloy }] };
const bases = [rhw, waterloo, oder];
const dataset = { schema: 1, asOf: new Date().toISOString(), bases };
const nodes = bases.map(base => ({ id: base.id, name: base.name, system: base.system, pos: base.pos, kind: 'base', allows: ['medium', 'large', 'berth'] }));
const navigation = { schema: 1, nodes, baseNodes: Object.fromEntries(bases.map(base => [base.id, base.id])), links: [
  { from: 'rhw', to: 'waterloo', kind: 'lane', speed: 2500 }, { from: 'waterloo', to: 'rhw', kind: 'lane', speed: 2500 },
  { from: 'waterloo', to: 'oder', kind: 'lane', speed: 2500 }, { from: 'oder', to: 'waterloo', kind: 'lane', speed: 2500 }
] };
const target = makeLeg(oder, rhw, 'ablative', ship);
const quote = quoteSupply([{ source: 'rhw', target: 'oder', good: null }, target], bases, ship);
assert.equal(quote.delivered, 2500, 'A 5k hold carries 2,500 units at two volume each');
assert.equal(quote.profit, 125000);
assert.equal(quote.capitalNeeded, 250000);
assert.equal(quote.rhwPayout, 375000);
assert.equal(quote.delivery.cost, 250000);
assert.equal(quote.delivery.margin, 125000);
assert.equal(quote.delivery.loss, 0);
const limited = structuredClone(rhw); limited.cash = 1500;
assert.equal(quoteSupply([{ source: 'rhw', target: 'oder', good: null }, target], [limited, oder], ship).delivered, 10, 'RHW cash limits delivery');
limited.cash = 1e8; limited.space = 10;
assert.equal(quoteSupply([{ source: 'rhw', target: 'oder', good: null }, target], [limited, oder], ship).delivered, 5, 'POB space uses original volume');
limited.space = 1e6; limited.offers[0].max = 7;
assert.equal(quoteSupply([{ source: 'rhw', target: 'oder', good: null }, target], [limited, oder], ship).delivered, 7, 'RHW purchase cap limits delivery');
assert.equal(quoteSupply([{ source: 'rhw', target: 'oder', good: null }, target], bases, ship, { capital: 100 }).delivered, 1);
assert.equal(quoteSupply([{ source: 'rhw', target: 'oder', good: null }, target], bases, ship, { capital: 0 }), null);
const loss = structuredClone(rhw); loss.offers[0].sell = 1;
const lossLeg = makeLeg(oder, loss, 'ablative', ship);
assert.ok(quoteSupply([{ source: 'rhw', target: 'oder', good: null }, lossLeg], [loss, oder], ship).profit < 0, 'Essential supply remains possible at a hauling loss');
const pobSeller = { ...structuredClone(oder), kind: 'pob', cash: 1000, space: 10000 };
pobSeller.offers = [{ ...plating, stock: 100, min: 90, max: 1000 }];
const pobLeg = makeLeg(pobSeller, rhw, 'ablative', ship);
assert.equal(quoteSupply([{ source: 'rhw', target: 'oder', good: null }, pobLeg], [rhw, pobSeller], ship).delivered, 10, 'POB reserves are protected');
pobSeller.offers[0].max = null;
assert.equal(makeLeg(pobSeller, rhw, 'ablative', ship), null, 'Unknown POB limits cannot be assumed');

const found = await searchSupply(dataset, navigation, [ship], { commodity: 'Ablative Armor Platings', extraPercent: 20 });
assert.equal(found.results[0].delivered, 2500);
assert.ok(found.results.length <= 3);
const circuit = found.results.find(route => route.extraStop);
const fast = found.results.find(route => !route.extraStop);
assert.ok(circuit, 'The Waterloo → Oder Super Alloy backhaul should be found');
assert.equal(found.results[0], circuit, 'The worthwhile backhaul is recommended first within the supply window');
assert.match(circuit.label, /^RECOMMENDED/);
assert.equal(fast.label, 'FAST SUPPLY', 'Keep the faster supply option visible');
assert.deepEqual(circuit.stops, ['rhw', 'waterloo', 'oder', 'rhw']);
assert.equal(circuit.legs[0].good, null, 'RHW → Waterloo is an honest empty approach');
assert.equal(circuit.legs[1].good, 'alloy');
assert.equal(circuit.legs.at(-1).good, 'ablative');
assert.equal(circuit.delivered, fast.delivered, 'Side trade must not displace target material');
assert.ok(circuit.profit > fast.profit);
assert.ok(circuit.seconds <= fast.seconds * 1.2);
const directOnly = await searchSupply(dataset, navigation, [ship], { commodity: 'ablative', extraPercent: 0 });
assert.ok(directOnly.results.every(route => !route.extraStop));
const small = { ...ship, id: 'small', name: 'Fast small hauler', cargo: 1000, cruise: 500 };
const compared = await searchSupply(dataset, navigation, [small, ship], { commodity: 'ablative', extraPercent: 20 });
assert.equal(compared.results[0].ship.id, 'train', 'On lanes the 5k hold wins supply throughput');
const inaccessible = structuredClone(navigation); inaccessible.nodes.find(node => node.id === 'oder').allows = ['berth'];
assert.equal((await searchSupply(dataset, inaccessible, [ship], { commodity: 'ablative', extraPercent: 20 })).results.length, 0);
const blocked = await searchSupply(dataset, navigation, [ship], { commodity: 'ablative', blocked: ['oder'] });
assert.equal(blocked.results.length, 0, 'Known docking denial excludes the supplier');

// The user's screenshot: 5,000 Ablatives in both runs, roughly 73 seconds more
// for $221,023 extra profit and $387,996 more per hour. This must rank first.
const screenshotFast = { ship, extraStop: false, seconds: 1745, delivered: 5000,
  unitsPerHour: 10318, profit: 593977, hourlyProfit: 1225696, capitalNeeded: 993800,
  legs: [{ source: 'rhw', target: 'kaiserslautern', good: 'niobium' }, { source: 'kaiserslautern', target: 'rhw', good: 'ablative', buy: 39, sell: 125 }], quantities: [4969, 5000] };
const screenshotTrade = { ship, extraStop: true, seconds: 1818, delivered: 5000,
  unitsPerHour: 9900, profit: 815000, hourlyProfit: 1613692, capitalNeeded: 270000,
  legs: [{ source: 'rhw', target: 'waterloo', good: null }, { source: 'waterloo', target: 'oder', good: 'alloy' }, { source: 'oder', target: 'rhw', good: 'ablative', buy: 39, sell: 125 }], quantities: [0, 5000, 5000] };
const ranked = rankSupplyRoutes([screenshotFast, screenshotTrade], 20);
assert.equal(ranked[0].profit, 815000);
assert.equal(ranked[0].recommendation.kind, 'profit-within-limit');
assert.equal(ranked[0].recommendation.profitDelta, 221023);
assert.equal(ranked[0].recommendation.hourlyProfitDelta, 387996);
assert.equal(ranked[1].profit, 593977);
assert.equal(rankSupplyRoutes([screenshotFast, { ...screenshotTrade, seconds: 2200 }], 20)[0].profit, 593977, 'A lucrative route outside the time limit cannot win');
assert.equal(rankSupplyRoutes([screenshotFast, { ...screenshotTrade, delivered: 1000, unitsPerHour: 1980 }], 20)[0].profit, 593977, 'High profit cannot replace the required supply throughput');
assert.equal(rankSupplyRoutes([screenshotFast, screenshotTrade], 0).length, 1, 'Direct-only excludes trading detours');
assert.equal(rankSupplyRoutes([screenshotFast, { ...screenshotTrade, profit: 600000, hourlyProfit: 1188119 }], 20)[0].profit, 593977, 'More per run without more $/hour is not enough');
const lossFast = { ...screenshotFast, profit: -1000, hourlyProfit: -2063, legs: screenshotFast.legs.map((leg, i) => i === 1 ? { ...leg, buy: 130 } : leg) };
const lossSlow = { ...screenshotTrade, profit: -1000, hourlyProfit: -1980, legs: screenshotTrade.legs.map((leg, i) => i === 2 ? { ...leg, buy: 130 } : leg) };
assert.equal(rankSupplyRoutes([lossFast, lossSlow], 20)[0].seconds, 1745, 'Stretching an unchanged loss over more time is not a benefit');
assert.ok(!rankSupplyRoutes([lossFast, lossSlow], 20)[0].recommendation, 'Loss-only delivery is an explicit express option, not a normal recommendation');
assert.equal(new Set(ranked.map(route => JSON.stringify(route.legs))).size, ranked.length);

// Reproduce the second screenshot through the actual transaction optimizer:
// 91 Reactors at 10,500 -> 15,000 finance a 180 -> 125 Ablatives delivery.
const pilgrim = { ...ship, id: 'pilgrim', name: 'Pilgrim', cargo: 4300, cruise: 415, dock: 'large', dockType: 3 };
const reactors = { id: 'reactor', name: 'Reactor Systems', buy: 10500, sell: 1, volume: 1, originalVolume: 1, stock: 91, min: 0, max: 1000 };
const ownerBase = { ...structuredClone(rhw), offers: [{ ...plating, buy: 100, sell: 125, volume: 1, originalVolume: 1, stock: 0, min: 0, max: 20000 }, reactors] };
const corporate = { ...structuredClone(rhw), id: 'corporate', name: 'Corporate Shipping Airways', offers: [
  { ...plating, buy: 180, sell: 1, volume: 1, originalVolume: 1, stock: 10000, min: 0, max: 20000 },
  { ...reactors, buy: 20000, sell: 15000, stock: 0 }
] };
const corporateQuote = quoteSupply([makeLeg(ownerBase, corporate, 'reactor', pilgrim), makeLeg(corporate, ownerBase, 'ablative', pilgrim)], [ownerBase, corporate], pilgrim);
assert.deepEqual(corporateQuote.quantities, [91, 4300]);
assert.equal(corporateQuote.profit, 173000, 'Whole-run hauler profit remains correctly positive');
assert.equal(corporateQuote.capitalNeeded, 955500);
assert.equal(corporateQuote.delivery.cost, 774000);
assert.equal(corporateQuote.delivery.payout, 537500);
assert.equal(corporateQuote.delivery.loss, 236500, 'Show the inbound loss despite the profitable export');
const corporateRun = { ...corporateQuote, ship: pilgrim, extraStop: false, seconds: 908, unitsPerHour: 17054, hourlyProfit: 686120 };
const normalAndExpress = rankSupplyRoutes([corporateRun, screenshotFast, screenshotTrade], 20);
assert.equal(normalAndExpress[0].profit, 815000, 'The near expensive POB must not exclude the longer ordinary circuit');
assert.equal(normalAndExpress[1].profit, 593977);
assert.match(normalAndExpress[2].label, /^EXPRESS OPTION/);
assert.equal(normalAndExpress[2].delivery.loss, 236500);
assert.ok(!normalAndExpress[2].recommendation);
assert.equal(rankSupplyRoutes([{ ...corporateRun, profit: 2000000, hourlyProfit: 8000000 }, screenshotFast, screenshotTrade], 20)[0].profit, 815000, 'Even a huge outbound gain cannot disguise loss-making procurement');
const onlyExpress = rankSupplyRoutes([corporateRun], 20);
assert.match(onlyExpress[0].label, /^EXPRESS ONLY/);
assert.ok(!onlyExpress[0].recommendation);

// Full search with a very close loss-making POB: keep the NPC backhaul's time
// allowance and surface the POB as a separate, faster express option.
const nearPob = { ...structuredClone(corporate), pos: [25000, 0, 0], offers: [
  { ...plating, buy: 180, sell: 1, stock: 10000, min: 0, max: 20000 }, { ...reactors, sell: 15000, stock: 0 }
] };
const supplyOwner = structuredClone(rhw); supplyOwner.offers.push(structuredClone(reactors));
const network = { ...dataset, bases: [supplyOwner, waterloo, oder, nearPob] };
const nearNav = structuredClone(navigation);
nearNav.nodes.push({ id: 'corporate', system: 'br01', pos: nearPob.pos, kind: 'base', allows: ['medium', 'large', 'berth'] });
nearNav.baseNodes.corporate = 'corporate';
nearNav.links.push({ from: 'rhw', to: 'corporate', kind: 'lane', speed: 2500 }, { from: 'corporate', to: 'rhw', kind: 'lane', speed: 2500 });
const withPobs = await searchSupply(network, nearNav, [ship], { commodity: 'ablative', extraPercent: 20 });
assert.ok(withPobs.results[0].stops.includes('waterloo'));
assert.ok(withPobs.results[0].recommendation);
assert.equal(withPobs.stats.benchmarkSeconds, fast.seconds, 'Loss-making POB prices cannot shorten the normal time benchmark');
assert.ok(withPobs.results.some(route => route.stops.includes('corporate') && route.delivery.loss > 0 && !route.recommendation));
const withoutPobs = await searchSupply(network, nearNav, [ship], { commodity: 'ablative', extraPercent: 20, includePobs: false });
assert.ok(withoutPobs.results.every(route => !route.stops.includes('corporate')));
const affordableNetwork = structuredClone(network);
affordableNetwork.bases.find(base => base.id === 'corporate').offers[0].buy = 100;
const affordablePob = await searchSupply(affordableNetwork, nearNav, [ship], { commodity: 'ablative', extraPercent: 20 });
assert.ok(affordablePob.results[0].stops.includes('corporate'), 'POBs priced within RHW payout remain valid normal recommendations');
assert.equal(affordablePob.results[0].delivery.loss, 0);

const access = dockingAccess([oder], [{ nickname: 'oder', faction_nickname: 'owner' }], [], [
  { nickname: 'dsy_license_fc_c_grp', rephacks: [{ faction_nickname: 'owner', reputation: 1, rep_type: 3 }] },
  { nickname: BMM_ID, rephacks: [{ faction_nickname: 'owner', reputation: -0.7, rep_type: 0 }] }
]);
assert.deepEqual(access.blocked, ['oder'], 'Only BMM ID rules control RHW access');
assert.equal(dockingAccess([oder]).byId.oder.state, 'unknown');
const bundled = validateNavigation(JSON.parse(gunzipSync(await readFile(new URL('../assets/navigation.json.gz', import.meta.url)))));
assert.ok(bundled.nodes.length > 2000 && bundled.links.length > 2000);
const normalized = normalizeDarkstat([], [{ nickname: 'good', name: 'Good', volume: 2, market_goods: [{ base_nickname: 'npc', system_nick: 'br01', base_sells: true, price_base_sells_for: 10, price_base_buys_for: 20, volume: 2 }] }]);
assert.equal(normalized.bases[0].offers[0].buy, 10);
assert.equal(normalized.bases[0].offers[0].sell, 20);
console.log('Supply routes passed: Waterloo/Oder backhaul, required return cargo, priority, time limit, volumes, cash/space/reserves/caps, capital, losses, ship comparison, docking and DTR map.');
