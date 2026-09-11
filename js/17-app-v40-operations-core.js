/* ==========================================================================
   RHW WEB APP · V4.0 OPERATIONS CORE
   Discovery recipe catalog + recursive fabrication planner.
   ========================================================================== */
(function initRhwV4OperationsCore() {
  'use strict';
  const app = window.RHWV4;
  if (!app) return;

  const state = { catalog: null, productsById: new Map(), recipesById: new Map(), recipesByProduct: new Map(), loadPromise: null };
  function displayName(item) { return item?.name || item?.id || 'UNASSIGNED ITEM'; }
  function indexCatalog(catalog) {
    state.catalog = catalog;
    state.productsById = new Map((catalog.products || []).map(product => [product.id, product]));
    state.recipesById = new Map((catalog.recipes || []).map(recipe => [recipe.id, recipe]));
    state.recipesByProduct = new Map();
    for (const product of catalog.products || []) state.recipesByProduct.set(product.id, (product.recipeIds || []).map(id => state.recipesById.get(id)).filter(Boolean));
    return catalog;
  }
  async function decodeCompressedCatalog(encoded) {
    if (typeof DecompressionStream !== 'function') throw new Error('BROWSER DOES NOT SUPPORT GZIP RECIPE CATALOG');
    const bytes = Uint8Array.from(atob(String(encoded || '').replace(/\s+/g, '')), char => char.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  async function loadCatalog() {
    if (state.catalog) return state.catalog;
    if (state.loadPromise) return state.loadPromise;
    state.loadPromise = (async () => {
      const embedded = window.__RHW_RECIPE_CATALOG__;
      if (embedded?.meta && Array.isArray(embedded.recipes)) return indexCatalog(embedded);
      const encoded = window.__RHW_RECIPE_CATALOG_GZIP_BASE64__;
      if (!encoded) throw new Error('RECIPE CATALOG ASSET NOT LOADED');
      const catalog = await decodeCompressedCatalog(encoded);
      if (!catalog?.meta || !Array.isArray(catalog.products) || !Array.isArray(catalog.recipes)) throw new Error('INVALID RECIPE CATALOG');
      return indexCatalog(catalog);
    })().catch(error => { state.loadPromise = null; throw error; });
    return state.loadPromise;
  }
  function product(id) { return state.productsById.get(id) || { id, name: id, recipeIds: [] }; }
  function recipesFor(id) { return state.recipesByProduct.get(id) || []; }
  function recipe(id) { return state.recipesById.get(id) || null; }
  function mainOutput(recipeEntry, productId) { return recipeEntry?.outputs?.find(output => output.id === productId) || recipeEntry?.outputs?.[0] || { id: productId, qty: 1, name: displayName(product(productId)) }; }
  function factorFor(recipeEntry, affiliationId) {
    if (!affiliationId || affiliationId === '__none__') return 1;
    const bonus = (recipeEntry?.bonuses || []).find(entry => entry.id === affiliationId);
    return bonus ? Math.max(0, Number(bonus.factor) || 1) : 1;
  }
  function authorizedFor(recipeEntry, affiliationId) {
    if (!recipeEntry?.restricted) return true;
    return Boolean(affiliationId && affiliationId !== '__none__' && (recipeEntry.bonuses || []).some(entry => entry.id === affiliationId));
  }
  function adjustedPerCycle(value, factor) {
    const raw = Math.max(0, Number(value) || 0) * Math.max(0, Number(factor) || 1);
    return raw <= 0 ? 0 : Math.ceil(raw - 1e-9);
  }
  function telemetryReady() { try { return typeof hasVerifiedTelemetry === 'function' && hasVerifiedTelemetry(); } catch { return false; } }
  function telemetryQuantity(option) {
    if (!telemetryReady()) return 0;
    try { if (typeof findCommodity !== 'function' || typeof quantity !== 'function') return 0; const item = findCommodity(option?.name || option?.id || ''); return item ? Math.max(0, Number(quantity(item)) || 0) : 0; }
    catch { return 0; }
  }
  function chooseInputOption(group, context, recipeId, groupIndex) {
    const options = group?.options || [];
    if (!options.length) return null;
    const explicit = context.altSelections?.[`${recipeId}:${groupIndex}`];
    if (explicit) { const selected = options.find(option => option.id === explicit); if (selected) return selected; }
    if (options.length === 1 || context.routingPolicy === 'first') return options[0];
    return [...options].sort((a, b) => {
      const stockDiff = telemetryQuantity(b) - telemetryQuantity(a); if (stockDiff) return stockDiff;
      const craftDiff = Number(recipesFor(b.id).length > 0) - Number(recipesFor(a.id).length > 0); if (craftDiff) return -craftDiff;
      return String(a.name || a.id).localeCompare(String(b.name || b.id));
    })[0];
  }
  function createPool(useInventory) {
    const quantities = new Map(), generated = new Map();
    const key = option => option.id || option.name;
    function base(option) { const id = key(option); if (!quantities.has(id)) quantities.set(id, useInventory ? telemetryQuantity(option) : 0); return quantities.get(id) || 0; }
    return {
      take(option, wanted) {
        const amount = Math.max(0, Number(wanted) || 0), id = key(option), generatedAmount = generated.get(id) || 0;
        const fromGenerated = Math.min(generatedAmount, amount); if (fromGenerated) generated.set(id, generatedAmount - fromGenerated);
        const remaining = amount - fromGenerated, baseAmount = base(option), fromBase = Math.min(baseAmount, remaining); if (fromBase) quantities.set(id, baseAmount - fromBase);
        return { used: fromGenerated + fromBase, fromGenerated, fromBase, missing: amount - fromGenerated - fromBase };
      },
      add(option, amount) { const id = key(option); generated.set(id, (generated.get(id) || 0) + Math.max(0, Number(amount) || 0)); },
      original(option) { return useInventory ? telemetryQuantity(option) : 0; }
    };
  }
  function addMap(map, item, amount) { const key = item.id || item.name, current = map.get(key) || { id: item.id || key, name: item.name || key, qty: 0 }; current.qty += Math.max(0, Number(amount) || 0); map.set(key, current); }
  function maxMap(map, item, amount) { const key = item.id || item.name, current = map.get(key) || { id: item.id || key, name: item.name || key, qty: 0 }; current.qty = Math.max(current.qty, Math.max(0, Number(amount) || 0)); map.set(key, current); }

  function buildPlan(options = {}) {
    if (!state.catalog) throw new Error('RECIPE CATALOG NOT LOADED');
    const productId = options.productId;
    const targetQty = Math.max(1, Math.floor(Number(options.quantity) || 1));
    const rootRecipes = recipesFor(productId);
    if (!rootRecipes.length) throw new Error('NO RECIPE FOR SELECTED TARGET');
    const rootRecipe = recipe(options.recipeId) || rootRecipes[0];
    const affiliationId = options.affiliationId || app.config.operations.defaultAffiliation;
    if (!authorizedFor(rootRecipe, affiliationId)) throw new Error('RESTRICTED RECIPE REQUIRES AN AUTHORIZED IFF');
    const recursive = options.recursive !== false;
    const useInventory = options.useInventory !== false && telemetryReady();
    const context = { affiliationId, recursive, useInventory, routingPolicy: options.routingPolicy === 'first' ? 'first' : 'stock', altSelections: options.altSelections || {}, maxDepth: app.config.operations.maxTreeDepth || 18 };
    const pool = createPool(useInventory), external = new Map(), catalysts = new Map(), byproducts = new Map(), generatedOutputs = new Map();
    let totalTime = 0, processCount = 0;

    function fabricate(productIdInner, requiredQty, chosenRecipe, depth, stack) {
      const recipeEntry = chosenRecipe || recipesFor(productIdInner)[0];
      if (!recipeEntry || !authorizedFor(recipeEntry, context.affiliationId)) {
        const item = product(productIdInner); addMap(external, item, requiredQty);
        return { type: 'external', item, required: requiredQty, usedStock: 0, missing: requiredQty, children: [] };
      }
      if (depth > context.maxDepth || stack.includes(productIdInner)) {
        const item = product(productIdInner); addMap(external, item, requiredQty);
        return { type: 'circular', item, required: requiredQty, usedStock: 0, missing: requiredQty, children: [] };
      }
      const output = mainOutput(recipeEntry, productIdInner), outputPerCycle = Math.max(1, Number(output.qty) || 1), cycles = Math.ceil(requiredQty / outputPerCycle), actualOutput = cycles * outputPerCycle, surplus = Math.max(0, actualOutput - requiredQty), factor = factorFor(recipeEntry, context.affiliationId), children = [];
      processCount += 1; totalTime += adjustedPerCycle(recipeEntry.cookingRate, factor) * cycles;
      for (let index = 0; index < (recipeEntry.inputs || []).length; index += 1) {
        const group = recipeEntry.inputs[index], selected = chooseInputOption(group, context, recipeEntry.id, index); if (!selected) continue;
        const totalRequired = adjustedPerCycle(selected.qty, factor) * cycles, before = pool.original(selected), usage = pool.take(selected, totalRequired);
        let child = { type: usage.missing > 0 ? 'input' : 'stock', item: selected, required: totalRequired, stockAvailable: before, usedStock: usage.used, missing: usage.missing, groupKind: group.kind, recipeId: recipeEntry.id, groupIndex: index, children: [] };
        if (usage.missing > 0 && context.recursive && recipesFor(selected.id).length) { const nested = fabricate(selected.id, usage.missing, null, depth + 1, [...stack, productIdInner]); child = { ...child, type: nested.type === 'external' ? 'external' : 'crafted', crafted: nested, children: [nested], missing: nested.type === 'external' ? usage.missing : 0 }; }
        else if (usage.missing > 0) { addMap(external, selected, usage.missing); child.type = 'external'; }
        children.push(child);
      }
      for (const catalyst of recipeEntry.catalysts || []) maxMap(catalysts, catalyst, Number(catalyst.qty) || 0);
      for (const outputEntry of recipeEntry.outputs || []) { if (outputEntry.id === productIdInner) continue; const amount = Math.max(0, Number(outputEntry.qty) || 0) * cycles; addMap(byproducts, outputEntry, amount); pool.add(outputEntry, amount); }
      if (surplus) { const productEntry = product(productIdInner); pool.add(productEntry, surplus); addMap(generatedOutputs, productEntry, surplus); }
      return { type: 'recipe', item: product(productIdInner), recipe: recipeEntry, required: requiredQty, cycles, outputPerCycle, actualOutput, surplus, factor, processTime: adjustedPerCycle(recipeEntry.cookingRate, factor) * cycles, children };
    }

    const rootOutput = mainOutput(rootRecipe, productId), rootOutputPerCycle = Math.max(1, Number(rootOutput.qty) || 1), rootCycles = Math.ceil(targetQty / rootOutputPerCycle), rootActual = rootCycles * rootOutputPerCycle, rootSurplus = Math.max(0, rootActual - targetQty), rootFactor = factorFor(rootRecipe, affiliationId);
    processCount += 1; totalTime += adjustedPerCycle(rootRecipe.cookingRate, rootFactor) * rootCycles;
    const rootChildren = [], directRequirements = [];
    for (let index = 0; index < (rootRecipe.inputs || []).length; index += 1) {
      const group = rootRecipe.inputs[index], selected = chooseInputOption(group, context, rootRecipe.id, index); if (!selected) continue;
      const totalRequired = adjustedPerCycle(selected.qty, rootFactor) * rootCycles, originalStock = pool.original(selected), usage = pool.take(selected, totalRequired);
      const direct = { item: selected, required: totalRequired, stockAvailable: originalStock, usedStock: usage.used, gapBeforeCrafting: usage.missing, groupKind: group.kind, recipeId: rootRecipe.id, groupIndex: index };
      let node = { type: usage.missing > 0 ? 'input' : 'stock', ...direct, missing: usage.missing, children: [] };
      if (usage.missing > 0 && recursive && recipesFor(selected.id).length) { const nested = fabricate(selected.id, usage.missing, null, 1, [productId]); node = { ...node, type: nested.type === 'external' ? 'external' : 'crafted', crafted: nested, children: [nested], missing: nested.type === 'external' ? usage.missing : 0 }; }
      else if (usage.missing > 0) { addMap(external, selected, usage.missing); node.type = 'external'; }
      directRequirements.push(direct); rootChildren.push(node);
    }
    for (const catalyst of rootRecipe.catalysts || []) maxMap(catalysts, catalyst, Number(catalyst.qty) || 0);
    for (const outputEntry of rootRecipe.outputs || []) if (outputEntry.id !== productId) addMap(byproducts, outputEntry, Math.max(0, Number(outputEntry.qty) || 0) * rootCycles);

    const catalystRows = [...catalysts.values()].map(entry => ({ ...entry, stock: useInventory ? telemetryQuantity(entry) : 0 }));
    const externalRows = [...external.values()].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
    const directNeeded = directRequirements.reduce((sum, entry) => sum + entry.required, 0), directCovered = directRequirements.reduce((sum, entry) => sum + Math.min(entry.required, entry.stockAvailable), 0), directCoverage = directNeeded > 0 ? Math.round((directCovered / directNeeded) * 100) : 100;
    return {
      product: product(productId), targetQty, rootRecipe, rootFactor, cycles: rootCycles, actualOutput: rootActual, surplus: rootSurplus,
      useInventory, telemetryReady: telemetryReady(), recursive, directRequirements,
      tree: { type: 'recipe', item: product(productId), recipe: rootRecipe, required: targetQty, cycles: rootCycles, outputPerCycle: rootOutputPerCycle, actualOutput: rootActual, surplus: rootSurplus, factor: rootFactor, processTime: adjustedPerCycle(rootRecipe.cookingRate, rootFactor) * rootCycles, children: rootChildren },
      external: externalRows, catalysts: catalystRows, byproducts: [...byproducts.values()], generatedSurplus: [...generatedOutputs.values()], totalTime, processCount, directCoverage, affiliationId
    };
  }

  // Numeric plan data is the only costing input; formatted DOM values are display-only.
  function priceQuote(rows, calc, plan) {
    let materialCost = 0;
    let pricedCount = 0;
    for (const row of rows) {
      const raw = calc.materialPrices?.[row.id];
      if (raw === '' || raw == null || !Number.isFinite(Number(raw)) || Number(raw) < 0) continue;
      pricedCount += 1;
      materialCost += row.required * Number(raw);
    }
    const recipeFee = Math.max(0, Number(plan.recipeFeeTotal) || 0);
    const knownCost = materialCost + recipeFee;
    const missingCount = rows.length - pricedCount;
    const complete = missingCount === 0;
    const totalCost = complete ? knownCost : null;
    const output = Number(plan.actualOutput);
    const unitCost = complete && output > 0 ? totalCost / output : null;
    const margin = Number.isFinite(Number(calc.marginPercent)) ? Math.max(0, Math.min(95, Number(calc.marginPercent))) : 20;
    const sellPerUnit = unitCost === null ? null : Math.ceil(unitCost / Math.max(0.05, 1 - margin / 100));
    const profitUnit = sellPerUnit === null ? null : sellPerUnit - unitCost;
    const revenue = sellPerUnit === null ? null : sellPerUnit * output;
    const profit = revenue === null ? null : revenue - totalCost;
    return { materialCost, recipeFee, knownCost, pricedCount, missingCount, complete, totalCost, unitCost, sellPerUnit, profitUnit, revenue, profit };
  }

  function materialRows(plan) {
    const rows = new Map();
    for (const entry of plan.directRequirements || []) {
      const id = entry.item.id;
      const row = rows.get(id) || { id, name: entry.item.name || id, required: 0 };
      row.required += entry.required;
      rows.set(id, row);
    }
    return [...rows.values()];
  }

  function effectiveOutput(entry, affiliationId) {
    return app.recipeCorrections?.outputFor(entry, affiliationId) || entry?.outputs?.[0] || null;
  }

  // Every variant uses the same requested quantity, IFF and price map. Build
  // through the public corrected planner so fees, rounding and IFF outputs agree
  // with the main quote. Stock and byproduct values never discount build cost.
  function compareRecipes(calc) {
    const selected = recipe(calc.recipeId);
    const output = effectiveOutput(selected, calc.affiliationId);
    if (!output) return { output: null, entries: [], materials: [], bestIds: [], complete: false };
    const materials = new Map();
    const entries = (state.catalog?.recipes || [])
      .filter(entry => effectiveOutput(entry, calc.affiliationId)?.id === output.id)
      .map(entry => {
        if (!authorizedFor(entry, calc.affiliationId)) return { recipe: entry, authorized: false };
        const plan = app.operationsCore.buildPlan({ productId: output.id, recipeId: entry.id,
          quantity: calc.quantity, affiliationId: calc.affiliationId, recursive: false,
          useInventory: false, routingPolicy: 'first', altSelections: {} });
        const rows = materialRows(plan);
        for (const row of rows) if (!materials.has(row.id)) materials.set(row.id, row);
        return { recipe: entry, authorized: true, plan, rows, pricing: priceQuote(rows, calc, plan) };
      });
    const available = entries.filter(entry => entry.authorized);
    const complete = available.length > 0 && available.every(entry => entry.pricing.complete);
    const best = complete ? Math.min(...available.map(entry => entry.pricing.unitCost)) : null;
    const bestIds = complete ? available.filter(entry => Math.abs(entry.pricing.unitCost - best) < 1e-8).map(entry => entry.recipe.id) : [];
    return { output, entries, materials: [...materials.values()], complete, bestIds };
  }

  app.operationsCore = { state, loadCatalog, product, recipe, recipesFor, factorFor, authorizedFor, telemetryReady, telemetryQuantity, buildPlan, priceQuote, displayName, materialRows, effectiveOutput, compareRecipes };
})();
