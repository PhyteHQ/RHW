import assert from 'node:assert/strict';
import { quoteExport, rankExportRoutes, searchExports } from '../js/supply/export-planner.mjs';
import { normalizeDarkstat } from '../js/supply/core/trade.mjs';

const ship = { id: 'train', name: '5k Train', cargo: 5000, cruise: 350, dock: 'medium' };
const item = { id: 'gold', name: 'Gold', buy: 200, sell: 150, volume: 30, originalVolume: 30, stock: 1000, min: 100, max: 10000 };
const rhw = { id: 'rhw', name: 'Resolution Heavy Works', kind: 'pob', system: 'br01', systemName: 'New London',
  pos: [0, 0, 0], cash: 0, space: 0, offers: [item] };
const buyer = { id: 'buyer', name: 'Buyer Works', kind: 'pob', system: 'br01', systemName: 'New London',
  pos: [100000, 0, 0], cash: 20000, space: 3000, offers: [{ ...item, buy: 99999, sell: 250, stock: 40, min: 0, max: 300 }] };
const unchanged = JSON.stringify([rhw, buyer]);
const q = quoteExport(rhw, buyer, 'gold', ship);
assert.equal(q.delivered, 80, 'Buyer funds limit the load, even when a full cargo hold fits');
assert.equal(q.purchaseCost, 16000, 'Use RHW sale quotation, never its incoming buy quote');
assert.equal(q.rhwRevenue, 16000);
assert.equal(q.buyerPayout, 20000, 'Use the destination incoming buy quote');
assert.equal(q.profit, 4000);
assert.equal(q.capitalNeeded, 16000);
assert.equal(q.events.at(-1).after.cash, 0);
assert.deepEqual(q.limiting, ['Buyer funds']);
assert.equal(JSON.stringify([rhw, buyer]), unchanged, 'Quotes never mutate the market snapshot');

const rich = structuredClone(buyer); rich.cash = 1e9;
assert.equal(quoteExport(rhw, rich, 'gold', ship).delivered, 100, 'Storage is measured in the buyer original volume');
rich.space = 1e6;
assert.equal(quoteExport(rhw, rich, 'gold', ship).delivered, 166, 'Whole units, not 166.67 ship systems');
assert.equal(quoteExport(rhw, rich, 'gold', ship, { capital: 1000 }).delivered, 5);
assert.equal(quoteExport(rhw, rich, 'gold', ship, { capital: 0 }), null, 'Zero capital is not an unknown/unlimited budget');
assert.equal(quoteExport(rhw, rich, 'gold', ship, { quantity: 12 }).delivered, 12);
const reserved = structuredClone(rhw); reserved.offers[0].min = 997;
assert.equal(quoteExport(reserved, rich, 'gold', ship).delivered, 3, 'Keep the RHW sale reserve');
const full = structuredClone(rich); full.offers[0].max = 40;
assert.equal(quoteExport(rhw, full, 'gold', ship), null, 'A full purchase limit is closed');
for (const value of [0, null]) {
  const poor = structuredClone(buyer); poor.cash = value;
  assert.equal(quoteExport(rhw, poor, 'gold', ship), null, 'Missing or empty POB cash cannot support an export');
  const noSpace = structuredClone(buyer); noSpace.space = value;
  assert.equal(quoteExport(rhw, noSpace, 'gold', ship), null, 'Missing or empty POB storage cannot support an export');
}
const unknown = structuredClone(buyer); unknown.offers[0].max = null;
assert.equal(quoteExport(rhw, unknown, 'gold', ship), null, 'Unknown demand is not unlimited');
const missingVolume = structuredClone(buyer); missingVolume.offers[0].originalVolume = null;
assert.equal(quoteExport(rhw, missingVolume, 'gold', ship), null);

const cheap = structuredClone(buyer); cheap.offers[0].sell = 100;
const ranking = rankExportRoutes([
  { ...q, ship, seconds: 400, hourlyProfit: 36000 },
  { ...q, ship: { ...ship, id: 'fast' }, seconds: 200, hourlyProfit: 72000 },
  { ...quoteExport(rhw, cheap, 'gold', ship), ship, seconds: 10, hourlyProfit: -360000 }
]);
assert.equal(ranking.length, 1, 'Show each buyer once and choose its best profitable ship');
assert.equal(ranking[0].ship.id, 'fast');
assert.ok(ranking[0].recommendation);
const lossOnly = rankExportRoutes([{ ...quoteExport(rhw, cheap, 'gold', ship), ship, seconds: 400, hourlyProfit: -1000 }]);
assert.equal(lossOnly[0].recommendation, null, 'A losing export never gets a recommendation');

const dataset = { schema: 1, asOf: new Date().toISOString(), bases: [rhw, buyer] };
const nav = { schema: 1, nodes: dataset.bases.map(base => ({ id: base.id, system: base.system, pos: base.pos, allows: ['medium'], kind: 'base' })),
  baseNodes: { rhw: 'rhw', buyer: 'buyer' }, links: [] };
const result = await searchExports(dataset, nav, [ship], { commodity: 'Gold' });
assert.equal(result.results[0].delivered, 80);
assert.equal(result.results[0].legs.length, 2);
assert.equal(result.results[0].legs[1].good, null, 'The return is empty');
assert.ok(result.results[0].seconds > result.results[0].deliverySeconds, '$/hour includes the return');
assert.equal((await searchExports(dataset, nav, [ship], { commodity: 'Gold', includePobs: false })).results.length, 0);
assert.equal((await searchExports(dataset, nav, [ship], { commodity: 'Gold', blocked: ['buyer'] })).results.length, 0);
const unmoored = structuredClone(nav); unmoored.nodes[1].allows = ['berth'];
assert.equal((await searchExports(dataset, unmoored, [ship], { commodity: 'Gold' })).results.length, 0);
const oneWay = structuredClone(nav); oneWay.nodes[1].system = 'br02'; oneWay.links = [{ from: 'rhw', to: 'buyer', kind: 'jump' }];
assert.equal((await searchExports(dataset, oneWay, [ship], { commodity: 'Gold' })).results.length, 0, 'Return travel must also be possible');

const raw = normalizeDarkstat([{ nickname: 'p', name: 'P', money: 1000, cargospace: 100,
  shop_items: [{ nickname: 'g', name: 'Gold', price: 200, sell_price: 250, quantity: 10, min_stock: 0, max_stock: 20, volume: 1, original_volume: 1 }] }], []);
assert.equal(raw.bases[0].offers[0].buy, 200);
assert.equal(raw.bases[0].offers[0].sell, 250);
console.log('Export routes passed: quote direction, buyer cash/storage/demand, RHW reserve, cargo volume, capital, unknown data, ranking, docking and full return.');
