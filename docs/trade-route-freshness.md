# Trade Desk freshness

Every import/export search requests `/api/pobs` and `/api/systems` from Darkstat
with `cache: no-store`. Recent dashboard telemetry, previous searches and the
IndexedDB POB snapshot cannot replace these requests. A failed/empty live feed
pauses calculation and marks existing quotes out of date. Canceling a search
also aborts its requests. Receipt times describe when RHW received the feeds;
they are not timestamps of an in-game transaction or Darkstat's own refresh.

NPC market/owner/ID reference data retain their six-hour cache; ship data retain
their daily cache. **REFRESH MARKETS** also refreshes these reference datasets.

`live-navigation.mjs` checks the bundled graph against the newly fetched map
objects before either planner runs. Missing, unknown and campaign-locked jump
objects cannot keep old connections. A changed destination invalidates its old
directed edge. Current positions update mapped objects; deleted lane rings lose
their links. Existing dock/cargo restrictions remain conservative. A newly
cargo-limited connection without a known exact capacity is excluded.

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
