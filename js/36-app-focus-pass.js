/* ========================================================================== */
/* RHW FOCUS PASS                                                             */
/* Keeps daily RHW focused on COMMAND, CALCULATOR and FORUM while preserving  */
/* advanced/admin tools behind one secondary TOOLS surface.                    */
/* ========================================================================== */
(function initRhwFocusPass() {
  'use strict';

  const app = window.RHWV4;
  if (!app || app.focusPass) return;

  const TOOL_META = Object.freeze({
    data: Object.freeze({ label: 'DATA STATUS', sub: 'DISCOVERY CATALOG + SYNC', workspace: 'operations', node: 'calculator' }),
    backup: Object.freeze({ label: 'BACKUP + DRAFTS', sub: 'DEVICE TRANSFER + LOCAL ARCHIVE', workspace: 'comms', node: 'drafts' }),
    newswire: Object.freeze({ label: 'NEWSWIRE', sub: 'EDITORIAL MANAGER', workspace: 'comms', node: 'ticker' }),
    senders: Object.freeze({ label: 'SENDERS', sub: 'PROFILE REGISTRY', workspace: 'comms', node: 'senders' }),
    system: Object.freeze({ label: 'SYSTEM + DATA', sub: 'APP HEALTH + CATALOG + SYNC', workspace: null, node: null })
  });

  const ROUTE_TOOL = Object.freeze({
    'comms/drafts': 'backup',
    'comms/ticker': 'newswire',
    'comms/senders': 'senders'
  });

  const base = {
    installShell: app.installShell,
    applyRoute: app.applyRoute,
    navigate: app.navigate,
    operationsInit: app.operations?.init,
    operationsActivate: app.operations?.activate,
    commsInit: app.comms?.init,
    commsActivate: app.comms?.activate
  };

  let toolOpenedBy = null;
  let syncTimer = 0;

  function installStyles() {
    if (document.getElementById('rhwFocusPassStyle')) return;
    const style = document.createElement('style');
    style.id = 'rhwFocusPassStyle';
    style.dataset.stylesheet = '35-app-interface-cleanup.css';
    document.head.appendChild(style);
    document.documentElement.classList.add('rhw-focus-pass');
  }

  function tabTitle(button) {
    return [...(button?.children || [])].find(child => child.tagName === 'SPAN' && !child.classList.contains('rhw-workspace-index')) || button?.querySelector('span');
  }

  function relabelPrimaryTabs() {
    const command = document.querySelector('.app-tabs [data-workspace="command"]');
    const calculator = document.querySelector('.app-tabs [data-workspace="operations"]');
    const forum = document.querySelector('.app-tabs [data-workspace="comms"]');
    if (command) {
      const title = tabTitle(command); if (title) title.textContent = 'COMMAND';
      const sub = command.querySelector('small'); if (sub) sub.textContent = 'RHW STATUS';
      command.setAttribute('aria-label', 'Command');
    }
    if (calculator) {
      const title = tabTitle(calculator); if (title) title.textContent = 'CALCULATOR';
      const sub = calculator.querySelector('small'); if (sub) sub.textContent = 'ITEM COSTING';
      calculator.setAttribute('aria-label', 'Calculator');
    }
    if (forum) {
      const title = tabTitle(forum); if (title) title.textContent = 'FORUM';
      const sub = forum.querySelector('small'); if (sub) sub.textContent = 'TEMPLATE + BB CODE';
      forum.setAttribute('aria-label', 'Forum template');
    }
    document.getElementById('workspaceOperations')?.setAttribute('aria-label', 'Calculator workspace');
    document.getElementById('workspaceComms')?.setAttribute('aria-label', 'Forum workspace');
  }

  function toolsMarkup() {
    const cards = [
      ['backup', '01'], ['newswire', '02'], ['senders', '03'], ['system', '04']
    ].map(([key, index]) => {
      const tool = TOOL_META[key];
      return `<button type="button" class="rhw-focus-tool-card" data-rhw-tool="${key}"><span class="rhw-focus-tool-index">${index}</span><span class="rhw-focus-tool-copy"><strong>${tool.label}</strong><small>${tool.sub}</small></span><span class="rhw-focus-tool-arrow" aria-hidden="true">›</span></button>`;
    }).join('');
    return `<aside class="rhw-focus-tools-overlay" id="rhwFocusToolsPanel" role="dialog" aria-modal="true" aria-labelledby="rhwFocusToolsTitle" data-focus-trap="true" hidden><section class="rhw-focus-tools-sheet"><header class="rhw-focus-tools-head"><div><strong id="rhwFocusToolsTitle">TOOLS</strong></div><button type="button" id="rhwFocusToolsClose">CLOSE</button></header><div class="rhw-focus-tools-grid">${cards}</div></section></aside>`;
  }

  function toolsFocusable(panel = document.getElementById('rhwFocusToolsPanel')) {
    if (!panel) return [];
    return [...panel.querySelectorAll('button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(element => {
      if (element.disabled || element.hidden || element.closest('[hidden]')) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
  }

  function trapToolsFocus(event) {
    const panel = document.getElementById('rhwFocusToolsPanel');
    if (!panel || panel.hidden || event.key !== 'Tab') return;
    const focusable = toolsFocusable(panel);
    if (!focusable.length) {
      event.preventDefault();
      panel.focus?.();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!panel.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  }

  function mountTools() {
    if (!document.body) return false;
    let button = document.getElementById('rhwFocusToolsBtn');
    if (!button) {
      const brand = document.querySelector('.app-nav-brand');
      if (!brand) return false;
      button = document.createElement('button');
      button.id = 'rhwFocusToolsBtn';
      button.type = 'button';
      button.className = 'rhw-focus-tools-button';
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-controls', 'rhwFocusToolsPanel');
      button.setAttribute('aria-expanded', 'false');
      button.innerHTML = '<span>TOOLS</span>';
      const install = document.getElementById('rhwPwaInstallBtn');
      if (install) brand.insertBefore(button, install);
      else brand.appendChild(button);
    }
    if (!document.getElementById('rhwFocusToolsPanel')) document.body.insertAdjacentHTML('beforeend', toolsMarkup());
    const panel = document.getElementById('rhwFocusToolsPanel');
    if (panel) panel.dataset.focusTrap = 'true';
    if (button.dataset.rhwFocusBound !== 'true') {
      button.dataset.rhwFocusBound = 'true';
      button.addEventListener('click', openTools);
      document.getElementById('rhwFocusToolsClose')?.addEventListener('click', closeTools);
      panel?.addEventListener('click', event => {
        if (event.target.id === 'rhwFocusToolsPanel') closeTools();
        const tool = event.target.closest('[data-rhw-tool]');
        if (tool) openTool(tool.dataset.rhwTool);
      });
      panel?.addEventListener('keydown', trapToolsFocus);
      window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !document.getElementById('rhwFocusToolsPanel')?.hidden) closeTools();
      });
    }
    return true;
  }

  function openTools() {
    const panel = document.getElementById('rhwFocusToolsPanel');
    if (!panel) return;
    toolOpenedBy = document.activeElement;
    panel.hidden = false;
    document.getElementById('rhwFocusToolsBtn')?.setAttribute('aria-expanded', 'true');
    document.body.classList.add('rhw-focus-tools-open');
    document.getElementById('rhwFocusToolsClose')?.focus();
  }

  function closeTools() {
    const panel = document.getElementById('rhwFocusToolsPanel');
    if (panel) panel.hidden = true;
    document.getElementById('rhwFocusToolsBtn')?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('rhw-focus-tools-open');
    toolOpenedBy?.focus?.();
    toolOpenedBy = null;
  }

  function routeTool() {
    return ROUTE_TOOL[`${app.state.activeWorkspace}/${app.state.activeWorkspace === 'operations' ? app.state.operationsNode : app.state.activeWorkspace === 'comms' ? app.state.commsNode : ''}`] || '';
  }

  function revealDataStatus() {
    const details = document.getElementById('rhwDataStatusUtility');
    if (!details) return;
    details.hidden = false;
    details.open = true;
    requestAnimationFrame(() => details.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
  }

  function syncHeadings(toolKey) {
    if (app.state.activeWorkspace === 'operations') {
      const kicker = document.querySelector('#workspaceOperations .workspace-kicker');
      if (kicker) kicker.innerHTML = toolKey === 'build-queue' ? '<span>TOOLS</span> RHW BUILD QUEUE' : '<span>CALCULATOR</span> RHW INDUSTRIAL COSTING';
    }
    if (app.state.activeWorkspace === 'comms') {
      const kicker = document.querySelector('#workspaceComms .workspace-kicker');
      if (kicker) kicker.innerHTML = toolKey ? '<span>TOOLS</span> RHW SECONDARY UTILITY' : '<span>FORUM</span> RHW FORUM TEMPLATE';
    }
    const active = document.getElementById('appActiveNode');
    if (!active || app.state.activeWorkspace === 'command') return;
    if (toolKey) active.textContent = `ACTIVE NODE: TOOLS / ${TOOL_META[toolKey]?.label || toolKey.toUpperCase()}`;
    else active.textContent = `ACTIVE NODE: ${app.state.activeWorkspace === 'operations' ? 'CALCULATOR' : 'FORUM'}`;
  }

  function sync() {
    installStyles();
    relabelPrimaryTabs();
    mountTools();
    const toolKey = routeTool();
    document.body.dataset.rhwFocusTool = toolKey;
    const toolsButton = document.getElementById('rhwFocusToolsBtn');
    if (toolsButton) toolsButton.dataset.toolOpen = toolKey ? 'true' : 'false';
    syncHeadings(toolKey);
  }

  function queueSync() {
    clearTimeout(syncTimer);
    syncTimer = window.setTimeout(sync, 0);
    window.setTimeout(sync, 90);
    window.setTimeout(sync, 260);
  }

  function openTool(key) {
    const tool = TOOL_META[key];
    if (!tool) return;
    closeTools();
    if (key === 'system' || key === 'data') {
      app.diagnostics?.open?.();
      if (!app.diagnostics?.open) document.getElementById('rhwDiagnosticsBtn')?.click();
      if (key === 'data') revealDataStatus();
      return;
    }
    app.navigate(tool.workspace, tool.node);
    queueSync();
  }

  function bindPrimaryDefaults() {
    const nav = document.getElementById('rhwAppNav');
    if (!nav || nav.dataset.rhwFocusPrimaryBound === 'true') return;
    nav.dataset.rhwFocusPrimaryBound = 'true';
    nav.addEventListener('click', event => {
      const button = event.target.closest('.app-tabs [data-workspace]');
      if (!button) return;
      const workspace = button.dataset.workspace;
      if (workspace === 'operations' || workspace === 'comms') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        app.navigate(workspace, workspace === 'operations' ? 'calculator' : 'forum');
        queueSync();
      }
    }, true);
  }

  function selfTest() {
    const failures = [];
    const tabs = {
      command: tabTitle(document.querySelector('.app-tabs [data-workspace="command"]'))?.textContent?.trim(),
      calculator: tabTitle(document.querySelector('.app-tabs [data-workspace="operations"]'))?.textContent?.trim(),
      forum: tabTitle(document.querySelector('.app-tabs [data-workspace="comms"]'))?.textContent?.trim()
    };
    if (tabs.command !== 'COMMAND' || tabs.calculator !== 'CALCULATOR' || tabs.forum !== 'FORUM') failures.push('primary-tabs');
    if (!document.getElementById('rhwFocusToolsBtn') || !document.getElementById('rhwFocusToolsPanel')) failures.push('tools-surface');
    if (document.querySelectorAll('#rhwFocusToolsPanel [data-rhw-tool]').length !== 5) failures.push('tool-count');
    if (document.getElementById('rhwFocusToolsPanel')?.dataset.focusTrap !== 'true') failures.push('tools-focus-trap');
    if (!document.documentElement.classList.contains('rhw-focus-pass')) failures.push('focus-class');
    return failures;
  }

  installStyles();

  if (!location.hash) {
    app.store.set(app.config.storageKeys.operationsNode, 'calculator');
    app.store.set(app.config.storageKeys.commsNode, 'forum');
  }

  app.installShell = function focusedInstallShell(...args) {
    const result = base.installShell.apply(this, args);
    sync();
    bindPrimaryDefaults();
    return result;
  };

  app.applyRoute = function focusedApplyRoute(...args) {
    const result = base.applyRoute.apply(this, args);
    queueSync();
    return result;
  };

  app.navigate = function focusedNavigate(workspace, node, options) {
    const result = base.navigate.call(this, workspace, node, options);
    queueSync();
    return result;
  };

  if (typeof base.operationsInit === 'function') {
    app.operations.init = async function focusedOperationsInit(...args) {
      const result = await base.operationsInit.apply(this, args);
      queueSync();
      return result;
    };
  }
  if (typeof base.operationsActivate === 'function') {
    app.operations.activate = function focusedOperationsActivate(node, options) {
      const result = base.operationsActivate.call(this, node, options);
      queueSync();
      return result;
    };
  }
  if (typeof base.commsInit === 'function') {
    app.comms.init = function focusedCommsInit(...args) {
      const result = base.commsInit.apply(this, args);
      queueSync();
      return result;
    };
  }
  if (typeof base.commsActivate === 'function') {
    app.comms.activate = function focusedCommsActivate(node, options) {
      const result = base.commsActivate.call(this, node, options);
      queueSync();
      return result;
    };
  }

  app.focusPass = { installStyles, relabelPrimaryTabs, mountTools, openTools, closeTools, openTool, sync, selfTest, tools: TOOL_META };
})();