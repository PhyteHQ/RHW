import solver from './vendor/lp-solver.mjs';

const EPS = 1e-6;
const known = value => value != null && value !== '' && Number.isFinite(Number(value));
export const cargoItems = leg => leg.items || (leg.good ? [leg] : []);

function eventsFor(legs, mask) {
  const events = [];
  const actions = (leg, kind) => cargoItems(legs[leg]).map((line, item) => ({ kind, leg, item,
    base: kind === 'buy' ? legs[leg].source : legs[leg].target }));
  events.push(...actions(0, 'buy'));
  for (let i = 1; i < legs.length; i++) {
    const sell = actions(i - 1, 'sell'), buy = actions(i, 'buy');
    events.push(...(mask & (1 << (i - 1)) ? [...buy, ...sell] : [...sell, ...buy]));
  }
  events.push(...actions(legs.length - 1, 'sell'));
  return events;
}

export function simulateMixedTour(legs, quantities, bases, options, mask = 0) {
  if (quantities.length !== legs.length) return null;
  for (let i = 0; i < legs.length; i++) {
    const items = cargoItems(legs[i]), q = quantities[i];
    if (!Array.isArray(q) || q.length !== items.length || q.some(n => !Number.isSafeInteger(n) || n < 0)) return null;
    if (items.length && !q.some(n => n > 0)) return null;
  }
  const state = new Map(bases.map(base => [base.id, { ...base,
    cash: known(base.cash) ? Number(base.cash) : null, space: known(base.space) ? Number(base.space) : null,
    offers: base.offers.map(item => ({ ...item, stock: known(item.stock) ? Number(item.stock) : null })) }]));
  let cash = options.capital, cargo = 0, peakCargo = 0, minCash = cash;
  const events = [];
  for (const event of eventsFor(legs, mask)) {
    const line = cargoItems(legs[event.leg])[event.item], q = quantities[event.leg][event.item];
    if (!q) continue;
    const base = state.get(event.base), offer = base?.offers.find(o => o.id === line.good);
    if (!offer || base.kind === 'pob' && ![base.cash, base.space, offer.stock, offer.min, offer.max].every(known)) return null;
    const before = { cash: base.cash, space: base.space, stock: offer.stock, player: cash, cargo };
    if (event.kind === 'buy') {
      cash -= q * line.buy; cargo += q * line.volume;
      if (base.kind === 'pob') {
        offer.stock -= q; base.cash += q * line.buy; base.space += q * line.sourceVolume;
        if (offer.stock < offer.min - EPS) return null;
      }
    } else {
      cash += q * line.sell; cargo -= q * line.volume;
      if (base.kind === 'pob') {
        offer.stock += q; base.cash -= q * line.sell; base.space -= q * line.targetVolume;
        if (offer.stock > offer.max + EPS || base.cash < -EPS || base.space < -EPS) return null;
      }
    }
    if (cash < -EPS || cargo < -EPS || cargo > options.cargo + EPS) return null;
    peakCargo = Math.max(peakCargo, cargo); minCash = Math.min(minCash, cash);
    events.push({ ...event, good: line.good, quantity: q, price: event.kind === 'buy' ? line.buy : line.sell, before,
      after: { cash: base.cash, space: base.space, stock: offer.stock, player: cash, cargo } });
  }
  if (Math.abs(cargo) > EPS) return null;
  const loads = legs.map((leg, i) => cargoItems(leg).flatMap((line, j) => quantities[i][j] ? [{ ...line, quantity: quantities[i][j] }] : []));
  return { profit: cash - options.capital, capitalNeeded: options.capital - minCash, peakCargo, cash, events,
    bases: [...state.values()], quantities: quantities.map(q => q.reduce((a, b) => a + b, 0)),
    itemQuantities: quantities, loads, orderMask: mask };
}

export function optimizeMixedTour(legs, bases, options) {
  const byId = new Map(bases.map(base => [base.id, base])), entries = [], perLeg = [];
  for (let i = 0; i < legs.length; i++) {
    const seen = new Set(); perLeg[i] = [];
    for (const [item, line] of cargoItems(legs[i]).entries()) {
      if (seen.has(line.good) || line.source !== legs[i].source || line.target !== legs[i].target ||
        !(line.volume > 0 && line.buy > 0 && line.sell > line.buy)) return null;
      seen.add(line.good); perLeg[i].push(entries.length); entries.push({ leg: i, item, line });
    }
  }
  if (!entries.length) return null;
  const upper = entries.map(({ line }) => Math.floor((options.cargo + EPS) / line.volume));
  const stockRange = upper.reduce((a, b) => a + b, 0) + 1;
  const orders = [];
  for (let i = 1; i < legs.length; i++) if (perLeg[i - 1].length && perLeg[i].length) orders.push(i - 1);
  let best = null;
  for (let choice = 0; choice < 2 ** orders.length; choice++) {
    const mask = orders.reduce((m, bit, i) => m | (choice & (1 << i) ? 1 << bit : 0), 0);
    const variables = {}, ints = {}, constraints = {}, active = new Map();
    entries.forEach(({ line }, i) => { variables[`q${i}`] = { profit: line.margin }; ints[`q${i}`] = 1; });
    let id = 0;
    const vector = () => Array(entries.length).fill(0);
    const add = (coefficients, bound, extra = {}) => {
      if (!Number.isFinite(bound)) return;
      const constraint = `c${id++}`; constraints[constraint] = { max: bound };
      coefficients.forEach((value, i) => { if (value) variables[`q${i}`][constraint] = value; });
      for (const [name, value] of Object.entries(extra)) if (value) variables[name][constraint] = value;
    };
    entries.forEach((_, i) => { const row = vector(); row[i] = 1; add(row, upper[i]); });
    for (const indices of perLeg) if (indices.length) { const row = vector(); for (const i of indices) row[i] = -1; add(row, -1); }
    const conditional = (coefficients, bound, i) => {
      if (bound >= 0) { add(coefficients, bound); return; }
      // A zero-quantity optional item must not enforce its reserve/demand policy.
      // Activation is needed only for already-understocked/overstocked records.
      let name = active.get(i);
      if (!name) {
        name = `active${i}`; active.set(i, name); variables[name] = { profit: 0 }; ints[name] = 1;
        add(vector(), 1, { [name]: 1 });
        const high = vector(); high[i] = 1; add(high, 0, { [name]: -upper[i] });
        const low = vector(); low[i] = -1; add(low, 0, { [name]: 1 });
      }
      const bigM = stockRange + Math.abs(bound);
      add(coefficients, bound + bigM, { [name]: bigM });
    };
    const money = vector(), hold = vector(), baseCash = new Map(), baseSpace = new Map(), stocks = new Map();
    let invalid = false;
    for (const event of eventsFor(legs, mask)) {
      const i = perLeg[event.leg][event.item], line = entries[i].line, base = byId.get(event.base);
      const item = base?.offers.find(o => o.id === line.good);
      if (!item || base.kind === 'pob' && ![base.cash, base.space, item.stock, item.min, item.max].every(known)) { invalid = true; break; }
      const deltaCash = baseCash.get(base.id) || vector(); baseCash.set(base.id, deltaCash);
      const deltaSpace = baseSpace.get(base.id) || vector(); baseSpace.set(base.id, deltaSpace);
      const key = JSON.stringify([base.id, line.good]), deltaStock = stocks.get(key) || vector(); stocks.set(key, deltaStock);
      if (event.kind === 'buy') {
        money[i] -= line.buy; hold[i] += line.volume;
        if (base.kind === 'pob') {
          deltaCash[i] += line.buy; deltaSpace[i] += line.sourceVolume; deltaStock[i] -= 1;
          conditional(deltaStock.map(x => -x), Number(item.stock) - Number(item.min), i);
        }
      } else {
        money[i] += line.sell; hold[i] -= line.volume;
        if (base.kind === 'pob') {
          deltaCash[i] -= line.sell; deltaSpace[i] -= line.targetVolume; deltaStock[i] += 1;
          conditional([...deltaStock], Number(item.max) - Number(item.stock), i);
        }
      }
      add(money.map(x => -x), options.capital); add([...hold], options.cargo); add(hold.map(x => -x), 0);
      if (base.kind === 'pob') { add(deltaCash.map(x => -x), Number(base.cash)); add(deltaSpace.map(x => -x), Number(base.space)); }
    }
    if (invalid) continue;
    const solved = solver.Solve({ optimize: 'profit', opType: 'max', variables, ints, constraints,
      options: { timeout: 100, tolerance: 0 } });
    if (!solved.feasible || solved.bounded === false) continue;
    const quantities = perLeg.map(indices => indices.map(i => Math.round(solved[`q${i}`] || 0)));
    const verified = simulateMixedTour(legs, quantities, bases, options, mask);
    if (verified && verified.profit > EPS && (!best || verified.profit > best.profit + EPS ||
      Math.abs(verified.profit - best.profit) <= EPS && verified.capitalNeeded < best.capitalNeeded)) best = verified;
  }
  return best;
}
