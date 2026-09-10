/* ==========================================================================
   RHW STABILITY POLISH
   Makes LOGISTICS immediately discoverable on phones and adds a durable
   SHIP COMPONENTS / INDUSTRIAL MATERIALS view switch.
   ========================================================================== */
(function initRhwStabilityPolish() {
  'use strict';
  const app = window.RHWV4;
  if (!app?.command || app.stabilityPolish) return;

  const base = {
    commandInit: app.command.init,
    commandActivate: app.command.activate
  };

  function installStyles() {
    if (document.getElementById('rhwStabilityPolishStyle')) return;
    const style = document.createElement('style');
    style.id = 'rhwStabilityPolishStyle';
    style.dataset.stylesheet = '35-app-interface-cleanup.css';
    document.head.appendChild(style);
  }

  function setLogisticsView(view = 'market') {
    const safe = view === 'materials' ? 'materials' : 'market';
    document.body.dataset.logisticsView = safe;
    document.querySelectorAll('#rhwLogisticsViewNav [data-logistics-view]').forEach(button => {
      const active = button.dataset.logisticsView === safe;
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    });
    document.getElementById('marketScanSection')?.setAttribute('aria-hidden', safe === 'market' ? 'false' : 'true');
    document.getElementById('materialsScanSection')?.setAttribute('aria-hidden', safe === 'materials' ? 'false' : 'true');
    return safe;
  }

  function disableLegacyCommandAutoScroll() {
    const nav = document.getElementById('commandNodeNav');
    if (!nav?.classList.contains('command-module-nav')) return false;
    nav.querySelectorAll('[data-command-node]').forEach(button => {
      if (button.dataset.rhwLegacyScrollDisabled === 'true') return;
      button.dataset.rhwLegacyScrollDisabled = 'true';
      /* The legacy V4 tab bar scrolled its active button into view. COMMAND is
         now a fully visible 2x2 grid on phones, so that scheduled scroll only
         moves the page and fights the real Logistics tool positioning. */
      button.scrollIntoView = () => {};
    });
    return true;
  }

  function ensureLogisticsSwitcher() {
    disableLegacyCommandAutoScroll();
    app.uiPolish?.restoreMarketScan?.();
    const panel = document.querySelector('[data-command-panel="logistics"]');
    const market = document.getElementById('marketScanSection');
    const materials = document.getElementById('materialsScanSection');
    const legacy = document.getElementById('externalLogisticsPanel');
    if (!panel || !market || !materials || !legacy) return false;

    [market, materials].forEach(surface => {
      surface.hidden = false;
      surface.removeAttribute('hidden');
      surface.style.removeProperty('display');
      surface.style.removeProperty('visibility');
      surface.style.removeProperty('opacity');
    });
    materials.classList.add('rhw-market-scan-surface');
    market.setAttribute('role', 'tabpanel');
    market.setAttribute('aria-labelledby', 'logisticsShipsTab');
    materials.setAttribute('role', 'tabpanel');
    materials.setAttribute('aria-labelledby', 'logisticsMaterialsTab');
    legacy.setAttribute('aria-hidden', 'true');

    let nav = document.getElementById('rhwLogisticsViewNav');
    if (!nav) {
      nav = document.createElement('nav');
      nav.id = 'rhwLogisticsViewNav';
      nav.className = 'rhw-logistics-view-nav';
      nav.setAttribute('role', 'tablist');
      nav.setAttribute('aria-label', 'Logistics views');
      nav.innerHTML = `
        <button type="button" role="tab" id="logisticsShipsTab" data-logistics-view="market" aria-controls="marketScanSection">
          SHIP COMPONENTS<small>ALL KNOWN POBS</small>
        </button>
        <button type="button" role="tab" id="logisticsMaterialsTab" data-logistics-view="materials" aria-controls="materialsScanSection">
          INDUSTRIAL MATERIALS<small>ALL KNOWN POBS</small>
        </button>`;
      nav.addEventListener('click', event => {
        const button = event.target.closest('[data-logistics-view]');
        if (button) {
          setLogisticsView(button.dataset.logisticsView);
          revealLogistics();
        }
      });
      nav.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...nav.querySelectorAll('[data-logistics-view]')];
        const current = buttons.indexOf(document.activeElement);
        if (current < 0) return;
        event.preventDefault();
        let next = current;
        if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = buttons.length - 1;
        else next = (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus();
        buttons[next].click();
      });
    }

    panel.insertBefore(nav, market);
    if (market.nextElementSibling !== materials) market.insertAdjacentElement('afterend', materials);
    if (materials.nextElementSibling !== legacy) materials.insertAdjacentElement('afterend', legacy);

    setLogisticsView(document.body.dataset.logisticsView || 'market');
    return true;
  }

  function revealLogistics() {
    if (window.innerWidth > 760) return;
    const started = performance.now();
    const settleMs = 850;
    let runs = 0;

    const align = now => {
      if (document.body.dataset.workspace !== 'command' || document.body.dataset.commandNode !== 'logistics') return;
      runs += 1;
      const root = document.scrollingElement || document.documentElement;
      const primary = document.getElementById('rhwAppNav');
      const nav = document.getElementById('rhwLogisticsViewNav');
      const section = document.getElementById(document.body.dataset.logisticsView === 'materials' ? 'materialsScanSection' : 'marketScanSection');
      const price = section?.querySelector('[data-market-sort="price"]');
      const stock = section?.querySelector('[data-market-sort="stock"]');
      let delta = 0;
      if (primary && nav && price && stock) {
        const visibleTop = primary.getBoundingClientRect().height + 12;
        const visibleBottom = window.innerHeight - 12;
        const navTop = nav.getBoundingClientRect().top;
        const sortBottom = Math.max(price.getBoundingClientRect().bottom, stock.getBoundingClientRect().bottom);
        // Keep the view switch below the sticky top row and sorting inside
        // the viewport. If the screen is short, prioritize the view switch.
        if (navTop < visibleTop) delta = navTop - visibleTop;
        else if (sortBottom > visibleBottom) delta = Math.min(sortBottom - visibleBottom, navTop - visibleTop);
        if (Math.abs(delta) > 2) {
          const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
          root.scrollTop = Math.max(0, Math.min(maxScroll, root.scrollTop + delta));
        }
      }
      document.documentElement.dataset.rhwLogisticsRevealRuns = String(runs);
      document.documentElement.dataset.rhwLogisticsRevealDelta = String(Math.round(delta));
      document.documentElement.dataset.rhwLogisticsRevealScroll = String(Math.round(root.scrollTop));
      if (now - started < settleMs) requestAnimationFrame(align);
    };

    requestAnimationFrame(align);
  }

  function selfTest() {
    const failures = [];
    const panel = document.querySelector('[data-command-panel="logistics"]');
    const nav = document.getElementById('rhwLogisticsViewNav');
    const market = document.getElementById('marketScanSection');
    const materials = document.getElementById('materialsScanSection');
    const legacy = document.getElementById('externalLogisticsPanel');
    const commandButtons = [...document.querySelectorAll('#commandNodeNav [data-command-node]')];
    if (!document.getElementById('rhwStabilityPolishStyle')) failures.push('style');
    if (!panel || !nav || nav.parentElement !== panel || nav.nextElementSibling !== market) failures.push('logistics-nav-order');
    if (market?.nextElementSibling !== materials || materials?.nextElementSibling !== legacy) failures.push('logistics-surface-order');
    if (nav?.querySelectorAll('[data-logistics-view]').length !== 2) failures.push('logistics-tabs');
    if (!market || !materials || !materials.classList.contains('rhw-market-scan-surface')) failures.push('logistics-surfaces');
    if (!commandButtons.length || commandButtons.some(button => button.dataset.rhwLegacyScrollDisabled !== 'true')) failures.push('legacy-command-scroll');
    if (typeof setLogisticsView !== 'function') failures.push('logistics-view-api');
    return failures;
  }

  installStyles();

  if (typeof base.commandInit === 'function') {
    app.command.init = function stabilityCommandInit(...args) {
      const result = base.commandInit.apply(this, args);
      if (!ensureLogisticsSwitcher()) throw new Error('RHW STABILITY COULD NOT MOUNT LOGISTICS VIEWS');
      const failures = selfTest();
      if (failures.length) throw new Error(`RHW STABILITY SELF TEST FAILED: ${failures.join(', ')}`);
      return result;
    };
  }

  if (typeof base.commandActivate === 'function') {
    app.command.activate = function stabilityCommandActivate(node, options) {
      disableLegacyCommandAutoScroll();
      const previous = app.state.commandNode;
      const result = base.commandActivate.call(this, node, options);
      if (node === 'logistics') {
        requestAnimationFrame(() => {
          ensureLogisticsSwitcher();
          if (previous !== 'logistics') setLogisticsView('market');
          revealLogistics();
        });
      }
      return result;
    };
  }

  app.stabilityPolish = {
    ensureLogisticsSwitcher,
    setLogisticsView,
    revealLogistics,
    disableLegacyCommandAutoScroll,
    selfTest
  };
})();
