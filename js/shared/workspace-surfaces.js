/* ==========================================================================
   RHW UI POLISH FIX
   Keeps the unified visual system while clarifying workspace hierarchy,
   moving maintenance data behind the actual tool, giving both
   market scans matching Logistics surfaces, and removing redundant controls.
   ========================================================================== */
(function initRhwUiPolishFix() {
  'use strict';
  const app = window.RHWV4;
  if (!app || app.workspaceSurfaces) return;

  let unsubscribeDiscovery = null;

  function relabelCalculator() {
    const tab = document.querySelector('.app-tabs [data-workspace="operations"]');
    const label = tab?.querySelector(':scope > span');
    if (label) label.textContent = 'CALCULATOR';
    const small = tab?.querySelector('small');
    if (small) small.textContent = 'RECIPE COSTING';
    tab?.setAttribute('aria-label', 'CALCULATOR: RECIPE COSTING');

    const workspace = document.getElementById('workspaceOperations');
    workspace?.setAttribute('aria-label', 'Calculator workspace');
    const nav = document.getElementById('operationsNodeNav');
    nav?.setAttribute('aria-label', 'Calculator tools');
    const kicker = document.querySelector('.operations-heading .workspace-kicker span');
    if (kicker) kicker.textContent = 'CALCULATOR';

    const active = document.getElementById('appActiveNode');
    if (active) active.textContent = active.textContent.replace('OPERATIONS /', 'CALCULATOR /').replace('FABRICATION /', 'CALCULATOR /');
  }

  function updateDiscoverySummary() {
    const summary = document.getElementById('rhwDataStatusSummary');
    if (!summary) return;
    const panel = document.getElementById('discoveryDataStatus');
    const catalog = panel?.querySelector('.discovery-data-grid article:first-child strong')?.textContent?.trim() || 'CATALOG READY';
    const catalogState = panel?.querySelector('.discovery-state')?.textContent?.trim() || 'READY';
    const live = document.getElementById('discoveryLiveState');
    const liveText = live?.textContent?.trim() || 'NOT CHECKED';
    const liveTone = live?.dataset.tone || 'muted';
    summary.innerHTML = `<span class="rhw-data-status-copy"><strong>CATALOG + SYNC STATUS</strong><small>${app.util.escape(catalogState)} · ${app.util.escape(catalog)} · DETAILS + MAINTENANCE</small></span><b class="rhw-data-status-live" data-tone="${app.util.escape(liveTone)}">${app.util.escape(liveText)}</b>`;
  }

  function relocateDiscoveryPanel() {
    const panel = document.getElementById('discoveryDataStatus');
    const systemSheet = document.querySelector('#rhwDiagnosticsPanel .rhw-diagnostics-sheet');
    if (!panel || !systemSheet) return false;

    let details = document.getElementById('rhwDataStatusUtility');
    if (!details) {
      details = document.createElement('details');
      details.id = 'rhwDataStatusUtility';
      details.className = 'rhw-data-status-utility';
      const summary = document.createElement('summary');
      summary.id = 'rhwDataStatusSummary';
      summary.setAttribute('aria-label', 'Open Discovery catalog and sync details');
      details.appendChild(summary);
      systemSheet.querySelector('.rhw-diagnostics-events').before(details);
    }
    if (panel.parentElement !== details) details.appendChild(panel);
    details.open = false;
    updateDiscoverySummary();

    unsubscribeDiscovery?.();
    unsubscribeDiscovery = app.onRender('discovery', updateDiscoverySummary);
    return true;
  }

  function restoreMarketScan() {
    const logisticsPanel = document.querySelector('[data-command-panel="logistics"]');
    const external = document.getElementById('externalLogisticsPanel');
    const market = document.getElementById('marketScanSection');
    const materials = document.getElementById('materialsScanSection');
    if (!logisticsPanel || !external || !market || !materials) return false;

    // Move the existing nodes to preserve renderer references and sort listeners.
    [market, materials].forEach(surface => {
      surface.hidden = false;
      surface.removeAttribute('hidden');
      ['display', 'visibility', 'opacity'].forEach(property => surface.style.removeProperty(property));
      surface.classList.add('rhw-market-scan-surface');
      if (surface.parentElement !== logisticsPanel) logisticsPanel.insertBefore(surface, external);
    });

    const shipScope = document.getElementById('rhwMarketScanScope');
    const materialsScope = document.getElementById('rhwMaterialsScanScope');
    if (shipScope) shipScope.textContent = `${MARKET_SCAN.length} COMPONENTS · ALL KNOWN POBS`;
    if (materialsScope) materialsScope.textContent = `${MATERIALS_SCAN.length} MATERIALS · ALL KNOWN POBS`;

    try {
      if (typeof renderSupplier === 'function') renderSupplier();
    } catch {}
    return true;
  }

  function selfTest() {
    const failures = [];
    if (document.querySelector('.app-tabs [data-workspace="operations"] > span')?.textContent !== 'CALCULATOR') failures.push('calculator-label');
    if (!document.getElementById('rhwDataStatusUtility')?.contains(document.getElementById('discoveryDataStatus'))) failures.push('discovery-hierarchy');
    const logisticsPanel = document.querySelector('[data-command-panel="logistics"]');
    const market = document.getElementById('marketScanSection');
    if (!market || !document.getElementById('marketScanGrid') || market.parentElement !== logisticsPanel || !market.classList.contains('rhw-market-scan-surface')) failures.push('market-scan-surface');
    if (!document.getElementById('rhwMarketScanScope')) failures.push('market-scan-scope');
    if (!document.getElementById('commandTopButton')) failures.push('legacy-command-top-anchor');
    return failures;
  }


  app.lifecycle.on('shell:ready', 'workspace-labels', 10, relabelCalculator);
  app.lifecycle.on('command:ready', 'workspace-surfaces', 30, () => { relabelCalculator(); restoreMarketScan(); });
  app.lifecycle.on('command:activated', 'workspace-surfaces', 30, ({ node }) => {
    if (node === 'logistics') requestAnimationFrame(restoreMarketScan);
  });
  app.lifecycle.on('calculator:ready', 'workspace-labels', 50, relabelCalculator);
  app.lifecycle.on('calculator:activated', 'workspace-labels', 30, relabelCalculator);
  app.lifecycle.on('discovery:ready', 'data-status-tool', 10, () => {
    if (!relocateDiscoveryPanel()) throw new Error('UI POLISH COULD NOT RELOCATE DISCOVERY STATUS');
    if (!restoreMarketScan()) throw new Error('UI POLISH COULD NOT PROMOTE MARKET SCAN');
    relabelCalculator();
    const failures = selfTest();
    if (failures.length) throw new Error(`UI POLISH SELF TEST FAILED: ${failures.join(', ')}`);
  });

  app.workspaceSurfaces = {
    relabelCalculator,
    relabelFabrication: relabelCalculator,
    relocateDiscoveryPanel,
    restoreMarketScan,
    updateDiscoverySummary,
    selfTest
  };
})();
