/* ==========================================================================
   RHW WEB APP · V4.0 NEWSWIRE ORDERING + FILE-EDITOR POLISH
   Keeps the Newswire Manager strictly as a local RHW_Newswire.md editor.
   Adds within-category ordering, category dividers/filters and readable actions.
   ========================================================================== */
(function initRhwV4NewswireOrdering() {
  'use strict';
  const app = window.RHWV4;
  const manager = app?.newswireManager;
  if (!app || !manager || app.newswireOrdering) return;

  const state = manager.state;
  const CATEGORIES = Object.freeze(['market', 'regional', 'security', 'operations', 'corporate']);
  const FILTERS = Object.freeze(['all', ...CATEGORIES]);
  const STYLE_ID = 'rhwV40NewswireOrderingStyle';
  let observer = null;
  let installed = false;
  let primed = false;
  let applyingOrder = false;
  let knownIds = new Set();
  let activeFilter = 'all';
  let refreshQueued = false;

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.dataset.stylesheet = '35-app-interface-cleanup.css';
    document.head.appendChild(style);
  }

  function installOrderNote() {
    const summary = document.getElementById('v40NewswireCategorySummary');
    if (!summary || document.getElementById('v40NewswireOrderNote')) return;
    const note = document.createElement('div');
    note.id = 'v40NewswireOrderNote';
    note.className = 'v40-newswire-order-note';
    note.innerHTML = '<strong>FILTER</strong> // USE THE CATEGORY COUNTERS ABOVE. <strong>ORDER</strong> // ▲ UP / ▼ DOWN CHANGES THE ORDER INSIDE EACH CATEGORY. NEW BULLETINS START AT THE TOP OF THEIR SELECTED CATEGORY.';
    summary.insertAdjacentElement('afterend', note);
  }

  function categoryEntries(category) {
    return (state.entries || []).filter(entry => entry.category === category);
  }

  function categoryPosition(entry) {
    return categoryEntries(entry.category).findIndex(item => item.id === entry.id);
  }

  function filterCount(filter) {
    return filter === 'all' ? (state.entries || []).length : categoryEntries(filter).length;
  }

  function filterSignature() {
    return `${activeFilter}|${FILTERS.map(filter => `${filter}:${filterCount(filter)}`).join('|')}`;
  }

  function renderFilterControls() {
    const summary = document.getElementById('v40NewswireCategorySummary');
    if (!summary) return;
    const signature = filterSignature();
    const buttons = summary.querySelectorAll('[data-newswire-filter]');
    if (summary.dataset.v40FilterSignature === signature && buttons.length === FILTERS.length) return;

    summary.innerHTML = FILTERS.map(filter => {
      const active = filter === activeFilter;
      return `<button type="button" data-newswire-filter="${filter}" class="${active ? 'active' : ''}" aria-pressed="${active ? 'true' : 'false'}">${filter.toUpperCase()} // ${filterCount(filter)}</button>`;
    }).join('');
    summary.dataset.v40FilterSignature = signature;
  }

  function setFilter(filter, { scroll = true } = {}) {
    const next = FILTERS.includes(filter) ? filter : 'all';
    if (activeFilter === next) return false;
    activeFilter = next;
    renderFilterControls();
    renderCategoryDividers({ force: true });
    if (scroll) document.getElementById('v40NewswireList')?.scrollTo?.({ top: 0, behavior: 'smooth' });
    return true;
  }

  function bindFilterControls() {
    const summary = document.getElementById('v40NewswireCategorySummary');
    if (!summary || summary.dataset.v40FilterBound === 'true') return;
    summary.dataset.v40FilterBound = 'true';
    summary.addEventListener('click', event => {
      const button = event.target.closest('[data-newswire-filter]');
      if (!button) return;
      event.preventDefault();
      setFilter(button.dataset.newswireFilter);
    });
  }

  function rowInfo() {
    const list = document.getElementById('v40NewswireList');
    if (!list) return [];
    return [...list.querySelectorAll('.v40-newswire-entry[data-newswire-id]')].map(row => {
      const entry = (state.entries || []).find(item => item.id === row.dataset.newswireId);
      return { row, entry };
    }).filter(info => info.entry);
  }

  function categoryViewSignature(infos) {
    return `${activeFilter}|${infos.map(info => `${info.entry.id}:${info.entry.category}`).join('|')}`;
  }

  function renderCategoryDividers({ force = false } = {}) {
    const list = document.getElementById('v40NewswireList');
    if (!list) return;
    const infos = rowInfo();
    const signature = categoryViewSignature(infos);
    const categories = (activeFilter === 'all' ? CATEGORIES : [activeFilter])
      .filter(category => infos.some(info => info.entry.category === category));
    const existing = [...list.querySelectorAll('.v40-newswire-category-divider')];
    const hiddenCorrect = infos.every(info => info.row.hidden === (activeFilter !== 'all' && info.entry.category !== activeFilter));
    const dividerCorrect = existing.length === categories.length && existing.every((divider, index) => divider.dataset.newswireCategoryDivider === categories[index]);
    const empty = list.querySelector('.v40-newswire-filter-empty');
    const needsEmpty = activeFilter !== 'all' && !categories.length;

    if (!force && list.dataset.v40CategoryViewSignature === signature && hiddenCorrect && dividerCorrect && Boolean(empty) === needsEmpty) return;

    existing.forEach(node => node.remove());
    empty?.remove();
    infos.forEach(info => { info.row.hidden = activeFilter !== 'all' && info.entry.category !== activeFilter; });

    categories.forEach(category => {
      const first = infos.find(info => info.entry.category === category && !info.row.hidden);
      if (!first) return;
      const count = categoryEntries(category).length;
      const divider = document.createElement('div');
      divider.className = 'v40-newswire-category-divider';
      divider.dataset.newswireCategoryDivider = category;
      divider.innerHTML = `<strong>${category.toUpperCase()}</strong><span>${count} BULLETIN${count === 1 ? '' : 'S'}</span>`;
      list.insertBefore(divider, first.row);
    });

    if (needsEmpty) {
      const message = document.createElement('div');
      message.className = 'v40-newswire-empty v40-newswire-filter-empty';
      message.textContent = `NO ${activeFilter.toUpperCase()} BULLETINS IN WORKING COPY`;
      list.appendChild(message);
    }

    list.dataset.v40CategoryViewSignature = signature;
  }

  function commitReorder(id) {
    const entry = (state.entries || []).find(item => item.id === id);
    if (!entry) return false;
    return manager.applyEdit(id, { ...entry });
  }

  function moveWithinCategory(id, direction, { announce = true } = {}) {
    if (applyingOrder) return false;
    const entries = state.entries || [];
    const entry = entries.find(item => item.id === id);
    if (!entry) return false;
    const categoryIndices = entries.map((item, index) => item.category === entry.category ? index : -1).filter(index => index >= 0);
    const currentIndex = entries.findIndex(item => item.id === id);
    const currentPosition = categoryIndices.indexOf(currentIndex);
    const targetPosition = currentPosition + direction;
    if (currentPosition < 0 || targetPosition < 0 || targetPosition >= categoryIndices.length) return false;
    const targetIndex = categoryIndices[targetPosition];

    applyingOrder = true;
    try {
      [entries[currentIndex], entries[targetIndex]] = [entries[targetIndex], entries[currentIndex]];
      commitReorder(id);
      if (announce) app.notify?.('NEWSWIRE ORDER UPDATED // LOCAL WORKING COPY');
      return true;
    } finally {
      applyingOrder = false;
    }
  }

  function moveNewEntryToCategoryTop(id) {
    if (applyingOrder) return false;
    const entries = state.entries || [];
    const index = entries.findIndex(item => item.id === id);
    if (index < 0) return false;
    const entry = entries[index];
    const firstCategoryIndex = entries.findIndex(item => item.category === entry.category);
    if (firstCategoryIndex < 0 || firstCategoryIndex === index) return false;

    applyingOrder = true;
    try {
      entries.splice(index, 1);
      entries.splice(firstCategoryIndex, 0, entry);
      commitReorder(id);
      return true;
    } finally {
      applyingOrder = false;
    }
  }

  function enhanceRows() {
    const list = document.getElementById('v40NewswireList');
    if (!list) return;
    list.querySelectorAll('.v40-newswire-entry[data-newswire-id]').forEach(row => {
      const id = row.dataset.newswireId;
      const entry = (state.entries || []).find(item => item.id === id);
      const actions = row.querySelector('.v40-newswire-entry-actions');
      if (!entry || !actions) return;

      let order = actions.querySelector('.v40-newswire-order-actions');
      if (!order) {
        order = document.createElement('div');
        order.className = 'v40-newswire-order-actions';
        order.innerHTML = `<button type="button" data-newswire-up="${id}" title="Move earlier inside ${entry.category.toUpperCase()}">▲ UP</button><button type="button" data-newswire-down="${id}" title="Move later inside ${entry.category.toUpperCase()}">▼ DOWN</button>`;
        actions.insertAdjacentElement('afterbegin', order);
      }

      const position = categoryPosition(entry);
      const count = categoryEntries(entry.category).length;
      const up = order.querySelector('[data-newswire-up]');
      const down = order.querySelector('[data-newswire-down]');
      if (up) up.disabled = position <= 0;
      if (down) down.disabled = position < 0 || position >= count - 1;
    });
  }

  function primeOrDetectNewEntries() {
    if (!state.loaded || !Array.isArray(state.entries)) {
      renderFilterControls();
      renderCategoryDividers();
      return;
    }
    const currentIds = new Set(state.entries.map(entry => entry.id));
    if (!primed) {
      knownIds = currentIds;
      primed = true;
      enhanceRows();
      renderFilterControls();
      renderCategoryDividers();
      return;
    }

    if (!applyingOrder) {
      const fresh = state.entries.filter(entry => !knownIds.has(entry.id));
      if (fresh.length === 1) moveNewEntryToCategoryTop(fresh[0].id);
    }
    knownIds = new Set((state.entries || []).map(entry => entry.id));
    enhanceRows();
    renderFilterControls();
    renderCategoryDividers();
  }

  function bindOrdering() {
    const list = document.getElementById('v40NewswireList');
    if (!list || list.dataset.v40OrderingBound === 'true') return;
    list.dataset.v40OrderingBound = 'true';
    list.addEventListener('click', event => {
      const up = event.target.closest('[data-newswire-up]');
      const down = event.target.closest('[data-newswire-down]');
      if (up) { event.preventDefault(); moveWithinCategory(up.dataset.newswireUp, -1); }
      if (down) { event.preventDefault(); moveWithinCategory(down.dataset.newswireDown, 1); }
    });
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      primeOrDetectNewEntries();
    });
  }

  function observeManager() {
    const root = document.getElementById('v40NewswireManager');
    if (!root || root.dataset.v40OrderingObserver === 'true') return;
    root.dataset.v40OrderingObserver = 'true';
    observer = new MutationObserver(queueRefresh);
    observer.observe(root, { childList: true, subtree: true });
  }

  function selfTest() {
    const failures = [];
    if (!document.getElementById(STYLE_ID)) failures.push('styles');
    if (!document.getElementById('v40NewswireOrderNote')) failures.push('order-note');
    if (document.getElementById('v40NewswireResetBtn') && getComputedStyle(document.getElementById('v40NewswireResetBtn')).color === 'rgba(0, 0, 0, 0)') failures.push('reset-readable');
    const summary = document.getElementById('v40NewswireCategorySummary');
    if (summary && summary.querySelectorAll('[data-newswire-filter]').length !== FILTERS.length) failures.push('category-filters');
    return failures;
  }

  function install() {
    if (!document.getElementById('v40NewswireManager')) return false;
    installStyles();
    installOrderNote();
    bindOrdering();
    bindFilterControls();
    observeManager();
    primeOrDetectNewEntries();
    installed = true;
    return true;
  }

  const baseCommsInit = app.comms.init;
  app.comms.init = function newswireOrderingAwareInit(...args) {
    const result = baseCommsInit.apply(this, args);
    install();
    return result;
  };

  const baseCommsActivate = app.comms.activate;
  app.comms.activate = function newswireOrderingAwareActivate(node, options) {
    const result = baseCommsActivate.call(this, node, options);
    if (node === 'ticker') install();
    return result;
  };

  install();

  app.newswireOrdering = {
    install,
    moveWithinCategory,
    moveNewEntryToCategoryTop,
    setFilter,
    get activeFilter() { return activeFilter; },
    enhanceRows,
    selfTest
  };
})();