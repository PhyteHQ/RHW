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
    { name: 'Superstructure Systems', quantity: 1000, sell_price: 1, price_to_buy_from_base: 62000 },
    { name: 'Reactor Systems', quantity: 1000, price_to_sell_to_base: 1, price: 48000 },
    { name: 'Avionics Systems', quantity: 1000, sell_price: 23, price: 999 },
    { name: 'Unassigned <Shield>', quantity: 1, price: 12345 }
  ];
  ctx.items = goods.map(item => ({ ...item })); ctx.rebuildItemCaches();
  const material = (id, name) => ({ id, name });
  assert.equal(core.rhwQuote(material('ore', 'Gold Ore')).price, 4.25, 'Use the incoming purchase quote, not the base sale price');
  assert.equal(core.rhwQuote(material('fuel', 'H-Fuel')).price, 0, 'An explicitly reported zero remains a valid price');
  assert.equal(core.rhwQuote(material('fuel', 'Promethene')), null, 'Never substitute a generic asking price');
  const supers = material('commodity_ship_part_superstructure', 'Superstructure Systems');
  const reactors = material('commodity_ship_part_reactor', 'Reactor Systems');
  assert.equal(core.rhwQuote(supers).price, 62000, 'Supers use RHW sale value, not the $1 incoming quote');
  assert.equal(core.rhwQuote(reactors).price, 48000, 'Reactors use RHW sale value, not the $1 incoming quote');
  assert.equal(core.rhwQuote(supers).basis, 'base-sells');
  assert.equal(core.rhwQuote(reactors).basis, 'base-sells');
  assert.equal(core.rhwQuote(material('commodity_ship_part_avionics', 'Avionics Systems')).price, 23, 'Other components retain supplier purchase quotations');
  for (const field of ['price_to_buy_from_base', 'buy_price', 'price_buy', 'price']) {
    const item = ctx.findCommodity('Superstructure Systems');
    for (const key of ['price_to_buy_from_base', 'buy_price', 'price_buy', 'price']) delete item[key];
    item[field] = 62000;
    assert.equal(core.rhwQuote(supers).price, 62000, `Sale quote alias ${field}`);
  }
  const superItem = ctx.findCommodity('Superstructure Systems');
  delete superItem.price;
  assert.equal(core.rhwQuote(supers), null, 'Missing sale value must not fall back to the incoming $1 quote');
  superItem.price_to_buy_from_base = 62000;
  const oldImport = core.importRhwPrices({ materialPrices: { [supers.id]: 1 },
    materialPriceSources: { [supers.id]: { kind: 'rhw', price: 1 } } }, [supers, reactors]);
  assert.equal(oldImport.materialPrices[supers.id], 62000, 'An explicit reload corrects a previous wrong-direction RHW import');
  assert.equal(oldImport.materialPriceSources[supers.id].basis, 'base-sells');
  assert.equal(core.importRhwPrices({ materialPrices: { [supers.id]: 0 } }, [supers]).materialPrices[supers.id], 0, 'Deliberate entered prices still take precedence');
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

  // Old device preferences must not keep excluding valid alternative stocks.
  const alloyId = 'recipe_scrap_advanced', superId = 'ship_part_superstructure';
  const oldSelections = { [`${alloyId}:1`]: 'commodity_h_fuel', [`${alloyId}:2`]: 'commodity_iron',
    [`${superId}:3`]: 'commodity_pirate_gold' };
  memory.set('calc', { altSelections: oldSelections });
  app.state.calculator = { altSelections: oldSelections };
  run('js/command/production-model.js'); run('js/calculator/ui.js'); run('js/calculator/production-bridge.js');
  const batch = app.production.recipes().find(entry => entry.recipeId === alloyId);
  assert.deepEqual(Array.from(batch.inputOptions['MOX']), ['MOX', 'Promethene', 'H-Fuel']);
  assert.deepEqual(Array.from(batch.inputOptions['Scrap Metal']), ['Scrap Metal', 'Iron']);
  assert.equal(ctx.analyzeRecipe(batch).possibleCycles, 2, 'Iron contributes automatically even when Scrap Metal is empty');
  ctx.findCommodity('Scrap Metal').quantity = 375;
  ctx.findCommodity('Iron').quantity = 375;
  assert.equal(ctx.analyzeRecipe(batch).possibleCycles, 1, 'Partial valid stocks combine into a complete cycle');
  const fuels = ['MOX', 'Promethene', 'H-Fuel'];
  const fuelStocks = fuels.map(name => ctx.findCommodity(name).quantity);
  fuels.forEach((name, index) => { ctx.findCommodity(name).quantity = [30, 30, 40][index]; });
  assert.equal(ctx.analyzeRecipe(batch).possibleCycles, 1, 'Partial fuel stocks combine before cycle rounding');
  fuels.forEach((name, index) => { ctx.findCommodity(name).quantity = fuelStocks[index]; });
  ctx.findCommodity('Iron').quantity = null;
  assert.equal(ctx.analyzeRecipe(batch).possibleCycles, null, 'Invalid reported input stock remains unknown');
  ctx.findCommodity('Iron').quantity = 1500;
  ctx.findCommodity('Scrap Metal').quantity = 0;
  const superBatch = app.production.requirements({ product: 'Superstructure Systems', recipeId: superId });
  assert.deepEqual(Array.from(superBatch.inputOptions.Gold), ['Gold', 'Wildcat Gold'], 'Preserve recipe consumption order');
  assert.equal(ctx.analyzeRecipe(superBatch).possibleCycles, 80, 'Wildcat Gold contributes without a selection');
  ctx.findCommodity('Gold').quantity = 10;
  ctx.findCommodity('Wildcat Gold').quantity = 15;
  let gold = ctx.analyzeRecipe(superBatch).ingredientData.find(row => row.name === 'Gold');
  assert.equal(gold.stock, 25);
  assert.equal(gold.required, 25, 'BMM-adjusted requirement is unchanged');
  assert.equal(ctx.analyzeRecipe(superBatch).possibleCycles, 1, '10 Gold plus 15 Wildcat Gold make one cycle');
  assert.equal(gold.displayName, 'Gold / Wildcat Gold');
  assert.match(gold.extraHtml, /Gold<\/span><strong>10.*Wildcat Gold<\/span><strong>15/);
  assert.equal((gold.extraHtml.match(/class="recipe-stock-option"/g) || []).length, 2, 'Each additive stock gets its own row');
  assert.doesNotMatch(gold.extraHtml, /STD|WC:|\/\//);
  ctx.findCommodity('Gold').quantity = 0;
  ctx.findCommodity('Wildcat Gold').quantity = 24;
  assert.equal(ctx.analyzeRecipe(superBatch).possibleCycles, 0, 'A mixed pool must still meet the full requirement');
  assert.equal(ctx.analyzeRecipe(superBatch).ingredientData.find(row => row.name === 'Gold').currentCycleGap, 1);
  ctx.findCommodity('Wildcat Gold').quantity = 2000;
  const wildcat = ctx.findCommodity('Wildcat Gold');
  ctx.itemsByKey.delete('wildcat gold');
  assert.equal(ctx.analyzeRecipe(superBatch).possibleCycles, 0, 'An unlisted alternative adds no reported stock');
  ctx.itemsByKey.set('wildcat gold', wildcat);

  assert.equal(app.productionPricing.openProductionTarget('Basic Alloy'), true);
  const calc = app.state.calculator;
  assert.equal(calc.altSelections, undefined, 'The Production shortcut discards removed device preferences');
  const plan = core.buildPlan({ ...calc, useInventory: false, recursive: false, routingPolicy: 'first' });
  assert.deepEqual(Array.from(core.materialRows(plan), row => [row.name, row.required]), Array.from(batch.ingredients, pair => [...pair]));
  const comparison = core.compareRecipes({ ...calc, altSelections: oldSelections }).entries.find(entry => entry.recipe.id === alloyId);
  assert.ok(comparison.rows.some(row => row.id === 'commodity_scrap_metal'), 'Legacy choices cannot affect variant costing');

  const mount = element(), loadButton = element(), price = element();
  nodes.set('operationsCalculatorMount', mount); nodes.set('opsLoadRhwPrices', loadButton);
  price.dataset.materialPrice = 'commodity_industrial';
  lists.set('[data-material-price]', [price]);
  app.productionPricing.openProductionTarget('Basic Alloy');
  assert.doesNotMatch(mount.innerHTML, /data-ops-alternative|CHOOSE ONE MATERIAL/);
  price.value = '0'; price.listeners.input({ target: price });
  loadButton.listeners.click();
  assert.equal(app.state.calculator.materialPrices.commodity_industrial, 0);
  assert.equal(app.state.calculator.materialPrices.commodity_mox_fuel, 7);
  assert.equal(app.state.calculator.materialPrices.commodity_scrap_metal, 2);
  assert.match(mount.innerHTML, /RHW BUYS · LIVE/);
  const savedValue = app.state.calculator.materialPrices.commodity_scrap_metal;
  ctx.findCommodity('Scrap Metal').sell_price = 10;
  ctx.dataIsStale = true;
  app.operations.renderCalculator();
  assert.equal(app.state.calculator.materialPrices.commodity_scrap_metal, savedValue, 'Telemetry never silently changes a costing session');
  assert.match(mount.innerHTML, /RHW BUYS · CACHED/);

  for (const recipeId of ['ship_assembly_dsy_br_battleship', 'ship_assembly_dsy_br_carrier', 'ship_assembly_medium_miner']) {
    const recipe = core.recipe(recipeId);
    const hull = evaluate('DASHBOARD_CONFIG.capitalShipyard.hulls').find(entry => entry.recipeId === recipeId);
    app.operations.openSelection({ recipeId, productId: recipe.outputs[0].id, productName: hull.name });
    assert.equal(core.state.currentPlan.rootRecipe.id, recipeId, 'The actual Shipyard display name must still open its exact recipe');
    app.operations.loadRhwPrices();
    const shipCalc = app.state.calculator;
    const componentIds = core.materialRows(core.state.currentPlan).map(row => row.id);
    for (const [input, expected] of [[supers, 62000], [reactors, 48000]]) {
      assert.ok(componentIds.includes(input.id), `${recipeId} covers both RHW-produced component inputs`);
      assert.equal(shipCalc.materialPrices[input.id], expected, `Sale-valued component in ${recipeId}`);
      assert.equal(shipCalc.materialPriceSources[input.id].basis, 'base-sells');
    }
    assert.match(mount.innerHTML, /RHW SELLS · CACHED/);
    assert.equal(shipCalc.materialPrices.commodity_ship_part_avionics, 23);
  }

  console.log('RHW component sale-value regression passed: Supers/Reactors, $1 incoming quotes, all three ships, sale aliases, no opposite-side fallback, provenance and manual overrides.');
  ctx.els.search.value = 'Unassigned'; ctx.renderManifest();
  assert.match(ctx.els.itemsBody.innerHTML, /Unassigned &lt;Shield>/);
  assert.match(ctx.els.itemsBody.innerHTML, /OTHER/);
  assert.doesNotMatch(ctx.els.itemsBody.innerHTML, /PROCUREMENT|CRITICAL/);
  ctx.els.search.value = 'H-Fuel'; ctx.renderManifest(); assert.match(ctx.els.itemsBody.innerHTML, /H-Fuel/);
  ctx.els.search.value = 'Iron'; ctx.els.roleFilter.value = 'maintenance'; ctx.renderManifest();
  assert.match(ctx.els.itemsBody.innerHTML, /NO ASSETS MATCHING/);
  ctx.els.search.value = ''; ctx.els.roleFilter.value = 'all'; ctx.renderManifest();
  assert.equal((ctx.els.itemsBody.innerHTML.match(/<tr>/g) || []).length, goods.length, 'Only reported records appear; no synthetic placeholders');
  console.log('Procurement passed: purchase quote direction, zeros, overrides, explicit refresh, source age, automatic mixed-input coverage, removed selectors/preferences, Production shortcut, variant costing and complete inventory.');
})().catch(error => { console.error(error); process.exitCode = 1; });
