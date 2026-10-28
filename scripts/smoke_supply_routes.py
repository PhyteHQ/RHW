#!/usr/bin/env python3
"""Real context button, lazy modules, worker, cache and mobile supply dialog."""
import base64
import json
from pathlib import Path
import shutil
import time
import smoke_v40 as base


def wait_for(cdp, expression, seconds=20):
    end = time.time() + seconds
    while time.time() < end:
        if base.ev(cdp, expression):
            return
        time.sleep(.1)
    debug = base.ev(cdp, "(()=>({status:document.getElementById('supplyStatus')?.textContent,open:document.getElementById('rhwSupplyDialog')?.open,active:document.activeElement?.outerHTML,buttons:[...document.querySelectorAll('[data-supply-commodity]')].filter(node=>node.getClientRects().length>0).map(node=>({name:node.dataset.supplyCommodity,hidden:!!node.closest('[hidden]'),disabled:node.disabled,card:node.closest('.production-card')?.className}))}))()")
    raise RuntimeError(f'Supply UI timed out: {debug}')


def main():
    chrome, _browser, port, folder, _log = base.launch()
    server = base.serve_inline_documents()
    origin = f'http://127.0.0.1:{server.server_port}'
    cdp = None
    try:
        target = next(page for page in json.loads(base.get(f'http://127.0.0.1:{port}/json/list', 3)) if page.get('type') == 'page')
        cdp = base.CDP(target['webSocketDebuggerUrl'])
        for method in ('Page.enable', 'Runtime.enable', 'Network.enable'):
            cdp.call(method)
        cdp.call('Network.setBlockedURLs', {'urls': ['https://*']})
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
        names = ['Hull Panels', 'Ablative Armor Plating', 'Super Alloy', 'Gold', 'Wildcat Gold', 'Industrial Materials', 'MOX', 'Scrap Metal']
        goods = [{'nickname': 'fixture_' + str(i), 'name': name, 'category': 'commodity', 'quantity': 10000,
                  'min_stock': 0, 'max_stock': 20000, 'price': 100, 'sell_price': 150, 'volume': 1, 'original_volume': 1} for i, name in enumerate(names)]
        goods[1].update(nickname='ablative', quantity=0, volume=2, original_volume=2)
        pob = {'nickname': 'rhw', 'name': 'Resolution Heavy Works', 'system_nickname': 'br01', 'system_name': 'New London',
               'base_pos': [0, 0, 0], 'money': 100000000, 'cargospace': 1000000, 'health': 24000000, 'shop_items': goods}
        express_pob = {'nickname': 'corporate', 'name': 'Corporate Shipping Airways', 'system_nickname': 'br01', 'system_name': 'New London',
                       'base_pos': [25000, 0, 0], 'money': 10000000, 'cargospace': 1000000,
                       'shop_items': [{'nickname': 'ablative', 'name': 'Ablative Armor Plating', 'category': 'commodity', 'quantity': 10000,
                                       'min_stock': 0, 'max_stock': 20000, 'price': 180, 'sell_price': 1, 'volume': 2, 'original_volume': 2}]}
        export_buyer = {'nickname': 'buyer', 'name': 'Buyer Works', 'system_nickname': 'br01', 'system_name': 'New London',
                        'base_pos': [90000, 0, 0], 'money': 1000, 'cargospace': 10000,
                        'shop_items': [{'nickname': 'fixture_3', 'name': 'Gold', 'category': 'commodity', 'quantity': 0,
                                        'min_stock': 0, 'max_stock': 10000, 'price': 9999, 'sell_price': 200, 'volume': 1, 'original_volume': 1},
                                       {'nickname': 'fixture_6', 'name': 'MOX', 'category': 'commodity', 'quantity': 50,
                                        'min_stock': 10, 'max_stock': 10000, 'price': 1, 'sell_price': 1, 'volume': 1, 'original_volume': 1}]}
        def market(base_id, name, pos, buy, sell, volume):
            return {'base_nickname': base_id, 'base_name': name, 'system_nick': 'br01', 'system_name': 'New London',
                    'base_pos': pos, 'base_sells': True, 'price_base_sells_for': buy, 'price_base_buys_for': sell, 'volume': volume}
        commodities = [
            {'nickname': 'ablative', 'name': 'Ablative Armor Plating', 'volume': 2,
             'market_goods': [market('oder', 'Oder Shipyard', [300000, 0, 0], 100, 150, 2)]},
            {'nickname': 'alloy', 'name': 'Super Alloy', 'volume': 1,
             'market_goods': [market('waterloo', 'Waterloo Station', [150000, 0, 0], 10, 10, 1), market('oder', 'Oder Shipyard', [300000, 0, 0], 100, 50, 1)]}
        ]
        nav = {'schema': 1, 'nodes': [{'id': name, 'system': 'br01', 'pos': [pos, 0, 0], 'kind': 'base', 'allows': ['medium', 'large', 'berth']} for name, pos in [('rhw', 0), ('waterloo', 150000), ('oder', 300000), ('corporate', 25000), ('buyer', 90000)]],
               'baseNodes': {'rhw': 'rhw', 'waterloo': 'waterloo', 'oder': 'oder', 'corporate': 'corporate', 'buyer': 'buyer'},
               'links': [{'from': a, 'to': b, 'kind': 'lane', 'speed': 2500} for a, b in [('rhw', 'waterloo'), ('waterloo', 'rhw'), ('waterloo', 'oder'), ('oder', 'waterloo'), ('rhw', 'corporate'), ('corporate', 'rhw')]]}
        ships = [{'nickname': 'dsy_advanced_train', 'name': 'Advanced Train', 'hold_size': 5000, 'cruise_speed': 350, 'dock_type': 2},
                 {'nickname': 'pilgrim_liner', 'name': 'Pilgrim Liner', 'hold_size': 4300, 'cruise_speed': 415, 'dock_type': 3}]
        fixture = {'pobs': [pob, express_pob, export_buyer], 'commodities': commodities, 'ships': ships, 'npc_bases': [], 'factions': [], 'tractors': []}
        script = "<script>window.supplyFixture=" + json.dumps(fixture) + ";window.supplyNav=" + json.dumps(nav) + ";window.supplyRequests=[];const originalFetch=window.fetch;window.fetch=(url,options)=>{const u=String(url);if(u.includes('/api/')){const key=u.split('/api/')[1].split('?')[0];supplyRequests.push(key);if(window.supplyOffline)return Promise.reject(Error('Fixture offline'));return Promise.resolve(new Response(JSON.stringify(supplyFixture[key]||[]),{status:200}));}if(u.includes('/assets/navigation.json.gz'))return Promise.resolve(new Response(JSON.stringify(supplyNav),{status:200}));return originalFetch(url,options);};</script>"
        markup = base.document('command/production').replace('<head>', '<head>' + script, 1)
        base.load_document(cdp, target['id'], markup, origin)
        wait_for(cdp, "document.documentElement.dataset.v40Ready==='true' && !!document.querySelector('.production-card [data-supply-commodity=\"Ablative Armor Plating\"]')")
        if base.ev(cdp, "supplyRequests.includes('commodities')"):
            raise RuntimeError('Supply market must not load before the feature is opened')
        # Context actions stay beside the material name. Verify the actual
        # desktop cascade and phone touch target, not just the SVG's dimensions.
        out = Path(__file__).resolve().parents[1] / 'artifacts/interface'
        out.mkdir(parents=True, exist_ok=True)
        for width, height in [(390, 844), (1440, 1000)]:
            cdp.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': width < 760})
            compact = base.ev(cdp, """(()=>{
              document.getElementById('productionPanel').classList.add('production-expanded');
              document.querySelectorAll('.production-card-collapsed .production-card-toggle').forEach(b=>b.click());
              const buttons=[...document.querySelectorAll('.production-card .rhw-supply-icon')].filter(b=>b.getClientRects().length);
              return {count:buttons.length,overflow:document.documentElement.scrollWidth>innerWidth+1,
                controls:buttons.map(b=>{const r=b.getBoundingClientRect(),name=b.previousElementSibling.getBoundingClientRect();
                  return {width:r.width,height:r.height,inline:r.left>=name.right-1,
                    named:b.getAttribute('aria-label')?.includes(b.dataset.supplyCommodity),
                    tooltip:!!b.title,icon:!!b.querySelector('svg[aria-hidden="true"]'),text:b.textContent.trim()};})};
            })()""")
            expected = 44 if width < 760 else 28
            if not compact['count'] or compact['overflow'] or any(abs(b['width']-expected)>1 or abs(b['height']-expected)>1 or not b['inline'] or not b['named'] or not b['tooltip'] or not b['icon'] or b['text'] for b in compact['controls']):
                raise RuntimeError(f'Compact supply controls failed at {width}: {compact}')
            base.ev(cdp, "document.querySelector('.production-card').scrollIntoView({block:'start',behavior:'instant'})")
            shot = cdp.call('Page.captureScreenshot', {'format': 'png'})
            (out / f'supply-controls-{width}.png').write_bytes(base64.b64decode(shot['data']))
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
        base.ev(cdp, "(()=>{const b=document.querySelector('.production-card [data-supply-commodity=\"Ablative Armor Plating\"]');const card=b.closest('.production-card');if(card.classList.contains('production-card-collapsed'))card.querySelector('.production-card-toggle').click();if(!b.getClientRects().length)throw Error('Supply trigger is not visible');b.focus();b.click();return true})()")
        wait_for(cdp, "document.querySelectorAll('#rhwSupplyDialog .supply-result').length>=2")
        facts = base.ev(cdp, "(()=>({target:document.getElementById('supplyCommodity').value,text:document.getElementById('supplyResults').innerText,first:document.querySelector('.supply-result')?.innerText,reason:document.querySelector('.supply-recommendation-reason')?.innerText,count:document.querySelectorAll('.supply-result').length,choices:document.querySelectorAll('[data-production-alternative]').length,open:document.getElementById('rhwSupplyDialog').open}))()")
        imported = base.ev(cdp, "(()=>({mode:supplyMode.selectedOptions[0].textContent,header:document.querySelector('.header-trade-button small').textContent,groups:[...supplyCommodity.querySelectorAll('optgroup')].map(g=>({label:g.label,names:[...g.querySelectorAll('option')].map(o=>o.value)})),names:[...supplyCommodity.options].map(o=>o.value)}))()")
        systems = next((g['names'] for g in imported['groups'] if g['label'] == 'SHIP SYSTEMS'), [])
        if imported['mode'] != 'IMPORT TO RHW' or imported['header'] != 'IMPORT / EXPORT' or 'Toxic Waste' in imported['names'] or 'Multi-Mode Focusing Chamber' in imported['names'] or not all(name in imported['names'] for name in ['Gold', 'Wildcat Gold', 'Niobium', 'Ablative Armor Plating']) or systems != sorted(systems) or len(systems) != 6:
            raise RuntimeError(f'Imports must contain only import goods with dual-role inputs and grouped systems: {imported}')
        if not facts['open'] or facts['target'] != 'Ablative Armor Plating' or facts['count'] > 3 or facts['choices'] != 0 or 'Waterloo Station' not in facts['text'] or 'Oder Shipyard' not in facts['text'] or '2,500' not in facts['text']:
            raise RuntimeError(f'Supply context/worker result failed: {facts}')
        if 'RECOMMENDED' not in facts['first'] or 'Waterloo Station' not in facts['first'] or 'WHY THIS ROUTE' not in (facts['reason'] or '') or 'more per hour' not in facts['reason']:
            raise RuntimeError(f'Worthwhile backhaul must be recommended first and explained: {facts}')
        express = base.ev(cdp, "(()=>({text:document.querySelector('.supply-express')?.innerText,recommended:document.querySelector('.supply-express')?.classList.contains('supply-recommended')}))()")
        if express['recommended'] or 'Corporate Shipping Airways' not in (express['text'] or '') or 'MATERIAL DELIVERY LOSS' not in express['text'] or '-$75,000' not in express['text']:
            raise RuntimeError(f'Costly POB must be a clearly marked express alternative: {express}')
        for width, height in [(360, 800), (390, 844), (1440, 1000)]:
            cdp.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': width < 760})
            fit = base.ev(cdp, "(()=>{const d=document.getElementById('rhwSupplyDialog'),r=d.getBoundingClientRect();return {overflow:d.scrollWidth>d.clientWidth+1,left:r.left,right:r.right,width:innerWidth,button:document.getElementById('supplySearch').getBoundingClientRect().height};})()")
            if fit['overflow'] or fit['left'] < -1 or fit['right'] > width + 1 or fit['button'] < 44:
                raise RuntimeError(f'Supply dialog overflow at {width}: {fit}')
            base.ev(cdp, "document.querySelector('.supply-result').scrollIntoView({block:'start',behavior:'instant'})")
            out = Path(__file__).resolve().parents[1] / 'artifacts/interface'
            out.mkdir(parents=True, exist_ok=True)
            shot = cdp.call('Page.captureScreenshot', {'format': 'png'})
            (out / f'supply-route-{width}.png').write_bytes(base64.b64decode(shot['data']))
        base.ev(cdp, "(()=>{document.getElementById('supplyPobs').checked=false;document.getElementById('supplyPobs').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('supplySearch').click();return true})()")
        wait_for(cdp, "!document.getElementById('supplySearch').disabled && document.getElementById('supplyResults').dataset.stale==='false'")
        if base.ev(cdp, "!!document.querySelector('.supply-express') || document.getElementById('supplyResults').innerText.includes('Corporate Shipping Airways')"):
            raise RuntimeError('POB OFF must remove the express POB while preserving normal NPC supply')
        base.ev(cdp, "(()=>{document.getElementById('supplyExtra').value='0';document.getElementById('supplyExtra').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('supplySearch').click();return true})()")
        wait_for(cdp, "!document.getElementById('supplySearch').disabled && document.getElementById('supplyResults').dataset.stale==='false'")
        if base.ev(cdp, "document.getElementById('supplyResults').innerText.includes('Waterloo Station')"):
            raise RuntimeError('Direct-only setting retained an extra trading stop')
        base.ev(cdp, "(()=>{window.supplyOffline=true;document.getElementById('supplyRefresh').click();return true})()")
        wait_for(cdp, "!document.getElementById('supplySearch').disabled")
        if 'CACHED' not in base.ev(cdp, "document.getElementById('supplySource').textContent"):
            raise RuntimeError('Failed refresh must label saved market data')
        base.ev(cdp, "document.getElementById('supplyClose').click()")
        wait_for(cdp, "!document.getElementById('rhwSupplyDialog').open && !!document.activeElement.closest('.production-card')", 3)
        # A desktop resize hides mobile material lists. Keep focus in the source
        # module, then separately verify exact trigger restoration on the phone.
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
        base.ev(cdp, "(()=>{window.supplyOffline=false;const b=document.querySelector('.production-card [data-supply-commodity=\"Ablative Armor Plating\"]');b.focus();b.click();return true})()")
        wait_for(cdp, "document.getElementById('rhwSupplyDialog').open && !document.getElementById('supplySearch').disabled && document.querySelectorAll('.supply-result').length>0")
        base.ev(cdp, "document.getElementById('supplyClose').click()")
        wait_for(cdp, "!document.getElementById('rhwSupplyDialog').open && document.activeElement.dataset.supplyCommodity==='Ablative Armor Plating'", 3)
        base.ev(cdp, "(()=>{document.getElementById('supplyPobs').checked=true;location.hash='#command/inventory';return true})()")
        wait_for(cdp, "document.querySelector('#exportList [data-export-commodity=\"Gold\"]')?.getClientRects().length>0")
        base.ev(cdp, "document.querySelector('#exportList [data-export-commodity=\"Gold\"]').click()")
        wait_for(cdp, "document.getElementById('supplyMode').value==='export' && !document.getElementById('supplySearch').disabled && document.querySelectorAll('.supply-result').length>0")
        exported = base.ev(cdp, "(()=>({text:supplyResults.innerText,quantity:document.querySelector('.supply-metrics strong')?.textContent,buyer:document.querySelector('.supply-result h3')?.textContent,reason:document.querySelector('.supply-ship-note')?.textContent,backhaulVisible:!document.querySelector('[data-export-only]').hidden,groups:[...supplyCommodity.querySelectorAll('optgroup')].map(g=>g.label),names:[...supplyCommodity.options].map(o=>o.value),access:document.querySelector('.supply-access-note')?.textContent,backhaul:document.querySelector('.supply-return-cargo')?.textContent}))()")
        if exported['quantity'] != '5' or exported['buyer'] != 'Buyer Works' or 'Buyer funds' not in exported['reason'] or not exported['backhaulVisible'] or '$500' not in exported['text'] or 'owner permissions' not in exported['access'] or exported['groups'][0] != 'SHIP SYSTEMS' or 'Ablative Armor Plating' in exported['names'] or 'MOX' in exported['names'] or 'Toxic Waste' not in exported['names'] or '40 MOX' not in (exported['backhaul'] or ''):
            raise RuntimeError(f'Export quote must honor POB funds and distinguish revenue/profit/access: {exported}')
        base.ev(cdp, "(()=>{supplyBackhaul.checked=false;supplySearch.click();return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplyResults.dataset.stale==='false'")
        if base.ev(cdp, "!!document.querySelector('.supply-return-cargo') || !supplyResults.innerText.includes('Return cargo is disabled')"):
            raise RuntimeError('Return cargo OFF must reproduce the empty-return comparison')
        base.ev(cdp, "(()=>{supplyBackhaul.checked=true;supplySearch.click();return true})()")
        wait_for(cdp, "!supplySearch.disabled && !!document.querySelector('.supply-return-cargo')")
        for width in [360, 390, 1440]:
            cdp.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':900,'deviceScaleFactor':1,'mobile':width<760})
            geometry = base.ev(cdp, "(()=>({overflow:rhwSupplyDialog.scrollWidth>rhwSupplyDialog.clientWidth+1,minimum:Math.min(...[...document.querySelectorAll('.supply-buyer-grid>div')].map(e=>e.getBoundingClientRect().width))}))()")
            if geometry['overflow'] or geometry['minimum'] < 100:
                raise RuntimeError(f'Export dialog fit failed at {width}: {geometry}')
            base.ev(cdp, "document.querySelector('.supply-result').scrollIntoView({block:'start',behavior:'instant'})")
            shot = cdp.call('Page.captureScreenshot', {'format':'png'})
            (out / f'export-route-{width}.png').write_bytes(base64.b64decode(shot['data']))
        base.ev(cdp, "supplyClose.click()")
        wait_for(cdp, "!rhwSupplyDialog.open && document.activeElement.dataset.exportCommodity==='Gold'", 3)
        header = base.ev(cdp, "(()=>({trade:!!document.querySelector('.header-trade-button').getClientRects().length,refresh:!!headerRefreshBtn.getClientRects().length,closed:!uplinkDetails.open}))()")
        if not all(header.values()):
            raise RuntimeError(f'Header actions must remain visible with connection details closed: {header}')
        base.ev(cdp, "document.querySelector('.header-trade-button').click()")
        wait_for(cdp, "rhwSupplyDialog.open && !supplySearch.disabled && supplyMode.value==='export'")
        base.ev(cdp, "(()=>{supplyPobs.checked=false;supplySearch.click();return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplyResults.dataset.stale==='false'")
        if 'Buyer Works' in base.ev(cdp, "supplyResults.innerText"):
            raise RuntimeError('POB OFF must also exclude export buyers')
        base.ev(cdp, "(()=>{supplyMode.value='supply';supplyMode.dispatchEvent(new Event('change',{bubbles:true}));return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplySearch.textContent==='CALCULATE IMPORT ROUTE'")
        if not base.ev(cdp, "supplyCommodity.value==='Ablative Armor Plating' && ![...supplyCommodity.options].some(o=>o.value==='Toxic Waste')"):
            raise RuntimeError('Import mode must restore its own last selection and hide export-only goods')
        base.ev(cdp, "(()=>{supplyMode.value='export';supplyMode.dispatchEvent(new Event('change',{bubbles:true}));return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplyCommodity.value==='Gold'")
        if base.ev(cdp, "[...supplyCommodity.options].some(o=>o.value==='Ablative Armor Plating')"):
            raise RuntimeError('Export mode must restore its own last selection and hide import-only goods')
        base.ev(cdp, "supplyClose.click()")
        wait_for(cdp, "!rhwSupplyDialog.open && document.activeElement.classList.contains('header-trade-button')", 3)
        print('Trade Desk browser passed: supply/express regression, export POB funds, limits and access, header launch/refresh, mode switch, POB OFF, focus and 360/390/1440px layouts.')
    finally:
        if cdp:
            cdp.close()
        server.shutdown()
        chrome.terminate()
        try:
            chrome.wait(timeout=3)
        except Exception:
            chrome.kill()
        shutil.rmtree(folder, ignore_errors=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
