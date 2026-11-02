# Inventory roles and production links

The Status Board has three columns: Facility Maintenance (Basic Alloy, Consumer
Goods, Food Rations), Production Reserves (Gold Supply, Niobium, Prototype
Components), and Export Inventory (Chambers, Reactors, Superstructures). Waste
and a compact Ship Stock list follow. Tablets stack the export panel below the
first two columns; phones use the same reading order in one column.

Gold Supply is an additive Gold / Wildcat Gold pool. Its breakdown preserves
the individual stocks; Full Manifest continues to list every original item.
An absent alternative contributes zero only when another pool member is
reported. Malformed reported stock, or a wholly unreported pool, stays unknown.
Neither the pool nor role assignment modifies API stock, prices or reserves.

Reserve status checks this material against the sum of the next input batches
of the manually selected jobs. Below one such input round is critical; enough
for one but not two rounds is low. With no selected consumer, no export-style
stock threshold is imposed. Unknown plan requirements/stock remain unknown.
This describes material coverage only, not complete production capacity or a
time horizon: other ingredients, factory timing and byproduct replenishment
still belong to the detailed production simulation. Existing export stock
thresholds no longer classify Gold, WCG, Niobium or PC. Priority actions group
Gold / WCG once and label them as internal resources.

Gold Ore, Niobium Ore and Military Salvage appear as INPUT lines on their
respective reserve cards; Scrap Metal appears under Basic Alloy. Each input
line displays its own stock and whole input-batch coverage for that exact
recipe. It does not add ore/salvage to finished stock, add another progress
bar, or claim the factory is active. Finished material remains usable when its
raw input runs out. The raw feedstock classifier remains available to imports
and stock checks, but has no standalone inventory panel.

PC reclamation is a seventh production card and an optional Advanced Materials
Complex job in the manual staffing/production plan. It starts unplanned, since
the page cannot observe whether the new module has actually been installed or
started. The verified recipe consumes 250 Military Salvage for 25 PC and 450
Scrap Metal, reserving 100 Scientists. It has no BMM input discount. General
Military Salvage volume is 1 (the checked public commodity snapshot); hauler
overrides must not shorten factory timing. The reference cycle is 125 minutes.
Existing always-on Chambers / Basic Alloy and refinery/shipyard choices remain.

Ordinary exports contain only the three export products and waste. CHECK
SURPLUS on PC opts that material into the current Trade Desk dialog, explains
its internal role, and requires an explicit positive whole-unit quantity before
loading/calculating the quote. The site does not invent an internal reserve
target or automatically offer a full hold. The user allows for production;
fresh quotes still enforce actual sale reserves, stock and buyer limits. Closing
and reopening the normal desk removes the temporary PC export option and the
surplus quantity. Nothing changes the in-game market configuration.

Stock-card clicks open the matching production card, reset view filters,
expand materials, focus and briefly highlight the card. Input lines open their
consumer. Gold Supply offers its refinery plus its consuming modules. Waste
offers its producers. Existing route icons act separately. Ship counts use the
same exact aliases/package identities as Shipyard; schematics and malformed
quantities cannot become finished hulls. Known positive stocks lead, and other
known-zero/unreported hulls are collapsed with their actual zero/unknown value.
Unknown stocks never become an assumed zero.

Opening a hull selects its Shipyard preview without changing an already
planned hull. Staffing schema v4 preserves explicit pinned hull recipes while
migrating older follow-hull selections. New production activation remains an
explicit PLAN action. All data remain local planning/display choices.

Checks: `node scripts/test_inventory_reserves.js`,
`node scripts/test_production_plan.js`,
`python scripts/smoke_inventory_reserves.py` and the existing Trade Desk and
responsive Command browser checks.
