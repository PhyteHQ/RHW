/* Context entry points only. Market data, map and worker load on first use. */
(function initRhwSupplyRoutes() {
  'use strict';
  const app = window.RHWV4;
  if (!app || app.supplyRoutes) return;
  let modulePromise;
  function commodities() {
    const names = [...new Set(Object.values(DASHBOARD_CONFIG.roles).flat())];
    if (typeof items !== 'undefined') items.forEach(item => {
      if (!item.missing && !item.synthetic && (item.category === 'commodity' || String(item.nickname || '').startsWith('commodity_'))) names.push(displayName(item));
    });
    for (const recipe of app.production?.recipes() || []) {
      recipe.ingredients.forEach(([name]) => names.push(name));
      Object.values(recipe.inputOptions || {}).forEach(options => names.push(...options));
    }
    const unique = new Map();
    names.forEach(name => {
      const key = keyFromName(name);
      const reported = typeof findCommodity === 'function' ? findCommodity(name)?.name : '';
      unique.set(key, CANONICAL_NAMES[key] || reported || name.replace(/\b\w/g, char => char.toUpperCase()));
    });
    return [...unique.values()].sort((a, b) => a.localeCompare(b));
  }
  function button(name, mode = 'supply') {
    if (!commodities().some(item => keyFromName(item) === keyFromName(name))) return '';
    const label = `${mode === 'export' ? 'Find export buyers' : 'Plan supply route'} for ${escapeHTML(name)}`;
    const drawing = mode === 'export' ? '<path d="M14 4h6v6M20 4l-9 9M10 5H4v15h15v-6"/>'
      : '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 5h9a3 3 0 0 1 0 6H8a4 4 0 0 0 0 8h9"/>';
    return `<button type="button" class="rhw-supply-button rhw-supply-icon" data-${mode}-commodity="${escapeHTML(name)}" aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${drawing}</svg></button>`;
  }
  function telemetry() {
    return { pobs: typeof allBases !== 'undefined' ? allBases : [],
      receivedAt: typeof lastLoaded !== 'undefined' && lastLoaded ? lastLoaded.getTime() : 0,
      stale: typeof dataIsStale !== 'undefined' && dataIsStale };
  }
  async function open(name, trigger = document.activeElement, mode) {
    try {
      modulePromise ||= import(new URL('./js/supply/ui.mjs', document.baseURI).href).catch(error => { modulePromise = null; throw error; });
      const module = await modulePromise;
      const names = commodities();
      const outputRoles = [...DASHBOARD_CONFIG.roles.export, ...DASHBOARD_CONFIG.roles.byproduct, ...DASHBOARD_CONFIG.roles.confiscated];
      const outputKeys = new Set(outputRoles.map(keyFromName));
      module.open({ commodity: name, commodities: names, exportCommodities: names.filter(item => outputKeys.has(keyFromName(item))), mode, telemetry, trigger });
    } catch (error) { app.notify(`TRADE DESK // ${error.message}`, 'warn'); }
  }
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-supply-commodity],[data-export-commodity],[data-trade-desk]');
    if (!trigger) return;
    if (trigger.hasAttribute('data-export-commodity')) open(trigger.dataset.exportCommodity, trigger, 'export');
    else if (trigger.hasAttribute('data-supply-commodity')) open(trigger.dataset.supplyCommodity, trigger, 'supply');
    else open(null, trigger);
  });
  app.lifecycle.on('command:ready', 'supply-route-launcher', 90, () => {
    if (typeof renderOverview === 'function') renderOverview();
    if (typeof renderManifest === 'function') renderManifest();
    const panel = document.querySelector('[data-command-panel="logistics"]');
    if (!panel || panel.querySelector('.rhw-supply-launcher')) return;
    panel.insertAdjacentHTML('afterbegin', `<div class="rhw-supply-launcher"><div><strong>RHW TRADE DESK</strong><span>Supply the base or find export buyers · compare ships, time and hauling profit</span></div><button type="button" class="rhw-supply-button" data-trade-desk>OPEN TRADE DESK</button></div>`);
  });
  app.supplyRoutes = { button, commodities, open, telemetry };
})();
function supplyRouteButton(name) { return window.RHWV4?.supplyRoutes?.button(name) || ''; }
function exportRouteButton(name) { return window.RHWV4?.supplyRoutes?.button(name, 'export') || ''; }
