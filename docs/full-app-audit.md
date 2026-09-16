# RHW Full App Audit

TOOLS → SYSTEM + DATA contains a repeatable, content-free audit.
RUN FULL AUDIT refreshes the report for the current browser, viewport and data state.

## What the report proves

The route-topology check reports **nine mounted public destinations** from
`scripts/app-routes.json`: Inventory, Shipyard, Production, Logistics, Calculator,
Price Check, Forum, Drafts and Senders. It does not count the hidden Overview
status sensor and does not claim that merely mounted panels prove navigation.
Actual route activation, visibility and legacy redirects are tested by the
headless browser suite.

Other checks cover active-route consistency, module contracts, duplicate DOM
IDs, ARIA references, accessible control names, modal focus, viewport overflow,
touch targets, reduced motion, local-save readback, PWA support and catalog
provenance. Synthetic Forum data verifies BBCode/preview parity; Price Check
is checked for its current route and data contract.

Reports never copy saved drafts, real messages, sender profiles, material prices
or inventory values. Backup compatibility is tested separately and does not
require a retired Newswire editor or Production Order board.

## Automated coverage

`scripts/smoke_v40.py` consumes the same public-route and runtime-asset manifests
as the application. Its workflow helpers are in `smoke_workflows.py`; there are
no private asset injection lists or special Overview navigation exceptions.

The browser suite checks real Tools entry points, Inventory keyboard tabs,
Calculator quotes/recipes, Forum formatting and private transfer flows at
360/390/412/430 px. The bundled-site suite additionally serves the exact Pages
payload, covers nine widths up to 1920 px and reloads offline with local fonts
and Forum imagery. Controlled data fixtures keep these checks deterministic;
live Discovery/API availability is a separate concern.

The dependency-free model checks cover all buildable catalog recipes, quote
rounding/fees, per-route price freshness and direction, conflict-safe backups,
legacy archives, router redirects, named lifecycle order and PWA release hashing.
