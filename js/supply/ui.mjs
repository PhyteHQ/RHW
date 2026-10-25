import { normalizeDarkstat, validateDataset } from './core/trade.mjs';
import { validateNavigation } from './core/navigation.mjs';
import { FALLBACK_SHIPS, normalizeShipRegistry } from './ship-profiles.mjs';
import { dockingAccess, BMM_ID } from './access.mjs';
import { normalize, findRhw } from './planner.mjs';

const API = 'https://darkstat.dd84ai.com/api/';
const CACHE = 'rhw-supply-market-v1';
const FIVE_MINUTES = 300000, SIX_HOURS = 21600000, DAY = 86400000;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const count = value => Math.round(value).toLocaleString('en-GB');
const money = value => `${value < 0 ? '-' : ''}$${count(Math.abs(value))}`;
const duration = seconds => `${Math.floor(Math.round(seconds) / 60)}:${String(Math.round(seconds) % 60).padStart(2, '0')}`;
const date = value => new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
let dialog, context, worker, abort, request = 0, prepared = null, result = null, busy = false;
const $ = id => dialog.querySelector('#' + id);

async function database(action, value) {
  if (!globalThis.indexedDB) return null;
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(CACHE, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('market');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('market', action === 'get' ? 'readonly' : 'readwrite');
      const operation = action === 'get' ? tx.objectStore('market').get('latest') : tx.objectStore('market').put(value, 'latest');
      let data;
      operation.onsuccess = () => { data = operation.result; };
      tx.oncomplete = () => { db.close(); resolve(data || null); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
async function read(path, body, signal) {
  const init = { method: 'POST', headers: { Accept: 'application/json' }, cache: 'no-store', signal };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  let response = await fetch(API + path, init);
  if (response.status === 405) {
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
async function loadNavigation(signal) {
  const response = await fetch(new URL('../../assets/navigation.json.gz', import.meta.url), { signal });
  if (!response.ok) throw Error('Navigation map unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = bytes[0] === 31 && bytes[1] === 139
    ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : new TextDecoder().decode(bytes);
  const raw = JSON.parse(text);
  raw.links = raw.links.map(link => link.kind === 'lane' ? { ...link, speed: 2500 } : link);
  return validateNavigation(raw);
}
function mergeMarket(npc, pobs, receivedAt) {
  const meta = new Map();
  npc.bases.forEach(base => base.offers.forEach(item => { if (!meta.has(item.id)) meta.set(item.id, item); }));
  const dynamic = normalizeDarkstat(pobs, [], new Date(receivedAt).toISOString());
  dynamic.bases.forEach(base => base.offers.forEach(item => {
    const info = meta.get(item.id);
    if (item.volume === null && info?.volume > 0) item.volume = info.volume;
    item.volumes = info?.volumes || {};
  }));
  const ids = new Set(dynamic.bases.map(base => base.id));
  return validateDataset({ ...npc, asOf: new Date(receivedAt).toISOString(), bases: [...npc.bases.filter(base => !ids.has(base.id)), ...dynamic.bases] });
}
async function prepare(force, signal) {
  const current = context.telemetry(), now = Date.now();
  if (!force && prepared && now - prepared.pobAt < FIVE_MINUTES && (!current.receivedAt || current.receivedAt <= prepared.pobAt)) return prepared;
  const cache = await database('get').catch(() => null) || {};
  let npc = cache.npc, npcAt = cache.npcAt || 0, pobs = cache.pobs, pobAt = cache.pobAt || 0;
  let ships = cache.ships || FALLBACK_SHIPS, shipAt = cache.shipAt || 0;
  let owners = cache.owners || [], factions = cache.factions || [], tractors = cache.tractors || [];
  const tasks = [];
  if (!force && current.pobs?.length && current.receivedAt && !current.stale && now - current.receivedAt < FIVE_MINUTES) {
    pobs = current.pobs; pobAt = current.receivedAt;
  } else tasks.push(read('pobs', undefined, signal).then(data => { pobs = data; pobAt = Date.now(); }));
  if (force || !npc || now - npcAt > SIX_HOURS) tasks.push(read('commodities', { include_market_goods: true, filter_to_useful: true }, signal).then(data => {
    npc = normalizeDarkstat([], data); npcAt = Date.now();
  }));
  if (force || !shipAt || now - shipAt > DAY) tasks.push(read('ships', {}, signal).then(data => {
    ships = normalizeShipRegistry(data).map(ship => ({ ...ship, volumeClass: data.find(row => row.nickname === ship.nickname)?.ship_class ?? null }));
    shipAt = Date.now();
  }));
  if (force || !cache.accessAt || now - cache.accessAt > SIX_HOURS) {
    tasks.push(read('npc_bases', {}, signal).then(data => { owners = data; }));
    tasks.push(read('factions', { include_reputations: false, include_bribes: false, filter_to_useful: false }, signal).then(data => { factions = data; }));
    tasks.push(read('tractors', { include_rephacks: true, filter_nicknames: [BMM_ID] }, signal).then(data => { tractors = data; }));
  }
  const settled = await Promise.allSettled(tasks);
  if (signal.aborted) throw Error('Search canceled');
  const failures = settled.filter(entry => entry.status === 'rejected').map(entry => entry.reason?.message || 'Market request failed');
  if (!npc || !pobs?.length) throw Error(failures.join(' · ') || 'No market snapshot available');
  const dataset = mergeMarket(npc, pobs, pobAt);
  if (!findRhw(dataset)) throw Error('RHW was not found in the market snapshot');
  const navigation = prepared?.navigation || await loadNavigation(signal);
  const access = dockingAccess(dataset.bases, owners, factions, tractors);
  const saved = { npc, npcAt, pobs, pobAt, ships, shipAt, owners, factions, tractors,
    accessAt: failures.length ? cache.accessAt || 0 : now };
  await database('put', saved).catch(() => null);
  prepared = { dataset, navigation, ships, shipAt, pobAt, npcAt, access, failures };
  return prepared;
}
function preferredShips(ships) {
  const picks = [/advanced.train|advanced_train/i, /pilgrim/i, /longhorn/i];
  return [...new Map(picks.map(pattern => ships.find(ship => pattern.test(ship.name + ' ' + ship.nickname))).filter(Boolean).map(ship => [ship.id, ship])).values()];
}
function sourceMarkup() {
  if (!prepared) return 'Market data loads when you plan a supply run.';
  const cached = prepared.failures.length > 0 || Date.now() - prepared.pobAt >= FIVE_MINUTES || navigator.onLine === false;
  return `${cached ? 'CACHED POB STOCK' : 'POB STOCK RECEIVED'} ${date(prepared.pobAt)} · NPC PRICES ${date(prepared.npcAt)} · ${prepared.shipAt ? 'SHIP DATA ' + date(prepared.shipAt) : 'LAST VERIFIED SHIP PROFILES'}${prepared.failures.length ? ' · SOME UPLINKS FAILED; SAVED DATA IN USE' : ''}`;
}
function setBusy(value, message = '') {
  busy = value;
  $('supplySearch').disabled = value;
  $('supplyRefresh').disabled = value;
  $('supplyCancel').hidden = !value;
  dialog.querySelectorAll('form select,form input').forEach(control => { control.disabled = value; });
  $('supplyStatus').textContent = message;
  $('supplyStatus').setAttribute('aria-busy', value ? 'true' : 'false');
}
function shipOptions() {
  const selector = $('supplyShip'), selected = selector.value;
  const ships = prepared?.ships || FALLBACK_SHIPS;
  const auto = preferredShips(ships);
  selector.innerHTML = `<option value="auto">COMPARE · ${esc(auto.map(ship => ship.name).join(' / ') || 'available haulers')}</option>`
    + ships.map(ship => `<option value="${esc(ship.id)}">${esc(ship.name)} · ${count(ship.cargo)} hold · ${ship.cruise} m/s · ${ship.dockLabel}</option>`).join('');
  if (selected && [...selector.options].some(option => option.value === selected)) selector.value = selected;
}
function staleResults() {
  if (!result || busy) return;
  $('supplyStatus').textContent = 'SETTINGS CHANGED · CALCULATE TO UPDATE';
  $('supplyResults').dataset.stale = 'true';
}
function timePath(leg) {
  const nodes = new Map(prepared.navigation.nodes.map(node => [node.id, node]));
  const systems = [];
  const names = Object.fromEntries(prepared.dataset.bases.filter(base => base.system && base.systemName).map(base => [base.system, base.systemName]));
  for (const step of leg.flight?.path || []) if (step.kind === 'jump') {
    const from = names[step.fromSystem] || nodes.get(step.from)?.system || step.fromSystem;
    const to = names[step.toSystem] || nodes.get(step.to)?.system || step.toSystem;
    systems.push(`${from} → ${to}`);
  }
  return systems.length ? systems.join(' · ') : 'Within one system';
}
function renderResults() {
  $('supplySource').textContent = sourceMarkup();
  $('supplyResults').dataset.stale = 'false';
  if (!result?.results.length) {
    $('supplyResults').innerHTML = '<div class="supply-empty">NO USABLE SUPPLY ROUTE FOUND<p>A source needs a sale quotation, a reachable dock and known volumes. RHW needs an open purchase limit, cash and cargo space. Mined-only goods may have no market seller.</p></div>';
    return;
  }
  $('supplyResults').innerHTML = result.results.map((route, index) => {
    const extra = route.extraSeconds > 1 ? `+${duration(route.extraSeconds)} vs fast supply` : route.extraSeconds < -1 ? `${duration(-route.extraSeconds)} sooner` : 'No extra flight time';
    const warnings = [...new Set(route.stops)].filter(id => id !== result.origin && prepared.access.byId[id]?.state === 'unknown');
    const volume = route.legs.at(-1).volume;
    const comparison = route.recommendation;
    const timing = route.extraSeconds > 1 ? `about ${duration(route.extraSeconds)} longer` : route.extraSeconds < -1 ? `${duration(-route.extraSeconds)} sooner` : 'the same estimated time';
    const delivery = comparison?.fastDelivered === route.delivered ? `the same ${count(route.delivered)} units delivered` : `${count(route.delivered)} units delivered within the supply limit`;
    const reason = comparison?.kind === 'profit-within-limit'
      ? `<p class="supply-recommendation-reason"><strong>WHY THIS ROUTE</strong>${money(comparison.hourlyProfitDelta)} more per hour than fast supply, for ${timing} and ${delivery}.${comparison.profitDelta > 0 ? ` ${money(comparison.profitDelta)} more per run.` : ''}</p>` : '';
    return `<article class="supply-result${index === 0 ? ' supply-recommended' : ''}"><header><div><small>${esc(route.label)}</small><h3>${esc(route.ship.name)}</h3></div><span>${count(route.ship.cargo)} HOLD · ${route.ship.cruise} M/S</span></header>
      <div class="supply-itinerary">${route.legs.map((leg, i) => `${i === 0 ? '<span>RHW</span>' : ''}<b aria-hidden="true">→</b><span>${esc(leg.target === result.origin ? 'RHW' : leg.to)}</span>`).join('')}</div>
      <div class="supply-metrics"><div><small>DELIVER TO RHW</small><strong>${count(route.delivered)}</strong><span>${esc(result.commodity.name)}</span></div><div><small>EST. ROUND TRIP</small><strong>${duration(route.seconds)}</strong><span>${esc(extra)}</span></div><div><small>SUPPLY / HOUR</small><strong>${count(route.unitsPerHour)}</strong><span>units per hour</span></div><div><small>HAULER PROFIT</small><strong class="${route.profit < 0 ? 'supply-loss' : ''}">${money(route.profit)}</strong><span>${money(route.hourlyProfit)} / hour</span></div></div>
      ${reason}
      <p class="supply-ship-note">${route.ship.dockLabel} DOCK · ${volume} cargo volume / unit · Start capital ${money(route.capitalNeeded)} · RHW pays ${money(route.rhwPayout)}</p>
      ${warnings.length ? '<p class="supply-access-note">Personal reputation / POB access needs checking at ' + warnings.map(id => esc(prepared.dataset.bases.find(base => base.id === id)?.name || id)).join(', ') + '.</p>' : ''}
      <details class="supply-details"><summary>FLIGHT + TRADE STEPS</summary>${route.legs.map((leg, i) => `<section><h4>${i + 1}. ${esc(leg.from)} → ${esc(leg.to)}</h4><p>${leg.good ? `BUY ${count(route.quantities[i])} ${esc(leg.name)} · ${money(leg.buy)} each<br>SELL ${leg.target === result.origin ? 'TO RHW' : 'AT DESTINATION'} · ${money(leg.sell)} each · ${money(route.quantities[i] * leg.margin)} profit` : 'EMPTY APPROACH'}</p><small>${esc(leg.fromSystem || '')} → ${esc(leg.toSystem || '')} · ${duration(leg.flight.seconds)} flight · ${leg.flight.jumps} jumps</small><p class="supply-path">${esc(timePath(leg))}</p></section>`).join('')}
      <p>Estimates use trade lanes at 2,500 m/s, this ship's cruise speed, 15 s per jump, 30 s per docking operation and cruise/lane entry time. Interruptions and manual loading time may vary. Profit uses the hauler's purchase and sale quotations.</p></details></article>`;
  }).join('');
  const { stats } = result;
  $('supplyStatus').textContent = `${stats.ships} SHIPS · ${stats.sources} SOURCE COMPARISONS · ${stats.checked} QUOTES · MAX 1 EXTRA STOP / ${stats.extraPercent}% EXTRA TIME${stats.pruned || stats.timedOut ? ' · BEST FOUND WITHIN SEARCH LIMIT' : ''}`;
}
async function search(force = false) {
  const token = ++request;
  worker?.terminate(); worker = null;
  abort?.abort(); abort = new AbortController();
  const controller = abort, timeout = setTimeout(() => controller.abort(), 25000);
  setBusy(true, 'LOADING MARKETS + ROUTE MAP…');
  try {
    await prepare(force, controller.signal);
    clearTimeout(timeout);
    if (token !== request || !dialog.open) return;
    shipOptions(); $('supplySource').textContent = sourceMarkup();
    const shipId = $('supplyShip').value;
    const profiles = shipId === 'auto' ? preferredShips(prepared.ships) : prepared.ships.filter(ship => ship.id === shipId);
    if (!profiles.length) throw Error('No usable ship profile; select another ship.');
    const capital = $('supplyCapital').value.trim(), quantity = $('supplyQuantity').value.trim();
    if (capital && (!Number.isFinite(Number(capital)) || Number(capital) < 0)) throw Error('Enter a valid starting capital.');
    if (quantity && (!Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1)) throw Error('Delivery quantity must be a positive whole number.');
    worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (token !== request || data.id !== token) return;
      if (data.type === 'progress') $('supplyStatus').textContent = `${data.progress.phase === 'direct' ? 'CHECKING DIRECT SUPPLY' : 'CHECKING PROFITABLE APPROACHES'} · ${data.progress.checked} QUOTES`;
      if (data.type === 'error') { setBusy(false, data.message); worker?.terminate(); worker = null; }
      if (data.type === 'result') { result = data.result; setBusy(false); renderResults(); worker?.terminate(); worker = null; }
    };
    worker.onerror = () => { if (token === request) setBusy(false, 'Route worker unavailable. Reload RHW and try again.'); worker?.terminate(); worker = null; };
    worker.postMessage({ id: token, dataset: prepared.dataset, navigation: prepared.navigation, profiles,
      options: { commodity: $('supplyCommodity').value, extraPercent: Number($('supplyExtra').value), includePobs: $('supplyPobs').checked,
        capital: capital ? Number(capital) : null, quantity: quantity ? Number(quantity) : null, blocked: prepared.access.blocked } });
  } catch (error) {
    if (token === request && dialog.open) { setBusy(false, controller.signal.aborted ? 'UPLINK TIMED OUT · RETRY OR REFRESH MARKETS' : error.message); $('supplySource').textContent = sourceMarkup(); }
  } finally { clearTimeout(timeout); }
}
function stop() {
  request++; abort?.abort(); worker?.terminate(); worker = null;
  setBusy(false, 'SEARCH CANCELED · CALCULATE TO RESTART');
}
function mount() {
  if (dialog) return;
  dialog = document.createElement('dialog'); dialog.id = 'rhwSupplyDialog'; dialog.className = 'rhw-supply-dialog';
  dialog.setAttribute('aria-labelledby', 'supplyTitle');
  dialog.innerHTML = `<header class="supply-heading"><div><small>RHW LOGISTICS</small><h2 id="supplyTitle">SUPPLY RHW</h2><p>Bring the material home. Compare ships, delivery speed and hauling profit.</p></div><button type="button" id="supplyClose" aria-label="Close supply routes">CLOSE</button></header>
    <div class="supply-content"><form id="supplyForm"><div class="supply-fields"><label>COMMODITY<select id="supplyCommodity"></select></label><label>SHIP<select id="supplyShip"></select></label></div><details class="supply-settings"><summary>DELIVERY SETTINGS</summary><div class="supply-fields"><label>MAX EXTRA TIME<select id="supplyExtra"><option value="0">Direct supply only</option><option value="10">10% extra</option><option value="20" selected>20% extra</option><option value="35">35% extra</option><option value="50">50% extra</option></select></label><label>START CAPITAL · $<input id="supplyCapital" type="number" min="0" step="1" inputmode="numeric" placeholder="Show capital required"></label><label>DELIVERY QUANTITY<input id="supplyQuantity" type="number" min="1" step="1" inputmode="numeric" placeholder="Full hold within RHW limits"></label><label class="supply-check"><input id="supplyPobs" type="checkbox" checked>Include POB sellers</label></div><p>The recommended route gives the best positive $/hour within the selected extra-time allowance and comparable material throughput. Fast supply stays visible as an alternative. Every run starts and ends at RHW.</p></details><div class="supply-actions"><button type="submit" id="supplySearch">CALCULATE SUPPLY ROUTE</button><button type="button" id="supplyRefresh">REFRESH MARKETS</button><button type="button" id="supplyCancel" hidden>CANCEL SEARCH</button></div></form><p id="supplySource" class="supply-source"></p><p id="supplyStatus" role="status" aria-live="polite"></p><div id="supplyResults"></div></div>`;
  document.body.append(dialog);
  $('supplyClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    stop();
    // Wait for the native modal's focus/inert restoration before restoring the
    // context button (which may have been replaced by a telemetry render).
    requestAnimationFrame(() => {
      if (dialog.open) return;
      const visible = node => node?.isConnected && node.getClientRects().length > 0 && !node.closest('[hidden]');
      const trigger = visible(context?.trigger) ? context.trigger : [...document.querySelectorAll('[data-supply-commodity]')]
        .find(node => node.dataset.supplyCommodity === context?.commodity && visible(node));
      const oldCard = context?.trigger?.closest('.production-card');
      const card = oldCard?.isConnected ? oldCard : [...document.querySelectorAll('.production-card')]
        .find(node => oldCard && node.dataset.productionProduct === oldCard.dataset.productionProduct);
      // Desktop can hide the material list after a phone/desktop resize. Return
      // to a visible control on the same module rather than focusing hidden UI.
      const fallback = [...(card?.querySelectorAll('.production-card-toggle,.production-calc-button') || [])].find(visible);
      (trigger || fallback)?.focus({ preventScroll: true });
    });
  });
  $('supplyCancel').addEventListener('click', stop);
  $('supplyRefresh').addEventListener('click', () => search(true));
  $('supplyForm').addEventListener('submit', event => { event.preventDefault(); search(); });
  $('supplyForm').addEventListener('change', staleResults);
}
export function open(next) {
  mount(); context = next; result = null; $('supplyResults').innerHTML = '';
  const names = [...new Set([next.commodity, ...next.commodities].filter(Boolean))];
  $('supplyCommodity').innerHTML = names.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
  $('supplyCommodity').value = next.commodity || names[0];
  shipOptions();
  if (!dialog.open) dialog.showModal();
  search();
}
