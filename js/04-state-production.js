async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`TELEMETRY TIMEOUT AFTER ${Math.round(timeoutMs / 1000)}S`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function stockState(item) {
  if (!item || item.missing) return 'critical';
  const q = quantity(item);
  const nm = commodityKey(item);
  const custom = CUSTOM_ALERTS[nm];
  if (custom) {
    if (custom.type === 'max') return q >= custom.red ? 'critical' : (q >= custom.yellow ? 'low' : 'ok');
    return q < custom.red ? 'critical' : (q < custom.yellow ? 'low' : 'ok');
  }
  if (PROCUREMENT.includes(nm) || BYPRODUCTS.includes(nm) || CONFISCATED.includes(nm)) return 'ok';
  const min = minStock(item);
  if (min > 0 && q <= min * 0.25) return 'critical';
  if (min > 0 && q < min) return 'low';
  return 'ok';
}

const STATE_SEVERITY = Object.freeze({ ok: 0, low: 1, critical: 2 });

function strictestState(states = []) {
  return states.reduce((worst, state) =>
    (STATE_SEVERITY[state] ?? 0) > (STATE_SEVERITY[worst] ?? 0) ? state : worst
  , 'ok');
}

function shipyardComponentAnalysis(item) {
  const key = commodityKey(item);
  const component = CAPITAL_SHIPYARD?.components?.find(entry => keyFromName(entry.name) === key);
  if (!component) return null;
  const required = Math.max(1, Number(component.required) || 1);
  const stock = item && !item.missing ? quantity(item) : 0;
  const coverage = Math.floor(stock / required);
  return { required, stock, coverage, state: shipyardTrafficState(coverage) };
}

function stateForRole(item, role) {
  if (!item || item.missing) return 'critical';
  const key = commodityKey(item);
  if (role === 'shipyard') return shipyardComponentAnalysis(item)?.state || stockState(item);
  if (role === 'procurement' && FEEDSTOCK.includes(key)) return feedstockAnalysis(item).state;
  return stockState(item);
}

function operationalState(item) {
  const roles = assetRoles(item);
  if (!roles.length) return stockState(item);
  return strictestState(roles.map(role => stateForRole(item, role)));
}

function hasVerifiedTelemetry() {
  return Boolean(rhwBase && lastLoaded && Array.isArray(items));
}

// Keep snapshot availability separate from freshness. Cached stock is useful,
// but must carry its original timestamp through every screen and export.
function telemetrySnapshot(now = Date.now()) {
  const available = hasVerifiedTelemetry();
  const timestamp = available ? new Date(lastLoaded).getTime() : NaN;
  const fetchedAt = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  const ageMs = fetchedAt ? Math.max(0, now - timestamp) : null;
  const maxAge = (typeof DASHBOARD_CONFIG !== 'undefined' ? DASHBOARD_CONFIG.autoRefreshMs : 300000) * 2;
  const stale = available && (Boolean(dataIsStale) || !fetchedAt || ageMs > maxAge || (typeof navigator !== 'undefined' && navigator.onLine === false));
  const failed = typeof lastSyncError !== 'undefined' && Boolean(lastSyncError);
  const label = available ? (stale ? 'CACHED STOCK' : 'LIVE STOCK') : (failed ? 'TELEMETRY UNAVAILABLE' : 'AWAITING VERIFIED TELEMETRY');
  const detail = fetchedAt ? `${label} // SNAPSHOT ${fetchedAt} // AGE ${Math.floor(ageMs / 60000)} MIN` : `${label} // STOCK AND COVERAGE UNKNOWN`;
  return { available, stale, fetchedAt, ageMs, label, detail, tone: available && !stale ? 'good' : 'warn' };
}

function assetRoles(item) {
  const nm = commodityKey(item);
  const roles = [];
  if (MAINTENANCE.includes(nm)) roles.push('maintenance');
  if (EXPORTS.includes(nm)) roles.push('export');
  if (SHIPYARD.includes(nm)) roles.push('shipyard');
  if (BYPRODUCTS.includes(nm)) roles.push('byproduct');
  if (CONFISCATED.includes(nm)) roles.push('confiscated');
  if (PROCUREMENT.includes(nm) || FEEDSTOCK.includes(nm)) roles.push('procurement');
  return [...new Set(roles)];
}

function hasAssetRole(item, role) {
  return assetRoles(item).includes(role);
}

function assetRole(item) {
  return assetRoles(item)[0] || 'other';
}

function rebuildItemCaches() {
  const requiredKeys = [...FEEDSTOCK, ...MAINTENANCE, ...EXPORTS, ...SHIPYARD, ...BYPRODUCTS, ...CONFISCATED, ...PROCUREMENT].map(keyFromName);
  const augmentedItems = Array.isArray(items) ? [...items] : [];
  const existingKeys = new Set(augmentedItems.map(commodityKey));

  requiredKeys.forEach(reqKey => {
    if (existingKeys.has(reqKey)) return;
    augmentedItems.push({
      name: CANONICAL_NAMES[reqKey] || reqKey.toUpperCase(),
      quantity: 0,
      missing: true,
      synthetic: true,
      price_to_sell_to_base: null,
      price_to_buy_from_base: null
    });
    existingKeys.add(reqKey);
  });

  items = augmentedItems;
  itemsByKey = new Map();
  operationalItemsCache = [];
  const seenOperational = new Set();

  for (const item of items) {
    const key = commodityKey(item);
    if (!itemsByKey.has(key)) itemsByKey.set(key, item);
    if (!assetRoles(item).length || seenOperational.has(key)) continue;
    seenOperational.add(key);
    operationalItemsCache.push(item);
  }
}

function operationalItems() { return operationalItemsCache; }

function roleLabel(role) { 
  if (role === 'maintenance') return 'FACILITY'; 
  if (role === 'export') return 'EXPORT'; 
  if (role === 'shipyard') return 'SHIPYARD';
  if (role === 'byproduct') return 'WASTE'; 
  if (role === 'confiscated') return 'SEIZED';
  return 'PROCUREMENT'; 
}

function statusLabel(state, role) {
  if (role === 'byproduct' || role === 'confiscated') return state === 'critical' ? 'OVERFLOW' : (state === 'low' ? 'WARN' : 'STABLE');
  return state === 'critical' ? 'CRITICAL' : (state === 'low' ? 'LOW' : 'STABLE');
}

function rolePill(role) {
  let cls = 'buy';
  if (role === 'export') cls = 'both';
  if (role === 'maintenance') cls = 'sell';
  if (role === 'shipyard') cls = 'shipyard-pill';
  if (role === 'byproduct') cls = 'waste';
  if (role === 'confiscated') cls = 'confiscated-pill';
  return `<span class="pill ${cls}">${roleLabel(role)}</span>`;
}

function rolePillsFor(item) {
  const roles = assetRoles(item);
  if (!roles.length) return rolePill('procurement');
  return `<span class="role-pill-stack">${roles.map(role => rolePill(role)).join('')}</span>`;
}

function statusPill(state, role) { return `<span class="pill ${state}">${statusLabel(state, role)}</span>`; }
function firstValidPrice(item, keys) {
  if (!item || item.missing) return null;
  for (const key of keys) {
    if (item[key] === undefined || item[key] === null || item[key] === '') continue;
    const value = finiteNumber(item[key], null, 0);
    if (value !== null) return value;
  }
  return null;
}
function priceSell(item) { return firstValidPrice(item, ['price_to_sell_to_base', 'sell_price', 'price_sell', 'price']); }
function priceBuy(item) { return firstValidPrice(item, ['price_to_buy_from_base', 'buy_price', 'price_buy', 'price']); }
function findCommodity(name) { return itemsByKey.get(keyFromName(name)) || null; }
function stockFor(name) { const item = findCommodity(name); return item ? quantity(item) : 0; }
function displayRecipeName(name) { return displayName({ name }); }

function sortManifestBy(column) {
  if (!column) return;
  if (sortCol === column) sortAsc = !sortAsc;
  else { sortCol = column; sortAsc = true; }
  saveViewPreferences();
  renderManifest();
}

function handleSort(event) {
  const th = event.target.closest('th[data-sort]');
  if (th) sortManifestBy(th.dataset.sort);
}

function handleSortKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  const th = event.currentTarget;
  sortManifestBy(th?.dataset?.sort);
}

function updateSortArrows() {
  els.tableHeaders.forEach(th => {
    const active = th.dataset.sort === sortCol;
    if (active) th.setAttribute('data-dir', sortAsc ? 'asc' : 'desc');
    else th.removeAttribute('data-dir');
    th.setAttribute('aria-sort', active ? (sortAsc ? 'ascending' : 'descending') : 'none');
  });
}

function analyzeRecipe(recipe) {
  const productItem = findCommodity(recipe.product);
  const productStock = productItem ? quantity(productItem) : 0;

  const ingredientData = recipe.ingredients.map(pair => {
    const originalName = pair[0];
    const required = pair[1];
    
    let stock = 0;
    let displayNameStr = displayRecipeName(originalName);
    let extraHtml = '';

    if (keyFromName(originalName) === 'gold') {
      const stdGold = stockFor('Gold');
      const wcGold = stockFor('Wildcat Gold');
      stock = stdGold + wcGold;
      
      displayNameStr = 'Gold / Wildcat Gold';
      extraHtml = `<span style="display:block; font-size:9.5px; opacity:0.8; margin-top:3px; letter-spacing:0.05em; font-family:var(--font-tech);"><span style="color:var(--gold);">STD: ${number(stdGold)}</span> // <span style="color:#ce93d8;">WC: ${number(wcGold)}</span></span>`;
    } else {
      stock = stockFor(originalName);
    }

    const cycles = required > 0 ? Math.floor(stock / required) : 0;
    const currentCycleGap = Math.max(0, required - stock);
    return { name: originalName, displayName: displayNameStr, extraHtml, required, stock, cycles, currentCycleGap };
  });

  const possibleCycles = ingredientData.length ? Math.min(...ingredientData.map(i => i.cycles)) : 0;
  const possibleOutput = possibleCycles * recipe.output;
  ingredientData.forEach(ingredient => {
    ingredient.nextCycleGap = Math.max(0, ((possibleCycles + 1) * ingredient.required) - ingredient.stock);
    ingredient.nextGapRatio = ingredient.required > 0 ? ingredient.nextCycleGap / ingredient.required : 0;
  });
  const bottleneck = ingredientData.length ? ingredientData.reduce((lowest, current) => {
    if (current.cycles < lowest.cycles) return current;
    if (current.cycles > lowest.cycles) return lowest;
    if (current.nextGapRatio > lowest.nextGapRatio) return current;
    if (current.nextGapRatio < lowest.nextGapRatio) return lowest;
    return current.nextCycleGap > lowest.nextCycleGap ? current : lowest;
  }) : null;
  const nextCycleGap = bottleneck ? bottleneck.nextCycleGap : 0;
  const cardState = possibleCycles <= 0 ? 'critical' : possibleCycles < 10 ? 'low' : 'ok';

  return { recipe, productItem, productStock, ingredientData, possibleCycles, possibleOutput, bottleneck, nextCycleGap, cardState };
}

let productionModuleFilter = 'all';
let productionModuleQuery = '';
const productionExpandedModules = new Set();

function applyProductionModuleFilters() {
  const toolbar = document.getElementById('productionModuleTools');
  const cards = [...(els.productionGrid?.querySelectorAll('.production-card') || [])];
  let visible = 0;
  cards.forEach(card => {
    const stateMatch = productionModuleFilter === 'all' || card.dataset.productionState === productionModuleFilter;
    const queryMatch = !productionModuleQuery || (card.dataset.productionProduct || '').includes(productionModuleQuery);
    card.hidden = !(stateMatch && queryMatch);
    if (!card.hidden) visible += 1;
  });
  toolbar?.querySelectorAll('[data-production-filter]').forEach(button => {
    const active = button.dataset.productionFilter === productionModuleFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const count = document.getElementById('productionModuleCount');
  if (count) count.textContent = `${visible} / ${cards.length} MODULE${cards.length === 1 ? '' : 'S'}`;
  const empty = document.getElementById('productionFilterEmpty');
  if (empty) empty.hidden = visible > 0 || cards.length === 0;
}

function ensureProductionModuleTools() {
  if (!els.productionGrid) return;
  let toolbar = document.getElementById('productionModuleTools');
  if (!toolbar) {
    toolbar = document.createElement('div');
    toolbar.id = 'productionModuleTools';
    toolbar.className = 'production-module-tools';
    toolbar.setAttribute('aria-label', 'Production module filters');
    toolbar.innerHTML = `
      <div class="production-filter-row">
        <div class="production-filter-segments" role="group" aria-label="Filter production modules by readiness">
          <button type="button" class="active" data-production-filter="all" aria-pressed="true">ALL</button>
          <button type="button" data-production-filter="critical" aria-pressed="false">BLOCKED</button>
          <button type="button" data-production-filter="low" aria-pressed="false">LOW</button>
          <button type="button" data-production-filter="ok" aria-pressed="false">READY</button>
        </div>
        <label class="production-module-search">
          <span class="sr-only">Search production modules</span>
          <input id="productionModuleSearch" type="search" autocomplete="off" placeholder="SEARCH PRODUCT…" aria-label="Search production modules">
        </label>
        <span class="production-module-count" id="productionModuleCount" aria-live="polite">0 MODULES</span>
      </div>
      <div class="production-filter-empty" id="productionFilterEmpty" hidden>NO MODULES MATCH THIS FILTER</div>`;
    els.productionGrid.insertAdjacentElement('beforebegin', toolbar);
  }
  if (toolbar.dataset.bound !== 'true') {
    toolbar.dataset.bound = 'true';
    toolbar.addEventListener('click', event => {
      const button = event.target.closest('[data-production-filter]');
      if (!button) return;
      productionModuleFilter = button.dataset.productionFilter || 'all';
      applyProductionModuleFilters();
    });
    toolbar.querySelector('#productionModuleSearch')?.addEventListener('input', event => {
      productionModuleQuery = normalize(event.target.value);
      applyProductionModuleFilters();
    });
  }
  if (els.productionGrid.dataset.cardDetailsBound !== 'true') {
    els.productionGrid.dataset.cardDetailsBound = 'true';
    els.productionGrid.addEventListener('click', event => {
      const button = event.target.closest('.production-card-toggle');
      if (!button) return;
      const card = button.closest('.production-card');
      const key = card?.dataset.productionProduct || '';
      if (!card || !key) return;
      const expanded = card.classList.toggle('production-card-expanded');
      card.classList.toggle('production-card-collapsed', !expanded);
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      button.querySelector('span').textContent = expanded ? 'HIDE MATERIALS' : 'SHOW MATERIALS';
      if (expanded) productionExpandedModules.add(key);
      else productionExpandedModules.delete(key);
    });
  }
}

function renderProductionModules() {
  if (!els.productionGrid) return;
  ensureProductionModuleTools();
  if (!hasVerifiedTelemetry()) {
    const failed = Boolean(lastSyncError);
    els.productionGrid.innerHTML = `<div class="feature-empty production-empty">${failed ? 'TELEMETRY UNAVAILABLE' : 'AWAITING FIRST TELEMETRY BURST'}<small>${failed ? 'NO VERIFIED RHW INVENTORY IS AVAILABLE' : 'PRODUCTION ANALYSIS WILL APPEAR AFTER THE FIRST SUCCESSFUL SYNC'}</small></div>`;
    return;
  }
  if (!Array.isArray(RECIPES) || !RECIPES.length) {
    els.productionGrid.innerHTML = '<div class="feature-empty production-empty">PRODUCTION MODULES STANDBY<small>NO RECIPES CONFIGURED</small></div>';
    return;
  }

  els.productionGrid.innerHTML = RECIPES.map((recipe, index) => {
    const analysis = analyzeRecipe(recipe);
    const ingredientRows = analysis.ingredientData.map(item => {
      const isBottleneck = analysis.bottleneck && item.name === analysis.bottleneck.name;
      const shortText = item.currentCycleGap > 0
        ? `<span class="recipe-short">Short ${number(item.currentCycleGap)}</span>`
        : '';

      return `<li class="${isBottleneck ? 'bottleneck' : ''}">
                <span class="recipe-name">${escapeHTML(item.displayName)}${item.extraHtml || ''}${typeof purchaseSourceButton === 'function' ? purchaseSourceButton(item.name, item.currentCycleGap) : ''}</span>
                <span class="recipe-required">${number(item.required)}</span>
                <span class="recipe-stock">${number(item.stock)}${shortText}</span>
              </li>`;
    }).join('');

    const bottleneckDisplay = analysis.bottleneck ? (keyFromName(analysis.bottleneck.name) === 'gold' ? 'GOLD / WILDCAT GOLD' : escapeHTML(analysis.bottleneck.name).toUpperCase()) : '';
    const nextGapText = analysis.bottleneck
      ? `<div class="next-gap ${analysis.cardState}">NEXT +1 CYCLE: <strong>${bottleneckDisplay} +${number(analysis.nextCycleGap)}</strong></div>`
      : '';

    const byproductsText = recipe.byproducts && recipe.byproducts.length
      ? `<div class="byproduct-strip"><span>BYPRODUCT / CYCLE</span>${recipe.byproducts.map(bp => `<span class="byproduct-tag">${number(bp[1])} ${escapeHTML(displayRecipeName(bp[0]))}</span>`).join('')}</div>`
      : '';

    const productKey = normalize(displayRecipeName(recipe.product));
    const mobileCollapsed = window.matchMedia?.('(max-width: 760px)').matches && !productionExpandedModules.has(productKey);

    return `<div class="production-card ${analysis.cardState}${mobileCollapsed ? ' production-card-collapsed' : ' production-card-expanded'}" data-production-state="${analysis.cardState}" data-production-product="${escapeHTML(productKey)}">
              <div class="production-card-head">
                <div>
                  <div class="production-kicker">MODULE-${String(index + 1).padStart(2, '0')}</div>
                  <div class="production-title">${escapeHTML(displayRecipeName(recipe.product))}</div>
                  <div class="footnote">YIELD PER CYCLE: ${number(recipe.output)}</div>
                </div>
                <span class="module-state ${analysis.cardState}">${statusLabel(analysis.cardState, 'production')}</span>
              </div>
              <div class="production-stats">
                <div class="production-stat production-stock-primary"><small>IN STOCK</small><strong>${number(analysis.productStock)}</strong></div>
                <div class="production-stat"><small>MAX CYCLES</small><strong>${number(analysis.possibleCycles)}</strong></div>
                <div class="production-stat"><small>EST. YIELD</small><strong>${number(analysis.possibleOutput)}</strong></div>
              </div>
              ${nextGapText}
              <button type="button" class="production-card-toggle" aria-expanded="${mobileCollapsed ? 'false' : 'true'}"><span>${mobileCollapsed ? 'SHOW MATERIALS' : 'HIDE MATERIALS'}</span></button>
              <div class="recipe-column-head" aria-hidden="true">
                <span>Material</span><span>Required / Cycle</span><span>Current Stock</span>
              </div>
              <ul class="recipe-list">${ingredientRows}</ul>
              ${byproductsText}
            </div>`;
  }).join('');
  applyProductionModuleFilters();
}
