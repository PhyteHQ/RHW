#!/usr/bin/env python3
"""CI integration check of the actual bundled site, local fonts and offline shell."""
import base64
import functools
import http.server
import json
import os
import threading
import time
from pathlib import Path

import smoke_v40_base as base

OUT = base.ROOT / 'artifacts/interface'
WIDTHS = (360, 390, 430, 820, 911, 1024, 1093, 1366, 1920)
ROUTES = ('command/inventory', 'command/shipyard', 'command/production', 'command/logistics',
          'operations/calculator', 'pricecheck/routes', 'comms/forum', 'comms/drafts', 'comms/senders')
STOCK = {'Basic Alloy': 19129, 'Consumer Goods': 24793, 'Food Rations': 22451,
         'Gold Ore': 13500, 'Niobium Ore': 42000, 'Scrap Metal': 16020,
         'Gold': 3000, 'Niobium': 5800, 'Prototype Components': 825,
         'Multi-Mode Focusing Chamber': 2000, 'Reactor Systems': 500,
         'Superstructure Systems': 110, 'Avionics Systems': 420, 'Interior Systems': 300,
         'Propulsion Systems': 350, 'Exotic Systems': 250,
         'Crew': 2400, 'Archon Design Schematics': 1, 'MOX': 5888, 'Toxic Waste': 21065,
         'Military Salvage': 7300, 'Hull Panels': 25000, 'Energy Field Equipment': 20000,
         'Industrial Materials': 20000, 'Uranium': 0, 'Super Alloy': 5000,
         'Hydrocarbons': 20000, 'Titanium': 5000, 'Ablative Armor Plating': 20000}
DATA = [{'name': 'Resolution Heavy Works', 'nickname': 'fixture-rhw', 'system_name': 'New London',
         'system_nickname': 'br01', 'base_pos': {'X': -23000, 'Y': 0, 'Z': 52000}, 'money': 46385683,
         'cargospace': 63777, 'health': 24000000,
         'shop_items': [{'name': k, 'quantity': v, 'sell_price': 100, 'buy_price': 80,
                         'category': 'equipment' if k == 'Archon Design Schematics' else 'commodity'} for k, v in STOCK.items()]},
        {'name': 'Lissheen Logistics Depot', 'system_name': 'Dublin', 'shop_items': [
            {'name': k, 'quantity': v, 'sell_price': 105, 'buy_price': 80} for k, v in STOCK.items()]}]
DATA[0]['shop_items'] += [
    {'name': 'Dunkirk-Class Battleship', 'nickname': 'dsy_br_battleship_package', 'quantity': 3, 'max_stock': 5, 'min_stock': 0, 'price': 8500000},
    {'name': 'Invincible-Class Dreadnought', 'nickname': 'dsy_br_carrier', 'quantity': 1, 'max_stock': 5, 'min_stock': 0, 'price': 8500000},
    {'name': 'Modular Miner', 'nickname': 'medium_miner_package', 'quantity': 2, 'max_stock': 5, 'min_stock': 0, 'price': 18000000},
]

NPC_GOODS = {'ship_hull_panels': 'Hull Panels', 'industrial': 'Industrial Materials', 'mox_fuel': 'MOX',
             'titanium': 'Titanium', 'energy_field_equip': 'Energy Field Equipment', 'super_alloys': 'Super Alloy',
             'ablativearmor': 'Ablative Armor Plating', 'food': 'Food Rations', 'hydrocarbons': 'Hydrocarbons',
             'consumer_goods': 'Consumer Goods', 'mining_machinery': 'Mining Machinery', 'uranium': 'Uranium', 'oxygen': 'Oxygen'}
NPC_DATA = [{'name': name, 'nickname': nickname, 'system_name': system,
             'system_nickname': {'Cambridge': 'br03', 'New London': 'br01', 'New Berlin': 'rh01'}[system],
             'market_goods': [{'name': NPC_GOODS[good], 'nickname': f'commodity_{good}', 'category': 'commodity',
                               'base_sells': True, 'price_base_sells_for': price} for good, price in offers]}
            for name, nickname, system, offers in (
                ('Portsmouth Shipyard', 'br01_02_base', 'Cambridge', [('ship_hull_panels', 80)]),
                ('Planet New London', 'br01_01_base', 'New London', [('industrial', 80), ('food', 70), ('consumer_goods', 90), ('oxygen', 90), ('ablativearmor', 90)]),
                ('Thames Outpost', 'br01_06_base', 'New London', [('hydrocarbons', 80), ('mox_fuel', 80), ('mining_machinery', 80), ('uranium', 85)]),
                ('Kensington Shipping Platform', 'br01_07_base', 'New London', [('titanium', 80), ('hydrocarbons', 95)]),
                ('Planet Cambridge', 'br03_01_base', 'Cambridge', [('energy_field_equip', 80)]),
                ('Waterloo Station', 'br01_04_base', 'New London', [('super_alloys', 80), ('mining_machinery', 87)]),
                ('Oder Shipyard', 'rh01_02_base', 'New Berlin', [('ablativearmor', 80), ('ship_hull_panels', 105)]))]
for station in range(50):
    NPC_DATA.append({'name': f'Unrelated Market {station}', 'nickname': f'other-market-{station}',
                     'system_name': 'New London', 'system_nickname': 'br01',
                     'market_goods': [{'name': f'Market Only Good {index}', 'nickname': f'commodity_market_only_{index}',
                                       'category': 'commodity', 'base_sells': True, 'price_base_sells_for': 70}
                                      for index in range(54)]})
PRICE_ROW_COUNT = len(STOCK) - 1
PRICE_SOURCE_COUNT = 11
PRICE_OFFER_COUNT = 14
PRICE_CHECK_FIXTURES = {
    '/__rhw_test_pobs': DATA,
    '/__rhw_test_npc': NPC_DATA,
    '/__rhw_test_commodities': [{'nickname': f'commodity_{good}', 'name': name, 'volume': 1}
                                for good, name in NPC_GOODS.items()],
    '/__rhw_test_ships': [
        {'nickname': 'dsy_advanced_train', 'name': 'Advanced Train', 'class': 9, 'hold_size': 5000,
         'cruise_speed': 350, 'dock_type': 2},
        {'nickname': 'dsy_firefly', 'name': 'Serenity', 'class': 6, 'hold_size': 3600,
         'cruise_speed': 500, 'dock_type': 2},
    ],
}


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        if self.path not in PRICE_CHECK_FIXTURES:
            self.send_error(404)
            return
        payload = json.dumps(PRICE_CHECK_FIXTURES[self.path]).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(payload)


def wait_ready(cdp, previous_document=None):
    deadline = time.time() + 15
    while time.time() < deadline:
        snap = base.snapshot(cdp)
        new_document = previous_document is None or base.ev(cdp, 'performance.timeOrigin') != previous_document
        if snap.get('ready') == 'true' and new_document:
            base.ev(cdp, 'document.fonts.ready.then(()=>true)')
            return
        if snap.get('errors'):
            raise AssertionError(snap)
        time.sleep(.1)
    raise AssertionError(f'Bundled app did not start: {snap}')


def capture(cdp, name):
    result = cdp.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False})
    (OUT / f'{name}.png').write_bytes(base64.b64decode(result['data']))


def capture_card(cdp, selector, name):
    base.ev(cdp, f"document.querySelector({json.dumps(selector)}).scrollIntoView({{block:'start',behavior:'instant'}})")
    time.sleep(.15)
    capture(cdp, name)
    base.ev(cdp, "scrollTo({top:0,behavior:'instant'})")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    site_root = Path(os.environ.get('RHW_SMOKE_SITE', base.ROOT)).resolve()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(site_root)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    chrome, _, port, folder, _ = base.launch()
    cdp = None
    try:
        target = next(p for p in json.loads(base.get(f'http://127.0.0.1:{port}/json/list')) if p['type'] == 'page')
        cdp = base.CDP(target['webSocketDebuggerUrl'])
        for method in ('Page.enable', 'Runtime.enable', 'Network.enable'):
            cdp.call(method)
        # Serve the real HTML, bundles, fonts and worker. Mock external game
        # data and the install event that can arrive during app startup.
        fixture = """(() => {
          const original = window.fetch;
          window.__rhwNpcRequests = 0;
          window.addEventListener('DOMContentLoaded', () => {
            if (sessionStorage.getItem('rhw-install-fixture')) return;
            sessionStorage.setItem('rhw-install-fixture', 'sent');
            const pending = window.__rhwEarlyInstall = {workspacesReady: !!window.RHWV4, calls: 0};
            const event = new Event('beforeinstallprompt', {cancelable: true});
            event.prompt = () => {
              pending.calls++;
              return new Promise(resolve => { pending.finish = resolve; });
            };
            pending.captured = !window.dispatchEvent(event);
          }, {once: true});
          const marketKey = 'rhw-webapp-v4:price-check-market-cache';
          const write = Storage.prototype.setItem;
          if (!sessionStorage.getItem('market-cache-fixture')) {
            write.call(sessionStorage, 'market-cache-fixture', 'seeded');
            write.call(localStorage, marketKey, '{"schema":2,"routes":[]}');
          }
          window.__rhwMarketLocalWrites = 0;
          Storage.prototype.setItem = function(key, value) {
            if (this === localStorage && key === marketKey) {
              window.__rhwMarketLocalWrites++;
              throw new DOMException('Fixture quota exhausted', 'QuotaExceededError');
            }
            return write.call(this, key, value);
          };
          window.fetch = (input, options) => {
            if (String(input?.url || input).includes('darkstat.dd84ai.com/api/pobs')) {
              // Use real transport so the offline check cannot receive an
              // in-memory fixture when a new document resets navigator.onLine.
              return original('/__rhw_test_pobs', options);
            }
            if (String(input?.url || input).includes('darkstat.dd84ai.com/api/npc_bases')) {
              window.__rhwNpcRequests++;
              return original('/__rhw_test_npc', options);
            }
            if (String(input?.url || input).includes('darkstat.dd84ai.com/api/commodities')) return original('/__rhw_test_commodities', options);
            if (String(input?.url || input).includes('darkstat.dd84ai.com/api/ships')) return original('/__rhw_test_ships', options);
            if (String(input?.url || input).includes('darkstat.dd84ai.com/api/systems')) return Promise.reject(Error('Use bundled verified map'));
            return original(input, options);
          };
        })();"""
        cdp.call('Page.addScriptToEvaluateOnNewDocument', {'source': base.BLOCK_NATIVE_INSTALL_OFFER + fixture})
        cdp.call('Page.navigate', {'url': f'http://127.0.0.1:{server.server_port}/index.html#command/inventory'})
        wait_ready(cdp)
        base.ev(cdp, 'navigator.serviceWorker.ready.then(()=>true)')
        install = base.ev(cdp, """(async()=>{
          const pending=window.__rhwEarlyInstall;
          const button=document.getElementById('rhwPwaInstallBtn');
          const inHeader=!!button.closest('.command-header');
          const ready=button.querySelector('small').textContent;
          const panel=document.getElementById('rhwPwaPanel');
          const primary=document.getElementById('rhwPwaPrimary');
          button.click();
          const confirm=panel.open && primary.textContent==='INSTALL' && !pending.calls;
          primary.click();
          const disabled=button.disabled;
          primary.click();
          pending.finish?.({outcome:'dismissed'});
          await Promise.resolve();
          return {workspacesReady:pending.workspacesReady,captured:pending.captured,inHeader,ready,
            calls:pending.calls,disabled,confirm,promptCleared:!RHWPWA.state.installPrompt,
            enabled:!button.disabled,closed:!panel.open,phone:button.querySelector('small').textContent};
        })()""")
        assert install == {'workspacesReady': False, 'captured': True, 'inHeader': True, 'ready': 'APP READY',
                           'calls': 1, 'disabled': True, 'confirm': True,
                           'promptCleared': True, 'enabled': True, 'closed': True, 'phone': 'PHONE APP'}, install
        # Boot and service-worker readiness can precede the async cache read
        # and first fixture fetch. Check the stock view only after that fetch.
        stock_deadline = time.monotonic() + 15
        while not base.ev(cdp, "hasVerifiedTelemetry() && !isLoading && !lastSyncError"):
            if time.monotonic() >= stock_deadline:
                raise AssertionError('Initial fixture stock did not load: ' + str(base.ev(cdp, 'telemetrySnapshot()')))
            time.sleep(.05)
        assert base.ev(cdp, 'window.__rhwNpcRequests') == 0, 'COMMAND startup must not fetch the Price Check market'
        report = []
        for width in WIDTHS:
            cdp.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 940 if width > 760 else 844, 'deviceScaleFactor': 1, 'mobile': width <= 760})
            for route in ROUTES:
                workspace, node = route.split('/')
                base.ev(cdp, f"(()=>{{RHWV4.navigate('{workspace}','{node}');window.scrollTo(0,0);return true;}})()")
                if width == WIDTHS[0] and workspace == 'pricecheck':
                    base.ev(cdp, 'RHWV4.pricecheck.refresh({quiet:true}).then(()=>true)')
                time.sleep(.35)
                result = base.ev(cdp, """(()=>{
                  const visible=e=>!!e&&e.getBoundingClientRect().height>0&&!e.closest('[hidden]');
                  const tools=document.getElementById('rhwFocusToolsBtn'),nav=document.getElementById('rhwAppNav');
                  const panels=[...document.querySelectorAll('.app-workspace')].filter(visible);
                  return {overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth,
                    toolsInNav:nav.contains(tools),toolsHeight:tools.getBoundingClientRect().height,
                    pageRoute:document.getElementById('rhwPageHeading')?.dataset.route,
                    pageTitle:document.getElementById('rhwPageTitle')?.textContent,
                    pageHeadingVisible:visible(document.getElementById('rhwPageHeading')),
                    contextVisible:visible(document.getElementById('appSecondaryNav')),panels:panels.length,
                    commandButtons:[...document.querySelectorAll('#commandNodeNav [data-command-node]')].filter(visible).map(e=>({top:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height,clipped:e.scrollWidth>e.clientWidth+1})),
                    toolbarHeight:document.getElementById('commandControlDeck').getBoundingClientRect().height,
                    firstOverviewTop:document.querySelector('.overview-next').getBoundingClientRect().top,
                    crestWidth:document.querySelector('.crest').getBoundingClientRect().width,
                    mastheadHeight:document.querySelector('.command-header-inner').getBoundingClientRect().height,
                    headerValuesFit:[...document.querySelectorAll('.base-telemetry-stat strong,.uplink-value,#headerDataAge')].filter(e=>e.getBoundingClientRect().width>2).every(e=>e.scrollWidth<=e.clientWidth+1&&e.getBoundingClientRect().height<=parseFloat(getComputedStyle(e).lineHeight)+1),
                    tabClipping:[...document.querySelectorAll('.app-tabs button')].some(b=>b.scrollWidth>b.clientWidth+2),
                    noticeVisible:visible(document.getElementById('telemetryNotice')),
                    font:document.fonts.check('16px Barlow'),
                    priceLabelSizes:[...document.querySelectorAll('#opsMaterialPanel td:nth-child(3)')].filter(visible).map(e=>parseFloat(getComputedStyle(e,'::before').fontSize)),
                    priceCards:[...document.querySelectorAll('.pricecheck-row')].filter(visible).map(e=>{
                      const box=e.getBoundingClientRect(),diff=e.querySelector('.pricecheck-difference').getBoundingClientRect();
                      const source=e.querySelector('.pricecheck-price-cell').getBoundingClientRect();
                      const payout=e.querySelector('.pricecheck-payout-cell').getBoundingClientRect();
                      return {key:e.dataset.commodityKey,height:box.height,differenceTop:diff.top-box.top,
                        pricesAligned:Math.abs(source.top-payout.top)<=1,readOnly:!e.querySelector('input'),
                        clipped:e.scrollWidth>e.clientWidth+1};
                    }),
                    inventoryStyled:[...document.querySelectorAll('#inventoryStatusPanel .alert-list')].every(e=>getComputedStyle(e).listStyleType==='none')&&[...document.querySelectorAll('#inventoryStatusPanel .alert-title')].every(e=>getComputedStyle(e).display==='flex'),
                    inputs:[...document.querySelectorAll('#opsMaterialPanel [data-material-price]')].filter(visible).map(e=>e.getBoundingClientRect().width)};
                })()""")
                if width in (390, 1366, 1920) and route in ('command/inventory', 'command/production', 'command/shipyard', 'command/logistics', 'operations/calculator', 'pricecheck/routes', 'comms/forum', 'comms/drafts', 'comms/senders'):
                    capture(cdp, f'{width}-{workspace}-{node}')
                    if route == 'command/inventory':
                        capture_card(cdp, '.reserve-panel', f'{width}-inventory-stocks')
                    if route == 'command/production':
                        capture_card(cdp, '#productionPanel', f'{width}-production-table')
                    if route == 'command/shipyard':
                        capture_card(cdp, '#shipyardControl', f'{width}-shipyard-detail')
                    if route == 'command/logistics':
                        base.ev(cdp, "document.querySelector('[data-logistics-view=\"materials\"]').click()")
                        time.sleep(.35)
                        capture(cdp, f'{width}-logistics-materials')
                        capture_card(cdp, '#materialsScanGrid [data-market-commodity="gold"]', f'{width}-materials-gold-card')
                        capture_card(cdp, '#materialsScanGrid [data-market-commodity="prototype components"]', f'{width}-materials-pc-card')
                        base.ev(cdp, "document.querySelector('[data-logistics-view=\"market\"]').click()")
                assert result['overflow'] <= 2 and not result['tabClipping'], (width, route, result)
                assert result['toolsInNav'] and result['toolsHeight'] >= 44 and result['panels'] == 1, (width, route, result)
                assert not result['contextVisible'], (width, route, result)
                assert result['pageRoute'] == route and result['pageTitle'] and result['pageHeadingVisible'], (width, route, result)
                assert result['headerValuesFit'], (width, route, result)
                assert result['font'] and result['inventoryStyled'] and not result['noticeVisible'], (width, route, result)
                if width <= 760:
                    assert 36 <= result['crestWidth'] <= 42 and result['mastheadHeight'] <= (176 if route == 'command/inventory' else 120), (width, route, result)
                if width <= 760 and workspace == 'command':
                    assert len(result['commandButtons']) == 4 and all(b['height'] >= 44 and not b['clipped'] for b in result['commandButtons']), (width, route, result)
                    assert max(b['top'] for b in result['commandButtons']) - min(b['top'] for b in result['commandButtons']) < 1, (width, route, result)
                    assert result['toolbarHeight'] <= (440 if route == 'command/inventory' else 180), (width, route, result)
                    if route == 'command/inventory':
                        assert result['firstOverviewTop'] <= 330, (width, result)
                if width >= 1100 and workspace == 'operations':
                    assert result['inputs'] and all(0 < n <= 145 for n in result['inputs']), result
                if route == 'command/production':
                    lanes = base.ev(cdp, """(()=>{
                      const cards=[...productionGrid.querySelectorAll('.production-row')];
                      return cards.map((card,index)=>{
                        const stats=card.querySelector('.production-stats');
                        const target=card.querySelector('.production-batch-target')?.getBoundingClientRect();
                        const materials=card.querySelector('.production-input-table');
                        const head=card.querySelector('.production-card-head');
                        const rect=card.getBoundingClientRect(),prev=cards[index-1]?.getBoundingClientRect();
                        return {
                          labels:[...stats.querySelectorAll('small')].map(n=>n.textContent.trim()),
                          columns:[...materials.querySelectorAll('thead th')].map(n=>n.textContent.trim()),
                          limitInTable:materials.querySelector('.production-limit')?.textContent==='Limiting material',
                          separated:materials.getBoundingClientRect().top>=(target?.bottom??stats.getBoundingClientRect().bottom)+6
                            &&(!target||target.top>=stats.getBoundingClientRect().bottom+6),
                          coverage:card.dataset.productionState==='ok' ? !target&&!!stats.querySelector('.production-batch-covered') : !!target,
                          headerFits:head.scrollWidth<=head.clientWidth+1,
                          chamfered:getComputedStyle(card).clipPath.startsWith('polygon'),
                          cardGap:prev ? (Math.abs(rect.top-prev.top)<1 ? rect.left-prev.right : rect.top-prev.bottom) : 12,
                          border:parseFloat(getComputedStyle(card).borderTopWidth),
                          overflow:card.scrollWidth-card.clientWidth
                        };
                      });
                    })()""")
                    assert lanes and all(x['labels']==['In stock','From materials'] and x['columns']==['Material','Stock','Per batch'] for x in lanes), (width, lanes)
                    assert all(x['limitInTable'] and x['separated'] and x['coverage'] and x['headerFits'] and x['chamfered']
                               and x['cardGap']>=10 and x['border']>=1 and x['overflow']<=2 for x in lanes), (width, lanes)
                if width <= 760 and workspace == 'operations':
                    assert result['priceLabelSizes'] and min(result['priceLabelSizes']) >= 11, result
                if route == 'command/shipyard':
                    yard = base.ev(cdp, """(()=>{
                      const cards=[...document.querySelectorAll('[data-shipyard-select]')];
                      const rows=[...document.querySelectorAll('.shipyard-material-row')];
                      return {cards:cards.length,selected:cards.find(c=>c.getAttribute('aria-pressed')==='true')?.dataset.shipyardSelect,
                        order:cards.map(c=>c.dataset.shipyardSelect),
                        rows:rows.length,buildable:RHWV4.shipyard.analyze().buildable,
                        compact:rows.every(r=>r.getBoundingClientRect().height<115),rowHeights:rows.map(r=>r.getBoundingClientRect().height),
                        fits:[...cards,...rows].every(r=>r.scrollWidth<=r.clientWidth+1),
                        touch:cards.every(c=>c.getBoundingClientRect().height>=44),
                        stockFirst:cards[0].getBoundingClientRect().top<shipyardRequirements.getBoundingClientRect().top};
                    })()""")
                    assert yard['cards'] == 2 and yard['rows'] == 5 and yard['selected'] == 'archon' and yard['buildable'] == 0, (width, yard)
                    assert yard['order'] == ['archon', 'asteroid-miner'], (width, yard)
                    assert yard['compact'] and yard['fits'] and yard['touch'] and yard['stockFirst'], (width, yard)
                if route == 'comms/senders':
                    senders = base.ev(cdp, """(()=>({
                      labels:[...document.querySelectorAll('.sender-registry-card dt')].map(e=>parseFloat(getComputedStyle(e).fontSize)),
                      values:[...document.querySelectorAll('.sender-registry-card dd')].map(e=>parseFloat(getComputedStyle(e).fontSize)),
                      actions:[...document.querySelectorAll('.sender-registry-actions button')].map(e=>e.getBoundingClientRect().height)
                    }))()""")
                    assert senders['labels'] and min(senders['labels'])>=12 and min(senders['values'])>=14 and min(senders['actions'])>=44, (width, senders)
                if width <= 760 and workspace == 'pricecheck':
                    # A phone must show the result at the start of each compact
                    # card, including unknown prices and the longest route names.
                    assert len(result['priceCards']) == PRICE_ROW_COUNT, result
                    assert len({card['key'] for card in result['priceCards']}) == PRICE_ROW_COUNT, result
                    for card in result['priceCards']:
                        assert card['height'] <= 300 and card['differenceTop'] <= 20, (width, card)
                        assert card['pricesAligned'] and card['readOnly'] and not card['clipped'], (width, card)
                    if width == 390:
                        capture_card(cdp, '[data-route-key="br01_01_base/commodity_industrial"]', '390-pricecheck-compact-cards')
                report.append({'width': width, 'route': route, **result})

        # Connection labels must fit even when no inventory has arrived.
        # A live-data-only fixture previously missed the UNAVAILABLE overflow.
        base.ev(cdp, "(()=>{window.__rhwHeaderAudit={base:rhwBase,error:lastSyncError};rhwBase=null;return true;})()")
        header_states = []
        for unavailable in (False, True):
            base.ev(cdp, "(()=>{lastSyncError=%s;updateBaseTelemetry();return true;})()" % json.dumps('fixture unavailable' if unavailable else ''))
            for width in (360, 390, 430):
                cdp.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
                checked = base.ev(cdp, """(()=>{
                  const values=[...document.querySelectorAll('.base-telemetry-stat strong')];
                  return {labels:values.map(e=>e.textContent),fits:values.every(e=>e.scrollWidth<=e.clientWidth+1),
                    singleLine:values.every(e=>e.getBoundingClientRect().height<=parseFloat(getComputedStyle(e).lineHeight)+1),
                    overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth};
                })()""")
                assert checked['labels'] == ['UNAVAILABLE' if unavailable else 'CONNECTING'] * 3, checked
                assert checked['fits'] and checked['singleLine'] and checked['overflow'] <= 2, (width, checked)
                header_states.append({'width': width, **checked})
                if unavailable and width == 390:
                    capture(cdp, '390-header-unavailable')
        base.ev(cdp, "(()=>{rhwBase=window.__rhwHeaderAudit.base;lastSyncError=window.__rhwHeaderAudit.error;delete window.__rhwHeaderAudit;updateBaseTelemetry();return true;})()")

        # Row labels must stay attached to their quantities while scrolling.
        # Old global TH styling painted a black slab and made body labels sticky,
        # including on hover and in Eco mode.
        original_eco = base.ev(cdp, "document.documentElement.classList.contains('eco')")
        row_header_checks = []
        for width in (390, 1366, 1920):
            cdp.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 844, 'deviceScaleFactor': 1, 'mobile': width <= 760})
            for eco in (False, True):
                hover = base.ev(cdp, """(()=>{
                  RHWV4.navigate('command','shipyard');
                  document.documentElement.classList.toggle('eco',%s);
                  const rows=[...document.querySelectorAll('.shipyard-material-row')];
                  scrollTo({top:rows[0].getBoundingClientRect().top+scrollY+20,behavior:'instant'});
                  const row=rows.find(r=>r.getBoundingClientRect().top>80)||rows.at(-1);
                  const box=row.querySelector('th').getBoundingClientRect();
                  return {x:box.x+8,y:box.y+8};
                })()""" % json.dumps(eco))
                cdp.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', **hover})
                checked = base.ev(cdp, """(()=>{
                  const rows=[...document.querySelectorAll('.shipyard-material-row')];
                  return {aligned:rows.every(r=>Math.abs(r.querySelector('th').getBoundingClientRect().top-r.querySelector('td').getBoundingClientRect().top)<1),
                    uniform:rows.every(r=>getComputedStyle(r.querySelector('th')).backgroundColor===getComputedStyle(r.querySelector('td')).backgroundColor)};
                })()""")
                assert all(checked.values()), (width, eco, checked)
                row_header_checks.append({'width': width, 'eco': eco, **checked})
                capture_card(cdp, '.shipyard-material-table', f'{width}-shipyard-materials-{"eco" if eco else "standard"}')
        base.ev(cdp, "document.documentElement.classList.toggle('eco',%s)" % json.dumps(original_eco))

        # Ship selection updates requirements, retains keyboard focus through
        # telemetry refreshes and opens the exact civilian Archon recipe.
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
        shipyard = base.ev(cdp, """(()=>{
          RHWV4.navigate('command','shipyard');
          const states=['dunkirk','invincible','archon'].map(key=>{
            document.querySelector(`[data-shipyard-division="${key==='archon'?'mining':'naval'}"]`).click();
            const button=document.querySelector(`[data-shipyard-select="${key}"]`);button.focus();button.click();
            renderAll();
            const a=RHWV4.shipyard.analyze();
            return {key,rows:document.querySelectorAll('.shipyard-material-row').length,buildable:a.buildable,
              focus:document.activeElement?.dataset.shipyardSelect===key,
              stock:RHWV4.shipyard.stockRecord(a.hull).stock,prerequisites:a.prerequisites.every(p=>p.state==='ok')};
          });
          const stored=RHWV4.store.get(RHWV4.config.storageKeys.shipyardSelection);
          document.querySelector('[data-shipyard-calculate]').click();
          const calc=RHWV4.state.calculator;
          return {states,stored,route:location.hash,recipe:calc.recipeId,iff:calc.affiliationId,quantity:calc.quantity};
        })()""")
        for state, (count, ready, stock) in zip(shipyard['states'], ((6, 1, 3), (6, 1, 1), (5, 0, 2))):
            assert state['rows'] == count and state['buildable'] == ready and state['stock'] == stock, state
            assert state['focus'] and state['prerequisites'], state
        assert shipyard['stored'] == 'archon' and shipyard['route'] == '#operations/calculator', shipyard
        assert shipyard['recipe'] == 'ship_assembly_medium_miner' and shipyard['iff'] == 'br_m_grp' and shipyard['quantity'] == 1, shipyard

        cruiser = base.ev(cdp, """(()=>{
          const app=RHWV4;
          app.navigate('command','shipyard');
          document.querySelector('[data-shipyard-division="civilian"]').click();
          const button=document.querySelector('[data-shipyard-select="civilian-cruiser"]');
          button.focus();button.click();renderAll();
          const rows=[...document.querySelectorAll('.shipyard-material-row')];
          const ready=rows.length===6&&rows.some(row=>row.dataset.shipyardMaterial==='commodity_ship_part_exotic');
          const focused=document.activeElement?.dataset.shipyardSelect==='civilian-cruiser';
          document.querySelector('[data-shipyard-calculate]').click();
          const calc=app.state.calculator;
          return {ready,focused,route:location.hash,recipe:calc.recipeId,product:calc.productId,
            iff:calc.affiliationId,quantity:calc.quantity,fits:document.documentElement.scrollWidth<=innerWidth+1};
        })()""")
        assert cruiser == {'ready':True,'focused':True,'route':'#operations/calculator',
                           'recipe':'ship_assembly_cv_cruiser','product':'cv_cruiser_package',
                           'iff':'br_m_grp','quantity':1,'fits':True}, cruiser

        # The retired planner and its Shipyard links are absent in both views.
        retired = base.ev(cdp, """(()=>{
          const app=RHWV4;
          app.navigate('command','shipyard');
          document.querySelector('[data-shipyard-division="civilian"]').click();
          const civilians=document.querySelectorAll('[data-shipyard-select]').length;
          document.querySelector('[data-shipyard-select="halberd"]').click();
          const crew=app.shipyard.requirements().prerequisites.find(p=>p.id==='commodity_crew').qty;
          const noLinks=!document.querySelector('[data-personnel-open],.shipyard-crew-check');
          app.navigate('command','production');
          const noPlanner=!document.querySelector('#personnelPlanner,[data-personnel-stock]')&&!app.personnel;
          const fits=document.documentElement.scrollWidth<=innerWidth+1;
          app.shipyard.selectHull('archon');
          return {civilians,crew,noLinks,noPlanner,fits};
        })()""")
        assert retired == {'civilians':5,'crew':200,'noLinks':True,'noPlanner':True,'fits':True}, retired

        shared_design = base.ev(cdp, """(()=>{
          RHWV4.presentation.applySurfaces();
          const stock=document.querySelector('.reserve-panel .alert-title>span:first-child');
          const forum=document.querySelector('#commsComposerPanel .comms-panel-head strong');
          const style=n=>{const s=getComputedStyle(n);return {family:s.fontFamily,size:s.fontSize,weight:s.fontWeight};};
          const sections=[...document.querySelectorAll('#inventoryStatusPanel .summary-grid>.alert-card')];
          return {stock:style(stock),forum:style(forum),sections:sections.map(n=>n.querySelector('ul')?.id),
            surfaces:[stock.closest('.alert-card'),forum.closest('.comms-panel')].every(n=>n.classList.contains('rhw-surface'))};
        })()""")
        assert shared_design['stock']==shared_design['forum'] and shared_design['surfaces'], ('Forum and Overview must use the same section typography',shared_design)
        assert shared_design['sections']==['reserveList','exportList','shipStockList'], shared_design

        # Production uses current stock only; manual planning is fully retired.
        independent = base.ev(cdp, """(()=>{
          const app=RHWV4, original=items;
          window.__capacityRestore=original;
          const names=new Set();
          for(const recipe of app.production.recipes())for(const [name] of recipe.ingredients)names.add(name);
          items=[...names].map(name=>({name,quantity:10000,min_stock:0,max_stock:1000000}));
          rebuildItemCaches();app.navigate('command','production');renderProductionModules();
          const cards=[...productionGrid.querySelectorAll('.production-card')];
          const noPlan=!document.querySelector('[data-production-plan],[data-production-hull-plan],#productionPlanSummary,#productionShipPlan')&&!app.productionPlan&&!app.productionScenario;
          const compact=cards.length===8&&cards.every(card=>card.querySelectorAll('.production-stats>.production-stat').length===2);
          const timing=cards.every(card=>card.querySelector('.production-cycle-time')?.textContent.includes('/ CYCLE')&&card.querySelector('.production-runtime'));
          const pc=cards.find(card=>card.dataset.productionRecipe==='recipe_milsal');
          const pcTime=pc.querySelector('.production-cycle-time').textContent.includes('2h 5m');
          return {noPlan,compact,timing,pcTime};
        })()""")
        assert all(independent.values()), independent
        # Recipe choice changes the exact MOX calculation; one unavailable
        # recipe leaves all other module cards and their quantities intact.
        mox_and_failure = base.ev(cdp, """(()=>{
          const app=RHWV4,core=app.operationsCore;
          items.push({name:'Uranium',quantity:10000});rebuildItemCaches();
          let select=productionGrid.querySelector('[data-production-mox]');
          select.value='recipe_mox_fuel_advanced';select.dispatchEvent(new Event('change',{bubbles:true}));
          const advanced=app.production.recipes().find(r=>r.product==='MOX');
          const exact=advanced.recipeId==='recipe_mox_fuel_advanced'&&advanced.output===500
            &&app.productionPricing.findRecipeForLabel('MOX').id===advanced.recipeId;
          const advancedInputs=[...productionGrid.querySelectorAll('[data-production-recipe="recipe_mox_fuel_advanced"] .production-input-name')].map(n=>n.textContent);
          select=productionGrid.querySelector('[data-production-mox]');
          select.value='recipe_mox_fuel_basic';select.dispatchEvent(new Event('change',{bubbles:true}));
          const basic=app.production.recipes().find(r=>r.product==='MOX').output===333;
          const basicInputs=[...productionGrid.querySelectorAll('[data-production-recipe="recipe_mox_fuel_basic"] .production-input-name')].map(n=>n.textContent);
          const saved=core.state.recipesById.get('recipe_milsal');core.state.recipesById.delete(saved.id);renderProductionModules();
          const isolated=productionGrid.querySelectorAll('.production-card').length===8
            &&productionGrid.querySelectorAll('.production-unavailable').length===1
            &&productionGrid.querySelectorAll('.production-capacity').length===7;
          core.state.recipesById.set(saved.id,saved);renderProductionModules();
          return {exact,basic,isolated,advancedInputs,basicInputs};
        })()""")
        assert mox_and_failure == dict(exact=True, basic=True, isolated=True,
                                       advancedInputs=['Toxic Waste', 'Uranium'], basicInputs=['Toxic Waste']), mox_and_failure

        material_summary = base.ev(cdp, """(()=>{
          findCommodity('Gold Ore').quantity=0;
          findCommodity('Niobium Ore').quantity=null;
          findCommodity('Gold').quantity=506;
          findCommodity('Industrial Materials').quantity=0;
          items.push({name:'Promethene',quantity:234});
          rebuildItemCaches();renderProductionModules();
          const input=(recipe,name)=>[...productionGrid.querySelectorAll(`[data-production-recipe="${recipe}"] .production-input`)]
            .find(node=>node.querySelector('.production-input-name').textContent===name);
          const gold=input('recipe_gold_advanced','Gold Ore');
          const niobium=input('recipe_niobium_advanced','Niobium Ore');
          const fuel=input('recipe_weapon_part_focusing_chamber','MOX / Promethene / H-Fuel');
          const target=recipe=>productionGrid.querySelector(`[data-production-recipe="${recipe}"] .production-batch-target`);
          const first=target('recipe_gold_advanced'), third=target('recipe_weapon_part_focusing_chamber');
          return {
            stock:gold.querySelector('.production-input-stock>strong').textContent==='0'
              &&gold.querySelector('.production-input-required').textContent==='425',
            unknown:niobium.querySelector('.production-input-stock>strong').textContent==='Unknown',
            pooled:fuel.querySelector('.production-input-stock>strong').textContent===number(10234),
            firstBatch:first.querySelector('.production-batch-label').textContent==='First batch'
              &&first.querySelector('.production-shortage').textContent==='Missing 425 Gold Ore'
              &&first.querySelector('.production-batch-other').textContent==='+1 more',
            thirdBatch:third.querySelector('.production-batch-label').textContent==='Batch 3'
              &&third.querySelector('.production-shortage').textContent==='Missing 244 Gold / Wildcat Gold',
            noInventedTarget:!target('recipe_niobium_advanced'),
            ready:[...productionGrid.querySelectorAll('[data-production-state="ok"]')].some(card=>card.querySelector('.production-batch-covered')),
            allVisible:RHWV4.production.recipes().every(recipe=>{
              const rows=[...productionGrid.querySelectorAll(`[data-production-recipe="${recipe.recipeId}"] .production-input`)];
              return rows.length===recipe.ingredients.length&&rows.every(row=>row.getClientRects().length);
            })
          };
        })()""")
        assert all(material_summary.values()), material_summary
        # Both output and ingredient quantities must fit, including 1.234.567.
        base.ev(cdp, """(()=>{
          for(const recipe of RHWV4.production.recipes()) {
            const item=findCommodity(recipe.product);
            if(item)item.quantity=1234567;
            else items.push({name:recipe.product,quantity:1234567});
          }
          rebuildItemCaches();renderProductionModules();return true;
        })()""")
        for width in [1920,1366,1024,390,360]:
            cdp.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':1100,'deviceScaleFactor':1,'mobile':width<760})
            base.ev(cdp, 'renderProductionModules()')
            assert base.ev(cdp, 'document.documentElement.scrollWidth<=innerWidth+1'), width
            overview = base.ev(cdp, """(()=>{
              const cards=[...productionGrid.querySelectorAll('.production-card')];
              const heights=cards.map(c=>c.getBoundingClientRect().height);
              const groups=[...productionGrid.querySelectorAll('[data-production-group]')];
              return {columns:groups.map(group=>getComputedStyle(group.querySelector('.production-group-cards')).gridTemplateColumns.split(' ').length),
                groups:groups.map(group=>group.dataset.productionGroup),
                panelWidth:productionPanel.clientWidth,
                height:Math.max(...heights),
                valuesFit:cards.every(c=>[...c.querySelectorAll('.production-stat strong')].every(n=>n.scrollWidth<=n.clientWidth+1)),
                materialsFit:cards.every(c=>{
                  const summary=c.querySelector('.production-input-summary');
                  return summary.scrollWidth<=summary.clientWidth+1&&[...summary.querySelectorAll('td')].every(n=>n.scrollWidth<=n.clientWidth+1);
                }),
                actions:cards.every(c=>c.querySelectorAll('.production-card-actions>button').length===2),
                order:cards.map(c=>c.querySelector('.production-title').textContent)};
            })()""")
            columns = 3 if overview['panelWidth'] >= 1320 else 2 if overview['panelWidth'] >= 760 else 1
            assert overview['columns'] == [columns, columns] and overview['height'] < 460, (width, overview)
            assert overview['actions'] and overview['valuesFit'] and overview['materialsFit'], (width, overview)
            assert overview['groups'] == ['exports','internal'], overview
            assert overview['order'] == ['Multi-Mode Focusing Chamber','Reactor Systems','Superstructure Systems','Basic Alloy','Gold','Niobium','Prototype Components','MOX'], overview
            disclosure = base.ev(cdp, """(()=>{
              const card=productionGrid.querySelector('.production-card'),toggle=card.querySelector('.production-card-toggle');
              const hidden=!card.querySelector('.production-materials').getClientRects().length;
              toggle.focus();toggle.click();
              const dialog=document.getElementById('rhwItemDetails');
              const shown=dialog.open&&dialog.querySelector('.recipe-list').getClientRects().length>0&&toggle.getAttribute('aria-expanded')==='true';
              renderProductionModules();
              const next=productionGrid.querySelector('.production-card');
              const retained=dialog.open&&dialog.dataset.recipeId===next.dataset.productionRecipe&&next.querySelector('.production-card-toggle').getAttribute('aria-expanded')==='true';
              dialog.close();
              return {hidden,shown,retained,closed:!dialog.open&&!next.querySelector('.production-materials').getClientRects().length};
            })()""")
            assert all(disclosure.values()), (width, disclosure)
            capture_card(cdp, '#productionModuleTools', f'{width}-production-controls')
            capture_card(cdp, '.production-card', f'{width}-production-capacity')
        base.ev(cdp, "(()=>{items=window.__capacityRestore;delete window.__capacityRestore;rebuildItemCaches();renderAll();return true;})()")
        restock_action = base.ev(cdp, """(()=>{
          const food=findCommodity('Food Rations'),quantity=food.quantity;
          food.quantity=1000;renderAll();RHWV4.command.updateOverview();
          const action=document.querySelector('[data-supply-commodity="Food Rations"][data-supply-quantity]');
          const correct=action?.dataset.supplyQuantity==='14000'&&action.closest('.command-priority-entry').textContent.toLowerCase().includes('warning threshold');
          food.quantity=quantity;renderAll();return correct;
        })()""")
        assert restock_action, 'ATTENTION must expose the real warning-level restock quantity'

        # Deliberately long names and seven-digit amounts exercise the actual
        # card boundaries, not just document overflow (cards can clip internally).
        base.ev(cdp, """(()=>{
          const names=[...MARKET_SCAN,...MATERIALS_SCAN,'Military Salvage'];
          allBases=Array.from({length:7},(_,i)=>({
            name:i===0?'Northumberland Advanced Manufacturing and Distribution Complex':`Supplier ${i} Logistics Depot`,
            system_name:i===0?'New London Industrial District':'Dublin',
            shop_items:names.map(name=>({name,quantity:1234567+i*100,min_stock:0,price_to_buy_from_base:9876543+i}))
          }));
          marketSort='price';materialsSort='price';renderSupplier();
          RHWV4.navigate('command','logistics');return true;
        })()""")
        market_layouts = []
        for width in (360, 430, 820, 1366, 1920):
            cdp.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 940 if width > 760 else 844, 'deviceScaleFactor': 1, 'mobile': width <= 760})
            for view in ('market', 'materials'):
                base.ev(cdp, f"document.querySelector('[data-logistics-view=\"{view}\"]').click()")
                time.sleep(.35)
                geometry = base.ev(cdp, """(()=>{
                  const section=document.querySelector(document.body.dataset.logisticsView==='market'?'#marketScanSection':'#materialsScanSection');
                  const visible=e=>e.getBoundingClientRect().height>0;
                  const rows=[...section.querySelectorAll('.supplier-commodity-row')].filter(visible);
                  const fits=rows.every(row=>{
                    const box=row.getBoundingClientRect();
                    return [...row.querySelectorAll('.supplier-commodity-name,.supplier-commodity-metric,.market-feedstock')].every(e=>{
                      const r=e.getBoundingClientRect();
                      return r.left>=box.left&&r.right<=box.right+1&&e.scrollWidth<=e.clientWidth+1;
                    });
                  });
                  const materials=[...section.querySelectorAll('.market-material-card')].map(e=>({name:e.dataset.marketCommodity,width:e.getBoundingClientRect().width}));
                  return {fits,rows:rows.length,overflow:document.documentElement.scrollWidth-innerWidth,materials};
                })()""")
                assert geometry['rows'] > 0 and geometry['fits'] and geometry['overflow'] <= 2, (width, view, geometry)
                market_layouts.append({'width': width, 'view': view, **geometry})
                if width in (430, 1366):
                    capture(cdp, f'{width}-logistics-{view}-large-values')
                    grid = '#marketScanGrid' if view == 'market' else '#materialsScanGrid'
                    capture_card(cdp, f'{grid} .market-card', f'{width}-{view}-large-values-card')

        # A refresh or sort must not collapse the channel a phone user is reading.
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': 430, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
        disclosure = base.ev(cdp, """(()=>{
          document.querySelector('[data-logistics-view="materials"]').click();
          const channel=()=>document.querySelector('#materialsScanGrid [data-market-commodity="gold"]');
          const toggle=()=>channel().querySelector('.market-mobile-toggle');
          toggle().click();toggle().focus();const before=scrollY;
          renderMaterialsScan();
          const refresh=toggle().getAttribute('aria-expanded')==='true'&&document.activeElement===toggle()&&Math.abs(scrollY-before)<2;
          setMarketSort('materials','stock');
          const sorted=toggle().getAttribute('aria-expanded')==='true'&&document.activeElement===toggle();
          const associated=toggle().getAttribute('aria-controls')===channel().querySelector('.supplier-commodity-list').id&&toggle().getAttribute('aria-label').includes('GOLD');
          const source=allBases;allBases=allBases.slice(0,2);renderMaterialsScan();
          const fewer=!toggle()&&document.activeElement===channel();
          allBases=source;renderMaterialsScan();
          const restored=toggle().getAttribute('aria-expanded')==='true';
          const independent=!document.querySelector('#materialsScanGrid [data-market-commodity="niobium"]').classList.contains('mobile-market-expanded');
          const search=document.getElementById('commandGlobalSearch');search.value='Gold';search.focus();renderSupplier();
          const searchFocus=document.activeElement===search&&search.value==='Gold';
          search.value='';return {refresh,sorted,associated,fewer,restored,independent,searchFocus};
        })()""")
        assert all(disclosure.values()), disclosure
        # Search results must remain readable across the full toolbar width even
        # though the phone search field shares a row with Attention.
        base.ev(cdp, """(()=>{RHWV4.navigate('command','inventory');scrollTo({top:0,behavior:'instant'});
          commandGlobalSearch.value='Gold';commandGlobalSearch.focus();commandGlobalSearch.dispatchEvent(new Event('input',{bubbles:true}));return true;})()""")
        time.sleep(.15)
        command_search = base.ev(cdp, """(()=>{const box=commandSearchResults.getBoundingClientRect(),deck=commandControlDeck.getBoundingClientRect();
          const result={visible:!commandSearchResults.hidden,count:commandSearchResults.querySelectorAll('[data-command-search-result]').length,
            fits:Math.abs(box.left-deck.left)<2&&Math.abs(box.right-deck.right)<2&&box.top>=deck.bottom,
            focused:document.activeElement===commandGlobalSearch};
          commandGlobalSearch.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
          result.closed=commandSearchResults.hidden&&commandGlobalSearch.value==='';return result;})()""")
        assert command_search['visible'] and command_search['count'] > 0 and command_search['fits'] and command_search['focused'] and command_search['closed'], command_search
        # The old URL must resolve to a current view; no retired editor is mounted.
        retired = base.ev(cdp, """(()=>{RHWV4.navigate('comms','ticker');return {route:location.hash,
          editor:!!document.getElementById('v40NewswireManager'),orders:!!RHWV4.productionOrders,
          archive:typeof RHWV4.legacyArchive.prepareImport==='function',scripts:[...document.scripts].map(s=>s.src)};})()""")
        assert retired['route'] == '#comms/forum' and not retired['editor'] and not retired['orders'] and retired['archive'], retired
        assert len(retired['scripts']) == 4, retired
        # Refreshes keep keyboard focus on the control, while archived manual
        # prices cannot change a read-only NPC comparison.
        base.ev(cdp, """(()=>{RHWV4.navigate('pricecheck','routes');const e=document.getElementById('priceCheckRefresh');
          window.__rhwFocusedPrice=e;e.focus();RHWV4.pricecheck.importOverrides({'hull-panels':0});return true;})()""")
        base.ev(cdp, "RHWV4.pricecheck.refresh({quiet:true}).then(()=>{RHWV4.requestUiUpdate();return true;})")
        time.sleep(.15)
        price_focus = base.ev(cdp, """(()=>{const e=document.getElementById('priceCheckRefresh');
          const row=document.querySelector('[data-route-key="br01_02_base/commodity_ship_hull_panels"]');
          return {same:e===window.__rhwFocusedPrice,focused:document.activeElement===e,
            price:row.querySelector('.pricecheck-source-price').textContent,editors:document.querySelectorAll('#priceCheckRows input').length,
            stored:RHWV4.pricecheck.state.overrides['hull-panels'],live:RHWV4.pricecheck.state.marketLabel,
            emptyStyleMarkers:document.querySelectorAll('style[data-stylesheet]').length};})()""")
        assert price_focus['same'] and price_focus['focused'] and price_focus['price'] == '$80' and price_focus['stored'] == 0 and price_focus['editors'] == 0, price_focus
        assert price_focus['live'] == 'NPC MARKET LIVE' and price_focus['emptyStyleMarkers'] == 0, price_focus
        price_cache = base.ev(cdp, """(async()=>{const cache=await RHWTelemetryCache.readMarket();
          return {offers:cache?.routes.length,at:cache?.fetchedAt,legacy:localStorage.getItem('rhw-webapp-v4:price-check-market-cache'),
            localWrites:window.__rhwMarketLocalWrites,warning:!!document.getElementById('rhwStorageWarning'),
            outside:RHWV4.pricecheck.routes.some(route=>/Market Only|Mining Machinery/.test(route.commodity))};})()""")
        assert price_cache['offers'] == PRICE_OFFER_COUNT and price_cache['at'], price_cache
        assert price_cache['legacy'] is None and price_cache['localWrites'] == 0 and not price_cache['warning'] and not price_cache['outside'], price_cache
        deadline = time.monotonic() + 10
        while base.ev(cdp, "document.querySelectorAll('.pricecheck-target b').length") != PRICE_SOURCE_COUNT:
            if time.monotonic() >= deadline:
                details = base.ev(cdp, "({status:priceCheckTripStatus.textContent, rows:[...document.querySelectorAll('.pricecheck-target')].map(row=>row.textContent)})")
                raise AssertionError(f'Price Check did not quote one NPC source per commodity: {details}')
            time.sleep(.05)
        price_winners = base.ev(cdp, """(()=>{
          const api=RHWV4.pricecheck;
          const card=name=>[...priceCheckRows.rows].find(row=>row.querySelector('.pricecheck-commodity strong').textContent===name);
          const armor=card('Ablative Armor Plating');
          const winner=armor.dataset.routeKey, price=armor.querySelector('.pricecheck-source-price').textContent;
          const cheaper=api.routes.find(row=>row.key==='rh01_02_base/commodity_ablativearmor').livePrice;
          const hourly=armor.querySelector('.pricecheck-hourly b')?.textContent;
          const food=card('Food Rations').dataset.routeKey;
          const noSource=card('Gold Ore').textContent.includes('No NPC seller reported');
          const item=rhwBase.shop_items.find(item=>item.name==='Ablative Armor Plating');
          const payout=item.sell_price;
          item.sell_price=null;api.render();
          const targetOnlyWinner=armor.dataset.routeKey;
          const targetOnly=!!armor.querySelector('.pricecheck-target b')&&!armor.querySelector('.pricecheck-hourly');
          item.sell_price=payout;api.render();
          return {winner,price,cheaper,hourly,food,noSource,targetOnlyWinner,targetOnly,
            count:priceCheckRows.rows.length,distinct:new Set([...priceCheckRows.rows].map(row=>row.dataset.commodityKey)).size};
        })()""")
        assert price_winners['winner'] == 'br01_01_base/commodity_ablativearmor' and price_winners['price'] == '$90', price_winners
        assert price_winners['cheaper'] == 80 and price_winners['hourly'].endswith('/h'), price_winners
        assert price_winners['food'] == 'br01_01_base/commodity_food' and price_winners['noSource'], price_winners
        assert price_winners['count'] == price_winners['distinct'] == PRICE_ROW_COUNT, price_winners
        assert price_winners['targetOnlyWinner'] == price_winners['winner'] and price_winners['targetOnly'], price_winners
        hourly_target = base.ev(cdp, """(()=>{
          const row=document.querySelector('[data-route-key="br01_06_base/commodity_hydrocarbons"]');
          const select=(node,value)=>{node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));};
          const targets=[...priceCheckTarget.querySelectorAll('input[type="radio"]')];
          const choose=value=>targets.find(input=>input.value===value).click();
          const quantity=value=>{priceCheckQuantity.value=value;priceCheckQuantity.dispatchEvent(new Event('input',{bubbles:true}));};
          const quote=()=>Number(row.querySelector('.pricecheck-target b').textContent.replace(/[^0-9]/g,''));
          const current=()=>row.querySelector('.pricecheck-hourly b').textContent;
          select(priceCheckHauler,'transport-5000');
          const before=Number(targets.find(input=>input.checked).value), rate=current();
          choose('500000');const initial=quote();
          choose('750000');const above=quote();
          choose('1000000');const highest=quote(), sameRate=current()===rate;
          quantity('1000');const smaller=quote(), label=row.querySelector('.pricecheck-trip').textContent;
          const width=document.documentElement.scrollWidth;
          choose('750000');select(priceCheckHauler,'auto');quantity('');
          return {before,initial,above,highest,smaller,sameRate,label,width,viewport:innerWidth,
            presets:targets.map(input=>Number(input.value)),
            original:row.querySelector('.pricecheck-difference strong').textContent};
        })()""")
        assert hourly_target['before'] == 750000 and hourly_target['initial'] < hourly_target['above'] < hourly_target['highest'] < hourly_target['smaller'], hourly_target
        assert hourly_target['presets'] == [500000, 750000, 1000000], hourly_target
        assert hourly_target['sameRate'] and 'Advanced Train' in hourly_target['label'] and '1,000 units' in hourly_target['label'], hourly_target
        assert hourly_target['width'] <= hourly_target['viewport'] + 1 and hourly_target['original'] == '+$20', hourly_target
        # Updated NPC quotes must handle zero, losses and large amounts without
        # introducing editable controls or clipping a phone card.
        price_edit = base.ev(cdp, """(()=>{
          const key='br01_01_base/commodity_industrial';
          const offer=RHWV4.pricecheck.state.marketCache.routes.find(route=>route.key===key);
          const row=document.querySelector(`[data-route-key="${key}"]`);
          const states=[0,100,125,9999999].map(value=>{
            offer.livePrice=value;RHWV4.pricecheck.render();
            const diff=row.querySelector('.pricecheck-difference');
            return {text:diff.querySelector('strong').textContent,tone:diff.className,
              readOnly:!row.querySelector('input'),clipped:row.scrollWidth>row.clientWidth+1};
          });
          offer.livePrice=80;RHWV4.pricecheck.render();
          return {states,
            liveResult:row.querySelector('.pricecheck-difference strong').textContent};
        })()""")
        for state, (value, tone) in zip(price_edit['states'], (('+$100', 'positive'), ('$0', 'neutral'), ('-$25', 'negative'), ('-$9,999,899', 'negative'))):
            assert state['text'] == value and tone in state['tone'], state
            assert state['readOnly'] and not state['clipped'], state
        assert price_edit['liveResult'] == '+$20', price_edit
        price_sort = base.ev(cdp, """(()=>{
          const api=RHWV4.pricecheck,original=api.state.marketCache;
          const rows=()=>[...priceCheckRows.querySelectorAll('[data-route-key]')];
          const sort=value=>{priceCheckSort.value=value;priceCheckSort.dispatchEvent(new Event('change',{bubbles:true}));};
          const qty=value=>{priceCheckQuantity.value=value;priceCheckQuantity.dispatchEvent(new Event('input',{bubbles:true}));};
          const key='br01_01_base/commodity_industrial';
          const market=original.routes.map(route=>route.key===key ? {...route,livePrice:0} : route);
          api.state.marketCache={...original,routes:market};
          sort('best');qty('5');
          const unknown=row=>!row.querySelector('.pricecheck-hourly');
          const sorted=rows(),suffix=sorted.slice(sorted.findIndex(unknown));
          const result={best:sorted[0].dataset.routeKey,unknownLast:suffix.length>0&&suffix.every(unknown),
            total:rows()[0].querySelector('.pricecheck-total b')?.textContent};
          sort('worst');result.worst=rows()[0].dataset.routeKey!==key;
          market.find(route=>route.key===key).livePrice=125;api.render();
          result.loss=rows()[0].querySelector('.pricecheck-total b')?.textContent;
          qty('0');result.noInvalidTotal=!priceCheckRows.querySelector('.pricecheck-total');
          api.state.marketCache={...original,routes:[]};api.render();
          result.waiting=priceCheckRows.textContent.includes('No NPC seller reported')&&!priceCheckRows.querySelector('.pricecheck-hourly')
            &&!priceCheckStatusGrid.querySelector('[data-tone="positive"]');
          api.state.marketCache=original;qty('');sort('source');
          return result;
        })()""")
        assert price_sort == {'best':'br01_01_base/commodity_industrial','unknownLast':True,'total':'+$500',
                              'worst':True,'loss':'-$125','noInvalidTotal':True,'waiting':True}, price_sort
        base.ev(cdp, "(()=>{location.hash='#pricecheck/obsolete';return true;})()")
        time.sleep(.15)
        assert base.ev(cdp, 'location.hash') == '#pricecheck/routes', 'Price Check uses the shared canonical route model'
        # Production must open its precise module recipe, even when the same
        # output can be unpacked from a freight container.
        production_recipe = base.ev(cdp, """(()=>{
          RHWV4.navigate('command','production');
          const cards=[...document.querySelectorAll('.production-card')];
          const production={cards:cards.length,crew:cards.filter(card=>card.querySelector('.production-prerequisites')?.textContent.includes('Crew')).length,
            materialCoverage:cards.every(card=>{
              const coverage=card.querySelector('.production-coverage-summary');
              return coverage?.textContent.includes('INPUT DETAILS')&&coverage.textContent.includes('MATERIAL CYCLES')&&coverage.textContent.includes('OUTPUT');
            })};
          const core=RHWV4.operationsCore,catalog=core.state.catalog;
          core.state.catalog=null;renderProductionModules();
          production.unavailable=productionGrid.textContent.includes('PRODUCTION RECIPES UNAVAILABLE')&&!productionGrid.querySelector('.production-card');
          core.state.catalog=catalog;renderProductionModules();
          production.restored=productionGrid.querySelectorAll('.production-card').length===8;
          const costing=document.querySelector('[data-production-product="basic alloy"] .production-calc-button');
          if(!costing)return {production,debug:{titles:[...productionGrid.querySelectorAll('.production-title')].map(n=>n.textContent),buttons:productionGrid.querySelectorAll('.production-calc-button').length,bridge:!!RHWV4.productionPricing,installed:productionGrid.dataset.v40ProductionCalculatorBridge,selfTest:RHWV4.productionPricing?.selfTest()}};
          costing.click();
          const recipe=RHWV4.state.calculator.recipeId;
          return {production,recipe,output:RHWV4.operationsCore.buildPlan({recipeId:recipe,
            quantity:1,affiliationId:'br_m_grp',useInventory:false,recursive:false,routingPolicy:'first'}).actualOutput,
            materialNames:document.getElementById('opsMaterialPanel').textContent};
        })()""")
        assert production_recipe['production']['cards'] == 8 and production_recipe['production']['crew'] >= 3 and all(production_recipe['production'][key] for key in ('materialCoverage','unavailable','restored')), production_recipe
        assert production_recipe['recipe'] == 'recipe_scrap_advanced' and production_recipe['output'] == 750, production_recipe
        assert 'Scrap Metal' in production_recipe['materialNames'] and 'Sealed Container' not in production_recipe['materialNames'], production_recipe
        # A rejected named-save must leave the old archive and the newly typed
        # editor text intact, and must show the failure instead of success.
        failed_save = base.ev(cdp, """(()=>{
          RHWV4.navigate('comms','forum');
          const a=RHWV4,key=a.config.storageKeys.commsDrafts,write=a.store.set;
          a.storage.saveDraft({...a.state.comms,message:'SAVED AUDIT TEXT'},'AUDIT STORAGE FAILURE');
          const before=JSON.stringify(a.state.drafts),disk=localStorage.getItem(key);
          commsDraftName.value='AUDIT STORAGE FAILURE';commsMessage.value='UNSAVED AUDIT TEXT';
          a.store.set=(k,v)=>k===key?false:write(k,v);
          try {
            saveDraftBtn.click();
            return {archive:JSON.stringify(a.state.drafts)===before,disk:localStorage.getItem(key)===disk,
              text:commsMessage.value,warning:document.getElementById('commsStatus')?.textContent||''};
          } finally {a.store.set=write;}
        })()""")
        assert failed_save['archive'] and failed_save['disk'] and failed_save['text'] == 'UNSAVED AUDIT TEXT', failed_save
        assert 'COULD NOT BE SAVED' in failed_save['warning'], failed_save
        # Keyboard-sized viewport: focus and price must survive status updates.
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 430, 'deviceScaleFactor': 1, 'mobile': True})
        base.ev(cdp, """(()=>{RHWV4.navigate('operations','calculator');const e=document.querySelector('[data-material-price]');e.value='123';e.dispatchEvent(new Event('input',{bubbles:true}));e.focus();e.scrollIntoView({block:'center'});return true;})()""")
        time.sleep(.5)
        capture(cdp, '390-calculator-keyboard')
        focused = base.ev(cdp, """(()=>{const e=document.activeElement,r=e.getBoundingClientRect();return {price:e.value,kind:!!e.dataset.materialPrice,top:r.top,bottom:r.bottom,nav:rhwAppNav.getBoundingClientRect().bottom};})()""")
        assert focused['kind'] and focused['price'] == '123' and focused['top'] >= focused['nav'] and focused['bottom'] <= 430, focused
        # Offline reload must boot the same bundles and retain local font access.
        stored_snapshot = base.ev(cdp, 'RHWTelemetryCache.read().then(snapshot=>snapshot?.fetchedAt)')
        assert stored_snapshot, 'A successful live response must persist a public stock snapshot'
        previous_document = base.ev(cdp, 'performance.timeOrigin')
        cdp.call('Network.emulateNetworkConditions', {'offline': True, 'latency': 0, 'downloadThroughput': 0, 'uploadThroughput': 0})
        time.sleep(.15)
        cached = base.ev(cdp, '({available:telemetrySnapshot().available,stale:telemetrySnapshot().stale,notice:!telemetryNotice.hidden})')
        assert all(cached.values()), cached
        offline_prices = base.ev(cdp, """(()=>{
          const a=RHWV4;a.navigate('pricecheck','routes');
          const key='br01_01_base/commodity_industrial';
          const row=a.pricecheck.effectiveRow(a.pricecheck.routes.find(r=>r.key===key));
          return {cached:!row.fresh&&row.live!==null,copy:document.querySelector(`[data-route-key="${key}"] .pricecheck-live`).textContent};
        })()""")
        assert offline_prices['cached'] and offline_prices['copy'].startswith('CACHED'), offline_prices
        cdp.call('Page.reload')
        wait_ready(cdp, previous_document)
        offline = base.ev(cdp, """(()=>{RHWV4.navigate('command','inventory');scrollTo(0,0);return {revision:RHW_BUILD.revision,
          available:telemetrySnapshot().available,stale:telemetrySnapshot().stale,notice:!telemetryNotice.hidden,
          at:telemetrySnapshot().fetchedAt,stock:stockFor('Basic Alloy'),font:document.fonts.check('16px Barlow')};})()""")
        assert offline['available'] and offline['stale'] and offline['notice'] and offline['font'], offline
        assert offline['at'] == stored_snapshot and offline['stock'] == STOCK['Basic Alloy'], offline
        capture(cdp, '390-inventory-offline')
        base.ev(cdp, "RHWV4.navigate('pricecheck','routes')")
        deadline = time.monotonic() + 6
        while base.ev(cdp, 'RHWV4.pricecheck.routes.length') != PRICE_OFFER_COUNT:
            if time.monotonic() >= deadline:
                raise AssertionError('Price Check did not restore the scoped snapshot offline')
            time.sleep(.05)
        restored_market = base.ev(cdp, """(()=>({at:RHWV4.pricecheck.state.marketCache.fetchedAt,
          label:RHWV4.pricecheck.state.marketLabel,warning:!!document.getElementById('rhwStorageWarning')}))()""")
        assert restored_market == {'at': price_cache['at'], 'label': 'CACHED MARKET', 'warning': False}, restored_market
        # Both Forum images work offline and export in their intended order.
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': 1366, 'height': 940, 'deviceScaleFactor': 1, 'mobile': False})
        forum_offline = base.ev(cdp, """(async()=>{
          RHWV4.navigate('comms','forum');
          const preview=document.getElementById('forumLivePreview');
          RHWV4.comms.renderPreview(RHWV4.storage.defaultState());
          const images=[...preview.querySelectorAll('img')];
          await Promise.all(images.map(img=>{img.loading='eager';return img.decode();}));
          const state={...RHWV4.state.comms,templateKey:'incident',classification:'',subject:'Docking Notice',
            message:'## Yard access\\n!warning Berth 2 closed.',footerMotto:'Custom transmission motto',systemDate:'27/11/836'};
          const bbcode=RHWV4.comms.buildBbcode(state);
          return {images:images.map(img=>[img.naturalWidth,img.naturalHeight,new URL(img.src).origin===location.origin]),
            crest:[images[0].width,images[0].height],
            order:[...bbcode.matchAll(/\\[img(?:=[^\\]]+)?\\](.*?)\\[\\/img\\]/g)].map(match=>match[1]),
            identity:preview.querySelector('.forum-preview-brand-name').textContent==='RESOLUTION'
              &&preview.querySelector('.forum-preview-document').textContent.includes('OFFICE OF THE CHIEF EXECUTIVE'),
            details:[...preview.querySelectorAll('.forum-preview-meta dt')].map(label=>label.textContent),
            stamp:preview.querySelector('.forum-preview-stamp').textContent.includes('SECURE TRANSMISSION · RES OFFICIAL')
              &&preview.querySelector('.forum-preview-stamp').textContent.includes('[RES] SYSTEM TIME: UNSET'),
            footer:bbcode.indexOf('[align=right]')<bbcode.indexOf('rhw-forum-footer.png')
              &&bbcode.indexOf('rhw-forum-footer.png')<bbcode.indexOf('Custom transmission motto'),
            style:!bbcode.includes('[table')&&bbcode.includes('[font=Georgia][size=x-large][b][color=#C9AA70]Docking Notice')
              &&bbcode.includes('SECURE TRANSMISSION · PRIORITY // RESTRICTED[br][RES] SYSTEM TIME: 27/11/836')
              &&bbcode.includes('Berth 2 closed.')&&bbcode.includes('27/11/836')};
        })()""")
        assert forum_offline['images'] == [[320, 399, True], [360, 107, True]], forum_offline
        assert forum_offline['crest'] == [240, 299], forum_offline
        assert forum_offline['order'] == ['https://phytehq.github.io/RHW/assets/rhw-forum-logo.png',
                                          'https://phytehq.github.io/RHW/assets/rhw-forum-footer.png'], forum_offline
        assert forum_offline['details'] == ['FROM', 'TO', 'ISSUED AT', 'SECURITY'], forum_offline
        assert all(forum_offline[key] for key in ('identity', 'stamp', 'footer', 'style')), forum_offline
        (OUT / 'checks.json').write_text(json.dumps({'layouts': report, 'connectionHeaders': header_states, 'shipyard': shipyard, 'shipyardRowHeaders': row_header_checks, 'marketLayouts': market_layouts, 'disclosure': disclosure, 'commandSearch': command_search, 'retired': retired, 'keyboard': focused, 'priceFocus': price_focus, 'priceEdit': price_edit, 'productionRecipe': production_recipe, 'failedSave': failed_save, 'offlinePrices': offline_prices, 'offline': offline}, indent=2))
        print(f'Bundled interface passed: {len(report)} layouts, production recipe, rejected save, cached prices, keyboard focus, local fonts and offline reload.')
        return 0
    except Exception:
        if cdp:
            capture(cdp, 'failure')
        raise
    finally:
        if cdp:
            cdp.close()
        chrome.terminate()
        server.shutdown()


if __name__ == '__main__':
    raise SystemExit(main())
