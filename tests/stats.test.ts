import { describe, expect, it } from 'vitest';
import { dissimilarity, gini, mean, meanCI, pairedBootstrapCI, pairedEffectSize, quantileSorted, sd, tCrit } from '../src/lib/stats';
import { hashSeed, mulberry32, normal, weightedIndex } from '../src/lib/rng';

describe('rng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = mulberry32(1), b = mulberry32(1), c = mulberry32(2);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
  });
  it('stays in [0,1) and is roughly uniform', () => {
    const r = mulberry32(9);
    const v = Array.from({ length: 20000 }, r);
    expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...v)).toBeLessThan(1);
    expect(mean(v)).toBeCloseTo(0.5, 1);
  });
  it('normal() has the requested moments', () => {
    const r = mulberry32(3);
    const v = Array.from({ length: 20000 }, () => normal(r, 5, 2));
    expect(mean(v)).toBeCloseTo(5, 1);
    expect(sd(v)).toBeCloseTo(2, 1);
  });
  it('weightedIndex respects weights and handles all-zero', () => {
    const r = mulberry32(4);
    const counts = [0, 0, 0];
    for (let i = 0; i < 30000; i++) counts[weightedIndex(r, [1, 0, 3])]++;
    expect(counts[1]).toBe(0);
    expect(counts[2] / counts[0]).toBeGreaterThan(2.7);
    expect(counts[2] / counts[0]).toBeLessThan(3.3);
    expect(weightedIndex(r, [0, 0])).toBe(-1);
  });
  it('hashSeed is stable', () => {
    expect(hashSeed('katta')).toBe(hashSeed('katta'));
    expect(hashSeed('katta')).not.toBe(hashSeed('kattA'));
  });
});

describe('stats', () => {
  it('mean, sd and t critical values', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(tCrit(1)).toBeCloseTo(12.706);
    expect(tCrit(19)).toBeCloseTo(2.093);
    expect(tCrit(500)).toBe(1.96);
  });
  it('meanCI contains the mean and narrows with n', () => {
    const r = mulberry32(5);
    const small = Array.from({ length: 10 }, () => normal(r));
    const big = Array.from({ length: 1000 }, () => normal(r));
    const a = meanCI(small), b = meanCI(big);
    expect(a.lo).toBeLessThan(a.mean);
    expect(a.hi).toBeGreaterThan(a.mean);
    expect(b.hi - b.lo).toBeLessThan(a.hi - a.lo);
  });
  it('paired bootstrap detects a shift and not a null', () => {
    const r = mulberry32(6);
    const a = Array.from({ length: 30 }, () => normal(r, 0, 1));
    const shifted = a.map((x) => x + 0.5 + normal(r, 0, 0.1));
    const ci = pairedBootstrapCI(a, shifted);
    expect(ci.lo).toBeGreaterThan(0.4);
    expect(ci.hi).toBeLessThan(0.6);
    const nul = pairedBootstrapCI(a, a.map((x) => x + normal(r, 0, 0.1)));
    expect(nul.lo).toBeLessThan(0);
    expect(nul.hi).toBeGreaterThan(0);
    expect(pairedEffectSize(a, shifted)).toBeGreaterThan(3);
  });
  it('quantiles interpolate', () => {
    expect(quantileSorted([0, 10], 0.25)).toBe(2.5);
    expect(quantileSorted([1, 2, 3], 0.5)).toBe(2);
  });
  it('gini: 0 for equality, near 1 for concentration', () => {
    expect(gini([5, 5, 5, 5])).toBeCloseTo(0);
    expect(gini([0, 0, 0, 100])).toBeCloseTo(0.75);
    expect(gini([])).toBe(0);
  });
  it('dissimilarity: 0 identical, 1 fully separate', () => {
    expect(dissimilarity([10, 20], [1, 2])).toBeCloseTo(0);
    expect(dissimilarity([10, 0], [0, 7])).toBeCloseTo(1);
    expect(dissimilarity([6, 4], [4, 6])).toBeCloseTo(0.2);
  });
});
