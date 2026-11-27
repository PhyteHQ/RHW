/* ========================================================================== */
/* RHW PRICE CHECK                                                            */
/* NPC offers for Full Manifest goods compared with RHW's purchase prices.   */
/* ========================================================================== */
(function initRhwPriceCheck() {
  'use strict';

  const app = window.RHWV4;
  if (!app || app.pricecheck) return;

  const MARKET_API = 'https://darkstat.dd84ai.com/api/npc_bases';
  const AUTO_REFRESH_MS = 300000;
  const MARKET_SCHEMA = 4;
  const DEFAULT_PROFIT_TARGET = 750000;
  const LEGACY_MARKET_KEY = 'rhw-webapp-v4:price-check-market-cache';
  const PROFIT_TARGETS = [[500000, '$500k/h'], [750000, '$750k/h'], [1000000, '$1M/h']];
  const OVERRIDES_KEY = app.config.storageKeys.priceCheckOverrides || 'rhw-webapp-v4:price-check-overrides';

  // Retain the old manual-price backup schema independently of the live offers.
  const LEGACY_OVERRIDE_KEYS = new Set([
    'hull-panels', 'industrial-materials', 'mox', 'titanium', 'energy-field-equipment', 'super-alloy',
    'ablative-armor-plating', 'food-rations', 'hydrocarbons', 'consumer-goods', 'mining-machinery', 'copper', 'niobium'
  ]);
  const state = {
    initialized: false,
    loading: false,
    overrides: app.store.get(OVERRIDES_KEY, {}) || {},
    marketCache: { routes: [] },
    marketTone: 'waiting',
    marketLabel: 'AWAITING MARKET DATA',
    marketDetail: '',
    lastError: '',
    receivedAt: 0,
    sort: 'commodity',
    query: '',
    quantity: null,
    hourlyTarget: DEFAULT_PROFIT_TARGET,
    hauler: 'auto'
  };
  let indexedShop, manifestIndex, scheduledScope, cacheReady = false;
  let tripModule, tripLoader, tripRequest, tripData, currentMapAt;
  let tripKey = '', tripError = '', nextTripAttempt = 0;

  const refreshTask = window.RHWRuntime.createRefreshTask({
    interval: AUTO_REFRESH_MS,
    enabled: () => cacheReady && app.state.activeWorkspace === 'pricecheck' && manifestScope(),
    run: (options = { quiet: true }) => refreshMarket(options)
  });

  const esc = value => app.util.escape(value);
  const itemId = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
  const normalize = value => String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[’'\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  function finite(value) {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function money(value) {
    const parsed = finite(value);
    return parsed === null ? '—' : `$${Math.round(parsed).toLocaleString('en-US')}`;
  }

  function signedMoney(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    const rounded = Math.round(Number(value));
    if (rounded > 0) return `+$${rounded.toLocaleString('en-US')}`;
    if (rounded < 0) return `-$${Math.abs(rounded).toLocaleString('en-US')}`;
    return '$0';
  }

  function installStyles() {
    document.documentElement.classList.add('rhw-pricecheck-enabled');
  }

  function removeObsoleteBuildQueueTool() {
    const card = document.querySelector('#rhwFocusToolsPanel [data-rhw-tool="build-queue"]');
    card?.remove();
    document.querySelectorAll('#rhwFocusToolsPanel [data-rhw-tool]').forEach((entry, index) => {
      const marker = entry.querySelector('.rhw-focus-tool-index');
      if (marker) marker.textContent = String(index + 1).padStart(2, '0');
    });
  }

  function workspaceMarkup() {
    return `<div class="pricecheck-frame" data-pricecheck-panel="routes">
      <header class="pricecheck-heading">
        <div><h2>PRICE CHECK</h2><p>FULL MANIFEST // NPC SOURCE COST VS RHW PAYOUT</p></div>
        <button type="button" class="pricecheck-refresh" id="priceCheckRefresh">REFRESH MARKET</button>
      </header>
      <div class="pricecheck-status-grid" id="priceCheckStatusGrid"></div>
      <div class="pricecheck-note" id="priceCheckNote">MARKET DATA LOADS WHEN PRICE CHECK OPENS.</div>
      <div class="pricecheck-controls">
        <label class="pricecheck-search" for="priceCheckSearch">Search<input id="priceCheckSearch" type="search" maxlength="160" placeholder="Commodity, station or system"></label>
        <label for="priceCheckSort">Sort by<select id="priceCheckSort"><option value="commodity">Commodity</option><option value="source">Source</option><option value="best">Highest profit / hour</option><option value="worst">Lowest profit / hour</option></select></label>
        <label for="priceCheckQuantity">Quantity · optional<input id="priceCheckQuantity" type="number" min="1" step="1" inputmode="numeric" placeholder="Units per route"></label>
        <fieldset class="pricecheck-target-picker" id="priceCheckTarget"><legend>Trader profit target</legend>
          <div class="pricecheck-target-options">${PROFIT_TARGETS.map(([value, label]) => `<label><input type="radio" name="price-check-profit" value="${value}"${value === state.hourlyTarget ? ' checked' : ''}><span>${label}</span></label>`).join('')}</div>
        </fieldset>
        <label for="priceCheckHauler">Hauler<select id="priceCheckHauler"><option value="auto">Auto · most units/hour</option></select></label>
      </div>
      <p class="pricecheck-trip-note">One row per commodity. Sellers rank by estimated profit per hour for a round trip to RHW. If the RHW payout is unknown, we pick the lowest unit price needed for your target. Offers without an estimate show the lowest known NPC price.</p>
      <p class="pricecheck-trip-note" id="priceCheckTripStatus" role="status"></p>
      <p class="pricecheck-trip-note" id="priceCheckResultCount" role="status"></p>
      <div class="pricecheck-table-wrap"><table class="pricecheck-table">
        <thead><tr><th>COMMODITY</th><th>SOURCE</th><th>NPC PRICE</th><th>RHW PAYS</th><th>DIFFERENCE / UNIT</th></tr></thead>
        <tbody id="priceCheckRows"></tbody>
      </table></div>
    </div>`;
  }

  function ensureShell() {
    const tabs = document.querySelector('#rhwAppNav .app-tabs');
    const root = document.getElementById('rhwWorkspaceRoot');
    if (!tabs || !root) return false;

    if (!tabs.querySelector('[data-workspace="pricecheck"]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.dataset.workspace = 'pricecheck';
      button.setAttribute('aria-controls', 'workspacePricecheck');
      button.setAttribute('aria-label', 'Price Check');
      button.innerHTML = '<span>PRICE CHECK</span><small>NPC MARKET</small>';
      const forum = tabs.querySelector('[data-workspace="comms"]');
      tabs.insertBefore(button, forum || null);
    }

    if (!document.getElementById('workspacePricecheck')) {
      const panel = document.createElement('section');
      panel.id = 'workspacePricecheck';
      panel.className = 'app-workspace pricecheck-workspace';
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-label', 'Price Check workspace');
      panel.hidden = true;
      panel.innerHTML = workspaceMarkup();
      const comms = document.getElementById('workspaceComms');
      root.insertBefore(panel, comms || null);
      bindUi(panel);
    }

    removeObsoleteBuildQueueTool();
    return true;
  }

  function bindUi(panel) {
    if (!panel || panel.dataset.priceCheckBound === 'true') return;
    panel.dataset.priceCheckBound = 'true';
    panel.querySelector('#priceCheckRefresh').addEventListener('click', () => refreshTask.refresh({ forceTrips: true }));
    panel.querySelector('#priceCheckSearch').addEventListener('input', event => {
      state.query = normalize(event.target.value);
      render();
    });
    panel.querySelector('#priceCheckSort').addEventListener('change', event => {
      state.sort = event.target.value;
      render();
    });
    panel.querySelector('#priceCheckQuantity').addEventListener('input', event => {
      const value = event.target.valueAsNumber;
      state.quantity = Number.isSafeInteger(value) && value > 0 ? value : null;
      render();
    });
    panel.querySelector('#priceCheckTarget').addEventListener('change', event => {
      const value = Number(event.target.value);
      if (PROFIT_TARGETS.some(([target]) => target === value)) state.hourlyTarget = value;
      render();
    });
    panel.querySelector('#priceCheckHauler').addEventListener('change', event => {
      state.hauler = event.target.value;
      render();
    });
  }

  function manifestScope() {
    // The raw RHW shop is also the source of Full Manifest's reported rows.
    const shop = typeof rhwBase !== 'undefined' ? rhwBase?.shop_items : null;
    if (!Array.isArray(shop)) return null;
    if (shop === indexedShop) return manifestIndex;
    const byId = new Map();
    const byName = new Map();
    for (const item of shop) {
      if (!item || item.synthetic || item.missing || item.ship_class != null || (item.category && item.category !== 'commodity')) continue;
      const id = itemId(item.nickname);
      const name = commodityKey(item);
      if (id && !byId.has(id)) byId.set(id, item);
      // An exact nickname takes precedence over display names. Name matching
      // is reserved for unambiguous older shop rows that lack a nickname.
      if (name) byName.set(name, id || byName.has(name) ? null : item);
    }
    const names = [...byName].filter(([, item]) => item);
    const goods = [...byId.values(), ...names.map(([, item]) => item)]
      .filter(item => item.category === 'commodity' || itemId(item.nickname).startsWith('commodity_'));
    const key = JSON.stringify([[...byId.keys()].sort(), names.map(([name]) => name).sort()]);
    indexedShop = shop;
    return manifestIndex = { byId, byName, goods, key };
  }

  function manifestItem(scope, nickname, name) {
    return scope?.byId.get(itemId(nickname)) || scope?.byName.get(keyFromName(name)) || null;
  }

  function marketRoutes(scope = manifestScope()) {
    if (!scope) return [];
    return state.marketCache.routes.filter(route => manifestItem(scope, route.goodNickname, route.commodity));
  }

  function rhwPrice(item) {
    if (!item) return null;
    return [item.price_to_sell_to_base, item.sell_price, item.price_sell].map(finite).find(value => value !== null) ?? null;
  }

  function marketCovers(scopeKey) {
    return state.marketCache.schema === MARKET_SCHEMA && state.marketCache.scope === scopeKey;
  }

  function scheduleMarket() {
    if (!cacheReady) return;
    const scopeKey = manifestScope()?.key ?? null;
    if (scheduledScope === scopeKey) return;
    scheduledScope = scopeKey;
    const at = Date.parse(state.marketCache.fetchedAt);
    refreshTask.setDueAt(marketCovers(scopeKey) && Number.isFinite(at)
      ? Math.min(at, Date.now()) + AUTO_REFRESH_MS : Date.now());
  }

  async function restoreMarket() {
    const saved = await window.RHWTelemetryCache?.readMarket?.().catch(() => null);
    // The previous snapshot can supply cached prices while the expanded
    // market is fetched, but it cannot establish which goods lack a seller.
    if (state.marketCache.fetchedAt || ![3, MARKET_SCHEMA].includes(saved?.schema) || typeof saved.scope !== 'string'
        || !Array.isArray(saved.routes) || !Number.isFinite(Date.parse(saved.fetchedAt))) return;
    state.marketCache = { ...saved, routes: saved.routes.filter(route =>
      route && ['key', 'sourceNickname', 'source', 'goodNickname', 'commodity', 'system', 'systemNickname']
        .every(field => typeof route[field] === 'string')
      && route.key === `${route.sourceNickname}/${route.goodNickname}`) };
    state.marketTone = 'warn';
    state.marketLabel = 'CACHED MARKET';
    state.marketDetail = `SNAPSHOT ${new Date(saved.fetchedAt).toLocaleString('de-DE')}`;
  }

  function rhwSnapshot() {
    try {
      const getter = typeof telemetrySnapshot === 'function' ? telemetrySnapshot : window.telemetrySnapshot;
      if (typeof getter === 'function') return getter();
    } catch {}
    return { available: false, stale: false, label: 'RHW PRICE DATA UNAVAILABLE', detail: '' };
  }

  async function fetchMarketBases() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch(MARKET_API, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ include_market_goods: true, filter_to_useful: true, filter_market_good_category: ['commodity'] }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`MARKET HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('INVALID NPC MARKET RESPONSE');
      return data;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function snapshotRoutes(bases) {
    const scope = manifestScope();
    if (!scope) return false;
    const offers = new Map();
    const fallbackIds = new Map();
    for (const base of bases) {
      const sourceNickname = base?.nickname;
      if (typeof sourceNickname !== 'string' || !sourceNickname || base.IsPob || base.is_pob || base.kind === 'pob') continue;
      if (!Array.isArray(base.market_goods)) continue;
      for (const good of base.market_goods) {
        const goodNickname = good?.nickname;
        const id = itemId(goodNickname);
        if (!id || good.base_sells !== true
            || good.PoB || good.PoBGood || (good.category && good.category !== 'commodity')) continue;
        if (!manifestItem(scope, goodNickname, good.name)) continue;
        const commodity = String(good.name || goodNickname);
        if (!scope.byId.has(id)) {
          const name = keyFromName(commodity);
          fallbackIds.set(name, !fallbackIds.has(name) || fallbackIds.get(name) === id ? id : null);
        }
        const key = `${sourceNickname}/${goodNickname}`;
        const livePrice = finite(good.price_base_sells_for);
        const existing = offers.get(key);
        if (existing) {
          if (existing.livePrice !== livePrice) existing.livePrice = null;
          continue;
        }
        offers.set(key, {
          key, sourceNickname, goodNickname, livePrice,
          source: String(base.name || sourceNickname), commodity,
          system: String(base.system_name || good.system_name || base.system || ''),
          systemNickname: String(base.system_nickname || good.system_nick || '')
        });
      }
    }
    const fetchedAt = new Date().toISOString();
    state.receivedAt = Date.now();
    const routes = [...offers.values()].filter(route => scope.byId.has(itemId(route.goodNickname))
      || fallbackIds.get(keyFromName(route.commodity)) === itemId(route.goodNickname));
    state.marketCache = { schema: MARKET_SCHEMA, scope: scope.key, fetchedAt, routes: routes.sort((a, b) => a.key.localeCompare(b.key)) };
    // This snapshot is disposable and may exceed localStorage's quota. A
    // blocked or full IndexedDB still leaves the current live prices usable.
    void window.RHWTelemetryCache?.writeMarket?.(state.marketCache).catch(() => {});
    return true;
  }

  async function refreshMarket({ forceTrips = false, quiet = false } = {}) {
    if (!manifestScope()) return;
    state.loading = true;
    if (!quiet) {
      state.marketTone = 'waiting';
      state.marketLabel = 'REFRESHING MARKET';
      state.marketDetail = 'CONTACTING DARKSTAT NPC MARKET';
      render();
    }
    try {
      if (!snapshotRoutes(await fetchMarketBases())) return;
      state.lastError = '';
      state.marketTone = 'positive';
      state.marketLabel = 'NPC MARKET LIVE';
      state.marketDetail = `UPDATED ${new Date(state.marketCache.fetchedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (error) {
      state.lastError = String(error?.message || error || 'MARKET UPLINK FAILED');
      if (state.marketCache.fetchedAt) {
        state.marketTone = 'warn';
        state.marketLabel = 'CACHED MARKET';
        state.marketDetail = `LIVE REFRESH FAILED // SNAPSHOT ${new Date(state.marketCache.fetchedAt).toLocaleString('de-DE')}`;
      } else {
        state.marketTone = 'negative';
        state.marketLabel = 'MARKET UNAVAILABLE';
        state.marketDetail = state.lastError;
      }
    } finally {
      state.loading = false;
      render({ forceTrips });
    }
  }

  function effectiveRow(route, rhw = rhwSnapshot(), item = manifestItem(manifestScope(), route.goodNickname, route.commodity)) {
    const payout = rhw.available ? rhwPrice(item) : null;
    const live = finite(route.livePrice);
    const priceAt = state.marketCache.fetchedAt;
    const age = Date.now() - Date.parse(priceAt || '');
    const fresh = navigator.onLine !== false && state.receivedAt > 0 && age >= 0 && age < AUTO_REFRESH_MS * 2 && !state.lastError;
    const difference = live !== null && payout !== null ? payout - live : null;
    const tone = difference === null ? 'unknown' : (difference > 0 ? 'positive' : (difference < 0 ? 'negative' : 'neutral'));
    return { route, live, payout, difference, tone, fresh, priceAt, rhw };
  }

  function statusMarkup(rows) {
    const offers = rows.filter(row => row.route.sourceNickname).length;
    const positive = rows.filter(row => row.estimate?.quote?.currentRate > 0).length;
    const negative = rows.filter(row => row.estimate?.quote?.currentRate < 0).length;
    const hasComparison = rows.some(row => row.estimate?.quote?.currentRate != null);
    return `
      <article class="pricecheck-status"><small>MANIFEST COMMODITIES</small><strong>${rows.length.toLocaleString('en-US')}</strong></article>
      <article class="pricecheck-status"><small>NPC SOURCES</small><strong>${offers.toLocaleString('en-US')}</strong></article>
      <article class="pricecheck-status" data-tone="${positive ? 'positive' : 'neutral'}"><small>POSITIVE</small><strong>${hasComparison ? positive.toLocaleString('en-US') : '—'}</strong></article>
      <article class="pricecheck-status" data-tone="${negative ? 'negative' : 'neutral'}"><small>LOSS</small><strong>${hasComparison ? negative.toLocaleString('en-US') : '—'}</strong></article>`;
  }

  function loadTripModule() {
    tripLoader ||= import(new URL('./js/price-check/trip-data.mjs', document.baseURI).href).then(module => {
      tripModule = module;
      const selector = document.getElementById('priceCheckHauler');
      module.COMPARISON_FLEET.forEach(slot => selector.add(new Option(slot.name, slot.id)));
      module.onMapUpdate(at => {
        if (at === currentMapAt) return;
        currentMapAt = at;
        if (tripData) render();
      });
      return module;
    }).catch(error => { tripLoader = null; throw error; });
    return tripLoader;
  }

  function updateTrips(offers, force) {
    const base = typeof rhwBase !== 'undefined' ? rhwBase : null;
    const routes = offers.filter(offer => finite(offer.livePrice) !== null).map(offer => ({
      key: offer.key, sourceId: offer.sourceNickname, goodId: offer.goodNickname, system: offer.systemNickname
    }));
    const key = JSON.stringify([base?.nickname, base?.system_nickname, base?.base_pos ?? base?.pos, routes]);
    if (key !== tripKey) {
      tripRequest?.abort();
      tripRequest = null;
      tripData = null;
      tripError = '';
      nextTripAttempt = 0;
      tripKey = key;
    }
    const mapChanged = tripData && currentMapAt && tripData.mapAt !== currentMapAt;
    if (!base?.nickname || !base.system_nickname || !routes.length || tripRequest
        || (!force && !mapChanged && Date.now() < nextTripAttempt)) return;
    const request = tripRequest = new AbortController();
    loadTripModule().then(module => {
      const home = module.fixedRouteHome(base);
      if (!home) throw Error('RHW coordinates unavailable');
      return module.loadTrips(home, routes, { force, signal: request.signal });
    }).then(data => {
      if (tripRequest !== request) return;
      tripData = data;
      currentMapAt = data.latestMapAt;
      tripError = '';
    }).catch(error => {
      if (tripRequest === request) {
        tripData = null;
        tripError = error.message || 'Route data unavailable';
      }
    }).finally(() => {
      if (tripRequest !== request) return;
      tripRequest = null;
      nextTripAttempt = Date.now() + (!tripData || tripData.savedReferences ? AUTO_REFRESH_MS : 86400000);
      render();
    });
  }

  function hourlyEstimate(row) {
    const route = tripData?.trips[row.route.key];
    const quote = route && tripModule.quoteHourly(route.candidates, { hauler: state.hauler, quantity: state.quantity,
      sourcePrice: row.live, payout: row.payout, target: state.hourlyTarget });
    if (quote) return { quote };
    if (row.live === null) return { reason: 'Source price unavailable' };
    if (tripRequest) return { reason: 'Checking round trip…' };
    return { reason: route?.candidates.length ? 'No estimate for selected hauler' : route?.reason || 'Round trip unavailable' };
  }

  function compareOffers(a, b) {
    const first = a.estimate.quote;
    const second = b.estimate.quote;
    if (Boolean(first) !== Boolean(second)) return first ? -1 : 1;
    if (first && second) {
      const order = first.currentRate !== null && second.currentRate !== null
        ? second.currentRate - first.currentRate
        : first.targetUnitCost - second.targetUnitCost;
      if (order) return order;
    }
    return ((a.live ?? Infinity) - (b.live ?? Infinity)) || a.route.key.localeCompare(b.route.key);
  }

  function bestRows(scope = manifestScope(), offers = marketRoutes(scope), rhw = rhwSnapshot()) {
    if (!scope) return [];
    const keyFor = item => itemId(item.nickname) || `name:${commodityKey(item)}`;
    const winners = new Map();
    for (const route of offers) {
      const item = manifestItem(scope, route.goodNickname, route.commodity);
      const itemKey = keyFor(item);
      const row = effectiveRow({ ...route, commodity: displayName(item) }, rhw, item);
      row.itemKey = itemKey;
      row.estimate = hourlyEstimate(row);
      if (!winners.has(itemKey) || compareOffers(row, winners.get(itemKey)) < 0) winners.set(itemKey, row);
    }
    const missingSource = state.marketCache.fetchedAt && marketCovers(scope.key)
      ? 'No NPC seller reported' : state.lastError ? 'NPC market unavailable' : 'Awaiting NPC market';
    for (const item of scope.goods) {
      const itemKey = keyFor(item);
      if (winners.has(itemKey)) continue;
      const route = { key: itemKey, goodNickname: itemId(item.nickname), commodity: displayName(item),
        sourceNickname: '', source: '', system: '' };
      winners.set(itemKey, { ...effectiveRow(route, rhw, item), itemKey, missingSource });
    }
    return [...winners.values()];
  }

  function targetMarkup({ quote, reason }, fresh) {
    const label = `For ${money(state.hourlyTarget)}/h`;
    if (!quote) return `<span class="pricecheck-target"><small>${label}</small><small>${esc(reason)}</small></span>`;
    return `<span class="pricecheck-target"${fresh ? '' : ' title="Calculated with the cached NPC price"'}><small>${label}</small><b>${money(quote.targetPrice)} / unit</b></span>`;
  }

  function tripMarkup(quote) {
    if (!quote) return '';
    const time = Math.ceil(quote.seconds);
    return `<small class="pricecheck-trip">${esc(quote.ship)} · ${quote.units.toLocaleString('en-US')} units · ${Math.floor(time / 60)}m ${time % 60}s</small>`;
  }

  function rowMarkup(row) {
    const { route, live, payout, difference, tone, fresh, priceAt, rhw } = row;
    const stamp = Number.isFinite(Date.parse(priceAt || '')) ? new Date(priceAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'TIME UNKNOWN';
    const liveCopy = live === null ? 'SOURCE PRICE UNAVAILABLE' : `${fresh ? 'LIVE' : 'CACHED'} · ${stamp}`;
    const payoutCopy = payout === null ? (rhw.available ? 'RHW PRICE UNAVAILABLE' : 'RHW DATA UNAVAILABLE') : money(payout);
    const payoutStatus = payout === null ? '' : `<small class="${rhw.stale ? '' : 'pricecheck-current'}">${rhw.stale ? 'RHW CACHED' : 'CURRENT RHW BUY'}</small>`;
    const total = state.quantity && difference !== null ? `<small class="pricecheck-total"><b>${signedMoney(difference * state.quantity)}</b> total for ${state.quantity.toLocaleString('en-US')}</small>` : '';
    const estimate = route.sourceNickname ? row.estimate ?? hourlyEstimate(row) : null;
    const hourly = estimate?.quote?.currentRate;
    const hourlyCopy = hourly == null ? '' : `<small class="pricecheck-hourly" title="Estimated trader profit at the current RHW payout">Est. <b>${signedMoney(hourly)}/h</b></small>`;
    const comparison = estimate?.quote ? tripMarkup(estimate.quote)
      : (live !== null ? '<small>Lowest known NPC price</small>' : '');
    const source = route.sourceNickname
      ? `<strong>${esc(route.source)}</strong><small>${esc(route.system)}<span class="pricecheck-source-id">${route.system ? ' // ' : ''}${esc(route.sourceNickname)}</span></small>${comparison}`
      : `<small>${esc(row.missingSource)}</small>`;
    return `<tr class="pricecheck-row" data-commodity-key="${esc(row.itemKey ?? route.goodNickname)}" data-route-key="${esc(route.key)}">
      <td class="pricecheck-item-cell"><span class="pricecheck-mobile-label">COMMODITY</span><span class="pricecheck-commodity"><strong>${esc(route.commodity)}</strong></span></td>
      <td class="pricecheck-source-cell"><span class="pricecheck-mobile-label">SOURCE</span><span class="pricecheck-source">${source}</span></td>
      <td class="pricecheck-price-cell"><span class="pricecheck-mobile-label">NPC PRICE</span><div class="pricecheck-price-quote"><strong class="pricecheck-source-price">${money(live)}</strong>${estimate ? `<small class="pricecheck-live">${liveCopy}</small>` : ''}</div></td>
      <td class="pricecheck-payout-cell"><span class="pricecheck-mobile-label">RHW PAYS</span><span class="pricecheck-payout"><strong>${payoutCopy}</strong>${payoutStatus}</span>${estimate ? targetMarkup(estimate, fresh) : ''}</td>
      <td class="pricecheck-difference ${tone}"><span class="pricecheck-mobile-label">DIFFERENCE / UNIT</span><strong>${signedMoney(difference)}</strong>${total}${hourlyCopy}${difference !== null && (!fresh || rhw.stale) ? '<small class="pricecheck-estimate">FROM CACHED PRICES</small>' : ''}</td>
    </tr>`;
  }

  function compareRows(a, b) {
    const commodityOrder = a.route.commodity.localeCompare(b.route.commodity, 'en');
    if (state.sort === 'source') {
      return Number(!a.route.sourceNickname) - Number(!b.route.sourceNickname)
        || a.route.source.localeCompare(b.route.source, 'en') || commodityOrder;
    }
    if (state.sort === 'commodity') return commodityOrder;
    const first = a.estimate?.quote?.currentRate;
    const second = b.estimate?.quote?.currentRate;
    if (first == null) return second == null ? commodityOrder : 1;
    if (second == null) return -1;
    return (first - second) * (state.sort === 'best' ? -1 : 1) || commodityOrder;
  }

  function renderResults(rowsNode, rows, scope) {
    const terms = state.query.split(' ').filter(Boolean);
    const results = rows.filter(({ route }) => {
      if (!terms.length) return true;
      const text = normalize(`${route.commodity} ${route.source} ${route.system} ${route.goodNickname} ${route.sourceNickname}`);
      return terms.every(term => text.includes(term));
    }).sort(compareRows);
    const count = document.getElementById('priceCheckResultCount');
    const summary = !scope ? 'Waiting for the RHW Full Manifest.'
      : state.query ? `${results.length.toLocaleString('en-US')} matching commodities`
      : rows.length === 0 ? 'No commodities reported in the Full Manifest.' : '';
    if (count.textContent !== summary) count.textContent = summary;

    const existingRows = new Map([...rowsNode.children].map(row => [row.dataset.commodityKey, row]));
    results.forEach((row, index) => {
      const key = row.itemKey;
      const existing = existingRows.get(key);
      const fragment = document.createElement('tbody');
      fragment.innerHTML = rowMarkup(row);
      const next = fragment.firstElementChild;
      if (!existing) {
        rowsNode.insertBefore(next, rowsNode.children[index] || null);
        return;
      }
      existingRows.delete(key);
      existing.dataset.routeKey = row.route.key;
      if (rowsNode.children[index] !== existing) rowsNode.insertBefore(existing, rowsNode.children[index] || null);
      [...next.children].forEach((cell, cellIndex) => {
        const current = existing.children[cellIndex];
        current.className = cell.className;
        if (current.innerHTML !== cell.innerHTML) current.innerHTML = cell.innerHTML;
      });
    });
    existingRows.forEach(row => row.remove());
  }

  function render({ forceTrips = false } = {}) {
    if (app.state.activeWorkspace !== 'pricecheck') return;
    const grid = document.getElementById('priceCheckStatusGrid');
    const rowsNode = document.getElementById('priceCheckRows');
    const note = document.getElementById('priceCheckNote');
    const refresh = document.getElementById('priceCheckRefresh');
    if (!grid || !rowsNode || !note) return;

    const scope = manifestScope();
    const offers = marketRoutes(scope);
    const rhw = rhwSnapshot();
    updateTrips(offers, forceTrips);
    const rows = bestRows(scope, offers, rhw);
    const tripStatus = document.getElementById('priceCheckTripStatus');
    const tripCopy = tripError || (tripData ? `Route map checked ${new Date(tripData.mapAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}${tripData.savedReferences ? ' · saved ship or cargo data' : ''}` : '');
    if (tripStatus && tripStatus.textContent !== tripCopy) tripStatus.textContent = tripCopy;
    const status = statusMarkup(rows);
    if (grid.innerHTML !== status) grid.innerHTML = status;
    renderResults(rowsNode, rows, scope);

    const parts = [scope ? state.marketLabel : 'AWAITING RHW FULL MANIFEST'];
    if (scope && state.marketCache.fetchedAt && !marketCovers(scope.key)) parts.push('PARTIAL SNAPSHOT');
    if (scope && state.marketDetail) parts.push(state.marketDetail);
    if (rhw?.detail) parts.push(rhw.detail);
    note.textContent = parts.join(' // ');
    note.dataset.tone = state.marketTone === 'negative' ? 'error' : (state.marketTone === 'warn' || rhw.stale || !rhw.available ? 'warn' : 'good');
    if (refresh) {
      refresh.disabled = state.loading || !scope;
      refresh.textContent = state.loading ? 'REFRESHING…' : 'REFRESH MARKET';
    }
  }

  function normalizeOverrides(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID PRICE CHECK OVERRIDES');
    const result = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!LEGACY_OVERRIDE_KEYS.has(key)) throw new Error('UNKNOWN PRICE CHECK ROUTE');
      if (typeof value !== 'number' || finite(value) === null) throw new Error('INVALID SOURCE PRICE');
      result[key] = value;
    }
    return result;
  }

  function init() {
    ensureShell();
    if (state.initialized) return true;
    state.initialized = true;
    // The former cache contained the galaxy market and shared the quota
    // for preferences and drafts. Only this disposable entry is retired.
    try { window.localStorage.removeItem(LEGACY_MARKET_KEY); } catch { /* Optional cache cleanup. */ }
    void restoreMarket().finally(() => {
      cacheReady = true;
      scheduleMarket();
      render();
    });
    render();
    return true;
  }

  function activate(node = 'routes', { updateRoute = true } = {}) {
    init();
    app.state.pricecheckNode = 'routes';
    document.body.dataset.pricecheckNode = 'routes';
    app.setActiveNode('PRICE CHECK / NPC MARKET');
    render();
    if (updateRoute) app.route.write('pricecheck', 'routes');
    return 'routes';
  }

  app.lifecycle.on('shell:ready', 'price-check', 30, ensureShell);

  // RHW payout changes arrive through the same telemetry notifications as COMMAND.
  app.onUiUpdate(() => {
    if (state.initialized && app.state.activeWorkspace === 'pricecheck') {
      scheduleMarket();
      render();
    }
  });

  function selfTest() {
    const failures = [];
    if (!document.querySelector('.app-tabs [data-workspace="pricecheck"]')) failures.push('tab');
    if (!document.getElementById('workspacePricecheck')) failures.push('workspace');
    if ([...document.querySelectorAll('#priceCheckTarget input')].map(input => input.value).join(',') !== '500000,750000,1000000') failures.push('profit-targets');
    if (document.querySelector('#priceCheckRows input')) failures.push('editable-npc-price');
    if (document.querySelector('#rhwFocusToolsPanel [data-rhw-tool="build-queue"]')) failures.push('obsolete-build-queue');
    return failures;
  }

  app.pricecheck = {
    get routes() { return marketRoutes(); },
    get rows() { return bestRows(); },
    state,
    init,
    activate,
    render,
    refresh: options => refreshTask.refresh(options || {}),
    selfTest,
    snapshotRoutes, effectiveRow, rowMarkup,
    importOverrides(raw) {
      const merged = { ...state.overrides, ...normalizeOverrides(raw) };
      if (app.store.set(OVERRIDES_KEY, merged) === false) throw new Error('PRICE CHECK IMPORT COULD NOT BE SAVED');
      state.overrides = merged;
      render();
    },
    normalizeOverrides
  };

  installStyles();
})();
