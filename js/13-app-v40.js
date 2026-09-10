/* ==========================================================================
   RHW WEB APP · V4.0 CORE
   One app shell, one route model, shared utilities. Feature modules register
   themselves on RHWV4 without replacing functions defined by other modules.
   ========================================================================== */
(function initRhwV4Core() {
  'use strict';

  const WORKSPACES = Object.freeze(Object.keys(RHW_APP_CONFIG.routes));
  const WORKSPACE_META = Object.freeze({
    command: Object.freeze({ nodeKey: 'commandNode', fallback: 'overview' }),
    operations: Object.freeze({ nodeKey: 'operationsNode', fallback: 'calculator' }),
    pricecheck: Object.freeze({ nodeKey: 'pricecheckNode', fallback: 'routes' }),
    comms: Object.freeze({ nodeKey: 'commsNode', fallback: 'forum' })
  });

  const app = window.RHWV4 = {
    version: RHW_APP_VERSION,
    config: RHW_APP_CONFIG,
    state: {
      activeWorkspace: 'command',
      commandNode: 'overview',
      inventoryView: 'status',
      operationsNode: 'calculator',
      calculator: null,
      commsNode: 'forum',
      localSenders: [],
      drafts: [],
      comms: null,
      editingSenderKey: null,
      storageRecoveries: Array.isArray(window.__RHW_STORAGE_RECOVERIES__) ? window.__RHW_STORAGE_RECOVERIES__ : []
    },
    modules: {},
    ready: false
  };
  window.__RHW_STORAGE_RECOVERIES__ = app.state.storageRecoveries;

  app.util = {
    escape(value) {
      return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[char]));
    },
    uid(prefix = 'rhw') {
      return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    },
    normalize(value) {
      return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    },
    pick(values = []) {
      return values.length ? values[Math.floor(Math.random() * values.length)] : '';
    },
    roman(value) {
      const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
      return numerals[Math.max(1, Math.min(12, Number(value) || 1)) - 1];
    },
    number(value) {
      try { return typeof window.number === 'function' ? window.number(value) : Number(value || 0).toLocaleString('en-US'); }
      catch { return String(value ?? '0'); }
    },
    fallbackCopy(text, copyCommand = typeof document.execCommand === 'function' ? document.execCommand.bind(document) : null) {
      const area = document.createElement('textarea');
      area.value = String(text ?? '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      try {
        area.select();
        return typeof copyCommand === 'function' && copyCommand('copy') === true;
      } catch {
        return false;
      } finally {
        area.remove();
      }
    },
    async copy(text) {
      const value = String(text ?? '');
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        return app.util.fallbackCopy(value);
      }
    }
  };

  app.recoverCorruptStorageEntry = function recoverCorruptStorageEntry(key, raw, parseError, storage = localStorage) {
    const recovery = {
      key: String(key || ''),
      detail: String(parseError?.message || parseError || 'INVALID LOCAL JSON'),
      at: Date.now(),
      backupKey: '',
      recovered: false
    };
    try {
      const backupKey = `rhw-webapp-v4:recovery:${recovery.at}-${Math.random().toString(36).slice(2, 7)}`;
      storage.setItem(backupKey, JSON.stringify({
        schemaVersion: 1,
        originalKey: recovery.key,
        recoveredAt: new Date(recovery.at).toISOString(),
        raw: String(raw ?? '')
      }));
      storage.removeItem(key);
      recovery.backupKey = backupKey;
      recovery.recovered = true;
    } catch (storageError) {
      app.reportStorageFailure('Corrupt data recovery', key, storageError);
    }
    app.state.storageRecoveries.push(recovery);
    window.dispatchEvent(new CustomEvent('rhw:storage-recovered', { detail: recovery }));
    return recovery.recovered;
  };

  app.clearStorageWarning = function clearStorageWarning() {
    document.documentElement.removeAttribute('data-rhw-storage-error');
    document.getElementById('rhwStorageWarning')?.remove();
  };

  app.reportStorageFailure = function reportStorageFailure(operation, key, error) {
    const detail = String(error?.message || error || 'BROWSER STORAGE UNAVAILABLE');
    app.state.storageError = { operation: String(operation || 'access'), key: String(key || ''), detail, at: Date.now() };
    document.documentElement.dataset.rhwStorageError = 'true';

    const mount = () => {
      if (!document.body) return;
      let banner = document.getElementById('rhwStorageWarning');
      if (!banner) {
        banner = document.createElement('aside');
        banner.id = 'rhwStorageWarning';
        banner.className = 'rhw-storage-warning';
        banner.setAttribute('role', 'alert');
        banner.setAttribute('aria-live', 'assertive');

        const copy = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = 'LOCAL SAVE UNAVAILABLE';
        const message = document.createElement('span');
        message.dataset.storageWarningCopy = 'true';
        copy.append(title, message);

        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.textContent = 'DISMISS';
        dismiss.addEventListener('click', app.clearStorageWarning);
        banner.append(copy, dismiss);
        document.body.appendChild(banner);
      }
      const message = banner.querySelector('[data-storage-warning-copy]');
      if (message) message.textContent = `Your latest change may not survive a reload. ${String(operation || 'Storage access')} failed for ${String(key || 'local data')}.`;
    };

    if (document.body) mount();
    else window.addEventListener('DOMContentLoaded', mount, { once: true });
    window.dispatchEvent(new CustomEvent('rhw:storage-error', { detail: app.state.storageError }));
    return false;
  };

  app.store = {
    get(key, fallback = null) {
      let raw;
      try {
        raw = localStorage.getItem(key);
      } catch (error) {
        app.reportStorageFailure('Read', key, error);
        return fallback;
      }
      if (raw === null) return fallback;
      try {
        return JSON.parse(raw);
      } catch (error) {
        app.recoverCorruptStorageEntry(key, raw, error);
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        return app.reportStorageFailure('Save', key, error);
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
        return true;
      } catch (error) {
        return app.reportStorageFailure('Delete', key, error);
      }
    }
  };

  app.template = function template(key) {
    return app.config.templates.find(entry => entry.key === key) || app.config.templates[0];
  };

  app.classificationColor = function classificationColor(value) {
    return app.config.classificationColors[value] || app.config.forum.brandColor;
  };

  app.generateCipher = function generateCipher(templateKey = app.state.comms?.templateKey || 'formal') {
    const pool = app.config.cipher;
    const authorities = pool.authorities[templateKey] || pool.authorities.formal;
    const authority = app.util.pick(authorities);
    const family = app.util.pick(pool.families);
    const keyset = app.util.pick(pool.keysets);
    const mark = app.util.roman(2 + Math.floor(Math.random() * 9));
    const serial = String(1 + Math.floor(Math.random() * 98)).padStart(2, '0');
    return `${authority}-${family}/${mark} · KEY ${keyset}-${serial}`;
  };

  app.notify = function notify(message, tone = 'good') {
    const status = app.state.activeWorkspace === 'operations'
      ? document.getElementById('operationsStatus')
      : (document.getElementById('commsStatus') || document.getElementById('operationsStatus'));
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
    clearTimeout(app.notifyTimer);
    app.notifyTimer = setTimeout(() => {
      if (status.id === 'operationsStatus') {
        const count = app.operationsCore?.state?.catalog?.meta?.recipeCount;
        status.textContent = count ? `${app.util.number(count)} RECIPES // DATABASE READY` : 'RECIPE DATABASE READY';
        status.dataset.tone = 'good';
      } else {
        status.textContent = 'LOCAL COMMAND CACHE READY';
        status.dataset.tone = 'muted';
      }
    }, 2600);
  };

  app.route = {
    parse() {
      const parts = location.hash.replace(/^#/, '').toLowerCase().split('/').filter(Boolean);
      const workspace = WORKSPACES.includes(parts[0]) ? parts[0] : null;
      let node = parts[1] || null;
      if (workspace === 'comms' && node === 'newswire') node = 'ticker';
      if (workspace === 'operations' && node === 'orders') node = 'calculator';
      if (workspace && node && !app.config.routes[workspace].includes(node)) node = WORKSPACE_META[workspace].fallback;
      return { workspace, node };
    },
    write(workspace, node, { replace = false } = {}) {
      const safeWorkspace = WORKSPACES.includes(workspace) ? workspace : 'command';
      const safeNode = app.config.routes[safeWorkspace].includes(node) ? node : WORKSPACE_META[safeWorkspace].fallback;
      const next = `#${safeWorkspace}/${safeNode}`;
      if (location.hash === next) return;
      const method = replace ? 'replaceState' : 'pushState';
      history[method]({ rhwWorkspace: safeWorkspace, rhwNode: safeNode }, '', next);
    }
  };

  app.setActiveNode = function setActiveNode(value) {
    const target = document.getElementById('appActiveNode');
    if (target) target.textContent = `ACTIVE NODE: ${value}`;
  };

  app.workspaceModule = function workspaceModule(workspace) {
    if (workspace === 'command') return app.command;
    if (workspace === 'operations') return app.operations;
    if (workspace === 'pricecheck') return app.pricecheck;
    return app.comms;
  };

  app.workspaceStoredNode = function workspaceStoredNode(workspace) {
    const meta = WORKSPACE_META[workspace] || WORKSPACE_META.command;
    const storageKey = app.config.storageKeys[meta.nodeKey];
    return app.store.get(storageKey, meta.fallback);
  };

  app.installShell = function installShell() {
    if (document.getElementById('rhwAppNav')) return true;
    const ticker = document.getElementById('newswirePanel');
    const strip = document.getElementById('commandStrip');
    const main = document.querySelector('main');
    if (!ticker || !strip || !main) return false;

    const nav = document.createElement('nav');
    nav.id = 'rhwAppNav';
    nav.className = 'rhw-app-nav';
    nav.setAttribute('aria-label', 'RHW application workspaces');
    nav.innerHTML = `
      <div class="app-nav-inner">
        <div class="app-nav-brand">
          <span class="app-nav-pulse" aria-hidden="true"></span>
          <div><strong>RHW WEB APP</strong><small>${app.util.escape(app.version)}</small><small id="appActiveNode" class="app-active-node">ACTIVE NODE: COMMAND / OVERVIEW</small></div>
        </div>
        <div class="app-tabs" role="tablist" aria-label="RHW workspaces">
          <button type="button" role="tab" data-workspace="command" aria-controls="workspaceCommand"><span>COMMAND</span><small>LIVE OPERATIONS</small></button>
          <button type="button" role="tab" data-workspace="operations" aria-controls="workspaceOperations"><span>OPERATIONS</span><small>FABRICATION PLANNING</small></button>
          <button type="button" role="tab" data-workspace="comms" aria-controls="workspaceComms"><span>COMMS</span><small>TRANSMISSION STUDIO</small></button>
        </div>
      </div>`;
    ticker.insertAdjacentElement('afterend', nav);

    const root = document.createElement('div');
    root.id = 'rhwWorkspaceRoot';
    root.className = 'rhw-workspace-root';
    nav.insertAdjacentElement('afterend', root);

    const command = document.createElement('section');
    command.id = 'workspaceCommand';
    command.className = 'app-workspace command-workspace';
    command.setAttribute('role', 'tabpanel');
    command.setAttribute('aria-label', 'Command workspace');
    root.appendChild(command);
    command.appendChild(strip);
    command.appendChild(main);

    const operations = document.createElement('section');
    operations.id = 'workspaceOperations';
    operations.className = 'app-workspace operations-workspace';
    operations.setAttribute('role', 'tabpanel');
    operations.setAttribute('aria-label', 'Operations workspace');
    operations.hidden = true;
    root.appendChild(operations);

    const comms = document.createElement('section');
    comms.id = 'workspaceComms';
    comms.className = 'app-workspace comms-workspace';
    comms.setAttribute('role', 'tabpanel');
    comms.setAttribute('aria-label', 'Communications workspace');
    comms.hidden = true;
    root.appendChild(comms);

    nav.addEventListener('click', event => {
      const button = event.target.closest('.app-tabs [data-workspace]');
      if (!button) return;
      const workspace = button.dataset.workspace;
      app.navigate(workspace, app.workspaceStoredNode(workspace));
    });

    nav.addEventListener('keydown', event => {
      const button = event.target.closest('.app-tabs [data-workspace]');
      if (!button || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...nav.querySelectorAll('.app-tabs [data-workspace]')];
      const current = buttons.indexOf(button);
      if (current < 0 || !buttons.length) return;
      const next = buttons[(current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
      next.focus();
      next.click();
    });
    return true;
  };

  app.activateWorkspace = function activateWorkspace(workspace) {
    const safe = WORKSPACES.includes(workspace) ? workspace : 'command';
    app.state.activeWorkspace = safe;
    app.store.set(app.config.storageKeys.activeWorkspace, safe);
    document.body.dataset.workspace = safe;

    document.querySelectorAll('.app-workspace').forEach(panel => {
      panel.hidden = panel.id !== `workspace${safe[0].toUpperCase()}${safe.slice(1)}`;
    });
    document.querySelectorAll('.app-tabs [data-workspace]').forEach(button => {
      const active = button.dataset.workspace === safe;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    });
  };

  app.applyRoute = function applyRoute({ replace = false } = {}) {
    const route = app.route.parse();
    const workspace = route.workspace || app.store.get(app.config.storageKeys.activeWorkspace, 'command');
    const safeWorkspace = WORKSPACES.includes(workspace) ? workspace : 'command';
    app.activateWorkspace(safeWorkspace);

    const meta = WORKSPACE_META[safeWorkspace];
    const node = route.node || app.workspaceStoredNode(safeWorkspace);
    app.workspaceModule(safeWorkspace)?.activate(node, { updateRoute: false });
    const activeNode = app.state[meta.nodeKey] || meta.fallback;
    const canonicalHash = `#${safeWorkspace}/${activeNode}`;

    /* Invalid/legacy node hashes are normalized immediately so history and copied
       links always describe the panel that is actually visible. */
    if (replace || location.hash !== canonicalHash) app.route.write(safeWorkspace, activeNode, { replace: true });
  };

  app.navigate = function navigate(workspace, node, { replace = false } = {}) {
    const safeWorkspace = WORKSPACES.includes(workspace) ? workspace : 'command';
    app.activateWorkspace(safeWorkspace);
    const meta = WORKSPACE_META[safeWorkspace];
    app.workspaceModule(safeWorkspace)?.activate(node || meta.fallback, { updateRoute: false });
    app.route.write(safeWorkspace, app.state[meta.nodeKey] || meta.fallback, { replace });
  };

  window.addEventListener('popstate', () => app.applyRoute());
  window.addEventListener('hashchange', () => app.applyRoute());
})();
