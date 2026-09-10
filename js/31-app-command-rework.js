/* ==========================================================================
   RHW COMMAND REWORK
   Removes Overview from the visible command flow, promotes the four operational
   areas, keeps legacy overview analysis as an internal status sensor, and moves
   priority actions into a persistent command alert strip.
   ========================================================================== */
(function initRhwCommandRework() {
  'use strict';
  const app = window.RHWV4;
  if (!app?.command || app.commandRework) return;

  const MODULES = Object.freeze([
    Object.freeze({ key: 'inventory', label: 'INVENTORY', sub: 'STATUS + MANIFEST', index: '01' }),
    Object.freeze({ key: 'shipyard', label: 'SHIPYARD', sub: 'HULLS + COMPONENTS', index: '02' }),
    Object.freeze({ key: 'production', label: 'PRODUCTION', sub: 'MODULES + CAPACITY + BOTTLENECKS', index: '03' }),
    Object.freeze({ key: 'logistics', label: 'LOGISTICS', sub: 'REMOTE BASES + MARKET + SUPPLY', index: '04' })
  ]);
  const MODULE_KEYS = new Set(MODULES.map(module => module.key));
  const baseInit = app.command.init;
  const baseActivate = app.command.activate;
  const baseStoredNode = app.workspaceStoredNode;
  let statusTimer = null;

  function installStyles() {
    if (document.getElementById('rhwCommandReworkStyle')) return;
    const style = document.createElement('style');
    style.id = 'rhwCommandReworkStyle';
    style.dataset.stylesheet = '35-app-interface-cleanup.css';
    document.head.appendChild(style);
  }

  function navMarkup() {
    return `<div class="workspace-subnav-tabs command-module-grid">${MODULES.map(module => `
      <button type="button" data-command-node="${module.key}" data-state="waiting" aria-label="${module.label}: ${module.sub}">
        <span class="command-module-index" aria-hidden="true">${module.index}</span>
        <span class="command-module-copy"><strong>${module.label}</strong><small>${module.sub}</small></span>
        <b class="command-module-state" data-command-status="${module.key}">AWAITING DATA</b>
      </button>`).join('')}</div>`;
  }

  function buildNavigation() {
    const nav = document.getElementById('commandNodeNav');
    if (!nav) return false;
    nav.classList.add('command-module-nav');
    nav.setAttribute('aria-label', 'Command operational areas');
    nav.innerHTML = navMarkup();
    if (nav.dataset.commandReworkKeys !== 'true') {
      nav.dataset.commandReworkKeys = 'true';
      nav.addEventListener('keydown', event => {
        const button = event.target.closest('[data-command-node]');
        if (!button || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...nav.querySelectorAll('[data-command-node]')];
        const current = buttons.indexOf(button);
        if (current < 0) return;
        event.preventDefault();
        let nextIndex = current;
        if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = buttons.length - 1;
        else if (event.key === 'ArrowLeft') nextIndex = (current - 1 + buttons.length) % buttons.length;
        else if (event.key === 'ArrowRight') nextIndex = (current + 1) % buttons.length;
        else if (event.key === 'ArrowUp') nextIndex = (current - 2 + buttons.length) % buttons.length;
        else if (event.key === 'ArrowDown') nextIndex = (current + 2) % buttons.length;
        buttons[nextIndex]?.focus();
      });
    }
    return true;
  }

  function movePriorityActions() {
    const host = document.getElementById('commandNodeHost');
    const overview = document.querySelector('[data-command-panel="overview"]');
    if (!host || !overview) return false;
    overview.classList.add('command-overview-sensor');
    overview.setAttribute('aria-hidden', 'true');

    let panel = document.getElementById('commandGlobalAlerts');
    if (!panel) {
      panel = overview.querySelector('.command-priority-panel');
      if (!panel) return false;
      panel.id = 'commandGlobalAlerts';
      panel.classList.add('command-global-alerts');
      panel.dataset.alertState = 'clear';
      panel.dataset.alertCount = '0';
      const head = panel.querySelector('.command-priority-head');
      if (head) head.innerHTML = `<button type="button" class="command-alert-toggle" id="commandAlertToggle" aria-expanded="false" aria-controls="v40PriorityList">
        <i class="command-alert-signal" aria-hidden="true"></i>
        <span class="command-alert-copy"><strong>ATTENTION</strong><small>PRIORITY ACTIONS FROM CURRENT VERIFIED STATUS</small></span>
        <span class="command-alert-meta"><b id="v40PriorityCount">0 ACTIVE</b><i class="command-alert-chevron" aria-hidden="true">⌄</i></span>
      </button>`;
      host.insertAdjacentElement('beforebegin', panel);
      document.getElementById('commandAlertToggle')?.addEventListener('click', () => {
        const expanded = panel.classList.toggle('expanded');
        document.getElementById('commandAlertToggle')?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      });
      panel.addEventListener('click', event => {
        const target = event.target.closest('[data-priority-jump]');
        if (target?.dataset.priorityJump) app.navigate('command', target.dataset.priorityJump);
      });
    }
    return true;
  }

  function syncAlertState() {
    const panel = document.getElementById('commandGlobalAlerts');
    const list = document.getElementById('v40PriorityList');
    if (!panel || !list) return;
    const items = [...list.querySelectorAll('.command-priority-item')];
    const state = items.some(item => item.classList.contains('state-critical')) ? 'critical'
      : items.some(item => item.classList.contains('state-low')) ? 'low' : 'clear';
    panel.dataset.alertState = state;
    panel.dataset.alertCount = String(items.length);
    const hint = panel.querySelector('.command-alert-copy small');
    if (hint) hint.textContent = items.length
      ? items[0].querySelector('strong')?.textContent || 'OPEN PRIORITY ACTIONS'
      : 'NO PRIORITY ACTIONS // MONITORED THRESHOLDS NOMINAL';
    if (hint) hint.title = hint.textContent;
    if (items.length === 0) {
      panel.classList.remove('expanded');
      document.getElementById('commandAlertToggle')?.setAttribute('aria-expanded', 'false');
    }
  }

  function syncModuleStatuses() {
    try { app.command.updateOverview?.(); } catch {}
    MODULES.forEach(module => {
      const source = document.querySelector(`.command-overview-card[data-command-jump="${module.key}"]`);
      const button = document.querySelector(`#commandNodeNav [data-command-node="${module.key}"]`);
      const status = button?.querySelector(`[data-command-status="${module.key}"]`);
      if (!button || !status) return;
      const state = source?.dataset.state || 'waiting';
      const summary = source?.querySelector('strong')?.textContent?.trim() || 'AWAITING DATA';
      button.dataset.state = ['critical', 'low', 'ok', 'waiting'].includes(state) ? state : 'waiting';
      status.textContent = summary;
    });
    syncAlertState();
  }

  function selfTest() {
    const failures = [];
    const visibleButtons = [...document.querySelectorAll('#commandNodeNav [data-command-node]')];
    if (visibleButtons.length !== 4) failures.push('command-nav-count');
    if (visibleButtons.some(button => button.dataset.commandNode === 'overview')) failures.push('overview-visible');
    if (!document.getElementById('commandGlobalAlerts')) failures.push('alert-strip');
    if (!document.querySelector('[data-command-panel="overview"].command-overview-sensor')) failures.push('overview-sensor');
    if (!document.querySelector('.inventory-view-nav')) failures.push('inventory-view-switch');
    return failures;
  }

  function install() {
    installStyles();
    buildNavigation();
    movePriorityActions();
    clearInterval(app.commandOverviewTimer);
    clearInterval(statusTimer);
    syncModuleStatuses();
    statusTimer = window.setInterval(() => {
      if (app.state.activeWorkspace === 'command') syncModuleStatuses();
    }, 2500);
    app.command.nodes = MODULES.map(module => [module.key, module.label, module.sub]);
    const failures = selfTest();
    if (failures.length) throw new Error(`COMMAND REWORK SELF TEST FAILED: ${failures.join(', ')}`);
    return true;
  }

  app.workspaceStoredNode = function commandReworkStoredNode(workspace) {
    const stored = baseStoredNode.call(this, workspace);
    if (workspace === 'command' && !MODULE_KEYS.has(stored)) return 'inventory';
    return stored;
  };

  app.command.init = function commandReworkInit(...args) {
    const result = baseInit.apply(this, args);
    install();
    return result;
  };

  app.command.activate = function commandReworkActivate(node, options) {
    const legacySmokeOverview = Boolean(window.__RHW_SMOKE_INLINE__ && node === 'overview');
    const next = legacySmokeOverview ? 'overview' : (MODULE_KEYS.has(node) ? node : 'inventory');
    const result = baseActivate.call(this, next, options);
    requestAnimationFrame(syncModuleStatuses);
    return result;
  };

  app.commandRework = {
    modules: MODULES,
    install,
    syncModuleStatuses,
    syncAlertState,
    selfTest
  };
})();
