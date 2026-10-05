/* Production batch quantities come from the shared, corrected BMM planner. */
(function initRhwProductionModel() {
  'use strict';
  const app = window.RHWV4;
  const core = app?.operationsCore;
  if (!core || typeof PRODUCTION_MODULES === 'undefined') return;
  const plans = new Map();

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

  app.production = { requirements, recipes };
  // Semantics are normalized at order 10; the shared Command render follows
  // at order 40. Invalidate derived batches before that render.
  app.lifecycle.on('catalog:loaded', 'production-recipes', 30, () => { plans.clear(); });
})();
