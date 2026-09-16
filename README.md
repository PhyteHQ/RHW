# Resolution Heavy Works Web App - V4.0.2

V4.0.2 is the current RHW web app release.

**Canonical repository:** `PhyteHQ/RHW`  
**Canonical web app:** `https://phytehq.github.io/RHW/`

The app is split into four visible workspaces:

- **COMMAND** — Inventory, Shipyard, Production and Logistics.
- **CALCULATOR** — recipe-first manufacturing calculator, backed by Discovery's public game configuration.
- **PRICE CHECK** — twelve fixed procurement routes, RHW payout comparison and manual source prices.
- **FORUM** — forum transmission composer. Drafts, sender profiles and system checks are available through **TOOLS**.

`CALCULATOR / ITEM CALCULATOR` contains the validated current catalog of **290 recipes / 251 build targets**. It supports recipe search, distinct recipe-variant labels, output quantity, BMM-default IFF handling, affiliation-dependent outputs, manual material prices for the current calculation, fixed recipe fees where defined, batch build cost, cost per unit, target profit margin, recommended sale price, revenue and profit. Optional **PRICE PROFILES** can be saved explicitly in the browser and loaded on demand; they are never applied automatically.

**COMPARE VARIANTS** compares recipes producing the same actual item for the selected IFF, using one shared material-price map and the same requested quantity. It shows whole-batch output, surplus, material costs, fees, batch cost and cost per produced unit. Enter an assigned value for self-mined ore, including an explicit $0; blank prices remain unknown. The cheapest unit cost is highlighted only when all available variants are fully priced. **USE VARIANT** retains those prices, quantity and IFF; selecting an unrelated recipe starts fresh. Retained catalysts and byproducts are shown in Recipe Notes and are not deducted from costs; alternative input groups use the calculator’s default first option.

**FIND SELLERS** on missing Production inputs and Shipyard components opens the exact existing Logistics offer channel, including its stock, reserve and freshness information. Mining ores do not receive purchasing prompts. These shortcuts do not create orders or change prices or inventory.

Production-order tracking has been retired. Old order URLs redirect to the Calculator, and historical order data remains available to the backup compatibility layer. The multi-hull Shipyard planner is also retired; archived planner data remains compatible with private backups.

The **DISCOVERY DATA** panel shows the active counts, source hashes, last catalog update and latest automation run. `.github/workflows/discovery-catalog-sync.yml` checks Discovery's public recipe CFG files every Monday and can also be started manually from GitHub Actions. Downloads are staged temporarily and must pass structural, ID/output/quantity/IFF and large-change gates. Real changes rebuild the deterministic browser catalog and prepare or refresh a **Draft pull request** with `docs/discovery-sync-report.md`; the workflow never merges its own proposal. If repository policy prevents automatic PR creation, the validated branch and a review link remain available and the run explains that manual review is required. No repository permissions are changed.

`COMMAND / SHIPYARD` shows hull availability, component reserves and readiness. Each supported hull can open the Calculator through **PRICE 1 HULL**. There is no separate multi-hull planner.

Newswire has been retired from the dashboard, Tools, routes and normal app boot. Old Newswire links redirect to Forum. Archived working copies remain optional sections of private backups; no bulletin editor or remote Newswire fetch starts with the app.

`COMMS / DRAFTS` contains the private **DEVICE TRANSFER** center. On supported phones, **SHARE PRIVATE BACKUP** opens the native Android or iOS share sheet with one JSON file; otherwise RHW downloads the same file. Import never uploads anything and always opens a review sheet first. Drafts, senders and price profiles use conflict-safe merge mode. Format V5 also includes Price Check overrides with validated, explicit merge; archived order data remains optional for old backups, while the current message, archived Shipyard plan, Newswire working copy and app settings are explicit opt-in replacements. Backup files can contain private work and should only be shared with a trusted device.

## Install on Samsung, Android or iPhone / iPad

Open **`https://phytehq.github.io/RHW/`** in the browser you want to use for installation.

RHW is an installable Progressive Web App. In Samsung Internet, tap the menu (☰), then choose **Add page to → Home screen**. In Chrome for Android, open the menu (⋮) and choose **Install app** or **Add to Home screen**. On iPhone or iPad, open RHW in Safari, tap **Share**, then choose **Add to Home Screen**. A successful installation launches RHW in a dedicated app window without normal browser tabs or the address bar; the operating-system status bar can remain visible.

The app bundles, local fonts, icons and recipe catalog are cached together for offline access. RHW always labels offline mode clearly and never presents failed live telemetry as current data. New service-worker versions are checked automatically. An update waits for the explicit **UPDATE NOW** action before activating and reloading, preserving an in-progress calculation.

### Migration from the old `rhw-0` GitHub username

The repository was renamed from `rhw-0/RHW` to `PhyteHQ/RHW`. GitHub may redirect old repository links, but the installed PWA and browser-local data are origin-bound. Before removing an RHW installation created from `rhw-0.github.io`, open **COMMS → DRAFTS → SHARE PRIVATE BACKUP** and save the JSON backup. Then install RHW from `https://phytehq.github.io/RHW/` and import that backup through the Device Transfer review flow. This preserves drafts, senders, price profiles, production orders and other opted-in local state across the domain change.

**TOOLS → SYSTEM + DATA** contains the system check and repeatable **FULL APP AUDIT**. The audit distinguishes nine mounted public destinations from navigation behavior, which is tested in the browser suite. It also checks UI state, accessibility, modal safety, viewport fit, touch targets, reduced motion, local storage, PWA support, catalog truth, synthetic Forum output parity and the Price Check contract. Both copyable reports are content-free: they never include drafts, messages, sender profiles, material prices or inventory values. Damaged RHW JSON cache entries are backed up under a recovery key before the affected entry is reset. See [the audit contract](docs/full-app-audit.md).

Validation runs through `.github/workflows/rhw-pages-deploy.yml`: generated-asset, content-revision, route, lifecycle, structural and syntax checks; catalog/quote/backup models; legacy archive compatibility; route and interaction smoke tests; and the exact deploy payload served with its local fonts and service worker. The interface check covers nine viewport widths, keyboard-sized mobile space, retired-route redirection and offline reloads including Forum imagery. Review screenshots are uploaded as CI artifacts. Only the retained legacy backup contract is tested; retired editor models are removed.

## Application structure

`scripts/runtime-assets.json` owns the source order; `scripts/app-routes.json` owns public routes and legacy redirects. Run `python3 scripts/build_app_assets.py` after source edits; CI rejects stale outputs with `--check`. A content hash automatically versions the HTML, bundles and service-worker cache. No manual revision bump is needed. `--check --dist` packages only runtime files and font licenses; Pages publishes `dist/`. The browser requests one stylesheet and four scripts. Do not edit generated bundles, route/build metadata or the offline shell directly.

JavaScript is organized into `core`, `command`, `calculator`, `price-check`, `forum`, `data`, `tools` and `shared`. Named, ordered lifecycle hooks replace cross-module method overrides. CSS is consolidated into nine responsibility-based stages, from palette/foundations through workspace controls, tools, theme, HUD layout and recipe comparison. Edit the owning stage instead of adding another PR/fix stylesheet. Font files and licenses are in `assets/fonts`. See [the architecture and ownership map](docs/runtime-structure.md).

`RHWV4.onUiUpdate` coalesces status work; scoped render hooks update only the affected workspace. Hidden/offline pages pause automatic network refreshes and refresh once due. Price Check refreshes only in its active workspace. `js/data/legacy-archive.js` preserves old backups without loading the former board. Removed editor source and obsolete audit snapshots remain recoverable in Git history.

## Industrial identity and September audit

The interface follows the RHW crest: neutral charcoal surfaces, gold navigation, silver accents and industrial frames. Metals use Au/Nb marks, ores have compact input panels, and Prototype Components use a steel/gold supplier ledger. Status colours describe actual data states; no offers is neutral. The browser title stays **RHW COMMAND**. Desktop/mobile readability, reduced-motion and low-effects behavior are preserved.

Calculator search ranks exact product names before substrings, preserves input on same-recipe searches and starts a new recipe with blank prices and BMM. Price Check records per-route timestamps, distinguishes cached prices, clears quotes missing from successful responses and retries unresolved sources. The backup format is V5, with V1–V4 import compatibility.
