# Inventory roles and production links

The Status Board has three independent stacks: Facility Maintenance (Basic
Alloy, Consumer Goods, Food Rations) with MOX Feedstock directly below; Production
Reserves (Gold Supply, Niobium, Prototype Components, MOX); and Export Inventory
(Chambers, Reactors, Superstructures) with Ship Stock directly below. Taller
reserves cannot push the two secondary cards down. Tablets put Exports and
Ship Stock side by side beneath the first two stacks; phones read each group
in DOM order, in one column.

Gold Supply is an additive Gold / Wildcat Gold pool. Its breakdown preserves
the individual stocks; Full Manifest continues to list every original item.
An absent alternative contributes zero only when another pool member is
reported. Malformed reported stock, or a wholly unreported pool, stays unknown.
Neither the pool nor role assignment modifies API stock, prices or reserves.

Reserve status compares stock with the largest single recipe-batch input
among the displayed recipes. Below one batch is critical; one but fewer than
two batches is low. These are independent reference thresholds, not selected
jobs or an export target. Unknown recipe data or stock stays unknown.

Gold Ore, Niobium Ore and Military Salvage appear as INPUT lines on their
respective reserve cards; Scrap Metal appears under Basic Alloy. Each input
line displays its own stock and whole input-batch coverage for that exact
recipe. It does not add ore/salvage to finished stock, add another progress
bar, or claim the factory is active. Finished material remains usable when its
raw input runs out. The raw feedstock classifier remains available to imports
and stock checks, but has no standalone inventory panel.

MOX is an internal reserve, never an ordinary export. Its stock link and input
lines follow the selected production variant: Toxic Waste for Basic, plus
Uranium for Advanced. Each input line describes that input's batches, without
claiming the other inputs or Scientists are available. Recipe selection never
changes the API stock or market configuration.

PC reclamation is the seventh production row. The verified recipe consumes 250
Military Salvage for 25 PC and 450 Scrap Metal, requiring 100 Scientists.
It has no BMM input discount. General Military Salvage volume is 1; the
reference cycle is 125 minutes. The page does not infer module installation
or activation.

Ordinary exports contain only the three export products and waste. CHECK
SURPLUS on PC opts that material into the current Trade Desk dialog, explains
its internal role, and requires an explicit positive whole-unit quantity before
loading/calculating the quote. The site does not invent an internal reserve
target or automatically offer a full hold. The user allows for production;
fresh quotes still enforce actual sale reserves, stock and buyer limits. Closing
and reopening the normal desk removes the temporary PC export option and the
surplus quantity. Nothing changes the in-game market configuration.

Stock links open the matching recipe in the shared detail modal, reset view
filters and briefly highlight its production row. Input lines open their consumer.
Gold Supply offers its refinery plus consuming modules. Toxic Waste opens a
material detail with the selected MOX conversion, TW batch coverage and connected
recipes. TW has no disposal or overflow threshold: fewer than one MOX batch is
critical, one batch is low and at least two are available feedstock. This is TW
coverage only; other ingredients, Scientists and module activity are not inferred. Existing route icons act separately. Ship counts use the
same exact aliases/package identities as Shipyard; schematics and malformed
quantities cannot become finished hulls. Known positive stocks lead, and other
known-zero/unreported hulls are collapsed with their actual zero/unknown value.
Unknown stocks never become an assumed zero.

Opening a hull selects its Shipyard preview. There are no manual factory or
ship planning controls, saved jobs or shared production forecasts.

Checks: `node scripts/test_inventory_reserves.js`,
`node scripts/test_production_plan.js`,
`python scripts/smoke_inventory_reserves.py` and the existing Trade Desk and
responsive Command browser checks.

Basic Alloy coverage is an estimate using the owner-reported upkeep of 4,300 per day after the rollback, stored in `maintenanceDailyReference`. It is not a measured production/consumption rate.
