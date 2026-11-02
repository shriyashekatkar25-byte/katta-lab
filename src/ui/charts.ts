/**
 * Small SVG charts for the ledger and the experiment bench. Plain strings,
 * no chart library: each mark is chosen on purpose.
 */
import type { OutcomeComparison } from '../lib/experiment';
import type { World } from '../lib/model';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A sparkline with a faint 0–1 frame, rainy evenings ticked along the bottom. */
export function sparkline(values: number[], rain: boolean[], opts: { w?: number; h?: number; max?: number; label: string }): string {
  const w = opts.w ?? 220;
  const h = opts.h ?? 46;
  const pad = 3;
  if (values.length < 2) {
    return `<svg viewBox="0 0 ${w} ${h}" class="spark" role="img" aria-label="${esc(opts.label)}: not enough evenings yet"><line x1="0" x2="${w}" y1="${h - pad}" y2="${h - pad}" class="spark-axis"/></svg>`;
  }
  const max = opts.max ?? Math.max(1e-6, ...values);
  const n = values.length;
  const x = (i: number) => pad + (i / (n - 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - (Math.min(v, max) / max) * (h - 2 * pad - 6);
  let d = '';
  values.forEach((v, i) => (d += `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`));
  const area = `${d}L${x(n - 1).toFixed(1)} ${h - pad}L${x(0).toFixed(1)} ${h - pad}Z`;
  let ticks = '';
  rain.forEach((r, i) => {
    if (r) ticks += `<line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${h - pad}" y2="${h - pad - 3}" class="spark-rain"/>`;
  });
  const last = values[n - 1];
  return `<svg viewBox="0 0 ${w} ${h}" class="spark" role="img" aria-label="${esc(opts.label)} over ${n} evenings, latest ${(last * 100).toFixed(0)}">
    <path d="${area}" class="spark-area"/><path d="${d}" class="spark-line"/>
    <line x1="0" x2="${w}" y1="${h - pad}" y2="${h - pad}" class="spark-axis"/>${ticks}
    <circle cx="${x(n - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="2.6" class="spark-dot"/></svg>`;
}

/**
 * Isotype census: one figure per resident, grouped by cohort and sorted by
 * belonging. Fill depth encodes belonging; an outline-only figure has no strong tie.
 */
export function isotype(w: World, belongingOf: (id: number) => number, hasStrong: (id: number) => boolean): string {
  const cols = 30;
  const cell = 12;
  const people = w.agents
    .map((a) => ({ id: a.id, g: a.group, b: belongingOf(a.id), s: hasStrong(a.id) }))
    .sort((p, q) => p.g - q.g || Number(q.s) - Number(p.s) || q.b - p.b);
  const rows = Math.ceil(people.length / cols) + 1;
  const width = cols * cell;
  const height = rows * cell + 4;
  let out = '';
  let row = 0;
  let col = 0;
  let prevG = people.length ? people[0].g : 0;
  for (const p of people) {
    if (p.g !== prevG) {
      row += col === 0 ? 0 : 1;
      row += 0.6;
      col = 0;
      prevG = p.g;
    }
    const x = col * cell + cell / 2;
    const y = row * cell + 4;
    const op = (0.15 + 0.85 * p.b).toFixed(2);
    out += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" class="fig g${p.g}${p.s ? '' : ' alone'}" style="--b:${op}"><circle cx="0" cy="2" r="2"/><path d="M-3.2 10 Q-3.2 5 0 5 Q3.2 5 3.2 10 Z"/></g>`;
    col++;
    if (col >= cols) {
      col = 0;
      row++;
    }
  }
  const h = Math.max(height, (row + 1) * cell + 6);
  return `<svg viewBox="0 0 ${width} ${h}" class="isotype" role="img" aria-label="One figure per synthetic resident, settled first then newcomers, sorted by belonging">${out}</svg>`;
}

/** Paired dot strip: every synthetic world as a dot for A (hollow) and B (filled), with 95% CIs. */
export function dotStrip(o: OutcomeComparison, opts: { pct: boolean; label: string }): string {
  const w = 300;
  const h = 64;
  const all = [...o.samplesA, ...o.samplesB, o.a.lo, o.a.hi, o.b.lo, o.b.hi];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 1e-6) {
    lo -= 0.01;
    hi += 0.01;
  }
  const padX = 8;
  const x = (v: number) => padX + ((v - lo) / (hi - lo)) * (w - 2 * padX);
  const jitter = (i: number) => ((i * 37) % 11) - 5;
  let dots = '';
  o.samplesA.forEach((v, i) => (dots += `<circle cx="${x(v).toFixed(1)}" cy="${(20 + jitter(i) * 0.9).toFixed(1)}" r="2.4" class="dot-a"/>`));
  o.samplesB.forEach((v, i) => (dots += `<circle cx="${x(v).toFixed(1)}" cy="${(46 + jitter(i) * 0.9).toFixed(1)}" r="2.4" class="dot-b"/>`));
  const ci = (iv: { lo: number; hi: number; mean: number }, y: number, cls: string) =>
    `<line x1="${x(iv.lo).toFixed(1)}" x2="${x(iv.hi).toFixed(1)}" y1="${y}" y2="${y}" class="${cls}"/><line x1="${x(iv.mean).toFixed(1)}" x2="${x(iv.mean).toFixed(1)}" y1="${y - 7}" y2="${y + 7}" class="${cls}"/>`;
  const fmt = (v: number) => (opts.pct ? `${(v * 100).toFixed(1)}%` : v.toFixed(3));
  return `<svg viewBox="0 0 ${w} ${h}" class="strip" role="img" aria-label="${esc(opts.label)}: A mean ${fmt(o.a.mean)}, B mean ${fmt(o.b.mean)}">
    <text x="0" y="9" class="strip-k">A</text><text x="0" y="62" class="strip-k">B</text>
    ${ci(o.a, 20, 'ci-a')}${ci(o.b, 46, 'ci-b')}${dots}
    <text x="${padX}" y="${h - 1}" class="strip-t" text-anchor="start" dx="10">${fmt(lo)}</text>
    <text x="${w - padX}" y="${h - 1}" class="strip-t" text-anchor="end">${fmt(hi)}</text></svg>`;
}
