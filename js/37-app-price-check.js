/* ========================================================================== */
/* RHW PRICE CHECK                                                            */
/* Fixed procurement routes only. Compares live source prices against RHW payout. */
/* RHW's current PoB purchase prices. Variable PoB goods stay in Network Scan.*/
/* ========================================================================== */
(function initRhwPriceCheck() {
  'use strict';

  const app = window.RHWV4;
  if (!app || app.pricecheck) return;

  const MARKET_API = 'https://darkstat.dd84ai.com/api/npc_bases';
  const AUTO_REFRESH_MS = 300000;
  const SOURCE_RESOLVE_RETRY_MS = 21600000;
  const STORAGE = Object.freeze({
    overrides: app.config.storageKeys.priceCheckOverrides || 'rhw-webapp-v4:price-check-overrides',
    sources: 'rhw-webapp-v4:price-check-sources',
    market: 'rhw-webapp-v4:price-check-market-cache'
  });

  /* Only fixed purchase routes belong here. Produced, mined and variable
     PoB-system goods are intentionally excluded and remain owned by the
     Production/Network Scan workflows. */
  const ROUTES = Object.freeze([
    Object.freeze({ key: 'copper', commodity: 'Copper', source: 'Copperland', system: 'Coronado', sourceType: 'pob', sourceNickname: 'copperland', aliases: ['Copperland'] }),
    Object.freeze({ key: 'hull-panels', commodity: 'Hull Panels', source: 'Portsmouth Shipyard', system: 'Cambridge', aliases: ['Portsmouth Shipyard'] }),
    Object.freeze({ key: 'industrial-materials', commodity: 'Industrial Materials', source: 'Planet New London', system: 'New London', aliases: ['Planet New London', 'New London'] }),
    Object.freeze({ key: 'mox', commodity: 'MOX', source: 'Belvedere Refinery', system: 'New London', aliases: ['Belvedere Refinery'] }),
    Object.freeze({ key: 'niobium', commodity: 'Niobium', source: 'Java Station', system: 'IMG', aliases: ['Java Station'] }),
    Object.freeze({ key: 'titanium', commodity: 'Titanium', source: 'Kensington Shipping Platform', system: 'New London', aliases: ['Kensington Shipping Platform'] }),
    Object.freeze({ key: 'energy-field-equipment', commodity: 'Energy Field Equipment', source: 'Planet Cambridge', system: 'Cambridge', aliases: ['Planet Cambridge', 'Cambridge'] }),
    Object.freeze({ key: 'super-alloy', commodity: 'Super Alloy', source: 'Durham Outpost', system: 'Leeds', aliases: ['Durham Outpost'] }),
    Object.freeze({ key: 'ablative-armor-plating', commodity: 'Ablative Armor Plating', source: 'Oder Shipyard', system: 'New Berlin', aliases: ['Oder Shipyard'] }),
    Object.freeze({ key: 'food-rations', commodity: 'Food Rations', source: 'Planet New London', system: 'New London', aliases: ['Planet New London', 'New London'] }),
    Object.freeze({ key: 'hydrocarbons', commodity: 'Hydrocarbons', source: 'Kensington Shipping Platform', system: 'New London', aliases: ['Kensington Shipping Platform'] }),
    Object.freeze({ key: 'consumer-goods', commodity: 'Consumer Goods', source: 'New London', system: 'New London', aliases: ['Planet New London', 'New London'] })
  ]);

  const state = {
    initialized: false,
    loading: false,
    timer: 0,
    overrides: app.store.get(STORAGE.overrides, {}) || {},
    sourceCache: app.store.get(STORAGE.sources, {}) || {},
    marketCache: app.store.get(STORAGE.market, {}) || {},
    marketTone: 'waiting',
    marketLabel: 'AWAITING MARKET DATA',
    marketDetail: '',
    lastError: '',
    receivedAt: 0
  };

  const base = {
    installShell: app.installShell,
    activateWorkspace: app.activateWorkspace,
    applyRoute: app.applyRoute,
    navigate: app.navigate,
    workspaceStoredNode: app.workspaceStoredNode,
    workspaceModule: app.workspaceModule,
    routeParse: app.route.parse,
    routeWrite: app.route.write
  };

  const esc = value => app.util.escape(value);
  const normalize = value => String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function money(value, { signed = false } = {}) {
    const parsed = finite(value);
    if (parsed === null) return '—';
    const rounded = Math.round(parsed);
    const prefix = signed && rounded > 0 ? '+' : '';
    return `${prefix}$${Math.abs(rounded).toLocaleString('en-US')}`.replace('$-', '-$');
  }

  function signedMoney(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    const rounded = Math.round(Number(value));
    if (rounded > 0) return `+$${rounded.toLocaleString('en-US')}`;
    if (rounded < 0) return `-$${Math.abs(rounded).toLocaleString('en-US')}`;
    return '$0';
  }

  function installStyles() {
    if (document.getElementById('rhwPriceCheckStyle')) return;
    const style = document.createElement('style');
    style.id = 'rhwPriceCheckStyle';
    style.dataset.stylesheet = '35-app-interface-cleanup.css';
    document.head.appendChild(style);
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
        <div><h2>PRICE CHECK</h2><p>FIXED PROCUREMENT // SOURCE COST VS RHW PAYOUT</p></div>
        <button type="button" class="pricecheck-refresh" id="priceCheckRefresh">REFRESH MARKET</button>
      </header>
      <div class="pricecheck-status-grid" id="priceCheckStatusGrid"></div>
      <div class="pricecheck-note" id="priceCheckNote">MARKET DATA LOADS WHEN PRICE CHECK OPENS.</div>
      <div class="pricecheck-table-wrap"><table class="pricecheck-table">
        <thead><tr><th>COMMODITY</th><th>SOURCE</th><th>SOURCE PRICE / OVERRIDE</th><th>RHW PAYS</th><th>DIFFERENCE</th></tr></thead>
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
      button.innerHTML = '<span>PRICE CHECK</span><small>FIXED ROUTES</small>';
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
    panel.addEventListener('click', event => {
      if (event.target.closest('#priceCheckRefresh')) {
        refreshMarket({ forceResolve: true });
        return;
      }
      const reset = event.target.closest('[data-pricecheck-reset]');
      if (reset) {
        const key = reset.dataset.pricecheckReset;
        delete state.overrides[key];
        app.store.set(STORAGE.overrides, state.overrides);
        render();
      }
    });
    panel.addEventListener('input', event => {
      const input = event.target.closest('[data-pricecheck-override]');
      if (!input) return;
      const key = input.dataset.pricecheckOverride;
      const raw = String(input.value || '').trim();
      if (!raw) delete state.overrides[key];
      else {
        const value = Number(raw);
        if (Number.isFinite(value) && value >= 0) state.overrides[key] = value;
      }
      app.store.set(STORAGE.overrides, state.overrides);
      render();
      const restored = document.querySelector(`[data-pricecheck-override="${CSS.escape(key)}"]`);
      restored?.focus({ preventScroll: true });
      if (restored && raw) {
        restored.value = raw;
        try { restored.setSelectionRange(raw.length, raw.length); } catch {}
      }
    });
  }

  function marketGoodFor(baseEntry, commodity) {
    const target = normalize(commodity);
    const candidates = Array.isArray(baseEntry?.market_goods) ? baseEntry.market_goods : [];
    const matches = candidates.filter(good => normalize(good?.name || good?.nickname) === target);
    if (!matches.length) return null;
    return matches.find(good => good?.base_sells === true && finite(good?.price_base_sells_for) !== null)
      || matches.find(good => finite(good?.price_base_sells_for) !== null)
      || matches[0];
  }


  function pobGoodFor(baseEntry, commodity) {
    const target = normalize(commodity);
    const candidates = Array.isArray(baseEntry?.shop_items) ? baseEntry.shop_items : [];
    return candidates.find(good => normalize(good?.name || good?.item_name) === target)
      || candidates.find(good => normalize(good?.nickname) === `commodity ${target}`)
      || null;
  }

  function pobSourceFor(route) {
    try {
      const pobs = typeof allBases !== 'undefined' && Array.isArray(allBases) ? allBases : [];
      const nickname = normalize(route?.sourceNickname || route?.source);
      const name = normalize(route?.source);
      return pobs.find(baseEntry => normalize(baseEntry?.nickname) === nickname)
        || pobs.find(baseEntry => normalize(baseEntry?.name) === name)
        || null;
    } catch {
      return null;
    }
  }

  function baseSystem(baseEntry) {
    return String(baseEntry?.system_name || baseEntry?.system || '').trim();
  }

  function sourceScore(baseEntry, route) {
    const name = normalize(baseEntry?.name);
    if (!name || !String(baseEntry?.nickname || '').trim()) return -1;
    const system = normalize(baseSystem(baseEntry));
    const aliases = [...new Set([route.source, ...(route.aliases || [])].map(normalize).filter(Boolean))];
    let nameScore = 0;
    for (const alias of aliases) {
      if (name === alias) nameScore = Math.max(nameScore, 120);
      else if (alias.length >= 5 && (name.includes(alias) || alias.includes(name))) nameScore = Math.max(nameScore, 75);
    }
    if (!nameScore) return -1;
    let score = nameScore;
    if (system && normalize(route.system) === system) score += 25;
    if (marketGoodFor(baseEntry, route.commodity)) score += 35;
    return score;
  }

  function resolveSource(route, bases) {
    let best = null;
    let bestScore = -1;
    let ambiguous = false;
    for (const baseEntry of bases || []) {
      const score = sourceScore(baseEntry, route);
      if (score > bestScore) {
        best = baseEntry;
        bestScore = score;
        ambiguous = false;
      } else if (score === bestScore && best?.nickname !== baseEntry?.nickname) {
        ambiguous = true;
      }
    }
    return bestScore >= 75 && !ambiguous ? best : null;
  }

  function rhwPrice(route) {
    try {
      const finder = typeof findCommodity === 'function' ? findCommodity : window.findCommodity;
      const item = typeof finder === 'function' ? finder(route.commodity) : null;
      if (!item || item.missing) return null;
      // Asking prices are not evidence of what RHW pays the delivering player.
      return [item.price_to_sell_to_base, item.sell_price, item.price_sell].map(finite).find(value => value !== null) ?? null;
    } catch {
      return null;
    }
  }

  function rhwSnapshot() {
    try {
      const getter = typeof telemetrySnapshot === 'function' ? telemetrySnapshot : window.telemetrySnapshot;
      if (typeof getter === 'function') return getter();
    } catch {}
    return { available: false, stale: false, label: 'RHW PRICE DATA UNAVAILABLE', detail: '' };
  }

  async function fetchJson(body) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch(MARKET_API, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

  async function fetchMarketBases({ full = false } = {}) {
    const sourceMap = state.sourceCache?.sources || {};
    const nicknames = [...new Set(Object.values(sourceMap).map(entry => entry?.nickname).filter(Boolean))];
    const body = {
      include_market_goods: true,
      filter_to_useful: true,
      filter_market_good_category: ['commodity']
    };
    if (!full && nicknames.length) body.filter_nicknames = nicknames;
    return fetchJson(body);
  }

  function snapshotRoutes(bases, { resolve = false } = {}) {
    const previous = state.marketCache?.routes || {};
    const checkedAt = new Date().toISOString();
    state.receivedAt = Date.now();
    const next = {};
    const sources = { ...(state.sourceCache?.sources || {}) };

    for (const route of ROUTES.filter(route => route.sourceType !== 'pob')) {
      let source = null;
      const known = sources[route.key];
      if (known?.nickname) source = (bases || []).find(baseEntry => String(baseEntry?.nickname || '') === String(known.nickname));
      if (!source && resolve) source = resolveSource(route, bases);
      if (source) {
        sources[route.key] = {
          nickname: String(source.nickname || ''),
          name: String(source.name || route.source),
          system: baseSystem(source) || route.system
        };
      }
      const good = source ? marketGoodFor(source, route.commodity) : null;
      const livePrice = good?.base_sells === false ? null : finite(good?.price_base_sells_for);
      next[route.key] = {
        sourceNickname: sources[route.key]?.nickname || previous[route.key]?.sourceNickname || '',
        sourceName: source?.name || sources[route.key]?.name || previous[route.key]?.sourceName || route.source,
        system: baseSystem(source) || sources[route.key]?.system || previous[route.key]?.system || route.system,
        goodNickname: good?.nickname || previous[route.key]?.goodNickname || '',
        livePrice,
        checkedAt,
        priceAt: livePrice !== null ? checkedAt : null,
        found: Boolean(source),
        sold: good ? good.base_sells !== false : false
      };
    }

    state.sourceCache = { resolvedAt: resolve ? Date.now() : Number(state.sourceCache?.resolvedAt) || 0, sources };
    app.store.set(STORAGE.sources, state.sourceCache);
    state.marketCache = { fetchedAt: checkedAt, routes: next };
    app.store.set(STORAGE.market, state.marketCache);
  }

  function shouldResolveSources(forceResolve) {
    if (forceResolve) return true;
    const sources = state.sourceCache?.sources || {};
    const missing = ROUTES.filter(route => route.sourceType !== 'pob').some(route => !sources[route.key]?.nickname);
    const age = Date.now() - (Number(state.sourceCache?.resolvedAt) || 0);
    return missing && age >= SOURCE_RESOLVE_RETRY_MS;
  }

  async function refreshMarket({ forceResolve = false, quiet = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    state.lastError = '';
    if (!quiet) {
      state.marketTone = 'waiting';
      state.marketLabel = 'REFRESHING MARKET';
      state.marketDetail = 'CONTACTING DARKSTAT NPC MARKET';
      render();
    }
    try {
      const full = shouldResolveSources(forceResolve) || !Object.keys(state.sourceCache?.sources || {}).length;
      let bases = await fetchMarketBases({ full });
      snapshotRoutes(bases, { resolve: full });

      /* A cached nickname can disappear after a Discovery data change. One full
         resolution pass repairs renamed/replaced sources without making every
         normal five-minute refresh expensive. */
      const missingKnownBase = !full && ROUTES.filter(route => route.sourceType !== 'pob').some(route => {
        const nickname = state.sourceCache?.sources?.[route.key]?.nickname;
        return nickname && !bases.some(baseEntry => String(baseEntry?.nickname || '') === String(nickname));
      });
      if (missingKnownBase) {
        bases = await fetchMarketBases({ full: true });
        snapshotRoutes(bases, { resolve: true });
      }

      const complete = ROUTES.filter(route => route.sourceType !== 'pob').every(route => finite(state.marketCache.routes[route.key]?.livePrice) !== null);
      state.marketTone = complete ? 'positive' : 'warn';
      state.marketLabel = complete ? 'NPC MARKET LIVE' : 'MARKET UPDATED · SOME PRICES UNAVAILABLE';
      state.marketDetail = `UPDATED ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (error) {
      state.lastError = String(error?.message || error || 'MARKET UPLINK FAILED');
      if (state.marketCache?.fetchedAt && Object.keys(state.marketCache?.routes || {}).length) {
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
      render();
      scheduleRefresh();
    }
  }

  function effectiveRow(route) {
    const rhw = rhwSnapshot();
    let market = state.marketCache?.routes?.[route.key] || {};
    if (route.sourceType === 'pob') {
      const source = pobSourceFor(route);
      const good = source ? pobGoodFor(source, route.commodity) : null;
      // PoB shop semantics: price = player buys from base; sell_price = base buys from player.
      const pobLivePrice = finite(good?.price ?? good?.price_to_buy_from_base ?? good?.buy_price);
      if (source) {
        market = {
          ...market,
          sourceNickname: String(source.nickname || route.sourceNickname || ''),
          sourceName: String(source.name || route.source),
          system: String(source.system_name || source.system || route.system),
          goodNickname: String(good?.nickname || ''),
          livePrice: pobLivePrice,
          found: true,
          sold: pobLivePrice !== null,
          sourceType: 'pob',
          priceAt: rhw.fetchedAt || null
        };
      } else market = { found: false, sold: false, sourceType: 'pob' };
    }
    const live = market.found === false || market.sold === false ? null : finite(market.livePrice);
    const priceAt = market.priceAt || state.marketCache?.fetchedAt;
    const age = Date.now() - Date.parse(priceAt || '');
    const fresh = route.sourceType === 'pob'
      ? rhw.available && !rhw.stale
      : state.receivedAt > 0 && Number.isFinite(age) && age >= 0 && age < AUTO_REFRESH_MS * 2 && !state.lastError;
    const hasOverride = Object.prototype.hasOwnProperty.call(state.overrides, route.key) && finite(state.overrides[route.key]) !== null;
    const sourcePrice = hasOverride ? finite(state.overrides[route.key]) : live;
    const payout = rhw.available ? rhwPrice(route) : null;
    const difference = sourcePrice !== null && payout !== null ? payout - sourcePrice : null;
    const tone = difference === null ? 'unknown' : (difference > 0 ? 'positive' : (difference < 0 ? 'negative' : 'neutral'));
    return { route, market, live, hasOverride, sourcePrice, payout, difference, tone, fresh, priceAt, rhw };
  }

  function statusMarkup(rows) {
    const positive = rows.filter(row => row.difference !== null && row.difference > 0).length;
    const negative = rows.filter(row => row.difference !== null && row.difference < 0).length;
    const neutral = rows.filter(row => row.difference === 0).length;
    const unknown = rows.length - positive - negative - neutral;
    const rhw = rhwSnapshot();
    const rhwTone = rhw.available && !rhw.stale ? 'positive' : 'warn';
    return `
      <article class="pricecheck-status"><small>FIXED ROUTES</small><strong>${ROUTES.length}</strong></article>
      <article class="pricecheck-status" data-tone="positive"><small>POSITIVE</small><strong>${positive}</strong></article>
      <article class="pricecheck-status" data-tone="${negative ? 'negative' : 'positive'}"><small>LOSS</small><strong>${negative}</strong></article>
      <article class="pricecheck-status" data-tone="${unknown ? 'warn' : rhwTone}"><small>DATA STATUS</small><strong>${unknown ? `${unknown} MISSING` : esc(rhw.label || 'RHW READY')}</strong></article>`;
  }

  function rowMarkup(row) {
    const { route, market, live, hasOverride, payout, difference, tone, fresh, priceAt, rhw } = row;
    const overrideValue = hasOverride ? String(state.overrides[route.key]) : '';
    const sourceName = market.sourceName || route.source;
    const system = market.system || route.system;
    const sourceMeta = market.sourceType === 'pob'
      ? `${system} // POB ${market.sourceNickname || route.sourceNickname || route.source}`
      : (market.sourceNickname ? `${system} // ${market.sourceNickname}` : `${system} // SOURCE MATCH PENDING`);
    const stamp = Number.isFinite(Date.parse(priceAt || '')) ? new Date(priceAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'TIME UNKNOWN';
    const liveCopy = live === null ? 'SOURCE PRICE UNAVAILABLE' : `${fresh ? 'LIVE' : 'CACHED'} ${money(live)} · ${stamp}`;
    const payoutCopy = payout === null ? 'RHW PRICE UNAVAILABLE' : money(payout);
    return `<tr class="pricecheck-row" data-route-key="${esc(route.key)}">
      <td><span class="pricecheck-mobile-label">COMMODITY</span><span class="pricecheck-commodity"><strong>${esc(route.commodity)}</strong><small>${route.sourceType === 'pob' ? 'FIXED POB ROUTE' : 'FIXED NPC ROUTE'}</small></span></td>
      <td><span class="pricecheck-mobile-label">SOURCE</span><span class="pricecheck-source"><strong>${esc(sourceName)}</strong><small>${esc(sourceMeta)}</small></span></td>
      <td><span class="pricecheck-mobile-label">SOURCE PRICE / OVERRIDE</span><div class="pricecheck-price-editor"><input class="pricecheck-price-input" data-pricecheck-override="${esc(route.key)}" type="number" inputmode="decimal" min="0" step="1" value="${esc(overrideValue)}" placeholder="${live === null ? '' : esc(String(Math.round(live)))}" aria-label="${esc(route.commodity)} manual source price">${hasOverride ? `<button type="button" class="pricecheck-reset" data-pricecheck-reset="${esc(route.key)}">RESET</button>` : ''}<small class="pricecheck-live ${hasOverride ? 'manual' : ''}">${hasOverride ? `MANUAL ACTIVE // ${liveCopy}` : liveCopy}</small></div></td>
      <td><span class="pricecheck-mobile-label">RHW PAYS</span><span class="pricecheck-payout"><strong>${payoutCopy}</strong><small>${!rhw.available ? 'RHW DATA UNAVAILABLE' : rhw.stale ? 'RHW CACHED' : 'CURRENT RHW BUY'}</small></span></td>
      <td class="pricecheck-difference ${tone}"><span class="pricecheck-mobile-label">DIFFERENCE</span><strong>${signedMoney(difference)}</strong>${difference !== null && ((!fresh && !hasOverride) || rhw.stale) ? '<small class="pricecheck-estimate">FROM CACHED PRICES</small>' : ''}</td>
    </tr>`;
  }

  function render() {
    const grid = document.getElementById('priceCheckStatusGrid');
    const rowsNode = document.getElementById('priceCheckRows');
    const note = document.getElementById('priceCheckNote');
    const refresh = document.getElementById('priceCheckRefresh');
    if (!grid || !rowsNode || !note) return;

    const rows = ROUTES.map(effectiveRow);
    grid.innerHTML = statusMarkup(rows);
    rowsNode.innerHTML = rows.map(rowMarkup).join('');

    const rhw = rhwSnapshot();
    const parts = [state.marketLabel];
    if (state.marketDetail) parts.push(state.marketDetail);
    if (rhw?.detail) parts.push(rhw.detail);
    note.textContent = parts.join(' // ');
    note.dataset.tone = state.marketTone === 'negative' ? 'error' : (state.marketTone === 'warn' || rhw.stale || !rhw.available ? 'warn' : 'good');
    if (refresh) {
      refresh.disabled = state.loading;
      refresh.textContent = state.loading ? 'REFRESHING…' : 'REFRESH MARKET';
    }
  }

  function scheduleRefresh() {
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => refreshMarket({ quiet: true }), AUTO_REFRESH_MS);
  }

  function normalizeOverrides(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID PRICE CHECK OVERRIDES');
    const result = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!ROUTES.some(route => route.key === key)) throw new Error('UNKNOWN PRICE CHECK ROUTE');
      if (typeof value !== 'number' || finite(value) === null) throw new Error('INVALID SOURCE PRICE');
      result[key] = value;
    }
    return result;
  }

  function init() {
    ensureShell();
    if (state.initialized) return true;
    state.initialized = true;
    render();
    const cachedAt = state.marketCache?.fetchedAt ? new Date(state.marketCache.fetchedAt).getTime() : 0;
    if (!cachedAt || Date.now() - cachedAt >= AUTO_REFRESH_MS) refreshMarket({ quiet: Boolean(cachedAt) });
    else {
      state.marketTone = 'warn';
      state.marketLabel = 'CACHED MARKET';
      state.marketDetail = `SNAPSHOT ${new Date(cachedAt).toLocaleString('de-DE')}`;
      render();
      scheduleRefresh();
    }
    return true;
  }

  function activate(node = 'routes', { updateRoute = true } = {}) {
    init();
    app.state.pricecheckNode = 'routes';
    document.body.dataset.pricecheckNode = 'routes';
    app.setActiveNode('PRICE CHECK / FIXED ROUTES');
    render();
    if (updateRoute) app.route.write('pricecheck', 'routes');
    return 'routes';
  }

  function activatePriceWorkspace() {
    app.state.activeWorkspace = 'pricecheck';
    app.store.set(app.config.storageKeys.activeWorkspace, 'pricecheck');
    document.body.dataset.workspace = 'pricecheck';
    document.body.removeAttribute('data-rhw-focus-tool');
    app.focusPass?.closeTools?.();
    document.querySelectorAll('.app-workspace').forEach(panel => {
      panel.hidden = panel.id !== 'workspacePricecheck';
    });
    document.querySelectorAll('.app-tabs [data-workspace]').forEach(button => {
      const active = button.dataset.workspace === 'pricecheck';
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    });
  }

  function isPriceRoute() {
    const parts = location.hash.replace(/^#/, '').toLowerCase().split('/').filter(Boolean);
    return parts[0] === 'pricecheck';
  }

  function priceRoute() {
    const parts = location.hash.replace(/^#/, '').toLowerCase().split('/').filter(Boolean);
    return { workspace: 'pricecheck', node: parts[1] || 'routes' };
  }

  app.installShell = function priceCheckInstallShell(...args) {
    const result = base.installShell.apply(this, args);
    if (result) ensureShell();
    return result;
  };

  app.activateWorkspace = function priceCheckActivateWorkspace(workspace) {
    if (workspace === 'pricecheck') {
      activatePriceWorkspace();
      return;
    }
    return base.activateWorkspace.call(this, workspace);
  };

  app.workspaceStoredNode = function priceCheckStoredNode(workspace) {
    if (workspace === 'pricecheck') return 'routes';
    return base.workspaceStoredNode.call(this, workspace);
  };

  app.workspaceModule = function priceCheckWorkspaceModule(workspace) {
    if (workspace === 'pricecheck') return app.pricecheck;
    return base.workspaceModule.call(this, workspace);
  };

  app.route.parse = function priceCheckParse() {
    if (isPriceRoute()) return priceRoute();
    return base.routeParse.call(this);
  };

  app.route.write = function priceCheckWrite(workspace, node, { replace = false } = {}) {
    if (workspace !== 'pricecheck') return base.routeWrite.call(this, workspace, node, { replace });
    const next = '#pricecheck/routes';
    if (location.hash === next) return;
    const method = replace ? 'replaceState' : 'pushState';
    history[method]({ rhwWorkspace: 'pricecheck', rhwNode: 'routes' }, '', next);
  };

  app.applyRoute = function priceCheckApplyRoute(options = {}) {
    const route = app.route.parse();
    const stored = app.store.get(app.config.storageKeys.activeWorkspace, 'command');
    if (route.workspace === 'pricecheck' || (!route.workspace && stored === 'pricecheck')) {
      activatePriceWorkspace();
      activate(route.node || 'routes', { updateRoute: false });
      if (options.replace || location.hash !== '#pricecheck/routes') app.route.write('pricecheck', 'routes', { replace: true });
      return;
    }
    return base.applyRoute.call(this, options);
  };

  app.navigate = function priceCheckNavigate(workspace, node, options = {}) {
    if (workspace !== 'pricecheck') return base.navigate.call(this, workspace, node, options);
    activatePriceWorkspace();
    activate(node || 'routes', { updateRoute: false });
    app.route.write('pricecheck', 'routes', { replace: Boolean(options.replace) });
  };

  function selfTest() {
    const failures = [];
    if (!document.getElementById('rhwPriceCheckStyle')) failures.push('style');
    if (!document.querySelector('.app-tabs [data-workspace="pricecheck"]')) failures.push('tab');
    if (!document.getElementById('workspacePricecheck')) failures.push('workspace');
    if (ROUTES.length !== 12) failures.push('route-count');
    const copperRoute = ROUTES.find(route => route.key === 'copper');
    if (copperRoute?.sourceType !== 'pob' || copperRoute?.sourceNickname !== 'copperland') failures.push('copper-source');
    if (finite(pobGoodFor({ shop_items: [{ name: 'Copper', price: 100, sell_price: 80 }] }, 'Copper')?.price) !== 100) failures.push('copper-pob-buy-from-base-price');
    if (document.querySelector('#rhwFocusToolsPanel [data-rhw-tool="build-queue"]')) failures.push('obsolete-build-queue');
    return failures;
  }

  app.pricecheck = {
    routes: ROUTES,
    state,
    init,
    activate,
    render,
    refresh: options => refreshMarket(options || {}),
    selfTest,
    resolveSource,
    marketGoodFor,
    snapshotRoutes, shouldResolveSources, effectiveRow, rowMarkup,
    importOverrides(raw) {
      const merged = { ...state.overrides, ...normalizeOverrides(raw) };
      if (app.store.set(STORAGE.overrides, merged) === false) throw new Error('PRICE CHECK IMPORT COULD NOT BE SAVED');
      state.overrides = merged;
      render();
    },
    normalizeOverrides
  };

  installStyles();
})();
