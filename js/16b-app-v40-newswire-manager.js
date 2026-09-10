/* ==========================================================================
   RHW WEB APP · V4.0 NEWSWIRE MANAGER
   Loads the current RHW_Newswire.md into a browser-local working copy and
   supports add/edit/delete plus copy/export. It never publishes to GitHub.
   ========================================================================== */
(function initRhwV4NewswireManager() {
  'use strict';
  const app = window.RHWV4;
  if (!app?.comms || app.newswireManager) return;

  const CATEGORIES = Object.freeze(['market', 'regional', 'security', 'operations', 'corporate']);
  const TONES = Object.freeze(['good', 'warn', 'danger', 'remote', 'lore', 'muted']);
  const DRAFT_KEY = app.config.storageKeys.newswireManagerDraft || 'rhw-webapp-v4:newswire-manager-draft';
  const SOURCE_URL = typeof DASHBOARD_CONFIG !== 'undefined' && DASHBOARD_CONFIG?.newswireUrl
    ? DASHBOARD_CONFIG.newswireUrl
    : './assets/RHW_Newswire.md';
  const STYLE_ID = 'rhwV40NewswireManagerStyle';
  const state = {
    entries: [], baseEntries: [], sourceText: '', baseHash: '', editingId: '',
    dirty: false, sourceMode: 'loading', loaded: false, loadError: '',
    draftSourceChanged: false, draftSavedAt: 0, sourceFetchedAt: null
  };

  const esc = value => app.util.escape(String(value ?? ''));
  const cloneEntries = entries => entries.map(entry => ({ ...entry }));
  const slug = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const hashText = value => {
    let hash = 2166136261;
    for (const char of String(value || '')) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };
  const makeId = (entry, index = Date.now()) => `nw-${index}-${hashText(`${entry.category}|${entry.tag}|${entry.message}`)}`;

  function normalizeTag(value) {
    return String(value || '').replace(/[\[\]|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  }
  function normalizeMessage(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  }
  function normalizeEntry(raw = {}, index = Date.now()) {
    const category = CATEGORIES.includes(slug(raw.category)) ? slug(raw.category) : 'operations';
    const tone = TONES.includes(String(raw.tone || '').toLowerCase()) ? String(raw.tone).toLowerCase() : 'lore';
    const tag = normalizeTag(raw.tag || 'RHW OPERATIONS');
    const message = normalizeMessage(raw.message || raw.text || '');
    return { id: String(raw.id || makeId({ category, tone, tag, message }, index)), category, tone, tag, message };
  }

  function parseSource(text) {
    const entries = [];
    let category = '';
    let fence = '';
    String(text || '').split('\n').forEach(rawLine => {
      const line = rawLine.trim();
      const fenceMatch = line.match(/^(```+|~~~+)/);
      if (fenceMatch) {
        if (!fence) fence = fenceMatch[1].slice(0, 3);
        else if (line.startsWith(fence)) fence = '';
        return;
      }
      if (fence) return;
      const header = line.match(/^##\s+(.+?)\s*$/);
      if (header) {
        const next = slug(header[1]);
        category = CATEGORIES.includes(next) ? next : '';
        return;
      }
      if (!category || !line.startsWith('-')) return;
      const match = line.match(/^-\s*\[([^|\]]+?)\s*\|\s*([A-Za-z]+)\s*\]\s*(.+)$/);
      if (!match) return;
      const entry = normalizeEntry({ category, tag: match[1], tone: match[2], message: match[3] }, entries.length + 1);
      if (entry.tag && entry.message) entries.push(entry);
    });
    return entries;
  }

  function serializeSource(entries = state.entries) {
    const lines = [
      '# RHW Industrial Newswire', '',
      'Edit the bulletins below without changing `index.html`.', '',
      'Format:', '', '```text', '## category', '- [TAG | tone] MESSAGE', '```', '',
      'Allowed tones: `good`, `warn`, `danger`, `remote`, `lore`, `muted`.',
      'The dashboard safely merges these entries with its built-in fallback messages.', ''
    ];
    CATEGORIES.forEach((category, categoryIndex) => {
      lines.push(`## ${category}`);
      entries.filter(entry => entry.category === category).forEach(entry => {
        lines.push(`- [${normalizeTag(entry.tag)} | ${TONES.includes(entry.tone) ? entry.tone : 'lore'}] ${normalizeMessage(entry.message)}`);
      });
      if (categoryIndex < CATEGORIES.length - 1) lines.push('');
    });
    return `${lines.join('\n').trimEnd()}\n`;
  }

  function entriesSignature(entries = state.entries) {
    return entries.map(entry => `${entry.category}\u0000${entry.tone}\u0000${entry.tag}\u0000${entry.message}`).join('\u0001');
  }

  function fallbackEntries() {
    try {
      if (typeof NEWSWIRE_POOLS === 'undefined') return [];
      const entries = [];
      CATEGORIES.forEach(category => {
        (NEWSWIRE_POOLS[category] || []).forEach(message => entries.push(normalizeEntry({
          category, tone: message.tone, tag: message.tag, message: message.text
        }, entries.length + 1)));
      });
      return entries;
    } catch {
      return [];
    }
  }

  function readLocalDraft(baseHash = state.baseHash) {
    const draft = app.store.get(DRAFT_KEY, null);
    if (!draft || !Array.isArray(draft.entries)) return null;
    return {
      entries: draft.entries.map((entry, index) => normalizeEntry(entry, index + 1)),
      sourceChanged: Boolean(draft.baseHash && draft.baseHash !== baseHash),
      savedAt: Number(draft.savedAt) || 0
    };
  }

  function draftPayload() {
    const draft = app.store.get(DRAFT_KEY, null);
    return draft && Array.isArray(draft.entries) ? draft : null;
  }

  function saveLocalDraft() {
    document.documentElement.dataset.rhwNewswireDirty = state.dirty ? 'true' : 'false';
    if (!state.dirty) {
      state.draftSourceChanged = false;
      state.draftSavedAt = 0;
      return app.store.remove(DRAFT_KEY);
    }
    state.draftSavedAt = Date.now();
    return app.store.set(DRAFT_KEY, {
      version: 1,
      baseHash: state.baseHash,
      entries: cloneEntries(state.entries),
      savedAt: state.draftSavedAt
    });
  }

  function clearLocalDraft() {
    state.draftSourceChanged = false;
    state.draftSavedAt = 0;
    document.documentElement.dataset.rhwNewswireDirty = 'false';
    return app.store.remove(DRAFT_KEY);
  }

  function restoreDraft(raw) {
    if (!raw || !Array.isArray(raw.entries)) throw new Error('INVALID NEWSWIRE DRAFT');
    const normalized = {
      version: 1,
      baseHash: String(raw.baseHash || ''),
      entries: raw.entries.map((entry, index) => normalizeEntry(entry, index + 1)),
      savedAt: Number(raw.savedAt) || Date.now()
    };
    if (!app.store.set(DRAFT_KEY, normalized)) throw new Error('NEWSWIRE DRAFT COULD NOT BE RESTORED');
    if (state.loaded) {
      state.entries = cloneEntries(normalized.entries);
      state.draftSourceChanged = Boolean(normalized.baseHash && normalized.baseHash !== state.baseHash);
      state.draftSavedAt = normalized.savedAt;
      state.dirty = entriesSignature(state.entries) !== entriesSignature(state.baseEntries);
      document.documentElement.dataset.rhwNewswireDirty = state.dirty ? 'true' : 'false';
      renderManager();
    }
    return normalized;
  }

  function recalcDirty() {
    state.dirty = entriesSignature(state.entries) !== entriesSignature(state.baseEntries);
    saveLocalDraft();
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.dataset.stylesheet = '35-app-interface-cleanup.css';
    document.head.appendChild(style);
  }

  function managerMarkup() {
    return `<section class="v40-newswire-manager" id="v40NewswireManager">
      <div class="v40-newswire-manager-head"><div><small>CURRENT / WORKING BULLETINS</small><strong id="v40NewswireManagerStatus" class="v40-newswire-manager-status" data-tone="muted">LOADING RHW_NEWSWIRE.MD</strong></div><div class="v40-newswire-manager-head-actions"><button type="button" class="primary" id="v40NewswireNewBtn">+ NEW BULLETIN</button><button type="button" id="v40NewswireReloadBtn">RELOAD CURRENT FILE</button></div></div>
      <div class="v40-newswire-publish-banner" id="v40NewswirePublishBanner" data-tone="clean"><strong id="v40NewswirePublishState">CURRENT FILE // READ ONLY</strong><span id="v40NewswirePublishHint">NOTHING ON THIS PAGE IS PUBLISHED AUTOMATICALLY. ADD / EDIT / DELETE CREATES A LOCAL WORKING COPY ONLY.</span></div>
      <div class="v40-newswire-recovery-status" id="v40NewswireRecoveryStatus">
        <div><small>SOURCE</small><strong id="v40NewswireSourceState">LOADING</strong></div>
        <div><small>LOCAL RECOVERY</small><strong id="v40NewswireRecoveryState">CHECKING</strong></div>
        <div><small>OUTPUT</small><strong id="v40NewswireOutputState">NOT PUBLISHED</strong></div>
      </div>
      <div class="v40-newswire-category-summary" id="v40NewswireCategorySummary"></div>
      <div class="v40-newswire-list" id="v40NewswireList"><div class="v40-newswire-empty">LOADING CURRENT BULLETINS…</div></div>
    </section>`;
  }

  function workflowMarkup() {
    return `<nav class="v40-newswire-workflow" id="v40NewswireWorkflow" aria-label="Newswire workflow">
      <button type="button" data-newswire-jump="list" aria-current="step"><span>01</span><small>REVIEW</small><strong>BULLETINS</strong></button>
      <button type="button" data-newswire-jump="editor"><span>02</span><small>CREATE / EDIT</small><strong>EDITOR</strong></button>
      <button type="button" data-newswire-jump="output"><span>03</span><small>COPY / EXPORT</small><strong>WORKING COPY</strong></button>
    </nav>`;
  }

  function fileMarkup() {
    return `<section class="v40-newswire-file" id="v40NewswireFilePanel">
      <div class="v40-newswire-file-head"><div><small>WORKING COPY OUTPUT</small><strong>UPDATED RHW_NEWSWIRE.MD</strong></div><div class="v40-newswire-file-state"><small>NOT PUBLISHED AUTOMATICALLY</small><strong id="v40NewswireFileState">CURRENT SOURCE // NO LOCAL EDITS</strong></div></div>
      <div class="v40-newswire-file-actions"><button type="button" class="primary" id="v40NewswireCopyFileBtn">COPY UPDATED NEWSWIRE</button><button type="button" id="v40NewswireExportBtn">EXPORT RHW_NEWSWIRE.MD</button><button type="button" id="v40NewswireResetBtn">RESET TO CURRENT FILE</button></div>
      <details><summary>SHOW COMPLETE MARKDOWN SOURCE</summary><textarea id="v40NewswireFileOutput" readonly spellcheck="false"></textarea></details>
    </section>`;
  }

  function updateLabels() {
    const panel = document.querySelector('[data-comms-panel="ticker"] .v40-tool-panel');
    const title = panel?.querySelector('.comms-panel-head strong');
    if (title) title.textContent = 'BMM INDUSTRIAL NEWSWIRE MANAGER';
    const explainer = panel?.querySelector('.v40-newswire-explainer span');
    if (explainer) explainer.textContent = 'LOADS THE CURRENT RHW NEWSWIRE FILE INTO A LOCAL WORKING COPY. ADD, EDIT OR DELETE BULLETINS, THEN COPY OR EXPORT THE COMPLETE UPDATED FILE. CHANGES ARE NOT PUBLISHED AUTOMATICALLY.';
    const tab = document.querySelector('#commsNodeNav button[data-comms-node="ticker"] small');
    if (tab) tab.textContent = 'NEWSWIRE MANAGER';
    if (document.body?.dataset?.commsNode === 'ticker') {
      const workspaceTitle = document.getElementById('commsWorkspaceTitle');
      const workspaceSubtitle = document.getElementById('commsWorkspaceSubtitle');
      if (workspaceTitle) workspaceTitle.textContent = 'BMM INDUSTRIAL NEWSWIRE MANAGER';
      if (workspaceSubtitle) workspaceSubtitle.textContent = 'CURRENT BULLETINS // ADD + EDIT + DELETE // EXPORT UPDATED SOURCE';
    }
  }

  function enhanceMarkup() {
    const panel = document.querySelector('[data-comms-panel="ticker"] .v40-tool-panel');
    if (!panel || panel.dataset.v40NewswireManager === 'true') return false;
    panel.dataset.v40NewswireManager = 'true';
    installStyles();
    updateLabels();

    const explainer = panel.querySelector('.v40-newswire-explainer');
    explainer?.insertAdjacentHTML('afterend', `${workflowMarkup()}${managerMarkup()}`);
    const grid = panel.querySelector('.v40-tool-grid');
    grid?.insertAdjacentHTML('beforebegin', '<div class="v40-newswire-editor-head" id="v40NewswireEditorPanel"><div><small>ENTRY EDITOR</small><strong id="v40NewswireEditorMode" class="v40-newswire-editor-state">ADD NEW BULLETIN</strong></div><small>LIVE PREVIEW + SOURCE BLOCK BELOW</small></div>');

    const actions = panel.querySelector('.comms-actions');
    if (actions) {
      const copy = document.getElementById('v40CopyTickerBtn');
      if (copy) { copy.classList.remove('comms-primary'); copy.querySelector('span').textContent = 'COPY ENTRY BLOCK'; }
      actions.insertAdjacentHTML('afterbegin', '<button class="comms-primary" type="button" id="v40NewswireSaveBtn"><span>ADD TO NEWSWIRE</span></button><button type="button" id="v40NewswireCancelEditBtn" hidden><span>CANCEL EDIT</span></button>');
    }
    panel.insertAdjacentHTML('beforeend', fileMarkup());
    bindManager();
    return true;
  }

  function statusText() {
    if (state.sourceMode === 'cache') return [`${state.entries.length} BULLETINS // CACHED SOURCE // RELOAD ONLINE BEFORE REVIEW HANDOFF`, 'warn'];
    if (state.dirty && state.draftSourceChanged) return [`${state.entries.length} BULLETINS // RECOVERED LOCAL EDITS // SOURCE CHANGED`, 'warn'];
    if (state.dirty) return [`${state.entries.length} BULLETINS // LOCAL EDITS // NOT PUBLISHED`, 'dirty'];
    if (!state.loaded) return ['LOADING RHW_NEWSWIRE.MD', 'muted'];
    if (state.sourceMode === 'fallback') return [`${state.entries.length} BULLETINS // FALLBACK SOURCE // REPOSITORY FILE UNAVAILABLE`, 'warn'];
    return [`${state.entries.length} CURRENT BULLETINS // REPOSITORY SOURCE LOADED`, 'good'];
  }

  function publishBannerCopy() {
    if (state.sourceMode === 'cache') return ['CACHED SOURCE // LOCAL WORKING COPY', 'FRESHNESS IS UNVERIFIED. EDITS STAY LOCAL; RELOAD ONLINE BEFORE CREATING A REVIEW PACKAGE.', 'warn'];
    if (state.dirty && state.draftSourceChanged) return ['RECOVERED DRAFT // SOURCE CHANGED', 'THE REPOSITORY FILE CHANGED SINCE THIS LOCAL DRAFT WAS SAVED. REVIEW THE RECOVERED BULLETINS BEFORE COPYING OR EXPORTING.', 'warn'];
    if (state.dirty) return ['LOCAL EDITS // SAVED IN THIS BROWSER', 'YOUR WORKING COPY SURVIVES TAB AND APP RESTARTS, BUT IS NOT PUBLISHED. USE COPY UPDATED NEWSWIRE OR EXPORT RHW_NEWSWIRE.MD TO PUBLISH.', 'dirty'];
    if (!state.loaded) return ['LOADING CURRENT SOURCE', 'THE MANAGER HAS NOT LOADED A SOURCE FILE YET.', 'clean'];
    if (state.sourceMode === 'fallback') return ['FALLBACK SOURCE // NOT PUBLISHED', 'THE REPOSITORY FILE COULD NOT BE LOADED. ANY CHANGES HERE ARE LOCAL ONLY; RELOAD THE CURRENT FILE BEFORE EXPORTING.', 'warn'];
    return ['CURRENT FILE // READ ONLY', 'NOTHING IS PUBLISHED AUTOMATICALLY. ADD / EDIT / DELETE WILL CREATE A LOCAL WORKING COPY AND THIS BANNER WILL TURN GOLD.', 'clean'];
  }

  function renderPublishBanner() {
    const banner = document.getElementById('v40NewswirePublishBanner');
    const label = document.getElementById('v40NewswirePublishState');
    const hint = document.getElementById('v40NewswirePublishHint');
    if (!banner || !label || !hint) return;
    const [labelText, hintText, tone] = publishBannerCopy();
    banner.dataset.tone = tone;
    label.textContent = labelText;
    hint.textContent = hintText;
  }

  function savedTimeLabel() {
    if (!state.draftSavedAt) return 'READY';
    try {
      return `SAVED ${new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' }).format(state.draftSavedAt)}`;
    } catch {
      return 'SAVED LOCALLY';
    }
  }

  function renderRecoveryStatus() {
    const source = document.getElementById('v40NewswireSourceState');
    const recovery = document.getElementById('v40NewswireRecoveryState');
    const output = document.getElementById('v40NewswireOutputState');
    const file = document.getElementById('v40NewswireFileState');
    if (source) source.textContent = !state.loaded ? 'LOADING' : state.sourceMode === 'cache' ? 'CACHED FILE' : state.sourceMode === 'fallback' ? 'FALLBACK' : 'REPOSITORY FILE';
    if (recovery) recovery.textContent = state.dirty ? savedTimeLabel() : 'READY';
    if (output) output.textContent = state.dirty ? 'LOCAL ONLY' : 'NOT PUBLISHED';
    if (file) file.textContent = state.dirty ? `${state.entries.length} BULLETINS // ${savedTimeLabel()}` : `${state.entries.length} BULLETINS // CURRENT SOURCE`;
    const reset = document.getElementById('v40NewswireResetBtn');
    if (reset) reset.disabled = !state.dirty;
  }

  function renderCounters() {
    const { tag, message } = editorElements();
    const tagCount = document.getElementById('v40TickerTagCount');
    const messageCount = document.getElementById('v40TickerMessageCount');
    if (tagCount) tagCount.textContent = `${String(tag?.value || '').length} / 40`;
    if (messageCount) messageCount.textContent = `${String(message?.value || '').length} / 240`;
  }

  function renderSummary() {
    const target = document.getElementById('v40NewswireCategorySummary');
    if (!target) return;
    target.innerHTML = CATEGORIES.map(category => `<span>${category.toUpperCase()} // ${state.entries.filter(entry => entry.category === category).length}</span>`).join('');
  }

  function renderList() {
    const target = document.getElementById('v40NewswireList');
    if (!target) return;
    if (!state.entries.length) {
      target.innerHTML = '<div class="v40-newswire-empty">NO BULLETINS IN WORKING COPY</div>';
      return;
    }
    target.innerHTML = state.entries.map(entry => `<article class="v40-newswire-entry${entry.id === state.editingId ? ' editing' : ''}" data-newswire-id="${esc(entry.id)}">
      <div class="v40-newswire-entry-id"><div class="v40-newswire-entry-meta"><span>${esc(entry.category.toUpperCase())}</span><span data-tone="${esc(entry.tone)}">${esc(entry.tone.toUpperCase())}</span></div><strong>${esc(entry.tag)}</strong></div>
      <p>${esc(entry.message)}</p>
      <div class="v40-newswire-entry-actions"><button type="button" data-newswire-edit="${esc(entry.id)}">EDIT</button><button type="button" data-newswire-delete="${esc(entry.id)}">DELETE</button></div>
    </article>`).join('');
  }

  function renderEditorMode() {
    const label = document.getElementById('v40NewswireEditorMode');
    const save = document.getElementById('v40NewswireSaveBtn');
    const cancel = document.getElementById('v40NewswireCancelEditBtn');
    if (label) label.textContent = state.editingId ? 'EDIT EXISTING BULLETIN' : 'ADD NEW BULLETIN';
    if (save?.querySelector('span')) save.querySelector('span').textContent = state.editingId ? 'SAVE CHANGES' : 'ADD TO NEWSWIRE';
    if (cancel) cancel.hidden = !state.editingId;
    renderCounters();
  }

  function renderFileOutput() {
    const output = document.getElementById('v40NewswireFileOutput');
    if (output) output.value = serializeSource();
  }

  function renderManager() {
    const status = document.getElementById('v40NewswireManagerStatus');
    const [text, tone] = statusText();
    if (status) { status.textContent = text; status.dataset.tone = tone; }
    renderPublishBanner();
    renderRecoveryStatus();
    renderSummary();
    renderList();
    renderEditorMode();
    renderFileOutput();
  }

  function editorElements() {
    return {
      category: document.getElementById('v40TickerCategory'), tone: document.getElementById('v40TickerTone'),
      tag: document.getElementById('v40TickerTag'), message: document.getElementById('v40TickerMessage')
    };
  }

  function syncTickerPreview() {
    const { category, tone, tag, message } = editorElements();
    [category, tone].forEach(element => element?.dispatchEvent(new Event('change', { bubbles: true })));
    [tag, message].forEach(element => element?.dispatchEvent(new Event('input', { bubbles: true })));
    renderCounters();
  }

  function readEditor() {
    const { category, tone, tag, message } = editorElements();
    return normalizeEntry({ category: category?.value, tone: tone?.value, tag: tag?.value, message: message?.value });
  }

  function setEditor(entry) {
    const fields = editorElements();
    if (fields.category) fields.category.value = entry.category;
    if (fields.tone) fields.tone.value = entry.tone;
    if (fields.tag) fields.tag.value = entry.tag;
    if (fields.message) fields.message.value = entry.message;
    syncTickerPreview();
  }

  function clearEditor({ keepRouting = true } = {}) {
    const fields = editorElements();
    if (!keepRouting) {
      if (fields.category) fields.category.value = 'operations';
      if (fields.tone) fields.tone.value = 'good';
      if (fields.tag) fields.tag.value = 'RHW OPERATIONS';
    }
    if (fields.message) fields.message.value = '';
    state.editingId = '';
    syncTickerPreview();
    renderEditorMode();
    renderList();
  }

  function applyAdd(entry) {
    const normalized = normalizeEntry(entry, state.entries.length + Date.now());
    if (!normalized.tag || !normalized.message) return false;
    state.entries.push(normalized);
    recalcDirty();
    renderManager();
    return true;
  }

  function applyEdit(id, entry) {
    const index = state.entries.findIndex(item => item.id === id);
    if (index < 0) return false;
    const normalized = normalizeEntry({ ...entry, id }, index + 1);
    if (!normalized.tag || !normalized.message) return false;
    state.entries[index] = normalized;
    recalcDirty();
    renderManager();
    return true;
  }

  function applyDelete(id) {
    const index = state.entries.findIndex(item => item.id === id);
    if (index < 0) return false;
    state.entries.splice(index, 1);
    if (state.editingId === id) state.editingId = '';
    recalcDirty();
    renderManager();
    return true;
  }

  function beginEdit(id) {
    const entry = state.entries.find(item => item.id === id);
    if (!entry) return;
    state.editingId = id;
    setEditor(entry);
    renderEditorMode();
    renderList();
    jumpToWorkflow('editor');
  }

  function saveEditor() {
    const entry = readEditor();
    if (!entry.tag || !entry.message) {
      app.notify('ENTER A NEWSWIRE TAG AND MESSAGE FIRST', 'warn');
      return;
    }
    const editing = state.editingId;
    const ok = editing ? applyEdit(editing, entry) : applyAdd(entry);
    if (!ok) { app.notify('NEWSWIRE ENTRY COULD NOT BE SAVED', 'warn'); return; }
    app.notify(editing ? 'NEWSWIRE ENTRY UPDATED // LOCAL WORKING COPY' : 'NEWSWIRE ENTRY ADDED // LOCAL WORKING COPY');
    clearEditor({ keepRouting: true });
    jumpToWorkflow('list');
  }

  function jumpToWorkflow(step, { smooth = true } = {}) {
    const targets = {
      list: document.getElementById('v40NewswireManager'),
      editor: document.getElementById('v40NewswireEditorPanel'),
      output: document.getElementById('v40NewswireFilePanel')
    };
    const target = targets[step] || targets.list;
    document.querySelectorAll('[data-newswire-jump]').forEach(button => {
      if (button.dataset.newswireJump === step) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    target?.scrollIntoView?.({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  }

  function resetWorkingCopy({ announce = true } = {}) {
    state.entries = cloneEntries(state.baseEntries);
    state.editingId = '';
    state.dirty = false;
    clearLocalDraft();
    clearEditor({ keepRouting: true });
    renderManager();
    if (announce) app.notify('NEWSWIRE WORKING COPY RESET TO CURRENT FILE', 'warn');
  }

  function exportSource() {
    const blob = new Blob([serializeSource()], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'RHW_Newswire.md';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    app.notify('UPDATED RHW_NEWSWIRE.MD EXPORTED');
  }

  async function copySource() {
    const copied = await app.util.copy(serializeSource());
    app.notify(copied ? 'UPDATED NEWSWIRE COPIED' : 'COPY FAILED', copied ? 'good' : 'warn');
  }

  function applyLoadedSource(sourceText, mode = 'repository') {
    const parsed = parseSource(sourceText);
    const fallback = mode === 'fallback' && !parsed.length ? fallbackEntries() : [];
    const loadedEntries = parsed.length ? parsed : fallback;
    state.sourceText = sourceText || serializeSource(loadedEntries);
    state.baseHash = hashText(state.sourceText);
    state.baseEntries = cloneEntries(loadedEntries);
    const draft = readLocalDraft(state.baseHash);
    state.entries = draft ? cloneEntries(draft.entries) : cloneEntries(loadedEntries);
    state.sourceMode = mode;
    state.loaded = true;
    state.loadError = '';
    state.editingId = '';
    state.draftSourceChanged = Boolean(draft?.sourceChanged);
    state.draftSavedAt = Number(draft?.savedAt) || 0;
    state.dirty = entriesSignature(state.entries) !== entriesSignature(state.baseEntries);
    document.documentElement.dataset.rhwNewswireDirty = state.dirty ? 'true' : 'false';
    renderManager();
  }

  async function loadCurrentSource({ force = false } = {}) {
    if (force && state.dirty && !window.confirm('Discard local Newswire edits and reload the current repository file?')) return;
    state.loaded = false;
    state.sourceMode = 'loading';
    renderManager();
    try {
      const response = await fetchWithTimeout(SOURCE_URL, { headers: { Accept: 'text/markdown,text/plain;q=0.9,*/*;q=0.1' }, cache: 'no-store' }, 10000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const sourceText = await response.text();
      const parsed = parseSource(sourceText);
      if (!parsed.length) throw new Error('NO BULLETINS PARSED');
      const cached = response.headers.get('X-RHW-Source') === 'cache' || (navigator.serviceWorker?.controller && response.headers.get('X-RHW-Source') !== 'network');
      state.sourceFetchedAt = response.headers.get('X-RHW-Fetched-At') || (cached ? null : new Date().toISOString());
      if (force && !cached) clearLocalDraft();
      applyLoadedSource(sourceText, cached ? 'cache' : 'repository');
    } catch (error) {
      state.loadError = String(error?.message || error || 'UNKNOWN SOURCE ERROR');
      const entries = fallbackEntries();
      state.sourceFetchedAt = null;
      applyLoadedSource(serializeSource(entries), 'fallback');
    }
  }

  function bindManager() {
    const panel = document.getElementById('v40NewswireManager')?.closest('.v40-tool-panel');
    if (!panel || panel.dataset.v40NewswireManagerBound === 'true') return;
    panel.dataset.v40NewswireManagerBound = 'true';
    panel.querySelectorAll('[data-newswire-jump]').forEach(button => button.addEventListener('click', () => jumpToWorkflow(button.dataset.newswireJump)));
    document.getElementById('v40NewswireNewBtn')?.addEventListener('click', () => {
      clearEditor({ keepRouting: true });
      jumpToWorkflow('editor');
      document.getElementById('v40TickerMessage')?.focus?.({ preventScroll: true });
    });
    document.getElementById('v40NewswireSaveBtn')?.addEventListener('click', saveEditor);
    document.getElementById('v40NewswireCancelEditBtn')?.addEventListener('click', () => clearEditor({ keepRouting: true }));
    document.getElementById('v40NewswireReloadBtn')?.addEventListener('click', () => loadCurrentSource({ force: true }));
    document.getElementById('v40NewswireResetBtn')?.addEventListener('click', () => {
      if (state.dirty && !window.confirm('Discard all local Newswire edits?')) return;
      resetWorkingCopy();
    });
    document.getElementById('v40NewswireCopyFileBtn')?.addEventListener('click', copySource);
    document.getElementById('v40NewswireExportBtn')?.addEventListener('click', exportSource);
    ['v40TickerTag', 'v40TickerMessage'].forEach(id => document.getElementById(id)?.addEventListener('input', renderCounters));
    document.getElementById('v40NewswireList')?.addEventListener('click', event => {
      const edit = event.target.closest('[data-newswire-edit]');
      const remove = event.target.closest('[data-newswire-delete]');
      if (edit) beginEdit(edit.dataset.newswireEdit);
      if (remove) {
        const entry = state.entries.find(item => item.id === remove.dataset.newswireDelete);
        if (entry && window.confirm(`Delete “${entry.tag}” from the local Newswire working copy?`)) {
          applyDelete(entry.id);
          app.notify('NEWSWIRE ENTRY DELETED // LOCAL WORKING COPY', 'warn');
        }
      }
    });
  }

  function selfTest() {
    const failures = [];
    const sample = '# RHW Industrial Newswire\n\n## market\n- [TEST DESK | good] FIRST MESSAGE\n\n## operations\n- [RHW OPS | warn] SECOND MESSAGE\n';
    const parsed = parseSource(sample);
    if (parsed.length !== 2 || parsed[0].category !== 'market' || parsed[1].tone !== 'warn') failures.push('parse');
    const roundTrip = parseSource(serializeSource(parsed));
    if (roundTrip.length !== 2 || roundTrip[0].tag !== 'TEST DESK' || roundTrip[1].message !== 'SECOND MESSAGE') failures.push('serialize');
    const copy = cloneEntries(parsed);
    copy.push(normalizeEntry({ category: 'security', tone: 'danger', tag: 'TEST', message: 'THIRD MESSAGE' }, 3));
    if (copy.length !== 3 || parsed.length !== 2) failures.push('add');
    copy[0] = normalizeEntry({ ...copy[0], message: 'EDITED MESSAGE' }, 1);
    if (copy[0].message !== 'EDITED MESSAGE') failures.push('edit');
    copy.splice(1, 1);
    if (copy.length !== 2) failures.push('delete');
    const dirtyBanner = (() => {
      const original = state.dirty;
      const sourceMode = state.sourceMode;
      state.sourceMode = 'repository';
      state.dirty = true;
      const copyValue = publishBannerCopy();
      state.dirty = original;
      state.sourceMode = sourceMode;
      return copyValue;
    })();
    if (!dirtyBanner[0].includes('LOCAL EDITS') || !dirtyBanner[1].includes('NOT PUBLISHED')) failures.push('publish-banner-copy');
    ['v40NewswireWorkflow', 'v40NewswireManager', 'v40NewswirePublishBanner', 'v40NewswirePublishState', 'v40NewswireRecoveryStatus', 'v40NewswireList', 'v40NewswireEditorPanel', 'v40NewswireSaveBtn', 'v40NewswireCopyFileBtn', 'v40NewswireExportBtn', 'v40NewswireFileOutput'].forEach(id => {
      if (!document.getElementById(id)) failures.push(`missing:${id}`);
    });
    return failures;
  }

  function enhance() {
    if (!enhanceMarkup() && !document.getElementById('v40NewswireManager')) return false;
    updateLabels();
    const failures = selfTest();
    if (failures.length) throw new Error(`V4 NEWSWIRE MANAGER SELF TEST FAILED: ${failures.join(', ')}`);
    if (!state.loaded) loadCurrentSource();
    return true;
  }

  const baseInit = app.comms.init;
  app.comms.init = function newswireManagerAwareInit(...args) {
    const result = baseInit.apply(this, args);
    enhance();
    return result;
  };

  const baseActivate = app.comms.activate;
  app.comms.activate = function newswireManagerAwareActivate(node, options) {
    const result = baseActivate.call(this, node, options);
    if (node === 'ticker') updateLabels();
    return result;
  };

  window.addEventListener('beforeunload', event => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  app.newswireManager = {
    state, enhance, parseSource, serializeSource, loadCurrentSource, applyLoadedSource, jumpToWorkflow,
    applyAdd, applyEdit, applyDelete, beginEdit, resetWorkingCopy, draftPayload, restoreDraft, selfTest
  };
})();
