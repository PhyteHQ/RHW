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

function telemetryPlaceholderRow(message, state = 'low') {
  return `<li class="telemetry-placeholder"><span><strong>${escapeHTML(message)}</strong><small>NO VERIFIED LOCAL INVENTORY</small></span><span class="pill ${state}">${state === 'critical' ? 'FAILED' : 'PENDING'}</span></li>`;
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
  const safeDetail = detail ? `<small>${escapeHTML(detail)}</small>` : '';
  return `<li class="alert-${state}${extraClass ? ` ${extraClass}` : ''}">
            <span><strong>${escapeHTML(name)}</strong>${safeDetail}${progress}</span>
            <div class="overview-row-meta">
              <strong class="overview-row-qty">${number(quantityValue)}</strong>
              ${statusPill(state, role)}
            </div>
          </li>`;
}

function renderOverviewEmptyRow(text, statusText = 'SECURE') {
  return `<li><span>${escapeHTML(text)}</span><span class="pill ok">${escapeHTML(statusText)}</span></li>`;
}

function overviewDetail(item, state, role) {
  if (role === 'byproduct') {
    if (state === 'ok') return readinessText(state, role);
    if (state === 'low') return 'WARNING: HIGH VOLUME';
    return 'CRITICAL OVERFLOW';
  }
  if (role === 'confiscated') {
    if (state === 'ok') return 'EVIDENCE SECURED';
    if (state === 'low') return 'VAULT FILLING';
    return 'VAULT OVERFLOW';
  }
  return state === 'ok' ? readinessText(state, role) : `DEFICIT: ${number(needAmount(item))}`;
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
        return renderOverviewRow({
          state: 'critical', role: 'procurement', name: display,
          detail: '0 CYCLES AVAILABLE', quantityValue: 0,
          progress: renderFeedstockProgress(null, 'critical', fallbackKey)
        });
      }
      const analysis = feedstockAnalysis(item);
      return renderOverviewRow({
        state: analysis.state, role: 'procurement', name: displayName(item), item,
        detail: `${number(analysis.cycles)} CYCLES AVAILABLE`, quantityValue: analysis.quantity,
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
