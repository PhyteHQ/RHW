#!/usr/bin/env python3
"""Headless-Chrome runtime + interaction smoke tests for RHW V4."""
from __future__ import annotations

import html, json, re, shutil, socket, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path

try:
    import websocket
except ImportError as exc:
    raise SystemExit("websocket-client is required for scripts/smoke_v40.py") from exc

ROOT = Path(__file__).resolve().parents[1]
from build_recipe_catalog import read_catalog
from sync_discovery_catalog import effective_counts
_COUNTS = effective_counts(read_catalog(ROOT / 'assets' / 'recipes'))
CATALOG_COUNTS = {'recipeCount': _COUNTS['recipes'], 'productCount': _COUNTS['products']}
ROUTES = [
    ("command","overview"),("command","inventory"),("command","shipyard"),("command","production"),("command","logistics"),
    ("operations","calculator"),("pricecheck","routes"),("comms","forum"),("comms","ticker"),("comms","drafts"),("comms","senders"),
]
V4_CSS = [
    "css/12-app-v40.css","css/13-app-v40-navigation.css","css/14-app-v40-composer.css","css/15-app-v40-audit.css",
    "css/16-app-v40-operations.css","css/17-app-v40-calculator-polish.css","css/18-app-v40-nav-hierarchy.css",
    "css/19-app-v402-fixes.css","css/20-app-v402-qol.css","css/21-app-v402-mobile-ui.css",
    "css/29-app-pr6-discovery-sync.css","css/30-app-pr7-diagnostics.css","css/31-app-pr8-production-orders.css",
    "css/32-app-pr9-transfer-center.css","css/33-app-pr10-newswire-review.css","css/34-app-pr11-full-audit.css", "css/35-app-interface-cleanup.css",
]
V4_JS = [
    "js/12-app-config.js","js/13-app-v40.js","js/14-app-v40-cache.js","js/15-app-v40-navigation.js",
    "js/16-app-v40-composer.js","js/16a-app-v40-comms-safety.js","js/16b-app-v40-newswire-manager.js",
    "js/16c-app-v40-newswire-ordering.js",
    *[f"assets/recipes/catalog-v1-part-{i:02d}.js" for i in range(1,7)],
    "js/17-app-v40-operations-core.js","js/18-app-v40-operations-ui.js","js/18a-app-v40-nav-hierarchy.js",
    "js/18b-app-v40-production-pricing.js","js/18c-app-v40-recipe-corrections.js",
    "js/18d-app-v40-final-ui-polish.js","js/20-app-v402-fixes.js","js/21-app-v402-qol.js",
    "js/22-app-v402-mobile-ui.js","js/23-app-v40-pwa.js","js/24-app-v40-newswire-2.js",
    "js/25-app-v40-discovery-status.js","js/26-app-v40-diagnostics.js","js/27-app-v40-production-orders.js",
    "js/28-app-v40-transfer-center.js","js/29-app-v40-newswire-review.js","js/30-app-v40-full-audit.js","js/19-app-v40-runtime.js",
]

def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1",0)); return sock.getsockname()[1]

def get(url, timeout=8):
    end=time.time()+timeout; last=None
    while time.time()<end:
        try:
            with urllib.request.urlopen(url,timeout=1) as r: return r.read()
        except Exception as exc:
            last=exc; time.sleep(.12)
    raise RuntimeError(f"Timed out waiting for {url}: {last}")

class CDP:
    def __init__(self,url):
        self.ws=websocket.create_connection(url,timeout=7); self.n=1; self.events=[]
    def call(self,method,params=None):
        ident=self.n; self.n+=1
        self.ws.send(json.dumps({"id":ident,"method":method,"params":params or {}}))
        end=time.time()+10
        while time.time()<end:
            msg=json.loads(self.ws.recv())
            if msg.get("id")==ident:
                if "error" in msg: raise RuntimeError(f"CDP {method}: {msg['error']}")
                return msg.get("result",{})
            self.events.append(msg)
        raise RuntimeError(f"CDP {method} timed out")
    def take_runtime_failures(self):
        events,self.events=self.events,[]
        failures=[]
        for event in events:
            method=event.get("method",""); params=event.get("params",{})
            if method=="Runtime.exceptionThrown":
                detail=params.get("exceptionDetails",{})
                failures.append(detail.get("text") or detail.get("exception",{}).get("description") or "Uncaught exception")
            elif method=="Runtime.consoleAPICalled" and params.get("type")=="error":
                values=[]
                for arg in params.get("args",[]):
                    values.append(str(arg.get("value") or arg.get("description") or "console.error"))
                failures.append(" ".join(values))
            elif method=="Log.entryAdded" and params.get("entry",{}).get("level")=="error" and params["entry"].get("source")=="javascript":
                failures.append(params["entry"].get("text") or "Browser JavaScript log error")
        return failures
    def close(self): self.ws.close()

def safe(text): return text.replace("</script","<\\/script")

def document(route):
    source=(ROOT/"index.html").read_text(encoding="utf-8")
    source=re.sub(r'\s*<link[^>]+href="https://[^>]+>\s*',"\n",source,flags=re.I)
    def css(match):
        href=match.group(1); path=ROOT/href.removeprefix("./")
        return f'<style>{path.read_text(encoding="utf-8")}</style>' if path.is_file() else match.group(0)
    def js(match):
        src=match.group(1); path=ROOT/src.removeprefix("./")
        return f'<script>{safe(path.read_text(encoding="utf-8"))}</script>' if path.is_file() else match.group(0)
    source=re.sub(r'<link\s+rel="stylesheet"\s+href="(\./css/[^"]+)"\s*>',css,source,flags=re.I)
    source=re.sub(r'<script\s+src="(\./js/[^"]+)"\s*></script>',js,source,flags=re.I)
    styles="\n".join(f"<style>{(ROOT/p).read_text(encoding='utf-8')}</style>" for p in V4_CSS)
    source=source.replace("</head>",f"{styles}<script>window.__RHW_SMOKE_INLINE__=true;history.replaceState(null,'','#{route}');</script></head>")
    scripts="\n".join(f"<script>{safe((ROOT/p).read_text(encoding='utf-8'))}</script>" for p in V4_JS)
    return source.replace("</body>",f"{scripts}</body>")

def ev(cdp,expression):
    result=cdp.call("Runtime.evaluate",{"expression":f"Promise.resolve({expression}).then(value=>JSON.stringify(value))","returnByValue":True,"awaitPromise":True})
    if result.get("exceptionDetails"):
        detail=result["exceptionDetails"]
        description=detail.get("exception",{}).get("description") or detail.get("text") or "Browser evaluation failed"
        raise RuntimeError(description)
    raw=result.get("result",{}).get("value"); return json.loads(raw) if raw else {}

def snapshot(cdp):
    return ev(cdp,"({ready:document.documentElement.dataset.v40Ready||'',error:document.documentElement.dataset.v40Error||'',workspace:document.body?.dataset.workspace||'',commandNode:document.body?.dataset.commandNode||'',operationsNode:document.body?.dataset.operationsNode||'',commsNode:document.body?.dataset.commsNode||'',pricecheckNode:document.body?.dataset.pricecheckNode||'',mountedNav:document.querySelector('#appContextNavSlot > .workspace-subnav')?.id||'',recipes:window.RHWV4?.operationsCore?.state?.catalog?.meta?.recipeCount||0,products:window.RHWV4?.operationsCore?.state?.catalog?.meta?.productCount||0,errors:window.__RHW_V4_SMOKE__?.errors||[]})")

def ui_number(value):
    digits=re.sub(r"[^0-9-]","",value or ""); return int(digits) if digits and digits!="-" else 0

def test_overview(cdp):
    result=ev(cdp,"(()=>{window.hasVerifiedTelemetry=()=>true;window.operationalItems=()=>[];window.stockFor=()=>100;window.analyzeRecipe=r=>({recipe:r,possibleCycles:r.product==='Reactor Systems'?2:3,cardState:'low',bottleneck:{name:'test'},nextCycleGap:5});RHWV4.command.updateOverview();return{ship:v40OverviewShipyard.textContent,prod:v40OverviewProduction.textContent}})()")
    if "HULL" not in result["ship"] or not result["prod"].startswith("MIN "): raise RuntimeError(f"Overview telemetry analysis failed: {result}")
    stale=ev(cdp,"(()=>{window.hasVerifiedTelemetry=()=>false;RHWV4.command.updateOverview();return{ship:v40OverviewShipyard.textContent,meta:v40OverviewShipyardMeta.textContent,prod:v40OverviewProductionMeta.textContent,log:v40OverviewLogisticsMeta.textContent}})()")
    if stale["ship"] not in {"CONNECTING", "DATA UNAVAILABLE"} or "NO VERIFIED" not in stale["meta"] or "AWAITING VERIFIED" not in stale["prod"] or "AWAITING VERIFIED" not in stale["log"]: raise RuntimeError(f"Overview stale reset failed: {stale}")
    print("V4 interaction smoke passed: COMMAND overview")

def test_production_bridge(cdp):
    result=ev(cdp,"(()=>{window.hasVerifiedTelemetry=()=>true;window.stockFor=()=>50000;if(typeof renderProductionModules!=='function'||!RHWV4.productionPricing)return{ok:false,reason:'bridge missing'};renderProductionModules();RHWV4.productionPricing.enhanceProduction();const cards=[...document.querySelectorAll('.production-card')];const card=cards.find(x=>x.querySelector('.production-title')?.textContent.trim()==='Reactor Systems');const button=card?.querySelector('.production-calc-button');if(!button)return{ok:false,reason:'button missing',cards:cards.map(x=>x.querySelector('.production-title')?.textContent.trim())};button.click();return{ok:true,hash:location.hash,ws:document.body.dataset.workspace,search:document.querySelector('#opsRecipeSearch')?.value||'',recipe:document.querySelector('#opsRecipe')?.selectedOptions?.[0]?.textContent||''}})()")
    if not result.get("ok") or result.get("hash")!="#operations/calculator" or result.get("ws")!="operations" or "reactor" not in result.get("search","").lower() or "reactor" not in result.get("recipe","").lower():
        raise RuntimeError(f"Production calculator bridge failed: {result}")
    print("V4 interaction smoke passed: PRODUCTION → calculator")

def test_restricted_iff(cdp):
    target=ev(cdp,"(()=>{const r=RHWV4.operationsCore.state.catalog.recipes.find(x=>x.restricted&&(x.bonuses||[]).length&&!(x.bonuses||[]).some(b=>b.id==='br_m_grp'));if(!r)return{ok:false};opsRecipeSearch.value=r.id;opsRecipeSearch.dispatchEvent(new Event('input',{bubbles:true}));return{ok:true,id:r.id,product:r.outputs?.[0]?.id,allowed:(r.bonuses||[]).map(b=>b.id)}})()")
    if not target.get("ok"): raise RuntimeError("No restricted non-BMM test recipe")
    time.sleep(.4)
    state=ev(cdp,"({values:[...opsAffiliation.options].map(o=>o.value),selected:opsAffiliation.value,hint:opsAffiliation.closest('label').querySelector('small').textContent})")
    if "br_m_grp" in state["values"] or "__none__" in state["values"] or state["selected"] not in target["allowed"] or "RESTRICTED RECIPE" not in state["hint"]: raise RuntimeError(f"Restricted IFF UI failed: {state}")
    guard=ev(cdp,f"(()=>{{const c=RHWV4.operationsCore,r=c.recipe({json.dumps(target['id'])});try{{c.buildPlan({{productId:{json.dumps(target['product'])},recipeId:r.id,quantity:1,affiliationId:'br_m_grp',useInventory:false,recursive:false,routingPolicy:'first'}});return{{blocked:false}}}}catch(e){{return{{blocked:true,msg:String(e.message||e)}}}}}})()")
    if not guard.get("blocked") or "AUTHORIZED IFF" not in guard.get("msg",""): raise RuntimeError(f"Restricted IFF core guard failed: {guard}")

def test_calculator(cdp):
    ev(cdp,"(()=>{RHWV4.state.calculator.materialPrices={};RHWV4.store.set(RHWV4.config.storageKeys.calculatorState,RHWV4.state.calculator);RHWV4.operations.renderCalculator();opsRecipeSearch.value='Superstr';opsRecipeSearch.dispatchEvent(new Event('input',{bubbles:true}));return{}})()"); time.sleep(.4)
    selected=ev(cdp,"({recipe:opsRecipe.selectedOptions[0].textContent,count:document.querySelectorAll('[data-material-price]').length,cycle:document.querySelector('.ops-recipe-meta strong').textContent,suffix:[...document.querySelectorAll('.ops-price-input-wrap>span')].map(x=>x.textContent.trim()),values:[...document.querySelectorAll('[data-material-price]')].map(x=>x.value),sources:document.querySelectorAll('.ops-price-source').length,alternative:[...document.querySelectorAll('*')].some(x=>x.children.length===0&&x.textContent.trim()==='ALTERNATIVE INPUTS')})")
    if "superstructure" not in selected["recipe"].lower() or "dunkirk" in selected["recipe"].lower() or selected["count"]<=0 or selected["cycle"] in {"","0"} or selected["alternative"] or any(x!="$" for x in selected["suffix"]): raise RuntimeError(f"Calculator selection/currency failed: {selected}")
    if any(value for value in selected["values"]) or selected["sources"] != 0:
        raise RuntimeError(f"Calculator must not prefill material prices: {selected}")

    ev(cdp,"(()=>{opsRecipeSearch.value='zzzz-no-such-rhw-recipe';opsRecipeSearch.dispatchEvent(new Event('input',{bubbles:true}));return{}})()"); time.sleep(.35)
    miss=ev(cdp,"({text:document.querySelector('.ops-no-match')?.textContent||'',count:document.querySelectorAll('[data-material-price]').length})")
    if "NO MATCHING RECIPE" not in miss["text"] or miss["count"]!=0: raise RuntimeError(f"Calculator no-match failed: {miss}")
    ev(cdp,"(()=>{opsRecipeSearch.value='Superstr';opsRecipeSearch.dispatchEvent(new Event('input',{bubbles:true}));return{}})()"); time.sleep(.4)
    ev(cdp,"(()=>{document.querySelectorAll('[data-material-price]').forEach(i=>{i.value='1000';i.dispatchEvent(new Event('input',{bubbles:true}))});opsMargin.value='99';opsMargin.dispatchEvent(new Event('input',{bubbles:true}));return{}})()"); time.sleep(.1)
    quote=ev(cdp,"({total:opsTotalCost.textContent,sell:opsSellUnit.textContent,profit:opsProfit.textContent,unit:opsProfitUnit.textContent,revenue:opsRevenue.textContent,margin:opsMargin.value,actual:[...document.querySelectorAll('.ops-recipe-meta>div')].find(x=>x.querySelector('small')?.textContent==='ACTUAL OUTPUT')?.querySelector('strong')?.textContent||'1'})")
    if quote["margin"]!="95" or any("$" not in quote[k] for k in ("total","sell","profit","unit","revenue")): raise RuntimeError(f"Calculator dollar quote failed: {quote}")
    if ui_number(quote["revenue"])!=ui_number(quote["sell"])*max(1,ui_number(quote["actual"])): raise RuntimeError(f"Calculator revenue mismatch: {quote}")
    test_restricted_iff(cdp)
    print("V4 interaction smoke passed: OPERATIONS calculator manual pricing")

def test_comms(cdp):
    result=ev(cdp,"(()=>{const a=RHWV4,s=commsSubject,m=commsMessage,r=commsRecipient;s.value='Audit Transmission';r.value='Admiralty Test Office';m.value='## Audit Heading\\n!status Systems nominal\\n- Test line';[s,r,m].forEach(x=>x.dispatchEvent(new Event('input',{bubbles:true})));const bb=a.comms.buildBbcode();const sender=a.storage.upsertSender({name:'Audit Sender',title:'Audit Role',organisation:'RHW',location:'New London',encryption:'AUDIT-01'});a.state.comms.senderKey=sender.key;a.state.comms.senderSnapshotName=sender.name;a.state.comms.senderSnapshotTitle=sender.title;const n=a.storage.saveDraft(a.state.comms,'__RHW_SMOKE_DRAFT__'),d=a.state.drafts.find(x=>x.name===n);a.storage.removeSender(sender.key);const resolved=a.storage.resolveSender(d.state);a.storage.deleteDraft(d.id);return{bb,sender:resolved.name,title:resolved.title,copy:!!copyBbcodePreviewBtn,log:[...commsTemplate.options].some(o=>o.value==='communication-log'),formats:[...document.querySelectorAll('[data-rhw-format]')].map(x=>x.dataset.rhwFormat)}})()")
    if "Audit Heading" not in result["bb"] or "STATUS //" not in result["bb"] or result["sender"]!="Audit Sender" or result["title"]!="Audit Role" or not result["copy"] or not result["log"]: raise RuntimeError(f"COMMS base polish failed: {result}")
    if not {"italic","underline","strike","quote","list","log","blur"}.issubset(set(result["formats"])): raise RuntimeError(f"COMMS format controls missing: {result}")
    fmt=ev(cdp,"(()=>{commsMessage.value='classified fragment';commsMessage.focus();commsMessage.setSelectionRange(0,commsMessage.value.length);document.querySelector('[data-rhw-format=\"blur\"]').click();const blur=commsMessage.value;commsMessage.value='channel transcript';commsMessage.setSelectionRange(0,commsMessage.value.length);document.querySelector('[data-rhw-format=\"log\"]').click();return{blur,log:commsMessage.value,bb:RHWV4.comms.buildBbcode()}})()")
    time.sleep(.1)
    fmt["preview"]=ev(cdp,"({html:document.querySelector('#forumLivePreview .forum-preview-body')?.innerHTML||''})").get("html","")
    if "[sp2]classified fragment[/sp2]" not in fmt["blur"] or "[spoiler=COMMUNICATION LOG]channel transcript[/spoiler]" not in fmt["log"] or "[spoiler=COMMUNICATION LOG]" not in fmt["bb"] or "forum-preview-spoiler" not in fmt["preview"]: raise RuntimeError(f"COMMS log/blur integration failed: {fmt}")
    route=ev(cdp,"(()=>{RHWV4.navigate('comms','ticker');return{hash:location.hash,ws:document.body.dataset.workspace,node:document.body.dataset.commsNode}})()")
    if route!={"hash":"#comms/ticker","ws":"comms","node":"ticker"}: raise RuntimeError(f"COMMS navigation failed: {route}")
    print("V4 interaction smoke passed: COMMS formatting + drafts")

def test_ticker(cdp):
    result=ev(cdp,"(()=>{v40TickerTag.value='BAD | TAG] [WITH EXTRA TEXT THAT IS DEFINITELY TOO LONG';v40TickerMessage.value='LINE ONE\\nLINE TWO '+'X'.repeat(300);v40TickerTag.dispatchEvent(new Event('input',{bubbles:true}));v40TickerMessage.dispatchEvent(new Event('input',{bubbles:true}));return{tag:v40TickerTag.value,msg:v40TickerMessage.value,tm:v40TickerTag.maxLength,mm:v40TickerMessage.maxLength,out:v40TickerOutput.value}})()")
    if result["tm"]!=40 or result["mm"]!=240 or any(c in result["tag"] for c in "[]|") or len(result["tag"])>40 or "\n" in result["msg"] or len(result["msg"])>240 or result["out"].count("\n")!=1: raise RuntimeError(f"Ticker parser safety failed: {result}")
    manager=ev(cdp,"(()=>{const m=RHWV4.newswireManager;if(!m)return{ok:false,reason:'manager missing'};m.applyLoadedSource('# RHW Industrial Newswire\\n\\n## market\\n- [MARKET TEST | lore] MARKET MESSAGE\\n\\n## operations\\n- [OPS TEST | good] OPS MESSAGE\\n','fallback');const before=m.state.entries.length;v40TickerCategory.value='security';v40TickerTone.value='warn';v40TickerTag.value='RHW TEST';v40TickerMessage.value='NEW BULLETIN';[v40TickerCategory,v40TickerTone].forEach(x=>x.dispatchEvent(new Event('change',{bubbles:true})));[v40TickerTag,v40TickerMessage].forEach(x=>x.dispatchEvent(new Event('input',{bubbles:true})));v40NewswireSaveBtn.click();const added=m.state.entries.find(x=>x.tag==='RHW TEST');const afterAdd=m.state.entries.length;if(!added)return{ok:false,reason:'add failed',before,afterAdd};document.querySelector(`[data-newswire-edit=\"${added.id}\"]`)?.click();v40TickerMessage.value='EDITED BULLETIN';v40TickerMessage.dispatchEvent(new Event('input',{bubbles:true}));v40NewswireSaveBtn.click();const edited=m.state.entries.find(x=>x.id===added.id)?.message||'';window.confirm=()=>true;document.querySelector(`[data-newswire-delete=\"${added.id}\"]`)?.click();return{ok:true,before,afterAdd,edited,afterDelete:m.state.entries.length,dirty:m.state.dirty,list:document.querySelectorAll('.v40-newswire-entry').length,source:v40NewswireFileOutput.value,copy:!!v40NewswireCopyFileBtn,export:!!v40NewswireExportBtn,title:document.querySelector('[data-comms-panel=\"ticker\"] .comms-panel-head strong')?.textContent||''}})()")
    if not manager.get("ok") or manager.get("before")!=2 or manager.get("afterAdd")!=3 or manager.get("edited")!="EDITED BULLETIN" or manager.get("afterDelete")!=2 or manager.get("list")!=2 or "# RHW Industrial Newswire" not in manager.get("source","") or "## market" not in manager.get("source","") or not manager.get("copy") or not manager.get("export") or "MANAGER" not in manager.get("title",""):
        raise RuntimeError(f"Newswire manager add/edit/delete failed: {manager}")
    print("V4 interaction smoke passed: Ticker safety + Newswire manager CRUD")

def launch():
    browsers=[p for n in ("google-chrome-stable","google-chrome","chromium","chromium-browser") if (p:=shutil.which(n))]
    if not browsers: raise RuntimeError("Chrome/Chromium not found")
    attempts=[]
    for browser in dict.fromkeys(browsers):
        for headless in ("--headless=new","--headless"):
            port=free_port(); folder=tempfile.mkdtemp(prefix="rhw-v40-chrome-"); log_path=str(Path(folder)/"chrome.log"); log=open(log_path,"w+b")
            args=[browser,headless,"--no-sandbox","--disable-gpu","--disable-dev-shm-usage","--disable-background-networking","--disable-component-update","--disable-default-apps","--disable-sync","--no-first-run","--no-zygote",f"--remote-debugging-port={port}","--remote-allow-origins=*",f"--user-data-dir={folder}","about:blank"]
            proc=subprocess.Popen(args,stdout=log,stderr=log); end=time.time()+5
            while time.time()<end and proc.poll() is None:
                try:
                    get(f"http://127.0.0.1:{port}/json/version",.35); log.close(); return proc,browser,port,folder,log_path
                except Exception: time.sleep(.12)
            try: proc.terminate(); proc.wait(timeout=1)
            except Exception: proc.kill()
            log.close(); attempts.append(f"{browser} {headless} exit={proc.poll()}"); shutil.rmtree(folder,ignore_errors=True)
    raise RuntimeError("Unable to launch browser: "+"; ".join(attempts))

def main():
    try: chrome,browser,port,folder,log_path=launch()
    except Exception as exc: print(f"ERROR: {exc}",file=sys.stderr); return 1
    print(f"V4 smoke browser: {browser}")
    try:
        targets=json.loads(get(f"http://127.0.0.1:{port}/json/list",3)); page=next(x for x in targets if x.get("type")=="page"); cdp=CDP(page["webSocketDebuggerUrl"])
        try:
            for method in ("Page.enable","Runtime.enable","Network.enable"): cdp.call(method)
            cdp.call("Network.setBlockedURLs",{"urls":["https://*","http://*"]})
            for workspace,node in ROUTES:
                cdp.call("Page.navigate",{"url":"about:blank"})
                cdp.call("Page.setDocumentContent",{"frameId":page["id"],"html":document(f"{workspace}/{node}")})
                end=time.time()+8; snap={}
                while time.time()<end:
                    snap=snapshot(cdp)
                    if snap.get("ready") in {"true","false"}: break
                    time.sleep(.1)
                key={"command":"commandNode","operations":"operationsNode","pricecheck":"pricecheckNode","comms":"commsNode"}[workspace]
                expected_nav={"command":"commandNodeNav","operations":"operationsNodeNav","pricecheck":"","comms":"commsNodeNav"}[workspace]
                if snap.get("ready")!="true" or snap.get("error")=="true" or snap.get("workspace")!=workspace or snap.get(key)!=node or snap.get("mountedNav")!=expected_nav or snap.get("errors"): raise RuntimeError(f"V4 route failed {workspace}/{node}: {snap}")
                if workspace=="operations" and snap.get("recipes")!=CATALOG_COUNTS["recipeCount"]: raise RuntimeError(f"Recipe catalog missing: {snap}")
                print(f"V4 runtime smoke passed: {workspace}/{node} (recipes={snap.get('recipes',0)} products={snap.get('products',0)} nav={snap.get('mountedNav','')})")
                if (workspace,node)==("command","overview"): test_overview(cdp)
                elif (workspace,node)==("command","production"): test_production_bridge(cdp)
                elif workspace=="operations": test_calculator(cdp)
                elif (workspace,node)==("comms","forum"): test_comms(cdp)
                elif (workspace,node)==("comms","ticker"): test_ticker(cdp)
        finally: cdp.close()
    finally:
        chrome.terminate()
        try: chrome.wait(timeout=3)
        except subprocess.TimeoutExpired: chrome.kill()
        shutil.rmtree(folder,ignore_errors=True)
    return 0

if __name__=="__main__":
    raise SystemExit(main())
