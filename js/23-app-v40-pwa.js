/* ==========================================================================
   RHW WEB APP · V4.0 PWA
   Android/iOS installation, honest offline state and controlled updates.
   ========================================================================== */
(function initRhwV40Pwa() {
  'use strict';
  if (window.RHWPWA) return;

  const state = { installPrompt: null, registration: null, updateWorker: null, reloading: false, restartRequested: false, shellObserver: null };
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isAndroid = (userAgent = navigator.userAgent) => /Android/i.test(userAgent);
  const isIos = (userAgent = navigator.userAgent, platform = navigator.platform, maxTouchPoints = navigator.maxTouchPoints) =>
    /iPad|iPhone|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);

  function markup() {
    return `<div class="rhw-pwa-offline" id="rhwPwaOffline" role="status" aria-live="polite" hidden><strong>OFFLINE MODE</strong><span>CACHED APP DATA ONLY // LIVE TELEMETRY PAUSED</span></div>
      <aside class="rhw-pwa-panel" id="rhwPwaPanel" role="dialog" aria-modal="false" aria-labelledby="rhwPwaTitle" hidden>
        <div class="rhw-pwa-panel-copy"><small id="rhwPwaKicker">RHW COMMAND APP</small><strong id="rhwPwaTitle">INSTALL ON THIS DEVICE</strong><span id="rhwPwaMessage">ADD RHW TO YOUR HOME SCREEN FOR A DEDICATED COMMAND APP WINDOW.</span></div>
        <div class="rhw-pwa-panel-actions"><button type="button" class="primary" id="rhwPwaPrimary">INSTALL APP</button><button type="button" id="rhwPwaClose">LATER</button></div>
      </aside>`;
  }

  function mountInstallControl() {
    if (document.getElementById('rhwPwaInstallBtn')) return true;
    const brand = document.getElementById('rhwToolsInstallSlot') || document.querySelector('.app-nav-brand');
    if (!brand) return false;
    brand.insertAdjacentHTML('beforeend', '<button id="rhwPwaInstallBtn" class="rhw-pwa-install" type="button"><span>INSTALL RHW</span><small>PHONE / TABLET APP</small></button>');
    document.getElementById('rhwPwaInstallBtn')?.addEventListener('click', showInstallHelp);
    syncInstallState();
    return true;
  }

  function watchForAppShell() {
    if (mountInstallControl() || state.shellObserver || !document.body) return;
    state.shellObserver = new MutationObserver(() => {
      if (!mountInstallControl()) return;
      state.shellObserver.disconnect();
      state.shellObserver = null;
    });
    state.shellObserver.observe(document.body, { childList: true, subtree: true });
  }

  function mount() {
    if (!document.body) return;
    if (!document.getElementById('rhwPwaPanel')) {
      document.body.insertAdjacentHTML('beforeend', markup());
      document.getElementById('rhwPwaClose')?.addEventListener('click', hidePanel);
    }
    watchForAppShell();
    syncConnectionState();
    syncInstallState();
  }

  function panelElements() {
    return {
      panel: document.getElementById('rhwPwaPanel'), kicker: document.getElementById('rhwPwaKicker'),
      title: document.getElementById('rhwPwaTitle'), message: document.getElementById('rhwPwaMessage'),
      primary: document.getElementById('rhwPwaPrimary')
    };
  }

  function showPanel({ kicker, title, message, primaryLabel, onPrimary }) {
    const elements = panelElements();
    if (!elements.panel) return;
    elements.kicker.textContent = kicker;
    elements.title.textContent = title;
    elements.message.textContent = message;
    elements.primary.textContent = primaryLabel;
    elements.primary.onclick = onPrimary;
    elements.panel.hidden = false;
  }

  function hidePanel() {
    const panel = document.getElementById('rhwPwaPanel');
    if (panel) panel.hidden = true;
  }

  async function requestInstall() {
    const prompt = state.installPrompt;
    if (!prompt) return showManualInstructions();
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      hidePanel();
      if (choice?.outcome === 'accepted') document.documentElement.dataset.rhwPwaInstall = 'accepted';
    } catch (error) {
      document.documentElement.dataset.rhwPwaInstall = 'prompt-failed';
      console.warn('RHW APP INSTALL PROMPT FAILED:', String(error?.message || error));
      showManualInstructions();
    } finally {
      state.installPrompt = null;
      syncInstallState();
    }
  }

  function manualInstructions(userAgent = navigator.userAgent, platform = navigator.platform, maxTouchPoints = navigator.maxTouchPoints) {
    if (isIos(userAgent, platform, maxTouchPoints)) {
      return {
        title: 'INSTALL RHW ON IPHONE / IPAD',
        message: 'OPEN RHW IN SAFARI, TAP SHARE (SQUARE WITH UP ARROW), THEN CHOOSE ADD TO HOME SCREEN.'
      };
    }
    if (/SamsungBrowser/i.test(userAgent)) {
      return {
        title: 'INSTALL RHW IN SAMSUNG INTERNET',
        message: 'OPEN THE SAMSUNG INTERNET MENU (☰), THEN CHOOSE ADD PAGE TO → HOME SCREEN.'
      };
    }
    if (isAndroid(userAgent)) {
      return {
        title: 'INSTALL RHW ON ANDROID',
        message: 'OPEN THE BROWSER MENU (⋮), THEN CHOOSE INSTALL APP OR ADD TO HOME SCREEN.'
      };
    }
    return {
      title: 'ADD RHW TO HOME SCREEN',
      message: 'OPEN YOUR BROWSER MENU AND CHOOSE INSTALL APP OR ADD TO HOME SCREEN.'
    };
  }

  function showManualInstructions() {
    const instructions = manualInstructions();
    showPanel({ kicker: 'MANUAL INSTALL', ...instructions, primaryLabel: 'GOT IT', onPrimary: hidePanel });
  }

  function showInstallHelp() {
    if (isStandalone()) return;
    window.RHWV4?.focusPass?.closeTools();
    if (!state.installPrompt) return showManualInstructions();
    showPanel({
      kicker: 'RHW COMMAND APP', title: 'INSTALL ON THIS DEVICE',
      message: 'ADD RHW TO YOUR HOME SCREEN FOR A DEDICATED APP WINDOW AND AN OFFLINE-READY APP SHELL.',
      primaryLabel: 'INSTALL APP', onPrimary: requestInstall
    });
  }

  function syncInstallState() {
    const button = document.getElementById('rhwPwaInstallBtn');
    if (!button) return;
    const installed = isStandalone();
    button.hidden = installed;
    button.dataset.installReady = state.installPrompt ? 'true' : 'false';
    button.setAttribute('aria-label', installed ? 'RHW is running as an installed app' : 'Install RHW command app');
  }

  function syncConnectionState() {
    const online = navigator.onLine;
    document.documentElement.dataset.rhwNetwork = online ? 'online' : 'offline';
    const banner = document.getElementById('rhwPwaOffline');
    if (banner) banner.hidden = online;
    document.getElementById('headerRefreshBtn')?.toggleAttribute('disabled', !online);
    document.getElementById('refreshBtn')?.toggleAttribute('disabled', !online);
  }

  function announceUpdate(worker) {
    if (!worker || state.updateWorker === worker) return;
    state.updateWorker = worker;
    showPanel({
      kicker: 'APP UPDATE READY', title: 'RESTART WITH LATEST RHW',
      message: 'FINISH YOUR WORK FIRST. SAVE A PRICE PROFILE TO KEEP CURRENT MATERIAL PRICES. UNSAVED EDITOR INPUTS WILL CLEAR ON RESTART.',
      primaryLabel: 'UPDATE NOW', onPrimary: () => requestRestart(worker)
    });
  }

  function hasSessionPrices() {
    return Object.keys(window.RHWV4?.state?.calculator?.materialPrices || {}).length > 0;
  }

  function requestRestart(worker = null) {
    if (hasSessionPrices() && !window.confirm('Restart clears the current material prices. Save a price profile first if you need them. Restart now?')) return false;
    state.restartRequested = true;
    if (worker) worker.postMessage({ type: 'SKIP_WAITING' });
    else { state.reloading = true; window.location.reload(); }
    return true;
  }

  function watchRegistration(registration) {
    if (registration.waiting && navigator.serviceWorker.controller) announceUpdate(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) announceUpdate(worker);
      });
    });
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
      window.setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
    } catch (error) {
      document.documentElement.dataset.rhwPwa = 'unavailable';
      console.warn('RHW PWA registration unavailable:', String(error?.message || error));
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    state.installPrompt = event;
    mount();
    syncInstallState();
  });
  window.addEventListener('appinstalled', () => { state.installPrompt = null; hidePanel(); syncInstallState(); });
  window.addEventListener('online', syncConnectionState);
  window.addEventListener('offline', syncConnectionState);
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (state.reloading) return;
    document.documentElement.dataset.rhwPwa = 'ready';
    if (state.restartRequested) {
      state.reloading = true;
      window.location.reload();
    } else if (state.updateWorker) {
      // Another tab may activate the worker. This tab retains its input state.
      showPanel({ kicker: 'APP UPDATE ACTIVE', title: 'RESTART WHEN READY',
        message: 'YOU CAN FINISH WORK IN THIS TAB. SAVE PRICES AND EDITOR INPUTS BEFORE RESTARTING.',
        primaryLabel: 'RESTART', onPrimary: () => requestRestart() });
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') state.registration?.update().catch(() => {});
  });

  window.RHWPWA = { state, register, announceUpdate, requestRestart, hasSessionPrices, showInstallHelp, showManualInstructions, manualInstructions, syncConnectionState, isStandalone };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register, { once: true });
  else register();
})();
