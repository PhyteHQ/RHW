#!/usr/bin/env python3
"""RHW focused-navigation smoke: COMMAND, CALCULATOR, PRICE CHECK and FORUM."""
from __future__ import annotations

import json
import time

import smoke_v40 as harness
import smoke_v40_base as base
import smoke_v402  # noqa: F401  # installs the production CSS/JS matrix

harness._ensure_app_layer_assets()

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
            cdp.call("Page.setDocumentContent", {
                "frameId": page["id"],
                "html": base.document("command/inventory"),
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
            if primary.get("labels") != ["COMMAND", "CALCULATOR", "PRICE CHECK", "FORUM"] or primary.get("count") != 4:
                raise RuntimeError(f"Primary navigation failed: {primary}")
            if not primary.get("priceApi") or primary.get("priceFailures") or not primary.get("toolButton") or primary.get("overflow", 0) > 2:
                raise RuntimeError(f"Price Check shell failed: {primary}")

            # PRICE CHECK is a first-class route and intentionally contains only
            # the 15 fixed NPC procurement routes supplied by RHW operations.
            base.ev(cdp, "(()=>{document.querySelector('.app-tabs [data-workspace=\"pricecheck\"]')?.click();return true;})()")
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
            if price.get("rows") != 15 or price.get("routeCount") != 15 or price.get("context") or price.get("buildQueue") or "PRICE CHECK" not in price.get("active", ""):
                raise RuntimeError(f"Price Check scope/UI failed: {price}")

            # Deterministic math test: positive is green, negative is red and zero
            # stays neutral. No margin tiers / yellow supplier rating are allowed.
            math_state = base.ev(cdp, """(()=>{
              const originalFind=window.findCommodity,originalPrice=window.priceSell;
              window.__priceCheckSmokeOriginal={originalFind,originalPrice};
              window.findCommodity=name=>({name,missing:false});
              window.priceSell=item=>100;
              const now=new Date().toISOString();
              RHWV4.pricecheck.state.marketCache={fetchedAt:now,routes:{
                'copper':{sourceName:'Copperland',system:'Coronado',livePrice:80,found:true,sold:true},
                'hull-panels':{sourceName:'Portsmouth Shipyard',system:'Cambridge',livePrice:120,found:true,sold:true},
                'industrial-materials':{sourceName:'Planet New London',system:'New London',livePrice:100,found:true,sold:true}
              }};
              RHWV4.pricecheck.state.marketLabel='SMOKE MARKET';
              RHWV4.pricecheck.render();
              const tone=key=>document.querySelector(`[data-route-key="${key}"] .pricecheck-difference`)?.className||'';
              const text=key=>document.querySelector(`[data-route-key="${key}"] .pricecheck-difference strong`)?.textContent||'';
              return{positive:tone('copper'),negative:tone('hull-panels'),neutral:tone('industrial-materials'),
                positiveText:text('copper'),negativeText:text('hull-panels'),neutralText:text('industrial-materials'),
                yellow:document.querySelectorAll('.pricecheck-difference.low,.pricecheck-difference.warn').length};
            })()""")
            if "positive" not in math_state.get("positive", "") or "negative" not in math_state.get("negative", "") or "neutral" not in math_state.get("neutral", ""):
                raise RuntimeError(f"Price Check sign colors failed: {math_state}")
            if math_state.get("positiveText") != "+$20" or math_state.get("negativeText") != "-$20" or math_state.get("neutralText") != "$0" or math_state.get("yellow") != 0:
                raise RuntimeError(f"Price Check math/tiers failed: {math_state}")

            # Manual source-price override must recalculate immediately and reset
            # cleanly back to the live Darkstat price.
            override = base.ev(cdp, """(()=>{
              const input=document.querySelector('[data-pricecheck-override="copper"]');
              input.value='150';input.dispatchEvent(new Event('input',{bubbles:true}));
              const after=document.querySelector('[data-route-key="copper"] .pricecheck-difference');
              const afterText=after?.querySelector('strong')?.textContent||'';
              document.querySelector('[data-pricecheck-reset="copper"]')?.click();
              const reset=document.querySelector('[data-route-key="copper"] .pricecheck-difference');
              return{after:after?.className||'',afterText,reset:reset?.className||'',resetText:reset?.querySelector('strong')?.textContent||'',saved:RHWV4.pricecheck.state.overrides.copper};
            })()""")
            if "negative" not in override.get("after", "") or override.get("afterText") != "-$50" or "positive" not in override.get("reset", "") or override.get("resetText") != "+$20" or override.get("saved") is not None:
                raise RuntimeError(f"Price Check manual override failed: {override}")

            # TOOLS is now genuinely secondary and no longer exposes the obsolete
            # Production Orders / Build Queue entry.
            base.ev(cdp, "(()=>{RHWV4.focusPass.openTools();return true;})()")
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
            if not tools.get("open") or tools.get("count") != 4 or "build-queue" in tools.get("keys", []) or not tools.get("trap"):
                raise RuntimeError(f"TOOLS cleanup/focus failed: {tools}")
            base.ev(cdp, "(()=>{RHWV4.focusPass.closeTools();return true;})()")

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
            for width in [360, 390, 412, 430, 1366]:
                cdp.call("Emulation.setDeviceMetricsOverride", {"width": width, "height": 900, "deviceScaleFactor": 1, "mobile": width < 760})
                base.ev(cdp, "(()=>{document.querySelector('.app-tabs [data-workspace=\"pricecheck\"]')?.click();return true;})()")
                settle(.08)
                geometry = base.ev(cdp, f"""(()=>{{{VISIBLE_HELPER}
                  const tabs=[...document.querySelectorAll('.app-tabs [data-workspace]')].filter(visible);
                  return{{overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth,
                    tabs:tabs.length,touch:tabs.map(x=>x.getBoundingClientRect().height),
                    rowCount:document.querySelectorAll('#priceCheckRows .pricecheck-row').length}};
                }})()""")
                if geometry.get("overflow", 0) > 2 or geometry.get("tabs") != 4 or geometry.get("rowCount") != 15:
                    raise RuntimeError(f"Price Check geometry at {width}px failed: {geometry}")
                if width < 760 and any(height < 43.5 for height in geometry.get("touch", [])):
                    raise RuntimeError(f"Primary touch targets at {width}px failed: {geometry}")

            runtime_failures = [
                failure for failure in cdp.take_runtime_failures()
                if not ("Failed to fetch" in failure or "ERR_BLOCKED_BY_CLIENT" in failure)
            ]
            if runtime_failures:
                raise RuntimeError(f"Runtime failures: {runtime_failures}")

            print("Focus Pass + Price Check smoke passed: 4 daily tabs, 15 fixed routes, sign-only colors, overrides, mobile fit")
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
