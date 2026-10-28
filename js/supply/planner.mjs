/* RHW supply planning. DTR market, navigation and cargo accounting are reused
   unchanged; this search maximizes delivery before considering hauling profit. */
import solver from './core/vendor/lp-solver.mjs';
import { makeLeg, simulate, volumeFor, validateDataset } from './core/trade.mjs';
import { Navigator } from './core/navigation.mjs';
import { trimRouteCache } from './return-planner.mjs';

export const normalize = value => String(value ?? '').toLowerCase().replace(/platings\b/g, 'plating').replace(/[^a-z0-9]+/g, ' ').trim();
const finite = value => typeof value === 'number' && Number.isFinite(value);
const empty = (source, target) => ({ source, target, good: null, name: 'Empty approach', volume: 0, margin: 0 });
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
export function findRhw(dataset) {
  const matches = dataset.bases.filter(base => base.kind === 'pob' && normalize(base.name) === 'resolution heavy works');
  return matches.length === 1 ? matches[0] : null;
}
export function findCommodity(dataset, name) {
  const target = normalize(name), rhw = findRhw(dataset);
  return rhw?.offers.find(item => item.id === name || normalize(item.name) === target)
    || dataset.bases.flatMap(base => base.offers).find(item => item.id === name || normalize(item.name) === target) || null;
}

function deliveryEconomics(route) {
  const leg = route.legs?.at(-1), amount = route.delivered;
  if (!leg?.good || !finite(leg.buy) || !finite(leg.sell) || !finite(amount) || amount <= 0) return null;
  const cost = amount * leg.buy, payout = amount * leg.sell, margin = payout - cost;
  return { buyPerUnit: leg.buy, rhwPerUnit: leg.sell, cost, payout, margin, loss: Math.max(0, -margin) };
}

// Every constraint applies in transaction order, including changes to RHW's
// cash/space from an outbound sale. Target delivery is fixed before profit is
// optimized, so a lucrative side trade cannot replace the requested cargo.
export function quoteSupply(legs, bases, profile, { capital = null, quantity = null } = {}) {
  const targetIndex = legs.length - 1;
  if (targetIndex < 0 || !legs[targetIndex].good) return null;
  const byId = new Map(bases.map(base => [base.id, base]));
  const variables = {}, constraints = {}, ints = {};
  const vector = () => Array(legs.length).fill(0);
  let sequence = 0;
  function add(coefficients, bound) {
    if (!Number.isFinite(bound)) return;
    const id = `c${sequence++}`; constraints[id] = { max: bound };
    coefficients.forEach((value, i) => { if (value) variables[`q${i}`][id] = value; });
  }
  const upperCapital = legs.reduce((sum, leg) => sum + (leg.good ? Math.floor(profile.cargo / leg.volume) * leg.buy : 0), 0);
  const budget = capital === null ? upperCapital : capital;
  if (!(budget >= 0) || !Number.isFinite(budget)) return null;
  legs.forEach((leg, i) => {
    variables[`q${i}`] = { delivery: i === targetIndex ? 1 : 0, profit: leg.good ? leg.margin : 0 };
    ints[`q${i}`] = 1;
  });
  legs.forEach((leg, i) => {
    const bound = vector(); bound[i] = 1;
    add(bound, leg.good ? Math.floor(profile.cargo / leg.volume) : 0);
  });
  const minimum = vector(); minimum[targetIndex] = -1; add(minimum, -1);
  if (quantity !== null) { const maximum = vector(); maximum[targetIndex] = 1; add(maximum, quantity); }
  const playerMoney = vector(), hold = vector(), cash = new Map(), space = new Map(), stocks = new Map();
  const events = [];
  legs.forEach((leg, i) => {
    if (!leg.good) return;
    events.push({ i, kind: 'buy', base: leg.source });
    events.push({ i, kind: 'sell', base: leg.target });
  });
  for (const event of events) {
    const { i, kind } = event, leg = legs[i], base = byId.get(event.base);
    const offer = base?.offers.find(item => item.id === leg.good);
    if (!offer) return null;
    const deltaCash = cash.get(base.id) || vector(); cash.set(base.id, deltaCash);
    const deltaSpace = space.get(base.id) || vector(); space.set(base.id, deltaSpace);
    const stockKey = JSON.stringify([base.id, leg.good]);
    const deltaStock = stocks.get(stockKey) || vector(); stocks.set(stockKey, deltaStock);
    if (kind === 'buy') {
      playerMoney[i] -= leg.buy; hold[i] += leg.volume;
      if (base.kind === 'pob') {
        deltaCash[i] += leg.buy; deltaSpace[i] += leg.sourceVolume; deltaStock[i] -= 1;
        add(deltaStock.map(value => -value), offer.stock - offer.min);
      }
    } else {
      playerMoney[i] += leg.sell; hold[i] -= leg.volume;
      if (base.kind === 'pob') {
        deltaCash[i] -= leg.sell; deltaSpace[i] -= leg.targetVolume; deltaStock[i] += 1;
        add([...deltaStock], offer.max - offer.stock);
      }
    }
    add(playerMoney.map(value => -value), budget);
    add([...hold], profile.cargo); add(hold.map(value => -value), 0);
    if (base.kind === 'pob') {
      add(deltaCash.map(value => -value), base.cash);
      add(deltaSpace.map(value => -value), base.space);
    }
  }
  const model = { variables, ints, constraints, opType: 'max', options: { timeout: 60, tolerance: 0 } };
  const delivered = solver.Solve({ ...model, optimize: 'delivery' });
  if (!delivered.feasible || delivered.bounded === false) return null;
  const amount = Math.round(delivered[`q${targetIndex}`] || 0);
  if (amount < 1) return null;
  const upper = vector(); upper[targetIndex] = 1; add(upper, amount);
  const lower = vector(); lower[targetIndex] = -1; add(lower, -amount);
  const priced = solver.Solve({ ...model, optimize: 'profit' });
  const solved = priced.feasible && priced.bounded !== false ? priced : delivered;
  const quantities = legs.map((leg, i) => leg.good ? Math.round(solved[`q${i}`] || 0) : 0);
  const actualLegs = legs.map((leg, i) => quantities[i] ? leg : empty(leg.source, leg.target));
  const checked = simulate(actualLegs, quantities, bases, { capital: budget, cargo: profile.cargo });
  if (!checked || quantities[targetIndex] !== amount) return null;
  return { ...checked, legs: actualLegs, delivered: amount,
    delivery: deliveryEconomics({ legs: actualLegs, delivered: amount }),
    purchaseCost: checked.events.filter(event => event.kind === 'buy').reduce((sum, event) => sum + event.quantity * event.price, 0),
    rhwPayout: amount * legs[targetIndex].sell };
}

function capacity(leg, source, target, profile, deferTargetResources = false) {
  let amount = Math.floor(profile.cargo / leg.volume);
  const from = source.offers.find(item => item.id === leg.good), to = target.offers.find(item => item.id === leg.good);
  if (source.kind === 'pob') amount = Math.min(amount, Math.floor(from.stock - from.min));
  if (target.kind === 'pob') {
    amount = Math.min(amount, Math.floor(to.max - to.stock));
    if (!deferTargetResources) amount = Math.min(amount, Math.floor(target.cash / leg.sell), Math.floor(target.space / leg.targetVolume));
  }
  return Math.max(0, amount);
}
function bestTrades(source, target, good, profile, limit = 3) {
  return source.offers.filter(item => item.id !== good && item.buy > 0).flatMap(item => {
    const leg = makeLeg(source, target, item.id, profile);
    if (!leg || !(leg.margin > 0)) return [];
    const amount = capacity(leg, source, target, profile);
    return amount > 0 ? [{ leg, potential: amount * leg.margin }] : [];
  }).sort((a, b) => b.potential - a.potential).slice(0, limit);
}
const signature = route => JSON.stringify([route.ship.id, route.legs.map((leg, i) => [leg.source, leg.target, leg.good, route.quantities[i]])]);
const supplySort = (a, b) => b.unitsPerHour - a.unitsPerHour || a.seconds - b.seconds || b.hourlyProfit - a.hourlyProfit;
const normalDelivery = route => route.delivery && route.delivery.margin >= -1e-6;
function fastSupplyBaseline(routes) {
  const direct = routes.filter(route => !route.extraStop).sort(supplySort);
  return direct.find(normalDelivery) || direct[0] || null;
}
function bestEarning(routes, baseline, allowance) {
  return routes.filter(route => (!route.extraStop || allowance > 0)
    && route.seconds <= baseline.seconds * (1 + allowance / 100) + 0.01
    && route.unitsPerHour >= baseline.unitsPerHour / (1 + allowance / 100) - 0.01
    && route.profit > 0).sort((a, b) => b.hourlyProfit - a.hourlyProfit
      || supplySort(a, b) || a.capitalNeeded - b.capitalNeeded)[0];
}

// Normal procurement never loses money on the requested material itself. A
// profitable export must not disguise an expensive inbound purchase. Express
// quotes remain available, but cannot tighten the normal supply time window.
export function rankSupplyRoutes(routes, extraPercent = 20) {
  const quoted = routes.map(route => ({ ...route, delivery: deliveryEconomics(route) }));
  const normal = quoted.filter(normalDelivery);
  const direct = normal.filter(route => !route.extraStop).sort(supplySort);
  const baseline = direct[0] || [...normal].sort(supplySort)[0];
  const allowance = Math.min(50, Math.max(0, Number(extraPercent) || 0));
  const selected = [], signatures = new Set();
  function pick(route, label, recommendation) {
    if (!route || signatures.has(signature(route))) return;
    signatures.add(signature(route)); selected.push({ ...route, label, ...(recommendation ? { recommendation } : {}) });
  }
  if (baseline) {
    const earning = bestEarning(normal, baseline, allowance);
    const recommended = earning?.hourlyProfit > baseline.hourlyProfit + 0.01 ? earning : baseline;
    pick(recommended, recommended === baseline ? 'RECOMMENDED · STANDARD IMPORT' : 'RECOMMENDED · BEST $/H WITHIN LIMIT', {
      kind: recommended === baseline ? 'fast-supply' : 'profit-within-limit',
      fastDelivered: baseline.delivered,
      profitDelta: recommended.profit - baseline.profit,
      hourlyProfitDelta: recommended.hourlyProfit - baseline.hourlyProfit
    });
    if (recommended !== baseline) pick(baseline, 'FAST IMPORT');
  }
  const express = quoted.filter(route => route.delivery?.loss > 1e-6
    && (!route.extraStop || allowance > 0)
    && (!baseline || route.seconds < baseline.seconds - 1 || route.unitsPerHour > baseline.unitsPerHour + 0.01))
    .sort(supplySort);
  if (express.length) {
    const fastExpress = express.find(route => !route.extraStop) || express[0];
    const earningExpress = bestEarning(express, fastExpress, allowance);
    const bestExpress = earningExpress?.hourlyProfit > fastExpress.hourlyProfit + 0.01 ? earningExpress : fastExpress;
    pick(bestExpress, baseline ? 'EXPRESS OPTION · DELIVERY LOSS' : 'EXPRESS ONLY · DELIVERY LOSS');
  }
  if (baseline) {
    const quick = [...direct].sort((a, b) => a.seconds - b.seconds || supplySort(a, b))[0];
    if (quick && quick.seconds < baseline.seconds - 1) pick(quick, 'QUICKEST RETURN');
  }
  return selected.slice(0, 3);
}

export async function searchSupply(dataset, navigation, profiles, options = {}, progress = () => {}, canceled = () => false) {
  validateDataset(dataset);
  const rhw = findRhw(dataset), commodity = findCommodity(dataset, options.commodity);
  if (!rhw) throw Error('Resolution Heavy Works was not uniquely found in the POB feed.');
  if (!commodity) throw Error('This commodity was not found in the market feed.');
  if (!rhw.offers.some(item => item.id === commodity.id && item.sell > 0)) throw Error('RHW has no reported purchase quotation for this commodity.');
  const began = performance.now(), timeLimit = Math.min(30000, Math.max(1000, options.searchMs || 18000));
  const blocked = new Set(options.blocked || []);
  const bases = dataset.bases.filter(base => !blocked.has(base.id) && !base.fallback && (options.includePobs !== false || base.kind !== 'pob' || base.id === rhw.id));
  if (!bases.some(base => base.id === rhw.id)) throw Error('RHW is excluded by the docking profile.');
  const byId = new Map(bases.map(base => [base.id, base])), routes = [], contexts = [];
  let checked = 0, searchedSources = 0, pruned = false, timedOut = false;
  const withinBudget = () => !canceled() && performance.now() - began < timeLimit;
  const settings = { dock: 30, jump: 15, lane: 10, charge: 5, ...options.timeModel };
  const budget = { capital: finite(options.capital) ? Math.max(0, options.capital) : null,
    quantity: finite(options.quantity) && options.quantity > 0 ? Math.floor(options.quantity) : null };
  function evaluate(legs, navigator, profile, extraStop = false) {
    checked++;
    const visited = [...new Set(legs.flatMap(leg => [leg.source, leg.target]))].map(id => byId.get(id));
    const travel = legs.map(leg => navigator.route(leg.source, leg.target));
    trimRouteCache(navigator, [rhw.id]);
    if (travel.some(route => !route)) return null;
    const quote = quoteSupply(legs, visited, profile, budget);
    if (!quote || extraStop && !quote.quantities.at(-2)) return null;
    const seconds = travel.reduce((sum, route) => sum + route.seconds, 0) + (legs.length + 1) * settings.dock;
    if (!(seconds > 0)) return null;
    const result = { ...quote, ship: profile, seconds, jumps: travel.reduce((sum, route) => sum + route.jumps, 0),
      unitsPerHour: quote.delivered * 3600 / seconds, hourlyProfit: quote.profit * 3600 / seconds,
      extraStop, navigator, stops: [legs[0].source, ...legs.map(leg => leg.target)] };
    routes.push(result); return result;
  }
  for (const profile of profiles.slice(0, 6)) {
    if (!withinBudget()) { timedOut = true; break; }
    const navigator = new Navigator(navigation, bases, profile, settings);
    const outward = navigator.from(rhw.id);
    if (!outward) continue;
    const suppliers = bases.filter(base => base.id !== rhw.id).flatMap(base => {
      const leg = makeLeg(base, rhw, commodity.id, profile);
      const out = outward.times.get(navigator.baseNodes.get(base.id));
      if (!leg || !Number.isFinite(out) || !navigator.allowed(navigator.nodes.get(navigator.baseNodes.get(base.id)))) return [];
      const amount = capacity(leg, base, rhw, profile, true);
      return amount > 0 ? [{ base, leg, rank: amount / Math.max(1, 2 * out + 3 * settings.dock) }] : [];
    }).sort((a, b) => b.rank - a.rank || a.leg.buy - b.leg.buy);
    if (suppliers.length > 36) pruned = true;
    // Preserve ordinary sources even when many nearby POBs quote a material
    // above RHW's payout. Reserve some comparisons for express alternatives.
    const ordinary = suppliers.filter(row => row.leg.margin >= -1e-6);
    const express = suppliers.filter(row => row.leg.margin < -1e-6);
    const selected = ordinary.slice(0, 28).concat(express.slice(0, 8));
    const retained = new Set(selected);
    for (const supplier of ordinary.concat(express)) {
      if (selected.length >= 36) break;
      if (!retained.has(supplier)) { selected.push(supplier); retained.add(supplier); }
    }
    contexts.push({ profile, navigator, selected });
    for (const supplier of selected) {
      if (!withinBudget()) { timedOut = true; break; }
      searchedSources++;
      const originLegs = [empty(rhw.id, supplier.base.id), ...bestTrades(rhw, supplier.base, commodity.id, profile).map(item => item.leg)];
      for (const first of originLegs) evaluate([first, supplier.leg], navigator, profile);
      if (searchedSources % 4 === 0) { progress({ phase: 'direct', checked, sources: searchedSources }); await pause(); }
    }
  }
  const baseline = fastSupplyBaseline(routes);
  const extraPercent = Math.min(50, Math.max(0, Number(options.extraPercent) || 0));
  const maxSeconds = baseline ? baseline.seconds * (1 + extraPercent / 100) : 0;
  if (baseline && extraPercent > 0) for (const { profile, navigator, selected } of contexts) {
    for (const supplier of selected) {
      if (!withinBudget()) { timedOut = true; break; }
      const inbound = navigator.route(supplier.base.id, rhw.id);
      if (!inbound) continue;
      const hops = [];
      for (const hop of bases) {
        if (hop.id === rhw.id || hop.id === supplier.base.id) continue;
        const out = navigator.route(rhw.id, hop.id);
        if (!out || out.seconds + inbound.seconds + 4 * settings.dock > maxSeconds) continue;
        for (const trade of bestTrades(hop, supplier.base, commodity.id, profile, 2)) hops.push({ hop, ...trade, approach: out.seconds });
      }
      hops.sort((a, b) => b.potential / Math.max(1, b.approach + inbound.seconds) - a.potential / Math.max(1, a.approach + inbound.seconds));
      if (hops.length > 32) pruned = true;
      for (const candidate of hops.slice(0, 32)) {
        if (!withinBudget()) { timedOut = true; break; }
        const middle = navigator.route(candidate.hop.id, supplier.base.id);
        trimRouteCache(navigator, [rhw.id, supplier.base.id]);
        if (!middle || candidate.approach + middle.seconds + inbound.seconds + 4 * settings.dock > maxSeconds) continue;
        const originLegs = [empty(rhw.id, candidate.hop.id), ...bestTrades(rhw, candidate.hop, commodity.id, profile, 2).map(item => item.leg)];
        for (const first of originLegs) evaluate([first, candidate.leg, supplier.leg], navigator, profile, true);
        if (checked % 8 < 3) { progress({ phase: 'backhaul', checked, sources: searchedSources }); await pause(); }
      }
    }
  }
  const selected = rankSupplyRoutes(routes, extraPercent);
  return { commodity: { id: commodity.id, name: commodity.name }, origin: rhw.id,
    results: selected.slice(0, 3).map(route => {
      const { navigator, bases: _state, ...data } = route;
      return { ...data, extraSeconds: baseline ? route.seconds - baseline.seconds : 0,
        legs: data.legs.map(leg => ({ ...leg, from: byId.get(leg.source)?.name, to: byId.get(leg.target)?.name,
          fromSystem: byId.get(leg.source)?.systemName, toSystem: byId.get(leg.target)?.systemName,
          flight: navigator.route(leg.source, leg.target, true) })) };
    }), stats: { checked, sources: searchedSources, ships: contexts.length, pruned, timedOut, canceled: canceled(), extraPercent,
      benchmarkSeconds: baseline?.seconds ?? null,
      expressOnly: selected.length > 0 && !selected.some(route => route.recommendation) } };
}
