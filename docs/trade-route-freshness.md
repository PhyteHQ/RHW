# Trade Desk freshness

Every import/export search requests `/api/pobs` from Darkstat with
`cache: no-store`. Recent dashboard telemetry, previous searches and IndexedDB
cannot replace fresh POB stock and prices. A failed/empty POB feed pauses
calculation and marks existing quotes out of date. Canceling a search aborts
its market requests. Receipt times describe when RHW received data; they are
not timestamps of an in-game transaction or Darkstat's own refresh.

## Independent route map

The map is reused for one day and updated separately. A search immediately uses
the last successfully checked map saved in IndexedDB, retaining its original
check time across reloads. With no valid saved map, it starts with the packaged
146-system routing projection captured on 2026-10-29 at 08:32 UTC. The map panel
and quote source display the date of the map actually used, separately from
fresh market timestamps, and distinguish a bundled snapshot from a saved map.
Known closures, including both Galileo–Shikoku directions, apply in all modes.

If the map is older than one day, `/api/systems` is fetched in the background
with `cache: no-store` and its own 20-second deadline. It never delays a quote,
aborts market loading or substitutes old stock. Failed automatic updates have
a five-minute retry cooldown. **UPDATE MAP** retries immediately, independently
of **REFRESH MARKETS**, without changing the existing quote or its provenance.
If an update arrives after a search selected its map, **RECALCULATE WITH UPDATED
MAP** applies it through a new search with fresh POB stock; current quotes are
never silently relabelled with a newer map date. Canceling a trade does not
cancel the independent map update.

Only responses accepted by the existing navigation validator and covering
RHW's system replace the saved map. Rendering data are stripped; persisted
routing facts contain system nicknames, objects and jump kinds, positions and
destination systems. Invalid responses, timeouts, unavailable/full browser
storage and a missing endpoint cannot discard a valid map. A damaged or older
cache falls back to the packaged map. Map and reference records use separate
IndexedDB keys, so concurrent writes cannot overwrite each other. Warm searches
reuse memory without further IndexedDB reads or writes.

The packaged `assets/navigation-last-verified.json.gz` is the same complete
public routing projection retained in the map regression fixture. It is never
passed off as a fresh API response. Geometry still comes from
`assets/navigation.json.gz`. Newer unknown gates/lanes may be missing until map
and geometry updates; routes remain estimates based on the displayed map.
The optional `python scripts/smoke_trade_live.py` verifies cross-origin API
loading, independent map updates and a Prototype Components search in Chrome
without fixture responses. External API availability makes it unsuitable as an
offline-required release check.

NPC market/owner/ID reference data retain their six-hour cache; ship data retain
their daily cache. **REFRESH MARKETS** also refreshes these reference datasets.
NPC quotes now use `/api/npc_bases` with `include_market_goods: true` and
`filter_market_good_category: ["commodity"]`, joined to commodity metadata from
`/api/commodities` with `include_market_goods: false`. The old commodity-centric
market export exceeded 70 MB in the real cold-browser check because it repeated
nested POB data that the NPC normalizer discarded. Generic and ship-specific
volumes remain in the joined model; NPC sale/purchase directions and owners are
preserved. Array-valued filters require POST and cannot silently fall back to a
GET that drops the filter.
Those reference datasets and the separately keyed map are persisted. Warm searches reuse their in-memory
copy and do not reread or rewrite IndexedDB. Legacy cache entries containing an
unused POB snapshot are cleaned on a successful search. Stock and prices still
come from a new required POB request every time. Bundled geometry loads
alongside the market feeds on first use. A failed required market feed aborts outstanding
requests immediately, including slow optional reference refreshes; canceled or
failed searches cannot publish a later result. Loading status names pending
feeds. Completed searches report data-load and route-search time separately.

The Trade Desk compares four reference profiles: Barge (30,000 / 90 m/s),
5k Transport (5,000 / 350 m/s), Pilgrim (4,300 / current registry speed, 415 m/s
in the checked API data), and a medium-docking 3.6k Transport at 500 m/s.
The earlier 600 m/s value was a corrected input typo. Cached profiles restore
their original registry speed before selection; the custom-speed note is retired.
The reference hull still supplies exact ID, tech, dock, lane and commodity-volume
rules. Non-fleet hulls cannot enter through a saved selection or worker request.

Import approach jobs share the search budget across viable hull/seller pairs.
An exact reverse shortest-path tree checks all directed pickup-to-seller times
before profit shortlisting; it preserves one-way jumps and lane-entry costs.
Both planners also use an exact reverse tree rooted at RHW for all direct
return flights. Seller/buyer shortlisting uses actual outward plus homeward
travel, rather than doubling the outward duration. Export backhaul deliveries
share reverse trees for their RHW / New London destinations. Only selected
itineraries materialize forward paths; reported jump counts match those paths.
Slow hulls outside the direct-flight/delivery bound cannot consume the approach
budget first. Searches that reach a time or candidate limit say **BEST FOUND**.

POB money and free storage are required when the POB buys cargo from the player.
A POB that only sells goods does not need to disclose those balances; its stock,
reserve, limits and cargo volume still apply. Unknown balances stay unknown after
simulation. Missing docking mode is an unverified policy, separate from reported
whitelist modes and hostile-IFF owner approvals. It can be quoted conditionally
through **Include unverified ID / docking rules**, never as a default verified route.

`live-navigation.mjs` checks the bundled graph against the selected checked map
objects before either planner runs. Missing, unknown and campaign-locked jump
objects cannot keep old connections. A changed destination invalidates its old
directed edge. Current positions update mapped objects; deleted lane rings lose
their links. Existing dock/cargo restrictions remain conservative. A newly
cargo-limited connection without a known exact capacity is excluded.

Repeated objects in the rendering feed are grouped by system and nickname.
Identical position, object kind and jump destination count as one routing
object, even when cosmetic fields differ. Conflicting routing facts exclude
only that object and its links for the current snapshot. They do not abort
the whole search, and a later repeated entry cannot restore an ambiguous gate.
The complete routing projection of the 2026-10-29 08:32 UTC response (146
systems and 25,247 objects) is retained as a compressed regression fixture.
It includes the repeated `br07_planet_5_ring_1` that caused the initial global
failure. Both model and browser tests consume the complete projection.

The API does **not** expose exact destination objects or lane adjacency. These
continue to come from `assets/navigation.json.gz`; new links are not guessed
from system names or coordinates. The UI displays the geometry build date
separately from the current map receipt time. This is a live availability and
position check on known geometry, not a claim that the entire graph is rebuilt.

Server/campaign closures can precede the client-config feed. On 2026-10-29,
Darkstat still reported Galileo–Shikoku as a regular gate despite the operator's
confirmed in-game destruction report. `KNOWN_JUMP_CLOSURES` records both exact
endpoints, source, reason and report date. It overrides the feed in both
directions. Remove a closure only after confirming reopening; a fresh feed alone
does not establish that a server closure has ended.

Primary feed contract: [Darkstat systems endpoint](https://github.com/darklab8/fl-darkstat/blob/master/darkapis/darkhttp/systems.go),
[map object export](https://github.com/darklab8/fl-darkstat/blob/master/darkmap/export_map/system_content.go)
and [jump kinds and campaign locks](https://github.com/darklab8/fl-darkstat/blob/master/darkmap/export_map/system_connections.go).
The compact regression fixture was read from the public live endpoints at
2026-10-29 07:59 UTC. Gifu reported 669 Propulsions with a 300-unit reserve,
leaving 369 for sale; its cash and docking mode remained undisclosed.

See the [Trade Desk audit and measured replay](trade-desk-audit-2026-11-02.md).
