# Logistics: two market scans

Command → Logistics now has two views over the same all-POB telemetry snapshot:

- **Ship Components:** Avionics Systems, Interior Systems, Propulsion Systems, Superstructure Systems, Reactor Systems and Exotic Systems.
- **Industrial Materials:** Gold, Gold Ore, Niobium, Niobium Ore and Prototype Components.

The material scan replaces the fixed Lisheen/Shelton cards. Prototype Components appear only in Industrial Materials. Newswire's separate remote-facility sources remain configured.

Both views use one renderer for stock above base reserves, valid buy-from-base prices, unlisted stock, best-price highlighting, and the existing top-six selection with RHW's own offer retained. Each view has its own Best Price / Most Stock preference. Older saved ship-scan preferences remain readable. Both views support mobile offer disclosure and keyboard tab navigation.

On desktop, Gold and Niobium share the first row, their corresponding ores sit directly below, and Prototype Components span the last row. Mobile retains the metal/ore reading order.

Gold, Niobium and Prototype Components offers also show that seller's total Gold Ore, Niobium Ore or Military Salvage stock, respectively. These quantities include base reserves and do not depend on the input being for sale. Missing or invalid quantities read `NOT REPORTED`; an explicitly reported zero remains `0`. Cached input stocks are labelled. These are current input stocks, not an output forecast or confirmation that the base is producing the item.

The Logistics summary now reflects both scans rather than requiring two particular bases. A failed initial fetch reports unavailable data; cached results retain stale labels.

Validation is covered by `scripts/test_logistics_scans.js` and `scripts/smoke_stability_polish.py`. The latter exercises both material and ship views at 360, 390, 412 and 430 pixels, including sort independence, offer disclosure and keyboard navigation. Both are part of the Pages release gate.

The live upgrade check exposed a pre-existing PWA cache mismatch: navigation fetched new HTML while installation could copy old HTTP-cached scripts into the new release cache. Shell installation now reloads every asset, and controlled navigation serves the installed HTML until the user activates an update. The audit regression suite covers both cases.
