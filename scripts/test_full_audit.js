#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');

global.window = globalThis;
global.innerWidth = 390;
global.innerHeight = 820;
global.location = { protocol: 'https:' };
window.RHWV4 = {
  version: 'V4.0.2',
  config: { routes: { command: ['overview', 'inventory', 'shipyard', 'production', 'logistics'], operations: ['calculator'], pricecheck: ['routes'], comms: ['forum', 'ticker', 'drafts', 'senders'] } },
  util: { escape: value => String(value) },
  route: { parse: () => ({ workspace: 'command', node: 'overview' }) }
};

require('../js/30-app-v40-full-audit.js');

const audit = window.RHWV4.fullAudit;
assert.ok(audit, 'Full audit API must be registered');
assert.deepEqual(audit.EXPECTED_ROUTES.pricecheck, ['routes']);
assert.ok(!audit.EXPECTED_ROUTES.operations.includes('orders'));
assert.equal(Object.values(audit.EXPECTED_ROUTES).flat().length, 11, 'Route model must cover all 11 app destinations');

const results = [
  { key: 'route', label: 'ROUTE MODEL', tone: 'good', status: '11 READY', detail: 'All routes mounted.' },
  { key: 'touch', label: 'TOUCH TARGETS', tone: 'warn', status: '1 COMPACT', detail: 'Review one compact control.' },
  { key: 'dom', label: 'DOM IDENTITY', tone: 'danger', status: 'INVALID', detail: 'One broken reference.' }
];
assert.deepEqual(audit.summary(results), { total: 3, pass: 1, warn: 1, fail: 1 }, 'Summary must separate pass, notice and fail states');

const report = audit.buildReport(results);
assert.match(report, /11 READY/);
assert.match(report, /1 PASS \/\/ 1 NOTICE \/\/ 1 FAIL/);
assert.match(report, /PRIVACY: This audit uses synthetic markers and numeric structure checks only/);
assert.doesNotMatch(report, /PRIVATE USER MESSAGE/, 'Audit report must not introduce user content');
assert.deepEqual(audit.selfTest(), [], 'Pure audit self-test must pass without a mounted document');

console.log('PR11 full audit model passed: 11-route matrix, summary states and privacy boundary');
