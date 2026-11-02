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
  function control(recipeId) {
    const row = app.personnel.analyze().rows.find(row => app.personnel.options(row).some(r => r.id === recipeId));
    if (!row) return '';
    if (row.fixed) return '<span class="production-plan-fixed" title="Always included in your manual forecast">ALWAYS PLANNED</span>';
    const selected = row.enabled && !row.followHull && row.recipeId === recipeId;
    return `<button type="button" class="production-plan-button${selected ? ' is-planned' : ''}" data-production-plan="${esc(recipeId)}" aria-pressed="${selected}" aria-label="Plan ${esc(coreName(recipeId))}"><span aria-hidden="true">◷</span> ${selected ? 'PLANNED' : 'PLAN'}</button>`;
  }
  function coreName(id) { return app.operationsCore.recipe(id)?.name || id; }
  function details(row, plan) {
    if (!row) return '';
    const blockers = plan.ready ? row.reasons?.join(' · ') : `Unknown: ${plan.unknown.join(', ')}`;
    const orders = plan.rows.map(r => `<li><span>${esc(r.name)}</span><strong>${plan.truncated ? '≥' : ''}${range(r.min, r.max)} · ${range(r.secondsMin, r.secondsMax, duration)}</strong></li>`).join('');
    return `<details class="production-plan-details" data-plan-detail="${esc(row.recipeId)}" ${expanded.has(row.recipeId) ? 'open' : ''}>
      <summary><span>${esc(plan.ready ? (row.max > 0 ? 'LIMITED BY' : 'BLOCKED') : 'PLAN UNVERIFIED')} · ${esc(blockers || 'Production materials')}</span><span aria-hidden="true">⌄</span></summary>
      <div class="production-plan-explanation"><p>MANUAL PLAN · ${esc(plan.snapshot.label)} · New cycles from this snapshot.</p>
        <p>~${duration(row.seconds)} per cycle · ${fmt(row.output)} items per complete batch.</p>
        <ul>${orders}</ul>
        <p>One shared inventory. Finished refinery batches and byproducts can supply other modules. Ranges allow different priorities for scarce stock.</p>
        <p>Planning estimate with MOX timing. New cycles reserve inputs at start. No deliveries, trades, upkeep or existing job progress are assumed.</p>
        ${plan.conditions.length ? `<p class="production-plan-caution">Conditional: ${esc(plan.conditions.join(' · '))}.</p>` : ''}
        ${plan.truncated ? '<p class="production-plan-caution">Forecast limited to 30 days / simulation budget. Counts are lower bounds, not final capacity.</p>' : ''}
      </div></details>`;
  }
  function card(recipeId, plan) {
    const row = model.rowFor(recipeId, plan);
    let cycle = row?.seconds;
    if (!cycle) { try { cycle = model.batch({ key: 'preview', recipe: app.operationsCore.recipe(recipeId) })?.seconds; } catch {} }
    return { selected: Boolean(row), control: control(recipeId),
      count: row ? `${plan.truncated ? '≥' : ''}${range(row.min, row.max)}` : null,
      time: row && plan.ready ? `~${range(row.secondsMin, row.secondsMax, duration)}` : 'TIME UNKNOWN',
      cycle: cycle ? duration(cycle) : '', details: details(row, plan) };
  }
  function hullMarkup() {
    const row = app.personnel.analyze().rows.find(r => r.key === 'shipyard');
    const selected = row.enabled && row.followHull;
    const plan = model.analyze(), result = selected ? model.rowFor(row.recipeId, plan) : null;
    return `<div class="production-hull-plan"><button type="button" class="production-plan-button${selected ? ' is-planned' : ''}" data-production-hull-plan aria-pressed="${selected}"><span aria-hidden="true">◷</span> ${selected ? 'SHIP PLANNED' : 'PLAN SHIP'}</button>
      ${result ? `<span>PLANNED YIELD <strong>${plan.truncated ? '≥' : ''}${range(result.min, result.max)}</strong> · ~${range(result.secondsMin, result.secondsMax, duration)}</span>${details(result, plan)}` : '<small>Replaces Supers / Reactors in the shared plan.</small>'}</div>`;
  }
  function bind() {
    for (const id of ['productionGrid', 'shipyardControl']) {
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
      mount.addEventListener('toggle', event => {
        const id = event.target.dataset?.planDetail;
        if (!id) return;
        if (event.target.open) expanded.add(id); else expanded.delete(id);
      }, true);
    }
  }
  app.productionPlanView = { card, hullMarkup, duration };
  app.lifecycle.on('command:ready', 'inline-production-plan', 70, bind);
})();
