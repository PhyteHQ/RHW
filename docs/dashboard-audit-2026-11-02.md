# RHW dashboard audit - 2 November 2026

Scope: the nine public destinations (Inventory, Shipyard, Production, Logistics,
Calculator, Price Check, Forum, Drafts and Senders), shared status/navigation,
production planning, Trade Desk, data provenance and responsive layouts.
The starting production commit was `447a84adf53a6e0a9294c8a4ef351c14ad0c2321`.

## Confirmed defects and corrections

1. **Contradictory unknown-stock states.** A missing maintenance/export stock
   could be labelled UNKNOWN while its description claimed stability. Missing
   waste stock could claim a containment emergency. Role aggregation could
   also turn UNKNOWN into OK. Unknown quantities now retain UNKNOWN throughout
   the row and aggregate inventory status. Explicit reported zeroes still
   trigger the appropriate stock warning; known low/critical conditions keep
   their precedence.
2. **Synthetic alternate stock invalidated usable Gold.** Inventory refreshes
   create placeholder records for unreported tracked materials. The standalone
   recipe analysis treated such a WCG placeholder as malformed reported stock,
   making Gold-based capacity unknown despite reported Gold being available.
   Unreported alternatives now add no stock when another variant is reported.
   Both-unreported and genuinely malformed reported quantities remain unknown.
   Regression coverage exercises the real inventory-cache rebuild, not only a
   hand-written lookup stub.
3. **Pinned ship plans disappeared from the controls.** Opening Barge stock
   preserved an Archon plan but hid its forecast because the UI required
   follow-hull mode. Returning to Archon also required an extra click before
   the plan could be disabled. The current planned hull and its forecast now
   remain identified beside a different preview. A matching pinned plan shows
   SHIP PLANNED and turns off immediately. Independent fallback coverage is
   calculated for the actual planned hull, not whichever hull is previewed.
   Forecast labels also use product names such as Basic Alloy.
4. **Removed Civilian Cruiser recipe.** The public configuration captured by
   the successful 2 November catalog sync removed `ship_assembly_cv_cruiser`.
   The reviewed update contains no changed recipes, quantities or IFF bonuses.
   Its six generated catalog chunks and provenance metadata are incorporated;
   the unavailable hull is removed from the build selector. There are eight
   supported hulls. Saved optional jobs referencing a removed/invalid recipe
   are disabled rather than silently planning a different default ship.

## Verification

- All 21 dependency-free JavaScript model/contract checks and the two Python
  build/sync checks are run. Coverage includes recipe costing, shared inputs,
  staffing, inventory roles, ship aliases, import/export simulation, docking/ID
  restrictions, four hauler profiles, map fallback, storage/backup contracts,
  local drafts, release hashes and background-refresh lifecycle.
- Direct browser interaction uses the real packaged application and a clearly
  labelled QA page with controlled market/ID snapshots. All nine destinations
  are exercised, including the 360-pixel layout. Additional checks cover
  Gold's consumer picker, missing stock, standalone Gold without a WCG listing,
  ship preview/plan preservation, one-click deselection, PC costing, Markdown
  preview/BBCode parity, saving/reopening a named draft and sender management.
- The Trade Desk's actual worker returns three Ablative import alternatives
  using the controlled feed, including Waterloo / Oder return-cargo planning.
  Limited search is correctly labelled Best Found. PC surplus requires an
  explicit quantity; reopening the ordinary desk removes PC from exports.
- The release workflow additionally checks the exact bundled payload, offline
  reload, responsive layouts, keyboard/focus behavior and the new inventory
  regressions before GitHub Pages publication.

## Limits

Controlled browser fixtures verify behavior, not today's actual availability
or market prices. Direct Darkstat access is unavailable from this review's
browser environment; a successful live search must not be inferred from these
fixture results. The catalog update is grounded separately in the repository's
successful public-configuration sync at `2026-11-02T12:22:00Z`; its source hashes
are recorded in `docs/discovery-sync-report.md`.

Production remains a manual forecast from a stock snapshot, not an observed
in-game scheduler. Route quotes remain constrained by the displayed search
limits, current market response and the checked map's date. This audit does
not certify every possible browser, future feed change or game-server action.
