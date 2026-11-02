import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS, HOME_UTILITY, STRONG_TIE, belongingOf, choiceProbabilities, computeMetrics, createWorld, defaultPlots,
  hasStrongTie, setPlot, step, strongestBridges, utility,
} from '../src/lib/model';

const fresh = (seed = 1, over = {}) => createWorld({ ...DEFAULT_PARAMS, ...over }, defaultPlots(), seed);

describe('world creation', () => {
  it('builds the requested population and cohort split', () => {
    const w = fresh(1, { population: 200, newcomerShare: 0.25 });
    expect(w.agents).toHaveLength(200);
    expect(w.agents.filter((a) => a.group === 1)).toHaveLength(50);
  });
  it('is reproducible from its seed', () => {
    const a = fresh(42), b = fresh(42);
    for (let i = 0; i < 10; i++) { step(a); step(b); }
    expect(a.history.map((m) => m.belonging)).toEqual(b.history.map((m) => m.belonging));
    expect([...a.attend]).toEqual([...b.attend]);
  });
  it('residential mix 0 puts every cohort on its own bank', () => {
    const w = fresh(3, { residentialMix: 0 });
    for (const a of w.agents) expect(a.group === 0 ? a.x < 520 : a.x > 450).toBe(true);
  });
});

describe('choice model', () => {
  it('probabilities form a distribution and closed plots get zero', () => {
    const w = fresh();
    const p = choiceProbabilities(w, w.agents[0]);
    expect(p.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 10);
    w.plots.forEach((pl, j) => { if (!pl.type) expect(p[j + 1]).toBe(0); });
    expect(utility(w, w.agents[0], 9)).toBe(-Infinity);
  });
  it('distance lowers utility', () => {
    const w = fresh();
    const a = w.agents[0];
    const j = 0;
    const near = utility(w, { ...a, x: w.plots[j].x, y: w.plots[j].y }, j);
    const far = utility(w, { ...a, x: w.plots[j].x + 600, y: w.plots[j].y }, j);
    expect(near).toBeGreaterThan(far);
  });
  it('rain penalises outdoor places only', () => {
    const w = fresh();
    const a = w.agents[0];
    const tapri = 0, library = 3;
    const dryT = utility(w, a, tapri), dryL = utility(w, a, library);
    w.rain = true;
    expect(utility(w, a, tapri)).toBeCloseTo(dryT - 2.5);
    expect(utility(w, a, library)).toBeCloseTo(dryL);
  });
  it('homophily pulls toward rooms of your own cohort', () => {
    const w = fresh(1, { homophily: 2 });
    const a = w.agents.find((x) => x.group === 0)!;
    w.prevShare[0][0] = 0.9;
    const u1 = utility(w, a, 0);
    w.prevShare[0][0] = 0.1;
    expect(u1).toBeGreaterThan(utility(w, a, 0));
  });
  it('higher temperature spreads choice toward uniform', () => {
    const w = fresh(1, { temperature: 0.2 });
    const cold = Math.max(...choiceProbabilities(w, w.agents[0]));
    w.params.temperature = 5;
    expect(Math.max(...choiceProbabilities(w, w.agents[0]))).toBeLessThan(cold);
    expect(HOME_UTILITY).toBeGreaterThan(0);
  });
});

describe('evenings', () => {
  it('everyone is either home or at an open place', () => {
    const w = fresh();
    step(w);
    for (const j of w.attend) if (j >= 0) expect(w.plots[j].type).not.toBeNull();
  });
  it('ties are symmetric and decay without contact', () => {
    const w = fresh();
    for (let i = 0; i < 10; i++) step(w);
    for (const a of w.agents) for (const [k, v] of a.ties) expect(w.agents[k].ties.get(a.id)).toBeCloseTo(v, 6);
    const a = w.agents.find((x) => x.ties.size > 0)!;
    const [k, v] = [...a.ties.entries()][0];
    w.agents.forEach((x) => (x.sociability = 0)); // nobody goes out
    step(w);
    expect(a.ties.get(k)! ).toBeCloseTo(v * (1 - w.params.tieDecay), 6);
  });
  it('metrics stay in range', () => {
    const w = fresh(7);
    for (let i = 0; i < 20; i++) {
      const m = step(w);
      for (const k of ['outRate', 'dissimilarity', 'bridging', 'isolation', 'belonging', 'concentration'] as const) {
        expect(m[k]).toBeGreaterThanOrEqual(0);
        expect(m[k]).toBeLessThanOrEqual(1);
      }
    }
    expect(computeMetrics(w).day).toBe(20);
  });
  it('belonging and strong ties agree on the basics', () => {
    const w = fresh();
    const a = w.agents[0];
    expect(belongingOf(a)).toBe(0);
    expect(hasStrongTie(a)).toBe(false);
    a.ties.set(1, STRONG_TIE);
    expect(hasStrongTie(a)).toBe(true);
    expect(belongingOf(a)).toBeGreaterThan(0);
  });
  it('closing a place empties it from the next evening', () => {
    const w = fresh();
    step(w);
    setPlot(w, 0, null);
    step(w);
    expect([...w.attend].filter((j) => j === 0)).toHaveLength(0);
    for (const a of w.agents) expect(a.fam[0]).toBe(0);
  });
  it('bridges are cross-cohort and sorted', () => {
    const w = fresh(11, { homophily: 0, residentialMix: 1 });
    for (let i = 0; i < 25; i++) step(w);
    const b = strongestBridges(w, 20);
    expect(b.length).toBeGreaterThan(0);
    for (const [i, j] of b) expect(w.agents[i].group).not.toBe(w.agents[j].group);
    for (let i = 1; i < b.length; i++) expect(b[i - 1][2]).toBeGreaterThanOrEqual(b[i][2]);
  });
});
