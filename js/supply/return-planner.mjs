/* Optional backhaul after a completed export. Never finance or shrink the
   primary delivery with a later trade; simulate every transaction in order. */
import { makeLeg, simulate } from './core/trade.mjs';
import { quoteExport } from './export-quote.mjs';

const whole = value => Math.max(0, Math.floor(value + 1e-9));
const empty = (source, target) => ({ source, target, good: null, name: 'Empty transfer', volume: 0, margin: 0 });

export function trimRouteCache(navigator, keep = []) {
  const retained = new Set(keep);
  for (const id of navigator.cache.keys()) {
    if (navigator.cache.size <= 14) break;
    if (!retained.has(id)) navigator.cache.delete(id);
  }
}

export function returnMarkets(bases, rhw, profile, exportGood) {
  const buyers = new Map(), markets = [];
  for (const target of bases) {
    if (target.id !== rhw.id && target.system !== rhw.system) continue;
    for (const offer of target.offers) if (offer.sell > 0 && offer.id !== exportGood) {
      if (!buyers.has(offer.id)) buyers.set(offer.id, []);
      buyers.get(offer.id).push({ target, offer });
    }
  }
  for (const source of bases) {
    if (source.id === rhw.id) continue;
    for (const from of source.offers) {
      if (!(from.buy > 0) || from.id === exportGood) continue;
      for (const { target, offer } of buyers.get(from.id) || []) {
        if (source.id === target.id || !(offer.sell > from.buy)) continue;
        const leg = makeLeg(source, target, from.id, profile, from, offer);
        if (!leg) continue;
        let units = whole(profile.cargo / leg.volume);
        if (source.kind === 'pob') units = Math.min(units, whole(from.stock - from.min));
        if (target.kind === 'pob') units = Math.min(units, whole(offer.max - offer.stock));
        // RHW's cash and free storage may increase from the outbound sale.
        // The exact post-export resource limits are checked when quoting.
        if (units > 0) markets.push({ source, target, leg, potential: units * leg.margin });
      }
    }
  }
  return markets;
}

export function selectReturnMarkets(markets, route, navigator, extraPercent) {
  const buyerId = route.buyer.id, rhwId = route.leg.source;
  const fromBuyer = navigator.from(buyerId), fromHome = navigator.from(rhwId);
  if (!fromBuyer || !fromHome) return { candidates: [], pruned: false };
  const remaining = route.seconds * (1 + extraPercent / 100) - route.deliverySeconds;
  const groups = [[], [], [], []];
  for (const candidate of markets) {
    const { source, target, potential } = candidate;
    const pickup = source.id !== buyerId, drop = target.id !== rhwId;
    if (extraPercent === 0 && (pickup || drop)) continue;
    const from = fromBuyer.times.get(navigator.baseNodes.get(source.id));
    const home = fromHome.times.get(navigator.baseNodes.get(source.id));
    const targetNode = navigator.nodes.get(navigator.baseNodes.get(target.id));
    if (!Number.isFinite(from) || from > remaining || !targetNode || !navigator.allowed(targetNode)) continue;
    // This estimate only orders candidates. Exact directed travel, docking and
    // the detour allowance are checked before any quote becomes a result.
    const estimate = route.deliverySeconds + from + (home ?? 0) + (pickup + drop + 1) * 30;
    groups[pickup ? drop ? 3 : 2 : drop ? 1 : 0].push({ ...candidate, score: (route.profit + potential) / Math.max(1, estimate) });
  }
  groups.forEach(group => group.sort((a, b) => b.score - a.score));
  const limits = [10, 6, 12, 6], selected = groups.flatMap((group, i) => group.slice(0, limits[i]));
  const taken = new Set(selected);
  const all = groups.flat().sort((a, b) => b.score - a.score);
  for (const candidate of all) {
    if (selected.length >= 34) break;
    if (!taken.has(candidate)) { selected.push(candidate); taken.add(candidate); }
  }
  return { candidates: selected.sort((a, b) => b.score - a.score), pruned: all.length > selected.length };
}

export function quoteExportReturn(route, candidate, byId, profile, navigator, settings, options = {}) {
  const exportLeg = route.leg, returnLeg = candidate.leg;
  if (exportLeg.good === returnLeg.good || returnLeg.source === exportLeg.source) return null;
  const legs = [exportLeg];
  if (exportLeg.target !== returnLeg.source) legs.push(empty(exportLeg.target, returnLeg.source));
  legs.push(returnLeg);
  if (returnLeg.target !== exportLeg.source) legs.push(empty(returnLeg.target, exportLeg.source));
  const stops = [exportLeg.source, ...legs.map(leg => leg.target)];
  const identityState = options.routeEligibility?.(profile, stops);
  if (identityState === 'blocked') return null;
  const flights = legs.map(leg => navigator.route(leg.source, leg.target));
  trimRouteCache(navigator, [exportLeg.source, exportLeg.target]);
  if (flights.some(flight => !flight)) return null;
  const seconds = flights.reduce((sum, flight) => sum + flight.seconds, 0) + (legs.length + 1) * settings.dock;
  const extraPercent = Math.min(50, Math.max(0, Number(options.extraPercent ?? 20) || 0));
  if (seconds > route.seconds * (1 + extraPercent / 100) + .01) return null;
  const visited = [...new Set(legs.flatMap(leg => [leg.source, leg.target]))].map(id => byId.get(id));
  const initialCapital = options.capital ?? route.purchaseCost;
  const exported = simulate([exportLeg], [route.delivered], visited, { capital: initialCapital, cargo: profile.cargo });
  if (!exported) return null;
  const states = new Map(exported.bases.map(base => [base.id, base]));
  const back = quoteExport(states.get(returnLeg.source), states.get(returnLeg.target), returnLeg.good, profile,
    { capital: options.capital == null ? null : exported.cash });
  if (!back || !(back.profit > 0)) return null;
  const budget = options.capital ?? Math.max(route.purchaseCost, back.purchaseCost - route.profit);
  const quantities = legs.map((leg, i) => !leg.good ? 0 : i === 0 ? route.delivered : back.delivered);
  const checked = simulate(legs, quantities, visited, { capital: budget, cargo: profile.cargo });
  if (!checked || checked.profit <= route.profit) return null;
  const { bases: _state, ...verified } = checked;
  return { ...route, ...verified, ...(identityState ? { identityState } : {}), legs, delivered: route.delivered, seconds,
    hourlyProfit: checked.profit * 3600 / seconds, unitsPerHour: route.delivered * 3600 / seconds,
    jumps: flights.reduce((sum, flight) => sum + flight.jumps, 0),
    stops, outboundProfit: route.profit,
    returnTrade: { good: returnLeg.good, name: returnLeg.name, quantity: back.delivered,
      from: candidate.source.name, to: candidate.target.name, source: returnLeg.source, target: returnLeg.target,
      buy: returnLeg.buy, sell: returnLeg.sell, profit: back.profit,
      limiting: back.limiting.map(label => label === 'RHW stock above its reserve' ? 'Seller stock above its reserve' : label) },
    emptyReturn: { profit: route.profit, seconds: route.seconds, hourlyProfit: route.hourlyProfit },
    extraSeconds: seconds - route.seconds, returnChecked: true };
}
