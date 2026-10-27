// ============================================================
// RHW DASHBOARD CONFIGURATION
// Edit features, production module identities, tracked roles, thresholds and market scans here.
// ============================================================
const DASHBOARD_CONFIG = Object.freeze({
  apiUrl: 'https://darkstat.dd84ai.com/api/pobs',
  baseName: 'resolution heavy works',
  baseHealthMax: 24000000,
  autoRefreshMs: 300000,
  fetchTimeoutMs: 18000,
  storageKeys: Object.freeze({
    view: 'rhw-dashboard-v3.5:view',
    eco: 'rhw-dashboard-v3.5:eco'
  }),
  features: Object.freeze({
    capitalShipyard: true,
    materialsScan: true,
    marketScan: true,
    ecoMode: true
  }),
  roles: Object.freeze({
    maintenance: ['basic alloy', 'food rations', 'consumer goods'],
    export: ['multi-mode focusing chamber', 'multi-mode focusing chambers', 'superstructure systems', 'reactor systems', 'gold', 'niobium'],
    byproduct: ['toxic waste'],
    procurement: ['ablative armor plating', 'avionics systems', 'energy field equipment', 'exotic systems', 'gold ore', 'hull panels', 'hydrocarbons', 'interior systems', 'prototype components', 'propulsion systems', 'mox', 'super alloy', 'titanium', 'industrial materials', 'niobium ore', 'scrap metal'],
    shipyard: ['avionics systems', 'interior systems', 'propulsion systems', 'superstructure systems', 'reactor systems', 'exotic systems'],
    feedstock: ['gold ore', 'niobium ore', 'scrap metal'],
    confiscated: ['wildcat gold']
  }),
  marketScan: Object.freeze([
    'Avionics Systems',
    'Interior Systems',
    'Propulsion Systems',
    'Superstructure Systems',
    'Reactor Systems',
    'Exotic Systems'
  ]),
  materialsScan: Object.freeze([
    'Gold',
    'Gold Ore',
    'Niobium',
    'Niobium Ore',
    'Prototype Components'
  ]),
  materialFeedstocks: Object.freeze({
    'gold': 'Gold Ore',
    'niobium': 'Niobium Ore',
    'prototype components': 'Military Salvage'
  }),
  remoteFacilities: Object.freeze([
    Object.freeze({
      key: 'lisheen',
      name: 'Lisheen Logistic Depot',
      system: 'Dublin',
      matches: ['lisheen logistic depot', 'lisheen'],
      targets: ['gold', 'gold ore'],
      statusTarget: 'gold'
    }),
    Object.freeze({
      key: 'shelton',
      name: 'Shelton Industrial Yard',
      system: 'Leeds',
      matches: ['shelton industrial yard', 'shelton'],
      targets: ['niobium', 'niobium ore'],
      statusTarget: 'niobium'
    })
  ]),
  capitalShipyard: Object.freeze({
    defaultHull: 'archon',
    divisions: Object.freeze([
      Object.freeze({ key: 'naval', label: 'NAVAL DIVISION', short: 'NAVAL', subtitle: 'Bretonian Naval Construction' }),
      Object.freeze({ key: 'mining', label: 'MINING DIVISION', short: 'MINING', subtitle: 'Mining & Extraction' }),
      Object.freeze({ key: 'civilian', label: 'CIVILIAN DIVISION', short: 'CIVILIAN', subtitle: 'Civilian Shipbuilding' })
    ]),
    hulls: Object.freeze([
      Object.freeze({
        key: 'archon',
        division: 'mining',
        label: 'Archon',
        plural: 'Archons',
        name: 'Archon Modular Miner',
        subtitle: 'Modular Miner',
        recipeId: 'ship_assembly_medium_miner',
        productId: 'medium_miner_package',
        apiCode: 'medium_miner',
        matches: ['medium_miner', 'medium_miner_package', 'modular miner', 'medium miner', 'archon modular miner', 'archon'],
        sellPrice: null
      }),
      Object.freeze({
        key: 'dunkirk',
        division: 'naval',
        label: 'Dunkirk',
        plural: 'Dunkirks',
        name: 'Dunkirk-Class Battleship',
        subtitle: 'Battleship',
        recipeId: 'ship_assembly_dsy_br_battleship',
        productId: 'dsy_br_battleship_package',
        apiCode: 'dsy_br_battleship',
        matches: ['dsy_br_battleship', 'bretonia dunkirk class battleship', 'dunkirk class battleship', 'dunkirk battleship', 'dunkirk'],
        sellPrice: 8500000
      }),
      Object.freeze({
        key: 'invincible',
        division: 'naval',
        label: 'Invincible',
        plural: 'Invincibles',
        name: 'Invincible-Class Dreadnought',
        subtitle: 'Dreadnought',
        recipeId: 'ship_assembly_dsy_br_carrier',
        productId: 'dsy_br_carrier_package',
        apiCode: 'dsy_br_carrier',
        matches: ['dsy_br_carrier', 'bretonia invincible class dreadnought', 'invincible class dreadnought', 'invincible dreadnought', 'invincible'],
        sellPrice: 8500000
      }),
      Object.freeze({ key: 'asteroid-miner', division: 'mining', label: 'Asteroid Miner', plural: 'Asteroid Miners',
        name: 'Asteroid Miner', subtitle: 'Mining Vessel', recipeId: 'ship_assembly_asteroid_miner',
        productId: 'dsy_miner_package_stripped', apiCode: 'dsy_miner', matches: ['asteroid miner'], sellPrice: null }),
      Object.freeze({ key: 'bustard', division: 'civilian', label: 'Bustard', plural: 'Bustards',
        name: 'Bustard Civilian Light Carrier', subtitle: 'Civilian Light Carrier', recipeId: 'ship_assembly_dsy_barge',
        productId: 'dsy_barge_package', apiCode: 'dsy_barge', matches: ['civilian carrier', 'bustard', 'bustard civilian light carrier'], sellPrice: null }),
      Object.freeze({ key: 'barge', division: 'civilian', label: 'Barge', plural: 'Barges', name: 'Barge', subtitle: 'Cargo Barge',
        recipeId: 'ship_assembly_dsy_cargobarge_1', productId: 'dsy_cargobarge_1_package', apiCode: 'dsy_cargobarge_1',
        matches: ['barge', 'cargo barge'], sellPrice: null }),
      Object.freeze({ key: 'starfliers-explorer', division: 'civilian', label: 'Starfliers Explorer', plural: 'Starfliers Explorers',
        name: 'Starfliers Compact Explorer', subtitle: 'Compact Explorer', recipeId: 'ship_assembly_starfliers_explorer',
        productId: 'zoner_exploration_fr_package', apiCode: 'zoner_exploration_fr', matches: ['starfliers compact explorer'], sellPrice: null }),
      Object.freeze({ key: 'civilian-cruiser', division: 'civilian', label: 'Civilian Cruiser', plural: 'Civilian Cruisers',
        name: 'Civilian Cruiser', subtitle: 'Civilian Cruiser', recipeId: 'ship_assembly_cv_cruiser',
        productId: 'cv_cruiser_package', apiCode: 'cv_cruiser', matches: ['civilian cruiser'], sellPrice: null }),
      Object.freeze({ key: 'halberd', division: 'civilian', label: 'Halberd', plural: 'Halberds',
        name: 'Halberd Border Worlds Gunship', subtitle: 'Border Worlds Gunship', recipeId: 'ship_assembly_ex_hacker_gunship',
        productId: 'ex_hacker_gunship_package', apiCode: 'ex_hacker_gunship', matches: ['halberd', 'halberd border worlds gunship', 'border worlds gunship'], sellPrice: null })
    ])
  }),
  exportOrder: ['Multi-Mode Focusing Chamber', 'Reactor Systems', 'Superstructure Systems', 'Gold', 'Niobium'],
  productionModules: Object.freeze([
    Object.freeze({ product: 'Multi-Mode Focusing Chamber', recipeId: 'recipe_weapon_part_focusing_chamber' }),
    Object.freeze({ product: 'Reactor Systems', recipeId: 'ship_part_reactor' }),
    Object.freeze({ product: 'Superstructure Systems', recipeId: 'ship_part_superstructure' }),
    Object.freeze({ product: 'Basic Alloy', recipeId: 'recipe_scrap_advanced' }),
    Object.freeze({ product: 'Gold', recipeId: 'recipe_gold_advanced' }),
    Object.freeze({ product: 'Niobium', recipeId: 'recipe_niobium_advanced' })
  ]),
  alerts: Object.freeze({
    'basic alloy': { type: 'min', red: 2500, yellow: 15000 },
    'food rations': { type: 'min', red: 2500, yellow: 15000 },
    'consumer goods': { type: 'min', red: 2500, yellow: 15000 },
    'gold': { type: 'min', red: 5000, yellow: 15000 },
    'niobium': { type: 'min', red: 5000, yellow: 10000 },
    'reactor systems': { type: 'min', red: 200, yellow: 500 },
    'superstructure systems': { type: 'min', red: 200, yellow: 500 },
    'multi-mode focusing chamber': { type: 'min', red: 500, yellow: 1000 },
    'multi-mode focusing chambers': { type: 'min', red: 500, yellow: 1000 },
    'toxic waste': { type: 'max', yellow: 15000, red: 30000, max: 50000 },
    'wildcat gold': { type: 'max', yellow: 25000, red: 30000 }
  }),
  barMaxFallbacks: Object.freeze({
    'basic alloy': 45000, 'food rations': 45000, 'consumer goods': 45000,
    'reactor systems': 1000, 'superstructure systems': 1000, 'multi-mode focusing chamber': 2000,
    'gold': 60000, 'niobium': 30000, 'prototype components': 25000,
    'gold ore': 50000, 'niobium ore': 50000, 'scrap metal': 30000, 'toxic waste': 50000,
    'wildcat gold': 30000
  })
});
