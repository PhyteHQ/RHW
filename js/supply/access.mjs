/* BMM ID rules, never Corsair diplomacy. Physical mooring is checked by the
   shared Navigator; personal reputation and POB ACLs remain character-specific. */
import { normalize } from './planner.mjs';
export const BMM_ID = 'dsy_license_br_m_grp';
export function dockingAccess(bases, owners = [], factions = [], tractors = []) {
  const ownerById = new Map(owners.map(base => [base.nickname, base.faction_nickname || base.faction_name]));
  const names = new Map();
  factions.forEach(faction => { names.set(normalize(faction.nickname), faction.nickname); names.set(normalize(faction.name), faction.nickname); });
  const id = tractors.find(item => item.nickname === BMM_ID);
  const rules = new Map();
  for (const rule of id?.rephacks || []) {
    if (!rule.faction_nickname || rule.reputation == null || !Number.isFinite(Number(rule.reputation))
      || Number(rule.reputation) < -1 || Number(rule.reputation) > 1 || ![0, 1, 2, 3].includes(rule.rep_type)) continue;
    const key = normalize(rule.faction_nickname);
    if (rules.has(key)) { rules.set(key, null); continue; }
    rules.set(key, rule);
  }
  const access = bases.map(base => {
    if (base.kind === 'pob') return [base.id, { state: 'unknown', reason: 'POB access depends on owner permissions' }];
    const owner = ownerById.get(base.id), nickname = names.get(normalize(owner)) || owner;
    const rule = rules.get(normalize(nickname));
    if (!rule || rule.rep_type === 2) return [base.id, { state: 'unknown', reason: 'Personal reputation not reported' }];
    const hostile = Number(rule.reputation) < -0.55;
    if (hostile && [0, 3].includes(rule.rep_type)) return [base.id, { state: 'blocked', reason: 'BMM ID prevents docking with this owner' }];
    return [base.id, { state: hostile ? 'unknown' : 'possible', reason: 'BMM ID rule; personal access may differ' }];
  });
  return { ready: rules.size > 0, byId: Object.fromEntries(access), blocked: access.filter(([, value]) => value.state === 'blocked').map(([key]) => key) };
}
