#!/usr/bin/env python3
"""Compare public Darkstat reachability from a normal runner or local shell.

Only request metadata and aggregate checks are retained. Stock, quotations,
private drafts and credentials are never written to the diagnostic report.
"""
import argparse
import concurrent.futures
import datetime
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.request

ORIGIN = 'https://phytehq.github.io'
API = 'https://darkstat.dd84ai.com/api/pobs'
LIMIT = 32 * 1024 * 1024


def probe(method, url, headers):
    start = time.monotonic()
    result = {'method': method, 'url': url}
    request = urllib.request.Request(url, method=method, headers=headers)
    try:
        try:
            response = urllib.request.urlopen(request, timeout=25)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            result.update(status=response.status, content_type=response.headers.get('Content-Type', ''),
                          allow_origin=response.headers.get('Access-Control-Allow-Origin', ''),
                          allow_methods=response.headers.get('Access-Control-Allow-Methods', ''),
                          server=response.headers.get('Server', ''))
            body = response.read(LIMIT + 1)
            result['bytes'] = len(body)
            if len(body) > LIMIT:
                result['error'] = 'Response exceeds the diagnostic size limit'
            elif method == 'POST':
                try:
                    data = json.loads(body)
                    result['json_array'] = isinstance(data, list)
                    if isinstance(data, list):
                        result['base_count'] = len(data)
                        result['rhw_found'] = any(isinstance(base, dict) and
                            str(base.get('name', '')).strip().lower() == 'resolution heavy works'
                            for base in data)
                except (ValueError, UnicodeError):
                    result['json_array'] = False
            if 'text/html' in result['content_type'].lower():
                title = re.search(br'<title[^>]*>(.*?)</title>', body, re.I | re.S)
                result['page_title'] = title.group(1).decode('utf-8', errors='replace')[:160] if title else ''
    except (OSError, ValueError) as error:
        result['error'] = str(error)[:240]
    result['seconds'] = round(time.monotonic() - start, 2)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('artifacts/darkstat-connectivity.json'))
    args = parser.parse_args()
    checks = [
        ('POST', API, {'Accept': 'application/json', 'Origin': ORIGIN}),
        ('OPTIONS', API, {'Origin': ORIGIN, 'Access-Control-Request-Method': 'POST'}),
        ('GET', 'https://darkstat.dd84ai.com/swagger/index.html', {'Accept': 'text/html'})
    ]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda check: probe(*check), checks))
    pobs = results[0]
    reachable = pobs.get('status') == 200 and pobs.get('json_array') is True
    cors = pobs.get('allow_origin') in ('*', ORIGIN)
    report = {'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'origin': ORIGIN, 'api_reachable': reachable, 'browser_origin_allowed': cors,
              'checks': results}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))
    print('Public API and RHW browser origin are available.' if reachable and cors
          else 'This environment did not verify both a JSON response and browser-origin access.')


if __name__ == '__main__':
    main()
