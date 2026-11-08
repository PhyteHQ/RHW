/* One shared forecast overview; cards show one clearly labelled output. */
(function initInlineProductionPlan() {
  'use strict';
  const app = window.RHWV4, model = app?.productionPlan;
  if (!model) return;
  const esc = app.util.escape, fmt = app.util.number, expanded = new Set();
  function duration(seconds) {
    if (!Number.isFinite(seconds)) return '—';
    const mins = Math.ceil(seconds / 60);
    return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  }
  function range(low, high, formatter = fmt) {
    if (!Number.isFinite(low)) return '—';
    return low === high ? formatter(low) : `${formatter(low)}–${formatter(high)}`;
  }
  function coreName(id) {
    const module = typeof PRODUCTION_MODULES !== 'undefined' ? PRODUCTION_MODULES.find(entry => entry.recipeId === id) : null;
    return module?.product || app.operationsCore.recipe(id)?.name || id;
  }
  function control(recipeId) {
    const row = app.productionScenario.analyze().rows.find(row => app.productionScenario.options(row).some(r => r.id === recipeId));
    if (!row) return '';
    if (row.fixed) return '<span class="production-plan-button production-plan-fixed is-planned" title="Always included in the production plan">ALWAYS ON</span>';
    const selected = row.enabled && !row.followHull && row.recipeId === recipeId;
    return `<button type="button" class="production-plan-button${selected ? ' is-planned' : ''}" data-production-plan="${esc(recipeId)}" aria-pressed="${selected}" aria-label="${selected ? 'Remove' : 'Plan'} ${esc(coreName(recipeId))}${selected ? ' from forecast' : ''}" title="${selected ? 'Click again to remove from your plan' : 'Add to your manual plan'}">${selected ? 'PLANNED' : 'PLAN'}</button>`;
  }
  function connections(plan) {
    const links = [];
    for (const consumer of plan.jobs || []) for (const group of consumer.inputs) {
      for (const producer of plan.jobs || []) {
        if (producer.key === consumer.key) continue;
        for (const [index, output] of producer.outputs.entries()) if (group.ids.includes(output.id)) {
          links.push({ producer: producer.name, producerId: producer.recipeId, consumer: consumer.name,
            consumerId: consumer.recipeId, material: output.name, inputNames: group.names,
            byproduct: index > 0 });
        }
      }
    }
    return links;
  }
  function supplyMarkup(name, recipeId, plan) {
    const sources = connections(plan).filter(link => link.consumerId === recipeId && link.inputNames.includes(name));
    return sources.map(link => `<span class="recipe-internal-supply" title="Planned supply becomes available only after a complete batch. See the shared production plan.">Planned supply · ${esc(link.producer)}${link.byproduct ? ' byproduct' : ''}</span>`).join('');
  }
  function output(row, plan) { return `${plan.truncated ? '≥' : ''}${range(row?.min, row?.max)}`; }
  function runtime(row) { return Number.isFinite(row?.secondsMin) ? `~${range(row.secondsMin, row.secondsMax, duration)}` : 'TIME UNKNOWN'; }
  function overviewBody(plan) {
    const results = (plan.rows || []).map(row => `<li>
      <span class="production-plan-product">${esc(row.name)}</span>
      <span class="production-plan-result"><strong>${plan.ready ? output(row, plan) : '—'}</strong><small>${plan.ready ? runtime(row) : 'FORECAST UNVERIFIED'}</small></span>
      <span class="production-plan-stop">${plan.ready ? `Limit · ${esc(row.reasons?.join(' · ') || 'Production materials')}` : 'Shared input stock is incomplete'}</span>
    </li>`).join('');
    const links = connections(plan);
    return `<div class="production-plan-explanation">
      <p>One shared inventory. These are <strong>new products</strong> from the displayed stock, beyond the items already in storage.</p>
      ${!plan.ready ? `<p class="production-plan-caution">Shared forecast unavailable: ${esc((plan.unknown || []).join(' · '))}. Cards show standalone estimates only; those ignore competition and incoming production.</p>` : ''}
      ${results ? `<ul class="production-plan-results" aria-label="Shared plan output and limits">${results}</ul>` : ''}
      ${links.length ? `<div class="production-plan-supply"><h3>INTERNAL SUPPLY</h3><ul>${links.map(link => `<li><strong>${esc(link.material)}</strong><span>${esc(link.producer)} <span aria-hidden="true">→</span><span class="visually-hidden"> supplies </span> ${esc(link.consumer)}${link.byproduct ? ' · byproduct' : ''}</span></li>`).join('')}</ul><p>Planned links depend on completed batches; an empty feedstock or a full output store can stop supply.</p></div>` : ''}
      <p>New cycles start from this snapshot. Completed batches and byproducts can supply other planned modules. Ranges reflect different priorities for scarce stock.</p>
      ${plan.conditions?.length ? `<p class="production-plan-caution">Conditional estimate: ${esc(plan.conditions.join(' · '))}.</p>` : ''}
      ${plan.truncated ? '<p class="production-plan-caution">Forecast capped at 30 days / simulation budget. Counts are lower bounds, not final capacity.</p>' : ''}
      <p class="production-plan-assumptions">MOX reference timing · No future deliveries, trades, upkeep or existing job progress assumed.</p>
    </div>`;
  }
  function overviewMarkup(plan) {
    const rows = plan.rows || [], id = 'productionPlanOverview';
    const status = !plan.ready ? 'UNVERIFIED' : plan.truncated ? 'CAPPED ESTIMATE' : plan.conditions?.length ? 'CONDITIONAL ESTIMATE' : 'PLANNING ESTIMATE';
    const label = rows.length ? rows.map(row => row.name).join(' · ') : 'Awaiting verified inventory and recipes';
    return `<details id="${id}" class="production-plan-overview" data-plan-detail="${id}" ${expanded.has(id) ? 'open' : ''}>
      <summary><span class="production-plan-heading"><strong>SHARED PRODUCTION PLAN</strong><small>${esc(label)}</small></span><span class="production-plan-overview-state"><span>${esc(status)}</span><small>${esc(plan.snapshot.label || 'STOCK UNKNOWN')}</small></span><span class="production-plan-chevron" aria-hidden="true">⌄</span></summary>
      ${overviewBody(plan)}</details>`;
  }
  function renderOverview(plan = model.analyze()) {
    const grid = document.getElementById('productionGrid');
    if (!grid) return;
    let mount = document.getElementById('productionPlanSummary');
    if (!mount) {
      mount = document.createElement('div'); mount.id = 'productionPlanSummary';
      grid.insertAdjacentElement('beforebegin', mount);
    }
    const previous = mount.querySelector('[data-plan-detail]');
    if (previous) remember(previous);
    const focused = previous?.querySelector('summary') === document.activeElement;
    mount.innerHTML = overviewMarkup(plan);
    if (focused) mount.querySelector('summary')?.focus({ preventScroll: true });
    bind();
  }
  function card(recipeId, plan, analysis) {
    const row = model.rowFor(recipeId, plan), shared = Boolean(row && plan.ready);
    let cycle = row?.seconds;
    if (!cycle) { try { cycle = model.batch({ key: 'preview', recipe: app.operationsCore.recipe(recipeId) })?.seconds; } catch {} }
    const soloTime = Number.isFinite(cycle) && Number.isFinite(analysis?.possibleCycles)
      ? `~${duration(cycle * analysis.possibleCycles)}` : 'TIME UNKNOWN';
    return { selected: Boolean(row), control: control(recipeId),
      count: shared ? output(row, plan) : range(analysis?.possibleOutput, analysis?.possibleOutput),
      time: shared ? runtime(row) : soloTime,
      mode: shared ? 'shared' : 'solo',
      yieldLabel: shared ? 'NEW OUTPUT · SHARED PLAN' : 'NEW OUTPUT · SOLO ESTIMATE',
      modeLabel: shared ? plan.conditions?.length ? 'CONDITIONAL ESTIMATE' : 'WITH ACTIVE PLAN' : row ? 'PLAN UNVERIFIED · SOLO ONLY' : 'NOT IN SHARED PLAN',
      limitLabel: shared ? 'PLAN LIMIT' : 'SOLO LIMIT',
      limit: shared ? row.reasons?.join(' · ') : analysis?.bottleneck?.displayName || 'Input stock unknown',
      cycle: cycle ? duration(cycle) : '', soloTime };
  }
  function hullMarkup(context = 'shipyard') {
    const row = app.productionScenario.analyze().rows.find(r => r.key === 'shipyard');
    const plannedHull = row.enabled ? CAPITAL_SHIPYARD.hulls.find(hull => hull.recipeId === row.recipeId) : null;
    const selected = Boolean(plannedHull && row.recipeId === app.shipyard.selectedHull().recipeId);
    const plan = model.analyze(), result = plannedHull ? model.rowFor(row.recipeId, plan) : null;
    const solo = result && !plan.ready ? app.shipyard.analyze(plannedHull).buildable : null;
    const count = plan.ready ? output(result, plan) : range(solo, solo);
    const time = plan.ready ? runtime(result) : Number.isFinite(solo) && Number.isFinite(result?.seconds) ? `~${duration(solo * result.seconds)}` : 'TIME UNKNOWN';
    const detailId = 'production-plan-shipyard';
    return `<div class="production-hull-plan"><button type="button" class="production-plan-button${selected ? ' is-planned' : ''}" data-production-hull-plan aria-pressed="${selected}" title="${selected ? 'Click again to remove shipbuilding from your plan' : 'Plan this ship instead of Supers / Reactors'}">${selected ? 'SHIP PLANNED' : 'PLAN SHIP'}</button>
      ${plannedHull && !selected ? `<small class="production-pinned-hull">PLANNED HULL · <strong>${esc(plannedHull.label)}</strong> · PLAN SHIP replaces this plan.</small>` : ''}
      ${result && context === 'production' ? `<small>Planned · <strong>${esc(plannedHull.label)}</strong> · Forecast in the shared plan below.</small>`
        : result ? `<span>${plan.ready ? 'NEW OUTPUT · SHARED PLAN' : 'SOLO ESTIMATE'} <strong>${count}</strong> · ${time}</span><details id="${detailId}" class="production-plan-details" data-plan-detail="${detailId}" ${expanded.has(detailId) ? 'open' : ''}><summary>SHARED PLAN DETAILS <span aria-hidden="true">⌄</span></summary>${overviewBody(plan)}</details>`
          : '<small>Uses the Shipyard module instead of Supers / Reactors.</small>'}</div>`;
  }
  function renderShipControl() {
    const toolbar = document.getElementById('productionModuleTools');
    if (!toolbar || !app.shipyard || !app.operationsCore.state.catalog) return;
    let mount = document.getElementById('productionShipPlan');
    if (!mount) {
      mount = document.createElement('div'); mount.id = 'productionShipPlan';
      mount.className = 'production-ship-plan'; toolbar.append(mount);
    }
    const focused = document.activeElement?.id === 'productionPlanHull';
    const hull = app.shipyard.selectedHull();
    const options = CAPITAL_SHIPYARD.divisions.map(division => `<optgroup label="${esc(division.label)}">${CAPITAL_SHIPYARD.hulls.filter(h => h.division === division.key).map(h => `<option value="${esc(h.key)}" ${h.key === hull.key ? 'selected' : ''}>${esc(h.label)}</option>`).join('')}</optgroup>`).join('');
    mount.innerHTML = `<label class="production-hull-selector" for="productionPlanHull"><span>SHIPBUILDING</span><select id="productionPlanHull">${options}</select></label>${hullMarkup('production')}`;
    if (focused) mount.querySelector('select')?.focus({ preventScroll: true });
    bind();
  }
  function bind() {
    for (const id of ['productionGrid', 'shipyardControl', 'productionShipPlan', 'productionPlanSummary']) {
      const mount = document.getElementById(id);
      if (!mount || mount.dataset.productionPlanBound) continue;
      mount.dataset.productionPlanBound = 'true';
      mount.addEventListener('click', event => {
        const button = event.target.closest('[data-production-plan], [data-production-hull-plan]');
        if (!button) return;
        const selector = button.hasAttribute('data-production-hull-plan') ? '[data-production-hull-plan]' : `[data-production-plan="${button.dataset.productionPlan}"]`;
        const success = button.hasAttribute('data-production-hull-plan') ? model.selectHull() : model.select(button.dataset.productionPlan);
        if (success) mount.querySelector(selector)?.focus({ preventScroll: true });
      });
      mount.addEventListener('change', event => {
        if (event.target.id === 'productionPlanHull') app.shipyard.selectHull(event.target.value);
      });
      mount.addEventListener('toggle', event => {
        if (event.target.dataset?.planDetail) remember(event.target);
      }, true);
    }
  }
  function remember(detail) {
    if (detail.open) expanded.add(detail.dataset.planDetail); else expanded.delete(detail.dataset.planDetail);
  }
  app.productionPlanView = { card, hullMarkup, duration, connections, supplyMarkup, overviewMarkup, renderOverview, renderShipControl };
  app.lifecycle.on('command:ready', 'inline-production-plan', 70, bind);
})();
