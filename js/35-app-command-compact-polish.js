/* ========================================================================== */
/* RHW COMMAND COMPACT POLISH                                                 */
/* Tightens the mobile COMMAND hierarchy without changing telemetry/data.     */
/* ========================================================================== */
(function initRhwCommandCompactPolish() {
  'use strict';
  const app = window.RHWV4;
  if (!app?.command || !app?.unifiedUi || app.commandCompactPolish) return;

  const base = { commandInit: app.command.init, commandActivate: app.command.activate };
  let alertObserver = null;

  function installStyles() {
    if (document.getElementById('rhwCommandCompactPolishStyle')) return;
    const style = document.createElement('style');
    style.id = 'rhwCommandCompactPolishStyle';
    style.dataset.stylesheet = '35-app-interface-cleanup.css';
    document.head.appendChild(style);
  }

  function installInventoryInteraction(nav) {
    if (!nav || nav.dataset.rhwCompactInteraction === 'true') return;
    nav.dataset.rhwCompactInteraction = 'true';

    nav.addEventListener('click', event => {
      const button = event.target.closest('[data-inventory-view]');
      if (!button || !nav.contains(button)) return;
      app.command.activateInventoryView?.(button.dataset.inventoryView);
    });

    nav.addEventListener('keydown', event => {
      const button = event.target.closest('[data-inventory-view]');
      if (!button || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const buttons = [...nav.querySelectorAll('[data-inventory-view]')];
      const current = buttons.indexOf(button);
      if (current < 0) return;
      event.preventDefault();
      event.stopPropagation();
      let next = current;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = buttons.length - 1;
      else next = (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      const target = buttons[next];
      if (!target) return;
      app.command.activateInventoryView?.(target.dataset.inventoryView);
      target.focus();
    });
  }

  function decorateInventoryNav() {
    const nav = document.querySelector('.inventory-view-nav');
    if (!nav) return null;
    nav.classList.add('rhw-inventory-mode-nav');
    [...nav.querySelectorAll('[data-inventory-view]')].forEach((button, index) => {
      if (button.querySelector('.rhw-subview-index')) return;
      const marker = document.createElement('i');
      marker.className = 'rhw-subview-index';
      marker.setAttribute('aria-hidden', 'true');
      marker.textContent = String(index + 1).padStart(2, '0');
      button.prepend(marker);
    });
    installInventoryInteraction(nav);
    return nav;
  }

  function mountInventoryNav() {
    const nav = decorateInventoryNav();
    const deck = document.getElementById('commandControlDeck');
    const panel = document.getElementById('commandGlobalAlerts');
    if (!nav || !deck || !panel) return false;
    if (nav.parentElement !== deck) deck.prepend(nav);
    if (panel.parentElement !== deck) deck.appendChild(panel);
    let details = document.getElementById('commandAlertDetails');
    if (!details) {
      details = document.createElement('div');
      details.id = 'commandAlertDetails';
      details.className = 'command-alert-details';
      details.appendChild(document.getElementById('v40PriorityList'));
      panel.appendChild(details);
      document.getElementById('commandAlertToggle')?.setAttribute('aria-controls', details.id);
      panel.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !panel.classList.contains('expanded')) return;
        event.preventDefault();
        closeAlerts();
        document.getElementById('commandAlertToggle')?.focus();
      });
      document.addEventListener('pointerdown', event => {
        if (!panel.contains(event.target)) closeAlerts();
      });
    }
    const group = document.querySelector('.command-focus-modes');
    if (group && group.parentElement !== details) details.prepend(group);
    return true;
  }

  function closeAlerts() {
    document.getElementById('commandGlobalAlerts')?.classList.remove('expanded');
    document.getElementById('commandAlertToggle')?.setAttribute('aria-expanded', 'false');
  }

  function installAttentionToggle() {
    const group = document.querySelector('.command-focus-modes');
    const all = group?.querySelector('[data-command-focus-mode="all"]');
    const attention = group?.querySelector('[data-command-focus-mode="attention"]');
    if (!group || !all || !attention) return false;
    group.classList.add('rhw-attention-only');
    if (attention.firstChild?.nodeType === Node.TEXT_NODE) attention.firstChild.textContent = 'FILTER AFFECTED AREAS ';
    all.hidden = true;
    all.tabIndex = -1;
    all.setAttribute('aria-hidden', 'true');
    if (attention.dataset.rhwAttentionToggle !== 'true') {
      attention.dataset.rhwAttentionToggle = 'true';
      attention.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const next = document.body.dataset.commandFocus === 'attention' ? 'all' : 'attention';
        app.unifiedUi.applyCommandFocus(next, { navigate: next === 'attention' });
        syncAttentionState();
      }, true);
    }
    return true;
  }

  function syncAttentionState() {
    const group = document.querySelector('.command-focus-modes');
    if (!group) return;
    const result = app.unifiedUi.syncCommandAttention?.() || { total: 0 };
    const total = Number(result.total) || 0;
    group.classList.toggle('rhw-attention-empty', total === 0);
    if (total === 0 && document.body.dataset.commandFocus === 'attention') app.unifiedUi.applyCommandFocus('all');
    document.getElementById('commandGlobalAlerts')?.toggleAttribute('data-filter-active', document.body.dataset.commandFocus === 'attention');
  }

  function syncAlerts() {
    app.commandRework?.syncAlertState?.();
    const panel = document.getElementById('commandGlobalAlerts');
    if (!panel) return;
    const count = Number(panel.dataset.alertCount) || panel.querySelectorAll('.command-priority-item').length;
    panel.hidden = count <= 0;
    panel.setAttribute('aria-hidden', count <= 0 ? 'true' : 'false');
    if (count <= 0) {
      panel.classList.remove('expanded');
      document.getElementById('commandAlertToggle')?.setAttribute('aria-expanded', 'false');
    }
    syncAttentionState();
  }

  function watchAlerts() {
    const list = document.getElementById('v40PriorityList');
    if (!list || alertObserver) return;
    alertObserver = new MutationObserver(() => requestAnimationFrame(syncAlerts));
    alertObserver.observe(list, { childList: true, subtree: true, characterData: true });
  }

  function sync() {
    installStyles();
    mountInventoryNav();
    installAttentionToggle();
    syncAlerts();
    watchAlerts();
  }

  function selfTest() {
    const failures = [];
    const inventoryNav = document.querySelector('.rhw-inventory-mode-nav');
    const deck = document.getElementById('commandControlDeck');
    const all = document.querySelector('[data-command-focus-mode="all"]');
    const attention = document.querySelector('[data-command-focus-mode="attention"]');
    if (!document.getElementById('rhwCommandCompactPolishStyle')) failures.push('style');
    if (!deck || inventoryNav?.parentElement !== deck) failures.push('inventory-toolbar');
    if (document.getElementById('commandGlobalAlerts')?.parentElement !== deck) failures.push('alerts-toolbar');
    if (!document.querySelector('#commandAlertDetails .command-focus-modes')) failures.push('unified-attention');
    if (inventoryNav?.querySelectorAll('.rhw-subview-index').length !== 2) failures.push('inventory-mode-indexes');
    if (inventoryNav?.dataset.rhwCompactInteraction !== 'true') failures.push('inventory-interaction');
    if (!all?.hidden) failures.push('all-areas-visible');
    if (attention?.dataset.rhwAttentionToggle !== 'true') failures.push('attention-toggle');
    return failures;
  }

  installStyles();
  if (typeof base.commandInit === 'function') {
    app.command.init = function compactCommandInit(...args) {
      const result = base.commandInit.apply(this, args);
      sync();
      const failures = selfTest();
      if (failures.length) throw new Error(`RHW COMMAND COMPACT SELF TEST FAILED: ${failures.join(', ')}`);
      return result;
    };
  }
  if (typeof base.commandActivate === 'function') {
    app.command.activate = function compactCommandActivate(node, options) {
      const result = base.commandActivate.call(this, node, options);
      requestAnimationFrame(sync);
      return result;
    };
  }

  app.commandCompactPolish = {
    installStyles,
    mountInventoryNav,
    installAttentionToggle,
    syncAlerts,
    syncAttentionState,
    closeAlerts,
    selfTest
  };
})();
