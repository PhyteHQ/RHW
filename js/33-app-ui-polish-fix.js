/* ==========================================================================
   RHW UI POLISH FIX
   Keeps the unified visual system while clarifying workspace hierarchy,
   moving maintenance data behind the actual tool, giving both
   market scans matching Logistics surfaces, and removing redundant controls.
   ========================================================================== */
(function initRhwUiPolishFix() {
  'use strict';
  const app = window.RHWV4;
  if (!app || app.uiPolish) return;

  const base = {
    installShell: app.installShell,
    setActiveNode: app.setActiveNode,
    commandInit: app.command?.init,
    commandActivate: app.command?.activate,
    operationsInit: app.operations?.init,
    operationsActivate: app.operations?.activate,
    discoveryInit: app.discoveryStatus?.init
  };
  let discoveryObserver = null;

  function installStyles() {
    if (document.getElementById('rhwUiPolishFixStyle')) return;
    const style = document.createElement('style');
    style.id = 'rhwUiPolishFixStyle';
    style.textContent = `
      #commandTopButton{display:none!important}

      .rhw-data-status-utility{
        margin:14px 0 0;border:1px solid rgba(120,173,138,.20);border-radius:8px;
        background:linear-gradient(90deg,rgba(120,173,138,.055),rgba(5,8,10,.95) 48%);
        box-shadow:0 10px 24px rgba(0,0,0,.18);overflow:hidden
      }
      .rhw-data-status-utility>summary{
        min-height:54px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;
        padding:8px 12px;cursor:pointer;list-style:none;color:#d9e6de;font-family:var(--font-tech);user-select:none
      }
      .rhw-data-status-utility>summary::-webkit-details-marker{display:none}
      .rhw-data-status-utility>summary::before{
        content:'DATA';display:grid;place-items:center;min-width:38px;height:28px;border:1px solid rgba(120,173,138,.24);
        background:rgba(120,173,138,.06);color:#8db99a;font-size:7px;font-weight:700;letter-spacing:.09em
      }
      .rhw-data-status-copy{display:grid;gap:3px;min-width:0}
      .rhw-data-status-copy strong{font-size:10px;letter-spacing:.08em;color:#dce9e1}
      .rhw-data-status-copy small{font-size:7px;letter-spacing:.065em;color:rgba(177,194,185,.58);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .rhw-data-status-live{padding:5px 7px;border:1px solid rgba(120,173,138,.2);background:rgba(120,173,138,.045);color:#8db99a;font-size:7px;font-weight:700;letter-spacing:.07em;white-space:nowrap}
      .rhw-data-status-live[data-tone="danger"]{border-color:rgba(199,94,94,.28);background:rgba(199,94,94,.07);color:#d97979}
      .rhw-data-status-live[data-tone="warn"]{border-color:rgba(201,139,44,.28);background:rgba(201,139,44,.07);color:#d4a056}
      .rhw-data-status-utility[open]>summary{border-bottom:1px solid rgba(120,173,138,.14)}
      .rhw-data-status-utility #discoveryDataStatus{margin:0!important;border:0!important;border-radius:0!important;box-shadow:none!important}

      /* Both all-POB scans share the same direct Logistics surface. */
      [data-command-panel="logistics"]>.rhw-market-scan-surface{
        display:block!important;visibility:visible!important;opacity:1!important;
        width:100%;margin:0!important;border:1px solid rgba(125,167,234,.24);border-radius:9px;
        background:linear-gradient(145deg,rgba(125,167,234,.085),rgba(5,8,12,.96) 42%);
        box-shadow:0 14px 34px rgba(0,0,0,.27);overflow:hidden
      }
      .rhw-market-scan-surface .logistics-subhead{
        margin:0;padding:14px 16px;border-bottom:1px solid rgba(125,167,234,.15);
        background:linear-gradient(90deg,rgba(125,167,234,.075),transparent 72%)
      }
      .rhw-market-scan-surface .logistics-subhead-kicker{color:rgba(125,167,234,.72)!important}
      .rhw-market-scan-surface .logistics-subhead-title{color:#dce8fb;font-size:clamp(24px,2.1vw,32px)}
      .rhw-market-scan-scope{
        display:inline-flex;align-items:center;min-height:28px;padding:5px 8px;border:1px solid rgba(125,167,234,.22);
        background:rgba(125,167,234,.055);color:#b9cdf0;font-family:var(--font-tech);font-size:7px;font-weight:700;letter-spacing:.08em;white-space:nowrap
      }
      .rhw-market-scan-surface .market-scan-grid{display:grid!important;visibility:visible!important;opacity:1!important}
      [data-command-panel="logistics"]>#externalLogisticsPanel{margin-top:0!important}

      @media(max-width:760px){
        .rhw-unified-ui .app-tabs{
          padding:4px!important;gap:0!important;border-radius:9px!important;overflow:hidden;
          background:rgba(4,6,8,.97)!important
        }
        .rhw-unified-ui .app-tabs button{
          display:grid!important;grid-template-columns:24px minmax(0,1fr)!important;
          grid-template-areas:"workspace-index workspace-title"!important;align-items:center!important;
          justify-items:stretch!important;column-gap:7px!important;min-height:50px!important;padding:7px 8px!important;
          border-radius:0!important;background:rgba(0,0,0,.12)!important;text-align:left!important;
          box-shadow:none!important
        }
        .rhw-unified-ui .app-tabs button+button{border-left:1px solid rgba(255,255,255,.055)!important}
        .rhw-unified-ui .app-tabs button small{display:none!important}
        .rhw-unified-ui .app-tabs .rhw-workspace-index{
          grid-area:workspace-index!important;display:grid!important;width:22px!important;height:22px!important;
          font-size:6.5px!important
        }
        .rhw-unified-ui .app-tabs button span{
          grid-area:workspace-title!important;font-size:11px!important;letter-spacing:.055em!important;white-space:nowrap
        }
        .rhw-unified-ui .app-tabs button::before{display:none!important}
        .rhw-unified-ui .app-tabs button.active{
          background:linear-gradient(180deg,rgba(var(--tab-accent-rgb),.16),rgba(var(--tab-accent-rgb),.035))!important;
          box-shadow:inset 3px 0 0 var(--tab-accent),inset 0 0 20px rgba(var(--tab-accent-rgb),.04)!important
        }
        .rhw-data-status-utility{margin:12px 9px 0}
        .rhw-data-status-utility>summary{min-height:50px;padding:7px 9px;gap:8px}
        .rhw-data-status-copy strong{font-size:9px}.rhw-data-status-copy small{font-size:6px}
        .rhw-data-status-live{font-size:6px;padding:4px 5px}
        [data-command-panel="logistics"]>.rhw-market-scan-surface{margin:0 9px 12px!important;width:calc(100% - 18px)}
        .rhw-market-scan-surface .logistics-subhead{padding:12px;gap:9px;align-items:flex-start;flex-direction:column}
        .rhw-market-scan-surface .market-scan-actions{width:100%;align-items:stretch}
        .rhw-market-scan-surface .market-sort-segments{width:100%;display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
        .rhw-market-scan-surface .market-sort-button{min-width:0;min-height:44px}
        .rhw-market-scan-surface .market-scan-grid{grid-template-columns:1fr!important;padding:8px!important;gap:8px!important}
      }
      @media(max-width:390px){
        .rhw-unified-ui .app-tabs button{grid-template-columns:20px minmax(0,1fr)!important;column-gap:5px!important;padding-inline:5px!important}
        .rhw-unified-ui .app-tabs .rhw-workspace-index{width:19px!important;height:19px!important;font-size:6px!important}
        .rhw-unified-ui .app-tabs button span{font-size:9.5px!important;letter-spacing:.035em!important}
      }
    `;
    document.head.appendChild(style);
  }

  function relabelCalculator() {
    const tab = document.querySelector('.app-tabs [data-workspace="operations"]');
    const label = tab?.querySelector(':scope > span');
    if (label) label.textContent = 'CALCULATOR';
    const small = tab?.querySelector('small');
    if (small) small.textContent = 'COSTING + ORDERS';
    tab?.setAttribute('aria-label', 'CALCULATOR: COSTING + ORDERS');

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

    discoveryObserver?.disconnect();
    discoveryObserver = new MutationObserver(updateDiscoverySummary);
    discoveryObserver.observe(panel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-tone'] });
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

  installStyles();

  app.setActiveNode = function polishedActiveNode(value) {
    const next = String(value || '').replace(/^OPERATIONS\b/, 'CALCULATOR').replace(/^FABRICATION\b/, 'CALCULATOR');
    return base.setActiveNode.call(this, next);
  };

  app.installShell = function polishedInstallShell(...args) {
    const result = base.installShell.apply(this, args);
    relabelCalculator();
    return result;
  };

  if (typeof base.commandInit === 'function') {
    app.command.init = function polishedCommandInit(...args) {
      const result = base.commandInit.apply(this, args);
      relabelCalculator();
      restoreMarketScan();
      return result;
    };
  }

  if (typeof base.commandActivate === 'function') {
    app.command.activate = function polishedCommandActivate(node, options) {
      const result = base.commandActivate.call(this, node, options);
      if (node === 'logistics') requestAnimationFrame(restoreMarketScan);
      return result;
    };
  }

  if (typeof base.operationsInit === 'function') {
    app.operations.init = async function polishedOperationsInit(...args) {
      const result = await base.operationsInit.apply(this, args);
      relabelCalculator();
      return result;
    };
  }

  if (typeof base.operationsActivate === 'function') {
    app.operations.activate = function polishedOperationsActivate(node, options) {
      const result = base.operationsActivate.call(this, node, options);
      relabelCalculator();
      return result;
    };
  }

  if (typeof base.discoveryInit === 'function') {
    app.discoveryStatus.init = async function polishedDiscoveryInit(...args) {
      const result = await base.discoveryInit.apply(this, args);
      if (!relocateDiscoveryPanel()) throw new Error('UI POLISH COULD NOT RELOCATE DISCOVERY STATUS');
      if (!restoreMarketScan()) throw new Error('UI POLISH COULD NOT PROMOTE MARKET SCAN');
      relabelCalculator();
      const failures = selfTest();
      if (failures.length) throw new Error(`UI POLISH SELF TEST FAILED: ${failures.join(', ')}`);
      return result;
    };
  }

  app.uiPolish = {
    relabelCalculator,
    relabelFabrication: relabelCalculator,
    relocateDiscoveryPanel,
    restoreMarketScan,
    updateDiscoverySummary,
    selfTest
  };
})();
