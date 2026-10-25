#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const root = path.join(__dirname, '..');
const memory = new Map(), nodes = new Map(), lists = new Map();
const element = () => ({ innerHTML: '', textContent: '', value: '', dataset: {}, listeners: {},
  addEventListener(type, callback) { this.listeners[type] = callback; },
  setAttribute() {}, focus() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
const ctx = vm.createContext({ console, setTimeout, clearTimeout, navigator: { onLine: true }, addEventListener() {},
  document: { getElementById: id => nodes.get(id) || null, querySelector: () => null,
    querySelectorAll: selector => lists.get(selector) || [], addEventListener() {} },
  rhwBase: {}, lastLoaded: new Date(), items: [], itemsByKey: new Map(), operationalItemsCache: [],
  dataIsStale: false, lastSyncError: '', numFormatter: new Intl.NumberFormat('de-DE'),
  sortCol: 'name', sortAsc: true, CANONICAL_NAMES: {},
  escapeHTML: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
  els: { search: element(), roleFilter: { value: 'all' }, itemsBody: element(), tableHeaders: [] }
});
ctx.window = ctx;
const run = file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
const evaluate = code => vm.runInContext(code, ctx);
run('js/core/lifecycle.js');
ctx.RHWV4 = { state: {}, config: { storageKeys: { calculatorState: 'calc' },
  operations: { defaultAffiliation: 'br_m_grp', defaultProduct: 'commodity_gold' } },
  lifecycle: ctx.createRhwLifecycle(), util: { escape: ctx.escapeHTML,
    normalize: value => String(value).trim().toLowerCase(), number: value => String(value) },
  store: { get: (key, fallback) => memory.get(key) ?? fallback, set: (key, value) => { memory.set(key, value); return true; } },
  notify() {}, navigate() {}, onRender() {} };
run('js/command/config.js');
evaluate(`Object.assign(globalThis, { MAINTENANCE: DASHBOARD_CONFIG.roles.maintenance,
  EXPORTS: DASHBOARD_CONFIG.roles.export, SHIPYARD: DASHBOARD_CONFIG.roles.shipyard,
  BYPRODUCTS: DASHBOARD_CONFIG.roles.byproduct, PROCUREMENT: DASHBOARD_CONFIG.roles.procurement,
  FEEDSTOCK: DASHBOARD_CONFIG.roles.feedstock, CONFISCATED: DASHBOARD_CONFIG.roles.confiscated,
  PRODUCTION_MODULES: DASHBOARD_CONFIG.productionModules, CUSTOM_ALERTS: DASHBOARD_CONFIG.alerts,
  BAR_MAX_FALLBACKS: DASHBOARD_CONFIG.barMaxFallbacks });`);
run('js/shared/utils.js'); run('js/command/production.js'); run('js/command/inventory.js');
ctx.renderAll = () => {};
run('js/calculator/model.js'); run('js/calculator/catalog.js');
for (let i = 1; i <= 6; i++) run(`assets/recipes/catalog-v1-part-${String(i).padStart(2, '0')}.js`);
ctx.__RHW_RECIPE_CATALOG__ = JSON.parse(zlib.gunzipSync(Buffer.from(ctx.__RHW_RECIPE_CATALOG_GZIP_BASE64__, 'base64')));

(async () => {
  const app = ctx.RHWV4, core = app.operationsCore;
  await core.loadCatalog();
  const goods = [
    { name: 'Industrial Materials', quantity: 10000, price_to_sell_to_base: 3, price: 999 },
    { name: 'Gold Ore', quantity: 10000, sell_price: 4.25, price: 999 },
    { name: 'MOX', quantity: 10000, price_sell: 5, price: 999 },
    { name: 'H-Fuel', quantity: 10000, price_to_sell_to_base: 0, price: 999 },
    { name: 'Promethene', quantity: 10000, price: 123 },
    { name: 'Scrap Metal', quantity: 0, sell_price: 2 },
    { name: 'Iron', quantity: 1500, sell_price: 8 },
    { name: 'Gold', quantity: 0, sell_price: 60 },
    { name: 'Wildcat Gold', quantity: 2000, sell_price: 20 },
    { name: 'Hull Panels', quantity: 10000, sell_price: 10 },
    { name: 'Ablative Armor Plating', quantity: 10000, sell_price: 10 },
    { name: 'Super Alloy', quantity: 10000, sell_price: 10 },
    { name: 'Unassigned <Shield>', quantity: 1, price: 12345 }
  ];
  ctx.items = goods.map(item => ({ ...item })); ctx.rebuildItemCaches();
  const material = (id, name) => ({ id, name });
  assert.equal(core.rhwQuote(material('ore', 'Gold Ore')).price, 4.25, 'Use the incoming purchase quote, not the base sale price');
  assert.equal(core.rhwQuote(material('fuel', 'H-Fuel')).price, 0, 'An explicitly reported zero remains a valid price');
  assert.equal(core.rhwQuote(material('fuel', 'Promethene')), null, 'Never substitute a generic asking price');
  for (const value of [true, false, [], {}, '', '  ', null, undefined, -1, Infinity, 'broken']) {
    assert.equal(core.unitPrice({ value }, 'value'), null, `Invalid price ${String(value)}`);
  }
  const materials = [material('ore', 'Gold Ore'), material('fuel', 'MOX'), material('unknown', 'Promethene')];
  let result = core.importRhwPrices({ materialPrices: { ore: 0 } }, materials);
  assert.equal(result.materialPrices.ore, 0, 'Keep a deliberate self-mined zero');
  assert.equal(result.materialPrices.fuel, 5); assert.equal(result.imported, 1); assert.equal(result.preserved, 1); assert.equal(result.missing, 1);
  ctx.findCommodity('MOX').price_sell = 7;
  ctx.lastLoaded = new Date(Date.now() + 1000);
  result = core.importRhwPrices(result, materials);
  assert.equal(result.materialPrices.fuel, 7, 'Refresh a prior RHW import on explicit action');
  result.materialPrices.fuel = 11;
  assert.equal(core.importRhwPrices(result, materials).materialPrices.fuel, 11, 'Keep a changed imported value as a user override');
  ctx.rhwBase = null;
  assert.equal(core.rhwQuote(material('ore', 'Gold Ore')), null, 'No unverified prices');
  ctx.rhwBase = {};

  run('js/command/production-model.js'); run('js/calculator/ui.js'); run('js/calculator/production-bridge.js');
  const alloyId = 'recipe_scrap_advanced';
  assert.equal(app.production.selectAlternative(alloyId, 1, 'commodity_h_fuel'), true);
  assert.equal(app.production.selectAlternative(alloyId, 2, 'commodity_iron'), true);
  assert.equal(app.production.selectAlternative(alloyId, 1, 'commodity_gold'), false, 'Reject an input outside this group');
  assert.equal(app.production.selectAlternative('unregistered_recipe', 0, 'commodity_iron'), false);
  const batch = app.production.recipes().find(entry => entry.recipeId === alloyId);
  assert.ok(batch.ingredients.some(([name, qty]) => name === 'H-Fuel' && qty === 100));
  assert.ok(batch.ingredients.some(([name, qty]) => name === 'Iron' && qty === 750));
  assert.ok(!batch.ingredients.some(([name]) => name === 'MOX' || name === 'Scrap Metal'));
  assert.equal(ctx.analyzeRecipe(batch).possibleCycles, 2);
  assert.equal(app.productionPricing.openProductionTarget('Basic Alloy'), true);
  const calc = app.state.calculator;
  assert.equal(calc.altSelections[`${alloyId}:1`], 'commodity_h_fuel');
  assert.equal(calc.altSelections[`${alloyId}:2`], 'commodity_iron');
  const plan = core.buildPlan({ ...calc, useInventory: false, recursive: false, routingPolicy: 'first' });
  assert.deepEqual(Array.from(core.materialRows(plan), row => [row.name, row.required]), Array.from(batch.ingredients, pair => [...pair]));
  assert.ok(core.compareRecipes(calc).entries.find(entry => entry.recipe.id === alloyId).rows.some(row => row.id === 'commodity_iron'));
  ctx.findCommodity('Iron').quantity = null;
  assert.equal(ctx.analyzeRecipe(batch).possibleCycles, null, 'Missing selected stock does not become zero');
  ctx.findCommodity('Iron').quantity = 1500;
  const superId = 'ship_part_superstructure';
  let superBatch = app.production.requirements({ product: 'Superstructure Systems', recipeId: superId });
  assert.equal(ctx.analyzeRecipe(superBatch).possibleCycles, 0, 'Gold is selected: Wildcat stock must not be pooled into it');
  app.production.selectAlternative(superId, 3, 'commodity_pirate_gold');
  superBatch = app.production.requirements({ product: 'Superstructure Systems', recipeId: superId });
  assert.equal(ctx.analyzeRecipe(superBatch).possibleCycles, 80, 'Selected Wildcat stock uses the BMM-adjusted 25 units per cycle');

  const mount = element(), loadButton = element(), price = element(), select = element();
  nodes.set('operationsCalculatorMount', mount); nodes.set('opsLoadRhwPrices', loadButton);
  price.dataset.materialPrice = 'commodity_industrial';
  select.dataset.opsAlternative = '2'; select.value = 'commodity_iron';
  lists.set('[data-material-price]', [price]); lists.set('[data-ops-alternative]', [select]);
  app.productionPricing.openProductionTarget('Basic Alloy');
  price.value = '0'; price.listeners.input({ target: price });
  loadButton.listeners.click();
  assert.equal(app.state.calculator.materialPrices.commodity_industrial, 0);
  assert.equal(app.state.calculator.materialPrices.commodity_h_fuel, 0);
  assert.equal(app.state.calculator.materialPrices.commodity_iron, 8);
  assert.match(mount.innerHTML, /RHW BUYS · LIVE/);
  const savedValue = app.state.calculator.materialPrices.commodity_iron;
  ctx.findCommodity('Iron').sell_price = 10;
  ctx.dataIsStale = true;
  app.operations.renderCalculator();
  assert.equal(app.state.calculator.materialPrices.commodity_iron, savedValue, 'Telemetry never silently changes a costing session');
  assert.match(mount.innerHTML, /RHW BUYS · CACHED/);
  select.value = 'commodity_scrap_metal'; select.listeners.change({ target: select });
  assert.equal(core.state.currentPlan.directRequirements.find(entry => entry.groupIndex === 2).item.id, 'commodity_scrap_metal');
  assert.equal(app.production.selectionsFor(alloyId)[`${alloyId}:2`], 'commodity_scrap_metal', 'Calculator choices update BMM Production');

  ctx.els.search.value = 'Unassigned'; ctx.renderManifest();
  assert.match(ctx.els.itemsBody.innerHTML, /Unassigned &lt;Shield>/);
  assert.match(ctx.els.itemsBody.innerHTML, /OTHER/);
  assert.doesNotMatch(ctx.els.itemsBody.innerHTML, /PROCUREMENT|CRITICAL/);
  ctx.els.search.value = 'H-Fuel'; ctx.renderManifest(); assert.match(ctx.els.itemsBody.innerHTML, /H-Fuel/);
  ctx.els.search.value = 'Iron'; ctx.els.roleFilter.value = 'maintenance'; ctx.renderManifest();
  assert.match(ctx.els.itemsBody.innerHTML, /NO ASSETS MATCHING/);
  ctx.els.search.value = ''; ctx.els.roleFilter.value = 'all'; ctx.renderManifest();
  assert.equal((ctx.els.itemsBody.innerHTML.match(/<tr>/g) || []).length, goods.length, 'Only reported records appear; no synthetic placeholders');
  console.log('Procurement passed: purchase quote direction, zeros, overrides, explicit refresh, source age, BMM input choices/coverage/bridge/comparison and complete inventory.');
})().catch(error => { console.error(error); process.exitCode = 1; });
