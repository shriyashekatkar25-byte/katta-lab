/// <reference lib="webworker" />
/** Runs Monte Carlo experiments off the main thread so the city keeps animating. */
import { runExperiment } from './lib/experiment';
import type { Scenario } from './lib/city';

interface Job {
  a: Scenario;
  b: Scenario;
  reps: number;
  days: number;
  seed: number;
}

self.onmessage = (e: MessageEvent<Job>) => {
  try {
    const { a, b, reps, days, seed } = e.data;
    const result = runExperiment(a, b, reps, days, seed, (done, total) => {
      self.postMessage({ type: 'progress', done, total });
    });
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) });
  }
};
