/* ==========================================================================
   RHW WEB APP · V4.0 NAVIGATION HIERARCHY
   Mounts the active workspace's real sub-navigation directly below the global
   COMMAND / OPERATIONS / COMMS switcher without duplicating controls.
   ========================================================================== */
(function initRhwV4NavigationHierarchy() {
  'use strict';
  const app = window.RHWV4;
  if (!app) return;

  const SUBNAV_IDS = Object.freeze({
    command: 'commandNodeNav',
    operations: 'operationsNodeNav',
    pricecheck: null,
    comms: 'commsNodeNav'
  });
  let observer = null;
  let sizeObserver = null;
  let resizeBound = false;

  function safeWorkspace(value) {
    return Object.prototype.hasOwnProperty.call(SUBNAV_IDS, value) ? value : 'command';
  }

  function installReleaseUxStyles() {
    if (document.getElementById('rhwV40StickyUxStyle')) return;
    const style = document.createElement('style');
    style.id = 'rhwV40StickyUxStyle';
    style.dataset.stylesheet = '35-app-interface-cleanup.css';
    document.head.appendChild(style);
  }

  function ensureShell() {
    const rootNav = document.getElementById('rhwAppNav');
    const inner = rootNav?.querySelector('.app-nav-inner');
    const tabs = inner?.querySelector('.app-tabs');
    if (!rootNav || !inner || !tabs) return false;

    let cluster = document.getElementById('appNavigationCluster');
    if (!cluster) {
      cluster = document.createElement('div');
      cluster.id = 'appNavigationCluster';
      cluster.className = 'app-navigation-cluster';
      tabs.insertAdjacentElement('beforebegin', cluster);
      cluster.appendChild(tabs);

      const slot = document.createElement('div');
      slot.id = 'appContextNavSlot';
      slot.className = 'app-context-nav-slot';
      slot.setAttribute('aria-label', 'Active workspace navigation');
      cluster.appendChild(slot);
    }
    return true;
  }

  function ensureHome(nav, workspace) {
    let home = nav.dataset.navHomeId ? document.getElementById(nav.dataset.navHomeId) : null;
    if (home) return home;

    home = document.createElement('span');
    home.id = `${nav.id}Home`;
    home.className = 'workspace-subnav-home';
    home.hidden = true;
    nav.insertAdjacentElement('beforebegin', home);
    nav.dataset.navHomeId = home.id;
    nav.dataset.workspaceOwner = workspace;
    return home;
  }

  function restore(nav) {
    if (!nav) return;
    const home = nav.dataset.navHomeId ? document.getElementById(nav.dataset.navHomeId) : null;
    if (home) home.insertAdjacentElement('afterend', nav);
    nav.classList.remove('app-mounted-subnav');
  }

  function updateStickyOffset() {
    const rootNav = document.getElementById('rhwAppNav');
    const height = rootNav ? Math.ceil(rootNav.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--rhw-sticky-nav-offset', `${Math.max(0, height) + 12}px`);
  }

  function installBbcodeCollapse() {
    const panel = document.querySelector('.bbcode-panel');
    const head = panel?.querySelector('.comms-panel-head');
    if (!panel || !head || document.getElementById('toggleBbcodePanelBtn')) return Boolean(panel && head);

    panel.classList.add('v40-collapsed');
    const small = head.querySelector('small');
    const actions = document.createElement('div');
    actions.className = 'comms-bbcode-head-actions';
    if (small) actions.appendChild(small);

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'toggleBbcodePanelBtn';
    button.className = 'comms-bbcode-toggle';
    button.setAttribute('aria-expanded', 'false');
    button.textContent = 'SHOW BB CODE';
    button.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('v40-collapsed');
      button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      button.textContent = collapsed ? 'SHOW BB CODE' : 'HIDE BB CODE';
    });
    actions.appendChild(button);
    head.appendChild(actions);
    return true;
  }

  function sync(workspace = app.state.activeWorkspace || document.body.dataset.workspace || 'command') {
    if (!ensureShell()) return false;
    const active = safeWorkspace(workspace);
    const slot = document.getElementById('appContextNavSlot');
    const target = document.getElementById(SUBNAV_IDS[active]);
    if (!slot) return false;

    [...slot.querySelectorAll(':scope > .workspace-subnav')].forEach(nav => {
      if (nav !== target) restore(nav);
    });

    /* data-workspace is reserved for the actual workspace tabs. */
    slot.dataset.activeWorkspace = active;
    if (!target) {
      requestAnimationFrame(updateStickyOffset);
      return SUBNAV_IDS[active] === null;
    }

    ensureHome(target, active);
    if (target.parentElement !== slot) slot.appendChild(target);
    target.classList.add('app-mounted-subnav');
    requestAnimationFrame(updateStickyOffset);
    return true;
  }

  function selfTest() {
    const failures = [];
    const active = safeWorkspace(app.state.activeWorkspace || document.body.dataset.workspace || 'command');
    const slot = document.getElementById('appContextNavSlot');
    const expectedId = SUBNAV_IDS[active];
    const mounted = slot?.querySelector(':scope > .workspace-subnav');

    if (!document.getElementById('appNavigationCluster')) failures.push('missing-cluster');
    if (!slot) failures.push('missing-context-slot');
    if (slot?.hasAttribute('data-workspace')) failures.push('context-slot-workspace-collision');
    if (slot?.dataset.activeWorkspace !== active) failures.push(`context-slot-state:${active}`);
    if (expectedId ? mounted?.id !== expectedId : Boolean(mounted)) failures.push(`mounted-subnav:${expectedId || 'none'}`);
    if (!document.querySelector(`.app-tabs [data-workspace="${active}"].active`)) failures.push(`active-workspace-tab:${active}`);
    if (!document.getElementById('rhwV40StickyUxStyle')) failures.push('missing-sticky-ux-style');
    if (!document.getElementById('toggleBbcodePanelBtn')) failures.push('missing-bbcode-collapse');
    return failures;
  }

  function init() {
    if (!ensureShell()) return false;
    installReleaseUxStyles();
    sync();
    installBbcodeCollapse();
    updateStickyOffset();

    observer?.disconnect();
    observer = new MutationObserver(mutations => {
      if (!mutations.some(mutation => mutation.attributeName === 'data-workspace')) return;
      requestAnimationFrame(() => sync());
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-workspace'] });

    sizeObserver?.disconnect();
    const rootNav = document.getElementById('rhwAppNav');
    if (rootNav && typeof ResizeObserver === 'function') {
      sizeObserver = new ResizeObserver(updateStickyOffset);
      sizeObserver.observe(rootNav);
    }
    if (!resizeBound) {
      window.addEventListener('resize', updateStickyOffset, { passive: true });
      resizeBound = true;
    }
    return true;
  }

  app.navHierarchy = { init, sync, selfTest, updateStickyOffset, installBbcodeCollapse };
})();
