/* ==========================================================================
   RHW WEB APP · V4.0 OPERATIONS UI
   Recipe lookup, IFF-aware material costing and sale-price calculator.
   ========================================================================== */
(function initRhwV4OperationsUi() {
  'use strict';
  const app = window.RHWV4;
  const core = app?.operationsCore;
  if (!app || !core) return;

  const NODES = Object.freeze([
    ['calculator', 'ITEM CALCULATOR', 'RECIPE + COSTING']
  ]);
  const RECIPE_ALIASES = Object.freeze({
    ship_assembly_li_frigate: Object.freeze({
      outputId: 'li_frigate_package', name: '"Longhorn" Liberty Heavy Frigate',
      terms: 'longhorn liberty heavy frigate'
    }),
    // CFG produces medium_miner_package (Modular Miner); the civilian recipe
    // requires blueprint_medium_miner (Archon Design Schematics).
    ship_assembly_medium_miner: Object.freeze({
      outputId: 'medium_miner_package', name: '"Archon" Modular Miner',
      terms: 'archon modular miner medium miner'
    }),
    ship_assembly_medium_miner_legit: Object.freeze({
      outputId: 'medium_miner_package', name: '"Archon" Modular Miner',
      terms: 'archon modular miner medium miner kishiro gmg samura'
    }),
    ship_assembly_dsy_barge: Object.freeze({
      outputId: 'dsy_barge_package',
      name: '"Bustard" Civilian Light Carrier',
      terms: 'bustard civilian light carrier civilian carrier'
    })
  });
  let rerenderTimer = null;

  const esc = value => app.util.escape(value);
  const fmt = value => app.util.number(Math.max(0, Number(value) || 0));
  function num(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
  function clampMargin(value) { return Math.max(0, Math.min(95, num(value, 20))); }
  function money(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return `$${Math.round(Number(value)).toLocaleString('en-US')}`;
  }

  function currentState() {
    const base = app.state.calculator || {};
    return {
      productId: base.productId || app.config.operations.defaultProduct,
      recipeId: base.recipeId || '',
      quantity: Math.max(1, Math.floor(num(base.quantity, 1))),
      affiliationId: base.affiliationId || app.config.operations.defaultAffiliation,
      search: typeof base.search === 'string' ? base.search : '',
      marginPercent: clampMargin(base.marginPercent),
      materialPrices: base.materialPrices && typeof base.materialPrices === 'object' ? { ...base.materialPrices } : {}
    };
  }

  function saveState(patch) {
    const current = currentState();
    const changedRecipe = patch.recipeId && patch.recipeId !== current.recipeId;
    app.state.calculator = { ...current, ...(changedRecipe ? { materialPrices: {}, affiliationId: app.config.operations.defaultAffiliation } : {}), ...patch, ...(changedRecipe ? { materialPrices: {} } : {}) };
    app.store.set(app.config.storageKeys.calculatorState, app.state.calculator);
  }

  function workspaceMarkup() {
    return `<div class="operations-frame">
      <header class="workspace-heading operations-heading"><div><div class="workspace-kicker"><span>OPERATIONS</span> RHW INDUSTRIAL COSTING NETWORK</div><h2>ITEM CALCULATOR</h2><p>RECIPE LOOKUP // IFF MATERIAL REQUIREMENTS // BUILD COST // SALE PRICE</p></div><div class="workspace-status" id="operationsStatus" data-tone="muted">LOADING RECIPE DATABASE</div></header>
      <nav id="operationsNodeNav" class="workspace-subnav operations-subnav" aria-label="Operations tools"><div class="workspace-subnav-label">OPERATIONS NODES</div><div class="workspace-subnav-tabs">${NODES.map(([key, label, sub]) => `<button type="button" data-operations-node="${key}"><span>${label}</span><small>${sub}</small></button>`).join('')}</div></nav>
      <div id="operationsNodeHost" class="operations-node-host"><section data-operations-panel="calculator" class="operations-node-panel"><div id="operationsCalculatorMount" class="ops-loading">LOADING DISCOVERY RECIPE DATABASE…</div></section></div>
    </div>`;
  }

  const primaryOutput = recipe => recipe?.outputs?.[0] || null;
  const recipeProduct = recipe => { const output = primaryOutput(recipe); return output ? core.product(output.id) : null; };
  function recipeAlias(recipe) {
    const direct = RECIPE_ALIASES[recipe?.id];
    if (direct) return direct;
    const outputId = primaryOutput(recipe)?.id;
    return Object.values(RECIPE_ALIASES).find(alias => alias.outputId === outputId) || null;
  }
  function recipeDisplayName(recipe) {
    const alias = recipeAlias(recipe);
    const product = recipeProduct(recipe);
    return alias?.name || product?.name || recipe?.name || recipe?.id || 'UNKNOWN RECIPE';
  }
  function recipeSearchText(recipe) {
    const product = recipeProduct(recipe);
    const alias = recipeAlias(recipe);
    return app.util.normalize([
      alias?.name, alias?.terms, product?.name, product?.id, recipe?.name, recipe?.id, recipe?.craftType,
      ...(recipe?.outputs || []).flatMap(output => [output.name, output.id])
    ].filter(Boolean).join(' '));
  }
  function matchingRecipes(search) {
    const query = app.util.normalize(search);
    const score = recipe => {
      if (!query) return 0;
      const alias = recipeAlias(recipe);
      const names = [recipeDisplayName(recipe), recipeProduct(recipe)?.name, recipe.name,
        recipe.id, alias?.terms].filter(Boolean).map(app.util.normalize);
      if (names.some(name => name === query)) return 4;
      if (names.some(name => name.startsWith(query))) return 3;
      if (names.some(name => name.split(/[^a-z0-9]+/).includes(query))) return 2;
      return recipeSearchText(recipe).includes(query) ? 1 : 0;
    };
    return [...(core.state.catalog?.recipes || [])]
      .map(recipe => ({ recipe, score: score(recipe) }))
      .filter(entry => !query || entry.score > 0)
      .sort((a, b) => b.score - a.score || recipeDisplayName(a.recipe).localeCompare(recipeDisplayName(b.recipe)) || a.recipe.id.localeCompare(b.recipe.id))
      .map(entry => entry.recipe);
  }
  function recipeLabel(recipe) {
    const product = recipeProduct(recipe);
    const name = recipeDisplayName(recipe);
    const variants = product ? core.recipesFor(product.id) : [];
    if (variants.length <= 1) return name;
    const qualifier = recipe.craftType || recipe.name || recipe.id;
    return `${name} · ${app.util.normalize(qualifier) === app.util.normalize(name) ? recipe.id : qualifier}`;
  }
  function recipeOptions(recipes, selectedId) {
    return recipes.length
      ? recipes.map(recipe => `<option value="${esc(recipe.id)}"${recipe.id === selectedId ? ' selected' : ''}>${esc(recipeLabel(recipe))}</option>`).join('')
      : '<option value="">NO MATCHING RECIPES</option>';
  }

  function materialFactorLabel(value) {
    const percentage = Math.round(Math.abs(1 - Number(value)) * 100);
    return percentage ? `${percentage}% ${value < 1 ? 'LESS' : 'MORE'} MATERIAL` : 'NO BONUS';
  }

  function iffEntries(recipe, selectedId) {
    const bonuses = [...(recipe?.bonuses || [])];
    if (recipe?.restricted) {
      return bonuses
        .sort((a, b) => {
          if (a.id === 'br_m_grp') return -1;
          if (b.id === 'br_m_grp') return 1;
          return String(a.name || a.id).localeCompare(String(b.name || b.id));
        })
        .map(bonus => ({
          id: bonus.id,
          factor: Number(bonus.factor || 1),
          name: `${bonus.id === 'br_m_grp' ? 'BMM' : (bonus.name || bonus.id)} · AUTHORIZED IFF${Number(bonus.factor || 1) !== 1 ? ` · ${Number(bonus.factor || 1).toFixed(2)}×` : ''}`
        }));
    }

    const entries = [];
    const seen = new Set();
    const add = (id, name, factor) => { if (!id || seen.has(id)) return; seen.add(id); entries.push({ id, name, factor }); };
    const bmmFactor = core.factorFor(recipe, 'br_m_grp');
    add('br_m_grp', bmmFactor !== 1 ? `BMM · ${materialFactorLabel(bmmFactor)}` : 'BMM · NO BONUS', bmmFactor);
    add('__none__', 'NO IFF BONUS · 1.00×', 1);
    for (const bonus of bonuses) {
      if (bonus.id !== 'br_m_grp') add(bonus.id, `${bonus.name || bonus.id} · ${materialFactorLabel(Number(bonus.factor || 1))}`, Number(bonus.factor || 1));
    }
    if (selectedId && !seen.has(selectedId)) {
      const faction = core.state.catalog?.factions?.find(entry => entry.id === selectedId);
      add(selectedId, `${faction?.name || selectedId} · NO BONUS`, 1);
    }
    return entries;
  }

  function resolveSelection(raw) {
    const calc = { ...raw };
    const matches = matchingRecipes(calc.search);
    if (calc.search && !matches.length) return { calc, matches, recipe: null };
    let recipe = core.recipe(calc.recipeId);
    if (!recipe && !calc.search && calc.productId) recipe = core.recipesFor(calc.productId)[0] || null;
    if (!recipe || (calc.search && !matches.some(entry => entry.id === recipe.id))) recipe = matches[0] || null;
    if (!recipe) recipe = core.state.catalog?.recipes?.[0] || null;
    if (!recipe) return { calc, matches, recipe: null };
    if (recipe.id !== raw.recipeId) {
      calc.materialPrices = {};
      calc.affiliationId = app.config.operations.defaultAffiliation;
    }
    const output = primaryOutput(recipe);
    calc.recipeId = recipe.id;
    calc.productId = output?.id || calc.productId;
    const iff = iffEntries(recipe, calc.affiliationId);
    if (!iff.some(entry => entry.id === calc.affiliationId)) {
      calc.affiliationId = iff.find(entry => entry.id === app.config.operations.defaultAffiliation)?.id || iff[0]?.id || '__none__';
    }
    return { calc, matches, recipe };
  }

  function buildQuote(calc) {
    return core.buildPlan({ productId: calc.productId, recipeId: calc.recipeId, quantity: calc.quantity, affiliationId: calc.affiliationId, useInventory: false, recursive: false, routingPolicy: 'first', altSelections: {} });
  }

  function currentOrderTarget() {
    const resolved = resolveSelection(currentState());
    const recipe = resolved.recipe;
    if (!recipe) return null;
    const output = primaryOutput(recipe);
    return {
      productId: output?.id || resolved.calc.productId,
      recipeId: recipe.id,
      quantity: resolved.calc.quantity,
      affiliationId: resolved.calc.affiliationId,
      productName: recipeDisplayName(recipe),
      recipeName: recipeLabel(recipe)
    };
  }

  function materialRows(plan) {
    const map = new Map();
    for (const row of plan.directRequirements || []) {
      const id = row.item?.id || row.item?.name || 'unknown';
      const current = map.get(id) || { id, name: row.item?.name || id, required: 0 };
      current.required += Math.max(0, Number(row.required) || 0);
      map.set(id, current);
    }
    return [...map.values()];
  }

  function storedPrice(prices, id) {
    if (!Object.prototype.hasOwnProperty.call(prices, id)) return null;
    const raw = prices[id];
    if (raw === '' || raw === null || raw === undefined) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function materialsMarkup(rows, calc) {
    if (!rows.length) return '<div class="ops-empty good">THIS RECIPE HAS NO CONSUMED MATERIAL INPUTS</div>';
    return `<div class="ops-material-table-wrap"><table class="ops-material-table"><thead><tr><th>MATERIAL</th><th>REQUIRED</th><th>PRICE / UNIT</th><th>LINE COST</th></tr></thead><tbody>${rows.map(row => {
      const price = storedPrice(calc.materialPrices, row.id);
      return `<tr class="ops-material-row" data-material-id="${esc(row.id)}" data-required="${row.required}"><td><strong>${esc(row.name)}</strong><details class="ops-material-id"><summary>ITEM ID</summary><small>${esc(row.id)}</small></details></td><td>${fmt(row.required)}</td><td><div class="ops-price-input-wrap"><input class="ops-price-input" aria-label="${esc(row.name)} price per unit" data-material-price="${esc(row.id)}" type="number" inputmode="decimal" min="0" step="1" value="${price === null ? '' : esc(String(price))}" placeholder="0"><span>$</span></div></td><td data-line-cost>${money(price === null ? null : row.required * price)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function notesMarkup(plan) {
    if (!plan.catalysts?.length && !plan.byproducts?.length) return '';
    const catalysts = plan.catalysts?.length ? plan.catalysts.map(row => `${row.name} × ${fmt(row.qty)}`).join(' · ') : 'NONE';
    const byproducts = plan.byproducts?.length ? plan.byproducts.map(row => `${row.name} × ${fmt(row.qty)}`).join(' · ') : 'NONE';
    return `<details class="ops-details"><summary>RECIPE NOTES</summary><div><strong>RETAINED / NOT CONSUMED</strong><span>${esc(catalysts)}</span><strong>BYPRODUCTS / NOT CREDITED AGAINST COST</strong><span>${esc(byproducts)}</span></div></details>`;
  }

  function pricingMessage(pricing) {
    if (!pricing.complete) return `${pricing.missingCount} MATERIAL PRICE${pricing.missingCount === 1 ? '' : 'S'} STILL MISSING // ADD MATERIAL PRICES TO COMPLETE THE QUOTE`;
    return `ALL MATERIALS PRICED // ${pricing.recipeFee ? 'FIXED RECIPE FEE INCLUDED // ' : ''}SALE QUOTE READY`;
  }

  function quoteMarkup(pricing, calc, rows, actualOutput) {
    const total = pricing.complete ? money(pricing.totalCost) : `${money(pricing.knownCost)} PARTIAL`;
    return `<div class="ops-pricing-summary">
      <div class="ops-priced-state"><span>PRICE COVERAGE</span><strong id="opsPriceCoverage" class="${pricing.complete ? 'good' : 'warn'}">${pricing.pricedCount} / ${rows.length} MATERIALS</strong></div>
      <div class="ops-pricing-flow">
        <section class="ops-flow-card ops-flow-cost"><small>01 · FULL BUILD COST</small><strong id="opsTotalCost">${total}</strong><span>TOTAL BUILD COST</span><div><em>COST / PRODUCED ITEM</em><b id="opsUnitCost">${money(pricing.unitCost)}</b></div></section>
        <div class="ops-flow-arrow" aria-hidden="true">›</div>
        <label class="ops-flow-card ops-flow-margin"><small>02 · TARGET PROFIT MARGIN</small><div class="ops-margin-input"><input id="opsMargin" type="number" inputmode="decimal" min="0" max="95" step="1" value="${esc(String(calc.marginPercent))}"><span>%</span></div><strong id="opsMarginLabel">${calc.marginPercent}% MARGIN</strong><p>PROFIT AS SHARE OF SELL PRICE</p></label>
        <div class="ops-flow-arrow" aria-hidden="true">›</div>
        <section class="ops-flow-card ops-flow-sell"><small>03 · RECOMMENDED SALE</small><strong id="opsSellUnit">${money(pricing.sellPerUnit)}</strong><span>SELL PRICE / ITEM</span><div><em>FOR ${fmt(actualOutput)} PRODUCED</em><b>RHW QUOTE</b></div></section>
      </div>
      <div class="ops-profit-strip">
        <div><small>PROFIT / ITEM</small><strong id="opsProfitUnit">${money(pricing.profitUnit)}</strong></div>
        <div><small>TOTAL PROFIT</small><strong id="opsProfit">${money(pricing.profit)}</strong></div>
        <div class="ops-revenue-line"><small>TOTAL REVENUE // ${fmt(actualOutput)} PRODUCED</small><strong id="opsRevenue">${money(pricing.revenue)}</strong></div>
      </div>
      <div id="opsPricingWarning" class="ops-cost-note ${pricing.complete ? 'good' : 'warn'}">${pricingMessage(pricing)}</div>
      <button type="button" id="opsCompletePrices"${pricing.complete ? ' hidden' : ''}>COMPLETE MISSING PRICES</button>
    </div>`;
  }

  function noMatchMarkup(calc, catalog) {
    return `<div class="operations-layout-simple"><section class="ops-panel ops-setup-panel"><div class="ops-panel-head"><div><span>01</span><strong>RECIPE</strong></div></div><div class="ops-form-grid"><label class="comms-field ops-wide"><span>SEARCH RECIPE</span><input id="opsRecipeSearch" type="search" value="${esc(calc.search)}" placeholder="Bustard, Superstructure, Reactor, Gold…" autocomplete="off"><small>TYPE A NAME OR RECIPE ID</small></label></div><div class="ops-empty ops-no-match">NO MATCHING RECIPE<small>TRY A DIFFERENT ITEM OR RECIPE NAME</small></div></section></div>`;
  }

  function bindSearchOnly() {
    document.getElementById('opsRecipeSearch')?.addEventListener('input', event => {
      const search = event.target.value;
      saveState({ search });
      if (!search.trim() || matchingRecipes(search).length) scheduleRender({ search }, { focusSearch: true, delay: 120 });
    });
  }

  function renderCalculator({ focusSearch = false } = {}) {
    const mount = document.getElementById('operationsCalculatorMount');
    const catalog = core.state.catalog;
    if (!mount || !catalog) return;

    const resolved = resolveSelection(currentState());
    const calc = resolved.calc;
    saveState(calc);
    if (calc.search && !resolved.matches.length) {
      mount.className = 'operations-calculator';
      mount.innerHTML = noMatchMarkup(calc, catalog);
      bindSearchOnly();
      const search = document.getElementById('opsRecipeSearch');
      if (focusSearch && search) { search.focus(); try { search.setSelectionRange(search.value.length, search.value.length); } catch {} }
      return;
    }

    const recipe = resolved.recipe;
    if (!recipe) { mount.innerHTML = '<div class="ops-empty danger">NO RECIPE AVAILABLE</div>'; return; }
    let plan;
    try { plan = buildQuote(calc); }
    catch (error) { mount.innerHTML = `<div class="ops-empty danger">CALCULATION FAILED<small>${esc(error.message)}</small></div>`; return; }

    core.state.currentPlan = plan;
    const rows = materialRows(plan);
    const pricing = core.priceQuote(rows, calc, plan);
    const iff = iffEntries(recipe, calc.affiliationId);
    const outputPerCycle = Math.max(1, Number(plan.tree?.outputPerCycle) || Number(primaryOutput(recipe)?.qty) || 1);
    const matches = resolved.matches.length ? resolved.matches : matchingRecipes('');
    const iffHint = recipe.restricted ? 'RESTRICTED RECIPE // ONLY AUTHORIZED IFF PROFILES ARE SHOWN' : 'BMM IS PRESELECTED FOR RHW';

    mount.className = 'operations-calculator';
    mount.innerHTML = `<div class="operations-layout-simple">
      <section class="ops-panel ops-setup-panel">
        <div class="ops-panel-head"><div><span>01</span><strong>RECIPE</strong></div></div>
        <div class="ops-form-grid">
          <label class="comms-field ops-wide"><span>SEARCH RECIPE</span><input id="opsRecipeSearch" type="search" value="${esc(calc.search)}" placeholder="Bustard, Superstructure, Reactor, Gold…" autocomplete="off"><small>TYPE A NAME OR RECIPE ID // FIRST MATCH IS SELECTED AUTOMATICALLY</small></label>
          <label class="comms-field ops-wide"><span>SELECTED RECIPE</span><select id="opsRecipe">${recipeOptions(matches, calc.recipeId)}</select><small>${matches.length} MATCH${matches.length === 1 ? '' : 'ES'} // ${esc(recipe.craftType || recipe.sourceType || 'GENERAL')}${recipe.restricted ? ' // RESTRICTED IFF' : ''}</small></label>
          <label class="comms-field"><span>OUTPUT QUANTITY</span><div class="ops-quantity-control"><button type="button" data-ops-quantity="-1" aria-label="Decrease output quantity">−</button><input id="opsQuantity" aria-label="Output quantity" type="number" inputmode="numeric" min="1" step="1" value="${calc.quantity}"><button type="button" data-ops-quantity="1" aria-label="Increase output quantity">+</button></div></label>
          <label class="comms-field"><span>AFFILIATION / IFF</span><select id="opsAffiliation">${iff.map(entry => `<option value="${esc(entry.id)}"${entry.id === calc.affiliationId ? ' selected' : ''}>${esc(entry.name)}</option>`).join('')}</select><small>${esc(iffHint)}</small></label>
        </div>
        <div class="ops-recipe-meta"><div><small>OUTPUT / CYCLE</small><strong>${fmt(outputPerCycle)}</strong></div><div><small>CYCLES</small><strong>${fmt(plan.cycles)}</strong></div><div><small>ACTUAL OUTPUT</small><strong>${fmt(plan.actualOutput)}</strong></div></div>

        <div class="ops-mobile-decision" aria-label="Current quote summary"><div><small>RECOMMENDED SALE</small><strong id="opsMobileSellUnit">${money(pricing.sellPerUnit)}</strong></div><div><small>COST / ITEM</small><strong id="opsMobileUnitCost">${money(pricing.unitCost)}</strong></div><div><small>TOTAL PROFIT</small><strong id="opsMobileProfit">${money(pricing.profit)}</strong></div></div>
        <nav class="ops-mobile-jumps" aria-label="Calculator sections"><button type="button" data-ops-jump="opsMaterialPanel">ENTER MATERIAL PRICES</button><button type="button" data-ops-jump="opsQuotePanel">VIEW FULL QUOTE</button></nav>
      </section>
      <section class="ops-panel ops-cost-panel" id="opsMaterialPanel"><div class="ops-panel-head"><div><span>02</span><strong>MATERIAL COST</strong></div><small>ENTER YOUR UNIT PRICES</small></div>${materialsMarkup(rows, calc)}${plan.recipeFeeTotal ? `<div class="ops-recipe-fee"><div><small>FIXED RECIPE FEE · INCLUDED IN QUOTE</small><strong>${money(plan.recipeFeePerCycle)} / CYCLE × ${fmt(plan.cycles)}</strong></div><b>${money(plan.recipeFeeTotal)}</b></div>` : ''}<div class="ops-price-memory">Prices apply to this calculation. Save a price profile to reuse them.</div>${notesMarkup(plan)}<button class="ops-mobile-quote-jump" type="button" data-ops-jump="opsQuotePanel">VIEW UPDATED QUOTE</button></section>
      <section class="ops-panel ops-quote-panel" id="opsQuotePanel"><div class="ops-panel-head"><div><span>03</span><strong>PRICE CALCULATION</strong></div><small>COST → MARGIN → SELL PRICE</small></div>${quoteMarkup(pricing, calc, rows, plan.actualOutput)}</section>
    </div>`;
    bindCalculator(plan, rows);
    if (focusSearch) {
      const search = document.getElementById('opsRecipeSearch');
      if (search) { search.focus(); try { search.setSelectionRange(search.value.length, search.value.length); } catch {} }
    }
  }

  function scheduleRender(patch = {}, options = {}) {
    saveState(patch);
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(() => renderCalculator({ focusSearch: options.focusSearch || false }), options.delay ?? 45);
  }

  function updatePricing(plan, rows) {
    const calc = currentState();
    const pricing = core.priceQuote(rows, calc, plan);
    document.querySelectorAll('.ops-material-row').forEach(row => {
      const id = row.dataset.materialId || '';
      const required = num(row.dataset.required);
      const price = storedPrice(calc.materialPrices, id);
      const target = row.querySelector('[data-line-cost]');
      if (target) target.textContent = money(price === null ? null : required * price);
    });
    const write = (id, value) => { const target = document.getElementById(id); if (target) target.textContent = value; };
    write('opsPriceCoverage', `${pricing.pricedCount} / ${rows.length} MATERIALS`);
    const coverage = document.getElementById('opsPriceCoverage'); if (coverage) coverage.className = pricing.complete ? 'good' : 'warn';
    write('opsTotalCost', pricing.complete ? money(pricing.totalCost) : `${money(pricing.knownCost)} PARTIAL`);
    write('opsUnitCost', money(pricing.unitCost));
    write('opsMarginLabel', `${calc.marginPercent}% MARGIN`);
    write('opsSellUnit', money(pricing.sellPerUnit));
    write('opsMobileSellUnit', money(pricing.sellPerUnit));
    write('opsMobileUnitCost', money(pricing.unitCost));
    write('opsMobileProfit', money(pricing.profit));
    write('opsProfitUnit', money(pricing.profitUnit));
    write('opsProfit', money(pricing.profit));
    write('opsRevenue', money(pricing.revenue));
    const warning = document.getElementById('opsPricingWarning');
    const completePrices = document.getElementById('opsCompletePrices');
    if (completePrices) completePrices.hidden = pricing.complete;
    if (warning) {
      warning.className = `ops-cost-note ${pricing.complete ? 'good' : 'warn'}`;
      warning.textContent = pricingMessage(pricing);
    }
  }

  function bindCalculator(plan, rows) {
    document.getElementById('opsCompletePrices')?.addEventListener('click', () => {
      const missing = [...document.querySelectorAll('[data-material-price]')].find(input => input.value.trim() === '');
      if (!missing) return;
      missing.scrollIntoView({ behavior: 'smooth', block: 'center' });
      missing.focus({ preventScroll: true });
    });
    document.getElementById('opsRecipeSearch')?.addEventListener('input', event => {
      const search = event.target.value;
      const matches = matchingRecipes(search);
      const select = document.getElementById('opsRecipe');
      if (select) select.innerHTML = recipeOptions(matches, matches[0]?.id || '');
      if (!matches.length) { scheduleRender({ search }, { focusSearch: true, delay: 160 }); return; }
      const recipe = matches[0];
      scheduleRender({ search, recipeId: recipe.id, productId: primaryOutput(recipe)?.id || currentState().productId }, { focusSearch: true, delay: 140 });
    });
    document.getElementById('opsRecipe')?.addEventListener('change', event => {
      const recipe = core.recipe(event.target.value); if (!recipe) return;
      scheduleRender({ recipeId: recipe.id, productId: primaryOutput(recipe)?.id || currentState().productId });
    });
    document.getElementById('opsQuantity')?.addEventListener('change', event => scheduleRender({ quantity: Math.max(1, Math.floor(num(event.target.value, 1))) }));
    document.querySelectorAll('[data-ops-quantity]').forEach(button => button.addEventListener('click', () => {
      const input = document.getElementById('opsQuantity');
      const next = Math.max(1, Math.floor(num(input?.value, 1)) + num(button.dataset.opsQuantity));
      scheduleRender({ quantity: next });
    }));
    document.querySelectorAll('[data-ops-jump]').forEach(button => button.addEventListener('click', () => {
      document.getElementById(button.dataset.opsJump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    document.getElementById('opsAffiliation')?.addEventListener('change', event => scheduleRender({ affiliationId: event.target.value }));
    document.querySelectorAll('[data-material-price]').forEach(input => input.addEventListener('input', event => {
      const calc = currentState(); const prices = { ...calc.materialPrices }; const key = event.target.dataset.materialPrice;
      if (event.target.value === '') delete prices[key]; else prices[key] = Math.max(0, num(event.target.value));
      saveState({ materialPrices: prices }); updatePricing(plan, rows);
    }));
    document.getElementById('opsMargin')?.addEventListener('input', event => {
      if (event.target.value === '') return;
      const value = clampMargin(event.target.value);
      event.target.value = String(value);
      saveState({ marginPercent: value });
      updatePricing(plan, rows);
    });

  }

  function installShipyardBridge() {
    const mount = document.getElementById('shipyardControl');
    if (!mount || mount.dataset.v40PlannerBridge === 'true') return;
    mount.dataset.v40PlannerBridge = 'true';
    const enhance = () => mount.querySelectorAll('.hull-registry-row').forEach(row => {
      if (row.querySelector('.shipyard-plan-button')) return;
      const label = row.querySelector('.hull-registry-name'); if (!label) return;
      const text = app.util.normalize(label.textContent);
      const target = text.includes('dunkirk') ? app.config.operations.shipyardTargets.dunkirk : text.includes('invincible') ? app.config.operations.shipyardTargets.invincible : null;
      if (!target) return;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'shipyard-plan-button'; button.textContent = 'PRICE / PLAN 1 HULL';
      button.addEventListener('click', event => { event.stopPropagation(); openTarget(target, 1); });
      label.appendChild(button);
    });
    enhance();
    new MutationObserver(enhance).observe(mount, { childList: true, subtree: true });
  }

  function openTarget(productId, quantity = 1) {
    const recipe = core.recipesFor(productId)[0]; const product = core.product(productId);
    if (!recipe) return;
    openSelection({ productId, recipeId: recipe.id, quantity, affiliationId: app.config.operations.defaultAffiliation, productName: recipeDisplayName(recipe) || product?.name || '' });
  }

  function openSelection(selection = {}) {
    const recipe = core.recipe(selection.recipeId) || core.recipesFor(selection.productId)[0];
    const product = core.product(selection.productId);
    if (!recipe) return;
    saveState({
      productId: selection.productId,
      recipeId: recipe.id,
      quantity: Math.max(1, Math.floor(num(selection.quantity, 1))),
      affiliationId: selection.affiliationId || app.config.operations.defaultAffiliation,
      search: selection.productName || recipeDisplayName(recipe) || product?.name || ''
    });
    app.navigate('operations', 'calculator'); renderCalculator();
  }

  function activate(node, { updateRoute = true } = {}) {
    const valid = NODES.some(([key]) => key === node) ? node : 'calculator';
    app.state.operationsNode = valid;
    app.store.set(app.config.storageKeys.operationsNode, valid);
    document.body.dataset.operationsNode = valid;
    document.querySelectorAll('[data-operations-node]').forEach(button => {
      const active = button.dataset.operationsNode === valid;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    document.querySelectorAll('[data-operations-panel]').forEach(panel => { panel.hidden = panel.dataset.operationsPanel !== valid; });
    const orders = valid === 'orders';
    const heading = document.querySelector('.operations-heading h2');
    const subheading = document.querySelector('.operations-heading p');
    if (heading) heading.textContent = orders ? 'PRODUCTION ORDERS' : 'ITEM CALCULATOR';
    if (subheading) subheading.textContent = orders ? 'PRIORITY QUEUE // AGGREGATED MATERIALS // FORUM REPORT' : 'RECIPE LOOKUP // IFF MATERIAL REQUIREMENTS // BUILD COST // SALE PRICE';
    app.setActiveNode(`OPERATIONS / ${orders ? 'PRODUCTION ORDERS' : 'ITEM CALCULATOR'}`);
    document.title = `RHW ${orders ? 'PRODUCTION ORDERS' : 'ITEM CALCULATOR'} · ${app.version}`;
    if (updateRoute && app.state.activeWorkspace === 'operations') app.route.write('operations', valid);
    if (orders) app.productionOrders?.activate?.();
    else if (core.state.catalog) renderCalculator();
  }

  async function init() {
    const workspace = document.getElementById('workspaceOperations');
    if (!workspace || document.getElementById('operationsNodeNav')) return;
    workspace.innerHTML = workspaceMarkup();
    document.getElementById('operationsNodeNav')?.addEventListener('click', event => {
      const button = event.target.closest('[data-operations-node]');
      if (button) app.navigate('operations', button.dataset.operationsNode);
    });
    app.state.calculator = { ...currentState(), ...(app.store.get(app.config.storageKeys.calculatorState, {}) || {}) };
    try {
      const catalog = await core.loadCatalog();
      const status = document.getElementById('operationsStatus');
      if (status) { status.textContent = `${fmt(catalog.meta.recipeCount)} RECIPES // COSTING READY`; status.dataset.tone = 'good'; }
      renderCalculator();
    } catch (error) {
      const mount = document.getElementById('operationsCalculatorMount');
      const status = document.getElementById('operationsStatus');
      if (mount) mount.innerHTML = `<div class="ops-empty danger">RECIPE DATABASE FAILED TO LOAD<small>${esc(error.message)}</small></div>`;
      if (status) { status.textContent = 'RECIPE DATABASE ERROR'; status.dataset.tone = 'danger'; }
      throw error;
    }
    installShipyardBridge();
  }

  app.operations = { init, activate, openTarget, openSelection, renderCalculator, currentOrderTarget, matchingRecipes, nodes: NODES, recipeAliases: RECIPE_ALIASES };
})();
