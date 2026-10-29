const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

class Heap {
  data = [];
  push(value) {
    let i = this.data.push(value) - 1;
    while (i) { const parent = (i - 1) >> 1; if (this.data[parent][0] <= value[0]) break; this.data[i] = this.data[parent]; i = parent; }
    this.data[i] = value;
  }
  pop() {
    const result = this.data[0], end = this.data.pop();
    if (this.data.length) {
      let i = 0;
      while (i * 2 + 1 < this.data.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.data.length && this.data[child + 1][0] < this.data[child][0]) child++;
        if (this.data[child][0] >= end[0]) break;
        this.data[i] = this.data[child]; i = child;
      }
      this.data[i] = end;
    }
    return result;
  }
}

export function validateNavigation(nav) {
  if (!nav || nav.schema !== 1 || !Array.isArray(nav.nodes) || !Array.isArray(nav.links) || nav.nodes.length > 100000 || nav.links.length > 300000) throw new Error('Ungültiges Navigationsformat.');
  const ids = new Set();
  for (const n of nav.nodes) {
    if (typeof n.id !== 'string' || !n.id || ids.has(n.id) || typeof n.system !== 'string' || !Array.isArray(n.pos) || n.pos.length !== 3 || !n.pos.every(Number.isFinite)) throw new Error('Ungültiger Navigationspunkt.');
    ids.add(n.id);
  }
  for (const e of nav.links) {
    if (!ids.has(e.from) || !ids.has(e.to) || !['jump', 'lane', 'cruise'].includes(e.kind)) throw new Error('Ungültige Navigationsverbindung.');
    if (e.kind === 'lane' && !(e.speed > 0)) throw new Error('Tradelane-Geschwindigkeit fehlt.');
  }
  return nav;
}

export class Navigator {
  constructor(nav, bases, profile, settings = {}) {
    this.profile = profile;
    this.settings = { jump: 15, lane: 10, charge: 5, ...settings };
    this.cache = new Map(); this.nodes = new Map(); this.systems = new Map(); this.links = new Map(); this.baseNodes = new Map();
    this.nav = nav;
    if (!nav) return;
    validateNavigation(nav);
    for (const node of nav.nodes) this.addNode({ ...node });
    for (const edge of nav.links) {
      if (edge.cargoLimit != null && profile.cargo > edge.cargoLimit) continue;
      if (edge.allows && !edge.allows.includes(profile.dock)) continue;
      if (!this.links.has(edge.from)) this.links.set(edge.from, []);
      this.links.get(edge.from).push(edge);
    }
    for (const [baseId, nodeId] of Object.entries(nav.baseNodes || {})) if (this.nodes.has(nodeId)) this.baseNodes.set(baseId, nodeId);
    for (const base of bases) {
      if (this.baseNodes.has(base.id)) continue;
      if (base.system && base.pos && this.systems.has(base.system)) {
        const id = `market:${base.id}`;
        this.addNode({ id, system: base.system, pos: base.pos, kind: 'base', name: base.name, allows: ['medium', 'berth', 'large'] });
        this.baseNodes.set(base.id, id);
      }
    }
  }
  addNode(node) {
    this.nodes.set(node.id, node);
    if (!this.systems.has(node.system)) this.systems.set(node.system, []);
    this.systems.get(node.system).push(node);
  }
  allowed(node) {
    return !node.allows || node.allows.includes(this.profile.dock);
  }
  from(baseId) {
    if (this.cache.has(baseId)) return this.cache.get(baseId);
    const source = this.baseNodes.get(baseId);
    if (!source || !this.allowed(this.nodes.get(source))) return null;
    const times = new Map([[source, 0]]), previous = new Map(), heap = new Heap();
    heap.push([0, source]);
    while (heap.data.length) {
      const [time, current] = heap.pop();
      if (time !== times.get(current)) continue;
      const node = this.nodes.get(current);
      const relax = (target, seconds, kind) => {
        if (!this.allowed(this.nodes.get(target)) || !(seconds >= 0)) return;
        const nextTime = time + seconds;
        if (nextTime < (times.get(target) ?? Infinity)) {
          times.set(target, nextTime); previous.set(target, { from: current, kind, seconds }); heap.push([nextTime, target]);
        }
      };
      for (const edge of this.links.get(current) || []) {
        const target = this.nodes.get(edge.to);
        const laneEntry = this.settings.reverse ? target : node;
        const seconds = edge.kind === 'jump' ? this.settings.jump : edge.kind === 'lane' ? dist(node.pos, target.pos) / edge.speed + (laneEntry.kind === 'lane' ? 0 : this.settings.lane) : dist(node.pos, target.pos) / this.profile.cruise;
        relax(edge.to, seconds, edge.kind);
      }
      for (const target of this.systems.get(node.system)) {
        if (target.id === current) continue;
        const multiplier = this.nav.systemMultipliers?.[node.system] ?? 1;
        const laneEntry = this.settings.reverse ? node : target;
        const seconds = dist(node.pos, target.pos) / (this.profile.cruise * multiplier) + this.settings.charge + (laneEntry.kind === 'lane' ? this.settings.lane : 0);
        relax(target.id, seconds, 'cruise');
      }
    }
    const result = { times, previous, source };
    this.cache.set(baseId, result);
    return result;
  }
  route(from, to, withPath = false) {
    if (from === to) return { seconds: 0, jumps: 0, path: [] };
    const data = this.from(from), target = this.baseNodes.get(to);
    if (!data || !target || !Number.isFinite(data.times.get(target))) return null;
    const path = []; let at = target, jumps = 0;
    while (at !== data.source) {
      const previous = data.previous.get(at);
      if (!previous) return null;
      if (previous.kind === 'jump') jumps++;
      if (withPath) path.push({ ...previous, to: at, fromSystem: this.nodes.get(previous.from).system, toSystem: this.nodes.get(at).system });
      at = previous.from;
    }
    return { seconds: data.times.get(target), jumps, path: withPath ? path.reverse() : undefined };
  }
}
