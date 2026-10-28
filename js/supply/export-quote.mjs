/* Exact whole-unit delivery quotes, checked by the shared transaction simulator. */
import { makeLeg, simulate } from './core/trade.mjs';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const whole = value => Math.max(0, Math.floor(value + 1e-9));

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

