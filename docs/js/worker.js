// Background worker: runs the heavy jobs off the UI thread.
import { runJob } from './jobs.js';

self.onmessage = (ev) => runJob(ev.data, (msg, transfer) => self.postMessage(msg, transfer || []));
