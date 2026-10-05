#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const keys = {
  activeWorkspace: 'workspace', commandNode: 'command-node', inventoryView: 'inventory-view',
  operationsNode: 'operations-node', commsNode: 'comms-node', tickerComposer: 'ticker', shipyardSelection: 'shipyard-selection',
  commsMobileView: 'comms-mobile-view', calculatorPriceProfiles: 'price-profiles',
  productionOrders: 'production-orders', shipyardPlanner: 'shipyard-planner',
  commsCurrent: 'comms-current', commsDrafts: 'comms-drafts', localSenders: 'local-senders',
  newswireManagerDraft: 'newswire-draft'
};
const memory = new Map();
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
let uid = 0;

const app = {
  version: 'V4.0.2',
  config: {
    storageKeys: keys,
    senders: [{ key: 'built-in', name: 'Built In', title: 'Officer', location: 'New London', encryption: 'TEST' }],
    templates: [{ key: 'official', recipient: '', encryption: 'TEST', classification: 'RHW OFFICIAL', salutation: 'Hello,', closing: 'Regards,' }],
    forum: { footerMotto: 'TEST MOTTO' }
  },
  state: { localSenders: [], drafts: [], comms: null },
  util: {
    uid: prefix => `${prefix}-${++uid}`,
    normalize: value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
  },
  template: () => ({ key: 'official', classification: 'RHW OFFICIAL', salutation: 'Hello,', closing: 'Regards,' }),
  store: {
    get: (key, fallback = null) => memory.has(key) ? clone(memory.get(key)) : fallback,
    set: (key, value) => { memory.set(key, clone(value)); return true; }
  }
};

function mergeOrders(incoming) {
  const merged = new Map((memory.get(keys.productionOrders) || []).map(order => [order.id, order]));
  incoming.forEach(order => {
    const current = merged.get(order.id);
    if (!current || Number(order.updatedAt || 0) >= Number(current.updatedAt || 0)) merged.set(order.id, clone(order));
  });
  memory.set(keys.productionOrders, [...merged.values()]);
}

app.legacyArchive = {
  snapshot: () => clone(memory.get(keys.productionOrders) || []),
  prepareImport: () => {},
  importOrders: incoming => mergeOrders(incoming)
};

global.window = { RHWV4: app };
require(path.join(__dirname, '..', 'js', 'data', 'storage.js'));

app.storage.init();
assert.ok(app.storage.inspectPayload, 'Transfer payload inspector must register');

app.state.localSenders = [{ key: 'sender-a', name: 'Local A', title: '', organisation: '', location: '', encryption: '' }];
app.state.drafts = [{ id: 'draft-a', name: 'Local Draft', updatedAt: 10, state: app.storage.defaultState() }];
app.state.comms = { ...app.storage.defaultState(), subject: 'KEEP LOCAL CURRENT' };
memory.set(keys.localSenders, clone(app.state.localSenders));
memory.set(keys.commsDrafts, clone(app.state.drafts));
memory.set(keys.commsCurrent, clone(app.state.comms));
memory.set(keys.calculatorPriceProfiles, [{ id: 'prices-a', name: 'Local Prices', updatedAt: 20 }]);
memory.set(keys.shipyardPlanner, { target: 'local-plan' });
memory.set(keys.newswireManagerDraft, { source: 'LOCAL NEWSWIRE' });
memory.set(keys.productionOrders, [{ id: 'order-a', quantity: 1, updatedAt: 20 }]);
memory.set(keys.activeWorkspace, 'command');
memory.set(keys.shipyardSelection, 'archon');

const exported = app.storage.exportPayload();
assert.equal(exported.version, 5, 'New private backups must use format V5');
assert.equal(exported.preferences.shipyardSelection, 'archon');
exported.current.subject = 'DETACHED EXPORT MUTATION';
assert.equal(app.state.comms.subject, 'KEEP LOCAL CURRENT', 'Exported backup must be detached from live app state');
const inspection = app.storage.inspectPayload(exported);
assert.equal(inspection.version, 5);
assert.ok(inspection.containsPrivateContent, 'Inspector must flag private authoring content');
assert.ok(inspection.availableSections.includes('drafts'));
assert.ok(inspection.availableSections.includes('productionOrders'));

const incoming = clone(exported);
incoming.current.subject = 'REMOTE CURRENT';
incoming.drafts = [
  { ...incoming.drafts[0], name: 'Newer Remote Draft', updatedAt: 50 },
  { id: 'draft-b', name: 'Remote Draft B', updatedAt: 40, state: app.storage.defaultState() }
];
incoming.localSenders.push({ key: 'sender-b', name: 'Remote B', title: '', organisation: '', location: '', encryption: '' });
incoming.priceProfiles = [
  { id: 'prices-a', name: 'Older Remote Prices', updatedAt: 5 },
  { id: 'prices-b', name: 'Remote Prices B', updatedAt: 40 }
];
incoming.productionOrders = [
  { id: 'order-a', quantity: 9, updatedAt: 5 },
  { id: 'order-b', quantity: 2, updatedAt: 40 }
];
incoming.shipyardPlanner = { target: 'remote-plan' };
incoming.newswireDraft = { source: 'REMOTE NEWSWIRE' };
incoming.preferences = { activeWorkspace: 'comms', shipyardSelection: 'invincible' };

const mergeResult = app.storage.importPayload(incoming, {
  sections: ['drafts', 'senders', 'priceProfiles', 'productionOrders']
});
assert.deepEqual(mergeResult.selectedSections, ['drafts', 'senders', 'priceProfiles', 'productionOrders']);
assert.equal(app.state.drafts.length, 2, 'Draft import must merge instead of deleting local drafts');
assert.equal(app.state.drafts.find(draft => draft.id === 'draft-a').name, 'Newer Remote Draft', 'Newer draft must win by id');
assert.equal(app.state.localSenders.length, 2, 'Sender import must merge');
assert.equal(memory.get(keys.calculatorPriceProfiles).find(profile => profile.id === 'prices-a').name, 'Local Prices', 'Older remote price profile must not overwrite a newer local profile');
assert.equal(memory.get(keys.calculatorPriceProfiles).length, 2, 'Price profiles must merge');
assert.equal(memory.get(keys.productionOrders).find(order => order.id === 'order-a').quantity, 1, 'Older remote order must not overwrite a newer local order');
assert.equal(memory.get(keys.productionOrders).length, 2, 'Production orders must merge');
assert.equal(app.state.comms.subject, 'KEEP LOCAL CURRENT', 'Unselected current message must remain untouched');
assert.deepEqual(memory.get(keys.shipyardPlanner), { target: 'local-plan' }, 'Unselected planner must remain untouched');
assert.deepEqual(memory.get(keys.newswireManagerDraft), { source: 'LOCAL NEWSWIRE' }, 'Unselected Newswire work must remain untouched');
assert.equal(memory.get(keys.activeWorkspace), 'command', 'Unselected preferences must remain untouched');
assert.equal(memory.get(keys.shipyardSelection), 'archon');

app.storage.importPayload(incoming, { sections: ['current', 'shipyardPlanner', 'newswireDraft', 'preferences'] });
assert.equal(app.state.comms.subject, 'REMOTE CURRENT', 'Selected current message may be replaced');
assert.deepEqual(memory.get(keys.shipyardPlanner), { target: 'remote-plan' });
assert.deepEqual(memory.get(keys.newswireManagerDraft), { source: 'REMOTE NEWSWIRE' });
assert.equal(memory.get(keys.activeWorkspace), 'comms');
assert.equal(memory.get(keys.shipyardSelection), 'invincible', 'Ship selection travels with selected app settings');

assert.throws(() => app.storage.inspectPayload({ format: 'rhw-webapp-local-cache', version: 99 }), /UNSUPPORTED CACHE FILE/);

console.log('Transfer Center tests passed: V4 inspection, selective import, safe merge and explicit replacement.');

// An order-capacity rejection must happen before other selected sections mutate.
const beforeRejectedImport = JSON.stringify({ state: app.state, memory: [...memory] });
app.legacyArchive.prepareImport = () => { throw new Error('LIMIT 100'); };
assert.throws(() => app.storage.importPayload(incoming, { sections: ['drafts', 'senders', 'productionOrders'] }), /LIMIT 100/);
assert.equal(JSON.stringify({ state: app.state, memory: [...memory] }), beforeRejectedImport);

// Quota/blocked-storage failures must not replace or remove a saved draft/profile.
const write = app.store.set;
app.store.set = () => false;
const draftsBefore = JSON.stringify(app.state.drafts);
const sendersBefore = JSON.stringify(app.state.localSenders);
const diskBefore = JSON.stringify([...memory]);
assert.equal(app.storage.saveDraft({ ...app.state.comms, message: 'Unsaved replacement' }, app.state.drafts[0].name), null);
assert.equal(app.storage.saveDraft(app.state.comms, 'Unsaved new draft'), null);
assert.equal(app.storage.deleteDraft(app.state.drafts[0].id), false);
assert.equal(JSON.stringify(app.state.drafts), draftsBefore, 'Failed draft writes preserve the current archive');
assert.equal(app.storage.upsertSender({ name: 'Unsaved new sender' }), null);
assert.equal(app.storage.upsertSender({ name: 'Unsaved edit' }, app.state.localSenders[0].key), null);
assert.equal(app.storage.removeSender(app.state.localSenders[0].key), null);
assert.equal(JSON.stringify(app.state.localSenders), sendersBefore, 'Failed sender writes preserve the registry');
assert.equal(app.storage.saveCurrent(), false, 'Autosave exposes a failure instead of reporting success');
assert.equal(JSON.stringify([...memory]), diskBefore);
for (const section of ['drafts', 'senders', 'current']) {
  assert.throws(() => app.storage.importPayload(incoming, { sections: [section] }), /LOCAL STORAGE WRITE FAILED/);
  assert.equal(JSON.stringify(app.state.drafts), draftsBefore);
  assert.equal(JSON.stringify(app.state.localSenders), sendersBefore);
  assert.equal(app.state.comms.subject, 'REMOTE CURRENT', 'A rejected import leaves the current message in place');
}

app.store.set = write;
const sender = app.storage.upsertSender({ name: 'Retained Signature', title: 'Retained Role' });
const reference = { ...app.storage.defaultState(), senderKey: sender.key };
app.storage.saveDraft(reference, 'Referenced Sender');
app.state.comms = reference;
for (const failKey of [keys.commsDrafts, keys.commsCurrent, keys.localSenders]) {
  app.store.set = (key, value) => key === failKey ? false : write(key, value);
  assert.equal(app.storage.removeSender(sender.key), null, `Removing a sender is blocked if ${failKey} cannot be saved`);
  assert.ok(app.storage.senderByKey(sender.key), 'A sender remains available until its references and removal persist');
}
app.store.set = write;
assert.equal(app.storage.removeSender(sender.key).name, 'Retained Signature');
const referencedDraft = app.state.drafts.find(d => d.name === 'Referenced Sender');
assert.equal(app.storage.resolveSender(referencedDraft.state).name, 'Retained Signature');
assert.equal(app.storage.resolveSender(referencedDraft.state).title, 'Retained Role');
console.log('Local save failures passed: drafts, sender edits/removal, reusable signatures and autosave.');

memory.set(keys.localSenders, { unexpected: 'preserve sender data' });
memory.set(keys.commsDrafts, 'preserve draft data');
app.recoverCorruptStorageEntry = () => false;
assert.doesNotThrow(() => app.storage.init(), 'Valid JSON with an invalid list shape must not block startup');
assert.deepEqual(memory.get(keys.localSenders), { unexpected: 'preserve sender data' });
assert.equal(memory.get(keys.commsDrafts), 'preserve draft data', 'Failed recovery must not overwrite the old entry');
const recoveries = [];
app.recoverCorruptStorageEntry = (key, raw) => { recoveries.push({ key, raw }); memory.delete(key); return true; };
app.storage.init();
assert.equal(recoveries.length, 2);
assert.deepEqual(memory.get(keys.localSenders), []);
assert.deepEqual(memory.get(keys.commsDrafts), []);
assert.equal(JSON.parse(recoveries.find(r => r.key === keys.localSenders).raw).unexpected, 'preserve sender data');
assert.equal(JSON.parse(recoveries.find(r => r.key === keys.commsDrafts).raw), 'preserve draft data');
console.log('Malformed saved lists passed: recoverable startup and preservation when recovery fails.');
