# RHW resilience and MOX update

- A missing module recipe shows one unavailable card; healthy recipes retain
  their material coverage. Unknown data is never a zero-input production run.
- MOX adds an eighth card. Basic (1,000 TW → 333 MOX) is the default; Advanced
  (1,000 TW + 100 Uranium → 500 MOX) is selectable. No HazMat variant is offered.
  Recipe selection and costing agree and survive settings transfer/reload.
- Public POB stock snapshots persist independently of private drafts. Restored
  stock keeps its original age and remains cached until a successful fetch.
  Failed/invalid writes do not replace the last valid snapshot. Trade Desk
  continues to fetch fresh POB stock for each search.
- ATTENTION includes explicit warning-level restock quantities and source
  shortcuts. Module and Shipyard shortages refer to the next whole batch/ship;
  they do not claim to be a combined shopping list for concurrent production.
- Bars identify fallback display scales; only API values are called maxima.
- Stock rows and the small-screen header are shorter. Core Production labels
  retain an 11 px minimum, with the black/gold identity preserved.

Verification includes dependency-free model/cache checks and the packaged
browser suite: isolated recipe failures, both MOX variants, exact costing,
restock handoff, responsive controls and stock restoration after offline reload.

## Compact production and MOX inventory follow-up

- MOX is the fourth internal Production Reserve, with inputs and navigation
  following its saved Basic/Advanced recipe. Its status uses consuming recipes,
  never a sales target.
- Production uses four columns from 1280 px, two on smaller desktop/tablet
  windows and one on phones. Stable order: three export products plus Basic
  Alloy, then Gold, Niobium, Prototype Components and MOX.
- Equal-height collapsed cards show role/status, product, real stock, material
  coverage and limiting input. Details contain batch quantities, reference
  times, input stocks, byproducts and prerequisites. Details and Calculator
  share one action row; the compact MOX selector stays visible in the header.
- Tests cover the MOX input/navigation handoff and responsive geometry,
  including four/two/one columns, consistent heights and disclosure retention.

Source review: the accessible calculator mirror was last updated in August
and differs from the verified 2 November catalog. It was compared and rejected
as a catalog replacement. Basic/Advanced MOX amounts agree. The primary source
sync remains a separate reviewed workflow; an older fallback must not be
mistaken for a current game update.
