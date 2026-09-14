/* ==========================================================================
   RHW V3.5 MAINTENANCE + HARDENING
   Small compatibility fixes that deliberately load after the feature layers.
   ========================================================================== */

function configuredBaseHealthMax() {
  return finiteNumber(DASHBOARD_CONFIG.baseHealthMax, 24000000, 1);
}

formatBaseHealth = function(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '–';
  if (n <= 100) return `${n.toFixed(n % 1 ? 1 : 0)}%`;
  const pct = Math.max(0, Math.min(100, (n / configuredBaseHealthMax()) * 100));
  return `${pct.toFixed(pct % 1 ? 1 : 0)}%`;
};

feedstockAnalysis = function(item) {
  const key = commodityKey(item);
  const perRecipeRequirements = RECIPES.map(recipe => recipe.ingredients
    .filter(([ingredientName]) => keyFromName(ingredientName) === key)
    .reduce((sum, [, amount]) => sum + (Number(amount) || 0), 0))
    .filter(required => required > 0);

  // If a material appears in several recipes, use the most demanding single
  // recipe instead of whichever recipe happens to be listed last in config.
  const required = perRecipeRequirements.length ? Math.max(...perRecipeRequirements) : 0;
  const q = quantity(item);
  const cycles = required > 0 ? Math.floor(q / required) : 0;
  const state = cycles <= 0 ? 'critical' : cycles < 10 ? 'low' : 'ok';
  return { key, required, quantity: q, cycles, state, perRecipeRequirements };
};

renderProgress = function(item, options = {}) {
  const meta = progressMeta(item, options.role || null);
  const fillClass = options.stateOverride || meta.cls;
  const showApiReserve = options.showApiReserve !== false;
  const q = quantity(item);
  const boundary = showApiReserve ? apiStockBoundary(item) : { min: null, max: null, valid: false };

  if (!boundary.valid) {
    const tooltip = `${meta.percent}% OF MAX ${number(meta.max)}`;
    return `<div class="progress-wrap" data-tooltip="${tooltip}" aria-label="${tooltip}"><div class="progress-fill ${fillClass}" style="width:${meta.percent}%"></div></div>`;
  }

  const apiMin = boundary.min;
  const apiMax = boundary.max;
  // A real API minimum of zero belongs exactly on the left edge. Non-zero
  // markers keep a tiny inset so their two-pixel line remains visible.
  const reservePercent = apiMin === 0
    ? 0
    : Math.max(0.5, Math.min(99.5, (apiMin / apiMax) * 100));
  const sellable = Math.max(0, q - apiMin);
  const tooltip = `STOCK ${number(q)} // BASE RESERVE ${number(apiMin)} // FOR SALE ${number(sellable)} // MAX ${number(apiMax)}`;
  const markerTooltip = apiMin > 0
    ? `API MIN STOCK ${number(apiMin)} // STOCK AT OR BELOW THIS MARK IS RESERVED`
    : 'API MIN STOCK 0 // NO STOCK IS SEALED AS BASE RESERVE';

  return `<div class="progress-wrap" data-tooltip="${tooltip}" aria-label="${tooltip}">` +
    `<div class="progress-reserve-marker" style="left:${reservePercent.toFixed(2)}%" data-tooltip="${markerTooltip}" aria-label="${markerTooltip}" role="img" tabindex="0"></div>` +
    `<div class="progress-fill ${fillClass}" style="width:${meta.percent}%"></div>` +
  `</div>`;
};

function installCrestFallback() {
  const crest = document.querySelector('.crest');
  const frame = crest?.closest('.crest-frame');
  if (!crest || !frame) return;

  const showFallback = () => {
    crest.hidden = true;
    frame.classList.add('crest-fallback');
  };

  crest.addEventListener('error', showFallback, { once: true });
  if (crest.complete && crest.naturalWidth === 0) showFallback();
}

// V3.5 originally injected these styles from JavaScript. They now live in the
// normal stylesheet cascade, so remove the temporary runtime copy if present.
document.getElementById('rhwV35EnhancementStyles')?.remove();
installCrestFallback();
