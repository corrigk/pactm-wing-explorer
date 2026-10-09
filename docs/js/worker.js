// Background worker: runs the heavy jobs off the UI thread. The version query (?v=N) on this worker's
// URL is forwarded to its imports so a new deploy never mixes cached and new modules.
const ready = import(`./jobs.js${self.location.search}`);

self.onmessage = async (ev) => {
  const { runJob } = await ready;
  runJob(ev.data, (msg, transfer) => self.postMessage(msg, transfer || []));
};
