#!/usr/bin/env python3
"""Real inventory rendering, navigation, planning and keyboard/touch controls."""
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
            stock('Multi-Mode Focusing Chamber',50),stock('Reactor Systems',564),stock('Superstructure Systems',523),stock('Toxic Waste',10200),
            {nickname:'medium_miner_package',name:'Archon Modular Miner',quantity:2},{name:'Archon Design Schematics',quantity:99},
            {nickname:'dsy_cargobarge_1_package',name:'Barge',quantity:3},stock('Crew',2400),stock('Scientists',500)];
          rhwBase={cargospace:1000000,money:50000000};lastLoaded=new Date();dataIsStale=false;lastSyncError='';
          rebuildItemCaches();renderAll();RHWV4.command.updateOverview();return true;
        })()""")
        state = base.ev(cdp, """(()=>({counts:[maintenanceList.children.length,reserveList.children.length,exportList.children.length],
          gold:reserveList.children[0].innerText,stocks:[...reserveList.querySelectorAll('.overview-row-qty')].map(n=>n.textContent),
          inputs:[...inventoryStatusPanel.querySelectorAll('[data-input-name]')].map(n=>n.dataset.inputName),
          bars:[...inventoryStatusPanel.querySelectorAll('[data-input-name] .progress-wrap')].length,
          ships:[...shipStockList.querySelectorAll(':scope>.inventory-ship-row button')].map(n=>n.textContent),
          phantom:[...v40PriorityList.querySelectorAll('strong')].some(n=>n.textContent.startsWith('EXPORT // GOLD')||n.textContent.startsWith('SEIZED // WILDCAT')),
          exports:[...exportList.querySelectorAll('[data-export-commodity]')].map(n=>n.dataset.exportCommodity)}))()""")
        assert state['counts'] == [3, 3, 3], state
        assert state['stocks'] == ['8.600', '9.519', '40'], state
        assert 'Wildcat Gold' in state['gold'] and 'NO BATCH READY' in state['gold'], state
        assert not state['phantom'] and state['bars'] == 0, state
        assert sorted(state['inputs']) == sorted(['Gold Ore', 'Niobium Ore', 'Military Salvage', 'Scrap Metal']), state
        assert len(state['ships']) == 2 and any('Archon' in n and '2' in n for n in state['ships']), state
        assert not any(n in state['exports'] for n in ['Gold', 'Wildcat Gold', 'Niobium', 'Prototype Components']), state
        out = Path(__file__).resolve().parents[1] / 'artifacts/interface'
        out.mkdir(parents=True, exist_ok=True)
        for width in [360, 390, 820, 1440]:
            cdp.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 1100, 'deviceScaleFactor': 1, 'mobile': width < 760})
            base.ev(cdp, "inventoryStatusPanel.scrollIntoView({block:'start',behavior:'instant'})")
            geometry = base.ev(cdp, """(()=>{
              const r=n=>n.getBoundingClientRect();const cards=[...inventoryStatusPanel.querySelectorAll('.summary-grid>.alert-card')];
              return {overflow:document.documentElement.scrollWidth>innerWidth+2,
                internal:inventoryStatusPanel.scrollWidth>inventoryStatusPanel.clientWidth+2,
                columns:Math.max(...cards.slice(0,3).map(n=>r(n).top))-Math.min(...cards.slice(0,3).map(n=>r(n).top)),
                heights:Math.max(...cards.slice(0,3).map(n=>r(n).height))-Math.min(...cards.slice(0,3).map(n=>r(n).height)),
                touch:[...inventoryStatusPanel.querySelectorAll('button')].filter(n=>n.getClientRects().length).every(n=>r(n).height>=(innerWidth<760?43:27))};
            })()""")
            assert not geometry['overflow'] and not geometry['internal'] and geometry['touch'], (width, geometry)
            if width > 1100:
                assert geometry['columns'] < 2 and geometry['heights'] < 2, geometry
            (out / f'inventory-reserves-{width}.png').write_bytes(base64.b64decode(cdp.call('Page.captureScreenshot', {'format': 'png'})['data']))
        # Raw manifest entries stay separate, including a real zero Gold stock.
        base.ev(cdp, "(()=>{inventoryManifestTab.click();roleFilter.value='reserve';roleFilter.dispatchEvent(new Event('change'));return true;})()")
        assert base.ev(cdp, "itemsBody.querySelectorAll('tr').length===4 && [...itemsBody.querySelectorAll('tr')].some(n=>n.textContent.includes('Wildcat Gold'))")
        base.ev(cdp, "(()=>{inventoryStatusTab.click();window.inventoryPlanBefore=JSON.stringify(RHWV4.personnel.snapshot());reserveList.querySelector('button[data-inventory-material]').click();return true;})()")
        wait(cdp, "!!document.querySelector('.inventory-uses-dialog[open]')")
        base.ev(cdp, "document.querySelector('[data-inventory-choice=\"recipe_weapon_part_focusing_chamber\"]').click()")
        wait(cdp, "document.body.dataset.commandNode==='production' && !!document.querySelector('.inventory-target')")
        assert base.ev(cdp, "JSON.stringify(RHWV4.personnel.snapshot())===inventoryPlanBefore && document.querySelector('.inventory-target').dataset.productionRecipe==='recipe_weapon_part_focusing_chamber'")
        base.ev(cdp, '(()=>{RHWV4.navigate(\'command\',\'inventory\');reserveList.querySelector(\'[data-input-name="Military Salvage"] button\').click();return true;})()')
        wait(cdp, "!!document.querySelector('.inventory-target[data-production-recipe=\"recipe_milsal\"]')")
        assert base.ev(cdp, "document.querySelector('.inventory-target .production-cycle-time').textContent.includes('2h 5m') && JSON.stringify(RHWV4.personnel.snapshot())===inventoryPlanBefore")
        base.ev(cdp, "document.querySelector('[data-production-plan=\"recipe_milsal\"]').click()")
        assert base.ev(cdp, "RHWV4.personnel.analyze().rows.find(r=>r.key==='reclamation').enabled")
        base.ev(cdp, "document.querySelector('[data-production-plan=\"recipe_milsal\"]').click()")
        assert base.ev(cdp, "!RHWV4.personnel.analyze().rows.find(r=>r.key==='reclamation').enabled")
        # A ship's stock click previews that hull, retaining an existing ship plan.
        base.ev(cdp, '(()=>{RHWV4.shipyard.selectHull(\'archon\');RHWV4.productionPlan.selectHull();window.inventoryHullPlan=RHWV4.personnel.analyze().rows.find(r=>r.key===\'shipyard\').recipeId;RHWV4.navigate(\'command\',\'inventory\');shipStockList.querySelector(\'[data-inventory-hull="barge"]\').click();return true;})()')
        wait(cdp, "document.body.dataset.commandNode==='shipyard' && RHWV4.shipyard.selectedHull().key==='barge'")
        assert base.ev(cdp, "RHWV4.personnel.analyze().rows.find(r=>r.key==='shipyard').recipeId===inventoryHullPlan")
        assert base.ev(cdp, "shipyardRequirements.querySelector('.production-pinned-hull')?.textContent.includes('Archon')"), 'A preserved plan must remain visible beside another hull preview'
        base.ev(cdp, "(()=>{RHWV4.navigate('command','production');productionPlanHull.value='archon';productionPlanHull.dispatchEvent(new Event('change',{bubbles:true}));return true;})()")
        assert base.ev(cdp, "productionShipPlan.querySelector('[data-production-hull-plan]').getAttribute('aria-pressed')==='true'"), 'The pinned hull must still show SHIP PLANNED when selected again'
        base.ev(cdp, "productionShipPlan.querySelector('[data-production-hull-plan]').click()")
        assert base.ev(cdp, "!RHWV4.personnel.analyze().rows.find(r=>r.key==='shipyard').enabled"), 'One click must disable a matching pinned plan'
        # An unreported PC stock is displayed as unknown, never an invented zero.
        base.ev(cdp, "(()=>{items.find(n=>n.name==='Prototype Components').quantity=null;RHWV4.navigate('command','inventory');renderOverview();return true;})()")
        assert base.ev(cdp, "reserveList.children[2].classList.contains('alert-waiting') && reserveList.children[2].querySelector('.overview-row-qty').textContent==='–'")
        base.ev(cdp, "(()=>{items.filter(n=>['Basic Alloy','Toxic Waste'].includes(n.name)).forEach(n=>n.quantity=null);renderOverview();return true;})()")
        assert base.ev(cdp, "maintenanceList.firstElementChild.textContent.includes('STOCK UNKNOWN') && !maintenanceList.firstElementChild.textContent.includes('FACILITY STABLE') && byproductList.textContent.includes('STOCK UNKNOWN') && !byproductList.textContent.includes('CONTAINMENT CRITICAL')"), 'Unknown stock must not claim stability or overflow'
        base.ev(cdp, """(()=>{
          const stock=(name,quantity)=>({name,quantity,min_stock:0,max_stock:1000000,category:'commodity'});
          const names=new Set();
          for(const recipe of RHWV4.production.recipes())for(const [name] of recipe.ingredients)names.add(name);
          items=[...names].map(name=>stock(name,10000));
          items.find(n=>n.name==='Gold').quantity=8600;
          items=items.filter(n=>n.name!=='Wildcat Gold');
          rebuildItemCaches();renderAll();RHWV4.navigate('command','production');return true;
        })()""")
        assert base.ev(cdp, "findCommodity('Wildcat Gold').missing && Number.isFinite(analyzeRecipe(RHWV4.production.recipes().find(r=>r.recipeId==='ship_part_superstructure')).possibleCycles) && !document.querySelector('[data-production-recipe=\"ship_part_superstructure\"]').textContent.includes('INPUT STOCK UNKNOWN')"), 'Synthetic alternate rows must not invalidate reported Gold'
        print('Inventory browser passed: 3–3–3, pooled Gold, attached inputs, exact ship counts, raw manifest, view-only navigation, PC planning, unknown stock and mobile/desktop layouts.')
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
