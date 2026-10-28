"""Capture the public ID API contract for this regression investigation."""
import concurrent.futures
import json
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parents[1] / 'artifacts/interface'
ROOT.mkdir(parents=True, exist_ok=True)


def read(path, body):
    request = urllib.request.Request('https://darkstat.dd84ai.com/api/' + path,
        data=json.dumps(body).encode(), method='POST',
        headers={'Accept': 'application/json', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.load(response)
        return data if isinstance(data, list) else {'error': 'not an array'}
    except Exception as error:
        return {'error': str(error)}


with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    calls = [('tractors', {'include_rephacks': True, 'include_market_goods': True, 'filter_to_useful': True}),
             ('ships', {'include_tech_compat': True}),
             ('npc_bases', {}), ('pobs', {})]
    output = dict(zip([path for path, _ in calls], pool.map(lambda call: read(*call), calls)))
ids = output['tractors']
if isinstance(ids, list):
    selected = [row for row in ids if 'license' in row.get('nickname', '')]
    nicknames = [row['nickname'] for row in selected]
    output['id_catalog'] = [{key: row.get(key) for key in ['name', 'nickname', 'price', 'name_id', 'info_id']} for row in ids]
    output['tractors'] = selected
    replies = read('infocards', nicknames) if nicknames else []
    output['cards'] = dict(zip(nicknames, replies)) if isinstance(replies, list) else replies
if isinstance(output.get('pobs'), list):
    output['pobs'] = [row for row in output['pobs'] if re.search(r'resolution heavy works', row.get('name', ''), re.I)]
    goods = [item for pob in output['pobs'] for item in pob.get('shop_items') or [] if re.search(r'wildcat gold', item.get('name', ''), re.I)]
    output['commodities'] = read('commodities', {'include_market_goods': True, 'filter_nicknames': [item['nickname'] for item in goods]}) if goods else []
if isinstance(output['npc_bases'], list):
    output['npc_bases'] = [row for row in output['npc_bases'] if re.search(r'trafalgar|arranmore|waterloo|dublin|cork|molly', json.dumps(row), re.I)]
(ROOT / 'id-contract.json').write_text(json.dumps(output, ensure_ascii=False, indent=2))
print(json.dumps({key: len(value) if isinstance(value, list) else value.get('error', 'captured') for key, value in output.items()}))
