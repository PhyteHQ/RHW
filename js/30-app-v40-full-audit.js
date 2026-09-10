/* ==========================================================================
   RHW WEB APP · PR11 FULL APP AUDIT
   Repeatable, content-free checks for routes, UI, workflows and local runtime.
   ========================================================================== */
(function initRhwFullAppAudit() {
  'use strict';
  const app = window.RHWV4;
  if (!app || app.fullAudit) return;

  const EXPECTED_ROUTES = app.config.routes;
  const state = { results: [], lastRunAt: 0, running: false, autoRun: false };
  const esc = value => app.util.escape(String(value ?? ''));
  const makeResult = (key, label, tone, status, detail) => ({ key, label, tone, status, detail });
  const totalRoutes = () => Object.values(EXPECTED_ROUTES).reduce((total, routes) => total + routes.length, 0);

  function visible(element) {
    if (!element || element.hidden || element.closest('[hidden]')) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function routeTopology() {
    const selectors = {
      command: '[data-command-panel]',
      operations: '[data-operations-panel]',
      pricecheck: '[data-pricecheck-panel]',
      comms: '[data-comms-panel]'
    };
    const discovered = {};
    const missing = [];
    Object.entries(EXPECTED_ROUTES).forEach(([workspace, routes]) => {
      discovered[workspace] = [...document.querySelectorAll(selectors[workspace])]
        .map(panel => panel.dataset[`${workspace}Panel`]);
      routes.forEach(route => {
        if (!discovered[workspace].includes(route)) missing.push(`${workspace}/${route}`);
      });
      if (!document.getElementById(`workspace${workspace[0].toUpperCase()}${workspace.slice(1)}`)) missing.push(`${workspace}/workspace`);
    });
    const found = Object.values(discovered).reduce((total, routes) => total + routes.length, 0);
    return missing.length || found !== totalRoutes()
      ? makeResult('routes', 'ROUTE TOPOLOGY', 'danger', 'INCOMPLETE', `${found} / ${totalRoutes()} expected route panels detected.`)
      : makeResult('routes', 'ROUTE TOPOLOGY', 'good', `${found} READY`, 'All published workspaces and destinations are mounted.');
  }

  function moduleContracts() {
    const contracts = [
      app.command?.activate, app.operations?.activate, app.comms?.activate,
      app.storage?.exportPayload, app.storage?.importPayload,
      app.pricecheck?.refresh, app.transferCenter?.previewFile,
      app.newswireManager?.parseSource, app.newswireManager?.serializeSource,
      app.newswire2?.buildForumBbcode, app.newswireReview?.buildReviewPackage,
      app.discoveryStatus?.init, app.diagnostics?.init,
      window.RHWPWA?.isStandalone
    ];
    const ready = contracts.filter(contract => typeof contract === 'function').length;
    return ready === contracts.length
      ? makeResult('modules', 'MODULE CONTRACTS', 'good', `${ready} READY`, 'Core app and workflow APIs are available.')
      : makeResult('modules', 'MODULE CONTRACTS', 'danger', 'INCOMPLETE', `${ready} / ${contracts.length} required APIs are available.`);
  }

  function activeRouteConsistency() {
    const workspace = app.state.activeWorkspace;
    const meta = {
      command: ['commandNode', 'data-command-panel'],
      operations: ['operationsNode', 'data-operations-panel'],
      pricecheck: ['pricecheckNode', 'data-pricecheck-panel'],
      comms: ['commsNode', 'data-comms-panel']
    }[workspace];
    const workspaces = [...document.querySelectorAll('.app-workspace')].filter(element => !element.hidden);
    const selected = [...document.querySelectorAll('.app-tabs [data-workspace][aria-selected="true"]')];
    const activeNode = meta ? app.state[meta[0]] : '';
    const nodePanels = meta ? [...document.querySelectorAll(`[${meta[1]}]`)].filter(element => !element.hidden) : [];
    const route = app.route?.parse?.() || {};
    const matches = workspaces.length === 1 && selected.length === 1 && selected[0].dataset.workspace === workspace &&
      nodePanels.length === 1 && nodePanels[0].dataset[`${workspace}Panel`] === activeNode &&
      route.workspace === workspace && route.node === activeNode;
    return matches
      ? makeResult('active-route', 'ACTIVE ROUTE', 'good', 'SYNCHRONIZED', `${String(workspace || '').toUpperCase()} / ${String(activeNode || '').toUpperCase()} matches UI state.`)
      : makeResult('active-route', 'ACTIVE ROUTE', 'danger', 'STATE MISMATCH', 'URL, selected navigation and visible panel are not synchronized.');
  }

  function domIdentity() {
    const counts = new Map();
    document.querySelectorAll('[id]').forEach(element => counts.set(element.id, (counts.get(element.id) || 0) + 1));
    const duplicates = [...counts.values()].filter(count => count > 1).length;
    let brokenRefs = 0;
    document.querySelectorAll('[aria-controls],[aria-labelledby]').forEach(element => {
      ['aria-controls', 'aria-labelledby'].forEach(attribute => {
        String(element.getAttribute(attribute) || '').split(/\s+/).filter(Boolean).forEach(id => {
          if (!document.getElementById(id)) brokenRefs += 1;
        });
      });
    });
    return duplicates || brokenRefs
      ? makeResult('dom', 'DOM IDENTITY + LINKS', 'danger', 'INVALID', `${duplicates} duplicate ID group(s); ${brokenRefs} broken ARIA reference(s).`)
      : makeResult('dom', 'DOM IDENTITY + LINKS', 'good', 'VALID', 'IDs are unique and labelled controls resolve to mounted elements.');
  }

  function controlName(element) {
    const explicit = element.getAttribute('aria-label') || element.getAttribute('title');
    if (explicit?.trim()) return explicit.trim();
    const labelled = String(element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
    if (labelled) return labelled;
    if (['BUTTON', 'A', 'SUMMARY'].includes(element.tagName) && element.textContent.trim()) return element.textContent.trim();
    if (element.id) {
      const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (label?.textContent.trim()) return label.textContent.trim();
    }
    const parentLabel = element.closest('label');
    if (parentLabel?.textContent.trim()) return parentLabel.textContent.trim();
    return element.getAttribute('placeholder') || '';
  }

  function accessibleControls() {
    const controls = [...document.querySelectorAll('button,a[href],input:not([type="hidden"]),select,textarea,summary')]
      .filter(visible);
    const unnamed = controls.filter(element => !controlName(element)).length;
    return unnamed
      ? makeResult('controls', 'CONTROL NAMES', 'warn', `${unnamed} REVIEW`, `${controls.length - unnamed} / ${controls.length} controls expose a readable name.`)
      : makeResult('controls', 'CONTROL NAMES', 'good', `${controls.length} READY`, 'Interactive controls expose a readable name.');
  }

  function dialogSafety() {
    const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')];
    const invalid = dialogs.filter(dialog => {
      const labelId = dialog.getAttribute('aria-labelledby');
      return !labelId || !document.getElementById(labelId) || dialog.dataset.focusTrap !== 'true';
    }).length;
    return invalid
      ? makeResult('dialogs', 'MODAL DIALOGS', 'danger', 'UNSAFE', `${invalid} / ${dialogs.length} modal dialogs need labelled focus containment.`)
      : makeResult('dialogs', 'MODAL DIALOGS', 'good', `${dialogs.length} SAFE`, 'Modal dialogs are labelled and keep keyboard focus inside.');
  }

  function viewportHealth() {
    const overflow = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0) - window.innerWidth;
    return overflow > 2
      ? makeResult('viewport', 'VIEWPORT FIT', 'danger', 'OVERFLOW', `${Math.ceil(overflow)} px horizontal overflow at ${window.innerWidth} px.`)
      : makeResult('viewport', 'VIEWPORT FIT', 'good', `${window.innerWidth} PX FIT`, 'No horizontal document overflow detected.');
  }

  function touchTargets() {
    if (window.innerWidth > 760) return makeResult('touch', 'TOUCH TARGETS', 'good', 'DESKTOP', 'Mobile target sizing is checked at 760 px and below.');
    const controls = [...document.querySelectorAll('button,a[href],input,select,textarea,summary')].filter(visible);
    const small = controls.filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width < 43.5 || rect.height < 43.5;
    }).length;
    return small
      ? makeResult('touch', 'TOUCH TARGETS', 'warn', `${small} COMPACT`, `${controls.length - small} / ${controls.length} visible targets meet the 44 px comfort size.`)
      : makeResult('touch', 'TOUCH TARGETS', 'good', `${controls.length} READY`, 'Visible controls meet the 44 px mobile comfort size.');
  }

  function motionContract() {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const applied = document.documentElement.classList.contains('eco');
    if (reduced && !applied) return makeResult('motion', 'REDUCED MOTION', 'danger', 'NOT APPLIED', 'The operating-system motion preference is not active in the app.');
    return makeResult('motion', 'REDUCED MOTION', 'good', reduced ? 'SYSTEM ACTIVE' : applied ? 'ECO ACTIVE' : 'FULL FX', reduced ? 'The operating-system accessibility preference is authoritative.' : 'The current animation preference is applied.');
  }

  function forumParity() {
    try {
      const sample = {
        ...app.state.comms,
        recipient: 'AUDIT RECIPIENT', subject: 'AUDIT SUBJECT', message: 'AUDIT MESSAGE',
        classification: app.state.comms?.classification || 'RHW OFFICIAL'
      };
      const output = app.comms.buildBbcode(sample);
      const ready = ['AUDIT RECIPIENT', 'AUDIT SUBJECT', 'AUDIT MESSAGE'].every(marker => output.includes(marker));
      return ready
        ? makeResult('forum-parity', 'FORUM BB CODE', 'good', 'SYNCHRONIZED', 'Recipient, subject and message survive the shared forum builder.')
        : makeResult('forum-parity', 'FORUM BB CODE', 'danger', 'PARITY FAILED', 'A synthetic field did not reach forum output.');
    } catch {
      return makeResult('forum-parity', 'FORUM BB CODE', 'danger', 'BUILDER ERROR', 'The forum output contract could not complete.');
    }
  }

  function newswireParity() {
    try {
      const sample = [{ id: 'audit-1', category: 'operations', tone: 'good', tag: 'AUDIT TAG', message: 'AUDIT MESSAGE' }];
      const source = app.newswireManager.serializeSource(sample);
      const roundTrip = app.newswireManager.parseSource(source);
      const forum = app.newswire2.buildForumBbcode(sample[0]);
      const ready = roundTrip.length === 1 && roundTrip[0].tag === sample[0].tag && roundTrip[0].message === sample[0].message &&
        forum.includes(sample[0].tag) && forum.includes(sample[0].message);
      return ready
        ? makeResult('newswire-parity', 'NEWSWIRE CHANNELS', 'good', 'SYNCHRONIZED', 'Markdown round-trip and forum channel output preserve a synthetic bulletin.')
        : makeResult('newswire-parity', 'NEWSWIRE CHANNELS', 'danger', 'PARITY FAILED', 'Newswire source and forum output do not agree.');
    } catch {
      return makeResult('newswire-parity', 'NEWSWIRE CHANNELS', 'danger', 'BUILDER ERROR', 'The Newswire output contract could not complete.');
    }
  }

  function priceCheckContract() {
    const failures = app.pricecheck?.selfTest?.() || ['module'];
    return failures.length
      ? makeResult('pricecheck', 'PRICE CHECK', 'danger', 'INCOMPLETE', 'Fixed-route controls or data contracts are unavailable.')
      : makeResult('pricecheck', 'PRICE CHECK', 'good', 'READY', 'Fixed routes, manual prices and data provenance are available.');
  }

  function catalogTruth() {
    const meta = app.operationsCore?.state?.catalog?.meta || {};
    const recipes = Number(meta.recipeCount) || 0;
    const products = Number(meta.productCount) || 0;
    const effective = app.discoveryStatus?.state?.status?.catalog?.effective;
    const agrees = !effective || ((Number(effective.recipes) || 0) === recipes && (Number(effective.products) || 0) === products);
    if (!recipes || !products) return makeResult('catalog-truth', 'CATALOG DATA TRUTH', 'danger', 'MISSING', 'Recipe or product counts are unavailable.');
    return agrees
      ? makeResult('catalog-truth', 'CATALOG DATA TRUTH', 'good', `${recipes} RECIPES`, `${products} build targets agree with the active Discovery status.`)
      : makeResult('catalog-truth', 'CATALOG DATA TRUTH', 'danger', 'COUNT MISMATCH', 'Runtime catalog counts and Discovery status disagree.');
  }

  function localSaveProbe() {
    const key = `rhw-webapp-v4:full-audit:${Date.now()}`;
    try {
      localStorage.setItem(key, 'ready');
      const ready = localStorage.getItem(key) === 'ready';
      localStorage.removeItem(key);
      return ready
        ? makeResult('local-save', 'LOCAL SAVE PROBE', 'good', 'READ + WRITE', 'Temporary device storage passed a content-free readback test.')
        : makeResult('local-save', 'LOCAL SAVE PROBE', 'danger', 'READBACK FAILED', 'Temporary device storage did not return the written probe.');
    } catch {
      try { localStorage.removeItem(key); } catch {}
      const deployedOrigin = ['http:', 'https:'].includes(location.protocol);
      return deployedOrigin
        ? makeResult('local-save', 'LOCAL SAVE PROBE', 'danger', 'UNAVAILABLE', 'Browser storage is blocked or unavailable.')
        : makeResult('local-save', 'LOCAL SAVE PROBE', 'warn', 'NOT TESTABLE', 'This non-web test origin does not provide browser storage.');
    }
  }

  function pwaContract() {
    const api = window.RHWPWA;
    const manifest = document.querySelector('link[rel="manifest"]');
    const ready = manifest && typeof api?.isStandalone === 'function' && typeof api?.showInstallHelp === 'function';
    return ready
      ? makeResult('pwa-contract', 'APP INSTALL CONTRACT', 'good', api.isStandalone() ? 'STANDALONE' : 'READY', 'Manifest and install helpers are available.')
      : makeResult('pwa-contract', 'APP INSTALL CONTRACT', 'danger', 'INCOMPLETE', 'Manifest or installed-app helper is missing.');
  }

  function collect() {
    return [
      routeTopology(), moduleContracts(), activeRouteConsistency(), domIdentity(), accessibleControls(),
      dialogSafety(), viewportHealth(), touchTargets(), motionContract(), forumParity(), newswireParity(),
      priceCheckContract(), catalogTruth(), localSaveProbe(), pwaContract()
    ];
  }

  function summary(results = state.results) {
    return results.reduce((totals, item) => {
      totals.total += 1;
      if (item.tone === 'danger') totals.fail += 1;
      else if (item.tone === 'warn') totals.warn += 1;
      else totals.pass += 1;
      return totals;
    }, { total: 0, pass: 0, warn: 0, fail: 0 });
  }

  function resultMarkup(item) {
    return `<article class="rhw-full-audit-result" data-tone="${esc(item.tone)}" data-audit="${esc(item.key)}"><div><small>${esc(item.label)}</small><strong>${esc(item.status)}</strong></div><span>${esc(item.detail)}</span></article>`;
  }

  function render(results = state.results) {
    const totals = summary(results);
    [['rhwAuditTotal', totals.total], ['rhwAuditPass', totals.pass], ['rhwAuditWarn', totals.warn], ['rhwAuditFail', totals.fail]].forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.textContent = String(value);
    });
    const list = document.getElementById('rhwFullAuditResults');
    if (list) list.innerHTML = results.length ? results.map(resultMarkup).join('') : '<p class="rhw-full-audit-empty">NOT RUN THIS SESSION</p>';
    const status = document.getElementById('rhwFullAuditStatus');
    if (status) {
      status.dataset.tone = totals.fail ? 'danger' : totals.warn ? 'warn' : results.length ? 'good' : 'muted';
      status.textContent = results.length
        ? totals.fail ? `${totals.fail} BLOCKING FAILURE${totals.fail === 1 ? '' : 'S'}` : totals.warn ? `PASS // ${totals.warn} NOTICE${totals.warn === 1 ? '' : 'S'}` : 'ALL AUDIT CHECKS PASSED'
        : 'READY';
    }
    return totals;
  }

  function buildReport(results = state.results) {
    const totals = summary(results);
    const route = app.route?.parse?.() || {};
    return [
      'RHW FULL APP AUDIT',
      `GENERATED: ${new Date().toISOString()}`,
      `APP: ${app.version}`,
      `ROUTE: ${route.workspace || 'unknown'} / ${route.node || 'unknown'}`,
      `VIEWPORT: ${window.innerWidth} x ${window.innerHeight}`,
      `SUMMARY: ${totals.pass} PASS // ${totals.warn} NOTICE // ${totals.fail} FAIL`,
      '',
      ...results.map(item => `${item.label}: ${item.status} // ${item.detail}`),
      '',
      'PRIVACY: This audit uses synthetic markers and numeric structure checks only. It contains no drafts, messages, sender profiles, material prices or inventory values.'
    ].join('\n');
  }

  async function copyReport() {
    const results = state.results.length ? state.results : await run();
    const copied = await app.util.copy(buildReport(results));
    const status = document.getElementById('rhwFullAuditStatus');
    if (status) {
      status.dataset.tone = copied ? 'good' : 'warn';
      status.textContent = copied ? 'AUDIT REPORT COPIED' : 'COPY NOT AVAILABLE';
    }
    return copied;
  }

  async function run() {
    if (state.running) return state.results;
    state.running = true;
    const button = document.getElementById('rhwFullAuditRun');
    if (button) { button.disabled = true; button.textContent = 'SCANNING…'; }
    const status = document.getElementById('rhwFullAuditStatus');
    if (status) { status.dataset.tone = 'muted'; status.textContent = 'SCANNING APP SHELL…'; }
    await new Promise(resolve => requestAnimationFrame(() => resolve()));
    state.results = collect();
    state.lastRunAt = Date.now();
    state.running = false;
    if (button) { button.disabled = false; button.textContent = 'RUN FULL AUDIT'; }
    render();
    return [...state.results];
  }

  function installSemantics() {
    document.querySelectorAll('.app-tabs [data-workspace]').forEach(button => {
      const workspace = button.dataset.workspace;
      button.id ||= `workspace${workspace[0].toUpperCase()}${workspace.slice(1)}Tab`;
      document.getElementById(button.getAttribute('aria-controls'))?.setAttribute('aria-labelledby', button.id);
    });
    const diagnostics = document.getElementById('rhwDiagnosticsPanel');
    if (diagnostics) diagnostics.dataset.focusTrap = 'true';
  }

  function mount() {
    const panel = document.getElementById('rhwDiagnosticsPanel');
    const before = panel?.querySelector('.rhw-diagnostics-events');
    if (!panel || !before) return false;
    if (!document.getElementById('rhwFullAudit')) {
      before.insertAdjacentHTML('beforebegin', `<section class="rhw-full-audit" id="rhwFullAudit" aria-labelledby="rhwFullAuditTitle"><header><div><strong id="rhwFullAuditTitle">FULL APP AUDIT</strong></div><span id="rhwFullAuditStatus" data-tone="muted" aria-live="polite">READY</span></header><div class="rhw-full-audit-actions"><button type="button" id="rhwFullAuditRun">RUN FULL AUDIT</button><button type="button" id="rhwFullAuditCopy">COPY AUDIT</button></div><div class="rhw-full-audit-metrics"><div><small>TOTAL</small><strong id="rhwAuditTotal">0</strong></div><div data-tone="good"><small>PASS</small><strong id="rhwAuditPass">0</strong></div><div data-tone="warn"><small>NOTICE</small><strong id="rhwAuditWarn">0</strong></div><div data-tone="danger"><small>FAIL</small><strong id="rhwAuditFail">0</strong></div></div><div class="rhw-full-audit-results" id="rhwFullAuditResults"><p class="rhw-full-audit-empty">NOT RUN THIS SESSION</p></div></section>`);
    }
    document.getElementById('rhwFullAuditRun')?.addEventListener('click', run);
    document.getElementById('rhwFullAuditCopy')?.addEventListener('click', copyReport);
    document.getElementById('rhwDiagnosticsBtn')?.addEventListener('click', () => {
      if (state.autoRun) return;
      state.autoRun = true;
      queueMicrotask(run);
    });
    return true;
  }

  function selfTest() {
    const failures = [];
    if (totalRoutes() !== 11) failures.push('route-model');
    const sample = summary([
      makeResult('a', 'A', 'good', 'PASS', 'Ready.'),
      makeResult('b', 'B', 'warn', 'NOTICE', 'Review.'),
      makeResult('c', 'C', 'danger', 'FAIL', 'Blocked.')
    ]);
    if (sample.total !== 3 || sample.pass !== 1 || sample.warn !== 1 || sample.fail !== 1) failures.push('summary');
    ['rhwFullAudit', 'rhwFullAuditRun', 'rhwFullAuditCopy', 'rhwFullAuditResults'].forEach(id => {
      if (typeof document !== 'undefined' && document.getElementById('rhwDiagnosticsPanel') && !document.getElementById(id)) failures.push(`missing:${id}`);
    });
    if (!buildReport([]).includes('PRIVACY: This audit uses synthetic markers')) failures.push('privacy-boundary');
    return failures;
  }

  function init() {
    installSemantics();
    return mount();
  }

  app.fullAudit = { EXPECTED_ROUTES, state, init, run, collect, render, summary, buildReport, copyReport, selfTest };
})();
