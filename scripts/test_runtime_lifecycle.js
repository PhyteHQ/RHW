#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  let now = 1000, sequence = 0;
  const timers = new Map(), windowEvents = new Map(), documentEvents = new Map();
  const ctx = vm.createContext({
    console, Promise,
    Date: { now: () => now },
    navigator: { onLine: true },
    document: { hidden: true, addEventListener: (type, callback) => documentEvents.set(type, callback) },
    addEventListener: (type, callback) => windowEvents.set(type, callback),
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/00-runtime.js'), 'utf8'), ctx);
  const runtime = ctx.RHWRuntime;
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  async function advance(ms) {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now && timers.delete(id)) timer.callback();
    }
    await flush();
  }
  function visible(value) { ctx.document.hidden = !value; documentEvents.get('visibilitychange')(); }
  function online(value) { ctx.navigator.onLine = value; windowEvents.get(value ? 'online' : 'offline')(); }

  let active = true, calls = 0;
  const task = runtime.createRefreshTask({ interval: 100, enabled: () => active, run: () => { calls++; } });
  assert.equal(timers.size, 0, 'A background tab starts no automatic timer');
  await advance(1000);
  visible(true);
  await advance(0);
  assert.equal(calls, 1, 'An overdue visible task refreshes once');
  assert.equal(timers.size, 1);
  await advance(50);
  visible(false);
  assert.equal(timers.size, 0, 'Hiding the tab cancels its timer immediately');
  await advance(1000);
  visible(true);
  await advance(0);
  assert.equal(calls, 2, 'Returning does not replay missed refresh intervals');
  visible(false); visible(true);
  await advance(0);
  assert.equal(calls, 2, 'Repeated tab switches do not recheck fresh data');
  active = false; runtime.reconcile();
  assert.equal(timers.size, 0, 'Leaving Price Check cancels its scheduled work');
  await advance(1000);
  active = true; runtime.reconcile();
  await advance(0);
  assert.equal(calls, 3);
  online(false);
  assert.equal(timers.size, 0, 'Offline documents do not schedule network work');
  await advance(1000); online(true); await advance(0);
  assert.equal(calls, 4, 'Connection recovery performs one overdue refresh');
  task.dispose();
  assert.equal(timers.size, 0);

  let resolve;
  const pending = runtime.createRefreshTask({ interval: 100, dueAt: now + 100,
    run: () => new Promise(done => { calls++; resolve = done; }) });
  const first = pending.refresh();
  assert.equal(pending.refresh(), first, 'Manual and automatic requests share the same in-flight promise');
  await flush();
  visible(false); await advance(1000); visible(true);
  assert.equal(timers.size, 0, 'Returning during a fetch cannot schedule a duplicate');
  resolve(); await first;
  assert.equal(timers.size, 1);
  const last = pending.refresh(); await flush(); pending.dispose(); resolve(); await last;
  assert.equal(timers.size, 0, 'Disposal during a fetch cannot resurrect the timer');

  const rejected = runtime.createRefreshTask({ interval: 100, dueAt: now + 100, run: () => Promise.reject(new Error('unavailable')) });
  await assert.rejects(rejected.refresh(), /unavailable/);
  assert.equal(timers.size, 1, 'A failed manual refresh retains the normal retry delay');
  rejected.dispose();

  const seen = [];
  const unsubscribe = runtime.onRender('calculator', () => seen.push('calculator'));
  runtime.onRender('pricing', () => seen.push('pricing'));
  runtime.rendered('pricing'); runtime.rendered('calculator'); unsubscribe(); runtime.rendered('calculator');
  assert.deepEqual(seen, ['pricing', 'calculator'], 'Render hooks are scoped and removable');
  console.log('Runtime lifecycle passed: visibility, workspace changes, offline recovery, due times, request coalescing, failures, disposal and scoped render hooks.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
