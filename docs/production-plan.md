# Inline RHW production plan

The existing Production cards own the manual plan controls. PC reclamation is
available as an optional Advanced Materials Complex job, initially unplanned.
It consumes 250 Military Salvage for 25 PC + 450 Scrap Metal, reserves 100
Scientists and takes ~125 minutes in the reference volume/rate model. The
general Military Salvage volume is 1; hauler volume overrides do not apply.
Staffing schema v4 also retains a pinned planned hull when an inventory click
opens a different Shipyard preview. See [inventory roles](inventory-reserves.md).

Chambers and Basic
Alloy are always included. The Industrial Refinery defaults to Advanced Gold;
Gold and Advanced Niobium are exclusive and can both be off. Clicking the
selected PLAN button again disables that optional job. Modular Shipyard starts unselected and
can run Supers, Reactors, or the currently selected Shipyard hull. PLAN SHIP is
available beside a grouped hull selector in the Production toolbar, as well as
inside the existing ship requirements panel. Neither selecting nor planning a
ship in Production changes tabs. Choosing a different hull updates
ship mode; choosing a component replaces ship mode. No new top-level section is
added. Choices share the existing portable `personnelPlan` preference and crew
summary. Old settings keep the initial Gold choice; version 3 persists an
explicitly disabled refinery. Chambers / Alloy remain mandatory and show an ALWAYS ON label.

The Production page has one collapsible **Shared Production Plan** overview
above the cards. It lists selected jobs, newly completed output, elapsed time,
limits and internal supply links. Links are derived from the outputs and inputs
of the actual selected jobs, including byproducts and interchangeable materials.
They describe planned supply, not guaranteed future deliveries. One explanation
covers snapshot provenance, missing data and planning assumptions.

Each card shows only **In Stock** and **New Output**, with a clear **Shared Plan**
or **Solo Estimate** label. Cycle time remains visible for every job, including
unselected jobs or unknown stock. Selected jobs use the verified shared forecast;
unselected jobs use their standalone material coverage and are labelled **Not In
Shared Plan**. Input readiness explicitly refers to standalone input coverage,
not the shared plan or product stock. A plentiful limiting input is not painted
red merely because it runs out before the others.

Material details start collapsed at every width and have an individual keyboard
operable disclosure. They contain material cycles, solo yield, solo duration,
the next extra solo cycle's shortfall, ingredients, byproducts and reusable
personnel requirements. Open cards survive telemetry and plan rerenders during
the session. Inventory links still open and highlight the relevant card without
changing the production plan. The old global recipe-details preference no longer
expands every card. Always-on jobs use a fixed label; optional PLAN buttons keep
the same exclusive choices and persistence.

When any selected input is unreported, the shared forecast is unverified. Cards
may still show standalone material coverage, explicitly labelled **Plan Unverified
· Solo Only**, never an invented shared total. Unknown inputs to the card itself
show no count or duration. The shared overview names the missing inputs. A choice
never sends commands to the game or changes real inventory.

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
  (at most 120 with PC reclamation) to expose count/time ranges when last-stock allocation differs.
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
