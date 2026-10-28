/* Search each ship/route once, then attach every ID valid for its entire tour. */
import { searchSupply, findRhw, findCommodity } from './planner.mjs';
import { searchExports } from './export-planner.mjs';
import { BMM_ID } from './access.mjs';
import { autoIdentityShips, identityShipCheck, isHaulingShip, PREFERRED_TRADER_IDS } from './identity-profiles.mjs';

const conditional = route => ({ ...route, recommendation: null,
  label: 'CHECK ID / SHIP RULES · CONDITIONAL QUOTE' });
function legacyBmmShips(ships, identity) {
  return [/advanced.train|advanced_train/i, /pilgrim/i, /longhorn/i].map(pattern =>
    ships.find(ship => pattern.test(ship.name + ' ' + ship.nickname)))
    .filter(ship => ship && identityShipCheck(identity, ship).state !== 'blocked');
}

export async function searchIdentities(dataset, navigation, ships, scopes, options = {}, progress = () => {}, canceled = () => false) {
  const origin = findRhw(dataset)?.id;
  const allScopes = [...new Map(scopes.map(scope => [scope.identity.id, {
    ...scope, denied: new Set(scope.blocked || []), approval: new Set(scope.approvalDocks || []), unverified: new Set(scope.unverifiedDocks || [])
  }])).values()];
  const active = options.identityId && !['all', 'compare'].includes(options.identityId)
    ? allScopes.filter(scope => scope.identity.id === options.identityId) : allScopes;
  const checks = new Map();
  function policies(ship) {
    if (!checks.has(ship.id)) checks.set(ship.id, allScopes.map(scope => {
      const shipCheck = identityShipCheck(scope.identity, ship);
      return { scope, shipCheck: shipCheck.state !== 'blocked' && scope.accessReady !== true
        ? { ...shipCheck, state: 'conditional', reason: 'ID docking rules are not reported; verify access before flying' } : shipCheck };
    }));
    return checks.get(ship.id);
  }
  function assessRoute(policy, stops) {
    const { scope, shipCheck } = policy;
    if (shipCheck.state === 'blocked') return { identity: scope.identity, shipCheck };
    const denied = stops.find(id => scope.denied.has(id));
    const approval = stops.find(id => scope.approval.has(id));
    const unverified = stops.find(id => scope.unverified.has(id));
    const baseName = id => dataset.bases.find(base => base.id === id)?.name || id;
    return { identity: scope.identity, shipCheck: denied ? { ...shipCheck, state: 'blocked', reason: 'ID prevents docking at ' + baseName(denied) }
      : approval ? { ...shipCheck, state: 'conditional', reason: 'Explicit POB owner approval is required at ' + baseName(approval) }
      : shipCheck.state !== 'checked' ? shipCheck
      : unverified ? { ...shipCheck, state: 'conditional', reason: 'ID docking rights are unverified at ' + baseName(unverified) } : shipCheck };
  }
  function matches(ship, stops, restrict = false) {
    return policies(ship).flatMap(({ scope, shipCheck }) => {
      if (restrict && !active.includes(scope) || shipCheck.state === 'blocked' || stops.some(id => scope.denied.has(id))) return [];
      const unverified = shipCheck.state !== 'checked' || stops.some(id => scope.unverified.has(id));
      if (unverified && !options.includeUnverified) return [];
      const approval = stops.some(id => scope.approval.has(id));
      if (approval && !options.includeRestrictedPobs) return [];
      return [assessRoute({ scope, shipCheck }, stops)];
    });
  }
  const requested = options.shipId && options.shipId !== 'auto' ? ships.find(ship => ship.id === options.shipId) : null;
  const profiles = [], seen = new Set();
  const add = ship => { if (ship && !seen.has(ship.id)) { profiles.push(ship); seen.add(ship.id); } };
  let reason = '';
  if (options.shipId && options.shipId !== 'auto') {
    if (!requested) reason = 'The selected ship is not in the current registry';
    else if (!active.length) reason = 'The selected ID is not in the current registry';
    else if (active.every(scope => identityShipCheck(scope.identity, requested).state === 'blocked'))
      reason = identityShipCheck(active[0].identity, requested).reason;
    else add(requested);
  } else {
    // Round-robin ID shortlists preserve access-specific hulls without repeating
    // the same expensive navigation search for every compatible identity.
    const lists = active.filter(scope => !scope.denied.has(origin)
      && (options.includeRestrictedPobs || !scope.approval.has(origin))
      && (options.includeUnverified || !scope.unverified.has(origin))).map(scope => autoIdentityShips(ships, scope.identity));
    for (let index = 0; index < 6; index++) for (const list of lists) add(list[index]);
    if (!profiles.length && options.includeUnverified) {
      const bmm = active.find(scope => scope.identity.id === BMM_ID);
      if (bmm) legacyBmmShips(ships, bmm.identity).forEach(add);
    }
    if (!profiles.length) reason = 'No automatically verified hauler; select a ship to inspect a conditional quote';
  }
  const shortlisted = profiles.slice(0, 12);
  const eligibleHulls = ships.filter(ship => isHaulingShip(ship) && active.some(scope => identityShipCheck(scope.identity, ship).state === 'checked'));
  const shipPruned = !requested && eligibleHulls.some(ship => !shortlisted.includes(ship));
  const empty = { mode: options.mode, origin, commodity: { id: findCommodity(dataset, options.commodity)?.id,
    name: findCommodity(dataset, options.commodity)?.name || options.commodity }, results: [], reason,
    stats: { checked: 0, sources: 0, ships: 0, identities: active.length, routeFirst: true, extraPercent: options.extraPercent ?? 20 } };
  if (!shortlisted.length) return empty;
  if (shortlisted.every(ship => !matches(ship, [origin], true).length)) return { ...empty,
    reason: 'No checked combination of this ID, ship and docking rights at RHW. Unknown rules and POB owner approvals are excluded by default.' };
  const blocked = dataset.bases.filter(base => active.every(scope => scope.denied.has(base.id)
    || !options.includeRestrictedPobs && scope.approval.has(base.id)
    || !options.includeUnverified && scope.unverified.has(base.id))).map(base => base.id);
  const routeEligibility = (ship, stops) => {
    const permitted = matches(ship, stops, true);
    return permitted.some(row => row.shipCheck.state === 'checked') ? 'checked' : permitted.length ? 'conditional' : 'blocked';
  };
  progress({ phase: 'profiles', checked: 0, identities: active.length, ships: shortlisted.length });
  const search = options.mode === 'export' ? searchExports : searchSupply;
  const quoted = await search(dataset, navigation, shortlisted, { ...options, profileLimit: 12,
    importGoal: options.importGoal || 'price', routeEligibility,
    blocked: [...new Set([...(options.blocked || []), ...blocked])] }, progress, canceled);
  const results = quoted.results.map(route => {
    const compatibleIdentities = matches(route.ship, route.stops).sort((a, b) =>
      Number(a.shipCheck.state !== 'checked') - Number(b.shipCheck.state !== 'checked')
      || Number(b.identity.id === BMM_ID) - Number(a.identity.id === BMM_ID));
    const allowed = compatibleIdentities.filter(row => active.some(scope => scope.identity.id === row.identity.id));
    const primary = allowed.find(row => row.shipCheck.state === 'checked') || allowed[0];
    if (!primary) return null;
    const preferredIdentities = PREFERRED_TRADER_IDS.map(preferred => {
      const policy = policies(route.ship).find(row => row.scope.identity.id === preferred.id);
      return { label: preferred.label, ...(policy ? assessRoute(policy, route.stops)
        : { identity: { id: preferred.id, name: preferred.label }, shipCheck: { state: 'unknown', reason: 'This standard ID profile is not loaded' } }) };
    });
    const decorated = { ...route, ...primary, compatibleIdentities, preferredIdentities };
    return primary.shipCheck.state === 'checked' ? decorated : conditional(decorated);
  }).filter(Boolean);
  return { ...quoted, results, reason: results.length ? '' : 'No usable route found within the checked ship, access and market limits. Approval-only POBs can be inspected in the advanced settings.',
    stats: { ...quoted.stats, routeFirst: true, identities: active.length, pruned: quoted.stats.pruned || shipPruned,
      importGoal: options.importGoal || 'price',
      noProfit: options.mode === 'export' && !results.some(route => route.recommendation),
      expressOnly: options.mode !== 'export' && results.length > 0 && results.every(route => route.delivery?.loss > 1e-6) } };
}
