async function loadData() {
  if (isLoading) return;
  isLoading = true;

  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  document.body.classList.add('syncing');
  if (!hasVerifiedTelemetry()) {
    lastSyncError = '';
    renderAll();
  }
  setTelemetryState('POLLING', 'warn');
  setFooterConnection('SYNCING', 'warn');
  if (FEATURES.materialsScan || FEATURES.marketScan) setSupplierLinkState('polling', 'SAT-LINK SCANNING');
  updateNetworkFeed('loading');

  if (els.liveStatus) {
    els.liveStatus.style.color = 'var(--warn)';
    scrambleText(els.liveStatus, 'SYNCING TELEMETRY...', 400);
  }
  if (els.uplinkPanel) {
    els.uplinkPanel.classList.remove('offline', 'online');
  }

  updateSyncCountdown();

  if (els.errorBox) {
    els.errorBox.style.display = 'none';
    els.errorBox.textContent = '';
  }
  if (els.refreshBtn) els.refreshBtn.disabled = true;
  if (els.headerRefreshBtn) els.headerRefreshBtn.disabled = true;

  try {
    const response = await fetchWithTimeout(API_URL, { method: 'POST', headers: { 'Accept': 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('INVALID TELEMETRY RESPONSE.');

    const nextRhwBase = data.find(base => normalize(base?.name) === BASE_NAME || normalize(base?.nickname) === BASE_NAME);
    const nextRemoteBases = new Map(
      REMOTE_FACILITIES.map(facility => [facility.key, findRemoteFacility(data, facility)])
    );

    if (!nextRhwBase || typeof nextRhwBase !== 'object') throw new Error('RHW NOT FOUND IN DATASTREAM.');
    if (!Array.isArray(nextRhwBase.shop_items)) throw new Error('INVALID RHW SHOP DATA.');

    rhwBase = nextRhwBase;
    allBases = data;
    remoteBases = nextRemoteBases;
    items = rhwBase.shop_items.map(item => ({ ...item }));
    rebuildItemCaches();
    lastLoaded = new Date();
    dataIsStale = false;
    lastSyncError = '';

    setTelemetryState('LIVE', 'good');
    setFooterConnection('SECURE', 'good');

    if (els.liveStatus) {
      els.liveStatus.style.color = 'var(--good)';
      scrambleText(els.liveStatus, 'CONNECTION SECURE', 600);
    }
    if (els.uplinkPanel) {
      els.uplinkPanel.classList.remove('offline');
      els.uplinkPanel.classList.add('online');
    }

    renderAll();
    updateNetworkFeed('live');
  } catch (error) {
    console.error(error);
    dataIsStale = Boolean(lastLoaded);
    lastSyncError = String(error?.message || 'UNKNOWN TELEMETRY ERROR');
    setTelemetryState(dataIsStale ? 'STALE' : 'ERROR', dataIsStale ? 'warn' : 'danger');
    setFooterConnection(dataIsStale ? 'CACHE' : 'FAILED', dataIsStale ? 'warn' : 'danger');
    renderAll();
    if (!dataIsStale && (FEATURES.materialsScan || FEATURES.marketScan)) {
      setSupplierLinkState('offline', 'UPLINK FAILED // NO VERIFIED CACHE');
    }
    updateNetworkFeed('error', lastSyncError);

    if (els.liveStatus) {
      els.liveStatus.style.color = dataIsStale ? 'var(--warn)' : 'var(--danger)';
      scrambleText(els.liveStatus, dataIsStale ? 'STALE DATA // CACHE ACTIVE' : 'UPLINK FAILED', 400);
    }
    if (els.uplinkPanel) {
      els.uplinkPanel.classList.remove('online');
      els.uplinkPanel.classList.add('offline');
    }

    if (els.errorBox) {
      const staleText = lastLoaded ? ` // LAST VALID SYNC ${lastLoaded.toLocaleTimeString('de-DE')}` : '';
      els.errorBox.textContent = `TELEMETRY ERROR: ${lastSyncError}${staleText}`;
      els.errorBox.style.display = 'block';
    }
  } finally {
    isLoading = false;
    document.body.classList.remove('syncing');
    if (els.refreshBtn) els.refreshBtn.disabled = !navigator.onLine;
    if (els.headerRefreshBtn) els.headerRefreshBtn.disabled = !navigator.onLine;

    if (lastLoaded && els.syncTimeVal) {
      const timeString = lastLoaded.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      scrambleText(els.syncTimeVal, timeString);
    }

    nextSyncAt = Date.now() + AUTO_REFRESH_MS;
    updateSyncCountdown();
    refreshTimer = setTimeout(loadData, AUTO_REFRESH_MS);
  }
}

els.search?.addEventListener('input', debounce(() => { saveViewPreferences(); renderManifest(); }, 250));
els.roleFilter?.addEventListener('change', () => { saveViewPreferences(); updateRoleSegments(); renderManifest(); });
els.roleSegmentButtons.forEach(button => button.addEventListener('click', () => {
  if (!els.roleFilter) return;
  els.roleFilter.value = button.dataset.role || 'all';
  saveViewPreferences();
  updateRoleSegments();
  renderManifest();
}));
async function refreshAll() {
  clearTimeout(newswireRefreshTimer);
  await Promise.allSettled([loadNewswire({ schedule: false }), loadData()]);
  scheduleNewswireRefresh();
}

els.refreshBtn?.addEventListener('click', refreshAll);
els.headerRefreshBtn?.addEventListener('click', refreshAll);
els.marketSortButtons?.forEach(button => button.addEventListener('click', () => {
  if (!setMarketSort(button.dataset.marketGroup, button.dataset.marketSort)) return;
  saveViewPreferences();
}));
els.tableHeaders.forEach(th => {
  th.addEventListener('click', handleSort);
  th.addEventListener('keydown', handleSortKeydown);
});

// ============================================================
// RHW NEWSWIRE · EDITABLE MARKDOWN + LAST-GOOD CACHE
// The remote file extends the built-in pools category by category.
// If it is unavailable, the most recently verified file is used.
// ============================================================
