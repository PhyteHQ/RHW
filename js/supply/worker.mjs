import { searchSupply } from './planner.mjs';
import { searchExports } from './export-planner.mjs';
import { searchIdentities } from './identity-planner.mjs';
let generation = 0;
self.onmessage = async ({ data }) => {
  const token = ++generation;
  if (data.type === 'cancel') return;
  try {
    const search = data.options?.mode === 'export' ? searchExports : searchSupply;
    const invoke = data.scopes?.length
      ? (...callbacks) => searchIdentities(data.dataset, data.navigation, data.profiles, data.scopes, data.options, ...callbacks)
      : (...callbacks) => search(data.dataset, data.navigation, data.profiles, data.options, ...callbacks);
    const result = await invoke(
      progress => { if (generation === token) self.postMessage({ type: 'progress', id: data.id, progress }); },
      () => token !== generation);
    if (generation === token) self.postMessage({ type: 'result', id: data.id, result });
  } catch (error) {
    if (generation === token) self.postMessage({ type: 'error', id: data.id, message: error.message });
  }
};
