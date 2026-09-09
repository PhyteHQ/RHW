// ============================================================
// RHW DASHBOARD CONFIGURATION · V3.5
// Edit features, recipes, tracked roles, thresholds, market scans and remote facilities here.
// ============================================================
const DASHBOARD_VERSION = 'V3.5';
const DASHBOARD_CONFIG = Object.freeze({
  apiUrl: 'https://darkstat.dd84ai.com/api/pobs',
  baseName: 'resolution heavy works',
  baseHealthMax: 24000000,
  newswireUrl: './assets/RHW_Newswire.md',
  newswireRefreshMs: 900000,
  autoRefreshMs: 300000,
  fetchTimeoutMs: 18000,
  storageKeys: Object.freeze({
    view: 'rhw-dashboard-v3.5:view',
    eco: 'rhw-dashboard-v3.5:eco',
    newswireCache: 'rhw-dashboard-v3.5:newswire-cache'
  }),
  features: Object.freeze({
    capitalShipyard: true,
    materialsScan: true,
    marketScan: true,
    ecoMode: true,
    newswire: true,
    remoteNewswire: true
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
    components: Object.freeze([
      Object.freeze({ name: 'Avionics Systems', required: 43 }),
      Object.freeze({ name: 'Interior Systems', required: 65 }),
      Object.freeze({ name: 'Propulsion Systems', required: 43 }),
      Object.freeze({ name: 'Superstructure Systems', required: 65 }),
      Object.freeze({ name: 'Reactor Systems', required: 44 }),
      Object.freeze({ name: 'Exotic Systems', required: 47 })
    ]),
    hulls: Object.freeze([
      Object.freeze({
        key: 'dunkirk',
        name: 'Dunkirk-Class Battleship',
        subtitle: 'Bretonian Capital Hull',
        matches: ['dsy_br_battleship', 'bretonia dunkirk class battleship', 'dunkirk class battleship', 'dunkirk battleship', 'dunkirk'],
        sellPrice: 8500000
      }),
      Object.freeze({
        key: 'invincible',
        name: 'Invincible-Class Dreadnought',
        subtitle: 'Bretonian Capital Hull',
        matches: ['dsy_br_carrier', 'bretonia invincible class dreadnought', 'invincible class dreadnought', 'invincible dreadnought', 'invincible'],
        sellPrice: 8500000
      })
    ])
  }),
  exportOrder: ['Multi-Mode Focusing Chamber', 'Reactor Systems', 'Superstructure Systems', 'Gold', 'Niobium'],
  recipes: Object.freeze([
    Object.freeze({ product: 'Multi-Mode Focusing Chamber', output: 10, byproducts: [['Toxic Waste', 300], ['Scrap Metal', 100]], ingredients: [['Gold',250], ['Super Alloy',125], ['Titanium',25], ['Hydrocarbons',25], ['Prototype Components',10], ['MOX',225]] }),
    Object.freeze({ product: 'Reactor Systems', output: 1, byproducts: [], ingredients: [['Energy Field Equipment',25], ['Super Alloy',25], ['Niobium',25], ['MOX',25]] }),
    Object.freeze({ product: 'Superstructure Systems', output: 1, byproducts: [], ingredients: [['Gold',25], ['Hull Panels',25], ['Ablative Armor Plating',25], ['Super Alloy',25]] }),
    Object.freeze({ product: 'Basic Alloy', output: 750, byproducts: [['Toxic Waste', 150]], ingredients: [['Industrial Materials',75], ['MOX',100], ['Scrap Metal',750]] }),
    Object.freeze({ product: 'Gold', output: 800, byproducts: [['Toxic Waste', 150]], ingredients: [['Gold Ore',425], ['MOX',170], ['Industrial Materials',85]] }),
    Object.freeze({ product: 'Niobium', output: 800, byproducts: [['Toxic Waste', 150]], ingredients: [['Niobium Ore',425], ['MOX',170], ['Industrial Materials',85]] })
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
