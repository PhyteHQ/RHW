/* DTR's strict ID-rephack interpretation, generalized to each real player ID.
   Faction diplomacy never substitutes for equipped-ID rules. */
import { normalize } from './planner.mjs';
export const BMM_ID = 'dsy_license_br_m_grp';
const CORSAIR_ID = 'dsy_license_fc_c_grp', HOSTILE = -.55;
const text = value => typeof value === 'string' ? value.trim() : '';
const first = (row, ...keys) => keys.map(key => row?.[key]).find(value => value !== null && value !== undefined && value !== '');
const number = value => ['number', 'string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const idOf = row => first(row, 'nickname', 'base_nickname', 'id');
const ownerOf = row => ({
  factionNickname: first(row, 'faction_nickname', 'faction_nick', 'factionNickname', 'faction'),
  factionName: first(row, 'faction_name', 'factionName', 'faction_display_name')
});
function ownerIndex(rows) {
  const owners = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = normalize(idOf(row)), owner = ownerOf(row), key = normalize(owner.factionNickname || owner.factionName);
    if (!id || !key) continue;
    const previous = owners.get(id);
    owners.set(id, owners.has(id) && (!previous || previous.key !== key) ? null : { row, key });
  }
  return owners;
}
export function enrichBaseOwners(bases, npcBases = [], pobs = [], commodities = []) {
  const npcs = ownerIndex(npcBases), players = ownerIndex(pobs);
  const policies = new Map([...npcBases, ...pobs].map(row => [normalize(idOf(row)), row]));
  const markets = ownerIndex(commodities.flatMap(good => Array.isArray(good?.market_goods) ? good.market_goods : [])
    .filter(row => row && !row.PoB && !row.PoBGood && text(row.base_nickname))
    .map(row => ({ ...row, nickname: row.base_nickname })));
  return bases.map(base => {
    const id = normalize(base.id), primary = base.kind === 'pob' ? players : npcs;
    const found = primary.has(id) ? primary.get(id) : markets.has(id) ? markets.get(id) : { row: base };
    return { ...base, ...ownerOf(found?.row),
      dockingMode: first(found?.row, 'defense_mode', 'docking', 'dockingMode') ?? first(policies.get(id), 'defense_mode', 'docking', 'dockingMode') };
  });
}
function reputationIndex(factions, tractors, identityId) {
  const names = new Map(), ambiguous = new Set(), rules = new Map(), seen = new Set();
  const addName = (name, nickname) => {
    const key = normalize(text(name));
    if (!key || ambiguous.has(key)) return;
    if (names.has(key) && normalize(names.get(key)) !== normalize(nickname)) { names.delete(key); ambiguous.add(key); }
    else names.set(key, nickname);
  };
  for (const faction of factions) if (text(faction?.nickname)) {
    addName(faction.nickname, faction.nickname); addName(faction.name, faction.nickname);
  }
  const matches = tractors.filter(row => normalize(row?.nickname) === normalize(identityId));
  const id = matches.length === 1 ? matches[0] : null;
  const rows = Array.isArray(id?.rephacks) ? id.rephacks : Object.values(id?.rephacks || {});
  if (rows.length > 10000) return { names, ambiguous, rules, id };
  for (const row of rows) {
    const nickname = text(row?.faction_nickname), key = normalize(nickname);
    if (!key) continue;
    addName(nickname, nickname); addName(row.faction_name, nickname);
    if (seen.has(key)) { rules.delete(key); continue; } seen.add(key);
    const value = number(row.reputation), mode = number(row.rep_type);
    if (value === null || value < -1 || value > 1 || ![0, 1, 2, 3].includes(mode)) continue;
    rules.set(key, { value, mode });
  }
  return { names, ambiguous, rules, id };
}
function ownerAccess(base, index, label) {
  const owner = ownerOf(base), nickname = text(owner.factionNickname), name = nickname || text(owner.factionName);
  if (!name) return { state: 'unknown', reason: 'Base faction owner is not reported' };
  const canonical = nickname && index.rules.has(normalize(nickname));
  if (!canonical && index.ambiguous.has(normalize(name))) return { state: 'unknown', reason: 'Base faction owner is ambiguous' };
  const rule = index.rules.get(normalize(canonical ? nickname : index.names.get(normalize(name)) || name));
  if (!rule || rule.mode === 2) return { state: 'unknown', reason: 'No usable ID reputation rule for this base owner' };
  if ([0, 3].includes(rule.mode) && rule.value <= HOSTILE)
    return { state: 'blocked', reason: label + ' forces hostile reputation with this base owner' };
  if (rule.value > HOSTILE)
    return { state: 'possible', reason: label + (rule.mode === 0 ? ' reputation ceiling permits docking; personal reputation may be lower' : ' reputation permits docking; other access rules may apply') };
  return { state: 'unknown', reason: 'ID minimum does not establish non-hostile reputation' };
}
export function dockingAccess(bases, owners = [], factions = [], tractors = [], identityId = BMM_ID, pobs = []) {
  const index = reputationIndex(factions, tractors, identityId);
  const label = index.id?.name || identityId;
  const enriched = enrichBaseOwners(bases, owners, pobs);
  const access = enriched.map(base => {
    if (base.kind !== 'pob' && identityId === CORSAIR_ID && (['li01_01_base', 'ew16_01_base'].includes(base.id)
      || normalize(base.name).startsWith('planet manhattan') && /new york|manhattan atmosphere/.test(normalize(base.systemName))))
      return [base.id, { state: 'blocked', reason: 'Known Corsair no-dock restriction at Manhattan / its landing site' }];
    const result = ownerAccess(base, index, label);
    if (base.kind !== 'pob') return [base.id, result];
    const mode = number(base.dockingMode);
    const approvalRequired = mode === 2 || mode === 3 || result.state === 'blocked';
    return [base.id, approvalRequired ? { state: 'unknown', approvalRequired: true,
      reason: result.state === 'blocked' ? 'Hostile POB IFF requires explicit owner approval'
        : 'POB whitelist is required' }
      : mode !== 1 ? { state: 'unknown', approvalRequired: false, reason: 'POB docking policy is not reported' }
      : { ...result, approvalRequired: false, reason: result.state === 'possible'
        ? label + ' permits this POB IFF; private owner exceptions may apply' : result.reason }];
  });
  return { ready: index.rules.size > 0, byId: Object.fromEntries(access),
    blocked: access.filter(([, value]) => value.state === 'blocked').map(([key]) => key),
    unverifiedDocks: access.filter(([, value]) => value.state === 'unknown' && !value.approvalRequired).map(([key]) => key),
    approvalDocks: access.filter(([, value]) => value.approvalRequired).map(([key]) => key) };
}
