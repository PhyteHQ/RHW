'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const memory = new Map();
const context = vm.createContext({ console, setTimeout, clearTimeout,
  location: { hash: '' }, history: { replaceState(_state, _title, hash) { context.location.hash = hash; }, pushState(_state, _title, hash) { context.location.hash = hash; } },
  navigator: { onLine: true }, addEventListener() {}, requestAnimationFrame() {},
  document: { addEventListener() {}, getElementById() { return null; }, documentElement: { dataset: {} } },
  localStorage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) }
});
context.window = context;
for (const file of ['build-info', 'core/refresh', 'core/lifecycle', 'core/routes', 'core/config', 'core/app']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), context, { filename: file });
}
const app = context.RHWV4;
const plain = value => JSON.parse(JSON.stringify(value));
const model = require('./app-routes.json');
assert.deepEqual(plain(app.config.routes), model.routes);
assert.ok(Object.isFrozen(app.config.routes.command));
assert.equal(app.state.commandNode, 'inventory');
assert.equal(Object.values(model.routes).flat().length, 9);
for (const [workspace, nodes] of Object.entries(model.routes)) {
  for (const node of nodes) {
    context.location.hash = `#${workspace}/${node}`;
    assert.deepEqual(plain(app.route.parse()), { workspace, node });
  }
  context.location.hash = `#${workspace}/missing`;
  assert.equal(app.route.parse().node, nodes[0]);
}
for (const [old, target] of Object.entries(model.legacyRedirects)) {
  context.location.hash = '#' + old;
  const [workspace, node] = target.split('/');
  assert.deepEqual(plain(app.route.parse()), { workspace, node }, old);
}
app.store.set(app.config.storageKeys.commandNode, 'overview');
assert.equal(app.workspaceStoredNode('command'), 'inventory', 'Old saved routes must normalize without a later patch');
app.route.write('command', 'overview');
assert.equal(context.location.hash, '#command/inventory');
app.store.set(app.config.storageKeys.calculatorState, { quantity: 8, materialPrices: { ore: 10 } });
assert.deepEqual(plain(app.store.get(app.config.storageKeys.calculatorState)), { quantity: 8 });
app.store.set(app.config.storageKeys.calculatorPriceProfiles, [{ prices: { ore: 0 } }]);
assert.equal(app.store.get(app.config.storageKeys.calculatorPriceProfiles)[0].prices.ore, 0);
assert.match(app.config.forum.logoUrl, /^https:\/\//, 'Exported forum images need a public URL');
assert.equal(app.config.forum.previewLogoUrl, './assets/rhw-forum-logo.png');

const lifecycle = context.createRhwLifecycle();
const calls = [];
const off = lifecycle.on('ready', 'later', 20, data => { calls.push('later:' + data.node); });
lifecycle.on('ready', 'first', 10, data => { calls.push('first:' + data.node); });
assert.throws(() => lifecycle.on('ready', 'first', 10, () => {}), /Duplicate/);
lifecycle.emit('ready', { node: 'inventory' });
assert.deepEqual(calls, ['first:inventory', 'later:inventory']);
off(); lifecycle.emit('ready', { node: 'forum' });
assert.equal(calls.at(-1), 'first:forum');
assert.equal(lifecycle.describe()[0].hooks.length, 1);
lifecycle.on('error', 'failing-hook', 10, () => { throw new Error('visible failure'); });
assert.throws(() => lifecycle.emit('error'), /visible failure/, 'Boot must not silently pass a failed hook');
console.log('App contracts passed: nine routes, legacy redirects, stored defaults, session-only prices, forum URLs and ordered lifecycle hooks.');
