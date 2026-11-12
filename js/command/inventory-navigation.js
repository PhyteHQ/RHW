/* Inventory links open recipes or ship details without changing stock. */
(function initInventoryNavigation() {
  'use strict';
  const app = window.RHWV4;
  let highlightTimer;
  function recipe(recipeId) {
    productionModuleFilter = 'all'; productionModuleQuery = '';
    app.navigate('command', 'production');
    renderProductionModules();
    const input = document.querySelector('#productionModuleTools input');
    if (input) input.value = '';
    requestAnimationFrame(() => {
      const card = [...document.querySelectorAll('.production-card')].find(node => node.dataset.productionRecipe === recipeId);
      if (!card) { app.notify('Production recipe is not available in this view.', 'warn'); return; }
      const button = card.querySelector('.production-card-toggle');
      app.itemDetails.openRecipe(recipeId, button);
      card.tabIndex = -1;
      card.scrollIntoView({ block: 'start', behavior: 'instant' });
      clearTimeout(highlightTimer);
      document.querySelectorAll('.inventory-target').forEach(node => node.classList.remove('inventory-target'));
      card.classList.add('inventory-target');
      highlightTimer = setTimeout(() => card.classList.remove('inventory-target'), 2200);
    });
  }
  function hull(key) {
    if (key && !app.shipyard.selectHull(key)) return;
    app.navigate('command', 'shipyard');
    requestAnimationFrame(() => {
      const target = document.getElementById('shipyardControl');
      target?.scrollIntoView({ block: 'start', behavior: 'instant' });
      const selected = target?.querySelector('[data-shipyard-select].active,[data-shipyard-select][aria-pressed="true"]');
      selected?.focus({ preventScroll: true });
    });
  }
  function material(name, trigger) {
    app.itemDetails.openMaterial(name, trigger);
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
