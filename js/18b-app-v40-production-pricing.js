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

  const STYLE_ID = 'rhwV40ProductionPricingStyle';
  const CALC_KEY = app.config.storageKeys.calculatorState;
  const DEFAULT_IFF = app.config.operations.defaultAffiliation;
  let productionObserver = null;
  let operationsObserver = null;
  let installed = false;

  const normalize = value => app.util.normalize(String(value || ''));

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.dataset.stylesheet = '35-app-interface-cleanup.css';
    document.head.appendChild(style);
  }

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

  function installStorageGuard() {
    if (app.store.__rhwV40SessionPriceGuard === true) return;
    const baseSet = app.store.set.bind(app.store);
    app.store.set = function guardedStoreSet(key, value) {
      if (key === CALC_KEY && value && typeof value === 'object') {
        const clean = { ...value };
        delete clean.materialPrices;
        return baseSet(key, clean);
      }
      return baseSet(key, value);
    };
    app.store.__rhwV40SessionPriceGuard = true;
  }

  function cleanCalculatorUi() {
    const workspace = document.getElementById('workspaceOperations');
    if (!workspace) return;
    workspace.querySelectorAll('[data-material-price]').forEach(input => {
      if (input.placeholder) input.placeholder = '';
      input.removeAttribute('data-price-source');
    });
    workspace.querySelectorAll('.ops-price-source').forEach(node => node.remove());

    const costHeadText = 'ENTER YOUR UNIT PRICES';
    const costHead = workspace.querySelector('.ops-cost-panel .ops-panel-head small');
    if (costHead && costHead.textContent !== costHeadText) costHead.textContent = costHeadText;
  }

  function startFreshRecipeSession() {
    clearSessionPrices();
    resetAffiliationToDefault();
  }

  function installCalculatorLifecycle() {
    const workspace = document.getElementById('workspaceOperations');
    if (!workspace) return;
    cleanCalculatorUi();
    if (workspace.dataset.v40SessionPriceMode === 'true') return;
    workspace.dataset.v40SessionPriceMode = 'true';

    // Recipe transitions are handled by operations.saveState after resolution.
    // Editing a search without changing the recipe preserves the current quote.
    operationsObserver = new MutationObserver(cleanCalculatorUi);
    operationsObserver.observe(workspace, { childList: true, subtree: true });

    // The legacy Shipyard planner uses a lexical openTarget() helper, so reset
    // RHW costing defaults in capture phase before that click handler runs.
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
    cleanCalculatorUi();
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

  function installProductionObserver() {
    const mount = document.getElementById('productionGrid');
    if (!mount) return;
    enhanceProduction();
    if (mount.dataset.v40ProductionCalculatorBridge === 'true') return;
    mount.dataset.v40ProductionCalculatorBridge = 'true';
    productionObserver = new MutationObserver(enhanceProduction);
    productionObserver.observe(mount, { childList: true, subtree: true });
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
    installStyles();
    installProductionObserver();
    installCalculatorLifecycle();
  }

  installStorageGuard();
  sanitizeStoredCalculator();
  clearSessionPrices();
  resetAffiliationToDefault();

  const originalInit = app.operations.init;
  app.operations.init = async function sessionPriceAwareInit(...args) {
    sanitizeStoredCalculator();
    clearSessionPrices();
    resetAffiliationToDefault();
    const result = await originalInit.apply(this, args);
    install();
    const failures = selfTest();
    if (failures.length) throw new Error(`V4 PRODUCTION/CALCULATOR BRIDGE SELF TEST FAILED: ${failures.join(', ')}`);
    return result;
  };

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
