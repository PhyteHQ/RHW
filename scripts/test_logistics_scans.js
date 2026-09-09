#!/usr/bin/env node
'use strict';
// Exercise both shipped renderers against synthetic POB data, without a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const memory = new Map();
const node = () => ({ innerHTML: '', textContent: '', querySelectorAll: () => [] });
const buttons = ['ships', 'materials'].flatMap(marketGroup => ['price', 'stock'].map(marketSort => ({
  dataset: { marketGroup, marketSort }, attrs: {}, classList: { toggle() {} },
  setAttribute(key, value) { this.attrs[key] = value; }
})));
const ctx = vm.createContext({ console, setInterval() {}, clearInterval() {},
  document: { getElementById: () => null },
  localStorage: { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) },
  numFormatter: new Intl.NumberFormat('de-DE'), CANONICAL_NAMES: {},
  escapeHTML: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
  allBases: [], dataIsStale: false, lastLoaded: null, lastSyncError: '',
  marketSort: 'price', materialsSort: 'price', sortCol: 'name', sortAsc: true,
  els: { externalLogisticsPanel: node(), marketScanGrid: node(), marketScanMeta: node(),
    materialsScanGrid: node(), materialsScanMeta: node(), marketSortButtons: buttons }
});
ctx.window = ctx;
ctx.setSupplierLinkState = (state, label) => { ctx.link = { state, label }; };
const run = file => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, { filename: file });
run('js/config.js');
vm.runInContext(`Object.assign(globalThis, { MARKET_SCAN: DASHBOARD_CONFIG.marketScan,
  MATERIALS_SCAN: DASHBOARD_CONFIG.materialsScan, FEATURES: DASHBOARD_CONFIG.features,
  MATERIAL_FEEDSTOCKS: DASHBOARD_CONFIG.materialFeedstocks,
  BASE_NAME: DASHBOARD_CONFIG.baseName, STORAGE_KEYS: DASHBOARD_CONFIG.storageKeys });`, ctx);
run('js/02-utils.js');
run('js/04-state-production.js');
run('js/06-logistics.js');
assert.deepEqual([...ctx.MARKET_SCAN], ['Avionics Systems', 'Interior Systems', 'Propulsion Systems', 'Superstructure Systems', 'Reactor Systems', 'Exotic Systems']);
assert.deepEqual([...ctx.MATERIALS_SCAN], ['Gold', 'Gold Ore', 'Niobium', 'Niobium Ore', 'Prototype Components']);

const good = (name, quantity, min_stock, price) => ({ name, quantity, min_stock, price_to_buy_from_base: price });
const pob = (name, shop_items) => ({ name, system_name: 'Test System', shop_items });
const cards = grid => Object.fromEntries([...grid.innerHTML.matchAll(/data-market-commodity="([^"]+)">([\s\S]*?)(?=\n      <div class="supplier-card|$)/g)].map(m => [m[1], m[2]]));
const rowNames = card => [...card.matchAll(/class="supplier-commodity-name">\s*<strong>([^<]+)<\/strong>/g)].map(m => m[1]);
const inputs = card => [...card.matchAll(/data-market-feedstock="([^"]+)"[^>]*>\s*<span>([^<]+)<\/span>\s*<strong>([^<]+)<\/strong>/g)].map(m => ({ name: m[1], label: m[2], stock: m[3] }));

ctx.renderSupplier();
assert.equal(ctx.link.state, 'polling');
ctx.lastSyncError = 'timeout';
ctx.renderSupplier();
assert.equal(ctx.link.state, 'offline');
for (const grid of [ctx.els.marketScanGrid, ctx.els.materialsScanGrid]) assert.match(grid.innerHTML, /MARKET DATA UNAVAILABLE/);

ctx.lastSyncError = '';
ctx.lastLoaded = new Date();
ctx.allBases = [
  pob('Independent POB', [...[...ctx.MARKET_SCAN, ...ctx.MATERIALS_SCAN].map(name => good(name, 120, 20, 50)), good('Military Salvage', 4500, 4500, 0)]),
  pob('Cheapest POB', [good('Gold', 10, 0, 5), good('Gold Ore', 1234, 1234, null)]),
  pob('Largest POB', [good('Gold', 2000, 100, 100), good('Gold Ore', 0, 0, null)]),
  pob('Reserve Only', [good('Gold', 10, 10, 1)]),
  pob('Unpriced POB', [good('Niobium', 100, 10, 0)]),
  pob('Broken price', [good('Gold Ore', 100, 0, 'invalid')]),
  pob('Negative price', [good('Niobium Ore', 100, 0, -5)]),
  pob('Invalid stock', [good('Gold', 'NaN', 0, 1)]),
  { name: 'Unreadable POB' }, null
];
ctx.renderSupplier();
assert.equal(ctx.link.state, 'online', 'A valid scan does not depend on Lisheen or Shelton');
assert.equal(ctx.link.label, '6 SHIP OFFERS · 7 MATERIAL OFFERS');
let ships = cards(ctx.els.marketScanGrid), materials = cards(ctx.els.materialsScanGrid);
assert.equal(Object.keys(ships).length, 6);
assert.equal(Object.keys(materials).length, 5);
assert.ok(!ships['prototype components']);
assert.match(materials['prototype components'], /Independent POB/);
assert.deepEqual(rowNames(materials.gold), ['Cheapest POB', 'Independent POB', 'Largest POB']);
assert.match(materials.gold, /100 FOR SALE \/\/ 120 TOTAL · 20 BASE RESERVE/);
assert.doesNotMatch(materials.gold, /Reserve Only|Invalid stock/);
for (const name of ['gold ore', 'niobium', 'niobium ore']) assert.match(materials[name], /NOT LISTED/);
assert.equal(ctx.els.materialsScanMeta.textContent, '3 BASES · 7 PRICED OFFERS');
assert.deepEqual(inputs(materials.gold).map(i => [i.name, i.stock]), [['gold ore', '1.234'], ['gold ore', '120'], ['gold ore', '0']],
  'Each seller shows its own total input stock, including fully reserved inputs and explicit zero');
assert.deepEqual(inputs(materials.niobium).map(i => [i.name, i.stock]), [['niobium ore', '120'], ['niobium ore', 'NOT REPORTED']]);
assert.deepEqual(inputs(materials['prototype components']).map(i => [i.name, i.stock]), [['military salvage', '4.500']]);
assert.doesNotMatch(ctx.els.marketScanGrid.innerHTML, /market-feedstock/);
for (const key of ['gold ore', 'niobium ore']) assert.equal(inputs(materials[key]).length, 0, 'Ore offers do not display a production input');
for (const raw of [undefined, null, '', '  ', 'invalid', -1, Infinity, true]) {
  assert.equal(ctx.marketFeedstock(pob('Unreadable quantity', [good('Gold Ore', raw, 0, 1)]), 'Gold Ore').quantity, null,
    `Invalid input quantity ${String(raw)} must never turn into a zero`);
}
for (const field of ['amount', 'stock']) {
  assert.equal(ctx.marketFeedstock(pob('Alias', [{ name: 'Gold Ore (Commodity)', [field]: '2345' }]), 'Gold Ore').quantity, 2345);
}

const shipHtml = ctx.els.marketScanGrid.innerHTML;
assert.equal(ctx.setMarketSort('materials', 'stock'), true);
assert.equal(ctx.marketSort, 'price');
assert.equal(ctx.els.marketScanGrid.innerHTML, shipHtml, 'Sorting materials must not re-render ships');
assert.deepEqual(rowNames(cards(ctx.els.materialsScanGrid).gold), ['Largest POB', 'Independent POB', 'Cheapest POB']);
assert.deepEqual(inputs(cards(ctx.els.materialsScanGrid).gold).map(i => i.stock), ['0', '120', '1.234'], 'Input stocks stay with their seller after sorting');
assert.deepEqual(buttons.map(b => b.attrs['aria-pressed']), ['true', 'false', 'false', 'true']);
ctx.saveViewPreferences();
ctx.marketSort = 'stock'; ctx.materialsSort = 'price';
ctx.restoreViewPreferences();
assert.equal(ctx.marketSort, 'price'); assert.equal(ctx.materialsSort, 'stock');
assert.equal(ctx.setMarketSort('materials', 'bogus'), false);
memory.set(ctx.STORAGE_KEYS.view, JSON.stringify({ marketSort: 'stock' }));
ctx.materialsSort = 'price'; ctx.restoreViewPreferences();
assert.equal(ctx.marketSort, 'stock'); assert.equal(ctx.materialsSort, 'price', 'Old preferences remain valid');

// Both scans retain the cheapest and RHW offers even outside the top six by stock.
ctx.allBases = Array.from({ length: 8 }, (_, i) => pob(`Bulk ${i}`, [good('Gold', 500 + i, 0, 10 + i), good('Reactor Systems', 500 + i, 0, 10 + i)]));
ctx.allBases.push(pob('Cheapest POB', [good('Gold', 2, 0, 1), good('Reactor Systems', 2, 0, 1)]));
ctx.allBases.push(pob('Resolution Heavy Works', [good('Gold', 1, 0, 50), good('Reactor Systems', 1, 0, 50)]));
ctx.marketSort = ctx.materialsSort = 'stock';
ctx.renderSupplier();
for (const card of [cards(ctx.els.marketScanGrid)['reactor systems'], cards(ctx.els.materialsScanGrid).gold]) {
  const names = rowNames(card);
  assert.equal(names.length, 6);
  assert.ok(names.includes('Cheapest POB'));
  assert.ok(names.includes('Resolution Heavy Works'));
  assert.match(card, /RHW LOCAL \/ OWN FACILITY/);
  assert.match(card, /BEST PRICE/);
}
ctx.dataIsStale = true;
ctx.renderSupplier();
assert.equal(ctx.link.state, 'stale');
assert.match(ctx.els.materialsScanGrid.innerHTML, /Cached · Gold Ore at base/);
for (const grid of [ctx.els.marketScanGrid, ctx.els.materialsScanGrid]) {
  assert.match(grid.innerHTML, /STALE DATA/);
  assert.doesNotMatch(grid.innerHTML, /SCAN LIVE/);
}
ctx.dataIsStale = false;
ctx.allBases = [pob('Empty base', [])];
ctx.renderSupplier();
assert.equal(ctx.link.label, 'SCANS COMPLETE · NO PRICED OFFERS');
assert.match(ctx.els.materialsScanGrid.innerHTML, /NO SELLERS FOUND/);
console.log('Logistics scans passed: target partition, all-POB sourcing, reserves, seller input stocks, unknown vs zero, independent sorts, top-six retention and telemetry states');
