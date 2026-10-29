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
  { id: 'transport-3600', name: '3.6k Transport', cruise: 600, preferred: ['dsy_firefly', 'dsy_bwtrain'],
    matches: ship => ship.cargo === 3600 && ship.dock === 'medium' && ship.shipClass === 6 }
]);

export function comparisonFleet(ships) {
  const unique = [...new Map(ships.filter(isSelectableShip).map(ship => [ship.id, ship])).values()];
  return COMPARISON_FLEET.flatMap(slot => {
    const order = ship => { const n = slot.preferred.indexOf(ship.nickname); return n < 0 ? 100 : n; };
    const ship = unique.filter(slot.matches).sort((a, b) => Number(b.cruise === slot.cruise) - Number(a.cruise === slot.cruise)
      || order(a) - order(b) || a.id.localeCompare(b.id))[0];
    if (!ship) return [];
    const reportedCruise = ship.reportedCruise ?? ship.cruise;
    return [{ ...ship, cruise: slot.cruise ?? ship.cruise, reportedCruise,
      userCruise: slot.cruise != null && slot.cruise !== reportedCruise,
      fleetId: slot.id, fleetName: slot.name }];
  });
}
