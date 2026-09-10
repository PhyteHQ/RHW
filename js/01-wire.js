/* ==========================================================================
   RHW DASHBOARD LOGIC (V3.5)
   ========================================================================== */

const TICKER_DYNAMIC_SLOT_COUNT = 10;

const NEWSWIRE_POOLS = {
  market: [
    { tag: 'BMM MARKET WATCH', text: 'NIOBIUM CONTRACTS STRENGTHEN AS OMEGA SUPPLY TIGHTENS', tone: 'lore' },
    { tag: 'NEW LONDON EXCHANGE', text: 'INDUSTRIAL METALS OPEN FIRM ON CONTINUED MANUFACTURING DEMAND', tone: 'lore' },
    { tag: 'BMM COMMODITIES', text: 'GOLD PREMIUMS HOLD ABOVE THE WEEKLY AVERAGE AHEAD OF THE NEXT FREIGHT WINDOW', tone: 'lore' },
    { tag: 'BRETONIA TRADE', text: 'BULK FREIGHT BOOKINGS RISE ACROSS THE NEW LONDON INDUSTRIAL CORRIDOR', tone: 'lore' }
  ],
  regional: [
    { tag: 'NEW LONDON DESK', text: 'FREIGHT VOLUME RISES ALONG THE INDUSTRIAL CORRIDOR', tone: 'lore' },
    { tag: 'DUBLIN DESK', text: 'LISHEEN DEPOT PREPARES FOR INCREASED REFINED-METAL TRAFFIC', tone: 'remote' }
  ],
  security: [
    { tag: 'BPA SECURITY BRIEF', text: 'RANDOMIZED CARGO INSPECTIONS CONTINUE AT LOCAL JUMP GATES', tone: 'warn' },
    { tag: 'BAF PATROL REPORT', text: 'VANGUARD GROUP BEGINS A ROUTINE SYSTEM SWEEP', tone: 'lore' }
  ],
  operations: [
    { tag: 'RHW DOCKS', text: 'PIER FOUR OPENS FOR THE NEXT BULK FREIGHT WINDOW', tone: 'lore' },
    { tag: 'RHW ENGINEERING', text: 'REACTOR BAY TWO CLEARED FOR SCHEDULED COOLANT SERVICE', tone: 'good' }
  ],
  corporate: [
    { tag: 'BMM CORPORATE', text: 'INDUSTRIAL OUTPUT FORECAST REVISED UPWARD FOR THE CURRENT QUARTER', tone: 'lore' },
    { tag: 'CROWN LOYALTY', text: 'GLORY TO THE QUEEN', tone: 'lore' }
  ]
};

const newswireHistory = new Map();
let activeNewswirePools = NEWSWIRE_POOLS;

function pickNewswireMessage(category, excludedTexts = []) {
  const pool = activeNewswirePools[category] || [];
  if (!pool.length) return { tag: 'BMM NEWSWIRE', text: 'EDITORIAL DESK AWAITING BULLETINS', tone: 'muted' };

  const blocked = new Set(excludedTexts);
  const previous = newswireHistory.get(category);
  if (previous) blocked.add(previous);

  const candidates = pool.filter(message => !blocked.has(message.text));
  const source = candidates.length ? candidates : pool;
  const selected = source[Math.floor(Math.random() * source.length)];
  newswireHistory.set(category, selected.text);
  return { ...selected };
}

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
function escapeHTML(str) { return String(str).replace(/[&<>'"]/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[match])); }

const tickerContainer = document.getElementById('tickerContainer');
const tickerSingle = document.getElementById('tickerSingle');
let tickerMessageQueue = [{ tag: 'BMM NEWSWIRE', text: 'AWAITING INITIAL TELEMETRY BURST', tone: 'muted' }];
let ecoTickerIndex = 0;
let ecoTickerTimer = null;

function renderEcoTickerMessage(index = ecoTickerIndex) {
  if (!tickerSingle) return;
  const message = tickerMessageQueue.length
    ? tickerMessageQueue[index % tickerMessageQueue.length]
    : { tag: 'BMM NEWSWIRE', text: 'AWAITING INITIAL TELEMETRY BURST', tone: 'muted' };
  const tone = ['good', 'warn', 'danger', 'remote', 'lore', 'muted'].includes(message.tone) ? message.tone : 'lore';
  tickerSingle.innerHTML = `<span class="ticker-item ${tone}"><span class="ticker-tag">[${escapeHTML(message.tag)}]</span><span class="ticker-message">${escapeHTML(message.text)}</span></span>`;
}

function rotateEcoTicker() {
  if (!tickerSingle || tickerMessageQueue.length < 2 || document.visibilityState === 'hidden') return;
  tickerSingle.classList.add('swap');
  window.setTimeout(() => {
    ecoTickerIndex = (ecoTickerIndex + 1) % tickerMessageQueue.length;
    renderEcoTickerMessage();
    tickerSingle.classList.remove('swap');
  }, 220);
}

function stopEcoTicker() {
  if (ecoTickerTimer) window.clearInterval(ecoTickerTimer);
  ecoTickerTimer = null;
  tickerSingle?.classList.remove('swap');
}

function startEcoTicker() {
  stopEcoTicker();
  if (!tickerSingle) return;
  ecoTickerIndex %= Math.max(1, tickerMessageQueue.length);
  renderEcoTickerMessage();
  if (tickerMessageQueue.length > 1 && document.visibilityState !== 'hidden') {
    ecoTickerTimer = window.setInterval(rotateEcoTicker, 6000);
  }
}

function tickerItemMarkup(message, slotIndex = null) {
  const slotAttribute = slotIndex === null ? '' : ` data-ticker-slot="${slotIndex}"`;
  const tone = ['good', 'warn', 'danger', 'remote', 'lore', 'muted'].includes(message.tone) ? message.tone : 'lore';
  return `<span class="ticker-item ${tone}"${slotAttribute}><span class="ticker-tag">[${escapeHTML(message.tag)}]</span><span class="ticker-message">${escapeHTML(message.text)}</span></span><span class="ticker-separator" aria-hidden="true">///</span>`;
}

function buildTickerSequence(copyIndex) {
  const placeholders = Array.from({ length: TICKER_DYNAMIC_SLOT_COUNT }, (_, index) => tickerItemMarkup({
    tag: index === 0 ? 'BMM NEWSWIRE' : 'EDITORIAL DESK',
    text: index === 0 ? 'AWAITING INITIAL TELEMETRY BURST' : 'ASSEMBLING MARKET AND REGIONAL BULLETINS',
    tone: index === 0 ? 'warn' : 'muted'
  }, index)).join('');
  return `<div class="ticker-sequence" data-ticker-copy="${copyIndex}"${copyIndex ? ' aria-hidden="true"' : ''}>${placeholders}</div>`;
}

const TICKER_SPEED_PX_PER_SECOND = 58;
const TICKER_MIN_DURATION_SECONDS = 95;
const TICKER_MAX_DURATION_SECONDS = 150;

function updateTickerSpeed() {
  if (!tickerContainer || prefersReducedMotion.matches) return;
  requestAnimationFrame(() => {
    const primarySequence = tickerContainer.querySelector('.ticker-sequence[data-ticker-copy="0"]');
    if (!primarySequence) return;
    const distance = primarySequence.scrollWidth;
    const duration = Math.max(TICKER_MIN_DURATION_SECONDS, Math.min(TICKER_MAX_DURATION_SECONDS, distance / TICKER_SPEED_PX_PER_SECOND));
    tickerContainer.style.setProperty('--ticker-duration', `${duration.toFixed(1)}s`);
  });
}

function initializeNetworkFeed() {
  if (!tickerContainer) return;
  tickerContainer.innerHTML = buildTickerSequence(0) + buildTickerSequence(1);
  tickerContainer.style.setProperty('--ticker-duration', '110s');
  updateTickerSpeed();
}

function updateTickerSlot(index, message) {
  if (!tickerContainer || !message || index < 0 || index >= TICKER_DYNAMIC_SLOT_COUNT) return;
  const tone = ['good', 'warn', 'danger', 'remote', 'lore', 'muted'].includes(message.tone) ? message.tone : 'lore';
  tickerContainer.querySelectorAll(`[data-ticker-slot="${index}"]`).forEach(item => {
    item.className = `ticker-item ${tone}`;
    const tag = item.querySelector('.ticker-tag');
    const body = item.querySelector('.ticker-message');
    if (tag) tag.textContent = `[${message.tag}]`;
    if (body) body.textContent = message.text;
  });
}

function updateTickerSlots(messages) {
  const safeMessages = Array.isArray(messages) ? messages.slice(0, TICKER_DYNAMIC_SLOT_COUNT) : [];
  while (safeMessages.length < TICKER_DYNAMIC_SLOT_COUNT) {
    safeMessages.push({ tag: 'BMM NEWSWIRE', text: 'EDITORIAL QUEUE CLEAR // AWAITING NEXT BULLETIN', tone: 'muted' });
  }
  tickerMessageQueue = safeMessages.map(message => ({ ...message }));
  ecoTickerIndex %= Math.max(1, tickerMessageQueue.length);
  safeMessages.forEach((message, index) => updateTickerSlot(index, message));
  renderEcoTickerMessage();
  if (ecoMode) startEcoTicker();
  updateTickerSpeed();
}

initializeNetworkFeed();
window.addEventListener('resize', debounce(updateTickerSpeed, 180));

const holoTooltip = document.getElementById('holoTooltip');
let pinnedTooltipTarget = null;

function positionHoloTooltip(x, y) {
  if (!holoTooltip) return;
  const margin = 12;
  const rect = holoTooltip.getBoundingClientRect();
  const left = Math.max(margin, Math.min(window.innerWidth - rect.width - margin, x + 14));
  const top = Math.max(margin, Math.min(window.innerHeight - rect.height - margin, y + 14));
  holoTooltip.style.left = `${left}px`;
  holoTooltip.style.top = `${top}px`;
}

function showHoloTooltip(target, x = null, y = null, pinned = false) {
  if (!holoTooltip || !target?.dataset?.tooltip) return;
  holoTooltip.textContent = target.dataset.tooltip;
  holoTooltip.classList.add('visible');
  holoTooltip.classList.toggle('pinned', pinned);
  holoTooltip.setAttribute('aria-hidden', 'false');
  const rect = target.getBoundingClientRect();
  positionHoloTooltip(x ?? (rect.left + rect.width / 2), y ?? rect.bottom);
}

function hideHoloTooltip(force = false) {
  if (!holoTooltip || (pinnedTooltipTarget && !force)) return;
  holoTooltip.classList.remove('visible', 'pinned');
  holoTooltip.setAttribute('aria-hidden', 'true');
}

document.addEventListener('mousemove', event => {
  if (pinnedTooltipTarget) return;
  const target = event.target.closest('[data-tooltip]');
  if (target) showHoloTooltip(target, event.clientX, event.clientY);
  else hideHoloTooltip(true);
});

document.addEventListener('focusin', event => {
  const target = event.target.closest('[data-tooltip]');
  if (target) showHoloTooltip(target);
});

document.addEventListener('focusout', event => {
  if (!event.target.closest('[data-tooltip]')) return;
  if (!pinnedTooltipTarget) hideHoloTooltip(true);
});

document.addEventListener('click', event => {
  const target = event.target.closest('[data-tooltip]');
  const touchLike = window.matchMedia('(hover: none), (pointer: coarse)').matches;
  if (target && touchLike) {
    pinnedTooltipTarget = pinnedTooltipTarget === target ? null : target;
    if (pinnedTooltipTarget) showHoloTooltip(target, null, null, true);
    else hideHoloTooltip(true);
    return;
  }
  if (pinnedTooltipTarget && !target) {
    pinnedTooltipTarget = null;
    hideHoloTooltip(true);
  }
});

window.addEventListener('scroll', () => {
  if (pinnedTooltipTarget && document.contains(pinnedTooltipTarget)) {
    showHoloTooltip(pinnedTooltipTarget, null, null, true);
    return;
  }
  const focusedTarget = document.activeElement?.closest?.('[data-tooltip]');
  if (focusedTarget && document.contains(focusedTarget)) {
    showHoloTooltip(focusedTarget);
    return;
  }
  hideHoloTooltip(true);
}, { passive: true });

const API_URL = DASHBOARD_CONFIG.apiUrl;
const BASE_NAME = DASHBOARD_CONFIG.baseName;
const AUTO_REFRESH_MS = DASHBOARD_CONFIG.autoRefreshMs;
const NEWSWIRE_REFRESH_MS = DASHBOARD_CONFIG.newswireRefreshMs || 900000;
const FETCH_TIMEOUT_MS = DASHBOARD_CONFIG.fetchTimeoutMs;
const STORAGE_KEYS = DASHBOARD_CONFIG.storageKeys;
const FEATURES = DASHBOARD_CONFIG.features;
const MARKET_SCAN = DASHBOARD_CONFIG.marketScan || [];
const MATERIALS_SCAN = DASHBOARD_CONFIG.materialsScan || [];
const MATERIAL_FEEDSTOCKS = DASHBOARD_CONFIG.materialFeedstocks || {};
const MAINTENANCE = DASHBOARD_CONFIG.roles.maintenance;
const EXPORTS = DASHBOARD_CONFIG.roles.export;
const BYPRODUCTS = DASHBOARD_CONFIG.roles.byproduct;
const PROCUREMENT = DASHBOARD_CONFIG.roles.procurement;
const SHIPYARD = DASHBOARD_CONFIG.roles.shipyard;
const FEEDSTOCK = DASHBOARD_CONFIG.roles.feedstock;
const CONFISCATED = DASHBOARD_CONFIG.roles.confiscated;
const REMOTE_FACILITIES = DASHBOARD_CONFIG.remoteFacilities;
const CAPITAL_SHIPYARD = DASHBOARD_CONFIG.capitalShipyard;
const EXPORT_ORDER = DASHBOARD_CONFIG.exportOrder;
const RECIPES = DASHBOARD_CONFIG.recipes;
const CUSTOM_ALERTS = DASHBOARD_CONFIG.alerts;
const BAR_MAX_FALLBACKS = DASHBOARD_CONFIG.barMaxFallbacks;

const numFormatter = new Intl.NumberFormat('de-DE');

const CANONICAL_NAMES = {
  'ablative armor plating': 'Ablative Armor Plating', 'energy field equipment': 'Energy Field Equipment',
  'gold ore': 'Gold Ore', 'hull panels': 'Hull Panels', 'hydrocarbons': 'Hydrocarbons',
  'military salvage': 'Military Salvage', 'mox': 'MOX', 'niobium': 'Niobium',
  'super alloy': 'Super Alloy', 'titanium': 'Titanium', 'multi-mode focusing chamber': 'Multi-Mode Focusing Chamber',
  'multi-mode focusing chambers': 'Multi-Mode Focusing Chamber', 'superstructure systems': 'Superstructure Systems',
  'reactor systems': 'Reactor Systems', 'gold': 'Gold', 'prototype components': 'Prototype Components',
  'basic alloy': 'Basic Alloy', 'food rations': 'Food Rations', 'consumer goods': 'Consumer Goods',
  'industrial materials': 'Industrial Materials', 'niobium ore': 'Niobium Ore', 'toxic waste': 'Toxic Waste', 'scrap metal': 'Scrap Metal',
  'wildcat gold': 'Wildcat Gold', 'avionics systems': 'Avionics Systems', 'interior systems': 'Interior Systems',
  'propulsion systems': 'Propulsion Systems', 'exotic systems': 'Exotic Systems'
};

let items = [];
let lastLoaded = null;
let rhwBase = null;
let remoteBases = new Map(REMOTE_FACILITIES.map(facility => [facility.key, null]));
let allBases = [];
let marketSort = 'price';
let materialsSort = 'price';
let itemsByKey = new Map();
let operationalItemsCache = [];
let sortCol = 'name';
let sortAsc = true;
let refreshTimer = null;
let newswireRefreshTimer = null;
let newswireIsLoading = false;
let isLoading = false;
let nextSyncAt = null;
let dataIsStale = false;
let lastSyncError = '';

const els = {
  uplinkPanel: document.getElementById('uplinkPanel'),
  liveStatus: document.getElementById('liveStatus'),
  liveDot: document.getElementById('liveDot'),
  syncTimeVal: document.getElementById('syncTimeVal'),
  syncCountdown: document.getElementById('syncCountdown'),
  stripRegion: document.getElementById('stripRegion'),
  stripSystem: document.getElementById('stripSystem'),
  stripCoords: document.getElementById('stripCoords'),
  stripPosition: document.getElementById('stripPosition'),
  telemetryStateVal: document.getElementById('telemetryStateVal'),
  baseHealthVal: document.getElementById('baseHealthVal'),
  baseHealthCard: document.getElementById('baseHealthCard'),
  baseMoneyVal: document.getElementById('baseMoneyVal'),
  baseStorageVal: document.getElementById('baseStorageVal'),
  
  maintenanceList: document.getElementById('maintenanceList'),
  byproductList: document.getElementById('byproductList'),
  exportList: document.getElementById('exportList'),
  feedstockList: document.getElementById('feedstockList'),
  confiscatedList: document.getElementById('confiscatedList'),
  
  maintenanceCount: document.getElementById('maintenanceCount'),
  byproductCount: document.getElementById('byproductCount'),
  exportCount: document.getElementById('exportCount'),
  feedstockCount: document.getElementById('feedstockCount'),
  confiscatedCount: document.getElementById('confiscatedCount'),
  
  itemsBody: document.getElementById('itemsBody'),
  errorBox: document.getElementById('errorBox'),
  search: document.getElementById('search'),
  roleFilter: document.getElementById('roleFilter'),
  roleSegmentButtons: document.querySelectorAll('.role-segment'),
  refreshBtn: document.getElementById('refreshBtn'),
  headerRefreshBtn: document.getElementById('headerRefreshBtn'),
  productionGrid: document.getElementById('productionGrid'),
  tableHeaders: document.querySelectorAll('#dataTable th[data-sort]'),
  headerClock: document.getElementById('headerClock'),
  rpFooterTime: document.getElementById('rpFooterTime'),
  footerConnection: document.getElementById('footerConnection'),
  supplierLinkBadge: document.getElementById('supplierLinkBadge'),
  supplierLinkText: document.getElementById('supplierLinkText'),
  shipyardControl: document.getElementById('shipyardControl'),
  externalLogisticsPanel: document.getElementById('externalLogisticsPanel'),
  materialsScanSection: document.getElementById('materialsScanSection'),
  materialsScanMeta: document.getElementById('materialsScanMeta'),
  materialsScanGrid: document.getElementById('materialsScanGrid'),
  marketScanSection: document.getElementById('marketScanSection'),
  marketScanGrid: document.getElementById('marketScanGrid'),
  marketScanMeta: document.getElementById('marketScanMeta'),
  marketSortButtons: document.querySelectorAll('.market-sort-button'),
  externalTargetsMeta: document.getElementById('externalTargetsMeta'),
  externalSystemsMeta: document.getElementById('externalSystemsMeta'),
  externalModeMeta: document.getElementById('externalModeMeta'),
  productionPanel: document.getElementById('productionPanel'),
  newswirePanel: document.getElementById('newswirePanel'),
  ecoToggleBtn: document.getElementById('ecoToggleBtn')
};
