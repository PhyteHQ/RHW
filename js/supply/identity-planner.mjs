/* Search each ship/route once, then attach every ID valid for its entire tour. */
import { searchSupply, findRhw, findCommodity } from './planner.mjs';
import { searchExports } from './export-planner.mjs';
import { BMM_ID } from './access.mjs';
import { autoIdentityShips, identityShipCheck, PREFERRED_TRADER_IDS } from './identity-profiles.mjs';
import { flightKey } from './navigation.mjs';
import { volumeFor, makeLeg, cargoItems } from './core/trade.mjs';
import { isSelectableShip } from './ship-profiles.mjs';
import { haulerCategory, matchesHauler } from './hauler-categories.mjs';
import { comparisonFleet } from './comparison-fleet.mjs';

// Drop only hulls covered by a faster/larger hull with the same physical
// access, commodity volumes and every one of their usable IDs. In particular,
// extra cargo cannot compensate for slower cruise or inability to use lanes.
function haulerFrontier(candidates, dataset, navigation) {
  const volumes = new Map();
  function volumeKey(ship) {
    const key = ship.volumeClass ?? 'default';
    if (!volumes.has(key)) {
      const differences = new Set();
      for (const base of dataset.bases) for (const item of base.offers) {
        const value = volumeFor(item, ship), ordinary = volumeFor(item, { volumeClass: null });
        if (value !== ordinary) differences.add(JSON.stringify([base.id, item.id, value]));
      }
      volumes.set(key, JSON.stringify([...differences].sort()));
    }
    return volumes.get(key);
  }
  const rows = candidates.map(row => ({ ...row, key: flightKey(navigation, { ...row.ship, cruise: 0 }) + volumeKey(row.ship) }));
  return rows.filter(b => !rows.some(a => a !== b && a.key === b.key
    && a.ship.cargo >= b.ship.cargo && a.ship.cruise >= b.ship.cruise
    && [...b.ids].every(id => a.ids.has(id))
    && (a.ship.cargo > b.ship.cargo || a.ship.cruise > b.ship.cruise || a.ids.size > b.ids.size || a.ship.id < b.ship.id)))
    .map(row => row.ship).sort((a, b) => b.cargo * b.cruise - a.cargo * a.cruise || a.id.localeCompare(b.id));
}

const conditional = route => ({ ...route, recommendation: null,
  label: 'CHECK ID / SHIP RULES · CONDITIONAL QUOTE' });
function legacyBmmShips(ships, identity) {
  return [/advanced.train|advanced_train/i, /pilgrim/i, /longhorn/i].map(pattern =>
    ships.find(ship => pattern.test(ship.name + ' ' + ship.nickname)))
    .filter(ship => ship && identityShipCheck(identity, ship).state !== 'blocked');
}

export async function searchIdentities(dataset, navigation, ships, scopes, options = {}, progress = () => {}, canceled = () => false) {
  if (options.fleetOnly) ships = comparisonFleet(ships);
  ships = ships.filter(ship => isSelectableShip(ship) && matchesHauler(ship, options.haulerId));
  const origin = findRhw(dataset)?.id;
  const bases = new Map(dataset.bases.map(base => [base.id, base]));
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
  function quotedModel(ship, route) {
    if (haulerCategory(ship).id !== haulerCategory(route.ship).id || flightKey(navigation, ship) !== flightKey(navigation, route.ship)) return false;
    return route.legs.every(leg => cargoItems(leg).every(item => {
      const equivalent = makeLeg(bases.get(leg.source), bases.get(leg.target), item.good, ship);
      return equivalent && ['buy', 'sell', 'volume', 'sourceVolume', 'targetVolume'].every(key =>
        Math.abs(equivalent[key] - item[key]) < 1e-6);
    }));
  }
  const requested = options.shipId && options.shipId !== 'auto' ? ships.find(ship => ship.id === options.shipId) : null;
  const profiles = [], seen = new Set();
  const add = ship => { if (ship && !seen.has(ship.id)) { profiles.push(ship); seen.add(ship.id); } };
  let reason = '', shipPruned = false;
  if (options.shipId && options.shipId !== 'auto') {
    if (!requested) reason = 'The selected ship is not in the current registry';
    else if (!active.length) reason = 'The selected ID is not in the current registry';
    else if (active.every(scope => identityShipCheck(scope.identity, requested).state === 'blocked'))
      reason = identityShipCheck(active[0].identity, requested).reason;
    else add(requested);
  } else {
    const homeScopes = active.filter(scope => !scope.denied.has(origin)
      && (options.includeUnverified || scope.accessReady === true)
      && (options.includeRestrictedPobs || !scope.approval.has(origin))
      && (options.includeUnverified || !scope.unverified.has(origin)));
    const candidates = new Map();
    for (const scope of homeScopes) for (const ship of autoIdentityShips(ships, scope.identity)) {
      if (!candidates.has(ship.id)) candidates.set(ship.id, { ship, ids: new Set() });
      candidates.get(ship.id).ids.add(scope.identity.id);
    }
    const frontier = haulerFrontier([...candidates.values()], dataset, navigation);
    shipPruned = frontier.length > 24;
    frontier.slice(0, 24).forEach(add);
    if (!profiles.length && options.includeUnverified) {
      const bmm = active.find(scope => scope.identity.id === BMM_ID);
      if (bmm) legacyBmmShips(ships, bmm.identity).forEach(add);
    }
    if (!profiles.length) reason = 'No automatically verified hauler; select a ship to inspect a conditional quote';
  }
  const shortlisted = profiles;
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
  const quoted = await search(dataset, navigation, shortlisted, { ...options, profileLimit: 24,
    importGoal: options.importGoal || 'price', routeEligibility,
    blocked: [...new Set([...(options.blocked || []), ...blocked])] }, progress, canceled);
  const results = quoted.results.map(route => {
    const directIdentities = matches(route.ship, route.stops).sort((a, b) =>
      Number(a.shipCheck.state !== 'checked') - Number(b.shipCheck.state !== 'checked')
      || Number(b.identity.id === BMM_ID) - Number(a.identity.id === BMM_ID));
    const allowed = directIdentities.filter(row => active.some(scope => scope.identity.id === row.identity.id));
    const primary = allowed.find(row => row.shipCheck.state === 'checked') || allowed[0];
    if (!primary) return null;
    const equivalent = requested ? [route.ship] : [route.ship, ...ships.filter(ship => ship.id !== route.ship.id && quotedModel(ship, route))];
    const modelChoices = equivalent.map(ship => ({ ship, compatibleIdentities: matches(ship, route.stops),
      preferredIdentities: PREFERRED_TRADER_IDS.map(preferred => {
        const policy = policies(ship).find(row => row.scope.identity.id === preferred.id);
        return { label: preferred.label, ...(policy ? assessRoute(policy, route.stops)
          : { identity: { id: preferred.id, name: preferred.label }, shipCheck: { state: 'unknown', reason: 'This standard ID profile is not loaded' } }) };
      }) })).filter(model => model.compatibleIdentities.length);
    const combined = new Map();
    for (const model of modelChoices) for (const row of model.compatibleIdentities) {
      let entry = combined.get(row.identity.id);
      if (!entry || entry.shipCheck.state !== 'checked' && row.shipCheck.state === 'checked') {
        entry = { ...row, models: [] }; combined.set(row.identity.id, entry);
      }
      if (entry.shipCheck.state === row.shipCheck.state) entry.models.push({ id: model.ship.id, name: model.ship.name });
    }
    const compatibleIdentities = [...combined.values()];
    const preferredIdentities = PREFERRED_TRADER_IDS.map(preferred => {
      const order = { checked: 0, conditional: 1, unknown: 2, blocked: 3 };
      const assessments = equivalent.flatMap(ship => {
        const policy = policies(ship).find(row => row.scope.identity.id === preferred.id);
        return policy ? [{ ...assessRoute(policy, route.stops), ship }] : [];
      }).sort((a, b) => order[a.shipCheck.state] - order[b.shipCheck.state]);
      const best = assessments[0];
      if (!best) return { label: preferred.label, identity: { id: preferred.id, name: preferred.label },
        shipCheck: { state: 'unknown', reason: 'This standard ID profile is not loaded' } };
      const names = assessments.filter(row => row.shipCheck.state === 'checked').map(row => row.ship.name);
      return { label: preferred.label, identity: best.identity, shipCheck: { ...best.shipCheck,
        reason: names.length ? `Available with ${names.join(', ')} for the entire trip.` : `${best.ship.name}: ${best.shipCheck.reason}` } };
    });
    const decorated = { ...route, ...primary, compatibleIdentities, preferredIdentities,
      hauler: { ...haulerCategory(route.ship), selectedModel: Boolean(requested), referenceShipId: route.ship.id,
        models: modelChoices.map(model => ({ ship: { id: model.ship.id, name: model.ship.name },
          preferredIdentities: model.preferredIdentities.map(row => ({ label: row.label, shipCheck: row.shipCheck })) })) } };
    return primary.shipCheck.state === 'checked' ? decorated : conditional(decorated);
  }).filter(Boolean).filter((route, index, rows) => rows.findIndex(other => JSON.stringify([
    other.hauler.id, other.legs.map(leg => [leg.source, leg.target, cargoItems(leg).map(item => [item.good, item.buy, item.sell, item.volume])]), other.quantities, other.seconds, other.profit]) === JSON.stringify([
    route.hauler.id, route.legs.map(leg => [leg.source, leg.target, cargoItems(leg).map(item => [item.good, item.buy, item.sell, item.volume])]), route.quantities, route.seconds, route.profit])) === index);
  return { ...quoted, results, reason: results.length ? '' : 'No usable route found within the checked ship, access and market limits. Approval-only POBs can be inspected in the advanced settings.',
    stats: { ...quoted.stats, routeFirst: true, identities: active.length, pruned: quoted.stats.pruned || shipPruned,
      importGoal: options.importGoal || 'price',
      noProfit: options.mode === 'export' && !results.some(route => route.recommendation),
      expressOnly: options.mode !== 'export' && results.length > 0 && results.every(route => route.delivery?.loss > 1e-6) } };
}
