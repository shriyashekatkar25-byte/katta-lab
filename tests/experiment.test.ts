import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, defaultPlots } from '../src/lib/model';
import { OUTCOMES, runExperiment, runWorld } from '../src/lib/experiment';
import { describeExperiment, verdict } from '../src/lib/report';

const base = () => ({ params: { ...DEFAULT_PARAMS }, plots: defaultPlots() });

describe('experiment bench', () => {
  it('an A/A test gives exactly zero difference (common random numbers)', () => {
    const r = runExperiment(base(), base(), 4, 15, 1);
    for (const k of OUTCOMES) {
      expect(r.outcomes[k].diff.mean).toBe(0);
      expect(verdict(r.outcomes[k].diff.lo, r.outcomes[k].diff.hi)).toBe('unclear');
    }
    expect(describeExperiment(r, []).join(' ')).toMatch(/No outcome moved clearly/);
  });
  it('stronger homophily raises place segregation (directional sanity check)', () => {
    const B = { params: { ...DEFAULT_PARAMS, homophily: 3 }, plots: defaultPlots() };
    const r = runExperiment(base(), B, 6, 40, 2);
    expect(r.outcomes.dissimilarity.diff.lo).toBeGreaterThan(0);
  });
  it('a permanent monsoon keeps more people home', () => {
    const B = { params: { ...DEFAULT_PARAMS, monsoon: true }, plots: defaultPlots() };
    const r = runExperiment(base(), B, 6, 30, 3);
    expect(r.outcomes.outRate.diff.hi).toBeLessThan(0);
  });
  it('runWorld is deterministic and reports progress', () => {
    expect(runWorld(base(), 9, 12)).toEqual(runWorld(base(), 9, 12));
    const seen: number[] = [];
    runExperiment(base(), base(), 3, 5, 4, (d) => seen.push(d));
    expect(seen).toEqual([1, 2, 3]);
  });
});
