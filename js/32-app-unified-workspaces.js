/* ==========================================================================
   RHW UNIFIED WORKSPACE UI
   Shared visual/navigation language for COMMAND, OPERATIONS and COMMS plus
   decision-first COMMAND search, attention focus, deep links and mobile return.
   ========================================================================== */
(function initRhwUnifiedWorkspaceUi() {
  'use strict';
  const app = window.RHWV4;
  if (!app?.command || !app?.operations || !app?.comms || app.unifiedUi) return;

  const WORKSPACES = Object.freeze({
    command: Object.freeze({ index: '01', label: 'COMMAND', sub: 'INVENTORY + YARD + PRODUCTION + LOGISTICS' }),
    operations: Object.freeze({
      index: '02', label: 'OPERATIONS', sub: 'COSTING + ORDER CONTROL', navId: 'operationsNodeNav',
      modules: Object.freeze([
        Object.freeze({ key: 'calculator', index: '01', label: 'ITEM CALCULATOR', sub: 'RECIPE + COSTING' })
      ])
    }),
    comms: Object.freeze({
      index: '03', label: 'COMMS', sub: 'FORUM + NEWSWIRE + ARCHIVE + IDENTITY', navId: 'commsNodeNav',
      modules: Object.freeze([
        Object.freeze({ key: 'forum', index: '01', label: 'FORUM', sub: 'TRANSMISSION COMPOSER' }),
        Object.freeze({ key: 'ticker', index: '02', label: 'NEWSWIRE', sub: 'BULLETIN CONTROL' }),
        Object.freeze({ key: 'drafts', index: '03', label: 'DRAFTS', sub: 'LOCAL + DEVICE ARCHIVE' }),
        Object.freeze({ key: 'senders', index: '04', label: 'SENDERS', sub: 'IDENTITY REGISTRY' })
      ])
    })
  });
  const COMMAND_NODES = Object.freeze(['inventory', 'shipyard', 'production', 'logistics']);
  const COMMAND_FOCUS_KEY = 'rhw-webapp-v4:command-focus';
  const SEARCH_LIMIT = 10;
  const SEARCH_SELECTORS = Object.freeze([
    'tr', 'li', 'article', 'h2', 'h3', 'h4', '.alert-card', '.overview-row',
    '.hull-registry-row', '.shipyard-component-row', '.shipyard-decision-metric',
    '.production-card', '.production-module-card', '.recipe-row', '.remote-route',
    '.market-row', '.supplier-grid > *', '.market-scan-grid > *'
  ]);
  const FOCUS_STOPWORDS = new Set([
    'command', 'inventory', 'shipyard', 'production', 'logistics', 'critical', 'low',
    'threshold', 'breach', 'deficit', 'units', 'next', 'hull', 'needs', 'ready',
    'reserve', 'thin', 'bottleneck', 'asset', 'restore', 'verified', 'telemetry',
    'current', 'open'
  ]);
  const base = {
    commandInit: app.command.init,
    commandActivate: app.command.activate,
    operationsInit: app.operations.init,
    operationsActivate: app.operations.activate,
    commsInit: app.comms.init,
    commsActivate: app.comms.activate
  };
  let syncTimer = null;
  let searchTimer = null;
  let lastHighlight = null;
  let topRaf = 0;

  function esc(value) { return app.util.escape(value); }
  function normalize(value) { return app.util.normalize(value).replace(/[^a-z0-9\s._/-]+/gi, ' '); }
  function compact(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
  function fmt(value) { return app.util.number(Math.max(0, Number(value) || 0)); }

  function installStyles() {
    if (document.getElementById('rhwUnifiedWorkspaceStyle')) return;
    const style = document.createElement('style');
    style.id = 'rhwUnifiedWorkspaceStyle';
    style.dataset.stylesheet = '35-app-interface-cleanup.css';
    document.head.appendChild(style);
    document.documentElement.classList.add('rhw-unified-ui');
  }

  function installWorkspaceTabs() {
    document.querySelectorAll('.app-tabs [data-workspace]').forEach(button => {
      const meta = WORKSPACES[button.dataset.workspace];
      if (!meta) return;
      if (!button.querySelector('.rhw-workspace-index')) {
        const index = document.createElement('b');
        index.className = 'rhw-workspace-index'; index.setAttribute('aria-hidden', 'true'); index.textContent = meta.index;
        button.prepend(index);
      }
      const small = button.querySelector('small'); if (small) small.textContent = meta.sub;
      button.setAttribute('aria-label', `${meta.label}: ${meta.sub}`);
    });
  }

  function bindGridKeys(nav, selector) {
    if (!nav || nav.dataset.rhwGridKeys === 'true') return;
    nav.dataset.rhwGridKeys = 'true';
    nav.addEventListener('keydown', event => {
      const button = event.target.closest(selector);
      if (!button || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
      const buttons = [...nav.querySelectorAll(selector)].filter(item => getComputedStyle(item).display !== 'none');
      const current = buttons.indexOf(button); if (current < 0 || !buttons.length) return;
      event.preventDefault(); let next = current;
      if (event.key === 'Home') next = 0; else if (event.key === 'End') next = buttons.length - 1;
      else if (event.key === 'ArrowLeft') next = (current - 1 + buttons.length) % buttons.length;
      else if (event.key === 'ArrowRight') next = (current + 1) % buttons.length;
      else if (event.key === 'ArrowUp') next = (current - 2 + buttons.length) % buttons.length;
      else if (event.key === 'ArrowDown') next = (current + 2) % buttons.length;
      buttons[next]?.focus();
    });
  }

  function moduleMarkup(workspace, module) {
    const attr = workspace === 'operations' ? 'data-operations-node' : 'data-comms-node';
    return `<button type="button" ${attr}="${esc(module.key)}" data-state="waiting" aria-label="${esc(module.label)}: ${esc(module.sub)}"><span class="rhw-module-index" aria-hidden="true">${esc(module.index)}</span><span class="rhw-module-copy"><strong>${esc(module.label)}</strong><small>${esc(module.sub)}</small></span><b class="rhw-module-state" data-rhw-module-status="${esc(workspace)}:${esc(module.key)}">LOADING</b></button>`;
  }

  function rebuildWorkspaceNav(workspace) {
    const meta = WORKSPACES[workspace]; if (!meta?.navId) return false;
    const nav = document.getElementById(meta.navId); if (!nav) return false;
    nav.classList.add('rhw-module-nav', `rhw-${workspace}-module-nav`); nav.style.setProperty('--rhw-module-count', String(meta.modules.length));
    nav.setAttribute('aria-label', `${meta.label} operational areas`);
    nav.innerHTML = `<div class="workspace-subnav-tabs rhw-module-grid">${meta.modules.map(module => moduleMarkup(workspace, module)).join('')}</div>`;
    nav.dataset.rhwUnified = 'true';
    bindGridKeys(nav, workspace === 'operations' ? '[data-operations-node]' : '[data-comms-node]');
    return true;
  }

  function commandNavReady() {
    const nav = document.getElementById('commandNodeNav'); if (!nav) return false;
    nav.classList.add('rhw-module-nav'); nav.style.setProperty('--rhw-module-count', '4'); return true;
  }

  function setModuleState(workspace, key, text, state = 'waiting') {
    const nav = document.getElementById(WORKSPACES[workspace]?.navId);
    const button = nav?.querySelector(`[data-${workspace === 'operations' ? 'operations' : 'comms'}-node="${key}"]`);
    const status = button?.querySelector('[data-rhw-module-status]'); if (!button || !status) return;
    button.dataset.state = ['critical','low','ok','waiting'].includes(state) ? state : 'waiting'; status.textContent = text;
    const stateKey = workspace === 'operations' ? 'operationsNode' : 'commsNode'; const active = app.state?.[stateKey] === key;
    button.classList.toggle('active', active); button.setAttribute('aria-current', active ? 'page' : 'false');
  }

  function operationStates() {
    const recipeCount = Number(app.operationsCore?.state?.catalog?.meta?.recipeCount) || 0;
    const orders = app.productionOrders?.snapshot?.() || []; const urgent = orders.filter(order => order.priority === 'urgent').length; const high = orders.filter(order => order.priority === 'high').length;
    return {
      calculator: { text: recipeCount ? `${fmt(recipeCount)} RECIPES READY` : 'LOADING RECIPES', state: recipeCount ? 'ok' : 'waiting' },
      orders: { text: urgent ? `${orders.length} ORDERS · ${urgent} URGENT` : high ? `${orders.length} ORDERS · ${high} HIGH` : orders.length ? `${orders.length} ORDERS` : 'QUEUE EMPTY', state: urgent || high ? 'low' : orders.length ? 'ok' : 'waiting' }
    };
  }

  function commsStates() {
    const current = app.state.comms || {}; const drafts = Array.isArray(app.state.drafts) ? app.state.drafts : [];
    const senders = (app.config.senders?.length || 0) + (app.state.localSenders?.length || 0); const manager = app.newswireManager?.state;
    const entries = Array.isArray(manager?.entries) ? manager.entries.length : 0; const hasCurrent = Boolean(String(current.subject || '').trim() || String(current.message || '').trim()); const dirty = Boolean(manager?.dirty);
    return {
      forum: { text: hasCurrent ? 'DRAFT AUTOSAVED' : 'COMPOSER READY', state: 'ok' },
      ticker: { text: dirty ? `${entries} BULLETINS · LOCAL EDITS` : entries ? `${entries} BULLETINS` : 'NEWSWIRE READY', state: dirty ? 'low' : entries ? 'ok' : 'waiting' },
      drafts: { text: drafts.length ? `${drafts.length} SAVED` : 'ARCHIVE EMPTY', state: drafts.length ? 'ok' : 'waiting' },
      senders: { text: senders ? `${senders} IDENTITIES` : 'IDENTITY READY', state: senders ? 'ok' : 'waiting' }
    };
  }

  function syncWorkspaceStatuses() {
    Object.entries(operationStates()).forEach(([key,value]) => setModuleState('operations', key, value.text, value.state));
    Object.entries(commsStates()).forEach(([key,value]) => setModuleState('comms', key, value.text, value.state));
  }

  function installCommandControls() {
    const host = document.getElementById('commandNodeHost'); if (!host) return false;
    if (!document.getElementById('commandControlDeck')) {
      const deck = document.createElement('section'); deck.id = 'commandControlDeck'; deck.className = 'command-control-deck'; deck.setAttribute('aria-label', 'Command search and focus controls');
      deck.innerHTML = `<div class="command-finder"><label class="command-finder-label" for="commandGlobalSearch"><span>COMMAND FINDER</span><span class="command-finder-input-wrap"><input id="commandGlobalSearch" type="search" aria-label="Command finder" autocomplete="off" spellcheck="false" placeholder="Find stock, hull, recipe, route…" /><b class="command-finder-key" aria-hidden="true">/</b></span></label><div id="commandSearchResults" class="command-search-results" role="listbox" aria-label="Command search results" hidden></div></div><div class="command-focus-modes" role="group" aria-label="Command area focus"><button type="button" data-command-focus-mode="all">ALL AREAS</button><button type="button" data-command-focus-mode="attention">NEEDS ATTENTION <b id="commandAttentionCount">0</b></button></div><button type="button" id="commandContextAction" class="command-context-action" hidden></button>`;
      host.insertAdjacentElement('beforebegin', deck);
      const note = document.createElement('div'); note.className = 'command-attention-note'; note.id = 'commandAttentionNote'; note.textContent = 'NO ACTIVE COMMAND ATTENTION ITEMS // ALL MONITORED AREAS REMAIN AVAILABLE'; host.insertAdjacentElement('beforebegin', note);
      const input = document.getElementById('commandGlobalSearch');
      input?.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = window.setTimeout(() => renderCommandSearch(input.value), 90); });
      input?.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); clearCommandSearch(); } else if (event.key === 'Enter') { const first = document.querySelector('#commandSearchResults [data-command-search-result]'); if (first) { event.preventDefault(); first.click(); } } });
      document.getElementById('commandSearchResults')?.addEventListener('click', event => { const button = event.target.closest('[data-command-search-result]'); if (!button) return; const result = searchCommand(button.dataset.searchQuery || input?.value || '')[Number(button.dataset.searchIndex) || 0]; if (result) openSearchResult(result); });
      deck.querySelector('.command-focus-modes')?.addEventListener('click', event => { const button = event.target.closest('[data-command-focus-mode]'); if (button) applyCommandFocus(button.dataset.commandFocusMode, { navigate: true }); });
      document.getElementById('commandContextAction')?.addEventListener('click', event => { const button = event.currentTarget; const node = button.dataset.targetNode; const term = button.dataset.targetTerm || ''; const view = button.dataset.targetView || ''; if (!node) return; if (view === 'manifest') { app.navigate('command', 'inventory'); app.command.activateInventoryView?.('manifest'); requestAnimationFrame(() => document.getElementById('inventoryManifestPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); return; } openCommandTarget(node, term, { revealSearch: true }); });
    }
    if (!document.getElementById('commandTopButton')) { const top = document.createElement('button'); top.type = 'button'; top.id = 'commandTopButton'; top.className = 'command-top-button'; top.textContent = 'COMMAND ↑'; top.setAttribute('aria-label', 'Back to Command navigation'); top.addEventListener('click', () => document.getElementById('commandNodeNav')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); document.body.appendChild(top); }
    if (document.body.dataset.commandPowerKeys !== 'true') { document.body.dataset.commandPowerKeys = 'true'; window.addEventListener('keydown', event => { if (event.key !== '/' || app.state.activeWorkspace !== 'command') return; const target = event.target; if (target?.matches?.('input,textarea,select,[contenteditable="true"]')) return; event.preventDefault(); document.getElementById('commandGlobalSearch')?.focus(); }); window.addEventListener('scroll', scheduleTopVisibility, { passive: true }); window.addEventListener('resize', scheduleTopVisibility, { passive: true }); }
    installAlertDeepLinks(); const storedFocus = app.store.get(COMMAND_FOCUS_KEY, 'all'); applyCommandFocus(storedFocus === 'attention' ? 'attention' : 'all'); return true;
  }

  function installAlertDeepLinks() {
    const panel = document.getElementById('commandGlobalAlerts'); if (!panel || panel.dataset.rhwDeepLinks === 'true') return;
    panel.dataset.rhwDeepLinks = 'true';
    panel.addEventListener('click', event => {
      const target = event.target.closest('[data-priority-jump]');
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      app.commandCompactPolish?.closeAlerts();
      if (target.dataset.priorityAction === 'connection') {
        const details = document.querySelector('.uplink-details');
        if (details) details.open = true;
        document.querySelector('.uplink-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        details?.querySelector('summary')?.focus({ preventScroll: true });
        return;
      }
      const phrase = target.dataset.priorityTarget || `${target.querySelector('strong')?.textContent || ''} ${target.querySelector('small')?.textContent || ''}`;
      openCommandTarget(target.dataset.priorityJump, meaningfulPhrase(phrase));
    }, true);
  }

  function candidateElements(node) {
    const panel = document.querySelector(`[data-command-panel="${node}"]`); if (!panel) return [];
    const seen = new Set(); const results = []; const selector = SEARCH_SELECTORS.join(',');
    [...panel.querySelectorAll(selector)].forEach(element => { if (element.closest('.command-overview-sensor')) return; const text = compact(element.textContent); if (text.length < 3 || text.length > 650) return; const key = normalize(text).slice(0,260); if (!key || seen.has(key)) return; seen.add(key); const strong = element.querySelector?.('strong,.production-title,.hull-registry-name,h3,h4'); const rawLabel = compact(strong?.textContent || element.getAttribute?.('data-label') || text); const label = rawLabel.length > 110 ? `${rawLabel.slice(0,107)}…` : rawLabel; const view = element.closest?.('[data-inventory-panel]')?.dataset.inventoryPanel || ''; results.push({ node, element, text, label, view, normalized: normalize(text) }); });
    return results;
  }

  function queryTerms(value, { meaningful = false } = {}) { return normalize(value).split(/\s+/).filter(Boolean).filter(word => word.length >= 2 && (!meaningful || (!FOCUS_STOPWORDS.has(word) && !/^\d+$/.test(word)))); }
  function scoreCandidate(candidate, query, { meaningful = false } = {}) { const normalizedQuery = normalize(query); const terms = queryTerms(query, { meaningful }); if (!normalizedQuery || !terms.length) return 0; let score = 0; if (candidate.normalized === normalizedQuery) score += 220; if (candidate.normalized.includes(normalizedQuery)) score += 90; for (const term of terms) { if (candidate.normalized.includes(term)) score += 18; if (normalize(candidate.label).includes(term)) score += 16; } const matches = terms.filter(term => candidate.normalized.includes(term)).length; if (matches === terms.length) score += 35; score -= Math.min(20, Math.floor(candidate.text.length / 80)); return score; }
  function searchCommand(query) { const value = compact(query); if (value.length < 2) return []; return COMMAND_NODES.flatMap(candidateElements).map(candidate => ({ ...candidate, score: scoreCandidate(candidate,value) })).filter(candidate => candidate.score > 0).sort((a,b) => b.score - a.score || a.text.length - b.text.length || a.label.localeCompare(b.label)).slice(0,SEARCH_LIMIT); }
  function meaningfulPhrase(value) { const terms = queryTerms(value, { meaningful: true }); return terms.length ? terms.join(' ') : compact(value); }
  function bestTarget(node, query) { const phrase = meaningfulPhrase(query); return candidateElements(node).map(candidate => ({ ...candidate, score: scoreCandidate(candidate,phrase,{ meaningful: true }) })).sort((a,b) => b.score - a.score || a.text.length - b.text.length)[0] || null; }

  function renderCommandSearch(query) {
    const resultsEl = document.getElementById('commandSearchResults'); if (!resultsEl) return; const value = compact(query);
    if (value.length < 2) { resultsEl.hidden = true; resultsEl.innerHTML = ''; return; }
    const results = searchCommand(value); resultsEl.hidden = false;
    resultsEl.innerHTML = results.length ? results.map((result,index) => `<button type="button" class="command-search-result" role="option" data-command-search-result data-search-query="${esc(value)}" data-search-index="${index}"><span class="command-search-node">${esc(result.node.toUpperCase())}${result.view ? ` / ${esc(result.view.toUpperCase())}` : ''}</span><span class="command-search-copy"><strong>${esc(result.label)}</strong><small>${esc(result.text.slice(0,180))}</small></span><b class="command-search-open">OPEN</b></button>`).join('') : '<div class="command-search-empty">NO COMMAND MATCHES // TRY A PRODUCT, MATERIAL, HULL OR ROUTE NAME</div>';
  }
  function clearCommandSearch() { const input = document.getElementById('commandGlobalSearch'); const results = document.getElementById('commandSearchResults'); if (input) input.value = ''; if (results) { results.hidden = true; results.innerHTML = ''; } }
  function highlightElement(element) { if (!element) return; if (lastHighlight && lastHighlight !== element) lastHighlight.classList.remove('rhw-target-highlight'); lastHighlight = element; element.classList.add('rhw-target-highlight'); element.scrollIntoView({ behavior:'smooth', block:'center', inline:'nearest' }); window.setTimeout(() => { element.classList.remove('rhw-target-highlight'); if (lastHighlight === element) lastHighlight = null; }, 4200); }
  function openSearchResult(result) { const input = document.getElementById('commandGlobalSearch'); if (input) input.value = result.label; document.getElementById('commandSearchResults')?.setAttribute('hidden',''); app.navigate('command',result.node); if (result.node === 'inventory' && result.view) app.command.activateInventoryView?.(result.view); window.setTimeout(() => { const candidate = bestTarget(result.node,result.label) || result; highlightElement(candidate.element || result.element); },100); }
  function openCommandTarget(node, query = '', { revealSearch = false } = {}) { const safeNode = COMMAND_NODES.includes(node) ? node : 'inventory'; if (revealSearch && query) { const input = document.getElementById('commandGlobalSearch'); if (input) input.value = query; renderCommandSearch(query); } else document.getElementById('commandSearchResults')?.setAttribute('hidden',''); app.navigate('command',safeNode); window.setTimeout(() => { const target = bestTarget(safeNode,query); if (target) { if (safeNode === 'inventory' && target.view) app.command.activateInventoryView?.(target.view); requestAnimationFrame(() => highlightElement(target.element)); } else document.querySelector(`[data-command-panel="${safeNode}"]`)?.scrollIntoView({ behavior:'smooth',block:'start' }); },110); }

  function commandAttentionCounts() { const counts = Object.fromEntries(COMMAND_NODES.map(node => [node,0])); document.querySelectorAll('#v40PriorityList .command-priority-item').forEach(item => { const node = item.dataset.priorityJump; if (Object.prototype.hasOwnProperty.call(counts,node) && (item.classList.contains('state-critical') || item.classList.contains('state-low'))) counts[node] += 1; }); COMMAND_NODES.forEach(node => { const button = document.querySelector(`#commandNodeNav [data-command-node="${node}"]`); if (button && !counts[node] && ['critical','low'].includes(button.dataset.state)) counts[node] = 1; }); return counts; }
  function syncCommandAttention() { const counts = commandAttentionCounts(); let total = 0, affected = 0; COMMAND_NODES.forEach(node => { const button = document.querySelector(`#commandNodeNav [data-command-node="${node}"]`); const status = button?.querySelector('.command-module-state'); const count = counts[node] || 0; if (count) affected += 1; total += count; if (status) status.dataset.badge = count ? String(count) : button?.dataset.state === 'ok' ? '✓' : '·'; }); const countEl = document.getElementById('commandAttentionCount'); if (countEl) countEl.textContent = String(total); document.body.dataset.commandAttentionEmpty = total ? 'false' : 'true'; document.body.style.setProperty('--rhw-attention-columns',String(Math.max(1,affected))); return { total,affected,counts }; }
  function applyCommandFocus(mode, { navigate = false } = {}) { const safe = mode === 'attention' ? 'attention' : 'all'; const attention = syncCommandAttention(); document.body.dataset.commandFocus = safe; app.store.set(COMMAND_FOCUS_KEY,safe); document.querySelectorAll('[data-command-focus-mode]').forEach(button => { const active = button.dataset.commandFocusMode === safe; button.classList.toggle('active',active); button.setAttribute('aria-pressed',active ? 'true' : 'false'); }); if (safe === 'attention' && navigate && attention.total && !attention.counts[app.state.commandNode]) { const next = COMMAND_NODES.find(node => attention.counts[node] > 0); if (next) app.navigate('command',next); } }

  function hiddenOverviewMeta(node) { const source = document.querySelector(`.command-overview-card[data-command-jump="${node}"]`); return { summary:compact(source?.querySelector('strong')?.textContent), meta:compact(source?.querySelector('span')?.textContent) }; }
  function cleanCrossLinkTerm(value) { return compact(value).replace(/\+\s*[\d,.]+\s*(?:UNITS?)?/gi,'').replace(/\b(?:NEXT HULL|BOTTLENECK|DEFICIT|MIN|CYCLES?)\b/gi,'').replace(/^\/+|\/+$/g,'').trim(); }
  function syncContextAction() {
    const button = document.getElementById('commandContextAction');
    if (!button) return;
    button.hidden = true;
    delete button.dataset.targetNode;
    delete button.dataset.targetTerm;
    delete button.dataset.targetView;
    const node = app.state.commandNode;
    const target = app.command?.contextTarget?.(node);
    if (target?.name) {
      button.textContent = `${node === 'shipyard' ? 'FIND SUPPLY' : 'CHECK STOCK'} // ${target.name}`;
      button.dataset.targetNode = node === 'shipyard' ? 'logistics' : 'inventory';
      button.dataset.targetTerm = target.name;
      button.hidden = false;
    } else if (node === 'logistics') {
      button.textContent = 'OPEN INVENTORY';
      button.dataset.targetNode = 'inventory';
      button.dataset.targetView = 'manifest';
      button.hidden = false;
    }
  }

  function scheduleTopVisibility() { if (topRaf) return; topRaf = requestAnimationFrame(() => { topRaf = 0; syncTopVisibility(); }); }
  function syncTopVisibility() { if (app.state.activeWorkspace !== 'command') { document.body.dataset.commandTopVisible = 'false'; return; } const nav = document.getElementById('commandNodeNav'); if (!nav) return; const rect = nav.getBoundingClientRect(); const show = window.innerWidth <= 760 && (window.scrollY > 420 || rect.bottom < -40); document.body.dataset.commandTopVisible = show ? 'true' : 'false'; }
  function syncAll() { syncWorkspaceStatuses(); if (app.state.activeWorkspace === 'command') { syncCommandAttention(); syncContextAction(); scheduleTopVisibility(); } }

  function selfTest() {
    const failures = [];
    if (!document.getElementById('rhwUnifiedWorkspaceStyle')) failures.push('style');
    if (document.querySelectorAll('.app-tabs .rhw-workspace-index').length !== 3) failures.push('workspace-tabs');
    if (!document.getElementById('commandControlDeck')) failures.push('command-control-deck');
    if (!document.getElementById('commandGlobalSearch')) failures.push('command-search');
    if (!document.getElementById('commandTopButton')) failures.push('command-top-button');
    if (typeof searchCommand !== 'function' || typeof openCommandTarget !== 'function') failures.push('command-search-api');
    if (!document.getElementById('commandNodeNav')?.classList.contains('rhw-module-nav')) failures.push('command-nav');
    if (document.querySelectorAll('#operationsNodeNav .rhw-module-copy').length !== WORKSPACES.operations.modules.length) failures.push('operations-nav');
    if (document.querySelectorAll('#commsNodeNav .rhw-module-copy').length !== WORKSPACES.comms.modules.length) failures.push('comms-nav');
    if (!document.querySelector('#operationsNodeNav [data-rhw-module-status="operations:calculator"]')) failures.push('operations-status');
    if (!document.querySelector('#commsNodeNav [data-rhw-module-status="comms:forum"]')) failures.push('comms-status');
    return failures;
  }

  app.command.init = function unifiedCommandInit(...args) { const result = base.commandInit.apply(this,args); installStyles(); installWorkspaceTabs(); commandNavReady(); installCommandControls(); syncAll(); return result; };
  app.command.activate = function unifiedCommandActivate(node,options) { const result = base.commandActivate.call(this,node,options); requestAnimationFrame(() => { syncCommandAttention(); syncContextAction(); scheduleTopVisibility(); }); return result; };
  app.comms.init = function unifiedCommsInit(...args) { const result = base.commsInit.apply(this,args); rebuildWorkspaceNav('comms'); syncWorkspaceStatuses(); return result; };
  app.comms.activate = function unifiedCommsActivate(node,options) { const result = base.commsActivate.call(this,node,options); requestAnimationFrame(syncWorkspaceStatuses); return result; };
  app.operations.init = async function unifiedOperationsInit(...args) { const result = await base.operationsInit.apply(this,args); rebuildWorkspaceNav('operations'); syncWorkspaceStatuses(); clearInterval(syncTimer); syncTimer = window.setInterval(syncAll,1800); const failures = selfTest(); if (failures.length) throw new Error(`UNIFIED RHW UI SELF TEST FAILED: ${failures.join(', ')}`); return result; };
  app.operations.activate = function unifiedOperationsActivate(node,options) { const result = base.operationsActivate.call(this,node,options); requestAnimationFrame(syncWorkspaceStatuses); return result; };

  app.unifiedUi = { workspaces:WORKSPACES, installStyles, installWorkspaceTabs, rebuildWorkspaceNav, installCommandControls, syncWorkspaceStatuses, searchCommand, openCommandTarget, applyCommandFocus, syncCommandAttention, syncContextAction, selfTest };
})();
