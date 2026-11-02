/* Local staffing scenarios. Discovery reserves 200 crew/core level, then each
   running factory reserves its recipe's catalysts for that tick. See
   docs/personnel-planner.md for the primary server-code references. */
(function initRhwPersonnel() {
  'use strict';
  const app = window.RHWV4;
  const core = app?.operationsCore;
  if (!core) return;
  const storageKey = app.config.storageKeys.personnelPlan;
  const resources = Object.freeze([
    { key: 'crew', id: 'commodity_crew', name: 'Crew' },
    { key: 'scientists', id: 'commodity_scientists', name: 'Scientists' }
  ]);
  const modules = Object.freeze([
    { key: 'refinery', name: 'Industrial Refinery', defaultRecipe: 'recipe_gold_advanced',
      accepts: r => ['recipe_gold_advanced', 'recipe_niobium_advanced'].includes(r.id) },
    { key: 'smelter', name: 'Scrap Smelter', fixed: true, defaultRecipe: 'recipe_scrap_advanced', accepts: r => r.id === 'recipe_scrap_advanced' },
    { key: 'shipyard', name: 'Modular Shipyard', defaultRecipe: 'ship_assembly_medium_miner',
      accepts: r => ['ship_part_superstructure', 'ship_part_reactor'].includes(r.id) || CAPITAL_SHIPYARD.hulls.some(h => h.recipeId === r.id) },
    { key: 'foundry', name: 'Exotic Weapons Components Foundry', fixed: true, defaultRecipe: 'recipe_weapon_part_focusing_chamber',
      accepts: r => r.id === 'recipe_weapon_part_focusing_chamber' }
  ]);
  function amount(value) {
    if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  }
  function normalize(raw) {
    const object = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return { version: 3, coreLevel: 4,
      stock: Object.fromEntries(resources.map(r => [r.key, amount(object.stock?.[r.key])])),
      modules: Object.fromEntries(modules.map(m => [m.key, {
        enabled: m.fixed || (m.key === 'refinery' ? object.version >= 3
          ? object.modules?.refinery?.enabled !== false : true : object.modules?.[m.key]?.enabled === true),
        recipeId: m.fixed ? m.defaultRecipe : typeof object.modules?.[m.key]?.recipeId === 'string'
          && m.accepts({ id: object.modules[m.key].recipeId }) ? object.modules[m.key].recipeId : m.defaultRecipe,
        followHull: m.key === 'shipyard' && (object.modules?.shipyard?.followHull === true
          || CAPITAL_SHIPYARD.hulls.some(h => h.recipeId === object.modules?.shipyard?.recipeId))
      }])) };
  }
  let state = normalize(storageKey ? app.store.get(storageKey, {}) : {});
  function options(module) {
    return (core.state.catalog?.recipes || []).filter(r => module.accepts(r)
      && core.authorizedFor(r, app.config.operations.defaultAffiliation));
  }
  function label(recipe) {
    if (!recipe) return 'RECIPE UNAVAILABLE';
    const alias = app.operations?.recipeAliases?.[recipe.id];
    const mode = /_(basic|advanced|bulk|efficient)$/.exec(recipe.id)?.[1];
    return alias?.name || `${recipe.name}${mode ? ` · ${mode.toUpperCase()}` : ''}`;
  }
  function needs(recipe) {
    if (!recipe || !core.authorizedFor(recipe, app.config.operations.defaultAffiliation)) return null;
    const result = { crew: 0, scientists: 0 };
    for (const r of resources) {
      for (const entry of recipe.catalysts || []) if (entry.id === r.id) {
        const n = amount(entry.qty);
        if (n === null) return null;
        result[r.key] += n;
      }
    }
    return result;
  }
  function available(resource) {
    const manual = state.stock[resource.key];
    if (manual !== null) return { amount: manual, source: 'MANUAL', stale: false };
    const snapshot = telemetrySnapshot();
    if (!snapshot.available) return { amount: null, source: 'NOT REPORTED', stale: false };
    const stock = app.shipyard?.stockRecord({ id: resource.id, name: resource.name }, snapshot)?.stock;
    return { amount: amount(stock), source: amount(stock) === null ? 'NOT REPORTED' : snapshot.stale ? 'CACHED' : 'LIVE', stale: snapshot.stale };
  }
  function analyze(excludeModule = '') {
    const required = { crew: state.coreLevel * 200, scientists: 0 };
    let complete = true;
    const rows = modules.map(module => {
      const selection = state.modules[module.key];
      const recipeId = selection.followHull ? app.shipyard?.selectedHull()?.recipeId : selection.recipeId;
      const recipe = options(module).find(r => r.id === recipeId);
      const personnel = needs(recipe);
      if (selection.enabled && module.key !== excludeModule) {
        if (!personnel) complete = false;
        else for (const r of resources) required[r.key] += personnel[r.key];
      }
      return { ...module, ...selection, recipeId, recipe, personnel };
    });
    return { coreLevel: state.coreLevel, coreCrew: state.coreLevel * 200, complete, rows,
      resources: resources.map(r => {
        const stock = available(r);
        const total = complete ? required[r.key] : null;
        return { ...r, ...stock, required: total,
          gap: total === null || stock.amount === null ? null : Math.max(0, total - stock.amount),
          spare: total === null || stock.amount === null ? null : Math.max(0, stock.amount - total) };
      }) };
  }
  function forRecipe(recipe, moduleKey = 'shipyard') {
    const plan = analyze(moduleKey), personnel = needs(recipe);
    return resources.map(r => {
      const stock = plan.resources.find(entry => entry.key === r.key);
      const required = personnel?.[r.key] ?? null;
      const total = required === null || stock.required === null ? null : stock.required + required;
      const free = stock.amount === null || stock.required === null ? null : Math.max(0, stock.amount - stock.required);
      return { ...stock, required, reserved: stock.required, total, free,
        gap: stock.amount === null || total === null ? null : Math.max(0, total - stock.amount) };
    });
  }
  function save(next) {
    const normalized = normalize(next);
    if (storageKey && app.store.set(storageKey, normalized) === false) return false;
    state = normalized;
    app.productionPlan?.invalidate();
    app.personnelView?.render();
    if (typeof renderProductionModules === 'function') renderProductionModules();
    if (typeof renderShipyardControl === 'function') renderShipyardControl();
    return true;
  }
  function setModule(key, changes) {
    const module = modules.find(m => m.key === key);
    if (!module) return false;
    if (module.fixed && changes.enabled === false) return false;
    if (module.fixed && changes.recipeId !== undefined && changes.recipeId !== module.defaultRecipe) return false;
    if (changes.recipeId !== undefined && !options(module).some(r => r.id === changes.recipeId)) return false;
    const followHull = key === 'shipyard' && (changes.followHull ?? (changes.recipeId !== undefined
      ? CAPITAL_SHIPYARD.hulls.some(h => h.recipeId === changes.recipeId) : state.modules[key].followHull));
    return save({ ...state, modules: { ...state.modules, [key]: { ...state.modules[key], ...changes, followHull } } });
  }
  function setStock(key, value) {
    if (!resources.some(r => r.key === key)) return false;
    if (value !== '' && value !== null && amount(value) === null) return false;
    return save({ ...state, stock: { ...state.stock, [key]: amount(value) } });
  }
  app.personnel = { analyze, forRecipe, needs, options, label, setModule, setStock,
    restore: () => { state = normalize(storageKey ? app.store.get(storageKey, {}) : {}); },
    snapshot: () => JSON.parse(JSON.stringify(state)) };
})();
