/**
 * Small, dependency-free statistics used by the ledger and the experiment bench.
 */
import { mulberry32, randInt } from './rng';

export function mean(xs: ArrayLike<number>): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

/** Sample standard deviation (n − 1). */
export function sd(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i] - m) ** 2;
  return Math.sqrt(s / (n - 1));
}

/** Two-sided 97.5% Student-t quantiles for df 1..30; beyond that ≈ normal. */
const T975 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131,
  2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];
export function tCrit(df: number): number {
  if (df < 1) return NaN;
  if (df <= 30) return T975[df - 1];
  if (df <= 60) return 2.0;
  return 1.96;
}

export interface Interval {
  mean: number;
  lo: number;
  hi: number;
}

/** 95% t-interval for the mean. */
export function meanCI(xs: ArrayLike<number>): Interval {
  const m = mean(xs);
  const n = xs.length;
  if (n < 2) return { mean: m, lo: m, hi: m };
  const half = tCrit(n - 1) * (sd(xs) / Math.sqrt(n));
  return { mean: m, lo: m - half, hi: m + half };
}

/**
 * Paired bootstrap CI for mean(b − a). The experiment bench runs A and B on the
 * same seeds, so pairing removes world-to-world noise.
 */
export function pairedBootstrapCI(a: number[], b: number[], resamples = 2000, seed = 7): Interval {
  const n = Math.min(a.length, b.length);
  const diffs = new Array<number>(n);
  for (let i = 0; i < n; i++) diffs[i] = b[i] - a[i];
  const m = mean(diffs);
  if (n < 2) return { mean: m, lo: m, hi: m };
  const rng = mulberry32(seed);
  const boots = new Float64Array(resamples);
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += diffs[randInt(rng, n)];
    boots[r] = s / n;
  }
  boots.sort();
  return { mean: m, lo: quantileSorted(boots, 0.025), hi: quantileSorted(boots, 0.975) };
}

/** Cohen's d for paired samples (mean difference / sd of differences). */
export function pairedEffectSize(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  const diffs: number[] = [];
  for (let i = 0; i < n; i++) diffs.push(b[i] - a[i]);
  const s = sd(diffs);
  return s === 0 ? 0 : mean(diffs) / s;
}

export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Gini coefficient of non-negative values (0 = equal, → 1 = concentrated). */
export function gini(xs: ArrayLike<number>): number {
  const v = Array.from(xs).sort((p, q) => p - q);
  const n = v.length;
  const total = v.reduce((s, x) => s + x, 0);
  if (n === 0 || total === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * v[i];
  return (2 * cum) / (n * total) - (n + 1) / n;
}

/**
 * Duncan & Duncan index of dissimilarity: the share of either group that would
 * have to change place for both to be distributed identically across places.
 */
export function dissimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let A = 0;
  let B = 0;
  for (let i = 0; i < a.length; i++) {
    A += a[i];
    B += b[i];
  }
  if (A === 0 || B === 0) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] / A - b[i] / B);
  return 0.5 * s;
}
