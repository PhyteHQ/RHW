import { normalize } from './planner.mjs';

export function commodityGroups(names, exports = [], mode = 'supply') {
  const output = new Set(exports.map(normalize));
  const unique = [...new Map(names.filter(Boolean).map(name => [normalize(name), name])).values()];
  const imported = unique.filter(name => !output.has(normalize(name))).sort((a, b) => a.localeCompare(b));
  const exported = unique.filter(name => output.has(normalize(name))).sort((a, b) => a.localeCompare(b));
  const groups = [{ label: 'IMPORT · Supplies for RHW', names: imported }, { label: 'EXPORT · RHW products & byproducts', names: exported }];
  return (mode === 'export' ? groups.reverse() : groups).filter(group => group.names.length);
}
