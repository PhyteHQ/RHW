/* Selected recipes and live stock drive the shared production forecast. */
(function initProductionPlan() {
  'use strict';
  const app = window.RHWV4, core = app?.operationsCore;
  if (!core || !app.productionScenario) return;
  const volumes = globalThis.RHW_PRODUCTION_VOLUMES;
  let cachedKey = '', cached = null;
  function invalidate() { cachedKey = ''; cached = null; }
  function batch(row) {
    const recipe = row.recipe;
    if (!recipe) return null;
    const factor = core.factorFor(recipe, app.config.operations.defaultAffiliation);
    const primary = core.effectiveOutput(recipe, app.config.operations.defaultAffiliation);
    if (!primary) return null;
    const plan = core.buildPlan({ productId: primary.id, recipeId: recipe.id, quantity: 1,
      recursive: false, useInventory: false, routingPolicy: 'first', affiliationId: app.config.operations.defaultAffiliation });
    let volume = 0;
    const inputs = recipe.inputs.map(group => {
      const first = group.options[0];
      if (!first || group.options.some(option => option.qty !== first.qty)) throw Error('Unsupported input conversion');
      const record = read(first, telemetrySnapshot());
      const inputVolume = volumes[first.id] ?? firstFiniteApiStockValue(record.item, ['original_volume', 'volume']);
      volume += first.qty * (inputVolume === null ? NaN : inputVolume);
      return { name: group.options.map(option => option.name).join(' / '),
        ids: group.options.map(option => option.id), names: group.options.map(option => option.name),
        qty: Math.ceil(first.qty * factor - 1e-9) };
    });
    const seconds = volume / recipe.cookingRate * 60;
    const display = typeof PRODUCTION_MODULES !== 'undefined' ? PRODUCTION_MODULES.find(m => m.recipeId === recipe.id)?.product : null;
    const hull = typeof CAPITAL_SHIPYARD !== 'undefined' ? CAPITAL_SHIPYARD.hulls.find(h => h.recipeId === recipe.id) : null;
    const outputs = [{ ...primary, name: display || hull?.name || primary.name }, ...plan.byproducts].map(o => ({ id: o.id, name: o.name, qty: o.qty }));
    return { key: row.key, recipeId: recipe.id, name: display || hull?.name || primary.name, inputs, outputs,
      output: primary.qty, seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
      catalysts: plan.catalysts.map(c => ({ ...c })), creditCost: recipe.creditCost || 0 };
  }
  function read(entry, snapshot) { return app.shipyard.stockRecord(entry, snapshot); }
  function analyze() {
    const snapshot = telemetrySnapshot(), scenario = app.productionScenario.analyze();
    const selected = scenario.rows.filter(row => row.enabled);
    const jobs = [], unknown = [], conditions = [];
    if (!snapshot.available || !core.state.catalog) return { ready: false, snapshot, rows: [], unknown: ['Inventory or recipe catalog unavailable'] };
    for (const row of selected) {
      try { const job = batch(row); if (!job) unknown.push(row.name); else jobs.push(job); }
      catch { unknown.push(row.name); }
    }
    const stock = {}, limits = {}, allVolumes = { ...volumes };
    const entries = new Map();
    let storageKnown = true;
    for (const job of jobs) {
      for (const group of job.inputs) {
        const values = group.ids.map((id, i) => ({ id, name: group.names[i], ...read({ id, name: group.names[i] }, snapshot) }));
        // An absent alternate contributes zero only when another option is
        // actually reported. Invalid reported quantities remain unknown.
        const known = values.some(v => v.stock !== null) && values.every(v => !v.item || v.stock !== null);
        if (!known) unknown.push(group.name);
        values.forEach(v => { stock[v.id] = v.stock ?? 0; entries.set(v.id, v); });
      }
      for (const output of job.outputs) {
        const record = read(output, snapshot);
        if (!(output.id in stock)) stock[output.id] = record.stock ?? 0;
        entries.set(output.id, { ...output, ...record });
      }
    }
    for (const [id, entry] of entries) {
      const max = firstFiniteApiStockValue(entry.item, ['max_stock', 'max', 'maxStock', 'max_quantity', 'maxQuantity']);
      if (max !== null) limits[id] = max;
      if (!(id in allVolumes)) {
        const v = firstFiniteApiStockValue(entry.item, ['original_volume', 'volume']);
        if (v !== null) allVolumes[id] = v;
      }
    }
    for (const job of jobs) {
      if (job.seconds === null) unknown.push(`${job.name} cycle time`);
      for (const group of job.inputs) for (const id of group.ids) if (!Number.isFinite(allVolumes[id])) unknown.push(`${group.name} volume`);
      for (const o of job.outputs) {
        if (!Number.isFinite(allVolumes[o.id])) {
          storageKnown = false;
          allVolumes[o.id] = 0;
          conditions.push('Some output volumes are not reported; total storage capacity is not checked');
        }
        if (!(o.id in limits)) conditions.push('Some output stock limits are not reported');
      }
      if (job.creditCost) unknown.push(`${job.name} recipe fee timing`);
      for (const c of job.catalysts) {
        const quantity = read(c, snapshot).stock;
        if (quantity === null) conditions.push(`${c.name} availability is not reported`);
        else stock[c.id] = quantity;
      }
    }
    const space = storageKnown ? firstFiniteApiStockValue(typeof rhwBase !== 'undefined' ? rhwBase : null,
      ['cargospace', 'cargo_space', 'cargo_space_left', 'storage_free']) : null;
    if (space === null) conditions.push('Free storage space is not reported');
    const key = JSON.stringify({ jobs, stock, limits, space, allVolumes, unknown, conditions, stale: snapshot.stale, fetchedAt: snapshot.fetchedAt });
    if (key === cachedKey) return cached;
    const result = unknown.length ? { rows: [], truncated: false, orders: 0 }
      : RHW_PRODUCTION_SIMULATION.simulate({ jobs, stock, limits, volumes: allVolumes, space, coreCrew: scenario.coreCrew });
    cachedKey = key;
    cached = { ...result, ready: unknown.length === 0, jobs, scenario, snapshot,
      unknown: [...new Set(unknown)], conditions: [...new Set(conditions)],
      rows: jobs.map(job => ({ ...job, ...result.rows.find(row => row.key === job.key) })) };
    return cached;
  }
  function select(recipeId) {
    const rows = app.productionScenario.analyze().rows;
    const row = rows.find(row => app.productionScenario.options(row).some(r => r.id === recipeId));
    if (!row || row.fixed) return false;
    const enabled = !(row.enabled && !row.followHull && row.recipeId === recipeId);
    return app.productionScenario.setModule(row.key, { enabled, recipeId, followHull: false });
  }
  function selectHull() {
    const row = app.productionScenario.analyze().rows.find(r => r.key === 'shipyard');
    const recipeId = app.shipyard.selectedHull().recipeId;
    return app.productionScenario.setModule('shipyard', { enabled: !(row.enabled && row.recipeId === recipeId),
      recipeId, followHull: true });
  }
  function rowFor(recipeId, result = analyze()) { return result.rows.find(row => row.recipeId === recipeId); }
  app.productionPlan = { analyze, batch, select, selectHull, rowFor, invalidate };
  app.lifecycle.on('catalog:loaded', 'production-plan', 50, invalidate);
})();
