function normalizedAssetMatch(value) {
  return normalize(value)
    .replace(/[\"'`´‘’“”–—-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function itemIdentityCandidates(item) {
  return [
    item?.name, item?.item_name, item?.nickname, item?.id,
    item?.item_code, item?.itemCode, item?.code,
    item?.archetype, item?.archetype_id, item?.arch_id
  ].map(normalizedAssetMatch).filter(Boolean);
}

function findCommodityByAliases(matches = []) {
  const normalizedMatches = matches.map(normalizedAssetMatch).filter(Boolean);
  if (!normalizedMatches.length) return null;
  return items.find(item => itemIdentityCandidates(item).some(candidate =>
    normalizedMatches.some(match => candidate === match || candidate.includes(match))
  )) || null;
}

function shipyardTrafficState(value) {
  const count = Math.max(0, Math.floor(Number(value) || 0));
  return count <= 0 ? 'critical' : (count === 1 ? 'low' : 'ok');
}

function renderShipyardControl() {
  const mount = els.shipyardControl;
  if (!mount) return;
  if (!FEATURES.capitalShipyard) { mount.hidden = true; return; }
  mount.hidden = false;
  if (!CAPITAL_SHIPYARD) {
    mount.innerHTML = '<div class="feature-empty shipyard-empty">CAPITAL SHIPYARD STANDBY<small>NO SHIPYARD CONFIGURATION LOADED</small></div>';
    return;
  }
  if (!hasVerifiedTelemetry()) {
    const failed = Boolean(lastSyncError);
    mount.classList.remove('stale');
    mount.innerHTML = `
      <div class="shipyard-control-head">
        <div class="shipyard-heading-copy">
          <div class="section-kicker"><span>04</span> CAPITAL PRODUCTION</div>
          <div class="shipyard-control-title">CAPITAL SHIPYARD CONTROL</div>
          <div class="shipyard-control-subline">${failed ? 'NO VERIFIED RHW INVENTORY AVAILABLE' : 'AWAITING FIRST VERIFIED INVENTORY BURST'}</div>
          <div class="section-freshness" data-freshness-badge hidden></div>
        </div>
        <div class="shipyard-control-states"><div class="shipyard-summary-badge state-${failed ? 'critical' : 'low'}">${failed ? 'UPLINK FAILED' : 'AWAITING UPLINK'}</div></div>
      </div>
      <div class="feature-empty shipyard-empty">SHIPYARD ANALYSIS UNAVAILABLE<small>${failed ? 'RETRY THE UPLINK TO ACQUIRE A VERIFIED INVENTORY' : 'COMPONENT AND HULL COUNTS WILL APPEAR AFTER THE FIRST SUCCESSFUL SYNC'}</small></div>`;
    updateDataFreshnessIndicators();
    return;
  }

  mount.classList.toggle('stale', dataIsStale);

  const componentData = CAPITAL_SHIPYARD.components.map(component => {
    const item = findCommodity(component.name);
    const stock = item ? quantity(item) : 0;
    const required = Math.max(1, Number(component.required) || 1);
    const coverage = Math.floor(stock / required);
    const state = shipyardTrafficState(coverage);
    return { ...component, stock, required, coverage, state };
  });

  const buildableHulls = componentData.length
    ? Math.min(...componentData.map(component => component.coverage))
    : 0;
  const assemblyState = shipyardTrafficState(buildableHulls);
  const assemblyStateText = buildableHulls <= 0
    ? 'NO HULL READY'
    : (buildableHulls === 1 ? '1 HULL READY' : `${number(buildableHulls)} HULLS READY`);

  const nextHullTarget = buildableHulls + 1;
  componentData.forEach(component => {
    component.nextHullGap = Math.max(0, (nextHullTarget * component.required) - component.stock);
    component.gapRatio = component.required > 0 ? component.nextHullGap / component.required : 0;
  });

  const bottleneck = componentData.reduce((current, component) => {
    if (!current) return component;
    if (component.coverage < current.coverage) return component;
    if (component.coverage > current.coverage) return current;
    if (component.gapRatio > current.gapRatio) return component;
    if (component.gapRatio < current.gapRatio) return current;
    return component.nextHullGap > current.nextHullGap ? component : current;
  }, null);

  const bottleneckName = bottleneck ? bottleneck.name : 'N/A';
  const nextHullGap = bottleneck ? bottleneck.nextHullGap : 0;
  const analysisLine = `BOTTLENECK ${bottleneckName.toUpperCase()} // NEXT HULL +${number(nextHullGap)}`;

  const componentRows = componentData.map(component => {
    const isBottleneck = bottleneck && keyFromName(component.name) === keyFromName(bottleneck.name);
    return `
      <div class="shipyard-component-row component-${component.state}${isBottleneck ? ' bottleneck' : ''}">
        <div class="shipyard-component-name">${escapeHTML(component.name)}${typeof purchaseSourceButton === 'function' ? purchaseSourceButton(component.name, component.nextHullGap) : ''}</div>
        <div class="shipyard-component-required" data-label="REQ / HULL">${number(component.required)}</div>
        <div class="shipyard-component-stock scramble-shipyard" data-label="STOCK" data-val="${number(component.stock)}"></div>
        <div class="shipyard-component-coverage scramble-shipyard" data-label="HULLS" data-val="${number(component.coverage)}x"></div>
      </div>`;
  }).join('');

  const hullData = CAPITAL_SHIPYARD.hulls.map(hull => {
    const item = findCommodityByAliases(hull.matches);
    const stock = item ? quantity(item) : 0;
    const boundary = item ? apiStockBoundary(item) : { min: null, max: null, valid: false };
    const livePrice = item ? priceBuy(item) : null;
    const rawSellPrice = livePrice !== null && livePrice > 0 ? livePrice : hull.sellPrice;
    const sellPrice = Math.round(rawSellPrice / 100000) * 100000;
    const state = shipyardTrafficState(stock);
    return { ...hull, item, stock, apiMin: boundary.min, apiMax: boundary.max, hasApiBoundary: boundary.valid, sellPrice, state };
  });

  const hullReserve = hullData.length ? Math.min(...hullData.map(hull => hull.stock)) : 0;
  const registryState = shipyardTrafficState(hullReserve);
  const registryStateText = hullReserve <= 0
    ? 'RESERVE INCOMPLETE'
    : (hullReserve === 1 ? '1 EACH IN RESERVE' : `${number(hullReserve)} EACH IN RESERVE`);

  const hullRows = hullData.map(hull => {
    const stockDisplay = hull.hasApiBoundary ? `${number(hull.stock)} / ${number(hull.apiMax)}` : number(hull.stock);
    const stockLabel = hull.hasApiBoundary ? 'Stock / Max' : 'Stock';
    const progress = hull.item
      ? renderProgress(hull.item, { showApiReserve: true, stateOverride: hull.state })
      : '<div class="progress-wrap hull-progress-unavailable" aria-label="HULL CAPACITY DATA UNAVAILABLE"><div class="progress-fill critical" style="width:0%"></div></div>';
    return `
      <div class="hull-registry-row hull-${hull.state}">
        <div class="hull-registry-name">
          ${escapeHTML(hull.name)}
          <small>${escapeHTML(hull.subtitle || 'Capital Hull')}</small>
        </div>
        <div class="hull-registry-metric stock">
          <small>${stockLabel}</small>
          <strong class="scramble-shipyard" data-val="${stockDisplay}"></strong>
        </div>
        <div class="hull-registry-metric price">
          <small>Sell Price</small>
          <strong class="scramble-shipyard" data-val="${formatCurrency(hull.sellPrice)}"></strong>
        </div>
        <div class="hull-registry-progress">${progress}</div>
      </div>`;
  }).join('');

  mount.innerHTML = `
    <div class="shipyard-control-head">
      <div class="shipyard-heading-copy">
        <div class="section-kicker"><span>04</span> CAPITAL PRODUCTION</div>
        <div class="shipyard-control-title">CAPITAL SHIPYARD CONTROL</div>
        <div class="shipyard-control-subline">${escapeHTML(analysisLine)}</div>
        <div class="section-freshness" data-freshness-badge hidden></div>
      </div>
      <div class="shipyard-control-states">
        <div class="shipyard-summary-badge state-${assemblyState}">ASSEMBLY ${escapeHTML(assemblyStateText)}</div>
        <div class="shipyard-summary-badge state-${registryState}">HULL ${escapeHTML(registryStateText)}</div>
      </div>
    </div>
    <div class="shipyard-decision-strip" aria-label="Shipyard readiness summary">
      <div class="shipyard-decision-metric state-${assemblyState}">
        <small>BUILDABLE NOW</small>
        <strong>${number(buildableHulls)} HULL${buildableHulls === 1 ? '' : 'S'}</strong>
      </div>
      <div class="shipyard-decision-metric state-${assemblyState}">
        <small>BOTTLENECK</small>
        <strong>${escapeHTML(bottleneckName.toUpperCase())}</strong>
      </div>
      <div class="shipyard-decision-metric state-${nextHullGap > 0 ? 'critical' : 'ok'}">
        <small>MISSING FOR NEXT HULL</small>
        <strong>${nextHullGap > 0 ? `+${number(nextHullGap)} ${escapeHTML(bottleneckName.toUpperCase())}` : 'READY'}</strong>
      </div>
    </div>
    <div class="shipyard-control-grid">
      <section class="shipyard-control-section shipyard-reserve-panel state-${assemblyState}">
        <div class="shipyard-section-head">
          <div class="shipyard-section-title">Capital Component Reserve</div>
          <div class="shipyard-panel-state state-${assemblyState}">${escapeHTML(assemblyStateText)}</div>
        </div>
        <div class="shipyard-component-head"><span>Component</span><span>Req / Hull</span><span>Stock</span><span>Hulls</span></div>
        <div class="shipyard-component-list">${componentRows}</div>
      </section>
      <section class="shipyard-control-section shipyard-registry-panel state-${registryState}">
        <div class="shipyard-section-head">
          <div class="shipyard-section-title">Hull Registry</div>
          <div class="shipyard-panel-state state-${registryState}">${escapeHTML(registryStateText)}</div>
        </div>
        <div class="hull-registry-list">${hullRows}</div>
      </section>
    </div>`;

  mount.querySelectorAll('.scramble-shipyard').forEach(el => scrambleText(el, el.dataset.val));
  updateDataFreshnessIndicators();
}
