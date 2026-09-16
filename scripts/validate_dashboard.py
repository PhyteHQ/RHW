#!/usr/bin/env python3
"""Validate the shipped runtime manifest, public route model and deploy contract."""
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
import json
import re
import struct
import sys

from build_app_assets import build, OUTPUTS
from build_recipe_catalog import read_catalog

ROOT = Path(__file__).resolve().parents[1]


class DashboardParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.css, self.js, self.links = [], [], [], []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            self.ids.append(attrs['id'])
        if tag == 'link' and attrs.get('rel') == 'stylesheet':
            self.css.append(attrs.get('href', '').split('?')[0])
        if tag == 'script' and attrs.get('src'):
            self.js.append(attrs['src'].split('?')[0])
        if tag == 'a' and attrs.get('target') == '_blank':
            self.links.append(attrs)


def main():
    errors = []
    manifest = json.loads((ROOT / 'scripts/runtime-assets.json').read_text())
    routes = json.loads((ROOT / 'scripts/app-routes.json').read_text())
    sources = [ref.removeprefix('./') for group in manifest.values() for ref in group]
    if len(sources) != len(set(sources)):
        errors.append('A runtime source is listed more than once.')
    for source in sources:
        if not (ROOT / source).is_file():
            errors.append(f'Missing runtime source: {source}')
    # An orphaned module is an error, not a new historical-code archive.
    generated = set(OUTPUTS.values()) | {'js/build-info.js', 'js/app-shell.js', 'js/00-bootstrap.js'}
    actual = {str(p.relative_to(ROOT)) for folder in ('js', 'css') for p in (ROOT / folder).rglob('*') if p.suffix in {'.js', '.css'}}
    orphans = actual - set(sources) - generated
    if orphans:
        errors.append(f'Unshipped runtime sources: {sorted(orphans)}')

    index = (ROOT / 'index.html').read_text()
    parser = DashboardParser()
    parser.feed(index)
    if parser.css != ['./css/rhw-app.css']:
        errors.append('The page must load the single generated stylesheet.')
    if parser.js != ['./js/build-info.js', './js/00-bootstrap.js', './js/rhw-dashboard.js']:
        errors.append('Unexpected page script order.')
    duplicates = [key for key, count in Counter(parser.ids).items() if count > 1]
    if duplicates:
        errors.append(f'Duplicate HTML ids: {duplicates}')
    if '<title>RHW COMMAND</title>' not in index:
        errors.append('The browser title must remain RHW COMMAND.')
    for name in sources:
        text = (ROOT / name).read_text()
        for tag in re.findall(r'<a\b[^>]*>', text, re.I):
            if re.search(r'\btarget=["\']_blank["\']', tag, re.I) and not re.search(r'\brel=["\'][^"\']*\bnoopener\b', tag, re.I):
                errors.append(f'Unsafe external link in {name}: {tag[:100]}')
        if name.endswith('.js') and re.search(r'(?:app\.(?:command|operations|comms)\.(?:init|activate)|app\.installShell|core\.(?:loadCatalog|buildPlan))\s*=\s*(?:async\s+)?function', text):
            if name != 'js/core/app.js':
                errors.append(f'Cross-module method replacement: {name}; use lifecycle hooks.')
    if any('noopener' not in link.get('rel', '').split() for link in parser.links):
        errors.append('Static external link missing noopener.')

    public = {f'{workspace}/{node}' for workspace, nodes in routes['routes'].items() for node in nodes}
    if len(public) != 9 or 'command/overview' in public:
        errors.append('The current app must expose nine public destinations.')
    for old, target in routes['legacyRedirects'].items():
        if old in public or target not in public:
            errors.append(f'Invalid redirect: {old} -> {target}')
    pwa = json.loads((ROOT / 'manifest.webmanifest').read_text())
    for key, value in {'id': './', 'scope': './', 'display': 'standalone', 'start_url': './#command/inventory'}.items():
        if pwa.get(key) != value:
            errors.append(f'PWA {key} must be {value!r}.')
    if 'window-controls-overlay' in pwa.get('display_override', []):
        errors.append('Window-controls-overlay has no implemented safe layout.')
    for shortcut in pwa.get('shortcuts', []):
        if shortcut.get('url', '').removeprefix('./#') not in public:
            errors.append(f'PWA shortcut points to a retired route: {shortcut}')
    for icon in pwa.get('icons', []):
        path = ROOT / icon['src']
        data = path.read_bytes()
        if data[:8] != b'\x89PNG\r\n\x1a\n':
            errors.append(f'Invalid PNG: {path.name}')
        else:
            width, height = struct.unpack('>II', data[16:24])
            if icon['sizes'] != f'{width}x{height}':
                errors.append(f'Icon dimensions mismatch: {path.name}')

    outputs, shell = build()
    for name, content in outputs.items():
        if not (ROOT / name).is_file() or (ROOT / name).read_text() != content:
            errors.append(f'Stale generated file: {name}')
    if './assets/rhw-forum-logo.png' not in shell:
        errors.append('Forum preview logo is missing from the offline shell.')
    css = outputs['css/rhw-app.css']
    if re.search(r'url\([\s"\']*https?://', css):
        errors.append('Runtime CSS must not depend on external images or fonts.')
    if 'previewLogoUrl:' not in (ROOT / 'js/core/config.js').read_text():
        errors.append('Forum must distinguish local preview and absolute BBCode image URLs.')

    status = json.loads((ROOT / 'assets/discovery-status.json').read_text())
    meta = read_catalog(ROOT / 'assets/recipes')['meta']
    if status.get('schemaVersion') != 1 or status.get('workflow', {}).get('autoMerge') is not False or status.get('workflow', {}).get('reviewRequired') is not True:
        errors.append('Discovery automation must remain review-gated.')
    expected = {'recipes': meta['recipeCount'], 'products': meta['productCount'], 'factions': meta['factionCount']}
    if status.get('catalog', {}).get('raw') != expected:
        errors.append('Discovery source catalog and status counts disagree.')
    if status.get('source', {}).get('sha256') != meta.get('sourceSha256'):
        errors.append('Discovery source hashes disagree.')
    version = re.search(r"RHW_APP_VERSION\s*=\s*'([^']+)'", (ROOT / 'js/core/config.js').read_text()).group(1)
    if f'# Resolution Heavy Works Web App - {version}' not in (ROOT / 'README.md').read_text():
        errors.append('README and app release version disagree.')
    if errors:
        print('\n'.join('ERROR: ' + error for error in errors), file=sys.stderr)
        return 1
    print(f'RHW validation passed: {len(sources)} shipped sources, {len(public)} public routes, {len(parser.ids)} static ids; {version}.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
