/// <reference lib="webworker" />
/**
 * Experiment worker: runs the paired Monte Carlo off the main thread so the
 * city keeps animating while hundreds of synthetic evenings are simulated.
 */
import { runExperiment, type Scenario } from './lib/experiment';

export interface ExperimentRequest {
  id: number;
  A: Scenario;
  B: Scenario;
  runs: number;
  days: number;
  baseSeed: number;
}

const post = (msg: unknown) => (self as unknown as Worker).postMessage(msg);

self.onmessage = (e: MessageEvent<ExperimentRequest>) => {
  const { id, A, B, runs, days, baseSeed } = e.data;
  try {
    const result = runExperiment(A, B, runs, days, baseSeed, (done, total) => post({ id, type: 'progress', done, total }));
    post({ id, type: 'done', result });
  } catch (err) {
    post({ id, type: 'error', message: String(err) });
  }
};
