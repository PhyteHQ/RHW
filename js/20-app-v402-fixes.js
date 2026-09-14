/* ==========================================================================
   RHW WEB APP · V4.0.2 BUGFIX LAYER
   Keeps overview telemetry status truthful when data changes.
   ========================================================================== */
(function initRhwV402Fixes() {
  'use strict';
  const app = window.RHWV4;
  if (!app || app.v402Fixes) return;

  function syncTelemetryBadge() {
    const badge = document.querySelector('.command-overview-live');
    if (!badge) return;
    const snapshot = window.telemetrySnapshot();
    const verified = snapshot.available;
    const stale = snapshot.stale;
    const state = verified ? (stale ? 'stale' : 'live') : 'offline';
    const label = state === 'live' ? 'LIVE TELEMETRY' : (state === 'stale' ? 'CACHE TELEMETRY' : snapshot.label);
    badge.title = snapshot.detail;

    badge.id = 'v40OverviewTelemetryState';
    badge.dataset.state = state;
    badge.setAttribute('aria-live', 'polite');
    let text = badge.querySelector(':scope > span[data-v402-telemetry-label]');
    if (!text) {
      [...badge.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).forEach(node => node.remove());
      text = document.createElement('span');
      text.dataset.v402TelemetryLabel = 'true';
      badge.appendChild(text);
    }
    if (text.textContent !== label) text.textContent = label;
  }

  app.onUiUpdate(syncTelemetryBadge);
  app.v402Fixes = { init: syncTelemetryBadge, sync: syncTelemetryBadge, syncTelemetryBadge };
  syncTelemetryBadge();
})();
