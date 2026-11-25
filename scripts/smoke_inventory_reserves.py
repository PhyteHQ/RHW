#!/usr/bin/env python3
"""Real inventory rendering, navigation and keyboard/touch controls."""
import base64
import json
from pathlib import Path
import shutil
import time
import smoke_v40 as base


def wait(cdp, expression, seconds=15):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        if base.ev(cdp, expression):
            return
        time.sleep(.1)
    raise RuntimeError('Inventory timed out: ' + expression)


def main():
    chrome, _, port, folder, _ = base.launch()
    server = base.serve_inline_documents()
    cdp = None
    try:
        target = next(p for p in json.loads(base.get(f'http://127.0.0.1:{port}/json/list', 3)) if p.get('type') == 'page')
        cdp = base.CDP(target['webSocketDebuggerUrl'])
        for method in ('Page.enable', 'Runtime.enable', 'Network.enable'):
            cdp.call(method)
        cdp.call('Network.setBlockedURLs', {'urls': ['https://*']})
        base.load_document(cdp, target['id'], base.document('command/inventory'), f'http://127.0.0.1:{server.server_port}')
        wait(cdp, "document.documentElement.dataset.v40Ready==='true' && !!RHWV4.operationsCore.state.catalog")
        base.ev(cdp, """(()=>{
          const stock=(name,quantity)=>({name,quantity,min_stock:0,max_stock:100000,category:'commodity'});
          items=[stock('Basic Alloy',43675),stock('Consumer Goods',32568),stock('Food Rations',33277),
            stock('Gold',0),stock('Wildcat Gold',8600),stock('Niobium',9519),stock('Prototype Components',40),
            stock('Gold Ore',0),stock('Niobium Ore',0),stock('Military Salvage',250),stock('Scrap Metal',7978),
            stock('Multi-Mode Focusing Chamber',50),stock('Reactor Systems',564),stock('Superstructure Systems',523),stock('Toxic Waste',10200),stock('MOX',8381),stock('Uranium',100),
            {nickname:'medium_miner_package',name:'Archon Modular Miner',quantity:2},{name:'Archon Design Schematics',quantity:99},
            {nickname:'dsy_cargobarge_1_package',name:'Barge',quantity:3},stock('Crew',2400),stock('Scientists',500)];
          rhwBase={cargospace:1000000,money:50000000};lastLoaded=new Date();dataIsStale=false;lastSyncError='';
          rebuildItemCaches();renderAll();RHWV4.command.updateOverview();return true;
        })()""")
        state = base.ev(cdp, """(()=>({counts:[maintenanceList.children.length,reserveList.children.length,exportList.children.length],
          gold:reserveList.children[0].innerText,stocks:[...reserveList.querySelectorAll('.overview-row-qty')].map(n=>n.textContent),
          goldName:reserveList.querySelector('.inventory-production-link').textContent,
          goldTotalLabel:reserveList.querySelector('.overview-stock-total')?.textContent,
          goldParts:[...reserveList.querySelectorAll('.inventory-pool-parts>span')].map(row=>[row.firstElementChild.textContent,row.lastElementChild.textContent]),
          inputs:[...inventoryStatusPanel.querySelectorAll('[data-input-name]')].map(n=>n.dataset.inputName),
          inputMeters:[...inventoryStatusPanel.querySelectorAll('[data-input-name] [role="meter"]')].map(n=>n.closest('[data-input-name]').dataset.inputName),
          ships:[...shipStockList.querySelectorAll(':scope>.inventory-ship-row button')].map(n=>n.textContent),
          phantom:[...v40PriorityList.querySelectorAll('strong')].some(n=>n.textContent.startsWith('EXPORT // GOLD')||n.textContent.startsWith('SEIZED // WILDCAT')),
          exports:[...exportList.querySelectorAll('[data-export-commodity]')].map(n=>n.dataset.exportCommodity)}))()""")
        assert state['counts'] == [3, 4, 3], state
        assert state['stocks'] == ['8.600', '9.519', '40', '8.381'], state
        assert state['goldName'] == 'Gold' and state['goldTotalLabel'] == 'Total' and state['goldParts'] == [['Gold', '0'], ['Wildcat Gold', '8.600']], state
        assert 'Wildcat Gold' in state['gold'] and '0 input batches' in state['gold'].lower(), state
        assert not state['phantom'] and state['inputMeters'] == ['Toxic Waste'], state
        assert sorted(state['inputs']) == sorted(['Gold Ore', 'Niobium Ore', 'Military Salvage', 'Scrap Metal', 'Toxic Waste']), state
        assert len(state['ships']) == 2 and any('Archon' in n and '2' in n for n in state['ships']), state
        assert not any(n in state['exports'] for n in ['Gold', 'Wildcat Gold', 'Niobium', 'Prototype Components', 'MOX']), state
        assert base.ev(cdp, """(()=>{const waste=reserveList.lastElementChild.querySelector('[data-input-name="Toxic Waste"]');
          return inventoryStatusPanel.querySelectorAll('[data-input-name="Toxic Waste"]').length===1
            &&waste.textContent.includes('10.200')&&waste.textContent.includes('10 input batches · BASIC MOX')
            &&waste.querySelector('.stock-capacity-max-label').textContent==='Max 100.000';})()""")
        reported_population = "['2.900 · Darkstat', '2.900 · Darkstat cache'].includes(rhwPopulationTotal.textContent)"
        assert base.ev(cdp, f"""maintenanceList.querySelectorAll('[role="meter"]').length===3 &&
          !reserveList.firstElementChild.querySelector('[role="meter"]') &&
          productionGrid.querySelector('.production-stock-primary .stock-capacity-max-label')?.textContent==='Max 100.000' &&
          maintenanceList.querySelector('.stock-capacity-min-label')?.textContent==='Min 0' &&
          {reported_population} &&
          rhwPopulationCoverage.textContent.includes('5.800 Food Rations') &&
          maintenanceList.textContent.includes('~5,7 days')"""), 'Capacity and maintenance use reported stock and population'
        base.ev(cdp, """(()=>{
          rhwPopulation.open=true;
          rhwPopulationForm.elements.crew.value=1100;
          rhwPopulationForm.elements.scientists.value=100;
          rhwPopulationForm.requestSubmit();
          return true;
        })()""")
        assert base.ev(cdp, f"""rhwPopulationStatus.textContent.includes('saved on this device') &&
          {reported_population}"""), 'Reported counts take precedence over saved fallback'
        base.ev(cdp, """(()=>{items=items.filter(item=>item.name!=='Scientists');renderOverview();return true;})()""")
        assert base.ev(cdp, """rhwPopulationTotal.textContent==='1.200 · Saved on this device' &&
          rhwPopulationCoverage.textContent.includes('2.400 Consumer Goods') &&
          maintenanceList.textContent.includes('~13,9 days')"""), 'Incomplete Darkstat counts use the local fallback'
        out = Path(__file__).resolve().parents[1] / 'artifacts/interface'
        out.mkdir(parents=True, exist_ok=True)
        for width in [360, 390, 820, 1440]:
            cdp.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 1100, 'deviceScaleFactor': 1, 'mobile': width < 760})
            base.ev(cdp, "inventoryStatusPanel.scrollIntoView({block:'start',behavior:'instant'})")
            geometry = base.ev(cdp, """(()=>{
              const r=n=>n.getBoundingClientRect();
              const panel=name=>inventoryStatusPanel.querySelector('.'+name);
              const reserve=r(panel('reserve-panel')),exports=r(panel('export-panel')),ships=r(panel('ship-stock-panel'));
              return {overflow:document.documentElement.scrollWidth>innerWidth+2,
                internal:inventoryStatusPanel.scrollWidth>inventoryStatusPanel.clientWidth+2,
                sectionsAligned:[exports,ships].every(x=>Math.abs(x.left-reserve.left)<2&&Math.abs(x.width-reserve.width)<2),
                ordered:reserve.bottom<=exports.top&&exports.bottom<=ships.top,
                reserveColumns:getComputedStyle(reserveList).gridTemplateColumns.split(' ').length,
                reserveCardsFit:[...reserveList.children].every(card=>card.scrollWidth<=card.clientWidth+1),
                reserveQuantityInline:[...reserveList.children].every(card=>{
                  const name=r(card.querySelector('.overview-item-copy')),stock=r(card.querySelector('.overview-stock-value'));
                  return stock.left>=name.right-1&&stock.top<name.bottom&&stock.bottom>name.top;
                }),
                reserveNamesFit:[...reserveList.querySelectorAll('.inventory-production-link')].every(button=>{
                  const text=document.createRange();text.selectNodeContents(button);
                  return text.getClientRects().length<=2;
                }),
                touch:[...inventoryStatusPanel.querySelectorAll('button')].filter(n=>n.getClientRects().length).every(n=>r(n).height>=(innerWidth<760?43:27))};
            })()""")
            assert not geometry['overflow'] and not geometry['internal'] and geometry['touch'], (width, geometry)
            assert geometry['sectionsAligned'] and geometry['ordered'], 'Inventory must use aligned full-width sections: '+str(geometry)
            assert geometry['reserveCardsFit'] and geometry['reserveColumns'] == (4 if width >= 1440 else 2 if width >= 820 else 1), (width, geometry)
            assert width >= 760 or geometry['reserveQuantityInline'] and geometry['reserveNamesFit'], (width, geometry)
            (out / f'inventory-reserves-{width}.png').write_bytes(base64.b64decode(cdp.call('Page.captureScreenshot', {'format': 'png'})['data']))
        # Raw manifest entries stay separate, including a real zero Gold stock.
        base.ev(cdp, "(()=>{inventoryManifestTab.click();roleFilter.value='reserve';roleFilter.dispatchEvent(new Event('change'));return true;})()")
        assert base.ev(cdp, """itemsBody.querySelectorAll('tr').length===5 &&
          [...itemsBody.querySelectorAll('tr')].some(n=>n.textContent.includes('Wildcat Gold')) &&
          itemsBody.querySelectorAll('.manifest-stock [role="meter"]').length===5""")
        base.ev(cdp, "(()=>{inventoryStatusTab.click();window.inventoryBefore=JSON.stringify(items);reserveList.querySelector('button[data-inventory-material]').click();return true;})()")
        wait(cdp, "!!document.querySelector('.inventory-uses-dialog[open]')")
        # A telemetry repaint can replace the original overview trigger while
        # material details are open; close must find its current replacement.
        base.ev(cdp, "(()=>{renderAll();RHWV4.itemDetails.close();return true})()")
        wait(cdp, "document.activeElement?.dataset.inventoryMaterial==='Gold'")
        base.ev(cdp, "reserveList.querySelector('button[data-inventory-material]').click()")
        base.ev(cdp, "document.querySelector('[data-inventory-choice=\"recipe_weapon_part_focusing_chamber\"]').click()")
        wait(cdp, "document.body.dataset.commandNode==='production' && !!document.querySelector('.inventory-target')")
        assert base.ev(cdp, "JSON.stringify(items)===inventoryBefore && document.querySelector('.inventory-target').dataset.productionRecipe==='recipe_weapon_part_focusing_chamber'")
        base.ev(cdp, '(()=>{RHWV4.itemDetails.close();RHWV4.navigate(\'command\',\'inventory\');reserveList.querySelector(\'[data-input-name="Military Salvage"] button\').click();return true;})()')
        wait(cdp, "!!document.querySelector('.inventory-target[data-production-recipe=\"recipe_milsal\"]')")
        assert base.ev(cdp, "document.querySelector('.inventory-target .production-cycle-time').textContent.includes('2h 5m') && JSON.stringify(items)===inventoryBefore")
        # MOX reserve inputs, navigation and calculator stay on the same variant.
        base.ev(cdp, "(()=>{const s=document.querySelector('[data-production-mox]');s.value='recipe_mox_fuel_advanced';s.dispatchEvent(new Event('change',{bubbles:true}));RHWV4.itemDetails.close();RHWV4.navigate('command','inventory');return true;})()")
        assert base.ev(cdp, "(()=>{const r=reserveList.lastElementChild;return r.dataset.inventoryRecipe==='recipe_mox_fuel_advanced'&&r.textContent.includes('INTERNAL USE')&&r.querySelectorAll('[data-input-name]').length===2&&!!r.querySelector('[data-input-name=\"Uranium\"]')&&r.textContent.includes('ADVANCED MOX')})()")
        base.ev(cdp, "reserveList.lastElementChild.querySelector('.inventory-production-link').click()")
        wait(cdp, "!!document.querySelector('.inventory-target[data-production-recipe=\"recipe_mox_fuel_advanced\"]')")
        assert base.ev(cdp, "JSON.stringify(items)===inventoryBefore&&RHWV4.productionPricing.findRecipeForLabel('MOX').id==='recipe_mox_fuel_advanced'")
        base.ev(cdp, "(()=>{const s=document.querySelector('[data-production-mox]');s.value='recipe_mox_fuel_basic';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()")
        assert base.ev(cdp, "!document.querySelector('[data-production-plan],[data-production-hull-plan],#productionPlanSummary') && !RHWV4.productionPlan && !RHWV4.productionScenario")
        # A stock click opens the matching ship preview without any plan controls.
        base.ev(cdp, '(()=>{RHWV4.itemDetails.close();RHWV4.navigate(\'command\',\'inventory\');shipStockList.querySelector(\'[data-inventory-hull="barge"]\').click();return true;})()')
        wait(cdp, "document.body.dataset.commandNode==='shipyard' && RHWV4.shipyard.selectedHull().key==='barge'")
        assert base.ev(cdp, "!shipyardControl.querySelector('[data-production-hull-plan],.production-pinned-hull')")
        # An unreported PC stock is displayed as unknown, never an invented zero.
        base.ev(cdp, "(()=>{items.find(n=>n.name==='Prototype Components').quantity=null;RHWV4.itemDetails.close();RHWV4.navigate('command','inventory');renderOverview();return true;})()")
        assert base.ev(cdp, "reserveList.children[2].classList.contains('alert-waiting') && reserveList.children[2].querySelector('.overview-row-qty').textContent==='–'")
        base.ev(cdp, "(()=>{items.filter(n=>['Basic Alloy','Toxic Waste'].includes(n.name)).forEach(n=>n.quantity=null);renderOverview();return true;})()")
        assert base.ev(cdp, """(()=>{const waste=reserveList.querySelector('[data-input-name="Toxic Waste"]');
          return maintenanceList.firstElementChild.textContent.includes('STOCK UNKNOWN') && !maintenanceList.firstElementChild.querySelector('[role=meter]')
            && !maintenanceList.firstElementChild.textContent.includes('FACILITY STABLE') && waste.textContent.includes('Stock unknown')
            && !waste.querySelector('[role=meter]') && !waste.textContent.includes('CONTAINMENT CRITICAL');})()"""), 'Unknown stock must not claim stability, capacity or overflow'
        base.ev(cdp, """(()=>{
          const stock=(name,quantity)=>({name,quantity,min_stock:0,max_stock:1000000,category:'commodity'});
          const names=new Set();
          for(const recipe of RHWV4.production.recipes())for(const [name] of recipe.ingredients)names.add(name);
          items=[...names].map(name=>stock(name,10000));
          items.find(n=>n.name==='Gold').quantity=8600;
          items=items.filter(n=>n.name!=='Wildcat Gold');
          rebuildItemCaches();renderAll();RHWV4.itemDetails.close();RHWV4.navigate('command','production');return true;
        })()""")
        assert base.ev(cdp, "findCommodity('Wildcat Gold').missing && Number.isFinite(analyzeRecipe(RHWV4.production.recipes().find(r=>r.recipeId==='ship_part_superstructure')).possibleCycles) && !document.querySelector('[data-production-recipe=\"ship_part_superstructure\"]').textContent.includes('INPUT STOCK UNKNOWN')"), 'Synthetic alternate rows must not invalidate reported Gold'
        print('Inventory browser passed: 3–4–3, internal MOX and variant-aware input links, pooled Gold, exact ship counts, view-only navigation, unknown stock and responsive layouts.')
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


if __name__ == '__main__':
    main()
