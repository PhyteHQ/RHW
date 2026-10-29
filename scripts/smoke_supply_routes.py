#!/usr/bin/env python3
"""Real context button, lazy modules, worker, cache and mobile supply dialog."""
import base64
import gzip
import json
from pathlib import Path
import shutil
import time
import smoke_v40 as base


def wait_for(cdp, expression, seconds=20):
    end = time.time() + seconds
    while time.time() < end:
        if base.ev(cdp, expression):
            return
        time.sleep(.1)
    debug = base.ev(cdp, "(()=>({status:document.getElementById('supplyStatus')?.textContent,open:document.getElementById('rhwSupplyDialog')?.open,active:document.activeElement?.outerHTML,buttons:[...document.querySelectorAll('[data-supply-commodity]')].filter(node=>node.getClientRects().length>0).map(node=>({name:node.dataset.supplyCommodity,hidden:!!node.closest('[hidden]'),disabled:node.disabled,card:node.closest('.production-card')?.className}))}))()")
    raise RuntimeError(f'Supply UI timed out: {debug}')


def main():
    chrome, _browser, port, folder, _log = base.launch()
    server = base.serve_inline_documents()
    origin = f'http://127.0.0.1:{server.server_port}'
    cdp = None
    try:
        target = next(page for page in json.loads(base.get(f'http://127.0.0.1:{port}/json/list', 3)) if page.get('type') == 'page')
        cdp = base.CDP(target['webSocketDebuggerUrl'])
        for method in ('Page.enable', 'Runtime.enable', 'Network.enable'):
            cdp.call(method)
        cdp.call('Network.setBlockedURLs', {'urls': ['https://*']})
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
        names = ['Hull Panels', 'Ablative Armor Plating', 'Super Alloy', 'Gold', 'Wildcat Gold', 'Industrial Materials', 'MOX', 'Scrap Metal']
        goods = [{'nickname': 'fixture_' + str(i), 'name': name, 'category': 'commodity', 'quantity': 10000,
                  'min_stock': 0, 'max_stock': 20000, 'price': 100, 'sell_price': 150, 'volume': 1, 'original_volume': 1} for i, name in enumerate(names)]
        goods[1].update(nickname='ablative', quantity=0, volume=2, original_volume=2)
        pob = {'nickname': 'rhw', 'name': 'Resolution Heavy Works', 'system_nickname': 'br01', 'system_name': 'New London',
               'defense_mode': 1, 'faction_nickname': 'br_n_grp',
               'base_pos': [0, 0, 0], 'money': 100000000, 'cargospace': 1000000, 'health': 24000000, 'shop_items': goods}
        express_pob = {'nickname': 'corporate', 'name': 'Corporate Shipping Airways', 'system_nickname': 'br01', 'system_name': 'New London',
                       'defense_mode': 1, 'faction_nickname': 'br_n_grp',
                       'base_pos': [25000, 0, 0], 'money': 10000000, 'cargospace': 1000000,
                       'shop_items': [{'nickname': 'ablative', 'name': 'Ablative Armor Plating', 'category': 'commodity', 'quantity': 10000,
                                       'min_stock': 0, 'max_stock': 20000, 'price': 180, 'sell_price': 1, 'volume': 2, 'original_volume': 2}]}
        export_buyer = {'nickname': 'buyer', 'name': 'Buyer Works', 'system_nickname': 'br01', 'system_name': 'New London',
                        'defense_mode': 1, 'faction_nickname': 'br_n_grp',
                        'base_pos': [90000, 0, 0], 'money': 1000, 'cargospace': 10000,
                        'shop_items': [{'nickname': 'fixture_3', 'name': 'Gold', 'category': 'commodity', 'quantity': 0,
                                        'min_stock': 0, 'max_stock': 10000, 'price': 9999, 'sell_price': 200, 'volume': 1, 'original_volume': 1},
                                       {'nickname': 'fixture_6', 'name': 'MOX', 'category': 'commodity', 'quantity': 50,
                                        'min_stock': 10, 'max_stock': 10000, 'price': 1, 'sell_price': 1, 'volume': 1, 'original_volume': 1}]}
        def market(base_id, name, pos, buy, sell, volume):
            return {'base_nickname': base_id, 'base_name': name, 'system_nick': 'br01', 'system_name': 'New London',
                    'base_pos': pos, 'base_sells': True, 'price_base_sells_for': buy, 'price_base_buys_for': sell, 'volume': volume}
        commodities = [
            {'nickname': 'ablative', 'name': 'Ablative Armor Plating', 'volume': 2,
             'market_goods': [market('oder', 'Oder Shipyard', [300000, 0, 0], 100, 150, 2)]},
            {'nickname': 'alloy', 'name': 'Super Alloy', 'volume': 1,
             'market_goods': [market('waterloo', 'Waterloo Station', [150000, 0, 0], 10, 10, 1), market('oder', 'Oder Shipyard', [300000, 0, 0], 100, 50, 1)]},
            {'nickname': 'fixture_4', 'name': 'Wildcat Gold', 'volume': 1,
             'market_goods': [market('trafalgar', 'Trafalgar Test Base', [600000, 0, 0], 60, 5, 1), market('molly', 'Dublin Molly Test Base', [8000, 0, 0], 10, 5, 1)]}
        ]
        nav = {'schema': 1, 'nodes': [{'id': name, 'system': 'br01', 'pos': [pos, 0, 0], 'kind': 'base', 'allows': ['medium'] if name == 'molly' else ['medium', 'large', 'berth']} for name, pos in [('rhw', 0), ('waterloo', 150000), ('oder', 300000), ('corporate', 25000), ('buyer', 90000), ('molly', 8000), ('trafalgar', 600000)]],
               'baseNodes': {name: name for name in ['rhw', 'waterloo', 'oder', 'corporate', 'buyer', 'molly', 'trafalgar']},
               'links': [{'from': a, 'to': b, 'kind': 'lane', 'speed': 2500} for a, b in [('rhw', 'waterloo'), ('waterloo', 'rhw'), ('waterloo', 'oder'), ('oder', 'waterloo'), ('rhw', 'corporate'), ('corporate', 'rhw'), ('rhw', 'molly'), ('molly', 'rhw'), ('rhw', 'trafalgar'), ('trafalgar', 'rhw')]]}
        bmm_id, junker_id = 'dsy_license_br_m_grp', 'dsy_license_fc_j_grp'
        tech = {'techchompat_by_id': {bmm_id: 1, junker_id: 1}}
        ships = [{'nickname': 'dsy_advanced_train', 'name': 'Advanced Train', 'class': 9, 'type': 'freighter', 'hold_size': 5000, 'cruise_speed': 350, 'dock_type': 2},
                 {'nickname': 'pilgrim_liner', 'name': 'Pilgrim Liner', 'class': 10, 'type': 'freighter', 'hold_size': 4300, 'cruise_speed': 415, 'dock_type': 3},
                 {'nickname': 'small_transport', 'name': 'Small Transport', 'class': 6, 'type': 'freighter', 'hold_size': 3600, 'cruise_speed': 500, 'dock_type': 2}]
        for ship in ships:
            ship.update(tech_compat=tech, ship_packages=[{'nickname': ship['nickname'] + '_package'}])
        tractors = [{'nickname': bmm_id, 'name': 'BMM ID', 'rephacks': [{'faction_nickname': 'fc_m_grp', 'reputation': -.7, 'rep_type': 0}, {'faction_nickname': 'br_n_grp', 'reputation': .3, 'rep_type': 1}]},
                    {'nickname': junker_id, 'name': 'Junkers ID', 'rephacks': [{'faction_nickname': 'fc_m_grp', 'reputation': .3, 'rep_type': 1}, {'faction_nickname': 'br_n_grp', 'reputation': .1, 'rep_type': 1}]}]
        idcards = {bmm_id: {'infocard': [{'phrases': [{'phrase': 'This Bretonian Corporate ID is used by Bretonia Mining and Manufacturing employees, who:'}]}, {'phrases': [{'phrase': '- Cannot use Cruisers, Battlecruisers, or Battleships.'}]}]},
                   junker_id: {'infocard': [{'phrases': [{'phrase': 'This Independent Quasilegal ID is used by Junkers, who:'}]}, {'phrases': [{'phrase': '- Cannot use Cruisers, Battlecruisers, Battleships, or ships with more than 4,300 cargo space.'}]}]}}
        freelancer_id = 'fixture_freelancer_id'
        tech['techchompat_by_id'][freelancer_id] = 1
        tractors.append({'nickname': freelancer_id, 'name': 'Freelancer ID', 'rephacks': tractors[1]['rephacks']})
        idcards[freelancer_id] = idcards[junker_id]
        spa_id = 'dsy_license_co_os_grp'
        captured_ids = json.loads((Path(__file__).resolve().parent / 'fixtures/player-id-routes-2026-10-28.json').read_text())
        tractors.append(next(row for row in captured_ids['tractors'] if row['nickname'] == spa_id))
        idcards[spa_id] = captured_ids['cards'][spa_id]
        tech['techchompat_by_id'][spa_id] = 1
        ships.append({'nickname': 'fixture_spa_train', 'name': 'Spa Cargo Test Model', 'class': 9, 'type': 'transport',
                      'hold_size': 5000, 'cruise_speed': 350, 'dock_type': 2,
                      'ship_packages': [{'nickname': 'fixture_spa_train_package'}],
                      'tech_compat': {'techchompat_by_id': {**tech['techchompat_by_id'], bmm_id: .1}}})
        flight_fixture = json.loads((Path(__file__).resolve().parent / 'fixtures/hauler-flight-2026-10-28.json').read_text())
        ships.append(next(row for row in flight_fixture['ships'] if row['nickname'] == 'dsy_super_gallic_train'))
        ships.append(next(row for row in flight_fixture['ships'] if row['nickname'] == 'dsy_cargobarge_1'))
        for identity in tractors:
            identity['market_goods'] = [{'base_sells': True, 'price_base_sells_for': 500, 'region_name': 'BRETONIA', 'faction_nick': 'br_n_grp', 'base_name': 'Fixture Station'}]
        neutral_id = 'dsy_license_neutral'
        tractors.append({'nickname': neutral_id, 'name': 'Neutral ID', 'market_goods': [{'base_sells': True, 'price_base_sells_for': 10000, 'region_name': 'VIRTUAL SYSTEM', 'faction_nick': 'fc_staff', 'base_name': 'Guard Station'}], 'rephacks': tractors[0]['rephacks']})
        idcards[neutral_id] = {'infocard': [{'phrases': [{'phrase': 'Allowed ships: Fighters, Freighters, Transports, Gunboats'}]}, {'phrases': [{'phrase': 'This ID can only be given by an Admin and may not be transferred or replaced without Admin permission.'}]}]}
        fixture = {'pobs': [pob, express_pob, export_buyer], 'commodities': commodities, 'ships': ships,
                   'flightTestShip': next(row for row in captured_ids['ships'] if row['nickname'] == 'dsy_cargobarge_1'),
                   'techTestShip': next(row for row in flight_fixture['ships'] if row['nickname'] == 'dsy_gallic_train_adv'),
                   'npc_bases': [{'nickname': 'trafalgar', 'faction_nick': 'br_n_grp'}, {'nickname': 'molly', 'faction_nick': 'fc_m_grp'}, {'nickname': 'waterloo', 'faction_nick': 'br_n_grp'}, {'nickname': 'oder', 'faction_nick': 'br_n_grp'}],
                   'factions': [], 'tractors': tractors, 'idcards': idcards}
        ambiguous_decoration = {'Nickname': 'fixture_ambiguous_decoration', 'Kind': 10, 'Pos': {'X': 20, 'Y': 0, 'Z': 0}}
        with gzip.open(Path(__file__).resolve().parent / 'fixtures/live-navigation-complete-2026-10-29.json.gz', 'rt') as f:
            fixture['systems'] = json.load(f)['systems']
        london = next(system for system in fixture['systems'] if system['nickname'] == 'br01')
        london['Objs'].extend([ambiguous_decoration, {**ambiguous_decoration, 'Pos': {'X': 30, 'Y': 0, 'Z': 0}}])
        script = "<script>window.supplyFixture=" + json.dumps(fixture) + ";window.supplyNav=" + json.dumps(nav) + ";window.supplyRequests=[];const originalFetch=window.fetch;window.fetch=(url,options)=>{const u=String(url);if(u.includes('/api/')){const key=u.split('/api/')[1].split('?')[0];supplyRequests.push(key);if(window.supplyOffline||key==='systems'&&window.supplyMapOffline)return Promise.reject(Error('Fixture offline'));const response=key==='infocards'?JSON.parse(options.body).map(id=>supplyFixture.idcards[id]||{error:'missing'}):supplyFixture[key]||[];return Promise.resolve(new Response(JSON.stringify(response),{status:200}));}if(u.includes('/assets/navigation.json.gz'))return Promise.resolve(new Response(JSON.stringify(supplyNav),{status:200}));return originalFetch(url,options);};</script>"
        markup = base.document('command/production').replace('<head>', '<head>' + script, 1)
        base.load_document(cdp, target['id'], markup, origin)
        wait_for(cdp, "document.documentElement.dataset.v40Ready==='true' && !!document.querySelector('.production-card [data-supply-commodity=\"Ablative Armor Plating\"]')")
        if base.ev(cdp, "supplyRequests.includes('commodities')"):
            raise RuntimeError('Supply market must not load before the feature is opened')
        # Context actions stay beside the material name. Verify the actual
        # desktop cascade and phone touch target, not just the SVG's dimensions.
        out = Path(__file__).resolve().parents[1] / 'artifacts/interface'
        out.mkdir(parents=True, exist_ok=True)
        for width, height in [(390, 844), (1440, 1000)]:
            cdp.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': width < 760})
            compact = base.ev(cdp, """(()=>{
              document.getElementById('productionPanel').classList.add('production-expanded');
              document.querySelectorAll('.production-card-collapsed .production-card-toggle').forEach(b=>b.click());
              const buttons=[...document.querySelectorAll('.production-card .rhw-supply-icon')].filter(b=>b.getClientRects().length);
              return {count:buttons.length,overflow:document.documentElement.scrollWidth>innerWidth+1,
                controls:buttons.map(b=>{const r=b.getBoundingClientRect(),name=b.previousElementSibling.getBoundingClientRect();
                  return {width:r.width,height:r.height,inline:r.left>=name.right-1,
                    named:b.getAttribute('aria-label')?.includes(b.dataset.supplyCommodity),
                    tooltip:!!b.title,icon:!!b.querySelector('svg[aria-hidden="true"]'),text:b.textContent.trim()};})};
            })()""")
            expected = 44 if width < 760 else 28
            if not compact['count'] or compact['overflow'] or any(abs(b['width']-expected)>1 or abs(b['height']-expected)>1 or not b['inline'] or not b['named'] or not b['tooltip'] or not b['icon'] or b['text'] for b in compact['controls']):
                raise RuntimeError(f'Compact supply controls failed at {width}: {compact}')
            base.ev(cdp, "document.querySelector('.production-card').scrollIntoView({block:'start',behavior:'instant'})")
            shot = cdp.call('Page.captureScreenshot', {'format': 'png'})
            (out / f'supply-controls-{width}.png').write_bytes(base64.b64decode(shot['data']))
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
        base.ev(cdp, "(()=>{const b=document.querySelector('.production-card [data-supply-commodity=\"Ablative Armor Plating\"]');const card=b.closest('.production-card');if(card.classList.contains('production-card-collapsed'))card.querySelector('.production-card-toggle').click();if(!b.getClientRects().length)throw Error('Supply trigger is not visible');b.focus();b.click();return true})()")
        wait_for(cdp, "document.querySelectorAll('#rhwSupplyDialog .supply-result').length>=2")
        facts = base.ev(cdp, "(()=>({target:document.getElementById('supplyCommodity').value,text:document.getElementById('supplyResults').innerText,first:document.querySelector('.supply-result')?.innerText,reason:document.querySelector('.supply-recommendation-reason')?.innerText,count:document.querySelectorAll('.supply-result').length,choices:document.querySelectorAll('[data-production-alternative]').length,open:document.getElementById('rhwSupplyDialog').open}))()")
        imported = base.ev(cdp, "(()=>({mode:supplyMode.selectedOptions[0].textContent,header:document.querySelector('.header-trade-button small').textContent,groups:[...supplyCommodity.querySelectorAll('optgroup')].map(g=>({label:g.label,names:[...g.querySelectorAll('option')].map(o=>o.value)})),names:[...supplyCommodity.options].map(o=>o.value)}))()")
        systems = next((g['names'] for g in imported['groups'] if g['label'] == 'SHIP SYSTEMS'), [])
        if imported['mode'] != 'IMPORT' or imported['header'] != 'IMPORT / EXPORT' or 'Toxic Waste' in imported['names'] or 'Multi-Mode Focusing Chamber' in imported['names'] or not all(name in imported['names'] for name in ['Gold', 'Wildcat Gold', 'Niobium', 'Ablative Armor Plating']) or systems != sorted(systems) or len(systems) != 6:
            raise RuntimeError(f'Imports must contain only import goods with dual-role inputs and grouped systems: {imported}')
        if not facts['open'] or facts['target'] != 'Ablative Armor Plating' or facts['count'] > 3 or facts['choices'] != 0 or 'Waterloo Station' not in facts['text'] or 'Oder Shipyard' not in facts['text'] or '2,500' not in facts['text']:
            raise RuntimeError(f'Supply context/worker result failed: {facts}')
        if 'RECOMMENDED' not in facts['first'] or 'Waterloo Station' not in facts['first'] or 'WHY THIS ROUTE' not in (facts['reason'] or '') or 'more per hour' not in facts['reason']:
            raise RuntimeError(f'Worthwhile backhaul must be recommended first and explained: {facts}')
        category_ui = base.ev(cdp, "(()=>{const card=document.querySelector('.supply-result'),models=card.querySelector('.supply-models');return {title:card.querySelector('h3').textContent,haulerMain:!!supplyHauler.closest('.supply-main-fields'),modelAdvanced:!!supplyShip.closest('.supply-settings'),closed:!models.open,hidden:[...models.querySelectorAll('li')].every(n=>!n.getClientRects().length),count:models.querySelectorAll('li').length,removed:[...supplyShip.options,...supplyHauler.options].some(n=>/super_gallic_train|Gallic Super Train|6,250|fixture_spa_train/.test(n.value+' '+n.textContent))}})()")
        if category_ui['title'] != '5,000 Cargo Transport' or not category_ui['haulerMain'] or not category_ui['modelAdvanced'] or not category_ui['closed'] or not category_ui['hidden'] or category_ui['count'] != 1 or category_ui['removed']:
            raise RuntimeError(f'Categories must lead, optional models stay collapsed, and the removed train cannot enter API-backed selectors: {category_ui}')
        base.ev(cdp, "document.querySelector('.supply-result .supply-models>summary').click()")
        if not base.ev(cdp, "(()=>{const row=document.querySelector('[data-hauler-model=\"ship:dsy_advanced_train\"]');return row.getClientRects().length>0&&row.innerText.includes('BMM · AVAILABLE')&&row.innerText.includes('Orbital Spa & Cruise · AVAILABLE')&&!document.querySelector('[data-hauler-model=\"ship:fixture_spa_train\"]')})()"):
            raise RuntimeError('The four-profile comparison must use its checked reference model without adding other hulls')
        base.ev(cdp, "document.querySelector('.supply-result .supply-models>summary').click()")
        express = base.ev(cdp, "(()=>({text:document.querySelector('.supply-express')?.innerText,recommended:document.querySelector('.supply-express')?.classList.contains('supply-recommended')}))()")
        if express['recommended'] or 'Corporate Shipping Airways' not in (express['text'] or '') or 'MATERIAL DELIVERY LOSS' not in express['text'] or '-$75,000' not in express['text']:
            raise RuntimeError(f'Costly POB must be a clearly marked express alternative: {express}')
        for width, height in [(360, 800), (390, 844), (1440, 1000)]:
            cdp.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': width < 760})
            fit = base.ev(cdp, "(()=>{const d=document.getElementById('rhwSupplyDialog'),r=d.getBoundingClientRect();return {overflow:d.scrollWidth>d.clientWidth+1,left:r.left,right:r.right,width:innerWidth,button:document.getElementById('supplySearch').getBoundingClientRect().height};})()")
            if fit['overflow'] or fit['left'] < -1 or fit['right'] > width + 1 or fit['button'] < 44:
                raise RuntimeError(f'Supply dialog overflow at {width}: {fit}')
            base.ev(cdp, "document.querySelector('.supply-result').scrollIntoView({block:'start',behavior:'instant'})")
            out = Path(__file__).resolve().parents[1] / 'artifacts/interface'
            out.mkdir(parents=True, exist_ok=True)
            shot = cdp.call('Page.captureScreenshot', {'format': 'png'})
            (out / f'supply-route-{width}.png').write_bytes(base64.b64decode(shot['data']))
        base.ev(cdp, "(()=>{supplyHauler.value=[...supplyHauler.options].find(o=>o.textContent.startsWith('3,600 Cargo Transport')).value;supplyHauler.dispatchEvent(new Event('change',{bubbles:true}));return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplyResults.dataset.stale==='false'")
        if not base.ev(cdp, "[...document.querySelectorAll('.supply-result')].every(n=>n.querySelector('h3').textContent==='3,600 Cargo Transport') && !supplyShip.querySelector('[value=\"ship:dsy_advanced_train\"]')"):
            raise RuntimeError('Choosing a category must restrict the worker results and optional model selector')
        if not base.ev(cdp, "supplyHauler.selectedOptions[0].textContent.includes('600 m/s') && supplyResults.innerText.includes('USER SPEED 600 M/S') && supplyResults.innerText.includes('REGISTRY 500 M/S')"):
            raise RuntimeError('The requested 3.6k/600 comparison must identify the custom speed separately from registry data')
        base.ev(cdp, "(()=>{supplyHauler.value='auto';supplyHauler.dispatchEvent(new Event('change',{bubbles:true}));return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplyResults.dataset.stale==='false'")
        base.ev(cdp, "(()=>{document.getElementById('supplyPobs').checked=false;document.getElementById('supplyPobs').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('supplySearch').click();return true})()")
        wait_for(cdp, "!document.getElementById('supplySearch').disabled && document.getElementById('supplyResults').dataset.stale==='false'")
        if base.ev(cdp, "!!document.querySelector('.supply-express') || document.getElementById('supplyResults').innerText.includes('Corporate Shipping Airways')"):
            raise RuntimeError('POB OFF must remove the express POB while preserving normal NPC supply')
        base.ev(cdp, "(()=>{document.getElementById('supplyExtra').value='0';document.getElementById('supplyExtra').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('supplySearch').click();return true})()")
        wait_for(cdp, "!document.getElementById('supplySearch').disabled && document.getElementById('supplyResults').dataset.stale==='false'")
        if base.ev(cdp, "document.getElementById('supplyResults').innerText.includes('Waterloo Station')"):
            raise RuntimeError('Direct-only setting retained an extra trading stop')
        # A second search immediately after the first must get new POB stock,
        # not the still-recent dashboard, memory or IndexedDB snapshot.
        prior = base.ev(cdp, "({pobs:supplyRequests.filter(x=>x==='pobs').length,maps:supplyRequests.filter(x=>x==='systems').length})")
        base.ev(cdp, "(()=>{supplyFixture.pobs[0].shop_items[1].max_stock=40;supplySearch.click();return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplyResults.dataset.stale==='false'")
        fresh = base.ev(cdp, "({pobs:supplyRequests.filter(x=>x==='pobs').length,maps:supplyRequests.filter(x=>x==='systems').length,quantity:document.querySelector('.supply-metrics strong').textContent,source:supplySource.textContent})")
        if fresh['pobs'] != prior['pobs'] + 1 or fresh['maps'] != prior['maps'] + 1 or fresh['quantity'] != '40' or 'REFRESHED EACH SEARCH' not in fresh['source'] or 'MAP OBJECTS RECEIVED' not in fresh['source']:
            raise RuntimeError(f'Every search must refresh stock and map status, including within five minutes: {fresh}')
        base.ev(cdp, "(()=>{supplyFixture.pobs[0].shop_items[1].max_stock=20000;window.supplyMapOffline=true;supplySearch.click();return true})()")
        wait_for(cdp, "!supplySearch.disabled")
        if not base.ev(cdp, "supplyStatus.textContent.includes('current navigation feed unavailable') && supplyResults.dataset.stale==='true' && supplySource.textContent.includes('REFRESH FAILED') && document.querySelector('.supply-metrics strong').textContent==='40'"):
            raise RuntimeError('A failed current-map request must pause search and mark the prior quote stale')
        base.ev(cdp, "(()=>{window.supplyMapOffline=false;supplySearch.click();return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplyResults.dataset.stale==='false'")
        if base.ev(cdp, "document.querySelector('.supply-metrics strong').textContent") != '2,500':
            raise RuntimeError('Retry must use the newly refreshed RHW limits')
        base.ev(cdp, "(()=>{window.supplyOffline=true;document.getElementById('supplyRefresh').click();return true})()")
        wait_for(cdp, "!document.getElementById('supplySearch').disabled")
        if not base.ev(cdp, "supplySource.textContent.includes('REFRESH FAILED') && supplyStatus.textContent.includes('fresh POB stock unavailable') && supplyResults.dataset.stale==='true'"):
            raise RuntimeError('Failed stock refresh must pause search and label old quotes, not calculate with cached stock')
        base.ev(cdp, "document.getElementById('supplyClose').click()")
        wait_for(cdp, "!document.getElementById('rhwSupplyDialog').open && !!document.activeElement.closest('.production-card')", 3)
        # A desktop resize hides mobile material lists. Keep focus in the source
        # module, then separately verify exact trigger restoration on the phone.
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
        base.ev(cdp, "(()=>{window.supplyOffline=false;const b=document.querySelector('.production-card [data-supply-commodity=\"Ablative Armor Plating\"]');b.focus();b.click();return true})()")
        wait_for(cdp, "document.getElementById('rhwSupplyDialog').open && !document.getElementById('supplySearch').disabled && document.querySelectorAll('.supply-result').length>0")
        base.ev(cdp, "document.getElementById('supplyClose').click()")
        wait_for(cdp, "!document.getElementById('rhwSupplyDialog').open && document.activeElement.dataset.supplyCommodity==='Ablative Armor Plating'", 3)
        base.ev(cdp, "(()=>{document.getElementById('supplyPobs').checked=true;location.hash='#command/inventory';return true})()")
        wait_for(cdp, "document.querySelector('#exportList [data-export-commodity=\"Gold\"]')?.getClientRects().length>0")
        base.ev(cdp, "document.querySelector('#exportList [data-export-commodity=\"Gold\"]').click()")
        wait_for(cdp, "document.getElementById('supplyMode').value==='export' && !document.getElementById('supplySearch').disabled && document.querySelectorAll('.supply-result').length>0")
        exported = base.ev(cdp, "(()=>({mode:supplyMode.selectedOptions[0].textContent,text:supplyResults.innerText,quantity:document.querySelector('.supply-metrics strong')?.textContent,buyer:document.querySelector('.supply-result h3')?.textContent,reason:document.querySelector('.supply-ship-note')?.textContent,backhaulVisible:!document.querySelector('[data-export-only]').hidden,groups:[...supplyCommodity.querySelectorAll('optgroup')].map(g=>g.label),names:[...supplyCommodity.options].map(o=>o.value),access:document.querySelector('.supply-access-note')?.textContent,backhaul:document.querySelector('.supply-return-cargo')?.textContent}))()")
        if exported['mode'] != 'EXPORT' or 'Wildcat Gold' in exported['names'] or exported['quantity'] != '5' or exported['buyer'] != 'Buyer Works' or 'Buyer funds' not in exported['reason'] or not exported['backhaulVisible'] or '$500' not in exported['text'] or 'owner permissions' not in exported['access'] or exported['groups'][0] != 'SHIP SYSTEMS' or 'Ablative Armor Plating' in exported['names'] or 'MOX' in exported['names'] or 'Toxic Waste' not in exported['names'] or '40 MOX' not in (exported['backhaul'] or ''):
            raise RuntimeError(f'Export quote must honor POB funds and distinguish revenue/profit/access: {exported}')
        base.ev(cdp, "(()=>{supplyBackhaul.checked=false;supplySearch.click();return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplyResults.dataset.stale==='false'")
        if base.ev(cdp, "!!document.querySelector('.supply-return-cargo') || !supplyResults.innerText.includes('Return cargo is disabled')"):
            raise RuntimeError('Return cargo OFF must reproduce the empty-return comparison')
        base.ev(cdp, "(()=>{supplyBackhaul.checked=true;supplySearch.click();return true})()")
        wait_for(cdp, "!supplySearch.disabled && !!document.querySelector('.supply-return-cargo')")
        for width in [360, 390, 1440]:
            cdp.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':900,'deviceScaleFactor':1,'mobile':width<760})
            geometry = base.ev(cdp, "(()=>({overflow:rhwSupplyDialog.scrollWidth>rhwSupplyDialog.clientWidth+1,minimum:Math.min(...[...document.querySelectorAll('.supply-buyer-grid>div')].map(e=>e.getBoundingClientRect().width))}))()")
            if geometry['overflow'] or geometry['minimum'] < 100:
                raise RuntimeError(f'Export dialog fit failed at {width}: {geometry}')
            base.ev(cdp, "document.querySelector('.supply-result').scrollIntoView({block:'start',behavior:'instant'})")
            shot = cdp.call('Page.captureScreenshot', {'format':'png'})
            (out / f'export-route-{width}.png').write_bytes(base64.b64decode(shot['data']))
        base.ev(cdp, "supplyClose.click()")
        wait_for(cdp, "!rhwSupplyDialog.open && document.activeElement.dataset.exportCommodity==='Gold'", 3)
        header = base.ev(cdp, "(()=>({trade:!!document.querySelector('.header-trade-button').getClientRects().length,refresh:!!headerRefreshBtn.getClientRects().length,closed:!uplinkDetails.open}))()")
        if not all(header.values()):
            raise RuntimeError(f'Header actions must remain visible with connection details closed: {header}')
        base.ev(cdp, "document.querySelector('.header-trade-button').click()")
        wait_for(cdp, "rhwSupplyDialog.open && !supplySearch.disabled && supplyMode.value==='export'")
        base.ev(cdp, "(()=>{supplyPobs.checked=false;supplySearch.click();return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplyResults.dataset.stale==='false'")
        if 'Buyer Works' in base.ev(cdp, "supplyResults.innerText"):
            raise RuntimeError('POB OFF must also exclude export buyers')
        base.ev(cdp, "(()=>{supplyMode.value='supply';supplyMode.dispatchEvent(new Event('change',{bubbles:true}));return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplySearch.textContent==='CALCULATE IMPORT ROUTE'")
        if not base.ev(cdp, "supplyCommodity.value==='Ablative Armor Plating' && ![...supplyCommodity.options].some(o=>o.value==='Toxic Waste')"):
            raise RuntimeError('Import mode must restore its own last selection and hide export-only goods')
        base.ev(cdp, "(()=>{supplyMode.value='export';supplyMode.dispatchEvent(new Event('change',{bubbles:true}));return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplyCommodity.value==='Gold'")
        if base.ev(cdp, "[...supplyCommodity.options].some(o=>o.value==='Ablative Armor Plating')"):
            raise RuntimeError('Export mode must restore its own last selection and hide import-only goods')
        base.ev(cdp, "(()=>{supplyMode.value='supply';supplyMode.dispatchEvent(new Event('change',{bubbles:true}));return true})()")
        wait_for(cdp, "!supplySearch.disabled")
        base.ev(cdp, "(()=>{supplyCommodity.value='Wildcat Gold';supplyCommodity.dispatchEvent(new Event('change',{bubbles:true}));supplyShip.value='auto';supplySearch.click();return true})()")
        wait_for(cdp, "!supplySearch.disabled && !!document.querySelector('.supply-result [data-compatible-identity]')")
        identity_result = base.ev(cdp, "(()=>({first:document.querySelector('.supply-result').innerText,reference:document.querySelector('.supply-result').dataset.referenceShip,compatible:[...document.querySelectorAll('.supply-result:first-child .supply-id-tags>span')].map(n=>n.dataset.compatibleIdentity),idFilter:supplyIdentity.value,goal:supplyImportGoal.value,idInAdvanced:!!supplyIdentity.closest('.supply-settings'),mainFields:document.querySelectorAll('.supply-main-fields select').length,panel:!!document.querySelector('.supply-identity-comparison')}))()")
        if '3,600 Cargo Transport' not in identity_result['first'] or identity_result['reference'] != 'ship:small_transport' or 'Dublin Molly Test Base' not in identity_result['first'] or sorted(identity_result['compatible']) != sorted([junker_id, freelancer_id]) or identity_result['idFilter'] != 'all' or identity_result['goal'] != 'price' or not identity_result['idInAdvanced'] or identity_result['mainFields'] != 3 or identity_result['panel'] or 'Neutral ID' in identity_result['first'] or 'CONDITIONAL ID' in identity_result['first']:
            raise RuntimeError(f'Default route-first search must recommend the closer allowed hauler and show all compatible IDs without a preceding ID panel: {identity_result}')
        preferred = base.ev(cdp, "(()=>{const card=document.querySelector('.supply-result');const all=card.querySelector('.supply-all-identities');return {ids:[...card.querySelectorAll('[data-preferred-identity]')].map(n=>({id:n.dataset.preferredIdentity,state:n.dataset.state})),closed:!!all&&!all.open,summary:all?.querySelector('summary').textContent,hidden:[...all.querySelectorAll('[data-compatible-identity]')].every(n=>!n.getClientRects().length)}})()")
        if preferred['ids'] != [{'id': bmm_id, 'state': 'blocked'}, {'id': junker_id, 'state': 'checked'}, {'id': spa_id, 'state': 'blocked'}] or not preferred['closed'] or not preferred['hidden'] or 'SHOW ALL 2 COMPATIBLE IDs' not in preferred['summary']:
            raise RuntimeError(f'The normal BMM, Junkers and Spa IDs must stay visible in order with route-specific states; other compatible IDs must be collapsed: {preferred}')
        base.ev(cdp, "document.querySelector('.supply-result .supply-all-identities>summary').click()")
        if not base.ev(cdp, "(()=>{const all=document.querySelector('.supply-result .supply-all-identities');return all.open&&[...all.querySelectorAll('[data-compatible-identity]')].every(n=>n.getClientRects().length>0)})()"):
            raise RuntimeError('Show all must reveal the complete counted compatible-ID list')
        base.ev(cdp, "(()=>{document.querySelector('.supply-result .supply-all-identities>summary').click();document.querySelector('.supply-result [data-preferred-identity=\"dsy_license_br_m_grp\"]>summary').click();return true})()")
        if 'Dublin Molly Test Base' not in base.ev(cdp, "document.querySelector('.supply-result [data-preferred-identity=\"dsy_license_br_m_grp\"] p').innerText"):
            raise RuntimeError('An unavailable favorite must explain the actual docking restriction')
        base.ev(cdp, "document.querySelector('.supply-result [data-preferred-identity=\"dsy_license_br_m_grp\"]>summary').click()")
        for width in [360, 390, 1440]:
            cdp.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 1000, 'deviceScaleFactor': 1, 'mobile': width < 760})
            if base.ev(cdp, "rhwSupplyDialog.scrollWidth>rhwSupplyDialog.clientWidth+1"):
                raise RuntimeError(f'Route-first result overflows at {width}px')
            base.ev(cdp, "document.querySelector('.supply-result').scrollIntoView({block:'start',behavior:'instant'})")
            shot = cdp.call('Page.captureScreenshot', {'format': 'png'})
            (out / f'route-first-{width}.png').write_bytes(base64.b64decode(shot['data']))
        base.ev(cdp, "(()=>{document.querySelector('.supply-settings').open=true;supplyIdentity.value='dsy_license_br_m_grp';supplyIdentity.dispatchEvent(new Event('change',{bubbles:true}));return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplyResults.innerText.includes('Trafalgar Test Base')")
        if 'Dublin Molly Test Base' in base.ev(cdp, "supplyResults.innerText"):
            raise RuntimeError('Optional BMM filter must exclude the incompatible supplier')
        base.ev(cdp, "(()=>{supplyShip.value='ship:dsy_advanced_train';supplyIdentity.value='dsy_license_fc_j_grp';supplyIdentity.dispatchEvent(new Event('change',{bubbles:true}));return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplyResults.innerText.includes('Dublin Molly Test Base')")
        if not base.ev(cdp, "supplyShip.value==='auto' && supplyShip.querySelector('[value=\"ship:dsy_advanced_train\"]').disabled"):
            raise RuntimeError('ID restriction must reset and disable an illegal 5k hull while preserving route search')
        # Add the captured Barge only for this manual flight test, after the
        # original controlled-market comparisons. It must not inherit lanes
        # from MID docking, even after a cached ship-registry refresh.
        base.ev(cdp, "(()=>{supplyFixture.ships.push(supplyFixture.flightTestShip);supplyIdentity.value='dsy_license_br_m_grp';supplyRefresh.click();return true})()")
        wait_for(cdp, "!supplySearch.disabled && !!supplyShip.querySelector('[value=\"ship:dsy_cargobarge_1\"]')")
        if not base.ev(cdp, "supplyHauler.options.length===5 && supplyShip.options.length===5"):
            raise RuntimeError('Only Auto and the four requested hauler profiles may appear in the selectors')
        base.ev(cdp, "(()=>{supplyCommodity.value='Ablative Armor Plating';supplyShip.value='ship:dsy_cargobarge_1';supplyPobs.checked=false;supplyExtra.value='0';supplySearch.click();return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplyResults.dataset.stale==='false' && !!document.querySelector('.supply-result')")
        flight = base.ev(cdp, "(()=>{const card=document.querySelector('.supply-result');return {ship:card.querySelector('h3').textContent,reference:card.dataset.referenceShip,note:card.querySelector('.supply-ship-note').textContent,time:card.querySelector('.supply-metrics>div:nth-child(2) strong').textContent,option:supplyShip.selectedOptions[0].textContent}})()")
        if flight['ship'] != '30,000 Cargo Bulk Hauler' or flight['reference'] != 'ship:dsy_cargobarge_1' or 'NO TRADE LANES' not in flight['note'] or '15 S CRUISE CHARGE' not in flight['note'] or 'NO TRADE LANES' not in flight['option'] or int(flight['time'].split(':')[0]) < 100:
            raise RuntimeError(f'Barge UI must use cruise-only flight time and explain its flight profile: {flight}')
        for width in [390, 1440]:
            cdp.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 1000, 'deviceScaleFactor': 1, 'mobile': width < 760})
            if base.ev(cdp, "rhwSupplyDialog.scrollWidth>rhwSupplyDialog.clientWidth+1"):
                raise RuntimeError(f'Flight profile note overflows at {width}px')
            base.ev(cdp, "document.querySelector('.supply-result').scrollIntoView({block:'start',behavior:'instant'})")
            shot = cdp.call('Page.captureScreenshot', {'format': 'png'})
            (out / f'barge-flight-{width}.png').write_bytes(base64.b64decode(shot['data']))
        base.ev(cdp, "(()=>{supplyFixture.ships.push(supplyFixture.techTestShip);supplyIdentity.value='dsy_license_co_os_grp';supplyUnverified.checked=true;supplyRefresh.click();return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplyResults.dataset.stale==='false'")
        if not base.ev(cdp, "!supplyShip.querySelector('[value=\"ship:dsy_gallic_train_adv\"]') && supplyUnverified.checked && supplyShip.options.length===5"):
            raise RuntimeError('Adding another API hull cannot expand the four-profile fleet, including with unverified rules enabled')
        base.ev(cdp, "(()=>{supplyShip.value='ship:dsy_gallic_train_adv';supplySearch.click();return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplyResults.dataset.stale==='false'")
        if not base.ev(cdp, "supplyShip.value==='auto' && !document.querySelector('[data-reference-ship=\"ship:dsy_gallic_train_adv\"],[data-hauler-model=\"ship:dsy_gallic_train_adv\"]')"):
            raise RuntimeError('A restored/programmatic partial-tech selection must reset to Auto without quoting that hull')
        # Unknown seller money/storage cannot block a purchase. A missing
        # docking policy stays conditional under the explicit unverified switch.
        base.ev(cdp, "(()=>{const p=structuredClone(supplyFixture.pobs[1]);p.nickname='undisclosed';p.name='Undisclosed Seller';p.money=null;p.cargospace=null;p.defense_mode=null;p.base_pos=[12000,0,0];p.shop_items[0].price=100;supplyFixture.pobs.push(p);supplyPobs.checked=true;supplyUnverified.checked=false;supplyRestrictedPobs.checked=false;supplySearch.click();return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplyResults.dataset.stale==='false'")
        if 'Undisclosed Seller' in base.ev(cdp, "supplyResults.innerText"):
            raise RuntimeError('Unknown docking must not become verified by default')
        base.ev(cdp, "(()=>{supplyUnverified.checked=true;supplySearch.click();return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplyResults.innerText.includes('Undisclosed Seller')")
        if not base.ev(cdp, "[...supplyResults.querySelectorAll('.supply-result')].filter(n=>n.innerText.includes('Undisclosed Seller')).every(n=>!n.classList.contains('supply-recommended')&&n.innerText.includes('CONDITIONAL'))"):
            raise RuntimeError('Undisclosed seller should be a usable conditional quote, never a verified recommendation')
        base.ev(cdp, "(()=>{supplyFixture.pobs.find(p=>p.nickname==='undisclosed').defense_mode=2;supplySearch.click();return true})()")
        wait_for(cdp, "!supplySearch.disabled && supplyResults.dataset.stale==='false'")
        if 'Undisclosed Seller' in base.ev(cdp, "supplyResults.innerText"):
            raise RuntimeError('Unverified rules alone cannot bypass a reported whitelist')
        base.ev(cdp, "supplyClose.click()")
        wait_for(cdp, "!rhwSupplyDialog.open && document.activeElement.classList.contains('header-trade-button')", 3)
        print('Trade Desk browser passed: route-first default, compatible ID badges, cheaper-source priority, optional ID filter, illegal/partial-tech hulls disabled, import/export and POB regressions, focus and 360/390/1440px layouts.')
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
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
