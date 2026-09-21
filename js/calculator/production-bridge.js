/* ==========================================================================
   RHW WEB APP · V4.0 PRODUCTION → CALCULATOR BRIDGE
   Keeps the Production costing shortcut while ensuring calculator material
   prices are session-only and every new recipe starts from RHW's BMM IFF.
   ========================================================================== */
(function initRhwV4ProductionCalculatorBridge() {
  'use strict';
  const app = window.RHWV4;
  const core = app?.operationsCore;
  if (!app || !core || !app.operations) return;
  if (app.productionPricing) return;

  const CALC_KEY = app.config.storageKeys.calculatorState;
  const DEFAULT_IFF = app.config.operations.defaultAffiliation;
  let installed = false;

  const normalize = value => app.util.normalize(String(value || ''));

  function clearSessionPrices() {
    if (!app.state.calculator || typeof app.state.calculator !== 'object') return;
    app.state.calculator.materialPrices = {};
  }

  function resetAffiliationToDefault() {
    if (!app.state.calculator || typeof app.state.calculator !== 'object') return;
    app.state.calculator.affiliationId = DEFAULT_IFF;
    const select = document.getElementById('opsAffiliation');
    if (select && [...select.options].some(option => option.value === DEFAULT_IFF)) select.value = DEFAULT_IFF;
  }

  function sanitizeStoredCalculator() {
    const stored = app.store.get(CALC_KEY, null);
    if (!stored || typeof stored !== 'object') return;
    const clean = { ...stored, affiliationId: DEFAULT_IFF };
    delete clean.materialPrices;
    app.store.set(CALC_KEY, clean);
  }

  function startFreshRecipeSession() {
    clearSessionPrices();
    resetAffiliationToDefault();
  }

  function installCalculatorLifecycle() {
    const workspace = document.getElementById('workspaceOperations');
    if (!workspace) return;
    if (workspace.dataset.v40SessionPriceMode === 'true') return;
    workspace.dataset.v40SessionPriceMode = 'true';

    // Reset the costing session before the Shipyard opens its selected recipe.
    document.addEventListener('click', event => {
      if (event.target?.closest?.('.shipyard-plan-button')) startFreshRecipeSession();
    }, true);
  }

  function recipeDisplayName(recipe) {
    if (!recipe) return '';
    const alias = app.operations?.recipeAliases?.[recipe.id];
    const output = recipe.outputs?.[0];
    const product = output ? core.product(output.id) : null;
    return alias?.name || product?.name || output?.name || recipe.name || recipe.id || '';
  }

  function findRecipeForLabel(label) {
    const target = normalize(label);
    if (!target || !core.state.catalog) return null;
    const recipes = [...(core.state.catalog.recipes || [])];
    const scored = recipes.map(recipe => {
      const output = recipe.outputs?.[0];
      const product = output ? core.product(output.id) : null;
      const names = [recipeDisplayName(recipe), product?.name, output?.name, recipe.name, recipe.id]
        .filter(Boolean).map(normalize);
      let score = 99;
      if (names.some(name => name === target)) score = 0;
      else if (names.some(name => name.startsWith(target) || target.startsWith(name))) score = 1;
      else if (names.some(name => name.includes(target) || target.includes(name))) score = 2;
      return { recipe, score };
    }).filter(entry => entry.score < 99);
    scored.sort((a, b) => a.score - b.score || recipeDisplayName(a.recipe).localeCompare(recipeDisplayName(b.recipe)) || a.recipe.id.localeCompare(b.recipe.id));
    return scored[0]?.recipe || null;
  }

  function saveCalculatorTarget(recipe, quantity = 1) {
    const output = recipe?.outputs?.[0];
    if (!recipe || !output) return false;
    const current = app.state.calculator || {};
    app.state.calculator = {
      ...current,
      productId: output.id,
      recipeId: recipe.id,
      quantity: Math.max(1, Math.floor(Number(quantity) || 1)),
      search: recipeDisplayName(recipe),
      affiliationId: DEFAULT_IFF,
      materialPrices: {}
    };
    app.store.set(CALC_KEY, app.state.calculator);
    return true;
  }

  function openProductionTarget(label, quantity = 1) {
    const recipe = findRecipeForLabel(label);
    if (!recipe || !saveCalculatorTarget(recipe, quantity)) {
      app.notify?.(`NO CALCULATOR RECIPE FOUND // ${String(label || 'UNKNOWN TARGET').toUpperCase()}`, 'warn');
      return false;
    }
    app.navigate('operations', 'calculator');
    app.operations.renderCalculator?.();
    return true;
  }

  function enhanceProduction() {
    const mount = document.getElementById('productionGrid');
    if (!mount) return;
    mount.querySelectorAll('.production-card').forEach(card => {
      if (card.querySelector('.production-calc-button')) return;
      const title = card.querySelector('.production-title');
      if (!title) return;
      const label = title.textContent.trim();
      if (!findRecipeForLabel(label)) return;
      const host = card.querySelector('.production-card-head > div') || title.parentElement;
      if (!host) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'production-calc-button';
      button.dataset.productionCostTarget = label;
      button.textContent = 'COST / CALCULATE';
      button.title = `Open ${label} in the RHW Item Calculator`;
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openProductionTarget(label, 1);
      });
      host.appendChild(button);
    });
  }

  function installProductionBridge() {
    const mount = document.getElementById('productionGrid');
    if (!mount) return;
    enhanceProduction();
    if (mount.dataset.v40ProductionCalculatorBridge === 'true') return;
    mount.dataset.v40ProductionCalculatorBridge = 'true';
    app.onRender('production', enhanceProduction);
  }

  function selfTest() {
    const failures = [];
    const persisted = app.store.get(CALC_KEY, {}) || {};
    if (Object.prototype.hasOwnProperty.call(persisted, 'materialPrices')) failures.push('price-persistence');
    const persistedRecipe = core.recipe(persisted.recipeId) || core.recipesFor(persisted.productId)[0] || null;
    const defaultIffAvailable = !persistedRecipe?.restricted
      || (persistedRecipe?.bonuses || []).some(entry => entry.id === DEFAULT_IFF);
    if (defaultIffAvailable && persisted.affiliationId && persisted.affiliationId !== DEFAULT_IFF) failures.push('stored-default-iff');
    if (document.querySelector('.ops-price-source')) failures.push('legacy-price-source-ui');
    document.querySelectorAll('#workspaceOperations [data-material-price]').forEach(input => {
      if (input.placeholder) failures.push('price-placeholder');
    });
    try {
      if (typeof RECIPES !== 'undefined') {
        RECIPES.forEach(recipe => {
          if (!findRecipeForLabel(recipe.product)) failures.push(`production-recipe:${recipe.product}`);
        });
      }
    } catch {
      failures.push('production-recipe-scan');
    }
    return [...new Set(failures)];
  }

  function install() {
    if (installed) return;
    installed = true;

    installProductionBridge();
    installCalculatorLifecycle();
  }

  sanitizeStoredCalculator();
  clearSessionPrices();
  resetAffiliationToDefault();

  app.lifecycle.on('calculator:before-init', 'session-prices', 10, () => {
    sanitizeStoredCalculator();
    clearSessionPrices();
    resetAffiliationToDefault();
  });
  app.lifecycle.on('calculator:ready', 'production-bridge', 10, () => {
    install();
    const failures = selfTest();
    if (failures.length) throw new Error(`V4 PRODUCTION/CALCULATOR BRIDGE SELF TEST FAILED: ${failures.join(', ')}`);
  });

  app.productionPricing = {
    install,
    enhanceProduction,
    openProductionTarget,
    findRecipeForLabel,
    clearSessionPrices,
    resetAffiliationToDefault,
    selfTest
  };
})();
