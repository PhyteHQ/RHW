/* Named, ordered synchronous lifecycle hooks. Async owners emit after awaiting
   their work; extensions never replace another module's public methods. */
(function installLifecycle() {
  'use strict';
  globalThis.createRhwLifecycle = function createRhwLifecycle() {
    const phases = new Map();
    function on(phase, name, order, callback) {
      if (!phase || !name || !Number.isFinite(order) || typeof callback !== 'function') throw new TypeError('Invalid lifecycle hook');
      if (!phases.has(phase)) phases.set(phase, new Map());
      const entries = phases.get(phase);
      if (entries.has(name)) throw new Error(`Duplicate lifecycle hook: ${phase}/${name}`);
      entries.set(name, { name, order, callback });
      return () => entries.delete(name);
    }
    function ordered(phase) {
      return [...(phases.get(phase)?.values() || [])].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    }
    function emit(phase, context = {}) {
      for (const hook of ordered(phase)) {
        const result = hook.callback(context);
        if (result && typeof result.then === 'function') throw new TypeError(`Lifecycle hook must be synchronous: ${phase}/${hook.name}`);
      }
    }
    return Object.freeze({ on, emit, describe: () => [...phases.keys()].sort().map(phase => ({
      phase, hooks: ordered(phase).map(({ name, order }) => ({ name, order }))
    })) });
  };
})();
