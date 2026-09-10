#!/usr/bin/env python3
"""Focused browser smoke for final V4 recipe correctness semantics."""
from __future__ import annotations

import json
import shutil
import sys
import time

import smoke_v40 as base

CORRECTION = "js/18c-app-v40-recipe-corrections.js"
if CORRECTION not in base.V4_JS:
    index = base.V4_JS.index("js/18b-app-v40-production-pricing.js") + 1
    base.V4_JS.insert(index, CORRECTION)


def main() -> int:
    try:
        chrome, browser, port, folder, _log_path = base.launch()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(f"V4 recipe smoke browser: {browser}")
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
                raise RuntimeError(f"Recipe correction route boot failed: {snap}")
            if snap.get("recipes") != base.CATALOG_COUNTS["recipeCount"] or snap.get("products") != base.CATALOG_COUNTS["productCount"]:
                raise RuntimeError(f"Corrected catalog counts unexpected: {snap}")

            base.ev(cdp, """(()=>{
              const search=document.getElementById('opsRecipeSearch');
              search.value='Gold refining'; search.dispatchEvent(new Event('input',{bubbles:true}));
              return true;
            })()""")
            time.sleep(.2)
            base.ev(cdp, """(()=>{
              const price=document.querySelector('[data-material-price="commodity_gold_ore"]');
              price.value='123'; price.dispatchEvent(new Event('input',{bubbles:true}));
              const iff=document.getElementById('opsAffiliation'); iff.value='__none__';
              iff.dispatchEvent(new Event('change',{bubbles:true})); return true;
            })()""")
            time.sleep(.1)
            base.ev(cdp, """(()=>{
              const search=document.getElementById('opsRecipeSearch');
              search.value='Gold refinin'; search.dispatchEvent(new Event('input',{bubbles:true})); return true;
            })()""")
            time.sleep(.2)
            preserved=base.ev(cdp, """(()=>({
              recipe:document.getElementById('opsRecipe').value,
              price:document.querySelector('[data-material-price="commodity_gold_ore"]').value,
              iff:document.getElementById('opsAffiliation').value,
              firstGold:RHWV4.operations.matchingRecipes('Gold')[0].outputs[0].id,
              order:!!document.getElementById('opsAddProductionOrder')
            }))()""")
            if preserved.get('recipe') != 'recipe_gold_advanced' or preserved.get('price') != '123' or preserved.get('iff') != '__none__' or preserved.get('firstGold') != 'commodity_gold' or preserved.get('order'):
                raise RuntimeError(f"Calculator search/session regression: {preserved}")
            heading=base.ev(cdp, """(()=>{
              const before=document.querySelector('#baseHealthCard small').textContent;
              RHWV4.navigate('comms','ticker'); RHWV4.newswireManager.enhance();
              RHWV4.navigate('operations','calculator');
              return {before,after:document.querySelector('#baseHealthCard small').textContent};
            })()""")
            if heading.get('before') != heading.get('after'):
                raise RuntimeError(f"Newswire changed global telemetry labels: {heading}")

            catalog = base.ev(cdp, """(()=>({
              deprecated:[!!RHWV4.operationsCore.recipe('module_m_hyperspace_scanner'),!!RHWV4.operationsCore.recipe('module_m_cloakdisruptor')],
              goldTargets:RHWV4.operationsCore.recipesFor('commodity_gold').map(r=>r.id),
              wildcatTargets:RHWV4.operationsCore.recipesFor('commodity_pirate_gold').map(r=>r.id),
              diamondTargets:RHWV4.operationsCore.recipesFor('commodity_diamonds').map(r=>r.id),
              hessianTargets:RHWV4.operationsCore.recipesFor('commodity_bluediamonds').map(r=>r.id),
              fee:RHWV4.operationsCore.recipe('module_coreupgrade')?.creditCost||0,
              self:RHWV4.recipeCorrections?.selfTest?.()||['missing-correction']
            }))()""")
            if any(catalog.get("deprecated", [])) or catalog.get("fee") != 2500000 or catalog.get("self"):
                raise RuntimeError(f"Recipe catalog correction failed: {catalog}")
            for key in ("goldTargets", "wildcatTargets"):
                if "recipe_gold_basic" not in catalog.get(key, []):
                    raise RuntimeError(f"Gold affiliation target index missing: {catalog}")
            for key in ("diamondTargets", "hessianTargets"):
                if "recipe_diamonds_basic" not in catalog.get(key, []):
                    raise RuntimeError(f"Diamond affiliation target index missing: {catalog}")

            outputs = base.ev(cdp, """(()=>{
              const c=RHWV4.operationsCore;
              const plan=(recipeId,productId,affiliationId)=>c.buildPlan({recipeId,productId,quantity:1,affiliationId,useInventory:false,recursive:false,routingPolicy:'first'});
              const goldBmm=plan('recipe_gold_basic','commodity_gold','br_m_grp');
              const goldNone=plan('recipe_gold_basic','commodity_pirate_gold','__none__');
              const diamondBmm=plan('recipe_diamonds_basic','commodity_diamonds','br_m_grp');
              const diamondHessian=plan('recipe_diamonds_basic','commodity_bluediamonds','fc_rh_grp');
              return{
                goldBmm:goldBmm.product.id,goldNone:goldNone.product.id,
                diamondBmm:diamondBmm.product.id,diamondHessian:diamondHessian.product.id,
                goldByproducts:goldBmm.byproducts.map(x=>[x.id,x.qty])
              };
            })()""")
            if outputs.get("goldBmm") != "commodity_gold" or outputs.get("goldNone") != "commodity_pirate_gold" or outputs.get("diamondBmm") != "commodity_diamonds" or outputs.get("diamondHessian") != "commodity_bluediamonds":
                raise RuntimeError(f"IFF-dependent recipe output failed: {outputs}")
            if ["commodity_toxic_waste", 150] not in outputs.get("goldByproducts", []):
                raise RuntimeError(f"Gold toxic-waste byproduct missing: {outputs}")

            base.ev(cdp, """(()=>{
              opsRecipeSearch.value='Core Upgrade';
              opsRecipeSearch.dispatchEvent(new Event('input',{bubbles:true}));
              return{};
            })()""")
            time.sleep(.45)
            base.ev(cdp, """(()=>{
              document.querySelectorAll('[data-material-price]').forEach(input=>{
                input.value='0';input.dispatchEvent(new Event('input',{bubbles:true}));
              });
              return{};
            })()""")
            time.sleep(.15)
            fee_ui = base.ev(cdp, """(()=>({
              recipe:opsRecipe?.selectedOptions?.[0]?.textContent||'',
              fee:document.querySelector('.ops-recipe-fee')?.textContent||'',
              total:opsTotalCost?.textContent||'',unit:opsUnitCost?.textContent||'',
              warning:opsPricingWarning?.textContent||''
            }))()""")
            if "core upgrade" not in fee_ui.get("recipe", "").lower() or "$2,500,000" not in fee_ui.get("fee", "") or "$2,500,000" not in fee_ui.get("total", "") or "FEE INCLUDED" not in fee_ui.get("warning", ""):
                raise RuntimeError(f"Core Upgrade fixed recipe fee UI failed: {fee_ui}")

            print("V4 interaction smoke passed: deprecated recipes + IFF outputs + Core Upgrade fee")
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
