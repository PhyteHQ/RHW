/* Saved recipe choices for the shared production forecast. */
(function initProductionScenario() {
  'use strict';
  const app = window.RHWV4, core = app?.operationsCore;
  if (!core) return;
  const storageKey = app.config.storageKeys.productionPlan;
  const modules = Object.freeze([
    { key: 'refinery', name: 'Industrial Refinery', defaultRecipe: 'recipe_gold_advanced',
      accepts: r => ['recipe_gold_advanced', 'recipe_niobium_advanced'].includes(r.id) },
    { key: 'smelter', name: 'Scrap Smelter', fixed: true, defaultRecipe: 'recipe_scrap_advanced', accepts: r => r.id === 'recipe_scrap_advanced' },
    { key: 'shipyard', name: 'Modular Shipyard', defaultRecipe: 'ship_assembly_medium_miner',
      accepts: r => ['ship_part_superstructure', 'ship_part_reactor'].includes(r.id) || CAPITAL_SHIPYARD.hulls.some(h => h.recipeId === r.id) },
    { key: 'reclamation', name: 'Advanced Materials Complex', defaultRecipe: 'recipe_milsal', accepts: r => r.id === 'recipe_milsal' },
    { key: 'foundry', name: 'Exotic Weapons Components Foundry', fixed: true, defaultRecipe: 'recipe_weapon_part_focusing_chamber',
      accepts: r => r.id === 'recipe_weapon_part_focusing_chamber' }
  ]);
  function normalize(raw) {
    const object = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return { version: 5, modules: Object.fromEntries(modules.map(m => [m.key, {
      enabled: Boolean(m.fixed) || ((m.key === 'refinery'
        ? !(object.version >= 3 && object.modules?.refinery?.enabled === false)
        : object.modules?.[m.key]?.enabled === true)
        && !(typeof object.modules?.[m.key]?.recipeId === 'string'
          && !m.accepts({ id: object.modules[m.key].recipeId }))),
      recipeId: m.fixed ? m.defaultRecipe : typeof object.modules?.[m.key]?.recipeId === 'string'
        && m.accepts({ id: object.modules[m.key].recipeId }) ? object.modules[m.key].recipeId : m.defaultRecipe,
      followHull: m.key === 'shipyard' && (object.modules?.shipyard?.followHull === true
        || object.version < 4 && CAPITAL_SHIPYARD.hulls.some(h => h.recipeId === object.modules?.shipyard?.recipeId))
    }])) };
  }
  let state;
  function restore() { state = normalize(storageKey ? app.store.get(storageKey, {}) : {}); }
  restore();
  function options(module) {
    return (core.state.catalog?.recipes || []).filter(r => module.accepts(r)
      && core.authorizedFor(r, app.config.operations.defaultAffiliation));
  }
  function analyze() {
    return { coreCrew: 800, rows: modules.map(module => {
      const selection = state.modules[module.key];
      const recipeId = selection.followHull ? app.shipyard?.selectedHull()?.recipeId : selection.recipeId;
      return { ...module, ...selection, recipeId, recipe: options(module).find(r => r.id === recipeId) };
    }) };
  }
  function render() {
    app.productionPlan?.invalidate();
    if (typeof renderProductionModules === 'function') renderProductionModules();
    if (typeof renderShipyardControl === 'function') renderShipyardControl();
    if (typeof renderOverview === 'function') renderOverview();
    app.requestUiUpdate?.();
  }
  function setModule(key, changes) {
    const module = modules.find(m => m.key === key);
    if (!module || module.fixed && changes.enabled === false) return false;
    if (module.fixed && changes.recipeId !== undefined && changes.recipeId !== module.defaultRecipe) return false;
    if (changes.recipeId !== undefined && !options(module).some(r => r.id === changes.recipeId)) return false;
    const followHull = key === 'shipyard' && (changes.followHull ?? (changes.recipeId !== undefined
      ? CAPITAL_SHIPYARD.hulls.some(h => h.recipeId === changes.recipeId) : state.modules[key].followHull));
    const next = normalize({ ...state, modules: { ...state.modules, [key]: { ...state.modules[key], ...changes, followHull } } });
    if (storageKey && app.store.set(storageKey, next) === false) return false;
    state = next;
    render();
    return true;
  }
  app.productionScenario = { analyze, options, setModule, restore,
    snapshot: () => JSON.parse(JSON.stringify(state)) };
  window.addEventListener?.('rhw:transfer-imported', event => {
    if (!event.detail?.sections?.includes('preferences')) return;
    restore();
    app.shipyard?.restoreSelection();
    render();
  });
})();
