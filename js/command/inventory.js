function feedstockAnalysis(item) {
  const key = commodityKey(item);
  const recipes = productionRecipes();
  if (!recipes.length) return { key, required: null, quantity: quantity(item), cycles: null, state: 'waiting', perRecipeRequirements: [] };
  const perRecipeRequirements = recipes.map(recipe => recipe.ingredients
    .filter(([ingredientName]) => keyFromName(ingredientName) === key)
    .reduce((sum, [, amount]) => sum + (Number(amount) || 0), 0))
    .filter(required => required > 0);
  const required = perRecipeRequirements.length ? Math.max(...perRecipeRequirements) : 0;
  const q = quantity(item);
  const cycles = required > 0 ? Math.floor(q / required) : 0;
  const state = cycles <= 0 ? 'critical' : cycles < 10 ? 'low' : 'ok';
  return { key, required, quantity: q, cycles, state, perRecipeRequirements };
}

function updateDataFreshnessIndicators() {
  const stale = telemetrySnapshot().stale;
  document.body.classList.toggle('stale-data', stale);
  document.body.classList.toggle('no-telemetry', !hasVerifiedTelemetry());
  const time = lastLoaded ? lastLoaded.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  document.querySelectorAll('[data-freshness-badge]').forEach(badge => {
    badge.hidden = !stale;
    badge.textContent = stale ? `CACHE · ${time}` : '';
    badge.title = stale ? `Displaying the last verified local inventory from ${time}` : '';
  });
  updateTelemetryNotice();
}

function updateTelemetryNotice() {
  const notice = document.getElementById('telemetryNotice');
  if (!notice) return;
  const snapshot = telemetrySnapshot();
  notice.hidden = snapshot.available && !snapshot.stale;
  notice.dataset.state = isLoading ? 'loading' : snapshot.available ? 'stale' : lastSyncError ? 'error' : 'loading';
  const title = isLoading ? 'Updating inventory' : snapshot.available ? 'Showing saved inventory' : lastSyncError ? 'Inventory unavailable' : 'Connecting to inventory';
  const detail = snapshot.available
    ? `${snapshot.detail} Prices and stock may have changed.`
    : 'Stock remains unknown until a verified response arrives.';
  const heading = document.getElementById('telemetryNoticeTitle');
  const copy = document.getElementById('telemetryNoticeCopy');
  if (heading.textContent !== title) heading.textContent = title;
  if (copy.textContent !== detail) copy.textContent = detail;
  const retry = document.getElementById('telemetryRetry');
  retry.hidden = !lastSyncError && !snapshot.stale;
  retry.disabled = isLoading || !navigator.onLine;
}

function telemetryPlaceholderRow() {
  return '<li class="telemetry-placeholder"><span>Stock unknown</span><strong aria-label="Stock unknown">—</strong></li>';
}

function renderOverviewTelemetryState(message, state = 'low') {
  [els.maintenanceList, els.exportList, els.reserveList, els.shipStockList].forEach(target => {
    if (target) target.innerHTML = telemetryPlaceholderRow(message, state);
  });
  [els.maintenanceCount, els.exportCount, els.reserveCount, els.shipStockCount].forEach(target => {
    if (target) target.textContent = '–';
  });
}

function renderOverviewRow({ state, role, name, item = null, capacityItem = item, detail = '', detailTitle = '', quantityValue = 0, extraClass = '', pooledStock = false, breakdown = '', input = '', actions = '' }) {
  const reference = overviewStockReference(item, role);
  const modules = globalThis.RHWV4?.production?.modules?.() || DASHBOARD_CONFIG.productionModules;
  const recipeId = !pooledStock && modules.find(module => keyFromName(module.product) === keyFromName(name))?.recipeId;
  const navigation = recipeId ? `data-inventory-recipe="${escapeHTML(recipeId)}"` : ['reserve', 'byproduct', 'maintenance'].includes(role) ? `data-inventory-material="${escapeHTML(item?.name || name)}"` : '';
  const title = navigation ? `<button type="button" class="inventory-production-link" ${navigation}>${escapeHTML(name)}</button>` : `<strong>${escapeHTML(name)}</strong>`;
  const trade = role === 'export' && typeof exportRouteButton === 'function' ? exportRouteButton(name)
    : role === 'reserve' && typeof supplyRouteButton === 'function' ? supplyRouteButton(item?.name || name) : '';
  const safeDetail = detail ? `<small class="overview-stock-detail"${detailTitle ? ` title="${escapeHTML(detailTitle)}"` : ''}>${escapeHTML(detail)}</small>` : '';
  const referenceMarkup = reference ? `<span class="overview-stock-reference"><span aria-hidden="true">/</span> ${number(reference.value)} <small>${escapeHTML(reference.label)}</small></span>` : '';
  return `<li class="overview-stock-row alert-${state}${extraClass ? ` ${extraClass}` : ''}" ${navigation}>
            <span class="overview-item-copy"><span class="rhw-supply-material">${title}${trade}${actions}</span></span>
            ${statusPill(state, role)}
            <div class="overview-row-meta">
              <div class="overview-stock-value"><strong class="overview-row-qty">${number(quantityValue)}</strong>${pooledStock ? '<small class="overview-stock-total">Total</small>' : ''}${referenceMarkup}</div>
              ${safeDetail}
            </div>
            ${breakdown}
            ${renderStockCapacity(capacityItem, state)}
            ${role === 'reserve' && input ? `<div class="inventory-reserve-inputs">${input}</div>` : input}
          </li>`;
}

// Only recipe inputs and handling thresholds get a numeric reference.
// Maintenance and export stock have no artificial target inventory.
// Feedstock coverage describes this input only; other recipe inputs may limit output.
function overviewStockReference(item, role) {
  if (!item) return null;
  const custom = CUSTOM_ALERTS[commodityKey(item)];
  if (role === 'procurement' && FEEDSTOCK.includes(commodityKey(item))) {
    const { required } = feedstockAnalysis(item);
    return required > 0 ? { value: required, label: 'BATCH INPUT' } : null;
  }
  if (role === 'byproduct' || role === 'confiscated') {
    return custom?.type === 'max' && custom.yellow > 0
      ? { value: custom.yellow, label: role === 'byproduct' ? 'DISPOSAL AT' : 'REVIEW AT' }
      : null;
  }
  return null;
}

function renderOverviewEmptyRow(text, statusText = 'SECURE') {
  return `<li><span>${escapeHTML(text)}</span><span class="pill ok">${escapeHTML(statusText)}</span></li>`;
}

function overviewDetail(item, state, role) {
  if (state === 'waiting') return 'STOCK UNKNOWN';
  const reference = overviewStockReference(item, role);
  if (role === 'byproduct') {
    if (commodityKey(item) === 'toxic waste') {
      const feed = window.RHWV4?.inventoryModel?.moxFeedstock();
      return feed?.cycles === null || !feed ? 'MOX RECIPE COVERAGE UNKNOWN'
        : `TW FOR ${number(feed.cycles)} ${feed.variant} MOX BATCHES`;
    }
    if (state !== 'ok') return state === 'low' ? 'DISPOSAL REQUIRED' : 'CONTAINMENT CRITICAL';
    return reference ? `${number(Math.max(0, reference.value - quantity(item)))} UNTIL DISPOSAL` : readinessText(state, role);
  }
  if (role === 'reserve') {
    const reserve = window.RHWV4?.inventoryModel?.reserve(commodityKey(item));
    return reserve?.required > 0 ? `LARGEST RECIPE INPUT · ${number(reserve.required)}` : 'AVAILABLE FOR PRODUCTION';
  }
  if (role === 'confiscated') {
    if (state !== 'ok') return state === 'low' ? 'REVIEW REQUIRED' : 'VAULT OVERFLOW';
    return reference ? `${number(Math.max(0, reference.value - quantity(item)))} UNTIL REVIEW` : 'EVIDENCE SECURED';
  }
  if (state === 'ok' && (role === 'maintenance' || role === 'export')) return '';
  return readinessText(state, role);
}

const runwayDays = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

function maintenanceRunway(item, stock, population) {
  const key = commodityKey(item);
  const reference = DASHBOARD_CONFIG.maintenanceDailyReference[key];
  const populationSupply = key === 'food rations' || key === 'consumer goods';
  if (reference === undefined && !populationSupply) return null;
  const daily = reference ?? population?.unitsPerDay;
  if (daily === undefined) return { detail: 'Set population for coverage' };
  if (daily === 0) return { detail: 'No upkeep', detailTitle: population?.source ?? '' };
  return {
    detail: `~${runwayDays.format(stock / daily)} days`,
    detailTitle: reference !== undefined ? `Estimated upkeep ${number(reference)} per day`
      : `${number(daily)} per day for ${number(population.total)} people · ${population.source}`
  };
}

function renderList(target, list, emptyText, roleOverride = null, population = null) {
  if (!target) return;
  if (!list.length) {
    target.innerHTML = renderOverviewEmptyRow(emptyText);
    return;
  }
  target.innerHTML = list.map(item => {
    const role = roleOverride || assetRole(item);
    const stock = item.missing ? null : firstFiniteApiStockValue(item, ['quantity', 'amount', 'stock']);
    const state = stock === null ? 'waiting' : stateForRole(item, role);
    const coverage = role === 'maintenance' && stock !== null ? maintenanceRunway(item, stock, population) : null;
    return renderOverviewRow({
      state, role, name: displayName(item), item, quantityValue: stock,
      detail: overviewDetail(item, state, role), ...coverage
    });
  }).join('');
}

function inventoryInputRow(name, recipeId) {
  const model = window.RHWV4.inventoryModel;
  const moxFeedstock = keyFromName(name) === 'toxic waste';
  const entry = moxFeedstock ? model.moxFeedstock() : model.input(name, recipeId);
  const batches = entry.cycles === 1 ? 'input batch' : 'input batches';
  const hint = entry.stock === null ? 'Stock unknown' : entry.cycles === null ? 'Recipe unknown'
    : `${number(entry.cycles)} ${batches}${moxFeedstock ? ` · ${entry.variant} MOX` : ''}`;
  const limits = moxFeedstock && entry.stock !== null ? renderStockCapacity(entry.item, entry.state) : '';
  return `<div class="inventory-input-row" data-input-name="${escapeHTML(name)}"><span>Input</span><button type="button" data-inventory-recipe="${escapeHTML(recipeId)}">${escapeHTML(name)}</button><strong>${number(entry.stock)}</strong><small>${hint}</small>${limits}</div>`;
}

function renderShipStock() {
  const rows = window.RHWV4.inventoryModel.ships();
  const available = rows.filter(row => row.stock > 0), other = rows.filter(row => !(row.stock > 0));
  const markup = row => `<li class="inventory-ship-row"><button type="button" data-inventory-hull="${escapeHTML(row.hull.key)}"><span>${escapeHTML(row.hull.label)}</span><strong>${number(row.stock)}</strong></button>${row.stock === null ? '<small>NOT REPORTED</small>' : ''}</li>`;
  els.shipStockList.innerHTML = (available.length ? available.map(markup).join('') : '<li class="inventory-ship-empty">NO REPORTED SHIPS IN STOCK</li>')
    + `<li class="inventory-other-ships"><details><summary>OTHER HULLS · ${other.length}</summary><ul>${other.map(markup).join('')}</ul></details></li>`;
  els.shipStockCount.textContent = rows.some(row => row.stock !== null) ? `${number(available.reduce((total, row) => total + row.stock, 0))} HULLS` : '—';
}

function installPopulationForm() {
  const form = document.getElementById('rhwPopulationForm');
  const fields = form?.querySelector('fieldset');
  if (!fields?.disabled) return;
  const model = window.RHWV4.inventoryModel;
  const crew = form.elements.namedItem('crew');
  const scientists = form.elements.namedItem('scientists');
  const status = document.getElementById('rhwPopulationStatus');
  const saved = model.savedPopulation();
  if (saved) {
    crew.value = saved.crew;
    scientists.value = saved.scientists;
  }
  fields.disabled = false;
  form.addEventListener('submit', event => {
    event.preventDefault();
    const outcome = model.savePopulation(crew.valueAsNumber, scientists.valueAsNumber);
    if (outcome === 'saved') {
      status.textContent = 'Fallback counts saved on this device.';
      renderOverview();
    } else if (outcome === 'invalid') {
      status.textContent = 'Enter valid whole numbers of zero or more.';
    } else {
      status.textContent = 'Could not save counts on this device.';
    }
  });
}

function renderPopulation(population) {
  const total = document.getElementById('rhwPopulationTotal');
  const coverage = document.getElementById('rhwPopulationCoverage');
  if (!total || !coverage) return;
  total.textContent = population ? `${number(population.total)} · ${population.source}` : 'Awaiting headcounts';
  coverage.hidden = !population;
  coverage.textContent = population
    ? `${number(population.crew)} Crew + ${number(population.scientists)} Scientists · ${number(population.unitsPerDay)} Food Rations and ${number(population.unitsPerDay)} Consumer Goods per day.`
    : '';
}

function renderOverview() {
  const snapshot = telemetrySnapshot();
  const model = window.RHWV4?.inventoryModel;
  const population = model?.population(snapshot) ?? null;
  renderPopulation(population);
  if (!snapshot.available || !model) {
    renderOverviewTelemetryState();
    return;
  }
  const source = operationalItems();
  const byName = (a, b) => displayName(a).localeCompare(displayName(b));
  const maintenance = source.filter(item => hasAssetRole(item, 'maintenance')).sort(byName);
  const exports = source.filter(item => hasAssetRole(item, 'export')).sort((a, b) => EXPORT_ORDER.indexOf(displayName(a)) - EXPORT_ORDER.indexOf(displayName(b)));
  scrambleText(els.maintenanceCount, maintenance.length);
  scrambleText(els.exportCount, exports.length);
  scrambleText(els.reserveCount, DASHBOARD_CONFIG.reserveCards.length);
  renderList(els.maintenanceList, maintenance, 'FACILITY RESERVES STABLE', 'maintenance', population);
  const alloy = [...els.maintenanceList.children].find(row => row.dataset.inventoryRecipe === 'recipe_scrap_advanced');
  alloy?.insertAdjacentHTML('beforeend', inventoryInputRow('Scrap Metal', 'recipe_scrap_advanced'));
  renderList(els.exportList, exports, 'NO EXPORT ASSETS DETECTED', 'export');
  els.reserveList.innerHTML = DASHBOARD_CONFIG.reserveCards.map(spec => {
    const reserve = model.reserve(spec.key);
    const pooledStock = spec.members.length > 1;
    const breakdown = pooledStock ? `<div class="inventory-pool-parts">${reserve.parts.map(part => `<span><span>${escapeHTML(part.name)}</span><strong>${number(reserve.stock === null ? part.stock : part.stock ?? 0)}</strong></span>`).join('')}</div>` : '';
    const detail = reserve.required === null ? 'RECIPE REQUIREMENTS UNKNOWN' : reserve.required > 0
      ? `LARGEST RECIPE INPUT · ${number(reserve.required)}` : 'AVAILABLE FOR PRODUCTION';
    const capacityItem = reserve.parts.length === 1 && reserve.stock !== null ? reserve.parts[0].item : null;
    const actions = spec.key === 'prototype components' ? '<button type="button" class="rhw-supply-button rhw-supply-icon" data-surplus-commodity="Prototype Components" aria-label="Check surplus export buyers for Prototype Components" title="Check surplus buyers · Internal production first"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M10 5H4v15h15v-6"/></svg></button>' : '';
    return renderOverviewRow({ role: 'reserve', name: spec.label, item: reserve.item, state: reserve.state,
      quantityValue: reserve.stock, detail, pooledStock, breakdown, capacityItem,
      input: (reserve.inputs || [reserve.input]).map(name => inventoryInputRow(name, reserve.recipeId)).join(''), actions });
  }).join('');
  renderShipStock();
}

function updateRoleSegments() {
  if (!els.roleFilter || !els.roleSegmentButtons) return;
  els.roleSegmentButtons.forEach(button => {
    const active = button.dataset.role === els.roleFilter.value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function manifestState(item) {
  return firstFiniteApiStockValue(item, ['quantity', 'amount', 'stock']) === null ? 'waiting' : operationalState(item);
}

function renderManifest() {
  if (!els.itemsBody || !els.search || !els.roleFilter) return;
  if (!hasVerifiedTelemetry()) {
    const message = lastSyncError ? 'LOCAL TELEMETRY UNAVAILABLE' : 'AWAITING FIRST TELEMETRY BURST';
    els.itemsBody.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHTML(message)}</td></tr>`;
    updateSortArrows();
    return;
  }
  const query = normalize(els.search.value);
  const roleFilter = els.roleFilter.value;

  // Status boards keep their configured operational roles. The full manifest
  // includes every reported item, including equipment and uncategorized goods.
  const visible = items.filter(item => !item.synthetic).filter(item => {
    const role = assetRole(item);
    const matchesQuery = !query || normalize(displayName(item)).includes(query) || normalize(itemName(item)).includes(query);
    return matchesQuery && (roleFilter === 'all' || hasAssetRole(item, roleFilter));
  });

  if (visible.length === 0) {
    els.itemsBody.innerHTML = `<tr><td colspan="6" class="empty-state">NO ASSETS MATCHING QUERY IN LOCAL DATABANKS</td></tr>`;
    updateSortArrows();
    return;
  }

  visible.sort((a, b) => {
    let valA, valB;
    if (sortCol === 'name') { valA = displayName(a); valB = displayName(b); }
    else if (sortCol === 'role') { valA = assetRoles(a).join(' / '); valB = assetRoles(b).join(' / '); }
    else if (sortCol === 'status') {
      const weight = { critical: 1, low: 2, ok: 3, waiting: 4 };
      valA = weight[manifestState(a)]; valB = weight[manifestState(b)];
    }
    else if (sortCol === 'quantity') { valA = firstFiniteApiStockValue(a, ['quantity', 'amount', 'stock']) ?? -1; valB = firstFiniteApiStockValue(b, ['quantity', 'amount', 'stock']) ?? -1; }
    else if (sortCol === 'sell') { valA = priceSell(a) ?? -1; valB = priceSell(b) ?? -1; }
    else if (sortCol === 'buy') { valA = priceBuy(a) ?? -1; valB = priceBuy(b) ?? -1; }

    if (valA < valB) return sortAsc ? -1 : 1;
    if (valA > valB) return sortAsc ? 1 : -1;
    return 0;
  });

  updateSortArrows();

  els.itemsBody.innerHTML = visible.map(item => {
    const role = assetRole(item);
    const state = manifestState(item);
    const routeAction = hasAssetRole(item, 'export') && typeof exportRouteButton === 'function' ? exportRouteButton(displayName(item))
      : typeof supplyRouteButton === 'function' ? supplyRouteButton(displayName(item)) : '';
    const stock = firstFiniteApiStockValue(item, ['quantity', 'amount', 'stock']);
    return `<tr><td class="asset-cell"><span class="rhw-supply-material"><strong>${escapeHTML(displayName(item))}</strong>${routeAction}</span></td><td>${rolePillsFor(item)}</td><td>${statusPill(state, role)}</td><td class="numeric-cell manifest-stock">${number(stock)}${renderStockCapacity(item, state)}</td><td class="numeric-cell price-cell sell-price">${formatCurrency(priceSell(item))}</td><td class="numeric-cell price-cell buy-price">${formatCurrency(priceBuy(item))}</td></tr>`;
  }).join('');
}

function renderAll() {
  renderOverview();
  if (FEATURES.capitalShipyard) renderShipyardControl();
  if (FEATURES.materialsScan || FEATURES.marketScan) renderSupplier();
  renderProductionModules();
  renderManifest();
  updateBaseTelemetry();
  updateDataFreshnessIndicators();
  window.dispatchEvent(new Event('rhw:telemetry'));
}

function findRemoteFacility(data, facility) {
  return data.find(base => {
    const candidates = [normalize(base?.name), normalize(base?.nickname)].filter(Boolean);
    return facility.matches.some(rawMatch => {
      const match = normalize(rawMatch);
      return candidates.some(candidate => candidate === match || candidate.includes(match));
    });
  }) || null;
}
