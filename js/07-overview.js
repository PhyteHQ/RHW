function feedstockAnalysis(item) {
  const key = commodityKey(item);
  let required = 0;
  for (const recipe of RECIPES) {
    const ingredient = recipe.ingredients.find(([ingredientName]) => keyFromName(ingredientName) === key);
    if (ingredient) required = Number(ingredient[1]) || 0;
  }
  const q = quantity(item);
  const cycles = required > 0 ? Math.floor(q / required) : 0;
  const state = cycles <= 0 ? 'critical' : cycles < 10 ? 'low' : 'ok';
  return { key, required, quantity: q, cycles, state };
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
}

function telemetryPlaceholderRow() {
  return '<li class="telemetry-placeholder"><span>STOCK UNKNOWN<small>Awaiting verified inventory</small></span><strong aria-label="Stock unknown">—</strong></li>';
}

function renderOverviewTelemetryState(message, state = 'low') {
  [els.maintenanceList, els.exportList, els.byproductList, els.feedstockList, els.confiscatedList].forEach(target => {
    if (target) target.innerHTML = telemetryPlaceholderRow(message, state);
  });
  [els.maintenanceCount, els.exportCount, els.byproductCount, els.feedstockCount, els.confiscatedCount].forEach(target => {
    if (target) target.textContent = '–';
  });
}

function renderOverviewRow({ state, role, name, item = null, detail = '', quantityValue = 0, progress = '', extraClass = '' }) {
  const reference = overviewStockReference(item, role);
  const safeDetail = detail ? `<small class="overview-stock-detail">${escapeHTML(detail)}</small>` : '';
  const referenceMarkup = reference ? `<span class="overview-stock-reference"><span aria-hidden="true">/</span> ${number(reference.value)} <small>${escapeHTML(reference.label)}</small></span>` : '';
  return `<li class="overview-stock-row alert-${state}${extraClass ? ` ${extraClass}` : ''}">
            <span class="overview-item-copy"><strong>${escapeHTML(name)}</strong></span>
            ${statusPill(state, role)}
            <div class="overview-row-meta">
              <div class="overview-stock-value"><strong class="overview-row-qty">${number(quantityValue)}</strong>${referenceMarkup}</div>
              ${safeDetail}
            </div>
            ${progress}
          </li>`;
}

// These are operational thresholds, not the API's reserve or storage capacity.
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
  const target = custom?.type === 'min' ? custom.yellow : minStock(item);
  return target > 0 ? { value: target, label: 'TARGET' } : null;
}

function renderOverviewEmptyRow(text, statusText = 'SECURE') {
  return `<li><span>${escapeHTML(text)}</span><span class="pill ok">${escapeHTML(statusText)}</span></li>`;
}

function overviewDetail(item, state, role) {
  const reference = overviewStockReference(item, role);
  if (role === 'byproduct') {
    if (state !== 'ok') return state === 'low' ? 'DISPOSAL REQUIRED' : 'CONTAINMENT CRITICAL';
    return reference ? `${number(Math.max(0, reference.value - quantity(item)))} UNTIL DISPOSAL` : readinessText(state, role);
  }
  if (role === 'confiscated') {
    if (state !== 'ok') return state === 'low' ? 'REVIEW REQUIRED' : 'VAULT OVERFLOW';
    return reference ? `${number(Math.max(0, reference.value - quantity(item)))} UNTIL REVIEW` : 'EVIDENCE SECURED';
  }
  const deficit = reference ? Math.max(0, reference.value - quantity(item)) : needAmount(item);
  return deficit > 0 ? `${number(deficit)} TO TARGET` : readinessText(state, role);
}

function renderList(target, list, emptyText, roleOverride = null) {
  if (!target) return;
  if (!list.length) {
    target.innerHTML = renderOverviewEmptyRow(emptyText);
    return;
  }
  target.innerHTML = list.map(item => {
    const role = roleOverride || assetRole(item);
    const state = stateForRole(item, role);
    return renderOverviewRow({
      state, role, name: displayName(item), item, detail: overviewDetail(item, state, role),
      quantityValue: quantity(item), progress: renderProgress(item, { showApiReserve: true, role })
    });
  }).join('');
}

function renderOverview() {
  if (!hasVerifiedTelemetry()) {
    const failed = Boolean(lastSyncError);
    renderOverviewTelemetryState(failed ? 'LOCAL TELEMETRY UNAVAILABLE' : 'AWAITING FIRST TELEMETRY BURST', failed ? 'critical' : 'low');
    return;
  }
  const sourceItems = operationalItems();
  const sortByName = (a, b) => displayName(a).localeCompare(displayName(b));

  const maintenance = sourceItems.filter(item => hasAssetRole(item, 'maintenance')).sort(sortByName);
  const exports = sourceItems.filter(item => hasAssetRole(item, 'export')).sort((a, b) => {
    let idxA = EXPORT_ORDER.indexOf(displayName(a));
    let idxB = EXPORT_ORDER.indexOf(displayName(b));
    if (idxA === -1) idxA = 999;
    if (idxB === -1) idxB = 999;
    if (idxA !== idxB) return idxA - idxB;
    return sortByName(a, b);
  });
  const byproducts = sourceItems.filter(item => hasAssetRole(item, 'byproduct')).sort(sortByName);
  const confiscated = sourceItems.filter(item => hasAssetRole(item, 'confiscated')).sort(sortByName);

  if (els.maintenanceCount) scrambleText(els.maintenanceCount, maintenance.length);
  if (els.exportCount) scrambleText(els.exportCount, exports.length);
  if (els.byproductCount) scrambleText(els.byproductCount, byproducts.length);
  if (els.confiscatedCount) scrambleText(els.confiscatedCount, confiscated.length);
  if (els.feedstockCount) scrambleText(els.feedstockCount, FEEDSTOCK.length);

  renderList(els.maintenanceList, maintenance, 'FACILITY RESERVES STABLE', 'maintenance');
  renderList(els.exportList, exports, 'NO EXPORT ASSETS DETECTED', 'export');
  renderList(els.byproductList, byproducts, 'NO WASTE DETECTED', 'byproduct');
  renderList(els.confiscatedList, confiscated, 'NO CONTRABAND SECURED', 'confiscated');

  if (els.feedstockList) {
    els.feedstockList.innerHTML = FEEDSTOCK.map(name => {
      const item = findCommodity(name);
      const display = displayRecipeName(name);
      const fallbackKey = keyFromName(name);

      if (!item || item.missing) {
        const missingItem = item || { name, quantity: 0, missing: true };
        const reference = overviewStockReference(missingItem, 'procurement');
        return renderOverviewRow({
          state: 'critical', role: 'procurement', name: display, item: missingItem,
          detail: reference ? `${number(reference.value)} NEEDED FOR 1 BATCH` : 'NO INPUT STOCK', quantityValue: 0,
          progress: renderFeedstockProgress(null, 'critical', fallbackKey)
        });
      }
      const analysis = feedstockAnalysis(item);
      return renderOverviewRow({
        state: analysis.state, role: 'procurement', name: displayName(item), item,
        detail: analysis.cycles > 0 ? `${number(analysis.cycles)} INPUT BATCHES` : `${number(analysis.required - analysis.quantity)} NEEDED FOR 1 BATCH`, quantityValue: analysis.quantity,
        progress: renderFeedstockProgress(item, analysis.state, fallbackKey)
      });
    }).join('');
  }
}

function updateRoleSegments() {
  if (!els.roleFilter || !els.roleSegmentButtons) return;
  els.roleSegmentButtons.forEach(button => {
    const active = button.dataset.role === els.roleFilter.value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
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

  const visible = operationalItems().filter(item => {
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
      const weight = { critical: 1, low: 2, ok: 3 };
      valA = weight[operationalState(a)]; valB = weight[operationalState(b)];
    }
    else if (sortCol === 'quantity') { valA = quantity(a); valB = quantity(b); }
    else if (sortCol === 'sell') { valA = priceSell(a) ?? -1; valB = priceSell(b) ?? -1; }
    else if (sortCol === 'buy') { valA = priceBuy(a) ?? -1; valB = priceBuy(b) ?? -1; }

    if (valA < valB) return sortAsc ? -1 : 1;
    if (valA > valB) return sortAsc ? 1 : -1;
    return 0;
  });

  updateSortArrows();

  els.itemsBody.innerHTML = visible.map(item => {
    const role = assetRole(item);
    const state = operationalState(item);
    return `<tr><td class="asset-cell"><strong>${escapeHTML(displayName(item))}</strong></td><td>${rolePillsFor(item)}</td><td>${statusPill(state, role)}</td><td class="numeric-cell">${number(quantity(item))}</td><td class="numeric-cell price-cell sell-price">${formatCurrency(priceSell(item))}</td><td class="numeric-cell price-cell buy-price">${formatCurrency(priceBuy(item))}</td></tr>`;
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
