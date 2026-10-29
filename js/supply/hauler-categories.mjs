/* Presentation groups never replace the model-specific flight/ID checks. */
import { shipFlightRules, isSelectableShip } from './ship-profiles.mjs';

export function haulerCategory(ship) {
  const flight = shipFlightRules(ship);
  let role = ({ 2: 'Freighter', 6: 'Transport', 7: 'Transport', 8: 'Transport', 9: 'Transport',
    10: 'Liner', 11: 'Gunboat', 12: 'Frigate', 14: 'Miner' })[ship.shipClass];
  if (!role) role = /liner|pilgrim/i.test(ship.name || '') ? 'Liner'
    : /transport|train/i.test(ship.type || '') ? 'Transport'
    : /freighter/i.test(ship.type || '') ? 'Freighter' : 'Hauler';
  if (role === 'Transport' && !flight.tradeLanes) role = 'Bulk Hauler';
  const title = `${ship.cargo.toLocaleString('en-GB')} Cargo ${role}`;
  return { id: 'hauler:' + [role.toLowerCase().replace(/ /g, '-'), ship.cargo, ship.cruise, ship.dock,
    Number(flight.tradeLanes), flight.cruiseCharge].join(':'),
    title, label: `${title} · ${ship.cruise} m/s`, role,
    cargo: ship.cargo, cruise: ship.cruise, dock: ship.dock, dockLabel: ship.dockLabel, ...flight };
}

export function haulerCategories(ships) {
  const groups = new Map();
  for (const ship of ships.filter(ship => isSelectableShip(ship) && ([2, 6, 7, 8, 9, 10, 11, 12, 14].includes(ship.shipClass)
    || ship.shipClass == null && /freighter|transport|train|liner|miner/i.test(ship.type || '')))) {
    const category = haulerCategory(ship);
    if (!groups.has(category.id)) groups.set(category.id, { ...category, models: [] });
    groups.get(category.id).models.push(ship);
  }
  const order = ['Transport', 'Liner', 'Freighter', 'Bulk Hauler', 'Miner', 'Frigate', 'Gunboat', 'Hauler'];
  return [...groups.values()].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role)
    || b.cargo - a.cargo || b.cruise - a.cruise || a.id.localeCompare(b.id));
}

export function matchesHauler(ship, categoryId) {
  return !categoryId || categoryId === 'auto' || haulerCategory(ship).id === categoryId;
}
