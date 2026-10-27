# RHW personnel planning

The Production view has a local plan for RHW's Core 4 and its Industrial Refinery,
Scrap Smelter, Modular Shipyard and Exotic Weapons Components Foundry. All jobs
start off until explicitly selected. A module runs one selected recipe at a time.
Cargo storage and idle factories do not add recipe catalysts.

The core reserves **200 Crew per core level**, so RHW reserves **800 Crew**.
Every selected job adds its Crew and Scientists catalysts. They are retained,
but reserved separately for factories working concurrently. They are not multiplied
by material cycles or discounted by an IFF material bonus.

Primary implementation references, inspected 27 October 2026:

- [PlayerBase.cpp](https://github.com/DiscoveryGC/FLHook/blob/master/Plugins/Public/base_plugin/PlayerBase.cpp): `PlayerBase::Timer` clears the reservation map and reserves `base_level * 200` Crew before the module timers run. Inspected blob: `4894faebc4633b88f1e80ecf59462bcb2f4435a8`.
- [FactoryModule.cpp](https://github.com/DiscoveryGC/FLHook/blob/master/Plugins/Public/base_plugin/FactoryModule.cpp): checks available stock minus existing reservations, then reserves the active recipe's catalysts/workforce when it processes materials. Inspected blob: `165de5479121dad9c40825c9defc81e1662b5ef3`.
- [CoreModule.cpp](https://github.com/DiscoveryGC/FLHook/blob/master/Plugins/Public/base_plugin/CoreModule.cpp): the core crew threshold is also `base_level * 200`. Inspected blob: `42d0978a2f8660efc2a1dcdbcd8a9da2cb8c33c2`.
- Recipe amounts and IFF eligibility come from RHW's verified Discovery catalog, not a duplicate table.

The plan assumes each selected recipe is processing materials concurrently. It
does not infer running jobs or guarantee production readiness: material stock,
module level, food/supplies and other recipe prerequisites still matter. Other
non-personnel catalysts (including Archon schematics) stay in Build Prerequisites.

Shipyard checks preview the selected hull alongside the core and planned jobs in
the other three modules. The Modular Shipyard plan is replaced by the selected
hull for that preview, avoiding double counting the same physical module.

Personnel stock uses exact inventory identity and the shared telemetry freshness.
Missing or invalid stock stays unknown. Optional manual whole-number stock takes
precedence and is clearly marked MANUAL; clearing it resumes API stock. Explicit
zero is valid. Manual stock, plans, division choices and last hull are local and
included with App Settings in private backups. They never send commands to the game.
