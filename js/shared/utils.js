function configuredBaseHealthMax() {
  return finiteNumber(DASHBOARD_CONFIG.baseHealthMax, 24000000, 1);
}

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

// Update clocks only while their surfaces can be seen. Keep text nodes stable.
let systemClockTimer = null;
let footerClockVisible = false;
function updateSystemClocks() {
  const clock = `[${new Date().toLocaleTimeString('en-GB', { hour12: false })}]`;
  if (document.getElementById('uplinkDetails')?.open && els.headerClock) els.headerClock.textContent = clock;
  if (footerClockVisible && els.rpFooterTime) els.rpFooterTime.textContent = `SYS-CLOCK: ${clock}`;
}
function scheduleSystemClocks() {
  clearTimeout(systemClockTimer);
  systemClockTimer = null;
  const detailsOpen = document.getElementById('uplinkDetails')?.open;
  if (document.hidden || (!detailsOpen && !footerClockVisible)) return;
  updateSystemClocks();
  if (detailsOpen) updateSyncCountdown();
  systemClockTimer = setTimeout(scheduleSystemClocks, 1000);
}
document.getElementById('uplinkDetails')?.addEventListener('toggle', scheduleSystemClocks);
document.addEventListener('visibilitychange', scheduleSystemClocks);
if (typeof IntersectionObserver === 'function' && els.rpFooterTime) {
  const clockVisibility = new IntersectionObserver(entries => {
    footerClockVisible = entries.some(entry => entry.isIntersecting);
    scheduleSystemClocks();
  });
  clockVisibility.observe(els.rpFooterTime);
}

function normalize(value) { return String(value || '').trim().toLowerCase(); }

function finiteNumber(value, fallback = null, minimum = -Infinity) {
  if (typeof value !== 'number' && typeof value !== 'string') return fallback;
  if (typeof value === 'string' && !value.trim()) return fallback;
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
  const validRoles = new Set(['all', 'maintenance', 'procurement', 'export', 'shipyard', 'byproduct', 'reserve']);

  if (els.search && typeof saved?.search === 'string') els.search.value = saved.search.slice(0, 200);
  const restoredRole = saved?.role === 'confiscated' ? 'reserve' : saved?.role;
  if (els.roleFilter && validRoles.has(restoredRole)) els.roleFilter.value = restoredRole;
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
    const value = finiteNumber(raw, null, 0);
    if (value !== null) return value;
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

function renderStockCapacity(item, state) {
  const stock = firstFiniteApiStockValue(item, ['quantity', 'amount', 'stock']);
  const { min, max, valid } = apiStockBoundary(item);
  if (stock === null || !(max > 0)) return '';

  const displayedStock = Math.min(stock, max);
  const reading = `${number(stock)} of ${number(max)}${valid ? ` · Minimum ${number(min)}` : ''}`;
  return `<div class="stock-capacity" data-stock-state="${state}" title="${reading}">
    <div class="stock-capacity-track" role="meter" aria-label="Stock capacity" aria-valuemin="0"
         aria-valuemax="${max}" aria-valuenow="${displayedStock}" aria-valuetext="${reading}">
      <span class="stock-capacity-fill" style="width:${displayedStock / max * 100}%"></span>
      ${valid ? `<span class="stock-capacity-min" style="left:${min / max * 100}%"></span>` : ''}
    </div>
    <div class="stock-capacity-limits" aria-hidden="true">
      ${valid ? `<span class="stock-capacity-min-label">Min ${number(min)}</span>` : ''}
      <span class="stock-capacity-max-label">Max ${number(max)}</span>
    </div>
  </div>`;
}

function formatBaseHealth(value) {
  const n = finiteNumber(value, null, 0);
  if (n === null) return '–';
  if (n <= 100) return `${n.toFixed(n % 1 ? 1 : 0)}%`;
  const pct = Math.max(0, Math.min(100, (n / configuredBaseHealthMax()) * 100));
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
