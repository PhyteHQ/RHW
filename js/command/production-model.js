/* Production batch quantities come from the shared, corrected BMM planner. */
(function initRhwProductionModel() {
  'use strict';
  const app = window.RHWV4;
  const core = app?.operationsCore;
  if (!core || typeof PRODUCTION_MODULES === 'undefined') return;
  const plans = new Map();
  const selections = { ...(app.store.get(app.config.storageKeys.calculatorState, {})?.altSelections || {}) };

  function selectionsFor(recipeId) {
    return core.normalizeAlternatives(core.recipe(recipeId), selections);
  }

  function selectAlternative(recipeId, groupIndex, optionId) {
    if (!PRODUCTION_MODULES.some(module => module.recipeId === recipeId)) return false;
    const recipe = core.recipe(recipeId);
    const group = core.alternativeGroups(recipe).find(entry => entry.index === Number(groupIndex));
    if (!group?.options.some(option => option.id === optionId)) return false;
    selections[group.key] = optionId;
    const calc = app.state.calculator || app.store.get(app.config.storageKeys.calculatorState, {}) || {};
    app.state.calculator = { ...calc, altSelections: { ...(calc.altSelections || {}), [group.key]: optionId } };
    app.store.set(app.config.storageKeys.calculatorState, app.state.calculator);
    plans.delete(recipeId);
    window.renderAll?.();
    app.requestUiUpdate?.();
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
        useInventory: false, routingPolicy: 'first', altSelections: selectionsFor(recipe.id) });
      const materials = core.materialRows(plan);
      if (!(plan.actualOutput > 0) || !materials.length || materials.some(row => !(row.required > 0))) return null;
      const batch = Object.freeze({ ...module, output: plan.actualOutput,
        altSelections: Object.freeze(selectionsFor(recipe.id)),
        alternatives: core.alternativeGroups(recipe, selections),
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
    const batches = PRODUCTION_MODULES.map(requirements);
    return batches.length && batches.every(Boolean) ? batches : [];
  }

  app.production = { requirements, recipes, selectionsFor, selectAlternative };
  // Semantics are normalized at order 10; the shared Command render follows
  // at order 40. Invalidate derived batches before that render.
  app.lifecycle.on('catalog:loaded', 'production-recipes', 30, () => { plans.clear(); });
})();
