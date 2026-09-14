#!/usr/bin/env python3
"""CI integration check of the actual bundled site, local fonts and offline shell."""
import base64
import functools
import http.server
import json
import threading
import time
from pathlib import Path

import smoke_v40_base as base

OUT = base.ROOT / 'artifacts/interface'
WIDTHS = (360, 390, 430, 820, 911, 1024, 1093, 1366, 1920)
ROUTES = ('command/inventory', 'command/shipyard', 'command/production', 'command/logistics',
          'operations/calculator', 'pricecheck/routes', 'comms/forum')
STOCK = {'Basic Alloy': 19129, 'Consumer Goods': 24793, 'Food Rations': 22451,
         'Gold Ore': 13500, 'Niobium Ore': 42000, 'Scrap Metal': 16020,
         'Gold': 3000, 'Niobium': 5800, 'Prototype Components': 825,
         'Multi-Mode Focusing Chamber': 2000, 'Reactor Systems': 500,
         'Superstructure Systems': 110, 'Avionics Systems': 420, 'Interior Systems': 300,
         'Propulsion Systems': 350, 'Exotic Systems': 250}
DATA = [{'name': 'Resolution Heavy Works', 'system_name': 'New London', 'money': 46385683,
         'cargospace': 63777, 'health': 24000000,
         'shop_items': [{'name': k, 'quantity': v, 'sell_price': 100, 'buy_price': 80} for k, v in STOCK.items()]},
        {'name': 'Lissheen Logistics Depot', 'system_name': 'Dublin', 'shop_items': [
            {'name': k, 'quantity': v, 'sell_price': 105, 'buy_price': 80} for k, v in STOCK.items()]}]

NPC_DATA = [{'name': name, 'nickname': f'test-source-{i}', 'system_name': system,
             'market_goods': [{'name': commodity, 'base_sells': True, 'price_base_sells_for': 80}
                              for commodity in ('Hull Panels', 'Industrial Materials', 'MOX', 'Niobium', 'Titanium',
                                                'Energy Field Equipment', 'Super Alloy', 'Ablative Armor Plating',
                                                'Food Rations', 'Hydrocarbons', 'Consumer Goods')]}
            for i, (name, system) in enumerate((('Portsmouth Shipyard', 'Cambridge'), ('Planet New London', 'New London'),
                ('Belvedere Refinery', 'New London'), ('Java Station', 'IMG'), ('Kensington Shipping Platform', 'New London'),
                ('Planet Cambridge', 'Cambridge'), ('Durham Outpost', 'Leeds'), ('Oder Shipyard', 'New Berlin')))]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        if self.path not in ('/__rhw_test_pobs', '/__rhw_test_npc'):
            self.send_error(404)
            return
        payload = json.dumps(NPC_DATA if self.path == '/__rhw_test_npc' else DATA).encode()
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


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(base.ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    chrome, _, port, folder, _ = base.launch()
    cdp = None
    try:
        target = next(p for p in json.loads(base.get(f'http://127.0.0.1:{port}/json/list')) if p['type'] == 'page')
        cdp = base.CDP(target['webSocketDebuggerUrl'])
        for method in ('Page.enable', 'Runtime.enable', 'Network.enable'):
            cdp.call(method)
        # Only external game data is synthetic. HTML, bundles, fonts and SW are
        # served unchanged, so a broken loader/cache cannot pass an inline fixture.
        fixture = """(() => {
          const original = window.fetch;
          window.__rhwNpcRequests = 0;
          window.fetch = (input, options) => {
            if (String(input?.url || input).includes('darkstat.dd84ai.com/api/pobs')) {
              // Use real transport so the offline check cannot receive an
              // in-memory fixture when a new document resets navigator.onLine.
              return original('/__rhw_test_pobs', {...options, method:'POST'});
            }
            if (String(input?.url || input).includes('darkstat.dd84ai.com/api/npc_bases')) {
              window.__rhwNpcRequests++;
              return original('/__rhw_test_npc', {...options, method:'POST'});
            }
            return original(input, options);
          };
        })();"""
        cdp.call('Page.addScriptToEvaluateOnNewDocument', {'source': fixture})
        cdp.call('Page.navigate', {'url': f'http://127.0.0.1:{server.server_port}/index.html#command/inventory'})
        wait_ready(cdp)
        base.ev(cdp, 'navigator.serviceWorker.ready.then(()=>true)')
        assert base.ev(cdp, 'window.__rhwNpcRequests') == 0, 'COMMAND startup must not fetch the Price Check market'
        report = []
        for width in WIDTHS:
            cdp.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 940 if width > 760 else 844, 'deviceScaleFactor': 1, 'mobile': width <= 760})
            for route in ROUTES:
                workspace, node = route.split('/')
                base.ev(cdp, f"(()=>{{RHWV4.navigate('{workspace}','{node}');window.scrollTo(0,0);return true;}})()")
                time.sleep(.35)
                result = base.ev(cdp, """(()=>{
                  const visible=e=>!!e&&e.getBoundingClientRect().height>0&&!e.closest('[hidden]');
                  const tools=document.getElementById('rhwFocusToolsBtn'),nav=document.getElementById('rhwAppNav');
                  const panels=[...document.querySelectorAll('.app-workspace')].filter(visible);
                  return {overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth,
                    toolsInNav:nav.contains(tools),toolsHeight:tools.getBoundingClientRect().height,
                    contextVisible:visible(document.getElementById('appSecondaryNav')),panels:panels.length,
                    tabClipping:[...document.querySelectorAll('.app-tabs button')].some(b=>b.scrollWidth>b.clientWidth+2),
                    noticeVisible:visible(document.getElementById('telemetryNotice')),
                    font:document.fonts.check('16px Barlow'),
                    priceLabelSizes:[...document.querySelectorAll('#opsMaterialPanel td:nth-child(3)')].filter(visible).map(e=>parseFloat(getComputedStyle(e,'::before').fontSize)),
                    inventoryStyled:[...document.querySelectorAll('#inventoryStatusPanel .alert-list')].every(e=>getComputedStyle(e).listStyleType==='none')&&[...document.querySelectorAll('#inventoryStatusPanel .alert-title')].every(e=>getComputedStyle(e).display==='flex'),
                    inputs:[...document.querySelectorAll('#opsMaterialPanel [data-material-price]')].filter(visible).map(e=>e.getBoundingClientRect().width)};
                })()""")
                if width in (390, 1366) and route in ('command/inventory', 'command/logistics', 'operations/calculator', 'pricecheck/routes', 'comms/forum'):
                    capture(cdp, f'{width}-{workspace}-{node}')
                assert result['overflow'] <= 2 and not result['tabClipping'], (width, route, result)
                assert result['toolsInNav'] and result['toolsHeight'] >= 44 and result['panels'] == 1, (width, route, result)
                assert result['contextVisible'] == (workspace == 'command'), (width, route, result)
                assert result['font'] and result['inventoryStyled'] and not result['noticeVisible'], (width, route, result)
                if width >= 1100 and workspace == 'operations':
                    assert result['inputs'] and all(0 < n <= 145 for n in result['inputs']), result
                if width <= 760 and workspace == 'operations':
                    assert result['priceLabelSizes'] and min(result['priceLabelSizes']) >= 11, result
                report.append({'width': width, 'route': route, **result})
        # The old URL must resolve to a current view; no retired editor is mounted.
        retired = base.ev(cdp, """(()=>{RHWV4.navigate('comms','ticker');return {route:location.hash,
          editor:!!document.getElementById('v40NewswireManager'),orders:!!RHWV4.productionOrders,
          archive:typeof RHWV4.legacyArchive.prepareImport==='function',scripts:[...document.scripts].map(s=>s.src)};})()""")
        assert retired['route'] == '#comms/forum' and not retired['editor'] and not retired['orders'] and retired['archive'], retired
        assert len(retired['scripts']) == 4, retired
        # A completed market request and unrelated telemetry must keep the same
        # input node and focus. Former whole-table rendering lost both while typing.
        base.ev(cdp, """(()=>{RHWV4.navigate('pricecheck','routes');const e=document.querySelector('[data-pricecheck-override="hull-panels"]');
          window.__rhwFocusedPrice=e;e.focus();e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}));return true;})()""")
        base.ev(cdp, "RHWV4.pricecheck.refresh({quiet:true}).then(()=>{RHWV4.requestUiUpdate();return true;})")
        time.sleep(.15)
        price_focus = base.ev(cdp, """(()=>{const e=document.querySelector('[data-pricecheck-override="hull-panels"]');
          return {same:e===window.__rhwFocusedPrice,focused:document.activeElement===e,value:e.value,
            stored:RHWV4.pricecheck.state.overrides['hull-panels'],live:RHWV4.pricecheck.state.marketLabel,
            emptyStyleMarkers:document.querySelectorAll('style[data-stylesheet]').length};})()""")
        assert price_focus['same'] and price_focus['focused'] and price_focus['value'] == '0' and price_focus['stored'] == 0, price_focus
        assert price_focus['live'] == 'NPC MARKET LIVE' and price_focus['emptyStyleMarkers'] == 0, price_focus
        base.ev(cdp, "(()=>{location.hash='#pricecheck/obsolete';return true;})()")
        time.sleep(.15)
        assert base.ev(cdp, 'location.hash') == '#pricecheck/routes', 'Price Check uses the shared canonical route model'
        # Keyboard-sized viewport: focus and price must survive status updates.
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 430, 'deviceScaleFactor': 1, 'mobile': True})
        base.ev(cdp, """(()=>{RHWV4.navigate('operations','calculator');const e=document.querySelector('[data-material-price]');e.value='123';e.dispatchEvent(new Event('input',{bubbles:true}));e.focus();e.scrollIntoView({block:'center'});return true;})()""")
        time.sleep(.5)
        capture(cdp, '390-calculator-keyboard')
        focused = base.ev(cdp, """(()=>{const e=document.activeElement,r=e.getBoundingClientRect();return {price:e.value,kind:!!e.dataset.materialPrice,top:r.top,bottom:r.bottom,nav:rhwAppNav.getBoundingClientRect().bottom};})()""")
        assert focused['kind'] and focused['price'] == '123' and focused['top'] >= focused['nav'] and focused['bottom'] <= 430, focused
        # Offline reload must boot the same bundles and retain local font access.
        previous_document = base.ev(cdp, 'performance.timeOrigin')
        cdp.call('Network.emulateNetworkConditions', {'offline': True, 'latency': 0, 'downloadThroughput': 0, 'uploadThroughput': 0})
        time.sleep(.15)
        cached = base.ev(cdp, '({available:telemetrySnapshot().available,stale:telemetrySnapshot().stale,notice:!telemetryNotice.hidden})')
        assert all(cached.values()), cached
        cdp.call('Page.reload')
        wait_ready(cdp, previous_document)
        offline = base.ev(cdp, """(()=>{RHWV4.navigate('command','inventory');scrollTo(0,0);return {revision:RHW_BUILD.revision,
          unknown:!telemetrySnapshot().available,notice:!telemetryNotice.hidden,
          font:document.fonts.check('16px Barlow'),body:document.body.textContent.includes('Stock unknown')};})()""")
        assert offline['unknown'] and offline['notice'] and offline['font'] and offline['body'], offline
        capture(cdp, '390-inventory-offline')
        (OUT / 'checks.json').write_text(json.dumps({'layouts': report, 'retired': retired, 'keyboard': focused, 'priceFocus': price_focus, 'offline': offline}, indent=2))
        print(f'Bundled interface passed: {len(report)} layouts, retired routes, keyboard focus, local fonts and offline reload.')
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
