/* Dashboard state, tooltip interactions and shared configuration. */
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
function escapeHTML(str) { return String(str).replace(/[&<>'"]/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[match])); }

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
  ecoToggleBtn: document.getElementById('ecoToggleBtn')
};
