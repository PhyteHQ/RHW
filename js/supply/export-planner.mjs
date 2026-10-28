/* Direct RHW exports. Quote only quantities the full transaction can support;
   keep DTR's shared market/navigation/accounting owners unchanged. */
import { makeLeg, simulate, validateDataset } from './core/trade.mjs';
import { Navigator } from './core/navigation.mjs';
import { findRhw, findCommodity } from './planner.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const whole = value => Math.max(0, Math.floor(value + 1e-9));
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const order = (a, b) => b.hourlyProfit - a.hourlyProfit || b.profit - a.profit || a.seconds - b.seconds;

export function quoteExport(source, target, commodity, profile, { capital = null, quantity = null } = {}) {
  if (!finite(profile.cargo) || profile.cargo <= 0 || source.id === target.id) return null;
  if (capital !== null && (!finite(capital) || capital < 0)) return null;
  if (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 1)) return null;
  const leg = makeLeg(source, target, commodity, profile);
  if (!leg) return null;
  const from = source.offers.find(item => item.id === commodity), to = target.offers.find(item => item.id === commodity);
  const limits = [{ key: 'hold', label: 'Ship hold', units: whole(profile.cargo / leg.volume) }];
  if (source.kind === 'pob') limits.push({ key: 'stock', label: 'RHW stock above its reserve', units: whole(from.stock - from.min) });
  if (target.kind === 'pob') limits.push(
    { key: 'demand', label: 'Buyer purchase limit', units: whole(to.max - to.stock) },
    { key: 'cash', label: 'Buyer funds', units: whole(target.cash / leg.sell) },
    { key: 'space', label: 'Buyer free storage', units: whole(target.space / leg.targetVolume) });
  if (capital !== null) limits.push({ key: 'capital', label: 'Starting capital', units: whole(capital / leg.buy) });
  if (quantity !== null) limits.push({ key: 'quantity', label: 'Requested quantity', units: quantity });
  const amount = Math.min(...limits.map(limit => limit.units));
  if (!Number.isSafeInteger(amount) || amount < 1) return null;
  const cost = amount * leg.buy;
  const verified = simulate([leg], [amount], [source, target], { capital: capital ?? cost, cargo: profile.cargo });
  if (!verified) return null;
  const { bases: _state, ...checked } = verified;
  return { ...checked, leg, delivered: amount, purchaseCost: cost, rhwRevenue: cost,
    buyerPayout: amount * leg.sell, limits, limiting: limits.filter(limit => limit.units === amount).map(limit => limit.label),
    buyer: { id: target.id, name: target.name, kind: target.kind, cash: target.cash,
      demand: target.kind === 'pob' ? whole(to.max - to.stock) : null,
      space: target.space, storagePerUnit: leg.targetVolume, price: leg.sell },
    availableAtRhw: source.kind === 'pob' ? whole(from.stock - from.min) : null };
}

export function rankExportRoutes(routes, limit = 5) {
  const profitable = routes.filter(route => route.profit > 1e-6);
  const sorted = [...(profitable.length ? profitable : routes)].sort(order);
  const selected = [], buyers = new Set();
  for (const route of sorted) {
    if (buyers.has(route.buyer.id)) continue;
    buyers.add(route.buyer.id);
    selected.push({ ...route, label: !selected.length && profitable.length ? 'RECOMMENDED · BEST EXPORT $/H'
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
  const byId = new Map(bases.map(base => [base.id, base])), navigators = new Map(), routes = [];
  const started = performance.now(), timeLimit = Math.min(30000, Math.max(1000, options.searchMs || 18000));
  const settings = { dock: 30, jump: 15, lane: 10, charge: 5, ...options.timeModel };
  let checked = 0, buyers = 0, ships = 0, timedOut = false;
  for (const profile of profiles.slice(0, 6)) {
    if (canceled()) break;
    const navigator = new Navigator(navigation, bases, profile, settings), outward = navigator.from(rhw.id);
    if (!outward) continue;
    navigators.set(profile.id, navigator); ships++;
    const candidates = bases.filter(base => base.id !== rhw.id).flatMap(base => {
      const quote = quoteExport(rhw, base, commodity.id, profile, options);
      const seconds = outward.times.get(navigator.baseNodes.get(base.id));
      if (!quote || !finite(seconds)) return [];
      return [{ base, quote, estimate: quote.profit * 3600 / Math.max(1, 2 * seconds + 3 * settings.dock) }];
    }).sort((a, b) => b.estimate - a.estimate);
    buyers += candidates.length;
    for (const { base, quote } of candidates) {
      if (canceled()) break;
      if (performance.now() - started >= timeLimit) { timedOut = true; break; }
      checked++;
      const outbound = navigator.route(rhw.id, base.id), inbound = navigator.route(base.id, rhw.id);
      // A full route map per destination is not retained for the whole market.
      navigator.cache.delete(base.id);
      if (!outbound || !inbound) continue;
      const seconds = outbound.seconds + inbound.seconds + 3 * settings.dock;
      if (!(seconds > 0)) continue;
      routes.push({ ...quote, ship: profile, seconds, deliverySeconds: outbound.seconds + 2 * settings.dock,
        jumps: outbound.jumps + inbound.jumps, unitsPerHour: quote.delivered * 3600 / seconds,
        hourlyProfit: quote.profit * 3600 / seconds, stops: [rhw.id, base.id, rhw.id] });
      if (checked % 8 === 0) { progress({ phase: 'export', checked }); await pause(); }
    }
    if (timedOut) break;
  }
  const selected = rankExportRoutes(routes);
  return { mode: 'export', commodity: { id: commodity.id, name: commodity.name }, origin: rhw.id,
    results: selected.map(route => {
      const navigator = navigators.get(route.ship.id);
      const legs = [route.leg, { source: route.buyer.id, target: rhw.id, good: null, name: 'Empty return', volume: 0, margin: 0 }];
      return { ...route, quantities: [route.delivered, 0], legs: legs.map(leg => ({ ...leg,
        from: byId.get(leg.source).name, to: byId.get(leg.target).name,
        fromSystem: byId.get(leg.source).systemName, toSystem: byId.get(leg.target).systemName,
        flight: navigator.route(leg.source, leg.target, true) })) };
    }), stats: { checked, sources: buyers, ships, timedOut, canceled: canceled(),
      noProfit: selected.length > 0 && !selected.some(route => route.recommendation) } };
}
