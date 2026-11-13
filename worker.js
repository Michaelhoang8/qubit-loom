import { simulate } from './core.js';
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ result: simulate(data) });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
