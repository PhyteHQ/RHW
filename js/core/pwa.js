/* ==========================================================================
   RHW WEB APP · V4.0 PWA
   Android/iOS installation, honest offline state and controlled updates.
   ========================================================================== */
(function initRhwV40Pwa() {
  'use strict';
  if (window.RHWPWA) return;

  const state = { installPrompt: null, prompting: false, installed: false, registration: null,
    updateWorker: null, restartAvailable: false, reloading: false, restartRequested: false, updateTask: null };
  const appDisplay = window.matchMedia?.('(display-mode: standalone), (display-mode: minimal-ui)');
  const isStandalone = () => appDisplay?.matches === true || navigator.standalone === true;
  const isInstalled = () => state.installed || isStandalone();
  const isIos = (userAgent = navigator.userAgent, platform = navigator.platform, maxTouchPoints = navigator.maxTouchPoints) =>
    /iPad|iPhone|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);

  function markup() {
    return `<div class="rhw-pwa-offline" id="rhwPwaOffline" role="status" aria-live="polite" hidden><strong>OFFLINE MODE</strong><span>CACHED APP DATA ONLY // LIVE TELEMETRY PAUSED</span></div>
      <dialog class="rhw-pwa-panel" id="rhwPwaPanel" aria-labelledby="rhwPwaTitle" aria-describedby="rhwPwaMessage" hidden>
        <div class="rhw-pwa-panel-copy"><small>RHW COMMAND APP</small><strong id="rhwPwaTitle"></strong><span id="rhwPwaMessage"></span></div>
        <div class="rhw-pwa-panel-actions"><button type="button" class="primary" id="rhwPwaPrimary" autofocus>INSTALL</button><button type="button" id="rhwPwaClose">LATER</button></div>
      </dialog>`;
  }

  function mount() {
    if (!document.body) return;
    if (!document.getElementById('rhwPwaPanel')) {
      document.body.insertAdjacentHTML('beforeend', markup());
      document.getElementById('rhwPwaClose')?.addEventListener('click', hidePanel);
      document.getElementById('rhwPwaInstallBtn')?.addEventListener('click', showInstallHelp);
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

  function showPanel({ title, message, primaryLabel, onPrimary, mode = 'install', singleAction = false }) {
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

  function installPanelOpen() {
    const panel = document.getElementById('rhwPwaPanel');
    return panel?.open && panel.dataset.mode === 'install';
  }

  async function requestInstall() {
    if (state.prompting || isInstalled()) return;
    const prompt = state.installPrompt;
    if (!prompt) return showManualInstructions();
    state.installPrompt = null;
    state.prompting = true;
    const { primary } = panelElements();
    primary.disabled = true;
    primary.textContent = 'OPENING…';
    syncInstallState();
    try {
      const result = await prompt.prompt();
      const choice = result?.outcome ? result : await prompt.userChoice;
      if (choice?.outcome === 'accepted') document.documentElement.dataset.rhwPwaInstall = 'accepted';
      if (installPanelOpen()) hidePanel();
    } catch (error) {
      document.documentElement.dataset.rhwPwaInstall = 'prompt-failed';
      console.warn('RHW APP INSTALL PROMPT FAILED:', String(error?.message || error));
      if (installPanelOpen()) showManualInstructions();
    } finally {
      state.prompting = false;
      syncInstallState();
    }
  }

  function manualInstructions(userAgent = navigator.userAgent, platform = navigator.platform, maxTouchPoints = navigator.maxTouchPoints) {
    const title = 'ADD RHW TO THIS DEVICE';
    if (isIos(userAgent, platform, maxTouchPoints)) return { title, message: 'In Safari, tap Share, then choose Add to Home Screen.' };
    if (/SamsungBrowser/i.test(userAgent)) return { title, message: 'In Samsung Internet, open the browser menu and choose Add page to → Home screen.' };
    return { title, message: 'Open your browser menu and choose Install app or Add to Home screen.' };
  }

  function showManualInstructions() {
    const instructions = manualInstructions();
    showPanel({ ...instructions, primaryLabel: 'CLOSE', onPrimary: hidePanel, singleAction: true });
  }

  function showInstallOffer() {
    showPanel({ title: 'INSTALL ON THIS DEVICE',
      message: 'Add RHW to your home screen for quick access and offline startup.',
      primaryLabel: 'INSTALL', onPrimary: requestInstall });
  }

  function showInstallHelp() {
    if (state.prompting || state.restartRequested) return;
    const worker = state.updateWorker;
    if (worker || state.restartAvailable) {
      showPanel({ mode: 'update', title: worker ? 'RHW UPDATE READY' : 'RHW RESTART READY',
        message: 'Save your work, then restart RHW to load the latest version.',
        primaryLabel: worker ? 'UPDATE NOW' : 'RESTART', onPrimary: () => requestRestart(state.updateWorker) });
    } else if (isInstalled()) {
      showPanel({ title: 'RHW IS INSTALLED', message: 'RHW is already installed on this device.',
        primaryLabel: 'CLOSE', onPrimary: hidePanel, mode: 'installed', singleAction: true });
    } else if (state.installPrompt) showInstallOffer();
    else showManualInstructions();
  }

  function syncInstallState() {
    const installed = isInstalled();
    const update = Boolean(state.updateWorker || state.restartAvailable);
    const ready = Boolean(state.installPrompt);
    const button = document.getElementById('rhwPwaInstallBtn');
    if (button) {
      button.hidden = installed && !update;
      button.disabled = state.prompting || state.restartRequested;
      button.dataset.installReady = String(ready);
      button.querySelector('span').textContent = update ? 'UPDATE' : 'INSTALL';
      button.querySelector('small').textContent = update || ready ? 'APP READY' : 'PHONE APP';
      button.setAttribute('aria-label', update ? 'Update RHW Command' : 'Install RHW Command');
    }
    const system = document.getElementById('rhwDiagnosticsApp');
    if (system) system.textContent = update ? 'UPDATE APP' : installed ? 'APP INSTALLED' : 'INSTALL APP';
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

  // Listen in the initial dashboard bundle, before the deferred workspaces mount.
  window.addEventListener('beforeinstallprompt', event => {
    if (isInstalled() || typeof event.prompt !== 'function') return;
    event.preventDefault();
    state.installPrompt = event;
    mount();
    if (installPanelOpen()) showInstallOffer();
  });
  window.addEventListener('appinstalled', () => {
    state.installed = true;
    state.installPrompt = null;
    if (installPanelOpen()) hidePanel();
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

  window.RHWPWA = { state, register, announceUpdate, requestRestart, hasSessionPrices, showInstallHelp,
    showManualInstructions, manualInstructions, syncConnectionState, syncInstallState, isStandalone };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register, { once: true });
  else register();
})();
