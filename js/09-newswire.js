/* Dashboard startup and hull API detection. Newswire runtime retired. */
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
initEcoMode();
updateRoleSegments();
updateSortArrows();
updateMarketSortButtons();

refreshAll();
