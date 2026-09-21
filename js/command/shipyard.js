/* Shipyard view. Recipe quantities are owned by RHWV4.shipyard. */
function normalizedAssetMatch(value) {
  return normalize(value).replace(/[\"'`´‘’“”–—_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function itemIdentityCandidates(item) {
  return [item?.name, item?.item_name, item?.nickname, item?.id, item?.item_code,
    item?.itemCode, item?.code, item?.archetype, item?.archetype_id, item?.arch_id]
    .map(normalizedAssetMatch).filter(Boolean);
}

function findShipyardItem(entry) {
  const inventory = items.filter(item => !item.missing && !item.synthetic);
  const codes = [entry.id, entry.productId, entry.apiCode].map(normalizedAssetMatch).filter(Boolean);
  const exact = inventory.find(item => itemIdentityCandidates(item).some(value => codes.includes(value)));
  if (exact) return exact;
  const names = [entry.name, ...(entry.matches || [])].map(normalizedAssetMatch).filter(Boolean);
  // Exact aliases prevent Archon Design Schematics, or similarly named modules,
  // from being counted as finished ships.
  return inventory.find(item => itemIdentityCandidates(item).some(value => names.includes(value))) || null;
}

function shipyardTrafficState(value) {
  const count = Math.max(0, Math.floor(Number(value) || 0));
  return count <= 0 ? 'critical' : (count === 1 ? 'low' : 'ok');
}

function renderShipyardControl() {
  const mount = els.shipyardControl;
  if (!mount) return;
  mount.hidden = !FEATURES.capitalShipyard;
  if (mount.hidden) return;
  const yard = window.RHWV4?.shipyard;
  const analysis = yard?.analyze();
  const snapshot = analysis?.snapshot || telemetrySnapshot();
  const selected = yard?.selectedHull() || CAPITAL_SHIPYARD.hulls.find(hull => hull.key === CAPITAL_SHIPYARD.defaultHull);
  mount.classList.toggle('stale', snapshot.stale);

  const cards = CAPITAL_SHIPYARD.hulls.map(hull => {
    const record = yard?.stockRecord(hull, snapshot) || { item: null, stock: null };
    const boundary = record.item ? apiStockBoundary(record.item) : null;
    const livePrice = record.item ? priceBuy(record.item) : null;
    const price = livePrice ?? hull.sellPrice;
    const stock = record.stock === null ? '—' : number(record.stock);
    const stockText = record.stock !== null && boundary?.valid ? `${stock} / ${number(boundary.max)}` : stock;
    return `<button type="button" class="shipyard-hull-card" data-shipyard-select="${hull.key}"
      aria-pressed="${selected?.key === hull.key}" aria-controls="shipyardRequirements" aria-label="${escapeHTML(hull.name)} build requirements">
      <span class="shipyard-hull-name">${escapeHTML(hull.label)}</span>
      <span class="shipyard-hull-type">${escapeHTML(hull.subtitle)}</span>
      <span class="shipyard-hull-indicator" aria-hidden="true"></span>
      <span class="shipyard-hull-stock-label">${record.stock === null ? 'STOCK UNKNOWN' : boundary?.valid ? 'STOCK / MAX' : 'IN STOCK'}</span>
      <strong class="shipyard-hull-stock">${stockText}</strong>
      <span class="shipyard-hull-price-label">${livePrice !== null ? 'SELL PRICE' : price !== null ? 'REFERENCE PRICE' : 'PRICE UNKNOWN'}</span>
      <span class="shipyard-hull-price">${price === null ? '—' : formatCurrency(price)}</span>
    </button>`;
  }).join('');

  let details = `<div class="shipyard-data-note">${snapshot.available ? 'RECIPE DATA UNAVAILABLE' : 'AWAITING VERIFIED INVENTORY'}<small>Stock and material coverage will appear when the data is available.</small></div>`;
  if (analysis?.recipeReady) {
    const { hull, buildable, nextHull, bottleneck, materials, prerequisites } = analysis;
    const state = buildable === null ? 'unknown' : shipyardTrafficState(buildable);
    const unknown = materials.filter(row => row.stock === null);
    const rows = materials.map(row => `<tr class="shipyard-material-row ${row.state}${row.id === bottleneck?.id ? ' bottleneck' : ''}" data-shipyard-material="${escapeHTML(row.id)}">
      <th scope="row"><div class="shipyard-material-name"><span>${escapeHTML(row.name)}</span>${row.gap > 0 && typeof purchaseSourceButton === 'function' ? purchaseSourceButton(row.name, row.gap) : ''}</div></th>
      <td data-label="PER SHIP">${number(row.required)}</td><td data-label="STOCK">${row.stock === null ? '—' : number(row.stock)}</td>
      <td data-label="MISSING" class="shipyard-material-gap">${row.gap > 0 ? `<span class="shipyard-shortage">+${number(row.gap)}</span>` : '—'}</td>
    </tr>`).join('');
    const prerequisiteRows = prerequisites.map(row => `<li class="shipyard-prerequisite ${row.state}">
      <span><strong>${escapeHTML(row.name)}</strong><small>${number(row.qty)} required · not consumed</small></span>
      <span class="shipyard-prerequisite-status">${row.state === 'unknown' ? 'NOT REPORTED' : row.state === 'ok' ? 'AVAILABLE' : `MISSING ${number(row.qty - row.stock)}`}</span>
    </li>`).join('');
    details = `<div class="shipyard-decision-strip" aria-label="${escapeHTML(hull.label)} material coverage">
        <div class="shipyard-decision-metric shipyard-coverage state-${state}"><small>MATERIAL FOR</small><strong>${buildable === null ? 'UNKNOWN' : `${number(buildable)} <span>${escapeHTML(buildable === 1 ? hull.label : hull.plural).toUpperCase()}</span>`}</strong></div>
        <div class="shipyard-decision-metric"><small>BOTTLENECK</small><strong>${bottleneck ? escapeHTML(bottleneck.name) : 'STOCK UNKNOWN'}</strong></div>
        <div class="shipyard-decision-metric shipyard-next-ship"><small>${nextHull === null ? 'NEXT SHIP' : `NEXT SHIP #${number(nextHull)}`}</small><strong>${bottleneck ? `+${number(bottleneck.gap)} <span>${escapeHTML(bottleneck.name)}</span>` : 'AWAITING STOCK'}</strong></div>
      </div>
      ${unknown.length ? `<p class="shipyard-data-note">Stock not reported: ${unknown.map(row => escapeHTML(row.name)).join(', ')}. Coverage remains unknown.</p>` : ''}
      <div class="shipyard-requirement-body">
        <div class="shipyard-materials">
          <p class="shipyard-material-note">Requirements per ship${nextHull === null ? '' : ` · Missing quantities are for ship #${number(nextHull)}`}${snapshot.stale ? ' · Based on cached stock' : ''}.</p>
          <table class="shipyard-material-table"><thead><tr><th scope="col">COMPONENT</th><th scope="col">PER SHIP</th><th scope="col">STOCK</th><th scope="col">MISSING</th></tr></thead><tbody>${rows}</tbody></table>
        </div>
        <aside class="shipyard-prerequisites"><h3>BUILD PREREQUISITES</h3><p>Required separately from the material coverage above.</p>
          <ul>${prerequisiteRows}</ul>
          <p>Shipyard level ${number(analysis.recipe.reqLevel)} required. ${escapeHTML(analysis.recipe.restricted ? 'RHW BMM recipe.' : 'Civilian assembly recipe.')}</p>
        </aside>
      </div>`;
  }

  const markup = `<div class="shipyard-control-head">
      <div class="shipyard-heading-copy"><h2 class="shipyard-control-title">SHIPYARD</h2><p class="shipyard-control-subline">STOCK &amp; BUILD REQUIREMENTS</p></div>
      <div class="section-freshness" data-freshness-badge hidden></div>
    </div>
    <div class="shipyard-control-grid">
      <section class="shipyard-control-section shipyard-registry-panel" aria-label="Select a ship">
        <div class="shipyard-hull-grid" role="group" aria-label="Ship inventory and selection">${cards}</div>
      </section>
      <section class="shipyard-control-section shipyard-requirements-panel" id="shipyardRequirements" aria-labelledby="shipyardRequirementsTitle">
        <div class="shipyard-requirements-heading"><div><p class="shipyard-eyebrow">BUILD REQUIREMENTS</p><h3 id="shipyardRequirementsTitle">${escapeHTML(selected.label)} <span>${escapeHTML(selected.subtitle)}</span></h3></div>
          <button type="button" class="shipyard-plan-button" data-shipyard-calculate ${analysis?.recipeReady ? '' : 'disabled'}>PRICE 1 SHIP</button>
        </div>${details}
      </section>
    </div>`;
  if (mount._shipyardMarkup !== markup) {
    const active = document.activeElement;
    const focusSelector = mount.contains(active) ? active?.dataset?.shipyardSelect
      ? `[data-shipyard-select="${active.dataset.shipyardSelect}"]`
      : active?.hasAttribute('data-shipyard-calculate') ? '[data-shipyard-calculate]' : null : null;
    mount.innerHTML = markup;
    mount._shipyardMarkup = markup;
    if (focusSelector) mount.querySelector(focusSelector)?.focus({ preventScroll: true });
  }
  updateDataFreshnessIndicators();
  window.RHWRuntime?.rendered('shipyard');
}
