/* ==========================================================================
   RHW WEB APP · V4.0.2 BUGFIX LAYER
   Keeps overview telemetry status truthful and fills generated control labels.
   ========================================================================== */
(function initRhwV402Fixes() {
  'use strict';
  const app = window.RHWV4;
  if (!app || app.v402Fixes) return;

  let queued = false;
  let observer = null;

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

  function labelGeneratedControls() {
    document.querySelectorAll('#workspaceOperations [data-material-price]').forEach(input => {
      if (input.getAttribute('aria-label')) return;
      const name = input.closest('.ops-material-row')?.querySelector('td strong')?.textContent?.trim() || input.dataset.materialPrice || 'Material';
      input.setAttribute('aria-label', `${name} price per unit`);
    });

    const tickerOutput = document.getElementById('v40TickerOutput');
    if (tickerOutput && !tickerOutput.getAttribute('aria-label')) tickerOutput.setAttribute('aria-label', 'Generated Newswire source block');

    const newswireOutput = document.getElementById('v40NewswireFileOutput');
    if (newswireOutput && !newswireOutput.getAttribute('aria-label')) newswireOutput.setAttribute('aria-label', 'Updated RHW Newswire Markdown source');
  }

  function sync() {
    syncTelemetryBadge();
    labelGeneratedControls();
  }

  function queueSync() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      sync();
    });
  }

  function init() {
    if (observer) return;
    observer = new MutationObserver(queueSync);
    observer.observe(document.body, { childList: true, subtree: true });
    app.onUiUpdate(syncTelemetryBadge);
    sync();
  }

  app.v402Fixes = { init, sync, syncTelemetryBadge, labelGeneratedControls };
  init();
})();
