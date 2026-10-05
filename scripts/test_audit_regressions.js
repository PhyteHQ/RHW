#!/usr/bin/env node
'use strict';
// Exercise the shipped modules and embedded catalog, without a browser dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const root = path.join(__dirname, '..');
const run = (ctx, file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
const node = () => ({ textContent: '', value: '', dataset: {}, innerHTML: '', listeners: {},
  addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute() {}, focus() {}, setSelectionRange() {},
  classList: { remove() {}, add() {} } });

async function models() {
  const memory = new Map();
  let uid = 0;
  const nodes = new Map();
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, AbortController, Event, dispatchEvent() {},
    navigator: { onLine: true }, addEventListener() {},
    document: { getElementById: id => nodes.get(id) || null, querySelector: () => null,
      querySelectorAll: () => [], documentElement: { dataset: {} } },
    rhwBase: {}, lastLoaded: new Date(), items: [], dataIsStale: false, lastSyncError: '',
    findCommodity: () => ({ quantity: 10000 }), quantity: x => x.quantity,
    localStorage: { setItem: (k, v) => memory.set(k, v), getItem: k => memory.get(k), removeItem: k => memory.delete(k) }
  });
  ctx.window = ctx;
  run(ctx, 'js/build-info.js');
  run(ctx, 'js/core/lifecycle.js');
  ctx.RHWV4 = { ready: true, version: 'V4.0.2', state: {},
    lifecycle: ctx.createRhwLifecycle(),
    config: { repository: ctx.RHW_BUILD.repository, build: ctx.RHW_BUILD,
      storageKeys: { productionOrders: 'orders', calculatorState: 'calc' },
      operations: { defaultAffiliation: 'br_m_grp', defaultProduct: 'commodity_ship_part_reactor' } },
    util: { escape: v => String(v ?? ''), normalize: v => String(v ?? '').trim().toLowerCase(),
      number: v => Number(v).toLocaleString('de-DE'), uid: p => `${p}-${++uid}` },
    store: { get: (k, d) => memory.get(k) ?? d, set: (k, v) => { memory.set(k, v); return true; } }, notify() {}
  };
  run(ctx, 'js/command/production.js');
  run(ctx, 'js/calculator/model.js');
  run(ctx, 'js/calculator/catalog.js');
  for (let i = 1; i <= 6; i++) run(ctx, `assets/recipes/catalog-v1-part-${String(i).padStart(2, '0')}.js`);
  ctx.__RHW_RECIPE_CATALOG__ = JSON.parse(zlib.gunzipSync(Buffer.from(ctx.__RHW_RECIPE_CATALOG_GZIP_BASE64__, 'base64')));
  const app = ctx.RHWV4, core = app.operationsCore;
  await core.loadCatalog();
  const recipe = core.recipe('module_coreupgrade');
  const plan = core.buildPlan({ productId: recipe.outputs[0].id, recipeId: recipe.id, quantity: 1000,
    affiliationId: 'br_m_grp', recursive: false, useInventory: false });
  assert.equal(plan.actualOutput, 1000);
  assert.equal(plan.recipeFeeTotal, 2500000000);
  const rows = plan.directRequirements.map(r => ({ id: r.item.id, required: r.required }));
  const calc = { productId: recipe.outputs[0].id, recipeId: recipe.id, quantity: 1000, affiliationId: 'br_m_grp',
    marginPercent: 0, materialPrices: Object.fromEntries(rows.map(r => [r.id, 0])) };
  let quote = core.priceQuote(rows, calc, plan);
  assert.equal(quote.unitCost, 2500000, '1000 outputs must not be parsed from German display text as 1');
  assert.equal(quote.sellPerUnit, 2500000, 'Zero margin remains valid');
  assert.equal(quote.profit, 0);
  quote = core.priceQuote(rows, { ...calc, marginPercent: 20 }, plan);
  assert.equal(quote.sellPerUnit, 3125000);
  assert.equal(quote.profit, 625000000);
  const incomplete = core.priceQuote(rows, { ...calc, materialPrices: {} }, plan);
  assert.equal(incomplete.knownCost, plan.recipeFeeTotal, 'Known recipe fees remain visible in partial quotes');
  assert.equal(incomplete.unitCost, null, 'Missing prices never produce a complete sale quote');
  assert.equal(core.priceQuote([], { materialPrices: {}, marginPercent: 95 }, {actualOutput: 10, recipeFeeTotal: 100}).sellPerUnit, 200);

  // Render the actual calculator and exercise its input event handler.
  run(ctx, 'js/calculator/ui.js');
  app.state.calculator = calc;
  const mount = node(); nodes.set('operationsCalculatorMount', mount);
  app.operations.renderCalculator();
  const rendered = id => mount.innerHTML.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`))?.[1];
  assert.equal(rendered('opsUnitCost'), '$2,500,000');
  assert.equal(rendered('opsMobileUnitCost'), rendered('opsUnitCost'));
  assert.equal(rendered('opsMobileSellUnit'), rendered('opsSellUnit'));
  assert.match(mount.innerHTML, /ACTUAL OUTPUT<\/small><strong>1\.000<\/strong>/);
  assert.match(mount.innerHTML, /FIXED RECIPE FEE/);
  assert.match(mount.innerHTML, /id="opsQuantity" aria-label="Output quantity"/);
  ['opsMargin', 'opsUnitCost', 'opsMobileUnitCost', 'opsSellUnit', 'opsMobileSellUnit', 'opsProfit', 'opsMobileProfit'].forEach(id => nodes.set(id, node()));
  app.operations.renderCalculator();
  nodes.get('opsMargin').listeners.input({ target: { value: '20' } });
  assert.equal(nodes.get('opsMobileUnitCost').textContent, nodes.get('opsUnitCost').textContent);
  assert.equal(nodes.get('opsMobileSellUnit').textContent, '$3,125,000');
  assert.equal(nodes.get('opsMobileProfit').textContent, nodes.get('opsProfit').textContent);
  const miners = app.operations.matchingRecipes('Archon');
  assert.equal(miners.length, 2);
  assert.ok(miners.every(r => r.outputs[0].id === 'medium_miner_package'));
  assert.ok(core.recipe('ship_assembly_medium_miner').catalysts.some(c => c.id === 'blueprint_medium_miner'));
  assert.equal(app.operations.matchingRecipes('modular miner').length, 2);
  // Ship nicknames resolve to the actual recipe and keep its official name searchable.
  for (const search of ['longhorn', ' LONGHORN ', 'Liberty Heavy Frigate']) {
    const frigates = app.operations.matchingRecipes(search);
    assert.equal(frigates.length, 1, search);
    assert.equal(frigates[0].id, 'ship_assembly_li_frigate');
    assert.equal(frigates[0].outputs[0].id, 'li_frigate_package');
  }
  app.state.calculator = { ...calc, search: 'longhorn' };
  app.operations.renderCalculator();
  assert.match(mount.innerHTML, /"Longhorn" Liberty Heavy Frigate/);
  assert.match(mount.innerHTML, /value="ship_assembly_li_frigate" selected/);
  assert.equal(app.operations.matchingRecipes('Gold')[0].outputs[0].id, 'commodity_gold', 'Exact material name outranks Golden Blade');
  nodes.set('opsRecipeSearch', node());
  nodes.set('opsRecipe', node());
  app.state.calculator = { ...calc, recipeId: 'recipe_gold_advanced', productId: 'commodity_gold',
    search: 'Gold refining', affiliationId: '__none__', materialPrices: { commodity_gold_ore: 123 } };
  app.operations.renderCalculator();
  nodes.get('opsRecipeSearch').listeners.input({ target: { value: 'Gold refinin' } });
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(app.state.calculator.recipeId, 'recipe_gold_advanced');
  assert.equal(app.state.calculator.materialPrices.commodity_gold_ore, 123, 'Refining a search preserves prices for the same recipe');
  assert.equal(app.state.calculator.affiliationId, '__none__', 'Same-recipe search preserves deliberate IFF choice');
  nodes.get('opsRecipeSearch').listeners.input({ target: { value: 'Niobium' } });
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(Object.keys(app.state.calculator.materialPrices).length, 0, 'A different recipe starts with blank prices');
  assert.equal(app.state.calculator.affiliationId, 'br_m_grp');
  assert.doesNotMatch(mount.innerHTML, /opsAddProductionOrder|ADD TO ORDER BOARD/);
  // Same requested output, independently known BMM quantities, shared prices,
  // whole-batch surplus and zero-valued self-mined ore.
  const comparisonCalc = { recipeId: 'recipe_niobium_basic', productId: 'commodity_niobium',
    quantity: 801, affiliationId: 'br_m_grp', marginPercent: 20, comparisonOpen: true,
    materialPrices: { commodity_niobium_ore: 0, commodity_mox_fuel: 100,
      commodity_industrial: 20, commodity_mining_machinery: 30 } };
  const comparison = core.compareRecipes(comparisonCalc);
  assert.equal(comparison.entries.length, 3);
  assert.equal(comparison.complete, true);
  const variant = id => comparison.entries.find(entry => entry.recipe.id === id);
  assert.equal(variant('recipe_niobium_basic').plan.actualOutput, 1300);
  assert.equal(variant('recipe_niobium_basic').pricing.totalCost, 34000);
  assert.equal(variant('recipe_niobium_advanced').plan.actualOutput, 1600);
  assert.equal(variant('recipe_niobium_advanced').plan.surplus, 799);
  assert.equal(variant('recipe_niobium_advanced').pricing.totalCost, 37400);
  assert.equal(variant('recipe_niobium_advanced').pricing.unitCost, 23.375);
  assert.equal(variant('recipe_niobium_bulk').pricing.totalCost, 140250);
  assert.deepEqual([...comparison.bestIds], ['recipe_niobium_advanced']);
  const partialComparison = core.compareRecipes({ ...comparisonCalc, materialPrices: {
    ...comparisonCalc.materialPrices, commodity_mining_machinery: '' } });
  assert.equal(partialComparison.complete, false);
  assert.equal(partialComparison.bestIds.length, 0, 'Do not crown a winner while a comparable recipe is unpriced');
  const goldCalc = { ...comparisonCalc, recipeId: 'recipe_gold_basic', productId: 'commodity_gold' };
  const beforeOutputs = JSON.stringify(core.recipe('recipe_gold_basic').outputs);
  assert.equal(core.compareRecipes(goldCalc).entries.length, 4);
  const wildcat = core.compareRecipes({ ...goldCalc, affiliationId: '__none__' });
  assert.equal(wildcat.output.id, 'commodity_pirate_gold');
  assert.equal(wildcat.entries.length, 3, 'Gold conversion is not comparable to Wildcat Gold output');
  assert.ok(wildcat.entries.every(entry => entry.plan.product.id === 'commodity_pirate_gold'));
  assert.equal(JSON.stringify(core.recipe('recipe_gold_basic').outputs), beforeOutputs, 'Comparisons must restore the catalog');
  assert.equal(core.compareRecipes(calc).entries[0].pricing.recipeFee, 2500000000, 'Fixed fees agree with the main quote');
  app.state.calculator = { ...comparisonCalc, search: 'Niobium' };
  app.operations.renderCalculator();
  assert.match(mount.innerHTML, /id="opsComparisonPanel"/);
  assert.equal(app.operations.useComparisonVariant('recipe_niobium_bulk'), true);
  assert.equal(app.state.calculator.recipeId, 'recipe_niobium_bulk');
  assert.equal(app.state.calculator.affiliationId, 'br_m_grp');
  assert.equal(app.state.calculator.materialPrices.commodity_niobium_ore, 0);
  assert.equal(app.state.calculator.materialPrices.commodity_industrial, 20);
  assert.equal(app.state.calculator.quantity, 801);
  assert.equal(app.operations.useComparisonVariant('recipe_gold_basic'), false, 'Cannot adopt an unrelated output');
  console.log('Shared-price recipe comparison passed: IFF outputs, batch rounding, zero ore value, fees, incomplete prices and variant adoption.');
  let plans = 0;
  for (const r of core.state.catalog.recipes) {
    const affiliationId = r.restricted ? r.bonuses?.[0]?.id : 'br_m_grp';
    if (r.restricted && !affiliationId) continue;
    const p = core.buildPlan({ productId: r.outputs[0].id, recipeId: r.id, quantity: 13, affiliationId, recursive: false, useInventory: false });
    assert.ok(Number.isFinite(p.actualOutput) && p.actualOutput >= 13, r.id);
    assert.ok(p.directRequirements.every(row => Number.isFinite(row.required) && row.required >= 0), r.id);
    plans++;
  }
  assert.ok(plans >= 280, 'Exercise the full buildable catalog');

  assert.equal(ctx.telemetrySnapshot().label, 'LIVE STOCK');
  ctx.lastLoaded = new Date(Date.now() - 20 * 60000);
  assert.equal(ctx.telemetrySnapshot().label, 'CACHED STOCK', 'Age alone makes a snapshot stale');
  ctx.lastLoaded = new Date(); ctx.navigator.onLine = false;
  assert.equal(ctx.telemetrySnapshot().stale, true);
  ctx.navigator.onLine = true; ctx.rhwBase = null; ctx.lastLoaded = null; ctx.lastSyncError = 'timeout';
  assert.equal(ctx.telemetrySnapshot().label, 'TELEMETRY UNAVAILABLE');
  ctx.els = { baseMoneyVal: node(), baseStorageVal: node(), baseHealthVal: node() };
  ctx.els.baseMoneyVal.closest = () => null;
  run(ctx, 'js/data/telemetry.js');
  run(ctx, 'js/command/inventory.js');
  ctx.FEATURES = {};
  for (const name of ['renderOverview', 'renderProductionModules', 'renderManifest', 'updateDataFreshnessIndicators']) ctx[name] = () => {};
  // Exercise the real render entry point after a failed first fetch.
  ctx.renderAll();
  assert.ok(Object.values(ctx.els).every(n => n.textContent === 'UNAVAILABLE'));
  assert.equal(typeof ctx.buildIndustrialNewswireMessages, 'undefined', 'Retired Newswire is absent from the shipped dashboard');

  nodes.clear();
  run(ctx, 'js/command/config.js');
  vm.runInContext('globalThis.CAPITAL_SHIPYARD = DASHBOARD_CONFIG.capitalShipyard; const PRODUCTION_MODULES = DASHBOARD_CONFIG.productionModules;', ctx);
  run(ctx, 'js/calculator/production-bridge.js');
  run(ctx, 'js/command/production-model.js');
  const moduleRegistry = vm.runInContext('PRODUCTION_MODULES', ctx);
  assert.equal(moduleRegistry.length, 6);
  assert.ok(moduleRegistry.every(module => Object.keys(module).sort().join(',') === 'product,recipeId'), 'The registry must not carry duplicate recipe quantities');
  const productionModules = app.production.recipes();
  assert.equal(productionModules.length, 6, 'All installed modules resolve from the catalog');
  for (const spec of productionModules) {
    const entry = app.productionPricing.findRecipeForLabel(spec.product);
    assert.equal(entry.id, spec.recipeId, `Production shortcut for ${spec.product}`);
    const plan = core.buildPlan({ productId: entry.outputs[0].id, recipeId: entry.id,
      quantity: 1, affiliationId: 'br_m_grp', recursive: false, useInventory: false, routingPolicy: 'first' });
    assert.equal(plan.actualOutput, spec.output, `${spec.product} batch output agrees with Production`);
    const canonical = rows => Array.from(rows, ([name, qty]) => [name.toLowerCase(), qty]).sort((a, b) => a[0].localeCompare(b[0]));
    assert.deepEqual(canonical(core.materialRows(plan).map(row => [row.name, row.required])), canonical(Array.from(spec.ingredients, row => [...row])), `${spec.product} inputs agree with Production`);
  }
  assert.equal(app.productionPricing.findRecipeForLabel('Basic Alloy').id, 'recipe_scrap_advanced', 'A production shortcut must not unpack a sealed container');
  const alloy = core.state.recipesById.get('recipe_scrap_advanced');
  core.state.recipesById.delete(alloy.id);
  assert.equal(app.productionPricing.findRecipeForLabel('Basic Alloy'), null, 'A missing module recipe must not silently choose another variant');
  assert.equal(app.production.recipes().length, 0, 'A missing recipe must not retain cached material coverage');
  core.state.recipesById.set(alloy.id, alloy);
  const catalog = core.state.catalog;
  core.state.catalog = null;
  assert.equal(app.production.recipes().length, 0, 'An unavailable catalog must not become a zero-input batch');
  core.state.catalog = catalog;
  const refining = core.recipe('recipe_niobium_advanced');
  const previous = app.production.recipes().find(spec => spec.recipeId === refining.id);
  assert.equal(previous.output, 800);
  assert.equal(previous.ingredients.find(([name]) => name === 'Niobium Ore')[1], 425, 'BMM reduces the base ore requirement');
  assert.equal(previous.byproducts.find(([name]) => name === 'Toxic Waste')[1], 150);
  assert.equal(previous.prerequisites.find(([name]) => name === 'Crew')[1], 100, 'Crew is required without becoming consumed feedstock');
  assert.ok(!previous.ingredients.some(([name]) => name === 'Crew'));
  // A catalog refresh must update quantities even when the source recipe object
  // is reused. This exercises cache invalidation, BMM and non-consumed inputs.
  const ore = refining.inputs.find(input => input.options[0].id === 'commodity_niobium_ore').options[0];
  const waste = refining.outputs.find(output => output.id === 'commodity_toxic_waste');
  const saved = { ore: ore.qty, output: refining.outputs[0].qty, waste: waste.qty };
  ore.qty = 600; refining.outputs[0].qty = 900; waste.qty = 175;
  app.lifecycle.emit('catalog:loaded', { catalog });
  const updated = app.production.recipes().find(spec => spec.recipeId === refining.id);
  assert.notEqual(updated, previous);
  assert.equal(updated.output, 900);
  assert.equal(updated.ingredients.find(([name]) => name === 'Niobium Ore')[1], 510);
  assert.equal(updated.byproducts.find(([name]) => name === 'Toxic Waste')[1], 175);
  ore.qty = saved.ore; refining.outputs[0].qty = saved.output; waste.qty = saved.waste;
  app.lifecycle.emit('catalog:loaded', { catalog });
  console.log('Production catalog passed: all six modules, BMM inputs, byproducts, non-consumed crew, refresh propagation and unavailable recipes.');
  const yard = node();
  yard.insertAdjacentHTML = () => assert.fail('Retired planner must not be injected');
  nodes.set('shipyardControl', yard);
  ctx.MutationObserver = class { observe(target) { assert.notEqual(target, yard, 'Retired planner must not watch the Shipyard'); } };
  app.config.storageKeys.calculatorPriceProfiles = 'price-profiles';
  run(ctx, 'js/calculator/price-profiles.js');
  assert.equal(nodes.has('shipyardBuildPlanner'), false, 'Shipyard starts without the retired planner');
  assert.equal(typeof app.priceProfiles.ensureProfilePanel, 'function', 'Calculator price profiles remain available');
  // Exercise the actual save and delete UI handlers with a rejected write.
  const profileKey = app.config.storageKeys.calculatorPriceProfiles;
  memory.set(profileKey, [{ id: 'market', name: 'Market', prices: { ore: 12 }, updatedAt: 1 }]);
  const priceInput = node(); priceInput.dataset.materialPrice = 'ore'; priceInput.value = '25';
  const costPanel = node(), profilePanel = node();
  costPanel.querySelector = () => null;
  profilePanel.querySelector = selector => nodes.get(selector.slice(1)) || null;
  nodes.set('opsPriceProfiles', profilePanel);
  for (const id of ['opsPriceProfileSelect', 'opsPriceProfileName', 'opsPriceProfileStatus', 'opsPriceProfileSave', 'opsPriceProfileLoad', 'opsPriceProfileClear', 'opsPriceProfileDelete']) nodes.set(id, node());
  nodes.get('opsPriceProfileSelect').value = 'market';
  nodes.get('opsPriceProfileName').value = 'Changed Market';
  ctx.document.querySelector = selector => selector === '#workspaceOperations .ops-cost-panel' ? costPanel : null;
  ctx.document.querySelectorAll = selector => selector === '#workspaceOperations [data-material-price]' ? [priceInput] : [];
  ctx.confirm = () => true;
  app.priceProfiles.ensureProfilePanel();
  const write = app.store.set;
  app.store.set = () => false;
  app.priceProfiles.saveCurrentProfile();
  assert.equal(memory.get(profileKey)[0].name, 'Market');
  assert.match(nodes.get('opsPriceProfileStatus').textContent, /COULD NOT BE SAVED/);
  assert.equal(priceInput.value, '25', 'A failed save keeps session prices');
  nodes.get('opsPriceProfileDelete').listeners.click();
  assert.equal(memory.get(profileKey).length, 1);
  assert.equal(nodes.get('opsPriceProfileName').value, 'Changed Market');
  assert.match(nodes.get('opsPriceProfileStatus').textContent, /COULD NOT BE DELETED/);
  app.store.set = write;
  app.priceProfiles.saveCurrentProfile();
  assert.equal(memory.get(profileKey)[0].name, 'Changed Market');
  assert.equal(memory.get(profileKey)[0].prices.ore, 25);
  assert.match(nodes.get('opsPriceProfileStatus').textContent, /SAVED/);
  nodes.get('opsPriceProfileDelete').listeners.click();
  assert.equal(memory.get(profileKey).length, 0);
  nodes.clear();
  run(ctx, 'js/tools/discovery.js');
  app.discoveryStatus.state.status = { catalog: { effective: { recipes: 285 } }, workflow: { reviewRequired: true, autoMerge: false } };
  run(ctx, 'js/tools/diagnostics.js');
  const syncHealth = () => app.diagnostics.collect().find(r => r.key === 'discovery');
  assert.equal(syncHealth().tone, 'warn', 'Review policy alone is not a successful sync');
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required']) {
    app.discoveryStatus.state.latestRun = { conclusion, updated_at: new Date().toISOString() };
    assert.equal(syncHealth().tone, 'danger', conclusion);
  }
  app.discoveryStatus.state.latestRun = { conclusion: 'success', updated_at: new Date().toISOString() };
  assert.equal(syncHealth().tone, 'good');
  app.discoveryStatus.state.latestRun.updated_at = '2020-01-01T00:00:00Z';
  assert.equal(syncHealth().status, 'CHECK OVERDUE');
  app.discoveryStatus.state.checkError = true;
  assert.equal(syncHealth().status, 'CHECK UNAVAILABLE');
  assert.match(app.discoveryStatus.urls.workflow, /PhyteHQ\/RHW/);
  assert.match(app.diagnostics.buildReport(), new RegExp(ctx.RHW_BUILD.revision));
  console.log(`Catalog, quote/UI parity, Archon aliases, telemetry and sync health passed (${plans} recipes).`);
  return app.production.recipes();
}

async function serviceWorker() {
  const handlers = {}, entries = new Map();
  let skipCalls = 0, network = true, shellRequests = [];
  const cache = { addAll: async requests => {
      shellRequests = [...requests];
      // Simulate an HTTP cache that still holds the previous release.
      for (const request of requests) {
        const body = request.cache === 'reload' ? 'NEW RELEASE' : 'OLD HTTP CACHE';
        entries.set(request.url, new Response(body));
      }
    }, put: async (k, v) => entries.set(k, v),
    match: async k => entries.get(k)?.clone() };
  const ctx = vm.createContext({ Headers, Request, Response, URL, console,
    addEventListener: (k, f) => { handlers[k] = f; }, location: { origin: 'https://example.invalid', href: 'https://example.invalid/RHW/sw.js' },
    skipWaiting: async () => { skipCalls++; }, clients: { claim: async () => {} },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: async () => { if (!network) throw new Error('offline'); return new Response('## operations\n- [RHW | good] TEST'); }
  });
  ctx.self = ctx;
  ctx.importScripts = (...files) => files.forEach(file => run(ctx, file.replace(/^\.\//, '')));
  run(ctx, 'sw.js');
  let installed;
  handlers.install({ waitUntil: p => { installed = p; } });
  await installed;
  assert.equal(skipCalls, 0, 'Installing an update must not activate it over a live session');
  assert.ok(shellRequests.length >= 20, 'Install the bundles, fonts and icons for offline use');
  assert.ok(!shellRequests.some(r => /newswire|production-orders/i.test(r.url)), 'Retired UI must not enter the offline cache');
  assert.ok(shellRequests.every(request => request.cache === 'reload'), 'Every shell request must bypass old HTTP cache');
  assert.equal(await entries.get('https://example.invalid/RHW/js/rhw-dashboard.js').clone().text(), 'NEW RELEASE');
  assert.equal(await entries.get('https://example.invalid/RHW/js/rhw-workspaces.js').clone().text(), 'NEW RELEASE');
  entries.set('./index.html', new Response('INSTALLED HTML'));
  assert.equal(await (await ctx.appShellNavigation('https://example.invalid/RHW/')).text(), 'INSTALLED HTML',
    'Navigation must keep the installed HTML together with its cached scripts while an update waits');
  entries.delete('./index.html');
  assert.equal((await ctx.appShellNavigation('https://example.invalid/RHW/')).status, 200, 'A missing shell falls back to network');
  const fresh = await ctx.cacheFirst('compiled-app.js');
  network = false;
  const offline = await ctx.cacheFirst('compiled-app.js');
  assert.equal(await offline.text(), await fresh.text(), 'Offline app bytes must match the installed release');
  handlers.message({ data: { type: 'SKIP_WAITING' } });
  assert.equal(skipCalls, 1, 'Explicit restart can activate the waiting worker');
}

async function updates() {
  let reloads = 0, messages = 0, confirm = false;
  const swHandlers = {}, nodes = new Map();
  for (const id of ['rhwPwaPanel', 'rhwPwaKicker', 'rhwPwaTitle', 'rhwPwaMessage', 'rhwPwaPrimary']) nodes.set(id, node());
  const ctx = vm.createContext({ console,
    RHWV4: { state: { calculator: { materialPrices: { steel: 123 } } } },
    navigator: { serviceWorker: { addEventListener: (k, fn) => { swHandlers[k] = fn; } } },
    document: { readyState: 'loading', addEventListener() {}, documentElement: { dataset: {} }, getElementById: id => nodes.get(id) || null },
    addEventListener() {}, confirm: () => confirm, location: { reload: () => { reloads++; } }
  });
  ctx.window = ctx;
  run(ctx, 'js/core/pwa.js');
  swHandlers.controllerchange();
  assert.equal(reloads, 0, 'Initial install must not reload the active tab');
  const worker = { postMessage: () => { messages++; } };
  ctx.RHWPWA.announceUpdate(worker);
  swHandlers.controllerchange();
  assert.equal(reloads, 0, 'Activation in another tab must not discard this tab');
  assert.equal(ctx.RHWV4.state.calculator.materialPrices.steel, 123);
  ctx.RHWPWA.requestRestart(worker);
  assert.equal(messages, 0, 'Declining price loss keeps the worker waiting');
  confirm = true;
  ctx.RHWPWA.requestRestart(worker);
  assert.equal(messages, 1);
  swHandlers.controllerchange();
  assert.equal(reloads, 1);
  swHandlers.controllerchange();
  assert.equal(reloads, 1, 'Controller changes never create reload loops');
  console.log('Service-worker cache provenance and update lifecycle passed.');
}

function overviewReferences(recipes) {
  const ctx = vm.createContext({
    quantity: item => Number(item?.quantity || 0),
    commodityKey: item => String(item?.name || '').toLowerCase(),
    keyFromName: name => name.toLowerCase(),
    minStock: item => Number(item?.min_stock || 0),
    number: value => Number(value).toLocaleString('de-DE'),
    escapeHTML: value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
    statusPill: () => '<span class="pill">STABLE</span>',
    readinessText: () => 'READY', productionRecipes: () => recipes
  });
  run(ctx, 'js/command/config.js');
  vm.runInContext('const CUSTOM_ALERTS=DASHBOARD_CONFIG.alerts, FEEDSTOCK=DASHBOARD_CONFIG.roles.feedstock;', ctx);
  run(ctx, 'js/command/inventory.js');
  const evaluate = code => vm.runInContext(code, ctx);
  const ref = (item, role) => JSON.parse(evaluate(`JSON.stringify(overviewStockReference(${JSON.stringify(item)},${JSON.stringify(role)}))`));
  // Neither configured warning thresholds nor API reserves become target stock.
  const reactor = {name:'Reactor Systems',quantity:350,min_stock:50,max_stock:2000};
  assert.equal(ref(reactor,'export'), null);
  assert.equal(ref({name:'Basic Alloy',quantity:350,min_stock:1000},'maintenance'), null);
  assert.equal(ref({name:'Unconfigured Material',quantity:50,min_stock:500},'export'), null);
  assert.equal(evaluate(`overviewDetail(${JSON.stringify(reactor)},'low','export')`), 'READY');
  assert.deepEqual(ref({name:'Toxic Waste',quantity:17000,max_stock:50000},'byproduct'), {value:15000,label:'DISPOSAL AT'});
  assert.deepEqual(ref({name:'Wildcat Gold',quantity:0},'confiscated'), {value:25000,label:'REVIEW AT'});
  assert.equal(evaluate("overviewDetail({name:'Toxic Waste',quantity:17000},'low','byproduct')"), 'DISPOSAL REQUIRED');
  assert.deepEqual(ref({name:'Gold Ore',quantity:400},'procurement'), {value:425,label:'BATCH INPUT'});
  assert.deepEqual(ref({name:'Scrap Metal',quantity:0,missing:true},'procurement'), {value:750,label:'BATCH INPUT'});
  assert.equal(ref(null,'export'), null);
  assert.equal(ref({name:'Unconfigured Material',quantity:50},'export'), null);
  const markup=evaluate(`renderOverviewRow({state:'low',role:'export',name:'Reactor Systems',item:${JSON.stringify(reactor)},quantityValue:350,detail:overviewDetail(${JSON.stringify(reactor)},'low','export')})`);
  assert.match(markup, /overview-row-qty">350</);
  assert.doesNotMatch(markup, /TARGET|DEFICIT|overview-stock-reference/);
  assert.match(evaluate('telemetryPlaceholderRow()'), /STOCK UNKNOWN/i);
  console.log('Stock-only inventory, handling thresholds and input-batch references passed.');
}

function unknownTelemetry() {
  const classes = new Set();
  const ctx = vm.createContext({ console, numFormatter: new Intl.NumberFormat('de-DE'),
    document: { getElementById: () => null, querySelector: () => null, addEventListener() {} },
    telemetrySnapshot: () => ({ available: true, stale: false, detail: 'LIVE STOCK', tone: 'good' }),
    escapeHTML: value => String(value),
    els: { baseMoneyVal: node(), baseStorageVal: node(), baseHealthVal: node(),
      baseHealthCard: { classList: { add: value => classes.add(value), remove: (...values) => values.forEach(value => classes.delete(value)) } } }
  });
  ctx.window = ctx;
  ctx.els.baseMoneyVal.closest = () => null;
  run(ctx, 'js/command/config.js');
  run(ctx, 'js/shared/utils.js');
  run(ctx, 'js/data/telemetry.js');
  for (const raw of [null, undefined, '', '   ', false, true, [], {}, -1, NaN, Infinity]) {
    ctx.rhwBase = { base_money: raw, storage_free: raw, base_health: raw };
    ctx.updateBaseTelemetry();
    assert.equal(ctx.els.baseMoneyVal.textContent, '–');
    assert.equal(ctx.els.baseStorageVal.textContent, '–');
    assert.equal(ctx.els.baseHealthVal.textContent, '–');
    assert.equal(classes.size, 0, 'Unknown health must not trigger a critical-state color');
  }
  ctx.rhwBase = { money: 0, cargospace: 0, health: 0 };
  ctx.updateBaseTelemetry();
  assert.equal(ctx.els.baseMoneyVal.textContent, '$0');
  assert.equal(ctx.els.baseStorageVal.textContent, '0');
  assert.equal(ctx.els.baseHealthVal.textContent, '0%');
  assert.ok(classes.has('health-critical'), 'An explicitly reported zero remains critical');
  ctx.rhwBase = { credits: '12000', cargo_space_left: '3500', health: 24000000 };
  ctx.updateBaseTelemetry();
  assert.equal(ctx.els.baseMoneyVal.textContent, '$12.000');
  assert.equal(ctx.els.baseStorageVal.textContent, '3.500');
  assert.equal(ctx.els.baseHealthVal.textContent, '100%');
  ctx.rhwBase = { storage_free: null, base_health: null };
  ctx.updateBaseTelemetry();
  assert.equal(classes.size, 0, 'A later unknown value clears the preceding health color');
  console.log('Unknown telemetry passed: null/invalid values, real zero, legacy field aliases and health colors.');
}

(async () => { unknownTelemetry(); const recipes = await models(); overviewReferences(recipes); await serviceWorker(); await updates(); })().catch(error => { console.error(error); process.exitCode = 1; });
