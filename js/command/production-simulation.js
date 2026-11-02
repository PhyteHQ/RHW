/* Shared-stock planning, not a reconstruction of private server job progress.
   Whole batches reserve inputs at start and release all outputs at completion.
   Enumerating fixed module priorities exposes ambiguous last-stock allocation. */
(function exposeProductionSimulation() {
  'use strict';
  const EPS = 1e-7;
  function orders(rows) {
    if (rows.length < 2) return [rows];
    return rows.flatMap((row, i) => orders(rows.filter((_, j) => j !== i)).map(rest => [row, ...rest]));
  }
  function run(spec, priority) {
    const stock = { ...spec.stock }, limits = spec.limits || {}, volumes = spec.volumes || {};
    const rows = spec.jobs.map(job => ({ ...job, count: 0, last: 0, finish: null, pending: false, reason: [] }));
    const byKey = new Map(rows.map(row => [row.key, row]));
    const ordered = priority.map(key => byKey.get(key));
    let free = Number.isFinite(spec.space) ? spec.space : null, now = 0, events = 0, truncated = false;
    const reserved = {};
    const missing = (job, workingStock = stock) => {
      const trial = { ...workingStock }, taken = [];
      for (const group of job.inputs) {
        let wanted = group.qty;
        for (const id of group.ids) {
          const qty = Math.min(wanted, trial[id] || 0);
          if (qty > 0) { trial[id] -= qty; taken.push({ id, qty }); wanted -= qty; }
        }
        if (wanted > EPS) return { reason: [group.name], taken: [] };
      }
      return { reason: [], taken };
    };
    function start(job) {
      const materials = missing(job);
      if (materials.reason.length) { job.reason = materials.reason; return false; }
      for (const catalyst of job.catalysts || []) {
        if (stock[catalyst.id] !== undefined && stock[catalyst.id] !== null
          && stock[catalyst.id] - (reserved[catalyst.id] || 0) < catalyst.qty) {
          job.reason = [catalyst.name]; return false;
        }
      }
      // Reserve the core's crew before any factory can start.
      if (Number.isFinite(stock.commodity_crew) && stock.commodity_crew < (spec.coreCrew || 0)) {
        job.reason = ['Core crew']; return false;
      }
      for (const { id, qty } of materials.taken) {
        stock[id] -= qty;
        if (free !== null) free += qty * volumes[id];
      }
      for (const c of job.catalysts || []) reserved[c.id] = (reserved[c.id] || 0) + c.qty;
      job.finish = now + job.seconds;
      job.reason = [];
      return true;
    }
    reserved.commodity_crew = spec.coreCrew || 0;
    function complete(job) {
      const full = job.outputs.find(o => Number.isFinite(limits[o.id]) && (stock[o.id] || 0) + o.qty > limits[o.id]);
      const volume = job.outputs.reduce((sum, o) => sum + o.qty * volumes[o.id], 0);
      if (full || (free !== null && volume > free + EPS)) {
        job.pending = true;
        job.reason = [full ? `${full.name} stock limit` : 'Storage space'];
        return false;
      }
      for (const o of job.outputs) stock[o.id] = (stock[o.id] || 0) + o.qty;
      if (free !== null) free = Math.max(0, free - volume);
      for (const c of job.catalysts || []) reserved[c.id] -= c.qty;
      job.count += job.output;
      job.last = now;
      job.finish = null;
      job.pending = false;
      job.reason = [];
      return true;
    }
    while (events < (spec.maxEvents || 12000)) {
      let changed = false;
      for (const job of ordered) if (job.pending) changed = complete(job) || changed;
      for (const job of ordered) if (job.finish === null) changed = start(job) || changed;
      // Starting another job may free space needed by a finished batch.
      if (changed && ordered.some(job => job.pending)) { events += 1; continue; }
      const next = Math.min(...rows.filter(job => job.finish !== null && !job.pending).map(job => job.finish));
      if (!Number.isFinite(next)) break;
      if (next > (spec.horizon || 30 * 86400)) { truncated = true; break; }
      now = next;
      // Deposit every simultaneous completion before allocating another batch.
      for (const job of ordered) if (job.finish !== null && !job.pending && Math.abs(job.finish - now) < EPS) complete(job);
      events += 1;
    }
    if (events >= (spec.maxEvents || 12000)) truncated = true;
    return { rows: rows.map(job => ({ key: job.key, count: job.count, seconds: job.last,
      reason: job.reason.length ? job.reason : truncated ? ['Forecast limit reached'] : ['No further complete batch'] })), stock, free, truncated };
  }
  function simulate(spec) {
    if (!spec.jobs.length) return { rows: [], truncated: false, orders: 0 };
    const runs = orders(spec.jobs.map(job => job.key)).map(order => run(spec, order));
    return { rows: spec.jobs.map(job => {
      const results = runs.map(result => result.rows.find(row => row.key === job.key));
      return { key: job.key, min: Math.min(...results.map(row => row.count)), max: Math.max(...results.map(row => row.count)),
        secondsMin: Math.min(...results.map(row => row.seconds)), secondsMax: Math.max(...results.map(row => row.seconds)),
        reasons: [...new Set(results.flatMap(row => row.reason))] };
    }), truncated: runs.some(run => run.truncated), orders: runs.length };
  }
  globalThis.RHW_PRODUCTION_SIMULATION = Object.freeze({ simulate, run });
})();
