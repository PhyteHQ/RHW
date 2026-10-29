/* Current Darkstat map objects constrain the bundled lane/port geometry.
   /api/systems does not expose exact jump destinations or lane adjacency, so
   never infer new links from the galaxy's aggregated system connections. */
import { validateNavigation } from './core/navigation.mjs';

// Server/event closures can precede Darkstat's client-config map. Keep these
// explicit and separate from feed facts; remove only after confirmed reopening.
export const KNOWN_JUMP_CLOSURES = Object.freeze([
  Object.freeze({ from: 'iw06:iw06_to_ku02', to: 'ku02:ku02_to_iw06',
    name: 'Galileo ↔ Shikoku', reason: 'Destroyed during the Liberty–Kusari war',
    reportedAt: '2026-10-29', source: 'RHW operator report', bidirectional: true })
]);

const coords = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? [...value]
  : value && ['X', 'Y', 'Z'].every(key => Number.isFinite(value[key])) ? [value.X, value.Y, value.Z] : null;

export function currentNavigation(base, systems, receivedAt, closures = KNOWN_JUMP_CLOSURES) {
  validateNavigation(base);
  if (!Array.isArray(systems) || !systems.length || systems.length > 1000
    || !Number.isFinite(Date.parse(receivedAt))) throw Error('Current navigation feed is unavailable');
  const objects = new Map(), jumps = new Map(), covered = new Set();
  let count = 0;
  for (const system of systems) {
    if (typeof system?.nickname !== 'string' || !system.nickname || covered.has(system.nickname)
      || !Object.hasOwn(system, 'Jumpholes') || system.Jumpholes !== null && !Array.isArray(system.Jumpholes)
      || system.Objs !== null && !Array.isArray(system.Objs)) throw Error('Current navigation feed has an invalid system');
    covered.add(system.nickname);
    for (const [rows, index] of [[system.Objs || [], objects], [system.Jumpholes || [], jumps]]) for (const object of rows) {
      if (++count > 100000) throw Error('Current navigation feed is too large');
      if (typeof object?.Nickname !== 'string' || !object.Nickname || !coords(object.Pos))
        throw Error('Current navigation feed has an invalid map object');
      const id = system.nickname + ':' + object.Nickname;
      if (index.has(id)) throw Error('Current navigation feed has duplicate map objects');
      index.set(id, object);
    }
  }
  const blocked = new Set();
  for (const closure of closures) {
    blocked.add(JSON.stringify([closure.from, closure.to]));
    if (closure.bidirectional) blocked.add(JSON.stringify([closure.to, closure.from]));
  }
  const nodes = base.nodes.flatMap(node => {
    if (!covered.has(node.system)) return [];
    if (node.kind === 'jump') {
      const jump = jumps.get(node.id);
      if (!jump || ![1, 2, 3, 4, 5].includes(jump.Kind)) return [];
      // The live enum only says "cargo limited", not the exact capacity. An
      // existing verified limit is usable; a newly limited gate is unknown.
      if (jump.Kind === 1 && !(node.cargoLimit > 0)
        && !base.links.some(edge => edge.from === node.id && edge.cargoLimit > 0)) return [];
      const allows = jump.Kind === 2 ? (node.allows || ['berth']).filter(dock => dock === 'berth') : node.allows;
      return [{ ...node, pos: coords(jump.Pos), ...(allows ? { allows } : {}) }];
    }
    const object = objects.get(node.id);
    if (node.kind === 'lane' && (!object || object.Kind !== 2)) return [];
    return [{ ...node, ...(object ? { pos: coords(object.Pos) } : {}) }];
  });
  const byId = new Map(nodes.map(node => [node.id, node]));
  let removedJumps = 0;
  const links = base.links.filter(edge => {
    const from = byId.get(edge.from), to = byId.get(edge.to);
    const allowed = from && to && (edge.kind !== 'jump' || jumps.get(edge.from)?.GotoSystem === to.system
      && !blocked.has(JSON.stringify([edge.from, edge.to])));
    if (edge.kind === 'jump' && !allowed) removedJumps++;
    return allowed;
  }).map(edge => {
    if (edge.kind === 'lane') return { ...edge, speed: 2500 };
    const limits = [edge.cargoLimit, byId.get(edge.from).cargoLimit, byId.get(edge.to).cargoLimit].filter(limit => limit > 0);
    return { ...edge, ...(limits.length ? { cargoLimit: Math.min(...limits) } : {}) };
  });
  const baseNodes = Object.fromEntries(Object.entries(base.baseNodes || {}).filter(([, id]) => byId.has(id)));
  return validateNavigation({ ...base, nodes, links, baseNodes,
    live: { receivedAt, source: 'https://darkstat.dd84ai.com/api/systems', systems: covered.size,
      removedJumps, knownClosures: closures.map(({ name, reason, reportedAt }) => ({ name, reason, reportedAt })),
      geometryBuiltAt: base.builtAt || null } });
}
