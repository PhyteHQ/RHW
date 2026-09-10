const NEWSWIRE_URL = DASHBOARD_CONFIG.newswireUrl;
const NEWSWIRE_TONES = ['good', 'warn', 'danger', 'remote', 'lore', 'muted'];

const RHW_NEWSWIRE_FILTER_CATEGORIES = Object.freeze(['market', 'regional', 'security', 'operations', 'corporate']);
const RHW_NEWSWIRE_FILTER_STORAGE_KEY = 'rhw-dashboard-v3.5:newswire-filter';
const rhwNewswireCursors = new Map();
let rhwNewswireFilter = 'all';

// Replace random editorial selection with deterministic round-robin rotation.
pickNewswireMessage = function(category, excludedTexts = []) {
  const pool = activeNewswirePools[category] || [];
  if (!pool.length) return { tag: 'BMM NEWSWIRE', text: 'EDITORIAL DESK AWAITING BULLETINS', tone: 'muted' };

  const blocked = new Set(excludedTexts);
  const startIndex = (rhwNewswireCursors.get(category) || 0) % pool.length;
  for (let step = 0; step < pool.length; step++) {
    const index = (startIndex + step) % pool.length;
    if (blocked.has(pool[index].text)) continue;
    rhwNewswireCursors.set(category, index + 1);
    return { ...pool[index] };
  }

  rhwNewswireCursors.set(category, startIndex + 1);
  return { ...pool[startIndex] };
};

// Keep live priority, finance, remote-market and production messages visible.
// The chosen filter controls only the editorial category portion of the feed.
buildIndustrialNewswireMessages = function() {
  if (!rhwBase) {
    return Array.from({ length: TICKER_DYNAMIC_SLOT_COUNT }, (_, index) => ({
      tag: index === 0 ? 'BMM NEWSWIRE' : 'EDITORIAL DESK',
      text: index === 0 ? 'AWAITING INITIAL TELEMETRY BURST' : 'ASSEMBLING MARKET AND REGIONAL BULLETINS',
      tone: index === 0 ? 'warn' : 'muted'
    }));
  }

  const recipeAnalyses = RECIPES.map(analyzeRecipe);
  const messages = [...buildPriorityWire(recipeAnalyses)];
  const usedTexts = new Set(messages.map(message => message.text));

  [
    buildFinanceDeskMessage(),
    ...REMOTE_FACILITIES.map(facility => buildRemoteMarketMessage(facility.key)),
    buildProductionDeskMessage(recipeAnalyses)
  ].forEach(message => {
    messages.push(message);
    usedTexts.add(message.text);
  });

  const selected = rhwNewswireFilter === 'all'
    ? RHW_NEWSWIRE_FILTER_CATEGORIES
    : [rhwNewswireFilter].filter(category => RHW_NEWSWIRE_FILTER_CATEGORIES.includes(category));
  const available = selected.filter(category => (activeNewswirePools[category] || []).length);

  available.forEach(category => {
    const message = pickNewswireMessage(category, [...usedTexts]);
    messages.push(message);
    usedTexts.add(message.text);
  });

  let categoryIndex = 0;
  while (available.length && messages.length < TICKER_DYNAMIC_SLOT_COUNT) {
    const category = available[categoryIndex % available.length];
    const message = pickNewswireMessage(category, [...usedTexts]);
    messages.push(message);
    usedTexts.add(message.text);
    categoryIndex += 1;
  }

  while (messages.length < TICKER_DYNAMIC_SLOT_COUNT) {
    messages.push({ tag: 'BMM NEWSWIRE', text: 'EDITORIAL QUEUE CLEAR // AWAITING NEXT BULLETIN', tone: 'muted' });
  }
  return messages.slice(0, TICKER_DYNAMIC_SLOT_COUNT);
};

function parseNewswireMarkdown(text) {
  const pools = {};
  let category = null;
  let fenceMarker = '';
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fenceMatch) {
      if (!fenceMarker) fenceMarker = fenceMatch[1].slice(0, 3);
      else if (line.startsWith(fenceMarker)) fenceMarker = '';
      continue;
    }
    if (fenceMarker) continue;
    const headerMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headerMatch) {
      category = normalize(headerMatch[1]).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (category && !pools[category]) pools[category] = [];
      continue;
    }
    if (!category || !line.startsWith('-')) continue;
    const msgMatch = line.match(/^-\s*\[([^|\]]+?)\s*\|\s*([A-Za-z]+)\s*\]\s*(.+)$/);
    if (!msgMatch) continue;
    const tag = msgMatch[1].trim().toUpperCase().slice(0, 40);
    const toneCandidate = msgMatch[2].trim().toLowerCase();
    const tone = NEWSWIRE_TONES.includes(toneCandidate) ? toneCandidate : 'lore';
    const body = msgMatch[3].trim().toUpperCase().slice(0, 240);
    if (tag && body) pools[category].push({ tag, text: body, tone });
  }
  return pools;
}

function mergeNewswirePools(remotePools = {}) {
  const merged = {};
  const categories = new Set([...Object.keys(NEWSWIRE_POOLS), ...Object.keys(remotePools || {})]);
  categories.forEach(category => {
    const seen = new Set();
    const combined = [...(remotePools?.[category] || []), ...(NEWSWIRE_POOLS[category] || [])];
    merged[category] = combined.filter(message => {
      const identity = `${message.tag}\u0000${message.text}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  });
  return merged;
}

function countNewswireBulletins(pools) {
  return Object.values(pools || {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
}

function setNewswireFeedStatus(mode, bulletinCount = 0, cachedAt = 0) {
  const el = document.getElementById('newswireFeedStatus');
  if (!el) return;
  el.classList.remove('feed-live', 'feed-stale', 'feed-local');
  el.classList.add(mode === 'live' ? 'feed-live' : (mode === 'stale' ? 'feed-stale' : 'feed-local'));
  const label = el.querySelector('.feed-status-text');
  if (label) label.textContent = mode === 'live' ? 'REMOTE FEED LIVE' : (mode === 'stale' ? 'REMOTE FEED STALE' : 'LOCAL FALLBACK');
  const cacheTime = cachedAt ? new Date(cachedAt).toLocaleString('de-DE') : '';
  el.title = mode === 'live'
    ? `${bulletinCount} external bulletins loaded from the RHW repository`
    : (mode === 'stale'
      ? `Remote file unavailable // using ${bulletinCount} cached bulletins from ${cacheTime || 'the last verified sync'}`
      : 'Remote file unavailable or disabled // using bulletins embedded in the dashboard');
}

function applyNewswirePools(pools) {
  activeNewswirePools = mergeNewswirePools(pools);
  rhwNewswireCursors.clear();
  if (lastLoaded) updateTickerSlots(buildIndustrialNewswireMessages());
}

function scheduleNewswireRefresh() {
  clearTimeout(newswireRefreshTimer);
  if (!FEATURES.newswire || !FEATURES.remoteNewswire || !NEWSWIRE_URL || NEWSWIRE_REFRESH_MS <= 0) return;
  newswireRefreshTimer = setTimeout(() => loadNewswire(), NEWSWIRE_REFRESH_MS);
}

async function loadNewswire({ schedule = true } = {}) {
  if (newswireIsLoading) return;
  newswireIsLoading = true;

  if (!FEATURES.newswire || !FEATURES.remoteNewswire || !NEWSWIRE_URL) {
    activeNewswirePools = NEWSWIRE_POOLS;
    setNewswireFeedStatus('local');
    newswireIsLoading = false;
    if (schedule) scheduleNewswireRefresh();
    return;
  }

  try {
    const response = await fetchWithTimeout(NEWSWIRE_URL, {
      headers: { 'Accept': 'text/markdown,text/plain;q=0.9,*/*;q=0.1' },
      cache: 'no-store'
    }, 10000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const sourceText = await response.text();
    const remotePools = parseNewswireMarkdown(sourceText);
    const count = countNewswireBulletins(remotePools);
    if (!count) throw new Error('NO BULLETINS PARSED');

    applyNewswirePools(remotePools);
    const cached = response.headers.get('X-RHW-Source') === 'cache' || (navigator.serviceWorker?.controller && response.headers.get('X-RHW-Source') !== 'network');
    const fetchedAt = Date.parse(response.headers.get('X-RHW-Fetched-At')) || (cached ? 0 : Date.now());
    safeStorageSet(STORAGE_KEYS.newswireCache, { sourceText, savedAt: fetchedAt });
    setNewswireFeedStatus(cached ? 'stale' : 'live', count, fetchedAt);
  } catch (error) {
    const cached = safeStorageGet(STORAGE_KEYS.newswireCache, null);
    const cachedPools = cached?.sourceText ? parseNewswireMarkdown(cached.sourceText) : {};
    const cachedCount = countNewswireBulletins(cachedPools);
    if (cachedCount) {
      applyNewswirePools(cachedPools);
      setNewswireFeedStatus('stale', cachedCount, Number(cached.savedAt) || 0);
    } else {
      activeNewswirePools = NEWSWIRE_POOLS;
      rhwNewswireCursors.clear();
      setNewswireFeedStatus('local');
    }
    console.warn('RHW NEWSWIRE FETCH FAILED', error);
  } finally {
    newswireIsLoading = false;
    if (schedule) scheduleNewswireRefresh();
  }
}

function installRhwEnhancementStyles() {
  if (document.getElementById('rhwV35EnhancementStyles')) return;
  const style = document.createElement('style');
  style.id = 'rhwV35EnhancementStyles';
  style.dataset.stylesheet = '35-app-interface-cleanup.css';
  document.head.appendChild(style);
}

function createNewswireFilter() {
  if (!FEATURES.newswire) return;
  const ticker = document.getElementById('newswirePanel');
  if (!ticker || document.getElementById('newswireFilter')) return;
  const filter = document.createElement('div');
  filter.id = 'newswireFilter';
  filter.className = 'newswire-filter';
  filter.setAttribute('role', 'group');
  filter.setAttribute('aria-label', 'Filter RHW newswire editorial categories');
  const labels = {
    all: 'ALL', market: 'MARKET', regional: 'BRETONIA', security: 'SECURITY',
    operations: 'OPERATIONS', corporate: 'CORPORATE'
  };
  ['all', ...RHW_NEWSWIRE_FILTER_CATEGORIES].forEach(category => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.newswireCategory = category;
    button.textContent = labels[category];
    button.addEventListener('click', () => {
      if (category === rhwNewswireFilter) return;
      rhwNewswireFilter = category;
      safeStorageSet(RHW_NEWSWIRE_FILTER_STORAGE_KEY, rhwNewswireFilter);
      rhwNewswireCursors.clear();
      updateNewswireFilterButtons();
      updateTickerSlots(buildIndustrialNewswireMessages());
    });
    filter.appendChild(button);
  });
  ticker.parentNode.insertBefore(filter, ticker);
}

function updateNewswireFilterButtons() {
  document.querySelectorAll('[data-newswire-category]').forEach(button => {
    const active = button.dataset.newswireCategory === rhwNewswireFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function initNewswireFilter() {
  const saved = safeStorageGet(RHW_NEWSWIRE_FILTER_STORAGE_KEY, 'all');
  rhwNewswireFilter = saved === 'all' || RHW_NEWSWIRE_FILTER_CATEGORIES.includes(saved) ? saved : 'all';
  installRhwEnhancementStyles();
  createNewswireFilter();
  updateNewswireFilterButtons();
}

function hullApiCode(hull) {
  return hull?.apiCode || (hull?.matches || []).find(value => normalize(value).startsWith('dsy_')) || '';
}

function detectHullApiItem(hull) {
  const code = hullApiCode(hull);
  const normalizedCode = normalizedAssetMatch(code);
  if (normalizedCode) {
    const exact = items.find(item => itemIdentityCandidates(item).includes(normalizedCode));
    if (exact) return { item: exact, mode: 'EXACT API CODE', code };
  }
  const fallback = findCommodityByAliases(hull?.matches || []);
  return fallback ? { item: fallback, mode: 'ALIAS MATCH', code } : { item: null, mode: 'NOT DETECTED', code };
}

const baseRenderShipyardControl = renderShipyardControl;
renderShipyardControl = function() {
  baseRenderShipyardControl();
  if (!hasVerifiedTelemetry() || !els.shipyardControl || !CAPITAL_SHIPYARD?.hulls?.length) return;

  const rows = [...els.shipyardControl.querySelectorAll('.hull-registry-row')];
  let detectedCount = 0;
  CAPITAL_SHIPYARD.hulls.forEach((hull, index) => {
    const row = rows[index];
    if (!row) return;
    const detection = detectHullApiItem(hull);
    const detected = Boolean(detection.item);
    if (detected) detectedCount += 1;

    const name = row.querySelector('.hull-registry-name');
    if (name) {
      const status = document.createElement('small');
      status.className = `hull-detection ${detected ? 'detected' : 'missing'}`;
      status.textContent = detected
        ? `${detection.mode} · ${detection.code || itemName(detection.item)}`
        : `NOT DETECTED · EXPECTED ${detection.code || hull.matches?.[0] || 'API ITEM'}`;
      name.appendChild(status);
    }

    if (!detected) {
      row.classList.add('hull-not-detected');
      const label = row.querySelector('.hull-registry-metric.stock small');
      const value = row.querySelector('.hull-registry-metric.stock strong');
      if (label) label.textContent = 'API Status';
      if (value) {
        if (value.dataset.scrambleInterval) window.clearInterval(Number(value.dataset.scrambleInterval));
        value.dataset.finalText = 'NOT DETECTED';
        value.textContent = 'NOT DETECTED';
      }
      row.querySelector('.hull-registry-progress .progress-wrap')?.setAttribute('aria-label', 'HULL API ITEM NOT DETECTED');
    }
  });

  const states = els.shipyardControl.querySelector('.shipyard-control-states');
  if (states) {
    const badge = document.createElement('div');
    const allDetected = detectedCount === CAPITAL_SHIPYARD.hulls.length;
    badge.className = `shipyard-summary-badge state-${allDetected ? 'ok' : 'critical'}`;
    badge.textContent = `API ${detectedCount}/${CAPITAL_SHIPYARD.hulls.length} DETECTED`;
    states.appendChild(badge);
  }
};

restoreViewPreferences();
applyFeatureVisibility();
initNewswireFilter();
initEcoMode();
updateRoleSegments();
updateSortArrows();
updateMarketSortButtons();

refreshAll();
