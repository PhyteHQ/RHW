'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const values = new Map();
let rejectWrite = false;
const app = {config: {storageKeys: {productionOrders: 'archive'}, operations: {defaultAffiliation: 'br_m_grp'}},
  util: {uid: () => 'generated'},
  store: {get: (key, fallback) => values.get(key) || fallback,
    set: (key, value) => { if (rejectWrite) return false; values.set(key, value); return true; }}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/data/legacy-archive.js'), 'utf8'), {window: {RHWV4: app}});
const api = app.legacyArchive;
const row = (id, updatedAt) => ({id, productId: 'gold', recipeId: 'gold-basic', quantity: 100, createdAt: 1, updatedAt});
values.set('archive', [row('existing', 20)]);
api.importOrders([row('existing', 10), row('incoming', 30)]);
assert.equal(api.snapshot().length, 2);
assert.equal(api.snapshot().find(r => r.id === 'existing').updatedAt, 20);
api.importOrders([{...row('existing', 40), quantity: 500}]);
assert.equal(api.snapshot().find(r => r.id === 'existing').quantity, 500);
const before = JSON.stringify(values.get('archive'));
assert.throws(() => api.prepareImport(Array.from({length: 101}, (_, i) => row('extra-' + i, 1))), /100/);
assert.equal(JSON.stringify(values.get('archive')), before, 'Oversized backup must not change the archive');
rejectWrite = true;
assert.throws(() => api.importOrders([row('not-saved', 50)]), /NOT SAVED/);
assert.equal(JSON.stringify(values.get('archive')), before, 'Failed persistence must leave existing data intact');
assert.equal(app.productionOrders, undefined, 'Archive must not bring back the retired board');
console.log('Legacy archive passed: conflict-safe merge, capacity gate, failed-write preservation and no board.');
