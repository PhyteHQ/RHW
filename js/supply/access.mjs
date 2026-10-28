/* Selected-ID rules, never a shared faction diplomacy assumption. Physical mooring is checked by the
   shared Navigator; personal reputation and POB ACLs remain character-specific. */
import { normalize } from './planner.mjs';
export const BMM_ID = 'dsy_license_br_m_grp';
export function dockingAccess(bases, owners = [], factions = [], tractors = [], identityId = BMM_ID, pobs = []) {
  const ownerById = new Map(owners.map(base => [base.nickname, base.faction_nickname || base.faction_name]));
  const names = new Map();
  factions.forEach(faction => { names.set(normalize(faction.nickname), faction.nickname); names.set(normalize(faction.name), faction.nickname); });
  const pobById = new Map(pobs.map(base => [base.nickname, base]));
  const id = tractors.find(item => item.nickname === identityId);
  const label = id?.name || (identityId === BMM_ID ? 'BMM ID' : identityId);
  const rules = new Map();
  for (const rule of Array.isArray(id?.rephacks) ? id.rephacks : Object.values(id?.rephacks || {})) {
    if (!rule.faction_nickname || rule.reputation == null || !Number.isFinite(Number(rule.reputation))
      || Number(rule.reputation) < -1 || Number(rule.reputation) > 1 || ![0, 1, 2, 3].includes(rule.rep_type)) continue;
    const key = normalize(rule.faction_nickname);
    if (rules.has(key)) { rules.set(key, null); continue; }
    rules.set(key, rule);
  }
  const access = bases.map(base => {
    if (base.kind === 'pob') {
      const pob = pobById.get(base.id), mode = pob?.defense_mode;
      const owner = pob?.faction_nickname || pob?.faction_name;
      const nickname = names.get(normalize(owner)) || owner;
      const rule = rules.get(normalize(nickname));
      const hostile = rule && Number(rule.reputation) < -0.55 && [0, 3].includes(rule.rep_type);
      const approvalRequired = mode !== 1 || Boolean(hostile);
      return [base.id, { state: 'unknown', approvalRequired, reason: mode === 2 || mode === 3
        ? 'POB whitelist is required; the ID alone does not grant access'
        : hostile ? `${label} is hostile to this POB’s IFF; explicit owner approval is required`
          : mode === 1 ? 'IFF docking; personal reputation and owner blacklists still need checking'
            : 'POB docking policy is not reported; owner approval needs checking' }];
    }
    const owner = ownerById.get(base.id), nickname = names.get(normalize(owner)) || owner;
    const rule = rules.get(normalize(nickname));
    if (!rule || rule.rep_type === 2) return [base.id, { state: 'unknown', reason: 'Personal reputation not reported' }];
    const hostile = Number(rule.reputation) < -0.55;
    if (hostile && [0, 3].includes(rule.rep_type)) return [base.id, { state: 'blocked', reason: `${label} prevents docking with this owner` }];
    const supported = !hostile && [1, 3].includes(rule.rep_type);
    return [base.id, { state: supported ? 'possible' : 'unknown', reason: `${label} rule; personal access may differ` }];
  });
  return { ready: rules.size > 0, byId: Object.fromEntries(access),
    blocked: access.filter(([, value]) => value.state === 'blocked').map(([key]) => key),
    approvalDocks: access.filter(([, value]) => value.approvalRequired).map(([key]) => key) };
}
