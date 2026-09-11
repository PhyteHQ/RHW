function scrambleText(el, finalStr) {
  if (!el) return;
  // Operational values stay readable throughout every telemetry refresh.
  if (el.dataset.scrambleInterval) {
    clearInterval(Number(el.dataset.scrambleInterval));
    delete el.dataset.scrambleInterval;
  }
  const text = String(finalStr);
  el.dataset.finalText = text;
  if (el.textContent !== text) el.textContent = text;
}

function debounce(func, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

function updateSystemClocks() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');
  const secs = String(now.getSeconds()).padStart(2, '0');
  const clockHtml = `[${hours}<span class="blink-colon">:</span>${mins}<span class="blink-colon">:</span>${secs}]`;

  if (els.headerClock) els.headerClock.innerHTML = clockHtml;
  if (els.rpFooterTime) els.rpFooterTime.innerHTML = `SYS-CLOCK: ${clockHtml}`;
}

updateSystemClocks();
setInterval(() => {
  updateSystemClocks();
  updateSyncCountdown();
}, 1000);

function normalize(value) { return String(value || '').trim().toLowerCase(); }

function finiteNumber(value, fallback = null, minimum = -Infinity) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function number(value) {
  const parsed = finiteNumber(value);
  return parsed === null ? '–' : numFormatter.format(parsed);
}

function formatCurrency(value) {
  const parsed = finiteNumber(value, null, 0);
  return parsed === null ? '–' : `$${numFormatter.format(parsed)}`;
}

function recoverSafeStorageEntry(key, raw, parseError) {
  const recoveries = window.__RHW_STORAGE_RECOVERIES__ = Array.isArray(window.__RHW_STORAGE_RECOVERIES__)
    ? window.__RHW_STORAGE_RECOVERIES__
    : [];
  const recovery = {
    key: String(key || ''),
    detail: String(parseError?.message || parseError || 'INVALID LOCAL JSON'),
    at: Date.now(),
    backupKey: '',
    recovered: false
  };
  try {
    const backupKey = `rhw-webapp-v4:recovery:${recovery.at}-${Math.random().toString(36).slice(2, 7)}`;
    window.localStorage.setItem(backupKey, JSON.stringify({
      schemaVersion: 1,
      originalKey: recovery.key,
      recoveredAt: new Date(recovery.at).toISOString(),
      raw: String(raw ?? '')
    }));
    window.localStorage.removeItem(key);
    recovery.backupKey = backupKey;
    recovery.recovered = true;
  } catch (storageError) {
    console.warn('LOCAL STORAGE RECOVERY FAILED', storageError);
  }
  recoveries.push(recovery);
  window.dispatchEvent(new CustomEvent('rhw:storage-recovered', { detail: recovery }));
  return recovery.recovered;
}

function safeStorageGet(key, fallback = null) {
  let raw;
  try {
    raw = window.localStorage.getItem(key);
  } catch (error) {
    console.warn('LOCAL STORAGE READ FAILED', error);
    return fallback;
  }
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    recoverSafeStorageEntry(key, raw, error);
    return fallback;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('LOCAL STORAGE WRITE FAILED', error);
  }
}


let ecoMode = false;
let ecoPreference = 'auto';
let ecoMeasureToken = 0;
let ecoResizeTimer = null;

function setEcoMode(on) {
  /* The operating-system accessibility preference is authoritative. A saved
     "FX: FULL" choice must never re-enable motion behind reduced-motion. */
  ecoMode = Boolean(on || prefersReducedMotion.matches);
  document.documentElement.classList.toggle('eco', ecoMode);
  if (ecoMode) startEcoTicker();
  else stopEcoTicker();
  updateEcoToggleLabel();
}

function updateEcoToggleLabel() {
  const button = els.ecoToggleBtn;
  if (!button) return;
  const span = button.querySelector('span');
  const systemReduced = prefersReducedMotion.matches;
  const label = systemReduced ? 'FX: REDUCED' : (ecoPreference === 'auto' ? 'FX: AUTO' : (ecoPreference === 'on' ? 'FX: LOW' : 'FX: FULL'));
  if (span) span.textContent = label;
  button.classList.toggle('eco-active', ecoMode);
  button.setAttribute('aria-pressed', ecoMode ? 'true' : 'false');
  button.setAttribute('aria-label', systemReduced
    ? 'Visual effects mode: reduced by system accessibility preference'
    : `Visual effects mode: ${ecoPreference === 'auto' ? 'automatic' : (ecoPreference === 'on' ? 'reduced' : 'full')}`);
}

function scheduleEcoAutoDetect(delay = 700) {
  if (!FEATURES.ecoMode || ecoPreference !== 'auto') return;
  const token = ++ecoMeasureToken;
  clearTimeout(ecoResizeTimer);
  ecoResizeTimer = setTimeout(() => {
    if (token !== ecoMeasureToken || ecoPreference !== 'auto') return;
    if (prefersReducedMotion.matches) { setEcoMode(true); return; }
    if (document.visibilityState === 'hidden') return;

    const start = performance.now();
    let frames = 0;
    const sampleMs = 1800;
    function tick(now) {
      if (token !== ecoMeasureToken || ecoPreference !== 'auto') return;
      frames += 1;
      const elapsed = now - start;
      if (elapsed < sampleMs) { requestAnimationFrame(tick); return; }
      const fps = frames / Math.max(0.001, elapsed / 1000);
      setEcoMode(fps < 42);
    }
    requestAnimationFrame(tick);
  }, delay);
}

function cycleEcoPreference() {
  ecoPreference = ecoPreference === 'auto' ? 'on' : (ecoPreference === 'on' ? 'off' : 'auto');
  safeStorageSet(STORAGE_KEYS.eco, ecoPreference);
  ecoMeasureToken += 1;
  if (prefersReducedMotion.matches || ecoPreference === 'on') setEcoMode(true);
  else if (ecoPreference === 'off') setEcoMode(false);
  else scheduleEcoAutoDetect(150);
  updateEcoToggleLabel();
}

function initEcoMode() {
  if (!FEATURES.ecoMode) {
    if (els.ecoToggleBtn) els.ecoToggleBtn.hidden = true;
    return;
  }
  const saved = safeStorageGet(STORAGE_KEYS.eco, 'auto');
  ecoPreference = ['auto', 'on', 'off'].includes(saved) ? saved : 'auto';
  els.ecoToggleBtn?.addEventListener('click', cycleEcoPreference);
  if (prefersReducedMotion.matches || ecoPreference === 'on') setEcoMode(true);
  else if (ecoPreference === 'off') setEcoMode(false);
  else scheduleEcoAutoDetect(1200);
  updateEcoToggleLabel();

  window.addEventListener('resize', () => {
    if (ecoPreference === 'auto') scheduleEcoAutoDetect(850);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopEcoTicker();
    else if (ecoMode) startEcoTicker();
    if (document.visibilityState === 'visible' && ecoPreference === 'auto') scheduleEcoAutoDetect(350);
  });
  prefersReducedMotion.addEventListener?.('change', () => {
    if (prefersReducedMotion.matches) setEcoMode(true);
    else if (ecoPreference === 'on') setEcoMode(true);
    else if (ecoPreference === 'off') setEcoMode(false);
    else scheduleEcoAutoDetect(150);
    updateEcoToggleLabel();
  });
}

function applyFeatureVisibility() {
  const showExternal = Boolean(FEATURES.materialsScan || FEATURES.marketScan);
  if (els.externalLogisticsPanel) els.externalLogisticsPanel.hidden = !showExternal;
  if (els.materialsScanSection) els.materialsScanSection.hidden = !FEATURES.materialsScan;
  if (els.marketScanSection) els.marketScanSection.hidden = !FEATURES.marketScan;
  if (els.newswirePanel) els.newswirePanel.hidden = !FEATURES.newswire;
  if (els.ecoToggleBtn) els.ecoToggleBtn.hidden = !FEATURES.ecoMode;

  if (els.externalTargetsMeta) {
    const targetParts = [];
    if (FEATURES.materialsScan) targetParts.push(`${MATERIALS_SCAN.length} MATERIALS`);
    if (FEATURES.marketScan) targetParts.push(`${MARKET_SCAN.length} SHIP COMPONENTS`);
    els.externalTargetsMeta.textContent = targetParts.join(' + ') || 'NO TARGETS';
  }
  if (els.externalSystemsMeta) {
    els.externalSystemsMeta.textContent = showExternal ? 'ALL KNOWN POBS' : 'NONE';
  }
  if (els.externalModeMeta) {
    const modes = [];
    if (FEATURES.materialsScan) modes.push('INDUSTRIAL MATERIALS');
    if (FEATURES.marketScan) modes.push('SHIP COMPONENTS');
    els.externalModeMeta.textContent = modes.join(' + ') || 'STANDBY';
  }

  if (els.shipyardControl) {
    els.shipyardControl.hidden = !FEATURES.capitalShipyard;
  }
}

function saveViewPreferences() {
  safeStorageSet(STORAGE_KEYS.view, {
    search: els.search?.value || '',
    role: els.roleFilter?.value || 'all',
    sortCol,
    sortAsc,
    marketSort,
    materialsSort
  });
}

function restoreViewPreferences() {
  const saved = safeStorageGet(STORAGE_KEYS.view, {});
  const validColumns = new Set(['name', 'role', 'status', 'quantity', 'sell', 'buy']);
  const validRoles = new Set(['all', 'maintenance', 'procurement', 'export', 'shipyard', 'byproduct', 'confiscated']);

  if (els.search && typeof saved?.search === 'string') els.search.value = saved.search.slice(0, 200);
  if (els.roleFilter && validRoles.has(saved?.role)) els.roleFilter.value = saved.role;
  if (validColumns.has(saved?.sortCol)) sortCol = saved.sortCol;
  if (typeof saved?.sortAsc === 'boolean') sortAsc = saved.sortAsc;
  if (['price', 'stock'].includes(saved?.marketSort)) marketSort = saved.marketSort;
  if (['price', 'stock'].includes(saved?.materialsSort)) materialsSort = saved.materialsSort;
}

function itemName(item) { return item?.name || item?.item_name || item?.nickname || String(item?.id || 'Unknown Asset'); }
const COMMODITY_ALIASES = { 'super alloys': 'super alloy', 'multi-mode focusing chambers': 'multi-mode focusing chamber' };

function cleanCommodityKey(rawName) {
  const raw = normalize(rawName);
  const idx = raw.indexOf('(');
  const cleaned = (idx >= 0 ? raw.slice(0, idx) : raw).trim();
  return COMMODITY_ALIASES[cleaned] || cleaned;
}

function commodityKey(item) { return cleanCommodityKey(itemName(item)); }
function keyFromName(name) { return cleanCommodityKey(name); }
function displayName(item) { const key = commodityKey(item); return CANONICAL_NAMES[key] || itemName(item); }
function quantity(item) { return finiteNumber(item?.quantity ?? item?.amount ?? item?.stock, 0, 0); }
function minStock(item) { return finiteNumber(item?.min_stock ?? item?.min, 0, 0); }

function firstFiniteApiStockValue(item, keys) {
  if (!item || item.missing) return null;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
    const raw = item[key];
    if (raw === null || raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function apiStockBoundary(item) {
  const min = firstFiniteApiStockValue(item, ['min_stock', 'min']);
  const max = firstFiniteApiStockValue(item, ['max_stock', 'max', 'maxStock', 'max_quantity', 'maxQuantity']);
  return {
    min,
    max,
    valid: min !== null && max !== null && max > 0 && min <= max
  };
}

function maxStock(item) {
  const value = item?.max_stock ?? item?.max ?? item?.maxStock ?? item?.max_quantity ?? item?.maxQuantity ?? 0;
  return finiteNumber(value, 0, 0);
}

function barMaxFor(item) {
  const nm = commodityKey(item);
  const role = assetRole(item);
  if (role === 'byproduct') return CUSTOM_ALERTS[nm]?.max || BAR_MAX_FALLBACKS[nm] || CUSTOM_ALERTS[nm]?.red || 15000;
  return maxStock(item) || BAR_MAX_FALLBACKS[nm] || 1;
}

function progressMeta(item, roleOverride = null) {
  const role = roleOverride || assetRole(item);
  const q = quantity(item);
  const max = barMaxFor(item);
  const percent = max > 0 ? Math.min(100, (q / max) * 100) : 0;
  const state = stateForRole(item, role);
  let cls = state;
  if (role === 'byproduct') cls = 'waste';
  if (role === 'confiscated' && state === 'ok') cls = 'confiscated-bar';
  return { percent: Math.max(0, Math.round(percent)), cls, max };
}

function renderProgress(item, options = {}) {
  const meta = progressMeta(item, options.role || null);
  const fillClass = options.stateOverride || meta.cls;
  const showApiReserve = options.showApiReserve !== false;
  const q = quantity(item);

  // The marker deliberately uses only live API values. Fallback capacities may size a
  // normal bar, but they must never invent an in-game trade boundary. A real API
  // min_stock of 0 is valid and is shown at the left edge of the scale.
  const boundary = showApiReserve ? apiStockBoundary(item) : { min: null, max: null, valid: false };

  if (!boundary.valid) {
    const tooltip = `${meta.percent}% OF MAX ${number(meta.max)}`;
    return `<div class="progress-wrap" data-tooltip="${tooltip}" aria-label="${tooltip}"><div class="progress-fill ${fillClass}" style="width:${meta.percent}%"></div></div>`;
  }

  const apiMin = boundary.min;
  const apiMax = boundary.max;
  const reservePercent = Math.max(0.5, Math.min(99.5, (apiMin / apiMax) * 100));
  const sellable = Math.max(0, q - apiMin);
  const tooltip = `STOCK ${number(q)} // BASE RESERVE ${number(apiMin)} // FOR SALE ${number(sellable)} // MAX ${number(apiMax)}`;
  const markerTooltip = apiMin > 0
    ? `API MIN STOCK ${number(apiMin)} // STOCK AT OR BELOW THIS MARK IS RESERVED`
    : `API MIN STOCK 0 // NO STOCK IS SEALED AS BASE RESERVE`;

  return `<div class="progress-wrap" data-tooltip="${tooltip}" aria-label="${tooltip}">` +
    `<div class="progress-reserve-marker" style="left:${reservePercent.toFixed(2)}%" data-tooltip="${markerTooltip}" aria-label="${markerTooltip}" role="img" tabindex="0"></div>` +
    `<div class="progress-fill ${fillClass}" style="width:${meta.percent}%"></div>` +
  `</div>`;
}

function renderFeedstockProgress(item, state, fallbackKey) {
  if (item) return renderProgress(item, { role: 'procurement', stateOverride: state, showApiReserve: true });
  const max = BAR_MAX_FALLBACKS[fallbackKey] || 1;
  return `<div class="progress-wrap" data-tooltip="0% OF MAX ${number(max)}" aria-label="0% OF MAX ${number(max)}"><div class="progress-fill ${state}" style="width:0%"></div></div>`;
}

function formatBaseHealth(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '–';
  if (n <= 100) return `${n.toFixed(n % 1 ? 1 : 0)}%`;
  const pct = Math.max(0, Math.min(100, (n / 24000000) * 100));
  return `${pct.toFixed(pct % 1 ? 1 : 0)}%`;
}

function formatPosition(value) {
  if (!value) return '–';
  if (typeof value === 'string') {
    const cleaned = value.split(',').map(s => s.trim()).filter(Boolean);
    return cleaned.length ? cleaned.join(' // ') : '–';
  }
  if (typeof value === 'object') {
    const arr = [value.x ?? value.X, value.y ?? value.Y, value.z ?? value.Z].filter(v => v !== undefined && v !== null && String(v).trim() !== '');
    return arr.length ? arr.join(' // ') : '–';
  }
  return String(value);
}
