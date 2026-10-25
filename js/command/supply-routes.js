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
  function button(name) {
    if (!commodities().some(item => keyFromName(item) === keyFromName(name))) return '';
    return `<button type="button" class="rhw-supply-button" data-supply-commodity="${escapeHTML(name)}" aria-label="Supply ${escapeHTML(name)} to RHW">SUPPLY ROUTE</button>`;
  }
  function telemetry() {
    return { pobs: typeof allBases !== 'undefined' ? allBases : [],
      receivedAt: typeof lastLoaded !== 'undefined' && lastLoaded ? lastLoaded.getTime() : 0,
      stale: typeof dataIsStale !== 'undefined' && dataIsStale };
  }
  async function open(name) {
    const trigger = document.activeElement;
    try {
      modulePromise ||= import(new URL('./js/supply/ui.mjs', document.baseURI).href).catch(error => { modulePromise = null; throw error; });
      const module = await modulePromise;
      module.open({ commodity: name, commodities: commodities(), telemetry, trigger });
    } catch (error) { app.notify(`SUPPLY ROUTES // ${error.message}`, 'warn'); }
  }
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-supply-commodity]');
    if (trigger) open(trigger.dataset.supplyCommodity);
  });
  app.lifecycle.on('command:ready', 'supply-route-launcher', 90, () => {
    const panel = document.querySelector('[data-command-panel="logistics"]');
    if (!panel || panel.querySelector('.rhw-supply-launcher')) return;
    panel.insertAdjacentHTML('afterbegin', `<div class="rhw-supply-launcher"><div><strong>SUPPLY RHW</strong><span>Bring a material home · compare ships, time and hauling profit</span></div><button type="button" class="rhw-supply-button" data-supply-commodity="Ablative Armor Plating">PLAN SUPPLY ROUTE</button></div>`);
  });
  app.supplyRoutes = { button, commodities, open, telemetry };
})();
function supplyRouteButton(name) { return window.RHWV4?.supplyRoutes?.button(name) || ''; }
