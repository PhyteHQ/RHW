#!/usr/bin/env python3
"""Browser coverage for purchase quotes, shared inputs and complete inventory."""
from __future__ import annotations
import base64
import json
from pathlib import Path
import shutil
import time
import smoke_v40 as base


def main() -> int:
    chrome, _browser, port, folder, _log = base.launch()
    server = base.serve_inline_documents()
    origin = f"http://127.0.0.1:{server.server_port}"
    cdp = None
    try:
        target = next(page for page in json.loads(base.get(f"http://127.0.0.1:{port}/json/list", 3)) if page.get('type') == 'page')
        cdp = base.CDP(target['webSocketDebuggerUrl'])
        for method in ('Page.enable', 'Runtime.enable', 'Network.enable'):
            cdp.call(method)
        cdp.call('Network.setBlockedURLs', {'urls': ['https://*']})
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
        goods = [
            {'name': 'Basic Alloy', 'quantity': 10000, 'sell_price': 50},
            {'name': 'Industrial Materials', 'quantity': 10000, 'sell_price': 3, 'price': 999},
            {'name': 'MOX', 'quantity': 10000, 'sell_price': 5},
            {'name': 'H-Fuel', 'quantity': 10000, 'sell_price': 1.5},
            {'name': 'Promethene', 'quantity': 10000, 'price': 999},
            {'name': 'Scrap Metal', 'quantity': 0, 'sell_price': 2},
            {'name': 'Iron', 'quantity': 1500, 'sell_price': 4},
            {'name': 'Superstructure Systems', 'quantity': 1000, 'sell_price': 1, 'price_to_buy_from_base': 62000},
            {'name': 'Reactor Systems', 'quantity': 1000, 'price_to_sell_to_base': 1, 'price': 48000},
            {'name': 'Unassigned Shield', 'quantity': 1, 'price': 12345},
        ]
        payload = [{'name': 'Resolution Heavy Works', 'nickname': 'resolution heavy works',
                    'money': 10000000, 'cargospace': 100000, 'health': 24000000, 'shop_items': goods}]
        fixture = '<script>const originalFetch=window.fetch;window.fetch=(url,options)=>String(url).includes("/api/pobs")?Promise.resolve(new Response(JSON.stringify(' + json.dumps(payload) + '),{status:200,headers:{"Content-Type":"application/json"}})):originalFetch(url,options);</script>'
        markup = base.document('command/production').replace('<head>', '<head>' + fixture, 1)
        base.load_document(cdp, target['id'], markup, origin)
        end = time.time() + 10
        while time.time() < end:
            if base.ev(cdp, "document.documentElement.dataset.v40Ready==='true' && !!lastLoaded && document.querySelectorAll('.production-calc-button').length===6"):
                break
            time.sleep(.1)
        else:
            raise RuntimeError(f"Procurement fixture failed to boot: {base.snapshot(cdp)}")

        choice = base.ev(cdp, """(()=>{
          const card=()=>[...document.querySelectorAll('.production-card')].find(node=>node.querySelector('.production-title')?.textContent==='Basic Alloy');
          if(card().classList.contains('production-card-collapsed'))card().querySelector('.production-card-toggle').click();
          for(const [index,value] of [[1,'commodity_h_fuel'],[2,'commodity_iron']]){
            const select=card().querySelector('[data-production-alternative="'+index+'"]');
            select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));
          }
          card().querySelector('.production-calc-button').click();
          const c=RHWV4.state.calculator;
          return {recipe:c.recipeId,choices:c.altSelections,materials:RHWV4.operationsCore.state.currentPlan.directRequirements.map(row=>row.item.id)};
        })()""")
        if choice['recipe'] != 'recipe_scrap_advanced' or choice['choices'].get('recipe_scrap_advanced:2') != 'commodity_iron' or 'commodity_h_fuel' not in choice['materials']:
            raise RuntimeError(f"Production-to-calculator input selection failed: {choice}")
        quote = base.ev(cdp, """(()=>{
          const manual=document.querySelector('[data-material-price="commodity_industrial"]');
          manual.value='0';manual.dispatchEvent(new Event('input',{bubbles:true}));
          document.getElementById('opsLoadRhwPrices').click();
          const c=RHWV4.state.calculator,core=RHWV4.operationsCore,p=core.state.currentPlan;
          return {prices:c.materialPrices,total:core.priceQuote(core.materialRows(p),c,p).totalCost,
            source:document.querySelector('[data-material-price-source="commodity_h_fuel"]').textContent,
            industrial:document.querySelector('[data-material-price-source="commodity_industrial"]').textContent,
            text:document.getElementById('opsTotalCost').textContent,
            persisted:RHWV4.store.get(RHWV4.config.storageKeys.calculatorState)};
        })()""")
        if quote['prices'].get('commodity_industrial') != 0 or quote['prices'].get('commodity_h_fuel') != 1.5 or quote['total'] != 3150 or quote['text'] != '$3,150' or 'RHW BUYS' not in quote['source'] or quote['industrial'] != 'ENTERED PRICE' or 'materialPrices' in quote['persisted'] or 'materialPriceSources' in quote['persisted']:
            raise RuntimeError(f"Explicit RHW purchase quotation failed: {quote}")

        for width, height in [(360, 800), (390, 844), (1440, 1000)]:
            cdp.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': width < 760})
            base.ev(cdp, "document.getElementById('opsMaterialPanel').scrollIntoView({block:'start'})")
            fit = base.ev(cdp, """(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,
              button:document.getElementById('opsLoadRhwPrices').getBoundingClientRect().height,
              choices:[...document.querySelectorAll('[data-ops-alternative]')].map(node=>{const r=node.getBoundingClientRect();return {height:r.height,left:r.left,right:r.right}}),width:innerWidth}))()""")
            if fit['overflow'] or fit['button'] < 44 or any(row['height'] < 44 or row['left'] < -1 or row['right'] > fit['width'] + 1 for row in fit['choices']):
                raise RuntimeError(f"Procurement controls do not fit at {width}: {fit}")
            out = Path(__file__).resolve().parents[1] / 'artifacts/interface'
            out.mkdir(parents=True, exist_ok=True)
            shot = cdp.call('Page.captureScreenshot', {'format': 'png'})
            (out / f'procurement-{width}.png').write_bytes(base64.b64decode(shot['data']))

        changed = base.ev(cdp, """(()=>{
          dataIsStale=true;window.dispatchEvent(new Event('rhw:telemetry'));
          const cached=document.querySelector('[data-material-price-source="commodity_h_fuel"]').textContent;
          const select=document.querySelector('[data-ops-alternative="2"]');
          select.value='commodity_scrap_metal';select.dispatchEvent(new Event('change',{bubbles:true}));
          return {cached,chosen:RHWV4.production.selectionsFor('recipe_scrap_advanced')['recipe_scrap_advanced:2'],
            material:RHWV4.operationsCore.state.currentPlan.directRequirements.find(row=>row.groupIndex===2).item.id};
        })()""")
        if 'CACHED' not in changed['cached'] or changed['chosen'] != 'commodity_scrap_metal' or changed['material'] != changed['chosen']:
            raise RuntimeError(f"Cached quote or Calculator-to-Production selection failed: {changed}")
        ship_value = base.ev(cdp, """(()=>{
          RHWV4.navigate('command','shipyard');
          document.querySelector('[data-shipyard-select="dunkirk"]').click();
          document.querySelector('[data-shipyard-calculate]').click();
          document.getElementById('opsLoadRhwPrices').click();
          return {prices:RHWV4.state.calculator.materialPrices,
            supers:document.querySelector('[data-material-price-source="commodity_ship_part_superstructure"]').textContent,
            reactors:document.querySelector('[data-material-price-source="commodity_ship_part_reactor"]').textContent};
        })()""")
        if ship_value['prices'].get('commodity_ship_part_superstructure') != 62000 or ship_value['prices'].get('commodity_ship_part_reactor') != 48000 or 'RHW SELLS' not in ship_value['supers'] or 'RHW SELLS' not in ship_value['reactors']:
            raise RuntimeError(f"Shipyard inputs must use RHW's sale value for Supers and Reactors: {ship_value}")
        inventory = base.ev(cdp, """(async()=>{
          RHWV4.navigate('command','inventory');document.getElementById('inventoryManifestTab').click();
          const search=document.getElementById('search');search.value='Unassigned';search.dispatchEvent(new Event('input',{bubbles:true}));
          await new Promise(resolve=>setTimeout(resolve,350));
          return {text:document.getElementById('itemsBody').textContent,rows:document.querySelectorAll('#itemsBody tr').length};
        })()""")
        if inventory['rows'] != 1 or 'Unassigned Shield' not in inventory['text'] or 'OTHER' not in inventory['text']:
            raise RuntimeError(f"Complete inventory search failed: {inventory}")
        print('Procurement browser checks passed: real controls, price direction/zeros/provenance, Supers/Reactors at RHW sale value, both input bridges, complete inventory and 360/390/1440px layouts.')
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
