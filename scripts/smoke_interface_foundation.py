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


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


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
        fixture = f"""(() => {{
          const original = window.fetch;
          window.fetch = (input, options) => {{
            if (String(input?.url || input).includes('darkstat.dd84ai.com/api/pobs')) {{
              if (!navigator.onLine) return Promise.reject(new Error('OFFLINE FIXTURE'));
              return Promise.resolve(new Response(JSON.stringify({json.dumps(DATA)}), {{headers:{{'Content-Type':'application/json'}}}}));
            }}
            return original(input, options);
          }};
        }})();"""
        cdp.call('Page.addScriptToEvaluateOnNewDocument', {'source': fixture})
        cdp.call('Page.navigate', {'url': f'http://127.0.0.1:{server.server_port}/index.html#command/inventory'})
        wait_ready(cdp)
        base.ev(cdp, 'navigator.serviceWorker.ready.then(()=>true)')
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
        (OUT / 'checks.json').write_text(json.dumps({'layouts': report, 'retired': retired, 'keyboard': focused, 'offline': offline}, indent=2))
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
