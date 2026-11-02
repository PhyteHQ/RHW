# Trade Desk audit — 2 November 2026

Reviewed the lazy launcher, live-data loading and local persistence, worker
lifecycle, four-hull comparison, route/ID matching, import and export ranking,
transaction accounting, navigation and return-cargo search.

## Findings and changes

- Direct comparisons rebuilt a complete shortest-path tree for every return
  origin. Export backhaul quotes repeated this for many pickups. Shared reverse
  trees now answer these exact directed journeys, retaining one-way jumps,
  cargo/dock limits, lane eligibility, charge time and lane-entry costs.
- Source/buyer shortlisting previously estimated a round trip as twice its
  outbound flight. It now uses exact outward and homeward times. Final displayed
  paths remain forward paths; their jump counts are the reported total.
- Every search reread and rewrote the IndexedDB record, including a live POB
  snapshot that subsequent searches never consumed. Persistence now contains
  reusable reference data only; warm searches reuse it in memory. Every search
  still fetches fresh POB stock and live map objects.
- A failed required live feed waited for unrelated reference requests. It now
  fails promptly and aborts remaining requests. Loading names the pending feeds;
  results separate data-load time from route-search time. Stale worker errors
  cannot terminate a newer search.
- Bounded exports now use BEST FOUND in their recommendation heading, matching
  imports. Time/candidate bounds still apply; this is not an exhaustive search.

## Measured replay

One identical retained Darkstat market/navigation snapshot was replayed before
and after the routing change in Node, on the same executor. It contained 784
bases, 28,387 offers, 2,526 navigation nodes, 2,800 links, 107 ID policies and the
owner's four comparison hulls. Default price priority, 20% extra time and the
18-second search budget were retained. These measurements exclude network and
browser loading, use historical prices, and are not current route advice.

| Search | Before | After | Shortest-path trees, before → after |
|---|---:|---:|---:|
| Niobium import | 2.46 s | 1.38 s | 51 → 23 |
| Ablatives import | 1.50 s | 1.10 s | 36 → 21 |
| Chambers export with return cargo | 18.19 s, timed out | 3.47 s, completed | 750 → 108 |

The best route's ship, stops, cargo quantities, buy price, profit and compatible
IDs matched in all three replays; travel times matched within floating-point
tolerance. Export return quotes increased from 684 to 2,040. Candidate pruning
still occurred and remains disclosed. The speedup does not depend on skipping
the Barge or reducing the four-profile comparison.

## Accounting and rule checks

The regression suite checks the Waterloo → Oder alloy/plating route, profit
versus the import time/delivery-rate window, separately marked inbound losses,
RHW sale versus purchase quotation direction, full-hull ID restrictions and
100% tech compatibility, one ID valid at every stop, POB approval/unknown modes,
stock reserves, whole units, ship-specific versus original storage volume,
player capital, buyer funds/storage/demand, fixed export quantity before return
trading, NPC return sales in New London, Barge lane bans and charge time,
directed travel, current map exclusions and Galileo–Shikoku's reported closure.

A work-count regression compares 60 markets without allowing a separate
shortest-path tree for each. Browser coverage checks reference-only persistence,
warm-cache reuse with new live feeds, separate timings, prompt live-feed failure
during a hanging reference refresh, cancellation/retry and responsive controls.

The API does not report private POB approvals, current character reputation or
server-side events before its own refresh. Existing conditional-access labels
and the explicit closure override remain necessary. See
[freshness and map limitations](trade-route-freshness.md).
