/* Live ID infocards define RP ship limits. Tech compatibility is a separate
   power-system constraint; neither replaces personal reputation or POB ACLs. */
import { normalize } from './planner.mjs';
import { BMM_ID } from './access.mjs';

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

export function parseIdentityRules(response) {
  const original = infocardLines(response);
  const lines = original.map((line, index) => /\b(?:permitted|allowed)\s+ships?\s*:\s*$/i.test(line)
    ? line + ' ' + (original[index + 1] || '') : line);
  const permitted = new Set(), conditions = [];
  const conditionalFamilies = new Set();
  const condition = line => {
    conditions.push(line.slice(0, 240));
    const related = Object.entries(familyWords).filter(([, pattern]) => pattern.test(normalize(line))).map(([family]) => family);
    for (const family of related.length ? related : ['*']) conditionalFamilies.add(family);
  };
  let transportLimit = null, hasShipList = false;
  for (const line of lines) {
    const list = line.match(/\b(?:permitted|allowed)\s+(?:ship(?:\s+classes?|\s+types?)?s?)\s*:\s*(.+)/i);
    if (list) {
      hasShipList = true;
      for (const [family, pattern] of Object.entries(familyWords)) if (pattern.test(normalize(list[1]))) permitted.add(family);
      if (/\b(?:except|excluding|unless|only|not|restricted|limited|up to)\b|[<>≤≥]/i.test(list[1])) condition(line);
    }
    const cap = line.match(/\b(?:cannot|may not|must not)\s+(?:use|fly|operate)\s+(?:any\s+)?transports?\s+with\s+(?:more than|over)\s+([\d, .]+)\s+(?:cargo|hold)/i);
    if (cap && !/\b(except|unless|within|outside|inside|only|when)\b/i.test(line)) {
      const amount = Number(cap[1].replace(/[, .]/g, ''));
      if (Number.isSafeInteger(amount) && amount > 0 && amount <= 50000) {
        transportLimit = Math.min(transportLimit ?? Infinity, amount); continue;
      }
    }
    if (SHIP_WORDS.test(line) && /\b(?:cannot|may not|must not|only|unless|except|restricted|prohibited)\b/i.test(line)
      && /\b(?:use|fly|operate|dock|bring|equip|mount)\b/i.test(line)) condition(line);
    else if (SHIP_WORDS.test(line) && /\b(?:cargo|hold|capacity)\b/i.test(line) && /\d/.test(line)) condition(line);
  }
  return { state: hasShipList && permitted.size ? conditions.length ? 'conditional' : 'known' : 'unknown',
    permitted: [...permitted], transportLimit, additionalConditions: conditions.length, conditionalFamilies: [...conditionalFamilies],
    source: lines.length ? 'Darkstat ID infocard' : 'ID infocard unavailable' };
}

export function identityRegistry(tractors = [], cards = {}, asOf = 0) {
  const unique = new Map();
  for (const raw of tractors) {
    if (!raw || typeof raw.nickname !== 'string' || !/license|\bid\b/i.test(raw.nickname + ' ' + raw.name)) continue;
    if (unique.has(raw.nickname) || /unused|discontinued|not in use|admin|special operative|srp id/i.test(raw.name || '')) continue;
    unique.set(raw.nickname, { id: raw.nickname, name: clean(raw.name || raw.nickname).slice(0, 100),
      rules: cards[raw.nickname]?.rules || parseIdentityRules(cards[raw.nickname]), asOf });
  }
  if (!unique.has(BMM_ID)) unique.set(BMM_ID, { id: BMM_ID, name: 'BMM ID', rules: parseIdentityRules(null), asOf: 0 });
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
  if (rules && rules.state !== 'unknown' && family && !rules.permitted?.includes(family))
    return { state: 'blocked', reason: 'This ship class is not permitted by the ID', family, tech };
  if (family === 'transports' && rules?.transportLimit != null && ship.cargo > rules.transportLimit)
    return { state: 'blocked', reason: `Hull exceeds this ID’s ${rules.transportLimit.toLocaleString('en-GB')} transport cargo limit`, family, tech };
  if (ship.playerShip === false) return { state: 'blocked', reason: 'No player ship package is reported for this hull', family, tech };
  if (!rules || rules.state === 'unknown' || !family)
    return { state: 'conditional', reason: 'ID ship rules or ship class need checking', family, tech };
  if (!Number.isSafeInteger(ship.shipClass)) return { state: 'conditional', reason: 'Exact ship class is not reported; check the ID hull limit', family, tech };
  if (rules.state === 'conditional' && (!rules.conditionalFamilies?.length || rules.conditionalFamilies.includes('*') || rules.conditionalFamilies.includes(family)))
    return { state: 'conditional', reason: 'Additional ID ship/docking conditions need checking', family, tech };
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
