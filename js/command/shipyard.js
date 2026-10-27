/* Shipyard view. Recipe quantities are owned by RHWV4.shipyard. */
function normalizedAssetMatch(value) {
  return normalize(value).replace(/[\"'`´‘’“”–—_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function itemIdentityCandidates(item) {
  return [item?.name, item?.item_name, item?.nickname, item?.id, item?.item_code,
    item?.itemCode, item?.code, item?.archetype, item?.archetype_id, item?.arch_id]
    .map(normalizedAssetMatch).filter(Boolean);
}

function findShipyardItem(entry) {
  const inventory = items.filter(item => !item.missing && !item.synthetic);
  const codes = [entry.id, entry.productId, entry.apiCode].map(normalizedAssetMatch).filter(Boolean);
  const exact = inventory.find(item => itemIdentityCandidates(item).some(value => codes.includes(value)));
  if (exact) return exact;
  const names = [entry.name, ...(entry.matches || [])].map(normalizedAssetMatch).filter(Boolean);
  // Exact aliases prevent Archon Design Schematics, or similarly named modules,
  // from being counted as finished ships.
  return inventory.find(item => itemIdentityCandidates(item).some(value => names.includes(value))) || null;
}

function shipyardTrafficState(value) {
  const count = Math.max(0, Math.floor(Number(value) || 0));
  return count <= 0 ? 'critical' : (count === 1 ? 'low' : 'ok');
}

// Decorative hull schematics keep the selection recognizable without adding
// remote image dependencies to an offline-capable ship registry.
function shipyardSilhouette(hull) {
  const paths = {
    archon: 'M12 32H40L52 20H108L120 28H178L190 36L178 44H120L108 52H52L40 40H12ZM60 14H75V58H60ZM91 18H103V54H91ZM129 21H139V51H129Z',
    'asteroid-miner': 'M1010 390H1029L1036 413L1038 425H1055V431L1074 443L1079 475L1073 480L1074 510L1097 516L1103 526L1104 539L1076 543L1078 553L1110 554V549L1141 540L1150 530L1157 547L1165 553V575L1159 591L1153 594L1151 610L1143 607V592L1123 596L1121 611L1109 605V582L1075 580L1077 626L1062 633L1063 639H999L988 635L966 642V619L971 607L974 581L938 583L936 605L920 609L922 593L909 592L903 613L889 619L887 602L890 579L887 568L891 552L897 533L904 548L922 545L938 554L971 550L972 541L948 539L945 532L947 522L962 515L967 512L966 484L963 485L965 447L984 433L1000 429L1006 405Z',
    dunkirk: 'M10 33L38 27H73L88 18H117L139 27H164L192 36L164 45H139L117 54H88L73 45H38L10 39ZM89 9H103V63H89Z',
    invincible: 'M10 26H64L86 14H137L162 24H187V48H162L137 58H86L64 46H10ZM26 12H130V20H26ZM26 52H130V60H26ZM76 26H156V46H76Z',
    bustard: 'M14 24H69L82 14H144L185 29V43L144 58H82L69 48H14ZM31 11H119V20H31ZM31 52H119V61H31ZM89 27H150V45H89Z',
    barge: 'M681 566H762V551L778 548V539L764 538L760 532L762 520L778 519L779 514H823L830 509L865 510L872 520L882 524V508L891 503L892 486L911 478L936 475L945 465L952 461V456L999 454V435H1034L1035 466L1049 469H1151V465H1165L1166 469H1287V465H1300L1303 470L1419 468L1423 463H1428L1429 469L1455 468L1457 464L1462 466L1468 469L1533 466L1534 470L1547 478L1557 491L1566 508L1571 528V550L1563 568L1562 574H1574L1575 580L1502 582L1493 590L1488 604L1482 608L1480 605L1482 596L1486 587L1481 584L1476 596L1468 601L1467 596L1471 587L1472 583L1172 587L1171 593H1163V587L1066 588L1046 584L1043 593H1013L1005 600H997L1006 609L1009 616L998 621L986 627L946 630V597L934 589L910 592L899 582L891 566L882 564L876 578L864 576L862 573L836 571L822 566L817 574L808 575L794 571H681Z M1075 483Q1093 526 1086 572H1091Q1098 526 1080 483Z M1126 483Q1144 526 1137 572H1142Q1149 526 1131 483Z M1175 483Q1193 526 1186 572H1191Q1198 526 1180 483Z M1225 483Q1243 526 1236 572H1241Q1248 526 1230 483Z M1279 483Q1297 526 1290 572H1295Q1302 526 1284 483Z M1328 483Q1346 526 1339 572H1344Q1351 526 1333 483Z M1376 483Q1394 526 1387 572H1392Q1399 526 1381 483Z M1427 483Q1445 526 1438 572H1443Q1450 526 1432 483Z M1476 483Q1494 526 1487 572H1492Q1499 526 1481 483Z M1528 483Q1546 526 1539 568H1544Q1551 526 1533 483Z',
    'starfliers-explorer': 'M18 33H67L84 18H119L149 28L190 36L149 44L119 54H84L67 39H18ZM86 8H98V64H86ZM129 20H138V52H129Z',
    'civilian-cruiser': 'M10 32H53L70 23H125L148 29L190 36L148 43L125 49H70L53 40H10ZM69 13H88V59H69ZM113 19H126V53H113Z',
    halberd: 'M10 32H75L100 22H132L190 36L132 50H100L75 40H10ZM56 13H100V23H56ZM56 49H100V59H56ZM105 12H117V60H105Z'
  };
  // Screenshot-derived outlines retain their proportions. The Miner's nose
  // points right after a clockwise quarter-turn; the Barge keeps its side view.
  const views = { 'asteroid-miner': '0 0 280 300', barge: '670 425 920 215' };
  const transform = hull.key === 'asteroid-miner' ? ' transform="translate(660 -880) rotate(90)"' : '';
  const fillRule = hull.key === 'barge' ? ' fill-rule="evenodd"' : '';
  return `<svg class="shipyard-silhouette" viewBox="${views[hull.key] || '0 0 200 72'}" aria-hidden="true" focusable="false"><path${transform}${fillRule} d="${paths[hull.key] || paths.halberd}"/></svg>`;
}

function shipyardCrewMarkup(analysis) {
  if (!analysis?.recipeReady) return '';
  const staff = window.RHWV4?.personnel?.forRecipe(analysis.recipe);
  if (!staff) return '';
  return `<div class="shipyard-crew-check" aria-label="Ship personnel check">${staff.filter(row => row.required > 0).map(row =>
    `<div class="shipyard-crew-resource" data-state="${row.gap === null ? 'unknown' : row.gap > 0 ? 'short' : 'ready'}"><span><small>${row.name.toUpperCase()} / SHIP</small><strong>${number(row.required)}</strong></span>
      <span><small>TOTAL WITH CORE &amp; PLAN</small><strong>${number(row.total)}</strong></span>
      <span><small>${row.amount === null ? 'STOCK UNKNOWN' : `${row.source} STOCK ${number(row.amount)}`}</small><strong>${row.gap === null ? 'ENTER STOCK' : row.gap > 0 ? `${number(row.gap)} SHORT` : 'COVERED'}</strong></span></div>`
  ).join('')}<button type="button" data-personnel-open>PERSONNEL PLANNER <span aria-hidden="true">↗</span></button></div>`;
}

function renderShipyardControl() {
  const mount = els.shipyardControl;
  if (!mount) return;
  mount.hidden = !FEATURES.capitalShipyard;
  if (mount.hidden) return;
  const yard = window.RHWV4?.shipyard;
  const analysis = yard?.analyze();
  const snapshot = analysis?.snapshot || telemetrySnapshot();
  const selected = yard?.selectedHull() || CAPITAL_SHIPYARD.hulls.find(hull => hull.key === CAPITAL_SHIPYARD.defaultHull);
  const division = CAPITAL_SHIPYARD.divisions.find(entry => entry.key === selected.division);
  mount.classList.toggle('stale', snapshot.stale);

  const cards = CAPITAL_SHIPYARD.hulls.filter(hull => hull.division === division.key).map(hull => {
    const record = yard?.stockRecord(hull, snapshot) || { item: null, stock: null };
    const boundary = record.item ? apiStockBoundary(record.item) : null;
    const livePrice = record.item ? priceBuy(record.item) : null;
    const price = livePrice ?? hull.sellPrice;
    const stock = record.stock === null ? '—' : number(record.stock);
    const stockText = record.stock !== null && boundary?.valid ? `${stock} / ${number(boundary.max)}` : stock;
    return `<button type="button" class="shipyard-hull-card" data-shipyard-select="${hull.key}"
      aria-pressed="${selected?.key === hull.key}" aria-controls="shipyardRequirements" aria-label="${escapeHTML(hull.name)} build requirements">
      ${shipyardSilhouette(hull)}<span class="shipyard-hull-name">${escapeHTML(hull.label)}</span>
      <span class="shipyard-hull-type">${escapeHTML(hull.subtitle)}</span>
      <span class="shipyard-hull-indicator" aria-hidden="true"></span>
      <span class="shipyard-hull-stock-label">${record.stock === null ? 'STOCK UNKNOWN' : boundary?.valid ? 'STOCK / MAX' : 'IN STOCK'}</span>
      <strong class="shipyard-hull-stock">${stockText}</strong>
      <span class="shipyard-hull-price-label">${livePrice !== null ? 'SELL PRICE' : price !== null ? 'REFERENCE PRICE' : 'PRICE UNKNOWN'}</span>
      <span class="shipyard-hull-price">${price === null ? '—' : formatCurrency(price)}</span>
    </button>`;
  }).join('');

  let details = `<div class="shipyard-data-note">${snapshot.available ? 'RECIPE DATA UNAVAILABLE' : 'AWAITING VERIFIED INVENTORY'}<small>Stock and material coverage will appear when the data is available.</small></div>`;
  if (analysis?.recipeReady) {
    const { hull, buildable, nextHull, bottleneck, materials, prerequisites } = analysis;
    const state = buildable === null ? 'unknown' : shipyardTrafficState(buildable);
    const unknown = materials.filter(row => row.stock === null);
    const rows = materials.map(row => `<tr class="shipyard-material-row ${row.state}${row.id === bottleneck?.id ? ' bottleneck' : ''}" data-shipyard-material="${escapeHTML(row.id)}">
      <th scope="row"><div class="shipyard-material-name">${typeof supplyRouteButton === 'function' ? `<button type="button" class="rhw-supply-name" data-supply-commodity="${escapeHTML(row.name)}" aria-label="Plan supply route for ${escapeHTML(row.name)}">${escapeHTML(row.name)}</button>` : `<span>${escapeHTML(row.name)}</span>`}${row.gap > 0 && typeof purchaseSourceButton === 'function' ? purchaseSourceButton(row.name, row.gap) : ''}</div></th>
      <td data-label="PER SHIP">${number(row.required)}</td><td data-label="STOCK">${row.stock === null ? '—' : number(row.stock)}</td>
      <td data-label="MISSING" class="shipyard-material-gap">${row.gap > 0 ? `<span class="shipyard-shortage">+${number(row.gap)}</span>` : '—'}</td>
    </tr>`).join('');
    const prerequisiteRows = prerequisites.map(row => `<li class="shipyard-prerequisite ${row.state}">
      <span><strong>${escapeHTML(row.name)}</strong><small>${number(row.qty)} required · not consumed${row.staffing ? ' · after core & planned jobs' : ''}</small></span>
      <span class="shipyard-prerequisite-status">${row.state === 'unknown' ? 'NOT REPORTED' : row.state === 'ok' ? 'AVAILABLE' : `MISSING ${number(row.staffing?.gap ?? row.qty - row.stock)}`}</span>
    </li>`).join('');
    details = `${shipyardCrewMarkup(analysis)}<div class="shipyard-decision-strip" aria-label="${escapeHTML(hull.label)} material coverage">
        <div class="shipyard-decision-metric shipyard-coverage state-${state}"><small>MATERIAL FOR</small><strong>${buildable === null ? 'UNKNOWN' : `${number(buildable)} <span>${escapeHTML(buildable === 1 ? hull.label : hull.plural).toUpperCase()}</span>`}</strong></div>
        <div class="shipyard-decision-metric"><small>BOTTLENECK</small><strong>${bottleneck ? escapeHTML(bottleneck.name) : 'STOCK UNKNOWN'}</strong></div>
        <div class="shipyard-decision-metric shipyard-next-ship"><small>${nextHull === null ? 'NEXT SHIP' : `NEXT SHIP #${number(nextHull)}`}</small><strong>${bottleneck ? `+${number(bottleneck.gap)} <span>${escapeHTML(bottleneck.name)}</span>` : 'AWAITING STOCK'}</strong></div>
      </div>
      ${unknown.length ? `<p class="shipyard-data-note">Stock not reported: ${unknown.map(row => escapeHTML(row.name)).join(', ')}. Coverage remains unknown.</p>` : ''}
      <div class="shipyard-requirement-body">
        <div class="shipyard-materials">
          <p class="shipyard-material-note">Requirements per ship${nextHull === null ? '' : ` · Missing quantities are for ship #${number(nextHull)}`}${snapshot.stale ? ' · Based on cached stock' : ''}.</p>
          <table class="shipyard-material-table"><thead><tr><th scope="col">COMPONENT</th><th scope="col">PER SHIP</th><th scope="col">STOCK</th><th scope="col">MISSING</th></tr></thead><tbody>${rows}</tbody></table>
        </div>
        <aside class="shipyard-prerequisites"><h3>BUILD PREREQUISITES</h3><p>Required separately from the material coverage above.</p>
          <ul>${prerequisiteRows}</ul>
          <p>Shipyard level ${number(analysis.recipe.reqLevel)} required. ${escapeHTML(analysis.recipe.restricted ? 'RHW BMM recipe.' : 'Civilian assembly recipe.')}</p>
        </aside>
      </div>`;
  }

  const markup = `<div class="shipyard-control-head">
      <div class="shipyard-heading-copy"><h2 class="shipyard-control-title">SHIPYARD</h2><p class="shipyard-control-subline">STOCK &amp; BUILD REQUIREMENTS</p></div>
      <div class="section-freshness" data-freshness-badge hidden></div>
    </div>
    <div class="shipyard-control-grid">
      <div class="shipyard-divisions" role="group" aria-label="Shipyard divisions">${CAPITAL_SHIPYARD.divisions.map(entry =>
        `<button type="button" data-shipyard-division="${entry.key}" aria-pressed="${entry.key === division.key}" aria-controls="shipyardRegistry">
          <span class="shipyard-division-title">${escapeHTML(entry.label)}</span><span class="shipyard-division-short">${escapeHTML(entry.short)}</span>
          <small>${escapeHTML(entry.subtitle)}</small><span class="shipyard-division-count">${CAPITAL_SHIPYARD.hulls.filter(hull => hull.division === entry.key).length} HULLS</span></button>`).join('')}</div>
      <section class="shipyard-control-section shipyard-registry-panel" id="shipyardRegistry" aria-label="${escapeHTML(division.label)} ships">
        <div class="shipyard-registry-heading"><span>${escapeHTML(division.subtitle)}</span><small>SELECT HULL</small></div>
        <div class="shipyard-hull-grid" role="group" aria-label="Ship inventory and selection">${cards}</div>
      </section>
      <section class="shipyard-control-section shipyard-requirements-panel" id="shipyardRequirements" aria-labelledby="shipyardRequirementsTitle">
        <div class="shipyard-requirements-heading"><div><p class="shipyard-eyebrow">BUILD REQUIREMENTS</p><h3 id="shipyardRequirementsTitle">${escapeHTML(selected.label)} <span>${escapeHTML(selected.subtitle)}</span></h3></div>
          <button type="button" class="shipyard-plan-button" data-shipyard-calculate ${analysis?.recipeReady ? '' : 'disabled'}>PRICE 1 SHIP</button>
        </div>${details}
      </section>
    </div>`;
  if (mount._shipyardMarkup !== markup) {
    const active = document.activeElement;
    const focusSelector = mount.contains(active) ? active?.dataset?.shipyardSelect
      ? `[data-shipyard-select="${active.dataset.shipyardSelect}"]`
      : active?.dataset?.shipyardDivision ? `[data-shipyard-division="${active.dataset.shipyardDivision}"]`
      : active?.hasAttribute('data-personnel-open') ? '[data-personnel-open]'
      : active?.hasAttribute('data-shipyard-calculate') ? '[data-shipyard-calculate]' : null : null;
    mount.innerHTML = markup;
    mount._shipyardMarkup = markup;
    if (focusSelector) mount.querySelector(focusSelector)?.focus({ preventScroll: true });
  }
  updateDataFreshnessIndicators();
  window.RHWRuntime?.rendered('shipyard');
}
