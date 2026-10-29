import solver from './vendor/lp-solver.mjs';
import { cargoItems, optimizeMixedTour, simulateMixedTour } from './cargo.mjs';
export { cargoItems } from './cargo.mjs';

export const PROFILES = Object.freeze([
  { id: 'freighter-5000', name: '5,000 Cargo', cargo: 5000, cruise: 350, dock: 'medium', volumeClass: null },
  { id: 'freighter-4300', name: '4,300 Cargo', cargo: 4300, cruise: 410, dock: 'medium', volumeClass: null },
  { id: 'freighter-3600', name: '3,600 Cargo', cargo: 3600, cruise: 500, dock: 'medium', volumeClass: null },
]);
export const EPS = 1e-6;
export const finite = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value));
export const number = value => finite(value) ? Number(value) : null;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const key = (base, good) => JSON.stringify([base, good]);
const vector = value => Array.isArray(value) && value.length === 3 && value.every(finite) ? value.map(Number) :
  plain(value) && ['X', 'Y', 'Z'].every(k => finite(value[k])) ? [value.X, value.Y, value.Z].map(Number) : null;

export function validateDataset(data) {
  if (!plain(data) || data.schema !== 1 || !Array.isArray(data.bases) || data.bases.length > 10000) throw new Error('Ungültiges WAYPOINT-Datenformat.');
  const ids = new Set();
  for (const base of data.bases) {
    if (!plain(base) || typeof base.id !== 'string' || !base.id || ids.has(base.id) || !['npc', 'pob'].includes(base.kind) || !Array.isArray(base.offers)) throw new Error('Ungültiger oder doppelter Basisdatensatz.');
    ids.add(base.id);
    if (base.offers.length > 2000) throw new Error('Zu viele Waren pro Basis.');
    for (const field of ['cash', 'space']) if (base[field] != null && (!finite(base[field]) || base[field] < 0)) throw new Error('Ungültiger Geld- oder Lagerbestand.');
    const goods = new Set();
    for (const item of base.offers) {
      if (!plain(item) || typeof item.id !== 'string' || goods.has(item.id)) throw new Error('Ungültige oder doppelte Ware.');
      goods.add(item.id);
      for (const f of ['stock', 'min', 'max', 'buy', 'sell', 'volume', 'originalVolume']) if (item[f] != null && (!finite(item[f]) || item[f] < 0)) throw new Error(`Ungültiger Warenwert: ${f}`);
    }
  }
  if (typeof data.asOf !== 'string' || !Number.isFinite(Date.parse(data.asOf))) throw new Error('Ungültiger Datenzeitpunkt.');
  return data;
}

export function normalizeDarkstat(pobs, commodities, receivedAt = new Date().toISOString()) {
  if (!Array.isArray(pobs) || !Array.isArray(commodities)) throw new Error('Darkstat hat kein gültiges Marktformat geliefert.');
  const bases = new Map(), goodInfo = new Map();
  for (const commodity of commodities) {
    if (!commodity?.nickname) continue;
    let good = goodInfo.get(commodity.nickname);
    if (!good) goodInfo.set(commodity.nickname, good = { id: commodity.nickname, name: commodity.name || commodity.nickname, volumes: {} });
    if (finite(commodity.volume) && commodity.volume > 0) good.volumes[commodity.ship_class ?? 'default'] = Number(commodity.volume);
    if (commodity.ship_class == null) good.volume = number(commodity.volume);
    for (const market of commodity.market_goods || []) {
      // POB entries are reconstructed exclusively from the complete POB snapshot.
      if (market.PoB || market.PoBGood || !market.base_nickname || !market.system_nick || /^README$/i.test(market.system_name || '')) continue;
      let base = bases.get(market.base_nickname);
      if (!base) bases.set(market.base_nickname, base = { id: market.base_nickname, name: market.base_name || market.base_nickname,
        kind: 'npc', system: market.system_nick, systemName: market.system_name, pos: vector(market.base_pos), offers: [], cash: null, space: null });
      if (commodity.ship_class != null) continue;
      const existing = base.offers.find(x => x.id === commodity.nickname);
      const offer = { id: commodity.nickname, name: good.name, buy: market.base_sells === true ? number(market.price_base_sells_for) : null,
        sell: number(market.price_base_buys_for), volume: number(market.volume), originalVolume: number(market.volume),
        stock: null, min: null, max: null, volumes: good.volumes };
      if (!existing) base.offers.push(offer);
    }
  }
  for (const pob of pobs) {
    if (!pob?.nickname || !Array.isArray(pob.shop_items)) continue;
    const base = { id: pob.nickname, name: pob.name || pob.nickname, kind: 'pob', system: pob.system_nickname,
      systemName: pob.system_name, pos: vector(pob.base_pos), cash: number(pob.money), space: number(pob.cargospace),
      docking: pob.defense_mode ?? null, fallback: Boolean(pob.is_fallback_info), offers: [] };
    const seen = new Set();
    for (const item of pob.shop_items) {
      if (!item?.nickname || seen.has(item.nickname) || item.ship_class != null || (item.category && item.category !== 'commodity')) continue;
      seen.add(item.nickname);
      const good = goodInfo.get(item.nickname);
      base.offers.push({ id: item.nickname, name: item.name || good?.name || item.nickname,
        buy: number(item.price), sell: number(item.sell_price), stock: number(item.quantity), min: number(item.min_stock), max: number(item.max_stock),
        volume: number(item.volume) ?? good?.volume ?? null, originalVolume: number(item.original_volume), volumes: good?.volumes || {} });
    }
    bases.set(base.id, base);
  }
  return validateDataset({ schema: 1, asOf: receivedAt, source: 'darkstat', timestampKind: 'received', bases: [...bases.values()] });
}

export function volumeFor(item, profile) {
  const v = profile.volumeClass != null && finite(item.volumes?.[profile.volumeClass]) ? item.volumes[profile.volumeClass] : item.volume;
  return finite(v) && v > 0 ? Number(v) : null;
}

export function baseProblems(base, role = 'buyer') {
  if (base.kind !== 'pob' || role === 'seller') return [];
  return ['cash', 'space'].filter(f => !finite(base[f])).map(f => f === 'cash' ? 'POB-Geld fehlt' : 'POB-Lagerplatz fehlt');
}

export function makeLeg(source, target, goodId, profile,
  from = source.offers.find(x => x.id === goodId), to = target.offers.find(x => x.id === goodId)) {
  if (!from || !to || !(from.buy > 0) || !(to.sell > 0)) return null;
  const volume = volumeFor(from, profile);
  if (!volume || (volumeFor(to, profile) != null && Math.abs(volume - volumeFor(to, profile)) > EPS)) return null;
  for (const [base, offer] of [[source, from], [target, to]]) {
    if (baseProblems(base, base === source ? 'seller' : 'buyer').length) return null;
    if (base.kind === 'pob' && (!['stock', 'min', 'max'].every(f => finite(offer[f])) || !(offer.originalVolume > 0))) return null;
  }
  return { source: source.id, target: target.id, good: goodId, name: from.name, buy: from.buy, sell: to.sell,
    volume, sourceVolume: source.kind === 'pob' ? from.originalVolume : volume,
    targetVolume: target.kind === 'pob' ? to.originalVolume : volume, margin: to.sell - from.buy };
}

function eventsFor(legs, mask) {
  const events = [];
  if (legs[0].good) events.push({ kind: 'buy', leg: 0, base: legs[0].source });
  for (let i = 1; i < legs.length; i++) {
    const sell = legs[i - 1].good ? { kind: 'sell', leg: i - 1, base: legs[i - 1].target } : null;
    const buy = legs[i].good ? { kind: 'buy', leg: i, base: legs[i].source } : null;
    for (const event of mask & (1 << (i - 1)) ? [buy, sell] : [sell, buy]) if (event) events.push(event);
  }
  if (legs.at(-1).good) events.push({ kind: 'sell', leg: legs.length - 1, base: legs.at(-1).target });
  return events;
}

export function simulate(legs, quantities, bases, options, mask = 0) {
  if (legs.some(leg => cargoItems(leg).length > 1) || quantities.some(Array.isArray)) return simulateMixedTour(legs, quantities, bases, options, mask);
  const state = new Map(bases.map(b => [b.id, { ...b, offers: b.offers.map(o => ({ ...o })) }]));
  let cash = options.capital, cargo = 0, peakCargo = 0, minCash = cash;
  const events = [];
  for (const event of eventsFor(legs, mask)) {
    const leg = legs[event.leg], q = quantities[event.leg];
    if (!Number.isSafeInteger(q) || q < 1) return null;
    const base = state.get(event.base), offer = base?.offers.find(o => o.id === leg.good);
    if (!base || !offer || baseProblems(base, event.kind === 'buy' ? 'seller' : 'buyer').length) return null;
    const before = { cash: base.cash, space: base.space, stock: offer.stock, player: cash, cargo };
    if (event.kind === 'buy') {
      cash -= q * leg.buy; cargo += q * leg.volume;
      if (base.kind === 'pob') {
        offer.stock -= q;
        if (finite(base.cash)) base.cash += q * leg.buy;
        if (finite(base.space)) base.space += q * leg.sourceVolume;
        if (offer.stock < offer.min - EPS) return null;
      }
    } else {
      cash += q * leg.sell; cargo -= q * leg.volume;
      if (base.kind === 'pob') {
        offer.stock += q; base.cash -= q * leg.sell; base.space -= q * leg.targetVolume;
        if (offer.stock > offer.max + EPS || base.cash < -EPS || base.space < -EPS) return null;
      }
    }
    if (cash < -EPS || cargo < -EPS || cargo > options.cargo + EPS) return null;
    peakCargo = Math.max(peakCargo, cargo); minCash = Math.min(minCash, cash);
    events.push({ ...event, quantity: q, price: event.kind === 'buy' ? leg.buy : leg.sell, before,
      after: { cash: base.cash, space: base.space, stock: offer.stock, player: cash, cargo } });
  }
  if (Math.abs(cargo) > EPS) return null;
  return { profit: cash - options.capital, capitalNeeded: options.capital - minCash, peakCargo, cash, events,
    bases: [...state.values()], quantities, itemQuantities: quantities.map((q, i) => legs[i].good ? [q] : []),
    loads: legs.map((leg, i) => leg.good ? [{ ...leg, quantity: quantities[i] }] : []), orderMask: mask };
}

export function optimizeTour(legs, bases, options) {
  if (!legs.length || !Number.isFinite(options.capital) || options.capital < 0 || !(options.cargo > 0)) return null;
  if (legs.some(leg => cargoItems(leg).length > 1)) return optimizeMixedTour(legs, bases, options);
  const count = legs.length, byId = new Map(bases.map(b => [b.id, b]));
  let best = null;
  const orderChoices = [];
  for (let i = 1; i < count; i++) if (legs[i - 1].good && legs[i].good) orderChoices.push(i - 1);
  for (let choice = 0; choice < 2 ** orderChoices.length; choice++) {
    const mask = orderChoices.reduce((m, bit, i) => m | (choice & (1 << i) ? 1 << bit : 0), 0);
    const variables = {}, constraints = {}, ints = {};
    let constraintId = 0;
    const vectorOf = () => Array(count).fill(0);
    const money = vectorOf(), hold = vectorOf(), baseCash = new Map(), baseSpace = new Map(), stocks = new Map();
    const add = (coeff, bound) => {
      if (!Number.isFinite(bound)) return;
      const id = `c${constraintId++}`; constraints[id] = { max: bound };
      coeff.forEach((c, i) => { if (c) variables[`q${i}`][id] = c; });
    };
    for (let i = 0; i < count; i++) {
      variables[`q${i}`] = { profit: legs[i].good ? legs[i].margin : 0 };
      ints[`q${i}`] = 1;
    }
    for (let i = 0; i < count; i++) {
      const bound = vectorOf(); bound[i] = 1;
      add(bound, legs[i].good ? Math.floor((options.cargo + EPS) / legs[i].volume) : 0);
      if (legs[i].good) { const lower = vectorOf(); lower[i] = -1; add(lower, -1); }
    }
    let invalid = false;
    for (const event of eventsFor(legs, mask)) {
      const i = event.leg, leg = legs[i], base = byId.get(event.base);
      const item = base?.offers.find(o => o.id === leg.good);
      if (!item || baseProblems(base, event.kind === 'buy' ? 'seller' : 'buyer').length) { invalid = true; break; }
      const deltaCash = baseCash.get(base.id) || vectorOf(); baseCash.set(base.id, deltaCash);
      const deltaSpace = baseSpace.get(base.id) || vectorOf(); baseSpace.set(base.id, deltaSpace);
      const stockKey = key(base.id, leg.good), deltaStock = stocks.get(stockKey) || vectorOf(); stocks.set(stockKey, deltaStock);
      if (event.kind === 'buy') {
        money[i] -= leg.buy; hold[i] += leg.volume;
        if (base.kind === 'pob') {
          deltaCash[i] += leg.buy; deltaSpace[i] += leg.sourceVolume; deltaStock[i] -= 1;
          add(deltaStock.map(x => -x), item.stock - item.min);
        }
      } else {
        money[i] += leg.sell; hold[i] -= leg.volume;
        if (base.kind === 'pob') {
          deltaCash[i] -= leg.sell; deltaSpace[i] -= leg.targetVolume; deltaStock[i] += 1;
          add([...deltaStock], item.max - item.stock);
        }
      }
      add(money.map(x => -x), options.capital);
      add([...hold], options.cargo); add(hold.map(x => -x), 0);
      if (base.kind === 'pob') { add(deltaCash.map(x => -x), base.cash); add(deltaSpace.map(x => -x), base.space); }
    }
    if (invalid) continue;
    const result = solver.Solve({ optimize: 'profit', opType: 'max', constraints, variables, ints, options: { timeout: 80, tolerance: 0 } });
    if (!result.feasible || result.bounded === false) continue;
    const quantities = legs.map((leg, i) => leg.good ? Math.round(result[`q${i}`] || 0) : 0);
    const verified = simulate(legs, quantities, bases, options, mask);
    if (verified && verified.profit > EPS && (!best || verified.profit > best.profit + EPS || (Math.abs(verified.profit - best.profit) <= EPS && verified.capitalNeeded < best.capitalNeeded))) best = verified;
  }
  return best;
}

export function repeatTour(legs, first, options, limit = 12) {
  let result = first, total = first.profit, count = 1;
  while (count < limit) {
    const next = optimizeTour(legs, result.bases, { ...options, capital: result.cash });
    if (!next) return { count, capped: false, profit: total };
    result = next; total += next.profit; count++;
  }
  const next = optimizeTour(legs, result.bases, { ...options, capital: result.cash });
  return { count, capped: Boolean(next), profit: total };
}
