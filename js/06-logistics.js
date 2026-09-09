function sellableStock(item) {
  if (!item) return 0;
  return Math.max(0, quantity(item) - Math.max(0, minStock(item)));
}

function marketBaseSystem(base) {
  const value = base?.system_name ?? base?.system ?? base?.systemName;
  return String(value || 'UNKNOWN SYSTEM').trim() || 'UNKNOWN SYSTEM';
}

function marketBaseIsLocal(base) {
  return normalize(base?.name) === BASE_NAME || normalize(base?.nickname) === BASE_NAME;
}

function validMarketPrice(item) {
  const price = priceBuy(item);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function marketFeedstock(base, name) {
  const item = Array.isArray(base?.shop_items)
    ? base.shop_items.find(entry => commodityKey(entry) === keyFromName(name)) : null;
  const raw = item?.quantity ?? item?.amount ?? item?.stock;
  const reported = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '');
  // Input stocks include reserves. Missing/invalid telemetry is not a zero,
  // and the presence of input stock does not establish future production.
  return { name, quantity: reported ? finiteNumber(raw, null, 0) : null };
}

function updateMarketSortButtons() {
  els.marketSortButtons?.forEach(button => {
    const active = button.dataset.marketSort === (button.dataset.marketGroup === 'materials' ? materialsSort : marketSort);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function setMarketSort(group, nextSort) {
  const current = group === 'materials' ? materialsSort : marketSort;
  if (!['price', 'stock'].includes(nextSort) || nextSort === current) return false;
  if (group === 'materials') {
    materialsSort = nextSort;
    renderMaterialsScan();
  } else {
    marketSort = nextSort;
    renderMarketScan();
  }
  return true;
}

function renderMarketScan() {
  return renderCommodityScan({ grid: els.marketScanGrid, meta: els.marketScanMeta,
    targets: MARKET_SCAN, sort: marketSort, enabled: FEATURES.marketScan });
}

function renderMaterialsScan() {
  return renderCommodityScan({ grid: els.materialsScanGrid, meta: els.materialsScanMeta,
    targets: MATERIALS_SCAN, sort: materialsSort, enabled: FEATURES.materialsScan,
    feedstocks: MATERIAL_FEEDSTOCKS });
}

// Both Logistics views share offer selection, reserve handling and price rules.
function renderCommodityScan({ grid, meta, targets, sort, enabled, feedstocks = {} }) {
  if (!grid || !enabled) return { totalOffers: 0, uniqueBases: 0, pending: false };

  updateMarketSortButtons();

  if (!targets.length) {
    if (meta) meta.textContent = 'NO CHANNELS CONFIGURED';
    grid.innerHTML = '<div class="supplier-empty">MARKET SCAN STANDBY<small>NO SCAN TARGETS CONFIGURED</small></div>';
    return { totalOffers: 0, uniqueBases: 0, pending: false };
  }

  if (!Array.isArray(allBases) || !allBases.length) {
    const failed = Boolean(lastSyncError);
    if (meta) meta.textContent = failed ? 'TELEMETRY UNAVAILABLE' : 'AWAITING FIRST TELEMETRY BURST';
    grid.innerHTML = `<div class="supplier-empty">${failed ? 'MARKET DATA UNAVAILABLE' : 'MARKET SCAN PENDING'}<small>${failed ? 'SYNC FAILED // RETRY WITH REFRESH' : 'AWAITING FIRST TELEMETRY BURST'}</small></div>`;
    return { totalOffers: 0, uniqueBases: 0, pending: true };
  }

  const sellerKeys = new Set();
  let totalOffers = 0;
  const cards = targets.map(targetName => {
    const key = keyFromName(targetName);
    const priced = [];
    const unlisted = [];

    for (const base of allBases) {
      if (!base || !Array.isArray(base.shop_items)) continue;
      const item = base.shop_items.find(entry => commodityKey(entry) === key);
      if (!item) continue;

      const total = quantity(item);
      const reserve = Math.max(0, minStock(item) || 0);
      const sellable = Math.max(0, total - reserve);
      if (sellable <= 0) continue;

      const name = String(base.name || base.nickname || 'UNKNOWN BASE').trim() || 'UNKNOWN BASE';
      const baseKey = normalize(name);
      const offer = {
        baseKey,
        name,
        local: marketBaseIsLocal(base),
        system: marketBaseSystem(base),
        q: sellable,
        total,
        reserve,
        price: validMarketPrice(item),
        feedstock: feedstocks[key] ? marketFeedstock(base, feedstocks[key]) : null
      };

      if (offer.price === null) unlisted.push(offer);
      else {
        priced.push(offer);
        sellerKeys.add(baseKey);
        totalOffers += 1;
      }
    }

    const bestPrice = priced.length ? Math.min(...priced.map(offer => offer.price)) : null;
    if (sort === 'stock') {
      priced.sort((a, b) => (b.q - a.q) || (a.price - b.price) || a.name.localeCompare(b.name));
    } else {
      priced.sort((a, b) => (a.price - b.price) || (b.q - a.q) || a.name.localeCompare(b.name));
    }
    unlisted.sort((a, b) => (b.q - a.q) || a.name.localeCompare(b.name));

    let visiblePriced = priced.slice(0, 6);
    const bestOffer = sort === 'stock' && bestPrice !== null
      ? priced.find(offer => offer.price === bestPrice)
      : null;
    if (bestOffer && !visiblePriced.includes(bestOffer)) {
      visiblePriced = visiblePriced.length < 6
        ? [...visiblePriced, bestOffer]
        : [...visiblePriced.slice(0, 5), bestOffer];
    }
    const remainingSlots = Math.max(0, 6 - visiblePriced.length);
    const visibleUnlisted = unlisted.slice(0, remainingSlots);
    let allVisible = [...visiblePriced, ...visibleUnlisted];

    const localOffer = [...priced, ...unlisted].find(offer => offer.local);
    if (localOffer && !allVisible.includes(localOffer)) {
      if (allVisible.length < 6) allVisible.push(localOffer);
      else {
        let replaceIndex = allVisible.length - 1;
        if (bestOffer && allVisible[replaceIndex] === bestOffer) {
          replaceIndex = allVisible.findLastIndex(offer => offer !== bestOffer);
        }
        if (replaceIndex >= 0) allVisible[replaceIndex] = localOffer;
      }
    }

    const compareOffers = sort === 'stock'
      ? ((a, b) => (b.q - a.q) || ((a.price ?? Infinity) - (b.price ?? Infinity)) || a.name.localeCompare(b.name))
      : ((a, b) => ((a.price ?? Infinity) - (b.price ?? Infinity)) || (b.q - a.q) || a.name.localeCompare(b.name));
    allVisible.sort(compareOffers);
    const maxQ = Math.max(0, ...allVisible.map(offer => offer.q));

    return { targetName, priced, unlisted, bestPrice, allVisible, maxQ };
  });

  if (meta) {
    const cachePrefix = dataIsStale ? 'CACHE ONLY · ' : '';
    meta.textContent = `${cachePrefix}${sellerKeys.size} BASES · ${totalOffers} PRICED OFFERS`;
  }

  grid.innerHTML = cards.map(card => {
    const title = CANONICAL_NAMES[keyFromName(card.targetName)] || displayRecipeName(card.targetName);
    const state = dataIsStale ? 'stale' : (card.priced.length ? 'ok' : (card.unlisted.length ? 'low' : 'critical'));
    const rows = card.allVisible.map(offer => {
      const isUnlisted = offer.price === null;
      const isBest = !isUnlisted && card.bestPrice !== null && offer.price === card.bestPrice;
      const fillPct = card.maxQ > 0 ? Math.max(3, Math.min(100, (offer.q / card.maxQ) * 100)) : 0;
      const rowClass = dataIsStale ? 'stale' : (isUnlisted ? 'unlisted' : 'info');
      const localLabel = offer.local ? 'RHW LOCAL / OWN FACILITY · ' : '';
      const note = `${localLabel}${offer.system.toUpperCase()}${isBest ? ' · BEST PRICE' : ''}${isUnlisted ? ' · STOCK DETECTED / NOT LISTED' : ''}`;
      const priceText = isUnlisted ? 'NOT LISTED' : formatCurrency(offer.price);
      const input = offer.feedstock;
      const inputStock = input ? `
          <div class="market-feedstock${input.quantity === null ? ' unknown' : ''}${dataIsStale ? ' stale' : ''}" data-market-feedstock="${escapeHTML(keyFromName(input.name))}" data-tooltip="Total reported input stock at this base, including reserves. Production also depends on other inputs and facilities.">
            <span>${dataIsStale ? 'Cached · ' : ''}${escapeHTML(input.name)} at base</span>
            <strong>${input.quantity === null ? 'NOT REPORTED' : number(input.quantity)}</strong>
          </div>` : '';
      return `
        <div class="supplier-commodity-row ${rowClass}${offer.local ? ' rhw-local-offer' : ''}">
          <div class="supplier-commodity-name">
            <strong>${escapeHTML(offer.name)}</strong>
            <small class="${rowClass}">${escapeHTML(note)}</small>
          </div>
          <div class="supplier-commodity-metric stock">
            <small>For Sale</small>
            <strong class="scramble-market" data-val="${number(offer.q)}"></strong>
          </div>
          <div class="supplier-commodity-metric price">
            <small>Unit Price</small>
            <strong class="scramble-market${isUnlisted ? ' unlisted' : ''}" data-val="${escapeHTML(priceText)}"></strong>
          </div>
          ${inputStock}
          <div class="supplier-progress-wrap" data-tooltip="${number(offer.q)} FOR SALE // ${number(offer.total)} TOTAL · ${number(offer.reserve)} BASE RESERVE">
            <div class="supplier-progress-fill ${dataIsStale ? 'stale' : (isUnlisted ? 'low' : 'info')}" style="width:${fillPct}%;"></div>
          </div>
        </div>`;
    }).join('');

    const empty = '<div class="supplier-commodity-row critical"><div class="supplier-commodity-name"><strong>NO SELLERS FOUND</strong><small class="critical">NO BASE ABOVE ITS MINIMUM RESERVE</small></div></div>';
    const pricedCount = card.priced.length;
    const unlistedCount = card.unlisted.length;
    const linkClass = dataIsStale ? 'stale' : (pricedCount ? 'online' : (unlistedCount ? 'degraded' : 'offline'));
    const linkText = dataIsStale ? 'STALE DATA' : (pricedCount ? 'SCAN LIVE' : (unlistedCount ? 'UNLISTED STOCK' : 'NO SUPPLY'));

    return `
      <div class="supplier-card market-card ${state}" data-market-commodity="${escapeHTML(keyFromName(card.targetName))}">
        <div class="supplier-scanline"></div>
        <div class="remote-facility-head">
          <div>
            <div class="remote-card-meta">
              <span class="remote-badge">MARKET SCAN</span>
              <span class="remote-badge">${pricedCount} OFFER${pricedCount === 1 ? '' : 'S'}</span>
            </div>
            <div class="supplier-title">${escapeHTML(String(title).toUpperCase())}</div>
            <div class="remote-facility-subline">${sort === 'price' ? 'SORTED BY BEST PRICE' : 'SORTED BY AVAILABLE STOCK'} // TOP ${Math.min(6, card.allVisible.length)} RESULTS</div>
          </div>
          <span class="remote-link-pill ${linkClass}">${linkText}</span>
        </div>
        <div class="supplier-commodity-list">${rows || empty}</div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.scramble-market').forEach(el => scrambleText(el, el.dataset.val));
  return { totalOffers, uniqueBases: sellerKeys.size, pending: false };
}

function renderSupplier() {
  if (!els.externalLogisticsPanel || (!FEATURES.materialsScan && !FEATURES.marketScan)) return;

  const shipStats = renderMarketScan();
  const materialStats = renderMaterialsScan();

  if (dataIsStale && lastLoaded) {
    const staleTime = lastLoaded.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setSupplierLinkState('stale', `CACHE ONLY · LAST SYNC ${staleTime}`);
    return;
  }

  const summary = [];
  if (FEATURES.marketScan) summary.push(`${shipStats.totalOffers} SHIP OFFERS`);
  if (FEATURES.materialsScan) summary.push(`${materialStats.totalOffers} MATERIAL OFFERS`);
  if (shipStats.pending || materialStats.pending) {
    setSupplierLinkState(lastSyncError ? 'offline' : 'polling', lastSyncError ? 'MARKET DATA UNAVAILABLE' : 'MARKET SCANS PENDING');
  } else if (shipStats.totalOffers + materialStats.totalOffers > 0) {
    setSupplierLinkState('online', summary.join(' · '));
  } else {
    setSupplierLinkState('degraded', 'SCANS COMPLETE · NO PRICED OFFERS');
  }
}
