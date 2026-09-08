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

ctx.renderSupplier();
assert.equal(ctx.link.state, 'polling');
ctx.lastSyncError = 'timeout';
ctx.renderSupplier();
assert.equal(ctx.link.state, 'offline');
for (const grid of [ctx.els.marketScanGrid, ctx.els.materialsScanGrid]) assert.match(grid.innerHTML, /MARKET DATA UNAVAILABLE/);

ctx.lastSyncError = '';
ctx.lastLoaded = new Date();
ctx.allBases = [
  pob('Independent POB', [...ctx.MARKET_SCAN, ...ctx.MATERIALS_SCAN].map(name => good(name, 120, 20, 50))),
  pob('Cheapest POB', [good('Gold', 10, 0, 5)]),
  pob('Largest POB', [good('Gold', 2000, 100, 100)]),
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

const shipHtml = ctx.els.marketScanGrid.innerHTML;
assert.equal(ctx.setMarketSort('materials', 'stock'), true);
assert.equal(ctx.marketSort, 'price');
assert.equal(ctx.els.marketScanGrid.innerHTML, shipHtml, 'Sorting materials must not re-render ships');
assert.deepEqual(rowNames(cards(ctx.els.materialsScanGrid).gold), ['Largest POB', 'Independent POB', 'Cheapest POB']);
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
for (const grid of [ctx.els.marketScanGrid, ctx.els.materialsScanGrid]) {
  assert.match(grid.innerHTML, /STALE DATA/);
  assert.doesNotMatch(grid.innerHTML, /SCAN LIVE/);
}
ctx.dataIsStale = false;
ctx.allBases = [pob('Empty base', [])];
ctx.renderSupplier();
assert.equal(ctx.link.label, 'SCANS COMPLETE · NO PRICED OFFERS');
assert.match(ctx.els.materialsScanGrid.innerHTML, /NO SELLERS FOUND/);
console.log('Logistics scans passed: target partition, all-POB sourcing, reserves, invalid prices, independent sorts, top-six retention and telemetry states');
