import { searchSupply } from './planner.mjs';
import { searchExports } from './export-planner.mjs';
let generation = 0;
self.onmessage = async ({ data }) => {
  const token = ++generation;
  if (data.type === 'cancel') return;
  try {
    const search = data.options?.mode === 'export' ? searchExports : searchSupply;
    const result = await search(data.dataset, data.navigation, data.profiles, data.options,
      progress => { if (generation === token) self.postMessage({ type: 'progress', id: data.id, progress }); },
      () => token !== generation);
    if (generation === token) self.postMessage({ type: 'result', id: data.id, result });
  } catch (error) {
    if (generation === token) self.postMessage({ type: 'error', id: data.id, message: error.message });
  }
};
