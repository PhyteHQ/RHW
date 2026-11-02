/* ==========================================================================
   RHW V3.6 LAYOUT CONTROLS
   Presentation-only behavior for the redesigned command surface.
   ========================================================================== */

function arrangeV36CommandFlow() {
  const production = document.getElementById('productionPanel');
  const logistics = document.getElementById('externalLogisticsPanel');
  if (!production || !logistics || !logistics.parentNode) return;

  // Operational flow: overview -> shipyard -> production -> procurement -> manifest.
  if (production.nextElementSibling !== logistics) {
    logistics.parentNode.insertBefore(production, logistics);
  }

  const productionIndex = production.querySelector('.section-kicker span');
  const logisticsIndex = logistics.querySelector('.section-kicker span');
  if (productionIndex) productionIndex.textContent = '05';
  if (logisticsIndex) logisticsIndex.textContent = '06';
}

const expandedMarketChannels = new Set();

function enhanceMobileMarketCards(grid) {
  if (!grid) return;

  grid.querySelectorAll('.market-card').forEach(card => {
    const list = card.querySelector('.supplier-commodity-list');
    if (!list || card.querySelector('.market-mobile-toggle')) return;

    const rows = [...list.querySelectorAll('.supplier-commodity-row')];
    if (rows.length <= 3) return;

    const hiddenCount = rows.length - 3;
    const commodity = card.dataset.marketCommodity;
    const channelKey = `${grid.id}:${commodity}`;
    const channelName = card.querySelector('.supplier-title')?.textContent.trim() || commodity;
    list.id = `${grid.id}-${commodity.replace(/[^a-z0-9]+/g, '-')}-offers`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'market-mobile-toggle';
    button.setAttribute('aria-controls', list.id);

    function applyExpandedState() {
      const expanded = expandedMarketChannels.has(channelKey);
      card.classList.toggle('mobile-market-expanded', expanded);
      button.setAttribute('aria-expanded', String(expanded));
      button.setAttribute('aria-label', expanded ? `Show fewer offers for ${channelName}` : `Show ${hiddenCount} more offers for ${channelName}`);
      button.textContent = expanded ? 'SHOW FEWER OFFERS' : `SHOW ${hiddenCount} MORE OFFERS`;
    }

    button.addEventListener('click', () => {
      if (expandedMarketChannels.has(channelKey)) expandedMarketChannels.delete(channelKey);
      else expandedMarketChannels.add(channelKey);
      applyExpandedState();
    });

    applyExpandedState();
    card.appendChild(button);
  });
}

function initMobileMarketDisclosure() {
  ['marketScanGrid', 'materialsScanGrid'].forEach(id => {
    const grid = document.getElementById(id);
    if (!grid) return;
    window.RHWRuntime.onRender(id, () => enhanceMobileMarketCards(grid));
    enhanceMobileMarketCards(grid);
  });
}

function tagLayoutVersion() {
  document.documentElement.dataset.rhwLayout = 'v3.6';
}

tagLayoutVersion();
arrangeV36CommandFlow();
initMobileMarketDisclosure();
