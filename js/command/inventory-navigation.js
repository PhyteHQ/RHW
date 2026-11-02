/* Overview links select a view; factory planning remains an explicit action. */
(function initInventoryNavigation() {
  'use strict';
  const app = window.RHWV4;
  let usesDialog, returnFocus, highlightTimer;
  function recipe(recipeId) {
    productionModuleFilter = 'all'; productionModuleQuery = '';
    app.navigate('command', 'production');
    renderProductionModules();
    const input = document.querySelector('#productionModuleTools input');
    if (input) input.value = '';
    requestAnimationFrame(() => {
      const card = [...document.querySelectorAll('.production-card')].find(node => node.dataset.productionRecipe === recipeId);
      if (!card) { app.notify('Production recipe is not available in this view.', 'warn'); return; }
      productionExpandedModules.add(card.dataset.productionProduct);
      card.classList.remove('production-card-collapsed'); card.classList.add('production-card-expanded');
      const button = card.querySelector('.production-card-toggle');
      button?.setAttribute('aria-expanded', 'true');
      if (button) button.querySelector('span').textContent = 'HIDE MATERIALS';
      card.tabIndex = -1; card.focus({ preventScroll: true });
      card.scrollIntoView({ block: 'start', behavior: 'instant' });
      clearTimeout(highlightTimer);
      document.querySelectorAll('.inventory-target').forEach(node => node.classList.remove('inventory-target'));
      card.classList.add('inventory-target');
      highlightTimer = setTimeout(() => card.classList.remove('inventory-target'), 2200);
    });
  }
  function hull(key) {
    if (key && !app.shipyard.selectHull(key, { preservePlan: true })) return;
    app.navigate('command', 'shipyard');
    requestAnimationFrame(() => {
      const target = document.getElementById('shipyardControl');
      target?.scrollIntoView({ block: 'start', behavior: 'instant' });
      const selected = target?.querySelector('[data-shipyard-select].active,[data-shipyard-select][aria-pressed="true"]');
      selected?.focus({ preventScroll: true });
    });
  }
  function material(name, trigger) {
    const spec = app.inventoryModel.definition(name);
    const options = [];
    if (spec) options.push({ id: spec.recipeId, label: 'PRODUCE · ' + spec.members[0] });
    const names = (spec?.members || [name]).map(keyFromName);
    for (const r of app.production.recipes()) {
      const consumed = r.ingredients.some(([n]) => names.includes(keyFromName(n)))
        || Object.values(r.inputOptions || {}).some(group => group.some(n => names.includes(keyFromName(n))));
      const produced = r.byproducts.some(([n]) => names.includes(keyFromName(n)));
      if (consumed || produced) options.push({ id: r.recipeId, label: `${consumed ? 'USED BY' : 'PRODUCED BY'} · ${r.product}` });
    }
    if (options.length === 1) { recipe(options[0].id); return; }
    if (!options.length) return;
    if (!usesDialog) {
      usesDialog = document.createElement('dialog'); usesDialog.className = 'inventory-uses-dialog';
      usesDialog.setAttribute('aria-labelledby', 'inventoryUsesTitle'); document.body.append(usesDialog);
      usesDialog.addEventListener('click', event => {
        const target = event.target.closest('[data-inventory-choice]');
        if (target) { usesDialog.close('navigate'); recipe(target.dataset.inventoryChoice); }
        else if (event.target.closest('[data-inventory-close]')) usesDialog.close();
      });
      usesDialog.addEventListener('close', () => {
        if (usesDialog.returnValue !== 'navigate' && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      });
    }
    returnFocus = trigger;
    usesDialog.innerHTML = `<h2 id="inventoryUsesTitle">${escapeHTML(spec?.label || name)}</h2><p>OPEN PRODUCTION</p>${options.map(option => `<button type="button" data-inventory-choice="${escapeHTML(option.id)}">${escapeHTML(option.label)}</button>`).join('')}<button type="button" data-inventory-close>CLOSE</button>`;
    usesDialog.returnValue = ''; usesDialog.showModal();
  }
  document.addEventListener('click', event => {
    const explicit = event.target.closest('button[data-inventory-recipe],button[data-inventory-material],button[data-inventory-hull],[data-inventory-yard]');
    const card = event.target.closest('li[data-inventory-recipe],li[data-inventory-material]');
    if (!explicit && (!card || event.target.closest('button,a,summary,input,select,details'))) return;
    const target = explicit || card;
    if (target.hasAttribute('data-inventory-yard')) hull();
    else if (target.hasAttribute('data-inventory-hull')) hull(target.dataset.inventoryHull);
    else if (target.dataset.inventoryRecipe) recipe(target.dataset.inventoryRecipe);
    else if (target.dataset.inventoryMaterial) material(target.dataset.inventoryMaterial, explicit || target.querySelector('button'));
  });
  const render = () => { renderOverview(); app.command?.updateOverview?.(); };
  app.lifecycle.on('catalog:loaded', 'inventory-reserves', 55, render);
  app.lifecycle.on('command:ready', 'inventory-reserves', 95, render);
  app.inventoryNavigation = { recipe, hull, material };
})();
