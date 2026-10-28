/* RHW exports with optional verified return cargo. Quote only supported loads;
   keep DTR's shared market/navigation/accounting owners unchanged. */
import { validateDataset } from './core/trade.mjs';
import { ShipNavigator, flightKey } from './navigation.mjs';
import { findRhw, findCommodity } from './planner.mjs';
import { quoteExport } from './export-quote.mjs';
import { returnMarkets, selectReturnMarkets, quoteExportReturn, trimRouteCache } from './return-planner.mjs';
export { quoteExport } from './export-quote.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const order = (a, b) => Number(a.identityState === 'conditional') - Number(b.identityState === 'conditional')
  || b.hourlyProfit - a.hourlyProfit || b.profit - a.profit || a.seconds - b.seconds;

export function rankExportRoutes(routes, limit = 5) {
  const profitable = routes.filter(route => route.profit > 1e-6 && (route.outboundProfit ?? route.profit) >= -1e-6);
  const sorted = [...(profitable.length ? profitable : routes)].sort(order);
  const selected = [], buyers = new Set();
  for (const route of sorted) {
    if (buyers.has(route.buyer.id)) continue;
    buyers.add(route.buyer.id);
    selected.push({ ...route, label: !selected.length && profitable.length ? 'RECOMMENDED · BEST ROUND-TRIP $/H'
      : profitable.length ? 'ALTERNATIVE BUYER' : 'NO HAULER PROFIT · CHECK PRICES',
    recommendation: !selected.length && profitable.length ? { kind: 'export-profit' } : null });
    if (selected.length >= limit) break;
  }
  return selected;
}

export async function searchExports(dataset, navigation, profiles, options = {}, progress = () => {}, canceled = () => false) {
  validateDataset(dataset);
  const rhw = findRhw(dataset), commodity = findCommodity(dataset, options.commodity);
  if (!rhw) throw Error('Resolution Heavy Works was not uniquely found in the POB feed.');
  if (!commodity) throw Error('This commodity was not found in the market feed.');
  if (!rhw.offers.some(item => item.id === commodity.id && item.buy > 0)) throw Error('RHW has no reported sale quotation for this commodity.');
  const blocked = new Set(options.blocked || []);
  const bases = dataset.bases.filter(base => !blocked.has(base.id) && !base.fallback
    && (options.includePobs !== false || base.kind !== 'pob' || base.id === rhw.id));
  if (!bases.some(base => base.id === rhw.id)) throw Error('RHW is excluded by the docking profile.');
  const byId = new Map(bases.map(base => [base.id, base])), navigators = new Map(), flights = new Map(), routes = [];
  const started = performance.now(), timeLimit = Math.min(30000, Math.max(1000, options.searchMs || 18000));
  const settings = { dock: 30, jump: 15, lane: 10, charge: 5, ...options.timeModel };
  const returnEnabled = options.returnCargo !== false;
  const extraPercent = Math.min(50, Math.max(0, Number(options.extraPercent ?? 20) || 0));
  const directLimit = returnEnabled ? timeLimit * .6 : timeLimit;
  let checked = 0, buyers = 0, ships = 0, timedOut = false, pruned = false, directStopped = false, returnChecked = 0;
  for (const profile of profiles.slice(0, options.profileLimit || 6)) {
    if (canceled()) break;
    if (performance.now() - started >= directLimit) { pruned = true; break; }
    const key = flightKey(navigation, profile);
    if (!flights.has(key)) flights.set(key, new ShipNavigator(navigation, bases, profile, settings));
    const navigator = flights.get(key), outward = navigator.from(rhw.id);
    if (!outward) continue;
    navigators.set(profile.id, navigator); ships++;
    const candidates = bases.filter(base => base.id !== rhw.id).flatMap(base => {
      const identityState = options.routeEligibility?.(profile, [rhw.id, base.id]);
      if (identityState === 'blocked') return [];
      const quote = quoteExport(rhw, base, commodity.id, profile, options);
      const seconds = outward.times.get(navigator.baseNodes.get(base.id));
      if (!quote || !finite(seconds)) return [];
      return [{ base, quote, identityState, estimate: quote.profit * 3600 / Math.max(1, 2 * seconds + 3 * settings.dock) }];
    }).sort((a, b) => b.estimate - a.estimate);
    buyers += candidates.length;
    for (const { base, quote, identityState } of candidates) {
      if (canceled()) break;
      if (performance.now() - started >= directLimit) { directStopped = true; pruned = true; break; }
      checked++;
      const outbound = navigator.route(rhw.id, base.id), inbound = navigator.route(base.id, rhw.id);
      // A full route map per destination is not retained for the whole market.
      navigator.cache.delete(base.id);
      if (!outbound || !inbound) continue;
      const seconds = outbound.seconds + inbound.seconds + 3 * settings.dock;
      if (!(seconds > 0)) continue;
      routes.push({ ...quote, ...(identityState ? { identityState } : {}), ship: profile, seconds, deliverySeconds: outbound.seconds + 2 * settings.dock,
        jumps: outbound.jumps + inbound.jumps, unitsPerHour: quote.delivered * 3600 / seconds,
        hourlyProfit: quote.profit * 3600 / seconds, stops: [rhw.id, base.id, rhw.id], outboundProfit: quote.profit,
        legs: [quote.leg, { source: base.id, target: rhw.id, good: null, name: 'Empty return', volume: 0, margin: 0 }],
        quantities: [quote.delivered, 0], returnChecked: false });
      if (checked % 8 === 0) { progress({ phase: 'export', checked }); await pause(); }
    }
    if (directStopped) break;
  }
  if (returnEnabled && !canceled()) {
    const markets = new Map();
    for (const route of [...routes].filter(row => row.profit >= 0).sort(order)) {
      if (canceled()) break;
      if (performance.now() - started >= timeLimit) { timedOut = true; break; }
      const navigator = navigators.get(route.ship.id);
      if (!markets.has(route.ship.id)) markets.set(route.ship.id, returnMarkets(bases, rhw, route.ship, commodity.id));
      const shortlist = selectReturnMarkets(markets.get(route.ship.id), route, navigator, extraPercent);
      pruned ||= shortlist.pruned;
      route.returnChecked = true;
      let best = route, paid = null;
      for (const candidate of shortlist.candidates) {
        if (canceled()) break;
        if (performance.now() - started >= timeLimit) { timedOut = true; break; }
        returnChecked++;
        const quoted = quoteExportReturn(route, candidate, byId, route.ship, navigator, settings, { ...options, extraPercent });
        if (quoted && (route.identityState !== 'checked' || quoted.identityState !== 'conditional')
          && (!paid || order(quoted, paid) < 0)) paid = quoted;
        if (quoted && order(quoted, best) < 0) best = quoted;
        if (returnChecked % 8 === 0) { progress({ phase: 'return', checked: checked + returnChecked }); await pause(); }
      }
      if (best !== route) Object.assign(route, best);
      else if (paid) route.returnAlternative = { ...paid.returnTrade, seconds: paid.seconds, hourlyProfit: paid.hourlyProfit,
        extraSeconds: paid.extraSeconds, totalProfit: paid.profit };
      trimRouteCache(navigator, [rhw.id]);
      if (timedOut) break;
    }
  }
  const selected = rankExportRoutes(routes);
  return { mode: 'export', commodity: { id: commodity.id, name: commodity.name }, origin: rhw.id,
    results: selected.map(route => {
      const navigator = navigators.get(route.ship.id);
      return { ...route, legs: route.legs.map(leg => ({ ...leg,
        from: byId.get(leg.source).name, to: byId.get(leg.target).name,
        fromSystem: byId.get(leg.source).systemName, toSystem: byId.get(leg.target).systemName,
        flight: navigator.route(leg.source, leg.target, true) })) };
    }), stats: { checked, sources: buyers, ships, timedOut, pruned, canceled: canceled(), returnEnabled, returnChecked, extraPercent,
      noProfit: selected.length > 0 && !selected.some(route => route.recommendation) } };
}
