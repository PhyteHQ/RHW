/* ==========================================================================
   RHW WEB APP · PR6 DISCOVERY DATA STATUS
   Honest catalog provenance, sync health and review-gated maintenance links.
   ========================================================================== */
(function initRhwDiscoveryStatus() {
  'use strict';
  const app = window.RHWV4;
  const core = app?.operationsCore;
  if (!app || !core || app.discoveryStatus) return;

  const STATUS_URL = './assets/discovery-status.json';
  const REPOSITORY = app.config.repository;
  const WORKFLOW_URL = `https://github.com/${REPOSITORY}/actions/workflows/discovery-catalog-sync.yml`;
  const REPORT_URL = `https://github.com/${REPOSITORY}/blob/main/docs/discovery-sync-report.md`;
  const RUNS_API = `https://api.github.com/repos/${REPOSITORY}/actions/workflows/discovery-catalog-sync.yml/runs?per_page=1&exclude_pull_requests=true`;
  const PROPOSAL_URL = `https://raw.githubusercontent.com/${REPOSITORY}/automation/discovery-catalog-sync/assets/discovery-status.json`;
  const REVIEW_URL = `https://github.com/${REPOSITORY}/compare/main...automation/discovery-catalog-sync`;
  const state = { status: null, latestRun: null, proposal: null, checking: false };
  const esc = value => app.util.escape(String(value ?? ''));

  function fallbackStatus() {
    const meta = core.state.catalog?.meta || {};
    return {
      catalogState: 'catalog-ready',
      catalogUpdatedAt: null,
      lastSuccessfulSync: null,
      catalog: {
        effective: {
          recipes: Number(meta.recipeCount) || 0,
          products: Number(meta.productCount) || 0,
          factions: Number(meta.factionCount) || 0
        }
      },
      source: {
        files: meta.sourceFiles || ['base_recipe_items.cfg', 'base_recipe_modules.cfg'],
        sha256: meta.sourceSha256 || {}
      },
      workflow: { reviewRequired: true, autoMerge: false }
    };
  }

  function validStatus(value) {
    return Boolean(value && value.schemaVersion === 1 && value.catalog?.effective && value.source?.sha256);
  }

  function dateLabel(value) {
    if (!value) return 'FIRST AUTOMATED RUN PENDING';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'DATE UNAVAILABLE';
    const parts = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      hour12: false, timeZone: 'UTC'
    }).format(date).toUpperCase();
    return `${parts} UTC`;
  }

  function sourceHost(status) {
    const values = Object.values(status?.source?.downloadedFrom || {});
    if (!values.length) return 'DISCOVERY PUBLIC CFG';
    try {
      const hosts = [...new Set(values.map(value => new URL(value).hostname.replace(/^www\./, '')))];
      return hosts.join(' + ').toUpperCase();
    } catch {
      return 'VALIDATED CFG DOWNLOAD';
    }
  }

  function changeTotal(status) {
    return Object.values(status?.changes || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  }

  function runSnapshot() {
    const run = state.latestRun;
    if (state.checking) return { tone: 'warn', label: 'CHECKING', detail: 'CONTACTING SYNC CONTROL' };
    if (state.checkError) return { tone: 'warn', label: 'CHECK UNAVAILABLE', detail: 'LATEST RUN COULD NOT BE VERIFIED' };
    if (!run) return { tone: 'muted', label: 'NO LIVE CHECK YET', detail: 'TAP CHECK LATEST RUN' };
    const proposalHashes = state.proposal?.source?.sha256;
    const currentHashes = state.status?.source?.sha256;
    if (proposalHashes && currentHashes && Object.keys(currentHashes).some(key => currentHashes[key] !== proposalHashes[key])) {
      return { tone: 'warn', label: 'UPDATE AWAITS REVIEW', detail: `SOURCE CHECK ${dateLabel(state.proposal.lastSuccessfulSync || state.proposal.catalogUpdatedAt)}` };
    }
    const conclusion = String(run.conclusion || run.status || 'unknown').toUpperCase();
    const runTime = Date.parse(run.updated_at || run.created_at);
    if (conclusion === 'SUCCESS' && (!Number.isFinite(runTime) || Date.now() - runTime > 8 * 86400000)) return { tone: 'warn', label: 'CHECK OVERDUE', detail: dateLabel(run.updated_at || run.created_at) };
    const tone = conclusion === 'SUCCESS' ? 'good' : (['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(conclusion) ? 'danger' : 'warn');
    return { tone, label: conclusion, detail: dateLabel(run.updated_at || run.created_at) };
  }

  function panelMarkup(status) {
    const counts = status.catalog?.effective || {};
    const hashes = status.source?.sha256 || {};
    const files = status.source?.files || [];
    const firstHash = hashes[files[0]] || Object.values(hashes)[0] || '';
    const run = runSnapshot();
    const changes = changeTotal(status);
    const stateLabel = status.catalogState === 'verified' ? 'VERIFIED' : 'CATALOG READY';
    return `<section class="discovery-data-panel" id="discoveryDataStatus" aria-labelledby="discoveryDataTitle">
      <header class="discovery-data-head">
        <div><span>DISCOVERY DATA</span><strong id="discoveryDataTitle">CATALOG INTEGRITY + SYNC CONTROL</strong></div>
        <b class="discovery-state" data-tone="${esc(status.catalogState === 'verified' ? 'good' : 'muted')}">${esc(stateLabel)}</b>
      </header>
      <div class="discovery-data-grid">
        <article><small>ACTIVE APP CATALOG</small><strong>${esc(counts.recipes || 0)} RECIPES</strong><span>${esc(counts.products || 0)} BUILD TARGETS · ${esc(counts.factions || 0)} IFF</span></article>
        <article><small>LAST CATALOG UPDATE</small><strong>${esc(dateLabel(status.catalogUpdatedAt))}</strong><span>${changes ? `${esc(changes)} TRACKED DELTAS IN REPORT` : 'NO DELTA RECORDED'}</span></article>
        <article class="discovery-live"><small>LATEST AUTOMATION CHECK</small><strong id="discoveryLiveState" data-tone="${esc(run.tone)}">${esc(run.label)}</strong><span id="discoveryLiveTime">${esc(run.detail)}</span></article>
        <article><small>SOURCE INTEGRITY</small><strong>SHA-256 ${esc(firstHash.slice(0, 10).toUpperCase() || 'UNAVAILABLE')}</strong><span>${esc(sourceHost(status))}</span></article>
      </div>
      <div class="discovery-data-actions">
        <button type="button" id="discoveryCheckRun">CHECK LATEST RUN</button>
        <a href="${WORKFLOW_URL}" target="_blank" rel="noopener noreferrer">OPEN SYNC CONTROL</a>
        <a href="${REVIEW_URL}" target="_blank" rel="noopener noreferrer">REVIEW PENDING UPDATE</a>
        <a href="${REPORT_URL}" target="_blank" rel="noopener noreferrer">VIEW CHANGE REPORT</a>
      </div>
      <details class="discovery-source-details"><summary>CFG SOURCE HASHES + SAFETY POLICY</summary><div>${files.map(file => `<p><b>${esc(file)}</b><code>${esc(hashes[file] || 'UNAVAILABLE')}</code></p>`).join('')}<p><b>REVIEW GATE</b><code>REVIEWED BRANCH / DRAFT PR · AUTO-MERGE DISABLED</code></p></div></details>
      <p class="discovery-data-note">SYNC DOWNLOADS TO A TEMPORARY WORKSPACE, VALIDATES IDS / OUTPUTS / QUANTITIES / IFF + CHANGE SIZE, THEN PREPARES A REVIEW BRANCH WHEN DATA CHANGES. IF REPOSITORY POLICY ALLOWS IT, A DRAFT PR IS OPENED. OTHERWISE USE REVIEW PENDING UPDATE.</p>
    </section>`;
  }

  function mount(status) {
    const workspace = document.getElementById('workspaceOperations');
    const nav = document.getElementById('operationsNodeNav');
    if (!workspace || !nav) return false;
    document.getElementById('discoveryDataStatus')?.remove();
    nav.insertAdjacentHTML('beforebegin', panelMarkup(status));
    document.getElementById('discoveryCheckRun')?.addEventListener('click', () => checkLatestRun({ announceFailure: true }));
    return true;
  }

  function updateLiveRun() {
    const run = runSnapshot();
    const label = document.getElementById('discoveryLiveState');
    const detail = document.getElementById('discoveryLiveTime');
    const button = document.getElementById('discoveryCheckRun');
    if (label) { label.textContent = run.label; label.dataset.tone = run.tone; }
    if (detail) detail.textContent = run.detail;
    app.diagnostics?.render?.();
    if (button) { button.disabled = state.checking; button.textContent = state.checking ? 'CHECKING…' : 'CHECK LATEST RUN'; }
  }

  async function checkLatestRun({ announceFailure = false } = {}) {
    if (state.checking || window.__RHW_SMOKE_INLINE__) return null;
    if (navigator.onLine === false) { state.checkError = true; updateLiveRun(); return null; }
    state.checking = true;
    state.checkError = false;
    updateLiveRun();
    try {
      const response = await fetchWithTimeout(RUNS_API, {
        cache: 'no-store',
        headers: { Accept: 'application/vnd.github+json' }
      }, 10000);
      if (!response.ok) throw new Error(`GitHub status ${response.status}`);
      const payload = await response.json();
      state.latestRun = Array.isArray(payload.workflow_runs) ? payload.workflow_runs[0] || null : null;
      try {
        const proposalResponse = await fetchWithTimeout(PROPOSAL_URL, { cache: 'no-store' }, 10000);
        if (proposalResponse.ok) {
          const proposal = await proposalResponse.json();
          state.proposal = validStatus(proposal) ? proposal : null;
        } else state.proposal = null;
      } catch { state.proposal = null; }
      if (state.latestRun?.html_url && !String(state.latestRun.html_url).startsWith(`https://github.com/${REPOSITORY}/actions/runs/`)) {
        state.latestRun.html_url = null;
      }
    } catch (_error) {
      state.checkError = true;
    } finally {
      state.checking = false;
      updateLiveRun();
    }
    return state.latestRun;
  }

  async function loadStatus() {
    if (window.__RHW_SMOKE_INLINE__) return fallbackStatus();
    try {
      const response = await fetch(STATUS_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Catalog status ${response.status}`);
      const value = await response.json();
      return validStatus(value) ? value : fallbackStatus();
    } catch {
      return fallbackStatus();
    }
  }

  async function init() {
    state.status = await loadStatus();
    mount(state.status);
    checkLatestRun();
    return state.status;
  }

  function selfTest() {
    const failures = [];
    if (!document.getElementById('discoveryDataStatus')) failures.push('panel');
    if (!document.getElementById('discoveryCheckRun')) failures.push('run-check');
    if (!document.querySelector('#discoveryDataStatus a[href*="discovery-catalog-sync.yml"]')) failures.push('workflow-link');
    if (document.getElementById('discoveryDataStatus')?.textContent?.includes('AUTO-MERGE ENABLED')) failures.push('auto-merge-policy');
    return failures;
  }

  app.discoveryStatus = { init, loadStatus, checkLatestRun, selfTest, runSnapshot, state, urls: { workflow: WORKFLOW_URL, report: REPORT_URL } };
})();
