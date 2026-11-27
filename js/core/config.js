// ============================================================
// RHW WEB APP CONFIGURATION · V4.0.2
// App identity, COMMS templates, sender registry defaults and UI presets.
// ============================================================
const RHW_APP_VERSION = 'V4.0.2';

const RHW_APP_CONFIG = Object.freeze({
  build: window.RHW_BUILD,
  repository: window.RHW_BUILD.repository,
  routes: window.RHW_ROUTES.routes,
  legacyRedirects: window.RHW_ROUTES.legacyRedirects,
  storageKeys: Object.freeze({
    activeWorkspace: 'rhw-webapp-v4:workspace',
    commandNode: 'rhw-webapp-v4:command-node',
    inventoryView: 'rhw-webapp-v4:inventory-view',
    populationCounts: 'rhw-webapp-v4:population-counts',
    shipyardSelection: 'rhw-webapp-v4:shipyard-selection',
    shipyardDivisions: 'rhw-webapp-v4:shipyard-divisions',
    moxRecipe: 'rhw-webapp-v4:mox-recipe',
    operationsNode: 'rhw-webapp-v4:operations-node',
    calculatorState: 'rhw-webapp-v4:calculator-state',
    priceCheckOverrides: 'rhw-webapp-v4:price-check-overrides',
    calculatorPriceProfiles: 'rhw-webapp-v4:calculator-price-profiles',
    productionOrders: 'rhw-webapp-v4:production-orders',
    shipyardPlanner: 'rhw-webapp-v4:shipyard-planner',
    commsNode: 'rhw-webapp-v4:comms-node',
    commsCurrent: 'rhw-webapp-v4:comms-current',
    commsDrafts: 'rhw-webapp-v4:comms-drafts',
    localSenders: 'rhw-webapp-v4:local-senders',
    tickerComposer: 'rhw-webapp-v4:ticker-composer',
    newswireManagerDraft: 'rhw-webapp-v4:newswire-manager-draft',
    commsMobileView: 'rhw-webapp-v4:comms-mobile-view'
  }),
  operations: Object.freeze({
    defaultProduct: 'dsy_br_battleship_package',
    defaultAffiliation: 'br_m_grp',
    maxTreeDepth: 18
  }),
  forum: Object.freeze({
    // Exported BBCode needs an absolute public URL; the local preview works offline.
    logoUrl: 'https://i.ibb.co/bMDBZBRJ/Resolution-Heavy-Works-Heraldic-Crest.png',
    previewLogoUrl: './assets/rhw-forum-logo.png',
    logoWidth: 240,
    logoHeight: 299,
    footerUrl: 'https://phytehq.github.io/RHW/assets/rhw-forum-footer.png',
    previewFooterUrl: './assets/rhw-forum-footer.png',
    brandName: 'RESOLUTION',
    brandDivision: 'HEAVY WORKS',
    affiliation: 'BRETONIA MINING AND MANUFACTURING',
    headerMotto: 'Under the Crown. For the Crown.',
    locationLine: 'NEW LONDON · BRETONIA',
    brandColor: '#C9AA70',
    textColor: '#E4E8EE',
    steelColor: '#CDD4DC',
    mutedColor: '#8995A5',
    lineColor: '#426B98',
    blueColor: '#80AAD8',
    footerMotto: 'Industry in Service of the Crown.'
  }),
  classifications: Object.freeze([
    'PUBLIC RELEASE',
    'RES OFFICIAL',
    'RHW INTERNAL',
    'COMMERCIAL CONFIDENTIAL',
    'BMM CONFIDENTIAL',
    'CROWN RESTRICTED',
    'ADMIRALTY EYES ONLY',
    'RHW EXECUTIVE',
    'PRIORITY // RESTRICTED'
  ]),
  classificationColors: Object.freeze({
    'PUBLIC RELEASE': '#78ad8a',
    'RES OFFICIAL': '#C9AA70',
    'RHW INTERNAL': '#80AAD8',
    'COMMERCIAL CONFIDENTIAL': '#c6a75a',
    'BMM CONFIDENTIAL': '#c6a75a',
    'CROWN RESTRICTED': '#c98b2c',
    'ADMIRALTY EYES ONLY': '#c75e5e',
    'RHW EXECUTIVE': '#C9AA70',
    'PRIORITY // RESTRICTED': '#c75e5e'
  }),
  closings: Object.freeze([
    Object.freeze({ key: 'formal', label: 'FORMAL / UNKNOWN RECIPIENT — Yours faithfully,', value: 'Yours faithfully,' }),
    Object.freeze({ key: 'named', label: 'NAMED RECIPIENT — Yours sincerely,', value: 'Yours sincerely,' }),
    Object.freeze({ key: 'crown', label: 'CROWN / ROYAL OFFICE — In loyal service to the Crown,', value: 'In loyal service to the Crown,' }),
    Object.freeze({ key: 'military', label: 'MILITARY / ADMIRALTY — Respectfully,', value: 'Respectfully,' }),
    Object.freeze({ key: 'business', label: 'BUSINESS PARTNER — With highest regards,', value: 'With highest regards,' }),
    Object.freeze({ key: 'supplier', label: 'SUPPLIER / CONTRACTOR — Kind regards,', value: 'Kind regards,' }),
    Object.freeze({ key: 'internal', label: 'INTERNAL RHW / BMM — For Resolution Heavy Works,', value: 'For Resolution Heavy Works,' }),
    Object.freeze({ key: 'neutral', label: 'NEUTRAL — Regards,', value: 'Regards,' })
  ]),
  salutations: Object.freeze([
    Object.freeze({ key: 'crown', label: 'CROWN / ROYAL OFFICE — To the appropriate officers of the Crown,', value: 'To the appropriate officers of the Crown,' }),
    Object.freeze({ key: 'military', label: 'MILITARY / ADMIRALTY — To the appropriate officers of the Bretonia Armed Forces,', value: 'To the appropriate officers of the Bretonia Armed Forces,' }),
    Object.freeze({ key: 'business', label: 'BUSINESS PARTNER — To our valued commercial partner,', value: 'To our valued commercial partner,' }),
    Object.freeze({ key: 'supplier', label: 'SUPPLIER / CONTRACTOR — To our appointed supplier,', value: 'To our appointed supplier,' }),
    Object.freeze({ key: 'internal', label: 'INTERNAL RHW / BMM — To the relevant RHW/BMM departments,', value: 'To the relevant RHW/BMM departments,' }),
    Object.freeze({ key: 'formal', label: 'FORMAL GENERAL — Dear Sir or Madam,', value: 'Dear Sir or Madam,' }),
    Object.freeze({ key: 'recipient', label: 'USE RECIPIENT FIELD — To [recipient],', value: '__recipient__' }),
    Object.freeze({ key: 'none', label: 'NO SALUTATION', value: '__none__' })
  ]),
  senders: Object.freeze([
    Object.freeze({
      key: 'alistair-thorne',
      name: 'Alistair Thorne',
      title: 'Chief Executive Officer',
      organisation: 'Resolution Heavy Works',
      location: 'Resolution Heavy Works, New London',
      encryption: 'RHW-RESOLUTION/V · KEY THORNE-07'
    })
  ]),
  templates: Object.freeze([
    Object.freeze({
      key: 'formal', label: 'FORMAL TRANSMISSION', documentLabel: 'Official Corporate Correspondence',
      officeLabel: 'OFFICE OF THE CHIEF EXECUTIVE',
      description: 'Official RHW correspondence with complete routing and security metadata.',
      recipient: '', encryption: 'CROWN-TYPEX/VIII · KEY LION-01', classification: 'RES OFFICIAL',
      closing: 'Yours faithfully,', salutation: 'Dear Sir or Madam,',
      subjectPlaceholder: 'Correspondence subject'
    }),
    Object.freeze({
      key: 'procurement', label: 'PROCUREMENT', documentLabel: 'ADMIRALTY PROCUREMENT FILE',
      description: 'Military-industrial procurement, capital-hull offers and Crown supply correspondence.',
      recipient: 'Bretonia Armed Forces | Admiralty Procurement Office',
      encryption: 'ADMIRALTY-IRONCLAD/VI · KEY VICTORIA-03', classification: 'CROWN RESTRICTED',
      closing: 'Respectfully,', salutation: 'To the appropriate officers of the Bretonia Armed Forces,',
      subjectPlaceholder: 'Procurement subject'
    }),
    Object.freeze({
      key: 'trade', label: 'TRADE OFFER', documentLabel: 'COMMERCIAL OFFER FILE',
      description: 'Commercial proposal, supply agreement or external industrial negotiation.',
      recipient: '', encryption: 'BMM-BLACKTHORN/IV · KEY THAMES-11',
      classification: 'COMMERCIAL CONFIDENTIAL', closing: 'With highest regards,',
      salutation: 'To our valued commercial partner,', subjectPlaceholder: 'Commercial subject'
    }),
    Object.freeze({
      key: 'operations', label: 'OPERATIONS BULLETIN', documentLabel: 'YARD OPERATIONS BULLETIN',
      description: 'Internal production, logistics, maintenance or yard-control transmission.',
      recipient: 'RHW Operations Network', encryption: 'RHW-RESOLUTION/V · KEY NEW-LONDON-06',
      classification: 'RHW INTERNAL', closing: 'For Resolution Heavy Works,',
      salutation: 'To the relevant RHW/BMM departments,', subjectPlaceholder: 'Operations subject'
    }),
    Object.freeze({
      key: 'incident', label: 'INCIDENT REPORT', documentLabel: 'PRIORITY INCIDENT FILE',
      description: 'Priority security, facility or operational incident report.',
      recipient: 'RHW Command', encryption: 'CROWN-SOVEREIGN/IX · KEY RED-LION-01',
      classification: 'PRIORITY // RESTRICTED', closing: 'Respectfully,',
      salutation: 'To the relevant RHW/BMM departments,', subjectPlaceholder: 'Incident subject'
    }),
    Object.freeze({
      key: 'announcement', label: 'GENERAL ANNOUNCEMENT', documentLabel: 'PUBLIC INDUSTRIAL NOTICE',
      description: 'Public-facing RHW statement, yard announcement or corporate bulletin.',
      recipient: 'Open Broadcast', encryption: 'RHW-HERALD/II · KEY CROWN-04',
      classification: 'PUBLIC RELEASE', closing: 'For Resolution Heavy Works,',
      salutation: '__none__', subjectPlaceholder: 'Announcement subject'
    })
  ]),
  cipher: Object.freeze({
    authorities: Object.freeze({
      formal: Object.freeze(['CROWN', 'WHITEHALL', 'RHW']),
      procurement: Object.freeze(['ADMIRALTY', 'CROWN', 'BAF']),
      trade: Object.freeze(['BMM', 'RHW', 'THAMES']),
      operations: Object.freeze(['RHW', 'BMM', 'NEW-LONDON']),
      incident: Object.freeze(['CROWN-PRIORITY', 'RHW-SECURITY', 'BAF']),
      announcement: Object.freeze(['RHW-HERALD', 'BMM-PUBLIC', 'CROWN-BROADCAST'])
    }),
    families: Object.freeze(['TYPEX', 'SOVEREIGN', 'IRONCLAD', 'LIONHEART', 'BLACKTHORN', 'CROWNGLASS', 'RESOLUTION']),
    keysets: Object.freeze(['LION', 'VICTORIA', 'THAMES', 'WINDSOR', 'CROWN', 'NEW-LONDON', 'RESOLUTION', 'BRITANNIA', 'FOUNDRY'])
  })
});
