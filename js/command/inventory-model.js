/* Inventory roles do not change the live market or spend production stock. */
(function initInventoryModel() {
  'use strict';
  const app = window.RHWV4;
  const definitions = DASHBOARD_CONFIG.reserveCards;
  function definition(name) {
    const key = keyFromName(name);
    return definitions.find(d => d.key === key || d.members.some(n => keyFromName(n) === key));
  }
  function record(name) {
    const item = findCommodity(name);
    return { name, item, stock: hasVerifiedTelemetry() && item && !item.missing
      ? firstFiniteApiStockValue(item, ['quantity', 'amount', 'stock']) : null };
  }
  function reserve(name) {
    const spec = definition(name);
    if (!spec) return null;
    const parts = spec.members.map(record);
    // An absent interchangeable variant contributes zero only when another is
    // reported. A malformed reported quantity must remain unknown.
    const known = parts.some(p => p.stock !== null) && parts.every(p => !p.item || p.item.missing || p.stock !== null);
    const stock = known ? parts.reduce((sum, p) => sum + (p.stock ?? 0), 0) : null;
    let required = null;
    if (app.operationsCore?.state.catalog && app.productionScenario && app.productionPlan) {
      required = 0;
      for (const row of app.productionScenario.analyze().rows.filter(r => r.enabled)) {
        const batch = app.productionPlan.batch(row);
        for (const group of batch?.inputs || []) if (group.names.some(n => spec.members.some(member => keyFromName(member) === keyFromName(n)))) required += group.qty;
      }
    }
    const state = stock === null || required === null ? 'waiting' : required === 0 ? 'ok'
      : stock < required ? 'critical' : stock < required * 2 ? 'low' : 'ok';
    const maxima = parts.map(p => firstFiniteApiStockValue(p.item, ['max_stock', 'max']));
    const item = { name: spec.members[0], quantity: stock,
      max_stock: maxima.some(n => n !== null) ? maxima.reduce((s, n) => s + (n ?? 0), 0) : null };
    return { ...spec, parts, stock, required, state, item };
  }
  function input(name, recipeId) {
    const value = record(name);
    const module = DASHBOARD_CONFIG.productionModules.find(entry => entry.recipeId === recipeId);
    const recipe = module ? app.production?.requirements(module) : null;
    const required = recipe?.ingredients.find(([n]) => keyFromName(n) === keyFromName(name))?.[1] ?? null;
    return { ...value, required, cycles: value.stock !== null && required > 0 ? Math.floor(value.stock / required) : null };
  }
  function ships() {
    return CAPITAL_SHIPYARD.hulls.map(hull => {
      const item = hasVerifiedTelemetry() ? findShipyardItem(hull) : null;
      const value = firstFiniteApiStockValue(item, ['quantity', 'amount', 'stock']);
      return { hull, stock: Number.isSafeInteger(value) ? value : null };
    });
  }
  app.inventoryModel = { definition, record, reserve, input, ships };
})();
