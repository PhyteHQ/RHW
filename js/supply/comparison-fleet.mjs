/* The owner's four comparison slots. Every slot retains one concrete registry
   hull for ID, docking, tech and commodity-volume checks. */
import { isSelectableShip } from './ship-profiles.mjs';

export const COMPARISON_FLEET = Object.freeze([
  { id: 'barge', name: 'Barge', preferred: ['dsy_cargobarge_1'],
    matches: ship => ship.nickname === 'dsy_cargobarge_1' && ship.cargo === 30000 },
  { id: 'transport-5000', name: '5k Transport', preferred: ['dsy_advanced_train'],
    matches: ship => ship.cargo === 5000 && ship.cruise === 350 && ship.dock === 'medium' && [6, 7, 8, 9].includes(ship.shipClass) },
  { id: 'pilgrim', name: 'Pilgrim', preferred: ['pilgrim_liner'],
    matches: ship => ship.nickname === 'pilgrim_liner' },
  { id: 'transport-3600', name: '3.6k Transport', cruise: 500, preferred: ['dsy_firefly', 'dsy_bwtrain'],
    matches: ship => ship.cargo === 3600 && ship.cruise === 500 && ship.dock === 'medium' && ship.shipClass === 6 }
]);

export function comparisonFleet(ships) {
  // Recover the registry speed from the previous 600 m/s user-profile cache.
  // Strip that retired assumption before filtering or passing hulls to workers.
  const registry = ships.filter(isSelectableShip).map(ship => {
    const { userCruise, reportedCruise, ...model } = ship;
    return { ...model, cruise: userCruise && Number.isFinite(reportedCruise) ? reportedCruise : ship.cruise };
  });
  const unique = [...new Map(registry.map(ship => [ship.id, ship])).values()];
  return COMPARISON_FLEET.flatMap(slot => {
    const order = ship => { const n = slot.preferred.indexOf(ship.nickname); return n < 0 ? 100 : n; };
    const ship = unique.filter(slot.matches).sort((a, b) => Number(b.cruise === slot.cruise) - Number(a.cruise === slot.cruise)
      || order(a) - order(b) || a.id.localeCompare(b.id))[0];
    if (!ship) return [];
    return [{ ...ship, fleetId: slot.id, fleetName: slot.name }];
  });
}
