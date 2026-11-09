# RHW interface style

Shared values live in `css/tokens.css`. Edit the owning theme/layout/component
sources and regenerate assets with `python3 scripts/build_app_assets.py`.

- Barlow Condensed: page titles (28 px), panel titles (24 px) and product/hull
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
  keep their distinct, compact treatment.

The Status Board uses three independent operational stacks on wide screens:
Maintenance/Waste, Production Reserves and Exports/Ship Stock. It switches to
two columns on tablets and one on phones, without CSS visual reordering that
would disagree with keyboard or screen-reader order.

The packaged interface suite exercises all workspaces at phone, tablet and
desktop widths. Inventory tests additionally check that Waste and Ship Stock
sit directly under their own panels regardless of reserve height.
