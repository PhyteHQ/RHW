/* Ship-specific stock and requirements, using the Calculator's recipe planner. */
(function initRhwShipyard() {
  'use strict';
  const app = window.RHWV4;
  const core = app?.operationsCore;
  if (!core || typeof CAPITAL_SHIPYARD === 'undefined') return;
  const config = CAPITAL_SHIPYARD;
  const key = app.config.storageKeys.shipyardSelection;
  const plans = new Map();
  app.state.shipyardHull = app.store.get(key, config.defaultHull);
  const divisionKey = app.config.storageKeys.shipyardDivisions;
  const savedDivisions = divisionKey ? app.store.get(divisionKey, {}) : {};
  const lastHulls = savedDivisions && typeof savedDivisions === 'object' && !Array.isArray(savedDivisions) ? { ...savedDivisions } : {};

  function selectedHull() {
    return config.hulls.find(hull => hull.key === app.state.shipyardHull)
      || config.hulls.find(hull => hull.key === config.defaultHull) || config.hulls[0];
  }

  function requirements(hull = selectedHull()) {
    if (!core.state.catalog || !hull) return null;
    if (plans.has(hull.key)) return plans.get(hull.key);
    try {
      const recipe = core.recipe(hull.recipeId);
      if (!recipe || !core.authorizedFor(recipe, app.config.operations.defaultAffiliation)
        || !recipe.outputs.some(output => output.id === hull.productId)) return null;
      const plan = core.buildPlan({ productId: hull.productId, recipeId: hull.recipeId,
        quantity: 1, affiliationId: app.config.operations.defaultAffiliation,
        recursive: false, useInventory: false });
      const materials = core.materialRows(plan);
      if (plan.actualOutput !== 1 || !materials.length || materials.some(row => !(row.required > 0))) return null;
      const result = { recipe, materials, prerequisites: plan.catalysts, affiliationId: plan.affiliationId };
      plans.set(hull.key, result);
      return result;
    } catch {
      // An unavailable or newly restricted recipe must never fall back to the
      // requirements of a different ship or claim that zero materials suffice.
      return null;
    }
  }

  function stockRecord(entry, snapshot = telemetrySnapshot()) {
    if (!snapshot.available) return { item: null, stock: null };
    const item = findShipyardItem(entry);
    const stock = item ? firstFiniteApiStockValue(item, ['quantity', 'amount', 'stock']) : null;
    return { item, stock };
  }

  function analyze(hull = selectedHull()) {
    const snapshot = telemetrySnapshot();
    const needs = requirements(hull);
    if (!needs) return { hull, snapshot, recipeReady: false, materials: [], prerequisites: [], buildable: null, bottleneck: null };
    const materials = needs.materials.map(entry => {
      const { stock } = stockRecord(entry, snapshot);
      return { ...entry, stock, coverage: stock === null ? null : Math.floor(stock / entry.required) };
    });
    const known = materials.every(entry => entry.stock !== null);
    const buildable = known ? Math.min(...materials.map(entry => entry.coverage)) : null;
    const nextHull = buildable === null ? null : buildable + 1;
    materials.forEach(entry => {
      entry.gap = nextHull === null ? null : Math.max(0, nextHull * entry.required - entry.stock);
      entry.state = entry.coverage === null ? 'unknown' : shipyardTrafficState(entry.coverage);
    });
    const bottleneck = known ? [...materials].sort((a, b) => a.coverage - b.coverage
      || b.gap / b.required - a.gap / a.required || b.gap - a.gap)[0] : null;
    const prerequisites = needs.prerequisites.map(entry => {
      const staffing = app.personnel?.forRecipe(needs.recipe).find(row => row.id === entry.id);
      const stock = staffing ? staffing.free : stockRecord(entry, snapshot).stock;
      return { ...entry, stock, staffing, state: stock === null ? 'unknown' : stock >= entry.qty && (!staffing || staffing.gap === 0) ? 'ok' : 'critical' };
    });
    return { hull, snapshot, recipeReady: true, recipe: needs.recipe, materials, prerequisites, buildable, nextHull, bottleneck };
  }

  function selectHull(hullKey) {
    const hull = config.hulls.find(entry => entry.key === hullKey);
    if (!hull) return false;
    app.state.shipyardHull = hull.key;
    lastHulls[hull.division] = hull.key;
    app.store.set(key, hull.key);
    if (divisionKey) app.store.set(divisionKey, lastHulls);
    window.renderAll?.();
    app.requestUiUpdate?.();
    return true;
  }

  function selectedDivision() { return config.divisions.find(entry => entry.key === selectedHull().division); }
  function selectDivision(id) {
    const hulls = config.hulls.filter(hull => hull.division === id);
    if (!hulls.length) return false;
    const hull = hulls.find(entry => entry.key === lastHulls[id]) || hulls[0];
    return selectHull(hull.key);
  }
  function restoreSelection() {
    app.state.shipyardHull = app.store.get(key, config.defaultHull);
    const saved = divisionKey ? app.store.get(divisionKey, {}) : {};
    for (const division of config.divisions) {
      delete lastHulls[division.key];
      if (typeof saved?.[division.key] === 'string') lastHulls[division.key] = saved[division.key];
    }
  }

  function openCalculator() {
    const hull = selectedHull();
    const needs = requirements(hull);
    if (!needs) return;
    app.operations?.openSelection({ productId: hull.productId, recipeId: hull.recipeId,
      quantity: 1, affiliationId: needs.affiliationId, productName: hull.name });
  }

  function bind() {
    const mount = document.getElementById('shipyardControl');
    if (!mount || mount.dataset.shipyardBound === 'true') return;
    mount.dataset.shipyardBound = 'true';
    mount.addEventListener('click', event => {
      const selection = event.target.closest('[data-shipyard-select]');
      const division = event.target.closest('[data-shipyard-division]');
      if (division) selectDivision(division.dataset.shipyardDivision);
      else if (selection) selectHull(selection.dataset.shipyardSelect);
      else if (event.target.closest('[data-shipyard-calculate]')) openCalculator();
    });
  }

  app.shipyard = { selectedHull, selectedDivision, selectDivision, restoreSelection, requirements, stockRecord, analyze, selectHull, openCalculator };
  app.lifecycle.on('command:ready', 'shipyard-selection', 60, bind);
  app.lifecycle.on('catalog:loaded', 'shipyard-requirements', 40, () => {
    plans.clear();
    window.renderAll?.();
    app.requestUiUpdate?.();
  });
})();
