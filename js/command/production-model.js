/* Independent recipe quantities and reference cycle times from the BMM catalog. */
(function initRhwProductionModel() {
  'use strict';
  const app = window.RHWV4;
  const core = app?.operationsCore;
  if (!core || typeof PRODUCTION_MODULES === 'undefined') return;
  const plans = new Map();
  const moxRecipes = Object.freeze([
    Object.freeze({ recipeId: 'recipe_mox_fuel_basic', label: 'BASIC · TOXIC WASTE ONLY' }),
    Object.freeze({ recipeId: 'recipe_mox_fuel_advanced', label: 'ADVANCED · WASTE + URANIUM' })
  ]);
  const moxKey = app.config.storageKeys?.moxRecipe;
  let moxRecipe = moxKey ? app.store?.get(moxKey, moxRecipes[0].recipeId) : moxRecipes[0].recipeId;
  if (!moxRecipes.some(entry => entry.recipeId === moxRecipe)) moxRecipe = moxRecipes[0].recipeId;

  function modules() {
    return PRODUCTION_MODULES.map(module => module.product === 'MOX' ? { ...module, recipeId: moxRecipe } : module);
  }

  function selectMoxRecipe(recipeId) {
    if (!moxRecipes.some(entry => entry.recipeId === recipeId)) return false;
    if (moxKey && app.store?.set(moxKey, recipeId) === false) return false;
    moxRecipe = recipeId;
    return true;
  }

  function requirements(module) {
    if (!core.state.catalog || !module) return null;
    const recipe = core.recipe(module.recipeId);
    if (!recipe || !core.authorizedFor(recipe, app.config.operations.defaultAffiliation)) return null;
    const cached = plans.get(module.recipeId);
    if (cached?.source === recipe) return cached.batch;
    try {
      const output = core.effectiveOutput(recipe, app.config.operations.defaultAffiliation);
      if (!output?.id) return null;
      const plan = core.buildPlan({ productId: output.id, recipeId: recipe.id, quantity: 1,
        affiliationId: app.config.operations.defaultAffiliation, recursive: false,
        useInventory: false, routingPolicy: 'first' });
      const materials = core.materialRows(plan);
      if (!(plan.actualOutput > 0) || !materials.length || materials.some(row => !(row.required > 0))) return null;
      const batch = Object.freeze({ ...module, output: plan.actualOutput,
        // These are interchangeable stocks, not a player-selected recipe mode.
        // Keep catalog order (for example Gold before Wildcat Gold).
        inputOptions: Object.freeze(Object.fromEntries((recipe.inputs || [])
          .filter(group => group.options.length > 1)
          .map(group => [group.options[0].name, Object.freeze(group.options.map(option => option.name))]))),
        ingredients: Object.freeze(materials.map(row => Object.freeze([row.name, row.required]))),
        byproducts: Object.freeze(plan.byproducts.map(row => Object.freeze([row.name, row.qty]))),
        prerequisites: Object.freeze(plan.catalysts.map(row => Object.freeze([row.name, row.qty]))) });
      plans.set(module.recipeId, { source: recipe, batch });
      return batch;
    } catch {
      // Missing/restricted catalog data must never become a zero-input batch
      // or silently select another recipe for the same product.
      return null;
    }
  }

  function recipes() {
    return modules().map(requirements).filter(Boolean);
  }

  function cycleSeconds(recipeId) {
    const recipe = core.recipe(recipeId);
    if (!recipe || !core.authorizedFor(recipe, app.config.operations.defaultAffiliation)
      || !(recipe.cookingRate > 0)) return null;
    let volume = 0;
    for (const group of recipe.inputs || []) {
      const first = group.options[0];
      if (!first || group.options.some(option => option.qty !== first.qty)) return null;
      const unitVolume = globalThis.RHW_PRODUCTION_VOLUMES?.[first.id];
      if (!Number.isFinite(unitVolume) || unitVolume < 0) return null;
      volume += first.qty * unitVolume;
    }
    const seconds = volume / recipe.cookingRate * 60;
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  app.production = { requirements, recipes, cycleSeconds, modules, moxRecipes, selectMoxRecipe };
  window.addEventListener?.('rhw:transfer-imported', event => {
    if (!event.detail?.sections?.includes('preferences') || !moxKey) return;
    const saved = app.store.get(moxKey, moxRecipes[0].recipeId);
    moxRecipe = moxRecipes.some(entry => entry.recipeId === saved) ? saved : moxRecipes[0].recipeId;
    window.renderAll?.();
    app.requestUiUpdate?.();
  });
  // Semantics are normalized at order 10; the shared Command render follows
  // at order 40. Invalidate derived batches before that render.
  app.lifecycle.on('catalog:loaded', 'production-recipes', 30, () => { plans.clear(); });
})();
