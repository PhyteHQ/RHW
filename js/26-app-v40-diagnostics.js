/* ==========================================================================
   RHW WEB APP · PR11 SYSTEM CHECK + FULL APP AUDIT HOST
   Content-free health report for runtime, storage, data and installed-app state.
   ========================================================================== */
(function initRhwV40Diagnostics() {
  'use strict';
  const app = window.RHWV4;
  if (!app || app.diagnostics) return;

  const state = {
    events: [],
    lastSelfTestFailures: [],
    openedBy: null
  };

  function result(key, label, tone, status, detail) {
    return { key, label, tone, status, detail };
  }

  function storageHealth() {
    const probeKey = `rhw-webapp-v4:health-probe:${Date.now()}`;
    try {
      localStorage.setItem(probeKey, 'ok');
      const readable = localStorage.getItem(probeKey) === 'ok';
      localStorage.removeItem(probeKey);
      if (!readable) return result('storage', 'LOCAL SAVE', 'danger', 'READBACK FAILED', 'Changes may not survive a reload.');
      const failed = app.state.storageRecoveries?.filter(entry => !entry.recovered).length || 0;
      if (failed) return result('storage', 'LOCAL SAVE', 'danger', 'RECOVERY FAILED', `${failed} damaged cache entr${failed === 1 ? 'y could' : 'ies could'} not be backed up safely.`);
      const recovered = app.state.storageRecoveries?.filter(entry => entry.recovered).length || 0;
      return recovered
        ? result('storage', 'LOCAL SAVE', 'warn', 'RECOVERED', `${recovered} damaged cache entr${recovered === 1 ? 'y was' : 'ies were'} backed up and reset.`)
        : result('storage', 'LOCAL SAVE', 'good', 'READY', 'Drafts, settings and working copies can be saved on this device.');
    } catch (error) {
      try { localStorage.removeItem(probeKey); } catch {}
      return result('storage', 'LOCAL SAVE', 'danger', 'UNAVAILABLE', 'Browser storage is blocked or unavailable.');
    }
  }

  function runtimeHealth() {
    const ready = app.ready && document.documentElement.dataset.v40Ready !== 'false';
    const recorded = state.events.filter(entry => entry.type === 'runtime').length;
    if (recorded) return result('runtime', 'APP RUNTIME', 'danger', `${recorded} ERROR${recorded === 1 ? '' : 'S'}`, 'A runtime failure was recorded during this session.');
    return ready
      ? result('runtime', 'APP RUNTIME', 'good', 'READY', `${app.version} // BUILD ${app.config.build?.revision || 'UNKNOWN'}. Boot checks passed.`)
      : result('runtime', 'APP RUNTIME', 'warn', 'STARTING', 'The application boot sequence is still being verified.');
  }

  function telemetryHealth() {
    const snapshot = window.telemetrySnapshot();
    return result('telemetry', 'LIVE TELEMETRY', snapshot.tone, snapshot.label, snapshot.detail);
  }

  function pwaHealth() {
    if (window.RHWPWA?.isStandalone?.()) return result('pwa', 'INSTALLED APP', 'good', 'STANDALONE', 'RHW is running in its dedicated app window.');
    const mode = document.documentElement.dataset.rhwPwa || '';
    if (mode === 'ready') return result('pwa', 'OFFLINE APP', 'good', 'READY', 'The app shell is registered for offline startup.');
    if (mode === 'unavailable') return result('pwa', 'OFFLINE APP', 'warn', 'UNAVAILABLE', 'Browser mode works, but offline startup could not be registered.');
    if (mode === 'unsupported') return result('pwa', 'OFFLINE APP', 'warn', 'UNSUPPORTED', 'This browser does not support service-worker installation.');
    return result('pwa', 'OFFLINE APP', 'warn', 'CHECKING', 'Installed-app support is still being detected.');
  }

  function catalogHealth() {
    const meta = app.operationsCore?.state?.catalog?.meta || {};
    const recipes = Number(meta.recipeCount) || 0;
    const products = Number(meta.productCount) || 0;
    return recipes > 0 && products > 0
      ? result('catalog', 'RECIPE CATALOG', 'good', `${app.util.number(recipes)} READY`, `${app.util.number(products)} build targets loaded.`)
      : result('catalog', 'RECIPE CATALOG', 'danger', 'MISSING', 'Operations recipe data did not load.');
  }

  function discoveryHealth() {
    const status = app.discoveryStatus?.state?.status;
    const recipes = Number(status?.catalog?.effective?.recipes) || 0;
    if (!status || !recipes) return result('discovery', 'DISCOVERY SYNC', 'warn', 'UNKNOWN', 'Catalog provenance could not be verified.');
    const reviewed = status.workflow?.reviewRequired === true && status.workflow?.autoMerge === false;
    if (!reviewed) return result('discovery', 'DISCOVERY SYNC', 'danger', 'POLICY ERROR', 'The catalog review gate is not active.');
    const run = app.discoveryStatus.runSnapshot();
    return result('discovery', 'DISCOVERY SYNC', run.tone === 'muted' ? 'warn' : run.tone, run.label, `${run.detail} // REVIEW REQUIRED; AUTO-MERGE DISABLED`);
  }

  function newswireHealth() {
    const manager = app.newswireManager;
    if (!manager) return result('newswire', 'NEWSWIRE', 'danger', 'MISSING', 'The editorial working-copy manager did not load.');
    const entries = Number(manager.state?.entries?.length) || 0;
    const dirty = Boolean(manager.state?.dirty);
    if (manager.state?.sourceMode !== 'repository') return result('newswire', 'NEWSWIRE', 'warn', 'SOURCE NOT CURRENT', 'Cached or fallback source; review handoff needs a fresh online copy.');
    return result('newswire', 'NEWSWIRE', dirty ? 'warn' : 'good', dirty ? 'LOCAL EDITS' : 'READY', `${app.util.number(entries)} bulletins in the current working copy.`);
  }

  function collect() {
    return [
      runtimeHealth(),
      storageHealth(),
      result('network', 'CONNECTION', navigator.onLine ? 'good' : 'warn', navigator.onLine ? 'ONLINE' : 'OFFLINE', navigator.onLine ? 'Network access is available.' : 'Cached app data remains available; live feeds are paused.'),
      telemetryHealth(),
      pwaHealth(),
      catalogHealth(),
      discoveryHealth(),
      newswireHealth()
    ];
  }

  function cardMarkup(check) {
    return `<article class="rhw-diagnostics-card" data-tone="${check.tone}" data-check="${check.key}">
      <small>${app.util.escape(check.label)}</small>
      <strong>${app.util.escape(check.status)}</strong>
      <span>${app.util.escape(check.detail)}</span>
    </article>`;
  }

  function summary(checks) {
    const danger = checks.filter(check => check.tone === 'danger').length + state.lastSelfTestFailures.length;
    const warnings = checks.filter(check => check.tone === 'warn').length;
    if (danger) return { tone: 'danger', title: 'ATTENTION REQUIRED', detail: `${danger} blocking check${danger === 1 ? '' : 's'} detected.` };
    if (warnings) return { tone: 'warn', title: 'STATUS NEEDS ATTENTION', detail: `${warnings} status notice${warnings === 1 ? '' : 's'}; no blocking app failure detected.` };
    return { tone: 'good', title: 'ALL SYSTEMS NOMINAL', detail: 'No blocking failures or status notices detected.' };
  }

  function render() {
    const panel = document.getElementById('rhwDiagnosticsPanel');
    if (!panel) return collect();
    const checks = collect();
    const overall = summary(checks);
    const grid = document.getElementById('rhwDiagnosticsGrid');
    if (grid) grid.innerHTML = checks.map(cardMarkup).join('');
    const status = document.getElementById('rhwDiagnosticsOverall');
    if (status) {
      status.dataset.tone = overall.tone;
      status.querySelector('strong').textContent = overall.title;
      status.querySelector('span').textContent = overall.detail;
    }
    const journal = document.getElementById('rhwDiagnosticsJournal');
    if (journal) {
      const recoveries = app.state.storageRecoveries?.length || 0;
      const runtimeErrors = state.events.filter(entry => entry.type === 'runtime').length;
      journal.textContent = runtimeErrors || recoveries
        ? `${runtimeErrors} runtime error${runtimeErrors === 1 ? '' : 's'} // ${recoveries} local recovery event${recoveries === 1 ? '' : 's'}`
        : 'NO RUNTIME ERRORS OR LOCAL RECOVERY EVENTS RECORDED THIS SESSION';
    }
    return checks;
  }

  function buildReport(checks = collect()) {
    const route = app.route?.parse?.() || {};
    const lines = [
      'RHW SYSTEM CHECK',
      `GENERATED: ${new Date().toISOString()}`,
      `APP: ${app.version}`,
      `BUILD: ${app.config.build?.revision || 'UNKNOWN'}`,
      `ROUTE: ${route.workspace || 'unknown'} / ${route.node || 'unknown'}`,
      `WINDOW: ${window.RHWPWA?.isStandalone?.() ? 'STANDALONE APP' : 'BROWSER'}`,
      '',
      ...checks.map(check => `${check.label}: ${check.status} // ${check.detail}`),
      '',
      `INTERNAL SELF-TEST: ${state.lastSelfTestFailures.length ? `${state.lastSelfTestFailures.length} FAILURE(S)` : 'PASS'}`,
      `SESSION EVENTS: ${state.events.filter(entry => entry.type === 'runtime').length} RUNTIME ERROR(S) // ${app.state.storageRecoveries?.length || 0} STORAGE RECOVERY EVENT(S)`,
      '',
      'PRIVACY: This report contains no drafts, messages, sender profiles, material prices or inventory values.'
    ];
    return lines.join('\n');
  }

  function setActionStatus(message, tone = 'muted') {
    const status = document.getElementById('rhwDiagnosticsActionStatus');
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  }

  async function copyReport() {
    const checks = render();
    const copied = await app.util.copy(buildReport(checks));
    setActionStatus(copied ? 'SYSTEM REPORT COPIED' : 'COPY NOT AVAILABLE IN THIS BROWSER', copied ? 'good' : 'warn');
    return copied;
  }

  function runNow() {
    state.lastSelfTestFailures = app.runtime?.selfTest?.() || [];
    render();
    setActionStatus(state.lastSelfTestFailures.length ? `SELF-TEST FOUND ${state.lastSelfTestFailures.length} FAILURE(S)` : 'SELF-TEST PASSED', state.lastSelfTestFailures.length ? 'danger' : 'good');
    return [...state.lastSelfTestFailures];
  }

  function open() {
    const panel = document.getElementById('rhwDiagnosticsPanel');
    if (!panel) return;
    state.openedBy = document.activeElement;
    render();
    setActionStatus('NO USER CONTENT IS INCLUDED IN THIS CHECK');
    panel.hidden = false;
    document.getElementById('rhwDiagnosticsBtn')?.setAttribute('aria-expanded', 'true');
    document.body.classList.add('rhw-diagnostics-open');
    document.getElementById('rhwDiagnosticsClose')?.focus();
  }

  function close() {
    const panel = document.getElementById('rhwDiagnosticsPanel');
    if (panel) panel.hidden = true;
    document.body.classList.remove('rhw-diagnostics-open');
    document.getElementById('rhwDiagnosticsBtn')?.setAttribute('aria-expanded', 'false');
    state.openedBy?.focus?.();
    state.openedBy = null;
  }

  function mount() {
    if (document.getElementById('rhwDiagnosticsPanel')) return true;
    const brand = document.querySelector('.app-nav-brand');
    if (!brand || !document.body) return false;

    const button = document.createElement('button');
    button.id = 'rhwDiagnosticsBtn';
    button.className = 'rhw-diagnostics-button';
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'rhwDiagnosticsPanel');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<span>SYS CHECK</span><small>APP HEALTH</small>';
    const installButton = document.getElementById('rhwPwaInstallBtn');
    if (installButton?.parentElement === brand) brand.insertBefore(button, installButton);
    else brand.appendChild(button);

    document.body.insertAdjacentHTML('beforeend', `<aside class="rhw-diagnostics-overlay" id="rhwDiagnosticsPanel" role="dialog" aria-modal="true" aria-labelledby="rhwDiagnosticsTitle" hidden>
      <section class="rhw-diagnostics-sheet">
        <header class="rhw-diagnostics-head">
          <div><strong id="rhwDiagnosticsTitle">SYSTEM + DATA</strong></div>
          <button type="button" id="rhwDiagnosticsClose" aria-label="Close system check">CLOSE</button>
        </header>
        <div class="rhw-diagnostics-overall" id="rhwDiagnosticsOverall" data-tone="muted" role="status" aria-live="polite"><i aria-hidden="true"></i><div><strong>CHECKING SYSTEMS</strong><span>Collecting content-free app status.</span></div></div>
        <div class="rhw-diagnostics-grid" id="rhwDiagnosticsGrid"></div>
        <details class="rhw-diagnostics-events"><summary>SESSION EVENT JOURNAL</summary><p id="rhwDiagnosticsJournal">NO EVENTS RECORDED</p></details>
        <p class="rhw-diagnostics-privacy"><strong>PRIVACY SAFE:</strong> No drafts, messages, sender profiles, material prices or inventory values are read into the report.</p>
        <footer class="rhw-diagnostics-actions">
          <span id="rhwDiagnosticsActionStatus" data-tone="muted" aria-live="polite">READY</span>
          <div><button type="button" id="rhwDiagnosticsRun">RUN SELF-CHECK</button><button type="button" class="primary" id="rhwDiagnosticsCopy">COPY REPORT</button></div>
        </footer>
      </section>
    </aside>`);

    button.addEventListener('click', open);
    document.getElementById('rhwDiagnosticsClose')?.addEventListener('click', close);
    document.getElementById('rhwDiagnosticsRun')?.addEventListener('click', runNow);
    document.getElementById('rhwDiagnosticsCopy')?.addEventListener('click', copyReport);
    document.getElementById('rhwDiagnosticsPanel')?.addEventListener('click', event => {
      if (event.target.id === 'rhwDiagnosticsPanel') close();
    });
    render();
    return true;
  }

  function recordError(error) {
    state.events.push({ type: 'runtime', at: Date.now() });
    if (state.events.length > 20) state.events.shift();
    if (!document.getElementById('rhwDiagnosticsPanel')?.hidden) render();
  }

  function recordRecovery() {
    state.events.push({ type: 'storage-recovery', at: Date.now() });
    if (state.events.length > 20) state.events.shift();
    if (!document.getElementById('rhwDiagnosticsPanel')?.hidden) render();
  }

  function selfTest() {
    const failures = [];
    ['rhwDiagnosticsBtn', 'rhwDiagnosticsPanel', 'rhwDiagnosticsGrid', 'rhwDiagnosticsRun', 'rhwDiagnosticsCopy'].forEach(id => {
      if (!document.getElementById(id)) failures.push(`missing:${id}`);
    });
    if (document.querySelectorAll('.rhw-diagnostics-card').length !== 8) failures.push('cards:expected-8');
    if (!buildReport().includes('PRIVACY: This report contains no drafts')) failures.push('report:privacy-boundary');
    return failures;
  }

  window.addEventListener('rhw:storage-recovered', recordRecovery);
  window.addEventListener('online', () => { if (!document.getElementById('rhwDiagnosticsPanel')?.hidden) render(); });
  window.addEventListener('offline', () => { if (!document.getElementById('rhwDiagnosticsPanel')?.hidden) render(); });
  window.addEventListener('keydown', event => {
    const panel = document.getElementById('rhwDiagnosticsPanel');
    if (!panel || panel.hidden) return;
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll('button, summary, a[href], [tabindex]:not([tabindex="-1"])')]
      .filter(element => !element.hasAttribute('disabled') && element.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  app.diagnostics = { state, init: mount, open, close, render, collect, buildReport, copyReport, runNow, recordError, selfTest };
})();
