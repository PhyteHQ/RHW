import { normalize } from './planner.mjs';

const categories = [
  ['SHIP SYSTEMS', []],
  ['PRODUCTION MATERIALS', ['Ablative Armor Plating', 'Energy Field Equipment', 'Hull Panels', 'Industrial Materials', 'Mining Machinery', 'Multi-Mode Focusing Chamber', 'Prototype Components', 'Super Alloy']],
  ['METALS & ORES', ['Copper', 'Gold', 'Iron', 'Molybdenum', 'Niobium', 'Silver', 'Titanium', 'Wildcat Gold']],
  ['FUELS & CHEMICALS', ['H-Fuel', 'MOX', 'Promethene', 'Hydrocarbons']],
  ['BASE SUPPLIES', ['Basic Alloy', 'Consumer Goods', 'Food Rations', 'Hangar Provisions']],
  ['RECYCLING & BYPRODUCTS', ['Military Salvage', 'Scrap Metal', 'Toxic Waste']],
  ['OTHER GOODS', []]
].map(([label, names]) => ({ label, keys: new Set(names.map(normalize)) }));

function category(name) {
  const key = normalize(name);
  if (/\bsystems?$/.test(key)) return categories[0];
  if (/\bore$/.test(key)) return categories[2];
  return categories.find(group => group.keys.has(key)) || categories.at(-1);
}

export function commodityGroups(names, exports = [], mode = 'supply', imports = []) {
  const output = new Set(exports.map(normalize));
  const input = new Set(imports.map(normalize));
  const unique = [...new Map(names.filter(Boolean).map(name => [normalize(name), name])).values()]
    .filter(name => mode === 'export' ? output.has(normalize(name)) : !output.has(normalize(name)) || input.has(normalize(name)))
    .sort((a, b) => a.localeCompare(b));
  return categories.map(group => ({ label: group.label, names: unique.filter(name => category(name) === group) }))
    .filter(group => group.names.length);
}
