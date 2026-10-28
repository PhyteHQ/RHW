import assert from 'node:assert/strict';
import { searchExports, quoteExport, rankExportRoutes } from '../js/supply/export-planner.mjs';
import { returnMarkets, quoteExportReturn } from '../js/supply/return-planner.mjs';
import { commodityGroups } from '../js/supply/commodity-groups.mjs';
import { Navigator } from '../js/supply/core/navigation.mjs';

const ship = { id: 'train', name: '5k Train', cargo: 5000, cruise: 350, dock: 'medium' };
const chambers = { id: 'chambers', name: 'Multi-Mode Focusing Chamber', buy: 7250, sell: 4000,
  stock: 300, min: 50, max: 1000, volume: 10, originalVolume: 10 };
const mox = { id: 'mox', name: 'MOX', buy: 26, sell: 150, stock: 0, min: 0, max: 10000, volume: 2, originalVolume: 3 };
const rhw = { id: 'rhw', name: 'Resolution Heavy Works', kind: 'pob', system: 'br01', systemName: 'New London',
  pos: [0, 0, 0], cash: 0, space: 0, offers: [chambers, mox] };
const buyer = { id: 'buyer', name: 'Distant Works', kind: 'pob', system: 'br02', systemName: 'Far Away',
  pos: [600000, 0, 0], cash: 3000000, space: 1e6,
  offers: [{ ...chambers, stock: 0, min: 0, max: 10000, sell: 12000 }, { ...mox, buy: 10, stock: 1000, min: 100 }] };
const data = bases => ({ schema: 1, asOf: new Date().toISOString(), bases });
function navigation(bases) {
  return { schema: 1, nodes: bases.map(base => ({ id: base.id, system: base.system, pos: base.pos, kind: 'base', allows: ['medium'] })),
    baseNodes: Object.fromEntries(bases.map(base => [base.id, base.id])),
    links: [{ from: 'rhw', to: 'buyer', kind: 'lane', speed: 500 }, { from: 'buyer', to: 'rhw', kind: 'lane', speed: 500 }] };
}
const bases = [rhw, buyer], nav = navigation(bases), settings = { dock: 30 };
const original = JSON.stringify(bases);
const direct = await searchExports(data(bases), nav, [ship], { commodity: 'chambers', returnCargo: false });
const outbound = direct.results[0];
assert.equal(outbound.delivered, 250);
assert.equal(outbound.profit, 1187500);
assert.equal(outbound.seconds, 2510);
const markets = returnMarkets(bases, rhw, ship, 'chambers');
assert.equal(markets.length, 1);
const full = quoteExportReturn(outbound, markets[0], new Map(bases.map(base => [base.id, base])), ship,
  new Navigator(nav, bases, ship), settings, { extraPercent: 0 });
assert.equal(full.delivered, 250, 'Return cargo must not reduce the primary export');
assert.equal(full.returnTrade.quantity, 833, 'The outbound sale frees 2,500 original-volume storage, enough for 833 return units');
assert.equal(full.returnTrade.profit, 116620);
assert.equal(full.profit, 1304120);
assert.equal(full.outboundProfit, 1187500);
assert.equal(full.rhwRevenue, 1812500);
assert.equal(full.capitalNeeded, 1812500);
assert.equal(full.seconds, outbound.seconds, 'A trade at the same docking stops adds no flight/docking time');
assert.equal(full.events.at(-1).after.space, 1);
assert.equal(full.events.at(-1).after.cash, 1687550);
assert.equal(full.events[1].after.cash, 0, 'The primary export may spend all buyer funds before a return purchase replenishes them');
assert.equal(full.quantities[0], 250);
assert.equal(full.quantities[1], 833);
assert.equal(JSON.stringify(bases), original, 'Backhaul calculations do not mutate the shared market');
const searched = await searchExports(data(bases), nav, [ship], { commodity: 'chambers', extraPercent: 0 });
assert.equal(searched.results[0].returnTrade.quantity, 833);
assert.equal(searched.results[0].legs[1].good, 'mox');
assert.ok(searched.results[0].recommendation);

const noDemand = structuredClone(rhw); noDemand.offers[1].max = 0;
assert.equal((await searchExports(data([noDemand, buyer]), nav, [ship], { commodity: 'chambers' })).results[0].returnTrade, undefined);
const tinyBuyer = structuredClone(buyer); tinyBuyer.cash = 12000;
const tiny = await searchExports(data([rhw, tinyBuyer]), nav, [ship], { commodity: 'chambers', extraPercent: 0 });
assert.equal(tiny.results[0].delivered, 1, 'A later return purchase must not retroactively fund a larger primary export');
assert.equal(tiny.results[0].returnTrade.quantity, 3);
const capped = await searchExports(data(bases), nav, [ship], { commodity: 'chambers', capital: 1000000, extraPercent: 0 });
assert.equal(capped.results[0].delivered, 137);
assert.ok(capped.results[0].capitalNeeded <= 1000000);
assert.equal(capped.results[0].returnTrade.quantity, 456);
assert.equal((await searchExports(data(bases), nav, [ship], { commodity: 'chambers', capital: 0 })).results.length, 0);

const rare = { id: 'rare', name: 'Rare Cargo', buy: 4000000, sell: 1, volume: 5000, originalVolume: 5000 };
const pickup = { id: 'pickup', name: 'Nearby NPC Pickup', kind: 'npc', system: 'br02', systemName: 'Far Away',
  pos: [600100, 0, 0], offers: [rare] };
const drop = { id: 'drop', name: 'New London NPC Buyer', kind: 'npc', system: 'br01', systemName: 'New London',
  pos: [1000, 0, 0], offers: [{ ...rare, buy: null, sell: 5000000 }] };
const fourBases = [rhw, buyer, pickup, drop], fourNav = navigation(fourBases);
const detour = await searchExports(data(fourBases), fourNav, [ship], { commodity: 'chambers', extraPercent: 20 });
const best = detour.results[0];
assert.equal(best.returnTrade.name, 'Rare Cargo');
assert.equal(best.returnTrade.to, 'New London NPC Buyer', 'Return cargo can sell in the home system instead of at RHW');
assert.equal(best.delivered, 250);
assert.equal(best.capitalNeeded, 2812500, 'Unspecified capital shows the real larger starting investment needed for expensive return cargo');
assert.equal(best.profit, 2187500);
assert.equal(best.legs.length, 4);
assert.ok(best.seconds <= outbound.seconds * 1.2);
const noExtra = await searchExports(data(fourBases), fourNav, [ship], { commodity: 'chambers', extraPercent: 0 });
assert.equal(noExtra.results[0].returnTrade.name, 'MOX', 'No-extra-stops still allows direct return cargo');
const noBudget = await searchExports(data(fourBases), fourNav, [ship], { commodity: 'chambers', capital: 1812500 });
assert.equal(noBudget.results[0].returnTrade.name, 'MOX', 'Future cargo profits do not finance the purchase of that same cargo');
const excluded = await searchExports(data(fourBases), fourNav, [ship], { commodity: 'chambers', blocked: ['pickup'] });
assert.equal(excluded.results[0].returnTrade.name, 'MOX');
const slowPickup = structuredClone(pickup); slowPickup.pos = [1200000, 0, 0];
const slowBases = [rhw, buyer, slowPickup, drop];
assert.notEqual((await searchExports(data(slowBases), navigation(slowBases), [ship], { commodity: 'chambers', extraPercent: 20 })).results[0].returnTrade?.name, 'Rare Cargo', 'Reject a lucrative detour outside the time allowance');
const loss = rankExportRoutes([{ ...best, outboundProfit: -10 }]);
assert.equal(loss[0].recommendation, null, 'Return profit never hides an export loss');

const plating = { id: 'ablative', name: 'Ablative Armor Plating', buy: 100, sell: 220, volume: 2, originalVolume: 2 };
const importingRhw = structuredClone(rhw); importingRhw.offers.push({ ...plating, stock: 0, min: 0, max: 20000 });
const oder = { ...pickup, id: 'oder', name: 'Oder Shipyard', offers: [plating] };
const platingBases = [importingRhw, buyer, oder];
const npcToRhw = await searchExports(data(platingBases), navigation(platingBases), [ship], { commodity: 'chambers', extraPercent: 20 });
assert.equal(npcToRhw.results[0].returnTrade.from, 'Oder Shipyard');
assert.equal(npcToRhw.results[0].returnTrade.to, 'Resolution Heavy Works');
assert.equal(npcToRhw.results[0].returnTrade.quantity, 1250, 'NPC Ablatives backhaul respects the storage freed by the export');
assert.equal(npcToRhw.results[0].delivered, 250);

const goods = ['MOX', 'Gold', 'Food Rations', 'gold', 'Toxic Waste', 'Avionics Systems', 'Reactor Systems', 'Interior Systems', 'Ablative Armor Platings', 'Gold Ore', 'Wildcat Gold', 'New Commodity'];
const outputs = ['Gold', 'Reactor Systems', 'Toxic Waste'];
const inputs = ['Gold', 'Reactor Systems', 'Wildcat Gold'];
const groups = commodityGroups(goods, outputs, 'export', inputs);
assert.deepEqual(groups.flatMap(group => group.names).map(normalizeName).sort(), outputs.map(normalizeName).sort(), 'Export mode contains only export goods, each once');
assert.equal(groups[0].label, 'SHIP SYSTEMS');
assert.deepEqual(groups.find(group => group.label === 'METALS & ORES').names.map(normalizeName), ['gold']);
const imported = commodityGroups(goods, outputs, 'supply', inputs);
const importedNames = imported.flatMap(group => group.names).map(normalizeName);
assert.ok(!importedNames.includes('toxic waste'), 'Export-only goods do not leak into imports');
assert.ok(['gold', 'reactor systems', 'wildcat gold'].every(name => importedNames.includes(name)), 'Dual-role recipe inputs remain importable');
assert.deepEqual(imported[0].names, ['Avionics Systems', 'Interior Systems', 'Reactor Systems'], 'Ship systems stay together and sort alphabetically');
assert.ok(imported.find(group => group.label === 'PRODUCTION MATERIALS').names.includes('Ablative Armor Platings'));
assert.ok(imported.find(group => group.label === 'METALS & ORES').names.includes('Gold Ore'));
assert.deepEqual(imported.at(-1), { label: 'OTHER GOODS', names: ['New Commodity'] });
assert.deepEqual(commodityGroups(['MOX'], outputs, 'export'), [], 'An empty mode never falls back to unrelated goods');
assert.deepEqual(commodityGroups(['Gold'], ['Gold'], 'supply'), [], 'Export-only selections cannot bypass the import filter');
function normalizeName(name) { return name.toLowerCase(); }
console.log('Export backhaul passed: fixed primary load, post-sale funds/storage, reserves, capital, NPC-to-RHW and NPC home delivery, detour limits, no hidden export loss and mode-specific commodity categories.');
