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
    style.textContent = `
      .rhw-logistics-view-nav{
        display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;
        width:100%;margin:0 0 10px;padding:6px;border:1px solid rgba(125,167,234,.24);
        border-radius:8px;background:linear-gradient(90deg,rgba(125,167,234,.075),rgba(5,8,12,.96) 48%);
        box-shadow:0 10px 24px rgba(0,0,0,.24)
      }
      .rhw-logistics-view-nav button{
        position:relative;min-width:0;min-height:52px;padding:8px 11px;border:1px solid rgba(125,167,234,.13);
        border-radius:5px;background:rgba(125,167,234,.025);color:rgba(190,208,235,.68);
        font-family:var(--font-tech);font-size:11px;font-weight:700;letter-spacing:.04em;text-align:center;
        clip-path:none;box-shadow:none
      }
      .rhw-logistics-view-nav button small{display:block;margin-top:2px;color:rgba(159,180,212,.48);font-size:9px;letter-spacing:.04em}
      .rhw-logistics-view-nav button:hover,.rhw-logistics-view-nav button:focus-visible{
        border-color:rgba(125,167,234,.38);background:rgba(125,167,234,.09);color:#dce8fb
      }
      .rhw-logistics-view-nav button[aria-selected="true"]{
        border-color:rgba(125,167,234,.48);background:linear-gradient(180deg,rgba(125,167,234,.17),rgba(125,167,234,.045));
        color:#dce8fb;box-shadow:inset 0 -2px 0 #7da7ea,inset 0 0 20px rgba(125,167,234,.045)
      }
      .rhw-logistics-view-nav button[aria-selected="true"] small{color:rgba(190,208,235,.72)}

      body[data-workspace="command"][data-command-node="logistics"] #commandContextAction{display:none!important}
      body[data-workspace="command"][data-command-node="logistics"] #commandControlDeck{grid-template-columns:minmax(260px,1.45fr) auto}

      body[data-workspace="command"][data-command-node="logistics"] #externalLogisticsPanel{display:none!important}
      body[data-workspace="command"][data-command-node="logistics"][data-logistics-view="market"] [data-command-panel="logistics"]>#materialsScanSection{
        display:none!important
      }
      body[data-workspace="command"][data-command-node="logistics"][data-logistics-view="materials"] [data-command-panel="logistics"]>#marketScanSection{
        display:none!important
      }

      @media(max-width:980px){
        body[data-workspace="command"][data-command-node="logistics"] #commandControlDeck{grid-template-columns:minmax(0,1fr) auto}
      }
      @media(max-width:760px){
        body[data-workspace="command"][data-command-node="logistics"] #commandControlDeck{grid-template-columns:1fr}
        .rhw-logistics-view-nav{
          position:relative;z-index:74;
          width:calc(100% - 18px);margin:0 9px 10px;padding:5px;background:rgba(5,8,12,.98);
          box-shadow:0 10px 28px rgba(0,0,0,.42)
        }
        .rhw-logistics-view-nav button{min-height:48px;padding:7px 6px;font-size:10px}
        .rhw-logistics-view-nav button small{font-size:8px}
        [data-command-panel="logistics"]{
          /* End-of-panel scroll reserve: invisible in normal use, but enough for
             the no-telemetry Market controls to clear the fixed bottom dock. */
          padding-bottom:180px!important
        }
      }
    `;
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
      const dock = document.querySelector('.app-tabs');
      const section = document.getElementById(document.body.dataset.logisticsView === 'materials' ? 'materialsScanSection' : 'marketScanSection');
      const price = section?.querySelector('[data-market-sort="price"]');
      const stock = section?.querySelector('[data-market-sort="stock"]');
      let delta = 0;
      if (dock && price && stock) {
        const dockTop = dock.getBoundingClientRect().top;
        const sortBottom = Math.max(price.getBoundingClientRect().bottom, stock.getBoundingClientRect().bottom);
        const clearance = 12;
        delta = Math.max(0, sortBottom - (dockTop - clearance));
        if (delta > 2) {
          const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
          root.scrollTop = Math.min(maxScroll, root.scrollTop + delta);
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
