# RHW production capacity

Manual production planning has been removed. Each of the seven recipe cards
shows existing product stock, whole output batches supported by the current
inputs, a reference cycle time, and the limiting input. Materials remain in an
accessible disclosure with persistent open/closed state across stock refreshes.

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

Checks: `node scripts/test_production_plan.js`,
`node scripts/test_inventory_reserves.js` and the bundled interface browser test.
