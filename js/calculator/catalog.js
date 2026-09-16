/* ==========================================================================
   RHW WEB APP · V4.0 RECIPE CORRECTNESS PATCH
   Corrects known Discovery CFG semantics without changing the generated source
   assets in-place: deprecated recipes, affiliation-dependent outputs and fixed
   per-cycle recipe credit costs.
   ========================================================================== */
(function initRhwV4RecipeCorrections() {
  'use strict';
  const app = window.RHWV4;
  const core = app?.operationsCore;
  if (!app || !core || app.recipeCorrections) return;

  const DEPRECATED_RECIPE_IDS = new Set([
    'module_m_hyperspace_scanner',
    'module_m_cloakdisruptor'
  ]);
  const PRODUCT_NAMES = Object.freeze({
    commodity_gold: 'Gold',
    commodity_pirate_gold: 'Wildcat Gold',
    commodity_diamonds: 'Diamonds',
    commodity_bluediamonds: 'Hessian Tears'
  });

  const number = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const friendlyName = id => PRODUCT_NAMES[id] || String(id || '')
    .replace(/^commodity_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());

  function affiliationCandidates(recipe) {
    const result = [];
    const seen = new Set();
    for (const group of recipe?.affiliationOutputs || []) {
      for (const output of [group?.base, group?.alternate]) {
        if (!output?.id || seen.has(output.id)) continue;
        seen.add(output.id);
        result.push({ ...output, name: PRODUCT_NAMES[output.id] || output.name || friendlyName(output.id) });
      }
    }
    return result;
  }

  function outputFor(recipe, affiliationId) {
    const groups = recipe?.affiliationOutputs || [];
    if (!groups.length) return recipe?.outputs?.[0] || null;
    const group = groups[0];
    const selected = affiliationId === group.factionId ? group.alternate : group.base;
    return selected ? { ...selected, name: PRODUCT_NAMES[selected.id] || selected.name || friendlyName(selected.id) } : null;
  }

  function normalizeCatalog(catalog) {
    if (!catalog || catalog.__rhwV40Corrected === true) return catalog;
    const recipes = (catalog.recipes || []).filter(recipe => !DEPRECATED_RECIPE_IDS.has(recipe.id));
    const validRecipeIds = new Set(recipes.map(recipe => recipe.id));
    const productMap = new Map();

    for (const product of catalog.products || []) {
      const recipeIds = (product.recipeIds || []).filter(id => validRecipeIds.has(id));
      if (!recipeIds.length) continue;
      productMap.set(product.id, { ...product, recipeIds: [...recipeIds] });
    }

    for (const recipe of recipes) {
      const candidates = affiliationCandidates(recipe);
      if (!candidates.length) continue;
      const byproducts = (recipe.outputs || []).map(output => ({ ...output }));
      recipe.__rhwUnconditionalOutputs = byproducts;
      recipe.__rhwAffiliationCandidates = candidates;
      const defaultOutput = outputFor(recipe, app.config.operations.defaultAffiliation) || candidates[0];
      recipe.outputs = [
        defaultOutput,
        ...candidates.filter(output => output.id !== defaultOutput.id),
        ...byproducts
      ];

      for (const output of candidates) {
        let product = productMap.get(output.id);
        if (!product) {
          product = { id: output.id, name: PRODUCT_NAMES[output.id] || output.name || friendlyName(output.id), recipeIds: [] };
          productMap.set(output.id, product);
        }
        if (!product.name || product.name === product.id) product.name = PRODUCT_NAMES[output.id] || output.name || friendlyName(output.id);
        if (!product.recipeIds.includes(recipe.id)) product.recipeIds.push(recipe.id);
      }
    }

    catalog.recipes = recipes;
    catalog.products = [...productMap.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)) || a.id.localeCompare(b.id));
    catalog.meta = { ...catalog.meta, recipeCount: recipes.length, productCount: catalog.products.length };
    catalog.__rhwV40Corrected = true;

    core.state.catalog = catalog;
    core.state.productsById = new Map(catalog.products.map(product => [product.id, product]));
    core.state.recipesById = new Map(catalog.recipes.map(recipe => [recipe.id, recipe]));
    core.state.recipesByProduct = new Map();
    for (const product of catalog.products) {
      core.state.recipesByProduct.set(product.id, (product.recipeIds || []).map(id => core.state.recipesById.get(id)).filter(Boolean));
    }
    return catalog;
  }

  app.lifecycle.on('catalog:loaded', 'discovery-semantics', 10, ({ catalog }) => { normalizeCatalog(catalog); });

  function selfTest() {
    const failures = [];
    const catalog = core.state.catalog;
    if (catalog) {
      if (catalog.recipes.some(recipe => DEPRECATED_RECIPE_IDS.has(recipe.id))) failures.push('deprecated-recipes');
      const gold = core.recipe('recipe_gold_basic');
      const diamonds = core.recipe('recipe_diamonds_basic');
      if (gold && outputFor(gold, 'br_m_grp')?.id !== 'commodity_gold') failures.push('gold-bmm-output');
      if (gold && outputFor(gold, '__none__')?.id !== 'commodity_pirate_gold') failures.push('gold-default-output');
      if (diamonds && outputFor(diamonds, 'br_m_grp')?.id !== 'commodity_diamonds') failures.push('diamonds-bmm-output');
      if (core.recipe('module_coreupgrade') && number(core.recipe('module_coreupgrade').creditCost) !== 2500000) failures.push('core-upgrade-fee');
    }
    return failures;
  }

  app.recipeCorrections = {
    normalizeCatalog,
    outputFor,
    affiliationCandidates,
    selfTest,
    deprecatedRecipeIds: DEPRECATED_RECIPE_IDS
  };
})();
