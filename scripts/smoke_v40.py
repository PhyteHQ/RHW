#!/usr/bin/env python3
"""Canonical RHW V4 smoke entry point.

Legacy interaction helpers remain in smoke_v40_base.py. The V4.0.2 production
runner composes those helpers with the exact deployed asset order and current
regression / quality-of-life coverage.
"""
import time

import smoke_v40_base as _base
from smoke_v40_base import *  # noqa: F401,F403

APP_LAYER_ASSETS = [
    "js/31-app-command-rework.js",
    "js/32-app-unified-workspaces.js",
    "js/33-app-ui-polish-fix.js",
    "js/34-app-stability-polish.js",
    "js/35-app-command-compact-polish.js",
    "js/36-app-focus-pass.js",
    "js/37-app-price-check.js",
]


def _ensure_app_layer_assets() -> None:
    """Keep every smoke consumer aligned with the deployed UI layers."""
    for asset in APP_LAYER_ASSETS:
        if asset in _base.V4_JS:
            continue
        runtime_index = _base.V4_JS.index("js/19-app-v40-runtime.js") if "js/19-app-v40-runtime.js" in _base.V4_JS else len(_base.V4_JS)
        _base.V4_JS.insert(runtime_index, asset)
    globals()["V4_JS"] = _base.V4_JS


_ensure_app_layer_assets()


if __name__ == '__main__':
    import smoke_v402 as _v402

    # smoke_v402 composes its own production-order list during import.
    _ensure_app_layer_assets()

    # DATA STATUS is now intentionally secondary. Keep the original Discovery
    # coverage, but reach it through the same TOOLS action a real user uses.
    _legacy_discovery_test = _v402.test_pr6_discovery_status

    def _focused_discovery_test(cdp, workspace, node):
        if (workspace, node) == ("operations", "calculator"):
            _base.ev(cdp, "(()=>{RHWV4.focusPass?.openTool?.('data');return true;})()")
            time.sleep(.18)
        try:
            return _legacy_discovery_test(cdp, workspace, node)
        finally:
            _base.ev(cdp, "(()=>{RHWV4.diagnostics?.close?.();return true;})()")

    _v402.test_pr6_discovery_status = _focused_discovery_test

    # SYS CHECK moved out of the daily header and into TOOLS. The legacy PR7
    # test still validates the original button contract, so expose that anchor
    # off-canvas only for this legacy check. The new Focus Pass smoke verifies
    # the actual user path through TOOLS -> SYSTEM CHECK.
    _legacy_diagnostics_test = _v402.test_pr7_diagnostics

    def _focused_diagnostics_test(cdp, workspace, node):
        if (workspace, node) == ("command", "overview"):
            _base.ev(cdp, """(()=>{let s=document.getElementById('rhwLegacyDiagnosticsSmokeStyle');if(!s){s=document.createElement('style');s.id='rhwLegacyDiagnosticsSmokeStyle';s.textContent='html.rhw-focus-pass #rhwDiagnosticsBtn{display:block!important;position:fixed!important;left:-9999px!important;top:0!important;min-height:44px!important}';document.head.appendChild(s);}return true;})()""")
        return _legacy_diagnostics_test(cdp, workspace, node)

    _v402.test_pr7_diagnostics = _focused_diagnostics_test

    # The legacy mobile Forum test predates the Focus Pass and requires the old
    # context-navigation slot to consume 44px. Daily FORUM intentionally removes
    # that subnav. Preserve all legacy Forum preview/BBCode/touch checks while
    # providing only the obsolete height contract during this one legacy test.
    _legacy_mobile_forum_test = _v402.test_mobile_forum_controls

    def _focused_mobile_forum_test(cdp):
        _base.ev(cdp, """(()=>{let s=document.getElementById('rhwLegacyForumContextSmokeStyle');if(!s){s=document.createElement('style');s.id='rhwLegacyForumContextSmokeStyle';s.textContent='html.rhw-focus-pass body[data-workspace="comms"] #appContextNavSlot{display:block!important;min-height:44px!important;height:44px!important}';document.head.appendChild(s);}return true;})()""")
        try:
            return _legacy_mobile_forum_test(cdp)
        finally:
            _base.ev(cdp, "(()=>{document.getElementById('rhwLegacyForumContextSmokeStyle')?.remove();return true;})()")

    _v402.test_mobile_forum_controls = _focused_mobile_forum_test
    raise SystemExit(_v402.main())