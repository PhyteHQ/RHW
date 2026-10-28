import { normalizeDarkstat, validateDataset } from './core/trade.mjs';
import { validateNavigation } from './core/navigation.mjs';
import { FALLBACK_SHIPS, normalizeShipRegistry } from './ship-profiles.mjs';
import { dockingAccess, enrichBaseOwners, BMM_ID } from './access.mjs';
import { normalize, findRhw } from './planner.mjs';
import { commodityGroups } from './commodity-groups.mjs';
import { identityRegistry, parseIdentityRules, identityShipCheck } from './identity-profiles.mjs';

const API = 'https://darkstat.dd84ai.com/api/';
const CACHE = 'rhw-supply-market-v1';
const FIVE_MINUTES = 300000, SIX_HOURS = 21600000, DAY = 86400000;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const count = value => Math.round(value).toLocaleString('en-GB');
const money = value => `${value < 0 ? '-' : ''}$${count(Math.abs(value))}`;
const duration = seconds => `${Math.floor(Math.round(seconds) / 60)}:${String(Math.round(seconds) % 60).padStart(2, '0')}`;
const date = value => new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
let dialog, context, worker, abort, request = 0, prepared = null, result = null, busy = false;
const selectedByMode = { supply: '', export: '' };
const $ = id => dialog.querySelector('#' + id);
const exporting = () => $('supplyMode').value === 'export';

function commodityOptions(selected) {
  const names = [...new Set([context.commodity, ...context.commodities].filter(Boolean))];
  const mode = $('supplyMode').value;
  const groups = commodityGroups(names, context.exportCommodities, mode, context.importCommodities);
  const choices = groups.flatMap(group => group.names);
  $('supplyCommodity').innerHTML = groups
    .map(group => `<optgroup label="${esc(group.label)}">${group.names.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}</optgroup>`).join('');
  $('supplyCommodity').value = choices.find(name => normalize(name) === normalize(selected))
    || choices.find(name => normalize(name) === normalize(selectedByMode[mode])) || choices[0] || '';
  selectedByMode[mode] = $('supplyCommodity').value;
}
function updateMode(selected = $('supplyCommodity').value) {
  const out = exporting();
  commodityOptions(selected);
  dialog.querySelectorAll('[data-supply-only]').forEach(node => { node.hidden = out; });
  dialog.querySelectorAll('[data-export-only]').forEach(node => { node.hidden = !out; });
  $('supplyExtraLabel').textContent = out ? 'MAX RETURN DETOUR' : 'MAX EXTRA TIME';
  $('supplyExtra').options[0].textContent = out ? 'No extra stops' : 'Direct import only';
  $('supplySettingsTitle').textContent = out ? 'EXPORT SETTINGS' : 'IMPORT SETTINGS';
  $('supplyPobsLabel').textContent = out ? 'Include POB buyers' : 'Include POB sellers';
  $('supplyQuantity').placeholder = out ? 'Full hold within stock and buyer limits' : 'Full hold within RHW limits';
  $('supplySearch').textContent = out ? 'FIND EXPORT BUYERS' : 'CALCULATE IMPORT ROUTE';
  $('supplySettingsCopy').textContent = out
    ? 'Deliver the selected export first, then look for profitable return cargo to RHW or another buyer in New London. Return cargo may use one pickup and one delivery stop within the chosen extra-time limit. Export quantities stay fixed. Every trade respects funds, stock reserves, purchase limits, storage and your capital. The best full round-trip $/hour is recommended.'
    : 'Import priority defaults to the lowest material buy price within the time and delivery-rate limit. Equal prices favor the best whole-trip $/hour. You can also prioritize hauler income or supply speed. Standard imports buy at or below RHW’s payout; their delivery speed sets the allowance. Higher material prices appear separately as express options with a visible delivery loss. Every run starts and ends at RHW.';
}

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
    if (Array.isArray(body)) throw Error(`${path}: this API operation requires POST support`);
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
  let shipIdentityVersion = cache.shipIdentityVersion || 0, accessIdentityVersion = cache.accessIdentityVersion || 0;
  let owners = cache.owners || [], factions = cache.factions || [], tractors = cache.tractors || [];
  let identityCards = cache.identityPolicyVersion === 2 ? cache.identityCards || {} : {}, identityAt = cache.identityPolicyVersion === 2 ? cache.identityAt || 0 : 0;
  let identityPolicyVersion = cache.identityPolicyVersion || 0;
  const tasks = [];
  if (!force && current.pobs?.length && current.receivedAt && !current.stale && now - current.receivedAt < FIVE_MINUTES) {
    pobs = current.pobs; pobAt = current.receivedAt;
  } else tasks.push(read('pobs', undefined, signal).then(data => { pobs = data; pobAt = Date.now(); }));
  if (force || !npc || now - npcAt > SIX_HOURS) tasks.push(read('commodities', { include_market_goods: true, filter_to_useful: true }, signal).then(data => {
    npc = normalizeDarkstat([], data); npc.bases = enrichBaseOwners(npc.bases, [], [], data); npcAt = Date.now();
  }));
  if (force || !shipIdentityVersion || !shipAt || now - shipAt > DAY) tasks.push(read('ships', { include_tech_compat: true }, signal).then(data => {
    ships = normalizeShipRegistry(data);
    shipIdentityVersion = 1;
    shipAt = Date.now();
  }));
  if (force || accessIdentityVersion < 2 || !cache.accessAt || now - cache.accessAt > SIX_HOURS) {
    tasks.push(read('npc_bases', {}, signal).then(data => { owners = data; }));
    tasks.push(read('factions', { include_reputations: false, include_bribes: false, filter_to_useful: false }, signal).then(data => { factions = data; }));
    tasks.push(read('tractors', { include_rephacks: true, include_market_goods: true, filter_to_useful: true }, signal).then(data => { tractors = data; accessIdentityVersion = 2; }));
  }
  const settled = await Promise.allSettled(tasks);
  if (signal.aborted) throw Error('Search canceled');
  const failures = settled.filter(entry => entry.status === 'rejected').map(entry => entry.reason?.message || 'Market request failed');
  if (force || !identityAt || now - identityAt > SIX_HOURS) {
    const nicknames = identityRegistry(tractors).filter(id => tractors.some(raw => raw.nickname === id.id)).map(id => id.id);
    if (nicknames.length) try {
      const replies = await read('infocards', nicknames, signal);
      if (replies.length !== nicknames.length) throw Error('ID infocard response length does not match the requested IDs');
      identityCards = Object.fromEntries(nicknames.map((id, index) => [id, { rules: parseIdentityRules(replies[index]) }]));
      identityAt = Date.now(); identityPolicyVersion = 2;
    } catch (error) { failures.push('ID ship rules: ' + error.message); }
    if (signal.aborted) throw Error('Search canceled');
  }
  if (!npc || !pobs?.length) throw Error(failures.join(' · ') || 'No market snapshot available');
  const dataset = mergeMarket(npc, pobs, pobAt);
  if (!findRhw(dataset)) throw Error('RHW was not found in the market snapshot');
  const navigation = prepared?.navigation || await loadNavigation(signal);
  const identities = identityRegistry(tractors, identityCards, identityAt);
  const access = dockingAccess(dataset.bases, owners, factions, tractors, BMM_ID, pobs);
  const saved = { npc, npcAt, pobs, pobAt, ships, shipAt, owners, factions, tractors,
    identityCards, identityAt, identityPolicyVersion, shipIdentityVersion, accessIdentityVersion,
    accessAt: failures.length ? cache.accessAt || 0 : now };
  await database('put', saved).catch(() => null);
  prepared = { dataset, navigation, ships, shipAt, pobAt, npcAt, access, failures, identities,
    identityAt, owners, factions, tractors, pobs, accessByIdentity: new Map([[BMM_ID, access]]) };
  return prepared;
}
function sourceMarkup() {
  if (!prepared) return 'Market data loads when you open the Trade Desk.';
  const cached = prepared.failures.length > 0 || Date.now() - prepared.pobAt >= FIVE_MINUTES || navigator.onLine === false;
  return `${cached ? 'CACHED POB STOCK' : 'POB STOCK RECEIVED'} ${date(prepared.pobAt)} · NPC PRICES ${date(prepared.npcAt)} · ${prepared.shipAt ? 'SHIP DATA ' + date(prepared.shipAt) : 'LAST VERIFIED SHIP PROFILES'} · ${prepared.identityAt ? 'ID RULES ' + date(prepared.identityAt) : 'ID SHIP RULES UNAVAILABLE'}${prepared.failures.length ? ' · SOME UPLINKS FAILED; SAVED DATA IN USE' : ''}`;
}
function selectedIdentities() {
  const ids = prepared?.identities || identityRegistry();
  return $('supplyIdentity').value === 'all' ? ids
    : ids.filter(id => id.id === ($('supplyIdentity').value || BMM_ID));
}
function accessFor(identityId = BMM_ID) {
  if (!prepared.accessByIdentity.has(identityId)) prepared.accessByIdentity.set(identityId,
    dockingAccess(prepared.dataset.bases, prepared.owners, prepared.factions, prepared.tractors, identityId, prepared.pobs));
  return prepared.accessByIdentity.get(identityId);
}
function identityOptions() {
  const selector = $('supplyIdentity'), selected = selector.value || 'all';
  const ids = prepared?.identities || identityRegistry();
  selector.innerHTML = '<option value="all">AUTO · All available IDs</option>'
    + ids.map(id => `<option value="${esc(id.id)}">${esc(id.name)}</option>`).join('');
  selector.value = ids.some(id => id.id === selected) || selected === 'all' ? selected : 'all';
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
  const ids = selectedIdentities();
  selector.innerHTML = '<option value="auto">AUTO · Best permitted haulers</option>'
    + ships.map(ship => {
      const blocked = ids.length && ids.every(id => identityShipCheck(id, ship).state === 'blocked');
      return `<option value="${esc(ship.id)}"${blocked ? ' disabled' : ''}>${esc(ship.name)} · ${count(ship.cargo)} hold · ${ship.cruise} m/s · ${ship.dockLabel}${blocked ? ' · ID RESTRICTED' : ''}</option>`;
    }).join('');
  if (selected && [...selector.options].some(option => option.value === selected && !option.disabled)) selector.value = selected;
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
function identityMarkup(route) {
  const compatible = route.compatibleIdentities || (route.identity ? [{ identity: route.identity, shipCheck: route.shipCheck }] : []);
  const checked = compatible.filter(row => row.shipCheck.state === 'checked');
  const conditional = compatible.filter(row => row.shipCheck.state !== 'checked');
  const tags = rows => rows.map(row => '<span data-compatible-identity="' + esc(row.identity.id) + '">' + esc(row.identity.name) + '</span>').join('');
  const extra = checked.length > 6 ? '<details><summary>SHOW ALL ' + checked.length + ' COMPATIBLE IDs</summary><div class="supply-id-tags">' + tags(checked.slice(6)) + '</div></details>' : '';
  const pending = conditional.length ? '<details><summary>' + conditional.length + ' CONDITIONAL ID' + (conditional.length === 1 ? '' : 's') + ' · CHECK RULES / ACCESS</summary>' + conditional.slice(0, 8).map(row => '<p><b>' + esc(row.identity.name) + '</b> · ' + esc(row.shipCheck.reason) + '</p>').join('') + (conditional.length > 8 ? '<p>' + (conditional.length - 8) + ' more conditional profiles omitted.</p>' : '') + '</details>' : '';
  return '<div class="supply-identity-note" data-state="' + (checked.length ? 'checked' : 'conditional') + '"><strong>' + (checked.length ? 'COMPATIBLE IDs · ' + checked.length : 'CONDITIONAL ACCESS') + '</strong><div class="supply-id-tags">' + tags(checked.slice(0, 6)) + '</div><small>For this ship and every stop, including return cargo. Personal reputation, membership and POB permissions still apply.</small>' + extra + pending + '</div>';
}
function renderResults() {
  $('supplySource').textContent = sourceMarkup();
  $('supplyResults').dataset.stale = 'false';
  if (result?.mode === 'export') { renderExports(); return; }
  if (!result?.results.length) {
    $('supplyResults').innerHTML = '<div class="supply-empty">NO USABLE IMPORT ROUTE FOUND<p>' + esc(result?.reason || 'A source needs a sale quotation, a reachable dock and known volumes. RHW needs an open purchase limit, cash and cargo space. Mined-only goods may have no market seller.') + '</p></div>';
    return;
  }
  $('supplyResults').innerHTML = result.results.map(route => {
    const extra = route.extraSeconds > 1 ? `+${duration(route.extraSeconds)} vs standard import` : route.extraSeconds < -1 ? `${duration(-route.extraSeconds)} sooner` : 'No extra flight time';
    const warnings = [...new Set(route.stops)].filter(id => id !== result.origin && accessFor(route.identity?.id).byId[id]?.state === 'unknown');
    const volume = route.legs.at(-1).volume;
    const comparison = route.recommendation;
    const timing = route.extraSeconds > 1 ? `about ${duration(route.extraSeconds)} longer` : route.extraSeconds < -1 ? `${duration(-route.extraSeconds)} sooner` : 'the same estimated time';
    const delivery = comparison?.fastDelivered === route.delivered ? `the same ${count(route.delivered)} units delivered` : `${count(route.delivered)} units delivered within the import limit`;
    const economics = route.delivery;
    const express = economics?.loss > 1e-6;
    const expressNote = express ? `<p class="supply-express-note"><strong>EXPRESS · MATERIAL DELIVERY LOSS</strong>Buy at ${money(economics.buyPerUnit)} per unit and deliver to RHW at ${money(economics.rhwPerUnit)}: ${money(-economics.loss)} on the material delivery. Whole-run hauler profit: ${money(route.profit)}, including the other trades.</p>` : '';
    const reason = comparison?.kind === 'lowest-price'
      ? `<p class="supply-recommendation-reason"><strong>WHY THIS ROUTE</strong>Lowest material purchase price within the time and delivery-rate limit.${comparison.buyPriceDelta > 1e-6 ? ` ${money(comparison.buyPriceDelta)} less per unit than fast standard import.` : ' Equal purchase prices are compared by whole-trip $/hour.'}${comparison.hourlyProfitDelta > .01 ? ` ${money(comparison.hourlyProfitDelta)} more per hour than fast standard import.` : ''}</p>`
      : comparison?.kind === 'profit-within-limit'
      ? `<p class="supply-recommendation-reason"><strong>WHY THIS ROUTE</strong>${money(comparison.hourlyProfitDelta)} more per hour than fast standard import, for ${timing} and ${delivery}.${comparison.profitDelta > 0 ? ` ${money(comparison.profitDelta)} more per run.` : ''}</p>` : '';
    return `<article class="supply-result${route.recommendation ? ' supply-recommended' : express ? ' supply-express' : ''}"><header><div><small>${esc(route.label)}</small><h3>${esc(route.ship.name)}</h3></div><span>${count(route.ship.cargo)} HOLD · ${route.ship.cruise} M/S</span></header>
      ${identityMarkup(route)}
      ${expressNote}
      <div class="supply-itinerary">${route.legs.map((leg, i) => `${i === 0 ? '<span>RHW</span>' : ''}<b aria-hidden="true">→</b><span>${esc(leg.target === result.origin ? 'RHW' : leg.to)}</span>`).join('')}</div>
      <div class="supply-metrics"><div><small>DELIVER TO RHW</small><strong>${count(route.delivered)}</strong><span>${esc(result.commodity.name)}</span></div><div><small>EST. ROUND TRIP</small><strong>${duration(route.seconds)}</strong><span>${esc(extra)}</span></div><div><small>SUPPLY / HOUR</small><strong>${count(route.unitsPerHour)}</strong><span>units per hour</span></div><div><small>HAULER PROFIT</small><strong class="${route.profit < 0 ? 'supply-loss' : ''}">${money(route.profit)}</strong><span>${money(route.hourlyProfit)} / hour</span></div></div>
      ${reason}
      ${economics ? `<p class="supply-target-price">MATERIAL PURCHASE ${money(economics.cost)} · ${money(economics.buyPerUnit)} / UNIT · RHW PAYS ${money(economics.rhwPerUnit)} / UNIT</p>` : ''}
      <p class="supply-ship-note">${route.ship.dockLabel} DOCK · ${volume} cargo volume / unit · Start capital ${money(route.capitalNeeded)} · RHW pays ${money(route.rhwPayout)}</p>
      ${warnings.length ? '<p class="supply-access-note">Personal reputation / POB access needs checking at ' + warnings.map(id => esc(prepared.dataset.bases.find(base => base.id === id)?.name || id)).join(', ') + '.</p>' : ''}
      <details class="supply-details"><summary>FLIGHT + TRADE STEPS</summary>${route.legs.map((leg, i) => `<section><h4>${i + 1}. ${esc(leg.from)} → ${esc(leg.to)}</h4><p>${leg.good ? `BUY ${count(route.quantities[i])} ${esc(leg.name)} · ${money(leg.buy)} each<br>SELL ${leg.target === result.origin ? 'TO RHW' : 'AT DESTINATION'} · ${money(leg.sell)} each · ${money(route.quantities[i] * leg.margin)} profit` : 'EMPTY APPROACH'}</p><small>${esc(leg.fromSystem || '')} → ${esc(leg.toSystem || '')} · ${duration(leg.flight.seconds)} flight · ${leg.flight.jumps} jumps</small><p class="supply-path">${esc(timePath(leg))}</p></section>`).join('')}
      <p>Estimates use trade lanes at 2,500 m/s, this ship's cruise speed, 15 s per jump, 30 s per docking operation and cruise/lane entry time. Interruptions and manual loading time may vary. Hauler profit includes buying from and selling to RHW. Company manufacturing profit is separate.</p></details></article>`;
  }).join('');
  const { stats } = result;
  $('supplyStatus').textContent = `${stats.identities || 1} ID POLICIES · ${stats.ships} SHIPS · ${stats.sources} SOURCE COMPARISONS · ${stats.checked} QUOTES · MAX 1 EXTRA STOP / ${stats.extraPercent}% EXTRA TIME${stats.expressOnly ? ' · NO LOSS-FREE DELIVERY FOUND; EXPRESS OPTIONS SHOWN' : ' · TIME LIMIT BASED ON STANDARD IMPORTS'}${stats.pruned || stats.timedOut ? ' · BEST FOUND WITHIN SEARCH LIMIT' : ''}`;
}

function renderExports() {
  if (!result.results.length) {
    $('supplyResults').innerHTML = '<div class="supply-empty">NO USABLE EXPORT BUYER FOUND<p>' + esc(result.reason || 'RHW needs a sale quote and stock above its reserve. Buyers need a reachable dock, an open purchase quotation and known cargo volumes. POB funds, free storage and purchase limits must be reported; unknown limits are not treated as unlimited.') + '</p></div>';
    $('supplyStatus').textContent = `${result.stats.ships} SHIPS · ${result.stats.checked} QUOTES · NO VERIFIED EXPORT CAPACITY${result.stats.timedOut ? ' · SEARCH TIME LIMIT REACHED' : ''}`;
    return;
  }
  $('supplyResults').innerHTML = result.results.map(route => {
    const buyer = route.buyer, back = route.returnTrade;
    const exportLoss = (route.outboundProfit ?? route.profit) < 0;
    const warnings = [...new Set(route.stops)].filter(id => id !== result.origin && accessFor(route.identity?.id).byId[id]?.state === 'unknown');
    const limits = buyer.kind === 'pob' ? `<div class="supply-buyer-grid"><div><small>BUYER FUNDS</small><strong>${money(buyer.cash)}</strong></div><div><small>OPEN PURCHASE LIMIT</small><strong>${count(buyer.demand)} units</strong></div><div><small>FREE BUYER STORAGE</small><strong>${count(buyer.space)}</strong></div></div>` : '<p class="supply-ship-note">NPC buyer · no POB cash or storage limits</p>';
    const alternative = route.returnAlternative;
    const emptyNote = !result.stats.returnEnabled ? 'Return cargo is disabled in Export Settings.' : exportLoss ? 'A return trade does not turn a loss-making export into a recommendation.'
      : !route.returnChecked ? 'Return-cargo search did not reach this quote within the search limit.'
      : alternative ? `The best paid return found (${esc(alternative.name)}) adds ${money(alternative.profit)} and ${duration(Math.max(0, alternative.extraSeconds))}, but reduces the full-trip rate to ${money(alternative.hourlyProfit)} / hour. The empty return keeps the higher $/hour.`
      : `No profitable return found among the checked markets within ${result.stats.extraPercent}% extra time and the reported cash, stock and storage limits.`;
    const backMarkup = back ? `<section class="supply-return-cargo"><small>RETURN CARGO</small><h4>${count(back.quantity)} ${esc(back.name)} <span>+${money(back.profit)}</span></h4><p>${esc(back.from)} → ${esc(back.to)} · BUY ${money(back.buy)} / UNIT · SELL ${money(back.sell)} / UNIT</p><p>EXPORT MARGIN ${money(route.outboundProfit)} + RETURN MARGIN ${money(back.profit)} = ${money(route.profit)} PER RUN</p><p>${duration(Math.max(0, route.extraSeconds))} extra vs empty return · ${money(route.hourlyProfit - route.emptyReturn.hourlyProfit)} / hour more · Return load limited by ${esc(back.limiting.join(' / '))}</p></section>`
      : `<p class="supply-ship-note supply-return-note">EMPTY RETURN · ${emptyNote}</p>`;
    return `<article class="supply-result${route.recommendation ? ' supply-recommended' : exportLoss || route.profit <= 0 ? ' supply-express' : ''}"><header><div><small>${esc(route.label)}</small><h3>${esc(buyer.name)}</h3></div><span>${esc(route.ship.name)} · ${count(route.ship.cargo)} HOLD</span></header>
      ${identityMarkup(route)}
      ${exportLoss || route.profit <= 0 ? '<p class="supply-express-note"><strong>NO PROFITABLE HAULER EXPORT</strong>This buyer pays at or below RHW’s sale price. The export margin is shown separately from any return trade; this is not a profitable export recommendation.</p>' : ''}
      <div class="supply-itinerary"><span>RHW</span>${route.legs.map(leg => `<b aria-hidden="true">→</b><span>${esc(leg.target === result.origin ? 'RHW' : leg.to)}${!leg.good ? ' · empty' : ''}</span>`).join('')}</div>
      <div class="supply-metrics"><div><small>SELL AT DESTINATION</small><strong>${count(route.delivered)}</strong><span>${esc(result.commodity.name)}</span></div><div><small>EST. ROUND TRIP</small><strong>${duration(route.seconds)}</strong><span>${duration(route.deliverySeconds)} until export delivery</span></div><div><small>RHW EXPORT RECEIPTS</small><strong>${money(route.rhwRevenue)}</strong><span>export revenue, before costs</span></div><div><small>HAULER PROFIT</small><strong class="${route.profit < 0 ? 'supply-loss' : ''}">${money(route.profit)}</strong><span>${money(route.hourlyProfit)} / hour</span></div></div>
      <p class="supply-target-price">BUY EXPORT FROM RHW ${money(route.leg.buy)} / UNIT · EXPORT BUYER PAYS ${money(buyer.price)} / UNIT</p>
      ${limits}
      <p class="supply-ship-note">EXPORT LOAD LIMITED BY ${esc(route.limiting.join(' / '))} · ${count(route.availableAtRhw)} units available above RHW’s reserve · Start capital ${money(route.capitalNeeded)}</p>
      ${backMarkup}
      ${warnings.length ? `<p class="supply-access-note">Docking access is not confirmed at ${warnings.map(id => esc(prepared.dataset.bases.find(base => base.id === id)?.name || id)).join(', ')}. Check owner permissions at POBs and personal reputation at NPC bases.</p>` : ''}
      <details class="supply-details"><summary>FLIGHT + TRADE STEPS</summary>${route.legs.map((leg, i) => `<section><h4>${i + 1}. ${esc(leg.from)} → ${esc(leg.to)}</h4><p>${leg.good ? `BUY ${count(route.quantities[i])} ${esc(leg.name)} · ${money(leg.buy)} each<br>SELL AT DESTINATION · ${money(leg.sell)} each · ${money(route.quantities[i] * leg.margin)} hauling profit` : 'EMPTY TRANSFER'}</p><small>${esc(leg.fromSystem || '')} → ${esc(leg.toSystem || '')} · ${duration(leg.flight.seconds)} flight · ${leg.flight.jumps} jumps</small><p class="supply-path">${esc(timePath(leg))}</p></section>`).join('')}
      <p>Full-trip estimates include every return leg and docking stop, trade lanes at 2,500 m/s, this ship’s cruise speed, 15 s per jump and 30 s per docking operation. Hauler profit subtracts all purchases. RHW export receipts are revenue before manufacturing costs and return purchases. POB funds and stock limits can change before arrival.</p></details></article>`;
  }).join('');
  const stats = result.stats;
  $('supplyStatus').textContent = `${stats.identities || 1} ID POLICIES · ${stats.ships} SHIPS · ${stats.sources} BUYER COMPARISONS · ${stats.checked} EXPORT / ${stats.returnChecked} RETURN QUOTES${stats.returnEnabled ? ` · MAX ${stats.extraPercent}% RETURN DETOUR` : ' · RETURN CARGO OFF'}${stats.noProfit ? ' · NO POSITIVE EXPORT MARGIN' : ''}${stats.timedOut || stats.pruned ? ' · BEST FOUND WITHIN SEARCH LIMIT' : ''}`;
}
async function search(force = false) {
  const token = ++request;
  worker?.terminate(); worker = null;
  abort?.abort(); abort = new AbortController();
  const controller = abort, timeout = setTimeout(() => controller.abort(), 25000);
  setBusy(true, 'LOADING MARKETS + ROUTE MAP…');
  $('supplyResults').dataset.stale = 'true';
  try {
    await prepare(force, controller.signal);
    clearTimeout(timeout);
    if (token !== request || !dialog.open) return;
    identityOptions(); shipOptions(); $('supplySource').textContent = sourceMarkup();
    const shipId = $('supplyShip').value;
    const profiles = prepared.ships;
    if (!profiles.length) throw Error('No usable ship profile; select another ship.');
    if (!$('supplyCommodity').value) throw Error(exporting() ? 'No export goods are configured for RHW.' : 'No import goods are configured for RHW.');
    const capital = $('supplyCapital').value.trim(), quantity = $('supplyQuantity').value.trim();
    if (capital && (!Number.isFinite(Number(capital)) || Number(capital) < 0)) throw Error('Enter a valid starting capital.');
    if (quantity && (!Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1)) throw Error('Delivery quantity must be a positive whole number.');
    worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (token !== request || data.id !== token) return;
      if (data.type === 'progress') $('supplyStatus').textContent = `${data.progress.identity ? data.progress.identity + ' · ' : ''}${data.progress.phase === 'profiles' ? 'MATCHING IDS + SHIPS TO ROUTES' : data.progress.phase === 'return' ? 'CHECKING PROFITABLE RETURN CARGO' : data.progress.phase === 'export' ? 'CHECKING EXPORT BUYERS' : data.progress.phase === 'direct' ? 'CHECKING DIRECT IMPORTS' : 'CHECKING PROFITABLE APPROACHES'} · ${data.progress.checked} QUOTES`;
      if (data.type === 'error') { setBusy(false, data.message); worker?.terminate(); worker = null; }
      if (data.type === 'result') { result = data.result; setBusy(false); renderResults(); worker?.terminate(); worker = null; }
    };
    worker.onerror = () => { if (token === request) setBusy(false, 'Route worker unavailable. Reload RHW and try again.'); worker?.terminate(); worker = null; };
    worker.postMessage({ id: token, dataset: prepared.dataset, navigation: prepared.navigation, profiles,
      scopes: prepared.identities.map(identity => ({ identity, blocked: accessFor(identity.id).blocked,
        accessReady: accessFor(identity.id).ready, approvalDocks: accessFor(identity.id).approvalDocks, unverifiedDocks: accessFor(identity.id).unverifiedDocks })),
      options: { mode: $('supplyMode').value, commodity: $('supplyCommodity').value, extraPercent: Number($('supplyExtra').value), returnCargo: $('supplyBackhaul').checked, includePobs: $('supplyPobs').checked,
        shipId, includeUnverified: $('supplyUnverified').checked, identityId: $('supplyIdentity').value, importGoal: $('supplyImportGoal').value, includeRestrictedPobs: $('supplyRestrictedPobs').checked,
        capital: capital ? Number(capital) : null, quantity: quantity ? Number(quantity) : null } });
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
  dialog.innerHTML = `<header class="supply-heading"><div><small>RHW LOGISTICS</small><h2 id="supplyTitle">RHW TRADE DESK</h2><p>Plan imports to RHW and exports from RHW. Compare ships, time and hauling profit.</p></div><button type="button" id="supplyClose" aria-label="Close Trade Desk">CLOSE</button></header>
    <div class="supply-content"><p class="supply-source">Find the best route across available IDs, then see which IDs work with the recommended ship. Keep one ID for the whole trip. Ship and ID purchase costs are excluded.</p><form id="supplyForm"><div class="supply-fields supply-main-fields"><label>TRADE MODE<select id="supplyMode"><option value="supply">IMPORT</option><option value="export">EXPORT</option></select></label><label>COMMODITY<select id="supplyCommodity"></select></label><label>SHIP<select id="supplyShip"></select></label></div><details class="supply-settings"><summary id="supplySettingsTitle">IMPORT SETTINGS</summary><div class="supply-fields"><label>LIMIT TO ID<select id="supplyIdentity"><option value="all">AUTO · All available IDs</option></select></label><label data-supply-only>IMPORT PRIORITY<select id="supplyImportGoal"><option value="price">Lowest buy price within time limit</option><option value="income">Best hauler $/hour within time limit</option><option value="speed">Fastest supply rate</option></select></label><label><span id="supplyExtraLabel">MAX EXTRA TIME</span><select id="supplyExtra"><option value="0">Direct import only</option><option value="10">10% extra</option><option value="20" selected>20% extra</option><option value="35">35% extra</option><option value="50">50% extra</option></select></label><label>START CAPITAL · $<input id="supplyCapital" type="number" min="0" step="1" inputmode="numeric" placeholder="Show capital required"></label><label>DELIVERY QUANTITY<input id="supplyQuantity" type="number" min="1" step="1" inputmode="numeric" placeholder="Full hold within RHW limits"></label><label class="supply-check" data-export-only hidden><input id="supplyBackhaul" type="checkbox" checked>Find profitable return cargo</label><label class="supply-check"><input id="supplyPobs" type="checkbox" checked><span id="supplyPobsLabel">Include POB sellers</span></label><label class="supply-check"><input id="supplyUnverified" type="checkbox">Include unverified ID / docking rules · conditional quotes</label><label class="supply-check"><input id="supplyRestrictedPobs" type="checkbox">Include approval-only POBs · conditional quotes</label></div><p id="supplySettingsCopy"></p></details><div class="supply-actions"><button type="submit" id="supplySearch">CALCULATE IMPORT ROUTE</button><button type="button" id="supplyRefresh">REFRESH MARKETS</button><button type="button" id="supplyCancel" hidden>CANCEL SEARCH</button></div></form><p id="supplySource" class="supply-source"></p><p id="supplyStatus" role="status" aria-live="polite"></p><div id="supplyResults"></div></div>`;
  document.body.append(dialog);
  $('supplyClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    stop();
    // Wait for the native modal's focus/inert restoration before restoring the
    // context button (which may have been replaced by a telemetry render).
    requestAnimationFrame(() => {
      if (dialog.open) return;
      const visible = node => node?.isConnected && node.getClientRects().length > 0 && !node.closest('[hidden]');
      const trigger = visible(context?.trigger) ? context.trigger : [...document.querySelectorAll('[data-supply-commodity],[data-export-commodity]')]
        .find(node => (node.dataset.supplyCommodity || node.dataset.exportCommodity) === context?.commodity && visible(node));
      const oldCard = context?.trigger?.closest('.production-card');
      const card = oldCard?.isConnected ? oldCard : [...document.querySelectorAll('.production-card')]
        .find(node => oldCard && node.dataset.productionProduct === oldCard.dataset.productionProduct);
      // Desktop can hide the material list after a phone/desktop resize. Return
      // to a visible control on the same module rather than focusing hidden UI.
      const fallback = [...(card?.querySelectorAll('.production-card-toggle,.production-calc-button') || [])].find(visible);
      (trigger || fallback || document.querySelector('.header-trade-button'))?.focus({ preventScroll: true });
    });
  });
  $('supplyCancel').addEventListener('click', stop);
  $('supplyRefresh').addEventListener('click', () => search(true));
  $('supplyForm').addEventListener('submit', event => { event.preventDefault(); search(); });
  $('supplyForm').addEventListener('change', event => {
    if (event.target.id === 'supplyMode') {
      result = null; $('supplyResults').innerHTML = ''; updateMode(selectedByMode[$('supplyMode').value]); search();
    } else if (event.target.id === 'supplyIdentity') {
      result = null; $('supplyResults').innerHTML = ''; shipOptions(); search();
    } else {
      if (event.target.id === 'supplyCommodity') selectedByMode[$('supplyMode').value] = $('supplyCommodity').value;
      staleResults();
    }
  });
}
export function open(next) {
  mount(); context = next; result = null; $('supplyResults').innerHTML = '';
  const selected = next.commodity || $('supplyCommodity').value;
  if (next.mode) $('supplyMode').value = next.mode;
  updateMode(selected);
  identityOptions(); shipOptions();
  if (!dialog.open) dialog.showModal();
  search();
}
