/* ==========================================================================
   RHW WEB APP · V4.0 PWA
   Android/iOS installation, honest offline state and controlled updates.
   ========================================================================== */
(function initRhwV40Pwa() {
  'use strict';
  if (window.RHWPWA) return;

  const state = { installPrompt: window.__RHW_EARLY_INSTALL_PROMPT__ || null, prompting: false, installed: false,
    relatedInstalled: false, registration: null,
    updateWorker: null, restartAvailable: false, reloading: false, restartRequested: false, updateTask: null };
  delete window.__RHW_EARLY_INSTALL_PROMPT__;
  const appDisplay = window.matchMedia?.('(display-mode: standalone), (display-mode: minimal-ui)');
  const isStandalone = () => appDisplay?.matches === true || navigator.standalone === true;
  const isInstalled = () => state.installed || isStandalone() || (state.relatedInstalled && !state.installPrompt);
  const canInstall = () => !isInstalled() && (Boolean(state.installPrompt) || typeof navigator.install === 'function');

  function markup() {
    return `<div class="rhw-pwa-offline" id="rhwPwaOffline" role="status" aria-live="polite" hidden><strong>OFFLINE MODE</strong><span>CACHED APP DATA ONLY // LIVE TELEMETRY PAUSED</span></div>
      <dialog class="rhw-pwa-panel" id="rhwPwaPanel" aria-labelledby="rhwPwaTitle" aria-describedby="rhwPwaMessage" hidden>
        <div class="rhw-pwa-panel-copy"><small>RHW COMMAND APP</small><strong id="rhwPwaTitle"></strong><span id="rhwPwaMessage"></span></div>
        <div class="rhw-pwa-panel-actions"><button type="button" class="primary" id="rhwPwaPrimary" autofocus></button><button type="button" id="rhwPwaClose">LATER</button></div>
      </dialog>`;
  }

  function mount() {
    if (!document.body) return;
    if (!document.getElementById('rhwPwaPanel')) {
      document.body.insertAdjacentHTML('beforeend', markup());
      document.getElementById('rhwPwaClose')?.addEventListener('click', hidePanel);
      document.getElementById('rhwPwaInstallBtn')?.addEventListener('click', runAppAction);
      const panel = document.getElementById('rhwPwaPanel');
      panel.addEventListener('cancel', event => {
        event.preventDefault();
        hidePanel();
      });
    }
    syncConnectionState();
    syncInstallState();
  }

  function panelElements() {
    return {
      panel: document.getElementById('rhwPwaPanel'),
      title: document.getElementById('rhwPwaTitle'), message: document.getElementById('rhwPwaMessage'),
      primary: document.getElementById('rhwPwaPrimary'), close: document.getElementById('rhwPwaClose')
    };
  }

  function showPanel({ title, message, primaryLabel, onPrimary, mode, singleAction = false }) {
    const elements = panelElements();
    if (!elements.panel) return;
    elements.title.textContent = title;
    elements.message.textContent = message;
    elements.primary.textContent = primaryLabel;
    elements.primary.disabled = false;
    elements.primary.onclick = onPrimary;
    if (elements.close) elements.close.hidden = singleAction;
    elements.panel.dataset.mode = mode;
    elements.panel.hidden = false;
    if (!elements.panel.open) elements.panel.showModal();
  }

  function hidePanel() {
    const panel = document.getElementById('rhwPwaPanel');
    if (panel?.open) panel.close();
    if (panel) panel.hidden = true;
  }

  async function requestInstall() {
    if (state.prompting || !canInstall()) return;
    const prompt = state.installPrompt;
    state.installPrompt = null;
    state.prompting = true;
    syncInstallState();
    const installStatus = document.documentElement.dataset;
    try {
      if (prompt) {
        const result = await prompt.prompt();
        const choice = result?.outcome ? result : await prompt.userChoice;
        if (choice?.outcome) installStatus.rhwPwaInstall = choice.outcome;
      } else {
        await navigator.install();
        state.installed = true;
        installStatus.rhwPwaInstall = 'accepted';
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        installStatus.rhwPwaInstall = 'dismissed';
        return;
      }
      installStatus.rhwPwaInstall = 'prompt-failed';
      console.warn('RHW APP INSTALL PROMPT FAILED:', String(error?.message || error));
      showPanel({ title: 'INSTALLATION COULD NOT START',
        message: 'The browser could not start the RHW app installation.',
        primaryLabel: 'CLOSE', onPrimary: hidePanel, mode: 'install-error', singleAction: true });
    } finally {
      state.prompting = false;
      syncInstallState();
    }
  }

  function showAppStatus() {
    const installed = isInstalled();
    showPanel({ title: installed ? 'RHW IS INSTALLED' : 'INSTALLATION UNAVAILABLE',
      message: installed ? 'RHW is already installed on this device.' : 'App installation requires an offer from the browser in this tab.',
      primaryLabel: 'CLOSE', onPrimary: hidePanel, mode: 'install-status', singleAction: true });
  }

  function runAppAction() {
    if (state.prompting || state.restartRequested) return;
    const worker = state.updateWorker;
    if (worker || state.restartAvailable) {
      showPanel({ mode: 'update', title: worker ? 'RHW UPDATE READY' : 'RHW RESTART READY',
        message: 'Save your work, then restart RHW to load the latest version.',
        primaryLabel: worker ? 'UPDATE NOW' : 'RESTART', onPrimary: () => requestRestart(state.updateWorker) });
    } else if (canInstall()) return requestInstall();
    else showAppStatus();
  }

  function syncInstallState() {
    const installed = isInstalled();
    const update = Boolean(state.updateWorker || state.restartAvailable);
    const ready = canInstall();
    const busy = state.prompting || state.restartRequested;
    const appLabel = state.prompting ? 'INSTALLING…' : installed ? 'APP INSTALLED' : ready ? 'INSTALL APP' : 'APP STATUS';
    const button = document.getElementById('rhwPwaInstallBtn');
    if (button) {
      // Installation and ordinary status belong in Tools / System + Data.
      // Keep genuine pending updates visible so users can activate them.
      button.hidden = !update;
      button.disabled = busy;
      button.dataset.installReady = String(ready && !update);
      button.querySelector('span').textContent = update ? 'UPDATE' : appLabel;
      button.querySelector('small').hidden = !update;
      if (update || !ready) button.setAttribute('aria-controls', 'rhwPwaPanel');
      else button.removeAttribute('aria-controls');
      button.setAttribute('aria-label', update ? 'Update RHW Command' : ready ? 'Install RHW Command' : appLabel);
    }
    const system = document.getElementById('rhwDiagnosticsApp');
    if (system) {
      system.hidden = false;
      system.disabled = busy;
      system.textContent = update ? 'UPDATE APP' : appLabel;
    }
    const panel = document.getElementById('rhwPwaPanel');
    if (panel?.open && panel.dataset.mode === 'install-status') {
      if (ready || update) hidePanel();
      else showAppStatus();
    }
  }

  async function checkInstalledApp() {
    if (isStandalone() || typeof navigator.getInstalledRelatedApps !== 'function') return;
    const manifestUrl = document.querySelector('link[rel="manifest"]')?.href;
    if (!manifestUrl) return;
    const id = new URL('/RHW/', manifestUrl).href;
    try {
      const apps = await navigator.getInstalledRelatedApps();
      state.relatedInstalled = apps.some(app =>
        app.platform === 'webapp' && (app.url === manifestUrl || (!app.url && app.id === id)));
      syncInstallState();
    } catch {
      // A denied or unavailable query leaves the current status intact.
    }
  }

  function syncConnectionState() {
    const online = navigator.onLine;
    document.documentElement.dataset.rhwNetwork = online ? 'online' : 'offline';
    const banner = document.getElementById('rhwPwaOffline');
    if (banner) banner.hidden = online;
    document.getElementById('headerRefreshBtn')?.toggleAttribute('disabled', !online);
    document.getElementById('refreshBtn')?.toggleAttribute('disabled', !online);
    window.updateDataFreshnessIndicators?.();
    window.RHWV4?.requestUiUpdate?.();
  }

  function announceUpdate(worker) {
    if (!worker || worker.state === 'redundant' || state.updateWorker === worker) return;
    state.updateWorker = worker;
    syncInstallState();
  }

  function hasSessionPrices() {
    return Object.keys(window.RHWV4?.state?.calculator?.materialPrices || {}).length > 0;
  }

  function requestRestart(worker = null) {
    if (state.restartRequested) return false;
    if (hasSessionPrices() && !window.confirm('Restart clears the current material prices. Save a price profile first if you need them. Restart now?')) return false;
    state.restartRequested = true;
    const { primary } = panelElements();
    if (primary) { primary.disabled = true; primary.textContent = 'RESTARTING…'; }
    syncInstallState();
    if (worker) worker.postMessage({ type: 'SKIP_WAITING' });
    else { state.reloading = true; window.location.reload(); }
    return true;
  }

  function watchInstalling(worker) {
    if (!worker) return;
    const check = () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) announceUpdate(worker);
    };
    worker.addEventListener('statechange', check);
    check();
  }

  function watchRegistration(registration) {
    if (registration.waiting && navigator.serviceWorker.controller) announceUpdate(registration.waiting);
    watchInstalling(registration.installing);
    registration.addEventListener('updatefound', () => watchInstalling(registration.installing));
  }

  async function register() {
    mount();
    void checkInstalledApp();
    if (!('serviceWorker' in navigator)) {
      document.documentElement.dataset.rhwPwa = 'unsupported';
      return;
    }
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
      state.registration = registration;
      document.documentElement.dataset.rhwPwa = registration.active ? 'ready' : 'installing';
      navigator.serviceWorker.ready.then(() => { document.documentElement.dataset.rhwPwa = 'ready'; });
      watchRegistration(registration);
      state.updateTask?.dispose();
      state.updateTask = window.RHWRuntime.createRefreshTask({
        interval: 60 * 60 * 1000,
        dueAt: Date.now() + 60 * 60 * 1000,
        run: () => registration.update().catch(() => {})
      });
    } catch (error) {
      document.documentElement.dataset.rhwPwa = 'unavailable';
      console.warn('RHW PWA registration unavailable:', String(error?.message || error));
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    if (isStandalone() || state.installed || typeof event.prompt !== 'function') return;
    event.preventDefault();
    state.installPrompt = event;
    mount();
  });
  window.addEventListener('appinstalled', () => {
    state.installed = true;
    state.installPrompt = null;
    document.documentElement.dataset.rhwPwaInstall = 'accepted';
    syncInstallState();
  });
  window.addEventListener('online', syncConnectionState);
  window.addEventListener('offline', syncConnectionState);
  appDisplay?.addEventListener?.('change', syncInstallState);
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (state.reloading) return;
    document.documentElement.dataset.rhwPwa = 'ready';
    if (state.restartRequested) {
      state.reloading = true;
      window.location.reload();
    } else if (state.updateWorker) {
      state.updateWorker = null;
      state.restartAvailable = true;
      if (panelElements().panel?.dataset.mode === 'update') hidePanel();
      syncInstallState();
    }
  });

  window.RHWPWA = { state, register, announceUpdate, requestRestart, hasSessionPrices, runAppAction,
    syncConnectionState, syncInstallState, isStandalone };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register, { once: true });
  else register();
})();
