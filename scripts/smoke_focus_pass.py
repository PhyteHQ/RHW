#!/usr/bin/env python3
"""RHW focused-navigation smoke: COMMAND, CALCULATOR, PRICE CHECK and FORUM."""
from __future__ import annotations

import base64
import json
import time

import smoke_v40 as harness
import smoke_v40_base as base
import smoke_workflows  # noqa: F401  # installs the production CSS/JS matrix


VISIBLE_HELPER = """const visible=element=>{if(!element)return false;const style=getComputedStyle(element),rect=element.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!=='0'&&rect.width>0&&rect.height>0};"""


def settle(seconds: float = .12) -> None:
    time.sleep(seconds)


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
            # The fixture inlines CSS/JS and blocks network requests. Inline the
            # real crest too, so its geometry is tested instead of the fallback.
            crest_data = base64.b64encode((base.ROOT / "assets/rhw-crest.png").read_bytes()).decode("ascii")
            document = base.document("command/inventory").replace(
                'src="./assets/rhw-crest.png"', f'src="data:image/png;base64,{crest_data}"', 1,
            )
            cdp.call("Page.setDocumentContent", {
                "frameId": page["id"],
                "html": document,
            })

            end = time.time() + 9
            snap = {}
            while time.time() < end:
                snap = base.snapshot(cdp)
                if snap.get("ready") in {"true", "false"}:
                    break
                time.sleep(.1)
            if snap.get("ready") != "true" or snap.get("errors"):
                raise RuntimeError(f"Focused route did not boot: {snap}")

            settle(.3)
            primary = base.ev(cdp, f"""(()=>{{
              {VISIBLE_HELPER}
              const title=workspace=>{{
                const button=document.querySelector(`.app-tabs [data-workspace="${{workspace}}"]`);
                const spans=[...(button?.children||[])].filter(x=>x.tagName==='SPAN'&&!x.classList.contains('rhw-workspace-index'));
                return (spans[0]||button?.querySelector('span'))?.textContent?.trim()||'';
              }};
              return{{
                labels:['command','operations','pricecheck','comms'].map(title),
                count:document.querySelectorAll('.app-tabs [data-workspace]').length,
                priceApi:!!RHWV4.pricecheck,
                priceFailures:RHWV4.pricecheck?.selfTest?.()||[],
                toolButton:visible(document.getElementById('rhwFocusToolsBtn')),
                overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth
              }};
            }})()""")
            if primary.get("labels") != ["RHW", "CALCULATOR", "PRICE CHECK", "FORUM"] or primary.get("count") != 4:
                raise RuntimeError(f"Primary navigation failed: {primary}")
            if not primary.get("priceApi") or primary.get("priceFailures") or not primary.get("toolButton") or primary.get("overflow", 0) > 2:
                raise RuntimeError(f"Price Check shell failed: {primary}")

            # Supply the NPC feed independently of the old fixed source list.
            base.ev(cdp, """(()=>{
              document.querySelector('.app-tabs [data-workspace="pricecheck"]').click();
              const good=(id,name,price)=>({nickname:`commodity_${id}`,name,base_sells:true,price_base_sells_for:price});
              const station=(nickname,name,system_name,market_goods)=>({nickname,name,system_name,market_goods});
              window.__priceCheckFixture=[
                station('br01_06_base','Thames Outpost','New London',[good('hydrocarbons','Hydrocarbons',80),good('uranium','Uranium',95),good('mox_fuel','MOX',17)]),
                station('br01_02_base','Portsmouth Shipyard','Cambridge',[good('ship_hull_panels','Hull Panels',120)]),
                station('br01_01_base','Planet New London','New London',[good('industrial','Industrial Materials',100),good('food','Food Rations',70),good('consumer_goods','Consumer Goods',90)])
              ];
              window.findCommodity=name=>({name,missing:false,sell_price:100});
              window.telemetrySnapshot=()=>({available:true,stale:false,fetchedAt:new Date().toISOString(),label:'LIVE STOCK'});
              RHWV4.pricecheck.snapshotRoutes(window.__priceCheckFixture);RHWV4.pricecheck.render();
              return true;
            })()""")
            settle(.2)
            price = base.ev(cdp, f"""(()=>{{{VISIBLE_HELPER}return{{
              workspace:document.body.dataset.workspace,
              hash:location.hash,
              panel:visible(document.getElementById('workspacePricecheck')),
              rows:document.querySelectorAll('#priceCheckRows .pricecheck-row').length,
              routeCount:RHWV4.pricecheck.routes.length,
              context:visible(document.getElementById('appContextNavSlot')),
              buildQueue:!!document.querySelector('#rhwFocusToolsPanel [data-rhw-tool="build-queue"]'),
              active:document.getElementById('appActiveNode')?.textContent||''
            }};}})()""")
            if price.get("workspace") != "pricecheck" or price.get("hash") != "#pricecheck/routes" or not price.get("panel"):
                raise RuntimeError(f"Price Check route failed: {price}")
            if price.get("rows") != 4 or price.get("routeCount") != 4 or price.get("context") or price.get("buildQueue") or "NPC MARKET" not in price.get("active", ""):
                raise RuntimeError(f"Price Check scope/UI failed: {price}")

            # Price signs and archived overrides must follow the actual offer.
            math_state = base.ev(cdp, """(()=>{
              const api=RHWV4.pricecheck;
              api.state.overrides.hydrocarbons=150;api.render();
              const cell=key=>document.querySelector(`[data-route-key="${key}"] .pricecheck-difference`);
              const read=key=>({tone:cell(key).className,text:cell(key).querySelector('strong').textContent});
              const hydro=document.querySelector('[data-route-key="br01_06_base/commodity_hydrocarbons"]');
              return{positive:read('br01_06_base/commodity_hydrocarbons'),negative:read('br01_02_base/commodity_ship_hull_panels'),
                neutral:read('br01_01_base/commodity_industrial'),
                editors:document.querySelectorAll('#priceCheckRows input,#priceCheckRows [data-pricecheck-reset]').length,
                price:hydro.querySelector('.pricecheck-source-price').textContent};
            })()""")
            for tone, value in (('positive', '+$20'), ('negative', '-$20'), ('neutral', '$0')):
                if tone not in math_state[tone]['tone'] or math_state[tone]['text'] != value:
                    raise RuntimeError(f"Price Check sign colors failed: {math_state}")
            if math_state['editors'] or math_state['price'] != '$80':
                raise RuntimeError(f"Price Check automatic NPC pricing failed: {math_state}")

            search = base.ev(cdp, """(()=>{
              const api=RHWV4.pricecheck, fixture=window.__priceCheckFixture;
              const filter=value=>{priceCheckSearch.value=value;priceCheckSearch.dispatchEvent(new Event('input',{bubbles:true}));};
              const count=()=>priceCheckRows.querySelectorAll('.pricecheck-row').length;
              filter('uranium thames');const uranium=count();
              filter('cambridge');const system=count();
              filter('mox');const excluded=count()===0 && priceCheckResultCount.textContent.includes('No offers match');
              const markets=Array.from({length:26},(_,i)=>({nickname:`extra-${i}`,name:`Market ${i}`,
                market_goods:[{nickname:'commodity_npc_trade',name:'Test Trade Good',base_sells:true,price_base_sells_for:120}]}));
              api.snapshotRoutes([...fixture,...markets]);filter('');const first=count();
              priceCheckNext.click();const second=count(), last=priceCheckNext.disabled;
              filter('market 25');const found=count(), noPages=priceCheckPageNav.hidden;
              api.snapshotRoutes(fixture);filter('');
              return {uranium,system,excluded,first,second,last,found,noPages};
            })()""")
            if search != {'uranium': 1, 'system': 1, 'excluded': True, 'first': 24, 'second': 6, 'last': True, 'found': 1, 'noPages': True}:
                raise RuntimeError(f"Price Check search and pagination failed: {search}")

            # TOOLS is now genuinely secondary and no longer exposes the obsolete
            # Production Orders / Build Queue or Newswire entries.
            base.ev(cdp, "(()=>{RHWV4.toolsNavigation.openTools();return true;})()")
            settle(.06)
            tools = base.ev(cdp, f"""(()=>{{
              {VISIBLE_HELPER}
              const panel=document.getElementById('rhwFocusToolsPanel');
              const cards=[...panel.querySelectorAll('[data-rhw-tool]')];
              const focusable=[...panel.querySelectorAll('button')].filter(visible);
              const first=focusable[0],last=focusable[focusable.length-1];
              last?.focus();last?.dispatchEvent(new KeyboardEvent('keydown',{{key:'Tab',bubbles:true,cancelable:true}}));
              const forward=document.activeElement===first;
              first?.focus();first?.dispatchEvent(new KeyboardEvent('keydown',{{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}}));
              const back=document.activeElement===last;
              return{{open:visible(panel),count:cards.length,keys:cards.map(x=>x.dataset.rhwTool),trap:forward&&back}};
            }})()""")
            if not tools.get("open") or tools.get("keys") != ["backup", "senders", "system"] or not tools.get("trap"):
                raise RuntimeError(f"TOOLS cleanup/focus failed: {tools}")
            base.ev(cdp, "(()=>{RHWV4.toolsNavigation.closeTools();return true;})()")

            # The other three daily destinations must remain clean and reachable.
            for workspace, expected, panel_selector in [
                ("command", "command", '[data-command-panel="inventory"]'),
                ("operations", "operations", '[data-operations-panel="calculator"]'),
                ("comms", "comms", '[data-comms-panel="forum"]'),
            ]:
                base.ev(cdp, f"(()=>{{document.querySelector('.app-tabs [data-workspace=\"{workspace}\"]')?.click();return true;}})()")
                settle(.1)
                result = base.ev(cdp, f"""(()=>{{{VISIBLE_HELPER}return{{workspace:document.body.dataset.workspace,panel:visible(document.querySelector('{panel_selector}'))}};}})()""")
                if result.get("workspace") != expected or not result.get("panel"):
                    raise RuntimeError(f"Daily destination failed: {workspace}: {result}")

            # Four primary tabs must still fit common phone widths and remain
            # touch-ready. PRICE CHECK cards must not introduce horizontal scroll.
            # Tool routes use the compact masthead at every viewport width.
            for width in [360, 390, 412, 430, 1366]:
                cdp.call("Emulation.setDeviceMetricsOverride", {"width": width, "height": 900, "deviceScaleFactor": 1, "mobile": width < 760})
                base.ev(cdp, "(()=>{document.querySelector('.app-tabs [data-workspace=\"pricecheck\"]')?.click();return true;})()")
                settle(.08)
                geometry = base.ev(cdp, f"""(()=>{{{VISIBLE_HELPER}
                  const tabs=[...document.querySelectorAll(innerWidth<=1100?'#commandNodeNav [data-command-node]':'.app-tabs [data-workspace]')].filter(visible);
                  return{{overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth,
                    tabs:tabs.length,touch:tabs.map(x=>x.getBoundingClientRect().height),
                    crestHeight:document.querySelector('.command-header .crest')?.getBoundingClientRect().height||0,
                    mastheadHeight:document.querySelector('.command-header-inner')?.getBoundingClientRect().height||0,
                    rowCount:document.querySelectorAll('#priceCheckRows .pricecheck-row').length}};
                }})()""")
                if geometry.get("overflow", 0) > 2 or geometry.get("tabs") != 4 or geometry.get("rowCount") != price["routeCount"]:
                    raise RuntimeError(f"Price Check geometry at {width}px failed: {geometry}")
                if width < 760 and any(height < 43.5 for height in geometry.get("touch", [])):
                    raise RuntimeError(f"Primary touch targets at {width}px failed: {geometry}")
                if not 44 <= geometry.get("crestHeight", 0) <= 54 or geometry.get("mastheadHeight", 0) > 120:
                    raise RuntimeError(f"Compact RHW masthead at {width}px failed: {geometry}")

            runtime_failures = [
                failure for failure in cdp.take_runtime_failures()
                if not ("Failed to fetch" in failure or "ERR_BLOCKED_BY_CLIENT" in failure)
            ]
            if runtime_failures:
                raise RuntimeError(f"Runtime failures: {runtime_failures}")

            print("Focus Pass + Price Check smoke passed: 4 daily tabs, NPC offer search, automatic pricing, archived overrides and mobile fit")
            return 0
        finally:
            try:
                cdp.call("Emulation.clearDeviceMetricsOverride")
            except Exception:
                pass
            cdp.close()
    except Exception as exc:
        print(f"ERROR: {exc}")
        return 1
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
