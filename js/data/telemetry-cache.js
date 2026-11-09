/* Persist public stock snapshots separately from private drafts and backups. */
(function initRhwTelemetryCache() {
  'use strict';
  const DB_NAME = 'rhw-public-stock-v1';
  const STORE = 'snapshots';
  const KEY = 'pobs';
  let database;

  function valid(snapshot) {
    if (snapshot?.schemaVersion !== 1 || !Array.isArray(snapshot.bases)) return false;
    const timestamp = Date.parse(snapshot.fetchedAt);
    if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now() + 60000) return false;
    const base = snapshot.bases.find(entry => String(entry?.name || entry?.nickname || '').trim().toLowerCase() === DASHBOARD_CONFIG.baseName);
    return Boolean(base && Array.isArray(base.shop_items) && base.shop_items.every(item => item && typeof item === 'object' && !Array.isArray(item)));
  }

  function open() {
    if (!globalThis.indexedDB) return Promise.resolve(null);
    if (database) return database;
    database = new Promise(resolve => {
      let request;
      try { request = indexedDB.open(DB_NAME, 1); }
      catch { resolve(null); return; }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); database = null; };
        resolve(db);
      };
      request.onerror = request.onblocked = () => { database = null; resolve(null); };
    });
    return database;
  }

  async function read() {
    const db = await open();
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const transaction = db.transaction(STORE, 'readonly');
        const request = transaction.objectStore(STORE).get(KEY);
        request.onsuccess = () => resolve(valid(request.result) ? request.result : null);
        request.onerror = transaction.onabort = () => resolve(null);
      } catch { resolve(null); }
    });
  }

  async function write({ bases, fetchedAt }) {
    const snapshot = { schemaVersion: 1, bases, fetchedAt };
    if (!valid(snapshot)) return false;
    const db = await open();
    if (!db) return false;
    return new Promise(resolve => {
      try {
        const transaction = db.transaction(STORE, 'readwrite');
        transaction.objectStore(STORE).put(snapshot, KEY);
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = transaction.onabort = () => resolve(false);
      } catch { resolve(false); }
    });
  }

  globalThis.RHWTelemetryCache = { read, write, valid };
})();
