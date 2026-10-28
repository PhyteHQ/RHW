/* Each scenario keeps one ID and one real ship throughout its complete tour. */
import { searchSupply, rankSupplyRoutes, findRhw, findCommodity } from './planner.mjs';
import { searchExports, rankExportRoutes } from './export-planner.mjs';
import { BMM_ID } from './access.mjs';
import { autoIdentityShips, identityShipCheck, isHaulingShip } from './identity-profiles.mjs';

const earnings = (a, b) => b.hourlyProfit - a.hourlyProfit || b.profit - a.profit || a.seconds - b.seconds;
const routeKey = route => JSON.stringify([route.ship.id, route.legs.map((leg, i) => [leg.source, leg.target, leg.good, route.quantities[i]])]);
const conditional = route => ({ ...route, recommendation: null,
  label: 'CHECK ID / SHIP RULES · CONDITIONAL QUOTE' });
function legacyBmmShips(ships, identity) {
  return [/advanced.train|advanced_train/i, /pilgrim/i, /longhorn/i].map(pattern =>
    ships.find(ship => pattern.test(ship.name + ' ' + ship.nickname)))
    .filter(ship => ship && identityShipCheck(identity, ship).state !== 'blocked').slice(0, 3);
}

export async function searchIdentities(dataset, navigation, ships, scopes, options = {}, progress = () => {}, canceled = () => false) {
  const search = options.mode === 'export' ? searchExports : searchSupply;
  const selectedScopes = scopes.slice(0, 6), compared = selectedScopes.length > 1;
  const origin = findRhw(dataset)?.id;
  const started = performance.now(), totalMs = Math.min(30000, Math.max(1000, options.searchMs || 18000));
  const reports = [], pool = [];
  let checked = 0, sources = 0, pairs = 0, returnChecked = 0, timedOut = false, pruned = scopes.length > 6;
  let firstResult = null;
  const plans = selectedScopes.map(scope => {
    const requested = options.shipId && options.shipId !== 'auto' ? ships.find(ship => ship.id === options.shipId) : null;
    let profiles = requested ? [requested] : autoIdentityShips(ships, scope.identity), skipReason = '';
    if (options.shipId && options.shipId !== 'auto' && !requested) {
      profiles = []; skipReason = 'The selected ship is not in the current registry';
    } else if (requested && identityShipCheck(scope.identity, requested).state === 'blocked') {
      skipReason = identityShipCheck(scope.identity, requested).reason; profiles = [];
    } else if (!requested && !profiles.length && scope.identity.id === BMM_ID) profiles = legacyBmmShips(ships, scope.identity);
    const shipPruned = !requested && ships.filter(ship => isHaulingShip(ship) && identityShipCheck(scope.identity, ship).state === 'checked').length > profiles.length;
    return { ...scope, profiles, skipReason, shipPruned };
  });
  for (let index = 0; index < selectedScopes.length; index++) {
    if (canceled()) break;
    const { identity, blocked = [], profiles, skipReason, accessReady, shipPruned, approvalDocks = [] } = plans[index];
    pruned ||= shipPruned;
    if (!profiles.length) {
      reports.push({ identity, state: 'unavailable', reason: skipReason || 'No automatically verified hauler; select a ship to inspect a conditional quote' });
      continue;
    }
    const remaining = totalMs - (performance.now() - started);
    if (remaining < 1000) { timedOut = true; break; }
    const runnable = plans.slice(index).filter(plan => plan.profiles.length).length;
    const sliceMs = Math.max(1000, Math.min(remaining, remaining / runnable));
    const restricted = options.includeRestrictedPobs ? [] : approvalDocks.filter(id => id !== origin);
    const scopeOptions = { ...options, blocked: [...new Set([...(options.blocked || []), ...blocked, ...restricted])], searchMs: sliceMs };
    progress({ phase: 'identity', identity: identity.name, index: index + 1, total: selectedScopes.length, checked });
    let quoted;
    try {
      quoted = await search(dataset, navigation, profiles, scopeOptions,
        update => progress({ ...update, identity: identity.name, checked: checked + update.checked }), canceled);
    } catch (error) {
      if (!compared) throw error;
      reports.push({ identity, state: 'unavailable', reason: error.message }); continue;
    }
    firstResult ||= quoted;
    checked += quoted.stats.checked; sources += quoted.stats.sources; pairs += quoted.stats.ships;
    returnChecked += quoted.stats.returnChecked || 0;
    timedOut ||= quoted.stats.timedOut; pruned ||= quoted.stats.pruned;
    const rows = quoted.results.map(route => {
      const eligibility = identityShipCheck(identity, route.ship);
      const needsApproval = route.stops.some(id => id !== origin && approvalDocks.includes(id));
      const shipCheck = accessReady !== true ? { ...eligibility, state: 'conditional', reason: 'ID docking rules are not reported; verify access before flying' }
        : needsApproval ? { ...eligibility, state: 'conditional', reason: 'This POB needs explicit owner approval; ID alone does not grant docking' } : eligibility;
      const decorated = { ...route, identity, shipCheck };
      return shipCheck.state === 'checked' ? decorated : conditional(decorated);
    });
    pool.push(...rows);
    const best = rows.find(route => route.recommendation) || rows[0];
    reports.push(best ? { identity, state: best.shipCheck.state, ship: best.ship,
      delivered: best.delivered, seconds: best.seconds, hourlyProfit: best.hourlyProfit,
      source: options.mode === 'export' ? best.buyer.name : best.legs.at(-1).from,
      reason: best.shipCheck.reason } : { identity, state: 'unavailable', reason: 'No usable route found within the checked access and market limits' });
    if (!compared) return { ...quoted, results: rows, identityComparison: reports,
      stats: { ...quoted.stats, pruned: quoted.stats.pruned || shipPruned, identities: 1, identityCompared: false } };
  }
  const base = firstResult || { mode: options.mode, origin: findRhw(dataset)?.id,
    commodity: { id: findCommodity(dataset, options.commodity)?.id, name: findCommodity(dataset, options.commodity)?.name || options.commodity }, results: [], stats: {} };
  const verified = pool.filter(route => route.shipCheck.state === 'checked');
  // Collapse equivalent routes across IDs, preferring a checked BMM option.
  const unique = new Map();
  for (const route of [...verified].sort((a, b) => (b.identity.id === BMM_ID) - (a.identity.id === BMM_ID)))
    if (!unique.has(routeKey(route))) unique.set(routeKey(route), { ...route, recommendation: null });
  let results = options.mode === 'export' ? rankExportRoutes([...unique.values()]) : rankSupplyRoutes([...unique.values()], options.extraPercent);
  if (options.mode !== 'export') {
    const benchmark = results.find(route => route.label === 'FAST IMPORT' || route.recommendation?.kind === 'fast-supply');
    if (benchmark) results = results.map(route => ({ ...route, extraSeconds: route.seconds - benchmark.seconds }));
  }
  const bmm = pool.find(route => route.identity.id === BMM_ID && route.recommendation)
    || pool.find(route => route.identity.id === BMM_ID);
  if (bmm && !results.some(route => routeKey(route) === routeKey(bmm)))
    results.push({ ...bmm, recommendation: null, label: bmm.shipCheck.state === 'checked' ? 'BMM COMPARISON' : bmm.label });
  const unchecked = pool.filter(route => route.shipCheck.state !== 'checked').sort(earnings)[0];
  if (unchecked && !results.some(route => routeKey(route) === routeKey(unchecked))) results.push(conditional(unchecked));
  return { ...base, results: results.slice(0, 5), identityComparison: reports,
    stats: { ...base.stats, checked, sources, ships: pairs, returnChecked, identities: reports.length,
      identityCompared: compared, timedOut, pruned, canceled: canceled(),
      noProfit: options.mode === 'export' && results.length > 0 && !results.some(route => route.profit > 0 && (route.outboundProfit ?? route.profit) >= 0),
      expressOnly: options.mode !== 'export' && results.length > 0 && results.every(route => route.delivery?.loss > 1e-6),
      extraPercent: Math.min(50, Math.max(0, Number(options.extraPercent ?? 20) || 0)) } };
}
