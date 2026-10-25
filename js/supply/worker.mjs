import { searchSupply } from './planner.mjs';
let generation = 0;
self.onmessage = async ({ data }) => {
  const token = ++generation;
  if (data.type === 'cancel') return;
  try {
    const result = await searchSupply(data.dataset, data.navigation, data.profiles, data.options,
      progress => { if (generation === token) self.postMessage({ type: 'progress', id: data.id, progress }); },
      () => token !== generation);
    if (generation === token) self.postMessage({ type: 'result', id: data.id, result });
  } catch (error) {
    if (generation === token) self.postMessage({ type: 'error', id: data.id, message: error.message });
  }
};
