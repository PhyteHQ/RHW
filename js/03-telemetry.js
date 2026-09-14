function updateBaseTelemetry() {
  const snapshot = telemetrySnapshot();
  const anchor = els.baseMoneyVal?.closest('.base-telemetry-bar') || document.querySelector('.base-telemetry-bar');
  const connectionDetails = document.querySelector('#uplinkDetails .uplink-grid');
  let status = document.getElementById('commandTelemetryStatus');
  if (!status && anchor) {
    status = document.createElement('div');
    status.id = 'commandTelemetryStatus';
    status.setAttribute('role', 'status');
    if (connectionDetails) connectionDetails.appendChild(status);
    else anchor.insertAdjacentElement('afterend', status);
  }
  if (status) { status.textContent = snapshot.detail; status.dataset.tone = snapshot.tone; }
  if (!rhwBase) {
    [els.baseMoneyVal, els.baseStorageVal, els.baseHealthVal].forEach(node => {
      if (node) node.textContent = typeof lastSyncError !== 'undefined' && lastSyncError ? 'UNAVAILABLE' : 'CONNECTING';
    });
    return;
  }
  const money = rhwBase.money ?? rhwBase.credits ?? rhwBase.base_money;
  const cargo = rhwBase.cargospace ?? rhwBase.cargo_space ?? rhwBase.cargo_space_left ?? rhwBase.storage_free;
  const health = rhwBase.health ?? rhwBase.base_health;
  const healthDisplay = formatBaseHealth(health);

  if (els.baseMoneyVal) scrambleText(els.baseMoneyVal, formatCurrency(money));
  if (els.baseStorageVal) scrambleText(els.baseStorageVal, Number.isFinite(Number(cargo)) ? numFormatter.format(cargo) : '–');
  if (els.baseHealthVal) scrambleText(els.baseHealthVal, healthDisplay);

  if (els.baseHealthCard) {
    const healthNumber = parseFloat(String(healthDisplay).replace(',', '.'));
    els.baseHealthCard.classList.remove('health-good', 'health-warn', 'health-critical');
    if (Number.isFinite(healthNumber)) {
      if (healthNumber < 25) els.baseHealthCard.classList.add('health-critical');
      else if (healthNumber < 75) els.baseHealthCard.classList.add('health-warn');
      else els.baseHealthCard.classList.add('health-good');
    }
  }

  const system = rhwBase.system_name || 'New London';
  const region = rhwBase.region_name || 'BRETONIA';
  const sector = rhwBase.sector_coord || 'C-6';
  const pos = formatPosition(rhwBase.pos ?? rhwBase.base_pos);

  if (els.stripRegion) els.stripRegion.innerHTML = `REGION <strong>${escapeHTML(region)}</strong>`;
  if (els.stripSystem) els.stripSystem.innerHTML = `SYSTEM <strong>${escapeHTML(system)}</strong>`;
  if (els.stripCoords) els.stripCoords.innerHTML = `SECTOR <strong>${escapeHTML(sector)}</strong>`;
  if (els.stripPosition) els.stripPosition.innerHTML = `POS <strong>${escapeHTML(pos)}</strong>`;
}

function readinessText(state, role) {
  if (role === 'byproduct') {
    if (state === 'critical') return 'CONTAINMENT CRITICAL';
    if (state === 'low') return 'DISPOSAL WATCH';
    return 'CONTAINMENT STABLE';
  }
  if (role === 'confiscated') {
    if (state === 'critical') return 'VAULT OVERFLOW';
    if (state === 'low') return 'HIGH VOLUME';
    return 'EVIDENCE SECURED';
  }
  if (role === 'export') {
    if (state === 'critical') return 'EXPORT RESERVE CRITICAL';
    if (state === 'low') return 'LOW EXPORT RESERVE';
    return 'EXPORT READY';
  }
  if (role === 'maintenance') {
    if (state === 'critical') return 'FACILITY RISK';
    if (state === 'low') return 'RESERVE WATCH';
    return 'FACILITY STABLE';
  }
  return 'TRACKED';
}

function updateSyncCountdown() {
  if (!els.syncCountdown) return;
  if (isLoading) {
    els.syncCountdown.textContent = 'SYNCING';
    els.syncCountdown.style.color = 'var(--warn)';
    return;
  }
  if (!nextSyncAt) {
    els.syncCountdown.textContent = '–';
    els.syncCountdown.style.color = 'var(--gold)';
    return;
  }

  const remaining = Math.max(0, Math.ceil((nextSyncAt - Date.now()) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, '0');
  els.syncCountdown.textContent = minutes > 0 ? `${minutes}:${seconds}` : `${remaining}s`;
  els.syncCountdown.style.color = remaining <= 30 ? 'var(--warn)' : 'var(--gold)';
}

function setTelemetryState(telemetry, cls = 'gold') {
  if (!els.telemetryStateVal) return;
  scrambleText(els.telemetryStateVal, telemetry);
  els.telemetryStateVal.style.color = `var(--${cls})`;
}

function setFooterConnection(state, colorToken = '') {
  if (!els.footerConnection) return;
  els.footerConnection.textContent = state;
  els.footerConnection.style.color = colorToken ? `var(--${colorToken})` : '';
}

function setSupplierLinkState(state, text) {
  if (els.supplierLinkBadge) {
    els.supplierLinkBadge.classList.remove('polling', 'online', 'offline', 'degraded', 'stale');
    els.supplierLinkBadge.classList.add(state);
  }
  if (els.supplierLinkText) els.supplierLinkText.textContent = text;
}
