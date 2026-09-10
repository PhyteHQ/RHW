/* ==========================================================================
   RHW PR8 · PRODUCTION ORDER BOARD
   Local priority queue, shared direct-material manifest and matching Forum
   BBCode report. Prices are deliberately excluded from durable order data.
   ========================================================================== */
(function initRhwProductionOrders() {
  'use strict';
  const app = window.RHWV4;
  const core = app?.operationsCore;
  if (!app || !core || app.productionOrders) return;

  const KEY = app.config.storageKeys.productionOrders || 'rhw-webapp-v4:production-orders';
  const MAX_ORDERS = 100;
  const PRIORITIES = Object.freeze({ urgent: 0, high: 1, normal: 2 });
  const PRIORITY_LABELS = Object.freeze({ urgent: 'URGENT', high: 'HIGH', normal: 'NORMAL' });
  const state = { orders: [], initialized: false, lastReport: null };
  const esc = value => app.util.escape(value);
  const fmt = value => app.util.number(Math.max(0, Number(value) || 0));
  const whole = value => Math.max(1, Math.floor(Number(value) || 1));

  function safeText(value, fallback = '') {
    return String(value ?? fallback).trim().slice(0, 240);
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const productId = safeText(raw.productId);
    const recipeId = safeText(raw.recipeId);
    if (!productId || !recipeId) return null;
    const priority = Object.prototype.hasOwnProperty.call(PRIORITIES, raw.priority) ? raw.priority : 'normal';
    const createdAt = Number(raw.createdAt) || Date.now();
    return {
      id: safeText(raw.id) || app.util.uid('production-order'),
      productId,
      recipeId,
      quantity: whole(raw.quantity),
      affiliationId: safeText(raw.affiliationId, app.config.operations.defaultAffiliation) || app.config.operations.defaultAffiliation,
      productName: safeText(raw.productName),
      recipeName: safeText(raw.recipeName),
      priority,
      createdAt,
      updatedAt: Number(raw.updatedAt) || createdAt
    };
  }

  function ensureInitialized() {
    if (state.initialized) return;
    const stored = app.store.get(KEY, []);
    state.orders = uniqueOrders(Array.isArray(stored) ? stored : []);
    state.initialized = true;
  }

  function uniqueOrders(raw) {
    const map = new Map();
    raw.map(normalize).filter(Boolean).forEach(order => {
      const current = map.get(order.id);
      if (!current || order.updatedAt >= current.updatedAt) map.set(order.id, order);
    });
    return [...map.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  function sortedOrders() {
    ensureInitialized();
    return [...state.orders].sort((a, b) => PRIORITIES[a.priority] - PRIORITIES[b.priority] || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  function save() {
    state.initialized = true;
    app.store.set(KEY, state.orders);
  }

  function recipeName(order, recipe) {
    return order.recipeName || recipe?.name || recipe?.id || order.recipeId;
  }

  function productName(order, plan) {
    return order.productName || plan?.product?.name || core.product(order.productId)?.name || order.productId;
  }

  function affiliationName(id) {
    if (id === '__none__') return 'NO IFF BONUS';
    const faction = core.state.catalog?.factions?.find(entry => entry.id === id);
    return id === 'br_m_grp' ? 'BMM' : (faction?.name || id || 'UNASSIGNED IFF');
  }

  function planOrder(order) {
    try {
      const plan = core.buildPlan({
        productId: order.productId,
        recipeId: order.recipeId,
        quantity: order.quantity,
        affiliationId: order.affiliationId,
        useInventory: false,
        recursive: false,
        routingPolicy: 'first',
        altSelections: {}
      });
      return { order, plan, error: '', productName: productName(order, plan), recipeName: recipeName(order, plan.rootRecipe) };
    } catch (error) {
      return { order, plan: null, error: String(error?.message || error), productName: productName(order), recipeName: recipeName(order, core.recipe(order.recipeId)) };
    }
  }

  function buildReport() {
    const plannedOrders = sortedOrders().map(planOrder);
    const materialMap = new Map();
    for (const entry of plannedOrders) {
      for (const row of entry.plan?.directRequirements || []) {
        const id = row.item?.id || row.item?.name || 'unknown';
        const current = materialMap.get(id) || { id, name: row.item?.name || id, item: row.item, required: 0 };
        current.required += Math.max(0, Number(row.required) || 0);
        materialMap.set(id, current);
      }
    }
    const telemetry = window.telemetrySnapshot();
    const telemetryReady = telemetry.available;
    const materials = [...materialMap.values()].map(row => {
      const stock = telemetryReady ? core.telemetryQuantity(row.item) : null;
      const deficit = stock === null ? null : Math.max(0, row.required - stock);
      return { ...row, stock, deficit, covered: stock === null ? null : deficit === 0 };
    }).sort((a, b) => {
      if (telemetryReady && Boolean(a.deficit) !== Boolean(b.deficit)) return a.deficit ? -1 : 1;
      return b.required - a.required || a.name.localeCompare(b.name);
    });
    const report = {
      generatedAt: new Date().toISOString(),
      telemetryReady,
      telemetry,
      orders: plannedOrders,
      materials,
      validOrders: plannedOrders.filter(entry => entry.plan).length,
      totalOutput: plannedOrders.reduce((sum, entry) => sum + (entry.plan?.actualOutput || 0), 0),
      bottlenecks: telemetryReady ? materials.filter(row => Number(row.deficit) > 0).length : null
    };
    state.lastReport = report;
    return report;
  }

  function bbSafe(value) {
    return String(value ?? '').replace(/\[/g, '(').replace(/\]/g, ')').replace(/[\r\n]+/g, ' ').trim();
  }

  function buildBbcode(report = buildReport()) {
    const forum = app.config.forum;
    const generated = new Date(report.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    const lines = [
      '[center]',
      `[img]${forum.logoUrl}[/img]`,
      `[color=${forum.brandColor}][size=150][b]RHW PRODUCTION ORDER BOARD[/b][/size][/color]`,
      `[color=${forum.mutedColor}]${bbSafe(forum.organisation)} // ${bbSafe(forum.subline)}[/color]`,
      '',
      `[color=${forum.textColor}][b]${report.orders.length} ORDER${report.orders.length === 1 ? '' : 'S'} // ${fmt(report.totalOutput)} PLANNED OUTPUT[/b][/color]`,
      report.telemetryReady
        ? `[color=${report.telemetry?.stale || report.bottlenecks ? '#c98b2c' : '#78ad8a'}]${bbSafe(report.telemetry?.detail || 'STOCK FRESHNESS UNKNOWN')} // ${report.bottlenecks} MATERIAL BOTTLENECK${report.bottlenecks === 1 ? '' : 'S'}[/color]`
        : `[color=${forum.mutedColor}]STOCK STATUS // AWAITING VERIFIED TELEMETRY[/color]`,
      '',
      '[table]',
      `[tr][td][color=${forum.brandColor}][b]PRIORITY[/b][/color][/td][td][color=${forum.brandColor}][b]BUILD TARGET[/b][/color][/td][td][color=${forum.brandColor}][b]QTY[/b][/color][/td][td][color=${forum.brandColor}][b]IFF[/b][/color][/td][/tr]`,
      ...report.orders.map(entry => `[tr][td][b]${PRIORITY_LABELS[entry.order.priority]}[/b][/td][td]${bbSafe(entry.productName)}${entry.error ? ` // ERROR: ${bbSafe(entry.error)}` : ''}[/td][td]${fmt(entry.order.quantity)}[/td][td]${bbSafe(affiliationName(entry.order.affiliationId))}[/td][/tr]`),
      '[/table]',
      '',
      `[color=${forum.brandColor}][b]AGGREGATED DIRECT MATERIALS[/b][/color]`,
      '[table]',
      `[tr][td][color=${forum.brandColor}][b]MATERIAL[/b][/color][/td][td][color=${forum.brandColor}][b]REQUIRED[/b][/color][/td][td][color=${forum.brandColor}][b]STOCK[/b][/color][/td][td][color=${forum.brandColor}][b]GAP[/b][/color][/td][/tr]`,
      ...(report.materials.length ? report.materials.map(row => `[tr][td]${bbSafe(row.name)}[/td][td]${fmt(row.required)}[/td][td]${row.stock === null ? 'AWAITING VERIFIED STOCK' : fmt(row.stock)}[/td][td]${row.deficit === null ? '—' : fmt(row.deficit)}[/td][/tr]`) : ['[tr][td]NO MATERIAL REQUIREMENTS[/td][td]—[/td][td]—[/td][td]—[/td][/tr]']),
      '[/table]',
      '',
      `[color=${forum.footerColor}][size=80]GENERATED ${bbSafe(generated)} // DIRECT RECIPE INPUTS ONLY[/size][/color]`,
      `[color=${forum.footerColor}][size=80]${bbSafe(forum.footerMotto)}[/size][/color]`,
      '[/center]'
    ];
    return lines.join('\n');
  }

  function priorityOptions(selected) {
    return Object.keys(PRIORITIES).map(key => `<option value="${key}"${key === selected ? ' selected' : ''}>${PRIORITY_LABELS[key]}</option>`).join('');
  }

  function orderCards(report) {
    if (!report.orders.length) return `<div class="production-orders-empty"><strong>NO PRODUCTION ORDERS</strong><span>Open the Item Calculator, choose a recipe and add its current target here.</span><button type="button" data-orders-open-calculator>OPEN ITEM CALCULATOR</button></div>`;
    return report.orders.map((entry, index) => `<article class="production-order-card priority-${entry.order.priority}" data-production-order="${esc(entry.order.id)}">
      <header><div><span>${String(index + 1).padStart(2, '0')} // ${PRIORITY_LABELS[entry.order.priority]}</span><strong data-report-name>${esc(entry.productName)}</strong><small>${esc(entry.recipeName)}</small></div><label><span>PRIORITY</span><select data-order-priority="${esc(entry.order.id)}">${priorityOptions(entry.order.priority)}</select></label></header>
      <div class="production-order-meta"><div><small>TARGET</small><strong>${fmt(entry.order.quantity)}</strong></div><div><small>ACTUAL OUTPUT</small><strong>${entry.plan ? fmt(entry.plan.actualOutput) : '—'}</strong></div><div><small>IFF</small><strong>${esc(affiliationName(entry.order.affiliationId))}</strong></div><div><small>DIRECT INPUTS</small><strong>${entry.plan?.directRequirements?.length ?? '—'}</strong></div></div>
      ${entry.error ? `<div class="production-order-error">CALCULATION ERROR // ${esc(entry.error)}</div>` : ''}
      <footer><div class="production-order-quantity"><button type="button" data-order-delta="-1" data-order-id="${esc(entry.order.id)}" aria-label="Decrease order quantity">−</button><label><span>ORDER QUANTITY</span><input type="number" inputmode="numeric" min="1" step="1" value="${entry.order.quantity}" data-order-quantity="${esc(entry.order.id)}"></label><button type="button" data-order-delta="1" data-order-id="${esc(entry.order.id)}" aria-label="Increase order quantity">+</button></div><div class="production-order-actions"><button type="button" data-order-open="${esc(entry.order.id)}">EDIT IN CALCULATOR</button><button type="button" class="danger" data-order-remove="${esc(entry.order.id)}">REMOVE</button></div></footer>
    </article>`).join('');
  }

  function materialRows(report) {
    if (!report.materials.length) return '<div class="production-material-empty">ADD AN ORDER TO CALCULATE THE SHARED MATERIAL MANIFEST</div>';
    return `<div class="production-material-list">${report.materials.map(row => `<div class="production-material-row${row.deficit > 0 ? ' has-deficit' : ''}" data-production-material="${esc(row.id)}"><div><strong>${esc(row.name)}</strong><small>${esc(row.id)}</small></div><div><small>REQUIRED</small><strong>${fmt(row.required)}</strong></div><div><small>${esc(report.telemetry.label)}</small><strong>${row.stock === null ? 'AWAITING' : fmt(row.stock)}</strong></div><div><small>${row.deficit === null ? 'STATUS' : 'GAP'}</small><strong>${row.deficit === null ? 'NO VERIFIED DATA' : row.deficit > 0 ? fmt(row.deficit) : 'COVERED'}</strong></div></div>`).join('')}</div>`;
  }

  function forumPreview(report) {
    return `<div class="production-forum-document"><div class="production-forum-title"><span>RHW</span><div><strong>PRODUCTION ORDER BOARD</strong><small>${esc(app.config.forum.organisation)} // ${esc(app.config.forum.subline)}</small></div></div><div class="production-forum-summary"><strong>${report.orders.length} ORDER${report.orders.length === 1 ? '' : 'S'} // ${fmt(report.totalOutput)} PLANNED OUTPUT</strong><span>${esc(report.telemetry.detail)} // ${report.telemetryReady ? `${report.bottlenecks} MATERIAL BOTTLENECK${report.bottlenecks === 1 ? '' : 'S'}` : 'AWAITING VERIFIED STOCK TELEMETRY'}</span></div><div class="production-forum-orders">${report.orders.map(entry => `<div><b>${PRIORITY_LABELS[entry.order.priority]}</b><span data-forum-order-name>${esc(entry.productName)}</span><strong>× ${fmt(entry.order.quantity)}</strong></div>`).join('') || '<div><span>NO PRODUCTION ORDERS</span></div>'}</div><div class="production-forum-materials"><strong>AGGREGATED DIRECT MATERIALS</strong>${report.materials.map(row => `<div><span>${esc(row.name)}</span><b>${fmt(row.required)}</b><small>${row.stock === null ? 'AWAITING STOCK' : row.deficit > 0 ? `GAP ${fmt(row.deficit)}` : 'COVERED'}</small></div>`).join('') || '<p>NO MATERIAL REQUIREMENTS</p>'}</div></div>`;
  }

  function render() {
    ensureInitialized();
    const mount = document.getElementById('productionOrdersMount');
    if (!mount || !core.state.catalog) return false;
    const report = buildReport();
    const bbcode = buildBbcode(report);
    mount.className = 'production-orders-dashboard';
    mount.innerHTML = `<div class="production-orders-metrics"><div><small>QUEUED ORDERS</small><strong>${report.orders.length}</strong></div><div><small>PLANNED OUTPUT</small><strong>${fmt(report.totalOutput)}</strong></div><div><small>DIRECT MATERIALS</small><strong>${report.materials.length}</strong></div><div class="${report.bottlenecks ? 'warn' : report.telemetryReady ? 'good' : ''}"><small>MATERIAL BOTTLENECKS</small><strong>${report.bottlenecks === null ? 'AWAITING' : report.bottlenecks}</strong></div></div>
      <div class="production-orders-grid"><section class="production-orders-panel production-orders-queue"><header><div><span>01</span><div><strong>PRIORITY QUEUE</strong><small>Saved locally in this browser</small></div></div>${report.orders.length ? '<button type="button" id="productionOrdersClear">CLEAR ALL</button>' : ''}</header><div class="production-orders-list">${orderCards(report)}</div></section>
      <section class="production-orders-panel production-material-panel"><header><div><span>02</span><div><strong>SHARED MATERIAL MANIFEST</strong><small>All direct recipe inputs, counted once</small></div></div><b class="${report.telemetry.tone}">${esc(report.telemetry.label)}</b></header>${materialRows(report)}<p class="production-material-note">Material quantities use the same recipe, IFF and batch rounding as the Item Calculator. ${esc(report.telemetry.detail)}.</p></section></div>
      <section class="production-orders-panel production-orders-forum"><header><div><span>03</span><div><strong>FORUM REPORT</strong><small>Preview and BBCode use the same order snapshot</small></div></div><button type="button" id="productionOrdersCopy">COPY FORUM BBCode</button></header><div class="production-orders-forum-grid">${forumPreview(report)}<label class="production-orders-bbcode"><span>FORUM BBCode</span><textarea id="productionOrdersBbcode" readonly spellcheck="false">${esc(bbcode)}</textarea></label></div></section>`;
    bind();
    return true;
  }

  function updateOrder(id, patch) {
    ensureInitialized();
    const order = state.orders.find(entry => entry.id === id);
    if (!order) return false;
    Object.assign(order, patch, { updatedAt: Date.now() });
    const normalized = normalize(order);
    if (!normalized) return false;
    Object.assign(order, normalized);
    save();
    render();
    return true;
  }

  function remove(id) {
    ensureInitialized();
    const next = state.orders.filter(order => order.id !== id);
    if (next.length === state.orders.length) return false;
    state.orders = next;
    save();
    render();
    return true;
  }

  function clear() {
    state.orders = [];
    save();
    render();
  }

  function add(raw) {
    ensureInitialized();
    if (state.orders.length >= MAX_ORDERS) {
      app.notify(`ORDER LIMIT REACHED // MAXIMUM ${MAX_ORDERS}`, 'warn');
      return null;
    }
    const order = normalize({ ...raw, id: app.util.uid('production-order'), createdAt: Date.now(), updatedAt: Date.now() });
    if (!order) return null;
    state.orders.push(order);
    save();
    render();
    return { ...order };
  }

  function restore(raw) {
    state.orders = uniqueOrders(Array.isArray(raw) ? raw : []);
    state.initialized = true;
    save();
    render();
    return snapshot();
  }

  function importOrders(raw) {
    const next = prepareImport(raw);
    // Persist first so storage failure leaves the current queue intact.
    if (app.store.set(KEY, next) === false) throw new Error('ORDER IMPORT NOT SAVED // LOCAL QUEUE UNCHANGED');
    state.orders = next;
    render();
    return snapshot();
  }

  function prepareImport(raw) {
    ensureInitialized();
    const next = uniqueOrders([...state.orders, ...(Array.isArray(raw) ? raw : [])]);
    if (next.length > MAX_ORDERS) throw new Error(`IMPORT WOULD CREATE ${next.length} ORDERS // LIMIT ${MAX_ORDERS} // REMOVE ORDERS OR SELECT A SMALLER BACKUP. NOTHING IMPORTED.`);
    return next;
  }

  function snapshot() {
    ensureInitialized();
    return state.orders.map(order => ({ ...order }));
  }

  function bind() {
    document.querySelectorAll('[data-orders-open-calculator]').forEach(button => button.addEventListener('click', () => app.navigate('operations', 'calculator')));
    document.querySelectorAll('[data-order-priority]').forEach(select => select.addEventListener('change', () => updateOrder(select.dataset.orderPriority, { priority: select.value })));
    document.querySelectorAll('[data-order-quantity]').forEach(input => input.addEventListener('change', () => updateOrder(input.dataset.orderQuantity, { quantity: whole(input.value) })));
    document.querySelectorAll('[data-order-delta]').forEach(button => button.addEventListener('click', () => {
      const order = state.orders.find(entry => entry.id === button.dataset.orderId);
      if (order) updateOrder(order.id, { quantity: Math.max(1, order.quantity + Number(button.dataset.orderDelta || 0)) });
    }));
    document.querySelectorAll('[data-order-open]').forEach(button => button.addEventListener('click', () => {
      const order = state.orders.find(entry => entry.id === button.dataset.orderOpen);
      if (order) app.operations.openSelection(order);
    }));
    document.querySelectorAll('[data-order-remove]').forEach(button => button.addEventListener('click', () => {
      if (window.confirm('Remove this local production order?')) remove(button.dataset.orderRemove);
    }));
    document.getElementById('productionOrdersClear')?.addEventListener('click', () => {
      if (window.confirm('Clear every local production order?')) clear();
    });
    document.getElementById('productionOrdersCopy')?.addEventListener('click', async () => {
      const ok = await app.util.copy(document.getElementById('productionOrdersBbcode')?.value || buildBbcode());
      app.notify(ok ? 'PRODUCTION ORDER BBCODE COPIED' : 'COPY FAILED // SELECT THE BBCODE MANUALLY', ok ? 'good' : 'danger');
    });
  }

  function activate() {
    ensureInitialized();
    render();
  }

  function selfTest() {
    const failures = [];
    if (!app.config.storageKeys.productionOrders) failures.push('storage-key');
    if (typeof buildReport !== 'function' || typeof buildBbcode !== 'function') failures.push('report-api');
    if (!buildBbcode({ generatedAt: new Date().toISOString(), telemetryReady: false, orders: [], materials: [], totalOutput: 0, bottlenecks: null }).includes('PRODUCTION ORDER BOARD')) failures.push('bbcode');
    return failures;
  }

  app.productionOrders = { state, activate, render, add, updateOrder, remove, clear, restore, importOrders, prepareImport, snapshot, buildReport, buildBbcode, selfTest, priorities: PRIORITIES };
})();
