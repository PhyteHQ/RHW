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
  RHWV4: { state: {}, config: { storageKeys: { shipyardSelection: 'selection', shipyardDivisions: 'divisions', personnelPlan: 'personnel' },
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
run('js/command/personnel-model.js');
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
  ctx.items.push({ name: 'Crew', quantity: 1200 }, { nickname: 'blueprint_medium_miner', name: 'Archon Design Schematics', quantity: 1 });
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
  const staff = app.personnel;
  const total = () => staff.analyze().resources.map(r=>r.required);
  assert.deepEqual(Array.from(total()), [800, 0], 'Core 4 reserves 800 Crew with all jobs off');
  staff.setModule('refinery', { enabled: true });
  staff.setModule('smelter', { enabled: true });
  staff.setModule('foundry', { enabled: true });
  staff.setModule('shipyard', { enabled: true, recipeId: 'ship_part_reactor' });
  assert.deepEqual(Array.from(total()), [1400, 200], 'Concurrent recipes add their catalysts beyond the core reservation');
  staff.setStock('crew', 1600); staff.setStock('scientists', 100);
  const preview = staff.forRecipe(core.recipe(archon.recipeId));
  assert.equal(preview[0].total, 1600, 'A ship preview replaces the shipyard job, rather than double counting it');
  assert.equal(preview[0].free, 400);
  assert.equal(preview[0].gap, 0);
  assert.equal(yard.analyze().prerequisites.find(r=>r.id==='commodity_crew').state, 'ok');
  staff.setStock('crew', 1599);
  assert.equal(yard.analyze().prerequisites.find(r=>r.id==='commodity_crew').state, 'critical');
  assert.equal(staff.forRecipe(core.recipe(archon.recipeId))[0].gap, 1);
  assert.equal(staff.setModule('refinery', { recipeId: 'ship_part_reactor' }), false, 'Reject a recipe from another physical module');
  staff.setModule('refinery', { recipeId: 'recipe_niobium_advanced' });
  assert.deepEqual(Array.from(total()), [1400, 200], 'Changing one refinery recipe never adds a second refinery');
  staff.setStock('crew', 0); assert.equal(staff.analyze().resources[0].gap, 1400);
  for (const invalid of [-1, 1.5, true, [], {}, 'broken']) assert.equal(staff.setStock('crew', invalid), false);
  staff.setStock('crew', ''); assert.equal(staff.analyze().resources[0].source, 'LIVE');
  snapshot.stale = true; assert.equal(staff.analyze().resources[0].source, 'CACHED'); snapshot.stale = false;
  snapshot.available = false;
  assert.equal(staff.analyze().resources[0].gap, null, 'Unreported stock does not become a known shortage');
  staff.setStock('crew', 0); assert.equal(staff.analyze().resources[0].source, 'MANUAL', 'Manual stock remains usable offline');
  snapshot.available = true;
  const foundryRecipe = core.recipe('recipe_weapon_part_focusing_chamber');
  core.state.recipesById.delete(foundryRecipe.id);
  // Removing an enabled recipe from the catalog must not silently assume zero staff.
  const oldRecipes = core.state.catalog.recipes;
  core.state.catalog.recipes = oldRecipes.filter(r=>r.id !== foundryRecipe.id);
  assert.equal(staff.analyze().complete, false);
  assert.equal(staff.analyze().resources[0].required, null);
  core.state.catalog.recipes = oldRecipes; core.state.recipesById.set(foundryRecipe.id, foundryRecipe);
  assert.equal(JSON.stringify(ctx.items), inventoryBefore, 'Planning never consumes or changes the inventory');
  memory.set('personnel', { stock: { crew: 1800 }, modules: { foundry: { enabled: true, recipeId: foundryRecipe.id } } });
  staff.restore();
  assert.deepEqual(Array.from(total()), [1000, 100], 'Imported local plans restore through the same validation');
  assert.equal(staff.analyze().resources[0].amount, 1800);
  memory.set('selection', 'halberd'); memory.set('divisions', { civilian: 'barge' }); yard.restoreSelection();
  assert.equal(yard.selectedHull().key, 'halberd');
  yard.selectDivision('mining'); yard.selectDivision('civilian'); assert.equal(yard.selectedHull().key, 'barge');
  yard.selectHull('archon');

  const recipe = core.recipe(archon.recipeId);
  recipe.inputs[0].options[0].qty = 181;
  app.lifecycle.emit('catalog:loaded', { catalog: core.state.catalog });
  assert.equal(yard.requirements().materials[0].required, 181, 'A refreshed catalog updates requirements without config changes');
  console.log('Shipyard and personnel passed: nine hulls, division memory, exact recipes, core reservation, additive concurrent staffing, ship preview, manual/API provenance and missing data.');
})().catch(error => { console.error(error); process.exitCode = 1; });
