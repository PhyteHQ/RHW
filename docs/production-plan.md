# RHW production capacity

Manual production planning has been removed. Each of the eight comparison rows
shows existing product stock, output supported by whole current-input batches,
and the limiting input. Details opens one shared native modal with the reference
cycle time, consumed materials, byproducts and reusable prerequisites. Its
selected recipe and open state survive stock refreshes; closing restores focus.

Calculations are independent. The same stock can appear in several recipes;
these capacities cannot all be produced together. Future deliveries, byproducts,
module activation, maintenance and current in-game job progress are not assumed.
The page does not detect whether a module has been installed or is running.

Cycle time uses consumed input volume divided by cooking rate, in minutes.
Use general commodity volumes, including Military Salvage 1 and ore 2; ship
cargo overrides must not shorten recipe times. BMM input discounts affect
material quantities without being applied again to this reference duration.
Missing recipe/volume data remains unknown.

The calculator, material source links and Shipyard build requirements remain.
Production choices and personnel overrides are no longer stored or exported;
old backup fields for these retired features are ignored.

MOX is one row with two recipe variants. Basic is the default: 1,000 Toxic
Waste produces 333 MOX. Advanced consumes the same waste plus 100 Uranium
for 500 MOX. The HazMat variant is excluded. This recipe preference survives
reloads and optional settings transfer; it creates no production job or plan.
The costing shortcut always opens the variant shown in the row or details.

Each unavailable recipe gets its own unknown-capacity card. Other recipes
remain usable. The headline says MATERIAL COVERAGE because catalysts,
module availability and current in-game operations are not inferred.

Checks: `node scripts/test_production_plan.js`,
`node scripts/test_inventory_reserves.js` and the bundled interface browser test.
