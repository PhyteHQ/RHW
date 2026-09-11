#!/usr/bin/env python3
"""Focused browser smoke for V4.0.2 recipe labels, costing semantics and header clock layout."""
from __future__ import annotations

import json
import re
import shutil
import time

import smoke_v40 as base
import smoke_v402  # noqa: F401  # use the deployed desktop and mobile asset order

base._ensure_app_layer_assets()

ORDERING = "js/16c-app-v40-newswire-ordering.js"
CORRECTION = "js/18c-app-v40-recipe-corrections.js"
POLISH = "js/18d-app-v40-final-ui-polish.js"

if ORDERING not in base.V4_JS:
    base.V4_JS.insert(base.V4_JS.index("js/16b-app-v40-newswire-manager.js") + 1, ORDERING)
if CORRECTION not in base.V4_JS:
    base.V4_JS.insert(base.V4_JS.index("js/18b-app-v40-production-pricing.js") + 1, CORRECTION)
if POLISH not in base.V4_JS:
    base.V4_JS.insert(base.V4_JS.index(CORRECTION) + 1, POLISH)


def number_from_money(value: str) -> int:
    digits = re.sub(r"[^0-9]", "", value or "")
    return int(digits) if digits else 0


def main() -> int:
    chrome, browser, port, folder, _log = base.launch()
    print(f"V4.0.2 final-polish smoke browser: {browser}")
    try:
        targets = json.loads(base.get(f"http://127.0.0.1:{port}/json/list", 3))
        page = next(item for item in targets if item.get("type") == "page")
        cdp = base.CDP(page["webSocketDebuggerUrl"])
        try:
            for method in ("Page.enable", "Runtime.enable", "Network.enable"):
                cdp.call(method)
            cdp.call("Network.setBlockedURLs", {"urls": ["https://*", "http://*"]})
            cdp.call("Page.navigate", {"url": "about:blank"})
            cdp.call("Page.setDocumentContent", {"frameId": page["id"], "html": base.document("operations/calculator")})

            end = time.time() + 8
            snap = {}
            while time.time() < end:
                snap = base.snapshot(cdp)
                if snap.get("ready") in {"true", "false"}:
                    break
                time.sleep(.1)
            if snap.get("ready") != "true" or snap.get("error") == "true" or snap.get("errors"):
                raise RuntimeError(f"V4.0.2 polish route boot failed: {snap}")
            if snap.get("recipes") != base.CATALOG_COUNTS["recipeCount"] or snap.get("products") != base.CATALOG_COUNTS["productCount"]:
                raise RuntimeError(f"Corrected catalog missing in V4.0.2 route: {snap}")

            labels = base.ev(cdp, """(()=>{
              const recipes=RHWV4.operationsCore.state.catalog?.recipes||[];
              const gold=recipes.filter(r=>r.id.startsWith('recipe_gold_')).map(r=>[r.id,RHWV4.finalUiPolish.recipeLabel(r)]);
              const diamonds=recipes.filter(r=>r.id.startsWith('recipe_diamonds_')).map(r=>[r.id,RHWV4.finalUiPolish.recipeLabel(r)]);
              return{
                duplicates:RHWV4.finalUiPolish?.duplicateFinalLabels?.()||[['missing-polish',['missing']]],
                self:RHWV4.finalUiPolish?.selfTest?.()||['missing-polish'],
                gold,diamonds,
                header:[...document.querySelector('.uplink-grid').children].filter(x=>x.classList.contains('uplink-stat')).map(x=>x.querySelector('small')?.textContent?.trim()||'')
              };
            })()""")
            if labels.get("duplicates") or labels.get("self"):
                raise RuntimeError(f"Duplicate/final label self-test failed: {labels}")

            gold = labels.get("gold", [])
            gold_text = [text for _id, text in gold]
            if len(gold) < 4 or len({text.lower() for text in gold_text}) != len(gold_text):
                raise RuntimeError(f"Gold recipes are not all distinct: {gold}")
            expected_tokens = ("basic", "advanced", "bulk")
            if any(not any(token in text.lower() for text in gold_text) for token in expected_tokens):
                raise RuntimeError(f"Gold recipe variants are not meaningful: {gold}")
            if not any(("reprocess" in text.lower() or "conversion" in text.lower()) for text in gold_text):
                raise RuntimeError(f"Gold conversion/reprocessing label missing: {gold}")

            diamonds = labels.get("diamonds", [])
            diamond_text = [text for _id, text in diamonds]
            if len(diamonds) > 1 and len({text.lower() for text in diamond_text}) != len(diamond_text):
                raise RuntimeError(f"Diamond recipes are not distinct: {diamonds}")

            if labels.get("header", [])[:4] != ["SYSTEM CLOCK", "LATEST SYNC", "NEXT SYNC", "REFRESH CYCLE"]:
                raise RuntimeError(f"Header clock must be top-left: {labels.get('header')}")

            base.ev(cdp, """(()=>{
              opsRecipeSearch.value='gold';
              opsRecipeSearch.dispatchEvent(new Event('input',{bubbles:true}));
              return{};
            })()""")
            time.sleep(.5)
            option_data = base.ev(cdp, """(()=>({
              labels:[...opsRecipe.options].filter(o=>o.value.startsWith('recipe_gold_')).map(o=>[o.value,o.textContent]),
              all:[...opsRecipe.options].map(o=>[o.value,o.textContent])
            }))()""")
            gold_options = option_data.get("labels", [])
            if len(gold_options) < 4 or len({text.lower() for _, text in gold_options}) != len(gold_options):
                raise RuntimeError(f"Rendered Gold dropdown labels are not unique: {option_data}")

            basic_id = next((rid for rid, text in gold_options if "basic" in text.lower()), gold_options[0][0])
            base.ev(cdp, f"""(()=>{{
              opsRecipeSearch.value={json.dumps(basic_id)};
              opsRecipeSearch.dispatchEvent(new Event('input',{{bubbles:true}}));
              return{{}};
            }})()""")
            time.sleep(.45)
            selected = base.ev(cdp, "(()=>({id:opsRecipe?.value||'',label:opsRecipe?.selectedOptions?.[0]?.textContent||''}))()")
            if selected.get("id") != basic_id and "basic" not in selected.get("label", "").lower():
                raise RuntimeError(f"Could not select a Gold basic batch recipe: {selected}, expected {basic_id}")

            base.ev(cdp, """(()=>{
              document.querySelectorAll('[data-material-price]').forEach(input=>{
                input.value='100';input.dispatchEvent(new Event('input',{bubbles:true}));
              });
              opsMargin.value='20';opsMargin.dispatchEvent(new Event('input',{bubbles:true}));
              return{};
            })()""")
            time.sleep(.2)
            costing = base.ev(cdp, """(()=>({
              card:document.querySelector('.ops-flow-cost')?.textContent||'',
              margin:document.querySelector('.ops-flow-margin')?.textContent||'',
              sellCard:document.querySelector('.ops-flow-sell')?.textContent||'',
              batch:opsTotalCost?.textContent||'',unit:opsUnitCost?.textContent||'',sell:opsSellUnit?.textContent||'',
              unitIsPrimary:!!document.querySelector('.ops-flow-cost > strong#opsUnitCost'),
              batchIsSecondary:!!document.querySelector('.ops-flow-cost > div b#opsTotalCost'),
              actual:[...document.querySelectorAll('.ops-recipe-meta>div')].find(x=>x.querySelector('small')?.textContent==='ACTUAL OUTPUT')?.querySelector('strong')?.textContent||'0'
            }))()""")
            batch = number_from_money(costing.get("batch", ""))
            unit = number_from_money(costing.get("unit", ""))
            sell = number_from_money(costing.get("sell", ""))
            actual = int(re.sub(r"[^0-9]", "", costing.get("actual", "")) or "0")
            if not costing.get("unitIsPrimary") or not costing.get("batchIsSecondary"):
                raise RuntimeError(f"Unit/batch visual hierarchy is wrong: {costing}")
            if "COST / UNIT" not in costing.get("card", "") or "TOTAL BATCH COST" not in costing.get("card", ""):
                raise RuntimeError(f"Unit/batch costing labels missing: {costing}")
            if "PER UNIT" not in costing.get("margin", "") or "/ UNIT" not in costing.get("sellCard", ""):
                raise RuntimeError(f"Margin/sell unit semantics are unclear: {costing}")
            if actual <= 1 or batch <= unit or unit <= 0 or sell <= unit:
                raise RuntimeError(f"Batch/unit costing semantics failed: {costing}")
            expected_unit = batch / actual
            if abs(unit - expected_unit) > 1.1:
                raise RuntimeError(f"Unit cost does not reconcile with batch cost: {costing}, expected≈{expected_unit:.2f}")

            # Exercise the real shared-price comparison controls. This runs in
            # GitHub CI using the existing synthetic telemetry browser harness.
            base.ev(cdp, """(()=>{
              opsRecipeSearch.value='recipe_niobium_basic';
              opsRecipeSearch.dispatchEvent(new Event('input',{bubbles:true}));return true;
            })()""")
            time.sleep(.3)
            base.ev(cdp, """(()=>{
              opsQuantity.value='801';opsQuantity.dispatchEvent(new Event('change',{bubbles:true}));return true;
            })()""")
            time.sleep(.15)
            base.ev(cdp, "(()=>{opsCompareToggle.click();return true;})()")
            time.sleep(.15)
            state = base.ev(cdp, """(()=>{
              const prices={commodity_niobium_ore:0,commodity_mox_fuel:100,commodity_industrial:20,commodity_mining_machinery:30};
              const inputs=[...document.querySelectorAll('[data-material-price]')];
              inputs.forEach(input=>{input.value=String(prices[input.dataset.materialPrice]);input.dispatchEvent(new Event('input',{bubbles:true}));});
              return {inputs:inputs.map(x=>x.dataset.materialPrice),count:document.querySelectorAll('[data-comparison-recipe]').length,
                best:document.querySelector('.ops-comparison-best')?.dataset.comparisonRecipe,
                unit:document.querySelector('[data-comparison-recipe="recipe_niobium_advanced"] .ops-comparison-unit')?.textContent,
                errors:window.__errors||[]};
            })()""")
            if len(state.get('inputs', [])) != 4 or len(set(state['inputs'])) != 4 or state.get('count') != 3:
                raise RuntimeError(f"Comparison input union/rows failed: {state}")
            if state.get('best') != 'recipe_niobium_advanced' or state.get('unit') != '$23.38' or state.get('errors'):
                raise RuntimeError(f"Comparison price input recalculation failed: {state}")

            for width in (360, 390, 430, 820, 1024, 1366, 1920):
                cdp.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':900,'deviceScaleFactor':1,'mobile':width<=430})
                time.sleep(.12)
                layout = base.ev(cdp, """(()=>{
                  const panel=document.getElementById('opsComparisonPanel');
                  const controls=[...panel.querySelectorAll('button,input')];
                  return {overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth,
                    panelWidth:panel.getBoundingClientRect().width,
                    small:controls.filter(x=>x.getBoundingClientRect().height<43).map(x=>x.outerHTML),
                    tableOverflow:panel.scrollWidth-panel.clientWidth};
                })()""")
                if layout.get('overflow',0)>2 or layout.get('tableOverflow',0)>2 or layout.get('small'):
                    raise RuntimeError(f"Comparison layout failed at {width}: {layout}")

            adopted = base.ev(cdp, """(()=>{
              document.querySelector('[data-use-variant="recipe_niobium_bulk"]').click();
              return {recipe:opsRecipe.value,iff:opsAffiliation.value,quantity:opsQuantity.value,
                prices:[...document.querySelectorAll('[data-material-price]')].map(x=>[x.dataset.materialPrice,x.value]),
                output:document.querySelector('[data-comparison-recipe="recipe_niobium_bulk"] td[data-label="OUTPUT"]')?.textContent};
            })()""")
            if adopted.get('recipe')!='recipe_niobium_bulk' or adopted.get('iff')!='br_m_grp' or adopted.get('quantity')!='801':
                raise RuntimeError(f"Adopting a variant lost shared context: {adopted}")
            if dict(adopted.get('prices',[]))!={'commodity_niobium_ore':'0','commodity_mox_fuel':'100','commodity_industrial':'20','commodity_mining_machinery':'30'}:
                raise RuntimeError(f"Adopting a variant lost prices: {adopted}")

            # The two destination types must work on a phone even when the
            # other Logistics tab was selected. Ores receive no buying prompt.
            cdp.call('Emulation.setDeviceMetricsOverride', {'width':390,'height':820,'deviceScaleFactor':1,'mobile':True})
            for material, view in [('Reactor Systems','market'),('Prototype Components','materials')]:
                base.ev(cdp, f"""(()=>{{
                  hasVerifiedTelemetry=()=>true;stockFor=()=>0;findCommodity=()=>null;
                  renderShipyardControl();renderProductionModules();
                  RHWV4.navigate('command',{json.dumps('shipyard' if view=='market' else 'production')});return true;
                }})()""")
                clicked = base.ev(cdp, f"""(()=>{{
                  const button=[...document.querySelectorAll('[data-purchase-source]')].find(x=>x.dataset.purchaseSource==={json.dumps(material)});
                  if(!button)return false;
                  const card=button.closest('.production-card-collapsed');card?.querySelector('.production-card-toggle')?.click();
                  button.click();return true;
                }})()""")
                if not clicked:
                    raise RuntimeError(f"Missing sourcing shortcut for {material}")
                time.sleep(1)
                destination = base.ev(cdp, """(()=>({
                  hash:location.hash,view:document.body.dataset.logisticsView,
                  focused:document.activeElement?.dataset.marketCommodity||document.activeElement?.id,
                  overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth,
                  oreButtons:[...document.querySelectorAll('[data-purchase-source]')].filter(x=>/ore/i.test(x.dataset.purchaseSource)).length
                }))()""")
                if destination.get('hash')!='#command/logistics' or destination.get('view')!=view or destination.get('oreButtons') or destination.get('overflow',0)>2:
                    raise RuntimeError(f"Sourcing destination failed: {destination}")
                expected_fallback = 'marketScanSection' if view=='market' else 'materialsScanSection'
                if destination.get('focused') not in [material.lower(), expected_fallback]:
                    raise RuntimeError(f"Sourcing focus missed {material}: {destination}")

            print("V4.0.2 interaction smoke passed: recipe variants, shared-price comparison, responsive layout, seller links and costing")
        finally:
            cdp.close()
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=3)
        except Exception:
            chrome.kill()
        shutil.rmtree(folder, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
