#!/usr/bin/env python3
"""Focused RHW stability smoke: important mobile tools must be discoverable, not merely mounted."""
from __future__ import annotations

import json
import time

import smoke_v40 as harness
import smoke_v40_base as base
import smoke_v402  # noqa: F401  # installs the production CSS/JS asset matrix

# smoke_v402 replaces the base asset list during import; put the final app layers
# back in the exact production order before creating the test document.
harness._ensure_app_layer_assets()


def main() -> int:
    try:
        chrome, browser, port, folder, _log_path = base.launch()
    except Exception as exc:
        print(f"ERROR: {exc}")
        return 1

    try:
        targets = json.loads(base.get(f"http://127.0.0.1:{port}/json/list", 3))
        page = next(item for item in targets if item.get("type") == "page")
        cdp = base.CDP(page["webSocketDebuggerUrl"])
        try:
            for method in ("Page.enable", "Runtime.enable", "Network.enable", "Log.enable"):
                cdp.call(method)
            cdp.call("Network.setBlockedURLs", {"urls": ["https://*", "http://*"]})
            cdp.call("Emulation.setDeviceMetricsOverride", {
                "width": 390, "height": 820, "deviceScaleFactor": 1, "mobile": True,
            })
            cdp.call("Page.navigate", {"url": "about:blank"})
            cdp.call("Page.setDocumentContent", {
                "frameId": page["id"],
                "html": base.document("command/logistics"),
            })

            end = time.time() + 9
            snap = {}
            while time.time() < end:
                snap = base.snapshot(cdp)
                if snap.get("ready") in {"true", "false"}:
                    break
                time.sleep(.1)
            if snap.get("ready") != "true" or snap.get("workspace") != "command" or snap.get("commandNode") != "logistics" or snap.get("errors"):
                raise RuntimeError(f"Stability route did not boot: {snap}")

            # The app deliberately stabilizes late COMMAND layout shifts for up to
            # 850ms. Measure the final settled UI, not an intermediate boot frame.
            time.sleep(.95)
            result = base.ev(cdp, """(()=>{
              const visible=element=>{
                if(!element)return false;
                const style=getComputedStyle(element),rect=element.getBoundingClientRect();
                return style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!=='0'&&rect.width>0&&rect.height>0;
              };
              const rect=element=>{
                const r=element?.getBoundingClientRect();
                return r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}:{top:9999,bottom:9999,left:0,right:0,width:0,height:0};
              };
              const nav=document.getElementById('rhwLogisticsViewNav');
              const market=document.getElementById('marketScanSection');
              const materials=document.getElementById('materialsScanSection');
              const marketTab=nav?.querySelector('[data-logistics-view="market"]');
              const materialsTab=nav?.querySelector('[data-logistics-view="materials"]');
              const context=document.getElementById('commandContextAction');
              const title=document.getElementById('marketScanTitle');
              const price=market.querySelector('[data-market-sort="price"]');
              const stock=market.querySelector('[data-market-sort="stock"]');
              const dock=document.querySelector('.app-tabs');
              const root=document.scrollingElement||document.documentElement;
              const dockTop=rect(dock).top<9999?rect(dock).top:window.innerHeight;
              const initial={
                view:document.body.dataset.logisticsView||'',
                navVisible:visible(nav),navRect:rect(nav),
                marketVisible:visible(market),marketRect:rect(market),
                materialsVisible:visible(materials),
                titleVisible:visible(title),titleRect:rect(title),
                priceVisible:visible(price),priceRect:rect(price),
                stockVisible:visible(stock),stockRect:rect(stock),
                dockTop,
                marketSelected:marketTab?.getAttribute('aria-selected')||'',
                materialsSelected:materialsTab?.getAttribute('aria-selected')||'',
                tabHeights:[marketTab,materialsTab].map(x=>x?.getBoundingClientRect().height||0),
                contextVisible:visible(context),
                calculator:document.querySelector('.app-tabs [data-workspace="operations"] > span')?.textContent?.trim()||'',
                innerWidth:window.innerWidth,innerHeight:window.innerHeight,
                scrollY:window.scrollY,rootScroll:root.scrollTop,maxScroll:Math.max(0,root.scrollHeight-window.innerHeight),
                revealRuns:document.documentElement.dataset.rhwLogisticsRevealRuns||'',
                revealDelta:document.documentElement.dataset.rhwLogisticsRevealDelta||'',
                revealScroll:document.documentElement.dataset.rhwLogisticsRevealScroll||'',
                overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-window.innerWidth,
                failures:RHWV4.stabilityPolish?.selfTest?.()||[]
              };
              materialsTab?.click();
              const materialsState={view:document.body.dataset.logisticsView||'',marketVisible:visible(market),materialsVisible:visible(materials),selected:materialsTab?.getAttribute('aria-selected')||''};
              marketTab?.click();
              const marketState={view:document.body.dataset.logisticsView||'',marketVisible:visible(market),materialsVisible:visible(materials),selected:marketTab?.getAttribute('aria-selected')||''};
              return{initial,materialsState,marketState};
            })()""")

            initial = result.get("initial", {})
            if initial.get("failures"):
                raise RuntimeError(f"Stability self-test failed: {result}")
            if initial.get("calculator") != "CALCULATOR":
                raise RuntimeError(f"Workspace label regression: {result}")
            if initial.get("view") != "market" or not initial.get("navVisible") or not initial.get("marketVisible") or initial.get("materialsVisible"):
                raise RuntimeError(f"Ship Components is not the default visible Logistics tool: {result}")
            if initial.get("marketSelected") != "true" or initial.get("materialsSelected") != "false":
                raise RuntimeError(f"Logistics tab state is inconsistent: {result}")
            if any(height < 43.5 for height in initial.get("tabHeights", [])):
                raise RuntimeError(f"Logistics touch target too small: {result}")
            if initial.get("contextVisible"):
                raise RuntimeError(f"Redundant Inventory cross-link still blocks Logistics: {result}")

            dock_top = initial.get("dockTop", 820)
            nav_rect = initial.get("navRect", {})
            title_rect = initial.get("titleRect", {})
            price_rect = initial.get("priceRect", {})
            stock_rect = initial.get("stockRect", {})
            if (nav_rect.get("top", 9999) < 0 or nav_rect.get("bottom", 9999) > dock_top - 8
                    or not initial.get("titleVisible") or title_rect.get("top", 9999) < 0 or title_rect.get("bottom", 9999) > dock_top - 8
                    or not initial.get("priceVisible") or price_rect.get("top", 9999) < 0 or price_rect.get("bottom", 9999) > dock_top - 8
                    or not initial.get("stockVisible") or stock_rect.get("top", 9999) < 0 or stock_rect.get("bottom", 9999) > dock_top - 8):
                raise RuntimeError(f"Ship Components title/sort controls are not fully usable above the mobile dock: {result}")
            if initial.get("overflow", 0) > 2:
                raise RuntimeError(f"Logistics mobile horizontal overflow: {result}")

            materials_state = result.get("materialsState", {})
            if materials_state != {"view": "materials", "marketVisible": False, "materialsVisible": True, "selected": "true"}:
                raise RuntimeError(f"Industrial Materials switch failed: {result}")
            market_state = result.get("marketState", {})
            if market_state != {"view": "market", "marketVisible": True, "materialsVisible": False, "selected": "true"}:
                raise RuntimeError(f"Ship Components switch-back failed: {result}")

            # Populate both scans using a third-party POB, with enough offers to
            # exercise the mobile disclosure and independent sort controls.
            fixture = base.ev(cdp, """(()=>{
              const names=[...MARKET_SCAN,...MATERIALS_SCAN];
              allBases=Array.from({length:8},(_,i)=>({name:`Scan Test ${i}`,system_name:'Test System',
                shop_items:names.map(name=>({name,quantity:100+i*100,min_stock:20,price_to_buy_from_base:10+i}))}));
              dataIsStale=false;lastSyncError='';lastLoaded=new Date();
              marketSort='price';materialsSort='price';renderSupplier();
              return {
                ships:[...document.querySelectorAll('#marketScanGrid .market-card')].map(c=>c.dataset.marketCommodity),
                materials:[...document.querySelectorAll('#materialsScanGrid .market-card')].map(c=>c.dataset.marketCommodity),
                tabs:[...document.querySelectorAll('#rhwLogisticsViewNav [role="tab"]')].map(b=>b.firstChild.textContent.trim())
              };
            })()""")
            if len(fixture['ships']) != 6 or 'prototype components' in fixture['ships']:
                raise RuntimeError(f"Ship scan target partition failed: {fixture}")
            if fixture['materials'] != ['gold', 'gold ore', 'niobium', 'niobium ore', 'prototype components']:
                raise RuntimeError(f"Material scan target partition failed: {fixture}")
            if fixture['tabs'] != ['SHIP COMPONENTS', 'INDUSTRIAL MATERIALS']:
                raise RuntimeError(f"Logistics naming failed: {fixture}")

            for width in (360, 390, 412, 430):
                cdp.call("Emulation.setDeviceMetricsOverride", {
                    "width": width, "height": 820, "deviceScaleFactor": 1, "mobile": True,
                })
                for view, section_id in [('market', 'marketScanSection'), ('materials', 'materialsScanSection')]:
                    base.ev(cdp, f"document.querySelector('[data-logistics-view=\"{view}\"]').click()")
                    time.sleep(.95)
                    geometry = base.ev(cdp, f"""(()=>{{
                      const section=document.getElementById('{section_id}');
                      const dock=document.querySelector('.app-tabs').getBoundingClientRect();
                      const controls=[document.getElementById('rhwLogisticsViewNav'),section.querySelector('.logistics-subhead-title'),...section.querySelectorAll('.market-sort-button')];
                      const card=section.querySelector('.market-card');
                      const toggle=card.querySelector('.market-mobile-toggle');
                      const visibleRows=()=>[...card.querySelectorAll('.supplier-commodity-row')].filter(r=>r.getBoundingClientRect().height>0).length;
                      if(toggle?.getAttribute('aria-expanded')==='true')toggle.click();
                      const collapsed=visibleRows();toggle?.click();const expanded=visibleRows();toggle?.click();
                      const beforeOther=document.querySelector('#'+('{view}'==='market'?'materialsScanSection':'marketScanSection')+' .market-sort-button[aria-pressed="true"]').dataset.marketSort;
                      section.querySelector('[data-market-sort="stock"]').click();
                      const afterOther=document.querySelector('#'+('{view}'==='market'?'materialsScanSection':'marketScanSection')+' .market-sort-button[aria-pressed="true"]').dataset.marketSort;
                      const first=section.querySelector('.market-card .supplier-commodity-name strong')?.textContent;
                      return {{
                        controls:controls.map(c=>{{const r=c.getBoundingClientRect();return {{top:r.top,bottom:r.bottom,height:r.height,width:r.width}};}}),
                        overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth,
                        dockTop:dock.top,collapsed,expanded,independent:beforeOther===afterOther,first,
                        selected:section.querySelector('[data-market-sort="stock"]').getAttribute('aria-pressed')
                      }};
                    }})()""")
                    if geometry['overflow'] > 2 or any(c['top'] < 0 or c['bottom'] > geometry['dockTop'] - 8 or c['width'] <= 0 for c in geometry['controls']):
                        raise RuntimeError(f"Logistics {view} controls at {width}px are obscured: {geometry}")
                    if any(c['height'] < 43.5 for c in geometry['controls'][2:]):
                        raise RuntimeError(f"Logistics {view} sort touch targets at {width}px are too small: {geometry}")
                    if geometry['collapsed'] != 3 or geometry['expanded'] != 6:
                        raise RuntimeError(f"Logistics {view} offer disclosure failed: {geometry}")
                    if not geometry['independent'] or geometry['selected'] != 'true' or geometry['first'] != 'Scan Test 7':
                        raise RuntimeError(f"Logistics {view} sort interaction failed: {geometry}")

            # Desktop must pair the refined metals with their ores; the old
            # generic 3+2 grid split these pairs across rows on wide displays.
            for width in (1024, 1280, 1440, 1920):
                cdp.call("Emulation.setDeviceMetricsOverride", {
                    "width": width, "height": 1080, "deviceScaleFactor": 1, "mobile": False,
                })
                layout = base.ev(cdp, """(()=>{
                  document.querySelector('[data-logistics-view="materials"]').click();
                  return [...document.querySelectorAll('#materialsScanGrid .market-card')].map(card=>{
                    const r=card.getBoundingClientRect();
                    return {name:card.dataset.marketCommodity,left:r.left,right:r.right,top:r.top,bottom:r.bottom};
                  });
                })()""")
                gold, gold_ore, niobium, niobium_ore, pc = layout
                same = lambda a, b: abs(a - b) < 2
                if (not same(gold['top'], gold_ore['top']) or gold['right'] >= gold_ore['left']
                        or not same(niobium['top'], niobium_ore['top']) or niobium['right'] >= niobium_ore['left']
                        or niobium['top'] < max(gold['bottom'], gold_ore['bottom'])
                        or pc['top'] < max(niobium['bottom'], niobium_ore['bottom'])
                        or not same(pc['left'], gold['left']) or not same(pc['right'], gold_ore['right'])
                        or gold['left'] < 0 or gold_ore['right'] > width):
                    raise RuntimeError(f"Material pairs / full-width Prototype Components at {width}px failed: {layout}")

            keyboard = base.ev(cdp, """(()=>{
              const tabs=[...document.querySelectorAll('#rhwLogisticsViewNav [role="tab"]')];
              tabs[0].focus();tabs[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
              const next=document.activeElement===tabs[1]&&tabs[1].getAttribute('aria-selected')==='true';
              tabs[1].dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
              return {next,home:document.activeElement===tabs[0]&&tabs[0].tabIndex===0&&tabs[1].tabIndex===-1};
            })()""")
            if not all(keyboard.values()):
                raise RuntimeError(f"Logistics keyboard navigation failed: {keyboard}")

            runtime_failures = [
                failure for failure in cdp.take_runtime_failures()
                if not ("TypeError: Failed to fetch" in failure and "fetchWithTimeout" in failure)
            ]
            if runtime_failures:
                raise RuntimeError(f"Browser console/runtime errors: {runtime_failures}")

            print("RHW stability smoke passed: both Logistics scans, independent sorting, mobile 360/390/412/430px, desktop material pairs 1024/1280/1440/1920px, keyboard tabs")
            return 0
        finally:
            try:
                cdp.call("Emulation.clearDeviceMetricsOverride")
            except Exception:
                pass
            cdp.close()
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=3)
        except Exception:
            chrome.kill()
        try:
            folder.cleanup()
        except Exception:
            pass


if __name__ == '__main__':
    raise SystemExit(main())
