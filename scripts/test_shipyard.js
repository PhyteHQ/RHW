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
const ctx = vm.createContext({ console, Map, Set, Intl, items: [],
  telemetrySnapshot: () => snapshot,
  document: { getElementById: () => null, addEventListener() {} },
  RHWV4: { state: {}, config: { storageKeys: { shipyardSelection: 'selection' },
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
  ctx.items.push({ name: 'Crew', quantity: 400 }, { nickname: 'blueprint_medium_miner', name: 'Archon Design Schematics', quantity: 1 });
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
  propulsion.quantity = 446;

  const archon = yard.selectedHull();
  assert.equal(yard.stockRecord(archon).stock, null, 'An Archon blueprint cannot be matched as a finished hull');
  const hull = { nickname: 'medium_miner_package', name: 'Modular Miner', quantity: 3 };
  ctx.items.push(hull);
  assert.equal(yard.stockRecord(archon).stock, 3);
  hull.nickname = '';
  assert.equal(yard.stockRecord(archon).stock, 3, 'Public Modular Miner name is a valid exact alias');
  hull.name = 'Archon Mining Module';
  assert.equal(yard.stockRecord(archon).stock, null, 'Substring matches cannot count a module as a hull');

  const inventoryBefore = JSON.stringify(ctx.items);
  for (const key of ['dunkirk', 'invincible', 'archon']) {
    assert.ok(yard.selectHull(key));
    const current = yard.selectedHull(), needs = yard.requirements();
    const plan = core.buildPlan({ productId: current.productId, recipeId: current.recipeId,
      quantity: 1, affiliationId: 'br_m_grp', recursive: false, useInventory: false });
    assert.equal(JSON.stringify(needs.materials), JSON.stringify(core.materialRows(plan)), 'Calculator and Shipyard have identical requirements');
    if (key !== 'archon') assert.equal(needs.materials.length, 6);
    yard.openCalculator();
    assert.equal(calculator.recipeId, current.recipeId);
    assert.equal(calculator.quantity, 1);
    assert.equal(calculator.affiliationId, 'br_m_grp');
    assert.equal(memory.get('selection'), key);
  }
  assert.equal(JSON.stringify(ctx.items), inventoryBefore, 'Ship selections never reserve or spend shared inventory');
  assert.equal(yard.selectHull('not-a-ship'), false);
  assert.equal(yard.selectedHull().key, 'archon');
  snapshot.stale = true;
  assert.equal(yard.analyze().buildable, 2);
  assert.equal(yard.analyze().snapshot.stale, true);
  snapshot.available = false;
  assert.equal(yard.analyze().buildable, null);
  assert.ok(yard.analyze().prerequisites.every(row => row.state === 'unknown'));
  snapshot.available = true;

  const recipe = core.recipe(archon.recipeId);
  recipe.inputs[0].options[0].qty = 181;
  app.lifecycle.emit('catalog:loaded', { catalog: core.state.catalog });
  assert.equal(yard.requirements().materials[0].required, 181, 'A refreshed catalog updates requirements without config changes');
  console.log('Shipyard passed: all three recipes, shared Calculator quantities, prerequisites, stock identity, unknown/stale data, selection and catalog updates.');
})().catch(error => { console.error(error); process.exitCode = 1; });
