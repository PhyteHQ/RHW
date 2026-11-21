/* Daily POB briefing: verified supplies, material coverage and the next tasks. */
(function initPobOverview() {
  'use strict';
  const app = window.RHWV4;
  if (!app?.command || app.pobOverview) return;
  let unsubscribe;
  const esc = value => app.util.escape(value);

  function mount() {
    const status = document.getElementById('inventoryStatusPanel');
    if (!status) return;
    let briefing = document.getElementById('commandBriefing');
    if (!briefing) {
      briefing = document.createElement('section');
      briefing.id = 'commandBriefing';
      briefing.className = 'command-briefing';
      briefing.setAttribute('aria-label', 'POB at a glance');
      briefing.innerHTML = `<div class="overview-station"><div class="overview-operations" id="overviewOperations"></div></div><section class="overview-next" aria-labelledby="overviewNextTitle">
        <div class="overview-section-head"><h3 id="overviewNextTitle">Next steps</h3><span id="overviewTaskCount"></span></div>
        <div id="overviewNextActions" class="overview-next-actions"></div>
        <button type="button" id="overviewMoreTasks" aria-expanded="false" aria-controls="overviewNextActions" hidden></button>
      </section>`;
      status.prepend(briefing);
      const supplies = status.querySelector('.maintenance-panel');
      if (supplies) {
        briefing.querySelector('.overview-station').appendChild(supplies);
        supplies.querySelector('.alert-title>span').textContent = 'Facility supplies';
      }
      const controls = document.createElement('div');
      controls.id = 'overviewControlsHost';
      briefing.insertAdjacentElement('afterend', controls);
      document.getElementById('overviewMoreTasks').addEventListener('click', event => {
        const button = event.currentTarget;
        button.setAttribute('aria-expanded', String(button.getAttribute('aria-expanded') !== 'true'));
        render();
      });
      briefing.addEventListener('click', event => {
        const button = event.target.closest('[data-overview-node]');
        if (!button) return;
        app.navigate('command', button.dataset.overviewNode);
        requestAnimationFrame(() => {
          const panel = document.querySelector(`[data-command-panel="${button.dataset.overviewNode}"]`);
          panel?.scrollIntoView({ block: 'start', behavior: 'instant' });
          panel?.querySelector('button,input')?.focus({ preventScroll: true });
        });
      });
      app.workspaceUi.installAlertDeepLinks(document.getElementById('overviewNextActions'));
    }
    // Keep visual, reading and keyboard order identical at every screen width.
    // Full-width sections replace independent columns of unrelated heights.
    const stocks = status.querySelector('.summary-grid');
    if (stocks && stocks.dataset.ordered !== 'true') {
      const panels = ['reserve-panel', 'waste-panel', 'export-panel', 'ship-stock-panel'].map(name => stocks.querySelector(`.${name}`)).filter(Boolean);
      if (panels.length === 4) { stocks.replaceChildren(...panels); stocks.dataset.ordered = 'true'; }
    }
    placeControls();
  }

  function placeControls() {
    const deck = document.getElementById('commandControlDeck');
    const home = document.getElementById('overviewControlsHost');
    const nodeHost = document.getElementById('commandNodeHost');
    if (!deck || !home || !nodeHost) return;
    if (app.state.commandNode === 'inventory' && app.state.inventoryView === 'status') {
      if (deck.parentElement !== home) home.appendChild(deck);
    } else if (deck.parentElement !== nodeHost.parentElement) nodeHost.insertAdjacentElement('beforebegin', deck);
  }

  function renderOperations() {
    const snapshot = window.telemetrySnapshot();
    const known = snapshot.available;
    const production = known ? app.command.productionAnalysis() : [];
    const moduleCount = app.production?.modules?.()?.length || DASHBOARD_CONFIG.productionModules?.length || production.length;
    const covered = production.filter(entry => entry.possibleCycles !== null && entry.possibleCycles >= 1).length;
    const complete = moduleCount > 0 && production.length === moduleCount && production.every(entry => entry.possibleCycles !== null);
    const blocked = production.filter(entry => entry.possibleCycles === 0);
    const first = blocked[0] || production.find(entry => entry.cardState === 'low');
    const coverageKnown = known && complete;
    const productionValue = coverageKnown ? `${covered} / ${moduleCount} supplied` : 'Coverage unknown';
    const productionDetail = !known ? 'Waiting for stock data' : !complete ? 'Some recipes or inputs are unknown' : first
      ? `${first.recipe.product}: ${first.bottleneck?.displayName || first.bottleneck?.name || 'input needed'}`
      : 'Next batches checked separately';
    const yard = known ? app.shipyard?.analyze() : null;
    const ships = known ? app.inventoryModel?.ships() || [] : [];
    const reportedShips = ships.filter(entry => entry.stock !== null);
    const shipCount = reportedShips.reduce((sum, entry) => sum + entry.stock, 0);
    const archon = reportedShips.find(entry => entry.hull.key === 'archon');
    const yardValue = !known || !reportedShips.length ? 'Ship stock unknown' : `${app.util.number(shipCount)} in stock`;
    const yardDetail = yard?.buildable !== null && yard?.buildable !== undefined
      ? `${archon?.stock > 0 ? `${app.util.number(archon.stock)} Archon in stock · ` : ''}Material for ${app.util.number(yard.buildable)} ${yard.hull.label}`
      : 'Open hulls and requirements';
    const meter = coverageKnown ? `<span class="overview-coverage-meter" aria-hidden="true" style="--segment:${360 / moduleCount}deg;--coverage:${360 * covered / moduleCount}deg">
      <strong>${covered}<span> / ${moduleCount}</span></strong><small>Supplied</small>
    </span>` : '';
    const productionStatus = coverageKnown && blocked.length
      ? `${blocked.length} ${blocked.length === 1 ? 'module' : 'modules'} blocked`
      : coverageKnown ? 'All modules supplied' : productionValue;
    const markup = `<button type="button" class="overview-operation overview-production" data-overview-node="production" data-state="${!coverageKnown ? 'waiting' : blocked.length ? 'advisory' : 'ok'}" aria-label="Production. ${esc(productionValue)}. ${esc(productionDetail)}">
      ${meter}<span class="overview-operation-copy"><span class="overview-operation-label">Production</span><strong>${productionStatus}</strong><small>${esc(productionDetail)}</small></span><span class="overview-operation-arrow" aria-hidden="true"></span>
    </button><button type="button" class="overview-operation overview-shipyard" data-overview-node="shipyard">
      <span class="overview-operation-label">Shipyard</span><strong>${esc(yardValue)}</strong><small>${esc(yardDetail)}</small><span class="overview-operation-arrow" aria-hidden="true"></span>
    </button>`;
    const target = document.getElementById('overviewOperations');
    if (target && target.innerHTML !== markup) target.innerHTML = markup;
  }

  function render() {
    const target = document.getElementById('overviewNextActions');
    if (!target) return;
    const snapshot = window.telemetrySnapshot();
    const actions = app.command.priorityActions();
    const more = document.getElementById('overviewMoreTasks');
    const expanded = more.getAttribute('aria-expanded') === 'true';
    const shown = expanded ? actions : actions.slice(0, 3);
    const unknownStock = snapshot.available && window.operationalItems().some(item => window.firstFiniteApiStockValue(item, ['quantity', 'amount', 'stock']) === null);
    const signature = JSON.stringify({ shown, unknownStock });
    if (target.dataset.signature !== signature) {
      target.innerHTML = shown.length ? shown.map(app.command.priorityMarkup).join('')
        : `<div class="overview-clear${unknownStock ? ' overview-incomplete' : ''}"><strong>${unknownStock ? 'No known shortages' : 'Supplies and stock look good'}</strong><span>${unknownStock ? 'Some stock levels are unknown. Check the full inventory.' : 'No monitored threshold needs attention.'}</span></div>`;
      target.dataset.signature = signature;
    }
    document.getElementById('overviewTaskCount').textContent = !snapshot.available ? 'Stock unknown' : `${actions.length} ${actions.length === 1 ? 'task' : 'tasks'}`;
    more.hidden = actions.length <= 3;
    more.textContent = expanded ? 'Show fewer tasks' : `Show ${actions.length - 3} more tasks`;
    renderOperations();
    placeControls();
  }

  function install() {
    mount(); render();
    unsubscribe?.();
    unsubscribe = app.onUiUpdate(render);
  }
  app.lifecycle.on('command:ready', 'pob-overview', 60, install);
  app.lifecycle.on('command:activated', 'pob-overview', 60, () => { placeControls(); render(); });
  app.lifecycle.on('inventory:view', 'pob-overview', 60, placeControls);
  app.lifecycle.on('catalog:loaded', 'pob-overview', 65, render);
  app.pobOverview = { render, mount, placeControls };
})();
