#!/usr/bin/env python3
"""Focused mobile COMMAND hierarchy smoke for the compact 390px layout."""
from __future__ import annotations

import base64
import json
import time

import smoke_v40 as harness
import smoke_v40_base as base
import smoke_v402  # noqa: F401

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
                "html": base.document("command/inventory").replace('src="./assets/rhw-crest.png"', 'src="data:image/png;base64,' + base64.b64encode((base.ROOT / "assets/rhw-crest.png").read_bytes()).decode() + '"'),
            })

            end = time.time() + 9
            snap = {}
            while time.time() < end:
                snap = base.snapshot(cdp)
                if snap.get("ready") in {"true", "false"}:
                    break
                time.sleep(.1)
            if snap.get("ready") != "true" or snap.get("workspace") != "command" or snap.get("commandNode") != "inventory" or snap.get("errors"):
                raise RuntimeError(f"Compact COMMAND route did not boot: {snap}")

            time.sleep(.18)
            result = base.ev(cdp, """(()=>{
              const visible=el=>{
                if(!el)return false;
                const s=getComputedStyle(el),r=el.getBoundingClientRect();
                return s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'&&r.width>0&&r.height>0;
              };
              const rect=el=>{
                const r=el?.getBoundingClientRect();
                return r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}:{top:9999,bottom:9999,left:0,right:0,width:0,height:0};
              };
              const commandNav=document.getElementById('commandNodeNav');
              const shell=document.getElementById('appSecondaryNav');
              const toolbar=document.getElementById('commandControlDeck');
              const modeNav=document.querySelector('.rhw-inventory-mode-nav');
              const commandButtons=[...commandNav?.querySelectorAll('[data-command-node]')||[]];
              const modeButtons=[...modeNav?.querySelectorAll('[data-inventory-view]')||[]];
              const all=document.querySelector('[data-command-focus-mode="all"]');
              const attention=document.querySelector('[data-command-focus-mode="attention"]');
              const alerts=document.getElementById('commandGlobalAlerts');
              const alertList=document.getElementById('v40PriorityList');
              const status=document.getElementById('inventoryStatusPanel');
              const manifest=document.getElementById('inventoryManifestPanel');
              const initial={
                selfFailures:RHWV4.commandCompactPolish?.selfTest?.()||[],
                commandCount:commandButtons.length,
                commandHeights:commandButtons.map(x=>rect(x).height),
                modeCount:modeButtons.length,
                modeHeights:modeButtons.map(x=>rect(x).height),
                toolbar:modeNav?.parentElement===toolbar&&alerts?.parentElement===toolbar,
                separateContext:!!shell?.contains(commandNav)&&!document.getElementById('rhwAppNav')?.contains(shell),
                gap:modeNav&&commandNav?rect(modeNav).top-rect(commandNav).bottom:9999,
                shellBackground:getComputedStyle(shell||document.body).backgroundColor,
                modePosition:getComputedStyle(modeNav||document.body).position,
                allVisible:visible(all),allHidden:!!all?.hidden,
                attentionVisible:visible(attention),attentionState:document.body.dataset.commandFocus||'',
                alertCount:Number(alerts?.dataset.alertCount||0),alertVisible:visible(alerts),alertHeight:rect(alerts).height,
                alertListVisible:visible(alertList),
                statusVisible:visible(status),manifestVisible:visible(manifest),
                searchVisible:visible(document.getElementById('commandGlobalSearch')),
                searchName:document.getElementById('commandGlobalSearch')?.getAttribute('aria-label')||'',
                searchHeight:rect(document.getElementById('commandGlobalSearch')).height,
                overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-window.innerWidth,
                indexes:modeNav?.querySelectorAll('.rhw-subview-index').length||0
              };
              document.getElementById('commandAlertToggle')?.click();
              const detailsVisible=visible(document.getElementById('commandAlertDetails'));
              const action=alertList?.querySelector('button');
              action?.focus();
              RHWV4.command.updateOverview();
              RHWV4.commandCompactPolish.syncAlerts();
              const stableDisclosure=visible(document.getElementById('commandAlertDetails'))&&document.activeElement===action;
              attention?.click();
              const attentionOn=document.body.dataset.commandFocus||'';
              attention?.click();
              const attentionOff=document.body.dataset.commandFocus||'';
              document.getElementById('commandAlertDetails')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
              const escapeClosed=!visible(document.getElementById('commandAlertDetails'))&&document.activeElement?.id==='commandAlertToggle';
              document.getElementById('inventoryManifestTab')?.click();
              const manifestState={statusVisible:visible(status),manifestVisible:visible(manifest),active:document.getElementById('inventoryManifestTab')?.classList.contains('active')||false};
              document.getElementById('inventoryStatusTab')?.click();
              const statusState={statusVisible:visible(status),manifestVisible:visible(manifest),active:document.getElementById('inventoryStatusTab')?.classList.contains('active')||false};
              return{initial,detailsVisible,stableDisclosure,escapeClosed,attentionOn,attentionOff,manifestState,statusState};
            })()""")

            initial = result.get("initial", {})
            if initial.get("selfFailures"):
                raise RuntimeError(f"Compact COMMAND self-test failed: {result}")
            if not initial.get("searchVisible") or initial.get("searchHeight", 0) < 43.5 or initial.get("searchName") != "Command finder":
                raise RuntimeError(f"COMMAND search is hidden or too small to use: {result}")
            if initial.get("commandCount") != 4 or any(h < 43.5 or h > 68 for h in initial.get("commandHeights", [])):
                raise RuntimeError(f"COMMAND module cards are not compact/touch-safe: {result}")
            if initial.get("modeCount") != 2 or initial.get("indexes") != 2 or any(h < 43.5 or h > 58 for h in initial.get("modeHeights", [])):
                raise RuntimeError(f"Inventory mode controls are not unified/touch-safe: {result}")
            if not initial.get("toolbar") or not initial.get("separateContext"):
                raise RuntimeError(f"Inventory toolbar / scrolling context is misplaced: {result}")
            if initial.get("modePosition") == "sticky" or initial.get("shellBackground") in {"rgba(0, 0, 0, 0)", "transparent"}:
                raise RuntimeError(f"COMMAND stack can expose background content: {result}")
            if initial.get("allVisible") or not initial.get("allHidden"):
                raise RuntimeError(f"ALL AREAS remains visible: {result}")
            if initial.get("alertCount", 0) <= 0 and initial.get("alertVisible"):
                raise RuntimeError(f"Empty COMMAND ALERTS should be hidden: {result}")
            if initial.get("alertCount", 0) > 0 and (not initial.get("alertVisible") or initial.get("alertHeight", 9999) > 50 or initial.get("alertListVisible")):
                raise RuntimeError(f"Active COMMAND ALERTS are not compact/collapsed: {result}")
            if initial.get("attentionVisible"):
                raise RuntimeError(f"Duplicate attention control visible outside disclosure: {result}")
            if initial.get("alertCount", 0) > 0:
                if not result.get("detailsVisible") or not result.get("stableDisclosure") or not result.get("escapeClosed"):
                    raise RuntimeError(f"Alert disclosure / focus / refresh regressed: {result}")
                if result.get("attentionOn") != "attention" or result.get("attentionOff") != "all":
                    raise RuntimeError(f"NEEDS ATTENTION is not a reversible single toggle: {result}")
            if result.get("manifestState") != {"statusVisible": False, "manifestVisible": True, "active": True}:
                raise RuntimeError(f"FULL MANIFEST switch regressed: {result}")
            if result.get("statusState") != {"statusVisible": True, "manifestVisible": False, "active": True}:
                raise RuntimeError(f"STATUS BOARD switch regressed: {result}")
            if initial.get("overflow", 0) > 2:
                raise RuntimeError(f"Compact COMMAND layout has horizontal overflow: {result}")

            # Real CSS layout at phone, tablet and desktop sizes. A long Export
            # list must not stretch unrelated cards; all categories stay reachable.
            base.ev(cdp, """(()=>{
              document.querySelector('.uplink-details')?.removeAttribute('open');
              const names=['Basic Alloy','Consumer Goods','Food Rations'];
              maintenanceList.innerHTML=names.map(name=>renderOverviewRow({state:'ok',role:'maintenance',name,quantityValue:123456,detail:'FACILITY STABLE'})).join('');
              exportList.innerHTML=Array.from({length:5},(_,i)=>renderOverviewRow({state:'ok',role:'export',name:'Export component '+i,quantityValue:23456,detail:'EXPORT READY'})).join('');
              feedstockList.innerHTML=names.map(name=>renderOverviewRow({state:'low',role:'procurement',name,quantityValue:1000,detail:'4 CYCLES AVAILABLE'})).join('');
              return true;
            })()""")
            for width in [360, 390, 430, 820, 1024, 1366, 1920]:
                cdp.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':900,'deviceScaleFactor':1,'mobile':width<760})
                base.ev(cdp, "(()=>{scrollTo({top:0,behavior:'instant'});return true;})()")
                time.sleep(.12)
                geometry=base.ev(cdp, """(()=>{
                  const r=el=>{const x=el.getBoundingClientRect();return{top:x.top,bottom:x.bottom,left:x.left,right:x.right,height:x.height,width:x.width}};
                  const cards=[...document.querySelectorAll('#inventoryStatusPanel .alert-card')];
                  return{overflow:document.documentElement.scrollWidth-innerWidth,cards:cards.map(r),
                    rows:cards.map(c=>c.querySelector('ul')?.id),
                    scrollDeck:document.querySelector('.summary-grid').scrollWidth-document.querySelector('.summary-grid').clientWidth,
                    navHeight:r(rhwAppNav).height,toolbar:r(commandControlDeck),contextBottom:r(appSecondaryNav).bottom,
                    quantity:parseFloat(getComputedStyle(document.querySelector('.overview-row-qty')).fontSize),
                    kpi:parseFloat(getComputedStyle(document.querySelector('.base-telemetry-stat strong')).fontSize)};
                })()""")
                if geometry['overflow']>2 or geometry['scrollDeck']>2 or len(geometry['cards'])!=5:
                    raise RuntimeError(f'Inventory overflow at {width}px: {geometry}')
                if geometry['rows']!=['maintenanceList','exportList','feedstockList','byproductList','confiscatedList']:
                    raise RuntimeError(f'Inventory reading order at {width}px: {geometry}')
                cards=geometry['cards']
                if width>=1200:
                    if max(c['top'] for c in cards[:3])-min(c['top'] for c in cards[:3])>2 or cards[0]['height']>=cards[1]['height'] or cards[3]['top']<max(c['bottom'] for c in cards[:3])-2:
                        raise RuntimeError(f'Inventory row sizing at {width}px: {geometry}')
                    if cards[0]['top']>455 or geometry['quantity']<19 or geometry['kpi']<20:
                        raise RuntimeError(f'Desktop HUD density at {width}px: {geometry}')
                if width<760 and any(cards[i+1]['top']<cards[i]['bottom']-2 for i in range(4)):
                    raise RuntimeError(f'Mobile card order at {width}px: {geometry}')
                base.ev(cdp, "(()=>{scrollTo({top:700,behavior:'instant'});return true;})()")
                time.sleep(.15)
                sticky=base.ev(cdp, """(()=>{const r=rhwAppNav.getBoundingClientRect();return{top:r.top,height:r.height,
                  context:appSecondaryNav.getBoundingClientRect().bottom,offset:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rhw-sticky-nav-offset')),
                  scrollY:scrollY,toolsInside:rhwAppNav.contains(rhwFocusToolsBtn)}})()""")
                if sticky['height']>54 or sticky['toolsInside'] or abs(sticky['offset']-sticky['height']-12)>2 or (sticky['scrollY']>400 and abs(sticky['top'])>2) or abs(sticky['context']+sticky['scrollY']-geometry['contextBottom'])>2:
                    raise RuntimeError(f'Primary-only sticky navigation at {width}px: {sticky}')
                print(f'HUD {width}px: cards start at {cards[0]["top"]:.0f}px; sticky navigation {sticky["height"]:.0f}px')

            runtime_failures = [
                failure for failure in cdp.take_runtime_failures()
                if not ("TypeError: Failed to fetch" in failure and "fetchWithTimeout" in failure)
            ]
            if runtime_failures:
                raise RuntimeError(f"Browser console/runtime errors: {runtime_failures}")

            print("RHW compact COMMAND smoke passed: toolbar, alerts, keyboard focus, card sizing and primary-only sticky navigation at 7 widths")
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
