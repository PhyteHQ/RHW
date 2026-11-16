'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let snapshot = { available: true, stale: false }, assets = [], production = [], yard = null;
const app = {
  util: { normalize: value => String(value).trim().toLowerCase(), number: value => String(value), escape: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;') },
  lifecycle: { emit() {} }, shipyard: { analyze: () => yard }
};
const ctx = vm.createContext({ RHWV4: app, DASHBOARD_CONFIG: { alerts: { food: { type: 'min', yellow: 100 } } },
  telemetrySnapshot: () => snapshot, operationalItems: () => assets, commodityKey: item => item.name.toLowerCase(),
  assetRoles: item => [item.role], stateForRole: item => item.state, displayName: item => item.name,
  overviewDetail: item => item.detail || 'Reserve low', firstFiniteApiStockValue: item => item.quantity,
  productionRecipes: () => production, analyzeRecipe: recipe => recipe,
  document: { body: { dataset: {} }, querySelectorAll: () => [] }
});
ctx.window = ctx;
vm.runInContext(fs.readFileSync(__dirname + '/../js/command/navigation.js', 'utf8'), ctx);
const tasks = () => app.command.priorityActions();
assets = [{ name: 'Export', role: 'export', state: 'critical', quantity: 0 },
  { name: 'Food', role: 'maintenance', state: 'critical', quantity: 10 }];
assert.equal(tasks()[0].title, 'Food', 'Facility supply risks outrank optional business goals');
assert.equal(tasks()[0].state, 'critical');
assert.equal(tasks()[0].quantity, 90);
assert.equal(tasks()[1].state, 'advisory', 'Low exports do not imply a facility emergency');

assets = [{ name: 'Superstructure Systems', role: 'export', state: 'critical', quantity: 110 }];
yard = { buildable: 0, nextHull: 1, hull: { label: 'Archon' }, bottleneck: { name: 'Superstructure Systems', gap: 87 } };
let combined = tasks();
assert.equal(combined.length, 1, 'Export and shipbuilding share one restock task');
assert.equal(combined[0].state, 'advisory');
assert.equal(combined[0].quantity, 87);
assert.deepEqual(Array.from(combined[0].nodes), ['shipyard', 'inventory']);
assert.equal(combined[0].effects.length, 2);

assets = []; yard = null;
production = [{ product: 'Chambers', cardState: 'critical', possibleCycles: 0, nextCycleGap: 50, bottleneck: { name: 'Gold' } },
  { product: 'Reactors', cardState: 'critical', possibleCycles: 0, nextCycleGap: 80, bottleneck: { name: 'Gold' } }];
production.forEach(recipe => { recipe.recipe = { product: recipe.product }; });
const before = JSON.stringify(production);
combined = tasks();
assert.equal(combined.length, 1);
assert.equal(combined[0].quantity, 80, 'Independent coverage gaps are not added and do not promise simultaneous jobs');
assert.equal(combined[0].effects.length, 2);
assert.equal(JSON.stringify(production), before, 'Summaries never spend or mutate stock');
production = [{ cardState: 'waiting', possibleCycles: null, nextCycleGap: null }];
assert.equal(tasks().length, 0, 'Unknown inputs are not fabricated as a zero-stock deficit');

snapshot = { available: false, label: 'UNAVAILABLE' };
assert.equal(tasks().length, 1);
assert.equal(tasks()[0].action, 'connection');
assert.doesNotMatch(tasks()[0].title, /stable|good|ready/i);
snapshot = { available: true, stale: true, detail: 'Saved 10:00' };
assert.equal(tasks()[0].label, 'Saved data', 'Saved inventory is explicitly identified before acting on it');
const html = app.command.priorityMarkup({ state: 'advisory', node: 'production', title: '<ore>', meta: '', supply: 'Gold', quantity: 80 });
assert.match(html, /&lt;ore>/);
assert.match(html, /data-supply-quantity="80"/);
console.log('Overview priorities passed: supply urgency, grouped material causes, independent gaps, unknown/cached stock and exact restock actions.');
