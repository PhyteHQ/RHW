#!/usr/bin/env python3
"""Dependency-free structural checks for the static RHW dashboard and V4 web app."""
from __future__ import annotations

from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
import json
import re
import struct
import sys

from build_recipe_catalog import read_catalog

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / 'index.html'

EXPECTED_CSS = [
    './css/01-core.css', './css/02-ticker.css', './css/03-production.css', './css/04-responsive.css',
    './css/05-shipyard.css', './css/06-shipyard-detail.css', './css/07-mobile.css', './css/08-headings.css',
    './css/09-v35.css', './css/10-maintenance.css', './css/11-layout-v36.css',
]
EXPECTED_JS = [
    './js/build-info.js', './js/config.js', './js/00-bootstrap.js', './js/01-wire.js', './js/02-utils.js', './js/03-telemetry.js',
    './js/04-state-production.js', './js/05-shipyard.js', './js/06-logistics.js', './js/07-overview.js',
    './js/08-data.js', './js/09-newswire.js', './js/10-maintenance.js', './js/11-layout-v36.js',
]
V4_RUNTIME_ASSETS = [
    './css/12-app-v40.css', './css/13-app-v40-navigation.css', './css/14-app-v40-composer.css',
    './css/15-app-v40-audit.css', './css/16-app-v40-operations.css', './css/17-app-v40-calculator-polish.css',
    './css/18-app-v40-nav-hierarchy.css', './css/19-app-v402-fixes.css', './css/20-app-v402-qol.css',
    './css/21-app-v402-mobile-ui.css', './css/22-app-pr3-command-mobile.css', './css/23-app-pr3-yard-production.css',
    './css/24-app-pr3-operations-calculator.css', './css/25-app-pr3-comms-workflow.css',
    './css/26-app-pr3-newswire-manager.css', './css/27-app-pr4-pwa.css', './css/28-app-pr5-newswire-2.css',
    './css/29-app-pr6-discovery-sync.css', './css/30-app-pr7-diagnostics.css', './css/31-app-pr8-production-orders.css',
    './css/32-app-pr9-transfer-center.css', './css/33-app-pr10-newswire-review.css', './css/34-app-pr11-full-audit.css', './css/35-app-interface-cleanup.css',
    './js/12-app-config.js', './js/13-app-v40.js', './js/14-app-v40-cache.js', './js/15-app-v40-navigation.js',
    './js/16-app-v40-composer.js', './js/16a-app-v40-comms-safety.js', './js/16b-app-v40-newswire-manager.js',
    './js/16c-app-v40-newswire-ordering.js',
    './assets/recipes/catalog-v1-part-01.js', './assets/recipes/catalog-v1-part-02.js', './assets/recipes/catalog-v1-part-03.js',
    './assets/recipes/catalog-v1-part-04.js', './assets/recipes/catalog-v1-part-05.js', './assets/recipes/catalog-v1-part-06.js',
    './js/17-app-v40-operations-core.js', './js/18-app-v40-operations-ui.js', './js/18a-app-v40-nav-hierarchy.js',
    './js/18b-app-v40-production-pricing.js', './js/18c-app-v40-recipe-corrections.js',
    './js/18d-app-v40-final-ui-polish.js', './js/20-app-v402-fixes.js', './js/21-app-v402-qol.js',
    './js/22-app-v402-mobile-ui.js', './js/23-app-v40-pwa.js', './js/24-app-v40-newswire-2.js',
    './js/25-app-v40-discovery-status.js', './js/26-app-v40-diagnostics.js', './js/27-app-v40-production-orders.js',
    './js/28-app-v40-transfer-center.js', './js/29-app-v40-newswire-review.js', './js/30-app-v40-full-audit.js',
    './js/19-app-v40-runtime.js',
]
V4_SUPPORT_ASSETS = ['./scripts/build_recipe_catalog.py', './scripts/smoke_v40.py', './scripts/test_production_orders.js', './scripts/test_transfer_center.js', './scripts/test_newswire_review.js', './scripts/test_full_audit.js', './docs/full-app-audit.md']
DISCOVERY_SYNC_ASSETS = [
    './assets/discovery-status.json', './docs/discovery-sync-report.md',
    './scripts/sync_discovery_catalog.py', './scripts/test_discovery_sync.py',
    './.github/workflows/discovery-catalog-sync.yml',
]
PWA_ASSETS = [
    './manifest.webmanifest', './sw.js', './assets/rhw-crest.png', './assets/favicon.png',
    './assets/apple-touch-icon.png', './assets/pwa-icon-192.png', './assets/pwa-icon-512.png',
    './assets/pwa-icon-maskable-512.png',
]


class DashboardParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: list[str] = []
        self.css: list[str] = []
        self.js: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if values.get('id'):
            self.ids.append(values['id'] or '')
        if tag == 'link' and values.get('rel') == 'stylesheet' and values.get('href', '').startswith('./css/'):
            self.css.append(values['href'] or '')
        if tag == 'script' and values.get('src', '').startswith('./js/'):
            self.js.append(values['src'] or '')


def require_tokens(errors: list[str], path: str, tokens: tuple[str, ...], label: str) -> None:
    text = (ROOT / path).read_text(encoding='utf-8')
    for token in tokens:
        if token not in text:
            errors.append(f'{label} is incomplete: {token}')


def png_size(path: Path) -> tuple[int, int] | None:
    data = path.read_bytes()[:24]
    if len(data) != 24 or data[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    return struct.unpack('>II', data[16:24])


def target_blank_without_noopener(text: str) -> list[str]:
    failures: list[str] = []
    for tag in re.findall(r'<a\b[^>]*>', text, flags=re.I):
        if not re.search(r'\btarget\s*=\s*["\']_blank["\']', tag, flags=re.I):
            continue
        rel = re.search(r'\brel\s*=\s*["\']([^"\']*)["\']', tag, flags=re.I)
        if not rel or 'noopener' not in rel.group(1).lower().split():
            failures.append(tag[:160])
    return failures


def main() -> int:
    errors: list[str] = []
    if not INDEX.exists():
        print('ERROR: index.html is missing', file=sys.stderr)
        return 1

    parser = DashboardParser()
    parser.feed(INDEX.read_text(encoding='utf-8'))
    if parser.css != EXPECTED_CSS:
        errors.append('Stylesheet load order differs from the documented RHW order.')
    if parser.js != EXPECTED_JS:
        errors.append('JavaScript load order differs from the documented RHW order.')

    for ref in [*parser.css, *parser.js, *V4_RUNTIME_ASSETS, *V4_SUPPORT_ASSETS, *PWA_ASSETS, *DISCOVERY_SYNC_ASSETS, './assets/RHW_Newswire.md']:
        if not (ROOT / ref.removeprefix('./')).is_file():
            errors.append(f'Referenced local file is missing: {ref}')

    for path in [INDEX, *sorted((ROOT / 'js').glob('*.js'))]:
        insecure_links = target_blank_without_noopener(path.read_text(encoding='utf-8'))
        if insecure_links:
            errors.append(f'{path.relative_to(ROOT)} contains target="_blank" link(s) without rel="noopener": {insecure_links!r}')

    duplicate_ids = sorted(key for key, count in Counter(parser.ids).items() if count > 1)
    if duplicate_ids:
        errors.append('Duplicate HTML id values: ' + ', '.join(duplicate_ids))

    config = (ROOT / 'js/config.js').read_text(encoding='utf-8')
    if 'baseHealthMax:' not in config:
        errors.append('js/config.js must define baseHealthMax.')

    require_tokens(errors, 'js/11-layout-v36.js', ('arrangeV36CommandFlow', 'initProductionDetailsToggle'), 'V3.6 layout controls')

    bootstrap = (ROOT / 'js/00-bootstrap.js').read_text(encoding='utf-8')
    for required in V4_RUNTIME_ASSETS:
        if required not in bootstrap:
            errors.append(f'V4 bootstrap does not reference required asset: {required}')

    app_config = (ROOT / 'js/12-app-config.js').read_text(encoding='utf-8')
    version_match = re.search(r"RHW_APP_VERSION\s*=\s*'([^']+)'", app_config)
    version = version_match.group(1) if version_match else ''
    if not re.fullmatch(r'V4\.\d+(?:\.\d+)?(?: PREVIEW)?', version):
        errors.append(f'V4 configuration has an invalid RHW_APP_VERSION: {version or "MISSING"}')

    require_tokens(errors, 'js/12-app-config.js', (
        'alistair-thorne', 'salutations:', 'closings:',
        'operationsNode:', 'calculatorState:', 'defaultAffiliation:', 'shipyardTargets:',
        'newswireManagerDraft:', 'newswireReviewHistory:', 'commsMobileView:'
    ), 'V4 configuration')
    require_tokens(errors, 'js/13-app-v40.js', (
        'window.RHWV4', "'operations'", 'workspaceOperations', 'app.installShell', 'app.navigate', 'app.applyRoute',
        "typeof document.execCommand === 'function'", 'fallbackCopy', 'recoverCorruptStorageEntry', 'rhw-webapp-v4:recovery:'
    ), 'V4 core')
    require_tokens(errors, 'js/02-utils.js', (
        'recoverSafeStorageEntry', '__RHW_STORAGE_RECOVERIES__', 'rhw-webapp-v4:recovery:'
    ), 'Stable dashboard storage recovery')
    require_tokens(errors, 'js/14-app-v40-cache.js', (
        'app.storage', 'saveDraft', 'upsertSender', 'importPayload', 'senderSnapshotName',
        "version: 5", 'inspectPayload', 'priceProfiles:', 'shipyardPlanner:', 'productionOrders:', 'newswireDraft:', 'preferences:'
    ), 'V4 storage')
    require_tokens(errors, 'js/15-app-v40-navigation.js', (
        'PRIORITY ACTIONS', 'inventory-view-nav', 'priorityActions', 'activateInventoryView',
        "typeof CAPITAL_SHIPYARD === 'undefined'", "typeof RECIPES === 'undefined'"
    ), 'V4 COMMAND module')
    require_tokens(errors, 'js/16-app-v40-composer.js', ('SALUTATION / OPENING', 'comms-editor-toolbar', 'ticker-builder-preview', 'data-edit-sender', 'buildBbcode'), 'V4 COMMS module')
    require_tokens(errors, 'js/16a-app-v40-comms-safety.js', (
        'MAX_TAG = 40', 'MAX_MESSAGE = 240', 'normalizeTag', 'normalizeMessage', 'app.commsSafety'
    ), 'V4 COMMS safety module')
    require_tokens(errors, 'js/16b-app-v40-newswire-manager.js', (
        'newswireManagerDraft', 'readLocalDraft', 'draftSourceChanged', 'beforeunload', 'restoreDraft',
        'v40NewswireWorkflow', 'v40NewswireRecoveryStatus', 'jumpToWorkflow', 'renderCounters'
    ), 'V4 Newswire recovery')
    require_tokens(errors, 'js/00-bootstrap.js', (
        'rhwBootFailure', 'rhwBootError', 'LOAD TIMEOUT', '__RHW_BOOTSTRAP_TEST__',
        './css/21-app-v402-mobile-ui.css', './css/23-app-pr3-yard-production.css',
        './css/24-app-pr3-operations-calculator.css', './css/25-app-pr3-comms-workflow.css',
        './css/26-app-pr3-newswire-manager.css', './css/27-app-pr4-pwa.css',
        './css/28-app-pr5-newswire-2.css', './css/29-app-pr6-discovery-sync.css',
        './css/30-app-pr7-diagnostics.css', './css/31-app-pr8-production-orders.css',
        './css/32-app-pr9-transfer-center.css', './css/33-app-pr10-newswire-review.css', './css/34-app-pr11-full-audit.css', './css/35-app-interface-cleanup.css',
        './js/22-app-v402-mobile-ui.js', './js/23-app-v40-pwa.js',
        './js/24-app-v40-newswire-2.js', './js/25-app-v40-discovery-status.js',
        './js/26-app-v40-diagnostics.js', './js/27-app-v40-production-orders.js',
        './js/28-app-v40-transfer-center.js', './js/29-app-v40-newswire-review.js', './js/30-app-v40-full-audit.js'
    ), 'V4 bootstrap failure UI')
    require_tokens(errors, 'js/22-app-v402-mobile-ui.js', (
        'commsMobileView', 'setForumView', 'commsMobileViewSwitch', "['write', 'preview', 'bbcode']"
    ), 'V4 mobile UI')
    require_tokens(errors, 'css/21-app-v402-mobile-ui.css', (
        'env(safe-area-inset-bottom', 'position: fixed', 'min-height: 44px',
        'data-comms-mobile-view="write"', 'data-comms-mobile-view="preview"', 'data-comms-mobile-view="bbcode"'
    ), 'V4 mobile presentation')
    require_tokens(errors, 'js/04-state-production.js', (
        'productionModuleFilter', 'applyProductionModuleFilters', 'data-production-filter', 'production-card-toggle'
    ), 'PR3 Production decision controls')
    require_tokens(errors, 'js/05-shipyard.js', (
        'shipyard-decision-strip', 'MISSING FOR NEXT HULL', 'data-label="REQ / HULL"'
    ), 'PR3 Shipyard decision summary')
    require_tokens(errors, 'css/23-app-pr3-yard-production.css', (
        '.shipyard-decision-strip', '.production-module-tools', '.production-card-toggle',
        'min-height: 44px', 'orientation: landscape'
    ), 'PR3 Shipyard + Production UI')
    require_tokens(errors, 'css/24-app-pr3-operations-calculator.css', (
        '.ops-mobile-decision', '.ops-material-row', '.ops-profile-actions button',
        'min-height: 44px', 'overflow: visible', '@media (max-width: 390px)'
    ), 'PR3 Calculator mobile presentation')
    require_tokens(errors, 'js/16-app-v40-composer.js', (
        'commsWorkflowStatus', 'commsMessageCount', 'data-comms-surface="preview"',
        'data-copy-forum-bbcode', 'comms-archive-summary', 'ACTIVE PROFILE'
    ), 'PR3 COMMS workflow')
    require_tokens(errors, 'css/25-app-pr3-comms-workflow.css', (
        '.comms-workflow-status', '.comms-surface-actions', '.comms-archive-summary',
        '.sender-registry-card.active', '.v40-newswire-file-actions button',
        'min-height: 44px', '@media (max-width: 390px)'
    ), 'PR3 COMMS mobile presentation')
    require_tokens(errors, 'css/26-app-pr3-newswire-manager.css', (
        '.v40-newswire-workflow', '.v40-newswire-recovery-status',
        '#v40NewswireManager .v40-newswire-category-summary button',
        '#v40NewswireManager .v40-newswire-order-actions button',
        'min-height: 44px', '@media (max-width: 760px)'
    ), 'PR3 Newswire mobile workflow')
    require_tokens(errors, 'js/23-app-v40-pwa.js', (
        'beforeinstallprompt', 'serviceWorker.register', 'SKIP_WAITING', 'controllerchange',
        'SamsungBrowser', 'iPad|iPhone|iPod', 'OPEN RHW IN SAFARI', "querySelector('.app-nav-brand')",
        'CACHED APP DATA ONLY', 'dataset.rhwNetwork', "getElementById('refreshBtn')", 'prompt-failed'
    ), 'PR4 installable app runtime')
    require_tokens(errors, 'css/27-app-pr4-pwa.css', (
        '.app-nav-brand .rhw-pwa-install', '.rhw-pwa-offline', '.rhw-pwa-panel', 'env(safe-area-inset-bottom)',
        'min-height: 44px', 'min-height: 48px', '@media (display-mode: standalone)'
    ), 'PR4 installable app presentation')
    require_tokens(errors, 'sw.js', (
        'CACHE_PREFIX', 'APP_SHELL', "request.method !== 'GET'", 'networkFirst', 'cacheFirst',
        "event.data?.type === 'SKIP_WAITING'", 'self.skipWaiting()', 'keys.filter',
        'if (!response.ok) throw new Error(`NETWORK RESPONSE ${response.status}`)'
    ), 'PR4 service worker')
    service_worker = (ROOT / 'sw.js').read_text(encoding='utf-8')
    css_names_match = re.search(r'const CSS_NAMES\s*=\s*\[(.*?)\];', service_worker, flags=re.S)
    cached_css_names = re.findall(r"'([^']+)'", css_names_match.group(1)) if css_names_match else []
    expected_cached_css_names = [Path(ref).stem.split('-', 1)[1] for ref in [*parser.css, *(item for item in V4_RUNTIME_ASSETS if item.endswith('.css'))]]
    if cached_css_names != expected_cached_css_names:
        errors.append('Service-worker CSS cache order differs from the deployed stylesheet order.')
    for ref in [*parser.js, *(item for item in V4_RUNTIME_ASSETS if item.endswith('.js') and '/recipes/' not in item)]:
        if ref not in service_worker:
            errors.append(f'Service worker does not cache deployed JavaScript asset: {ref}')
    require_tokens(errors, 'js/24-app-v40-newswire-2.js', (
        'v40NewswireControlCenter', 'v40NewswireSearch', 'data-newswire-status',
        'auditEntries', 'DUPLICATE BULLETIN', 'pinToTop', 'buildForumBbcode',
        'v40NewswireChannelPreview', 'v40News2OutputGate', 'app.newswire2'
    ), 'PR5 Newswire 2.0 runtime')
    require_tokens(errors, 'css/28-app-pr5-newswire-2.css', (
        '.v40-news2-control', '.v40-news2-metrics', '.v40-news2-channel-grid',
        '[data-news2-visible="false"]', 'min-height: 44px', '@media (max-width: 390px)'
    ), 'PR5 Newswire 2.0 presentation')
    require_tokens(errors, 'js/25-app-v40-discovery-status.js', (
        'discoveryDataStatus', 'CHECK LATEST RUN', 'OPEN SYNC CONTROL', 'VIEW CHANGE REPORT',
        'REVIEWED BRANCH / DRAFT PR · AUTO-MERGE DISABLED', 'app.discoveryStatus', 'checkLatestRun', 'selfTest'
    ), 'PR6 Discovery status runtime')
    require_tokens(errors, 'css/29-app-pr6-discovery-sync.css', (
        '.discovery-data-panel', '.discovery-data-grid', '.discovery-data-actions',
        '.discovery-source-details', 'min-height:44px', 'min-height:48px', '@media(max-width:560px)'
    ), 'PR6 Discovery status presentation')
    require_tokens(errors, 'js/26-app-v40-diagnostics.js', (
        'RHW SYSTEM CHECK', 'RUN SELF-CHECK', 'COPY REPORT', 'PRIVACY:',
        'storageHealth', 'telemetryHealth', 'catalogHealth', 'app.diagnostics', 'selfTest'
    ), 'PR7 reliability diagnostics runtime')
    require_tokens(errors, 'css/30-app-pr7-diagnostics.css', (
        '.rhw-diagnostics-button', '.rhw-diagnostics-overlay', '.rhw-diagnostics-grid',
        '.rhw-diagnostics-actions', 'min-height:44px', 'min-height:48px', '@media(max-width:460px)'
    ), 'PR7 reliability diagnostics presentation')
    require_tokens(errors, '.github/workflows/discovery-catalog-sync.yml', (
        'schedule:', 'workflow_dispatch:', 'pull-requests: write', 'sync_discovery_catalog.py',
        '--force-with-lease', 'gh pr create', '--draft', 'steps.delta.outputs.changed'
    ), 'PR6 Discovery sync workflow')
    require_tokens(errors, 'scripts/sync_discovery_catalog.py', (
        'DEFAULT_SOURCE_BASES', 'validate_catalog', 'large_change_errors', 'catalog_diff',
        'TemporaryDirectory', 'autoMerge', 'Human review is required'
    ), 'PR6 Discovery sync engine')

    discovery_status = json.loads((ROOT / 'assets/discovery-status.json').read_text(encoding='utf-8'))
    if discovery_status.get('schemaVersion') != 1:
        errors.append('Discovery status schemaVersion must be 1.')
    if discovery_status.get('workflow', {}).get('reviewRequired') is not True or discovery_status.get('workflow', {}).get('autoMerge') is not False:
        errors.append('Discovery status must require review and explicitly disable auto-merge.')
    effective = discovery_status.get('catalog', {}).get('effective', {})
    if not all(isinstance(effective.get(key), int) and effective[key] > 0 for key in ('recipes', 'products', 'factions')):
        errors.append('Discovery status must publish positive effective recipe, product and IFF counts.')
    catalog_meta = read_catalog(ROOT / 'assets' / 'recipes').get('meta', {})
    status_raw = discovery_status.get('catalog', {}).get('raw', {})
    expected_raw = {
        'recipes': catalog_meta.get('recipeCount'),
        'products': catalog_meta.get('productCount'),
        'factions': catalog_meta.get('factionCount'),
    }
    if status_raw != expected_raw:
        errors.append(f'Discovery status raw counts differ from the generated catalog: {status_raw!r} != {expected_raw!r}.')
    if discovery_status.get('source', {}).get('sha256') != catalog_meta.get('sourceSha256'):
        errors.append('Discovery status source hashes differ from the generated catalog metadata.')

    manifest = json.loads((ROOT / 'manifest.webmanifest').read_text(encoding='utf-8'))
    expected_manifest = {'id': './', 'start_url': './#command/overview', 'scope': './', 'display': 'standalone'}
    for key, value in expected_manifest.items():
        if manifest.get(key) != value:
            errors.append(f'PWA manifest {key} must be {value!r}, got {manifest.get(key)!r}.')
    purposes = {icon.get('purpose') for icon in manifest.get('icons', [])}
    sizes = {icon.get('sizes') for icon in manifest.get('icons', [])}
    if 'maskable' not in purposes or not {'192x192', '512x512'} <= sizes:
        errors.append('PWA manifest must include 192px, 512px and maskable icons.')
    expected_png_sizes = {
        'assets/favicon.png': (64, 64), 'assets/apple-touch-icon.png': (180, 180),
        'assets/pwa-icon-192.png': (192, 192), 'assets/pwa-icon-512.png': (512, 512),
        'assets/pwa-icon-maskable-512.png': (512, 512),
    }
    for asset, expected_size in expected_png_sizes.items():
        if png_size(ROOT / asset) != expected_size:
            errors.append(f'PWA image has the wrong dimensions: {asset} must be {expected_size[0]}x{expected_size[1]}.')
    require_tokens(errors, 'scripts/smoke_v402.py', (
        'MOBILE_WIDTHS = (360, 390, 412, 430)', 'test_boot_failure',
        'test_backup_and_storage', 'test_mobile_forum_controls', 'test_pr3_decision_ui',
        'test_pr3_calculator_ui', 'test_pr3_comms_workflow', 'test_pr4_pwa', 'test_pr5_newswire2',
        'test_pr6_discovery_status', 'test_pr7_diagnostics', 'test_pr8_production_orders',
        'test_pr9_transfer_center', 'test_pr10_newswire_review', 'test_pr11_full_audit',
        'v40NewswireRecoveryState',
        'RHWV4.newswireOrdering.setFilter', 'take_runtime_failures'
    ), 'V4.0.2 + PR1 browser smoke')
    require_tokens(errors, 'scripts/smoke_v40_base.py', (
        'Promise.resolve(', 'awaitPromise', 'JSON.stringify(value)'
    ), 'Browser smoke async evaluation')
    require_tokens(errors, 'js/17-app-v40-operations-core.js', (
        'app.operationsCore', 'loadCatalog', 'buildPlan', 'factorFor', 'authorizedFor',
        'RESTRICTED RECIPE REQUIRES AN AUTHORIZED IFF', 'outputPerCycle: rootOutputPerCycle'
    ), 'V4 OPERATIONS planner')
    require_tokens(errors, 'js/18-app-v40-operations-ui.js', (
        'ITEM CALCULATOR', 'SEARCH RECIPE', 'PRICE / UNIT', 'TARGET PROFIT MARGIN', 'materialPrices',
        'NO MATCHING RECIPE', 'core.priceQuote(rows, calc, plan)', 'AUTHORIZED IFF', 'RESTRICTED RECIPE',
        'installShipyardBridge', 'PRICE 1 HULL', 'ops-mobile-decision',
        'data-ops-quantity', 'data-ops-jump', 'opsMobileSellUnit'
    ), 'V4 OPERATIONS UI')
    require_tokens(errors, 'js/19-app-v40-runtime.js', (
        'workspaceOperations', 'operations-calculator', '__RHW_V4_SMOKE__', 'app.commsSafety?.init()',
        'app.discoveryStatus?.init()', 'app.diagnostics?.init?.()', 'app.fullAudit?.init?.()', 'app.runtime'
    ), 'V4 runtime')
    require_tokens(errors, 'js/27-app-v40-production-orders.js', (
        'PRODUCTION ORDER BOARD', 'productionOrders', 'buildReport', 'buildBbcode',
        'AGGREGATED DIRECT MATERIALS', 'AWAITING VERIFIED STOCK', 'data-order-priority', 'app.productionOrders'
    ), 'PR8 production order board')
    require_tokens(errors, 'css/31-app-pr8-production-orders.css', (
        '.production-orders-dashboard', '.production-order-card', '.production-material-row',
        '.production-forum-document', 'min-height: 44px', '@media (max-width: 390px)'
    ), 'PR8 production order presentation')
    require_tokens(errors, 'scripts/test_production_orders.js', (
        'Shared steel must aggregate across orders', 'Urgent order must sort first',
        'Unverified stock must stay unknown', 'Import must merge instead of deleting current orders'
    ), 'PR8 production order model tests')
    require_tokens(errors, 'js/28-app-v40-transfer-center.js', (
        'CROSS-DEVICE TRANSFER CENTER', 'navigator.canShare', 'previewFile', 'confirmImport',
        'IMPORT SELECTED SECTIONS', 'app.transferCenter'
    ), 'PR9 cross-device transfer center')
    require_tokens(errors, 'css/32-app-pr9-transfer-center.css', (
        '.rhw-transfer-center', '.rhw-transfer-dialog', '.rhw-transfer-section',
        'min-height: 44px', '@media (max-width: 390px)'
    ), 'PR9 transfer presentation')
    require_tokens(errors, 'scripts/test_transfer_center.js', (
        'V4 inspection', 'selective import', 'safe merge', 'explicit replacement'
    ), 'PR9 transfer model tests')
    require_tokens(errors, 'js/29-app-v40-newswire-review.js', (
        'NEWSWIRE REVIEW DESK', 'diffEntries', 'buildReviewPackage', 'navigator.canShare',
        'humanReviewRequired: true', 'directPublish: false', 'app.newswireReview'
    ), 'PR10 Newswire review desk')
    require_tokens(errors, 'css/33-app-pr10-newswire-review.css', (
        '.v40-newswire-review', '.v40-newswire-change', '.v40-newswire-history',
        'min-height: 44px', '@media (max-width: 390px)'
    ), 'PR10 Newswire review presentation')
    require_tokens(errors, 'scripts/test_newswire_review.js', (
        'One bulletin must be reported as added', 'Package summary must include edits',
        'Forum parity', 'Version history must be capped locally'
    ), 'PR10 Newswire review model tests')
    require_tokens(errors, 'js/30-app-v40-full-audit.js', (
        'FULL APP AUDIT', 'EXPECTED_ROUTES', 'ROUTE TOPOLOGY', 'DOM IDENTITY + LINKS',
        'TOUCH TARGETS', 'FORUM BB CODE', 'NEWSWIRE CHANNELS', 'PRICE CHECK',
        'PRIVACY: This audit uses synthetic markers', 'app.fullAudit'
    ), 'PR11 full app audit runtime')
    require_tokens(errors, 'css/34-app-pr11-full-audit.css', (
        '.rhw-full-audit', '.rhw-full-audit-result', 'min-height:44px', 'min-height:48px',
        '@media(max-width:390px)', '@media(prefers-reduced-motion:reduce)'
    ), 'PR11 full app audit presentation')
    require_tokens(errors, 'scripts/test_full_audit.js', (
        'Route model must cover all 11 app destinations', 'Summary must separate pass, notice and fail states',
        'Audit report must not introduce user content'
    ), 'PR11 full app audit model tests')
    require_tokens(errors, 'scripts/build_recipe_catalog.py', (
        "parser.add_argument('--chunks'", 'def write_catalog(', 'chunk_count = max(1, int(chunk_count))',
        "if ''.join(chunks) != encoded", 'def read_catalog('
    ), 'Recipe catalog builder')
    for idx in range(1, 7):
        require_tokens(errors, f'assets/recipes/catalog-v1-part-{idx:02d}.js', ('__RHW_RECIPE_CATALOG_GZIP_BASE64__',), f'V4 recipe catalog chunk {idx}')

    command_ui = (ROOT / 'js/15-app-v40-navigation.js').read_text(encoding='utf-8')
    if 'window.RECIPES' in command_ui or 'window.CAPITAL_SHIPYARD' in command_ui:
        errors.append('V4 COMMAND must not probe stable lexical const values through window.*.')

    operations_ui = (ROOT / 'js/18-app-v40-operations-ui.js').read_text(encoding='utf-8')
    if 'RECIPE VARIANT' in operations_ui:
        errors.append('V4 Item Calculator must not expose the obsolete RECIPE VARIANT control.')
    if 'ALTERNATIVE INPUTS' in operations_ui or '.ops-alternatives' in operations_ui:
        errors.append('V4 Item Calculator must not expose alternative-input routing in simple costing mode.')

    operations_css = (ROOT / 'css/16-app-v40-operations.css').read_text(encoding='utf-8')
    if re.search(r'(^|})\.(good|warn)\{', operations_css):
        errors.append('V4 OPERATIONS status colors leak through unscoped global .good/.warn selectors.')

    if (ROOT / 'js/17-app-v40-audit.js').exists():
        errors.append('Obsolete duplicate V4 runtime file js/17-app-v40-audit.js must not be present.')

    for path in (
        'js/13-app-v40.js', 'js/14-app-v40-cache.js', 'js/15-app-v40-navigation.js',
        'js/16-app-v40-composer.js', 'js/16a-app-v40-comms-safety.js', 'js/17-app-v40-operations-core.js',
        'js/18-app-v40-operations-ui.js', 'js/19-app-v40-runtime.js'
    ):
        text = (ROOT / path).read_text(encoding='utf-8')
        if 'BaseApply' in text or 'BaseActivate' in text or 'const v40Base' in text:
            errors.append(f'V4 module still contains legacy override-chain hooks: {path}')

    if 'catalogAsset:' in app_config:
        errors.append('V4 configuration must not reference the removed single-file recipe catalog asset.')

    core_text = (ROOT / 'js/13-app-v40.js').read_text(encoding='utf-8')
    if "document.execCommand?.('copy') !== false" in core_text:
        errors.append('Clipboard fallback must not report success when document.execCommand is unavailable.')

    require_tokens(errors, 'js/20-app-v402-fixes.js', (
        'v40OverviewTelemetryState', "'CACHE TELEMETRY'", 'window.telemetrySnapshot()',
        'price per unit', 'Generated Newswire source block', 'Updated RHW Newswire Markdown source'
    ), 'V4.0.2 runtime fixes')
    require_tokens(errors, 'js/03-telemetry.js', (
        'NO VERIFIED CACHE AVAILABLE // WAITING FOR FIRST SUCCESSFUL SYNC',
    ), 'Telemetry cache fallback')
    require_tokens(errors, 'css/19-app-v402-fixes.css', (
        '@media (max-width: 700px)', '.crest-frame.crest-fallback::after', 'width: 72px', 'height: 72px',
        '.command-overview-live[data-state="stale"]', '.command-overview-live[data-state="offline"]'
    ), 'V4.0.2 presentation fixes')

    index_text = INDEX.read_text(encoding='utf-8')
    for token in ('rel="manifest" href="./manifest.webmanifest"', 'name="theme-color"',
                  'name="mobile-web-app-capable"', 'rel="apple-touch-icon"', 'src="./assets/rhw-crest.png"'):
        if token not in index_text:
            errors.append(f'index.html PWA metadata is incomplete: {token}')
    title_match = re.search(r'<title>(.*?)</title>', index_text, flags=re.I | re.S)
    if not title_match or title_match.group(1).strip() != 'RHW COMMAND':
        errors.append('index.html must use the stable RHW COMMAND browser title.')

    build_info = (ROOT / 'js/build-info.js').read_text(encoding='utf-8')
    if not re.search(r"revision:\s*'[^']+'", build_info) or 'window.RHW_BUILD?.revision' not in bootstrap or 'self.RHW_BUILD.revision' not in (ROOT / 'sw.js').read_text():
        errors.append('Page assets and service-worker cache must use the shared build revision.')

    readme = (ROOT / 'README.md').read_text(encoding='utf-8')
    if f'# Resolution Heavy Works Web App - {version}' not in readme or f'{version} is the current RHW web app release.' not in readme:
        errors.append(f'README release metadata does not match current app version {version}.')
    if '.github/workflows/rhw-pages-deploy.yml' not in readme:
        errors.append('README deployment documentation does not name the active workflow.')

    if errors:
        for message in errors:
            print(f'ERROR: {message}', file=sys.stderr)
        return 1

    print(
        f'RHW validation passed: {len(parser.css)} static stylesheets, {len(parser.js)} static scripts, '
        f'{len(V4_RUNTIME_ASSETS)} V4 runtime assets, {len(parser.ids)} unique static ids; app version {version}.'
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
