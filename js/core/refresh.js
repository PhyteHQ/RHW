/* Shared render notifications and visibility-aware background refreshes.
   Render subscribers run once after their owner has finished updating the DOM.
   Refresh tasks share lifecycle listeners; hidden/offline tabs have no timers. */
(function initRhwRuntime() {
  'use strict';
  const subscribers = new Map();
  const tasks = new Set();

  function onRender(view, callback) {
    if (!subscribers.has(view)) subscribers.set(view, new Set());
    const listeners = subscribers.get(view);
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  function rendered(view) {
    subscribers.get(view)?.forEach(callback => callback());
  }

  function createRefreshTask({ interval, run, enabled = () => true, dueAt = Date.now() }) {
    let nextAt = dueAt;
    let timer = null;
    let inFlight = null;
    let disposed = false;
    const eligible = () => !document.hidden && window.navigator?.onLine !== false && enabled();
    const cancelTimer = () => { window.clearTimeout(timer); timer = null; };

    function reconcile() {
      cancelTimer();
      if (disposed || inFlight || !eligible()) return;
      timer = window.setTimeout(() => {
        timer = null;
        if (eligible()) refresh().catch(error => console.warn('RHW background refresh failed:', error));
      }, Math.max(0, nextAt - Date.now()));
    }

    function refresh(...args) {
      if (inFlight) return inFlight;
      if (disposed) return Promise.resolve();
      cancelTimer();
      inFlight = Promise.resolve().then(() => run(...args)).finally(() => {
        inFlight = null;
        nextAt = Date.now() + interval;
        reconcile();
      });
      return inFlight;
    }

    const task = {
      refresh, reconcile,
      setDueAt(value) { nextAt = value; reconcile(); },
      dispose() { disposed = true; cancelTimer(); tasks.delete(task); }
    };
    tasks.add(task);
    reconcile();
    return task;
  }

  function reconcile() { tasks.forEach(task => task.reconcile()); }
  document.addEventListener('visibilitychange', reconcile);
  window.addEventListener('online', reconcile);
  window.addEventListener('offline', reconcile);
  window.RHWRuntime = { onRender, rendered, createRefreshTask, reconcile };
})();
