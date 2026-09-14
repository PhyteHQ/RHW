# RHW runtime and interface ownership

RHW stays a static application. `scripts/runtime-assets.json` is the authoritative
source order; `python3 scripts/build_app_assets.py` regenerates the three bundles,
asset metrics, HTML revision references and offline shell. CI rejects stale output.
There are no new production dependencies.

## UI changes

- Shared colours, type scales and spacing belong in `css/01-core.css`.
- Base component rules stay with their existing component stylesheets.
- The current interface is split into `css/interface/00-component-extensions.css`,
  `10-console-foundation.css`, `20-hud-layout.css` and `30-recipe-comparison.css`.
  Their manifest order preserves the established cascade. Edit the owning rule;
  do not append a new release-wide override file or inject styles from JavaScript.
- The runtime cleanup removed 176 exactly shadowed declarations and 97 selectors
  belonging exclusively to the retired Newswire. Shared selectors were preserved.
- Browser integration checks cover the full generated stylesheet and local fonts,
  including 360–1920 px layouts, keyboard-sized viewports and offline reloads.

## Rendering and background work

`js/00-runtime.js` owns scoped render subscriptions and refresh scheduling.
A renderer calls `rendered(view)` after its DOM update. `onRender(view, callback)`
returns an unsubscribe function. Current owners emit `workspace`, `calculator`,
`pricing`, `production`, `shipyard`, `marketScanGrid`, `materialsScanGrid`,
`forum-preview` and `discovery`. Subscribers enhance only the affected surface;
they must not invoke the same renderer recursively.

The app's coalesced `onUiUpdate` handles shared status/navigation changes.
It does not replace focused inputs. Price Check updates data cells while retaining
the original input node, so typing and focus survive a completed market request.
The shared router also canonicalizes old or invalid Price Check hashes.

`createRefreshTask` keeps one due time and one in-flight promise per resource.
Hidden or offline documents have no automatic refresh timers. Returning to the
page performs one overdue refresh, without replaying missed intervals. Manual
refreshes share an in-flight request and reset the due time on completion.

- Price Check: five minutes, only after opening its visible workspace.
- PWA update checks: hourly while visible and online. Registration performs the
  initial check; installing an update still requires the existing UPDATE NOW action.
- Main telemetry: its existing due-time scheduler also pauses offline and hidden.
- Discovery automation status: checked with CHECK LATEST RUN; startup reads the
  bundled catalogue status without requesting GitHub automation/proposal data.

Timers for fetch timeouts, debounced search/autosave and temporary feedback remain
intentional. Resize/Intersection observers measure the HUD and visible clock;
the temporary PWA shell observer disconnects as soon as its install control mounts.
Historical editors/models remain outside the production manifest where backup
compatibility and archived model tests still use them. No Newswire, stock targets
or build tracking is reintroduced.

Run `node scripts/test_runtime_lifecycle.js` for lifecycle checks. The browser
integration test additionally checks a focused Price Check field across refresh,
valid zero overrides, canonical routes and the absence of empty injected styles.
