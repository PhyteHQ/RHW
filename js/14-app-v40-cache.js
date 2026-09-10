/* ==========================================================================
   RHW WEB APP · V4.0 STORAGE
   Browser-local drafts, sender identities, migration and cache portability.
   ========================================================================== */
(function initRhwV4Storage() {
  'use strict';
  const app = window.RHWV4;
  if (!app) return;
  const keys = app.config.storageKeys;

  function defaultState() {
    const sender = app.config.senders[0];
    const template = app.config.templates[0];
    return {
      templateKey: template.key,
      senderKey: sender.key,
      customSenderName: '',
      signatureTitle: sender.title || '',
      senderSnapshotName: sender.name || '',
      senderSnapshotTitle: sender.title || '',
      recipient: template.recipient || '',
      location: sender.location || '',
      encryption: template.encryption || sender.encryption || '',
      classification: template.classification || 'RHW OFFICIAL',
      salutation: template.salutation || 'Dear Sir or Madam,',
      subject: '',
      message: '',
      closing: template.closing || 'Yours faithfully,',
      systemDate: '',
      draftName: '',
      footerMotto: app.config.forum.footerMotto
    };
  }

  function normalizeState(raw) {
    const fallback = defaultState();
    if (!raw || typeof raw !== 'object') return fallback;
    const state = { ...fallback };
    Object.keys(fallback).forEach(key => {
      if (typeof raw[key] === 'string') state[key] = raw[key];
    });
    if (!app.config.templates.some(template => template.key === state.templateKey)) state.templateKey = fallback.templateKey;
    if (!state.classification) state.classification = app.template(state.templateKey).classification || fallback.classification;
    if (!state.salutation) state.salutation = app.template(state.templateKey).salutation || fallback.salutation;
    if (!state.closing) state.closing = app.template(state.templateKey).closing || fallback.closing;
    return state;
  }

  function normalizeSender(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name || '').trim();
    if (!name) return null;
    return {
      key: String(raw.key || app.util.uid('local-sender')),
      name,
      title: String(raw.title || '').trim(),
      organisation: String(raw.organisation || '').trim(),
      location: String(raw.location || '').trim(),
      encryption: String(raw.encryption || '').trim()
    };
  }

  function senderByKey(key) {
    const builtIn = app.config.senders.find(sender => sender.key === key);
    if (builtIn) return { ...builtIn, source: 'BUILT-IN' };
    const local = app.state.localSenders.find(sender => sender.key === key);
    return local ? { ...local, source: 'LOCAL' } : null;
  }

  function resolveSender(state = app.state.comms) {
    if (!state) return { name: '', title: '', organisation: '' };
    if (state.senderKey === '__custom__') {
      return {
        name: state.customSenderName?.trim() || state.senderSnapshotName?.trim() || 'UNASSIGNED SENDER',
        title: state.signatureTitle?.trim() || state.senderSnapshotTitle?.trim() || '',
        organisation: ''
      };
    }
    const sender = senderByKey(state.senderKey);
    if (sender) return sender;
    return {
      name: state.senderSnapshotName?.trim() || 'UNASSIGNED SENDER',
      title: state.senderSnapshotTitle?.trim() || '',
      organisation: ''
    };
  }

  function snapshotSender(state) {
    const sender = resolveSender(state);
    state.senderSnapshotName = sender.name || state.senderSnapshotName || '';
    state.senderSnapshotTitle = sender.title || state.senderSnapshotTitle || '';
    return state;
  }

  function normalizeDraft(raw) {
    if (!raw || typeof raw !== 'object' || !raw.id) return null;
    const state = snapshotSender(normalizeState(raw.state));
    return {
      id: String(raw.id),
      name: String(raw.name || state.draftName || state.subject || 'Transmission').trim(),
      state,
      updatedAt: Number(raw.updatedAt) || Date.now()
    };
  }

  function saveLocalSenders() {
    app.store.set(keys.localSenders, app.state.localSenders);
  }

  function saveDrafts() {
    app.store.set(keys.commsDrafts, app.state.drafts);
  }

  function saveCurrent() {
    if (!app.state.comms) return;
    snapshotSender(app.state.comms);
    app.store.set(keys.commsCurrent, app.state.comms);
  }

  function saveDraft(state, name) {
    const nextState = snapshotSender(normalizeState(state));
    const nextName = String(name || nextState.draftName || nextState.subject || `Transmission ${new Date().toLocaleDateString('de-DE')}`).trim();
    nextState.draftName = nextName;
    const existing = app.state.drafts.find(draft => app.util.normalize(draft.name) === app.util.normalize(nextName));
    if (existing) {
      existing.state = nextState;
      existing.updatedAt = Date.now();
    } else {
      app.state.drafts.push({ id: app.util.uid('draft'), name: nextName, state: nextState, updatedAt: Date.now() });
    }
    saveDrafts();
    return nextName;
  }

  function deleteDraft(id) {
    app.state.drafts = app.state.drafts.filter(draft => draft.id !== id);
    saveDrafts();
  }

  function upsertSender(profile, preferredKey = null) {
    const normalized = normalizeSender({ ...profile, key: preferredKey || profile?.key });
    if (!normalized) return null;
    const byKey = preferredKey ? app.state.localSenders.findIndex(sender => sender.key === preferredKey) : -1;
    const byName = app.state.localSenders.findIndex(sender => app.util.normalize(sender.name) === app.util.normalize(normalized.name));
    const index = byKey >= 0 ? byKey : byName;
    if (index >= 0) {
      normalized.key = app.state.localSenders[index].key;
      app.state.localSenders[index] = normalized;
    } else {
      app.state.localSenders.push(normalized);
    }
    saveLocalSenders();
    return normalized;
  }

  function snapshotReferences(sender) {
    if (!sender?.key) return;
    let changed = false;
    app.state.drafts.forEach(draft => {
      if (draft.state?.senderKey !== sender.key) return;
      draft.state.senderSnapshotName = sender.name || draft.state.senderSnapshotName || '';
      draft.state.senderSnapshotTitle = sender.title || draft.state.senderSnapshotTitle || '';
      changed = true;
    });
    if (changed) saveDrafts();
    if (app.state.comms?.senderKey === sender.key) {
      app.state.comms.senderSnapshotName = sender.name || app.state.comms.senderSnapshotName || '';
      app.state.comms.senderSnapshotTitle = sender.title || app.state.comms.senderSnapshotTitle || '';
      saveCurrent();
    }
  }

  function removeSender(key) {
    const sender = app.state.localSenders.find(entry => entry.key === key);
    if (!sender) return null;
    snapshotReferences(sender);
    app.state.localSenders = app.state.localSenders.filter(entry => entry.key !== key);
    saveLocalSenders();
    return sender;
  }

  function mergeByKey(existing, incoming, keyFn) {
    const map = new Map(existing.map(item => [keyFn(item), item]));
    incoming.forEach(item => {
      const key = keyFn(item);
      if (!key) return;
      const current = map.get(key);
      if (!current || Number(item.updatedAt || 0) >= Number(current.updatedAt || 0)) map.set(key, item);
    });
    return [...map.values()];
  }

  const preferenceKeys = Object.freeze([
    'activeWorkspace', 'commandNode', 'inventoryView', 'operationsNode', 'commsNode', 'tickerComposer',
    'commsMobileView'
  ]);
  const transferSectionKeys = Object.freeze([
    'drafts', 'senders', 'current', 'priceProfiles', 'priceCheckOverrides', 'shipyardPlanner', 'newswireDraft', 'productionOrders', 'preferences'
  ]);

  function requireStored(key, value) {
    if (!app.store.set(key, value)) throw new Error(`LOCAL STORAGE WRITE FAILED: ${key}`);
  }

  function portablePreferences() {
    return Object.fromEntries(preferenceKeys.map(name => [name, app.store.get(keys[name], null)]));
  }

  function portableCopy(value) {
    if (value === undefined) return null;
    return JSON.parse(JSON.stringify(value));
  }

  function inspectPayload(raw) {
    const version = Number(raw?.version);
    if (!raw || raw.format !== 'rhw-webapp-local-cache' || ![1, 2, 3, 4, 5].includes(version)) {
      throw new Error('UNSUPPORTED CACHE FILE');
    }
    const countObject = value => value && typeof value === 'object' ? Object.keys(value).length : 0;
    const sections = {
      drafts: Array.isArray(raw.drafts) ? raw.drafts.length : 0,
      senders: Array.isArray(raw.localSenders) ? raw.localSenders.length : 0,
      current: raw.current && typeof raw.current === 'object' ? 1 : 0,
      priceCheckOverrides: version >= 5 ? countObject(raw.priceCheckOverrides) : 0,
      priceProfiles: version >= 2 && Array.isArray(raw.priceProfiles) ? raw.priceProfiles.length : 0,
      shipyardPlanner: version >= 2 && raw.shipyardPlanner && typeof raw.shipyardPlanner === 'object' ? 1 : 0,
      newswireDraft: version >= 2 && raw.newswireDraft && typeof raw.newswireDraft === 'object' ? 1 : 0,
      productionOrders: version >= 3 && Array.isArray(raw.productionOrders) ? raw.productionOrders.length : 0,
      preferences: version >= 2 ? countObject(raw.preferences) : 0
    };
    return {
      version,
      appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : 'UNKNOWN',
      exportedAt: typeof raw.exportedAt === 'string' && !Number.isNaN(Date.parse(raw.exportedAt)) ? raw.exportedAt : '',
      sections,
      availableSections: transferSectionKeys.filter(key => sections[key] > 0),
      containsPrivateContent: sections.current > 0 || sections.drafts > 0 || sections.senders > 0 || sections.newswireDraft > 0
    };
  }

  function importPayload(raw, options = {}) {
    const inspection = inspectPayload(raw);
    const version = inspection.version;
    const selected = Array.isArray(options.sections)
      ? new Set(options.sections.filter(key => transferSectionKeys.includes(key)))
      : new Set(transferSectionKeys);
    const includes = key => selected.has(key);

    const incomingOverrides = version >= 5 && includes('priceCheckOverrides') && raw.priceCheckOverrides
      ? app.pricecheck.normalizeOverrides(raw.priceCheckOverrides) : null;

    // Check the merged queue before applying ANY selected backup section.
    if (version >= 3 && includes('productionOrders') && Array.isArray(raw.productionOrders)) {
      if (!app.productionOrders?.prepareImport) throw new Error('ORDER BOARD NOT READY // RETRY IMPORT AFTER STARTUP');
      app.productionOrders.prepareImport(raw.productionOrders);
    }

    if (includes('senders')) {
      const incomingSenders = (Array.isArray(raw.localSenders) ? raw.localSenders : []).map(normalizeSender).filter(Boolean);
      app.state.localSenders = mergeByKey(app.state.localSenders, incomingSenders, sender => sender.key);
      requireStored(keys.localSenders, app.state.localSenders);
    }
    if (includes('drafts')) {
      const incomingDrafts = (Array.isArray(raw.drafts) ? raw.drafts : []).map(normalizeDraft).filter(Boolean);
      app.state.drafts = mergeByKey(app.state.drafts, incomingDrafts, draft => draft.id);
      requireStored(keys.commsDrafts, app.state.drafts);
    }

    if (includes('current') && raw.current && typeof raw.current === 'object') {
      const incomingCurrent = snapshotSender(normalizeState(raw.current));
      const valid = incomingCurrent.senderKey === '__custom__' || Boolean(senderByKey(incomingCurrent.senderKey));
      if (!valid && !incomingCurrent.senderSnapshotName) incomingCurrent.senderKey = app.config.senders[0].key;
      app.state.comms = incomingCurrent;
      requireStored(keys.commsCurrent, app.state.comms);
    }

    if (version >= 2) {
      if (includes('priceProfiles') && Array.isArray(raw.priceProfiles)) {
        const storedProfiles = app.store.get(keys.calculatorPriceProfiles, []);
        const existingProfiles = Array.isArray(storedProfiles) ? storedProfiles : [];
        const incomingProfiles = raw.priceProfiles.filter(profile => profile && typeof profile === 'object' && profile.id);
        requireStored(keys.calculatorPriceProfiles, mergeByKey(existingProfiles, incomingProfiles, profile => String(profile.id || '')));
      }
      if (includes('shipyardPlanner') && raw.shipyardPlanner && typeof raw.shipyardPlanner === 'object') requireStored(keys.shipyardPlanner, raw.shipyardPlanner);
      if (includes('preferences') && raw.preferences && typeof raw.preferences === 'object') {
        preferenceKeys.forEach(name => {
          if (Object.prototype.hasOwnProperty.call(raw.preferences, name) && raw.preferences[name] !== null) {
            requireStored(keys[name], raw.preferences[name]);
          }
        });
      }
      if (includes('newswireDraft') && raw.newswireDraft && typeof raw.newswireDraft === 'object') {
        if (app.newswireManager?.restoreDraft) app.newswireManager.restoreDraft(raw.newswireDraft);
        else requireStored(keys.newswireManagerDraft, raw.newswireDraft);
      }
    }
    if (version >= 3 && includes('productionOrders') && Array.isArray(raw.productionOrders)) {
      if (app.productionOrders?.importOrders) app.productionOrders.importOrders(raw.productionOrders);
      else requireStored(keys.productionOrders, raw.productionOrders);
    }
    if (incomingOverrides) app.pricecheck.importOverrides(incomingOverrides);
    return {
      drafts: app.state.drafts.length,
      senders: app.state.localSenders.length,
      priceProfiles: (app.store.get(keys.calculatorPriceProfiles, []) || []).length,
      newswireDraft: Boolean(app.store.get(keys.newswireManagerDraft, null)),
      productionOrders: (app.store.get(keys.productionOrders, []) || []).length,
      selectedSections: [...selected],
      sourceVersion: version
    };
  }

  function exportPayload() {
    if (app.comms?.syncFromForm) app.comms.syncFromForm();
    saveCurrent();
    return {
      format: 'rhw-webapp-local-cache',
      version: 5,
      appVersion: app.version,
      exportedAt: new Date().toISOString(),
      current: portableCopy(app.state.comms),
      drafts: portableCopy(app.state.drafts),
      localSenders: portableCopy(app.state.localSenders),
      priceCheckOverrides: portableCopy(app.store.get(keys.priceCheckOverrides, {}) || {}),
      priceProfiles: portableCopy(app.store.get(keys.calculatorPriceProfiles, []) || []),
      shipyardPlanner: portableCopy(app.store.get(keys.shipyardPlanner, null)),
      productionOrders: portableCopy(app.productionOrders?.snapshot?.() || app.store.get(keys.productionOrders, []) || []),
      newswireDraft: portableCopy(app.newswireManager?.draftPayload?.() || app.store.get(keys.newswireManagerDraft, null)),
      preferences: portableCopy(portablePreferences())
    };
  }

  app.storage = {
    defaultState,
    normalizeState,
    normalizeSender,
    normalizeDraft,
    senderByKey,
    resolveSender,
    snapshotSender,
    saveCurrent,
    saveDraft,
    deleteDraft,
    upsertSender,
    removeSender,
    importPayload,
    inspectPayload,
    exportPayload,
    init() {
      app.state.localSenders = (app.store.get(keys.localSenders, []) || []).map(normalizeSender).filter(Boolean);
      app.state.drafts = (app.store.get(keys.commsDrafts, []) || []).map(normalizeDraft).filter(Boolean);
      app.state.comms = snapshotSender(normalizeState(app.store.get(keys.commsCurrent, null)));
      saveLocalSenders();
      saveDrafts();
      saveCurrent();
    }
  };
})();
