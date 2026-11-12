/* One recipe/material detail surface, fed by the live stock and shared catalog. */
(function initItemDetails() {
  'use strict';
  const app = window.RHWV4;
  if (!app || app.itemDetails) return;
  let dialog, selected, openedBy, focusRecipe, signature = '';
  const esc = value => app.util.escape(String(value ?? ''));

  function visible(element) { return Boolean(element?.isConnected && element.getClientRects().length); }
  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'rhwItemDetails';
    dialog.className = 'rhw-item-detail inventory-uses-dialog';
    dialog.setAttribute('aria-labelledby', 'rhwItemDetailTitle');
    dialog.innerHTML = '<header class="rhw-item-detail-head"><span>STOCK &amp; RECIPE</span><button type="button" data-item-detail-close aria-label="Close item details">CLOSE ×</button></header><div id="rhwItemDetailBody"></div>';
    document.body.appendChild(dialog);
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-item-detail-close]')) dialog.close();
      if (event.target.closest('[data-purchase-source]')) dialog.close('navigate');
      const choice = event.target.closest('[data-inventory-choice]');
      if (choice) app.inventoryNavigation.recipe(choice.dataset.inventoryChoice);
      const calculate = event.target.closest('[data-detail-calculator]');
      if (calculate) {
        const label = calculate.dataset.detailCalculator;
        dialog.close('navigate');
        app.productionPricing.openProductionTarget(label, 1);
      }
    });
    dialog.addEventListener('change', event => {
      if (!event.target.matches('[data-detail-mox]')) return;
      if (!app.production.selectMoxRecipe(event.target.value)) app.notify('Recipe selection could not be saved on this device.', 'warn');
      signature = '';
      renderAll(); app.requestUiUpdate(); refresh();
      dialog.querySelector('[data-detail-mox]')?.focus({ preventScroll: true });
    });
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      document.querySelectorAll('.production-card-toggle').forEach(button => button.setAttribute('aria-expanded', 'false'));
      if (dialog.returnValue !== 'navigate') {
        const fallback = [...document.querySelectorAll('.production-card')].find(card => card.dataset.productionRecipe === focusRecipe)?.querySelector('.production-card-toggle');
        const target = visible(openedBy) ? openedBy : fallback;
        if (visible(target)) target.focus({ preventScroll: true });
      }
      selected = null; signature = '';
    });
    return dialog;
  }

  function recipeContent() {
    const module = app.production.modules().find(entry => entry.product === selected.product);
    if (!module) return '<h2 id="rhwItemDetailTitle">RECIPE UNAVAILABLE</h2><p>This recipe is not available in the current catalog.</p>';
    const batch = app.production.requirements(module);
    const card = [...document.querySelectorAll('.production-card')].find(node => node.dataset.productionRecipe === module.recipeId);
    focusRecipe = module.recipeId;
    dialog.dataset.recipeId = module.recipeId;
    card?.querySelector('.production-card-toggle')?.setAttribute('aria-expanded', 'true');
    const variant = module.product === 'MOX' ? `<label class="production-variant detail-variant">MOX recipe<select data-detail-mox aria-label="MOX recipe in details">${app.production.moxRecipes.map(option => `<option value="${option.recipeId}"${option.recipeId === module.recipeId ? ' selected' : ''}>${option.label}</option>`).join('')}</select></label>` : '';
    const snapshot = telemetrySnapshot();
    const stock = findCommodity(module.product);
    const quantity = snapshot.available ? firstFiniteApiStockValue(stock, ['quantity', 'amount', 'stock']) : null;
    const body = card?.querySelector('.production-materials')?.innerHTML || '<p class="rhw-detail-empty">Material coverage is unknown until verified stock and this recipe are available.</p>';
    return `<div class="rhw-item-detail-title"><small>${snapshot.stale ? 'CACHED STOCK' : snapshot.available ? 'CURRENT STOCK' : 'STOCK UNKNOWN'}</small><h2 id="rhwItemDetailTitle">${esc(displayRecipeName(module.product))}</h2><strong>${number(quantity)} <small>IN STOCK</small></strong></div>${variant}<div class="rhw-item-detail-materials">${body}</div>${batch ? `<button type="button" class="rhw-detail-calculator" data-detail-calculator="${esc(module.product)}">OPEN IN CALCULATOR ↗</button>` : ''}`;
  }

  function materialContent() {
    const name = selected.name;
    const spec = app.inventoryModel.definition(name);
    const entry = app.inventoryModel.record(name);
    const keys = (spec?.members || [name]).map(keyFromName);
    const options = [];
    if (spec) options.push({ id: spec.recipeId, label: 'PRODUCE · ' + spec.members[0] });
    for (const recipe of app.production.recipes()) {
      const consumed = recipe.ingredients.some(([n]) => keys.includes(keyFromName(n)))
        || Object.values(recipe.inputOptions || {}).some(group => group.some(n => keys.includes(keyFromName(n))));
      const produced = recipe.byproducts.some(([n]) => keys.includes(keyFromName(n)));
      if (consumed || produced) options.push({ id: recipe.recipeId, label: `${consumed ? 'USED BY' : 'PRODUCED BY'} · ${recipe.product}` });
    }
    const feed = keyFromName(name) === 'toxic waste' ? app.inventoryModel.moxFeedstock() : null;
    const context = feed ? `<div class="rhw-feedstock-conversion"><strong>${number(feed.required)} TW → ${number(feed.outputPerBatch)} MOX</strong><span>${feed.cycles === null ? 'TW stock unknown' : `${number(feed.cycles)} full ${feed.variant} batches covered by TW`}</span><small>TW coverage only. Other inputs, scientists and module activity are checked separately.</small><button type="button" data-inventory-choice="${esc(feed.recipeId)}">OPEN MOX RECIPE ↗</button></div>` : '';
    const quantity = spec ? app.inventoryModel.reserve(spec.key)?.stock : entry.stock;
    return `<div class="rhw-item-detail-title"><small>${telemetrySnapshot().stale ? 'CACHED STOCK' : 'MATERIAL CONNECTIONS'}</small><h2 id="rhwItemDetailTitle">${esc(spec?.label || name)}</h2><strong>${number(quantity)} <small>IN STOCK</small></strong></div>${context}<div class="rhw-material-connections"><h3>CONNECTED RECIPES</h3>${options.map(option => `<button type="button" data-inventory-choice="${esc(option.id)}">${esc(option.label)} ↗</button>`).join('') || '<p>No connected production recipes are available.</p>'}</div>`;
  }

  function refresh() {
    if (!dialog?.open || !selected) return;
    // A nested supply/source dialog must keep its original trigger connected.
    const nested = [...document.querySelectorAll('dialog[open],[role="dialog"][aria-modal="true"]')]
      .some(element => element !== dialog && element.getClientRects().length);
    if (nested) return;
    const markup = selected.type === 'recipe' ? recipeContent() : materialContent();
    if (signature === markup) return;
    const active = document.activeElement;
    const body = document.getElementById('rhwItemDetailBody');
    const focusedInside = body.contains(active);
    const attributes = ['data-detail-mox', 'data-detail-calculator', 'data-inventory-choice', 'data-supply-commodity', 'data-purchase-source'];
    const focusAttribute = focusedInside && attributes.find(name => active.hasAttribute(name));
    const focusValue = focusAttribute ? active.getAttribute(focusAttribute) : null;
    body.innerHTML = markup;
    signature = markup;
    if (focusedInside) {
      const replacement = focusAttribute && [...body.querySelectorAll('button,select')].find(node => node.getAttribute(focusAttribute) === focusValue);
      (replacement || dialog.querySelector('[data-item-detail-close]')).focus({ preventScroll: true });
    }
  }

  function show(trigger) {
    ensureDialog(); openedBy = trigger || document.activeElement; signature = '';
    dialog.returnValue = '';
    if (!dialog.open) dialog.showModal();
    refresh();
    dialog.querySelector('[data-item-detail-close]')?.focus({ preventScroll: true });
  }
  function openRecipe(recipeId, trigger) {
    const module = app.production.modules().find(entry => entry.recipeId === recipeId);
    if (!module) { app.notify('Production recipe is not available in this view.', 'warn'); return false; }
    selected = { type: 'recipe', product: module.product };
    focusRecipe = recipeId;
    show(trigger);
    return true;
  }
  function openMaterial(name, trigger) { selected = { type: 'material', name }; show(trigger); }
  app.itemDetails = { openRecipe, openMaterial, refresh, close: () => dialog?.close() };
  app.onRender('production', refresh);
  app.onUiUpdate(refresh);
  app.lifecycle.on('catalog:loaded', 'item-details', 90, refresh);
})();
