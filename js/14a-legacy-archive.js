/* Private backup compatibility for retired data. No board, UI, timer or recipe work. */
(function initLegacyArchive() {
  'use strict';
  const app = window.RHWV4;
  if (!app) return;
  const KEY = app.config.storageKeys.productionOrders;
  const PRIORITIES = Object.freeze({ urgent: 0, high: 1, normal: 2 });
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

  function uniqueOrders(raw) {
    const map = new Map();
    raw.map(normalize).filter(Boolean).forEach(order => {
      const current = map.get(order.id);
      if (!current || order.updatedAt >= current.updatedAt) map.set(order.id, order);
    });
    return [...map.values()].sort((a, b) => a.createdAt - b.createdAt);
  }


  function snapshot() {
    const stored = app.store.get(KEY, []);
    return uniqueOrders(Array.isArray(stored) ? stored : []);
  }
  function prepareImport(raw) {
    const next = uniqueOrders([...snapshot(), ...(Array.isArray(raw) ? raw : [])]);
    if (next.length > 100) throw new Error('ARCHIVE IMPORT EXCEEDS 100 ENTRIES. NOTHING IMPORTED.');
    return next;
  }
  function importOrders(raw) {
    const next = prepareImport(raw);
    if (app.store.set(KEY, next) === false) throw new Error('ARCHIVE IMPORT NOT SAVED. LOCAL DATA UNCHANGED.');
    return next;
  }
  app.legacyArchive = { snapshot, prepareImport, importOrders };
})();
