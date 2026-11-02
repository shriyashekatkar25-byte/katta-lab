/**
 * Monte Carlo experiment bench. Runs a baseline (A) and an intervention (B)
 * on the same list of seeds, so each pair of worlds shares its residents,
 * homes and dice: the paired difference isolates the effect of the change.
 */
import { createWorld, step, type DayMetrics, type Params, type Plot } from './model';
import { meanCI, pairedBootstrapCI, pairedEffectSize, type Interval } from './stats';

export const OUTCOMES = ['belonging', 'bridging', 'mixing', 'isolation', 'dissimilarity', 'outRate'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<Outcome, { label: string; better: 'up' | 'down'; pct: boolean }> = {
  belonging: { label: 'Belonging', better: 'up', pct: true },
  bridging: { label: 'Bridging ties', better: 'up', pct: true },
  mixing: { label: 'Mixing ratio', better: 'up', pct: false },
  isolation: { label: 'Isolation', better: 'down', pct: true },
  dissimilarity: { label: 'Place segregation (D)', better: 'down', pct: true },
  outRate: { label: 'Evenings out', better: 'up', pct: true },
};

export interface Scenario {
  params: Params;
  plots: Plot[];
}

export type Summary = Record<Outcome, number>;

/** Run one world and summarise its last `window` days (steady-state average). */
export function runWorld(s: Scenario, seed: number, days: number, window = 10): Summary {
  const w = createWorld(s.params, s.plots, seed);
  const tail: DayMetrics[] = [];
  for (let d = 0; d < days; d++) {
    const m = step(w);
    if (d >= days - window) tail.push(m);
  }
  const out = {} as Summary;
  for (const k of OUTCOMES) out[k] = tail.reduce((acc, m) => acc + (m[k] as number), 0) / tail.length;
  return out;
}

export interface OutcomeComparison {
  a: Interval;
  b: Interval;
  diff: Interval;
  effect: number;
  samplesA: number[];
  samplesB: number[];
}

export interface ExperimentResult {
  runs: number;
  days: number;
  baseSeed: number;
  outcomes: Record<Outcome, OutcomeComparison>;
}

export function compare(samplesA: Summary[], samplesB: Summary[], meta: { runs: number; days: number; baseSeed: number }): ExperimentResult {
  const outcomes = {} as Record<Outcome, OutcomeComparison>;
  for (const k of OUTCOMES) {
    const a = samplesA.map((s) => s[k]);
    const b = samplesB.map((s) => s[k]);
    outcomes[k] = {
      a: meanCI(a),
      b: meanCI(b),
      diff: pairedBootstrapCI(a, b, 2000, meta.baseSeed ^ 0x5bd1),
      effect: pairedEffectSize(a, b),
      samplesA: a,
      samplesB: b,
    };
  }
  return { ...meta, outcomes };
}

/** Synchronous experiment (used by tests and as a fallback when Workers are unavailable). */
export function runExperiment(
  A: Scenario,
  B: Scenario,
  runs: number,
  days: number,
  baseSeed: number,
  onProgress?: (done: number, total: number) => void,
): ExperimentResult {
  const sa: Summary[] = [];
  const sb: Summary[] = [];
  for (let r = 0; r < runs; r++) {
    const seed = (baseSeed + r * 7919) >>> 0;
    sa.push(runWorld(A, seed, days));
    sb.push(runWorld(B, seed, days));
    onProgress?.(r + 1, runs);
  }
  return compare(sa, sb, { runs, days, baseSeed });
}
