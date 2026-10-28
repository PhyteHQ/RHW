/* Live ID infocards define RP ship limits. Tech compatibility is a separate
   power-system constraint; neither replaces personal reputation or POB ACLs. */
import { normalize } from './planner.mjs';
import { BMM_ID } from './access.mjs';

export const PREFERRED_TRADER_IDS = Object.freeze([
  Object.freeze({ id: BMM_ID, label: 'BMM' }),
  Object.freeze({ id: 'dsy_license_fc_j_grp', label: 'Junkers' }),
  Object.freeze({ id: 'dsy_license_co_os_grp', label: 'Orbital Spa & Cruise' })
]);

// DiscoveryGC/shipclass, ShipClassTable + shipclass.rc (not its older comments).
const FAMILIES = { 0: 'fighters', 1: 'fighters', 2: 'freighters', 3: 'fighters',
  4: 'fighters', 5: 'fighters', 6: 'transports', 7: 'transports', 8: 'transports',
  9: 'transports', 10: 'transports', 11: 'gunboats', 12: 'frigates', 13: 'cruisers',
  14: 'miners', 15: 'cruisers', 16: 'battleships', 17: 'carriers', 18: 'battleships', 19: 'repair ships' };
const HAULERS = new Set(['freighters', 'transports', 'frigates', 'gunboats', 'miners']);
const SHIP_WORDS = /\b(ships?|transports?|freighters?|liners?|miners?|gunboats?|frigates?|cruisers?|battleships?|carriers?)\b/i;
const clean = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const familyWords = { fighters: /\bfighters?\b/, freighters: /\bfreighters?\b/,
  transports: /\b(?:transports?|trains?|liners?)\b/, gunboats: /\bgunboats?\b/,
  frigates: /\bfrigates?\b/, cruisers: /\bcruisers?\b/, battleships: /\bbattleships?\b/,
  carriers: /\bcarriers?\b/, miners: /\b(?:miners?|mining ships?)\b/, 'repair ships': /\brepair ships?\b/ };

export function infocardLines(response) {
  const lines = Array.isArray(response) ? response : response?.infocard;
  if (!Array.isArray(lines)) return [];
  return lines.slice(0, 500).map(line => clean(typeof line === 'string' ? line
    : Array.isArray(line?.phrases) ? line.phrases.map(phrase => phrase?.phrase || '').join('') : ''))
    .filter(Boolean);
}

const CLASS_WORDS = {
  fighters: [/\bfighters?\b/i, [0, 1, 3, 4, 5]], freighters: [/\bfreighters?\b/i, [2]],
  transports: [/\b(?:transports?|trains?|liners?)\b/i, [6, 7, 8, 9, 10]],
  gunboats: [/\bgunboats?\b/i, [11]], frigates: [/\bfrigates?\b/i, [12]],
  cruisers: [/\bcruisers?\b/i, [13]], battlecruisers: [/\bbattlecruisers?\b/i, [15]],
  battleships: [/\bbattleships?\b/i, [16, 18]], carriers: [/\bcarriers?\b/i, [17]],
  dreadnoughts: [/\bdreadnoughts?\b/i, [18]], miners: [/\b(?:miners?|mining ships?)\b/i, [14]],
  repair: [/\brepair ships?\b/i, [19]]
};
const cargoAmount = text => /^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,3}(?:\.\d{3})+|\d{1,3}(?: \d{3})+)$/.test(text.trim())
  && Number(text.replace(/[, .]/g, '')) > 0 && Number(text.replace(/[, .]/g, '')) <= 1000000 ? Number(text.replace(/[, .]/g, '')) : null;
export function parseIdentityRules(response) {
  const original = infocardLines(response), config = original.findIndex(line => /^\[Tractor\]$/i.test(line));
  const narrative = config < 0 ? original : original.slice(0, config);
  const lines = narrative.map((line, index) => /\b(?:permitted|allowed)\s+ships?\s*:\s*$/i.test(line)
    ? line + ' ' + (narrative[index + 1] || '') : line);
  const modern = lines.some(line => /\bThis\b.{0,150}\bID\s+(?:is\s+)?used\s+by\b/i.test(line));
  const playerRestricted = lines.some(line => /\b(?:only\s+(?:be\s+)?(?:given|issued|assigned).{0,35}\badmin|admin\s+permission|staff.only|not\s+(?:available|intended)\s+(?:for|to)\s+players)\b/i.test(line));
  const permitted = new Set(modern ? Object.values(FAMILIES) : []), forbiddenClasses = new Set(), conditionalFamilies = new Set();
  const exceptions = new Set(), conditionalRules = [];
  let transportLimit = null, cargoLimit = null, hasShipList = modern, additionalConditions = 0;
  const condition = (line, forceAll = false) => {
    additionalConditions++;
    const related = Object.entries(familyWords).filter(([, pattern]) => pattern.test(normalize(line))).map(([family]) => family);
    for (const family of related.length ? related : ['*']) conditionalFamilies.add(family);
    const cap = line.match(/\b(ships?|transports?)\s+with\s+(?:more than|over)\s+([\d, .]+)\s+(?:cargo|hold)/i);
    const classPart = cap ? line.slice(0, cap.index) : line, amount = cap ? cargoAmount(cap[2]) : null;
    const unknown = forceAll || cap && amount === null;
    conditionalRules.push({ classes: unknown ? [] : [...new Set(Object.values(CLASS_WORDS).filter(([pattern]) => pattern.test(classPart)).flatMap(([, values]) => values))],
      cargoAbove: unknown ? null : amount,
      cargoFamily: cap && /^transport/i.test(cap[1]) ? 'transports' : null, families: unknown ? ['*'] : related.length ? related : ['*'] });
  };
  for (const line of lines) {
    const list = line.match(/\b(?:permitted|allowed)\s+(?:ship(?:\s+classes?|\s+types?)?s?)\s*:\s*(.+)/i);
    if (list) {
      hasShipList = true;
      for (const [family, pattern] of Object.entries(familyWords)) if (pattern.test(normalize(list[1]))) permitted.add(family);
      if (/\b(?:except|excluding|unless|only|not|restricted|limited|up to)\b|[<>≤≥]/i.test(list[1])) condition(line);
    }
    const prohibition = line.match(/\b(?:cannot|may not|must not)\s+(?:use|fly|operate)\s+(.+)/i);
    if (prohibition && !/\b(?:within|outside|inside|only|when|unless)\b/i.test(prohibition[1])) {
      const body = prohibition[1], exception = body.match(/\b(?:other than|except(?:\s+for)?)\s+(.+?)\.?$/i);
      const main = exception ? body.slice(0, exception.index) : body;
      if (exception) for (const name of exception[1].split(/,\s*|\s+(?:and|or)\s+/i))
        if (normalize(name)) exceptions.add(normalize(name.replace(/\.$/, '')));
      const cap = main.match(/\b(ships?|transports?)\s+with\s+(?:more than|over)\s+([\d, .]+)\s+(?:cargo|hold)(?:\s+space)?/i);
      const classPart = cap ? main.slice(0, cap.index) : main;
      let understood = false;
      if (cap) {
        const amount = cargoAmount(cap[2]);
        if (amount !== null) {
          if (/^transport/i.test(cap[1])) transportLimit = Math.min(transportLimit ?? Infinity, amount);
          else cargoLimit = Math.min(cargoLimit ?? Infinity, amount);
          understood = true;
        } else { condition(line, true); continue; }
      }
      for (const [pattern, classes] of Object.values(CLASS_WORDS)) if (pattern.test(classPart)) {
        classes.forEach(value => forbiddenClasses.add(value)); understood = true;
      }
      // Only a fully parsed prohibition can grant automatic class permission.
      let leftover = classPart;
      for (const [pattern] of Object.values(CLASS_WORDS)) leftover = leftover.replace(new RegExp(pattern.source, 'ig'), '');
      leftover = leftover.replace(/\b(?:any|all|and|or)\b/ig, '').replace(/[\s,./-]/g, '');
      if (understood && !leftover) continue;
      condition(line, true); continue;
    }
    if (SHIP_WORDS.test(line) && /\b(?:cannot|may not|must not|only|unless|except|restricted|prohibited)\b/i.test(line)
      && /\b(?:use|fly|operate|dock|bring|equip|mount)\b/i.test(line)) condition(line);
    else if (SHIP_WORDS.test(line) && /\b(?:cargo|hold|capacity)\b/i.test(line) && /\d/.test(line)) condition(line);
  }
  return { schema: 2, state: hasShipList && permitted.size ? additionalConditions ? 'conditional' : 'known' : 'unknown',
    permitted: [...permitted], forbiddenClasses: [...forbiddenClasses], transportLimit, cargoLimit,
    exceptions: [...exceptions], additionalConditions, conditionalFamilies: [...conditionalFamilies], conditionalRules, playerRestricted,
    source: lines.length ? 'Darkstat ID infocard' : 'ID infocard unavailable' };
}
export function playerIdAvailability(raw) {
  if (/^dsy_license_(?:neutral|staff|specop|military)$/i.test(raw?.nickname || '')) return false;
  if (raw?.market_goods === undefined) return null;
  if (!Array.isArray(raw.market_goods)) return false;
  return raw.market_goods.some(quote => quote?.base_sells === true && Number(quote.price_base_sells_for) > 0
    && !/virtual/i.test(quote.region_name || '') && quote.faction_nick !== 'fc_staff'
    && !/\b(?:guard station|proxy base)\b/i.test(quote.base_name || ''));
}

export function identityRegistry(tractors = [], cards = {}, asOf = 0) {
  const unique = new Map();
  for (const raw of tractors) {
    if (!raw || typeof raw.nickname !== 'string' || !/license|\bid\b/i.test(raw.nickname + ' ' + raw.name)) continue;
    if (unique.has(raw.nickname) || /unused|unassigned|discontinued|not in use|admin|special operative|srp id|^player faction id$/i.test(raw.name || '')) continue;
    const rules = cards[raw.nickname]?.rules?.schema === 2 ? cards[raw.nickname].rules : parseIdentityRules(cards[raw.nickname]);
    const playerAvailable = playerIdAvailability(raw);
    if (playerAvailable === false || rules.playerRestricted) continue;
    unique.set(raw.nickname, { id: raw.nickname, name: clean(raw.name || raw.nickname).slice(0, 100), rules, playerAvailable, asOf });
  }
  if (!unique.has(BMM_ID)) unique.set(BMM_ID, { id: BMM_ID, name: 'BMM ID', rules: parseIdentityRules(null), playerAvailable: null, asOf: 0 });
  return [...unique.values()].sort((a, b) => a.id === BMM_ID ? -1 : b.id === BMM_ID ? 1 : a.name.localeCompare(b.name));
}

export function shipFamily(ship) {
  if (Number.isSafeInteger(ship.shipClass)) return FAMILIES[ship.shipClass] || null;
  const type = normalize(ship.type);
  if (/\bfreighter\b/.test(type)) return 'freighters';
  if (/\b(?:transport|train|liner)\b/.test(type)) return 'transports';
  return null;
}

export function identityShipCheck(identity, ship) {
  const family = shipFamily(ship), rules = identity?.rules;
  const value = ship.techCompat?.[identity?.id];
  const tech = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const exception = rules?.exceptions?.some(name => [ship.name, ship.apiName].some(value => normalize(value) === name));
  if (identity?.playerAvailable === false || rules?.playerRestricted) return { state: 'blocked', reason: 'This is not a normally obtainable player ID', family, tech };
  if (!exception && rules?.forbiddenClasses?.includes(ship.shipClass)) return { state: 'blocked', reason: 'This exact ship class is prohibited by the ID', family, tech };
  if (!exception && rules?.cargoLimit != null && ship.cargo > rules.cargoLimit)
    return { state: 'blocked', reason: 'Hull exceeds this ID’s ' + rules.cargoLimit.toLocaleString('en-GB') + ' cargo limit', family, tech };
  if (rules && rules.state !== 'unknown' && family && !rules.permitted?.includes(family))
    return { state: 'blocked', reason: 'This ship class is not permitted by the ID', family, tech };
  if (!exception && family === 'transports' && rules?.transportLimit != null && ship.cargo > rules.transportLimit)
    return { state: 'blocked', reason: `Hull exceeds this ID’s ${rules.transportLimit.toLocaleString('en-GB')} transport cargo limit`, family, tech };
  if (ship.playerShip === false) return { state: 'blocked', reason: 'No player ship package is reported for this hull', family, tech };
  if (!rules || rules.state === 'unknown' || !family)
    return { state: 'conditional', reason: 'ID ship rules or ship class need checking', family, tech };
  if (!Number.isSafeInteger(ship.shipClass)) return { state: 'conditional', reason: 'Exact ship class is not reported; check the ID hull limit', family, tech };
  const affected = rules.conditionalRules?.length ? rules.conditionalRules.some(rule =>
    rule.classes.includes(ship.shipClass) || rule.cargoAbove != null && (!rule.cargoFamily || rule.cargoFamily === family) && ship.cargo > rule.cargoAbove
      || rule.cargoAbove == null && !rule.classes.length && (rule.families.includes('*') || rule.families.includes(family)))
    : !rules.conditionalFamilies?.length || rules.conditionalFamilies.includes('*') || rules.conditionalFamilies.includes(family);
  if (rules.state === 'conditional' && affected)
    return { state: 'conditional', reason: 'Additional ID ship/docking conditions need checking', family, tech };
  if (identity?.playerAvailable !== true) return { state: 'conditional', reason: 'A normal player acquisition source for this ID is not reported', family, tech };
  if (ship.playerShip == null) return { state: 'conditional', reason: 'Player ship availability is not reported', family, tech };
  if (tech === null) return { state: 'conditional', reason: 'Ship tech compatibility is not reported', family, tech };
  if (tech < .999) return { state: 'conditional', reason: `${Math.round(tech * 100)}% ship tech compatibility; check the power setup`, family, tech };
  return { state: 'checked', reason: 'Published ID ship rules and full ship tech compatibility checked', family, tech };
}

export function autoIdentityShips(ships, identity) {
  const candidates = ships.filter(isHaulingShip)
    .map(ship => ({ ship, check: identityShipCheck(identity, ship) })).filter(row => row.check.state === 'checked');
  const selected = [], seen = new Set();
  const add = ship => { if (ship && !seen.has(ship.id)) { selected.push(ship); seen.add(ship.id); } };
  // Preserve cargo-volume classes (notably liners) and both mooring sizes.
  for (const dock of ['medium', 'large', 'berth']) {
    const group = candidates.filter(row => row.ship.dock === dock).map(row => row.ship);
    add([...group].sort((a, b) => b.cargo - a.cargo || b.cruise - a.cruise)[0]);
  }
  const liners = candidates.map(row => row.ship).filter(ship => ship.volumeClass === 10);
  add(liners.sort((a, b) => b.cargo - a.cargo || b.cruise - a.cruise)[0]);
  const miners = candidates.map(row => row.ship).filter(ship => ship.volumeClass === 14);
  add(miners.sort((a, b) => b.cargo - a.cargo || b.cruise - a.cruise)[0]);
  for (const dock of ['medium', 'berth', 'large']) {
    if (selected.length >= 6) break;
    add(candidates.map(row => row.ship).filter(ship => ship.dock === dock)
      .sort((a, b) => b.cruise - a.cruise || b.cargo - a.cargo)[0]);
  }
  const ranked = candidates.map(row => row.ship).sort((a, b) => b.cargo * b.cruise - a.cargo * a.cruise);
  for (const ship of ranked) { if (selected.length >= 6) break; add(ship); }
  return selected.slice(0, 6);
}
export function isHaulingShip(ship) { return HAULERS.has(shipFamily(ship)); }
