/* Read NPC quotations once per base. The commodity-centric market export
   repeats large nested POB records, although those markets are discarded. */
import { normalizeDarkstat, finite, number } from './core/trade.mjs';
import { enrichBaseOwners } from './access.mjs';

export function normalizeNpcMarket(commodities, bases) {
  const generic = new Map(commodities.filter(row => row.ship_class == null).map(row => [row.nickname, row]));
  const markets = new Map();
  for (const base of bases) {
    if (base.IsPob || base.kind === 'pob') continue;
    for (const quote of base.market_goods || []) {
      const good = generic.get(quote.nickname);
      if (!good || quote.PoB || quote.PoBGood || quote.category && quote.category !== 'commodity') continue;
      if (!markets.has(good.nickname)) markets.set(good.nickname, []);
      markets.get(good.nickname).push({ ...quote,
        base_nickname: base.nickname, base_name: base.name || quote.base_name,
        system_nick: base.system_nickname || quote.system_nick,
        system_name: base.system_name || quote.system_name,
        base_pos: quote.base_pos ?? base.pos, volume: good.volume });
    }
  }
  const feed = commodities.map(row => ({ ...row,
    market_goods: row.ship_class == null ? markets.get(row.nickname) || [] : [] }));
  const data = normalizeDarkstat([], feed);
  data.bases = enrichBaseOwners(data.bases, bases, [], feed);
  // POB-only products also need cargo-class overrides, even when no NPC has
  // a quotation for them. Do not make metadata depend on having an NPC offer.
  const goods = new Map();
  for (const row of commodities) {
    if (!row.nickname) continue;
    if (!goods.has(row.nickname)) goods.set(row.nickname, { id: row.nickname, name: row.name, volume: null, volumes: {} });
    const item = goods.get(row.nickname);
    if (finite(row.volume) && row.volume > 0) item.volumes[row.ship_class ?? 'default'] = Number(row.volume);
    if (row.ship_class == null) item.volume = number(row.volume);
  }
  data.goods = [...goods.values()];
  return data;
}
