/* ==========================================================================
   RHW WEB APP · V4.0 PWA
   Android/iOS installation, honest offline state and controlled updates.
   ========================================================================== */
(function initRhwV40Pwa() {
  'use strict';
  if (window.RHWPWA) return;

  const state = { installPrompt: null, prompting: false, installed: false, registration: null,
    updateWorker: null, reloading: false, restartRequested: false, shellObserver: null, updateTask: null };
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isAndroid = (userAgent = navigator.userAgent) => /Android/i.test(userAgent);
  const isIos = (userAgent = navigator.userAgent, platform = navigator.platform, maxTouchPoints = navigator.maxTouchPoints) =>
    /iPad|iPhone|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);

  function markup() {
    return `<div class="rhw-pwa-offline" id="rhwPwaOffline" role="status" aria-live="polite" hidden><strong>OFFLINE MODE</strong><span>CACHED APP DATA ONLY // LIVE TELEMETRY PAUSED</span></div>
      <aside class="rhw-pwa-panel" id="rhwPwaPanel" role="dialog" aria-modal="false" aria-labelledby="rhwPwaTitle" aria-describedby="rhwPwaMessage" hidden>
        <div class="rhw-pwa-panel-copy"><small id="rhwPwaKicker">RHW COMMAND APP</small><strong id="rhwPwaTitle">INSTALL ON THIS DEVICE</strong><span id="rhwPwaMessage">ADD RHW TO YOUR HOME SCREEN FOR A DEDICATED COMMAND APP WINDOW.</span></div>
        <div class="rhw-pwa-panel-actions"><button type="button" class="primary" id="rhwPwaPrimary">INSTALL APP</button><button type="button" id="rhwPwaClose">LATER</button></div>
      </aside>`;
  }

  function mountInstallControl() {
    if (document.getElementById('rhwPwaInstallBtn')) return true;
    const brand = document.getElementById('rhwToolsInstallSlot') || document.querySelector('.app-nav-brand');
    if (!brand) return false;
    brand.insertAdjacentHTML('beforeend', '<button id="rhwPwaInstallBtn" class="rhw-pwa-install" type="button"><span>INSTALL HELP</span><small>ADD VIA BROWSER MENU</small></button>');
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
      primary: document.getElementById('rhwPwaPrimary'), close: document.getElementById('rhwPwaClose')
    };
  }

  function showPanel({ kicker, title, message, primaryLabel, onPrimary, mode = 'update', singleAction = false }) {
    const elements = panelElements();
    if (!elements.panel) return;
    elements.kicker.textContent = kicker;
    elements.title.textContent = title;
    elements.message.textContent = message;
    elements.primary.textContent = primaryLabel;
    elements.primary.onclick = onPrimary;
    if (elements.close) elements.close.hidden = singleAction;
    elements.panel.dataset.mode = mode;
    elements.panel.hidden = false;
  }

  function hidePanel() {
    const panel = document.getElementById('rhwPwaPanel');
    if (panel) panel.hidden = true;
  }

  function installPanelOpen() {
    const panel = document.getElementById('rhwPwaPanel');
    return panel?.dataset.mode === 'install' && !panel.hidden;
  }

  async function requestInstall() {
    if (state.prompting || state.installed || isStandalone()) return;
    const prompt = state.installPrompt;
    if (!prompt) return showManualInstructions();
    state.installPrompt = null;
    state.prompting = true;
    if (installPanelOpen()) hidePanel();
    syncInstallState();
    try {
      const result = await prompt.prompt();
      const choice = result?.outcome ? result : await prompt.userChoice;
      if (choice?.outcome === 'accepted') document.documentElement.dataset.rhwPwaInstall = 'accepted';
    } catch (error) {
      document.documentElement.dataset.rhwPwaInstall = 'prompt-failed';
      console.warn('RHW APP INSTALL PROMPT FAILED:', String(error?.message || error));
      showManualInstructions();
    } finally {
      state.prompting = false;
      syncInstallState();
    }
  }

  function manualInstructions(userAgent = navigator.userAgent, platform = navigator.platform, maxTouchPoints = navigator.maxTouchPoints) {
    if (isIos(userAgent, platform, maxTouchPoints)) {
      return {
        title: 'INSTALL RHW ON IPHONE / IPAD',
        message: 'Open RHW in Safari. Tap Share, then Add to Home Screen.'
      };
    }
    if (/SamsungBrowser/i.test(userAgent)) {
      return {
        title: 'INSTALL RHW IN SAMSUNG INTERNET',
        message: 'Tap the install (+) icon in the address bar if it appears. You can also open the browser menu at the bottom right, then choose Add page to → Home screen.'
      };
    }
    if (isAndroid(userAgent)) {
      return {
        title: 'INSTALL RHW ON ANDROID',
        message: 'Open the browser menu (⋮). Choose Install app or look under Install and create shortcut or Add to Home screen.'
      };
    }
    return {
      title: 'ADD RHW TO HOME SCREEN',
      message: 'Open your browser menu and choose Install app or Add to Home Screen.'
    };
  }

  function showManualInstructions() {
    const instructions = manualInstructions();
    showPanel({ kicker: 'BROWSER INSTALLATION', ...instructions, primaryLabel: 'CLOSE',
      onPrimary: hidePanel, mode: 'install', singleAction: true });
  }

  function showInstallHelp() {
    if (state.prompting || state.installed || isStandalone()) return;
    window.RHWV4?.toolsNavigation?.closeTools();
    return state.installPrompt ? requestInstall() : showManualInstructions();
  }

  function syncInstallState() {
    const button = document.getElementById('rhwPwaInstallBtn');
    if (!button) return;
    const ready = Boolean(state.installPrompt);
    const native = ready || state.prompting;
    button.hidden = state.installed || isStandalone();
    button.disabled = state.prompting;
    button.dataset.installReady = String(ready);
    button.querySelector('span').textContent = native ? 'INSTALL RHW' : 'INSTALL HELP';
    button.querySelector('small').textContent = native ? 'ON THIS DEVICE' : 'ADD VIA BROWSER MENU';
    button.setAttribute('aria-label', native ? 'Install RHW Command' : 'Installation help for RHW Command');
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
    if (state.installed || isStandalone() || typeof event.prompt !== 'function') return;
    event.preventDefault();
    state.installPrompt = event;
    mount();
    if (installPanelOpen()) {
      showPanel({ kicker: 'RHW COMMAND APP', title: 'INSTALL RHW',
        message: 'Your browser is ready to install RHW. Confirm to add it to this device.',
        primaryLabel: 'INSTALL RHW', onPrimary: requestInstall, mode: 'install' });
    }
  });
  window.addEventListener('appinstalled', () => {
    state.installed = true;
    state.installPrompt = null;
    if (installPanelOpen()) hidePanel();
    syncInstallState();
  });
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

  window.RHWPWA = { state, register, announceUpdate, requestRestart, hasSessionPrices, showInstallHelp, showManualInstructions, manualInstructions, syncConnectionState, isStandalone };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register, { once: true });
  else register();
})();
