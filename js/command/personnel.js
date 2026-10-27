/* Staffing planner on Production; its manual scenario also informs Shipyard. */
(function initRhwPersonnelView() {
  'use strict';
  const app = window.RHWV4, model = app?.personnel;
  if (!model) return;
  const esc = app.util.escape, fmt = app.util.number;
  let expanded = false;
  function render() {
    const mount = document.getElementById('personnelPlanner');
    if (!mount) return;
    expanded = mount.querySelector('details')?.open ?? expanded;
    const plan = model.analyze();
    const focused = mount.contains(document.activeElement) ? document.activeElement : null;
    const focusName = focused?.getAttribute('name');
    const metrics = plan.resources.map(r => `<span class="personnel-metric"><small>${r.name.toUpperCase()} REQUIRED</small><strong>${fmt(r.required)}</strong><small>${r.amount === null ? 'STOCK UNKNOWN' : `${fmt(r.amount)} ${r.source} · ${r.gap ? `${fmt(r.gap)} SHORT` : `${fmt(r.spare)} SPARE`}`}</small></span>`).join('');
    const rows = plan.rows.map(row => `<div class="personnel-module${row.enabled ? ' is-enabled' : ''}">
      <label class="personnel-enable"><input type="checkbox" name="personnel-${row.key}" data-personnel-module="${row.key}" ${row.enabled ? 'checked' : ''}><span>${esc(row.name)}<small>${row.enabled ? 'PLANNED' : 'OFF'}</small></span></label>
      <label class="personnel-recipe"><span class="sr-only">${esc(row.name)} recipe</span><select name="recipe-${row.key}" data-personnel-recipe="${row.key}" ${row.enabled ? '' : 'disabled'}>
        ${!row.recipe ? `<option value="${esc(row.recipeId)}" selected>RECIPE UNAVAILABLE</option>` : ''}
        ${model.options(row).map(r => `<option value="${esc(r.id)}" ${r.id === row.recipeId ? 'selected' : ''}>${esc(model.label(r))}</option>`).join('')}</select></label>
      <span class="personnel-module-need">${row.personnel ? `${fmt(row.personnel.crew)} Crew · ${fmt(row.personnel.scientists)} Scientists` : 'RECIPE DATA UNKNOWN'}</span>
    </div>`).join('');
    const inputs = plan.resources.map(r => `<label>${r.name} available <small>${r.amount === null ? 'Not reported by API' : `${r.source}: ${fmt(r.amount)}`}</small>
      <input type="number" name="stock-${r.key}" min="0" step="1" inputmode="numeric" data-personnel-stock="${r.key}" aria-label="Manual ${r.name.toLowerCase()} stock" placeholder="Use API stock" value="${model.snapshot().stock[r.key] ?? ''}"></label>`).join('');
    const markup = `<details id="personnelPlanDetails" ${expanded ? 'open' : ''}>
      <summary><span class="personnel-title"><span class="shipyard-eyebrow">RHW OPERATIONS · MANUAL PLAN</span><strong>PERSONNEL PLANNER</strong><small>Core ${plan.coreLevel} + planned production</small></span>${metrics}<span class="personnel-expand">${expanded ? 'CLOSE' : 'PLAN STAFF'} <span aria-hidden="true">${expanded ? '−' : '+'}</span></span></summary>
      <div class="personnel-body"><div class="personnel-module-list"><p>Choose the recipes you want to run together. One recipe per module.</p>
        <div class="personnel-core"><strong>Core ${plan.coreLevel}</strong><span>${fmt(plan.coreCrew)} Crew always reserved</span></div>${rows}</div>
        <aside class="personnel-stock"><h3>AVAILABLE PERSONNEL</h3><p>Enter stock when it is not reported, or leave blank to use the API.</p>${inputs}
          <p>Crew and scientists are retained. Each active recipe reserves its own staff, in addition to the core.</p>
          <p>Idle modules and cargo storage add no recipe staff. Saved selections describe your plan; active jobs are not reported by the API.</p>
        </aside></div></details>`;
    if (mount._personnelMarkup !== markup) {
      mount.innerHTML = markup;
      mount._personnelMarkup = markup;
      if (focusName) mount.querySelector(`[name="${focusName}"]`)?.focus({ preventScroll: true });
    }
    const details = mount.querySelector('details');
    if (details) details.ontoggle = () => {
      expanded = details.open;
      const control = details.querySelector('.personnel-expand');
      if (control) control.textContent = expanded ? 'CLOSE −' : 'PLAN STAFF +';
    };
  }
  function open() {
    expanded = true;
    app.navigate('command', 'production');
    const existing = document.getElementById('personnelPlanDetails');
    if (existing) existing.open = true;
    render();
    const mount = document.getElementById('personnelPlanner');
    mount?.scrollIntoView({ block: 'start', behavior: 'instant' });
    mount?.querySelector('summary')?.focus({ preventScroll: true });
  }
  function bind() {
    const mount = document.getElementById('personnelPlanner');
    if (mount && mount.dataset.bound !== 'true') {
      mount.dataset.bound = 'true';
      mount.addEventListener('change', event => {
        const target = event.target;
        if (target.dataset.personnelModule) model.setModule(target.dataset.personnelModule, { enabled: target.checked });
        if (target.dataset.personnelRecipe) model.setModule(target.dataset.personnelRecipe, { recipeId: target.value });
        if (target.dataset.personnelStock) {
          const valid = model.setStock(target.dataset.personnelStock, target.value);
          target.setCustomValidity(valid ? '' : 'Enter a whole number of zero or more.');
          if (!valid) target.reportValidity();
        }
      });
    }
    document.getElementById('shipyardControl')?.addEventListener('click', event => {
      if (event.target.closest('[data-personnel-open]')) open();
    });
    render();
  }
  app.personnelView = { render, open };
  app.lifecycle.on('command:ready', 'personnel-planner', 65, bind);
  app.lifecycle.on('catalog:loaded', 'personnel-recipes', 45, render);
  app.onUiUpdate?.(render);
  window.addEventListener('rhw:transfer-imported', event => {
    if (!event.detail?.sections?.includes('preferences')) return;
    model.restore();
    app.shipyard?.restoreSelection();
    render();
    if (typeof renderShipyardControl === 'function') renderShipyardControl();
  });
})();
