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
  function detailId(recipeId, context = 'card') { return `production-plan-${context}-${recipeId}`; }
  function control(recipeId) {
    const row = app.personnel.analyze().rows.find(row => app.personnel.options(row).some(r => r.id === recipeId));
    if (!row) return '';
    if (row.fixed) {
      const id = detailId(recipeId);
      return `<button type="button" class="production-plan-button production-plan-fixed is-planned" data-production-details="${esc(id)}" aria-controls="${esc(id)}" aria-expanded="${expanded.has(id)}" aria-label="Forecast details for ${esc(coreName(recipeId))}. Always included in your plan." title="Always included · Show forecast details"><span aria-hidden="true">◷</span> ALWAYS ON <span aria-hidden="true">⌄</span></button>`;
    }
    const selected = row.enabled && !row.followHull && row.recipeId === recipeId;
    return `<button type="button" class="production-plan-button${selected ? ' is-planned' : ''}" data-production-plan="${esc(recipeId)}" aria-pressed="${selected}" aria-label="${selected ? 'Remove' : 'Plan'} ${esc(coreName(recipeId))}${selected ? ' from forecast' : ''}" title="${selected ? 'Click again to remove from your plan' : 'Add to your manual plan'}"><span aria-hidden="true">◷</span> ${selected ? 'PLANNED' : 'PLAN'}</button>`;
  }
  function coreName(id) {
    const module = typeof PRODUCTION_MODULES !== 'undefined' ? PRODUCTION_MODULES.find(entry => entry.recipeId === id) : null;
    return module?.product || app.operationsCore.recipe(id)?.name || id;
  }
  function details(row, plan, context = 'card') {
    if (!row) return '';
    const id = detailId(row.recipeId, context);
    const blockers = plan.ready ? row.reasons?.join(' · ') : `Unknown: ${plan.unknown.join(', ')}`;
    const orders = plan.rows.map(r => `<li><span>${esc(r.name)}</span><strong>${plan.truncated ? '≥' : ''}${range(r.min, r.max)} · ${range(r.secondsMin, r.secondsMax, duration)}</strong></li>`).join('');
    return `<details id="${esc(id)}" class="production-plan-details" data-plan-detail="${esc(id)}" ${expanded.has(id) ? 'open' : ''}>
      <summary><span>${esc(plan.ready ? (row.max > 0 ? 'LIMITED BY' : 'BLOCKED') : 'PLAN UNVERIFIED')} · ${esc(blockers || 'Production materials')}</span><span aria-hidden="true">⌄</span></summary>
      <div class="production-plan-explanation"><p>MANUAL PLAN · ${esc(plan.snapshot.label)} · New cycles from this snapshot.</p>
        <p>~${duration(row.seconds)} per cycle · ${fmt(row.output)} items per complete batch.</p>
        ${!plan.ready ? `<p class="production-plan-caution">Shared forecast unavailable: ${esc(plan.unknown.join(', '))}. SOLO YIELD shows this module's material coverage alone, without competition or new supplies from other modules.</p>` : ''}
        <ul>${orders}</ul>
        <p>One shared inventory. Finished refinery batches and byproducts can supply other modules. Ranges allow different priorities for scarce stock.</p>
        <p>Planning estimate with MOX timing. New cycles reserve inputs at start. No deliveries, trades, upkeep or existing job progress are assumed.</p>
        ${plan.conditions.length ? `<p class="production-plan-caution">Conditional: ${esc(plan.conditions.join(' · '))}.</p>` : ''}
        ${plan.truncated ? '<p class="production-plan-caution">Forecast limited to 30 days / simulation budget. Counts are lower bounds, not final capacity.</p>' : ''}
      </div></details>`;
  }
  function card(recipeId, plan, analysis) {
    const row = model.rowFor(recipeId, plan);
    const shared = Boolean(row && plan.ready);
    let cycle = row?.seconds;
    if (!cycle) { try { cycle = model.batch({ key: 'preview', recipe: app.operationsCore.recipe(recipeId) })?.seconds; } catch {} }
    return { selected: Boolean(row), control: control(recipeId),
      count: shared ? `${plan.truncated ? '≥' : ''}${range(row.min, row.max)}` : range(analysis?.possibleOutput, analysis?.possibleOutput),
      time: shared ? `~${range(row.secondsMin, row.secondsMax, duration)}`
        : Number.isFinite(cycle) && Number.isFinite(analysis?.possibleCycles) ? `~${duration(cycle * analysis.possibleCycles)}` : 'TIME UNKNOWN',
      mode: shared ? 'shared' : 'solo',
      yieldLabel: shared ? 'PLANNED YIELD' : row ? 'SOLO YIELD' : 'EST. YIELD',
      modeLabel: shared ? plan.conditions.length ? 'CONDITIONAL' : 'MANUAL PLAN' : 'SOLO ESTIMATE',
      cycle: cycle ? duration(cycle) : '', details: details(row, plan) };
  }
  function hullMarkup(context = 'shipyard') {
    const row = app.personnel.analyze().rows.find(r => r.key === 'shipyard');
    const plannedHull = row.enabled ? CAPITAL_SHIPYARD.hulls.find(hull => hull.recipeId === row.recipeId) : null;
    const selected = Boolean(plannedHull && row.recipeId === app.shipyard.selectedHull().recipeId);
    const plan = model.analyze(), result = plannedHull ? model.rowFor(row.recipeId, plan) : null;
    const solo = result && !plan.ready ? app.shipyard.analyze(plannedHull).buildable : null;
    const count = plan.ready ? range(result?.min, result?.max) : range(solo, solo);
    const time = plan.ready ? range(result?.secondsMin, result?.secondsMax, duration)
      : Number.isFinite(solo) && Number.isFinite(result?.seconds) ? duration(solo * result.seconds) : 'TIME UNKNOWN';
    return `<div class="production-hull-plan"><button type="button" class="production-plan-button${selected ? ' is-planned' : ''}" data-production-hull-plan aria-pressed="${selected}" title="${selected ? 'Click again to remove shipbuilding from your plan' : 'Plan this ship instead of Supers / Reactors'}"><span aria-hidden="true">◷</span> ${selected ? 'SHIP PLANNED' : 'PLAN SHIP'}</button>
      ${plannedHull && !selected ? `<small class="production-pinned-hull">PLANNED HULL · <strong>${esc(plannedHull.label)}</strong> · PLAN SHIP replaces this plan.</small>` : ''}
      ${result ? `<span>${plan.ready ? 'PLANNED YIELD' : 'SOLO YIELD'} <strong>${plan.truncated ? '≥' : ''}${count}</strong> · ~${time}${!plan.ready ? ' · SOLO ESTIMATE' : ''}</span>${details(result, plan, context)}` : '<small>Shares the Shipyard module with Supers / Reactors.</small>'}</div>`;
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
    for (const id of ['productionGrid', 'shipyardControl', 'productionShipPlan']) {
      const mount = document.getElementById(id);
      if (!mount || mount.dataset.productionPlanBound) continue;
      mount.dataset.productionPlanBound = 'true';
      mount.addEventListener('click', event => {
        const toggle = event.target.closest('[data-production-details]');
        if (toggle) {
          const detail = document.getElementById(toggle.dataset.productionDetails);
          if (detail) { detail.open = !detail.open; remember(detail); }
          return;
        }
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
    const id = detail.dataset.planDetail;
    if (detail.open) expanded.add(id); else expanded.delete(id);
    document.querySelector(`[data-production-details="${id}"]`)?.setAttribute('aria-expanded', String(detail.open));
  }
  app.productionPlanView = { card, hullMarkup, duration, renderShipControl };
  app.lifecycle.on('command:ready', 'inline-production-plan', 70, bind);
})();
