/* ==========================================================================
   RHW WEB APP · V4.0.2 QUALITY-OF-LIFE TOOLS
   Explicit calculator price profiles.
   ========================================================================== */
(function initRhwV402Qol() {
  'use strict';
  const app = window.RHWV4;
  const core = app?.operationsCore;
  if (!app || !core || app.qol) return;

  const PROFILE_KEY = app.config.storageKeys.calculatorPriceProfiles || 'rhw-webapp-v4:calculator-price-profiles';
  let operationsObserver = null;
  let profileStatus = ['SAVED PROFILES ARE OPTIONAL // NOTHING IS LOADED AUTOMATICALLY', 'muted'];

  const esc = value => app.util.escape(String(value ?? ''));
  const normalize = value => app.util.normalize(String(value ?? ''));
  function profiles() {
    const raw = app.store.get(PROFILE_KEY, []);
    if (!Array.isArray(raw)) return [];
    return raw.filter(profile => profile && profile.id && profile.name && profile.prices && typeof profile.prices === 'object');
  }

  function saveProfiles(next) {
    app.store.set(PROFILE_KEY, next.slice(0, 24));
  }

  function currentPriceInputs() {
    return [...document.querySelectorAll('#workspaceOperations [data-material-price]')];
  }

  function setProfileStatus(text, tone = 'muted') {
    profileStatus = [text, tone];
    const node = document.getElementById('opsPriceProfileStatus');
    if (node) { node.textContent = text; node.dataset.tone = tone; }
  }

  function profilePanelMarkup() {
    return `<details class="ops-price-profiles" id="opsPriceProfiles">
      <summary>PRICE PROFILES <small>Save or load prices</small></summary>
      <div class="ops-profile-controls">
        <label class="comms-field"><span>SAVED PROFILE</span><select id="opsPriceProfileSelect" aria-label="Saved calculator price profile"></select><small>SELECT A PROFILE TO LOAD OR UPDATE</small></label>
        <label class="comms-field"><span>PROFILE NAME</span><input id="opsPriceProfileName" type="text" maxlength="40" placeholder="Current Market, Admiralty Offer…"><small>SAVING UPDATES CURRENT RECIPE MATERIALS IN THIS PROFILE</small></label>
      </div>
      <div class="ops-profile-actions">
        <button type="button" id="opsPriceProfileLoad">LOAD PROFILE</button>
        <button type="button" class="primary" id="opsPriceProfileSave">SAVE / UPDATE</button>
        <button type="button" id="opsPriceProfileClear">CLEAR CURRENT</button>
        <button type="button" class="danger" id="opsPriceProfileDelete">DELETE PROFILE</button>
      </div>
      <div class="ops-profile-status" id="opsPriceProfileStatus" data-tone="muted"></div>
    </details>`;
  }

  function selectedProfile() {
    const id = document.getElementById('opsPriceProfileSelect')?.value || '';
    return profiles().find(profile => profile.id === id) || null;
  }

  function renderProfileSelect(preferredId = '') {
    const select = document.getElementById('opsPriceProfileSelect');
    const name = document.getElementById('opsPriceProfileName');
    if (!select || !name) return;
    const list = profiles();
    const keep = preferredId || select.value;
    select.innerHTML = `<option value="">${list.length ? 'SELECT SAVED PROFILE' : 'NO SAVED PROFILES'}</option>` + list.map(profile => `<option value="${esc(profile.id)}">${esc(profile.name)} // ${Object.keys(profile.prices).length} PRICES</option>`).join('');
    if (keep && list.some(profile => profile.id === keep)) select.value = keep;
    const active = list.find(profile => profile.id === select.value);
    if (active) name.value = active.name;
    setProfileStatus(...profileStatus);
  }

  function bindProfilePanel(panel) {
    if (!panel || panel.dataset.bound === 'true') return;
    panel.dataset.bound = 'true';
    const select = panel.querySelector('#opsPriceProfileSelect');
    const name = panel.querySelector('#opsPriceProfileName');
    select?.addEventListener('change', () => {
      const profile = selectedProfile();
      if (profile && name) name.value = profile.name;
      setProfileStatus(profile ? `${profile.name.toUpperCase()} SELECTED // PRESS LOAD PROFILE TO APPLY` : 'SAVED PROFILES ARE OPTIONAL // NOTHING IS LOADED AUTOMATICALLY', 'muted');
    });
    panel.querySelector('#opsPriceProfileSave')?.addEventListener('click', saveCurrentProfile);
    panel.querySelector('#opsPriceProfileLoad')?.addEventListener('click', loadSelectedProfile);
    panel.querySelector('#opsPriceProfileClear')?.addEventListener('click', () => clearCurrentPrices(true));
    panel.querySelector('#opsPriceProfileDelete')?.addEventListener('click', deleteSelectedProfile);
  }

  function ensureProfilePanel() {
    const costPanel = document.querySelector('#workspaceOperations .ops-cost-panel');
    if (!costPanel) return;
    let panel = document.getElementById('opsPriceProfiles');
    const created = !panel;
    if (!panel) {
      const memory = costPanel.querySelector('.ops-price-memory');
      if (memory) memory.insertAdjacentHTML('afterend', profilePanelMarkup());
      else costPanel.insertAdjacentHTML('beforeend', profilePanelMarkup());
      panel = document.getElementById('opsPriceProfiles');
    }
    bindProfilePanel(panel);
    if (created) renderProfileSelect();
  }

  function saveCurrentProfile() {
    const nameField = document.getElementById('opsPriceProfileName');
    const rawName = String(nameField?.value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!rawName) { setProfileStatus('ENTER A PROFILE NAME FIRST', 'warn'); app.notify?.('ENTER A PRICE PROFILE NAME FIRST', 'warn'); return; }
    const inputs = currentPriceInputs();
    if (!inputs.length) { setProfileStatus('NO MATERIAL PRICE FIELDS AVAILABLE FOR THIS RECIPE', 'warn'); return; }
    const list = profiles();
    const selected = selectedProfile();
    const existing = selected || list.find(profile => normalize(profile.name) === normalize(rawName));
    const nextPrices = { ...(existing?.prices || {}) };
    let filled = 0;
    inputs.forEach(input => {
      const id = input.dataset.materialPrice;
      if (!id) return;
      if (input.value === '') delete nextPrices[id];
      else {
        const value = Number(input.value);
        if (Number.isFinite(value) && value >= 0) { nextPrices[id] = value; filled += 1; }
      }
    });
    if (!filled && !existing) { setProfileStatus('ENTER AT LEAST ONE CURRENT MATERIAL PRICE BEFORE SAVING', 'warn'); return; }
    const id = existing?.id || app.util.uid('price-profile');
    const profile = { id, name: rawName, prices: nextPrices, updatedAt: Date.now() };
    const next = [profile, ...list.filter(item => item.id !== id)].sort((a,b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    saveProfiles(next);
    renderProfileSelect(id);
    const total = Object.keys(nextPrices).length;
    setProfileStatus(`${rawName.toUpperCase()} SAVED // ${total} MATERIAL PRICE${total === 1 ? '' : 'S'} IN PROFILE`, 'good');
    app.notify?.('PRICE PROFILE SAVED LOCALLY');
  }

  function clearCurrentPrices(announce = false) {
    const inputs = currentPriceInputs();
    inputs.forEach(input => {
      if (input.value === '') return;
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    if (announce) {
      setProfileStatus('CURRENT CALCULATION PRICES CLEARED // SAVED PROFILES UNCHANGED', 'muted');
      app.notify?.('CURRENT MATERIAL PRICES CLEARED', 'warn');
    }
  }

  function loadSelectedProfile() {
    const profile = selectedProfile();
    if (!profile) { setProfileStatus('SELECT A SAVED PROFILE FIRST', 'warn'); return; }
    const inputs = currentPriceInputs();
    let applied = 0;
    inputs.forEach(input => {
      const id = input.dataset.materialPrice;
      const has = Object.prototype.hasOwnProperty.call(profile.prices, id);
      input.value = has ? String(profile.prices[id]) : '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (has) applied += 1;
    });
    setProfileStatus(`${profile.name.toUpperCase()} LOADED // ${applied} / ${inputs.length} CURRENT MATERIALS MATCHED`, applied ? 'good' : 'warn');
    app.notify?.(applied ? `PRICE PROFILE LOADED // ${applied} MATERIALS` : 'PROFILE HAS NO PRICES FOR THIS RECIPE', applied ? 'good' : 'warn');
  }

  function deleteSelectedProfile() {
    const profile = selectedProfile();
    if (!profile) { setProfileStatus('SELECT A SAVED PROFILE FIRST', 'warn'); return; }
    if (!window.confirm(`Delete saved price profile “${profile.name}”?`)) return;
    saveProfiles(profiles().filter(item => item.id !== profile.id));
    const name = document.getElementById('opsPriceProfileName');
    if (name) name.value = '';
    profileStatus = [`${profile.name.toUpperCase()} DELETED // CURRENT CALCULATION UNCHANGED`, 'muted'];
    renderProfileSelect();
  }

  function installPriceProfiles() {
    const workspace = document.getElementById('workspaceOperations');
    if (!workspace) return;
    ensureProfilePanel();
    if (operationsObserver) return;
    const mount = document.getElementById('operationsCalculatorMount');
    if (!mount) return;
    operationsObserver = new MutationObserver(() => queueMicrotask(ensureProfilePanel));
    operationsObserver.observe(mount, { childList: true });
  }

  function selfTest() {
    const failures = [];
    if (!app.config.storageKeys.calculatorPriceProfiles) failures.push('profile-storage-key');
    const calculator = document.querySelector('#workspaceOperations .ops-cost-panel');
    if (calculator && !document.getElementById('opsPriceProfiles')) failures.push('price-profile-panel');
    return failures;
  }

  const baseOperationsInit = app.operations?.init;
  if (typeof baseOperationsInit === 'function') {
    app.operations.init = async function qolOperationsInit(...args) {
      const result = await baseOperationsInit.apply(this, args);
      installPriceProfiles();
      return result;
    };
  }

  window.addEventListener('storage', event => {
    if (event.key === PROFILE_KEY) renderProfileSelect();
  });

  app.qol = { installPriceProfiles, ensureProfilePanel, saveCurrentProfile, loadSelectedProfile, clearCurrentPrices, profiles, selfTest };
})();
