import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeShipRegistry, isSelectableShip } from '../js/supply/ship-profiles.mjs';
import { identityRegistry, identityShipCheck } from '../js/supply/identity-profiles.mjs';
import { haulerCategory, haulerCategories } from '../js/supply/hauler-categories.mjs';
import { searchIdentities } from '../js/supply/identity-planner.mjs';
import { searchSupply } from '../js/supply/planner.mjs';
import { searchExports } from '../js/supply/export-planner.mjs';
import { BMM_ID } from '../js/supply/access.mjs';

const SPA = 'dsy_license_co_os_grp';
const flight = JSON.parse(await readFile(new URL('./fixtures/hauler-flight-2026-10-28.json', import.meta.url)));
const idData = JSON.parse(await readFile(new URL('./fixtures/player-id-routes-2026-10-28.json', import.meta.url)));
const registry = normalizeShipRegistry(flight.ships);
assert.ok(!registry.some(ship => ship.nickname === 'dsy_super_gallic_train'));
const train = registry.find(ship => ship.nickname === 'dsy_advanced_train');
const ids = identityRegistry(idData.tractors, idData.cards).filter(id => [BMM_ID, SPA].includes(id.id));
const scopes = ids.map(identity => ({ identity, accessReady: true, blocked: [], unverifiedDocks: [], approvalDocks: [] }));
const category = haulerCategory(train);
assert.equal(category.label, '5,000 Cargo Transport · 350 m/s');
const gallicAdvanced = registry.find(ship => ship.nickname === 'dsy_gallic_train_adv');
assert.equal(haulerCategory(gallicAdvanced).id, category.id, 'Different hull classes can share a presentation category while retaining their own checks');
assert.notEqual(haulerCategory({ ...train, dock: 'large' }).id, category.id);
assert.notEqual(haulerCategory({ ...train, tradeLanes: false }).id, category.id);
assert.notEqual(haulerCategory({ ...train, cruiseCharge: 15 }).id, category.id);
assert.notEqual(haulerCategory({ ...train, shipClass: 10 }).id, category.id);
assert.ok(!haulerCategories([...registry, { ...train, id: 'fighter', shipClass: 0 }]).some(row => row.models.some(ship => ship.id === 'fighter')));

// Controlled identity matrix: equal flight/cargo profiles, different usable
// IDs. A category must report the exact model for each ID, never mix them.
const bmmModel = { ...train, id: 'ship:category_bmm', nickname: 'category_bmm', name: 'BMM Test Model', techCompat: { [BMM_ID]: 1, [SPA]: .1 } };
const spaModel = { ...train, id: 'ship:category_spa', nickname: 'category_spa', name: 'Spa Test Model', techCompat: { [BMM_ID]: .1, [SPA]: 1 } };
const good = { id: 'niobium', name: 'Niobium', buy: 105, sell: 150, volume: 1, originalVolume: 1, volumes: {} };
const home = { id: 'rhw', name: 'Resolution Heavy Works', kind: 'pob', system: 'br01', pos: [0, 0, 0], cash: 1e8, space: 1e6,
  offers: [{ ...good, buy: 100, stock: 0, min: 0, max: 50000 }] };
const supplier = { id: 'source', name: 'Category Test Supplier', kind: 'npc', system: 'br01', pos: [300000, 0, 0], offers: [{ ...good, sell: 200 }] };
const data = { schema: 1, asOf: '2026-10-29T07:00:00Z', bases: [home, supplier] };
const nav = { schema: 1, nodes: data.bases.map(base => ({ id: base.id, system: base.system, pos: base.pos, kind: 'base', allows: ['medium', 'large', 'berth'] })),
  baseNodes: { rhw: 'rhw', source: 'source' }, links: [
    { from: 'rhw', to: 'source', kind: 'lane', speed: 2500 }, { from: 'source', to: 'rhw', kind: 'lane', speed: 2500 }] };
const options = { commodity: 'Niobium', haulerId: category.id, extraPercent: 0 };
const result = await searchIdentities(data, nav, [bmmModel, spaModel], scopes, options);
const quote = result.results[0];
assert.equal(quote.hauler.id, category.id);
assert.equal(quote.hauler.models.length, 2);
assert.equal(quote.delivered, 5000);
assert.deepEqual(quote.compatibleIdentities.find(row => row.identity.id === BMM_ID).models.map(ship => ship.id), [bmmModel.id]);
assert.deepEqual(quote.compatibleIdentities.find(row => row.identity.id === SPA).models.map(ship => ship.id), [spaModel.id]);
assert.match(quote.preferredIdentities[0].shipCheck.reason, /BMM Test Model/);
assert.match(quote.preferredIdentities[2].shipCheck.reason, /Spa Test Model/);
const selected = await searchIdentities(data, nav, [bmmModel, spaModel], scopes, { ...options, shipId: bmmModel.id });
assert.equal(selected.results[0].hauler.models.length, 1);
assert.equal(selected.results[0].preferredIdentities[2].shipCheck.state, 'blocked', 'A specific-model filter cannot borrow another category model’s tech');
const splitScopes = scopes.map(scope => ({ ...scope, blocked: scope.identity.id === BMM_ID ? ['source'] : ['rhw'] }));
assert.equal((await searchIdentities(data, nav, [bmmModel, spaModel], splitScopes, options)).results.length, 0,
  'Category membership cannot stitch different model/ID permissions across stops');
const wrongCategory = haulerCategory(registry.find(ship => ship.nickname === 'pilgrim_liner'));
assert.equal((await searchIdentities(data, nav, [bmmModel, spaModel], scopes, { ...options, haulerId: wrongCategory.id })).results.length, 0);

// Same category, but a ship-specific commodity volume changes the load. Such
// a model must not inherit the 5,000-unit quote or its displayed usable IDs.
const differentVolumes = structuredClone(data);
for (const base of differentVolumes.bases) base.offers[0].volumes = { 6: 2, 9: 1 };
const volumeModel = { ...spaModel, shipClass: 6, volumeClass: 6 };
const volumeQuote = (await searchIdentities(differentVolumes, nav, [bmmModel, volumeModel], scopes, options)).results[0];
assert.equal(volumeQuote.delivered, 5000);
assert.deepEqual(volumeQuote.hauler.models.map(model => model.ship.id), [bmmModel.id]);
assert.equal(volumeQuote.preferredIdentities[2].shipCheck.state, 'blocked');
const spaVolumeQuote = (await searchIdentities(differentVolumes, nav, [bmmModel, volumeModel], scopes, { ...options, identityId: SPA })).results[0];
assert.equal(spaVolumeQuote.delivered, 2500, 'The same cargo category still uses the actual model’s commodity volume');

// Reproduce a pre-update normalized cache row: full tech and a package must
// not let the explicitly removed Super Train return through any search path.
const cachedSuper = { ...train, id: 'ship:dsy_super_gallic_train', nickname: 'dsy_super_gallic_train',
  name: 'Gallic Super Train', cargo: 6250, cruise: 300, techCompat: { [BMM_ID]: 1, [SPA]: 1 } };
assert.equal(isSelectableShip(cachedSuper), false);
assert.equal(identityShipCheck(ids[0], cachedSuper).state, 'blocked');
assert.ok(!haulerCategories([train, cachedSuper]).some(row => row.cargo === 6250));
assert.equal((await searchIdentities(data, nav, [cachedSuper], scopes, { commodity: 'Niobium', shipId: cachedSuper.id, includeUnverified: true })).results.length, 0);
assert.equal((await searchSupply(data, nav, [cachedSuper], { commodity: 'Niobium' })).results.length, 0);
const exportData = structuredClone(data); exportData.bases[0].offers[0].stock = 20000;
assert.equal((await searchExports(exportData, nav, [cachedSuper], { commodity: 'Niobium' })).results.length, 0);
const exported = await searchIdentities(exportData, nav, [bmmModel, spaModel], scopes, { ...options, mode: 'export', returnCargo: false });
assert.equal(exported.results[0].hauler.models.length, 2, 'Exports use the same model-specific category checks');
console.log('Hauler categories passed: capacity/speed/dock/lane groups, per-model full-trip ID mapping, exact commodity volumes, specific-model scope and removed Super Train in API/cache/manual/import/export paths.');
