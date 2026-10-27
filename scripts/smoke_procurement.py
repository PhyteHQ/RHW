#!/usr/bin/env python3
"""Browser coverage for RHW quotes, automatic pooled inputs and complete inventory."""
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
            {'name': 'Gold', 'quantity': 10, 'sell_price': 60},
            {'name': 'Wildcat Gold', 'quantity': 15, 'sell_price': 20},
            {'name': 'Hull Panels', 'quantity': 10000, 'sell_price': 10},
            {'name': 'Ablative Armor Plating', 'quantity': 10000, 'sell_price': 10},
            {'name': 'Super Alloy', 'quantity': 10000, 'sell_price': 10},
            {'name': 'Superstructure Systems', 'quantity': 1000, 'sell_price': 1, 'price_to_buy_from_base': 62000},
            {'name': 'Reactor Systems', 'quantity': 1000, 'price_to_sell_to_base': 1, 'price': 48000},
            {'name': 'Unassigned Shield', 'quantity': 1, 'price': 12345},
        ]
        payload = [{'name': 'Resolution Heavy Works', 'nickname': 'resolution heavy works',
                    'money': 10000000, 'cargospace': 100000, 'health': 24000000, 'shop_items': goods}]
        fixture = '<script>localStorage.setItem("rhw-webapp-v4:calculator-state",JSON.stringify({altSelections:{"recipe_scrap_advanced:1":"commodity_h_fuel","recipe_scrap_advanced:2":"commodity_iron"}}));const originalFetch=window.fetch;window.fetch=(url,options)=>String(url).includes("/api/pobs")?Promise.resolve(new Response(JSON.stringify(' + json.dumps(payload) + '),{status:200,headers:{"Content-Type":"application/json"}})):originalFetch(url,options);</script>'
        markup = base.document('command/production').replace('<head>', '<head>' + fixture, 1)
        base.load_document(cdp, target['id'], markup, origin)
        end = time.time() + 10
        while time.time() < end:
            if base.ev(cdp, "document.documentElement.dataset.v40Ready==='true' && !!lastLoaded && document.querySelectorAll('.production-calc-button').length===6"):
                break
            time.sleep(.1)
        else:
            raise RuntimeError(f"Procurement fixture failed to boot: {base.snapshot(cdp)}")

        pooled = base.ev(cdp, """(()=>{
          const batch=RHWV4.production.recipes().find(row=>row.recipeId==='ship_part_superstructure');
          const analysis=analyzeRecipe(batch),gold=analysis.ingredientData.find(row=>row.name==='Gold');
          const card=[...document.querySelectorAll('.production-card')].find(node=>node.querySelector('.production-title')?.textContent==='Superstructure Systems');
          if(card.classList.contains('production-card-collapsed'))card.querySelector('.production-card-toggle').click();
          return {stock:gold.stock,cycles:analysis.possibleCycles,text:card.textContent,
            selectors:document.querySelectorAll('[data-production-alternative]').length,
            preferences:RHWV4.store.get(RHWV4.config.storageKeys.calculatorState).altSelections};
        })()""")
        if pooled['stock'] != 25 or pooled['cycles'] != 1 or pooled['selectors'] != 0 or pooled.get('preferences') is not None or 'Gold / Wildcat Gold' not in pooled['text'] or 'STD: 10 // WC: 15' not in pooled['text']:
            raise RuntimeError(f"Automatic mixed-stock production coverage failed: {pooled}")
        for width, height in [(360, 800), (390, 844), (1440, 1000)]:
            cdp.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': width < 760})
            fit = base.ev(cdp, """(()=>{
              document.querySelectorAll('.production-card-collapsed .production-card-toggle').forEach(button=>button.click());
              return {overflow:document.documentElement.scrollWidth>innerWidth+1,
                selectors:document.querySelectorAll('[data-production-alternative]').length};
            })()""")
            if fit['overflow'] or fit['selectors'] != 0:
                raise RuntimeError(f"Pooled production inputs do not fit at {width}: {fit}")
            out = Path(__file__).resolve().parents[1] / 'artifacts/interface'
            out.mkdir(parents=True, exist_ok=True)
            base.ev(cdp, "[...document.querySelectorAll('.production-card')].find(node=>node.querySelector('.production-title')?.textContent==='Superstructure Systems').scrollIntoView({block:'start'})")
            shot = cdp.call('Page.captureScreenshot', {'format': 'png'})
            (out / f'pooled-production-{width}.png').write_bytes(base64.b64decode(shot['data']))

        target_recipe = base.ev(cdp, """(()=>{
          const card=[...document.querySelectorAll('.production-card')].find(node=>node.querySelector('.production-title')?.textContent==='Basic Alloy');
          card.querySelector('.production-calc-button').click();
          return {recipe:RHWV4.state.calculator.recipeId,
            materials:RHWV4.operationsCore.state.currentPlan.directRequirements.map(row=>row.item.id),
            selectors:document.querySelectorAll('[data-ops-alternative]').length};
        })()""")
        if target_recipe['recipe'] != 'recipe_scrap_advanced' or target_recipe['selectors'] != 0 or 'commodity_mox_fuel' not in target_recipe['materials'] or 'commodity_scrap_metal' not in target_recipe['materials']:
            raise RuntimeError(f"Original default costing inputs or removed selectors failed: {target_recipe}")
        quote = base.ev(cdp, """(()=>{
          const manual=document.querySelector('[data-material-price="commodity_industrial"]');
          manual.value='0';manual.dispatchEvent(new Event('input',{bubbles:true}));
          document.getElementById('opsLoadRhwPrices').click();
          const c=RHWV4.state.calculator,core=RHWV4.operationsCore,p=core.state.currentPlan;
          return {prices:c.materialPrices,total:core.priceQuote(core.materialRows(p),c,p).totalCost,
            source:document.querySelector('[data-material-price-source="commodity_mox_fuel"]').textContent,
            industrial:document.querySelector('[data-material-price-source="commodity_industrial"]').textContent,
            text:document.getElementById('opsTotalCost').textContent,
            persisted:RHWV4.store.get(RHWV4.config.storageKeys.calculatorState)};
        })()""")
        if quote['prices'].get('commodity_industrial') != 0 or quote['prices'].get('commodity_mox_fuel') != 5 or quote['total'] != 2000 or quote['text'] != '$2,000' or 'RHW BUYS' not in quote['source'] or quote['industrial'] != 'ENTERED PRICE' or 'materialPrices' in quote['persisted'] or 'materialPriceSources' in quote['persisted']:
            raise RuntimeError(f"Explicit RHW purchase quotation failed: {quote}")

        for width, height in [(360, 800), (390, 844), (1440, 1000)]:
            cdp.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': width < 760})
            base.ev(cdp, "document.getElementById('opsMaterialPanel').scrollIntoView({block:'start'})")
            fit = base.ev(cdp, """(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,
              button:document.getElementById('opsLoadRhwPrices').getBoundingClientRect().height,
              selectors:document.querySelectorAll('[data-ops-alternative]').length}))()""")
            if fit['overflow'] or fit['button'] < 44 or fit['selectors'] != 0:
                raise RuntimeError(f"Procurement controls do not fit at {width}: {fit}")
            out = Path(__file__).resolve().parents[1] / 'artifacts/interface'
            out.mkdir(parents=True, exist_ok=True)
            shot = cdp.call('Page.captureScreenshot', {'format': 'png'})
            (out / f'procurement-{width}.png').write_bytes(base64.b64decode(shot['data']))

        cached = base.ev(cdp, """(()=>{
          dataIsStale=true;window.dispatchEvent(new Event('rhw:telemetry'));
          return document.querySelector('[data-material-price-source="commodity_mox_fuel"]').textContent;
        })()""")
        if 'CACHED' not in cached:
            raise RuntimeError(f"Cached quotation provenance failed: {cached}")
        ship_value = base.ev(cdp, """(()=>{
          RHWV4.navigate('command','shipyard');
          document.querySelector('[data-shipyard-division="naval"]').click();
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
        print('Procurement browser checks passed: real controls, price direction/zeros/provenance, Supers/Reactors at RHW sale value, automatic mixed-stock capacity, removed selectors/preferences, Production shortcut, complete inventory and 360/390/1440px layouts.')
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
