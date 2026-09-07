/* ========================================================================== */
/* RHW PRICE CHECK                                                            */
/* Fixed NPC procurement routes only. Compares live NPC source prices against */
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
    overrides: 'rhw-webapp-v4:price-check-overrides',
    sources: 'rhw-webapp-v4:price-check-sources',
    market: 'rhw-webapp-v4:price-check-market-cache'
  });

  /* Only fixed NPC purchase routes belong here. Produced, mined and variable
     PoB-system goods are intentionally excluded and remain owned by the
     Production/Network Scan workflows. */
  const ROUTES = Object.freeze([
    Object.freeze({ key: 'copper', commodity: 'Copper', source: 'Copperland', system: 'Coronado', aliases: ['Copperland'] }),
    Object.freeze({ key: 'hull-panels', commodity: 'Hull Panels', source: 'Portsmouth Shipyard', system: 'Cambridge', aliases: ['Portsmouth Shipyard'] }),
    Object.freeze({ key: 'industrial-materials', commodity: 'Industrial Materials', source: 'Planet New London', system: 'New London', aliases: ['Planet New London', 'New London'] }),
    Object.freeze({ key: 'molybdenum', commodity: 'Molybdenum', source: "L'Ardenne Trading Post/Depot", system: 'Zurich', aliases: ["L'Ardenne Trading Post", "L'Ardenne Trading Depot", "L'Ardenne"] }),
    Object.freeze({ key: 'mox', commodity: 'MOX', source: 'Belvedere Refinery', system: 'New London', aliases: ['Belvedere Refinery'] }),
    Object.freeze({ key: 'niobium', commodity: 'Niobium', source: 'Java Station', system: 'IMG', aliases: ['Java Station'] }),
    Object.freeze({ key: 'toxic-waste', commodity: 'Toxic Waste', source: 'Portsmouth Shipyard', system: 'Cambridge', aliases: ['Portsmouth Shipyard'] }),
    Object.freeze({ key: 'titanium', commodity: 'Titanium', source: 'Kensington Shipping Platform', system: 'New London', aliases: ['Kensington Shipping Platform'] }),
    Object.freeze({ key: 'energy-field-equipment', commodity: 'Energy Field Equipment', source: 'Planet Cambridge', system: 'Cambridge', aliases: ['Planet Cambridge', 'Cambridge'] }),
    Object.freeze({ key: 'super-alloy', commodity: 'Super Alloy', source: 'Durham Outpost', system: 'Leeds', aliases: ['Durham Outpost'] }),
    Object.freeze({ key: 'ablative-armor-plating', commodity: 'Ablative Armor Plating', source: 'Oder Shipyard', system: 'New Berlin', aliases: ['Oder Shipyard'] }),
    Object.freeze({ key: 'scrap-metal-market', commodity: 'Scrap Metal', source: 'Belvedere Refinery', system: 'Cambridge', aliases: ['Belvedere Refinery'] }),
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
    lastError: ''
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
    style.textContent = `
      html.rhw-pricecheck-enabled .app-tabs{grid-template-columns:repeat(4,minmax(0,1fr))!important}
      body[data-workspace="pricecheck"]{--app-nav-accent:#78ad8a;--app-nav-accent-rgb:120,173,138}
      body[data-workspace="pricecheck"] #appContextNavSlot{display:none!important}
      body[data-workspace="pricecheck"] .app-tabs [data-workspace="pricecheck"].active{background:linear-gradient(180deg,rgba(120,173,138,.14),rgba(120,173,138,.035))!important;color:#91c9a3!important}
      body[data-workspace="pricecheck"] .app-tabs [data-workspace="pricecheck"].active::before{background:#78ad8a!important;box-shadow:0 0 10px rgba(120,173,138,.5)!important}
      body[data-workspace="pricecheck"] .app-tabs [data-workspace="pricecheck"].active small{color:rgba(145,201,163,.72)!important}
      .pricecheck-workspace[hidden]{display:none!important}
      .pricecheck-workspace{position:relative;width:100%;min-height:60vh;padding:22px var(--layout-gutter,28px) 52px;background:radial-gradient(circle at 10% 0%,rgba(120,173,138,.045),transparent 28%),linear-gradient(180deg,rgba(4,6,8,.97),rgba(3,4,5,.995))}
      .pricecheck-frame{width:min(100%,var(--content-max,1560px));margin:0 auto}
      .pricecheck-heading{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:12px;padding:14px 16px;border:1px solid rgba(120,173,138,.2);border-left:3px solid #78ad8a;border-radius:8px;background:linear-gradient(90deg,rgba(120,173,138,.075),rgba(7,9,12,.94) 52%)}
      .pricecheck-heading h2{margin:0;color:#e8e6df;font-family:var(--font-title);font-size:clamp(28px,2.5vw,38px);font-weight:600;letter-spacing:.055em;line-height:1}
      .pricecheck-heading p{margin:5px 0 0;color:#bcbebf;font-family:var(--font-tech);font-size:11px;line-height:1.4;letter-spacing:.045em}
      .pricecheck-refresh{min-height:44px;padding:9px 13px;border:1px solid rgba(120,173,138,.35);border-radius:5px;background:rgba(120,173,138,.075);color:#b8dec3;font-family:var(--font-tech);font-size:11px;font-weight:700;letter-spacing:.07em;clip-path:none;box-shadow:none;white-space:nowrap}
      .pricecheck-refresh:hover,.pricecheck-refresh:focus-visible{border-color:rgba(120,173,138,.58);background:rgba(120,173,138,.13);color:#d0eed8}
      .pricecheck-refresh:disabled{opacity:.5;cursor:wait}
      .pricecheck-status-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-bottom:12px}
      .pricecheck-status{min-width:0;padding:10px 11px;border:1px solid rgba(255,255,255,.07);border-radius:6px;background:rgba(255,255,255,.018)}
      .pricecheck-status small{display:block;color:#979da4;font-family:var(--font-tech);font-size:9px;letter-spacing:.065em}
      .pricecheck-status strong{display:block;margin-top:5px;color:#deddd7;font-family:var(--font-tech);font-size:13px;line-height:1.3;overflow-wrap:anywhere}
      .pricecheck-status[data-tone="positive"] strong{color:#8fc6a0}.pricecheck-status[data-tone="negative"] strong{color:#d47b7b}.pricecheck-status[data-tone="warn"] strong{color:#d3b766}
      .pricecheck-note{margin:0 0 12px;padding:8px 10px;border:1px solid rgba(255,255,255,.065);border-radius:5px;background:rgba(0,0,0,.12);color:#aeb2b5;font-family:var(--font-tech);font-size:10px;line-height:1.5}
      .pricecheck-note strong{color:#d7d5cf}.pricecheck-note[data-tone="warn"]{border-color:rgba(211,183,102,.25);color:#c9b979}.pricecheck-note[data-tone="error"]{border-color:rgba(199,94,94,.3);color:#d28b8b}
      .pricecheck-table-wrap{overflow:auto;border:1px solid rgba(120,173,138,.13);border-radius:7px;background:rgba(2,4,6,.7)}
      .pricecheck-table{width:100%;border-collapse:collapse;table-layout:fixed}
      .pricecheck-table th{padding:9px 10px;border-bottom:1px solid rgba(120,173,138,.16);background:rgba(120,173,138,.035);color:#9aa2a2;font-family:var(--font-tech);font-size:9px;letter-spacing:.07em;text-align:left}
      .pricecheck-table th:nth-child(1){width:20%}.pricecheck-table th:nth-child(2){width:28%}.pricecheck-table th:nth-child(3){width:20%}.pricecheck-table th:nth-child(4){width:15%}.pricecheck-table th:nth-child(5){width:17%;text-align:right}
      .pricecheck-row td{padding:11px 10px;border-bottom:1px solid rgba(255,255,255,.045);vertical-align:middle;color:#d8d7d1;font-family:var(--font-tech);font-size:11px}
      .pricecheck-row:last-child td{border-bottom:0}
      .pricecheck-commodity{display:grid;gap:3px}.pricecheck-commodity strong{font-family:var(--font-title);font-size:18px;letter-spacing:.04em;color:#e3e1da}.pricecheck-commodity small,.pricecheck-source small{color:#8f969b;font-size:9px;line-height:1.35}
      .pricecheck-source{display:grid;gap:3px}.pricecheck-source strong{font-size:11px;color:#d3d4d0}
      .pricecheck-price-editor{display:grid;grid-template-columns:minmax(90px,130px) auto;align-items:center;gap:6px}.pricecheck-price-input{width:100%;min-height:40px;padding:7px 8px;border:1px solid rgba(255,255,255,.12);border-radius:4px;background:#080b0e;color:#e0ded6;font:12px var(--font-tech);box-shadow:none}.pricecheck-price-input:focus{outline:2px solid rgba(120,173,138,.45);outline-offset:1px;border-color:rgba(120,173,138,.45)}
      .pricecheck-live{grid-column:1/-1;color:#8d9498;font-size:9px;line-height:1.35}.pricecheck-live b{color:#b8bbb9;font-weight:700}.pricecheck-live.manual{color:#d1b868}.pricecheck-reset{min-height:40px;padding:6px 8px;border:1px solid rgba(211,183,102,.24);border-radius:4px;background:rgba(211,183,102,.045);color:#cfbd7c;font:9px var(--font-tech);clip-path:none;box-shadow:none}
      .pricecheck-payout strong{display:block;color:#d8d6cf;font-size:12px}.pricecheck-payout small{display:block;margin-top:3px;color:#8f969b;font-size:9px}
      .pricecheck-difference{text-align:right!important}.pricecheck-difference strong{display:inline-block;min-width:90px;padding:6px 8px;border:1px solid rgba(255,255,255,.08);border-radius:4px;background:rgba(255,255,255,.02);font-size:12px;text-align:center}.pricecheck-difference.positive strong{border-color:rgba(120,173,138,.3);background:rgba(120,173,138,.075);color:#8fc6a0}.pricecheck-difference.negative strong{border-color:rgba(199,94,94,.34);background:rgba(199,94,94,.08);color:#df8585}.pricecheck-difference.neutral strong{color:#b7b7b1}.pricecheck-difference.unknown strong{color:#8d9296}
      .pricecheck-mobile-label{display:none}
      @media(max-width:900px){.pricecheck-status-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.pricecheck-table{min-width:820px}}
      @media(max-width:760px){
        html.rhw-pricecheck-enabled .app-tabs{grid-template-columns:repeat(4,minmax(0,1fr))!important}
        html.rhw-pricecheck-enabled .app-tabs button{min-width:0!important;padding-left:5px!important;padding-right:5px!important}
        html.rhw-pricecheck-enabled .app-tabs button span{font-size:13px!important;letter-spacing:.025em!important;white-space:nowrap}
        html.rhw-pricecheck-enabled .app-tabs [data-workspace="pricecheck"] span{font-size:11px!important}
        .pricecheck-workspace{padding:10px 9px calc(var(--rhw-mobile-dock-height,70px) + 26px)}
        .pricecheck-heading{align-items:stretch;flex-direction:column;padding:11px 12px}.pricecheck-heading h2{font-size:27px}.pricecheck-refresh{width:100%}
        .pricecheck-status-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}.pricecheck-status{padding:8px}.pricecheck-status strong{font-size:12px}
        .pricecheck-table-wrap{border:0;background:transparent;overflow:visible}.pricecheck-table,.pricecheck-table tbody{display:block;min-width:0}.pricecheck-table thead{display:none}.pricecheck-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:7px;padding:10px;border:1px solid rgba(120,173,138,.13);border-radius:7px;background:rgba(3,5,7,.82)}
        .pricecheck-row td{display:block;padding:0;border:0!important;min-width:0}.pricecheck-row td:nth-child(1),.pricecheck-row td:nth-child(2){grid-column:1/-1}.pricecheck-row td:nth-child(3){grid-column:1/-1}.pricecheck-row td:nth-child(4){grid-column:1}.pricecheck-row td:nth-child(5){grid-column:2;align-self:end}.pricecheck-mobile-label{display:block;margin-bottom:4px;color:#858c91;font-size:8px;letter-spacing:.06em}.pricecheck-difference{text-align:left!important}.pricecheck-difference strong{width:100%;min-width:0}.pricecheck-price-editor{grid-template-columns:minmax(0,1fr) auto}.pricecheck-price-input{font-size:16px}.pricecheck-payout strong{font-size:13px}
      }
      @media(max-width:390px){html.rhw-pricecheck-enabled .app-tabs button span{font-size:12px!important}html.rhw-pricecheck-enabled .app-tabs [data-workspace="pricecheck"] span{font-size:10px!important}.pricecheck-row{grid-template-columns:minmax(0,1fr)}.pricecheck-row td:nth-child(4),.pricecheck-row td:nth-child(5){grid-column:1}.pricecheck-difference{align-self:auto}}
    `;
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
    return `<div class="pricecheck-frame">
      <header class="pricecheck-heading">
        <div><h2>PRICE CHECK</h2><p>FIXED NPC PROCUREMENT // SOURCE COST VS RHW PAYOUT</p></div>
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

  function baseSystem(baseEntry) {
    return String(baseEntry?.system_name || baseEntry?.system || '').trim();
  }

  function sourceScore(baseEntry, route) {
    const name = normalize(baseEntry?.name);
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
    for (const baseEntry of bases || []) {
      const score = sourceScore(baseEntry, route);
      if (score > bestScore) {
        best = baseEntry;
        bestScore = score;
      }
    }
    return bestScore >= 75 ? best : null;
  }

  function rhwPrice(route) {
    try {
      const finder = typeof findCommodity === 'function' ? findCommodity : window.findCommodity;
      const item = typeof finder === 'function' ? finder(route.commodity) : null;
      if (!item || item.missing) return null;
      const getter = typeof priceSell === 'function' ? priceSell : window.priceSell;
      if (typeof getter === 'function') return finite(getter(item));
      return finite(item.price_to_sell_to_base ?? item.sell_price ?? item.price_sell);
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
    const next = {};
    const sources = { ...(state.sourceCache?.sources || {}) };

    for (const route of ROUTES) {
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
        livePrice: livePrice !== null ? livePrice : (source ? null : finite(previous[route.key]?.livePrice)),
        found: Boolean(source),
        sold: good ? good.base_sells !== false : false
      };
    }

    state.sourceCache = { resolvedAt: Date.now(), sources };
    app.store.set(STORAGE.sources, state.sourceCache);
    state.marketCache = { fetchedAt: new Date().toISOString(), routes: next };
    app.store.set(STORAGE.market, state.marketCache);
  }

  function shouldResolveSources(forceResolve) {
    if (forceResolve) return true;
    const sources = state.sourceCache?.sources || {};
    const missing = ROUTES.some(route => !sources[route.key]?.nickname);
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
      const missingKnownBase = !full && ROUTES.some(route => {
        const nickname = state.sourceCache?.sources?.[route.key]?.nickname;
        return nickname && !bases.some(baseEntry => String(baseEntry?.nickname || '') === String(nickname));
      });
      if (missingKnownBase) {
        bases = await fetchMarketBases({ full: true });
        snapshotRoutes(bases, { resolve: true });
      }

      state.marketTone = 'positive';
      state.marketLabel = 'NPC MARKET LIVE';
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
    const market = state.marketCache?.routes?.[route.key] || {};
    const live = finite(market.livePrice);
    const hasOverride = Object.prototype.hasOwnProperty.call(state.overrides, route.key) && finite(state.overrides[route.key]) !== null;
    const sourcePrice = hasOverride ? finite(state.overrides[route.key]) : live;
    const payout = rhwPrice(route);
    const difference = sourcePrice !== null && payout !== null ? payout - sourcePrice : null;
    const tone = difference === null ? 'unknown' : (difference > 0 ? 'positive' : (difference < 0 ? 'negative' : 'neutral'));
    return { route, market, live, hasOverride, sourcePrice, payout, difference, tone };
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
    const { route, market, live, hasOverride, payout, difference, tone } = row;
    const overrideValue = hasOverride ? String(state.overrides[route.key]) : '';
    const sourceName = market.sourceName || route.source;
    const system = market.system || route.system;
    const sourceMeta = market.sourceNickname ? `${system} // ${market.sourceNickname}` : `${system} // SOURCE MATCH PENDING`;
    const liveCopy = live === null ? 'LIVE PRICE UNAVAILABLE' : `LIVE ${money(live)}`;
    const payoutCopy = payout === null ? 'RHW PRICE UNAVAILABLE' : money(payout);
    return `<tr class="pricecheck-row" data-route-key="${esc(route.key)}">
      <td><span class="pricecheck-mobile-label">COMMODITY</span><span class="pricecheck-commodity"><strong>${esc(route.commodity)}</strong><small>FIXED NPC ROUTE</small></span></td>
      <td><span class="pricecheck-mobile-label">SOURCE</span><span class="pricecheck-source"><strong>${esc(sourceName)}</strong><small>${esc(sourceMeta)}</small></span></td>
      <td><span class="pricecheck-mobile-label">SOURCE PRICE / OVERRIDE</span><div class="pricecheck-price-editor"><input class="pricecheck-price-input" data-pricecheck-override="${esc(route.key)}" type="number" inputmode="decimal" min="0" step="1" value="${esc(overrideValue)}" placeholder="${live === null ? '' : esc(String(Math.round(live)))}" aria-label="${esc(route.commodity)} manual source price">${hasOverride ? `<button type="button" class="pricecheck-reset" data-pricecheck-reset="${esc(route.key)}">RESET</button>` : ''}<small class="pricecheck-live ${hasOverride ? 'manual' : ''}">${hasOverride ? `MANUAL ACTIVE // ${liveCopy}` : liveCopy}</small></div></td>
      <td><span class="pricecheck-mobile-label">RHW PAYS</span><span class="pricecheck-payout"><strong>${payoutCopy}</strong><small>${rhwSnapshot().stale ? 'RHW CACHED' : 'CURRENT RHW BUY'}</small></span></td>
      <td class="pricecheck-difference ${tone}"><span class="pricecheck-mobile-label">DIFFERENCE</span><strong>${signedMoney(difference)}</strong></td>
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
    document.title = `RHW PRICE CHECK · ${app.version}`;
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
    if (ROUTES.length !== 15) failures.push('route-count');
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
    marketGoodFor
  };

  installStyles();
})();
