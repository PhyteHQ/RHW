import { validateNavigation } from './core/navigation.mjs';
import { createMapCache } from './map-cache.mjs';

const API = 'https://darkstat.dd84ai.com/api/';
const CACHE = 'rhw-supply-market-v1';

export async function database(action, value, key = 'latest') {
  if (!globalThis.indexedDB) return null;
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(CACHE, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('market');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('market', action === 'get' ? 'readonly' : 'readwrite');
      const operation = action === 'get' ? tx.objectStore('market').get(key) : tx.objectStore('market').put(value, key);
      let data;
      operation.onsuccess = () => { data = operation.result; };
      tx.oncomplete = () => { db.close(); resolve(data || null); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}

export async function read(path, body, signal) {
  const init = { method: 'POST', headers: { Accept: 'application/json' }, cache: 'no-store', signal };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  let response = await fetch(API + path, init);
  if (response.status === 405) {
    if (Array.isArray(body) || Object.values(body || {}).some(Array.isArray)) throw Error(`${path}: this API operation requires POST support`);
    const query = body ? '?' + new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)])) : '';
    response = await fetch(API + path + query, { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
  }
  if (!response.ok) throw Error(`${path}: HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 70 * 1024 * 1024) throw Error(`${path}: market response too large`);
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw Error(`${path}: invalid response`);
  return data;
}

async function compressedJson(path, signal) {
  const response = await fetch(new URL('../../assets/' + path, import.meta.url), { signal });
  if (!response.ok) throw Error('Navigation map unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = bytes[0] === 31 && bytes[1] === 139
    ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

export async function loadNavigation(signal) {
  const raw = await compressedJson('navigation.json.gz', signal);
  raw.links = raw.links.map(link => link.kind === 'lane' ? { ...link, speed: 2500 } : link);
  return validateNavigation(raw);
}

export const mapUpdates = new EventTarget();
export const mapCache = createMapCache({
  fetchSystems: signal => read('systems', undefined, signal),
  loadBundled: () => compressedJson('navigation-last-verified.json.gz'),
  readCache: () => database('get', undefined, 'navigation'),
  writeCache: snapshot => database('put', snapshot, 'navigation'),
  onChange: () => mapUpdates.dispatchEvent(new Event('change'))
});
