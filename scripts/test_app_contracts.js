'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const memory = new Map();
const context = vm.createContext({ console, setTimeout, clearTimeout,
  location: { hash: '' }, history: { replaceState(_state, _title, hash) { context.location.hash = hash; }, pushState(_state, _title, hash) { context.location.hash = hash; } },
  navigator: { onLine: true }, addEventListener() {}, requestAnimationFrame() {},
  document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, documentElement: { dataset: {} } },
  localStorage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) }
});
context.window = context;
for (const file of ['build-info', 'core/refresh', 'core/lifecycle', 'core/routes', 'core/config', 'core/app',
  'data/storage', 'forum/composer']) {
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
context.document.body = { dataset: {} };
app.command = { activate(node) { app.state.commandNode = node; } };
app.operations = { activate(node) { app.state.operationsNode = node; } };
app.store.set(app.config.storageKeys.activeWorkspace, 'operations');
app.store.set(app.config.storageKeys.commandNode, 'production');
context.location.hash = '';
app.applyRoute();
assert.equal(app.state.activeWorkspace, 'command', 'Opening the root URL starts with the daily POB overview');
assert.equal(app.state.commandNode, 'inventory');
assert.equal(context.location.hash, '#command/inventory');
context.location.hash = '#operations/calculator';
app.applyRoute();
assert.equal(app.state.activeWorkspace, 'operations', 'Explicit bookmarks and tool links keep their destination');
app.store.set(app.config.storageKeys.calculatorState, { quantity: 8, materialPrices: { ore: 10 },
  materialPriceSources: { ore: { kind: 'rhw', price: 10 } }, altSelections: { 'recipe:1': 'ore' } });
assert.deepEqual(plain(app.store.get(app.config.storageKeys.calculatorState)), { quantity: 8 });
app.store.set(app.config.storageKeys.calculatorPriceProfiles, [{ prices: { ore: 0 } }]);
assert.equal(app.store.get(app.config.storageKeys.calculatorPriceProfiles)[0].prices.ore, 0);
assert.match(app.config.forum.logoUrl, /^https:\/\//, 'Exported forum images need a public URL');
assert.equal(app.config.forum.previewLogoUrl, './assets/rhw-forum-logo.png');
assert.equal(app.config.forum.footerUrl, 'https://phytehq.github.io/RHW/assets/rhw-forum-footer.png');
assert.equal(app.config.forum.previewFooterUrl, './assets/rhw-forum-footer.png');

const official = app.comms.buildBbcode(app.storage.defaultState());
assert.match(official, /^\[align=center\]\[img=240x299\]/);
assert.ok(official.includes('[color=#CDD4DC]HEAVY WORKS') && official.includes('Under the Crown. For the Crown.'));
assert.ok(official.includes('Official Corporate Correspondence') && official.includes('OFFICE OF THE CHIEF EXECUTIVE'));
assert.ok(official.includes('[color=#80AAD8]REGARDING') && official.includes('UNTITLED CORRESPONDENCE'));
assert.ok(official.includes('Chief Executive Officer') && official.includes('Industry in Service of the Crown.'));
assert.ok(official.includes('SECURE TRANSMISSION · RES OFFICIAL[br][RES] SYSTEM TIME: UNSET'));

const legacy = app.storage.normalizeState({
  classification: 'RHW OFFICIAL', footerMotto: 'CONNECTION SECURE /// BUILT IN BRETONIA - BUILT FOR THE CROWN',
  message: 'Previously saved body'
});
assert.equal(legacy.classification, 'RES OFFICIAL');
assert.equal(legacy.footerMotto, 'Industry in Service of the Crown.');
assert.equal(legacy.message, 'Previously saved body');
const longRecipient = 'Admiralty Procurement, Civil Docking and Shipyard Liaison Office';
const custom = app.storage.normalizeState({
  senderKey: '__custom__', customSenderName: 'Custom Sender', signatureTitle: 'Docking Officer',
  footerMotto: 'Custom footer line', classification: 'CROWN RESTRICTED', recipient: longRecipient
});
const customCode = app.comms.buildBbcode(custom);
assert.ok(customCode.includes(longRecipient) && customCode.includes('Custom Sender') && customCode.includes('Docking Officer'));
assert.ok(customCode.includes('Custom footer line') && customCode.includes('SECURE TRANSMISSION · CROWN RESTRICTED'));

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
