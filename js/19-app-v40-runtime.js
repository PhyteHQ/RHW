/* ==========================================================================
   RHW WEB APP · V4.0 RUNTIME
   Deterministic boot, diagnostics and smoke-test surface.
   ========================================================================== */
(function initRhwV4Runtime() {
  'use strict';
  const app = window.RHWV4;
  if (!app) return;
  const runtimeErrors = [];

  function recordError(error) {
    const message = String(error?.message || error || 'UNKNOWN RUNTIME ERROR');
    runtimeErrors.push(message);
    app.diagnostics?.recordError?.(error);
    document.documentElement.dataset.v40Error = 'true';
    window.__RHW_V4_SMOKE__ = { ready: false, errors: [...runtimeErrors], route: location.hash };
    console.error('RHW V4 RUNTIME', error);
  }
  window.addEventListener('error', event => recordError(event.error || event.message));
  window.addEventListener('unhandledrejection', event => recordError(event.reason));

  function installDesktopReadabilityCoverage() {
    const style = document.getElementById('rhwV40ReleasePolishStyle');
    if (!style || style.dataset.fullReadability === 'true') return;
    style.dataset.fullReadability = 'true';
  }

  function selfTest() {
    const failures = [];
    ['rhwAppNav','rhwWorkspaceRoot','workspaceCommand','workspaceOperations','workspaceComms','commandNodeNav','operationsNodeNav','commsNodeNav','appNavigationCluster','appContextNavSlot','commsForm','forumLivePreview'].forEach(id => {
      if (!document.getElementById(id)) failures.push(`missing:${id}`);
    });
    if (typeof app.command?.activate !== 'function') failures.push('module:command');
    if (typeof app.operations?.activate !== 'function') failures.push('module:operations');
    if (typeof app.operationsCore?.buildPlan !== 'function') failures.push('feature:operations-planner');
    if (typeof app.productionOrders?.buildReport !== 'function') failures.push('module:production-orders');
    (app.productionOrders?.selfTest?.() || []).forEach(failure => failures.push(`orders:${failure}`));
    if (typeof app.transferCenter?.previewFile !== 'function') failures.push('module:transfer-center');
    (app.transferCenter?.selfTest?.() || []).forEach(failure => failures.push(`transfer:${failure}`));
    if (typeof app.newswireReview?.buildReviewPackage !== 'function') failures.push('module:newswire-review');
    (app.newswireReview?.selfTest?.() || []).forEach(failure => failures.push(`newswire-review:${failure}`));
    if (typeof app.discoveryStatus?.init !== 'function') failures.push('module:discovery-status');
    (app.discoveryStatus?.selfTest?.() || []).forEach(failure => failures.push(`discovery:${failure}`));
    if (typeof app.diagnostics?.init !== 'function') failures.push('module:diagnostics');
    (app.diagnostics?.selfTest?.() || []).forEach(failure => failures.push(`diagnostics:${failure}`));
    if (typeof app.fullAudit?.run !== 'function') failures.push('module:full-audit');
    (app.fullAudit?.selfTest?.() || []).forEach(failure => failures.push(`full-audit:${failure}`));
    if (!app.operationsCore?.state?.catalog?.meta?.recipeCount) failures.push('feature:recipe-catalog');
    const bustardAlias = app.operations?.recipeAliases?.ship_assembly_dsy_barge;
    if (!bustardAlias || bustardAlias.outputId !== 'dsy_barge_package' || !app.operationsCore?.recipe?.('ship_assembly_dsy_barge')) failures.push('feature:bustard-recipe-alias');
    const iffSelect = document.getElementById('opsAffiliation');
    if (iffSelect?.textContent?.includes('RHW DEFAULT')) failures.push('ui:bmm-iff-label');

    const requiredMarketTargets = [
      'avionics systems', 'interior systems', 'propulsion systems',
      'superstructure systems', 'reactor systems', 'exotic systems'
    ];
    const marketTargets = typeof MARKET_SCAN === 'undefined'
      ? []
      : MARKET_SCAN.map(value => String(value || '').trim().toLowerCase());
    if (marketTargets.length !== requiredMarketTargets.length || requiredMarketTargets.some(target => !marketTargets.includes(target))) {
      failures.push('feature:shipyard-market-scan');
    }

    const requiredMaterialTargets = ['gold', 'gold ore', 'niobium', 'niobium ore', 'prototype components'];
    const materialTargets = typeof MATERIALS_SCAN === 'undefined'
      ? [] : MATERIALS_SCAN.map(value => String(value || '').trim().toLowerCase());
    if (materialTargets.length !== requiredMaterialTargets.length || requiredMaterialTargets.some(target => !materialTargets.includes(target)) || materialTargets.some(target => marketTargets.includes(target))) {
      failures.push('feature:industrial-materials-scan');
    }

    if (typeof app.navHierarchy?.sync !== 'function') failures.push('module:navigation-hierarchy');
    (app.navHierarchy?.selfTest?.() || []).forEach(failure => failures.push(`nav:${failure}`));
    if (typeof app.comms?.activate !== 'function') failures.push('module:comms');
    if (typeof app.commsSafety?.init !== 'function') failures.push('module:comms-safety');
    (app.commsSafety?.selfTest?.() || []).forEach(failure => failures.push(`polish:${failure}`));
    if (document.getElementById('rhwV40ReleasePolishStyle')?.dataset.fullReadability !== 'true') failures.push('polish:desktop-readability');
    if (typeof app.storage?.saveDraft !== 'function') failures.push('module:storage');
    if (typeof app.comms?.buildBbcode !== 'function') failures.push('feature:bbcode');
    if (typeof app.mobileUi?.setForumView !== 'function') failures.push('module:mobile-ui');
    (app.mobileUi?.selfTest?.() || []).forEach(failure => failures.push(`mobile:${failure}`));
    if (!document.querySelector('[data-command-panel="overview"]')) failures.push('route:command-overview');
    if (!document.querySelector('[data-operations-panel="calculator"]')) failures.push('route:operations-calculator');
    if (!document.querySelector('[data-pricecheck-panel="routes"]')) failures.push('route:pricecheck-routes');
    if (!document.querySelector('[data-comms-panel="ticker"]')) failures.push('route:comms-ticker');
    return failures;
  }

  function exposeSmoke(failures = []) {
    const route = app.route.parse();
    const allErrors = [...runtimeErrors, ...failures];
    window.__RHW_V4_SMOKE__ = {
      ready: allErrors.length === 0,
      errors: allErrors,
      workspace: app.state.activeWorkspace,
      commandNode: app.state.commandNode,
      operationsNode: app.state.operationsNode,
      pricecheckNode: app.state.pricecheckNode,
      commsNode: app.state.commsNode,
      route,
      recipeCount: app.operationsCore?.state?.catalog?.meta?.recipeCount || 0
    };
    document.documentElement.dataset.v40Ready = allErrors.length ? 'false' : 'true';
    if (allErrors.length) document.documentElement.dataset.v40Error = 'true';
  }

  async function boot() {
    try {
      document.documentElement.dataset.rhwApp = 'v4';
      if (new URLSearchParams(location.search).has('smoke') || window.__RHW_SMOKE_INLINE__) document.documentElement.classList.add('v40-smoke-mode');
      app.storage?.init();
      if (!app.installShell()) throw new Error('V4 APP SHELL COULD NOT FIND THE STABLE DASHBOARD MOUNTS');
      app.command?.init();
      app.comms?.init();
      if (!app.transferCenter?.init?.()) throw new Error('RHW TRANSFER CENTER COULD NOT MOUNT');
      if (!app.newswireReview?.init?.()) throw new Error('RHW NEWSWIRE REVIEW DESK COULD NOT MOUNT');
      app.commsSafety?.init();
      installDesktopReadabilityCoverage();
      await app.operations?.init();
      if (!app.diagnostics?.init?.()) throw new Error('RHW SYSTEM CHECK COULD NOT MOUNT');
      await app.discoveryStatus?.init();
      if (!app.fullAudit?.init?.()) throw new Error('RHW FULL APP AUDIT COULD NOT MOUNT');
      app.applyRoute({ replace: true });
      if (!app.navHierarchy?.init?.()) throw new Error('V4 NAVIGATION HIERARCHY COULD NOT MOUNT');
      app.commsSafety?.polishOperations?.();
      document.querySelectorAll('#workspaceOperations .ops-price-input-wrap > span').forEach(node => {
        if (node.textContent.trim() === 'CR') node.textContent = '$';
      });

      const targetMeta = document.getElementById('externalTargetsMeta');
      if (targetMeta && typeof MARKET_SCAN !== 'undefined' && typeof MATERIALS_SCAN !== 'undefined') {
        targetMeta.textContent = `${MARKET_SCAN.length} SHIP COMPONENTS + ${MATERIALS_SCAN.length} MATERIALS`;
      }

      app.ready = true;
      document.documentElement.classList.remove('rhw-loading');
      const failures = selfTest();
      exposeSmoke(failures);
      if (failures.length) throw new Error(`V4 SELF TEST FAILED: ${failures.join(', ')}`);
    } catch (error) {
      recordError(error);
    }
  }

  app.runtime = { boot, selfTest, recordError };
  boot();
})();
