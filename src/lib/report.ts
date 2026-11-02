/**
 * Field notes: a rule-based writer that turns the ledger and the experiment
 * into plain sentences. There is no language model here: each sentence is a
 * template chosen by explicit thresholds, so every claim can be traced to a number.
 */
import type { DayMetrics, Plot } from './model';
import { PLACE_SPECS } from './model';
import { OUTCOME_LABELS, type ExperimentResult, type Outcome } from './experiment';
import { mean } from './stats';

export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
export const pts = (x: number, digits = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(digits)} pts`;

export function describeCity(history: DayMetrics[], plots: Plot[]): string[] {
  const notes: string[] = [];
  if (history.length === 0) {
    notes.push('No evenings recorded yet. Press play, or step one evening, to begin the ledger.');
    return notes;
  }
  const last = history.slice(-7);
  const d = mean(last.map((m) => m.dissimilarity));
  const mix = mean(last.map((m) => m.mixing));
  const iso = mean(last.map((m) => m.isolation));
  const [b0, b1] = [mean(last.map((m) => m.belongingByGroup[0])), mean(last.map((m) => m.belongingByGroup[1]))];
  const day = history[history.length - 1].day;

  notes.push(`After ${day} evening${day === 1 ? '' : 's'}, averaged over the last ${last.length}:`);

  if (d > 0.7) notes.push(`The two cohorts keep to different places (dissimilarity ${d.toFixed(2)}): on a typical evening about ${pct(d)} of one cohort would have to move for the rooms to look alike.`);
  else if (d > 0.4) notes.push(`Evenings are partly sorted (dissimilarity ${d.toFixed(2)}): some rooms are shared, many are not.`);
  else notes.push(`The cohorts share their evenings fairly evenly (dissimilarity ${d.toFixed(2)}).`);

  if (mix < 0.25) notes.push(`Strong ties almost never cross the river: bridging runs at ${pct(mix)} of what colour-blind mixing would produce.`);
  else if (mix < 0.7) notes.push(`Some friendships bridge the cohorts, at ${pct(mix)} of the colour-blind rate.`);
  else notes.push(`Friendships cross cohorts nearly as often as chance would predict (mixing ratio ${mix.toFixed(2)}).`);

  const gap = b1 - b0;
  if (Math.abs(gap) >= 0.04) notes.push(`${gap > 0 ? 'Newcomers' : 'Settled residents'} report more belonging (${pct(Math.max(b0, b1))} vs ${pct(Math.min(b0, b1))}).`);
  notes.push(`${pct(iso)} of residents have no strong tie yet.`);

  // Busiest and quietest open places tonight.
  const lastDay = history[history.length - 1];
  const open = plots.map((p, i) => ({ p, n: lastDay.load[0][i] + lastDay.load[1][i], i })).filter((x) => x.p.type);
  if (open.length) {
    open.sort((a, b) => b.n - a.n);
    const top = open[0];
    const spec = PLACE_SPECS[top.p.type!];
    notes.push(`Busiest tonight: the ${spec.name.toLowerCase()} at ${top.p.name} (${top.n} visitors${top.n > spec.capacity ? ', over capacity' : ''}).`);
    const empty = open.filter((x) => x.n === 0);
    if (empty.length) notes.push(`Empty tonight: ${empty.map((x) => x.p.name).join(', ')}.`);
  }
  if (lastDay.rain) notes.push('It rained this evening; outdoor places lost visitors.');
  return notes;
}

export type Verdict = 'rise' | 'fall' | 'unclear';

export function verdict(lo: number, hi: number): Verdict {
  if (lo > 0) return 'rise';
  if (hi < 0) return 'fall';
  return 'unclear';
}

/** Is a verdict good news, given which direction is "better" for this outcome? */
export function isImprovement(o: Outcome, v: Verdict): boolean | null {
  if (v === 'unclear') return null;
  const up = OUTCOME_LABELS[o].better === 'up';
  return (v === 'rise') === up;
}

export function describeExperiment(r: ExperimentResult, changes: string[]): string[] {
  const notes: string[] = [];
  const what = changes.length ? changes.join('; ') : 'no change (A and B are identical, a useful sanity check)';
  notes.push(`In ${r.runs} paired synthetic worlds of ${r.days} evenings each, the intervention was: ${what}.`);
  let clear = 0;
  for (const k of Object.keys(r.outcomes) as Outcome[]) {
    const o = r.outcomes[k];
    const v = verdict(o.diff.lo, o.diff.hi);
    const meta = OUTCOME_LABELS[k];
    const fmt = (x: number) => (meta.pct ? pts(x) : `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(3)}`);
    if (v === 'unclear') continue;
    clear++;
    const good = isImprovement(k, v);
    notes.push(
      `${meta.label} ${v === 'rise' ? 'rose' : 'fell'} by ${fmt(o.diff.mean)} (95% bootstrap CI ${fmt(o.diff.lo)} to ${fmt(o.diff.hi)}; paired d = ${o.effect.toFixed(2)})${good ? ', which is the hoped-for direction' : ', against the hoped-for direction'}.`,
    );
  }
  if (clear === 0) notes.push('No outcome moved clearly: every confidence interval straddles zero. Try more runs, or a bolder change.');
  notes.push('These are properties of a toy model with assumed tastes, not findings about any real city or community.');
  return notes;
}
