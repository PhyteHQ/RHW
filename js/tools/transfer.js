/* ==========================================================================
   RHW PR9 · CROSS-DEVICE TRANSFER CENTER
   Private file sharing, reviewed section import and conflict-safe merging.
   ========================================================================== */
(function initRhwTransferCenter() {
  'use strict';
  const app = window.RHWV4;
  if (!app) return;

  const MAX_FILE_BYTES = 2 * 1024 * 1024;
  const sectionDefinitions = Object.freeze([
    Object.freeze({ key: 'drafts', label: 'NAMED DRAFTS', detail: 'Saved Forum transmissions', mode: 'MERGE', selected: true }),
    Object.freeze({ key: 'senders', label: 'LOCAL SENDERS', detail: 'Custom identity profiles', mode: 'MERGE', selected: true }),
    Object.freeze({ key: 'priceProfiles', label: 'PRICE PROFILES', detail: 'Saved calculator prices', mode: 'MERGE', selected: true }),
    Object.freeze({ key: 'priceCheckOverrides', label: 'PRICE CHECK', detail: 'Manual source prices', mode: 'MERGE', selected: true }),
    Object.freeze({ key: 'productionOrders', label: 'LEGACY DATA', detail: 'Archived order data from earlier versions', mode: 'MERGE', selected: false }),
    Object.freeze({ key: 'current', label: 'CURRENT MESSAGE', detail: 'Autosaved Forum composer', mode: 'REPLACE', selected: false }),
    Object.freeze({ key: 'shipyardPlanner', label: 'ARCHIVED SHIPYARD PLAN', detail: 'Saved planner data from earlier versions', mode: 'REPLACE', selected: false }),
    Object.freeze({ key: 'newswireDraft', label: 'NEWSWIRE WORK', detail: 'Unpublished working copy', mode: 'REPLACE', selected: false }),
    Object.freeze({ key: 'preferences', label: 'APP SETTINGS', detail: 'Last views and workspace', mode: 'REPLACE', selected: false })
  ]);
  const state = { payload: null, inspection: null, fileName: '', returnFocus: null };

  function backupName() {
    return `rhw-private-backup-${new Date().toISOString().slice(0, 10)}.json`;
  }

  function payloadText(payload = app.storage.exportPayload()) {
    return JSON.stringify(payload, null, 2);
  }

  function buildFile(payload = app.storage.exportPayload()) {
    if (typeof File !== 'function') return null;
    return new File([payloadText(payload)], backupName(), { type: 'application/json', lastModified: Date.now() });
  }

  function setStatus(message, tone = 'ready') {
    const status = document.getElementById('rhwTransferStatus');
    if (!status) return;
    status.textContent = String(message || '');
    status.dataset.tone = tone;
  }

  function downloadBackup(payload = app.storage.exportPayload(), { fallback = false } = {}) {
    const blob = new Blob([payloadText(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = backupName();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    const message = fallback ? 'FILE SHARE UNAVAILABLE // BACKUP DOWNLOADED INSTEAD' : 'PRIVATE BACKUP DOWNLOADED';
    setStatus(message, fallback ? 'warn' : 'good');
    app.notify(message, fallback ? 'warn' : 'good');
    return { downloaded: true, fallback };
  }

  async function shareBackup() {
    const payload = app.storage.exportPayload();
    const file = buildFile(payload);
    const canShare = file && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && (() => {
      try { return navigator.canShare({ files: [file] }); }
      catch { return false; }
    })();
    if (!canShare) return downloadBackup(payload, { fallback: true });
    try {
      await navigator.share({
        files: [file],
        title: 'RHW private backup',
        text: 'Private RHW cross-device backup. Import it only on a trusted device.'
      });
      setStatus('PRIVATE BACKUP HANDED TO YOUR SHARE MENU', 'good');
      app.notify('PRIVATE BACKUP SHARED');
      return { shared: true, downloaded: false };
    } catch (error) {
      if (error?.name === 'AbortError') {
        setStatus('SHARE CANCELLED // NO FILE WAS SENT', 'ready');
        return { shared: false, cancelled: true };
      }
      setStatus('SHARE FAILED // BACKUP DOWNLOADED INSTEAD', 'warn');
      return downloadBackup(payload, { fallback: true });
    }
  }

  function mountDialog() {
    if (document.getElementById('rhwTransferDialog')) return;
    const dialog = document.createElement('aside');
    dialog.id = 'rhwTransferDialog';
    dialog.className = 'rhw-transfer-dialog';
    dialog.hidden = true;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'rhwTransferDialogTitle');
    dialog.dataset.focusTrap = 'true';
    dialog.innerHTML = `<div class="rhw-transfer-backdrop" data-transfer-close></div>
      <section class="rhw-transfer-sheet">
        <header><div><span>IMPORT REVIEW</span><strong id="rhwTransferDialogTitle">CHOOSE WHAT MOVES TO THIS DEVICE</strong></div><button type="button" data-transfer-close aria-label="Close import review">CLOSE</button></header>
        <div id="rhwTransferFileMeta" class="rhw-transfer-file-meta"></div>
        <div class="rhw-transfer-mode-help"><span><b>MERGE</b> KEEPS LOCAL ITEMS AND ADDS NEWER BACKUP ITEMS.</span><span><b>REPLACE</b> OVERWRITES THAT ONE LOCAL WORKING AREA ONLY.</span></div>
        <div id="rhwTransferSectionList" class="rhw-transfer-section-list"></div>
        <div id="rhwTransferImportWarning" class="rhw-transfer-import-warning" role="status" aria-live="polite"></div>
        <footer><button type="button" data-transfer-close>CANCEL</button><button type="button" id="rhwTransferConfirmBtn" class="comms-primary">IMPORT SELECTED SECTIONS</button></footer>
      </section>`;
    document.body.appendChild(dialog);
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-transfer-close]')) closePreview();
    });
    document.getElementById('rhwTransferConfirmBtn')?.addEventListener('click', confirmImport);
    document.addEventListener('keydown', event => {
      if (dialog.hidden) return;
      if (event.key === 'Escape') {
        closePreview();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll('button, input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(element => !element.hasAttribute('disabled') && element.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  function formatExportTime(value) {
    if (!value) return 'UNKNOWN EXPORT TIME';
    try { return new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return 'UNKNOWN EXPORT TIME'; }
  }

  function renderPreview() {
    const dialog = document.getElementById('rhwTransferDialog');
    const meta = document.getElementById('rhwTransferFileMeta');
    const list = document.getElementById('rhwTransferSectionList');
    const warning = document.getElementById('rhwTransferImportWarning');
    if (!dialog || !meta || !list || !warning || !state.inspection) return false;
    const info = state.inspection;
    meta.innerHTML = `<div><small>FILE</small><strong>${app.util.escape(state.fileName || 'RHW BACKUP')}</strong></div><div><small>SOURCE</small><strong>${app.util.escape(info.appVersion)} // FORMAT V${info.version}</strong></div><div><small>EXPORTED</small><strong>${app.util.escape(formatExportTime(info.exportedAt))}</strong></div>`;
    list.innerHTML = sectionDefinitions.filter(definition => info.availableSections.includes(definition.key)).map(definition => {
      const count = info.sections[definition.key];
      return `<label class="rhw-transfer-section" data-mode="${definition.mode.toLowerCase()}"><input type="checkbox" value="${definition.key}"${definition.selected ? ' checked' : ''}><span class="rhw-transfer-check" aria-hidden="true"></span><span class="rhw-transfer-section-copy"><strong>${definition.label}</strong><small>${definition.detail} // ${count} ${count === 1 ? 'ENTRY' : 'ENTRIES'}</small></span><b>${definition.mode}</b></label>`;
    }).join('');
    warning.textContent = info.containsPrivateContent
      ? 'PRIVACY CHECK // THIS FILE CONTAINS PRIVATE WORK. REVIEW EVERY SELECTED SECTION BEFORE IMPORTING.'
      : 'REVIEW THE SELECTED SECTIONS BEFORE IMPORTING.';
    dialog.hidden = false;
    document.body.classList.add('rhw-transfer-open');
    document.getElementById('rhwTransferConfirmBtn')?.focus();
    return true;
  }

  function closePreview() {
    const dialog = document.getElementById('rhwTransferDialog');
    if (dialog) dialog.hidden = true;
    document.body.classList.remove('rhw-transfer-open');
    state.payload = null;
    state.inspection = null;
    const target = state.returnFocus;
    state.returnFocus = null;
    target?.focus?.();
  }

  function previewPayload(payload, fileName = 'RHW BACKUP') {
    mountDialog();
    state.inspection = app.storage.inspectPayload(payload);
    if (!state.inspection.availableSections.length) throw new Error('BACKUP CONTAINS NO IMPORTABLE SECTIONS');
    state.payload = payload;
    state.fileName = fileName;
    state.returnFocus = document.activeElement;
    if (!renderPreview()) throw new Error('IMPORT REVIEW COULD NOT OPEN');
    setStatus(`REVIEWING ${state.inspection.availableSections.length} BACKUP SECTIONS`, 'warn');
    return state.inspection;
  }

  async function previewFile(file) {
    if (!file || typeof file.text !== 'function') throw new Error('NO BACKUP FILE SELECTED');
    if (file.size > MAX_FILE_BYTES) throw new Error('BACKUP FILE EXCEEDS 2 MB LIMIT');
    if (!/\.json$/i.test(file.name || '')) throw new Error('BACKUP MUST BE A JSON FILE');
    try {
      return previewPayload(JSON.parse(await file.text()), file.name);
    } catch (error) {
      setStatus(`IMPORT REVIEW FAILED // ${String(error?.message || 'INVALID FILE').toUpperCase()}`, 'danger');
      throw error;
    }
  }

  function selectedSections() {
    return [...document.querySelectorAll('#rhwTransferSectionList input:checked')].map(input => input.value);
  }

  function confirmImport() {
    const warning = document.getElementById('rhwTransferImportWarning');
    if (!state.payload) return false;
    const sections = selectedSections();
    if (!sections.length) {
      if (warning) warning.textContent = 'SELECT AT LEAST ONE SECTION OR CANCEL THE IMPORT.';
      return false;
    }
    try {
      const result = app.storage.importPayload(state.payload, { sections });
      app.comms?.renderDrafts?.();
      app.comms?.renderSenderRegistry?.();
      app.comms?.renderForm?.();
      closePreview();
      setStatus(`IMPORT COMPLETE // ${sections.length} SECTIONS REVIEWED`, 'good');
      app.notify(`PRIVATE BACKUP IMPORTED // ${sections.length} SECTIONS`);
      window.dispatchEvent(new CustomEvent('rhw:transfer-imported', { detail: { sections, result } }));
      return result;
    } catch (error) {
      const message = `IMPORT FAILED // ${String(error?.message || 'INVALID BACKUP').toUpperCase()}`;
      if (warning) warning.textContent = message;
      app.notify(message, 'danger');
      return false;
    }
  }

  function selfTest() {
    const failures = [];
    if (typeof app.storage?.inspectPayload !== 'function') failures.push('missing:payload-inspector');
    if (!document.getElementById('rhwTransferCenter')) failures.push('missing:transfer-center');
    if (!document.getElementById('shareCommsCacheBtn')) failures.push('missing:share-control');
    if (!document.getElementById('rhwTransferDialog')) failures.push('missing:import-review');
    if (document.getElementById('rhwTransferDialog')?.dataset.focusTrap !== 'true') failures.push('missing:focus-trap');
    return failures;
  }

  function init() {
    mountDialog();
    return Boolean(document.getElementById('rhwTransferCenter'));
  }

  app.transferCenter = {
    init,
    selfTest,
    buildFile,
    shareBackup,
    downloadBackup,
    previewFile,
    previewPayload,
    confirmImport,
    sectionDefinitions
  };
})();
