/* RHW flight capabilities around the unchanged DTR pathfinder. */
import { Navigator } from './core/navigation.mjs';
import { shipFlightRules } from './ship-profiles.mjs';

export class ShipNavigator extends Navigator {
  constructor(navigation, bases, profile, settings = {}) {
    const flight = shipFlightRules(profile);
    if (navigation && !flight.tradeLanes) {
      const nodes = navigation.nodes.filter(node => node.kind !== 'lane');
      const ids = new Set(nodes.map(node => node.id));
      navigation = { ...navigation, nodes,
        links: navigation.links.filter(edge => edge.kind !== 'lane' && ids.has(edge.from) && ids.has(edge.to)) };
    }
    super(navigation, bases, profile, { ...settings, charge: flight.cruiseCharge });
  }
}

// Quotes with the same physical flight constraints can share their path cache.
// Cargo limits refer to hull capacity, even when it is only partially loaded.
export function flightKey(navigation, profile) {
  const flight = shipFlightRules(profile);
  const limits = [...new Set(navigation?.links?.flatMap(edge => edge.cargoLimit == null ? [] : [edge.cargoLimit]) || [])].sort((a, b) => a - b);
  return JSON.stringify([profile.dock, profile.cruise, flight.tradeLanes, flight.cruiseCharge,
    limits.map(limit => profile.cargo <= limit)]);
}
