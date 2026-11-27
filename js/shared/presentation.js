/* One page identity for every public RHW workspace. */
(function initPresentation() {
  'use strict';
  const app = window.RHWV4;
  if (!app || app.presentation) return;
  const pages = Object.freeze({
    'command/inventory': ['COMMAND', 'Overview', 'Your POB at a glance. Supplies, stock and next steps.'],
    'command/production': ['COMMAND', 'Production', 'What each module needs and what its stock can produce.'],
    'command/shipyard': ['COMMAND', 'Shipyard', 'Choose a hull, check its requirements and source missing components.'],
    'command/logistics': ['COMMAND', 'Logistics', 'Find component and material offers across player bases.'],
    'operations/calculator': ['OPERATIONS', 'Calculator', 'Choose a recipe, enter material prices and review your quote.'],
    'pricecheck/routes': ['OPERATIONS', 'Price Check', 'Find the best NPC source for each commodity in the RHW Full Manifest.'],
    'comms/forum': ['COMMUNICATIONS', 'Forum', 'Write your transmission, review the preview and copy the forum code.'],
    'comms/drafts': ['TOOLS', 'Backup & Drafts', 'Resume a saved draft or transfer your local RHW work to another device.'],
    'comms/senders': ['COMMUNICATIONS', 'Senders', 'Manage the identities and signatures used in your transmissions.']
  });
  const nodeKeys = { command: 'commandNode', operations: 'operationsNode', pricecheck: 'pricecheckNode', comms: 'commsNode' };
  function applySurfaces() {
    document.querySelectorAll(':is(.panel,.ops-panel,.comms-panel,.alert-card,.overview-next,.overview-operation,.remote-card,.capital-shipyard-control,.market-card,.pricecheck-table-wrap,.v40-tool-panel):not(.rhw-surface)').forEach(node => node.classList.add('rhw-surface'));
    document.querySelectorAll(':is(.panel-head,.ops-panel-head,.comms-panel-head,.alert-title,.overview-section-head,.remote-facility-head,.logistics-subhead):not(.rhw-surface-head)').forEach(node => node.classList.add('rhw-surface-head'));
  }
  function sync() {
    const root = document.getElementById('rhwWorkspaceRoot');
    if (!root) return;
    applySurfaces();
    const workspace = app.state.activeWorkspace;
    const route = `${workspace}/${app.state[nodeKeys[workspace]]}`;
    const page = pages[route];
    if (!page) return;
    let heading = document.getElementById('rhwPageHeading');
    if (!heading) {
      heading = document.createElement('header');
      heading.id = 'rhwPageHeading';
      heading.className = 'rhw-page-heading';
      heading.setAttribute('aria-labelledby', 'rhwPageTitle');
      heading.innerHTML = '<div><small id="rhwPageArea"></small><h2 id="rhwPageTitle"></h2><p id="rhwPageDescription"></p></div>';
      root.prepend(heading);
    }
    if (heading.dataset.route === route) return;
    heading.dataset.route = route;
    ['rhwPageArea', 'rhwPageTitle', 'rhwPageDescription'].forEach((id, index) => {
      document.getElementById(id).textContent = page[index];
    });
  }
  app.presentation = { sync, applySurfaces };
  app.lifecycle.on('shell:ready', 'page-presentation', 90, sync);
  app.onRender('workspace', () => requestAnimationFrame(sync));
  app.onUiUpdate(sync);
})();
