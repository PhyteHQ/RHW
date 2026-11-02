#!/usr/bin/env python3
"""Opt-in real-network Trade Desk check. No mocked feeds; not an offline CI gate."""
import base64
import json
from pathlib import Path
import shutil
import time

import smoke_v40 as base


def wait(cdp, expression, seconds):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        if base.ev(cdp, expression):
            return
        time.sleep(.2)
    raise AssertionError(base.ev(cdp, "({status:document.getElementById('supplyStatus')?.textContent,source:document.getElementById('supplySource')?.textContent})"))


def main():
    chrome, _, port, folder, _ = base.launch()
    server = base.serve_inline_documents()
    cdp = None
    try:
        target = next(p for p in json.loads(base.get(f'http://127.0.0.1:{port}/json/list', 3)) if p.get('type') == 'page')
        cdp = base.CDP(target['webSocketDebuggerUrl'])
        for method in ('Page.enable', 'Runtime.enable', 'Network.enable'):
            cdp.call(method)
        # Deliberately no blocked URLs, response interception or fixture script.
        base.load_document(cdp, target['id'], base.document('command/production'), f'http://127.0.0.1:{server.server_port}')
        wait(cdp, "document.documentElement.dataset.v40Ready==='true'", 25)
        base.ev(cdp, "RHWV4.supplyRoutes.open('Prototype Components',document.querySelector('.header-trade-button'),'supply').then(()=>true)")
        wait(cdp, "!!document.getElementById('supplySearch') && !supplySearch.disabled", 55)
        initial = base.ev(cdp, "({status:supplyStatus.textContent,source:supplySource.textContent,recovery:!supplyMapRecovery.hidden})")
        print('INITIAL LIVE SEARCH:', json.dumps(initial), flush=True)
        recovered = initial['recovery']
        if recovered:
            base.ev(cdp, "supplyUseVerifiedMap.click()")
            wait(cdp, "!supplySearch.disabled && supplyResults.dataset.stale==='false'", 55)
        state = base.ev(cdp, "({status:supplyStatus.textContent,source:supplySource.textContent,commodity:supplyCommodity.value,stale:supplyResults.dataset.stale,results:supplyResults.querySelectorAll('.supply-result').length,empty:supplyResults.querySelector('.supply-empty')?.textContent,verifiedRecommendation:!!supplyResults.querySelector('.supply-recommended'),labels:[...supplyResults.querySelectorAll('.supply-result>header small')].map(n=>n.textContent)})")
        assert state['stale'] == 'false' and 'POB STOCK RECEIVED' in state['source'], state
        assert state['results'] or state.get('empty'), state
        if recovered:
            assert 'CURRENT MAP UNVERIFIED' in state['source'] and not state['verifiedRecommendation'], state
            assert all('29 OCT 2026' in label for label in state['labels']), state
        else:
            assert 'MAP OBJECTS RECEIVED' in state['source'], state
        print('REAL NETWORK TRADE DESK PASSED:', json.dumps(state), flush=True)
        out = Path(__file__).resolve().parents[1] / 'artifacts/live-trade'
        out.mkdir(parents=True, exist_ok=True)
        (out / 'result.json').write_text(json.dumps({'initial':initial,'recovered':recovered,'result':state}, indent=2))
        base.ev(cdp, "(supplyMapRecovery.hidden?supplyResults:supplyMapRecovery).scrollIntoView({block:'center',behavior:'instant'})")
        (out / 'real-network-trade-desk.png').write_bytes(base64.b64decode(cdp.call('Page.captureScreenshot', {'format':'png'})['data']))
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
