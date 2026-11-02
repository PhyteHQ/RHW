# Inline RHW production plan

The existing Production cards own the manual plan controls. Chambers and Basic
Alloy are always included. The Industrial Refinery defaults to Advanced Gold;
Gold and Advanced Niobium are exclusive. Modular Shipyard starts unselected and
can run Supers, Reactors, or the currently selected Shipyard hull. PLAN SHIP is
inside the existing ship requirements panel. Choosing a different hull updates
ship mode; choosing a component replaces ship mode. No new top-level section is
added. Choices share the existing portable `personnelPlan` preference and crew
summary. Old settings migrate to the mandatory Chambers / Alloy / refinery plan.

Selected cards show PLANNED YIELD and elapsed planning time; SOLO CYCLES remains
the independently calculated material coverage and is not the shared forecast.
Details stay collapsed until requested. A choice does not send commands to the
game, and never changes the live inventory.

## Timing and allocation contract

- Timing follows Darkstat's general material-volume / cooking-rate method.
  Base recipe quantities are used before the BMM material discount; it is not
  correct to interpret `cooking_rate` as seconds or apply the material discount
  as a free time reduction. Each alternative group uses its first catalog entry
  for reference timing (MOX fuel). Alternate fuels can change real timing.
- Quantities, BMM eligibility, outputs and catalysts use the same corrected
  catalog as Calculator and Shipyard. General volumes were checked against the
  public Darkstat commodity snapshot on 28 October 2026. Ship-specific volume
  overrides are excluded. Missing volume data is not guessed.
- All selected jobs start new cycles from the displayed stock snapshot and
  repeat while possible. Whole-cycle inputs are allocated at cycle start;
  complete output batches become available only at completion. This explicit
  model is a planning estimate, not a claim about hidden server cycle progress
  or the private current production scheduler.
- Gold / WCG and fuel alternatives use one ordered shared pool. Stock is never
  independently promised to two modules. Every fixed module priority is tested
  (at most 24) to expose count/time ranges when last-stock allocation differs.
  Those ranges describe these planned starts and fixed priorities, not every
  possible real server phase or future intervention.
- Simultaneous completed batches are deposited before a new allocation. A
  blocked job waits while another module can produce its input. Ore exhaustion
  ends refinery supply; already refined Gold remains usable. Actual byproducts
  can supply other jobs. No future ore or player deliveries are invented.
- Known output stock limits and free base cargo space are enforced. Inputs free
  their general storage volume when allocated. An output blocked by space waits
  for another job to free space. Known personnel and reusable catalysts are
  reserved per planned running batch, plus Core 4's 800 Crew. Staff is retained,
  not consumed. Missing staff / output limits / free capacity makes the forecast
  visibly conditional; invalid input quantities make it unknown.
- Upkeep consumption, trading, starting progress, module interruptions, supply
  of food and non-production maintenance are not inferred. Outputs are counts
  of newly completed products, not the existing inventory or byproduct income.
- Work is bounded to 30 days / 12,000 events per priority. A capped forecast
  explicitly reports lower bounds. It never presents a capped count as final.

## Primary implementation references

- [Darkstat's production-time calculation](https://github.com/darklab8/fl-darkstat/blob/master/darkstat/configs_export/pobs_craftable.go)
- [Corrected recipe source / provenance](discovery-sync-report.md)
- [Personnel requirements](personnel-planner.md)

Model regression checks: `node scripts/test_production_plan.js`. Bundled browser
checks exercise real card clicks, mutually exclusive selections, ship mode,
persisted choices and narrow layouts in `scripts/smoke_interface_foundation.py`.
