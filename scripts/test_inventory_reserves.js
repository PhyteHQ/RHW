const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), zlib = require('node:zlib'), path = require('node:path');
const root = path.join(__dirname, '..'), memory = new Map();
const ctx = vm.createContext({ console, Map, Set, Intl, items: [], rhwBase: {}, els: {},
  document: { getElementById: () => null, addEventListener() {} },
  hasVerifiedTelemetry: () => true, telemetrySnapshot: () => ({ available: true, stale: false }),
  RHWV4: { state: {}, config: { storageKeys: { shipyardSelection: 'hull', shipyardDivisions: 'divisions' }, operations: { defaultAffiliation: 'br_m_grp' } },
    store: { get: (k, fallback) => memory.get(k) ?? fallback, set: (k, v) => memory.set(k, v) } }
});
ctx.window = ctx;
const run = p => vm.runInContext(fs.readFileSync(path.join(root, p), 'utf8'), ctx, { filename: p });
run('js/command/config.js');
vm.runInContext('const CAPITAL_SHIPYARD=DASHBOARD_CONFIG.capitalShipyard; const PRODUCTION_MODULES=DASHBOARD_CONFIG.productionModules;', ctx);
run('js/shared/utils.js'); run('js/command/shipyard.js'); run('js/core/lifecycle.js');
ctx.RHWV4.lifecycle = ctx.createRhwLifecycle();
run('js/calculator/model.js'); run('js/command/production-model.js'); run('js/command/shipyard-model.js');
run('js/command/production-volumes.js');
run('js/command/inventory-model.js');
ctx.findCommodity = name => ctx.items.find(item => ctx.keyFromName(item.name) === ctx.keyFromName(name)) || null;
for (let i=1; i<=6; i++) run(`assets/recipes/catalog-v1-part-${String(i).padStart(2,'0')}.js`);
ctx.__RHW_RECIPE_CATALOG__ = JSON.parse(zlib.gunzipSync(Buffer.from(ctx.__RHW_RECIPE_CATALOG_GZIP_BASE64__, 'base64')));
(async () => {
  const app = ctx.RHWV4;
  await app.operationsCore.loadCatalog();
  const model = app.inventoryModel, raw = (name, quantity) => ({ name, quantity, max_stock: 100000 });
  model.input('Scrap Metal','recipe_scrap_advanced');
  model.input('Gold Ore','recipe_gold_advanced');
  model.input('Niobium Ore','recipe_niobium_advanced');
  model.input('Military Salvage','recipe_milsal');
  assert.deepEqual(Array.from(app.production.recipes(), r=>r.product),['Multi-Mode Focusing Chamber','Reactor Systems','Superstructure Systems','Basic Alloy','Gold','Niobium','Prototype Components','MOX'], 'Reading inputs before the first production render must never overwrite the cached product identities');
  ctx.items = [raw('Gold',0),raw('Wildcat Gold',8600),raw('Niobium',9519),raw('Prototype Components',40),raw('Gold Ore',0),raw('Military Salvage',250),raw('MOX',8381),raw('Toxic Waste',17550),raw('Uranium',100)];
  const untouched = JSON.stringify(ctx.items);
  assert.equal(model.reserve('Gold').stock, 8600);
  assert.equal(model.reserve('Wildcat Gold').stock, 8600);
  assert.equal(model.reserve('Gold').required, 250);
  assert.equal(model.reserve('Gold').state, 'ok', 'Zero regular Gold cannot alarm while usable WCG covers the selected jobs');
  assert.equal(model.input('Gold Ore','recipe_gold_advanced').cycles,0);
  assert.equal(model.input('Military Salvage','recipe_milsal').cycles,1);
  assert.equal(model.reserve('Prototype Components').required,10);
  assert.equal(model.reserve('Niobium').required,25, 'Thresholds use the largest single recipe input without a manual plan');
  assert.equal(model.reserve('MOX').stock,8381);
  assert.ok(model.reserve('MOX').required>0,'Internal MOX coverage is based on consuming production recipes');
  assert.equal(model.reserve('MOX').recipeId,'recipe_mox_fuel_basic');
  assert.deepEqual(Array.from(model.reserve('MOX').inputs),['Toxic Waste']);
  assert.equal(model.input('Toxic Waste','recipe_mox_fuel_basic').cycles,17);
  assert.equal(model.moxFeedstock().cycles,17);
  assert.equal(model.moxFeedstock().potentialOutput,5661);
  assert.equal(model.moxFeedstock().state,'ok');
  assert.equal(app.production.selectMoxRecipe('recipe_mox_fuel_advanced'),true);
  assert.equal(model.definition('MOX').recipeId,'recipe_mox_fuel_advanced','Inventory links follow the selected producing recipe');
  assert.deepEqual(Array.from(model.reserve('MOX').inputs),['Toxic Waste','Uranium']);
  assert.equal(model.input('Uranium','recipe_mox_fuel_advanced').cycles,1);
  assert.equal(model.reserve('MOX').stock,8381,'Changing recipe never changes real product stock');
  app.production.selectMoxRecipe('recipe_mox_fuel_basic');
  assert.equal(JSON.stringify(ctx.items),untouched,'Inventory analysis never changes real stock');
  ctx.items.find(i=>i.name==='Wildcat Gold').quantity=260;
  assert.equal(model.reserve('Gold').state,'low','The warning means only one full next-input round is covered');
  ctx.items.find(i=>i.name==='Wildcat Gold').quantity=200;
  assert.equal(model.reserve('Gold').state,'critical');
  ctx.items.find(i=>i.name==='Gold').quantity='invalid';
  assert.equal(model.reserve('Gold').stock,null,'Invalid reported quantities are unknown');
  ctx.items = [raw('Wildcat Gold',8600)];
  assert.equal(model.reserve('Gold').stock,8600,'An absent alternate does not hide a reported usable stock');
  assert.equal(model.reserve('Prototype Components').stock,null);
  assert.equal(model.input('Military Salvage','recipe_milsal').stock,null,'Absent feedstock is not invented as zero');
  for (const [stock, state, cycles] of [[0,'critical',0],[500,'critical',0],[1500,'low',1],[50000,'ok',50],[null,'waiting',null]]) {
    ctx.items=[raw('Toxic Waste',stock)];
    assert.equal(model.moxFeedstock().state,state,'TW state describes selected-recipe coverage, not waste disposal');
    assert.equal(model.moxFeedstock().cycles,cycles);
  }

  ctx.items = [raw('Archon Design Schematics',99),{nickname:'medium_miner_package',name:'Archon Modular Miner',quantity:2},
    {nickname:'dsy_cargobarge_1_package',name:'Barge',quantity:3},{name:'Asteroid Miner',quantity:'bad'}];
  const ships=model.ships();
  assert.equal(ships.find(r=>r.hull.key==='archon').stock,2);
  assert.equal(ships.find(r=>r.hull.key==='barge').stock,3);
  assert.equal(ships.find(r=>r.hull.key==='asteroid-miner').stock,null);
  assert.equal(ships.find(r=>r.hull.key==='dunkirk').stock,null);
  const stockBefore = JSON.stringify(ctx.items);
  assert.equal(app.shipyard.selectHull('barge'), true);
  assert.equal(app.shipyard.selectedHull().key, 'barge');
  assert.equal(JSON.stringify(ctx.items), stockBefore, 'Opening a hull only changes the preview');
  assert.equal(vm.runInContext("DASHBOARD_CONFIG.roles.export.some(n=>['gold','niobium','prototype components','wildcat gold','mox'].includes(n))",ctx),false);
  console.log('Inventory reserves passed: pooled Gold, internal MOX with selected-recipe inputs, unknown stock, single-recipe thresholds, exact ship stock and view-only navigation.');
})().catch(error=>{console.error(error);process.exit(1);});
