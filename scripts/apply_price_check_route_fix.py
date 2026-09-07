#!/usr/bin/env python3
from pathlib import Path

path = Path('js/37-app-price-check.js')
text = path.read_text(encoding='utf-8')

old_copper = "    Object.freeze({ key: 'copper', commodity: 'Copper', source: 'Copperland', system: 'Coronado', aliases: ['Copperland'] }),"
new_copper = "    Object.freeze({ key: 'copper', commodity: 'Copper', source: 'Copperland', system: 'Coronado', sourceType: 'pob', sourceNickname: 'copperland', aliases: ['Copperland'] }),"
if old_copper in text:
    text = text.replace(old_copper, new_copper)

market_fn = """  function marketGoodFor(baseEntry, commodity) {
    const target = normalize(commodity);
    const candidates = Array.isArray(baseEntry?.market_goods) ? baseEntry.market_goods : [];
    const matches = candidates.filter(good => normalize(good?.name || good?.nickname) === target);
    if (!matches.length) return null;
    return matches.find(good => good?.base_sells === true && finite(good?.price_base_sells_for) !== null)
      || matches.find(good => finite(good?.price_base_sells_for) !== null)
      || matches[0];
  }
"""
helpers = market_fn + """

  function pobGoodFor(baseEntry, commodity) {
    const target = normalize(commodity);
    const candidates = Array.isArray(baseEntry?.shop_items) ? baseEntry.shop_items : [];
    return candidates.find(good => normalize(good?.name || good?.item_name) === target)
      || candidates.find(good => normalize(good?.nickname) === `commodity ${target}`)
      || null;
  }

  function pobSourceFor(route) {
    try {
      const pobs = typeof allBases !== 'undefined' && Array.isArray(allBases) ? allBases : [];
      const nickname = normalize(route?.sourceNickname || route?.source);
      const name = normalize(route?.source);
      return pobs.find(baseEntry => normalize(baseEntry?.nickname) === nickname)
        || pobs.find(baseEntry => normalize(baseEntry?.name) === name)
        || null;
    } catch {
      return null;
    }
  }
"""
if 'function pobGoodFor' not in text:
    if market_fn not in text:
        raise SystemExit('marketGoodFor block not found')
    text = text.replace(market_fn, helpers)

text = text.replace(
    '    const missing = ROUTES.some(route => !sources[route.key]?.nickname);',
    "    const missing = ROUTES.filter(route => route.sourceType !== 'pob').some(route => !sources[route.key]?.nickname);"
)
text = text.replace(
    '      const missingKnownBase = !full && ROUTES.some(route => {',
    "      const missingKnownBase = !full && ROUTES.filter(route => route.sourceType !== 'pob').some(route => {"
)

old_effective = """  function effectiveRow(route) {
    const market = state.marketCache?.routes?.[route.key] || {};
    const live = finite(market.livePrice);
"""
new_effective = """  function effectiveRow(route) {
    let market = state.marketCache?.routes?.[route.key] || {};
    if (route.sourceType === 'pob') {
      const source = pobSourceFor(route);
      const good = source ? pobGoodFor(source, route.commodity) : null;
      const pobLivePrice = finite(good?.sell_price ?? good?.price_to_buy_from_base ?? good?.buy_price);
      if (source) {
        market = {
          ...market,
          sourceNickname: String(source.nickname || route.sourceNickname || ''),
          sourceName: String(source.name || route.source),
          system: String(source.system_name || source.system || route.system),
          goodNickname: String(good?.nickname || ''),
          livePrice: pobLivePrice,
          found: true,
          sold: pobLivePrice !== null,
          sourceType: 'pob'
        };
      }
    }
    const live = finite(market.livePrice);
"""
if old_effective in text:
    text = text.replace(old_effective, new_effective)
elif "if (route.sourceType === 'pob')" not in text.split('function effectiveRow', 1)[1].split('function statusMarkup', 1)[0]:
    raise SystemExit('effectiveRow block not found')

old_meta = "    const sourceMeta = market.sourceNickname ? `${system} // ${market.sourceNickname}` : `${system} // SOURCE MATCH PENDING`;"
new_meta = """    const sourceMeta = market.sourceType === 'pob'
      ? `${system} // POB ${market.sourceNickname || route.sourceNickname || route.source}`
      : (market.sourceNickname ? `${system} // ${market.sourceNickname}` : `${system} // SOURCE MATCH PENDING`);"""
if old_meta in text:
    text = text.replace(old_meta, new_meta)

self_line = "    if (ROUTES.length !== 12) failures.push('route-count');"
self_extra = self_line + """
    const copperRoute = ROUTES.find(route => route.key === 'copper');
    if (copperRoute?.sourceType !== 'pob' || copperRoute?.sourceNickname !== 'copperland') failures.push('copper-source');
    if (finite(pobGoodFor({ shop_items: [{ name: 'Copper', sell_price: 80 }] }, 'Copper')?.sell_price) !== 80) failures.push('copper-pob-price');"""
if "failures.push('copper-source')" not in text:
    if self_line not in text:
        raise SystemExit('self-test route line not found')
    text = text.replace(self_line, self_extra)

path.write_text(text, encoding='utf-8')
