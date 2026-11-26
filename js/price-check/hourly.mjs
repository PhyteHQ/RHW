import { matchingBaseNode } from '../supply/core/navigation.mjs';
import { number, volumeFor } from '../supply/core/trade.mjs';
import { DOCK_SECONDS, ShipNavigator } from '../supply/navigation.mjs';

export function fixedRouteHome(base) {
  if (!base?.nickname || !base.system_nickname) return null;
  const position = base.base_pos ?? base.pos;
  const pos = (Array.isArray(position) ? position : [position?.X, position?.Y, position?.Z]).map(number);
  if (pos.length !== 3 || pos.some(value => value === null)) return null;
  return { id: base.nickname, system: base.system_nickname, pos };
}

export function estimateRoundTrips({ home, routes, goods, ships, navigation }) {
  const nodes = new Map(navigation.nodes.map(node => [node.id, node]));
  const byGood = new Map(goods.map(good => [good.id, good]));
  const trips = {};
  const stops = [];
  for (const route of routes) {
    const mapped = nodes.get(navigation.baseNodes?.[route.sourceId]);
    const source = { id: route.sourceId, system: route.system || mapped?.system };
    const dock = matchingBaseNode(source, mapped)?.allows;
    const good = byGood.get(route.goodId);
    const output = trips[route.key] = { candidates: [], reason: 'No compatible round trip' };
    if (!dock?.length) output.reason = 'Supplier dock not confirmed on route map';
    else if (!good) output.reason = 'Cargo volume unavailable';
    else stops.push({ source, dock, good, output });
  }
  if (!stops.length) return trips;

  const locations = [home, ...new Map(stops.map(stop => [stop.source.id, stop.source])).values()];
  for (const ship of ships) {
    const outbound = new ShipNavigator(navigation, locations, ship);
    const inbound = new ShipNavigator(navigation, locations, ship, { reverse: true });
    for (const { source, dock, good, output } of stops) {
      if (!dock.includes(ship.dock)) continue;
      const volume = volumeFor(good, ship);
      const units = volume === null ? 0 : Math.floor(ship.cargo / volume);
      if (!Number.isSafeInteger(units) || units < 1) continue;
      const there = outbound.route(home.id, source.id);
      const back = inbound.route(home.id, source.id);
      if (!there || !back) continue;
      const seconds = there.seconds + back.seconds + 3 * DOCK_SECONDS;
      output.candidates.push({ hauler: ship.fleetId, ship: ship.name, units, seconds });
    }
  }
  return trips;
}

export function quoteHourly(candidates, { hauler, quantity, sourcePrice, payout, target }) {
  if (sourcePrice === null) return null;
  let trip = null;
  for (const candidate of candidates) {
    if (hauler !== 'auto' && candidate.hauler !== hauler) continue;
    const units = quantity === null ? candidate.units : Math.min(candidate.units, quantity);
    const unitsPerHour = units * 3600 / candidate.seconds;
    if (!trip || unitsPerHour > trip.unitsPerHour) trip = { ...candidate, units, unitsPerHour };
  }
  if (!trip) return null;
  const targetPrice = Math.ceil(sourcePrice + target * trip.seconds / (3600 * trip.units));
  if (!Number.isSafeInteger(targetPrice)) return null;
  return { ...trip, targetPrice, currentRate: payout === null ? null : (payout - sourcePrice) * trip.unitsPerHour };
}
