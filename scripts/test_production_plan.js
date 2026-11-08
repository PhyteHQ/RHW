#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), zlib = require('node:zlib'), path = require('node:path');
const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Map, Set, Intl,
  RHWV4: { state: {}, config: { operations: { defaultAffiliation: 'br_m_grp' } } } });
ctx.window = ctx;
const run = file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
run('js/command/config.js');
vm.runInContext('const PRODUCTION_MODULES=DASHBOARD_CONFIG.productionModules;', ctx);
run('js/core/lifecycle.js'); ctx.RHWV4.lifecycle = ctx.createRhwLifecycle();
run('js/calculator/model.js'); run('js/calculator/catalog.js');
run('js/command/production-model.js'); run('js/command/production-volumes.js');
for (let i=1; i<=6; i++) run(`assets/recipes/catalog-v1-part-${String(i).padStart(2,'0')}.js`);
ctx.__RHW_RECIPE_CATALOG__ = JSON.parse(zlib.gunzipSync(Buffer.from(ctx.__RHW_RECIPE_CATALOG_GZIP_BASE64__, 'base64')));
(async () => {
  const model = ctx.RHWV4.production;
  assert.equal(model.cycleSeconds('recipe_milsal'), null, 'Unavailable recipes have no guessed timing');
  await ctx.RHWV4.operationsCore.loadCatalog();
  assert.equal(model.recipes().length, 7);
  assert.equal(model.cycleSeconds('recipe_milsal'), 7500, 'PC uses the general MS volume, never a hauler override');
  assert.equal(model.cycleSeconds('recipe_weapon_part_focusing_chamber'), 1800);
  assert.equal(model.cycleSeconds('ship_part_reactor'), 120);
  assert.equal(model.cycleSeconds('recipe_scrap_advanced'), 925 / 8 * 60);
  assert.equal(model.cycleSeconds('recipe_gold_advanced'), 1300 / 85 * 60);
  assert.equal(model.cycleSeconds('not-a-recipe'), null);
  const volumes = ctx.RHW_PRODUCTION_VOLUMES;
  ctx.RHW_PRODUCTION_VOLUMES = {};
  assert.equal(model.cycleSeconds('recipe_milsal'), null, 'Missing volume is unknown rather than zero time');
  ctx.RHW_PRODUCTION_VOLUMES = volumes;
  assert.equal(model.cycleSeconds('recipe_milsal'), 7500);
  console.log('Production capacity passed: seven independent recipes, reference times, general volumes and unknown data.');
})().catch(error => { console.error(error); process.exitCode = 1; });
