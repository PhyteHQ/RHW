# RHW interface style

Shared values live in `css/tokens.css`. Edit the owning theme/layout/component
sources and regenerate assets with `python3 scripts/build_app_assets.py`.

- Teko: page titles (28 px), panel titles (24 px) and product/hull
  names (22 px). Branding and the generated forum document retain their own
  identity hierarchy.
- Barlow: interface labels, actions and explanatory copy. Small utility copy
  stays readable in System + Data, catalog details and Backup + Drafts.
- Share Tech Mono: stock, monetary amounts, cycle quantities and technical IDs.
- Gold marks navigation, selected controls and primary actions. Green, amber
  and red retain their ready, warning and critical meanings.
- Cards use the same dark surfaces, restrained borders, 2 px corners and shared
  shadows. Panel spacing is 16 px; inner card spacing is 12 px.
- Primary controls have 44 px targets. Compact production actions may use
  36 px on desktop and expand to 44 px on phones. Inline stock links and icons
  keep their distinct, compact treatment. Utility-dialog actions retain their
  larger 48 px phone targets.

The Status Board uses three independent operational stacks on wide screens:
Maintenance/MOX Feedstock, Production Reserves and Exports/Ship Stock. It switches to
two columns on tablets and one on phones, without CSS visual reordering that
would disagree with keyboard or screen-reader order.

The packaged interface suite exercises all workspaces at phone, tablet and
desktop widths. Inventory tests additionally check that MOX Feedstock and Ship Stock
sit directly under their own panels regardless of reserve height.

Desktop navigation is one persistent 216 px sidebar. Overview, Production,
Shipyard and Logistics remain visible on every route; Calculator, Price Check
and Forum follow them. At 1100 px and below the four daily destinations share
one sticky row and secondary destinations move into Tools. Navigation buttons
use pressed/current semantics; the inner Inventory and Logistics view switches
remain real tablists. Desktop scroll offsets are independent of sidebar height.

The masthead carries the full RHW identity: company line, large crest, wordmark
and facility name. Wide desktop layouts center a 170 × 206 px crest; phones
keep a 74 × 96 px crest beside the branding. Structural integrity, credits, free
storage, Trade Desk, Refresh and connection details retain a fixed hierarchy. Overview previews the top two
priorities inline, including exact shortage sourcing actions. Expanding shows
all priorities and the attention filter; filtering never hides navigation.

Production is a comparison list with stock, material-covered output and the
limiting input. Details use one native modal: a right-side panel on desktop and
a bottom sheet on phones. Recipe timing, materials, byproducts and reusable
prerequisites share that surface with material connections and TW conversion.
Stock refreshes preserve the selected item; Escape restores the original action.
Nested Trade Desk dialogs return focus to their material trigger.

All nine public routes have one shared page heading and description, followed by
the same component scale. Shipyard uses compact division tabs, selection cards,
material metrics and prerequisite panels. Logistics and Price Check share neutral
frames and table headers; sign colors continue to describe real data. Calculator
uses the same form controls, summary strips, quote flow and comparison surfaces.
Forum editor, generated-code controls, drafts, sender cards and their editor use
readable Barlow labels and common actions. The actual forum document keeps its
own communication design. Tools, Backup, System and Discovery use matching inner
cards and separators, rather than only matching outer dialog backgrounds.

Layout responds to available workspace width: Calculator and Forum use container
queries so the desktop sidebar cannot squeeze their columns. The packaged browser
suite covers every public route at nine widths, including Backup and Senders.
