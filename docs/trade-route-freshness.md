# Trade Desk freshness

Every import/export search requests `/api/pobs` and `/api/systems` from Darkstat
with `cache: no-store`. Recent dashboard telemetry, previous searches and the
IndexedDB POB snapshot cannot replace these requests. A failed/empty live feed
pauses calculation and marks existing quotes out of date. Canceling a search
also aborts its requests. Receipt times describe when RHW received the feeds;
they are not timestamps of an in-game transaction or Darkstat's own refresh.

NPC market/owner/ID reference data retain their six-hour cache; ship data retain
their daily cache. **REFRESH MARKETS** also refreshes these reference datasets.

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
Slow hulls outside the direct-flight/delivery bound cannot consume the approach
budget first. Searches that reach a time or candidate limit say **BEST FOUND**.

POB money and free storage are required when the POB buys cargo from the player.
A POB that only sells goods does not need to disclose those balances; its stock,
reserve, limits and cargo volume still apply. Unknown balances stay unknown after
simulation. Missing docking mode is an unverified policy, separate from reported
whitelist modes and hostile-IFF owner approvals. It can be quoted conditionally
through **Include unverified ID / docking rules**, never as a default verified route.

`live-navigation.mjs` checks the bundled graph against the newly fetched map
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
