# Logistics: two market scans

Command → Logistics now has two views over the same all-POB telemetry snapshot:

- **Ship Components:** Avionics Systems, Interior Systems, Propulsion Systems, Superstructure Systems, Reactor Systems and Exotic Systems.
- **Industrial Materials:** Gold, Gold Ore, Niobium, Niobium Ore and Prototype Components.

The material scan replaces the fixed Lisheen/Shelton cards. Prototype Components appear only in Industrial Materials. Newswire's separate remote-facility sources remain configured.

Both views use one renderer for stock above base reserves, valid buy-from-base prices, unlisted stock, best-price highlighting, and the existing top-six selection with RHW's own offer retained. Each view has its own Best Price / Most Stock preference. Older saved ship-scan preferences remain readable. Both views support mobile offer disclosure and keyboard tab navigation.

The Logistics summary now reflects both scans rather than requiring two particular bases. A failed initial fetch reports unavailable data; cached results retain stale labels.

Validation is covered by `scripts/test_logistics_scans.js` and `scripts/smoke_stability_polish.py`. The latter exercises both material and ship views at 360, 390, 412 and 430 pixels, including sort independence, offer disclosure and keyboard navigation. Both are part of the Pages release gate.
