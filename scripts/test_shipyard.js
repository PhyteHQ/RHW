#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const root = path.join(__dirname, '..');
const memory = new Map();
const snapshot = { available: true, stale: false };
let calculator;
const ctx = vm.createContext({ console, Map, Set, Intl, items: [], els: { shipyardControl: null },
  telemetrySnapshot: () => snapshot,
  document: { getElementById: () => null, addEventListener() {} },
  RHWV4: { state: {}, config: { storageKeys: { shipyardSelection: 'selection', shipyardDivisions: 'divisions' },
    operations: { defaultAffiliation: 'br_m_grp' } },
    store: { get: (key, fallback) => memory.get(key) ?? fallback, set: (key, value) => memory.set(key, value) },
    operations: { openSelection: value => { calculator = value; } }
  }
});
ctx.window = ctx;
const run = file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
run('js/command/config.js');
vm.runInContext('const CAPITAL_SHIPYARD = DASHBOARD_CONFIG.capitalShipyard;', ctx);
run('js/shared/utils.js');
run('js/command/shipyard.js');
run('js/core/lifecycle.js');
ctx.RHWV4.lifecycle = ctx.createRhwLifecycle();
run('js/calculator/model.js');
run('js/calculator/catalog.js');
run('js/command/shipyard-model.js');
for (let i = 1; i <= 6; i++) run(`assets/recipes/catalog-v1-part-${String(i).padStart(2, '0')}.js`);
ctx.__RHW_RECIPE_CATALOG__ = JSON.parse(zlib.gunzipSync(Buffer.from(ctx.__RHW_RECIPE_CATALOG_GZIP_BASE64__, 'base64')));

(async () => {
  const app = ctx.RHWV4, yard = app.shipyard, core = app.operationsCore;
  assert.equal(yard.selectedHull().key, 'archon');
  assert.equal(yard.analyze().recipeReady, false, 'No fallback requirements while the catalog is unavailable');
  await core.loadCatalog();
  const needs = yard.requirements();
  assert.deepEqual(Array.from(needs.materials, row => row.required), [180, 138, 223, 197, 205]);
  assert.ok(!needs.materials.some(row => row.name === 'Exotic Systems'));
  assert.deepEqual(Array.from(needs.prerequisites, row => [row.id, row.qty]), [['commodity_crew', 400], ['blueprint_medium_miner', 1]]);
  assert.equal(needs.recipe.restricted, false, 'RHW uses the civilian Archon recipe with its blueprint');
  assert.equal(yard.analyze().buildable, null, 'Missing inventory is unknown, not zero');

  ctx.items = needs.materials.map(row => ({ nickname: row.id, name: row.name, quantity: row.required * 2 }));
  ctx.items.push({ name: 'Crew', quantity: 1600 }, { nickname: 'blueprint_medium_miner', name: 'Archon Design Schematics', quantity: 1 });
  let result = yard.analyze();
  assert.equal(result.buildable, 2);
  assert.equal(result.nextHull, 3);
  assert.deepEqual(Array.from(result.materials, row => row.gap), [180, 138, 223, 197, 205]);
  assert.ok(result.prerequisites.every(row => row.state === 'ok'), 'Reusable prerequisites do not scale with hull count');
  const propulsion = ctx.items.find(item => item.name === 'Propulsion Systems');
  propulsion.quantity = 445;
  result = yard.analyze();
  assert.equal(result.buildable, 1);
  assert.equal(result.bottleneck.name, 'Propulsion Systems');
  assert.equal(result.bottleneck.gap, 1);
  assert.equal(result.materials.filter(row => row.gap > 0).length, 1);
  propulsion.quantity = 0;
  assert.equal(yard.analyze().buildable, 0, 'Explicit zero remains a known stock count');
  propulsion.quantity = null;
  assert.equal(yard.analyze().buildable, null, 'Null quantity is not a known zero');
  for (const invalid of [false, true, [], {}, '   ']) {
    propulsion.quantity = invalid;
    assert.equal(yard.analyze().buildable, null, 'Invalid stock values must not become a build count');
  }
  propulsion.quantity = 446;

  const archon = yard.selectedHull();
  assert.equal(yard.stockRecord(archon).stock, null, 'An Archon blueprint cannot be matched as a finished hull');
  const hull = { nickname: 'medium_miner_package', name: 'Modular Miner', quantity: 3 };
  ctx.items.push(hull);
  assert.equal(yard.stockRecord(archon).stock, 3);
  hull.nickname = '';
  assert.equal(yard.stockRecord(archon).stock, 3, 'Public Modular Miner name is a valid exact alias');
  hull.name = '"Archon" Modular Miner';
  assert.equal(yard.stockRecord(archon).stock, 3, 'The full public quoted ship name resolves without a nickname');
  hull.name = 'Archon Mining Module';
  assert.equal(yard.stockRecord(archon).stock, null, 'Substring matches cannot count a module as a hull');

  const inventoryBefore = JSON.stringify(ctx.items);
  const hulls = vm.runInContext('CAPITAL_SHIPYARD.hulls', ctx);
  assert.equal(hulls.length, 9);
  assert.ok(hulls.some(hull => hull.recipeId === 'ship_assembly_cv_cruiser'), 'The restored Civilian Cruiser recipe is available in Shipyard');
  assert.deepEqual(['naval', 'mining', 'civilian'].map(key => hulls.filter(h=>h.division===key).length), [2, 2, 5]);
  for (const { key } of hulls) {
    assert.ok(yard.selectHull(key));
    const current = yard.selectedHull(), needs = yard.requirements();
    const plan = core.buildPlan({ productId: current.productId, recipeId: current.recipeId,
      quantity: 1, affiliationId: 'br_m_grp', recursive: false, useInventory: false });
    assert.equal(JSON.stringify(needs.materials), JSON.stringify(core.materialRows(plan)), 'Calculator and Shipyard have identical requirements');
    assert.ok(needs.materials.length > 0);
    yard.openCalculator();
    assert.equal(calculator.recipeId, current.recipeId);
    assert.equal(calculator.quantity, 1);
    assert.equal(calculator.affiliationId, 'br_m_grp');
    assert.equal(memory.get('selection'), key);
  }
  assert.equal(JSON.stringify(ctx.items), inventoryBefore, 'Ship selections never reserve or spend shared inventory');

  yard.selectHull('civilian-cruiser');
  const cruiser = yard.selectedHull(), cruiserNeeds = yard.requirements();
  assert.equal(yard.selectedDivision().key, 'civilian');
  assert.equal(cruiserNeeds.recipe.restricted, false);
  assert.deepEqual(Array.from(cruiserNeeds.materials, row => [row.id, row.required]), [
    ['commodity_ship_part_avionics', 300], ['commodity_ship_part_interior', 300],
    ['commodity_ship_part_propulsion', 300], ['commodity_ship_part_superstructure', 300],
    ['commodity_ship_part_reactor', 300], ['commodity_ship_part_exotic', 30]
  ]);
  assert.deepEqual(Array.from(cruiserNeeds.prerequisites, row => [row.id, row.qty]), [['commodity_crew', 400]]);
  const savedItems = ctx.items;
  ctx.items = cruiserNeeds.materials.map(row => ({ nickname: row.id, name: row.name,
    quantity: row.id === 'commodity_ship_part_exotic' ? 59 : row.required * 2 }));
  ctx.items.push({ name: 'Crew', quantity: 400 });
  const cruiserAnalysis = yard.analyze();
  assert.equal(cruiserAnalysis.buildable, 1);
  assert.equal(cruiserAnalysis.bottleneck.id, 'commodity_ship_part_exotic');
  assert.equal(cruiserAnalysis.bottleneck.gap, 1);
  assert.equal(cruiserAnalysis.prerequisites[0].state, 'ok');
  const cruiserStock = { nickname: 'cv_cruiser_package', name: 'Civilian Escort Cruiser', quantity: 2 };
  ctx.items.push(cruiserStock);
  assert.equal(yard.stockRecord(cruiser).stock, 2, 'The exact recipe package identifies the finished cruiser');
  cruiserStock.nickname = 'cv_cruiser'; cruiserStock.name = '';
  assert.equal(yard.stockRecord(cruiser).stock, 2, 'The ship API code identifies the same cruiser');
  cruiserStock.nickname = '';
  for (const name of ['Civilian Cruiser', 'Civilian Escort Cruiser']) {
    cruiserStock.name = name;
    assert.equal(yard.stockRecord(cruiser).stock, 2, 'Both exact public names identify the finished cruiser');
  }
  cruiserStock.name = 'Civilian Escort Cruiser Blueprint';
  assert.equal(yard.stockRecord(cruiser).stock, null, 'A similarly named blueprint is not a finished cruiser');
  ctx.items = savedItems;

  assert.equal(yard.selectHull('not-a-ship'), false);
  assert.ok(yard.selectHull('archon'));
  assert.equal(yard.selectedDivision().key, 'mining');
  yard.selectDivision('civilian'); yard.selectHull('halberd');
  yard.selectDivision('naval'); yard.selectHull('invincible');
  yard.selectDivision('civilian'); assert.equal(yard.selectedHull().key, 'halberd', 'Remember the last hull per division');
  assert.equal(yard.selectDivision('invalid'), false);
  yard.selectHull('archon');
  assert.equal(yard.selectedHull().key, 'archon');
  snapshot.stale = true;
  assert.equal(yard.analyze().buildable, 2);
  assert.equal(yard.analyze().snapshot.stale, true);
  snapshot.available = false;
  assert.equal(yard.analyze().buildable, null);
  assert.ok(yard.analyze().prerequisites.every(row => row.state === 'unknown'));
  snapshot.available = true;

  snapshot.stale = false;
  assert.equal(yard.analyze().prerequisites.find(r => r.id === 'commodity_crew').stock, 1600, 'Recipe prerequisites use reported stock');
  assert.equal(JSON.stringify(ctx.items), inventoryBefore, 'Ship browsing never changes inventory');
  memory.set('selection', 'halberd'); memory.set('divisions', { civilian: 'barge' }); yard.restoreSelection();
  assert.equal(yard.selectedHull().key, 'halberd');
  yard.selectDivision('mining'); yard.selectDivision('civilian'); assert.equal(yard.selectedHull().key, 'barge');
  yard.selectHull('archon');

  const recipe = core.recipe(archon.recipeId);
  recipe.inputs[0].options[0].qty = 181;
  app.lifecycle.emit('catalog:loaded', { catalog: core.state.catalog });
  assert.equal(yard.requirements().materials[0].required, 181, 'A refreshed catalog updates requirements without config changes');
  console.log('Shipyard passed: current hulls, exact recipes, division memory, reported prerequisites and missing data.');
})().catch(error => { console.error(error); process.exitCode = 1; });
